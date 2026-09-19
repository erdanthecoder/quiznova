/* Laser Tag: cover, blooks and two thumbs.
 *
 * The arena used to be a flat floor, which makes a shooting game a staring
 * contest — everybody can see everybody from anywhere and the only tactic is
 * being quicker on the trigger. Blooket's own arena has barriers to hide
 * behind. This checks the three things that follow from putting them in: that
 * they stop you, that they stop a shot, and that nothing ever spawns inside
 * one.
 */
const path = require('path');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const ROOT = path.join(__dirname, '..', '..');
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };

const PAGE = `<!doctype html><body style="margin:0;background:#000">
<canvas id="c" style="width:760px;height:500px;display:block"></canvas></body>`;

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: false });
  const page = await browser.newPage({ viewport: { width: 820, height: 620 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setContent(PAGE);
  await page.addScriptTag({ path: path.join(ROOT, 'static/sprites.js') });
  await page.addScriptTag({ path: path.join(ROOT, 'static/arena.js') });

  // ── every map has its own cover, and the three differ ──
  const plans = await page.evaluate(() => {
    const out = {};
    for (const m of ['arena', 'bunker', 'moon']) {
      const k = NovaArena.start({ canvas: document.getElementById('c'),
        watching: true, map: m, send: () => {} });
      out[m] = (NovaArena.coverFor ? NovaArena.coverFor(m) : []).length;
      k.stop();
    }
    return out;
  });
  ok('every map has cover in it', Object.values(plans).every(n => n >= 6), JSON.stringify(plans));

  // ── walking into a block stops you, and sliding along it works ──
  const walls = await page.evaluate(async () => {
    const k = NovaArena.start({ canvas: document.getElementById('c'),
      me: { id: 'me', name: 'A', avatar: 1, team: 'red' }, map: 'bunker', send: () => {} });
    const cover = NovaArena.coverFor('bunker');
    const b = cover[0];
    // stand just left of a block and push right into it
    k.place(b.x - 60, b.y + b.h / 2);
    k.stick(1, 0);
    await new Promise(r => setTimeout(r, 700));
    const pushed = k.where();
    k.stick(0, 0);
    // now push diagonally: it should slide along rather than stop dead
    k.place(b.x - 60, b.y + b.h / 2);
    k.stick(1, -1);
    await new Promise(r => setTimeout(r, 700));
    const slid = k.where();
    k.stop();
    return { blockX: b.x, pushedX: Math.round(pushed.x), slidY: Math.round(slid.y),
             startY: Math.round(b.y + b.h / 2) };
  });
  ok('a block stops you walking through it', walls.pushedX < walls.blockX,
     `stopped at x=${walls.pushedX}, the wall starts at ${walls.blockX}`);
  ok('and you slide along it instead of sticking',
     Math.abs(walls.slidY - walls.startY) > 40,
     `moved ${Math.abs(walls.slidY - walls.startY)} along the wall`);

  // ── a shot cannot pass through cover ──
  const shooting = await page.evaluate(async () => {
    const k = NovaArena.start({ canvas: document.getElementById('c'),
      me: { id: 'me', name: 'A', avatar: 1, team: 'red' }, map: 'bunker', send: () => {} });
    const b = NovaArena.coverFor('bunker')[0];
    k.place(b.x - 90, b.y + b.h / 2);
    k.face(0);                         // straight at the wall
    k.fire();
    const before = k.shotCount();
    await new Promise(r => setTimeout(r, 400));
    const after = k.shotCount();
    k.stop();
    return { before, after };
  });
  ok('a shot stops at cover rather than going through it',
     shooting.before > 0 && shooting.after === 0,
     `${shooting.before} shot fired, ${shooting.after} still flying after it met the wall`);

  // ── nothing ever spawns inside a wall ──
  const spawns = await page.evaluate(() => {
    let bad = 0, n = 0;
    for (const m of ['arena', 'bunker', 'moon']) {
      const cover = NovaArena.coverFor(m);
      for (let i = 0; i < 300; i++) {
        const s = NovaArena.freeSpot(cover, 200, 26);
        n++;
        if (cover.some(b => s.x > b.x - 26 && s.x < b.x + b.w + 26
                         && s.y > b.y - 26 && s.y < b.y + b.h + 26)) bad++;
      }
    }
    return { bad, n };
  });
  ok('nothing spawns inside a wall', spawns.bad === 0, `${spawns.bad} of ${spawns.n} landed in one`);

  // ── the blook is drawn, not a plain blob ──
  const drawn = await page.evaluate(async () => {
    const k = NovaArena.start({ canvas: document.getElementById('c'),
      me: { id: 'me', name: 'A', avatar: 4, team: 'red' }, map: 'arena', send: () => {} });
    await new Promise(r => setTimeout(r, 1200));   // the face has to rasterise
    const loaded = NovaArena.faceReady ? NovaArena.faceReady(4) : false;
    k.stop();
    return loaded;
  });
  ok('the player is drawn as their blook', drawn, drawn ? 'face rasterised' : 'still the plain shape');

  ok('no errors in the arena', errs.length === 0, errs.slice(0, 2).join(' | '));

  // ── two sticks on the phone, no fire button ──
  const srv = new Server({ root: path.join(ROOT, 'static'), dataDir: '/tmp/claude-0/ltdata', port: 0 });
  const st = await srv.listen();
  const port = st && st.port ? st.port : st;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();
  const quiz = await post('/api/quizzes', { title: 'LT', questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  await post(`/api/quizzes/${qid}/ops`, { ops: [
    { op: 'add_question', question: { type: 'mc', text: 'Q', points: 100, time: 25,
      choices: [{ text: 'R', correct: true }, { text: 'W' }] } },
    { op: 'delete_question', at: 0 }] });
  const made = await post('/api/games', { quizId: qid, mode: 'laser', map: 'bunker' });
  const pin = made.pin || made.game.pin;
  const phone = await browser.newPage({ viewport: { width: 390, height: 820 }, hasTouch: true });
  await phone.goto(`${base}/play.html?pin=${pin}`, { waitUntil: 'domcontentloaded' });
  await phone.waitForTimeout(800);
  await phone.locator('input').first().fill('Ana');
  await phone.locator('button:has-text("Join the game")').first().click();
  await phone.waitForTimeout(900);
  await post(`/api/games/${pin}/start`, { hostToken: made.hostToken });
  await phone.waitForFunction(() => !!document.getElementById('arena'), null, { timeout: 12000 })
    .catch(() => {});
  await phone.waitForTimeout(900);
  ok('the phone has a move stick', await phone.locator('#stick').count() === 1);
  ok('and a shoot stick', await phone.locator('#aim').count() === 1);
  ok('and no separate fire button, because the right stick is one',
     await phone.locator('#fire').count() === 0);

  await phone.screenshot({ path: path.join(__dirname, 'shots', 'lasertag-phone.png') }).catch(() => {});
  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
