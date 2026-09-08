/* Live games, run on this computer.
 *
 * On the website the phones and the board keep in step through a database on
 * the internet. Here they keep in step through this: the game lives in memory
 * on the teacher's own laptop and every phone in the room talks to it directly
 * over the school's wifi. Nothing leaves the building, and it works with the
 * internet unplugged — which, in a school, it very often effectively is.
 *
 * The rules themselves are not here. They are in static/rules.js, shared with
 * the website, so a game plays identically whichever way it is run.
 */
/* The rules come from the same file the website uses. Packaged, static/ sits
 * beside the app rather than inside it, so look there first. */
const path = require('path');
const findStatic = () => {
  const fs = require('fs');
  for (const dir of [path.join(process.resourcesPath || '', 'app', 'static'),
                     path.join(__dirname, 'static'),
                     path.join(__dirname, '..', 'static')]) {
    try { if (fs.existsSync(path.join(dir, 'rules.js'))) return dir; } catch { /* keep looking */ }
  }
  return path.join(__dirname, '..', 'static');
};
const STATIC = findStatic();
const R = require(path.join(STATIC, 'rules.js'));
const { rid, now } = require('./store.js');

const ARENA_SECONDS = 20;
const GAME_LIFETIME = 6 * 60 * 60 * 1000;   // a game nobody ended is forgotten after six hours

class Games {
  constructor() {
    this.games = new Map();
    this.watchers = new Map();              // pin → Set of listeners
  }

  /* Six digits, and never one already in use. */
  newPin() {
    for (let i = 0; i < 200; i++) {
      const pin = String(Math.floor(100000 + Math.random() * 900000));
      if (!this.games.has(pin)) return pin;
    }
    return String(Date.now()).slice(-6);
  }

  sweep() {
    const cutoff = now() - GAME_LIFETIME;
    for (const [pin, game] of this.games) if (game.createdAt < cutoff) this.games.delete(pin);
  }

  get(pin) { return this.games.get(pin) || null; }

  create(quiz, body) {
    this.sweep();
    const setup = R.readSetup(Object.assign(
      { shuffle: !!(quiz.settings && quiz.settings.shuffleQuestions) }, body.setup || {}));
    const questions = R.arrange(JSON.parse(JSON.stringify(quiz.questions)), setup);
    const mode = R.MODES[body.mode] ? body.mode : 'normal';
    const maps = R.mapsFor(mode).map(m => m.id);
    const game = {
      pin: this.newPin(), hostToken: rid(16), quizId: quiz.id, quizTitle: quiz.title,
      mode, map: maps.includes(body.map) ? body.map : maps[0],
      state: 'lobby', index: -1, questions, players: {},
      teams: { red: { hp: 0, score: 0, blocks: 0, max: 0, name: 'Crimson' },
               blue: { hp: 0, score: 0, blocks: 0, max: 0, name: 'Cobalt' } },
      goal: R.readGoal(body.goal), setup, music: body.music !== false, startedAt: 0,
      counts: {}, lastEvents: [], endsAt: null, createdAt: now()
    };
    this.games.set(game.pin, game);
    return game;
  }

  /* What every device is allowed to see. The answers to a question that is still
   * open are not in it — a child with the page open would otherwise be able to
   * read them straight off the wire. */
  publicView(game) {
    const questions = game.questions;
    const idx = Math.max(0, Math.min(game.index, questions.length - 1));
    const q = questions[idx];
    let question = null;
    if (q && game.index >= 0) {
      const reveal = game.state === 'reveal' || game.state === 'over';
      question = {
        id: q.id, type: q.type, text: q.text, image: q.image,
        time: R.secondsFor(game, q), points: q.points,
        choices: (q.choices || []).map(c => (reveal ? { id: c.id, text: c.text, correct: !!c.correct }
                                                    : { id: c.id, text: c.text }))
      };
      if (reveal) { question.explanation = q.explanation || ''; question.answer = q.answer || ''; }
    }
    const players = Object.values(game.players).sort((a, b) => b.score - a.score);
    return {
      pin: game.pin, mode: game.mode, map: game.map, state: game.state, index: idx,
      total: questions.length, quizTitle: game.quizTitle, quizId: game.quizId,
      question, endsAt: game.endsAt, serverNow: now(), players, teams: game.teams,
      counts: game.counts, lastEvents: game.lastEvents,
      quiz: game.mode === 'laser' && game.state === 'arena' ? questions : null,
      boss: game.boss || null, trackLength: R.TRACK_LENGTH,
      modeInfo: R.MODES[game.mode] || R.MODES.normal,
      goal: game.goal, setup: game.setup || null, rope: game.rope || 0,
      // the world's own state, and the moves this mode offers. Without these the
      // app is playing a different game from the website off the same rules.
      lava: game.lava || 0, shoal: game.shoal || '', wind: !!game.wind,
      moves: R.movesFor(game.mode), moveAsk: (R.MOVES[game.mode] || {}).ask || '',
      startedAt: game.startedAt,
      music: game.music !== false
    };
  }

  /* ── the things a device asks for ──────────────────── */

  join(game, body) {
    if (game.state === 'over') throw Object.assign(new Error('This game has finished.'), { status: 400 });
    if (game.state !== 'lobby' && game.setup && game.setup.lateJoin === false) {
      throw Object.assign(new Error('This game has already started.'), { status: 400 });
    }
    const already = Object.values(game.players);
    const red = already.filter(p => p.team === 'red').length;
    const blue = already.filter(p => p.team === 'blue').length;
    const player = R.blankPlayer({
      id: rid(10), name: String(body.name || 'Player').trim().slice(0, 16) || 'Player',
      avatar: this.wantedFace(body.avatar, already.map(p => p.avatar)),
      team: red <= blue ? 'red' : 'blue'
    });
    game.players[player.id] = player;
    this.changed(game);
    return player;
  }

  /* Two players are told apart across a room by colour and silhouette, so that
   * pair must be unique; the eyes and mouth are their own business. */
  wantedFace(wanted, taken) {
    const S = require(path.join(STATIC, 'sprites.js'));
    const n = Number(wanted);
    const used = new Set((taken || []).map(S.looksLike));
    if (!Number.isFinite(n) || n < 0) return Number(S.freeFace([...used]));
    const part = S.partsOf(n);
    for (let step = 0; step < S.SHAPES; step++) {
      const tryThis = S.pack(Object.assign({}, part, { shape: part.shape + step }));
      if (!used.has(S.looksLike(tryThis))) return tryThis;
    }
    return Number(S.freeFace([...used]));
  }

  start(game) {
    game.startedAt = now();
    if (game.mode === 'laser') {
      game.state = 'arena'; game.index = 0; game.endsAt = null;
      return this.changed(game);
    }
    if (game.mode === 'snow') {
      for (const side of ['red', 'blue']) {
        const n = Object.values(game.players).filter(p => p.team === side).length;
        const blocks = Math.max(6, Math.min(R.FORT_BLOCKS, 3 + n * 2));
        game.teams[side].blocks = blocks;
        game.teams[side].max = blocks;
      }
    }
    if (game.mode === 'tug') game.rope = 0;
    if (game.mode === 'tower') game.wind = false;
    if (game.mode === 'fishing') game.shoal = 'channel';
    if (game.mode === 'volcano') {
      game.lava = 0;
      for (const p of Object.values(game.players)) { p.height = 0; p.safe = true; }
    }
    if (game.mode === 'factory') {
      for (const p of Object.values(game.players)) { p.coins = 0; p.machines = 0; p.output = 0; }
    }
    // everybody starts on the safe move rather than on nothing
    for (const p of Object.values(game.players)) p.move = R.defaultMove(game.mode);
    if (game.mode === 'cards') {
      for (const p of Object.values(game.players)) { p.cards = []; p.spares = 0; }
    }
    if (game.mode === 'balloon') {
      for (const p of Object.values(game.players)) p.balloons = R.BALLOONS;
    }
    if (game.mode === 'boss') {
      const hp = R.BOSS_HP_PER_QUESTION * Math.max(1, game.questions.length);
      game.boss = { hp, max: hp, name: R.pickBossName(), classHp: 100, classMax: 100,
                    next: 'poke', says: 'is sizing the class up' };
    }
    this.openQuestion(game);
    return this.changed(game);
  }

  openQuestion(game) {
    game.index += 1;
    if (game.index >= game.questions.length) { game.state = 'over'; game.endsAt = null; return; }
    game.counts = {};
    for (const p of Object.values(game.players)) {
      p.answered = false; p.correct = null; p.lastGain = 0; p.chest = '';
      p.lastDamage = 0; p.target = '';
      // the move stands until it is changed, the same as on the website
      if (!p.move) p.move = R.defaultMove(game.mode);
    }
    game.state = 'question';
    game.endsAt = now() + R.secondsFor(game, game.questions[game.index]) * 1000 + 700;
  }

  next(game) {
    if (game.state === 'question') { game.state = 'reveal'; game.endsAt = null; }
    else this.openQuestion(game);
    return this.changed(game);
  }

  answer(game, body) {
    const player = game.players[body.playerId];
    if (!player) throw Object.assign(new Error('You are not in this game.'), { status: 404 });
    if (game.state !== 'question') throw Object.assign(new Error('No question is open.'), { status: 400 });
    if (player.answered) throw Object.assign(new Error('You have already answered.'), { status: 400 });
    const question = game.questions[game.index];
    const ok = R.grade(question, body.answer);
    player.answered = true;
    player.correct = ok;
    player.streak = ok ? player.streak + 1 : 0;
    player.best = Math.max(player.best, player.streak);
    const key = typeof body.answer === 'string' ? body.answer : JSON.stringify(body.answer);
    game.counts[key] = (game.counts[key] || 0) + 1;
    const speed = Math.max(0, Math.min(1, Number(body.speed) || 0));
    (R.SCORERS[game.mode] || R.SCORERS.normal)(game, player, question, ok, speed);
    game.lastEvents = game.lastEvents.slice(-6);
    this.settle(game);
    this.changed(game);
    return player;
  }

  /* Has anything ended the game — the teacher's own ending, a game that has won
   * itself, or simply everybody having answered? */
  settle(game) {
    const everyone = Object.values(game.players);
    if (game.state !== 'lobby' && game.state !== 'over' && R.goalReached(game)) {
      game.state = 'over'; game.endsAt = null;
    } else if (game.state !== 'lobby' && game.state !== 'over' && R.modeFinished(game)) {
      game.state = 'over'; game.endsAt = null;
    } else if (game.state === 'question' && everyone.length && everyone.every(p => p.answered)) {
      game.state = 'reveal'; game.endsAt = null;
    }
  }

  /* The clock, called on a timer by the server: a question can run out with
   * nobody having answered, and a time limit can run out mid-question. */
  tick(game) {
    const before = game.state;
    if (game.state === 'question' && game.endsAt && now() >= game.endsAt) {
      game.state = 'reveal';
      game.endsAt = null;
      for (const p of Object.values(game.players)) {
        if (p.answered) continue;
        p.streak = 0;
        // letting the clock run out cannot be the safe move
        if (game.mode === 'balloon' && p.balloons > 0) {
          p.balloons -= 1;
          game.lastEvents.push(`${p.name} ran out of time — ${p.balloons} balloon${p.balloons === 1 ? '' : 's'} left`);
        }
      }
    }
    this.settle(game);
    if (game.state !== before) this.changed(game);
    return game.state !== before;
  }

  end(game) { game.state = 'over'; game.endsAt = null; this.changed(game); }

  /* ── telling every device ──────────────────────────── */
  watch(pin, fn) {
    if (!this.watchers.has(pin)) this.watchers.set(pin, new Set());
    this.watchers.get(pin).add(fn);
    return () => {
      const set = this.watchers.get(pin);
      if (!set) return;
      set.delete(fn);
      if (!set.size) this.watchers.delete(pin);
    };
  }

  changed(game) {
    const view = this.publicView(game);
    for (const fn of this.watchers.get(game.pin) || []) {
      try { fn(view); } catch { /* a device that has gone away is not our problem */ }
    }
    return view;
  }
}

module.exports = { Games, ARENA_SECONDS, STATIC: STATIC, rules: R };
