/* Classic Quiz, and the three screens every mode shares.
 *
 * Four modes had an S+ pass and this one had never been touched, which is
 * awkward given it is the one a teacher reaches for on a Tuesday morning. The
 * things checked here were all found by playing a game and looking at it
 * rather than by any test failing, so this is the net under them.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.rmSync('/tmp/claude-0/classictest', { recursive: true, force: true });
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/classictest', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  const quiz = await post('/api/quizzes', { title: 'Lesson', starter: false, questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  const RIGHT = ['56', 'Paris', 'Jupiter'];
  const asks = [['What is 7 x 8?', '56', '48', '63', '42'],
                ['Capital of France?', 'Paris', 'Lyon', 'Nice', 'Rome'],
                ['Which planet is biggest?', 'Jupiter', 'Mars', 'Venus', 'Earth']];
  await post(`/api/quizzes/${qid}/ops`, { ops: asks.map(([text, ...opts]) => ({
    op: 'add_question', question: { type: 'mc', text, points: 100, time: 20,
      choices: opts.map((t, i) => ({ text: t, correct: i === 0 })) } })) });

  const made = await post('/api/games', { quizId: qid, mode: 'normal', map: '' });
  const pin = made.pin, ht = made.hostToken;

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const board = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; board.on('pageerror', e => errs.push(e.message));
  await board.goto(`${base}/host.html?pin=${pin}#h=${ht}`, { waitUntil: 'domcontentloaded' });
  await sleep(700);

  const phones = [];
  for (const name of ['Ana', 'Ben', 'Cal', 'Dee', 'Eli']) {
    const p = await browser.newPage({ viewport: { width: 400, height: 850 }, hasTouch: true, isMobile: true });
    await p.goto(`${base}/play.html?pin=${pin}`, { waitUntil: 'domcontentloaded' });
    await sleep(250);
    await p.locator('input').first().fill(name);
    await p.locator('button:has-text("Join the game")').first().click();
    phones.push(p);
  }
  await sleep(1000);

  /* ── the lobby ──
     A class waiting wants something to look at; a teacher wants to see who is
     still missing. Both, but not the same list twice. */
  const onFloor = await board.locator('.stage3d .who, .stage3d .name, .stage3d').count();
  const named = await board.evaluate(() => {
    const floor = [...document.querySelectorAll('.lobby .waiting')]
      .map(n => n.textContent).join(' ');
    const strip = [...document.querySelectorAll('.lobby .crowd .face')].map(n => n.textContent);
    return { onFloor: ['Ana', 'Ben', 'Cal', 'Dee', 'Eli'].filter(n => floor.includes(n)),
             inStrip: strip };
  });
  ok('the lobby stands everybody on the floor they are about to play on',
     named.onFloor.length === 5, named.onFloor.join(', '));
  ok('and does not print the whole class a second time underneath',
     named.inStrip.length === 0, `${named.inStrip.length} chips as well`);

  await post(`/api/games/${pin}/start`, { hostToken: ht });
  await sleep(1800);

  /* ── how far through ── */
  const chip = await board.locator('#goal');
  ok('the board says which question the class is on',
     (await chip.textContent()).trim() === 'Question 1 of 3',
     (await chip.textContent()).trim());

  const answerAll = async (rightCount) => {
    for (let i = 0; i < phones.length; i++) {
      await phones[i].evaluate(async ([right, RIGHT]) => {
        const q = game.question; if (!q) return;
        const pick = right ? q.choices.find(c => RIGHT.includes(c.text))
                           : q.choices.find(c => !RIGHT.includes(c.text));
        if (!pick) return;
        await Nova.api(`/games/${game.pin}/answer`, { method: 'POST',
          body: { playerId: me.id, questionId: q.id, answer: pick.id, speed: 0.4 + Math.random() * 0.4 } });
      }, [i < rightCount, RIGHT]).catch(() => {});
    }
  };
  await answerAll(4);
  /* The board's state lives in a module-scope variable, not on window, so the
     thing to wait for is what the room can see: the answer lit up and the
     button offering the next question. */
  await board.waitForSelector('.board.result', { timeout: 12000 });
  await sleep(1200);

  /* ── the phone between questions ──
     Where you are and how far off the one in front is the reason a room leans
     in. Printing it twice on one screen is not twice the reason. */
  const said = await phones[0].evaluate(() => {
    const standing = document.querySelectorAll('.standing').length;
    const position = [...document.querySelectorAll('.card')]
      .filter(n => /Your position/.test(n.textContent)).length;
    return { standing, position, text: document.body.innerText.replace(/\s+/g, ' ') };
  });
  ok('the phone tells a child where they are and what the gap is',
     said.standing === 1, `${said.standing} standing panels`);
  ok('and only says it once', said.position === 0,
     said.position ? 'a second "Your position" panel as well' : 'no repeat');
  ok('with the answer and why, under it', /Answer/.test(said.text) && /56/.test(said.text));

  await post(`/api/games/${pin}/next`, { hostToken: ht });
  await sleep(1200);
  ok('and the count moves on with the quiz',
     (await board.locator('#goal').textContent()).trim() === 'Question 2 of 3',
     (await board.locator('#goal').textContent()).trim());

  /* ── the ending, which every mode shares ── */
  await answerAll(3);
  await sleep(900);
  await post(`/api/games/${pin}/next`, { hostToken: ht });
  await sleep(900);
  await answerAll(5);
  await sleep(900);
  await post(`/api/games/${pin}/end`, { hostToken: ht });
  await sleep(2600);

  const fits = await board.evaluate(() => {
    const seen = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { bottom: Math.round(r.bottom), top: Math.round(r.top), h: Math.round(r.height) };
    };
    const buttons = [...document.querySelectorAll('.finale .row .btn')].map(b => {
      const r = b.getBoundingClientRect();
      return { text: b.textContent.trim(), bottom: Math.round(r.bottom) };
    });
    const rest = document.querySelector('.finale .rest');
    return { crown: seen('.crown'), podium: seen('.podium'), buttons,
             restH: rest ? Math.round(rest.getBoundingClientRect().height) : 0,
             restScroll: rest ? rest.scrollHeight : 0,
             viewport: window.innerHeight, over: document.body.scrollHeight - window.innerHeight };
  });
  ok('the ending puts the winner on a podium', fits.podium && fits.podium.h > 150,
     fits.podium ? fits.podium.h + 'px tall' : 'no podium');
  ok('and the whole of it fits one screen, buttons included',
     fits.buttons.length >= 1 && fits.buttons.every(b => b.bottom <= fits.viewport),
     fits.buttons.map(b => `${b.text} ends at ${b.bottom} of ${fits.viewport}`).join(' · '));
  ok('a teacher is not scrolling a board in front of a class',
     fits.over <= 4, `the page runs ${fits.over}px past the screen`);
  ok('everyone below third place is still reachable',
     fits.restH > 40, `the panel is ${fits.restH}px tall`);

  ok('no errors anywhere in that', errs.length === 0, errs.slice(0, 2).join(' | '));
  await board.screenshot({ path: path.join(__dirname, 'shots', 'classic-over.png') }).catch(() => {});

  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
