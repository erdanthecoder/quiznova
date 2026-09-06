/* Quoldek question engine — the co-pilot's brain when there is no API key.
 *
 * Two sources:
 *   • generators  — maths and language questions built from rules, so the
 *     supply is effectively unlimited and always fits the year group asked for
 *   • curated banks — facts that cannot be generated (capitals, the Romans,
 *     the water cycle) written for primary readers
 *
 * Topic matching is deliberately loose: "take away", "minus", "subtraction"
 * and "sums" all have to find the same place, because that is how teachers type.
 */
(function (global) {
  'use strict';

  const int = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => arr.slice().sort(() => Math.random() - 0.5);

  /** Build a multiple-choice question, keeping distractors distinct and plausible. */
  function mc(text, correct, wrongs, why) {
    const seen = new Set([String(correct)]);
    const options = [String(correct)];
    for (const w of wrongs) {
      const s = String(w);
      if (!seen.has(s) && s !== '' && s !== 'NaN') { seen.add(s); options.push(s); }
      if (options.length === 4) break;
    }
    if (options.length < 4) return null;              // caller skips it
    return { text, correct: String(correct), options, why };
  }

  /* near misses: what a child actually writes when they slip */
  const near = (n, extra = []) => [n + 1, n - 1, n + 2, n - 2, n + 10, n - 10, ...extra]
    .filter(v => v !== n && v >= 0);

  /* ── year groups ────────────────────────────────────────── */
  const LEVELS = {
    1: { add: 10, sub: 10, tables: [2, 5, 10], big: 20 },
    2: { add: 20, sub: 20, tables: [2, 3, 5, 10], big: 100 },
    3: { add: 100, sub: 100, tables: [2, 3, 4, 5, 8, 10], big: 1000 },
    4: { add: 100, sub: 100, tables: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], big: 1000 },
    5: { add: 1000, sub: 1000, tables: [3, 4, 6, 7, 8, 9, 11, 12], big: 10000 },
    6: { add: 1000, sub: 1000, tables: [4, 6, 7, 8, 9, 12], big: 100000 }
  };

  function detectLevel(text) {
    const m = text.match(/\b(?:year|yr|grade|class)\s*(\d)\b/);
    if (m) return LEVELS[Math.min(6, Math.max(1, +m[1]))] || LEVELS[3];
    if (/\bks1\b|\bkey stage 1\b|\breception\b|\bnursery\b/.test(text)) return LEVELS[1];
    if (/\bks2\b|\bkey stage 2\b/.test(text)) return LEVELS[4];
    if (/\bvery easy|\bsimple\b|\beasy\b/.test(text)) return LEVELS[1];
    if (/\bhard|\bharder|\bchalleng|\btricky|\bdifficult/.test(text)) return LEVELS[5];
    return LEVELS[3];
  }

  /* ── word lists the generators draw on ──────────────────── */
  const NOUNS = ['bicycle', 'teacher', 'mountain', 'kitchen', 'rabbit', 'village', 'pencil', 'harbour',
    'garden', 'castle', 'river', 'library', 'sandwich', 'elephant', 'window', 'football', 'doctor', 'island'];
  const VERBS = ['running', 'jumped', 'writes', 'swimming', 'shouted', 'builds', 'climbing', 'painted',
    'sings', 'listened', 'baking', 'threw', 'reads', 'sleeping', 'danced', 'catches'];
  const ADJECTIVES = ['bright', 'enormous', 'gentle', 'freezing', 'ancient', 'noisy', 'slippery', 'brave',
    'crunchy', 'purple', 'stormy', 'cheerful', 'narrow', 'sticky', 'fierce', 'gigantic'];
  const ADVERBS = ['quickly', 'gently', 'loudly', 'carefully', 'suddenly', 'happily',
    'slowly', 'bravely', 'neatly', 'rarely', 'eagerly', 'silently'];

  const PLURALS = [['baby', 'babies'], ['box', 'boxes'], ['child', 'children'], ['leaf', 'leaves'],
    ['mouse', 'mice'], ['church', 'churches'], ['knife', 'knives'], ['foot', 'feet'], ['city', 'cities'],
    ['tooth', 'teeth'], ['wolf', 'wolves'], ['bus', 'buses'], ['person', 'people'], ['sheep', 'sheep'],
    ['story', 'stories'], ['dish', 'dishes'], ['half', 'halves'], ['goose', 'geese'], ['fox', 'foxes'],
    ['penny', 'pennies'], ['shelf', 'shelves'], ['man', 'men'], ['woman', 'women'], ['potato', 'potatoes'],
    ['brush', 'brushes'], ['family', 'families'], ['thief', 'thieves'], ['deer', 'deer']];

  const OPPOSITES = [['hot', 'cold'], ['big', 'small'], ['fast', 'slow'], ['happy', 'sad'], ['day', 'night'],
    ['open', 'closed'], ['heavy', 'light'], ['early', 'late'], ['above', 'below'], ['wet', 'dry'],
    ['full', 'empty'], ['loud', 'quiet'], ['hard', 'soft'], ['young', 'old'], ['near', 'far'],
    ['first', 'last'], ['push', 'pull'], ['rough', 'smooth'], ['tall', 'short'], ['clean', 'dirty'],
    ['thick', 'thin'], ['begin', 'end'], ['float', 'sink'], ['friend', 'enemy'], ['brave', 'afraid'],
    ['inside', 'outside'], ['awake', 'asleep'], ['give', 'take'], ['strong', 'weak'], ['sweet', 'sour']];

  const SYNONYMS = [['happy', 'joyful'], ['big', 'enormous'], ['sad', 'miserable'], ['fast', 'rapid'],
    ['cold', 'freezing'], ['tired', 'exhausted'], ['pretty', 'beautiful'], ['angry', 'furious'],
    ['scared', 'terrified'], ['clever', 'intelligent'], ['small', 'tiny'], ['shout', 'yell'],
    ['begin', 'start'], ['difficult', 'tricky'], ['quiet', 'silent'], ['funny', 'amusing'],
    ['rich', 'wealthy'], ['quick', 'swift'], ['ill', 'unwell'], ['jump', 'leap'],
    ['old', 'ancient'], ['nice', 'pleasant'], ['strange', 'odd'], ['brave', 'courageous']];

  const HOMOPHONES = [['their', 'there'], ['to', 'too'], ['hear', 'here'], ['see', 'sea'],
    ['write', 'right'], ['knight', 'night'], ['flour', 'flower'], ['pair', 'pear'], ['bee', 'be'],
    ['blue', 'blew'], ['sun', 'son'], ['tail', 'tale'], ['week', 'weak'], ['meat', 'meet'],
    ['plane', 'plain'], ['whole', 'hole'], ['new', 'knew'], ['sale', 'sail'], ['bare', 'bear'],
    ['deer', 'dear'], ['road', 'rode'], ['stair', 'stare'], ['break', 'brake'], ['peace', 'piece'],
    ['mail', 'male'], ['won', 'one'], ['ate', 'eight'], ['made', 'maid'], ['through', 'threw']];

  const CAPITALS = [['France', 'Paris'], ['Japan', 'Tokyo'], ['Italy', 'Rome'], ['Spain', 'Madrid'],
    ['Egypt', 'Cairo'], ['Kenya', 'Nairobi'], ['Brazil', 'Brasília'], ['Canada', 'Ottawa'],
    ['Australia', 'Canberra'], ['India', 'New Delhi'], ['China', 'Beijing'], ['Germany', 'Berlin'],
    ['Greece', 'Athens'], ['Norway', 'Oslo'], ['Portugal', 'Lisbon'], ['Mexico', 'Mexico City'],
    ['Kyrgyzstan', 'Bishkek'], ['Turkey', 'Ankara'], ['Poland', 'Warsaw'], ['Peru', 'Lima'],
    ['Ireland', 'Dublin'], ['Scotland', 'Edinburgh'], ['Wales', 'Cardiff'], ['Argentina', 'Buenos Aires'],
    ['Thailand', 'Bangkok'], ['Netherlands', 'Amsterdam'], ['Sweden', 'Stockholm'], ['Nigeria', 'Abuja']];

  const SHAPES = [['triangle', 3], ['square', 4], ['rectangle', 4], ['pentagon', 5], ['hexagon', 6],
    ['heptagon', 7], ['octagon', 8], ['nonagon', 9], ['decagon', 10], ['rhombus', 4], ['trapezium', 4]];
  const SOLIDS = [['cube', 6, 12, 8], ['cuboid', 6, 12, 8], ['square-based pyramid', 5, 8, 5],
    ['triangular prism', 5, 9, 6], ['cylinder', 3, 2, 0], ['cone', 2, 1, 1]];

  /* ── generators ─────────────────────────────────────────── */
  const G = {
    addition(lv) {
      const cap = lv.add;
      const a = int(1, Math.max(2, Math.floor(cap * 0.6)));
      const b = int(1, cap - a > 1 ? cap - a : 2);
      const ans = a + b;
      return mc(`${a} + ${b} = ?`, ans, near(ans), `Start at ${a} and count on ${b} more.`);
    },
    subtraction(lv) {
      const a = int(3, lv.sub);
      const b = int(1, a - 1);
      const ans = a - b;
      return mc(`${a} − ${b} = ?`, ans, near(ans, [a + b]), `${a} take away ${b} leaves ${ans}.`);
    },
    times(lv) {
      const a = pick(lv.tables);
      const b = int(2, 12);
      const ans = a * b;
      return mc(`${a} × ${b} = ?`, ans, [ans + a, ans - a, ans + b, a + b, ans + 10],
        `${b} lots of ${a} makes ${ans}.`);
    },
    division(lv) {
      const a = pick(lv.tables);
      const b = int(2, 12);
      const total = a * b;
      return mc(`${total} ÷ ${a} = ?`, b, [b + 1, b - 1, b + 2, a, total - a],
        `${a} × ${b} = ${total}, so ${total} ÷ ${a} = ${b}.`);
    },
    doubling(lv) {
      const n = int(2, Math.max(5, Math.floor(lv.add / 2)));
      return mc(`What is double ${n}?`, n * 2, [n * 2 + 1, n * 2 - 1, n + 2, Math.round(n / 2)],
        `Double means add it to itself: ${n} + ${n} = ${n * 2}.`);
    },
    halving(lv) {
      const half = int(2, Math.max(5, Math.floor(lv.add / 2)));
      const n = half * 2;
      return mc(`What is half of ${n}?`, half, [half + 1, half - 1, n, half + 2],
        `Half of ${n} is ${half}, because ${half} + ${half} = ${n}.`);
    },
    missing(lv) {
      const a = int(1, lv.add - 2);
      const ans = int(1, lv.add - a);
      return mc(`${a} + ? = ${a + ans}`, ans, near(ans),
        `${a + ans} − ${a} = ${ans}.`);
    },
    place(lv) {
      const n = int(111, Math.min(9999, lv.big * 9 || 999));
      const digits = String(n).split('');
      const idx = digits.length - 2;                       // the tens digit
      return mc(`In the number ${n}, what is the tens digit?`, digits[idx],
        digits.filter((d, i) => i !== idx), `Counting from the right, the tens column holds ${digits[idx]}.`);
    },
    fractionOf(lv) {
      const den = pick([2, 3, 4, 5, 10]);
      const num = den > 2 && Math.random() < 0.5 ? int(2, den - 1) : 1;
      const part = int(2, 12) * den;
      const one = part / den;
      const ans = one * num;
      return mc(`What is ${num}/${den} of ${part}?`, ans, near(ans, [one, part - ans, part]),
        `One ${den}th of ${part} is ${one}, and ${num} of those is ${ans}.`);
    },
    money(lv) {
      const a = int(10, 90), b = int(5, 90);
      const total = a + b;
      const p = (v) => v >= 100 ? `£${(v / 100).toFixed(2)}` : `${v}p`;
      return mc(`A pen costs ${p(a)} and a rubber costs ${p(b)}. How much altogether?`,
        p(total), [p(total + 10), p(total - 10), p(Math.abs(a - b)), p(total + 1)],
        `${a}p + ${b}p = ${total}p.`);
    },
    time() {
      const h = int(1, 12);
      const mins = pick([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
      const nextH = h === 12 ? 1 : h + 1;
      const label = mins === 0 ? `${h} o'clock` : mins === 15 ? `quarter past ${h}`
        : mins === 30 ? `half past ${h}` : mins === 45 ? `quarter to ${nextH}`
        : mins < 30 ? `${mins} minutes past ${h}` : `${60 - mins} minutes to ${nextH}`;
      const clock = `${h}:${String(mins).padStart(2, '0')}`;
      const others = [`${h}:${mins === 30 ? '15' : '30'}`, `${h === 12 ? 1 : h + 1}:${String(mins).padStart(2, '0')}`,
        `${h}:${mins === 45 ? '05' : '45'}`];
      return mc(`Which clock shows ${label}?`, clock, others, `${label} is written ${clock}.`);
    },
    compare(lv) {
      let a = int(1, lv.big), b = int(1, lv.big);
      if (a === b) b += 1;
      const ans = a > b ? 'greater than' : 'less than';
      return mc(`Is ${a} greater than or less than ${b}?`, ans,
        [a > b ? 'less than' : 'greater than', 'equal to', 'none of these'],
        `${a} ${a > b ? '>' : '<'} ${b}.`);
    },
    rounding(lv) {
      const n = int(11, 989);
      const ans = Math.round(n / 10) * 10;
      return mc(`Round ${n} to the nearest 10.`, ans, [ans + 10, ans - 10, Math.round(n / 100) * 100, n],
        `${n} is closest to ${ans}.`);
    },
    oddEven() {
      const n = int(2, 99);
      const ans = n % 2 === 0 ? 'Even' : 'Odd';
      return mc(`Is ${n} odd or even?`, ans, [n % 2 === 0 ? 'Odd' : 'Even', 'Both', 'Neither'],
        `${n} ${n % 2 === 0 ? 'can' : 'cannot'} be shared into two equal groups, so it is ${ans.toLowerCase()}.`);
    },
    counting(lv) {
      const step = pick(lv.tables.concat([2, 5, 10, 25, 50].filter(n => n <= (lv.big || 100))));
      const start = step * int(1, 12);
      const seq = [start, start + step, start + step * 2, start + step * 3];
      const ans = start + step * 4;
      return mc(`What comes next? ${seq.join(', ')}, ...`, ans, near(ans, [ans + step, start]),
        `The pattern counts on in ${step}s.`);
    },
    shapeSides() {
      const [name, sides] = pick(SHAPES);
      const form = int(1, 4);
      if (form === 1) return mc(`How many sides does a ${name} have?`, sides, near(sides), `A ${name} has ${sides} sides.`);
      if (form === 2) return mc(`How many corners does a ${name} have?`, sides, near(sides),
        `A ${name} has ${sides} corners, the same as its sides.`);
      if (form === 3) {
        const wrongs = shuffle(SHAPES).filter(sh => sh[1] !== sides).slice(0, 3).map(sh => sh[0]);
        return mc(`Which shape has ${sides} sides?`, name, wrongs, `A ${name} has ${sides} sides.`);
      }
      const [solid, faces, edges] = pick(SOLIDS);
      return Math.random() < 0.5
        ? mc(`How many faces does a ${solid} have?`, faces, near(faces), `A ${solid} has ${faces} faces.`)
        : mc(`How many edges does a ${solid} have?`, edges, near(edges), `A ${solid} has ${edges} edges.`);
    },

    /* language */
    wordClass() {
      const pools = { noun: NOUNS, verb: VERBS, adjective: ADJECTIVES, adverb: ADVERBS };
      const kind = pick(Object.keys(pools));
      const why = { noun: 'A noun names a person, place or thing.', verb: 'A verb is an action or doing word.',
        adjective: 'An adjective describes a noun.', adverb: 'An adverb describes how something is done.' }[kind];
      // name the word in the question, so every draw is a different question
      if (Math.random() < 0.6) {
        const word = pick(pools[kind]);
        return mc(`What kind of word is "${word}"?`, kind.charAt(0).toUpperCase() + kind.slice(1),
          Object.keys(pools).filter(k => k !== kind).map(k => k.charAt(0).toUpperCase() + k.slice(1)),
          `"${word}" is ${kind === 'adjective' || kind === 'adverb' ? 'an' : 'a'} ${kind}. ${why}`);
      }
      const correct = pick(pools[kind]);
      const wrongs = Object.keys(pools).filter(k => k !== kind).map(k => pick(pools[k]));
      return mc(`Which of these is ${kind === 'adjective' || kind === 'adverb' ? 'an' : 'a'} ${kind}: `
        + shuffle([correct, ...wrongs]).join(', ') + '?', correct, wrongs, why);
    },
    plural() {
      const [one, many] = pick(PLURALS);
      if (Math.random() < 0.5 && one !== many) {
        const wrongs = shuffle(PLURALS).filter(p => p[0] !== one).slice(0, 3).map(p => p[0]);
        return mc(`What is the singular of "${many}"?`, one, wrongs, `One of them is a ${one}.`);
      }
      const wrongs = [one + 's', one + 'es', one, one + 'ies'];
      return mc(`What is the plural of "${one}"?`, many, wrongs, `More than one ${one} is ${many}.`);
    },
    opposite() {
      let [a, b] = pick(OPPOSITES);
      if (Math.random() < 0.5) [a, b] = [b, a];
      const wrongs = shuffle(OPPOSITES).filter(p => p[0] !== a && p[1] !== a).slice(0, 3).map(p => pick(p));
      return mc(`What is the opposite of "${a}"?`, b, wrongs, `The opposite of ${a} is ${b}.`);
    },
    synonym() {
      let [a, b] = pick(SYNONYMS);
      if (Math.random() < 0.5) [a, b] = [b, a];
      const wrongs = shuffle(OPPOSITES).slice(0, 3).map(p => pick(p));
      return mc(`Which word means the same as "${a}"?`, b, wrongs, `${b} means the same as ${a}.`);
    },
    homophone() {
      let [a, b] = pick(HOMOPHONES);
      if (Math.random() < 0.5) [a, b] = [b, a];
      const wrongs = shuffle(HOMOPHONES).filter(p => p[0] !== a && p[1] !== a).slice(0, 3).map(p => pick(p));
      return mc(`Which word sounds the same as "${a}"?`, b, wrongs,
        `"${a}" and "${b}" sound the same but mean different things.`);
    },
    alphabetical() {
      const words = shuffle(NOUNS).slice(0, 4);
      const first = words.slice().sort()[0];
      return mc(`Which word comes first in alphabetical order? ${words.join(', ')}`, first,
        words.filter(w => w !== first), `"${first}" starts with the earliest letter of the alphabet.`);
    },

    /* the world */
    capital() {
      const [country, city] = pick(CAPITALS);
      const wrongs = shuffle(CAPITALS).filter(c => c[0] !== country).slice(0, 3).map(c => c[1]);
      return mc(`What is the capital city of ${country}?`, city, wrongs, `${city} is the capital of ${country}.`);
    }
  };

  /* ── curated banks for facts you cannot generate ────────── */
  const B = {
    space: [
      ['How many planets are in our solar system?', '8', ['9', '7', '10'], 'There are 8 since Pluto was reclassified.'],
      ['Which planet is closest to the Sun?', 'Mercury', ['Venus', 'Earth', 'Mars'], 'Mercury orbits nearest the Sun.'],
      ['What do we call a rock that lands on Earth from space?', 'A meteorite', ['A comet', 'A star', 'A planet'], 'A meteorite survives the fall and lands.'],
      ['Which planet is known as the Red Planet?', 'Mars', ['Jupiter', 'Venus', 'Saturn'], 'Iron dust makes Mars look red.'],
      ['What orbits the Earth?', 'The Moon', ['The Sun', 'Mars', 'Venus'], 'The Moon is Earth’s natural satellite.'],
      ['Who was the first person to walk on the Moon?', 'Neil Armstrong', ['Buzz Aldrin', 'Yuri Gagarin', 'Tim Peake'], 'Neil Armstrong stepped out first, in 1969.'],
      ['What is the Sun?', 'A star', ['A planet', 'A moon', 'A comet'], 'The Sun is the star at the centre of our solar system.'],
      ['Which planet has the largest rings?', 'Saturn', ['Jupiter', 'Neptune', 'Mars'], 'Saturn’s rings are made of ice and rock.'],
      ['How long does the Earth take to orbit the Sun?', 'One year', ['One day', 'One month', 'One week'], 'One orbit of the Sun is a year.'],
      ['What causes day and night?', 'The Earth spinning', ['The Sun orbiting Earth', 'Clouds', 'The Moon'], 'Earth rotates once every 24 hours.'],
      ['Which is bigger, the Sun or the Earth?', 'The Sun', ['The Earth', 'They are the same', 'It changes'], 'The Sun is far larger than Earth.'],
      ['What is a pattern of stars called?', 'A constellation', ['A galaxy', 'A comet', 'A nebula'], 'Constellations are star patterns.']
    ],
    body: [
      ['Which organ pumps blood around your body?', 'The heart', ['The lungs', 'The liver', 'The brain'], 'The heart pumps blood everywhere.'],
      ['What do your lungs take in from the air?', 'Oxygen', ['Carbon dioxide', 'Nitrogen', 'Water'], 'Lungs take in oxygen and breathe out carbon dioxide.'],
      ['How many bones does an adult human have?', '206', ['150', '300', '98'], 'Adults have 206 bones; babies have more.'],
      ['What protects your brain?', 'The skull', ['The ribs', 'The spine', 'The skin'], 'The skull is a hard case around the brain.'],
      ['Which sense do your ears give you?', 'Hearing', ['Sight', 'Taste', 'Smell'], 'Ears collect sound so you can hear.'],
      ['What should you do to keep teeth healthy?', 'Brush twice a day', ['Eat more sweets', 'Never visit a dentist', 'Drink fizzy drinks'], 'Brushing removes the plaque that causes decay.'],
      ['Which body part helps you to breathe?', 'The lungs', ['The stomach', 'The kidneys', 'The liver'], 'Lungs take oxygen from the air.'],
      ['What do muscles do?', 'Pull on bones to make you move', ['Digest food', 'Filter air', 'Store water'], 'Muscles contract and pull bones.'],
      ['Which food group gives quick energy?', 'Carbohydrates', ['Vitamins', 'Water', 'Fibre'], 'Carbohydrates are the body’s main energy source.'],
      ['How many teeth does a typical adult have?', '32', ['20', '24', '40'], 'Adults usually have 32 teeth.'],
      ['What does the stomach do?', 'Breaks down food', ['Pumps blood', 'Filters air', 'Stores bones'], 'The stomach digests food.'],
      ['Which sense does the skin give you?', 'Touch', ['Smell', 'Taste', 'Hearing'], 'Skin senses touch, pressure and temperature.']
    ],
    animals: [
      ['What do we call an animal that eats only plants?', 'A herbivore', ['A carnivore', 'An omnivore', 'A predator'], 'Herbivores eat plants only.'],
      ['Which animal group do frogs belong to?', 'Amphibians', ['Reptiles', 'Mammals', 'Fish'], 'Amphibians live in water and on land.'],
      ['What is a baby sheep called?', 'A lamb', ['A calf', 'A foal', 'A cub'], 'A young sheep is a lamb.'],
      ['Which animal is the largest on Earth?', 'The blue whale', ['The elephant', 'The giraffe', 'The shark'], 'The blue whale is the biggest animal ever known.'],
      ['What covers a bird’s body?', 'Feathers', ['Fur', 'Scales', 'Shells'], 'All birds have feathers.'],
      ['Where do penguins mostly live?', 'The southern hemisphere', ['The North Pole', 'The Sahara', 'Europe'], 'Almost all penguins live south of the equator.'],
      ['Which animal group has scales and lays eggs on land?', 'Reptiles', ['Mammals', 'Amphibians', 'Birds'], 'Reptiles have scaly skin.'],
      ['What do we call an animal that eats both plants and meat?', 'An omnivore', ['A herbivore', 'A carnivore', 'A producer'], 'Omnivores eat both.'],
      ['Which of these is a mammal?', 'Dolphin', ['Shark', 'Crocodile', 'Penguin'], 'Dolphins breathe air and feed their young milk.'],
      ['What is a group of lions called?', 'A pride', ['A flock', 'A herd', 'A shoal'], 'Lions live in prides.'],
      ['Which animal hibernates through winter?', 'Hedgehog', ['Fox', 'Robin', 'Badger'], 'Hedgehogs sleep through the coldest months.'],
      ['What is the first stage of a butterfly life cycle?', 'Egg', ['Caterpillar', 'Chrysalis', 'Butterfly'], 'It starts as an egg.']
    ],
    plants: [
      ['What gas do plants take in to make food?', 'Carbon dioxide', ['Oxygen', 'Nitrogen', 'Helium'], 'Plants take in carbon dioxide and give out oxygen.'],
      ['Which part of a plant takes in water?', 'The roots', ['The leaves', 'The flower', 'The stem'], 'Roots draw water from the soil.'],
      ['What is the process plants use to make food called?', 'Photosynthesis', ['Digestion', 'Respiration', 'Evaporation'], 'Photosynthesis uses light, water and carbon dioxide.'],
      ['What do bees carry between flowers?', 'Pollen', ['Seeds', 'Roots', 'Leaves'], 'Bees pollinate flowers as they feed.'],
      ['Which part of the plant is usually colourful to attract insects?', 'The flower', ['The root', 'The stem', 'The seed'], 'Bright flowers attract pollinators.'],
      ['What do plants need to grow?', 'Light, water and air', ['Only darkness', 'Only soil', 'Only heat'], 'Plants need light, water, air and nutrients.'],
      ['What carries water up the plant?', 'The stem', ['The petals', 'The seeds', 'The pollen'], 'The stem transports water to the leaves.'],
      ['What is it called when a seed starts to grow?', 'Germination', ['Pollination', 'Evaporation', 'Digestion'], 'Germination is the seed sprouting.'],
      ['What do we call seeds being spread away from the parent plant?', 'Seed dispersal', ['Pollination', 'Germination', 'Photosynthesis'], 'Dispersal spreads seeds to new ground.'],
      ['Which part of the plant makes food?', 'The leaves', ['The roots', 'The flower', 'The seed'], 'Leaves photosynthesise to make food.'],
      ['Which of these is a deciduous tree?', 'Oak', ['Pine', 'Spruce', 'Fir'], 'Deciduous trees lose their leaves in autumn.'],
      ['What do roots do as well as take in water?', 'Anchor the plant', ['Make flowers', 'Catch sunlight', 'Produce pollen'], 'Roots hold the plant firmly in the soil.']
    ],
    weather: [
      ['What instrument measures temperature?', 'A thermometer', ['A barometer', 'A ruler', 'A compass'], 'Thermometers measure how hot or cold it is.'],
      ['What do we call frozen rain?', 'Hail', ['Fog', 'Dew', 'Mist'], 'Hail is rain frozen into balls of ice.'],
      ['What is the water cycle stage where water turns to vapour?', 'Evaporation', ['Condensation', 'Precipitation', 'Collection'], 'Heat turns liquid water into vapour.'],
      ['What forms when water vapour cools into clouds?', 'Condensation', ['Evaporation', 'Precipitation', 'Erosion'], 'Cooling vapour condenses into droplets.'],
      ['What is rain, snow and hail called together?', 'Precipitation', ['Evaporation', 'Condensation', 'Transpiration'], 'Precipitation is any water falling from clouds.'],
      ['Which season is usually the coldest in the UK?', 'Winter', ['Summer', 'Spring', 'Autumn'], 'Winter has the shortest days and lowest temperatures.'],
      ['What instrument measures how much rain falls?', 'A rain gauge', ['A thermometer', 'A compass', 'A telescope'], 'A rain gauge collects and measures rainfall.'],
      ['What do we call a long period with almost no rain?', 'A drought', ['A flood', 'A storm', 'A breeze'], 'A drought is a long dry spell.'],
      ['What causes wind?', 'Moving air', ['Moving water', 'Sunlight only', 'The Moon'], 'Wind is air moving from one place to another.'],
      ['Where does the water in a cloud come from?', 'Water evaporated from seas and lakes', ['The Moon', 'Underground caves', 'Volcanoes'], 'The Sun evaporates water, which rises and forms clouds.'],
      ['Which water cycle stage sees water gather in rivers and seas?', 'Collection', ['Evaporation', 'Condensation', 'Precipitation'], 'Water collects again in rivers, lakes and seas.'],
      ['What do we call frozen water falling as soft white flakes?', 'Snow', ['Hail', 'Sleet', 'Dew'], 'Snow forms when water vapour freezes into crystals.'],
      ['Which cloud usually brings thunderstorms?', 'Cumulonimbus', ['Cirrus', 'Stratus', 'Fog'], 'Tall cumulonimbus clouds bring storms.'],
      ['Which season comes after summer?', 'Autumn', ['Winter', 'Spring', 'Summer again'], 'The order is spring, summer, autumn, winter.']
    ],
    materials: [
      ['Which material is transparent?', 'Glass', ['Wood', 'Metal', 'Brick'], 'You can see through transparent materials.'],
      ['What happens to water at 0°C?', 'It freezes', ['It boils', 'It evaporates', 'It disappears'], 'Water freezes into ice at 0°C.'],
      ['Which material is the best conductor of electricity?', 'Copper', ['Plastic', 'Wood', 'Rubber'], 'Metals like copper conduct electricity well.'],
      ['What do we call a change that cannot be undone?', 'An irreversible change', ['A reversible change', 'A physical change', 'A cycle'], 'Burning toast cannot be turned back.'],
      ['At what temperature does water boil at sea level?', '100°C', ['50°C', '90°C', '120°C'], 'Water boils at 100°C at sea level.'],
      ['Which of these is a liquid?', 'Milk', ['Ice', 'Wood', 'Sand'], 'Liquids flow and take the shape of their container.'],
      ['What happens to chocolate when it is heated?', 'It melts', ['It freezes', 'It evaporates instantly', 'It turns to wood'], 'Heating turns a solid into a liquid.'],
      ['Which material is waterproof?', 'Plastic', ['Paper', 'Cotton wool', 'Cardboard'], 'Water cannot soak through plastic.'],
      ['Which material would you choose for a window?', 'Glass', ['Wood', 'Metal', 'Brick'], 'Glass is transparent so light passes through.'],
      ['What state of matter spreads out to fill its container?', 'Gas', ['Solid', 'Liquid', 'Crystal'], 'A gas fills any space it is given.'],
      ['Which is a reversible change?', 'Melting ice', ['Burning paper', 'Baking a cake', 'Frying an egg'], 'Melted ice can be frozen again.'],
      ['Which material is a good insulator?', 'Wool', ['Copper', 'Steel', 'Aluminium'], 'Wool traps air and keeps heat in.']
    ],
    forces: [
      ['What force pulls objects towards Earth?', 'Gravity', ['Friction', 'Magnetism', 'Tension'], 'Gravity pulls everything towards the Earth.'],
      ['What force slows a bike down when you brake?', 'Friction', ['Gravity', 'Magnetism', 'Upthrust'], 'Friction acts between the brake and the wheel.'],
      ['Which material is attracted to a magnet?', 'Iron', ['Plastic', 'Wood', 'Glass'], 'Magnets attract iron, nickel and cobalt.'],
      ['What keeps a boat floating?', 'Upthrust', ['Gravity', 'Friction', 'Air resistance'], 'Water pushes up on the boat.'],
      ['What force acts against a box you push along the floor?', 'Friction', ['Gravity', 'Upthrust', 'Magnetism'], 'Friction acts between the box and the floor.'],
      ['Which of these is a push?', 'Closing a door', ['Opening a drawer towards you', 'Pulling a rope', 'Lifting a bag'], 'Closing a door pushes it away from you.'],
      ['What slows a parachute as it falls?', 'Air resistance', ['Gravity', 'Magnetism', 'Upthrust'], 'Air pushes up against the parachute.'],
      ['What are the two ends of a magnet called?', 'Poles', ['Sides', 'Edges', 'Faces'], 'Magnets have a north pole and a south pole.'],
      ['What happens when two north poles meet?', 'They push apart', ['They attract', 'Nothing happens', 'They melt'], 'Like poles repel each other.'],
      ['Which surface creates the most friction?', 'Carpet', ['Ice', 'Polished wood', 'Glass'], 'Rough surfaces create more friction.'],
      ['What unit is force measured in?', 'Newtons', ['Litres', 'Metres', 'Grams'], 'Force is measured in newtons.']
    ],
    geography: [
      ['Which is the largest ocean?', 'The Pacific', ['The Atlantic', 'The Indian', 'The Arctic'], 'The Pacific is the biggest ocean.'],
      ['How many continents are there?', '7', ['5', '6', '8'], 'There are seven continents.'],
      ['Which is the longest river in the world?', 'The Nile', ['The Amazon', 'The Thames', 'The Danube'], 'The Nile is usually listed as the longest.'],
      ['What is the highest mountain on Earth?', 'Mount Everest', ['K2', 'Mont Blanc', 'Ben Nevis'], 'Everest is the highest above sea level.'],
      ['Which continent is the Sahara Desert in?', 'Africa', ['Asia', 'Australia', 'Europe'], 'The Sahara covers much of north Africa.'],
      ['What do we call a piece of land surrounded by water?', 'An island', ['A peninsula', 'A valley', 'A bay'], 'Water surrounds an island completely.'],
      ['Which country is shaped like a boot?', 'Italy', ['Spain', 'Greece', 'Turkey'], 'Italy’s shape looks like a long boot.'],
      ['Which continent is the largest?', 'Asia', ['Africa', 'Europe', 'Antarctica'], 'Asia is the largest continent.'],
      ['What do we call a very dry area with little rain?', 'A desert', ['A rainforest', 'A marsh', 'A delta'], 'Deserts get very little rainfall.'],
      ['What is the imaginary line around the middle of the Earth?', 'The equator', ['The meridian', 'The tropic', 'The axis'], 'The equator circles the Earth’s middle.'],
      ['Which continent is the coldest?', 'Antarctica', ['Europe', 'Asia', 'South America'], 'Antarctica is frozen all year.'],
      ['What is a large area of salt water called?', 'An ocean', ['A lake', 'A river', 'A pond'], 'Oceans are huge bodies of salt water.']
    ],
    uk: [
      ['What is the capital of Scotland?', 'Edinburgh', ['Glasgow', 'Aberdeen', 'Dundee'], 'Edinburgh is Scotland’s capital.'],
      ['Which river flows through London?', 'The Thames', ['The Severn', 'The Mersey', 'The Tyne'], 'The Thames runs through London.'],
      ['How many countries make up the United Kingdom?', '4', ['3', '5', '2'], 'England, Scotland, Wales and Northern Ireland.'],
      ['What is the capital of Wales?', 'Cardiff', ['Swansea', 'Newport', 'Bangor'], 'Cardiff is the Welsh capital.'],
      ['What is the highest mountain in the UK?', 'Ben Nevis', ['Snowdon', 'Scafell Pike', 'Slieve Donard'], 'Ben Nevis in Scotland is the highest.'],
      ['What is the capital of Northern Ireland?', 'Belfast', ['Dublin', 'Derry', 'Lisburn'], 'Belfast is the capital of Northern Ireland.'],
      ['Which sea lies between England and Ireland?', 'The Irish Sea', ['The North Sea', 'The Channel', 'The Baltic'], 'The Irish Sea separates the two islands.'],
      ['What is the longest river in the UK?', 'The Severn', ['The Thames', 'The Trent', 'The Clyde'], 'The Severn is about 220 miles long.'],
      ['What is the capital of England?', 'London', ['Manchester', 'Birmingham', 'Bristol'], 'London is England’s capital.'],
      ['Which is the largest city in Scotland?', 'Glasgow', ['Edinburgh', 'Inverness', 'Perth'], 'Glasgow has the biggest population in Scotland.'],
      ['Snowdon is the highest mountain in which country?', 'Wales', ['England', 'Scotland', 'Ireland'], 'Snowdon (Yr Wyddfa) is in north Wales.']
    ],
    history: [
      ['In which year did the Second World War end?', '1945', ['1939', '1918', '1950'], 'The war ended in 1945.'],
      ['The Great Fire of London happened in which year?', '1666', ['1066', '1766', '1566'], 'It began in a bakery in 1666.'],
      ['Who led the Roman invasion of Britain in AD 43?', 'Emperor Claudius', ['Julius Caesar', 'Nero', 'Augustus'], 'Claudius ordered the invasion in AD 43.'],
      ['What did the Vikings travel in?', 'Longships', ['Submarines', 'Canoes', 'Galleons'], 'Viking longships were fast and shallow.'],
      ['Who was the first Tudor king?', 'Henry VII', ['Henry VIII', 'Edward VI', 'Richard III'], 'Henry VII won at Bosworth in 1485.'],
      ['How many wives did Henry VIII have?', 'Six', ['Three', 'Four', 'Eight'], 'Henry VIII married six times.'],
      ['What did the ancient Egyptians build as tombs for pharaohs?', 'Pyramids', ['Castles', 'Temples only', 'Longhouses'], 'Pyramids were royal tombs.'],
      ['What is the writing of ancient Egypt called?', 'Hieroglyphics', ['Latin', 'Runes', 'Cuneiform'], 'Egyptians wrote in hieroglyphics.'],
      ['What did the Romans build to carry water into towns?', 'Aqueducts', ['Pyramids', 'Longships', 'Igloos'], 'Aqueducts carried fresh water.'],
      ['Where did the Vikings come from?', 'Scandinavia', ['Egypt', 'Italy', 'India'], 'Vikings came from Norway, Sweden and Denmark.'],
      ['In which year was the Battle of Hastings?', '1066', ['1666', '1215', '1485'], 'William the Conqueror won in 1066.'],
      ['What did ancient Egyptians write on?', 'Papyrus', ['Paper', 'Slate', 'Plastic'], 'Papyrus was made from reeds.'],
      ['Who reigned in England for most of the late 1500s?', 'Elizabeth I', ['Victoria', 'Elizabeth II', 'Mary II'], 'Elizabeth I reigned 1558–1603.'],
      ['What were the rulers of ancient Egypt called?', 'Pharaohs', ['Emperors', 'Chiefs', 'Consuls'], 'Egyptian rulers were pharaohs.']
    ],
    dinosaurs: [
      ['Which dinosaur had a very long neck?', 'Diplodocus', ['Tyrannosaurus rex', 'Stegosaurus', 'Velociraptor'], 'Diplodocus reached leaves high in the trees.'],
      ['Which dinosaur had three horns?', 'Triceratops', ['Brachiosaurus', 'Iguanodon', 'Ankylosaurus'], 'Tri means three.'],
      ['What do we call a scientist who studies fossils?', 'A palaeontologist', ['A dentist', 'An astronomer', 'A chemist'], 'Palaeontologists study fossils.'],
      ['Did people live at the same time as the dinosaurs?', 'No, dinosaurs died out first', ['Yes, they were friends', 'Yes, people rode them', 'Only in winter'], 'Dinosaurs died out about 66 million years ago.'],
      ['How did dinosaurs have their babies?', 'They laid eggs', ['They grew on trees', 'They came from the sea', 'They were born as adults'], 'Dinosaurs laid eggs in nests.'],
      ['Which dinosaur ate meat?', 'Tyrannosaurus rex', ['Diplodocus', 'Triceratops', 'Stegosaurus'], 'T. rex had huge sharp teeth.'],
      ['What does the name Tyrannosaurus rex mean?', 'Tyrant lizard king', ['Fast runner', 'Long neck', 'Gentle giant'], 'T. rex means tyrant lizard king.'],
      ['Which period came first?', 'Triassic', ['Jurassic', 'Cretaceous', 'Ice Age'], 'Triassic, then Jurassic, then Cretaceous.'],
      ['What did Stegosaurus have along its back?', 'Bony plates', ['Feathers', 'A shell', 'Horns'], 'Stegosaurus had large plates along its spine.'],
      ['What may have caused the dinosaurs to die out?', 'A huge asteroid impact', ['A flood only', 'People hunting them', 'A cold snap of one week'], 'An asteroid strike changed the climate dramatically.'],
      ['What are dinosaur footprints preserved in rock called?', 'Trace fossils', ['Body fossils', 'Minerals', 'Crystals'], 'Trace fossils record behaviour.'],
      ['Which dinosaur had a club on its tail?', 'Ankylosaurus', ['Diplodocus', 'Velociraptor', 'Triceratops'], 'Ankylosaurus swung a bony tail club.']
    ],
    punctuation: [
      ['Which sentence is punctuated correctly?', 'We ate lunch, then we played.', ['we ate lunch then we played', 'We ate lunch then, we played', 'We, ate lunch then we played'], 'The comma separates the two clauses.'],
      ['What goes at the end of a question?', 'A question mark', ['A full stop', 'A comma', 'A colon'], 'Questions end with ?'],
      ['Which word should start with a capital letter?', 'London', ['table', 'running', 'quickly'], 'Names of places are proper nouns.'],
      ['What punctuation shows someone is speaking?', 'Speech marks', ['Brackets', 'A hyphen', 'A comma'], 'Speech marks go around the words spoken.'],
      ['Which shows possession correctly?', "the dog's bone", ['the dogs bone', 'the dogs’ bone for one dog', 'the dog’s’ bone'], 'One dog owns the bone, so it is dog’s.'],
      ['What ends an exclamation?', 'An exclamation mark', ['A comma', 'A colon', 'A semicolon'], 'Exclamations end with !'],
      ['Where does a full stop go?', 'At the end of a sentence', ['At the start', 'In the middle of a word', 'After every word'], 'A full stop closes a statement.'],
      ['Which sentence uses capital letters correctly?', 'On Monday we visited Paris.', ['on monday we visited paris.', 'On monday we visited paris.', 'ON MONDAY we Visited Paris.'], 'Days and places are proper nouns.'],
      ['Which sentence needs a question mark?', 'Where are my shoes', ['I like apples', 'Shut the door', 'It is raining'], 'It asks something, so it needs ?'],
      ['What punctuation separates items in a list?', 'Commas', ['Full stops', 'Question marks', 'Brackets'], 'Commas separate list items.'],
      ['Which is the correct contraction of "do not"?', "don't", ['dont', "do'nt", 'donot'], 'The apostrophe replaces the missing o.']
    ],
    spelling: [
      ['Which word is spelled correctly?', 'Necessary', ['Neccessary', 'Necesary', 'Nesessary'], 'Necessary: one c, two s.'],
      ['Which word is spelled correctly?', 'Beautiful', ['Beutiful', 'Beautifull', 'Beautifil'], 'Beautiful keeps the "eau" from beauty.'],
      ['Which word is spelled correctly?', 'Because', ['Becuase', 'Becouse', 'Becasue'], 'Be-cause.'],
      ['Which word is spelled correctly?', 'Separate', ['Seperate', 'Seperete', 'Separete'], 'There is "a rat" in sepARATe.'],
      ['Which word is spelled correctly?', 'Friend', ['Freind', 'Frend', 'Friand'], 'Fri-END: your friend to the end.'],
      ['Which word is spelled correctly?', 'February', ['Febuary', 'Febrary', 'Februrary'], 'February keeps the r after Feb.'],
      ['Which word is spelled correctly?', 'Believe', ['Beleive', 'Belive', 'Beleve'], 'Believe has i before e.'],
      ['Which word is spelled correctly?', 'Different', ['Diffrent', 'Diferent', 'Differant'], 'Dif-fer-ent has three syllables.'],
      ['Which word is spelled correctly?', 'Tomorrow', ['Tommorow', 'Tomorow', 'Tommorrow'], 'One m, two r.'],
      ['Which word is spelled correctly?', 'Enough', ['Enuff', 'Enugh', 'Enouhg'], 'Enough ends with -ough.'],
      ['Which word is spelled correctly?', 'People', ['Peaple', 'Pepole', 'Peopel'], 'Peo-ple.']
    ],
    phonics: [
      ['Which word begins with the "sh" sound?', 'ship', ['sun', 'chip', 'thin'], 'Ship starts with sh.'],
      ['Which word rhymes with "cat"?', 'hat', ['cot', 'cup', 'car'], 'Cat and hat both end in -at.'],
      ['How many sounds are in the word "dog"?', '3', ['2', '4', '1'], 'd-o-g makes three sounds.'],
      ['Which word has the long "ee" sound?', 'tree', ['bed', 'tap', 'dog'], 'Tree has the long ee sound.'],
      ['Which is a real word?', 'blend', ['blen', 'brend', 'blond'], 'Blend is a real word.'],
      ['Which word begins with the "ch" sound?', 'chair', ['share', 'thumb', 'wheel'], 'Chair starts with ch.'],
      ['Which word rhymes with "sing"?', 'ring', ['sang', 'song', 'sun'], 'Sing and ring both end in -ing.'],
      ['How many sounds are in "ship"?', '3', ['4', '2', '5'], 'sh-i-p makes three sounds.'],
      ['Which word has the "oo" sound as in moon?', 'spoon', ['book', 'sock', 'sun'], 'Spoon has the long oo sound.'],
      ['Which word starts with a vowel?', 'apple', ['table', 'ship', 'green'], 'A, e, i, o and u are vowels.'],
      ['Which two letters make one sound in "thin"?', 'th', ['in', 'hi', 'nt'], 'Th is a digraph: two letters, one sound.']
    ],
    online: [
      ['What should you do if a website asks for your home address?', 'Tell a trusted adult', ['Type it in quickly', 'Share it with friends', 'Ignore it and carry on'], 'Never give personal details without a trusted adult.'],
      ['What makes a strong password?', 'A long mix of words and numbers', ['Your name', '1234', 'Your birthday'], 'Long and unusual passwords are hard to guess.'],
      ['Someone online is unkind to you. What is best?', 'Tell a trusted adult', ['Be unkind back', 'Keep it secret', 'Delete your account'], 'Always tell an adult you trust.'],
      ['Should you share your password with a friend?', 'No, keep it private', ['Yes, always', 'Only on Fridays', 'Yes if they ask twice'], 'Passwords stay private, even from friends.'],
      ['A stranger online asks to meet you. What do you do?', 'Tell a trusted adult straight away', ['Go and meet them', 'Give them your address', 'Keep it secret'], 'Always tell a trusted adult.'],
      ['What counts as personal information?', 'Your address, school and phone number', ['Your favourite colour', 'The weather', 'A cartoon you like'], 'Personal information can identify you.'],
      ['If a website looks scary or rude, what should you do?', 'Close it and tell an adult', ['Keep watching', 'Send it to friends', 'Save it'], 'Close it and tell someone you trust.'],
      ['Is everything you read online true?', 'No, you should check it', ['Yes, always', 'Only in videos', 'Only pictures'], 'Anyone can post online, so check facts.'],
      ['What should you do before downloading something?', 'Ask a trusted adult', ['Download it quickly', 'Turn off the screen', 'Share it first'], 'Downloads can carry viruses — check with an adult.'],
      ['What is it called when someone is repeatedly unkind online?', 'Cyberbullying', ['Streaming', 'Downloading', 'Searching'], 'Cyberbullying should always be reported to an adult.'],
      ['Which is the safest thing to use as a username?', 'A nickname with no personal details', ['Your full name', 'Your address', 'Your date of birth'], 'Usernames should not give away who you are.']
    ]
  };

  /* ── topics: keywords → source ──────────────────────────── */
  const TOPICS = [
    { id: 'addition', label: 'addition', gen: G.addition,
      words: ['add', 'adding', 'addition', 'plus', 'sum', 'sums', 'altogether', 'total', 'more than', 'count on', '+'] },
    { id: 'subtraction', label: 'subtraction', gen: G.subtraction,
      words: ['subtract', 'subtraction', 'minus', 'take away', 'takeaway', 'less than', 'fewer', 'count back', 'difference', '-', '−'] },
    { id: 'times', label: 'times tables', gen: G.times,
      words: ['times table', 'times tables', 'multiplication', 'multiply', 'multiplying', 'times', 'x table', 'product', '×'] },
    { id: 'division', label: 'division', gen: G.division,
      words: ['divide', 'division', 'dividing', 'shared between', 'sharing', 'groups of', '÷'] },
    { id: 'doubling', label: 'doubling', gen: G.doubling, words: ['double', 'doubling', 'doubles'] },
    { id: 'halving', label: 'halving', gen: G.halving, words: ['half', 'halving', 'halves'] },
    { id: 'missing', label: 'missing number', gen: G.missing, words: ['missing number', 'missing numbers', 'number bond', 'number bonds', 'fill the gap'] },
    { id: 'place', label: 'place value', gen: G.place, words: ['place value', 'tens and ones', 'hundreds', 'digit', 'digits'] },
    { id: 'fractions', label: 'fractions', gen: G.fractionOf, words: ['fraction', 'fractions', 'quarter', 'thirds', 'fifths', 'of a number'] },
    { id: 'money', label: 'money', gen: G.money, words: ['money', 'coins', 'pounds', 'pence', 'change', 'shopping', 'cost', 'price'] },
    { id: 'time', label: 'telling the time', gen: G.time, words: ['telling the time', 'the time', 'clock', 'clocks', 'o clock', "o'clock", 'past and to'] },
    { id: 'compare', label: 'comparing numbers', gen: G.compare, words: ['compare', 'comparing', 'greater than', 'smaller', 'bigger number', 'order numbers'] },
    { id: 'rounding', label: 'rounding', gen: G.rounding, words: ['round', 'rounding', 'nearest ten', 'nearest 10', 'estimate'] },
    { id: 'oddeven', label: 'odd and even', gen: G.oddEven, words: ['odd', 'even', 'odd and even'] },
    { id: 'counting', label: 'counting patterns', gen: G.counting, words: ['counting', 'count in', 'sequence', 'pattern', 'skip counting', 'next number'] },
    { id: 'shapes', label: 'shapes', gen: G.shapeSides, words: ['shape', 'shapes', '2d', 'geometry', 'sides', 'polygon', 'triangle', 'hexagon'] },

    { id: 'wordclass', label: 'word classes', gen: G.wordClass,
      words: ['noun', 'nouns', 'verb', 'verbs', 'adjective', 'adjectives', 'adverb', 'adverbs', 'word class', 'grammar', 'parts of speech'] },
    { id: 'plurals', label: 'plurals', gen: G.plural, words: ['plural', 'plurals', 'singular'] },
    { id: 'opposites', label: 'opposites', gen: G.opposite, words: ['opposite', 'opposites', 'antonym', 'antonyms'] },
    { id: 'synonyms', label: 'synonyms', gen: G.synonym, words: ['synonym', 'synonyms', 'means the same', 'similar words'] },
    { id: 'homophones', label: 'homophones', gen: G.homophone, words: ['homophone', 'homophones', 'sound the same', 'their there'] },
    { id: 'alphabetical', label: 'alphabetical order', gen: G.alphabetical, words: ['alphabetical', 'alphabet order', 'abc order'] },
    { id: 'capitals', label: 'capital cities', gen: G.capital, words: ['capital city', 'capital cities', 'capitals', 'countries and capitals'] },

    { id: 'space', label: 'space', bank: B.space, words: ['space', 'planet', 'planets', 'solar system', 'moon', 'astronomy', 'stars', 'rocket'] },
    { id: 'body', label: 'the human body', bank: B.body, words: ['body', 'human body', 'organs', 'heart', 'bones', 'teeth', 'senses', 'health'] },
    { id: 'animals', label: 'animals', bank: B.animals, words: ['animal', 'animals', 'mammal', 'reptile', 'habitat', 'creatures', 'wildlife', 'pets'] },
    { id: 'plants', label: 'plants', bank: B.plants, words: ['plant', 'plants', 'flower', 'photosynthesis', 'seeds', 'growing', 'garden'] },
    { id: 'weather', label: 'weather and the water cycle', bank: B.weather,
      words: ['weather', 'water cycle', 'rain', 'clouds', 'evaporation', 'condensation', 'seasons', 'climate'] },
    { id: 'materials', label: 'materials', bank: B.materials, words: ['material', 'materials', 'solid', 'liquid', 'gas', 'melting', 'states of matter', 'properties'] },
    { id: 'forces', label: 'forces and magnets', bank: B.forces, words: ['force', 'forces', 'gravity', 'friction', 'magnet', 'magnets', 'push and pull'] },
    { id: 'geography', label: 'geography', bank: B.geography,
      words: ['geography', 'continent', 'continents', 'ocean', 'oceans', 'rivers', 'mountains', 'desert', 'world'] },
    { id: 'uk', label: 'the United Kingdom', bank: B.uk, words: ['uk', 'united kingdom', 'britain', 'british', 'england', 'scotland', 'wales'] },
    { id: 'history', label: 'history', bank: B.history,
      words: ['history', 'war', 'romans', 'viking', 'vikings', 'tudor', 'tudors', 'egypt', 'egyptian', 'castle', 'knights', 'past', 'ancient'] },
    { id: 'dinosaurs', label: 'dinosaurs', bank: B.dinosaurs, words: ['dinosaur', 'dinosaurs', 'fossil', 'fossils', 'jurassic', 'prehistoric', 'trex', 't rex'] },
    { id: 'punctuation', label: 'punctuation', bank: B.punctuation,
      words: ['punctuation', 'capital letter', 'full stop', 'comma', 'apostrophe', 'speech marks', 'sentence'] },
    { id: 'spelling', label: 'spelling', bank: B.spelling, words: ['spelling', 'spellings', 'spell', 'misspelled'] },
    { id: 'phonics', label: 'phonics', bank: B.phonics, words: ['phonics', 'sounds', 'rhyme', 'rhyming', 'digraph', 'blending', 'reading'] },
    { id: 'online', label: 'staying safe online', bank: B.online,
      words: ['online safety', 'internet safety', 'e-safety', 'esafety', 'passwords', 'cyber'] }
  ];

  /* generic subject fallbacks: "maths quiz" with no sub-topic named */
  const SUBJECTS = {
    maths: ['addition', 'subtraction', 'times', 'division', 'doubling', 'halving', 'fractions', 'money', 'counting', 'shapes'],
    english: ['wordclass', 'plurals', 'opposites', 'synonyms', 'spelling', 'punctuation', 'homophones'],
    science: ['space', 'body', 'animals', 'plants', 'weather', 'materials', 'forces'],
    humanities: ['geography', 'history', 'uk', 'capitals']
  };
  const SUBJECT_WORDS = {
    maths: ['maths', 'math', 'mathematics', 'numeracy', 'arithmetic', 'numbers'],
    english: ['english', 'literacy', 'language', 'writing', 'vocabulary'],
    science: ['science', 'biology', 'chemistry', 'physics', 'nature'],
    humanities: ['humanities', 'topic work', 'social studies']
  };

  /** Score every topic against what the teacher typed and take the best. */
  function match(text) {
    const t = ' ' + text.toLowerCase().replace(/[^a-z0-9+×÷−'\- ]/g, ' ').replace(/\s+/g, ' ') + ' ';
    let best = null, bestScore = 0;
    for (const topic of TOPICS) {
      let score = 0;
      for (const w of topic.words) {
        if (t.includes(' ' + w + ' ') || t.includes(' ' + w)) score += w.length > 4 ? 3 : 2;
      }
      if (score > bestScore) { bestScore = score; best = topic; }
    }
    if (best) return { topic: best, subject: null };

    for (const [subject, words] of Object.entries(SUBJECT_WORDS)) {
      if (words.some(w => t.includes(' ' + w))) return { topic: null, subject };
    }
    return { topic: null, subject: null };
  }

  const byId = (id) => TOPICS.find(t => t.id === id);

  function draw(topic, level, taken, tries = 60) {
    const out = [];
    for (let i = 0; i < tries && out.length < 1; i++) {
      let q = null;
      if (topic.gen) q = topic.gen(level);
      else {
        const row = pick(topic.bank);
        q = mc(row[0], row[1], row[2], row[3]);
      }
      if (q && !taken.has(q.text.toLowerCase())) { taken.add(q.text.toLowerCase()); out.push(q); }
    }
    return out[0] || null;
  }

  /**
   * Produce `count` questions for whatever the teacher typed.
   * Returns {topicLabel, questions} or {topicLabel: null} when nothing matched.
   */
  function generate(prompt, count, existingTexts = []) {
    const level = detectLevel(prompt.toLowerCase());
    const { topic, subject } = match(prompt);
    const taken = new Set(existingTexts.map(t => String(t).toLowerCase()));

    let sources, label;
    if (topic) { sources = [topic]; label = topic.label; }
    else if (subject) { sources = SUBJECTS[subject].map(byId).filter(Boolean); label = subject === 'humanities' ? 'geography and history' : subject; }
    else return { topicLabel: null, questions: [] };

    const questions = [];
    for (let i = 0; questions.length < count && i < count * 12; i++) {
      const q = draw(sources[questions.length % sources.length], level, taken);
      if (q) questions.push(q);
    }
    return { topicLabel: label, questions };
  }

  global.QuizBank = { generate, match, detectLevel, TOPICS, SUBJECTS, _internals: { G, B, mc } };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.QuizBank;
