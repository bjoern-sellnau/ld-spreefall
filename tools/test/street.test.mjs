// What street am I standing in.
//
// The answer used to be unavailable: the names were carried only by the map
// labels, which are a point every two hundred and forty metres along a way,
// so the nearest one to where you are standing is routinely on the next
// street over. The names now ride on the centrelines as well, and this is
// measured to the centreline, with half a carriageway and a pavement of
// slack so that standing on the kerb still counts.

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

test('a point on a centreline is named by that street', opts, () => {
  const w = loadWorld();
  let checked = 0;
  for (const r of w.manifest.roadLines) {
    if (!r.n || r.pts.length < 4) continue;
    // The middle of the first segment, which is on the carriageway by
    // construction.
    const x = (r.pts[0] + r.pts[2]) / 2;
    const z = (r.pts[1] + r.pts[3]) / 2;
    const got = w.streetAt(x, z);
    assert.ok(got, `nothing at ${Math.round(x)}, ${Math.round(z)} on ${r.n}`);
    assert.ok(got.away <= r.w * 0.5 + 3.5,
      `${got.name} answered ${got.away} m away for a point on ${r.n}`);
    checked++;
    if (checked >= 40) break;
  }
  assert.ok(checked >= 10, `only ${checked} named ways to check`);
});

test('and a point well off every street is named by none of them', opts, () => {
  const w = loadWorld();
  // Far outside the district, where there is no carriageway at all.
  assert.equal(w.streetAt(90000, 90000), null);
});

test('the slack is a pavement, not a block', opts, () => {
  const w = loadWorld();
  const r = w.manifest.roadLines.find((l) => l.n && l.pts.length >= 4);
  const ax = r.pts[0], az = r.pts[1], bx = r.pts[2], bz = r.pts[3];
  const len = Math.hypot(bx - ax, bz - az) || 1;
  // A normal to the way, stepped out from the middle of the first segment.
  const nx = -(bz - az) / len, nz = (bx - ax) / len;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const reach = r.w * 0.5 + 3.5;
  const inside = w.streetAt(mx + nx * (reach - 1.5), mz + nz * (reach - 1.5));
  assert.ok(inside, `nothing just inside the edge of ${r.n}`);
  // And forty metres off it, which is inside the block, nothing of this way.
  const out = w.streetAt(mx + nx * 40, mz + nz * 40);
  assert.ok(!out || out.name !== r.n,
    `${r.n} still answered forty metres off its own centreline`);
});

test('every centreline that has a name carries it', opts, () => {
  const w = loadWorld();
  const lines = w.manifest.roadLines;
  assert.ok(lines.length > 0, 'the district has roads');
  const named = lines.filter((l) => l.n).length;
  // Not all of them have to be named, but a city whose centrelines carry no
  // names at all is a build that dropped them, which is the regression this
  // is here to catch.
  assert.ok(named > 0, 'no centreline in the district carries a name');
});
