/* Making a quiz — every way a teacher is offered.
 *
 * "Make sure that we can make quizzes. By sending a prompt from AI as you
 * remember or manual. By ourselves in the app." Three routes, and all three
 * have to end with a quiz that is still there after the page is closed and
 * opened again, because a quiz that was not written down is the fault that
 * emptied a whole term of work.
 *
 * This drives the built site, the same files the classroom loads.
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png',
                '.svg': 'image/svg+xml' };

function serve(dir) {
  return http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(dir, clean === '/' ? 'index.html' : clean);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const guess = file + '.html';
      file = fs.existsSync(guess) ? guess : path.join(dir, 'index.html');
    }
    try {
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); res.end('no'); }
  });
}

(async () => {
  const srv = serve(path.join(ROOT, 'docs'));
  await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${base}/quiznova.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  /* ── 1. by hand, through the page a teacher actually clicks ── */
  await page.locator('#top-new').first().click();
  await page.waitForTimeout(400);
  await page.locator('#t').fill('Year 4 fractions');
  await page.locator('#go').click();
  await page.waitForTimeout(1500);

  const madeByHand = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('nova:quizzes') || '{}');
    const list = Object.values(all);
    return { count: list.length, title: list.length ? list[list.length - 1].title : '',
             id: list.length ? list[list.length - 1].id : '',
             at: location.pathname + location.search };
  });
  ok('the New quiz button makes a quiz and writes it down',
     madeByHand.count >= 1 && madeByHand.title === 'Year 4 fractions',
     `${madeByHand.count} stored, newest "${madeByHand.title}"`);
  ok('and it opens the studio on the quiz it just made',
     /studio/.test(madeByHand.at) && madeByHand.at.includes(madeByHand.id),
     madeByHand.at);

  // a question added by hand, the way the studio does it
  const byHand = await page.evaluate(async (id) => {
    await Nova.api(`/quizzes/${id}/ops`, { method: 'POST', body: { ops: [
      { op: 'add_question', question: { type: 'mc', text: 'What is 1/2 of 8?', points: 100, time: 20,
        choices: [{ text: '4', correct: true }, { text: '2' }, { text: '6' }, { text: '8' }] } }] } });
    const back = await Nova.api(`/quizzes/${id}`);
    return { questions: back.questions.length, text: back.questions[back.questions.length - 1].text };
  }, madeByHand.id);
  ok('a question written by hand is added and kept', byHand.questions >= 1,
     `${byHand.questions} on the quiz, last one "${byHand.text}"`);

  /* ── 2. by asking for them, which is the AI route ── */
  const asked = await page.evaluate(async (id) => {
    const out = await Nova.api('/ai', { method: 'POST', body: {
      quizId: id, permission: 'auto',
      prompt: 'Add 5 multiple choice questions about fractions for year 4' } });
    const back = await Nova.api(`/quizzes/${id}`);
    return { source: out.source, applied: out.applied, reply: (out.reply || '').slice(0, 80),
             questions: back.questions.length };
  }, madeByHand.id);
  ok('asking for questions in words produces questions',
     asked.questions > byHand.questions,
     `${byHand.questions} → ${asked.questions} (${asked.source})`);
  ok('and it says what it did, rather than going quiet', asked.reply.length > 0, asked.reply);
  ok('they are written down with the rest of the quiz', asked.applied === true,
     'applied to the quiz');

  /* ── 3. by pasting what another AI wrote ── */
  const pasted = await page.evaluate(async () => {
    const text = [
      '1. Which planet is closest to the Sun?',
      'a) Venus',
      'b) Mercury',
      'c) Mars',
      'd) Earth',
      'Answer: b',
      '',
      '2. How many sides does a hexagon have?',
      'a) Five',
      'b) Six',
      'c) Seven',
      'd) Eight',
      'Answer: b'
    ].join(String.fromCharCode(10));   // real newlines: a pasted quiz has lines
    try {
      const quiz = Nova.importPasted(text);
      const back = await Nova.api(`/quizzes/${quiz.id}`);
      return { ok: true, questions: back.questions.length,
               first: back.questions[0].text,
               right: (back.questions[0].choices.find(c => c.correct) || {}).text };
    } catch (err) { return { ok: false, why: err.message }; }
  });
  ok('a quiz pasted in from another AI becomes a real quiz',
     pasted.ok && pasted.questions === 2, pasted.ok ? `${pasted.questions} questions` : pasted.why);
  ok('with the right answer picked out of the text',
     pasted.ok && /mercury/i.test(pasted.right || ''), pasted.right || '(none)');

  /* ── and all of it survives the page being closed ── */
  await page.goto(`${base}/quiznova.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  const afterReload = await page.evaluate(async () => {
    const list = (await Nova.api('/quizzes')).quizzes;
    return { count: list.length, titles: list.map(q => q.title).slice(0, 4),
             questions: list.reduce((n, q) => n + q.questions, 0) };
  });
  ok('every quiz made is still there after the page is closed and opened',
     afterReload.count >= 2 && afterReload.questions >= 3,
     `${afterReload.count} quizzes, ${afterReload.questions} questions: ${afterReload.titles.join(', ')}`);

  ok('no errors while making them', errs.length === 0, errs.slice(0, 2).join(' | '));

  await page.screenshot({ path: path.join(__dirname, 'shots', 'make-quiz.png') }).catch(() => {});
  await browser.close();
  srv.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
