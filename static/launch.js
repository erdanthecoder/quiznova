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
      // 7 September 2026, four in the afternoon, wherever the reader is
      at: new Date(2026, 8, 7, 16, 0, 0),
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
      + '<div class="launch-shot"><b></b><i></i></div>'
      + '<div class="launch-word"><span class="up">Quoldek ' + version + '</span></div>'
      + '<div class="launch-cards"></div>'
      + '<div class="launch-bar-t"></div><div class="launch-bar-b"></div>'
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
      setTimeout(finish, 5200);
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

  /* ── the timeline ─────────────────────────────────────────
   * Twenty-seven seconds, in six shots. Written out as marks rather than buried
   * in the drawing, because the one thing a cutscene must be is *edited* — the
   * cuts have to land on a rhythm, and a rhythm you cannot see written down is a
   * rhythm you cannot fix.
   */
  const T = {
    bars:    0,        // the letterbox closes in
    seed:    500,      // a seed falls out of the dark
    land:    2100,     // and lands
    grow:    2300,     // stems climb
    bloom:   7000,     // the first flowers open
    storm:   9200,     // pollen comes off them
    volcano: 10600,    // cut — one wall, and the lava
    factory: 14600,    // cut — a floor, and what is on it
    fishing: 18800,    // cut — the line goes in
    garden:  23000,    // cut back, wide, in full bloom
    blooks:  23400,    // and they arrive, in hats
    title:   25800,
    cards:   27000,
    out:     30600     // the letterbox opens and it lets go
  };

  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  /** Ease from a to b between two marks. */
  const tween = (t, from, to, a, b, fn) => {
    const k = clamp01((t - from) / Math.max(1, to - from));
    return a + (b - a) * (fn || ease.soft)(k);
  };
  /** 1 while a shot is on screen, with a short fade at each end. */
  const shot = (t, from, to, fade) => {
    const f = fade || 240;
    if (t < from - f || t > to + f) return 0;
    return Math.min(clamp01((t - (from - f)) / f), clamp01((to + f - t) / f));
  };

  function growGarden(stage) {
    const { ctx, canvas, shell, word, cards, finish, frame } = stage;
    const started = performance.now();
    const W = () => innerWidth, H = () => innerHeight;
    const groundY = () => H() * 0.92;

    shell.classList.add('bars');
    const caption = shell.querySelector('.launch-shot');
    const name = caption.querySelector('b'), line = caption.querySelector('i');
    let captioned = '';
    const say = (title, sub) => {
      if (captioned === title) return;
      captioned = title;
      if (!title) { caption.classList.remove('on'); return; }
      name.textContent = title; line.textContent = sub || '';
      caption.classList.remove('on');
      void caption.offsetWidth;                  // restart the animation
      caption.classList.add('on');
    };

    /* Blooks are SVG, and this is a canvas, so each one is drawn once into an
     * image and then treated as a picture. Started early: an image that is still
     * decoding at the moment it is wanted is a hole in the shot. */
    const blooks = [];
    if (global.Sprite && global.Image) {
      for (let i = 0; i < 7; i++) {
        const img = new Image();
        /* An SVG in a data URI is a document on its own, not a fragment of this
         * page, so it has to declare its own namespace — inline the browser
         * infers it, here it will not, and the image silently never loads. */
        const face = global.Sprite.face(i * 19 + 5, 128, 1 + (i % (global.Sprite.HATS_N - 1)))
          .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(face);
        blooks.push({ img, born: 0, x: 0, hop: Math.random() * 6.28 });
      }
    }

    let plants = [], motes = [], pollen = [], seeded = false, cut = '';
    const shotNow = (t) => t < T.volcano ? 'garden'
                         : t < T.factory ? 'volcano'
                         : t < T.fishing ? 'factory'
                         : t < T.garden  ? 'fishing' : 'bloom';
    let worded = false, carded = false;
    // the seed's own flight, so the landing and the first sprout agree on where
    const seedX = () => W() * 0.5;

    for (let i = 0; i < 70; i++) {
      motes.push({ x: Math.random(), y: Math.random(), r: rand(0.6, 2.4),
                   drift: rand(-0.04, 0.04), rise: rand(0.02, 0.09),
                   glow: rand(0.15, 0.5), phase: Math.random() * 6.28 });
    }
    const stars = Array.from({ length: 90 }, () => ({
      x: Math.random(), y: Math.random() * 0.72, r: rand(0.5, 1.7),
      twinkle: rand(0.4, 1.6), phase: Math.random() * 6.28
    }));

    /* Three rows, back to front. The back one comes up first, so by the time the
     * front row is climbing there is already something behind it — a garden that
     * fills in from the distance rather than all at once. The tall ones reach
     * past where the cards will sit, because a flower with a card over it is a
     * flower nobody sees. */
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
          const slot = (i + 0.5) / row.count;
          const x = w * (slot + rand(-0.06, 0.06));
          const middle = 1 - Math.abs(slot - 0.5) * 1.4;
          const height = h * rand(row.tall[0], row.tall[1]) * (0.74 + middle * 0.42);
          plants.push(makePlant(x, groundY() + rand(row.lift[0], row.lift[1]),
                                height, rand(row.born[0], row.born[1]), row.depth));
        }
      }
      for (let i = 0; i < 4; i++) {
        plants.push(makePlant(w * rand(0.04, 0.96), groundY() + rand(14, 34),
                              h * rand(0.15, 0.24), rand(600, 1300), 0));
      }
      plants.sort((a, b) => b.back - a.back);
      seeded = true;
    }

    /* ── the pieces of a plant ─────────────────────────── */
    function leaf(x, y, angle, size, side, open) {
      if (open <= 0) return;
      const s = size * ease.back(Math.min(1, open));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + side * (0.85 + (1 - open) * 0.7));
      ctx.beginPath();
      ctx.moveTo(0, 0);
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
        const own = Math.max(0, Math.min(1, open * f.petals - i * 0.55));
        if (own <= 0) continue;
        const s = f.size * ease.back(own);
        ctx.save();
        ctx.rotate(f.spin + (i / f.petals) * Math.PI * 2);
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

    /* ── shot one: the garden ──────────────────────────── */
    function sky(t) {
      const w = W(), h = H();
      const warm = clamp01((t - T.land) / (T.bloom - T.land));
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#07040F');
      g.addColorStop(0.55, mix('#0C0820', '#1B1035', warm));
      g.addColorStop(1, mix('#0A0718', '#3A1B2A', warm));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      stars.forEach(st => {
        ctx.globalAlpha = (0.25 + 0.45 * Math.sin(t / 700 * st.twinkle + st.phase)) * (1 - warm * 0.45);
        ctx.fillStyle = '#EFE7FF';
        ctx.fillRect(st.x * w, st.y * h, st.r, st.r);
      });
      ctx.globalAlpha = 1;

      const gy = groundY();
      const seedGlow = ctx.createRadialGradient(w / 2, gy, 0, w / 2, gy, Math.max(w, h) * 0.55);
      const strength = t < T.land ? 0.05 + clamp01((t - T.seed) / 1400) * 0.2 : 0.30 + warm * 0.34;
      seedGlow.addColorStop(0, `rgba(255,197,61,${strength})`);
      seedGlow.addColorStop(0.35, `rgba(124,77,255,${strength * 0.4})`);
      seedGlow.addColorStop(1, 'rgba(10,7,24,0)');
      ctx.fillStyle = seedGlow;
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
      for (let x = 0; x <= w; x += 26) {
        ctx.lineTo(x, gy + Math.sin(x / 140) * 5 + Math.cos(x / 61) * 3);
      }
      ctx.lineTo(w, H()); ctx.lineTo(0, H());
      ctx.closePath(); ctx.fill();
    }

    /* The seed: it falls, it tumbles, it lands, and the ground answers. Nothing
       else happens for two seconds, on purpose — an opening that shows one small
       thing buys the room's attention for the twenty that follow. */
    function seed(t) {
      if (t < T.seed || t > T.land + 900) return;
      const gy = groundY();
      if (t < T.land) {
        const k = clamp01((t - T.seed) / (T.land - T.seed));
        const y = -40 + (gy - 6 + 40) * (k * k);          // it accelerates, as things do
        const x = seedX() + Math.sin(k * 7) * 26 * (1 - k);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(k * 9);
        ctx.shadowColor = '#FFD86B'; ctx.shadowBlur = 26;
        ctx.fillStyle = '#FFE9A8';
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // the light it leaves behind it
        ctx.globalAlpha = 0.5;
        const trail = ctx.createLinearGradient(x, y - 150, x, y);
        trail.addColorStop(0, 'rgba(255,216,107,0)');
        trail.addColorStop(1, 'rgba(255,216,107,.55)');
        ctx.fillStyle = trail;
        ctx.fillRect(x - 2, y - 150, 4, 150);
        ctx.globalAlpha = 1;
      } else {
        const k = clamp01((t - T.land) / 900);
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = '#FFD86B';
        ctx.lineWidth = 4 * (1 - k);
        ctx.beginPath();
        ctx.ellipse(seedX(), gy - 4, 30 + k * 190, 8 + k * 46, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    function gardenShot(t) {
      sky(t);
      if (!seeded && t > T.grow) plantOut();

      motes.forEach(m => {
        m.y -= m.rise / H() * 2.2;
        m.x += m.drift / W() * 2.2;
        if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
        ctx.globalAlpha = Math.max(0, m.glow * (0.4 + 0.6 * Math.sin(t / 900 + m.phase)));
        ctx.fillStyle = '#FFE9A8';
        ctx.beginPath();
        ctx.arc(m.x * W(), m.y * H(), m.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      ground();
      seed(t);

      const sway = t / 1000;
      plants.forEach(p => {
        const age = t - T.grow - p.born;
        if (age <= 0) return;
        const grow = Math.min(1, ease.out(Math.min(1, age / 3100 * p.speed)));
        if (grow <= 0.01) return;
        const path = stemPath(p, grow, sway * p.swayRate);
        ctx.globalAlpha = 1 - p.back * 0.55;

        const half = (i) => (p.thick / 2) * (1 - path[i][3] * 0.78);
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
          const [x, y, a] = path[i]; const n = a + Math.PI / 2; const w = half(i);
          const px = x + Math.cos(n) * w, py = y + Math.sin(n) * w;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        for (let i = path.length - 1; i >= 0; i--) {
          const [x, y, a] = path[i]; const n = a + Math.PI / 2; const w = half(i);
          ctx.lineTo(x - Math.cos(n) * w, y - Math.sin(n) * w);
        }
        ctx.closePath();
        ctx.fillStyle = p.back > 0.5 ? '#0E5B41' : '#1A8A61';
        ctx.fill();
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
          const [x, y, a] = path[i]; const n = a + Math.PI / 2; const w = half(i) * 0.42;
          const px = x + Math.cos(n) * w, py = y + Math.sin(n) * w;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(150,255,205,.3)';
        ctx.lineWidth = Math.max(1, p.thick * 0.22);
        ctx.lineCap = 'round';
        ctx.stroke();

        p.leaves.forEach(l => {
          if (grow < l.at) return;
          leaf(...(() => { const at = path[Math.min(path.length - 1, Math.round(l.at * 46))];
                           return [at[0], at[1], at[2] + l.tilt]; })(),
               l.size, l.side, Math.min(1, (grow - l.at) / 0.16));
        });

        if (grow > 0.985) {
          /* The bloom runs outward from the middle of the frame, so the flowers
             open as a wave rather than as a switch. */
          const fromMiddle = Math.abs(p.x - W() / 2) / (W() / 2);
          const bloom = clamp01((t - T.bloom - fromMiddle * 900 - p.back * 300) / 800);
          const tip = path[path.length - 1];
          flower(p.flower, tip[0], tip[1], tip[2], bloom, sway * p.swayRate + p.swayPhase);
          if (bloom > 0.6 && !p.dropped && t > T.storm) {
            p.dropped = true;
            for (let i = 0; i < 18; i++) {
              pollen.push({ x: tip[0] + rand(-8, 8), y: tip[1] + rand(-8, 8),
                            vx: rand(-1.1, 1.1), vy: rand(-3.4, -1.1), life: 1,
                            fade: rand(0.003, 0.009), r: rand(1.4, 3.6),
                            colour: Math.random() < 0.6 ? '#FFD86B' : p.flower.colour });
            }
          }
        }
        ctx.globalAlpha = 1;
      });

      pollen = pollen.filter(s => s.life > 0);
      pollen.forEach(s => {
        s.x += s.vx; s.y += s.vy;
        s.vy += 0.028; s.vx *= 0.992;
        s.life -= s.fade;
        ctx.globalAlpha = Math.max(0, s.life) * 0.9;
        ctx.fillStyle = s.colour;
        ctx.shadowColor = s.colour; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;

      // blooks come up between the flowers, in their hats, one after another
      if (t > T.blooks) {
        blooks.forEach((b, i) => {
          const up = clamp01((t - T.blooks - i * 210) / 620);
          if (up <= 0 || !b.img.complete || !b.img.naturalWidth) return;
          const x = W() * (0.11 + i * (0.78 / Math.max(1, blooks.length - 1)));
          const size = Math.max(70, Math.min(132, W() / 13));
          const hop = Math.sin(t / 320 + b.hop) * 4 * up;
          const y = groundY() - size * ease.back(up) + 12 + hop;
          ctx.globalAlpha = up;
          ctx.drawImage(b.img, x - size / 2, y, size, size);
          ctx.globalAlpha = 1;
        });
      }
    }

    /* ── shot two: one wall, and the lava ──────────────── */
    function volcanoShot(t) {
      const w = W(), h = H(), k = clamp01((t - T.volcano) / (T.factory - T.volcano));
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#160B22'); g.addColorStop(0.6, '#2C1230'); g.addColorStop(1, '#4A1620');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      // the rock face, cut into slabs that do not line up
      ctx.globalAlpha = 0.5;
      for (let y = -40; y < h; y += 92) {
        for (let x = -60; x < w + 60; x += 148) {
          const off = ((y / 92) % 2) * 74 + Math.sin(y * 0.03 + x * 0.01) * 12;
          ctx.fillStyle = (x + y) % 3 ? 'rgba(255,255,255,.028)' : 'rgba(0,0,0,.22)';
          ctx.fillRect(x + off, y, 138, 82);
        }
      }
      ctx.globalAlpha = 1;

      const lava = h * (0.98 - k * 0.52);
      // a climber, always a little above it and never quite far enough
      const climber = blooks[1];
      if (climber && climber.img.complete && climber.img.naturalWidth) {
        const size = Math.max(88, Math.min(160, w / 11));
        const hop = Math.abs(Math.sin(t / 190)) * 16;
        ctx.drawImage(climber.img, w * 0.5 - size / 2 + Math.sin(t / 420) * 22,
                      lava - size - 60 - hop, size, size);
      }

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, lava + Math.sin(t / 300) * 4);
      for (let x = 0; x <= w; x += 22) {
        ctx.lineTo(x, lava + Math.sin(x / 90 + t / 260) * 7 + Math.cos(x / 41 + t / 190) * 4);
      }
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      const lg = ctx.createLinearGradient(0, lava - 30, 0, h);
      lg.addColorStop(0, '#FFD86B'); lg.addColorStop(0.16, '#FF7A45');
      lg.addColorStop(0.5, '#F4364C'); lg.addColorStop(1, '#6E0C18');
      ctx.fillStyle = lg;
      ctx.shadowColor = '#FF7A45'; ctx.shadowBlur = 60;
      ctx.fill();
      ctx.restore();

      // embers off the top of it
      if (Math.random() < 0.6) {
        pollen.push({ x: Math.random() * w, y: lava - 4, vx: rand(-0.5, 0.5), vy: rand(-3.2, -1.2),
                      life: 1, fade: rand(0.008, 0.02), r: rand(1.2, 3),
                      colour: Math.random() < 0.5 ? '#FFD86B' : '#FF7A45' });
      }
      emberDraw();
      say('Volcano Climb', 'The lava is rising under everybody at once');
    }

    /* ── shot three: a floor, and what is on it ────────
     * A row of coloured boxes is not a factory. What makes it one is the belt
     * moving underneath, the pistons out of time with each other, and the coins
     * actually going somewhere — onto a pile that grows while you watch, which
     * is the entire point of the game this shot is about.
     */
    let pile = [], struck = [false, false, false, false];
    function factoryShot(t) {
      const w = W(), h = H(), k = clamp01((t - T.factory) / (T.fishing - T.factory));
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#241628'); g.addColorStop(0.55, '#3A2418'); g.addColorStop(1, '#140C0A');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      // the shed it is all in: girders overhead, and lamps hanging off them
      ctx.strokeStyle = 'rgba(255,197,61,.09)'; ctx.lineWidth = 12;
      for (let i = 0; i < 3; i++) {
        const y = h * (0.1 + i * 0.07);
        ctx.beginPath(); ctx.moveTo(-20, y); ctx.lineTo(w + 20, y + (i % 2 ? 8 : -8)); ctx.stroke();
      }
      for (let i = 0; i < 5; i++) {
        const x = w * (0.12 + i * 0.19);
        ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, h * 0.1); ctx.lineTo(x, h * 0.2); ctx.stroke();
        const lamp = ctx.createRadialGradient(x, h * 0.21, 2, x, h * 0.21, 190);
        lamp.addColorStop(0, 'rgba(255,216,107,.34)');
        lamp.addColorStop(1, 'rgba(255,216,107,0)');
        ctx.fillStyle = lamp; ctx.fillRect(x - 190, h * 0.21 - 60, 380, 420);
        ctx.fillStyle = '#FFD86B';
        ctx.beginPath(); ctx.arc(x, h * 0.21, 7, 0, Math.PI * 2); ctx.fill();
      }

      const belt = h * 0.63;
      // the belt, and the fact that it is moving, which is the whole illusion
      ctx.fillStyle = '#241A16';
      ctx.fillRect(0, belt, w, 34);
      ctx.fillStyle = 'rgba(255,255,255,.09)';
      const roll = (t / 8) % 46;
      for (let x = -46; x < w + 46; x += 46) ctx.fillRect(x + roll, belt + 6, 22, 22);
      ctx.fillStyle = '#120B09';
      ctx.fillRect(0, belt + 34, w, h - belt - 34);

      const count = 4;
      for (let i = 0; i < count; i++) {
        const arrive = clamp01((k - i * 0.1) * 5);
        if (arrive <= 0) continue;
        const bw = Math.min(178, w / 6.4), bh = bw * 0.78;
        const x = w * (0.42 + (i - (count - 1) / 2) * 0.155) - bw / 2;
        const y = belt - bh + (1 - ease.back(arrive)) * -260;
        const beat = Math.sin(t / 210 + i * 1.9);

        // the chimney, and what comes out of it
        ctx.fillStyle = '#6E6884';
        ctx.fillRect(x + bw * 0.68, y - 30, bw * 0.14, 34);
        if (arrive > 0.9 && Math.random() < 0.25) {
          pollen.push({ x: x + bw * 0.75, y: y - 34, vx: rand(-0.4, 0.4), vy: rand(-1.6, -0.7),
                        life: 0.7, fade: 0.011, r: rand(6, 13), colour: 'rgba(255,255,255,.16)' });
        }
        // the piston on the top, each one out of step with the last
        ctx.fillStyle = '#8C86A6';
        ctx.fillRect(x + bw * 0.26, y - 26 + beat * 9, bw * 0.13, 32);
        ctx.fillStyle = '#57516E';
        ctx.fillRect(x + bw * 0.2, y - 34 + beat * 9, bw * 0.25, 11);

        ctx.fillStyle = ['#FFC53D', '#FF7A45', '#2BA8FF', '#12BE8E'][i % 4];
        ctx.strokeStyle = '#120A18'; ctx.lineWidth = 5;
        roundRect(x, y, bw, bh, 12); ctx.fill(); ctx.stroke();

        // a window with something turning behind it, rather than two eyes
        ctx.save();
        roundRect(x + bw * 0.14, y + bh * 0.22, bw * 0.44, bh * 0.44, 7);
        ctx.fillStyle = 'rgba(10,6,16,.55)'; ctx.fill(); ctx.clip();
        ctx.translate(x + bw * 0.36, y + bh * 0.44);
        ctx.rotate(t / 340 + i);
        ctx.fillStyle = 'rgba(255,216,107,.7)';
        for (let s2 = 0; s2 < 6; s2++) {
          ctx.rotate(Math.PI / 3);
          ctx.fillRect(-3, -bh * 0.19, 6, bh * 0.19);
        }
        ctx.restore();
        // the chute the coins come out of
        ctx.fillStyle = '#3A3350';
        roundRect(x + bw * 0.66, y + bh * 0.52, bw * 0.26, bh * 0.3, 5); ctx.fill();

        /* One coin per stroke of the piston, rather than a dice roll every
           frame — a machine that pays at random is not a machine anybody would
           buy, and it does not look like one either. */
        if (arrive > 0.92 && beat > 0.9 && !struck[i]) {
          struck[i] = true;
          pollen.push({ x: x + bw * 0.79, y: y + bh * 0.8, vx: rand(1.2, 3.4), vy: rand(-8, -5.5),
                        life: 1, fade: 0.003, r: rand(5, 8), colour: '#FFD86B', coin: true });
        }
        if (beat < 0.2) struck[i] = false;
      }

      /* Coins land on the belt and stay there. A pile that grows is the only way
         to show "every round, whether you answered or not" without saying it. */
      pollen = pollen.filter(c => {
        if (!c.coin) return true;
        if (c.y > belt + 6 && c.vy > 0) {
          pile.push({ x: Math.min(w - 30, c.x + rand(20, 90)), y: belt + rand(2, 16), r: c.r });
          if (pile.length > 90) pile.shift();
          return false;
        }
        return true;
      });
      pile.forEach(c => {
        ctx.fillStyle = '#FFD86B';
        ctx.shadowColor = '#FFC53D'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, c.r, c.r * 0.66, 0, 0, Math.PI * 2); ctx.fill();
      });
      ctx.shadowBlur = 0;

      // somebody watching their own money arrive
      const owner = blooks[3];
      if (owner && owner.img.complete && owner.img.naturalWidth) {
        const size = Math.max(96, Math.min(170, w / 10));
        const up = clamp01((k - 0.2) * 4);
        ctx.globalAlpha = up;
        ctx.drawImage(owner.img, w * 0.84 - size / 2,
                      belt - size + 14 + (1 - ease.back(up)) * 90 + Math.sin(t / 300) * 4, size, size);
        ctx.globalAlpha = 1;
      }

      emberDraw(0.2);
      say('Factory', 'Machines that pay you every round, whether you answered or not');
    }

    /* ── shot four: the line goes in ───────────────────── */
    function fishingShot(t) {
      const w = W(), h = H(), k = clamp01((t - T.fishing) / (T.garden - T.fishing));
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0B1B33'); g.addColorStop(0.42, '#1B4E76'); g.addColorStop(1, '#04121F');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      const water = h * 0.5;

      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#FFF3D6';
      ctx.shadowColor = '#FFF3D6'; ctx.shadowBlur = 60;
      const moonX = w * 0.74, moonR = Math.min(52, w / 20);
      ctx.beginPath(); ctx.arc(moonX, h * 0.19, moonR, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;

      ctx.fillStyle = '#0A2E52';
      ctx.fillRect(0, water, w, h - water);
      // the moon on the water, broken up by it
      for (let i = 0; i < 30; i++) {
        const y = water + Math.pow(i / 30, 1.7) * (h - water);
        const wob = Math.sin(t / 420 + i * 0.9) * (8 + i);
        ctx.globalAlpha = 0.1 + (1 - i / 30) * 0.22;
        ctx.fillStyle = '#CFE8FF';
        const rw = moonR * 1.6 + i * 2.6;
        ctx.fillRect(moonX - rw / 2 + wob, y, rw, 2 + i * 0.22);
      }
      // and the lines of the surface running away from the eye
      for (let i = 0; i < 26; i++) {
        const y = water + Math.pow(i / 26, 1.9) * (h - water);
        ctx.globalAlpha = 0.04 + (1 - i / 26) * 0.09;
        ctx.fillStyle = '#9FD6FF';
        ctx.fillRect(0, y + Math.sin(t / 400 + i) * 2, w, 2 + i * 0.4);
      }
      ctx.globalAlpha = 1;

      /* The pier, and somebody on the end of it. A rod coming in from off frame
         was a line with nobody holding it. */
      const pierY = water - 6, pierX = w * 0.05, pierW = w * 0.3;
      ctx.fillStyle = '#5A3A22';
      ctx.fillRect(pierX, pierY, pierW, 16);
      ctx.fillStyle = '#3E2716';
      for (let i = 0; i < 3; i++) ctx.fillRect(pierX + 24 + i * (pierW / 3), pierY + 16, 14, 90);

      const angler = blooks[5];
      const size = Math.max(96, Math.min(168, w / 10));
      if (angler && angler.img.complete && angler.img.naturalWidth) {
        ctx.drawImage(angler.img, pierX + pierW - size * 0.9, pierY - size + 6, size, size);
      }
      // the rod, bending more the closer the fish gets
      const rodX = pierX + pierW - size * 0.15, rodY = pierY - size * 0.55;
      const bend = k > 0.5 ? (k - 0.5) * 2 : 0;
      const tipX = rodX + w * 0.19, tipY = rodY - h * 0.12 + bend * h * 0.09;
      ctx.strokeStyle = '#C69C6D'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(rodX, rodY);
      ctx.quadraticCurveTo(rodX + w * 0.1, rodY - h * 0.11 - bend * h * 0.02, tipX, tipY);
      ctx.stroke();

      const fx = w * 0.52, fy = water + 30 + Math.sin(t / 330) * 7 - bend * 26;
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(fx, fy); ctx.stroke();

      // rings where the float sits
      for (let i = 0; i < 3; i++) {
        const r = ((t / 12 + i * 40) % 120);
        ctx.globalAlpha = (1 - r / 120) * 0.3;
        ctx.strokeStyle = '#CFE8FF'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(fx, fy + 4, r, r * 0.28, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#F4364C';
      ctx.beginPath(); ctx.arc(fx, fy, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#F6F2FF';
      ctx.beginPath(); ctx.arc(fx, fy - 4, 6.5, 0, Math.PI * 2); ctx.fill();

      // shapes moving about under the surface, so the water is not empty
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#0A1F33';
      for (let i = 0; i < 5; i++) {
        const sx = (w * 0.2 + i * w * 0.17 + t / (7 + i)) % (w * 1.2) - w * 0.1;
        const sy = water + 70 + i * 46 + Math.sin(t / 600 + i) * 12;
        ctx.beginPath(); ctx.ellipse(sx, sy, 42 - i * 4, 13 - i, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // and then, late, something takes it
      if (k > 0.55) {
        const j = clamp01((k - 0.55) / 0.45);
        const fishY = water + 190 - ease.out(j) * 300;
        const fishX = fx + 30 + j * 130;
        ctx.save();
        ctx.translate(fishX, fishY);
        ctx.rotate(-0.75 + j * 1.1);
        const fs = Math.max(1, w / 1400);
        ctx.scale(fs, fs);
        ctx.shadowColor = '#FFD86B'; ctx.shadowBlur = 34;
        ctx.fillStyle = '#E8A400';
        ctx.beginPath();
        ctx.moveTo(-64, 0); ctx.lineTo(-108, -32); ctx.lineTo(-108, 32); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#FFC53D';
        ctx.beginPath(); ctx.ellipse(0, 0, 70, 30, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#E8A400';
        ctx.beginPath();
        ctx.moveTo(-6, -26); ctx.quadraticCurveTo(14, -56, 34, -22); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFF7E4';
        ctx.beginPath(); ctx.arc(34, -7, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1B1233';
        ctx.beginPath(); ctx.arc(36, -7, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        if (j < 0.32 && Math.random() < 0.85) {
          pollen.push({ x: fx + rand(-40, 110), y: water + 10, vx: rand(-3.4, 3.4), vy: rand(-8, -3),
                        life: 1, fade: 0.017, r: rand(2, 6), colour: '#CFEBFF' });
        }
      }
      emberDraw(0.24);
      say('Fishing Frenzy', 'The deep gives you nothing four times in seven. And then this');
    }

    /* Particles are shared across the shots, so one list is drawn wherever it is
       wanted rather than three lists that all do the same thing. */
    function emberDraw(gravity) {
      const gy = gravity === undefined ? 0.06 : gravity;
      pollen = pollen.filter(s => s.life > 0);
      pollen.forEach(s => {
        s.x += s.vx; s.y += s.vy; s.vy += gy; s.vx *= 0.99; s.life -= s.fade;
        ctx.globalAlpha = Math.max(0, s.life) * 0.9;
        ctx.fillStyle = s.colour;
        ctx.shadowColor = s.colour; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    /* ── the edit ──────────────────────────────────────── */
    function tick(now) {
      const t = now - started;
      const dpr = canvas.width / innerWidth;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      /* The camera. It pushes in slowly while the garden grows and pulls back
       * for the reveal, and the vignettes each drift a little of their own — a
       * shot that does not move at all is a photograph, and three photographs in
       * a row is a slideshow. */
      let zoom = 1, panX = 0, panY = 0;
      if (t < T.volcano) {
        zoom = tween(t, T.seed, T.storm, 1.35, 1.02);
        panY = tween(t, T.seed, T.storm, H() * 0.1, 0);
      } else if (t < T.factory) {
        zoom = tween(t, T.volcano, T.factory, 1.16, 1.02);
      } else if (t < T.fishing) {
        zoom = tween(t, T.factory, T.fishing, 1.0, 1.07);
      } else if (t < T.garden) {
        zoom = tween(t, T.fishing, T.garden, 1.18, 1.03);
      } else {
        zoom = tween(t, T.garden, T.out, 1.09, 1.0);
      }
      ctx.save();
      ctx.translate(W() / 2 + panX, H() / 2 + panY);
      ctx.scale(zoom, zoom);
      ctx.translate(-W() / 2, -H() / 2);

      // the shots, each fading through the one before it rather than cutting dead
      /* Particles belong to the shot that made them. Carrying the garden's
         pollen into the volcano is the sort of thing nobody can name but
         everybody can see. */
      if (cut !== shotNow(t)) { cut = shotNow(t); pollen = []; pile = []; }

      const a = shot(t, -400, T.volcano), b = shot(t, T.volcano, T.factory);
      const c = shot(t, T.factory, T.fishing), d = shot(t, T.fishing, T.garden);
      const e = shot(t, T.garden, T.out + 400);
      if (a) { ctx.globalAlpha = a; gardenShot(t); }
      if (b) { ctx.globalAlpha = b; volcanoShot(t); }
      if (c) { ctx.globalAlpha = c; factoryShot(t); }
      if (d) { ctx.globalAlpha = d; fishingShot(t); }
      if (e) { ctx.globalAlpha = e; gardenShot(t); }
      ctx.globalAlpha = 1;
      ctx.restore();

      if (t > T.storm && t < T.volcano - 200) say('', '');
      if (t > T.garden) say('', '');

      // one flash on the last cut, the moment the garden comes back in bloom
      if (t > T.garden - 120 && t < T.garden + 420) {
        const k = 1 - clamp01((t - (T.garden - 120)) / 540);
        ctx.fillStyle = `rgba(255,243,214,${k * k * 0.5})`;
        ctx.fillRect(0, 0, W(), H());
      }

      if (!worded && t > T.title) { worded = true; word(); }
      if (!carded && t > T.cards) { carded = true; cards(); }
      if (t > T.out) { shell.classList.remove('bars'); return finish(); }
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
