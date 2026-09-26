/* OneInTwo — one account for Quoldek and LearnKyrgyz (oneintwo.web.app).
 *
 * Signing in happens at oneintwo.web.app, or in LearnKyrgyz. When someone comes here
 * from there, the session rides in the address fragment (#oit=…), which is never sent to
 * any server. It is kept in this browser and removed from the address bar at once.
 *
 * With it, a teacher's quizzes are saved to their OneInTwo account (the app_data table,
 * where row-level security lets each person read and write only their own row), so the
 * quizzes follow them to any computer, the same as their LearnKyrgyz progress.
 * Everything still works without it: quizzes always stay in this browser as well.
 */
(function (global) {
  'use strict';
  const HUB = 'https://oneintwo.web.app';
  const API = 'https://lzamxwqxnzcrazyuipjx.supabase.co';
  const KEY = 'sb_publishable_zSvDRXqxLlW1tuaoJ06PUw_Tges-7OG';   // public key; the data is protected by row-level security
  const STORE = 'oneintwo:session', KNOWN = 'oneintwo:known';
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  const listeners = new Set();
  let session = read(STORE, null);
  const tell = () => listeners.forEach(fn => { try { fn(user()); } catch { /* caller */ } });
  const user = () => session ? session.user : null;

  const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  function fromTokens(at, rt) {
    const p = JSON.parse(unb64(at.split('.')[1]));
    const meta = p.user_metadata || {};
    return { at, rt, exp: (p.exp || 0) * 1000,
             user: { id: p.sub, email: p.email || '', name: meta.full_name || meta.name || (p.email || 'Teacher').split('@')[0] } };
  }
  function save(s) { session = s; write(STORE, s); tell(); }

  // Arriving from oneintwo.web.app or LearnKyrgyz, already signed in.
  (function arrive() {
    const m = location.hash.match(/(?:^#|&)oit=([A-Za-z0-9_-]+)/);
    if (!m) return;
    const rest = location.hash.slice(1).split('&').filter(p => !p.startsWith('oit=')).join('&');
    history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''));
    try { const t = JSON.parse(unb64(m[1])); if (t.at && t.rt) save(fromTokens(t.at, t.rt)); } catch { /* a broken link signs nobody in */ }
  })();

  let refreshing = null;
  async function token() {
    if (!session) return null;
    if (Date.now() < session.exp - 60000) return session.at;
    refreshing = refreshing || (async () => {
      try {
        const res = await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.rt }) });
        if (res.status === 400 || res.status === 401) { save(null); return null; }   // signed out elsewhere
        if (!res.ok) return null;                                                       // offline: try later
        const j = await res.json();
        save(fromTokens(j.access_token, j.refresh_token));
        return session.at;
      } catch { return null; } finally { setTimeout(() => { refreshing = null; }, 0); }
    })();
    return refreshing;
  }
  async function rest(method, path, body, headers = {}) {
    const at = await token(); if (!at) throw new Error('Not signed in');
    const res = await fetch(`${API}/rest/v1/${path}`, { method, headers: Object.assign({ apikey: KEY, Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, headers), body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error((await res.text()).slice(0, 200) || res.statusText);
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  /* ── quizzes follow the account ──
   * Stored as { quizzes: {id: quiz}, deleted: {id: time} }. The newer copy of each quiz wins,
   * and a quiz deleted on one computer stays deleted on the others. */
  const Nova = global.Nova;
  const canSync = () => !!(Nova && Nova.allQuizzes && Nova.replaceQuizzes);
  let remoteDeleted = {};
  async function pull() {
    if (!user() || !canSync()) return;
    const rows = await rest('GET', 'app_data?app=eq.quoldek&key=eq.quizzes&select=data');
    const remote = (rows && rows[0] && rows[0].data) || {};
    const theirs = remote.quizzes || {}, gone = Object.assign({}, remote.deleted || {});
    const mine = Nova.allQuizzes(), known = new Set(read(KNOWN, []));
    const merged = {};
    for (const id of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const a = mine[id], b = theirs[id];
      if (!a && known.has(id)) { gone[id] = Date.now(); continue; }              // deleted here since the last sync
      const newest = !a ? b : !b ? a : ((a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b);
      if (gone[id] && (newest.updatedAt || 0) <= gone[id]) continue;             // deleted elsewhere
      merged[id] = newest;
    }
    remoteDeleted = gone;
    Nova.replaceQuizzes(merged);
    await push(true);
    if (typeof global.load === 'function' && document.getElementById('grid')) global.load();   // redraw the quiz list
  }
  let pushTimer = null;
  async function push(now) {
    if (!user() || !canSync()) return;
    if (!now) { clearTimeout(pushTimer); pushTimer = setTimeout(() => push(true), 1500); return; }
    const mine = Nova.allQuizzes(), known = read(KNOWN, []);
    for (const id of known) if (!mine[id]) remoteDeleted[id] = remoteDeleted[id] || Date.now();
    const cutoff = Date.now() - 60 * 86400000;
    for (const [id, t] of Object.entries(remoteDeleted)) if (t < cutoff) delete remoteDeleted[id];
    try {
      await rest('POST', 'app_data?on_conflict=user_id,app,key', { user_id: user().id, app: 'quoldek', key: 'quizzes', data: { quizzes: mine, deleted: remoteDeleted } },
        { Prefer: 'resolution=merge-duplicates,return=minimal' });
      write(KNOWN, Object.keys(mine));
    } catch (err) { if (!push.warned) { push.warned = true; Nova && Nova.toast && Nova.toast('Could not save quizzes to your OneInTwo account: ' + err.message, 'bad'); } }
  }

  // Every save in Quoldek already calls NovaAccount.pushSoon(); save to OneInTwo at the same moment.
  function hook() {
    const acct = global.NovaAccount;
    if (acct && !acct.__oit) {
      const orig = acct.pushSoon ? acct.pushSoon.bind(acct) : () => {};
      acct.pushSoon = (...a) => { try { orig(...a); } finally { push(); } };
      acct.__oit = true;
    } else if (!acct) global.NovaAccount = { pushSoon: () => push(), onChange: () => {}, user: null, __oit: true };
  }

  function signIn() { location.href = `${HUB}/?return=${encodeURIComponent(location.href.split('#')[0])}`; }
  function signOut() { save(null); write(KNOWN, null); }

  /* ── the button in the top bar ── */
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const RINGS = '<span class="oit-r" aria-hidden="true"><i></i><i></i></span>';
  function mount() {
    // the teacher's pages only: students joining a game or doing homework never see it
    if (/^(play|live|hw)quoldek\./.test(location.hostname) || /\/(play|take|join)(\.html)?$/.test(location.pathname)) return;
    const top = document.querySelector('.topbar-inner');
    if (!top || document.getElementById('oit-btn')) return;
    const style = document.createElement('style');
    style.textContent = `.oit-r{position:relative;display:inline-block;width:24px;height:15px;vertical-align:-2px}.oit-r i{position:absolute;top:0;width:15px;height:15px;border-radius:50%;border:3px solid #7c5cff}.oit-r i+i{left:9px;border-color:#58cc02}
      #oit-btn{gap:6px}#oit-btn.on{background:linear-gradient(135deg,#efe8ff,#e3ffd1)}`;
    document.head.append(style);
    const b = document.createElement('button');
    b.id = 'oit-btn'; b.className = 'btn sm';
    const acctBtn = () => document.getElementById('acct');
    top.insertBefore(b, acctBtn() || document.getElementById('top-new') || null);
    const paint = (u) => {
      b.classList.toggle('on', !!u);
      b.innerHTML = RINGS + (u ? ` <span class="hide-sm">${esc(u.name.split(' ')[0])}</span>` : ' <span>One account</span>');
      b.title = u ? `Signed in with OneInTwo as ${u.email}. Your quizzes are saved to this account.` : 'Sign in once with your OneInTwo / LearnKyrgyz account';
      const a = acctBtn(); if (a) a.style.display = u ? 'none' : '';          // one account at a time in the bar
    };
    listeners.add(paint); paint(user());
    new MutationObserver(() => paint(user())).observe(top, { childList: true });
    b.onclick = () => {
      const u = user();
      if (!u) return signIn();
      Nova.modal(`
        <h2 style="margin-bottom:6px">${RINGS} One account</h2>
        <p class="muted tiny" style="margin-bottom:18px">Signed in with OneInTwo as <b>${esc(u.email)}</b>.<br><br>
          It's the same account as LearnKyrgyz. Your quizzes are saved to it, so they're here on any computer, and they stay in this browser too.</p>
        <div class="row" style="justify-content:flex-end;gap:10px;flex-wrap:wrap">
          <a class="btn ghost" href="${HUB}/" target="_blank" rel="noopener">Open dashboard</a>
          <button class="btn danger" id="oit-out">Sign out</button>
        </div>`, { onMount(box, close) { box.querySelector('#oit-out').onclick = () => { signOut(); close(); Nova.toast('Signed out. Your quizzes are still in this browser.'); }; } });
    };
  }

  global.OneInTwo = { user, token, signIn, signOut, pull, push, onChange: (fn) => { listeners.add(fn); fn(user()); return () => listeners.delete(fn); } };
  const start = () => { hook(); mount(); if (user()) pull().catch(() => { /* offline: the local copy is still here */ }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
