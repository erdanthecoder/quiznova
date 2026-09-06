/* Levels, coins, and blooks you have to earn.
 *
 * Where this lives, and why
 *   Children playing Quoldek do not have accounts — they type a name and a PIN,
 *   and that is the whole point: nothing to sign up for, nothing to remember,
 *   nothing about a child stored on anybody's server. So progress is kept on the
 *   phone that earned it, in that browser's own storage, and the screens say so
 *   plainly rather than implying it follows them around.
 *
 * The shape of it
 *   Coins are earned by playing and spent on blook parts. A level comes from
 *   the coins earned over all time and is never spent, so it only ever goes up —
 *   it decides which parts are *available*, and coins decide which of those you
 *   actually own. That is two different questions ("have you played enough?" and
 *   "have you saved up?") and keeping them apart is what stops the good blooks
 *   arriving all at once in week one.
 *
 * Nothing here touches the network or the page: it is arithmetic and one small
 * lump of storage, so it can be tested on its own and behaves the same in the
 * website, the Windows app and the Flask edition.
 */
(function (global) {
  'use strict';

  const KEY = 'quoldek:progress';

  /* ── levels ───────────────────────────────────────────────
   * Twenty of them. The first few come quickly, because a child who plays one
   * game should see something happen; after that each level costs a little more
   * than the last, so level 20 is a term's worth of playing rather than a
   * wet afternoon. */
  const LEVELS = [0];
  for (let n = 1; n < 20; n++) {
    LEVELS.push(Math.round(LEVELS[n - 1] + 120 + (n - 1) * 95));
  }
  const MAX_LEVEL = LEVELS.length;

  /** What level a lifetime coin total is worth, and how far into it. */
  function levelFor(lifetime) {
    const total = Math.max(0, Math.round(Number(lifetime) || 0));
    let level = 1;
    while (level < MAX_LEVEL && total >= LEVELS[level]) level++;
    const floor = LEVELS[level - 1];
    const ceiling = level < MAX_LEVEL ? LEVELS[level] : floor;
    return {
      level,
      total,
      into: total - floor,
      need: level < MAX_LEVEL ? ceiling - floor : 0,
      toNext: level < MAX_LEVEL ? ceiling - total : 0,
      top: level >= MAX_LEVEL
    };
  }

  /* ── what a level opens, and what a part costs ────────────
   * Every part of a blook sits in one of five tiers. A tier needs a level
   * before it can be bought at all, and then costs coins. The plainest parts are
   * tier 0: free, and there from the first game, so nobody is ever looking at a
   * blook maker with nothing in it. */
  const TIER_LEVEL = [1, 3, 6, 10, 15];
  const TIER_COST = [0, 60, 140, 280, 550];
  const TIER_NAME = ['Starter', 'Bronze', 'Silver', 'Gold', 'Legendary'];

  /* Which tier a given part is in. Parts are spread across the tiers by their
   * position in the list, so a longer list of shapes stays spread evenly and
   * adding a new one later does not reshuffle what anybody already owns. */
  function tierOf(kind, index, counts) {
    // Colour is never locked. It is the most personal choice a child makes, and
    // it is also load-bearing: the game keeps two children in a room from looking
    // alike using colour and shape together, so a locked palette would both feel
    // mean and make the room harder to read.
    if (kind === 'colour') return 0;
    const n = Math.max(1, (counts && counts[kind]) || 1);
    const i = Math.max(0, Math.round(Number(index) || 0));
    if (i >= n) return TIER_LEVEL.length - 1;
    // The first third are free, but never fewer than two where there are two to
    // give: one option in a row is not a choice, it is a label.
    const free = n <= 2 ? n : Math.max(2, Math.round(n / 3));
    if (i < free) return 0;
    const span = Math.max(1, n - free);
    return Math.min(TIER_LEVEL.length - 1, 1 + Math.floor(((i - free) / span) * (TIER_LEVEL.length - 1)));
  }

  /** Everything a page needs to draw one option in the blook maker. */
  function partState(kind, index, counts, saved) {
    const state = saved || read();
    const tier = tierOf(kind, index, counts);
    const owned = tier === 0 || (state.owned[kind] || []).includes(index);
    const level = levelFor(state.lifetime).level;
    return {
      tier,
      tierName: TIER_NAME[tier],
      owned,
      cost: TIER_COST[tier],
      needsLevel: TIER_LEVEL[tier],
      levelReached: level >= TIER_LEVEL[tier],
      affordable: state.coins >= TIER_COST[tier],
      canBuy: !owned && level >= TIER_LEVEL[tier] && state.coins >= TIER_COST[tier]
    };
  }

  /* ── earning ──────────────────────────────────────────────
   * Coins come from playing rather than from winning, or the same three children
   * would own everything by half term and nobody else would bother. Answering at
   * all pays; answering correctly pays more; the placings at the end are a
   * flourish on top, not the substance.
   */
  const PER_ANSWER = 1;
  const PER_RIGHT = 4;
  const PER_STREAK = 5;          // for each answer in a run of three or more
  const PER_50_POINTS = 1;
  const PLACE_BONUS = [60, 40, 25];
  const PLAYED_BONUS = 12;       // for everyone else who finished

  /**
   * What a game was worth.
   *   answered  how many questions this child answered
   *   right     how many they got right
   *   bestRun   their longest run of right answers
   *   score     the score the game itself gave them
   *   place     1 for first, 2 for second… 0 if the game did not finish
   */
  function coinsFor(result) {
    const r = result || {};
    const answered = Math.max(0, Math.round(r.answered || 0));
    const right = Math.min(answered, Math.max(0, Math.round(r.right || 0)));
    const bestRun = Math.max(0, Math.round(r.bestRun || 0));
    const score = Math.max(0, Math.round(r.score || 0));
    const place = Math.max(0, Math.round(r.place || 0));

    const parts = {
      answering: answered * PER_ANSWER,
      correct: right * PER_RIGHT,
      streak: bestRun >= 3 ? bestRun * PER_STREAK : 0,
      score: Math.floor(score / 50) * PER_50_POINTS,
      place: place >= 1 && place <= 3 ? PLACE_BONUS[place - 1] : (place ? PLAYED_BONUS : 0)
    };
    parts.total = parts.answering + parts.correct + parts.streak + parts.score + parts.place;
    return parts;
  }

  /* ── the storage ──────────────────────────────────────────
   * One object, in this browser. Every read repairs whatever it finds, because a
   * child's phone is exactly where a half-written or hand-edited value turns up,
   * and a blook maker that throws is worse than one that starts again.
   */
  const BLANK = () => ({ coins: 0, lifetime: 0, games: 0, owned: {}, face: null, hat: 0, seenLevel: 1 });

  function read() {
    let raw = null;
    try { raw = JSON.parse(global.localStorage.getItem(KEY) || 'null'); }
    catch { raw = null; }
    const clean = BLANK();
    if (raw && typeof raw === 'object') {
      clean.coins = Math.max(0, Math.round(Number(raw.coins) || 0));
      clean.lifetime = Math.max(clean.coins, Math.round(Number(raw.lifetime) || 0));
      clean.games = Math.max(0, Math.round(Number(raw.games) || 0));
      clean.seenLevel = Math.max(1, Math.round(Number(raw.seenLevel) || 1));
      clean.face = Number.isFinite(Number(raw.face)) ? Number(raw.face) : null;
      clean.hat = Math.max(0, Math.round(Number(raw.hat) || 0));
      if (raw.owned && typeof raw.owned === 'object') {
        for (const [kind, list] of Object.entries(raw.owned)) {
          if (Array.isArray(list)) {
            clean.owned[kind] = [...new Set(list.map(Number).filter(Number.isFinite))];
          }
        }
      }
    }
    return clean;
  }

  function write(state) {
    try { global.localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { /* private mode, or a full disk: the game still plays */ }
    return state;
  }

  /** Bank what a game was worth. Returns the coins, and any level gained. */
  function award(result) {
    const before = read();
    const parts = coinsFor(result);
    const after = Object.assign({}, before, {
      coins: before.coins + parts.total,
      lifetime: before.lifetime + parts.total,
      games: before.games + 1
    });
    write(after);
    const was = levelFor(before.lifetime).level;
    const now = levelFor(after.lifetime).level;
    return { parts, coins: after.coins, levelUp: now > was ? now : 0, level: now, was };
  }

  /** Buy one part, if it is affordable and the level is there. */
  function buy(kind, index, counts) {
    const state = read();
    const info = partState(kind, index, counts, state);
    if (info.owned) return { ok: true, already: true, coins: state.coins };
    if (!info.levelReached) return { ok: false, why: `Level ${info.needsLevel} unlocks this` };
    if (!info.affordable) return { ok: false, why: `${info.cost - state.coins} more coins needed` };
    state.owned[kind] = [...(state.owned[kind] || []), Math.round(index)];
    state.coins -= info.cost;
    write(state);
    return { ok: true, coins: state.coins, spent: info.cost };
  }

  /** Remember the blook this phone plays as, so it comes back next game. */
  function remember(face) {
    const state = read();
    state.face = Number(face);
    return write(state).face;
  }

  /* A hat is worn, not bought again: buy() already put it in `owned`, and this
   * only says which of the owned ones is on. Nought is bare-headed and is
   * always allowed, so there is no way to end up with nothing to wear. */
  function wearHat(hat) {
    const state = read();
    const n = Math.max(0, Math.round(Number(hat) || 0));
    if (n !== 0 && !(state.owned.hat || []).includes(n) && tierOf('hat', n, { hat: HAT_COUNT }) !== 0) {
      return state.hat;
    }
    state.hat = n;
    return write(state).hat;
  }
  /* How many hats there are. Kept here rather than read off Sprite so the
     arithmetic can be tested without a drawing library in the room. */
  let HAT_COUNT = 13;
  const countHats = (n) => { HAT_COUNT = Math.max(1, Math.round(n) || 1); return HAT_COUNT; };

  /** The level the child has already been shown, so a level-up is announced once. */
  function markSeen(level) {
    const state = read();
    state.seenLevel = Math.max(state.seenLevel, Math.round(level) || 1);
    return write(state).seenLevel;
  }

  function reset() { return write(BLANK()); }

  global.NovaProgress = {
    KEY, LEVELS, MAX_LEVEL, TIER_LEVEL, TIER_COST, TIER_NAME,
    levelFor, tierOf, partState, coinsFor, award, buy,
    read, write, remember, wearHat, countHats, markSeen, reset
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaProgress;
