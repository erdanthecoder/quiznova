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
    cards:    { label: 'Card Collector', icon: 'cards', blurb: 'Win a card for every right answer. First to all eight' }
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
    cards:    [['attic', 'The Attic'], ['market', 'Card Market'], ['museum', 'The Museum']]
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

  /* ── the modes, same rules as the server edition ─── */
  const SCORERS = {
    normal(game, p, q, ok, speed) {
      if (!ok) { p.lastGain = 0; return; }
      const base = pointsFor(game, q);
      const gain = Math.round((base * 0.5 + base * 0.5 * speed) * streakBonus(game, p));
      p.score += gain; p.lastGain = gain;
    },
    laser(game, p, q, ok, speed) {
      const foe = p.team === 'red' ? 'blue' : 'red';
      const mates = Object.values(game.players);
      if (ok && !p.down) {
        let damage = Math.round(45 + 55 * speed);
        if (p.streak >= 3) damage = Math.round(damage * 1.8);
        const targets = mates.filter(x => x.team === foe && !x.down);
        let hitName = game.teams[foe].name;
        if (targets.length) {
          // whoever they lined up during the countdown, if that player is still standing
          const chosen = targets.find(x => x.id === p.target);
          const target = chosen || targets.reduce((a, b) => (a.hp >= b.hp ? a : b));
          target.hp = Math.max(0, target.hp - Math.min(damage, MAX_PLAYER_HIT));
          target.lastDamage = Math.min(damage, MAX_PLAYER_HIT);
          hitName = target.name;
          if (target.hp === 0) { target.down = true; game.lastEvents.push(`${p.name} knocked out ${target.name}`); }
        }
        game.teams[foe].hp = Math.max(0, game.teams[foe].hp - damage);
        game.teams[p.team].score += damage;
        p.score += damage;
        game.lastEvents.push(`${p.name} hit ${hitName} for ${damage}` + (p.streak >= 3 ? ' (overcharged)' : ''));
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
        p.hp = Math.max(0, p.hp - 10);
        if (p.hp === 0) p.down = true;
        game.lastEvents.push(`${p.name} missed and lost shield`);
      }
    },
    kart(game, p, q, ok, speed) {
      if (!ok) { game.lastEvents.push(`${p.name} span out`); return; }
      let metres = Math.round(45 + 55 * speed);
      const boost = p.streak >= 3;
      if (boost) metres = Math.round(metres * 1.6);
      p.distance += metres; p.score = p.distance; p.lastGain = metres;
      game.lastEvents.push(`${p.name} drove ${metres}m` + (boost ? ' with a boost' : ''));
    },
    tower(game, p, q, ok, speed) {
      if (ok) {
        const gain = speed > 0.55 ? 2 : 1;
        p.blocks += gain; p.lastGain = gain;
        game.lastEvents.push(`${p.name} stacked ${gain} block${gain > 1 ? 's' : ''}`);
      } else {
        if (p.blocks > 0) game.lastEvents.push(`${p.name}'s tower wobbled and a block fell`);
        p.blocks = Math.max(0, p.blocks - 1); p.lastGain = -1;
      }
      p.score = p.blocks;
    },
    /* One rope, both teams, and it can come all the way back. Nothing else here
     * has that: a class two questions from losing can still win it. */
    tug(game, p, q, ok, speed) {
      if (!ok) { p.lastGain = 0; return; }
      const pull = Math.round(4 + 7 * speed) * (p.streak >= 3 ? 2 : 1);
      const way = p.team === 'red' ? -1 : 1;
      game.rope = Math.max(-ROPE_LENGTH, Math.min(ROPE_LENGTH, (game.rope || 0) + way * pull));
      p.score += pull; p.lastGain = pull; p.hits += pull;
      game.teams[p.team].score += pull;
      game.lastEvents.push(`${p.name} pulled ${pull}` + (p.streak >= 3 ? ' — heaving' : ''));
    },

    /* The one game where the person in front should be worried. A right answer
     * opens a chest, and some of those chests take somebody else's gold. */
    heist(game, p, q, ok, speed) {
      if (!ok) { p.lastGain = 0; p.chest = 'Empty-handed'; return; }
      const found = Math.round(60 + 70 * speed);
      const others = Object.values(game.players).filter(x => x.id !== p.id);
      const roll = Math.random();

      if (roll < 0.12 && others.length) {
        const leader = others.reduce((a, b) => (a.coins >= b.coins ? a : b));
        const taken = Math.round(leader.coins * 0.4);
        leader.coins -= taken; leader.score = leader.coins;
        p.coins += found + taken;
        p.chest = `Robbed ${leader.name} of ${taken}`;
        game.lastEvents.push(`${p.name} robbed ${leader.name} of ${taken} gold`);
      } else if (roll < 0.20 && others.length) {
        const other = others[Math.floor(Math.random() * others.length)];
        const mine = p.coins + found;
        p.coins = other.coins; other.coins = mine; other.score = other.coins;
        p.chest = `Swapped piles with ${other.name}`;
        game.lastEvents.push(`${p.name} swapped piles with ${other.name}`);
      } else if (roll < 0.32) {
        p.coins += found * 3;
        p.chest = 'A jackpot chest';
        game.lastEvents.push(`${p.name} opened a jackpot`);
      } else {
        p.coins += found;
        p.chest = `+${found} gold`;
      }
      p.coins = Math.max(0, p.coins);
      p.score = p.coins; p.lastGain = found;
    },

    /* Not a race for points but for a set, so somebody unlucky early is never out
     * of it, and the last card is the hardest one to get. */
    cards(game, p, q, ok, speed) {
      if (!p.cards) p.cards = [];
      if (!ok) { p.lastGain = 0; p.chest = ''; return; }
      const missing = CARD_SET.filter(c => !p.cards.includes(c));
      // answering quickly makes a card you actually need much more likely
      const wantNew = missing.length && Math.random() < (0.45 + 0.45 * speed);
      const card = wantNew ? missing[Math.floor(Math.random() * missing.length)]
                           : CARD_SET[Math.floor(Math.random() * CARD_SET.length)];
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

    treasure(game, p, q, ok, speed) {
      if (!ok) { p.chest = ''; game.lastEvents.push(`${p.name} found an empty chest`); return; }
      let coins = Math.round(60 + 60 * speed);
      const roll = Math.random();
      let chest = '';
      if (roll < 0.12) { coins *= 3; chest = 'Jackpot, three times'; }
      else if (roll < 0.32) { coins *= 2; chest = 'Double chest'; }
      else if (roll < 0.42) {
        const others = Object.values(game.players).filter(x => x.id !== p.id && x.coins > 0);
        if (others.length) {
          const leader = others.reduce((a, b) => (a.coins >= b.coins ? a : b));
          const stolen = Math.floor(leader.coins * 0.2);
          leader.coins -= stolen; leader.score = leader.coins;
          coins += stolen; chest = `Raided ${leader.name} for ${stolen}`;
        }
      }
      p.coins += coins; p.score = p.coins; p.chest = chest; p.lastGain = coins;
      game.lastEvents.push(`${p.name} collected ${coins}` + (chest ? ` — ${chest}` : ''));
    },
    /* Snowball Fight: red against blue, and what the class watches is the other
     * side's fort coming down block by block. A team wins by knocking the last
     * block off, not by holding the highest number — which means a class that
     * fell behind early is still in it while a block remains. */
    snow(game, p, q, ok, speed) {
      const foe = p.team === 'red' ? 'blue' : 'red';
      const fort = game.teams[foe];
      if (!ok) {
        p.lastGain = 0;
        game.lastEvents.push(`${p.name} missed`);
        return;
      }
      // a fast answer throws harder, and a run of them throws harder still
      const power = 1 + Math.min(p.streak, 4) * 0.25;
      const hit = Math.min(fort.blocks, Math.max(1, Math.round((0.6 + speed) * power)));
      fort.blocks -= hit;
      const gain = Math.round(pointsFor(game, q) * (0.5 + 0.5 * speed));
      p.score += gain; p.lastGain = gain; p.hits += hit;
      game.teams[p.team].score += gain;
      game.lastEvents.push(`${p.name} knocked ${hit} block${hit > 1 ? 's' : ''} off the ${fort.name} fort`
                           + (fort.blocks ? '' : ' — it is down!'));
    },

    /* Balloon Drop: three balloons each, and a wrong answer pops one. Being out
     * has to still be worth watching, so a child with no balloons left keeps
     * answering for points — they simply cannot win it any more. */
    balloon(game, p, q, ok, speed) {
      const out = p.balloons <= 0;
      if (!ok) {
        p.lastGain = 0;
        if (out) { game.lastEvents.push(`${p.name} got it wrong`); return; }
        p.balloons -= 1;
        game.lastEvents.push(p.balloons
          ? `${p.name} lost a balloon — ${p.balloons} left`
          : `${p.name} is out of balloons`);
        return;
      }
      const base = pointsFor(game, q);
      // still floating is worth more than playing on for pride
      const gain = Math.round((base * 0.5 + base * 0.5 * speed) * (out ? 0.4 : 1));
      p.score += gain; p.lastGain = gain;
    },

    boss(game, p, q, ok, speed) {
      const boss = game.boss;
      if (ok) {
        let damage = Math.round(20 + 25 * speed);
        if (p.streak >= 3) damage = Math.round(damage * 1.5);
        boss.hp = Math.max(0, boss.hp - damage);
        p.score += damage; p.lastGain = damage;
        game.lastEvents.push(`${p.name} hit ${boss.name} for ${damage}`);
        if (boss.hp === 0) game.lastEvents.push(`${boss.name} is defeated`);
      } else {
        boss.classHp = Math.max(0, boss.classHp - 4);
        p.lastGain = 0;
        game.lastEvents.push(`${boss.name} struck back at the class`);
      }
    }
  };

  const BOSS_NAMES = ['Professor Puzzle', 'The Grumbling Grammarian', 'Baron Blunder',
                      'Countess Confusion', 'The Number Nibbler', 'Sir Slipsalot'];
  /* A fresh player, with every game's own state on them from the start, so no
   * mode has to remember to add its fields. */
  const blankPlayer = (row) => ({
    id: row.id, name: row.name, avatar: Number(row.avatar) || 0, team: row.team || 'red',
    score: 0, hp: 100, streak: 0, best: 0, answered: false, correct: null, down: false,
    lastDamage: 0, distance: 0, blocks: 0, coins: 0, chest: '', lastGain: 0, target: '',
    balloons: BALLOONS, hits: 0, cards: [], spares: 0
  });

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
    return false;
  }

  const pickBossName = () => BOSS_NAMES[Math.floor(Math.random() * BOSS_NAMES.length)];

  global.NovaRules = {
    MODES, MAPS, GOALS, SETUP, SCORERS, BOSS_NAMES,
    mapsFor, defaultMap, readGoal, goalReached, grade, blankPlayer, pickBossName,
    readSetup, secondsFor, pointsFor, streakBonus, arrange, modeFinished,
    TRACK_LENGTH, BOSS_HP_PER_QUESTION, FORT_BLOCKS, BALLOONS, MAX_PLAYER_HIT,
    ROPE_LENGTH, CARD_SET, SPARES_PER_SWAP
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaRules;
