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

  await board.screenshot({ path: path.join(__dirname, 'shots', 'tower-board.png') }).catch(() => {});
  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
