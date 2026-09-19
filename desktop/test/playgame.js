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
// laser and monster run in real time and have their own tests; these two are
// the ones that still step through questions together
// boss is not in step any more and has no question state; strike.js drives it
const MODES = ['tower'];

let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };

(async () => {
  /* An absolute root. This was '../../static', resolved against the working
     directory, so the test only served the site when it was started from its
     own folder and hung waiting for a page that was never there from anywhere
     else. Where you type the command is not a thing a test should care about. */
  const srv = new Server({ root: path.join(__dirname, '..', '..', 'static'),
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

  /* The boss fight used to be checked here: a question, then ten seconds with a
     sword. It is one three-minute self-paced round now with no question state at
     all, so the whole of it — answering out of step, loading a knife, one health
     a hit, the two-second reload and the clock — lives in strike.js, which
     drives it through the real server and the real pages in twenty-four checks.
     Repeating a thinner version of that here would only be a second place for it
     to rot. */

  await browser.close();
  await srv.close?.();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
