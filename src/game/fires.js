// Trees that catch, burn and then either burst or go over.
//
// A fire is a circle on the ground with an age. The tree shader runs every
// tree inside one through the same timeline off the tree's own seed, so no
// per tree state is stored or uploaded anywhere: three thousand seven hundred
// trees and the whole thing is eight vec4s.
//
// This file owns the half that cannot live in a shader. It finds which real
// trees are in a fire, so the flames and the smoke come off actual trunks
// rather than out of a circle on the ground, and it runs the same seed
// arithmetic the shader does so that the crack of a tree going over happens
// on the tree that is going over. The two sets of timings are written out
// twice and have to agree; that is the price of not uploading anything.

export const FIRE = {
  // How long a fire goes on setting light to things before it burns out.
  life: 26,
  // How many the shader can carry. A new fire that overlaps an old one grows
  // it rather than taking a slot.
  maxFires: 8,
  // How much of the fire's radius a tree has to be inside to catch at all.
  // The edge catches about two seconds after the middle, which is in both
  // this file and the shader.
  spread: 2.2,
  // Flames are emitted per burning tree on a timer rather than every frame,
  // so the look does not change with the frame rate.
  flameEvery: 0.14,
  // Trees further than this from you are still burning, they just do not get
  // particles, because nobody can see them.
  particleRange: 180,
  // How long a tree that has gone over lies there burning before it is struck
  // off the city. Counted in game time, not wall clock, so it behaves in slow
  // motion and while the game is paused.
  afterFall: 2.4,
};

/** The same hash the tree shaders use, so both sides pick the same numbers. */
export function hash11(p) {
  let x = (p * 0.1031) % 1;
  if (x < 0) x += 1;
  x = (x * (x + 33.33)) % 1;
  x = (x * (x + x)) % 1;
  return x;
}

/** When a tree with this seed gives up, in seconds after it catches. */
export function doomAt(seed) { return 3.2 + hash11(seed * 0.613 + 4.1) * 5.5; }
/** True when it bursts rather than toppling. */
export function burstsNot(seed) { return hash11(seed * 0.911 + 2.3) >= 0.62; }

export class Fires {
  /** @param {object} world for the tree lists per tile */
  constructor(world) {
    this.world = world;
    this.sites = [];
    this.onBurst = null;       // fn(tree) when one goes up
    this.onTopple = null;      // fn(tree) when one goes over
    this.onGone = null;        // fn(tree) when it is off the city for good
    this.onFlame = null;       // fn(tree, strength) every few frames
    this.enabled = true;
  }

  reset() { this.sites.length = 0; }

  get count() { return this.sites.length; }

  /** Every tree still alight, for anything that wants to look at them. */
  get burning() {
    const out = [];
    for (const site of this.sites) for (const t of site.trees) if (!t.gone) out.push(t);

    return out;
  }

  /**
   * Sets light to whatever is inside a circle.
   *
   * @param {number} radius how far the fire reaches
   * @param {number} strength 0 to 1, how hard it caught
   * @returns {object|null} the fire, or null when there was nothing to burn
   */
  ignite(x, y, z, radius, strength = 1) {
    if (!this.enabled) return null;
    // Grow a fire that is already here rather than stacking a second one on
    // the same trees.
    for (const site of this.sites) {
      if (Math.hypot(site.x - x, site.z - z) > Math.max(site.radius, radius) * 0.7) continue;
      const grown = Math.max(site.radius, Math.hypot(site.x - x, site.z - z) + radius);
      if (grown > site.radius) { site.radius = grown; site.trees = this.treesIn(site); }
      site.strength = Math.max(site.strength, strength);
      return site;
    }
    if (this.sites.length >= FIRE.maxFires) {
      // Oldest out. A fire that has been burning for twenty seconds has
      // already done what it is going to do.
      let worst = this.sites[0];
      for (const s of this.sites) if (s.age > worst.age) worst = s;
      this.sites.splice(this.sites.indexOf(worst), 1);
    }
    const site = { x, y, z, radius, strength, age: 0, trees: [] };
    site.trees = this.treesIn(site);
    if (!site.trees.length) return null;
    this.sites.push(site);
    return site;
  }

  /**
   * The real trees inside a fire, read out of the tile buffers. Each gets the
   * timings its seed gives it, computed here exactly as the shader computes
   * them from the same seed.
   */
  treesIn(site) {
    const w = this.world;
    const out = [];
    const r = site.radius;
    const tx0 = Math.max(0, Math.floor((site.x - r - w.minX) / w.tileSize));
    const tx1 = Math.min(w.nx - 1, Math.floor((site.x + r - w.minX) / w.tileSize));
    const tz0 = Math.max(0, Math.floor((site.z - r - w.minZ) / w.tileSize));
    const tz1 = Math.min(w.nz - 1, Math.floor((site.z + r - w.minZ) / w.tileSize));
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const data = w.trees(tz * w.nx + tx);
        if (!data) continue;
        for (let i = 0; i < data.length; i += 5) {
          const x = data[i], y = data[i + 1], z = data[i + 2];
          // A tree under the memorial's force field does not catch.
          if (w.shielded && w.shielded(x, z)) continue;
          const d = Math.hypot(x - site.x, z - site.z);
          if (d > r) continue;
          const seed = data[i + 4] % 128;
          out.push({
            x, y, z, height: data[i + 3], seed,
            // The edge of a fire catches later than the middle of it, by
            // exactly the amount the shader delays it by.
            caughtAt: (d / r) * FIRE.spread,
            doom: doomAt(seed),
            bursts: burstsNot(seed),
            gone: false,
            done: false,
            flameAt: Math.random() * FIRE.flameEvery,
          });
        }
      }
    }
    return out;
  }

  /**
   * @param {object} eye where the player is, so distant trees are not given
   *   particles nobody will see
   */
  update(dt, eye) {
    for (let i = this.sites.length - 1; i >= 0; i--) {
      const site = this.sites[i];
      site.age += dt;
      if (site.age > FIRE.life) { this.sites.splice(i, 1); continue; }
      for (const t of site.trees) {
        const age = site.age - t.caughtAt;
        if (age <= 0) continue;
        if (!t.done && age >= t.doom) {
          t.done = true;
          if (t.bursts) {
            t.gone = true;
            if (this.onBurst) this.onBurst(t);
            if (this.onGone) this.onGone(t);
          } else if (this.onTopple) this.onTopple(t);
        }
        // One that went over lies there burning and is then gone, for good.
        if (t.done && !t.bursts && !t.struck && age >= t.doom + FIRE.afterFall) {
          t.struck = true;
          if (this.onGone) this.onGone(t);
        }
        // A tree that burst is not there any more. One that went over is
        // still alight on the ground for a couple of seconds.
        if (t.gone || age > t.doom + 2.4 || !this.onFlame) continue;
        if (eye && Math.hypot(t.x - eye.x, t.z - eye.z) > FIRE.particleRange) continue;
        t.flameAt -= dt;
        if (t.flameAt > 0) continue;
        t.flameAt = FIRE.flameEvery;
        // Strongest in the middle of the burn and dying off at the end.
        const k = Math.min(1, age / 1.6) * (1 - Math.max(0, (age - t.doom + 2.5) / 2.5));
        this.onFlame(t, Math.max(0.15, k) * site.strength);
      }
    }
  }
}
