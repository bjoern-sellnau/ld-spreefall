// The cockpit's arithmetic: where something is on a radar that turns with
// you, and where a point lands on the screen.

import test from 'node:test';
import assert from 'node:assert/strict';

import { radarSpot, project, COCKPIT } from '../../src/ui/cockpit.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('straight ahead is straight up the radar, whichever way you face', () => {
  for (const h of [0, 1, -2.4, Math.PI]) {
    const fx = -Math.sin(h), fz = -Math.cos(h);
    const p = radarSpot(fx * 100, fz * 100, h);
    assert.ok(near(p.x, 0) && near(p.y, -100 / COCKPIT.radarRange), `${h}: ${p.x}, ${p.y}`);
  }
});

test('to your right is to the right of the middle', () => {
  // Facing north (-z) the right hand is east (+x); facing west it is north.
  assert.ok(radarSpot(50, 0, 0).x > 0);
  assert.ok(near(radarSpot(50, 0, 0).y, 0));
  assert.ok(radarSpot(0, -50, Math.PI / 2).x > 0);
  assert.ok(radarSpot(0, 50, Math.PI / 2).x < 0);
  assert.ok(radarSpot(0, 50, 0).y > 0, 'behind you is below the middle');
});

test('a point in front of an identity camera lands where clip space says, and behind it nowhere', () => {
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const p = project(id, 0.5, 0.5, 0, 200, 100);
  assert.deepEqual(p, { x: 150, y: 25 });
  const back = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0];
  assert.equal(project(back, 0, 0, 1, 200, 100), null);
});
