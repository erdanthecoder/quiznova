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
    "normal":   {"label": "Normal",      "icon": "target", "teams": False,
                 "blurb": "Fastest right answer scores the most"},
    "laser":    {"label": "Laser Tag",   "icon": "laser", "teams": True,
                 "blurb": "One arena. Move, shoot, and answer when your energy runs out"},
    "kart":     {"label": "Kart Race",   "icon": "kart", "teams": False,
                 "blurb": "Every right answer drives your kart further"},
    "tower":    {"label": "Tower Build", "icon": "bricks", "teams": False,
                 "blurb": "Stack a block for each right answer"},
    "treasure": {"label": "Treasure Run", "icon": "gem", "teams": False,
                 "blurb": "Collect coins and open lucky chests"},
    "boss":     {"label": "Boss Battle", "icon": "dragon", "teams": False,
                 "blurb": "The whole class fights one boss together"},
    "snow":     {"label": "Snowball Fight", "icon": "snow", "teams": True,
                 "blurb": "Two teams. Every right answer knocks a block off their fort"},
    "balloon":  {"label": "Balloon Drop", "icon": "balloon", "teams": False,
                 "blurb": "Three balloons each. Get one wrong and one pops"},
    "tug":      {"label": "Tug of War",  "icon": "rope", "teams": True,
                 "blurb": "Two teams, one rope. Every right answer pulls it your way"},
    "heist":    {"label": "Gold Heist",  "icon": "coin", "teams": False,
                 "blurb": "Every right answer opens a chest — and some of them rob somebody"},
    "cards":    {"label": "Card Collector", "icon": "cards", "teams": False,
                 "blurb": "Win a card for every right answer. First to all eight"},
    "volcano":  {"label": "Volcano Climb", "icon": "flame", "teams": False,
                 "blurb": "Climb, and keep climbing — the lava is rising under everyone"},
    "factory":  {"label": "Factory", "icon": "bricks", "teams": False,
                 "blurb": "Buy machines with what you earn. They pay you every round after"},
    "fishing":  {"label": "Fishing Frenzy", "icon": "drop", "teams": False,
                 "blurb": "Cast near or far. The deep water pays more and gives less"},
}

# Each game is played on a map the teacher picks. A map is scenery and a palette:
# it changes what the board looks like, not how the scoring works.
MAPS = {
    "normal":   [("hall", "School Hall"), ("space", "Space Station"), ("jungle", "Jungle Clearing")],
    "laser":    [("arena", "Neon Arena"), ("bunker", "Bunker"), ("moon", "Moon Base")],
    "kart":     [("city", "City Circuit"), ("desert", "Desert Dash"), ("ice", "Ice Track")],
    "tower":    [("site", "Building Site"), ("candy", "Candy Land"), ("castle", "Castle Walls")],
    "treasure": [("cave", "Cave of Coins"), ("beach", "Pirate Beach"), ("vault", "The Vault")],
    "boss":     [("lair", "Dragon Lair"), ("volcano", "Volcano"), ("ruins", "Old Ruins")],
    "snow":     [("playground", "Playground"), ("forest", "Winter Forest"), ("peak", "Mountain Peak")],
    "balloon":  [("fair", "Summer Fair"), ("clouds", "Above the Clouds"), ("night", "Night Sky")],
    "tug":      [("field", "Sports Field"), ("deck", "Ship Deck"), ("lowg", "Low Gravity")],
    "heist":    [("mine", "Old Mine"), ("bank", "The Bank"), ("island", "Treasure Island")],
    "cards":    [("attic", "The Attic"), ("market", "Card Market"), ("museum", "The Museum")],
    "volcano":  [("crater", "The Crater"), ("ashfall", "Ashfall"), ("obsidian", "Obsidian Cliffs")],
    "factory":  [("works", "The Works"), ("foundry", "Foundry"), ("orbital", "Orbital Yard")],
    "fishing":  [("pier", "The Old Pier"), ("reef", "Coral Reef"), ("ice", "Ice Hole")],
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
    if mode == "snow":
        return any(game["teams"][side].get("max") and game["teams"][side]["blocks"] <= 0
                   for side in ("red", "blue"))
    if mode == "boss":
        boss = game.get("boss")
        return bool(boss) and (boss["hp"] == 0 or boss["classHp"] == 0)
    if mode == "tug":
        return abs(game.get("rope", 0)) >= ROPE_LENGTH
    if mode == "cards":
        return any(len(p.get("cards") or []) >= len(CARD_SET) for p in game["players"].values())
    if mode == "volcano":
        everyone = list(game["players"].values())
        return bool(everyone) and all(not p.get("safe") for p in everyone)
    return False


def maps_for(mode):
    return [{"id": i, "label": label} for i, label in MAPS.get(mode, MAPS["normal"])]


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
TRACK_LENGTH = 1000          # kart race distance to the flag
BOSS_HP_PER_QUESTION = 55    # scales the boss to the length of the quiz
FORT_BLOCKS = 12             # tallest a snowball fort can start
BALLOONS = 3                 # how many wrong answers a child can afford
ROPE_LENGTH = 100            # how far a team must drag the rope to win
# eight cards to collect. Shapes rather than pictures of things, so they draw at
# any size and mean the same in any language.
CARD_SET = ["star", "moon", "leaf", "flame", "drop", "bolt", "gem", "crown"]

# Volcano Climb: how far one very fast right answer gets you, the least the lava
# rises in a round, and how much of the room's average it adds on top — so a
# class that is doing well gets a harder game. Mirrors static/rules.js.
CLIMB_PER = 14
LAVA_BASE = 5
LAVA_CHASE = 7

# Factory: what the first machine costs, how much dearer each one after it is,
# and what each pays every round.
MACHINE_COST = 120
MACHINE_STEP = 60
MACHINE_YIELD = 34

# Fishing Frenzy: near water almost always gives you something small; the deep
# often gives you nothing and sometimes gives you the fish that wins the game.
SPOTS = {
    "shallows": {"label": "The shallows", "odds": 0.92, "low": 12, "high": 30, "big": 0.04},
    "channel":  {"label": "The channel", "odds": 0.68, "low": 30, "high": 70, "big": 0.12},
    "deep":     {"label": "The deep", "odds": 0.42, "low": 70, "high": 150, "big": 0.26},
}
FISH = ["a minnow", "a perch", "a bream", "a pike", "a carp", "a catfish", "a sturgeon"]
JUNK = ["an old boot", "a bag of weed", "a rusty can", "nothing at all", "a lost sock"]
SPARES_PER_SWAP = 3          # duplicates a child can trade for a card they need

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
                                           "distance", "blocks", "coins", "chest", "lastGain",
                                           "balloons", "hits")}
                    for p in players],
        "teams": game["teams"],
        "boss": game.get("boss"),
        "trackLength": TRACK_LENGTH,
        "goal": game.get("goal") or {"kind": "questions", "value": 0},
        "setup": game.get("setup"),
        "rope": game.get("rope", 0),
        "lava": game.get("lava", 0),
        "startedAt": game.get("startedAt", 0),
        "music": game.get("music") is not False,
        "modeInfo": MODES.get(game["mode"], MODES["normal"]),
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
            "mode": body.get("mode") if body.get("mode") in MODES else "normal",
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
        red = sum(1 for p in game["players"].values() if p["team"] == "red")
        blue = sum(1 for p in game["players"].values() if p["team"] == "blue")
        player = {
            "id": nid(10),
            "name": name,
            "avatar": wanted_face(body.get("avatar"),
                                  [p.get("avatar") for p in game["players"].values()]),
            "team": "red" if red <= blue else "blue",
            "score": 0,
            "hp": 100,
            "streak": 0,
            "best": 0,
            "answered": False,
            "correct": None,
            "down": False,
            "lastDamage": 0,
            "distance": 0,      # kart race
            "blocks": 0,        # tower build
            "coins": 0,         # treasure run
            "chest": "",
            "balloons": BALLOONS,   # balloon drop
            "hits": 0,              # snowball fight: blocks knocked off
            "cards": [],            # card collector: the set so far
            "spares": 0,            # and duplicates waiting to be traded
            "height": 0,            # volcano climb: how far up the wall
            "safe": True,           # and whether the lava has passed them
            "machines": 0,          # factory: what they have built
            "output": 0,            # and what it paid last round
            "target": "",           # fishing: where the line is cast
            "catch": "",            # what came up
            "weight": 0,            # and the total on the scales
            "best_catch": 0,
            "lastGain": 0,
            "answers": {},
        }
        game["players"][player["id"]] = player
    broadcast_game(game)
    return jsonify({"player": player, "game": public_game(game)}), 201


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
        if game["mode"] == "snow":
            # a fort per team, sized so a small class still gets to knock one down
            for team in ("red", "blue"):
                members = [p for p in game["players"].values() if p["team"] == team]
                blocks = max(6, min(FORT_BLOCKS, 3 + len(members) * 2))
                game["teams"][team]["blocks"] = blocks
                game["teams"][team]["max"] = blocks
        if game["mode"] == "balloon":
            for p in game["players"].values():
                p["balloons"] = BALLOONS
        if game["mode"] == "tug":
            game["rope"] = 0
        if game["mode"] == "volcano":
            game["lava"] = 0
            for p in game["players"].values():
                p["height"] = 0
                p["safe"] = True
        if game["mode"] == "factory":
            for p in game["players"].values():
                p["coins"] = 0
                p["machines"] = 0
                p["output"] = 0
        if game["mode"] == "fishing":
            for p in game["players"].values():
                p["weight"] = 0
                p["catch"] = ""
                p["target"] = "shallows"
        if game["mode"] == "cards":
            for p in game["players"].values():
                p["cards"] = []
                p["spares"] = 0
        if game["mode"] == "boss":
            total = max(1, len(game["questions"]))
            game["boss"] = {"hp": BOSS_HP_PER_QUESTION * total, "max": BOSS_HP_PER_QUESTION * total,
                            "name": pick_boss_name(), "classHp": 100, "classMax": 100}
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


def pick_boss_name():
    return random.choice(["Professor Puzzle", "The Grumbling Grammarian", "Baron Blunder",
                          "Countess Confusion", "The Number Nibbler", "Sir Slipsalot"])


def score_normal(game, player, question, ok, speed):
    if not ok:
        player["lastGain"] = 0
        return
    base = int(points_for(game, question))
    gain = int(round((base * 0.5 + base * 0.5 * speed) * streak_bonus(game, player)))
    player["score"] += gain
    player["lastGain"] = gain


def score_laser(game, player, question, ok, speed):
    foe = "blue" if player["team"] == "red" else "red"
    if ok and not player["down"]:
        damage = int(round(45 + 55 * speed))
        if player["streak"] >= 3:
            damage = int(damage * 1.8)                      # overcharge
        targets = [p for p in game["players"].values() if p["team"] == foe and not p["down"]]
        hit_name = game["teams"][foe]["name"]
        if targets:
            target = max(targets, key=lambda p: p["hp"])
            # Team shields soak the full shot; a single hit never one-shots a player.
            player_damage = min(damage, MAX_PLAYER_HIT)
            target["hp"] = max(0, target["hp"] - player_damage)
            target["lastDamage"] = player_damage
            hit_name = target["name"]
            if target["hp"] == 0:
                target["down"] = True
                game["lastEvents"].append(f"{player['name']} knocked out {target['name']}")
        game["teams"][foe]["hp"] = max(0, game["teams"][foe]["hp"] - damage)
        game["teams"][player["team"]]["score"] += damage
        player["score"] += damage
        game["lastEvents"].append(
            f"{player['name']} hit {hit_name} for {damage}" + (" (overcharged)" if player["streak"] >= 3 else ""))
    elif ok and player["down"]:
        mates = [p for p in game["players"].values() if p["team"] == player["team"] and p["hp"] < 100]
        heal = 25
        if mates:
            mate = min(mates, key=lambda p: p["hp"])
            mate["hp"] = min(100, mate["hp"] + heal)
            if mate["down"] and mate["hp"] > 0:
                mate["down"] = False
            game["lastEvents"].append(f"{player['name']} revived {mate['name']}, +{heal} HP")
        player["score"] += heal
    else:
        player["hp"] = max(0, player["hp"] - 10)
        if player["hp"] == 0:
            player["down"] = True
        game["lastEvents"].append(f"{player['name']} missed and lost shield")


def score_kart(game, player, question, ok, speed):
    """Distance driven. Answering fast is worth roughly double answering slowly."""
    if not ok:
        game["lastEvents"].append(f"{player['name']} span out")
        return
    metres = int(round(45 + 55 * speed))
    boost = player["streak"] >= 3
    if boost:
        metres = int(metres * 1.6)
    player["distance"] = player.get("distance", 0) + metres
    player["score"] = player["distance"]
    player["lastGain"] = metres
    game["lastEvents"].append(f"{player['name']} drove {metres}m" + (" with a boost" if boost else ""))


def score_tower(game, player, question, ok, speed):
    """One block per correct answer, two if it was quick; a miss knocks one off."""
    blocks = player.get("blocks", 0)
    if ok:
        gain = 2 if speed > 0.55 else 1
        player["blocks"] = blocks + gain
        player["lastGain"] = gain
        game["lastEvents"].append(f"{player['name']} stacked {gain} block" + ("s" if gain > 1 else ""))
    else:
        player["blocks"] = max(0, blocks - 1)
        player["lastGain"] = -1 if blocks else 0
        if blocks:
            game["lastEvents"].append(f"{player['name']}'s tower wobbled and a block fell")
    player["score"] = player["blocks"]


def score_treasure(game, player, question, ok, speed):
    """Coins plus a chest: the luck keeps a slower reader in the race."""
    if not ok:
        player["chest"] = ""
        game["lastEvents"].append(f"{player['name']} found an empty chest")
        return
    coins = int(round(60 + 60 * speed))
    roll = random.random()
    chest = ""
    if roll < 0.12:
        coins *= 3
        chest = "Jackpot, three times"
    elif roll < 0.32:
        coins *= 2
        chest = "Double chest"
    elif roll < 0.42:
        leader = max((p for p in game["players"].values() if p is not player),
                     key=lambda p: p.get("coins", 0), default=None)
        if leader and leader.get("coins", 0) > 0:
            stolen = int(leader["coins"] * 0.2)
            leader["coins"] -= stolen
            leader["score"] = leader["coins"]
            coins += stolen
            chest = f"Raided {leader['name']} for {stolen}"
    player["coins"] = player.get("coins", 0) + coins
    player["score"] = player["coins"]
    player["chest"] = chest
    player["lastGain"] = coins
    game["lastEvents"].append(f"{player['name']} collected {coins}" + (f" — {chest}" if chest else ""))


def score_snow(game, player, question, ok, speed):
    """Red against blue, and what the class watches is the other side's fort coming down.

    A team wins by knocking the last block off, not by holding the highest number,
    so a class that fell behind early is still in it while a block remains.
    """
    foe = "blue" if player["team"] == "red" else "red"
    fort = game["teams"][foe]
    if not ok:
        player["lastGain"] = 0
        game["lastEvents"].append(f"{player['name']} missed")
        return
    # a fast answer throws harder, and a run of them throws harder still
    power = 1 + min(player["streak"], 4) * 0.25
    hit = min(fort["blocks"], max(1, int(round((0.6 + speed) * power))))
    fort["blocks"] -= hit
    gain = int(round((question.get("points") or 100) * (0.5 + 0.5 * speed)))
    player["score"] += gain
    player["lastGain"] = gain
    player["hits"] = player.get("hits", 0) + hit
    game["teams"][player["team"]]["score"] += gain
    game["lastEvents"].append(
        f"{player['name']} knocked {hit} block{'s' if hit > 1 else ''} off the {fort['name']} fort"
        + ("" if fort["blocks"] else " — it is down!"))


def score_balloon(game, player, question, ok, speed):
    """Three balloons each, and a wrong answer pops one.

    Being out has to still be worth watching, so a child with no balloons left
    keeps answering for points — they simply cannot win it any more.
    """
    out = player.get("balloons", 0) <= 0
    if not ok:
        player["lastGain"] = 0
        if out:
            game["lastEvents"].append(f"{player['name']} got it wrong")
            return
        player["balloons"] -= 1
        left = player["balloons"]
        game["lastEvents"].append(
            f"{player['name']} lost a balloon — {left} left" if left
            else f"{player['name']} is out of balloons")
        return
    base = question.get("points") or 100
    # still floating is worth more than playing on for pride
    gain = int(round((base * 0.5 + base * 0.5 * speed) * (0.4 if out else 1)))
    player["score"] += gain
    player["lastGain"] = gain


def score_boss(game, player, question, ok, speed):
    """Everyone against one boss: right answers wound it, wrong answers let it hit back."""
    boss = game.setdefault("boss", {"hp": 500, "max": 500, "name": "The Boss", "classHp": 100, "classMax": 100})
    if ok:
        damage = int(round(20 + 25 * speed))
        if player["streak"] >= 3:
            damage = int(damage * 1.5)
        boss["hp"] = max(0, boss["hp"] - damage)
        player["score"] += damage
        player["lastGain"] = damage
        game["lastEvents"].append(f"{player['name']} hit {boss['name']} for {damage}")
        if boss["hp"] == 0:
            game["lastEvents"].append(f"{boss['name']} is defeated")
    else:
        boss["classHp"] = max(0, boss["classHp"] - 4)
        player["lastGain"] = 0
        game["lastEvents"].append(f"{boss['name']} struck back at the class")


def score_tug(game, player, question, ok, speed):
    """One rope, both teams, and it can come all the way back: a class two
    questions from losing can still win it."""
    if not ok:
        player["lastGain"] = 0
        return
    pull = int(round(4 + 7 * speed)) * (2 if player["streak"] >= 3 else 1)
    way = -1 if player["team"] == "red" else 1
    game["rope"] = max(-ROPE_LENGTH, min(ROPE_LENGTH, game.get("rope", 0) + way * pull))
    player["score"] += pull
    player["lastGain"] = pull
    player["hits"] += pull
    game["teams"][player["team"]]["score"] += pull
    game["lastEvents"].append(f"{player['name']} pulled {pull}"
                              + (" — heaving" if player["streak"] >= 3 else ""))


def score_heist(game, player, question, ok, speed):
    """The one game where the person in front should be worried."""
    if not ok:
        player["lastGain"] = 0
        player["chest"] = "Empty-handed"
        return
    found = int(round(60 + 70 * speed))
    others = [p for p in game["players"].values() if p["id"] != player["id"]]
    roll = random.random()

    if roll < 0.12 and others:
        leader = max(others, key=lambda p: p["coins"])
        taken = int(round(leader["coins"] * 0.4))
        leader["coins"] -= taken
        leader["score"] = leader["coins"]
        player["coins"] += found + taken
        player["chest"] = f"Robbed {leader['name']} of {taken}"
        game["lastEvents"].append(f"{player['name']} robbed {leader['name']} of {taken} gold")
    elif roll < 0.20 and others:
        other = random.choice(others)
        mine = player["coins"] + found
        player["coins"] = other["coins"]
        other["coins"] = mine
        other["score"] = other["coins"]
        player["chest"] = f"Swapped piles with {other['name']}"
        game["lastEvents"].append(f"{player['name']} swapped piles with {other['name']}")
    elif roll < 0.32:
        player["coins"] += found * 3
        player["chest"] = "A jackpot chest"
        game["lastEvents"].append(f"{player['name']} opened a jackpot")
    else:
        player["coins"] += found
        player["chest"] = f"+{found} gold"

    player["coins"] = max(0, player["coins"])
    player["score"] = player["coins"]
    player["lastGain"] = found


def score_cards(game, player, question, ok, speed):
    """A race for a set rather than for points: somebody unlucky early is never
    out of it, and the last card is the hardest one to get."""
    player.setdefault("cards", [])
    if not ok:
        player["lastGain"] = 0
        player["chest"] = ""
        return
    missing = [c for c in CARD_SET if c not in player["cards"]]
    want_new = missing and random.random() < (0.45 + 0.45 * speed)
    card = random.choice(missing) if want_new else random.choice(CARD_SET)

    if card in player["cards"]:
        player["spares"] = player.get("spares", 0) + 1
        spares = player["spares"]
        player["chest"] = f"Another {card} — {spares} spare{'' if spares == 1 else 's'}"
        if spares >= SPARES_PER_SWAP and missing:
            player["spares"] -= SPARES_PER_SWAP
            swap = random.choice(missing)
            player["cards"].append(swap)
            player["chest"] = f"Traded three spares for the {swap}"
            game["lastEvents"].append(f"{player['name']} traded three spares for the {swap}")
    else:
        player["cards"].append(card)
        player["chest"] = f"Won the {card}"
        game["lastEvents"].append(f"{player['name']} won the {card} card"
                                  + (" — a full set!" if len(player["cards"]) == len(CARD_SET) else ""))

    player["lastGain"] = 1
    player["score"] = len(player["cards"]) * 100 + player.get("spares", 0) * 10


def score_volcano(game, player, question, ok, speed):
    """Volcano Climb. Everybody on one wall with the lava coming up under all of
    them; being caught is not being out. Mirrors SCORERS.volcano in rules.js."""
    if ok:
        climb = round(CLIMB_PER * (0.45 + 0.55 * speed) * streak_bonus(game, player))
        player["height"] = player.get("height", 0) + climb
        player["lastGain"] = climb
        if player.get("streak", 0) >= 3:
            game["lastEvents"].append(f"{player['name']} is going up fast")
    else:
        slip = round(CLIMB_PER * 0.35)
        player["height"] = max(0, player.get("height", 0) - slip)
        player["lastGain"] = 0
        game["lastEvents"].append(f"{player['name']} slipped {slip}")

    was_safe = player.get("safe", True)
    player["safe"] = player["height"] >= game.get("lava", 0)
    if was_safe and not player["safe"]:
        game["lastEvents"].append(f"The lava caught {player['name']}")
    if not was_safe and player["safe"]:
        game["lastEvents"].append(f"{player['name']} climbed back out")
    player["score"] = player["height"]


def score_factory(game, player, question, ok, speed):
    """Factory. Answering earns; the machines are bought between questions and
    paid out in after_round. Mirrors SCORERS.factory in rules.js."""
    if not ok:
        player["lastGain"] = 0
        return
    base = points_for(game, question)
    gain = round((base * 0.35 + base * 0.35 * speed) * streak_bonus(game, player))
    player["coins"] = player.get("coins", 0) + gain
    player["lastGain"] = gain
    player["score"] = player["coins"] + player.get("output", 0) * 3


def score_fishing(game, player, question, ok, speed):
    """Fishing Frenzy. The answer decides whether the line comes up at all; where
    it was cast decides what is on it. Mirrors SCORERS.fishing in rules.js."""
    spot = player.get("target") if player.get("target") in SPOTS else "shallows"
    where = SPOTS[spot]
    if not ok:
        player["catch"] = "The line came up empty"
        player["lastGain"] = 0
        return
    if random.random() > where["odds"]:
        player["catch"] = "Caught " + random.choice(JUNK)
        player["lastGain"] = 0
        return
    spread = where["high"] - where["low"]
    big = random.random() < where["big"]
    weight = round((where["low"] + spread * (0.4 + 0.6 * speed)) * (2.6 if big else 1))
    kind = FISH[min(len(FISH) - 1, weight // 40)]
    player["weight"] = player.get("weight", 0) + weight
    player["best_catch"] = max(player.get("best_catch", 0), weight)
    player["catch"] = ("Landed a monster " if big else "Landed ") + kind + f" — {weight}"
    player["lastGain"] = weight
    player["score"] = player["weight"]
    if big:
        game["lastEvents"].append(
            f"{player['name']} landed {kind} out of {where['label'].lower()}")


def after_round(game):
    """What happens between the questions.

    Lava rises whether anybody climbed or not; machines pay out whether their
    owner answered or not. Once per round, in one place — inside a scorer it
    would run once per player, which is a different game with ten in the room
    than with two. Mirrors after_round in static/rules.js.
    """
    everyone = list(game.get("players", {}).values())

    if game.get("mode") == "volcano":
        average = (sum(p.get("height", 0) for p in everyone) / len(everyone)) if everyone else 0
        rise = round(LAVA_BASE + (average - game.get("lava", 0)) * (LAVA_CHASE / 100))
        game["lava"] = max(0, game.get("lava", 0) + max(LAVA_BASE, rise))
        for p in everyone:
            was_safe = p.get("safe", True)
            p["safe"] = p.get("height", 0) >= game["lava"]
            if was_safe and not p["safe"]:
                game["lastEvents"].append(f"The lava caught {p['name']}")

    if game.get("mode") == "factory":
        for p in everyone:
            if not p.get("machines"):
                continue
            paid = p["machines"] * MACHINE_YIELD
            p["coins"] = p.get("coins", 0) + paid
            p["output"] = paid
            p["score"] = p["coins"] + p["output"] * 3
        busiest = max((p for p in everyone if p.get("machines")),
                      key=lambda p: p["machines"], default=None)
        if busiest:
            n = busiest["machines"]
            game["lastEvents"].append(
                f"{busiest['name']}'s {n} machine{'' if n == 1 else 's'} paid out {n * MACHINE_YIELD}")

    game["lastEvents"] = game["lastEvents"][-6:]


def machine_cost(player):
    return MACHINE_COST + MACHINE_STEP * player.get("machines", 0)


def buy_machine(game, player):
    """Priced so the second is dearer than the first: a runaway leader who can
    buy five in a round is not a game. Mirrors buyMachine in static/rules.js."""
    if game.get("mode") != "factory":
        return {"ok": False, "why": "Not that kind of game."}
    cost = machine_cost(player)
    if player.get("coins", 0) < cost:
        return {"ok": False, "why": f"{cost - player.get('coins', 0)} more coins needed", "cost": cost}
    player["coins"] -= cost
    player["machines"] = player.get("machines", 0) + 1
    player["score"] = player["coins"] + player.get("output", 0) * 3
    game["lastEvents"].append(f"{player['name']} built machine number {player['machines']}")
    return {"ok": True, "cost": cost, "machines": player["machines"],
            "next": MACHINE_COST + MACHINE_STEP * player["machines"]}


SCORERS = {
    "normal": score_normal, "laser": score_laser, "kart": score_kart,
    "tower": score_tower, "treasure": score_treasure, "boss": score_boss,
    "snow": score_snow, "balloon": score_balloon,
    "tug": score_tug, "heist": score_heist, "cards": score_cards,
    "volcano": score_volcano, "factory": score_factory, "fishing": score_fishing,
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
                    "distance": player.get("distance", 0), "blocks": player.get("blocks", 0),
                    "coins": player.get("coins", 0), "chest": player.get("chest", ""),
                    "balloons": player.get("balloons", 0), "hits": player.get("hits", 0),
                    "gain": player.get("lastGain", 0)})


@api.post("/games/<pin>/build")
def build_machine(pin):
    """Factory's one decision, made between questions by the player themselves.

    No host token: it is the player's own coins. It is still checked against the
    game's own state rather than against what arrived in the body.
    """
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        player = game["players"].get(body.get("playerId"))
        if not player:
            return jsonify({"error": "Join the game first."}), 404
        out = buy_machine(game, player)
        snapshot = public_game(game)
    if out.get("ok"):
        publish(f"game:{pin}", "game:state", snapshot)
    return jsonify(dict(out, view=snapshot))


@api.post("/games/<pin>/cast")
def cast_line(pin):
    """Fishing's one decision. Kept until it is changed, so a child who picks the
    deep water and then gets three wrong in a row can feel it."""
    body = request.get_json(silent=True) or {}
    with _lock:
        game, err = game_or_404(pin)
        if err:
            return err
        player = game["players"].get(body.get("playerId"))
        if not player:
            return jsonify({"error": "Join the game first."}), 404
        where = body.get("spot") if body.get("spot") in SPOTS else "shallows"
        player["target"] = where
        snapshot = public_game(game)
    publish(f"game:{pin}", "game:state", snapshot)
    return jsonify({"ok": True, "spot": where, "view": snapshot})


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
                # letting the clock run out cannot be the safe move: in Balloon
                # Drop it costs a balloon, the same as answering wrongly
                if game["mode"] == "balloon" and player.get("balloons", 0) > 0:
                    player["balloons"] -= 1
                    left = player["balloons"]
                    game["lastEvents"].append(
                        f"{player['name']} ran out of time — {left} balloon{'' if left == 1 else 's'} left")
    broadcast_game(game)
    return jsonify(public_game(game))
