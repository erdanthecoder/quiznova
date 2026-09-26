/* A board that goes blank in the middle of a game.
 *
 * The board rebuilds its view off-screen every poll and copies only the
 * differences onto the live one. That pass copies attributes both ways, and a
 * canvas keeps its size in attributes — so every poll it stripped width and
 * height off the live canvas, which is how a browser is told to throw the
 * drawing away and start again at 300x150. Mid-fight the boss hall emptied.
 *
 * So: play each mode that owns a canvas, let it poll several times, and check
 * the thing is still painted and still the size of its box.
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
                           dataDir: '/tmp/claude-0/boardstest', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  const quiz = await post('/api/quizzes', { title: 'Lesson', questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  await post(`/api/quizzes/${qid}/ops`, { ops: [1, 2, 3, 4, 5, 6].map(n => ({
    op: 'add_question', question: { type: 'mc', text: `Question ${n}`, points: 100, time: 30,
      choices: [{ text: 'right', correct: true }, { text: 'wrong' }] } })) });
  await post(`/api/quizzes/${qid}/ops`, { ops: [{ op: 'delete_question', at: 0 }] });

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });

  /** How much of a canvas has anything on it, and whether it is still its own size. */
  const look = (page, id) => page.evaluate((cid) => {
    const c = document.getElementById(cid);
    if (!c) return { there: false };
    const box = c.getBoundingClientRect();
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let on = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 29) {
      n++; if (d[i] + d[i + 1] + d[i + 2] > 40) on++;
    }
    return { there: true, painted: Math.round(on / n * 100),
             w: c.width, h: c.height, boxW: Math.round(box.width) };
  }, id);

  /* Every mode whose board is a canvas, and the name of that canvas. */
  const modes = [
    ['boss',  'board-strike', 'Boss Battle'],
    ['tower', 'board-tower',  'Tallest Tower'],
    ['robot', 'board-run',    'Robot Run'],
    ['laser', 'board-arena',  'Laser Tag']
  ];

  for (const [mode, cid, label] of modes) {
    const made = await post('/api/games', { quizId: qid, mode, map: '' });
    const pin = made.pin, ht = made.hostToken;
    await post(`/api/games/${pin}/join`, { name: 'Ana', avatar: 3 });
    await post(`/api/games/${pin}/join`, { name: 'Ben', avatar: 9 });

    const board = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = []; board.on('pageerror', e => errs.push(e.message));
    /* Started while the board is still settling, the way a teacher does: the
       change of state repaints, a repaint builds a new canvas, and an engine
       left drawing on the old one is how a board goes black. */
    await board.goto(`${base}/host.html?pin=${pin}#h=${ht}`, { waitUntil: 'domcontentloaded' });
    await post(`/api/games/${pin}/start`, { hostToken: ht });
    /* Some modes open on a countdown or a map choice before the canvas is
       mounted, so wait for the thing rather than assume it is there. */
    await board.waitForSelector('#' + cid, { timeout: 20000 }).catch(() => {});
    await board.waitForTimeout(1800);

    await post(`/api/games/${pin}/join`, { name: 'Cal', avatar: 14 });
    await board.waitForTimeout(1500);
    const first = await look(board, cid);
    ok(`${label}: the board is painted when the game starts`,
       first.there && first.painted > 10, `${first.painted}% painted`);

    /* Six seconds is six polls. Before the fix that was six chances for the
       drawing to be thrown away, and the board came back empty. */
    await board.waitForTimeout(6000);
    const after = await look(board, cid);
    ok(`${label}: and it is still painted several polls later`,
       after.there && after.painted > 10, `${after.painted}% painted`);
    ok(`${label}: the canvas kept its own size through the repaints`,
       after.w > 400 && Math.abs(after.w - first.w) < 2,
       `${first.w}x${first.h} then ${after.w}x${after.h}, box ${after.boxW}`);
    ok(`${label}: no errors on the board`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await board.close();
  }

  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
