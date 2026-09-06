/* The furniture both dashboards share.
 *
 * A teacher's board and a student's board are different places doing different
 * jobs, but the top of the page — who you are, what level you are, how many
 * coins you have, the way out — is the same question answered twice. It lives
 * here so the two cannot drift apart, and so a change to how a level is drawn
 * is one change rather than two.
 *
 * Nothing here decides anything. The role has already been settled by the time
 * a board paints; these functions only draw.
 */
(function (global) {
  'use strict';

  const { el, esc } = global.Nova;
  const P = global.NovaProgress;

  /** The bar across the top: who, what level, how many coins, and the way out. */
  function topbar(opts) {
    const o = opts || {};
    const state = P.read();
    const lv = P.levelFor(state.lifetime);

    const who = el('div', { class: 'me' },
      el('span', { class: 'me-face', html: o.face || global.Sprite.logo(38) }),
      el('span', {},
        el('b', {}, o.name || 'You'),
        el('span', { class: 'me-role' }, o.role === 'student' ? 'Student' : 'Teacher')));

    const level = el('div', { class: 'lvl', title: lv.top ? 'Top level' : `${lv.toNext} coins to level ${lv.level + 1}` },
      el('span', { class: 'lvl-n' }, 'Lv ' + lv.level),
      el('span', { class: 'lvl-bar' },
        el('i', { style: `width:${lv.need ? Math.round(lv.into / lv.need * 100) : 100}%` })));

    const purse = el('div', { class: 'purse' },
      el('span', { style: 'line-height:0', html: global.Sprite.icon('coin', 17, '#FFC53D') }),
      el('b', {}, String(state.coins)));

    const out = el('button', { class: 'btn ghost sm', onclick: () => {
      global.NovaAccount.signOut().finally(() => location.replace('https://quoldek.web.app/?stay=1'));
    } }, 'Sign out');

    return el('header', { class: 'bar' },
      el('a', { class: 'brand', href: 'https://quoldek.web.app/?stay=1' },
        el('span', { style: 'line-height:0', html: global.Sprite.logo(34) }), el('b', {}, 'Quoldek')),
      el('div', { class: 'grow' }),
      purse, level, who, out);
  }

  /* A level track with the next few rungs on it, so what is coming is visible
     rather than a number that goes up for no stated reason. */
  function levelTrack(count) {
    const state = P.read();
    const lv = P.levelFor(state.lifetime);
    const from = Math.max(1, lv.level - 1);
    const track = el('div', { class: 'track' });
    for (let n = from; n < from + (count || 6) && n <= P.MAX_LEVEL; n++) {
      const tier = P.TIER_LEVEL.indexOf(n);
      track.append(el('div', { class: 'rung' + (n < lv.level ? ' done' : n === lv.level ? ' now' : '') },
        el('b', {}, String(n)),
        el('span', {}, tier >= 0 ? P.TIER_NAME[tier] + ' unlocked' : n === lv.level ? 'You are here' : '')));
    }
    return track;
  }

  /** A row of numbers that says how much the room has done. */
  function figures(items) {
    return el('div', { class: 'figures' },
      ...items.filter(Boolean).map(([n, label]) =>
        el('div', { class: 'fig' }, el('b', {}, String(n)), el('span', {}, label))));
  }

  /* Every board wants the same "you are not signed in" answer, and none of them
   * should invent their own. Returns true when the page may carry on. */
  function guard(role) {
    const back = encodeURIComponent(location.href);
    const gate = 'https://quoldek.web.app/signin.html?next=' + back;
    const known = global.NovaAccount.user;
    const hint = global.NovaAccount.roleHint;
    if (!known && !hint) { location.replace(gate); return false; }

    global.NovaAccount.onChange((user, profile) => {
      if (!user && !global.NovaAccount.roleHint) return location.replace(gate);
      if (profile && profile.role && profile.role !== role) global.NovaAccount.sendToBoard(profile.role);
    });
    global.NovaAccount.loadProfile().catch(() => { /* offline: the hint carries the page */ });
    return true;
  }

  global.NovaBoards = { topbar, levelTrack, figures, guard };
})(typeof window !== 'undefined' ? window : globalThis);
