// A band round a building (the cornice, the string course) stands proud of
// its wall but never over a collapse column line from it, so it comes down
// with its wall instead of being left hanging in the air.

import test from 'node:test';
import assert from 'node:assert/strict';

import { facadeBand, inColumn } from '../geometry.mjs';

const cell = (v) => Math.floor(v / 4);

function recorder() {
  const verts = [];
  return {
    verts,
    vertex(x, y, z) { verts.push([x, y, z]); return verts.length - 1; },
    quad() {}, tri() {},
  };
}

test('a point is moved out only as far as its own column goes', () => {
  assert.equal(inColumn(1, 1, 0, 1, 0.26), 0.26);
  assert.ok(Math.abs(inColumn(0, 3.9, 0, 1, 0.26) - 0.09) < 1e-9);
  assert.equal(inColumn(0, 4, 0, -1, 0.26), 0);
});

test('every corner of a band is in the column of the wall behind it', () => {
  let checked = 0;
  for (let k = 0; k < 400; k++) {
    // A box of a building at a random place and turn, so its walls fall
    // every way across the column lines.
    const cx = Math.random() * 300 - 150, cz = Math.random() * 300 - 150;
    const w = 6 + Math.random() * 20, d = 6 + Math.random() * 20, a = Math.random() * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    const P = (u, v) => [cx + c * u - s * v, cz + s * u + c * v];
    const ring = [P(-w, -d), P(w, -d), P(w, d), P(-w, d)];
    const m = recorder();
    facadeBand(m, ring, 10, 0.5, 0.26, 0, 0, 20);
    // Four face corners then four underside corners an edge: the face ones
    // and the outer underside ones stand off the wall corner they belong to.
    for (let e = 0, i = 0; e < ring.length; e++) {
      const A = ring[e], B = ring[(e + 1) % ring.length];
      if (Math.hypot(B[0] - A[0], B[1] - A[1]) < 3.5) continue;
      const vs = m.verts.slice(i, i + 8);
      i += 8;
      for (const [v, wall] of [[vs[0], A], [vs[1], B], [vs[2], B], [vs[3], A], [vs[6], B], [vs[7], A]]) {
        assert.equal(cell(v[0]), cell(wall[0]));
        assert.equal(cell(v[2]), cell(wall[1]));
        checked++;
      }
    }
  }
  assert.ok(checked > 1000);
});
