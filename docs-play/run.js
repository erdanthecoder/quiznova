/* Monster Run: something is behind you and it does not get tired.
 *
 * The other modes ask a question, wait for thirty children, and then show what
 * happened. This one never waits. Every child is running their own race at
 * their own pace, answering their own questions, and the only clock that
 * matters is the one closing the gap behind them.
 *
 * The loop
 *   Answer right and you gain ground. Answer three right in a row and you
 *   SPRINT — a real one, the screen tears past and the monster is suddenly a
 *   long way back. Answer wrong and you stumble, and it is closer than it was.
 *   Get caught and you lose a chunk of ground, not the game: being out with
 *   four minutes left is a child who has stopped learning.
 *
 * Why the camera is behind the monster
 *   A runner filmed from behind the runner hides the only thing that matters.
 *   This camera sits behind the thing chasing you and looks past it, so the gap
 *   is the picture: when it closes, the monster fills the screen. Nobody needs
 *   a number to know they are in trouble.
 *
 * Levels
 *   Four sprints finishes a stretch. The ground drops away, you are carried to
 *   somewhere worse, and it starts again faster. Three stretches; the third is
 *   for the classes that get there.
 */
(function (global) {
  'use strict';

  const LANE = 260;                  // how wide the road is, in world units
  const RUN_AHEAD = 900;             // how far ahead of the monster you start
  const GAP_MAX = 1700, GAP_MIN = 90;
  const CATCH_LOSS = 420;            // ground lost when it reaches you
  const RIGHT_GAIN = 190;            // one right answer
  const WRONG_LOSS = 150;            // one wrong one
  const SPRINT_GAIN = 900;           // three right in a row
  const SPRINT_STREAK = 3;
  const BOOSTS_PER_LEVEL = 4;
  const MAX_LEVEL = 3;

  /* The monster gains on you steadily, and faster the deeper you are. A class
   * that is answering well should still feel it coming. */
  const CHASE = [0, 52, 74, 98];     // world units a second, by level

  const WORLDS = {
    sewer: { sky: ['#0A1418', '#122A2E'], road: ['#2A2E2C', '#121614'],
             wall: '#1B2422', mist: 'rgba(80,200,170,.10)', prop: 'pipe',
             tint: '#3AC0D8', name: 'The Sewers' },
    forest: { sky: ['#070E1C', '#16233F'], road: ['#2A2418', '#120F0A'],
              wall: '#101B14', mist: 'rgba(90,140,255,.10)', prop: 'tree',
              tint: '#7BC62D', name: 'Night Forest' },
    city: { sky: ['#160A14', '#37152A'], road: ['#2C2830', '#141118'],
            wall: '#1C1622', mist: 'rgba(255,120,90,.10)', prop: 'block',
            tint: '#FF7A45', name: 'Ruined City' }
  };

  const now = () => performance.now();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const TAU = Math.PI * 2;

  /**
   * start(options) → controller
   *   canvas   where to draw
   *   me       { id, name, avatar }
   *   world    'sewer' | 'forest' | 'city'
   *   level    1..3
   *   onLevel  (level) => void   a stretch is finished
   *   onState  ({ gap, distance, boosts, level, caught }) => void
   */
  function start(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    const world = WORLDS[opts.world] || WORLDS.sewer;

    const me = {
      distance: 0,          // how far this child has run, all levels
      gap: RUN_AHEAD,       // how far ahead of the monster
      streak: 0,            // right answers toward the next sprint
      boosts: 0,            // sprints used this stretch
      level: Math.max(1, Math.min(MAX_LEVEL, opts.level || 1)),
      caught: 0,            // when it last reached them
      sprintUntil: 0
    };

    let raf = null, stopped = false, last = now();
    let flying = 0;                         // the hand-off between stretches
    const puffs = [], lines = [];
    let shakeUntil = 0, banner = '', bannerUntil = 0;

    /* ── the road, in three dimensions ──
     * One vanishing point, the camera low and behind the monster. Everything is
     * placed by how far away it is and divided by that distance, which is all
     * perspective is. */
    const HORIZON = 0.40;                   // where the road meets the sky
    const CAM_BACK = 560;                   // the camera sits behind the monster
    const DROP = 0.54;                       // how far below the horizon the camera's feet land

    /* Distance to screen. The ground line falls away from the horizon as things
     * come closer and everything shrinks by the same factor, which is the whole
     * of perspective.
     *
     * This had it upside down: the far end of the road was drawn *below* the
     * near end, so the corridor turned inside out, the walls smeared across the
     * screen and the monster — which is nearest — filled it. A road has to
     * arrive at the horizon, not leave from it. */
    function put(z, x, h) {
      const d = z + CAM_BACK;
      if (d < 60) return null;
      const w = canvas.width, ht = canvas.height;
      const k = (ht * 0.95) / d;
      const ground = ht * HORIZON + ht * DROP * (CAM_BACK / d);
      return { x: w / 2 + x * k, y: ground - h * k, k };
    }

    function fit() {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    // ── what answering does ──
    function answered(right) {
      if (stopped || flying) return;
      if (right) {
        me.streak += 1;
        if (me.streak >= SPRINT_STREAK) {
          me.streak = 0;
          me.boosts += 1;
          me.gap = Math.min(GAP_MAX, me.gap + SPRINT_GAIN);
          me.distance += SPRINT_GAIN;
          me.sprintUntil = now() + 1400;
          shakeUntil = now() + 500;
          say('SPRINT');
          for (let i = 0; i < 26; i++) lines.push({ z: 200 + Math.random() * 1600,
            x: (Math.random() - 0.5) * LANE * 2.6, born: now() });
          if (me.boosts >= BOOSTS_PER_LEVEL) nextLevel();
        } else {
          me.gap = Math.min(GAP_MAX, me.gap + RIGHT_GAIN);
          me.distance += RIGHT_GAIN;
          say(SPRINT_STREAK - me.streak === 1 ? 'One more' : 'Go');
        }
      } else {
        me.streak = 0;
        me.gap = Math.max(GAP_MIN, me.gap - WRONG_LOSS);
        say('Stumble');
      }
      tell();
    }

    /* The hand-off. The ground goes, the child is carried somewhere worse, and
     * the next stretch starts with the monster further back but quicker. */
    function nextLevel() {
      if (me.level >= MAX_LEVEL) { say('YOU MADE IT OUT'); if (opts.onLevel) opts.onLevel(me.level, true); return; }
      flying = now();
      say('LEVEL ' + (me.level + 1));
      setTimeout(() => {
        me.level += 1;
        me.boosts = 0;
        me.gap = RUN_AHEAD;
        flying = 0;
        if (opts.onLevel) opts.onLevel(me.level, false);
        tell();
      }, 2200);
    }

    const say = (t) => { banner = t; bannerUntil = now() + 1300; };
    const tell = () => opts.onState && opts.onState({
      gap: Math.round(me.gap), distance: Math.round(me.distance),
      boosts: me.boosts, level: me.level, streak: me.streak,
      need: SPRINT_STREAK - me.streak, perLevel: BOOSTS_PER_LEVEL });

    // ── the world ──
    function drawRoad(t) {
      const w = canvas.width, h = canvas.height;
      // Ground first, across the whole canvas. Anything the road and the walls
      // did not cover was left transparent, and the page showed through as flat
      // blue bands lying across the middle of the world.
      ctx.fillStyle = world.road[1];
      ctx.fillRect(0, 0, w, h);
      const sky = ctx.createLinearGradient(0, 0, 0, h * HORIZON + 10);
      sky.addColorStop(0, world.sky[0]); sky.addColorStop(1, world.sky[1]);
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * HORIZON + 10);

      // the road: a quad from the horizon down to the camera
      const far = put(2400, 0, 0), near = put(0, 0, 0);
      const fl = put(2400, -LANE, 0), fr = put(2400, LANE, 0);
      const nl = put(0, -LANE, 0), nr = put(0, LANE, 0);
      if (fl && fr && nl && nr) {
        const g = ctx.createLinearGradient(0, fl.y, 0, nl.y);
        g.addColorStop(0, world.road[1]); g.addColorStop(1, world.road[0]);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(fl.x, fl.y); ctx.lineTo(fr.x, fr.y);
        ctx.lineTo(nr.x, nr.y); ctx.lineTo(nl.x, nl.y);
        ctx.closePath(); ctx.fill();

        // walls either side, so it is a corridor and not a field
        ctx.fillStyle = world.wall;
        ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(nl.x, nl.y);
        ctx.lineTo(0, h); ctx.lineTo(0, fl.y); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(fr.x, fr.y); ctx.lineTo(nr.x, nr.y);
        ctx.lineTo(w, h); ctx.lineTo(w, fr.y); ctx.closePath(); ctx.fill();
      }

      /* Stripes rushing past. They are what makes it a run rather than a
       * picture, so they move with the child's own speed. */
      const roll = (me.distance + (now() - last) * 0.12) % 220;
      for (let i = 0; i < 16; i++) {
        const z = i * 220 - roll + 60;
        const a = put(z, -12, 1), b = put(z + 90, 12, 1);
        if (!a || !b) continue;
        ctx.fillStyle = `rgba(255,255,255,${0.10 + 0.14 * Math.min(1, 700 / (z + 300))})`;
        ctx.fillRect(a.x, b.y, Math.max(1, b.x - a.x), Math.max(1, a.y - b.y));
      }

      // things going by at the edges, which is where the sense of speed lives
      for (let i = 0; i < 12; i++) {
        const z = ((i * 400 - roll * 2.1) % 4800 + 4800) % 4800;
        [-1, 1].forEach(side => {
          const base = put(z, side * (LANE + 60), 0);
          const top = put(z, side * (LANE + 60), world.prop === 'tree' ? 300 : 170);
          if (!base || !top) return;
          const wide = Math.max(2, 60 * base.k);
          ctx.fillStyle = world.wall;
          ctx.globalAlpha = 0.9;
          if (world.prop === 'tree') {
            ctx.fillRect(base.x - wide * 0.18, top.y, wide * 0.36, base.y - top.y);
            ctx.beginPath();
            ctx.moveTo(base.x, top.y - wide * 0.9);
            ctx.lineTo(base.x - wide * 0.8, top.y + wide * 0.5);
            ctx.lineTo(base.x + wide * 0.8, top.y + wide * 0.5);
            ctx.closePath(); ctx.fill();
          } else {
            ctx.fillRect(base.x - wide / 2, top.y, wide, base.y - top.y);
            ctx.fillStyle = world.tint;
            ctx.globalAlpha = 0.25;
            ctx.fillRect(base.x - wide / 2, top.y, wide, Math.max(1, 4 * base.k));
          }
          ctx.globalAlpha = 1;
        });
      }
      // a wash of colour over the whole thing, so each world feels its own
      ctx.fillStyle = world.mist;
      ctx.fillRect(0, 0, w, h);
    }

    /* The runner, seen from behind: shoulders, a head, and legs that actually
     * move. Small, because the point of the shot is what is behind them. */
    function drawRunner(t) {
      // Drawn at a compressed distance. At the true gap a sprinting child is
      // four pixels tall and the best moment in the game is invisible, so the
      // road is honest and the runner's distance is squashed to keep them
      // legible. The bar along the top is the number that tells the truth.
      const z = 160 + me.gap * 0.42;
      const foot = put(z, 0, 0), head = put(z, 0, 150);
      if (!foot || !head) return;
      const tall = Math.max(8, foot.y - head.y);
      const wide = tall * 0.46;
      const sprinting = now() < me.sprintUntil;
      const cycle = Math.sin(t / (sprinting ? 55 : 95));

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, wide * 0.7, wide * 0.22, 0, 0, TAU);
      ctx.fill();

      // legs
      ctx.strokeStyle = '#2A2140';
      ctx.lineWidth = Math.max(2, wide * 0.22);
      ctx.lineCap = 'round';
      [-1, 1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(foot.x + s * wide * 0.16, foot.y - tall * 0.42);
        ctx.lineTo(foot.x + s * wide * 0.16 + cycle * s * wide * 0.5, foot.y);
        ctx.stroke();
      });
      // body and head
      ctx.fillStyle = opts.colour || '#FFC53D';
      ctx.beginPath();
      ctx.roundRect(foot.x - wide / 2, foot.y - tall, wide, tall * 0.62, wide * 0.3);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(foot.x, foot.y - tall - wide * 0.24, wide * 0.36, 0, TAU);
      ctx.fill();
      if (sprinting) {
        ctx.strokeStyle = 'rgba(255,220,120,.85)';
        ctx.lineWidth = Math.max(1.5, wide * 0.12);
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(foot.x - wide * (0.8 + i * 0.4), foot.y - tall * (0.3 + i * 0.2));
          ctx.lineTo(foot.x - wide * (1.6 + i * 0.4), foot.y - tall * (0.3 + i * 0.2));
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    /* The monster. It is close to the camera by design, so when the gap closes
     * it stops being scenery and starts filling the screen. */
    function drawMonster(t) {
      const foot = put(0, 0, 0), head = put(0, 0, 175);
      if (!foot || !head) return;
      const tall = Math.max(30, foot.y - head.y);
      const wide = tall * 0.56;
      const near = clamp(1 - (me.gap - GAP_MIN) / (RUN_AHEAD * 1.4), 0, 1);
      const lurch = Math.sin(t / 120) * tall * 0.03;

      ctx.save();
      ctx.translate(0, lurch);
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, wide * 0.8, wide * 0.2, 0, 0, TAU);
      ctx.fill();

      const body = ctx.createLinearGradient(0, foot.y - tall, 0, foot.y);
      body.addColorStop(0, '#2A1430');
      body.addColorStop(1, '#0C060F');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(foot.x - wide * 0.52, foot.y);
      ctx.quadraticCurveTo(foot.x - wide * 0.72, foot.y - tall * 0.66, foot.x, foot.y - tall);
      ctx.quadraticCurveTo(foot.x + wide * 0.72, foot.y - tall * 0.66, foot.x + wide * 0.52, foot.y);
      ctx.closePath(); ctx.fill();

      // arms reaching, further out the closer it gets
      ctx.strokeStyle = '#1A0E20';
      ctx.lineWidth = Math.max(3, wide * 0.16);
      ctx.lineCap = 'round';
      [-1, 1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(foot.x + s * wide * 0.34, foot.y - tall * 0.62);
        ctx.quadraticCurveTo(foot.x + s * wide * (0.9 + near * 0.5), foot.y - tall * 0.5,
                             foot.x + s * wide * (0.6 + near * 0.6), foot.y - tall * (0.86 + near * 0.1));
        ctx.stroke();
      });

      // eyes, and they brighten as it gains
      const eyeY = foot.y - tall * 0.78, eyeR = Math.max(2, wide * 0.1);
      ctx.fillStyle = `rgba(255,${Math.round(60 - near * 40)},${Math.round(80 - near * 60)},1)`;
      [-0.22, 0.22].forEach(ex => {
        ctx.beginPath();
        ctx.ellipse(foot.x + ex * wide, eyeY, eyeR, eyeR * 1.25, 0, 0, TAU);
        ctx.fill();
      });
      if (near > 0.55) {
        ctx.fillStyle = `rgba(255,90,110,${(near - 0.55) * 0.7})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
    }

    function drawHud(t) {
      const w = canvas.width, h = canvas.height;
      ctx.save();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.max(14, h * 0.045)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.fillText(Math.round(me.distance) + ' m', w * 0.04, h * 0.085);
      ctx.textAlign = 'right';
      ctx.fillStyle = world.tint;
      ctx.fillText('Level ' + me.level, w * 0.96, h * 0.085);

      // the gap, as a bar, because a number is not a feeling
      const barW = w * 0.9, barX = w * 0.05, barY = h * 0.12;
      const frac = clamp((me.gap - GAP_MIN) / (GAP_MAX - GAP_MIN), 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(barX, barY, barW, Math.max(5, h * 0.016));
      ctx.fillStyle = frac < 0.22 ? '#F4364C' : frac < 0.5 ? '#FF9A3D' : '#12BE8E';
      ctx.fillRect(barX, barY, barW * frac, Math.max(5, h * 0.016));

      if (now() < bannerUntil) {
        ctx.textAlign = 'center';
        ctx.fillStyle = banner === 'Stumble' ? '#FF5A6E' : '#FFD86B';
        ctx.font = `900 ${Math.max(20, h * 0.085)}px ui-sans-serif,system-ui,sans-serif`;
        ctx.fillText(banner, w / 2, h * 0.30);
      }
      ctx.restore();
    }

    function frame() {
      if (stopped) return;
      const t = now();
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      fit();

      if (!flying) {
        // it never stops
        me.gap -= CHASE[me.level] * dt;
        if (me.gap <= GAP_MIN) {
          me.gap = RUN_AHEAD * 0.45;
          me.distance = Math.max(0, me.distance - CATCH_LOSS);
          me.streak = 0;
          me.caught = t;
          shakeUntil = t + 600;
          say('CAUGHT');
          tell();
        }
      }

      ctx.save();
      if (t < shakeUntil) {
        const n = 14 * ((shakeUntil - t) / 600);
        ctx.translate((Math.random() - 0.5) * n, (Math.random() - 0.5) * n);
      }
      drawRoad(t);
      drawRunner(t);
      drawMonster(t);
      ctx.restore();

      if (flying) {
        // the hand-off: white out, then back into somewhere worse
        const p = clamp((t - flying) / 2200, 0, 1);
        ctx.fillStyle = `rgba(255,255,255,${p < 0.5 ? p * 1.6 : (1 - p) * 1.6})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      drawHud(t);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    tell();

    return {
      answered,
      get state() { return { gap: me.gap, distance: me.distance, level: me.level,
                             boosts: me.boosts, streak: me.streak }; },
      stop() { stopped = true; if (raf) cancelAnimationFrame(raf); }
    };
  }

  global.NovaRun = { start, WORLDS, SPRINT_STREAK, BOOSTS_PER_LEVEL, MAX_LEVEL,
                     RIGHT_GAIN, SPRINT_GAIN, CHASE };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaRun;
