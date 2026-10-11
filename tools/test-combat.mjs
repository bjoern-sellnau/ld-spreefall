// Drives the shooter in a real browser: places drones, aims, fires, and checks
// that damage, kills, scoring, cover and the weapons free zone all behave.

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // A software rasteriser needs longer than the thirty second default to hand
  // back a frame, on this machine and on a CI runner alike.
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
    s.drones.enabled = false;          // no spawning or AI, so the tests are stable
  });
  await page.evaluate(() => {
    const s = window.spreefall;
    s.teleport(81, 0); s.look(90, 5); s.setTime(15.4);
  });
  await page.waitForTimeout(5000);

  // Helper installed in the page: park a drone and aim exactly at it.
  await page.evaluate(() => {
    window.T = {
      park(dx, dy, dz) {
        const s = window.spreefall;
        const d = s.spawnDrone(dx, dy, dz);
        d.vx = d.vy = d.vz = 0;
        d.targetX = d.x; d.targetY = d.y; d.targetZ = d.z;
        return d;
      },
      aimAt(d) {
        const s = window.spreefall;
        const ex = s.player.x, ey = s.player.y + 1.7, ez = s.player.z;
        const vx = d.x - ex, vy = d.y - ey, vz = d.z - ez;
        const l = Math.hypot(vx, vy, vz);
        s.look(Math.atan2(-vx, -vz) * 180 / Math.PI, Math.asin(vy / l) * 180 / Math.PI);
        s.camera.update(16 / 9);
        return l;
      },
    };
  });

  // --- a drone in the open takes three body shots ---------------------------
  const kill = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.weapon.reset(); s.combat.reset(); s.effects.clear();
    const d = window.T.park(-30, 5, 0);
    const dist = window.T.aimAt(d);
    // Spread is random, so shoot from dead centre by zeroing it for the test.
    s.weapon.spread = 0;
    const hp = [];
    for (let i = 0; i < 4; i++) {
      s.weapon.spread = 0;
      s.shoot();
      hp.push(Math.round(d.health));
      if (!d.alive || d.state === 4) break;
    }
    return {
      dist: +dist.toFixed(1), hp, dead: d.state === 4,
      kills: s.combat.kills, score: s.combat.score,
      shots: s.weapon.shotsFired, hits: s.weapon.hits, ammo: s.weapon.ammo,
    };
  });
  check('a drone in the open dies to a burst', kill.dead,
    `${kill.dist} m, health ${kill.hp.join(' to ')}, ${kill.hits}/${kill.shots} hits`);
  check('the kill is credited and scored', kill.kills === 1 && kill.score > 0,
    `kills ${kill.kills}, score ${kill.score}`);
  check('firing consumes ammunition', kill.ammo === 30 - kill.shots, `ammo ${kill.ammo}`);

  // --- a core hit is worth more than a body hit ----------------------------
  const core = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.weapon.reset();
    const d = window.T.park(-26, 4, 0);
    window.T.aimAt(d);
    s.weapon.spread = 0;
    const before = d.health;
    s.shoot();
    const centre = before - d.health;
    // Now clip the edge of the hull rather than the core. The first drone has
    // to go first: two drones in the same spot return the same ray distance and
    // only the one found first is ever hit.
    s.drones.reset(); s.weapon.reset();
    const d2 = window.T.park(-26, 4, 0);
    window.T.aimAt(d2);
    s.weapon.spread = 0;
    // Nudge the aim so the ray passes through the hull but misses the core.
    s.camera.pitch += Math.atan(0.6 / 26);
    s.camera.update(16 / 9);
    const before2 = d2.health;
    s.shoot();
    return { centre, edge: before2 - d2.health };
  });
  check('a core hit does more damage than a hull hit', core.centre > core.edge && core.edge > 0,
    `core ${core.centre.toFixed(0)}, hull ${core.edge.toFixed(0)}`);

  // --- cover: the Brandenburg Gate stops the shot --------------------------
  const cover = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.weapon.reset();
    // Behind the Gate, which stands at x 0 and is 81 m west of the spawn.
    const d = window.T.park(-140, 4, 0);
    window.T.aimAt(d);
    s.weapon.spread = 0;
    const before = d.health;
    s.shoot();
    return { damage: before - d.health, hits: s.weapon.hits };
  });
  check('the Gate stops a shot at a drone behind it', cover.damage === 0 && cover.hits === 0,
    `damage ${cover.damage}`);

  // --- reload --------------------------------------------------------------
  const reload = await page.evaluate(async () => {
    const s = window.spreefall;
    s.drones.reset(); s.weapon.reset();
    s.weapon.ammo = 3;
    const started = s.weapon.startReload();
    const during = s.weapon.state;
    for (let i = 0; i < 130; i++) s.weapon.update(1 / 60, false, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    return { started, during, ammo: s.weapon.ammo, reserve: s.weapon.reserve, state: s.weapon.state };
  });
  check('reloading refills the magazine from the reserve',
    reload.started && reload.ammo === 30 && reload.reserve === 213,
    `ammo ${reload.ammo}, reserve ${reload.reserve}`);

  // --- the weapons free zone ----------------------------------------------
  const zone = await page.evaluate(async () => {
    const s = window.spreefall;
    const mem = s.world.manifest.landmarks.find((l) => l.key === 'memorial');
    s.teleport(mem.x, mem.z);
    s.drones.reset(); s.weapon.reset();
    const d = window.T.park(-28, 6, 0);
    window.T.aimAt(d);
    // Run one simulation step so the holster rule applies.
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const before = d.health;
    const holstered = s.weapon.holstered;
    s.weapon.update(1 / 60, true, { x: s.player.x, y: s.player.y + 1.7, z: s.player.z },
      { x: s.camera.forward[0], y: s.camera.forward[1], z: s.camera.forward[2] });
    const inZone = s.combat.isSanctuary(s.player.x, 0, s.player.z);
    const banner = !document.getElementById('sanctuary').classList.contains('hidden');
    return { inZone, holstered, banner, damage: before - d.health, ammo: s.weapon.ammo };
  });
  check('the memorial is recognised as a weapons free zone', zone.inZone);
  check('the weapon holsters itself there', zone.holstered, `ammo untouched: ${zone.ammo === 30}`);
  check('and it will not fire', zone.damage === 0 && zone.ammo === 30);
  check('the reason is shown on screen', zone.banner);
  await page.screenshot({ path: path.join(SHOTS, 'combat-04-sanctuary.png') });

  // --- drones will not enter the zone --------------------------------------
  const keepOut = await page.evaluate(() => {
    const s = window.spreefall;
    const mem = s.world.manifest.landmarks.find((l) => l.key === 'memorial');
    s.drones.reset();
    s.drones.enabled = true;
    let insideEver = 0;
    for (let i = 0; i < 1200; i++) {
      s.drones.update(1 / 60, { x: mem.x, y: 2, z: mem.z, alive: true }, i / 60);
      for (const d of s.drones.active) {
        if (Math.hypot(d.x - mem.x, d.z - mem.z) < 60) insideEver++;
      }
    }
    s.drones.enabled = false;
    return { insideEver, live: s.drones.count };
  });
  check('drones stay out of the weapons free zone', keepOut.insideEver === 0,
    `${keepOut.insideEver} drone frames inside, ${keepOut.live} live`);

  // --- a pretty picture of an engagement -----------------------------------
  await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.weapon.reset(); s.combat.reset();
    s.teleport(81, 0); s.look(90, 7); s.setTime(17.2);
    for (const [dx, dy, dz] of [[-22, 4, -3], [-34, 9, 7], [-46, 13, -10], [-60, 7, 6]]) {
      window.T.park(dx, dy, dz);
    }
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOTS, 'combat-01-contact.png') });

  // Firing, for the picture. This browser renders about four frames a second,
  // so rather than race one seventy millisecond flash against the shutter, hold
  // the trigger: re-aim on every shot so the recoil does not walk the camera up
  // into the sky, and keep the target alive so the burst has somewhere to go.
  await page.evaluate(() => {
    const s = window.spreefall;
    // The far drone, so the shot is nearly level and the Gate stays in frame.
    const d = s.drones.active[3];
    d.health = 1e6;
    window.FIRING = setInterval(() => {
      window.T.aimAt(d);
      s.weapon.spread = 0;
      s.weapon.ammo = 30;
      s.shoot();
    }, 70);
  });
  await page.waitForTimeout(700);
  // One last shot with the sights back on the drone, so the recoil climb of the
  // burst does not leave the picture pointing at the sky.
  await page.evaluate(() => {
    const s = window.spreefall;
    clearInterval(window.FIRING);
    window.T.aimAt(s.drones.active[3]);
    // This harness calls fire directly, so it puts far more rounds between two
    // rendered frames than the weapon's own 105 ms cooldown ever would, and the
    // recoil piles up into a climb the game cannot produce. Clear it, so the
    // picture shows the recoil of one shot rather than of the test.
    s.weapon.recoilPitch = 0;
    s.weapon.recoilVel = 0;
    s.weapon.spread = 0;
    s.weapon.ammo = 30;
    s.shoot();
  });
  await page.screenshot({ path: path.join(SHOTS, 'combat-02-firing.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    for (const d of [...s.drones.active]) {
      s.drones.damage(d, 999);
      s.effects.explode(d.x, d.y, d.z);
    }
  });
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(SHOTS, 'combat-03-down.png') });

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
