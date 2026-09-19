/* Boss Battle: ten seconds with a sword, in the round.
 *
 * The quiz stopped being the game here. Answering is how you arm yourself — get
 * it right and get it right quickly and you walk in swinging something that can
 * actually hurt the thing — and then the fight is a fight: ten seconds of real
 * time where the class is around a boss in a ring, hitting it, and being swept
 * off their feet when they misread it.
 *
 * Why two buttons and no joystick
 *   A thumbstick on a phone is a menu you operate badly. Ten seconds is not long
 *   enough to learn one, and a child looking down at a stick is a child not
 *   watching the board. So you are always facing the boss, and the only two
 *   things you do are SWING and DODGE — which is enough, because the game is not
 *   about where you stand. It is about when you move.
 *
 * The loop that makes it worth playing twice
 *   The boss winds up, out loud, with a ring that closes on you. Dodge as it
 *   lands and you are untouched and it is off balance — a stagger window where
 *   every hit counts triple. Dodge early and you have wasted it. Don't dodge and
 *   you are on the floor for a second and a half, watching everybody else score.
 *   So the good players are not the fast readers. They are the ones who waited.
 *
 * What the answer actually buys
 *   A right answer, quickly, is a greatsword: long reach, heavy hits. A right
 *   answer slowly is a sword. A wrong answer is a stick — weak, but a stick is
 *   still a thing to hold, and a child who got it wrong is still in the fight
 *   rather than watching one. Nobody sits out a round in this mode.
 *
 * Where the work happens
 *   Every device runs its own fight and draws everyone else from what they
 *   broadcast, exactly as the Laser Tag arena does. Damage is reported by the
 *   phone that dealt it and totalled by the host, so thirty children swinging is
 *   thirty small messages rather than one device simulating a room.
 */
(function (global) {
  'use strict';

  const R_RING = 560;                  // how far the class stands from the boss
  const BOSS_R = 150, PLAYER_R = 26;
  const BODY_H = 120, BOSS_H = 330;

  /* Ten seconds, and the shape of them. A fight this short has to start
   * immediately and finish on a beat, so the boss's first wind-up lands at 3.4s
   * and the second at 7.2s: two real decisions per round, never three. */
  const ROUND_MS = 10000;
  const WINDUPS = [3400, 7200];
  const TELL_MS = 1100;                // how long the ring takes to close
  const DODGE_MS = 420;                // how long a dodge keeps you safe
  const DODGE_COOL = 900;
  const FLOOR_MS = 1500;               // knocked down
  const STAGGER_MS = 1600;             // its window of weakness after a clean dodge

  /* Everyone is fighting the same thing with a different blade.
   *
   * What your answer earns is the tier — greatsword, sword, stick — and which
   * of the six shapes you carry comes from your blook, so it is yours all game
   * and the ring is thirty different weapons rather than thirty copies of one.
   * The tier decides what it does; the shape decides what it looks like. */
  const SHAPES = [
    { id: 'straight', tip: 0.00, hilt: 1.0, glow: '#FFFFFF' },
    { id: 'cleaver',  tip: 0.28, hilt: 1.5, glow: '#FF9A3D' },
    { id: 'katana',   tip: 0.16, hilt: 0.7, glow: '#7FD8FF' },
    { id: 'dagger',   tip: 0.06, hilt: 0.9, glow: '#E8467C' },
    { id: 'axe',      tip: 0.42, hilt: 1.7, glow: '#FFC53D' },
    { id: 'spear',    tip: -0.1, hilt: 0.6, glow: '#7BC62D' }
  ];
  const shapeFor = (avatar) => SHAPES[(Number(avatar) || 0) % SHAPES.length];

  const BLADES = {
    great: { label: 'Greatsword', reach: 250, damage: 26, swing: 420, colour: '#FFC53D' },
    sword: { label: 'Sword',      reach: 200, damage: 16, swing: 380, colour: '#E9ECF5' },
    stick: { label: 'A stick',    reach: 150, damage: 6,  swing: 320, colour: '#8B6A4A' }
  };
  /** What your answer earned you. Fast and right is the only way to a greatsword. */
  function bladeFor(correct, speed) {
    if (!correct) return 'stick';
    return speed >= 0.5 ? 'great' : 'sword';
  }

  /* The same twelve colours the blooks use, so a child in the ring is the
   * colour they picked in the lobby. */
  const SKIN = ['#F4364C', '#4F6BFF', '#FFC53D', '#12BE8E', '#7C4DFF', '#2BA8FF',
                '#FF7A45', '#00B8A9', '#E8467C', '#7BC62D', '#FF9A3D', '#3AC0D8'];

  const now = () => performance.now();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const TAU = Math.PI * 2;

  /**
   * start(options) → controller
   *   canvas     where to draw
   *   me         this player ({ id, name, avatar }), or null on the board
   *   blade      'great' | 'sword' | 'stick'
   *   watching   true for the board: draw everyone, control nobody
   *   boss       { name, hp, max }
   *   seed       so every device runs the same boss from the same script
   *   send       (event, payload) => void
   *   onHit      (damage, critical) => void
   *   onDone     () => void
   */
  function start(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    const watching = !!opts.watching;
    const send = opts.send || (() => {});
    const meId = opts.me ? opts.me.id : 'board';
    const boss = Object.assign({ name: 'The Boss', hp: 100, max: 100 }, opts.boss || {});

    /* Everybody in the ring, this device's own player included. Others arrive
     * over the broadcast and are drawn from whatever they last said. */
    const folk = new Map();
    const startedAt = now();
    let raf = null, finished = false;
    let hits = 0, best = 0;

    const self = {
      id: meId, name: (opts.me && opts.me.name) || '', avatar: (opts.me && opts.me.avatar) || 0,
      angle: Math.random() * TAU,        // where in the ring this player stands
      blade: BLADES[opts.blade] ? opts.blade : 'stick',
      swingAt: -9999, dodgeAt: -9999, downUntil: 0, combo: 0, damage: 0, lunge: 0
    };
    if (!watching) folk.set(meId, self);

    /* The boss's script, identical on every device because it is derived rather
     * than rolled: two wind-ups at fixed times, each aimed at a third of the
     * ring picked from the seed. Nobody can be out of step about what it did. */
    const seed = (opts.seed || 1) >>> 0;
    const swings = WINDUPS.map((at, i) => ({
      at,
      // which arc of the ring the sweep covers: half of it, so standing still is
      // a coin flip and reading the tell is not
      from: ((seed >> (i * 7)) % 360) * Math.PI / 180,
      span: Math.PI,
      landed: false
    }));

    const elapsed = () => now() - startedAt;

    /** The wind-up currently on screen, if any. */
    function winding(t) {
      for (const s of swings) {
        if (t >= s.at - TELL_MS && t < s.at) return s;
      }
      return null;
    }
    let staggerUntil = 0;

    // ── the 3D camera, the same one the Laser Tag arena uses ──
    const TILT = 0.80, FOCAL = 900, EYE = 560, NEAR = 60;
    const sinT = Math.sin(TILT), cosT = Math.cos(TILT);
    let cam = { x: 0, y: 0, scale: 1, cx: 0, cy: 0 };

    function raw(x, y, z) {
      const ey = cam.y - y, ez = EYE - z;
      const depth = ey * cosT + ez * sinT;
      if (depth < NEAR) return null;
      const k = FOCAL / depth;
      return { rx: (x - cam.x) * k, ry: (ey * sinT - ez * cosT) * k, k, depth };
    }
    function project(x, y, z) {
      const r = raw(x, y, z);
      if (!r) return null;
      return { x: cam.cx + r.rx * cam.scale, y: cam.cy - r.ry * cam.scale,
               k: r.k * cam.scale, depth: r.depth };
    }

    /* The board looks at the whole ring from outside it. A phone stands behind
     * its own player, looking past their shoulder at the thing trying to kill
     * them, which is the only camera that makes a ten-second fight legible. */
    function fit() {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      if (watching) {
        cam.x = 0; cam.y = R_RING + 1150;
        const edge = R_RING + 160;
        const corners = [raw(-edge, -edge, 0), raw(edge, -edge, 0),
                         raw(edge, edge, 0), raw(-edge, edge, 0),
                         raw(0, 0, BOSS_H)].filter(Boolean);
        if (corners.length) {
          const xs = corners.map(c => c.rx), ys = corners.map(c => c.ry);
          const spanX = Math.max(...xs) - Math.min(...xs) || 1;
          const spanY = Math.max(...ys) - Math.min(...ys) || 1;
          cam.scale = Math.min(w * 0.96 / spanX, h * 0.92 / spanY);
          cam.cx = w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * cam.scale;
          cam.cy = h / 2 + ((Math.max(...ys) + Math.min(...ys)) / 2) * cam.scale;
        } else { cam.scale = 1; cam.cx = w / 2; cam.cy = h / 2; }
      } else {
        /* The phone's camera, in view coordinates — which is the only place it
         * can be. Everything is drawn through view(), which rotates the ring so
         * this player is always at the bottom of their own screen; placing the
         * camera in world coordinates instead put it somewhere else entirely and
         * left the boss behind it, so the fight rendered as an empty floor for
         * every spawn angle but one. The spawn angle is random, so it was wrong
         * almost always and right just often enough to look like a flaky test.
         *
         * In view space this player is at (0, +ringAt) and the boss at the
         * origin, so the camera stands a little further out on the same line
         * and looks along −y at both of them. */
        const BEHIND = 360, VIEW = 900;
        cam.x = 0;
        cam.y = ringAt(self) + BEHIND;
        const depth = BEHIND * cosT + EYE * sinT;
        cam.scale = w / (VIEW * (FOCAL / depth));
        cam.cx = w / 2;
        cam.cy = h * 0.66;
      }
      return cam;
    }
    /* A phone's camera looks along −y, so the whole ring is rotated under it to
     * put this player at the bottom of their own screen. On the board there is
     * no rotation: everybody is where they are. */
    const view = (p) => {
      // +π/2 rather than −π/2: this player has to land at +y, on the camera's
      // side of the boss, or they are behind the lens and nothing is drawn
      const a = watching ? p.angle : p.angle - self.angle + Math.PI / 2;
      return { x: Math.cos(a) * ringAt(p), y: Math.sin(a) * ringAt(p), a };
    };
    /** How far out this player is standing: lunging in on a swing, out otherwise. */
    const ringAt = (p) => R_RING - (p.lunge || 0) * 130;

    // ── what this player does ──
    function swing() {
      const t = elapsed();
      if (finished || t > ROUND_MS) return;
      if (now() < self.downUntil) return;
      const b = BLADES[self.blade];
      if (now() - self.swingAt < b.swing) return;
      self.swingAt = now();

      // the stagger window is the whole point of dodging well
      const critical = now() < staggerUntil;
      const dealt = Math.round(b.damage * (critical ? 3 : 1) * (1 + Math.min(self.combo, 6) * 0.08));
      self.damage += dealt;
      self.combo += 1;
      best = Math.max(best, self.combo);
      hits += 1;
      if (opts.onHit) opts.onHit(dealt, critical);
      spark(dealt, critical);
      send('strike:hit', { id: meId, d: dealt, c: critical ? 1 : 0 });
    }

    function dodge() {
      if (finished) return;
      if (now() < self.downUntil) return;
      if (now() - self.dodgeAt < DODGE_COOL) return;
      self.dodgeAt = now();
    }

    /* The sweep lands. Anyone inside its arc who is not mid-dodge goes down; a
     * clean dodge staggers the boss for everybody, which is why the room starts
     * shouting at each other about when to roll. */
    function land(s) {
      s.landed = true;
      let dodgedClean = false;
      for (const p of folk.values()) {
        const a = ((p.angle - s.from) % TAU + TAU) % TAU;
        const caught = a <= s.span;
        const rolling = now() - (p.dodgeAt || -9999) < DODGE_MS;
        if (!caught) continue;
        if (rolling) { dodgedClean = true; continue; }
        p.downUntil = now() + FLOOR_MS;
        p.combo = 0;
        if (p.id === meId) shake(18);
      }
      if (dodgedClean) staggerUntil = now() + STAGGER_MS;
      if (!watching && now() - (self.dodgeAt || -9999) < DODGE_MS) {
        const a = ((self.angle - s.from) % TAU + TAU) % TAU;
        if (a <= s.span) flash('Clean dodge');
      }
    }

    // ── a little life on the screen ──
    const sparks = [];
    let shakeUntil = 0, shakeAmt = 0, flashText = '', flashUntil = 0;
    function spark(amount, critical) {
      const v = view(self);
      sparks.push({ x: v.x * 0.5, y: v.y * 0.5, z: BOSS_H * 0.55, born: now(),
                    text: (critical ? '×3  ' : '') + amount, critical });
    }
    const shake = (n) => { shakeUntil = now() + 260; shakeAmt = n; };
    const flash = (t) => { flashText = t; flashUntil = now() + 900; };

    // ── other devices ──
    function heard(event, payload) {
      if (!payload || payload.id === meId) return;
      if (event === 'strike:where') {
        const p = folk.get(payload.id) || { id: payload.id, combo: 0, damage: 0 };
        p.name = payload.n || p.name; p.avatar = payload.a || 0;
        p.angle = payload.g; p.blade = payload.b || 'stick';
        p.lunge = payload.l || 0;
        p.downUntil = payload.d ? now() + payload.d : 0;
        folk.set(payload.id, p);
      } else if (event === 'strike:hit') {
        const p = folk.get(payload.id);
        if (p) { p.damage = (p.damage || 0) + (payload.d || 0); p.flashUntil = now() + 200; }
        if (watching && opts.onHit) opts.onHit(payload.d || 0, !!payload.c);
      }
    }

    let lastSend = 0;
    function tell() {
      if (watching) return;
      if (now() - lastSend < 100) return;
      lastSend = now();
      send('strike:where', { id: meId, n: self.name, a: self.avatar, g: self.angle,
                             b: self.blade, l: self.lunge,
                             d: Math.max(0, Math.round(self.downUntil - now())) });
    }

    // ── drawing ──
    function draw() {
      const t = elapsed();
      const w = canvas.width, h = canvas.height;
      fit();
      ctx.save();
      if (now() < shakeUntil) {
        ctx.translate((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt);
      }
      // the hall
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#0C0820'); sky.addColorStop(0.45, '#1C1442');
      sky.addColorStop(0.47, '#0A0718'); sky.addColorStop(1, '#07040F');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      // the floor: a disc with rings on it, so distance is readable
      floorDisc();
      const s = winding(t);
      if (s) tell_ring(s, t);
      for (const sw of swings) if (!sw.landed && t >= sw.at) land(sw);

      // everything from the back of the room forwards
      const drawable = [...folk.values()].map(p => ({ p, v: view(p) }))
        .sort((a, b) => b.v.y - a.v.y);
      const bossFront = drawable.filter(d => d.v.y < 0);
      const bossBack = drawable.filter(d => d.v.y >= 0);
      bossBack.forEach(d => figure(d.p, d.v));
      bossFigure(t);
      bossFront.forEach(d => figure(d.p, d.v));
      sparkles();
      ctx.restore();
      hud(t);
    }

    function floorDisc() {
      const steps = 44;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * TAU;
        const pt = project(Math.cos(a) * (R_RING + 210), Math.sin(a) * (R_RING + 210), 0);
        if (!pt) continue;
        i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y);
      }
      ctx.closePath();
      const mid = project(0, 0, 0);
      if (mid) {
        const g = ctx.createRadialGradient(mid.x, mid.y, 10, mid.x, mid.y, canvas.width * 0.7);
        g.addColorStop(0, 'rgba(124,77,255,.34)');
        g.addColorStop(1, 'rgba(10,6,24,.96)');
        ctx.fillStyle = g;
      } else ctx.fillStyle = '#140E2C';
      ctx.fill();

      ctx.strokeStyle = 'rgba(180,160,255,.22)';
      ctx.lineWidth = 2;
      [BOSS_R + 40, R_RING - 120, R_RING].forEach(r => {
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * TAU;
          const pt = project(Math.cos(a) * r, Math.sin(a) * r, 0);
          if (!pt) continue;
          i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y);
        }
        ctx.closePath(); ctx.stroke();
      });
    }

    /* The wind-up, drawn on the floor where it will land. It is deliberately
     * enormous and deliberately red: the whole mechanic is that you can see it
     * coming, and a warning nobody notices is not a mechanic at all. */
    function tell_ring(s, t) {
      const p = clamp((t - (s.at - TELL_MS)) / TELL_MS, 0, 1);
      const steps = 36;
      ctx.beginPath();
      const inner = project(0, 0, 0);
      if (inner) ctx.moveTo(inner.x, inner.y);
      for (let i = 0; i <= steps; i++) {
        const a = s.from + (i / steps) * s.span;
        const pt = project(Math.cos(a) * (R_RING + 150), Math.sin(a) * (R_RING + 150), 0);
        if (pt) ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(244,54,76,${0.14 + 0.34 * p})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255,90,110,${0.5 + 0.5 * p})`;
      ctx.lineWidth = 3 + 6 * p;
      ctx.stroke();
    }

    function bossFigure(t) {
      const foot = project(0, 0, 0);
      const head = project(0, 0, BOSS_H);
      if (!foot || !head) return;
      const r = BOSS_R * foot.k;
      const tall = Math.max(20, foot.y - head.y);
      const staggered = now() < staggerUntil;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, r * 1.1, r * 0.42, 0, 0, TAU);
      ctx.fill();

      // the body, leaning when it is off balance
      const lean = staggered ? Math.sin(now() / 90) * 0.12 : 0;
      ctx.translate(foot.x, foot.y);
      ctx.rotate(lean);
      const body = ctx.createLinearGradient(0, -tall, 0, 0);
      body.addColorStop(0, staggered ? '#C9A6FF' : '#9B7BFF');
      body.addColorStop(1, staggered ? '#5E3BB8' : '#3E2680');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-r * 0.78, 0);
      ctx.quadraticCurveTo(-r * 0.96, -tall * 0.62, 0, -tall);
      ctx.quadraticCurveTo(r * 0.96, -tall * 0.62, r * 0.78, 0);
      ctx.closePath();
      ctx.fill();

      // two eyes, and they close when it is reeling
      ctx.fillStyle = staggered ? '#FFC53D' : '#FF5A6E';
      const eyeY = -tall * 0.68, eyeR = Math.max(3, r * 0.14);
      [-r * 0.3, r * 0.3].forEach(ex => {
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, eyeR, staggered ? eyeR * 0.25 : eyeR, 0, 0, TAU);
        ctx.fill();
      });
      ctx.restore();

      // its health, painted on the floor in front of it
      const bar = project(0, R_RING * 0.42, 6);
      if (bar) {
        const width = r * 2.4, left = bar.x - width / 2, top = bar.y;
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(left, top, width, Math.max(6, 16 * foot.k));
        ctx.fillStyle = staggered ? '#FFC53D' : '#F4364C';
        ctx.fillRect(left, top, width * clamp(boss.hp / Math.max(1, boss.max), 0, 1),
                     Math.max(6, 16 * foot.k));
      }
    }

    function figure(p, v) {
      const foot = project(v.x, v.y, 0);
      const head = project(v.x, v.y, BODY_H);
      if (!foot || !head) return;
      const down = now() < (p.downUntil || 0);
      const rolling = now() - (p.dodgeAt || -9999) < DODGE_MS;
      const r = PLAYER_R * foot.k;
      const tall = Math.max(6, foot.y - head.y) * (down ? 0.35 : 1);
      const mine = p.id === meId;

      ctx.save();
      ctx.globalAlpha = down ? 0.55 : 1;
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, r * 1.05, r * 0.42, 0, 0, TAU);
      ctx.fill();

      /* Own colour per player, taken from their avatar, so a class can find
       * themselves and each other. Everybody used to be the same blue, which
       * made the ring look like furniture rather than people. */
      ctx.fillStyle = mine ? '#FFC53D' : SKIN[(p.avatar || 0) % SKIN.length];
      ctx.beginPath();
      ctx.roundRect(foot.x - r * 0.6, foot.y - tall, r * 1.2, tall, r * 0.4);
      ctx.fill();
      // a head, so it is a person and not a domino
      ctx.beginPath();
      ctx.arc(foot.x, foot.y - tall - r * 0.42, r * 0.46, 0, TAU);
      ctx.fill();

      // the blade, swung as an arc rather than a line: it reads at a glance
      const b = BLADES[p.blade] || BLADES.stick;
      const shape = shapeFor(p.avatar);
      const since = now() - (p.swingAt || -9999);
      const swinging = since < b.swing;
      if (!down) {
        const arc = swinging ? (1 - since / b.swing) : 0;
        const tip = project(v.x * (1 - b.reach / R_RING * (swinging ? 1 : 0.55)),
                            v.y * (1 - b.reach / R_RING * (swinging ? 1 : 0.55)),
                            BODY_H * (swinging ? 0.5 + arc * 0.5 : 0.75));
        if (tip) {
          const hx = foot.x, hy = foot.y - tall * 0.62;
          // the hilt, which is where the six shapes differ most at a glance
          ctx.strokeStyle = '#3A2F1E';
          ctx.lineWidth = Math.max(2, 5 * shape.hilt * foot.k);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx + (tip.x - hx) * 0.22, hy + (tip.y - hy) * 0.22);
          ctx.stroke();
          // and the blade itself, widening for a cleaver, tapering for a spear
          ctx.strokeStyle = b.colour;
          ctx.lineWidth = Math.max(2, (swinging ? 9 : 5) * (1 + shape.tip) * foot.k);
          ctx.globalAlpha = (down ? 0.5 : 1) * (swinging ? 1 : 0.8);
          ctx.beginPath();
          ctx.moveTo(hx + (tip.x - hx) * 0.2, hy + (tip.y - hy) * 0.2);
          ctx.lineTo(tip.x, tip.y);
          ctx.stroke();
          if (swinging) {
            ctx.strokeStyle = shape.glow;
            ctx.globalAlpha = 0.65;
            ctx.lineWidth = Math.max(1, 2.5 * foot.k);
            ctx.stroke();
          }
        }
      }
      if (rolling) {
        ctx.strokeStyle = 'rgba(43,168,255,.85)';
        ctx.lineWidth = Math.max(2, 4 * foot.k);
        ctx.beginPath();
        ctx.ellipse(foot.x, foot.y, r * 1.6, r * 0.7, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (watching && p.name) {
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.font = `700 ${Math.max(10, 17 * foot.k)}px ui-sans-serif,system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.name, foot.x, foot.y + r * 1.5);
      }
      ctx.restore();
    }

    function sparkles() {
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        const age = (now() - s.born) / 850;
        if (age >= 1) { sparks.splice(i, 1); continue; }
        const pt = project(s.x, s.y, s.z + age * 150);
        if (!pt) continue;
        ctx.save();
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = s.critical ? '#FFC53D' : '#FFFFFF';
        ctx.font = `800 ${Math.max(14, (s.critical ? 34 : 26) * pt.k)}px ui-sans-serif,system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(s.text, pt.x, pt.y);
        ctx.restore();
      }
    }

    /* The only numbers on screen during the fight: how long is left, and what
     * this player is holding. Anything else is reading, and there is no time. */
    function hud(t) {
      const w = canvas.width, h = canvas.height;
      const left = Math.max(0, ROUND_MS - t);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(0, 0, w, Math.max(34, h * 0.075));
      ctx.fillStyle = left < 3000 ? '#FF5A6E' : '#FFFFFF';
      ctx.font = `800 ${Math.max(16, h * 0.05)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText((left / 1000).toFixed(1) + 's', w * 0.03, h * 0.058);
      if (!watching) {
        ctx.textAlign = 'right';
        ctx.fillStyle = BLADES[self.blade].colour;
        ctx.fillText(BLADES[self.blade].label, w * 0.97, h * 0.058);
        /* The combo goes on its own line. It used to be centred on the same one
         * as the clock and the blade, which on a phone meant all three words
         * sitting on top of each other. */
        if (self.combo >= 2) {
          ctx.textAlign = 'center';
          ctx.fillStyle = '#FFC53D';
          ctx.font = `800 ${Math.max(13, h * 0.038)}px ui-sans-serif,system-ui,sans-serif`;
          ctx.fillText(self.combo + ' in a row', w / 2, h * 0.115);
        }
      }
      if (now() < flashUntil) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#12BE8E';
        ctx.font = `800 ${Math.max(20, h * 0.07)}px ui-sans-serif,system-ui,sans-serif`;
        ctx.fillText(flashText, w / 2, h * 0.30);
      }
      ctx.restore();
    }

    function frame() {
      const t = elapsed();
      if (!watching) {
        // lunging in on a swing and stepping back out, so a swing is visible
        const since = now() - self.swingAt;
        const b = BLADES[self.blade];
        self.lunge = since < b.swing ? Math.sin((since / b.swing) * Math.PI) : 0;
        tell();
      }
      draw();
      if (t >= ROUND_MS && !finished) {
        finished = true;
        if (opts.onDone) opts.onDone({ hits, damage: self.damage, best });
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return {
      swing, dodge, heard,
      setBoss(next) { Object.assign(boss, next || {}); },
      add(p) { if (p && p.id !== meId) folk.set(p.id, Object.assign({ angle: Math.random() * TAU, combo: 0, damage: 0 }, p)); },
      stop() { finished = true; if (raf) cancelAnimationFrame(raf); }
    };
  }

  global.NovaStrike = { start, BLADES, SHAPES, shapeFor, bladeFor, ROUND_MS, WINDUPS };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaStrike;
