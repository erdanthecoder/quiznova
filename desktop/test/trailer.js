/* Film the trailer, and check it is actually drawing rather than sitting on a
   black screen — a thing that is about to go on a projector in front of a room
   is worth looking at first. */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { Server } = require('../server.js');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = path.join(__dirname, 'films');
const SIZE = { width: 1280, height: 720 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  const srv = new Server({ root: path.join(ROOT, 'static'),
                           dataDir: '/tmp/claude-0/trailerdata', port: 0 });
  const started = await srv.listen();
  const port = started && started.port ? started.port : started;
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const ctx = await browser.newContext({ viewport: SIZE,
    recordVideo: { dir: path.join(OUT, '_raw'), size: SIZE } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${base}/show.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('#go').click();

  /* Every scene gets looked at: a shot in the middle of it, and how much of
     the frame has anything on it. A scene that comes out black is a bug the
     room would find instead. */
  const cues = [[1800, 'open'], [4600, 'promise'], [8500, 'boss'], [13500, 'tower'],
                [18000, 'run'], [22500, 'laser'], [26500, 'more'], [31500, 'finale']];
  let at = 0;
  for (const [ms, name] of cues) {
    await sleep(ms - at); at = ms;
    const lit = await page.evaluate(() => {
      const c = document.getElementById('reel');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let on = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 53) { n++; if (d[i] + d[i + 1] + d[i + 2] > 60) on++; }
      return Math.round(on / n * 100);
    });
    console.log(`${name.padEnd(8)} ${String(lit).padStart(3)}% of the frame has something on it`);
    await page.screenshot({ path: path.join(__dirname, 'shots', `trailer-${name}.png`) });
  }
  await sleep(4500);
  console.log('errors:', errs.length ? errs.slice(0, 3).join(' | ') : 'none');

  const v = page.video();
  await ctx.close();
  if (v) await v.saveAs(path.join(OUT, 'quoldek-trailer.webm')).catch(() => {});
  await browser.close();
  fs.rmSync(path.join(OUT, '_raw'), { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
