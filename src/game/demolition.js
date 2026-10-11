// Buildings that come down and ground that craters.
//
// The city is baked into per tile vertex buffers at build time, so nothing
// here rebuilds geometry. What it does instead is keep a short list of
// collapse sites, and the world vertex shader bends the city around them: a
// site pulls everything above the street down towards it and pushes it
// outward, which is a building folding in, and it pulls the street itself
// into a bowl, which is a crater. The same profile is applied to the
// collision in JavaScript, so what you can walk through matches what you can
// see.
//
// Damage accumulates on a grid rather than firing on the first grenade. A
// rocket into a wall marks it; the fourth one brings that part of the
// building down. A warhead skips the grid and takes its whole radius at once,
// because a hundred and seventy metres is not a wall, it is a district.

import { COLLISION_GRID, GROUND_SCALE } from '../shared/constants.js';

export const DEMO = {
  // The grid damage accumulates on, in metres. About the width of one Berlin
  // apartment block frontage, which is the unit that should come down.
  cell: 22,
  // How much damage a cell takes before it goes. A rocket does 150 at the
  // centre, so three or four of them into the same frontage.
  threshold: 430,
  // Anything with a radius at least this big does not bother with the grid.
  bigBlast: 60,
  // How long a site takes to finish falling.
  fallTime: 1.7,
  // The collision opens up partway through the fall rather than at the end,
  // so you are not stopped by a wall that is visibly no longer there.
  openAt: 0.45,
  // How high the heap left behind is, as a share of the site radius, and the
  // most it can ever be.
  rubble: 0.11,
  maxRubble: 4.5,
  // How deep the bowl is, likewise. Only blasts over bigBlast crater at all:
  // the ground mesh is a 12.5 m grid, so a crater smaller than about thirty
  // metres across has no vertices to move and would be a hole in the
  // collision with nothing to show for it.
  crater: 0.055,
  maxCrater: 9,
  craterFrom: 55,
  // The shader carries this many at once. A new site that overlaps an old one
  // grows it instead of taking a slot, and when they are all taken the
  // nearest one grows, so nothing ever springs back up.
  maxSites: 16,
};

/** How far into a site a point is: one at the middle, zero at the rim. */
export function bite(x, z, site) {
  const d = Math.hypot(x - site.x, z - site.z);
  const a = site.radius * 0.30, b = site.radius;
  if (d >= b) return 0;
  if (d <= a) return 1;
  const t = (d - a) / (b - a);
  // The same smoothstep the shader uses, written out so the two cannot drift.
  return 1 - t * t * (3 - 2 * t);
}

export class Demolition {
  /**
   * @param {object} world the collision world, which this edits in place
   * @param {(x,y,z)=>boolean} isSanctuary nothing comes down in the memorial
   */
  constructor(world, isSanctuary) {
    this.world = world;
    this.isSanctuary = isSanctuary || (() => false);
    this.sites = [];
    this.damage = new Map();
    this.onCollapse = null;      // fn(site) for the rubble and the dust
    this.enabled = true;
  }

  reset() {
    this.sites.length = 0;
    this.damage.clear();
    // The collision was edited in place, so the only way back is to drop the
    // caches and let them be read from the bundle again.
    this.world.collisionCache.clear();
    this.world.heightCache.clear();
  }

  _key(ix, iz) { return `${ix},${iz}`; }

  /**
   * A blast. Adds damage where it landed and brings down whatever that was
   * enough for.
   *
   * @returns {Array} the sites that came down because of this one
   */
  blast(x, y, z, radius, damage) {
    if (!this.enabled) return [];
    const made = [];
    if (radius >= DEMO.bigBlast) {
      const site = this._open(x, z, radius * 0.86, radius >= DEMO.craterFrom);
      if (site) made.push(site);
      return made;
    }
    // Spread the damage over the cells the blast touches, falling off with
    // distance the same way the damage to a person does.
    const c = DEMO.cell;
    const i0 = Math.floor((x - radius) / c), i1 = Math.floor((x + radius) / c);
    const j0 = Math.floor((z - radius) / c), j1 = Math.floor((z + radius) / c);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * c, cz = (j + 0.5) * c;
        const d = Math.hypot(cx - x, cz - z);
        if (d > radius + c * 0.5) continue;
        const share = damage * Math.max(0, 1 - d / (radius + c * 0.5));
        const key = this._key(i, j);
        const total = (this.damage.get(key) || 0) + share;
        if (total < DEMO.threshold) { this.damage.set(key, total); continue; }
        this.damage.set(key, 0);
        const site = this._open(cx, cz, c * 0.78, false);
        if (site) made.push(site);
      }
    }
    return made;
  }

  /**
   * Opens a collapse, or grows one that is already there.
   * @returns {object|null} the site, or null if nothing happened
   */
  _open(x, z, radius, crater) {
    if (this.isSanctuary(x, 0, z)) return null;
    const y = this.world.groundHeight(x, z);

    // Already inside something that came down: grow it rather than stacking a
    // second site on the same rubble.
    for (const site of this.sites) {
      const d = Math.hypot(site.x - x, site.z - z);
      if (d > Math.max(site.radius, radius) * 0.8) continue;
      const grown = Math.max(site.radius, d + radius);
      if (grown <= site.radius + 0.5 && (!crater || site.crater)) return null;
      site.radius = grown;
      site.crater = site.crater || crater;
      site.rubble = Math.min(DEMO.maxRubble, site.radius * DEMO.rubble);
      site.depth = site.crater
        ? Math.min(DEMO.maxCrater, site.radius * DEMO.crater) : 0;
      site.opened = false;
      site.progress = Math.min(site.progress, 0.85);
      if (this.onCollapse) this.onCollapse(site);
      return site;
    }

    const site = {
      x, y, z, radius,
      crater: !!crater,
      rubble: Math.min(DEMO.maxRubble, radius * DEMO.rubble),
      depth: crater ? Math.min(DEMO.maxCrater, radius * DEMO.crater) : 0,
      progress: 0,
      opened: false,
    };

    if (this.sites.length < DEMO.maxSites) {
      this.sites.push(site);
    } else {
      // All the slots are taken. Rather than evict one, which would stand a
      // flattened building back up, the nearest site swallows this one.
      let best = this.sites[0];
      let bestD = Infinity;
      for (const s of this.sites) {
        const d = Math.hypot(s.x - x, s.z - z);
        if (d < bestD) { bestD = d; best = s; }
      }
      best.radius = Math.max(best.radius, bestD + radius);
      best.crater = best.crater || !!crater;
      best.rubble = Math.min(DEMO.maxRubble, best.radius * DEMO.rubble);
      best.depth = best.crater
        ? Math.min(DEMO.maxCrater, best.radius * DEMO.crater) : 0;
      best.opened = false;
      best.progress = Math.min(best.progress, 0.85);
      if (this.onCollapse) this.onCollapse(best);
      return best;
    }

    if (this.onCollapse) this.onCollapse(site);
    return site;
  }

  update(dt) {
    for (const site of this.sites) {
      if (site.progress >= 1) continue;
      site.progress = Math.min(1, site.progress + dt / DEMO.fallTime);
      if (!site.opened && site.progress >= DEMO.openAt) {
        site.opened = true;
        this.release(site);
      }
    }
  }

  /**
   * Makes the collision agree with what came down: the walls inside the site
   * drop to the height of the heap, and the ground drops into the bowl.
   */
  release(site) {
    this.lowerWalls(site);
    if (site.crater && site.depth > 0) this.digCrater(site);
  }

  /** Every wall inside the site stops being a wall above the rubble. */
  lowerWalls(site) {
    const w = this.world;
    const r = site.radius;
    let touched = 0;
    w.forEachSegmentTile(site.x - r, site.z - r, site.x + r, site.z + r, (segs, count) => {
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        const mx = (segs[o] + segs[o + 2]) * 0.5;
        const mz = (segs[o + 1] + segs[o + 3]) * 0.5;
        const k = bite(mx, mz, site);
        if (k <= 0) continue;
        // What is left is the heap, and only where the fall was total. At the
        // rim a wall is still most of a wall.
        const keep = segs[o + 4] + site.rubble + (1 - k) * 14;
        if (segs[o + 5] > keep) { segs[o + 5] = keep; touched++; }
      }
    });
    return touched;
  }

  /**
   * Digs the bowl into the collision height field, using the same profile the
   * vertex shader uses on the drawn ground. Editing the cached field is
   * enough: every query in the game goes through it.
   */
  digCrater(site) {
    const w = this.world;
    const r = site.radius;
    const step = w.tileSize / (COLLISION_GRID - 1);
    const tx0 = Math.max(0, Math.floor((site.x - r - w.minX) / w.tileSize));
    const tx1 = Math.min(w.nx - 1, Math.floor((site.x + r - w.minX) / w.tileSize));
    const tz0 = Math.max(0, Math.floor((site.z - r - w.minZ) / w.tileSize));
    const tz1 = Math.min(w.nz - 1, Math.floor((site.z + r - w.minZ) / w.tileSize));
    let moved = 0;
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const index = tz * w.nx + tx;
        const hf = w.heightField(index);
        if (!hf) continue;
        const [ox, oz] = w.tileOrigin(index);
        for (let j = 0; j < COLLISION_GRID; j++) {
          for (let i = 0; i < COLLISION_GRID; i++) {
            const px = ox + i * step, pz = oz + j * step;
            const k = bite(px, pz, site);
            if (k <= 0) continue;
            const drop = site.depth * k * k;
            const at = j * COLLISION_GRID + i;
            hf[at] -= Math.round(drop * GROUND_SCALE);
            moved++;
          }
        }
      }
    }
    return moved;
  }

  /** What the renderer needs: the live sites, newest last. */
  get count() { return this.sites.length; }
}
