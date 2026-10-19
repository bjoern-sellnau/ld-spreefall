// The parked cars, as things you can shoot.
//
// A car is street furniture: four boxes baked into the tile it stands on,
// with a collision box beside it, and nothing in a vertex that says car. So
// the builder writes down where it put each one and this keeps the list. A
// hit looks up the list, not the geometry.
//
// What a destroyed car leaves behind is the geometry flattened onto the road
// and the collision box dropped, which is what a burnt out shell looks like
// from a street away, plus whatever the game layer does with the explosion.
// The flattening is permanent and survives a district being thrown away and
// fetched again, the same way a collapsed frontage does.

/** How much a car takes before it goes up. Two rifle magazines, one rocket. */
export const CAR_HEALTH = 70;

/** How near a shot has to be to count as hitting it: the body is 1.8 by 4.3. */
const REACH = 2.6;

/** The cell the lookup grid uses. Nothing is ever asked for beyond one cell. */
const CELL = 25;

export class Cars {
  /** @param {object} world the streamed city */
  constructor(world) {
    this.world = world;
    this.list = [];
    this.grid = new Map();          // cell key -> cars in it
    // District id -> the cars in it that are already wrecked, by index, so a
    // district that comes back comes back burnt.
    this.wrecked = new Map();
    this.onDestroyed = null;        // fn(car) for the blast, the fire and the noise
    this.onFlatten = null;          // fn(car) to rewrite the tiles it sits in
  }

  _key(x, z) {
    return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  }

  /** Every car a district brought with it. */
  add(district) {
    const list = (district.manifest && district.manifest.cars) || [];
    const dead = this.wrecked.get(district.id);
    for (let i = 0; i < list.length; i++) {
      const [x, z, a] = list[i];
      const car = {
        x, z, a, district: district.id, index: i,
        health: CAR_HEALTH, dead: !!(dead && dead.has(i)),
      };
      this.list.push(car);
      const key = this._key(x, z);
      let cell = this.grid.get(key);
      if (!cell) { cell = []; this.grid.set(key, cell); }
      cell.push(car);
      // A district that comes back comes back as you left it: the geometry is
      // fresh out of the file, so the wreck has to be put back into it.
      if (car.dead && this.onFlatten) this.onFlatten(car);
    }
    return list.length;
  }

  /** And let them go with it. What was wrecked is remembered. */
  drop(district) {
    const id = typeof district === 'string' ? district : district.id;
    const kept = [];
    for (const car of this.list) {
      if (car.district !== id) { kept.push(car); continue; }
      if (car.dead) {
        let set = this.wrecked.get(id);
        if (!set) { set = new Set(); this.wrecked.set(id, set); }
        set.add(car.index);
      }
    }
    this.list = kept;
    this.grid.clear();
    for (const car of this.list) {
      const key = this._key(car.x, car.z);
      let cell = this.grid.get(key);
      if (!cell) { cell = []; this.grid.set(key, cell); }
      cell.push(car);
    }
  }

  /**
   * The car at a point, if there is one still standing.
   *
   * @param {number} x @param {number} z
   * @param {number} reach metres, from the middle of the car
   * @returns {object|null}
   */
  at(x, z, reach = REACH) {
    let best = null, bestD = reach * reach;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cell = this.grid.get(`${cx + dx},${cz + dz}`);
        if (!cell) continue;
        for (const car of cell) {
          if (car.dead) continue;
          const d = (car.x - x) * (car.x - x) + (car.z - z) * (car.z - z);
          if (d < bestD) { bestD = d; best = car; }
        }
      }
    }
    return best;
  }

  /**
   * Shoot one.
   *
   * @returns {boolean} whether this is the hit that set it off
   */
  hurt(car, damage) {
    if (!car || car.dead) return false;
    car.health -= damage;
    if (car.health > 0) return false;
    return this.destroy(car);
  }

  /** Set one off without asking what it had left: a blast beside it. */
  destroy(car) {
    if (!car || car.dead) return false;
    car.dead = true;
    car.health = 0;
    if (this.onFlatten) this.onFlatten(car);
    if (this.onDestroyed) this.onDestroyed(car);
    return true;
  }

  /** Everything within a blast, for splash damage. */
  near(x, z, radius) {
    const out = [];
    const r = Math.ceil(radius / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cell = this.grid.get(`${cx + dx},${cz + dz}`);
        if (!cell) continue;
        for (const car of cell) {
          if (car.dead) continue;
          if (Math.hypot(car.x - x, car.z - z) <= radius) out.push(car);
        }
      }
    }
    return out;
  }

  /** A new game: every car back on its wheels. */
  reset() {
    for (const car of this.list) { car.dead = false; car.health = CAR_HEALTH; }
    this.wrecked.clear();
  }

  get alive() {
    let n = 0;
    for (const car of this.list) if (!car.dead) n++;
    return n;
  }
}
