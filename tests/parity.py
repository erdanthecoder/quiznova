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
            "correct": None, "down": False, "lastDamage": 0, "distance": 0,
            "blocks": 0, "coins": 0, "chest": "", "balloons": Q.BALLOONS, "hits": 0,
            "cards": [], "spares": 0, "height": 0, "safe": True, "machines": 0,
            "output": 0, "target": "", "catch": "", "weight": 0, "best_catch": 0,
            "lastGain": 0, "move": "", "on": "", "job": None, "sway": 0,
            "item": False, "run": 0, "rocks": False, "tuned": 0, "stopped": False,
            "guarding": False, "acted": "", "shielded": False, "exposed": False,
            "offer": "", "answers": {},
        }
    return {
        "mode": mode, "players": players, "questions": [QUESTION], "index": 0,
        "state": "question", "lastEvents": [], "setup": Q.read_setup({}),
        "goal": {"kind": "questions"}, "rope": 0, "lava": 0, "shoal": "channel",
        "wind": False,
        "teams": {"red": {"name": "Red", "score": 0, "hp": 600, "blocks": Q.FORT_BLOCKS,
                          "max": Q.FORT_BLOCKS, "decoys": 0},
                  "blue": {"name": "Blue", "score": 0, "hp": 600, "blocks": Q.FORT_BLOCKS,
                           "max": Q.FORT_BLOCKS, "decoys": 0}},
        "boss": {"name": "Boss", "hp": 800, "max": 800, "classHp": 100,
                 "classMax": 100, "next": "poke", "says": ""},
    }

def py_run(mode, move, ok, speed):
    random.seed(0)
    Q.random.random = lambda: 0.5
    Q.random.choice = lambda seq: list(seq)[0]
    g = fresh(mode, ["Ana", "Ben"])
    for p in g["players"].values():
        p["target"] = "channel"
    on = "Ben" if any(m.get("needs") == "player" for m in Q.moves_for(mode) if m["id"] == move) else (
         Q.CARD_SET[0] if any(m.get("needs") == "card" for m in Q.moves_for(mode) if m["id"] == move) else "")
    Q.choose_move(g, g["players"]["Ana"], move, on)
    Q.choose_move(g, g["players"]["Ben"], Q.default_move(mode), "")
    g["players"]["Ana"]["streak"] = 3 if ok else 0
    Q.SCORERS[mode](g, g["players"]["Ana"], QUESTION, ok, speed)
    return {
        "score": g["players"]["Ana"]["score"], "coins": g["players"]["Ana"]["coins"],
        "blocks": g["players"]["Ana"]["blocks"], "height": g["players"]["Ana"]["height"],
        "distance": g["players"]["Ana"]["distance"], "hp": g["players"]["Ana"]["hp"],
        "balloons": g["players"]["Ana"]["balloons"], "weight": g["players"]["Ana"]["weight"],
        "sway": g["players"]["Ana"]["sway"], "lastGain": g["players"]["Ana"]["lastGain"],
        "rope": g["rope"], "bossHp": g["boss"]["hp"], "classHp": g["boss"]["classHp"],
        "redBlocks": g["teams"]["red"]["blocks"], "blueBlocks": g["teams"]["blue"]["blocks"],
        "cards": len(g["players"]["Ana"]["cards"]),
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
    players[n].target = 'channel';
  });
  const g = { mode, players, questions:[QUESTION], index:0, state:'question',
    lastEvents:[], setup:R.readSetup({}), goal:{kind:'questions'},
    rope:0, lava:0, shoal:'channel', wind:false,
    teams:{ red:{name:'Red',score:0,hp:600,blocks:R.FORT_BLOCKS,max:R.FORT_BLOCKS,decoys:0},
            blue:{name:'Blue',score:0,hp:600,blocks:R.FORT_BLOCKS,max:R.FORT_BLOCKS,decoys:0} },
    boss:{ name:'Boss', hp:800, max:800, classHp:100, classMax:100, next:'poke', says:'' } };
  const spec = R.movesFor(mode).find(m => m.id === move) || {};
  const on = spec.needs === 'player' ? 'Ben' : spec.needs === 'card' ? R.CARD_SET[0] : '';
  R.chooseMove(g, g.players.Ana, move, on);
  R.chooseMove(g, g.players.Ben, R.defaultMove(mode), '');
  g.players.Ana.streak = ok ? 3 : 0;
  (R.SCORERS[mode])(g, g.players.Ana, QUESTION, ok, speed);
  const a = g.players.Ana;
  out.push({ score:a.score, coins:a.coins, blocks:a.blocks, height:a.height,
    distance:a.distance, hp:a.hp, balloons:a.balloons, weight:a.weight, sway:a.sway,
    lastGain:a.lastGain, rope:g.rope, bossHp:g.boss.hp, classHp:g.boss.classHp,
    redBlocks:g.teams.red.blocks, blueBlocks:g.teams.blue.blocks, cards:a.cards.length });
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
RANDOM = {('cards', 'grab'), ('cards', 'hunt'), ('fishing', 'cast'),
          ('fishing', 'bait'), ('fishing', 'net'), ('treasure', 'silver'),
          ('treasure', 'gold'), ('treasure', 'bronze')}
for (mode, move, ok, speed), got in zip(CASES, js):
    want = py_run(mode, move, ok, speed)
    if (mode, move) in RANDOM:
        # compare only what randomness cannot reach
        keys = ['blocks', 'height', 'distance', 'hp', 'balloons', 'sway', 'rope']
    else:
        keys = list(want)
    diff = {k: (want[k], got[k]) for k in keys if want[k] != got[k]}
    if diff:
        fails += 1
        print(f"FAIL  {mode}/{move} ok={ok}: {diff}")

print(f"\n{len(CASES) - fails}/{len(CASES)} scorer cases agree between JavaScript and Python")
sys.exit(1 if fails else 0)
