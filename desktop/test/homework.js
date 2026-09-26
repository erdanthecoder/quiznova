/* Homework: a quiz made by a teacher, set as homework, done at home.
 *
 * "Do quoldek homework making quizzes." The whole route, end to end, through
 * the built sites: a quiz is written in the studio, turned into a six-character
 * code, and a child opens the homework site with that code, answers it and is
 * marked. Every step here is the one a real teacher and a real child take.
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

/* The two sites, on one origin so they share a stubbed database the way they
   share a real one: /hw is hwquoldek, the root is quoldek. */
function serve(mounts) {
  return http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const mount = Object.keys(mounts).sort((a, b) => b.length - a.length)
      .find(m => clean === m || clean.startsWith(m + '/')) || '/';
    const dir = mounts[mount];
    const rest = clean.slice(mount.length) || '/';
    let file = path.join(dir, rest === '/' ? 'index.html' : rest);
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

/* The same in-browser Supabase the live-edition test uses: rows in localStorage,
   shared by every page on this origin. */
const STUB = `
window.__read = () => { try { return JSON.parse(localStorage.getItem('__db')) || {}; } catch { return {}; } };
window.__write = (db) => { try { localStorage.setItem('__db', JSON.stringify(db)); } catch {} };
(function () {
  const real = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    if (!/supabase\\.co/.test(url)) return real(input, init);
    const opts = init || {};
    const method = (opts.method || 'GET').toUpperCase();
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    const db = window.__read();
    const rows = db[table] || (db[table] = []);
    const wants = [];
    u.searchParams.forEach((v, k) => {
      if (k === 'select' || k === 'order' || k === 'limit') return;
      const [op, ...more] = v.split('.');
      wants.push({ k, op, v: more.join('.') });
    });
    const hit = (row) => wants.every(w => w.op !== 'eq' || String(row[w.k]) === w.v);
    const body = opts.body ? JSON.parse(opts.body) : null;
    const reply = (code, data) => new Response(data === undefined ? '' : JSON.stringify(data),
      { status: code, headers: { 'content-type': 'application/json' } });
    if (method === 'GET') return reply(200, rows.filter(hit));
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      // a code is the primary key, so a clash has to be refused the way it is live
      for (const r of list) {
        if (r.code && rows.some(x => x.code === r.code)) {
          return reply(409, { message: 'duplicate key value violates unique constraint' });
        }
      }
      list.forEach(r => rows.push(Object.assign({ created_at: new Date().toISOString() }, r)));
      window.__write(db);
      return reply(201, /return=minimal/.test((opts.headers || {}).prefer || '') ? undefined : list);
    }
    if (method === 'PATCH') { rows.filter(hit).forEach(r => Object.assign(r, body));
                              window.__write(db); return reply(200, undefined); }
    return reply(405, { message: 'no' });
  };
})();
`;

(async () => {
  const srv = serve({ '/': path.join(ROOT, 'docs'), '/hw': path.join(ROOT, 'docs-homework') });
  await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const ctx = await browser.newContext();
  await ctx.addInitScript(STUB);

  const teacher = await ctx.newPage({ viewport: { width: 1280, height: 900 } });
  const terrs = [];
  teacher.on('pageerror', e => terrs.push(e.message));
  await teacher.goto(`${base}/quiznova.html`, { waitUntil: 'domcontentloaded' });
  await teacher.waitForTimeout(1200);

  /* ── the teacher writes a quiz and sets it as homework ── */
  const made = await teacher.evaluate(async () => {
    const quiz = await Nova.api('/quizzes', { method: 'POST', body: { title: 'Fractions homework' } });
    await Nova.api(`/quizzes/${quiz.id}/ops`, { method: 'POST', body: { ops: [
      { op: 'add_question', question: { type: 'mc', text: 'What is 1/2 of 8?', points: 100, time: 30,
        choices: [{ text: '4', correct: true }, { text: '2' }, { text: '6' }, { text: '8' }] } },
      { op: 'add_question', question: { type: 'mc', text: 'What is 1/4 of 20?', points: 100, time: 30,
        choices: [{ text: '5', correct: true }, { text: '4' }, { text: '10' }, { text: '2' }] } }] } });
    const full = await Nova.api(`/quizzes/${quiz.id}`);
    return { id: quiz.id, questions: full.questions.length };
  });
  ok('a teacher can write a quiz to set as homework', made.questions === 3,
     `${made.questions} questions on it`);

  const code = await teacher.evaluate(async (id) => {
    const quiz = await Nova.api(`/quizzes/${id}`);
    try { return { code: await NovaLive.shareQuiz(quiz) }; }
    catch (err) { return { why: err.message }; }
  }, made.id);
  ok('setting it as homework gives back a code a child can type',
     !!code.code && /^[a-hjkmnp-z2-9]{6}$/.test(code.code || ''), code.code || code.why);

  const stored = await teacher.evaluate((c) =>
    (window.__read().quoldek_homework || []).find(r => r.code === c), code.code);
  ok('and the quiz itself is stored against that code',
     stored && stored.quiz && stored.quiz.questions.length === 3,
     stored ? `${stored.quiz.questions.length} questions kept` : 'nothing was stored');
  ok('with its title, so a child knows what they opened',
     stored && stored.quiz.title === 'Fractions homework', stored && stored.quiz.title);

  /* ── the child opens the homework site with the code ── */
  const child = await ctx.newPage({ viewport: { width: 390, height: 820 } });
  const cerrs = [];
  child.on('pageerror', e => cerrs.push(e.message));
  await child.goto(`${base}/hw/${code.code}`, { waitUntil: 'domcontentloaded' });
  await child.waitForTimeout(2000);

  const seen = (await child.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  ok('the homework site finds the quiz behind the code',
     /Fractions homework/i.test(seen), seen.slice(0, 90));
  ok('and it is not an error page', !/not valid|could not|error/i.test(seen), seen.slice(0, 90));

  /* ── and the child answers it and is marked ── */
  const start = child.locator('button:has-text("Start")').first();
  if (await start.count()) { await start.click().catch(() => {}); await child.waitForTimeout(700); }
  const named = child.locator('input').first();
  if (await named.count()) { await named.fill('Cal').catch(() => {}); }
  const go = child.locator('button:has-text("Start"), button:has-text("Begin")').first();
  if (await go.count()) { await go.click().catch(() => {}); await child.waitForTimeout(700); }

  let answered = 0;
  for (let i = 0; i < 6; i++) {
    const opt = child.locator('.opt-btn, .opt, .choice').first();
    if (!(await opt.count())) break;
    await opt.click().catch(() => {});
    answered += 1;
    /* No Next here: answering moves the child on by itself, and clicking it as
       well skipped the question underneath — which the page then quite rightly
       refused to submit. */
    await child.waitForTimeout(800);
  }
  ok('the child can answer the questions on their own phone', answered > 0,
     `${answered} answered`);

  // and hands it in, which is the button the last question carries
  const hand = child.locator('button:has-text("Finish"), button:has-text("submit")').first();
  if (await hand.count()) { await hand.click().catch(() => {}); await child.waitForTimeout(1400); }

  const ended = (await child.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  ok('and it marks itself when they finish',
     /score|out of|correct|%/i.test(ended), ended.slice(0, 100));

  ok('no errors for the teacher', terrs.length === 0, terrs.slice(0, 2).join(' | '));
  ok('no errors for the child', cerrs.length === 0, cerrs.slice(0, 2).join(' | '));

  await child.screenshot({ path: path.join(__dirname, 'shots', 'homework.png') }).catch(() => {});
  await browser.close();
  srv.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
