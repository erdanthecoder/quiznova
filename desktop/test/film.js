/* Film every mode actually being played.
 *
 * Not a mock-up and not a screenshot: the real server, the real board, real
 * phones joining and answering and shooting, recorded as it happens. A still
 * cannot show a block falling, a robot closing in, or a boss winding up, and
 * those are the things the last few days of work were about.
 *
 *   node desktop/test/film.js [mode ...]     boss tower run laser
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = path.join(__dirname, 'films');
const BOARD = { width: 1280, height: 720 };
const PHONE = { width: 420, height: 880 };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const want = process.argv.slice(2).filter(a => !a.startsWith('-'));
const doing = (m) => !want.length || want.includes(m);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/filmdata', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  /* One quiz, easy enough that a script can answer it and real enough that the
     film shows words a teacher would recognise. */
  const quiz = await post('/api/quizzes', { title: 'Lesson', questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  const asks = [
    ['What is 7 x 8?', '56', '48'], ['Capital of France?', 'Paris', 'Lyon'],
    ['H2O is?', 'Water', 'Salt'], ['5 squared?', '25', '10'],
    ['Biggest planet?', 'Jupiter', 'Mars'], ['Opposite of hot?', 'Cold', 'Warm'],
    ['12 / 4?', '3', '6'], ['Colour of grass?', 'Green', 'Blue'],
    ['Days in a week?', '7', '5'], ['3 + 9?', '12', '11'],
    ['Largest ocean?', 'Pacific', 'Arctic'], ['Half of 50?', '25', '20']
  ];
  await post(`/api/quizzes/${qid}/ops`, { ops: asks.map(([text, a, b]) => ({
    op: 'add_question', question: { type: 'mc', text, points: 100, time: 30,
      choices: [{ text: a, correct: true }, { text: b }] } })) });
  await post(`/api/quizzes/${qid}/ops`, { ops: [{ op: 'delete_question', at: 0 }] });

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });

  /** A game, a board watching it, and some phones in it. */
  async function room(mode, names, opts = {}) {
    const made = await post('/api/games', { quizId: qid, mode, map: opts.map || '' });
    const pin = made.pin, ht = made.hostToken;
    const ctx = await browser.newContext({ viewport: BOARD,
      recordVideo: { dir: path.join(OUT, '_raw'), size: BOARD } });
    const board = await ctx.newPage();
    await board.goto(`${base}/host.html?pin=${pin}#h=${ht}`, { waitUntil: 'domcontentloaded' });
    await board.waitForTimeout(900);

    const phones = [];
    for (const name of names) {
      const pctx = opts.filmPhone
        ? await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true,
            recordVideo: { dir: path.join(OUT, '_raw'), size: PHONE } })
        : await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true });
      const page = await pctx.newPage();
      await page.goto(`${base}/play.html?pin=${pin}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      await page.locator('input').first().fill(name);
      await page.locator('button:has-text("Join the game")').first().click();
      await page.waitForTimeout(600);
      phones.push({ name, page, ctx: pctx, filmed: !!opts.filmPhone });
      opts.filmPhone = opts.filmPhone && false;   // only the first phone is filmed
    }
    await board.waitForTimeout(1200);
    return { pin, ht, board, ctx, phones, post };
  }

  /** Close it down and put the films where they belong. */
  async function keep(r, names) {
    const vids = [];
    const grab = async (page, ctx, as) => {
      const v = page.video();
      await ctx.close();
      if (!v) return;
      const to = path.join(OUT, as + '.webm');
      await v.saveAs(to).catch(() => {});
      vids.push(to);
    };
    for (const p of r.phones) {
      if (p.filmed) await grab(p.page, p.ctx, names.phone);
      else await p.ctx.close();
    }
    await grab(r.board, r.ctx, names.board);
    return vids;
  }

  const rights = async (page) => page.evaluate(async () => {
    const q = (game.quiz || [])[game.index || 0];
    if (!q) return false;
    const right = (q.choices.find(c => c.correct) || q.choices[0]).id;
    await Nova.api(`/games/${game.pin}/answer`, { method: 'POST',
      body: { playerId: me.id, questionId: q.id, answer: right, speed: 0.6 + Math.random() * 0.35 } });
    return true;
  });

  const made = [];

  /* ── Boss Battle ───────────────────────────────────────────
     A room fighting one thing at its own pace, and the thing fighting back. */
  if (doing('boss')) {
    console.log('filming boss battle');
    const r = await room('boss', ['Ana', 'Ben', 'Cal'], { filmPhone: true });
    await post(`/api/games/${r.pin}/start`, { hostToken: r.ht });
    await sleep(2500);
    const phone = r.phones[0].page;
    /* The child on camera answers, loads, and swipes across the boss — the same
       gesture a thumb makes. The other two keep the health bar moving. */
    for (let round = 0; round < 7; round++) {
      await phone.evaluate(async (n) => {
        const q = (game.quiz || [])[n % (game.quiz || []).length];
        const right = (q.choices.find(c => c.correct) || q.choices[0]).id;
        await Nova.api(`/games/${game.pin}/answer`, { method: 'POST',
          body: { playerId: me.id, questionId: q.id, answer: right, speed: 0.8 } });
      }, round).catch(() => {});
      await sleep(900);
      await phone.evaluate(() => {
        const c = document.getElementById('s-boss');
        if (!c) return;
        const box = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true,
          clientX: box.left + box.width * 0.2, clientY: box.top + box.height * 0.28 }));
        c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
          clientX: box.left + box.width * 0.5, clientY: box.top + box.height * 0.5 }));
        c.dispatchEvent(new MouseEvent('mouseup', { bubbles: true,
          clientX: box.left + box.width * 0.82, clientY: box.top + box.height * 0.72 }));
      }).catch(() => {});
      /* Two swings inside the film, so the wind-up and the block are both on
         camera — the mode's whole point is that it hits back. */
      if (round === 2 || round === 5) {
        await post(`/api/games/${r.pin}/swing`, { hostToken: r.ht });
      }
      await sleep(1500);
    }
    made.push(...await keep(r, { board: 'boss-battle-board', phone: 'boss-battle-phone' }));
  }

  /* ── Tallest Tower ─────────────────────────────────────────
     Three teams, self-paced, blocks falling in and a gorilla on the winner. */
  if (doing('tower')) {
    console.log('filming tallest tower');
    const r = await room('tower', ['Ana', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay'], { filmPhone: true });
    await post(`/api/games/${r.pin}/start`, { hostToken: r.ht });
    await sleep(2200);
    for (let round = 0; round < 12; round++) {
      for (const p of r.phones) {
        await p.page.evaluate(async () => {
          const q = (game.quiz || [])[Math.floor(Math.random() * (game.quiz || []).length)];
          if (!q) return;
          const right = (q.choices.find(c => c.correct) || q.choices[0]).id;
          await Nova.api(`/games/${game.pin}/answer`, { method: 'POST',
            body: { playerId: me.id, questionId: q.id, answer: right, speed: 0.7 } });
          await new Promise(r2 => setTimeout(r2, 250));
          // and place the block where the slider happens to be
          await Nova.api(`/games/${game.pin}/place`, { method: 'POST',
            body: { playerId: me.id, offset: (Math.random() - 0.5) * 0.5 } });
        }).catch(() => {});
      }
      await sleep(1100);
    }
    made.push(...await keep(r, { board: 'tallest-tower-board', phone: 'tallest-tower-phone' }));
  }

  /* ── Robot Run ─────────────────────────────────────────────
     The class running from one thing together, and the thing closing in when
     they stop answering. */
  if (doing('run')) {
    console.log('filming robot run');
    const r = await room('robot', ['Ana', 'Ben', 'Cal', 'Dee'], { filmPhone: true, map: 'station' });
    await post(`/api/games/${r.pin}/start`, { hostToken: r.ht });
    await sleep(2500);
    /* First they run: everybody answers, boosts go in, the robot is shoved
       back. Then they stop, and it comes for them — which is the change that
       made the chase a chase. */
    for (let round = 0; round < 8; round++) {
      for (const p of r.phones) {
        await rights(p.page).catch(() => {});
        await p.page.evaluate(async () => {
          await new Promise(r2 => setTimeout(r2, 200));
          await Nova.api(`/games/${game.pin}/boost`, { method: 'POST',
            body: { playerId: me.id } }).catch(() => {});
        }).catch(() => {});
      }
      await sleep(1000);
    }
    console.log('  ... and now nobody answers');
    await sleep(9000);
    made.push(...await keep(r, { board: 'robot-run-board', phone: 'robot-run-phone' }));
  }

  /* ── Laser Tag ─────────────────────────────────────────────
     Two teams in one arena. Nobody is ever out: you are tagged, you answer,
     you are back. */
  if (doing('laser')) {
    console.log('filming laser tag');
    const r = await room('laser', ['Ana', 'Ben', 'Cal', 'Dee'], { filmPhone: true, map: 'bunker' });
    await post(`/api/games/${r.pin}/start`, { hostToken: r.ht });
    await sleep(2500);
    const phone = r.phones[0].page;
    /* Walk the filmed player around the arena and fire, so the film has
       movement, a muzzle flash and the map going past rather than a still. */
    for (let beat = 0; beat < 26; beat++) {
      const a = (beat / 26) * Math.PI * 2;
      await phone.evaluate(([dx, dy]) => {
        if (typeof arena === 'undefined' || !arena) return;
        arena.stick(dx, dy);
        if (arena.fire) arena.fire();
      }, [Math.cos(a), Math.sin(a)]).catch(() => {});
      await sleep(420);
    }
    await phone.evaluate(() => { if (typeof arena !== 'undefined' && arena) arena.stick(0, 0); })
      .catch(() => {});
    await sleep(1200);
    made.push(...await keep(r, { board: 'laser-tag-board', phone: 'laser-tag-phone' }));
  }

  await browser.close();
  await srv.close?.();
  fs.rmSync(path.join(OUT, '_raw'), { recursive: true, force: true });
  console.log('\nfilms:');
  made.forEach(f => console.log('  ' + f + '  ' +
    (fs.existsSync(f) ? Math.round(fs.statSync(f).size / 1024) + 'kB' : 'MISSING')));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
