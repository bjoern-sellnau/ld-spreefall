// Fire, machines, and damage that stays done.
//
// Three things are checked here that are easy to get wrong and hard to see.
// First, that a ruin which has been written into the tile buffers is the same
// ruin the shader was drawing a moment earlier, and that it is still there
// after the site that made it has given up its slot: devastation has to be
// permanent, or the city quietly repairs itself behind you. Second, that fire
// does what fire does, to people, to trees and to the ground, and that the
// flamethrower's wall really travels. Third, that Rise of the Machines is a
// mode rather than a cheat: it changes the sky, puts steel on the street, and
// does not mark the run.
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
    s.teleport(81, 0); s.look(90, -3); s.setTime(14.2);
    s.setQuality('low');
  });
  await page.waitForTimeout(4000);

  // --- damage that stays done ---------------------------------------------
  const baked = await page.evaluate(async () => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    // Somewhere with a building on it, found by asking rather than guessing.
    let at = null;
    for (let d = 24; d <= 90 && !at; d += 4) {
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const x = s.player.x + Math.cos(a) * d, z = s.player.z + Math.sin(a) * d;
        if (s.world.tallestNear(x, z, 6) > 14) { at = { x, z }; break; }
      }
    }
    if (!at) return { skip: true };
    const y = s.world.groundHeight(at.x, at.z);
    const before = Math.round(s.world.tallestNear(at.x, at.z, 8) * 10) / 10;
    for (let i = 0; i < 5; i++) {
      s.demolition.blast(at.x, y + 6, at.z, 10, 400);
      // Just long enough for the fall to finish, and not long enough for the
      // settle timer to write it into the city.
      for (let k = 0; k < 85; k++) s.demolition.update(1 / 60);
    }
    const whileLive = Math.round(s.world.tallestNear(at.x, at.z, 8) * 10) / 10;
    const sitesLive = s.demolition.sites.length;
    // Now past the settle time: the sites are written into the city and give
    // their slots back.
    for (let k = 0; k < 60 * 6; k++) s.demolition.update(1 / 60);
    return {
      at, before, whileLive,
      after: Math.round(s.world.tallestNear(at.x, at.z, 8) * 10) / 10,
      sitesLive, sitesNow: s.demolition.sites.length, bakedCount: s.demolition.baked,
    };
  });
  check('a building that has come down is written into the city',
    !baked.skip && baked.bakedCount > 0 && baked.sitesNow === 0,
    baked.skip ? 'no building found' : `${baked.sitesLive} sites while falling, ${baked.sitesNow} after, ${baked.bakedCount} baked`);
  check('and it stays down once the slot has gone',
    !baked.skip && baked.after <= baked.whileLive + 0.4 && baked.after < baked.before - 1,
    baked.skip ? '' : `${baked.before} m standing, ${baked.whileLive} m while falling, ${baked.after} m once baked`);

  // Sixteen slots, twenty places: with baking, the last four are real damage
  // in their own place rather than the nearest site growing to swallow them.
  const everywhere = await page.evaluate(async () => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const spots = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const r = 110 + (i % 5) * 60;
      const x = s.player.x + Math.cos(a) * r, z = s.player.z + Math.sin(a) * r;
      spots.push({ x, z, before: s.world.tallestNear(x, z, 14) });
    }
    for (const spot of spots) {
      const y = s.world.groundHeight(spot.x, spot.z);
      for (let i = 0; i < 3; i++) s.demolition.blast(spot.x, y + 5, spot.z, 12, 500);
      for (let k = 0; k < 200; k++) s.demolition.update(1 / 60);
    }
    for (let k = 0; k < 60 * 4; k++) s.demolition.update(1 / 60);
    const hit = spots.filter((v) => v.before > 10);
    const down = hit.filter((v) => s.world.tallestNear(v.x, v.z, 14) < v.before - 1.5);
    const last = spots.slice(-6).filter((v) => v.before > 10);
    const lastDown = last.filter((v) => s.world.tallestNear(v.x, v.z, 14) < v.before - 1.5);
    return { places: hit.length, down: down.length, last: last.length, lastDown: lastDown.length };
  });
  // The claim is not that every blast flattens something, it is that the ones
  // past the sixteenth slot still do their damage where they land rather than
  // being swallowed by whatever came first.
  check('the seventeenth blast still damages where it lands',
    everywhere.places > 0 && everywhere.down >= Math.ceil(everywhere.places * 0.5)
      && (everywhere.last === 0 || everywhere.lastDown > 0),
    `${everywhere.down} of ${everywhere.places} places came down, ${everywhere.lastDown} of ${everywhere.last} in the last six`);

  // --- trees do not come back ---------------------------------------------
  const trees = await page.evaluate(async () => {
    const s = window.spreefall;
    const before = s.world.deadTreeCount;
    let site = null;
    for (let d = 60; d <= 400 && !site; d += 60) {
      for (let i = 0; i < 8 && !site; i++) {
        const a = (i / 8) * Math.PI * 2;
        site = s.fires.ignite(s.player.x + Math.cos(a) * d, 0, s.player.z + Math.sin(a) * d, 70, 1);
      }
    }
    if (!site) return { skip: true };
    const caught = site.trees.length;
    for (let i = 0; i < 60 * 60; i++) s.fires.update(1 / 60, s.player);
    return { caught, gone: s.world.deadTreeCount - before, fires: s.fires.count };
  });
  check('a tree that burns down is gone for good',
    !trees.skip && trees.gone >= trees.caught * 0.8 && trees.fires === 0,
    trees.skip ? 'nothing to burn nearby' : `${trees.gone} of ${trees.caught} struck off, ${trees.fires} fires left`);

  // --- the flamethrower ----------------------------------------------------
  const flame = await page.evaluate(async () => {
    const s = window.spreefall;
    s.soldiers.enabled = true;
    s.weapon.giveAll();
    const chose = s.weapon.select('flamer');
    const f = s.camera.forward;
    const sd = s.soldiers.spawnNear(s.player.x + f[0] * 9, s.player.z + f[2] * 9, 0.5, 1.5);
    if (!sd) return { skip: true };
    const fuel0 = s.weapon.ammo;
    const hp0 = sd.health;
    // Held for a stretch of simulated time rather than a number of frames or
    // a stretch of wall clock: the thing being measured is a drain per second
    // of game, and on a machine slow enough for the frame clamp to bite the
    // game runs slower than the clock on the wall.
    const t0 = s.loop.simTime;
    const wall = performance.now();
    while (s.loop.simTime - t0 < 3 && performance.now() - wall < 60000) {
      s.holdFire(true);
      await new Promise((r) => requestAnimationFrame(r));
    }
    const seconds = s.loop.simTime - t0;
    s.holdFire(false);
    return {
      chose, seconds: +seconds.toFixed(1),
      fuel0: Math.round(fuel0), fuel: Math.round(s.weapon.ammo),
      perSecond: s.weapons.flamer.stream.fuelPerSecond,
      hp0: Math.round(hp0), hp: Math.round(sd.health), charred: +(sd.charred || 0).toFixed(2),
    };
  });
  const poured = flame.skip ? 0 : flame.fuel0 - flame.fuel;
  const owed = flame.skip ? 0 : flame.perSecond * flame.seconds;
  check('the flamethrower pours rather than fires',
    !flame.skip && flame.chose && poured > owed * 0.6 && poured < owed * 1.3,
    flame.skip ? 'nowhere to put a soldier'
      : `${poured} fuel in ${flame.seconds} s, ${Math.round(owed)} owed`);
  check('and what is in the stream burns down',
    !flame.skip && flame.hp <= 0 && flame.charred > 0.9,
    flame.skip ? '' : `${flame.hp0} health became ${flame.hp}, charred ${flame.charred}`);

  const wall = await page.evaluate(async () => {
    const s = window.spreefall;
    s.weapon.giveAll();
    s.fires.reset();
    const thrown = s.altFire();
    const walls = s.fireWalls.count;
    let furthest = 0;
    // What it leaves behind is watched while it is behind it. The pools burn
    // for eleven seconds and the wall takes nine to run out, so on a slow
    // machine reading the count at the end of the loop reads a street that
    // has already burnt out.
    let pools = 0;
    let fires = 0;
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const w = s.fireWalls.active[0];
      if (w) furthest = Math.max(furthest, w.travelled);
      pools = Math.max(pools, s.burningGround.length);
      fires = Math.max(fires, s.fires.count);
    }
    return { thrown, walls, furthest: Math.round(furthest), fires, pools };
  });
  check('its second trigger throws a wall that travels',
    wall.thrown && wall.walls === 1 && wall.furthest > 25,
    `${wall.furthest} m across the ground`);
  check('and the street it crossed is still burning behind it',
    wall.fires + wall.pools > 0,
    `${wall.pools} stretches of road alight, ${wall.fires} fires in the trees`);

  await page.screenshot({ path: path.join(SHOTS, 'fire-01-wall.png') });

  // --- incendiary ----------------------------------------------------------
  const incendiary = await page.evaluate(async () => {
    const s = window.spreefall;
    const before = s.burningGround.length;
    const x = s.player.x + 26, z = s.player.z + 6;
    s.explode(x, s.world.groundHeight(x, z) + 1, z,
      { radius: 11, damage: 70 }, { weapon: 'incendiary' });
    await new Promise((r) => requestAnimationFrame(r));
    const pools = s.burningGround.length - before;
    // And they go out on their own rather than burning for the session.
    const last = s.burningGround[s.burningGround.length - 1];
    const life = last ? last.left : 0;
    return { pools, life: Math.round(life) };
  });
  check('an incendiary leaves the ground on fire',
    incendiary.pools >= 4, `${incendiary.pools} pools, each burning ${incendiary.life} s`);

  // --- Rise of the Machines ------------------------------------------------
  const mode = await page.evaluate(async () => {
    const s = window.spreefall;
    s.cheats.reset();
    const wasCheated = s.cheats.used;
    const btn = [...document.querySelectorAll('.diff.mode')].find((b) => b.dataset.mode === 'machines');
    if (btn) btn.click();
    s.soldiers.active.length = 0;
    for (let i = 0; i < 60 * 12; i++) s.machinesTick(1 / 60);
    const standing = s.soldiers.active.filter((x) => x.machine);
    return {
      on: s.machines.active,
      wasCheated, cheated: s.cheats.used,
      fog: s.renderer.fogDensity, armageddon: s.renderer.armageddon,
      machines: standing.length,
      health: standing[0] ? standing[0].health : 0,
      timeShown: !document.getElementById('timepick').classList.contains('hidden'),
    };
  });
  check('Rise of the Machines is picked on the title screen', mode.on && mode.timeShown,
    'with the time of day to go with it');
  check('and it is a mode, not a cheat', !mode.cheated && !mode.wasCheated,
    'the run is not marked');
  check('the sky goes with it', mode.armageddon === 1 && mode.fog > 0.0015,
    `fog ${mode.fog}, armageddon ${mode.armageddon}`);
  check('and steel walks the streets', mode.machines >= 3,
    `${mode.machines} machines up, ${mode.health} health each`);

  await page.screenshot({ path: path.join(SHOTS, 'machines-01-street.png') });

  const emp = await page.evaluate(async () => {
    const s = window.spreefall;
    const near = [];
    for (let i = 0; i < 4; i++) {
      const sd = s.soldiers.spawnNear(s.player.x, s.player.z, 8, 18);
      if (sd) { s.makeMachine(sd); near.push(sd); }
    }
    const x = s.player.x + 8, z = s.player.z;
    s.explode(x, s.world.groundHeight(x, z) + 1, z, { radius: 6, damage: 14 }, { weapon: 'emp' });
    await new Promise((r) => requestAnimationFrame(r));
    const stunned = near.filter((m) => m.stunLeft > 0);
    // A stunned machine does not walk. Measured in simulation steps rather
    // than in frames: the software rasteriser this runs on manages a few
    // frames a second, so a hundred frames is half a minute of game time and
    // the stun would be long over.
    const before = stunned[0] ? { x: stunned[0].x, z: stunned[0].z } : null;
    for (let i = 0; i < 60; i++) {
      s.soldiers.update(1 / 60, { x: s.player.x, y: s.player.y, z: s.player.z, alive: true }, i / 60);
    }
    const moved = before && stunned[0]
      ? Math.hypot(stunned[0].x - before.x, stunned[0].z - before.z) : 0;
    return { put: near.length, stunned: stunned.length, moved: Math.round(moved * 10) / 10,
      left: stunned[0] ? Math.round(stunned[0].stunLeft) : 0 };
  });
  check('an EMP stops the machines inside it',
    emp.stunned >= Math.min(3, emp.put), `${emp.stunned} of ${emp.put} caught`);
  check('and a stopped one stands there while you deal with it',
    emp.moved < 1.5, `${emp.moved} m in two seconds, ${emp.left} s of stun left`);

  await page.evaluate(() => {
    const s = window.spreefall;
    s.setMode('berlin');
    s.demolition.reset();
    s.renderer.clearCollapses();
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
