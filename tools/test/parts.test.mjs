// Simple 3D Buildings: an outline with building:part pieces inside it is the
// envelope round them and is not drawn, but only when the pieces really are
// going to be drawn. A piece that the builder is about to throw away may not
// take its building with it, which is what made a whole embassy disappear.

import test from 'node:test';
import assert from 'node:assert/strict';

import { markBuildingParts } from '../build-world.mjs';

const square = (cx, cz, half) => [
  [cx - half, cz - half], [cx + half, cz - half],
  [cx + half, cz + half], [cx - half, cz + half],
];

test('a piece that will be built claims the outline round it', () => {
  const outline = { outer: square(0, 0, 30), tags: { building: 'yes' }, part: false };
  const tower = { outer: square(10, 10, 8), tags: { 'building:part': 'yes' }, part: true };
  const taken = markBuildingParts([outline, tower]);
  assert.equal(taken, 1);
  assert.equal(outline.hasParts, true);
  assert.equal(tower.hasParts, undefined, 'a piece claims nothing itself');
});

test('a piece that will be thrown away leaves its building standing', () => {
  const outline = { outer: square(0, 0, 30), tags: { building: 'yes' }, part: false };
  const scrap = { outer: square(4, 4, 1), tags: { 'building:part': 'yes' }, part: true };
  // The builder drops anything under the district's smallest building.
  const taken = markBuildingParts([outline, scrap], (b) => b !== scrap);
  assert.equal(taken, 0);
  assert.ok(!outline.hasParts, 'the outline is still the building');
});

test('a piece outside every outline belongs to nobody', () => {
  const outline = { outer: square(0, 0, 20), tags: { building: 'yes' }, part: false };
  const away = { outer: square(400, 400, 9), tags: { 'building:part': 'yes' }, part: true };
  assert.equal(markBuildingParts([outline, away]), 0);
  assert.ok(!outline.hasParts);
});

test('one outline is claimed once however many pieces are in it', () => {
  const outline = { outer: square(0, 0, 40), tags: { building: 'yes' }, part: false };
  const pieces = [[-20, -20], [20, -20], [0, 18]].map(([x, z]) => ({
    outer: square(x, z, 7), tags: { 'building:part': 'yes' }, part: true,
  }));
  assert.equal(markBuildingParts([outline, ...pieces]), 1);
  assert.equal(outline.hasParts, true);
});
