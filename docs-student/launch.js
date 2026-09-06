/* The 3.0 update: when it opens, and the moment it does.
 *
 * Why a clock at all
 *   Everything in 3.0 is already built and already shipped to the site. Holding
 *   it back is not a technical limit but a decision: an update everybody meets at
 *   the same moment is an event, and a class that finds Tug of War half an hour
 *   before the teacher has heard of it is not.
 *
 * Which clock
 *   Midday in the reader's own time, not ours. A school in one time zone should
 *   not be told a school day's update lands in the middle of their night, and
 *   nothing here needs the network to agree with anybody — the phone in a hall
 *   with no wifi opens the new games at the same time as the board beside it.
 *
 * What is held back
 *   The new *content*: the three new games, and the levels and coins. Not the
 *   things that are improvements to what was already there — the settings screen,
 *   the arena, the music — because those are not a surprise to keep, and hiding a
 *   rewrite is how a rewrite gets shipped untested.
 */
(function (global) {
  'use strict';

  // 5 September 2026, midday, wherever the reader is
  const AT = new Date(2026, 8, 5, 12, 0, 0);

  const NEW_MODES = ['tug', 'heist', 'cards'];

  const NEW_THINGS = [
    { icon: 'rope',  tint: '#F4364C', title: 'Tug of War',
      line: 'Two teams, one rope, and it can come all the way back.' },
    { icon: 'coin',  tint: '#FFC53D', title: 'Gold Heist',
      line: 'Some chests rob the leader. Being in front is dangerous.' },
    { icon: 'cards', tint: '#4F6BFF', title: 'Card Collector',
      line: 'Win a card for every right answer. First to all eight.' },
    { icon: 'medal', tint: '#12BE8E', title: 'Levels and coins',
      line: 'Play to earn coins, and unlock monsters nobody else has.' }
  ];

  const now = () => Date.now();
  /** Is the update open yet? */
  const out = (at) => (at === undefined ? now() : at) >= AT.getTime();
  /** How long until it is, in milliseconds. Zero once it has landed. */
  const until = (at) => Math.max(0, AT.getTime() - (at === undefined ? now() : at));

  /* A game everybody can play today, or the same list with the new ones taken
     out. Given the whole list so the caller stays the source of truth. */
  function openModes(modes, at) {
    if (out(at)) return modes;
    return (modes || []).filter(m => !NEW_MODES.includes(m && m.id ? m.id : m));
  }

  const SEEN = 'quoldek:launched';
  /* A browser with storage switched off — private mode, a locked-down school
   * machine — cannot remember that it has seen this. So there is a flag in memory
   * as well, and nothing anywhere depends on the stored one having worked: the
   * worst case is a teacher who sees the rocket again tomorrow, not a page that
   * shows it for ever. */
  let flown = false;
  function seen() {
    if (flown) return true;
    try { return global.localStorage.getItem(SEEN) === '3.0'; } catch { return false; }
  }
  function markSeen() {
    flown = true;
    try { global.localStorage.setItem(SEEN, '3.0'); } catch { /* storage is off */ }
  }

  /* ── the launch ───────────────────────────────────────────
   * A rocket, drawn rather than downloaded, on a canvas over the whole page: it
   * lifts, it goes, it bursts, and the new things arrive on the sparks. Roughly
   * five seconds, skippable by touching it, and shown once per browser.
   */
  function rocket(opts) {
    const options = opts || {};
    const done = options.onDone || function () {};
    if (!global.document) return done();
    // never two at once, whatever calls this
    if (document.querySelector('.launch')) return done();

    const shell = document.createElement('div');
    shell.className = 'launch';
    shell.innerHTML = '<canvas class="launch-sky"></canvas>'
      + '<div class="launch-word"><span class="up">Quoldek 3.0</span></div>'
      + '<div class="launch-cards"></div>'
      + '<button class="launch-skip" type="button">Skip</button>';
    document.body.append(shell);

    const canvas = shell.querySelector('.launch-sky');
    const ctx = canvas.getContext('2d');
    const cards = shell.querySelector('.launch-cards');
    let raf = 0, started = performance.now(), sparks = [], burst = 0, over = false;

    const size = () => {
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
    };
    size();
    global.addEventListener('resize', size);

    const finish = () => {
      if (over) return;
      over = true;
      cancelAnimationFrame(raf);
      global.removeEventListener('resize', size);
      shell.classList.add('going');
      setTimeout(() => { shell.remove(); done(); }, 420);
    };
    shell.querySelector('.launch-skip').onclick = finish;
    shell.onclick = (e) => { if (e.target === shell) finish(); };

    const RISE = 1700;                 // how long the climb takes
    const HOLD = 2600;                 // how long the new things stay up

    function drawRocket(x, y, scale, wobble) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.rotate(wobble);

      // flame first, so the body sits on top of it
      const flame = 26 + Math.random() * 22;
      const g = ctx.createLinearGradient(0, 30, 0, 30 + flame);
      g.addColorStop(0, '#FFD86B');
      g.addColorStop(0.5, '#FF9A3D');
      g.addColorStop(1, 'rgba(244,54,76,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-13, 28); ctx.quadraticCurveTo(0, 30 + flame, 13, 28);
      ctx.closePath(); ctx.fill();

      ctx.fillStyle = '#F4364C';                       // fins
      ctx.beginPath();
      ctx.moveTo(-12, 10); ctx.lineTo(-26, 30); ctx.lineTo(-12, 28); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(12, 10); ctx.lineTo(26, 30); ctx.lineTo(12, 28); ctx.closePath(); ctx.fill();

      ctx.fillStyle = '#F6F2FF';                       // body
      ctx.beginPath();
      ctx.moveTo(0, -44);
      ctx.quadraticCurveTo(15, -16, 14, 28);
      ctx.lineTo(-14, 28);
      ctx.quadraticCurveTo(-15, -16, 0, -44);
      ctx.closePath(); ctx.fill();

      ctx.fillStyle = '#F4364C';                       // nose
      ctx.beginPath();
      ctx.moveTo(0, -44); ctx.quadraticCurveTo(9, -28, 8, -18);
      ctx.lineTo(-8, -18); ctx.quadraticCurveTo(-9, -28, 0, -44);
      ctx.closePath(); ctx.fill();

      ctx.fillStyle = '#2BA8FF';                       // window
      ctx.beginPath(); ctx.arc(0, -4, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.arc(-3, -7, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    function explode(x, y) {
      const colours = ['#FFC53D', '#F4364C', '#4F6BFF', '#12BE8E', '#7C4DFF', '#2BA8FF', '#FF7A45'];
      for (let i = 0; i < 190; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 13;
        sparks.push({
          x, y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed - 3,
          life: 1,
          fade: 0.006 + Math.random() * 0.012,
          size: 3 + Math.random() * 6,
          colour: colours[i % colours.length],
          spin: (Math.random() - 0.5) * 0.4,
          turn: Math.random() * Math.PI
        });
      }
    }

    function showCards() {
      cards.innerHTML = '';
      NEW_THINGS.forEach((thing, i) => {
        const card = document.createElement('div');
        card.className = 'launch-card';
        card.style.animationDelay = (i * 110) + 'ms';
        const art = global.Sprite ? global.Sprite.icon(thing.icon, 30, thing.tint) : '';
        card.innerHTML = `<span class="ic" style="background:${thing.tint}22">${art}</span>`
          + `<b>${thing.title}</b><span>${thing.line}</span>`;
        cards.append(card);
      });
      cards.classList.add('on');
    }

    function frame(t) {
      const gone = t - started;
      const dpr = canvas.width / innerWidth;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (gone < RISE) {
        // ease out, so it leaps off the pad and then coasts
        const k = gone / RISE;
        const eased = 1 - Math.pow(1 - k, 2.4);
        const y = innerHeight * 1.05 - eased * innerHeight * 0.72;
        const x = innerWidth / 2;
        drawRocket(x, y, Math.min(2.2, innerHeight / 420), Math.sin(gone / 90) * 0.05);
        // the trail it leaves behind
        for (let i = 0; i < 3; i++) {
          sparks.push({ x: x + (Math.random() - 0.5) * 14, y: y + 30,
                        vx: (Math.random() - 0.5) * 1.6, vy: 1 + Math.random() * 2,
                        life: 0.7, fade: 0.03, size: 2 + Math.random() * 4,
                        colour: Math.random() < 0.5 ? '#FFC53D' : '#FF7A45',
                        spin: 0, turn: 0 });
        }
      } else if (!burst) {
        burst = t;
        explode(innerWidth / 2, innerHeight * 0.33);
        shell.querySelector('.launch-word').classList.add('on');
        setTimeout(showCards, 420);
      }

      sparks = sparks.filter(s => s.life > 0);
      sparks.forEach(s => {
        s.x += s.vx; s.y += s.vy;
        s.vy += 0.16;                       // they fall
        s.vx *= 0.995;
        s.turn += s.spin;
        s.life -= s.fade;
        ctx.save();
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.translate(s.x, s.y);
        ctx.rotate(s.turn);
        ctx.fillStyle = s.colour;
        ctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size * 1.6);
        ctx.restore();
      });

      if (burst && t - burst > HOLD) return finish();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return finish;
  }

  global.NovaLaunch = { AT, NEW_MODES, NEW_THINGS, out, until, openModes, seen, markSeen, rocket };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaLaunch;
