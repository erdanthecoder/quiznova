/* Quoldek shared runtime: tiny DOM helpers, API client, realtime stream. */
(function (global) {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
    }
    kids.flat().forEach((kid) => node.append(kid?.nodeType ? kid : document.createTextNode(kid)));
    return node;
  };

  const qs = (key, fallback = '') => new URLSearchParams(location.search).get(key) || fallback;

  const store = {
    get(key, fallback = null) {
      try { const raw = localStorage.getItem('nova:' + key); return raw ? JSON.parse(raw) : fallback; }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('nova:' + key, JSON.stringify(value)); } catch { /* private mode */ }
    },
    del(key) { try { localStorage.removeItem('nova:' + key); } catch { /* ignore */ } }
  };

  async function api(path, options = {}) {
    const opts = { headers: {}, ...options };
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch('/api' + path, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
    if (!res.ok) throw Object.assign(new Error(data?.error || res.statusText), { status: res.status, data });
    return data;
  }

  /* Realtime: SSE with an automatic polling fallback so it works behind any proxy. */
  function stream(path, onMessage, pollPath) {
    let source = null;
    let poll = null;
    let alive = true;

    const startPolling = () => {
      if (poll || !pollPath) return;
      poll = setInterval(async () => {
        try { onMessage({ event: 'poll', data: await api(pollPath) }); } catch { /* keep trying */ }
      }, 1500);
    };

    try {
      source = new EventSource('/api' + path);
      source.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }   // heartbeat or comment
        // Errors thrown while rendering must not kill the stream, but swallowing
        // them silently turns a bug into a blank screen — report and carry on.
        try { onMessage(msg); }
        catch (err) { console.error('[nova] realtime handler failed:', err); }
      };
      source.onerror = () => { if (alive) startPolling(); };
    } catch { startPolling(); }

    return {
      close() {
        alive = false;
        if (source) source.close();
        if (poll) clearInterval(poll);
      }
    };
  }

  function toast(message, kind = '') {
    let host = $('#toasts');
    if (!host) { host = el('div', { id: 'toasts' }); document.body.append(host); }
    const node = el('div', { class: 'toast ' + kind }, message);
    host.append(node);
    setTimeout(() => {
      node.style.transition = 'opacity .3s, transform .3s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(10px)';
      setTimeout(() => node.remove(), 320);
    }, 2800);
  }

  function modal(html, { onMount, wide } = {}) {
    const overlay = el('div', { class: 'overlay' });
    const box = el('div', { class: 'modal' + (wide ? ' wide' : ''), html });
    overlay.append(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    function close() { document.removeEventListener('keydown', onKey); overlay.remove(); }
    document.body.append(overlay);
    onMount?.(box, close);
    return close;
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'good'); }
    catch { toast('Copy failed. Select the link and copy it.', 'bad'); }
  }

  /* Google Classroom share — the official share endpoint. */
  const classroomUrl = (url, title, body) =>
    'https://classroom.google.com/share?url=' + encodeURIComponent(url) +
    (title ? '&title=' + encodeURIComponent(title) : '') +
    (body ? '&body=' + encodeURIComponent(body) : '');

  function confetti(count = 90) {
    const colours = ['#7c5cff', '#22d3ee', '#34e0a1', '#ffc857', '#ff5d8f'];
    const layer = el('div', { style: 'position:fixed;inset:0;pointer-events:none;z-index:500;overflow:hidden' });
    document.body.append(layer);
    for (let i = 0; i < count; i++) {
      const bit = el('div', {
        style: `position:absolute;top:-14px;left:${Math.random() * 100}%;width:${6 + Math.random() * 7}px;
                height:${9 + Math.random() * 9}px;background:${colours[i % colours.length]};
                border-radius:${Math.random() > .5 ? '50%' : '2px'};opacity:.95;`
      });
      layer.append(bit);
      bit.animate([
        { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
        { transform: `translateY(${window.innerHeight + 70}px) rotate(${Math.random() * 900 - 450}deg)`, opacity: .85 }
      ], { duration: 1900 + Math.random() * 1500, easing: 'cubic-bezier(.2,.6,.4,1)', delay: Math.random() * 450 });
    }
    setTimeout(() => layer.remove(), 4200);
  }

  const SHAPES = [
    '<svg class="shape" viewBox="0 0 24 24" fill="var(--c)"><path d="M12 2 2 22h20z"/></svg>',
    '<svg class="shape" viewBox="0 0 24 24" fill="var(--c)"><circle cx="12" cy="12" r="10"/></svg>',
    '<svg class="shape" viewBox="0 0 24 24" fill="var(--c)"><rect x="2" y="2" width="20" height="20" rx="3"/></svg>',
    '<svg class="shape" viewBox="0 0 24 24" fill="var(--c)"><path d="M12 1 23 12 12 23 1 12z"/></svg>',
    '<svg class="shape" viewBox="0 0 24 24" fill="var(--c)"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg>',
    '<svg class="shape" viewBox="0 0 24 24" fill="var(--c)"><path d="M12 21s-8-5.1-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.9-8 11-8 11z"/></svg>'
  ];

  const fmtTime = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const ago = (ts) => {
    if (!ts) return '';
    const secs = Math.round((Date.now() - ts) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
  };

  /* Per-tab, not per-browser: two tabs open on the same quiz must see each other's edits. */
  const clientId = (() => {
    let id = null;
    try { id = sessionStorage.getItem('nova:clientId'); } catch { /* private mode */ }
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      try { sessionStorage.setItem('nova:clientId', id); } catch { /* ignore */ }
    }
    return id;
  })();

  global.Nova = { $, $$, el, esc, qs, api, stream, toast, modal, copy, store, confetti,
                  classroomUrl, SHAPES, fmtTime, ago, clientId };
})(window);
