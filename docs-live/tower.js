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
    let target = opts.target || 0;      // the height that wins it
    let drift = 0;                    // the board's clock against the game's
    /* Blocks used to appear. A block that appears is a number going up; a block
       that falls, lands, squashes and throws dust is a thing being built, and
       that is the whole difference between watching a tally and watching a
       race. `seen` is how many have landed per team, `air` is what is still
       coming down, and `puffs` is the dust it kicks up. */
    const FALL_MS = 420;
    const seen = { red: 0, blue: 0, green: 0 };
    const air = new Map();            // "team:index" -> { at, neat }
    let puffs = [];                   // { x, y, r, at, team }
    let notes = [];                   // the word that rises off a neat drop
    let lead = '', leadAt = 0;        // who is in front, and since when
    let started = false;              // the first paint places what is already up
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
      const top = Math.max(tallest(), target ? Math.min(target, tallest() + 4) : 0);
      const room = ground - h * 0.16;
      const floorH = clamp(room / Math.max(4, top + 1), h * 0.018, h * 0.092);
      const colW = w / 3;
      const blockW = Math.min(colW * 0.17, floorH * 1.5);

      /* How high they are, marked up the wall. Without it a tower of forty
         floors and a tower of twenty look the same once the scale shrinks to
         fit them both, and the class loses the one number the mode is about. */
      ctx.save();
      const rung = Math.max(5, Math.ceil(6 / Math.max(1, floorH / (h * 0.03))) * 5);
      const fsR = Math.max(9, h * 0.022);
      ctx.font = `800 ${fsR}px ui-sans-serif,system-ui,sans-serif`;
      ctx.textAlign = 'left';
      for (let f = rung; f <= top + rung; f += rung) {
        const y = ground - f * floorH;
        if (y < h * 0.06) break;
        ctx.strokeStyle = 'rgba(255,255,255,.10)';
        ctx.lineWidth = Math.max(1, h * 0.002);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.34)';
        ctx.fillText(String(f), w * 0.006, y - fsR * 0.28);
      }
      ctx.restore();

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

          /* Still coming down. It falls from above the screen, eases in, and
             squashes on the beat it lands — and the landing is where the dust
             comes from, so the eye is pulled to the top of the tower rather
             than to a number at the bottom. */
          const flying = air.get(team + ':' + n);
          let dy = 0, squash = 1;
          if (flying) {
            const p = (t - flying.at) / FALL_MS;
            if (p < 0) return;                       // not thrown yet
            if (p < 1) {
              const e = p * p;                       // gathering speed, the way a fall does
              dy = -(1 - e) * (y + floorH * 4);
              ctx.save();
              ctx.globalAlpha = clamp(p * 3, 0, 1);
            } else {
              air.delete(team + ':' + n);
              puffs.push({ x, y, r: blockW * 0.5, at: t, team });
              /* One word per team at a time. A team placing four blocks in a
                 burst was covering its own tower in text. */
              if (flying.neat && !notes.some(nn => nn.team === team && t - nn.at < 620)) {
                notes = notes.filter(nn => nn.team !== team);
                notes.push({ x, y, at: t, say: 'NEAT', team });
              }
            }
            const land = (t - flying.at - FALL_MS) / 150;
            if (land >= 0 && land < 1) squash = 1 - Math.sin(land * Math.PI) * 0.28;
          }
          drawBlock(ctx, x, y + dy, blockW, floorH * 0.94 * squash, team, b);
          if (flying && (t - flying.at) / FALL_MS < 1) ctx.restore();
        });

        // the gift box, waiting at the next fifth floor
        const nextGift = ((towers[team] && towers[team].gift) || 0) + 1;
        const giftY = ground - nextGift * 5 * floorH;
        if (giftY > h * 0.1) {
          const bob = Math.sin(t / 420 + i) * floorH * 0.18;
          drawGift(cx + blockW * slots * 0.72, giftY + bob, Math.max(14, floorH * 1.1));
        }

        /* The green column. When the gorilla takes a tower the other two are
           given a height to climb to; reaching it earns a shield, which is the
           only thing that gets rid of him. Kahoot draws it as a column, and a
           column is right: it is a distance, not a line. */
        const mark = (towers[team] && towers[team].mark) || 0;
        if (mark) {
          const from = ground - floorsOf(team) * floorH;
          const to = ground - mark * floorH;
          const colW = blockW * slots * 1.04;
          ctx.save();
          const col = ctx.createLinearGradient(0, from, 0, to);
          col.addColorStop(0, 'rgba(18,190,142,.06)');
          col.addColorStop(1, 'rgba(18,190,142,.34)');
          ctx.fillStyle = col;
          ctx.fillRect(cx - colW / 2, to, colW, from - to);
          ctx.setLineDash([10, 8]);
          ctx.lineDashOffset = -t / 26;
          ctx.strokeStyle = '#12BE8E';
          ctx.lineWidth = Math.max(2, floorH * 0.10);
          ctx.beginPath();
          ctx.moveTo(cx - colW / 2, to); ctx.lineTo(cx + colW / 2, to);
          ctx.stroke();
          ctx.setLineDash([]);
          const fs2 = Math.max(10, h * 0.026);
          ctx.font = `900 ${fs2}px ui-sans-serif,system-ui,sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = '#9CF0D3';
          ctx.fillText('BUILD TO HERE', cx, to - fs2 * 0.6);
          ctx.restore();
        }
        // a tower that is shielded says so, because it changes what happens next
        if (towers[team] && towers[team].shield) {
          const fs3 = Math.max(10, h * 0.026);
          ctx.save();
          ctx.font = `900 ${fs3}px ui-sans-serif,system-ui,sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = '#9CF0D3';
          ctx.fillText('SHIELDED', cx, ground - floorsOf(team) * floorH - floorH * 2.4);
          ctx.restore();
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

      /* The dust a landing throws up, and the word a neat drop earns. Both
         live for well under a second: long enough to catch, short enough that
         a room building fast is not covered in text. */
      puffs = puffs.filter(d => t - d.at < 480);
      puffs.forEach(d => {
        const a = 1 - (t - d.at) / 480;
        ctx.save();
        ctx.globalAlpha = a * 0.55;
        ctx.fillStyle = '#E9DCC6';
        for (let k = 0; k < 4; k++) {
          const dir = k < 2 ? -1 : 1;
          const push = (1 - a) * d.r * (2.2 + k * 0.4);
          ctx.beginPath();
          ctx.arc(d.x + dir * push, d.y - (1 - a) * d.r * 0.8,
                  d.r * (0.30 + (1 - a) * 0.45), 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      });

      notes = notes.filter(n => t - n.at < 900);
      notes.forEach(n => {
        const p = (t - n.at) / 900;
        const fs = Math.max(11, h * 0.030);
        ctx.save();
        ctx.globalAlpha = 1 - p * p;
        ctx.font = `900 ${fs}px ui-sans-serif,system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = Math.max(2, fs * 0.22);
        ctx.strokeStyle = INK;
        ctx.strokeText(n.say, n.x, n.y - floorH - p * h * 0.06);
        ctx.fillStyle = '#FFD23F';
        ctx.fillText(n.say, n.x, n.y - floorH - p * h * 0.06);
        ctx.restore();
      });

      /* The finish line. A race with no line on the floor is three teams
         stacking bricks for as long as a teacher lets them — the height that
         wins has to be somewhere a class can see it and count towards. */
      if (target && ground - target * floorH > h * 0.08) {
        const fy = ground - target * floorH;
        ctx.save();
        ctx.setLineDash([16, 12]);
        ctx.lineDashOffset = -t / 22;
        ctx.strokeStyle = '#FFC53D';
        ctx.lineWidth = Math.max(2, h * 0.007);
        ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(w, fy); ctx.stroke();
        ctx.setLineDash([]);
        const fs = Math.max(11, h * 0.032);
        ctx.font = `900 ${fs}px ui-sans-serif,system-ui,sans-serif`;
        ctx.textAlign = 'left';
        ctx.lineJoin = 'round';
        ctx.lineWidth = fs * 0.22;
        ctx.strokeStyle = '#1B1330';
        ctx.strokeText(target + ' FLOORS WINS', w * 0.012, fy - fs * 0.5);
        ctx.fillStyle = '#FFC53D';
        ctx.fillText(target + ' FLOORS WINS', w * 0.012, fy - fs * 0.5);
        ctx.restore();
      }

      /* Who is in front. Three towers of roughly the same height read as a
         draw from the back of a hall; a flag on top of one does not. It only
         flies on a clear lead, because a flag that flickers between two teams
         every few seconds tells the room nothing. */
      const heights = TEAMS.map(t2 => ({ t: t2, n: floorsOf(t2) }))
                           .sort((a, b) => b.n - a.n);
      const front = (heights[0].n > heights[1].n && heights[0].n > 0) ? heights[0].t : '';
      if (front !== lead) { lead = front; leadAt = t; }
      if (lead) {
        const i = TEAMS.indexOf(lead);
        const fx = colW * (i + 0.5);
        const fy = ground - floorsOf(lead) * floorH - floorH * 2.9;
        const fresh = clamp(1 - (t - leadAt) / 700, 0, 1);
        const size = Math.max(14, floorH * (1.1 + fresh * 0.7));
        ctx.save();
        ctx.translate(fx, fy + Math.sin(t / 380) * size * 0.12);
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1.6, size * 0.12);
        ctx.fillStyle = '#FFD23F';
        ctx.beginPath();                       // a crown, five points
        ctx.moveTo(-size * 0.62, size * 0.34);
        ctx.lineTo(-size * 0.72, -size * 0.40);
        ctx.lineTo(-size * 0.28, -size * 0.02);
        ctx.lineTo(0, -size * 0.52);
        ctx.lineTo(size * 0.28, -size * 0.02);
        ctx.lineTo(size * 0.72, -size * 0.40);
        ctx.lineTo(size * 0.62, size * 0.34);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }

      /* He arrives with the smash and then stays, because the tower he is
         sitting on cannot build while he is there — a cameo would leave the
         team frozen with nothing on screen to explain why. */
      const sitting = apeOn();
      if (t < monster || sitting) drawGorilla(t, ground, floorH, sitting || monsterTeam);
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

    /* The gorilla. He comes for whoever is winning, which is the only fair
       thing for him to do — a mode where the team that got ahead first stays
       ahead is a mode the other twenty children stop playing. He takes a floor
       and then sits on the tower, arms over the front of it, and while he is
       there that team can drop blocks but nothing lands.

       Drawn rather than borrowed: heavy shoulders, a low brow, long arms down
       the front of the tower, and a chest beat every second or so. */
    function drawGorilla(t, ground, floorH, team) {
      const i = Math.max(0, TEAMS.indexOf(team));
      const cx = (canvas.width / 3) * (i + 0.5);
      // big enough to be a threat, capped so he does not eat the whole board
      // now that the towers have been given the room they deserve
      const size = Math.max(40, Math.min(floorH * 3.4, canvas.height * 0.27));
      const climbing = Math.max(0, 1 - (t - (monster - 1800)) / 1400);
      /* He sits ON the tower he took. Perched a little way above it he read as
         a picture of a gorilla hung over the game rather than as something
         that had climbed up there and would not get off. */
      const y = ground - floorsOf(team) * floorH + size * 0.04
              - climbing * canvas.height * 0.45;
      const thump = Math.pow(Math.max(0, Math.sin(t / 620)), 8);   // the chest beat

      ctx.save();
      ctx.translate(cx, y);
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(2, size * 0.05);

      const fur = (px, py, pw, ph, fill, r) => {
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.roundRect(px, py, pw, ph, r); ctx.fill(); ctx.stroke();
      };

      // arms, out at the sides and down the front, gripping the top floor
      [-1, 1].forEach(sx => {
        ctx.save();
        ctx.translate(sx * size * 0.50, -size * 0.66);
        ctx.rotate(sx * (0.16 + thump * 0.55));
        fur(-size * 0.17, 0, size * 0.34, size * 0.80, '#3A2C33', size * 0.16);
        fur(-size * 0.20, size * 0.66, size * 0.40, size * 0.26, '#6B5560', size * 0.13);
        ctx.restore();
      });

      // the body: shoulders wider than the hips, the way an ape is built
      fur(-size * 0.44, -size * 0.80, size * 0.88, size * 0.80, '#40313A', size * 0.26);
      ctx.fillStyle = '#5B4854';
      ctx.beginPath();
      ctx.ellipse(0, -size * 0.32, size * 0.26 + thump * size * 0.03,
                  size * 0.21, 0, 0, TAU);
      ctx.fill(); ctx.stroke();

      /* The head. Big enough to read from the back of a classroom, with the
         face laid out the way a gorilla's is: ears on the sides, a heavy brow,
         eyes close together under it and a broad flat muzzle below. The first
         pass had a head the size of a fist and two dots on it. */
      ctx.save();
      ctx.translate(0, -size * 0.92);
      ctx.rotate(Math.sin(t / 900) * 0.05);
      // ears first, so the skull sits over them
      [-1, 1].forEach(sx => {
        ctx.fillStyle = '#5B4854';
        ctx.beginPath();
        ctx.arc(sx * size * 0.34, -size * 0.06, size * 0.10, 0, TAU);
        ctx.fill(); ctx.stroke();
      });
      fur(-size * 0.33, -size * 0.44, size * 0.66, size * 0.58, '#40313A', size * 0.24);
      // the crest down the top of the skull, which is what says gorilla
      ctx.fillStyle = '#2C2127';
      ctx.beginPath();
      ctx.ellipse(0, -size * 0.42, size * 0.15, size * 0.08, 0, 0, TAU);
      ctx.fill();
      // the face: a lighter plate holding the muzzle and the eyes
      ctx.fillStyle = '#6B5560';
      ctx.beginPath();
      ctx.ellipse(0, -size * 0.06, size * 0.26, size * 0.21, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
      // the brow, heavy, right over the eyes
      ctx.fillStyle = '#2C2127';
      ctx.beginPath();
      ctx.roundRect(-size * 0.28, -size * 0.26, size * 0.56, size * 0.09, size * 0.045);
      ctx.fill();
      // eyes under it, close together
      [-1, 1].forEach(sx => {
        ctx.fillStyle = '#FFF';
        ctx.beginPath();
        ctx.ellipse(sx * size * 0.10, -size * 0.13, size * 0.065, size * 0.055, 0, 0, TAU);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(sx * size * 0.10 + thump * size * 0.012, -size * 0.13, size * 0.030, 0, TAU);
        ctx.fill();
      });
      // the muzzle: nostrils and a wide mouth, open a little on the beat
      ctx.fillStyle = '#8A7280';
      ctx.beginPath();
      ctx.ellipse(0, size * 0.02, size * 0.17, size * 0.11, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK;
      [-1, 1].forEach(sx => {
        ctx.beginPath();
        ctx.ellipse(sx * size * 0.055, size * 0.0, size * 0.022, size * 0.028, 0, 0, TAU);
        ctx.fill();
      });
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(2, size * 0.035);
      ctx.beginPath();
      ctx.moveTo(-size * 0.10, size * 0.065);
      ctx.quadraticCurveTo(0, size * 0.065 + thump * size * 0.06, size * 0.10, size * 0.065);
      ctx.stroke();
      ctx.lineWidth = Math.max(2, size * 0.05);
      ctx.restore();
      ctx.restore();
    }

    function update(next) {
      if (!next) return;
      if (next.towers) {
        towers = next.towers;
        /* Whatever is already up when the board opens is standing, not falling:
           a class joining halfway through should not watch forty blocks rain. */
        TEAMS.forEach(team => {
          const n = ((towers[team] && towers[team].blocks) || []).length;
          if (!started) { seen[team] = n; return; }
          if (n > seen[team]) {
            const list = towers[team].blocks;
            for (let i = seen[team]; i < n; i++) {
              air.set(team + ':' + i, { at: now() + (i - seen[team]) * 90,
                                        neat: !!(list[i] && list[i].neat) });
            }
          }
          seen[team] = n;             // a crushed floor takes its blocks with it
        });
        started = true;
      }
      if (next.players) players = next.players;
      if (next.slots) slots = next.slots;
      if (typeof next.drift === 'number') drift = next.drift;
      if (typeof next.target === 'number') target = next.target;
    }

    /** Whose tower the gorilla is sitting on, if he is on one at all. */
    function apeOn() {
      const at = Date.now() - drift;
      return TEAMS.find(t => towers[t] && towers[t].apeUntil > at) || '';
    }

    /** The monster is coming for this team: play it. */
    function smash(team) {
      monsterTeam = team || TEAMS[0];
      monster = now() + 1800;
      shake = now() + 500;
    }

    raf = requestAnimationFrame(draw);
    return { update, smash, apeOn, stop() { stopped = true; if (raf) cancelAnimationFrame(raf); } };
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
