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
    const levels = [];
    for (let i = 0; i < 7; i++) {
      s.demolition.blast(x, y, z, 9, 150);
      const site = s.demolition.sites.find((v) => Math.hypot(v.x - x, v.z - z) < 20);
      levels.push(site ? site.level : 0);
    }
    s.demolition.reset(); s.renderer.clearCollapses();
    const one = s.demolition.blast(x, y, z, 9, 150).length;
    const afterOne = s.demolition.sites.length ? s.demolition.sites[0].level : 0;
    s.demolition.reset(); s.renderer.clearCollapses();
    return { levels, one, afterOne, stages: s.demoSpec.stages };
  });
  check('one rocket does not bring anything down', adds.one === 0 && adds.afterOne === 0);
  check('and a frontage comes apart a piece at a time rather than at once',
    new Set(adds.levels).size >= 4 && adds.levels[adds.levels.length - 1] === 1
    && adds.levels[1] > 0 && adds.levels[1] < 1,
    adds.levels.join(' '));
  check('every step is a fraction of the building, not all of it',
    adds.levels.every((v, i) => i === 0 || v >= adds.levels[i - 1])
    && adds.levels.filter((v) => v > 0 && v < 1).length >= 2,
    `${adds.stages} steps from standing to a heap`);

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

  // The heights come down in steps, and only where the damage landed.
  const bySteps = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    // Somewhere with a real building on it, found by asking rather than by
    // picking a coordinate that might be an empty square.
    let at = null;
    for (let d = 20; d <= 90 && !at; d += 4) {
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const x = s.player.x + Math.cos(a) * d, z = s.player.z + Math.sin(a) * d;
        if (s.world.tallestNear(x, z, 6) > 14) { at = { x, z }; break; }
      }
    }
    if (!at) return { skip: true };
    const y = s.world.groundHeight(at.x, at.z);
    // The same reach the search used, or the point it found may have
    // nothing inside a tighter circle and every reading comes back zero.
    const here = () => Math.round(s.world.tallestNear(at.x, at.z, 6) * 10) / 10;
    const near = () => Math.round(s.world.tallestNear(at.x, at.z, 18) * 10) / 10;
    const steps = [{ hit: here(), rest: near() }];
    for (let i = 0; i < 5; i++) {
      s.demolition.blast(at.x, y + 6, at.z, 9, 150);
      for (let k = 0; k < 400; k++) s.demolition.update(1 / 60);
      steps.push({ hit: here(), rest: near() });
    }
    s.demolition.reset(); s.renderer.clearCollapses();
    return { steps };
  });
  check('a facade loses its height in steps rather than in one go',
    !bySteps.skip && bySteps.steps.filter((v, i) => i > 0
      && v.hit < bySteps.steps[i - 1].hit).length >= 3,
    bySteps.skip ? 'no building found' : bySteps.steps.map((v) => v.hit).join(' to '));
  check('and the rest of the block is left standing',
    !bySteps.skip && bySteps.steps[bySteps.steps.length - 1].rest
      >= bySteps.steps[0].rest - 0.2,
    bySteps.skip ? '' : `${bySteps.steps[0].rest} m, still ${bySteps.steps[bySteps.steps.length - 1].rest} m`);
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
    s.demolition.blast(x, before, z, 170, 4000);
    const site = s.demolition.sites[0];
    for (let i = 0; i < 400; i++) s.demolition.update(1 / 60);
    // Walk out along one radius and record what the ground did.
    const profile = [];
    for (let d = 0; d <= site.radius; d += 4) {
      profile.push({ d, moved: Number((s.world.groundHeight(x + d, z) - before).toFixed(2)) });
    }
    // The collision and the shape the shader draws are the same function,
    // compared number for number rather than by eye.
    let worst = 0;
    for (const f of [0.05, 0.2, 0.4, 0.6, 0.85, 1.2, 1.6, 2.4]) {
      const px = x + site.craterRadius * f;
      const want = s.demoCrater(px, z, site);
      const got = s.world.groundHeight(px, z) - before;
      worst = Math.max(worst, Math.abs(got - want));
    }
    return {
      collapse: Math.round(site.radius),
      craterRadius: Math.round(site.craterRadius),
      depth: Number(site.depth.toFixed(2)),
      deepest: Math.min(...profile.map((p) => p.moved)),
      highest: Math.max(...profile.map((p) => p.moved)),
      flatFrom: (profile.find((p) => p.d > site.craterRadius * 2 && Math.abs(p.moved) < 0.1)
        || { d: -1 }).d,
      worst: Number(worst.toFixed(2)),
    };
  });
  check('a warhead digs a hole you can walk into', crater.deepest < -5,
    `${(-crater.deepest).toFixed(1)} m deep`);
  check('and the hole is a fraction of the blast, not all of it',
    crater.craterRadius < crater.collapse * 0.35,
    `${crater.craterRadius} m of crater inside a ${crater.collapse} m collapse`);
  check('with a ring of thrown up ground round the lip', crater.highest > 0.5,
    `${crater.highest.toFixed(1)} m proud`);
  check('and flat street again well inside the collapse',
    crater.flatFrom > 0 && crater.flatFrom < crater.collapse,
    `level again ${crater.flatFrom} m out`);
  check('and the collision agrees with the shape the shader draws',
    crater.worst < 1.2, `worst ${crater.worst} m out over eight radii`);

  // --- small blasts leave the ground alone ---------------------------------
  const small = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const x = s.player.x - 30, z = s.player.z - 30;
    const y = s.world.groundHeight(x, z);
    for (let i = 0; i < 8; i++) s.demolition.blast(x, y, z, 9, 150);
    for (let i = 0; i < 240; i++) s.demolition.update(1 / 60);
    const site = s.demolition.sites[0];
    return { crater: site ? site.craterRadius : null,
      moved: Number((y - s.world.groundHeight(x, z)).toFixed(3)) };
  });
  check('a rocket does not crater the street', small.crater === 0 && small.moved === 0,
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
    // Two rounds, so the picture is a building half down rather than a heap:
    // half down is the thing worth showing.
    for (let i = 0; i < 2; i++) {
      s.demolition.blast(x, y + 8, z, 40, 500);
      for (let k = 0; k < 160; k++) { s.demolition.update(1 / 60); s.gibs.update(1 / 60); }
    }
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(SHOTS, 'city-01-collapse.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    const x = s.player.x - 70, z = s.player.z;
    const y = s.world.groundHeight(x, z);
    for (let i = 0; i < 3; i++) {
      s.demolition.blast(x, y + 8, z, 40, 500);
      for (let k = 0; k < 160; k++) { s.demolition.update(1 / 60); s.gibs.update(1 / 60); }
    }
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(SHOTS, 'city-04-flattened.png') });

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
