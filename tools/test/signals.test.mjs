// The lights: where they are, what they show and when, and what a driver
// does about them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SIGNALS, roadIndex, junctionsOf, mastsOf, lightAt, phaseOf, nearestLane, drive } from '../../src/game/traffic.js';

const line = (cls, from, to, step = 20, w = 10) => {
  const pts = [];
  const n = Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / step);
  for (let k = 0; k <= n; k++) pts.push(from[0] + (to[0] - from[0]) * k / n, from[1] + (to[1] - from[1]) * k / n);
  return { cls, w, pts };
};
// A cross: a secondary road east and west through (0, 0), a residential
// street north and south through it, simplified the way the map is (a line
// with no point at the crossing), and a T further along where a residential
// street ends on the secondary.
const LINES = [
  { cls: 'secondary', w: 12, pts: [-300, 0, 300, 0], n: 'Leipziger Strasse' },
  { cls: 'residential', w: 8, pts: [0, -200, 0, 200], n: 'Charlottenstrasse' },
  line('residential', [150, -150], [150, 0]),
  // Two quiet streets crossing get no lights.
  line('residential', [-250, -100], [-250, -300]),
  line('residential', [-350, -200], [-150, -200]),
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

test('lights where a bigger road meets another, crossing or ending, and not between two quiet streets', () => {
  const js = junctionsOf(roadIndex(LINES));
  assert.equal(js.length, 2, js.map((j) => `${j.x},${j.z}`).join(' '));
  const cross = js.find((j) => Math.hypot(j.x, j.z) < 3);
  const tee = js.find((j) => Math.hypot(j.x - 150, j.z) < 3);
  assert.ok(cross && tee);
  assert.equal(cross.legs.length, 4);
  assert.equal(tee.legs.length, 3);
  assert.deepEqual(cross.names.sort(), ['Charlottenstrasse', 'Leipziger Strasse']);
  // The axis is the wider road's: east and west are one direction, north and south the other.
  assert.equal(phaseOf(cross, -Math.PI / 2), phaseOf(cross, Math.PI / 2));
  assert.notEqual(phaseOf(cross, -Math.PI / 2), phaseOf(cross, 0));
  // A mast for every way in, on the right of whoever is coming, outside the junction.
  const masts = mastsOf(cross);
  assert.equal(masts.length, 4);
  for (const m of masts) assert.ok(Math.hypot(m.x - cross.x, m.z - cross.z) > cross.r);
});

test('the German order: red, red and amber, green, three seconds of amber, and never green both ways', () => {
  const j = { offset: 0, hack: null, dark: false };
  const seen = [];
  for (let t = 0; t < 30; t += 0.25) {
    const a = lightAt(j, 0, t), b = lightAt(j, 1, t);
    assert.ok(!(a === 'green' && b === 'green'), `both green at ${t}`);
    assert.ok(!(a === 'green' && b === 'redAmber') && !(b === 'green' && a === 'redAmber'), `one green while the other gets ready at ${t}`);
    if (seen[seen.length - 1] !== a) seen.push(a);
  }
  assert.deepEqual(seen, ['green', 'amber', 'red', 'redAmber']);
  let amber = 0;
  for (let t = 0; t < 30; t += 0.01) if (lightAt(j, 0, t) === 'amber') amber += 0.01;
  assert.ok(Math.abs(amber - SIGNALS.amber) < 0.05, `${amber} s of amber`);
  // Hacked, it shows what it was told to; dark, nothing.
  assert.equal(lightAt({ ...j, hack: { kind: 'green' } }, 1, 0), 'green');
  assert.equal(lightAt({ ...j, dark: true }, 0, 0), 'off');
});

test('a car waits at red short of the junction and goes on green', () => {
  const idx = roadIndex(LINES);
  const js = junctionsOf(idx);
  const cross = js.find((j) => Math.hypot(j.x, j.z) < 3);
  // Coming north up Charlottenstrasse, 70 m short.
  const v = car(nearestLane(idx, 2, 70, 0));
  const ph = phaseOf(cross, v.yaw);
  // A time when its direction is red for a good while.
  let t0 = 0;
  while (lightAt(cross, ph, t0) !== 'red' || lightAt(cross, ph, t0 + 12) !== 'red') t0 += 0.5;
  for (let k = 0; k < 12 * 30; k++) step(v, drive(v, idx, [], 1 / 30, () => 0, { junctions: js, time: t0 + k / 30 }), 1 / 30);
  assert.ok(v.speed < 0.5, `stopped, ${v.speed.toFixed(2)} m/s`);
  const short = v.z - cross.z;
  assert.ok(short > cross.r && short < cross.r + 8, `waiting ${short.toFixed(1)} m short`);
  // And on green, through.
  let t = t0 + 12;
  while (lightAt(cross, ph, t) !== 'green') t += 0.5;
  for (let k = 0; k < 8 * 30; k++) step(v, drive(v, idx, [], 1 / 30, () => 0, { junctions: js, time: t + k / 30 }), 1 / 30);
  assert.ok(v.z < cross.z - cross.r, `through, z ${v.z.toFixed(1)}`);
});

test('green both ways and the drivers pay no attention to each other; red both ways and nobody moves', () => {
  const idx = roadIndex(LINES);
  const js = junctionsOf(idx);
  const cross = js.find((j) => Math.hypot(j.x, j.z) < 3);
  // Each the same way short of where their lanes cross.
  const n0 = nearestLane(idx, 2, 40, 0), w0 = nearestLane(idx, 40, -2, Math.PI / 2);
  const north = car(nearestLane(idx, n0.x, w0.z + 40, 0));
  const west = car(nearestLane(idx, n0.x + 40, w0.z, Math.PI / 2));
  cross.hack = { kind: 'green', left: 10 };
  let met = Infinity;
  for (let k = 0; k < 8 * 30; k++) {
    const others = [north, west];
    const a = drive(north, idx, others, 1 / 30, () => 0, { junctions: js, time: k / 30 });
    const b = drive(west, idx, others, 1 / 30, () => 0, { junctions: js, time: k / 30 });
    step(north, a, 1 / 30); step(west, b, 1 / 30);
    met = Math.min(met, Math.hypot(north.x - west.x, north.z - west.z));
  }
  assert.ok(met < 3, `they meet in the middle, ${met.toFixed(1)} m apart at the closest`);

  cross.hack = { kind: 'red', left: 10 };
  const c = car(nearestLane(idx, 2, 60, 0));
  for (let k = 0; k < 10 * 30; k++) step(c, drive(c, idx, [], 1 / 30, () => 0, { junctions: js, time: k / 30 }), 1 / 30);
  assert.ok(c.speed < 0.5 && c.z > cross.r, `held at red, z ${c.z.toFixed(1)}`);
  cross.hack = null;
});

test('with the lights out a car crawls through rather than stopping', () => {
  const idx = roadIndex(LINES);
  const js = junctionsOf(idx);
  const cross = js.find((j) => Math.hypot(j.x, j.z) < 3);
  cross.dark = true;
  const v = car(nearestLane(idx, 2, 70, 0));
  let slowest = Infinity, through = false;
  for (let k = 0; k < 15 * 30; k++) {
    step(v, drive(v, idx, [], 1 / 30, () => 0, { junctions: js, time: k / 30 }), 1 / 30);
    if (Math.abs(v.z - cross.z) < cross.r) slowest = Math.min(slowest, v.speed);
    if (v.z < cross.z - cross.r) through = true;
  }
  assert.ok(through, 'and is through');
  assert.ok(slowest > 1 && slowest < 7, `at ${slowest.toFixed(1)} m/s in the junction`);
});
