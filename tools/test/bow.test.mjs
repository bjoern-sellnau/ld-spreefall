// The bow's draw weights and its shock head: the rows, and what the weapon
// does with them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { WEAPONS, ARROW_DRAWS, ARROW_HEADS } from '../../src/game/arsenal.js';
import { Weapon } from '../../src/game/weapon.js';

test('three draw weights: light is quicker and weaker, strong slower and harder', () => {
  const { light, medium, strong } = ARROW_DRAWS;
  assert.equal(medium.damage, 1);
  assert.ok(light.damage < 1 && light.interval < 1 && light.speed < 1);
  assert.ok(strong.damage > 1 && strong.interval > 1 && strong.speed > 1 && strong.carry > 1);
  assert.deepEqual(WEAPONS.bow.draws, ['medium', 'strong', 'light']);
});

test('the bow carries a shock head after the other four', () => {
  assert.deepEqual(WEAPONS.bow.heads, ['plain', 'fire', 'poison', 'blast', 'shock']);
  const sh = ARROW_HEADS.shock.shock;
  assert.ok(sh.radius > 0 && sh.damage > 0 && sh.stun > 0);
});

test('the weapon cycles the draw for a bow, and has none for anything else', () => {
  const w = new Weapon({});
  w.select('bow');
  assert.equal(w.draw, 'medium');
  const seen = [];
  w.onDraw = (d) => seen.push(d);
  assert.equal(w.cycleDraw(), 'strong');
  assert.equal(w.cycleDraw(), 'light');
  assert.equal(w.cycleDraw(), 'medium');
  assert.deepEqual(seen, ['strong', 'light', 'medium']);
  w.select('m16');
  assert.equal(w.draw, null);
  assert.equal(w.cycleDraw(), null);
});
