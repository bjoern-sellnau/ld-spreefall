// The flamethrower's second trigger: a wall of fire that leaves you and runs
// away across the ground.
//
// It is a line, not a cloud. A wall is born across your line of sight, a few
// metres in front of you, and travels forward at a jogging pace, following the
// ground as it goes: up a kerb, down into a crater, across a square. Anything
// it passes over burns while it is inside it, and it sets light to the trees
// and the ground behind it, so the street it has crossed goes on burning after
// the wall itself has run out.
//
// The wall is not drawn as geometry. It emits flame particles along its length
// every few hundredths of a second, which is the same way every other fire in
// this game is drawn, and it means a wall costs nothing on the card.

export class FireWalls {
  /**
   * @param {object} world for the ground under the wall
   * @param {(x,y,z)=>boolean} isSanctuary the memorial, which fire does not
   *   cross any more than anything else does
   */
  constructor(world, isSanctuary) {
    this.world = world;
    this.isSanctuary = isSanctuary || (() => false);
    this.walls = [];
    this.onFlame = null;      // fn(x, y, z, height, strength) along the line
    this.onBurn = null;       // fn(x, y, z, radius, dt) for whatever is in it
    this.onIgnite = null;     // fn(x, y, z, radius) for the ground behind it
    this.enabled = true;
  }

  get count() { return this.walls.length; }

  reset() { this.walls.length = 0; }

  /**
   * Throws one.
   *
   * @param {{x,y,z}} from where you are standing
   * @param {{x,z}} dir which way you are looking, flattened
   * @param {object} spec the weapon's wall numbers
   * @returns {object|null} the wall, or null when it would start in the
   *   memorial, which is the one place nothing burns
   */
  throw_(from, dir, spec) {
    if (!this.enabled) return null;
    const len = Math.hypot(dir.x, dir.z) || 1;
    const fx = dir.x / len, fz = dir.z / len;
    const x = from.x + fx * 4;
    const z = from.z + fz * 4;
    if (this.isSanctuary(x, from.y, z)) return null;
    const wall = {
      x, z,
      fx, fz,
      width: spec.width,
      speed: spec.speed,
      life: spec.life,
      travelled: 0,
      reach: spec.reach,
      damagePerSecond: spec.damagePerSecond,
      burnPerSecond: spec.burnPerSecond,
      ignite: spec.ignite,
      // The last place it set light to something, so a wall leaves a line of
      // fires behind it rather than one fire every frame.
      litAt: -1,
      flameAt: 0,
    };
    this.walls.push(wall);
    return wall;
  }

  update(dt) {
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i];
      w.life -= dt;
      const step = w.speed * dt;
      w.x += w.fx * step;
      w.z += w.fz * step;
      w.travelled += step;
      if (w.life <= 0 || w.travelled > w.reach) { this.walls.splice(i, 1); continue; }

      // It burns a corridor rather than a point: every half width along the
      // line is asked separately, so a wall eleven metres across really does
      // catch everything standing in those eleven metres.
      const half = w.width / 2;
      const px = -w.fz, pz = w.fx;
      const steps = Math.max(2, Math.round(w.width / 3));
      for (let k = 0; k <= steps; k++) {
        const t = -half + (w.width * k) / steps;
        const x = w.x + px * t;
        const z = w.z + pz * t;
        if (this.isSanctuary(x, 0, z)) continue;
        const y = this.world.groundHeight(x, z);
        if (this.onBurn) this.onBurn(x, y, z, 2.6, dt);
        if (this.onFlame) {
          w.flameAt -= dt / (steps + 1);
          if (w.flameAt <= 0) {
            w.flameAt = 0.06;
            this.onFlame(x, y, z, 3.4, 0.85);
          }
        }
      }

      // And what it leaves behind: a fire every few metres of travel, which is
      // what makes the street go on burning once the wall has gone past.
      if (this.onIgnite && w.travelled - w.litAt > w.ignite) {
        w.litAt = w.travelled;
        const y = this.world.groundHeight(w.x, w.z);
        if (!this.isSanctuary(w.x, y, w.z)) this.onIgnite(w.x, y, w.z, w.width * 0.7);
      }
    }
  }

  /** Every wall, for anything that wants to look at them. */
  get active() { return this.walls; }
}
