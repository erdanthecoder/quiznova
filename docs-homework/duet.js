/* The two marks, meeting.
 *
 * LearnKyrgyz teaches the words and Quoldek plays them, and as of this release
 * a lesson on one becomes a game on the other in a single press. That is worth
 * a moment on screen rather than a line in a changelog, and it is worth the
 * same moment on both sites — so this file is the same file in both, and it
 * depends on nothing either of them has.
 *
 * Give it a canvas. It draws Ilbirs the snow leopard coming in from one side
 * and the Quoldek mark from the other, they meet in the middle hard enough to
 * knock confetti out of the air, and a ribbon unrolls under them. It tells you
 * when it has finished, and it can be stopped at any point.
 *
 * Both marks are the real ones — the app icon and the mascot as they are drawn
 * everywhere else, not redrawn approximations. A logo that is nearly right is
 * worse than no logo, and these two belong to the same person anyway.
 */
(function (global) {
  'use strict';

  /* ── the marks ────────────────────────────────────────────
   * As SVG documents, because they go into an <img> to be drawn on a canvas and
   * an SVG in a data URI is a document on its own: inline the browser infers
   * the namespace, here it will not, and the image silently never loads. */

  const QUOLDEK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs><linearGradient id="qg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C4DFF"/><stop offset="1" stop-color="#2BA8FF"/></linearGradient>
<linearGradient id="qs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#E6E9FF"/></linearGradient></defs>
<rect x="3" y="3" width="90" height="90" rx="26" fill="url(#qg)" stroke="#0A0616" stroke-width="4"/>
<path d="M9 30a20 20 0 0 1 20-20h38a20 20 0 0 1 20 20v2c-20-10-58-10-78 4z" fill="#fff" opacity=".14"/>
<g fill="url(#qs)"><path fill-rule="evenodd" d="M45 9.25a33.75 33.75 0 1 1-.01 0z M45 25.75a17.25 17.25 0 1 0 .01 0z"/>
<rect x="55" y="52" width="14" height="30" rx="7" transform="rotate(-42 62 67)"/>
<path d="M39 34 l18.7 11 -18.7 11z"/></g></svg>`;

  /* Ilbirs, in the mood he is in when something good has happened. */
  const ILBIRS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<ellipse cx="60" cy="112" rx="34" ry="5" fill="rgba(0,0,0,.08)"/>
<path d="M24 42 q-9 -27 18 -19 z" fill="#eef2f6" stroke="#b9c3cf" stroke-width="2" stroke-linejoin="round"/>
<path d="M96 42 q9 -27 -18 -19 z" fill="#eef2f6" stroke="#b9c3cf" stroke-width="2" stroke-linejoin="round"/>
<path d="M28 37 q-3 -12 9 -10 z" fill="#ffb3c1"/><path d="M92 37 q3 -12 -9 -10 z" fill="#ffb3c1"/>
<ellipse cx="60" cy="66" rx="44" ry="41" fill="#eef2f6" stroke="#b9c3cf" stroke-width="2"/>
<g fill="#6b7480"><circle cx="24" cy="62" r="3"/><circle cx="96" cy="62" r="3"/><circle cx="28" cy="76" r="2.2"/><circle cx="92" cy="76" r="2.2"/><circle cx="31" cy="48" r="2.4"/><circle cx="89" cy="48" r="2.4"/></g>
<g fill="none" stroke="#6b7480" stroke-width="2.2"><path d="M24 70 a4 4 0 1 1 5 3"/><path d="M96 70 a4 4 0 1 0 -5 3"/></g>
<ellipse cx="60" cy="81" rx="20" ry="15" fill="#ffffff"/>
<path d="M36 60 q8 -9 16 0M68 60 q8 -9 16 0" fill="none" stroke="#3b3f46" stroke-width="3.2" stroke-linecap="round"/>
<path d="M55 70 h10 l-5 5 z" fill="#ff8fa3" stroke="#3b3f46" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M60 75 v3" stroke="#3b3f46" stroke-width="2"/>
<path d="M48 77 q12 16 24 0 z" fill="#c2415c" stroke="#3b3f46" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M54 85 q6 5 12 0" fill="#ff8fa3"/>
<g stroke="#b9c3cf" stroke-width="1.5" stroke-linecap="round"><path d="M38 76 l-14 -2M38 80 l-13 3M82 76 l14 -2M82 80 l13 3"/></g>
<circle cx="33" cy="71" r="5" fill="#ffc2cf" opacity=".65"/><circle cx="87" cy="71" r="5" fill="#ffc2cf" opacity=".65"/></svg>`;

  const GREEN = '#58cc02', PURPLE = '#7C4DFF';
  const CONFETTI = ['#58cc02', '#7C4DFF', '#2BA8FF', '#FFC53D', '#F4364C', '#12BE8E', '#FF7A45'];

  /* ── the timeline ─────────────────────────────────────────
   * Seven seconds, written out rather than buried in the drawing, because the
   * one thing a piece like this has to be is edited. */
  const T = {
    run:    350,     // both of them come in
    meet:   1550,    // and arrive
    bump:   1950,    // and hit each other
    cross:  2250,    // the × pops between them
    ribbon: 2600,    // the ribbon unrolls
    under:  3250,    // and says what this is
    out:    7200
  };

  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const ease = {
    out:  (t) => 1 - Math.pow(1 - t, 3),
    back: (t) => { const c = 2.2; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    soft: (t) => t * t * (3 - 2 * t)
  };
  const rand = (a, b) => a + Math.random() * (b - a);

  function load(svg) {
    const img = new global.Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return img;
  }

  /**
   * Play it.
   *   canvas   where to draw
   *   opts.dark    true on a dark page, so the ribbon and the words fit it
   *   opts.line    what it says under the ribbon
   *   opts.onDone  called once, when it is over or stopped
   * Returns a function that stops it early.
   */
  function play(canvas, opts) {
    const o = opts || {};
    const done = o.onDone || function () {};
    const ctx = canvas && canvas.getContext && canvas.getContext('2d');
    if (!ctx) { done(); return function () {}; }

    const cat = load(ILBIRS), mark = load(QUOLDEK);
    const dark = !!o.dark;
    const line = o.line || 'The first collaboration';
    let w = 0, h = 0, raf = 0, over = false;
    let bits = [], rings = [], popped = false;

    const size = () => {
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const box = canvas.getBoundingClientRect();
      w = Math.max(1, box.width || canvas.width);
      h = Math.max(1, box.height || canvas.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    global.addEventListener('resize', size);

    const finish = () => {
      if (over) return;
      over = true;
      global.cancelAnimationFrame(raf);
      global.removeEventListener('resize', size);
      done();
    };

    /* Confetti in both palettes, thrown out of the place where they met. Two
       colours would have been the polite version; a class does not want the
       polite version. */
    function burst(x, y) {
      for (let i = 0; i < 150; i++) {
        const a = rand(0, Math.PI * 2), speed = rand(2, 15);
        bits.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 4,
          life: 1, fade: rand(0.004, 0.011), size: rand(4, 10),
          colour: CONFETTI[i % CONFETTI.length], turn: rand(0, 6.28), spin: rand(-0.3, 0.3) });
      }
      rings.push({ x, y, born: 0, r: 10 });
    }

    /** A word with an outline, so it reads on a light page and a dark one. */
    function say(text, x, y, px, weight, fill) {
      ctx.font = `${weight} ${px}px 'Nunito', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, px * 0.16);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = dark ? 'rgba(10,6,22,.85)' : 'rgba(255,255,255,.9)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
    }

    /* The ribbon. It unrolls from the middle outwards, which is the only way a
       ribbon has ever looked right — one that fades in is a rectangle. */
    function ribbon(k, cx, cy, full, cap) {
      /* The ribbon's height is capped by the canvas as well as by its own
         width. Sized off the width alone it came out as tall as a third of a
         short strip, which pushed the line underneath it off the bottom — and
         a caption nobody can see is a caption that is not there. */
      const rw = full * ease.back(k);
      const rh = Math.max(28, Math.min(full * 0.15, cap));
      if (rw < 6) return 0;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.025);
      const g = ctx.createLinearGradient(-rw / 2, 0, rw / 2, 0);
      g.addColorStop(0, GREEN);
      g.addColorStop(1, PURPLE);
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.roundRect(-rw / 2 + 3, -rh / 2 + 6, rw, rh, rh / 2); ctx.fill();
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(-rw / 2, -rh / 2, rw, rh, rh / 2); ctx.fill();
      ctx.strokeStyle = '#1B1330';
      ctx.lineWidth = Math.max(2, rh * 0.07);
      ctx.beginPath(); ctx.roundRect(-rw / 2, -rh / 2, rw, rh, rh / 2); ctx.stroke();
      // the tails, which is what makes it a ribbon and not a pill
      ctx.fillStyle = PURPLE;
      ctx.beginPath();
      ctx.moveTo(rw / 2 - 2, -rh / 2); ctx.lineTo(rw / 2 + rh * 0.55, -rh * 0.86);
      ctx.lineTo(rw / 2 + rh * 0.3, 0); ctx.lineTo(rw / 2 + rh * 0.55, rh * 0.86);
      ctx.lineTo(rw / 2 - 2, rh / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = GREEN;
      ctx.beginPath();
      ctx.moveTo(-rw / 2 + 2, -rh / 2); ctx.lineTo(-rw / 2 - rh * 0.55, -rh * 0.86);
      ctx.lineTo(-rw / 2 - rh * 0.3, 0); ctx.lineTo(-rw / 2 - rh * 0.55, rh * 0.86);
      ctx.lineTo(-rw / 2 + 2, rh / 2); ctx.closePath(); ctx.fill();
      if (k > 0.55) {
        ctx.globalAlpha = clamp01((k - 0.55) / 0.35);
        ctx.font = `900 ${rh * 0.5}px 'Nunito', system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('LearnKyrgyz  ×  Quoldek', 0, 1);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return rh;
    }

    const started = (global.performance || Date).now();
    function tick(now) {
      if (over) return;
      const gone = now - started;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2, cy = h * 0.36;
      const put = Math.min(h * 0.34, w * 0.2);      // how big each mark is drawn
      const apart = put * 0.62;

      /* A glow under the meeting, in both colours, turned up at the moment they
         hit and fading after. */
      const heat = gone < T.bump ? clamp01((gone - T.run) / (T.bump - T.run)) * 0.5
                                 : 0.5 + 0.5 * Math.exp(-(gone - T.bump) / 700);
      const glow = ctx.createRadialGradient(cx, cy, put * 0.2, cx, cy, put * 3);
      glow.addColorStop(0, `rgba(124,77,255,${0.3 * heat})`);
      glow.addColorStop(0.5, `rgba(88,204,2,${0.16 * heat})`);
      glow.addColorStop(1, 'rgba(124,77,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      /* The run in. Both of them overshoot slightly and come back, because two
         things that arrive exactly on their marks look placed rather than
         thrown. */
      const k = clamp01((gone - T.run) / (T.meet - T.run));
      const e = ease.back(k);
      const hop = (phase) => Math.abs(Math.sin(gone / 150 + phase)) * (1 - k) * put * 0.22;

      // the shove they give each other on contact
      const knock = gone > T.bump ? Math.exp(-(gone - T.bump) / 220) * put * 0.2 : 0;
      const shake = gone > T.bump && gone < T.bump + 400
        ? Math.sin((gone - T.bump) / 22) * (1 - (gone - T.bump) / 400) * 6 : 0;

      const bobA = gone > T.bump ? Math.sin(gone / 360) * put * 0.035 : 0;
      const bobB = gone > T.bump ? Math.sin(gone / 360 + 2.1) * put * 0.035 : 0;

      const catX = -put + (cx - apart - (-put)) * e - knock + shake;
      const markX = w + put + (cx + apart - (w + put)) * e + knock - shake;

      if (!popped && gone >= T.bump) { popped = true; burst(cx, cy); }

      const draw = (img, x, y, s, turn) => {
        if (!img.complete || !img.naturalWidth) return;
        const ratio = img.naturalHeight / img.naturalWidth;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(turn);
        ctx.drawImage(img, -s / 2, -s * ratio / 2, s, s * ratio);
        ctx.restore();
      };

      /* Rings first, so the two of them stand in front of the shockwave. */
      rings = rings.filter(r => r.born < 1);
      rings.forEach(r => {
        r.born += 0.022; r.r += 16 * (1 - r.born);
        ctx.globalAlpha = (1 - r.born) * 0.7;
        ctx.strokeStyle = r.born < 0.5 ? '#FFFFFF' : PURPLE;
        ctx.lineWidth = 8 * (1 - r.born) + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
      });
      ctx.globalAlpha = 1;

      draw(cat, catX, cy - hop(0), put, (1 - k) * -0.9 + Math.sin(gone / 420) * 0.04);
      draw(mark, markX, cy - hop(1.6) + bobB - bobA * 0, put * 0.86,
           (1 - k) * 1.3 + Math.sin(gone / 420 + 2) * 0.04);

      /* The × between them, which is the whole claim this piece is making. */
      if (gone > T.cross) {
        const ck = clamp01((gone - T.cross) / 420);
        const s = put * 0.3 * ease.back(ck);
        ctx.save();
        ctx.translate(cx, cy + put * 0.06);
        ctx.rotate((1 - ck) * 1.4);
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(5, s * 0.26);
        ctx.strokeStyle = dark ? 'rgba(10,6,22,.55)' : 'rgba(255,255,255,.85)';
        ctx.beginPath();
        ctx.moveTo(-s / 2, -s / 2); ctx.lineTo(s / 2, s / 2);
        ctx.moveTo(s / 2, -s / 2); ctx.lineTo(-s / 2, s / 2);
        ctx.stroke();
        ctx.lineWidth = Math.max(3, s * 0.17);
        ctx.strokeStyle = '#FFC53D';
        ctx.beginPath();
        ctx.moveTo(-s / 2, -s / 2); ctx.lineTo(s / 2, s / 2);
        ctx.moveTo(s / 2, -s / 2); ctx.lineTo(-s / 2, s / 2);
        ctx.stroke();
        ctx.restore();
      }

      bits = bits.filter(b => b.life > 0);
      bits.forEach(b => {
        b.x += b.vx; b.y += b.vy;
        b.vy += 0.24; b.vx *= 0.993;
        b.turn += b.spin; b.life -= b.fade;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, b.life));
        ctx.translate(b.x, b.y);
        ctx.rotate(b.turn);
        ctx.fillStyle = b.colour;
        ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size * 1.5);
        ctx.restore();
      });
      ctx.globalAlpha = 1;

      let rh = 0;
      const words = Math.max(14, Math.min(24, w * 0.032));
      /* Laid out from the bottom up: the line has to fit, then the ribbon above
         it, and whatever is left is where the two of them meet. */
      const lineY = h - words * 0.9;
      const ribbonY = Math.min(cy + put * 0.86, lineY - words * 1.5 - h * 0.08);
      if (gone > T.ribbon) {
        const full = Math.min(w * 0.74, 560);
        rh = ribbon(clamp01((gone - T.ribbon) / 700), cx, ribbonY, full, h * 0.17);
      }
      if (gone > T.under) {
        ctx.globalAlpha = clamp01((gone - T.under) / 500);
        say(line, cx, lineY, words, '800', dark ? '#FFF7E4' : '#2B2050');
        ctx.globalAlpha = 1;
      }

      if (gone > T.out) return finish();
      raf = global.requestAnimationFrame(guard);
    }
    /* Anything that throws in there takes the animation away and leaves the page
       it was decorating alone. A celebration is never worth a broken screen. */
    const guard = (t) => { try { tick(t); } catch (err) { finish(); } };
    raf = global.requestAnimationFrame(guard);
    return finish;
  }

  global.NovaDuet = { play, MARKS: { QUOLDEK, ILBIRS }, T };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaDuet;
