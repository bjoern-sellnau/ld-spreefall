// Thunder's shape: a crack only close to, a roll that goes on longer the
// further off, about ten to fifteen seconds in the middle of the range, the
// air taking the top end out with distance, and claps that die away.

import test from 'node:test';
import assert from 'node:assert/strict';

import { THUNDER, thunderShape, rumbleCurve } from '../../src/game/thunder.js';

const mid = () => 0.5;

test('close to it cracks, a few kilometres off it only rolls', () => {
  assert.ok(thunderShape(300, mid).crack > 0.7);
  assert.ok(thunderShape(1000, mid).crack > 0 && thunderShape(1000, mid).crack < 0.3);
  assert.equal(thunderShape(THUNDER.crackWithin, mid).crack, 0);
  assert.equal(thunderShape(3500, mid).crack, 0);
});

test('it rolls for longer the further off, and ten to fifteen seconds in the middle of the range', () => {
  const near = thunderShape(300, mid).roll, middle = thunderShape(2500, mid).roll, far = thunderShape(4000, mid).roll;
  assert.ok(near < middle && middle < far, `${near} ${middle} ${far}`);
  assert.ok(middle >= 10 && middle <= 15, `${middle.toFixed(1)} s at 2.5 km`);
  // Measured from two seconds to over thirty: never outside that.
  for (const d of [100, 500, 2000, 8000]) {
    for (const r of [0, 0.5, 0.99]) {
      const roll = thunderShape(d, () => r).roll;
      assert.ok(roll >= 2.2 && roll <= 34, `${roll} s at ${d} m`);
    }
  }
});

test('the air takes the top end out with distance, and it gets quieter', () => {
  const a = thunderShape(300, mid), b = thunderShape(2000, mid), c = thunderShape(4000, mid);
  assert.ok(a.air > b.air && b.air > c.air, `${a.air} ${b.air} ${c.air}`);
  assert.ok(c.air < 1000, `${c.air} Hz at 4 km`);
  assert.ok(a.loud > b.loud && b.loud > c.loud);
  assert.ok(c.rumble <= THUNDER.rumbleTop);
});

test('the roll comes in claps, the first the loudest, and is gone by its end', () => {
  let s = 1;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const shape = thunderShape(1500, rand);
  assert.ok(shape.claps.length >= 6);
  assert.equal(shape.claps[0].t, 0);
  assert.ok(shape.claps.every((c) => c.a <= 1 && c.t >= 0 && c.t <= shape.roll));
  const curve = rumbleCurve(shape, 60, rand);
  assert.equal(curve.length, Math.ceil(shape.roll * 60));
  // Loud near the start, quiet at the end, and never nought (an exponential
  // ramp cannot reach it) nor past what the gain can take.
  const early = Math.max(...curve.slice(0, 60)), late = curve[curve.length - 1];
  assert.ok(early > 0.3 * shape.loud, `${early}`);
  assert.ok(late <= 0.0001 + 1e-9, `${late}`);
  assert.ok(curve.every((v) => v > 0 && v <= 1.4));
  // And it goes up and down: claps, not one long fade.
  let rises = 0;
  for (let i = 1; i < curve.length; i++) if (curve[i] > curve[i - 1] * 1.05) rises++;
  assert.ok(rises > 5, `${rises} rises`);
});
