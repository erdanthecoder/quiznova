/* Cover pictures for quizzes.
 *
 * A shelf of quizzes with a letter on each one is a filing cabinet. A shelf
 * with pictures on it is something a child leans over to look at, and a teacher
 * finds the one they want on by shape and colour before they have read a single
 * word. That is the whole argument for drawing thirty of these.
 *
 * They are drawn, not fetched. No stock photographs, no clipart, no image host
 * that can go down and leave a page full of broken boxes — every one is a few
 * flat shapes in the same 160x100 box the game scenes already use, in the same
 * palette, with the same heavy outline. They cost nothing to load, they are the
 * same on every device, and they still read at the size of a thumbnail, which
 * is the size they are actually looked at.
 *
 * The rule each picture follows: draw the thing, not a symbol for the thing.
 * Fractions is a pizza with slices taken, not the numeral one over four.
 * Subtraction is birds leaving a wire. A child who cannot read the title yet
 * can still tell you which one is the space quiz.
 *
 *   Sprite.cover('fractions', 240)    the picture, as an <svg> string
 *   Sprite.coverFor('Times tables')   works the topic out from a title
 */
(function (global) {
  'use strict';

  const INK = '#1B1330';
  /** An outlined shape: everything here is drawn the way the blooks are. */
  const o = (body, w) => `<g stroke="${INK}" stroke-width="${w || 3}" stroke-linejoin="round">${body}</g>`;
  const sky = (c) => `<rect width="160" height="100" fill="${c}"/>`;

  /* A few pieces that turn up in more than one picture, so thirty drawings do
     not become thirty separate inventions of the same cloud. */
  const sun = (x, y, r) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFC53D" stroke="${INK}" stroke-width="3"/>`;
  const grass = (c) => `<path d="M0 88h160v12H0z" fill="${c || '#8FD98A'}"/>` +
    `<path d="M0 88h160" stroke="${INK}" stroke-width="3"/>`;
  const star = (x, y, r, c) => {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? r * 0.44 : r;
      d += (i ? 'L' : 'M') + (x + Math.cos(a) * rr).toFixed(1) + ' ' + (y + Math.sin(a) * rr).toFixed(1);
    }
    return `<path d="${d}Z" fill="${c || '#FFC53D'}"/>`;
  };

  const COVER = {

    /* ── maths ─────────────────────────────────────────────
       Number work is abstract, which is exactly why the pictures must not be.
       Every one of these is a thing you could put on a table. */

    // two heaps of apples being pushed together
    addition:
      sky('#FFF1DC') + grass('#9BE0A2') +
      o('<circle cx="34" cy="66" r="11" fill="#F4364C"/><circle cx="52" cy="72" r="11" fill="#FF7A45"/>' +
        '<circle cx="43" cy="52" r="11" fill="#F4364C"/>' +
        '<circle cx="112" cy="66" r="11" fill="#12BE8E"/><circle cx="128" cy="58" r="11" fill="#12BE8E"/>') +
      o('<path d="M72 60h18M81 51v18" stroke-linecap="round"/>', 7) +
      '<path d="M72 60h18M81 51v18" stroke="#7C4DFF" stroke-width="7" stroke-linecap="round"/>',

    // birds on a wire, two of them already gone
    subtraction:
      sky('#E7F3FF') + sun(136, 20, 12) +
      '<path d="M0 58h160" stroke="' + INK + '" stroke-width="3"/>' +
      // three still sitting: a body, a wing, a beak
      [28, 56, 84].map(x =>
        o(`<path d="M${x - 10} 50c0-7 5-11 11-11s11 5 11 12l6 6h-8l-4 3h-9c-5 0-7-4-7-10z" fill="#4F6BFF"/>`) +
        `<path d="M${x - 2} 45c4-2 8 0 9 4-4 2-8 1-9-4z" fill="#2F49C9"/>` +
        `<circle cx="${x + 5}" cy="43" r="1.9" fill="${INK}"/>` +
        `<path d="M${x + 11} 45l6 2-6 2z" fill="#FFC53D"/>`).join('') +
      // and two already up and away
      '<g opacity=".6">' +
      o('<path d="M106 28c5-6 11-6 15 0-5 4-10 4-15 0z" fill="#4F6BFF"/>' +
        '<path d="M128 14c5-6 11-6 15 0-5 4-10 4-15 0z" fill="#4F6BFF"/>') + '</g>' +
      '<path d="M96 74h24" stroke="#F4364C" stroke-width="8" stroke-linecap="round"/>' +
      grass('#9BE0A2'),

    // an array: four rows of three, which is what times tables actually are
    times: (() => {
      let dots = '';
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          dots += `<circle cx="${46 + c * 22}" cy="${34 + r * 22}" r="8" fill="#7C4DFF"/>`;
        }
      }
      return sky('#F1ECFF') +
        '<rect x="30" y="18" width="100" height="70" rx="9" fill="#fff" stroke="' + INK + '" stroke-width="3"/>' +
        o(dots);
    })(),

    // six biscuits shared onto three plates, two each
    division:
      sky('#FFEFF4') +
      [26, 80, 134].map(x =>
        o(`<ellipse cx="${x}" cy="72" rx="24" ry="9" fill="#fff"/>`) +
        o(`<circle cx="${x - 9}" cy="64" r="10" fill="#C08A4E"/><circle cx="${x + 9}" cy="64" r="10" fill="#C08A4E"/>`) +
        `<g fill="#6B4423"><circle cx="${x - 12}" cy="61" r="2"/><circle cx="${x - 6}" cy="67" r="2"/>` +
        `<circle cx="${x + 12}" cy="66" r="2"/><circle cx="${x + 6}" cy="60" r="2"/></g>`).join('') +
      // a division sign over each gap: a dot, a bar, a dot
      [53, 107].map(x =>
        `<g fill="${INK}" opacity=".55"><circle cx="${x}" cy="20" r="3.4"/>` +
        `<rect x="${x - 9}" y="26" width="18" height="4" rx="2"/>` +
        `<circle cx="${x}" cy="36" r="3.4"/></g>`).join(''),

    // one rabbit, then two
    doubling:
      sky('#EAFBF3') + grass('#8FD98A') +
      o('<circle cx="40" cy="62" r="16" fill="#fff"/><ellipse cx="34" cy="43" rx="4.5" ry="11" fill="#fff"/>' +
        '<ellipse cx="46" cy="43" rx="4.5" ry="11" fill="#fff"/>') +
      '<circle cx="36" cy="60" r="2.6" fill="' + INK + '"/><circle cx="46" cy="60" r="2.6" fill="' + INK + '"/>' +
      '<path d="M66 62h16M74 54v16" stroke="#12BE8E" stroke-width="6" stroke-linecap="round"/>' +
      o('<circle cx="104" cy="62" r="14" fill="#fff"/><ellipse cx="99" cy="45" rx="4" ry="10" fill="#fff"/>' +
        '<ellipse cx="110" cy="45" rx="4" ry="10" fill="#fff"/>' +
        '<circle cx="134" cy="62" r="14" fill="#fff"/><ellipse cx="129" cy="45" rx="4" ry="10" fill="#fff"/>' +
        '<ellipse cx="140" cy="45" rx="4" ry="10" fill="#fff"/>'),

    // an apple, cut
    halving:
      sky('#FFF1DC') +
      o('<path d="M74 34c-16 0-24 12-24 26s12 28 24 28V34z" fill="#F4364C"/>' +
        '<path d="M86 34c16 0 24 12 24 26s-12 28-24 28V34z" fill="#FF7A45"/>') +
      '<path d="M74 30v58M86 30v58" stroke="' + INK + '" stroke-width="3"/>' +
      '<path d="M80 34c0-8 6-12 12-13" stroke="#12BE8E" stroke-width="5" fill="none" stroke-linecap="round"/>',

    /* Four jigsaw pieces with one of them out. The first attempt drew the board
       as one shape with a notch, and a notch in a rectangle does not read as a
       missing piece — four tiles and an obvious gap does. */
    missing: (() => {
      // one tile, with a tab on its right edge so the row locks together
      const tile = (x, y, fill) =>
        `<path d="M${x} ${y}h30a6 6 0 0 1 0 12v14h-30z" fill="${fill}"/>`;
      return sky('#EAF7FF') +
        o(tile(24, 30, '#4F6BFF') + tile(64, 30, '#12BE8E') +
          tile(24, 62, '#FFC53D')) +
        // the gap, waiting
        '<path d="M64 62h30a6 6 0 0 1 0 12v14h-30z" fill="#D5E8F7" stroke="' + INK +
        '" stroke-width="3" stroke-dasharray="6 5"/>' +
        // and the piece that belongs in it, held above
        '<g transform="translate(96 -6) rotate(14)">' +
        o('<path d="M8 12h30a6 6 0 0 1 0 12v14H8z" fill="#FF7A45"/>') + '</g>';
    })(),

    // hundreds, tens and ones, in columns
    place:
      sky('#F1ECFF') +
      o('<rect x="16" y="20" width="40" height="66" rx="5" fill="#fff"/>' +
        '<rect x="60" y="20" width="40" height="66" rx="5" fill="#fff"/>' +
        '<rect x="104" y="20" width="40" height="66" rx="5" fill="#fff"/>') +
      '<g fill="#7C4DFF"><rect x="24" y="30" width="24" height="48" rx="3"/></g>' +
      '<g fill="#12BE8E"><rect x="68" y="34" width="10" height="44" rx="3"/>' +
      '<rect x="82" y="34" width="10" height="44" rx="3"/></g>' +
      '<g fill="#FFC53D"><circle cx="114" cy="42" r="6"/><circle cx="130" cy="42" r="6"/>' +
      '<circle cx="114" cy="62" r="6"/></g>',

    // a pizza with two slices gone
    fractions:
      sky('#FFF1DC') +
      o('<circle cx="80" cy="52" r="34" fill="#FFC53D"/>') +
      '<path d="M80 52 L80 18 A34 34 0 0 1 104 28 Z" fill="#FFF7EC"/>' +
      '<path d="M80 52 L104 28 A34 34 0 0 1 114 52 Z" fill="#FFF7EC"/>' +
      '<g stroke="' + INK + '" stroke-width="3" fill="none">' +
      '<path d="M80 52V18M80 52l24-24M80 52h34M80 52l24 24M80 52H46"/></g>' +
      '<g fill="#F4364C"><circle cx="66" cy="66" r="4.5"/><circle cx="92" cy="70" r="4.5"/>' +
      '<circle cx="60" cy="44" r="4.5"/></g>',

    // a purse and some coins
    money:
      sky('#FFF6DF') +
      o('<path d="M36 50h58a10 10 0 0 1 10 10v20a8 8 0 0 1-8 8H34a8 8 0 0 1-8-8V60a10 10 0 0 1 10-10z" fill="#B06A3B"/>') +
      '<path d="M26 62h84" stroke="' + INK + '" stroke-width="3"/>' +
      '<circle cx="92" cy="74" r="6" fill="#FFC53D" stroke="' + INK + '" stroke-width="3"/>' +
      o('<circle cx="118" cy="34" r="15" fill="#FFC53D"/><circle cx="136" cy="52" r="13" fill="#FFD76B"/>') +
      '<circle cx="118" cy="34" r="8" fill="none" stroke="' + INK + '" stroke-width="2.6" opacity=".5"/>' +
      '<circle cx="136" cy="52" r="7" fill="none" stroke="' + INK + '" stroke-width="2.4" opacity=".4"/>',

    // a clock, hands at ten past
    time:
      sky('#EAF7FF') +
      o('<circle cx="80" cy="50" r="34" fill="#fff"/>') +
      '<g stroke="' + INK + '" stroke-width="3" stroke-linecap="round">' +
      '<path d="M80 26v4M80 70v4M56 50h4M100 50h4"/></g>' +
      '<path d="M80 50V32" stroke="#F4364C" stroke-width="4.5" stroke-linecap="round"/>' +
      '<path d="M80 50l17 9" stroke="' + INK + '" stroke-width="4.5" stroke-linecap="round"/>' +
      '<circle cx="80" cy="50" r="4" fill="' + INK + '"/>' +
      o('<path d="M64 16l-9-8M96 16l9-8" fill="none"/>'),

    // a pair of scales, one side heavier
    compare:
      sky('#F1ECFF') +
      '<path d="M80 22v52" stroke="' + INK + '" stroke-width="4"/>' +
      '<path d="M34 34h92" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>' +
      o('<path d="M18 34l16 26H2z" fill="#4F6BFF"/><path d="M126 34l16 18h-32z" fill="#FFC53D"/>') +
      o('<path d="M62 74h36l6 14H56z" fill="#7C4DFF"/>') +
      '<circle cx="80" cy="22" r="6" fill="#fff" stroke="' + INK + '" stroke-width="3"/>',

    // a number line, and an arrow snapping to the nearest ten
    rounding:
      sky('#EAFBF3') +
      '<path d="M12 62h136" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>' +
      '<g stroke="' + INK + '" stroke-width="3">' +
      '<path d="M22 54v16M52 58v12M82 58v12M112 58v12M142 54v16"/></g>' +
      '<path d="M96 40c14 0 24 8 26 16" stroke="#F4364C" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<path d="M122 62l-8-5 2 10z" fill="#F4364C"/>' +
      '<circle cx="96" cy="36" r="9" fill="#FFC53D" stroke="' + INK + '" stroke-width="3"/>',

    // two pairs of socks, and one with nobody to go with
    oddeven:
      sky('#FFEFF4') + grass('#F7C9D8') +
      o('<path d="M18 30h14v28c0 9 11 9 11 18v12H18z" fill="#4F6BFF"/>' +
        '<path d="M38 30h14v28c0 9 11 9 11 18v12H38z" fill="#4F6BFF"/>' +
        '<path d="M74 30h14v28c0 9 11 9 11 18v12H74z" fill="#12BE8E"/>' +
        '<path d="M94 30h14v28c0 9 11 9 11 18v12H94z" fill="#12BE8E"/>') +
      // the odd one, tipped over on its own
      '<g transform="rotate(16 136 60)">' +
      o('<path d="M128 34h14v26c0 9 11 9 11 18v10h-25z" fill="#FFC53D"/>') + '</g>',

    // stepping stones across water, every other one lit
    counting:
      sky('#DCEEFF') +
      '<path d="M0 66h160v34H0z" fill="#7FC3F0"/>' +
      '<path d="M0 66h160" stroke="' + INK + '" stroke-width="3"/>' +
      o('<ellipse cx="24" cy="66" rx="15" ry="8" fill="#FFC53D"/>' +
        '<ellipse cx="62" cy="60" rx="15" ry="8" fill="#CFCADF"/>' +
        '<ellipse cx="100" cy="66" rx="15" ry="8" fill="#FFC53D"/>' +
        '<ellipse cx="138" cy="60" rx="15" ry="8" fill="#CFCADF"/>'),

    // three shapes, plainly
    shapes:
      sky('#F1ECFF') +
      o('<path d="M36 74L54 40l18 34z" fill="#F4364C"/>' +
        '<rect x="80" y="44" width="30" height="30" rx="4" fill="#4F6BFF"/>' +
        '<path d="M130 44l12 7v14l-12 7-12-7V51z" fill="#12BE8E"/>'),

    /* ── english ───────────────────────────────────────────
       Words are even harder to draw than numbers, so these lean on objects:
       cards, labels, a mirror, an ear. */

    // word cards, fanned out, with one picked and underlined
    wordclass:
      sky('#EAF7FF') +
      '<g transform="rotate(-9 40 54)">' +
      o('<rect x="14" y="34" width="46" height="30" rx="6" fill="#F4364C"/>') +
      '<rect x="22" y="46" width="30" height="6" rx="3" fill="#fff" opacity=".9"/></g>' +
      '<g transform="rotate(-3 76 50)">' +
      o('<rect x="52" y="30" width="46" height="30" rx="6" fill="#FFC53D"/>') +
      '<rect x="60" y="42" width="30" height="6" rx="3" fill="#fff" opacity=".9"/></g>' +
      '<g transform="rotate(7 116 46)">' +
      o('<rect x="94" y="28" width="46" height="30" rx="6" fill="#12BE8E"/>') +
      '<rect x="102" y="40" width="30" height="6" rx="3" fill="#fff" opacity=".9"/></g>' +
      // the one that has been picked, underlined by hand
      '<path d="M50 78c14-5 30-6 46-2s26 3 34-1" stroke="#7C4DFF" stroke-width="5" ' +
      'fill="none" stroke-linecap="round"/>' +
      '<path d="M126 70c5 2 8 4 9 7-4 2-7 2-10 1" fill="#7C4DFF"/>',

    // one fish, then a shoal
    plurals:
      sky('#DCEEFF') +
      o('<path d="M20 50c10-12 26-12 34 0-8 12-24 12-34 0z" fill="#FF7A45"/>' +
        '<path d="M20 50l-10-8v16z" fill="#FF7A45"/>') +
      '<circle cx="44" cy="47" r="2.6" fill="' + INK + '"/>' +
      o('<path d="M84 30c8-10 20-10 26 0-6 10-18 10-26 0z" fill="#4F6BFF"/><path d="M84 30l-8-6v12z" fill="#4F6BFF"/>' +
        '<path d="M100 56c8-10 20-10 26 0-6 10-18 10-26 0z" fill="#12BE8E"/><path d="M100 56l-8-6v12z" fill="#12BE8E"/>' +
        '<path d="M80 78c8-10 20-10 26 0-6 10-18 10-26 0z" fill="#7C4DFF"/><path d="M80 78l-8-6v12z" fill="#7C4DFF"/>'),

    // a sun and a snowflake, facing each other
    opposites:
      sky('#F3F0FF') +
      '<path d="M80 0v100" stroke="' + INK + '" stroke-width="3" stroke-dasharray="7 7"/>' +
      '<rect width="80" height="100" fill="#FFE2B8"/>' + sun(40, 50, 20) +
      '<g stroke="#FFC53D" stroke-width="4" stroke-linecap="round">' +
      '<path d="M40 20v-8M40 88v-8M10 50H2M78 50h-8M18 28l-6-6M62 72l6 6M62 28l6-6M18 72l-6 6"/></g>' +
      '<rect x="80" width="80" height="100" fill="#DCEEFF"/>' +
      '<g stroke="#4F6BFF" stroke-width="4.5" stroke-linecap="round">' +
      '<path d="M120 26v48M99 38l42 24M141 38l-42 24"/></g>' +
      '<circle cx="120" cy="50" r="7" fill="#fff" stroke="' + INK + '" stroke-width="3"/>',

    // two different words, and an arrow saying they swap
    synonyms:
      sky('#EAFBF3') +
      o('<rect x="10" y="26" width="52" height="34" rx="7" fill="#12BE8E"/>' +
        '<rect x="98" y="40" width="52" height="34" rx="7" fill="#0E9C74"/>') +
      '<g fill="#fff"><rect x="18" y="38" width="36" height="6" rx="3"/>' +
      '<rect x="18" y="49" width="24" height="6" rx="3"/>' +
      '<rect x="106" y="52" width="36" height="6" rx="3"/>' +
      '<rect x="106" y="63" width="24" height="6" rx="3"/></g>' +
      // an arrow curving from one to the other, and back
      '<path d="M64 36c14-8 26-4 34 6" stroke="' + INK + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<path d="M98 42l-11-2 5-7z" fill="' + INK + '"/>' +
      '<path d="M96 66c-14 8-26 4-34-6" stroke="' + INK + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<path d="M62 60l11 2-5 7z" fill="' + INK + '"/>',

    // an ear, and two sound waves coming into it
    homophones:
      sky('#FFF1DC') +
      o('<path d="M58 22c22 0 34 16 32 34-2 16-14 18-16 30-2 10-16 12-22 4-6-9 4-14 2-22-2-9-14-10-14-24 0-14 8-22 18-22z" fill="#FFD9B8"/>') +
      '<path d="M58 44c8-6 16 0 14 10" stroke="' + INK + '" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<g stroke="#7C4DFF" stroke-width="4" fill="none" stroke-linecap="round">' +
      '<path d="M104 34a22 22 0 0 1 0 32"/><path d="M118 24a38 38 0 0 1 0 52"/></g>',

    // A, B and C on cards, drawn as letters rather than as bars
    alphabetical:
      sky('#EAF7FF') + grass('#CFE6FF') +
      o('<rect x="16" y="34" width="38" height="50" rx="6" fill="#F4364C"/>' +
        '<rect x="61" y="34" width="38" height="50" rx="6" fill="#FFC53D"/>' +
        '<rect x="106" y="34" width="38" height="50" rx="6" fill="#12BE8E"/>') +
      // A
      '<path d="M26 72l9-26 9 26M29.5 63h11" stroke="#fff" stroke-width="5" fill="none" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>' +
      // B
      '<path d="M72 46v26h9a6.5 6.5 0 0 0 0-13h-9 9a6.5 6.5 0 0 0 0-13h-9z" stroke="#fff" ' +
      'stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      // C
      '<path d="M133 50a13 13 0 1 0 0 18" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>' +
      '<path d="M50 24h60" stroke="' + INK + '" stroke-width="3.5" stroke-linecap="round"/>' +
      '<path d="M104 18l8 6-8 6z" fill="' + INK + '"/>',

    // a pencil, and a word with a tick after it
    spelling:
      sky('#FFF6DF') +
      o('<path d="M18 74l44-44 14 14-44 44H18z" fill="#FFC53D"/>' +
        '<path d="M66 26l8-8a9 9 0 0 1 13 0l1 1a9 9 0 0 1 0 13l-8 8z" fill="#FF7A45"/>') +
      '<path d="M18 74l6-16 10 10z" fill="#fff" stroke="' + INK + '" stroke-width="3"/>' +
      '<g fill="' + INK + '" opacity=".6"><rect x="86" y="40" width="34" height="5" rx="2.5"/>' +
      '<rect x="86" y="52" width="24" height="5" rx="2.5"/></g>' +
      '<path d="M126 46l7 8 14-18" stroke="#12BE8E" stroke-width="6" fill="none" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>',

    // a question mark and a full stop, drawn big
    punctuation:
      sky('#F1ECFF') +
      o('<circle cx="52" cy="50" r="30" fill="#7C4DFF"/>') +
      '<path d="M44 40c0-6 5-10 10-10s10 4 10 10c0 7-9 7-9 14" stroke="#fff" stroke-width="6" ' +
      'fill="none" stroke-linecap="round"/><circle cx="55" cy="64" r="4.2" fill="#fff"/>' +
      o('<circle cx="116" cy="62" r="18" fill="#FFC53D"/>') +
      '<circle cx="116" cy="62" r="6" fill="' + INK + '"/>',

    /* ── science ───────────────────────────────────────────  */

    // a rocket leaving, a planet behind it
    space:
      sky('#1B1440') +
      star(22, 20, 6) + star(140, 28, 5) + star(120, 72, 4) + star(34, 74, 4.5) +
      o('<circle cx="122" cy="34" r="18" fill="#FF7A45"/>') +
      '<ellipse cx="122" cy="34" rx="28" ry="7" fill="none" stroke="#FFC53D" stroke-width="4"/>' +
      o('<path d="M62 22c12 0 20 16 20 32s-8 26-20 26-20-10-20-26 8-32 20-32z" fill="#fff"/>' +
        '<path d="M42 60l-14 18h18zM82 60l14 18H78z" fill="#F4364C"/>') +
      '<circle cx="62" cy="44" r="8" fill="#4F6BFF" stroke="' + INK + '" stroke-width="3"/>' +
      '<path d="M54 84c4 10 12 10 16 0" fill="#FFC53D"/>',

    // a heart, beating on a trace
    body:
      sky('#FFEFF4') +
      o('<path d="M80 84S38 60 38 40a20 20 0 0 1 42-10 20 20 0 0 1 42 10c0 20-42 44-42 44z" fill="#F4364C"/>') +
      '<path d="M0 54h34l8-14 10 28 8-14h18" stroke="#fff" stroke-width="4" fill="none" ' +
      'stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>',

    // a fox, sitting
    animals:
      sky('#EAFBF3') + grass('#8FD98A') +
      o('<path d="M54 88c0-22 10-34 26-34s26 12 26 34z" fill="#FF7A45"/>' +
        '<circle cx="80" cy="46" r="20" fill="#FF7A45"/>' +
        '<path d="M62 32l-6-18 18 8zM98 32l6-18-18 8z" fill="#FF7A45"/>') +
      '<path d="M80 88c0-14 4-22 12-26" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '<path d="M66 52h28l-14 12z" fill="#fff"/>' +
      '<circle cx="72" cy="44" r="3" fill="' + INK + '"/><circle cx="88" cy="44" r="3" fill="' + INK + '"/>' +
      '<circle cx="80" cy="56" r="3.4" fill="' + INK + '"/>',

    // a seedling coming up, sun above
    plants:
      sky('#DFF3FF') + sun(132, 22, 14) + grass('#A0713F') +
      '<path d="M80 88V46" stroke="#12BE8E" stroke-width="6" stroke-linecap="round"/>' +
      o('<path d="M80 60c-20 0-26-12-26-22 16 0 26 8 26 22z" fill="#12BE8E"/>' +
        '<path d="M80 52c20 0 26-12 26-22-16 0-26 8-26 22z" fill="#5BD99B"/>'),

    // a cloud with rain and sun behind it
    weather:
      sky('#DCEEFF') + sun(44, 30, 18) +
      o('<path d="M62 62a16 16 0 0 1 4-31 22 22 0 0 1 42 4 15 15 0 0 1-2 29z" fill="#fff"/>') +
      '<g stroke="#4F6BFF" stroke-width="5" stroke-linecap="round">' +
      '<path d="M68 70l-6 16M88 70l-6 16M108 70l-6 16"/></g>',

    // three blocks: wood, metal, glass
    materials:
      sky('#F3F0FF') + grass('#CFCADF') +
      o('<rect x="16" y="44" width="40" height="44" rx="4" fill="#B06A3B"/>' +
        '<rect x="62" y="34" width="40" height="54" rx="4" fill="#AEB7C8"/>' +
        '<rect x="108" y="54" width="40" height="34" rx="4" fill="#9BDFF0"/>') +
      '<g stroke="' + INK + '" stroke-width="2.4" opacity=".5">' +
      '<path d="M24 52h24M24 62h24M24 72h24"/></g>' +
      '<path d="M116 60l14 20" stroke="#fff" stroke-width="4" opacity=".8" stroke-linecap="round"/>',

    // a magnet, pulling
    forces:
      sky('#FFF6DF') +
      o('<path d="M48 78V46a32 32 0 0 1 64 0v32H90V46a10 10 0 0 0-20 0v32z" fill="#F4364C"/>') +
      '<rect x="48" y="66" width="22" height="14" fill="#AEB7C8" stroke="' + INK + '" stroke-width="3"/>' +
      '<rect x="90" y="66" width="22" height="14" fill="#AEB7C8" stroke="' + INK + '" stroke-width="3"/>' +
      '<g stroke="#4F6BFF" stroke-width="4" fill="none" stroke-linecap="round">' +
      '<path d="M26 34h16M30 22l12 8M30 46l12-8"/></g>',

    /* ── the world ─────────────────────────────────────────  */

    // a globe with a pin in it
    geography:
      sky('#DCEEFF') +
      o('<circle cx="76" cy="54" r="34" fill="#4F6BFF"/>') +
      '<path d="M50 38c14 4 22 0 34 6s16 2 24 8M46 66c16-4 20 4 34 2s20 6 30 2" ' +
      'stroke="#9BDFF0" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<path d="M60 30c10 12 6 30-2 46M96 26c-8 16-6 34 2 48" stroke="#9BDFF0" stroke-width="3" fill="none"/>' +
      o('<path d="M118 20c8 0 14 6 14 14 0 10-14 22-14 22s-14-12-14-22c0-8 6-14 14-14z" fill="#F4364C"/>') +
      '<circle cx="118" cy="34" r="5" fill="#fff"/>',

    // a castle, and an hourglass stood beside it
    history:
      sky('#FFF1DC') + grass('#D9C79B') +
      o('<path d="M24 88V42h10V32h11v10h13V32h11v10h10v46z" fill="#B7A88F"/>' +
        '<path d="M79 88V52h32v36z" fill="#CBBBA0"/>') +
      '<rect x="44" y="62" width="16" height="26" rx="8" fill="' + INK + '" opacity=".55"/>' +
      '<g fill="' + INK + '" opacity=".35"><rect x="88" y="60" width="9" height="11" rx="2"/></g>' +
      /* The hourglass, stood on the same ground as the castle. Drawn as one
         closed outline rather than two triangles meeting, because two shapes
         touching at a point is what made the first attempt a bowtie. */
      o('<path d="M120 34h30v3l-15 17 15 17v3h-30v-3l15-17-15-17z" fill="#fff"/>') +
      '<path d="M120 34l15 17 15-17z" fill="#FFC53D"/>' +
      '<path d="M128 80h14l-7-8z" fill="#FFC53D"/>' +
      '<path d="M135 54v18" stroke="#FFC53D" stroke-width="3.5" stroke-linecap="round"/>' +
      o('<rect x="115" y="26" width="40" height="8" rx="3" fill="#B7A88F"/>' +
        '<rect x="115" y="80" width="40" height="8" rx="3" fill="#B7A88F"/>'),

    // a clock tower by a river
    uk:
      sky('#DCEEFF') +
      '<path d="M0 78h160v22H0z" fill="#7FC3F0"/><path d="M0 78h160" stroke="' + INK + '" stroke-width="3"/>' +
      o('<path d="M62 78V28h22v50z" fill="#D9C79B"/><path d="M62 28l11-16 11 16z" fill="#B7A88F"/>' +
        '<rect x="96" y="54" width="44" height="24" rx="3" fill="#CBBBA0"/>') +
      '<circle cx="73" cy="40" r="8" fill="#fff" stroke="' + INK + '" stroke-width="3"/>' +
      '<path d="M73 40v-5M73 40l4 3" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/>' +
      '<g stroke="#fff" stroke-width="3" opacity=".7"><path d="M10 88h30M52 92h36M110 88h40"/></g>',

    // a long-necked dinosaur, with a volcano going off behind it
    dinosaurs:
      sky('#FFE9CE') +
      o('<path d="M0 88 34 46l18 20 16-30 20 30 18-18 26 40z" fill="#C0894F"/>') +
      '<path d="M116 48l6-14 6 14z" fill="#F4364C"/>' +
      grass('#8FBF6A') +
      o('<path d="M28 88c0-18 12-28 30-28h20c14 0 22 10 22 24v4z" fill="#12BE8E"/>' +
        '<path d="M78 62c0-16 4-28 16-32 10-3 16 3 16 10 0 8-8 10-12 16" fill="none" ' +
        'stroke-linecap="round" stroke-width="13"/>') +
      '<path d="M78 62c0-16 4-28 16-32 10-3 16 3 16 10 0 8-8 10-12 16" fill="none" ' +
      'stroke="#12BE8E" stroke-width="10" stroke-linecap="round"/>' +
      o('<circle cx="110" cy="36" r="11" fill="#12BE8E"/>') +
      '<circle cx="114" cy="33" r="2.8" fill="' + INK + '"/>' +
      '<path d="M28 88c-14 0-22-6-26-16" stroke="#12BE8E" stroke-width="9" fill="none" stroke-linecap="round"/>',

    // letter tiles, and the sound coming off them
    phonics:
      sky('#FFF1DC') +
      o('<rect x="18" y="44" width="34" height="34" rx="6" fill="#F4364C"/>' +
        '<rect x="58" y="44" width="34" height="34" rx="6" fill="#FFC53D"/>' +
        '<rect x="98" y="44" width="34" height="34" rx="6" fill="#4F6BFF"/>') +
      '<g fill="#fff"><rect x="26" y="58" width="18" height="6" rx="3"/>' +
      '<rect x="66" y="58" width="18" height="6" rx="3"/><rect x="106" y="58" width="18" height="6" rx="3"/></g>' +
      '<g stroke="#7C4DFF" stroke-width="4" fill="none" stroke-linecap="round">' +
      '<path d="M62 30c8-10 28-10 36 0"/><path d="M52 20c16-14 40-14 56 0"/></g>',

    // a padlock on a screen: staying safe online
    online:
      sky('#EAF7FF') +
      o('<rect x="24" y="22" width="112" height="56" rx="8" fill="#fff"/>') +
      '<path d="M24 34h112" stroke="' + INK + '" stroke-width="3"/>' +
      '<g fill="#CFCADF"><circle cx="34" cy="28" r="3"/><circle cx="44" cy="28" r="3"/>' +
      '<circle cx="54" cy="28" r="3"/></g>' +
      o('<rect x="64" y="52" width="34" height="26" rx="5" fill="#FFC53D"/>' +
        '<path d="M70 52v-7a11 11 0 0 1 22 0v7" fill="none" stroke-width="5"/>') +
      '<circle cx="81" cy="64" r="4.5" fill="' + INK + '"/>' +
      '<path d="M56 88h48" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>',

    // a flag on a globe
    capitals:
      sky('#EAFBF3') +
      o('<circle cx="66" cy="56" r="32" fill="#12BE8E"/>') +
      '<path d="M42 42c12 6 20 0 30 6s14 2 22 8M40 70c14-4 18 4 30 2s18 6 26 2" ' +
      'stroke="#CFF5E6" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<path d="M116 80V22" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>' +
      o('<path d="M116 24h30l-8 10 8 10h-30z" fill="#F4364C"/>')
  };

  /* Every topic maps onto a picture; anything unnamed falls back to a picture
     for its subject, and anything with no subject either gets the plain one —
     a card with no picture is worse than a card with a general one. */
  const SUBJECT_COVER = { maths: 'times', english: 'wordclass', science: 'space', humanities: 'geography' };
  const PLAIN = 'wordclass';

  function cover(topic, width = 240) {
    const body = COVER[topic] || COVER[SUBJECT_COVER[topic]] || COVER[PLAIN];
    const h = Math.round(width / 1.6);
    return '<svg class="cover-art" viewBox="0 0 160 100" width="' + width + '" height="' + h + '"' +
           ' preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + body + '</svg>';
  }

  /** Work out which picture a title deserves, using the question engine's own
      topic words — so "Quick times tables test" gets the array of dots. */
  function coverNameFor(title) {
    const said = String(title || '').toLowerCase();
    const bank = global.QuizBank;
    if (bank && bank.TOPICS) {
      let best = null, bestLen = 0;
      for (const t of bank.TOPICS) {
        for (const w of (t.words || [])) {
          if (w.length > bestLen && said.includes(w)) { best = t.id; bestLen = w.length; }
        }
      }
      if (best && COVER[best]) return best;
      if (best && SUBJECT_COVER[best]) return SUBJECT_COVER[best];
    }
    for (const id of Object.keys(COVER)) if (said.includes(id)) return id;
    return '';
  }

  const coverFor = (title, width) => cover(coverNameFor(title), width);

  global.Sprite = global.Sprite || {};
  global.Sprite.cover = cover;
  global.Sprite.coverFor = coverFor;
  global.Sprite.coverNameFor = coverNameFor;
  global.Sprite.COVERS = Object.keys(COVER);
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.Sprite;
