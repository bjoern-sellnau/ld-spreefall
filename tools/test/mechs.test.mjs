// A pilot is never left holding a machine that is not there any more.
//
// The layer can take every mech off the street in one call, and until this
// was written it did so without telling anybody. The game went on pointing
// at the mech it thought you were flying, so the key that gets you in got you
// out instead, the loadout belonged to a machine with no body, and nothing in
// the interface said why. It cost the whole mech half of the machines suite,
// eighteen checks that all read as a street with nowhere to park.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Mechs } from '../../src/game/mechs.js';

/** Flat ground, which is all any of this needs. */
const flatWorld = { groundHeight: () => 0 };

test('resetting the layer tells whoever was in one', () => {
  const mechs = new Mechs(flatWorld);
  const m = mechs.spawn('titan', 10, 10);
  assert.ok(m, 'a Titan goes down');
  assert.equal(mechs.enter(m), true, 'and you can get into it');
  let told = null;
  mechs.onEject = (who) => { told = who; };
  mechs.reset();
  assert.equal(told, m, 'the layer says who was in one');
  assert.equal(mechs.piloted, null, 'and nobody is flying anything');
  assert.equal(m.occupied, false, 'and the machine is not occupied');
  assert.equal(mechs.count, 0, 'and the street is empty');
});

test('resetting an empty street tells nobody', () => {
  const mechs = new Mechs(flatWorld);
  mechs.spawn('reaper', 20, 0);
  let told = 0;
  mechs.onEject = () => { told++; };
  mechs.reset();
  assert.equal(told, 0, 'nobody was in one, so nobody is told');
});

test('the pool comes back after a reset', () => {
  const mechs = new Mechs(flatWorld);
  for (let i = 0; i < 8; i++) assert.ok(mechs.spawn('reaper', i * 12, 0), `number ${i + 1}`);
  assert.equal(mechs.spawn('reaper', 200, 0), null, 'the ninth has nowhere to stand');
  mechs.reset();
  assert.ok(mechs.spawn('titan', 10, 0), 'and after a reset there is room again');
});
