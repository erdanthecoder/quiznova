/* Boss Battle: ten seconds with a sword, in the round.
 *
 * The quiz stopped being the game here. Answering is how you arm yourself — get
 * it right and get it right quickly and you walk in swinging something that can
 * actually hurt the thing — and then the fight is a fight: ten seconds of real
 * time where the class is around a boss in a ring, hitting it, and being swept
 * off their feet when they misread it.
 *
 * Why two buttons and no joystick
 *   A thumbstick on a phone is a menu you operate badly. Ten seconds is not long
 *   enough to learn one, and a child looking down at a stick is a child not
 *   watching the board. So you are always facing the boss, and the only two
 *   things you do are SWING and DODGE — which is enough, because the game is not
 *   about where you stand. It is about when you move.
 *
 * The loop that makes it worth playing twice
 *   The boss winds up, out loud, with a ring that closes on you. Dodge as it
 *   lands and you are untouched and it is off balance — a stagger window where
 *   every hit counts triple. Dodge early and you have wasted it. Don't dodge and
 *   you are on the floor for a second and a half, watching everybody else score.
 *   So the good players are not the fast readers. They are the ones who waited.
 *
 * What the answer actually buys
 *   A right answer, quickly, is a greatsword: long reach, heavy hits. A right
 *   answer slowly is a sword. A wrong answer is a stick — weak, but a stick is
 *   still a thing to hold, and a child who got it wrong is still in the fight
 *   rather than watching one. Nobody sits out a round in this mode.
 *
 * Where the work happens
 *   Every device runs its own fight and draws everyone else from what they
 *   broadcast, exactly as the Laser Tag arena does. Damage is reported by the
 *   phone that dealt it and totalled by the host, so thirty children swinging is
 *   thirty small messages rather than one device simulating a room.
 */
(function (global) {
  'use strict';

  /* Close quarters. The ring was 560 wide with a 330-tall boss in the middle
     of it, which on a phone is a monster the size of a thumbnail at the far end
     of a hall. It is a ten-second knife fight: everybody stands within reach,
     and the thing fills the screen. */
  const R_RING = 370;                  // how far the class stands from the boss
  const BOSS_R = 170, PLAYER_R = 26;
  const BODY_H = 120, BOSS_H = 430;

  /* Ten seconds, and the shape of them. A fight this short has to start
   * immediately and finish on a beat, so the boss's first wind-up lands at 3.4s
   * and the second at 7.2s: two real decisions per round, never three. */
  const ROUND_MS = 10000;
  const WINDUPS = [3400, 7200];
  const TELL_MS = 1100;                // how long the ring takes to close
  const DODGE_MS = 420;                // how long a dodge keeps you safe
  const DODGE_COOL = 900;
  const FLOOR_MS = 1500;               // knocked down
  const STAGGER_MS = 1600;             // its window of weakness after a clean dodge

  /* ── the weapons ──────────────────────────────────────────
   *
   * A blade used to be two strokes of the canvas: a brown line for the hilt and
   * a coloured line for the blade. At the size it is drawn that is a scratch,
   * not a sword, and "everyone has a different knife" meant nothing because you
   * could not tell one scratch from another.
   *
   * So every weapon is built properly now, from the pommel forwards: a wrapped
   * grip, a cross guard or a tsuba or a bare haft, a blade with a bevel down
   * each side, a fuller cut along the middle and a bright line on the edge.
   * Six silhouettes, and you can name all six from across a classroom.
   *
   * Drawn in a space where the hand is the origin and the weapon points along
   * +x, so the same code draws it in a fist in the ring, swinging, and blown up
   * on the card on your phone.
   */
  const WEAPONS = {
    straight: { name: 'Longsword', len: 1.00, w: 0.085, guard: 0.34, kind: 'sword' },
    cleaver:  { name: 'Cleaver',   len: 0.62, w: 0.215, guard: 0.22, kind: 'cleaver' },
    katana:   { name: 'Katana',    len: 1.08, w: 0.062, guard: 0.22, kind: 'katana' },
    dagger:   { name: 'Dagger',    len: 0.58, w: 0.082, guard: 0.24, kind: 'sword' },
    axe:      { name: 'War axe',   len: 0.86, w: 0.125, guard: 0.00, kind: 'axe' },
    spear:    { name: 'Spear',     len: 1.30, w: 0.050, guard: 0.00, kind: 'spear' }
  };
  const SHAPE_IDS = ['straight', 'cleaver', 'katana', 'dagger', 'axe', 'spear'];
  /** Which of the six a child carries. It comes from their blook, so it is
      theirs for the whole game rather than being dealt out each round. */
  const shapeFor = (avatar) => SHAPE_IDS[(Number(avatar) || 0) % SHAPE_IDS.length];

  /* What it is made of. The tier is what the answer earned: fast and right is
     the only way to steel with a light in it. */
  const METAL = {
    great: { lip: '#FFFFFF', mid: '#D6F1FF', low: '#3E8FC0', glow: '#7FD8FF',
             hilt: '#F2C75C', hiltLow: '#9A7420', grip: '#331F5E', wrap: '#5A3FA8' },
    sword: { lip: '#FFFFFF', mid: '#E2E8F1', low: '#6E7784', glow: '',
             hilt: '#B99A55', hiltLow: '#715B2C', grip: '#3A2C22', wrap: '#5C4633' },
    stick: { lip: '#D9BC8E', mid: '#A8814D', low: '#634727', glow: '',
             hilt: '#634727', hiltLow: '#402C17', grip: '#4A3520', wrap: '#634727' }
  };

  const fill = (ctx, pts, style) => {
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  };

  /**
   * drawWeapon(ctx, L, shapeId, tier)
   *   L    how long the weapon is, in pixels, hand to tip
   *   The hand is at the origin and the weapon points along +x.
   */
  function drawWeapon(ctx, L, shapeId, tier) {
    const W = WEAPONS[shapeId] || WEAPONS.straight;
    const M = METAL[tier] || METAL.stick;
    const h = L * W.w;                    // half the blade's width
    const gl = L * 0.22;                  // the grip, behind the hand
    const steel = ctx.createLinearGradient(0, -h * 1.4, 0, h * 1.4);
    steel.addColorStop(0, M.lip);
    steel.addColorStop(0.42, M.mid);
    steel.addColorStop(1, M.low);

    ctx.save();
    ctx.lineJoin = 'round';
    if (M.glow) { ctx.shadowColor = M.glow; ctx.shadowBlur = L * 0.10; }

    if (W.kind === 'axe' || W.kind === 'spear') {
      // a haft the whole way, in wood, with the head mounted near the end
      const hw = L * 0.028;
      fill(ctx, [[-gl, -hw], [L * (W.kind === 'axe' ? 1.0 : 0.82), -hw],
                 [L * (W.kind === 'axe' ? 1.0 : 0.82), hw], [-gl, hw]], '#5A4028');
      fill(ctx, [[-gl, -hw], [L * 0.8, -hw], [L * 0.8, -hw * 0.25], [-gl, -hw * 0.25]],
           'rgba(255,255,255,.16)');
    }

    if (W.kind === 'sword') {
      fill(ctx, [[0, -h], [L * 0.86, -h * 0.74], [L, 0], [L * 0.86, h * 0.74], [0, h]], steel);
      // the fuller, the groove down the middle of a real blade
      fill(ctx, [[L * 0.06, -h * 0.3], [L * 0.78, -h * 0.22],
                 [L * 0.78, h * 0.22], [L * 0.06, h * 0.3]], 'rgba(0,0,0,.22)');
      // and the bright line on the cutting edge
      ctx.strokeStyle = M.lip;
      ctx.lineWidth = Math.max(0.6, L * 0.010);
      ctx.beginPath();
      ctx.moveTo(0, -h); ctx.lineTo(L * 0.86, -h * 0.74); ctx.lineTo(L, 0);
      ctx.stroke();
    } else if (W.kind === 'katana') {
      const c = L * 0.10;                 // how much it curves
      ctx.beginPath();
      ctx.moveTo(0, -h);
      ctx.quadraticCurveTo(L * 0.55, -h - c, L * 0.99, -c * 1.5 - h * 0.1);
      ctx.lineTo(L, -c * 1.5 + h * 0.5);
      ctx.quadraticCurveTo(L * 0.55, h - c, 0, h);
      ctx.closePath();
      ctx.fillStyle = steel; ctx.fill();
      // the hamon: the temper line a folded blade carries along its edge
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = Math.max(0.8, L * 0.012);
      ctx.beginPath();
      ctx.moveTo(L * 0.04, h * 0.45);
      ctx.quadraticCurveTo(L * 0.55, h * 0.4 - c, L * 0.95, -c * 1.3);
      ctx.stroke();
    } else if (W.kind === 'cleaver') {
      fill(ctx, [[0, -h * 0.72], [L * 0.94, -h * 0.92], [L, -h * 0.45],
                 [L * 0.99, h * 1.25], [L * 0.09, h * 1.05], [0, h * 0.72]], steel);
      fill(ctx, [[L * 0.06, -h * 0.55], [L * 0.90, -h * 0.72],
                 [L * 0.90, -h * 0.05], [L * 0.06, h * 0.18]], 'rgba(255,255,255,.22)');
      // the hole a butcher hangs it by
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(L * 0.86, -h * 0.5, h * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = M.lip;
      ctx.lineWidth = Math.max(0.8, L * 0.012);
      ctx.beginPath();
      ctx.moveTo(L * 0.09, h * 1.05); ctx.lineTo(L * 0.99, h * 1.25);
      ctx.stroke();
    } else if (W.kind === 'axe') {
      /* A bearded head: a horn at the top, an arc for the cutting edge and a
         beard hanging below the haft. Drawn as straight lines it was a wedge,
         and a wedge is a doorstop. */
      const head = () => {
        ctx.beginPath();
        ctx.moveTo(L * 0.63, -L * 0.028);
        ctx.quadraticCurveTo(L * 0.80, -h * 1.00, L * 0.73, -h * 1.75);   // neck, concave
        ctx.quadraticCurveTo(L * 0.95, -h * 1.30, L * 1.00, -h * 0.10);   // edge, upper
        ctx.quadraticCurveTo(L * 0.98, h * 1.30, L * 0.71, h * 1.95);     // edge, the beard
        ctx.quadraticCurveTo(L * 0.80, h * 1.00, L * 0.63, L * 0.028);    // back to the neck
        ctx.closePath();
      };
      head(); ctx.fillStyle = steel; ctx.fill();
      ctx.strokeStyle = M.lip;
      ctx.lineWidth = Math.max(0.8, L * 0.011);
      head(); ctx.stroke();
      // the langets, the straps that hold a head on
      fill(ctx, [[L * 0.5, -L * 0.05], [L * 0.62, -L * 0.05],
                 [L * 0.62, L * 0.05], [L * 0.5, L * 0.05]], M.hiltLow);
    } else {
      // spear: a leaf head on a socket
      fill(ctx, [[L * 0.78, -h * 0.5], [L * 0.86, -h * 1.7], [L, 0],
                 [L * 0.86, h * 1.7], [L * 0.78, h * 0.5]], steel);
      fill(ctx, [[L * 0.8, -h * 0.4], [L * 0.87, -h * 1.2],
                 [L * 0.96, -h * 0.1], [L * 0.86, -h * 0.1]], 'rgba(255,255,255,.3)');
      fill(ctx, [[L * 0.745, -h * 0.62], [L * 0.80, -h * 0.62],
                 [L * 0.80, h * 0.62], [L * 0.745, h * 0.62]], M.hiltLow);
    }

    ctx.shadowBlur = 0;

    // the guard, then the grip, then the pommel
    if (W.guard > 0) {
      const gy = L * W.guard / 2, gx = L * 0.030;
      if (W.kind === 'katana') {
        ctx.fillStyle = M.hilt;
        ctx.beginPath(); ctx.ellipse(0, 0, gx * 1.5, gy, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = M.hiltLow;
        ctx.beginPath(); ctx.ellipse(0, 0, gx * 0.7, gy * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        fill(ctx, [[-gx, -gy], [gx * 1.6, -gy * 0.72], [gx * 1.6, gy * 0.72], [-gx, gy]], M.hilt);
        fill(ctx, [[-gx, -gy], [gx * 1.6, -gy * 0.72],
                   [gx * 1.6, -gy * 0.3], [-gx, -gy * 0.4]], 'rgba(255,255,255,.35)');
      }
    }

    /* The grip is sized off the weapon, not off the blade. It used to be
       h * 1.05, so a cleaver — which is wide by definition — came with a fist
       you could not close and a pommel the size of an apple. */
    const gh = Math.min(Math.max(h * 0.85, L * 0.026), L * 0.040);
    ctx.fillStyle = M.grip;
    ctx.beginPath();
    ctx.roundRect(-gl, -gh, gl + L * 0.01, gh * 2, gh * 0.5);
    ctx.fill();
    ctx.strokeStyle = M.wrap;
    ctx.lineWidth = Math.max(0.7, L * 0.011);
    for (let i = 1; i <= 4; i++) {
      const x = -gl + (gl / 5) * i;
      ctx.beginPath();
      ctx.moveTo(x - gh * 0.5, -gh); ctx.lineTo(x + gh * 0.5, gh);
      ctx.stroke();
    }
    ctx.fillStyle = M.hilt;
    const pr = Math.min(gh * 1.25, L * 0.048);
    ctx.beginPath(); ctx.arc(-gl, 0, pr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = M.hiltLow;
    ctx.beginPath(); ctx.arc(-gl, pr * 0.22, pr * 0.46, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /** The name of what somebody is carrying, for the card and the leaderboard. */
  function weaponName(avatar, tier) {
    const base = (WEAPONS[shapeFor(avatar)] || WEAPONS.straight).name;
    if (tier === 'great') return 'Gleaming ' + base.toLowerCase();
    if (tier === 'stick') return 'Blunt ' + base.toLowerCase();
    return base;
  }

  const BLADES = {
    great: { label: 'Greatsword', reach: 250, damage: 26, swing: 420, colour: '#FFC53D' },
    sword: { label: 'Sword',      reach: 200, damage: 16, swing: 380, colour: '#E9ECF5' },
    stick: { label: 'A stick',    reach: 150, damage: 6,  swing: 320, colour: '#8B6A4A' }
  };
  /** What your answer earned you. Fast and right is the only way to a greatsword. */
  function bladeFor(correct, speed) {
    if (!correct) return 'stick';
    return speed >= 0.5 ? 'great' : 'sword';
  }

  /* The same twelve colours the blooks use, so a child in the ring is the
   * colour they picked in the lobby. */
  const SKIN = ['#F4364C', '#4F6BFF', '#FFC53D', '#12BE8E', '#7C4DFF', '#2BA8FF',
                '#FF7A45', '#00B8A9', '#E8467C', '#7BC62D', '#FF9A3D', '#3AC0D8'];

  const now = () => performance.now();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const TAU = Math.PI * 2;

  /* ── the boss ─────────────────────────────────────────────
   *
   * It was one quadratic curve with two dots on it: a purple traffic cone. A
   * class is supposed to be frightened of this thing and then proud of killing
   * it, and neither works if it looks like a traffic cone.
   *
   * So it is built out of parts, the way a creature is: two braced legs with
   * talons, a heavy torso under a cracked chest plate with a furnace behind it,
   * spiked pauldrons, two long arms ending in claws, a hunched neck, a skull
   * with a heavy brow and a jaw full of teeth, and four horns. It breathes, its
   * furnace pulses, it raises its arms and opens its jaw when it is about to
   * swing, and it sags with its eyes gone pale when a clean dodge staggers it.
   *
   * Drawn in its own units — 330 tall, the origin between its feet, y upwards —
   * so the whole animal is one transform away from any size on any screen.
   */
  const HIDE = { dark: '#1A1426', mid: '#2C2340', lit: '#40325C' };
  const PLATE = { dark: '#231B34', mid: '#3B2F55', lit: '#57487A' };
  const BONE = { dark: '#9A917C', mid: '#D9D2BE', lit: '#F3EEDF' };

  function bossArt(ctx, u, t, mood) {
    const breath = Math.sin(t / 760) * 0.022;
    const raise = mood.raise || 0;          // 0 resting, 1 arms up to strike
    const jaw = mood.jaw || 0;              // 0 shut, 1 roaring
    const sag = mood.sag || 0;              // 0 upright, 1 reeling
    const eye = mood.eye || '#FF3B2F';
    const heat = 0.55 + Math.sin(t / 240) * 0.2 + raise * 0.45;

    ctx.save();
    ctx.scale(u, u);
    ctx.translate(0, sag * 26);
    ctx.rotate(sag * Math.sin(t / 110) * 0.05);
    ctx.lineJoin = 'round';

    /* A limb, tapered and bellied the way a muscle is. Straight-sided boxes
       were what made this read as a machine rather than an animal. */
    const limb = (w0, w1, len, style) => {
      ctx.beginPath();
      ctx.moveTo(-w0, 0);
      ctx.quadraticCurveTo(-w0 * 1.22, len * 0.46, -w1, len);
      ctx.lineTo(w1, len);
      ctx.quadraticCurveTo(w0 * 1.22, len * 0.46, w0, 0);
      ctx.closePath();
      ctx.fillStyle = style; ctx.fill();
    };

    const poly = (pts, style) => {
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.closePath(); ctx.fillStyle = style; ctx.fill();
    };

    /* ── behind it: the spines down its back ── */
    [[-16, -252, 30], [14, -244, 36], [44, -222, 28], [70, -192, 20]].forEach(([x, y, s]) => {
      poly([[x - s * 0.3, y], [x + s * 0.15, y - s * 1.5], [x + s * 0.45, y]], BONE.dark);
    });

    /* ── the far arm, behind the body ── */
    drawArm(-1, 0.86);

    /* ── legs: braced apart, heavy at the thigh, taloned ── */
    [-1, 1].forEach(side => {
      const hx = side * 44;
      ctx.save(); ctx.translate(hx, -132);
      limb(42, 32, 78, HIDE.mid); ctx.restore();
      ctx.save(); ctx.translate(hx, -56);
      limb(31, 29, 48, HIDE.dark); ctx.restore();
      // the foot, and three talons on the front of it
      poly([[hx - 26, -14], [hx + 34, -14], [hx + 44, 2], [hx - 30, 2]], HIDE.mid);
      [-18, -2, 14].forEach(tx => {
        poly([[hx + tx, -2], [hx + tx + 11, -2], [hx + tx + 5, 9]], BONE.mid);
      });
      // a seam of light in the cracks of its hide
      ctx.strokeStyle = `rgba(255,120,40,${0.30 + heat * 0.3})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hx - 8, -120); ctx.lineTo(hx + 4, -92); ctx.lineTo(hx - 6, -64);
      ctx.stroke();
    });

    /* ── the torso ── */
    ctx.save();
    ctx.translate(0, -132);
    ctx.scale(1 + breath, 1 + breath * 0.6);
    ctx.translate(0, 132);

    ctx.beginPath();
    ctx.moveTo(-66, -118);
    ctx.quadraticCurveTo(-108, -180, -92, -240);
    ctx.quadraticCurveTo(0, -258, 92, -240);
    ctx.quadraticCurveTo(108, -180, 66, -118);
    ctx.quadraticCurveTo(0, -104, -66, -118);
    ctx.closePath();
    const skin = ctx.createLinearGradient(-96, 0, 96, 0);
    skin.addColorStop(0, HIDE.dark);
    skin.addColorStop(0.42, HIDE.lit);
    skin.addColorStop(1, HIDE.dark);
    ctx.fillStyle = skin; ctx.fill();

    // the chest plate, bolted on, cracked down the middle
    poly([[-64, -134], [-74, -228], [74, -228], [64, -134]], PLATE.mid);
    poly([[-64, -134], [-74, -228], [-30, -228], [-26, -134]], PLATE.lit);
    ctx.strokeStyle = 'rgba(255,120,40,.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-6, -228); ctx.lineTo(8, -196); ctx.lineTo(-10, -168); ctx.lineTo(4, -138);
    ctx.stroke();

    // the furnace behind the plate
    const core = ctx.createRadialGradient(0, -186, 3, 0, -186, 46);
    core.addColorStop(0, '#FFF0C4');
    core.addColorStop(0.35, `rgba(255,170,50,${0.85 * heat})`);
    core.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(0, -186, 46, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFD98A';
    ctx.beginPath(); ctx.arc(0, -186, 9 + heat * 4, 0, Math.PI * 2); ctx.fill();

    // rivets round the plate, because a plate is bolted to something
    ctx.fillStyle = PLATE.dark;
    [[-58, -214], [58, -214], [-52, -150], [52, -150], [0, -232]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();

    /* ── shoulders: spiked pauldrons over the arm joints ── */
    [-1, 1].forEach(side => {
      const sx = side * 92;
      ctx.save();
      ctx.translate(sx, -232);
      ctx.rotate(side * 0.2);
      ctx.beginPath();
      ctx.ellipse(0, 0, 47, 36, 0, Math.PI, Math.PI * 2);
      ctx.lineTo(42, 14); ctx.lineTo(-42, 14);
      ctx.closePath();
      ctx.fillStyle = PLATE.mid; ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-7, -3, 35, 26, 0, Math.PI, Math.PI * 2);
      ctx.fillStyle = PLATE.lit; ctx.fill();
      [-30, 0, 30].forEach((x, i) => {
        poly([[x - 9, -22 - i % 2 * 4], [x, -56 + Math.abs(x) * 0.35], [x + 9, -22]], BONE.mid);
      });
      ctx.restore();
    });

    /* ── the near arm, in front of the body ── */
    drawArm(1, 1);

    /* ── neck and head ── */
    poly([[-26, -244], [26, -244], [22, -274], [-22, -274]], HIDE.dark);

    ctx.save();
    ctx.translate(0, -274 - jaw * 2);
    ctx.rotate(-sag * 0.22);

    // the skull: a heavy brow, a narrow muzzle
    ctx.beginPath();
    ctx.moveTo(-54, 6);
    ctx.quadraticCurveTo(-64, -42, -34, -58);
    ctx.quadraticCurveTo(0, -70, 34, -58);
    ctx.quadraticCurveTo(64, -42, 54, 6);
    ctx.quadraticCurveTo(0, 20, -54, 6);
    ctx.closePath();
    const skull = ctx.createLinearGradient(-54, -60, 54, 20);
    skull.addColorStop(0, HIDE.lit);
    skull.addColorStop(1, HIDE.dark);
    ctx.fillStyle = skull; ctx.fill();

    // a cold rim light down its left, so the silhouette lifts off the dark
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(150,130,255,.5)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-54, 4); ctx.quadraticCurveTo(-64, -42, -34, -58);
    ctx.stroke();
    ctx.restore();

    // the brow, which is what makes a face look like it means it
    poly([[-56, -18], [-30, -34], [30, -34], [56, -18], [34, -12], [-34, -12]], PLATE.dark);

    // sockets, and the light burning in them
    [-1, 1].forEach(side => {
      const ex = side * 26;
      poly([[ex - 18, -14], [ex + 18, -14], [ex + 12, 6], [ex - 14, 4]], '#0A0612');
      ctx.save();
      ctx.shadowColor = eye; ctx.shadowBlur = 22;
      ctx.fillStyle = eye;
      ctx.beginPath();
      ctx.ellipse(ex, -5, 10, sag > 0.3 ? 3 : 7, side * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // the jaw, hinged, and the teeth in it
    ctx.save();
    ctx.translate(0, 6);
    ctx.rotate(jaw * 0.42);
    poly([[-44, 0], [44, 0], [32, 34], [-32, 34]], HIDE.mid);
    poly([[-32, 30], [32, 30], [26, 40], [-26, 40]], HIDE.dark);
    for (let i = -3; i <= 3; i++) {
      const x = i * 11;
      poly([[x - 5, 2], [x + 5, 2], [x, 17]], BONE.lit);
    }
    ctx.restore();
    // the upper teeth stay with the skull
    for (let i = -3; i <= 3; i++) {
      const x = i * 11;
      poly([[x - 5, 8], [x + 5, 8], [x, -7]], BONE.lit);
    }

    /* ── horns: two long, two short, all curving back ── */
    [[-42, -40, -1, 1], [42, -40, 1, 1], [-30, -54, -1, 0.55], [30, -54, 1, 0.55]]
      .forEach(([hx, hy, side, size]) => {
        ctx.save();
        ctx.translate(hx, hy);
        ctx.scale(side * size, size);
        ctx.beginPath();
        ctx.moveTo(-8, 6);
        ctx.quadraticCurveTo(22, -14, 54, -62);
        ctx.quadraticCurveTo(30, -18, 10, 4);
        ctx.closePath();
        const horn = ctx.createLinearGradient(0, 0, 40, -60);
        horn.addColorStop(0, BONE.dark);
        horn.addColorStop(1, BONE.lit);
        ctx.fillStyle = horn; ctx.fill();
        // the ridges a horn grows in
        ctx.strokeStyle = 'rgba(0,0,0,.24)';
        ctx.lineWidth = 2.2;
        [0.3, 0.5, 0.7].forEach(f => {
          ctx.beginPath();
          ctx.moveTo(6 + 40 * f, -52 * f + 6);
          ctx.lineTo(1 + 40 * f, -52 * f - 3);
          ctx.stroke();
        });
        ctx.restore();
      });
    ctx.restore();
    ctx.restore();

    /** One arm. `side` is which, `shade` dims the one behind the body. */
    function drawArm(side, shade) {
      const lift = raise * 0.95 + sag * -0.35;
      ctx.save();
      ctx.globalAlpha = shade;
      /* Swung out from the shoulder rather than hanging down the front. They
         used to be drawn straight down the middle at nearly the length of the
         whole animal, so the chest they were meant to frame was behind them. */
      ctx.translate(side * 96, -230);
      ctx.rotate(side * (0.58 - lift));
      // upper arm
      limb(21, 14, 64, side > 0 ? HIDE.lit : HIDE.dark);
      ctx.translate(0, 64);
      ctx.rotate(side * (0.34 + raise * 0.8));
      // forearm, thicker at the wrist the way a heavy thing is
      limb(15, 20, 58, side > 0 ? HIDE.mid : HIDE.dark);
      poly([[-18, 48], [20, 48], [17, 66], [-15, 66]], PLATE.mid);
      // the hand, and four talons off the end of it
      ctx.translate(0, 66);
      [-15, -5, 5, 15].forEach((tx, i) => {
        ctx.save();
        ctx.translate(tx, 0);
        ctx.rotate((i - 1.5) * 0.24);
        poly([[-5, 0], [5, 0], [1, 27 - Math.abs(i - 1.5) * 5]], BONE.mid);
        ctx.restore();
      });
      ctx.restore();
    }
  }

  /**
   * start(options) → controller
   *   canvas     where to draw
   *   me         this player ({ id, name, avatar }), or null on the board
   *   blade      'great' | 'sword' | 'stick'
   *   watching   true for the board: draw everyone, control nobody
   *   boss       { name, hp, max }
   *   seed       so every device runs the same boss from the same script
   *   send       (event, payload) => void
   *   onHit      (damage, critical) => void
   *   onDone     () => void
   */
  function start(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    const watching = !!opts.watching;
    const send = opts.send || (() => {});
    const meId = opts.me ? opts.me.id : 'board';
    const boss = Object.assign({ name: 'The Boss', hp: 100, max: 100 }, opts.boss || {});

    /* Everybody in the ring, this device's own player included. Others arrive
     * over the broadcast and are drawn from whatever they last said. */
    const folk = new Map();
    const startedAt = now();
    let raf = null, finished = false;
    let hits = 0, best = 0;

    const self = {
      id: meId, name: (opts.me && opts.me.name) || '', avatar: (opts.me && opts.me.avatar) || 0,
      angle: Math.random() * TAU,        // where in the ring this player stands
      blade: BLADES[opts.blade] ? opts.blade : 'stick',
      swingAt: -9999, dodgeAt: -9999, downUntil: 0, combo: 0, damage: 0, lunge: 0
    };
    if (!watching) folk.set(meId, self);

    /* The boss's script, identical on every device because it is derived rather
     * than rolled: two wind-ups at fixed times, each aimed at a third of the
     * ring picked from the seed. Nobody can be out of step about what it did. */
    const seed = (opts.seed || 1) >>> 0;
    const swings = WINDUPS.map((at, i) => ({
      at,
      // which arc of the ring the sweep covers: half of it, so standing still is
      // a coin flip and reading the tell is not
      from: ((seed >> (i * 7)) % 360) * Math.PI / 180,
      span: Math.PI,
      landed: false
    }));

    const elapsed = () => now() - startedAt;

    /** The wind-up currently on screen, if any. */
    function winding(t) {
      for (const s of swings) {
        if (t >= s.at - TELL_MS && t < s.at) return s;
      }
      return null;
    }
    let staggerUntil = 0;

    // ── the 3D camera, the same one the Laser Tag arena uses ──
    const TILT = 0.80, FOCAL = 900, EYE = 560, NEAR = 60;
    const sinT = Math.sin(TILT), cosT = Math.cos(TILT);
    let cam = { x: 0, y: 0, scale: 1, cx: 0, cy: 0 };

    function raw(x, y, z) {
      const ey = cam.y - y, ez = EYE - z;
      const depth = ey * cosT + ez * sinT;
      if (depth < NEAR) return null;
      const k = FOCAL / depth;
      return { rx: (x - cam.x) * k, ry: (ey * sinT - ez * cosT) * k, k, depth };
    }
    function project(x, y, z) {
      const r = raw(x, y, z);
      if (!r) return null;
      return { x: cam.cx + r.rx * cam.scale, y: cam.cy - r.ry * cam.scale,
               k: r.k * cam.scale, depth: r.depth };
    }

    /* The board looks at the whole ring from outside it. A phone stands behind
     * its own player, looking past their shoulder at the thing trying to kill
     * them, which is the only camera that makes a ten-second fight legible. */
    function fit() {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      if (watching) {
        cam.x = 0; cam.y = R_RING + 1100;
        const edge = R_RING + 160;
        const corners = [raw(-edge, -edge, 0), raw(edge, -edge, 0),
                         raw(edge, edge, 0), raw(-edge, edge, 0),
                         // the horns reach well above the head: frame for the tips
                         raw(0, 0, BOSS_H * 1.14)].filter(Boolean);
        if (corners.length) {
          const xs = corners.map(c => c.rx), ys = corners.map(c => c.ry);
          const spanX = Math.max(...xs) - Math.min(...xs) || 1;
          const spanY = Math.max(...ys) - Math.min(...ys) || 1;
          cam.scale = Math.min(w * 0.94 / spanX, h * 0.94 / spanY);
          cam.cx = w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * cam.scale;
          cam.cy = h / 2 + ((Math.max(...ys) + Math.min(...ys)) / 2) * cam.scale;
        } else { cam.scale = 1; cam.cx = w / 2; cam.cy = h / 2; }
      } else {
        /* The phone's camera, in view coordinates — which is the only place it
         * can be. Everything is drawn through view(), which rotates the ring so
         * this player is always at the bottom of their own screen; placing the
         * camera in world coordinates instead put it somewhere else entirely and
         * left the boss behind it, so the fight rendered as an empty floor for
         * every spawn angle but one. The spawn angle is random, so it was wrong
         * almost always and right just often enough to look like a flaky test.
         *
         * In view space this player is at (0, +ringAt) and the boss at the
         * origin, so the camera stands a little further out on the same line
         * and looks along −y at both of them. */
        /* Close in. It was 900 units across at the player's own depth, which
           put the thing trying to kill them a thumbnail away at the top of the
           screen. A boss has to fill the screen to be frightening. */
        const BEHIND = 250, VIEW = 560;
        cam.x = 0;
        cam.y = ringAt(self) + BEHIND;
        const depth = BEHIND * cosT + EYE * sinT;
        cam.scale = w / (VIEW * (FOCAL / depth));
        cam.cx = w / 2;
        cam.cy = h * 0.74;
      }
      return cam;
    }
    /* A phone's camera looks along −y, so the whole ring is rotated under it to
     * put this player at the bottom of their own screen. On the board there is
     * no rotation: everybody is where they are. */
    const view = (p) => {
      // +π/2 rather than −π/2: this player has to land at +y, on the camera's
      // side of the boss, or they are behind the lens and nothing is drawn
      const a = watching ? p.angle : p.angle - self.angle + Math.PI / 2;
      return { x: Math.cos(a) * ringAt(p), y: Math.sin(a) * ringAt(p), a };
    };
    /** How far out this player is standing: lunging in on a swing, out otherwise. */
    const ringAt = (p) => R_RING - (p.lunge || 0) * 90;

    // ── what this player does ──
    function swing() {
      const t = elapsed();
      if (finished || t > ROUND_MS) return;
      if (now() < self.downUntil) return;
      const b = BLADES[self.blade];
      if (now() - self.swingAt < b.swing) return;
      self.swingAt = now();

      // the stagger window is the whole point of dodging well
      const critical = now() < staggerUntil;
      const dealt = Math.round(b.damage * (critical ? 3 : 1) * (1 + Math.min(self.combo, 6) * 0.08));
      self.damage += dealt;
      self.combo += 1;
      best = Math.max(best, self.combo);
      hits += 1;
      if (opts.onHit) opts.onHit(dealt, critical);
      spark(dealt, critical);
      send('strike:hit', { id: meId, d: dealt, c: critical ? 1 : 0 });
    }

    function dodge() {
      if (finished) return;
      if (now() < self.downUntil) return;
      if (now() - self.dodgeAt < DODGE_COOL) return;
      self.dodgeAt = now();
    }

    /* The sweep lands. Anyone inside its arc who is not mid-dodge goes down; a
     * clean dodge staggers the boss for everybody, which is why the room starts
     * shouting at each other about when to roll. */
    function land(s) {
      s.landed = true;
      let dodgedClean = false;
      for (const p of folk.values()) {
        const a = ((p.angle - s.from) % TAU + TAU) % TAU;
        const caught = a <= s.span;
        const rolling = now() - (p.dodgeAt || -9999) < DODGE_MS;
        if (!caught) continue;
        if (rolling) { dodgedClean = true; continue; }
        p.downUntil = now() + FLOOR_MS;
        p.combo = 0;
        if (p.id === meId) shake(18);
      }
      if (dodgedClean) staggerUntil = now() + STAGGER_MS;
      if (!watching && now() - (self.dodgeAt || -9999) < DODGE_MS) {
        const a = ((self.angle - s.from) % TAU + TAU) % TAU;
        if (a <= s.span) flash('Clean dodge');
      }
    }

    // ── a little life on the screen ──
    const sparks = [];
    let shakeUntil = 0, shakeAmt = 0, flashText = '', flashUntil = 0;
    const HIT_MS = 220;          // how long the boss wears a knife on its face
    let hitUntil = 0;
    function spark(amount, critical) {
      const v = view(self);
      sparks.push({ x: v.x * 0.5, y: v.y * 0.5, z: BOSS_H * 0.55, born: now(),
                    text: (critical ? '×3  ' : '') + amount, critical });
    }
    const shake = (n) => { shakeUntil = now() + 260; shakeAmt = n; };
    const flash = (t) => { flashText = t; flashUntil = now() + 900; };

    // ── other devices ──
    function heard(event, payload) {
      if (!payload || payload.id === meId) return;
      if (event === 'strike:where') {
        const p = folk.get(payload.id) || { id: payload.id, combo: 0, damage: 0 };
        p.name = payload.n || p.name; p.avatar = payload.a || 0;
        p.angle = payload.g; p.blade = payload.b || 'stick';
        p.lunge = payload.l || 0;
        p.downUntil = payload.d ? now() + payload.d : 0;
        folk.set(payload.id, p);
      } else if (event === 'strike:hit') {
        const p = folk.get(payload.id);
        if (p) { p.damage = (p.damage || 0) + (payload.d || 0); p.flashUntil = now() + 200; }
        if (watching && opts.onHit) opts.onHit(payload.d || 0, !!payload.c);
      }
    }

    let lastSend = 0;
    function tell() {
      if (watching) return;
      if (now() - lastSend < 100) return;
      lastSend = now();
      send('strike:where', { id: meId, n: self.name, a: self.avatar, g: self.angle,
                             b: self.blade, l: self.lunge,
                             d: Math.max(0, Math.round(self.downUntil - now())) });
    }

    // ── drawing ──
    function draw() {
      const t = elapsed();
      const w = canvas.width, h = canvas.height;
      fit();
      ctx.save();
      if (now() < shakeUntil) {
        ctx.translate((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt);
      }
      // the hall
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#0A0620'); sky.addColorStop(0.38, '#191140');
      sky.addColorStop(0.56, '#0C0820'); sky.addColorStop(1, '#06030D');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      hall(t);
      // the floor: a disc with rings on it, so distance is readable
      floorDisc();
      const s = winding(t);
      if (s) tell_ring(s, t);
      for (const sw of swings) if (!sw.landed && t >= sw.at) land(sw);

      // everything from the back of the room forwards
      const drawable = [...folk.values()].map(p => ({ p, v: view(p) }))
        .sort((a, b) => b.v.y - a.v.y);
      const bossFront = drawable.filter(d => d.v.y < 0);
      const bossBack = drawable.filter(d => d.v.y >= 0);
      bossBack.forEach(d => figure(d.p, d.v));
      bossFigure(t);
      bossFront.forEach(d => figure(d.p, d.v));
      sparkles();
      ctx.restore();
      hud(t);
    }

    /* The room the fight happens in.
     *
     * It used to be a gradient: the boss floated in a dark rectangle with a
     * purple puddle under it, and a class looking up at the board saw a shape
     * in a void. Now there are pillars down both walls, braziers burning
     * between them and a lit archway behind the boss, so the thing is standing
     * in its own hall and reads as big. Drawn once a frame, all of it flat and
     * cheap — nothing here is projected, because it is scenery and never moves.
     */
    function hall(t) {
      const w = canvas.width, h = canvas.height;
      const line = h * 0.52;                  // where the back wall meets the floor

      // the far wall, and the light on it behind the boss
      const wall = ctx.createLinearGradient(0, 0, 0, line);
      wall.addColorStop(0, '#120C2C');
      wall.addColorStop(1, '#1B1240');
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, w, line);

      const glow = ctx.createRadialGradient(w / 2, line, 10, w / 2, line, w * 0.42);
      glow.addColorStop(0, 'rgba(255,90,40,.26)');
      glow.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, line);

      // the arch the boss came through
      ctx.fillStyle = '#0A0620';
      ctx.beginPath();
      ctx.moveTo(w * 0.36, line);
      ctx.lineTo(w * 0.36, h * 0.20);
      ctx.quadraticCurveTo(w / 2, h * 0.04, w * 0.64, h * 0.20);
      ctx.lineTo(w * 0.64, line);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(180,160,255,.18)';
      ctx.lineWidth = Math.max(2, h * 0.006);
      ctx.stroke();

      // pillars down both sides, and a brazier at the foot of each
      for (let i = 0; i < 4; i++) {
        const inset = 0.035 + i * 0.075;
        [inset, 1 - inset].forEach((fx, side) => {
          const px = w * fx, pw = w * (0.034 - i * 0.005);
          const top = h * (0.06 + i * 0.03);
          ctx.fillStyle = side ? '#1A1238' : '#160F30';
          ctx.fillRect(px - pw / 2, top, pw, line - top);
          ctx.fillStyle = 'rgba(255,255,255,.05)';
          ctx.fillRect(px - pw / 2, top, pw * 0.26, line - top);
          // the fire on it, breathing
          const fire = 0.7 + Math.sin(t / 240 + i * 2 + side) * 0.3;
          const fy = line - h * (0.03 + i * 0.012);
          const f = ctx.createRadialGradient(px, fy, 1, px, fy, h * 0.055 * fire);
          f.addColorStop(0, 'rgba(255,220,140,.95)');
          f.addColorStop(0.45, 'rgba(255,120,40,.55)');
          f.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = f;
          ctx.beginPath();
          ctx.arc(px, fy, h * 0.055 * fire, 0, TAU);
          ctx.fill();
        });
      }
    }

    function floorDisc() {
      const steps = 44;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * TAU;
        const pt = project(Math.cos(a) * (R_RING + 210), Math.sin(a) * (R_RING + 210), 0);
        if (!pt) continue;
        i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y);
      }
      ctx.closePath();
      const mid = project(0, 0, 0);
      if (mid) {
        const g = ctx.createRadialGradient(mid.x, mid.y, 10, mid.x, mid.y, canvas.width * 0.7);
        g.addColorStop(0, 'rgba(124,77,255,.34)');
        g.addColorStop(1, 'rgba(10,6,24,.96)');
        ctx.fillStyle = g;
      } else ctx.fillStyle = '#140E2C';
      ctx.fill();

      ctx.strokeStyle = 'rgba(180,160,255,.22)';
      ctx.lineWidth = 2;
      [BOSS_R + 40, R_RING - 90, R_RING].forEach(r => {
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * TAU;
          const pt = project(Math.cos(a) * r, Math.sin(a) * r, 0);
          if (!pt) continue;
          i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y);
        }
        ctx.closePath(); ctx.stroke();
      });
    }

    /* The wind-up, drawn on the floor where it will land. It is deliberately
     * enormous and deliberately red: the whole mechanic is that you can see it
     * coming, and a warning nobody notices is not a mechanic at all. */
    function tell_ring(s, t) {
      const p = clamp((t - (s.at - TELL_MS)) / TELL_MS, 0, 1);
      const steps = 36;
      ctx.beginPath();
      const inner = project(0, 0, 0);
      if (inner) ctx.moveTo(inner.x, inner.y);
      for (let i = 0; i <= steps; i++) {
        const a = s.from + (i / steps) * s.span;
        const pt = project(Math.cos(a) * (R_RING + 150), Math.sin(a) * (R_RING + 150), 0);
        if (pt) ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(244,54,76,${0.14 + 0.34 * p})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255,90,110,${0.5 + 0.5 * p})`;
      ctx.lineWidth = 3 + 6 * p;
      ctx.stroke();
    }

    /* The blooks in the ring. Canvas cannot draw an SVG string, so each face is
       rasterised once into an offscreen canvas and then stamped. The data URI
       needs an explicit xmlns: inline HTML infers the SVG namespace, a data URI
       does not, and without it the image silently never loads. */
    const faces = new Map();
    function blookFace(avatar) {
      const key = String(avatar || 0);
      if (faces.has(key)) return faces.get(key);
      const spot = { ready: false, canvas: null };
      faces.set(key, spot);
      try {
        const svg = global.Sprite.face(Number(avatar) || 0, 128)
          .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = 128; c.height = 128;
          c.getContext('2d').drawImage(img, 0, 0, 128, 128);
          spot.canvas = c; spot.ready = true;
        };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      } catch { /* no Sprite here: the plain body stands in */ }
      return spot;
    }

    function bossFigure(t) {
      const foot = project(0, 0, 0);
      const head = project(0, 0, BOSS_H);
      if (!foot || !head) return;
      const tall = Math.max(20, foot.y - head.y);
      const u = tall / 330;                 // the boss is 330 of its own units tall
      const staggered = now() < staggerUntil;
      const s = winding(t);
      // how far into a wind-up it is: arms up, jaw open, furnace roaring
      const wind = s ? clamp((t - (s.at - TELL_MS)) / TELL_MS, 0, 1) : 0;

      ctx.save();

      // the shadow it stands in
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, BOSS_R * foot.k * 1.5, BOSS_R * foot.k * 0.44, 0, 0, TAU);
      ctx.fill();

      // the light it throws on the floor around it
      const pool = ctx.createRadialGradient(foot.x, foot.y - tall * 0.5, 4,
                                            foot.x, foot.y - tall * 0.5, tall * 1.1);
      pool.addColorStop(0, `rgba(255,120,40,${0.16 + wind * 0.22})`);
      pool.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.arc(foot.x, foot.y - tall * 0.5, tall * 1.1, 0, TAU);
      ctx.fill();

      ctx.translate(foot.x, foot.y);
      /* A knife landing has to be visible from the back of a classroom. The
         boss jerks back, and for a tenth of a second the whole figure is drawn
         white — the flash is what the eye catches; the number is for afterwards. */
      const hit = clamp((hitUntil - now()) / HIT_MS, 0, 1);
      if (hit) ctx.translate(0, -tall * 0.05 * hit);
      bossArt(ctx, u, now(), {
        raise: wind,
        jaw: staggered ? 0.15 : wind * 0.9,
        sag: staggered ? 1 : 0,
        eye: staggered ? '#FFD23F' : '#FF3B2F'
      });
      if (hit) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = hit * 0.85;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(-tall, -tall * 1.2, tall * 2, tall * 1.4);
        ctx.restore();
      }
      ctx.restore();

      /* Its health used to be painted on the floor here, a bar the width of
         the boss's feet with children standing in front of it. The board's
         own panel now carries thirty pips across its whole width, which is
         readable from the back of a hall; two of them was one too many. */
    }

    /* One child in the ring: their own blook, stood on a coloured disc, holding
       the weapon their answer earned them. The weapon points at the boss and
       swings through an arc when they strike. */
    function figure(p, v) {
      const foot = project(v.x, v.y, 0);
      const mid = project(v.x, v.y, BODY_H * 0.55);
      if (!foot || !mid) return;
      const down = now() < (p.downUntil || 0);
      const rolling = now() - (p.dodgeAt || -9999) < DODGE_MS;
      const r = PLAYER_R * foot.k * 1.5;
      const mine = p.id === meId;
      const colour = SKIN[(p.avatar || 0) % SKIN.length];
      const bossFoot = project(0, 0, 0);

      ctx.save();
      ctx.globalAlpha = down ? 0.5 : 1;

      // the shadow, and a ring in their own colour so a class can find itself
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, r * 0.95, r * 0.38, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = mine ? '#FFFFFF' : colour;
      ctx.lineWidth = Math.max(2, 4.5 * foot.k);
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, r * 1.06, r * 0.42, 0, 0, TAU);
      ctx.stroke();

      const bx = foot.x, by = foot.y - (down ? r * 0.4 : r * 1.05);

      /* The weapon, behind the blook when it is being held at rest and in front
         of it through a swing, because a swing comes across the body. */
      const b = BLADES[p.blade] || BLADES.stick;
      const since = now() - (p.swingAt || -9999);
      const swinging = since < b.swing;
      const aim = bossFoot
        ? Math.atan2(bossFoot.y - foot.y, bossFoot.x - foot.x) : -Math.PI / 2;
      const L = (b.reach * 0.62) * foot.k;

      const paintWeapon = () => {
        if (down) return;
        const swung = swinging ? since / b.swing : 0;
        // wound back, then through: the arc is what reads at this size
        const angle = aim + (swinging ? (-1.5 + swung * 2.3) : -0.75);
        ctx.save();
        ctx.translate(bx + Math.cos(aim) * r * 0.5, by + r * 0.12);
        ctx.rotate(angle);
        drawWeapon(ctx, Math.max(14, L), shapeFor(p.avatar), p.blade || 'stick');
        ctx.restore();
        if (swinging) {                    // the trail the edge leaves behind it
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,.5)';
          ctx.lineWidth = Math.max(1.5, 4 * foot.k);
          ctx.beginPath();
          ctx.arc(bx, by + r * 0.12, L * 0.9,
                  aim - 1.5, aim - 1.5 + swung * 2.3);
          ctx.stroke();
          ctx.restore();
        }
      };

      if (!swinging) paintWeapon();

      // the blook itself
      const face = blookFace(p.avatar);
      const size = r * (down ? 1.5 : 2.1);
      if (face && face.ready) {
        ctx.drawImage(face.canvas, bx - size / 2, by - size / 2, size, size);
      } else {
        ctx.fillStyle = colour;
        ctx.beginPath(); ctx.arc(bx, by, size * 0.42, 0, TAU); ctx.fill();
      }

      if (swinging) paintWeapon();

      if (rolling) {
        ctx.strokeStyle = 'rgba(43,168,255,.9)';
        ctx.lineWidth = Math.max(2, 5 * foot.k);
        ctx.beginPath();
        ctx.ellipse(foot.x, foot.y, r * 1.5, r * 0.62, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (watching && p.name) {
        const fs = Math.max(10, 17 * foot.k);
        ctx.font = `800 ${fs}px ui-sans-serif,system-ui,sans-serif`;
        ctx.textAlign = 'center';
        const w = ctx.measureText(p.name).width + fs * 0.9;
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.roundRect(foot.x - w / 2, foot.y + r * 0.5, w, fs * 1.5, fs * 0.75);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.name, foot.x, foot.y + r * 0.5 + fs * 0.78);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();
    }

    function sparkles() {
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        const age = (now() - s.born) / 850;
        if (age >= 1) { sparks.splice(i, 1); continue; }
        const pt = project(s.x, s.y, s.z + age * 150);
        if (!pt) continue;
        ctx.save();
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = s.critical ? '#FFC53D' : '#FFFFFF';
        ctx.font = `800 ${Math.max(14, (s.critical ? 34 : 26) * pt.k)}px ui-sans-serif,system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(s.text, pt.x, pt.y);
        ctx.restore();
      }
    }

    /* The only numbers on screen during the fight: how long is left, and what
     * this player is holding. Anything else is reading, and there is no time. */
    function hud(t) {
      const w = canvas.width, h = canvas.height;
      const left = Math.max(0, ROUND_MS - t);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(0, 0, w, Math.max(34, h * 0.075));
      ctx.fillStyle = left < 3000 ? '#FF5A6E' : '#FFFFFF';
      ctx.font = `800 ${Math.max(16, h * 0.05)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText((left / 1000).toFixed(1) + 's', w * 0.03, h * 0.058);
      if (!watching) {
        ctx.textAlign = 'right';
        ctx.fillStyle = BLADES[self.blade].colour;
        ctx.fillText(BLADES[self.blade].label, w * 0.97, h * 0.058);
        /* The combo goes on its own line. It used to be centred on the same one
         * as the clock and the blade, which on a phone meant all three words
         * sitting on top of each other. */
        if (self.combo >= 2) {
          ctx.textAlign = 'center';
          ctx.fillStyle = '#FFC53D';
          ctx.font = `800 ${Math.max(13, h * 0.038)}px ui-sans-serif,system-ui,sans-serif`;
          ctx.fillText(self.combo + ' in a row', w / 2, h * 0.115);
        }
      }
      if (now() < flashUntil) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#12BE8E';
        ctx.font = `800 ${Math.max(20, h * 0.07)}px ui-sans-serif,system-ui,sans-serif`;
        ctx.fillText(flashText, w / 2, h * 0.30);
      }
      ctx.restore();
    }

    function frame() {
      const t = elapsed();
      if (!watching) {
        // lunging in on a swing and stepping back out, so a swing is visible
        const since = now() - self.swingAt;
        const b = BLADES[self.blade];
        self.lunge = since < b.swing ? Math.sin((since / b.swing) * Math.PI) : 0;
        tell();
      }
      draw();
      if (t >= ROUND_MS && !finished) {
        finished = true;
        if (opts.onDone) opts.onDone({ hits, damage: self.damage, best });
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return {
      swing, dodge, heard,
      setBoss(next) { Object.assign(boss, next || {}); },
      add(p) { if (p && p.id !== meId) folk.set(p.id, Object.assign({ angle: Math.random() * TAU, combo: 0, damage: 0 }, p)); },
      /** The board's boss, refreshed from the game as the class cuts it down. */
      setBoss(next) { if (next) { boss.hp = next.hp; boss.max = next.max || boss.max;
                                  boss.name = next.name || boss.name; } },
      /** Somebody put a knife in: flash the boss and shake the room. */
      struck() {
        staggerUntil = now() + 260;
        shakeUntil = now() + 220; shakeAmt = 10;
        hitUntil = now() + HIT_MS;
      },
      stop() { finished = true; if (raf) cancelAnimationFrame(raf); }
    };
  }

  /* ── the fight, in a child's hand ──────────────────────
   *
   * The phone used to be a button that said STRIKE and a question underneath:
   * you never saw the thing you were fighting, and putting a knife in felt
   * exactly like pressing a button, because that is all it was. The board had
   * the whole fight on it and the child had a form to fill in.
   *
   * This is the same boss, drawn on the phone, close enough to hit. You cut it
   * by dragging across it — a real swipe, with the blade following your thumb
   * and the boss flinching where the line crossed it — and a tap works too,
   * because thirty children include some who will not manage a drag with a
   * phone under a desk.
   */
  function duel(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    let boss = { hp: 30, max: 30, name: opts.name || 'The boss' };
    let loaded = 0, readyAt = 0;
    /* The two things the boss does to you: it winds up where you can see it,
       and it puts you on the floor if it catches you with nothing in hand. */
    let swingIn = null, tellMs = 2200, downFor = 0;
    let hitUntil = 0, shakeUntil = 0, cutFrom = null, cutTo = null, cutUntil = 0;
    let raf = null, stopped = false;
    const born = performance.now();

    function fit() {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, (global.devicePixelRatio || 1));
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    const reloading = () => Math.max(0, readyAt - performance.now());
    const canCut = () => loaded > 0 && reloading() <= 0 && downFor <= 0;

    function frame() {
      if (stopped) return;
      fit();
      const t = performance.now() - born;
      const w = canvas.width, h = canvas.height;
      const hit = Math.max(0, (hitUntil - performance.now()) / 220);

      ctx.save();
      if (performance.now() < shakeUntil) {
        const n = 7 * ((shakeUntil - performance.now()) / 200);
        ctx.translate((Math.random() - 0.5) * n, (Math.random() - 0.5) * n);
      }

      // the pit it is standing in
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#150E36');
      sky.addColorStop(0.62, '#0B0722');
      sky.addColorStop(1, '#05030F');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      const pool = ctx.createRadialGradient(w / 2, h * 0.88, 4, w / 2, h * 0.88, w * 0.7);
      pool.addColorStop(0, `rgba(255,110,40,${0.20 + hit * 0.3})`);
      pool.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = pool;
      ctx.fillRect(0, 0, w, h);

      // the boss, as tall as the card will take
      const u = (h * 0.78) / 330;
      ctx.save();
      ctx.translate(w / 2, h * 0.92 - hit * h * 0.03);
      bossArt(ctx, u, performance.now(), {
        raise: 0, jaw: hit ? 0.8 : 0.12 + Math.sin(t / 900) * 0.06,
        sag: hit ? 1 : 0, eye: hit ? '#FFD23F' : '#FF3B2F'
      });
      if (hit) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = hit * 0.9;
        ctx.fillStyle = '#fff';
        ctx.fillRect(-w, -h, w * 2, h * 2);
        ctx.restore();
      }
      ctx.restore();

      // the cut you just made, still hanging in the air
      if (cutFrom && cutTo && performance.now() < cutUntil) {
        const a = (cutUntil - performance.now()) / 260;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#FFF3C4';
        ctx.lineWidth = Math.max(3, h * 0.016) * a;
        ctx.lineCap = 'round';
        ctx.shadowColor = '#FFC53D';
        ctx.shadowBlur = 24;
        ctx.beginPath();
        ctx.moveTo(cutFrom.x, cutFrom.y);
        ctx.lineTo(cutTo.x, cutTo.y);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      // its health, along the top, one pip a knife
      const pad = w * 0.04, barW = w - pad * 2, barH = Math.max(8, h * 0.035);
      const max = Math.max(1, boss.max);
      const gap = Math.max(1, barW * 0.004);
      const pip = (barW - gap * (max - 1)) / max;
      for (let i = 0; i < max; i++) {
        ctx.fillStyle = i < boss.hp ? '#F4364C' : 'rgba(255,255,255,.14)';
        ctx.beginPath();
        ctx.roundRect(pad + i * (pip + gap), pad, Math.max(1, pip), barH, 3);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = `900 ${Math.max(11, h * 0.042)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(`${boss.name} — ${boss.hp} left`, pad, pad + barH + h * 0.055);

      /* It is winding up. A red band climbs the card and the words change to
         the only thing that matters: have something in your hand when it lands
         or you are going down. */
      if (swingIn !== null && swingIn <= tellMs && swingIn > -700) {
        const wind = 1 - Math.max(0, swingIn) / tellMs;
        ctx.save();
        ctx.fillStyle = `rgba(244,54,76,${0.14 + wind * 0.3})`;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#F4364C';
        ctx.fillRect(0, h - Math.max(4, h * 0.018), w * wind, Math.max(4, h * 0.018));
        ctx.restore();
      }

      // and what this child can do about it right now
      const wait = reloading();
      const winding = swingIn !== null && swingIn <= tellMs && swingIn > -700;
      const say = downFor > 0 ? `DOWN — ANSWER TO GET UP (${(downFor / 1000).toFixed(1)}s)`
        : winding ? (loaded > 0 ? 'HOLD IT — YOU WILL BLOCK' : 'NO KNIFE — YOU WILL GO DOWN')
        : canCut() ? 'SWIPE TO CUT'
        : wait > 0 ? `RELOADING ${(wait / 1000).toFixed(1)}s`
        : 'ANSWER TO LOAD YOUR KNIFE';
      ctx.textAlign = 'center';
      ctx.fillStyle = downFor > 0 ? '#FF8A96'
        : winding ? (loaded > 0 ? '#9CF0D3' : '#FF8A96')
        : canCut() ? '#FFD86B' : 'rgba(255,255,255,.55)';
      ctx.font = `900 ${Math.max(12, h * 0.05)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.fillText(say, w / 2, h * 0.97);
      if (canCut()) {
        // a pulse round the edge, so a loaded knife is obvious without reading
        ctx.strokeStyle = `rgba(255,216,107,${0.35 + Math.sin(t / 260) * 0.25})`;
        ctx.lineWidth = Math.max(2, h * 0.008);
        ctx.strokeRect(2, 2, w - 4, h - 4);
      }

      raf = requestAnimationFrame(frame);
    }

    /* The swipe. Anything that crosses the middle of the card counts, and a tap
       counts too — the point is to hit the boss, not to perform a gesture. */
    const at = (e) => {
      const box = canvas.getBoundingClientRect();
      const p = (e.touches && e.touches[0]) || e;
      const dpr = canvas.width / Math.max(1, box.width);
      return { x: (p.clientX - box.left) * dpr, y: (p.clientY - box.top) * dpr };
    };
    let from = null;
    const down = (e) => { from = at(e); e.preventDefault(); };
    const up = (e) => {
      if (!from) return;
      const to = at(e.changedTouches ? { clientX: e.changedTouches[0].clientX,
                                         clientY: e.changedTouches[0].clientY } : e);
      const swung = from;
      from = null;
      e.preventDefault();
      if (!canCut()) { if (opts.onEmpty) opts.onEmpty(reloading() > 0); return; }
      cutFrom = swung; cutTo = to;
      // a tap leaves a short flick, so it still looks like a cut
      if (Math.hypot(to.x - swung.x, to.y - swung.y) < canvas.width * 0.08) {
        cutFrom = { x: swung.x - canvas.width * 0.12, y: swung.y - canvas.width * 0.12 };
        cutTo = { x: swung.x + canvas.width * 0.12, y: swung.y + canvas.width * 0.12 };
      }
      cutUntil = performance.now() + 260;
      if (opts.onCut) opts.onCut();
    };
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchend', up, { passive: false });
    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('mouseup', up);

    raf = requestAnimationFrame(frame);

    return {
      /** The boss as the game now says it is. */
      setBoss(next) { if (next) boss = Object.assign({}, boss, next); },
      /** How long until the boss swings, so the card can wind up with it. */
      setSwing(ms, tell) { swingIn = ms; if (tell) tellMs = tell; },
      /** How long this child is on the floor for, if they were caught. */
      setDown(ms) { downFor = Math.max(0, Number(ms) || 0); },
      /** How many knives this child has loaded, and when the next one is ready. */
      setKnife(n, waitMs) {
        loaded = Math.max(0, Number(n) || 0);
        if (waitMs !== undefined) readyAt = performance.now() + Math.max(0, waitMs);
      },
      /** A knife went in — anybody's. */
      struck() { hitUntil = performance.now() + 220; shakeUntil = performance.now() + 200; },
      get ready() { return canCut(); },
      stop() { stopped = true; if (raf) cancelAnimationFrame(raf); }
    };
  }

  global.NovaStrike = { start, duel, BLADES, WEAPONS, SHAPE_IDS, shapeFor, bladeFor,
                        drawWeapon, weaponName, ROUND_MS, WINDUPS };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.NovaStrike;
