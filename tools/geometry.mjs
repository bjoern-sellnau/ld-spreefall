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

  const shape = o.roofShape || 'flat';
  const rh = o.roofHeight || 0;
  if (shape === 'gabled' && rh > 0.2) {
    gabledRoof(mesh, rings[0], wallTop, rh, roofMat, seed);
  } else if (shape === 'hipped' && rh > 0.2) {
    hippedRoof(mesh, rings[0], wallTop, rh, roofMat, seed);
  } else if (shape === 'dome') {
    flatRoof(mesh, rings, wallTop, roofMat, seed);
  } else {
    flatRoof(mesh, rings, wallTop, roofMat, seed);
    if (o.parapet !== false && o.height > 6) parapet(mesh, rings[0], wallTop, 0.7, wallMat, seed, hgt);
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
function gabledRoof(mesh, ring, y, rh, mat, seed) {
  const b = orientedBox(ring);
  if (ringArea(ring) < b.lu * b.lv * 0.78) { flatRoof(mesh, [ring], y, mat, seed); return; }
  const long = b.lu >= b.lv;
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

function hippedRoof(mesh, ring, y, rh, mat, seed) {
  const b = orientedBox(ring);
  if (ringArea(ring) < b.lu * b.lv * 0.78) { flatRoof(mesh, [ring], y, mat, seed); return; }
  const hu = b.lu / 2, hv = b.lv / 2;
  const inset = Math.min(hu, hv) * 0.62;
  const long = b.lu >= b.lv;
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

// ---------------------------------------------------------------------------
// Ribbons, for roads, pavements and rails

/**
 * Build a flat strip along a centreline. u runs across the strip in metres from
 * the centre, v runs along it in metres, which is what the lane marking shader
 * wants. yAt(x, z) supplies the ground height.
 */
export function ribbon(mesh, line, half, mat, yAt, opts = {}) {
  if (line.length < 2) return;
  const lift = opts.lift || 0;
  const flags = opts.flags || 0;
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

/** A polygon area laid on the ground, uv in world metres. */
export function groundPolygon(mesh, outer, holes, mat, yAt, opts = {}) {
  const { verts, indices } = triangulate(outer, holes || []);
  if (!indices.length) return;
  const lift = opts.lift || 0;
  const flags = opts.flags || 0;
  const map = verts.map((p) => mesh.vertex(p[0], yAt(p[0], p[1]) + lift, p[1], 0, 1, 0, p[0], p[1], mat, opts.seed || 0, 0, flags, 0, 255));
  for (let i = 0; i < indices.length; i += 3) {
    mesh.tri(map[indices[i]], map[indices[i + 2]], map[indices[i + 1]]);
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
