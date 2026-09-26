/* A lesson somewhere else, turned into a game here.
 *
 * The whole request travels inside the address: no server talks to another
 * server and no key is shared, so a link works from a worksheet, a chat message
 * or a QR code on a wall, and nothing has to be up for it.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { Server } = require('../server.js');
global.window = global.window || global;
require('../../static/quizbank.js');
const B = require('../../static/bridge.js');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const WORDS = [['мышык', 'cat'], ['ит', 'dog'], ['ат', 'horse'], ['кой', 'sheep'], ['балык', 'fish']];

(async () => {
  /* ── reading a request ── */
  const pairs = B.readRequest('?from=learnkyrgyz&title=Lesson 4&pairs=' +
    encodeURIComponent(WORDS.map(([a, b]) => `${a}:${b}`).join(',')));
  ok('a link can carry a lesson\'s own words', pairs.pairs.length === 5,
     `${pairs.pairs.length} pairs, from ${pairs.from}`);
  ok('and Cyrillic survives the trip', pairs.pairs[0][0] === 'мышык', pairs.pairs[0].join(' = '));

  const quiz = B.quizFrom(pairs);
  ok('which becomes a quiz', quiz && quiz.questions.length >= 8,
     quiz ? `${quiz.questions.length} questions titled "${quiz.title}"` : 'nothing');

  /* Both directions, because reading a word and reaching for it are two
     different things to know. */
  const asksMeaning = quiz.questions.filter(q => /What does/.test(q.text)).length;
  const asksSaying = quiz.questions.filter(q => /How do you say/.test(q.text)).length;
  ok('asked both ways round', asksMeaning > 0 && asksSaying > 0,
     `${asksMeaning} meaning, ${asksSaying} saying`);

  /* Every wrong answer has to come from the same set, or a child picks the odd
     one out without knowing a word of it. */
  const kg = new Set(WORDS.map(w => w[0])), en = new Set(WORDS.map(w => w[1]));
  const sane = quiz.questions.every(q => {
    const texts = q.choices.map(c => c.text);
    return texts.every(t => kg.has(t)) || texts.every(t => en.has(t));
  });
  ok('and the wrong answers are the other words, not something obvious', sane);
  ok('exactly one right answer each',
     quiz.questions.every(q => q.choices.filter(c => c.correct).length === 1));
  ok('and the answer is not always the first tile',
     new Set(quiz.questions.map(q => q.choices.findIndex(c => c.correct))).size > 1);

  /* ── a topic instead of words ── */
  const topic = B.quizFrom(B.readRequest('?from=learnkyrgyz&topic=Kyrgyz animals&year=3&n=8'));
  ok('a topic alone is enough, the app writes the questions',
     topic && topic.questions.length === 8, topic ? topic.questions[0].text : 'nothing');
  ok('and a Kyrgyz topic stays Kyrgyz rather than becoming an English one',
     topic.questions.some(q => /[Ѐ-ӿ]/.test(JSON.stringify(q))),
     topic.questions[0].text);

  ok('too few words is refused rather than fudged',
     B.quizFrom(B.readRequest('?pairs=' + encodeURIComponent('бир:one,эки:two'))) === null);
  ok('and a link with nothing in it asks for nothing',
     B.quizFrom(B.readRequest('?from=learnkyrgyz')) === null);

  /* ── the link, built from the other side ── */
  const made = B.link({ from: 'learnkyrgyz', title: 'Lesson 4', pairs: WORDS, mode: 'boss' });
  ok('the other site can build the link without knowing how any of this is spelled',
     made.startsWith('https://quoldek.web.app/start?') && made.includes('pairs='), made.slice(0, 64) + '…');
  const back = B.readRequest(made.split('?')[1]);
  ok('and what comes back out is what went in',
     back.pairs.length === 5 && back.title === 'Lesson 4' && back.mode === 'boss');

  /* ── and the page a teacher actually lands on ── */
  fs.rmSync('/tmp/claude-0/bridgetest', { recursive: true, force: true });
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/bridgetest', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const query = '?from=learnkyrgyz&title=' + encodeURIComponent('Kyrgyz · Lesson 4') +
    '&pairs=' + encodeURIComponent(WORDS.map(([a, b]) => `${a}:${b}`).join(','));
  await page.goto(`${base}/start.html${query}`, { waitUntil: 'domcontentloaded' });
  await sleep(900);

  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok('the page names what arrived and where it came from',
     /Kyrgyz · Lesson 4/.test(text) && /learnkyrgyz/.test(text), text.slice(0, 90));
  ok('and shows the questions before doing anything with them',
     (await page.locator('.peek .q').count()) === 3);

  const before = await (await fetch(`${base}/api/quizzes`)).json();
  ok('nothing is written down just by opening the link',
     (before.quizzes || []).length === 0, `${(before.quizzes || []).length} quizzes`);

  await page.locator('button:has-text("Just save it")').click();
  await sleep(2500);
  const after = await (await fetch(`${base}/api/quizzes`)).json();
  ok('pressing the button saves it', (after.quizzes || []).length === 1,
     (after.quizzes || []).map(q => q.title).join(', '));
  ok('with all of its questions', ((after.quizzes || [])[0] || {}).questions >= 8,
     `${((after.quizzes || [])[0] || {}).questions} questions`);
  ok('and it lands in the studio ready to host',
     /studio(\.html)?\?id=/.test(page.url()), page.url().split('/').pop());

  ok('no errors on the page', errs.length === 0, errs.slice(0, 2).join(' | '));
  await page.goto(`${base}/start.html${query}`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'bridge-start.png') }).catch(() => {});

  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
