/* Tallest Tower, played through the real server and the real pages.
 *
 * Rebuilt from how Kahoot's works: the room splits into three teams, a right
 * answer earns a construction block, and placing it is a timed tap — where it
 * lands is kept and drawn, so a hurried drop is crooked on the board for the
 * rest of the lesson. What was here before was a menu of three words and a
 * number, and no tower was drawn on any screen at all.
 */
const path = require('path');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };

(async () => {
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/towertest', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  const quiz = await post('/api/quizzes', { title: 'Lesson', questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  await post(`/api/quizzes/${qid}/ops`, { ops: [1, 2, 3, 4, 5, 6].map(n => ({
    op: 'add_question', question: { type: 'mc', text: `Question ${n}`, points: 100, time: 60,
      choices: [{ text: 'right', correct: true }, { text: 'wrong' }] } })) });
  await post(`/api/quizzes/${qid}/ops`, { ops: [{ op: 'delete_question', at: 0 }] });

  const made = await post('/api/games', { quizId: qid, mode: 'tower', map: '' });
  const pin = made.pin, ht = made.hostToken;

  // ── the room splits three ways, not two ──
  const joined = [];
  for (const name of ['Ana', 'Ben', 'Cleo', 'Dev', 'Esme', 'Finn']) {
    const j = await post(`/api/games/${pin}/join`, { name, avatar: joined.length * 9 });
    joined.push(j.player ? j.player : j);
  }
  const sides = {};
  joined.forEach(p => { sides[p.team] = (sides[p.team] || 0) + 1; });
  ok('the room splits into three teams', Object.keys(sides).length === 3,
     JSON.stringify(sides));
  ok('and they come out level', Object.values(sides).every(n => n === 2),
     JSON.stringify(sides));

  await post(`/api/games/${pin}/start`, { hostToken: ht });
  const full = await (await fetch(`${base}/api/quizzes/${qid}`)).json();
  const qs = (full.quiz || full).questions;
  const right = (q) => (q.choices.find(c => c.correct) || q.choices[0]).id;

  // ── answering earns a block; it does not build one ──
  const ana = joined[0];
  await post(`/api/games/${pin}/answer`, { playerId: ana.id, answer: right(qs[0]), speed: 0.8 });
  let view = await (await fetch(`${base}/api/games/${pin}`)).json();
  let mine = view.players.find(p => p.id === ana.id);
  ok('a right answer puts a block in your hand', (mine.ready || 0) === 1, `${mine.ready} in hand`);
  ok('and builds nothing on its own', (mine.blocks || 0) === 0, `${mine.blocks} built`);

  // ── placing builds, and a square drop is worth two ──
  await post(`/api/games/${pin}/place`, { playerId: ana.id, offset: 0.6, seq: 1 });
  view = await (await fetch(`${base}/api/games/${pin}`)).json();
  mine = view.players.find(p => p.id === ana.id);
  ok('placing it builds one', (mine.blocks || 0) === 1, `${mine.blocks} built`);
  ok('and the block is gone from your hand', (mine.ready || 0) === 0, `${mine.ready} left`);
  const wonky = (view.towers[ana.team].blocks || [])[0];
  ok('where it landed is kept, so the tower is drawn as it was built',
     Math.abs(wonky.o - 0.6) < 1e-6, `it sits at ${wonky.o}`);

  await post(`/api/games/${pin}/next`, { hostToken: ht });
  await post(`/api/games/${pin}/next`, { hostToken: ht });
  await post(`/api/games/${pin}/answer`, { playerId: ana.id, answer: right(qs[1]), speed: 0.8 });
  await post(`/api/games/${pin}/place`, { playerId: ana.id, offset: 0.01, seq: 2 });
  view = await (await fetch(`${base}/api/games/${pin}`)).json();
  mine = view.players.find(p => p.id === ana.id);
  ok('a square drop is worth two', (mine.blocks || 0) === 3, `${mine.blocks} built`);

  // ── a phone repeating itself cannot build a floor on its own ──
  const before = mine.blocks;
  await post(`/api/games/${pin}/place`, { playerId: ana.id, offset: 0, seq: 2 });
  view = await (await fetch(`${base}/api/games/${pin}`)).json();
  mine = view.players.find(p => p.id === ana.id);
  ok('a repeated sequence number builds nothing', (mine.blocks || 0) === before,
     `${before} -> ${mine.blocks}`);

  /* ── the pages ── */
  const browser = await chromium.launch({ executablePath: CHROME, headless: false });

  const board = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const berrs = [];
  board.on('pageerror', e => berrs.push(e.message));
  await board.goto(`${base}/host.html?pin=${pin}#h=${ht}`, { waitUntil: 'domcontentloaded' });
  await board.waitForTimeout(1500);

  const drawn = await board.evaluate(() => {
    const c = document.getElementById('board-tower');
    if (!c || !c.isConnected) return { ok: false, why: 'no tower on the board' };
    const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let on = 0, n = 0;
    for (let i = 0; i < g.length; i += 4 * 53) { n++; if (g[i] + g[i + 1] + g[i + 2] > 40) on++; }
    return { ok: true, pct: Math.round(on / n * 100) };
  });
  ok('the towers are drawn on the board', drawn.ok && drawn.pct > 70,
     drawn.ok ? `${drawn.pct}% painted` : drawn.why);
  /* All three towers are there. The names are painted on the canvas rather than
     written in the page, so the check is for the three team colours rather than
     for their text. */
  const colours = await board.evaluate(() => {
    const c = document.getElementById('board-tower');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const near = (r, g, b, R, G, B) =>
      Math.abs(r - R) < 26 && Math.abs(g - G) < 26 && Math.abs(b - B) < 26;
    const want = { red: [244, 54, 76], blue: [79, 107, 255], green: [18, 190, 142] };
    const found = { red: 0, blue: 0, green: 0 };
    for (let i = 0; i < d.length; i += 4 * 7) {
      for (const k of Object.keys(want)) {
        if (near(d[i], d[i + 1], d[i + 2], want[k][0], want[k][1], want[k][2])) found[k]++;
      }
    }
    return found;
  });
  ok('all three towers are on it',
     colours.red > 40 && colours.blue > 40 && colours.green > 40,
     JSON.stringify(colours));
  ok('no errors on the board', berrs.length === 0, berrs.slice(0, 2).join(' | '));

  // ── the phone: earn a block, and the screen becomes the drop ──
  const phone = await browser.newPage({ viewport: { width: 390, height: 820 }, hasTouch: true });
  const perrs = [];
  phone.on('pageerror', e => perrs.push(e.message));
  await phone.goto(`${base}/play.html?pin=${pin}`, { waitUntil: 'domcontentloaded' });
  await phone.waitForTimeout(700);
  await phone.locator('input').first().fill('Cal');
  await phone.locator('button:has-text("Join the game")').first().click();
  await phone.waitForTimeout(900);

  const cal = (await (await fetch(`${base}/api/games/${pin}`)).json())
    .players.find(p => p.name === 'Cal');
  await post(`/api/games/${pin}/answer`, { playerId: cal.id, answer: right(qs[1]), speed: 0.9 });
  await phone.waitForTimeout(1800);

  ok('holding a block puts the drop on the screen',
     await phone.locator('#d-go').count() > 0,
     (await phone.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 60));
  const painted = await phone.evaluate(() => {
    const c = document.getElementById('drop');
    if (!c) return -1;
    const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let on = 0, n = 0;
    for (let i = 0; i < g.length; i += 4 * 41) { n++; if (g[i] + g[i + 1] + g[i + 2] > 60) on++; }
    return Math.round(on / n * 100);
  });
  ok('and the block is actually sliding on it', painted > 55, `${painted}% painted`);

  await phone.locator('#d-go').click();
  await phone.waitForTimeout(1600);
  const after = (await (await fetch(`${base}/api/games/${pin}`)).json())
    .players.find(p => p.id === cal.id);
  ok('tapping drop builds a block for your team', (after.blocks || 0) >= 1,
     `${after.blocks} built`);
  ok('no errors on the phone', perrs.length === 0, perrs.slice(0, 2).join(' | '));

  /* ── the gorilla ──────────────────────────────────────
   *
   * Kahoot's: he climbs the tower that is winning, takes a floor off it and
   * then sits there, and while he is up there that team drops blocks that
   * never land. The other two towers get a green column to build to, and
   * reaching it is the only way anybody gets rid of him. This used to be a
   * purple blob that hit and ran. */
  /* Build the towers up first: everybody answers whatever question is on the
     board and drops square, round after round, until there is something tall
     enough for him to want. The current question is read each time rather than
     assumed, because the board moves on by itself once everyone has answered. */
  const seqs = {};
  for (let round = 0; round < 4; round++) {
    let now = await (await fetch(`${base}/api/games/${pin}`)).json();
    if (now.state !== 'question') {
      await post(`/api/games/${pin}/next`, { hostToken: ht });
      now = await (await fetch(`${base}/api/games/${pin}`)).json();
    }
    if (now.state !== 'question' || !now.question) break;
    const full2 = await (await fetch(`${base}/api/quizzes/${qid}`)).json();
    const here = (full2.quiz || full2).questions.find(q => q.id === now.question.id);
    if (!here) break;
    for (const p of joined) {
      await post(`/api/games/${pin}/answer`,
                 { playerId: p.id, answer: right(here), speed: 0.9 });
      seqs[p.id] = (seqs[p.id] || 0) + 1;
      await post(`/api/games/${pin}/place`,
                 { playerId: p.id, offset: 0, seq: seqs[p.id] });
    }
    await post(`/api/games/${pin}/next`, { hostToken: ht });
  }

  const climbed = await post(`/api/games/${pin}/monster`, { hostToken: ht });
  const withApe = await (await fetch(`${base}/api/games/${pin}`)).json();
  const team = climbed.hit;
  ok('the gorilla goes for the tower that is winning', !!team, String(team));
  ok('and then he sits on it rather than hitting and running',
     team && withApe.towers[team].apeUntil > Date.now(),
     team ? `${Math.round((withApe.towers[team].apeUntil - Date.now()) / 1000)}s up there`
          : 'he never came');
  ok('the other two towers are given a green column to build to',
     Object.keys(withApe.towers).filter(t => t !== team)
       .every(t => withApe.towers[t].mark > 0),
     JSON.stringify(Object.fromEntries(
       Object.entries(withApe.towers).map(([t, v]) => [t, v.mark]))));

  // a block dropped on his tower leaves the hand and lands nowhere
  const floorsBefore = Math.floor(withApe.towers[team].blocks.length / (withApe.towerSlots || 4));
  // somebody on his tower, with a block in hand and a question in front of them
  const victim = joined.find(p => p.team === team);
  let asking = await (await fetch(`${base}/api/games/${pin}`)).json();
  if (asking.state !== 'question') {
    await post(`/api/games/${pin}/next`, { hostToken: ht });
    asking = await (await fetch(`${base}/api/games/${pin}`)).json();
  }
  const fullNow = await (await fetch(`${base}/api/quizzes/${qid}`)).json();
  const asked = (fullNow.quiz || fullNow).questions
    .find(q => asking.question && q.id === asking.question.id) || qs[1];
  await post(`/api/games/${pin}/answer`,
             { playerId: victim.id, answer: right(asked), speed: 0.9 });
  seqs[victim.id] = (seqs[victim.id] || 0) + 1;
  const stolen = await post(`/api/games/${pin}/place`,
                            { playerId: victim.id, offset: 0, seq: seqs[victim.id] });
  const stillThere = await (await fetch(`${base}/api/games/${pin}`)).json();
  const floorsNow = Math.floor(stillThere.towers[team].blocks.length / (stillThere.towerSlots || 4));
  ok('a block dropped while he is up there lands nowhere',
     stolen.ape === true && floorsNow === floorsBefore,
     `${floorsBefore} floors before, ${floorsNow} after`);

  // and he is on the board, not only in the game state
  await board.waitForTimeout(1200);
  const onBoard = await board.evaluate(() => {
    const c = document.getElementById('board-tower');
    if (!c) return { ok: false };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let fur = 0, column = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 11) {
      n++;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      // his coat: a dark warm grey-purple, well off the blue of the sky
      if (r > 44 && r < 80 && g > 36 && g < 66 && b > 42 && b < 76
          && r >= g + 4 && b >= g) fur++;
      // and the green column, which is a wash rather than a solid
      if (g > 90 && g > r + 30 && g > b + 20) column++;
    }
    return { ok: true, fur: fur / n, column: column / n };
  });
  ok('the gorilla is drawn on the board, sitting on the tower he took',
     onBoard.ok && onBoard.fur > 0.002, `${(onBoard.fur * 100).toFixed(2)}% of him`);
  ok('and the green column is up on the towers he is not on',
     onBoard.ok && onBoard.column > 0.004, `${(onBoard.column * 100).toFixed(2)}% green`);
  await board.screenshot({ path: path.join(__dirname, 'shots', 'tower-gorilla.png') }).catch(() => {});

  await board.screenshot({ path: path.join(__dirname, 'shots', 'tower-board.png') }).catch(() => {});
  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
