#!/usr/bin/env python3
"""
Quoldek API — realtime quiz builder, AI co-editor and live game arena.

Everything lives behind /api and is served by server.py (Flask).
Realtime is done with Server-Sent Events (no extra dependencies) plus a
polling fallback, so it runs anywhere Flask runs (Railway, Render, laptop).
"""
from __future__ import annotations

import atexit
import json
import math
import os
import queue
import random
import re
import signal
import string
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

from flask import Blueprint, Response, jsonify, request

api = Blueprint("api", __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
STORE_PATH = os.path.join(DATA_DIR, "store.json")

_lock = threading.RLock()
_store = {"quizzes": {}, "responses": {}}
_games: dict[str, dict] = {}          # pin -> game state (in memory, live only)
_channels: dict[str, list[queue.Queue]] = {}
_presence: dict[str, dict] = {}       # quiz id -> {clientId: {name, colour, ts}}


# ─────────────────────────────────────────── storage ──
#
# Two backends, chosen by environment:
#
#   • JSON file (default)  — great locally and on any host with a real disk.
#   • Supabase / Postgres  — set SUPABASE_URL and SUPABASE_SERVICE_KEY.
#
# The second one matters on free hosting: those servers sleep when idle and wipe
# their filesystem on the way back up, which would take every quiz with it. With
# the database backend the file is only ever a warm cache.

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
SUPABASE_TABLE = os.environ.get("SUPABASE_TABLE", "quiznova_state")
STATE_ROW = "main"
FLUSH_DELAY = 1.2          # seconds to coalesce a burst of edits into one write


class FileBackend:
    """Stores everything in data/store.json."""

    name = "file"

    def load(self) -> dict | None:
        if not os.path.exists(STORE_PATH):
            return None
        with open(STORE_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)

    def save(self, snapshot: dict) -> None:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = STORE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(snapshot, fh, ensure_ascii=False)
        os.replace(tmp, STORE_PATH)


class SupabaseBackend:
    """Keeps the whole store in one jsonb row, reached over PostgREST.

    One row keeps writes atomic and needs no schema migrations as the quiz
    format grows. A local file copy is kept alongside as a cache, so a network
    blip never loses the lesson in progress.
    """

    name = "supabase"

    def __init__(self, url: str, key: str, table: str):
        self.endpoint = f"{url}/rest/v1/{table}"
        self.headers = {
            "apikey": key,
            "authorization": f"Bearer {key}",
            "content-type": "application/json",
        }
        self.mirror = FileBackend()

    def _request(self, method: str, url: str, body=None, extra_headers=None, timeout=20):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method,
                                     headers={**self.headers, **(extra_headers or {})})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw.strip() else None

    def load(self) -> dict | None:
        try:
            rows = self._request("GET", f"{self.endpoint}?id=eq.{STATE_ROW}&select=data")
            if rows:
                return rows[0].get("data") or None
            return None
        except Exception as exc:                                  # noqa: BLE001
            print(f"[quiznova] could not read from Supabase ({exc}); using the local cache",
                  file=sys.stderr, flush=True)
            return self.mirror.load()

    def save(self, snapshot: dict) -> None:
        self.mirror.save(snapshot)          # cache first — never lose the newest copy
        self._request("POST", self.endpoint,
                      body={"id": STATE_ROW, "data": snapshot},
                      extra_headers={"prefer": "resolution=merge-duplicates,return=minimal"})


def make_backend():
    if SUPABASE_URL and SUPABASE_KEY:
        return SupabaseBackend(SUPABASE_URL, SUPABASE_KEY, SUPABASE_TABLE)
    return FileBackend()


BACKEND = make_backend()
_dirty = threading.Event()
_flushed = threading.Event()
_flushed.set()


def _load() -> None:
    global _store
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        data = BACKEND.load()
    except Exception as exc:                                      # noqa: BLE001
        print(f"[quiznova] load failed ({exc}); starting empty", file=sys.stderr, flush=True)
        data = None
    _store = {"quizzes": (data or {}).get("quizzes", {}), "responses": (data or {}).get("responses", {})}
    print(f"[quiznova] storage: {BACKEND.name} · {len(_store['quizzes'])} quizzes loaded",
          file=sys.stderr, flush=True)


def _save() -> None:
    """Mark the store dirty; the writer thread persists it a moment later.

    Called while holding _lock, so it must stay cheap — a network round trip on
    every keystroke of a shared editing session would be felt by everyone.
    """
    _flushed.clear()
    _dirty.set()


def flush_now() -> None:
    """Write the current store out synchronously (shutdown, or an explicit save)."""
    _dirty.clear()
    with _lock:
        snapshot = json.loads(json.dumps(_store))
    try:
        BACKEND.save(snapshot)
    except Exception as exc:                                      # noqa: BLE001
        print(f"[quiznova] save failed: {exc}", file=sys.stderr, flush=True)
    finally:
        _flushed.set()


def _writer_loop() -> None:
    while True:
        _dirty.wait()
        time.sleep(FLUSH_DELAY)      # coalesce a burst of edits into a single write
        flush_now()


def _on_signal(signum, _frame):
    """A sleeping host sends SIGTERM — persist before the lights go out."""
    flush_now()
    sys.exit(0)


_load()
threading.Thread(target=_writer_loop, daemon=True, name="quiznova-writer").start()
atexit.register(flush_now)
for _sig in (signal.SIGTERM, signal.SIGINT):
    try:
        signal.signal(_sig, _on_signal)
    except (ValueError, OSError):
        pass                          # not the main thread (some WSGI servers)


# ─────────────────────────────────────────── realtime ──

def publish(channel: str, event: str, payload: dict) -> None:
    """Fan a message out to every open SSE connection on a channel."""
    msg = {"event": event, "data": payload, "ts": int(time.time() * 1000)}
    with _lock:
        subs = list(_channels.get(channel, []))
    for q in subs:
        try:
            q.put_nowait(msg)
        except queue.Full:
            pass


def subscribe(channel: str) -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=200)
    with _lock:
        _channels.setdefault(channel, []).append(q)
    return q


def unsubscribe(channel: str, q: queue.Queue) -> None:
    with _lock:
        subs = _channels.get(channel)
        if subs and q in subs:
            subs.remove(q)
        if subs is not None and not subs:
            _channels.pop(channel, None)


def sse(channel: str, hello: dict | None = None) -> Response:
    q = subscribe(channel)

    def stream():
        try:
            yield "retry: 2000\n\n"
            if hello is not None:
                yield f"data: {json.dumps({'event': 'hello', 'data': hello})}\n\n"
            last_beat = time.time()
            while True:
                try:
                    msg = q.get(timeout=1.0)
                    yield f"data: {json.dumps(msg)}\n\n"
                except queue.Empty:
                    if time.time() - last_beat > 15:
                        last_beat = time.time()
                        yield ": ping\n\n"
        except GeneratorExit:
            pass
        finally:
            unsubscribe(channel, q)

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─────────────────────────────────────────── helpers ──

def nid(n: int = 10) -> str:
    return uuid.uuid4().hex[:n]


def now_ms() -> int:
    return int(time.time() * 1000)


def new_pin() -> str:
    while True:
        pin = "".join(random.choice(string.digits) for _ in range(6))
        if pin not in _games:
            return pin


def blank_choice(text: str = "", correct: bool = False) -> dict:
    return {"id": nid(6), "text": text, "correct": correct}


def blank_question(kind: str = "mc") -> dict:
    q = {
        "id": nid(8),
        "type": kind,
        "text": "",
        "points": 100,
        "time": 20,
        "explanation": "",
        "image": "",
        "choices": [],
        "answer": "",
    }
    if kind in ("mc", "multi"):
        q["choices"] = [blank_choice(), blank_choice(), blank_choice(), blank_choice()]
        q["choices"][0]["correct"] = True
    elif kind == "tf":
        q["choices"] = [blank_choice("True", True), blank_choice("False")]
    return q


def new_quiz(title: str = "Untitled quiz", owner: str = "Teacher") -> dict:
    return {
        "id": nid(8),
        "title": title or "Untitled quiz",
        "description": "",
        "owner": owner,
        "theme": "aurora",
        "createdAt": now_ms(),
        "updatedAt": now_ms(),
        "version": 1,
        "settings": {
            "shuffleQuestions": False,
            "shuffleChoices": True,
            "showAnswers": True,
            "requireName": True,
            "defaultTime": 20,
            "defaultPoints": 100,
        },
        "questions": [],
    }


def quiz_or_404(qid: str):
    quiz = _store["quizzes"].get(qid)
    if not quiz:
        return None, (jsonify({"error": "Quiz not found"}), 404)
    return quiz, None


def touch(quiz: dict) -> dict:
    quiz["updatedAt"] = now_ms()
    quiz["version"] = quiz.get("version", 0) + 1
    return quiz


def summary(quiz: dict) -> dict:
    return {
        "id": quiz["id"],
        "title": quiz["title"],
        "description": quiz.get("description", ""),
        "questions": len(quiz.get("questions", [])),
        "updatedAt": quiz.get("updatedAt"),
        "theme": quiz.get("theme", "aurora"),
        "responses": len(_store["responses"].get(quiz["id"], [])),
    }


def correct_ids(question: dict) -> set:
    return {c["id"] for c in question.get("choices", []) if c.get("correct")}


def normalise(text) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def grade(question: dict, given) -> bool:
    kind = question.get("type", "mc")
    if kind in ("mc", "tf"):
        return bool(given) and given in correct_ids(question)
    if kind == "multi":
        return bool(given) and set(given) == correct_ids(question) and len(correct_ids(question)) > 0
    if kind == "short":
        accepted = [normalise(a) for a in re.split(r"\s*[|,]\s*", question.get("answer", "")) if normalise(a)]
        return normalise(given) in accepted if accepted else False
    return False


# ─────────────────────────────────────────── quizzes ──

@api.get("/status")
def status():
    """What the server is running on — shown in the hub so persistence is visible."""
    return jsonify({
        "storage": BACKEND.name,
        "durable": BACKEND.name != "file",
        "quizzes": len(_store["quizzes"]),
        "liveGames": len(_games),
        "ai": bool(ai_key()),
    })


@api.get("/modes")
def list_modes():
    """The live game modes, so the pickers stay in step with the server."""
    return jsonify({"modes": [dict(id=key, maps=maps_for(key), **value) for key, value in MODES.items()]})


@api.get("/quizzes")
def list_quizzes():
    with _lock:
        items = [summary(q) for q in _store["quizzes"].values()]
    items.sort(key=lambda q: q["updatedAt"] or 0, reverse=True)
    return jsonify({"quizzes": items})


@api.post("/quizzes")
def create_quiz():
    body = request.get_json(silent=True) or {}
    with _lock:
        quiz = new_quiz(body.get("title", "Untitled quiz"), body.get("owner", "Teacher"))
        if body.get("starter", True):
            quiz["questions"] = [blank_question("mc")]
        _store["quizzes"][quiz["id"]] = quiz
        _save()
    return jsonify(quiz), 201


@api.get("/quizzes/<qid>")
def get_quiz(qid):
    quiz, err = quiz_or_404(qid)
    return err or jsonify(quiz)


@api.delete("/quizzes/<qid>")
def delete_quiz(qid):
    with _lock:
        _store["quizzes"].pop(qid, None)
        _store["responses"].pop(qid, None)
        _save()
    publish(f"quiz:{qid}", "quiz:deleted", {"id": qid})
    return jsonify({"ok": True})


@api.patch("/quizzes/<qid>")
def patch_quiz(qid):
    body = request.get_json(silent=True) or {}
    client = body.get("clientId", "")
    with _lock:
        quiz, err = quiz_or_404(qid)
        if err:
            return err
        for key in ("title", "description", "theme", "owner"):
            if key in body:
                quiz[key] = body[key]
        if "settings" in body and isinstance(body["settings"], dict):
            quiz["settings"].update(body["settings"])
        if "questions" in body and isinstance(body["questions"], list):
            quiz["questions"] = body["questions"]
        touch(quiz)
        _save()
        snapshot = json.loads(json.dumps(quiz))
    publish(f"quiz:{qid}", "quiz:updated", {"quiz": snapshot, "by": client})
    return jsonify(snapshot)


def apply_ops(quiz: dict, ops: list) -> list:
    """Apply a list of edit operations. Returns human readable log lines."""
    log = []
    questions = quiz.setdefault("questions", [])
    index = {q["id"]: q for q in questions}

    for op in ops or []:
        kind = op.get("op")
        if kind == "add_question":
            payload = op.get("question") or {}
            q = blank_question(payload.get("type", "mc"))
            q["text"] = payload.get("text", "")
            q["points"] = int(payload.get("points", quiz["settings"]["defaultPoints"]))
            q["time"] = int(payload.get("time", quiz["settings"]["defaultTime"]))
            q["explanation"] = payload.get("explanation", "")
            q["answer"] = payload.get("answer", "")
            if isinstance(payload.get("choices"), list) and payload["choices"]:
                q["choices"] = [
                    blank_choice(str(c.get("text", "")), bool(c.get("correct")))
                    for c in payload["choices"]
                ]
                if q["type"] == "mc" and not any(c["correct"] for c in q["choices"]):
                    q["choices"][0]["correct"] = True
            at = op.get("at")
            if isinstance(at, int) and 0 <= at <= len(questions):
                questions.insert(at, q)
            else:
                questions.append(q)
            index[q["id"]] = q
            log.append(f"Added: “{(q['text'] or 'new question')[:60]}”")

        elif kind == "delete_question":
            target = op.get("id")
            found = index.get(target)
            if found is None and isinstance(op.get("at"), int) and 0 <= op["at"] < len(questions):
                found = questions[op["at"]]
            if found:
                questions.remove(found)
                index.pop(found["id"], None)
                log.append(f"Deleted: “{(found.get('text') or 'question')[:60]}”")

        elif kind == "update_question":
            found = index.get(op.get("id"))
            if not found and isinstance(op.get("at"), int) and 0 <= op["at"] < len(questions):
                found = questions[op["at"]]
            if found:
                patch = op.get("patch") or {}
                for key in ("text", "explanation", "answer", "image", "type"):
                    if key in patch:
                        found[key] = patch[key]
                for key in ("points", "time"):
                    if key in patch:
                        try:
                            found[key] = int(patch[key])
                        except (TypeError, ValueError):
                            pass
                if isinstance(patch.get("choices"), list):
                    found["choices"] = [
                        blank_choice(str(c.get("text", "")), bool(c.get("correct")))
                        for c in patch["choices"]
                    ]
                log.append(f"Edited: “{(found.get('text') or 'question')[:60]}”")

        elif kind == "reorder":
            order = op.get("ids") or []
            ranked = [index[i] for i in order if i in index]
            ranked += [q for q in questions if q not in ranked]
            quiz["questions"] = ranked
            questions = quiz["questions"]
            log.append("Reordered the questions")

        elif kind == "update_quiz":
            patch = op.get("patch") or {}
            for key in ("title", "description", "theme"):
                if key in patch:
                    quiz[key] = patch[key]
            if isinstance(patch.get("settings"), dict):
                quiz["settings"].update(patch["settings"])
            log.append("Updated the quiz settings")

    return log


@api.post("/quizzes/<qid>/ops")
def quiz_ops(qid):
    body = request.get_json(silent=True) or {}
    with _lock:
        quiz, err = quiz_or_404(qid)
        if err:
            return err
        log = apply_ops(quiz, body.get("ops") or [])
        touch(quiz)
        _save()
        snapshot = json.loads(json.dumps(quiz))
    publish(f"quiz:{qid}", "quiz:updated", {"quiz": snapshot, "by": body.get("clientId", ""), "log": log})
    return jsonify({"quiz": snapshot, "log": log})


@api.post("/quizzes/<qid>/presence")
def quiz_presence(qid):
    body = request.get_json(silent=True) or {}
    client = body.get("clientId") or nid(6)
    with _lock:
        room = _presence.setdefault(qid, {})
        room[client] = {
            "clientId": client,
            "name": body.get("name") or "Someone",
            "colour": body.get("colour") or "#6ea8ff",
            "cursor": body.get("cursor"),
            "ts": now_ms(),
        }
        cutoff = now_ms() - 12000
        for key in [k for k, v in room.items() if v["ts"] < cutoff]:
            room.pop(key, None)
        people = list(room.values())
    publish(f"quiz:{qid}", "presence", {"people": people})
    return jsonify({"people": people})


@api.get("/quizzes/<qid>/events")
def quiz_events(qid):
    quiz = _store["quizzes"].get(qid)
    return sse(f"quiz:{qid}", {"quiz": quiz})


# ─────────────────────────────────── homework / solo ──

@api.post("/quizzes/<qid>/submit")
def submit_quiz(qid):
    body = request.get_json(silent=True) or {}
    with _lock:
        quiz, err = quiz_or_404(qid)
        if err:
            return err
        answers = body.get("answers") or {}
        breakdown, score, total = [], 0, 0
        for question in quiz["questions"]:
            given = answers.get(question["id"])
            ok = grade(question, given)
            total += int(question.get("points", 100))
            if ok:
                score += int(question.get("points", 100))
            breakdown.append({
                "id": question["id"],
                "correct": ok,
                "given": given,
                "expected": sorted(correct_ids(question)) or question.get("answer", ""),
                "explanation": question.get("explanation", ""),
            })
        record = {
            "id": nid(8),
            "name": (body.get("name") or "Anonymous").strip()[:40],
            "at": now_ms(),
            "score": score,
            "total": total,
            "seconds": int(body.get("seconds") or 0),
            "answers": answers,
            "breakdown": breakdown,
        }
        _store["responses"].setdefault(qid, []).append(record)
        _save()
    publish(f"quiz:{qid}", "response:new", {"response": record})
    return jsonify(record), 201


@api.get("/quizzes/<qid>/responses")
def quiz_responses(qid):
    quiz, err = quiz_or_404(qid)
    if err:
        return err
    rows = _store["responses"].get(qid, [])
    per_question = []
    for question in quiz["questions"]:
        got = [r for r in rows if any(b["id"] == question["id"] and b["correct"] for b in r["breakdown"])]
        answered = [r for r in rows if any(b["id"] == question["id"] for b in r["breakdown"])]
        per_question.append({
            "id": question["id"],
            "text": question.get("text", ""),
            "correct": len(got),
            "answered": len(answered),
        })
    return jsonify({"responses": rows, "stats": per_question})


# ────────────────────────────────────────────── AI ──

AI_SYSTEM = """You are the quiz co-pilot inside Quoldek, a classroom quiz builder.
You edit a quiz by returning JSON operations. Never return prose outside the JSON object.

Return exactly this shape:
{"reply": "<one short friendly sentence for the teacher>",
 "ops": [ ...operations... ]}

Allowed operations:
{"op":"add_question","at":<optional index>,"question":{"type":"mc|tf|short|multi","text":"...","choices":[{"text":"...","correct":true}],"answer":"for short answers","points":100,"time":20,"explanation":"..."}}
{"op":"update_question","id":"<question id>","patch":{ same fields as above }}
{"op":"delete_question","id":"<question id>"}
{"op":"reorder","ids":["id","id"]}
{"op":"update_quiz","patch":{"title":"...","description":"...","settings":{"defaultTime":20}}}

Rules:
- Multiple choice questions get exactly 4 choices with exactly one correct.
- true/false questions get exactly the two choices True and False.
- Keep language age appropriate for the class described in the quiz.
- Only touch what the teacher asked for. If nothing should change, return an empty ops list.
- Always write a short explanation for each question you create.
"""

TOPIC_BANK = {
    "math": [
        ("What is 7 x 8?", ["56", "48", "64", "54"], "7 x 8 = 56."),
        ("What is 144 / 12?", ["12", "14", "11", "24"], "12 twelves make 144."),
        ("What is 25% of 80?", ["20", "25", "16", "40"], "25% is a quarter, and a quarter of 80 is 20."),
        ("Which number is prime?", ["17", "21", "27", "33"], "17 has no factors except 1 and itself."),
        ("What is the perimeter of a 5cm by 3cm rectangle?", ["16cm", "15cm", "8cm", "18cm"], "2 x (5 + 3) = 16cm."),
    ],
    "science": [
        ("What gas do plants take in to photosynthesise?", ["Carbon dioxide", "Oxygen", "Nitrogen", "Helium"], "Plants take in carbon dioxide and give out oxygen."),
        ("How many planets are in our solar system?", ["8", "9", "7", "10"], "There are 8 planets since Pluto was reclassified."),
        ("What is the boiling point of water at sea level?", ["100°C", "90°C", "50°C", "120°C"], "Water boils at 100°C at sea level."),
        ("Which organ pumps blood around the body?", ["Heart", "Lungs", "Liver", "Brain"], "The heart pumps blood through the body."),
        ("What force pulls objects towards Earth?", ["Gravity", "Friction", "Magnetism", "Tension"], "Gravity pulls objects toward the centre of the Earth."),
    ],
    "english": [
        ("Which word is a noun?", ["Bicycle", "Quickly", "Bright", "Running"], "A noun names a person, place or thing."),
        ("What is the past tense of 'go'?", ["Went", "Goed", "Gone", "Going"], "The past tense of go is went."),
        ("Which sentence is punctuated correctly?", ["We ate lunch, then we played.", "we ate lunch then we played", "We ate lunch then, we played", "We, ate lunch then we played"], "The comma separates the two clauses correctly."),
        ("What is a synonym for 'happy'?", ["Joyful", "Tired", "Angry", "Cold"], "Joyful means the same as happy."),
        ("Which word is spelled correctly?", ["Necessary", "Neccessary", "Necesary", "Nesessary"], "Necessary has one c and two s letters."),
    ],
    "geography": [
        ("What is the capital of France?", ["Paris", "Lyon", "Marseille", "Nice"], "Paris is the capital of France."),
        ("Which is the longest river in the world?", ["The Nile", "The Amazon", "The Danube", "The Thames"], "The Nile is generally listed as the longest river."),
        ("Which continent is Egypt in?", ["Africa", "Asia", "Europe", "Oceania"], "Egypt is in north east Africa."),
        ("What is the largest ocean?", ["Pacific", "Atlantic", "Indian", "Arctic"], "The Pacific Ocean is the largest."),
        ("Mount Everest sits on the border of Nepal and…", ["China", "India", "Bhutan", "Pakistan"], "Everest sits on the Nepal–China border."),
    ],
    "history": [
        ("In which year did the Second World War end?", ["1945", "1918", "1939", "1950"], "The Second World War ended in 1945."),
        ("Who was the first person on the Moon?", ["Neil Armstrong", "Buzz Aldrin", "Yuri Gagarin", "Michael Collins"], "Neil Armstrong stepped onto the Moon in 1969."),
        ("The Great Fire of London happened in…", ["1666", "1066", "1766", "1566"], "The Great Fire of London was in 1666."),
        ("Who built the pyramids at Giza?", ["The ancient Egyptians", "The Romans", "The Greeks", "The Vikings"], "The ancient Egyptians built them as royal tombs."),
        ("Which empire built Hadrian's Wall?", ["Roman", "Ottoman", "Mongol", "British"], "The Romans built Hadrian's Wall in Britain."),
    ],
}


def ai_key() -> str:
    return os.environ.get("ANTHROPIC_API_KEY", "").strip()


def call_claude(payload: dict) -> dict:
    body = json.dumps({
        "model": os.environ.get("QUIZNOVA_MODEL", "claude-opus-5"),
        "max_tokens": 4000,
        "system": AI_SYSTEM,
        "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "content-type": "application/json",
            "x-api-key": ai_key(),
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = "".join(part.get("text", "") for part in data.get("content", []) if part.get("type") == "text")
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError("The assistant did not return JSON")
    return json.loads(match.group(0))


def offline_brain(prompt: str, quiz: dict) -> dict:
    """A capable rule based fallback so the AI panel still works with no API key."""
    text = prompt.lower()
    count = 5
    # "add 4 questions", "4 more science questions", "write ten true/false questions"
    words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
             "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "twenty": 20}
    found = re.search(r"(\d+)(?=[^.]*\bquestion)", text) or re.search(r"^\D*(\d+)", text)
    if found:
        count = max(1, min(20, int(found.group(1))))
    else:
        for word, value in words.items():
            if re.search(rf"\b{word}\b[^.]*\bquestion", text):
                count = value
                break

    topic = None
    for key in TOPIC_BANK:
        if key in text:
            topic = key
    if topic is None:
        for key, hint in (("math", "maths"), ("english", "grammar"), ("science", "biology"),
                          ("geography", "capital"), ("history", "war")):
            if hint in text:
                topic = key
    if topic is None:
        blob = (quiz.get("title", "") + " " + quiz.get("description", "")).lower()
        topic = next((k for k in TOPIC_BANK if k in blob), "science")

    if any(word in text for word in ("delete", "remove", "clear")):
        if "all" in text or "every" in text:
            ops = [{"op": "delete_question", "id": q["id"]} for q in quiz.get("questions", [])]
            return {"reply": f"Cleared all {len(ops)} questions.", "ops": ops}
        wanted = quiz.get("questions", [])[-count:]
        ops = [{"op": "delete_question", "id": q["id"]} for q in wanted]
        return {"reply": f"Removed the last {len(ops)} question(s).", "ops": ops}

    if "harder" in text or "difficult" in text:
        ops = [{"op": "update_question", "id": q["id"], "patch": {"time": max(8, int(q.get("time", 20)) - 5),
                                                                 "points": int(q.get("points", 100)) + 50}}
               for q in quiz.get("questions", [])]
        return {"reply": "Tightened the timers and raised the points to make it harder.", "ops": ops}

    if "easier" in text or "simpler" in text:
        ops = [{"op": "update_question", "id": q["id"], "patch": {"time": int(q.get("time", 20)) + 10}}
               for q in quiz.get("questions", [])]
        return {"reply": "Gave every question 10 extra seconds.", "ops": ops}

    if "title" in text or "rename" in text:
        new_title = prompt.split(":")[-1].strip().strip('"') or f"{topic.title()} quiz"
        return {"reply": f"Renamed the quiz to “{new_title}”.", "ops": [{"op": "update_quiz", "patch": {"title": new_title}}]}

    bank = TOPIC_BANK[topic][:]
    random.shuffle(bank)
    ops = []
    for i in range(count):
        stem, options, why = bank[i % len(bank)]
        shuffled = options[:]
        random.shuffle(shuffled)
        ops.append({
            "op": "add_question",
            "question": {
                "type": "mc",
                "text": stem,
                "choices": [{"text": opt, "correct": opt == options[0]} for opt in shuffled],
                "points": 100,
                "time": 20,
                "explanation": why,
            },
        })
    return {"reply": f"Added {count} {topic} question(s) for you.", "ops": ops}


@api.get("/ai/status")
def ai_status():
    return jsonify({"live": bool(ai_key()), "model": os.environ.get("QUIZNOVA_MODEL", "claude-opus-5")})


@api.post("/ai")
def ai_edit():
    body = request.get_json(silent=True) or {}
    prompt = (body.get("prompt") or "").strip()
    permission = body.get("permission", "ask")   # ask | auto | read
    qid = body.get("quizId")
    if not prompt:
        return jsonify({"error": "Say what you would like changed."}), 400

    with _lock:
        quiz, err = quiz_or_404(qid)
        if err:
            return err
        context = {
            "instruction": prompt,
            "quiz": {
                "title": quiz["title"],
                "description": quiz.get("description", ""),
                "settings": quiz["settings"],
                "questions": [
                    {"id": q["id"], "type": q["type"], "text": q["text"],
                     "choices": [{"text": c["text"], "correct": c["correct"]} for c in q.get("choices", [])],
                     "answer": q.get("answer", ""), "points": q.get("points"), "time": q.get("time")}
                    for q in quiz["questions"]
                ],
            },
        }

    source = "claude"
    try:
        if ai_key():
            result = call_claude(context)
        else:
            source, result = "offline", offline_brain(prompt, context["quiz"])
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, json.JSONDecodeError, TimeoutError) as exc:
        source = "offline"
        result = offline_brain(prompt, context["quiz"])
        result["reply"] += f"  (Working offline: {type(exc).__name__})"

    ops = result.get("ops") or []
    reply = result.get("reply") or "Here is what I suggest."

    if permission == "read":
        return jsonify({"reply": reply, "ops": [], "applied": False, "source": source,
                        "note": "Read only mode — I did not change anything."})

    if permission == "auto" and ops:
        with _lock:
            quiz, err = quiz_or_404(qid)
            if err:
                return err
            log = apply_ops(quiz, ops)
            touch(quiz)
            _save()
            snapshot = json.loads(json.dumps(quiz))
        publish(f"quiz:{qid}", "quiz:updated", {"quiz": snapshot, "by": "ai", "log": log})
        return jsonify({"reply": reply, "ops": ops, "applied": True, "log": log,
                        "quiz": snapshot, "source": source})

    return jsonify({"reply": reply, "ops": ops, "applied": False, "source": source})


# ─────────────────────────────────────── live games ──

TEAM_HP_FLOOR = 400          # smallest a team's shield pool can be
TEAM_HP_PER_PLAYER = 250     # …and how much each player adds to it
MAX_PLAYER_HIT = 40          # damage cap on any one player, so nobody is out in one shot

# ── live game modes ──────────────────────────────────────────
#
# Every mode scores into player["score"], so the leaderboard, podium and
# results screens work unchanged; a mode adds its own extra state on top.

MODES = {
    # The plain one. Every other mode is a game with a quiz inside it; this is
    # the quiz, and sometimes that is what a lesson wants — a starter, a recap,
    # five minutes before the bell.
    "normal":   {"label": "Classic Quiz", "icon": "play", "teams": False,
                 "blurb": "Straight questions on the board. Answer fast — the quicker "
                          "you are, the more it is worth"},
    "laser":    {"label": "Laser Tag",   "icon": "laser", "teams": True,
                 "blurb": "Push up, take aim or take cover. One arena, two teams"},
    "tower":    {"label": "Tallest Tower", "icon": "bricks", "teams": 3,
                 "blurb": "Three teams, one race up. Answer to earn a block, then time "
                          "the drop — the neater you place it, the faster you climb"},
    "boss":     {"label": "Boss Battle", "icon": "dragon", "teams": False,
                 "blurb": "Answer to arm yourself, then ten seconds to cut it down"},
    "robot":    {"label": "Robot Run", "icon": "dragon", "teams": False,
                 "blurb": "The whole class outruns the robot together. Answer, earn a boost, hold to use it"},
}

# Each game is played on a map the teacher picks. A map is scenery and a palette:
# it changes what the board looks like, not how the scoring works.
MAPS = {
    "normal":   [("classic", "Classic"), ("chalk", "Chalkboard"), ("sunset", "Sunset")],
    "laser":    [("arena", "Neon Arena"), ("bunker", "Bunker"), ("moon", "Moon Base")],
    "tower":    [("site", "Building Site"), ("candy", "Candy Land"), ("castle", "Castle Walls")],
    "boss":     [("lair", "Dragon Lair"), ("volcano", "Volcano"), ("ruins", "Old Ruins")],
    "robot":    [("station", "The Space Station"), ("reactor", "Reactor Deck"),
                 ("hangar", "The Hangar")],
}


# How a game finishes. Playing every question is the default, but a class with
# ten minutes left before lunch wants the clock to decide, and a race to a score
# plays quite differently — it is over the moment somebody gets there, whether
# that is question four or question forty.
GOALS = {
    "questions": {"label": "All the questions", "values": []},
    "points": {"label": "First to a score", "values": [250, 500, 1000, 2000]},
    "time": {"label": "A time limit", "values": [3, 5, 10, 15, 20]},   # minutes
}


def read_goal(goal):
    goal = goal if isinstance(goal, dict) else {}
    kind = goal.get("kind") if goal.get("kind") in GOALS else "questions"
    if kind == "questions":
        return {"kind": kind, "value": 0}
    allowed = GOALS[kind]["values"]
    try:
        value = int(goal.get("value"))
    except (TypeError, ValueError):
        value = None
    return {"kind": kind, "value": value if value in allowed else allowed[1]}


def goal_reached(game):
    """Has the game reached whatever the teacher said would end it?"""
    goal = game.get("goal") or {"kind": "questions"}
    if goal["kind"] == "points":
        return any(p.get("score", 0) >= goal["value"] for p in game["players"].values())
    if goal["kind"] == "time":
        started = game.get("startedAt")
        return bool(started) and now_ms() >= started + goal["value"] * 60_000
    return False


def mode_finished(game):
    """Some games end themselves before the questions run out: a fort falls, a
    boss dies, a rope crosses the line, somebody completes the set. Mirrors
    mode_finished in static/rules.js."""
    mode = game.get("mode")
    if mode == "boss":
        boss = game.get("boss")
        return bool(boss) and (boss["hp"] == 0 or boss["classHp"] == 0)
    return False


def maps_for(mode):
    return [{"id": i, "label": label} for i, label in MAPS.get(mode, MAPS[DEFAULT_MODE])]


# What the teacher can change before the game starts. The quiz says how long a
# question is and what it is worth; a live game may want something else — a fast
# five minutes before lunch, or a slow round with a class who need thinking time
# — without editing the quiz for everyone who plays it afterwards. Mirrors
# static/rules.js; the test suite compares the two.
SETUP = {
    "seconds": {"label": "Seconds a question", "values": [0, 10, 15, 20, 30, 45, 60]},
    "points": {"label": "Points a question", "values": [0, 50, 100, 200, 500]},
    "streaks": {"label": "Bonus for a run of right answers", "on": True},
    "shuffle": {"label": "Questions in a new order every game", "on": False},
    "mix": {"label": "Answers in a new order too", "on": False},
    "lateJoin": {"label": "Let people join after it starts", "on": True},
    "doubleLast": {"label": "Last question is worth double", "on": False},
}


def read_setup(raw):
    given = raw if isinstance(raw, dict) else {}
    setup = {}
    for key, spec in SETUP.items():
        if "values" in spec:
            try:
                value = int(given.get(key))
            except (TypeError, ValueError):
                value = None
            setup[key] = value if value in spec["values"] else spec["values"][0]
        else:
            setup[key] = spec["on"] if given.get(key) is None else bool(given.get(key))
    return setup


def seconds_for(game, question):
    """How long this question runs for, in seconds."""
    chosen = (game.get("setup") or {}).get("seconds")
    return chosen or (question or {}).get("time") or 20


def points_for(game, question):
    """What this question is worth, before speed and streaks."""
    setup = game.get("setup") or {}
    base = setup.get("points") or (question or {}).get("points") or 100
    if setup.get("doubleLast") and game.get("index") == len(game.get("questions") or []) - 1:
        base *= 2
    return base


def streak_bonus(game, player):
    if (game.get("setup") or {}).get("streaks") is False:
        return 1
    return 1 + min(player.get("streak", 0), 5) * 0.1


def arrange(questions, setup):
    """Questions in a new order, and the answers within them, if asked for."""
    out = list(questions)
    if setup.get("shuffle"):
        random.shuffle(out)
    if setup.get("mix"):
        mixed = []
        for q in out:
            choices = q.get("choices") or []
            if len(choices) > 1:
                q = dict(q)
                q["choices"] = random.sample(choices, len(choices))
            mixed.append(q)
        out = mixed
    return out


ARENA_SECONDS = 20         # a full energy bar, in the Laser Tag arena
# ── Boss Battle ──
# One three-minute fight, nobody in step. A right answer loads a knife, the
# knife takes one health off, and then it needs two seconds. Mirrors the block
# in static/rules.js.
BOSS_HP = 30
BOSS_MS = 3 * 60 * 1000
KNIFE_RELOAD_MS = 2000
KNIFE_DAMAGE = 1

BOSS_HP_PER_QUESTION = 55   # kept: older saved games still hold it    # scales the boss to the length of the quiz

# Volcano Climb: how far one very fast right answer gets you, the least the lava
# rises in a round, and how much of the room's average it adds on top — so a
# class that is doing well gets a harder game. Mirrors static/rules.js.


# Characters are numbers drawn by sprites.js in the browser: 12 colours x 12
# silhouettes. One is handed out per game so no two children in the same room
# look alike, and it is stored with the player so it never changes.
FACE_COLOURS = 12          # must match the palette in static/sprites.js
FACE_SHAPES = 12
FACE_COMBINATIONS = FACE_COLOURS * FACE_SHAPES
# A character also carries eyes, a mouth and markings, packed into the same
# number above the colour and shape. Those are nobody else's business, so only
# the colour and the shape have to be unique — they are what tells two players
# apart across a room. Taking the number modulo the pair drops the rest.
FACE_ALL = FACE_COMBINATIONS * 6 * 6 * 4


def looks_like(index):
    """The colour-and-shape half of a character, which is the half that must differ."""
    try:
        return int(index) % FACE_COMBINATIONS
    except (TypeError, ValueError):
        return -1


def free_face(taken):
    """The first character nobody in this game has.

    Stepping by 13 through 144 visits every colour/shape pair once, so the first
    children to join differ in both rather than sharing one silhouette.
    """
    used = {looks_like(t) for t in taken}
    for k in range(FACE_COMBINATIONS):
        candidate = k * 13 % FACE_COMBINATIONS
        if candidate not in used:
            return str(candidate)
    return str(random.randrange(FACE_COMBINATIONS))


def wanted_face(wanted, taken):
    """The character a child asked for, or the closest one still free.

    Two children with the same colour and silhouette cannot be told apart across
    a classroom, which is the whole reason the characters exist. So a choice is
    honoured when it is free, and otherwise the colour is kept and the silhouette
    steps on until one is going spare.
    """
    try:
        n = int(wanted)
    except (TypeError, ValueError):
        return free_face(taken)
    if n < 0:
        return free_face(taken)
    n %= FACE_ALL
    used = {looks_like(t) for t in taken}
    colour, shape = n % FACE_COLOURS, n // FACE_COLOURS % FACE_SHAPES
    rest = n // FACE_COMBINATIONS * FACE_COMBINATIONS      # eyes, mouth and markings, kept as chosen
    for step in range(FACE_SHAPES):
        pair = (shape + step) % FACE_SHAPES * FACE_COLOURS + colour
        if pair not in used:
            return str(rest + pair)
    return free_face(taken)

def public_game(game: dict, include_answers: bool = False) -> dict:
    quiz = _store["quizzes"].get(game["quizId"], {})
    questions = game.get("questions", [])
    idx = game["index"]
    current = None
    if 0 <= idx < len(questions) and game["state"] in ("question", "reveal"):
        q = questions[idx]
        current = {
            "id": q["id"],
            "type": q["type"],
            "text": q["text"],
            "image": q.get("image", ""),
            "points": q.get("points", 100),
            # the length the teacher chose for this game, not the one the quiz
            # was written with, so every screen counts down the same number
            "time": seconds_for(game, q),
            "choices": [{"id": c["id"], "text": c["text"],
                         **({"correct": c["correct"]} if (include_answers or game["state"] == "reveal") else {})}
                        for c in q.get("choices", [])],
        }
        if include_answers or game["state"] == "reveal":
            current["explanation"] = q.get("explanation", "")
            current["answer"] = q.get("answer", "")
    players = sorted(game["players"].values(), key=lambda p: -p["score"])
    return {
        "pin": game["pin"],
        "mode": game["mode"],
        "map": game.get("map") or maps_for(game["mode"])[0]["id"],
        # Laser Tag asks each child their own questions as their bar empties, so
        # their phone needs the set. A child who digs into the page can read the
        # answers; that is true of every game built this way.
        "quiz": game["questions"] if game["mode"] == "laser" and game["state"] == "arena" else None,
        "state": game["state"],
        "index": idx,
        "total": len(questions),
        "quizTitle": quiz.get("title", "Quiz"),
        "quizId": game["quizId"],
        "question": current,
        "endsAt": game.get("endsAt"),
        "serverNow": now_ms(),
        "players": [{k: p.get(k) for k in ("id", "name", "avatar", "team", "score", "hp", "streak",
                                           "answered", "correct", "down", "lastDamage",
                                           "blocks", "ready", "placed", "boosts", "safe", "zone", "lastGain",
                                           "loaded", "hits", "swungAt",
                                           "blade", "struck", "move", "on")}
                    for p in players],
        "teams": game["teams"],
        "boss": game.get("boss"),
        "goal": game.get("goal") or {"kind": "questions", "value": 0},
        "setup": game.get("setup"),
        "rope": game.get("rope", 0),
        "lava": game.get("lava", 0),
        # the world's own state, and the moves this mode offers. Without these
        # the wind and the shoal are things that happen to the scores with
        # nothing on screen to explain them.
        "shoal": game.get("shoal", ""),
        "wind": bool(game.get("wind")),
        # Boss Battle's fight: the script every device runs, and how long it runs
        "strikeSeed": game.get("strikeSeed", 0),
        "strikeMs": 10000,
        "moves": moves_for(game.get("mode")),
        "moveAsk": (MOVES.get(game.get("mode")) or {}).get("ask", ""),
        "startedAt": game.get("startedAt", 0),
        "music": game.get("music") is not False,
        "towers": game.get("towers"),
        "towerSlots": SLOTS,
        "monsterAt": game.get("monsterAt", 0),
        "modeInfo": MODES.get(game["mode"], MODES[DEFAULT_MODE]),
        "counts": game.get("counts", {}),
        "lastEvents": game.get("lastEvents", []),
    }


def broadcast_game(game: dict) -> None:
    publish(f"game:{game['pin']}", "game:state", public_game(game))


GAME_TTL_MS = 12 * 60 * 60 * 1000     # live games are memory only — drop stale ones


def sweep_games() -> None:
    cutoff = now_ms() - GAME_TTL_MS
    for pin in [p for p, g in _games.items() if g["createdAt"] < cutoff]:
        _games.pop(pin, None)


@api.post("/games")
def create_game():
    body = request.get_json(silent=True) or {}
    with _lock:
        sweep_games()
        quiz, err = quiz_or_404(body.get("quizId"))
        if err:
            return err
        if not quiz["questions"]:
            return jsonify({"error": "Add at least one question first."}), 400
        # the quiz's own shuffle setting is the starting point; what the teacher
        # picked on the way into this game wins over it
        wanted = {"shuffle": bool(quiz["settings"].get("shuffleQuestions"))}
        wanted.update(body.get("setup") or {})
        setup = read_setup(wanted)
        questions = arrange(json.loads(json.dumps(quiz["questions"])), setup)
        game = {
            "pin": new_pin(),
            "hostToken": nid(16),
            "quizId": quiz["id"],
            "mode": body.get("mode") if body.get("mode") in MODES else DEFAULT_MODE,
            "state": "lobby",
            "index": -1,
            "questions": questions,
            "players": {},
            "teams": {"red": {"hp": 0, "score": 0, "blocks": 0, "max": 0, "name": "Crimson"},
                      "blue": {"hp": 0, "score": 0, "blocks": 0, "max": 0, "name": "Cobalt"}},
            "goal": read_goal(body.get("goal")),
            "setup": setup,
            "music": body.get("music") is not False,
            "startedAt": 0,
            "counts": {},
            "lastEvents": [],
            "createdAt": now_ms(),
        }
        allowed = [m["id"] for m in maps_for(game["mode"])]
        game["map"] = body.get("map") if body.get("map") in allowed else allowed[0]
        _games[game["pin"]] = game
    return jsonify({"pin": game["pin"], "hostToken": game["hostToken"], "mode": game["mode"],
                    "quizTitle": quiz["title"], "total": len(questions)}), 201


def game_or_404(pin):
    game = _games.get(pin)
    if not game:
        return None, (jsonify({"error": "That game code is not live."}), 404)
    return game, None


@api.get("/games/<pin>")
def get_game(pin):
    game, err = game_or_404(pin)
    return err or jsonify(public_game(game))


@api.get("/games/<pin>/events")
def game_events(pin):
    game = _games.get(pin)
    return sse(f"game:{pin}", public_game(game) if game else {"error": "gone"})


@api.post("/games/<pin>/join")
def join_game(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        if game["state"] not in ("lobby", "question", "reveal"):
            return jsonify({"error": "This game has finished."}), 400
        if game["state"] != "lobby" and (game.get("setup") or {}).get("lateJoin") is False:
            return jsonify({"error": "This game has already started."}), 400
        name = (body.get("name") or "Player").strip()[:16] or "Player"
        # Tallest Tower splits the room three ways rather than two, because that
        # is what it is: three towers racing. Whichever side is smallest gets the
        # next child, so the teams stay level however late people arrive.
        sides = TOWER_TEAMS if game["mode"] == "tower" else ["red", "blue"]
        counts = [sum(1 for p in game["players"].values() if p["team"] == t)
                  for t in sides]
        player = {
            "id": nid(10),
            "name": name,
            "avatar": wanted_face(body.get("avatar"),
                                  [p.get("avatar") for p in game["players"].values()]),
            "team": sides[counts.index(min(counts))],
            "score": 0,
            "hp": 100,
            "streak": 0,
            "best": 0,
            "answered": False,
            "correct": None,
            "down": False,
            "lastDamage": 0,
            "blocks": 0,        # tower build
            "boosts": 0,        # robot run: what they have put in
            "ready": 0,
            "safe": True,
            "target": "",       # laser tag: who they lined up
            "lastGain": 0,
            # the move, and whatever it is aimed at
            "move": "",
            "on": "",
            "job": None,
            # per-mode workings the moves need
            "ready": 0, "placed": 0, "loaded": 0, "hits": 0, "swungAt": 0, "zone": "",
            "item": False, "run": 0, "rocks": False,
            "tuned": 0, "stopped": False, "guarding": False, "acted": "",
            "shielded": False, "exposed": False, "offer": "",
            "answers": {},
        }
        game["players"][player["id"]] = player
    broadcast_game(game)
    return jsonify({"player": player, "game": public_game(game)}), 201


@api.post("/games/<pin>/place")
def game_place(pin):
    """Tallest Tower: one block, placed.

    The offset is where the tap landed and it is kept on the block, so a hurried
    drop is visible on the board for the rest of the game. Counted by sequence
    number so a phone that reconnects and repeats itself cannot build a floor on
    its own. Mirrors the '/place' branch in static/live.js.
    """
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        player = game["players"].get(body.get("playerId"))
        if not player:
            return jsonify({"error": "Not in this game."}), 404
        if game["mode"] != "tower":
            return jsonify({"ok": False, "why": "Not that kind of game."})
        if player.get("ready", 0) <= 0:
            return jsonify({"ok": False, "why": "No block to place."})
        out = place_block(game, player, body.get("offset"), body.get("seq"))
        if not out.get("already"):
            player["ready"] = max(0, player.get("ready", 0) - 1)
        game["lastEvents"] = game["lastEvents"][-6:]
        broadcast_game(game)
        return jsonify(out)


@api.post("/games/<pin>/score")
def save_score(pin):
    """Laser Tag: a phone reports the score it has earned in the arena."""
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        player = game["players"].get(body.get("playerId"))
        if not player:
            return jsonify({"error": "Unknown player"}), 404
        player["score"] = max(0, int(body.get("score") or 0))
        broadcast_game(game)
        return jsonify({"ok": True})


@api.post("/games/<pin>/target")
def choose_target(pin):
    """Laser Tag: during the countdown, pick who this shot is aimed at."""
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        player = game["players"].get(body.get("playerId"))
        if not player:
            return jsonify({"error": "Unknown player"}), 404
        if game["state"] != "aim":
            return jsonify({"error": "The shooting round is over."}), 400
        target = game["players"].get(body.get("targetId"))
        if not target or target["team"] == player["team"]:
            return jsonify({"error": "Pick someone on the other team."}), 400
        player["target"] = target["id"]
        broadcast_game(game)
        return jsonify({"target": player["target"]})


@api.post("/games/<pin>/team")
def switch_team(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        player = game["players"].get(body.get("playerId"))
        if not player:
            return jsonify({"error": "Unknown player"}), 404
        if game["state"] != "lobby":
            return jsonify({"error": "Teams lock once the match starts."}), 400
        player["team"] = "blue" if player["team"] == "red" else "red"
    broadcast_game(game)
    return jsonify({"team": player["team"]})


def host_check(game, body):
    return body.get("hostToken") == game["hostToken"]


def begin_question(game: dict) -> None:
    """Open the question itself and start its clock."""
    question = game["questions"][game["index"]]
    game["state"] = "question"
    game["endsAt"] = now_ms() + int(seconds_for(game, question)) * 1000 + 700


def open_question(game: dict) -> None:
    """Start the next round."""
    game["index"] += 1
    game["counts"] = {}
    game["lastEvents"] = []
    if game["index"] >= len(game["questions"]):
        game["state"] = "over"
        game["endsAt"] = None
        return
    for player in game["players"].values():
        player["answered"] = False
        player["correct"] = None
        player["lastDamage"] = 0
        player["lastGain"] = 0
        player["chest"] = ""
        # the move stands until it is changed: not touching your phone is a
        # choice to do the same again, and it is the one a busy child makes
        if not player.get("move"):
            player["move"] = default_move(game["mode"])
    begin_question(game)


@api.post("/games/<pin>/start")
def start_game(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        if not host_check(game, body):
            return jsonify({"error": "Only the host can start the game."}), 403
        if game["mode"] == "laser":
            for team in ("red", "blue"):
                members = [p for p in game["players"].values() if p["team"] == team]
                # Enough HP that a match lasts several questions even with a small class.
                game["teams"][team]["hp"] = max(TEAM_HP_FLOOR, TEAM_HP_PER_PLAYER * len(members))
        game["startedAt"] = now_ms()
        if game["mode"] == "tower":
            game["wind"] = False
        # everybody starts on the safe move rather than on nothing
        for p in game["players"].values():
            p["move"] = default_move(game["mode"])
        if game["mode"] == "boss":
            total = max(1, len(game["questions"]))
            game["boss"] = {"hp": BOSS_HP_PER_QUESTION * total, "max": BOSS_HP_PER_QUESTION * total,
                            "name": pick_boss_name(), "classHp": 100, "classMax": 100,
                            "next": "poke", "says": "is sizing the class up"}
        if game["mode"] == "laser":
            # one long round: the arena runs until the teacher stops it, and each
            # child's own energy bar decides when they break off to answer
            game["state"] = "arena"
            game["index"] = 0
            game["endsAt"] = None
        else:
            open_question(game)
    broadcast_game(game)
    return jsonify(public_game(game))


@api.post("/games/<pin>/next")
def next_question(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        if not host_check(game, body):
            return jsonify({"error": "Only the host can advance the game."}), 403
        if game["state"] == "question":
            game["state"] = "reveal"
            game["endsAt"] = None
        else:
            open_question(game)
    broadcast_game(game)
    return jsonify(public_game(game))


# When a mode is not recognised — an old saved game naming one of the ten that
# were removed, or a typo in a request — this is what it becomes. Tower Build,
# because it asks least of a room: no teams, no coordination, any class size.
DEFAULT_MODE = "normal"


def pick_boss_name():
    return random.choice(["Professor Puzzle", "The Grumbling Grammarian", "Baron Blunder",
                          "Countess Confusion", "The Number Nibbler", "Sir Slipsalot"])


# ── the move: what turns a quiz into a game ──────────────────────────────
#
# Every mode used to score the same way. Strip the words off and it was
# score = f(right?, how fast), fourteen times over, with different nouns
# painted on the front. The only real decisions in the whole game were a laser
# target, a fishing spot and a factory machine; everywhere else a decision
# might have gone there was a random.random(), which is not a game.
#
# A player now picks a MOVE each round, on their phone, while the question is
# up. The answer decides whether the move works; the move decides what happens
# when it does. Mirrors MOVES in static/rules.js, which is the original — this
# file is the Flask edition's copy and the two must not drift.
MOVES = {
    "laser": {"ask": "How are you playing this one?", "list": [
        {"id": "aim", "label": "Take aim", "note": "Normal shot at whoever you picked"},
        {"id": "push", "label": "Push up", "note": "Hit twice as hard, and take twice as much back"},
        {"id": "cover", "label": "Take cover", "note": "Half a shot, and you shield whoever is weakest"}]},
    # Tallest Tower has no move to pick either: the decision is when you drop
    # the block, and a menu in front of that would be a menu in front of the game.
    # Monster Run has no move to pick: it is played in real time, at each
    # child's own pace, and a menu would get in the way of the next question.
}


# ── Tallest Tower ──
# Mirrors the block in static/rules.js. The room is split into three teams, a
# right answer earns a block, and placing it is a timed tap: where it lands is
# kept on the block so the tower is drawn as it was actually built.
# ── Robot Run: the safe zones between decks ──
# Mirrors the block in static/rules.js. The zones come from the deck number
# alone, so every phone and the board draw the same ones without anybody having
# to send them; there are fewer and smaller ones each deck.
SAFE_MS = 15000
FIELD_W, FIELD_H = 1000, 700


def safe_zones(round_no, heads):
    deck = max(1, int(round_no or 1))
    people = max(1, int(heads or 1))
    count = max(2, 5 - (deck - 1) // 2)
    cap = max(1, -(-people // count))       # just enough room, and no more
    r = max(70, 140 - (deck - 1) * 12)
    out = []
    for i in range(count):
        a = (i / count) * math.pi * 2 + deck * 0.7
        out.append({"id": f"z{i}",
                    "x": round(FIELD_W / 2 + math.cos(a) * FIELD_W * 0.31),
                    "y": round(FIELD_H / 2 + math.sin(a) * FIELD_H * 0.31),
                    "r": r, "cap": cap})
    return out


def zone_counts(game):
    counts = {}
    for p in game.get("players", {}).values():
        if p.get("zone"):
            counts[p["zone"]] = counts.get(p["zone"], 0) + 1
    return counts


def claim_zone(game, player, zone_id):
    zones = safe_zones(game.get("round", 1), len(game.get("players", {})))
    zone = next((z for z in zones if z["id"] == zone_id), None)
    if not zone:
        return {"ok": False, "why": "No such zone."}
    if player.get("zone") == zone["id"]:
        return {"ok": True, "zone": zone["id"], "already": True}
    if zone_counts(game).get(zone["id"], 0) >= zone["cap"]:
        return {"ok": False, "why": "That one is full.", "full": True}
    player["zone"] = zone["id"]
    return {"ok": True, "zone": zone["id"]}


def settle_safe(game):
    everyone = list(game.get("players", {}).values())
    adrift = [p for p in everyone if not p.get("zone")]
    if adrift:
        game["lives"] = max(0, game.get("lives", 3) - 1)
        game["lastEvents"].append(
            f"{adrift[0]['name']} did not make it — a life gone" if len(adrift) == 1
            else f"{len(adrift)} did not make it — a life gone")
    else:
        game["lastEvents"].append("Everybody made it")
    for p in everyone:
        p["zone"] = ""
    return len(adrift)


TOWER_TEAMS = ["red", "blue", "green"]
TOWER_NAMES = {"red": "Crimson", "blue": "Cobalt", "green": "Clover"}
SLOTS = 4            # blocks in one finished floor
PERFECT = 0.09       # how square a drop has to be to count as neat
GIFT_EVERY = 5       # a gift box waits at every fifth floor
GIFT_BLOCKS = 3
MONSTER_EVERY = 38000   # how often the monster comes, in milliseconds
MONSTER_FLOOR = 3       # and the shortest tower it will bother with


def blank_tower():
    return {"blocks": [], "gift": 0, "crushed": 0}


def floors_of(tower):
    return len(tower["blocks"]) // SLOTS


def towers_of(game):
    game.setdefault("towers", {})
    for t in TOWER_TEAMS:
        game["towers"].setdefault(t, blank_tower())
    return game["towers"]


def place_block(game, player, offset, seq):
    """One block, placed. Mirrors placeBlock in static/rules.js."""
    towers = towers_of(game)
    team = player.get("team") if player.get("team") in TOWER_TEAMS else TOWER_TEAMS[0]
    tower = towers[team]
    want = max(0, round(float(seq or 0)))
    if want <= player.get("placed", 0):
        return {"ok": True, "already": True}
    player["placed"] = min(want, player.get("placed", 0) + 1)

    o = max(-1.0, min(1.0, float(offset or 0)))
    neat = abs(o) <= PERFECT
    tower["blocks"].append({"o": o, "by": player["name"], "neat": neat})
    player["blocks"] = player.get("blocks", 0) + 1
    if neat:
        tower["blocks"].append({"o": -o * 0.4, "by": player["name"],
                                "neat": True, "bonus": True})
        player["blocks"] += 1
        game["lastEvents"].append(f"{player['name']} dropped that one square — two blocks")
    player["score"] = player["blocks"]
    if len(tower["blocks"]) > 400:
        tower["blocks"] = tower["blocks"][-400:]

    floors = floors_of(tower)
    while floors >= (tower["gift"] + 1) * GIFT_EVERY:
        tower["gift"] += 1
        for _ in range(GIFT_BLOCKS):
            tower["blocks"].append({"o": (random.random() - 0.5) * 0.3,
                                    "by": "the gift box", "gift": True})
        game["lastEvents"].append(
            f"{TOWER_NAMES[team]} reached the gift box — three free blocks")
    return {"ok": True, "floors": floors_of(tower),
            "blocks": len(tower["blocks"]), "neat": neat}


def tower_monster(game):
    """It comes for whoever is winning, which is the only fair thing for it to
    do: a mode where the team that got ahead first stays ahead is a mode the
    other twenty children stop playing. Mirrors towerMonster in rules.js."""
    towers = towers_of(game)
    ranked = sorted(((t, floors_of(towers[t])) for t in TOWER_TEAMS),
                    key=lambda r: -r[1])
    if not ranked or ranked[0][1] < MONSTER_FLOOR:
        return None
    team = ranked[0][0]
    tower = towers[team]
    tower["blocks"] = tower["blocks"][:max(0, len(tower["blocks"]) - SLOTS)]
    tower["crushed"] += 1
    game["lastEvents"].append(f"The monster took a floor off {TOWER_NAMES[team]}")
    return team


def moves_for(mode):
    return (MOVES.get(mode) or {}).get("list", [])


def default_move(mode):
    listed = moves_for(mode)
    return listed[0]["id"] if listed else ""


def move_of(game, player):
    """The move this player chose, falling back to the safe one."""
    listed = moves_for(game.get("mode"))
    if not listed:
        return ""
    want = player.get("move")
    return want if any(m["id"] == want for m in listed) else listed[0]["id"]


def choose_move(game, player, move_id, on=""):
    """Record a choice, if it is one this mode offers."""
    spec = next((m for m in moves_for(game.get("mode")) if m["id"] == move_id), None)
    if not spec:
        return {"ok": False, "why": "Not a move in this game."}
    needs = spec.get("needs")
    if needs == "player":
        who = game["players"].get(on)
        if not who or who["id"] == player["id"]:
            return {"ok": False, "why": "Pick somebody else first."}
        player["on"] = on
    elif needs == "card":
        if on not in CARD_SET:
            return {"ok": False, "why": "Pick a card first."}
        player["on"] = on
    else:
        player["on"] = ""
    player["move"] = move_id
    return {"ok": True, "move": move_id, "on": player["on"]}


def score_laser(game, player, question, ok, speed):
    """Push, aim or cover. Pushing up is the only way through a team that all
    took cover, and it is also how you get knocked out."""
    move = move_of(game, player)
    foe = "blue" if player["team"] == "red" else "red"
    mates = list(game["players"].values())
    player["exposed"] = move == "push"
    if ok and not player["down"]:
        if move == "cover":
            weakest = min((x for x in mates if x["team"] == player["team"] and not x["down"]),
                          key=lambda x: x["hp"], default=None)
            if weakest:
                weakest["shielded"] = True
                game["lastEvents"].append(f"{player['name']} is covering {weakest['name']}")
        damage = round(45 + 55 * speed)
        if player["streak"] >= 3:
            damage = round(damage * 1.8)
        if move == "push":
            damage = round(damage * 2)
        if move == "cover":
            damage = round(damage * 0.5)
        targets = [x for x in mates if x["team"] == foe and not x["down"]]
        hit_name = game["teams"][foe]["name"]
        if targets:
            chosen = next((x for x in targets if x["id"] == player.get("target")), None)
            target = chosen or max(targets, key=lambda x: x["hp"])
            landed = min(damage, MAX_PLAYER_HIT)
            if target.get("shielded"):
                landed = round(landed * 0.35)
            target["hp"] = max(0, target["hp"] - landed)
            target["lastDamage"] = landed
            hit_name = target["name"]
            if target["hp"] == 0:
                target["down"] = True
                game["lastEvents"].append(f"{player['name']} knocked out {target['name']}")
        game["teams"][foe]["hp"] = max(0, game["teams"][foe]["hp"] - damage)
        game["teams"][player["team"]]["score"] += damage
        player["score"] += damage
        player["lastGain"] = damage
        extra = " — pushing up" if move == "push" else (" (overcharged)" if player["streak"] >= 3 else "")
        game["lastEvents"].append(f"{player['name']} hit {hit_name} for {damage}{extra}")
    elif ok and player["down"]:
        hurt = [x for x in mates if x["team"] == player["team"] and x["hp"] < 100]
        if hurt:
            mate = min(hurt, key=lambda x: x["hp"])
            mate["hp"] = min(100, mate["hp"] + 25)
            if mate["down"] and mate["hp"] > 0:
                mate["down"] = False
            game["lastEvents"].append(f"{player['name']} revived {mate['name']}, +25 HP")
        player["score"] += 25
    else:
        cost = 20 if move == "push" else 4 if move == "cover" else 10
        player["hp"] = max(0, player["hp"] - cost)
        if player["hp"] == 0:
            player["down"] = True
        game["lastEvents"].append(
            f"{player['name']} missed" + (" while pushing up, and it hurt" if move == "push" else ""))


def score_tower(game, player, question, ok, speed):
    """Answering earns the block. Placing it is what builds.

    A wrong answer costs nothing. It used to knock blocks off your own tower,
    which reads as a punishment for trying and is not what Kahoot does — there,
    a wrong answer simply does not hand you a block, and the thing you lose is
    the time. Mirrors SCORERS.tower in static/rules.js.
    """
    if ok:
        player["ready"] = player.get("ready", 0) + 1
        player["lastGain"] = 1
    else:
        player["lastGain"] = 0
    player["score"] = player.get("blocks", 0)


def score_boss(game, player, question, ok, speed):
    """Answering loads the knife. Putting it in is what hurts the boss.

    The tier still comes from how fast the answer was, because a greatsword is
    worth earning — but it decides what the weapon looks like, not what it does.
    Every knife takes exactly one health off, which is the whole point of
    everyone carrying a different one. Mirrors SCORERS.boss in static/rules.js.
    """
    player["blade"] = "stick" if not ok else ("great" if speed >= 0.5 else "sword")
    if ok:
        player["loaded"] = player.get("loaded", 0) + 1
        player["lastGain"] = 1
        if speed >= 0.5:
            game["lastEvents"].append(f"{player['name']} picked up a greatsword")
    else:
        player["lastGain"] = 0
    player["score"] = player.get("hits", 0)


def score_robot(game, player, question, ok, speed):
    """Robot Run scores nothing here.

    Everybody answers at their own pace and none of it is a race against each
    other — the whole class is running from the same robot and it is the boosts,
    pooled, that decide whether they get away. Mirrors SCORERS.robot in
    static/rules.js.
    """
    player["lastGain"] = 0


def score_normal(game, player, question, ok, speed):
    """Classic Quiz: the answer, and how fast it came.

    `speed` is one for an instant answer and nought for one on the buzzer, so
    half the marks are for knowing it and half for being quick. Answering at the
    last second still scores — a child who worked it out slowly has worked it
    out, and taking that away teaches guessing.

    A streak is worth something on top, and it is capped. Uncapped, one child
    who starts well runs away with it by the fourth question and everybody else
    stops trying. Mirrors SCORERS.normal in static/rules.js.
    """
    worth = int((question or {}).get("points") or 100)
    gain = 0
    if ok:
        gain = round(worth * (0.5 + 0.5 * speed))
        streak = min(player.get("streak", 0), 5)
        if streak >= 2:
            gain += round(worth * 0.1 * (streak - 1))
        if speed >= 0.8:
            game["lastEvents"].append(f"{player['name']} answered that one in a flash")
    player["score"] += gain
    player["lastGain"] = gain


def resolve(game):
    """The moves that touch somebody else, settled together.

    It has to be one step, after every answer is in: a robbery and the guard
    that stops it are the same event seen from two sides, and scoring them as
    they arrived would decide the game by whose phone had the better wifi.
    Mirrors resolve() in static/rules.js.
    """
    everyone = list(game.get("players", {}).values())
    mode = game.get("mode")
def after_round(game):
    """What happens between the questions.

    Lava rises and wind gets up whether anybody climbed or built or not. Once
    per round, in one place — inside a scorer it would run once per player,
    which is a different game with ten in the room than with two.
    Mirrors after_round in static/rules.js.
    """
    everyone = list(game.get("players", {}).values())

    resolve(game)

    # The wind used to blow here and take the top off any tower that was
    # swaying. Tallest Tower has no sway and no wind: what knocks a floor down
    # is the monster, it comes on its own clock rather than between questions,
    # and it goes for whoever is winning.
SCORERS = {
    "normal": score_normal,
    "laser": score_laser, "tower": score_tower,
    "boss": score_boss, "robot": score_robot,
}


@api.post("/games/<pin>/answer")
def answer_question(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        player = game["players"].get(body.get("playerId"))
        if not player:
            return jsonify({"error": "Join the game first."}), 404
        if game["state"] != "question":
            return jsonify({"error": "No question is open."}), 400
        if player["answered"]:
            return jsonify({"error": "Already answered."}), 400

        question = game["questions"][game["index"]]
        given = body.get("answer")
        ok = grade(question, given)
        limit = int(seconds_for(game, question)) * 1000
        left = max(0, (game.get("endsAt") or now_ms()) - now_ms())
        speed = max(0.0, min(1.0, left / limit)) if limit else 0.0

        player["answered"] = True
        player["correct"] = ok
        player["answers"][question["id"]] = given
        key = given if isinstance(given, str) else json.dumps(given)
        game["counts"][key] = game["counts"].get(key, 0) + 1

        if ok:
            player["streak"] += 1
            player["best"] = max(player["best"], player["streak"])
        else:
            player["streak"] = 0

        SCORERS[game["mode"]](game, player, question, ok, speed)

        game["lastEvents"] = game["lastEvents"][-6:]
        everyone_in = all(p["answered"] for p in game["players"].values()) and game["players"]
        if goal_reached(game):
            game["state"] = "over"                      # the teacher's own ending
            game["endsAt"] = None
        elif mode_finished(game):
            game["state"] = "over"                      # the game won itself
            game["endsAt"] = None
        elif everyone_in:
            game["state"] = "reveal"
            game["endsAt"] = None
            after_round(game)
        snapshot = public_game(game)
    publish(f"game:{pin}", "game:state", snapshot)
    return jsonify({"correct": ok, "score": player["score"], "hp": player["hp"],
                    "streak": player["streak"], "state": game["state"],
                    "blocks": player.get("blocks", 0), "height": player.get("height", 0),
                    "gain": player.get("lastGain", 0)})


# Boss Battle's fight: ten seconds, and the most one player could take off the
# boss in them. Reported damage above this is a bug or a joke, and is treated
# as both.
STRIKE_MS = 10000
STRIKE_CAP = 900


@api.post("/games/<pin>/strike")
def report_strike(pin):
    """What one player did with their ten seconds.

    The phone that swung the sword is the one that says so — the same trust
    model the Laser Tag arena has always used, because thirty children fighting
    is thirty small messages rather than one device simulating a room.
    """
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        player = game["players"].get(body.get("playerId"))
        if not player:
            return jsonify({"error": "Join the game first."}), 404
        if game["mode"] != "boss" or not game.get("boss"):
            return jsonify({"ok": False, "why": "Not that kind of game."})
        if player.get("struck"):
            return jsonify({"ok": True, "already": True})
        dealt = max(0, min(STRIKE_CAP, round(float(body.get("damage") or 0))))
        player["struck"] = dealt
        player["score"] += dealt
        game["boss"]["hp"] = max(0, game["boss"]["hp"] - dealt)
        if dealt:
            game["lastEvents"].append(f"{player['name']} did {dealt} to {game['boss']['name']}")
        if game["boss"]["hp"] == 0:
            game["lastEvents"].append(f"{game['boss']['name']} is defeated")
            game["state"] = "over"
            game["endsAt"] = None
        snapshot = public_game(game)
    publish(f"game:{pin}", "game:state", snapshot)
    return jsonify({"ok": True, "damage": dealt, "view": snapshot})


@api.post("/games/<pin>/move")
def choose_a_move(pin):
    """Which way this player is playing the round.

    Every mode has moves now, so this is the busiest endpoint here: it is written
    while the question is still up and read when the answer is scored. The rules
    decide whether a move is real and whether what it is aimed at makes sense;
    this only carries the message. No host token — the move is the player's own.
    """
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        player = game["players"].get(body.get("playerId"))
        if not player:
            return jsonify({"error": "Join the game first."}), 404
        out = choose_move(game, player, body.get("move"), body.get("on") or "")
        snapshot = public_game(game)
    if out.get("ok"):
        publish(f"game:{pin}", "game:state", snapshot)
    return jsonify({**out, "view": snapshot})


@api.post("/games/<pin>/end")
def end_game(pin):
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        if not host_check(game, body):
            return jsonify({"error": "Only the host can end the game."}), 403
        game["state"] = "over"
        game["endsAt"] = None
    broadcast_game(game)
    return jsonify(public_game(game))


@api.post("/games/<pin>/tick")
def tick_game(pin):
    """Called by the host when a timer runs out — closes the question server side."""
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        if not host_check(game, body):
            return jsonify({"error": "forbidden"}), 403
        if game["state"] not in ("lobby", "over") and goal_reached(game):
            game["state"] = "over"
            game["endsAt"] = None
        elif game["state"] == "question" and game.get("endsAt") and now_ms() >= game["endsAt"]:
            game["state"] = "reveal"
            game["endsAt"] = None
            for player in game["players"].values():
                if player["answered"]:
                    continue
                player["streak"] = 0
    broadcast_game(game)
    return jsonify(public_game(game))
