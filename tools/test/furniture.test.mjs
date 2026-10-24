// What stands on the pavement for .BACKDOOR: where the power boxes and the
// ATMs go, what a box does with a fuse or a trap, what an ATM holds, and the
// road blockers at a junction.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roadIndex, junctionsOf } from '../../src/game/traffic.js';
import { CITY, furnitureOf, boxStep, boxState, boxReady, zapOn, atmCash, atmState, atmStep,
  bollardsOf, postsOf, bollardStep, intoBollards } from '../../src/game/city.js';

const LINES = [
  { cls: 'secondary', w: 12, pts: [-400, 0, 400, 0] },
  { cls: 'residential', w: 8, pts: [0, -300, 0, 300] },
];

test('boxes stand past the kerb on alternate sides, never in a junction, and ATMs only where there is a wall', () => {
  const idx = roadIndex(LINES);
  const js = junctionsOf(idx);
  // A wall eight metres north of the east-west street, nowhere else.
  const wall = (x, z, nx, nz) => (nz < -0.5 && z > -8 ? { x, z: -8, nx: 0, nz: 1 } : null);
  const { boxes, atms } = furnitureOf(idx, js, () => true, wall);
  assert.ok(boxes.length > 10, `${boxes.length} boxes`);
  for (const b of boxes) {
    const offRoad = Math.min(Math.abs(b.z), Math.abs(b.x));
    assert.ok(offRoad > 4 - 0.01, `a box ${offRoad.toFixed(1)} m from the centreline`);
    for (const j of js) assert.ok(Math.hypot(j.x - b.x, j.z - b.z) >= j.r + CITY.street.clear - 0.01);
  }
  assert.ok(boxes.some((b) => b.z > 0) && boxes.some((b) => b.z < 0), 'both sides of the street');
  assert.ok(atms.length > 0, 'an ATM where there is a wall');
  for (const a of atms) assert.ok(Math.abs(a.z - (-8 + 0.18)) < 1e-6, 'in the wall, a hand in front of it');
  // And nothing where the road says the spot is not clear.
  assert.equal(furnitureOf(idx, js, () => false, wall).boxes.length, 0);
});

test('a box: a fuse that ends in a blast, a trap that runs down, burnt out after', () => {
  const b = { x: 0, z: 0, fuse: 0, spent: 0, trap: 0 };
  assert.equal(boxState(b), 0);
  b.trap = 2;
  assert.equal(boxState(b), 2);
  boxStep(b, 1);
  assert.equal(b.trap, 1);
  b.fuse = CITY.box.fuse;
  assert.equal(boxState(b), 1);
  assert.equal(boxReady(b), false);
  let blew = 0;
  for (let i = 0; i < 70; i++) if (boxStep(b, 1 / 60) === 'blow') blew++;
  assert.equal(blew, 1);
  assert.equal(boxState(b), 3);
  assert.equal(b.trap, 0, 'a trap is spent with the box');
  boxStep(b, CITY.box.spent + 1);
  assert.equal(boxReady(b), true);
  // What it does falls off to nothing at the edge.
  assert.ok(zapOn(b, 1, 0).share > zapOn(b, 5, 0).share);
  assert.equal(zapOn(b, CITY.zap.radius + 0.1, 0), null);
});

test('an ATM holds the same in tens every time, and is empty for a while after', () => {
  const a = { x: 0, z: 0, seed: 0.37, empty: 0, spray: 0 };
  const cash = atmCash(a);
  assert.equal(cash, atmCash({ ...a }));
  assert.ok(cash >= CITY.atm.cash[0] && cash <= CITY.atm.cash[1] && cash % 10 === 0, `${cash}`);
  a.spray = CITY.atm.spray; a.empty = CITY.atm.empty;
  assert.equal(atmState(a), 1);
  atmStep(a, CITY.atm.spray + 0.1);
  assert.equal(atmState(a), 2);
  atmStep(a, CITY.atm.empty);
  assert.equal(atmState(a), 0);
});

test('blockers across every road into a junction, up and down over half a second, and a nose that meets them', () => {
  const idx = roadIndex(LINES);
  const js = junctionsOf(idx);
  const rows = bollardsOf(js);
  assert.equal(rows.length, js.reduce((n, j) => n + j.legs.length, 0));
  const row = rows[0];
  assert.ok(postsOf(row).length >= 3);
  row.left = CITY.bollards.up;
  for (let i = 0; i < 20; i++) bollardStep(row, 1 / 60);
  assert.ok(row.up > 0.6 && row.up < 1);
  for (let i = 0; i < 20; i++) bollardStep(row, 1 / 60);
  assert.equal(row.up, 1);
  // A car heading into the junction, its nose on the row.
  const yaw = Math.atan2(row.nx, row.nz);
  const car = { x: row.x + row.nx * 2, z: row.z + row.nz * 2, yaw, speed: 10, spec: { length: 4 } };
  assert.equal(intoBollards(row, car), true);
  // Ten metres further back it has not got there.
  assert.equal(intoBollards(row, { ...car, x: row.x + row.nx * 12, z: row.z + row.nz * 12 }), false);
  // And down again once its time is up.
  row.left = 0;
  for (let i = 0; i < 40; i++) bollardStep(row, 1 / 60);
  assert.equal(row.up, 0);
  assert.equal(intoBollards(row, car), false);
});
