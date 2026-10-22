// Help that drives in: the way it finds over the streets, and the hands on
// the wheel that keep it on that way.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CONVOY, planRoute, follow, onRoad, headingTo, wrap } from '../../src/game/convoy.js';

// Two streets in an L round a block: along z = 0 from x = 0 to 200, then up
// x = 200 to z = 200. The block in the corner between them is solid.
const lines = [
  { cls: 'secondary', w: 10, pts: [0, 0, 200, 0] },
  { cls: 'secondary', w: 10, pts: [200, 0, 200, 200] },
  { cls: 'footway', w: 3, pts: [0, 0, 200, 200] },
];
const block = [[20, 20, 180, 20], [180, 20, 180, 180], [180, 180, 20, 180], [20, 180, 20, 20]];
const walls = (minX, minZ, maxX, maxZ, fn) => { for (const w of block) fn(...w); };

test('a point is on a carriageway, and a footway is not one', () => {
  assert.ok(onRoad(lines, 100, 3));
  assert.ok(!onRoad(lines, 100, 12));
  assert.ok(!onRoad(lines, 100, 100), 'the footpath across the block does not count');
});

test('the way round keeps to the streets rather than through the block', () => {
  const path = planRoute({ lines, walls, fromX: 5, fromZ: 0, toX: 200, toZ: 195 });
  assert.ok(path, 'there is a way');
  assert.deepEqual(path[0], { x: 5, z: 0 });
  assert.deepEqual(path[path.length - 1], { x: 200, z: 195 });
  assert.ok(path.road > 0.85, `${Math.round(path.road * 100)}% of it on a street`);
  // Nothing on the way is inside the block.
  const inside = path.filter((p) => p.x > 24 && p.x < 176 && p.z > 24 && p.z < 176);
  assert.equal(inside.length, 0, `${inside.length} points inside the block`);
});

test('with no street at all, it still finds a way over open ground', () => {
  const path = planRoute({ lines: [], fromX: 0, fromZ: 0, toX: 60, toZ: 40 });
  assert.ok(path && path.length >= 2);
  assert.equal(path.road, 0);
});

test('the headings agree with how a hull points: nose along -z at nought', () => {
  assert.ok(Math.abs(headingTo(0, -1)) < 1e-9);
  assert.ok(Math.abs(headingTo(-1, 0) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(wrap(3 * Math.PI) - Math.PI) < 1e-9);
});

test('a jeep that follows its hands gets round the corner and stops short of the goal', () => {
  const path = planRoute({ lines, walls, fromX: 5, fromZ: 0, toX: 200, toZ: 195 });
  // The same arithmetic as the vehicle's own drive, without the walls.
  const v = { x: 5, z: 0, yaw: headingTo(1, 0), speed: 0 };
  const run = { path, at: 0, stuck: 0, backing: 0 };
  const goal = { x: 200, z: 195 };
  const spec = CONVOY.jeep;
  let there = false, worst = 0;
  for (let i = 0; i < 60 * 60 && !there; i++) {
    const dt = 1 / 60;
    const c = follow(v, run, spec, goal, dt);
    there = c.there;
    if (c.throttle > 0) v.speed += 24 * dt;
    else if (c.throttle < 0) v.speed -= 24 * 0.7 * dt;
    if (c.brake) v.speed -= Math.sign(v.speed) * 30 * dt;
    v.speed -= v.speed * 0.42 * dt;
    const grip = 1 - Math.min(1, Math.abs(v.speed) / 38) * 0.6;
    v.yaw += c.steer * 1.9 * grip * Math.min(1, Math.abs(v.speed) / 3) * dt * Math.sign(v.speed || 1);
    v.x += -Math.sin(v.yaw) * v.speed * dt;
    v.z += -Math.cos(v.yaw) * v.speed * dt;
    // How far off the two streets it ever wandered.
    const off = Math.min(Math.abs(v.z), Math.abs(v.x - 200));
    worst = Math.max(worst, off);
  }
  assert.ok(there, `stopped at ${Math.round(v.x)}, ${Math.round(v.z)}`);
  const d = Math.hypot(goal.x - v.x, goal.z - v.z);
  assert.ok(d <= spec.stop + 4 && d >= spec.stop - 12, `${d.toFixed(1)} m short of it`);
  assert.ok(worst < 14, `wandered ${worst.toFixed(1)} m off the street`);
});

test('stuck against something, it backs off and tries again', () => {
  const v = { x: 0, z: 0, yaw: 0, speed: 0 };
  const run = { path: [{ x: 0, z: -100 }], at: 0, stuck: 0, backing: 0 };
  let backed = false;
  for (let i = 0; i < 60 * 3; i++) {
    const c = follow(v, run, CONVOY.jeep, { x: 0, z: -100 }, 1 / 60);
    if (c.throttle < 0) backed = true;
  }
  assert.ok(backed);
});
