// Traffic: the lane, the next road at a junction, and a driver that keeps
// its distance and goes round the corner.

import test from 'node:test';
import assert from 'node:assert/strict';

import { TRAFFIC, roadIndex, aimPoint, nextLeg, pickSpawn, drive, laneOffset } from '../../src/game/traffic.js';

// An L: east along z = 0 from x = 0 to 200, then north (-z) from there.
const line = (cls, from, to, step = 20) => {
  const pts = [];
  const n = Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / step);
  for (let k = 0; k <= n; k++) pts.push(from[0] + (to[0] - from[0]) * k / n, from[1] + (to[1] - from[1]) * k / n);
  return { cls, w: 8, pts };
};
const LINES = [
  line('secondary', [0, 0], [200, 0]),
  line('residential', [200, 0], [200, -200]),
  line('footway', [0, 10], [200, 10]),
];

/** A vehicle reduced to what a driver moves. */
function car(at) {
  return { type: 'car', spec: { length: 4.5 }, x: at.x, z: at.z, yaw: at.yaw, speed: 0, traffic: { li: at.li, i: at.i, dir: at.dir } };
}
function step(v, c, dt) {
  if (c.throttle > 0) v.speed += 14 * dt;
  if (c.brake) v.speed = Math.max(0, v.speed - 26 * dt);
  v.speed -= v.speed * 0.4 * dt;
  v.yaw += c.steer * 1.7 * dt * Math.min(1, v.speed / 3);
  v.x += -Math.sin(v.yaw) * v.speed * dt;
  v.z += -Math.cos(v.yaw) * v.speed * dt;
}

test('only carriageways are driven, and every end is indexed', () => {
  const idx = roadIndex(LINES);
  assert.equal(idx.roads.length, 2);
  let ends = 0;
  for (const cell of idx.ends.values()) ends += cell.length;
  assert.equal(ends, 4);
});

test('the lane is right of the line in the direction of travel', () => {
  const idx = roadIndex(LINES);
  const road = idx.roads[0];
  const east = aimPoint(road, { i: 1, dir: 1 }, { x: 0, z: 0 });
  assert.ok(east.z > 0, `going east the lane is south of the line, z ${east.z}`);
  assert.ok(Math.abs(east.z - laneOffset(road)) < 1e-6);
  const west = aimPoint(road, { i: road.n - 2, dir: -1 }, { x: 200, z: 0 });
  assert.ok(west.z < 0, `going west it is north, z ${west.z}`);
});

test('at the end of a road it takes the one that begins there, and turns round where none does', () => {
  const idx = roadIndex(LINES);
  const n = nextLeg(idx, 0, 1, () => 0);
  assert.deepEqual([n.li, n.dir], [1, 1]);
  const back = nextLeg(idx, 0, -1);
  assert.deepEqual([back.li, back.dir], [0, 1]);
});

test('one that knows where it is going keeps straight on, whatever the dice say', () => {
  // A crossing at x = 200: the road in from the west ends there, and one goes
  // on east, one north and one south.
  const idx = roadIndex([
    line('secondary', [0, 0], [200, 0]),
    line('secondary', [200, 0], [400, 0]),
    line('secondary', [200, 0], [200, -200]),
    line('secondary', [200, 0], [200, 200]),
  ]);
  const east = { x: 1, z: 0 };
  for (const roll of [0, 0.4, 0.7, 0.99]) {
    const n = nextLeg(idx, 0, 1, () => roll, east);
    assert.equal(n.li, 1, `rolled ${roll}, took ${n.li}`);
  }
  // And it is the dice without one: not always the same way.
  const ways = new Set([0, 0.4, 0.7, 0.99].map((roll) => nextLeg(idx, 0, 1, () => roll).li));
  assert.ok(ways.size > 1, `only ever ${[...ways]}`);
});

test('a car drives the road in its lane and goes round the corner onto the next', () => {
  const idx = roadIndex(LINES);
  const v = car({ x: 10, z: laneOffset(idx.roads[0]), yaw: Math.atan2(-1, 0), li: 0, i: 1, dir: 1 });
  let worst = 0, sawFast = 0;
  for (let k = 0; k < 60 * 26; k++) {
    step(v, drive(v, idx, [], 1 / 60), 1 / 60);
    sawFast = Math.max(sawFast, v.speed);
    if (v.traffic.li === 0 && v.x < 180) worst = Math.max(worst, Math.abs(v.z - laneOffset(idx.roads[0])));
  }
  assert.ok(sawFast > TRAFFIC.cruise.car - 1.5, `got to ${sawFast.toFixed(1)} m/s`);
  assert.ok(worst < 1.2, `${worst.toFixed(2)} m out of its lane`);
  assert.equal(v.traffic.li, 1, 'and is on the second road');
  assert.ok(v.z < -40, `and has gone up it, z ${v.z.toFixed(0)}`);
});

test('it waits for what is in its lane, and passes what is in the other one', () => {
  const idx = roadIndex(LINES);
  const v = car({ x: 20, z: 2.16, yaw: Math.atan2(-1, 0), li: 0, i: 2, dir: 1 });
  v.speed = 10;
  const inLane = drive(v, idx, [{ x: 30, z: 2.16, yaw: v.yaw }], 1 / 60);
  assert.ok(inLane.brake && inLane.throttle === 0, JSON.stringify(inLane));
  const oncoming = drive(v, idx, [{ x: 40, z: -2.16, yaw: v.yaw + Math.PI }], 1 / 60);
  assert.ok(!oncoming.brake, JSON.stringify(oncoming));
  const person = drive(v, idx, [{ x: 27, z: 2.4, r: 0.4 }], 1 / 60);
  assert.ok(person.brake, 'and for somebody standing in the road');
});

test('a stalled one stands, and a bus stops every so often', () => {
  const idx = roadIndex(LINES);
  const v = car({ x: 20, z: 2.16, yaw: Math.atan2(-1, 0), li: 0, i: 2, dir: 1 });
  v.traffic.stalled = 2;
  assert.deepEqual(drive(v, idx, [], 0.5), { throttle: 0, steer: 0, brake: true });
  const bus = car({ x: 10, z: 2.16, yaw: Math.atan2(-1, 0), li: 0, i: 1, dir: 1 });
  bus.type = 'bus';
  for (let k = 0; k < 60 * 70 && !bus.traffic.stops; k++) step(bus, drive(bus, idx, [], 1 / 60), 1 / 60);
  assert.equal(bus.traffic.stops, 1);
  assert.ok(bus.traffic.waiting > 0);
});

test('a new one is put on a carriageway in its lane, between near and far', () => {
  const idx = roadIndex(LINES);
  const at = pickSpawn(idx, 0, 0, { near: 60, far: 180 });
  assert.ok(at);
  const d = Math.hypot(at.x, at.z);
  assert.ok(d > 55 && d < 185, `${d.toFixed(0)} m`);
  assert.ok(Math.abs(Math.abs(at.z) - laneOffset(idx.roads[at.li])) < 1e-6 || at.li === 1);
});
