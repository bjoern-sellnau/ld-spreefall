// Ear clipping triangulation with hole support, written from scratch.
//
// Outer ring plus holes are merged into one simple polygon first, using the
// bridge construction from David Eberly, "Triangulation by Ear Clipping",
// Geometric Tools (2002), section 3: for each hole take its vertex M of maximum
// x, cast a ray in +x, find the closest visible outer vertex P, and splice the
// hole into the outer ring with a doubled bridge edge M-P. Repeat for every
// hole, processing holes right to left so an already inserted bridge is a
// candidate for the next hole.
//
// The ear test itself is the classic O(n^2) sweep: a vertex is an ear when it is
// convex and no reflex vertex of the polygon lies inside its triangle.

const EPS = 1e-9;

function area2(ax, az, bx, bz, cx, cz) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

/** Signed area of a ring, positive when counter clockwise in x/z with z down. */
export function signedArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return s / 2;
}

function pointInTriangle(px, pz, ax, az, bx, bz, cx, cz) {
  const d1 = area2(ax, az, bx, bz, px, pz);
  const d2 = area2(bx, bz, cx, cz, px, pz);
  const d3 = area2(cx, cz, ax, az, px, pz);
  const hasNeg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const hasPos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(hasNeg && hasPos);
}

function dedupe(ring) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-7 || Math.abs(last[1] - p[1]) > 1e-7) out.push([p[0], p[1]]);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7) out.pop();
    else break;
  }
  return out;
}

function segmentsIntersect(a, b, c, d) {
  const d1 = area2(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d2 = area2(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = area2(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = area2(a[0], a[1], b[0], b[1], d[0], d[1]);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
         ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

// Bridge one hole into the outer ring. Both arrays are plain [x, z] lists.
function spliceHole(outer, hole) {
  // M: hole vertex with the largest x.
  let mi = 0;
  for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[mi][0]) mi = i;
  const M = hole[mi];

  // Cast +x from M, find the closest crossing on an outer edge.
  let bestT = Infinity, bestEdge = -1, hitX = 0, hitZ = M[1];
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const p = outer[j], q = outer[i];
    if ((p[1] > M[1]) === (q[1] > M[1])) continue;
    const t = (M[1] - p[1]) / (q[1] - p[1]);
    const x = p[0] + t * (q[0] - p[0]);
    if (x >= M[0] - EPS && x - M[0] < bestT) { bestT = x - M[0]; bestEdge = j; hitX = x; }
  }
  if (bestEdge < 0) {
    // Degenerate input, fall back to the rightmost outer vertex.
    let k = 0;
    for (let i = 1; i < outer.length; i++) if (outer[i][0] > outer[k][0]) k = i;
    bestEdge = k; hitX = outer[k][0];
  }

  // P: the endpoint of that edge with the larger x, then refine to the closest
  // reflex vertex inside the triangle M, I, P as Eberly prescribes.
  const e0 = outer[bestEdge], e1 = outer[(bestEdge + 1) % outer.length];
  let pIdx = e0[0] > e1[0] ? bestEdge : (bestEdge + 1) % outer.length;
  const I = [hitX, hitZ];

  let bestAngle = Infinity;
  for (let i = 0; i < outer.length; i++) {
    const v = outer[i];
    if (v[0] < M[0]) continue;
    if (!pointInTriangle(v[0], v[1], M[0], M[1], I[0], I[1], outer[pIdx][0], outer[pIdx][1])) continue;
    const dx = v[0] - M[0], dz = v[1] - M[1];
    const ang = Math.abs(dz) / Math.max(EPS, Math.hypot(dx, dz));
    if (ang < bestAngle) { bestAngle = ang; pIdx = i; }
  }

  // Guard: the bridge must not cross an outer edge.
  const P = outer[pIdx];
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    if (j === pIdx || i === pIdx) continue;
    if (segmentsIntersect(M, P, outer[j], outer[i])) {
      // Try any other visible vertex.
      let alt = -1;
      for (let k = 0; k < outer.length && alt < 0; k++) {
        let ok = true;
        for (let b = 0, a = outer.length - 1; b < outer.length && ok; a = b++) {
          if (a === k || b === k) continue;
          if (segmentsIntersect(M, outer[k], outer[a], outer[b])) ok = false;
        }
        if (ok) alt = k;
      }
      if (alt >= 0) pIdx = alt;
      break;
    }
  }

  const merged = outer.slice(0, pIdx + 1);
  for (let k = 0; k < hole.length; k++) merged.push(hole[(mi + k) % hole.length]);
  merged.push(hole[mi].slice());
  merged.push(outer[pIdx].slice());
  for (let k = pIdx + 1; k < outer.length; k++) merged.push(outer[k]);
  return merged;
}

/**
 * Triangulate a polygon with optional holes.
 * @param {[number,number][]} outerRing
 * @param {[number,number][][]} holes
 * @returns {{verts: [number,number][], indices: number[]}} indices are counter
 *          clockwise triples into verts, which is the merged ring.
 */
export function triangulate(outerRing, holes = []) {
  let outer = dedupe(outerRing);
  if (outer.length < 3) return { verts: [], indices: [] };
  // Normalise winding: outer counter clockwise in our x/z sense.
  if (signedArea(outer) < 0) outer.reverse();

  const prepared = [];
  for (const h of holes) {
    const hh = dedupe(h);
    if (hh.length < 3) continue;
    if (signedArea(hh) > 0) hh.reverse();   // holes wound the other way
    prepared.push(hh);
  }
  // Right to left, so the bridges we add are available to later holes.
  prepared.sort((a, b) => {
    const ax = Math.max(...a.map((p) => p[0]));
    const bx = Math.max(...b.map((p) => p[0]));
    return bx - ax;
  });
  for (const h of prepared) outer = spliceHole(outer, h);

  const verts = outer;
  const n = verts.length;
  const indices = [];
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;

  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7;

  let guard = 0;
  while (idx.length > 3 && guard < n * n + 64) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = verts[i0], b = verts[i1], c = verts[i2];
      if (area2(a[0], a[1], b[0], b[1], c[0], c[1]) <= EPS) continue;   // reflex or flat
      let ear = true;
      for (let k = 0; k < idx.length && ear; k++) {
        const j = idx[k];
        if (j === i0 || j === i1 || j === i2) continue;
        const p = verts[j];
        // Bridged holes leave duplicated vertices behind. A point sitting exactly
        // on a corner of the candidate ear never blocks it.
        if (same(p, a) || same(p, b) || same(p, c)) continue;
        // Only a reflex vertex can poke into an ear, so skip the convex ones.
        const pv = verts[idx[(k + idx.length - 1) % idx.length]];
        const nv = verts[idx[(k + 1) % idx.length]];
        if (area2(pv[0], pv[1], p[0], p[1], nv[0], nv[1]) > EPS) continue;
        if (pointInTriangle(p[0], p[1], a[0], a[1], b[0], b[1], c[0], c[1])) ear = false;
      }
      if (!ear) continue;
      indices.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Self intersecting or fully degenerate remainder: clip the sharpest
      // corner anyway so the caller still gets a closed surface.
      let best = 0, bestA = -Infinity;
      for (let i = 0; i < idx.length; i++) {
        const a = verts[idx[(i + idx.length - 1) % idx.length]];
        const b = verts[idx[i]];
        const c = verts[idx[(i + 1) % idx.length]];
        const s = area2(a[0], a[1], b[0], b[1], c[0], c[1]);
        if (s > bestA) { bestA = s; best = i; }
      }
      const i0 = idx[(best + idx.length - 1) % idx.length];
      const i1 = idx[best];
      const i2 = idx[(best + 1) % idx.length];
      if (bestA > EPS) indices.push(i0, i1, i2);
      idx.splice(best, 1);
    }
    guard++;
  }
  if (idx.length === 3) indices.push(idx[0], idx[1], idx[2]);
  return { verts, indices };
}
