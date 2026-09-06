/* Signing in, and what signing in gets you.
 *
 * Signing in is still optional and still changes nothing about how the site
 * works without it: quizzes live in this browser, and somebody who never signs
 * in loses nothing. What an account adds is a copy kept for them — the quiz
 * written on the classroom laptop is there on the laptop at home — and, since
 * 4.0, a role and the progress that goes with it.
 *
 * The role — teacher or student — is the load-bearing part. It decides which
 * board somebody lands on and what they can do there, so it is never read from
 * a query string, a cookie or local storage. It comes from one table, keyed by
 * a user id that came out of a verified token, and it is chosen once.
 *
 * Nothing here is trusted. The browser gets an ID token from Firebase and hands
 * it to an edge function, which checks the signature against Google's published
 * keys before it reads or writes a single row. The token cannot be forged and
 * this file cannot reach the table without one.
 *
 * There are three ways in — Google, an email and password, or a new account —
 * because a school laptop signed into somebody else's Google account is common
 * enough that Google-only would lock a teacher out of their own quizzes.
 */
(function (global) {
  'use strict';

  const CONFIG = {
    apiKey: 'AIzaSyByiYxPJdRy1lppKk93Gu9O2qSnk67yVNo',
    authDomain: 'quiznova-88751.firebaseapp.com',
    projectId: 'quiznova-88751',
    appId: '1:1042467906309:web:ecb2c2b5043db6c71e8d6c'
  };
  const SYNC = 'https://blkwilonabowayxefxpx.supabase.co/functions/v1/quizzes';
  const WHO = 'https://blkwilonabowayxefxpx.supabase.co/functions/v1/profile';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.5/';

  let auth = null, loading = null, user = null, profile = null;
  const listeners = new Set();

  /* The last known role, kept in this browser purely so a returning teacher is
   * not shown the wrong page for the half second it takes to ask. It is a hint
   * for painting, never an authority: every real decision waits for the row. */
  const HINT = 'quoldek:role';
  const roleHint = () => { try { return localStorage.getItem(HINT) || ''; } catch { return ''; } };
  const keepHint = (r) => { try { r ? localStorage.setItem(HINT, r) : localStorage.removeItem(HINT); } catch { } };
  const tell = () => listeners.forEach(fn => { try { fn(user); } catch { /* caller's problem */ } });

  /* The sign-in library is a few hundred kilobytes and most visits never need
   * it, so it is fetched the first time somebody actually signs in — or on load
   * if this browser has signed in before. */
  async function firebase() {
    if (loading) return loading;
    loading = (async () => {
      const [{ initializeApp }, authMod] = await Promise.all([
        import(SDK + 'firebase-app.js'),
        import(SDK + 'firebase-auth.js')
      ]);
      const app = initializeApp(CONFIG);
      auth = authMod.getAuth(app);
      await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
      authMod.onAuthStateChanged(auth, (u) => {
        user = u ? { uid: u.uid, name: u.displayName || u.email || 'Teacher',
                     email: u.email || '', photo: u.photoURL || '' } : null;
        try { localStorage.setItem('nova:signedIn', user ? '1' : ''); } catch { /* private mode */ }
        if (!user) { profile = null; keepHint(''); }
        tell();
        if (user) {
          loadProfile().catch(() => { /* offline: the hint carries the page */ });
          sync().catch(() => { /* offline: the local copy is still there */ });
        }
      });
      return authMod;
    })();
    return loading;
  }

  async function token() {
    if (!auth || !auth.currentUser) return '';
    try { return await auth.currentUser.getIdToken(); } catch { return ''; }
  }

  async function call(method, body, query) {
    const t = await token();
    if (!t) throw new Error('Not signed in.');
    const res = await fetch(SYNC + (query || ''), {
      method,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not reach your quizzes.');
    return res.json();
  }

  /* Bring the two copies together. Neither side is the master: the same quiz
   * edited in two places keeps whichever was edited last, which is the only
   * answer that never silently throws away a teacher's work. */
  let syncing = null;
  function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      const local = global.Nova && Nova.allQuizzes ? Nova.allQuizzes() : {};
      const { quizzes } = await call('GET');
      const merged = Object.assign({}, local);
      let pulled = 0;
      for (const q of quizzes || []) {
        if (!q || !q.id) continue;
        const here = merged[q.id];
        if (!here || (q.updatedAt || 0) > (here.updatedAt || 0)) { merged[q.id] = q; pulled++; }
      }
      if (pulled && Nova.replaceQuizzes) Nova.replaceQuizzes(merged);
      const list = Object.values(merged);
      if (list.length) await call('POST', { quizzes: list });
      return { pulled, pushed: list.length };
    })().finally(() => { syncing = null; });
    return syncing;
  }

  /* A save while signed in is copied up, but never in the way: the quiz is
   * already safe in this browser by the time this runs, so a failure here is
   * not worth interrupting a teacher for. */
  let soon = null;
  function pushSoon() {
    if (!user || soon) return;
    soon = setTimeout(() => {
      soon = null;
      const all = global.Nova && Nova.allQuizzes ? Object.values(Nova.allQuizzes()) : [];
      if (all.length) call('POST', { quizzes: all }).catch(() => { /* try again next save */ });
    }, 1500);
  }

  async function signIn() {
    const mod = await firebase();
    const provider = new mod.GoogleAuthProvider();
    try {
      await mod.signInWithPopup(auth, provider);
    } catch (err) {
      // a blocked popup is the usual case on a school-managed browser
      if (String(err && err.code).includes('popup')) return mod.signInWithRedirect(auth, provider);
      throw err;
    }
  }

  /* ── the other two ways in ────────────────────────────────
   * Firebase's own error codes are written for developers. A teacher standing
   * in front of a class needs to know what to do next, so each one is turned
   * into a sentence that says it. */
  const SAYS = {
    'auth/invalid-email': 'That does not look like an email address.',
    'auth/user-not-found': 'No account with that email. Try signing up.',
    'auth/wrong-password': 'That password is not right.',
    'auth/invalid-credential': 'That email and password do not go together.',
    'auth/email-already-in-use': 'There is already an account with that email. Sign in instead.',
    'auth/weak-password': 'A password needs at least six characters.',
    'auth/too-many-requests': 'Too many tries. Wait a minute and go again.',
    'auth/network-request-failed': 'No connection. Check the wifi and try again.',
    'auth/popup-closed-by-user': 'The Google window closed before you finished.',
    'auth/operation-not-allowed': 'That way of signing in is switched off for this site.'
  };
  const plain = (err) => new Error(SAYS[String(err && err.code)] || 'Could not sign you in. Try again.');

  async function signInWithPassword(email, password) {
    const mod = await firebase();
    try { await mod.signInWithEmailAndPassword(auth, String(email || '').trim(), String(password || '')); }
    catch (err) { throw plain(err); }
    return user;
  }

  /* Making an account and choosing a role are one step, not two. Somebody who
   * signs up and then closes the tab before picking would come back to an
   * account that belongs nowhere, and the row would have to guess. */
  async function signUp(email, password, name, role) {
    const mod = await firebase();
    try {
      await mod.createUserWithEmailAndPassword(auth, String(email || '').trim(), String(password || ''));
      if (name) await mod.updateProfile(auth.currentUser, { displayName: String(name).slice(0, 60) })
        .catch(() => { /* a missing display name is not worth failing a sign-up over */ });
    } catch (err) { throw plain(err); }
    if (role) await setRole(role, name);
    return user;
  }

  async function resetPassword(email) {
    const mod = await firebase();
    try { await mod.sendPasswordResetEmail(auth, String(email || '').trim()); }
    catch (err) { throw plain(err); }
  }

  /* ── the profile ──────────────────────────────────────────
   * One row, fetched once per page. A person with no row yet has not chosen a
   * role, which is exactly what the sign-in page needs to know to ask. */
  async function profileCall(method, body) {
    const t = await token();
    if (!t) throw new Error('Not signed in.');
    const res = await fetch(WHO, {
      method,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Could not reach your account.');
    return out;
  }

  let asking = null;
  function loadProfile(force) {
    if (profile && !force) return Promise.resolve(profile);
    if (asking) return asking;
    asking = profileCall('GET').then((out) => {
      profile = out.profile || null;
      keepHint(profile ? profile.role : '');
      tell();
      return profile;
    }).finally(() => { asking = null; });
    return asking;
  }

  async function setRole(role, name) {
    const out = await profileCall('POST', { role, name: name || (user && user.name) || '' });
    profile = out.profile || null;
    keepHint(profile ? profile.role : '');
    tell();
    return profile;
  }

  /* Progress is banked locally the moment it is earned and copied up after, so
   * a lost connection costs a child nothing they can see. */
  let later = null;
  function saveProgress(progress) {
    if (!user || later) return;
    later = setTimeout(() => {
      later = null;
      profileCall('POST', { progress }).catch(() => { /* next game will carry it */ });
    }, 1200);
  }

  /* ── which board somebody belongs on ──────────────────────
   * Named here rather than in each page, because a wrong address is a person
   * bounced back and forth between two sites. */
  const SITES = {
    teacher: 'https://teachboard-quoldek.web.app/',
    student: 'https://studentboard-quoldek.web.app/'
  };
  const boardFor = (role) => SITES[role] || '';

  /* Send somebody to their own board — but never off a board they are already
   * on, or a slow profile fetch would bounce the page while they were reading
   * it. Returns true if it is leaving. */
  function sendToBoard(role) {
    const where = boardFor(role || (profile && profile.role) || roleHint());
    if (!where) return false;
    try { if (location.href.indexOf(where) === 0) return false; } catch { }
    location.replace(where);
    return true;
  }

  async function signOut() {
    const mod = await firebase();
    await mod.signOut(auth);
    profile = null;
    keepHint('');
  }

  // somebody who has signed in before should still be signed in when they return
  try { if (localStorage.getItem('nova:signedIn')) firebase(); } catch { /* private mode */ }

  /* Ask the sign-in library who is here, whatever this browser remembers.
   *
   * The flag above is only a hint, and it can be missing while the session is
   * perfectly real — storage cleared, a different profile on the same machine,
   * a browser that dropped it. A page whose whole job is to know whether
   * somebody is signed in must not take that hint's word for it. */
  const wake = () => firebase();

  /* ── the door ─────────────────────────────────────────────
   * Quoldek's own site needs an account. The pages a class is sent to — the
   * join page, a board with a PIN, a homework link — never do and never will:
   * a child who has to make an account before they can answer a question is a
   * child who does not answer the question.
   *
   * The one rule that matters here is what happens when the sign-in library
   * cannot be reached at all. A school that blocks gstatic would otherwise get
   * a locked door with no handle, so after a short wait the page is let through
   * rather than trapped. A site nobody can use is worse than a site somebody
   * signed out can look at.
   */
  function requireAccount(opts) {
    const o = opts || {};
    const wait = o.wait || 5000;
    if (!global.document || !global.location) return;
    const gate = (o.gate || 'https://quoldek.web.app/signin.html')
      + '?next=' + encodeURIComponent(location.href);

    if (user || roleHint()) { firebase(); return; }

    let settled = false;
    const done = () => { settled = true; off(); };
    const off = onChange((who) => {
      if (settled) return;
      if (who) done();
    });
    // nothing stored and nobody signed in: ask the library, and give it a moment
    firebase().then(() => {
      setTimeout(() => {
        if (settled || user || roleHint()) return;
        done();
        location.replace(gate);
      }, 900);
    }).catch(() => { /* the library never arrived: let them through */ });
    setTimeout(() => { if (!settled) done(); }, wait);
  }

  function onChange(fn) { listeners.add(fn); fn(user, profile); return () => listeners.delete(fn); }

  global.NovaAccount = {
    signIn, signInWithPassword, signUp, resetPassword, signOut, sync, pushSoon,
    loadProfile, setRole, saveProgress, boardFor, sendToBoard, SITES, requireAccount, wake,
    get user() { return user; },
    get profile() { return profile; },
    get role() { return (profile && profile.role) || ''; },
    get roleHint() { return roleHint(); },
    onChange
  };
})(typeof window !== 'undefined' ? window : globalThis);
