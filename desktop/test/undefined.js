/* Names that are used and never defined.
 *
 * Three bugs in a row came from exactly this, and one of them took the live
 * site down for days:
 *
 *   · live.js read TRACK_LENGTH in publicView. The constant went with the
 *     racing mode when fourteen modes were cut to four; the reference did not.
 *     Because it was a bare name rather than a property it threw a
 *     ReferenceError on every read of a game, so every board on the live site
 *     sat on "Reconnecting…" for ever — reconnecting to a game it could see
 *     perfectly well.
 *   · host.html called stopRun() after a block replacement removed it, which
 *     blanked the whole board.
 *   · play.html called bladeCard() for the same reason.
 *
 * Every one of them is invisible until the line runs, and the line that ran was
 * in front of a class. A first attempt at this used regular expressions and was
 * useless — object methods, getters and the CSS inside template strings all
 * look like calls — so it parses properly and walks the scopes, which is the
 * only way to answer "is this name in scope here" without guessing.
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const ROOT = path.join(__dirname, '..', '..');
let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) { fails++; console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`); }
                          else console.log(`ok    ${n}${d ? '  — ' + d : ''}`); };

/* Everything a browser hands you, plus what this project puts on the window.
 * A name here may be used without being declared in the file that uses it. */
const GLOBALS = new Set([
  'window', 'document', 'console', 'location', 'history', 'navigator', 'screen',
  'fetch', 'Response', 'Request', 'Headers', 'URL', 'URLSearchParams', 'FormData',
  'localStorage', 'sessionStorage', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Error', 'TypeError', 'RangeError',
  'Symbol', 'Proxy', 'Reflect', 'BigInt', 'Intl', 'globalThis', 'structuredClone',
  'Image', 'Audio', 'Blob', 'File', 'FileReader', 'ImageData', 'Path2D', 'OffscreenCanvas',
  'AudioContext', 'webkitAudioContext', 'EventSource', 'WebSocket', 'XMLHttpRequest',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'CustomEvent', 'Event',
  'DOMParser', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'crypto', 'performance',
  'indexedDB', 'IDBKeyRange', 'DataTransfer',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'scrollTo', 'scrollBy',
  'matchMedia', 'getComputedStyle', 'open', 'close', 'focus', 'blur', 'print',
  'alert', 'confirm', 'prompt', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'NaN',
  'Infinity', 'undefined', 'require', 'module', 'exports', 'process', 'Buffer',
  '__dirname', '__filename', 'global', 'arguments', 'self', 'top', 'parent',
  'getComputedStyle', 'matchMedia', 'devicePixelRatio', 'innerWidth', 'innerHeight',
  'CSS', 'escape', 'unescape',
  'scrollTo', 'open', 'close', 'print', 'Node', 'Element', 'HTMLElement', 'Notification',
  // what the project itself hangs on the window
  'Nova', 'NovaRules', 'NovaLive', 'NovaArena', 'NovaStrike', 'NovaRun', 'NovaTower',
  'NovaMusic', 'NovaAccount', 'NovaProgress', 'NovaLaunch', 'NovaBoards', 'NovaQR',
  'NovaBank', 'NovaPaste', 'NovaRealtime', 'Sprite', 'QuizBank', 'QR',
  'QUOLDEK_LIVE', 'QUOLDEK_LOCAL', 'QUOLDEK_JOIN', 'QUOLDEK_MUSIC', 'QUOLDEK_HUB'
]);

/** The inline script of a page, or the whole of a plain script. */
function codeOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (!file.endsWith('.html')) return src;
  // only real script blocks: a page also carries JSON-LD, which is not code
  return [...src.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(m => !/\bsrc=/.test(m[1])
              && !/type=["'](?!text\/javascript|module)/.test(m[1]))
    .map(m => m[2]).join('\n;\n');
}

/** Every name a pattern binds: plain, destructured, defaulted, rest. */
function bind(node, into) {
  if (!node) return;
  if (node.type === 'Identifier') into.add(node.name);
  else if (node.type === 'ObjectPattern') node.properties.forEach(p =>
    bind(p.type === 'RestElement' ? p.argument : p.value, into));
  else if (node.type === 'ArrayPattern') node.elements.forEach(e => bind(e, into));
  else if (node.type === 'AssignmentPattern') bind(node.left, into);
  else if (node.type === 'RestElement') bind(node.argument, into);
}

/* A scope is a set of names and a parent. Function declarations and `var`
   hoist to the nearest function; `let`, `const` and `class` stay in the block. */
function scopesOf(ast) {
  const scopes = new Map();                       // node -> { names, parent, fn }
  const make = (node, parent, fn) => {
    const s = { names: new Set(), parent, fn: !!fn };
    scopes.set(node, s);
    return s;
  };
  const root = make(ast, null, true);

  const isFn = (n) => /Function(Declaration|Expression)|ArrowFunctionExpression/.test(n.type);
  const isBlock = (n) => n.type === 'BlockStatement' || n.type === 'Program'
                      || n.type === 'ForStatement' || n.type === 'ForOfStatement'
                      || n.type === 'ForInStatement' || n.type === 'SwitchStatement';

  (function visit(node, chain) {
    if (!node || typeof node.type !== 'string') return;
    /* The scope a declaration lands in is the one around this node, not the one
       this node opens. A function declaration's own name belongs to its parent:
       registering it inside itself made every function in the project look
       undefined to its callers. */
    const outer = chain;
    let here = chain;

    if (isFn(node)) {
      here = make(node, chain, true);
      node.params.forEach(p => bind(p, here.names));
      if (node.id && node.type === 'FunctionExpression') here.names.add(node.id.name);
    } else if (isBlock(node) && node.type !== 'Program') {
      here = make(node, chain, false);
    } else if (node.type === 'CatchClause') {
      here = make(node, chain, false);
      bind(node.param, here.names);
    }

    // declarations land in this scope (or the nearest function, for var)
    if (node.type === 'VariableDeclaration') {
      let target = here;
      if (node.kind === 'var') { while (target && !target.fn) target = target.parent; }
      node.declarations.forEach(d => bind(d.id, (target || here).names));
    }
    if (node.type === 'FunctionDeclaration' && node.id) {
      let target = outer;
      while (target && !target.fn) target = target.parent;
      (target || outer).names.add(node.id.name);
    }
    if (node.type === 'ClassDeclaration' && node.id) outer.names.add(node.id.name);

    for (const key of Object.keys(node)) {
      const kid = node[key];
      if (Array.isArray(kid)) kid.forEach(k => visit(k, here));
      else if (kid && typeof kid.type === 'string') visit(kid, here);
    }
  })(ast, root);

  return { scopes, root };
}

function unresolved(code) {
  const ast = acorn.parse(code, { ecmaVersion: 2023, allowReturnOutsideFunction: true,
                                  allowAwaitOutsideFunction: true });
  const { scopes, root } = scopesOf(ast);

  /* Hoisting means a name declared anywhere in a scope is visible throughout
     it, so the whole tree is collected before anything is resolved. */
  const chainOf = (node, stack) => {
    for (let i = stack.length - 1; i >= 0; i--) if (scopes.has(stack[i])) return scopes.get(stack[i]);
    return root;
  };
  const inScope = (name, scope) => {
    for (let s = scope; s; s = s.parent) if (s.names.has(name)) return true;
    return false;
  };

  const missing = new Map();
  walk.ancestor(ast, {
    Identifier(node, _state, ancestors) {
      const parent = ancestors[ancestors.length - 2];
      if (!parent) return;
      // properties, object keys, labels and the names being declared are not reads
      if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
      if (parent.type === 'Property' && parent.key === node && !parent.computed) return;
      if (parent.type === 'MethodDefinition' && parent.key === node) return;
      if (parent.type === 'PropertyDefinition' && parent.key === node) return;
      if (/^(VariableDeclarator)$/.test(parent.type) && parent.id === node) return;
      if (/Function|Class/.test(parent.type) && parent.id === node) return;
      if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement'
          || parent.type === 'ContinueStatement') return;
      if (/Pattern|RestElement/.test(parent.type)) return;
      if (parent.type === 'AssignmentPattern' && parent.left === node) return;
      if (GLOBALS.has(node.name)) return;
      const scope = chainOf(node, ancestors.slice(0, -1));
      if (inScope(node.name, scope)) return;
      if (!missing.has(node.name)) missing.set(node.name, node.loc ? node.loc.start.line : 0);
    }
  });
  return missing;
}

const FILES = [
  'static/live.js', 'static/rules.js', 'static/arena.js', 'static/strike.js',
  'static/run.js', 'static/tower.js', 'static/sprites.js', 'static/nova.js',
  'static/nova-local.js', 'static/music.js', 'static/realtime.js', 'static/boards.js',
  'static/host.html', 'static/play.html', 'static/studio.html', 'static/quiznova.html',
  'static/teachboard.html', 'static/studentboard.html', 'static/take.html'
];

/* A test that cannot fail is not a test. Before trusting it on the real files,
   check it still catches the three shapes that actually got through. */
const BAIT = `
  (function () {
    function publicView(game) { return { trackLength: TRACK_LENGTH }; }
    function render() { stopRun(); return publicView({}); }
    render();
  })();
`;
const caught = [...unresolved(BAIT).keys()].sort();
ok('the check catches what got through before',
   caught.join(',') === 'TRACK_LENGTH,stopRun', caught.join(', ') || 'nothing');
ok('and does not cry wolf over ordinary code',
   unresolved(`(function(){ const o = { add(p){ return p; }, get on(){ return 1; } };
                 const f = (a, { b = 2 }, ...rest) => a + b + rest.length + o.add(1) + o.on;
                 for (const x of [1]) f(x, {}); })();`).size === 0);

console.log('\n— names used and never defined —\n');
for (const rel of FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  let missing;
  try { missing = unresolved(codeOf(full)); }
  catch (e) { ok(`${rel} parses`, false, e.message); continue; }
  const names = [...missing.keys()];
  ok(`${rel} uses nothing it has not got`, names.length === 0,
     names.slice(0, 8).join(', '));
}

console.log(`\n${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
