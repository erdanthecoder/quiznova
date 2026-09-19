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

/* Boss Battle's fight: ten seconds, and the most one player could possibly take
 * off the boss in them. Reported damage above this is a bug or a joke. */
// the fight is one three-minute round now; its length lives in the rules
const STRIKE_CAP = 900;
/* Robot Run: the class shares one escape and one set of lives. */
const ESCAPE_TARGET = 100;
const BOOST_WORTH = 9;
const ROBOT_LIVES = 3;
const ROBOT_ROUND_MS = 75000;

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
    const mode = R.MODES[body.mode] ? body.mode : R.DEFAULT_MODE;
    const maps = R.mapsFor(mode).map(m => m.id);
    const game = {
      pin: this.newPin(), hostToken: rid(16), quizId: quiz.id, quizTitle: quiz.title,
      mode, map: maps.includes(body.map) ? body.map : maps[0],
      state: 'lobby', index: -1, questions, players: {},
      teams: { red: { hp: 0, score: 0, blocks: 0, max: 0, name: 'Crimson' },
               blue: { hp: 0, score: 0, blocks: 0, max: 0, name: 'Cobalt' },
               green: { hp: 0, score: 0, blocks: 0, max: 0, name: 'Clover' } },
      towers: R.blankTower ? { red: R.blankTower(), blue: R.blankTower(),
                               green: R.blankTower() } : null,
      monsterAt: 0,
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
      quiz: (game.state === 'arena' || game.state === 'running' || game.state === 'safe'
             || game.state === 'strike') ? questions : null,
      boss: game.boss || null,
      modeInfo: R.MODES[game.mode] || R.MODES[R.DEFAULT_MODE],
      goal: game.goal, setup: game.setup || null, rope: game.rope || 0,
      // the world's own state, and the moves this mode offers. Without these the
      // app is playing a different game from the website off the same rules.
      lava: game.lava || 0, shoal: game.shoal || '', wind: !!game.wind,
      strikeSeed: game.strikeSeed || 0, strikeMs: R.BOSS_MS,
      knifeReload: R.KNIFE_RELOAD_MS,
      escape: game.escape || 0, escapeTarget: ESCAPE_TARGET,
      towers: game.towers || null, towerSlots: R.SLOTS, monsterAt: game.monsterAt || 0,
      safeEndsAt: game.safeEndsAt || 0, safeMs: R.SAFE_MS,
      zones: game.state === 'safe'
        ? R.safeZones(game.round || 1, Object.keys(game.players).length) : null,
      zoneCounts: game.state === 'safe' ? R.zoneCounts(game) : null,
      lives: game.lives === undefined ? ROBOT_LIVES : game.lives,
      round: game.round || 1, roundEndsAt: game.roundEndsAt || 0,
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
    /* Tallest Tower splits the room three ways rather than two, because that is
       what it is: three towers racing. Whichever side is smallest gets the next
       child, so the teams stay level however late people arrive. */
    const sides = game.mode === 'tower' ? R.TOWER_TEAMS : ['red', 'blue'];
    const counts = sides.map(t => already.filter(p => p.team === t).length);
    const team = sides[counts.indexOf(Math.min(...counts))];
    const player = R.blankPlayer({
      id: rid(10), name: String(body.name || 'Player').trim().slice(0, 16) || 'Player',
      avatar: this.wantedFace(body.avatar, already.map(p => p.avatar)),
      team
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
    /* Robot Run is one long escape for the whole room. Nobody is fed a
     * question: everybody answers at their own pace and what they earn goes
     * into the same pot. */
    /* Boss Battle is one three-minute fight and nobody is in step: everybody
     * answers at their own pace out of the whole quiz, a right answer loads a
     * knife, and the knife takes one health off. It used to run question by
     * question with a ten-second fight between each, which left the quick
     * waiting and hurried the slow. */
    if (game.mode === 'boss') {
      game.state = 'strike'; game.index = 0;
      game.boss = { hp: R.BOSS_HP, max: R.BOSS_HP, name: R.pickBossName() };
      game.strikeSeed = Math.floor(Math.random() * 0xffffff);
      game.endsAt = now() + R.BOSS_MS;
      for (const p of Object.values(game.players)) {
        p.loaded = 0; p.hits = 0; p.swungAt = 0; p.score = 0; p.blade = 'stick';
      }
      return this.changed(game);
    }
    if (game.mode === 'robot') {
      game.state = 'running'; game.index = 0; game.endsAt = null;
      game.escape = 0; game.lives = ROBOT_LIVES; game.round = 1;
      game.roundEndsAt = now() + ROBOT_ROUND_MS;
      for (const p of Object.values(game.players)) {
        p.boosts = 0; p.ready = 0; p.score = 0; p.safe = true;
      }
      return this.changed(game);
    }
    if (game.mode === 'tower') game.wind = false;
    if (game.mode === 'volcano') {
      game.lava = 0;
      for (const p of Object.values(game.players)) { p.height = 0; p.safe = true; }
    }
    // everybody starts on the safe move rather than on nothing
    for (const p of Object.values(game.players)) p.move = R.defaultMove(game.mode);
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

  /* One child spending one boost. Every one goes into the same pot, because the
   * class escapes together or not at all. Counted one at a time so a phone that
   * reconnects and repeats itself cannot push the whole room to the exit. */
  boost(game, body) {
    const p = game.players[body.playerId];
    if (!p) throw Object.assign(new Error('Not in this game.'), { status: 404 });
    if (game.mode !== 'robot' || game.state !== 'running') {
      return { ok: false, why: 'Not that kind of game.' };
    }
    const seq = Math.max(0, Math.round(Number(body.seq) || 0));
    if (seq <= (p.boosts || 0)) return { ok: true, already: true };
    p.boosts = Math.min(seq, (p.boosts || 0) + 1);
    p.score = p.boosts;
    game.escape = Math.min(ESCAPE_TARGET, (game.escape || 0) + BOOST_WORTH);
    game.lastEvents.push(`${p.name} boosted`);
    game.lastEvents = game.lastEvents.slice(-6);
    /* The bar full is not the next deck yet: the class has to get off this one
     * first. Kahoot puts a mini-game between rounds — everybody moves into a
     * green safe zone, and each one holds only so many. This used to skip it
     * and simply count the deck up, which is a lap counter rather than a game. */
    if (game.escape >= ESCAPE_TARGET) {
      game.state = 'safe';
      game.safeEndsAt = now() + R.SAFE_MS;
      for (const x of Object.values(game.players)) { x.ready = 0; x.zone = ''; }
      game.lastEvents.push('The hatch is open — get to a safe zone');
    }
    this.changed(game);
    return { ok: true, escape: game.escape, round: game.round };
  }

  /* Robot Run: one child stepping into a safe zone. Full is full — the room has
   * to sort itself out, which is the whole point of the phase. */
  safe(game, body) {
    const p = game.players[body.playerId];
    if (!p) throw Object.assign(new Error('Not in this game.'), { status: 404 });
    if (game.mode !== 'robot' || game.state !== 'safe') {
      return { ok: false, why: 'Not that kind of game.' };
    }
    const out = R.claimZone(game, p, body.zone);
    if (out.ok && !out.already) {
      game.lastEvents.push(`${p.name} is in`);
      game.lastEvents = game.lastEvents.slice(-6);
    }
    this.changed(game);
    return Object.assign(out, { counts: R.zoneCounts(game) });
  }

  /* Tallest Tower: one block, placed. The offset is where the tap landed, and
   * it is kept, so a hurried drop is visible on the board for the rest of the
   * game. Counted by sequence number so a phone that reconnects and repeats
   * itself cannot build a floor on its own. */
  place(game, body) {
    const p = game.players[body.playerId];
    if (!p) throw Object.assign(new Error('Not in this game.'), { status: 404 });
    if (game.mode !== 'tower') return { ok: false, why: 'Not that kind of game.' };
    if ((p.ready || 0) <= 0) return { ok: false, why: 'No block to place.' };
    const out = R.placeBlock(game, p, body.offset, body.seq);
    if (!out.already) p.ready = Math.max(0, (p.ready || 0) - 1);
    game.lastEvents = game.lastEvents.slice(-6);
    this.changed(game);
    return out;
  }

  /* The monster, on its own clock rather than between questions — everybody is
   * answering at their own pace, so there is no "between" any more. */
  towerTick(game) {
    if (game.mode !== 'tower' || game.state !== 'question') return;
    if (!game.monsterAt) { game.monsterAt = now() + R.MONSTER_EVERY; return; }
    if (now() < game.monsterAt) return;
    game.monsterAt = now() + R.MONSTER_EVERY;
    if (R.towerMonster(game)) { game.lastEvents = game.lastEvents.slice(-6); this.changed(game); }
  }

  /* The board asking for the monster, because it comes on its own clock rather
   * than between questions and the server has no timer of its own on the web. */
  forceMonster(game) {
    if (game.mode !== 'tower') return null;
    const hit = R.towerMonster(game);
    game.monsterAt = now() + R.MONSTER_EVERY;
    game.lastEvents = game.lastEvents.slice(-6);
    this.changed(game);
    return hit;
  }

  /* Boss Battle: the question is followed by ten seconds of fighting. */
  /* One swing. Every knife takes exactly one health off, and then needs two
   * seconds before it can be used again — which is also what stops a double
   * tap counting twice, without punishing a child who is simply quick. */
  strike(game, body) {
    const p = game.players[body.playerId];
    if (!p) throw Object.assign(new Error('Not in this game.'), { status: 404 });
    if (game.mode !== 'boss' || !game.boss) return { ok: false, why: 'Not that kind of game.' };
    if (game.state !== 'strike') return { ok: false, why: 'The fight is over.' };
    if ((p.loaded || 0) <= 0) return { ok: false, why: 'Answer to load your knife.' };
    const since = now() - (p.swungAt || 0);
    if (since < R.KNIFE_RELOAD_MS) {
      return { ok: false, why: 'Reloading.', wait: R.KNIFE_RELOAD_MS - since };
    }
    p.loaded -= 1;
    p.swungAt = now();
    p.hits = (p.hits || 0) + 1;
    p.score = p.hits;
    game.boss.hp = Math.max(0, game.boss.hp - R.KNIFE_DAMAGE);
    game.lastEvents.push(`${p.name} put one in — ${game.boss.hp} left`);
    game.lastEvents = game.lastEvents.slice(-6);
    if (game.boss.hp === 0) {
      game.lastEvents.push(`${game.boss.name} is down`);
      game.state = 'over'; game.endsAt = null;
    }
    this.changed(game);
    return { ok: true, hp: game.boss.hp, hits: p.hits, loaded: p.loaded };
  }

  next(game) {
    if (game.state === 'question') { game.state = 'reveal'; game.endsAt = null; }
    else this.openQuestion(game);
    return this.changed(game);
  }

  answer(game, body) {
    const player = game.players[body.playerId];
    if (!player) throw Object.assign(new Error('You are not in this game.'), { status: 404 });

    /* Boss Battle is not in step. Everybody has the whole quiz on their phone
     * and works through it at their own pace, so an answer names the question
     * it belongs to rather than relying on one index the whole room shares —
     * and it is still graded here, because a phone should not be able to load
     * a knife by claiming it got one right. */
    if (game.mode === 'boss' && game.state === 'strike') {
      const q = game.questions.find(x => x.id === body.questionId);
      if (!q) throw Object.assign(new Error('No such question.'), { status: 400 });
      const right = R.grade(q, body.answer);
      player.streak = right ? player.streak + 1 : 0;
      player.best = Math.max(player.best, player.streak);
      const speed = Math.max(0, Math.min(1, Number(body.speed) || 0));
      player.correct = right;
      R.SCORERS.boss(game, player, q, right, speed);
      game.lastEvents = game.lastEvents.slice(-6);
      this.changed(game);
      return player;
    }

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

  /* The hatch shuts. Anybody still out in the open costs the class a life, and
   * then the next deck begins. The desktop edition's own clock calls this; the
   * live edition has no clock of its own, so its board asks for it — which is
   * why it is a method and not three lines inside tick(). Named apart from
   * settle(), which is the question's: one shadowed the other, and a scramble
   * that should have lasted fifteen seconds was over in one. */
  settleSafe(game) {
    if (game.mode !== 'robot' || game.state !== 'safe') return { ok: false };
    R.settleSafe(game);
    game.safeEndsAt = 0;
    if (!game.lives) {
      game.lastEvents.push('The robot got them');
      game.state = 'over'; game.endsAt = null;
    } else {
      game.round = (game.round || 1) + 1;
      game.escape = 0;
      game.state = 'running';
      game.roundEndsAt = now() + ROBOT_ROUND_MS;
      game.lastEvents.push(`Deck ${game.round}`);
    }
    game.lastEvents = game.lastEvents.slice(-6);
    return { ok: true };
  }

  /* The clock, called on a timer by the server: a question can run out with
   * nobody having answered, and a time limit can run out mid-question. */
  tick(game) {
    this.towerTick(game);

    /* The safe zones have their own clock. When it runs out anybody still
     * outside one costs the class a life, and then the hatch opens on the next
     * deck — which is the moment the board flies them somewhere new. */
    if (game.state === 'safe' && game.safeEndsAt && now() >= game.safeEndsAt) {
      this.settleSafe(game);
      return this.changed(game);
    }
    // a deck that runs out of time is the robot reaching the room
    if (game.state === 'running' && game.mode === 'robot'
        && game.roundEndsAt && now() >= game.roundEndsAt) {
      game.lives = Math.max(0, (game.lives === undefined ? ROBOT_LIVES : game.lives) - 1);
      game.escape = 0;
      game.roundEndsAt = now() + ROBOT_ROUND_MS;
      for (const x of Object.values(game.players)) x.ready = 0;
      game.lastEvents.push(game.lives
        ? `The robot caught up — ${game.lives} live${game.lives === 1 ? '' : 's'} left`
        : 'The robot got them');
      if (!game.lives) { game.state = 'over'; game.endsAt = null; }
      return this.changed(game);
    }
    if (game.state === 'strike' && game.endsAt && now() >= game.endsAt) {
      // three minutes gone and it is still standing
      game.lastEvents.push(`${(game.boss && game.boss.name) || 'The boss'} survived the class`);
      game.state = 'over'; game.endsAt = null;
      return this.changed(game);
    }
    const before = game.state;
    if (game.state === 'question' && game.endsAt && now() >= game.endsAt) {
      game.state = 'reveal';
      game.endsAt = null;
      for (const p of Object.values(game.players)) {
        if (!p.answered) p.streak = 0;
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
