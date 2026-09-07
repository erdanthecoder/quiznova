/* The whole site, served from this computer.
 *
 * Same pages as the website and the same API as the Flask edition, so nothing
 * in static/ has to know which of the three it is running under. What is
 * different is where it runs: on the teacher's laptop, on the school's wifi,
 * with no internet involved at any point.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const { Store, newQuiz, rid, now } = require('./store.js');
const { applyOps } = require('./ops.js');
const { Games, rules: R } = require('./games.js');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

/* The address a phone should be told to type. A laptop has several — a loopback
 * nobody else can reach, sometimes a virtual adapter — so pick the ordinary
 * wired or wireless one on a private network, which is what the room is on. */
function lanAddress() {
  const nets = os.networkInterfaces();
  const found = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const priv = /^10\./.test(a.address) || /^192\.168\./.test(a.address) ||
                   /^172\.(1[6-9]|2\d|3[01])\./.test(a.address);
      found.push({ name, address: a.address, priv });
    }
  }
  found.sort((a, b) => (b.priv - a.priv) || a.name.localeCompare(b.name));
  return found.length ? found[0].address : '127.0.0.1';
}

class Server {
  constructor({ root, dataDir, port = 0, appRoot = null, settings = null }) {
    this.root = root;                       // where static/ lives
    this.appRoot = appRoot;                 // the app's own pages, when running as one
    this.settings = settings;               // what the teacher chose, read at request time
    this.store = new Store(path.join(dataDir, 'quizzes'));
    this.games = new Games();
    this.wantedPort = port;
    this.presence = new Map();
    this.server = http.createServer((req, res) => this.route(req, res));
    // the clock: a question can run out with nobody having answered
    this.timer = setInterval(() => {
      for (const game of this.games.games.values()) this.games.tick(game);
    }, 500);
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.wantedPort, '0.0.0.0', () => {
        this.port = this.server.address().port;
        resolve({ port: this.port, address: lanAddress() });
      });
    });
  }

  close() { clearInterval(this.timer); return new Promise(r => this.server.close(r)); }

  get joinUrl() { return `http://${lanAddress()}:${this.port}/play`; }

  /* ── plumbing ──────────────────────────────────────── */
  send(res, code, body, type = 'application/json; charset=utf-8') {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store',
                          'Access-Control-Allow-Origin': '*' });
    res.end(data);
  }

  fail(res, code, message) { this.send(res, code, { error: message }); }

  body(req) {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', c => { data += c; if (data.length > 4e6) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  }

  /* Server-sent events: the board and every phone hold one of these open and are
   * told the moment anything changes, rather than asking over and over. */
  stream(req, res, pin) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
                         Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const write = (event, data) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* gone */ }
    };
    const game = this.games.get(pin);
    write('hello', game ? this.games.publicView(game) : { error: 'gone' });
    const stop = this.games.watch(pin, view => write('game:state', view));
    const beat = setInterval(() => { try { res.write(': beat\n\n'); } catch { /* gone */ } }, 20000);
    req.on('close', () => { clearInterval(beat); stop(); });
  }

  async route(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return this.fail(res, 400, 'bad url'); }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*',
                           'Access-Control-Allow-Headers': 'content-type',
                           'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' });
      return res.end();
    }
    const p = url.pathname;
    try {
      if (p.startsWith('/api/')) return await this.api(req, res, p.slice(4), url);
      // the app's own pages, which the website never has
      if (this.appRoot && p.startsWith('/app/')) return this.file(res, p.slice(4), this.appRoot);
      return this.file(res, p);
    } catch (err) {
      return this.fail(res, err.status || 500, err.message || 'Something went wrong.');
    }
  }

  /* ── the pages ─────────────────────────────────────── */
  file(res, p, root) {
    root = root || this.root;
    const pretty = { '/': 'quiznova.html', '/quiz': 'quiznova.html', '/studio': 'studio.html',
                     '/take': 'take.html', '/host': 'host.html', '/play': 'play.html' };
    let name = (root === this.root ? pretty[p.replace(/\/$/, '') || '/'] : null) || p.slice(1);
    if (!name) name = 'quiznova.html';
    // nothing outside the folder being served, whatever the request says
    const full = path.join(root, path.normalize(name).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(root)) return this.fail(res, 403, 'no');
    fs.readFile(full, (err, data) => {
      if (err) return this.send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      const type = TYPES[path.extname(full)] || 'application/octet-stream';
      // A page has to know the address a phone can reach, and it reads that the
      // moment its script runs — so it is put in here rather than handed over
      // afterwards by the app, which would always be a beat too late.
      if (type.startsWith('text/html') && root === this.root) {
        const where = `${lanAddress()}:${this.port}`;
        const inject = '<script src="/desktop.js" defer></script>\n<script>\n'
          + `window.QUOLDEK_JOIN = ${JSON.stringify('http://' + where + '/play?pin=')};\n`
          + 'window.QUOLDEK_LIVE = \'\';\n'
          + 'window.QUOLDEK_LOCAL = true;\n'
          // read now, not at start-up, so turning music off in Settings takes
          // effect on the next board without restarting the app
          + `window.QUOLDEK_MUSIC = ${this.settings ? !!this.settings.values.music : true};\n`
          + '</script>';
        return this.send(res, 200, String(data).replace('</head>', inject + '</head>'), type);
      }
      this.send(res, 200, data, type);
    });
  }

  /* ── the API, matching the Flask edition ───────────── */
  async api(req, res, p, url) {
    const method = req.method;
    const body = method === 'GET' ? {} : await this.body(req);
    const seg = p.split('/').filter(Boolean);

    if (p === '/status') {
      return this.send(res, 200, { storage: 'files', durable: true, ai: false,
                                   quizzes: Object.keys(this.store.all()).length,
                                   liveGames: this.games.games.size, desktop: true,
                                   joinUrl: this.joinUrl, port: this.port });
    }
    if (p === '/modes') {
      return this.send(res, 200, { modes: Object.entries(R.MODES).map(([id, m]) =>
        Object.assign({ id, maps: R.mapsFor(id) }, m)) });
    }
    if (p === '/ai/status') return this.send(res, 200, { live: false, model: '' });

    // ── quizzes
    if (seg[0] === 'quizzes' && seg.length === 1) {
      if (method === 'GET') {
        const list = Object.values(this.store.all())
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .map(q => ({ id: q.id, title: q.title, description: q.description, owner: q.owner,
                       theme: q.theme, updatedAt: q.updatedAt, createdAt: q.createdAt,
                       questions: q.questions.length }));
        return this.send(res, 200, { quizzes: list });
      }
      if (method === 'POST') {
        const quiz = newQuiz(body.title, body.owner);
        if (body.starter !== false) quiz.questions = [require('./store.js').blankQuestion('mc')];
        this.store.save(quiz);
        return this.send(res, 201, quiz);
      }
    }

    /* ── the quiz folder, and an account that has its own copy ──
     *
     * Signing in makes the quizzes follow you: what is written here should be
     * on the website and on the next computer, and what was written there
     * should be here. The merge happens on this side because this is where the
     * folder is — a browser cannot read it, and doing it in two places is how
     * two copies of a merge drift apart.
     *
     * Neither side is the master. The same quiz edited in two places keeps
     * whichever was edited last, which is the only answer that never silently
     * throws away somebody's work.
     */
    if (seg[0] === 'sync' && method === 'POST') {
      const theirs = Array.isArray(body.quizzes) ? body.quizzes : [];
      const mine = this.store.all();
      let pulled = 0;
      for (const q of theirs) {
        if (!q || typeof q.id !== 'string' || !Array.isArray(q.questions)) continue;
        const here = mine[q.id];
        if (!here || (q.updatedAt || 0) > (here.updatedAt || 0)) {
          this.store.save(q);
          pulled++;
        }
      }
      // whatever the folder holds now is what should go up
      return this.send(res, 200, { pulled, quizzes: Object.values(this.store.all()) });
    }

    if (seg[0] === 'quizzes' && seg.length >= 2) {
      const quiz = this.store.get(seg[1]);
      if (!quiz) return this.fail(res, 404, 'That quiz is not here.');

      if (seg.length === 2) {
        if (method === 'GET') return this.send(res, 200, quiz);
        if (method === 'DELETE') { this.store.remove(quiz.id); return this.send(res, 200, { ok: true }); }
        if (method === 'PATCH') {
          for (const key of ['title', 'description', 'theme', 'owner']) {
            if (key in body) quiz[key] = body[key];
          }
          if (body.settings && typeof body.settings === 'object') Object.assign(quiz.settings, body.settings);
          if (Array.isArray(body.questions)) quiz.questions = body.questions;
          this.store.save(quiz);
          return this.send(res, 200, quiz);
        }
      }

      if (seg[2] === 'ops' && method === 'POST') {
        const log = applyOps(quiz, body.ops || []);
        this.store.save(quiz);
        return this.send(res, 200, { quiz, log });
      }
      if (seg[2] === 'presence' && method === 'POST') {
        const client = body.clientId || rid(6);
        const room = this.presence.get(quiz.id) || new Map();
        room.set(client, now());
        for (const [id, at] of room) if (now() - at > 15000) room.delete(id);
        this.presence.set(quiz.id, room);
        return this.send(res, 200, { editors: room.size });
      }
      if (seg[2] === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
                             Connection: 'keep-alive' });
        res.write(`event: hello\ndata: ${JSON.stringify({ quiz })}\n\n`);
        const beat = setInterval(() => { try { res.write(': beat\n\n'); } catch { /* gone */ } }, 20000);
        req.on('close', () => clearInterval(beat));
        return;
      }
    }

    // ── live games
    if (p === '/games' && method === 'POST') {
      const quiz = this.store.get(body.quizId);
      if (!quiz) return this.fail(res, 404, 'That quiz is not here.');
      if (!quiz.questions.length) return this.fail(res, 400, 'Add at least one question first.');
      const game = this.games.create(quiz, body);
      return this.send(res, 201, { pin: game.pin, hostToken: game.hostToken, mode: game.mode,
                                   quizTitle: quiz.title, total: game.questions.length });
    }

    if (seg[0] === 'games' && seg[1]) {
      const game = this.games.get(seg[1]);
      if (!game) return this.fail(res, 404, 'That game code is not live.');
      const tail = seg[2];
      const isHost = !tail || body.hostToken === game.hostToken;

      if (!tail && method === 'GET') return this.send(res, 200, this.games.publicView(game));
      if (tail === 'events') return this.stream(req, res, game.pin);
      if (tail === 'join' && method === 'POST') {
        const player = this.games.join(game, body);
        return this.send(res, 200, { player, game: this.games.publicView(game) });
      }
      if (tail === 'answer' && method === 'POST') {
        const player = this.games.answer(game, body);
        return this.send(res, 200, { correct: player.correct, score: player.score, hp: player.hp,
                                     streak: player.streak, state: game.state,
                                     distance: player.distance, blocks: player.blocks,
                                     coins: player.coins, chest: player.chest,
                                     balloons: player.balloons, hits: player.hits,
                                     gain: player.lastGain });
      }
      if (tail === 'team' && method === 'POST') {
        const player = game.players[body.playerId];
        if (player && game.state === 'lobby') {
          player.team = player.team === 'red' ? 'blue' : 'red';
          this.games.changed(game);
        }
        return this.send(res, 200, { ok: true });
      }
      if (tail === 'score' && method === 'POST') {
        const player = game.players[body.playerId];
        if (player) { player.score = Math.max(0, Math.round(Number(body.score) || 0)); this.games.changed(game); }
        return this.send(res, 200, { ok: true });
      }
      if (tail === 'target' && method === 'POST') {
        const player = game.players[body.playerId];
        if (player) player.target = String(body.target || '');
        return this.send(res, 200, { ok: true });
      }

      // everything past here is the teacher's alone
      if (!isHost) return this.fail(res, 403, 'Only the host can control the game.');
      if (tail === 'start' && method === 'POST') return this.send(res, 200, this.games.start(game));
      if (tail === 'next' && method === 'POST') return this.send(res, 200, this.games.next(game));
      if (tail === 'tick' && method === 'POST') { this.games.tick(game); return this.send(res, 200, this.games.publicView(game)); }
      if (tail === 'end' && method === 'POST') { this.games.end(game); return this.send(res, 200, this.games.publicView(game)); }
    }

    return this.fail(res, 404, 'No such thing here.');
  }
}

module.exports = { Server, lanAddress };
