// Water from OpenStreetMap: a canal cut into pieces is one ring once its
// pieces are put end to end, and a river with only its line still has water.

import test from 'node:test';
import assert from 'node:assert/strict';

import { joinRings, centrelineWater, CENTRELINE_WIDTH } from '../build-world.mjs';

test('the pieces of a multipolygon are joined end to end into closed rings, in any order and direction', () => {
  // A long thin canal outline cut into three open ways, one of them drawn
  // the other way round, and a closed island on its own.
  const rings = joinRings([
    [1, 2, 3],
    [5, 4, 3],       // reversed
    [5, 6, 1],
    [10, 11, 12, 10],
  ]);
  assert.equal(rings.length, 2);
  const canal = rings.find((r) => r.includes(1));
  assert.deepEqual([...canal].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(canal).size, canal.length, 'no node twice');
  assert.deepEqual(rings.find((r) => r.includes(10)), [10, 11, 12]);
});

test('a chain that never closes is left out rather than closed across whatever is between', () => {
  assert.deepEqual(joinRings([[1, 2, 3], [3, 4, 5]]), []);
});

test('a canal with only its line gets water its width along it, but not where a water area already is', () => {
  const line = [[0, 0], [100, 0], [200, 0], [300, 0]];
  // An area over the middle stretch.
  const area = { ring: [[90, -15], [210, -15], [210, 15], [90, 15]] };
  const out = centrelineWater([{ line, tags: { waterway: 'canal' } }], [area]);
  // The first stretch and the last, not the middle one.
  assert.equal(out.length, 2);
  const zs = out[0].ring.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...zs) - CENTRELINE_WIDTH.canal / 2) < 1e-6);
  // The width tag wins when there is one.
  const wide = centrelineWater([{ line, tags: { waterway: 'river', width: '44' } }], []);
  assert.equal(wide.length, 1);
  assert.ok(Math.abs(Math.max(...wide[0].ring.map((p) => p[1])) - 22) < 1e-6);
});
