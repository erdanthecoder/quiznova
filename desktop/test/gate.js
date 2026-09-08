/* Who is allowed to ask for what.
 *
 * Three endpoints a player owns had drifted below the host-only check and were
 * answering "Only the host can control the game" to the only devices that ever
 * called them — casting a fishing line and building a factory machine were dead
 * on the website from the day they were written, silently, because the reply
 * looked like a permissions message rather than a bug.
 *
 * The check is a list now, so position cannot break it. This makes sure the
 * list keeps up with the pages: anything a phone calls that is not the
 * teacher's own has to be on it.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const src = read('static/live.js');
const listed = /PLAYER_OWNED = new Set\(\[([\s\S]*?)\]\)/.exec(src)[1]
  .match(/'([^']+)'/g).map(s => s.slice(1, -1));

const pages = ['static/play.html', 'static/host.html'].map(read).join('\n');
const called = [...new Set([...pages.matchAll(/games\/\$\{pin\}(\/[a-z]+)/g)].map(m => m[1]))];

// the teacher's device is the only one that drives the game forward
const HOST_ONLY = new Set(['/start', '/next', '/tick', '/end']);

let fails = 0;
const missing = called.filter(p => !HOST_ONLY.has(p) && !listed.includes(p));
if (missing.length) { fails++; console.log('FAIL  a phone calls these and they are not the player\'s own:', missing.join(' ')); }
else console.log('ok    every endpoint a phone calls is on the player\'s list');

// and nothing that drives the game has crept onto it
const crept = listed.filter(p => HOST_ONLY.has(p));
if (crept.length) { fails++; console.log('FAIL  the teacher\'s own controls are on the player list:', crept.join(' ')); }
else console.log('ok    none of the teacher\'s controls are on it');

// the gate itself must consult the list rather than trusting the order
if (!/if \(!isHost && !PLAYER_OWNED\.has\(tail\)\)/.test(src)) {
  fails++; console.log('FAIL  the host check no longer consults the list');
} else console.log('ok    the host check consults the list');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
