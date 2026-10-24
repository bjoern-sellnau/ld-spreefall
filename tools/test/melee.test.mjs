// The arithmetic of a blow: from behind or not, the run of punches that ends
// in a hook, the baton's count on one man, the curve a move draws on the
// screen, and how heavy a blow with each weapon is.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fromBehind, punchCombo, batonCount, moveCurve } from '../../src/game/melee.js';
import { WEAPONS, BUCKETS, MOVES, bashWeight } from '../../src/game/arsenal.js';

test('behind him is where he faces away from you, not where he faces you or stands side on', () => {
  // He stands two metres north of you (towards -z).
  const facingAway = { x: 0, z: -2, yaw: 0 };              // faces -z, away from you
  const facingYou = { x: 0, z: -2, yaw: Math.PI };         // faces +z, at you
  const sideOn = { x: 0, z: -2, yaw: Math.PI / 2 };        // faces -x
  assert.equal(fromBehind(0, 0, facingAway), true);
  assert.equal(fromBehind(0, 0, facingYou), false);
  assert.equal(fromBehind(0, 0, sideOn), false);
});

test('every third punch in a row is the hook, and a pause starts the run again', () => {
  const S = WEAPONS.fists.swing;
  const run = {};
  const hooks = [0, 0.3, 0.6, 0.9, 1.2, 1.5].map((t) => punchCombo(run, t, S).hook);
  assert.deepEqual(hooks, [false, false, true, false, false, true]);
  // Longer than the gap since the last: it is the first of a new run.
  assert.equal(punchCombo(run, 1.5 + S.gap + 0.1, S).n, 1);
});

test('the baton counts its blows on one man while they keep coming, and starts again after a pause', () => {
  const S = WEAPONS.baton.swing;
  const s = {};
  assert.equal(batonCount(s, 0, S), 1);
  assert.equal(batonCount(s, 0.5, S), 2);
  assert.equal(batonCount(s, 1.0, S), S.floor);
  assert.equal(batonCount(s, 1.0 + S.gap + 0.1, S), 1);
  // Two men are counted apart.
  assert.equal(batonCount({}, 1.2, S), 1);
});

test('a move goes out and comes back: nothing at either end, all of it in the middle', () => {
  assert.equal(moveCurve(0, 0.4), 0);
  assert.ok(moveCurve(0.4, 0.4) < 1e-9);
  assert.ok(Math.abs(moveCurve(0.2, 0.4) - 1) < 1e-9);
  assert.ok(moveCurve(0.1, 0.4) > 0.6);
});

test('the four close weapons are on 6, wear walls down, and a blow is lighter with a pistol and heavier with a launcher', () => {
  for (const id of ['knife', 'baton', 'bat', 'fists']) {
    assert.ok(BUCKETS[6].ids.includes(id), id);
    assert.equal(WEAPONS[id].kind, 'melee');
    assert.ok(WEAPONS[id].wallHit > 0 && WEAPONS[id].swing.seconds > 0, id);
  }
  // wall is the flamethrower's second trigger and nothing else's: a number
  // there made the right button throw a wall of fire out of a knife.
  for (const [id, w] of Object.entries(WEAPONS)) {
    if (w.wall !== undefined) assert.ok(typeof w.wall === 'object' && w.wall.fuel > 0, id);
  }
  assert.ok(WEAPONS.knife.swing.back * WEAPONS.knife.damage >= 500, 'one from behind is enough');
  assert.ok(bashWeight('sdpistol') < bashWeight('m16') && bashWeight('m16') < bashWeight('rpg'));
  assert.ok(bashWeight('rpg') >= MOVES.bash.floors && bashWeight('m16') < MOVES.bash.floors);
  assert.equal(bashWeight('minigun'), 1.5);
  assert.ok(MOVES.kick.air.damage > 1 && MOVES.kick.air.launch > 0);
});
