// The city's own systems: where the steam pipes come up, what a cover does
// when the phone gets into it, what a blast does to what is near it, and the
// blackout's clock.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roadIndex, junctionsOf } from '../../src/game/traffic.js';
import { CITY, pipesOf, pipeStep, pipeState, pipeReady, blastOn, Blackout } from '../../src/game/city.js';

const LINES = [
  { cls: 'secondary', w: 12, pts: [-400, 0, 400, 0] },
  { cls: 'residential', w: 8, pts: [0, -300, 0, 300] },
  // The same street twice, a metre apart, the way the map has a dual carriageway.
  { cls: 'tertiary', w: 8, pts: [-400, 200, 400, 200] },
  { cls: 'tertiary', w: 8, pts: [-400, 201, 400, 201] },
  { cls: 'footway', w: 3, pts: [-400, 100, 400, 100] },
];

test('covers along the carriageways, every so far, none in a junction and none on top of another', () => {
  const idx = roadIndex(LINES);
  const js = junctionsOf(idx);
  const pipes = pipesOf(idx, js);
  assert.ok(pipes.length > 20, `${pipes.length} covers`);
  for (const p of pipes) {
    const onLine = Math.abs(p.z) < 1e-6 || Math.abs(p.x) < 1e-6 || Math.abs(p.z - 200) < 1e-6 || Math.abs(p.z - 201) < 1e-6;
    assert.ok(onLine, `on a carriageway, ${p.x},${p.z}`);
    assert.ok(Math.abs(p.z - 100) > 1, 'never on a footway');
    for (const j of js) assert.ok(Math.hypot(j.x - p.x, j.z - p.z) >= j.r + CITY.pipes.clear, 'never in a junction');
    for (const q of pipes) if (q !== p) assert.ok(Math.hypot(q.x - p.x, q.z - p.z) >= CITY.pipes.apart, 'never two together');
  }
  // Along one street they come every so far.
  const along = pipes.filter((p) => Math.abs(p.z) < 1e-6).map((p) => p.x).sort((a, b) => a - b);
  const gaps = along.slice(1).map((x, i) => x - along[i]);
  assert.ok(gaps.some((g) => Math.abs(g - CITY.pipes.every) < 1e-6), gaps.join(','));
  // And the same map gives the same covers.
  assert.deepEqual(pipesOf(idx, js).map((p) => [p.x, p.z]), pipes.map((p) => [p.x, p.z]));
});

test('a cover vents for a while; blown, it goes on its fuse, and is spent for a while after', () => {
  const p = { x: 0, z: 0, vent: CITY.pipes.vent, fuse: 0, spent: 0 };
  assert.equal(pipeState(p), 1);
  for (let k = 0; k < CITY.pipes.vent * 10 + 2; k++) pipeStep(p, 0.1);
  assert.equal(pipeState(p), 0, 'and stops');
  p.fuse = CITY.pipes.fuse;
  assert.equal(pipeState(p), 2);
  assert.equal(pipeReady(p), false, 'nothing more to do with it while it hisses');
  const events = [];
  for (let k = 0; k < 30; k++) { const e = pipeStep(p, 0.1); if (e) events.push(e); }
  assert.deepEqual(events, ['blow'], 'it goes once');
  assert.equal(pipeState(p), 3);
  assert.equal(pipeReady(p), false);
  for (let k = 0; k < CITY.pipes.spent * 10 + 2; k++) pipeStep(p, 0.1);
  assert.equal(pipeReady(p), true, 'and is a cover again');
});

test('a blast throws up and out what is near it, hardest in the middle, and nothing past its edge', () => {
  const p = { x: 0, z: 0 };
  const mid = blastOn(p, 0, 0), edge = blastOn(p, CITY.blast.radius * 0.9, 0);
  assert.ok(mid && edge);
  assert.ok(mid.up > edge.up && mid.share > edge.share);
  assert.ok(edge.dx > 0.99, 'out, away from the cover');
  assert.equal(blastOn(p, CITY.blast.radius + 0.5, 0), null);
});

test('a blackout: out at once, for its time, not twice at once, and back with a flicker', () => {
  const b = new Blackout();
  assert.equal(b.start(), true);
  assert.equal(b.start(), false, 'not while it is already out');
  b.update(0.2);
  assert.equal(b.out, 1);
  let back = null;
  for (let t = 0; t < CITY.blackout.seconds + 1 && !back; t += 0.05) back = b.update(0.05);
  assert.equal(back, 'back');
  assert.equal(b.on, false);
  const seen = new Set();
  for (let t = 0; t < 0.6; t += 0.01) { b.update(0.01); seen.add(b.out > 0.6 ? 'dark' : 'lit'); }
  assert.ok(seen.has('dark') && seen.has('lit'), 'a flicker on the way back');
  for (let t = 0; t < 3; t += 0.05) b.update(0.05);
  assert.equal(b.out, 0, 'and the lights are on');
});
