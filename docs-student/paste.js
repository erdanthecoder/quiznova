/* Reading questions a teacher pasted in, however they happen to be written.
 *
 * The point is that a teacher can ask any chatbot — Gemini, ChatGPT, Claude —
 * "write me ten questions about the Romans", copy whatever comes back, and paste
 * it here. None of them agree on a format, and none of them can be relied on to
 * follow one exactly, so nothing here demands a format. It reads JSON if it is
 * given JSON, and reads the ordinary numbered-question-with-A-B-C-D layout
 * otherwise, which is what these tools write when left alone.
 *
 * It never guesses at an answer. A question whose correct answer cannot be
 * identified is still imported, with the first option marked — and the caller is
 * told how many of those there were, so the teacher can check them.
 */
(function (global) {
  'use strict';

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  /* Chatbots decorate: **bold**, `code`, leading bullets, trailing colons. */
  const plain = (s) => clean(s)
    .replace(/^[-*••]\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();

  const LETTERS = 'abcdefghij';

  /* ── JSON ────────────────────────────────────────────
   * Every tool picks different key names, so ask for the value under any of the
   * names they use rather than insisting on one.
   */
  const pick = (obj, names) => {
    for (const n of names) {
      for (const k of Object.keys(obj)) {
        if (k.toLowerCase().replace(/[^a-z]/g, '') === n) return obj[k];
      }
    }
    return undefined;
  };

  const Q_TEXT = ['question', 'prompt', 'text', 'q', 'title', 'stem'];
  const Q_OPTS = ['options', 'choices', 'answers', 'alternatives', 'a'];
  const Q_ANS = ['answer', 'correct', 'correctanswer', 'correctoption', 'correctchoice',
                 'correctindex', 'answerindex', 'solution', 'key'];
  const Q_WHY = ['explanation', 'why', 'reason', 'rationale', 'note', 'feedback'];

  /** Which option an answer refers to: an index, a letter, true/false, or the text itself. */
  function resolveAnswer(answer, options) {
    if (answer == null || answer === '') return -1;
    if (typeof answer === 'number' && Number.isFinite(answer)) {
      // "1" is the first option in some tools' output and the second in others.
      // An index that only fits one of the two readings settles it; otherwise
      // treat it as counting from zero, which is what JSON output usually means.
      if (answer >= 0 && answer < options.length) return answer;
      if (answer >= 1 && answer <= options.length) return answer - 1;
      return -1;
    }
    if (typeof answer === 'boolean') {
      const want = answer ? 'true' : 'false';
      const i = options.findIndex(o => clean(o).toLowerCase() === want);
      return i;
    }
    if (Array.isArray(answer)) return resolveAnswer(answer[0], options);
    const raw = plain(answer);
    if (!raw) return -1;
    // "B", "b)", "(C)", "Option D"
    const letter = raw.match(/^(?:option\s*)?\(?([a-j])\)?[.):]?$/i);
    if (letter) {
      const i = LETTERS.indexOf(letter[1].toLowerCase());
      if (i >= 0 && i < options.length) return i;
    }
    const digit = raw.match(/^\(?(\d{1,2})\)?[.):]?$/);
    if (digit) return resolveAnswer(Number(digit[1]), options);
    // the answer written out, possibly with its letter in front
    const stripped = raw.replace(/^\(?[a-j]\)?[.):]\s*/i, '');
    const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
    let i = options.findIndex(o => same(o, raw));
    if (i < 0) i = options.findIndex(o => same(o, stripped));
    return i;
  }

  function fromObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const text = plain(pick(obj, Q_TEXT));
    if (!text) return null;

    let options = pick(obj, Q_OPTS);
    if (options && !Array.isArray(options) && typeof options === 'object') {
      // {"A": "...", "B": "..."} — keep the letters' order, not the object's
      options = Object.keys(options).sort().map(k => options[k]);
    }
    let list = Array.isArray(options)
      ? options.map(o => (o && typeof o === 'object' ? plain(pick(o, ['text', 'label', 'option', 'value'])) : plain(o)))
               .filter(Boolean)
      : [];
    // some tools mark the right one on the option itself
    let marked = -1;
    if (Array.isArray(options)) {
      options.forEach((o, i) => {
        if (o && typeof o === 'object' && (o.correct || o.isCorrect || o.is_correct)) marked = i;
      });
    }
    // strip a leading "A) " the tool left inside the option text
    list = list.map(o => o.replace(/^\(?[a-j]\)?[.):]\s+/i, ''));

    const why = plain(pick(obj, Q_WHY));
    const answer = pick(obj, Q_ANS);

    if (!list.length) {
      const t = clean(answer).toLowerCase();
      if (t === 'true' || t === 'false') {
        return { text, options: ['True', 'False'], correct: t === 'true' ? 0 : 1, why, sure: true };
      }
      // no options at all: a question the class types the answer to
      const written = plain(answer);
      if (!written) return null;
      return { text, options: [], written, why, sure: true };
    }

    let correct = marked >= 0 ? marked : resolveAnswer(answer, list);
    return { text, options: list, correct: correct < 0 ? 0 : correct, why, sure: correct >= 0 };
  }

  function fromJson(text) {
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    let list = data;
    if (!Array.isArray(list) && data && typeof data === 'object') {
      list = pick(data, ['questions', 'quiz', 'items', 'data']) || null;
      if (!Array.isArray(list)) list = null;
    }
    if (!Array.isArray(list)) return null;
    const title = (data && !Array.isArray(data)) ? plain(pick(data, ['title', 'name', 'topic'])) : '';
    const out = list.map(fromObject).filter(Boolean);
    return out.length ? { title, questions: out } : null;
  }

  /* ── the strict format ───────────────────────────────
   *
   * One question per line, parts separated by a pipe, the right answer marked
   * with a star. There is nothing to interpret, so it cannot be misread — which
   * is the point: whatever a chatbot does with layout, asking it for this gives
   * a paste that always works.
   *
   *   What is 2 + 2? | 3 | *4 | 5 | 6
   *   The Earth is flat. | True | *False
   *   Name the largest ocean. | *The Pacific
   *
   * A line may end with a second pipe and an explanation.
   */
  function fromPipes(text) {
    const lines = String(text).split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && l.includes('|') && !/^\|?\s*:?-{2,}/.test(l));
    if (!lines.length) return null;

    const out = [];
    for (const line of lines) {
      // a markdown table row arrives wrapped in pipes; the table reader has
      // already had its turn, so strip them and carry on
      // the star has to be read off the raw cell: tidying the text away would
      // take the star with it, since a star is also how markdown writes italics
      const raw = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      if (raw.length < 2) continue;
      const text = plain(raw[0]);
      if (!text) continue;

      let rest = raw.slice(1);
      let why = '';
      // a trailing cell that is plainly a sentence about the answer, not an option
      if (rest.length > 2 && /^(because|it |the |so )/i.test(rest[rest.length - 1])) why = plain(rest.pop());

      const marked = rest.map(o => /^\*/.test(o));
      const options = rest.map(o => plain(o.replace(/^\*+\s*/, ''))).filter(Boolean);
      if (!options.length) continue;
      const at = marked.indexOf(true);

      if (options.length === 1) {
        out.push({ text, options: [], written: options[0], why, sure: true });
      } else {
        out.push({ text, options, correct: at < 0 ? 0 : at, why, sure: at >= 0 });
      }
    }
    // one line with a pipe in it is more likely to be prose than a quiz
    return out.length && (out.length > 1 || out[0].options.length > 1)
      ? { title: '', questions: out } : null;
  }

  /* ── ordinary written-out questions ──────────────────
   *
   * There is no one layout. What every tool does have in common is a question,
   * then a short run of options marked in order, then the answer named somehow.
   * So that is what this looks for, rather than a format.
   */
  const NUMBERED = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.)\]:-]\s+(.*)$/i;
  const HEADING  = /^#{1,6}\s*(?:q(?:uestion)?\s*)?(\d{1,3})?\s*[.):-]?\s*(.*)$/i;
  const QPREFIX  = /^q(?:uestion)?\s*\d*\s*[:.)-]\s*(.+)$/i;
  const ANSWER   = /^(?:\*\*)?(?:the\s+)?(?:correct\s+)?(?:answer|ans|solution|key|correct)\b\s*(?:choice|option|is)?\s*(?:\*\*)?\s*[:.\-–]\s*(.+)$/i;
  const WHY      = /^(?:\*\*)?(?:explanation|why|because|reason|note)(?:\*\*)?\s*[:.\-–]\s*(.+)$/i;
  const KEYHEAD  = /^(?:\*\*)?answers?(?:\s*key)?(?:\*\*)?\s*:?\s*$/i;

  /* An option marker: a letter or a number followed by a bracket, dot or colon,
   * or simply a bullet. The marker's position in its run is what matters, not
   * what the marker says. */
  const OPTION = /^\(?([a-j]|\d{1,2})\)?\s*[.):\-]\s+(.+)$/i;
  const BULLET = /^[-*•·]\s+(.+)$/;

  function optionOf(line) {
    const bullet = line.match(BULLET);
    if (bullet) {
      // a bullet may still carry a letter: "- A) Rome"
      const inner = bullet[1].match(OPTION);
      return inner ? { mark: inner[1].toLowerCase(), text: inner[2] } : { mark: null, text: bullet[1] };
    }
    const m = line.match(OPTION);
    return m ? { mark: m[1].toLowerCase(), text: m[2] } : null;
  }

  const markIndex = (mark) => {
    if (mark === null) return null;
    const letter = LETTERS.indexOf(mark);
    if (letter >= 0) return letter;
    const n = Number(mark);
    return Number.isFinite(n) ? n - 1 : null;   // numbered options start at 1
  };

  /* Chatbots wrap headings in ** and put bullets in front of options. Strip that
   * before matching, or "**1. Question**" never reads as question one. */
  const undress = (line) => line.trim()
    .replace(/\*\*/g, '')
    .replace(/^_+|_+$/g, '')
    .trim();

  /** Pull "A) x  B) y  C) z" out of one line. Returns [] unless at least two are found. */
  function inlineOptions(line) {
    const found = [];
    const re = /(?:^|\s)\(?([a-j])\)?\s*[.):-]\s+([^]+?)(?=\s+\(?[a-j]\)?\s*[.):-]\s+|$)/gi;
    let m, expect = 0;
    while ((m = re.exec(line))) {
      if (LETTERS.indexOf(m[1].toLowerCase()) !== expect) return [];   // out of order: not an option list
      found.push(m[2].trim());
      expect++;
    }
    return found.length >= 2 ? found : [];
  }

  /* A table of questions, which is what a tool produces when asked for one
   * "in a table". The header says which column is which. */
  function fromTable(text) {
    const rows = String(text).split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.startsWith('|') && l.endsWith('|'))
      .map(l => l.slice(1, -1).split('|').map(c => plain(c)));
    if (rows.length < 2) return null;
    const head = rows[0].map(h => h.toLowerCase());
    const qAt = head.findIndex(h => /question|prompt/.test(h));
    const aAt = head.findIndex(h => /^answer|correct/.test(h));
    if (qAt < 0 || aAt < 0) return null;
    const whyAt = head.findIndex(h => /explanation|why|reason/.test(h));
    const optAt = head.map((h, i) => (i !== qAt && i !== aAt && i !== whyAt && h ? i : -1)).filter(i => i >= 0);

    const out = [];
    for (const row of rows.slice(1)) {
      if (row.every(c => /^-{2,}$|^:?-+:?$|^$/.test(c))) continue;   // the ---- separator line
      const text = row[qAt];
      if (!text) continue;
      const options = optAt.map(i => row[i]).filter(Boolean);
      const at = options.length ? resolveAnswer(row[aAt], options) : -1;
      if (options.length) out.push({ text, options, correct: at < 0 ? 0 : at, why: row[whyAt] || '', sure: at >= 0 });
      else if (row[aAt]) out.push({ text, options: [], written: row[aAt], why: row[whyAt] || '', sure: true });
    }
    return out.length ? { title: '', questions: out } : null;
  }

  function fromProse(text) {
    const lines = String(text).split(/\r?\n/);
    const out = [];
    let cur = null, blank = true;

    /* Is the line at `i` the start of a run of options rather than a question?
     * "1. What is 3+4?" followed by "1. six  2. seven" looks identical to the
     * options until you look at what comes after it: a run of two or more
     * markers counting up in order is an option list, and one on its own is not.
     */
    const dressed = lines.map(undress);
    const runFrom = (i) => {
      let n = 0;
      for (let k = i; k < dressed.length; k++) {
        const line = dressed[k];
        if (!line) break;
        const o = optionOf(line);
        if (!o || markIndex(o.mark) !== n) break;
        n++;
      }
      return n;
    };

    /* "B) Paris (correct)" and "B) Paris ✓" both name the answer where it stands. */
    const addOption = (q, mark, body) => {
      let text = plain(body);
      const marked = /\(\s*correct\s*\)\s*$/i.test(text) || /\bcorrect\s*$/i.test(text) || /[✓✔☑]\s*$/.test(text);
      if (marked) {
        text = text.replace(/\(\s*correct\s*\)\s*$/i, '').replace(/\bcorrect\s*$/i, '')
                   .replace(/[✓✔☑]\s*$/, '').replace(/[\s—–-]+$/, '').trim();
        q.answerAt = q.options.length;
      }
      if (!text) { if (marked) q.answerAt = -1; return; }
      q.marks.push(markIndex(mark));
      q.options.push(text);
    };

    const finish = () => {
      if (!cur) return;
      const q = cur; cur = null;
      if (!q.text) return;
      if (q.options.length) {
        let at = q.answerAt;
        if (at < 0 && q.answerText) {
          // The markers the tool actually used come first: "Answer: 2" against
          // options numbered 1, 2, 3 means the second one, not the third.
          const bare = plain(q.answerText).replace(/[^a-j0-9]/gi, '').toLowerCase();
          const want = bare.length <= 2 ? markIndex(bare) : null;
          if (want !== null) {
            const found = q.marks.indexOf(want);
            if (found >= 0) at = found;
          }
          if (at < 0) at = resolveAnswer(q.answerText, q.options);
        }
        out.push({ text: q.text, options: q.options, correct: at < 0 ? 0 : at,
                   why: q.why, sure: at >= 0, number: q.number });
      } else if (q.answerText) {
        const t = q.answerText.toLowerCase();
        if (t === 'true' || t === 'false') {
          out.push({ text: q.text, options: ['True', 'False'], correct: t === 'true' ? 0 : 1,
                     why: q.why, sure: true, number: q.number });
        } else {
          out.push({ text: q.text, options: [], written: q.answerText, why: q.why, sure: true, number: q.number });
        }
      }
    };

    /* A question is sometimes written on one line with its options and its answer
     * trailing after it, so whatever follows the question mark is pulled out
     * here rather than left sitting in the question's text. */
    const open = (text, number) => {
      finish();
      cur = { text: plain(text), options: [], marks: [], why: '', answerText: '', answerAt: -1, number };
      let rest = String(text || '');
      const trail = rest.match(/^(.*?)\s+(?:answer|ans)\s*[:.\-–]\s*(.+)$/i);
      if (trail) { rest = trail[1]; cur.answerText = plain(trail[2]); }
      const inline = inlineOptions(rest);
      if (inline.length) {
        const at = rest.search(/\s\(?[a-j]\)?\s*[.):-]\s/i);
        cur.text = plain(at > 0 ? rest.slice(0, at) : rest);
        inline.forEach((o, i) => addOption(cur, LETTERS[i], o));
      } else if (trail) {
        cur.text = plain(rest);
      }
    };

    let inKey = false;
    const key = {};                       // an answer key printed after the questions

    for (let at = 0; at < lines.length; at++) {
      const bare = dressed[at];
      if (!bare) { blank = true; continue; }

      if (KEYHEAD.test(bare)) { finish(); inKey = true; blank = false; continue; }
      if (inKey) {
        const k = bare.match(/^\(?(\d{1,3})\)?\s*[.):\-]?\s*(.+)$/);
        if (k) { key[Number(k[1])] = plain(k[2]); continue; }
        inKey = false;
      }

      // ── a new question, however it is announced
      const heading = bare.startsWith('#') ? bare.match(HEADING) : null;
      if (heading) {
        // "### Question 1" with the question on the next line, or "### 1. Text"
        if (heading[2]) open(heading[2], Number(heading[1]) || undefined);
        else if (heading[1]) open('', Number(heading[1]));
        blank = false;
        continue;
      }
      const num = bare.match(NUMBERED);
      const opt = optionOf(bare);
      // A numbered line is a question unless it is plainly the next option in a
      // run — which is how "1. six  2. seven  3. eight" under a question reads.
      const numberedOption = num && cur && cur.text && !cur.answerText &&
        opt && markIndex(opt.mark) === cur.options.length &&
        (cur.options.length > 0 || runFrom(at) >= 2);
      if (num && !numberedOption) { open(num[2], Number(num[1])); blank = false; continue; }

      const qp = bare.match(QPREFIX);
      if (qp && !cur) { open(qp[1]); blank = false; continue; }
      if (qp && cur && cur.options.length) { open(qp[1]); blank = false; continue; }

      if (!cur) {
        // no marker at all: a paragraph on its own starts a question
        if (!opt) { open(bare); blank = false; continue; }
        continue;
      }

      const ans = bare.match(ANSWER);
      if (ans) { cur.answerText = plain(ans[1]); blank = false; continue; }
      const why = bare.match(WHY);
      if (why) { cur.why = plain(why[1]); blank = false; continue; }
      // "A: B" as the answer, which only makes sense once options exist
      const shortAns = bare.match(/^a\s*[:.)-]\s*(.+)$/i);
      if (shortAns && cur.options.length) { cur.answerText = plain(shortAns[1]); blank = false; continue; }

      // ── options
      const trailing = bare.match(/^(.*?)\s+(?:answer|ans)\s*[:.\-–]\s*(.+)$/i);
      const body = trailing ? trailing[1] : bare;
      if (trailing) cur.answerText = plain(trailing[2]);

      const several = inlineOptions(body);
      if (several.length) {
        several.forEach((o, i) => addOption(cur, LETTERS[i], o));
        blank = false; continue;
      }
      const one = optionOf(body);
      if (one) { addOption(cur, one.mark, one.text); blank = false; continue; }

      // ── anything else continues the question, or starts the next one
      if (!cur.options.length && !cur.answerText) {
        cur.text = plain((cur.text + ' ' + body).trim());
      } else if (blank) {
        open(body);
      }
      blank = false;
    }
    finish();

    // an answer key printed at the end fills in whatever was left open
    if (Object.keys(key).length) {
      out.forEach((q, i) => {
        const named = key[q.number] !== undefined ? key[q.number] : key[i + 1];
        if (named === undefined || q.sure) return;
        const at = resolveAnswer(named, q.options);
        if (at >= 0) { q.correct = at; q.sure = true; }
      });
    }
    out.forEach(q => { delete q.number; });
    return out.length ? { title: '', questions: out } : null;
  }

  /**
   * parse(text) → { title, questions, unsure } or null
   *   questions: [{ text, options[], correct, written, why }]
   *   unsure:    how many had no answer we could identify
   */
  function parse(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    // a fenced block is JSON often enough to be worth unwrapping first
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const found = (fenced && fromJson(fenced[1].trim()))
               || fromJson(raw)
               || fromTable(raw)
               || fromPipes(fenced ? fenced[1] : raw)
               || fromProse(fenced ? fenced[1] : raw);
    if (!found) return null;
    found.unsure = found.questions.filter(q => !q.sure).length;
    return found;
  }

  global.NovaPaste = { parse, resolveAnswer };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaPaste;
