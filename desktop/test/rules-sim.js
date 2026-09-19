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
    (R.SCORERS[g.mode] || R.SCORERS[R.DEFAULT_MODE])(g, p, QUESTION, how.ok, how.speed == null ? 0.6 : how.speed);
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

/* tower: answering earns a block, placing it builds one. Rebuilt from Kahoot's
   Tallest Tower, where a wrong answer costs you nothing but the time. */
{
  const g = newGame('tower', ['Ana', 'Ben']);
  g.players.Ana.team = 'red'; g.players.Ben.team = 'blue';
  R.SCORERS.tower(g, g.players.Ana, QUESTION, true, 0.9);
  R.SCORERS.tower(g, g.players.Ana, QUESTION, true, 0.2);
  R.SCORERS.tower(g, g.players.Ben, QUESTION, false, 0.9);
  ok('tower: a right answer puts a block in your hand', g.players.Ana.ready === 2,
     `${g.players.Ana.ready} in hand`);
  ok('tower: a wrong one costs you nothing but the time',
     g.players.Ben.ready === 0 && g.players.Ben.blocks === 0);
  ok('tower: answering alone builds nothing', g.players.Ana.blocks === 0,
     `${g.players.Ana.blocks} built`);

  // placing is what builds, and a neat drop is worth two
  R.placeBlock(g, g.players.Ana, 0.5, 1);
  const sloppy = g.players.Ana.blocks;
  R.placeBlock(g, g.players.Ana, 0.01, 2);
  ok('tower: placing a block builds one', sloppy === 1, `${sloppy} after one drop`);
  ok('tower: and a square drop is worth two', g.players.Ana.blocks === 3,
     `${g.players.Ana.blocks} after a neat one`);
  ok('tower: where it landed is kept, so the tower is drawn as it was built',
     Math.abs(R.towersOf(g).red.blocks[0].o - 0.5) < 1e-9,
     `first block sits at ${R.towersOf(g).red.blocks[0].o}`);

  // a repeated sequence number cannot build twice
  const before = g.players.Ana.blocks;
  R.placeBlock(g, g.players.Ana, 0, 2);
  ok('tower: a phone repeating itself cannot build a floor on its own',
     g.players.Ana.blocks === before, `${before} -> ${g.players.Ana.blocks}`);

  // four blocks make a floor
  const t = newGame('tower', ['C']);
  t.players.C.team = 'blue';
  for (let i = 1; i <= R.SLOTS; i++) R.placeBlock(t, t.players.C, 0.5, i);
  ok('tower: four blocks in a row finish a floor', R.floorsOf(R.towersOf(t).blue) === 1,
     `${R.floorsOf(R.towersOf(t).blue)} floors from ${R.SLOTS} blocks`);

  // the monster goes for whoever is winning
  const m = newGame('tower', ['D', 'E']);
  m.players.D.team = 'red'; m.players.E.team = 'blue';
  for (let i = 1; i <= R.SLOTS * 4; i++) R.placeBlock(m, m.players.D, 0.5, i);
  for (let i = 1; i <= R.SLOTS; i++) R.placeBlock(m, m.players.E, 0.5, i);
  const tallBefore = R.floorsOf(R.towersOf(m).red);
  const hit = R.towerMonster(m);
  ok('tower: the monster goes for whoever is ahead', hit === 'red', String(hit));
  ok('tower: and takes a whole floor off them',
     R.floorsOf(R.towersOf(m).red) === tallBefore - 1,
     `${tallBefore} -> ${R.floorsOf(R.towersOf(m).red)}`);
  ok('tower: it leaves the team that is behind alone',
     R.floorsOf(R.towersOf(m).blue) === 1);
}

// robot: the escape is played, not scored — the scorer must stay out of it
{
  const g = newGame('robot', ['A', 'B']);
  g.players.A.boosts = 2;
  round(g, { A: { ok: true, speed: .9 }, B: { ok: false, speed: .2 } });
  ok('robot: answering does not spend a boost by itself',
     g.players.A.boosts === 2, `${g.players.A.boosts} boosts`);
  ok('robot: and it has no move to pick, because it is played with a thumb',
     R.movesFor('robot').length === 0, `${R.movesFor('robot').length} moves`);
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
  /* The score is knives put in, not answers given — so answering alone scores
     nothing at all. It loads the knife; the fight is what counts. */
  ok('boss: a right answer loads a knife, and does not score by itself',
     g.players.Fast.loaded === 1 && g.players.Slow.loaded === 1
     && !g.players.Wrong.loaded && g.players.Fast.score === 0,
     `loaded ${g.players.Fast.loaded}/${g.players.Slow.loaded}/${g.players.Wrong.loaded || 0},`
     + ` scores ${g.players.Fast.score}/${g.players.Slow.score}/${g.players.Wrong.score}`);
  ok('boss: every knife is worth exactly one, whatever it looks like',
     R.KNIFE_DAMAGE === 1 && R.BOSS_HP === 30 && R.BOSS_MS === 180000
     && R.KNIFE_RELOAD_MS === 2000,
     `${R.BOSS_HP} health, ${R.KNIFE_DAMAGE} a knife, ${R.KNIFE_RELOAD_MS}ms reload,`
     + ` ${R.BOSS_MS / 1000}s on the clock`);
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
    /* What a round leaves behind, not only the score. Two modes where the
       answer earns you something to spend later — a block in your hand, a
       boost — both score nought from answering alone, and that is right: the
       difference between them is what they put in your hand. */
    shapes[mode] = Object.values(g.players)
      .map(p => [p.score, p.ready || 0, p.blocks || 0, p.boosts || 0,
                 p.blade || '', p.hp].join('/')).join(',');
  }
  const seen = {};
  let dupes = 0;
  for (const [mode, shape] of Object.entries(shapes)) {
    if (seen[shape]) { dupes++; console.log(`  ${mode} scores identically to ${seen[shape]}: ${shape}`); }
    else seen[shape] = mode;
  }
  ok('no two modes produce the same scores from the same play', dupes === 0,
     `${Object.keys(shapes).length} modes, ${dupes} duplicates`);
  /* Four games and the plain quiz. The four were chosen deliberately and
     nothing should creep back in beside them; Classic Quiz is the fifth on
     purpose, because a starter or a recap does not want a game wrapped round
     it, and every mode still has to score differently from every other. */
  ok('there are five modes: the four games and the plain quiz',
     Object.keys(R.MODES).length === 5 && !!R.MODES.normal,
     Object.keys(R.MODES).join(' '));
  const quick = (() => {
    const g = newGame('normal', ['Fast', 'Slow', 'Wrong']);
    R.SCORERS.normal(g, g.players.Fast,  QUESTION, true,  1);
    R.SCORERS.normal(g, g.players.Slow,  QUESTION, true,  0);
    R.SCORERS.normal(g, g.players.Wrong, QUESTION, false, 1);
    return { fast: g.players.Fast.score, slow: g.players.Slow.score,
             wrong: g.players.Wrong.score };
  })();
  ok('and the plain one pays for being quick',
     quick.fast > quick.slow && quick.slow > 0 && quick.wrong === 0,
     `${quick.fast} instant, ${quick.slow} on the buzzer, ${quick.wrong} for a wrong one`);
  ok('a streak is worth something on top, and it is capped', (() => {
    const g = newGame('normal', ['Hot']);
    const p = g.players.Hot;
    const at = (n) => { p.streak = n; p.score = 0;
                        R.SCORERS.normal(g, p, QUESTION, true, 0.5); return p.score; };
    const one = at(1), four = at(4), twenty = at(20);
    return four > one && twenty === at(5);
  })(), 'five in a row is as good as twenty');
}

console.log(`\n${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
