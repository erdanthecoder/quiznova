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
    
    laser:    { label: 'Laser Tag',    icon: 'laser', blurb: 'Push up, take aim or take cover. One arena, two teams' },
    
    tower:    { label: 'Tower Build',  icon: 'bricks', blurb: 'Build tall and sway, or stop and brace before the wind' },
    
    boss:     { label: 'Boss Battle',  icon: 'dragon', blurb: 'It says what it will do next. The class has to agree' },
    
    
    
    
    
    volcano:  { label: 'Volcano Climb', icon: 'flame', blurb: 'Three routes up. The fastest drops rocks on those below' },
    
    };
  /* Each game is played on a map the teacher picks. A map is scenery and a palette:
   * it changes what the board looks like, not how the scoring works. */
  const MAPS = {
    
    laser:    [['arena', 'Neon Arena'], ['bunker', 'Bunker'], ['moon', 'Moon Base']],
    
    tower:    [['site', 'Building Site'], ['candy', 'Candy Land'], ['castle', 'Castle Walls']],
    
    boss:     [['lair', 'Dragon Lair'], ['volcano', 'Volcano'], ['ruins', 'Old Ruins']],
    
    
    
    
    
    volcano:  [['crater', 'The Crater'], ['ashfall', 'Ashfall'], ['obsidian', 'Obsidian Cliffs']],
    
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

  /* When a mode is not recognised — an old saved game naming one of the ten
   * that were removed, or a typo in a request — this is what it becomes. Tower
   * Build, because it is the one that asks least of a room: no teams to sort
   * out, no coordination, and it works with three children or thirty. */
  const DEFAULT_MODE = 'tower';

  const mapsFor = (mode) => (MAPS[mode] || MAPS[DEFAULT_MODE]).map(([id, label]) => ({ id, label }));
  const defaultMap = (mode) => (MAPS[mode] || MAPS[DEFAULT_MODE])[0][0];

  const BOSS_HP_PER_QUESTION = 55;
  const MAX_PLAYER_HIT = 40;       // the most one shot can take off a player

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
    
    laser: {
      ask: 'How are you playing this one?', when: 'question',
      list: [
        { id: 'aim',   label: 'Take aim',   note: 'Normal shot at whoever you picked' },
        { id: 'push',  label: 'Push up',    note: 'Hit twice as hard, and take twice as much back' },
        { id: 'cover', label: 'Take cover', note: 'Half a shot, and you shield whoever is weakest' }
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
    
    boss: {
      ask: 'What is the class doing?', when: 'question',
      list: [
        { id: 'attack', label: 'Attack', note: 'Hurt it. Nothing protects you' },
        { id: 'guard',  label: 'Guard',  note: 'Soak its next hit for everyone' },
        { id: 'heal',   label: 'Heal',   note: 'Put the class back on its feet' }
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
    } else {
      p.on = '';
    }
    p.move = id;
    return { ok: true, move: id, on: p.on };
  }

  /* ── the modes, same rules as the server edition ─── */
  const SCORERS = {


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

  const BOSS_NAMES = ['Professor Puzzle', 'The Grumbling Grammarian', 'Baron Blunder',
                      'Countess Confusion', 'The Number Nibbler', 'Sir Slipsalot'];

  /* A fresh player, with every game's own state on them from the start, so no
   * mode has to remember to add its fields. */
  const blankPlayer = (row) => ({
    id: row.id, name: row.name, avatar: Number(row.avatar) || 0, team: row.team || 'red',
    score: 0, hp: 100, streak: 0, best: 0, answered: false, correct: null, down: false,
    lastDamage: 0, lastGain: 0, target: '',
    blocks: 0, sway: 0,                       // tower build
    height: 0, safe: true, rocks: false,      // volcano climb
    guarding: false, acted: '',               // boss battle
    shielded: false, exposed: false,          // laser tag
    // the move, and whatever it was aimed at
    move: '', on: ''
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

    game.lastEvents = game.lastEvents.slice(-6);
  }

  /* Two of the four end themselves before the questions run out — a boss dies,
   * or the lava has everybody. Asked in one place so the website, the app and
   * the Flask edition cannot drift apart on it. */
  function modeFinished(game) {
    if (game.mode === 'boss') return !!game.boss && (game.boss.hp === 0 || game.boss.classHp === 0);
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
    MODES, MAPS, GOALS, SETUP, SCORERS, BOSS_NAMES, MOVES, DEFAULT_MODE,
    mapsFor, defaultMap, readGoal, goalReached, grade, blankPlayer, pickBossName,
    readSetup, secondsFor, pointsFor, streakBonus, arrange, modeFinished,
    afterRound, resolve, movesFor, defaultMove, moveOf, chooseMove,
    CLIMB_PER, LAVA_BASE, LAVA_CHASE,
    BOSS_HP_PER_QUESTION, MAX_PLAYER_HIT, SWAY_LIMIT
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaRules;
