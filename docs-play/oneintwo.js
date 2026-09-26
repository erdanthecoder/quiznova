/* The4Workspace — one account for LearnKyrgyz, Quoldek, Kadam and AkylduuKodo
 * (the4workspace.web.app; it used to be called OneInTwo, then OneInFour).
 *
 * Signing in happens at the4workspace.web.app, or in LearnKyrgyz. When someone comes here
 * from there, the session rides in the address fragment (#oit=…), which is never sent to
 * any server. It is kept in this browser and removed from the address bar at once.
 *
 * With it, a teacher's quizzes are saved to their The4Workspace account (the app_data table,
 * where row-level security lets each person read and write only their own row), so the
 * quizzes follow them to any computer, the same as their LearnKyrgyz progress.
 * Everything still works without it: quizzes always stay in this browser as well.
 */
(function (global) {
  'use strict';
  const HUB = 'https://the4workspace.web.app';
  const WS_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJvaWZCZyIgeDE9IjAiIHkxPSIwIiB4Mj0iMSIgeTI9IjEiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzI0MTU1MiIvPjxzdG9wIG9mZnNldD0iLjU1IiBzdG9wLWNvbG9yPSIjMTEwYzJhIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDcwNzExIi8+PC9saW5lYXJHcmFkaWVudD48cmFkaWFsR3JhZGllbnQgaWQ9Im9pZkNvcmUiIGN4PSIuNSIgY3k9Ii41IiByPSIuNSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZmIi8+PHN0b3Agb2Zmc2V0PSIuNDUiIHN0b3AtY29sb3I9IiNlOWU0ZmYiIHN0b3Atb3BhY2l0eT0iLjkiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNhNzhiZmEiIHN0b3Atb3BhY2l0eT0iMCIvPjwvcmFkaWFsR3JhZGllbnQ+PGxpbmVhckdyYWRpZW50IGlkPSJvaWZTaGVlbiIgeDE9IjAiIHkxPSIwIiB4Mj0iMCIgeTI9IjEiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2ZmZiIgc3RvcC1vcGFjaXR5PSIuMTYiLz48c3RvcCBvZmZzZXQ9Ii41IiBzdG9wLWNvbG9yPSIjZmZmIiBzdG9wLW9wYWNpdHk9IjAiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNiIgZmlsbD0idXJsKCNvaWZCZykiLz48ZyBmaWxsPSJub25lIiBzdHJva2Utd2lkdGg9IjQuMiIgc3Ryb2tlLWxpbmVjYXA9ImJ1dHQiPjxjaXJjbGUgY3g9IjIzLjUiIGN5PSIyMy41IiByPSIxMCIgc3Ryb2tlPSIjNThjYzAyIi8+PGNpcmNsZSBjeD0iNDAuNSIgY3k9IjIzLjUiIHI9IjEwIiBzdHJva2U9IiM3YzVjZmYiLz48Y2lyY2xlIGN4PSIyMy41IiBjeT0iNDAuNSIgcj0iMTAiIHN0cm9rZT0iIzE0YjhhNiIvPjxjaXJjbGUgY3g9IjQwLjUiIGN5PSI0MC41IiByPSIxMCIgc3Ryb2tlPSIjMWNiMGY2Ii8+PHBhdGggZD0iTTMyIDE4LjIzIEExMCAxMCAwIDAgMSAzMiAyOC43NyIgc3Ryb2tlPSIjNThjYzAyIi8+PHBhdGggZD0iTTQ1Ljc3IDMyIEExMCAxMCAwIDAgMSAzNS4yMyAzMiIgc3Ryb2tlPSIjN2M1Y2ZmIi8+PHBhdGggZD0iTTMyIDQ1Ljc3IEExMCAxMCAwIDAgMSAzMiAzNS4yMyIgc3Ryb2tlPSIjMWNiMGY2Ii8+PHBhdGggZD0iTTE4LjIzIDMyIEExMCAxMCAwIDAgMSAyOC43NyAzMiIgc3Ryb2tlPSIjMTRiOGE2Ii8+PC9nPjxjaXJjbGUgY3g9IjMyIiBjeT0iMzIiIHI9IjUuNSIgZmlsbD0idXJsKCNvaWZDb3JlKSIvPjxjaXJjbGUgY3g9IjMyIiBjeT0iMzIiIHI9IjIuMiIgZmlsbD0iI2ZmZiIvPjxyZWN0IHdpZHRoPSI2NCIgaGVpZ2h0PSIzMiIgcng9IjE2IiBmaWxsPSJ1cmwoI29pZlNoZWVuKSIvPjwvc3ZnPg==';
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

  // Arriving from the4workspace.web.app or LearnKyrgyz, already signed in.
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
    } catch (err) { if (!push.warned) { push.warned = true; Nova && Nova.toast && Nova.toast('Could not save quizzes to your The4Workspace account: ' + err.message, 'bad'); } }
  }

  // Every save in Quoldek already calls NovaAccount.pushSoon(); save to The4Workspace at the same moment.
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
  const RINGS = `<img class="oit-r" src="${WS_ICON}" alt="" width="18" height="18">`;
  function mount() {
    // the teacher's pages only: students joining a game or doing homework never see it
    if (/^(play|live|hw)quoldek\./.test(location.hostname) || /\/(play|take|join)(\.html)?$/.test(location.pathname)) return;
    const top = document.querySelector('.topbar-inner');
    if (!top || document.getElementById('oit-btn')) return;
    const style = document.createElement('style');
    style.textContent = `.oit-r{display:inline-block;width:18px;height:18px;border-radius:5px;vertical-align:-4px}#ws-btn{gap:6px;text-decoration:none}#ws-btn:hover .oit-r{transform:rotate(-10deg) scale(1.1)}.oit-r{transition:transform .4s cubic-bezier(.2,1.4,.3,1)}
      #oit-btn{gap:6px}#oit-btn.on{background:linear-gradient(135deg,#efe8ff,#e3ffd1)}`;
    document.head.append(style);
    const b = document.createElement('button');
    b.id = 'oit-btn'; b.className = 'btn sm';
    const acctBtn = () => document.getElementById('acct');
    top.insertBefore(b, acctBtn() || document.getElementById('top-new') || null);
    // The4Workspace: straight to the one-account hub for all four apps.
    const ws = document.createElement('a');
    ws.id = 'ws-btn'; ws.className = 'btn sm ghost'; ws.href = HUB + '/';
    ws.title = 'The4Workspace: LearnKyrgyz, Quoldek, Kadam and AkylduuKodo with one account';
    ws.innerHTML = RINGS + ' <span class="hide-sm">The4Workspace</span>';
    top.insertBefore(ws, b);
    const paint = (u) => {
      b.classList.toggle('on', !!u);
      b.innerHTML = RINGS + (u ? ` <span class="hide-sm">${esc(u.name.split(' ')[0])}</span>` : ' <span>One account</span>');
      b.title = u ? `Signed in with The4Workspace as ${u.email}. Your quizzes are saved to this account.` : 'Sign in once with your The4Workspace / LearnKyrgyz account';
      const a = acctBtn(); if (a) a.style.display = u ? 'none' : '';          // one account at a time in the bar
    };
    listeners.add(paint); paint(user());
    new MutationObserver(() => paint(user())).observe(top, { childList: true });
    b.onclick = () => {
      const u = user();
      if (!u) return signIn();
      Nova.modal(`
        <h2 style="margin-bottom:6px">${RINGS} One account</h2>
        <p class="muted tiny" style="margin-bottom:18px">Signed in with The4Workspace as <b>${esc(u.email)}</b>.<br><br>
          It's the same account as LearnKyrgyz. Your quizzes are saved to it, so they're here on any computer, and they stay in this browser too.</p>
        <div class="row" style="justify-content:flex-end;gap:10px;flex-wrap:wrap">
          <a class="btn ghost" href="${HUB}/" target="_blank" rel="noopener">Open The4Workspace</a>
          <button class="btn danger" id="oit-out">Sign out</button>
        </div>`, { onMount(box, close) { box.querySelector('#oit-out').onclick = () => { signOut(); close(); Nova.toast('Signed out. Your quizzes are still in this browser.'); }; } });
    };
  }

  global.OneInTwo = { hub: HUB, icon: WS_ICON, user, token, signIn, signOut, pull, push, onChange: (fn) => { listeners.add(fn); fn(user()); return () => listeners.delete(fn); } };
  const start = () => { hook(); mount(); if (user()) pull().catch(() => { /* offline: the local copy is still here */ }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
