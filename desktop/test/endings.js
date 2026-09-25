/* The two modes that could not end.
 *
 * Boss Battle finishes when the boss drops or the clock runs out. Robot Run
 * finishes when the lives are gone. Classic Quiz finishes when the questions
 * do. Laser Tag and Tallest Tower had nothing: they ran until a teacher pressed
 * a button, which is not an ending, it is being switched off.
 *
 * And Laser Tag's ending screen read game.teams.red.hp against .blue.hp. Those
 * start at zero and are only ever subtracted from, so every laser game the app
 * has ever played ended "A draw · Crimson 0 HP · Cobalt 0 HP" whoever won.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { Server } = require('../server.js');
const R = require('../../static/rules.js');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.rmSync('/tmp/claude-0/endtest', { recursive: true, force: true });
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/endtest', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, b) => (await fetch(base + p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  const quiz = await post('/api/quizzes', { title: 'Lesson', starter: false, questions: [] });
  const qid = quiz.quiz ? quiz.quiz.id : quiz.id;
  await post(`/api/quizzes/${qid}/ops`, { ops: [1, 2, 3, 4, 5, 6].map(n => ({
    op: 'add_question', question: { type: 'mc', text: `Question ${n}`, points: 100, time: 30,
      choices: [{ text: 'right', correct: true }, { text: 'wrong' }] } })) });

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });

  /* ── the rule itself ── */
  ok('a mode with a target can say when it is over',
     R.modeFinished({ mode: 'laser', players: { a: { team: 'red', score: R.LASER_TARGET } } }) === true);
  ok('and says nothing while it is still being played',
     R.modeFinished({ mode: 'laser', players: { a: { team: 'red', score: 10 } } }) === false);
  ok('a tower reaching the target wins it',
     R.towerWinner({ towers: { red: { blocks: new Array(R.TOWER_TARGET * R.SLOTS).fill({}) },
                               blue: { blocks: [] }, green: { blocks: [] } } }) === 'red');
  ok('and a tower short of it has not',
     R.towerWinner({ towers: { red: { blocks: new Array(R.TOWER_TARGET * R.SLOTS - 1).fill({}) },
                               blue: { blocks: [] }, green: { blocks: [] } } }) === '');

  /* ── laser tag, played to a finish ── */
  const made = await post('/api/games', { quizId: qid, mode: 'laser', map: 'bunker' });
  const pin = made.pin, ht = made.hostToken;
  const ids = [];
  for (const name of ['Ana', 'Ben', 'Cal', 'Dee']) {
    const j = await post(`/api/games/${pin}/join`, { name, avatar: ids.length });
    ids.push((j.player || j));
  }
  await post(`/api/games/${pin}/start`, { hostToken: ht });

  const board = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; board.on('pageerror', e => errs.push(e.message));
  await board.goto(`${base}/host.html?pin=${pin}#h=${ht}`, { waitUntil: 'domcontentloaded' });
  await sleep(1200);

  let view = await (await fetch(`${base}/api/games/${pin}`)).json();
  ok('laser tag starts in the arena and is not over', view.state === 'arena', view.state);

  /* Tags are scored in the arena itself, which no test can drive from outside,
     so the score is put on the players the way a tagging spree would. */
  const live = [...srv.games.games.values()].find(g => g.pin === pin);
  const red = Object.values(live.players).filter(p => p.team === 'red');
  const blue = Object.values(live.players).filter(p => p.team === 'blue');
  red.forEach((p, i) => { p.score = i === 0 ? R.LASER_TARGET : 0; });
  blue.forEach(p => { p.score = 300; });
  await post(`/api/games/${pin}/tick`, { hostToken: ht });
  await sleep(400);
  view = await (await fetch(`${base}/api/games/${pin}`)).json();
  ok('a side reaching the target ends it', view.state === 'over', view.state);

  await board.waitForFunction(
    () => !!document.querySelector('.stand[data-place="1"].up'), null, { timeout: 9000 });
  await sleep(300);
  const ending = await board.evaluate(() => document.querySelector('.crown')
    ? document.querySelector('.crown').innerText.replace(/\s+/g, ' ') : '');
  ok('and the ending names the side that won, not "A draw"',
     /Crimson wins/.test(ending), ending);
  ok('with the score it won by, not nought HP each',
     /2000/.test(ending) && !/HP/.test(ending), ending);

  /* ── tallest tower, played to a finish ── */
  const made2 = await post('/api/games', { quizId: qid, mode: 'tower', map: 'site' });
  const pin2 = made2.pin, ht2 = made2.hostToken;
  for (const name of ['Fay', 'Gus', 'Hal']) await post(`/api/games/${pin2}/join`, { name, avatar: 3 });
  await post(`/api/games/${pin2}/start`, { hostToken: ht2 });
  const live2 = [...srv.games.games.values()].find(g => g.pin === pin2);
  let v2 = await (await fetch(`${base}/api/games/${pin2}`)).json();
  ok('tallest tower starts building and is not over', v2.state === 'building', v2.state);

  R.towersOf(live2);
  live2.towers.blue.blocks = new Array(R.TOWER_TARGET * R.SLOTS).fill({ o: 0, by: 'Gus', neat: true });
  live2.towers.red.blocks = new Array(12).fill({ o: 0, by: 'Fay', neat: true });
  await post(`/api/games/${pin2}/tick`, { hostToken: ht2 });
  await sleep(400);
  v2 = await (await fetch(`${base}/api/games/${pin2}`)).json();
  ok('a tower reaching the target ends the race', v2.state === 'over', v2.state);

  const board2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  board2.on('pageerror', e => errs.push(e.message));
  await board2.goto(`${base}/host.html?pin=${pin2}#h=${ht2}`, { waitUntil: 'domcontentloaded' });
  await board2.waitForFunction(
    () => !!document.querySelector('.stand[data-place="1"].up'), null, { timeout: 9000 });
  await sleep(300);
  const ending2 = await board2.evaluate(() => document.querySelector('.crown')
    ? document.querySelector('.crown').innerText.replace(/\s+/g, ' ') : '');
  ok('and it is the team that is named, not one child',
     /Cobalt wins/.test(ending2), ending2);
  ok('with how high they got', new RegExp(R.TOWER_TARGET + ' floors').test(ending2), ending2);

  ok('no errors on either board', errs.length === 0, errs.slice(0, 2).join(' | '));
  await board.screenshot({ path: path.join(__dirname, 'shots', 'laser-ending.png') }).catch(() => {});
  await board2.screenshot({ path: path.join(__dirname, 'shots', 'tower-ending.png') }).catch(() => {});

  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
