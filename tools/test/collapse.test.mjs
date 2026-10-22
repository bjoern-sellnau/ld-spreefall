// A roof over the inside of a building has nothing under it once the
// column it stands in starts to go: it comes down to the heap rather than
// hanging at that column's height.

import test from 'node:test';
import assert from 'node:assert/strict';

import { settle, collapseBite, columnHash, columnShare, collapseLocal } from '../../src/game/bake.js';

const site = { x: 0, y: 0, z: 0, radius: 40, level: 0.3, rubble: 1.5, craterRadius: 0, depth: 0 };

test('a roof in a column that has started to go lands on the heap; the wall beside it keeps its cut', () => {
  let roofs = 0, worst = 0;
  for (let i = 0; i < 400; i++) {
    const x = ((i * 7.3) % 60) - 30, z = ((i * 11.9) % 60) - 30;
    // Twenty metres up: a flat roof, and a wall at the same height.
    const roof = { x, y: 20, z };
    const wall = { x, y: 20, z };
    settle(roof, false, 20, site, 1);
    settle(wall, false, 20, site, 0);
    if (wall.y === 20) continue;            // this column did not go at all
    roofs++;
    // The wall stops where its column was cut back to, and the roof goes
    // under that, onto the heap: never more than the heap and a metre up.
    assert.ok(roof.y <= wall.y + 1e-9, `roof ${roof.y} above the wall ${wall.y}`);
    worst = Math.max(worst, roof.y);
  }
  assert.ok(roofs > 20, `${roofs} columns went`);
  assert.ok(worst <= site.rubble * 1.1 + 1.01, `the highest roof left is ${worst} m up`);
});

test('a roof outside the site is not touched', () => {
  const far = { x: 200, y: 20, z: 0 };
  settle(far, false, 20, site, 1);
  assert.equal(far.y, 20);
  // And the helpers it is built on agree that it is out of reach.
  assert.equal(collapseBite(200, 0, site), 0);
  assert.ok(Number.isFinite(columnShare(0.5, columnHash(1, 1))) && collapseLocal(0, 1) === 0);
});
