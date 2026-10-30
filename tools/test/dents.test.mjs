// The damage model's arithmetic: which side a hit lands on, a ray against the
// turned box, glass above the waistline, a nose that loses its lights and then
// its bumper, a blast that dents the side facing it, a crash that cracks the
// windscreen, and the engine that smokes, goes black and burns.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DENTS, BROKE, HULLS, ZONE, freshDamage, toLocal, zoneOf, boxHit, hitAt, blastFrom, crash, engineState, packHoles }
  from '../../src/game/dents.js';

const car = (yaw = 0) => freshDamage({ x: 10, y: 0, z: 20, yaw, health: 320, maxHealth: 320 });

test('the nose is minus z in its own frame, whichever way it faces', () => {
  for (const yaw of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
    const v = car(yaw);
    // Two metres along the way it goes is two metres in front of it.
    const p = toLocal(v, v.x - Math.sin(yaw) * 2, 1, v.z - Math.cos(yaw) * 2);
    assert.ok(Math.abs(p.z + 2) < 1e-9 && Math.abs(p.x) < 1e-9, `${yaw}: ${p.x} ${p.z}`);
    assert.equal(zoneOf(HULLS.car, p.x, p.z), ZONE.front);
  }
  const H = HULLS.car;
  assert.equal(zoneOf(H, 0.2, 2.1), ZONE.rear);
  assert.equal(zoneOf(H, -0.85, 0.5), ZONE.left);
  assert.equal(zoneOf(H, 0.85, -0.5), ZONE.right);
});

test('a ray finds the turned box, and goes over the roof of it', () => {
  const v = car(Math.PI / 2);
  // Facing minus x now. A shot along z through its middle at door height
  // goes in through its side.
  const h = boxHit(v, HULLS.car, 10, 0.7, 0, 0, 0, 1, 100);
  assert.ok(h && Math.abs(h.t - (20 - 0.9)) < 1e-6, h && h.t);
  assert.equal(zoneOf(HULLS.car, h.lx, h.lz), ZONE.right);
  // Two metres up it misses, and the sphere it used to be would have hit.
  assert.equal(boxHit(v, HULLS.car, 10, 2.0, 0, 0, 0, 1, 100), null);
  // From in front, along its length, it goes in through the nose.
  const n = boxHit(v, HULLS.car, 0, 0.7, 20, 1, 0, 0, 100);
  assert.ok(n && Math.abs(n.t - (10 - 2.25)) < 1e-6);
  assert.equal(zoneOf(HULLS.car, n.lx, n.lz), ZONE.front);
});

test('rounds into the nose push it in, then the lights go, then the bumper', () => {
  const v = car();
  const H = HULLS.car;
  // A rifle round is 26: about a fifth of a per cent of its hull each.
  let first = null;
  for (let i = 0; i < 40; i++) {
    const r = hitAt(v, H, 0, 0.6, -2.25, 26);
    if (r.broke & BROKE.headlights && first === null) first = i;
  }
  assert.ok(first !== null && first > 0, `lights went on round ${first}`);
  assert.ok(v.broke & BROKE.frontBumper);
  assert.equal(v.dent[ZONE.front], 1);
  // Nothing else was touched.
  assert.equal(v.dent[ZONE.rear], 0);
  assert.equal(v.broke & (BROKE.taillights | BROKE.rearBumper), 0);
});

test('above the waistline a round goes through the glass on that side, and only that side', () => {
  const v = car();
  const H = HULLS.car;
  const low = hitAt(v, H, 0.9, 0.5, 0.2, 26);
  assert.equal(low.broke, 0);
  const high = hitAt(v, H, 0.9, 1.1, 0.2, 26);
  assert.equal(high.zone, ZONE.right);
  assert.equal(high.broke, BROKE.right);
  // And the second round through it breaks nothing new.
  assert.equal(hitAt(v, H, 0.9, 1.1, 0.2, 26).broke, 0);
  assert.equal(hitAt(v, H, 0, 1.1, -1.0, 26).broke & BROKE.screen, BROKE.screen);
});

test('a blast pushes in the side facing it and blows its glass in, and not the far side', () => {
  const v = car();
  // Five metres off its left side, a third of its hull.
  const broke = blastFrom(v, HULLS.car, v.x - 5, v.z, 320 / 3);
  assert.ok(v.dent[ZONE.left] > 0.3, `left ${v.dent[ZONE.left]}`);
  assert.equal(v.dent[ZONE.right], 0);
  assert.ok(broke & BROKE.left);
  assert.equal(broke & BROKE.right, 0);
});

test('a crash pushes in the end that hit, and a hard one cracks the windscreen', () => {
  const v = car();
  assert.equal(crash(v, 4) & BROKE.screen, 0);
  assert.ok(Math.abs(v.dent[ZONE.front] - 4 * DENTS.crashPerSpeed) < 1e-9);
  const b = crash(v, 14);
  assert.ok(b & BROKE.screen);
  assert.ok(b & BROKE.headlights);
  const r = car();
  crash(r, 10, false);
  assert.ok(r.dent[ZONE.rear] > 0 && r.dent[ZONE.front] === 0);
});

test('the engine smokes, goes black and then burns as the hull runs down', () => {
  const v = car();
  assert.equal(engineState(v), null);
  v.health = 320 * 0.5; assert.equal(engineState(v), 'smoke');
  v.health = 320 * 0.2; assert.equal(engineState(v), 'black');
  v.health = 320 * 0.1; assert.equal(engineState(v), 'fire');
  v.health = 0; assert.equal(engineState(v), null);
});

test('a car takes most of a magazine to set alight, and a tank almost nothing', () => {
  // The rifle's 34 a round, and the half again everything you fire carries.
  const rounds = (type, health) => Math.ceil(health * (1 - 0.15) / (34 * 1.5 * HULLS[type].bullets));
  const car = rounds('car', 320), jeep = rounds('jeep', 420), bus = rounds('bus', 1100), tank = rounds('tank', 2600);
  assert.ok(car >= 15 && car <= 30, `car ${car}`);
  assert.ok(jeep >= 15 && jeep <= 30, `jeep ${jeep}`);
  assert.ok(bus > 60, `bus ${bus}`);
  assert.ok(tank > 1000, `tank ${tank}`);
  // And it has no glass to break.
  const t = freshDamage({ x: 0, y: 0, z: 0, yaw: 0, health: 2600, maxHealth: 2600 });
  assert.equal(hitAt(t, HULLS.tank, 0, 2.0, -3.3, 26).broke, 0);
});

test('a round leaves a hole and only a quarter of the dent a blow would, and the holes are counted to fifteen', () => {
  const v = car();
  const H = HULLS.car;
  hitAt(v, H, 0.9, 0.5, 0.2, 32, true);
  assert.equal(v.holes[ZONE.right], 1);
  const shot = v.dent[ZONE.right];
  const w = car();
  hitAt(w, H, 0.9, 0.5, 0.2, 32, false);
  assert.ok(Math.abs(shot - w.dent[ZONE.right] * DENTS.bulletDent) < 1e-9);
  assert.equal(w.holes[ZONE.right], 0);
  for (let i = 0; i < 30; i++) hitAt(v, H, 0.9, 0.5, 0.2, 32, true);
  assert.equal(v.holes[ZONE.right], 15);
  // Packed four bits a side for the shader.
  v.holes = [1, 2, 3, 15];
  assert.equal(packHoles(v), 1 + 2 * 16 + 3 * 256 + 15 * 4096);
});
