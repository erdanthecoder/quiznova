/* When an update opens, and the moment it does.
 *
 * Why a clock at all
 *   Everything in an update is built and already sitting on the site by the time
 *   this file holds it back. That is a decision rather than a limit: an update a
 *   school meets all at once is an event, and a class that finds Volcano Climb
 *   half an hour before their teacher has heard of it is not.
 *
 * Which clock
 *   The reader's own. A school in one time zone should not be told a school-day
 *   update lands in the middle of their night, and nothing here needs the network
 *   to agree with anybody — the phone in a hall with no wifi opens the new games
 *   at the same moment as the board beside it.
 *
 * What is held back
 *   The new *content* — the games you can pick, the things you can unlock. Never
 *   the rewrites: the settings screen, the 3D, the music, the boards. Those are
 *   not a surprise worth keeping, and hiding a rewrite is how a rewrite ships
 *   untested.
 *
 * There is a list of releases rather than one date, because 3.0 has been and
 * gone and its gate still has to answer honestly for anybody whose clock says
 * otherwise.
 */
(function (global) {
  'use strict';

  const RELEASES = [
    {
      version: '3.0',
      // 5 September 2026, midday, wherever the reader is
      at: new Date(2026, 8, 5, 12, 0, 0),
      modes: ['tug', 'heist', 'cards'],
      show: 'rocket'
    },
    {
      version: '4.0',
      // 6 September 2026, seven in the evening, wherever the reader is
      at: new Date(2026, 8, 6, 19, 0, 0),
      modes: ['volcano', 'factory', 'fishing'],
      // hats past the free few wait for the update as well; the plain ones do not,
      // so nobody opens the hat shelf on the day and finds it locked end to end
      hatsFrom: 4,
      show: 'garden'
    }
  ];

  // the one everything without a version means: 3.0, which is what the pages
  // written before this file learned about a second release are asking about
  const FIRST = RELEASES[0];
  const AT = FIRST.at;

  const now = () => Date.now();
  const stamp = (at) => (at === undefined ? now() : at);

  const find = (version) => RELEASES.find(r => r.version === version) || FIRST;

  /** Is that release open yet? Without a version: 3.0. */
  const live = (version, at) => stamp(at) >= find(version).at.getTime();
  const out = (at) => live(FIRST.version, at);

  /** How long until it is, in milliseconds. Zero once it has landed. */
  const untilVersion = (version, at) => Math.max(0, find(version).at.getTime() - stamp(at));
  const until = (at) => untilVersion(FIRST.version, at);

  /** The next release nobody has seen yet, or null once they are all out. */
  const next = (at) => RELEASES.find(r => stamp(at) < r.at.getTime()) || null;

  /* Everything still behind a gate, at this moment. */
  function heldModes(at) {
    return RELEASES.filter(r => stamp(at) < r.at.getTime())
                   .reduce((all, r) => all.concat(r.modes), []);
  }

  /* A game everybody can play today, or the same list with the unreleased ones
     taken out. Given the whole list so the caller stays the source of truth. */
  function openModes(modes, at) {
    const held = heldModes(at);
    if (!held.length) return modes;
    return (modes || []).filter(m => !held.includes(m && m.id ? m.id : m));
  }

  /** Is this hat available yet? Hats below the gate's index never wait. */
  function hatOpen(index, at) {
    const n = Math.max(0, Math.round(Number(index) || 0));
    return !RELEASES.some(r => r.hatsFrom !== undefined
                            && n >= r.hatsFrom
                            && stamp(at) < r.at.getTime());
  }

  /* ── remembering ──────────────────────────────────────────
   * A browser with storage switched off — private mode, a locked-down school
   * machine — cannot remember that it has seen this. So there is a flag in memory
   * as well, and nothing depends on the stored one having worked: the worst case
   * is a teacher who sees the reveal again tomorrow, not a page that shows it for
   * ever. */
  const SEEN = 'quoldek:launched';
  const watched = new Set();
  function seen(version) {
    const v = version || FIRST.version;
    if (watched.has(v)) return true;
    try { return (global.localStorage.getItem(SEEN) || '').split(',').includes(v); }
    catch { return false; }
  }
  function markSeen(version) {
    const v = version || FIRST.version;
    watched.add(v);
    try {
      const had = (global.localStorage.getItem(SEEN) || '').split(',').filter(Boolean);
      if (!had.includes(v)) had.push(v);
      global.localStorage.setItem(SEEN, had.join(','));
    } catch { /* storage is off */ }
  }

  const NEW_MODES = FIRST.modes;

  const NEW_THINGS = {
    '3.0': [
      { icon: 'rope',  tint: '#F4364C', title: 'Tug of War',
        line: 'Two teams, one rope, and it can come all the way back.' },
      { icon: 'coin',  tint: '#FFC53D', title: 'Gold Heist',
        line: 'Some chests rob the leader. Being in front is dangerous.' },
      { icon: 'cards', tint: '#4F6BFF', title: 'Card Collector',
        line: 'Win a card for every right answer. First to all eight.' },
      { icon: 'medal', tint: '#12BE8E', title: 'Levels and coins',
        line: 'Play to earn coins, and unlock blooks nobody else has.' }
    ],
    '4.0': [
      { icon: 'flame',  tint: '#F4364C', title: 'Volcano Climb',
        line: 'One wall, and the lava rising under everybody at once.' },
      { icon: 'bricks', tint: '#FF7A45', title: 'Factory',
        line: 'Machines pay you every round. Buying early costs you the lead.' },
      { icon: 'drop',   tint: '#2BA8FF', title: 'Fishing Frenzy',
        line: 'The deep gives you nothing four times in seven. And then this.' },
      { icon: 'crown',  tint: '#FFC53D', title: 'Hats',
        line: 'Twelve of them, on forty-eight blooks, all yours to earn.' }
    ]
  };

  global.NovaLaunch = {
    RELEASES, AT, NEW_MODES, NEW_THINGS,
    out, until, live, untilVersion, next, openModes, heldModes, hatOpen,
    seen, markSeen,
    rocket: (opts) => show('rocket', opts),
    garden: (opts) => show('garden', opts),
    /** The reveal that belongs to a release, by name. */
    reveal: (version, opts) => show(find(version).show, Object.assign({ version }, opts))
  };

  /* ══ the reveals ══════════════════════════════════════════
   * Two of them, one per release, sharing a shell: a canvas over the whole page,
   * a word, a row of cards, and a way out.
   */
  function show(which, opts) {
    const options = opts || {};
    const done = options.onDone || function () {};
    if (!global.document) return done();
    if (document.querySelector('.launch')) return done();   // never two at once

    const version = options.version || (which === 'garden' ? '4.0' : '3.0');
    const shell = document.createElement('div');
    shell.className = 'launch launch-' + which;
    shell.innerHTML = '<canvas class="launch-sky"></canvas>'
      + '<div class="launch-word"><span class="up">Quoldek ' + version + '</span></div>'
      + '<div class="launch-cards"></div>'
      + '<button class="launch-skip" type="button">Skip</button>';
    document.body.append(shell);

    const canvas = shell.querySelector('.launch-sky');
    const ctx = canvas.getContext('2d');
    const cardBox = shell.querySelector('.launch-cards');
    let raf = 0, over = false;

    const size = () => {
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
    };
    size();
    global.addEventListener('resize', size);

    const finish = () => {
      if (over) return;
      over = true;
      cancelAnimationFrame(raf);
      global.removeEventListener('resize', size);
      shell.classList.add('going');
      setTimeout(() => { shell.remove(); done(); }, 460);
    };
    shell.querySelector('.launch-skip').onclick = finish;
    shell.onclick = (e) => { if (e.target === shell) finish(); };

    function cards() {
      const list = NEW_THINGS[version] || NEW_THINGS['3.0'];
      cardBox.innerHTML = '';
      list.forEach((thing, i) => {
        const card = document.createElement('div');
        card.className = 'launch-card';
        // never the same gap twice: a row that arrives on a metronome is a row
        // nobody believes grew
        card.style.animationDelay = Math.round(i * 130 + Math.random() * 70) + 'ms';
        const art = global.Sprite ? global.Sprite.icon(thing.icon, 30, thing.tint) : '';
        card.innerHTML = `<span class="ic" style="background:${thing.tint}22">${art}</span>`
          + `<b>${thing.title}</b><span>${thing.line}</span>`;
        cardBox.append(card);
      });
      cardBox.classList.add('on');
    }

    const word = () => shell.querySelector('.launch-word').classList.add('on');

    /* Somebody who has asked their machine to stop moving things gets the end of
     * the story rather than none of it. */
    const still = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      word(); cards();
      setTimeout(finish, 4200);
      return finish;
    }

    const run = which === 'garden' ? growGarden : flyRocket;
    run({ ctx, canvas, shell, word, cards, finish, frame: (fn) => { raf = requestAnimationFrame(fn); } });
    return finish;
  }

  /* ══ 4.0: a garden ════════════════════════════════════════
   *
   * Nothing here is a keyframe. Every plant is grown a step at a time from a
   * seed: it decides where to go next from where it has been, it branches when
   * it feels like it, and it flowers when it has run out of stem. That is the
   * whole trick — a thing that is drawn growing looks alive, and the same shape
   * faded in on a timer looks like a slide.
   *
   * Three things do most of the work:
   *   · smooth noise, so a stem wanders instead of ruling a line;
   *   · a different seed, speed, tilt and colour for every plant, so no two of
   *     them are the same plant twice;
   *   · sway — the whole garden breathes on its own phase, which is what stops
   *     a still frame looking like clip art.
   */

  /* Value noise: random points, smoothly joined. Cheaper than the real thing and
     all that is wanted here — a line that wobbles without corners. */
  function noiseField(n) {
    const pts = Array.from({ length: n }, () => Math.random() * 2 - 1);
    return (t) => {
      const x = ((t % n) + n) % n;
      const i = Math.floor(x), f = x - i;
      const a = pts[i % n], b = pts[(i + 1) % n];
      const s = f * f * (3 - 2 * f);              // smoothstep, so no kinks
      return a + (b - a) * s;
    };
  }

  const PALETTE = ['#F4364C', '#FF7A45', '#FFC53D', '#12BE8E', '#2BA8FF', '#4F6BFF', '#7C4DFF', '#FF5D73'];
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = {
    out: (t) => 1 - Math.pow(1 - t, 3),
    back: (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    soft: (t) => t * t * (3 - 2 * t)
  };

  /* `depth` is 0 for the row at the front and 1 for the ones furthest back.
   * Everything else follows from it: the far ones are thinner, dimmer, cooler
   * and slower, which is the whole of what makes a flat canvas have a distance
   * in it. */
  function makePlant(x, groundY, height, born, depth) {
    const back = depth || 0;
    const hue = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    // leaves alternate sides up the stem, the way a real one does, but never at
    // even spacings — a plant with leaves on a ruler is a diagram
    let side = Math.random() < 0.5 ? -1 : 1;
    const leafCount = 3 + Math.floor(Math.random() * 4);
    const leaves = [];
    let at = rand(0.16, 0.26);
    for (let i = 0; i < leafCount && at < 0.9; i++) {
      leaves.push({ at, side, size: rand(17, 30) * (1 - back * 0.34), tilt: rand(-0.34, 0.34) });
      side = -side;
      at += rand(0.13, 0.24);
    }
    return {
      x, groundY, born, back,
      // the tall ones grow slower, the way tall things do
      speed: rand(0.85, 1.25) * (150 / height),
      lean: rand(-0.16, 0.16),
      wander: noiseField(7 + Math.floor(Math.random() * 5)),
      wobble: rand(0.6, 1.3),
      height,
      thick: rand(7, 12) * (1 - back * 0.42),
      swayPhase: Math.random() * Math.PI * 2,
      swayRate: rand(0.5, 0.95),
      leaves,
      flower: {
        petals: 5 + Math.floor(Math.random() * 4),
        size: rand(22, 36) * (1 - back * 0.38),
        spin: rand(0, Math.PI),
        colour: hue,
        heart: Math.random() < 0.5 ? '#FFD86B' : '#FFF3D6'
      }
    };
  }

  /** The path of a stem, as far as it has grown. Deterministic given the plant. */
  function stemPath(p, upto, sway) {
    const steps = Math.max(2, Math.round(upto * 46));
    const out = [];
    let x = p.x, y = p.groundY, angle = -Math.PI / 2 + p.lean * 0.5;
    for (let i = 0; i <= steps; i++) {
      const t = i / 46;
      /* A stem wanders, but it is going somewhere: the noise is small enough
         that the plant still reads as heading up, and it is pulled gently back
         towards vertical the further it strays. Without that second half they
         curl over and the garden looks like weeds. */
      angle += p.wander(t * p.wobble * 6) * 0.038
             + (-Math.PI / 2 - angle) * 0.019
             + Math.sin(sway + p.swayPhase) * 0.008 * t;
      const len = (p.height / 46) * (1 - t * 0.25);
      x += Math.cos(angle) * len;
      y += Math.sin(angle) * len;
      out.push([x, y, angle, t]);
    }
    return out;
  }

  function growGarden(stage) {
    const { ctx, canvas, word, cards, finish, frame } = stage;
    const started = performance.now();

    const W = () => innerWidth, H = () => innerHeight;
    const groundY = () => H() * 0.92;

    let plants = [];
    let motes = [];
    let pollen = [];
    let seeded = false, worded = false, carded = false, burst = false;

    const SEED = 900;        // the light on the ground, alone
    const GROW = 3600;       // stems climbing and leaves opening
    const BLOOM = 5000;      // flowers
    const POP = 5150;        // pollen off the top of them
    const WORD = 5400;
    const CARDS = 5850;
    const HOLD = 9600;       // and then it lets go

    /* Three rows, back to front. The back one is drawn first and comes up first,
     * so by the time the front row is climbing there is already something behind
     * it — a garden that fills in from the distance rather than all at once.
     *
     * The tall ones reach past where the cards will sit, because a flower with a
     * card over it is a flower nobody sees. */
    function plantOut() {
      const w = W(), h = H();
      plants = [];
      const rows = [
        { depth: 1,   count: Math.max(7, Math.round(w / 118)), tall: [0.30, 0.44], born: [0, 380],    lift: [-30, -14] },
        { depth: 0.5, count: Math.max(5, Math.round(w / 168)), tall: [0.42, 0.60], born: [220, 760],  lift: [-14, 2] },
        { depth: 0,   count: Math.max(4, Math.round(w / 235)), tall: [0.52, 0.72], born: [420, 1150], lift: [2, 20] }
      ];
      for (const row of rows) {
        for (let i = 0; i < row.count; i++) {
          // spread across the width, but never on the grid: a row of evenly
          // spaced stems reads as a fence
          const slot = (i + 0.5) / row.count;
          const x = w * (slot + rand(-0.06, 0.06));
          // the ones towards the middle are tallest, so the word has a garden
          // under it rather than a gap
          const middle = 1 - Math.abs(slot - 0.5) * 1.4;
          const height = h * rand(row.tall[0], row.tall[1]) * (0.74 + middle * 0.42);
          plants.push(makePlant(x, groundY() + rand(row.lift[0], row.lift[1]),
                                height, rand(row.born[0], row.born[1]), row.depth));
        }
      }
      // and a few small ones right at the front, because a garden is not one row
      for (let i = 0; i < 4; i++) {
        plants.push(makePlant(w * rand(0.04, 0.96), groundY() + rand(14, 34),
                              h * rand(0.15, 0.24), rand(600, 1300), 0));
      }
      // furthest away first, so nothing at the back is ever drawn over the front
      plants.sort((a, b) => b.back - a.back);
      seeded = true;
    }

    for (let i = 0; i < 60; i++) {
      motes.push({ x: Math.random(), y: Math.random(), r: rand(0.6, 2.2),
                   drift: rand(-0.04, 0.04), rise: rand(0.02, 0.09),
                   glow: rand(0.15, 0.5), phase: Math.random() * 6.28 });
    }

    function sky(t) {
      const w = W(), h = H();
      // the night warms as the garden comes up, rather than switching on
      const warm = Math.min(1, Math.max(0, (t - SEED) / (BLOOM - SEED)));
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#07040F');
      g.addColorStop(0.55, mix('#0C0820', '#1B1035', warm));
      g.addColorStop(1, mix('#0A0718', '#3A1B2A', warm));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // the light under the soil, which is where all of this came from
      const gy = groundY();
      const seed = ctx.createRadialGradient(w / 2, gy, 0, w / 2, gy, Math.max(w, h) * 0.55);
      const pulse = 0.5 + 0.5 * Math.sin(t / 420);
      const strength = t < SEED ? 0.26 + pulse * 0.3 : 0.30 + warm * 0.34;
      seed.addColorStop(0, `rgba(255,197,61,${strength})`);
      seed.addColorStop(0.35, `rgba(124,77,255,${strength * 0.4})`);
      seed.addColorStop(1, 'rgba(10,7,24,0)');
      ctx.fillStyle = seed;
      ctx.fillRect(0, 0, w, h);
    }

    function ground() {
      const w = W(), gy = groundY();
      const g = ctx.createLinearGradient(0, gy - 26, 0, H());
      g.addColorStop(0, 'rgba(60,28,22,0)');
      g.addColorStop(0.45, 'rgba(52,24,20,.85)');
      g.addColorStop(1, '#1A0C0C');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, gy + 14);
      // an uneven line, because soil is not a ruler
      for (let x = 0; x <= w; x += 26) {
        ctx.lineTo(x, gy + Math.sin(x / 140) * 5 + Math.cos(x / 61) * 3);
      }
      ctx.lineTo(w, H()); ctx.lineTo(0, H());
      ctx.closePath(); ctx.fill();
    }

    function leaf(x, y, angle, size, side, open) {
      if (open <= 0) return;
      const s = size * ease.back(Math.min(1, open));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + side * (0.85 + (1 - open) * 0.7));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      // two curves that are not each other's mirror: a leaf is never symmetric
      ctx.bezierCurveTo(s * 0.5, -s * 0.44, s * 1.02, -s * 0.2, s * 1.28, 0);
      ctx.bezierCurveTo(s * 0.96, s * 0.3, s * 0.42, s * 0.4, 0, 0);
      ctx.fillStyle = '#1D9C6E';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.08, 0);
      ctx.quadraticCurveTo(s * 0.7, -s * 0.08, s * 1.2, 0);
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = Math.max(0.8, s * 0.055);
      ctx.stroke();
      ctx.restore();
    }

    function flower(f, x, y, angle, open, sway) {
      if (open <= 0) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2 + Math.sin(sway) * 0.05);
      ctx.shadowColor = f.colour;
      ctx.shadowBlur = 26 * open;
      for (let i = 0; i < f.petals; i++) {
        // each petal opens a beat after the one before it
        const own = Math.max(0, Math.min(1, open * f.petals - i * 0.55));
        if (own <= 0) continue;
        const s = f.size * ease.back(own);
        const a = f.spin + (i / f.petals) * Math.PI * 2;
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(s * 0.52, -s * 0.42, s * 0.88, -s * 0.5, s * 1.06, -s * 0.06);
        ctx.bezierCurveTo(s * 0.9, s * 0.42, s * 0.36, s * 0.36, 0, 0);
        ctx.fillStyle = f.colour;
        ctx.globalAlpha = 0.92;
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 34 * open;
      ctx.shadowColor = f.heart;
      ctx.beginPath();
      ctx.arc(0, 0, f.size * 0.3 * ease.out(open), 0, Math.PI * 2);
      ctx.fillStyle = f.heart;
      ctx.fill();
      ctx.restore();
    }

    function draw(t) {
      const dpr = canvas.width / innerWidth;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      sky(t);
      if (!seeded && t > SEED * 0.55) plantOut();

      // dust in the light, all the way through
      motes.forEach(m => {
        m.y -= m.rise / H() * 2.2;
        m.x += m.drift / W() * 2.2;
        if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
        const a = m.glow * (0.4 + 0.6 * Math.sin(t / 900 + m.phase));
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = '#FFE9A8';
        ctx.beginPath();
        ctx.arc(m.x * W(), m.y * H(), m.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      ground();

      const sway = t / 1000;
      plants.forEach(p => {
        const age = t - SEED * 0.55 - p.born;
        if (age <= 0) return;
        const grow = Math.min(1, ease.out(Math.min(1, age / (GROW * 0.62) * p.speed)));
        if (grow <= 0.01) return;
        const path = stemPath(p, grow, sway * p.swayRate);

        ctx.globalAlpha = 1 - p.back * 0.55;

        /* The stem is a shape, not a line: thick at the soil and tapering to
           nothing at the tip, with the light down one side of it. A stroke of
           even width is what made the first version look like wire. */
        const half = (i) => (p.thick / 2) * (1 - path[i][3] * 0.78);
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
          const [x, y, a] = path[i];
          const n = a + Math.PI / 2;
          const w = half(i);
          const px = x + Math.cos(n) * w, py = y + Math.sin(n) * w;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        for (let i = path.length - 1; i >= 0; i--) {
          const [x, y, a] = path[i];
          const n = a + Math.PI / 2;
          const w = half(i);
          ctx.lineTo(x - Math.cos(n) * w, y - Math.sin(n) * w);
        }
        ctx.closePath();
        ctx.fillStyle = p.back > 0.5 ? '#0E5B41' : '#1A8A61';
        ctx.fill();
        // one edge catches the light from the horizon
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
          const [x, y, a] = path[i];
          const n = a + Math.PI / 2;
          const w = half(i) * 0.42;
          const px = x + Math.cos(n) * w, py = y + Math.sin(n) * w;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(150,255,205,.3)';
        ctx.lineWidth = Math.max(1, p.thick * 0.22);
        ctx.lineCap = 'round';
        ctx.stroke();

        p.leaves.forEach(l => {
          if (grow < l.at) return;
          const open = Math.min(1, (grow - l.at) / 0.16);
          const at = path[Math.min(path.length - 1, Math.round(l.at * 46))];
          leaf(at[0], at[1], at[2] + l.tilt, l.size, l.side, open);
        });

        if (grow > 0.985) {
          const bloom = Math.min(1, (t - BLOOM + p.born * 0.4) / 700);
          const tip = path[path.length - 1];
          flower(p.flower, tip[0], tip[1], tip[2], Math.max(0, bloom), sway * p.swayRate + p.swayPhase);
          ctx.globalAlpha = 1;
          if (bloom > 0.6 && !p.dropped && t > POP) {
            p.dropped = true;
            for (let i = 0; i < 16; i++) {
              pollen.push({
                x: tip[0] + rand(-8, 8), y: tip[1] + rand(-8, 8),
                vx: rand(-1.1, 1.1), vy: rand(-3.4, -1.1),
                life: 1, fade: rand(0.004, 0.011), r: rand(1.4, 3.6),
                colour: Math.random() < 0.6 ? '#FFD86B' : p.flower.colour
              });
            }
          }
        }
        ctx.globalAlpha = 1;
      });

      // pollen: it rises, it slows, it gives up
      pollen = pollen.filter(s => s.life > 0);
      pollen.forEach(s => {
        s.x += s.vx; s.y += s.vy;
        s.vy += 0.028;                    // it does come back down
        s.vx *= 0.992;
        s.life -= s.fade;
        ctx.globalAlpha = Math.max(0, s.life) * 0.9;
        ctx.fillStyle = s.colour;
        ctx.shadowColor = s.colour;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // the one flash, at the moment the garden is fully out
      if (t > POP && t < POP + 520) {
        const k = 1 - (t - POP) / 520;
        ctx.fillStyle = `rgba(255,233,168,${k * k * 0.22})`;
        ctx.fillRect(0, 0, W(), H());
      }
    }

    function tick(now) {
      const t = now - started;
      draw(t);
      if (!worded && t > WORD) { worded = true; word(); }
      if (!carded && t > CARDS) { carded = true; cards(); }
      if (t > HOLD) return finish();
      frame(tick);
    }
    frame(tick);
  }

  function mix(a, b, t) {
    const hex = (c) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const [ar, ag, ab] = hex(a), [br, bg, bb] = hex(b);
    const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
    return `rgb(${r},${g},${bl})`;
  }

  /* ══ 3.0: the rocket ══════════════════════════════════════
   * Kept because 3.0 happened, and somebody who asks to watch it again should
   * get the thing they were shown rather than this year's one.
   */
  function flyRocket(stage) {
    const { ctx, canvas, word, cards, finish, frame } = stage;
    const started = performance.now();
    let sparks = [], burst = 0;

    const RISE = 1700, HOLD = 2600;

    function drawRocket(x, y, scale, wobble) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.rotate(wobble);
      const flame = 26 + Math.random() * 22;
      const g = ctx.createLinearGradient(0, 30, 0, 30 + flame);
      g.addColorStop(0, '#FFD86B');
      g.addColorStop(0.5, '#FF9A3D');
      g.addColorStop(1, 'rgba(244,54,76,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-13, 28); ctx.quadraticCurveTo(0, 30 + flame, 13, 28);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#F4364C';
      ctx.beginPath();
      ctx.moveTo(-12, 10); ctx.lineTo(-26, 30); ctx.lineTo(-12, 28); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(12, 10); ctx.lineTo(26, 30); ctx.lineTo(12, 28); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#F6F2FF';
      ctx.beginPath();
      ctx.moveTo(0, -44);
      ctx.quadraticCurveTo(15, -16, 14, 28);
      ctx.lineTo(-14, 28);
      ctx.quadraticCurveTo(-15, -16, 0, -44);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#F4364C';
      ctx.beginPath();
      ctx.moveTo(0, -44); ctx.quadraticCurveTo(9, -28, 8, -18);
      ctx.lineTo(-8, -18); ctx.quadraticCurveTo(-9, -28, 0, -44);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2BA8FF';
      ctx.beginPath(); ctx.arc(0, -4, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.arc(-3, -7, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    function explode(x, y) {
      const colours = ['#FFC53D', '#F4364C', '#4F6BFF', '#12BE8E', '#7C4DFF', '#2BA8FF', '#FF7A45'];
      for (let i = 0; i < 190; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 13;
        sparks.push({
          x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 3,
          life: 1, fade: 0.006 + Math.random() * 0.012,
          size: 3 + Math.random() * 6, colour: colours[i % colours.length],
          spin: (Math.random() - 0.5) * 0.4, turn: Math.random() * Math.PI
        });
      }
    }

    function tick(t) {
      const gone = t - started;
      const dpr = canvas.width / innerWidth;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (gone < RISE) {
        const k = gone / RISE;
        const eased = 1 - Math.pow(1 - k, 2.4);
        const y = innerHeight * 1.05 - eased * innerHeight * 0.72;
        const x = innerWidth / 2;
        drawRocket(x, y, Math.min(2.2, innerHeight / 420), Math.sin(gone / 90) * 0.05);
        for (let i = 0; i < 3; i++) {
          sparks.push({ x: x + (Math.random() - 0.5) * 14, y: y + 30,
                        vx: (Math.random() - 0.5) * 1.6, vy: 1 + Math.random() * 2,
                        life: 0.7, fade: 0.03, size: 2 + Math.random() * 4,
                        colour: Math.random() < 0.5 ? '#FFC53D' : '#FF7A45',
                        spin: 0, turn: 0 });
        }
      } else if (!burst) {
        burst = t;
        explode(innerWidth / 2, innerHeight * 0.33);
        word();
        setTimeout(cards, 420);
      }

      sparks = sparks.filter(s => s.life > 0);
      sparks.forEach(s => {
        s.x += s.vx; s.y += s.vy;
        s.vy += 0.16; s.vx *= 0.995;
        s.turn += s.spin; s.life -= s.fade;
        ctx.save();
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.translate(s.x, s.y);
        ctx.rotate(s.turn);
        ctx.fillStyle = s.colour;
        ctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size * 1.6);
        ctx.restore();
      });

      if (burst && t - burst > HOLD) return finish();
      frame(tick);
    }
    frame(tick);
  }
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaLaunch;
