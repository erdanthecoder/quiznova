/* The door another site knocks on.
 *
 * A lesson somewhere else finishes with a handful of words a class has just
 * met, and the useful next thing is to play with them for five minutes. This
 * is how that arrives: a link. No server talks to another server, no key is
 * shared, nothing has to be up for it to work — the whole request is in the
 * address, so it survives being pasted into a chat, a worksheet or a QR code.
 *
 * Two shapes of request, because there are two things a site might have:
 *
 *   a topic       ?topic=Kyrgyz animals&year=3&n=12
 *                 Quoldek writes the questions itself, out of its own bank.
 *
 *   the words     ?pairs=мышык:cat,ит:dog,ат:horse&topic=Animals
 *                 The lesson's own words, asked both ways round, with the
 *                 wrong answers drawn from the rest of the list so a child
 *                 cannot pick the odd one out without knowing the word.
 *
 * Either way the teacher lands on a quiz that is already written and one press
 * from being on the board.
 *
 * On the account: signing in is Firebase Auth on this project, and any site of
 * the same owner that initialises Firebase with the same config has the same
 * account — there is nothing to build for that beyond using the config below.
 * Where a visitor's work actually moves between two sites, the page says so;
 * an account quietly spanning places a person did not expect is not a feature.
 */
(function (global) {
  'use strict';

  /* The public Firebase config. Public is the right word: these values ship in
     every page already and are meant to. They identify the project, they do not
     authorise anything — every read and write is still checked against a token
     the browser cannot forge. */
  const ACCOUNT = {
    apiKey: 'AIzaSyByiYxPJdRy1lppKk93Gu9O2qSnk67yVNo',
    authDomain: 'quiznova-88751.firebaseapp.com',
    projectId: 'quiznova-88751',
    appId: '1:1042467906309:web:ecb2c2b5043db6c71e8d6c'
  };

  const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max || 80);
  const rid = (n) => Array.from({ length: n },
    () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('');

  /** A real shuffle, for the same reason everywhere else has one. */
  function shuffle(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /* ── reading the request ─────────────────────────────── */

  /** Word pairs out of "мышык:cat, ит:dog" or a newline-separated list. */
  function readPairs(raw) {
    return String(raw || '')
      .split(/[,\n;]+/)
      .map(bit => {
        const at = bit.indexOf(':') >= 0 ? bit.indexOf(':')
          : bit.indexOf('=') >= 0 ? bit.indexOf('=') : bit.indexOf('-');
        if (at < 1) return null;
        const a = clean(bit.slice(0, at), 60), b = clean(bit.slice(at + 1), 60);
        return (a && b) ? [a, b] : null;
      })
      .filter(Boolean);
  }

  /** What the address is asking for, whatever shape it came in. */
  function readRequest(search) {
    const p = new URLSearchParams(search === undefined ? global.location.search : search);
    const pairs = readPairs(p.get('pairs') || p.get('words'));
    return {
      from: clean(p.get('from'), 40),
      topic: clean(p.get('topic') || p.get('t'), 60),
      title: clean(p.get('title'), 70),
      year: Math.min(6, Math.max(1, Number(p.get('year') || p.get('y')) || 3)),
      count: Math.min(30, Math.max(4, Number(p.get('n') || p.get('count')) || 12)),
      mode: clean(p.get('mode'), 12),
      pairs,
      asked: !!(pairs.length || p.get('topic') || p.get('t'))
    };
  }

  /* ── turning it into questions ───────────────────────── */

  /** One multiple-choice question, in the shape the app stores. */
  const ask = (text, right, wrongs, why) => ({
    type: 'mc', text, points: 100, time: 20, explanation: why || '',
    choices: shuffle([{ text: right, correct: true }]
      .concat(wrongs.slice(0, 3).map(w => ({ text: w }))))
  });

  /* A list of word pairs, asked both ways round. Both directions are worth
     asking: reading a word and knowing it is one thing, wanting to say it and
     reaching for it is another, and a class that only ever sees one direction
     learns to recognise and not to speak. */
  function fromPairs(pairs, count) {
    if (pairs.length < 4) return [];      // fewer than four and every answer is obvious
    const out = [];
    const deck = shuffle(pairs);
    for (let i = 0; out.length < count && i < count * 4; i++) {
      const [a, b] = deck[i % deck.length];
      const others = shuffle(pairs).filter(p => p[0] !== a).slice(0, 3);
      if (others.length < 3) break;
      const forward = (i % 2 === 0);
      const text = forward ? `What does "${a}" mean?` : `How do you say "${b}"?`;
      if (out.some(q => q.text === text)) continue;
      out.push(forward
        ? ask(text, b, others.map(p => p[1]), `"${a}" is ${b}.`)
        : ask(text, a, others.map(p => p[0]), `${b} is "${a}".`));
    }
    return out;
  }

  /** A topic, written by the app's own question engine. */
  function fromTopic(topic, year, count) {
    if (!global.QuizBank) return [];
    const made = global.QuizBank.generate(`${topic} year ${year}`, count, []);
    return (made.questions || []).map(q =>
      ask(q.text, q.correct, q.options.filter(o => o !== q.correct), q.why));
  }

  /** Everything: a request in, a quiz out, or null if there was nothing to do. */
  function quizFrom(req) {
    const r = req || readRequest();
    if (!r.asked) return null;
    const questions = r.pairs.length ? fromPairs(r.pairs, r.count)
                                     : fromTopic(r.topic, r.year, r.count);
    if (!questions.length) return null;
    const title = r.title || (r.topic ? r.topic : 'A quiz from a lesson');
    return { title, questions, from: r.from, mode: r.mode };
  }

  /* ── and the way back out ────────────────────────────── */

  /* Building the link from the other side, so the site sending the words does
     not have to know how any of this is spelled. */
  function link(opts) {
    const o = opts || {};
    const at = o.at || 'https://quoldek.web.app/start';
    const p = new URLSearchParams();
    if (o.from) p.set('from', o.from);
    if (o.topic) p.set('topic', o.topic);
    if (o.title) p.set('title', o.title);
    if (o.year) p.set('year', String(o.year));
    if (o.count) p.set('n', String(o.count));
    if (o.mode) p.set('mode', o.mode);
    if (o.pairs && o.pairs.length) {
      p.set('pairs', o.pairs.map(([a, b]) => `${a}:${b}`).join(','));
    }
    return at + '?' + p.toString();
  }

  global.NovaBridge = { ACCOUNT, readRequest, readPairs, quizFrom, fromPairs, fromTopic, link, rid };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaBridge;
