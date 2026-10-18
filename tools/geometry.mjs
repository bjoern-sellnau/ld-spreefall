// Geometry generators: building extrusion with roofs, road ribbons, and the
// solids the landmark shapes are assembled from. Everything writes into a Mesh.

import { triangulate, signedArea } from './earcut.mjs';
import { MAT, FACADE_FLAG } from '../src/shared/constants.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Rings

export function ringLength(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
  }
  return s;
}

export function ringArea(ring) { return Math.abs(signedArea(ring)); }

export function ringCentroid(ring) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j], q = ring[i];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f; cx += (p[0] + q[0]) * f; cz += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0;
    for (const p of ring) { sx += p[0]; sz += p[1]; }
    return [sx / ring.length, sz / ring.length];
  }
  a *= 0.5;
  return [cx / (6 * a), cz / (6 * a)];
}

/** Minimum area oriented bounding box, brute forced over 90 angles. */
export function orientedBox(ring) {
  let best = null;
  for (let k = 0; k < 90; k++) {
    const a = (k / 90) * (Math.PI / 2);
    const c = Math.cos(a), s = Math.sin(a);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of ring) {
      const u = p[0] * c + p[1] * s;
      const v = -p[0] * s + p[1] * c;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      best = { area, a, c, s, minU, maxU, minV, maxV };
    }
  }
  const { c, s, minU, maxU, minV, maxV } = best;
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  return {
    angle: best.angle !== undefined ? best.angle : best.a,
    cx: cu * c - cv * s,
    cz: cu * s + cv * c,
    lu: maxU - minU,
    lv: maxV - minV,
    ux: c, uz: s,        // unit vector along u
    vx: -s, vz: c,       // unit vector along v
  };
}

// ---------------------------------------------------------------------------
// Buildings

/**
 * @param {Mesh} mesh
 * @param {{outer:[number,number][], holes:[number,number][][]}} foot
 * @param {object} o base, height, roofShape, roofHeight, minHeight, wallMat,
 *                   roofMat, seed, levels, landmark, uOffset
 */
export function extrudeBuilding(mesh, foot, o) {
  const base = o.base;
  const wallTop = base + o.height;
  const wallMat = o.wallMat !== undefined ? o.wallMat : MAT.FACADE;
  const roofMat = o.roofMat !== undefined ? o.roofMat : MAT.ROOF;
  const seed = o.seed & 255;
  const levels = Math.min(255, o.levels | 0);
  const landmarkFlag = o.landmark ? FACADE_FLAG.LANDMARK : 0;
  const noWin = o.noWindows ? FACADE_FLAG.NO_WINDOWS : 0;
  const hgt = Math.max(0, o.height);
  const bottom = base - (o.skirt !== undefined ? o.skirt : 1.2);

  const rings = [normaliseRing(foot.outer, true)];
  for (const h of (foot.holes || [])) rings.push(normaliseRing(h, false));

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    if (ring.length < 3) continue;
    let run = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.02) continue;
      // Outward normal for a counter clockwise outer ring in our x/z plane.
      const nx = dz / len, nz = -dx / len;
      const u0 = run, u1 = run + len;
      const flags = landmarkFlag | noWin;
      const v0 = mesh.vertex(a[0], bottom, a[1], nx, 0, nz, u0, 0, wallMat, seed, levels, flags | FACADE_FLAG.GROUND_FLOOR, hgt, 150);
      const v1 = mesh.vertex(b[0], bottom, b[1], nx, 0, nz, u1, 0, wallMat, seed, levels, flags | FACADE_FLAG.GROUND_FLOOR, hgt, 150);
      const v2 = mesh.vertex(b[0], wallTop, b[1], nx, 0, nz, u1, o.height + (o.skirt !== undefined ? o.skirt : 1.2), wallMat, seed, levels, flags, hgt, 255);
      const v3 = mesh.vertex(a[0], wallTop, a[1], nx, 0, nz, u0, o.height + (o.skirt !== undefined ? o.skirt : 1.2), wallMat, seed, levels, flags, hgt, 255);
      // Viewed from above, +z runs south, so a ring that is counter clockwise in
      // the maths sense reads clockwise on screen. The quad is wound to match the
      // outward normal, not the ring order.
      mesh.quad(v3, v2, v1, v0);
      run = u1;
    }
  }

  // A closed solid is only needed by the unit test and by anything that has to
  // be watertight. The city never shows the underside of a building.
  if (o.capBottom) {
    const { verts, indices } = triangulate(rings[0], rings.slice(1));
    const map = verts.map((p) => mesh.vertex(p[0], bottom, p[1], 0, -1, 0, p[0], p[1], roofMat, seed, 0, FACADE_FLAG.NO_WINDOWS, 0, 255));
    for (let i = 0; i < indices.length; i += 3) {
      mesh.tri(map[indices[i]], map[indices[i + 1]], map[indices[i + 2]]);
    }
  }

  // Relief. A cornice under the eaves on anything tall enough to have one,
  // and a string course over the shop windows where there are shops. Both
  // are bands rather than mouldings: two quads an edge buys the shadow line,
  // and a profile nobody can see from the pavement buys nothing.
  if (o.relief && o.height > 9) {
    facadeBand(mesh, rings[0], wallTop - 0.95, 0.5, 0.26, wallMat, seed, hgt);
  }
  if (o.shopfront && o.height > 6) {
    facadeBand(mesh, rings[0], base + 3.9, 0.3, 0.15, wallMat, seed, hgt);
  }

  // The roof. Everything OpenStreetMap writes down about one is honoured
  // here: its shape, which way the ridge runs, which way a single slope
  // falls, and what it is made of. A shape nobody has tagged, or one that
  // cannot be built over this footprint, comes out flat with a parapet,
  // which is what most of Berlin has anyway.
  const shape = o.roofShape || 'flat';
  const rh = o.roofHeight || 0;
  const roofSeed = o.roofSeed !== undefined ? (o.roofSeed & 255) : seed;
  if (rh > 0.2 && (shape === 'gabled' || shape === 'saltbox')) {
    gabledRoof(mesh, rings[0], wallTop, rh, roofMat, roofSeed, o.roofAcross);
  } else if (rh > 0.2 && (shape === 'hipped' || shape === 'half_hipped')) {
    hippedRoof(mesh, rings[0], wallTop, rh, roofMat, roofSeed, o.roofAcross);
  } else if (rh > 0.2 && (shape === 'pyramidal' || shape === 'cone' || shape === 'tented')) {
    pyramidRoof(mesh, rings[0], wallTop, rh, roofMat, roofSeed);
  } else if (rh > 0.2 && (shape === 'skillion' || shape === 'lean_to' || shape === 'mono_pitch')) {
    skillionRoof(mesh, rings[0], wallTop, rh, roofMat, roofSeed, o.roofDir);
  } else if (rh > 0.2 && (shape === 'mansard' || shape === 'gambrel')) {
    mansardRoof(mesh, rings[0], wallTop, rh, roofMat, roofSeed);
  } else if (rh > 0.2 && (shape === 'dome' || shape === 'onion' || shape === 'round')) {
    domeRoof(mesh, rings[0], wallTop, rh, roofMat, roofSeed);
  } else {
    flatRoof(mesh, rings, wallTop, roofMat, roofSeed);
    if (o.parapet !== false && o.height > 6) parapet(mesh, rings[0], wallTop, 0.7, wallMat, seed, hgt);
  }
}

/**
 * A band round the outside of a building: the cornice under the eaves, the
 * string course over the shop windows. Two quads an edge, the face you see
 * and the underside the sun never reaches, and it is the second one that
 * does the work: the shadow line under a projecting band is what makes a
 * frontage read as relief rather than as a photograph of one.
 *
 * Edges shorter than minEdge are skipped. A Berlin block has a dozen two
 * metre jogs in its outline that nobody can see and every one of them would
 * cost the same as the frontage.
 *
 * @param {Array<[number,number]>} ring the footprint, counter clockwise
 * @param {number} y where the band starts, in world metres
 * @param {number} height how deep the band is
 * @param {number} out how far it stands proud of the wall
 */
export function facadeBand(mesh, ring, y, height, out, mat, seed, hgt, minEdge = 3.5) {
  const flags = FACADE_FLAG.NO_WINDOWS;
  let run = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < minEdge) { run += len; continue; }
    const nx = dz / len, nz = -dx / len;
    const ax = a[0] + nx * out, az = a[1] + nz * out;
    const bx = b[0] + nx * out, bz = b[1] + nz * out;
    // The face.
    const f0 = mesh.vertex(ax, y, az, nx, 0, nz, run, 0, mat, seed, 0, flags, hgt, 255);
    const f1 = mesh.vertex(bx, y, bz, nx, 0, nz, run + len, 0, mat, seed, 0, flags, hgt, 255);
    const f2 = mesh.vertex(bx, y + height, bz, nx, 0, nz, run + len, height, mat, seed, 0, flags, hgt, 255);
    const f3 = mesh.vertex(ax, y + height, az, nx, 0, nz, run, height, mat, seed, 0, flags, hgt, 255);
    mesh.quad(f3, f2, f1, f0);
    // And the underside, which is the shadow.
    const u0 = mesh.vertex(a[0], y, a[1], 0, -1, 0, run, 0, mat, seed, 0, flags, hgt, 120);
    const u1 = mesh.vertex(b[0], y, b[1], 0, -1, 0, run + len, 0, mat, seed, 0, flags, hgt, 120);
    const u2 = mesh.vertex(bx, y, bz, 0, -1, 0, run + len, out, mat, seed, 0, flags, hgt, 120);
    const u3 = mesh.vertex(ax, y, az, 0, -1, 0, run, out, mat, seed, 0, flags, hgt, 120);
    mesh.quad(u0, u1, u2, u3);
    run += len;
  }
}

function normaliseRing(ring, ccw) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-4) out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4) out.pop();
  }
  const area = signedArea(out);
  if ((area > 0) !== ccw) out.reverse();
  return out;
}

export function flatRoof(mesh, rings, y, mat, seed, flags = 0) {
  const { verts, indices } = triangulate(rings[0], rings.slice(1));
  const map = verts.map((p) => mesh.vertex(p[0], y, p[1], 0, 1, 0, p[0], p[1], mat, seed, 0, flags, 0, 255));
  for (let i = 0; i < indices.length; i += 3) {
    mesh.tri(map[indices[i]], map[indices[i + 2]], map[indices[i + 1]]);
  }
}

function parapet(mesh, ring, y, h, mat, seed, hgt) {
  const flags = FACADE_FLAG.NO_WINDOWS;
  let run = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.02) continue;
    const nx = dz / len, nz = -dx / len;
    const v0 = mesh.vertex(a[0], y, a[1], nx, 0, nz, run, 0, mat, seed, 0, flags, hgt, 255);
    const v1 = mesh.vertex(b[0], y, b[1], nx, 0, nz, run + len, 0, mat, seed, 0, flags, hgt, 255);
    const v2 = mesh.vertex(b[0], y + h, b[1], nx, 0, nz, run + len, h, mat, seed, 0, flags, hgt, 255);
    const v3 = mesh.vertex(a[0], y + h, a[1], nx, 0, nz, run, h, mat, seed, 0, flags, hgt, 255);
    mesh.quad(v3, v2, v1, v0);
    run += len;
  }
}

// Emit one face with the normal pointing away from `ref`, and wound to agree
// with it. Every sloped surface in the project goes through here, so a roof can
// never end up invisible or lit from the inside.
function emitFace(mesh, pts, uvs, mat, seed, flags, ref) {
  const g = rawNormal(pts[0], pts[1], pts[2]);
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const mz = pts.reduce((a, p) => a + p[2], 0) / pts.length;
  const away = (mx - ref[0]) * g[0] + (my - ref[1]) * g[1] + (mz - ref[2]) * g[2];
  const n = away >= 0 ? g : [-g[0], -g[1], -g[2]];
  const ids = pts.map((p, k) => mesh.vertex(p[0], p[1], p[2], n[0], n[1], n[2],
    uvs[k][0], uvs[k][1], mat, seed, 0, flags, 0, 255));
  const forward = away >= 0;
  if (ids.length === 4) {
    if (forward) mesh.quad(ids[0], ids[1], ids[2], ids[3]);
    else mesh.quad(ids[3], ids[2], ids[1], ids[0]);
  } else if (forward) mesh.tri(ids[0], ids[1], ids[2]);
  else mesh.tri(ids[2], ids[1], ids[0]);
}

function rawNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// A gabled roof over the footprint oriented bounding box. The ridge runs along
// the long axis. Footprints that are not close to rectangular fall back to flat,
// because a fake gable on a complex outline looks worse than no gable.
function gabledRoof(mesh, ring, y, rh, mat, seed, across = false) {
  const b = orientedBox(ring);
  if (ringArea(ring) < b.lu * b.lv * 0.78) { flatRoof(mesh, [ring], y, mat, seed); return; }
  // The ridge runs along the long axis unless the tagging says across it,
  // which is roof:orientation and the one thing that decides whether a block
  // reads as a row of houses or as one shed.
  const long = across ? b.lu < b.lv : b.lu >= b.lv;
  const hu = b.lu / 2, hv = b.lv / 2;
  const P = (u, v, h) => [b.cx + u * b.ux + v * b.vx, y + h, b.cz + u * b.uz + v * b.vz];
  const flags = FACADE_FLAG.ROOF_SLOPE;
  const ref = [b.cx, y - 1, b.cz];
  const c0 = P(-hu, -hv, 0), c1 = P(hu, -hv, 0), c2 = P(hu, hv, 0), c3 = P(-hu, hv, 0);
  if (long) {
    const slope = Math.hypot(hv, rh);
    const r0 = P(-hu, 0, rh), r1 = P(hu, 0, rh);
    emitFace(mesh, [c0, c1, r1, r0], [[0, 0], [b.lu, 0], [b.lu, slope], [0, slope]], mat, seed, flags, ref);
    emitFace(mesh, [c2, c3, r0, r1], [[0, 0], [b.lu, 0], [b.lu, slope], [0, slope]], mat, seed, flags, ref);
    emitFace(mesh, [c0, r0, c3], [[0, 0], [hv, rh], [b.lv, 0]], mat, seed, flags, ref);
    emitFace(mesh, [c1, c2, r1], [[0, 0], [b.lv, 0], [hv, rh]], mat, seed, flags, ref);
  } else {
    const slope = Math.hypot(hu, rh);
    const r0 = P(0, -hv, rh), r1 = P(0, hv, rh);
    emitFace(mesh, [c1, c2, r1, r0], [[0, 0], [b.lv, 0], [b.lv, slope], [0, slope]], mat, seed, flags, ref);
    emitFace(mesh, [c3, c0, r0, r1], [[0, 0], [b.lv, 0], [b.lv, slope], [0, slope]], mat, seed, flags, ref);
    emitFace(mesh, [c0, c1, r0], [[0, 0], [b.lu, 0], [hu, rh]], mat, seed, flags, ref);
    emitFace(mesh, [c2, c3, r1], [[0, 0], [b.lu, 0], [hu, rh]], mat, seed, flags, ref);
  }
}

function hippedRoof(mesh, ring, y, rh, mat, seed, across = false) {
  const b = orientedBox(ring);
  if (ringArea(ring) < b.lu * b.lv * 0.78) { flatRoof(mesh, [ring], y, mat, seed); return; }
  const hu = b.lu / 2, hv = b.lv / 2;
  const inset = Math.min(hu, hv) * 0.62;
  const long = across ? b.lu < b.lv : b.lu >= b.lv;
  const P = (u, v, h) => [b.cx + u * b.ux + v * b.vx, y + h, b.cz + u * b.uz + v * b.vz];
  const flags = FACADE_FLAG.ROOF_SLOPE;
  const ref = [b.cx, y - 1, b.cz];
  const c0 = P(-hu, -hv, 0), c1 = P(hu, -hv, 0), c2 = P(hu, hv, 0), c3 = P(-hu, hv, 0);
  const r0 = long ? P(-hu + inset, 0, rh) : P(0, -hv + inset, rh);
  const r1 = long ? P(hu - inset, 0, rh) : P(0, hv - inset, rh);
  const uvQ = [[0, 0], [b.lu, 0], [b.lu, rh * 2], [0, rh * 2]];
  const uvT = [[0, 0], [b.lv, 0], [b.lv / 2, rh * 2]];
  emitFace(mesh, [c0, c1, r1, r0], uvQ, mat, seed, flags, ref);
  emitFace(mesh, [c2, c3, r0, r1], uvQ, mat, seed, flags, ref);
  emitFace(mesh, [c1, c2, r1], uvT, mat, seed, flags, ref);
  emitFace(mesh, [c3, c0, r0], uvT, mat, seed, flags, ref);
}

/**
 * A pyramid over the footprint: one triangle from every edge up to a point
 * over the middle. Any outline at all can carry one, which is why the tower
 * tops and the pavilions use it.
 */
function pyramidRoof(mesh, ring, y, rh, mat, seed) {
  const [cx, cz] = ringCentroid(ring);
  const apex = [cx, y + rh, cz];
  const ref = [cx, y - 1, cz];
  const flags = FACADE_FLAG.ROOF_SLOPE;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const slope = Math.hypot(len / 2, rh);
    emitFace(mesh, [[a[0], y, a[1]], [b[0], y, b[1]], apex],
      [[0, 0], [len, 0], [len / 2, slope]], mat, seed, flags, ref);
  }
}

/**
 * One slope, falling the way roof:direction says it falls. The plane is cut
 * out of the footprint itself rather than out of its bounding box, so an L
 * shaped shed keeps its shape, and the triangle of wall left under the high
 * side is closed off.
 *
 * @param {number} dirDeg compass degrees the roof faces, or undefined for
 *   the way the footprint is shortest, which is how a lean to is usually hung
 */
function skillionRoof(mesh, ring, y, rh, mat, seed, dirDeg) {
  let dx, dz;
  if (Number.isFinite(dirDeg)) {
    const r = (dirDeg * Math.PI) / 180;
    dx = Math.sin(r); dz = -Math.cos(r);
  } else {
    const b = orientedBox(ring);
    // Down the short axis, which is the way water is meant to come off it.
    if (b.lu >= b.lv) { dx = b.vx; dz = b.vz; } else { dx = b.ux; dz = b.uz; }
  }
  let lo = Infinity, hi = -Infinity;
  for (const p of ring) {
    const t = p[0] * dx + p[1] * dz;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  const span = hi - lo || 1;
  const hAt = (p) => y + rh * (hi - (p[0] * dx + p[1] * dz)) / span;
  // The plane tilts by rh over the span, so its normal leans the same way.
  const g = rh / span;
  const nl = Math.hypot(g * dx, 1, g * dz) || 1;
  const nx = (g * dx) / nl, ny = 1 / nl, nz = (g * dz) / nl;
  const { verts, indices } = triangulate(ring, []);
  const map = verts.map((p) => mesh.vertex(p[0], hAt(p), p[1], nx, ny, nz,
    p[0], p[1], mat, seed, 0, FACADE_FLAG.ROOF_SLOPE, 0, 255));
  for (let i = 0; i < indices.length; i += 3) {
    mesh.tri(map[indices[i]], map[indices[i + 2]], map[indices[i + 1]]);
  }
  // The wall between the top of the building and the sloped plane, so the
  // high end is not open to the sky.
  let run = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const len = Math.hypot(ex, ez);
    if (len < 0.05) continue;
    const ha = hAt(a), hb = hAt(b);
    if (ha - y < 0.05 && hb - y < 0.05) { run += len; continue; }
    const enx = ez / len, enz = -ex / len;
    const v0 = mesh.vertex(a[0], y, a[1], enx, 0, enz, run, 0, mat, seed, 0, FACADE_FLAG.NO_WINDOWS, 0, 255);
    const v1 = mesh.vertex(b[0], y, b[1], enx, 0, enz, run + len, 0, mat, seed, 0, FACADE_FLAG.NO_WINDOWS, 0, 255);
    const v2 = mesh.vertex(b[0], hb, b[1], enx, 0, enz, run + len, hb - y, mat, seed, 0, FACADE_FLAG.NO_WINDOWS, 0, 255);
    const v3 = mesh.vertex(a[0], ha, a[1], enx, 0, enz, run, ha - y, mat, seed, 0, FACADE_FLAG.NO_WINDOWS, 0, 255);
    mesh.quad(v3, v2, v1, v0);
    run += len;
  }
}

/**
 * A mansard: steep sides rising to a flat deck, which is the roof on half the
 * Gruenderzeit blocks in this city and the reason their top floor has dormer
 * windows. Built over the oriented box, like the gable and the hip, and a
 * footprint too far from a rectangle falls back to flat.
 */
function mansardRoof(mesh, ring, y, rh, mat, seed) {
  const b = orientedBox(ring);
  if (ringArea(ring) < b.lu * b.lv * 0.78) { flatRoof(mesh, [ring], y, mat, seed); return; }
  const hu = b.lu / 2, hv = b.lv / 2;
  const inset = Math.min(hu, hv) * 0.42;
  const P = (u, v, h) => [b.cx + u * b.ux + v * b.vx, y + h, b.cz + u * b.uz + v * b.vz];
  const ref = [b.cx, y - 1, b.cz];
  const flags = FACADE_FLAG.ROOF_SLOPE;
  const c = [P(-hu, -hv, 0), P(hu, -hv, 0), P(hu, hv, 0), P(-hu, hv, 0)];
  const d = [P(-hu + inset, -hv + inset, rh), P(hu - inset, -hv + inset, rh),
    P(hu - inset, hv - inset, rh), P(-hu + inset, hv - inset, rh)];
  const slope = Math.hypot(inset, rh);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const len = Math.hypot(c[j][0] - c[i][0], c[j][2] - c[i][2]);
    emitFace(mesh, [c[i], c[j], d[j], d[i]],
      [[0, 0], [len, 0], [len, slope], [0, slope]], mat, seed, flags, ref);
  }
  emitFace(mesh, [d[0], d[1], d[2], d[3]],
    [[0, 0], [b.lu, 0], [b.lu, b.lv], [0, b.lv]], mat, seed, FACADE_FLAG.NO_WINDOWS, ref);
}

/**
 * A dome over the footprint's box, in three courses of twelve. Rare enough in
 * the data to be worth the triangles: the ones that carry this tag are the
 * cathedral, the synagogue and the Reichstag's neighbours, and a flat lid on
 * any of them is the one thing everybody notices.
 */
function domeRoof(mesh, ring, y, rh, mat, seed) {
  const b = orientedBox(ring);
  const ru = b.lu / 2, rv = b.lv / 2;
  const ref = [b.cx, y - 1, b.cz];
  const flags = FACADE_FLAG.ROOF_SLOPE;
  const STACKS = 3, SLICES = 12;
  const at = (i, k) => {
    const ang = (i / SLICES) * Math.PI * 2;
    const lat = (k / STACKS) * (Math.PI / 2);
    const r = Math.cos(lat);
    const u = Math.cos(ang) * ru * r, v = Math.sin(ang) * rv * r;
    return [b.cx + u * b.ux + v * b.vx, y + Math.sin(lat) * rh, b.cz + u * b.uz + v * b.vz];
  };
  for (let k = 0; k < STACKS; k++) {
    for (let i = 0; i < SLICES; i++) {
      const p0 = at(i, k), p1 = at(i + 1, k), p2 = at(i + 1, k + 1), p3 = at(i, k + 1);
      const w = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
      const hgt = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
      if (k === STACKS - 1) {
        emitFace(mesh, [p0, p1, p3], [[0, 0], [w, 0], [w / 2, hgt]], mat, seed, flags, ref);
      } else {
        emitFace(mesh, [p0, p1, p2, p3], [[0, 0], [w, 0], [w, hgt], [0, hgt]], mat, seed, flags, ref);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// What stands on the street

/**
 * A Berlin street lamp: a cast post with a slight taper, an arm over the
 * carriageway and a lantern on the end of it. A few dozen triangles, which
 * at one every forty five metres is what a street costs to look lived in.
 *
 * @param {number} yaw which way the arm reaches, radians
 */
export function lampPost(mesh, x, y, z, yaw, opts = {}) {
  const h = opts.height || 6.2;
  const reach = opts.reach || 1.1;
  const flags = FACADE_FLAG.NO_WINDOWS;
  const o = { flags, seed: opts.seed || 0 };
  cylinder(mesh, x, y, z, 0.17, 0.10, h, 7, MAT.METAL, o);
  // The arm, a flattened box leaning out over the road.
  const ax = x + Math.sin(yaw) * reach * 0.5;
  const az = z + Math.cos(yaw) * reach * 0.5;
  box(mesh, ax, y + h - 0.12, az, reach, 0.14, 0.16, MAT.METAL, { ...o, rot: -yaw });
  // The lantern. Glass, so it catches the sun and reads at dusk.
  const lx = x + Math.sin(yaw) * reach;
  const lz = z + Math.cos(yaw) * reach;
  box(mesh, lx, y + h - 0.34, lz, 0.52, 0.22, 0.34, MAT.GLASS, { ...o, rot: -yaw });
}

/**
 * A car at the kerb. Four boxes and a windscreen: a body, a cabin, and the
 * dark band of glass that makes it read as a car rather than as a crate.
 * Deliberately low on triangles, because a street has a lot of them.
 */
export function parkedCar(mesh, x, y, z, yaw, opts = {}) {
  const len = opts.length || 4.3;
  const wide = opts.width || 1.78;
  const flags = FACADE_FLAG.NO_WINDOWS;
  const o = { flags, seed: opts.seed || 0, rot: -yaw };
  // What it is made of stands in for what colour it is, because a car has no
  // palette of its own in this renderer: dark road grey, concrete grey or
  // steel, picked off the seed. A street of bright metal boxes reads as a
  // row of fridges.
  const shell = [MAT.ASPHALT, MAT.CONCRETE, MAT.ASPHALT, MAT.METAL][(opts.seed || 0) & 3];
  // The body sits on its wheels rather than on the road.
  box(mesh, x, y + 0.26, z, wide, 0.62, len, shell, o);
  // The cabin, shorter and set back.
  const bx = x - Math.sin(yaw) * 0.15, bz = z - Math.cos(yaw) * 0.15;
  box(mesh, bx, y + 0.88, bz, wide * 0.92, 0.52, len * 0.52, shell, o);
  // Glass all the way round the cabin, a hand's breadth proud of it.
  box(mesh, bx, y + 0.96, bz, wide * 0.95, 0.34, len * 0.54, MAT.GLASS, o);
  // Wheels, as two dark bars. Four cylinders would be forty triangles for
  // something nobody looks at.
  box(mesh, x, y + 0.02, z, wide * 1.02, 0.26, len * 0.78, MAT.ASPHALT, o);
}

/** A bin: a dark drum on the pavement. */
export function streetBin(mesh, x, y, z, opts = {}) {
  cylinder(mesh, x, y, z, 0.26, 0.30, 0.95, 8, MAT.METAL,
    { flags: FACADE_FLAG.NO_WINDOWS, seed: opts.seed || 0 });
}

/** A bench: a slab on two legs, facing the way it is turned. */
export function bench(mesh, x, y, z, yaw, opts = {}) {
  const flags = FACADE_FLAG.NO_WINDOWS;
  const o = { flags, seed: opts.seed || 0, rot: -yaw };
  box(mesh, x, y + 0.42, z, 1.72, 0.09, 0.52, MAT.FACADE, o);
  box(mesh, x - Math.sin(yaw) * 0.24, y + 0.52, z - Math.cos(yaw) * 0.24,
    1.72, 0.42, 0.08, MAT.FACADE, o);
  for (const side of [-0.72, 0.72]) {
    box(mesh, x + Math.cos(yaw) * side, y, z - Math.sin(yaw) * side,
      0.1, 0.42, 0.46, MAT.METAL, o);
  }
}

// ---------------------------------------------------------------------------
// Ribbons, for roads, pavements and rails

/**
 * Build a flat strip along a centreline. u runs across the strip in metres from
 * the centre, v runs along it in metres, which is what the lane marking shader
 * wants. yAt(x, z) supplies the ground height.
 */
export function ribbon(mesh, line, half, mat, yAt, opts = {}) {
  if (line.length < 2) return;
  // Long straight runs are cut up for the same reason the ground polygons
  // are: a vertex is a sixteen bit offset from its tile and a quad five
  // hundred metres long comes back from that clamp bent. Both edges of the
  // strip are cut at the same places, so the strip stays watertight, and the
  // extra points let a road follow the ground it is laid on.
  line = subdivideLine(line, opts.piece || GROUND_PIECE);
  const lift = opts.lift || 0;
  // A road, a pavement, a railway bed: all of them ground. See groundPolygon.
  const flags = (opts.flags || 0) | FACADE_FLAG.GROUND;
  const seed = opts.seed || 0;
  const left = [], right = [];
  let run = 0;
  const runs = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    if (i > 0) run += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]);
    runs.push(run);
    left.push([p[0] - dz * half, p[1] + dx * half]);
    right.push([p[0] + dz * half, p[1] - dx * half]);
  }
  let prevL = -1, prevR = -1;
  for (let i = 0; i < line.length; i++) {
    const lY = yAt(left[i][0], left[i][1]) + lift;
    const rY = yAt(right[i][0], right[i][1]) + lift;
    const vl = mesh.vertex(left[i][0], lY, left[i][1], 0, 1, 0, -half, runs[i], mat, seed, 0, flags, half * 2, 255);
    const vr = mesh.vertex(right[i][0], rY, right[i][1], 0, 1, 0, half, runs[i], mat, seed, 0, flags, half * 2, 255);
    if (i > 0) mesh.quad(prevL, vl, vr, prevR);
    prevL = vl; prevR = vr;
  }
}

/** A polyline with no segment longer than the given step. */
function subdivideLine(line, step) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(len / step);
    for (let k = 1; k < n; k++) {
      out.push([a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)]);
    }
    out.push(b);
  }
  return out;
}

/**
 * How big a piece of ground is allowed to get, in metres.
 *
 * A vertex is stored as a sixteen bit offset from its tile's origin at a
 * sixty fourth of a metre, which runs out at five hundred and twelve metres,
 * and anything past that is clamped. The Tiergarten came out of the
 * triangulator as a handful of triangles six hundred metres across, the clamp
 * pulled their corners in, and the park was left with a hole in it you could
 * see the sky through while standing on ground the collision layer called
 * solid. Fifty metres also nests inside the hundred metre tiles, so a piece
 * of ground belongs to the tile it is drawn in rather than to one three
 * streets away, and it lets the ground follow the terrain instead of being
 * one flat sheet laid over a city that is not flat.
 */
export const GROUND_PIECE = 50;

/**
 * A triangle cut into the pieces of a grid, as a list of convex polygons.
 *
 * The cut is done with the same arithmetic on both sides of every grid line,
 * so two triangles that share an edge come out of this sharing it still:
 * there are no T junctions and no hairline cracks along the cuts.
 */
function clipToGrid(tri, grid) {
  const xs = [tri[0][0], tri[1][0], tri[2][0]];
  const zs = [tri[0][1], tri[1][1], tri[2][1]];
  const gx0 = Math.floor(Math.min(...xs) / grid);
  const gx1 = Math.floor((Math.max(...xs) - 1e-9) / grid);
  const gz0 = Math.floor(Math.min(...zs) / grid);
  const gz1 = Math.floor((Math.max(...zs) - 1e-9) / grid);
  if (gx0 === gx1 && gz0 === gz1) return [tri];
  const out = [];
  for (let gz = gz0; gz <= gz1; gz++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const piece = clipToBox(tri, gx * grid, gz * grid, (gx + 1) * grid, (gz + 1) * grid);
      if (piece.length >= 3) out.push(piece);
    }
  }
  return out;
}

/** Sutherland Hodgman against an axis aligned box in x and z. */
function clipToBox(poly, minX, minZ, maxX, maxZ) {
  const edges = [
    (p) => p[0] >= minX, (p) => p[0] <= maxX,
    (p) => p[1] >= minZ, (p) => p[1] <= maxZ,
  ];
  const cuts = [
    (a, b) => cutAt(a, b, 0, minX), (a, b) => cutAt(a, b, 0, maxX),
    (a, b) => cutAt(a, b, 1, minZ), (a, b) => cutAt(a, b, 1, maxZ),
  ];
  let ring = poly;
  for (let e = 0; e < 4 && ring.length; e++) {
    const inside = edges[e];
    const cut = cuts[e];
    const next = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      const ina = inside(a), inb = inside(b);
      if (ina && inb) next.push(b);
      else if (ina && !inb) next.push(cut(a, b));
      else if (!ina && inb) { next.push(cut(a, b)); next.push(b); }
    }
    ring = next;
  }
  // Points that landed on top of each other help nobody.
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if (Math.abs(p[0] - q[0]) > 1e-6 || Math.abs(p[1] - q[1]) > 1e-6) out.push(p);
  }
  return out.length >= 3 ? out : [];
}

/** Where the segment crosses a line of constant x (axis 0) or z (axis 1). */
function cutAt(a, b, axis, value) {
  const da = a[axis], db = b[axis];
  const t = Math.abs(db - da) < 1e-12 ? 0 : (value - da) / (db - da);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** A polygon area laid on the ground, uv in world metres. */
export function groundPolygon(mesh, outer, holes, mat, yAt, opts = {}) {
  const { verts, indices } = triangulate(outer, holes || []);
  if (!indices.length) return;
  const lift = opts.lift || 0;
  // Everything laid flat on the world is ground, and has to say so, because
  // that is what the collapse code tests to decide whether a vertex belongs
  // in a crater or in a wall.
  const flags = (opts.flags || 0) | FACADE_FLAG.GROUND;
  const seed = opts.seed || 0;
  const grid = opts.grid || GROUND_PIECE;
  const put = (p) => mesh.vertex(p[0], yAt(p[0], p[1]) + lift, p[1], 0, 1, 0,
    p[0], p[1], mat, seed, 0, flags, 0, 255);
  for (let i = 0; i < indices.length; i += 3) {
    // The winding the triangulator hands back is the other way round from the
    // one this engine draws, which is why b and c are swapped here.
    const tri = [verts[indices[i]], verts[indices[i + 2]], verts[indices[i + 1]]];
    for (const piece of clipToGrid(tri, grid)) {
      const ids = piece.map(put);
      for (let k = 2; k < ids.length; k++) mesh.tri(ids[0], ids[k - 1], ids[k]);
    }
  }
}

// ---------------------------------------------------------------------------
// Solids used by the landmark shapes

export function box(mesh, cx, cy, cz, w, h, d, mat, opts = {}) {
  const hw = w / 2, hd = d / 2;
  const rot = opts.rot || 0;
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (u, yy, v) => [cx + u * c - v * s, cy + yy, cz + u * s + v * c];
  const seed = opts.seed || 0;
  const flags = opts.flags || 0;
  const levels = opts.levels || 0;
  const faces = [
    { n: [c, 0, s], p: [P(hw, 0, -hd), P(hw, 0, hd), P(hw, h, hd), P(hw, h, -hd)] },
    { n: [-c, 0, -s], p: [P(-hw, 0, hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(-hw, h, hd)] },
    { n: [-s, 0, c], p: [P(hw, 0, hd), P(-hw, 0, hd), P(-hw, h, hd), P(hw, h, hd)] },
    { n: [s, 0, -c], p: [P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, h, -hd), P(-hw, h, -hd)] },
    { n: [0, 1, 0], p: [P(-hw, h, -hd), P(hw, h, -hd), P(hw, h, hd), P(-hw, h, hd)] },
  ];
  for (const f of faces) {
    const ids = f.p.map((p, k) => mesh.vertex(p[0], p[1], p[2], f.n[0], f.n[1], f.n[2],
      k === 1 || k === 2 ? w : 0, k >= 2 ? h : 0, mat, seed, levels, flags, h, 255));
    mesh.quad(ids[3], ids[2], ids[1], ids[0]);
  }
}

export function cylinder(mesh, cx, cy, cz, rBottom, rTop, h, segments, mat, opts = {}) {
  const seed = opts.seed || 0;
  const flags = opts.flags || 0;
  const capTop = opts.capTop !== false;
  const circ = TAU * Math.max(rBottom, rTop);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * TAU, a1 = ((i + 1) / segments) * TAU;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const slope = (rBottom - rTop) / Math.max(0.001, h);
    const ny = slope / Math.hypot(1, slope);
    const nf = 1 / Math.hypot(1, slope);
    const p0 = [cx + c0 * rBottom, cy, cz + s0 * rBottom];
    const p1 = [cx + c1 * rBottom, cy, cz + s1 * rBottom];
    const p2 = [cx + c1 * rTop, cy + h, cz + s1 * rTop];
    const p3 = [cx + c0 * rTop, cy + h, cz + s0 * rTop];
    const u0 = (i / segments) * circ, u1 = ((i + 1) / segments) * circ;
    const v0 = mesh.vertex(p0[0], p0[1], p0[2], c0 * nf, ny, s0 * nf, u0, 0, mat, seed, 0, flags, h, 255);
    const v1 = mesh.vertex(p1[0], p1[1], p1[2], c1 * nf, ny, s1 * nf, u1, 0, mat, seed, 0, flags, h, 255);
    const v2 = mesh.vertex(p2[0], p2[1], p2[2], c1 * nf, ny, s1 * nf, u1, h, mat, seed, 0, flags, h, 255);
    const v3 = mesh.vertex(p3[0], p3[1], p3[2], c0 * nf, ny, s0 * nf, u0, h, mat, seed, 0, flags, h, 255);
    mesh.quad(v3, v2, v1, v0);
  }
  if (capTop && rTop > 0.01) {
    const centre = mesh.vertex(cx, cy + h, cz, 0, 1, 0, cx, cz, mat, seed, 0, flags, 0, 255);
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * TAU, a1 = ((i + 1) / segments) * TAU;
      const va = mesh.vertex(cx + Math.cos(a0) * rTop, cy + h, cz + Math.sin(a0) * rTop, 0, 1, 0, 0, 0, mat, seed, 0, flags, 0, 255);
      const vb = mesh.vertex(cx + Math.cos(a1) * rTop, cy + h, cz + Math.sin(a1) * rTop, 0, 1, 0, 0, 0, mat, seed, 0, flags, 0, 255);
      mesh.tri(centre, vb, va);
    }
  }
}

/** A dome. `ratio` under 1 flattens it, over 1 makes it an onion. */
export function dome(mesh, cx, cy, cz, radius, height, segments, rings, mat, opts = {}) {
  const seed = opts.seed || 0;
  const flags = opts.flags || 0;
  const onion = opts.onion || 0;
  const at = (i, j) => {
    const phi = (j / rings) * (Math.PI / 2);
    let r = Math.cos(phi);
    const yy = Math.sin(phi);
    if (onion > 0) r *= 1 + onion * Math.sin(phi * 2) * (1 - yy);
    const th = (i / segments) * TAU;
    return [cx + Math.cos(th) * radius * r, cy + yy * height, cz + Math.sin(th) * radius * r];
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const p0 = at(i, j), p1 = at(i + 1, j), p2 = at(i + 1, j + 1), p3 = at(i, j + 1);
      const n0 = radialNormal(p0, cx, cy, cz, radius, height);
      const n1 = radialNormal(p1, cx, cy, cz, radius, height);
      const n2 = radialNormal(p2, cx, cy, cz, radius, height);
      const n3 = radialNormal(p3, cx, cy, cz, radius, height);
      const v0 = mesh.vertex(p0[0], p0[1], p0[2], n0[0], n0[1], n0[2], i, j, mat, seed, 0, flags, 0, 255);
      const v1 = mesh.vertex(p1[0], p1[1], p1[2], n1[0], n1[1], n1[2], i + 1, j, mat, seed, 0, flags, 0, 255);
      const v2 = mesh.vertex(p2[0], p2[1], p2[2], n2[0], n2[1], n2[2], i + 1, j + 1, mat, seed, 0, flags, 0, 255);
      const v3 = mesh.vertex(p3[0], p3[1], p3[2], n3[0], n3[1], n3[2], i, j + 1, mat, seed, 0, flags, 0, 255);
      if (j === rings - 1) mesh.tri(v3, v1, v0);
      else mesh.quad(v3, v2, v1, v0);
    }
  }
}

function radialNormal(p, cx, cy, cz, radius, height) {
  const dx = (p[0] - cx) / radius;
  const dy = (p[1] - cy) / height;
  const dz = (p[2] - cz) / radius;
  const l = Math.hypot(dx, dy, dz) || 1;
  return [dx / l, dy / l, dz / l];
}

export function sphere(mesh, cx, cy, cz, radius, segments, rings, mat, opts = {}) {
  const seed = opts.seed || 0;
  const flags = opts.flags || 0;
  const at = (i, j) => {
    const phi = (j / rings) * Math.PI - Math.PI / 2;
    const th = (i / segments) * TAU;
    return [
      cx + Math.cos(phi) * Math.cos(th) * radius,
      cy + Math.sin(phi) * radius,
      cz + Math.cos(phi) * Math.sin(th) * radius,
    ];
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const ps = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      const ids = ps.map((p, k) => {
        const n = [(p[0] - cx) / radius, (p[1] - cy) / radius, (p[2] - cz) / radius];
        return mesh.vertex(p[0], p[1], p[2], n[0], n[1], n[2], (k === 1 || k === 2) ? i + 1 : i, (k >= 2) ? j + 1 : j, mat, seed, 0, flags, 0, 255);
      });
      mesh.quad(ids[3], ids[2], ids[1], ids[0]);
    }
  }
}

/** A pyramid or spire on a square base. */
export function spire(mesh, cx, cy, cz, w, h, mat, opts = {}) {
  const hw = w / 2;
  const seed = opts.seed || 0;
  const flags = opts.flags || 0;
  const rot = opts.rot || 0;
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (u, v) => [cx + u * c - v * s, cy, cz + u * s + v * c];
  const corners = [P(-hw, -hw), P(hw, -hw), P(hw, hw), P(-hw, hw)];
  const apex = [cx, cy + h, cz];
  const ref = [cx, cy - Math.max(1, h * 0.5), cz];
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    emitFace(mesh, [a, b, apex], [[0, 0], [w, 0], [w / 2, h]], mat, seed, flags, ref);
  }
}

/** A row of columns along a line, used for the Gate and the porticos. */
export function colonnade(mesh, baseY, x0, z0, x1, z1, count, radius, height, mat, seed) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    box(mesh, x, baseY - 0.45, z, radius * 2.9, 0.5, radius * 2.9, mat, { seed });
    cylinder(mesh, x, baseY, z, radius, radius * 0.86, height, 10, mat, { seed, capTop: false });
    box(mesh, x, baseY + height, z, radius * 2.6, radius * 0.55, radius * 2.6, mat, { seed });
  }
}
