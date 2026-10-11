// Raycast tests against the real world bundle. Skipped when the bundle has not
// been built, because it is generated output rather than something in the tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { World } from '../../src/engine/world.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(ROOT, 'public', 'world.bin');
const JSON_PATH = path.join(ROOT, 'public', 'world.json');
const built = fs.existsSync(BIN) && fs.existsSync(JSON_PATH);

function loadWorld() {
  const manifest = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const buf = fs.readFileSync(BIN);
  return new World(manifest, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
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

test('the Brandenburg Gate stops a bullet fired west from the spawn', opts, () => {
  const w = loadWorld();
  // The spawn is on Pariser Platz, 81 m east of the Gate.
  const h = w.raycast(81, 6, 0, -1, 0, 0, 200);
  assert.ok(h, 'the Gate was hit');
  assert.equal(h.kind, 'wall');
  assert.ok(h.t > 60 && h.t < 95, `hit at ${h.t} m, expected somewhere near 80`);
  assert.ok(h.nx > 0.5, 'the wall normal faces back down the ray');
});

test('line of sight is clear across open ground and blocked by the Gate', opts, () => {
  const w = loadWorld();
  // Both ends on the open part of Pariser Platz, clear of the Adlon.
  assert.equal(w.lineOfSight(100, 2, 0, 140, 2, 0), true, 'across the square');
  // Straight through the Gate, which stands at x 0.
  assert.equal(w.lineOfSight(60, 3, 0, -60, 3, 0), false, 'through the Gate');
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
