// The cheat menu's guide: every setting in the menu is in it, in the menu's
// order, each with a word about what it does, the numbers with where they go
// from and to and where they start, and none of it written with a dash.

import test from 'node:test';
import assert from 'node:assert/strict';

import { GUIDE_GROUPS, CONTROL_HELP, buildGuide } from '../../src/game/guide.js';
import { SWITCHES, GORE, ACTIONS, SPAWNS, RIDES, SETTINGS, BOWS, BOW_HOLDS } from '../../src/game/cheats.js';
import { KINDS, RANDOM, WEATHER } from '../../src/game/weather.js';
import { EXTREME } from '../../src/game/extreme.js';
import { CHASSIS } from '../../src/game/chassis.js';

const data = () => ({
  actions: ACTIONS, spawns: SPAWNS, rides: RIDES, settings: SETTINGS, switches: SWITCHES, gore: GORE,
  bows: BOWS, bowHolds: BOW_HOLDS,
  chassis: {
    mine: CHASSIS.map((c) => ({ id: c.id, label: c.name, help: c.role })),
    foe: [...CHASSIS.map((c) => ({ id: c.id, label: c.name, help: c.role })), { id: 'random', label: 'Random', help: 'a different one every time' }],
  },
  weatherKinds: [...KINDS, RANDOM],
  weatherLimits: WEATHER,
  extremeKinds: EXTREME.kinds,
  extremeLimits: EXTREME,
});

test('every list the menu is built from comes with a word about each thing in it', () => {
  for (const [name, list] of Object.entries({ SWITCHES, GORE, ACTIONS, SPAWNS, RIDES, SETTINGS, BOWS, BOW_HOLDS, KINDS })) {
    for (const x of list) assert.ok(typeof x.help === 'string' && x.help.length >= 20, `${name} ${x.id} says what it does`);
  }
  assert.ok(RANDOM.help.length >= 20);
  for (const [id, k] of Object.entries(EXTREME.kinds)) assert.ok(k.help && k.help.length >= 20, `${id} says what it does`);
  for (const [id, h] of Object.entries(CONTROL_HELP)) assert.ok(h.length >= 20, `${id} says what it does`);
});

test('the guide has every group of the menu, in its order, and every setting in each', () => {
  const g = buildGuide(data());
  assert.deepEqual(g.map((s) => s.id), GUIDE_GROUPS.map((s) => s.id));
  const count = (id) => g.find((s) => s.id === id).items.length;
  assert.equal(count('actions'), ACTIONS.length);
  assert.equal(count('spawns'), SPAWNS.length);
  assert.equal(count('rides'), RIDES.length);
  assert.equal(count('mine'), CHASSIS.length);
  assert.equal(count('foe'), CHASSIS.length + 1);
  assert.equal(count('bow'), BOWS.length + BOW_HOLDS.length);
  assert.equal(count('values'), SETTINGS.length);
  assert.equal(count('switches'), SWITCHES.length);
  assert.equal(count('gore'), GORE.length);
  // The weather: off, every kind, random, strength, how often, lightning.
  assert.equal(count('weather'), 1 + KINDS.length + 1 + 3);
  // The extreme weather: each kind, all, how often, and one now.
  assert.equal(count('extreme'), Object.keys(EXTREME.kinds).length + 3);
  for (const s of g) {
    assert.ok(s.title && s.about.length > 20, `${s.id} has a title and a line about it`);
    for (const it of s.items) assert.ok(it.label && it.help && it.help.length >= 10, `${s.id}: ${it.label}`);
  }
});

test('the numbers say where they go from and to, and where they start', () => {
  const values = buildGuide(data()).find((s) => s.id === 'values').items;
  const bones = values.find((v) => v.label === 'Skeletons collapse after');
  assert.equal(bones.range, 'never to 120 s');
  assert.equal(bones.start, '18 s');
  const radius = values.find((v) => v.label === 'Warhead radius');
  assert.equal(radius.range, '60 m to 900 m');
  assert.equal(radius.start, '170 m');
  // And the switches where they start: the two destruction switches on.
  const sw = buildGuide(data()).find((s) => s.id === 'switches').items;
  assert.equal(sw.find((x) => x.label === 'Buildings can be destroyed').start, 'on');
  assert.equal(sw.find((x) => x.label === 'God mode').start, 'off');
});

test('and what each is at now, when the game says', () => {
  const d = data();
  d.now = {
    value: (id) => (id === 'nukeRadius' ? 400 : SETTINGS.find((s) => s.id === id).def),
    on: (id) => id === 'godmode', mine: CHASSIS[1].id, foe: 'random', bow: 'tech', bowHold: 'flat',
    weather: 'storm', weatherOff: false, intensity: 1.5, minutes: 6, lightning: false,
    extreme: { acid: true }, extremeMinutes: 3, tod: '20:12',
  };
  const g = buildGuide(d);
  const item = (sid, label) => g.find((s) => s.id === sid).items.find((x) => x.label === label);
  assert.equal(item('values', 'Warhead radius').now, '400 m');
  assert.equal(item('switches', 'God mode').now, 'on');
  assert.equal(item('mine', CHASSIS[1].name).now, 'picked');
  assert.equal(item('foe', 'Random').now, 'picked');
  assert.equal(item('weather', 'Storm').now, 'picked');
  assert.equal(item('weather', 'Weather strength').now, '150 %');
  assert.equal(item('extreme', 'Säureregen (acid rain)').now, 'on');
  assert.equal(item('extreme', 'Ionensturm (ion storm)').now, 'off');
  assert.equal(item('tod', 'Time of day').now, '20:12');
});

test('none of it is written with a dash', () => {
  const g = buildGuide(data());
  const text = JSON.stringify(g) + JSON.stringify(CONTROL_HELP);
  assert.ok(!/[\u2013\u2014]/.test(text), 'no en or em dash');
});
