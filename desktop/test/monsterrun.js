/* Monster Run, played.
 *
 * The claim is that this is a game and not a quiz with a picture over it, so
 * what gets checked is the game: that the chase draws, that three right in a
 * row is worth much more than three right answers spread out, that being wrong
 * lets it close, that the level really does change, and that a class can all be
 * on different questions at once — which is the whole reason it exists.
 */
const path = require('path');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const ROOT = path.join(__dirname, '..', '..');
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };

const PAGE = `<!doctype html><body style="margin:0;background:#000">
<canvas id="c" style="width:420px;height:300px;display:block"></canvas></body>`;

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: false });

  // ── the engine on its own ──
  const page = await browser.newPage({ viewport: { width: 500, height: 400 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setContent(PAGE);
  await page.addScriptTag({ path: path.join(ROOT, 'static/run.js') });

  await page.evaluate(() => {
    window.levels = [];
    window.ctl = NovaRun.start({ canvas: document.getElementById('c'), world: 'sewer',
      level: 1, onState: (s) => { window.last = s; }, onLevel: (l) => window.levels.push(l) });
  });
  await page.waitForTimeout(500);
  const NovaRun_RIGHT = await page.evaluate(() => NovaRun.RIGHT_GAIN);
  const NovaRun_METRES = await page.evaluate(() => NovaRun.METRES);

  const lit = await page.evaluate(() => {
    const c = document.getElementById('c');
    const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let on = 0, n = 0, cols = new Set();
    for (let i = 0; i < g.length; i += 4 * 53) {
      n++; if (g[i] + g[i+1] + g[i+2] > 24) on++;
      cols.add(`${g[i]>>4},${g[i+1]>>4},${g[i+2]>>4}`);
    }
    return { pct: Math.round(on / n * 100), cols: cols.size };
  });
  ok('the chase draws a world, not a black rectangle', lit.pct > 55, `${lit.pct}% lit`);
  ok('and it is a scene', lit.cols > 10, `${lit.cols} distinct colours`);

  // three right in a row must be worth far more than three scattered
  const compare = await page.evaluate(async () => {
    const run = (pattern) => {
      const c = document.createElement('canvas');
      c.style.cssText = 'width:300px;height:200px;display:block';
      document.body.append(c);
      let st = null;
      const k = NovaRun.start({ canvas: c, world: 'sewer', level: 1,
        onState: (s) => { st = s; } });
      pattern.forEach(right => k.answered(right));
      k.stop(); c.remove();
      return st ? st.distance : 0;
    };
    return { streak: run([true, true, true]),
             broken: run([true, true, false, true]) };
  });
  ok('three right in a row sprints you well past three scattered ones',
     compare.streak > compare.broken * 2,
     `in a row ${compare.streak}m, broken up ${compare.broken}m`);

  // the monster closes when you do nothing
  const closing = await page.evaluate(async () => {
    const before = window.last.gap;
    await new Promise(r => setTimeout(r, 1500));
    return { before, after: window.last ? window.last.gap : before,
             now: window.ctl.state.gap };
  });
  ok('it gains on you while you are reading', closing.now < closing.before,
     `${Math.round(closing.before)} → ${Math.round(closing.now)}`);

  // four sprints finishes a stretch
  const levelled = await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) window.ctl.answered(true);
    await new Promise(r => setTimeout(r, 2600));
    return { levels: window.levels, level: window.ctl.state.level };
  });
  ok('four sprints carries you to the next level', levelled.level === 2,
     `level ${levelled.level}, hand-offs ${JSON.stringify(levelled.levels)}`);

  /* A child on a phone double-taps: an impatient thumb, a slow screen, a button
   * that redraws under them. Every extra tap used to be another sprint. */
  const spam = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.style.cssText = 'width:300px;height:200px;display:block';
    document.body.append(c);
    let st = null;
    const k = NovaRun.start({ canvas: c, world: 'city', level: 1, onState: (s) => { st = s; } });
    for (let i = 0; i < 12; i++) k.answered(true, 'q7');   // one question, twelve taps
    const after = st ? st.distance : 0;
    k.stop(); c.remove();
    return after;
  });
  const oneRight = Math.round(NovaRun_RIGHT * NovaRun_METRES);
  ok('hammering the button counts once, not twelve times', spam <= oneRight + 1,
     `twelve taps moved them ${spam}m; one answer is ${oneRight}m`);

  ok('no errors while running', errs.length === 0, errs.slice(0, 2).join(' | '));
  await page.close();

  // ── and the whole thing, through the real server and the real pages ──
  const srv = new Server({ root: path.join(ROOT, 'static'), dataDir: '/tmp/claude-0/rundata', port: 0 });
  const st = await srv.listen();
  const port = st && st.port ? st.port : st;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  const quiz = await post('/api/quizzes', { title: 'Run', questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  await post(`/api/quizzes/${qid}/ops`, { ops: [
    ...[1, 2, 3, 4, 5].map(n => ({ op: 'add_question', question: { type: 'mc',
      text: 'Question ' + n, points: 100, time: 25,
      choices: [{ text: 'Right', correct: true }, { text: 'Wrong' }] } })),
    { op: 'delete_question', at: 0 }] });
  const made = await post('/api/games', { quizId: qid, mode: 'monster', map: 'forest' });
  const pin = made.pin || made.game.pin;
  const ana = await post(`/api/games/${pin}/join`, { name: 'Ana', avatar: 3 });
  await post(`/api/games/${pin}/join`, { name: 'Ben', avatar: 5 });

  const phone = await browser.newPage({ viewport: { width: 390, height: 820 }, hasTouch: true });
  const perrs = [];
  phone.on('pageerror', e => perrs.push(e.message));
  await phone.goto(`${base}/play.html?pin=${pin}`, { waitUntil: 'domcontentloaded' });
  await phone.waitForTimeout(800);
  await phone.locator('input').first().fill('Cal');
  await phone.locator('button:has-text("Join the game")').first().click();
  await phone.waitForTimeout(900);

  await post(`/api/games/${pin}/start`, { hostToken: made.hostToken });
  await phone.waitForFunction(() => !!document.getElementById('runner'), null, { timeout: 12000 })
    .catch(() => {});
  ok('starting drops everyone straight into the run', await phone.locator('#runner').count() > 0);
  ok('with a question already waiting underneath',
     (await phone.locator('#runq .opt-btn').count()) > 0,
     `${await phone.locator('#runq .opt-btn').count()} answers on screen`);

  const firstQ = await phone.locator('.runq-text').innerText().catch(() => '');
  // answer three right, which should sprint
  for (let i = 0; i < 3; i++) {
    await phone.locator('#runq .opt-btn').first().click().catch(() => {});
    await phone.waitForTimeout(500);
  }
  const secondQ = await phone.locator('.runq-text').innerText().catch(() => '');
  ok('answering moves you to the next question without waiting for anyone',
     firstQ && secondQ && firstQ !== secondQ, `"${firstQ}" → "${secondQ}"`);

  const dist = await phone.locator('#r-dist').innerText().catch(() => '');
  ok('and the metres are going up', parseInt(dist, 10) > 0, `the phone reads "${dist}"`);

  await phone.waitForTimeout(3000);
  const view = await (await fetch(`${base}/api/games/${pin}`)).json();
  const cal = view.players.find(p => p.name === 'Cal');
  ok('the board is told how far they got', cal && cal.distance > 0,
     `${cal && cal.distance}m on the server`);
  ok('the game stays in one long run rather than stepping through rounds',
     view.state === 'running', `state ${view.state}`);
  ok('and the phones hold the whole quiz, because nobody is in step',
     Array.isArray(view.quiz) && view.quiz.length === 5, `${view.quiz && view.quiz.length} questions sent`);
  ok('no errors on the phone', perrs.length === 0, perrs.slice(0, 2).join(' | '));

  await phone.screenshot({ path: path.join(__dirname, 'shots', 'monster-run.png') }).catch(() => {});
  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
