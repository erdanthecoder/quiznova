/* Does the sword fight actually happen?
 *
 * A canvas game is the easiest kind of code to ship broken: it compiles, it
 * runs, it draws nothing, and nobody finds out until a class is watching. So
 * this runs the real engine in a real browser and checks the pixels, the
 * damage, and that the two thumbs do different things.
 */
const path = require('path');
const { chromium } = require('playwright');

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.join(__dirname, '..', '..');

let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };

const PAGE = `<!doctype html><body style="margin:0;background:#000">
<canvas id="c" style="width:900px;height:600px;display:block"></canvas>
<canvas id="t" style="width:500px;height:340px;display:block"></canvas>
<canvas id="b1" style="width:400px;height:300px;display:block"></canvas>
<canvas id="b2" style="width:400px;height:300px;display:block"></canvas>
<canvas id="b3" style="width:400px;height:300px;display:block"></canvas></body>`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const page = await browser.newPage({ viewport: { width: 950, height: 700 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setContent(PAGE);
  await page.addScriptTag({ path: path.join(ROOT, 'static/strike.js') });

  // ── it draws something ──
  await page.evaluate(() => {
    window.hits = [];
    window.ctl = NovaStrike.start({
      canvas: document.getElementById('c'),
      me: { id: 'me', name: 'Ana', avatar: 1 },
      blade: 'great', boss: { name: 'Boss', hp: 800, max: 800 }, seed: 12345,
      send: () => {}, onHit: (d, c) => window.hits.push({ d, c }),
      onDone: (out) => { window.done = out; }
    });
  });
  await page.waitForTimeout(600);

  const pixels = await page.evaluate(() => {
    const c = document.getElementById('c');
    const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0, distinct = new Set();
    for (let i = 0; i < g.length; i += 4 * 97) {
      if (g[i] + g[i+1] + g[i+2] > 30) lit++;
      distinct.add(`${g[i]>>4},${g[i+1]>>4},${g[i+2]>>4}`);
    }
    return { lit, total: Math.floor(g.length / (4 * 97)), colours: distinct.size };
  });
  ok('the fight draws something, not a black rectangle',
     pixels.lit > pixels.total * 0.5, `${pixels.lit}/${pixels.total} lit pixels`);
  ok('and it is a scene, not one flat colour', pixels.colours > 12, `${pixels.colours} distinct colours`);

  // ── swinging does damage, and the cooldown is real ──
  await page.evaluate(() => { window.ctl.swing(); });
  await page.waitForTimeout(60);
  let hits = await page.evaluate(() => window.hits.length);
  ok('a swing lands a hit', hits === 1, `${hits} hits`);

  await page.evaluate(() => { window.ctl.swing(); window.ctl.swing(); window.ctl.swing(); });
  hits = await page.evaluate(() => window.hits.length);
  ok('swinging again inside the cooldown does nothing', hits === 1, `${hits} hits after four taps`);

  await page.waitForTimeout(500);
  await page.evaluate(() => { window.ctl.swing(); });
  hits = await page.evaluate(() => window.hits.length);
  ok('and works again once the cooldown is up', hits === 2, `${hits} hits`);

  // ── the blade you carry matters ──
  const damage = await page.evaluate(() => {
    const run = (blade, id) => {
      const c = document.getElementById(id);
      let dealt = 0;
      const k = NovaStrike.start({ canvas: c, me: { id: 'x' }, blade,
        boss: { hp: 800, max: 800 }, seed: 1, send: () => {}, onHit: (d) => { dealt += d; } });
      k.swing(); k.stop();
      return dealt;
    };
    return { great: run('great', 'b1'), sword: run('sword', 'b2'), stick: run('stick', 'b3') };
  });
  ok('a greatsword hits harder than a sword, which beats a stick',
     damage.great > damage.sword && damage.sword > damage.stick,
     `great ${damage.great}, sword ${damage.sword}, stick ${damage.stick}`);

  // ── dodging is a separate thing that does not deal damage ──
  const before = await page.evaluate(() => window.hits.length);
  await page.evaluate(() => { window.ctl.dodge(); });
  await page.waitForTimeout(80);
  ok('dodging is not a swing', await page.evaluate(() => window.hits.length) === before,
     'no damage from a roll');

  // ── the boss really does wind up, twice, at the advertised times ──
  const wu = await page.evaluate(() => NovaStrike.WINDUPS);
  const roundMs = await page.evaluate(() => NovaStrike.ROUND_MS);
  ok('the boss winds up twice in a round', wu.length === 2, `at ${wu.join('ms and ')}ms`);
  ok('both wind-ups land inside the ten seconds, with room to react',
     wu.every(t => t > 1500 && t < roundMs - 1500), `round is ${roundMs}ms`);

  // ── the wind-up is visible before it lands, which is the whole mechanic ──
  const seen = await page.evaluate(async () => {
    // a canvas that is in the page and laid out: a detached one has no layout
    // box, fit() makes it a single pixel, and nothing is drawn at all
    const c = document.getElementById('t');
    const k = NovaStrike.start({ canvas: c, me: { id: 'w' }, blade: 'sword',
      boss: { hp: 800, max: 800 }, seed: 7, send: () => {} });
    /* Red over green, not red over everything: the warning is painted on a
     * purple floor, so the blue channel stays high and "r > b" never fires. */
    const redAt = () => {
      const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let red = 0;
      for (let i = 0; i < g.length; i += 4 * 13) {
        if (g[i] - g[i + 1] > 60) red++;
      }
      return red;
    };
    const quiet = redAt();
    // sample right through the wind-up window and keep the strongest reading:
    // one snapshot at a guessed millisecond is a flaky way to test an animation
    let warning = 0;
    const until = NovaStrike.WINDUPS[0] + 60;
    for (let t = 0; t < until; t += 150) {
      await new Promise(r => setTimeout(r, 150));
      const v = redAt();
      if (v > warning) warning = v;
    }
    k.stop();
    return { quiet, warning, size: [c.width, c.height] };
  });
  ok('the sweep is telegraphed in red before it lands',
     seen.warning > seen.quiet + 20,
     `${seen.quiet} red before, ${seen.warning} at its peak, canvas ${seen.size.join('x')}`);

  // ── it finishes by itself and reports what happened ──
  await page.waitForTimeout(10200);
  const done = await page.evaluate(() => window.done);
  ok('the round ends on its own after ten seconds', !!done, JSON.stringify(done));
  ok('and reports the damage it dealt', done && done.damage > 0, done && `${done.damage} damage, ${done.hits} hits`);

  /* The phone camera used to be placed in world coordinates while everything was
   * drawn in view coordinates, so whether the boss was in shot at all depended on
   * a random spawn angle. One canvas could pass forever; twenty cannot. */
  const angles = await page.evaluate(async () => {
    const results = [];
    for (let i = 0; i < 20; i++) {
      const c = document.createElement('canvas');
      c.style.cssText = 'width:320px;height:220px;display:block';
      document.body.append(c);
      const k = NovaStrike.start({ canvas: c, me: { id: 'a' + i }, blade: 'sword',
        boss: { hp: 800, max: 800 }, seed: 3, send: () => {} });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0, n = 0;
      for (let j = 0; j < g.length; j += 4 * 31) { n++; if (g[j] + g[j+1] + g[j+2] > 80) lit++; }
      results.push(Math.round(lit / n * 100));
      k.stop(); c.remove();
    }
    return results;
  });
  const blank = angles.filter(p => p < 25);
  ok('the boss is in shot from every spawn angle, not just the lucky ones',
     blank.length === 0, `${angles.length} phones, ${blank.length} looking at nothing`
                       + ` (lit %: ${angles.join(',')})`);

  ok('no errors while fighting', errs.length === 0, errs.slice(0, 2).join(' | '));

  await page.screenshot({ path: path.join(__dirname, 'shots', 'strike.png') }).catch(() => {});
  await browser.close();
  console.log(`\n${checks - fails}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.stack); process.exit(1); });
