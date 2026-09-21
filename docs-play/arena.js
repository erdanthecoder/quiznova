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
  const PLAYER_R = 26, BOT_R = 24, SHOT_R = 7;
  const BOT_WALK = 130, BOT_RUN = 300;     // units a second, strolling and bolting
  const SPEED = 340, SHOT_SPEED = 780;   // units per second
  const ENERGY_SECONDS = 20;             // a full bar, spent just by being alive
  const SHOT_COST = 3;                   // per shot, as a percentage of the bar
  const FIRE_GAP = 260;                  // milliseconds between shots
  const BOT_POINTS = 10, PLAYER_POINTS = 100;
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

  /* What each superpower looks like.
   *
   * They were six identical pills in six colours, which asks a child to learn a
   * colour code in the middle of a firefight. Every one carries its own mark
   * now — drawn, not written, because a word at that size on a phone is a
   * smudge. Chevrons go faster, dots come in threes, the fan spreads, the bolt
   * is speed, the shield is a shield, and the one you cannot know is a
   * question mark. */
  function glyph(ctx, kind, cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(r / 10, r / 10);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2.4;
    if (kind === 'rapid') {
      [-5, 0, 5].forEach(dx => {
        ctx.beginPath();
        ctx.moveTo(dx - 2.6, -5); ctx.lineTo(dx + 1.4, 0); ctx.lineTo(dx - 2.6, 5);
        ctx.stroke();
      });
    } else if (kind === 'triple') {
      [-5.6, 0, 5.6].forEach(dx => {
        ctx.beginPath(); ctx.arc(dx, 0, 2.5, 0, Math.PI * 2); ctx.fill();
      });
    } else if (kind === 'spread') {
      [-0.6, 0, 0.6].forEach(a => {
        ctx.beginPath();
        ctx.moveTo(0, 6);
        ctx.lineTo(Math.sin(a) * 13, 6 - Math.cos(a) * 13);
        ctx.stroke();
      });
    } else if (kind === 'speed') {
      ctx.beginPath();
      ctx.moveTo(2.5, -8); ctx.lineTo(-4.5, 1); ctx.lineTo(0, 1);
      ctx.lineTo(-2.5, 8); ctx.lineTo(4.5, -1); ctx.lineTo(0, -1);
      ctx.closePath(); ctx.fill();
    } else if (kind === 'shield') {
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(7, -4.5); ctx.lineTo(7, 1.5);
      ctx.quadraticCurveTo(7, 6.5, 0, 8.5);
      ctx.quadraticCurveTo(-7, 6.5, -7, 1.5);
      ctx.lineTo(-7, -4.5); ctx.closePath();
      ctx.stroke();
    } else {
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, -3, 4, Math.PI, Math.PI * 2.25);
      ctx.lineTo(0, 2.5);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 7, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

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

  /* How each map is painted.
   *
   * A real laser tag arena is a dark room under blacklight with bold neon
   * shapes painted over every surface, and that is what these are: a dark
   * floor, bright paint on it, chunky walls with a thick outline and a lighter
   * cap. `line` is the outline every solid shape gets — one dark colour per
   * map, so the whole arena reads as having been drawn by one hand. */
  const LOOK = {
    arena: {
      floor: '#120A2E', floor2: '#231553',
      carpet: ['#00E5FF', '#FF2FB0', '#FFC53D', '#7C4DFF'],
      wall: '#7C4DFF', wallLow: '#4C3390', wallLip: '#B79BFF',
      line: '#0A0520', trim: '#00E5FF', pattern: 'triangles'
    },
    bunker: {
      floor: '#1D1810', floor2: '#332C1C',
      carpet: ['#FFB020', '#12BE8E', '#FF6B3D', '#FFE08A'],
      wall: '#A3926F', wallLow: '#6E6148', wallLip: '#E4D3A6',
      line: '#120E06', trim: '#FFB020', pattern: 'stripes'
    },
    moon: {
      floor: '#0C1426', floor2: '#18233C',
      carpet: ['#38E0C0', '#4F8BFF', '#C6D1E8', '#8E7BFF'],
      wall: '#C6D1E8', wallLow: '#7C88A4', wallLip: '#FFFFFF',
      line: '#050A15', trim: '#38E0C0', pattern: 'hex'
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
  /* `pick` is where the randomness comes from. Left alone it is this device's
     own luck, which is right for a bot wandering off somewhere; the superpowers
     hand in a seeded one instead, so that every phone in the room puts them in
     the same place. */
  function freeSpot(cover, margin, r, pick) {
    const rnd = pick || Math.random;
    for (let tries = 0; tries < 60; tries++) {
      const x = margin + rnd() * (W - margin * 2);
      const y = margin + rnd() * (H - margin * 2);
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

    /* The superpowers have to be the same superpowers for everybody.
     *
     * They used to be three capsules per device, each in a place that device
     * picked at random, so every child was running around a maze collecting
     * things nobody else could see and missing things that were, to them, not
     * there. From the classroom it looks exactly like what was reported: the
     * power-ups never show up. So their kind and their place now come from the
     * game's own pin — the one thing every device in the room agrees on — and
     * picking one up is broadcast, so it goes for everybody at once.
     *
     * A maze this size also swallows three of anything. There are eight. */
    const CAPSULES = 8;
    const seedOf = (text) => {
      let n = 2166136261;
      for (const ch of String(text || 'quoldek')) {
        n = (n ^ ch.charCodeAt(0)) >>> 0;
        n = (n * 16777619) >>> 0;
      }
      return n || 1;
    };
    /** The same numbers on every phone, given the same pin and the same index. */
    function seededSpot(room, index) {
      let n = (seedOf(room) + index * 2654435761) >>> 0;
      const next = () => {
        n = (n * 1103515245 + 12345) & 0x7fffffff;
        return n / 0x7fffffff;
      };
      return { pick: next };
    }

    const self = {
      id: meId, name: opts.me ? opts.me.name : '', avatar: opts.me ? opts.me.avatar : 0,
      team: opts.me ? opts.me.team : 'red',
      ...freeSpot(cover, 200, PLAYER_R),
      angle: 0,
      alive: !watching, energy: 100, score: 0, power: '', powerUntil: 0, shield: false
    };
    const others = new Map();            // id -> last state heard, with a timestamp
    const shots = [];
    const bots = [];
    const capsules = [];
    const sparks = [];
    const rings = [];          // the burst where a superpower was picked up
    const ghosts = [];         // afterimages, left behind while you are fast
    let running = true, last = now(), lastSend = 0, lastSave = 0, lastFire = 0;
    const keys = new Set();
    let stickX = 0, stickY = 0, pointer = null;

    /* ── the arena's own furniture ─────────────────────── */
    /* The wandering blooks.
     *
     * These were green blobs with two eyes — the one thing in a Blooket-shaped
     * game that was not a blook. They are blooks now: the same characters
     * children pick in the lobby, loose in the maze, wearing a ring so you can
     * tell at a glance who is a bot and who is somebody's phone.
     *
     * They walk to somewhere rather than bouncing like billiard balls, and they
     * bolt when a shot goes past, which is the difference between a target and
     * something worth chasing round a corner. */
    const spawnBot = () => {
      const home = freeSpot(cover, 120, BOT_R);
      bots.push({
        id: 'a' + Math.random().toString(36).slice(2, 7),
        x: home.x, y: home.y,
        avatar: Math.floor(Math.random() * (global.Sprite ? Sprite.COMBINATIONS : 60)),
        angle: rand(0, Math.PI * 2), bob: rand(0, 6.28),
        ...botTarget(), spooked: 0, hp: 1
      });
    };
    const botTarget = () => {
      const t = freeSpot(cover, 90, BOT_R);
      return { tx: t.x, ty: t.y };
    };
    /* One capsule, the same on every device in the room. `gen` counts how many
       times this slot has been refilled, so a slot that was taken comes back
       somewhere every device agrees on rather than somewhere only this one
       knows about. */
    const room = opts.room || opts.pin || 'quoldek';
    const kinds = REAL_POWERS.concat('mystery');
    function capsuleAt(slot, gen) {
      const r = seededSpot(room + ':' + slot, gen);
      const kind = kinds[Math.floor(r.pick() * kinds.length)];
      /* freeSpot keeps it out of the walls; it is handed the same two numbers
         on every device, so it lands in the same place for all of them. */
      const spot = freeSpot(cover, 140, 22, r.pick);
      return { id: slot + ':' + gen, slot, gen, kind, x: spot.x, y: spot.y, born: now() };
    }
    const spawnCapsule = (slot, gen) => capsules.push(capsuleAt(slot, gen));
    for (let i = 0; i < 8; i++) spawnBot();
    for (let i = 0; i < CAPSULES; i++) spawnCapsule(i, 0);

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
      } else if (event === 'grab') {
        // somebody beat us to one: it goes here too, and comes back in the same
        // place at the same time, because every device works it out the same way
        const at = capsules.findIndex(c => c.id === data.capsule);
        if (at >= 0) {
          const c = capsules[at];
          rings.push({ x: c.x, y: c.y, born: now(), colour: POWERS[c.kind] ? POWERS[c.kind].colour : '#fff' });
          capsules.splice(at, 1);
        }
        takeCapsule(data.slot, data.gen);
      } else if (event === 'gone') {
        others.delete(data.id);
      }
    }

    /** A slot that was emptied fills again, in six seconds, in a place every
        device works out for itself and therefore agrees on. */
    const filling = new Set();
    function takeCapsule(slot, gen) {
      const key = slot + ':' + gen;
      if (filling.has(key)) return;
      filling.add(key);
      setTimeout(() => {
        filling.delete(key);
        if (!running) return;
        if (capsules.some(c => c.slot === slot)) return;   // already back
        capsules.push(capsuleAt(slot, gen + 1));
      }, 6000);
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
            rings.push({ x: c.x, y: c.y, born: t, colour: POWERS[kind].colour });
            /* Say what it was. A power that changes how you shoot without ever
               naming itself is a bug as far as a child is concerned. */
            if (opts.onPower) opts.onPower(POWERS[kind].label, POWERS[kind].colour, kind);
            capsules.splice(i, 1);
            // it is gone for everybody, and comes back where everybody can see
            send('grab', { id: meId, capsule: c.id, slot: c.slot, gen: c.gen });
            takeCapsule(c.slot, c.gen);
          }
        });
      }

      bots.forEach(a => {
        const dx = a.tx - a.x, dy = a.ty - a.y;
        const far = Math.hypot(dx, dy);
        if (far < 40) Object.assign(a, botTarget());
        const hurry = t < a.spooked ? BOT_RUN : BOT_WALK;
        a.angle = Math.atan2(dy, dx);
        const nx = a.x + (dx / (far || 1)) * hurry * dt;
        const ny = a.y + (dy / (far || 1)) * hurry * dt;
        // a wall means pick somewhere else to be, not bounce off it for ever
        let stuck = true;
        if (!blocked(cover, nx, a.y, BOT_R)) { a.x = clamp(nx, BOT_R, W - BOT_R); stuck = false; }
        if (!blocked(cover, a.x, ny, BOT_R)) { a.y = clamp(ny, BOT_R, H - BOT_R); stuck = false; }
        if (stuck) Object.assign(a, botTarget());
      });

      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.x += s.dx * SHOT_SPEED * dt; s.y += s.dy * SHOT_SPEED * dt;
        if (s.x < 0 || s.x > W || s.y < 0 || s.y > H || t - s.born > 2200) { shots.splice(i, 1); continue; }
        // a shot that meets cover stops there: no shooting through walls
        if (blocked(cover, s.x, s.y, SHOT_R)) { boom(s.x, s.y, '#8C86A6'); shots.splice(i, 1); continue; }
        if (!s.mine) continue;                         // only our own shots can score for us

        let done = false;
        for (let j = bots.length - 1; j >= 0 && !done; j--) {
          const near = Math.hypot(bots[j].x - s.x, bots[j].y - s.y);
          if (near < BOT_R * 4 && near >= BOT_R + SHOT_R) {
            bots[j].spooked = t + 1800;               // a near miss sends it running
            Object.assign(bots[j], botTarget());
          }
          if (near < BOT_R + SHOT_R) {
            boom(bots[j].x, bots[j].y, global.Sprite ? Sprite.colourFor(bots[j].avatar) : '#7BC62D');
            bots.splice(j, 1);
            setTimeout(() => { if (running) spawnBot(); }, 2500);
            self.score += BOT_POINTS;
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

      for (let i = rings.length - 1; i >= 0; i--) if (t - rings[i].born > 640) rings.splice(i, 1);
      for (let i = ghosts.length - 1; i >= 0; i--) if (t - ghosts[i].born > 420) ghosts.splice(i, 1);
      if (self.alive && self.power === 'speed' && t - (self.lastGhost || 0) > 70) {
        self.lastGhost = t;
        ghosts.push({ x: self.x, y: self.y, a: self.angle, born: t,
                      team: self.team, avatar: self.avatar });
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
                       name: self.name, avatar: self.avatar, score: self.score,
                       power: self.power, shield: self.shield });
      }
      if (!watching && opts.onSave && t - lastSave > SAVE_MS) {
        lastSave = t; opts.onSave(self.score);
      }
    }

    /* ── drawing: straight down at the arena ──────────────
     *
     * This was a tilted camera with a perspective projection, a lit back wall
     * and figures standing up off the floor. It was handsome and it was the
     * wrong game. Blooket's Laser Tag is flat and top-down — you look straight
     * down at an arcade floor and see the whole corner you are fighting in —
     * and every hour spent making the tilted version prettier was an hour spent
     * making something that was never going to feel like it.
     *
     * So: orthographic, from directly above. What follows from that is most of
     * why it plays better. Nothing is ever hidden behind a wall you cannot see
     * past, because you are above the walls. Nothing is ever the wrong size
     * because it is far away. There is no horizon, so there is no void beyond
     * the arena to paper over. And a blook is drawn as a blook — the whole
     * character, face on, the size it is on the leaderboard — rather than as a
     * coloured capsule with a face pasted on the front of it.
     *
     * Cover still stops a shot; it does not stop you seeing. That is the normal
     * bargain in a top-down arena and it is what makes corners worth taking.
     */
    /* How much arena fits across a phone. Smaller means closer in, and closer
       in is the whole difference between blooks you can recognise and coloured
       specks: at 1080 a character was thirty pixels across. */
    const VIEW = 640;

    let cam = { x: W / 2, y: H / 2, scale: 1, cx: 0, cy: 0 };

    /* World to screen. `z` is a small lift towards the viewer — it does not make
       anything smaller, it just floats a beam or an orb a little off the floor
       so it reads as above it rather than painted on it. */
    function project(x, y, z) {
      return { x: cam.cx + (x - cam.x) * cam.scale,
               y: cam.cy + (y - cam.y) * cam.scale - (z || 0) * cam.scale * 0.22,
               k: cam.scale, depth: y };
    }

    function fit() {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      cam.cx = w / 2; cam.cy = h / 2;

      if (watching) {
        // the board shows the whole arena, with a margin for the wall
        cam.scale = Math.min(w / (W + 90), h / (H + 90));
        cam.x = W / 2; cam.y = H / 2;
      } else {
        /* A phone follows its own player, but stops at the edges of the arena
           rather than walking off them: half a screen of nothing outside the
           wall is half a screen wasted. */
        cam.scale = w / VIEW;
        const halfW = w / 2 / cam.scale, halfH = h / 2 / cam.scale;
        cam.x = halfW * 2 >= W ? W / 2 : clamp(self.x, halfW, W - halfW);
        cam.y = halfH * 2 >= H ? H / 2 : clamp(self.y, halfH, H - halfH);
      }
      return cam;
    }

    /** Where a screen point lands on the floor: project(), the other way round. */
    function toArena(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      const dpr = canvas.width / box.width;
      return { x: cam.x + ((clientX - box.left) * dpr - cam.cx) / cam.scale,
               y: cam.y + ((clientY - box.top) * dpr - cam.cy) / cam.scale };
    }

    const teamColour = (team) => team === 'blue' ? '#4F6BFF' : '#F4364C';

    /* The house style, and the reason the whole thing hangs together: a thick
       dark outline round every solid shape, a flat bright fill inside it, and a
       soft shadow under it. It is how the rest of Quoldek is drawn and it is how
       Blooket is drawn, and a game that is drawn like the site it lives on stops
       looking like a different program that opened on top of it. */
    function outlined(path, fill, lw, shadow) {
      ctx.save();
      if (shadow) {
        ctx.shadowColor = 'rgba(0,0,0,.45)';
        ctx.shadowBlur = 14 * cam.scale;
        ctx.shadowOffsetY = 5 * cam.scale;
      }
      ctx.fillStyle = fill;
      path(); ctx.fill();
      ctx.restore();
      if (lw > 0) {
        ctx.strokeStyle = look.line;
        ctx.lineWidth = lw;
        ctx.lineJoin = 'round';
        path(); ctx.stroke();
      }
    }

    /* ── the floor ────────────────────────────────────────
     *
     * "Arcade floor textures similar to a real Laser Tag" is exactly what a
     * laser tag arena has: a dark floor under blacklight with bold neon shapes
     * painted all over it. Each map's shapes are laid out once from a fixed
     * seed, so the arena is the same room every time you play it rather than a
     * different one each frame. */
    let carpet = null;

    function buildCarpet() {
      let seed = 20260919;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const out = [];
      const n = look.pattern === 'stripes' ? 44 : 66;
      for (let i = 0; i < n; i++) {
        /* Painted over a wider area than the arena itself. On a board wider
           than the arena is, the space outside the barrier used to be flat
           black — a hole beside the room rather than the rest of the room. */
        out.push({
          x: -520 + rnd() * (W + 1040), y: -520 + rnd() * (H + 1040),
          s: 50 + rnd() * 90,
          a: Math.floor(rnd() * 8) * (Math.PI / 4),   // snapped, so the paint is tidy
          c: look.carpet[Math.floor(rnd() * look.carpet.length)],
          o: 0.07 + rnd() * 0.12
        });
      }
      return out;
    }

    function drawFloor() {
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = look.floor;
      ctx.fillRect(0, 0, w, h);

      // the arena's own floor, a shade lighter than whatever is outside it
      const a = project(0, 0, 0), b = project(W, H, 0);
      ctx.fillStyle = look.floor2;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);

      // the painted shapes, inside the arena and on out past it
      if (!carpet) carpet = buildCarpet();
      ctx.save();
      carpet.forEach(m => {
        const p = project(m.x, m.y, 0);
        const s = m.s * cam.scale;
        if (p.x < -s * 2 || p.x > w + s * 2 || p.y < -s * 2 || p.y > h + s * 2) return;
        ctx.save();
        ctx.globalAlpha = m.o;
        ctx.fillStyle = m.c;
        ctx.translate(p.x, p.y);
        ctx.rotate(m.a);
        if (look.pattern === 'stripes') {
          ctx.fillRect(-s, -s * 0.16, s * 2, s * 0.32);
        } else if (look.pattern === 'hex') {
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const t = (i / 6) * Math.PI * 2;
            ctx[i ? 'lineTo' : 'moveTo'](Math.cos(t) * s * 0.6, Math.sin(t) * s * 0.6);
          }
          ctx.closePath(); ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(0, -s * 0.6); ctx.lineTo(s * 0.55, s * 0.45); ctx.lineTo(-s * 0.55, s * 0.45);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      });

      // a grid over the paint, so distance is readable while you run
      ctx.globalAlpha = 0.10;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.4;
      for (let x = 200; x < W; x += 200) {
        const p = project(x, 0, 0), q = project(x, H, 0);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      for (let y = 200; y < H; y += 200) {
        const p = project(0, y, 0), q = project(W, y, 0);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      floorMarks();

      /* The barrier. It was the same near-black as everything else, so on a
         screen taller than the arena the play area just faded out into a void
         with no edge. It is a lit wall now — which is what the edge of a laser
         tag arena actually looks like from above, and what stops the outside
         reading as more floor you could have walked on. */
      const lw = Math.max(4, 14 * cam.scale);
      ctx.save();
      ctx.strokeStyle = look.wall;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.roundRect(a.x - lw / 2, a.y - lw / 2,
                    (b.x - a.x) + lw, (b.y - a.y) + lw, 26 * cam.scale);
      ctx.stroke();
      ctx.strokeStyle = look.trim;
      ctx.lineWidth = Math.max(2, 4 * cam.scale);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(a.x, a.y, b.x - a.x, b.y - a.y, 22 * cam.scale);
      ctx.stroke();
      ctx.restore();
    }

    /** A shape on the floor, given in arena units. */
    function floorRing(cx, cy, r, fill, stroke, lw) {
      const p = project(cx, cy, 0);
      const rr = r * cam.scale;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke; ctx.lineWidth = lw || Math.max(2, 5 * cam.scale);
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.stroke();
      }
    }

    function floorMarks() {
      ctx.save();

      // the two ends the teams start from
      [[150, '#F4364C'], [W - 150, '#4F6BFF']].forEach(([cx, colour]) => {
        ctx.globalAlpha = 0.22; floorRing(cx, H / 2, 135, colour, null);
        ctx.globalAlpha = 0.9;  floorRing(cx, H / 2, 135, null, colour, Math.max(3, 7 * cam.scale));
        ctx.globalAlpha = 0.7;  floorRing(cx, H / 2, 74, null, colour, Math.max(2, 4 * cam.scale));
        ctx.globalAlpha = 1;
      });

      // and the middle, which is what both ends are running at
      ctx.globalAlpha = 0.55;
      floorRing(W / 2, H / 2, 250, null, look.trim, Math.max(2, 5 * cam.scale));
      ctx.globalAlpha = 0.28;
      floorRing(W / 2, H / 2, 210, null, look.trim, Math.max(2, 3 * cam.scale));
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    /* ── the walls ────────────────────────────────────────
     *
     * Chunky blocks with a dark outline and a shadow under them, and a lighter
     * cap inset inside so the eye reads a top and a side. A head-high wall is
     * drawn solid; a chest-high one is drawn paler with a dashed cap, because
     * from above the only way to say "you can shoot over this one" is to say
     * it in the drawing. */
    function drawWalls() {
      const lw = Math.max(2, 5 * cam.scale);
      cover.forEach(bk => {
        const a = project(bk.x, bk.y, 0);
        const wpx = bk.w * cam.scale, hpx = bk.h * cam.scale;
        if (a.x > canvas.width || a.y > canvas.height ||
            a.x + wpx < 0 || a.y + hpx < 0) return;
        const low = bk.t === 'low';
        const r = Math.min(wpx, hpx) * 0.28;
        outlined(() => {
          ctx.beginPath(); ctx.roundRect(a.x, a.y, wpx, hpx, r);
        }, low ? look.wallLow : look.wall, lw, true);

        // the cap: a lighter panel inset, which is what gives it thickness
        const inset = Math.min(wpx, hpx) * 0.22;
        if (wpx > inset * 2.4 && hpx > inset * 2.4) {
          ctx.save();
          ctx.globalAlpha = low ? 0.5 : 0.85;
          ctx.fillStyle = look.wallLip;
          ctx.beginPath();
          ctx.roundRect(a.x + inset, a.y + inset, wpx - inset * 2, hpx - inset * 2,
                        Math.max(2, r * 0.6));
          ctx.fill();
          ctx.restore();
        }

        // a neon strip down the long side, the arena's own colour
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = look.trim;
        const thin = Math.max(2, 4 * cam.scale);
        if (bk.w > bk.h) ctx.fillRect(a.x + r, a.y + hpx - thin * 1.8, wpx - r * 2, thin);
        else ctx.fillRect(a.x + wpx - thin * 1.8, a.y + r, thin, hpx - r * 2);
        ctx.restore();
      });
    }

    /* The mark of a superpower, floating over whoever is holding one, so a
       classmate suddenly firing three beams at once reads as somebody who got
       to the orb first rather than as the game cheating. */
    function aura(x, y, kind) {
      if (!kind || !POWERS[kind]) return;
      const p = project(x, y, 0);
      const R = Math.max(7, 15 * cam.scale);
      const up = (PLAYER_R + 30) * cam.scale;
      const beat = 0.86 + Math.sin(now() / 220) * 0.14;
      ctx.save();
      ctx.shadowColor = POWERS[kind].colour;
      ctx.shadowBlur = 16 * cam.scale;
      ctx.fillStyle = POWERS[kind].colour;
      ctx.beginPath(); ctx.arc(p.x, p.y - up, R * beat, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = look.line; ctx.lineWidth = Math.max(1.5, 2.6 * cam.scale);
      ctx.beginPath(); ctx.arc(p.x, p.y - up, R * beat, 0, Math.PI * 2); ctx.stroke();
      glyph(ctx, kind, p.x, p.y - up, R * 0.6);
      ctx.restore();
    }

    /* ── one blook ────────────────────────────────────────
     *
     * Face on, the whole character, the size it is on the leaderboard. A ring
     * under it in its team's colour, a blaster pointing wherever it is aiming,
     * and its name over the top. A player used to be a coloured capsule with a
     * face stuck on the front, which is a thing you draw when the camera is
     * looking at the front of something. Nothing is looking at the front of
     * anything now. */
    function body(x, y, angle, colour, alive, label, isSelf, avatar, wild) {
      const p = project(x, y, 0);
      const R = PLAYER_R * cam.scale;
      if (p.x < -R * 6 || p.x > canvas.width + R * 6 ||
          p.y < -R * 6 || p.y > canvas.height + R * 6) return;

      ctx.save();
      ctx.globalAlpha = alive ? 1 : 0.32;

      // the shadow, offset the same way everything else's is
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + R * 0.34, R * 1.02, R * 0.88, 0, 0, Math.PI * 2);
      ctx.fill();

      // the ring: whose side this one is on, or dashed for a wild blook
      ctx.strokeStyle = wild ? 'rgba(255,255,255,.62)' : colour;
      ctx.lineWidth = Math.max(2, 5 * cam.scale);
      if (wild) ctx.setLineDash([R * 0.5, R * 0.42]);
      ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.24, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);

      // the blaster, pointing where they are aiming
      if (!wild) {
        const gl = R * 1.9, gw = Math.max(3, 8 * cam.scale);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);
        ctx.fillStyle = colour;
        ctx.strokeStyle = look.line;
        ctx.lineWidth = Math.max(1.5, 2.6 * cam.scale);
        ctx.beginPath();
        ctx.roundRect(R * 0.5, -gw / 2, gl, gw, gw / 2);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }

      /* The blook. Until its picture has finished loading a plain disc in its
         own colour stands in, so nobody ever sees a gap. */
      const face = blookFace(avatar);
      if (face && face.ready) {
        const size = R * 2.6;
        ctx.drawImage(face.canvas, p.x - size / 2, p.y - size / 2, size, size);
      } else {
        ctx.fillStyle = colour;
        ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = look.line;
        ctx.lineWidth = Math.max(1.5, 3 * cam.scale);
        ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
      }

      // your own player gets a white ring, so you never lose yourself in a crowd
      if (isSelf) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(2, 4 * cam.scale);
        ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.55, 0, Math.PI * 2); ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // the name, on a pill in their team's colour
      if (label) {
        const size = Math.max(9, 17 * cam.scale);
        ctx.font = `800 ${size}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(label).width + size * 0.9;
        const th = size * 1.5;
        const ty = p.y - R * 1.9 - th / 2;
        ctx.fillStyle = colour;
        ctx.strokeStyle = look.line;
        ctx.lineWidth = Math.max(1.5, 2.6 * cam.scale);
        ctx.beginPath();
        ctx.roundRect(p.x - tw / 2, ty - th / 2, tw, th, th / 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(label, p.x, ty + size * 0.04);
      }
      ctx.restore();
    }

    function draw() {
      fit();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawFloor();
      drawWalls();

      /* Everything that moves, painted down the screen: a blook lower down is
         nearer the bottom of the picture and goes over one above it, which is
         the only overlap rule a top-down view needs. */
      const solids = [];

      /* The superpowers, waiting to be picked up. A flat disc with a thick
         outline and its own mark on it — the same drawing the chip on your
         phone carries, so the thing you ran for and the thing you are holding
         look like the same thing. */
      capsules.forEach(c => {
        const age = now() - c.born;
        const beat = 1 + Math.sin(age / 340) * 0.07;
        const p = project(c.x, c.y, 0);
        const kind = POWERS[c.kind];
        const R = 22 * cam.scale * beat;
        solids.push({ depth: c.y - 1, paint: () => {
          ctx.save();
          // a halo on the floor, so it is visible from the far end of a corridor
          const halo = ctx.createRadialGradient(p.x, p.y, R * 0.4, p.x, p.y, R * 3);
          halo.addColorStop(0, kind.colour);
          halo.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = halo;
          ctx.beginPath(); ctx.arc(p.x, p.y, R * 3, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;

          // a ring turning round it
          ctx.strokeStyle = kind.colour;
          ctx.lineWidth = Math.max(1.5, 3 * cam.scale);
          ctx.setLineDash([R * 0.7, R * 0.5]);
          ctx.lineDashOffset = -age / 24;
          ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.6, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = kind.colour;
          ctx.strokeStyle = look.line;
          ctx.lineWidth = Math.max(2, 4 * cam.scale);
          ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
          glyph(ctx, c.kind, p.x, p.y, R * 0.62);
          ctx.restore();
        } });
      });

      // the ring a superpower leaves when somebody takes it
      rings.forEach(r => {
        const age = (now() - r.born) / 640;
        if (age > 1) return;
        const p = project(r.x, r.y, 0);
        solids.push({ depth: r.y - 2, paint: () => {
          ctx.save();
          ctx.globalAlpha = (1 - age) * 0.9;
          ctx.strokeStyle = r.colour;
          ctx.lineWidth = Math.max(2, 9 * cam.scale * (1 - age));
          ctx.beginPath(); ctx.arc(p.x, p.y, 150 * age * cam.scale, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } });
      });

      // the trail you leave while the speed boost is on you
      ghosts.forEach(g => {
        const age = (now() - g.born) / 420;
        if (age > 1) return;
        solids.push({ depth: g.y - 3, paint: () =>
          body(g.x, g.y, g.a, teamColour(g.team), false, '', false, g.avatar, true) });
      });

      // the wandering blooks
      bots.forEach(a => {
        solids.push({ depth: a.y, paint: () => {
          body(a.x, a.y, a.angle,
               global.Sprite ? Sprite.colourFor(a.avatar) : '#7BC62D',
               true, '', false, a.avatar, true);
        } });
      });

      others.forEach(o => {
        solids.push({ depth: o.y, paint: () => {
          body(o.x, o.y, o.a || 0, teamColour(o.team), o.alive !== false, o.name, false, o.avatar);
          if (o.alive !== false && (o.power || o.shield)) {
            aura(o.x, o.y, o.shield ? 'shield' : o.power);
          }
        } });
      });

      if (!watching) {
        solids.push({ depth: self.y + 0.5, paint: () => {
          body(self.x, self.y, self.angle, teamColour(self.team), self.alive,
               '', true, self.avatar);
          if (self.alive && self.power) aura(self.x, self.y, self.power);
          if (self.shield) {
            const p = project(self.x, self.y, 0);
            ctx.save();
            ctx.strokeStyle = '#12BE8E';
            ctx.lineWidth = Math.max(2, 5 * cam.scale);
            ctx.shadowColor = '#12BE8E'; ctx.shadowBlur = 18 * cam.scale;
            ctx.beginPath();
            ctx.arc(p.x, p.y, (PLAYER_R + 18) * cam.scale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
        } });
      }

      // beams: a bright bolt with a trail, over everything, because a shot in
      // flight is the thing you most need to see
      shots.forEach(sh => {
        const head = project(sh.x, sh.y, 0);
        const tail = project(sh.x - sh.dx * 46, sh.y - sh.dy * 46, 0);
        solids.push({ depth: 1e8, paint: () => {
          ctx.save();
          const c = sh.team === 'blue' ? '#8FB4FF' : '#FF9484';
          ctx.strokeStyle = c;
          ctx.shadowColor = c;
          ctx.shadowBlur = 16 * cam.scale;
          ctx.lineWidth = Math.max(2, 8 * cam.scale);
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(head.x, head.y); ctx.lineTo(tail.x, tail.y); ctx.stroke();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = Math.max(1, 3 * cam.scale);
          ctx.beginPath(); ctx.moveTo(head.x, head.y); ctx.lineTo(tail.x, tail.y); ctx.stroke();
          ctx.restore();
        } });
      });

      sparks.forEach(sp => {
        const p = project(sp.x, sp.y, 0);
        solids.push({ depth: 1e8 + 1, paint: () => {
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - (now() - sp.born) / 620);
          ctx.fillStyle = sp.colour;
          ctx.shadowColor = sp.colour; ctx.shadowBlur = 10 * cam.scale;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, 6 * cam.scale), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } });
      });

      solids.sort((a, b) => a.depth - b.depth);
      solids.forEach(item => item.paint());

      if (!watching) miniMap();
    }

    /* A plan of the whole arena in the corner. From above you can see the
       corner you are in, but not the far end, and knowing where everybody else
       is is half of deciding where to go next. */
    function miniMap() {
      const pad = Math.round(canvas.width * 0.03);
      const mw = Math.min(canvas.width * 0.30, 260);
      const mh = mw * (H / W);
      const ox = canvas.width - mw - pad, oy = pad;
      const s = mw / W;
      const at = (x, y) => ({ x: ox + x * s, y: oy + y * s });

      ctx.save();
      ctx.fillStyle = 'rgba(8,5,20,.72)';
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(ox - 6, oy - 6, mw + 12, mh + 12, 10);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = look.wallLip;
      cover.forEach(b => {
        ctx.globalAlpha = b.t === 'low' ? 0.42 : 0.8;
        ctx.fillRect(ox + b.x * s, oy + b.y * s, b.w * s, b.h * s);
      });

      ctx.globalAlpha = 0.95;
      capsules.forEach(c => {
        const p = at(c.x, c.y);
        ctx.fillStyle = POWERS[c.kind].colour;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2); ctx.fill();
      });
      others.forEach(o => {
        if (o.alive === false) return;
        const p = at(o.x, o.y);
        ctx.fillStyle = teamColour(o.team);
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.8, 0, Math.PI * 2); ctx.fill();
      });

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
      get powerKind() { return self.power || (self.shield ? 'shield' : ''); },
      /* Nought to one, how much of the power is left. A shield has no clock —
         it lasts until it is spent — so it reads as full the whole time. */
      get powerLeft() {
        if (self.power && POWERS[self.power].life) {
          return clamp((self.powerUntil - now()) / POWERS[self.power].life, 0, 1);
        }
        return self.shield ? 1 : 0;
      },
      get playerCount() { return others.size + (watching ? 0 : 1); },
      /* Put the player somewhere, point them, and read it back. Only the tests
         use these; the game never moves anybody from outside. */
      place(x, y) { self.x = x; self.y = y; },
      /** What is on the floor right now. The tests use it to check that two
          phones in one game are looking at the same superpowers. */
      capsules() { return capsules.map(c => ({ id: c.id, kind: c.kind, x: c.x, y: c.y })); },
      face(a) { self.angle = a; pointer = null; },
      where() { return { x: self.x, y: self.y }; },
      shotCount() { return shots.length; },
      botCount() { return bots.length; },
      botsAt() { return bots.map(b => ({ x: b.x, y: b.y, avatar: b.avatar })); },
      /** Where an arena point lands on the screen. Only the tests use it. */
      toScreen(x, y) { const p = project(x, y, 0); return { x: p.x, y: p.y }; },
      /** Hand this player a superpower. Tests and the shots in the docs use it;
          in a real round the only way to one is to go and stand on it. */
      grant(kind) {
        if (!POWERS[kind]) return false;
        if (kind === 'shield') self.shield = true;
        else { self.power = kind; self.powerUntil = now() + POWERS[kind].life; }
        if (opts.onPower) opts.onPower(POWERS[kind].label, POWERS[kind].colour, kind);
        return true;
      },
      /** Drop a superpower on the floor at a given spot, for the same reason. */
      drop(kind, x, y) {
        capsules.push({ kind, x, y, born: now() });
      },
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
    s.push('<rect width="' + W + '" height="' + H + '" fill="' + look.floor2 + '"/>');
    s.push('<g stroke="#fff" stroke-width="3" opacity=".10">');
    for (let x = 200; x < W; x += 200) s.push('<path d="M' + x + ' 0V' + H + '"/>');
    for (let y = 200; y < H; y += 200) s.push('<path d="M0 ' + y + 'H' + W + '"/>');
    s.push('</g>');
    s.push('<circle cx="' + (W / 2) + '" cy="' + (H / 2) + '" r="250" fill="none" stroke="' +
           look.trim + '" stroke-width="8" opacity=".45"/>');
    coverFor(id).forEach(b => {
      const fill = b.t === 'low' ? look.wallLow : look.wall;
      s.push('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h +
             '" rx="14" fill="' + fill + '" stroke="' + look.line + '" stroke-width="8"/>');
    });
    // the two ends the teams start from
    s.push('<circle cx="150" cy="' + (H / 2) + '" r="60" fill="#F4364C"/>');
    s.push('<circle cx="' + (W - 150) + '" cy="' + (H / 2) + '" r="60" fill="#4F6BFF"/>');
    s.push('<rect x="8" y="8" width="' + (W - 16) + '" height="' + (H - 16) +
           '" rx="26" fill="none" stroke="' + look.line + '" stroke-width="16"/>');
    s.push('</svg>');
    return s.join('');
  }


  global.NovaArena = { start, POWERS, BOT_POINTS, ALIEN_POINTS: BOT_POINTS,
                       PLAYER_POINTS, ENERGY_SECONDS,
                       COVER, coverFor, freeSpot, lookFor, HALVES, plan,
                       faceReady: (a) => { const f = faces.get(String(a || 0)); return !!(f && f.ready); } };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaArena;
