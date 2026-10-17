// Every switch in the menu has to be a switch. One that is in the list but
// not in the object cannot be turned on at all, because set refuses an id it
// cannot find a boolean behind, and its row in the menu does nothing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Cheats, SWITCHES, GORE, SETTINGS } from '../../src/game/cheats.js';

test('every row in the menu can be switched on and off again', () => {
  const c = new Cheats();
  for (const row of [...SWITCHES, ...GORE]) {
    const was = c[row.id];
    assert.equal(typeof was, 'boolean', `${row.id} starts as a boolean`);
    assert.equal(c.set(row.id, !was), true, `${row.id} can be set`);
    assert.equal(c[row.id], !was, `${row.id} took the new value`);
    assert.equal(c.toggle(row.id), true, `${row.id} can be toggled back`);
    assert.equal(c[row.id], was, `${row.id} is back where it started`);
  }
});

test('a fresh menu is the game as it ships', () => {
  const c = new Cheats();
  assert.equal(c.any, false, 'nothing is on, so the run is not marked');
  assert.equal(c.wreckBuildings, true, 'except the two that ship on');
  assert.equal(c.wreckGround, true);
  for (const s of SETTINGS) assert.equal(c.value(s.id), s.def);
});

test('turning a switch off again leaves the run marked', () => {
  const c = new Cheats();
  c.set('godmode', true);
  c.set('godmode', false);
  assert.equal(c.used, true);
  assert.equal(c.any, false);
});

test('and the two destruction switches mark it by being turned off', () => {
  const c = new Cheats();
  assert.equal(c.used, false);
  c.set('wreckGround', false);
  assert.equal(c.used, true, 'off is away from what the game ships with');
  assert.equal(c.any, true);
});
