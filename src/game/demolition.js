// Buildings that come apart and ground that craters.
//
// The city is baked into per tile vertex buffers at build time, so nothing
// here rebuilds geometry. What it does instead is keep a short list of
// collapse sites, and the world vertex shader bends the city around them. The
// same profiles are applied to the collision in JavaScript, so what you can
// walk through matches what you can see.
//
// Two things make this read as damage rather than as a switch being thrown.
//
// A building comes apart in stages. Each site carries a level from zero to
// one, and the shader cuts the building back to that share of its own height:
// at a quarter it is the top quarter that is missing, and the three storeys
// below it are still a building with windows in them. Damage accumulates on a
// grid and each step up is its own event, with its own rubble and its own
// sound, so you watch a frontage come down a piece at a time.
//
// And a crater is nothing like the size of the blast that made it. A warhead
// with a radius of a hundred and seventy metres knocks a district down and
// digs a hole a fraction of that across in the middle of it, with a ring of
// thrown up ground round the lip. The street outside that ring does not move,
// which is why a flattened block still has a street running past it.

import { COLLISION_GRID, GROUND_SCALE } from '../shared/constants.js';
import { segmentDistance } from '../engine/world.js';

export const DEMO = {
  // The grid damage accumulates on, in metres. About the width of one Berlin
  // apartment block frontage, which is the unit that should come down.
  cell: 22,
  // How far a building comes apart per step, and how much damage a step
  // costs. A rocket does about 150 at the centre, so the second one into the
  // same frontage takes the top quarter off and the sixth finishes it.
  stages: 4,
  stageDamage: 180,
  // How much of a cell a site covers, at the first step and at the last.
  cellBite: 0.34,
  cellGrow: 0.46,
  // Anything with a radius at least this big does not bother with the grid
  // and takes its whole circle at once.
  bigBlast: 60,
  // How long a stage takes to play out. A bigger site takes longer, because a
  // district folding in is not a wall falling over.
  fallTime: 1.3,
  fallPerMetre: 0.011,
  // The collision opens up partway through the fall rather than at the end,
  // so you are not stopped by a wall that is visibly no longer there.
  openAt: 0.45,
  // The heap left where something fell, as a share of the site radius.
  rubble: 0.11,
  maxRubble: 4.5,

  // Craters. Only a big blast digs one at all: the ground mesh is a 12.5 m
  // grid, so a hole eight metres across has no vertices inside it to move and
  // would be an invisible trap in the collision. The radius is a fraction of
  // the blast, which is the whole correction here, and the depth is a
  // fraction of that again.
  craterFrom: 55,
  craterOfBlast: 0.21,
  maxCraterRadius: 38,
  craterDepth: 0.38,
  maxCraterDepth: 11,
  // The ring of thrown up ground around the lip, matching the shader.
  rim: 0.18,
  rimOut: 1.75,

  // Collision walls are stored as one quad per building edge, and an edge
  // can be thirty metres long. One top per edge means a whole facade either
  // opens up or does not, whichever way its middle happened to fall, while
  // the picture shows the blast cutting across the middle of it. The first
  // time a collapse touches a tile, its long walls are cut into pieces so
  // each piece can lose its own height. It costs more segments in the tiles
  // you have blown up and nothing anywhere else.
  splitAt: 9,
  splitTo: 5,
  maxPieces: 10,

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

/**
 * What the ground does at a point: negative inside the crater, positive on
 * the ring around it, zero outside. The literal twin of craterAt in the world
 * shader; if these two drift you walk on air over a hole or fall through a
 * street that looks solid.
 *
 * @returns {number} metres, to be added to the ground height
 */
export function craterAt(x, z, site, level = 1) {
  if (!site.craterRadius || !site.depth) return 0;
  const r = Math.hypot(x - site.x, z - site.z);
  const outer = site.craterRadius * DEMO.rimOut;
  if (r >= outer) return 0;
  if (r < site.craterRadius) {
    const t = r / site.craterRadius;
    const k = 1 - (t * t * (3 - 2 * t));
    return -site.depth * k * k * level;
  }
  const t = (r - site.craterRadius) / (outer - site.craterRadius);
  return site.depth * DEMO.rim * Math.sin(Math.PI * t) * level;
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
    // What every wall in a touched tile was before any of this started, by
    // tile index. Levels only ever go up, but each stage recomputes the
    // height from the original, so the original has to survive the first
    // edit, and it has to survive the tile being cut into pieces too.
    this.original = new Map();
    this.onStage = null;         // fn(site, level, previousLevel)
    this.enabled = true;
  }

  reset() {
    this.sites.length = 0;
    this.damage.clear();
    this.original.clear();
    // The collision was edited in place, so the only way back is to drop the
    // caches and let them be read from the bundle again.
    this.world.collisionCache.clear();
    this.world.heightCache.clear();
  }

  _key(ix, iz) { return `${ix},${iz}`; }

  /**
   * A blast. Adds damage where it landed and takes whatever that was enough
   * for off the buildings in it.
   *
   * @returns {Array} the sites that moved because of this one
   */
  blast(x, y, z, radius, damage) {
    if (!this.enabled) return [];
    const made = [];
    if (radius >= DEMO.bigBlast) {
      // A warhead takes the whole circle at once, and digs a hole a fraction
      // of it across in the middle.
      const site = this._open(x, z, radius * 0.86, 1, radius);
      if (site) made.push(site);
      return made;
    }
    const c = DEMO.cell;
    const i0 = Math.floor((x - radius) / c), i1 = Math.floor((x + radius) / c);
    const j0 = Math.floor((z - radius) / c), j1 = Math.floor((z + radius) / c);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * c, cz = (j + 0.5) * c;
        // Distance to the cell rather than to the middle of it, so the cell
        // the blast landed in takes all of it however the grid happens to
        // line up. Measuring to the centre made the damage depend on where
        // the invisible grid was, which is not a thing anybody can aim at.
        const dx = Math.max(0, Math.abs(cx - x) - c * 0.5);
        const dz = Math.max(0, Math.abs(cz - z) - c * 0.5);
        const d = Math.hypot(dx, dz);
        if (d > radius) continue;
        const share = damage * Math.max(0, 1 - d / radius);
        const key = this._key(i, j);
        const was = this.damage.get(key) || 0;
        const now = was + share;
        this.damage.set(key, now);
        // One level per step of damage, so a frontage goes in quarters.
        const before = Math.min(DEMO.stages, Math.floor(was / DEMO.stageDamage));
        const after = Math.min(DEMO.stages, Math.floor(now / DEMO.stageDamage));
        if (after <= before) continue;
        const level = after / DEMO.stages;
        // The hole grows with the damage. A cell that has taken one step is
        // a dent in a frontage; one that has taken all four is the whole
        // frontage gone. Giving every stage the full cell radius meant a
        // single rocket, which touches up to four cells, reached forty five
        // metres and took a slice out of the buildings either side of what
        // it hit.
        const site = this._open(cx, cz, c * (DEMO.cellBite + DEMO.cellGrow * level),
          level, 0);
        if (site) made.push(site);
      }
    }
    return made;
  }

  /**
   * Opens a collapse, raises one that is already there, or merges into the
   * nearest when every slot is taken.
   *
   * @param {number} level 0 to 1, how far gone this makes it
   * @param {number} blastRadius the radius of the blast, for the crater; zero
   *   for anything too small to dig one
   * @returns {object|null} the site, or null if nothing changed
   */
  _open(x, z, radius, level, blastRadius) {
    if (this.isSanctuary(x, 0, z)) return null;
    const y = this.world.groundHeight(x, z);
    const crater = blastRadius >= DEMO.craterFrom
      ? Math.min(DEMO.maxCraterRadius, blastRadius * DEMO.craterOfBlast) : 0;

    for (const site of this.sites) {
      const d = Math.hypot(site.x - x, site.z - z);
      if (d > Math.max(site.radius, radius) * 0.8) continue;
      const grown = Math.max(site.radius, d + radius);
      const raised = Math.max(site.level, level);
      if (grown <= site.radius + 0.5 && raised <= site.level && crater <= site.craterRadius) {
        return null;
      }
      site.radius = grown;
      return this._raise(site, raised, crater);
    }

    const site = {
      x, y, z, radius,
      level: 0,
      shown: 0,
      from: 0,
      craterRadius: 0,
      depth: 0,
      rubble: Math.min(DEMO.maxRubble, radius * DEMO.rubble),
      opened: false,
      dug: false,
    };

    if (this.sites.length < DEMO.maxSites) {
      this.sites.push(site);
      return this._raise(site, level, crater);
    }

    // All the slots are taken. Rather than evict one, which would stand a
    // flattened building back up, the nearest site swallows this one.
    let best = this.sites[0];
    let bestD = Infinity;
    for (const s of this.sites) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) { bestD = d; best = s; }
    }
    best.radius = Math.max(best.radius, bestD + radius);
    return this._raise(best, Math.max(best.level, level), crater);
  }

  /** Puts a site up to a new level and starts that stage playing. */
  _raise(site, level, crater) {
    const was = site.level;
    site.from = site.shown;
    site.level = level;
    site.rubble = Math.min(DEMO.maxRubble, site.radius * DEMO.rubble);
    site.opened = false;
    if (crater > site.craterRadius) {
      site.craterRadius = crater;
      site.depth = Math.min(DEMO.maxCraterDepth, crater * DEMO.craterDepth);
      site.dug = false;
    }
    site.fall = DEMO.fallTime + site.radius * DEMO.fallPerMetre;
    site.t = 0;
    if (this.onStage) this.onStage(site, level, was);
    return site;
  }

  update(dt) {
    for (const site of this.sites) {
      if (site.shown >= site.level) continue;
      site.t += dt;
      const k = Math.min(1, site.t / site.fall);
      site.shown = site.from + (site.level - site.from) * (k * k * (3 - 2 * k));
      if (!site.opened && k >= DEMO.openAt) {
        site.opened = true;
        this.release(site);
      }
    }
  }

  /**
   * Makes the collision agree with what came down: the walls inside the site
   * are cut back to the level it has reached, and the crater is dug.
   */
  release(site) {
    this.lowerWalls(site);
    if (site.craterRadius > 0 && !site.dug) {
      site.dug = true;
      this.digCrater(site);
    }
  }

  /**
   * Every wall inside the site is cut back to the share of its own height
   * that is left, measured from what it was before any of this started. A
   * stage that takes a quarter off leaves three quarters of a wall.
   *
   * @returns {number} how many segments moved
   */
  lowerWalls(site) {
    const w = this.world;
    const r = site.radius;
    let touched = 0;
    const tiles = new Set();
    w.forEachSegmentTile(site.x - r, site.z - r, site.x + r, site.z + r,
      (segs, count, index) => { tiles.add(index); });
    for (const index of tiles) {
      const segs = this.splitTile(index);
      const tops = this.original.get(index);
      const count = segs.length / 6;
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        const mx = (segs[o] + segs[o + 2]) * 0.5;
        const mz = (segs[o + 1] + segs[o + 3]) * 0.5;
        const k = bite(mx, mz, site);
        if (k <= 0) continue;
        const base = segs[o + 4];
        // The same cut the shader makes, out of the same original height,
        // and the heap the rubble leaves on top of it.
        const full = Math.max(0, tops[i] - base);
        const local = Math.min(1, site.level * k);
        const cut = full * (1 - local) + (local > 0 ? site.rubble * k : 0);
        const top = base + Math.min(full, cut);
        if (top < segs[o + 5]) { segs[o + 5] = top; touched++; }
      }
    }
    return touched;
  }

  /**
   * Cuts a tile's long walls into pieces, once, and remembers what every
   * piece was before anything happened to it. Replacing the cached array is
   * enough: every collision query in the game reads it from there.
   *
   * @returns {Float32Array} the tile's segments, split
   */
  splitTile(index) {
    const have = this.original.get(index);
    const segs = this.world.segments(index);
    if (have) return segs;

    const out = [];
    const tops = [];
    const count = segs.length / 6;
    for (let i = 0; i < count; i++) {
      const o = i * 6;
      const x1 = segs[o], z1 = segs[o + 1], x2 = segs[o + 2], z2 = segs[o + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const pieces = len > DEMO.splitAt
        ? Math.min(DEMO.maxPieces, Math.ceil(len / DEMO.splitTo)) : 1;
      for (let p = 0; p < pieces; p++) {
        const a = p / pieces, b = (p + 1) / pieces;
        out.push(x1 + (x2 - x1) * a, z1 + (z2 - z1) * a,
          x1 + (x2 - x1) * b, z1 + (z2 - z1) * b,
          segs[o + 4], segs[o + 5]);
        tops.push(segs[o + 5]);
      }
    }
    const split = new Float32Array(out);
    this.world.collisionCache.set(index, split);
    this.original.set(index, new Float32Array(tops));
    return split;
  }

  /**
   * Digs the crater into the collision height field with the same profile the
   * vertex shader uses on the drawn ground, including the ring of thrown up
   * ground around the lip. Editing the cached field is enough: every query in
   * the game goes through it.
   */
  digCrater(site) {
    const w = this.world;
    const r = site.craterRadius * DEMO.rimOut;
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
        // How fine the field is depends on which district the tile is in, so
        // it is read off the field rather than assumed.
        const grid = hf.n || COLLISION_GRID;
        const step = w.tileSize / (grid - 1);
        const [ox, oz] = w.tileOrigin(index);
        for (let j = 0; j < grid; j++) {
          for (let i = 0; i < grid; i++) {
            const px = ox + i * step, pz = oz + j * step;
            const d = craterAt(px, pz, site);
            if (d === 0) continue;
            hf[j * grid + i] += Math.round(d * GROUND_SCALE);
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
