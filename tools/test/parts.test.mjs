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

// --- pieces that start in the air ------------------------------------------
import { podiumHeight, replacedByLandmark, volumeFloor } from '../build-world.mjs';

test('where a volume starts: metres first, then levels, else the street', () => {
  assert.equal(volumeFloor({ min_height: '15' }), 15);
  assert.equal(volumeFloor({ 'building:min_level': '4', min_height: '9 m' }), 9);
  assert.equal(volumeFloor({ 'building:min_level': '5' }), 16);
  assert.equal(volumeFloor({}), 0);
});

test('an outline whose pieces all start in the air is the podium under them', () => {
  const outline = { outer: square(0, 0, 30), tags: { building: 'yes', height: '30' }, part: false };
  const upper = { outer: square(0, 0, 28), tags: { 'building:part': 'yes', min_height: '15', height: '30' }, part: true };
  markBuildingParts([outline, upper]);
  assert.equal(podiumHeight(outline), 15, 'built up to where the pieces start, so nothing hangs');
});

test('an outline whose pieces stand on the street is left out as before', () => {
  const outline = { outer: square(0, 0, 30), tags: { building: 'yes', height: '60' }, part: false };
  const base = { outer: square(0, 0, 29), tags: { 'building:part': 'yes', height: '20' }, part: true };
  const tower = { outer: square(5, 5, 8), tags: { 'building:part': 'yes', min_height: '20', height: '60' }, part: true };
  markBuildingParts([outline, base, tower]);
  assert.equal(podiumHeight(outline), 0, 'no box round the tower');
});

test('what OpenStreetMap maps of a landmark goes, and the landmark stays', () => {
  const mark = { outer: square(0, 0, 60), tags: { building: 'yes', 'spreefall:kind': 'reichstag' } };
  const marks = [{ b: mark, outer: mark.outer, cx: 0, cz: 0, area: 120 * 120 }];
  const piece = { outer: square(20, 20, 10), tags: { 'building:part': 'yes', min_height: '24' } };
  const envelope = { outer: square(0, 0, 70), tags: { building: 'yes' } };
  const neighbour = { outer: square(200, 0, 20), tags: { building: 'yes' } };
  const block = { outer: square(0, 0, 400), tags: { landuse: 'x', building: 'yes' } };
  assert.equal(replacedByLandmark(mark, marks), false);
  assert.equal(replacedByLandmark(piece, marks), true);
  assert.equal(replacedByLandmark(envelope, marks), true);
  assert.equal(replacedByLandmark(neighbour, marks), false);
  assert.equal(replacedByLandmark(block, marks), false, 'something much bigger round it is not the landmark');
});
