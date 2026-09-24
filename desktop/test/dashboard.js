/* The teacher's dashboard.
 *
 * What was here was one scrolling page with a greeting and nine quizzes. This
 * checks the four sections a teacher actually arrives wanting — what now, what
 * is out there, what have I got, how did they do — and it checks the one that
 * matters most is real: taking a quiz out of Discover has to put actual
 * questions in the library, not a card that promises some.
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
  /* A fresh shelf every run. Without this each run inherited the last one's
     quizzes, so the library grew by one every time and any count in here would
     have been measuring the test's own history. */
  require('fs').rmSync('/tmp/claude-0/dashtest', { recursive: true, force: true });
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/dashtest', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const page = await browser.newPage({ viewport: { width: 1340, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));

  await page.goto(`${base}/teachboard.html#as=teacher`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // ── the shape of it ──
  ok('the dashboard has a rail down the side', await page.locator('.rail').count() === 1);
  const nav = await page.locator('.rail-link').allTextContents();
  ok('with the four things a teacher came for',
     ['Home', 'Discover', 'Library', 'Reports'].every(n => nav.includes(n)), nav.join(' · '));
  ok('and a Create button above them', await page.locator('.rail-new').count() === 1);
  ok('every rail item has its own icon, not a gap',
     await page.locator('.rail-link span svg').count() === 4);

  // ── Home ──
  ok('Home opens first', await page.locator('.wrap h1').first().textContent().then(t => /Good (morning|afternoon|evening)/.test(t)));
  ok('and offers the four things to do', await page.locator('.jump a').count() === 4);

  // ── Discover ──
  await page.locator('.rail-link', { hasText: 'Discover' }).click();
  await page.waitForTimeout(600);
  const cards = await page.locator('.card2').count();
  ok('Discover has a shelf of ready-made quizzes', cards >= 20, `${cards} on screen`);
  ok('and says plainly that everything is free',
     (await page.locator('.banner').textContent()).includes('free'));
  const free = await page.locator('.card2 .free').count();
  ok('every single card is marked free, with nothing locked', free === cards, `${free} of ${cards}`);

  /* Pictures. A shelf of cards with a letter on each one is a filing cabinet,
     and the whole point of drawing thirty-eight of these is that a teacher
     finds the fractions quiz by the pizza before they read a word. */
  const art = await page.locator('.card2 .cover.art svg').count();
  ok('every card has a drawn picture on it', art === cards, `${art} of ${cards}`);
  /* "A drawing, not a coloured box" is the claim worth testing, and shape count
     is a poor proxy for it — the human body cover is a heart and a heartbeat
     trace, which is four shapes and unmistakable. So: every cover has to carry
     something drawn, not only rectangles. */
  const drawn = await page.evaluate(() =>
    [...document.querySelectorAll('.card2 .cover.art svg')]
      .map(s => s.querySelectorAll('path,circle,ellipse').length));
  ok('and every picture is drawn, not just coloured rectangles',
     drawn.length && drawn.every(n => n >= 2), `fewest drawn marks in one: ${Math.min(...drawn)}`);
  const distinct = await page.evaluate(() => new Set(
    [...document.querySelectorAll('.card2 .cover.art svg')].map(s => s.innerHTML)).size);
  ok('different topics get different pictures', distinct >= 8, `${distinct} different ones on screen`);
  ok('and the year is on the card without covering the art',
     await page.locator('.card2 .yr').count() === cards);

  // the filters
  await page.locator('.chip', { hasText: 'Science' }).first().click();
  await page.waitForTimeout(400);
  const sci = await page.locator('.card2 .body small').allTextContents();
  ok('picking a subject narrows it to that subject',
     sci.length && sci.every(t => t.startsWith('Science')), sci[0]);
  await page.locator('.chip', { hasText: 'Year 3' }).first().click();
  await page.waitForTimeout(400);
  // the year moved off the title and onto the tag over the picture
  const y3 = await page.locator('.card2 .yr').allTextContents();
  ok('and picking a year narrows it again',
     y3.length && y3.every(t => t === 'Year 3'), y3[0] + ' ×' + y3.length);

  // search
  await page.locator('.chip', { hasText: 'Everything' }).first().click();
  await page.locator('.chip', { hasText: 'Any year' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.seek input').fill('fractions');
  await page.waitForTimeout(500);
  const found = await page.locator('.card2 .body b').allTextContents();
  ok('and searching finds a topic by name',
     found.length && found.every(t => /Fraction/i.test(t)), found.slice(0, 2).join(', '));

  // ── taking one has to be real ──
  const listQuizzes = () => page.evaluate(async () => {
    if (Nova.allQuizzes) return Object.values(Nova.allQuizzes());
    const out = await Nova.api('/quizzes');
    return (out && out.quizzes) || [];
  });
  const before = (await listQuizzes()).length;
  await page.locator('.card2 .btn', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(2200);
  const all0 = await listQuizzes();
  const after = await page.evaluate(async (all) => {
    let q = all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (q && !Array.isArray(q.questions)) q = await Nova.api('/quizzes/' + q.id);
    if (q && q.quiz) q = q.quiz;
    return { n: all.length, title: q && q.title,
             questions: (q && q.questions || []).length,
             first: q && q.questions && q.questions[0] ? q.questions[0].text : '',
             choices: q && q.questions && q.questions[0] ? (q.questions[0].choices || []).length : 0,
             hasRight: q && q.questions && q.questions[0]
               ? (q.questions[0].choices || []).some(c => c.correct) : false };
  }, all0);
  ok('taking one from Discover really writes a quiz', after.n === before + 1, `${before} → ${after.n}`);
  ok('with actual questions in it, not a promise of some',
     after.questions >= 10, `${after.questions} questions, first: "${String(after.first).slice(0, 48)}"`);
  ok('each with answers to pick from and one of them right',
     after.choices >= 2 && after.hasRight, `${after.choices} choices`);

  ok('and there is one button that picks for you',
     await page.locator('.block-head .btn', { hasText: 'Surprise me' }).count() === 1);

  // ── Library ──
  await page.locator('.seek input').fill('');
  await page.locator('.rail-link', { hasText: 'Library' }).click();
  await page.waitForTimeout(600);
  const lib = await page.locator('.card2 .body b').allTextContents();
  ok('the quiz is in the library straight away', lib.includes(after.title), lib.join(' · '));
  ok("a teacher's own quiz gets a picture worked out from its title",
     await page.locator('.card2 .cover.art svg').count() >= 1,
     'title was ' + after.title);
  ok('and a title that matches nothing still gets a cover rather than a gap',
     await page.evaluate(() => !!Sprite.cover(Sprite.coverNameFor('My own thing'), 100).includes('<svg')));
  await page.locator('.seek input').fill('nothing called this');
  await page.waitForTimeout(500);
  ok('and the library can be searched',
     (await page.locator('.empty').count()) === 1);
  await page.locator('.seek input').fill('');
  await page.waitForTimeout(400);

  // ── Reports ──
  await page.locator('.rail-link', { hasText: 'Reports' }).click();
  await page.waitForTimeout(500);
  ok('Reports says so plainly when no marks have come back',
     (await page.locator('.empty').count()) === 1);

  /* Marks, the shape the homework page really writes them in. */
  const all1 = await listQuizzes();
  await page.evaluate(async (all) => {
    let q = all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (!Array.isArray(q.questions)) q = await Nova.api('/quizzes/' + q.id);
    if (q && q.quiz) q = q.quiz;
    const qs = q.questions.slice(0, 4);
    const row = (name, rights) => ({
      id: 'r' + name, name, at: Date.now(), score: rights * 100, total: qs.length * 100,
      breakdown: qs.map((x, i) => ({ id: x.id, correct: i < rights }))
    });
    const store = {};
    store[q.id] = [row('Ana', 4), row('Ben', 1), row('Cal', 3)];
    localStorage.setItem('nova:responses', JSON.stringify(store));
  }, all1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.locator('.rail-link', { hasText: 'Reports' }).click();
  await page.waitForTimeout(500);

  ok('once marks are in, the report is there', await page.locator('.rep').count() === 1);
  ok('and it is headed with the quiz, not "since deleted"',
     !/since been deleted/.test(await page.locator('.rep-top b').first().textContent()),
     await page.locator('.rep-top b').first().textContent());
  const figs = await page.locator('.rep-fig b').allTextContents();
  ok('with how many sat it and what the class averaged',
     figs[0] === '3' && /%$/.test(figs[1]), figs.join(' · '));

  await page.locator('.rep-top').click();
  await page.waitForTimeout(500);
  ok('opening it breaks the quiz down question by question',
     await page.locator('.qline').count() >= 4, `${await page.locator('.qline').count()} questions`);
  ok('and marks the ones the class fell over',
     await page.locator('.qline.hard').count() >= 1);
  const who = await page.locator('.who b').allTextContents();
  ok('every child is listed, best first', who[0] === 'Ana' && who.includes('Ben'), who.join(', '));
  const body = await page.locator('.rep-body').textContent();
  ok('and it names who needs five minutes tomorrow',
     /Might want five minutes tomorrow/.test(body) && /Ben/.test(body.split('tomorrow')[1] || ''));

  ok('no errors anywhere in that', errs.length === 0, errs.slice(0, 2).join(' | '));

  await page.evaluate(() => { location.hash = '#discover'; });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'dash-discover.png') }).catch(() => {});
  await page.evaluate(() => { location.hash = '#home'; });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'dash-home.png') }).catch(() => {});

  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
