/* Laser Tag: one arena, everybody in it.
 *
 * The loop is play, run out of energy, answer a question, back in. Energy drains
 * while you are alive and every shot costs a little, so roughly twenty seconds of
 * fighting buys one question. Being tagged also puts you out until you answer.
 *
 * Where the work happens
 *   Each device simulates its own player and draws everyone. Positions go out over
 *   the game's broadcast channel ten times a second and are never written to the
 *   database: thirty children moving is far too much to store and worth nothing
 *   once the round is over. Only the score is written, every few seconds, so the
 *   board and the final results survive a phone going flat.
 *
 * Who decides a hit
 *   The player who is hit decides. A shooter says "I hit you"; the victim checks
 *   it against where it actually is, takes the hit and says so; the shooter counts
 *   the points when that answer comes back. Nobody can score by claiming.
 */
(function (global) {
  'use strict';

  const W = 1600, H = 1000;              // the arena, in its own units
  const PLAYER_R = 26, ALIEN_R = 22, SHOT_R = 7;
  const SPEED = 340, SHOT_SPEED = 780;   // units per second
  const ENERGY_SECONDS = 20;             // a full bar, spent just by being alive
  const SHOT_COST = 3;                   // per shot, as a percentage of the bar
  const FIRE_GAP = 260;                  // milliseconds between shots
  const ALIEN_POINTS = 10, PLAYER_POINTS = 100;
  const SEND_HZ = 10, SAVE_MS = 4000;

  const POWERS = {
    rapid:  { label: 'Rapid fire',  colour: '#FFC53D', life: 9000 },
    triple: { label: 'Triple shot', colour: '#FF7A45', life: 9000 },
    spread: { label: 'Triple beam', colour: '#E8467C', life: 9000 },
    speed:  { label: 'Speed boost', colour: '#2BA8FF', life: 9000 },
    shield: { label: 'Force field', colour: '#12BE8E', life: 0 },
    mystery:{ label: 'Mystery',     colour: '#7C4DFF', life: 0 }
  };
  const REAL_POWERS = ['rapid', 'triple', 'spread', 'speed', 'shield'];

  const now = () => performance.now();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  /**
   * start(options) → controller
   *   canvas    where to draw
   *   me        this player ({ id, name, avatar, team })
   *   watching  true for the board: draw everyone, control nobody
   *   send      (event, payload) => void, to the other devices
   *   onQuestion()   energy gone or tagged: the page should ask a question
   *   onScore(score) the running total changed
   */
  function start(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    const watching = !!opts.watching;
    const send = opts.send || (() => {});
    const meId = opts.me ? opts.me.id : 'board';

    const self = {
      id: meId, name: opts.me ? opts.me.name : '', avatar: opts.me ? opts.me.avatar : 0,
      team: opts.me ? opts.me.team : 'red',
      x: rand(200, W - 200), y: rand(200, H - 200), angle: 0,
      alive: !watching, energy: 100, score: 0, power: '', powerUntil: 0, shield: false
    };
    const others = new Map();            // id -> last state heard, with a timestamp
    const shots = [];
    const aliens = [];
    const capsules = [];
    const sparks = [];
    let running = true, last = now(), lastSend = 0, lastSave = 0, lastFire = 0;
    const keys = new Set();
    let stickX = 0, stickY = 0, pointer = null;

    /* ── the arena's own furniture ─────────────────────── */
    const spawnAlien = () => aliens.push({
      id: 'a' + Math.random().toString(36).slice(2, 7),
      x: rand(120, W - 120), y: rand(120, H - 120),
      vx: rand(-70, 70), vy: rand(-70, 70), hp: 1
    });
    const spawnCapsule = () => capsules.push({
      kind: REAL_POWERS.concat('mystery')[Math.floor(Math.random() * 6)],
      x: rand(140, W - 140), y: rand(140, H - 140), born: now()
    });
    for (let i = 0; i < 7; i++) spawnAlien();
    for (let i = 0; i < 3; i++) spawnCapsule();

    /* ── what other devices tell us ────────────────────── */
    function heard(event, data) {
      if (!data || data.id === meId) return;
      if (event === 'move') {
        const was = others.get(data.id);
        others.set(data.id, Object.assign(was || {}, data, { at: now() }));
      } else if (event === 'shot') {
        shots.push({ x: data.x, y: data.y, dx: Math.cos(data.a), dy: Math.sin(data.a),
                     by: data.id, team: data.team, mine: false, born: now() });
      } else if (event === 'hit' && data.to === meId) {
        // somebody says they hit us. We are the ones who decide.
        if (!self.alive) return;
        if (self.shield) { self.shield = false; boom(self.x, self.y, '#12BE8E'); return; }
        self.alive = false;
        boom(self.x, self.y, '#FF6B5A');
        send('tagged', { id: meId, by: data.id });
        if (opts.onQuestion) opts.onQuestion('tagged');
      } else if (event === 'tagged' && data.by === meId) {
        self.score += PLAYER_POINTS;                 // confirmed by the player we hit
        if (opts.onScore) opts.onScore(self.score);
      } else if (event === 'gone') {
        others.delete(data.id);
      }
    }

    function boom(x, y, colour) {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, s = rand(60, 260);
        sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, born: now(), colour });
      }
    }

    /* ── controls ──────────────────────────────────────── */
    const onKey = (e, down) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        down ? keys.add(k) : keys.delete(k);
        e.preventDefault();
      }
      if (down && k === ' ') { fire(); e.preventDefault(); }
    };
    const keyDown = (e) => onKey(e, true), keyUp = (e) => onKey(e, false);
    if (!watching) {
      window.addEventListener('keydown', keyDown);
      window.addEventListener('keyup', keyUp);
      canvas.addEventListener('mousemove', (e) => { pointer = toArena(e.clientX, e.clientY); });
      canvas.addEventListener('mousedown', (e) => { e.preventDefault(); fire(); });
    }

    /** The joystick both walks and aims: where you steer is where you shoot. */
    function stick(dx, dy) {
      stickX = dx; stickY = dy;
      if (dx || dy) self.angle = Math.atan2(dy, dx);
    }

    function fire() {
      if (!self.alive || watching) return;
      const gap = self.power === 'rapid' ? FIRE_GAP * 0.42 : FIRE_GAP;
      if (now() - lastFire < gap) return;
      lastFire = now();
      self.energy = clamp(self.energy - SHOT_COST, 0, 100);
      const angles = self.power === 'spread' ? [-0.22, 0, 0.22] : [0];
      angles.forEach(off => {
        const a = self.angle + off;
        shots.push({ x: self.x, y: self.y, dx: Math.cos(a), dy: Math.sin(a),
                     by: meId, team: self.team, mine: true, born: now() });
        send('shot', { id: meId, x: self.x, y: self.y, a, team: self.team });
      });
      if (self.power === 'triple') {                 // three in quick succession
        [110, 220].forEach(ms => setTimeout(() => {
          if (!running || !self.alive) return;
          const a = self.angle;
          shots.push({ x: self.x, y: self.y, dx: Math.cos(a), dy: Math.sin(a),
                       by: meId, team: self.team, mine: true, born: now() });
          send('shot', { id: meId, x: self.x, y: self.y, a, team: self.team });
        }, ms));
      }
    }

    /* ── the loop ──────────────────────────────────────── */
    function step(dt) {
      const t = now();

      if (self.alive && !watching) {
        let dx = stickX, dy = stickY;
        if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
        if (keys.has('d') || keys.has('arrowright')) dx += 1;
        if (keys.has('w') || keys.has('arrowup')) dy -= 1;
        if (keys.has('s') || keys.has('arrowdown')) dy += 1;
        const len = Math.hypot(dx, dy);
        if (len > 0.06) {
          const speed = SPEED * (self.power === 'speed' ? 1.55 : 1);
          self.x = clamp(self.x + (dx / len) * speed * dt, PLAYER_R, W - PLAYER_R);
          self.y = clamp(self.y + (dy / len) * speed * dt, PLAYER_R, H - PLAYER_R);
          if (!pointer) self.angle = Math.atan2(dy, dx);
        }
        if (pointer) self.angle = Math.atan2(pointer.y - self.y, pointer.x - self.x);

        // being alive is what costs energy; a full bar is about twenty seconds
        self.energy = clamp(self.energy - (100 / ENERGY_SECONDS) * dt, 0, 100);
        if (self.power && self.powerUntil && t > self.powerUntil) self.power = '';
        if (self.energy <= 0) {
          self.alive = false;
          if (opts.onQuestion) opts.onQuestion('energy');
        }

        capsules.forEach((c, i) => {
          if (Math.hypot(c.x - self.x, c.y - self.y) < PLAYER_R + 20) {
            const kind = c.kind === 'mystery'
              ? REAL_POWERS[Math.floor(Math.random() * REAL_POWERS.length)] : c.kind;
            if (kind === 'shield') self.shield = true;
            else { self.power = kind; self.powerUntil = t + POWERS[kind].life; }
            boom(c.x, c.y, POWERS[kind].colour);
            capsules.splice(i, 1);
            setTimeout(() => { if (running) spawnCapsule(); }, 6000);
          }
        });
      }

      aliens.forEach(a => {
        a.x += a.vx * dt; a.y += a.vy * dt;
        if (a.x < ALIEN_R || a.x > W - ALIEN_R) a.vx *= -1;
        if (a.y < ALIEN_R || a.y > H - ALIEN_R) a.vy *= -1;
        a.x = clamp(a.x, ALIEN_R, W - ALIEN_R); a.y = clamp(a.y, ALIEN_R, H - ALIEN_R);
      });

      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.x += s.dx * SHOT_SPEED * dt; s.y += s.dy * SHOT_SPEED * dt;
        if (s.x < 0 || s.x > W || s.y < 0 || s.y > H || t - s.born > 2200) { shots.splice(i, 1); continue; }
        if (!s.mine) continue;                         // only our own shots can score for us

        let done = false;
        for (let j = aliens.length - 1; j >= 0 && !done; j--) {
          if (Math.hypot(aliens[j].x - s.x, aliens[j].y - s.y) < ALIEN_R + SHOT_R) {
            boom(aliens[j].x, aliens[j].y, '#7BC62D');
            aliens.splice(j, 1);
            setTimeout(() => { if (running) spawnAlien(); }, 2500);
            self.score += ALIEN_POINTS;
            if (opts.onScore) opts.onScore(self.score);
            done = true;
          }
        }
        if (done) { shots.splice(i, 1); continue; }

        others.forEach((o, id) => {
          if (done || !o.alive) return;
          if (o.team && o.team === self.team) return;   // never your own team
          if (Math.hypot(o.x - s.x, o.y - s.y) < PLAYER_R + SHOT_R) {
            send('hit', { id: meId, to: id });          // they decide whether it landed
            boom(s.x, s.y, '#FFC53D');
            done = true;
          }
        });
        if (done) shots.splice(i, 1);
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94;
        if (t - p.born > 620) sparks.splice(i, 1);
      }

      others.forEach((o, id) => { if (t - o.at > 6000) others.delete(id); });

      if (!watching && t - lastSend > 1000 / SEND_HZ) {
        lastSend = t;
        send('move', { id: meId, x: Math.round(self.x), y: Math.round(self.y),
                       a: +self.angle.toFixed(2), alive: self.alive, team: self.team,
                       name: self.name, avatar: self.avatar, score: self.score });
      }
      if (!watching && opts.onSave && t - lastSave > SAVE_MS) {
        lastSave = t; opts.onSave(self.score);
      }
    }

    /* ── drawing: a real camera, not a floor plan ─────────
     *
     * The arena is still simulated flat — x and y on the ground, which is what
     * makes hit detection honest and cheap. What changed is the view: instead of
     * looking straight down at a diagram, there is a camera standing above and
     * behind, tilted at the floor, and every point is put through a perspective
     * projection before it is drawn.
     *
     * That means one thing above all: things further away are smaller and higher
     * up the screen. Everything else follows from it — figures that stand up off
     * the floor and cast a shadow onto it, walls with lit tops and dark sides,
     * beams that travel at chest height rather than scraping the ground, and a
     * floor grid that converges towards a horizon.
     *
     * No library and no WebGL: it is about forty lines of arithmetic on the 2D
     * canvas that was already here, so it still works with the wifi unplugged and
     * on a school laptop with no graphics driver worth the name.
     */
    const TILT = 0.86;                    // how far the camera leans over, radians
    const FOCAL = 900;                    // lens: bigger is flatter, smaller is wider
    const EYE = 620;                      // how high the camera stands
    const NEAR = 60;                      // anything closer than this is behind us
    const BODY_H = 84;                    // how tall a player stands, in arena units
    const sinT = Math.sin(TILT), cosT = Math.cos(TILT);

    let cam = { x: W / 2, y: H / 2, scale: 1, cx: 0, cy: 0 };

    /* The camera stands at (cam.x, cam.y, EYE) and looks along −y, tilted TILT
       below the horizontal. Everything below is that one idea written out:
         forward = (0, −cos, −sin)   right = (1, 0, 0)   up = (0, sin, −cos)
       so for a point ahead of the camera by ey and below it by ez,
         depth = ey·cos + ez·sin      (into the screen)
         rise  = ey·sin − ez·cos      (up the screen)
       and both x and rise shrink by FOCAL/depth, which is the whole of
       perspective: further away is smaller and nearer the horizon. */
    function raw(x, y, z) {
      const ey = cam.y - y;
      const ez = EYE - z;
      const depth = ey * cosT + ez * sinT;
      if (depth < NEAR) return null;
      const k = FOCAL / depth;
      return { rx: (x - cam.x) * k, ry: (ey * sinT - ez * cosT) * k, k, depth };
    }

    /** The same point, in pixels on this canvas. */
    function project(x, y, z) {
      const r = raw(x, y, z);
      if (!r) return null;
      return { x: cam.cx + r.rx * cam.scale, y: cam.cy - r.ry * cam.scale,
               k: r.k * cam.scale, depth: r.depth };
    }

    /* Where the camera stands, and how much of what it sees fits on this screen.
       The board holds the whole floor: the four corners are projected and the
       result is scaled to fit, so the arena fills the space it is given whatever
       shape that space is. A phone rides behind its own player instead. */
    function fit() {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      if (watching) {
        cam.x = W / 2; cam.y = H + 780;
        const corners = [raw(0, 0, 0), raw(W, 0, 0), raw(W, H, 0), raw(0, H, 0),
                         raw(0, 0, 120), raw(W, 0, 120)].filter(Boolean);
        if (corners.length) {
          const xs = corners.map(c => c.rx), ys = corners.map(c => c.ry);
          const spanX = Math.max(...xs) - Math.min(...xs) || 1;
          const spanY = Math.max(...ys) - Math.min(...ys) || 1;
          cam.scale = Math.min(w * 0.97 / spanX, h * 0.94 / spanY);
          cam.cx = w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * cam.scale;
          cam.cy = h / 2 + ((Math.max(...ys) + Math.min(...ys)) / 2) * cam.scale;
        } else {
          cam.scale = 1; cam.cx = w / 2; cam.cy = h / 2;
        }
      } else {
        // the camera rides a fixed distance behind this player, and the scale is
        // worked out from that distance so the same amount of arena is in view on
        // any phone: about VIEW units across at the player's own depth
        const BEHIND = 560, VIEW = 950;
        cam.x = self.x; cam.y = self.y + BEHIND;
        const depth = BEHIND * cosT + EYE * sinT;
        cam.scale = w / (VIEW * (FOCAL / depth));
        cam.cx = w / 2;
        cam.cy = h * 0.62;                     // the player low, the arena ahead
      }
      return cam;
    }

    /** Where a screen point lands on the floor of the arena: project(), inverted
        for z = 0, so aiming with a finger still means what it looks like. */
    function toArena(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      const dpr = canvas.width / box.width;
      const u = ((clientX - box.left) * dpr - cam.cx) / cam.scale;
      const v = (cam.cy - (clientY - box.top) * dpr) / cam.scale;
      // v = (ey·sin − EYE·cos)·FOCAL / (ey·cos + EYE·sin), solved for ey
      const denom = FOCAL * sinT - v * cosT;
      const ey = Math.abs(denom) < 1e-6 ? 1e6
               : EYE * (FOCAL * cosT + v * sinT) / denom;
      const depth = ey * cosT + EYE * sinT;
      return { x: cam.x + u * depth / FOCAL, y: cam.y - ey };
    }

    /* One standing figure: a shadow on the floor, a body between the floor and its
       own height, and a face on the front of it. Sizes come from the projection, so
       somebody at the far end of the arena is genuinely smaller. */
    function body(x, y, angle, colour, alive, label, isSelf, avatar) {
      const foot = project(x, y, 0);
      const head = project(x, y, BODY_H);
      if (!foot || !head) return;
      const r = PLAYER_R * foot.k;
      const tall = Math.max(6, foot.y - head.y);

      ctx.save();
      ctx.globalAlpha = alive ? 1 : 0.3;

      // the shadow is what puts a figure on the floor rather than in front of it
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, r * 1.05, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();

      // the barrel, lying along the floor in the direction of aim
      const reach = project(x + Math.cos(angle) * 52, y + Math.sin(angle) * 52, BODY_H * 0.55);
      if (reach) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = Math.max(2, 7 * foot.k);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(head.x, head.y + tall * 0.42);
        ctx.lineTo(reach.x, reach.y);
        ctx.stroke();
      }

      // the body, shaded down one side so it reads as round under a light
      const shade = ctx.createLinearGradient(head.x - r, 0, head.x + r, 0);
      shade.addColorStop(0, colour);
      shade.addColorStop(0.55, colour);
      shade.addColorStop(1, 'rgba(0,0,0,.45)');
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.roundRect(head.x - r * 0.82, head.y, r * 1.64, tall, r * 0.7);
      ctx.fill();
      ctx.fillStyle = shade;
      ctx.globalAlpha *= 0.5;
      ctx.beginPath();
      ctx.roundRect(head.x - r * 0.82, head.y, r * 1.64, tall, r * 0.7);
      ctx.fill();
      ctx.globalAlpha = alive ? 1 : 0.3;

      // a lit top, because the light is above
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.beginPath();
      ctx.ellipse(head.x, head.y + r * 0.16, r * 0.82, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // eyes, high on the body and facing out of the screen
      const eye = Math.max(1.6, r * 0.2);
      ctx.fillStyle = 'rgba(10,6,22,.85)';
      ctx.beginPath();
      ctx.arc(head.x - r * 0.34, head.y + tall * 0.3, eye, 0, Math.PI * 2);
      ctx.arc(head.x + r * 0.34, head.y + tall * 0.3, eye, 0, Math.PI * 2);
      ctx.fill();

      if (isSelf) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1.5, 3 * foot.k);
        ctx.beginPath();
        ctx.ellipse(foot.x, foot.y, r * 1.3, r * 0.52, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (label) {
        const size = Math.max(9, 22 * foot.k);
        ctx.font = `700 ${size}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        const w = ctx.measureText(label).width + size * 0.8;
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.beginPath();
        ctx.roundRect(head.x - w / 2, head.y - size * 1.7, w, size * 1.35, size * 0.7);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, head.x, head.y - size * 0.68);
      }
      ctx.restore();
    }

    const teamColour = (team) => team === 'blue' ? '#4F6BFF' : '#F4364C';

    /* The floor, drawn as a real plane: dim ground stretching away outside the
       arena, the lit floor inside it, a grid whose lines converge, and a wall all
       the way round with a lit top and a darker inside face. The ground outside
       matters — without it the space beyond the wall reads as "not drawn" rather
       than as somewhere you are not allowed to go. */
    const WALL = 130;

    function quad(a, b, c, d, fill) {
      if (!a || !b || !c || !d) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }

    /* Where the floor would vanish if it went on for ever. Everything above this
       line on the screen is sky, everything below it is ground — which is how the
       world gets an edge without drawing a quad the size of a county. */
    function horizon() {
      return cam.cy - FOCAL * (sinT / cosT) * cam.scale;
    }

    function drawFloor() {
      const hz = horizon();
      const h = canvas.height;
      // the ground, out to wherever the screen ends
      ctx.fillStyle = '#0B0818';
      ctx.fillRect(0, Math.max(0, hz), canvas.width, h);
      // and a little light along the horizon, so the two meet rather than butt
      if (hz > -60 && hz < h + 60) {
        const glow = ctx.createLinearGradient(0, hz - 70, 0, hz + 40);
        glow.addColorStop(0, 'rgba(124,77,255,0)');
        glow.addColorStop(0.6, 'rgba(124,77,255,.22)');
        glow.addColorStop(1, 'rgba(124,77,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, hz - 70, canvas.width, 110);
      }

      const fl = project(0, 0, 0), fr = project(W, 0, 0);
      const nr = project(W, H, 0), nl = project(0, H, 0);
      if (fl && fr && nr && nl) {
        ctx.beginPath();
        ctx.moveTo(fl.x, fl.y); ctx.lineTo(fr.x, fr.y);
        ctx.lineTo(nr.x, nr.y); ctx.lineTo(nl.x, nl.y);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, fl.y, 0, nr.y);
        g.addColorStop(0, '#2A2350');
        g.addColorStop(1, '#100C24');
        ctx.fillStyle = g;
        ctx.fill();
      }

      ctx.strokeStyle = 'rgba(255,255,255,.07)';
      ctx.lineWidth = 1.5;
      for (let x = 0; x <= W; x += 200) {
        const a = project(x, 0, 0), b = project(x, H, 0);
        if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      for (let y = 0; y <= H; y += 200) {
        const a = project(0, y, 0), b = project(W, y, 0);
        if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }

      /* The four walls. Each is a quad from the floor up to WALL, drawn with the
         face towards the middle of the arena lit a little and a bright strip along
         the top, which is what makes it read as an edge rather than a stripe. */
      const sides = [
        [[0, 0], [W, 0]],        // far
        [[W, 0], [W, H]],        // right
        [[W, H], [0, H]],        // near
        [[0, H], [0, 0]]         // left
      ];
      sides.forEach(([[ax, ay], [bx, by]], i) => {
        const a = project(ax, ay, 0), b = project(bx, by, 0);
        const c = project(bx, by, WALL), d = project(ax, ay, WALL);
        quad(a, b, c, d, i === 0 ? 'rgba(124,77,255,.22)' : 'rgba(124,77,255,.13)');
        if (c && d) {
          ctx.strokeStyle = 'rgba(170,150,255,.55)';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(c.x, c.y); ctx.stroke();
        }
      });
    }

    function draw() {
      fit();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // the sky above the far wall, so the arena has a horizon to sit under
      const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
      sky.addColorStop(0, '#0A0716');
      sky.addColorStop(0.45, '#160F2E');
      sky.addColorStop(1, '#07040F');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      drawFloor();

      /* Everything that stands on the floor is collected first and drawn far to
         near, which is the whole trick to making one flat canvas look solid: a
         figure in front must be painted over the one behind it. */
      const solids = [];

      capsules.forEach(c => {
        const bob = Math.sin((now() - c.born) / 320) * 6;
        const p = project(c.x, c.y, 26 + bob);
        const foot = project(c.x, c.y, 0);
        if (!p || !foot) return;
        solids.push({ depth: p.depth, paint: () => {
          const kind = POWERS[c.kind];
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,.35)';
          ctx.beginPath();
          ctx.ellipse(foot.x, foot.y, 17 * foot.k, 7 * foot.k, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowColor = kind.colour; ctx.shadowBlur = 26 * p.k;
          ctx.fillStyle = kind.colour;
          ctx.beginPath();
          ctx.roundRect(p.x - 17 * p.k, p.y - 22 * p.k, 34 * p.k, 44 * p.k, 17 * p.k);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(255,255,255,.85)';
          ctx.beginPath();
          ctx.roundRect(p.x - 11 * p.k, p.y - 16 * p.k, 22 * p.k, 12 * p.k, 6 * p.k);
          ctx.fill();
          ctx.restore();
        } });
      });

      aliens.forEach(a => {
        const p = project(a.x, a.y, 30);
        const foot = project(a.x, a.y, 0);
        if (!p || !foot) return;
        solids.push({ depth: p.depth, paint: () => {
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,.35)';
          ctx.beginPath();
          ctx.ellipse(foot.x, foot.y, ALIEN_R * foot.k, ALIEN_R * 0.4 * foot.k, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#7BC62D';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, ALIEN_R * p.k, ALIEN_R * 0.82 * p.k, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.25)';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y - ALIEN_R * 0.3 * p.k, ALIEN_R * 0.7 * p.k, ALIEN_R * 0.3 * p.k, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.9)';
          ctx.beginPath();
          ctx.arc(p.x - 7 * p.k, p.y - 3 * p.k, 4.4 * p.k, 0, Math.PI * 2);
          ctx.arc(p.x + 7 * p.k, p.y - 3 * p.k, 4.4 * p.k, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1b1330';
          ctx.beginPath();
          ctx.arc(p.x - 7 * p.k, p.y - 3 * p.k, 2.2 * p.k, 0, Math.PI * 2);
          ctx.arc(p.x + 7 * p.k, p.y - 3 * p.k, 2.2 * p.k, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } });
      });

      // beams travel at chest height and leave a bright trail behind them
      shots.forEach(sh => {
        const head = project(sh.x, sh.y, BODY_H * 0.55);
        const tail = project(sh.x - sh.dx * 34, sh.y - sh.dy * 34, BODY_H * 0.55);
        if (!head || !tail) return;
        solids.push({ depth: head.depth, paint: () => {
          ctx.save();
          ctx.strokeStyle = sh.team === 'blue' ? '#8FA6FF' : '#FF8A7A';
          ctx.shadowColor = ctx.strokeStyle;
          ctx.shadowBlur = 18 * head.k;
          ctx.lineWidth = Math.max(1.5, 7 * head.k);
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(head.x, head.y); ctx.lineTo(tail.x, tail.y); ctx.stroke();
          ctx.restore();
        } });
      });

      others.forEach(o => {
        const p = project(o.x, o.y, 0);
        if (!p) return;
        solids.push({ depth: p.depth, paint: () =>
          body(o.x, o.y, o.a || 0, teamColour(o.team), o.alive !== false, o.name, false, o.avatar) });
      });

      if (!watching) {
        const p = project(self.x, self.y, 0);
        if (p) solids.push({ depth: p.depth, paint: () => {
          body(self.x, self.y, self.angle, teamColour(self.team), self.alive, '', true, self.avatar);
          if (self.shield) {
            const mid = project(self.x, self.y, BODY_H * 0.5);
            if (mid) {
              ctx.save();
              ctx.strokeStyle = '#12BE8E';
              ctx.lineWidth = Math.max(1.5, 4 * mid.k);
              ctx.shadowColor = '#12BE8E'; ctx.shadowBlur = 20 * mid.k;
              ctx.beginPath();
              ctx.ellipse(mid.x, mid.y, (PLAYER_R + 15) * mid.k, (PLAYER_R + 22) * mid.k, 0, 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
            }
          }
        } });
      }

      sparks.forEach(sp => {
        const p = project(sp.x, sp.y, 40);
        if (!p) return;
        solids.push({ depth: p.depth, paint: () => {
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - (now() - sp.born) / 620);
          ctx.fillStyle = sp.colour;
          ctx.shadowColor = sp.colour; ctx.shadowBlur = 12 * p.k;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, 5 * p.k), 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        } });
      });

      solids.sort((a, b) => b.depth - a.depth);
      solids.forEach(item => item.paint());
    }

    function frame() {
      if (!running) return;
      const t = now();
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      step(dt);
      draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      heard,
      fire,
      stick,
      get energy() { return self.energy; },
      get score() { return self.score; },
      get alive() { return self.alive; },
      get power() { return self.power ? POWERS[self.power].label : (self.shield ? 'Force field' : ''); },
      get playerCount() { return others.size + (watching ? 0 : 1); },
      /** Back in after a question: full bar, fresh position. */
      revive() {
        self.alive = true; self.energy = 100; self.shield = false; self.power = '';
        self.x = rand(200, W - 200); self.y = rand(200, H - 200);
      },
      stop() {
        running = false;
        window.removeEventListener('keydown', keyDown);
        window.removeEventListener('keyup', keyUp);
        if (!watching) send('gone', { id: meId });
      }
    };
  }

  global.NovaArena = { start, POWERS, ALIEN_POINTS, PLAYER_POINTS, ENERGY_SECONDS };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaArena;
