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
import { bakeSite } from './bake.js';
import { segmentDistance } from '../engine/world.js';

export const DEMO = {
  // How long a finished site holds its uniform slot before it is written into
  // the city for good. Long enough for the dust to settle, so that the shader
  // and the baked bytes are showing the same thing at the moment they swap.
  settle: 1.6,
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

  // Craters.
  //
  // This used to start at 55 m of blast, because the ground mesh is a 12.5 m
  // grid and a hole eight metres across had no vertices inside it to move:
  // the picture stayed flat while the collision dipped, which is an invisible
  // trap. The ground is now cut finer where a blast lands, so the floor is
  // what the collision field can actually follow rather than what the mesh
  // can draw, and a rocket digs a hole.
  //
  // The radius is a fraction of the blast with a floor under it, because a
  // crater narrower than two ground samples is a dimple nothing can stand in.
  // The depth is a fraction of the radius, capped by what the collision can
  // follow: a bowl sampled every `step` metres is out by about
  // depth * (step / radius) squared at its worst, and a quarter of a metre is
  // under the height of a kerb.
  craterFrom: 7,
  craterOfBlast: 0.21,
  minCraterRadius: 4.5,
  maxCraterRadius: 38,
  craterDepth: 0.38,
  maxCraterDepth: 11,
  craterSlack: 0.30,
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

/** The eight numbers that say what a finished ruin looks like. */
export function scarOf(site) {
  return {
    x: site.x, y: site.y, z: site.z,
    radius: site.radius,
    level: site.level,
    walls: site.walls !== false,
    craterRadius: site.craterRadius,
    depth: site.depth,
    rubble: site.rubble,
  };
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
    // fn(site) the first time a site gains a crater, so the ground under it
    // can be cut finer before anything is displaced.
    this.onCrater = null;
    // fn(tileIndices) when a ruin has been written into the tile buffers and
    // the card needs the new bytes.
    this.onBaked = null;
    // fn(scar) when a ruin is finished, so that whoever owns the city can
    // write it down and put it back after the district has been unloaded.
    this.onScar = null;
    this.baked = 0;              // how many sites have been made permanent
    this.enabled = true;
    // The two destruction switches from the cheat menu. Both on is the game
    // as it ships. They are separate because they are separate in the
    // picture as well: a warhead that digs a crater in a square with every
    // frontage round it still standing is a thing somebody might want, and
    // so is a street that caves in while the buildings hold.
    this.buildings = true;
    this.ground = true;
  }

  reset() {
    this.sites.length = 0;
    this.baked = 0;
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
  blast(x, y, z, radius, damage, crater = true) {
    if (!this.enabled) return [];
    // With both switches off the blast is still a blast, with the fire and
    // the noise and the dead; it simply leaves the city as it found it.
    if (!this.buildings && !this.ground) return [];
    const made = [];
    if (radius >= DEMO.bigBlast) {
      // A warhead takes the whole circle at once, and digs a hole a fraction
      // of it across in the middle.
      const site = this._open(x, z, radius * 0.86, 1, crater ? radius : 0);
      if (site) made.push(site);
      return made;
    }
    // A hole in the road where it landed, whatever it did to the buildings.
    // This is a site of its own rather than a property of a collapse, because
    // a rocket into an empty street damages no frontage and so opened no site
    // at all, and the street is exactly where you want the hole. It carries
    // the crater and nothing else: every wall around it is left standing.
    if (crater && this.ground && radius >= DEMO.craterFrom) {
      const dig = Math.min(DEMO.maxCraterRadius,
        Math.max(DEMO.minCraterRadius, radius * DEMO.craterOfBlast));
      const dug = this._open(x, z, Math.max(radius * 0.86, dig * 2.6), 1, radius,
        { walls: false, quiet: true, craterOnly: true });
      if (dug) made.push(dug);
    }
    // Everything smaller than a warhead only ever cuts walls, so with the
    // buildings switch off there is nothing left for it to do.
    if (!this.buildings) return made;
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
  _open(x, z, radius, level, blastRadius, opts = {}) {
    if (this.isSanctuary(x, 0, z)) return null;
    const y = this.world.groundHeight(x, z);
    const crater = this.ground && blastRadius >= DEMO.craterFrom
      ? Math.min(DEMO.maxCraterRadius,
        Math.max(DEMO.minCraterRadius, blastRadius * DEMO.craterOfBlast)) : 0;

    for (const site of this.sites) {
      // A hole in the road and a frontage coming down are not the same event
      // and must not merge into each other. The crater site carries level one
      // from the moment it opens, so a collapse that merged with it jumped
      // straight to a flattened block instead of going in quarters.
      if (!site.craterOnly !== !opts.craterOnly) continue;
      const d = Math.hypot(site.x - x, site.z - z);
      if (d > Math.max(site.radius, radius) * 0.8) continue;
      const grown = Math.max(site.radius, d + radius);
      const raised = Math.max(site.level, level);
      if (grown <= site.radius + 0.5 && raised <= site.level && crater <= site.craterRadius) {
        return null;
      }
      site.radius = grown;
      return this._raise(site, raised, crater, opts);
    }

    const site = {
      x, y, z, radius,
      // Whether this one takes the walls with it. Read by the shader, by the
      // collision and by the baker, so all three agree about a site opened
      // while the buildings switch was off.
      walls: opts.walls === false ? false : this.buildings,
      // A site that is only a hole in the ground, kept apart from the ones
      // that take buildings with them.
      craterOnly: !!opts.craterOnly,
      level: 0,
      shown: 0,
      from: 0,
      craterRadius: 0,
      depth: 0,
      rubble: Math.min(DEMO.maxRubble, radius * DEMO.rubble),
      opened: false,
      // How much of the crater is in the collision field, and the shape it
      // went in with. The picture deepens the hole over the collapse; this is
      // what keeps the ground you stand on level with the ground you see.
      dugLevel: 0,
      dugShape: null,
    };

    if (this.sites.length < DEMO.maxSites) {
      this.sites.push(site);
      return this._raise(site, level, crater, opts);
    }

    // All the slots are taken. The furthest finished site is written into the
    // city and gives up its slot, so this blast gets one of its own.
    //
    // This used to be a swallow: the nearest site grew until it covered the
    // new blast as well, which meant that after sixteen explosions a rocket
    // fired across town flattened a strip between here and there and left
    // nothing where it actually landed. Baking is what makes destruction
    // work everywhere and keep working.
    let worst = null, worstD = -1;
    for (const s of this.sites) {
      if (s.shown < s.level) continue;        // still falling, leave it alone
      const d = Math.hypot(s.x - x, s.z - z);
      if (d > worstD) { worstD = d; worst = s; }
    }
    if (worst) {
      this.bake(worst);
      this.sites.push(site);
      return this._raise(site, level, crater);
    }
    // Sixteen sites all still falling at once, which takes a warhead on top
    // of a firefight. The nearest one takes it rather than losing the blast.
    let near = this.sites[0];
    let nearD = Infinity;
    for (const s of this.sites) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < nearD) { nearD = d; near = s; }
    }
    near.radius = Math.max(near.radius, nearD + radius);
    return this._raise(near, Math.max(near.level, level), crater, opts);
  }

  /** Puts a site up to a new level and starts that stage playing. */
  _raise(site, level, crater, opts = {}) {
    const was = site.level;
    site.from = site.shown;
    site.level = level;
    site.rubble = Math.min(DEMO.maxRubble, site.radius * DEMO.rubble);
    site.opened = false;
    if (crater > site.craterRadius) {
      site.craterRadius = crater;
      // As deep as the shape says, or as deep as the ground underneath can be
      // made to agree with, whichever is less.
      const step = this.world.groundStep(site.x, site.z);
      const follows = DEMO.craterSlack * (crater / step) * (crater / step);
      site.depth = Math.min(DEMO.maxCraterDepth, crater * DEMO.craterDepth, follows);
      // The ground here is a quad grid, and a hole wants vertices inside it.
      // The layer above cuts the ground finer before anything is moved, which
      // is what lets a crater be smaller than one of those quads.
      if (this.onCrater) this.onCrater(site);
    }
    site.fall = DEMO.fallTime + site.radius * DEMO.fallPerMetre;
    site.t = 0;
    // A hole in the road has no storey coming away and no dust at roof
    // height, so it does not announce itself as a collapse.
    if (this.onStage && !opts.quiet) this.onStage(site, level, was);
    return site;
  }

  update(dt) {
    for (let i = this.sites.length - 1; i >= 0; i--) {
      const site = this.sites[i];
      if (site.shown < site.level) {
        site.t += dt;
        const k = Math.min(1, site.t / site.fall);
        site.shown = site.from + (site.level - site.from) * (k * k * (3 - 2 * k));
        // The hole goes into the collision field as it goes into the picture,
        // a little each step, rather than all at once when the dust settles.
        // Before this, the drawn ground sank for a second while the ground
        // underfoot stayed where it was, and then the whole six metres
        // arrived in one frame and left you standing in the air.
        if (site.craterRadius > 0) this.sinkCrater(site);
        if (!site.opened && k >= DEMO.openAt) {
          site.opened = true;
          this.release(site);
        }
        continue;
      }
      // It has finished falling. After a moment to settle it is written into
      // the city's own bytes and gives its slot back, which is what lets the
      // next sixteen explosions happen somewhere else entirely.
      site.rest = (site.rest || 0) + dt;
      if (site.rest >= DEMO.settle) this.bake(site);
    }
  }

  /**
   * Writes a finished site into the tile buffers and drops it.
   *
   * The ruin stays exactly as it was: same cut, same heap, same crater, drawn
   * from the buffers instead of from a uniform. Nothing is restored, which is
   * the whole point. Only a reload brings the city back.
   */
  bake(site) {
    const at = this.sites.indexOf(site);
    if (at < 0) return false;
    this.release(site);
    const { tiles } = bakeSite(this.world, site);
    this.sites.splice(at, 1);
    this.baked++;
    // What was done here, in eight numbers, for whoever wants to do it again:
    // the district this ruin is in keeps the record, and replays it when it
    // is loaded back, so a street you flattened is still flat when you walk
    // into it from the other side of Berlin.
    if (this.onScar) this.onScar(scarOf(site));
    if (tiles.length && this.onBaked) this.onBaked(tiles);
    return true;
  }

  /**
   * Puts a recorded ruin back, with no animation and no uniform slot: the
   * walls are cut, the crater is dug and the whole thing is written into the
   * tile buffers in one go, exactly as the live one ended up.
   *
   * @param {object} rec what `scarOf` wrote down
   * @returns {number[]} the tiles that changed
   */
  replay(rec) {
    const site = {
      x: rec.x, y: rec.y, z: rec.z,
      radius: rec.radius,
      level: rec.level, shown: rec.level, from: rec.level,
      walls: rec.walls !== false,
      craterRadius: rec.craterRadius, depth: rec.depth,
      rubble: rec.rubble,
      opened: true, dugLevel: 0, dugShape: null,
      fall: DEMO.fallTime, t: DEMO.fallTime,
    };
    this.lowerWalls(site);
    this.sinkCrater(site);
    // A hole replayed into a district that has just been fetched goes into
    // fresh bytes from the file, so the ground under it has to be cut finer
    // again before it is dug. Without this a crater you came back to was the
    // old coarse dish, and the picture and the collision parted company.
    if (site.craterRadius > 0 && this.onCrater) this.onCrater(site);
    const { tiles } = bakeSite(this.world, site);
    this.baked++;
    return tiles;
  }

  /** Everything that is still standing, baked where it stands. */
  bakeAll() {
    for (const site of [...this.sites]) this.bake(site);
  }

  /**
   * Makes the collision agree with what came down: the walls inside the site
   * are cut back to the level it has reached, and the crater is dug.
   */
  release(site) {
    this.lowerWalls(site);
    this.sinkCrater(site);
  }

  /**
   * Every wall inside the site is cut back to the share of its own height
   * that is left, measured from what it was before any of this started. A
   * stage that takes a quarter off leaves three quarters of a wall.
   *
   * @returns {number} how many segments moved
   */
  lowerWalls(site) {
    if (site.walls === false) return 0;
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
   * Opens a hole in whatever walls are at a point, in the collision.
   *
   * The picture already has one: the fragment shader cuts a hole out of the
   * facade where a shell went in. Until now nothing else knew about it, so
   * the wall you could see through was a wall you could not shoot through or
   * walk through. A segment runs between two points and stands between a base
   * and a top, which is exactly enough to say "wall, then nothing, then wall
   * again above it": the piece across the hole becomes a sill under it and a
   * lintel over it, and the piece either side of the hole is left whole.
   *
   * @param {number} x @param {number} y @param {number} z the middle of it
   * @param {number} radius metres
   * @returns {number} how many segments were cut
   */
  punch(x, y, z, radius) {
    if (!this.enabled || !this.buildings) return 0;
    const w = this.world;
    const tiles = new Set();
    w.forEachSegmentTile(x - radius, z - radius, x + radius, z + radius,
      (segs, count, index) => { tiles.add(index); });
    let cut = 0;
    for (const index of tiles) {
      const segs = this.splitTile(index);
      const tops = this.original.get(index);
      const count = segs.length / 6;
      const out = [];
      const newTops = [];
      let here = 0;
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        const x1 = segs[o], z1 = segs[o + 1], x2 = segs[o + 2], z2 = segs[o + 3];
        const base = segs[o + 4], top = segs[o + 5];
        const keep = () => {
          out.push(x1, z1, x2, z2, base, top);
          newTops.push(tops[i]);
        };
        if (top <= base || y + radius <= base || y - radius >= top) { keep(); continue; }
        const ex = x2 - x1, ez = z2 - z1;
        const len = Math.hypot(ex, ez);
        if (len < 0.01) { keep(); continue; }
        // Where the hole sits along the wall, and how far it reaches.
        let t = ((x - x1) * ex + (z - z1) * ez) / (len * len);
        t = Math.max(0, Math.min(1, t));
        const px = x1 + ex * t, pz = z1 + ez * t;
        const d = Math.hypot(px - x, pz - z);
        if (d >= radius) { keep(); continue; }
        // A sphere cut through a flat wall is a circle: this is its radius.
        const half = Math.sqrt(radius * radius - d * d);
        const a0 = Math.max(0, (t * len - half) / len);
        const a1 = Math.min(1, (t * len + half) / len);
        if (a1 - a0 <= 0.001) { keep(); continue; }
        const at = (k) => [x1 + ex * k, z1 + ez * k];
        if (a0 > 0.001) {
          const [bx, bz] = at(a0);
          out.push(x1, z1, bx, bz, base, top);
          newTops.push(tops[i]);
        }
        const [hx0, hz0] = at(a0);
        const [hx1, hz1] = at(a1);
        const sill = Math.max(base, y - half);
        const lintel = Math.min(top, y + half);
        if (sill > base + 0.05) {
          out.push(hx0, hz0, hx1, hz1, base, sill);
          newTops.push(Math.min(tops[i], sill));
        }
        if (lintel < top - 0.05) {
          out.push(hx0, hz0, hx1, hz1, lintel, top);
          newTops.push(tops[i]);
        }
        if (a1 < 0.999) {
          const [cx2, cz2] = at(a1);
          out.push(cx2, cz2, x2, z2, base, top);
          newTops.push(tops[i]);
        }
        here++;
      }
      cut += here;
      if (!here) continue;
      w.collisionCache.set(index, new Float32Array(out));
      this.original.set(index, new Float32Array(newTops));
    }
    return cut;
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
   * Brings the collision field up to date with how deep the hole is drawn.
   *
   * The work is done in differences rather than by rewriting the ground from
   * a copy of how it started, because two craters can overlap and the second
   * one must not undo the first. A profile scales linearly with its level, so
   * the difference between two levels is itself a profile.
   *
   * @returns {number} how many points of the field moved
   */
  sinkCrater(site) {
    if (!site.craterRadius || !site.depth) return 0;
    const shape = site.dugShape;
    if (shape && (shape.craterRadius !== site.craterRadius || shape.depth !== site.depth)) {
      // The hole grew. The old one comes out at the profile it went in with
      // before the new one goes in, so the field never keeps a shape that is
      // not the shape of the crater.
      if (site.dugLevel) this.applyCrater(shape, -site.dugLevel);
      site.dugShape = null;
      site.dugLevel = 0;
    }
    const want = Math.max(0, Math.min(1, site.shown));
    const delta = want - site.dugLevel;
    if (Math.abs(delta) < 0.002) return 0;
    const use = site.dugShape || {
      x: site.x, z: site.z, craterRadius: site.craterRadius, depth: site.depth,
    };
    const moved = this.applyCrater(use, delta);
    site.dugShape = use;
    site.dugLevel = want;
    return moved;
  }

  /**
   * Adds a share of a crater profile to the collision height field, with the
   * same shape the vertex shader uses on the drawn ground, lip and all.
   * Editing the cached field is enough: every query in the game goes through
   * it.
   *
   * @param {{x,z,craterRadius,depth}} shape the hole
   * @param {number} level how much of it to add, which may be negative
   */
  applyCrater(shape, level) {
    const w = this.world;
    const site = shape;
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
            const d = craterAt(px, pz, site, level);
            if (d === 0) continue;
            hf[j * grid + i] += Math.round(d * GROUND_SCALE);
            moved++;
          }
        }
      }
    }
    return moved;
  }

  /**
   * What a frontage has taken and what it has left, at a point on the map.
   * The damage is kept on a grid of cells about one Berlin block frontage
   * across, which is the unit that comes down, so this is the honest answer
   * to "how much more will that wall take": the cell the point is in.
   *
   * @returns {{taken:number,each:number,whole:number,stage:number,stages:number,left:number}}
   */
  damageAt(x, z) {
    const c = DEMO.cell;
    const key = this._key(Math.floor(x / c), Math.floor(z / c));
    const taken = this.damage.get(key) || 0;
    const whole = DEMO.stageDamage * DEMO.stages;
    const stage = Math.min(DEMO.stages, Math.floor(taken / DEMO.stageDamage));
    return {
      taken: Math.round(taken),
      each: DEMO.stageDamage,
      whole,
      stage,
      stages: DEMO.stages,
      left: Math.max(0, Math.round(whole - taken)),
    };
  }

  /** What the renderer needs: the live sites, newest last. */
  get count() { return this.sites.length; }
}
