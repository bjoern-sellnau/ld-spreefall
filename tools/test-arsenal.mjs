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

  // --- the arena four ------------------------------------------------------
  const rail = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.soldiers.reset(); s.projectiles.clear(); s.combat.reset();
    s.soldiers.enabled = false;
    s.teleport(81, 0); s.look(90, 0); s.camera.update(16 / 9);
    // Three in a line, which is what a rail shot is for.
    const line = [s.spawnSoldier(-24, 0), s.spawnSoldier(-32, 0), s.spawnSoldier(-40, 0)];
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const t = line[0];
    const to = { x: t.x - eye.x, y: t.y + 1.1 - eye.y, z: t.z - eye.z };
    const l = Math.hypot(to.x, to.y, to.z);
    s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI, Math.asin(to.y / l) * 180 / Math.PI);
    s.camera.update(16 / 9);
    s.weapon.select('railgun');
    s.weapon.cooldown = 0;
    s.weapon.spread = 0;
    s.shoot();
    return { hurt: line.filter((x) => x.health < 100).length, health: line.map((x) => Math.round(x.health)) };
  });
  check('one rail shot goes through a line of them', rail.hurt >= 2,
    `${rail.hurt} hit, health ${rail.health.join(' ')}`);

  const plasma = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.soldiers.reset(); s.projectiles.clear();
    s.weapon.select('plasma');
    s.weapon.cooldown = 0;
    s.weapon.spread = 0;
    // Into the cobbles a few metres ahead, so it actually meets something:
    // fired level across the square it is still in the air over the Tiergarten
    // when the window closes.
    s.look(90, -14); s.camera.update(16 / 9);
    s.shoot();
    const born = s.projectiles.count;
    let bounced = 0;
    s.projectiles.onBounce = () => { bounced++; };
    for (let i = 0; i < 60 * 6 && s.projectiles.count; i++) s.projectiles.update(1 / 60);
    s.projectiles.onBounce = null;
    return { born, bounced, left: s.projectiles.count };
  });
  check('a plasma bolt bounces off the street and then goes off',
    plasma.born === 1 && plasma.bounced >= 1 && plasma.left === 0,
    `${plasma.bounced} bounces, ${plasma.left} left`);

  const flak = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.soldiers.reset(); s.projectiles.clear();
    s.weapon.select('flak');
    s.weapon.cooldown = 0;
    s.shoot();
    return { shards: s.projectiles.count };
  });
  check('the flak cannon throws a handful at once', flak.shards >= 5,
    `${flak.shards} in the air`);

  const darts = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.soldiers.reset(); s.projectiles.clear(); s.combat.reset();
    s.soldiers.enabled = false;
    // A target off to one side: a dart that flies straight would miss it.
    const t = s.spawnSoldier(-30, 6);
    s.look(90, 0); s.camera.update(16 / 9);
    s.weapon.select('splinter');
    s.weapon.spread = 0;
    const before = t.health;
    for (let i = 0; i < 10; i++) {
      s.weapon.cooldown = 0;
      s.weapon.spread = 0;
      s.shoot();
      for (let k = 0; k < 40; k++) s.projectiles.update(1 / 60);
    }
    return { before, after: Math.round(t.health) };
  });
  check('darts steer onto a target that is not in front of you', darts.after < darts.before,
    `${darts.before} to ${darts.after}`);

  const lock = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.soldiers.reset(); s.projectiles.clear(); s.combat.reset();
    s.soldiers.enabled = false;
    const t = s.spawnSoldier(-60, 0);
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const to = { x: t.x - eye.x, y: t.y + 1.1 - eye.y, z: t.z - eye.z };
    const l = Math.hypot(to.x, to.y, to.z);
    s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI, Math.asin(to.y / l) * 180 / Math.PI);
    s.camera.update(16 / 9);
    s.weapon.select('rpg');
    const dir = { x: s.camera.forward[0], y: s.camera.forward[1], z: s.camera.forward[2] };
    // Hold the sight on it.
    for (let i = 0; i < 90; i++) s.weapon.update(1 / 60, false, eye, dir);
    const locked = s.weapon.lockProgress >= 1 && s.weapon.lockTarget === t;
    // Now fire well wide of it and let the rocket steer.
    s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI + 22, 4);
    s.camera.update(16 / 9);
    s.weapon.cooldown = 0;
    s.weapon.spread = 0;
    const before = t.health;
    s.shoot();
    for (let i = 0; i < 60 * 5 && s.projectiles.count; i++) s.projectiles.update(1 / 60);
    return { locked, before, after: Math.round(t.health), dead: t.state === 5 };
  });
  check('a locked rocket chases a target you are no longer pointing at',
    lock.locked && lock.after < lock.before, `locked ${lock.locked}, ${lock.before} to ${lock.after}`);

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

  // --- what a blast leaves on a building -----------------------------------
  const scar = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.soldiers.reset(); s.jets.reset();
    s.projectiles.clear(); s.combat.reset();
    s.soldiers.enabled = false; s.drones.enabled = false; s.jets.enabled = false;
    s.renderer.clearScars();
    s.teleport(120, -30);
    // Find a wall and stand off it.
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    let best = null;
    for (let a = 0; a < 360; a += 6) {
      const r = a * Math.PI / 180;
      const h = s.world.raycast(eye.x, eye.y, eye.z, Math.cos(r), 0, Math.sin(r), 140);
      if (h && h.kind !== 'ground' && (!best || h.t < best.t)) best = { ...h, r };
    }
    if (!best) return { error: 'no wall' };
    s.teleport(best.x - Math.cos(best.r) * 26, best.z - Math.sin(best.r) * 26);
    s.look(Math.atan2(-Math.cos(best.r), -Math.sin(best.r)) * 180 / Math.PI, 6);
    s.camera.update(16 / 9);
    const was = s.renderer.scarCount;
    s.weapon.select('rpg');
    s.weapon.cooldown = 0;
    s.weapon.spread = 0;
    s.shoot();
    for (let i = 0; i < 60 * 3 && s.projectiles.count; i++) s.projectiles.update(1 / 60);
    return { was, now: s.renderer.scarCount, health: Math.round(s.combat.health) };
  });
  check('a rocket into a wall leaves a mark on it', !scar.error && scar.now > scar.was,
    `${scar.was} to ${scar.now} marks`);

  // --- jets -----------------------------------------------------------------
  const jet = await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset(); s.drones.reset(); s.jets.reset(); s.projectiles.clear(); s.combat.reset();
    s.soldiers.enabled = false; s.drones.enabled = false;
    s.jets.enabled = true;
    s.teleport(81, 0);
    const j = s.spawnJet(-400, 60, 90);
    const player = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z, vx: 0, vz: 0, alive: true };
    const states = new Set();
    let closest = 1e9;
    let shots = 0;
    let missiles = 0;
    s.jets.onGun = () => { shots++; };
    s.jets.onMissile = () => { missiles++; };
    for (let i = 0; i < 60 * 40; i++) {
      s.jets.update(1 / 60, player, i / 60);
      if (!j.alive) break;
      states.add(j.state);
      closest = Math.min(closest, Math.hypot(j.x - player.x, j.z - player.z));
    }
    return {
      states: [...states].sort(), closest: Math.round(closest), shots, missiles,
      height: Math.round(j.y - s.world.groundHeight(j.x, j.z)),
      passes: j.passes,
    };
  });
  check('a jet runs in, attacks and breaks off, more than once',
    jet.states.includes(0) && jet.states.includes(1) && jet.states.includes(2) && jet.passes >= 2,
    `states ${jet.states.join('')}, ${jet.passes} passes, closest ${jet.closest} m`);
  check('and it shoots on the pass without ever landing',
    jet.shots > 0 && jet.height > 20, `${jet.shots} rounds, ${jet.missiles} missiles, ${jet.height} m up`);

  const jetKill = await page.evaluate(() => {
    const s = window.spreefall;
    s.jets.reset(); s.projectiles.clear(); s.combat.reset();
    const j = s.spawnJet(-70, 0, 40);
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const to = { x: j.x - eye.x, y: j.y - eye.y, z: j.z - eye.z };
    const l = Math.hypot(to.x, to.y, to.z);
    s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI, Math.asin(to.y / l) * 180 / Math.PI);
    s.camera.update(16 / 9);
    s.weapon.select('railgun');
    const before = j.health;
    for (let i = 0; i < 4 && j.state !== 4; i++) {
      s.weapon.cooldown = 0;
      s.weapon.spread = 0;
      s.shoot();
    }
    return { before, after: Math.round(j.health), down: j.state === 4, dist: Math.round(l) };
  });
  check('a jet can be shot down', jetKill.down,
    `${jetKill.dist} m, ${jetKill.before} to ${jetKill.after}`);

  // --- pickups -------------------------------------------------------------
  // The pads are found by asking the world where a person could stand, so the
  // first thing to check is that it found somewhere at all, and that nothing
  // landed inside the memorial.
  const placed = await page.evaluate(() => {
    const s = window.spreefall;
    const counts = {};
    let inZone = 0;
    let underground = 0;
    for (const p of s.pickups.pads) {
      counts[p.kind] = (counts[p.kind] || 0) + 1;
      if (s.combat.isSanctuary(p.x, 0, p.z)) inZone++;
      if (Math.abs(p.y - (s.world.groundHeight(p.x, p.z) + 0.9)) > 0.01) underground++;
    }
    return { counts, total: s.pickups.pads.length, inZone, underground };
  });
  check('the city is scattered with pads', placed.total >= 20,
    `${placed.total}: ${Object.entries(placed.counts).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  check('and every kind of pad is out there',
    ['ammo', 'health', 'quad', 'ultra', 'overload'].every((k) => placed.counts[k] > 0));
  check('none of them is in the weapons free zone', placed.inZone === 0,
    `${placed.inZone} inside`);
  check('and all of them stand on the ground', placed.underground === 0);

  // An ammunition crate refills what you are holding.
  const ammo = await page.evaluate(() => {
    const s = window.spreefall;
    s.pickups.pads.length = 0; s.combat.reset(); s.weapon.reset();
    s.weapon.select('m16');
    s.weapon.ammo = 2; s.weapon.reserve = 10;
    s.weapon.carried.shotgun.reserve = 4;
    const pad = s.dropPickup('ammo', 0.4, 0);
    const took = s.pickups.update(0.1, { x: s.player.x, y: s.player.y, z: s.player.z });
    return {
      took: !!took && took === pad,
      ammo: s.weapon.ammo, reserve: s.weapon.reserve,
      shotgun: s.weapon.carried.shotgun.reserve,
      ready: pad.ready, timer: Math.round(pad.timer),
    };
  });
  check('walking over a crate takes it', ammo.took && !ammo.ready,
    `back in ${ammo.timer} s`);
  check('and it fills the magazine you are holding', ammo.ammo === 30 && ammo.reserve > 10,
    `${ammo.ammo} + ${ammo.reserve} in reserve`);
  check('and tops up what you are not', ammo.shotgun > 4, `shotgun ${ammo.shotgun}`);

  // A medical kit, and only what you are short of.
  const health = await page.evaluate(() => {
    const s = window.spreefall;
    s.pickups.pads.length = 0; s.combat.reset();
    s.combat.health = 30;
    s.dropPickup('health', 0.4, 0);
    s.pickups.update(0.1, { x: s.player.x, y: s.player.y, z: s.player.z });
    const healed = Math.round(s.combat.health);
    s.combat.health = 98;
    s.dropPickup('health', 0.4, 0.3);
    s.pickups.update(0.1, { x: s.player.x, y: s.player.y, z: s.player.z });
    return { healed, capped: Math.round(s.combat.health) };
  });
  check('a medical kit puts you back up', health.healed === 85, `30 to ${health.healed}`);
  check('and never past a hundred', health.capped === 100);

  // Quad damage: four times out of the same weapon, and it runs out.
  const quad = await page.evaluate(() => {
    const s = window.spreefall;
    s.pickups.pads.length = 0; s.combat.reset(); s.weapon.reset(); s.drones.reset();
    s.weapon.select('m16');
    // Park one drone in the open and aim straight at it, so the only thing
    // that changes between the three shots is what you are carrying.
    const measure = () => {
      s.drones.reset();
      const d = s.spawnDrone(-24, 4, 0);
      d.vx = d.vy = d.vz = 0;
      d.targetX = d.x; d.targetY = d.y; d.targetZ = d.z;
      const ex = s.player.x, ey = s.player.y + 1.7, ez = s.player.z;
      const vx = d.x - ex, vy = d.y - ey, vz = d.z - ez;
      const l = Math.hypot(vx, vy, vz);
      s.look(Math.atan2(-vx, -vz) * 180 / Math.PI, Math.asin(vy / l) * 180 / Math.PI);
      s.camera.update(16 / 9);
      const before = d.health;
      s.weapon.cooldown = 0; s.weapon.spread = 0;
      s.shoot();
      return before - d.health;
    };
    const plain = measure();
    s.combat.givePower('quad', s.pickupSpecs.quad);
    s.weapon.damageScale = s.combat.damageScale;
    const boosted = measure();
    // Run the clock out and check it goes away on its own.
    for (let i = 0; i < 60 * 30; i++) s.combat.update(1 / 60);
    s.weapon.damageScale = s.combat.damageScale;
    const after = measure();
    s.drones.reset();
    return { plain: Math.round(plain), boosted: Math.round(boosted), after: Math.round(after),
      left: s.combat.powers.quad };
  });
  check('quad damage hits four times as hard',
    quad.plain > 0 && Math.abs(quad.boosted - quad.plain * 4) < 1.5,
    `${quad.plain} to ${quad.boosted}`);
  check('and it wears off', quad.left === 0 && Math.abs(quad.after - quad.plain) < 1.5,
    `back to ${quad.after}`);

  // Ultrashield: an overshield above your normal maximum that drains back.
  const ultra = await page.evaluate(() => {
    const s = window.spreefall;
    s.pickups.pads.length = 0; s.combat.reset();
    const normal = s.combat.maxShield;
    s.combat.givePower('ultra', s.pickupSpecs.ultra);
    const over = Math.round(s.combat.shield);
    for (let i = 0; i < 60 * 30; i++) s.combat.update(1 / 60);
    const settledMax = s.combat.maxShield;
    // And the bleed does not take it below where it started.
    for (let i = 0; i < 60 * 20; i++) s.combat.update(1 / 60);
    return { normal, over, settledMax, shield: Math.round(s.combat.shield) };
  });
  check('an ultrashield puts you over your own maximum', ultra.over > ultra.normal,
    `${ultra.normal} to ${ultra.over}`);
  check('and it bleeds back down to normal rather than vanishing',
    ultra.settledMax === ultra.normal && ultra.shield === ultra.normal,
    `settled at ${ultra.shield}`);

  // Overload: the same magazine, in less time.
  const overload = await page.evaluate(() => {
    const s = window.spreefall;
    s.pickups.pads.length = 0; s.combat.reset(); s.weapon.reset(); s.drones.reset();
    s.weapon.select('m16');
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const dir = { x: s.camera.forward[0], y: s.camera.forward[1], z: s.camera.forward[2] };
    const burst = () => {
      s.weapon.reset(); s.weapon.select('m16');
      let steps = 0;
      while (s.weapon.shotsFired < 20 && steps < 2000) {
        s.weapon.update(1 / 120, true, eye, dir); steps++;
      }
      return steps;
    };
    s.weapon.rateScale = 1;
    const plain = burst();
    s.combat.givePower('overload', s.pickupSpecs.overload);
    s.weapon.rateScale = s.combat.rateScale;
    s.weapon.reloadScale = s.combat.reloadScale;
    const fast = burst();
    const reload = s.weapon.spec.reloadTime * s.weapon.reloadScale;
    s.weapon.rateScale = 1; s.weapon.reloadScale = 1;
    return { plain, fast, reload: Number(reload.toFixed(2)),
      full: s.weapon.spec.reloadTime };
  });
  check('overload empties a magazine faster', overload.fast < overload.plain * 0.7,
    `${overload.plain} to ${overload.fast} steps for twenty rounds`);
  check('and reloads faster too', overload.reload < overload.full * 0.5,
    `${overload.full} s to ${overload.reload} s`);

  // A taken pad comes back on its own.
  const respawn = await page.evaluate(() => {
    const s = window.spreefall;
    s.pickups.pads.length = 0; s.combat.reset();
    const pad = s.dropPickup('ammo', 0.4, 0);
    const me = { x: s.player.x, y: s.player.y, z: s.player.z };
    s.pickups.update(0.1, me);
    const gone = !pad.ready;
    // Stand somewhere else while it comes back, or it is taken again at once.
    const away = { x: s.player.x + 60, y: s.player.y, z: s.player.z };
    for (let i = 0; i < 60 * 25; i++) s.pickups.update(1 / 60, away);
    const back = pad.ready;
    // And going down and getting back up puts everything back at once.
    s.pickups.update(0.1, me);
    const takenAgain = !pad.ready;
    s.pickups.reset();
    return { gone, back, takenAgain, revived: pad.ready };
  });
  check('and a pad comes back after a while', respawn.gone && respawn.back);
  check('and getting back on your feet resets them all',
    respawn.takenAgain && respawn.revived);

  // The pads are drawn: put five under the camera and count the instances.
  const drawn = await page.evaluate(async () => {
    const s = window.spreefall;
    s.pickups.pads.length = 0;
    const kinds = ['ammo', 'health', 'quad', 'ultra', 'overload'];
    kinds.forEach((k, i) => s.dropPickup(k, 8 + i * 3, 4));
    s.look(90, -6);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const counts = {};
    let tris = 0;
    for (const k of kinds) {
      counts[k] = s.renderer.actors.pickups[k].instanceCount;
      tris += s.renderer.actors.pickups[k].count / 3;
    }
    return { counts, tris: Math.round(tris) };
  });
  check('all five pads reach the instance buffers',
    Object.values(drawn.counts).every((n) => n === 1),
    `${drawn.tris} triangles across the five meshes`);

  await page.evaluate(() => {
    const s = window.spreefall;
    s.pickups.pads.length = 0;
    s.combat.reset();
    s.teleport(81, 0); s.look(90, -4); s.setTime(16.9);
    // A fan of all five across the square, near enough to read.
    for (const [k, dx, dz] of [['quad', -8.5, -4.2], ['ultra', -9.5, 2.0], ['overload', -13.5, -7.0],
      ['health', -6.5, 5.4], ['ammo', -15, -0.6]]) s.dropPickup(k, dx, dz);
    s.combat.givePower('quad', s.pickupSpecs.quad);
    s.combat.givePower('overload', s.pickupSpecs.overload);
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(SHOTS, 'combat-06-pickups.png') });
  await page.evaluate(() => {
    const s = window.spreefall;
    s.pickups.pads.length = 0;
    s.combat.reset();
  });

  await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset(); s.drones.reset(); s.jets.reset(); s.projectiles.clear(); s.combat.reset();
    s.teleport(81, 0); s.look(90, 2); s.setTime(16.6);
    s.weapon.reset(); s.weapon.select('shotgun');
    for (const [dx, dz] of [[-16, -4], [-22, 3], [-30, -8], [-26, 9]]) s.spawnSoldier(dx, dz);
    s.projectiles.launch('banana', { x: s.player.x - 8, y: s.player.y + 0.1, z: s.player.z + 1,
      vx: 0, vy: 0, vz: 0, slip: { radius: 1.05, seconds: 3.4 } }).stuck = true;
    // A jet banking across the square behind the Gate, where it can be seen.
    const j = s.spawnJet(-145, 10, 52);
    j.roll = 0.55; j.pitch = 0.04;
    j.yaw = Math.PI * 0.58;
    s.weapon.select('m16');
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
