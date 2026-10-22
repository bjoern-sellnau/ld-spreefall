// One Man Army: what each wave is made of, that it grows, and that
// Nightmare puts the super weapons in it in turn.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Onslaught, ONSLAUGHT } from '../../src/game/onslaught.js';

const CHASSIS = ['lynx', 'wraith', 'heron', 'hornet', 'ram', 'mantis', 'warden', 'bruin', 'bastion', 'colossus'];
const fixed = () => 0;

test('it grows: a squad first, then jeeps, a tank, mechs, bombs and jets, in that order', () => {
  const o = new Onslaught();
  const at = (l) => o.plan(l, false, CHASSIS, fixed);
  assert.equal(at(1).soldiers, ONSLAUGHT.soldiers.base);
  assert.equal(at(1).convoy, null);
  assert.ok(at(2).convoy && !at(2).convoy.tank);
  assert.ok(at(3).convoy.tank);
  assert.equal(at(3).mechs.length, 0);
  assert.equal(at(4).mechs.length, 1);
  assert.equal(at(4).bombs, 0);
  assert.ok(at(5).bombs > 0 && at(5).machines > 0);
  assert.equal(at(5).jets, 0);
  assert.ok(at(6).jets > 0);
  // Bigger armies, up to a ceiling.
  const foot = (l) => at(l).soldiers + at(l).machines;
  assert.ok(foot(10) > foot(5) && foot(5) > foot(1));
  assert.ok(foot(60) <= ONSLAUGHT.soldiers.most);
  assert.ok(at(30).mechs.length <= ONSLAUGHT.mechsMost && at(30).bombs <= ONSLAUGHT.bombs.most);
  // Nothing of Nightmare's without it.
  for (let l = 1; l < 20; l++) assert.equal(at(l).superweapon, null);
});

test('and the mechs get heavier: the light ones first, the heaviest by the top level', () => {
  const o = new Onslaught();
  const first = o.plan(ONSLAUGHT.mechFrom, false, CHASSIS, fixed).mechs;
  const late = o.plan(ONSLAUGHT.mechTop, false, CHASSIS, fixed).mechs;
  assert.equal(first[0], CHASSIS[0]);
  assert.equal(late[0], CHASSIS[CHASSIS.length - 1]);
});

test('the waves come on a clock that shortens, and switching it off starts it again', () => {
  const o = new Onslaught();
  assert.equal(o.update(ONSLAUGHT.first - 1, { on: true }), null);
  const w1 = o.update(1.01, { on: true });
  assert.equal(w1.level, 1);
  assert.ok(o.gapAfter(10) < o.gapAfter(1) && o.gapAfter(100) === ONSLAUGHT.gapLeast);
  o.update(0, { on: false });
  assert.equal(o.level, 0);
  assert.equal(o.clock, ONSLAUGHT.first);
});

test('Nightmare: from the third wave the ion cannon, ultra plasma, a void storm and a warhead, in turn', () => {
  const o = new Onslaught();
  o.clock = 0;
  const sent = [];
  for (let i = 0; i < 12; i++) {
    const w = o.update(0, { on: true, nightmare: true, chassis: CHASSIS, rand: fixed });
    o.clock = 0;
    sent.push(w.superweapon);
  }
  // Levels 1 and 2 nothing, then every other wave, then every wave from the
  // eighth.
  assert.deepEqual(sent.slice(0, 7), [null, null, 'ion', null, 'ultra', null, 'storm']);
  assert.deepEqual(sent.slice(7, 12), ['nuke', 'ion', 'ultra', 'storm', 'nuke']);
});
