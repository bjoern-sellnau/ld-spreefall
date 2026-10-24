// The weather's arithmetic: blends that add haze as extinction, random
// weather that goes to a neighbouring kind and snows only in the cold
// months, a street that gets wet and dries, lightning with its thunder a
// distance late, and the cheat menu's off, strength and lightning.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Weather, WEATHER, KINDS, mixLooks, nextKind } from '../../src/game/weather.js';

const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test('half way from clear to fog is a few hundred metres to see, not ten kilometres', () => {
  const m = mixLooks('clear', 'fog', 0.5);
  assert.ok(m.visibility > 180 && m.visibility < 400, `${m.visibility.toFixed(0)} m`);
  // And the ends are what the table says.
  assert.equal(Math.round(mixLooks('clear', 'fog', 0).visibility), WEATHER.visibility.clear);
  assert.equal(Math.round(mixLooks('clear', 'fog', 1).visibility), WEATHER.visibility.fog);
  // Koschmieder: 3.912 over the extinction.
  assert.ok(Math.abs(m.extinction * m.visibility - 3.912) < 1e-9);
});

test('random weather goes to a neighbour, and snows in winter only', () => {
  for (const kind of KINDS.map((k) => k.id)) {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const n = nextKind(kind, () => r, 166);
      assert.notEqual(n, kind);
      assert.notEqual(n, 'snow', `${kind} went to snow in June`);
    }
  }
  // A clear sky does not go straight to a storm.
  for (const r of [0, 0.2, 0.5, 0.8, 0.99]) assert.notEqual(nextKind('clear', () => r, 166), 'storm');
  // In January rain is snow.
  const jan = new Set([0, 0.2, 0.4, 0.6, 0.8, 0.99].map((r) => nextKind('cloudy', () => r, 15)));
  assert.ok(jan.has('snow') && !jan.has('rain'), [...jan].join(','));
});

test('picking a kind blends to it over half a minute', () => {
  const w = new Weather();
  w.choose('clear'); w.snap();
  w.choose('rain');
  w.update(WEATHER.blend / 2);
  const mid = w.now();
  assert.ok(mid.rain > 0.2 && mid.rain < 0.45, `rain ${mid.rain}`);
  w.update(WEATHER.blend);
  assert.equal(w.now().rain, WEATHER.looks.rain.rain);
  assert.equal(w.now().kind, 'rain');
});

test('random weather holds a while and then turns, and says so', () => {
  const w = new Weather();
  w.setMinutes(1);
  w.choose('clear'); w.snap();
  const said = [];
  w.onChange = (k) => said.push(k);
  w.choose('random', () => 0.5);
  // It holds between half and one and a half times the minutes.
  w.update(25, () => 0.5);
  assert.equal(said.length, 0);
  w.update(40, seq(0.1, 0.5));
  assert.equal(said.length, 1);
  assert.notEqual(said[0], 'clear');
});

test('the street gets wet in the rain, dries after; snow settles and melts', () => {
  const w = new Weather();
  w.choose('rain'); w.snap();
  w.wet = 0;
  for (let i = 0; i < 60; i++) w.update(1);
  assert.equal(w.wet, 1);
  w.choose('clear'); w.snap(); w.wet = 1;
  w.update(WEATHER.drying / 2);
  assert.ok(w.wet > 0.4 && w.wet < 0.6, `wet ${w.wet}`);
  w.choose('snow'); w.snap(); w.cover = 0;
  w.update(WEATHER.settling / 2);
  assert.ok(Math.abs(w.cover - 0.5) < 0.01, `cover ${w.cover}`);
});

test('a storm strikes, the flash comes at once and the thunder a distance late', () => {
  const w = new Weather();
  w.choose('storm'); w.snap();
  w.strikeIn = 0;
  const strikes = [];
  w.onStrike = (s) => strikes.push(s);
  w.update(0.1, () => 0.5);
  assert.equal(strikes.length, 1);
  const s = strikes[0];
  assert.ok(s.distance >= WEATHER.strikeNear && s.distance <= WEATHER.strikeFar);
  assert.ok(Math.abs(s.delay - s.distance / 343) < 1e-9, `${s.delay} s for ${s.distance} m`);
  assert.ok(w.flash > 0.2);
  // About three seconds a kilometre.
  assert.ok(Math.abs(1000 / WEATHER.sound - 2.9) < 0.1);
});

test('the cheat menu: off is clear whatever was picked, strength scales it, and no lightning is none', () => {
  const w = new Weather();
  w.choose('storm'); w.snap();
  w.setOff(true); w.snap();
  assert.equal(w.now().kind, 'clear');
  assert.equal(w.now().rain, 0);
  w.setOff(false); w.snap();
  assert.equal(w.now().kind, 'storm');
  w.setIntensity(0.5);
  assert.equal(w.now().rain, 0.5);
  assert.ok(w.now().visibility > WEATHER.visibility.storm);
  w.setIntensity(1);
  w.setLightning(false);
  w.strikeIn = 0;
  let struck = 0;
  w.onStrike = () => struck++;
  for (let i = 0; i < 100; i++) w.update(1);
  assert.equal(struck, 0);
  assert.equal(w.now().lightning, 0);
});

test('a random start begins in one of the kinds, and never in snow in June', () => {
  const w = new Weather();
  w.choose('random');
  for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
    w.start(() => r, 166);
    assert.ok(KINDS.some((k) => k.id === w.to));
    assert.notEqual(w.to, 'snow');
  }
  w.start(() => 0.99, 15);
  assert.ok(['snow', 'fog', 'cloudy', 'clear'].includes(w.to));
});

test('a strike is a few strokes down one channel, about sixty milliseconds apart', () => {
  const w = new Weather();
  w.choose('storm'); w.snap();
  w.strikeIn = 0;
  let strikes = 0, restrokes = 0, told = 0;
  w.onStrike = (s) => { strikes++; told = s.strokes; };
  w.onRestroke = () => restrokes++;
  w.update(0.001, () => 0.5);
  assert.equal(strikes, 1);
  // Half way through the draw is the mean, 3.9 rounded.
  assert.equal(told, 4);
  w.strikeIn = 99;
  // One stroke every interstroke on average: three more within a fifth of a
  // second, and then no more.
  for (let i = 0; i < 20; i++) w.update(0.01, () => 0.5);
  assert.equal(restrokes, 3);
  for (let i = 0; i < 50; i++) w.update(0.01, () => 0.5);
  assert.equal(restrokes, 3);
  // Turning the lightning off stops a strike part way.
  w.strikeIn = 0; w.update(0.001, () => 0.5);
  w.setLightning(false);
  for (let i = 0; i < 50; i++) w.update(0.01, () => 0.5);
  assert.equal(restrokes, 3);
  assert.ok(Math.abs(WEATHER.interstroke - 0.0615) < 1e-9);
});
