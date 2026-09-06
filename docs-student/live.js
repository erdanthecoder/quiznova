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
  const { MODES, MAPS, GOALS, SCORERS, mapsFor, defaultMap, readGoal, goalReached,
          grade, blankPlayer, pickBossName, readSetup, secondsFor, arrange, modeFinished,
          afterRound, buyMachine, machineCost, SPOTS,
          TRACK_LENGTH, BOSS_HP_PER_QUESTION, FORT_BLOCKS, BALLOONS } = R;


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

  async function readGame(pin) {
    const rows = await rest('GET', `/quiznova_live_games?pin=eq.${encodeURIComponent(pin)}&select=data`);
    if (!rows || !rows.length) throw Object.assign(new Error('That game code is not live.'), { status: 404 });
    return rows[0].data;
  }

  const writeGame = (pin, data) =>
    rest('PATCH', `/quiznova_live_games?pin=eq.${encodeURIComponent(pin)}`,
         { data, updated_at: new Date().toISOString() }, { prefer: 'return=minimal' });

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
      quiz: game.mode === 'laser' && game.state === 'arena' ? questions : null,
      setup: game.setup || null, rope: game.rope || 0, lava: game.lava || 0,
      boss: game.boss || null, trackLength: TRACK_LENGTH, modeInfo: MODES[game.mode] || MODES.normal,
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
        (SCORERS[game.mode] || SCORERS.normal)(game, player, question, ok, Math.max(0, Math.min(1, row.speed || 0)));
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
        everyone.forEach(p => {
          if (p.answered) return;
          p.streak = 0;
          // letting the clock run out cannot be the safe move: in Balloon Drop it
          // costs a balloon, the same as answering wrongly
          if (game.mode === 'balloon' && p.balloons > 0) {
            p.balloons -= 1;
            game.lastEvents.push(`${p.name} ran out of time — ${p.balloons} balloon${p.balloons === 1 ? '' : 's'} left`);
          }
        });
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

  async function handle(path, method, body) {
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
        mode: MODES[body.mode] ? body.mode : 'normal',
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
      const red = already.filter(p => p.team === 'red').length;
      const blue = already.filter(p => p.team === 'blue').length;
      const row = {
        id: rid(10), pin, name: (body.name || 'Player').slice(0, 16),
        avatar: String(wantedFace(body.avatar, already.map(p => p.avatar))),
        team: red <= blue ? 'red' : 'blue'
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

    if (!isHost) throw new Error('Only the host can control the game.');

    if (tail === '/start') {
      await reconcile(pin, game);
      game.startedAt = now();
      if (game.mode === 'laser') {
        // one long round: the arena runs until the teacher stops it, and each
        // child's own energy bar decides when they break off to answer
        game.state = 'arena';
        game.index = 0;
        game.endsAt = null;
        await writeGame(pin, game);
        return publicView(game);
      }
      if (game.mode === 'snow') {
        // a fort per team, sized so a small class still gets to knock one down
        for (const side of ['red', 'blue']) {
          const n = Object.values(game.players).filter(p => p.team === side).length;
          game.teams[side].blocks = Math.max(6, Math.min(FORT_BLOCKS, 3 + n * 2));
          game.teams[side].max = game.teams[side].blocks;
        }
      }
      if (game.mode === 'balloon') {
        for (const p of Object.values(game.players)) p.balloons = BALLOONS;
      }
      if (game.mode === 'tug') game.rope = 0;
      if (game.mode === 'volcano') {
        game.lava = 0;
        for (const p of Object.values(game.players)) { p.height = 0; p.safe = true; }
      }
      if (game.mode === 'factory') {
        for (const p of Object.values(game.players)) { p.coins = 0; p.machines = 0; p.output = 0; }
      }
      if (game.mode === 'fishing') {
        for (const p of Object.values(game.players)) { p.weight = 0; p.target = 'shallows'; p.catch = ''; }
      }
      if (game.mode === 'cards') {
        for (const p of Object.values(game.players)) { p.cards = []; p.spares = 0; }
      }
      if (game.mode === 'boss') {
        const hp = BOSS_HP_PER_QUESTION * Math.max(1, game.questions.length);
        game.boss = { hp, max: hp, name: pickBossName(),
                      classHp: 100, classMax: 100 };
      }
      openQuestion(game);
      await writeGame(pin, game);
      return publicView(game);
    }
    /* Factory's one decision, and Fishing's. Both happen between questions and
     * both are the player's own, so neither needs the host token — but both are
     * checked against the game's own state rather than trusting what arrived. */
    if (tail === '/build') {
      const p = game.players[body && body.playerId];
      if (!p) return { error: 'Not in this game.' };
      const out = buyMachine(game, p);
      if (out.ok) await writeGame(pin, game);
      return Object.assign({ view: publicView(game) }, out);
    }
    if (tail === '/cast') {
      const p = game.players[body && body.playerId];
      if (!p) return { error: 'Not in this game.' };
      const where = SPOTS[body && body.spot] ? body.spot : 'shallows';
      p.target = where;
      await writeGame(pin, game);
      return { ok: true, spot: where, view: publicView(game) };
    }
    if (tail === '/next') {
      if (game.state === 'question') { game.state = 'reveal'; game.endsAt = null; afterRound(game); }
      else openQuestion(game);
      await writeGame(pin, game);
      return publicView(game);
    }
    if (tail === '/tick') { await reconcile(pin, game); return publicView(game); }
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
    const [totals, live] = await Promise.all([
      rest('GET', '/quoldek_totals?id=eq.all&select=games,players,started_on'),
      rest('GET', '/quiznova_live_games?select=pin', undefined, { prefer: 'count=exact' })
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
                      configured: Boolean(URL_BASE && PUBLISHABLE) };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaLive;
