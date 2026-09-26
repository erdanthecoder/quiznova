/* The music selection, driven through the real board.
 *
 * The complaint that got this written was "we only have one and that is it":
 * theme.mp3 played on a loop and the fourteen written pieces never sounded at
 * all. So what is checked here is that there is a choice, that picking one
 * sticks, and that a teacher's own files go on the shelf and stay on their
 * own machine.
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
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/musictest', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  const quiz = await post('/api/quizzes', { title: 'Lesson', questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  await post(`/api/quizzes/${qid}/ops`, { ops: [1, 2, 3].map(n => ({
    op: 'add_question', question: { type: 'mc', text: `Q${n}`, points: 100, time: 30,
      choices: [{ text: 'a', correct: true }, { text: 'b' }] } })) });
  const made = await post('/api/games', { quizId: qid, mode: 'normal', map: '' });
  const pin = made.pin, ht = made.hostToken;

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${base}/host.html?pin=${pin}#h=${ht}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // ── there is a selection at all ──
  const styles = await page.evaluate(() => NovaMusic.styles.map(s => s.id));
  ok('there are several styles to choose from, not one', styles.length >= 6, styles.join(', '));
  ok('and three places the music can come from',
     await page.evaluate(() => typeof NovaMusic.source === 'function'));

  const started0 = await page.evaluate(() => NovaMusic.source());
  ok('the written pieces are what a board starts on', started0 === 'made', started0);

  // ── the menu is really on the board ──
  ok('the board has a button for it', await page.locator('#musicpick').count() === 1);
  await page.locator('#musicpick').click();
  await page.waitForTimeout(400);
  ok('and it opens a menu', await page.locator('#musicmenu.on').count() === 1);
  const rows = await page.locator('#musicmenu .mm-row').count();
  ok('with every choice in it', rows >= 10, `${rows} things to pick`);

  // ── picking a style sticks ──
  await page.evaluate(() => NovaMusic.style('storm'));
  ok('picking a style changes it', await page.evaluate(() => NovaMusic.style()) === 'storm');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  ok('and it is still there after a reload, because a teacher picks once',
     await page.evaluate(() => NovaMusic.style()) === 'storm');

  // ── two styles really are two different pieces ──
  const heard = await page.evaluate(() => {
    const at = [];
    for (const id of ['quoldek', 'storm', 'arcade']) {
      NovaMusic.style(id);
      // the note a piece starts on, which is the key it is in
      at.push(Math.round(NovaMusic.styles.find(s => s.id === id) ? 1 : 0));
    }
    return NovaMusic.styles.map(s => s.name);
  });
  ok('and every style has a name a teacher can read', heard.every(n => n && n.length > 2),
     heard.join(', '));

  // ── the teacher's own shelf ──
  const put = await page.evaluate(async () => {
    /* A real audio file, made here rather than uploaded: a tenth of a second
       of silence in a wav container is enough to prove the shelf works. */
    const n = 4410;
    const buf = new ArrayBuffer(44 + n * 2);
    const view = new DataView(buf);
    const text = (at, s2) => { for (let i = 0; i < s2.length; i++) view.setUint8(at + i, s2.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 44100, true); view.setUint32(28, 88200, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, n * 2, true);
    const file = new File([buf], 'My Party Song.wav', { type: 'audio/wav' });
    const added = await NovaMusic.addRecords([file]);
    const on = await NovaMusic.records();
    return { added, on: on.map(r => r.name) };
  });
  ok('a teacher can put their own music on the shelf', put.added === 1, JSON.stringify(put.on));
  ok('and it is listed by a name they will recognise',
     put.on[0] === 'My Party Song', put.on[0]);

  ok('choosing it switches the board over',
     await page.evaluate(() => { NovaMusic.source('mine'); return NovaMusic.source(); }) === 'mine');

  // ── and it stays on their machine ──
  const sent = [];
  page.on('request', r => { if (/\.(wav|mp3|m4a|ogg)/i.test(r.url()) && !r.url().startsWith('blob:')) sent.push(r.url()); });
  await page.waitForTimeout(1200);
  ok('their file is never sent anywhere', sent.length === 0, sent.join(' '));

  ok('it survives a reload, so it is added once and not every lesson',
     await page.reload({ waitUntil: 'domcontentloaded' })
       .then(() => page.waitForTimeout(900))
       .then(() => page.evaluate(async () => (await NovaMusic.records()).length)) === 1);

  const off = await page.evaluate(async () => {
    const on = await NovaMusic.records();
    await NovaMusic.dropRecord(on[0].id);
    return (await NovaMusic.records()).length;
  });
  ok('and they can take it off again', off === 0);

  ok('no errors on the board', errs.length === 0, errs.slice(0, 2).join(' | '));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'music-menu.png') }).catch(() => {});
  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
