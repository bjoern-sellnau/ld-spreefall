// Giving a crater something to move.
//
// The ground is a quad grid at 12.5 m in the middle of town and coarser
// outside it, which is why nothing under 55 m of blast was allowed to dig at
// all: a hole eight metres across has no vertices inside it, so the picture
// would stay flat while the collision dipped, and you would walk into an
// invisible pit. Building the whole city finer is not the answer. Mitte's
// ground is already a third of its vertices, and at 4 m everywhere it would
// be about two million.
//
// So the ground is cut finer only where something has gone off, and only
// there. The triangles a blast reaches are split until their longest edge is
// short enough, each new vertex interpolated from the two it sits between, so
// the material, the surface, the texture coordinates and the normal all carry
// over exactly. The result is a buffer of the tile's own, which `tileMesh`
// hands to the uploader and to the baker in place of the file's bytes.
//
// Nothing here moves a vertex. Displacing them is the baker's job and the
// shader's, out of the same crater shape they already use; this only makes
// sure there is something there to displace.

import { VERTEX_STRIDE, POS_SCALE, FACADE_FLAG } from '../shared/constants.js';
import { tileMesh } from '../engine/world.js';

/** The coarsest a crater is cut. A small one asks for finer, see main.js. */
export const FINE_EDGE = 3.0;

/**
 * A ceiling on the splitting, so one blast cannot turn a tile into a million.
 * Each step halves the longest edge of one piece, so this many steps take a
 * ground quad of 200 m, which is what the outskirts are built from, down to
 * under a metre. Only the pieces over the hole are split, so it is the size
 * of the hole that sets the cost and not this number.
 */
const MAX_DEPTH = 18;

/**
 * Cuts the ground finer around a point, in every tile it reaches.
 *
 * The radius is deliberately generous: a triangle that is split meets one
 * that is not at the edge of the worked area, and that join is only seamless
 * where nothing is displaced. Ask for more than the crater will actually
 * touch and the join sits out on flat ground where it cannot show.
 *
 * @param {object} world the streamed city
 * @param {number} x @param {number} z the middle of it
 * @param {number} radius metres to cut finer
 * @param {number} edge the longest edge to leave, in metres
 * @returns {number[]} the tiles that changed, for the uploader
 */
export function fineGround(world, x, z, radius, edge = FINE_EDGE) {
  return overTiles(world, x, z, radius, (index) => reworkTile(world, index, {
    cx: x, cy: 0, cz: z, radius, edge, ground: true, drop: false,
  }));
}

/**
 * Takes a hole out of a wall, for good.
 *
 * The shader already punches one, out of the ring of sixteen most recent
 * blast marks, which is what you see the instant a shell goes in. That mark
 * is temporary and nothing but the picture knows about it: the collision and
 * the line of fire went on treating the wall as solid, so you could put a
 * rocket through a shopfront, see the inside of the building, and still not
 * be able to shoot or walk through what was visibly no longer there.
 *
 * This cuts the wall around the hole fine enough to follow its edge, then
 * drops every piece inside it. What is left is a wall with a hole in it, in
 * the buffers, which is the same thing the collision is told about.
 *
 * @returns {number[]} the tiles that changed
 */
export function holeInWall(world, x, y, z, radius) {
  return overTiles(world, x, z, radius, (index) => reworkTile(world, index, {
    cx: x, cy: y, cz: z, radius,
    // Four pieces across the hole, so its edge is not a straight line.
    edge: Math.max(0.35, radius / 4),
    ground: false, drop: true,
  }));
}

/**
 * Cuts the buildings in a collapse site into pieces a storey or so across.
 *
 * A wall in the bundle is one quad from the pavement to the eaves, and the
 * windows on it are drawn by the shader, so there is nothing in it to break:
 * the collapse could only pull its top corners down, and a frontage pulled
 * down by its corners is a ramp. Cut into pieces first, each column of it can
 * come down or stay up and each storey can land on the one below.
 *
 * @returns {number[]} the tiles that changed
 */
export function fineWalls(world, x, z, radius, edge = 3.5) {
  return overTiles(world, x, z, radius, (index) => reworkTile(world, index, {
    cx: x, cy: 0, cz: z, radius, edge, ground: false, drop: false, tall: true,
  }));
}

/** The width of a column, which src/shaders/world.js breaks a building by. */
export const COLUMN = 4;

/** A vertex part way from one to another, with everything carried over. */
function lerpVertex(verts, pos, a, b, t) {
  const va = verts[a], vb = verts[b];
  const v = new Uint8Array(VERTEX_STRIDE);
  const dv = new DataView(v.buffer);
  const da = new DataView(va.buffer, va.byteOffset, VERTEX_STRIDE);
  const db = new DataView(vb.buffer, vb.byteOffset, VERTEX_STRIDE);
  const mix = (x, y) => x + (y - x) * t;
  for (let k = 0; k < 3; k++) {
    dv.setInt16(k * 2, Math.round(mix(da.getInt16(k * 2, true), db.getInt16(k * 2, true))), true);
  }
  for (let k = 0; k < 4; k++) dv.setInt8(6 + k, Math.round(mix(da.getInt8(6 + k), db.getInt8(6 + k))));
  for (let k = 0; k < 2; k++) {
    dv.setUint16(10 + k * 2, Math.round(mix(da.getUint16(10 + k * 2, true), db.getUint16(10 + k * 2, true))), true);
  }
  v[14] = va[14]; v[15] = va[15]; v[16] = va[16]; v[17] = va[17];
  dv.setUint16(18, Math.round(mix(da.getUint16(18, true), db.getUint16(18, true))), true);
  verts.push(v);
  pos.push([mix(pos[a][0], pos[b][0]), mix(pos[a][1], pos[b][1]), mix(pos[a][2], pos[b][2])]);
  return verts.length - 1;
}

/** A copy of a vertex, moved a little in x and z, for a column of its own. */
function copyVertex(verts, pos, a, dx, dz) {
  const v = verts[a].slice();
  const dv = new DataView(v.buffer);
  const qx = Math.round(dx * POS_SCALE), qz = Math.round(dz * POS_SCALE);
  dv.setInt16(0, dv.getInt16(0, true) + qx, true);
  dv.setInt16(4, dv.getInt16(4, true) + qz, true);
  verts.push(v);
  pos.push([pos[a][0] + qx / POS_SCALE, pos[a][1], pos[a][2] + qz / POS_SCALE]);
  return verts.length - 1;
}

/**
 * Cuts every piece of building inside the worked circle along the column
 * lines and gives each column its own corners. Works on `kept` in place.
 *
 * @returns {number} how many pieces were cut
 */
function columnCut(o, kept, pos, verts, isGround) {
  const { cx, cz, radius } = o;
  const out = [];
  let n = 0;
  // Two quanta of the position grid, so a corner on the line is read by the
  // shader as being in the column it belongs to and not the next one.
  const NUDGE = 2 / POS_SCALE;
  for (let i = 0; i < kept.length; i += 3) {
    const a = kept[i], b = kept[i + 1], c = kept[i + 2];
    const tri = [a, b, c];
    const mx = (pos[a][0] + pos[b][0] + pos[c][0]) / 3;
    const mz = (pos[a][2] + pos[b][2] + pos[c][2]) / 3;
    // Two columns past the rim as well. A piece whose middle was just outside
    // the circle was left whole while the corners of it inside came down,
    // and that piece was a spike from the ground to the roof: one in ten of
    // the walls round a frontage hit by six shells.
    if (isGround(a) || isGround(b) || isGround(c)
      || Math.hypot(mx - cx, mz - cz) > radius + COLUMN * 2) {
      out.push(a, b, c);
      continue;
    }
    const xs = tri.map((t) => pos[t][0]), zs = tri.map((t) => pos[t][2]);
    const kx0 = Math.floor(Math.min(...xs) / COLUMN), kx1 = Math.floor(Math.max(...xs) / COLUMN);
    const kz0 = Math.floor(Math.min(...zs) / COLUMN), kz1 = Math.floor(Math.max(...zs) / COLUMN);
    n++;
    for (let kx = kx0; kx <= kx1; kx++) {
      for (let kz = kz0; kz <= kz1; kz++) {
        // Sutherland and Hodgman against the four sides of the cell.
        let poly = tri.slice();
        const sides = [
          [0, kx * COLUMN, 1], [0, (kx + 1) * COLUMN, -1],
          [2, kz * COLUMN, 1], [2, (kz + 1) * COLUMN, -1],
        ];
        for (const [axis, at, sign] of sides) {
          if (poly.length < 3) break;
          const next = [];
          for (let j = 0; j < poly.length; j++) {
            const p = poly[j], q = poly[(j + 1) % poly.length];
            const dp = (pos[p][axis] - at) * sign, dq = (pos[q][axis] - at) * sign;
            if (dp >= 0) next.push(p);
            if ((dp >= 0) !== (dq >= 0)) {
              const t = dp / (dp - dq);
              next.push(lerpVertex(verts, pos, p, q, t));
            }
          }
          poly = next;
        }
        if (poly.length < 3) continue;
        // Corners of its own, each moved a hair into the middle of the cell.
        const mcx = (kx + 0.5) * COLUMN, mcz = (kz + 0.5) * COLUMN;
        const own = poly.map((p) => {
          const dx = Math.sign(mcx - pos[p][0]) * NUDGE, dz = Math.sign(mcz - pos[p][2]) * NUDGE;
          return copyVertex(verts, pos, p, dx, dz);
        });
        for (let j = 1; j + 1 < own.length; j++) {
          // Drop the slivers clipping leaves along a line.
          const p0 = pos[own[0]], p1 = pos[own[j]], p2 = pos[own[j + 1]];
          const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
          const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
          const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
          if (area < 1e-5) continue;
          out.push(own[0], own[j], own[j + 1]);
        }
      }
    }
  }
  kept.length = 0;
  for (const v of out) kept.push(v);
  return n;
}

/** Every tile a circle touches, and what changed in them. */
function overTiles(world, x, z, radius, fn) {
  const out = [];
  const tx0 = Math.max(0, Math.floor((x - radius - world.minX) / world.tileSize));
  const tx1 = Math.min(world.nx - 1, Math.floor((x + radius - world.minX) / world.tileSize));
  const tz0 = Math.max(0, Math.floor((z - radius - world.minZ) / world.tileSize));
  const tz1 = Math.min(world.nz - 1, Math.floor((z + radius - world.minZ) / world.tileSize));
  for (let tz = tz0; tz <= tz1; tz++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const index = tz * world.nx + tx;
      if (fn(index)) out.push(index);
    }
  }
  return out;
}

/**
 * One tile. Returns whether anything was actually cut, so a blast in the
 * middle of a road does not send eight unchanged tiles back to the card.
 */
function reworkTile(world, index, o) {
  const { cx, cy, cz, radius, edge } = o;
  const rec = world.tiles[index];
  if (!rec) return false;
  const m = tileMesh(rec);
  if (!m.vCount || !m.iCount) return false;
  const [ox, oz] = world.tileOrigin(index);
  const src = m.view;
  const idx = m.i32
    ? new Uint32Array(m.buffer, m.iOff, m.iCount)
    : new Uint16Array(m.buffer, m.iOff, m.iCount);

  // Everything the tile already has, kept as it is. A vertex that ends up
  // unused costs twenty bytes and nothing else, which is cheaper than
  // working out which ones those are.
  const verts = [];
  for (let i = 0; i < m.vCount; i++) {
    verts.push(new Uint8Array(m.buffer, m.vOff + i * VERTEX_STRIDE, VERTEX_STRIDE).slice());
  }
  const pos = [];
  for (let i = 0; i < m.vCount; i++) {
    const o = m.vOff + i * VERTEX_STRIDE;
    pos.push([
      src.getInt16(o, true) / POS_SCALE + ox,
      src.getInt16(o + 2, true) / POS_SCALE,
      src.getInt16(o + 4, true) / POS_SCALE + oz,
    ]);
  }

  const isGround = (i) => (verts[i][17] & FACADE_FLAG.GROUND) !== 0;
  // Whether a triangle has any business being cut: its box against the box
  // round the hole. Testing the corners instead was the first version, and it
  // missed the case that matters most, which is one long thin triangle lying
  // right across the street with both its ends a hundred metres away. A hole
  // in a wall takes the height into account as well; a hole in the ground
  // does not, because the ground is where it is.
  const overlaps = (a, b, c) => {
    const ax = pos[a][0], bx = pos[b][0], cxx = pos[c][0];
    if (Math.min(ax, bx, cxx) > cx + radius) return false;
    if (Math.max(ax, bx, cxx) < cx - radius) return false;
    const az = pos[a][2], bz = pos[b][2], czz = pos[c][2];
    if (Math.min(az, bz, czz) > cz + radius) return false;
    if (Math.max(az, bz, czz) < cz - radius) return false;
    if (!o.ground && !o.tall) {
      const ay = pos[a][1], by = pos[b][1], cyy = pos[c][1];
      if (Math.min(ay, by, cyy) > cy + radius) return false;
      if (Math.max(ay, by, cyy) < cy - radius) return false;
    }
    return true;
  };

  // Midpoints are shared between the two triangles that own the edge, or the
  // two halves pull apart and leave a crack down the middle of the street.
  const mids = new Map();
  const midpoint = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const had = mids.get(key);
    if (had !== undefined) return had;
    const va = verts[a], vb = verts[b];
    const v = new Uint8Array(VERTEX_STRIDE);
    const dv = new DataView(v.buffer);
    const da = new DataView(va.buffer, va.byteOffset, VERTEX_STRIDE);
    const db = new DataView(vb.buffer, vb.byteOffset, VERTEX_STRIDE);
    // Position, normal and texture coordinates are the average of the two it
    // sits between; everything else is a label rather than a measurement and
    // is taken from the first of them.
    for (let k = 0; k < 3; k++) {
      dv.setInt16(k * 2, Math.round((da.getInt16(k * 2, true) + db.getInt16(k * 2, true)) / 2), true);
    }
    for (let k = 0; k < 4; k++) {
      dv.setInt8(6 + k, Math.round((da.getInt8(6 + k) + db.getInt8(6 + k)) / 2));
    }
    for (let k = 0; k < 2; k++) {
      dv.setUint16(10 + k * 2,
        Math.round((da.getUint16(10 + k * 2, true) + db.getUint16(10 + k * 2, true)) / 2), true);
    }
    v[14] = va[14]; v[15] = va[15]; v[16] = va[16]; v[17] = va[17];
    dv.setUint16(18, Math.round((da.getUint16(18, true) + db.getUint16(18, true)) / 2), true);
    const at = verts.length;
    verts.push(v);
    pos.push([
      (pos[a][0] + pos[b][0]) / 2,
      (pos[a][1] + pos[b][1]) / 2,
      (pos[a][2] + pos[b][2]) / 2,
    ]);
    mids.set(key, at);
    return at;
  };

  const kept = [];
  let cut = 0;
  const edge2 = edge * edge;
  const span = (a, b) => {
    const dx = pos[a][0] - pos[b][0], dy = pos[a][1] - pos[b][1], dz = pos[a][2] - pos[b][2];
    return dx * dx + dy * dy + dz * dz;
  };
  const split = (a, b, c, depth) => {
    // A piece that has fallen outside the worked area is left as it is, which
    // is what keeps a long triangle from being cut into a thousand along its
    // whole length when only the middle of it is over the hole.
    if (depth > 0 && !overlaps(a, b, c)) { kept.push(a, b, c); return; }
    const ab = span(a, b), bc = span(b, c), ca = span(c, a);
    const longest = Math.max(ab, bc, ca);
    if (depth >= MAX_DEPTH || longest <= edge2) { kept.push(a, b, c); return; }
    cut++;
    // Always the longest edge, so the pieces stay about as wide as they are
    // long rather than turning into splinters.
    if (ab === longest) {
      const mid = midpoint(a, b);
      split(a, mid, c, depth + 1);
      split(mid, b, c, depth + 1);
    } else if (bc === longest) {
      const mid = midpoint(b, c);
      split(a, mid, c, depth + 1);
      split(a, b, mid, depth + 1);
    } else {
      const mid = midpoint(c, a);
      split(a, b, mid, depth + 1);
      split(mid, b, c, depth + 1);
    }
  };

  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    // One or the other: a crater works on the ground, a shell hole works on
    // everything that is not the ground.
    const mine = o.ground
      ? (isGround(a) && isGround(b) && isGround(c))
      : !(isGround(a) || isGround(b) || isGround(c));
    if (!mine || !overlaps(a, b, c)) {
      kept.push(a, b, c);
      continue;
    }
    split(a, b, c, 0);
  }

  // A building about to come down is cut along the four metre columns the
  // shader breaks it by, and each column gets corners of its own. Cut finer
  // but not along those lines, a piece of wall straddled two columns, and
  // where one came down and the next stood it was pulled into a sheet from
  // the top of the one to the heap of the other: a slanted shard the height
  // of the building. Corners shared across the line would do the same
  // thing a piece over. With its own corners each column breaks away clean
  // and leaves the edge of the next one standing.
  if (o.tall) cut += columnCut(o, kept, pos, verts, isGround);

  // And then the hole itself: every piece whose middle is inside it goes.
  // Only pieces of what this pass works on, though, and only frontages. It
  // took everything with its middle in the sphere, the street included, and
  // the street round a crater has just been cut into metre pieces, so the
  // second rocket into the same spot took the middle out of the crater and
  // left a hole in the map you could see out of the bottom of. The shader's
  // own hole has the same rule: not the ground and not a roof.
  let dropped = 0;
  if (o.drop) {
    const r2 = radius * radius;
    const left = [];
    const frontage = (a, b, c) => {
      if (isGround(a) || isGround(b) || isGround(c)) return false;
      const ux = pos[b][0] - pos[a][0], uy = pos[b][1] - pos[a][1], uz = pos[b][2] - pos[a][2];
      const vx = pos[c][0] - pos[a][0], vy = pos[c][1] - pos[a][1], vz = pos[c][2] - pos[a][2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      return l > 1e-9 && Math.abs(ny) / l < 0.55;
    };
    for (let i = 0; i < kept.length; i += 3) {
      const a = kept[i], b = kept[i + 1], c = kept[i + 2];
      if (!frontage(a, b, c)) { left.push(a, b, c); continue; }
      const mx = (pos[a][0] + pos[b][0] + pos[c][0]) / 3;
      const my = (pos[a][1] + pos[b][1] + pos[c][1]) / 3;
      const mz = (pos[a][2] + pos[b][2] + pos[c][2]) / 3;
      const dx = mx - cx, dy = my - cy, dz = mz - cz;
      if (dx * dx + dy * dy + dz * dz <= r2) { dropped++; continue; }
      left.push(a, b, c);
    }
    kept.length = 0;
    for (const v of left) kept.push(v);
  }
  // Nothing cut and nothing taken out means nothing to send back.
  if (!cut && !dropped) return false;

  // One buffer for the tile, laid out the way the file lays one out: the
  // vertices, then the indices, so the uploader can keep reading offsets.
  const i32 = verts.length > 65535;
  const vBytes = verts.length * VERTEX_STRIDE;
  const iBytes = kept.length * (i32 ? 4 : 2);
  const buffer = new ArrayBuffer(vBytes + iBytes);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < verts.length; i++) bytes.set(verts[i], i * VERTEX_STRIDE);
  const out = i32
    ? new Uint32Array(buffer, vBytes, kept.length)
    : new Uint16Array(buffer, vBytes, kept.length);
  for (let i = 0; i < kept.length; i++) out[i] = kept[i];

  // The box it draws inside. The vertices have not moved yet, so this is the
  // old one with room underneath for the hole that is about to be dug.
  const min = m.min.slice();
  const max = m.max.slice();
  rec.mesh = {
    buffer, view: new DataView(buffer),
    vOff: 0, vCount: verts.length,
    iOff: vBytes, iCount: kept.length,
    i32, tris: kept.length / 3,
    min, max,
  };
  return true;
}
