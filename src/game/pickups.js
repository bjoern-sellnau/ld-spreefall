// What is lying about in the street: ammunition, a medical kit, and the three
// power ups. They sit on pads scattered over walkable ground, and a pad comes
// back on a timer after it is taken, the way an arena shooter does it, so the
// map itself is something you learn to move around.
//
// The pads are found once, at the start, by asking the world where a person
// could actually stand. That keeps them out of walls and off the river without
// anyone having to author a list of coordinates.

export const KIND = {
  AMMO: 'ammo',
  HEALTH: 'health',
  QUAD: 'quad',
  ULTRA: 'ultra',
  OVERLOAD: 'overload',
};

export const PICKUP = {
  ammo: {
    name: 'Ammunition', label: 'AMMO', respawn: 22, radius: 1.8,
    // A crate fills the weapon in your hands and tops up everything else.
    held: 1.0, others: 0.25,
  },
  health: {
    name: 'Medical kit', label: 'HEALTH', respawn: 28, radius: 1.8, heal: 55,
  },
  quad: {
    name: 'Quad damage', label: 'QUAD', respawn: 75, radius: 2.0,
    power: true, seconds: 22, damage: 4,
  },
  ultra: {
    name: 'Ultrashield', label: 'ULTRA', respawn: 70, radius: 2.0,
    power: true, seconds: 26, shield: 260,
  },
  overload: {
    name: 'Overload', label: 'OVERLOAD', respawn: 65, radius: 2.0,
    power: true, seconds: 18, rate: 0.55, reload: 0.4,
  },
};

// How many pads of each kind the city carries. Ammunition and health are
// common; the power ups are meant to be worth walking to.
const COUNTS = { ammo: 14, health: 10, quad: 3, ultra: 3, overload: 3 };

export class Pickups {
  /**
   * @param {object} world the collision world
   * @param {(x,y,z)=>boolean} isSanctuary nothing spawns in the memorial
   */
  constructor(world, isSanctuary) {
    this.world = world;
    this.isSanctuary = isSanctuary || (() => false);
    this.pads = [];
    this.onTaken = null;
    this.onRespawn = null;
  }

  /** Scatters the pads over open ground. Called once, after the world loads. */
  place(seedX = 0, seedZ = 0) {
    this.pads.length = 0;
    const w = this.world;
    const rand = (a, b) => a + Math.random() * (b - a);
    for (const kind in COUNTS) {
      let placed = 0;
      for (let attempt = 0; attempt < COUNTS[kind] * 90 && placed < COUNTS[kind]; attempt++) {
        // Power ups go further out than ammunition, so the good things are
        // somewhere rather than everywhere.
        const far = PICKUP[kind].power ? rand(120, 900) : rand(40, 620);
        const a = Math.random() * Math.PI * 2;
        const x = seedX + Math.cos(a) * far;
        const z = seedZ + Math.sin(a) * far;
        if (x < w.minX + 25 || x > w.maxX - 25) continue;
        if (z < w.minZ + 25 || z > w.maxZ - 25) continue;
        if (this.isSanctuary(x, 0, z)) continue;
        const g = w.groundHeight(x, z);
        // Somewhere a person could stand: nothing within arm's reach, and not
        // on top of something else.
        let boxed = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7]]) {
          if (w.raycast(x, g + 1.0, z, dx, 0, dz, 2.2)) { boxed = true; break; }
        }
        if (boxed) continue;
        let tooClose = false;
        for (const p of this.pads) {
          if (Math.hypot(p.x - x, p.z - z) < 45) { tooClose = true; break; }
        }
        if (tooClose) continue;
        this.pads.push({
          kind, x, y: g + 0.9, z,
          ready: true, timer: 0, bob: Math.random() * 6.28, spin: Math.random() * 6.28,
        });
        placed++;
      }
    }
    return this.pads.length;
  }

  reset() {
    for (const p of this.pads) { p.ready = true; p.timer = 0; }
  }

  /** @returns {Array} the pads that are currently showing something */
  get live() {
    const out = [];
    for (const p of this.pads) if (p.ready) out.push(p);
    return out;
  }

  /**
   * @param {number} dt seconds
   * @param {{x:number,y:number,z:number}} player
   * @returns {object|null} the pad taken this step, if any
   */
  update(dt, player) {
    let taken = null;
    for (const p of this.pads) {
      p.bob += dt * 1.8;
      p.spin += dt * 1.1;
      if (!p.ready) {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.ready = true;
          if (this.onRespawn) this.onRespawn(p);
        }
        continue;
      }
      if (taken) continue;
      const spec = PICKUP[p.kind];
      const dx = player.x - p.x, dz = player.z - p.z;
      const dy = player.y - p.y;
      if (Math.abs(dy) > 2.6) continue;
      if (dx * dx + dz * dz > spec.radius * spec.radius) continue;
      p.ready = false;
      p.timer = spec.respawn;
      taken = p;
    }
    if (taken && this.onTaken) this.onTaken(taken, PICKUP[taken.kind]);
    return taken;
  }

  /** The nearest live pad, for the map and for telling you where to run. */
  nearest(x, z, kind = null) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.pads) {
      if (!p.ready) continue;
      if (kind && p.kind !== kind) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? { pad: best, distance: bestD } : null;
  }
}
