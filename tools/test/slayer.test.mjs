// Slayer's waves: a nest's plan, the tyrant for the last nest in a district
// and the Warlord after it for the last nest of the operation.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Campaign, SITE } from '../../src/game/campaign.js';
import { Slayer, SLAYER } from '../../src/game/slayer.js';

function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

const finder = (rand) => ({ x: rand() * 2000, z: rand() * 2000 });
const world = { isLoaded: () => true, groundHeight: () => 0 };

function setup(scope) {
  const c = new Campaign(memory());
  c.setMode('slayer');
  c.set('scope', scope);
  c.set('start', 'core');
  c.set('bosses', true);
  const sites = c.place('core', finder);
  const kinds = [];
  const sl = new Slayer(c, world, (kind) => { kinds.push(kind); return null; }, () => {});
  return { c, sites, sl, kinds };
}

test('a nest holds three waves, more of them at a higher level', () => {
  const { sl, sites } = setup('district');
  const plain = sl.plan(sites[0], false);
  assert.equal(plain.length, SLAYER.waves.length);
  const harder = sl.plan({ ...sites[0], level: 2 }, false);
  assert.ok(harder[2].ghoul > plain[2].ghoul);
});

test('the last nest in a district keeps a tyrant, and in the last district the Warlord', () => {
  const { sl, sites } = setup('district');
  for (const s of sites.slice(1)) s.state = SITE.FREE;
  const r = sl.run(sites[0]);
  sl._wake(r);
  assert.equal(r.boss, true);
  assert.equal(r.final, true);
  assert.equal(r.waves.at(-2).tyrant, 1);
  assert.equal(r.waves.at(-1).warlord, 1);
});

test('with every district in scope, only the game layer says which nest is the last', () => {
  const { sl, sites } = setup('all');
  for (const s of sites.slice(1)) s.state = SITE.FREE;
  const r = sl.run(sites[0]);
  sl._wake(r);
  assert.equal(r.boss, true);
  assert.equal(r.final, false, 'not the last until the other districts are done');
  assert.ok(!r.waves.some((w) => w.warlord));
  sl._reset(r, false);
  sl.isFinal = () => true;
  sl._wake(r);
  assert.equal(r.waves.at(-1).warlord, 1);
});

test('with bosses off there is no tyrant and no Warlord', () => {
  const { c, sl, sites } = setup('district');
  c.set('bosses', false);
  for (const s of sites.slice(1)) s.state = SITE.FREE;
  const r = sl.run(sites[0]);
  sl._wake(r);
  assert.ok(!r.waves.some((w) => w.tyrant || w.warlord));
});

test('with extreme enemies a nest holds as many waves as the setting, each past the third bigger', () => {
  const sl = new Slayer(new Campaign(), null, () => null, () => {});
  const plain = sl.plan({ level: 0 }, false);
  assert.equal(plain.length, SLAYER.waves.length);
  sl.extremeFrom = () => 7;
  const many = sl.plan({ level: 0 }, false);
  assert.equal(many.length, 7);
  const size = (w) => Object.values(w).reduce((a, b) => a + b, 0);
  assert.ok(size(many[6]) > size(many[2]), `${size(many[6])} against ${size(many[2])}`);
  sl.extremeFrom = () => 0;
  assert.equal(sl.plan({ level: 0 }, false).length, SLAYER.waves.length);
});
