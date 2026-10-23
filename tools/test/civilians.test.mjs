// Somebody who lives here walks in from the next street; only what arrives
// comes through a sphere of light, and only that sends the street running.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Soldiers } from '../../src/game/soldiers.js';

const flat = {
  minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000,
  groundHeight: () => 0, raycast: () => null, lineOfSight: () => true, isLoaded: () => true,
};

test('a passer by appears without the sphere, and frightens nobody', () => {
  const soldiers = new Soldiers(flat, () => false);
  let spheres = 0;
  soldiers.onArrive = () => { spheres++; };
  const first = soldiers.spawnCivilianNear(0, 0, 10, 20);
  assert.ok(first && first.civilian);
  for (let k = 0; k < 10; k++) soldiers.spawnCivilianNear(0, 0, 10, 20);
  assert.equal(spheres, 0, 'no sphere for anybody who lives here');
  assert.equal(first.panicLeft, 0, 'and nobody runs from one');
  // A soldier still arrives the way he always did.
  soldiers.spawnNear(0, 0, 10, 20);
  assert.equal(spheres, 1);
});
