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

  /* ── the maze has to be one maze ──
   *
   * Thirty walls laid out by hand is thirty chances to seal a room off by
   * accident, and a sealed room is not a hiding place, it is a child who
   * spawned somewhere they can never leave and cannot be reached. So: flood
   * fill every map and insist the whole floor is one piece. */
  const joined = await page.evaluate(() => {
    const out = {};
    const { W, H } = NovaArena.SIZE;   // the arena's own size, not a copy of it
    const R = 26, S = 20;
    const near = (b, x, y, r) => {
      const nx = Math.max(b.x, Math.min(x, b.x + b.w));
      const ny = Math.max(b.y, Math.min(y, b.y + b.h));
      return (nx - x) ** 2 + (ny - y) ** 2 < r * r;
    };
    for (const m of ['arena', 'bunker', 'moon']) {
      const cover = NovaArena.coverFor(m);
      const cols = W / S, rows = H / S, open = [];
      for (let j = 0; j < rows; j++) {
        open.push([]);
        for (let i = 0; i < cols; i++) {
          const x = i * S + S / 2, y = j * S + S / 2;
          open[j].push(x > R && x < W - R && y > R && y < H - R
                       && !cover.some(b => near(b, x, y, R)));
        }
      }
      const seen = open.map(r => r.map(() => false));
      let startAt = null;
      for (let j = 0; j < rows && !startAt; j++)
        for (let i = 0; i < cols && !startAt; i++) if (open[j][i]) startAt = [i, j];
      const q = [startAt]; seen[startAt[1]][startAt[0]] = true;
      let n = 1;
      while (q.length) {
        const [i, j] = q.pop();
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([di, dj]) => {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < cols && b < rows && open[b][a] && !seen[b][a]) {
            seen[b][a] = true; n++; q.push([a, b]);
          }
        });
      }
      out[m] = { open: open.flat().filter(Boolean).length, reached: n };
    }
    return out;
  });
  Object.entries(joined).forEach(([m, r]) => {
    ok(`every corner of the ${m} can be walked to`, r.open === r.reached,
       `${r.reached} of ${r.open} floor squares`);
  });

  /* ── and the two ends have to be the same maze ──
   *
   * In team mode the sides start at opposite ends. Every wall is authored once
   * and turned a half turn about the centre, so if that ever stops being true
   * one team is being given the better ground. */
  const fair = await page.evaluate(() => {
    const { W, H } = NovaArena.SIZE;   // asked for, not remembered
    const out = {};
    for (const m of ['arena', 'bunker', 'moon']) {
      const cover = NovaArena.coverFor(m);
      const key = (b) => [b.x, b.y, b.w, b.h].join(',');
      const have = new Set(cover.map(key));
      out[m] = cover.every(b =>
        have.has(key({ x: W - b.x - b.w, y: H - b.y - b.h, w: b.w, h: b.h })));
    }
    return out;
  });
  Object.entries(fair).forEach(([m, same]) => {
    ok(`the ${m} is the same at both ends`, same);
  });

  // ── a labyrinth you cannot see out of needs a map in your hand ──
  const hasMini = await page.evaluate(() => {
    const c = document.getElementById('c');
    const k = NovaArena.start({ canvas: c, map: 'arena',
      me: { id: 'me', name: 'Me', avatar: 2, team: 'red' }, send: () => {} });
    return new Promise(done => setTimeout(() => {
      const ctx = c.getContext('2d');
      /* The minimap sits in the top-right corner — it used to be bottom left,
         where the energy bar runs across it. Look for the panel it draws
         there: a dark rounded box with the maze on it, over what would
         otherwise be backdrop. */
      const w = c.width, h = c.height;
      const bw = Math.round(w * 0.34), bh = Math.round(bw * (1000 / 1600)) + 20;
      const d = ctx.getImageData(w - bw - 4, 4, bw, bh).data;
      let light = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 330) light++;
      k.stop();
      done(light);
    }, 700));
  });
  ok('the phone carries a plan of the maze', hasMini > 60, `${hasMini} lit pixels in the corner`);

  // ── and the picker shows that plan rather than a mood ──
  const planArt = await page.evaluate(() => {
    const out = {};
    for (const m of ['arena', 'bunker', 'moon']) {
      const svg = NovaArena.plan(m, 320);
      out[m] = (svg.match(/<rect /g) || []).length;
    }
    return out;
  });
  /* One rectangle per wall, and three plans that are actually different. The
     exact counts used to be written in here, so growing the maps "failed" the
     test for having more in them. */
  const wallCount = await page.evaluate(() => {
    const out = {};
    for (const m of ['arena', 'bunker', 'moon']) out[m] = NovaArena.coverFor(m).length;
    return out;
  });
  /* Every wall is drawn, plus whatever framing the plan puts round them — the
     same framing on each, so the difference has to be constant. */
  const extra = ['arena', 'bunker', 'moon'].map(m => planArt[m] - wallCount[m]);
  ok('the picker draws each map from its own walls',
     extra.every(n => n >= 0 && n === extra[0]),
     `${JSON.stringify(planArt)} drawn from ${JSON.stringify(wallCount)}`);
  ok('and the three maps are three different mazes',
     new Set(Object.values(planArt)).size > 1
     && wallCount.arena > 20 && wallCount.bunker > 20 && wallCount.moon > 16,
     JSON.stringify(wallCount));

  // ── the blook is drawn, not a plain blob ──
  const drawn = await page.evaluate(async () => {
    const k = NovaArena.start({ canvas: document.getElementById('c'),
      me: { id: 'me', name: 'A', avatar: 4, team: 'red' }, map: 'arena', send: () => {} });
    await new Promise(r => setTimeout(r, 1200));   // the face has to rasterise
    const loaded = NovaArena.faceReady ? NovaArena.faceReady(4) : false;
    k.stop();
    return loaded;
  });
  /* ── the view is straight down ──
   *
   * This was a tilted camera with a perspective projection, which is handsome
   * and is not the game: Blooket's Laser Tag is flat and top-down. The test
   * for that is arithmetic — under perspective the same wall is drawn shorter
   * when it is further away, and under a top-down view it is not. */
  const flat = await page.evaluate(() => {
    const k = NovaArena.start({ canvas: document.getElementById('c'), map: 'arena',
      me: { id: 'me', name: 'Me', avatar: 1, team: 'red' }, send: () => {} });
    k.place(800, 500);
    const near = k.toScreen(700, 900), near2 = k.toScreen(900, 900);
    const far = k.toScreen(700, 100), far2 = k.toScreen(900, 100);
    const out = {
      nearWide: Math.abs(near2.x - near.x),
      farWide: Math.abs(far2.x - far.x),
      nearY: near.y, farY: far.y
    };
    k.stop();
    return out;
  });
  ok('the same wall is the same size near and far',
     Math.abs(flat.nearWide - flat.farWide) < 0.5,
     `${flat.nearWide.toFixed(1)} near, ${flat.farWide.toFixed(1)} far`);
  ok('and the far end of the arena is up the screen', flat.farY < flat.nearY);

  /* ── the bots are blooks too ──
   *
   * They were green ovals with two eyes: the one thing in a game built out of
   * blooks that was not a blook. */
  const wild = await page.evaluate(() => {
    const k = NovaArena.start({ canvas: document.getElementById('c'), map: 'bunker',
      me: { id: 'me', name: 'Me', avatar: 4, team: 'red' }, send: () => {} });
    return new Promise(done => setTimeout(() => {
      const out = { count: k.botCount(), distinct: 0 };
      k.stop(); done(out);
    }, 300));
  });
  ok('the maze has wandering blooks in it', wild.count >= 6, `${wild.count} of them`);

  // ── and they walk somewhere, without walking into walls ──
  const roam = await page.evaluate(() => {
    const { W, H } = NovaArena.SIZE;   // bots past the old edge are not out of bounds
    const R = 24;
    const near = (b, x, y, r) => {
      const nx = Math.max(b.x, Math.min(x, b.x + b.w));
      const ny = Math.max(b.y, Math.min(y, b.y + b.h));
      return (nx - x) ** 2 + (ny - y) ** 2 < r * r;
    };
    const cover = NovaArena.coverFor('arena');
    const k = NovaArena.start({ canvas: document.getElementById('c'), map: 'arena',
      me: { id: 'me', name: 'Me', avatar: 1, team: 'red' }, send: () => {} });
    const first = k.botsAt();
    return new Promise(done => setTimeout(() => {
      const later = k.botsAt();
      let moved = 0, inWall = 0;
      later.forEach((b, i) => {
        const was = first[i];
        if (was && Math.hypot(b.x - was.x, b.y - was.y) > 20) moved++;
        if (cover.some(c => near(c, b.x, b.y, R))) inWall++;
        if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) inWall++;
      });
      k.stop();
      done({ n: later.length, moved, inWall });
    }, 1500));
  });
  ok('they walk about the maze', roam.moved >= Math.max(1, roam.n - 2),
     `${roam.moved} of ${roam.n} moved`);
  ok('and never through a wall', roam.inWall === 0, `${roam.inWall} inside one`);

  /* ── superpowers are picked up by walking onto them ──
   *
   * And they say what they are. A power that changes how you shoot without ever
   * naming itself is, to a child, the game going wrong. */
  const grab = await page.evaluate(() => {
    let told = null;
    const k = NovaArena.start({ canvas: document.getElementById('c'), map: 'moon',
      me: { id: 'me', name: 'Me', avatar: 1, team: 'red' }, send: () => {},
      onPower: (label, colour, kind) => { told = { label, colour, kind }; } });
    k.place(800, 500);
    k.drop('spread', 806, 502);
    return new Promise(done => setTimeout(() => {
      const out = { told, kind: k.powerKind, left: k.powerLeft, name: k.power };
      k.stop(); done(out);
    }, 400));
  });
  ok('walking onto a superpower picks it up', grab.kind === 'spread', grab.kind || 'nothing');
  ok('and it says what it is', !!grab.told && grab.told.label === 'Triple beam',
     grab.told ? grab.told.label : 'said nothing');
  ok('and it comes with a clock', grab.left > 0.5 && grab.left <= 1, String(grab.left));

  // ── the force field spends itself on one hit, and no more ──
  const bubble = await page.evaluate(() => {
    const k = NovaArena.start({ canvas: document.getElementById('c'), map: 'arena',
      me: { id: 'me', name: 'Me', avatar: 1, team: 'red' }, send: () => {} });
    k.grant('shield');
    const had = k.powerKind;
    k.heard('hit', { id: 'them', to: 'me' });
    const after = k.powerKind;
    const alive = k.alive;
    k.heard('hit', { id: 'them', to: 'me' });
    const out = { had, after, alive, dead: !k.alive };
    k.stop();
    return out;
  });
  ok('a force field takes the first hit for you', bubble.had === 'shield' && bubble.alive);
  ok('and only the first', bubble.after === '' && bubble.dead);

  ok('the player is drawn as their blook', drawn, drawn ? 'face rasterised' : 'still the plain shape');

  /* ── the superpowers belong to the room, not to the phone ──
   *
   * They used to be three capsules per device, each placed by that device's own
   * luck: every child was collecting things nobody else could see and walking
   * through places where, for them, nothing was there. From a classroom that is
   * indistinguishable from "the power-ups never show up". */
  const shared = await page.evaluate(() => {
    const spots = (room) => {
      const c = document.createElement('canvas');
      c.width = 400; c.height = 300;
      const k = NovaArena.start({ canvas: c, map: 'arena', room,
                                  me: { id: 'x' + room, name: 'X', avatar: 1, team: 'red' },
                                  send: () => {} });
      const list = k.capsules().map(p => `${p.kind}@${Math.round(p.x)},${Math.round(p.y)}`);
      k.stop();
      return list;
    };
    const a = spots('507341'), b = spots('507341'), other = spots('999111');
    return { a, b, other };
  });
  ok('two phones in the same game see the same superpowers, in the same places',
     shared.a.length > 0 && shared.a.join('|') === shared.b.join('|'),
     `${shared.a.length} of them, first is ${shared.a[0]}`);
  ok('and a different game gets a different arrangement',
     shared.a.join('|') !== shared.other.join('|'),
     `other game starts with ${shared.other[0]}`);
  ok('there are enough of them to find in a maze this size',
     shared.a.length >= 6, `${shared.a.length} on the floor`);

  /* And one child taking one takes it from everybody. */
  const grabbed = await page.evaluate(async () => {
    const mk = (id) => {
      const c = document.createElement('canvas');
      c.width = 400; c.height = 300;
      const sent = [];
      const k = NovaArena.start({ canvas: c, map: 'arena', room: '424242',
                                  me: { id, name: id, avatar: 1, team: 'red' },
                                  send: (event, payload) => sent.push({ event, payload }) });
      return { k, sent };
    };
    const one = mk('ana'), two = mk('ben');
    const target = one.k.capsules()[0];
    const before = two.k.capsules().length;
    // Ana walks onto it
    one.k.place(target.x, target.y);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const told = one.sent.filter(m => m.event === 'grab').pop();
    if (told) two.k.heard('grab', told.payload);
    const after = two.k.capsules().length;
    const gone = !two.k.capsules().some(c => c.id === target.id);
    one.k.stop(); two.k.stop();
    return { told: !!told, before, after, gone, power: one.k.power };
  });
  ok('walking onto one tells the rest of the room', grabbed.told,
     grabbed.told ? 'a grab went out' : 'nobody was told');
  ok('and it is gone from their floor too', grabbed.gone && grabbed.after === grabbed.before - 1,
     `${grabbed.before} before, ${grabbed.after} after`);

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
