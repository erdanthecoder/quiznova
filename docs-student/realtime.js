/* A live connection to the game, so devices are told about changes instead of asking.
 *
 * Supabase Realtime speaks the Phoenix channel protocol over a websocket. We only
 * need one thing from it: a nudge saying "this game changed". The nudge is never
 * trusted for content — the page still reads the game over REST, which stays the
 * single source of truth. That keeps this file harmless if the protocol ever
 * shifts under us: the worst case is no nudges, and the poller carries on alone.
 */
(function (global) {
  'use strict';

  const HOST = 'blkwilonabowayxefxpx.supabase.co';
  const KEY = 'sb_publishable_GT9kBg_L8Y2rT4n2DybBQA_nO93VP-4';
  const TABLES = ['quiznova_live_games', 'quiznova_live_players', 'quiznova_live_answers'];

  const HEARTBEAT = 25000;      // Realtime hangs up after 60s of silence
  const JOIN_TIMEOUT = 6000;    // if the join has not landed by now, assume polling
  const BACKOFF = [1000, 2000, 5000, 10000, 20000];

  /**
   * watch(pin, onChange, onStatus, onBroadcast) → { close, send }
   *   onChange()              a row changed; read the game again
   *   onStatus('live'|'off')  whether the connection is carrying anything
   *   onBroadcast(event, payload)  a message from another device on this game
   *
   * Broadcast is how the Laser Tag arena moves: thirty children sending their
   * position ten times a second is far too much to write to a database, and none
   * of it is worth keeping once the round is over. It goes device to device
   * through the same socket and never lands in a table.
   */
  function watch(pin, onChange, onStatus, onBroadcast) {
    let ws = null, closed = false, attempt = 0, beat = null, joinTimer = null, live = false, msgRef = 1;

    const setLive = (value) => {
      if (live === value) return;
      live = value;
      try { onStatus && onStatus(value ? 'live' : 'off'); } catch { /* caller's problem */ }
    };

    const cleanup = () => {
      clearInterval(beat); clearTimeout(joinTimer);
      beat = joinTimer = null;
      if (ws) { try { ws.onclose = null; ws.close(); } catch { /* already gone */ } }
      ws = null;
      setLive(false);
    };

    const retry = () => {
      cleanup();
      if (closed) return;
      const wait = BACKOFF[Math.min(attempt++, BACKOFF.length - 1)];
      setTimeout(connect, wait);
    };

    function connect() {
      if (closed) return;
      let socket;
      try {
        socket = new WebSocket(`wss://${HOST}/realtime/v1/websocket?apikey=${KEY}&vsn=1.0.0`);
      } catch { return retry(); }
      ws = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({
          topic: 'realtime:quiznova-' + pin,
          event: 'phx_join',
          ref: '1',
          payload: {
            config: {
              broadcast: { self: false, ack: false },
              presence: { key: '' },
              postgres_changes: TABLES.map(table => ({
                event: '*', schema: 'public', table, filter: 'pin=eq.' + pin
              }))
            }
          }
        }));
        beat = setInterval(() => {
          try { socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(Date.now()) })); }
          catch { retry(); }
        }, HEARTBEAT);
        // a socket that opens but never joins is no use; fall back rather than hang
        joinTimer = setTimeout(() => { if (!live) retry(); }, JOIN_TIMEOUT);
      };

      socket.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }
        if (msg.event === 'phx_reply' && msg.payload && msg.payload.status === 'ok') {
          attempt = 0;
          setLive(true);
          return;
        }
        if (msg.event === 'phx_error' || msg.event === 'phx_close') return retry();
        // any row change on this game is the same message to us: read it again
        if (msg.event === 'postgres_changes') { try { onChange(); } catch { /* caller's problem */ } }
        if (msg.event === 'broadcast' && onBroadcast && msg.payload) {
          try { onBroadcast(msg.payload.event, msg.payload.payload); } catch { /* caller's problem */ }
        }
      };

      socket.onerror = () => { /* onclose follows */ };
      socket.onclose = () => { if (!closed) retry(); };
    }

    connect();
    return {
      close() { closed = true; cleanup(); },
      /** Send a message to every other device on this game. Dropped if not connected. */
      send(event, payload) {
        if (!live || !ws) return false;
        try {
          ws.send(JSON.stringify({ topic: 'realtime:quiznova-' + pin, event: 'broadcast',
                                   ref: String(++msgRef),
                                   payload: { type: 'broadcast', event, payload } }));
          return true;
        } catch { return false; }
      }
    };
  }

  global.NovaRealtime = { watch, available: typeof WebSocket !== 'undefined' };
})(typeof window !== 'undefined' ? window : globalThis);
