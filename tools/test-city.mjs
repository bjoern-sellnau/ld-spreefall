// What the city does when it is hit, and what the camera does when you ask to
// be somewhere else.
//
// The claims checked here are the ones that are easy to fake and hard to
// notice: that a building which looks flattened really has stopped blocking
// bullets, that a crater you can see is a crater you can walk into, and that
// the profile the collision uses is the same one the vertex shader draws. If
// those two ever drift you fall through a street that looks solid, so they
// are compared number for number rather than by eye.
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
  await page.evaluate(() => {
    const s = window.spreefall;
    s.skipToWalk();
    s.tiles.uploadsPerFrame = 500;
    s.drones.enabled = false;
    s.soldiers.enabled = false;
    s.jets.enabled = false;
    s.cheats.reset();
    s.teleport(81, 0); s.look(90, -2); s.setTime(15.6);
    s.setQuality('low');
  });
  await page.waitForTimeout(4000);

  // --- damage adds up ------------------------------------------------------
  const adds = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const x = s.player.x - 40, z = s.player.z + 10;
    const y = s.world.groundHeight(x, z);
    const steps = [];
    for (let i = 0; i < 8; i++) steps.push(s.demolition.blast(x, y, z, 9, 150).length);
    const first = steps.indexOf(1);
    s.demolition.reset(); s.renderer.clearCollapses();
    // One of the same is not enough on its own.
    const one = s.demolition.blast(x, y, z, 9, 150).length;
    s.demolition.reset(); s.renderer.clearCollapses();
    return { steps, first, one, threshold: s.demoSpec.threshold };
  });
  check('one rocket does not bring a building down', adds.one === 0);
  check('but several into the same frontage do', adds.first > 1 && adds.first < 8,
    `the ${adds.first + 1}th of them, at ${adds.threshold} damage`);

  // --- what comes down stops being there -----------------------------------
  const walls = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const x = s.player.x - 70, z = s.player.z;
    const y = s.world.groundHeight(x, z);
    // Count the walls a ring of rays finds before and after, at head height.
    // A ring of rays from the middle. Two ranges, because a collapse is not
    // uniform: the middle of it is flattened and the rim keeps most of its
    // height, which is both what a blast does and what the profile says.
    const probe = (height, reach) => {
      let hits = 0;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const h = s.world.raycast(x, y + height, z, Math.cos(a), 0, Math.sin(a), reach);
        if (h && h.kind === 'wall') hits++;
      }
      return hits;
    };
    const before = probe(5, 60);
    s.demolition.blast(x, y, z, 90, 3000);
    const halfway = (() => { for (let i = 0; i < 30; i++) s.demolition.update(1 / 60); return probe(5, 60); })();
    for (let i = 0; i < 240; i++) s.demolition.update(1 / 60);
    const inner = probe(5, 32);
    const rim = probe(5, 72);
    const low = probe(0.6, 32);
    return { before, halfway, inner, rim, low,
      radius: Math.round(s.demolition.sites[0].radius) };
  });
  check('a square with buildings round it has walls in it', walls.before >= 6,
    `${walls.before} of 24 rays hit one`);
  check('the walls are still there while it is falling', walls.halfway === walls.before);
  check('and gone at head height in the middle of it once it has fallen',
    walls.inner === 0, `${walls.before} to ${walls.inner} within 32 m`);
  check('while the rim of it keeps most of its height', walls.rim > 0,
    `${walls.rim} of 24 out to 72 m, on a ${walls.radius} m site`);
  check('and the heap is still there at knee height', walls.low > 0,
    `${walls.low} of 24`);

  // --- the crater is real --------------------------------------------------
  const crater = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const x = s.player.x + 400, z = s.player.z + 40;
    const before = s.world.groundHeight(x, z);
    const rimBefore = s.world.groundHeight(x + 150, z);
    s.demolition.blast(x, before, z, 170, 4000);
    const site = s.demolition.sites[0];
    for (let i = 0; i < 240; i++) s.demolition.update(1 / 60);
    const after = s.world.groundHeight(x, z);
    const rimAfter = s.world.groundHeight(x + 150, z);
    // The collision profile and the one the shader draws have to be the same
    // function. Sampled at a few radii, the measured drop must match
    // depth * bite squared.
    const errs = [];
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const px = x + site.radius * f;
      const k = s.demoBite(px, z, site);
      const want = site.depth * k * k;
      const got = s.world.groundHeight(px, z);
      const base = before;      // flat enough over this square to compare
      errs.push(Math.abs((base - got) - want));
    }
    return {
      depth: Number(site.depth.toFixed(2)),
      dropped: Number((before - after).toFixed(2)),
      rim: Number((rimBefore - rimAfter).toFixed(2)),
      worstErr: Number(Math.max(...errs).toFixed(2)),
    };
  });
  check('a warhead digs a hole you can walk into',
    crater.dropped > 5 && Math.abs(crater.dropped - crater.depth) < 0.05,
    `${crater.dropped} m deep`);
  check('and the rim of it does not move', Math.abs(crater.rim) < 0.05);
  check('and the collision agrees with the shape the shader draws',
    crater.worstErr < 1.2, `worst ${crater.worstErr} m out over five radii`);

  // --- small blasts leave the ground alone ---------------------------------
  const small = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const x = s.player.x - 30, z = s.player.z - 30;
    const y = s.world.groundHeight(x, z);
    for (let i = 0; i < 8; i++) s.demolition.blast(x, y, z, 9, 150);
    for (let i = 0; i < 240; i++) s.demolition.update(1 / 60);
    const site = s.demolition.sites[0];
    return { crater: site ? site.crater : null, moved: Number((y - s.world.groundHeight(x, z)).toFixed(3)) };
  });
  check('a rocket does not crater the street', small.crater === false && small.moved === 0,
    'the ground mesh is a 12.5 m grid, so a small hole would be invisible');

  // --- the memorial ---------------------------------------------------------
  const memorial = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const m = s.combat.sanctuaries[0];
    if (!m) return { skip: true };
    const y = s.world.groundHeight(m.x, m.z);
    const made = s.demolition.blast(m.x, y, m.z, 170, 4000);
    return { made: made.length, sites: s.demolition.count, name: m.name };
  });
  check('nothing in the memorial comes down', memorial.made === 0 && memorial.sites === 0,
    memorial.name);

  // --- the shader is told about it ------------------------------------------
  const uniforms = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const quiet = s.renderer.collapseCount;
    const x = s.player.x - 200, z = s.player.z;
    const y = s.world.groundHeight(x, z);
    s.demolition.blast(x, y, z, 80, 3000);
    for (let i = 0; i < 120; i++) s.demolition.update(1 / 60);
    s.renderer.setCollapses(s.demolition.sites);
    const site = s.demolition.sites[0];
    const packed = Array.from(s.renderer.collapse.slice(0, 4));
    // And a lot of them never take more slots than the shader has.
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const px = s.player.x + Math.cos(a) * (200 + i * 9);
      const pz = s.player.z + Math.sin(a) * (200 + i * 9);
      s.demolition.blast(px, s.world.groundHeight(px, pz), pz, 70, 3000);
    }
    s.renderer.setCollapses(s.demolition.sites);
    const many = { sites: s.demolition.count, uniforms: s.renderer.collapseCount };
    s.demolition.reset(); s.renderer.clearCollapses();
    return {
      quiet, after: s.renderer.collapseCount,
      matches: Math.abs(packed[0] - site.x) < 0.01 && Math.abs(packed[3] - site.radius) < 0.01,
      many, max: s.demoSpec.maxSites,
    };
  });
  check('an untouched city costs the vertex shader nothing', uniforms.quiet === 0);
  check('and a collapse reaches it with the right numbers', uniforms.matches);
  check('sixty blasts never ask for more slots than there are',
    uniforms.many.sites <= uniforms.max && uniforms.many.uniforms <= uniforms.max,
    `${uniforms.many.sites} sites, ${uniforms.max} slots`);

  // --- free travel ----------------------------------------------------------
  const flight = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    s.teleport(81, 0);
    s.openTravel();
    const host = document.getElementById('nuketarget');
    const opened = !host.classList.contains('hidden') && host.classList.contains('travel');
    const armed = s.armNuke(s.player.x + 1200, s.player.z - 260);
    const says = document.getElementById('confirmwhere').textContent;
    const button = document.getElementById('confirmfire').textContent;
    const beforeMode = s.state.mode;
    s.releaseNuke();
    return {
      opened, armed, says, button, beforeMode,
      mode: s.state.mode,
      stillHere: Math.round(Math.hypot(s.player.x - 81, s.player.z)),
      closed: host.classList.contains('hidden'),
    };
  });
  check('the travel map opens in its own mode', flight.opened);
  check('and says how far and how long', /km from here\. About \d+ seconds\./.test(flight.says),
    flight.says);
  check('and asks before it moves you', flight.button === 'Fly there'
    && flight.beforeMode === 'walk' && flight.stillHere === 0);
  check('releasing it starts the flight rather than teleporting you',
    flight.mode === 'travel' && flight.closed);

  // The shape of the move: up first, across at height, then down.
  const shape = await page.evaluate(async () => {
    const s = window.spreefall;
    const seen = [];
    const t0 = performance.now() / 1000;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const p = s.state.dronePose;
      if (s.state.mode !== 'travel' || !p) break;
      seen.push({ t: performance.now() / 1000 - t0, y: p.y, phase: p.phase, pitch: p.pitch });
    }
    return {
      phases: [...new Set(seen.map((v) => v.phase))].join(''),
      peak: Math.round(Math.max(...seen.map((v) => v.y))),
      start: Math.round(seen[0] ? seen[0].y : 0),
      lookedDown: seen.some((v) => v.pitch < -1),
    };
  });
  check('it climbs well above the roofs', shape.peak > 200,
    `${shape.start} m to ${shape.peak} m`);
  check('and looks down at the city on the way', shape.lookedDown);
  check('through rise, cruise and fall in that order',
    /rise/.test(shape.phases) && /cruise/.test(shape.phases), shape.phases);

  const arrived = await page.evaluate(async () => {
    const s = window.spreefall;
    for (let i = 0; i < 900; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (s.state.mode === 'walk') break;
    }
    return {
      mode: s.state.mode,
      off: Math.round(Math.hypot(s.player.x - (81 + 1200), s.player.z - (-260))),
      onGround: Math.abs(s.player.y - s.world.groundHeight(s.player.x, s.player.z)) < 1.5,
      hudBack: !document.getElementById('hud').classList.contains('flying'),
    };
  });
  check('and it puts you down exactly where you asked', arrived.mode === 'walk' && arrived.off <= 1,
    `${arrived.off} m out`);
  check('on the ground, with the interface back', arrived.onGround && arrived.hudBack);

  // Travel into the memorial is allowed: walking there always has been, it is
  // firing there that is not.
  const intoMemorial = await page.evaluate(() => {
    const s = window.spreefall;
    const m = s.combat.sanctuaries[0];
    s.openTravel();
    const ok = s.armNuke(m.x, m.z);
    s.closeTargeting();
    return { ok, name: m.name };
  });
  check('and you may still travel into the memorial', intoMemorial.ok, intoMemorial.name);

  // --- the pictures ---------------------------------------------------------
  await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.demolition.reset(); s.renderer.clearCollapses(); s.renderer.clearScars();
    s.gibs.clear(); s.effects.clear(); s.state.flash = 0;
    s.teleport(81, 0); s.look(90, -2); s.setTime(15.9);
    const x = s.player.x - 70, z = s.player.z;
    const y = s.world.groundHeight(x, z);
    s.demolition.blast(x, y, z, 90, 3000);
    for (let i = 0; i < 240; i++) { s.demolition.update(1 / 60); s.gibs.update(1 / 60); }
  });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(SHOTS, 'city-01-collapse.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses(); s.renderer.clearScars();
    s.gibs.clear(); s.effects.clear(); s.state.flash = 0;
    s.setCheat('godmode', true);
    s.teleport(120, -6); s.look(268, -4); s.setTime(16.2);
    s.dropNuke(s.player.x + 330, s.player.z + 20);
    for (let i = 0; i < 60 * 5; i++) { s.projectiles.update(1 / 60); s.demolition.update(1 / 60); }
  });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(SHOTS, 'city-02-warhead.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.demolition.reset(); s.renderer.clearCollapses(); s.renderer.clearScars();
    s.gibs.clear(); s.effects.clear(); s.state.flash = 0;
    s.teleport(81, 0);
    s.beginTravel(s.player.x + 1200, s.player.z - 200);
  });
  await page.waitForTimeout(3400);
  await page.screenshot({ path: path.join(SHOTS, 'city-03-travel.png') });
  await page.evaluate(async () => {
    const s = window.spreefall;
    for (let i = 0; i < 900; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (s.state.mode === 'walk') break;
    }
    s.teleport(81, 0);
    s.demolition.reset(); s.renderer.clearCollapses();
  });

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
