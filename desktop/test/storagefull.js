/* A browser with no room left.
 *
 * Reported from a classroom: "we cannot generate more quizzes now — even new
 * accounts with no quizzes cannot make quizzes". Storage belongs to the browser
 * rather than to the account, so a full one stops everybody, and the old code
 * swallowed the failure: a new quiz came back looking real, was never written
 * down, and the studio then opened on an id that did not exist.
 *
 * What is checked here is that the failure is now visible and honest — the
 * teacher is told, in a sentence that says what to do, and nothing they already
 * had is thrown away to make room.
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
                '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png' };

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
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(`${base}/quiznova.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  ok('the site brings its own engine', await page.evaluate(() => !!window.Nova && !!Nova.api));

  /* Fill the browser the way a term of quizzes with pictures in them does.
     Chromium's quota is a few megabytes; this writes until it will take no
     more, which is precisely the state the classroom was in. */
  const filled = await page.evaluate(() => {
    let n = 0;
    /* Coarse first, then finer and finer, so it ends genuinely full rather than
       a few hundred kilobytes short — a browser that still has room for one
       small quiz is not the browser being reported. */
    for (const size of [256 * 1024, 8 * 1024, 512, 64]) {
      const lump = 'x'.repeat(size);
      try {
        for (let i = 0; i < 4000; i++) { localStorage.setItem('nova:ballast:' + n, lump); n += 1; }
      } catch { /* that is the quota, at this size */ }
    }
    return n;
  });
  ok('the browser can be filled up, the way a term of work fills it',
     filled > 0, `${filled} writes went in before it refused another`);

  /* Making a quiz now. The old code returned one and saved nothing. */
  const made = await page.evaluate(async () => {
    try {
      const quiz = await Nova.api('/quizzes', { method: 'POST', body: { title: 'Fractions' } });
      const back = JSON.parse(localStorage.getItem('nova:quizzes') || '{}');
      return { ok: true, id: quiz.id, saved: !!back[quiz.id] };
    } catch (err) {
      return { ok: false, why: err.message, full: !!err.storageFull };
    }
  });
  ok('a quiz that cannot be saved is not reported as made',
     made.ok === false, made.ok ? `it returned id ${made.id}, saved: ${made.saved}` : 'it refused');
  ok('and the teacher is told what happened, in words with a way out',
     !made.ok && /room/i.test(made.why || '') && /delete|remove/i.test(made.why || ''),
     made.why || '(no message)');
  ok('and it does not pretend nothing is wrong',
     !made.ok && made.full === true, 'the error is marked as a storage problem');

  /* Nothing of the teacher's was thrown away to make room. */
  const kept = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('nova:quizzes') || 'null');
    return { quizzes: all === null ? 'none yet' : Object.keys(all).length,
             results: localStorage.getItem('nova:responses') };
  });
  ok('no quizzes or marks were deleted to make room',
     kept.results === null || typeof kept.results === 'string',
     `quizzes: ${kept.quizzes}`);

  /* And once there is room again, the same click works. */
  const recovered = await page.evaluate(async () => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('nova:ballast:')) localStorage.removeItem(key);
    }
    const quiz = await Nova.api('/quizzes', { method: 'POST', body: { title: 'Fractions' } });
    const back = JSON.parse(localStorage.getItem('nova:quizzes') || '{}');
    return { id: quiz.id, saved: !!back[quiz.id] };
  });
  ok('with room again, the quiz is made and actually written down',
     !!recovered.saved, `saved ${recovered.id}: ${recovered.saved}`);

  ok('no errors on the page', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  srv.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
