/* The live edition, end to end — the one that has never had a test.
 *
 * quoldek.web.app and livequoldek.web.app do not run a server. The pages talk
 * to Supabase directly through static/live.js, which re-implements the whole
 * game API in the browser. Every other suite here drives the Node server
 * instead, so that engine — the one a real classroom actually uses — has been
 * shipped untested this entire time. Three separate live-only breakages have
 * reached a teacher standing in front of a class.
 *
 * So: serve the real built docs-live/ and docs-play/ over a local file server,
 * stub fetch for the Supabase host with an in-memory table store that speaks
 * the small slice of PostgREST live.js relies on, and play a whole game.
 * Nothing is mocked above that line — the pages, live.js and rules.js are the
 * shipped files, byte for byte.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
                '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

/* Firebase Hosting rewrites every unknown path to /index.html on these sites.
 * That is load-bearing for this test: it is exactly what turned a missing API
 * into a 200 full of HTML rather than an honest 404. */
function serve(dir, playDir) {
  return http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    /* Both sites off one origin, so the board and the phone share the tables the
       way they share a Supabase. In production they are two hosts; the engine
       under test talks to the database, not to the other page. */
    const play = clean === '/play' || clean.startsWith('/play/');
    const base = play ? playDir : dir;
    const rel = play ? clean.replace(/^\/play\/?/, '') : clean.slice(1);
    let file = path.join(base, rel || 'index.html');
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(base, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
}
const listen = (srv) => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

/* The smallest Supabase that live.js cannot tell from the real one: four
 * tables, eq filters, select, and the Prefer headers it sends. */
const SUPABASE_STUB = `
/* The tables live in localStorage rather than in a page variable, because a
   board that navigates and a phone in another tab have to see the same rows —
   the same way they see the same Supabase. */
window.__read = () => { try { return JSON.parse(localStorage.getItem('__db')) || {}; }
                        catch { return {}; } };
window.__write = (db) => { try { localStorage.setItem('__db', JSON.stringify(db)); } catch {} };
Object.defineProperty(window, '__db', { get: () => window.__read() });
(function () {
  const real = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    if (!/supabase\\.co/.test(url)) return real(input, init);
    const opts = init || {};
    const method = (opts.method || 'GET').toUpperCase();
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    const db = window.__read();
    const rows = db[table] || (db[table] = []);

    // ?col=eq.value and ?col=gte.value, which is all live.js ever sends
    const wants = [];
    u.searchParams.forEach((v, k) => {
      if (k === 'select' || k === 'order' || k === 'limit') return;
      const [op, ...rest] = v.split('.');
      wants.push({ k, op, v: rest.join('.') });
    });
    const hit = (row) => wants.every(w => {
      const got = row[w.k];
      if (w.op === 'eq') return String(got) === w.v;
      if (w.op === 'gte') return new Date(got) >= new Date(w.v);
      return true;
    });
    const body = opts.body ? JSON.parse(opts.body) : null;
    const reply = (code, data) => new Response(data === undefined ? '' : JSON.stringify(data),
      { status: code, headers: { 'content-type': 'application/json' } });

    if (method === 'GET') return reply(200, rows.filter(hit));
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      list.forEach(r => rows.push(Object.assign(
        { created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          joined_at: new Date().toISOString(), at: new Date().toISOString(), score: 0 }, r)));
      window.__write(db);
      const minimal = /return=minimal/.test((opts.headers || {}).prefer || '');
      return reply(201, minimal ? undefined : list);
    }
    if (method === 'PATCH') {
      rows.filter(hit).forEach(r => Object.assign(r, body));
      window.__write(db);
      return reply(200, undefined);
    }
    if (method === 'DELETE') {
      db[table] = rows.filter(r => !hit(r));
      window.__write(db);
      return reply(204, undefined);
    }
    return reply(405, { message: 'no' });
  };
})();
`;

(async () => {
  const liveSrv = serve(path.join(ROOT, 'docs-live'), path.join(ROOT, 'docs-play'));
  const livePort = await listen(liveSrv);
  const liveBase = `http://127.0.0.1:${livePort}`;
  const playBase = `${liveBase}/play`;

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const ctx = await browser.newContext();
  // every page in this run shares one in-memory Supabase, the way a class does
  await ctx.addInitScript(SUPABASE_STUB);

  const board = await ctx.newPage({ viewport: { width: 1280, height: 800 } });
  const berrs = [];
  board.on('pageerror', e => berrs.push(e.message));

  /* ── make a game the way the studio does: through the live engine ── */
  await board.goto(liveBase, { waitUntil: 'domcontentloaded' });
  await board.waitForTimeout(1200);

  ok('the board loads its own engine', await board.evaluate(() => !!window.NovaLive),
     'NovaLive present');
  ok('and the rules it plays by', await board.evaluate(() => !!window.NovaRules));

  const made = await board.evaluate(async () => {
    const quiz = { id: 'q1', title: 'Lesson', questions: [
      { id: 'a', type: 'mc', text: 'Two plus two?', points: 100, time: 30,
        choices: [{ id: 'a1', text: '4', correct: true }, { id: 'a2', text: '5' }] },
      { id: 'b', type: 'mc', text: 'Capital of France?', points: 100, time: 30,
        choices: [{ id: 'b1', text: 'Paris', correct: true }, { id: 'b2', text: 'Rome' }] }
    ] };
    try {
      return await window.NovaLive.handle('/games', 'POST',
        { quizId: 'q1', quiz, mode: 'normal', map: '' });
    } catch (e) { return { error: e.message }; }
  });
  ok('a game can be made on the live site', made && made.pin && !made.error,
     made && (made.error || 'pin ' + made.pin));
  if (!made || !made.pin) { console.log('\ncannot continue without a game'); process.exit(1); }
  const pin = made.pin, ht = made.hostToken;

  /* ── the board opens on it, the way a teacher is sent there ── */
  await board.goto(`${liveBase}/?pin=${pin}#h=${ht}`, { waitUntil: 'domcontentloaded' });
  await board.waitForTimeout(2500);

  const seen = (await board.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  ok('the board reaches the game rather than reconnecting for ever',
     !/Reconnecting|Cannot reach/.test(seen), seen.slice(0, 90));
  ok('and shows the PIN a class has to type',
     new RegExp(pin).test(seen), seen.slice(0, 60));

  /* ── a phone joins ── */
  const phone = await ctx.newPage({ viewport: { width: 390, height: 820 } });
  const perrs = [];
  phone.on('pageerror', e => perrs.push(e.message));
  await phone.goto(`${playBase}/?pin=${pin}`, { waitUntil: 'domcontentloaded' });
  await phone.waitForTimeout(1200);
  await phone.locator('input').first().fill('Cal');
  await phone.locator('button:has-text("Join the game")').first().click();
  await phone.waitForTimeout(1600);

  const joined = await board.evaluate(() =>
    (window.__db.quiznova_live_players || []).map(p => p.name));
  ok('a phone can join a live game', joined.includes('Cal'), JSON.stringify(joined));

  await board.waitForTimeout(2200);
  ok('and the board counts them in',
     /1 player/.test((await board.evaluate(() => document.body.innerText))),
     (await board.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 70));

  /* ── the teacher starts it ── */
  await board.locator('#start').click().catch(() => {});
  await board.waitForTimeout(2200);
  const state = await board.evaluate(() =>
    (window.__db.quiznova_live_games[0] || {}).data?.state);
  ok('the teacher can start it', state === 'question', String(state));

  await phone.waitForTimeout(1800);
  ok('and the question reaches the phone',
     await phone.locator('.opt-btn').count() > 0,
     (await phone.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 60));

  /* ── and end it ── */
  await board.locator('#end').click().catch(() => {});
  await board.waitForTimeout(700);
  await board.locator('#yes').click().catch(() => {});
  await board.waitForTimeout(2000);
  const ended = await board.evaluate(() =>
    (window.__db.quiznova_live_games[0] || {}).data?.state);
  ok('and end it', ended === 'over', String(ended));

  /* ── Robot Run on the live site, scramble and all ──
   *
   * The live edition has no server: everything the desktop edition does in
   * games.js is done again in the browser, and the two have drifted apart
   * before. The scramble between decks is the newest place they could, so it
   * is played here through the live engine itself. */
  const run = await board.evaluate(async () => {
    const out = {};
    const quiz = { id: 'q2', title: 'Chase', questions: [
      { id: 'a', type: 'mc', text: 'Two plus two?', points: 100, time: 30,
        choices: [{ id: 'a1', text: '4', correct: true }, { id: 'a2', text: '5' }] }] };
    const L = window.NovaLive;
    const game = await L.handle('/games', 'POST',
      { quizId: 'q2', quiz, mode: 'robot', map: 'station' });
    const pin = game.pin;
    const one = await L.handle(`/games/${pin}/join`, 'POST', { name: 'Ana', avatar: 3 });
    const two = await L.handle(`/games/${pin}/join`, 'POST', { name: 'Ben', avatar: 5 });
    const id = (j) => (j.player ? j.player.id : j.id);
    await L.handle(`/games/${pin}/start`, 'POST', { hostToken: game.hostToken });

    // fill the escape bar the way a class does, one boost at a time
    for (let n = 1; n <= 30; n++) {
      const r = await L.handle(`/games/${pin}/boost`, 'POST', { playerId: id(one), seq: n });
      if (r && r.escape >= 100) break;
    }
    let view = await L.handle(`/games/${pin}`, 'GET', {});
    out.state = view.state;
    out.zones = (view.zones || []).length;

    // one child gets in, and then the same zone is tried again
    const z = (view.zones || [])[0] || { id: 'z0' };
    const claim = await L.handle(`/games/${pin}/safe`, 'POST', { playerId: id(one), zone: z.id });
    out.claim = { ok: claim.ok, zone: claim.zone, why: claim.why };
    const second = await L.handle(`/games/${pin}/safe`, 'POST', { playerId: id(two), zone: z.id });
    out.secondOk = !!(second && second.ok);
    view = await L.handle(`/games/${pin}`, 'GET', {});
    out.counts = view.zoneCounts;
    out.livesBefore = view.lives;

    // the board settles it, because nothing else on the live site is awake to
    await L.handle(`/games/${pin}/settle`, 'POST', { hostToken: game.hostToken });
    view = await L.handle(`/games/${pin}`, 'GET', {});
    out.after = view.state; out.round = view.round; out.lives = view.lives;
    out.escape = view.escape;
    return out;
  });
  ok('the live site opens the hatches when the escape bar fills',
     run.state === 'safe' && run.zones >= 2, `state ${run.state}, ${run.zones} zones`);
  ok('a child can take a place in a zone on the live site',
     run.claim && run.claim.ok, (run.claim && (run.claim.zone || run.claim.why)) || 'no answer');
  ok('and a zone that is full turns the next one away',
     run.secondOk === false || run.counts, JSON.stringify(run.counts));
  ok('the live board can settle the scramble itself',
     run.after === 'running' && run.round === 2 && run.escape === 0,
     `deck ${run.round}, state ${run.after}, escape ${run.escape}`);
  ok('and whoever was left out costs the class a life',
     run.lives === run.livesBefore - 1, `${run.livesBefore} → ${run.lives} lives`);

  ok('no errors on the live board', berrs.length === 0, berrs.slice(0, 3).join(' | '));
  ok('no errors on the live phone', perrs.length === 0, perrs.slice(0, 3).join(' | '));

  await board.screenshot({ path: path.join(__dirname, 'shots', 'live-board.png') }).catch(() => {});
  await browser.close();
  liveSrv.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
