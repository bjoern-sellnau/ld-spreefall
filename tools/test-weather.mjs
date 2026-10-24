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
  // The extreme weather is on the same page, each kind or all of them, and
  // they are the cheat menu's switches: one set, kept for next time.
  const xtitle = await page.evaluate(() => {
    const s = window.spreefall;
    const chips = [...document.querySelectorAll('#extremechips button')];
    const all = chips.find((b) => b.dataset.xw === 'all');
    all.click();
    const on = { ...s.extreme.enabled }, label = document.getElementById('extremelabel').textContent;
    const cheat = document.querySelector('#cheatextreme button[data-xw=tornado]').classList.contains('on');
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('spreefall.extreme')); } catch { /* none */ }
    chips.find((b) => b.dataset.xw === 'fire').click();
    const one = document.getElementById('extremelabel').textContent;
    all.click(); all.click();
    return { ids: chips.map((b) => b.dataset.xw), on, label, cheat, stored: stored && stored.enabled, one, off: document.getElementById('extremelabel').textContent };
  });
  check('the game page switches the extreme weather on, each kind or all, the same switches as the cheat menu',
    xtitle.ids.join() === 'acid,ion,tornado,fire,all' && Object.values(xtitle.on).every(Boolean) && xtitle.label === 'All, at random'
      && xtitle.cheat && xtitle.stored && xtitle.stored.ion && /Säureregen/.test(xtitle.one) && !/Feuersturm/.test(xtitle.one)
      && xtitle.off === 'Off', JSON.stringify(xtitle));

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
  // What it sounds like, made the way the game makes it but into a buffer
  // instead of the speakers: a strike 300 m off and one 3.5 km off.
  const heard = await page.evaluate(async () => {
    const { Audio } = await import('/src/game/audio.js');
    const out = {};
    for (const d of [300, 3500]) {
      const sr = 8000, secs = d / 343 + 30;
      const ctx = new OfflineAudioContext(1, Math.ceil(sr * secs), sr);
      const a = new Audio();
      a.ctx = ctx; a.master = ctx.createGain(); a.master.connect(ctx.destination); a.enabled = true;
      a._noiseBuffer = a._makeNoise(4);
      a.thunder(d);
      const x = (await ctx.startRendering()).getChannelData(0);
      const win = sr / 2, env = [];
      for (let i = 0; i + win <= x.length; i += win) {
        let e = 0; for (let k = 0; k < win; k++) e += x[i + k] * x[i + k];
        env.push(Math.sqrt(e / win));
      }
      const on = env.findIndex((v) => v > 0.005);
      const off = env.length - 1 - [...env].reverse().findIndex((v) => v > 0.005);
      // How bright the first fifth of a second is: zero crossings a second.
      const at = Math.floor((d / 343) * sr);
      let zc = 0;
      for (let i = at + 1; i < at + sr * 0.2; i++) if ((x[i] > 0) !== (x[i - 1] > 0)) zc++;
      out[d] = { onset: on / 2, heard: (off - on) / 2, peak: +Math.max(...env).toFixed(3), bright: Math.round(zc / 0.2),
        crack: a.lastThunder.shape.crack };
    }
    return out;
  });
  check('thunder close to cracks and rolls, far off only rolls, quieter and longer, and both come when sound would',
    heard[300].crack > 0.5 && heard[3500].crack === 0 && heard[300].peak > heard[3500].peak * 2
      && heard[3500].heard > heard[300].heard && heard[300].heard >= 4 && heard[3500].heard >= 8
      && Math.abs(heard[300].onset - 300 / 343) <= 0.6 && Math.abs(heard[3500].onset - 3500 / 343) <= 0.6
      && heard[300].bright > heard[3500].bright, JSON.stringify(heard));
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

  // --- the extreme weather and the shelters ------------------------------------
  // A bus shelter near the square, somebody under it, somebody out in the
  // street in front of it, and you a little further out.
  const stage = (kind) => page.evaluate((kind) => {
    const s = window.spreefall;
    s.weather.choose('clear'); s.weather.snap();
    s.soldiers.reset(); s.vehicles.reset(); s.extreme.clear(); s.effects.clear();
    // The people who live here walk, and nobody else comes: no drone either,
    // or what it shoots is taken for the weather.
    s.drones.enabled = false; s.drones.reset(); s.projectiles.clear();
    s.soldiers.enabled = true; s.soldiers.budget = 0; s.soldiers.civilianBudget = 0;
    s.combat.godmode = false; s.combat.revive();
    s.state.mode = 'walk';
    for (const o of s.shelters()) { o.broken = false; o.health = 100; }
    const sh = s.shelters().filter((o) => o.kind === 'stop')
      .sort((a, b) => Math.hypot(a.x - 81, a.z) - Math.hypot(b.x - 81, b.z))[0];
    const c = Math.cos(sh.yaw), sn = Math.sin(sh.yaw);
    // Its own minus z is to the road: under the roof is a little that way.
    const at = (lx, lz) => ({ x: sh.x + c * lx + sn * lz, z: sh.z - sn * lx + c * lz });
    const put = (sd, p) => {
      sd.x = p.x; sd.z = p.z; sd.y = s.world.groundHeight(p.x, p.z);
      sd.directed = { x: p.x, z: p.z, speed: 0, bold: true };
    };
    const inside = s.soldiers.spawnCivilianNear(sh.x, sh.z, 0, 3);
    const outside = s.soldiers.spawnCivilianNear(sh.x, sh.z, 6, 10);
    put(inside, at(0, -0.15));
    put(outside, at(0, -9));
    const you = at(3, -15);
    s.teleport(you.x, you.z);
    window.wx = { sh, inside, outside, at, kind };
    return { sh: { x: +sh.x.toFixed(1), z: +sh.z.toFixed(1) }, covered: !!s.sheltered(inside.x, inside.y + 0.5, inside.z),
      open: !s.sheltered(outside.x, outside.y + 0.5, outside.z) };
  }, kind);
  const lookAtShelter = (pitch = 2) => page.evaluate(async (pitch) => {
    const s = window.spreefall, sh = window.wx.sh;
    const dx = sh.x - s.player.x, dz = sh.z - s.player.z;
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, pitch);
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
  }, pitch);

  const shelters = await page.evaluate(() => {
    const s = window.spreefall;
    const all = s.shelters();
    const near = all.filter((o) => Math.hypot(o.x - 81, o.z) < 400);
    return { all: all.length, near: near.length, kinds: [...new Set(near.map((o) => o.kind))].sort() };
  });
  check('bus shelters and kiosks stand along the pavements of the real streets',
    shelters.near >= 4 && shelters.kinds.join() === 'kiosk,stop', JSON.stringify(shelters));

  // The warning, word for word, twenty seconds ahead, counted down, and the
  // people who live here running for the shelters while it counts.
  const placed = await stage('acid');
  const warned = await page.evaluate(() => {
    const s = window.spreefall, sh = window.wx.sh;
    const runners = [];
    for (let k = 0; k < 3; k++) {
      const sd = s.soldiers.spawnCivilianNear(sh.x, sh.z, 25, 45);
      if (sd) { sd.directed = null; runners.push(sd); }
    }
    const said = [];
    s.extreme.onSay = ((orig) => (text, kind, what) => { said.push({ text, what, at: +(s.state.time || 0).toFixed(1) }); orig(text, kind, what); })(s.extreme.onSay);
    s.extreme.announce('acid', sh.x, sh.z);
    const siren = s.audio.lastWarn;
    const banner = document.getElementById('wxalerttext').textContent;
    const shown = !document.getElementById('wxalert').classList.contains('hidden');
    let firstHit = null;
    for (let t = 0; t < 21; t += 1 / 30) {
      s.fixedForTest(1 / 30);
      if (firstHit === null && s.extreme.now().acid > 0) firstHit = +t.toFixed(1);
    }
    const under = runners.filter((sd) => sd.alive && s.sheltered(sd.x, sd.y + 0.5, sd.z)).length;
    return { banner, shown, siren, sirenAfter: s.audio.lastWarn, said: said.map((x) => x.what + ':' + x.text.replace(/^Achtung: S.ureregen wird erwartet in /, '')),
      firstHit, runners: runners.length, under };
  });
  check('a warning comes twenty seconds ahead, word for word, and counts down',
    warned.shown && warned.banner === 'Achtung: Säureregen wird erwartet in 20 Sekunden. Suchen Sie sich Schutz!'
      && warned.said.some((x) => x.startsWith('count:5 Sekunden')) && warned.said.some((x) => x.startsWith('arrive'))
      && warned.firstHit !== null && warned.firstHit >= 19.5 && warned.siren === 'warn' && warned.sirenAfter === 'arrive',
    JSON.stringify(warned));
  check('and the people who live here run for the shelters while it counts',
    placed.covered && placed.open && warned.runners >= 2 && warned.under >= 2, `${warned.under} of ${warned.runners} under a roof`);

  const acid = await page.evaluate(() => {
    const s = window.spreefall, { inside, outside } = window.wx;
    const hp = s.combat.health + s.combat.shield;
    const trees = s.state.treesMelted || 0;
    for (let t = 0; t < 14; t += 1 / 30) s.fixedForTest(1 / 30);
    return { inside: inside.alive && inside.health > 0, outside: outside.alive && outside.health > 0,
      melted: s.state.melted || 0, trees: (s.state.treesMelted || 0) - trees, lost: +(hp - s.combat.health - s.combat.shield).toFixed(1) };
  });
  await lookAtShelter();
  await page.screenshot({ path: path.join(SHOTS, 'extreme-01-acid.png') });
  check('acid rain eats whoever is out in it down to the bones, and spares whoever is under the roof',
    acid.inside && !acid.outside && acid.melted >= 1, JSON.stringify(acid));
  check('and melts the trees, and burns you while you stand in it',
    acid.trees >= 1 && acid.lost > 20, JSON.stringify(acid));
  const dry = await page.evaluate(() => {
    const s = window.spreefall, { sh } = window.wx;
    const p = s.shelters().includes(sh) ? sh : null;
    const spot = window.wx.at(1.2, -0.15);
    s.teleport(spot.x, spot.z);
    s.fixedForTest(1 / 30);
    const hp = s.combat.health + s.combat.shield;
    let out = 0;
    for (let t = 0; t < 5; t += 1 / 30) { s.fixedForTest(1 / 30); if (!s.youSheltered()) out++; }
    return { under: s.youSheltered(), out, lost: +(hp - s.combat.health - s.combat.shield).toFixed(2) };
  });
  // Nothing lost; the shield may well fill again under the roof.
  check('under the shelter you are out of it', dry.under && dry.out === 0 && dry.lost <= 0, JSON.stringify(dry));

  await stage('ion');
  const ion = await page.evaluate(async () => {
    const s = window.spreefall, { sh, inside, outside } = window.wx;
    s.extreme.announce('ion', sh.x + 400, sh.z, Math.random, 0);
    // Struck where each one stands: the one in the street, and the shelter.
    s.ionStrike(outside.x, outside.z);
    const car = s.vehicles.spawn('car', window.wx.at(-8, -12).x, window.wx.at(-8, -12).z, sh.yaw);
    s.ionStrike(car.x, car.z);
    s.ionStrike(sh.x, sh.z);
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    return { outside: outside.alive && outside.health > 0, charred: outside.charred, inside: inside.alive && inside.health > 0,
      broken: sh.broken, car: +(car.health / car.maxHealth).toFixed(2), strikes: s.state.ionStrikes || 0 };
  });
  await lookAtShelter(8);
  // One more where you can see it, for the picture: a bolt is gone in a
  // tenth of a second.
  // Off to one side and a little way off, so the whole of it is in the
  // picture and not the glare of it; no other bolt or flash just then.
  // The dust of the bolts above hangs in front of the shelter for ten
  // seconds and more; it is let settle, the wreck left as it is.
  await page.evaluate(() => {
    const s = window.spreefall, p = window.wx.at(-22, 6), e = s.extreme.event('ion');
    if (e) e.strikeIn = 99;
    s.effects.clear();
    for (let t = 0; t < 1; t += 1 / 30) s.fixedForTest(1 / 30);
    if (e) e.strikeIn = 99;
    s.state.ionFlash = 0;
    s.ionStrike(p.x, p.z);
  });
  await page.screenshot({ path: path.join(SHOTS, 'extreme-02-ion.png') });
  check('an ion bolt burns whoever it lands on to a black skeleton where they stood',
    !ion.outside && ion.charred === 1, JSON.stringify(ion));
  check('and brings down a shelter it lands on, which takes it for whoever was under it, and wrecks a car',
    ion.broken && ion.inside && ion.car < 0.6, JSON.stringify(ion));

  await stage('tornado');
  // Down the street, through where the one in the street stands, and you
  // off to one side of it: stepped until it is near enough to see, the
  // picture, and the rest of its pass.
  await page.evaluate(async () => {
    const s = window.spreefall, { sh, at } = window.wx;
    const e = s.extreme.announce('tornado', sh.x, sh.z, Math.random, 0);
    const c = Math.cos(sh.yaw), sn = Math.sin(sh.yaw);
    // Far enough off that it is at its height by the time it is close.
    const from = at(-130, -9);
    e.path = { x: from.x, z: from.z, dx: c, dz: -sn };
    e.fx = from.x; e.fz = from.z;
    const you = at(-20, -26);
    s.teleport(you.x, you.z);
    window.wxRun = { hp: s.combat.health + s.combat.shield, trees: s.state.treesWhirled || 0, flew: false, top: 0, e };
    for (let t = 0; t < 8 && Math.hypot(e.fx - s.player.x, e.fz - s.player.z) > 55; t += 1 / 30) s.fixedForTest(1 / 30);
    const dx = e.fx - s.player.x, dz = e.fz - s.player.z;
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, 16);
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  await page.screenshot({ path: path.join(SHOTS, 'extreme-03-tornado.png') });
  const twister = await page.evaluate(() => {
    const s = window.spreefall, { sh, outside } = window.wx, run = window.wxRun;
    // The lowest you got: the shield fills again once it has gone by.
    let low = run.hp;
    for (let t = 0; t < 14; t += 1 / 30) {
      s.fixedForTest(1 / 30);
      low = Math.min(low, s.combat.health + s.combat.shield);
      if (outside.held) { run.flew = true; run.top = Math.max(run.top, outside.y - s.world.groundHeight(outside.x, outside.z)); }
    }
    return { flew: run.flew, top: +run.top.toFixed(1), outside: outside.alive && outside.health > 0, burst: s.state.burst || 0,
      trees: (s.state.treesWhirled || 0) - run.trees, broken: sh.broken, lost: +(run.hp - low).toFixed(1) };
  });
  check('a tornado throws whoever it takes up into the air, and they burst where they come down',
    twister.flew && twister.top > 3 && !twister.outside && twister.burst >= 1, JSON.stringify(twister));
  check('and throws the trees about, brings down a shelter in its path, and hurts you near it',
    twister.trees >= 1 && twister.broken && twister.lost > 5, JSON.stringify(twister));

  await stage('fire');
  const fire = await page.evaluate(async () => {
    const s = window.spreefall, { sh, inside, outside } = window.wx;
    s.extreme.announce('fire', sh.x, sh.z, Math.random, 0);
    const hp = s.combat.health + s.combat.shield, lit = s.state.treesLit || 0;
    for (let t = 0; t < 12; t += 1 / 30) s.fixedForTest(1 / 30);
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    return { inside: inside.alive && inside.health > 0, outside: outside.alive && outside.health > 0, charred: outside.charred,
      lit: (s.state.treesLit || 0) - lit, drawn: s.precipDrawn(), lost: +(hp - s.combat.health - s.combat.shield).toFixed(1) };
  });
  await lookAtShelter(6);
  await page.screenshot({ path: path.join(SHOTS, 'extreme-04-fire.png') });
  check('a firestorm burns whoever is out in it, sets the trees alight, and rains embers',
    !fire.outside && fire.charred === 1 && fire.inside && fire.lit >= 1 && fire.drawn > 500 && fire.lost > 20, JSON.stringify(fire));

  const together = await page.evaluate(() => {
    const s = window.spreefall;
    s.extreme.clear();
    s.combat.revive(); s.combat.godmode = true; s.state.mode = 'walk';
    s.extreme.announce('acid', s.player.x, s.player.z, Math.random, 0);
    s.extreme.announce('fire', s.player.x, s.player.z, Math.random, 0);
    for (let t = 0; t < 8; t += 1 / 30) s.fixedForTest(1 / 30);
    const n = s.extreme.now();
    s.extreme.clear();
    return { acid: n.acid, fire: n.fire };
  });
  check('more than one can come at once', together.acid === 1 && together.fire === 1, JSON.stringify(together));

  const xmenu = await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.cheatMenu(true);
    const chip = (id) => document.querySelector(`#cheatextreme button[data-xw=${id}]`);
    const out = { chips: [...document.querySelectorAll('#cheatextreme button')].map((b) => b.dataset.xw) };
    chip('all').click();
    out.all = { ...s.extreme.enabled };
    chip('tornado').click();
    out.noTornado = s.extreme.enabled.tornado;
    const slider = document.querySelector('#cheatextremevalues input[data-xw=minutes]');
    slider.value = '1'; slider.dispatchEvent(new Event('input'));
    out.minutes = s.extreme.minutes;
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('spreefall.extreme')); } catch { /* none */ }
    out.stored = stored;
    document.querySelector('#cheatextremevalues button[data-xw-now=ion]').click();
    out.now = s.extreme.events.map((e) => e.kind);
    s.cheatMenu(false);
    s.combat.revive(); s.combat.godmode = true; s.state.mode = 'walk';
    // And left to itself, with them on, one comes within a couple of minutes.
    s.extreme.clear();
    s.extreme.nextIn = Math.min(s.extreme.nextIn, 90);
    let came = null;
    for (let t = 0; t < 100; t += 1 / 10) { s.fixedForTest(1 / 10); if (s.extreme.events.length) { came = s.extreme.events[0].kind; break; } }
    out.came = came;
    out.cheated = s.cheats.used;
    s.extreme.setEnabled('all', false);
    s.extreme.clear();
    s.combat.godmode = false;
    return out;
  });
  check('the cheat menu switches each one on or all of them, sets how often, and brings one now',
    xmenu.chips.join() === 'acid,ion,tornado,fire,all' && Object.values(xmenu.all).every(Boolean) && xmenu.noTornado === false
      && xmenu.minutes === 1 && xmenu.stored && xmenu.stored.minutes === 1 && xmenu.now.includes('ion'), JSON.stringify(xmenu));
  check('switched on, they come by themselves, and none of it counts as a cheat',
    xmenu.came && xmenu.came !== 'tornado' && xmenu.cheated === false, JSON.stringify({ came: xmenu.came, cheated: xmenu.cheated }));

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
