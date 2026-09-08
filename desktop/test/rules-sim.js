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
    rope: 0, lava: 0, shoal: 'channel', wind: false,
    teams: {
      red:  { name: 'Red',  score: 0, hp: 600, blocks: R.FORT_BLOCKS, max: R.FORT_BLOCKS, decoys: 0 },
      blue: { name: 'Blue', score: 0, hp: 600, blocks: R.FORT_BLOCKS, max: R.FORT_BLOCKS, decoys: 0 }
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
function runWith(mode, move, rounds, seedPlan) {
  const g = newGame(mode, ['Ana', 'Ben']);
  for (let r = 0; r < rounds; r++) {
    round(g, seedPlan(move, r));
  }
  return g;
}

// normal: all-in on right answers must beat safe
{
  const safe = runWith('normal', 'safe', 6, (m) => ({ Ana: { ok: true, speed: 0.8, move: m }, Ben: { ok: true, speed: 0.8, move: 'safe' } }));
  const allin = runWith('normal', 'allin', 6, (m) => ({ Ana: { ok: true, speed: 0.8, move: m }, Ben: { ok: true, speed: 0.8, move: 'safe' } }));
  ok('normal: all in beats safe when you are right',
     allin.players.Ana.score > safe.players.Ana.score * 2,
     `${safe.players.Ana.score} vs ${allin.players.Ana.score}`);
  const wrong = runWith('normal', 'allin', 6, (m) => ({ Ana: { ok: false, speed: 0.8, move: m }, Ben: { ok: false, speed: 0.8, move: 'safe' } }));
  ok('normal: all in punishes being wrong', wrong.players.Ana.score <= wrong.players.Ben.score,
     `Ana ${wrong.players.Ana.score}, Ben(safe) ${wrong.players.Ben.score}`);
}

// kart: slipstream must pay the player who is behind
{
  const g = newGame('kart', ['Front', 'Back']);
  g.players.Front.distance = 600; g.players.Front.score = 600;
  round(g, { Front: { ok: true, speed: 0.5, move: 'slip' }, Back: { ok: true, speed: 0.5, move: 'slip' } });
  ok('kart: the slipstream pays the one behind more',
     g.players.Back.lastGain > g.players.Front.lastGain,
     `back +${g.players.Back.lastGain}, front +${g.players.Front.lastGain}`);
}

// tower: tall builds faster but the wind can take it
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

// heist: a guard beats a robber, and beats them for real money
{
  const g = newGame('heist', ['Robber', 'Mark']);
  g.players.Mark.coins = 500; g.players.Mark.score = 500;
  g.players.Robber.coins = 300; g.players.Robber.score = 300;
  round(g, { Robber: { ok: true, speed: .7, move: 'rob', on: 'Mark' },
             Mark:   { ok: true, speed: .7, move: 'guard' } });
  ok('heist: guarding catches the robber', g.players.Mark.coins > 500 && g.players.Robber.coins < 300,
     `mark ${g.players.Mark.coins}, robber ${g.players.Robber.coins}`);

  const h = newGame('heist', ['Robber', 'Mark']);
  h.players.Mark.coins = 600; h.players.Mark.score = 600;
  round(h, { Robber: { ok: true, speed: .7, move: 'rob', on: 'Mark' },
             Mark:   { ok: true, speed: .7, move: 'sneak' } });
  ok('heist: robbing an unguarded pile takes a third',
     h.players.Mark.coins < 600 && h.players.Robber.coins > 200,
     `mark ${h.players.Mark.coins}, robber ${h.players.Robber.coins}`);
}

// tug: anchoring holds, heaving moves more
{
  const g = newGame('tug', ['R1', 'B1']);
  round(g, { R1: { ok: true, speed: .8, move: 'heave' }, B1: { ok: true, speed: .8, move: 'dig' } });
  ok('tug: a heave outpulls a dig-in', Math.abs(g.rope) > 0 && g.players.R1.lastGain > g.players.B1.lastGain,
     `rope ${g.rope}, heave ${g.players.R1.lastGain} vs dig ${g.players.B1.lastGain}`);
  const h = newGame('tug', ['R1', 'B1']);
  round(h, { R1: { ok: false, speed: .8, move: 'heave' }, B1: { ok: false, speed: .8, move: 'dig' } });
  ok('tug: a missed heave slips the rope back', h.rope !== 0, `rope ${h.rope}`);
}

// volcano: routes climb at different rates, and rocks fall
{
  const g = newGame('volcano', ['Over', 'Ledge']);
  round(g, { Over: { ok: true, speed: .8, move: 'overhang' }, Ledge: { ok: true, speed: .8, move: 'ledge' } });
  ok('volcano: the overhang climbs faster than the ledge', g.players.Over.height > g.players.Ledge.height,
     `${g.players.Over.height} vs ${g.players.Ledge.height}`);
  const h = newGame('volcano', ['Over', 'Below']);
  h.players.Over.height = 200; h.players.Below.height = 100;
  const was = 100;
  round(h, { Over: { ok: true, speed: .8, move: 'overhang' }, Below: { ok: false, speed: .5, move: 'ledge' } });
  ok('volcano: the overhang drops rocks on whoever is below',
     h.lastEvents.some(e => /rocks down/.test(e)), h.lastEvents.slice(-2).join(' | '));
}

// boss: guarding stops a sweep, and the boss telegraphs
{
  const g = newGame('boss', ['A', 'B', 'C']);
  g.boss.next = 'sweep';
  const hpBefore = g.boss.classHp;
  round(g, { A: { ok: true, speed: .8, move: 'guard' }, B: { ok: true, speed: .8, move: 'guard' },
             C: { ok: true, speed: .8, move: 'guard' } });
  ok('boss: a guarded sweep does nothing', g.boss.classHp === hpBefore, `${hpBefore} -> ${g.boss.classHp}`);

  const h = newGame('boss', ['A', 'B', 'C']);
  h.boss.next = 'sweep';
  round(h, { A: { ok: true, speed: .8, move: 'attack' }, B: { ok: true, speed: .8, move: 'attack' },
             C: { ok: true, speed: .8, move: 'attack' } });
  ok('boss: an unguarded sweep hurts the class', h.boss.classHp < 100, `classHp ${h.boss.classHp}`);
  ok('boss: it says what it will do next', !!h.boss.says, h.boss.says);
}

// snow: fortifying puts blocks back
{
  const g = newGame('snow', ['R1', 'B1']);
  g.teams.red.blocks = 5;
  round(g, { R1: { ok: true, speed: .8, move: 'fortify' }, B1: { ok: false, speed: .5, move: 'throw' } });
  ok('snow: rebuilding puts blocks back on your fort', g.teams.red.blocks > 5, `${g.teams.red.blocks}`);
  const h = newGame('snow', ['R1', 'B1']);
  round(h, { R1: { ok: true, speed: .8, move: 'snowman' }, B1: { ok: true, speed: .8, move: 'throw' } });
  ok('snow: a decoy soaks the hit instead of the fort',
     h.teams.red.blocks === R.FORT_BLOCKS, `blocks ${h.teams.red.blocks}, decoys ${h.teams.red.decoys}`);
}

// treasure: the chest you choose is the chest you open
{
  let bronzeEmpty = 0, goldEmpty = 0;
  for (let i = 0; i < 400; i++) {
    const g = newGame('treasure', ['A']);
    round(g, { A: { ok: true, speed: .5, move: 'bronze' } });
    if (!g.players.A.lastGain) bronzeEmpty++;
    const h = newGame('treasure', ['A']);
    round(h, { A: { ok: true, speed: .5, move: 'gold' } });
    if (!h.players.A.lastGain) goldEmpty++;
  }
  ok('treasure: bronze always pays, gold often does not', bronzeEmpty === 0 && goldEmpty > 150,
     `bronze empty ${bronzeEmpty}/400, gold empty ${goldEmpty}/400`);
}

// fishing: the shoal doubles, the net catches more but smaller
{
  const g = newGame('fishing', ['A']);
  g.shoal = 'deep';
  let inShoal = 0, out = 0;
  for (let i = 0; i < 300; i++) {
    const a = newGame('fishing', ['A']); a.shoal = 'deep';
    round(a, { A: { ok: true, speed: .6, move: 'cast', target: 'deep' } });
    inShoal += a.players.A.weight;
    const b = newGame('fishing', ['A']); b.shoal = 'shallows';
    round(b, { A: { ok: true, speed: .6, move: 'cast', target: 'deep' } });
    out += b.players.A.weight;
  }
  ok('fishing: the shoal is worth being in', inShoal > out * 1.6, `in ${inShoal}, out ${out}`);
}

// cards: hunting gets you the card you asked for more often than grabbing does
{
  let huntHit = 0, grabHit = 0;
  for (let i = 0; i < 500; i++) {
    const g = newGame('cards', ['A']);
    g.players.A.cards = R.CARD_SET.slice(0, 7);       // one card missing
    const want = R.CARD_SET[7];
    round(g, { A: { ok: true, speed: .9, move: 'hunt', on: want } });
    if (g.players.A.cards.includes(want)) huntHit++;
    const h = newGame('cards', ['A']);
    h.players.A.cards = R.CARD_SET.slice(0, 7);
    round(h, { A: { ok: true, speed: .9, move: 'grab' } });
    if (h.players.A.cards.includes(want)) grabHit++;
  }
  ok('cards: hunting a named card beats grabbing at random', huntHit > grabHit,
     `hunt ${huntHit}/500, grab ${grabHit}/500`);
}

// factory: sabotage stops a payout
{
  const g = newGame('factory', ['Boss', 'Rival']);
  g.players.Rival.machines = 3;
  round(g, { Boss: { ok: true, speed: .7, move: 'sabotage', on: 'Rival' },
             Rival: { ok: true, speed: .7, move: 'work' } });
  ok('factory: sabotage stops their machines for a round', g.players.Rival.output === 0,
     `rival output ${g.players.Rival.output}`);
  const h = newGame('factory', ['Boss', 'Rival']);
  h.players.Rival.machines = 3;
  round(h, { Boss: { ok: true, speed: .7, move: 'work' }, Rival: { ok: true, speed: .7, move: 'work' } });
  ok('factory: machines pay when nobody jams them', h.players.Rival.output > 0,
     `rival output ${h.players.Rival.output}`);
}

// laser: pushing up hits harder and costs you
{
  const g = newGame('laser', ['R', 'B']);
  round(g, { R: { ok: true, speed: .8, move: 'push' }, B: { ok: true, speed: .8, move: 'aim' } });
  ok('laser: pushing up hits harder', g.players.R.lastGain > g.players.B.lastGain,
     `push ${g.players.R.lastGain} vs aim ${g.players.B.lastGain}`);
  ok('laser: and leaves you exposed afterwards', g.players.R.hp < 100 || g.players.R.down,
     `hp ${g.players.R.hp}`);
}

// balloon: soaring doubles and costs two
{
  const g = newGame('balloon', ['A', 'B']);
  round(g, { A: { ok: true, speed: .8, move: 'soar' }, B: { ok: true, speed: .8, move: 'float' } });
  ok('balloon: soaring is worth double', g.players.A.lastGain === g.players.B.lastGain * 2,
     `${g.players.A.lastGain} vs ${g.players.B.lastGain}`);
  const h = newGame('balloon', ['A', 'B']);
  round(h, { A: { ok: false, speed: .8, move: 'soar' }, B: { ok: false, speed: .8, move: 'float' } });
  ok('balloon: and costs two when you are wrong',
     h.players.A.balloons === R.BALLOONS - 2 && h.players.B.balloons === R.BALLOONS - 1,
     `soar ${h.players.A.balloons}, float ${h.players.B.balloons}`);
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
}

console.log(`\n${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
