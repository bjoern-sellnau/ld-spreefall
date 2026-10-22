// The suit's grab: who can be taken, how hard he goes, and what he hits.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Grab, GRAB } from '../../src/game/grab.js';
import { Nanosuit } from '../../src/game/nanosuit.js';

const man = (x, z, extra = {}) => ({ x, y: 0, z, alive: true, health: 100, state: 1, ...extra });
// A flat street with nothing standing on it.
const flat = { groundHeight: () => 0, raycast: () => null };

test('the nearest of theirs in reach and in front is taken, not a civilian, a boss or one behind you', () => {
  const g = new Grab();
  const at = { x: 0, z: 0 }, facing = { x: 0, z: -1 };
  const near = man(0, -1.8), far = man(0, -2.2);
  const behind = man(0, 1), civ = man(0.2, -1, { civilian: true }), big = man(-0.2, -1, { scale: 3.5 });
  assert.equal(g.pick(at, facing, [far, near, behind, civ, big]), near);
  assert.equal(g.pick(at, facing, [man(0, -GRAB.reach - 0.5)]), null);
});

test('a longer wind-up throws harder, and holding him costs the suit energy', () => {
  const g = new Grab();
  const s = man(0, -1);
  g.take(s);
  assert.equal(s.held, true);
  for (let i = 0; i < 30; i++) g.windUp(1 / 60);
  const half = g.charge;
  for (let i = 0; i < 60; i++) g.windUp(1 / 60);
  assert.ok(half > 0.4 && half < 0.7 && g.charge === 1, `${half} then ${g.charge}`);
  const f = g.release({ x: 0, y: 0, z: -1 });
  assert.ok(Math.abs(f.vz + GRAB.maxSpeed) < 1e-9, `${f.vz}`);
  assert.equal(g.held, null);

  const held = new Nanosuit(), free = new Nanosuit();
  for (let i = 0; i < 120; i++) { held.update(1 / 60, { speed: 0, holding: true }); free.update(1 / 60, { speed: 0 }); }
  assert.ok(held.energy < free.energy - 5, `${held.energy} holding, ${free.energy} not`);
});

test('in flight he goes through the man in the way, slows, and lands', () => {
  const g = new Grab();
  const s = man(0, 0);
  const inWay = man(0, -6);
  g.take(s);
  const f = g.release({ x: 0, y: 0, z: -1 }, 1);
  // Where the hold leaves him: feet a hand's breadth off the street.
  s.y = 0.3;
  const struck = [];
  let landed = null;
  for (let i = 0; i < 400 && g.flying.length; i++) {
    g.step(1 / 60, {
      world: flat, bodies: [s, inWay],
      onStrike: (fl, other, speed) => struck.push({ other, speed }),
      onLand: (fl, speed, what) => { landed = { speed, what }; },
    });
  }
  assert.equal(struck.length, 1);
  assert.equal(struck[0].other, inWay);
  assert.ok(struck[0].speed > GRAB.minSpeed, `${struck[0].speed}`);
  assert.equal(landed.what, 'ground');
  assert.equal(s.held, false);
  assert.ok(Math.abs(f.vz) < GRAB.maxSpeed * 0.7, 'the man in the way took something out of it');
});

test('a wall stops him where it stands', () => {
  const g = new Grab();
  const s = man(0, 0);
  g.take(s);
  g.release({ x: 0, y: 0, z: -1 }, 1);
  s.y = 1;
  // A wall four metres out.
  const walled = {
    groundHeight: () => 0,
    raycast: (x, y, z, dx, dy, dz, max) => {
      if (dz >= 0) return null;
      const t = (z - -4) / -dz;
      return t >= 0 && t <= max ? { t } : null;
    },
  };
  let what = null;
  for (let i = 0; i < 200 && g.flying.length; i++) {
    g.step(1 / 60, { world: walled, bodies: [s], onStrike: () => {}, onLand: (fl, sp, w) => { what = w; } });
  }
  assert.equal(what, 'wall');
  assert.ok(s.z > -4, `stopped at ${s.z}`);
});
