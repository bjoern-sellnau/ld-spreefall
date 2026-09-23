// The generated actor meshes. The pipeline had every wall wound against its own
// normals once already; this is the same check for the runtime geometry, where
// the failure is silent because back face culling simply deletes the model.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDroneMesh, buildWeaponMesh } from '../../src/render/actors.js';

function audit(build) {
  const v = build.v;
  const idx = build.i;
  let bad = 0, checked = 0, degenerate = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const p = [];
    const n = [];
    for (let k = 0; k < 3; k++) {
      const o = idx[t + k] * 8;
      p.push([v[o], v[o + 1], v[o + 2]]);
      n.push([v[o + 3], v[o + 4], v[o + 5]]);
    }
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
    const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const glen = Math.hypot(gx, gy, gz);
    if (glen < 1e-10) { degenerate++; continue; }
    const nx = (n[0][0] + n[1][0] + n[2][0]) / 3;
    const ny = (n[0][1] + n[1][1] + n[2][1]) / 3;
    const nz = (n[0][2] + n[1][2] + n[2][2]) / 3;
    const nlen = Math.hypot(nx, ny, nz);
    if (nlen < 1e-6) continue;
    checked++;
    if ((gx * nx + gy * ny + gz * nz) / (glen * nlen) < 0) bad++;
  }
  return { bad, checked, degenerate, tris: idx.length / 3 };
}

function bounds(build) {
  const b = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minZ: 1e9, maxZ: -1e9 };
  for (let o = 0; o < build.v.length; o += 8) {
    b.minX = Math.min(b.minX, build.v[o]); b.maxX = Math.max(b.maxX, build.v[o]);
    b.minY = Math.min(b.minY, build.v[o + 1]); b.maxY = Math.max(b.maxY, build.v[o + 1]);
    b.minZ = Math.min(b.minZ, build.v[o + 2]); b.maxZ = Math.max(b.maxZ, build.v[o + 2]);
  }
  return b;
}

test('the drone mesh is wound to face outwards', () => {
  const r = audit(buildDroneMesh());
  assert.ok(r.tris > 100, `the drone has geometry, got ${r.tris} triangles`);
  assert.ok(r.checked > 0);
  assert.equal(r.bad, 0, `${r.bad} of ${r.checked} drone triangles face inwards`);
});

test('the weapon mesh is wound to face outwards', () => {
  const r = audit(buildWeaponMesh());
  assert.ok(r.tris > 60, `the weapon has geometry, got ${r.tris} triangles`);
  assert.equal(r.bad, 0, `${r.bad} of ${r.checked} weapon triangles face inwards`);
});

test('the drone is about the size of a drone', () => {
  const b = bounds(buildDroneMesh());
  const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
  assert.ok(w > 1.4 && w < 2.6, `span ${w.toFixed(2)} m across`);
  assert.ok(d > 1.4 && d < 2.6, `span ${d.toFixed(2)} m deep`);
  assert.ok(h > 0.2 && h < 1.0, `${h.toFixed(2)} m tall`);
});

test('the weapon sits in front of the eye and points down negative z', () => {
  const b = bounds(buildWeaponMesh());
  // The eye is the origin, so nothing may be behind it or it clips the near plane.
  assert.ok(b.maxZ < -0.05, `nearest part at z ${b.maxZ.toFixed(3)}, it must be in front of the eye`);
  assert.ok(b.minZ > -1.3, `muzzle at z ${b.minZ.toFixed(3)}, that is too far away`);
  const length = b.maxZ - b.minZ;
  assert.ok(length > 0.6 && length < 1.2, `${length.toFixed(2)} m long, which is not a rifle`);
});
