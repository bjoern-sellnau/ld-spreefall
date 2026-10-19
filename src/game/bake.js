// Burning a finished collapse into the city for good.
//
// While a building is coming down it is a uniform: four numbers the vertex
// shader reads to bend the tile buffers it already has on the card. That is
// what makes a collapse free, and it is why there can only be sixteen of them
// at once. The old answer to the seventeenth blast was for the nearest site to
// swallow it, which meant that after sixteen explosions a rocket fired half a
// kilometre away quietly grew a crater somewhere else instead of making one
// where it landed, and nothing new ever came down.
//
// So a site that has finished falling is baked: the same arithmetic the shader
// does is run here, once, over the vertices of every tile the site touches,
// and the result is written back into the district's own bytes. The tile is
// then re-uploaded and the slot is free. The city keeps the damage, the
// seventeenth blast gets a slot of its own, and nothing is paid per frame for
// a ruin that has stopped moving.
//
// Everything in here is a transcription of the GLSL in src/shaders/world.js.
// The two have to agree, and the test in tools/test-city.mjs compares them
// number for number, because a baked building that does not match the one the
// shader drew a moment earlier is a building that jumps as it settles.

import { VERTEX_STRIDE, POS_SCALE, FACADE_FLAG, GROUND_SCALE } from '../shared/constants.js';
import { tileMesh } from '../engine/world.js';

const COLLAPSE_WAVE = 0.7;
// The furthest a falling vertex is thrown sideways, in metres of fall. What
// lands spreads by how far it fell, and for a block of flats that is right:
// a top storey sixteen metres up lands a couple of metres out. But the spread
// is per vertex and uncorrelated, so it also pulls every triangle apart by
// the difference between its corners, and for the Reichstag's dome, 47 m up,
// that was ten to twenty metres: a collapse that smeared the building into
// sheets the size of the building instead of putting it on the ground.
// Past this a thing has fallen far enough to be rubble, and more height does
// not throw it further. Mirrored in src/shaders/world.js.
const SCATTER_FALL = 10.0;
const CRATER_RIM = 0.18;
const CRATER_RIM_OUT = 1.75;

/** The hash the shader uses, so a wall breaks the same way twice. */
export function collapseHash(x, y, z) {
  const fx = Math.floor(x * 2), fy = Math.floor(y * 2), fz = Math.floor(z * 2);
  const d = fx * 12.9898 + fy * 78.233 + fz * 37.719;
  const v = Math.sin(d) * 43758.5453;
  return v - Math.floor(v);
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** One at the middle of a site, zero at its rim. */
export function collapseBite(x, z, site) {
  const d = Math.hypot(x - site.x, z - site.z);
  return 1 - smoothstep(site.radius * 0.30, site.radius, d);
}

/** The level a particular point has reached: the middle runs ahead. */
export function collapseLocal(level, bite) {
  return Math.min(1, Math.max(0, level * (1 + COLLAPSE_WAVE) - COLLAPSE_WAVE * (1 - bite))) * bite;
}

/** The bowl and its ring of thrown up ground. */
export function craterShape(x, z, site, level) {
  if (!(site.craterRadius > 0) || !(site.depth > 0)) return 0;
  const r = Math.hypot(x - site.x, z - site.z);
  const outer = site.craterRadius * CRATER_RIM_OUT;
  if (r >= outer) return 0;
  if (r < site.craterRadius) {
    const k = 1 - smoothstep(0, site.craterRadius, r);
    return -site.depth * k * k * level;
  }
  const t = (r - site.craterRadius) / (outer - site.craterRadius);
  return site.depth * CRATER_RIM * Math.sin(Math.PI * t) * level;
}

/**
 * Where one vertex ends up once a site has finished falling.
 *
 * @param {{x,y,z}} p the vertex in world metres, edited in place
 * @param {boolean} isGround whether it is a street rather than a wall
 * @param {number} height the building's own height, from the vertex attribute
 * @param {object} site the finished site
 * @returns {number} how far gone it is, 0 to 1, which decides whether it is
 *   marked as rubble
 */
export function settle(p, isGround, height, site) {
  const bite = collapseBite(p.x, p.z, site);
  if (bite <= 0) return 0;
  const level = collapseLocal(site.level, bite);
  if (level <= 0) return 0;
  // A site made while the buildings switch was off carries the crater and
  // nothing else: the hole is written into the street and every wall around
  // it is left exactly as it was.
  if (!isGround && site.walls === false) return 0;

  if (isGround) {
    p.y += craterShape(p.x, p.z, site, level);
    return 0;
  }

  const above = p.y - site.y;
  if (above <= 0.001) return 0;
  const full = Math.max(height, above);
  const cut = full * (1 - level);
  if (above <= cut) return 0;

  const jitter = collapseHash(p.x, p.y, p.z);
  const heap = site.rubble * (0.3 + jitter * 0.8) * bite;
  const landed = Math.min(above, cut + heap);
  const fell = above - landed;
  p.y -= fell;
  const spread = Math.min(fell, SCATTER_FALL);
  const ax = p.x - site.x, az = p.z - site.z;
  const l = Math.max(0.001, Math.hypot(ax, az));
  p.x += (ax / l) * spread * (0.09 + jitter * 0.13);
  p.z += (az / l) * spread * (0.09 + jitter * 0.13);
  p.x += (jitter - 0.5) * spread * 0.30;
  p.z += (collapseHash(p.z, p.y, p.x) - 0.5) * spread * 0.30;
  return Math.min(1, Math.max(0, fell / Math.max(1, above)));
}

const clampI16 = (v) => (v < -32768 ? -32768 : v > 32767 ? 32767 : v);

/**
 * Crushes whatever small thing stands at a point: a parked car that has gone
 * up, and the bench beside it if it was close enough.
 *
 * It is not flattened away to nothing. A car that has burnt out is still a
 * car shaped thing in the road, half the height it was and black, and that
 * reads from the far end of the street where a mark on the tarmac does not.
 *
 * Nothing in a vertex says car, so what this can go on is height and
 * position. Ground is left alone, so the road itself stays where it is, and
 * so is anything whose vertex is higher than `tall`, which is why a wall or a
 * lamp post standing beside the wreck keeps standing: a wall's own vertices
 * near the pavement are already at the pavement, and the ones that make it a
 * wall are above this.
 *
 * @param {object} world the streamed city
 * @param {number} x @param {number} z the middle of it
 * @param {number} radius metres
 * @param {number} tall metres above the ground, the tallest thing it takes
 * @param {number} squash what is left of its height, as a fraction
 * @returns {{tiles:number[], moved:number}} tiles to push to the card again
 */
export function bakeCrush(world, x, z, radius, tall = 2.2, squash = 0.42) {
  const tiles = [];
  let moved = 0;
  const base = world.groundHeight(x, z);
  const r2 = radius * radius;
  const tx0 = Math.max(0, Math.floor((x - radius - world.minX) / world.tileSize));
  const tx1 = Math.min(world.nx - 1, Math.floor((x + radius - world.minX) / world.tileSize));
  const tz0 = Math.max(0, Math.floor((z - radius - world.minZ) / world.tileSize));
  const tz1 = Math.min(world.nz - 1, Math.floor((z + radius - world.minZ) / world.tileSize));
  for (let tz = tz0; tz <= tz1; tz++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const index = tz * world.nx + tx;
      const rec = world.tiles[index];
      if (!rec) continue;
      const m = tileMesh(rec);
      if (!m.vCount) continue;
      const [ox, oz] = world.tileOrigin(index);
      const view = m.view;
      let touched = 0;
      for (let i = 0; i < m.vCount; i++) {
        const o = m.vOff + i * VERTEX_STRIDE;
        const px = view.getInt16(o, true) / POS_SCALE + ox;
        const pz = view.getInt16(o + 4, true) / POS_SCALE + oz;
        const dx = px - x, dz = pz - z;
        if (dx * dx + dz * dz > r2) continue;
        const flags = view.getUint8(o + 17);
        if ((flags & FACADE_FLAG.GROUND) !== 0) continue;
        const py = view.getInt16(o + 2, true) / POS_SCALE;
        if (py > base + tall || py < base - 1.0) continue;
        // Down onto its wheels and then some, keeping a few centimetres of
        // clearance so the shell and the road do not fight over which one is
        // in front.
        const was = Math.max(0, py - base);
        const now = base + 0.05 + was * squash;
        if (Math.abs(now - py) < 0.02) continue;
        view.setInt16(o + 2, clampI16(Math.round(now * POS_SCALE)), true);
        // The fragment shader reads this and treats it as rubble: burnt, dark
        // and matt, which is what is left of a car that has gone up.
        view.setUint8(o + 17, flags | FACADE_FLAG.RUBBLE);
        touched++;
      }
      if (touched) { tiles.push(index); moved += touched; }
    }
  }
  return { tiles, moved };
}

/**
 * Writes a finished site into the city.
 *
 * @param {object} world the streamed city
 * @param {object} site the site, at the level it finished at
 * @returns {{tiles:number[], moved:number}} which tiles changed, so the
 *   renderer can push them to the card again, and how many vertices moved
 */
export function bakeSite(world, site) {
  const r = site.radius * 1.1;
  const reach = Math.max(r, site.craterRadius * CRATER_RIM_OUT + 2);
  const tiles = [];
  let moved = 0;
  const tx0 = Math.max(0, Math.floor((site.x - reach - world.minX) / world.tileSize));
  const tx1 = Math.min(world.nx - 1, Math.floor((site.x + reach - world.minX) / world.tileSize));
  const tz0 = Math.max(0, Math.floor((site.z - reach - world.minZ) / world.tileSize));
  const tz1 = Math.min(world.nz - 1, Math.floor((site.z + reach - world.minZ) / world.tileSize));
  const p = { x: 0, y: 0, z: 0 };

  for (let tz = tz0; tz <= tz1; tz++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const index = tz * world.nx + tx;
      const rec = world.tiles[index];
      if (!rec) continue;
      const m = tileMesh(rec);
      if (!m.vCount) continue;
      const [ox, oz] = world.tileOrigin(index);
      const view = m.view;
      let touched = 0;
      for (let i = 0; i < m.vCount; i++) {
        const o = m.vOff + i * VERTEX_STRIDE;
        p.x = view.getInt16(o, true) / POS_SCALE + ox;
        p.y = view.getInt16(o + 2, true) / POS_SCALE;
        p.z = view.getInt16(o + 4, true) / POS_SCALE + oz;
        const flags = view.getUint8(o + 17);
        const isGround = (flags & FACADE_FLAG.GROUND) !== 0;
        const height = view.getUint16(o + 18, true) / 16;
        const startY = p.y;
        const fall = settle(p, isGround, height, site);
        if (fall <= 0 && p.y === startY) continue;
        view.setInt16(o, clampI16(Math.round((p.x - ox) * POS_SCALE)), true);
        view.setInt16(o + 2, clampI16(Math.round(p.y * POS_SCALE)), true);
        view.setInt16(o + 4, clampI16(Math.round((p.z - oz) * POS_SCALE)), true);
        if (fall > 0.02) {
          // Rubble, permanently. The fragment shader reads this bit and does
          // to it exactly what it does to a wall that is falling right now.
          view.setUint8(o + 17, flags | FACADE_FLAG.RUBBLE);
          // Flat, because a facade lying down does not light like a facade.
          const ny = view.getInt8(o + 7);
          view.setInt8(o + 7, Math.max(ny, Math.round(127 * (0.3 + 0.7 * fall))));
        }
        touched++;
      }
      if (touched) {
        tiles.push(index);
        moved += touched;
        // The tile's own box has to grow with what moved, or a flattened
        // block is culled away while its rubble is still on screen.
        m.min[1] = Math.min(m.min[1], -site.depth - 2);
      }
    }
  }
  return { tiles, moved };
}
