/* Tallest Tower: three teams, one race up.
 *
 * Rebuilt from how Kahoot's actually works. Theirs: the room is split into
 * teams, you answer at your own pace to earn construction blocks, and you place
 * each one by timing a tap while it slides across — looking up at the host's
 * screen to see where your team's floor still needs filling. A floor is done
 * when every slot in the row has a block in it. There is a gift box at a height
 * and a monster that crushes a floor off whoever is winning.
 *
 * What was here instead: pick wide, tall or brace, and a number went up. No
 * tower was drawn anywhere, on any screen, so the mode was a quiz with the word
 * tower written on it.
 *
 * Two things live in this file, because they are two halves of one idea:
 *   board(opts)  the three towers, on the projector
 *   placer(opts) the drop, on the phone
 * They share the drawing of a block, so the thing you time on a phone and the
 * thing that lands on the board are the same object.
 */
(function (global) {
  'use strict';

  const TEAMS = ['red', 'blue', 'green'];
  const TEAM = {
    red:   { name: 'Crimson', face: '#F4364C', lit: '#FF7A88', dark: '#9E1526' },
    blue:  { name: 'Cobalt',  face: '#4F6BFF', lit: '#93A6FF', dark: '#2237A8' },
    green: { name: 'Clover',  face: '#12BE8E', lit: '#63E4BE', dark: '#0A7657' }
  };
  const SLOTS = 4;
  const INK = '#140E28';

  const now = () => performance.now();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const TAU = Math.PI * 2;

  /* One block. Drawn with a thick outline, a lit top face and a shaded right
     face, so a wall of them reads as masonry rather than as a bar chart. The
     bonus blocks a neat drop earns are marked with a star, because a child who
     did that deserves to see it every time they look up. */
  function drawBlock(ctx, x, y, w, h, team, block) {
    const T = TEAM[team] || TEAM.red;
    ctx.save();
    ctx.translate(x, y);
    const r = Math.min(w, h) * 0.22;
    ctx.fillStyle = block && block.gift ? '#FFC53D' : T.face;
    ctx.beginPath(); ctx.roundRect(-w / 2, -h, w, h, r); ctx.fill();
    // the lit top
    ctx.fillStyle = 'rgba(255,255,255,.34)';
    ctx.beginPath(); ctx.roundRect(-w / 2 + w * 0.08, -h + h * 0.1, w * 0.84, h * 0.3, r * 0.7);
    ctx.fill();
    // the shaded side
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.roundRect(w / 2 - w * 0.22, -h + h * 0.12, w * 0.16, h * 0.76, r * 0.5);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.4, w * 0.055);
    ctx.beginPath(); ctx.roundRect(-w / 2, -h, w, h, r); ctx.stroke();
    if (block && block.bonus) {
      ctx.fillStyle = '#FFE08A';
      star(ctx, 0, -h / 2, Math.min(w, h) * 0.24);
    }
    ctx.restore();
  }

  function star(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * TAU;
      const rr = i % 2 ? r * 0.45 : r;
      ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  }

  /* ── the board ────────────────────────────────────────────
   *
   * Three towers side by side, each built out of the blocks the team actually
   * placed, at the offsets they actually dropped them. A hurried drop is
   * crooked for the rest of the game, which is the difference between a tower
   * and a progress bar.
   */
  function board(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    let towers = opts.towers || {};
    let players = opts.players || [];
    let slots = opts.slots || SLOTS;
    let monster = 0, monsterTeam = '', shake = 0, gift = {};
    let raf = null, stopped = false;
    const faces = new Map();

    /* Canvas cannot draw an SVG string, so each blook is rasterised once into an
       offscreen canvas. The data URI needs an explicit xmlns: inline HTML infers
       the SVG namespace, a data URI does not, and without it it never loads. */
    function face(avatar) {
      const key = String(avatar || 0);
      if (faces.has(key)) return faces.get(key);
      const spot = { ready: false, canvas: null };
      faces.set(key, spot);
      try {
        const svg = global.Sprite.face(Number(avatar) || 0, 128)
          .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = 128; c.height = 128;
          c.getContext('2d').drawImage(img, 0, 0, 128, 128);
          spot.canvas = c; spot.ready = true;
        };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      } catch { /* no Sprite: the plain block tower still draws */ }
      return spot;
    }

    function fit() {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    const blocksOf = (t) => ((towers[t] && towers[t].blocks) || []);
    const floorsOf = (t) => Math.floor(blocksOf(t).length / slots);
    const tallest = () => Math.max(1, ...TEAMS.map(t => Math.ceil(blocksOf(t).length / slots)));

    function sky(t) {
      const w = canvas.width, h = canvas.height;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0B1030');
      g.addColorStop(0.55, '#1E2A6B');
      g.addColorStop(1, '#3A4FA8');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // clouds, drifting, so a tower that is not growing still feels alive
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      for (let i = 0; i < 6; i++) {
        const cx = ((t * 0.006 * (1 + i * 0.3) + i * 340) % (w + 400)) - 200;
        const cy = h * (0.10 + (i % 3) * 0.13);
        const cr = h * (0.05 + (i % 2) * 0.025);
        ctx.beginPath();
        ctx.ellipse(cx, cy, cr * 2.6, cr, 0, 0, TAU);
        ctx.ellipse(cx + cr * 1.4, cy - cr * 0.4, cr * 1.5, cr * 0.8, 0, 0, TAU);
        ctx.fill();
      }
    }

    function draw() {
      if (stopped) return;
      fit();
      const t = now();
      const w = canvas.width, h = canvas.height;

      ctx.save();
      if (t < shake) {
        const n = 14 * ((shake - t) / 500);
        ctx.translate((Math.random() - 0.5) * n, (Math.random() - 0.5) * n);
      }
      sky(t);

      const ground = h * 0.88;
      // the ground the towers stand on
      const gg = ctx.createLinearGradient(0, ground, 0, h);
      gg.addColorStop(0, '#5C4B36'); gg.addColorStop(1, '#3A2E20');
      ctx.fillStyle = gg; ctx.fillRect(0, ground, w, h - ground);
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2, h * 0.006);
      ctx.beginPath(); ctx.moveTo(0, ground); ctx.lineTo(w, ground); ctx.stroke();

      /* One floor's height is worked out from the tallest tower, so three
         towers always fit on the screen however high the room builds. */
      const top = tallest();
      const room = ground - h * 0.16;
      const floorH = clamp(room / Math.max(4, top + 1), h * 0.018, h * 0.075);
      const colW = w / 3;
      const blockW = Math.min(colW * 0.17, floorH * 1.5);

      TEAMS.forEach((team, i) => {
        const cx = colW * (i + 0.5);
        const list = blocksOf(team);
        const T = TEAM[team];

        // the plot it is built on
        ctx.fillStyle = 'rgba(0,0,0,.28)';
        ctx.beginPath();
        ctx.ellipse(cx, ground + h * 0.012, blockW * slots * 0.72, h * 0.012, 0, 0, TAU);
        ctx.fill();

        list.forEach((b, n) => {
          const floor = Math.floor(n / slots);
          const slot = n % slots;
          const o = (b && typeof b.o === 'number') ? b.o : 0;
          const x = cx + (slot - (slots - 1) / 2) * blockW * 1.04 + o * blockW * 0.5;
          const y = ground - floor * floorH;
          drawBlock(ctx, x, y, blockW, floorH * 0.94, team, b);
        });

        // the gift box, waiting at the next fifth floor
        const nextGift = ((towers[team] && towers[team].gift) || 0) + 1;
        const giftY = ground - nextGift * 5 * floorH;
        if (giftY > h * 0.1) {
          const bob = Math.sin(t / 420 + i) * floorH * 0.18;
          drawGift(cx + blockW * slots * 0.72, giftY + bob, Math.max(14, floorH * 1.1));
        }

        // the team's own blooks, stood on top of what they have built
        const mine = players.filter(p => p.team === team).slice(0, slots);
        mine.forEach((p, n) => {
          const x = cx + (n - (mine.length - 1) / 2) * blockW * 1.1;
          const y = ground - floorsOf(team) * floorH - floorH * 0.2;
          const size = Math.max(16, floorH * 1.5);
          const f = face(p.avatar);
          const hop = Math.abs(Math.sin(t / 340 + n * 1.3)) * size * 0.12;
          if (f && f.ready) ctx.drawImage(f.canvas, x - size / 2, y - size - hop, size, size);
          else {
            ctx.fillStyle = T.lit;
            ctx.beginPath(); ctx.arc(x, y - size / 2 - hop, size * 0.4, 0, TAU); ctx.fill();
          }
        });

        // the name plate and the floor count, at the foot of the tower
        const fs = Math.max(12, h * 0.036);
        ctx.font = `900 ${fs}px ui-sans-serif,system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = `${T.name} · ${floorsOf(team)}`;
        const tw = ctx.measureText(label).width + fs;
        ctx.fillStyle = T.face;
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(2, fs * 0.16);
        ctx.beginPath();
        ctx.roundRect(cx - tw / 2, ground + h * 0.03, tw, fs * 1.7, fs);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, cx, ground + h * 0.03 + fs * 0.88);
        ctx.textBaseline = 'alphabetic';

        // the row still being filled, marked out so a team can see where to aim
        const partial = list.length % slots;
        if (partial) {
          const y = ground - Math.floor(list.length / slots) * floorH;
          ctx.save();
          ctx.setLineDash([blockW * 0.18, blockW * 0.14]);
          ctx.strokeStyle = 'rgba(255,255,255,.55)';
          ctx.lineWidth = Math.max(1.5, blockW * 0.05);
          for (let sIdx = partial; sIdx < slots; sIdx++) {
            const x = cx + (sIdx - (slots - 1) / 2) * blockW * 1.04;
            ctx.beginPath();
            ctx.roundRect(x - blockW / 2, y - floorH * 0.94, blockW, floorH * 0.94, blockW * 0.2);
            ctx.stroke();
          }
          ctx.restore();
        }
      });

      if (t < monster) drawMonster(t, ground, floorH);
      ctx.restore();
      raf = requestAnimationFrame(draw);
    }

    function drawGift(x, y, size) {
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = '#FFC53D';
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.4, size * 0.09);
      ctx.beginPath(); ctx.roundRect(-size / 2, -size / 2, size, size, size * 0.18);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#E8467C';
      ctx.fillRect(-size * 0.09, -size / 2, size * 0.18, size);
      ctx.fillRect(-size / 2, -size * 0.09, size, size * 0.18);
      ctx.beginPath();
      ctx.arc(-size * 0.16, -size * 0.55, size * 0.16, 0, TAU);
      ctx.arc(size * 0.16, -size * 0.55, size * 0.16, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    /* The monster. It comes for whoever is winning, which is the only fair
       thing for it to do — a mode where the team that got ahead first stays
       ahead is a mode the other twenty children stop playing. */
    function drawMonster(t, ground, floorH) {
      const i = Math.max(0, TEAMS.indexOf(monsterTeam));
      const cx = (canvas.width / 3) * (i + 0.5);
      const a = 1 - (monster - t) / 1800;                 // nought to one
      const size = Math.max(40, floorH * 4.2);
      const y = ground - floorsOf(monsterTeam) * floorH - size * 0.2
              - Math.max(0, 1 - a * 2.2) * canvas.height * 0.4;
      ctx.save();
      ctx.translate(cx, y);
      // a fist of a thing: one big paw, two eyes, a mouthful of teeth
      ctx.fillStyle = '#6B3FA0';
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(2, size * 0.055);
      ctx.beginPath();
      ctx.roundRect(-size / 2, -size * 0.8, size, size * 0.8, size * 0.22);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4A2A72';
      [-0.26, 0.02, 0.3].forEach(dx => {
        ctx.beginPath();
        ctx.roundRect(size * dx - size * 0.1, -size * 0.06, size * 0.2, size * 0.22, size * 0.07);
        ctx.fill();
      });
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(-size * 0.16, -size * 0.5, size * 0.11, 0, TAU);
      ctx.arc(size * 0.16, -size * 0.5, size * 0.11, 0, TAU);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(-size * 0.16, -size * 0.48, size * 0.05, 0, TAU);
      ctx.arc(size * 0.16, -size * 0.48, size * 0.05, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    function update(next) {
      if (!next) return;
      if (next.towers) towers = next.towers;
      if (next.players) players = next.players;
      if (next.slots) slots = next.slots;
    }

    /** The monster is coming for this team: play it. */
    function smash(team) {
      monsterTeam = team || TEAMS[0];
      monster = now() + 1800;
      shake = now() + 500;
    }

    raf = requestAnimationFrame(draw);
    return { update, smash, stop() { stopped = true; if (raf) cancelAnimationFrame(raf); } };
  }

  /* ── the drop, on the phone ───────────────────────────────
   *
   * The block slides from one side to the other and you tap. Where it is when
   * you tap is where it lands, and that offset is kept and drawn on the board,
   * so this is the whole game rather than a progress bar with a button.
   *
   * It speeds up as the tower grows, because a mechanic that never gets harder
   * stops being a mechanic by question six.
   */
  function placer(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    const team = TEAM[opts.team] ? opts.team : 'red';
    let speed = opts.speed || 1;
    let running = true, dropped = null, raf = null;
    const born = now();

    function fit() {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    /** Where the block is now, −1 hard left to +1 hard right. */
    function at(t) {
      const period = 2200 / speed;
      const phase = ((t - born) % period) / period;
      return Math.sin(phase * TAU);          // a swing, so it is slowest at the edges
    }

    function draw() {
      if (!running) return;
      fit();
      const t = now();
      const w = canvas.width, h = canvas.height;
      const T = TEAM[team];

      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#141A3C'); g.addColorStop(1, '#0B0F26');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      const blockW = w * 0.2, blockH = h * 0.26;
      const restY = h * 0.82;

      // the slot you are aiming at, dead centre
      ctx.save();
      ctx.setLineDash([blockW * 0.16, blockW * 0.12]);
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = Math.max(2, w * 0.008);
      ctx.beginPath();
      ctx.roundRect(w / 2 - blockW / 2, restY - blockH, blockW, blockH, blockW * 0.2);
      ctx.stroke();
      ctx.restore();

      // the row already under it, so the tap has somewhere to land
      ctx.globalAlpha = 0.5;
      [-1.1, 1.1].forEach(k => drawBlock(ctx, w / 2 + k * blockW * 1.04, restY, blockW, blockH, team, null));
      ctx.globalAlpha = 1;

      // the block: sliding, or falling if it has been dropped
      const o = dropped === null ? at(t) : dropped.o;
      const x = w / 2 + o * (w * 0.36);
      let y = h * 0.26;
      if (dropped !== null) {
        const fall = clamp((t - dropped.at) / 260, 0, 1);
        y = h * 0.26 + (restY - h * 0.26) * (fall * fall);
      }
      drawBlock(ctx, x, y, blockW, blockH, team, null);

      // the guide line down from it, which is what makes the timing readable
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.lineWidth = Math.max(1, w * 0.004);
      ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, restY - blockH); ctx.stroke();
      ctx.setLineDash([]);

      raf = requestAnimationFrame(draw);
    }

    /** Tap. Returns where the block landed, −1 to +1, or null if it is gone. */
    function drop() {
      if (!running || dropped !== null) return null;
      const o = at(now());
      dropped = { o, at: now() };
      return o;
    }

    raf = requestAnimationFrame(draw);
    return {
      drop,
      /** How square the last drop was, nought to one. */
      get offset() { return dropped === null ? null : dropped.o; },
      setSpeed(n) { speed = Math.max(0.6, Math.min(2.6, n)); },
      stop() { running = false; if (raf) cancelAnimationFrame(raf); }
    };
  }

  global.NovaTower = { board, placer, TEAMS, TEAM, SLOTS, drawBlock };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaTower;
