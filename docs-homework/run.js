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

  /* The class run as their own blooks. Canvas cannot draw an SVG string, so
     each face is rasterised once into an offscreen canvas and then stamped. The
     data URI needs an explicit xmlns: inline HTML infers the SVG namespace, a
     data URI does not, and without it the image silently never loads. */
  const faces = new Map();
  function blookFace(avatar) {
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
    } catch { /* no Sprite here: a plain disc stands in */ }
    return spot;
  }

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
    /* The board draws; a phone does not. The chase used to run on the phone,
       where it fought the question for a screen the size of a hand, and the
       board showed a progress bar over a list of names. Kahoot puts the robot
       on the host's screen and gives the phone the question and the boost
       button, which is the right way round: thirty children looking up at the
       same chase is the moment, and none of them can see it on a phone in
       their lap. */
    const canvas = opts.canvas || null;
    const ctx = canvas ? canvas.getContext('2d') : null;
    const world = WORLDS[opts.world] || WORLDS.station;
    let players = opts.players || [];
    const boosts = [];                 // when each boost went off, for the rush

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
    let shakeUntil = 0, banner = '', bannerUntil = 0;

    function fit() {
      if (!canvas) return;
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    // ── what answering does ──
    let lastToken = null;

    /* answered(right, token)
     *
     * The token says which question this was. One answer per question counts,
     * however many times the button is hit — a child on a phone double-taps
     * constantly: an impatient thumb, a slow screen, a button that redraws
     * under them, and every one of those taps used to be another boost.
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
      boosts.push(now());
      shakeUntil = now() + 520;
      say('BOOST');
      if (opts.onBoost) opts.onBoost(me.spent);
      tell();
      return true;
    }
    /** How far through the hold the finger is, 0 to 1. */
    const holdAt = () => me.holdFrom ? Math.min(1, (now() - me.holdFrom) / HOLD_MS) : 0;

    /** The room's state, refreshed from the game. */
    function setRoom(next) { room = Object.assign(room, next || {}); }

    const say = (t) => { banner = t; bannerUntil = now() + 1300; };
    const tell = () => opts.onState && opts.onState({
      charged: me.charged, spent: me.spent, streak: me.streak,
      need: SPRINT_STREAK - me.streak,
      escape: room.escape, target: room.target, lives: room.lives, round: room.round });

    /* ── the chase, on the big screen ──────────────────────
     *
     * Kahoot's host screen "displays an angry robot chasing players' game
     * characters", with the collective lives in the top right. The phone gets
     * questions and a boost button and nothing else. This had it backwards: the
     * chase was on the phone, where it competed with the question for a screen
     * the size of a hand, and the board was a progress bar over a list of names.
     *
     * So it is side on, which is the only view where a chase reads from the back
     * of a classroom: the robot on the left, the whole class running as a pack on
     * the right, and the distance between them is the room's escape bar. Nobody
     * has to read a number to know they are in trouble.
     */
    const GROUND = 0.80;                 // where the floor line sits, down the canvas

    /** Parallax: how far a layer has slid, given how fast it is meant to move. */
    const slide = (t, speed, span) => -((t * speed) % span);

    function drawScene(t) {
      const w = canvas.width, h = canvas.height;
      const gy = h * GROUND;
      const run = t * (0.35 + rush() * 0.5);        // everything scrolls faster in a boost

      // the deck behind them: a lit ceiling, a dark wall, a floor
      const sky = ctx.createLinearGradient(0, 0, 0, gy);
      sky.addColorStop(0, world.sky[0]);
      sky.addColorStop(1, world.sky[1]);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, gy);

      // wall panels, sliding slowly: the far layer
      const panelW = h * 0.42;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = world.wall;
      for (let x = slide(run, 0.03, panelW); x < w; x += panelW) {
        ctx.fillRect(x + panelW * 0.08, h * 0.16, panelW * 0.84, gy - h * 0.16);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // pipes and lights, sliding faster: the middle layer
      const bayW = h * 0.62;
      for (let x = slide(run, 0.09, bayW); x < w; x += bayW) {
        ctx.fillStyle = 'rgba(0,0,0,.28)';
        ctx.fillRect(x, h * 0.10, h * 0.045, gy - h * 0.10);
        // a strip light on the ceiling, and the pool it throws
        ctx.fillStyle = world.tint;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x + h * 0.10, h * 0.075, h * 0.30, h * 0.016);
        const pool = ctx.createLinearGradient(0, h * 0.09, 0, gy);
        pool.addColorStop(0, world.tint);
        pool.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = pool;
        ctx.fillRect(x + h * 0.04, h * 0.09, h * 0.42, gy - h * 0.09);
        ctx.globalAlpha = 1;
      }

      // the floor
      const floor = ctx.createLinearGradient(0, gy, 0, h);
      floor.addColorStop(0, world.road[0]);
      floor.addColorStop(1, world.road[1]);
      ctx.fillStyle = floor;
      ctx.fillRect(0, gy, w, h - gy);
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.lineWidth = Math.max(2, h * 0.006);
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();

      // floor plates, sliding at full speed: the near layer, and the speed cue
      const plate = h * 0.30;
      ctx.strokeStyle = 'rgba(255,255,255,.10)';
      ctx.lineWidth = Math.max(1.5, h * 0.004);
      for (let x = slide(run, 0.42, plate); x < w + plate; x += plate) {
        ctx.beginPath();
        ctx.moveTo(x, gy + h * 0.01);
        ctx.lineTo(x - h * 0.06, h);
        ctx.stroke();
      }

      // speed lines while the room is boosting
      if (rush() > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${0.10 + rush() * 0.28})`;
        ctx.lineWidth = Math.max(1.5, h * 0.005);
        for (let i = 0; i < 14; i++) {
          const y = h * (0.22 + (i / 14) * 0.5);
          const x = ((t * (1.4 + i * 0.12) + i * 211) % (w + 400)) - 200;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + h * 0.12, y); ctx.stroke();
        }
      }

      ctx.fillStyle = world.mist;
      ctx.fillRect(0, 0, w, h);
    }

    /* Where the pack runs, and where the robot is behind it. The gap is the
       room's escape bar: an empty bar and the thing is on top of them. */
    const packX = () => canvas.width * 0.72;
    function robotX() {
      const frac = clamp((room.escape || 0) / Math.max(1, room.target || 100), 0, 1);
      return packX() - canvas.width * (0.20 + frac * 0.52);
    }
    /** How hard the room is boosting right now, 0 to 1. */
    function rush() {
      let best = 0;
      boosts.forEach(b => {
        const age = (now() - b) / 1400;
        if (age >= 0 && age < 1) best = Math.max(best, 1 - age);
      });
      return best;
    }

    /* One child, side on, running. Their own blook, on legs that move, leaning
       into it. Their name under them, because a teacher watching the board needs
       to know who is where. */
    function drawRunner(p, i, n, t) {
      const h = canvas.height;
      const gy = h * GROUND;
      const size = h * 0.15;
      // further ahead the more boosts they have put in, with a little spread so
      // the pack is a pack and not a queue
      /* Laid out evenly across the pack rather than by a hash of the index:
         seven children through a five-slot hash put three names on top of each
         other. Whoever has put more boosts in runs a little further ahead. */
      const lead = Math.min(4, p.boosts || 0) * h * 0.030;
      const spread = (i - (n - 1) / 2) * h * 0.085;
      const x = packX() + lead + spread;
      const cycle = Math.sin(t / (rush() > 0 ? 58 : 92) + i * 1.7);
      const bob = Math.abs(cycle) * size * 0.08;
      const y = gy - size * 0.52 - bob;

      ctx.save();
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath();
      ctx.ellipse(x, gy + h * 0.012, size * 0.4, size * 0.1, 0, 0, TAU);
      ctx.fill();

      // legs, scissoring under them
      ctx.strokeStyle = '#1C1530';
      ctx.lineWidth = Math.max(2.5, size * 0.13);
      ctx.lineCap = 'round';
      [-1, 1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(x, y + size * 0.3);
        ctx.lineTo(x + cycle * s * size * 0.42, gy - h * 0.004);
        ctx.stroke();
      });

      const face = blookFace(p.avatar);
      if (face && face.ready) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(0.12);                       // leaning into the run
        ctx.drawImage(face.canvas, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        ctx.fillStyle = p.colour || world.tint;
        ctx.beginPath(); ctx.arc(x, y, size * 0.42, 0, TAU); ctx.fill();
      }

      // a streak behind anybody whose boost is still going off
      if (p.boostAt && now() - p.boostAt < 1400) {
        const a = 1 - (now() - p.boostAt) / 1400;
        ctx.strokeStyle = `rgba(255,216,107,${a})`;
        ctx.lineWidth = Math.max(2, size * 0.08);
        for (let k = 0; k < 3; k++) {
          const yy = y - size * (0.2 - k * 0.2);
          ctx.beginPath();
          ctx.moveTo(x - size * (0.6 + k * 0.2), yy);
          ctx.lineTo(x - size * (1.3 + k * 0.3), yy);
          ctx.stroke();
        }
      }

      if (p.name) {
        const fs = Math.max(10, h * 0.026);
        ctx.font = `800 ${fs}px ui-sans-serif,system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(p.name).width + fs * 0.8;
        ctx.fillStyle = 'rgba(8,6,20,.7)';
        ctx.beginPath();
        ctx.roundRect(x - tw / 2, gy + h * 0.022, tw, fs * 1.5, fs * 0.75);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(p.name, x, gy + h * 0.022 + fs * 0.78);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();
    }

    /* The robot. Side on, striding, and built out of hard edges — a monster is a
       blob with eyes, a machine has plates and pistons, and plates read on a
       projector from the back of a room. */
    function drawRobot(t) {
      /* Built on a skeleton with the floor at zero: feet at 0, hip at -180,
         chest -350 to -180, neck to -395, head to -470, horns to -505. The
         first attempt had each part measured from its own origin, so the legs
         ended below the floor and the head floated forty units clear of the
         neck — a machine in pieces. */
      const w = canvas.width, h = canvas.height;
      const gy = h * GROUND;
      const S = h * 0.00115;                // one robot unit, in pixels
      const x = robotX();
      const stride = Math.sin(t / (rush() > 0 ? 130 : 180));
      const close = clamp(1 - (packX() - x) / (w * 0.6), 0, 1);   // how near it is

      ctx.save();
      ctx.translate(x, gy);
      ctx.scale(S, S);

      const box = (px, py, pw, ph, fillStyle, r) => {
        ctx.fillStyle = fillStyle;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, r === undefined ? 6 : r);
        ctx.fill();
      };

      // the shadow it drags along the floor
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      ctx.ellipse(0, 6, 145, 24, 0, 0, TAU);
      ctx.fill();

      // the far leg, then the near one, so it strides
      [[-1, 0.5], [1, 1]].forEach(([dir, shade]) => {
        ctx.save();
        ctx.globalAlpha = shade;
        ctx.translate(dir * 26, -180);
        ctx.rotate(stride * dir * 0.34);
        box(-26, 0, 52, 95, '#2E3644', 12);            // thigh, hip to knee
        ctx.translate(0, 95);
        ctx.rotate(-stride * dir * 0.46 - 0.1);
        box(-20, 0, 40, 60, '#3A4454', 10);            // shin, knee to ankle
        box(-32, 56, 72, 24, '#20262F', 8);            // foot, landing on zero
        ctx.restore();
      });

      // the chest: a slab with a lit core and vents
      box(-78, -350, 156, 176, '#39424F', 20);
      box(-62, -336, 124, 56, '#232A34', 12);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      [0, 1, 2].forEach(i => ctx.fillRect(-54, -262 + i * 22, 108, 10));
      const core = ctx.createRadialGradient(0, -298, 4, 0, -298, 46);
      core.addColorStop(0, '#FFF2C8');
      core.addColorStop(0.4, `rgba(255,90,60,${0.6 + close * 0.4})`);
      core.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(0, -298, 46, 0, TAU); ctx.fill();

      // exhaust stacks off the back
      box(-96, -402, 24, 62, '#262D38', 6);
      box(-66, -412, 24, 72, '#262D38', 6);

      /* Two arms, reaching for the class. They hang off the shoulders at the
         top corners of the chest rather than out of the middle of it, which is
         what made them read as loose bars floating beside the body. */
      [[-1, 0.5], [1, 1]].forEach(([dir, shade]) => {
        ctx.save();
        ctx.globalAlpha = shade;
        ctx.translate(74 + dir * 10, -318);
        /* Negative: canvas rotates clockwise, so a positive angle swung the
           arm back over its own shoulder instead of out towards the class. */
        ctx.rotate(-1.38 + stride * dir * 0.4);
        box(-19, 0, 38, 92, dir > 0 ? '#5A6678' : '#3C4552', 10);   // upper arm
        ctx.translate(0, 92);
        ctx.rotate(-0.30 - stride * dir * 0.35);
        box(-16, 0, 32, 80, dir > 0 ? '#6E7B8E' : '#495467', 9);    // forearm
        ctx.translate(0, 80);
        box(-20, 0, 13, 38, '#C9D2DE', 5);             // the pincer
        box(7, 0, 13, 38, '#C9D2DE', 5);
        ctx.restore();
      });

      // the neck, which reaches the chest: the head used to float clear of it
      box(-20, -398, 40, 52, '#2A313C', 6);

      ctx.save();
      ctx.translate(0, -398);
      ctx.rotate(Math.sin(t / 900) * 0.09);
      box(-64, -74, 128, 80, '#46505F', 16);           // the skull
      box(-54, -62, 108, 44, '#161B22', 12);           // the visor it looks through
      // horns, so it is angry rather than merely industrial
      ctx.fillStyle = '#C9D2DE';
      [[-56, -74], [36, -74]].forEach(([hx, hy]) => {
        ctx.beginPath();
        ctx.moveTo(hx, hy); ctx.lineTo(hx + 12, hy - 42); ctx.lineTo(hx + 22, hy);
        ctx.closePath(); ctx.fill();
      });
      // the eye, sweeping the deck, and the beam it throws down it
      const sweep = Math.sin(t / 620) * 26;
      ctx.globalAlpha = 0.10 + close * 0.12;
      ctx.fillStyle = '#FF3B2F';
      ctx.beginPath();
      ctx.moveTo(sweep, -40);
      ctx.lineTo(900, 150); ctx.lineTo(900, 330);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.shadowColor = '#FF3B2F'; ctx.shadowBlur = 38;
      ctx.fillStyle = '#FF3B2F';
      ctx.beginPath(); ctx.arc(sweep, -40, 15 + close * 4, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.restore();
      ctx.restore();

      // smoke, drifting back off the stacks
      ctx.save();
      for (let i = 0; i < 5; i++) {
        const a = ((t / 900) + i * 0.2) % 1;
        ctx.globalAlpha = (1 - a) * 0.26;
        ctx.fillStyle = '#7B8494';
        ctx.beginPath();
        ctx.arc(x - S * 80 - a * h * 0.26, gy - S * 420 - a * h * 0.14,
                h * (0.012 + a * 0.028), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    /* The board's numbers: which deck, how long before it reaches the room, and
       the lives — which are the class's, not anybody's. */
    function drawHud(t) {
      const w = canvas.width, h = canvas.height;
      ctx.save();

      // the time bar along the very top
      const left = clamp((room.endsAt ? (room.endsAt - Date.now()) : 0) /
                         Math.max(1, room.roundMs || 75000), 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, w, h * 0.018);
      ctx.fillStyle = left < 0.25 ? '#F4364C' : world.tint;
      ctx.fillRect(0, 0, w * left, h * 0.018);

      ctx.font = `900 ${Math.max(16, h * 0.055)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.fillText('Deck ' + (room.round || 1), w * 0.03, h * 0.10);

      // lives, top right, as Kahoot's are
      ctx.textAlign = 'right';
      const lives = Math.max(0, room.lives || 0);
      ctx.font = `900 ${Math.max(18, h * 0.062)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.fillStyle = lives > 1 ? '#FF5A6E' : '#FFC53D';
      ctx.fillText('♥'.repeat(lives) || '—', w * 0.97, h * 0.10);

      // the escape bar: every boost anybody spends fills it
      const frac = clamp((room.escape || 0) / Math.max(1, room.target || 100), 0, 1);
      const barW = w * 0.94, barX = w * 0.03, barY = h * 0.135, barH = Math.max(8, h * 0.028);
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, barH / 2); ctx.fill();
      const g = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      g.addColorStop(0, '#12BE8E'); g.addColorStop(1, world.tint);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(barX, barY, Math.max(barH, barW * frac), barH, barH / 2);
      ctx.fill();
      ctx.font = `800 ${Math.max(10, h * 0.026)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.fillText(Math.round(frac * 100) + '% of the way off this deck',
                   barX + 4, barY + barH + h * 0.038);

      if (now() < bannerUntil) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FFD86B';
        ctx.font = `900 ${Math.max(22, h * 0.10)}px ui-sans-serif,system-ui,sans-serif`;
        ctx.fillText(banner, w / 2, h * 0.36);
      }
      ctx.restore();
    }

    function frame() {
      if (stopped) return;
      const t = now();
      last = t;
      if (!canvas) { raf = null; return; }
      fit();

      ctx.save();
      if (t < shakeUntil) {
        const n = 12 * ((shakeUntil - t) / 600);
        ctx.translate((Math.random() - 0.5) * n, (Math.random() - 0.5) * n);
      }
      drawScene(t);
      drawRobot(t);
      // the pack, furthest back first so a runner in front paints over one behind
      [...players].sort((a, b) => (a.boosts || 0) - (b.boosts || 0))
        .forEach((p, i, all) => drawRunner(p, i, all.length, t));
      ctx.restore();
      drawHud(t);
      raf = requestAnimationFrame(frame);
    }

    if (canvas) raf = requestAnimationFrame(frame);
    tell();

    return {
      answered, holdStart, holdEnd, setRoom,
      /** The class, refreshed from the game: who is running and how many
          boosts each of them has put into the pot. */
      setPlayers(list) { players = list || []; },
      /** Somebody spent a boost — anybody, not only this device. */
      cheer(at) { boosts.push(at || now()); shakeUntil = now() + 420;
                  if (boosts.length > 24) boosts.shift(); },
      say,
      get state() { return { charged: me.charged, spent: me.spent, streak: me.streak }; },
      stop() { stopped = true; if (raf) cancelAnimationFrame(raf); }
    };
  }

  global.NovaRun = { start, WORLDS, SPRINT_STREAK, HOLD_MS };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaRun;
