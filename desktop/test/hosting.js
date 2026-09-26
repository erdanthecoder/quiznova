/* Can a teacher actually put a game on the board?
 *
 * The teacher's dashboard had a "Put a game on the board" panel whose Start
 * button went to the studio with live=1&mode=… on the address — two parameters
 * the studio has never read. It opened the quiz editor instead, and had done
 * since the day it was written. Nothing tested the one path a teacher uses
 * most, so this does: open the studio the way the dashboard opens it, pick a
 * mode, pick a map, start, and land on a board that can run the game.
 */
const path = require('path');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const ROOT = path.join(__dirname, '..', '..');
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };

(async () => {
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/hostflow', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  const quiz = await post('/api/quizzes', { title: 'Lesson', questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  await post(`/api/quizzes/${qid}/ops`, { ops: [1, 2].map(() => ({ op: 'add_question', question: {
    type: 'mc', text: 'Two plus two?', points: 100, time: 30,
    choices: [{ text: '4', correct: true }, { text: '5' }] } })) });

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  // the dashboard's link: the studio, told to open the picker
  await page.goto(`${base}/studio.html?id=${qid}&host=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  ok('host=1 opens the picker rather than the editor',
     await page.locator('#mode-list').count() > 0,
     (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 60));

  const cards = await page.locator('[data-mode]').count();
  ok('every mode is offered', cards === 5, `${cards} modes`);

  // every mode card has its own picture
  const modeArt = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mode] .art svg')].map(s => s.innerHTML.length));
  ok('each mode card draws something', modeArt.length === 5 && modeArt.every(n => n > 200),
     `svg sizes ${modeArt.join(',')}`);

  // pick Laser Tag, which is the one whose maps the teacher complained about
  await page.locator('[data-mode="laser"]').click();
  await page.waitForTimeout(700);
  const maps = await page.locator('[data-map]').count();
  ok('picking a mode offers its maps', maps === 3, `${maps} maps`);

  const art = await page.evaluate(() =>
    [...document.querySelectorAll('[data-map] .art svg')].map(s => s.innerHTML));
  ok('and every map has its own picture, not one picture three times',
     new Set(art).size === art.length, `${new Set(art).size} distinct of ${art.length}`);
  const names = await page.evaluate(() =>
    [...document.querySelectorAll('[data-map]')].map(b => b.innerText.trim()));
  ok('named the way the teacher picked them', names.join('|'), names.join(' · '));

  /* Two presses from the quiz to the board. There used to be a third screen
     between them — seconds, points, when it ends, six switches — which a
     teacher with a class already waiting has no reason to fill in. */
  await page.locator('[data-map="moon"]').click();
  await page.waitForTimeout(2500);
  ok('picking the map starts the game, with nothing to fill in first',
     !/Set the game up/.test(await page.evaluate(() => document.body.innerText)));

  // the app serves /host; the static build rewrites the same link to host.html
  ok('starting lands on the board', /host(?:\.html)?\?pin=\d+/.test(page.url()),
     page.url().split('/').pop());
  const board = await page.evaluate(() => document.body.innerText).catch(() => '');
  ok('the board is the board, not an error', /GAME PIN|JOIN AT/i.test(board),
     board.replace(/\s+/g, ' ').slice(0, 70));
  ok('and this device is the teacher, not a spectator',
     !/only the teacher device/i.test(board),
     /only the teacher device/i.test(board) ? 'it thinks it is watching' : 'it can control the game');
  ok('so the Start button is there', await page.locator('#start, button:has-text("Start game")').count() > 0);

  /* The same journey from the main page, which is where a teacher actually
   * starts. It had no map step at all: picking Laser Tag went straight into a
   * game, so the Bunker and the Moon Base were drawn, shipped and impossible to
   * see unless you happened to begin from inside the studio. */
  const hub = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const huberrs = [];
  hub.on('pageerror', e => huberrs.push(e.message));
  await hub.goto(`${base}/quiznova.html`, { waitUntil: 'domcontentloaded' });
  await hub.waitForTimeout(1800);
  /* During a release week the home page plays its cutscene over everything,
   * which is the whole point of it — and a test that only passes between
   * launches is not a test. So this walks out of the film the way a teacher in
   * a hurry does, by pressing Skip, rather than pretending it is not there. */
  const film = hub.locator('.launch-skip');
  if (await film.count()) { await film.click(); await hub.waitForTimeout(700); }
  // the little play button on the quiz card is how a teacher starts one here
  const play = hub.locator('button[title="Host a live game"]').first();
  ok('the main page has a way to host', await play.count() > 0);
  if (await play.count()) { await play.click(); await hub.waitForTimeout(1400); }
  const hubModes = await hub.locator('[data-mode]').count();
  ok('the main page offers the modes too', hubModes === 5, `${hubModes} modes`);
  if (hubModes) {
    await hub.locator('[data-mode="laser"]').click();
    await hub.waitForTimeout(700);
    const hubMaps = await hub.locator('[data-map]').count();
    ok('and now shows the maps, which it never did', hubMaps === 3, `${hubMaps} maps`);
    const hubArt = await hub.evaluate(() =>
      [...document.querySelectorAll('[data-map] .art svg')].map(s => s.innerHTML));
    ok('each with its own picture', hubArt.length === 3 && new Set(hubArt).size === 3,
       `${new Set(hubArt).size} distinct`);
    const hubNames = await hub.evaluate(() =>
      [...document.querySelectorAll('[data-map]')].map(b => b.innerText.trim()));
    ok('named on screen', hubNames.length === 3, hubNames.join(' · '));
  }
  ok('no errors on the main page', huberrs.length === 0, huberrs.slice(0, 2).join(' | '));

  /* ── a board opened with no game on it ──
   *
   * livequoldek.web.app with no PIN asked the server for a game called nothing,
   * failed, and sat on "Reconnecting…" for ever with six dashes where the PIN
   * goes. There was nothing to reconnect to. A teacher watched a reconnect that
   * could never finish, could not join it from a phone because it did not
   * exist, and could not end it for the same reason. */
  const bare = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const bareErrs = [];
  bare.on('pageerror', e => bareErrs.push(e.message));
  await bare.goto(`${base}/host.html`, { waitUntil: 'domcontentloaded' });
  await bare.waitForTimeout(2500);
  const text = (await bare.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  ok('a board with no PIN says so rather than reconnecting for ever',
     /No game on this board yet/.test(text) && !/Reconnecting/.test(text),
     text.slice(0, 80));
  ok('and it offers a box to type a PIN into', await bare.locator('#pinbox').count() > 0);
  ok('no errors on an empty board', bareErrs.length === 0, bareErrs.slice(0, 2).join(' | '));
  await bare.close();

  ok('no errors anywhere in that flow', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
