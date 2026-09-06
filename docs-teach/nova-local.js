/* Quoldek — static edition.
 *
 * GitHub Pages serves files; it cannot run the Python server. This file
 * re-implements the API the pages call, entirely in the browser:
 *   • quizzes live in localStorage
 *   • share links carry the quiz inside the URL, so a student needs no account
 *   • marking and the AI question bank run client side
 * Live PIN games are the one thing that genuinely needs a server, so those
 * calls report a clear message instead of failing silently.
 */
(function (Nova) {
  'use strict';

  const KEY = 'nova:quizzes';
  const RESP = 'nova:responses';
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or private */ } };
  const rid = (n = 8) => Math.random().toString(36).slice(2, 2 + n);
  const now = () => Date.now();

  /* ── quiz shapes, mirroring the server ─────────────── */
  const blankChoice = (text = '', correct = false) => ({ id: rid(6), text, correct });

  function blankQuestion(kind = 'mc') {
    const q = { id: rid(10), type: kind, text: '', points: 100, time: 20,
                explanation: '', image: '', choices: [], answer: '' };
    if (kind === 'mc' || kind === 'multi') {
      q.choices = [blankChoice(), blankChoice(), blankChoice(), blankChoice()];
      q.choices[0].correct = true;
    } else if (kind === 'tf') {
      q.choices = [blankChoice('True', true), blankChoice('False')];
    }
    return q;
  }

  const newQuiz = (title) => ({
    id: rid(8), title: title || 'Untitled quiz', description: '', owner: 'Teacher',
    theme: 'aurora', createdAt: now(), updatedAt: now(), version: 1,
    settings: { shuffleQuestions: false, shuffleChoices: true, showAnswers: true,
                requireName: true, defaultTime: 20, defaultPoints: 100 },
    questions: []
  });

  const allQuizzes = () => read(KEY, {});
  const saveQuizzes = (all) => {
    write(KEY, all);
    // a signed-in teacher gets a copy kept for them; see account.js
    if (window.NovaAccount) window.NovaAccount.pushSoon();
  };

  /* account.js needs to read and replace the whole set to merge the two copies. */
  Nova.allQuizzes = () => allQuizzes();
  Nova.replaceQuizzes = (all) => write(KEY, all);
  const allResponses = () => read(RESP, {});

  /* ── marking ───────────────────────────────────────── */
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const correctIds = (q) => q.choices.filter(c => c.correct).map(c => c.id);

  function grade(question, given) {
    const kind = question.type;
    if (kind === 'mc' || kind === 'tf') return !!given && correctIds(question).includes(given);
    if (kind === 'multi') {
      const want = correctIds(question);
      if (!Array.isArray(given) || !want.length) return false;
      return given.length === want.length && want.every(id => given.includes(id));
    }
    if (kind === 'short') {
      const accepted = String(question.answer || '').split(/\s*[|,]\s*/).map(norm).filter(Boolean);
      return accepted.length ? accepted.includes(norm(given)) : false;
    }
    return false;
  }

  /* ── share links: the quiz travels inside the URL ───── */
  const toB64 = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64 = (b64) => decodeURIComponent(escape(atob(b64.replace(/-/g, '+').replace(/_/g, '/'))));

  function packQuiz(quiz) {
    // strip what a student does not need, keeping the link short
    const lean = {
      i: quiz.id, t: quiz.title, d: quiz.description, s: quiz.settings,
      q: quiz.questions.map(q => ({
        i: q.id, y: q.type, x: q.text, p: q.points, m: q.time, e: q.explanation,
        a: q.answer, c: q.choices.map(c => ({ i: c.id, x: c.text, k: c.correct ? 1 : 0 }))
      }))
    };
    return toB64(JSON.stringify(lean));
  }

  function unpackQuiz(packed) {
    const lean = JSON.parse(fromB64(packed));
    return {
      id: lean.i, title: lean.t, description: lean.d || '', theme: 'aurora',
      createdAt: now(), updatedAt: now(), version: 1,
      settings: Object.assign({ shuffleQuestions: false, shuffleChoices: true, showAnswers: true,
                                requireName: true, defaultTime: 20, defaultPoints: 100 }, lean.s || {}),
      questions: (lean.q || []).map(q => ({
        id: q.i, type: q.y, text: q.x, points: q.p, time: q.m, explanation: q.e || '',
        answer: q.a || '', image: '',
        choices: (q.c || []).map(c => ({ id: c.i, text: c.x, correct: !!c.k }))
      }))
    };
  }

  /* Import a quiz from a share link or code — this is how a quiz written
   * elsewhere (by Claude in a chat, or by another teacher) lands in the studio
   * without anyone needing an API key.
   */
  Nova.importQuiz = (text) => {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('Paste a quiz link or code first.');
    const packed = raw.includes('d=') ? raw.split('d=')[1].split('&')[0].trim() : raw;
    let quiz;
    try {
      quiz = unpackQuiz(packed);
    } catch {
      throw new Error('That does not look like a Quoldek link or code.');
    }
    if (!quiz.questions || !quiz.questions.length) throw new Error('That quiz has no questions in it.');
    const all = allQuizzes();
    quiz.id = rid(8);                       // a fresh copy, never overwriting yours
    quiz.createdAt = quiz.updatedAt = now();
    all[quiz.id] = quiz;
    saveQuizzes(all);
    return quiz;
  };

  /* Questions a chatbot wrote, pasted straight in.
   *
   * Nothing is invented here: a question whose answer could not be identified is
   * still added with the first option marked, because a teacher fixing four
   * questions in the studio is better off than one who lost all ten.
   */
  Nova.importPasted = (text) => {
    const read = window.NovaPaste && NovaPaste.parse(text);
    if (!read || !read.questions.length) {
      // say what was expected, because "it did not work" is no help at all
      throw new Error('I could not find a question with its answers in that. Each question needs '
        + 'its options under it and the answer named — try the "Copy a prompt for Gemini" button.');
    }
    const quiz = newQuiz(read.title || 'Pasted quiz');
    quiz.questions = read.questions.map(q => {
      const kind = q.options.length ? 'mc' : 'short';
      const made = blankQuestion(kind);
      made.text = q.text;
      made.explanation = q.why || '';
      if (kind === 'short') {
        made.answer = q.written || '';
      } else {
        made.choices = q.options.map((text, i) => blankChoice(text, i === q.correct));
      }
      return made;
    });
    const all = allQuizzes();
    all[quiz.id] = quiz;
    saveQuizzes(all);
    return quiz;
  };

  Nova.shareLink = (quizId) => {
    const quiz = allQuizzes()[quizId];
    const base = location.href.replace(/[^/]*$/, '') + 'take.html';
    return quiz ? `${base}#d=${packQuiz(quiz)}` : base;
  };

  /* ── real Claude, called straight from the browser ──
   * The key is the teacher's own and lives only in this browser's storage —
   * it is never committed, never sent anywhere but api.anthropic.com.
   */
  const KEY_STORE = 'nova:anthropicKey';
  const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
  const setKey = (k) => { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch { /* private mode */ } };
  Nova.aiKey = { get: getKey, set: setKey };

  const AI_SYSTEM = `You are the quiz co-pilot inside Quoldek, a classroom quiz builder.
You edit a quiz by returning JSON operations. Never return prose outside the JSON object.

Return exactly this shape:
{"reply": "<one short friendly sentence for the teacher>",
 "ops": [ ...operations... ]}

Allowed operations:
{"op":"add_question","at":<optional index>,"question":{"type":"mc|tf|short|multi","text":"...","choices":[{"text":"...","correct":true}],"answer":"for short answers","points":100,"time":20,"explanation":"..."}}
{"op":"update_question","id":"<question id>","patch":{ same fields as above }}
{"op":"delete_question","id":"<question id>"}
{"op":"reorder","ids":["id","id"]}
{"op":"update_quiz","patch":{"title":"...","description":"...","settings":{"defaultTime":20}}}

Rules:
- Multiple choice questions get exactly 4 choices with exactly one correct.
- true/false questions get exactly the two choices True and False.
- Keep language age appropriate for the class described in the quiz.
- Only touch what the teacher asked for. If nothing should change, return an empty ops list.
- Always write a short explanation for each question you create.`;

  async function callClaude(prompt, quiz, key) {
    const context = {
      instruction: prompt,
      quiz: {
        title: quiz.title, description: quiz.description || '', settings: quiz.settings,
        questions: quiz.questions.map(q => ({
          id: q.id, type: q.type, text: q.text, points: q.points, time: q.time,
          answer: q.answer || '',
          choices: (q.choices || []).map(c => ({ text: c.text, correct: c.correct }))
        }))
      }
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // required for calls made directly from a browser
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 16000,
        system: AI_SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(context) }]
      })
    });

    if (!res.ok) {
      const detail = await res.text();
      let message = `Claude returned ${res.status}`;
      try { message = JSON.parse(detail).error?.message || message; } catch { /* not json */ }
      if (res.status === 401) message = 'That key was rejected. Check it and try again.';
      throw new Error(message);
    }

    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const json = text.match(/\{[\s\S]*\}/);
    if (!json) throw new Error('Claude did not return the expected JSON.');
    return JSON.parse(json[0]);
  }

  /* ── the offline fallback, used when no key is set ───
   * Backed by quizbank.js: rule-based generators for maths and language
   * (an unlimited supply, sized to the year group) plus curated banks for
   * facts. It still refuses to invent questions on a topic it does not hold.
   */
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
                  nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };

  function askedCount(text) {
    // "Year 2", "grade 4", "key stage 1" are year groups, not question counts
    const scrubbed = text.replace(/\b(year|grade|class|stage|key stage|ks)\s*\d+/g, ' ');
    const digits = scrubbed.match(/(\d+)\s*(?:more\s*|new\s*|extra\s*)*(?:\w+\s+){0,3}questions?\b/)
                || scrubbed.match(/\bquestions?\b[^.]{0,12}?(\d+)/);
    if (digits) return Math.max(1, Math.min(30, parseInt(digits[1], 10)));
    for (const [word, value] of Object.entries(WORDS)) {
      if (new RegExp(`\\b${word}\\b[^.]{0,24}\\bquestions?\\b`).test(scrubbed)) return value;
    }
    return 5;
  }

  function offlineBrain(prompt, quiz) {
    const text = prompt.toLowerCase();
    const count = askedCount(text);

    if (/\b(delete|remove|clear)\b/.test(text)) {
      const targets = (/\ball\b|\bevery\b/.test(text) ? quiz.questions : quiz.questions.slice(-count));
      return { reply: `Removed ${targets.length} question(s).`,
               ops: targets.map(q => ({ op: 'delete_question', id: q.id })) };
    }
    if (/harder|difficult|challeng/.test(text) && !/question/.test(text)) {
      return { reply: 'Tightened the timers and raised the points.',
               ops: quiz.questions.map(q => ({ op: 'update_question', id: q.id,
                 patch: { time: Math.max(8, (q.time || 20) - 5), points: (q.points || 100) + 50 } })) };
    }
    if (/easier|simpler|more time/.test(text) && !/question/.test(text)) {
      return { reply: 'Gave every question 10 extra seconds.',
               ops: quiz.questions.map(q => ({ op: 'update_question', id: q.id, patch: { time: (q.time || 20) + 10 } })) };
    }
    if (/rename|change the title|call it/.test(text)) {
      const title = (prompt.split(/:|"|to /).pop() || '').trim().replace(/^"|"$/g, '');
      if (title) return { reply: `Renamed the quiz to “${title}”.`, ops: [{ op: 'update_quiz', patch: { title } }] };
    }

    if (!window.QuizBank) {
      return { reply: 'My question bank did not load. Reload the page and try again.', ops: [] };
    }

    // fall back to the quiz's own title when the request names no topic
    const context = window.QuizBank.match(prompt).topic || window.QuizBank.match(prompt).subject
      ? prompt : `${prompt} ${quiz.title || ''} ${quiz.description || ''}`;

    const existing = quiz.questions.map(q => q.text || '');
    const { topicLabel, questions } = window.QuizBank.generate(context, count, existing);

    if (!topicLabel || !questions.length) {
      return { reply: 'I am not sure which topic you mean. Try naming it: "times tables", "the water cycle", ' +
                      '"opposites", "Ancient Egypt". Or add a Claude key (the key button above) for any topic at all.', ops: [] };
    }

    const ops = questions.map(q => ({
      op: 'add_question',
      question: {
        type: 'mc', text: q.text, points: 100, time: 20, explanation: q.why,
        choices: q.options.slice().sort(() => Math.random() - 0.5)
                  .map(opt => ({ text: opt, correct: opt === q.correct }))
      }
    }));
    const short = ops.length < count ? ` That is all the fresh ${topicLabel} questions I have right now.` : '';
    return { reply: `Added ${ops.length} ${topicLabel} question(s).${short}`, ops };
  }

  /* ── operations, mirroring the server's apply_ops ──── */
  function applyOps(quiz, ops) {
    const log = [];
    const find = (op) => quiz.questions.find(q => q.id === op.id)
      || (Number.isInteger(op.at) ? quiz.questions[op.at] : null);

    (ops || []).forEach(op => {
      if (op.op === 'add_question') {
        const p = op.question || {};
        const q = blankQuestion(p.type || 'mc');
        q.text = p.text || '';
        q.points = parseInt(p.points, 10) || quiz.settings.defaultPoints;
        q.time = parseInt(p.time, 10) || quiz.settings.defaultTime;
        q.explanation = p.explanation || '';
        q.answer = p.answer || '';
        if (Array.isArray(p.choices) && p.choices.length) {
          q.choices = p.choices.map(c => blankChoice(String(c.text || ''), !!c.correct));
          if (q.type === 'mc' && !q.choices.some(c => c.correct)) q.choices[0].correct = true;
        }
        if (Number.isInteger(op.at) && op.at >= 0 && op.at <= quiz.questions.length) quiz.questions.splice(op.at, 0, q);
        else quiz.questions.push(q);
        log.push(`Added: “${(q.text || 'new question').slice(0, 60)}”`);
      } else if (op.op === 'delete_question') {
        const q = find(op);
        if (q) { quiz.questions = quiz.questions.filter(x => x !== q); log.push(`Deleted: “${(q.text || 'question').slice(0, 60)}”`); }
      } else if (op.op === 'update_question') {
        const q = find(op);
        if (q) {
          const p = op.patch || {};
          ['text', 'explanation', 'answer', 'image', 'type'].forEach(k => { if (k in p) q[k] = p[k]; });
          ['points', 'time'].forEach(k => { if (k in p) q[k] = parseInt(p[k], 10) || q[k]; });
          if (Array.isArray(p.choices)) q.choices = p.choices.map(c => blankChoice(String(c.text || ''), !!c.correct));
          log.push(`Edited: “${(q.text || 'question').slice(0, 60)}”`);
        }
      } else if (op.op === 'reorder') {
        const ranked = (op.ids || []).map(id => quiz.questions.find(q => q.id === id)).filter(Boolean);
        quiz.questions = ranked.concat(quiz.questions.filter(q => !ranked.includes(q)));
        log.push('Reordered the questions');
      } else if (op.op === 'update_quiz') {
        const p = op.patch || {};
        ['title', 'description', 'theme'].forEach(k => { if (k in p) quiz[k] = p[k]; });
        if (p.settings) Object.assign(quiz.settings, p.settings);
        log.push('Updated the quiz settings');
      }
    });
    return log;
  }

  /* ── the API surface the pages call ────────────────── */
  const summary = (q) => ({
    id: q.id, title: q.title, description: q.description || '',
    questions: (q.questions || []).length, updatedAt: q.updatedAt, theme: q.theme || 'aurora',
    responses: (allResponses()[q.id] || []).length
  });

  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };

  /* Polling that follows the game rather than a fixed metronome. */
  const gameKicks = new Set();
  let liveGamePace = 'idle';

  /* The Laser Tag arena moves far too fast to write down: positions and shots go
   * straight between the devices on the game's live connection. Nova.stream owns
   * that connection, so it parks it here for the arena to borrow. */
  let liveLink = null;
  const arenaEars = new Set();
  Nova.arenaSend = (pin, event, payload) => liveLink && liveLink.send(event, payload);
  Nova.arenaListen = (pin, fn) => { arenaEars.add(fn); return () => arenaEars.delete(fn); };
  Nova.arenaHeard = (event, payload) => arenaEars.forEach(fn => { try { fn(event, payload); } catch { /* caller */ } });

  Nova.api = async function (path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : {};
    const clean = path.split('?')[0];
    const all = allQuizzes();

    if (clean === '/status') return { storage: 'browser', durable: true, quizzes: Object.keys(all).length, liveGames: 0, ai: false };
    if (clean === '/ai/status') {
      return getKey()
        ? { live: true, model: 'claude-opus-5' }
        : { live: false, model: 'built-in question bank' };
    }

    if (clean === '/quizzes' && method === 'GET') {
      return { quizzes: Object.values(all).map(summary).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) };
    }
    if (clean === '/quizzes' && method === 'POST') {
      const quiz = newQuiz(body.title);
      if (body.starter !== false) quiz.questions = [blankQuestion('mc')];
      all[quiz.id] = quiz; saveQuizzes(all);
      return quiz;
    }

    // A shared link has no id in the path — the quiz rides in the fragment.
    const match = clean.match(/^\/quizzes\/([^/]*)(\/.*)?$/);
    if (match) {
      const [, id, tail] = match;
      let quiz = id ? all[id] : null;

      if (!quiz && location.hash.includes('d=')) {
        try {
          quiz = unpackQuiz(location.hash.split('d=')[1].split('&')[0]);
        } catch { /* malformed link */ }
      }
      if (!quiz) fail('Quiz not found', 404);

      if (!tail && method === 'GET') return quiz;
      if (!tail && method === 'DELETE') { delete all[id]; saveQuizzes(all); return { ok: true }; }
      if (!tail && method === 'PATCH') {
        ['title', 'description', 'theme', 'owner'].forEach(k => { if (k in body) quiz[k] = body[k]; });
        if (body.settings) Object.assign(quiz.settings, body.settings);
        if (Array.isArray(body.questions)) quiz.questions = body.questions;
        quiz.updatedAt = now(); quiz.version = (quiz.version || 0) + 1;
        all[quiz.id] = quiz; saveQuizzes(all);
        return quiz;
      }
      if (tail === '/ops' && method === 'POST') {
        const log = applyOps(quiz, body.ops);
        quiz.updatedAt = now(); quiz.version = (quiz.version || 0) + 1;
        all[quiz.id] = quiz; saveQuizzes(all);
        return { quiz, log };
      }
      if (tail === '/presence') return { people: [] };
      if (tail === '/submit' && method === 'POST') {
        const answers = body.answers || {};
        let score = 0, total = 0;
        const breakdown = quiz.questions.map(q => {
          const ok = grade(q, answers[q.id]);
          total += q.points || 100;
          if (ok) score += q.points || 100;
          return { id: q.id, correct: ok, given: answers[q.id],
                   expected: correctIds(q).length ? correctIds(q) : q.answer, explanation: q.explanation || '' };
        });
        const record = { id: rid(8), name: (body.name || 'Anonymous').trim().slice(0, 40), at: now(),
                         score, total, seconds: body.seconds || 0, answers, breakdown };
        const store = allResponses();
        (store[quiz.id] = store[quiz.id] || []).push(record);
        write(RESP, store);
        return record;   // note: stored on this device — see README on collecting results
      }
      if (tail === '/responses') {
        const rows = allResponses()[quiz.id] || [];
        const stats = quiz.questions.map(q => ({
          id: q.id, text: q.text || '',
          correct: rows.filter(r => r.breakdown.some(b => b.id === q.id && b.correct)).length,
          answered: rows.filter(r => r.breakdown.some(b => b.id === q.id)).length
        }));
        return { responses: rows, stats };
      }
    }

    if (clean === '/ai' && method === 'POST') {
      const quiz = all[body.quizId];
      if (!quiz) fail('Quiz not found', 404);

      let result, source = 'offline';
      const key = getKey();
      if (key) {
        try {
          result = await callClaude(body.prompt || '', quiz, key);
          source = 'claude';
        } catch (err) {
          result = offlineBrain(body.prompt || '', quiz);
          result.reply = `${err.message}\n\n${result.reply}`;
        }
      } else {
        result = offlineBrain(body.prompt || '', quiz);
      }
      result.ops = result.ops || [];
      if (body.permission === 'read') {
        return { reply: result.reply, ops: [], applied: false, source,
                 note: 'Read-only mode, so nothing was changed.' };
      }
      if (body.permission === 'auto' && result.ops.length) {
        const log = applyOps(quiz, result.ops);
        quiz.updatedAt = now(); all[quiz.id] = quiz; saveQuizzes(all);
        return { reply: result.reply, ops: result.ops, applied: true, log, quiz, source };
      }
      return { reply: result.reply, ops: result.ops, applied: false, source };
    }

    // live games run through Supabase (live.js); the pages themselves are unchanged
    if (clean === '/modes' || clean.startsWith('/games')) {
      if (!window.NovaLive) fail('Live games did not load. Reload the page.', 503);
      if (clean.startsWith('/games') && method === 'POST' && clean === '/games') {
        body.quiz = all[body.quizId];                 // the quiz lives in this browser
      }
      const result = await window.NovaLive.handle(clean, method, body);
      if (result === null) fail('Unknown request: ' + path, 404);
      // the shooting round is as live as the question, so poll it at the same rate
      if (result && result.state) {
        liveGamePace = (result.state === 'question' || result.state === 'aim') ? 'question' : 'idle';
      }
      // anything this device just did (answered, started, advanced) should show up now
      // …just after the caller has handled the reply, so the two cannot race
      if (method === 'POST' && clean !== '/games') setTimeout(() => gameKicks.forEach(kick => kick()), 30);
      return result;
    }
    fail('Unknown request: ' + path, 404);
  };

  /* ── "Connect Claude": one button in the co-pilot header ─────
   * Injected here rather than in the shared HTML so the server edition,
   * which reads its key from the server environment, stays untouched.
   */
  function mountKeyButton() {
    const header = document.querySelector('.ai-head');
    const mode = document.getElementById('ai-mode');
    if (!header || !mode || document.getElementById('ai-key')) return;

    const paint = () => {
      mode.textContent = getKey() ? 'Claude · claude-opus-5' : 'Built-in question bank';
      button.innerHTML = Sprite.icon('key', 17);
      button.title = getKey() ? 'Claude is connected. Click to change or remove the key.'
                              : 'Connect your Claude API key for questions on any topic';
      button.style.opacity = getKey() ? '1' : '.6';
    };

    const button = document.createElement('button');
    button.id = 'ai-key';
    button.className = 'icon-btn';
    button.onclick = () => {
      const current = getKey();
      Nova.modal(`
        <h2 style="margin-bottom:6px">Connect Claude</h2>
        <p class="muted tiny" style="margin-bottom:18px">
          Without a key I can only offer ready-made questions on five school subjects. With one I write
          original questions on any topic, at any reading level.<br><br>
          Your key is stored <strong>only in this browser</strong> — it is never sent anywhere except
          Anthropic, and never saved into the website's code.
        </p>
        <div class="field"><label class="label" for="k">Anthropic API key</label>
          <input class="input mono" id="k" placeholder="sk-ant-..." value="${current ? current.slice(0, 12) + '…' : ''}"></div>
        <p class="tiny faint" style="margin-top:10px">Get one at console.anthropic.com → API keys. Usage is billed to your own account.</p>
        <div class="row" style="margin-top:20px;gap:10px">
          ${current ? '<button class="btn danger" id="forget-key">Remove key</button>' : ''}
          <div class="grow"></div>
          <button class="btn ghost" id="cancel">Cancel</button>
          <button class="btn primary" id="save-key">Save key</button>
        </div>`, {
        onMount(box, close) {
          box.querySelector('#cancel').onclick = close;
          box.querySelector('#forget-key')?.addEventListener('click', () => {
            setKey(''); paint(); close(); Nova.toast('Key removed. Back to the built-in bank.');
          });
          box.querySelector('#save-key').onclick = () => {
            const value = box.querySelector('#k').value.trim();
            if (!value || value.endsWith('…')) return Nova.toast('Paste the whole key', 'bad');
            if (!value.startsWith('sk-ant-')) return Nova.toast('That does not look like an Anthropic key', 'bad');
            setKey(value); paint(); close();
            Nova.toast('Claude connected. Ask for any topic.', 'good');
          };
        }
      });
    };
    header.insertBefore(button, document.getElementById('ai-clear'));
    paint();
  }

  /* What to ask a chatbot for. Deliberately plain: it asks for the layout these
   * tools already produce when left alone, so it works even when the teacher
   * forgets to send it and just says "write me ten questions about the Romans".
   */
  /* Chatbots are careless about layout and careful about a format they are shown.
   * This asks for one line per question with the answer starred, which has
   * nothing in it to misread — so a paste made this way always works. */
  const GEMINI_PROMPT =
    'Write 10 quiz questions about TOPIC, for players aged AGE.\n\n' +
    'Give me one question per line, in exactly this format and nothing else:\n\n' +
    'Question text? | option | *correct option | option | option\n\n' +
    'Put a star in front of the correct option. Four options each.\n' +
    'No numbering, no headings, no introduction, no closing remarks.\n\n' +
    'For example:\n' +
    'What is 2 + 2? | 3 | *4 | 5 | 6\n' +
    'Which planet is closest to the Sun? | Venus | *Mercury | Mars | Earth';

  function openImportDialog() {
      Nova.modal(`
        <h2 style="margin-bottom:6px">Add questions</h2>
        <p class="muted tiny" style="margin-bottom:16px">
          Paste anything: a Quoldek share link, or the questions themselves as any chatbot wrote
          them — Gemini, ChatGPT, Claude. If a paste ever comes out wrong, use the prompt button
          below: it asks for one line per question with the answer starred, which cannot be misread.
        </p>
        <div class="field">
          <textarea class="textarea" id="code" style="min-height:150px;font-size:.86rem"
                    placeholder="1. What is 7 x 8?&#10;A) 54&#10;B) 56&#10;C) 48&#10;D) 64&#10;Answer: B"></textarea>
        </div>
        <div id="read-out" class="tiny readout"></div>
        <div class="row" style="margin-top:18px;gap:10px;align-items:center">
          <button class="btn ghost sm" id="copy-prompt" type="button">Copy a prompt for Gemini</button>
          <div class="grow"></div>
          <button class="btn ghost" id="cancel-import">Cancel</button>
          <button class="btn primary" id="do-import">Add them</button>
        </div>`, {
        onMount(box, close) {
          const area = box.querySelector('#code');
          const readOut = box.querySelector('#read-out');
          box.querySelector('#cancel-import').onclick = close;

          box.querySelector('#copy-prompt').onclick = async (e) => {
            const button = e.currentTarget;
            try { await navigator.clipboard.writeText(GEMINI_PROMPT); }
            catch { area.value = GEMINI_PROMPT; return Nova.toast('Copy it from the box above.'); }
            button.textContent = 'Copied — paste it into Gemini';
            setTimeout(() => { button.textContent = 'Copy a prompt for Gemini'; }, 3000);
          };

          /* Say what was understood before anything is added, so a paste that came
           * out wrong is caught here rather than in front of a class. */
          /* Show the questions themselves, not a count. "Read 4 questions" is no
             comfort when one of them came out wrong, and no help at all when
             none did: seeing what it made of the paste is what tells a teacher
             whether to press the button. */
          const preview = () => {
            const text = area.value.trim();
            readOut.innerHTML = '';
            if (!text) return;
            if (looksLikeCode(text)) { readOut.textContent = 'A Quoldek quiz link.'; return; }
            const read = window.NovaPaste && NovaPaste.parse(text);
            if (!read) {
              const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
              readOut.innerHTML = lines.length > 2
                ? 'I cannot find a question with its answers in that. This is the first line I looked at:'
                  + `<div class="sawline">${Nova.esc(lines[0].slice(0, 90))}</div>`
                  + 'Each question needs its options and the answer marked — the prompt button below asks for that.'
                : 'Nothing readable yet — keep pasting.';
              return;
            }
            const n = read.questions.length;
            const head = document.createElement('div');
            head.innerHTML = `<strong>${n} question${n === 1 ? '' : 's'}</strong>`
              + (read.unsure ? ` — ${read.unsure} with no answer marked, so the first option is used`
                             : ', all with an answer');
            readOut.append(head);
            const list = document.createElement('ol');
            list.className = 'sawlist';
            read.questions.slice(0, 8).forEach(q => {
              const li = document.createElement('li');
              if (!q.sure) li.className = 'unsure';
              const answer = q.options.length ? q.options[q.correct] : (q.written || '');
              li.innerHTML = `${Nova.esc(q.text.slice(0, 70))} <b>${Nova.esc(answer.slice(0, 30))}</b>`;
              list.append(li);
            });
            if (n > 8) list.append(Object.assign(document.createElement('li'),
                                                 { textContent: `and ${n - 8} more` }));
            readOut.append(list);
          };
          area.addEventListener('input', preview);

          box.querySelector('#do-import').onclick = () => {
            const text = area.value.trim();
            try {
              const quiz = looksLikeCode(text) ? Nova.importQuiz(text) : Nova.importPasted(text);
              close();
              Nova.toast(`Added “${quiz.title}” — ${quiz.questions.length} questions`, 'good');
              location.href = 'studio.html?id=' + quiz.id;
            } catch (err) {
              Nova.toast(err.message, 'bad');
            }
          };
          area.focus();
        }
      });
  }

  /* A share link, or the base64 blob out of one. Anything else is treated as
   * questions a person or a chatbot wrote. */
  const looksLikeCode = (text) =>
    /[?#&]d=/.test(text) || (/^[A-Za-z0-9\-_]{80,}$/.test(text.replace(/\s+/g, '')));

  /* Two entry points, because a button tucked beside Search is easy to miss:
   * one in the top bar that is on screen the moment the page opens, and one as
   * a card sitting next to "New quiz".
   */
  function mountImportButton() {
    const grid = document.getElementById('grid');
    if (!grid) return;                       // hub page only

    const top = document.querySelector('.topbar-inner');
    const newBtn = document.getElementById('top-new');
    if (top && newBtn && !document.getElementById('import-top')) {
      const button = document.createElement('button');
      button.id = 'import-top';
      button.className = 'btn sm';
      button.innerHTML = Sprite.icon('inbox', 16) + ' Paste';
      button.title = 'Paste questions written elsewhere, or a share link';
      button.onclick = openImportDialog;
      top.insertBefore(button, newBtn);
    }

    // the grid is rebuilt on every search keystroke, so re-add the card each time
    const addCard = () => {
      if (grid.querySelector('.import-card')) return;
      const anchor = grid.querySelector('.new-card');
      if (!anchor) return;
      const card = document.createElement('div');
      card.className = 'quiz-card new-card import-card';
      card.style.borderColor = 'rgba(52,224,161,.45)';
      card.innerHTML = `
        <div class="plus" style="background:var(--grad-mint);color:#03251b">${Sprite.icon('inbox', 20)}</div>
        <strong>Paste questions in</strong>
        <span class="tiny faint">From Gemini, ChatGPT, or a shared link</span>`;
      card.onclick = openImportDialog;
      anchor.after(card);
    };
    addCard();
    new MutationObserver(addCard).observe(grid, { childList: true });
  }

  /* Signing in is offered, never demanded: the button says what it is for, and
   * everything on the page works exactly the same without it. */
  function mountAccountButton() {
    const top = document.querySelector('.topbar-inner');
    if (!top || !window.NovaAccount || document.getElementById('acct')) return;
    const newBtn = document.getElementById('top-new');

    const button = document.createElement('button');
    button.id = 'acct';
    button.className = 'btn sm';
    top.insertBefore(button, newBtn || null);

    const paint = (user) => {
      if (user) {
        button.innerHTML = (user.photo
            ? `<img src="${user.photo.replace(/"/g, '')}" alt="" width="20" height="20" style="border-radius:50%">`
            : Sprite.icon('spark', 16)) +
          ` <span class="hide-sm">${Nova.esc(user.name.split(' ')[0])}</span>`;
        button.title = `Signed in as ${user.email}. Your quizzes are saved to this account.`;
      } else {
        button.innerHTML = Sprite.icon('key', 16) + ' Sign in';
        button.title = 'Sign in with Google so your quizzes follow you to another computer';
      }
    };
    NovaAccount.onChange(paint);

    button.onclick = () => {
      const user = NovaAccount.user;
      if (!user) {
        button.disabled = true;
        NovaAccount.signIn()
          .then(() => Nova.toast('Signed in. Your quizzes are saved to this account.', 'good'))
          .catch(err => Nova.toast(err.message || 'Could not sign in.', 'bad'))
          .finally(() => { button.disabled = false; });
        return;
      }
      Nova.modal(`
        <h2 style="margin-bottom:6px">Signed in</h2>
        <p class="muted tiny" style="margin-bottom:18px">
          ${Nova.esc(user.email)}<br><br>
          Your quizzes are kept for this account, so they are here on any computer you sign in on.
          They stay in this browser too, so nothing is lost if you sign out.
        </p>
        <div class="row" style="justify-content:flex-end;gap:10px">
          <button class="btn ghost" id="acct-close">Close</button>
          <button class="btn danger" id="acct-out">Sign out</button>
        </div>`, {
        onMount(box, close) {
          box.querySelector('#acct-close').onclick = close;
          box.querySelector('#acct-out').onclick = () => {
            NovaAccount.signOut().then(() => { close(); Nova.toast('Signed out. Your quizzes are still in this browser.'); });
          };
        }
      });
    };
  }

  function mountAll() { mountKeyButton(); mountImportButton(); mountAccountButton(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();

  /* Realtime, without a socket:
   *  • live games poll the shared game row, which is how every device keeps in step
   *  • quiz editing only has to notice this browser's other tabs
   */
  Nova.stream = function (path, onMessage) {
    const game = path.match(/^\/games\/([^/]+)\/events$/);
    if (game) {
      const pin = game[1];
      let stop = false, busy = false, connected = false, again = false;
      const tick = async () => {
        if (stop) return;
        if (busy) { again = true; return; }   // a change landed mid-read: read once more after
        busy = true;
        clearTimeout(timer);
        try {
          const state = await Nova.api('/games/' + pin);
          onMessage({ event: 'game:state', data: state });
        } catch { /* between questions the row may briefly be busy */ }
        busy = false;
        if (stop) return;
        if (again) { again = false; return tick(); }
        // With a live connection the game tells us when it changes, so this is only
        // a safety net. Without one, it is the whole mechanism.
        const wait = connected ? 5000 : (liveGamePace === 'question' ? 700 : 1500);
        timer = setTimeout(tick, wait);
      };

      // changes arrive in bursts (three phones answering at once); coalesce them
      let soon = null;
      const nudge = () => { if (soon || stop) return; soon = setTimeout(() => { soon = null; tick(); }, 60); };
      const realtime = window.NovaRealtime && window.NovaRealtime.available
        ? window.NovaRealtime.watch(pin, nudge, (status) => {
            connected = status === 'live';
            if (connected) tick();   // catch up on whatever happened while connecting
          }, (event, payload) => Nova.arenaHeard(event, payload))
        : null;
      liveLink = realtime;

      let timer = setTimeout(tick, 60);
      // this device just did something (answered, started, advanced): do not make it
      // wait out the poll interval to see the result
      gameKicks.add(tick);
      return { close() {
        stop = true; clearTimeout(timer); clearTimeout(soon);
        gameKicks.delete(tick);
        if (liveLink === realtime) liveLink = null;
        if (realtime) realtime.close();
      } };
    }

    const handler = (evt) => { if (evt.key === KEY) onMessage({ event: 'poll', data: {} }); };
    window.addEventListener('storage', handler);
    return { close: () => window.removeEventListener('storage', handler) };
  };
})(window.Nova);
