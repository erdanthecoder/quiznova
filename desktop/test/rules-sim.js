/* Play whole games of every mode and see whether the choices matter.
 *
 * The claim being tested is not "the code runs". It is that a player who picks
 * differently gets a different game — which is the entire point of the change,
 * and the thing that was false before it.
 */
const R = require('../../static/rules.js');

const QUESTION = { id: 'q', type: 'mc', points: 100, time: 20,
  choices: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B' }] };

function newGame(mode, names) {
  const players = {};
  names.forEach((n, i) => {
    players[n] = R.blankPlayer({ id: n, name: n, avatar: i, team: i % 2 ? 'blue' : 'red' });
  });
  const g = {
    mode, players, questions: [QUESTION], index: 0, state: 'question',
    lastEvents: [], setup: R.readSetup({}), goal: { kind: 'questions' },
    wind: false,
    teams: {
      red:  { name: 'Red',  score: 0, hp: 600 },
      blue: { name: 'Blue', score: 0, hp: 600 }
    },
    boss: { name: 'Boss', hp: 800, max: 800, classHp: 100, classMax: 100, next: 'poke', says: '' }
  };
  return g;
}

/** One round: everybody answers with the given rightness, then the world turns. */
function round(g, plan) {
  for (const [id, how] of Object.entries(plan)) {
    const p = g.players[id];
    if (how.move) R.chooseMove(g, p, how.move, how.on || '');
    if (how.target) p.target = how.target;
    p.streak = how.ok ? (p.streak || 0) + 1 : 0;
    (R.SCORERS[g.mode] || R.SCORERS.normal)(g, p, QUESTION, how.ok, how.speed == null ? 0.6 : how.speed);
  }
  R.afterRound(g);
}

let fails = 0, checks = 0;
const ok = (name, cond, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
  else console.log(`ok    ${name}${detail ? '  — ' + detail : ''}`);
};

/* ── 1. every mode survives a full game without throwing ── */
console.log('\n— every mode plays through —');
for (const mode of Object.keys(R.MODES)) {
  const g = newGame(mode, ['Ana', 'Ben', 'Cal', 'Dee']);
  let crashed = null;
  try {
    for (let r = 0; r < 12; r++) {
      const plan = {};
      for (const id of Object.keys(g.players)) {
        const moves = R.movesFor(mode);
        const pick = moves[Math.floor(Math.random() * moves.length)];
        plan[id] = { ok: Math.random() < 0.65, speed: Math.random(),
                     move: pick && pick.id,
                     on: pick && pick.needs === 'player'
                       ? Object.keys(g.players).find(x => x !== id)
                       : pick && pick.needs === 'card' ? R.CARD_SET[r % 8] : '',
                     target: mode === 'fishing' ? R.SPOT_IDS[r % 3] : '' };
      }
      round(g, plan);
      if (R.modeFinished(g)) break;
    }
  } catch (e) { crashed = e.message; }
  ok(`${mode} plays 12 rounds`, !crashed, crashed || `scores ${Object.values(g.players).map(p => p.score).join('/')}`);
}

/* ── 2. the move actually changes the outcome ──
 * Same answers, same speed, different choice. If these come out equal the
 * choice is decoration and the whole exercise failed. */
console.log('\n— the choice changes the game —');

// tower: tall builds faster, sways, and the wind takes it; bracing saves it
{
  const g = newGame('tower', ['Tall', 'Wide']);
  // scored by hand, so the random wind cannot topple the tower mid-measurement
  for (let r = 0; r < 3; r++) {
    R.chooseMove(g, g.players.Tall, 'tall'); R.chooseMove(g, g.players.Wide, 'wide');
    R.SCORERS.tower(g, g.players.Tall, QUESTION, true, 0.8);
    R.SCORERS.tower(g, g.players.Wide, QUESTION, true, 0.8);
  }
  ok('tower: building tall outbuilds building wide', g.players.Tall.blocks > g.players.Wide.blocks,
     `${g.players.Tall.blocks} vs ${g.players.Wide.blocks}`);
  ok('tower: a tall tower is swaying', g.players.Tall.sway >= R.SWAY_LIMIT, `sway ${g.players.Tall.sway}`);
  const before = g.players.Tall.blocks;
  g.wind = true; R.afterRound(g);
  ok('tower: the wind takes a swaying tower', g.players.Tall.blocks < before,
     `${before} -> ${g.players.Tall.blocks}`);
  ok('tower: a wide tower is untouched by the wind', g.players.Wide.blocks === 3, `${g.players.Wide.blocks}`);
  ok('tower: bracing steadies a swaying tower', (() => {
    const b = newGame('tower', ['T']);
    R.chooseMove(b, b.players.T, 'tall'); R.SCORERS.tower(b, b.players.T, QUESTION, true, .8);
    R.chooseMove(b, b.players.T, 'tall'); R.SCORERS.tower(b, b.players.T, QUESTION, true, .8);
    const swayed = b.players.T.sway;
    R.chooseMove(b, b.players.T, 'brace'); R.SCORERS.tower(b, b.players.T, QUESTION, true, .8);
    return swayed >= R.SWAY_LIMIT && b.players.T.sway === 0;
  })(), 'sway goes back to nothing');
}

// monster: the chase is played, not scored — the scorer must stay out of it
{
  const g = newGame('monster', ['A', 'B']);
  g.players.A.distance = 900; g.players.A.level = 2;
  round(g, { A: { ok: true, speed: .9 }, B: { ok: false, speed: .2 } });
  ok('monster: answering does not move anybody on the server',
     g.players.A.distance === 900 && g.players.A.level === 2,
     `${g.players.A.distance}m, level ${g.players.A.level}`);
  ok('monster: and it has no move to pick, because it is played with a thumb',
     R.movesFor('monster').length === 0, `${R.movesFor('monster').length} moves`);
}

// boss: the answer no longer scores, it arms you for the fight
{
  const g = newGame('boss', ['Fast', 'Slow', 'Wrong']);
  R.SCORERS.boss(g, g.players.Fast,  QUESTION, true,  0.9);
  R.SCORERS.boss(g, g.players.Slow,  QUESTION, true,  0.2);
  R.SCORERS.boss(g, g.players.Wrong, QUESTION, false, 0.9);
  ok('boss: answering fast and right earns a greatsword', g.players.Fast.blade === 'great',
     g.players.Fast.blade);
  ok('boss: answering right but slowly earns a sword', g.players.Slow.blade === 'sword',
     g.players.Slow.blade);
  ok('boss: answering wrongly still puts something in your hands',
     g.players.Wrong.blade === 'stick', g.players.Wrong.blade);
  ok('boss: the boss takes no damage from the question itself',
     g.boss.hp === 800, `hp ${g.boss.hp}`);
  ok('boss: knowing the answer is still worth a little',
     g.players.Fast.score > g.players.Slow.score && g.players.Wrong.score === 0,
     `${g.players.Fast.score} / ${g.players.Slow.score} / ${g.players.Wrong.score}`);
  ok('boss: and there is no move to pick, because the fight is the decision',
     R.movesFor('boss').length === 0, `${R.movesFor('boss').length} moves`);
}

// laser: pushing up hits harder and costs you; cover shields a mate
{
  const g = newGame('laser', ['R', 'B']);
  round(g, { R: { ok: true, speed: .8, move: 'push' }, B: { ok: true, speed: .8, move: 'aim' } });
  ok('laser: pushing up hits harder', g.players.R.lastGain > g.players.B.lastGain,
     `push ${g.players.R.lastGain} vs aim ${g.players.B.lastGain}`);
  ok('laser: and leaves you exposed afterwards', g.players.R.hp < 100 || g.players.R.down,
     `hp ${g.players.R.hp}`);
  // teams go by position in newGame, so index 0 and 2 are the pair on red
  const h = newGame('laser', ['R1', 'B1', 'R2']);
  h.players.R2.hp = 30;
  R.chooseMove(h, h.players.R1, 'cover');
  R.SCORERS.laser(h, h.players.R1, QUESTION, true, 0.8);
  ok('laser: taking cover shields the weakest mate', h.players.R2.shielded === true,
     `R2 shielded=${h.players.R2.shielded}`);
}

/* ── 3. nothing is the same function twice ──
 * The original sin: eleven modes computing score = f(right, speed). Play the
 * identical round in every mode and the shape of the result must differ. */
console.log('\n— the modes are not each other —');
{
  const shapes = {};
  for (const mode of Object.keys(R.MODES)) {
    const g = newGame(mode, ['A', 'B', 'C']);
    for (let r = 0; r < 5; r++) {
      round(g, {
        A: { ok: true,  speed: 0.9, move: R.defaultMove(mode) },
        B: { ok: true,  speed: 0.3, move: R.defaultMove(mode) },
        C: { ok: false, speed: 0.5, move: R.defaultMove(mode) }
      });
    }
    shapes[mode] = Object.values(g.players).map(p => p.score).join(',');
  }
  const seen = {};
  let dupes = 0;
  for (const [mode, shape] of Object.entries(shapes)) {
    if (seen[shape]) { dupes++; console.log(`  ${mode} scores identically to ${seen[shape]}: ${shape}`); }
    else seen[shape] = mode;
  }
  ok('no two modes produce the same scores from the same play', dupes === 0,
     `${Object.keys(shapes).length} modes, ${dupes} duplicates`);
  ok('there are exactly four of them', Object.keys(R.MODES).length === 4,
     Object.keys(R.MODES).join(' '));
}

console.log(`\n${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
