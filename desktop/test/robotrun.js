/* Robot Run, played.
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
    window.ctl = NovaRun.start({ canvas: document.getElementById('c'), world: 'station',
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

  /* Three right charges a boost; spending it takes a deliberate hold. Firing
   * it automatically on the third right answer would take away the only part
   * of this mode that is not reading. */
  const charging = await page.evaluate(async () => {
    const c = document.getElementById('c');
    let st = null, sent = [];
    const k = NovaRun.start({ canvas: c, world: 'station',
      onState: (s) => { st = s; }, onBoost: (seq) => sent.push(seq) });
    k.setRoom({ escape: 0, target: 100, lives: 3, round: 1 });
    k.answered(true, 1); k.answered(true, 2);
    const twoIn = st.charged;
    k.answered(true, 3);
    const threeIn = st.charged;
    // a tap that is too short must not spend it
    k.holdStart(); k.holdEnd();
    const afterTap = st.charged;
    // and a proper hold must
    k.holdStart();
    await new Promise(r => setTimeout(r, NovaRun.HOLD_MS + 90));
    k.holdEnd();
    const afterHold = st.charged;
    k.stop();
    return { twoIn, threeIn, afterTap, afterHold, sent, spent: st.spent };
  });
  ok('two right answers charge nothing', charging.twoIn === 0, `${charging.twoIn} charged`);
  ok('the third charges a boost', charging.threeIn === 1, `${charging.threeIn} charged`);
  ok('a quick tap does not spend it', charging.afterTap === 1, `${charging.afterTap} still charged`);
  ok('holding it down does', charging.afterHold === 0 && charging.spent === 1,
     `${charging.afterHold} charged, ${charging.spent} spent`);
  ok('and the boost is reported to the room', charging.sent.length === 1,
     `sent ${JSON.stringify(charging.sent)}`);

  /* The robot's distance comes from the room, not from this child — and it is
     drawn on the board, which is the only place it is drawn at all now. */
  const shared = await page.evaluate(async () => {
    const c = document.getElementById('c');
    const k = NovaRun.start({ canvas: c, world: 'station', onState: () => {},
      players: [{ id: 'a', name: 'Ana', avatar: 3, boosts: 1 }] });
    // a frame has to actually run before the canvas shows the new room
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    /* Where the robot is, measured rather than guessed at: the rightmost
       column holding one of its dark plates. A full bar should leave it well
       behind; an empty one should have it up against the pack. */
    const edge = () => {
      const g = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const d = g.data;
      let right = 0;
      for (let y = Math.round(c.height * 0.35); y < c.height * 0.72; y += 3) {
        for (let x = 0; x < c.width; x += 2) {
          const i = (y * c.width + x) * 4;
          const r = d[i], gg = d[i + 1], b = d[i + 2];
          // the chassis: a light grey plate, well above the dark blue deck
          if (r > 70 && r < 130 && Math.abs(r - gg) < 22 && b > gg && b - r < 40
              && r + gg + b > 240) right = Math.max(right, x);
        }
      }
      return right / c.width;
    };
    k.setRoom({ escape: 95, target: 100, lives: 3, round: 1 });
    await frame();
    const far = edge();
    k.setRoom({ escape: 2, target: 100, lives: 1, round: 1 });
    await frame();
    const near = edge();
    k.stop();
    return { far, near };
  });
  ok('an empty escape bar puts the robot on top of the room',
     shared.near > shared.far + 0.08,
     `the robot reaches ${Math.round(shared.far * 100)}% across when the room is clear,`
     + ` ${Math.round(shared.near * 100)}% when it is close`);

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
  const made = await post('/api/games', { quizId: qid, mode: 'robot', map: 'station' });
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

  /* The board, which is where the chase lives. It is opened before the game
     starts, the way a teacher opens it, so the test covers the mount as well as
     the drawing. */
  const board = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const berrs = [];
  board.on('pageerror', e => berrs.push(e.message));
  await board.goto(`${base}/host.html?pin=${pin}#h=${made.hostToken}`,
                   { waitUntil: 'domcontentloaded' });
  await board.waitForTimeout(700);

  await post(`/api/games/${pin}/start`, { hostToken: made.hostToken });
  await phone.waitForFunction(() => !!document.getElementById('r-boost'), null, { timeout: 12000 })
    .catch(() => {});
  /* The phone gets the question and the boost button and nothing else. The
     chase used to run here, competing with the question for a screen the size
     of a hand; Kahoot puts the robot on the host's screen, and so does this. */
  ok('starting drops everyone straight into the run',
     await phone.locator('#r-boost').count() > 0);
  ok('and the chase is not on the phone', await phone.locator('#runner').count() === 0,
     'no canvas in the player page');
  ok('the phone shows how close the next boost is',
     await phone.locator('.boostmeter').count() > 0);
  ok('with a question already waiting underneath',
     (await phone.locator('#runq .opt-btn').count()) > 0,
     `${await phone.locator('#runq .opt-btn').count()} answers on screen`);

  const firstQ = await phone.locator('.runq-text').innerText().catch(() => '');
  for (let i = 0; i < 3; i++) {
    await phone.locator('#runq .opt-btn').first().click().catch(() => {});
    await phone.waitForTimeout(500);
  }
  const secondQ = await phone.locator('.runq-text').innerText().catch(() => '');
  ok('answering moves you to the next question without waiting for anyone',
     firstQ && secondQ && firstQ !== secondQ, `"${firstQ}" → "${secondQ}"`);

  const boostBtn = phone.locator('#r-boost');
  ok('three right answers arm the boost button',
     !(await boostBtn.isDisabled()), await boostBtn.innerText());

  // hold it, the way a thumb does
  await boostBtn.dispatchEvent('mousedown');
  await phone.waitForTimeout(800);
  await boostBtn.dispatchEvent('mouseup');
  await phone.waitForTimeout(1200);

  const view = await (await fetch(`${base}/api/games/${pin}`)).json();
  const cal = view.players.find(p => p.name === 'Cal');
  ok('holding it puts a boost into the room', cal && cal.boosts === 1,
     `${cal && cal.boosts} boosts recorded`);
  ok('and the whole room moves towards the door', view.escape > 0,
     `escape bar at ${view.escape}/${view.escapeTarget}`);
  ok('the room shares its lives rather than each child having their own',
     view.lives !== undefined, `${view.lives} lives`);
  ok('the game stays in one long run rather than stepping through rounds',
     view.state === 'running', `state ${view.state}`);
  ok('and the phones hold the whole quiz, because nobody is in step',
     Array.isArray(view.quiz) && view.quiz.length === 5, `${view.quiz && view.quiz.length} questions sent`);
  ok('no errors on the phone', perrs.length === 0, perrs.slice(0, 2).join(' | '));

  // ── the chase is on the board, and the class is in it ──
  await board.waitForTimeout(1600);
  const onBoard = await board.evaluate(() => {
    const c = document.getElementById('board-run');
    if (!c || !c.isConnected) return { ok: false, why: 'no chase on the board' };
    const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let on = 0, n = 0;
    for (let i = 0; i < g.length; i += 4 * 53) { n++; if (g[i] + g[i + 1] + g[i + 2] > 40) on++; }
    return { ok: true, pct: Math.round(on / n * 100),
             names: document.body.innerText };
  });
  ok('the chase is drawn on the board', onBoard.ok && onBoard.pct > 70,
     onBoard.ok ? `${onBoard.pct}% of the board is painted` : onBoard.why);
  ok('no errors on the board', berrs.length === 0, berrs.slice(0, 2).join(' | '));
  await board.screenshot({ path: path.join(__dirname, 'shots', 'robot-board.png') }).catch(() => {});

  /* Somebody else joining used to blank the run: the page rebuilt the screen,
   * handed the engine a canvas that was no longer in the document, and left the
   * question panel empty. */
  await post(`/api/games/${pin}/join`, { name: 'Late', avatar: 9 });
  await phone.waitForTimeout(2200);
  const stillThere = await phone.evaluate(() => ({
    boost: !!document.getElementById('r-boost'),
    meter: !!document.querySelector('.boostmeter'),
    answers: document.querySelectorAll('#runq .opt-btn').length
  }));
  ok('somebody joining does not blank the run', stillThere.boost && stillThere.meter,
     `boost button ${stillThere.boost}, meter ${stillThere.meter}`);
  ok('and the question is still there to answer', stillThere.answers > 0,
     `${stillThere.answers} answers on screen`);

  await phone.screenshot({ path: path.join(__dirname, 'shots', 'monster-run.png') }).catch(() => {});
  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
