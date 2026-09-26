/* The trailer. Ninety seconds of Quoldek, for the front of a room.
 *
 * It is drawn rather than filmed, on one canvas, in scenes with hard cuts — a
 * trailer that dissolves politely between shots is a screensaver, and a room of
 * children will talk over a screensaver. Everything here is deliberately loud:
 * type that lands like a stamp, colour that changes on the beat, and something
 * moving in every single frame.
 *
 * It borrows nothing from the game engines on purpose. Those are built to be
 * played, which means they are built to be fair and readable over three
 * minutes; this has eight seconds a game and has to be unfair about it — bigger
 * boss, faster robot, taller tower. So the shapes are redrawn here, in the same
 * palette, at trailer scale.
 *
 *   NovaShow.play({ canvas, onDone })
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  /** Ease that starts fast and lands hard, which is what a stamp does. */
  const slam = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 4);
  /** Ease that overshoots and settles, for anything that should feel springy. */
  const pop = (t) => {
    const x = clamp(t, 0, 1);
    return x >= 1 ? 1 : 1 - Math.pow(2, -9 * x) * Math.cos(x * 22);
  };

  const INK = '#0B0720';
  const RED = '#F4364C', BLUE = '#4F6BFF', GREEN = '#12BE8E';
  const GOLD = '#FFC53D', CREAM = '#FFF3C4', VIOLET = '#8B5CF6';

  /* Faces are SVG strings from the sprite sheet; canvas cannot draw those, so
     each one is rasterised once and kept. The data URI needs the namespace
     spelled out or it never loads. */
  const faces = new Map();
  function face(n) {
    const key = String(n);
    if (faces.has(key)) return faces.get(key);
    const spot = { ready: false, canvas: null };
    faces.set(key, spot);
    try {
      const svg = global.Sprite.face(n, 160)
        .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 160; c.height = 160;
        c.getContext('2d').drawImage(img, 0, 0, 160, 160);
        spot.canvas = c; spot.ready = true;
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch { /* no sprite sheet here: a coloured disc stands in */ }
    return spot;
  }

  function play(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    let raf = null, stopped = false;
    const born = performance.now();

    function fit() {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    /* ── the tools every scene uses ─────────────────────── */
    let W = 0, H = 0, U = 1;              // width, height, and one "unit" (h/720)

    const fill = (style) => { ctx.fillStyle = style; ctx.fillRect(0, 0, W, H); };

    /** A vertical wash, because a flat background reads as an empty page. */
    function wash(top, bottom) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, top); g.addColorStop(1, bottom);
      fill(g);
    }

    /** Type, centred, with a heavy outline so it survives any background. */
    function stamp(text, y, size, colour, opt = {}) {
      ctx.save();
      ctx.font = `900 ${size}px ui-sans-serif,system-ui,-apple-system,sans-serif`;
      ctx.textAlign = opt.align || 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      if (opt.shadow) { ctx.shadowColor = opt.shadow; ctx.shadowBlur = size * 0.5; }
      ctx.lineWidth = size * (opt.weight || 0.17);
      ctx.strokeStyle = opt.ink || INK;
      ctx.strokeText(text, opt.x === undefined ? W / 2 : opt.x, y);
      ctx.shadowBlur = 0;
      ctx.fillStyle = colour;
      ctx.fillText(text, opt.x === undefined ? W / 2 : opt.x, y);
      ctx.restore();
    }

    /** A word that arrives: it flies in, overshoots, and sits. */
    function arrive(text, y, size, colour, t, opt = {}) {
      const k = pop(t / (opt.ms || 420));
      ctx.save();
      ctx.translate(W / 2, y);
      ctx.scale(0.4 + k * 0.6, 0.4 + k * 0.6);
      ctx.globalAlpha = clamp(t / 120, 0, 1);
      stamp(text, 0, size, colour, Object.assign({ x: 0 }, opt));
      ctx.restore();
    }

    /** The white flash that covers a cut. Two frames of it hides everything. */
    function flash(t, ms) {
      if (t > ms) return;
      ctx.save();
      ctx.globalAlpha = 1 - t / ms;
      fill('#FFFFFF');
      ctx.restore();
    }

    /** Bars top and bottom: the cheapest way to say "this is a film". */
    function letterbox(k) {
      const b = H * 0.055 * clamp(k, 0, 1);
      ctx.fillStyle = '#05030F';
      ctx.fillRect(0, 0, W, b);
      ctx.fillRect(0, H - b, W, b);
    }

    /** Streaks tearing across, for anything that should feel fast. */
    function speed(t, tint, n) {
      ctx.save();
      for (let i = 0; i < (n || 18); i++) {
        const seed = i * 977;
        const y = H * (0.05 + ((seed % 100) / 100) * 0.9);
        const x = W - (((t * (1.2 + (seed % 7) * 0.4)) + seed) % (W + 700));
        ctx.globalAlpha = 0.06 + (i % 4) * 0.05;
        ctx.strokeStyle = i % 4 ? '#FFFFFF' : tint;
        ctx.lineWidth = Math.max(1.5, U * (2 + (i % 3)));
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x + W * 0.09, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    /** Confetti, for the end, falling and turning. */
    const bits = [];
    function confetti(t, spawn) {
      if (spawn && bits.length < 220) {
        for (let i = 0; i < 6; i++) {
          bits.push({ x: Math.random() * W, y: -H * 0.1 - Math.random() * H * 0.4,
                      vy: H * (0.22 + Math.random() * 0.4), vx: (Math.random() - 0.5) * W * 0.06,
                      a: Math.random() * TAU, spin: (Math.random() - 0.5) * 7,
                      c: [RED, BLUE, GREEN, GOLD, VIOLET, CREAM][Math.floor(Math.random() * 6)],
                      w: U * (7 + Math.random() * 10) });
        }
      }
      const dt = 1 / 60;
      bits.forEach(b => {
        b.y += b.vy * dt; b.x += b.vx * dt; b.a += b.spin * dt;
        if (b.y > H + U * 30) { b.y = -U * 30; b.x = Math.random() * W; }
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.a);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.w * 0.3, b.w, b.w * 0.6);
        ctx.restore();
      });
    }

    /** A blook, drawn from the sheet or as a plain disc until it loads. */
    function blook(n, x, y, size, opt = {}) {
      const f = face(n);
      ctx.save();
      ctx.translate(x, y);
      if (opt.rot) ctx.rotate(opt.rot);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.ellipse(0, size * 0.52, size * 0.42, size * 0.13, 0, 0, TAU);
      ctx.fill();
      if (f && f.ready) ctx.drawImage(f.canvas, -size / 2, -size / 2, size, size);
      else {
        ctx.fillStyle = [RED, BLUE, GREEN, GOLD, VIOLET][n % 5];
        ctx.beginPath(); ctx.arc(0, 0, size * 0.4, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    /* ── the scenes ─────────────────────────────────────────
       Each takes the milliseconds since it began. They are hard cuts: a
       trailer that fades between shots is a screensaver. */

    /* 1. Cold open. Black, a pulse, and then the name lands hard enough to
          shut a room up. */
    function open(t) {
      fill('#05030F');
      // the pulse, coming up out of the dark before anything is readable
      const beat = Math.max(0, 1 - (t % 900) / 900);
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, H * (0.2 + beat * 0.9));
      g.addColorStop(0, `rgba(139,92,246,${0.42 * beat})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      fill(g);

      if (t > 1500) {
        const k = t - 1500;
        // the shockwave the name arrives on
        const r = slam(k / 700) * H * 1.3;
        ctx.save();
        ctx.globalAlpha = clamp(1 - k / 900, 0, 1) * 0.8;
        ctx.strokeStyle = VIOLET;
        ctx.lineWidth = U * 10 * clamp(1 - k / 700, 0, 1);
        ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, TAU); ctx.stroke();
        ctx.restore();
        arrive('QUOLDEK', H * 0.47, H * 0.20, CREAM, k,
               { shadow: VIOLET, weight: 0.13 });
        if (k > 500) {
          ctx.save();
          ctx.globalAlpha = clamp((k - 500) / 400, 0, 1);
          stamp('THE GAME YOUR CLASS IS ABOUT TO LOSE', H * 0.65, H * 0.045, GOLD);
          ctx.restore();
        }
      }
      letterbox((t - 1400) / 400);
      flash(t - 1500, 180);
    }

    /* 2. The promise. Four games, named, at speed. */
    function promise(t) {
      wash('#1A1140', '#0A0722');
      speed(t, VIOLET, 24);
      const names = ['BOSS BATTLE', 'TALLEST TOWER', 'ROBOT RUN', 'LASER TAG'];
      const tint = [RED, GREEN, BLUE, GOLD];
      arrive('FOUR GAMES', H * 0.24, H * 0.13, CREAM, t);
      names.forEach((n, i) => {
        const at = t - 450 - i * 240;
        if (at < 0) return;
        const k = pop(at / 420);
        ctx.save();
        ctx.globalAlpha = clamp(at / 140, 0, 1);
        ctx.translate(W * (0.5 - (1 - k) * (i % 2 ? 0.5 : -0.5)), H * (0.44 + i * 0.125));
        stamp(n, 0, H * 0.085, tint[i], { x: 0 });
        ctx.restore();
      });
      flash(t, 160);
    }

    /* 3. Boss Battle. A thing far too big for the screen, and the room going
          at it anyway. */
    function boss(t) {
      wash('#2A0E1C', '#08040F');
      // the hall it stands in
      ctx.save();
      const glow = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.05, W / 2, H * 0.55, H * 0.9);
      glow.addColorStop(0, 'rgba(244,54,76,.40)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      fill(glow);
      ctx.restore();

      const rise = slam(t / 900);
      const rage = clamp((t - 2200) / 2000, 0, 1);
      const shake = rage * U * 6;
      ctx.save();
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      /* Its skeleton runs from 0 at the feet to -790 at the horn tips, so the
         scale has to divide the frame by that, not by a guess: the first cut
         had the head a hundred pixels above the top of the screen and the room
         watching a pair of teeth. */
      ctx.translate(W / 2, H * (1.55 - rise * 0.71));
      const S = (H * 0.60) / 790;
      ctx.scale(S, S);
      // legs, body, arms: hard plates, because a machine is plates and a
      // monster is a blob, and this has to read as both
      const plate = (x, y, w2, h2, c, r) => {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.roundRect(x, y, w2, h2, r === undefined ? 14 : r);
        ctx.fill();
        ctx.strokeStyle = '#120A18'; ctx.lineWidth = 9; ctx.stroke();
      };
      plate(-150, -150, 120, 150, '#3A2740');
      plate(30, -150, 120, 150, '#3A2740');
      plate(-210, -430, 420, 290, '#4A3151', 40);
      const swing = Math.sin(t / 240) * (0.2 + rage * 0.6);
      [-1, 1].forEach(s => {
        ctx.save();
        ctx.translate(s * 215, -400);
        ctx.rotate(s * swing);
        plate(-55, -30, 110, 300, '#35233C', 44);
        ctx.restore();
      });
      // the chest furnace, which is where the eye goes
      const heat = 0.6 + Math.sin(t / 150) * 0.25 + rage * 0.5;
      ctx.save();
      const fur = ctx.createRadialGradient(0, -300, 4, 0, -300, 130);
      fur.addColorStop(0, `rgba(255,240,180,${clamp(heat, 0, 1)})`);
      fur.addColorStop(0.5, `rgba(255,120,40,${clamp(heat * 0.8, 0, 1)})`);
      fur.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = fur;
      ctx.beginPath(); ctx.arc(0, -300, 130, 0, TAU); ctx.fill();
      ctx.restore();
      // head, horns, and two eyes that go from red to gold as it loses
      plate(-150, -640, 300, 190, '#4A3151', 40);
      ctx.fillStyle = '#E8E2F0';
      [-1, 1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s * 70, -640); ctx.lineTo(s * 120, -790); ctx.lineTo(s * 150, -630);
        ctx.closePath(); ctx.fill();
      });
      const eye = rage > 0.6 ? '#FFE14D' : rage > 0.25 ? '#FF8A2F' : '#FF3B2F';
      ctx.fillStyle = eye;
      ctx.shadowColor = eye; ctx.shadowBlur = 40;
      [-1, 1].forEach(s => {
        ctx.beginPath(); ctx.arc(s * 66, -560, 30 + rage * 8, 0, TAU); ctx.fill();
      });
      ctx.shadowBlur = 0;
      // teeth, because a mouth of teeth is what makes it frightening at a glance
      ctx.fillStyle = '#FFF6E0';
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 36 - 15, -470); ctx.lineTo(i * 36, -420); ctx.lineTo(i * 36 + 15, -470);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      // the class, in front of it, tiny, and not backing off
      if (t > 900) {
        const k = clamp((t - 900) / 500, 0, 1);
        [0, 4, 9, 14, 21].forEach((n, i) => {
          const x = W * (0.16 + i * 0.17);
          const hop = Math.abs(Math.sin(t / 220 + i)) * H * 0.02;
          ctx.save();
          ctx.globalAlpha = k;
          blook(n, x, H * 0.84 - hop, H * 0.15);
          // the knife each of them is holding up
          ctx.translate(x + H * 0.07, H * 0.80 - hop);
          ctx.rotate(-0.6 + Math.sin(t / 180 + i) * 0.35);
          ctx.fillStyle = '#DDE8FF';
          ctx.strokeStyle = INK; ctx.lineWidth = U * 3;
          ctx.beginPath();
          ctx.roundRect(0, -U * 5, H * 0.13, U * 10, U * 5);
          ctx.fill(); ctx.stroke();
          ctx.restore();
        });
      }
      // the cuts landing on it
      if (t > 1600) {
        const n = Math.floor((t - 1600) / 420);
        for (let i = 0; i <= n && i < 9; i++) {
          const age = ((t - 1600) - i * 420) / 380;
          if (age < 0 || age > 1) continue;
          ctx.save();
          ctx.globalAlpha = 1 - age;
          ctx.strokeStyle = CREAM;
          ctx.shadowColor = GOLD; ctx.shadowBlur = 30;
          ctx.lineWidth = U * 9 * (1 - age);
          ctx.lineCap = 'round';
          const cy = H * (0.30 + (i % 3) * 0.14);
          ctx.beginPath();
          ctx.moveTo(W * 0.30, cy - H * 0.08);
          ctx.lineTo(W * 0.70, cy + H * 0.08);
          ctx.stroke();
          ctx.restore();
        }
      }
      if (t > 2600) {
        ctx.save();
        ctx.globalAlpha = clamp((t - 2600) / 300, 0, 1);
        stamp('AND IT HITS BACK', H * 0.135, H * 0.095, CREAM, { shadow: RED });
        ctx.restore();
      }
      letterbox(1);
      flash(t, 160);
    }

    /* 4. Tallest Tower. Blocks raining in, three towers climbing, and the
          gorilla who turns up for whoever is winning. */
    function tower(t) {
      wash('#12225E', '#050A22');
      // clouds going past, so the sky is not a flat wall
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      for (let i = 0; i < 6; i++) {
        const cx = ((t * 0.04 * (1 + i * 0.3) + i * 340) % (W + 500)) - 250;
        const cy = H * (0.10 + (i % 3) * 0.14);
        ctx.beginPath();
        ctx.ellipse(cx, cy, H * 0.14, H * 0.05, 0, 0, TAU);
        ctx.fill();
      }
      const ground = H * 0.88;
      ctx.fillStyle = '#4C3D2B';
      ctx.fillRect(0, ground, W, H - ground);

      const cols = [RED, BLUE, GREEN];
      const floors = [9, 12, 7];
      const bw = W * 0.045, bh = H * 0.052;
      cols.forEach((c, i) => {
        const cx = W * (0.22 + i * 0.28);
        const up = Math.floor(clamp((t - 200 - i * 120) / 150, 0, floors[i] * 4));
        for (let n = 0; n < up; n++) {
          const floor = Math.floor(n / 4), slot = n % 4;
          const x = cx + (slot - 1.5) * bw * 1.06 + Math.sin(n * 2.3) * bw * 0.12;
          const y = ground - floor * bh;
          // the last few are still falling, which is the whole point of it
          const age = (t - 200 - i * 120) - n * 150;
          const dy = age < 260 ? -(1 - Math.pow(age / 260, 2)) * H * 0.9 : 0;
          ctx.save();
          ctx.fillStyle = c;
          ctx.strokeStyle = 'rgba(8,6,20,.7)';
          ctx.lineWidth = U * 3;
          ctx.beginPath();
          ctx.roundRect(x - bw / 2, y - bh * 0.92 + dy, bw, bh * 0.92, bw * 0.16);
          ctx.fill(); ctx.stroke();
          // a lit top face, so a wall of them reads as masonry
          ctx.fillStyle = 'rgba(255,255,255,.22)';
          ctx.fillRect(x - bw / 2, y - bh * 0.92 + dy, bw, bh * 0.2);
          ctx.restore();
        }
        // the team's blook, stood on what it has built
        const top = ground - Math.floor(up / 4) * bh;
        blook(i * 7 + 2, cx, top - H * 0.05, H * 0.10);
      });

      // the gorilla, arriving for the tallest one
      if (t > 2600) {
        const k = slam((t - 2600) / 500);
        const cx = W * 0.50;
        const gy = ground - 12 * bh - H * 0.10 + (1 - k) * -H * 0.7;
        const size = H * 0.30;
        ctx.save();
        ctx.translate(cx, gy);
        const furr = (x, y, w2, h2, c, r) => {
          ctx.fillStyle = c; ctx.strokeStyle = '#1A1016'; ctx.lineWidth = U * 4;
          ctx.beginPath(); ctx.roundRect(x, y, w2, h2, r); ctx.fill(); ctx.stroke();
        };
        const thump = Math.pow(Math.max(0, Math.sin(t / 260)), 8);
        [-1, 1].forEach(s => {
          ctx.save();
          ctx.translate(s * size * 0.46, -size * 0.62);
          ctx.rotate(s * (0.2 + thump * 0.5));
          furr(-size * 0.15, 0, size * 0.30, size * 0.74, '#3A2C33', size * 0.15);
          ctx.restore();
        });
        furr(-size * 0.42, -size * 0.78, size * 0.84, size * 0.78, '#40313A', size * 0.26);
        furr(-size * 0.30, -size * 1.20, size * 0.60, size * 0.46, '#4C3B45', size * 0.20);
        ctx.fillStyle = '#1A1016';
        [-1, 1].forEach(s => {
          ctx.beginPath(); ctx.arc(s * size * 0.11, -size * 1.02, size * 0.05, 0, TAU); ctx.fill();
        });
        ctx.fillStyle = '#6B5560';
        ctx.beginPath();
        ctx.ellipse(0, -size * 0.86, size * 0.20, size * 0.13, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      if (t > 3000) {
        ctx.save();
        ctx.globalAlpha = clamp((t - 3000) / 300, 0, 1);
        stamp('HE COMES FOR WHOEVER IS WINNING', H * 0.14, H * 0.075, GREEN, { shadow: '#000' });
        ctx.restore();
      } else {
        arrive('BUILD HIGHER', H * 0.14, H * 0.10, CREAM, t);
      }
      letterbox(1);
      flash(t, 160);
    }

    /* 5. Robot Run. The one scene that is only about speed and being chased. */
    function run(t) {
      wash('#0C1A3A', '#04060F');
      const ground = H * 0.82;
      // the corridor going past, three layers at three speeds
      for (let layer = 0; layer < 3; layer++) {
        const span = H * (0.5 + layer * 0.35);
        const rate = 0.25 + layer * 0.55;
        ctx.fillStyle = ['rgba(255,255,255,.04)', 'rgba(255,255,255,.07)', 'rgba(6,4,16,.85)'][layer];
        for (let x = -((t * rate) % span); x < W + span; x += span) {
          if (layer === 2) {
            ctx.beginPath();
            ctx.moveTo(x, H); ctx.lineTo(x + H * 0.05, H * 0.55);
            ctx.lineTo(x + H * 0.13, H * 0.55); ctx.lineTo(x + H * 0.09, H);
            ctx.closePath(); ctx.fill();
          } else {
            ctx.fillRect(x, H * 0.12, span * 0.5, ground - H * 0.12);
          }
        }
      }
      ctx.fillStyle = '#26211A';
      ctx.fillRect(0, ground, W, H - ground);
      speed(t * 2.4, '#7FB6FF', 26);

      // the robot, closing the whole time
      const close = clamp(t / 4200, 0, 1);
      const rx = W * (-0.05 + close * 0.42);
      const stride = Math.sin(t / 110);
      ctx.save();
      ctx.translate(rx, ground - Math.abs(stride) * H * 0.012);
      const S = H * 0.0013;
      ctx.scale(S, S);
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath(); ctx.ellipse(0, 8, 170, 26, 0, 0, TAU); ctx.fill();
      const bolt = (x, y, w2, h2, c, r) => {
        ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(x, y, w2, h2, r === undefined ? 10 : r);
        ctx.fill(); ctx.strokeStyle = '#0A0812'; ctx.lineWidth = 8; ctx.stroke();
      };
      /* Legs hang from the hip UP the screen — canvas y grows downwards and the
         origin is the floor, so drawing them from 0 to +190 put its feet a
         hundred pixels underground. */
      [-1, 1].forEach(s => {
        ctx.save();
        ctx.translate(s * 60, -190);
        ctx.rotate(stride * s * 0.26);
        bolt(-38, 0, 76, 200, '#4A5468');
        ctx.restore();
      });
      // arms, swinging against the legs, because a machine with none is furniture
      [-1, 1].forEach(s => {
        ctx.save();
        ctx.translate(s * 165, -400);
        ctx.rotate(-stride * s * 0.5);
        bolt(-32, 0, 64, 230, '#414B5C', 26);
        ctx.restore();
      });
      bolt(-150, -420, 300, 250, '#5A6578', 26);
      bolt(-95, -505, 190, 95, '#3E4757', 22);
      ctx.fillStyle = '#FF3B2F';
      ctx.shadowColor = '#FF3B2F'; ctx.shadowBlur = 50;
      ctx.beginPath(); ctx.arc(0, -458, 34, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -300, 52, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();

      // the class, running, legs going, leaning into it
      [3, 8, 16, 19].forEach((n, i) => {
        const x = W * (0.70 + i * 0.075);
        const cycle = Math.sin(t / 60 + i * 1.6);
        const y = ground - H * 0.14 - Math.abs(cycle) * H * 0.022;
        ctx.save();
        ctx.strokeStyle = '#18122C';
        ctx.lineWidth = U * 7;
        ctx.lineCap = 'round';
        [-1, 1].forEach(s => {
          ctx.beginPath();
          ctx.moveTo(x, y + H * 0.05);
          ctx.quadraticCurveTo(x + cycle * s * H * 0.05, y + H * 0.10,
                               x + cycle * s * H * 0.07, ground);
          ctx.stroke();
        });
        ctx.restore();
        blook(n, x, y, H * 0.115, { rot: 0.14 });
      });

      // and the dread, as it gets close
      if (close > 0.45) {
        const d = (close - 0.45) / 0.55;
        const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H);
        edge.addColorStop(0, 'rgba(0,0,0,0)');
        edge.addColorStop(1, `rgba(158,8,26,${d * 0.75})`);
        fill(edge);
      }
      if (t > 2500) {
        const blink = 0.5 + Math.sin(t / 130) * 0.5;
        ctx.save();
        ctx.globalAlpha = 0.45 + blink * 0.55;
        stamp('ANSWER OR IT CATCHES YOU', H * 0.16, H * 0.09, '#FF6A78', { shadow: '#000' });
        ctx.restore();
      } else {
        arrive('DO NOT LOOK BACK', H * 0.16, H * 0.10, CREAM, t);
      }
      letterbox(1);
      flash(t, 160);
    }

    /* 6. Laser Tag. Seen from above, because that is how the game is seen, and
          the one rule worth putting on a screen: nobody is ever out. */
    function laser(t) {
      fill('#17140C');
      // the floor grid
      ctx.strokeStyle = 'rgba(255,255,255,.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += H * 0.07) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += H * 0.07) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      // cover, laid out to read as a map rather than as scattered boxes
      const walls = [[0.14, 0.22, 0.20, 0.05], [0.42, 0.14, 0.05, 0.26],
                     [0.62, 0.30, 0.22, 0.05], [0.20, 0.55, 0.05, 0.26],
                     [0.38, 0.68, 0.24, 0.05], [0.70, 0.56, 0.05, 0.24],
                     [0.50, 0.40, 0.14, 0.05]];
      walls.forEach(([x, y, w2, h2]) => {
        ctx.fillStyle = '#C8B78A';
        ctx.strokeStyle = '#6B5E3E'; ctx.lineWidth = U * 3;
        ctx.beginPath();
        ctx.roundRect(W * x, H * y, W * w2, H * h2, H * 0.02);
        ctx.fill(); ctx.stroke();
      });
      // the two sides' bases
      [[0.07, RED], [0.93, BLUE]].forEach(([x, c]) => {
        ctx.save();
        ctx.strokeStyle = c; ctx.lineWidth = U * 5;
        ctx.shadowColor = c; ctx.shadowBlur = 24;
        ctx.beginPath(); ctx.arc(W * x, H * 0.5, H * 0.09, 0, TAU); ctx.stroke();
        ctx.restore();
      });

      // players, moving, with bolts going between them
      const folk = [[0.26, 0.36, RED, 5], [0.34, 0.70, RED, 11], [0.66, 0.30, BLUE, 17],
                    [0.76, 0.66, BLUE, 23], [0.50, 0.55, RED, 2], [0.58, 0.20, BLUE, 8]];
      folk.forEach(([x, y, c, n], i) => {
        const dx = Math.sin(t / (700 + i * 90)) * 0.04;
        const dy = Math.cos(t / (800 + i * 70)) * 0.05;
        const px = W * (x + dx), py = H * (y + dy);
        ctx.save();
        ctx.strokeStyle = c; ctx.lineWidth = U * 4;
        ctx.beginPath(); ctx.arc(px, py, H * 0.055, 0, TAU); ctx.stroke();
        ctx.restore();
        blook(n, px, py, H * 0.085);
      });
      // bolts, crossing the middle
      for (let i = 0; i < 7; i++) {
        const k = ((t / 900) + i * 0.17) % 1;
        const from = i % 2 ? 0.28 : 0.72, to = i % 2 ? 0.74 : 0.26;
        const x = W * (from + (to - from) * k);
        const y = H * (0.25 + (i % 4) * 0.16);
        const c = i % 2 ? '#FF9484' : '#8FB4FF';
        ctx.save();
        ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 26;
        ctx.lineWidth = U * 7; ctx.lineCap = 'round';
        const dir = i % 2 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x - dir * W * 0.05, y);
        ctx.stroke();
        ctx.restore();
      }
      // somebody is tagged, answers, and comes back in a column of light
      if (t > 2000) {
        const k = ((t - 2000) % 1600) / 1600;
        const bx = W * 0.50, by = H * 0.74;
        ctx.save();
        ctx.globalAlpha = 1 - k;
        const col = ctx.createLinearGradient(0, by - H * 0.5, 0, by);
        col.addColorStop(0, 'rgba(255,255,255,0)');
        col.addColorStop(1, GREEN);
        ctx.fillStyle = col;
        ctx.fillRect(bx - H * 0.08 * (1 + k), by - H * 0.5, H * 0.16 * (1 + k), H * 0.5);
        ctx.restore();
      }
      if (t > 2300) {
        ctx.save();
        ctx.globalAlpha = clamp((t - 2300) / 300, 0, 1);
        stamp('NOBODY IS EVER OUT', H * 0.13, H * 0.095, GREEN, { shadow: '#000' });
        stamp('YOU ANSWER — YOU ARE BACK IN', H * 0.90, H * 0.055, CREAM, { shadow: '#000' });
        ctx.restore();
      } else {
        arrive('LASER TAG', H * 0.13, H * 0.10, GOLD, t);
      }
      letterbox(1);
      flash(t, 160);
    }

    /* 7. And the rest of it — the part that is not a game but is why the games
          have questions in them at all. */
    function more(t) {
      wash('#241155', '#0A0722');
      speed(t, GOLD, 20);
      arrive('AND MORE', H * 0.18, H * 0.11, CREAM, t);
      const lines = [
        ['WRITE A QUIZ IN A MINUTE', GOLD],
        ['OR ASK THE AI TO WRITE IT', VIOLET],
        ['SET IT AS HOMEWORK, MARKED FOR YOU', GREEN],
        ['TEAMS, STREAKS, DOUBLE POINTS', RED]
      ];
      lines.forEach(([text, c], i) => {
        const at = t - 500 - i * 300;
        if (at < 0) return;
        const k = pop(at / 400);
        ctx.save();
        ctx.globalAlpha = clamp(at / 150, 0, 1);
        ctx.translate(W / 2, H * (0.40 + i * 0.13));
        ctx.rotate((1 - k) * (i % 2 ? 0.14 : -0.14));
        stamp(text, 0, H * 0.062, c, { x: 0 });
        ctx.restore();
      });
      letterbox(1);
      flash(t, 160);
    }

    /* 8. The finale. Everybody on screen at once, confetti, the name, and the
          address a class types in. */
    function finale(t) {
      wash('#2B1566', '#0A0722');
      confetti(t, t < 3200);
      // the whole class arriving in a line across the bottom
      for (let i = 0; i < 11; i++) {
        const at = t - i * 70;
        if (at < 0) continue;
        const k = pop(at / 520);
        const x = W * (0.07 + i * 0.086);
        const hop = Math.abs(Math.sin(t / 200 + i * 0.8)) * H * 0.035;
        ctx.save();
        ctx.globalAlpha = clamp(at / 200, 0, 1);
        ctx.translate(0, (1 - k) * H * 0.5);
        blook(i * 5 + 1, x, H * 0.78 - hop, H * 0.15);
        ctx.restore();
      }
      if (t > 700) {
        arrive('QUOLDEK', H * 0.33, H * 0.20, CREAM, t - 700, { shadow: VIOLET, weight: 0.13 });
      }
      if (t > 1400) {
        ctx.save();
        ctx.globalAlpha = clamp((t - 1400) / 400, 0, 1);
        const beat = 1 + Math.sin(t / 220) * 0.03;
        ctx.translate(W / 2, H * 0.50);
        ctx.scale(beat, beat);
        stamp('PLAYQUOLDEK.WEB.APP', 0, H * 0.075, GOLD, { x: 0 });
        ctx.restore();
      }
      if (t > 2100) {
        const blink = 0.55 + Math.sin(t / 240) * 0.45;
        ctx.save();
        ctx.globalAlpha = blink;
        stamp("LET'S PLAY", H * 0.90, H * 0.055, CREAM, { shadow: '#000' });
        ctx.restore();
      }
      letterbox(1);
      flash(t, 200);
    }

    /* The running order. Lengths are in milliseconds and they are short on
       purpose: the longest anything sits here is five seconds. */
    const reel = [
      [open,    3600, 'open'],
      [promise, 2700, 'promise'],
      [boss,    5200, 'boss'],
      [tower,   5000, 'tower'],
      [run,     4800, 'run'],
      [laser,   4600, 'laser'],
      [more,    3400, 'more'],
      [finale,  6000, 'finale']
    ];
    const total = reel.reduce((n, s) => n + s[1], 0);
    let showing = '';

    function frame() {
      if (stopped) return;
      fit();
      W = canvas.width; H = canvas.height; U = H / 720;
      const t = performance.now() - born;

      let at = t;
      let scene = reel[reel.length - 1];
      for (const s of reel) {
        if (at < s[1]) { scene = s; break; }
        at -= s[1];
      }
      /* The page is told which shot is on, so the music can change with the
         picture rather than running underneath it like a radio. */
      if (scene[2] !== showing) {
        showing = scene[2];
        if (opts.onScene) opts.onScene(showing);
      }
      if (t >= total) {
        // hold the last frame rather than going black on a room
        scene = reel[reel.length - 1];
        at = reel[reel.length - 1][1] - 1;
        if (!stopped && opts.onDone) { opts.onDone(); opts.onDone = null; }
      }
      ctx.save();
      scene[0](at);
      ctx.restore();
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return {
      get length() { return total; },
      get at() { return performance.now() - born; },
      stop() { stopped = true; if (raf) cancelAnimationFrame(raf); }
    };
  }

  global.NovaShow = { play };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaShow;
