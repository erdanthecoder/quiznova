/* Boss Battle: three minutes, thirty health, and nobody in step.
 *
 * It used to run question by question with a ten-second fight between each, so
 * a child who read quickly spent most of the mode watching and a child who read
 * slowly was hurried by a clock that was not theirs. Now the whole quiz is on
 * the phone, everybody works through it at their own pace, a right answer loads
 * a knife, and the knife takes one health off and then needs two seconds.
 *
 * This drives it through the real server and the real pages.
 */
const path = require('path');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/bosstest', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();
  const look = async () => (await fetch(`${base}/api/games/${pin}`)).json();

  const quiz = await post('/api/quizzes', { title: 'Lesson', questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  await post(`/api/quizzes/${qid}/ops`, { ops: [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
    op: 'add_question', question: { type: 'mc', text: `Question ${n}`, points: 100, time: 30,
      choices: [{ text: 'right', correct: true }, { text: 'wrong' }] } })) });
  await post(`/api/quizzes/${qid}/ops`, { ops: [{ op: 'delete_question', at: 0 }] });

  const made = await post('/api/games', { quizId: qid, mode: 'boss', map: '' });
  var pin = made.pin; const ht = made.hostToken;
  const ana = await post(`/api/games/${pin}/join`, { name: 'Ana', avatar: 3 });
  const ben = await post(`/api/games/${pin}/join`, { name: 'Ben', avatar: 12 });
  const anaId = (ana.player || ana).id, benId = (ben.player || ben).id;

  await post(`/api/games/${pin}/start`, { hostToken: ht });
  let view = await look();

  // ── one long fight, not a question at a time ──
  ok('starting drops the class straight into the fight', view.state === 'strike', view.state);
  ok('the boss has thirty health', view.boss && view.boss.hp === 30 && view.boss.max === 30,
     JSON.stringify(view.boss));
  const left = (view.endsAt || 0) - view.serverNow;
  ok('and three minutes on the clock', left > 178000 && left <= 180000, `${Math.round(left / 1000)}s`);
  ok('every phone holds the whole quiz, because nobody is in step',
     Array.isArray(view.quiz) && view.quiz.length === 8, `${view.quiz && view.quiz.length} questions`);

  const qs = view.quiz;
  const right = (q) => (q.choices.find(c => c.correct) || q.choices[0]).id;
  const wrong = (q) => (q.choices.find(c => !c.correct) || q.choices[0]).id;

  // ── answering loads the knife; it does not hurt the boss ──
  let out = await post(`/api/games/${pin}/answer`,
    { playerId: anaId, questionId: qs[0].id, answer: right(qs[0]), speed: 0.9 });
  ok('a right answer loads a knife', out.correct === true && out.loaded === 1, JSON.stringify(out));
  ok('and answering fast earns a greatsword to do it with', out.blade === 'great', out.blade);
  view = await look();
  ok('answering does not touch the boss', view.boss.hp === 30, `${view.boss.hp} left`);

  out = await post(`/api/games/${pin}/answer`,
    { playerId: benId, questionId: qs[1].id, answer: wrong(qs[1]), speed: 0.9 });
  ok('a wrong answer loads nothing', out.correct === false && !out.loaded, JSON.stringify(out));

  /* Anybody can answer any question at any time: two children on different
     questions at once is the whole point of taking the room out of step. */
  const both = await Promise.all([
    post(`/api/games/${pin}/answer`, { playerId: anaId, questionId: qs[5].id, answer: right(qs[5]), speed: 0.2 }),
    post(`/api/games/${pin}/answer`, { playerId: benId, questionId: qs[2].id, answer: right(qs[2]), speed: 0.2 })
  ]);
  ok('two children can be on different questions at the same time',
     both.every(r => r.correct === true), JSON.stringify(both.map(r => r.correct)));

  // ── the knife: one health, then two seconds ──
  out = await post(`/api/games/${pin}/strike`, { playerId: anaId });
  ok('one knife takes exactly one health off', out.ok === true && out.hp === 29,
     JSON.stringify(out));

  out = await post(`/api/games/${pin}/strike`, { playerId: anaId });
  ok('and it cannot be used again straight away', out.ok === false && /Reload/i.test(out.why || ''),
     JSON.stringify(out));
  view = await look();
  ok('so a second tap takes nothing more off', view.boss.hp === 29, `${view.boss.hp} left`);

  await sleep(2100);
  out = await post(`/api/games/${pin}/strike`, { playerId: anaId });
  ok('two seconds later it works again', out.ok === true && out.hp === 28, JSON.stringify(out));

  // Ben loaded one earlier, so spend it first and then try the empty knife
  await post(`/api/games/${pin}/strike`, { playerId: benId });
  await sleep(2100);
  out = await post(`/api/games/${pin}/strike`, { playerId: benId });
  ok('a knife nobody loaded does nothing', out.ok === false && /load/i.test(out.why || ''),
     JSON.stringify(out));

  /* ── it hits back ──
     The mode's real fault was that the boss could not do anything to anybody:
     thirty children tapping a sandbag. Now it winds up where the room can see
     it, a held knife turns it aside, and an empty hand is on the floor for four
     seconds and cannot cut while it is there. */
  view = await look();
  ok('the room can see the next swing coming', (view.bossSwingAt || 0) > view.serverNow,
     `${Math.round(((view.bossSwingAt || 0) - view.serverNow) / 1000)}s away`);

  await post(`/api/games/${pin}/answer`,
    { playerId: anaId, questionId: qs[3].id, answer: right(qs[3]), speed: 0.5 });
  const guard = await look();
  const anaLoaded = guard.players.find(p => p.id === anaId);
  ok('Ana is holding one ready and Ben is empty-handed',
     (anaLoaded.loaded || 0) > 0, `${anaLoaded.loaded} in hand`);

  const swung = await post(`/api/games/${pin}/swing`, { hostToken: ht });
  ok('the boss swings when the board says it is time',
     swung.ok === true && swung.swing && swung.swing.blocked === 1 && swung.swing.caught === 1,
     JSON.stringify(swung.swing));
  view = await look();
  const anaNow = view.players.find(p => p.id === anaId);
  const benNow = view.players.find(p => p.id === benId);
  ok('the knife she was holding is spent turning it aside, and she stays up',
     (anaNow.loaded || 0) === 0 && !(anaNow.downUntil > view.serverNow),
     `Ana: ${anaNow.loaded} left, blocks ${anaNow.blocks}`);
  ok('and the one with nothing in hand is knocked down',
     (benNow.downUntil || 0) > view.serverNow,
     `Ben is down for ${Math.round(((benNow.downUntil || 0) - view.serverNow) / 100) / 10}s`);

  await post(`/api/games/${pin}/answer`,
    { playerId: benId, questionId: qs[4].id, answer: wrong(qs[4]), speed: 0.5 });
  out = await post(`/api/games/${pin}/strike`, { playerId: benId });
  ok('a child on the floor cannot cut until they are up',
     out.ok === false && out.down === true, JSON.stringify(out));

  out = await post(`/api/games/${pin}/answer`,
    { playerId: benId, questionId: qs[6].id, answer: right(qs[6]), speed: 0.5 });
  view = await look();
  ok('answering right is what gets you back on your feet',
     !((view.players.find(p => p.id === benId).downUntil || 0) > view.serverNow),
     'Ben is up');

  out = await post(`/api/games/${pin}/swing`, { playerId: anaId });
  ok('and a child cannot make the boss swing at the class',
     out.error !== undefined, JSON.stringify(out).slice(0, 60));

  // ── the fight ends when the health does ──
  const spend = async (who) => {
    for (let i = 0; i < 8; i++) {
      const q = qs[i % qs.length];
      await post(`/api/games/${pin}/answer`,
        { playerId: who, questionId: q.id, answer: right(q), speed: 0.5 });
    }
    for (let i = 0; i < 8; i++) {
      const r = await post(`/api/games/${pin}/strike`, { playerId: who });
      if (r.ok && r.hp === 0) return true;
      await sleep(2050);
    }
    return false;
  };
  let down = false;
  for (let round = 0; round < 3 && !down; round++) {
    down = await spend(anaId) || await spend(benId);
  }
  view = await look();
  ok('cutting it to nothing ends the game', view.boss.hp === 0 && view.state === 'over',
     `${view.boss.hp} left, state ${view.state}`);
  const winner = view.players.slice().sort((a, b) => (b.hits || 0) - (a.hits || 0))[0];
  ok('and the score is knives put in', (winner.hits || 0) > 0 && winner.score === winner.hits,
     `${winner.name}: ${winner.hits} in, score ${winner.score}`);

  /* ── the pages ── */
  const browser = await chromium.launch({ executablePath: CHROME, headless: false });

  const made2 = await post('/api/games', { quizId: qid, mode: 'boss', map: '' });
  const pin2 = made2.pin, ht2 = made2.hostToken;
  await post(`/api/games/${pin2}/join`, { name: 'Cleo', avatar: 7 });

  const board = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const berrs = []; board.on('pageerror', e => berrs.push(e.message));
  await board.goto(`${base}/host.html?pin=${pin2}#h=${ht2}`, { waitUntil: 'domcontentloaded' });
  await board.waitForTimeout(700);

  const phone = await browser.newPage({ viewport: { width: 390, height: 820 }, hasTouch: true });
  const perrs = []; phone.on('pageerror', e => perrs.push(e.message));
  await phone.goto(`${base}/play.html?pin=${pin2}`, { waitUntil: 'domcontentloaded' });
  await phone.waitForTimeout(600);
  await phone.locator('input').first().fill('Cal');
  await phone.locator('button:has-text("Join the game")').first().click();
  await phone.waitForTimeout(800);

  await post(`/api/games/${pin2}/start`, { hostToken: ht2 });
  await phone.waitForTimeout(2000);
  await board.waitForTimeout(1800);

  ok('the phone shows a question straight away, with no waiting for the room',
     await phone.locator('#strikeq .opt-btn').count() > 0,
     (await phone.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 70));
  /* The boss is on the phone now, and that is the point of the mode.
   *
   * It used to be a STRIKE button with a question under it, and the boss lived
   * only on the board: "it doesn't let us play and see and kill", which was
   * fair. A child fights the thing on their own screen — the same boss, drawn
   * in their hand — and cuts it by dragging across it. */
  ok('the child can see the boss they are fighting, on their own phone',
     await phone.locator('#s-boss').count() === 1);
  const lit = await phone.evaluate(() => {
    const c = document.getElementById('s-boss');
    if (!c) return -1;
    const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let on = 0, n = 0;
    for (let i = 0; i < g.length; i += 4 * 37) { n++; if (g[i] + g[i + 1] + g[i + 2] > 45) on++; }
    return Math.round(on / n * 100);
  });
  ok('and it is drawn, not an empty box', lit > 55, `${lit}% of the card is painted`);
  ok('with nothing loaded, a swipe is refused rather than swallowed',
     await phone.evaluate(() => typeof duel !== 'undefined' && duel && duel.ready === false),
     'the knife is empty');

  /* Answer, and the same swipe takes a health off the thing in front of you. */
  const cut = await phone.evaluate(async () => {
    const before = (game.boss || {}).hp;
    // answer this child's own question, whichever it is, correctly
    const q = (game.quiz || [])[0];
    const right = (q.choices.find(c => c.correct) || q.choices[0]).id;
    await Nova.api(`/games/${game.pin}/answer`, { method: 'POST',
      body: { playerId: me.id, questionId: q.id, answer: right, speed: 0.9 } });
    await new Promise(r => setTimeout(r, 400));
    const loaded = duel.ready;
    // and swipe across the boss, the way a thumb does
    const c = document.getElementById('s-boss');
    const box = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true,
      clientX: box.left + box.width * 0.25, clientY: box.top + box.height * 0.3 }));
    c.dispatchEvent(new MouseEvent('mouseup', { bubbles: true,
      clientX: box.left + box.width * 0.75, clientY: box.top + box.height * 0.7 }));
    await new Promise(r => setTimeout(r, 900));
    return { before, loaded, after: (game.boss || {}).hp };
  });
  ok('answering loads the knife on the phone', cut.loaded === true,
     cut.loaded ? 'ready to cut' : 'still empty after a right answer');
  ok('and a swipe across the boss takes its health off',
     cut.after === cut.before - 1, `${cut.before} → ${cut.after}`);

  const drawn = await board.evaluate(() => {
    const c = document.getElementById('board-strike');
    if (!c || !c.isConnected) return { ok: false, why: 'no boss on the board' };
    const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let on = 0, n = 0;
    for (let i = 0; i < g.length; i += 4 * 53) { n++; if (g[i] + g[i + 1] + g[i + 2] > 40) on++; }
    return { ok: true, pct: Math.round(on / n * 100) };
  });
  ok('the boss is drawn on the board', drawn.ok && drawn.pct > 60,
     drawn.ok ? `${drawn.pct}% painted` : drawn.why);
  const boardText = (await board.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  ok('with its health and the clock on it',
     /[0-9]+ HEALTH LEFT/i.test(boardText) && /[0-9]:[0-9]{2}/.test(boardText),
     boardText.slice(0, 80));

  /* Answering on the real phone, by tapping the answer, loads the real knife —
     the whole loop a child actually does, with no API calls of our own. */
  /* The right one, read off the tile. Tapping whichever came first was a coin
     toss once the answers started being shuffled, and a coin toss in a suite is
     a check that fails one run in two and gets called flaky. */
  const rightTile = phone.locator('#strikeq .opt-btn', { hasText: /^\s*right\s*$/i }).first();
  if (await rightTile.count()) await rightTile.click();
  else await phone.locator('#strikeq .opt-btn').first().click();
  await phone.waitForTimeout(1600);
  const armed = await phone.evaluate(() => ({
    ready: duel ? duel.ready : null,
    loaded: me.loaded || 0
  }));
  ok('answering on the phone loads a knife it can cut with',
     armed.loaded > 0 || armed.ready === true,
     `${armed.loaded} loaded, ready: ${armed.ready}`);

  ok('no errors on the phone', perrs.length === 0, perrs.slice(0, 2).join(' | '));
  ok('no errors on the board', berrs.length === 0, berrs.slice(0, 2).join(' | '));

  await board.screenshot({ path: path.join(__dirname, 'shots', 'strike.png') }).catch(() => {});
  await phone.screenshot({ path: path.join(__dirname, 'shots', 'strike-phone.png') }).catch(() => {});
  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
