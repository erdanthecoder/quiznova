/* The bits that only make sense in the Windows app.
 *
 * The pages are the same ones the website serves; this adds what a desktop can
 * do and a browser tab cannot — telling the room the address to type, saving a
 * quiz as a file, opening the board on the projector. It does nothing at all
 * unless the app is what is running the page, so the website is untouched.
 */
(function (global) {
  'use strict';
  const Q = global.Quoldek;
  if (!Q || !Q.desktop) return;

  const Nova = global.Nova;

  /* ── what a game needs, and writing does not ───────────
   *
   * Since 4.0 a live game in the app runs over the internet — the same games
   * the website runs, so a class can join from anywhere rather than only from
   * the school's own wifi. That means no connection is no game.
   *
   * Writing questions is the exception, and deliberately so: that is the job
   * somebody does at a kitchen table on a Sunday, and it should not need the
   * internet to be reachable. So the studio, the folder and the quiz list all
   * carry on working, and only the things that need other devices go quiet —
   * greyed rather than removed, with a line saying why, because a button that
   * has vanished tells nobody anything.
   */
  function gateGames() {
    const off = !global.navigator.onLine;
    document.documentElement.toggleAttribute('data-offline', off);

    if (!document.getElementById('desk-offline-style')) {
      const css = document.createElement('style');
      css.id = 'desk-offline-style';
      css.textContent =
        'html[data-offline] [data-act="host"],' +
        'html[data-offline] .nav[data-go="join"],' +
        'html[data-offline] #present{opacity:.42;pointer-events:none;filter:grayscale(1)}' +
        '.desk-offline-note{position:fixed;left:0;right:0;bottom:0;z-index:60;padding:9px 16px;' +
        'font:600 13px/1.4 -apple-system,"Segoe UI",system-ui,sans-serif;text-align:center;' +
        'background:#3A1420;color:#FFD9DF;border-top:2px solid #F4364C}';
      document.head.append(css);
    }

    let note = document.querySelector('.desk-offline-note');
    if (off && !note) {
      note = document.createElement('div');
      note.className = 'desk-offline-note';
      note.textContent = 'No connection — you can still write questions. '
                       + 'Live games need the internet, so a class can join from anywhere.';
      document.body.append(note);
    } else if (!off && note) {
      note.remove();
    }
  }

  global.addEventListener('online', gateGames);
  global.addEventListener('offline', gateGames);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', gateGames);
  else gateGames();

  /* The address everyone types, always on screen. In a browser this would be a
   * nuisance; on the teacher's own machine it is the one thing they are asked
   * for over and over in the first two minutes of a lesson. */
  function joinBar(info) {
    if (document.getElementById('deskbar')) return;
    const bar = document.createElement('div');
    bar.id = 'deskbar';
    bar.innerHTML =
      '<span class="lbl">Everyone joins at</span>' +
      `<code>${Nova.esc(info.url)}</code>` +
      '<button class="copy" type="button">Copy</button>' +
      '<span class="hint">same wifi · no internet needed</span>';
    document.body.append(bar);
    bar.querySelector('.copy').onclick = async (e) => {
      try { await navigator.clipboard.writeText(info.url); } catch { /* no clipboard */ }
      e.target.textContent = 'Copied';
      setTimeout(() => { e.target.textContent = 'Copy'; }, 1600);
    };
  }

  /* Saving a quiz as a file, and opening the folder they are all in. Quizzes in
   * a browser live somewhere a teacher cannot get at; here they are files. */
  function fileButtons() {
    const top = document.querySelector('.topbar-inner');
    if (!top || document.getElementById('desk-files')) return;
    const wrap = document.createElement('span');
    wrap.id = 'desk-files';
    wrap.style.display = 'contents';

    const openFolder = document.createElement('button');
    openFolder.className = 'btn sm';
    openFolder.textContent = 'Quiz folder';
    openFolder.title = 'Every quiz is a file in here';
    openFolder.onclick = () => Q.openQuizFolder();

    const importFile = document.createElement('button');
    importFile.className = 'btn sm';
    importFile.textContent = 'Open a file';
    importFile.title = 'Import a quiz saved as a file';
    importFile.onclick = async () => {
      const { imported } = await Q.importQuizFile();
      Nova.toast(imported ? `Imported ${imported} quiz${imported === 1 ? '' : 'zes'}` : 'Nothing imported',
                 imported ? 'good' : 'bad');
    };

    wrap.append(openFolder, importFile);
    const anchor = document.getElementById('top-new');
    top.insertBefore(wrap, anchor || null);
  }

  /* A quiz card gets a Save-as, since the point of files is being able to move
   * one to a memory stick or send it to the teacher next door. */
  function exportButtons() {
    const grid = document.getElementById('grid');
    if (!grid) return;
    const add = () => {
      for (const card of grid.querySelectorAll('.quiz-card[data-id]')) {
        if (card.querySelector('.desk-save')) continue;
        const row = card.querySelector('.acts');
        if (!row) continue;
        const save = document.createElement('button');
        save.className = 'btn sm ghost desk-save';
        save.textContent = 'Save as…';
        save.onclick = async (e) => {
          e.preventDefault(); e.stopPropagation();
          const { saved } = await Q.exportQuiz(card.dataset.id);
          if (saved) Nova.toast('Saved', 'good');
        };
        row.append(save);
      }
    };
    add();
    new MutationObserver(add).observe(grid, { childList: true });
  }

  const style = document.createElement('style');
  style.textContent = `
#deskbar{position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;align-items:center;gap:12px;
  padding:9px 16px;background:var(--card);border-top:2px solid var(--line);
  box-shadow:0 -6px 20px -12px rgba(0,0,0,.5);font-size:.86rem}
#deskbar .lbl{font-weight:700;color:var(--muted)}
#deskbar code{font-family:ui-monospace,Consolas,monospace;font-weight:700;font-size:.95rem;
  padding:4px 10px;border-radius:8px;background:rgba(127,127,127,.16);user-select:all}
#deskbar .copy{font:inherit;font-weight:700;font-size:.8rem;padding:5px 12px;border-radius:99px;
  border:2px solid var(--line);background:transparent;color:inherit;cursor:pointer}
#deskbar .hint{margin-left:auto;color:var(--faint);font-size:.76rem}
body{padding-bottom:52px}
.desk-save{margin-left:auto}
`;
  document.head.append(style);

  const start = async () => {
    try {
      const info = await Q.joinInfo();
      const settings = await Q.settings.read();
      if (settings.showJoinBar !== false) joinBar(info);
    } catch { /* the pages work without any of this */ }
    fileButtons();
    exportButtons();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
