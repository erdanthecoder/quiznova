/* Where the right answer goes.
 *
 * The complaint was "questions are not randomised, they are only same red,
 * blue and others", and it was exactly right: the question engine built its
 * options as [correct, ...wrongs] and handed them back in that order, so the
 * right answer was the first tile — the red triangle — in every question it
 * has ever written. A class works that out in about four questions and then
 * stops reading the question.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { Server } = require('../server.js');
const R = require('../../static/rules.js');
global.window = global.window || global;
const Bank = require('../../static/quizbank.js');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** How evenly a set of positions is spread, 0 (all one place) to 1 (even). */
const spread = (counts, slots) => {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const want = 1 / slots;
  const off = counts.reduce((n, c) => n + Math.abs(c / total - want), 0);
  return 1 - off / (2 * (1 - want));
};

(async () => {
  /* ── the engine that writes the questions ── */
  for (const topic of ['times tables year 4', 'capital cities year 4',
                       'addition year 2', 'opposites year 3']) {
    const spots = [0, 0, 0, 0];
    for (let i = 0; i < 300; i++) {
      const q = Bank.generate(topic, 1, []).questions[0];
      if (q) spots[q.options.indexOf(q.correct)]++;
    }
    const even = spread(spots, 4);
    ok(`the answer moves about in "${topic}"`, even > 0.75,
       spots.map(n => Math.round(n / 3) + '%').join(' / '));
  }

  /* ── and a quiz that was written with the answer first ── */
  const first = () => ({ id: 'q1', type: 'mc', text: 'Capital of France?', points: 100, time: 20,
    choices: [{ id: 'a', text: 'Paris', correct: true }, { id: 'b', text: 'Lyon' },
              { id: 'c', text: 'Nice' }, { id: 'd', text: 'Rome' }] });
  const setup = R.readSetup({});
  ok('a game shuffles the answers unless it is told not to', setup.mix === true);
  const spots = [0, 0, 0, 0];
  for (let i = 0; i < 300; i++) {
    const out = R.arrange([first()], setup);
    spots[out[0].choices.findIndex(c => c.correct)]++;
  }
  ok('so even a quiz written answer-first is fair at the table',
     spread(spots, 4) > 0.75, spots.map(n => Math.round(n / 3) + '%').join(' / '));

  /* ── except where the order is the question ── */
  const above = { id: 'q2', type: 'mc', text: 'Which are mammals?', points: 100, time: 20,
    choices: [{ id: 'a', text: 'A cat' }, { id: 'b', text: 'A dog' },
              { id: 'c', text: 'A whale' }, { id: 'd', text: 'All of the above', correct: true }] };
  ok('a question whose options mean something in that order is left alone',
     R.orderMatters(above) === true);
  let moved = 0;
  for (let i = 0; i < 60; i++) {
    const out = R.arrange([JSON.parse(JSON.stringify(above))], setup);
    if (out[0].choices[3].text !== 'All of the above') moved++;
  }
  ok('and it stays put every single time', moved === 0, `${moved} of 60 moved`);
  ok('while an ordinary question is not spared', R.orderMatters(first()) === false);

  /* ── the shuffle itself ── */
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    seen.add(R.arrange([first()], setup)[0].choices.map(c => c.id).join(''));
  }
  ok('every one of the 24 orders comes up, so it is a real shuffle',
     seen.size === 24, `${seen.size} different orders in 500 goes`);

  /* ── and on the board a class is actually looking at ── */
  fs.rmSync('/tmp/claude-0/shuffletest', { recursive: true, force: true });
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/shuffletest', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  const quiz = await post('/api/quizzes', { title: 'Lesson', starter: false, questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  await post(`/api/quizzes/${qid}/ops`, { ops: [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
    op: 'add_question', question: { type: 'mc', text: `Question ${n}`, points: 100, time: 30,
      choices: [{ text: 'right', correct: true }, { text: 'wrong one' },
                { text: 'wrong two' }, { text: 'wrong three' }] } })) });

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const where = [0, 0, 0, 0];
  for (let g = 0; g < 6; g++) {
    const made = await post('/api/games', { quizId: qid, mode: 'normal', map: '' });
    const view = await (await fetch(`${base}/api/games/${made.pin}`)).json();
    // the game's own copy, which is what every board and phone is served
    const live = [...srv.games.games.values()].find(x => x.pin === made.pin);
    live.questions.forEach(q => {
      const at = q.choices.findIndex(c => c.correct);
      if (at >= 0) where[at]++;
    });
  }
  ok('across six real games the answer is spread over all four tiles',
     where.every(n => n > 0) && spread(where, 4) > 0.6,
     where.map(n => Math.round(n / 48 * 100) + '%').join(' / '));

  /* ── and starting one takes two presses, not three ── */
  const made = await post('/api/games', { quizId: qid, mode: 'normal', map: '' });
  await page.goto(`${base}/host.html?pin=${made.pin}#h=${made.hostToken}`, { waitUntil: 'domcontentloaded' });
  await sleep(900);
  ok('no errors on the board', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
