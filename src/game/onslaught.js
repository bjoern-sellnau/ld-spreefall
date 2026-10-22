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
// comes down near you, in turn: the ion cannon, a rain of ultra plasma, a void
// storm and a warhead. Near you rather than on you: each lands far enough off
// that what it does reaches the street you are in without starting there, so
// the city goes and you have the time it takes to fall to get out of the way.
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
    // How far off each lands: past what it does, by this much.
    away: { ion: [250, 320], ultra: [150, 210], storm: [150, 210], nuke: [240, 320] },
    ultra: { count: 160, radius: 70, tilt: 25 },
    storm: { count: 45, radius: 70, tilt: 20 },
  },
};

const clampN = (v, most) => Math.max(0, Math.min(most, Math.round(v)));

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
