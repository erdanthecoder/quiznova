/* Eagle Hunt — the limited edition.
 *
 * Salburun is the old Kyrgyz hunt: a golden eagle, a horse and a canyon. This
 * is the canyon. Every child in the room has a bird in the air down it, and a
 * right answer is one beat of its wings.
 *
 * Why it is built the way it is
 *
 *   The canyon is real three dimensions, not a painting that slides. Every
 *   wall, every flagged gate, every bird has a place in a world measured in
 *   metres, and the picture comes out of a camera looking down it — one
 *   perspective divide, the same one, for all of it. That is the difference
 *   between depth you can read and parallax you eventually notice. A bird
 *   forty metres ahead is behind the gate at thirty and in front of the one at
 *   fifty, and it gets there by being there.
 *
 *   The camera sits behind whoever is leading and looks along the valley. It
 *   does not snap: it lags, and catches up, so a child overtaking somebody has
 *   a moment of the view swinging round to them. That moment is the reason to
 *   play a race rather than watch a bar chart.
 *
 *   The walls are grown from the same noise every time the board loads, so no
 *   two games are the same valley — and they are generated once, in metres,
 *   rather than per frame, because a canyon that quietly reshapes itself as you
 *   fly is the exact thing that makes 3D on a canvas look fake.
 *
 * What it is not
 *   It is not a physics engine and there is nothing to steer. The birds go
 *   where the answers put them. Everything here is in service of one thing: a
 *   class being able to see, without being told, who is in front.
 */
(function (global) {
  'use strict';

  /* ── the valley, in metres ──────────────────────────────── */
  const NEAR = 1.2;            // closer than this and nothing is drawn
  const FAR = 130;             // and past this it is fog
  const LANES = 5;             // how far across the canyon birds are spread
  const GATE_EVERY = 25;       // a flagged gate every this many metres of valley
  const SLICE = 2.2;           // how long a piece of wall is
  const FLOOR = -7;            // where the river is, below the eye
  const METRE = 12;            // points to the metre

  const WORLDS = {
    canyon: {
      label: 'Ala-Too Canyon',
      sky: ['#132352', '#3F63B4', '#9FC2E4'],
      rock: ['#241B38', '#3D2F5C', '#584479'],
      river: '#1C5E80', snow: '#F4F7FF', haze: '#6E7FA4'
    },
    dusk: {
      label: 'Red Gorge',
      sky: ['#2A1440', '#8E3A58', '#FFB36B'],
      rock: ['#25122A', '#4B2333', '#6E3B45'],
      river: '#5B3159', snow: '#FFE3D0', haze: '#9A6A66'
    },
    storm: {
      label: 'The Storm',
      sky: ['#0E1024', '#2A3050', '#59617F'],
      rock: ['#101124', '#23253A', '#363A52'],
      river: '#24374F', snow: '#DDE4F5', haze: '#5A6178'
    }
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const lerp = (a, b, k) => a + (b - a) * k;

  /** Smooth noise: random points, smoothly joined. A wall, not a graph. */
  function noiseField(n) {
    const pts = Array.from({ length: n }, () => Math.random() * 2 - 1);
    return (t) => {
      const x = ((t % n) + n) % n;
      const i = Math.floor(x), f = x - i;
      const a = pts[i % n], b = pts[(i + 1) % n];
      const s = f * f * (3 - 2 * f);
      return a + (b - a) * s;
    };
  }

  /* Blend two colours.
   *
   * It reads what it writes. That sounds like a nicety and is not: the rock is
   * shaded and *then* hazed by distance, so the second call is handed the first
   * one's answer. Parsing only '#rrggbb' meant every nested call came back
   * `rgb(NaN,NaN,…)` — which a canvas does not complain about, it simply keeps
   * whatever colour was set before. The canyon walls were being filled with the
   * last thing drawn, which is why there were no walls. */
  const channels = (c) => {
    if (c[0] === '#') {
      return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    }
    const n = c.match(/-?\d+(\.\d+)?/g) || [0, 0, 0];
    return [Number(n[0]) || 0, Number(n[1]) || 0, Number(n[2]) || 0];
  };
  const mix = (a, b, k) => {
    const x = channels(a), y = channels(b);
    return `rgb(${Math.round(lerp(x[0], y[0], k))},${Math.round(lerp(x[1], y[1], k))},${Math.round(lerp(x[2], y[2], k))})`;
  };

  /**
   * Put a canyon on a canvas.
   *   canvas   where to draw
   *   world    which valley ('canyon' | 'dusk' | 'storm')
   * Returns { setBirds, surge, stop, canvas }.
   */
  function start(opts) {
    const o = opts || {};
    const canvas = o.canvas;
    const ctx = canvas && canvas.getContext && canvas.getContext('2d');
    if (!ctx) return { setBirds() {}, surge() {}, stop() {}, canvas: null };
    const look = WORLDS[o.world] || WORLDS.canyon;

    /* The shape of the valley. Two noise fields — one for how wide it is and
       one for how the walls lean — sampled by metre, so the canyon is the same
       canyon whatever the frame rate. */
    const wide = noiseField(9), lean = noiseField(13), tall = noiseField(7);
    /* Narrow. The first cut of this was thirteen metres to a side and the walls
       sat off the edges of the board with nothing but sky between them — a
       valley you cannot see the sides of is a field. Seven metres puts the rock
       about a third of the way in from each edge at the distance the camera
       actually sits, which is where a canyon starts being a canyon. */
    const wallAt = (z) => {
      const half = 8.5 + wide(z / 46) * 2.8;
      const tilt = lean(z / 63) * 2.2;
      return { left: -half + tilt, right: half + tilt, top: 8 + tall(z / 38) * 3.6 };
    };

    /* The far peaks, beyond the end of the canyon. Grown as peaks rather than
       as noise for the same reason the mountains in the 5.0 film are: midpoint
       noise makes rolling country, and rolling country at that distance reads
       as a smudge. */
    const peaks = (() => {
      const tops = Array.from({ length: 6 }, (_, i) => ({
        x: (i + rand(0.15, 0.85)) / 6, h: rand(0.4, 1), w: rand(0.6, 1.3) / 6
      }));
      const jag = noiseField(11);
      return Array.from({ length: 121 }, (_, i) => {
        const x = i / 120;
        let y = 0.06;
        for (const t of tops) {
          const d = Math.abs(x - t.x) / t.w;
          if (d < 1) y = Math.max(y, t.h * (1 - Math.pow(d, 1.45)));
        }
        return Math.max(0.03, Math.min(1, y + jag(x * 9) * 0.05));
      });
    })();

    let birds = [];
    let camZ = FLOOR, camTarget = FLOOR, camSwing = 0, swingTo = 0;
    let motes = Array.from({ length: 90 }, () => ({
      x: rand(-16, 16), y: rand(FLOOR, 14), z: rand(2, FAR), r: rand(0.04, 0.14)
    }));
    let puffs = [];
    let w = 0, h = 0, raf = 0, dead = false;
    let last = 0;

    const size = () => {
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const box = canvas.getBoundingClientRect();
      w = Math.max(1, box.width || canvas.width);
      h = Math.max(1, box.height || canvas.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    global.addEventListener('resize', size);

    /* ── the camera ───────────────────────────────────────
     * One lens for everything on screen. `f` is in pixels, so a taller board
     * shows more canyon rather than a stretched one. */
    const horizon = () => h * 0.55;
    const lens = () => Math.max(260, h * 0.92);
    const project = (x, y, z) => {
      const dz = z - camZ;
      if (dz < NEAR) return null;
      const s = lens() / dz;
      return { x: w / 2 + (x - camSwing) * s, y: horizon() - y * s, s, dz };
    };

    /** How much of the far distance is left of a thing this far away. */
    const fog = (dz) => clamp01(1 - (dz - 18) / (FAR - 18));

    /* ── the birds ────────────────────────────────────────
     * Drawn rather than photographed, and drawn from above and behind, which is
     * the only angle from which a class can tell two birds apart at speed: the
     * wings are the widest thing and the silhouette is the whole read.
     */
    function drawBird(b, p, t) {
      const s = p.s;
      const span = 1.7 * s;                 // half a wingspan, in pixels
      /* Every bird flaps on its own clock, and faster when it has just been
         pushed — a bird that has been answered for should look like it. */
      const rate = 3.4 + (b.push || 0) * 5;
      const beat = Math.sin(t / 1000 * rate + b.phase);
      const lift = beat * span * 0.44;
      const fold = 0.72 + 0.28 * Math.abs(beat);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = fog(p.dz);

      // the shadow it throws on the water, which is what makes it be *in* the
      // canyon rather than on top of a picture of one
      const floor = project(b.x, FLOOR, b.z);
      if (floor) {
        ctx.save();
        ctx.setTransform(ctx.getTransform());
        ctx.globalAlpha = fog(p.dz) * 0.28;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(floor.x - p.x, floor.y - p.y, span * 0.8, span * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const dark = b.colour;
      // wings: two long triangles with fingered tips, swept by the beat
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.scale(side, 1);
        ctx.fillStyle = dark;
        ctx.beginPath();
        /* Long and nearly level, with fingers at the tip — a golden eagle's
           wing is a plank with fingers, and the bird only reads at the far end
           of a canyon if the plank does. */
        ctx.moveTo(0, -span * 0.16);
        ctx.quadraticCurveTo(span * 0.5 * fold, -lift * 0.55 - span * 0.22,
                             span * fold, -lift - span * 0.06);
        ctx.lineTo(span * 0.99 * fold, -lift + span * 0.05);
        ctx.lineTo(span * 0.93 * fold, -lift + span * 0.02);
        ctx.lineTo(span * 0.95 * fold, -lift + span * 0.14);
        ctx.lineTo(span * 0.87 * fold, -lift + span * 0.09);
        ctx.lineTo(span * 0.88 * fold, -lift + span * 0.21);
        ctx.quadraticCurveTo(span * 0.44 * fold, -lift * 0.3 + span * 0.22,
                             0, span * 0.2);
        ctx.closePath();
        ctx.fill();
        // the pale bar along the underwing — a golden eagle's tell, and what
        // keeps two dark birds from becoming one dark smudge
        ctx.fillStyle = 'rgba(255,226,160,.55)';
        ctx.beginPath();
        ctx.moveTo(span * 0.22 * fold, -lift * 0.2);
        ctx.quadraticCurveTo(span * 0.6 * fold, -lift * 0.55, span * 0.86 * fold, -lift * 0.9);
        ctx.lineTo(span * 0.8 * fold, -lift * 0.9 + span * 0.13);
        ctx.quadraticCurveTo(span * 0.55 * fold, -lift * 0.35, span * 0.22 * fold, -lift * 0.2 + span * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      // body and tail
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(0, 0, span * 0.13, span * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      // a short fanned tail, not a dart's flight
      ctx.beginPath();
      ctx.moveTo(-span * 0.12, span * 0.24);
      ctx.lineTo(-span * 0.17, span * 0.56);
      ctx.lineTo(span * 0.17, span * 0.56);
      ctx.lineTo(span * 0.12, span * 0.24);
      ctx.closePath();
      ctx.fill();
      // the head, pale, so you can tell which way it is going
      ctx.fillStyle = '#E8C98A';
      ctx.beginPath();
      ctx.ellipse(0, -span * 0.33, span * 0.1, span * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      /* A name, but only for the few at the front. Thirty labels is a wall of
         text with a canyon somewhere behind it. */
      if (b.rank <= 3 || b.you) {
        ctx.save();
        ctx.globalAlpha = fog(p.dz);
        ctx.font = `800 ${Math.max(11, Math.min(24, span * 0.52))}px 'Nunito', system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(12,8,28,.75)';
        ctx.strokeText(b.name, p.x, p.y - span * 0.9);
        ctx.fillStyle = b.you ? '#FFC53D' : '#FFFFFF';
        ctx.fillText(b.name, p.x, p.y - span * 0.9);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    /* ── the walls ────────────────────────────────────────
     * A wall is a strip of quads, one per slice, each one projected on its own.
     * Filling the whole wall as a single polygon would be cheaper and would
     * also flatten it: it is the seam between slices, shaded slightly
     * differently, that gives rock its face.
     */
    function drawWall(side, t) {
      const from = Math.floor((camZ + NEAR) / SLICE) * SLICE;
      for (let z = from; z < camZ + FAR; z += SLICE) {
        const a = wallAt(z), b = wallAt(z + SLICE);
        const ax = side < 0 ? a.left : a.right, bx = side < 0 ? b.left : b.right;
        const p1 = project(ax, FLOOR, z), p2 = project(bx, FLOOR, z + SLICE);
        const p3 = project(bx, b.top, z + SLICE), p4 = project(ax, a.top, z);
        if (!p1 || !p2 || !p3 || !p4) continue;
        const k = clamp01((z - camZ) / FAR);
        /* Face shading: one wall takes the light and the other does not, which
           is a single number and most of what stops a canyon looking like a
           corridor in a cartoon. */
        const lit = side > 0 ? 0.26 : 0;
        const band = ((Math.round(z / SLICE) % 3) - 1) * 0.035;   // strata, not stripes
        const base = mix(look.rock[0], look.rock[2], clamp01(0.22 + lit + band));
        const face = mix(base, look.haze, 1 - fog(z - camZ));
        /* Down the face as well as along it: rock in shadow at the waterline and
           catching what light there is at the top. One gradient per slice is
           what stops a wall reading as a painted corridor. */
        const g = ctx.createLinearGradient(0, p4.y, 0, p1.y);
        g.addColorStop(0, mix(face, '#FFFFFF', 0.1));
        g.addColorStop(1, mix(face, '#000000', 0.35));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
        ctx.closePath(); ctx.fill();

        // snow on the top edge of the nearer rock, where it would actually lie
        if (k < 0.5) {
          ctx.fillStyle = `rgba(244,247,255,${(0.5 - k) * 0.5})`;
          ctx.beginPath();
          ctx.moveTo(p4.x, p4.y); ctx.lineTo(p3.x, p3.y);
          ctx.lineTo(p3.x, p3.y + (p2.y - p3.y) * 0.06);
          ctx.lineTo(p4.x, p4.y + (p1.y - p4.y) * 0.06);
          ctx.closePath(); ctx.fill();
        }
      }
    }

    /** The river at the bottom, which is where the speed reads best. */
    function drawFloor(t) {
      const from = Math.floor((camZ + NEAR) / SLICE) * SLICE;
      for (let z = from; z < camZ + FAR; z += SLICE) {
        const a = wallAt(z), b = wallAt(z + SLICE);
        const p1 = project(a.left, FLOOR, z), p2 = project(a.right, FLOOR, z);
        const p3 = project(b.right, FLOOR, z + SLICE), p4 = project(b.left, FLOOR, z + SLICE);
        if (!p1 || !p2 || !p3 || !p4) continue;
        const shine = 0.5 + 0.5 * Math.sin(z * 0.5 + t / 380);
        ctx.fillStyle = mix(mix(look.river, '#FFFFFF', shine * 0.14), look.haze, 1 - fog(z - camZ));
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
        ctx.closePath(); ctx.fill();
      }
    }

    /* A gate every so many metres: two poles and a line of flags across the
       canyon. Without them the canyon is beautiful and speedless — there is
       nothing to pass, so nothing moves. */
    function drawGates() {
      const first = Math.ceil((camZ + NEAR) / GATE_EVERY) * GATE_EVERY;
      for (let z = first; z < camZ + FAR; z += GATE_EVERY) {
        const at = wallAt(z);
        const left = project(at.left + 1.5, FLOOR, z), lt = project(at.left + 1.5, 6, z);
        const right = project(at.right - 1.5, FLOOR, z), rt = project(at.right - 1.5, 6, z);
        if (!left || !lt || !right || !rt) continue;
        const a = fog(z - camZ);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#3A2A1C';
        ctx.lineWidth = Math.max(1.5, lt.s * 0.22);
        ctx.beginPath();
        ctx.moveTo(left.x, left.y); ctx.lineTo(lt.x, lt.y);
        ctx.moveTo(right.x, right.y); ctx.lineTo(rt.x, rt.y);
        ctx.stroke();
        // the flag line, in the colours the board uses for answers
        const flags = ['#F4364C', '#4F6BFF', '#FFC53D', '#12BE8E'];
        const n = 9;
        for (let i = 0; i < n; i++) {
          const k0 = i / n, k1 = (i + 1) / n;
          const x0 = lerp(lt.x, rt.x, k0), x1 = lerp(lt.x, rt.x, k1);
          const y0 = lerp(lt.y, rt.y, k0), y1 = lerp(lt.y, rt.y, k1);
          const sag = Math.sin(Math.PI * (k0 + k1) / 2) * lt.s * 0.5;
          ctx.fillStyle = flags[i % flags.length];
          ctx.beginPath();
          ctx.moveTo(x0, y0 + sag); ctx.lineTo(x1, y1 + sag);
          ctx.lineTo((x0 + x1) / 2, (y0 + y1) / 2 + sag + lt.s * 0.55);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
    }

    /** The sky, and the peaks past the end of the valley. */
    function drawSky() {
      const g = ctx.createLinearGradient(0, 0, 0, horizon() + h * 0.2);
      g.addColorStop(0, look.sky[0]);
      g.addColorStop(0.6, look.sky[1]);
      g.addColorStop(1, look.sky[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      /* The peaks shift with the camera, but only a little: they are far away,
         and something far away that keeps pace with you is not far away. */
      const shift = -camSwing * 3 - (camZ * 0.12) % w;
      ctx.fillStyle = mix(look.rock[1], look.haze, 0.62);
      ctx.beginPath();
      ctx.moveTo(-10, horizon() + 10);
      for (let i = 0; i < peaks.length; i++) {
        const x = ((i / (peaks.length - 1)) * w * 1.6 + shift) % (w * 1.6) - w * 0.3;
        ctx.lineTo(x, horizon() + 8 - peaks[i] * h * 0.2);
      }
      ctx.lineTo(w + 10, horizon() + 10);
      ctx.closePath();
      ctx.fill();
    }

    /* Snow coming the other way. It is the cheapest speed in the world and the
       only thing on screen that tells you the camera is moving when every bird
       happens to be level with it. */
    function drawMotes(dt) {
      motes.forEach(m => {
        m.z -= dt * 13;
        if (m.z < camZ + NEAR) { m.z = camZ + FAR; m.x = rand(-16, 16); m.y = rand(FLOOR, 14); }
        const p = project(m.x, m.y, m.z);
        if (!p) return;
        ctx.globalAlpha = fog(p.dz) * 0.8;
        ctx.fillStyle = look.snow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.6, m.r * p.s), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      if (dead) return;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;

      /* The camera follows the leader, at a lag. Snapping would be correct and
         would also mean nobody ever sees the overtake. */
      camZ += (camTarget - camZ) * Math.min(1, dt * 2.2);
      camSwing += (swingTo - camSwing) * Math.min(1, dt * 1.6);

      ctx.clearRect(0, 0, w, h);
      drawSky();
      drawFloor(now);
      drawWall(-1, now);
      drawWall(1, now);
      drawGates();
      drawMotes(dt);

      /* Back to front, because a canvas has no depth buffer and the only thing
         standing between this and birds drawn through rock is the order. */
      const order = birds.slice().sort((a, b) => b.z - a.z);
      order.forEach(b => {
        b.z += (b.want - b.z) * Math.min(1, dt * 2.6);
        b.x += (b.lane - b.x) * Math.min(1, dt * 1.4);
        b.push = Math.max(0, (b.push || 0) - dt * 1.4);
        b.bob = (b.bob || 0) + dt;
        const p = project(b.x, Math.sin(b.bob * 1.4 + b.phase) * 0.7, b.z);
        if (p) drawBird(b, p, now);
      });

      puffs = puffs.filter(f => f.life > 0);
      puffs.forEach(f => {
        f.life -= dt * 1.1; f.r += dt * 2.4;
        const p = project(f.x, f.y, f.z);
        if (!p) return;
        ctx.globalAlpha = Math.max(0, f.life) * 0.5 * fog(p.dz);
        ctx.strokeStyle = '#FFE9A8';
        ctx.lineWidth = Math.max(1, p.s * 0.06);
        ctx.beginPath();
        ctx.arc(p.x, p.y, f.r * p.s, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      raf = global.requestAnimationFrame(guard);
    }
    /* A board is a projector in front of a room. If a frame throws, the canyon
       stops and the rest of the screen — the question, the timer, the names —
       carries on, rather than the lesson stopping. */
    const guard = (t) => { try { frame(t); } catch (err) { stop(); } };

    const COLOURS = ['#6B4A2A', '#8A5A2B', '#4A3A2A', '#7A4A3A', '#5A4A3A', '#9A6A3A'];

    /** Who is in the air, and how far down the valley they are. */
    function setBirds(list) {
      const by = new Map(birds.map(b => [b.id, b]));
      const sorted = list.slice().sort((a, b) => (b.dist || 0) - (a.dist || 0));
      birds = sorted.map((p, i) => {
        const had = by.get(p.id);
        /* Lanes are assigned by rank, so the leader is in the middle of the
           canyon and the field fans out behind — and a bird keeps its lane as
           it climbs the order rather than teleporting across the valley,
           because the lane is a target and the draw eases towards it. */
        const spread = Math.min(LANES, 1.6 + list.length * 0.4);
        const lane = list.length === 1 ? 0
          : ((i % 2 ? 1 : -1) * Math.ceil(i / 2) / Math.max(1, Math.ceil(list.length / 2))) * spread;
        const want = (p.dist || 0) / METRE;
        return Object.assign(had || {
          x: lane, z: want, bob: Math.random() * 6,
          phase: Math.random() * 6.28, colour: COLOURS[i % COLOURS.length]
        }, { id: p.id, name: p.name, you: !!p.you, rank: i + 1, lane, want });
      });
      /* Behind the whole field, not behind the leader. Framing on the front
         bird put everybody else off the back of the camera the moment somebody
         got two questions ahead — which is exactly when a race is worth
         watching. The camera sits behind whoever is last, unless the field has
         strung out, and then it takes the leader and lets the back fog. */
      const zs = birds.map(b => b.want);
      const front = zs.length ? Math.max.apply(null, zs) : 0;
      const back = zs.length ? Math.min.apply(null, zs) : 0;
      camTarget = Math.min(back - 11, front - 17);
      swingTo = birds.length ? birds[0].lane * 0.4 : 0;
    }

    /** Somebody got one right: push their bird, and say so on screen. */
    function surge(id, by) {
      const b = birds.find(x => x.id === id);
      if (!b) return;
      b.push = 1;
      b.want += Math.max(0, (by || 0) / METRE);
      puffs.push({ x: b.x, y: 0, z: b.z, r: 0.4, life: 1 });
    }

    function stop() {
      if (dead) return;
      dead = true;
      global.cancelAnimationFrame(raf);
      global.removeEventListener('resize', size);
    }

    raf = global.requestAnimationFrame(guard);
    return { setBirds, surge, stop, canvas,
             get camera() { return { z: camZ, swing: camSwing }; },
             get birds() { return birds.map(b => ({ id: b.id, z: b.z, lane: b.lane, rank: b.rank })); } };
  }

  global.NovaEagle = { start, WORLDS, GATE_EVERY };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaEagle;
