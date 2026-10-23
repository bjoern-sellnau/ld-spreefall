// .BACKDOOR: who people are, what the phone points at, and what it costs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { BACKDOOR, profileFor, pickTarget, Phone } from '../../src/game/backdoor.js';

test('a seed is a person, the same person every time, and people differ', () => {
  const a = profileFor(0.123456), b = profileFor(0.123456), c = profileFor(0.654321);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (const p of [a, c]) {
    assert.match(p.name, /^\S+ \S+$/);
    assert.ok(p.age >= 17 && p.age < 80);
    assert.ok(p.income >= 0 && p.bank > 0);
    assert.ok(p.fact.length > 10);
    assert.equal(!!p.record, p.criminal);
  }
});

test('about one in nine has a record', () => {
  let n = 0;
  for (let i = 0; i < 2000; i++) if (profileFor(i / 2000 + 0.00013).criminal) n++;
  assert.ok(n > 2000 * 0.07 && n < 2000 * 0.16, `${n} of 2000`);
});

test('the phone points at whoever is nearest the crosshair, within reach and the cone', () => {
  const eye = { x: 0, y: 1.7, z: 0 };
  const dir = { x: 0, y: 0, z: -1 };
  const ahead = { x: 0.5, y: 1.7, z: -20 };
  const aside = { x: 8, y: 1.7, z: -20 };
  const far = { x: 0, y: 1.7, z: -BACKDOOR.reach - 5 };
  assert.equal(pickTarget(eye, dir, [aside, ahead, far]).thing, ahead);
  assert.equal(pickTarget(eye, dir, [aside, far]), null);
  // Two on the line: the nearer.
  const near = { x: 0, y: 1.7, z: -10 };
  assert.equal(pickTarget(eye, dir, [ahead, near]).thing, near);
});

test('a hack costs battery at once, the slow one wants the phone kept on it, and it fills again', () => {
  const p = new Phone();
  const who = {};
  assert.equal(p.start('bank', who), null);
  assert.equal(p.battery, BACKDOOR.battery.most - BACKDOOR.hacks.bank.cost);
  assert.equal(p.start('distract', who), 'busy');
  assert.equal(p.update(0.5, () => true), null);
  assert.ok(p.progress > 0.3 && p.progress < 0.4);
  const done = p.update(1.0, () => true);
  assert.equal(done.done.kind, 'bank');
  // Looked away half way: lost, and the battery stays spent.
  p.start('bank', who);
  const spent = p.battery;
  assert.ok(p.update(0.2, () => false).lost);
  assert.equal(p.battery, spent);
  // Empty, it says so; left alone, it fills.
  p.battery = 5;
  assert.equal(p.start('bank', who), 'battery');
  for (let i = 0; i < 60 * 20; i++) p.update(1 / 60);
  assert.equal(p.battery, BACKDOOR.battery.most);
});
