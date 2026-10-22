// The suit's arithmetic: one bar of energy, what draws on it, and what
// happens when it runs out.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Nanosuit, SUIT } from '../../src/game/nanosuit.js';

const run = (suit, seconds, body) => {
  let k = 1;
  for (let i = 0; i < seconds * 60; i++) k = suit.update(1 / 60, body);
  return k;
};

test('the cloak drains faster the faster you move, and drops when the energy is gone', () => {
  const still = new Nanosuit(), walk = new Nanosuit(), runner = new Nanosuit();
  for (const s of [still, walk, runner]) s.toggleCloak();
  run(still, 3, { speed: 0 });
  run(walk, 3, { speed: 3 });
  run(runner, 3, { speed: 7 });
  assert.ok(still.energy > walk.energy && walk.energy > runner.energy,
    `${still.energy} still, ${walk.energy} walking, ${runner.energy} running`);
  let dropped = null;
  runner.onEmpty = (what) => { dropped = what; };
  run(runner, 10, { speed: 7 });
  assert.equal(runner.cloak, false);
  assert.deepEqual(dropped, ['cloak']);
});

test('it comes up over a moment rather than at once', () => {
  const s = new Nanosuit();
  s.toggleCloak();
  assert.equal(s.hidden, false);
  run(s, SUIT.cloak.rise + 0.05, { speed: 0 });
  assert.equal(s.hidden, true);
});

test('the bow fires from the cloak for a slice; a gun drops it and empties the suit', () => {
  const s = new Nanosuit();
  s.toggleCloak();
  run(s, 0.5, { speed: 0 });
  const before = s.energy;
  assert.equal(s.fired(true), true);
  assert.ok(Math.abs(before - s.energy - SUIT.cloak.bowCost) < 1e-9);
  let broke = false;
  s.onBreak = () => { broke = true; };
  assert.equal(s.fired(false), false);
  assert.equal(s.cloak, false);
  assert.equal(s.energy, 0);
  assert.ok(broke);
  // And emptied, it will not come straight back on.
  assert.equal(s.toggleCloak(), false);
});

test('armour takes most of a hit into the energy, until there is none', () => {
  const s = new Nanosuit();
  s.toggleArmor();
  const through = s.absorb(50);
  assert.ok(Math.abs(through - 50 * (1 - SUIT.armor.absorb)) < 1e-9, `${through} through`);
  assert.ok(s.energy < SUIT.energy);
  const left = s.energy;
  const big = s.absorb(1000);
  assert.ok(Math.abs(big - (1000 - left / SUIT.armor.costPerPoint)) < 1e-6, `${big} of a thousand through`);
  assert.equal(s.armor, false, 'emptied, the armour drops');
  const off = new Nanosuit();
  assert.equal(off.absorb(50), 50);
});

test('the sprint is faster, costs energy, and stops when it runs out', () => {
  const s = new Nanosuit();
  const k = s.update(1 / 60, { speed: 6, sprint: true });
  assert.ok(Math.abs(k - SUIT.sprint.speed) < 1e-9);
  let steps = 0;
  while (s.energy > 0 && steps < 60 * 30) { s.update(1 / 60, { speed: 6, sprint: true }); steps++; }
  assert.ok(Math.abs(steps / 60 - SUIT.energy / SUIT.sprint.drain) < 0.1, `${(steps / 60).toFixed(2)} s of sprint`);
  assert.equal(s.sprinting, false);
  assert.equal(s.update(1 / 60, { speed: 6, sprint: true }), 1);
});

test('the energy comes back after a moment of rest', () => {
  const s = new Nanosuit();
  s.toggleCloak();
  run(s, 2, { speed: 7 });
  s.toggleCloak();
  const low = s.energy;
  run(s, SUIT.regenDelay * 0.5, { speed: 0 });
  assert.equal(s.energy, low, 'not straight away');
  run(s, 6, { speed: 0 });
  assert.equal(s.energy, SUIT.energy);
});

test('a held jump and a punch cost energy, and need it', () => {
  const s = new Nanosuit();
  assert.equal(s.powerJump(), SUIT.jump.boost);
  assert.equal(s.punch(), true);
  s.energy = 5;
  assert.equal(s.powerJump(), 1);
  assert.equal(s.punch(), false);
});

test('Nano Vision drains the energy while it is up, and drops with it', () => {
  const s = new Nanosuit();
  assert.equal(s.toggleNano(), true);
  run(s, 2, { speed: 0 });
  assert.ok(Math.abs(s.energy - (SUIT.energy - SUIT.nano.drain * 2)) < 0.5, `${s.energy}`);
  let dropped = null;
  s.onEmpty = (what) => { dropped = what; };
  run(s, 30, { speed: 0 });
  assert.equal(s.nano, false);
  assert.deepEqual(dropped, ['nano vision']);
});
