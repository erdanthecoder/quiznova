/* Robot Run: the class gets off the deck together, or nobody does.
 *
 * The mistake worth recording: this was built first as a race. Every child ran
 * their own chase, sprinted on their own streak, and the board ranked them by
 * metres. That is a perfectly good game and it is not this one. Kahoot's Robot
 * Run — which is what was actually asked for — is collaborative: the room is
 * being chased by one robot, boosts are pooled, and the class clears the deck
 * together or loses a life together. Ranking children against each other was
 * the opposite of the point.
 *
 * The loop
 *   Answer at your own pace. Three right and a BOOST is charged; you then have
 *   to tap and hold to spend it, which is deliberate — it is a second small
 *   thing to do with your hands, and it means a boost is used when the child
 *   decides rather than automatically.
 *
 *   Every boost anybody spends fills the same bar. Fill it and the whole class
 *   is through to the next deck. Let the deck run out and the robot reaches the
 *   room and it costs everybody a life.
 *
 * Why the camera is behind the robot
 *   A runner filmed from behind the runner hides the only thing that matters.
 *   This camera sits behind the thing chasing and looks past it, so the gap is
 *   the picture: when the bar is low the robot fills the screen. Nobody needs a
 *   number to know the room is in trouble.
 */
(function (global) {
  'use strict';

  const LANE = 260;                  // how wide the road is, in world units
  const GAP_MAX = 1700, GAP_MIN = 120;   // an empty bar puts it on top of you
  const SPRINT_STREAK = 3;        // right answers that charge one boost
  const HOLD_MS = 550;            // how long the finger stays down to spend it


  const WORLDS = {
    station: { sky: ['#06101C', '#0E2038'], road: ['#2A3442', '#121820'],
               wall: '#16202C', mist: 'rgba(90,170,255,.09)', prop: 'strut',
               tint: '#2BA8FF', name: 'The Space Station' },
    reactor: { sky: ['#1A0A10', '#3A1420'], road: ['#32262A', '#161014'],
               wall: '#241A20', mist: 'rgba(255,120,90,.10)', prop: 'pipe',
               tint: '#FF7A45', name: 'Reactor Deck' },
    hangar:  { sky: ['#0A1410', '#14301F'], road: ['#2A3230', '#141A18'],
               wall: '#18241E', mist: 'rgba(90,255,170,.08)', prop: 'crate',
               tint: '#12BE8E', name: 'The Hangar' }
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
      streak: 0,            // right answers toward the next boost
      charged: 0,           // boosts earned and not yet spent
      spent: 0,             // and spent, which is what gets reported
      holdFrom: 0,          // when the finger went down on the boost
      boosting: 0           // and when the boost itself is playing out
    };
    // the room's, handed in from the game and refreshed as it changes
    let room = { escape: 0, target: 100, lives: 3, round: 1 };

    let raf = null, stopped = false, last = now();
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
    let lastToken = null;
    /* The gap is read from the room's escape bar rather than kept here. Every
     * child sees the same robot in the same place, because it is chasing all of
     * them — that is the difference between this and a race. */
    const gapNow = () => GAP_MIN + (GAP_MAX - GAP_MIN) *
      Math.max(0, Math.min(1, (room.escape || 0) / Math.max(1, room.target)));

    /* answered(right, token)
     *
     * The token says which question this was. One answer per question counts,
     * however many times the button is hit — a child on a phone double-taps
     * constantly: an impatient thumb, a slow screen, a button that redraws
     * under them, and every one of those taps used to be another sprint.
     *
     * It is keyed on the question rather than on a stopwatch on purpose. A time
     * limit would also throttle a child who is genuinely quick, and being quick
     * is the thing this mode is for. */
    function answered(right, token) {
      if (stopped) return;
      if (token !== undefined && token !== null) {
        if (token === lastToken) return;
        lastToken = token;
      }
      if (right) {
        me.streak += 1;
        if (me.streak >= SPRINT_STREAK) {
          me.streak = 0;
          me.charged += 1;
          say('BOOST READY');
        } else {
          say(SPRINT_STREAK - me.streak === 1 ? 'One more' : 'Go');
        }
      } else {
        me.streak = 0;
        say('Wrong');
      }
      tell();
    }

    /* Spending a boost is its own act: charged by answering, then held down.
     *
     * It would be easier to fire it the moment the third answer lands, and much
     * worse — the child would never feel they did it. Holding is a second small
     * thing to do with the hands, at a moment of their choosing, and it is the
     * only part of this mode that is not reading. */
    function holdStart() {
      if (stopped || me.charged <= 0 || me.holdFrom || me.boosting) return false;
      me.holdFrom = now();
      return true;
    }
    function holdEnd() {
      if (!me.holdFrom) return false;
      const held = now() - me.holdFrom;
      me.holdFrom = 0;
      if (held < HOLD_MS) { say('Hold it down'); return false; }
      me.charged -= 1;
      me.spent += 1;
      me.boosting = now();
      shakeUntil = now() + 520;
      say('BOOST');
      for (let i = 0; i < 30; i++) lines.push({ z: 200 + Math.random() * 1700,
        x: (Math.random() - 0.5) * LANE * 2.6, born: now() });
      if (opts.onBoost) opts.onBoost(me.spent);
      tell();
      return true;
    }
    /** How far through the hold the finger is, 0 to 1, for the ring on screen. */
    const holdAt = () => me.holdFrom ? Math.min(1, (now() - me.holdFrom) / HOLD_MS) : 0;

    /** The room's state, refreshed from the game. */
    function setRoom(next) { room = Object.assign(room, next || {}); }

    const say = (t) => { banner = t; bannerUntil = now() + 1300; };
    const tell = () => opts.onState && opts.onState({
      charged: me.charged, spent: me.spent, streak: me.streak,
      need: SPRINT_STREAK - me.streak,
      escape: room.escape, target: room.target, lives: room.lives, round: room.round });

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
      const roll = (t * 0.16 + (me.boosting ? (t - me.boosting) * 0.6 : 0)) % 220;
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
      const z = 160 + gapNow() * 0.42;
      const foot = put(z, 0, 0), head = put(z, 0, 150);
      if (!foot || !head) return;
      const tall = Math.max(8, foot.y - head.y);
      const wide = tall * 0.46;
      const sprinting = !!me.boosting;
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

    /* The robot. Close to the camera by design, so when the room's escape bar is
     * low it stops being scenery and fills the screen.
     *
     * Built out of hard shapes rather than a silhouette: a boxy chassis, a
     * plated head, a single scanning eye and two piston arms. A monster is a
     * blob with eyes; a machine has edges, and edges are what make it read as
     * a machine at a glance on a projector. */
    function drawRobot(t) {
      const foot = put(0, 0, 0), head = put(0, 0, 175);
      if (!foot || !head) return;
      const tall = Math.max(30, foot.y - head.y);
      const wide = tall * 0.56;
      const near = clamp(1 - (gapNow() - GAP_MIN) / (GAP_MAX - GAP_MIN), 0, 1);
      const stomp = Math.sin(t / 150);

      ctx.save();
      ctx.translate(0, stomp * tall * 0.02);
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, wide * 0.82, wide * 0.2, 0, 0, TAU);
      ctx.fill();

      // legs: two pistons, out of step
      ctx.strokeStyle = '#2E3440';
      ctx.lineWidth = Math.max(4, wide * 0.2);
      ctx.lineCap = 'butt';
      [-1, 1].forEach((sgn, i2) => {
        const swing = Math.sin(t / 150 + i2 * Math.PI) * wide * 0.16;
        ctx.beginPath();
        ctx.moveTo(foot.x + sgn * wide * 0.26, foot.y - tall * 0.42);
        ctx.lineTo(foot.x + sgn * wide * 0.26 + swing, foot.y);
        ctx.stroke();
      });

      // chassis
      const body = ctx.createLinearGradient(0, foot.y - tall, 0, foot.y);
      body.addColorStop(0, '#59636F');
      body.addColorStop(0.5, '#3A424E');
      body.addColorStop(1, '#222831');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(foot.x - wide * 0.5, foot.y - tall * 0.86, wide, tall * 0.5, wide * 0.1);
      ctx.fill();
      // shoulder plates
      ctx.fillStyle = '#4A535F';
      [-1, 1].forEach(sgn => {
        ctx.beginPath();
        ctx.roundRect(foot.x + sgn * wide * 0.5 - (sgn > 0 ? 0 : wide * 0.26),
                      foot.y - tall * 0.84, wide * 0.26, tall * 0.18, wide * 0.06);
        ctx.fill();
      });
      // vents down the chest, lit from inside
      ctx.fillStyle = `rgba(255,${Math.round(140 - near * 110)},60,${0.5 + near * 0.5})`;
      for (let v = 0; v < 3; v++) {
        ctx.fillRect(foot.x - wide * 0.22, foot.y - tall * (0.74 - v * 0.11),
                     wide * 0.44, Math.max(1, tall * 0.035));
      }

      // head: a plated box with one scanning eye
      ctx.fillStyle = '#6A737F';
      ctx.beginPath();
      ctx.roundRect(foot.x - wide * 0.32, foot.y - tall, wide * 0.64, tall * 0.2, wide * 0.08);
      ctx.fill();
      const eyeX = foot.x + Math.sin(t / 420) * wide * 0.14;
      const eyeR = Math.max(2, wide * 0.1);
      ctx.fillStyle = near > 0.5 ? '#FF3B4E' : '#FF8A3D';
      ctx.beginPath();
      ctx.ellipse(eyeX, foot.y - tall * 0.9, eyeR * 1.5, eyeR, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(eyeX, foot.y - tall * 0.9, eyeR * 0.5, eyeR * 0.36, 0, 0, TAU);
      ctx.fill();
      // the beam it sweeps down the deck
      ctx.fillStyle = `rgba(255,90,60,${0.05 + near * 0.12})`;
      ctx.beginPath();
      ctx.moveTo(eyeX, foot.y - tall * 0.9);
      ctx.lineTo(foot.x - wide * 1.6, foot.y - tall * 1.9);
      ctx.lineTo(foot.x + wide * 1.6, foot.y - tall * 1.9);
      ctx.closePath();
      ctx.fill();

      // arms: pistons that reach further the closer the room is to losing
      ctx.strokeStyle = '#39414D';
      ctx.lineWidth = Math.max(3, wide * 0.15);
      ctx.lineCap = 'round';
      [-1, 1].forEach(sgn => {
        ctx.beginPath();
        ctx.moveTo(foot.x + sgn * wide * 0.5, foot.y - tall * 0.74);
        ctx.quadraticCurveTo(foot.x + sgn * wide * (1.0 + near * 0.5), foot.y - tall * 0.6,
                             foot.x + sgn * wide * (0.7 + near * 0.6), foot.y - tall * (0.9 + near * 0.12));
        ctx.stroke();
      });

      if (near > 0.55) {
        ctx.fillStyle = `rgba(255,60,70,${(near - 0.55) * 0.75})`;
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
      // the room's lives, and which deck it is on — both shared, both the point
      ctx.fillText('Deck ' + (room.round || 1), w * 0.04, h * 0.085);
      ctx.textAlign = 'right';
      ctx.fillStyle = (room.lives || 0) > 1 ? world.tint : '#FF5A6E';
      ctx.fillText('♥ '.repeat(Math.max(0, room.lives || 0)).trim() || 'last chance',
                   w * 0.96, h * 0.085);

      // the gap, as a bar, because a number is not a feeling
      const barW = w * 0.9, barX = w * 0.05, barY = h * 0.12;
      // the shared escape: everybody's boosts, in one bar
      const frac = clamp((room.escape || 0) / Math.max(1, room.target || 100), 0, 1);
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

      if (me.boosting && t - me.boosting > 1500) me.boosting = 0;

      ctx.save();
      if (t < shakeUntil) {
        const n = 14 * ((shakeUntil - t) / 600);
        ctx.translate((Math.random() - 0.5) * n, (Math.random() - 0.5) * n);
      }
      drawRoad(t);
      drawRunner(t);
      drawRobot(t);
      ctx.restore();

      // the ring that fills while the boost button is held down
      const hold = holdAt();
      if (hold > 0) {
        const w2 = canvas.width, h2 = canvas.height;
        ctx.strokeStyle = '#FFD86B';
        ctx.lineWidth = Math.max(3, h2 * 0.012);
        ctx.beginPath();
        ctx.arc(w2 / 2, h2 * 0.74, Math.min(w2, h2) * 0.13, -Math.PI / 2,
                -Math.PI / 2 + TAU * hold);
        ctx.stroke();
      }
      drawHud(t);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    tell();

    return {
      answered, holdStart, holdEnd, setRoom,
      get state() { return { charged: me.charged, spent: me.spent, streak: me.streak }; },
      stop() { stopped = true; if (raf) cancelAnimationFrame(raf); }
    };
  }

  global.NovaRun = { start, WORLDS, SPRINT_STREAK, HOLD_MS };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaRun;
