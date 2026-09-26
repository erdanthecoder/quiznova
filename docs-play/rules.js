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

    /* The plain one. Every other mode is a game with a quiz inside it; this is
       the quiz, and sometimes that is what a lesson wants — a starter, a recap,
       five minutes before the bell. It is not a lesser mode for being simple:
       what it has that none of the others do is that the score is only ever
       about the answer, so a child who knows it and is quick wins. */
    normal:   { label: 'Classic Quiz',  icon: 'play', blurb: 'Straight questions on the board. Answer fast — the quicker you are, the more it is worth' },

    laser:    { label: 'Laser Tag',    icon: 'laser', blurb: 'Push up, take aim or take cover. One arena, two teams' },
    
    tower:    { label: 'Tallest Tower', icon: 'bricks', teams: 3,
                blurb: 'Three teams, one race up. Answer to earn a block, then time the drop — the neater you place it, the faster you climb' },
    
    boss:     { label: 'Boss Battle',  icon: 'dragon',
                blurb: 'Three minutes, thirty health, one class. Answer to load your knife, then put it in' },

    robot:    { label: 'Robot Run',     icon: 'dragon', blurb: 'The whole class outruns the robot together. Answer, earn a boost, hold to use it' },

    /* The limited edition.
     *
     * Salburun is the old hunt — a golden eagle, a horse and a canyon — and
     * this is the canyon, in real three dimensions, with a bird in it for every
     * child in the room. It is here because two apps that had never worked
     * together now do, and a thing made for that ought to feel like an occasion
     * rather than like the sixth item on a list.
     *
     * `limited` is what makes it an occasion. It is in the game between those
     * two dates and not before or after, and the board says so while it is
     * here. Everything a class owns from playing it stays theirs afterwards —
     * what ends is the mode, not what anybody earned in it. */
    eagle:    { label: 'Eagle Hunt', icon: 'flag',
                limited: { from: '2026-09-26', until: '2026-12-31',
                           note: 'A limited edition, with LearnKyrgyz' },
                blurb: 'One canyon, everybody\'s eagle in it. Every right answer is a beat of its wings — and the bird at the back rides the wind' },

    };
  /* Each game is played on a map the teacher picks. A map is scenery and a palette:
   * it changes what the board looks like, not how the scoring works. */
  const MAPS = {

    normal:   [['classic', 'Classic'], ['chalk', 'Chalkboard'], ['sunset', 'Sunset']],

    laser:    [['arena', 'Neon Arena'], ['bunker', 'Bunker'], ['moon', 'Moon Base']],
    
    tower:    [['site', 'Building Site'], ['candy', 'Candy Land'], ['castle', 'Castle Walls']],
    
    boss:     [['lair', 'Dragon Lair'], ['volcano', 'Volcano'], ['ruins', 'Old Ruins']],

    robot:    [['station', 'The Space Station'], ['reactor', 'Reactor Deck'], ['hangar', 'The Hangar']],

    eagle:    [['canyon', 'Ala-Too Canyon'], ['dusk', 'Red Gorge'], ['storm', 'The Storm']],

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
    /* On. It used to be off, on the grounds that a question ending "all of the
       above" is written in an order that means something — which is true, and
       is now handled by leaving those particular questions alone rather than by
       leaving every question alone. Off by default meant a quiz whose answers
       all sat in the same place stayed that way, and nobody was ever going to
       find a switch to fix it. */
    mix:        { label: 'Answers in a new order too', on: true },
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
    /* One question, somewhere in the middle, worth double — and nobody knows
       which until it is on the screen. It is the thing Blooket's best modes all
       have and this did not: a game where the lead is safe from question three
       onwards is over at question three, whatever the board says. */
    if (game.doubleAt !== undefined && game.doubleAt === game.index) base *= 2;
    return base;
  }

  /** Which question is worth double, decided when the game starts. Never the
      first — a swing has to be something you can see coming for — and never at
      all in a quiz too short for it to be a surprise. */
  function pickDouble(count) {
    const n = Number(count) || 0;
    if (n < 4) return -1;
    return 1 + Math.floor(Math.random() * (n - 1));
  }

  /** The multiplier for answering several right in a row, unless it is switched off. */
  function streakBonus(game, player) {
    if (game.setup && game.setup.streaks === false) return 1;
    return 1 + Math.min(player.streak, 5) * 0.1;
  }

  /* Questions in a new order, and the answers within them, so a class playing the
   * same quiz twice is not simply remembering that it was the third one. */
  /* A real shuffle, rather than sort(() => Math.random() - 0.5). That
     comparator is inconsistent, so the permutations it produces are not
     equally likely — and when what is being shuffled is where the right answer
     goes, an uneven shuffle is a child learning to guess the colour. */
  function shuffled(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /* Some questions are written in an order that carries meaning: anything with
     an "all of the above" in it reads as nonsense once the options move, because
     "the above" stops being above. Those are left exactly as the teacher wrote
     them; everything else is fair game. */
  const ORDERED = /\b(all|none|both|either|neither)\s+(of\s+)?(the\s+)?(above|below|these|those)\b|^(all|none)\s+of\s+them$/i;
  const orderMatters = (q) => (q.choices || []).some(c => ORDERED.test(String(c.text || '')));

  function arrange(questions, setup) {
    let out = questions;
    if (setup.shuffle) out = shuffled(out);
    if (setup.mix) {
      out = out.map(q => (q.choices && q.choices.length > 1 && !orderMatters(q))
        ? Object.assign({}, q, { choices: shuffled(q.choices) })
        : q);
    }
    return out;
  }

  /* When a mode is not recognised — an old saved game naming one of the ten
   * that were removed, or a typo in a request — this is what it becomes. Tower
   * Build, because it is the one that asks least of a room: no teams to sort
   * out, no coordination, and it works with three children or thirty. */
  /* The plain quiz is the default. A teacher who picks nothing should get the
     thing the tool is for, not whichever game happened to be first. */
  /* ── Robot Run: the safe zones between decks ──────────────
   *
   * Kahoot's Robot Run puts a mini-game between rounds: the players move their
   * characters with a joystick into green safe zones, each of which holds only
   * so many, and it gets harder as the game goes on. It is the one documented
   * piece of that mode this never had — the deck number simply went up and the
   * class carried on running, which is a lap counter rather than a game.
   *
   * The zones are worked out from the deck number alone, so every phone and the
   * board draw the same ones without anybody having to send them. There are
   * fewer of them and they are smaller each deck, and between them they hold
   * just enough of the room — which is the tension: somewhere in the class,
   * somebody is going to be left outside a full one.
   */
  const SAFE_MS = 15000;               // how long the class has to get in
  const FIELD_W = 1000, FIELD_H = 700; // the deck they are running about on

  function safeZones(round, heads) {
    const deck = Math.max(1, Number(round) || 1);
    const people = Math.max(1, Number(heads) || 1);
    const count = Math.max(2, 5 - Math.floor((deck - 1) / 2));
    // just enough room for everybody, and no more: one zone short of comfort
    const cap = Math.max(1, Math.ceil(people / count));
    const r = Math.max(70, 140 - (deck - 1) * 12);
    const zones = [];
    for (let i = 0; i < count; i++) {
      // laid out on a ring, turned a little each deck so it is never the same twice
      const a = (i / count) * Math.PI * 2 + deck * 0.7;
      zones.push({
        id: 'z' + i,
        x: Math.round(FIELD_W / 2 + Math.cos(a) * FIELD_W * 0.31),
        y: Math.round(FIELD_H / 2 + Math.sin(a) * FIELD_H * 0.31),
        r, cap
      });
    }
    return zones;
  }

  /** How many are standing in each zone right now. */
  function zoneCounts(game) {
    const counts = {};
    Object.values(game.players || {}).forEach(p => {
      if (p.zone) counts[p.zone] = (counts[p.zone] || 0) + 1;
    });
    return counts;
  }

  /* One child stepping into a zone. Full is full: the room has to sort itself
     out, which is the whole point of the phase. */
  function claimZone(game, p, zoneId) {
    const zones = safeZones(game.round || 1, Object.keys(game.players || {}).length);
    /* Walking out of a zone gives the place up. Without this a child could step
       in, be counted, and wander back off across the deck still safe — which
       makes the last place in a zone worth taking early and then ignoring, and
       the whole scramble a race to touch a circle once. */
    if (!zoneId) {
      const had = p.zone;
      p.zone = '';
      return { ok: true, zone: '', left: !!had };
    }
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return { ok: false, why: 'No such zone.' };
    if (p.zone === zone.id) return { ok: true, zone: zone.id, already: true };
    const counts = zoneCounts(game);
    if ((counts[zone.id] || 0) >= zone.cap) return { ok: false, why: 'That one is full.', full: true };
    p.zone = zone.id;
    return { ok: true, zone: zone.id };
  }

  /* The phase ending. Anybody still outside a zone costs the class a life —
     shared, like everything else in this mode, so the room is shouting at each
     other to make space rather than racing. */
  function settleSafe(game) {
    const everyone = Object.values(game.players || {});
    /* Somebody who joined, or rejoined, while the hatch was already open never
       had a chance to get to a zone — and a phone that dropped its wifi for ten
       seconds should not cost the class a life on the way back in. */
    const opened = (game.safeEndsAt || now()) - SAFE_MS;
    const adrift = everyone.filter(p => !p.zone && !(p.joinedAt > opened));
    if (adrift.length) {
      game.lives = Math.max(0, (game.lives === undefined ? 3 : game.lives) - 1);
      game.lastEvents.push(adrift.length === 1
        ? `${adrift[0].name} did not make it — a life gone`
        : `${adrift.length} did not make it — a life gone`);
    } else {
      game.lastEvents.push('Everybody made it');
    }
    everyone.forEach(p => { p.zone = ''; });
    return adrift.length;
  }

  /* ── Tallest Tower ────────────────────────────────────────
   *
   * Rebuilt from how Kahoot's actually works, which is nothing like what was
   * here. What was here: pick wide, tall or brace, and a number went up. No
   * tower was ever drawn anywhere, so the mode was a quiz with the word tower
   * written on it.
   *
   * Kahoot's Tallest Tower: the room is split into teams, you answer at your
   * own pace to earn construction blocks, and then you place each one by
   * timing a tap while it slides across — looking at the host's screen to see
   * where your team's floor still needs filling. A floor is finished when the
   * team has put a block in every slot in the row. There is a gift box at a
   * height that pays out extra blocks, and a monster that turns up and crushes
   * a floor off whoever is winning.
   *
   * So all of that, plus the one thing it does not have: where you drop the
   * block is kept and drawn. Place it neatly and it sits square; snatch at it
   * and your team's floor is visibly crooked for the rest of the game. That is
   * the difference between a timing bar and a tower.
   */
  const TOWER_TEAMS = ['red', 'blue', 'green'];
  const TOWER_NAMES = { red: 'Crimson', blue: 'Cobalt', green: 'Clover' };
  const SLOTS = 4;                     // blocks in one finished floor
  const PERFECT = 0.09;                // how square a drop has to be to count as neat
  const GIFT_EVERY = 5;                // a gift box waits at every fifth floor
  const GIFT_BLOCKS = 3;
  const MONSTER_EVERY = 38000;         // how often it comes, in milliseconds
  const MONSTER_FLOOR = 3;             // and the shortest tower it will bother with
  const GORILLA_MS = 9000;             // how long the gorilla sits on a tower
  const MARK_AHEAD = 2;                // floors above a tower the green column sits

  /** A tower, from nothing. */
  const blankTower = () => ({ blocks: [], gift: 0, crushed: 0,
    /* the gorilla, and the green column the other two teams are climbing for
       while he is up there */
    apeUntil: 0, mark: 0, shield: 0 });

  /** How many finished floors a tower has. */
  const floorsOf = (tower) => Math.floor((tower.blocks.length) / SLOTS);

  /** Every tower in the game, made if they are not there yet. */
  function towersOf(game) {
    if (!game.towers) game.towers = {};
    TOWER_TEAMS.forEach(t => { if (!game.towers[t]) game.towers[t] = blankTower(); });
    return game.towers;
  }

  /* Placing one block.
   *
   * `offset` is where it landed, −1 hard left to +1 hard right, and it is kept
   * on the block so the tower is drawn as it was actually built. A neat drop
   * earns the team a second block, which is the whole reason to take the extra
   * half second rather than mashing the button.
   *
   * `seq` counts: a phone that reconnects and repeats itself cannot build a
   * floor on its own. */
  function placeBlock(game, p, offset, seq) {
    const towers = towersOf(game);
    const team = TOWER_TEAMS.includes(p.team) ? p.team : TOWER_TEAMS[0];
    const tower = towers[team];
    const want = Math.max(0, Math.round(Number(seq) || 0));
    if (want <= (p.placed || 0)) return { ok: true, already: true };
    p.placed = Math.min(want, (p.placed || 0) + 1);

    /* The gorilla is on this tower. Kahoot's rule, and it is a good one: the
       block still leaves your hand, it simply never lands — so the team can see
       what he is costing them rather than being told their button is broken.
       The drop is counted against the sequence above, so the phone moves on. */
    if (tower.apeUntil && now() < tower.apeUntil) {
      return { ok: true, dropped: true, ape: true,
               why: 'The gorilla is on your tower', floors: floorsOf(tower) };
    }

    const o = Math.max(-1, Math.min(1, Number(offset) || 0));
    const neat = Math.abs(o) <= PERFECT;
    tower.blocks.push({ o, by: p.name, neat });
    p.blocks = (p.blocks || 0) + 1;
    if (neat) {
      tower.blocks.push({ o: -o * 0.4, by: p.name, neat: true, bonus: true });
      p.blocks += 1;
      game.lastEvents.push(`${p.name} dropped that one square — two blocks`);
    }
    p.score = p.blocks;
    if (tower.blocks.length > 400) tower.blocks = tower.blocks.slice(-400);

    // the gift box, waiting at every fifth floor
    const floors = floorsOf(tower);
    while (floors >= (tower.gift + 1) * GIFT_EVERY) {
      tower.gift += 1;
      for (let i = 0; i < GIFT_BLOCKS; i++) {
        tower.blocks.push({ o: (Math.random() - 0.5) * 0.3, by: 'the gift box', gift: true });
      }
      game.lastEvents.push(`${TOWER_NAMES[team]} reached the gift box — three free blocks`);
    }

    /* The green column. It appears on the two towers the gorilla is not on, a
       couple of floors up: build to it before he comes down and the team earns
       a shield, which is what they have to chase him off with next time. */
    let won = false;
    if (tower.mark && floorsOf(tower) >= tower.mark) {
      tower.mark = 0;
      tower.shield = 1;
      won = true;
      game.lastEvents.push(`${TOWER_NAMES[team]} made it to the green column — shielded`);
    }
    return { ok: true, floors: floorsOf(tower), blocks: tower.blocks.length,
             neat, mark: tower.mark, shield: tower.shield, won };
  }

  /* The gorilla. He comes for whoever is winning, which is the only fair thing
   * for him to do: a mode where the team that got ahead first stays ahead is a
   * mode the other twenty children stop playing.
   *
   * He takes a floor and then sits on the tower, and while he is up there that
   * team can drop blocks but nothing lands. The other two teams get a green
   * column to climb to — reach it and the team is shielded, and a shielded
   * tower chases him off instead of losing anything. That is the whole shape of
   * Kahoot's: the team in front loses time, everybody else gets something to do
   * with it, and a team that keeps building is never punished for it.
   */
  function towerMonster(game) {
    const towers = towersOf(game);
    const tallest = TOWER_TEAMS
      .map(t => ({ t, n: floorsOf(towers[t]) }))
      .sort((a, b) => b.n - a.n)[0];
    if (!tallest || tallest.n < MONSTER_FLOOR) return null;
    const tower = towers[tallest.t];

    if (tower.shield) {
      tower.shield = 0;
      game.lastEvents.push(`${TOWER_NAMES[tallest.t]} chased the gorilla off`);
      return null;
    }

    tower.blocks = tower.blocks.slice(0, Math.max(0, tower.blocks.length - SLOTS));
    tower.crushed += 1;
    tower.apeUntil = now() + GORILLA_MS;
    tower.mark = 0;
    // the column goes up on the towers he is not on
    TOWER_TEAMS.filter(t => t !== tallest.t).forEach(t => {
      towers[t].mark = floorsOf(towers[t]) + MARK_AHEAD;
    });
    game.lastEvents.push(`The gorilla is on ${TOWER_NAMES[tallest.t]} — build to the green column`);
    return tallest.t;
  }

  /** He climbs down on his own. The marks go with him, so a green column is
      always something to do now rather than a line left on the wall. */
  function towerSettle(game) {
    if (!game.towers) return false;
    let moved = false;
    for (const t of TOWER_TEAMS) {
      const tower = game.towers[t];
      if (!tower) continue;
      if (tower.apeUntil && now() >= tower.apeUntil) {
        tower.apeUntil = 0;
        moved = true;
        game.lastEvents.push(`The gorilla climbed down off ${TOWER_NAMES[t]}`);
        TOWER_TEAMS.forEach(o => { if (game.towers[o]) game.towers[o].mark = 0; });
      }
    }
    if (moved) game.lastEvents = game.lastEvents.slice(-6);
    return moved;
  }

  const DEFAULT_MODE = 'normal';

  const mapsFor = (mode) => (MAPS[mode] || MAPS[DEFAULT_MODE]).map(([id, label]) => ({ id, label }));
  const defaultMap = (mode) => (MAPS[mode] || MAPS[DEFAULT_MODE])[0][0];

  /* ── Boss Battle ──────────────────────────────────────────
   *
   * It used to run in step: everybody answered the same question at the same
   * moment, then everybody fought for ten seconds, then everybody waited. The
   * waiting is the problem — a child who reads quickly spent most of the mode
   * watching, and a child who reads slowly was hurried by a clock that was not
   * theirs.
   *
   * So it is one three-minute fight now and nobody is in step. You answer at
   * your own pace out of the whole quiz; a right answer loads your knife; the
   * knife takes one health off the boss and then needs two seconds before it
   * can be used again. Thirty health, one class, one clock. The board carries
   * the boss, the clock and the standings, which is what a room should be
   * looking up at.
   *
   * Every knife does exactly one. The six shapes come from the blook and are
   * yours all game, so the ring is thirty different weapons — and all of them
   * kill it the same way, which is what was asked for. */
  const BOSS_HP = 30;                  // the whole class against thirty
  const BOSS_MS = 3 * 60 * 1000;       // three minutes on the clock
  const KNIFE_RELOAD_MS = 2000;        // between one swing and the next

  /* ── the boss hits back ────────────────────────────────
   *
   * Thirty children queuing up to tap a thing that never moves is not a fight,
   * it is a raffle with extra steps: the boss had no way to do anything to
   * anybody, so nothing that happened in three minutes could go wrong for the
   * room. Now it swings, on a clock everyone can see coming.
   *
   * A knife held ready blocks it — which is the whole tactic: stay loaded
   * rather than spending the moment you can. Anybody caught empty-handed is
   * knocked down for four seconds and loses their run. It gets angrier as it
   * goes: below twenty it swings half again as often, below ten it is twice.
   */
  const BOSS_SWING_MS = 16000;         // how often it comes, at full health
  const BOSS_TELL_MS = 2200;           // how long the wind-up is before it lands
  const BOSS_DOWN_MS = 4000;           // how long being caught keeps you down
  const BOSS_ANGRY = 20, BOSS_FURIOUS = 10;

  /** How often it swings right now: the lower it goes, the harder it fights. */
  function bossPace(boss) {
    const hp = (boss && boss.hp) || 0;
    if (hp <= BOSS_FURIOUS) return Math.round(BOSS_SWING_MS / 2);
    if (hp <= BOSS_ANGRY) return Math.round(BOSS_SWING_MS / 1.5);
    return BOSS_SWING_MS;
  }

  /** What it is: calm, angry or furious. The board paints it and the room can
      hear the difference in what the class is shouting. */
  function bossMood(boss) {
    const hp = (boss && boss.hp) || 0;
    return hp <= BOSS_FURIOUS ? 'furious' : hp <= BOSS_ANGRY ? 'angry' : 'calm';
  }

  /* The swing itself. Everybody with a knife ready spends it blocking; anybody
     without one goes down, loses their streak, and cannot swing until they are
     up again. Returns what happened, for the board to say out loud. */
  function bossSwing(game) {
    if (!game || game.mode !== 'boss' || !game.boss) return null;
    const everyone = Object.values(game.players || {});
    const blocked = [], caught = [];
    everyone.forEach(p => {
      if ((p.loaded || 0) > 0) {
        p.loaded -= 1;              // the knife is spent turning it aside
        p.blocks = (p.blocks || 0) + 1;
        blocked.push(p.name);
      } else {
        p.downUntil = now() + BOSS_DOWN_MS;
        p.streak = 0;
        caught.push(p.name);
      }
    });
    game.boss.swungAt = now();
    game.boss.nextSwing = now() + bossPace(game.boss);
    game.lastEvents.push(caught.length
      ? `${game.boss.name} caught ${caught.length === 1 ? caught[0] : caught.length + ' of them'}`
      : 'Everybody blocked it');
    game.lastEvents = game.lastEvents.slice(-6);
    return { blocked: blocked.length, caught: caught.length };
  }

  /** Is this player on the floor right now? */
  const bossDown = (p) => !!(p && p.downUntil && now() < p.downUntil);
  const KNIFE_DAMAGE = 1;              // every knife, the same

  const BOSS_HP_PER_QUESTION = 55;     // kept: older saved games still hold it
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
    
    
    /* Boss Battle has no move to pick. Its decision is a real one, made with a
     * thumb in the ten seconds after the question: when to swing and when to
     * roll. A menu of three words would be a worse version of that. */

    /* Monster Run has no move to pick either. It is played in real time with a
     * thumb, at each child's own pace, and a menu would only get in the way of
     * the next question. */

    
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
    /* Answering earns the block. Placing it is what builds.
     *
     * A wrong answer costs nothing. It used to knock blocks off your own tower,
     * which reads as a punishment for trying and is not what Kahoot does —
     * there, a wrong answer simply does not hand you a block, and the thing
     * you lose is the time. The monster is where the drama comes from now, and
     * it goes after whoever is ahead rather than whoever is struggling. */
    tower(game, p, q, ok, speed) {
      if (ok) {
        p.ready = (p.ready || 0) + 1;
        p.lastGain = 1;
      } else {
        p.lastGain = 0;
      }
      p.score = p.blocks || 0;
    },

    /* Boss Battle does not really score here any more.
     *
     * It used to be the same as every other mode: answer, and a number goes up.
     * What the answer buys now is a weapon, and the damage is done in the ten
     * seconds afterwards with it — so a child who reads fast and a child who
     * reads slowly both walk into the fight, and the one who wins it is the one
     * who reads the boss rather than the question.
     *
     * Right and quick is a greatsword. Right is a sword. Wrong is a stick, which
     * is weak and is still a thing to hold: nobody sits a round out watching
     * other people play. */
    /* Answering loads the knife. Putting it in is what hurts the boss.
     *
     * The tier still comes from how fast the answer was, because a greatsword
     * is worth seeing and worth earning — but it decides what the weapon looks
     * like, not what it does. Every knife takes exactly one health off, which
     * is the whole point of everyone carrying a different one. */
    boss(game, p, q, ok, speed) {
      p.blade = !ok ? 'stick' : speed >= 0.5 ? 'great' : 'sword';
      if (ok) {
        p.loaded = (p.loaded || 0) + 1;
        p.lastGain = 1;
        if (speed >= 0.5) game.lastEvents.push(`${p.name} picked up a greatsword`);
      } else {
        p.lastGain = 0;
      }
      p.score = p.hits || 0;
    },

    /* Robot Run scores nothing here.
     *
     * Everybody is answering at their own pace and none of it is a race against
     * each other — the whole class is running from the same robot and it is the
     * boosts, pooled, that decide whether they get away. Their phones report
     * what they earned; the game keeps the shared escape. All this does is note
     * the answer so the teacher's marking still works. */
    robot(game, p, q, ok, speed) {
      p.lastGain = 0;
    },

    /* Classic Quiz: the answer, and how fast it came.
     *
     * `speed` is one for an instant answer and nought for one on the buzzer, so
     * half the marks are for knowing it and half for being quick. Answering at
     * the last second still scores — a child who worked it out slowly has
     * worked it out, and taking that away teaches guessing.
     *
     * A streak is worth something on top, and it is capped. Uncapped, one child
     * who starts well runs away with it by the fourth question and everybody
     * else stops trying, which is the failure mode of every classroom quiz
     * anybody has ever sat through. */
    /* Eagle Hunt: the answer is a wingbeat, and the wind is on the side of
     * whoever is behind.
     *
     * The tailwind is the one thing in it that is not Classic with a canyon
     * behind it. A bird a long way back is carried — up to half again on what
     * it earns — and the carry shrinks to nothing as it closes. Two reasons,
     * and neither is kindness:
     *
     *   A race everybody can see is only worth watching while it is a race. In
     *   a straight-scoring race the order is settled by question four and the
     *   other twenty-six are a formality with a view.
     *
     *   And it does not take anything from the leader. It never moves anybody
     *   backwards and it never slows the front — the child in front still gets
     *   full value for every answer, so nothing they have earned is taken off
     *   them to make the game close. What the wind buys is that the child at
     *   the back is still playing for something on question nineteen.
     *
     * A wrong answer costs nothing, as everywhere else here. What it costs you
     * is the ground the rest of the canyon just took.
     */
    eagle(game, p, q, ok, speed) {
      const worth = Number(q && q.points) || 100;
      let gain = 0;
      if (ok) {
        gain = Math.round(worth * (0.55 + 0.45 * speed));
        const all = Object.values(game.players || {});
        const lead = all.reduce((m, x) => Math.max(m, x.score || 0), 0);
        const behind = Math.max(0, lead - (p.score || 0));
        const wind = lead > 0 ? Math.min(0.5, (behind / lead) * 0.6) : 0;
        if (wind > 0) gain = Math.round(gain * (1 + wind));
        if (wind >= 0.34) game.lastEvents.push(`${p.name} caught the wind`);
        else if (speed >= 0.8) game.lastEvents.push(`${p.name} answered that one in a flash`);
      }
      p.score += gain;
      p.lastGain = gain;
    },

    normal(game, p, q, ok, speed) {
      const worth = Number(q && q.points) || 100;
      let gain = 0;
      if (ok) {
        gain = Math.round(worth * (0.5 + 0.5 * speed));
        const streak = Math.min(p.streak, 5);           // capped on purpose
        if (streak >= 2) gain += Math.round(worth * 0.1 * (streak - 1));
        if (speed >= 0.8) game.lastEvents.push(`${p.name} answered that one in a flash`);
      }
      p.score += gain;
      p.lastGain = gain;
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
   * Then the world takes its own turn: the wind gets up and towers come down.
   * This is the half of a game that happens whether or not you were any good
   * this round, and the modes had none of it before — which is why every round
   * felt the same as the last one.
   */
  function resolve(game) {
    const everyone = Object.values(game.players);

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
    joinedAt: now(),                          // so a child who walked in mid-scramble
                                              // is not counted as having missed it
    blocks: 0, ready: 0, placed: 0,           // tallest tower: earned, and put up
    boosts: 0, safe: true, zone: '',          // robot run: boosts in, and the zone
    loaded: 0, hits: 0, swungAt: 0,           // boss battle: knives loaded, and used
    downUntil: 0, blocks: 0,                  // and knocked down, and swings turned aside
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

    /* The wind used to blow here and take the top off any tower that was
       swaying. Tallest Tower has no sway and no wind: the thing that knocks a
       floor down is the monster, it comes on its own clock rather than between
       questions, and it goes for whoever is winning. */
  }

  /* Some modes end themselves before the questions run out — a boss dies.
   * Asked in one place so the website, the app and
   * the Flask edition cannot drift apart on it. */
  /* What a team has between them. Laser Tag scores per player — a tag is worth
     a hundred — and the two sides are simply those added up. */
  function teamTotal(game, side) {
    return Object.values(game.players || {})
      .filter(p => (p.team === 'blue' ? 'blue' : 'red') === side || p.team === side)
      .reduce((n, p) => n + Math.max(0, p.score || 0), 0);
  }

  /* Which side is ahead in Laser Tag, and by how much. The board, the phones
     and the ending all have to agree, so they all ask here. */
  function laserStanding(game) {
    const red = teamTotal(game, 'red'), blue = teamTotal(game, 'blue');
    return { red, blue, lead: Math.abs(red - blue),
             ahead: red === blue ? '' : (red > blue ? 'red' : 'blue') };
  }

  /* How tall a tower has to be to win, and who has got there. */
  const TOWER_TARGET = 10;              // floors
  function towerWinner(game) {
    const towers = (game && game.towers) || {};
    return TOWER_TEAMS.find(t => towers[t] && floorsOf(towers[t]) >= TOWER_TARGET) || '';
  }

  /* Has the mode itself ended?
   *
   * Two of the five could not. Laser Tag and Tallest Tower ran until a teacher
   * pressed the button, which is not an ending — it is being switched off, and
   * it is why both of them trail away rather than finish. A game a class can
   * win is a game a class plays differently. */
  const LASER_TARGET = 2000;            // points for a side, which is twenty tags
  function modeFinished(game) {
    if (game.mode === 'boss') return !!game.boss && (game.boss.hp === 0 || game.boss.classHp === 0);
    if (game.mode === 'tower') return !!towerWinner(game);
    if (game.mode === 'laser') {
      const { red, blue } = laserStanding(game);
      return red >= LASER_TARGET || blue >= LASER_TARGET;
    }
    return false;
  }

  const pickBossName = () => BOSS_NAMES[Math.floor(Math.random() * BOSS_NAMES.length)];

  global.NovaRules = {
    MODES, MAPS, GOALS, SETUP, SCORERS, BOSS_NAMES, MOVES, DEFAULT_MODE,
    SAFE_MS, FIELD_W, FIELD_H, safeZones, zoneCounts, claimZone, settleSafe,
    TOWER_TEAMS, TOWER_NAMES, SLOTS, PERFECT, GIFT_EVERY, MONSTER_EVERY, MONSTER_FLOOR,
    GORILLA_MS, MARK_AHEAD, TOWER_TARGET, towerWinner, LASER_TARGET, teamTotal, laserStanding,
    blankTower, floorsOf, towersOf, placeBlock, towerMonster, towerSettle,
    mapsFor, defaultMap, readGoal, goalReached, grade, blankPlayer, pickBossName,
    readSetup, secondsFor, pointsFor, pickDouble, streakBonus, arrange, modeFinished, orderMatters,
    afterRound, resolve, movesFor, defaultMove, moveOf, chooseMove,
    BOSS_HP_PER_QUESTION, BOSS_HP, BOSS_MS, KNIFE_RELOAD_MS, KNIFE_DAMAGE,
    BOSS_SWING_MS, BOSS_TELL_MS, BOSS_DOWN_MS, BOSS_ANGRY, BOSS_FURIOUS,
    bossPace, bossMood, bossSwing, bossDown,
    MAX_PLAYER_HIT, SWAY_LIMIT
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaRules;
