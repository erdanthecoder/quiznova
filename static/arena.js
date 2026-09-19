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

  /* ── the maps ─────────────────────────────────────────────
   *
   * Blooket's arena has "barriers for cover", and the first version of this took
   * that literally: seven boxes on an empty floor. That is not an arena. A real
   * laser tag arena is a maze — corridors you run down, corners you cut, dead
   * ends somebody is waiting in, a bunker in the middle everybody wants. You
   * should never be able to see the whole room from where you are standing.
   *
   * So each map is a labyrinth of about thirty walls. They are authored as half
   * a plan and then turned a half turn about the centre: rotational symmetry,
   * the way competitive arenas are really laid out, so that in team mode the two
   * ends are the same shape and neither side is handed the better ground.
   *
   * Boxes are top-left corner plus size, in arena units. `t` is what it is
   * made of, which decides how tall it stands and how it is painted:
   *   wall  head height, you cannot see over it
   *   low   chest height, you can shoot over it but not walk through it
   */
  const HALVES = {
    /* Neon labyrinth: the tightest of the three. A long west spine, a room in
       the north, a dogleg in every corner, and a four-gap bunker in the middle. */
    arena: [
      { x: 170, y: 170, w: 55, h: 400 },
      { x: 170, y: 515, w: 300, h: 55 },
      { x: 390, y: 170, w: 390, h: 55 },
      { x: 390, y: 225, w: 55, h: 165 },
      { x: 620, y: 280, w: 55, h: 220, t: 'low' },
      { x: 0,   y: 330, w: 55,  h: 55 },
      { x: 0,   y: 720, w: 300, h: 55 },
      { x: 245, y: 775, w: 55, h: 160 },
      { x: 420, y: 660, w: 55, h: 250 },
      { x: 420, y: 660, w: 230, h: 55, t: 'low' },
      { x: 770, y: 120, w: 55, h: 210 },
      { x: 540, y: 420, w: 80, h: 80, t: 'low' },
      { x: 150, y: 620, w: 80, h: 80, t: 'low' },
      { x: 690, y: 420, w: 220, h: 45 },
      { x: 690, y: 465, w: 45,  h: 60 }
    ],
    /* Bunker: long straight corridors with doorways, fought down lanes rather
       than across corners, with sandbag lines you can shoot over. */
    bunker: [
      { x: 260, y: 0,   w: 55, h: 330 },
      { x: 260, y: 430, w: 55, h: 300 },
      { x: 315, y: 430, w: 240, h: 55 },
      { x: 560, y: 120, w: 55, h: 340 },
      { x: 615, y: 120, w: 260, h: 55 },
      { x: 0,   y: 480, w: 200, h: 55, t: 'low' },
      { x: 380, y: 800, w: 420, h: 55 },
      { x: 700, y: 560, w: 55, h: 300 },
      { x: 100, y: 660, w: 55, h: 250 },
      { x: 880, y: 250, w: 200, h: 55, t: 'low' },
      { x: 420, y: 250, w: 90,  h: 90, t: 'low' },
      { x: 950, y: 60,  w: 55, h: 200 }
    ],
    /* Moon base: station modules round the edge and a clear landing pad in the
       middle. The most open of the three, and the one with the longest shots. */
    moon: [
      { x: 150,  y: 260, w: 300, h: 55 },
      { x: 150,  y: 315, w: 55,  h: 200 },
      { x: 520,  y: 140, w: 55,  h: 260 },
      { x: 575,  y: 140, w: 200, h: 55, t: 'low' },
      { x: 0,    y: 620, w: 260, h: 55 },
      { x: 330,  y: 620, w: 55,  h: 280 },
      { x: 385,  y: 845, w: 300, h: 55, t: 'low' },
      { x: 860,  y: 190, w: 90,  h: 90, t: 'low' },
      { x: 1180, y: 300, w: 55,  h: 180 },
      { x: 640,  y: 430, w: 90,  h: 90, t: 'low' }
    ]
  };

  /** A half plan, plus the same plan turned a half turn about the centre. */
  function mirrored(half) {
    const out = [], seen = new Set();
    const add = (b) => {
      const key = [b.x, b.y, b.w, b.h].join(',');
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ x: b.x, y: b.y, w: b.w, h: b.h, t: b.t || 'wall' });
    };
    half.forEach(b => {
      add(b);
      add({ x: W - b.x - b.w, y: H - b.y - b.h, w: b.w, h: b.h, t: b.t });
    });
    return out;
  }

  const COVER = {
    arena: mirrored(HALVES.arena),
    bunker: mirrored(HALVES.bunker),
    moon: mirrored(HALVES.moon)
  };

  /* How each map is painted. The three were the same purple room with the
     furniture moved; they are three different places now. */
  const LOOK = {
    arena: {
      sky: ['#0A0716', '#1A1038', '#07040F'],
      floor: ['#2B1E5C', '#110B28'], grid: 'rgba(150,120,255,.16)', grid2: 130,
      top: '#7C5FE6', face: '#3A2570', side: '#4E3499',
      edge: 'rgba(200,170,255,.85)', trim: '#00E5FF',
      wall: 'rgba(124,77,255,.20)', rim: 'rgba(180,150,255,.6)',
      haze: 'rgba(124,77,255,.22)', scene: 'neon'
    },
    bunker: {
      sky: ['#0D0C0A', '#241E16', '#0A0908'],
      floor: ['#4A4235', '#1C1813'], grid: 'rgba(255,225,170,.10)', grid2: 200,
      top: '#A3926F', face: '#50452F', side: '#6B5C3F',
      edge: 'rgba(255,230,170,.7)', trim: '#FFB020',
      wall: 'rgba(180,150,90,.18)', rim: 'rgba(255,220,150,.5)',
      haze: 'rgba(255,170,60,.16)', scene: 'hangar'
    },
    moon: {
      sky: ['#01030C', '#060D22', '#01020A'],
      floor: ['#3E4763', '#14192B'], grid: 'rgba(190,220,255,.12)', grid2: 160,
      top: '#C6D1E8', face: '#3C4560', side: '#525D7C',
      edge: 'rgba(235,245,255,.85)', trim: '#38E0C0',
      wall: 'rgba(120,160,220,.16)', rim: 'rgba(200,225,255,.55)',
      haze: 'rgba(90,150,255,.18)', scene: 'space'
    }
  };
  const coverFor = (map) => COVER[map] || COVER.arena;
  const lookFor = (map) => LOOK[map] || LOOK.arena;

  /** Does a circle at (x, y) overlap this box? */
  function inBox(b, x, y, r) {
    const nx = Math.max(b.x, Math.min(x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(y, b.y + b.h));
    return (nx - x) * (nx - x) + (ny - y) * (ny - y) < r * r;
  }
  const blocked = (cover, x, y, r) => cover.some(b => inBox(b, x, y, r));

  /** Somewhere in the arena that is not inside a block.
   *
   * Sixty random darts find a gap almost every time. When they do not — and in a
   * maze with thirty walls in it, sometimes they do not — the old answer was to
   * give up and use the middle of the arena, which was only ever safe while the
   * middle was empty. It has a bunker in it now. So the fall-back walks a grid
   * and takes the first square that is genuinely clear, and a spawn inside a
   * wall stops being something that happens once in nine hundred.
   *
   * The clearance is r + 18 rather than r + 8. Collision is round and a corner
   * is square, so a spot can clear the circle by a hair and still be tucked
   * inside the corner of the box; 18 is wider than that difference can be. */
  function freeSpot(cover, margin, r) {
    for (let tries = 0; tries < 60; tries++) {
      const x = margin + Math.random() * (W - margin * 2);
      const y = margin + Math.random() * (H - margin * 2);
      if (!blocked(cover, x, y, r + 18)) return { x, y };
    }
    for (let y = margin; y <= H - margin; y += 40) {
      for (let x = margin; x <= W - margin; x += 40) {
        if (!blocked(cover, x, y, r + 18)) return { x, y };
      }
    }
    return { x: W / 2, y: H / 2 };      // a map with no floor at all; not one of ours
  }

  /* ── the blooks ───────────────────────────────────────────
   *
   * The players were coloured capsules with two dots for eyes. They are the
   * child's own blook now — the same character they picked in the lobby and see
   * on the leaderboard — because being your blook is most of why anybody cares
   * which one they chose.
   *
   * Canvas cannot draw an SVG string, so each face is rasterised once into an
   * offscreen canvas and then stamped. The data URI needs an explicit xmlns:
   * inline HTML infers the SVG namespace, a data URI does not, and without it
   * the image silently never loads.
   */
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
    } catch { /* no Sprite here: the plain body is drawn instead */ }
    return spot;
  }

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
    const cover = coverFor(opts.map);
    const look = lookFor(opts.map);

    const self = {
      id: meId, name: opts.me ? opts.me.name : '', avatar: opts.me ? opts.me.avatar : 0,
      team: opts.me ? opts.me.team : 'red',
      ...freeSpot(cover, 200, PLAYER_R),
      angle: 0,
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
      ...freeSpot(cover, 120, ALIEN_R),
      vx: rand(-70, 70), vy: rand(-70, 70), hp: 1
    });
    const spawnCapsule = () => capsules.push({
      kind: REAL_POWERS.concat('mystery')[Math.floor(Math.random() * 6)],
      ...freeSpot(cover, 140, 22), born: now()
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
          /* One axis at a time, so running into a wall at an angle slides along
             it instead of stopping dead. Stopping dead is what makes cover feel
             like scenery you are fighting rather than scenery you are using. */
          const nx = clamp(self.x + (dx / len) * speed * dt, PLAYER_R, W - PLAYER_R);
          if (!blocked(cover, nx, self.y, PLAYER_R)) self.x = nx;
          const ny = clamp(self.y + (dy / len) * speed * dt, PLAYER_R, H - PLAYER_R);
          if (!blocked(cover, self.x, ny, PLAYER_R)) self.y = ny;
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
        const ax = a.x + a.vx * dt, ay = a.y + a.vy * dt;
        if (blocked(cover, ax, a.y, ALIEN_R)) a.vx *= -1; else a.x = ax;
        if (blocked(cover, a.x, ay, ALIEN_R)) a.vy *= -1; else a.y = ay;
        if (a.x < ALIEN_R || a.x > W - ALIEN_R) a.vx *= -1;
        if (a.y < ALIEN_R || a.y > H - ALIEN_R) a.vy *= -1;
        a.x = clamp(a.x, ALIEN_R, W - ALIEN_R); a.y = clamp(a.y, ALIEN_R, H - ALIEN_R);
      });

      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.x += s.dx * SHOT_SPEED * dt; s.y += s.dy * SHOT_SPEED * dt;
        if (s.x < 0 || s.x > W || s.y < 0 || s.y > H || t - s.born > 2200) { shots.splice(i, 1); continue; }
        // a shot that meets cover stops there: no shooting through walls
        if (blocked(cover, s.x, s.y, SHOT_R)) { boom(s.x, s.y, '#8C86A6'); shots.splice(i, 1); continue; }
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

      /* The blook itself, over the body. Until its picture has finished
         loading the plain shape underneath stands in, so nobody ever sees a
         gap — and a device that cannot rasterise it keeps playing. */
      const face = blookFace(avatar);
      if (face && face.ready) {
        const size = r * 2.1;
        ctx.drawImage(face.canvas, head.x - size / 2, head.y + tall * 0.06 - size * 0.12,
                      size, size);
      } else {
        const eye = Math.max(1.6, r * 0.2);
        ctx.fillStyle = 'rgba(10,6,22,.85)';
        ctx.beginPath();
        ctx.arc(head.x - r * 0.34, head.y + tall * 0.3, eye, 0, Math.PI * 2);
        ctx.arc(head.x + r * 0.34, head.y + tall * 0.3, eye, 0, Math.PI * 2);
        ctx.fill();
      }

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

    /* How tall a piece of cover stands. A wall is over your head, so it breaks
       line of sight completely; a low one is chest height, which you can shoot
       over but not walk through. Having both is what stops a maze reading as one
       endless slab: you can see across half of it and still not walk across. */
    const HEIGHT = { wall: 156, low: 92 };
    const tallOf = (b) => HEIGHT[b.t] || HEIGHT.wall;

    /* The back of the room. A phone held upright was half black above the far
       barrier, and that did not read as a dark hall, it read as a missing one:
       these are indoor arenas and an indoor arena has a wall behind it. So there
       is one, far enough back and tall enough to close the space, with each
       map's own thing hung on it — a lighting rig over the neon maze, girders
       and lamps over the bunker, a window on to the Earth at the moon base. */
    const BACK_Y = -70, BACK_H = 620, BACK_OUT = 700;

    function drawBack() {
      const bl = project(-BACK_OUT, BACK_Y, 0), br = project(W + BACK_OUT, BACK_Y, 0);
      const tr = project(W + BACK_OUT, BACK_Y, BACK_H), tl = project(-BACK_OUT, BACK_Y, BACK_H);
      if (!bl || !br || !tr || !tl) return;
      const top = Math.min(tl.y, tr.y), bot = Math.max(bl.y, br.y);
      const w = canvas.width;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y); ctx.closePath();
      const g = ctx.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, look.sky[0]);
      g.addColorStop(0.55, look.sky[1]);
      g.addColorStop(1, look.sky[2]);
      ctx.fillStyle = g; ctx.fill();
      ctx.clip();
      // scene art is laid out between the top of the wall and its foot
      const hz = bot, y0 = top, span = Math.max(1, bot - top);
      const at = (f) => y0 + span * f;

      if (look.scene === 'space') {
        // a fixed sky: the same stars every time, so it reads as one place
        let seed = 9301;
        const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
        for (let i = 0; i < 160; i++) {
          const x = rnd() * w, y = at(rnd() * 0.82), r = 0.6 + rnd() * 1.6;
          ctx.globalAlpha = 0.25 + rnd() * 0.75;
          ctx.fillStyle = '#EAF2FF';
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // the Earth, low and to one side, lit from the left
        const R = Math.max(40, span * 0.26), cx = w * 0.74, cy = at(0.34);
        const g = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.4, R * 0.1, cx, cy, R);
        g.addColorStop(0, '#6FB5FF'); g.addColorStop(0.55, '#2C64B8');
        g.addColorStop(1, '#07142B');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.5; ctx.fillStyle = '#2E8B57';
        ctx.beginPath(); ctx.ellipse(cx - R * 0.25, cy - R * 0.1, R * 0.4, R * 0.22, 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + R * 0.2, cy + R * 0.35, R * 0.3, R * 0.16, -0.3, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (look.scene === 'hangar') {
        // a corrugated roof of girders, and lamps hanging off it
        ctx.strokeStyle = 'rgba(120,104,78,.55)';
        ctx.lineWidth = Math.max(3, w * 0.006);
        for (let i = 0; i <= 7; i++) {
          const x = (i / 7) * w;
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(w / 2 + (x - w / 2) * 0.62, at(0.9)); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(0, at(0.28)); ctx.lineTo(w, at(0.28)); ctx.stroke();
        for (let i = 0; i < 5; i++) {
          const x = ((i + 0.5) / 5) * w, y = at(0.46);
          ctx.strokeStyle = 'rgba(90,78,58,.8)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, at(0.28)); ctx.lineTo(x, y); ctx.stroke();
          const lamp = ctx.createRadialGradient(x, y, 2, x, y, span * 0.3);
          lamp.addColorStop(0, 'rgba(255,196,96,.85)');
          lamp.addColorStop(1, 'rgba(255,170,60,0)');
          ctx.fillStyle = lamp;
          ctx.beginPath(); ctx.arc(x, y, span * 0.3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#FFD990';
          ctx.beginPath(); ctx.ellipse(x, y, span * 0.04, span * 0.02, 0, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        // a lighting rig: bars of colour running away over the maze
        // steel ribs first, so the bars read as hung off something
        ctx.strokeStyle = 'rgba(120,96,200,.30)';
        ctx.lineWidth = Math.max(2, w * 0.004);
        for (let i = 0; i <= 9; i++) {
          const x = (i / 9) * w;
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, at(0.95)); ctx.stroke();
        }
        const bars = ['#00E5FF', '#FF2FB0', '#7C4DFF', '#00E5FF', '#FFC53D'];
        bars.forEach((c, i) => {
          const y = at(0.10 + i * 0.15);
          const inset = w * (0.02 + i * 0.03);
          const glow = ctx.createLinearGradient(0, y - span * 0.07, 0, y + span * 0.07);
          glow.addColorStop(0, 'rgba(0,0,0,0)');
          glow.addColorStop(0.5, c); glow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.16;
          ctx.fillStyle = glow;
          ctx.fillRect(inset, y - span * 0.07, w - inset * 2, span * 0.14);
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = c;
          ctx.fillRect(inset, y - span * 0.01, w - inset * 2, span * 0.02);
        });
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    function drawFloor() {
      const hz = horizon();
      const h = canvas.height;
      // the ground, out to wherever the screen ends
      ctx.fillStyle = look.sky[2];
      ctx.fillRect(0, Math.max(0, hz), canvas.width, h);
      drawBack();
      // and a little light along the horizon, so the two meet rather than butt
      if (hz > -60 && hz < h + 60) {
        const glow = ctx.createLinearGradient(0, hz - 70, 0, hz + 40);
        glow.addColorStop(0, 'rgba(0,0,0,0)');
        glow.addColorStop(0.6, look.haze);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
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
        g.addColorStop(0, look.floor[0]);
        g.addColorStop(1, look.floor[1]);
        ctx.fillStyle = g;
        ctx.fill();
      }

      ctx.strokeStyle = look.grid;
      ctx.lineWidth = 1.5;
      const step = look.grid2;
      for (let x = 0; x <= W; x += step) {
        const a = project(x, 0, 0), b = project(x, H, 0);
        if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      for (let y = 0; y <= H; y += step) {
        const a = project(0, y, 0), b = project(W, y, 0);
        if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }

      /* The centre of the floor gets a painted ring, because a big empty plane
         with nothing on it reads as a texture rather than as a place. */
      const ring = [];
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        ring.push(project(W / 2 + Math.cos(a) * 250, H / 2 + Math.sin(a) * 250, 0));
      }
      if (ring.every(Boolean)) {
        ctx.strokeStyle = look.trim;
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ring.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      /* The cover. Each block is a box: a top face, and the two sides that face
         the camera, which is enough to read as solid from this angle. Sorted by
         how far away they are so a near block draws over a far one, and given a
         lit strip along its top edge — the one line that says "this is a wall in
         a room somebody built" rather than "this is a grey rectangle". */
      [...cover].sort((p, q) => (q.y + q.h) - (p.y + p.h)).forEach(bk => {
        const BLOCK_H = tallOf(bk);
        const x0 = bk.x, x1 = bk.x + bk.w, y0 = bk.y, y1 = bk.y + bk.h;
        const tl = project(x0, y0, BLOCK_H), tr = project(x1, y0, BLOCK_H);
        const br = project(x1, y1, BLOCK_H), bl = project(x0, y1, BLOCK_H);
        const nfl = project(x0, y1, 0), nfr = project(x1, y1, 0);
        const rt = project(x1, y0, 0);

        // a shadow on the floor first, which is what sits it in the room
        const sa = project(x0, y0, 0), sb = project(x1, y0, 0);
        if (sa && sb && nfl && nfr) {
          ctx.fillStyle = 'rgba(0,0,0,.38)';
          ctx.beginPath();
          ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y);
          ctx.lineTo(nfr.x, nfr.y); ctx.lineTo(nfl.x, nfl.y); ctx.closePath();
          ctx.fill();
        }
        // the near face and the right-hand face, then the lit top over them
        quad(bl, br, nfr, nfl, look.face);
        quad(tr, br, nfr, rt, look.side);
        quad(tl, tr, br, bl, look.top);

        // the painted stripe: chest high on a wall, along the lip of a low one
        if (nfl && nfr && bl && br) {
          const zs = bk.t === 'low' ? 0.78 : 0.56;
          const a = project(x0, y1, BLOCK_H * zs), b = project(x1, y1, BLOCK_H * zs);
          if (a && b) {
            ctx.strokeStyle = look.trim;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = Math.max(2, 7 * (a.k || 1));
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
        if (tl && tr) {
          ctx.strokeStyle = look.edge;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y);
          ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y); ctx.closePath();
          ctx.stroke();
        }
      });

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
        quad(a, b, c, d, look.wall);
        if (c && d) {
          ctx.strokeStyle = look.rim;
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
      sky.addColorStop(0, look.sky[0]);
      sky.addColorStop(0.45, look.sky[1]);
      sky.addColorStop(1, look.sky[2]);
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

      if (!watching) miniMap();
    }

    /* A plan of the arena in the corner. A labyrinth you can only see one
       corridor of is frustrating rather than tense: you need to know there is a
       way round, even if you cannot see it. So the walls are drawn from above,
       with you and everyone near you on them. */
    function miniMap() {
      const pad = Math.round(canvas.width * 0.022);
      const mw = Math.min(canvas.width * 0.30, 260);
      const mh = mw * (H / W);
      const ox = pad, oy = canvas.height - mh - pad;
      const s = mw / W;
      const at = (x, y) => ({ x: ox + x * s, y: oy + y * s });

      ctx.save();
      ctx.globalAlpha = 0.86;
      ctx.fillStyle = 'rgba(6,4,16,.78)';
      ctx.beginPath(); ctx.roundRect(ox - 6, oy - 6, mw + 12, mh + 12, 10); ctx.fill();
      ctx.strokeStyle = look.rim; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(ox - 6, oy - 6, mw + 12, mh + 12, 10); ctx.stroke();

      ctx.fillStyle = look.top;
      cover.forEach(b => {
        ctx.globalAlpha = b.t === 'low' ? 0.45 : 0.85;
        ctx.fillRect(ox + b.x * s, oy + b.y * s, b.w * s, b.h * s);
      });

      ctx.globalAlpha = 0.9;
      capsules.forEach(c => {
        const p = at(c.x, c.y);
        ctx.fillStyle = POWERS[c.kind].colour;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill();
      });

      others.forEach(o => {
        if (o.alive === false) return;
        const p = at(o.x, o.y);
        ctx.fillStyle = teamColour(o.team);
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2); ctx.fill();
      });

      // you, with a wedge for which way you are facing
      const me = at(self.x, self.y);
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(me.x + Math.cos(self.angle) * 9, me.y + Math.sin(self.angle) * 9);
      ctx.lineTo(me.x + Math.cos(self.angle + 2.5) * 6, me.y + Math.sin(self.angle + 2.5) * 6);
      ctx.lineTo(me.x + Math.cos(self.angle - 2.5) * 6, me.y + Math.sin(self.angle - 2.5) * 6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
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
      /* The right thumb: point it and it both aims and fires, which is how a
         twin-stick shooter has worked since arcades and how Blooket's own arena
         plays on a phone. Letting go stops the shooting but keeps the aim. */
      aim(x, y) {
        const len = Math.hypot(x, y);
        if (len > 0.24) {
          self.angle = Math.atan2(y, x);
          pointer = null;                 // the stick outranks the mouse
          fire();
        }
      },
      get energy() { return self.energy; },
      get score() { return self.score; },
      get alive() { return self.alive; },
      get power() { return self.power ? POWERS[self.power].label : (self.shield ? 'Force field' : ''); },
      get playerCount() { return others.size + (watching ? 0 : 1); },
      /* Put the player somewhere, point them, and read it back. Only the tests
         use these; the game never moves anybody from outside. */
      place(x, y) { self.x = x; self.y = y; },
      face(a) { self.angle = a; pointer = null; },
      where() { return { x: self.x, y: self.y }; },
      shotCount() { return shots.length; },
      /** Back in after a question: full bar, fresh position. */
      revive() {
        self.alive = true; self.energy = 100; self.shield = false; self.power = '';
        const spot = freeSpot(cover, 200, PLAYER_R);
        self.x = spot.x; self.y = spot.y;
      },
      stop() {
        running = false;
        window.removeEventListener('keydown', keyDown);
        window.removeEventListener('keyup', keyUp);
        if (!watching) send('gone', { id: meId });
      }
    };
  }

  /* The map as a plan, for the picker. The picture on the button used to be an
     illustration of the place; this is the place. A child choosing between
     three maps should be choosing between three shapes, not three moods. */
  function plan(id, width = 320) {
    const look = lookFor(id);
    const h = Math.round(width / 1.6);
    const s = [];
    s.push('<svg class="scene" viewBox="0 0 ' + W + ' ' + H + '" width="' + width +
           '" height="' + h + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">');
    s.push('<rect width="' + W + '" height="' + H + '" fill="' + look.floor[1] + '"/>');
    s.push('<g stroke="' + look.grid + '" stroke-width="3">');
    for (let x = look.grid2; x < W; x += look.grid2) s.push('<path d="M' + x + ' 0V' + H + '"/>');
    for (let y = look.grid2; y < H; y += look.grid2) s.push('<path d="M0 ' + y + 'H' + W + '"/>');
    s.push('</g>');
    s.push('<circle cx="' + (W / 2) + '" cy="' + (H / 2) + '" r="250" fill="none" stroke="' +
           look.trim + '" stroke-width="6" opacity=".35"/>');
    coverFor(id).forEach(b => {
      s.push('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h +
             '" rx="8" fill="' + look.top + '" opacity="' + (b.t === 'low' ? 0.55 : 1) + '"/>');
    });
    // the two ends the teams start from, so the shape has a direction
    s.push('<circle cx="90" cy="' + (H / 2) + '" r="34" fill="#F4364C"/>');
    s.push('<circle cx="' + (W - 90) + '" cy="' + (H / 2) + '" r="34" fill="#4F6BFF"/>');
    s.push('<rect x="6" y="6" width="' + (W - 12) + '" height="' + (H - 12) +
           '" rx="16" fill="none" stroke="' + look.rim + '" stroke-width="10"/>');
    s.push('</svg>');
    return s.join('');
  }

  global.NovaArena = { start, POWERS, ALIEN_POINTS, PLAYER_POINTS, ENERGY_SECONDS,
                       COVER, coverFor, freeSpot, lookFor, HALVES, plan,
                       faceReady: (a) => { const f = faces.get(String(a || 0)); return !!(f && f.ready); } };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaArena;
