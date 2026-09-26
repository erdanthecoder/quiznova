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
 * or skip the picker and make the quiz straight away (LearnKyrgyz and oneintwo.web.app
 * send people here like this), then open the game picker, the studio or a solo run:
 *   quoldek.web.app/?learnkyrgyz=greetings,family&lang=en&go=host|studio|take
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

  /* The arrival: topic cards fly from LearnKyrgyz into Quoldek while the quiz is made. */
  const takeUrl = (id) => (typeof Nova.shareLink === 'function' ? 'take.html?id=' : '/take?id=') + id;
  function arrivalLayer(names) {
    const css = document.createElement('style');
    css.textContent = `
      .lk-arrive{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;align-content:center;gap:26px;color:#fff;text-align:center;
        background:radial-gradient(circle at 50% 45%,#2a1b5e,#0d0820 72%);animation:lkIn .35s ease-out}
      .lk-arrive.bye{animation:lkOut .55s ease-in forwards}
      @keyframes lkIn{from{opacity:0}} @keyframes lkOut{to{opacity:0;transform:scale(1.06)}}
      .lk-stage{display:grid;grid-template-columns:auto minmax(150px,360px) auto;align-items:center;gap:12px;width:min(92vw,640px)}
      .lk-end{display:grid;justify-items:center;gap:8px;font-weight:800}
      .lk-tile{width:84px;height:84px;border-radius:26px;display:grid;place-items:center;font:900 30px/1 inherit;color:#fff;box-shadow:0 18px 40px rgba(0,0,0,.4)}
      .lk-tile.a{background:linear-gradient(135deg,#58cc02,#1cb0f6)} .lk-tile.b{background:linear-gradient(135deg,#7c5cff,#22d3ee);animation:lkPulse 1.3s ease-in-out infinite .5s}
      @keyframes lkPulse{50%{transform:scale(1.12);box-shadow:0 0 34px #22d3ee}}
      .lk-path{position:relative;height:90px}
      .lk-beam{position:absolute;left:0;right:0;top:50%;height:4px;margin-top:-2px;border-radius:4px;background:linear-gradient(90deg,#58cc02,#7c5cff,#22d3ee);background-size:200% 100%;animation:lkBeam .8s linear infinite;box-shadow:0 0 18px #7c5cff}
      @keyframes lkBeam{to{background-position:-200% 0}}
      .lk-card{position:absolute;left:0;top:50%;padding:7px 12px;border-radius:12px;background:#fff;color:#3c1f8f;font-weight:800;font-size:13px;white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;
        box-shadow:0 8px 20px rgba(0,0,0,.35);opacity:0;transform:translate(0,-50%) scale(.6);animation:lkCard 1.4s cubic-bezier(.5,0,.3,1) infinite;animation-delay:calc(var(--i)*.28s)}
      @keyframes lkCard{15%{opacity:1}55%{transform:translate(120px,calc(-50% - 34px)) rotate(-6deg) scale(1)}90%{opacity:1}100%{left:100%;transform:translate(-100%,-50%) scale(.4);opacity:0}}
      .lk-msg{font-weight:800;font-size:19px;padding:0 16px} .lk-sub{opacity:.75;font-size:14px;margin-top:-14px}
      .lk-check{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#58cc02;margin-right:8px;animation:lkPop .4s cubic-bezier(.2,1.6,.4,1)}
      @keyframes lkPop{from{transform:scale(0)}}
      @media (prefers-reduced-motion:reduce){.lk-arrive *,.lk-arrive{animation:none!important}.lk-card{opacity:1;position:static;display:inline-block;margin:2px;transform:none}}`;
    document.head.append(css);
    const layer = document.createElement('div');
    layer.className = 'lk-arrive';
    layer.innerHTML = `<div class="lk-stage">
        <div class="lk-end"><span class="lk-tile a">LK</span>LearnKyrgyz</div>
        <div class="lk-path">${names.slice(0, 6).map((n, i) => `<span class="lk-card" style="--i:${i}">${esc(n)}</span>`).join('')}<i class="lk-beam"></i></div>
        <div class="lk-end"><span class="lk-tile b">Q</span>Quoldek</div></div>
      <div class="lk-msg">Bringing your topics into Quoldek…</div>
      <div class="lk-sub">${window.OneInTwo && OneInTwo.user() ? 'Signed in as ' + esc(OneInTwo.user().name) + ' · one account' : 'From LearnKyrgyz'}</div>`;
    document.body.append(layer);
    return {
      done(title) { layer.querySelector('.lk-msg').innerHTML = `<span class="lk-check">✓</span>“${esc(title)}” is ready`; },
      fail(msg) { layer.querySelector('.lk-msg').textContent = msg; layer.querySelector('.lk-sub').innerHTML = '<a href="?" style="color:#fff">Back to Quoldek</a>'; },
      close() { layer.classList.add('bye'); setTimeout(() => layer.remove(), 600); }
    };
  }
  async function arrive({ topics, lang, go, count }) {
    const started = Date.now();
    let names = topics;
    try { const idx = await getIndex(); names = topics.map(id => (idx.topics.find(t => t.id === id) || {}).title?.[lang] || id); } catch { /* names stay as ids */ }
    const layer = arrivalLayer(names);
    let quiz;
    try { quiz = await makeQuiz({ topics, lang, count }); }
    catch (err) { layer.fail(err.message); return; }
    history.replaceState(null, '', location.pathname);            // a reload must not make it twice
    await new Promise(r => setTimeout(r, Math.max(0, 1600 - (Date.now() - started))));   // let the cards land
    layer.done(quiz.title);
    await new Promise(r => setTimeout(r, 700));
    if (go === 'studio') { location.href = studioUrl(quiz.id); return; }
    if (go === 'take') { location.href = takeUrl(quiz.id); return; }
    layer.close();
    if (typeof window.load === 'function') window.load();
    if (typeof window.hostGame === 'function') window.hostGame(quiz); else location.href = studioUrl(quiz.id);
  }

  Nova.learnKyrgyz = { openPicker, makeQuiz, arrive, bank: BANK };

  // ?learnkyrgyz=… opens the picker with those topics chosen; with &go=… it just makes the quiz.
  document.addEventListener('DOMContentLoaded', () => {
    const p = new URLSearchParams(location.search);
    if (!p.has('learnkyrgyz')) return;
    const topics = p.get('learnkyrgyz').split(',').map(s => s.trim()).filter(s => /^[a-z0-9_-]+$/i.test(s)).slice(0, 50);
    const lang = p.get('lang') === 'ru' ? 'ru' : 'en';
    const go = ['host', 'studio', 'take'].includes(p.get('go')) ? p.get('go') : null;
    if (!topics.length) return;
    // someone arriving to play goes straight to the game, not to the release screen
    if (go && window.NovaLaunch && typeof NovaLaunch.markSeen === 'function') { try { NovaLaunch.markSeen(); } catch { /* storage off */ } }
    // let OneInTwo pick up the account first, so the new quiz is saved to it
    if (go) setTimeout(() => arrive({ topics, lang, go, count: Math.min(60, Math.max(5, +p.get('n') || 20)) }), 50);
    else openPicker({ topics, lang });
  });
})(window.Nova);
