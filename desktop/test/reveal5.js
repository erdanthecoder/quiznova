/* The 5.0 reveal, watched rather than assumed.
 *
 * A cutscene is the one piece of a release that cannot be checked by reading it:
 * it either draws or it is a black rectangle over the whole page with a Skip
 * button on it. The last one taught that the hard way — the film's name was
 * picked outside the guard that catches a film that will not run, so a spelling
 * mistake left the shell over the home page with nothing in it.
 *
 * So: play it, look at what is on the canvas at four points in it, and make sure
 * it lets go of the page on its own.
 *
 *   node desktop/test/reveal5.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = path.join(__dirname, 'shots');
const SIZE = { width: 1280, height: 760 };

let pass = 0, fail = 0;
const ok = (what, good, note) => {
  if (good) { pass++; console.log('ok   ', what, note ? ' — ' + note : ''); }
  else { fail++; console.log('FAIL ', what, note ? ' — ' + note : ''); }
};

/* How much is actually on the canvas: the share of sampled pixels that are not
   the same colour as the corner. A film that is drawing has plenty; a film that
   has thrown has none. */
const busyOf = (sel) => `(() => {
  const c = document.querySelector('${sel}');
  if (!c) return -1;
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const step = 4 * 37;
  const at = (i) => d[i] + ',' + d[i + 1] + ',' + d[i + 2];
  const seen = new Map();
  let n = 0;
  for (let i = 0; i < d.length; i += step) { seen.set(at(i), (seen.get(at(i)) || 0) + 1); n++; }
  let most = 0;
  seen.forEach(v => { if (v > most) most = v; });
  return { colours: seen.size, varied: 1 - most / n };
})()`;
const BUSY = busyOf('.launch-sky');
const DUET = busyOf('.launch-duet');

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/reveal5data', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const page = await browser.newPage({ viewport: SIZE });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${base}/whatsnew.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  const listed = await page.evaluate(() => window.NovaLaunch
    ? NovaLaunch.RELEASES.map(r => r.version) : []);
  ok('5.0 is a release the app knows about', listed.includes('5.0'), listed.join(' '));
  ok('and it is the newest one out',
     await page.evaluate(() => NovaLaunch.latest().version) === '5.0');
  ok('the page is about 5.0, not the one before it',
     (await page.title()).includes('5.0'), await page.title());

  // whatever the page did on its own, start the film deliberately
  await page.evaluate(() => { NovaLaunch.reveal('5.0', {}); });
  await page.waitForTimeout(400);
  ok('the film opens', await page.locator('.launch-sunrise').count() === 1);

  const marks = [
    ['dark', 900], ['sunrise', 2600], ['words', 5200], ['flipped', 9200],
    ['meeting', 12600], ['ribbon', 14200], ['title', 17900]
  ];
  let last = 400;
  for (const [name, at] of marks) {
    await page.waitForTimeout(at - last);
    last = at;
    const busy = await page.evaluate(BUSY);
    ok(`${name}: something is drawn`, busy && busy.varied > 0.06,
       busy ? `${busy.colours} colours, ${Math.round(busy.varied * 100)}% varied` : 'no canvas');
    /* The two marks meet on a canvas of their own over the film. It is the news
       in this release, so it is worth knowing it actually came up rather than
       failing quietly behind a guard. */
    if (name === 'meeting' || name === 'ribbon') {
      const duet = await page.evaluate(DUET);
      ok(`${name}: the two marks are on screen`, duet && duet.varied > 0.01,
         duet ? `${duet.colours} colours` : 'no second canvas');
    }
    await page.screenshot({ path: path.join(SHOTS, `reveal5-${name}.png`) });
  }

  const titled = await page.locator('.launch-word .up').first().textContent();
  ok('and it says which release it is', (titled || '').trim() === 'Quoldek 5.0', titled);
  const cardCount = await page.locator('.launch-card').count();
  ok('with the four things in it', cardCount === 4, `${cardCount} cards`);
  const cardText = (await page.locator('.launch-cards').first().textContent()) || '';
  ok('one of which is the Kyrgyz', /Kyrgyz/.test(cardText));
  ok('and none of them is empty', !/  /.test(cardText.trim()) && cardText.length > 80);

  /* The important one. A full-screen overlay that does not know how to leave is
     a page nobody can use. */
  await page.waitForTimeout(3600);
  ok('and it lets go of the page on its own',
     await page.locator('.launch').count() === 0);

  ok('no errors while it played', errs.length === 0, errs.join(' | '));

  await browser.close();
  await srv.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e.message); process.exit(1); });
