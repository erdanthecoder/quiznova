/* The artwork: characters, scenes and icons, all drawn here.
 *
 * Nothing on screen is an emoji. Emoji are somebody else's drawings, they come
 * out different on every device, and a child cannot be reliably given one.
 * These are built from shapes instead, so they scale to a projector, keep their
 * colour, and can be handed out and remembered.
 *
 *   Sprite.face(n, size)   one child's character: 12 colours x 12 silhouettes
 *   Sprite.scene(name, w)  an illustration, one per game
 *   Sprite.icon(name, s)   a small interface mark
 */
(function (global) {
  'use strict';

  const SKIN = ['#F4364C', '#4F6BFF', '#FFC53D', '#12BE8E', '#7C4DFF', '#2BA8FF',
                '#FF7A45', '#00B8A9', '#E8467C', '#7BC62D', '#FF9A3D', '#3AC0D8'];
  const INK = '#181030';

  /** Mix a hex colour towards black (t below 0) or white (t above 0). */
  function shade(hex, t) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(t > 0 ? c + (255 - c) * t : c * (1 + t));
    const parts = [n >> 16 & 255, n >> 8 & 255, n & 255].map(c => mix(c).toString(16).padStart(2, '0'));
    return '#' + parts.join('');
  }

  /* The twelve silhouettes. Each is drawn behind the head and anchored inside it,
   * so it reads as part of the character rather than something balanced on top.
   * Coordinates are a 64x64 box with the head centred at (32, 26). */
  const CREST = [
    '<path d="M17 30 C14 20 16 12 21 9 C26 12 28 21 27 29 Z"/><path d="M47 30 C50 20 48 12 43 9 C38 12 36 21 37 29 Z"/>',
    '<rect x="20" y="4" width="9" height="26" rx="4.5"/><rect x="35" y="4" width="9" height="26" rx="4.5"/>',
    '<path d="M32 3 C36 11 38 20 36 30 L28 30 C26 20 28 11 32 3 Z"/>',
    '<circle cx="17" cy="9" r="5"/><circle cx="47" cy="9" r="5"/>' +
      '<path d="M17 9 C18 18 22 23 26 26 M47 9 C46 18 42 23 38 26" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/>',
    '<path d="M32 3 C36 10 37 18 36 27 L28 27 C27 18 28 10 32 3 Z"/>' +
      '<path d="M19 11 C24 16 26 21 26 27 L18 27 C16 21 16 15 19 11 Z"/>' +
      '<path d="M45 11 C40 16 38 21 38 27 L46 27 C48 21 48 15 45 11 Z"/>',
    '<circle cx="15" cy="18" r="9.5"/><circle cx="49" cy="18" r="9.5"/>',
    '<path d="M13 30 C13 13 21 5 32 5 C43 5 51 13 51 30 Z"/>',
    '<path d="M8 30 C10 16 20 8 32 13 C44 8 54 16 56 30 Z"/>',
    '<rect x="29" y="8" width="6" height="18" rx="3"/><circle cx="32" cy="7" r="7"/>',
    '<path d="M32 5 C41 11 47 19 48 30 L16 30 C17 19 23 11 32 5 Z"/>',
    '<path d="M32 6 C37 11 40 18 40 26 L24 26 C24 18 27 11 32 6 Z"/>' +
      '<path d="M17 15 C22 19 24 23 24 28 L14 28 C13 23 14 18 17 15 Z"/>' +
      '<path d="M47 15 C42 19 40 23 40 28 L50 28 C51 23 50 18 47 15 Z"/>',
    '<circle cx="32" cy="9" r="8"/><circle cx="16" cy="20" r="6.5"/><circle cx="48" cy="20" r="6.5"/>'
  ];

  /* Eyes, drawn in the head's own coordinates. Two eyes are the difference
   * between a shape and a character, so this is the part worth choosing. */
  const EYES = [
    // wide open
    '<ellipse cx="25.5" cy="24.5" rx="4.6" ry="5.2" fill="#fff"/><ellipse cx="38.5" cy="24.5" rx="4.6" ry="5.2" fill="#fff"/>' +
    '<circle cx="26.3" cy="25.4" r="2.7" fill="INK"/><circle cx="39.3" cy="25.4" r="2.7" fill="INK"/>' +
    '<circle cx="27.4" cy="24.2" r="1.05" fill="#fff"/><circle cx="40.4" cy="24.2" r="1.05" fill="#fff"/>',
    // one big eye
    '<circle cx="32" cy="24.5" r="7.4" fill="#fff"/><circle cx="32.8" cy="25.4" r="4" fill="INK"/>' +
    '<circle cx="34.4" cy="23.6" r="1.5" fill="#fff"/>',
    // sleepy, half closed
    '<ellipse cx="25.5" cy="24.5" rx="4.6" ry="5.2" fill="#fff"/><ellipse cx="38.5" cy="24.5" rx="4.6" ry="5.2" fill="#fff"/>' +
    '<circle cx="26" cy="26" r="2.6" fill="INK"/><circle cx="39" cy="26" r="2.6" fill="INK"/>' +
    '<path d="M20.5 22.5 q5-3 10 0 M33.5 22.5 q5-3 10 0" stroke="INK" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
    // happy, closed and curved
    '<path d="M21 25.5 q4.5-6 9 0 M34 25.5 q4.5-6 9 0" stroke="INK" stroke-width="3" fill="none" stroke-linecap="round"/>',
    // three eyes
    '<circle cx="24" cy="26" r="4" fill="#fff"/><circle cx="40" cy="26" r="4" fill="#fff"/><circle cx="32" cy="19.5" r="4.4" fill="#fff"/>' +
    '<circle cx="24.6" cy="26.6" r="2.2" fill="INK"/><circle cx="40.6" cy="26.6" r="2.2" fill="INK"/><circle cx="32.6" cy="20.2" r="2.4" fill="INK"/>',
    // wound up
    '<ellipse cx="25.5" cy="24.5" rx="5" ry="5.6" fill="#fff"/><ellipse cx="38.5" cy="24.5" rx="5" ry="5.6" fill="#fff"/>' +
    '<circle cx="26.6" cy="25.6" r="2.4" fill="INK"/><circle cx="39.6" cy="25.6" r="2.4" fill="INK"/>' +
    '<path d="M20 18 l9 3 M44 18 l-9 3" stroke="INK" stroke-width="2.6" fill="none" stroke-linecap="round"/>'
  ];

  /* Mouths. */
  const MOUTHS = [
    '<path d="M27 33.5 q5 4.5 10 0" stroke="INK" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
    '<path d="M26 33 q6 7 12 0 z" fill="INK"/><path d="M28.5 33 h7" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>',
    '<circle cx="32" cy="34.5" r="3.2" fill="INK"/>',
    '<path d="M26 34.5 h12" stroke="INK" stroke-width="2.6" stroke-linecap="round"/>',
    // a grin with a tooth
    '<path d="M25.5 32.5 q6.5 7.5 13 0 z" fill="INK"/><path d="M30 32.5 h4 v3.2 z" fill="#fff"/>',
    // a small smile, off to one side
    '<path d="M28 34 q4.5 3.5 9-1" stroke="INK" stroke-width="2.6" fill="none" stroke-linecap="round"/>'
  ];

  /* A pattern on the body, drawn over it and clipped to it. */
  const PATTERNS = [
    '',
    // spots
    '<circle cx="24" cy="44" r="3.2"/><circle cx="40" cy="47" r="2.4"/><circle cx="32" cy="52" r="2.8"/>',
    // stripes
    '<rect x="16" y="40" width="32" height="3.4" rx="1.7"/><rect x="16" y="47" width="32" height="3.4" rx="1.7"/>',
    // a belly patch
    '<ellipse cx="32" cy="47" rx="9.5" ry="8"/>'
  ];

  const COLOURS_N = SKIN.length, CRESTS_N = CREST.length,
        EYES_N = EYES.length, MOUTHS_N = MOUTHS.length, PATTERNS_N = PATTERNS.length;

  /* A character is one number, so it is stored and passed around exactly as it
   * was before this file learned about eyes. The parts are packed smallest-first,
   * which means every character made before the extra parts existed still decodes
   * to what it looked like then. */
  const COMBINATIONS = COLOURS_N * CRESTS_N;            // colour and shape: what tells two apart
  const ALL = COMBINATIONS * EYES_N * MOUTHS_N * PATTERNS_N;

  function unpack(index) {
    let n = Math.abs(Math.round(Number(index) || 0)) % ALL;
    const colour = n % COLOURS_N; n = Math.floor(n / COLOURS_N);
    const shape = n % CRESTS_N;   n = Math.floor(n / CRESTS_N);
    const eyes = n % EYES_N;      n = Math.floor(n / EYES_N);
    const mouth = n % MOUTHS_N;   n = Math.floor(n / MOUTHS_N);
    return { colour, shape, eyes, mouth, pattern: n % PATTERNS_N };
  }
  const pack = ({ colour = 0, shape = 0, eyes = 0, mouth = 0, pattern = 0 }) => {
    const w = (v, m) => ((Math.round(v) % m) + m) % m;
    return w(colour, COLOURS_N)
      + COLOURS_N * (w(shape, CRESTS_N)
      + CRESTS_N * (w(eyes, EYES_N)
      + EYES_N * (w(mouth, MOUTHS_N)
      + MOUTHS_N * w(pattern, PATTERNS_N))));
  };

  /* ── hats ─────────────────────────────────────────────────
   * A hat is not part of the packed character number. It is a separate thing a
   * child owns and puts on, and it has to be, because the number is what the
   * game uses to tell two players apart across a room — a hat that changed it
   * would change who you look like every time you tried one on.
   *
   * Each is drawn in the same 64x64 box as the character, sitting on a head
   * whose circle is centred at (32, 26) with a radius of 18, so the brim lands
   * around y=12 and the crown goes up from there. Index 0 is no hat.
   */
  const HATS = [
    '',
    // party cone
    '<path d="M32 -2 L42 15 H22z" fill="#F4364C"/>' +
    '<path d="M32 -2 L37 6.5 L27 6.5z" fill="#FFC53D"/>' +
    '<ellipse cx="32" cy="15" rx="10.5" ry="2.6" fill="#C42539"/>' +
    '<circle cx="32" cy="-3" r="3" fill="#FFC53D"/>',
    // top hat
    '<rect x="23" y="-3" width="18" height="16" rx="1.6" fill="#221541"/>' +
    '<rect x="23" y="7" width="18" height="4" fill="#F4364C"/>' +
    '<ellipse cx="32" cy="13.5" rx="15" ry="3.2" fill="#161036"/>',
    // crown
    '<path d="M19 14 L21 1 L26.5 8 L32 -1 L37.5 8 L43 1 L45 14z" fill="#FFC53D"/>' +
    '<rect x="19" y="12" width="26" height="4" rx="1.6" fill="#E8A400"/>' +
    '<circle cx="26.5" cy="9" r="1.8" fill="#F4364C"/><circle cx="37.5" cy="9" r="1.8" fill="#4F6BFF"/>',
    // cap, worn forwards
    '<path d="M17 13 a15 15 0 0 1 30 0z" fill="#2BA8FF"/>' +
    '<path d="M17 12.5 h20 a6 6 0 0 1 6 4 H17z" fill="#1E86CC"/>' +
    '<circle cx="32" cy="-1" r="2.4" fill="#1E86CC"/>',
    // bobble hat
    '<path d="M19 14 a13 13 0 0 1 26 0z" fill="#12BE8E"/>' +
    '<rect x="17" y="11" width="30" height="5.5" rx="2.7" fill="#F6F2FF"/>' +
    '<circle cx="32" cy="0" r="4.4" fill="#F6F2FF"/>',
    // headphones
    '<path d="M15 22 a17 17 0 0 1 34 0" stroke="#221541" stroke-width="4" fill="none" stroke-linecap="round"/>' +
    '<rect x="10" y="18" width="8" height="12" rx="3.6" fill="#F4364C"/>' +
    '<rect x="46" y="18" width="8" height="12" rx="3.6" fill="#F4364C"/>',
    // wizard hat
    '<path d="M32 -6 C36 4 40 10 46 15 H18 C24 10 28 4 32 -6z" fill="#6C4CF1"/>' +
    '<ellipse cx="32" cy="15" rx="16" ry="3.4" fill="#5238C8"/>' +
    '<path d="M30 4 l1.4 3 3 1.4 -3 1.4 -1.4 3 -1.4-3 -3-1.4 3-1.4z" fill="#FFC53D"/>',
    // flower crown
    '<path d="M17 13 q15 -5 30 0" stroke="#12BE8E" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<circle cx="21" cy="11" r="3.4" fill="#FF5D73"/><circle cx="32" cy="7.5" r="3.8" fill="#FFC53D"/>' +
    '<circle cx="43" cy="11" r="3.4" fill="#4F6BFF"/>' +
    '<circle cx="32" cy="7.5" r="1.5" fill="#fff"/>',
    // hard hat
    '<path d="M18 14 a14 14 0 0 1 28 0z" fill="#FF7A45"/>' +
    '<rect x="30" y="0" width="4" height="12" rx="1.6" fill="#E0602C"/>' +
    '<rect x="15" y="12" width="34" height="4.4" rx="2.2" fill="#FFC53D"/>',
    // pirate
    '<path d="M15 13 q17 -12 34 0z" fill="#221541"/>' +
    '<rect x="14" y="11" width="36" height="4.6" rx="2.3" fill="#161036"/>' +
    '<circle cx="32" cy="6.5" r="2.4" fill="#F6F2FF"/>' +
    '<rect x="30.6" y="8.4" width="2.8" height="3.4" rx="1" fill="#F6F2FF"/>',
    // halo
    '<ellipse cx="32" cy="3" rx="11" ry="3.6" fill="none" stroke="#FFC53D" stroke-width="3"/>',
    // beanie with a stripe
    '<path d="M19 14 a13 13 0 0 1 26 0z" fill="#7C4DFF"/>' +
    '<rect x="18" y="9" width="28" height="3.4" fill="#FFC53D"/>' +
    '<rect x="17" y="12" width="30" height="4.6" rx="2.3" fill="#5238C8"/>'
  ];
  const HAT_NAMES = ['No hat', 'Party cone', 'Top hat', 'Crown', 'Cap', 'Bobble hat',
                     'Headphones', 'Wizard hat', 'Flower crown', 'Hard hat', "Captain's cap",
                     'Halo', 'Beanie'];
  const HATS_N = HATS.length;

  let uid = 0;

  /**
   * One child's character, drawn whole: feet, arms, body, head, face.
   * `index` is stored with the player, so their character never changes.
   * `hat` is separate and optional — nought, or nothing at all, is bare-headed.
   */
  function face(index, size = 48, hat = 0) {
    const part = unpack(index);
    const base = SKIN[part.colour];
    const crest = CREST[part.shape];
    const deep = shade(base, -0.3);
    const id = 'sp' + (++uid);
    const ink = (svg) => svg.split('INK').join(INK);
    return '<svg class="face-svg" viewBox="0 0 64 64" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + shade(base, 0.26) + '"/><stop offset="1" stop-color="' + base + '"/></linearGradient>' +
        '<linearGradient id="' + id + 'h" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + shade(base, 0.44) + '"/><stop offset="1" stop-color="' + base + '"/></linearGradient>' +
        // the pattern is drawn over the body and cut to its outline
        '<clipPath id="' + id + 'c"><path d="M32 27 c11 0 16 8 16 16 v3 c0 6-7 9-16 9 s-16-3-16-9 v-3 c0-8 5-16 16-16z"/></clipPath>' +
      '</defs>' +
      // the tallest silhouettes reach past the top of the box, so the whole
      // character is scaled to sit inside it
      '<g transform="translate(32,32) scale(.86) translate(-32,-32)">' +
      '<ellipse cx="32" cy="59.5" rx="17" ry="3.2" fill="rgba(0,0,0,.16)"/>' +
      // the silhouette is what tells two characters apart across a room, so it
      // is pushed out past the head rather than tucked behind it
      '<g fill="' + deep + '" color="' + deep + '" transform="translate(32,26) scale(1.26,1.18) translate(-32,-26) translate(0,-5)">' + crest + '</g>' +
      '<path d="M22 52 h7 v6 a3.5 3.5 0 0 1-7 0z" fill="' + deep + '"/>' +
      '<path d="M35 52 h7 v6 a3.5 3.5 0 0 1-7 0z" fill="' + deep + '"/>' +
      '<rect x="9" y="34" width="8" height="19" rx="4" fill="' + deep + '" transform="rotate(-14 13 43)"/>' +
      '<rect x="47" y="34" width="8" height="19" rx="4" fill="' + deep + '" transform="rotate(14 51 43)"/>' +
      '<path d="M32 27 c11 0 16 8 16 16 v3 c0 6-7 9-16 9 s-16-3-16-9 v-3 c0-8 5-16 16-16z" fill="url(#' + id + 'b)"/>' +
      (PATTERNS[part.pattern]
        ? '<g clip-path="url(#' + id + 'c)" fill="' + shade(base, -0.22) + '">' + PATTERNS[part.pattern] + '</g>'
        : '') +
      '<ellipse cx="32" cy="47" rx="9" ry="7" fill="rgba(255,255,255,.28)"/>' +
      '<circle cx="32" cy="26" r="18" fill="url(#' + id + 'h)"/>' +
      '<ellipse cx="20" cy="32" rx="4" ry="2.6" fill="rgba(0,0,0,.09)"/>' +
      '<ellipse cx="44" cy="32" rx="4" ry="2.6" fill="rgba(0,0,0,.09)"/>' +
      ink(EYES[part.eyes]) +
      ink(MOUTHS[part.mouth]) +
      // the hat goes on last, over everything, because that is where a hat is
      (HATS[((Math.round(Number(hat) || 0) % HATS_N) + HATS_N) % HATS_N] || '') +
      '</g>' +
    '</svg>';
  }

  /* Handing out 0, 1, 2, 3 would give the first twelve children one silhouette in
   * twelve colours, which is the very thing that makes a class look alike.
   * Stepping by 13 through 144 visits every pair once (13 and 144 share no factor)
   * and changes both the colour and the shape each time. */
  const STRIDE = 13;
  const nth = (k) => (k * STRIDE) % COMBINATIONS;

  /* Two characters are told apart across a room by colour and silhouette, not by
   * which mouth they have, so that pair is what must be unique — everything else
   * is a child's own business and may be shared freely. */
  const looksLike = (index) => {
    const p = unpack(index);
    return p.colour + COLOURS_N * p.shape;
  };

  /** The first character whose colour and shape no one in this game has taken. */
  function freeFace(taken) {
    const used = new Set((taken || []).map(looksLike));
    for (let k = 0; k < COMBINATIONS; k++) if (!used.has(nth(k))) return nth(k);
    return nth(Math.floor(Math.random() * COMBINATIONS));
  }

  /* An illustration for each game, so picking one shows what happens in it
   * rather than naming it. Drawn in a 160x100 box. */
  const SCENE = {
    /* Eagle Hunt: the canyon, a gate of flags across it, and a bird coming
       down the middle. Drawn from behind the bird because that is what the
       board actually shows — a picture of an eagle in profile would promise a
       different game from the one this is. */
    eagle:
      '<rect width="160" height="100" fill="#CBE2F6"/>' +
      '<path d="M0 0h160v46H0z" fill="#5B7FD4" opacity=".55"/>' +
      '<path d="M0 46 24 22 44 40 70 14 96 42 122 20 146 44 160 34v22H0z" fill="#8E7CAB"/>' +
      '<path d="M70 14 60 28h20z" fill="#F4F7FF"/><path d="M122 20 114 32h16z" fill="#F4F7FF"/>' +
      '<path d="M0 56 46 62 52 100H0z" fill="#6C5A88"/>' +
      '<path d="M160 56 114 62 108 100h52z" fill="#6C5A88" opacity=".82"/>' +
      '<path d="M46 62 52 100h56l-6-38z" fill="#2E7FA8"/>' +
      '<g fill="#3F2E1E"><path d="M72 44c-10-5-18-4-22-1 6 0 10 2 14 5l-4 9 8-6 8 6-4-9c4-3 8-5 14-5-4-3-12-4-22-1z"/></g>' +
      '<g fill="#E8C98A"><circle cx="72" cy="45" r="2.6"/></g>' +
      '<g stroke="#3A2A1C" stroke-width="2"><path d="M40 52v16M104 52v16"/></g>' +
      '<path d="M40 52h64" stroke="#3A2A1C" stroke-width="2"/>' +
      '<g fill="#FFC53D"><path d="M44 53l8 0-4 7z"/><path d="M60 53l8 0-4 7z"/>' +
      '<path d="M76 53l8 0-4 7z"/><path d="M92 53l8 0-4 7z"/></g>',
    canyon:
      '<rect width="160" height="100" fill="#CBE2F6"/>' +
      '<path d="M0 0h160v46H0z" fill="#5B7FD4" opacity=".55"/>' +
      '<path d="M0 46 24 22 44 40 70 14 96 42 122 20 146 44 160 34v22H0z" fill="#8E7CAB"/>' +
      '<path d="M70 14 60 28h20z" fill="#F4F7FF"/><path d="M122 20 114 32h16z" fill="#F4F7FF"/>' +
      '<path d="M0 56 46 62 52 100H0z" fill="#6C5A88"/>' +
      '<path d="M160 56 114 62 108 100h52z" fill="#6C5A88" opacity=".82"/>' +
      '<path d="M46 62 52 100h56l-6-38z" fill="#2E7FA8"/>' +
      '<g fill="#3F2E1E"><path d="M72 44c-10-5-18-4-22-1 6 0 10 2 14 5l-4 9 8-6 8 6-4-9c4-3 8-5 14-5-4-3-12-4-22-1z"/></g>' +
      '<g fill="#E8C98A"><circle cx="72" cy="45" r="2.6"/></g>' +
      '<g stroke="#3A2A1C" stroke-width="2"><path d="M40 52v16M104 52v16"/></g>' +
      '<path d="M40 52h64" stroke="#3A2A1C" stroke-width="2"/>' +
      '<g fill="#FFC53D"><path d="M44 53l8 0-4 7z"/><path d="M60 53l8 0-4 7z"/>' +
      '<path d="M76 53l8 0-4 7z"/><path d="M92 53l8 0-4 7z"/></g>',
    dusk:
      '<rect width="160" height="100" fill="#FFB36B"/>' +
      '<path d="M0 0h160v46H0z" fill="#8E3A58" opacity=".55"/>' +
      '<path d="M0 46 24 22 44 40 70 14 96 42 122 20 146 44 160 34v22H0z" fill="#96515A"/>' +
      '<path d="M70 14 60 28h20z" fill="#F4F7FF"/><path d="M122 20 114 32h16z" fill="#F4F7FF"/>' +
      '<path d="M0 56 46 62 52 100H0z" fill="#6B3346"/>' +
      '<path d="M160 56 114 62 108 100h52z" fill="#6B3346" opacity=".82"/>' +
      '<path d="M46 62 52 100h56l-6-38z" fill="#7E4A7A"/>' +
      '<g fill="#3F2E1E"><path d="M72 44c-10-5-18-4-22-1 6 0 10 2 14 5l-4 9 8-6 8 6-4-9c4-3 8-5 14-5-4-3-12-4-22-1z"/></g>' +
      '<g fill="#E8C98A"><circle cx="72" cy="45" r="2.6"/></g>' +
      '<g stroke="#3A2A1C" stroke-width="2"><path d="M40 52v16M104 52v16"/></g>' +
      '<path d="M40 52h64" stroke="#3A2A1C" stroke-width="2"/>' +
      '<g fill="#FFE3D0"><path d="M44 53l8 0-4 7z"/><path d="M60 53l8 0-4 7z"/>' +
      '<path d="M76 53l8 0-4 7z"/><path d="M92 53l8 0-4 7z"/></g>',
    storm:
      '<rect width="160" height="100" fill="#59617F"/>' +
      '<path d="M0 0h160v46H0z" fill="#2A3050" opacity=".55"/>' +
      '<path d="M0 46 24 22 44 40 70 14 96 42 122 20 146 44 160 34v22H0z" fill="#4B4F6E"/>' +
      '<path d="M70 14 60 28h20z" fill="#F4F7FF"/><path d="M122 20 114 32h16z" fill="#F4F7FF"/>' +
      '<path d="M0 56 46 62 52 100H0z" fill="#33364F"/>' +
      '<path d="M160 56 114 62 108 100h52z" fill="#33364F" opacity=".82"/>' +
      '<path d="M46 62 52 100h56l-6-38z" fill="#37506E"/>' +
      '<g fill="#3F2E1E"><path d="M72 44c-10-5-18-4-22-1 6 0 10 2 14 5l-4 9 8-6 8 6-4-9c4-3 8-5 14-5-4-3-12-4-22-1z"/></g>' +
      '<g fill="#E8C98A"><circle cx="72" cy="45" r="2.6"/></g>' +
      '<g stroke="#3A2A1C" stroke-width="2"><path d="M40 52v16M104 52v16"/></g>' +
      '<path d="M40 52h64" stroke="#3A2A1C" stroke-width="2"/>' +
      '<g fill="#DDE4F5"><path d="M44 53l8 0-4 7z"/><path d="M60 53l8 0-4 7z"/>' +
      '<path d="M76 53l8 0-4 7z"/><path d="M92 53l8 0-4 7z"/></g>',
    /* Classic Quiz: the question on the board and four answers under it, which
       is exactly what the mode is. No creature, no arena — the picture should
       promise the plain thing, because a teacher picking this one is picking it
       on purpose. */
    normal:
      '<rect width="160" height="100" fill="#F3F0FF"/>' +
      '<rect x="14" y="12" width="132" height="30" rx="8" fill="#fff" stroke="#1B1330" stroke-width="3"/>' +
      '<rect x="24" y="22" width="76" height="5" rx="2.5" fill="#1B1330" opacity=".75"/>' +
      '<rect x="24" y="31" width="48" height="5" rx="2.5" fill="#1B1330" opacity=".35"/>' +
      '<circle cx="128" cy="27" r="9" fill="none" stroke="#7C4DFF" stroke-width="3.4"/>' +
      '<path d="M128 21v7l4 3" stroke="#7C4DFF" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<g stroke="#1B1330" stroke-width="3">' +
      '<rect x="14" y="50" width="62" height="20" rx="6" fill="#F4364C"/>' +
      '<rect x="84" y="50" width="62" height="20" rx="6" fill="#4F6BFF"/>' +
      '<rect x="14" y="76" width="62" height="20" rx="6" fill="#FFC53D"/>' +
      '<rect x="84" y="76" width="62" height="20" rx="6" fill="#12BE8E"/></g>' +
      '<g fill="#fff">' +
      '<path d="M26 66 l7-12 7 12z"/><circle cx="99" cy="60" r="6"/>' +
      '<rect x="26" y="80" width="12" height="12" rx="2.5"/>' +
      '<path d="M99 80 l6 6-6 6-6-6z"/></g>',
    laser:
      '<rect width="160" height="100" fill="#EDF1FF"/>' +
      '<circle cx="34" cy="50" r="17" fill="#F4364C"/><circle cx="29" cy="45" r="3.6" fill="#fff"/>' +
      '<circle cx="126" cy="50" r="17" fill="#4F6BFF"/><circle cx="131" cy="45" r="3.6" fill="#fff"/>' +
      '<rect x="53" y="46" width="54" height="8" rx="4" fill="#FFC53D"/>' +
      '<path d="M107 41 l15 9 -15 9z" fill="#FF7A45"/><path d="M53 41 l-15 9 15 9z" fill="#FF7A45"/>' +
      '<rect x="18" y="76" width="32" height="7" rx="3.5" fill="#F4364C" opacity=".45"/>' +
      '<rect x="110" y="76" width="32" height="7" rx="3.5" fill="#4F6BFF" opacity=".45"/>' +
      '<rect y="92" width="160" height="8" fill="#D6DDF6"/>',
    tower:
      '<rect width="160" height="100" fill="#EAFBF3"/>' +
      '<rect x="46" y="76" width="34" height="15" rx="3" fill="#F4364C"/>' +
      '<rect x="46" y="60" width="34" height="15" rx="3" fill="#FFC53D"/>' +
      '<rect x="46" y="44" width="34" height="15" rx="3" fill="#4F6BFF"/>' +
      '<rect x="46" y="28" width="34" height="15" rx="3" fill="#12BE8E"/>' +
      '<rect x="106" y="14" width="6" height="78" fill="#8A93A8"/>' +
      '<rect x="72" y="14" width="42" height="6" fill="#8A93A8"/>' +
      '<rect x="74" y="20" width="3" height="9" fill="#8A93A8"/>' +
      '<rect x="66" y="28" width="20" height="9" rx="2" fill="#7C4DFF"/>' +
      '<rect y="91" width="160" height="9" fill="#CFEEDF"/>',
    boss:
      '<rect width="160" height="100" fill="#F1ECFF"/>' +
      '<path d="M56 30 a28 26 0 0 1 56 0 v13 a20 20 0 0 1-20 20 h-16 a20 20 0 0 1-20-20z" fill="#7C4DFF"/>' +
      '<path d="M62 11 l10 15 M106 11 l-10 15" stroke="#5B33D6" stroke-width="7" stroke-linecap="round" fill="none"/>' +
      '<circle cx="74" cy="33" r="6.5" fill="#fff"/><circle cx="94" cy="33" r="6.5" fill="#fff"/>' +
      '<circle cx="75.5" cy="34" r="3" fill="#241C38"/><circle cx="95.5" cy="34" r="3" fill="#241C38"/>' +
      '<path d="M74 50 q10 8 20 0" stroke="#3F1FA6" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<circle cx="26" cy="78" r="10" fill="#12BE8E"/><circle cx="50" cy="83" r="8" fill="#FFC53D"/>' +
      '<circle cx="124" cy="80" r="9" fill="#F4364C"/><circle cx="144" cy="85" r="7" fill="#2BA8FF"/>' +
      '<rect y="91" width="160" height="9" fill="#DED2FF"/>',
    robot:
      '<rect width="160" height="100" fill="#0A1418"/>' +
      '<path d="M26 100 L64 38 L96 38 L134 100z" fill="#1B2422"/>' +
      '<path d="M56 100 L74 50 L86 50 L104 100z" fill="#0A1214"/>' +
      '<ellipse cx="80" cy="44" rx="13" ry="8" fill="#05080A"/>' +
      '<path d="M0 86h160v14H0z" fill="#16201F"/>' +
      '<circle cx="80" cy="60" r="5" fill="#FFC53D"/>' +
      '<rect x="77.4" y="62" width="5.2" height="8" rx="2.4" fill="#FFC53D"/>' +
      '<path d="M92 100c-5-26 8-38 22-38s27 12 22 38z" fill="#0C060F"/>' +
      '<circle cx="105" cy="72" r="3" fill="#FF5A6E"/><circle cx="118" cy="72" r="3" fill="#FF5A6E"/>' +
      '<path d="M90 86c-9-4-14-10-14-17M136 86c9-4 14-10 14-17" stroke="#0C060F" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
  };

  /* ── the maps ─────────────────────────────────────────────
   *
   * A map used to be a tint. The picker drew the mode's own illustration three
   * times and put a CSS filter over it, so a teacher choosing between the Neon
   * Arena, a Bunker and a Moon Base was shown the same picture three times and
   * asked to pick one. That is not a choice, it is a colour swatch.
   *
   * Each of the twelve is drawn here instead. Same 160x100 box as the mode
   * scenes, same flat style, and each one has to be recognisable at the size of
   * a button on a phone — so: one strong silhouette, one light source, and the
   * thing the map is named after large enough to read.
   */
  const MAPART = {
    // ── Classic Quiz ──
    classic:
      '<rect width="160" height="100" fill="#6C4CF1"/>' +
      '<circle cx="24" cy="18" r="26" fill="#8C6CFF" opacity=".55"/>' +
      '<circle cx="140" cy="86" r="30" fill="#5334D8" opacity=".55"/>' +
      '<rect x="20" y="24" width="120" height="34" rx="10" fill="#fff"/>' +
      '<rect x="32" y="34" width="70" height="6" rx="3" fill="#1B1330" opacity=".8"/>' +
      '<rect x="32" y="45" width="44" height="6" rx="3" fill="#1B1330" opacity=".35"/>' +
      '<g><rect x="20" y="66" width="56" height="16" rx="5" fill="#F4364C"/>' +
      '<rect x="84" y="66" width="56" height="16" rx="5" fill="#4F6BFF"/></g>',
    chalk:
      '<rect width="160" height="100" fill="#26453B"/>' +
      '<rect x="6" y="6" width="148" height="88" rx="4" fill="#1F3A31" stroke="#C8A76A" stroke-width="5"/>' +
      '<g stroke="#EAF3EE" stroke-width="3" stroke-linecap="round" opacity=".85">' +
      '<path d="M24 28h60M24 40h84M24 52h44"/></g>' +
      '<g stroke="#FFD86B" stroke-width="3" stroke-linecap="round">' +
      '<path d="M24 70h28M78 70h28"/></g>' +
      '<circle cx="132" cy="74" r="9" fill="none" stroke="#EAF3EE" stroke-width="3" opacity=".6"/>',
    sunset:
      '<defs><linearGradient id="ssky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#3B1E6E"/><stop offset="0.55" stop-color="#FF6B6B"/>' +
      '<stop offset="1" stop-color="#FFB86B"/></linearGradient></defs>' +
      '<rect width="160" height="100" fill="url(#ssky)"/>' +
      '<circle cx="80" cy="66" r="26" fill="#FFE2A0" opacity=".9"/>' +
      '<g fill="#2A1540"><path d="M0 76l26-18 20 14 24-20 26 18 22-12 22 16v26H0z"/></g>' +
      '<rect x="26" y="20" width="108" height="26" rx="8" fill="#fff" opacity=".95"/>' +
      '<rect x="38" y="28" width="58" height="5" rx="2.5" fill="#1B1330" opacity=".75"/>' +
      '<rect x="38" y="37" width="36" height="5" rx="2.5" fill="#1B1330" opacity=".35"/>',

    // ── Laser Tag ──
    arena:
      '<rect width="160" height="100" fill="#120A2E"/>' +
      '<path d="M0 62h160v38H0z" fill="#1B1046"/>' +
      '<g stroke="#7C4DFF" stroke-width="1" opacity=".5">' +
      '<path d="M0 70h160M0 80h160M0 90h160M20 62v38M50 62v38M80 62v38M110 62v38M140 62v38"/></g>' +
      '<rect x="8" y="30" width="6" height="34" rx="3" fill="#E8467C"/>' +
      '<rect x="146" y="30" width="6" height="34" rx="3" fill="#2BA8FF"/>' +
      '<rect x="36" y="44" width="26" height="20" rx="3" fill="#2A1A5E"/>' +
      '<rect x="36" y="44" width="26" height="4" rx="2" fill="#E8467C"/>' +
      '<rect x="98" y="44" width="26" height="20" rx="3" fill="#2A1A5E"/>' +
      '<rect x="98" y="44" width="26" height="4" rx="2" fill="#2BA8FF"/>' +
      '<circle cx="80" cy="26" r="13" fill="#7C4DFF" opacity=".35"/>' +
      '<circle cx="80" cy="26" r="6" fill="#C9A6FF"/>' +
      '<circle cx="50" cy="38" r="7" fill="#F4364C"/><circle cx="47.6" cy="35.6" r="2.1" fill="#fff"/>' +
      '<circle cx="112" cy="38" r="7" fill="#4F6BFF"/><circle cx="109.6" cy="35.6" r="2.1" fill="#fff"/>' +
      '<path d="M57 40 L96 46" stroke="#FF5A6E" stroke-width="2.2" stroke-linecap="round"/>',
    bunker:
      '<rect width="160" height="100" fill="#2A2620"/>' +
      // daylight through the slit, and the wedge of light it throws inside
      '<rect x="0" y="26" width="160" height="16" fill="#BFE6FF"/>' +
      '<path d="M22 60h116l-30 -18H52z" fill="#FFD86B" opacity=".14"/>' +
      '<g fill="#4A4438">' +
      '<rect width="160" height="26"/><rect y="42" width="160" height="10"/>' +
      '<rect x="0" y="26" width="16" height="16"/><rect x="72" y="26" width="12" height="16"/>' +
      '<rect x="144" y="26" width="16" height="16"/></g>' +
      '<g fill="#3A3428"><rect y="20" width="160" height="6"/><rect y="52" width="160" height="5"/></g>' +
      '<rect y="84" width="160" height="16" fill="#4A4234"/>' +
      '<g fill="#7D7358" stroke="#5A5240" stroke-width="1.2">' +
      '<rect x="-2" y="70" width="34" height="14" rx="7"/><rect x="30" y="70" width="34" height="14" rx="7"/>' +
      '<rect x="96" y="70" width="34" height="14" rx="7"/><rect x="128" y="70" width="34" height="14" rx="7"/>' +
      '<rect x="14" y="58" width="34" height="14" rx="7"/><rect x="112" y="58" width="34" height="14" rx="7"/></g>' +
      '<circle cx="80" cy="66" r="9" fill="#12BE8E"/><circle cx="76.6" cy="62.6" r="2.7" fill="#fff"/>' +
      '<rect x="88" y="60" width="22" height="5" rx="2.5" fill="#5E5870"/>' +
      '<rect x="106" y="57" width="6" height="5" rx="2" fill="#8C86A6"/>' +
      '<g fill="#FFD86B" opacity=".55"><circle cx="34" cy="34" r="2"/><circle cx="118" cy="34" r="2"/></g>',
    moon:
      '<rect width="160" height="100" fill="#07060F"/>' +
      '<g fill="#fff"><circle cx="18" cy="12" r="1.2"/><circle cx="44" cy="7" r="1"/><circle cx="70" cy="16" r="1.3"/>' +
      '<circle cx="100" cy="9" r="1"/><circle cx="126" cy="20" r="1.2"/><circle cx="148" cy="10" r="1"/>' +
      '<circle cx="32" cy="28" r="1"/><circle cx="88" cy="30" r="1.1"/></g>' +
      '<circle cx="128" cy="26" r="14" fill="#2B7FBF"/>' +
      '<path d="M118 20c5 2 8-2 13 0s8 5 9 9c-4 6-12 9-19 6s-9-11-3-15z" fill="#12BE8E" opacity=".85"/>' +
      '<path d="M0 66c18-8 34-4 52-2s32-6 50-4 40 8 58 4v36H0z" fill="#B9B2C4"/>' +
      '<path d="M0 74c18-6 34-2 52 0s32-5 50-3 40 7 58 3v26H0z" fill="#8F8899"/>' +
      '<ellipse cx="34" cy="84" rx="12" ry="4" fill="#746E80"/>' +
      '<ellipse cx="118" cy="90" rx="9" ry="3" fill="#746E80"/>' +
      '<path d="M42 72a30 20 0 0 1 60 0z" fill="#E9ECF5"/>' +
      '<path d="M42 72a30 20 0 0 1 60 0z" fill="none" stroke="#9AA2B8" stroke-width="1.6"/>' +
      '<path d="M72 52v20M42 72a30 20 0 0 1 60 0" fill="none" stroke="#9AA2B8" stroke-width="1" opacity=".6"/>' +
      '<rect x="60" y="60" width="11" height="12" rx="2" fill="#2BA8FF" opacity=".85"/>' +
      '<rect x="75" y="60" width="11" height="12" rx="2" fill="#2BA8FF" opacity=".6"/>' +
      '<rect x="102" y="62" width="14" height="10" rx="2" fill="#6E6880"/>' +
      '<rect x="114" y="56" width="4" height="16" rx="2" fill="#8C86A6"/>' +
      '<circle cx="116" cy="54" r="3" fill="#F4364C"/>' +
      '<circle cx="40" cy="64" r="7" fill="#FFC53D"/><circle cx="37.6" cy="61.6" r="2.1" fill="#fff"/>' +
      '<circle cx="40" cy="64" r="9" fill="none" stroke="#E9ECF5" stroke-width="1.4" opacity=".8"/>',

    // ── Tower Build ──
    site:
      '<rect width="160" height="100" fill="#BFE6FF"/>' +
      '<rect y="80" width="160" height="20" fill="#C0A87E"/>' +
      '<g stroke="#E8A400" stroke-width="3" fill="none">' +
      '<path d="M104 80V20h34"/><path d="M104 28h26M104 40h16"/></g>' +
      '<path d="M138 20v14" stroke="#8C86A6" stroke-width="1.6"/>' +
      '<rect x="132" y="34" width="12" height="10" rx="2" fill="#F4364C"/>' +
      '<g fill="#D8541F" stroke="#9C3A10" stroke-width="1.2">' +
      '<rect x="18" y="64" width="20" height="10" rx="1.5"/><rect x="40" y="64" width="20" height="10" rx="1.5"/>' +
      '<rect x="28" y="52" width="20" height="10" rx="1.5"/><rect x="50" y="52" width="20" height="10" rx="1.5"/>' +
      '<rect x="38" y="40" width="20" height="10" rx="1.5"/></g>' +
      '<g stroke="#9AA2B8" stroke-width="2" fill="none">' +
      '<path d="M14 80V38h60M14 58h60M74 80V38"/></g>' +
      '<circle cx="86" cy="66" r="8" fill="#12BE8E"/><circle cx="83" cy="63" r="2.4" fill="#fff"/>' +
      '<path d="M78 60a8 8 0 0 1 16 0z" fill="#FFC53D"/>',
    candy:
      '<rect width="160" height="100" fill="#FFD9EC"/>' +
      '<circle cx="132" cy="18" r="11" fill="#FFF2A8"/>' +
      '<path d="M0 82c14-6 26 2 40 0s26-8 40-6 26 8 40 6 26-6 40-4v22H0z" fill="#F7A8D0"/>' +
      '<path d="M0 90c14-4 26 2 40 0s26-6 40-4 26 6 40 4 26-4 40-2v12H0z" fill="#EE7FB8"/>' +
      '<g>' +
      '<rect x="26" y="34" width="10" height="52" rx="5" fill="#fff"/>' +
      '<path d="M26 40h10M26 52h10M26 64h10M26 76h10" stroke="#F4364C" stroke-width="5" opacity=".9"/>' +
      '<rect x="118" y="44" width="10" height="42" rx="5" fill="#fff"/>' +
      '<path d="M118 50h10M118 62h10M118 74h10" stroke="#2BA8FF" stroke-width="5" opacity=".9"/></g>' +
      '<circle cx="62" cy="72" r="10" fill="#7BC62D"/><circle cx="82" cy="66" r="8" fill="#FF9A3D"/>' +
      '<circle cx="98" cy="74" r="7" fill="#E8467C"/>' +
      '<circle cx="62" cy="72" r="10" fill="none" stroke="#fff" stroke-width="1.6" opacity=".7"/>' +
      '<circle cx="76" cy="44" r="8" fill="#FFC53D"/><circle cx="73" cy="41" r="2.4" fill="#fff"/>',
    castle:
      '<rect width="160" height="100" fill="#7FC9F0"/>' +
      '<path d="M0 74c22-14 44-10 66-4s50 2 94-6v36H0z" fill="#6FAE58"/>' +
      '<g fill="#B9B2C4" stroke="#7E7788" stroke-width="1.4">' +
      '<rect x="18" y="40" width="26" height="46"/><rect x="116" y="40" width="26" height="46"/>' +
      '<rect x="44" y="54" width="72" height="32"/></g>' +
      '<g fill="#B9B2C4" stroke="#7E7788" stroke-width="1.4">' +
      '<rect x="18" y="34" width="7" height="8"/><rect x="30" y="34" width="7" height="8"/>' +
      '<rect x="123" y="34" width="7" height="8"/><rect x="135" y="34" width="7" height="8"/>' +
      '<rect x="48" y="48" width="7" height="8"/><rect x="66" y="48" width="7" height="8"/>' +
      '<rect x="84" y="48" width="7" height="8"/><rect x="102" y="48" width="7" height="8"/></g>' +
      '<path d="M70 86V68a10 10 0 0 1 20 0v18z" fill="#4A3A2E"/>' +
      '<g stroke="#2A2140" stroke-width="1" opacity=".5"><path d="M80 68v18M70 76h20"/></g>' +
      '<path d="M31 34V16l16 5-16 5" fill="#F4364C"/>' +
      '<path d="M129 34V16l-16 5 16 5" fill="#4F6BFF"/>' +
      '<circle cx="58" cy="78" r="7" fill="#FFC53D"/><circle cx="55.6" cy="75.6" r="2.1" fill="#fff"/>',

    // ── Boss Battle ──
    lair:
      '<rect width="160" height="100" fill="#0B0716"/>' +
      '<path d="M0 0h160v18c-12 0-14 14-26 14S118 16 106 16 92 32 80 32 66 14 54 14 40 30 28 30 14 16 0 16z" fill="#241A3C"/>' +
      '<path d="M0 100h160V80c-14-6-26 2-40 0s-26-8-40-6-26 8-40 6-26-4-40-2z" fill="#241A3C"/>' +
      '<ellipse cx="80" cy="88" rx="56" ry="10" fill="#7C4DFF" opacity=".18"/>' +
      '<g fill="#FFC53D">' +
      '<ellipse cx="80" cy="88" rx="36" ry="7"/><ellipse cx="54" cy="84" rx="14" ry="5"/>' +
      '<ellipse cx="108" cy="84" rx="13" ry="5"/></g>' +
      '<g fill="#E8A400"><circle cx="64" cy="84" r="3"/><circle cx="76" cy="87" r="3"/>' +
      '<circle cx="92" cy="84" r="3"/><circle cx="100" cy="88" r="2.4"/></g>' +
      '<path d="M46 74c6-24 22-34 34-34s28 10 34 34z" fill="#3E2680"/>' +
      '<path d="M62 52c0-8 8-14 18-14s18 6 18 14z" fill="#5E3BB8"/>' +
      '<circle cx="70" cy="50" r="4.5" fill="#FF5A6E"/><circle cx="90" cy="50" r="4.5" fill="#FF5A6E"/>' +
      '<circle cx="70" cy="50" r="1.8" fill="#FFD86B"/><circle cx="90" cy="50" r="1.8" fill="#FFD86B"/>' +
      '<path d="M66 62h28l-4 6H70z" fill="#E9ECF5" opacity=".9"/>',
    volcano:
      '<rect width="160" height="100" fill="#2A0F1C"/>' +
      '<path d="M0 0h160v40c-20 6-36-6-56-2S70 48 50 44 18 34 0 38z" fill="#4E1B2C" opacity=".8"/>' +
      '<path d="M40 100 L78 26 L86 26 L124 100z" fill="#2A1A2E"/>' +
      '<path d="M74 30h16l10 22-18-6-16 6z" fill="#F4364C"/>' +
      '<path d="M78 26h8l6 12-10-3-8 3z" fill="#FFD86B"/>' +
      '<path d="M0 100h160V78c-16 4-30-4-46-2s-24 8-40 6-24-8-38-6z" fill="#F4364C"/>' +
      '<path d="M0 100h160V88c-14 3-28-3-44-1s-22 7-38 5-24-7-38-5z" fill="#FF9A3D"/>' +
      '<g fill="#FFD86B"><circle cx="106" cy="18" r="4"/><circle cx="120" cy="30" r="2.8"/>' +
      '<circle cx="58" cy="22" r="3"/><circle cx="44" cy="34" r="2.2"/></g>' +
      '<circle cx="36" cy="64" r="8" fill="#12BE8E"/><circle cx="33" cy="61" r="2.4" fill="#fff"/>' +
      '<circle cx="126" cy="60" r="8" fill="#2BA8FF"/><circle cx="123" cy="57" r="2.4" fill="#fff"/>',
    ruins:
      '<rect width="160" height="100" fill="#141B2E"/>' +
      '<circle cx="124" cy="22" r="12" fill="#E9ECF5" opacity=".9"/>' +
      '<circle cx="119" cy="19" r="10" fill="#141B2E"/>' +
      '<path d="M0 78c20-8 38-2 58 0s40-8 60-6 28 6 42 4v24H0z" fill="#22304A"/>' +
      '<g fill="#8F8899">' +
      '<rect x="18" y="38" width="13" height="44" rx="2"/><rect x="14" y="34" width="21" height="6" rx="2"/>' +
      '<rect x="44" y="50" width="13" height="32" rx="2"/><rect x="40" y="46" width="21" height="6" rx="2"/>' +
      '<rect x="102" y="44" width="13" height="38" rx="2"/><rect x="98" y="40" width="21" height="6" rx="2"/></g>' +
      '<path d="M66 82l10-22 8 4-6 18z" fill="#746E80"/>' +
      '<g stroke="#6FAE58" stroke-width="2.4" fill="none" stroke-linecap="round">' +
      '<path d="M24 82c-4-10 2-18 0-26M50 82c4-8-2-14 0-20M108 82c-4-10 2-16 0-24"/></g>' +
      '<g fill="#7BC62D"><circle cx="24" cy="54" r="2.6"/><circle cx="50" cy="64" r="2.6"/><circle cx="108" cy="60" r="2.6"/></g>' +
      '<circle cx="132" cy="70" r="7" fill="#7C4DFF"/><circle cx="129.6" cy="67.6" r="2.1" fill="#fff"/>',

    // ── Robot Run ──
    station:
      '<rect width="160" height="100" fill="#0A1418"/>' +
      // the tunnel, closing to a point you are running towards
      '<path d="M0 0h160v100H0z" fill="#101C20"/>' +
      '<path d="M22 100 L64 40 L96 40 L138 100z" fill="#1B2422"/>' +
      '<path d="M52 100 L74 52 L86 52 L108 100z" fill="#0A1214"/>' +
      '<ellipse cx="80" cy="46" rx="14" ry="9" fill="#06090A"/>' +
      '<g stroke="#2E3E3A" stroke-width="3" fill="none">' +
      '<path d="M0 18h30M130 18h30M0 34h18M142 34h18"/></g>' +
      '<g fill="#14201E"><rect x="6" y="46" width="10" height="54" rx="3"/>' +
      '<rect x="144" y="46" width="10" height="54" rx="3"/></g>' +
      '<path d="M0 86h160v14H0z" fill="#16201F"/>' +
      '<path d="M0 92h160v3H0z" fill="#3AC0D8" opacity=".25"/>' +
      // the runner, small and ahead
      '<circle cx="80" cy="62" r="4.6" fill="#FFC53D"/>' +
      '<rect x="77.6" y="64" width="4.8" height="7" rx="2.2" fill="#FFC53D"/>' +
      // and the thing behind, close to us
      '<path d="M96 100c-4-22 6-34 18-34s22 12 18 34z" fill="#0C060F"/>' +
      '<circle cx="108" cy="74" r="2.6" fill="#FF5A6E"/><circle cx="118" cy="74" r="2.6" fill="#FF5A6E"/>' +
      '<path d="M96 88c-8-4-12-10-12-16M132 88c8-4 12-10 12-16" stroke="#0C060F" stroke-width="4" fill="none" stroke-linecap="round"/>',
    reactor:
      '<rect width="160" height="100" fill="#1A0A10"/>' +
      '<circle cx="128" cy="16" r="9" fill="#E9ECF5" opacity=".85"/>' +
      '<circle cx="124" cy="14" r="7.5" fill="#070E1C"/>' +
      '<path d="M0 0h160v56c-18 6-32-4-50-2S74 62 56 58 16 48 0 52z" fill="#16233F" opacity=".7"/>' +
      '<path d="M28 100 L62 44 L98 44 L132 100z" fill="#0C1A12"/>' +
      '<path d="M58 100 L74 54 L86 54 L102 100z" fill="#070F0A"/>' +
      '<g fill="#101B14">' +
      '<rect x="10" y="40" width="9" height="60" rx="3"/><rect x="141" y="40" width="9" height="60" rx="3"/>' +
      '<rect x="30" y="52" width="7" height="48" rx="3"/><rect x="123" y="52" width="7" height="48" rx="3"/></g>' +
      '<g fill="#17301F">' +
      '<path d="M14.5 42 L2 60h25z"/><path d="M145.5 42 L133 60h25z"/>' +
      '<path d="M33.5 54 L24 68h19z"/><path d="M126.5 54 L117 68h19z"/></g>' +
      '<path d="M0 88h160v12H0z" fill="#1A1510"/>' +
      '<circle cx="80" cy="64" r="4.4" fill="#7BC62D"/>' +
      '<rect x="77.8" y="66" width="4.4" height="7" rx="2" fill="#7BC62D"/>' +
      '<path d="M94 100c-4-24 7-36 20-36s24 12 20 36z" fill="#0A0610"/>' +
      '<circle cx="106" cy="72" r="2.8" fill="#FFD86B"/><circle cx="118" cy="72" r="2.8" fill="#FFD86B"/>',
    hangar:
      '<rect width="160" height="100" fill="#0A1410"/>' +
      '<path d="M0 0h160v44c-16 6-28-4-44-2s-22 8-38 6-24-8-38-6-22 4-40 0z" fill="#37152A"/>' +
      '<g fill="#221224">' +
      '<rect x="2" y="14" width="22" height="70"/><rect x="28" y="28" width="16" height="56"/>' +
      '<rect x="116" y="22" width="20" height="62"/><rect x="140" y="34" width="18" height="50"/></g>' +
      '<g fill="#FF9A3D" opacity=".55">' +
      '<rect x="7" y="22" width="5" height="6"/><rect x="16" y="34" width="5" height="6"/>' +
      '<rect x="122" y="30" width="5" height="6"/><rect x="145" y="44" width="5" height="6"/></g>' +
      '<path d="M30 100 L64 42 L96 42 L130 100z" fill="#2C2830"/>' +
      '<path d="M58 100 L74 52 L86 52 L102 100z" fill="#141118"/>' +
      '<path d="M0 86h160v14H0z" fill="#1C1622"/>' +
      '<path d="M0 93h160v2H0z" fill="#FF7A45" opacity=".3"/>' +
      '<circle cx="80" cy="62" r="4.6" fill="#2BA8FF"/>' +
      '<rect x="77.7" y="64" width="4.6" height="7" rx="2.1" fill="#2BA8FF"/>' +
      '<path d="M94 100c-5-26 7-38 21-38s26 12 21 38z" fill="#0C060F"/>' +
      '<circle cx="106" cy="70" r="2.9" fill="#FF5A6E"/><circle cx="118" cy="70" r="2.9" fill="#FF5A6E"/>' +
      '<path d="M92 84c-9-3-14-9-14-16M136 84c9-3 14-9 14-16" stroke="#0C060F" stroke-width="4" fill="none" stroke-linecap="round"/>'

  };

  /** A map's own picture, falling back to the mode's if one is ever missing. */
  function map(id, width = 160, mode) {
    const body = MAPART[id] || SCENE[mode] || SCENE.laser;
    return '<svg class="scene" viewBox="0 0 160 100" width="' + width + '" height="' + Math.round(width / 1.6) + '"' +
           ' preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + body + '</svg>';
  }

  function scene(name, width = 160) {
    const body = SCENE[name] || SCENE.laser;
    return '<svg class="scene" viewBox="0 0 160 100" width="' + width + '" height="' + Math.round(width / 1.6) + '"' +
           ' preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + body + '</svg>';
  }

  /* ── interface icons ─────────────────────────────────────
   * One flat style: 24x24, filled, no strokes to go thin when scaled down. */
  const ICON = {
    play:     '<path d="M8 5.5v13l11-6.5z"/>',
    /* The teacher's dashboard needs a name for each of the four things they
       came to do, and an unknown name draws nothing at all — so these are
       spelled out rather than borrowed from the nearest shape that fits. */
    home:     '<path d="M12 2.6 1.8 11h3v10.4h5.2V15h4v6.4h5.2V11h3z"/>',
    search:   '<circle cx="10.5" cy="10.5" r="6.4" fill="none" stroke="currentColor" stroke-width="2.6"/>' +
              '<path d="M15.4 15.4 21 21" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" fill="none"/>',
    book:     '<path d="M4 3.4h6.2a2.4 2.4 0 0 1 1.8.9v15.4a2.4 2.4 0 0 0-1.8-.9H4z"/>' +
              '<path d="M20 3.4h-6.2a2.4 2.4 0 0 0-1.8.9v15.4a2.4 2.4 0 0 1 1.8-.9H20z" opacity=".55"/>',
    chart:    '<rect x="3" y="13" width="4.4" height="8" rx="1.4"/>' +
              '<rect x="9.8" y="8" width="4.4" height="13" rx="1.4"/>' +
              '<rect x="16.6" y="3.4" width="4.4" height="17.6" rx="1.4"/>',
    plus:     '<path d="M10.6 3h2.8v7.6H21v2.8h-7.6V21h-2.8v-7.6H3v-2.8h7.6z"/>',
    pencil:   '<path d="M3 17.3 14.6 5.7l3.7 3.7L6.7 21H3z"/>' +
              '<path d="M16 4.3 17.7 2.6a1.9 1.9 0 0 1 2.7 0l1 1a1.9 1.9 0 0 1 0 2.7L19.7 8z"/>',
    screen:   '<rect x="2.2" y="4" width="19.6" height="12.6" rx="2.6" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
              '<path d="M8.4 20h7.2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
              '<path d="M12 16.6V20" stroke="currentColor" stroke-width="2.4" fill="none"/>',
    sound:    '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/>' +
              '<path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" stroke="currentColor" ' +
              'stroke-width="2" fill="none" stroke-linecap="round"/>',
    quiet:    '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/>' +
              '<path d="M15.5 9.5l5 5M20.5 9.5l-5 5" stroke="currentColor" stroke-width="2" ' +
              'fill="none" stroke-linecap="round"/>',
    snow:     '<circle cx="12" cy="12" r="5.5"/>' +
              '<g stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
              '<path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2.2 2.2M16.8 16.8L19 19M19 5l-2.2 2.2M7.2 16.8L5 19"/></g>',
    balloon:  '<path d="M12 2a6 6 0 0 1 6 6c0 4-4 7-6 7s-6-3-6-7a6 6 0 0 1 6-6z"/>' +
              '<path d="M12 15l-1.4 2h2.8z"/>' +
              '<path d="M12 17c0 3-3 2.5-3 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    copy:     '<rect x="8" y="2.5" width="12" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="3.5" y="6.5" width="12" height="15" rx="2.5"/>',
    trophy:   '<path d="M7 3h10v5a5 5 0 0 1-10 0z"/><path d="M4 4h3v3a3 3 0 0 1-3-3zM17 4h3a3 3 0 0 1-3 3z"/><rect x="10.5" y="13" width="3" height="4"/><rect x="7" y="17" width="10" height="3" rx="1.2"/>',
    flame:    '<path d="M13.6 1.4c.6 3.4-1.9 4.6-1.9 6.9 0 1 .6 1.7 1.4 1.7 1.1 0 1.6-.9 1.7-2.1 1.9 1.7 3.2 3.9 3.2 6.2a6.2 6.2 0 0 1-12.4 0c0-3.1 1.8-5 3.4-6.6 1.9-1.9 3.9-3.4 4.6-6.1z"/><path d="M12 13c1.6 1 2.4 2.2 2.4 3.5a2.4 2.4 0 0 1-4.8 0c0-1.2.9-2.4 2.4-3.5z" fill="rgba(0,0,0,.25)"/>',
    clock:    '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.2l4 2.4-1 1.7-5-3V7z"/>',
    medal:    '<path d="M6 2h4l3 7H9zM14 2h4l-3 7h-4z"/><circle cx="12" cy="16" r="6"/>',
    target:   '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="1.9"/>',
    laser:    '<path d="M3 8h9v3.2l8-4.2v10.4l-8-4.2V17a3 3 0 0 1-6 0v-3H3z"/>',
    kart:     '<path d="M3 15h18l-2-5h-4l-2-3H8l-1 3H5z"/><circle cx="7" cy="18" r="2.6"/><circle cx="17" cy="18" r="2.6"/>',
    bricks:   '<rect x="2" y="4" width="9" height="6" rx="1"/><rect x="13" y="4" width="9" height="6" rx="1"/><rect x="2" y="14" width="9" height="6" rx="1"/><rect x="13" y="14" width="9" height="6" rx="1"/>',
    gem:      '<path d="M7 3h10l5 6-10 12L2 9z"/>',
    dragon:   '<path d="M4 12a8 8 0 0 1 16 0v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M6 4l3 4M18 4l-3 4" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="9.5" cy="12" r="1.8" fill="#fff"/><circle cx="14.5" cy="12" r="1.8" fill="#fff"/>',
    key:      '<circle cx="8" cy="8" r="5"/><path d="M11 11l9 9-2 2-2-2-2 2-2-2 2-2z"/>',
    inbox:    '<path d="M12 2v9M8 8l4 4 4-4" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-5l-1.5 2.5h-5L8 14z"/>',
    save:     '<path d="M3.5 3.5h12.5l4.5 4.5v12.5h-17z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><rect x="8" y="3.5" width="6" height="5"/><rect x="7" y="13" width="10" height="7.5" rx="1"/>',
    spark:    '<path d="M12 1l2.2 6.4L21 9.5l-6.8 2.1L12 18l-2.2-6.4L3 9.5l6.8-2.1z"/><path d="M19 15l1 2.6 2.7.9-2.7.9L19 22l-1-2.6-2.7-.9 2.7-.9z"/>',
    flag:     '<path d="M5 2v20h2.5v-8H20l-3-5 3-5z"/>',
    // the eight collectable cards: shapes, so they read at any size
    star:     '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.4 6.6L12 17.2 5.9 20.5l1.4-6.6L2.4 9.4l6.6-.8z"/>',
    moon:     '<path d="M20 15.5A9 9 0 0 1 8.5 4 9.5 9.5 0 1 0 20 15.5z"/>',
    leaf:     '<path d="M20 3C10 3 4 8 4 15c0 2 .7 4 2 5.5L18 8l-9.5 13.5C17 21 21 14 20 3z"/>',
    drop:     '<path d="M12 2.5c4 5.2 6.5 8.5 6.5 12a6.5 6.5 0 0 1-13 0c0-3.5 2.5-6.8 6.5-12z"/>',
    bolt:     '<path d="M13.5 2L4 13.5h5.5L10 22l9.5-11.5H14z"/>',
    crown:    '<path d="M3 8l4 4 5-7 5 7 4-4-2 12H5z"/><rect x="5" y="20" width="14" height="2.2" rx="1"/>',
    rope:     '<path d="M2 12h20" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>' +
              '<rect x="9.5" y="6" width="5" height="12" rx="1.5"/>',
    coin:     '<ellipse cx="12" cy="16.5" rx="9" ry="4.5"/>' +
              '<ellipse cx="12" cy="11" rx="9" ry="4.5"/><ellipse cx="12" cy="7" rx="7" ry="3.5"/>',
    cards:    '<rect x="3" y="6" width="10" height="14" rx="2" transform="rotate(-8 8 13)"/>' +
              '<rect x="11" y="4" width="10" height="14" rx="2" transform="rotate(8 16 11)"/>',
    tick:     '<path d="M9.6 17.2 4.4 12l1.9-1.9 3.3 3.3 7.9-7.9L19.4 7z"/>',
    cross:    '<path d="M18.4 7 17 5.6 12 10.6 7 5.6 5.6 7l5 5-5 5L7 18.4l5-5 5 5 1.4-1.4-5-5z"/>',
    ghost:    '<path d="M4 21V11a8 8 0 0 1 16 0v10l-3-2-2.5 2L12 19l-2.5 2L7 19z"/><circle cx="9.5" cy="10" r="1.9" fill="#fff"/><circle cx="14.5" cy="10" r="1.9" fill="#fff"/>',
    warn:     '<path d="M12 2 23 21H1z"/><rect x="10.8" y="8" width="2.4" height="7" rx="1.2" fill="#fff"/><circle cx="12" cy="17.6" r="1.4" fill="#fff"/>',
    wave:     '<path d="M7 12V4.5a1.8 1.8 0 0 1 3.5 0V11V3a1.8 1.8 0 0 1 3.5 0v8V5a1.8 1.8 0 0 1 3.5 0v8.5c0 4.5-2.5 7.5-6 7.5s-6-2.6-7-6l-1-3.4a1.7 1.7 0 0 1 3-1.6z"/>',
    handshake:'<path d="M2 8.5h5.5L12 6l4.5 2.5H22v6.5h-4l-2.5 3.5-3.5-2.5-3.5 2.5L6 15H2z"/>',
    send:     '<path d="M2.5 21 22 12 2.5 3 2.5 10l13 2-13 2z"/>',
    trash:    '<path d="M9 2h6l1 2h4v2H4V4h4z"/><path d="M6 8h12l-1 13a1.6 1.6 0 0 1-1.6 1.5H8.6A1.6 1.6 0 0 1 7 21z"/>',
    link:     '<path d="M9.5 13.5a4.4 4.4 0 0 0 6.2 0l3.4-3.4a4.4 4.4 0 0 0-6.2-6.2L11 5.8l1.8 1.8 1.9-1.9a1.9 1.9 0 0 1 2.6 2.6l-3.4 3.4a1.9 1.9 0 0 1-2.6 0z"/><path d="M14.5 10.5a4.4 4.4 0 0 0-6.2 0l-3.4 3.4a4.4 4.4 0 0 0 6.2 6.2l1.9-1.9-1.8-1.8-1.9 1.9a1.9 1.9 0 0 1-2.6-2.6l3.4-3.4a1.9 1.9 0 0 1 2.6 0z"/>'
  };

  function icon(name, size = 20, colour) {
    const body = ICON[name];
    if (!body) return '';
    return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"` +
           `${colour ? ` style="color:${colour}"` : ''} fill="currentColor">${body}</svg>`;
  }

  /* ── the logo ─────────────────────────────────────────
   *
   * A Q whose counter is a play button: the letter says which site this is, the
   * triangle says what you do here, and they are the same shape rather than two
   * things stuck together. It is drawn, not typed, so it is the same on every
   * device, and it survives being shrunk to a browser tab — which is where a
   * mark actually has to work.
   *
   *   Sprite.logo(size)               the badge, for a tab or an app icon
   *   Sprite.logo(size, {flat:true})  the mark alone, no badge, for dark bars
   */
  function logo(size = 40, opts = {}) {
    const id = 'lg' + (++uid);
    const flat = !!opts.flat;
    const ink = opts.colour || '#fff';
    const a = opts.from || '#7C4DFF', b = opts.to || '#2BA8FF';
    // the ring is drawn as one path with an even-odd hole, so it stays a ring at
    // any size instead of a stroke that thins out when scaled
    const ring =
      '<path fill-rule="evenodd" d="M45 9.25a33.75 33.75 0 1 1-.01 0z ' +
                                   'M45 25.75a17.25 17.25 0 1 0 .01 0z"/>' +
      '<rect x="55" y="52" width="14" height="30" rx="7" transform="rotate(-42 62 67)"/>' +
      '<path d="M39 34 l18.7 11 -18.7 11z"/>';
    const body = flat
      ? `<g fill="${ink}">${ring}</g>`
      : `<rect x="3" y="3" width="90" height="90" rx="26" fill="url(#${id}g)" stroke="#0A0616" stroke-width="4"/>` +
        `<path d="M9 30a20 20 0 0 1 20-20h38a20 20 0 0 1 20 20v2c-20-10-58-10-78 4z" fill="#fff" opacity=".14"/>` +
        `<g fill="url(#${id}s)">${ring}</g>`;
    return '<svg class="logo-svg" viewBox="0 0 96 96" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      (flat ? '' :
        '<defs>' +
          `<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1">` +
            `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>` +
          `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">` +
            '<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#E6E9FF"/></linearGradient>' +
        '</defs>') +
      body + '</svg>';
  }

  /**
   * Just the silhouette, on its own and filling the box.
   *
   * On the whole character the silhouette is a small part of a small drawing,
   * and at thumbnail size twelve of them look identical — which is no use when
   * a child is choosing between them. Here it is drawn alone and large.
   */
  function crest(shape, size = 44, colour) {
    const body = CREST[((Math.round(Number(shape) || 0) % CREST.length) + CREST.length) % CREST.length];
    const paint = colour || SKIN[0];
    // the silhouettes are drawn in the top half of a 64x64 box; this lifts that
    // half out and fills the tile with it
    return '<svg viewBox="6 2 52 30" width="' + size + '" height="' + size +
      '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<g fill="' + paint + '" color="' + paint + '">' + body + '</g></svg>';
  }

  /* The join screen changes one part at a time, so it needs them separately. */
  const COLOURS = COLOURS_N, SHAPES = CRESTS_N;
  const combine = (colour, shape, rest) => pack(Object.assign({ colour, shape }, rest || {}));
  const partsOf = unpack;

  /** The colour a given avatar wears, so other drawings can match the blook. */
  const colourFor = (n) => SKIN[(Number(n) || 0) % SKIN.length];

  global.Sprite = { face, icon, scene, map, colourFor, crest, logo, freeFace, looksLike,
                    COMBINATIONS, ALL, COLOURS, SHAPES,
                    EYES: EYES_N, MOUTHS: MOUTHS_N, PATTERNS: PATTERNS_N,
                    palette: SKIN.slice(), combine, partsOf, pack, unpack,
                    HATS_N, HAT_NAMES: HAT_NAMES.slice(),
                    names: Object.keys(ICON), scenes: Object.keys(SCENE),
                    maps: Object.keys(MAPART) };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.Sprite;
