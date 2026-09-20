"""Do the JavaScript rules and this Python mirror actually agree?

Two editions of the same game, written twice, is a standing invitation to
drift — and drift here means a class playing the Flask edition is quietly
playing a different game from the class on the website. So the same rounds are
played through both and the results compared.

Randomness is the difficulty. Where a scorer rolls a dice the two languages
cannot be made to roll the same one, so those paths are pinned: random is
stubbed to a fixed value on both sides, which makes every branch decidable.
"""
import json, os, subprocess, sys, random

sys.argv = ['x']
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import quizapi as Q

QUESTION = {"id": "q", "type": "mc", "points": 100, "time": 20,
            "choices": [{"id": "a", "text": "A", "correct": True}, {"id": "b", "text": "B"}]}

# every scorer's shape, and the moves worth checking in each
CASES = []
# Modes with no move of their own still have to agree, and the plain quiz is
# the one where the number on the screen is the whole game — so it is checked
# at both ends of the clock and on a wrong answer.
for mode in ("normal", "tower", "boss", "robot"):
    for ok in (True, False):
        for speed in (1.0, 0.5, 0.0):
            CASES.append((mode, "", ok, speed))
for mode, spec in Q.MOVES.items():
    for m in spec["list"]:
        CASES.append((mode, m["id"], True, 0.8))
        CASES.append((mode, m["id"], False, 0.4))

def fresh(mode, names):
    players = {}
    for i, n in enumerate(names):
        players[n] = {
            "id": n, "name": n, "avatar": i, "team": "blue" if i % 2 else "red",
            "score": 0, "hp": 100, "streak": 0, "best": 0, "answered": False,
            "correct": None, "down": False, "lastDamage": 0, "lastGain": 0,
            "blocks": 0, "ready": 0, "placed": 0, "boosts": 0, "safe": True,
            "guarding": False, "acted": "", "shielded": False, "exposed": False,
            "target": "", "move": "", "on": "", "answers": {},
        }
    return {
        "mode": mode, "players": players, "questions": [QUESTION], "index": 0,
        "state": "question", "lastEvents": [], "setup": Q.read_setup({}),
        "goal": {"kind": "questions"}, "lava": 0, "wind": False,
        "teams": {"red": {"name": "Red", "score": 0, "hp": 600},
                  "blue": {"name": "Blue", "score": 0, "hp": 600}},
        "boss": {"name": "Boss", "hp": 800, "max": 800, "classHp": 100,
                 "classMax": 100, "next": "poke", "says": ""},
    }

def py_run(mode, move, ok, speed):
    random.seed(0)
    Q.random.random = lambda: 0.5
    Q.random.choice = lambda seq: list(seq)[0]
    g = fresh(mode, ["Ana", "Ben"])
    on = "Ben" if any(m.get("needs") == "player" for m in Q.moves_for(mode) if m["id"] == move) else (
         Q.CARD_SET[0] if any(m.get("needs") == "card" for m in Q.moves_for(mode) if m["id"] == move) else "")
    Q.choose_move(g, g["players"]["Ana"], move, on)
    Q.choose_move(g, g["players"]["Ben"], Q.default_move(mode), "")
    g["players"]["Ana"]["streak"] = 3 if ok else 0
    Q.SCORERS[mode](g, g["players"]["Ana"], QUESTION, ok, speed)
    return {
        "score": g["players"]["Ana"]["score"], "hp": g["players"]["Ana"]["hp"],
        "blocks": g["players"]["Ana"]["blocks"], "boosts": g["players"]["Ana"]["boosts"],
        "ready": g["players"]["Ana"].get("ready", 0), "lastGain": g["players"]["Ana"]["lastGain"],
        "bossHp": g["boss"]["hp"], "classHp": g["boss"]["classHp"],
        "blade": g["players"]["Ana"].get("blade", ""),
        "redHp": g["teams"]["red"]["hp"], "blueHp": g["teams"]["blue"]["hp"],
    }

JS = r"""
const R = require(require('path').join(process.env.ROOT, 'static/rules.js'));
Math.random = () => 0.5;
const QUESTION = { id:'q', type:'mc', points:100, time:20,
  choices:[{id:'a',text:'A',correct:true},{id:'b',text:'B'}] };
const cases = JSON.parse(process.argv[process.argv.length - 1]);
const out = [];
for (const [mode, move, ok, speed] of cases) {
  const players = {};
  ['Ana','Ben'].forEach((n,i) => {
    players[n] = R.blankPlayer({ id:n, name:n, avatar:i, team: i%2 ? 'blue':'red' });
  });
  const g = { mode, players, questions:[QUESTION], index:0, state:'question',
    lastEvents:[], setup:R.readSetup({}), goal:{kind:'questions'},
    wind:false,
    teams:{ red:{name:'Red',score:0,hp:600}, blue:{name:'Blue',score:0,hp:600} },
    boss:{ name:'Boss', hp:800, max:800, classHp:100, classMax:100, next:'poke', says:'' } };
  const spec = R.movesFor(mode).find(m => m.id === move) || {};
  const on = spec.needs === 'player' ? 'Ben' : spec.needs === 'card' ? R.CARD_SET[0] : '';
  R.chooseMove(g, g.players.Ana, move, on);
  R.chooseMove(g, g.players.Ben, R.defaultMove(mode), '');
  g.players.Ana.streak = ok ? 3 : 0;
  (R.SCORERS[mode])(g, g.players.Ana, QUESTION, ok, speed);
  const a = g.players.Ana;
  out.push({ score:a.score, hp:a.hp, blocks:a.blocks, ready:a.ready||0,
    lastGain:a.lastGain, bossHp:g.boss.hp, classHp:g.boss.classHp, blade:a.blade||'',
    boosts:a.boosts,
    redHp:g.teams.red.hp, blueHp:g.teams.blue.hp });
}
console.log(JSON.stringify(out));
"""

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
js = json.loads(subprocess.run(
    ['node', '-e', JS, '--', json.dumps(CASES)],
    capture_output=True, text=True, check=True,
    env={**os.environ, 'ROOT': ROOT}).stdout)

fails = 0
# the paths where a dice is genuinely rolled and stubbing cannot align the two
RANDOM = set()   # none of the four surviving scorers rolls a dice of its own
for (mode, move, ok, speed), got in zip(CASES, js):
    want = py_run(mode, move, ok, speed)
    if (mode, move) in RANDOM:
        # compare only what randomness cannot reach
        keys = ['blocks', 'height', 'distance', 'hp', 'balloons', 'ready', 'rope']
    else:
        keys = list(want)
    diff = {k: (want[k], got[k]) for k in keys if want[k] != got[k]}
    if diff:
        fails += 1
        print(f"FAIL  {mode}/{move} ok={ok}: {diff}")

print(f"\n{len(CASES) - fails}/{len(CASES)} scorer cases agree between JavaScript and Python")

# ── the gorilla, in both languages ──
#
# The scorers are not the only rules the two editions both carry. Tallest
# Tower's gorilla decides who he climbs, what a block does while he is up
# there and what the green column is worth, and a mirror that drifts here is
# a mode that plays differently depending on which edition a class opened.
GORILLA_JS = """
const R = require(process.env.ROOT + '/static/rules.js');
const mk = () => {
  const players = {
    D: R.blankPlayer({ id: 'D', name: 'D', avatar: 0, team: 'red' }),
    E: R.blankPlayer({ id: 'E', name: 'E', avatar: 1, team: 'blue' }) };
  return { mode: 'tower', players, questions: [], index: 0, state: 'question',
           lastEvents: [], setup: R.readSetup({}), goal: { kind: 'questions' },
           teams: {}, towers: null };
};
const g = mk();
let seq = 0;
for (let i = 0; i < R.SLOTS * 4; i++) R.placeBlock(g, g.players.D, 0.5, ++seq);
let seqE = 0;
for (let i = 0; i < R.SLOTS; i++) R.placeBlock(g, g.players.E, 0.5, ++seqE);
const hit = R.towerMonster(g);
const T = R.towersOf(g);
const blocked = R.placeBlock(g, g.players.D, 0, ++seq);
const marks = { blue: T.blue.mark, green: T.green.mark, red: T.red.mark };
for (let i = 0; i < R.SLOTS * R.MARK_AHEAD; i++) R.placeBlock(g, g.players.E, 0.5, ++seqE);
const shielded = T.blue.shield;
T.red.apeUntil = Date.now() - 1;
const down = R.towerSettle(g);
console.log(JSON.stringify({ hit, redFloors: R.floorsOf(T.red), ape: !!blocked.ape,
  marks, shielded, down, markAfter: T.green.mark, sitting: !!T.red.apeUntil }));
"""

gor_js = json.loads(subprocess.run(
    ['node', '-e', GORILLA_JS], capture_output=True, text=True, check=True,
    env={**os.environ, 'ROOT': ROOT}).stdout)


def gorilla_py():
    """The same play, through quizapi.py's mirror of the same rules."""
    g = fresh("tower", ["D", "E"])
    players = g["players"]
    players["D"]["team"] = "red"
    players["E"]["team"] = "blue"
    g["towers"] = None
    seq = 0
    for _ in range(Q.SLOTS * 4):
        seq += 1
        Q.place_block(g, players["D"], 0.5, seq)
    seq_e = 0
    for _ in range(Q.SLOTS):
        seq_e += 1
        Q.place_block(g, players["E"], 0.5, seq_e)
    hit = Q.tower_monster(g)
    towers = Q.towers_of(g)
    seq += 1
    blocked = Q.place_block(g, players["D"], 0, seq)
    marks = {"blue": towers["blue"]["mark"], "green": towers["green"]["mark"],
             "red": towers["red"]["mark"]}
    for _ in range(Q.SLOTS * Q.MARK_AHEAD):
        seq_e += 1
        Q.place_block(g, players["E"], 0.5, seq_e)
    shielded = towers["blue"]["shield"]
    towers["red"]["apeUntil"] = Q.now_ms() - 1
    down = Q.tower_settle(g)
    return {"hit": hit, "redFloors": Q.floors_of(towers["red"]),
            "ape": bool(blocked.get("ape")), "marks": marks, "shielded": shielded,
            "down": down, "markAfter": towers["green"]["mark"],
            "sitting": bool(towers["red"]["apeUntil"])}


gor_py = gorilla_py()
gaps = {k: (gor_py[k], gor_js[k]) for k in gor_py if gor_py[k] != gor_js[k]}
if gaps:
    fails += 1
    print(f"FAIL  the gorilla plays differently in the two editions: {gaps}")
else:
    print("the gorilla behaves the same in JavaScript and Python"
          f" — he took {gor_py['hit']}, the green column went up at"
          f" {gor_py['marks']['blue']}, and the shield held")

# ── the scramble between decks, in both languages ──
#
# Zone geometry, who fits, what walking out does and who counts as adrift are
# all decided twice — once here and once in the browser. They have to agree to
# the pixel, because the board draws the zones from one and the phone claims
# them through the other.
SCRAMBLE_JS = """
const R = require(process.env.ROOT + '/static/rules.js');
const at = 1700000000000;
const p = (id) => Object.assign(R.blankPlayer({ id, name: id, avatar: 0 }),
                                { joinedAt: at - 60000 });
const g = { mode: 'robot', players: { A: p('A'), B: p('B'), C: p('C') },
            round: 3, lives: 3, lastEvents: [], safeEndsAt: at + 5000 };
const zones = R.safeZones(3, 3);
const first = R.claimZone(g, g.players.A, zones[0].id);
const second = R.claimZone(g, g.players.B, zones[0].id);
const left = R.claimZone(g, g.players.A, '');
const retry = R.claimZone(g, g.players.B, zones[0].id);
g.players.C.joinedAt = at + 1000;          // walked in mid-scramble
const adrift = R.settleSafe(g);
console.log(JSON.stringify({ zones, first: first.ok, second: second.ok,
  full: !!second.full, left: !!left.left, retry: retry.ok, adrift,
  lives: g.lives, cleared: Object.values(g.players).every(x => !x.zone) }));
"""

scr_js = json.loads(subprocess.run(
    ['node', '-e', SCRAMBLE_JS], capture_output=True, text=True, check=True,
    env={**os.environ, 'ROOT': ROOT}).stdout)


def scramble_py():
    at = 1700000000000
    def mk(i):
        return {"id": i, "name": i, "avatar": 0, "team": "red", "score": 0, "hp": 100,
                "streak": 0, "zone": "", "joinedAt": at - 60000}
    g = {"mode": "robot", "players": {k: mk(k) for k in ("A", "B", "C")},
         "round": 3, "lives": 3, "lastEvents": [], "safeEndsAt": at + 5000}
    zones = Q.safe_zones(3, 3)
    first = Q.claim_zone(g, g["players"]["A"], zones[0]["id"])
    second = Q.claim_zone(g, g["players"]["B"], zones[0]["id"])
    left = Q.claim_zone(g, g["players"]["A"], "")
    retry = Q.claim_zone(g, g["players"]["B"], zones[0]["id"])
    g["players"]["C"]["joinedAt"] = at + 1000
    adrift = Q.settle_safe(g)
    return {"zones": zones, "first": first["ok"], "second": second["ok"],
            "full": bool(second.get("full")), "left": bool(left.get("left")),
            "retry": retry["ok"], "adrift": adrift, "lives": g["lives"],
            "cleared": all(not x["zone"] for x in g["players"].values())}


scr_py = scramble_py()
holes = {k: (scr_py[k], scr_js[k]) for k in scr_py if scr_py[k] != scr_js[k]}
if holes:
    fails += 1
    print(f"FAIL  the scramble plays differently in the two editions: {holes}")
else:
    print("the safe zones behave the same in JavaScript and Python"
          f" — {len(scr_py['zones'])} zones on deck three, the full one turned"
          f" somebody away, and {scr_py['adrift']} of the three was left out"
          " in the open")

sys.exit(1 if fails else 0)
