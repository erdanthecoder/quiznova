/* Kyrgyz topics from LearnKyrgyz, as ready Quoldek quizzes.
 *
 * LearnKyrgyz (learnkyrgyz.web.app) publishes four-option questions for each of its
 * 99 Kyrgyz topics at /api/quoldek/v1, in English and Russian. This picks topics,
 * turns their questions into an ordinary Quoldek quiz through the same API the
 * rest of the site uses, and opens it — so it can be edited, shared or hosted live
 * like any quiz a teacher wrote.
 *
 * A link can open the picker with topics already chosen:
 *   quoldek.web.app/?learnkyrgyz=greetings,family&lang=ru
 */
(function (Nova) {
  'use strict';
  if (!Nova) return;
  const BANK = 'https://learnkyrgyz.web.app/api/quoldek/v1';
  const rid = (n = 8) => Math.random().toString(36).slice(2, 2 + n);
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // the static edition has page files; the Flask edition has clean routes
  const studioUrl = (id) => (typeof Nova.shareLink === 'function' ? 'studio.html?id=' : '/studio?id=') + id;

  let index = null;
  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('LearnKyrgyz could not be reached. Try again in a moment.');
    return res.json();
  }
  const getIndex = async () => (index = index || await getJSON(BANK + '/index.json'));
  const getTopic = (id) => getJSON(`${BANK}/topics/${encodeURIComponent(id)}.json`);

  function toQuestion(q, lang) {
    const options = q.options[lang] || q.options.en;
    const right = options[q.answer];
    const ky = q.kyrgyz ? `«${q.kyrgyz}»${q.translit ? ` (${q.translit})` : ''}` : '';
    const explanation = q.kind === 'say' ? `${ky} — ${lang === 'ru' ? 'по-кыргызски' : 'in Kyrgyz'}` : ky ? `${ky} = ${right}` : '';
    return {
      id: rid(10), type: 'mc', text: q.question[lang] || q.question.en, points: 100, time: q.time_limit || 20,
      explanation, image: '', answer: '',
      choices: options.map((text, i) => ({ id: rid(6), text, correct: i === q.answer }))
    };
  }

  /* topics: ids · lang: 'en' | 'ru' · count: 0 = all · kinds: which question kinds */
  async function makeQuiz({ topics, lang = 'en', count = 20, kinds = ['meaning', 'say', 'sentence'] }) {
    const data = await Promise.all(topics.map(getTopic));
    let questions = shuffle(data.flatMap(d => d.questions.filter(q => kinds.includes(q.kind))));
    if (count) questions = questions.slice(0, count);
    if (!questions.length) throw new Error('Those topics have no questions of that kind.');
    const names = data.map(d => d.topic.title[lang] || d.topic.title.en);
    const title = (lang === 'ru' ? 'Кыргызский: ' : 'Kyrgyz: ') + names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
    const quiz = await Nova.api('/quizzes', { method: 'POST', body: { title: title.slice(0, 120), starter: false } });
    return Nova.api('/quizzes/' + quiz.id, { method: 'PATCH', body: {
      description: (lang === 'ru' ? 'Вопросы из LearnKyrgyz (learnkyrgyz.web.app): ' : 'Questions from LearnKyrgyz (learnkyrgyz.web.app): ') + names.join(', '),
      questions: questions.map(q => toQuestion(q, lang))
    } });
  }

  async function openPicker({ topics = [], lang = 'en' } = {}) {
    const chosen = new Set(topics);
    let count = 20, kinds = ['meaning', 'say', 'sentence'];
    Nova.modal(`
      <h2 style="margin-bottom:6px">Kyrgyz from LearnKyrgyz</h2>
      <p class="muted tiny" style="margin-bottom:14px">Pick topics and Quoldek makes the quiz: four options, a timer and the Kyrgyz word in every explanation.
        Questions come from <a href="https://learnkyrgyz.web.app" target="_blank" rel="noopener">LearnKyrgyz</a>.</p>
      <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div class="seg" id="lk-lang"><button data-v="en">English</button><button data-v="ru">Русский</button></div>
        <div class="seg" id="lk-count"><button data-v="10">10</button><button data-v="20">20</button><button data-v="0">All</button></div>
        <div class="seg" id="lk-kinds"><button data-v="all">Words &amp; sentences</button><button data-v="words">Words</button><button data-v="sentence">Sentences</button></div>
      </div>
      <div id="lk-units" style="max-height:48vh;overflow:auto;border:2.5px solid var(--line);border-radius:16px;padding:10px 12px">
        <p class="tiny faint">Loading topics…</p></div>
      <div class="row" style="margin-top:18px;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="tiny muted" id="lk-sum">No topics chosen</span>
        <div class="row" style="gap:8px"><button class="btn ghost" data-x>Cancel</button>
          <button class="btn" id="lk-host">Make &amp; host live</button>
          <button class="btn primary" id="lk-go">Make quiz</button></div>
      </div>`, {
      wide: true,
      async onMount(box, close) {
        box.querySelector('[data-x]').onclick = close;
        const seg = (id, get, set) => {
          const node = box.querySelector(id);
          const draw = () => node.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === get()));
          node.querySelectorAll('button').forEach(b => b.onclick = () => { set(b.dataset.v); draw(); drawUnits(); });
          draw();
        };
        seg('#lk-lang', () => lang, v => { lang = v; });
        seg('#lk-count', () => String(count), v => { count = +v; });
        seg('#lk-kinds', () => kinds.length === 3 ? 'all' : kinds[0] === 'sentence' ? 'sentence' : 'words',
          v => { kinds = v === 'all' ? ['meaning', 'say', 'sentence'] : v === 'words' ? ['meaning', 'say'] : ['sentence']; });

        const host = box.querySelector('#lk-units');
        let idx;
        try { idx = await getIndex(); }
        catch (err) { host.innerHTML = `<p class="tiny">${esc(err.message)}</p>`; return; }
        const byId = Object.fromEntries(idx.topics.map(t => [t.id, t]));

        function drawUnits() {
          if (!idx) return;
          host.innerHTML = idx.units.map(u => `
            <div style="margin:6px 0 12px">
              <div class="row" style="gap:8px;align-items:center;margin-bottom:6px">
                <strong>${esc((lang === 'ru' ? 'Раздел ' : 'Unit ') + u.index)} · ${esc(u.title[lang] || u.title.en)}</strong>
                <span class="chip">${esc(u.level)}</span>
                <button class="btn sm ghost" data-unit="${esc(u.id)}">${u.topics.every(id => chosen.has(id)) ? (lang === 'ru' ? 'Снять всё' : 'Clear') : (lang === 'ru' ? 'Весь раздел' : 'Whole unit')}</button>
              </div>
              <div class="row" style="gap:6px;flex-wrap:wrap">${u.topics.filter(id => byId[id]).map(id => `
                <button class="btn sm${chosen.has(id) ? ' primary' : ''}" data-topic="${esc(id)}" title="${esc(byId[id].title.ky)}">
                  ${esc(byId[id].title[lang] || byId[id].title.en)} <span class="tiny" style="opacity:.7">${byId[id].questions}</span></button>`).join('')}
              </div></div>`).join('');
          host.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => { const id = b.dataset.topic; chosen.has(id) ? chosen.delete(id) : chosen.add(id); drawUnits(); });
          host.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => {
            const u = idx.units.find(x => x.id === b.dataset.unit);
            const all = u.topics.every(id => chosen.has(id));
            u.topics.forEach(id => all ? chosen.delete(id) : chosen.add(id)); drawUnits();
          });
          const n = [...chosen].reduce((a, id) => a + (byId[id]?.questions || 0), 0);
          box.querySelector('#lk-sum').textContent = chosen.size
            ? `${chosen.size} topic${chosen.size === 1 ? '' : 's'} · ${count ? Math.min(count, n) : n} questions`
            : 'No topics chosen';
        }
        drawUnits();

        const make = async (thenHost) => {
          if (!chosen.size) return Nova.toast('Pick at least one topic first.', 'bad');
          const buttons = box.querySelectorAll('#lk-go, #lk-host');
          buttons.forEach(b => b.disabled = true);
          try {
            const quiz = await makeQuiz({ topics: [...chosen].filter(id => byId[id]), lang, count, kinds });
            close();
            Nova.toast(`“${quiz.title}” is ready`, 'good');
            if (thenHost && typeof window.hostGame === 'function') { if (typeof window.load === 'function') window.load(); window.hostGame(quiz); }
            else location.href = studioUrl(quiz.id);
          } catch (err) { Nova.toast(err.message, 'bad'); buttons.forEach(b => b.disabled = false); }
        };
        box.querySelector('#lk-go').onclick = () => make(false);
        box.querySelector('#lk-host').onclick = () => make(true);
      }
    });
  }

  Nova.learnKyrgyz = { openPicker, makeQuiz, bank: BANK };

  // ?learnkyrgyz=greetings,family&lang=ru opens the picker with those topics chosen
  document.addEventListener('DOMContentLoaded', () => {
    const p = new URLSearchParams(location.search);
    if (!p.has('learnkyrgyz')) return;
    const topics = p.get('learnkyrgyz').split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
    openPicker({ topics, lang: p.get('lang') === 'ru' ? 'ru' : 'en' });
  });
})(window.Nova);
