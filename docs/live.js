/* Quoldek live games, without a server of our own.
 *
 * GitHub Pages only serves files, so the sync has to happen somewhere else:
 * three small Supabase tables reached with the PUBLISHABLE key (the one meant
 * to ship in browser code — the secret service key is not used here and the
 * quizzes/results table stays out of anon's reach entirely).
 *
 * The host device is the referee: players insert their answers, and the host
 * reads them, scores them and publishes the next state. One writer means no
 * merge conflicts and the scoring rules live in one place.
 */
(function (global) {
  'use strict';

  const URL_BASE = 'https://blkwilonabowayxefxpx.supabase.co';
  const PUBLISHABLE = 'sb_publishable_GT9kBg_L8Y2rT4n2DybBQA_nO93VP-4';
  const REST = URL_BASE + '/rest/v1';

  const HEADERS = {
    apikey: PUBLISHABLE,
    authorization: 'Bearer ' + PUBLISHABLE,
    'content-type': 'application/json'
  };

  async function rest(method, path, body, extra) {
    const res = await fetch(REST + path, {
      method,
      headers: Object.assign({}, HEADERS, extra || {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) {
      let message = `Supabase ${res.status}`;
      try { message = JSON.parse(text).message || message; } catch { /* not json */ }
      throw Object.assign(new Error(message), { status: res.status });
    }
    return text ? JSON.parse(text) : null;
  }

  const now = () => Date.now();
  const rid = (n = 10) => Math.random().toString(36).slice(2, 2 + n);
  /* Characters are numbers, drawn by sprites.js. A number is handed out once per
   * game so no two children in the same room are the same character, and it is
   * stored with the player so it never changes underneath them. */
  const freeFace = (taken) => (global.Sprite ? global.Sprite.freeFace(taken) : (taken || []).length);

  /* The character a child asked for, or the closest one still free. Two children
   * with the same colour and silhouette cannot be told apart across a classroom,
   * so a taken choice keeps its colour and steps the silhouette on. */
  function wantedFace(wanted, taken) {
    const S = global.Sprite;
    const n = Number(wanted);
    if (!S || !Number.isFinite(n) || n < 0) return freeFace(taken);
    // only the colour and the shape have to differ; the eyes, mouth and markings
    // are the player's own and may be shared with anyone
    const used = new Set((taken || []).map(S.looksLike));
    const part = S.partsOf(n);
    for (let step = 0; step < S.SHAPES; step++) {
      const tryThis = S.pack(Object.assign({}, part, { shape: part.shape + step }));
      if (!used.has(S.looksLike(tryThis))) return String(tryThis);
    }
    return freeFace(taken);
  }

  /* The rules of the games live in rules.js, so the site, the desktop app and
   * this engine cannot drift apart. Everything below is about getting them to
   * thirty phones through a shared database. */
  const R = global.NovaRules || (typeof require === 'function' ? require('./rules.js') : null);
  const { MODES, MAPS, GOALS, SCORERS, MOVES, chooseMove, movesFor, defaultMove,
          mapsFor, defaultMap, readGoal, goalReached,
          grade, blankPlayer, pickBossName, readSetup, secondsFor, arrange, modeFinished,
          afterRound, DEFAULT_MODE, BOSS_HP_PER_QUESTION } = R;

  /* Boss Battle's fight: ten seconds, and the most one player could take off it
   * in that time with the best weapon and never missing a beat. Reported damage
   * above this is a bug or a joke and is treated as both. */
  // the fight is one three-minute round now; its length lives in the rules
  const STRIKE_CAP = 900;
  /* Robot Run. The class shares one escape and one set of lives: the robot is
   * chasing the room, not any one child. */
  const ESCAPE_TARGET = 100;      // how full the bar is when the deck is cleared
  const BOOST_WORTH = 9;          // so about a dozen boosts between everybody
  const ROBOT_LIVES = 3;
  const ROBOT_ROUND_MS = 75000;   // how long a deck lasts before it costs a life


  /* ── state helpers ────────────────────────────────────── */

  /* Who is in the room, for a device that is not the host.
   *
   * Only the host writes the game, so the stored copy does not know about a
   * player until the host next looks. That is fine for scores, which the host
   * works out — but not for the lobby, where a child who has just joined would
   * see an empty room, including themselves missing. So the players table is
   * read directly and merged in for display. Nothing is written: the host is
   * still the only writer.
   */
  function withPlayers(game, rows) {
    if (!rows || !rows.length) return game;
    const merged = Object.assign({}, game.players);
    for (const row of rows) {
      if (!merged[row.id]) merged[row.id] = blankPlayer(row);
    }
    // a player the host has already dropped is gone; anything else is shown
    return Object.assign({}, game, { players: merged });
  }

  /* ── one game, many writers ────────────────────────────
   *
   * The comment further down used to say "only the host reconciles, so there is
   * exactly one writer". That was never true: a phone writes the game every
   * time it puts a boost in, swings a knife, drops a block or takes a safe
   * zone. Every one of those wrote the whole game back, and so did the board on
   * every poll — so whoever wrote last silently erased what everybody else had
   * just done. Alone in a test it looks perfect. In a room of thirty it means
   * the escape bar never moves, the boss never loses health and a tower never
   * grows, which is exactly what was reported from the classroom.
   *
   * So a read now brings back the revision it saw, and a write refuses to land
   * if the game has moved on since. The caller re-reads and does the work again
   * on the new state; nothing is lost, and nobody has to take turns.
   */
  const gameRev = new WeakMap();      // the game object → the rev it was read at

  async function readGame(pin) {
    const rows = await rest('GET',
      `/quiznova_live_games?pin=eq.${encodeURIComponent(pin)}&select=data,rev`);
    if (!rows || !rows.length) throw Object.assign(new Error('That game code is not live.'), { status: 404 });
    const data = rows[0].data;
    if (data && typeof data === 'object') gameRev.set(data, Number(rows[0].rev) || 0);
    return data;
  }

  /** Thrown when the game moved under us. Caught by handle(), which tries again. */
  const STALE = 'nova:stale-game';

  async function writeGame(pin, data) {
    const seen = gameRev.get(data);
    /* A game this process never read — the one made a moment ago by /games —
       has nothing to be stale against, so it is written plainly. */
    const guard = seen === undefined ? '' : `&rev=eq.${seen}`;
    const rows = await rest('PATCH',
      `/quiznova_live_games?pin=eq.${encodeURIComponent(pin)}${guard}`,
      { data, rev: (seen === undefined ? 0 : seen) + 1, updated_at: new Date().toISOString() },
      { prefer: 'return=representation' });
    if (guard && (!rows || !rows.length)) {
      // somebody else wrote first; our copy is out of date
      throw Object.assign(new Error(STALE), { stale: true });
    }
    if (rows && rows.length && data && typeof data === 'object') {
      gameRev.set(data, Number(rows[0].rev) || (seen || 0) + 1);
    }
    return rows;
  }

  /** The public shape the host and player pages already know how to render. */
  function publicView(game) {
    const questions = game.questions || [];
    const idx = game.index;
    let question = null;
    if (idx >= 0 && idx < questions.length && (game.state === 'question' || game.state === 'reveal')) {
      const q = questions[idx];
      const reveal = game.state === 'reveal';
      question = {
        id: q.id, type: q.type, text: q.text, image: q.image || '',
        // the length the teacher chose for this game, not the one the quiz was
        // written with, so every screen counts down the same number
        points: q.points, time: secondsFor(game, q),
        choices: (q.choices || []).map(c => reveal ? { id: c.id, text: c.text, correct: c.correct }
                                                   : { id: c.id, text: c.text })
      };
      if (reveal) { question.explanation = q.explanation || ''; question.answer = q.answer || ''; }
    }
    const players = Object.values(game.players || {}).sort((a, b) => b.score - a.score);
    return {
      pin: game.pin, mode: game.mode, map: game.map || defaultMap(game.mode),
      state: game.state, index: idx, total: questions.length,
      quizTitle: game.quizTitle, quizId: game.quizId, question, endsAt: game.endsAt, serverNow: now(),
      players, teams: game.teams, counts: game.counts || {}, lastEvents: game.lastEvents || [],
      // Laser Tag asks each child their own questions as their bar runs out, so
      // their phone needs the set. A child who digs into the page can read the
      // answers; the same is true of every game of this shape.
      // Laser Tag and Monster Run both run at each child's own pace, so their
      // phones need the questions rather than being fed one at a time. A child
      // who digs into the page can read the answers; that is true of every game
      // of this shape and always has been.
      quiz: (game.state === 'arena' || game.state === 'running' || game.state === 'safe'
             || game.state === 'strike' || game.state === 'building') ? questions : null,
      setup: game.setup || null, rope: game.rope || 0, lava: game.lava || 0,
      doubleAt: game.doubleAt === undefined ? -1 : game.doubleAt,
      // the world's own state: without these the wind and the shoal are things
      // that happen to the scores with nothing on screen to explain them
      shoal: game.shoal || '', wind: !!game.wind,
      // Boss Battle's fight: the script every device runs, and how long is left
      strikeSeed: game.strikeSeed || 0, strikeMs: R.BOSS_MS,
      bossSwingAt: (game.boss && game.boss.nextSwing) || 0,
      bossTell: R.BOSS_TELL_MS, bossMood: R.bossMood(game.boss),
      knifeReload: R.KNIFE_RELOAD_MS,
      // Robot Run's shared escape: one bar, one set of lives, for the whole room
      escape: game.escape || 0, escapeTarget: ESCAPE_TARGET,
      towers: game.towers || null, towerSlots: R.SLOTS, monsterAt: game.monsterAt || 0,
      gorillaMs: R.GORILLA_MS,
      safeEndsAt: game.safeEndsAt || 0, safeMs: R.SAFE_MS,
      zones: game.state === 'safe'
        ? R.safeZones(game.round || 1, Object.keys(game.players).length) : null,
      zoneCounts: game.state === 'safe' ? R.zoneCounts(game) : null,
      lives: game.lives === undefined ? ROBOT_LIVES : game.lives,
      round: game.round || 1, roundEndsAt: game.roundEndsAt || 0,
      moves: movesFor(game.mode), moveAsk: (MOVES[game.mode] || {}).ask || '',
      /* trackLength went with the racing mode when the fourteen were cut to
         four. The constant was deleted; this reference was not, and because it
         was a bare name rather than a property it threw a ReferenceError every
         single time a game was read — so every board on the live site sat on
         "Reconnecting…" for ever, reconnecting to a game it could see perfectly
         well. Nothing caught it because the live engine had no test. */
      boss: game.boss || null, modeInfo: MODES[game.mode] || MODES[DEFAULT_MODE],
      goal: game.goal || { kind: 'questions', value: 0 },
      startedAt: game.startedAt || 0, music: game.music !== false
    };
  }

  /** Open the question itself and start its clock. */
  function beginQuestion(game) {
    game.state = 'question';
    game.endsAt = now() + secondsFor(game, game.questions[game.index]) * 1000 + 700;
  }

  /* Laser Tag runs on a two-beat round, the way a shooting game does: a short
   * countdown where everyone lines up a shot, then one question that decides
   * whether the shot lands. Every other game goes straight to the question. */
  function openQuestion(game) {
    game.index += 1;
    game.counts = {}; game.lastEvents = [];
    if (game.index >= game.questions.length) { game.state = 'over'; game.endsAt = null; return; }
    Object.values(game.players).forEach(p => {
      p.answered = false; p.correct = null; p.lastDamage = 0; p.lastGain = 0; p.chest = '';
      // the move stands until it is changed: not touching your phone is a choice
      // to do the same again, and it is the one a busy child will make
      if (!p.move) p.move = defaultMove(game.mode);
    });
    beginQuestion(game);
  }

  const readPlayers = (pin) =>
    rest('GET', `/quiznova_live_players?pin=eq.${encodeURIComponent(pin)}&select=*`);
  const readAnswers = (pin, index) => index < 0 ? Promise.resolve([])
    : rest('GET', `/quiznova_live_answers?pin=eq.${encodeURIComponent(pin)}&q_index=eq.${index}&select=*`);

  /* ── the host's reconcile step: pull answers, score them ─ */
  async function reconcile(pin, game, prefetched) {
    const [playerRows, answerRows] = prefetched || await Promise.all([
      readPlayers(pin), readAnswers(pin, game.index)
    ]);

    let changed = false;

    // anyone new in the lobby
    for (const row of playerRows || []) {
      if (!game.players[row.id]) { game.players[row.id] = blankPlayer(row); changed = true; }
      else if (game.players[row.id].team !== (row.team || 'red') && game.state === 'lobby') {
        game.players[row.id].team = row.team || 'red'; changed = true;
      }
    }

    if (game.state === 'arena') {
      // the scores are earned in the arena and each phone saves its own
      for (const row of playerRows || []) {
        const player = game.players[row.id];
        if (player && Number(row.score || 0) !== player.score) {
          player.score = Number(row.score || 0); changed = true;
        }
      }
    }

    if (game.state === 'question') {
      const question = game.questions[game.index];
      for (const row of (answerRows || []).sort((a, b) => new Date(a.at) - new Date(b.at))) {
        const player = game.players[row.player_id];
        if (!player || player.answered) continue;
        const ok = grade(question, row.answer);
        player.answered = true;
        player.correct = ok;
        player.streak = ok ? player.streak + 1 : 0;
        player.best = Math.max(player.best, player.streak);
        const key = typeof row.answer === 'string' ? row.answer : JSON.stringify(row.answer);
        game.counts[key] = (game.counts[key] || 0) + 1;
        (SCORERS[game.mode] || SCORERS[DEFAULT_MODE])(game, player, question, ok, Math.max(0, Math.min(1, row.speed || 0)));
        changed = true;
      }
      game.lastEvents = game.lastEvents.slice(-6);

      const everyone = Object.values(game.players);
      if (modeFinished(game)) {
        game.state = 'over'; game.endsAt = null; changed = true;
      } else if (everyone.length && everyone.every(p => p.answered)) {
        game.state = 'reveal'; game.endsAt = null; afterRound(game); changed = true;
      } else if (game.endsAt && now() >= game.endsAt) {
        game.state = 'reveal'; game.endsAt = null;
        everyone.forEach(p => { if (!p.answered) p.streak = 0; });
        afterRound(game);
        changed = true;
      }
    }

    /* The teacher's own ending — a score to reach or a clock — applies whatever
     * the game is doing, including the Laser Tag arena, which never has a
     * question open for the checks above to run inside. */
    if (game.state !== 'lobby' && game.state !== 'over' && goalReached(game)) {
      game.state = 'over'; game.endsAt = null; changed = true;
    }

    if (changed) await writeGame(pin, game);
    return game;
  }

  /* ── the API the pages call ───────────────────────────── */
  // Nova.store writes JSON, so read it the same way rather than comparing quotes
  /* Who is the teacher.
   *
   * This used to be answered by browser storage alone, and storage fails
   * silently: a browser set to keep no site data saves nothing, and then the
   * board could not prove it was the teacher — Start did nothing and the game
   * never advanced, because only the host's own polling drives it. The token
   * the page was already sending with every command was ignored.
   *
   * So it is now answered from three places, cheapest first: what this page has
   * already proved in this session, what the browser managed to save, and what
   * the caller sent. A token only counts as proof when it matches the one the
   * game itself holds, which is checked below before anything is remembered.
   */
  const claimed = new Map();                 // pin → token, for this page's lifetime

  const hostTokenFor = (pin) => {
    if (claimed.has(pin)) return claimed.get(pin);
    try { return JSON.parse(localStorage.getItem('nova:host:' + pin)); } catch { return null; }
  };

  /** Remember a token that has just been shown to be the game's own. */
  const rememberHost = (pin, token) => {
    claimed.set(pin, token);
    try { localStorage.setItem('nova:host:' + pin, JSON.stringify(token)); } catch { /* no storage */ }
  };

  /* The host's poll needs the game, the players and this question's answers. Waiting
   * for the game row before asking for the other two doubles the round trip on a
   * school connection, so remember which question is open and ask for all three at
   * once — the host is the only device that moves the question on, so this cache
   * is only ever stale on the single poll after a page reload, which then refetches. */
  const openIndex = Object.create(null);

  /* What a player is allowed to ask for on their own behalf. Everything else on
   * a live game belongs to the teacher's device. */
  const PLAYER_OWNED = new Set(['/join', '/answer', '/team', '/score', '/move', '/strike',
                                '/boost', '/place', '/safe',
                                '/events']);   // read-only, and every device reads it

  /* Every request is one attempt at the work. If the game moved under it, the
     attempt is thrown away and made again against the game as it now is — which
     is the only safe way to retry, because the work is written in terms of the
     state it read. */
  async function handle(path, method, body) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await attemptOnce(path, method, body);
      } catch (err) {
        if (!err || !err.stale || attempt >= 6) {
          if (err && err.stale) {
            throw new Error('The game is busy — everybody moved at once. Try that again.');
          }
          throw err;
        }
        // a short, uneven wait, so thirty phones do not all come back together
        await new Promise(r => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1)));
      }
    }
  }

  async function attemptOnce(path, method, body) {
    if (path === '/modes') {
      return { modes: Object.entries(MODES).map(([id, m]) => Object.assign({ id, maps: mapsFor(id) }, m)) };
    }

    const m = path.match(/^\/games(?:\/([^/]+))?(\/.*)?$/);
    if (!m) return null;
    const [, pin, tail] = m;

    if (!pin && method === 'POST') {                       // create
      const quiz = body.quiz;
      if (!quiz || !quiz.questions || !quiz.questions.length) {
        throw new Error('Add at least one question first.');
      }
      // the quiz's own shuffle setting is the starting point; what the teacher
      // picked on the way into this game wins over it
      const setup = readSetup(Object.assign(
        { shuffle: !!(quiz.settings && quiz.settings.shuffleQuestions) }, body.setup || {}));
      const questions = arrange(JSON.parse(JSON.stringify(quiz.questions)), setup);
      const newPin = String(Math.floor(100000 + Math.random() * 900000));
      const game = {
        pin: newPin, hostToken: rid(16), quizId: quiz.id, quizTitle: quiz.title,
        mode: MODES[body.mode] ? body.mode : DEFAULT_MODE,
        map: '',
        goal: readGoal(body.goal),
        setup,
        music: body.music !== false,
        state: 'lobby', index: -1, questions, players: {},
        teams: { red: { hp: 0, score: 0, blocks: 0, max: 0, name: 'Crimson' },
                 blue: { hp: 0, score: 0, blocks: 0, max: 0, name: 'Cobalt' } },
        counts: {}, lastEvents: [], createdAt: now()
      };
      const maps = mapsFor(game.mode).map(m => m.id);
      game.map = maps.includes(body.map) ? body.map : defaultMap(game.mode);
      await rest('POST', '/quiznova_live_games', { pin: newPin, data: game }, { prefer: 'return=minimal' });
      return { pin: newPin, hostToken: game.hostToken, mode: game.mode, quizTitle: quiz.title, total: questions.length };
    }

    let prefetched = null, game, roster = null;
    if (!tail && method === 'GET') {
      const host = hostTokenFor(pin) != null;
      const guess = openIndex[pin] ?? -1;
      // everyone reads the players; the host also needs this question's answers
      const [row, playerRows, answerRows] = await Promise.all([
        readGame(pin), readPlayers(pin), host ? readAnswers(pin, guess) : null
      ]);
      game = row;
      roster = playerRows;
      if (host) {
        prefetched = game.index === guess ? [playerRows, answerRows]
                                          : [playerRows, await readAnswers(pin, game.index)];
      }
    } else {
      game = await readGame(pin);
    }
    openIndex[pin] = game.index;
    /* A command that carries the right token is the teacher, whatever this
       browser did or did not manage to save. It is only believed because it is
       compared against the token the game itself holds. */
    if (body && body.hostToken && body.hostToken === game.hostToken) {
      rememberHost(pin, body.hostToken);
    }
    const isHost = hostTokenFor(pin) === game.hostToken;

    if (!tail && method === 'GET') {
      // only the host reconciles, so there is exactly one writer
      if (isHost) await reconcile(pin, game, prefetched);
      // a phone still shows the room it can see, rather than the host's last look
      return publicView(isHost ? game : withPlayers(game, roster));
    }

    if (tail === '/join' && method === 'POST') {
      if (game.state === 'over') throw new Error('This game has finished.');
      if (game.state !== 'lobby' && game.setup && game.setup.lateJoin === false) {
        throw new Error('This game has already started.');
      }
      // ask the table, not the host's copy: someone may have joined a second ago
      const already = await readPlayers(pin) || [];
      /* Tallest Tower splits the room three ways rather than two, because that
         is what it is: three towers racing. Whichever side is smallest gets the
         next child, so the teams stay level however late people arrive. */
      const sides = game.mode === 'tower' ? R.TOWER_TEAMS : ['red', 'blue'];
      const counts = sides.map(t => already.filter(p => p.team === t).length);
      const row = {
        id: rid(10), pin, name: (body.name || 'Player').slice(0, 16),
        avatar: String(wantedFace(body.avatar, already.map(p => p.avatar))),
        team: sides[counts.indexOf(Math.min(...counts))]
      };
      await rest('POST', '/quiznova_live_players', row, { prefer: 'return=minimal' });
      // the reply is the first thing the new player sees, so it counts them in
      return { player: blankPlayer(row),
               game: publicView(withPlayers(game, already.concat([row]))) };
    }

    if (tail === '/score' && method === 'POST') {
      await rest('PATCH', `/quiznova_live_players?id=eq.${encodeURIComponent(body.playerId)}`,
                 { score: Math.max(0, Math.round(Number(body.score) || 0)) }, { prefer: 'return=minimal' });
      return { ok: true };
    }

    if (tail === '/team' && method === 'POST') {
      const rows = await rest('GET', `/quiznova_live_players?id=eq.${encodeURIComponent(body.playerId)}&select=team`);
      const next = rows && rows[0] && rows[0].team === 'red' ? 'blue' : 'red';
      await rest('PATCH', `/quiznova_live_players?id=eq.${encodeURIComponent(body.playerId)}`,
                 { team: next }, { prefer: 'return=minimal' });
      return { team: next };
    }

    if (tail === '/answer' && method === 'POST') {
      /* Boss Battle is not in step. Everybody has the whole quiz on their phone
         and works through it at their own pace, so an answer names the question
         it belongs to rather than relying on one index the whole room shares —
         and it is still graded here, because a phone should not be able to load
         a knife by claiming it got one right. */
      if (game.mode === 'boss' && game.state === 'strike') {
        const p = game.players[body && body.playerId];
        if (!p) return { error: 'Not in this game.' };
        const q = game.questions.find(x => x.id === (body && body.questionId));
        if (!q) throw new Error('No such question.');
        const right = grade(q, body.answer);
        p.streak = right ? p.streak + 1 : 0;
        p.best = Math.max(p.best, p.streak);
        const fast = Math.max(0, Math.min(1, Number(body.speed) || 0));
        p.correct = right;
        SCORERS.boss(game, p, q, right, fast);
        if (right) p.downUntil = 0;         // a right answer gets you up
        game.lastEvents = game.lastEvents.slice(-6);
        await writeGame(pin, game);
        return { ok: true, correct: right, loaded: p.loaded || 0, blade: p.blade,
                 hits: p.hits || 0, view: publicView(game) };
      }
      // and the same for a child building a tower at their own pace
      if (game.mode === 'tower' && game.state === 'building') {
        const p = game.players[body && body.playerId];
        if (!p) return { error: 'Not in this game.' };
        const q = game.questions.find(x => x.id === (body && body.questionId));
        if (!q) throw new Error('No such question.');
        const right = grade(q, body.answer);
        p.streak = right ? p.streak + 1 : 0;
        p.best = Math.max(p.best, p.streak);
        const fast = Math.max(0, Math.min(1, Number(body.speed) || 0));
        p.correct = right;
        SCORERS.tower(game, p, q, right, fast);
        game.lastEvents = game.lastEvents.slice(-6);
        await writeGame(pin, game);
        return { ok: true, correct: right, ready: p.ready || 0, blocks: p.blocks || 0,
                 view: publicView(game) };
      }
      if (game.state !== 'question') throw new Error('No question is open.');
      const limit = secondsFor(game, game.questions[game.index]) * 1000;
      const left = Math.max(0, (game.endsAt || now()) - now());
      try {
        await rest('POST', '/quiznova_live_answers', {
          pin, player_id: body.playerId, q_index: game.index,
          answer: body.answer, speed: limit ? Math.max(0, Math.min(1, left / limit)) : 0
        }, { prefer: 'return=minimal' });
      } catch (err) {
        if (err.status === 409) throw new Error('Already answered.');   // the primary key caught it
        throw err;
      }
      // the host scores it on its next pass; the player waits for that state
      return { correct: null, score: 0, hp: 100, streak: 0, state: game.state };
    }

    /* The three things a player decides for themselves, and they have to stay
     * on this side of the line below. They were under it, which meant every one
     * of them answered "Only the host can control the game" to the only people
     * who would ever call them — casting a line and building a machine had been
     * dead on the website since the day they were written. None needs the host
     * token, being the player's own, but all three are checked against the
     * game's own state rather than trusting what arrived. */
    /* What one player did with their ten seconds.
     *
     * The phone that swung the sword is the one that says so, the same trust
     * model the Laser Tag arena has always used: thirty children fighting is
     * thirty small messages rather than one device simulating a room. The
     * damage is clamped to what the round could possibly have produced, so a
     * fumbled message or a bored child with the console open cannot delete a
     * boss in one go. */
    if (tail === '/strike') {
      const p = game.players[body && body.playerId];
      if (!p) return { error: 'Not in this game.' };
      if (game.mode !== 'boss' || !game.boss) return { ok: false, why: 'Not that kind of game.' };
      if (game.state !== 'strike') return { ok: false, why: 'The fight is over.' };
      if (R.bossDown(p)) {
        return { ok: false, why: 'Knocked down — answer to get back up.',
                 wait: p.downUntil - now(), down: true };
      }
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
      await writeGame(pin, game);
      return { ok: true, hp: game.boss.hp, hits: p.hits, loaded: p.loaded,
               view: publicView(game) };
    }

    /* One child spending one boost.
     *
     * Every boost goes into the same pot, because the class escapes together or
     * not at all — that is the whole difference between this and a race. It is
     * counted one at a time rather than as a running total the phone reports,
     * so a phone that reconnects and repeats itself cannot push the whole room
     * to the exit on its own. */
    if (tail === '/boost') {
      const p = game.players[body && body.playerId];
      if (!p) return { error: 'Not in this game.' };
      if (game.mode !== 'robot') return { ok: false, why: 'Not that kind of game.' };
      if (game.state !== 'running') return { ok: false, why: 'Not running.' };
      const seq = Math.max(0, Math.round(Number(body.seq) || 0));
      if (seq <= (p.boosts || 0)) return { ok: true, already: true, view: publicView(game) };
      p.boosts = Math.min(seq, (p.boosts || 0) + 1);
      p.score = p.boosts;
      game.escape = Math.min(ESCAPE_TARGET, (game.escape || 0) + BOOST_WORTH);
      game.lastEvents.push(`${p.name} boosted`);
      game.lastEvents = game.lastEvents.slice(-6);
      /* The bar full is not the next deck yet: the class has to get off this
         one first. Kahoot puts a mini-game between rounds — everybody moves into
         a green safe zone, and each one holds only so many. This used to skip it
         and simply count the deck up, which is a lap counter rather than a game. */
      if (game.escape >= ESCAPE_TARGET) {
        game.state = 'safe';
        game.safeEndsAt = now() + R.SAFE_MS;
        for (const x of Object.values(game.players)) { x.ready = 0; x.zone = ''; }
        game.lastEvents.push('The hatch is open — get to a safe zone');
      }
      await writeGame(pin, game);
      return { ok: true, escape: game.escape, round: game.round, view: publicView(game) };
    }

    /* Robot Run: one child stepping into a safe zone. Full is full — the room
     * has to sort itself out, which is the whole point of the phase. */
    if (tail === '/safe') {
      const p = game.players[body && body.playerId];
      if (!p) return { error: 'Not in this game.' };
      if (game.mode !== 'robot' || game.state !== 'safe') {
        return { ok: false, why: 'Not that kind of game.' };
      }
      const out = R.claimZone(game, p, body.zone);
      // stepping out is news too: the place they had is free again
      if (out.ok && !out.already && (out.zone || out.left)) {
        game.lastEvents.push(out.zone ? `${p.name} is in` : `${p.name} stepped back out`);
        game.lastEvents = game.lastEvents.slice(-6);
      }
      await writeGame(pin, game);
      return Object.assign(out, { counts: R.zoneCounts(game), view: publicView(game) });
    }

    /* The safe phase has its own clock, and the board runs it — the same way it
     * runs the monster in Tallest Tower, because nothing else is awake to. */
    /* The boss's swing. On the desktop edition the server's own clock runs it;
       here the board asks, because nothing else in the room is awake. */
    if (tail === '/swing') {
      if (game.mode !== 'boss' || game.state !== 'strike' || !game.boss) return { ok: false };
      if (game.boss.nextSwing && now() < game.boss.nextSwing) {
        return { ok: true, early: true, view: publicView(game) };
      }
      const out = R.bossSwing(game);
      await writeGame(pin, game);
      return { ok: true, swing: out, view: publicView(game) };
    }

    if (tail === '/settle') {
      /* Tallest Tower's gorilla climbs down on a clock too. On the desktop
         edition the server's own timer does both; here nothing is awake but
         the board, so the board asks — and it asks on this one route rather
         than growing a second one that does the same job. */
      if (game.mode === 'tower') {
        if (!R.towerSettle(game)) return { ok: true, nothing: true };
        await writeGame(pin, game);
        return { ok: true, view: publicView(game) };
      }
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
      await writeGame(pin, game);
      return { ok: true, view: publicView(game) };
    }

    /* Tallest Tower: one block, placed. The offset is where the tap landed, and
     * it is kept on the block, so a hurried drop is visible on the board for the
     * rest of the game. Counted by sequence number for the same reason a boost
     * is: a phone that reconnects and repeats itself cannot build a floor on
     * its own. */
    if (tail === '/place') {
      const p = game.players[body && body.playerId];
      if (!p) return { error: 'Not in this game.' };
      if (game.mode !== 'tower') return { ok: false, why: 'Not that kind of game.' };
      if ((p.ready || 0) <= 0) return { ok: false, why: 'No block to place.' };
      const out = R.placeBlock(game, p, body.offset, body.seq);
      if (!out.already) p.ready = Math.max(0, (p.ready || 0) - 1);
      game.lastEvents = game.lastEvents.slice(-6);
      await writeGame(pin, game);
      return Object.assign(out, { view: publicView(game) });
    }

    /* The monster, asked for by the board on its own clock rather than between
     * questions — everybody is answering at their own pace, so there is no
     * "between" any more. Only the host may call it. */
    if (tail === '/monster') {
      if (game.mode !== 'tower') return { ok: false };
      R.towerSettle(game);
      const hit = R.towerMonster(game);
      game.monsterAt = now() + R.MONSTER_EVERY;
      game.lastEvents = game.lastEvents.slice(-6);
      await writeGame(pin, game);
      return { ok: true, hit, view: publicView(game) };
    }

    /* The move: which way this player is playing the round. Every mode has them
     * now, so this is the busiest thing in here — it is written while the
     * question is still up, and read when the answer is scored. The rules decide
     * whether a move is real and whether what it is aimed at makes sense; this
     * only carries the message. */
    if (tail === '/move') {
      const p = game.players[body && body.playerId];
      if (!p) return { error: 'Not in this game.' };
      const out = chooseMove(game, p, body && body.move, (body && body.on) || '');
      if (out.ok) await writeGame(pin, game);
      return Object.assign({ view: publicView(game) }, out);
    }

    /* Past here is the teacher's alone — but which requests are the teacher's is
     * now stated rather than implied by where they happen to sit in this
     * function. Three player-owned endpoints had drifted below this line and
     * were answering "only the host" to the only people who ever called them.
     * A list cannot drift. */
    if (!isHost && !PLAYER_OWNED.has(tail)) {
      throw new Error('Only the host can control the game.');
    }

    if (tail === '/start') {
      await reconcile(pin, game);
      game.startedAt = now();
      game.doubleAt = R.pickDouble((game.questions || []).length);
      /* Monster Run never gathers the class on one question. It starts and then
       * everybody is simply running, answering at their own speed, until the
       * teacher stops it or they get out. */
      /* Robot Run is one long escape, not a series of rounds. Nobody is fed a
       * question: everybody answers at their own pace, and what they earn goes
       * into the same pot. */
      /* Tallest Tower, self-paced: the whole quiz goes to every phone and each
         child works through it at their own speed, earning blocks as they go. */
      if (game.mode === 'tower') {
        game.state = 'building'; game.index = 0; game.endsAt = null;
        game.monsterAt = now() + R.MONSTER_EVERY;
        for (const p of Object.values(game.players)) {
          p.blocks = 0; p.ready = 0; p.placed = 0; p.score = 0;
        }
        await writeGame(pin, game);
        return publicView(game);
      }
      if (game.mode === 'robot') {
        game.state = 'running';
        game.index = 0;
        game.endsAt = null;
        game.escape = 0;            // how far the class has got, together
        game.lives = ROBOT_LIVES;   // and what it has left to lose
        game.round = 1;
        game.roundEndsAt = now() + ROBOT_ROUND_MS;
        for (const p of Object.values(game.players)) {
          p.boosts = 0; p.ready = 0; p.score = 0; p.safe = true;
        }
        await writeGame(pin, game);
        return publicView(game);
      }
      if (game.mode === 'laser') {
        // one long round: the arena runs until the teacher stops it, and each
        // child's own energy bar decides when they break off to answer
        game.state = 'arena';
        game.index = 0;
        game.endsAt = null;
        await writeGame(pin, game);
        return publicView(game);
      }
      if (game.mode === 'tower') game.wind = false;
      if (game.mode === 'boss' && game.boss) {
        game.boss.next = 'poke';
        game.boss.says = 'is sizing the class up';
        game.boss.classMax = game.boss.classHp;
      }
      // everybody starts on the safe move rather than on nothing
      for (const p of Object.values(game.players)) p.move = defaultMove(game.mode);
      if (game.mode === 'volcano') {
        game.lava = 0;
        for (const p of Object.values(game.players)) { p.height = 0; p.safe = true; }
      }
      /* Boss Battle is one three-minute fight and nobody is in step: everybody
         answers at their own pace out of the whole quiz, a right answer loads a
         knife, and the knife takes one health off. It ran question by question
         with a ten-second fight between each, which left the quick waiting and
         hurried the slow. */
      if (game.mode === 'boss') {
        game.state = 'strike'; game.index = 0;
        game.boss = { hp: R.BOSS_HP, max: R.BOSS_HP, name: pickBossName() };
        game.strikeSeed = Math.floor(Math.random() * 0xffffff);
        game.endsAt = now() + R.BOSS_MS;
        game.boss.nextSwing = now() + R.BOSS_SWING_MS;
        for (const p of Object.values(game.players)) {
          p.loaded = 0; p.hits = 0; p.swungAt = 0; p.score = 0; p.blade = 'stick';
          p.downUntil = 0; p.blocks = 0;   // nobody starts a fight on the floor
        }
        await writeGame(pin, game);
        return publicView(game);
      }
      openQuestion(game);
      await writeGame(pin, game);
      return publicView(game);
    }
    if (tail === '/next') {
      /* The self-paced modes have nothing to advance: everybody is on their own
         question and there is no "next" to press. Without this a stray call —
         an old board, a double tap — would drop a whole class of tower builders
         back into lock-step mid-game. */
      const ownPace = ['building', 'strike', 'running', 'safe', 'arena'];
      if (ownPace.includes(game.state)) return publicView(game);
      if (game.state === 'question') { game.state = 'reveal'; game.endsAt = null; afterRound(game); }
      else openQuestion(game);
      await writeGame(pin, game);
      return publicView(game);
    }
    if (tail === '/tick') {
      /* The fight runs on its own clock and nobody presses anything to end it,
       * so the host's own poll is what closes it. */
      /* Robot Run has no question clock, but a deck does run out. When it does
       * the robot reaches the room, it costs a life, and the deck starts again
       * — which is the moment a class starts shouting at each other to answer. */
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
        await writeGame(pin, game);
        return publicView(game);
      }
      if (game.state === 'strike' && game.endsAt && now() >= game.endsAt) {
        openQuestion(game);
        await writeGame(pin, game);
        return publicView(game);
      }
      await reconcile(pin, game);
      return publicView(game);
    }
    if (tail === '/end') { game.state = 'over'; game.endsAt = null; await writeGame(pin, game); return publicView(game); }

    return null;
  }

  /* How much Quoldek is really played.
   *
   * The database counts this itself: a trigger bumps a total whenever a game is
   * actually hosted or somebody actually joins one. Nothing here can invent a
   * number — the page can only read what playing has already produced. Live
   * games are counted straight off the table, which is swept of old ones, so
   * that figure is genuinely "right now".
   */
  async function stats() {
    if (!URL_BASE || !PUBLISHABLE) return null;
    /* Only games written to recently. Counting every row in the table was
       counting litter: a game that a class walked away from stays there until
       the hourly sweep removes it, and before that sweep existed the table held
       31 rows going back a week while one game was actually on. A live game
       writes on every question, so an hour of silence means it is over whether
       or not anybody pressed the button. */
    const fresh = new Date(Date.now() - 3600e3).toISOString();
    const [totals, live] = await Promise.all([
      rest('GET', '/quoldek_totals?id=eq.all&select=games,players,started_on'),
      rest('GET', '/quiznova_live_games?select=pin&updated_at=gte.'
                  + encodeURIComponent(fresh), undefined, { prefer: 'count=exact' })
        .catch(() => [])
    ]);
    const row = (totals && totals[0]) || null;
    if (!row) return null;
    return {
      games: Number(row.games) || 0,
      players: Number(row.players) || 0,
      since: row.started_on || '',
      liveNow: Array.isArray(live) ? live.length : 0
    };
  }

  /* ── homework by short code ───────────────────────────────
   *
   * A quiz used to travel inside its own link, which made a homework link
   * hundreds of characters long: unreadable in Google Classroom, impossible to
   * read out, and it broke the moment anything reformatted it. The quiz is put
   * in the database instead and the link carries six characters.
   *
   * The alphabet leaves out the letters and digits people confuse when copying
   * by hand — no l, i, o, 0 or 1 — so a code read off a board is the code that
   * gets typed.
   */
  const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
  const newCode = () => Array.from({ length: 6 },
    () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

  /** Put a quiz where a short link can find it. Returns the code. */
  async function shareQuiz(quiz) {
    if (!URL_BASE || !PUBLISHABLE) throw new Error('Sharing needs a connection.');
    const slim = {
      id: quiz.id, title: quiz.title, subject: quiz.subject || '',
      settings: quiz.settings || {}, questions: quiz.questions || []
    };
    // a code is six characters, so a clash is possible rather than impossible
    for (let go = 0; go < 5; go++) {
      const code = newCode();
      try {
        await rest('POST', '/quoldek_homework', { code, quiz: slim }, { prefer: 'return=minimal' });
        return code;
      } catch (err) {
        if (!/duplicate|conflict/i.test(err.message)) throw err;
      }
    }
    throw new Error('Could not make a link just now. Try again.');
  }

  /** The quiz behind a short code. */
  async function sharedQuiz(code) {
    const rows = await rest('GET',
      `/quoldek_homework?code=eq.${encodeURIComponent(String(code).toLowerCase())}&select=quiz`);
    if (!rows || !rows.length) {
      throw Object.assign(new Error('That homework link is not valid.'), { status: 404 });
    }
    return rows[0].quiz;
  }

  global.NovaLive = { handle, stats, shareQuiz, sharedQuiz, MODES, GOALS,
                      /* The store itself, one step below the API. A test needs
                         it to stand where a device stands in the middle of a
                         poll — holding a game it read a moment ago, about to
                         write it back — which is the moment the whole room's
                         work used to disappear. Nothing in the app calls
                         these. */
                      readRaw: readGame, writeRaw: writeGame,
                      configured: Boolean(URL_BASE && PUBLISHABLE) };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaLive;
