/* Play a real game through the real server, with the real pages.
 *
 * The simulator tested the rules. This tests everything else: that a phone can
 * see the moves, tap one, and have it reach the scorer — which is the part where
 * a decision layer usually turns out to exist only in the engine.
 */
const path = require('path');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MODES = ['tower', 'boss', 'volcano'];   // laser runs its own real-time arena, not a question screen

let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };

(async () => {
  const srv = new Server({ root: '../../static',
                           dataDir: '/tmp/claude-0/gamedata', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  console.log('server on', port, '\n');

  const post = async (p, body) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' },
                                      body: JSON.stringify(body || {}) });
    return r.json();
  };

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });

  for (const mode of MODES) {
    // a quiz and a game, made the way the pages make them
    const quiz = await post('/api/quizzes', { title: 'T', questions: [] });
    const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
    /* add_question, not addQuestion. The wrong name is silently ignored, which
     * left every one of these tests running on the blank question a new quiz
     * comes with — and answering with choice ids that did not exist, so every
     * answer was graded wrong and only half the code was ever reached. */
    await post(`/api/quizzes/${qid}/ops`, { ops: [
      { op: 'add_question', question: { type: 'mc', text: 'Two plus two?', points: 100, time: 30,
        choices: [{ text: '4', correct: true }, { text: '5' }] } },
      { op: 'add_question', question: { type: 'mc', text: 'Capital of France?', points: 100, time: 30,
        choices: [{ text: 'Paris', correct: true }, { text: 'Rome' }] } }
    ] });
    // the ids are generated, so ask the quiz what they are rather than guessing
    const full = await (await fetch(`${base}/api/quizzes/${qid}`)).json();
    const qs = (full.quiz || full).questions;
    const rightId = (n) => (qs[n].choices.find(c => c.correct) || qs[n].choices[0]).id;
    const wrongId = (n) => (qs[n].choices.find(c => !c.correct) || qs[n].choices[0]).id;
    const made = await post('/api/games', { quizId: qid, mode, map: '' });
    const pin = made.pin || (made.game && made.game.pin);
    const hostToken = made.hostToken;

    // two players join through the real join API
    const a = await post(`/api/games/${pin}/join`, { name: 'Ana', avatar: 1 });
    const b = await post(`/api/games/${pin}/join`, { name: 'Ben', avatar: 2 });

    // Ana plays on a real phone page
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`${base}/play.html?pin=${pin}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    // join the way a child joins: type a name, tap the button
    await page.locator('input').first().fill('Cal');
    await page.locator('button:has-text("Join the game")').first().click();
    await page.waitForTimeout(900);
    const joined = await page.evaluate(() => !/Join the game/.test(document.body.innerText));
    ok(`${mode}: joining from the phone works`, joined,
       (await page.evaluate(() => document.body.innerText)).slice(0, 60).replace(/\s+/g, ' '));

    await post(`/api/games/${pin}/start`, { hostToken });
    // wait for the phone to actually reach the question, however it finds out
    await page.waitForFunction(() => /question \d+ of/i.test(document.body.innerText),
                               null, { timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(600);
    const onQuestion = await page.evaluate(() => /question \d+ of/i.test(document.body.innerText));
    ok(`${mode}: the phone reaches the question`, onQuestion,
       (await page.evaluate(() => document.body.innerText)).slice(0, 70).replace(/\s+/g, ' '));

    const moveCount = await page.locator('.move').count();
    const expected = require('../../static/rules.js').movesFor(mode).length;
    ok(`${mode}: the phone offers all ${expected} moves`, moveCount === expected, `saw ${moveCount}`);

    if (moveCount > 1) {
      // tap the last move — the interesting one — and check it reached the server
      const label = await page.locator('.move').nth(moveCount - 1).locator('b').innerText();
      await page.locator('.move').nth(moveCount - 1).click();
      await page.waitForTimeout(500);
      // a move needing a target shows the target row rather than sending half-made
      const needsAim = await page.locator('.aim button').count();
      if (needsAim) { await page.locator('.aim button').first().click(); await page.waitForTimeout(450); }
      const view = await (await fetch(`${base}/api/games/${pin}`)).json();
      const ana = view.players.find(p => p.name === 'Cal');
      const rules = require('../../static/rules.js');
      const want = rules.movesFor(mode)[moveCount - 1].id;
      ok(`${mode}: tapping "${label}" reaches the game`, ana && ana.move === want,
         `server has "${ana && ana.move}", wanted "${want}"`);
      if (needsAim) ok(`${mode}: and it remembers what it is aimed at`, !!(ana && ana.on), `on=${ana && ana.on}`);
    }

    // a move that has to be pointed at somebody is the one that can silently
    // arrive half-made, so aim one on purpose
    const rules2 = require('../../static/rules.js');
    const aimed = rules2.movesFor(mode).findIndex(m => m.needs === 'player');
    if (aimed >= 0) {
      await page.locator('.move').nth(aimed).click();
      await page.waitForTimeout(400);
      const targets = await page.locator('.aim button').count();
      ok(`${mode}: aiming offers the other players`, targets > 0, `${targets} to choose from`);
      if (targets) {
        await page.locator('.aim button').first().click();
        await page.waitForTimeout(500);
        const v = await (await fetch(`${base}/api/games/${pin}`)).json();
        const cal = v.players.find(p => p.name === 'Cal');
        ok(`${mode}: the aimed move carries its target`,
           cal && cal.move === rules2.movesFor(mode)[aimed].id && !!cal.on,
           `move=${cal && cal.move} on=${cal && cal.on}`);
      }
    }

    ok(`${mode}: no errors on the phone`, errs.length === 0, errs.slice(0, 2).join(' | '));

    // both answer, and the round must actually resolve
    // Cal answers by tapping, the way a child does
    const opt = page.locator('.opts button, .opt').first();
    if (await opt.count()) await opt.click().catch(() => {});
    await post(`/api/games/${pin}/answer`, { playerId: a.player.id, answer: rightId(0) });
    await post(`/api/games/${pin}/answer`, { playerId: b.player.id, answer: wrongId(0) });
    const after = await (await fetch(`${base}/api/games/${pin}`)).json();
    ok(`${mode}: the round resolves`, after.state === 'reveal' || after.state === 'over',
       `state ${after.state}, events: ${(after.lastEvents || []).slice(-1)[0] || 'none'}`);

    await page.close();
  }

  /* ── the boss fight, end to end ──
   * A question, then ten seconds with a sword, then the damage on the board.
   * Every piece of this exists in a different file, so it is exactly the sort of
   * thing that works everywhere except when joined up. */
  {
    const quiz = await post('/api/quizzes', { title: 'Boss', questions: [] });
    const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
    // three questions, so the boss has the health for a real fight and the
    // round after the first one still exists
    await post(`/api/quizzes/${qid}/ops`, { ops: [1, 2, 3].map(() => ({
      op: 'add_question', question: {
        type: 'mc', text: 'Two plus two?', points: 100, time: 30,
        choices: [{ text: '4', correct: true }, { text: '5' }] } })) });
    const bfull = await (await fetch(`${base}/api/quizzes/${qid}`)).json();
    const bqs = (bfull.quiz || bfull).questions;
    const bRight = (bqs[0].choices.find(c => c.correct) || bqs[0].choices[0]).id;
    const made = await post('/api/games', { quizId: qid, mode: 'boss', map: '' });
    const bpin = made.pin || made.game.pin;
    const hostToken = made.hostToken;
    const ana = await post(`/api/games/${bpin}/join`, { name: 'Ana', avatar: 1 });

    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`${base}/play.html?pin=${bpin}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.locator('input').first().fill('Cal');
    await page.locator('button:has-text("Join the game")').first().click();
    await page.waitForTimeout(900);

    await post(`/api/games/${bpin}/start`, { hostToken });
    await page.waitForFunction(() => /question \d+ of/i.test(document.body.innerText),
                               null, { timeout: 15000 }).catch(() => {});
    ok('boss: the question comes up', await page.evaluate(
       () => /question \d+ of/i.test(document.body.innerText)));
    ok('boss: and there is no move to pick any more',
       await page.locator('.move').count() === 0, 'the fight is the decision');

    // answer it, fast and right, which should earn a greatsword
    const opt = page.locator('.opts button, .opt').first();
    if (await opt.count()) await opt.click().catch(() => {});
    await post(`/api/games/${bpin}/answer`, { playerId: ana.player.id, answer: bRight });
    await page.waitForTimeout(600);

    let v = await (await fetch(`${base}/api/games/${bpin}`)).json();
    const cal = v.players.find(p => p.name === 'Cal');
    ok('boss: a right answer arms you', cal && ['great', 'sword'].includes(cal.blade),
       `blade=${cal && cal.blade}`);
    ok('boss: and the boss is untouched by the question itself',
       v.boss && v.boss.hp === v.boss.max, `${v.boss && v.boss.hp}/${v.boss && v.boss.max}`);

    // the teacher sends the class in. Everybody having answered already moved
    // the round to its reveal, so this is the one press that starts the fight.
    await post(`/api/games/${bpin}/next`, { hostToken });
    v = await (await fetch(`${base}/api/games/${bpin}`)).json();
    ok('boss: the round becomes a fight', v.state === 'strike', `state ${v.state}`);
    ok('boss: its health scales with the quiz', v.boss && v.boss.max >= 100,
       `${v.boss && v.boss.max} HP over ${v.total} questions`);
    ok('boss: with a seed every device can run', !!v.strikeSeed, `seed ${v.strikeSeed}`);

    await page.waitForFunction(() => !!document.getElementById('strike'),
                               null, { timeout: 8000 }).catch(() => {});
    ok('boss: the phone shows the fight', await page.locator('#strike').count() > 0);
    ok('boss: with a swing button and a dodge button',
       await page.locator('#swing').count() === 1 && await page.locator('#dodge').count() === 1);

    // swing a few times, with the cooldown respected
    for (let i = 0; i < 6; i++) {
      await page.locator('#swing').dispatchEvent('mousedown').catch(() => {});
      await page.waitForTimeout(450);
    }
    // read what the player is actually shown, not a page-scoped variable
    const shown = await page.locator('#s-dmg').innerText().catch(() => '');
    const dealt = parseInt(shown, 10) || 0;
    ok('boss: swinging on the phone does damage, and says so', dealt > 0,
       `the phone reads "${shown}"`);

    // let the ten seconds run out; the phone reports and the host applies it
    await page.waitForTimeout(8000);
    await post(`/api/games/${bpin}/tick`, { hostToken });
    v = await (await fetch(`${base}/api/games/${bpin}`)).json();
    ok('boss: the damage reaches the boss', v.boss && v.boss.hp < v.boss.max,
       `${v.boss && v.boss.hp}/${v.boss && v.boss.max} left`);
    ok('boss: no errors during the fight', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  await browser.close();
  await srv.close?.();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
