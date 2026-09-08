/* The rules of the live games, kept in one place.
 *
 * These are the rules themselves and nothing else: no database, no network, no
 * page. Three things run them — the site's in-browser engine, the desktop app's
 * own server, and (mirrored, in Python) the Flask edition — so they live here
 * rather than being copied into each. quizapi.py is the one copy that cannot
 * share this file, and a check in the test suite compares the two.
 */
(function (global) {
  'use strict';

  const now = () => Date.now();

  const MODES = {
    normal:   { label: 'Normal',       icon: 'target', blurb: 'Fastest right answer scores the most' },
    laser:    { label: 'Laser Tag',    icon: 'laser', blurb: 'One arena. Move, shoot, and answer when your energy runs out' },
    kart:     { label: 'Kart Race',    icon: 'kart', blurb: 'Every right answer drives your kart further' },
    tower:    { label: 'Tower Build',  icon: 'bricks', blurb: 'Stack a block for each right answer' },
    treasure: { label: 'Treasure Run', icon: 'gem', blurb: 'Collect coins and open lucky chests' },
    boss:     { label: 'Boss Battle',  icon: 'dragon', blurb: 'The whole class fights one boss together' },
    snow:     { label: 'Snowball Fight', icon: 'snow', blurb: 'Two teams. Every right answer knocks a block off their fort' },
    balloon:  { label: 'Balloon Drop', icon: 'balloon', blurb: 'Three balloons each. Get one wrong and one pops' },
    tug:      { label: 'Tug of War',   icon: 'rope', blurb: 'Two teams, one rope. Every right answer pulls it your way' },
    heist:    { label: 'Gold Heist',   icon: 'coin', blurb: 'Every right answer opens a chest — and some of them rob somebody' },
    cards:    { label: 'Card Collector', icon: 'cards', blurb: 'Win a card for every right answer. First to all eight' },
    volcano:  { label: 'Volcano Climb', icon: 'flame', blurb: 'Climb, and keep climbing — the lava is rising under everyone' },
    factory:  { label: 'Factory',       icon: 'bricks', blurb: 'Buy machines with what you earn. They pay you every round after' },
    fishing:  { label: 'Fishing Frenzy', icon: 'drop', blurb: 'Cast near or far. The deep water pays more and gives less' }
  };
  /* Each game is played on a map the teacher picks. A map is scenery and a palette:
   * it changes what the board looks like, not how the scoring works. */
  const MAPS = {
    normal:   [['hall', 'School Hall'], ['space', 'Space Station'], ['jungle', 'Jungle Clearing']],
    laser:    [['arena', 'Neon Arena'], ['bunker', 'Bunker'], ['moon', 'Moon Base']],
    kart:     [['city', 'City Circuit'], ['desert', 'Desert Dash'], ['ice', 'Ice Track']],
    tower:    [['site', 'Building Site'], ['candy', 'Candy Land'], ['castle', 'Castle Walls']],
    treasure: [['cave', 'Cave of Coins'], ['beach', 'Pirate Beach'], ['vault', 'The Vault']],
    boss:     [['lair', 'Dragon Lair'], ['volcano', 'Volcano'], ['ruins', 'Old Ruins']],
    snow:     [['playground', 'Playground'], ['forest', 'Winter Forest'], ['peak', 'Mountain Peak']],
    balloon:  [['fair', 'Summer Fair'], ['clouds', 'Above the Clouds'], ['night', 'Night Sky']],
    tug:      [['field', 'Sports Field'], ['deck', 'Ship Deck'], ['lowg', 'Low Gravity']],
    heist:    [['mine', 'Old Mine'], ['bank', 'The Bank'], ['island', 'Treasure Island']],
    cards:    [['attic', 'The Attic'], ['market', 'Card Market'], ['museum', 'The Museum']],
    volcano:  [['crater', 'The Crater'], ['ashfall', 'Ashfall'], ['obsidian', 'Obsidian Cliffs']],
    factory:  [['works', 'The Works'], ['foundry', 'Foundry'], ['orbital', 'Orbital Yard']],
    fishing:  [['pier', 'The Old Pier'], ['reef', 'Coral Reef'], ['ice', 'Ice Hole']]
  };
  /* How a game finishes. Playing every question is the default, but a class with
   * ten minutes left before lunch wants the clock to decide, and a race to a
   * score plays quite differently — it is over the moment somebody gets there,
   * whether that is question four or question forty. */
  const GOALS = {
    questions: { label: 'All the questions', values: [] },
    points:    { label: 'First to a score', values: [250, 500, 1000, 2000] },
    time:      { label: 'A time limit', values: [3, 5, 10, 15, 20] }   // minutes
  };
  function readGoal(goal) {
    const kind = goal && GOALS[goal.kind] ? goal.kind : 'questions';
    if (kind === 'questions') return { kind, value: 0 };
    const allowed = GOALS[kind].values;
    const value = allowed.includes(Number(goal.value)) ? Number(goal.value) : allowed[1];
    return { kind, value };
  }

  /** Has the game reached whatever the teacher said would end it? */
  function goalReached(game) {
    const goal = game.goal || { kind: 'questions' };
    if (goal.kind === 'points') {
      return Object.values(game.players).some(p => (p.score || 0) >= goal.value);
    }
    if (goal.kind === 'time') {
      return !!game.startedAt && now() >= game.startedAt + goal.value * 60000;
    }
    return false;
  }

  /* ── what the teacher can change before the game starts ──
   *
   * The quiz says how long a question is and what it is worth; a live game may
   * want something else entirely — a fast five minutes before lunch, or a slow
   * round with a class who need thinking time — without editing the quiz and
   * changing it for everyone who plays it afterwards. So these sit on the game,
   * not on the quiz, and every one of them falls back to what the quiz already
   * said when it is left alone.
   */
  const SETUP = {
    seconds:    { label: 'Seconds a question', values: [0, 10, 15, 20, 30, 45, 60] },  // 0 = as the quiz says
    points:     { label: 'Points a question', values: [0, 50, 100, 200, 500] },        // 0 = as the quiz says
    streaks:    { label: 'Bonus for a run of right answers', on: true },
    // both orders are left alone unless asked for: a teacher who put the easy
    // ones first meant it, and a question ending "all of the above" is written
    // in an order that means something
    shuffle:    { label: 'Questions in a new order every game', on: false },
    // off unless asked for: a question whose options are "1, 2, 3" or that ends
    // with "all of the above" is written in an order that means something
    mix:        { label: 'Answers in a new order too', on: false },
    lateJoin:   { label: 'Let people join after it starts', on: true },
    doubleLast: { label: 'Last question is worth double', on: false }
  };

  function readSetup(raw) {
    const given = raw && typeof raw === 'object' ? raw : {};
    const setup = {};
    for (const [key, spec] of Object.entries(SETUP)) {
      if (spec.values) {
        const n = Number(given[key]);
        setup[key] = spec.values.includes(n) ? n : spec.values[0];
      } else {
        setup[key] = given[key] === undefined ? spec.on : !!given[key];
      }
    }
    return setup;
  }

  /** How long this question runs for, in seconds. */
  function secondsFor(game, question) {
    const chosen = game.setup && game.setup.seconds;
    return chosen || (question && question.time) || 20;
  }

  /** What this question is worth, before speed and streaks. */
  function pointsFor(game, question) {
    const chosen = game.setup && game.setup.points;
    let base = chosen || (question && question.points) || 100;
    if (game.setup && game.setup.doubleLast && game.questions
        && game.index === game.questions.length - 1) base *= 2;
    return base;
  }

  /** The multiplier for answering several right in a row, unless it is switched off. */
  function streakBonus(game, player) {
    if (game.setup && game.setup.streaks === false) return 1;
    return 1 + Math.min(player.streak, 5) * 0.1;
  }

  /* Questions in a new order, and the answers within them, so a class playing the
   * same quiz twice is not simply remembering that it was the third one. */
  function arrange(questions, setup) {
    let out = questions;
    if (setup.shuffle) out = out.slice().sort(() => Math.random() - 0.5);
    if (setup.mix) {
      out = out.map(q => (q.choices && q.choices.length > 1)
        ? Object.assign({}, q, { choices: q.choices.slice().sort(() => Math.random() - 0.5) })
        : q);
    }
    return out;
  }

  const mapsFor = (mode) => (MAPS[mode] || MAPS.normal).map(([id, label]) => ({ id, label }));
  const defaultMap = (mode) => (MAPS[mode] || MAPS.normal)[0][0];

  const TRACK_LENGTH = 1000, BOSS_HP_PER_QUESTION = 55;
  const ROPE_LENGTH = 100;         // how far a team must drag the rope to win
  // eight cards to collect. They are shapes rather than pictures of things, so
  // they draw at any size and mean the same in any language.
  const CARD_SET = ['star', 'moon', 'leaf', 'flame', 'drop', 'bolt', 'gem', 'crown'];
  const SPARES_PER_SWAP = 3;       // duplicates a child can trade for a card they need
  const FORT_BLOCKS = 12;          // how tall each team's fort starts
  const BALLOONS = 3;              // how many wrong answers a child can afford
  const MAX_PLAYER_HIT = 40;

  /* ── marking, shared with the rest of the app ─────────── */
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function grade(question, given) {
    const right = (question.choices || []).filter(c => c.correct).map(c => c.id);
    if (question.type === 'mc' || question.type === 'tf') return !!given && right.includes(given);
    if (question.type === 'multi') {
      if (!Array.isArray(given) || !right.length) return false;
      return given.length === right.length && right.every(id => given.includes(id));
    }
    if (question.type === 'short') {
      const accepted = String(question.answer || '').split(/\s*[|,]\s*/).map(norm).filter(Boolean);
      return accepted.length ? accepted.includes(norm(given)) : false;
    }
    return false;
  }

  /* ── the move: what turns a quiz into a game ──────────────
   *
   * Every mode used to score the same way. Strip the words off and it was
   * score = f(right?, how fast), fourteen times over, with different nouns
   * painted on the front: a tower stacked blocks, a kart drove metres, a
   * snowball knocked bricks, and all three were the same arithmetic. The only
   * real decisions in the whole game were a laser target, a fishing spot and a
   * factory machine. Everywhere else a decision might have gone there was a
   * Math.random(), which is not a game — it is a slot machine that a quiz pulls
   * the lever on.
   *
   * So: a player now picks a MOVE every round, on their phone, while the
   * question is up. It costs no class time, because it happens in the seconds
   * they are already looking at the screen.
   *
   * The split is the point:
   *   the answer decides WHETHER your move works,
   *   the move decides WHAT HAPPENS when it does.
   *
   * Knowing the answer is still how you win. But two children who both know it
   * now have completely different rounds, and a child who is behind has
   * something to do about it other than answer faster than physics allows.
   *
   * Moves that only touch the player who made them are resolved in the scorer.
   * Moves that touch somebody else — robbing, guarding, throwing a shell,
   * kicking a rock — only record an intention there, and are settled together in
   * resolve() once every answer is in. Otherwise the game would be decided by
   * who happened to tap first, which is a test of wifi, not of anything else.
   */
  const MOVES = {
    normal: {
      ask: 'How much are you risking?', when: 'question',
      list: [
        { id: 'safe',   label: 'Play it safe', note: 'The points, as normal' },
        { id: 'double', label: 'Double down',  note: 'Twice as much. Wrong costs you half of it' },
        { id: 'allin',  label: 'All in',       note: 'Three times. Wrong and you lose the round entirely' }
      ]
    },
    laser: {
      ask: 'How are you playing this one?', when: 'question',
      list: [
        { id: 'aim',   label: 'Take aim',   note: 'Normal shot at whoever you picked' },
        { id: 'push',  label: 'Push up',    note: 'Hit twice as hard, and take twice as much back' },
        { id: 'cover', label: 'Take cover', note: 'Half a shot, and you shield whoever is weakest' }
      ]
    },
    kart: {
      ask: 'Which line are you taking?', when: 'question',
      list: [
        { id: 'steady', label: 'Hold the line', note: 'Steady metres. A spin costs you nothing' },
        { id: 'slip',   label: 'Slipstream',    note: 'The further behind you are, the more you gain' },
        { id: 'inside', label: 'Dive inside',   note: 'Big metres. Get it wrong and you spin back' }
      ]
    },
    tower: {
      ask: 'How are you building?', when: 'question',
      list: [
        { id: 'wide',  label: 'Build wide',  note: 'One block. It will never fall' },
        { id: 'tall',  label: 'Build tall',  note: 'Three blocks, but the tower starts to sway' },
        { id: 'brace', label: 'Brace it',    note: 'No blocks. Steadies everything you have' }
      ]
    },
    treasure: {
      ask: 'Which chest are you opening?', when: 'question',
      list: [
        { id: 'bronze', label: 'The bronze chest', note: 'Always something. Never much' },
        { id: 'silver', label: 'The silver chest', note: 'Usually good' },
        { id: 'gold',   label: 'The gold chest',   note: 'Often empty. Sometimes the game' }
      ]
    },
    boss: {
      ask: 'What is the class doing?', when: 'question',
      list: [
        { id: 'attack', label: 'Attack', note: 'Hurt it. Nothing protects you' },
        { id: 'guard',  label: 'Guard',  note: 'Soak its next hit for everyone' },
        { id: 'heal',   label: 'Heal',   note: 'Put the class back on its feet' }
      ]
    },
    snow: {
      ask: 'Throw, or dig in?', when: 'question',
      list: [
        { id: 'throw',   label: 'Throw',        note: 'Knock blocks off their fort' },
        { id: 'fortify', label: 'Rebuild',      note: 'Put a block back on your own' },
        { id: 'snowman', label: 'Build a decoy', note: 'It takes the next hit instead of your fort' }
      ]
    },
    balloon: {
      ask: 'How high are you going?', when: 'question',
      list: [
        { id: 'float', label: 'Float',   note: 'The points. One balloon if you are wrong' },
        { id: 'soar',  label: 'Soar',    note: 'Twice the points. Two balloons if you are wrong' },
        { id: 'patch', label: 'Patch up', note: 'Fewer points, and a right answer wins a balloon back' }
      ]
    },
    tug: {
      ask: 'How are you pulling?', when: 'question',
      list: [
        { id: 'dig',    label: 'Dig in', note: 'A small pull. Being wrong costs nothing' },
        { id: 'heave',  label: 'Heave',  note: 'A big pull. Being wrong slips the rope back' },
        { id: 'anchor', label: 'Anchor', note: 'No pull. The rope cannot move against your team' }
      ]
    },
    heist: {
      ask: 'What is the job?', when: 'question',
      list: [
        { id: 'sneak', label: 'Sneak',      note: 'A quiet, certain bit of gold' },
        { id: 'rob',   label: 'Rob someone', note: 'Take a third of theirs — unless they are guarding',
          needs: 'player' },
        { id: 'guard', label: 'Guard yours', note: 'No gold. Anyone robbing you loses theirs to you' },
        { id: 'vault', label: 'Crack the vault', note: 'Enormous. Needs two right in a row' }
      ]
    },
    cards: {
      ask: 'How are you playing the hand?', when: 'question',
      list: [
        { id: 'grab',  label: 'Grab one',  note: 'A card. Probably one you already have' },
        { id: 'hunt',  label: 'Hunt one',  note: 'Name it. Harder, but it is the one you need',
          needs: 'card' },
        { id: 'trade', label: 'Offer a trade', note: 'Put a spare up. Somebody hunting it swaps with you' }
      ]
    },
    volcano: {
      ask: 'Which way up?', when: 'question',
      list: [
        { id: 'ledge',    label: 'The ledge',   note: 'A short, certain climb' },
        { id: 'chimney',  label: 'The chimney', note: 'Much faster. A slip costs you double' },
        { id: 'overhang', label: 'The overhang', note: 'Fastest, and it sends rocks down on anyone below you' }
      ]
    },
    factory: {
      ask: 'What are you running?', when: 'question',
      list: [
        { id: 'work',    label: 'Work the floor', note: 'Coins now, straight into your pocket' },
        { id: 'invest',  label: 'Feed the machines', note: 'Fewer coins now. Every machine runs hotter' },
        { id: 'sabotage', label: 'Sabotage', note: 'Nothing for you. Their machines stop for a round',
          needs: 'player' }
      ]
    },
    fishing: {
      ask: 'How are you fishing?', when: 'question',
      list: [
        { id: 'cast', label: 'Just cast',   note: 'Fish where you chose' },
        { id: 'bait', label: 'Bait the water', note: 'Costs weight. Far better odds this round' },
        { id: 'net',  label: 'Cast the net', note: 'Everything is smaller, but you catch three' }
      ]
    }
  };

  const movesFor = (mode) => (MOVES[mode] && MOVES[mode].list) || [];
  const defaultMove = (mode) => {
    const list = movesFor(mode);
    return list.length ? list[0].id : '';
  };
  /** The move this player has chosen, falling back to the safe one. */
  function moveOf(game, p) {
    const list = movesFor(game.mode);
    if (!list.length) return '';
    const want = p && p.move;
    return list.some(m => m.id === want) ? want : list[0].id;
  }
  /** Record a choice, if it is one this mode offers. */
  function chooseMove(game, p, id, on) {
    const list = movesFor(game.mode);
    const spec = list.find(m => m.id === id);
    if (!spec) return { ok: false, why: 'Not a move in this game.' };
    if (spec.needs === 'player') {
      const who = game.players[on];
      if (!who || who.id === p.id) return { ok: false, why: 'Pick somebody else first.' };
      p.on = on;
    } else if (spec.needs === 'card') {
      if (!CARD_SET.includes(on)) return { ok: false, why: 'Pick a card first.' };
      p.on = on;
    } else {
      p.on = '';
    }
    p.move = id;
    return { ok: true, move: id, on: p.on };
  }

  /* ── Treasure Run ──
   * Three chests, and the child picks one. It used to roll a dice for them and
   * tell them what they had won, which is the difference between playing a game
   * and being read the results of one. The odds are printed on the buttons: a
   * choice you cannot see the terms of is not a choice. */
  const CHESTS = {
    bronze: { label: 'Bronze', odds: 1.00, low: 40,  high: 70,  jackpot: 0.00, mult: 4 },
    silver: { label: 'Silver', odds: 0.72, low: 90,  high: 150, jackpot: 0.08, mult: 4 },
    gold:   { label: 'Gold',   odds: 0.38, low: 200, high: 320, jackpot: 0.22, mult: 5 }
  };

  /* ── the modes, same rules as the server edition ─── */
  const SCORERS = {
    /* A wager. The oldest good idea in quiz games and it was not here: everybody
     * scored the same for the same answer, so the child in fourth had no way of
     * ever being in first that did not involve the child in first making a
     * mistake. Now they can decide to take a risk that the leader has no reason
     * to take. */
    normal(game, p, q, ok, speed) {
      const base = pointsFor(game, q);
      const worth = Math.round((base * 0.5 + base * 0.5 * speed) * streakBonus(game, p));
      const move = moveOf(game, p);
      if (ok) {
        const gain = move === 'allin' ? worth * 3 : move === 'double' ? worth * 2 : worth;
        p.score += gain; p.lastGain = gain;
        if (move !== 'safe') game.lastEvents.push(`${p.name} ${move === 'allin' ? 'went all in' : 'doubled down'} and got it`);
      } else {
        const lost = move === 'allin' ? worth : move === 'double' ? Math.round(worth * 0.5) : 0;
        p.score = Math.max(0, p.score - lost); p.lastGain = -lost;
        if (lost) game.lastEvents.push(`${p.name} risked it and lost ${lost}`);
      }
    },

    /* Push, aim or cover. Pushing up is the only way to break a fort of a team
     * that all took cover, and it is also how you get knocked out — so a team
     * that all pushes wins fast or loses fast, and that is a decision somebody
     * has to make out loud. */
    laser(game, p, q, ok, speed) {
      const move = moveOf(game, p);
      const foe = p.team === 'red' ? 'blue' : 'red';
      const mates = Object.values(game.players);
      p.exposed = move === 'push';
      if (ok && !p.down) {
        if (move === 'cover') {
          const weakest = mates.filter(x => x.team === p.team && !x.down)
            .sort((a, b) => a.hp - b.hp)[0];
          if (weakest) { weakest.shielded = true; game.lastEvents.push(`${p.name} is covering ${weakest.name}`); }
        }
        let damage = Math.round(45 + 55 * speed);
        if (p.streak >= 3) damage = Math.round(damage * 1.8);
        if (move === 'push') damage = Math.round(damage * 2);
        if (move === 'cover') damage = Math.round(damage * 0.5);
        const targets = mates.filter(x => x.team === foe && !x.down);
        let hitName = game.teams[foe].name;
        if (targets.length) {
          const chosen = targets.find(x => x.id === p.target);
          const target = chosen || targets.reduce((a, b) => (a.hp >= b.hp ? a : b));
          let landed = Math.min(damage, MAX_PLAYER_HIT);
          if (target.shielded) { landed = Math.round(landed * 0.35); }
          target.hp = Math.max(0, target.hp - landed);
          target.lastDamage = landed;
          hitName = target.name;
          if (target.hp === 0) { target.down = true; game.lastEvents.push(`${p.name} knocked out ${target.name}`); }
        }
        game.teams[foe].hp = Math.max(0, game.teams[foe].hp - damage);
        game.teams[p.team].score += damage;
        p.score += damage; p.lastGain = damage;
        game.lastEvents.push(`${p.name} hit ${hitName} for ${damage}`
          + (move === 'push' ? ' — pushing up' : p.streak >= 3 ? ' (overcharged)' : ''));
      } else if (ok && p.down) {
        const hurt = mates.filter(x => x.team === p.team && x.hp < 100);
        if (hurt.length) {
          const mate = hurt.reduce((a, b) => (a.hp <= b.hp ? a : b));
          mate.hp = Math.min(100, mate.hp + 25);
          if (mate.down && mate.hp > 0) mate.down = false;
          game.lastEvents.push(`${p.name} revived ${mate.name}, +25 HP`);
        }
        p.score += 25;
      } else {
        const cost = move === 'push' ? 20 : move === 'cover' ? 4 : 10;
        p.hp = Math.max(0, p.hp - cost);
        if (p.hp === 0) p.down = true;
        game.lastEvents.push(`${p.name} missed`
          + (move === 'push' ? ' while pushing up, and it hurt' : ''));
      }
    },

    /* The slipstream is the whole change here. A kart race where everyone gains
     * the same for the same answer is not a race, it is a queue — whoever is in
     * front stays in front for the rest of the lesson. Slipstreaming pays for
     * being behind, so the pack stays together and the last question matters. */
    kart(game, p, q, ok, speed) {
      const move = moveOf(game, p);
      if (!ok) {
        if (move === 'inside') {
          const back = 40;
          p.distance = Math.max(0, (p.distance || 0) - back);
          game.lastEvents.push(`${p.name} dived inside, missed, and spun back ${back}m`);
        } else {
          game.lastEvents.push(`${p.name} span out`);
        }
        p.lastGain = 0; p.score = p.distance;
        return;
      }
      let metres = Math.round(45 + 55 * speed);
      if (p.streak >= 3) metres = Math.round(metres * 1.6);
      if (move === 'inside') metres = Math.round(metres * 1.9);
      if (move === 'slip') {
        const front = Math.max(0, ...Object.values(game.players).map(x => x.distance || 0));
        const behind = Math.max(0, front - (p.distance || 0));
        // the tow is worth more the further back you are, and nothing at the front
        metres = Math.round(metres * (1 + Math.min(1.4, behind / 260)));
      }
      p.distance = (p.distance || 0) + metres; p.score = p.distance; p.lastGain = metres;
      game.lastEvents.push(`${p.name} drove ${metres}m`
        + (move === 'slip' ? ' in the tow' : move === 'inside' ? ' round the inside' : ''));
      // an item every third right answer, thrown at the leader in resolve()
      p.run = (p.run || 0) + 1;
      if (p.run >= 3) { p.run = 0; p.item = true; game.lastEvents.push(`${p.name} picked up a shell`); }
    },

    /* Push your luck, with a wind that decides. Building tall is worth three
     * times as much and makes the tower sway; a swaying tower falls when the
     * wind gets up, which the board warns about a round in advance. So the game
     * is: how long do you keep building before you stop and brace? */
    tower(game, p, q, ok, speed) {
      const move = moveOf(game, p);
      if (!ok) {
        if (p.blocks > 0 && move === 'tall') {
          p.blocks = Math.max(0, p.blocks - 2); p.lastGain = -2;
          game.lastEvents.push(`${p.name} reached too far and lost two`);
        } else if (p.blocks > 0) {
          p.blocks -= 1; p.lastGain = -1;
          game.lastEvents.push(`${p.name}'s tower wobbled and a block fell`);
        } else { p.lastGain = 0; }
        p.score = p.blocks;
        return;
      }
      if (move === 'brace') {
        p.sway = 0; p.lastGain = 0;
        game.lastEvents.push(`${p.name} braced the tower — it is steady again`);
      } else if (move === 'tall') {
        const gain = speed > 0.55 ? 4 : 3;
        p.blocks += gain; p.sway = (p.sway || 0) + 2; p.lastGain = gain;
        game.lastEvents.push(`${p.name} stacked ${gain} high — and it is swaying`);
      } else {
        p.blocks += 1; p.lastGain = 1;
        game.lastEvents.push(`${p.name} built wide`);
      }
      p.score = p.blocks;
    },

    /* Three chests with their odds written on them. Same expected value, wildly
     * different shapes: bronze is a wage, gold is a lottery ticket, and which of
     * those you want depends entirely on whether you are winning. */
    treasure(game, p, q, ok, speed) {
      const move = moveOf(game, p);
      const chest = CHESTS[move] || CHESTS.bronze;
      if (!ok) {
        p.chest = 'The lid would not budge';
        p.lastGain = 0;
        return;
      }
      if (Math.random() > chest.odds) {
        p.chest = `The ${chest.label.toLowerCase()} chest was empty`;
        p.lastGain = 0;
        game.lastEvents.push(`${p.name} opened an empty ${chest.label.toLowerCase()} chest`);
        return;
      }
      const spread = chest.high - chest.low;
      let coins = Math.round(chest.low + spread * (0.35 + 0.65 * speed));
      const jackpot = Math.random() < chest.jackpot;
      if (jackpot) coins *= chest.mult;
      p.coins += coins; p.score = p.coins; p.lastGain = coins;
      p.chest = jackpot ? `The ${chest.label.toLowerCase()} chest — a jackpot, ${coins}` : `+${coins} gold`;
      if (jackpot) game.lastEvents.push(`${p.name} hit the jackpot in a ${chest.label.toLowerCase()} chest — ${coins}`);
    },

    /* The boss now says what it is about to do, one round early, and the class
     * has to answer that as well as the question. Everyone attacking a boss that
     * is winding up a sweep is a wipe; everyone guarding a boss that is only
     * poking is a wasted round and it heals. Somebody has to read it out and the
     * room has to agree, which is the most fun thing that has ever happened in
     * this mode. */
    boss(game, p, q, ok, speed) {
      const boss = game.boss;
      const move = moveOf(game, p);
      if (!ok) {
        p.lastGain = 0;
        p.acted = '';
        return;
      }
      p.acted = move;
      if (move === 'attack') {
        let damage = Math.round(20 + 25 * speed);
        if (p.streak >= 3) damage = Math.round(damage * 1.5);
        boss.hp = Math.max(0, boss.hp - damage);
        p.score += damage; p.lastGain = damage;
        game.lastEvents.push(`${p.name} hit ${boss.name} for ${damage}`);
        if (boss.hp === 0) game.lastEvents.push(`${boss.name} is defeated`);
      } else if (move === 'guard') {
        p.guarding = true;
        p.score += 12; p.lastGain = 12;
      } else {
        const healed = Math.round(6 + 6 * speed);
        boss.classHp = Math.min(boss.classMax || 100, boss.classHp + healed);
        p.score += healed; p.lastGain = healed;
        game.lastEvents.push(`${p.name} patched the class up by ${healed}`);
      }
    },

    /* Throwing is not the only thing to do with a right answer any more. A team
     * being taken apart can spend a round putting its own fort back up, which
     * means the losing team has a decision and not just a countdown. */
    snow(game, p, q, ok, speed) {
      const move = moveOf(game, p);
      const foe = p.team === 'red' ? 'blue' : 'red';
      const fort = game.teams[foe];
      const mine = game.teams[p.team];
      if (!ok) { p.lastGain = 0; game.lastEvents.push(`${p.name} missed`); return; }
      /* Scored off the fort, not off a formula. A block knocked off a fort that
       * is nearly down is worth more than one off a full one, so the endgame is
       * where the points are and a team that is behind can still take it. */
      const base = Math.round(pointsFor(game, q) * (0.3 + 0.3 * speed));
      let gain = base;
      if (move === 'fortify') {
        const back = Math.min(2, (mine.max || FORT_BLOCKS) - mine.blocks);
        mine.blocks += back;
        gain = base + back * 25;
        p.score += gain; p.lastGain = gain; mine.score += gain;
        game.lastEvents.push(back
          ? `${p.name} put ${back} block${back > 1 ? 's' : ''} back on the ${mine.name} fort`
          : `${p.name} patched a fort that was already full`);
        return;
      }
      if (move === 'snowman') {
        mine.decoys = (mine.decoys || 0) + 1;
        gain = base + 20;
        p.score += gain; p.lastGain = gain; mine.score += gain;
        game.lastEvents.push(`${p.name} built a snowman in front of the ${mine.name} fort`);
        return;
      }
      const power = 1 + Math.min(p.streak, 4) * 0.25;
      let hit = Math.max(1, Math.round((0.6 + speed) * power));
      if (fort.decoys > 0) {
        fort.decoys -= 1;
        gain = base;
        p.score += gain; p.lastGain = gain; mine.score += gain;
        game.lastEvents.push(`${p.name} took the head off a ${fort.name} snowman`);
        p.hits += 1;
        return;
      }
      hit = Math.min(fort.blocks, hit);
      fort.blocks -= hit; p.hits += hit;
      // the last blocks are the dear ones
      const nearly = 1 + (1 - fort.blocks / (fort.max || FORT_BLOCKS)) * 0.9;
      gain = Math.round(base * nearly + hit * 30);
      p.score += gain; p.lastGain = gain; mine.score += gain;
      game.lastEvents.push(`${p.name} knocked ${hit} block${hit > 1 ? 's' : ''} off the ${fort.name} fort`
                           + (fort.blocks ? '' : ' — it is down!'));
    },

    /* A balloon is now a thing you can spend rather than only lose. Soaring is
     * how somebody with three balloons and no points gets back in it, and
     * patching is how somebody with one balloon and a lead survives. */
    balloon(game, p, q, ok, speed) {
      const move = moveOf(game, p);
      const out = p.balloons <= 0;
      if (!ok) {
        p.lastGain = 0;
        if (out) { game.lastEvents.push(`${p.name} got it wrong`); return; }
        const cost = move === 'soar' ? 2 : 1;
        p.balloons = Math.max(0, p.balloons - cost);
        game.lastEvents.push(p.balloons
          ? `${p.name} lost ${cost} balloon${cost > 1 ? 's' : ''} — ${p.balloons} left`
          : `${p.name} is out of balloons`);
        return;
      }
      const base = pointsFor(game, q);
      let gain = Math.round((base * 0.5 + base * 0.5 * speed) * (out ? 0.4 : 1));
      if (move === 'soar') gain *= 2;
      if (move === 'patch') {
        gain = Math.round(gain * 0.5);
        if (p.balloons < BALLOONS) {
          p.balloons += 1;
          game.lastEvents.push(`${p.name} patched a balloon — ${p.balloons} again`);
        }
      }
      p.score += gain; p.lastGain = gain;
      if (move === 'soar') game.lastEvents.push(`${p.name} soared for ${gain}`);
    },

    /* Anchoring is the change that makes this a game. A team that is one heave
     * from losing can spend a round making itself immovable, which buys the time
     * to get everybody answering again — and costs them the ground they would
     * have taken. Every rope game needs a way to hold. */
    tug(game, p, q, ok, speed) {
      const move = moveOf(game, p);
      const way = p.team === 'red' ? -1 : 1;
      if (move === 'anchor') {
        game.teams[p.team].anchored = true;
        p.lastGain = 0;
        if (ok) { p.score += 20; game.lastEvents.push(`${p.name} is anchoring for ${game.teams[p.team].name}`); }
        return;
      }
      if (!ok) {
        if (move === 'heave') {
          const slip = 5;
          game.rope = Math.max(-ROPE_LENGTH, Math.min(ROPE_LENGTH, (game.rope || 0) - way * slip));
          game.lastEvents.push(`${p.name} heaved, missed, and slipped ${slip}`);
        }
        p.lastGain = 0;
        return;
      }
      const base = Math.round(4 + 7 * speed) * (p.streak >= 3 ? 2 : 1);
      const pull = move === 'heave' ? Math.round(base * 2.1) : base;
      game.rope = Math.max(-ROPE_LENGTH, Math.min(ROPE_LENGTH, (game.rope || 0) + way * pull));
      p.score += pull; p.lastGain = pull; p.hits += pull;
      game.teams[p.team].score += pull;
      game.lastEvents.push(`${p.name} ${move === 'heave' ? 'heaved' : 'pulled'} ${pull}`);
    },

    /* This mode used to roll a dice and tell a child it had robbed somebody.
     * Now they choose who, and the person being robbed can have chosen to guard,
     * in which case the robber loses everything they were carrying to them. Two
     * children who have worked out they are each other's problem is the best
     * thing in this whole game, and it was a Math.random() call.
     *
     * The scorer only writes down the intention. Robberies are settled together
     * in resolve(), or it would come down to whose phone sent first. */
    heist(game, p, q, ok, speed) {
      const move = moveOf(game, p);
      p.job = null;
      if (!ok) { p.lastGain = 0; p.chest = 'The job went wrong'; return; }
      const found = Math.round(60 + 70 * speed);
      if (move === 'guard') {
        p.job = { kind: 'guard' };
        p.chest = 'Standing over your gold';
        p.lastGain = 0;
        return;
      }
      if (move === 'rob') {
        p.job = { kind: 'rob', on: p.on, carrying: found };
        p.chest = 'On the job';
        p.lastGain = 0;
        return;
      }
      if (move === 'vault') {
        if (p.streak < 2) {
          p.chest = 'The vault needs two right in a row';
          p.lastGain = 0;
          return;
        }
        const haul = found * 4;
        p.coins += haul; p.score = p.coins; p.lastGain = haul;
        p.chest = `Cracked the vault — ${haul}`;
        game.lastEvents.push(`${p.name} cracked the vault for ${haul}`);
        return;
      }
      p.coins += found; p.score = p.coins; p.lastGain = found;
      p.chest = `+${found} gold`;
    },

    /* Naming the card you want is the difference between collecting and being
     * dealt to. Hunting is worse odds and exactly what you need; grabbing is
     * good odds and probably another one of something you already have. And a
     * spare is now worth something to somebody else, which is a reason for two
     * children to talk to each other. */
    cards(game, p, q, ok, speed) {
      if (!p.cards) p.cards = [];
      const move = moveOf(game, p);
      if (!ok) { p.lastGain = 0; p.chest = ''; return; }
      const missing = CARD_SET.filter(c => !p.cards.includes(c));

      if (move === 'trade') {
        if ((p.spares || 0) <= 0) { p.chest = 'Nothing spare to offer'; p.lastGain = 0; return; }
        p.offer = p.on && CARD_SET.includes(p.on) ? p.on : '';
        p.job = { kind: 'trade' };
        p.chest = 'Offering a trade';
        p.lastGain = 0;
        return;
      }
      let card;
      if (move === 'hunt' && missing.length) {
        const want = CARD_SET.includes(p.on) && missing.includes(p.on)
          ? p.on : missing[Math.floor(Math.random() * missing.length)];
        // naming it is how you get the one you actually need
        card = Math.random() < (0.45 + 0.45 * speed) ? want
             : CARD_SET[Math.floor(Math.random() * CARD_SET.length)];
      } else {
        // grabbing asks for nothing in particular and mostly gets you a spare
        const wantNew = missing.length && Math.random() < (0.28 + 0.32 * speed);
        card = wantNew ? missing[Math.floor(Math.random() * missing.length)]
                       : CARD_SET[Math.floor(Math.random() * CARD_SET.length)];
      }
      if (p.cards.includes(card)) {
        p.spares = (p.spares || 0) + 1;
        p.chest = `Another ${card} — ${p.spares} spare${p.spares === 1 ? '' : 's'}`;
        if (p.spares >= SPARES_PER_SWAP && missing.length) {
          p.spares -= SPARES_PER_SWAP;
          const swap = missing[Math.floor(Math.random() * missing.length)];
          p.cards.push(swap);
          p.chest = `Traded three spares for the ${swap}`;
          game.lastEvents.push(`${p.name} traded three spares for the ${swap}`);
        }
      } else {
        p.cards.push(card);
        p.chest = `Won the ${card}`;
        game.lastEvents.push(`${p.name} won the ${card} card`
                             + (p.cards.length === CARD_SET.length ? ' — a full set!' : ''));
      }
      p.lastGain = 1;
      p.score = p.cards.length * 100 + (p.spares || 0) * 10;
    },

    /* Three routes up, and the fast one drops rocks on the people below. That is
     * the first thing in this game that made the class shout at each other. */
    volcano(game, p, q, ok, speed) {
      const move = moveOf(game, p);
      p.rocks = false;
      if (ok) {
        const rate = move === 'overhang' ? 2.2 : move === 'chimney' ? 1.7 : 1;
        const climb = Math.round(CLIMB_PER * (0.45 + 0.55 * speed) * streakBonus(game, p) * rate);
        p.height += climb;
        p.lastGain = climb;
        if (move === 'overhang') { p.rocks = true; }
        if (p.streak >= 3) game.lastEvents.push(`${p.name} is going up fast`);
      } else {
        const rate = move === 'overhang' ? 1.8 : move === 'chimney' ? 1.6 : 0.6;
        const slip = Math.round(CLIMB_PER * 0.35 * rate);
        p.height = Math.max(0, p.height - slip);
        p.lastGain = 0;
        game.lastEvents.push(`${p.name} slipped ${slip}`
          + (move === 'ledge' ? '' : ' on the ' + move));
      }
      const wasSafe = p.safe;
      p.safe = p.height >= (game.lava || 0);
      if (wasSafe && !p.safe) game.lastEvents.push(`The lava caught ${p.name}`);
      if (!wasSafe && p.safe) game.lastEvents.push(`${p.name} climbed back out`);
      p.score = p.height;
    },

    /* Working pays now, investing pays later, sabotage pays nothing and costs
     * somebody else more than it costs you. A factory where everybody only ever
     * builds is an arms race nobody can lose; the third option is what stops it. */
    factory(game, p, q, ok, speed) {
      const move = moveOf(game, p);
      p.job = null;
      if (!ok) { p.lastGain = 0; return; }
      const base = pointsFor(game, q);
      if (move === 'sabotage') {
        p.job = { kind: 'sabotage', on: p.on };
        p.lastGain = 0;
        return;
      }
      const rate = move === 'invest' ? 0.18 : 0.35;
      const gain = Math.round((base * rate + base * rate * speed) * streakBonus(game, p));
      p.coins += gain;
      p.lastGain = gain;
      if (move === 'invest') {
        p.tuned = (p.tuned || 0) + 1;
        game.lastEvents.push(`${p.name} tuned the machines up`);
      }
      p.score = p.coins + p.output * 3;
    },

    /* The shoal is the new thing. It moves every round, everybody can see where
     * it is, and it doubles what that water pays — so the question is no longer
     * "how brave am I" but "where is everybody else going to be". */
    fishing(game, p, q, ok, speed) {
      const move = moveOf(game, p);
      const spot = SPOTS[p.target] ? p.target : 'shallows';
      const where = SPOTS[spot];
      if (!ok) {
        p.catch = 'The line came up empty';
        p.lastGain = 0;
        return;
      }
      let odds = where.odds;
      if (move === 'bait') {
        const cost = Math.min(p.weight, 25);
        p.weight -= cost;
        odds = Math.min(0.97, odds + 0.32);
        if (cost) game.lastEvents.push(`${p.name} baited the water, ${cost} of weight gone`);
      }
      const casts = move === 'net' ? 3 : 1;
      const shrink = move === 'net' ? 0.42 : 1;
      const shoaling = game.shoal === spot;
      let total = 0, best = 0, kindName = '';
      for (let c = 0; c < casts; c++) {
        if (Math.random() > odds) continue;
        const spread = where.high - where.low;
        const big = Math.random() < where.big;
        let weight = Math.round((where.low + spread * (0.4 + 0.6 * speed)) * (big ? 2.6 : 1) * shrink);
        if (shoaling) weight = Math.round(weight * 2);
        total += weight;
        if (weight > best) { best = weight; kindName = FISH[Math.min(FISH.length - 1, Math.floor(weight / 40))]; }
      }
      if (!total) {
        p.catch = 'Caught ' + JUNK[Math.floor(Math.random() * JUNK.length)];
        p.lastGain = 0;
        p.score = p.weight;
        return;
      }
      p.weight += total;
      p.best_catch = Math.max(p.best_catch, best);
      p.catch = (casts > 1 ? `Netted ${total}` : 'Landed ' + kindName + ` — ${total}`)
              + (shoaling ? ', right in the shoal' : '');
      p.lastGain = total;
      p.score = p.weight;
      if (shoaling) game.lastEvents.push(`${p.name} was fishing the shoal — ${total}`);
      else if (best > 120) game.lastEvents.push(`${p.name} landed ${kindName} out of ${where.label.toLowerCase()}`);
    }
  };

  /* ── everything that happens between the questions ────────
   *
   * Two different jobs live here and it is worth saying which is which.
   *
   * resolve() settles the moves that touch somebody else. It has to be one step,
   * after every answer is in, because a robbery and the guard that stops it are
   * the same event seen from two sides — scoring them as they arrived would mean
   * the game was decided by whose phone was on better wifi. Nobody would ever
   * see why they lost.
   *
   * Then the world takes its own turn: lava rises, wind gets up, machines pay
   * out, the boss swings, the shoal moves. This is the half of a game that
   * happens whether or not you were any good this round, and this mode had none
   * of it before — which is why every round felt the same as the last one.
   */
  function resolve(game) {
    const everyone = Object.values(game.players);

    /* Gold Heist: robberies and guards, together. A guard who is robbed takes
     * what the robber was carrying; two robbers on the same guarded pile both
     * lose. Being predictable is the only way to actually lose gold here. */
    if (game.mode === 'heist') {
      const guards = new Set(everyone.filter(p => p.job && p.job.kind === 'guard').map(p => p.id));
      const robbers = everyone.filter(p => p.job && p.job.kind === 'rob');
      for (const robber of robbers) {
        const mark = game.players[robber.job.on];
        if (!mark || mark.id === robber.id) {
          robber.coins += robber.job.carrying;
          robber.chest = `Nobody there — kept ${robber.job.carrying}`;
          continue;
        }
        if (guards.has(mark.id)) {
          const lost = Math.min(robber.coins, robber.job.carrying);
          robber.coins = Math.max(0, robber.coins - lost);
          mark.coins += lost + robber.job.carrying;
          robber.chest = `${mark.name} was waiting. Lost ${lost}`;
          mark.chest = `Caught ${robber.name} — took ${lost + robber.job.carrying}`;
          game.lastEvents.push(`${mark.name} caught ${robber.name} red-handed`);
        } else {
          const taken = Math.round(mark.coins / 3);
          mark.coins = Math.max(0, mark.coins - taken);
          robber.coins += taken + robber.job.carrying;
          robber.chest = `Robbed ${mark.name} of ${taken}`;
          mark.chest = `${robber.name} robbed you of ${taken}`;
          game.lastEvents.push(`${robber.name} robbed ${mark.name} of ${taken} gold`);
        }
      }
      everyone.forEach(p => { p.coins = Math.max(0, p.coins); p.score = p.coins; p.job = null; });
    }

    /* Kart Race: a shell is thrown at whoever is in front, by whoever earned it.
     * Aimed at the leader rather than at a name on purpose — it keeps the front
     * of the race under pressure without letting the room gang up on one child. */
    if (game.mode === 'kart') {
      const throwers = everyone.filter(p => p.item);
      if (throwers.length) {
        const leader = everyone.reduce((a, b) => ((a.distance || 0) >= (b.distance || 0) ? a : b));
        for (const t of throwers) {
          t.item = false;
          if (t.id === leader.id) {
            t.distance += 30; t.score = t.distance;
            game.lastEvents.push(`${t.name} is out front and used the shell as a boost`);
            continue;
          }
          const hit = 55;
          leader.distance = Math.max(0, (leader.distance || 0) - hit);
          leader.score = leader.distance;
          game.lastEvents.push(`${t.name} hit ${leader.name} with a shell — ${hit}m gone`);
        }
      }
    }

    /* Volcano Climb: anyone who took the overhang sends rocks down on the
     * climbers below them. It cannot reach above you, so the leader is safe and
     * the scramble is in the middle, which is where most of the class is. */
    if (game.mode === 'volcano') {
      const kickers = everyone.filter(p => p.rocks);
      for (const k of kickers) {
        const below = everyone.filter(x => x.id !== k.id && (x.height || 0) < (k.height || 0));
        if (!below.length) continue;
        const hit = below.reduce((a, b) => ((a.height || 0) >= (b.height || 0) ? a : b));
        const knock = 10;
        hit.height = Math.max(0, (hit.height || 0) - knock);
        hit.score = hit.height;
        game.lastEvents.push(`${k.name} sent rocks down onto ${hit.name}`);
      }
      everyone.forEach(p => { p.rocks = false; });
    }

    /* Factory: a sabotaged floor produces nothing next payout. It does not break
     * anything permanently — a mode where a child can be knocked out of the game
     * by other children in round two is a mode teachers stop using. */
    if (game.mode === 'factory') {
      for (const p of everyone.filter(x => x.job && x.job.kind === 'sabotage')) {
        const mark = game.players[p.job.on];
        if (!mark || mark.id === p.id) continue;
        mark.stopped = true;
        game.lastEvents.push(`${p.name} jammed ${mark.name}'s machines`);
      }
      everyone.forEach(p => { p.job = null; });
    }

    /* Card Collector: offers matched with hunters. One spare, one swap, and both
     * children got something they wanted out of somebody else's bad luck. */
    if (game.mode === 'cards') {
      const offering = everyone.filter(p => p.job && p.job.kind === 'trade' && (p.spares || 0) > 0);
      for (const seller of offering) {
        const buyer = everyone.find(x => x.id !== seller.id && (x.spares || 0) > 0
          && CARD_SET.some(c => !x.cards.includes(c) && seller.cards.includes(c)));
        if (!buyer) { seller.chest = 'Nobody took the trade'; continue; }
        const wants = CARD_SET.find(c => !buyer.cards.includes(c) && seller.cards.includes(c));
        const back = CARD_SET.find(c => !seller.cards.includes(c) && buyer.cards.includes(c));
        seller.spares -= 1; buyer.spares -= 1;
        buyer.cards.push(wants);
        if (back) seller.cards.push(back);
        seller.chest = back ? `Traded with ${buyer.name} for the ${back}` : `Traded the ${wants} to ${buyer.name}`;
        buyer.chest = `Traded with ${seller.name} for the ${wants}`;
        game.lastEvents.push(`${seller.name} and ${buyer.name} traded cards`);
        [seller, buyer].forEach(x => { x.score = x.cards.length * 100 + (x.spares || 0) * 10; });
      }
      everyone.forEach(p => { p.job = null; });
    }

    /* Boss Battle: the boss takes its turn, and whether it lands depends on what
     * the class chose against what it announced it was doing. This is the only
     * mode where the room can be wrong together, and getting it right feels like
     * something the class did rather than something the fastest reader did. */
    if (game.mode === 'boss' && game.boss) {
      const boss = game.boss;
      const move = boss.next || 'poke';
      const guards = everyone.filter(p => p.guarding).length;
      const attackers = everyone.filter(p => p.acted === 'attack').length;
      const heads = Math.max(1, everyone.length);

      if (move === 'sweep') {
        // a sweep punishes attacking and is stopped by guarding
        const raw = 10 + attackers * 6;
        const soaked = Math.min(raw, guards * 9);
        const through = Math.max(0, raw - soaked);
        boss.classHp = Math.max(0, boss.classHp - through);
        game.lastEvents.push(through
          ? `${boss.name} swept the class for ${through}`
          : `The class held the sweep — ${boss.name} hit nothing`);
      } else if (move === 'mend') {
        // if the class did not hit it hard enough, it heals
        const hurt = everyone.reduce((n, p) => n + (p.acted === 'attack' ? 1 : 0), 0);
        if (hurt < heads / 2) {
          const back = Math.round((boss.max || boss.hp) * 0.08);
          boss.hp = Math.min(boss.max || boss.hp + back, boss.hp + back);
          game.lastEvents.push(`${boss.name} caught its breath and healed ${back}`);
        } else {
          game.lastEvents.push(`The class stopped ${boss.name} healing`);
        }
      } else {
        const raw = 8;
        const through = guards ? 0 : raw;
        boss.classHp = Math.max(0, boss.classHp - through);
        if (through) game.lastEvents.push(`${boss.name} struck the class for ${through}`);
      }
      // and it says what it is doing next, so the class can argue about it
      const roll = Math.random();
      boss.next = roll < 0.34 ? 'sweep' : roll < 0.6 ? 'mend' : 'poke';
      boss.says = boss.next === 'sweep' ? 'is winding up a huge sweep'
                : boss.next === 'mend'  ? 'is about to heal itself'
                : 'is sizing the class up';
      everyone.forEach(p => { p.guarding = false; p.acted = ''; });
    }

    /* Laser Tag: shields last one round, and pushing up leaves you open to the
     * next one, so the choice has a consequence that arrives after you made it. */
    if (game.mode === 'laser') {
      everyone.forEach(p => {
        if (p.exposed && !p.down) {
          p.hp = Math.max(0, p.hp - 8);
          if (p.hp === 0) { p.down = true; game.lastEvents.push(`${p.name} was caught out in the open`); }
        }
        p.shielded = false; p.exposed = false;
      });
    }
  }

  /* ── Volcano Climb ──
   * Everyone climbs the same wall and the lava climbs with them, at a rate set
   * by how well the room as a whole is doing: a class that is getting them right
   * gets a harder game, which is the only way a shared threat can stay a threat.
   * Being caught is not being out — a caught climber keeps answering to get back
   * above it — because a child watching the last four minutes has stopped
   * learning anything. */
  const CLIMB_PER = 14;          // the most one very fast right answer gains
  const LAVA_BASE = 5;           // the least it rises in a round
  const LAVA_CHASE = 7;          // and how much of the room's average it adds

  /* ── Tower Build ──
   * A tall tower sways, and the wind topples swaying towers. The board is told
   * a round in advance that the wind is getting up, so stopping to brace is a
   * decision made with the information rather than a punishment out of nowhere. */
  const SWAY_LIMIT = 4;          // sway at or above this and the wind takes it

  /* ── Factory ──
   * Coins buy machines; machines pay out at the end of every round whether you
   * answered or not. Buying early costs you the lead and wins you the game.
   * Feeding them ("invest") makes every machine you own run hotter for the rest
   * of the game, so there are two ways to build and they suit different rooms. */
  const MACHINE_COST = 120;      // what the first machine costs
  const MACHINE_STEP = 60;       // and how much more each one after it costs
  const MACHINE_YIELD = 34;      // what each machine pays every round
  const TUNE_BONUS = 5;          // and what each round of tuning adds to that

  /* ── Fishing Frenzy ──
   * Cast near or far, chosen on the phone before the question. Near water almost
   * always gives you something small; deep water often gives you nothing at all
   * and sometimes gives you the fish that wins the game. The shoal moves between
   * the three every round and doubles what its water pays, which everybody can
   * see — so the good players are the ones watching the board, not the ones
   * gambling. */
  const SPOTS = {
    shallows: { label: 'The shallows', odds: 0.92, low: 12, high: 30, big: 0.04 },
    channel:  { label: 'The channel',  odds: 0.68, low: 30, high: 70, big: 0.12 },
    deep:     { label: 'The deep',     odds: 0.42, low: 70, high: 150, big: 0.26 }
  };
  const SPOT_IDS = Object.keys(SPOTS);
  const FISH = ['a minnow', 'a perch', 'a bream', 'a pike', 'a carp', 'a catfish', 'a sturgeon'];
  const JUNK = ['an old boot', 'a bag of weed', 'a rusty can', 'nothing at all', 'a lost sock'];

  const BOSS_NAMES = ['Professor Puzzle', 'The Grumbling Grammarian', 'Baron Blunder',
                      'Countess Confusion', 'The Number Nibbler', 'Sir Slipsalot'];

  /* A fresh player, with every game's own state on them from the start, so no
   * mode has to remember to add its fields. */
  const blankPlayer = (row) => ({
    id: row.id, name: row.name, avatar: Number(row.avatar) || 0, team: row.team || 'red',
    score: 0, hp: 100, streak: 0, best: 0, answered: false, correct: null, down: false,
    lastDamage: 0, distance: 0, blocks: 0, coins: 0, chest: '', lastGain: 0, target: '',
    balloons: BALLOONS, hits: 0, cards: [], spares: 0,
    height: 0, safe: true, machines: 0, output: 0, catch: '', weight: 0, best_catch: 0,
    // the move, and whatever it was aimed at
    move: '', on: '', job: null,
    // per-mode workings the moves need
    sway: 0, item: false, run: 0, rocks: false, tuned: 0, stopped: false,
    guarding: false, acted: '', shielded: false, exposed: false, offer: ''
  });

  /* What happens between the questions: the other players first, then the world.
   * Called the moment a round closes, before the reveal is drawn. */
  function afterRound(game) {
    if (!game || !game.players) return;
    const everyone = Object.values(game.players);

    resolve(game);

    if (game.mode === 'volcano') {
      // the lava chases the room: the better everybody is doing, the faster it
      // comes, so a strong class is not simply strolling up a wall
      const average = everyone.length
        ? everyone.reduce((n, p) => n + (p.height || 0), 0) / everyone.length : 0;
      const rise = Math.round(LAVA_BASE + (average - (game.lava || 0)) * (LAVA_CHASE / 100));
      game.lava = Math.max(0, (game.lava || 0) + Math.max(LAVA_BASE, rise));
      everyone.forEach(p => {
        const wasSafe = p.safe;
        p.safe = (p.height || 0) >= game.lava;
        if (wasSafe && !p.safe) game.lastEvents.push(`The lava caught ${p.name}`);
      });
    }

    /* Tower Build: the wind. It is announced a round early and then it arrives,
     * and every tower that is swaying loses the top of itself. A child who built
     * tall three rounds running and did not stop has the tallest tower right up
     * until they do not. */
    if (game.mode === 'tower') {
      if (game.wind) {
        let toppled = 0;
        everyone.forEach(p => {
          if ((p.sway || 0) < SWAY_LIMIT) return;
          const lost = Math.max(1, Math.round(p.blocks * 0.4));
          p.blocks = Math.max(0, p.blocks - lost);
          p.sway = 0; p.score = p.blocks;
          toppled++;
          game.lastEvents.push(`The wind took ${lost} off ${p.name}'s tower`);
        });
        if (!toppled) game.lastEvents.push('The wind blew and every tower held');
        game.wind = false;
      } else if (Math.random() < 0.34) {
        game.wind = true;
        game.lastEvents.push('The wind is getting up — brace anything that is swaying');
      }
    }

    if (game.mode === 'factory') {
      everyone.forEach(p => {
        if (!p.machines) { p.output = 0; return; }
        if (p.stopped) {
          p.stopped = false; p.output = 0;
          game.lastEvents.push(`${p.name}'s machines were jammed and paid nothing`);
          return;
        }
        const paid = p.machines * (MACHINE_YIELD + (p.tuned || 0) * TUNE_BONUS);
        p.coins += paid;
        p.output = paid;
        p.score = p.coins + p.output * 3;
      });
      const busiest = everyone.filter(p => p.machines > 0)
        .sort((a, b) => b.output - a.output)[0];
      if (busiest && busiest.output) {
        game.lastEvents.push(`${busiest.name}'s ${busiest.machines} machine`
          + (busiest.machines === 1 ? '' : 's') + ` paid out ${busiest.output}`);
      }
    }

    /* Fishing Frenzy: the shoal moves, and where it goes is the only thing
     * everybody in the room is looking at when the next question comes up. */
    if (game.mode === 'fishing') {
      const was = game.shoal;
      const options = SPOT_IDS.filter(id => id !== was);
      game.shoal = options[Math.floor(Math.random() * options.length)];
      game.lastEvents.push(`The shoal has moved to ${SPOTS[game.shoal].label.toLowerCase()}`);
    }

    /* Tug of War: an anchor holds for the round it was called and no longer. */
    if (game.mode === 'tug' && game.teams) {
      ['red', 'blue'].forEach(side => { if (game.teams[side]) game.teams[side].anchored = false; });
    }

    game.lastEvents = game.lastEvents.slice(-6);
  }

  /* Buying a machine, which is the one thing a player does between questions
   * rather than during one. Priced so the second is dearer than the first: a
   * runaway leader who can buy five in a round is not a game.
   *
   * Returns what happened, so the phone can say it without knowing the prices.
   */
  function buyMachine(game, p) {
    if (!game || game.mode !== 'factory' || !p) return { ok: false, why: 'Not that kind of game.' };
    const cost = MACHINE_COST + MACHINE_STEP * (p.machines || 0);
    if ((p.coins || 0) < cost) return { ok: false, why: `${cost - (p.coins || 0)} more coins needed`, cost };
    p.coins -= cost;
    p.machines = (p.machines || 0) + 1;
    p.score = p.coins + (p.output || 0) * 3;
    game.lastEvents.push(`${p.name} built machine number ${p.machines}`);
    return { ok: true, cost, machines: p.machines, next: MACHINE_COST + MACHINE_STEP * p.machines };
  }
  const machineCost = (p) => MACHINE_COST + MACHINE_STEP * ((p && p.machines) || 0);

  /* Some games end themselves before the questions run out: a fort falls, a boss
   * dies, a rope crosses the line, somebody completes the set. Asked in one place
   * so the website, the app and the Flask edition cannot drift apart on it. */
  function modeFinished(game) {
    if (game.mode === 'snow') {
      return ['red', 'blue'].some(side => game.teams[side].max && game.teams[side].blocks <= 0);
    }
    if (game.mode === 'boss') return !!game.boss && (game.boss.hp === 0 || game.boss.classHp === 0);
    if (game.mode === 'tug') return Math.abs(game.rope || 0) >= ROPE_LENGTH;
    if (game.mode === 'cards') {
      return Object.values(game.players).some(p => (p.cards || []).length >= CARD_SET.length);
    }
    /* Volcano Climb ends when the lava has everybody, which is a real ending
     * rather than a countdown: the room can see it coming and can stop it. */
    if (game.mode === 'volcano') {
      const everyone = Object.values(game.players);
      return everyone.length > 0 && everyone.every(p => !p.safe);
    }
    return false;
  }

  const pickBossName = () => BOSS_NAMES[Math.floor(Math.random() * BOSS_NAMES.length)];

  global.NovaRules = {
    MODES, MAPS, GOALS, SETUP, SCORERS, BOSS_NAMES, MOVES, CHESTS,
    mapsFor, defaultMap, readGoal, goalReached, grade, blankPlayer, pickBossName,
    readSetup, secondsFor, pointsFor, streakBonus, arrange, modeFinished,
    afterRound, resolve, buyMachine, machineCost, SPOTS, SPOT_IDS, FISH, JUNK,
    movesFor, defaultMove, moveOf, chooseMove,
    CLIMB_PER, LAVA_BASE, LAVA_CHASE, MACHINE_COST, MACHINE_STEP, MACHINE_YIELD, TUNE_BONUS,
    TRACK_LENGTH, BOSS_HP_PER_QUESTION, FORT_BLOCKS, BALLOONS, MAX_PLAYER_HIT,
    ROPE_LENGTH, CARD_SET, SPARES_PER_SWAP, SWAY_LIMIT
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaRules;
