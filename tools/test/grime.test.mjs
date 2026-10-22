// Crazy reality's dirt on the glass: what puts it there, how much of it is
// kept, and that it clears.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Grime, GRIME } from '../../src/ui/grime.js';

test('nothing sticks while it is off', () => {
  const g = new Grime(null);
  g.dust(1); g.blood(1); g.soot(1);
  assert.equal(g.splats.length, 0);
});

test('a closer blast throws more dust, and a hit puts blood on the side it came from', () => {
  const near = new Grime(null), far = new Grime(null);
  near.enabled = far.enabled = true;
  near.dust(0.9); far.dust(0.1);
  assert.ok(near.dirt.dust > far.dirt.dust * 2, `${near.dirt.dust} near, ${far.dirt.dust} far`);
  const left = new Grime(null);
  left.enabled = true;
  for (let i = 0; i < 6; i++) left.blood(0.5, -1);
  const mean = left.splats.reduce((n, s) => n + s.x, 0) / left.splats.length;
  assert.ok(mean < 0.4, `blood at ${mean} across the screen`);
});

test('no kind fills the glass on its own, and it all clears in time', () => {
  const g = new Grime(null);
  g.enabled = true;
  for (let i = 0; i < 200; i++) { g.blood(1); g.dust(1); g.soot(1); }
  const count = (k) => g.splats.filter((s) => s.kind === k).length;
  assert.ok(count('blood') <= GRIME.cap.blood && count('soot') <= GRIME.cap.soot && g.splats.length <= GRIME.max);
  assert.ok(count('dust') > 0 && count('soot') > 0, 'blood did not push the rest out');
  // Drips run while it ages.
  g.draw(2, true);
  assert.ok(g.splats.some((s) => s.drips && s.drips.some((d) => d.run > 0)));
  g.draw(60, true);
  assert.equal(g.splats.length, 0);
});
