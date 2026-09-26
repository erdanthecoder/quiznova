/* Signing in inside the app, so the quizzes follow you.
 *
 * The app is not a browser pointed at the website and this does not make it
 * one. What signing in adds is one thing: the quizzes written here are the
 * quizzes on quoldek.web.app and on the next computer you open the app on.
 * Everything else about the app is unchanged — its own home screen, its own
 * board on the projector, its own folder of quizzes on this disk.
 *
 * The merge itself is done by the app's own server, because that is where the
 * folder is. This file only carries quizzes between that server and the
 * account, and puts a row on the home screen saying which state you are in.
 */
(function (global) {
  'use strict';

  const A = global.NovaAccount;
  if (!A) return;

  const local = (path, options) => fetch('/api' + path, Object.assign({
    headers: { 'Content-Type': 'application/json' }
  }, options)).then(r => r.json());

  /* One round trip.
   *
   * Down first, then up: pulling before pushing means a quiz written on another
   * computer is in the folder before this one describes what the folder holds,
   * so nothing is announced as deleted that simply had not arrived yet.
   */
  let running = null;
  function sync() {
    if (running) return running;
    running = (async () => {
      const { quizzes: theirs } = await A.quizzes();
      const { quizzes: merged, pulled } = await local('/sync', {
        method: 'POST', body: JSON.stringify({ quizzes: theirs || [] })
      });
      if (merged && merged.length) await A.pushQuizzes(merged);
      return { pulled: pulled || 0, pushed: (merged || []).length };
    })().finally(() => { running = null; });
    return running;
  }

  /* ── the row on the home screen ────────────────────────
   * One line that says what is true, and one button that does the thing that
   * line implies. Nothing here is a second front door: the app works exactly as
   * it always did while signed out. */
  function mount() {
    const rail = document.querySelector('.rail');
    if (!rail || document.getElementById('acct-row')) return;

    const row = document.createElement('div');
    row.id = 'acct-row';
    row.style.cssText = 'margin-top:auto;padding:12px;border-radius:12px;font-size:.82rem;line-height:1.45;'
      + 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)';
    rail.append(row);

    const say = (html) => { row.innerHTML = html; };

    /* Redraw only when the state has actually changed.
     *
     * This row is rebuilt from a string, so every redraw throws away whatever
     * was typed into it and whatever it was saying. The sign-in library and the
     * network both announce themselves more than once, and each announcement
     * was wiping a half-typed password and the message explaining what went
     * wrong. It changes when there is something different to say, and not
     * otherwise. */
    let showing = null;
    const draw = (user) => {
      const now = !global.navigator.onLine ? 'offline' : user ? 'in:' + (user.uid || '') : 'out';
      if (now === showing) return;
      showing = now;
      if (!global.navigator.onLine) {
        say('<b>No connection</b><br><span style="opacity:.7">Write questions as usual. '
          + 'Games and signing in need the internet.</span>');
        return;
      }
      if (!user) {
        /* An email and a password, typed here.
         *
         * Not a Google button: that needs a popup, and a popup inside a desktop
         * app is a window the app has to own, catch and hand back — a lot of
         * moving parts for a sign-in that has to work first time in front of a
         * class. Somebody who made their account with Google can set a password
         * on the website; the line below says where to go. */
        const box = 'width:100%;margin-top:7px;padding:7px 9px;border-radius:8px;font:inherit;'
          + 'border:2px solid rgba(255,255,255,.2);background:rgba(0,0,0,.25);color:inherit';
        say('<b>Your quizzes stay on this computer</b><br>'
          + '<span style="opacity:.7">Sign in and they follow you to the website and any other computer.</span>'
          + `<input id="acct-mail" type="email" placeholder="you@school.org" autocomplete="email" style="${box}">`
          + `<input id="acct-pass" type="password" placeholder="Password" autocomplete="current-password" style="${box}">`
          + '<button id="acct-in" style="margin-top:9px;font:inherit;font-weight:800;padding:7px 13px;'
          + 'border-radius:9px;border:2px solid rgba(255,255,255,.25);background:#6C4CF1;color:#fff;'
          + 'cursor:pointer">Sign in</button>'
          + '<div id="acct-say" style="margin-top:8px;opacity:.75"></div>'
          + '<div style="margin-top:6px;opacity:.55;font-size:.95em">No account yet? Make one at quoldek.web.app</div>');
        const btn = document.getElementById('acct-in');
        const go = () => signIn();
        if (btn) btn.onclick = go;
        const pass = document.getElementById('acct-pass');
        if (pass) pass.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        return;
      }
      say(`<b>${esc(user.name || user.email)}</b><br>`
        + '<span id="acct-state" style="opacity:.7">Your quizzes follow you.</span>'
        + '<br><button id="acct-out" style="margin-top:9px;font:inherit;font-weight:700;padding:6px 12px;'
        + 'border-radius:9px;border:2px solid rgba(255,255,255,.25);background:transparent;color:inherit;'
        + 'cursor:pointer">Sign out</button>');
      const out = document.getElementById('acct-out');
      if (out) out.onclick = () => A.signOut();
      runSync();
    };

    const state = (text) => {
      const line = document.getElementById('acct-state');
      if (line) line.textContent = text;
    };

    async function runSync() {
      state('Bringing your quizzes together…');
      try {
        const { pulled } = await sync();
        state(pulled ? `${pulled} quiz${pulled === 1 ? '' : 'zes'} came down from your account.`
                     : 'Your quizzes follow you.');
        if (pulled && global.location.pathname.startsWith('/app/')) {
          // the home screen lists them, so show what just arrived
          const list = document.querySelector('[data-go="quizzes"]');
          if (list) list.click();
        }
      } catch (err) {
        state('Could not reach your account just now. Nothing is lost.');
      }
    }

    async function signIn() {
      const mail = document.getElementById('acct-mail');
      const pass = document.getElementById('acct-pass');
      const line = document.getElementById('acct-say');
      const tell = (t) => { if (line) line.textContent = t; };
      if (!mail || !pass) return;
      if (!mail.value.trim() || !pass.value) return tell('Fill both boxes in.');
      tell('Signing in…');
      try {
        await A.signInWithPassword(mail.value, pass.value);
      } catch (err) {
        tell(err && err.message ? err.message : 'Could not sign in. Try again.');
      }
    }

    A.onChange(draw);
    global.addEventListener('online', () => draw(A.user));
    global.addEventListener('offline', () => draw(A.user));
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  global.NovaDesktopAccount = { sync };
})(typeof window !== 'undefined' ? window : globalThis);
