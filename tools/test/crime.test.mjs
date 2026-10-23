// Crime: a theft and a fight, and every way they end.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CRIME, newCrime, crimeStep, repFor, stopped } from '../../src/game/crime.js';

/** Moves somebody the way a directive says, crudely. */
function move(who, d, dt) {
  if (!d || d.speed <= 0) return;
  const dx = d.x - who.x, dz = d.z - who.z, l = Math.hypot(dx, dz);
  if (l < 0.01) return;
  const s = Math.min(l, d.speed * dt);
  who.x += (dx / l) * s; who.z += (dz / l) * s;
}

function run(c, o, v, p, seconds, also = () => {}) {
  const events = [];
  for (let k = 0; k < seconds * 30 && !c.over; k++) {
    const r = crimeStep(c, 1 / 30, { o, v, p });
    move(o, r.offender, 1 / 30);
    move(v, r.victim, 1 / 30);
    events.push(...r.events);
    also(k, r);
  }
  return events;
}

test('a thief walks up, takes the bag and runs off, away from both of you', () => {
  const c = newCrime('theft');
  const o = { x: 0, z: 0, up: true }, v = { x: 12, z: 0, up: true }, p = { x: 30, z: 30 };
  const ev = run(c, o, v, p, 12);
  assert.ok(ev.includes('snatch'));
  assert.equal(c.phase, 'flee');
  assert.ok(Math.hypot(o.x - v.x, o.z - v.z) > 20, 'and is off and away');
});

test('a thief who gets far enough from you gets away, and that costs you', () => {
  const c = newCrime('theft');
  const o = { x: 0, z: 0, up: true }, v = { x: 1, z: 0, up: true }, p = { x: 10, z: 0 };
  const ev = run(c, o, v, p, 60);
  assert.ok(ev.includes('escaped'), ev.join(','));
  assert.ok(repFor('escaped') < 0);
  assert.equal(stopped('escaped'), false);
});

test('taken down he is subdued, shot he is killed, and either way it is over', () => {
  for (const [subdued, why] of [[true, 'subdued'], [false, 'killed']]) {
    const c = newCrime('theft');
    const o = { x: 0, z: 0, up: true }, v = { x: 1, z: 0, up: true }, p = { x: 5, z: 0 };
    run(c, o, v, p, 2);
    o.up = false; o.subdued = subdued;
    const ev = run(c, o, v, p, 1);
    assert.deepEqual(ev, [why]);
    assert.ok(stopped(why));
  }
  assert.ok(repFor('subdued') > repFor('killed'));
});

test('a fight: they square up and trade blows until one is down, or a phone rings', () => {
  const c = newCrime('brawl');
  const o = { x: 0, z: 0, up: true }, v = { x: 6, z: 0, up: true }, p = { x: 30, z: 0 };
  let hits = 0;
  const ev = run(c, o, v, p, 8, (k, r) => { hits += r.events.filter((e) => e === 'hit' || e === 'hitBack').length; });
  assert.equal(c.phase, 'fight');
  assert.ok(hits >= 5, `${hits} blows`);
  assert.ok(ev.includes('hitBack'), 'and the other one gives some back');
  v.up = false;
  assert.deepEqual(run(c, o, v, p, 1), ['victimDown']);
  assert.ok(repFor('victimDown') < 0);

  const d = newCrime('brawl');
  const o2 = { x: 0, z: 0, up: true }, v2 = { x: 1, z: 0, up: true };
  run(d, o2, v2, p, 2);
  o2.distracted = true;
  assert.deepEqual(run(d, o2, v2, p, 1), ['brokenUp']);
  assert.ok(stopped('brokenUp') && repFor('brokenUp') > 0);
});

test('nothing goes on for ever', () => {
  const c = newCrime('brawl');
  const o = { x: 0, z: 0, up: true }, v = { x: 1, z: 0, up: true }, p = { x: 5, z: 0 };
  const ev = run(c, o, v, p, CRIME.limit + 5);
  assert.ok(ev.includes('timeout'), ev.slice(-3).join(','));
});
