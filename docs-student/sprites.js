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
    normal:
      '<rect width="160" height="100" fill="#FFF3D6"/>' +
      '<circle cx="133" cy="22" r="15" fill="#FFD86B"/>' +
      '<rect x="22" y="58" width="30" height="34" rx="4" fill="#BFC7DA"/>' +
      '<rect x="60" y="40" width="30" height="52" rx="4" fill="#FFC53D"/>' +
      '<rect x="98" y="66" width="30" height="26" rx="4" fill="#E0A46B"/>' +
      '<circle cx="75" cy="28" r="9" fill="#F4364C"/><rect x="69" y="30" width="12" height="4" rx="2" fill="#C42539"/>' +
      '<circle cx="37" cy="47" r="7.5" fill="#4F6BFF"/><rect x="31" y="49" width="12" height="4" rx="2" fill="#3B51C9"/>' +
      '<circle cx="113" cy="55" r="7.5" fill="#12BE8E"/><rect x="107" y="57" width="12" height="4" rx="2" fill="#0C8E6A"/>' +
      '<rect y="92" width="160" height="8" fill="#E7D7B4"/>',
    laser:
      '<rect width="160" height="100" fill="#EDF1FF"/>' +
      '<circle cx="34" cy="50" r="17" fill="#F4364C"/><circle cx="29" cy="45" r="3.6" fill="#fff"/>' +
      '<circle cx="126" cy="50" r="17" fill="#4F6BFF"/><circle cx="131" cy="45" r="3.6" fill="#fff"/>' +
      '<rect x="53" y="46" width="54" height="8" rx="4" fill="#FFC53D"/>' +
      '<path d="M107 41 l15 9 -15 9z" fill="#FF7A45"/><path d="M53 41 l-15 9 15 9z" fill="#FF7A45"/>' +
      '<rect x="18" y="76" width="32" height="7" rx="3.5" fill="#F4364C" opacity=".45"/>' +
      '<rect x="110" y="76" width="32" height="7" rx="3.5" fill="#4F6BFF" opacity=".45"/>' +
      '<rect y="92" width="160" height="8" fill="#D6DDF6"/>',
    kart:
      '<rect width="160" height="100" fill="#E8F6FF"/>' +
      '<rect y="56" width="160" height="36" fill="#4A4560"/>' +
      '<g fill="#FFF6D8"><rect x="8" y="72" width="16" height="4" rx="2"/><rect x="36" y="72" width="16" height="4" rx="2"/>' +
      '<rect x="64" y="72" width="16" height="4" rx="2"/><rect x="92" y="72" width="16" height="4" rx="2"/>' +
      '<rect x="120" y="72" width="16" height="4" rx="2"/></g>' +
      '<path d="M44 65 h44 l-6-13 h-9 l-5-8 h-13 l-3 8 h-5z" fill="#F4364C"/>' +
      '<circle cx="55" cy="67" r="7.5" fill="#241C38"/><circle cx="55" cy="67" r="2.8" fill="#BFC7DA"/>' +
      '<circle cx="80" cy="67" r="7.5" fill="#241C38"/><circle cx="80" cy="67" r="2.8" fill="#BFC7DA"/>' +
      '<circle cx="66" cy="45" r="7.5" fill="#FFC53D"/>' +
      '<g fill="#2BA8FF" opacity=".75"><rect x="10" y="40" width="24" height="4" rx="2"/><rect x="18" y="50" width="15" height="4" rx="2"/></g>' +
      '<rect y="92" width="160" height="8" fill="#39344D"/>',
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
    treasure:
      '<rect width="160" height="100" fill="#FFF0F5"/>' +
      '<path d="M48 45 a32 22 0 0 1 64 0z" fill="#B4713A"/>' +
      '<rect x="46" y="45" width="68" height="33" rx="5" fill="#D4924E"/>' +
      '<rect x="46" y="51" width="68" height="7" fill="#8C5A2B"/>' +
      '<rect x="74" y="45" width="12" height="20" rx="2" fill="#8C5A2B"/>' +
      '<circle cx="80" cy="57" r="3.4" fill="#FFC53D"/>' +
      '<g fill="#FFC53D"><circle cx="36" cy="72" r="7"/><circle cx="126" cy="70" r="7"/><circle cx="30" cy="84" r="5.5"/></g>' +
      '<path d="M120 16 l5 11 11 5 -11 5 -5 11 -5-11 -11-5 11-5z" fill="#2BA8FF"/>' +
      '<path d="M34 24 l3.5 8 8 3.5 -8 3.5 -3.5 8 -3.5-8 -8-3.5 8-3.5z" fill="#E8467C"/>' +
      '<rect y="91" width="160" height="9" fill="#F3D9E3"/>',
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
    snow:
      '<rect width="160" height="100" fill="#E9F4FF"/>' +
      '<g fill="#fff"><circle cx="24" cy="18" r="4"/><circle cx="70" cy="12" r="3"/><circle cx="112" cy="22" r="3.5"/>' +
      '<circle cx="140" cy="10" r="2.6"/><circle cx="48" cy="30" r="2.4"/></g>' +
      // two forts facing each other, one already losing its top row
      '<g fill="#F4364C"><rect x="10" y="60" width="15" height="11" rx="2"/><rect x="27" y="60" width="15" height="11" rx="2"/>' +
      '<rect x="10" y="73" width="15" height="11" rx="2"/><rect x="27" y="73" width="15" height="11" rx="2"/>' +
      '<rect x="18" y="47" width="15" height="11" rx="2"/></g>' +
      '<g fill="#4F6BFF"><rect x="118" y="60" width="15" height="11" rx="2"/><rect x="135" y="60" width="15" height="11" rx="2"/>' +
      '<rect x="118" y="73" width="15" height="11" rx="2"/><rect x="135" y="73" width="15" height="11" rx="2"/></g>' +
      // a snowball mid-flight, with the arc it came in on
      '<path d="M46 56 Q66 26 96 40" stroke="#C3DCF3" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-dasharray="5 6"/>' +
      '<circle cx="96" cy="40" r="8.5" fill="#fff" stroke="#7FA8CE" stroke-width="2.5"/>' +
      '<circle cx="93" cy="37" r="2.6" fill="#EAF4FF"/>' +
      '<circle cx="60" cy="30" r="4" fill="#fff" stroke="#7FA8CE" stroke-width="1.8"/>' +
      '<rect y="88" width="160" height="12" fill="#fff"/>',
    balloon:
      '<rect width="160" height="100" fill="#FFF6E8"/>' +
      '<g stroke="#C9B79B" stroke-width="1.4" fill="none">' +
      '<path d="M34 44c0 12-4 10-4 20M76 34c0 14-5 12-5 24M118 48c0 10-4 9-4 18"/></g>' +
      '<path d="M34 16a13 13 0 0 1 13 13c0 9-9 15-13 15s-13-6-13-15a13 13 0 0 1 13-13z" fill="#F4364C"/>' +
      '<path d="M76 6a14 14 0 0 1 14 14c0 10-9 16-14 16s-14-6-14-16a14 14 0 0 1 14-14z" fill="#FFC53D"/>' +
      '<path d="M118 20a12 12 0 0 1 12 12c0 8-8 14-12 14s-12-6-12-14a12 12 0 0 1 12-12z" fill="#2BA8FF"/>' +
      // one that has just burst
      '<g fill="#E8467C"><path d="M140 58l4-7 1 6 6-2-4 6 6 3-7 1 2 6-6-4-3 6-1-7-6 2 4-5-6-3z"/></g>' +
      '<circle cx="30" cy="76" r="7.5" fill="#7C4DFF"/><circle cx="72" cy="78" r="7.5" fill="#12BE8E"/>' +
      '<circle cx="114" cy="77" r="7.5" fill="#FF7A45"/>' +
      '<rect y="88" width="160" height="12" fill="#F0E2CB"/>',

    // two teams either side of one rope, with the marker over the line
    tug:
      '<rect width="160" height="100" fill="#DFF3E1"/>' +
      '<rect y="72" width="160" height="28" fill="#9BD6A4"/>' +
      '<path d="M78 66h4v34h-4z" fill="#E8DCC0"/>' +          // the centre line
      '<path d="M14 60h132" stroke="#C99A5B" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M74 52h12v16H74z" fill="#F4364C"/>' +          // the marker, pulled left
      '<g fill="#4F6BFF"><circle cx="112" cy="48" r="9"/><rect x="104" y="57" width="16" height="18" rx="6"/></g>' +
      '<g fill="#4F6BFF"><circle cx="136" cy="50" r="8"/><rect x="129" y="58" width="14" height="16" rx="6"/></g>' +
      '<g fill="#F4364C"><circle cx="44" cy="47" r="9"/><rect x="36" y="56" width="16" height="19" rx="6"/></g>' +
      '<g fill="#F4364C"><circle cx="20" cy="50" r="8"/><rect x="13" y="58" width="14" height="16" rx="6"/></g>',

    // a vault with a pile in front of it, and one bag walking away
    heist:
      '<rect width="160" height="100" fill="#2A2140"/>' +
      '<rect x="20" y="14" width="70" height="62" rx="6" fill="#4A3E6B"/>' +
      '<circle cx="55" cy="45" r="17" fill="#6C5A96"/><circle cx="55" cy="45" r="7" fill="#FFC53D"/>' +
      '<path d="M55 28v-6M55 68v-6M38 45h-6M78 45h-6" stroke="#FFC53D" stroke-width="3" stroke-linecap="round"/>' +
      '<g fill="#FFC53D">' +
      '<ellipse cx="112" cy="80" rx="26" ry="9"/><ellipse cx="106" cy="72" rx="17" ry="7"/>' +
      '<ellipse cx="118" cy="66" rx="11" ry="5"/></g>' +
      '<path d="M128 30c6-6 16-6 22 0 5 6 4 20-11 24-15-4-16-18-11-24z" fill="#8C7BB8"/>' +
      '<text x="139" y="49" font-size="13" font-weight="800" fill="#2A2140" text-anchor="middle">$</text>' +
      '<rect y="88" width="160" height="12" fill="#1E1730"/>',

    // a hand of cards, one of each shape, with a gap where the last one goes
    cards:
      '<rect width="160" height="100" fill="#F3ECFF"/>' +
      '<g stroke="#2A2140" stroke-width="2">' +
      '<rect x="12" y="30" width="30" height="44" rx="5" fill="#fff" transform="rotate(-9 27 52)"/>' +
      '<rect x="46" y="26" width="30" height="44" rx="5" fill="#fff" transform="rotate(-3 61 48)"/>' +
      '<rect x="80" y="26" width="30" height="44" rx="5" fill="#fff" transform="rotate(3 95 48)"/>' +
      '<rect x="114" y="30" width="30" height="44" rx="5" fill="#EDE3FF" stroke-dasharray="5 4"' +
      ' transform="rotate(9 129 52)"/></g>' +
      '<path d="M27 41l3.4 7 7.6.8-5.7 5 1.7 7.5L27 57.6 20 61.3l1.7-7.5-5.7-5 7.6-.8z" fill="#FFC53D"/>' +
      '<path d="M61 38c7 2 10 8 8 14s-9 8-15 5c6 1 10-3 11-8s-1-9-4-11z" fill="#4F6BFF"/>' +
      '<path d="M95 38c7 4 9 12 4 18-4 5-11 4-13-1 4 2 8 0 9-4s0-9-1-13z" fill="#F4364C"/>' +
      '<rect y="88" width="160" height="12" fill="#DCCFF5"/>'
  };

  function scene(name, width = 160) {
    const body = SCENE[name] || SCENE.normal;
    return '<svg class="scene" viewBox="0 0 160 100" width="' + width + '" height="' + Math.round(width / 1.6) + '"' +
           ' preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + body + '</svg>';
  }

  /* ── interface icons ─────────────────────────────────────
   * One flat style: 24x24, filled, no strokes to go thin when scaled down. */
  const ICON = {
    play:     '<path d="M8 5.5v13l11-6.5z"/>',
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

  global.Sprite = { face, icon, scene, crest, logo, freeFace, looksLike,
                    COMBINATIONS, ALL, COLOURS, SHAPES,
                    EYES: EYES_N, MOUTHS: MOUTHS_N, PATTERNS: PATTERNS_N,
                    palette: SKIN.slice(), combine, partsOf, pack, unpack,
                    HATS_N, HAT_NAMES: HAT_NAMES.slice(),
                    names: Object.keys(ICON), scenes: Object.keys(SCENE) };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.Sprite;
