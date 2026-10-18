// The surface maps have to tile, or every street in the city has a seam
// down it every three metres.
//
// These are built at load time out of periodic noise, which is the whole
// trick: an ordinary hash of the integer lattice does not repeat, so the
// right hand edge of a tile has nothing to do with the left hand one and the
// join shows as a hard line. The check for that is not to look at the edge
// values but to compare the step across the join with the step anywhere
// else: a tile that meets itself has no bigger a jump at the seam than it
// has between any other two columns.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  surfaceLayer, buildSurfaceMaps, SURFACE_LAYER, SURFACE_SCALE, SURFACE_SIZE,
} from '../../src/engine/surfaces.js';

const SIZE = 64;

/** Mean absolute difference between two columns, over all four channels. */
function columnStep(data, size, a, b) {
  let sum = 0;
  for (let y = 0; y < size; y++) {
    for (let c = 0; c < 4; c++) {
      sum += Math.abs(data[(y * size + a) * 4 + c] - data[(y * size + b) * 4 + c]);
    }
  }
  return sum / (size * 4);
}

function rowStep(data, size, a, b) {
  let sum = 0;
  for (let x = 0; x < size; x++) {
    for (let c = 0; c < 4; c++) {
      sum += Math.abs(data[(a * size + x) * 4 + c] - data[(b * size + x) * 4 + c]);
    }
  }
  return sum / (size * 4);
}

test('every layer tiles in both directions', () => {
  for (const kind of Object.keys(SURFACE_LAYER)) {
    const d = surfaceLayer(kind, SIZE);
    const seamX = columnStep(d, SIZE, 0, SIZE - 1);
    const insideX = columnStep(d, SIZE, Math.floor(SIZE / 2), Math.floor(SIZE / 2) + 1);
    const seamY = rowStep(d, SIZE, 0, SIZE - 1);
    const insideY = rowStep(d, SIZE, Math.floor(SIZE / 2), Math.floor(SIZE / 2) + 1);
    // Three times the ordinary step is still a texture; a tile that does not
    // repeat is off by an order of magnitude, because the two edges are then
    // unrelated samples of the same noise.
    assert.ok(seamX <= insideX * 3 + 2,
      `${kind} seams across: ${seamX.toFixed(2)} at the join, ${insideX.toFixed(2)} inside`);
    assert.ok(seamY <= insideY * 3 + 2,
      `${kind} seams down: ${seamY.toFixed(2)} at the join, ${insideY.toFixed(2)} inside`);
  }
});

test('a layer is the size it says it is, and is the same every time', () => {
  const a = surfaceLayer('asphalt', SIZE);
  const b = surfaceLayer('asphalt', SIZE);
  assert.equal(a.length, SIZE * SIZE * 4);
  assert.deepEqual(Array.from(a.slice(0, 256)), Array.from(b.slice(0, 256)));
});

test('the grain stays near one and the occlusion never goes negative', () => {
  for (const kind of Object.keys(SURFACE_LAYER)) {
    const d = surfaceLayer(kind, SIZE);
    let lo = 255, hi = 0, darkest = 255;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 2] < lo) lo = d[i + 2];
      if (d[i + 2] > hi) hi = d[i + 2];
      if (d[i + 3] < darkest) darkest = d[i + 3];
    }
    // The grain is a multiplier around one, so it has to stay within half
    // either side of the middle of the byte: a map that swings further is a
    // map that paints rather than shades.
    assert.ok(lo >= 64 && hi <= 192, `${kind} grain runs ${lo} to ${hi}`);
    assert.ok(darkest >= 0, `${kind} occlusion is a byte`);
  }
});

test('every material has a layer and a scale, and they agree', () => {
  const names = Object.keys(SURFACE_LAYER);
  for (const name of names) {
    assert.equal(typeof SURFACE_SCALE[name], 'number', `${name} has a scale`);
    assert.ok(SURFACE_SCALE[name] > 0.5 && SURFACE_SCALE[name] < 12, `${name} scale is metres`);
  }
  const indices = names.map((n) => SURFACE_LAYER[n]).sort((a, b) => a - b);
  assert.deepEqual(indices, names.map((_, i) => i), 'the layers are 0 upwards with no gaps');
});

test('the whole set packs into one array texture', () => {
  const built = buildSurfaceMaps(SIZE);
  assert.equal(built.layers, Object.keys(SURFACE_LAYER).length);
  assert.equal(built.data.length, SIZE * SIZE * 4 * built.layers);
  assert.equal(built.size, SIZE);
  // And the layer a material claims is the layer its bytes are at.
  const asphalt = surfaceLayer('asphalt', SIZE);
  const at = SURFACE_LAYER.asphalt * SIZE * SIZE * 4;
  assert.deepEqual(Array.from(built.data.slice(at, at + 64)), Array.from(asphalt.slice(0, 64)));
});

test('the default size is a power of two, so it has a whole mip chain', () => {
  assert.equal(SURFACE_SIZE & (SURFACE_SIZE - 1), 0, `${SURFACE_SIZE} is a power of two`);
});
