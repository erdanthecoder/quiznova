/* Robot Run, with the class answering and then stopping dead.
 *
 * The complaint this mode was rebuilt around was "the robot doesn't even come
 * closer", so the claim worth being able to read off a screen is: a class that
 * answers shoves it back, and a class that stops gets caught. This plays both
 * halves, measures the gap the whole way through, and films it.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = path.join(__dirname, 'films');
const SIZE = { width: 1280, height: 720 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  fs.rmSync('/tmp/claude-0/chasetest', { recursive: true, force: true });
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/chasetest', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  const quiz = await post('/api/quizzes', { title: 'Lesson', starter: false, questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  await post(`/api/quizzes/${qid}/ops`, { ops: [
    ['What is 6 x 7?', '42'], ['Capital of Japan?', 'Tokyo'], ['Half of 90?', '45'],
    ['Biggest ocean?', 'Pacific'], ['9 + 8?', '17'], ['Opposite of ancient?', 'Modern'],
    ['12 x 3?', '36'], ['Colour of a ruby?', 'Red']
  ].map(([text, right]) => ({ op: 'add_question', question: {
    type: 'mc', text, points: 100, time: 30,
    choices: [{ text: right, correct: true }, { text: 'Not that' }, { text: 'Nor that' }] } })) });

  const made = await post('/api/games', { quizId: qid, mode: 'robot', map: 'station' });
  const pin = made.pin, ht = made.hostToken;

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const ctx = await browser.newContext({ viewport: SIZE,
    recordVideo: { dir: path.join(OUT, '_raw'), size: SIZE } });
  const board = await ctx.newPage();
  const errs = []; board.on('pageerror', e => errs.push(e.message));
  await board.goto(`${base}/host.html?pin=${pin}#h=${ht}`, { waitUntil: 'domcontentloaded' });
  await sleep(800);

  const phones = [];
  for (const name of ['Ana', 'Ben', 'Cal', 'Dee']) {
    const p = await browser.newPage({ viewport: { width: 400, height: 850 }, hasTouch: true, isMobile: true });
    await p.goto(`${base}/play.html?pin=${pin}`, { waitUntil: 'domcontentloaded' });
    await sleep(250);
    await p.locator('input').first().fill(name);
    await p.locator('button:has-text("Join the game")').first().click();
    phones.push({ name, page: p });
  }
  await sleep(900);
  await post(`/api/games/${pin}/start`, { hostToken: ht });
  await sleep(2200);

  /** Where the robot is, read off the board's own engine. */
  const chase = () => board.evaluate(() => (window.boardRun && boardRun.chase) || null)
    .catch(() => null);
  /* boardRun is module-scope, so ask the engine through the canvas instead. */
  const gap = async () => board.evaluate(() => {
    const c = document.getElementById('board-run');
    return c && c.__chase ? c.__chase() : null;
  });

  // the runners are on screen before anything else is claimed about them
  const seen = await board.evaluate(() => {
    const c = document.getElementById('board-run');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let on = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 31) { n++; if (d[i] + d[i + 1] + d[i + 2] > 60) on++; }
    return { painted: Math.round(on / n * 100), w: c.width, h: c.height };
  });
  ok('the chase is on the board', seen && seen.painted > 10, seen && seen.painted + '% painted');
  const names = await board.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok('and every runner is named on it',
     ['Ana', 'Ben', 'Cal', 'Dee'].every(n => names.includes(n)), names.slice(0, 90));

  await board.screenshot({ path: path.join(__dirname, 'shots', 'chase-start.png') });

  /* ── they answer, and shove it back ── */
  console.log('\n  the class is answering');
  const answerAndBoost = async () => {
    for (const { page } of phones) {
      await page.evaluate(async () => {
        const q = game.question; if (!q) return;
        const pick = q.choices.find(c => !/Not that|Nor that/.test(c.text)) || q.choices[0];
        await Nova.api(`/games/${game.pin}/answer`, { method: 'POST',
          body: { playerId: me.id, questionId: q.id, answer: pick.id, speed: 0.6 } });
        await new Promise(r => setTimeout(r, 150));
        window.__seq = (window.__seq || 0) + 1;
        await Nova.api(`/games/${game.pin}/boost`, { method: 'POST',
          body: { playerId: me.id, seq: window.__seq } }).catch(() => {});
      }).catch(() => {});
    }
  };
  for (let i = 0; i < 3; i++) { await answerAndBoost(); await sleep(900); }
  await sleep(600);
  const running = await gap();
  await board.screenshot({ path: path.join(__dirname, 'shots', 'chase-running.png') });

  /* ── and now nobody answers at all ── */
  console.log('  and now nobody answers');
  /* Long enough for the deck's own clock to run out, because that is the half
     of the rule worth seeing: boosts shove it back, and the clock brings it in
     whatever the bar says. Thirty seconds of silence only shows the first half. */
  const track = [];
  for (let i = 0; i < 34; i++) {
    await sleep(2000);
    const g = await gap();
    if (g) track.push(g);
    if (i === 10) await board.screenshot({ path: path.join(__dirname, 'shots', 'chase-closing.png') });
    if (g && g.danger > 0.8) { await board.screenshot({ path: path.join(__dirname, 'shots', 'chase-onTop.png') }); }
  }
  await board.screenshot({ path: path.join(__dirname, 'shots', 'chase-caught.png') });

  if (running && track.length) {
    const first = track[0], last = track[track.length - 1];
    console.log(`\n  gap while they were answering: ${(running.gap * 100).toFixed(1)}% of the screen`);
    console.log(`  gap once they stopped:         ${(first.gap * 100).toFixed(1)}% → ${(last.gap * 100).toFixed(1)}%`);
    ok('a class that answers keeps it at arm\'s length', running.gap > 0.18,
       `${(running.gap * 100).toFixed(1)}% of the screen behind them`);
    ok('and a class that stops watches it close in', last.gap < first.gap - 0.02,
       `${(first.gap * 100).toFixed(1)}% → ${(last.gap * 100).toFixed(1)}%`);
    const nearest = track.reduce((a, b) => b.gap < a.gap ? b : a, track[0]);
    ok('and at its nearest the board is bleeding red',
       nearest.danger > 0.5,
       `closest gap ${(nearest.gap * 100).toFixed(1)}%, dread ${(nearest.danger * 100).toFixed(0)}%`);
  } else {
    ok('the chase could be measured', false, 'no reading came back');
  }
  /* ── and then what happens ──
     A deck whose clock runs out costs the class a life. Up to now that was a
     heart quietly leaving a row, which is the same amount of nothing as a page
     reloading — so the one event the mode is built around went past without
     the room noticing. */
  const live = [...srv.games.games.values()].find(x => x.pin === pin) || null;
  ok('the class still has lives to lose', live && live.lives > 0, live ? live.lives + ' left' : 'no game');
  const livesBefore = live ? live.lives : 0;
  if (live) { live.roundEndsAt = Date.now() - 10; }
  await post(`/api/games/${pin}/tick`, { hostToken: ht });
  await sleep(500);
  ok('running out of clock costs the class a life',
     live && live.lives === livesBefore - 1, live ? `${livesBefore} → ${live.lives}` : '');
  const scare = await board.evaluate(() => {
    const c = document.getElementById('board-run');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let red = 0, bright = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 17) {
      n++;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r > 150 && g < 90 && b < 90) red++;
      if (r + g + b > 600) bright++;
    }
    return { red: red / n, bright: bright / n,
             says: document.body.innerText.includes('IT GOT YOU') };
  });
  ok('and it comes for the camera rather than taking a heart quietly',
     scare && scare.red > 0.02, scare ? `${(scare.red * 100).toFixed(1)}% of the board is its eye` : 'nothing');
  await board.screenshot({ path: path.join(__dirname, 'shots', 'chase-jumpscare.png') });
  await sleep(2200);
  const after = await board.evaluate(() => {
    const c = document.getElementById('board-run');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let red = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 17) {
      n++; if (d[i] > 150 && d[i + 1] < 90 && d[i + 2] < 90) red++;
    }
    return red / n;
  });
  ok('and then it lets go and the deck starts again',
     after < (scare ? scare.red : 1), `${((scare ? scare.red : 0) * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%`);

  ok('no errors on the board', errs.length === 0, errs.slice(0, 2).join(' | '));

  for (const { page } of phones) await page.close();
  const v = board.video();
  await ctx.close();
  if (v) await v.saveAs(path.join(OUT, 'robot-run-chase.webm')).catch(() => {});
  await browser.close();
  fs.rmSync(path.join(OUT, '_raw'), { recursive: true, force: true });
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
