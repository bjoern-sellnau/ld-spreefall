// The weather: picked on the title page, turned in the cheat menu, and what
// each kind does to the street.
//
// What is checked is what you would notice: rain and snow fall round you, a
// wet street and lying snow, fog that closes the view and with it how far a
// soldier sees you, a storm that strikes with the bolt on the skyline and the
// thunder a distance late, and the cheat menu's off, strength, how often
// random weather turns, and the lightning switch, none of which marks the run
// as cheated.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const URL_BASE = process.env.SPREEFALL_URL || 'http://localhost:8080/';

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  ' + detail : ''}`);
}

async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const pre = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({
    executablePath: fs.existsSync(pre) ? pre : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.spreefall, null, { timeout: 120000 });

  // --- the title page -----------------------------------------------------------
  const title = await page.evaluate(() => {
    const s = window.spreefall;
    const chips = [...document.querySelectorAll('#weatherchips button')];
    const rain = chips.find((b) => b.dataset.weather === 'rain');
    rain.click();
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('spreefall.weather')); } catch { /* none */ }
    return { mode: s.state.mode, ids: chips.map((b) => b.dataset.weather), on: chips.filter((b) => b.classList.contains('on')).map((b) => b.dataset.weather),
      label: document.getElementById('weatherlabel').textContent, to: s.weather.to, k: s.weather.k, stored: stored && stored.choice };
  });
  check('the title page offers every kind of weather and random',
    ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow', 'random'].every((id) => title.ids.includes(id)), title.ids.join(' '));
  check('picking rain behind the title is rain at once, shown, and kept for next time',
    title.on.length === 1 && title.on[0] === 'rain' && title.label === 'Rain' && title.to === 'rain' && title.k === 1 && title.stored === 'rain',
    JSON.stringify(title));

  await page.evaluate(() => {
    const s = window.spreefall;
    s.skipToWalk();
    s.tiles.uploadsPerFrame = 500;
    s.drones.enabled = false;
    s.soldiers.enabled = false;
    s.jets.enabled = false;
    s.cheats.reset();
    s.teleport(81, 0);
    s.setQuality('low');
    s.look(95, 4);
  });
  await page.waitForTimeout(4000);

  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const set = (kind) => page.evaluate((k) => {
    const s = window.spreefall;
    s.weather.setOff(false);
    s.weather.setIntensity(1);
    s.weather.choose(k);
    s.weather.snap();
    s.weather.strikeIn = 99;
  }, kind);
  const read = () => page.evaluate(() => {
    const s = window.spreefall;
    const w = s.weatherNow();
    const c = s.renderer.cam;
    return { kind: w.kind, rain: w.rain, snow: w.snow, visibility: w.visibility, extinction: w.extinction,
      drawn: s.precipDrawn(), uWeather: [...c.slice(c.length - 4)],
      sight: s.soldiers.sightScale, wet: s.weather.wet, cover: s.weather.cover };
  });
  const fogUniform = () => page.evaluate(() => {
    const s = window.spreefall;
    return { fog: s.renderer.fogNow, density: s.renderer.fogDensity };
  });

  // --- rain ---------------------------------------------------------------------
  await set('rain');
  await frame();
  const rain = await read();
  check('in the rain the drops are drawn round you and the street is wet',
    rain.kind === 'rain' && rain.drawn > 1000 && rain.wet === 1 && rain.uWeather[1] === 1 && rain.uWeather[0] > 0.8,
    `${rain.drawn} drops, wet ${rain.wet}, cloud ${rain.uWeather[0].toFixed(2)}`);
  await page.screenshot({ path: path.join(SHOTS, 'weather-01-rain.png') });

  // --- fog ----------------------------------------------------------------------
  await set('fog');
  await frame();
  const fog = await read();
  const fogU = await fogUniform();
  check('fog closes the view to under two hundred metres, by Koschmieder',
    Math.abs(fog.visibility - 180) < 1 && Math.abs(fog.extinction * fog.visibility - 3.912) < 1e-6
      && Math.abs(fogU.fog - fog.extinction) < 1e-6 && fog.drawn === 0,
    `${fog.visibility.toFixed(0)} m, fog ${fogU.fog.toFixed(4)} against ${fogU.density}`);
  check('and a soldier sees you only as far as the fog lets him',
    fog.sight < 0.7 && fog.sight >= 0.3, `sight ${fog.sight.toFixed(2)} of a clear day`);
  await page.screenshot({ path: path.join(SHOTS, 'weather-02-fog.png') });

  // --- snow ---------------------------------------------------------------------
  await set('snow');
  await frame();
  const snow = await read();
  check('snow falls as flakes and lies on the street',
    snow.kind === 'snow' && snow.snow > snow.rain && snow.drawn > 1000 && snow.cover === 1 && snow.uWeather[3] === 1,
    `${snow.drawn} flakes, cover ${snow.cover}`);
  await page.screenshot({ path: path.join(SHOTS, 'weather-03-snow.png') });

  // --- a storm ------------------------------------------------------------------
  await set('storm');
  await frame();
  const storm = await page.evaluate(async () => {
    const s = window.spreefall;
    const before = s.state.strikes || 0;
    const strokesBefore = s.state.strokes || 0;
    // The next strike straight ahead, a kilometre and a half off, so the
    // picture has the bolt in it.
    const fwd = Math.atan2(s.camera.forward[0], s.camera.forward[2]);
    const orig = s.weather.onStrike;
    let told = 0;
    s.weather.onStrike = (e) => { s.weather.onStrike = orig; told = e.strokes; orig({ ...e, bearing: fwd, distance: 1500, delay: 1500 / 343 }); };
    s.weather.strikeIn = 0;
    await new Promise((r) => requestAnimationFrame(r));
    const bolt = s.effects.list.filter((p) => p.alive && p.kind === 0 && p.size > 1);
    // Held still for the picture: the strokes are gone in a quarter second.
    s.effects._update = s.effects.update;
    s.effects.update = () => {};
    return { strikes: (s.state.strikes || 0) - before, strokesBefore, told, bolt: bolt.length,
      top: Math.max(...bolt.map((p) => Math.max(p.ay, p.by))), thunder: s.audio.lastThunder, flash: s.weather.flash };
  });
  await page.screenshot({ path: path.join(SHOTS, 'weather-04-storm.png') });
  const after = await page.evaluate(async () => {
    const s = window.spreefall;
    s.effects.update = s.effects._update;
    s.weather.strikeIn = 99;
    await new Promise((r) => setTimeout(r, 1200));
    return { strokes: s.state.strokes || 0 };
  });
  check('a storm strikes: the bolt stands hundreds of metres tall on the skyline, and the sky flashes',
    storm.strikes === 1 && storm.bolt >= 9 && storm.top > 600 && storm.flash > 0.3,
    `${storm.bolt} pieces, top ${storm.top.toFixed(0)} m, flash ${storm.flash.toFixed(2)}`);
  check('the thunder is sent off three seconds a kilometre after the flash',
    storm.thunder && storm.thunder.distance === 1500 && Math.abs(storm.thunder.delay - 1500 / 343) < 1e-6,
    storm.thunder && `${storm.thunder.delay.toFixed(2)} s for ${storm.thunder.distance} m`);
  check('the bolt flickers: each stroke of the strike comes down the same channel',
    storm.told >= 1 && after.strokes - storm.strokesBefore === storm.told - 1,
    `${storm.told} strokes, ${after.strokes - storm.strokesBefore} after the first`);

  // --- the cheat menu -----------------------------------------------------------
  const cheat = await page.evaluate(async () => {
    const s = window.spreefall;
    s.cheats.reset();
    s.cheatMenu(true);
    const chip = (id) => document.querySelector(`#cheatweather button[data-wx=${id}]`);
    const out = { chips: [...document.querySelectorAll('#cheatweather button')].map((b) => b.dataset.wx) };
    chip('off').click();
    s.weather.snap();
    out.off = { off: s.weather.off, kind: s.weatherNow().kind, rain: s.weatherNow().rain, on: chip('off').classList.contains('on') };
    chip('off').click();
    s.weather.snap();
    out.back = s.weatherNow().kind;
    const slide = (id, v) => {
      const i = document.querySelector(`#cheatweathervalues input[data-wx=${id}]`);
      i.value = String(v);
      i.dispatchEvent(new Event('input'));
    };
    slide('intensity', 50);
    out.strength = { intensity: s.weather.intensity, rain: s.weatherNow().rain };
    slide('minutes', 2);
    out.minutes = s.weather.minutes;
    document.querySelector('#cheatweathervalues button[data-wx=lightning]').click();
    out.lightning = s.weather.lightning;
    s.weather.strikeIn = 0;
    const before = s.state.strikes || 0;
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
    out.struck = (s.state.strikes || 0) - before;
    document.querySelector('#cheatweathervalues button[data-wx=lightning]').click();
    chip('random').click();
    out.random = { choice: s.weather.choice, hold: s.weather.hold, on: chip('random').classList.contains('on') };
    out.cheated = s.cheats.used;
    slide('intensity', 100);
    s.cheatMenu(false);
    return out;
  });
  check('the cheat menu has off, every kind and random',
    ['off', 'clear', 'storm', 'snow', 'random'].every((id) => cheat.chips.includes(id)), cheat.chips.join(' '));
  check('off is a clear sky whatever was picked, and on again is the storm',
    cheat.off.off && cheat.off.kind === 'clear' && cheat.off.rain === 0 && cheat.off.on && cheat.back === 'storm',
    JSON.stringify(cheat.off));
  check('the strength slider halves the rain',
    cheat.strength.intensity === 0.5 && Math.abs(cheat.strength.rain - 0.5) < 1e-9, JSON.stringify(cheat.strength));
  check('how often random weather turns is set in minutes', cheat.minutes === 2, `${cheat.minutes} min`);
  check('with the lightning off a storm does not strike', cheat.lightning === false && cheat.struck === 0,
    `${cheat.struck} strikes`);
  check('random from the cheat menu holds a while and then turns by itself',
    cheat.random.choice === 'random' && cheat.random.on && cheat.random.hold > 60 && cheat.random.hold < 180,
    `${cheat.random.hold.toFixed(0)} s to the first turn`);
  check('none of it marks the run as cheated', cheat.cheated === false);

  // Back to clear for whoever comes next.
  await page.evaluate(() => { const s = window.spreefall; s.weather.choose('clear'); s.weather.snap(); });

  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  if (errors.length) {
    console.error(`\n${errors.length} console errors:`);
    for (const e of errors.slice(0, 8)) console.error('  ' + e);
  }
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
  if (failed.length || errors.length) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
