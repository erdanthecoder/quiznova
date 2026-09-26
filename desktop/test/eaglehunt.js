/* Eagle Hunt, played.
 *
 * A mode is not shipped because its scorer returns the right number. The claim
 * this one makes is that a class can look up at a canyon and see, without being
 * told, who is in front — so what is checked here is the canyon: that it is
 * actually on the board, that it is drawing, that the birds are where the
 * scores say they are, and that the one thing in it that is not Classic with a
 * view — the wind behind whoever is last — does what it says.
 *
 *   node desktop/test/eaglehunt.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = path.join(__dirname, 'shots');
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* How much is on a canvas: the share of sampled pixels that are not whatever
   colour there is most of. A canyon that is drawing has plenty. */
const BUSY = `(() => {
  const c = document.getElementById('canyon');
  if (!c || c.hidden) return null;
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const seen = new Map(); let n = 0;
  for (let i = 0; i < d.length; i += 4 * 53) {
    const k = d[i] + ',' + d[i+1] + ',' + d[i+2];
    seen.set(k, (seen.get(k) || 0) + 1); n++;
  }
  let most = 0; seen.forEach(v => { if (v > most) most = v; });
  return { colours: seen.size, varied: 1 - most / n };
})()`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.rmSync('/tmp/claude-0/eagletest', { recursive: true, force: true });
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/eagletest', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  const quiz = await post('/api/quizzes', { title: 'Lesson', starter: false, questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  const RIGHT = ['56', 'Paris', 'Jupiter', 'Water'];
  const asks = [['What is 7 x 8?', '56', '48', '63', '42'],
                ['Capital of France?', 'Paris', 'Lyon', 'Nice', 'Rome'],
                ['Which planet is biggest?', 'Jupiter', 'Mars', 'Venus', 'Earth'],
                ['What is H2O?', 'Water', 'Salt', 'Iron', 'Air']];
  await post(`/api/quizzes/${qid}/ops`, { ops: asks.map(([text, ...opts]) => ({
    op: 'add_question', question: { type: 'mc', text, points: 100, time: 20,
      choices: opts.map((t, i) => ({ text: t, correct: i === 0 })) } })) });

  /* ── the mode exists everywhere it has to ── */
  const modes = await (await fetch(base + '/api/modes')).json();
  const listed = (modes.modes || []).find(m => m.id === 'eagle');
  ok('the server offers Eagle Hunt', !!listed, listed ? listed.label : 'not listed');
  ok('and says it is a limited edition',
     !!(listed && listed.limited && listed.limited.until), listed && listed.limited
       ? `${listed.limited.from} → ${listed.limited.until}` : 'no window');
  ok('with three valleys to fly',
     !!(listed && listed.maps && listed.maps.length === 3),
     listed && listed.maps ? listed.maps.map(m => m.label || m[1] || m.name).join(' / ') : '');

  const made = await post('/api/games', { quizId: qid, mode: 'eagle', map: 'canyon' });
  const pin = made.pin, ht = made.hostToken;
  ok('and a game can be made in it', !!pin, pin);

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const board = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; board.on('pageerror', e => errs.push(e.message));
  await board.goto(`${base}/host.html?pin=${pin}#h=${ht}`, { waitUntil: 'domcontentloaded' });
  await sleep(900);

  const phones = [];
  for (const name of ['Ana', 'Ben', 'Cal', 'Dee']) {
    const p = await browser.newPage({ viewport: { width: 400, height: 850 }, hasTouch: true, isMobile: true });
    await p.goto(`${base}/play.html?pin=${pin}`, { waitUntil: 'domcontentloaded' });
    await sleep(250);
    await p.locator('input').first().fill(name);
    await p.locator('button:has-text("Join the game")').first().click();
    phones.push(p);
  }
  await sleep(1200);

  /* The lobby stands the class on a floor of its own, so the valley waits. */
  ok('the lobby is not flown over',
     await board.locator('#canyon[hidden]').count() === 1);
  await board.screenshot({ path: path.join(SHOTS, 'eagle-lobby.png') });

  await post(`/api/games/${pin}/start`, { hostToken: ht });
  await sleep(1600);

  ok('the canyon is on the board once they are up', await board.locator('#canyon:not([hidden])').count() === 1);
  ok('and the board knows it is in it',
     await board.evaluate(() => document.body.classList.contains('flying')));
  const tag = await board.locator('.limited').textContent().catch(() => '');
  ok('and says on screen that this one is only here for a while',
     /Limited edition/i.test(tag || ''), (tag || '').replace(/\s+/g, ' ').trim());
  const drawing = await board.evaluate(BUSY);
  ok('and it is drawing, not a black rectangle',
     drawing && drawing.varied > 0.1,
     drawing ? `${drawing.colours} colours, ${Math.round(drawing.varied * 100)}% varied` : 'no canvas');

  /* ── a round, with the four of them answering differently ── */
  const answerAll = async (rightCount, speeds) => {
    for (let i = 0; i < phones.length; i++) {
      await phones[i].evaluate(async ([right, RIGHT, speed]) => {
        const q = game.question; if (!q) return;
        const pick = right ? q.choices.find(c => RIGHT.includes(c.text))
                           : q.choices.find(c => !RIGHT.includes(c.text));
        if (!pick) return;
        await Nova.api(`/games/${game.pin}/answer`, { method: 'POST',
          body: { playerId: me.id, questionId: q.id, answer: pick.id, speed } });
      }, [i < rightCount, RIGHT, (speeds && speeds[i]) || 0.5]).catch(() => {});
    }
  };

  // Ana runs away with the first two, so there is a back of the field at all
  await answerAll(1, [0.95]);
  await board.waitForSelector('.board.result', { timeout: 12000 });
  await sleep(1400);
  await post(`/api/games/${pin}/next`, { hostToken: ht });
  await sleep(1200);
  await answerAll(1, [0.95]);
  await sleep(1600);
  await board.screenshot({ path: path.join(SHOTS, 'eagle-flight.png') });

  /* ── the birds are where the scores say ── */
  const flight = await board.evaluate(() => {
    const byId = new Map((game.players || []).map(p => [p.id, p]));
    return (canyon ? canyon.birds : []).map(b => ({
      rank: b.rank, z: b.z, lane: b.lane,
      name: (byId.get(b.id) || {}).name, score: (byId.get(b.id) || {}).score || 0 }));
  });
  const lead = flight.find(b => b.rank === 1);
  ok('the leader is the one at the front of the canyon',
     !!lead && lead.name === 'Ana', lead ? `${lead.name} on ${lead.score}` : 'no birds');
  ok('and every bird is somewhere different down the valley',
     new Set(flight.map(b => Math.round(b.z))).size >= 2 || flight.length < 2,
     flight.map(b => `${b.name} ${Math.round(b.z)}m`).join(', '));
  ok('and spread across it rather than stacked in one line',
     new Set(flight.map(b => Math.round(b.lane * 10))).size === flight.length,
     flight.map(b => b.lane.toFixed(1)).join(' '));
  ok('the camera is behind the front of the field',
     await board.evaluate(() => canyon.camera.z) < lead.z);

  /* ── the wind ──
     The whole reason this is not Classic with a view: last place, answering
     exactly as well as first place, gains more. */
  const before = await board.evaluate(() =>
    Object.fromEntries((game.players || []).map(p => [p.name, p.score || 0])));
  await post(`/api/games/${pin}/next`, { hostToken: ht });
  await sleep(1200);
  await answerAll(4, [0.6, 0.6, 0.6, 0.6]);
  await sleep(1600);
  const after = await board.evaluate(() =>
    Object.fromEntries((game.players || []).map(p => [p.name, p.score || 0])));
  const gained = (n) => after[n] - before[n];
  ok('answering the same question as well, the bird at the back gains more',
     gained('Dee') > gained('Ana'), `Dee +${gained('Dee')} vs Ana +${gained('Ana')}`);
  ok('and the leader is not slowed down to make it close',
     gained('Ana') >= 80, `Ana +${gained('Ana')} on a question worth 100`);
  ok('and nobody ever goes backwards',
     Object.keys(after).every(n => after[n] >= before[n]),
     Object.keys(after).map(n => `${n} ${before[n]}→${after[n]}`).join(', '));

  const still = await board.evaluate(BUSY);
  ok('the canyon is still drawing after a few rounds of it',
     still && still.varied > 0.1,
     still ? `${Math.round(still.varied * 100)}% varied` : 'gone');

  /* ── and it packs up ── */
  await post(`/api/games/${pin}/end`, { hostToken: ht });
  await sleep(1500);
  ok('and the final standings get the screen to themselves',
     await board.evaluate(() => {
       const c = document.getElementById('canyon');
       return !!c && c.hidden && !document.body.classList.contains('flying');
     }));

  ok('no errors on the board', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  await srv.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e.message); process.exit(1); });
