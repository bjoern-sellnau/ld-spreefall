// One Man Army: the whole of it against one man, and more of it every time.
//
// A wave comes every forty seconds or so, and every wave is a level up from
// the last. The first is a squad on foot. Then the squads are bigger and come
// by jeep, then a tank comes with them, then a mech arrives out of the sky,
// then bombs fall in a line across the street you are in and jets come round,
// and the mechs that come get heavier: the light raptors first, the walking
// fortresses and the eleven metre one last. The armies grow with the level
// up to a ceiling, and the gap between waves shrinks to one.
//
// Nightmare puts the city's own super weapons on their side as well. From the
// third wave, every other wave (and from the eighth every wave) one of them
// comes down on you, in turn: the ion cannon, a rain of ultra plasma, a void
// storm and a warhead. On you, and not on them: of the points near enough to
// you that you are inside what it does, the one with the fewest of their own
// inside it is the one it is aimed at, so it kills its own side only when
// there is no point near you that does not. What you get is the time it
// takes to charge or to fall, and a warning.
//
// This only decides what comes and when. The game layer sends it, with the
// spawners and the guns it already has.

export const ONSLAUGHT = {
  first: 12,                // seconds to the first wave once it is switched on
  gap: 40,                  // between waves at the start
  gapLess: 2.5,             // and this much less each level
  gapLeast: 18,
  soldiers: { base: 4, per: 2, most: 34 },
  machinesFrom: 5,          // a share of the squad is steel from here
  convoyFrom: 2,
  convoyMen: { base: 4, per: 1, most: 16 },
  tankFrom: 3,
  mechFrom: 4,
  mechEvery: 2,             // one more mech every this many levels
  mechsMost: 4,
  mechTop: 12,              // the level by which the heaviest chassis come
  bombsFrom: 5,
  bombs: { base: 6, per: 2, most: 22, spacing: 9, offset: [18, 55], from: [70, 150] },
  jetsFrom: 6,
  jetsMost: 4,
  nightmare: {
    from: 3,
    everyFrom: 8,           // a super weapon every wave from here
    order: ['ion', 'ultra', 'storm', 'nuke'],
    // How far from you the aim may be moved to spare their own, at most: a
    // share of what it reaches, so you are inside it wherever it goes.
    shift: { ion: 90, ultra: 30, storm: 30, nuke: 70 },
    ultra: { count: 160, radius: 70, tilt: 25 },
    storm: { count: 45, radius: 70, tilt: 20 },
  },
};

const clampN = (v, most) => Math.max(0, Math.min(most, Math.round(v)));

/**
 * Where a super weapon aimed at you comes down: you, or a point as far as
 * `shift` from you, whichever has the fewest of their own within `reach` of
 * it. A mech or a vehicle counts three times a man. Of the points that tie,
 * the nearest to you.
 *
 * @param {{x,z}} at you
 * @param {{x,z,weight?:number}[]} friends theirs
 * @param {number} reach how far what it does reaches
 * @param {number} shift how far the aim may move
 * @returns {{x:number, z:number, cost:number, off:number}}
 */
export function pickStrike(at, friends, reach, shift) {
  const tries = [[0, 0]];
  for (const k of [1 / 3, 2 / 3, 1]) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      tries.push([Math.cos(a) * shift * k, Math.sin(a) * shift * k]);
    }
  }
  let best = null;
  for (const [dx, dz] of tries) {
    const x = at.x + dx, z = at.z + dz;
    let cost = 0;
    for (const f of friends) if (Math.hypot(f.x - x, f.z - z) <= reach) cost += f.weight || 1;
    const off = Math.hypot(dx, dz);
    if (!best || cost < best.cost || (cost === best.cost && off < best.off)) best = { x, z, cost, off };
  }
  return best;
}

export class Onslaught {
  constructor() {
    this.reset();
  }

  reset() {
    this.level = 0;             // the wave last sent
    this.clock = ONSLAUGHT.first;
    this.supers = 0;            // super weapons sent, which picks the next
    this.on = false;
  }

  /** Seconds from this wave to the next. */
  gapAfter(level) {
    return Math.max(ONSLAUGHT.gapLeast, ONSLAUGHT.gap - ONSLAUGHT.gapLess * Math.max(0, level - 1));
  }

  /**
   * What a wave at this level is made of.
   *
   * @param {number} level 1 for the first
   * @param {boolean} nightmare whether the super weapons come too
   * @param {string[]} chassis their mechs, lightest first
   * @param {() => number} rand
   */
  plan(level, nightmare, chassis = [], rand = Math.random) {
    const O = ONSLAUGHT;
    const out = { level, soldiers: 0, machines: 0, convoy: null, mechs: [], bombs: 0, jets: 0, superweapon: null };
    const foot = clampN(O.soldiers.base + O.soldiers.per * (level - 1), O.soldiers.most);
    out.machines = level >= O.machinesFrom ? Math.floor(foot / 3) : 0;
    out.soldiers = foot - out.machines;
    if (level >= O.convoyFrom) {
      out.convoy = { men: clampN(O.convoyMen.base + O.convoyMen.per * (level - O.convoyFrom), O.convoyMen.most), tank: level >= O.tankFrom };
    }
    if (level >= O.mechFrom && chassis.length) {
      const n = Math.min(O.mechsMost, 1 + Math.floor((level - O.mechFrom) / O.mechEvery));
      // Heavier as it goes: by mechTop the heaviest are what comes.
      const t = Math.min(1, (level - O.mechFrom) / Math.max(1, O.mechTop - O.mechFrom));
      const top = Math.round(t * (chassis.length - 1));
      for (let i = 0; i < n; i++) {
        const k = Math.max(0, top - Math.floor(rand() * 2));
        out.mechs.push(chassis[k]);
      }
    }
    if (level >= O.bombsFrom) out.bombs = clampN(O.bombs.base + O.bombs.per * (level - O.bombsFrom), O.bombs.most);
    if (level >= O.jetsFrom) out.jets = Math.min(O.jetsMost, 1 + Math.floor((level - O.jetsFrom) / 2));
    if (nightmare && level >= O.nightmare.from) {
      const k = level - O.nightmare.from;
      if (level >= O.nightmare.everyFrom || k % 2 === 0) {
        out.superweapon = O.nightmare.order[this.supers % O.nightmare.order.length];
      }
    }
    return out;
  }

  /**
   * A step of the clock. Switched off it forgets where it had got to, so
   * switching it on again starts from the first wave.
   *
   * @returns {object|null} the wave to send now, if there is one
   */
  update(dt, { on, nightmare = false, chassis = [], rand = Math.random } = {}) {
    if (!on) {
      if (this.on) this.reset();
      return null;
    }
    this.on = true;
    this.clock -= dt;
    if (this.clock > 0) return null;
    this.level++;
    const wave = this.plan(this.level, nightmare, chassis, rand);
    if (wave.superweapon) this.supers++;
    this.clock = this.gapAfter(this.level);
    return wave;
  }
}
