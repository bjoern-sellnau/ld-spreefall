// Raycast tests against the real world bundle. Skipped when the bundle has not
// been built, because it is generated output rather than something in the tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { World } from '../../src/engine/world.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PUB = path.join(ROOT, 'public');
const INDEX_PATH = path.join(PUB, 'world.json');
const CORE_BIN = path.join(PUB, 'world-core.bin');
const CORE_JSON = path.join(PUB, 'world-core.json');
const built = fs.existsSync(INDEX_PATH) && fs.existsSync(CORE_BIN) && fs.existsSync(CORE_JSON);

/**
 * The middle district, read off the disk and handed to the world the same way
 * a fetch would hand it over. Everything these tests ask about stands in it.
 */
function loadWorld() {
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const world = new World(index);
  const manifest = JSON.parse(fs.readFileSync(CORE_JSON, 'utf8'));
  const buf = fs.readFileSync(CORE_BIN);
  world.adopt(world.entryFor('core'), manifest,
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return world;
}

const opts = built ? {} : { skip: 'run npm run world first' };

test('a ray straight down lands on the ground', opts, () => {
  const w = loadWorld();
  const ground = w.groundHeight(81, 0);
  const h = w.raycast(81, 50, 0, 0, -1, 0, 200);
  assert.ok(h, 'something was hit');
  assert.equal(h.kind, 'ground');
  assert.ok(Math.abs(h.y - ground) < 0.35, `hit at ${h.y}, ground at ${ground}`);
  assert.ok(h.ny > 0.9, 'the ground normal points up');
});

test('a ray straight up leaves the city', opts, () => {
  const w = loadWorld();
  assert.equal(w.raycast(81, 2, 0, 0, 1, 0, 300), null);
});

// The Gate stands across x = 0 with its middle at z 3.3: five passages with
// four cross walls between them, the nearest at z -2.6 and 9.3.
test('a cross wall of the Brandenburg Gate stops a bullet fired west from the spawn', opts, () => {
  const w = loadWorld();
  // The spawn is on Pariser Platz, 81 m east of the Gate.
  const h = w.raycast(81, 6, -2.6, -1, 0, 0, 200);
  assert.ok(h, 'the Gate was hit');
  assert.equal(h.kind, 'wall');
  assert.ok(h.t > 60 && h.t < 95, `hit at ${h.t} m, expected somewhere near 80`);
  assert.ok(h.nx > 0.5, 'the wall normal faces back down the ray');
});

test('line of sight is clear across open ground and blocked by the Gate', opts, () => {
  const w = loadWorld();
  // Both ends on the open part of Pariser Platz, clear of the Adlon.
  assert.equal(w.lineOfSight(100, 2, 0, 140, 2, 0), true, 'across the square');
  // Into a cross wall of the Gate, which stands at x 0.
  assert.equal(w.lineOfSight(60, 3, -2.6, -60, 3, -2.6), false, 'into a wall of the Gate');
});

test('the middle passage of the Gate is open, and so is the next one', opts, () => {
  const w = loadWorld();
  assert.equal(w.lineOfSight(30, 1.7, 3.3, -30, 1.7, 3.3), true, 'the carriageway');
  assert.equal(w.lineOfSight(30, 1.7, 15.2, -30, 1.7, 15.2), true, 'the passage north of it');
  // Over the passages the attic is still there.
  const up = w.raycast(0, 1.7, 3.3, 0, 1, 0, 40);
  assert.ok(!up || up.t > 12, 'nothing low over the carriageway');
});

test('the Fernsehturm shaft is hit from two hundred metres', opts, () => {
  const w = loadWorld();
  const h = w.raycast(2148 - 200, 60, -500, 1, 0, 0, 400);
  assert.ok(h, 'the shaft was hit');
  assert.ok(Math.abs(h.t - 185) < 40, `hit at ${h.t} m`);
});

test('raycasting is cheap enough to hitscan with', opts, () => {
  const w = loadWorld();
  const N = 4000;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    w.raycast(300, 3, -40, Math.cos(a), -0.1 + (i % 7) * 0.03, Math.sin(a), 300);
  }
  const perRay = (Date.now() - t0) * 1000 / N;
  assert.ok(perRay < 400, `${perRay.toFixed(1)} microseconds per ray`);
});
