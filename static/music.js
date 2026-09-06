/* The music for the big screen, played by the browser rather than downloaded.
 *
 * Nothing here is a file: every note is a struck tone built from a few
 * oscillators that ring and fade, which is what a marimba or a plucked string
 * does and what a square-wave arpeggio does not. That is deliberate — a game in
 * a classroom should not sound like a machine, and it should not sound like
 * every other website either. It also means the whole soundtrack works with the
 * wifi unplugged, and adds nothing to what a page has to download.
 *
 * There is a different piece for each part of a game, because that is what the
 * room is actually listening for: the waiting-about tune while people join, a
 * question that tightens as the clock runs down, a breath while the answer is
 * shown, and something to win to. They are all built from the same handful of
 * sounds and the same five notes, so moving between them sounds like one piece
 * of music changing its mind rather than four songs fighting.
 *
 * It only ever plays on the screen everyone is looking at. Thirty phones each
 * playing their own copy would be unbearable.
 */
(function (global) {
  'use strict';

  // A pentatonic scale has no interval in it that can clash, so a tune wandering
  // about inside one stays pleasant however long it is left running.
  const SCALE = [0, 2, 4, 7, 9];
  const ROOT = 220;                                   // A3
  const note = (step) => ROOT * Math.pow(2, (SCALE[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5)) / 12);

  let ctx = null, out = null, noise = null, timer = null;
  let playing = false, step = 0, bar = 0;
  let wanted = false;                                 // what the teacher asked for
  let urge = 0;                                       // 0 → 1 as a question runs out

  function build() {
    if (ctx) return ctx;
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    out = ctx.createGain();
    out.gain.value = 0;
    // a gentle low-pass takes the glassy edge off, so it sits under a room
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 2600;
    out.connect(soft).connect(ctx.destination);

    // half a second of noise, which every shaker and brush is cut out of
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  /* ── the instruments ──────────────────────────────────── */

  /* One struck note: a body that rings, a softer octave above it for warmth, and
   * a very short knock at the start, which is the part the ear reads as "struck"
   * rather than "switched on". */
  function pluck(freq, at, level, length) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    g.connect(out);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = freq;
    body.connect(g);
    body.start(at); body.stop(at + length + 0.05);

    const ring = ctx.createGain();
    ring.gain.setValueAtTime(0, at);
    ring.gain.linearRampToValueAtTime(level * 0.34, at + 0.02);
    ring.gain.exponentialRampToValueAtTime(0.0001, at + length * 0.7);
    ring.connect(out);
    const over = ctx.createOscillator();
    over.type = 'sine';
    over.frequency.value = freq * 2.02;               // very slightly sharp, so it beats a little
    over.connect(ring);
    over.start(at); over.stop(at + length);

    const knock = ctx.createGain();
    knock.gain.setValueAtTime(level * 0.5, at);
    knock.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    knock.connect(out);
    const tap = ctx.createOscillator();
    tap.type = 'sine';
    tap.frequency.setValueAtTime(freq * 3, at);
    tap.frequency.exponentialRampToValueAtTime(freq, at + 0.05);
    tap.connect(knock);
    tap.start(at); tap.stop(at + 0.06);
  }

  /* The heartbeat under a question: a low sine dropped quickly in pitch, which is
   * how nearly every kick drum ever recorded is actually made. */
  function kick(at, level) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    g.connect(out);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(132, at);
    o.frequency.exponentialRampToValueAtTime(44, at + 0.13);
    o.connect(g);
    o.start(at); o.stop(at + 0.25);
  }

  /* A shaker: a snip of noise with the bottom taken out of it. Two of these
   * offbeat are the difference between a tune and something you can nod to. */
  function shake(at, level, length) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + (length || 0.09));
    src.connect(hp).connect(g).connect(out);
    src.start(at, Math.random() * 0.2); src.stop(at + (length || 0.09) + 0.02);
  }

  /* A held chord tone, for the parts of a game where nothing is being counted:
   * waiting for people to join, and reading a leaderboard. */
  function pad(freq, at, level, length) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + length * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, at + length);
    g.connect(out);
    for (const [mult, share] of [[1, 1], [1.5, 0.45], [2.006, 0.3]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      const v = ctx.createGain();
      v.gain.value = share;
      o.connect(v).connect(g);
      o.start(at); o.stop(at + length + 0.05);
    }
  }

  /* ── the pieces ───────────────────────────────────────── */

  /* Each is eight steps long. `mel` and `bass` are places in the scale (null for
   * a rest), `beat` is how long a step lasts, and the drum lines are simply which
   * steps they land on. `tension` marks the one piece that is allowed to speed up
   * and climb as a clock runs out.
   */
  const TRACKS = {
    // under the app's menu, and any screen somebody is reading rather than playing
    menu: {
      beat: 0.49, level: 0.24,
      mel:   [0, 2, 4, 2, 3, 1, 4, 2],
      bass:  [-5, null, -3, null, -4, null, -3, null],
      kick:  [], shake: [],
      chord: [0, 4]
    },

    // everyone is arriving: unhurried, wide, nothing being counted
    lobby: {
      beat: 0.44, level: 0.40,
      mel:   [4, null, 7, null, 9, 7, 4, 2],
      bass:  [-5, null, null, -3, null, null, -4, null],
      kick:  [0, 4],
      shake: [2, 6],
      chord: [0, 4]
    },

    // a question is open. This is the one the room feels: a walking bass on every
    // step, a kick on the four, and a tune that keeps arriving a beat early.
    question: {
      beat: 0.30, level: 0.46,
      mel:   [7, 9, 7, 4, 5, 7, 4, 2],
      bass:  [-5, -5, -3, -3, -4, -4, -3, -1],
      kick:  [0, 2, 4, 6],
      shake: [1, 3, 5, 7],
      tension: true
    },

    // the answer is up on the screen. The pulse stops; the tune exhales.
    reveal: {
      beat: 0.40, level: 0.33,
      mel:   [9, 7, 4, null, 2, 4, null, null],
      bass:  [-3, null, null, null, -5, null, null, null],
      kick:  [0],
      shake: [4],
      chord: [0]
    },

    // the standings, at the end. Bright, and in no hurry at all.
    podium: {
      beat: 0.38, level: 0.44,
      mel:   [4, 7, 9, 11, 9, 7, 9, 7],
      bass:  [-5, null, -3, null, -1, null, -3, null],
      kick:  [0, 4],
      shake: [2, 6],
      chord: [0, 4]
    },

    /* ── one question tune per kind of game ────────────────
     * The question is the moment a room is actually in, and hearing the same
     * eight bars in every one of fourteen games is what makes a soundtrack feel
     * like a screensaver. These are all the same length and the same key as
     * `question`, so a game can swap between them without a seam — what changes
     * is the gait: how heavily the bass walks, where the kick lands, whether
     * anything is on the offbeat.
     *
     * All of them take `tension`, so the last seconds still climb.
     */

    // a race: everything on the beat, nothing lingering
    q_race: {
      beat: 0.27, level: 0.46,
      mel:   [7, 7, 9, 11, 9, 7, 5, 4],
      bass:  [-5, -5, -5, -5, -3, -3, -3, -3],
      kick:  [0, 2, 4, 6],
      shake: [0, 1, 2, 3, 4, 5, 6, 7],
      tension: true
    },
    // a fight: heavy on the one, and a gap where the answer goes
    q_duel: {
      beat: 0.31, level: 0.47,
      mel:   [0, null, 3, 4, null, 7, 4, 3],
      bass:  [-5, -5, null, -5, -4, -4, null, -4],
      kick:  [0, 3, 4, 7],
      shake: [2, 6],
      tension: true
    },
    // something coming for you: a bass that never stops and a tune that keeps
    // stepping up, which is what the lava is doing
    q_chase: {
      beat: 0.26, level: 0.48,
      mel:   [0, 2, 4, 5, 7, 9, 11, 12],
      bass:  [-5, -5, -4, -4, -3, -3, -1, -1],
      kick:  [0, 1, 2, 3, 4, 5, 6, 7],
      shake: [1, 3, 5, 7],
      tension: true
    },
    // machinery: a shuffle on the offbeat, like something turning over
    q_works: {
      beat: 0.29, level: 0.44,
      mel:   [4, null, 4, 5, null, 7, null, 5],
      bass:  [-5, null, -5, null, -3, null, -3, null],
      kick:  [0, 4],
      shake: [1, 2, 5, 6],
      tension: true
    },
    // water: wide and slow underneath, with the tune drifting over the top
    q_water: {
      beat: 0.36, level: 0.40,
      mel:   [9, null, 7, null, 11, 9, null, 7],
      bass:  [-5, null, null, -3, null, null, -4, null],
      kick:  [0],
      shake: [2, 4, 6],
      chord: [0, 4],
      tension: true
    },
    // sneaking about: quiet, off the beat, and never quite settling
    q_sneak: {
      beat: 0.30, level: 0.42,
      mel:   [null, 4, null, 3, null, 7, null, 5],
      bass:  [-5, null, -4, null, -5, null, -3, null],
      kick:  [0, 4],
      shake: [1, 5],
      tension: true
    },
    // two sides pulling: a bass that swings between two notes and back
    q_pull: {
      beat: 0.28, level: 0.47,
      mel:   [4, 4, 7, 7, 9, 9, 7, 4],
      bass:  [-5, -5, -1, -1, -5, -5, -1, -1],
      kick:  [0, 2, 4, 6],
      shake: [3, 7],
      tension: true
    },

    /* The last ten seconds, when the board asks for it. Nothing melodic — a room
       does not need a tune at that point, it needs a clock. */
    countdown: {
      beat: 0.24, level: 0.5,
      mel:   [12, null, 11, null, 12, null, 11, null],
      bass:  [-5, -5, -5, -5, -5, -5, -5, -5],
      kick:  [0, 2, 4, 6],
      shake: [0, 1, 2, 3, 4, 5, 6, 7],
      tension: true
    },

    /* Between the games: the moment a class is picking a blook or reading their
       coins, which wants to be pleasant and completely unhurried. */
    board: {
      beat: 0.52, level: 0.26,
      mel:   [4, 7, null, 9, 7, null, 4, 2],
      bass:  [-5, null, null, -3, null, null, -4, null],
      kick:  [], shake: [4],
      chord: [0, 4, 7]
    }
  };

  /* Which question tune each game gets. Anything not named here keeps the
   * original, which is the right default: a new mode that nobody has chosen a
   * gait for should sound like Quoldek rather than like a guess. */
  const MODE_TUNE = {
    kart: 'q_race', laser: 'q_duel', boss: 'q_duel', snow: 'q_duel',
    volcano: 'q_chase', balloon: 'q_chase',
    factory: 'q_works', tower: 'q_works',
    fishing: 'q_water', treasure: 'q_water',
    heist: 'q_sneak', cards: 'q_sneak',
    tug: 'q_pull'
  };
  /** The question tune for a game, by name. */
  const tuneFor = (mode) => (MODE_TUNE[mode] && TRACKS[MODE_TUNE[mode]]) ? MODE_TUNE[mode] : 'question';

  let track = TRACKS.menu;
  let name = 'menu';
  let level = track.level;

  function schedule() {
    if (!playing) return;
    const at = ctx.currentTime + 0.06;
    const i = step % 8;
    const hot = track.tension ? urge : 0;              // 0 unless a clock is running out
    // as a question runs down, the tune climbs an octave and leans on every beat
    const lift = hot > 0.72 ? 5 : 0;

    if (track.mel[i] !== null && track.mel[i] !== undefined) {
      pluck(note(track.mel[i] + 5 + lift), at, 0.16 + hot * 0.05, 1.5);
    }
    if (track.bass[i] !== null && track.bass[i] !== undefined) {
      pluck(note(track.bass[i]), at, 0.13, 2.2);
    }
    if (track.kick.includes(i)) kick(at, 0.34 + hot * 0.16);
    if (track.shake.includes(i)) shake(at, 0.06 + hot * 0.05);
    // the last few seconds of a question put a shake on every step, which is what
    // a room hears as "hurry up" without anything shouting at it
    else if (hot > 0.55) shake(at, 0.05);

    if (i === 0) {
      bar++;
      // every fourth bar takes a breath, so it never becomes a treadmill
      if (track.chord && bar % 2 === 0) {
        for (const n of track.chord) pad(note(n) / 2, at, 0.05, track.beat * 8);
      }
      if (!track.chord && bar % 4 === 0) pluck(note(track.mel[0] + 10), at, 0.08, 2.4);
    }

    step++;
    // a question speeds up by about a fifth by the time the clock is gone
    timer = setTimeout(schedule, track.beat * (1 - hot * 0.2) * 1000);
  }

  function fade(to, seconds) {
    if (!out) return;
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(to, now + seconds);
  }

  /** Move to one of the pieces above, easing out of whatever is playing. */
  function play(which, opts) {
    wanted = true;
    const next = TRACKS[which] || TRACKS.menu;
    const loud = (opts && typeof opts.level === 'number') ? opts.level : next.level;
    if (!build()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    if (playing && next === track) { level = loud; fade(level, 0.6); return; }

    const begin = () => {
      track = next; name = which; level = loud; step = 0; bar = 0;
      if (!playing) { playing = true; schedule(); }
      fade(level, playing ? 0.7 : 2.2);
    };
    if (playing) { fade(0.0001, 0.28); setTimeout(begin, 300); }   // a breath between pieces
    else begin();
  }

  /* How close a question is to running out, 0 at the start and 1 at the end. Only
   * the question piece listens to it. */
  function tension(amount) {
    urge = Math.max(0, Math.min(1, amount || 0));
  }

  function start(opts) {
    // what the board asked for before there were separate pieces
    play((opts && opts.track) || 'menu', opts);
  }

  function stop() {
    wanted = false;
    if (!playing) return;
    playing = false;
    clearTimeout(timer);
    urge = 0;
    fade(0, 0.8);
  }

  /** A short flourish, for a moment worth marking. */
  function sting(kind) {
    if (!build()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const at = ctx.currentTime + 0.02;
    const was = out.gain.value;
    out.gain.setValueAtTime(Math.max(was, 0.5), at);

    if (kind === 'win') {
      // the one moment worth more than three notes
      [4, 7, 9, 11, 14, 16].forEach((n, i) => pluck(note(n + 5), at + i * 0.11, 0.22, 1.4));
      [0, 4, 7].forEach(n => pad(note(n) / 2, at, 0.07, 2.4));
      kick(at, 0.4); kick(at + 0.55, 0.3);
    } else if (kind === 'wrong') {
      [3, 1, -1].forEach((n, i) => pluck(note(n + 5), at + i * 0.1, 0.18, 0.9));
    } else if (kind === 'join') {
      [7, 11].forEach((n, i) => pluck(note(n + 5), at + i * 0.07, 0.14, 0.7));
    } else if (kind === 'level') {
      // a level gained: four notes going up, and one underneath holding them
      [0, 4, 7, 12].forEach((n, i) => pluck(note(n + 5), at + i * 0.08, 0.2, 1.2));
      pad(note(0) / 2, at, 0.06, 1.6);
    } else if (kind === 'unlock') {
      [7, 12, 16].forEach((n, i) => pluck(note(n + 5), at + i * 0.06, 0.18, 1.3));
    } else if (kind === 'ouch') {
      // something was taken from you, or the lava got you
      [-1, -3, -5].forEach((n, i) => pluck(note(n + 5), at + i * 0.09, 0.2, 1.1));
      kick(at + 0.2, 0.34);
    } else if (kind === 'go') {
      [0, 4, 7].forEach((n, i) => pluck(note(n + 5), at + i * 0.09, 0.2, 1.1));
      kick(at, 0.36);
    } else {
      [4, 6, 8].forEach((n, i) => pluck(note(n + 5), at + i * 0.09, 0.2, 1.1));
    }
    if (playing) fade(level, 1.2);
  }

  global.NovaMusic = {
    play, start, stop, sting, tension, tuneFor,
    get tracks() { return Object.keys(TRACKS); },
    get on() { return playing; },
    get wanted() { return wanted; },
    get track() { return playing ? name : null; },
    /** How close the question is to running out, for anything that wants to watch. */
    get pressure() { return urge; },
    /** Browsers block sound until a click; call this from one. */
    unlock() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
