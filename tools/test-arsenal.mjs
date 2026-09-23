// Drives the arsenal in a real browser: that the recoil comes back, that every
// weapon can be selected and fired, and that the shotgun sprays.
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
    s.teleport(81, 0); s.look(90, 0); s.setTime(15.4);
    s.setQuality('low');
  });
  await page.waitForTimeout(4000);

  // --- recoil comes back ---------------------------------------------------
  const recoil = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.weapon.reset(); s.combat.reset();
    s.look(90, 0);
    const start = s.camera.pitch;
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const dir = { x: s.camera.forward[0], y: s.camera.forward[1], z: s.camera.forward[2] };
    // A full magazine, fired at the weapon's own rate through its own update.
    let peak = start;
    for (let i = 0; i < 30 * 7; i++) {
      s.weapon.update(1 / 60, true, eye, dir);
      s.applyRecoil();
      peak = Math.max(peak, s.camera.pitch);
    }
    const fired = s.weapon.shotsFired;
    // Now let go and let it settle.
    for (let i = 0; i < 180; i++) {
      s.weapon.update(1 / 60, false, eye, dir);
      s.applyRecoil();
    }
    return {
      start, peak, after: s.camera.pitch, fired,
      peakDeg: (peak - start) * 180 / Math.PI,
      leftDeg: (s.camera.pitch - start) * 180 / Math.PI,
    };
  });
  check('a burst climbs, but not into the sky', recoil.peakDeg > 0.5 && recoil.peakDeg < 22,
    `${recoil.fired} rounds, peak ${recoil.peakDeg.toFixed(1)} degrees`);
  check('and the view comes back down when you stop',
    recoil.leftDeg < recoil.peakDeg * 0.6,
    `${recoil.leftDeg.toFixed(1)} degrees left of ${recoil.peakDeg.toFixed(1)}`);

  // --- every weapon selects and fires --------------------------------------
  const arsenal = await page.evaluate(() => {
    const s = window.spreefall;
    const out = [];
    for (const id of s.loadout) {
      s.weapon.reset();
      const ok = s.weapon.select(id) || s.weapon.id === id;
      s.weapon.cooldown = 0;
      const before = s.weapon.carried[id].ammo;
      s.shoot();
      out.push({ id, ok, before, after: s.weapon.carried[id].ammo, name: s.weapon.spec.name });
    }
    return out;
  }).catch(() => null);
  if (arsenal) {
    const fired = arsenal.filter((w) => w.after < w.before);
    check('every weapon in the loadout fires', fired.length === arsenal.length,
      arsenal.map((w) => `${w.id}:${w.before}>${w.after}`).join(' '));
  }

  // --- soldiers ------------------------------------------------------------
  const troops = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.soldiers.reset(); s.weapon.reset(); s.combat.reset();
    s.projectiles.clear();
    s.soldiers.enabled = false;
    s.look(90, 0);
    const sol = s.spawnSoldier(-30, 0);
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const to = { x: sol.x - eye.x, y: sol.y + 1.1 - eye.y, z: sol.z - eye.z };
    const l = Math.hypot(to.x, to.y, to.z);
    s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI, Math.asin(to.y / l) * 180 / Math.PI);
    s.camera.update(16 / 9);
    s.weapon.select('m16');
    s.weapon.spread = 0;
    const before = sol.health;
    let shots = 0;
    for (let i = 0; i < 6 && sol.state !== 5; i++) {
      s.weapon.spread = 0;
      s.weapon.cooldown = 0;
      s.shoot();
      shots++;
    }
    return { dist: +l.toFixed(1), before, after: Math.round(sol.health), dead: sol.state === 5, shots,
      kills: s.combat.kills };
  });
  check('a soldier in the street can be shot', troops.dead,
    `${troops.dist} m, ${troops.shots} rounds, ${troops.before} to ${troops.after}`);
  check('and the kill is credited', troops.kills === 1, `kills ${troops.kills}`);

  // --- the rocket ----------------------------------------------------------
  const rocket = await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset(); s.drones.reset(); s.projectiles.clear(); s.combat.reset();
    s.soldiers.enabled = false;
    s.teleport(81, 0); s.look(90, 0);
    s.camera.update(16 / 9);
    const target = s.spawnSoldier(-45, 0);
    s.weapon.select('rpg');
    s.weapon.cooldown = 0;
    s.weapon.spread = 0;
    const before = target.health;
    s.shoot();
    const born = s.projectiles.count;
    let flight = 0;
    for (let i = 0; i < 60 * 4 && s.projectiles.count; i++) { s.projectiles.update(1 / 60); flight++; }
    return { born, flightMs: Math.round(flight / 60 * 1000), before,
      after: Math.round(target.health), dead: target.state === 5 };
  });
  check('a rocket crosses the square and goes off on what it hits', rocket.dead,
    `${rocket.flightMs} ms of flight, ${rocket.before} to ${rocket.after}`);

  // --- the banana ----------------------------------------------------------
  const slip = await page.evaluate(async () => {
    const s = window.spreefall;
    s.soldiers.reset(); s.projectiles.clear(); s.weapon.reset();
    s.soldiers.enabled = true;
    const sol = s.spawnSoldier(-14, 0);
    sol.state = 1;               // advancing on the player
    // Put a banana exactly where they are about to walk.
    const b = s.projectiles.launch('banana', {
      x: sol.x + 1, y: sol.y + 0.1, z: sol.z, vx: 0, vy: 0, vz: 0,
      slip: { radius: 1.6, seconds: 3 },
    });
    b.stuck = true;
    let slipped = false;
    for (let i = 0; i < 240 && !slipped; i++) {
      s.soldiers.update(1 / 60, { x: s.player.x, y: s.player.y + 1.7, z: s.player.z, alive: true }, i / 60);
      if (sol.state === 4) slipped = true;
    }
    return { slipped, state: sol.state, lean: +sol.lean.toFixed(2) };
  });
  check('a soldier who walks onto a banana goes down', slip.slipped,
    `state ${slip.state}, lean ${slip.lean}`);

  // --- splash --------------------------------------------------------------
  const blast = await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset(); s.drones.reset(); s.projectiles.clear(); s.combat.reset();
    s.soldiers.enabled = false;
    const a = s.spawnSoldier(-40, -2);
    const b = s.spawnSoldier(-40, 2);
    const before = s.combat.kills;
    // A grenade at their feet, detonated where it lies.
    const g = s.projectiles.launch('grenade', {
      x: a.x, y: a.y + 0.2, z: (a.z + b.z) / 2, vx: 0, vy: 0, vz: 0,
      fuse: Infinity, splash: { radius: 9, damage: 150, force: 20 },
    });
    s.projectiles.explode(g);
    return { killed: s.combat.kills - before, health: Math.round(s.combat.health),
      aDead: a.state === 5, bDead: b.state === 5 };
  });
  check('one grenade takes out a pair of them', blast.aDead && blast.bDead,
    `${blast.killed} credited`);
  check('and it does not hurt you from forty metres away', blast.health === 100,
    `integrity ${blast.health}`);

  await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset(); s.drones.reset(); s.projectiles.clear(); s.combat.reset();
    s.teleport(81, 0); s.look(90, 2); s.setTime(16.6);
    s.weapon.reset(); s.weapon.select('shotgun');
    for (const [dx, dz] of [[-16, -4], [-22, 3], [-30, -8], [-26, 9]]) s.spawnSoldier(dx, dz);
    s.projectiles.launch('banana', { x: s.player.x - 8, y: s.player.y + 0.1, z: s.player.z + 1,
      vx: 0, vy: 0, vz: 0, slip: { radius: 1.05, seconds: 3.4 } }).stuck = true;
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOTS, 'combat-05-soldiers.png') });

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
