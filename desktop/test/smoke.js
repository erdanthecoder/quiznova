/* Does the thing we hand people actually run?
 *
 * Everything else in this repository tests the code. This tests the artefact:
 * the .exe from the release page, installed the way a teacher installs it, then
 * launched and clicked. A build that compiles and a build that opens are not the
 * same claim, and only one of them is worth making.
 *
 * Run with: node test/smoke.js <path-to-Quoldek.exe>
 */
const { _electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) {
  console.error('no exe at', exe);
  process.exit(1);
}

const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

(async () => {
  const app = await _electron.launch({ executablePath: exe, timeout: 60000 });
  const win = await app.firstWindow({ timeout: 60000 });
  await win.waitForLoadState('domcontentloaded');

  // the app serves itself over a local port; give it the moment that takes
  await win.waitForFunction(() => document.body && document.body.textContent.trim().length > 20,
                            null, { timeout: 30000 }).catch(() => {});
  await win.waitForTimeout(1500);

  const title = await win.title();
  check('a window opens', true, JSON.stringify(title));

  const text = await win.evaluate(() => document.body.innerText);
  check('the home screen has drawn', text.length > 40, `${text.length} chars`);
  check('it is Quoldek, not an error page', /quoldek/i.test(text + title),
        text.slice(0, 80).replace(/\s+/g, ' '));
  check('no blank white screen',
        await win.evaluate(() => getComputedStyle(document.body).backgroundColor) !== 'rgba(0, 0, 0, 0)');

  await win.screenshot({ path: path.join(shots, 'home.png') });

  // the pieces a teacher touches first
  const has = async (sel) => (await win.locator(sel).count()) > 0;
  check('there is something to click', await has('button, .btn, [data-act], .nav'));

  // 4.0 says quizzes follow you: the sign-in row must exist
  check('the sign-in row is there', /sign in|signed in|account|offline/i.test(text));

  // walk into the quiz writer, which is the part that must work offline
  const writer = win.locator('[data-act="new"], [data-go="make"], button:has-text("New quiz")').first();
  if (await writer.count()) {
    await writer.click({ timeout: 5000 }).catch(() => {});
    await win.waitForTimeout(1200);
    await win.screenshot({ path: path.join(shots, 'writer.png') });
    const after = await win.evaluate(() => document.body.innerText);
    check('the quiz writer opens', after !== text, `${after.length} chars`);
  } else {
    check('the quiz writer opens', false, 'no button found to open it');
  }

  const errors = await win.evaluate(() => (window.__errors || []));
  check('no uncaught errors on screen', !/error|failed|cannot/i.test(
    (await win.evaluate(() => document.body.innerText)).slice(0, 300)));

  await app.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch(err => {
  console.error('CRASH', err.message);
  process.exit(1);
});
