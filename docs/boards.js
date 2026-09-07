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

    /* Signing out only means anything where the session is. On a board there is
       none — it is a different address — so offering "Sign out" here would be a
       button that does nothing. It says what it can actually do. */
    const signedInHere = !!global.NovaAccount.user;
    const out = signedInHere
      ? el('button', { class: 'btn ghost sm', onclick: () => {
          global.NovaAccount.signOut().finally(() => location.replace('https://quoldek.web.app/?stay=1'));
        } }, 'Sign out')
      : el('a', { class: 'btn ghost sm', href: 'https://quoldek.web.app/?stay=1',
                  title: 'Your quizzes and your account live there' }, 'Quoldek');

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
  /* Whether this board may draw itself.
   *
   * A board is on its own address, and browser storage is per-origin — so the
   * session made by signing in on quoldek.web.app is not visible here, and
   * never will be. Asking "is there a session?" and bouncing when the answer is
   * no is how a signed-in teacher ended up being passed between the board and
   * the sign-in page for ever, seeing "Your board" and then "Sign in", over and
   * over. So this does not ask that question.
   *
   * What it asks is which board this person belongs on, which arrives in the
   * fragment on the way in and is then remembered here. Everything a board
   * shows — quizzes, coins, blooks, levels — is kept in this browser anyway,
   * so knowing the role is enough to draw the page. An account adds syncing on
   * top, and its absence is said out loud rather than being a locked door.
   */
  const ROLES = ['teacher', 'student'];

  function handed() {
    const m = /[#&]as=([a-z]+)/.exec(global.location.hash || '');
    const said = m ? decodeURIComponent(m[1]) : '';
    if (!ROLES.includes(said)) return '';
    try { global.localStorage.setItem('quoldek:role', said); } catch { /* storage is off */ }
    // tidy the address: nobody needs to see the plumbing, and a refresh should
    // not depend on it still being there
    try {
      global.history.replaceState(null, '', global.location.pathname + global.location.search);
    } catch { /* older browser: leaving it is harmless */ }
    return said;
  }

  function guard(role) {
    const said = handed();
    const hint = said || global.NovaAccount.roleHint;

    if (!hint && !global.NovaAccount.user) {
      /* Nobody has ever been here. Ask them to sign in — once. If the sign-in
         page sends them straight back without a role, going round again would
         be a loop, so the second time the board simply draws itself and lets
         them get on with it. */
      let bounced = false;
      try { bounced = global.sessionStorage.getItem('quoldek:asked') === '1'; } catch { }
      if (!bounced) {
        try { global.sessionStorage.setItem('quoldek:asked', '1'); } catch { }
        global.location.replace('https://quoldek.web.app/signin.html?next='
                                + encodeURIComponent(global.location.href));
        return false;
      }
    }

    /* If the account is reachable from here it gets the last word on which board
       this is — but it is never a reason to throw somebody off the page. */
    global.NovaAccount.onChange((user, profile) => {
      if (profile && profile.role && profile.role !== role) global.NovaAccount.sendToBoard(profile.role);
    });
    global.NovaAccount.loadProfile().catch(() => { /* no session on this address */ });
    return true;
  }

  global.NovaBoards = { topbar, levelTrack, figures, guard };
})(typeof window !== 'undefined' ? window : globalThis);
