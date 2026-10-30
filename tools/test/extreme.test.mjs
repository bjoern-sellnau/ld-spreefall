// The extreme weather's bookkeeping: the warning word for word, twenty
// seconds of it counted down, the event coming on and going with the all
// clear, more than one at once, the dice only for what is switched on, a
// tornado that passes close, and the shelters: along the street, facing it,
// covering who stands under them while they stand.

import test from 'node:test';
import assert from 'node:assert/strict';

import { EXTREME, EXTREME_KINDS, Extreme, warningText, strength, tornadoPath } from '../../src/game/extreme.js';
import { SHELTERS, sheltersOf, covers, standIn, nearestShelter, hurtShelter, shelterLocal } from '../../src/game/shelters.js';

const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test('the warning says what is coming and how long there is, word for word', () => {
  assert.equal(warningText('acid'), 'Achtung: Säureregen wird erwartet in 20 Sekunden. Suchen Sie sich Schutz!');
  assert.equal(warningText('tornado', 4.2), 'Achtung: Wirbelsturm wird erwartet in 5 Sekunden. Suchen Sie sich Schutz!');
  assert.deepEqual(EXTREME_KINDS, ['acid', 'ion', 'tornado', 'fire']);
});

test('twenty seconds of warning, counted down, then it comes, and the all clear when it is over', () => {
  const x = new Extreme();
  const said = [];
  x.onSay = (text, kind, what) => said.push({ text, kind, what });
  const e = x.announce('acid', 0, 0, () => 0.5);
  assert.equal(said[0].what, 'warn');
  assert.equal(e.warnLeft, EXTREME.warn);
  for (let i = 0; i < 19 * 10; i++) x.update(0.1, { x: 0, z: 0 });
  assert.equal(strength(e), 0, 'nothing yet while the warning runs');
  assert.ok(said.some((s) => s.what === 'count' && /in 5 Sekunden/.test(s.text)));
  assert.ok(said.some((s) => s.what === 'count' && /in 1 Sekunden/.test(s.text)));
  for (let i = 0; i < 20; i++) x.update(0.1, { x: 0, z: 0 });
  assert.ok(said.some((s) => s.what === 'arrive'));
  // It comes on over the ramp, and covers the stretch round where it was.
  x.update(EXTREME.ramp, { x: 0, z: 0 });
  assert.equal(strength(e), 1);
  assert.equal(x.at('acid', 50, 50), 1);
  assert.equal(x.at('acid', 400, 0), 0);
  x.update(e.last, { x: 0, z: 0 });
  assert.equal(x.event('acid'), null);
  assert.equal(said[said.length - 1].what, 'clear');
  assert.match(said[said.length - 1].text, /^Entwarnung: Säureregen ist vorüber\.$/);
});

test('more than one at once, and the dice pick only from what is switched on', () => {
  const x = new Extreme();
  x.minutes = 1;
  x.enabled = { acid: false, ion: true, tornado: false, fire: true };
  x.nextIn = 0;
  x.update(0.1, { x: 0, z: 0 }, () => 0.1);
  x.nextIn = 0;
  x.update(0.1, { x: 0, z: 0 }, () => 0.1);
  const kinds = x.events.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['fire', 'ion']);
  // With both going, the dice have nothing left to start.
  x.nextIn = 0;
  x.update(0.1, { x: 0, z: 0 }, () => 0.9);
  assert.equal(x.events.length, 2);
  // Nothing switched on: nothing comes.
  const y = new Extreme();
  y.nextIn = 0;
  for (let i = 0; i < 100; i++) y.update(10, { x: 0, z: 0 });
  assert.equal(y.events.length, 0);
});

test('a tornado comes from a quarter of a kilometre off and passes within a few dozen metres', () => {
  for (const r of [0, 0.2, 0.5, 0.8, 0.99]) {
    const p = tornadoPath(100, -40, seq(r, 1 - r));
    assert.ok(Math.abs(Math.hypot(p.x - 100, p.z + 40) - EXTREME.kinds.tornado.from) < 1e-6);
    // The closest the line comes to where you were.
    const t = (100 - p.x) * p.dx + (-40 - p.z) * p.dz;
    const cx = p.x + p.dx * t, cz = p.z + p.dz * t;
    assert.ok(Math.hypot(cx - 100, cz + 40) <= EXTREME.kinds.tornado.miss + 1e-6);
  }
  const x = new Extreme();
  const e = x.announce('tornado', 0, 0, () => 0.3, 0);
  x.update(0.01, { x: 0, z: 0 });
  x.update(EXTREME.ramp, { x: 0, z: 0 });
  // Its core takes all of it, and the wind round it less.
  assert.equal(x.at('tornado', e.fx, e.fz), 1);
  const K = EXTREME.kinds.tornado;
  assert.ok(x.at('tornado', e.fx + (K.core + K.reach) / 2, e.fz) > 0 && x.at('tornado', e.fx + (K.core + K.reach) / 2, e.fz) < 1);
  assert.equal(x.at('tornado', e.fx + K.reach + 1, e.fz), 0);
  // And it moves.
  const was = { x: e.fx, z: e.fz };
  x.update(2, { x: 0, z: 0 });
  assert.ok(Math.abs(Math.hypot(e.fx - was.x, e.fz - was.z) - 2 * K.speed) < 1e-6);
});

// A straight road west to east, seven metres wide.
const road = { pts: [0, 0, 1000, 0], n: 2, w: 7 };

test('shelters stand along the street, past the kerb, apart, and facing it', () => {
  const list = sheltersOf({ roads: [road] }, [], () => true);
  assert.ok(list.length >= 6, `${list.length}`);
  for (const sh of list) {
    assert.ok(Math.abs(Math.abs(sh.z) - (3.5 + SHELTERS.side)) < 1e-6);
    // Its own minus z points at the road.
    const toRoad = shelterLocal(sh, sh.x, 0);
    assert.ok(toRoad.z < 0, JSON.stringify(sh));
  }
  for (let i = 1; i < list.length; i++) assert.ok(Math.abs(list[i].x - list[i - 1].x) >= SHELTERS.apart - 1e-6);
  assert.ok(list.some((s) => s.kind === 'stop') && list.some((s) => s.kind === 'kiosk'));
  // Not where there is no room.
  assert.equal(sheltersOf({ roads: [road] }, [], () => false).length, 0);
  // And not at a junction.
  const j = list[0];
  assert.ok(!sheltersOf({ roads: [road] }, [{ x: j.x, z: 0, r: 8 }], () => true).some((s) => Math.abs(s.x - j.x) < 1));
});

test('under the roof is out of it, beside it is not, and a shelter brought down covers nobody', () => {
  const [stop] = sheltersOf({ roads: [road] }, [], () => true).filter((s) => s.kind === 'stop');
  for (let k = 0; k < 3; k++) {
    const p = standIn(stop, k);
    assert.ok(covers(stop, p.x, 0.1, p.z), `spot ${k}`);
  }
  // Three metres along the street is out in it.
  const c = Math.cos(stop.yaw), s = Math.sin(stop.yaw);
  assert.equal(covers(stop, stop.x + c * 3, 0.1, stop.z - s * 3), false);
  // On its roof is not under it.
  const p = standIn(stop);
  assert.equal(covers(stop, p.x, 3.0, p.z), false);
  assert.equal(nearestShelter([stop], p.x + 30, p.z), stop);
  assert.equal(hurtShelter(stop, 40), false);
  assert.equal(hurtShelter(stop, 70), true);
  assert.equal(covers(stop, p.x, 0.1, p.z), false);
  assert.equal(nearestShelter([stop], p.x, p.z), null);
});
