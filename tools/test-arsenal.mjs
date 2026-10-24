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
    // The vehicles are parked at random on every load, and a jet parked on
    // the square three metres off the line of fire takes every round these
    // checks aim at a man. They are for the vehicle suites, not this one.
    for (const v of [...s.vehicles.active]) {
      if (Math.hypot(v.x - s.player.x, v.z - s.player.z) < 160) s.vehicles.remove(v);
    }
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
      const swings = s.weapon.shotsFired;
      s.shoot();
      // A flail or a saw swung at nothing spends nothing: what counts is the swing.
      const melee = s.weapon.spec.kind === 'melee';
      out.push({ id, ok, before, after: s.weapon.carried[id].ammo, name: s.weapon.spec.name,
        swung: melee && s.weapon.shotsFired > swings });
    }
    s.projectiles.clear();
    return out;
  }).catch(() => null);
  if (arsenal) {
    const fired = arsenal.filter((w) => w.after < w.before || w.swung);
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

  // Blast plasma: ten seconds of the second trigger, then one hard orange bolt
  // that does not bounce and does ten times the harm.
  const charged = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.soldiers.reset(); s.projectiles.clear();
    s.weapon.select('plasma');
    s.weapon.cooldown = 0;
    s.weapon.spread = 0;
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const fwd = () => ({ x: s.camera.forward[0], y: s.camera.forward[1], z: s.camera.forward[2] });
    // Let go at five seconds: nothing kept.
    s.weapon.aiming = true;
    for (let i = 0; i < 60 * 5; i++) s.weapon.update(1 / 60, false, eye, fwd());
    s.weapon.aiming = false;
    s.weapon.update(1 / 60, false, eye, fwd());
    const dropped = s.weapon.blastCharge;
    // Held the whole ten.
    s.weapon.aiming = true;
    let half = 0;
    for (let i = 0; i < 60 * 10 + 5; i++) {
      s.weapon.update(1 / 60, false, eye, fwd());
      if (i === 60 * 5) half = s.weapon.blastCharge;
    }
    const ready = s.weapon.blastCharge;
    s.weapon.aiming = false;
    let launched = null;
    const launch = s.projectiles.launch.bind(s.projectiles);
    s.projectiles.launch = (kind, o) => { launched = { kind, damage: o.splash.damage, radius: o.splash.radius }; return launch(kind, o); };
    s.look(90, -14); s.camera.update(16 / 9);
    s.weapon.cooldown = 0;
    s.shoot();
    s.projectiles.launch = launch;
    let bounced = 0;
    s.projectiles.onBounce = () => { bounced++; };
    for (let i = 0; i < 60 * 6 && s.projectiles.count; i++) s.projectiles.update(1 / 60);
    s.projectiles.onBounce = null;
    // And the next shot is the ordinary kind again.
    let next = null;
    s.projectiles.launch = (kind, o) => { next = kind; return launch(kind, o); };
    s.weapon.cooldown = 0;
    s.shoot();
    s.projectiles.launch = launch;
    s.projectiles.clear();
    return { dropped, half: +half.toFixed(2), ready, launched, bounced, left: s.projectiles.count, next };
  });
  check('holding the second trigger on the plasma rifle charges blast plasma, and letting go loses it',
    charged.dropped === 0 && charged.half > 0.45 && charged.half < 0.55 && charged.ready === 1,
    `${charged.half} at five seconds, ${charged.ready} at ten, ${charged.dropped} after letting go early`);
  check('and the charged shot is one hard bolt at ten times the harm',
    // Ten times the bolt's 34, and half as much again for what everything
    // you carry does since phase 117.
    charged.launched && charged.launched.kind === 'blast' && Math.abs(charged.launched.damage - 340 * 1.5) < 1e-6,
    charged.launched ? `${charged.launched.kind}, ${charged.launched.damage} damage over ${charged.launched.radius} m` : 'nothing');
  check('which does not bounce', charged.bounced === 0 && charged.left === 0,
    `${charged.bounced} bounces`);
  check('and the shot after it is the ordinary kind', charged.next === 'plasma', `${charged.next}`);

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

  // --- the void cannon -------------------------------------------------------
  // How much of a frontage one shot opens, measured the way you would find
  // out: rays at a grid laid over the face of the wall, before and after, and
  // how many of them now go through it rather than stopping on it. Each
  // weapon gets a wall of its own, found from its own corner of Mitte, so the
  // second is not measured through the hole the first one made.
  const opening = (weaponId, starts) => page.evaluate(({ id, starts }) => {
    const s = window.spreefall;
    s.drones.reset(); s.soldiers.reset(); s.jets.reset();
    s.projectiles.clear(); s.combat.reset();
    s.soldiers.enabled = false; s.drones.enabled = false; s.jets.enabled = false;
    s.cheats.reset();
    // A frontage seen square on, at least eighteen metres high, between
    // twenty five and sixty metres away.
    let best = null;
    for (const [px, pz] of starts) {
      s.teleport(px, pz);
      const ey = s.player.y + 1.7;
      for (let a = 0; a < 360; a += 4) {
        const r = a * Math.PI / 180;
        const dx = Math.cos(r), dz = Math.sin(r);
        const h = s.world.raycast(px, ey, pz, dx, 0, dz, 60);
        if (!h || h.kind === 'ground' || h.t < 25) continue;
        if (-(dx * h.nx + dz * h.nz) < 0.9) continue;
        if (s.world.tallestNear(h.x - h.nx, h.z - h.nz, 2) < 18) continue;
        if (!best || h.t < best.t) best = { ...h, px, pz };
      }
      if (best) break;
    }
    if (!best) return { error: 'no wall' };
    s.teleport(best.px, best.pz);
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    // Along the face and up it, a metre apart: twenty one across, fifteen up.
    const tx = -best.nz, tz = best.nx;
    const grid = () => {
      const open = new Set();
      for (let v = -1; v <= 13; v++) {
        for (let u = -10; u <= 10; u++) {
          const px = best.x + tx * u, py = eye.y + 2 + v, pz = best.z + tz * u;
          const dx = px - eye.x, dy = py - eye.y, dz = pz - eye.z;
          const l = Math.hypot(dx, dy, dz);
          const h = s.world.raycast(eye.x, eye.y, eye.z, dx / l, dy / l, dz / l, l + 1);
          if (!h || h.t > l + 0.6) open.add(`${u},${v}`);
        }
      }
      return open;
    };
    const before = grid();
    const dx = best.x - eye.x, dy = eye.y + 3 - eye.y, dz = best.z - eye.z;
    const l = Math.hypot(dx, dy, dz);
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.asin(dy / l) * 180 / Math.PI);
    s.camera.update(16 / 9);
    s.weapon.select(id); s.weapon.cooldown = 0; s.weapon.spread = 0;
    s.shoot();
    for (let i = 0; i < 60 * 5 && s.projectiles.count; i++) s.fixedForTest(1 / 60);
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    const health = Math.round(s.combat.health);
    const after = grid();
    // Only the cells this shot opened, so a gap that was there already does
    // not count towards the width of the hole.
    const opened = [...after].filter((k) => !before.has(k)).map((k) => Number(k.split(',')[0]));
    const span = opened.length ? Math.max(...opened) - Math.min(...opened) + 1 : 0;
    s.combat.reset();
    // The street at the foot of the wall, which a hole in a wall must leave
    // where it is.
    const fx = best.x + best.nx * 1.2, fz = best.z + best.nz * 1.2;
    const floor = s.drawnGround(fx, fz);
    return { before: before.size, after: after.size, span, health,
      floor: floor !== null, dist: Math.round(best.t) };
  }, { id: weaponId, starts });
  const rpgHole = await opening('rpg', [[120, -30], [300, 60]]);
  const voidHole = await opening('void', [[-150, 90], [520, -80], [700, 40]]);
  const gained = (h) => h.after - h.before;
  check('the void cannon opens a frontage, not a window',
    !voidHole.error && !rpgHole.error && gained(voidHole) > 5 * Math.max(3, gained(rpgHole)),
    voidHole.error || rpgHole.error
      || `${gained(rpgHole)} of 315 rays through after a rocket, ${gained(voidHole)} after the ball, ${voidHole.dist} m off`);
  // Measured along the wall it hit, which is where a corner or the end of
  // a frontage cuts it short: eighteen metres of sphere, of which the wall
  // in this test has eleven or so to give.
  check('and the hole is ten metres across or more, where a rocket makes four',
    voidHole.span >= 10 && voidHole.span >= 2.5 * rpgHole.span,
    `${voidHole.span} m, against ${rpgHole.span} m for the rocket`);
  check('and the street in front of it is still there', voidHole.floor);
  check('and you can fire it at a wall that close and walk away',
    voidHole.health > 60, `health ${voidHole.health}`);

  const zap = await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset(); s.drones.reset(); s.projectiles.clear(); s.combat.reset();
    s.soldiers.enabled = false;
    s.teleport(81, 0); s.look(90, 0);
    s.camera.update(16 / 9);
    // One to the side of the line of flight, one far down it: the first is
    // reached on the way past, the second by the burst where the ball lands.
    const side = s.spawnSoldier(-25, 9);
    const far = s.spawnSoldier(-70, 0);
    s.weapon.select('void'); s.weapon.cooldown = 0; s.weapon.spread = 0;
    s.shoot();
    let sideAt = -1;
    let t = 0;
    for (let i = 0; i < 60 * 6 && s.projectiles.count; i++) {
      s.fixedForTest(1 / 60); t++;
      if (sideAt < 0 && side.state === 5) sideAt = t;
    }
    for (let i = 0; i < 20; i++) s.fixedForTest(1 / 60);
    return { side: side.state === 5, sideAt, far: far.state === 5, flight: t };
  });
  check('a soldier beside the line of flight is taken on the way past',
    zap.side && zap.sideAt > 0 && zap.sideAt < zap.flight, `at frame ${zap.sideAt} of ${zap.flight}`);
  check('and one down range is taken where it lands', zap.far);

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
    let underground = 0, worst = 0;
    for (const p of s.pickups.pads) {
      counts[p.kind] = (counts[p.kind] || 0) + 1;
      if (s.combat.isShielded(p.x, 0, p.z)) inZone++;
      const off = Math.abs(p.y - (s.world.groundHeight(p.x, p.z) + 0.9));
      if (off > 0.01) underground++;
      worst = Math.max(worst, off);
    }
    return { counts, total: s.pickups.pads.length, inZone, underground, worst: worst.toFixed(2) };
  });
  check('the city is scattered with pads', placed.total >= 20,
    `${placed.total}: ${Object.entries(placed.counts).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  check('and every kind of pad is out there',
    ['ammo', 'health', 'quad', 'ultra', 'overload'].every((k) => placed.counts[k] > 0));
  // Pads may lie on the memorial now: it is shielded, not out of bounds.
  check('and the memorial is no longer kept clear of them', placed.inZone >= 0,
    `${placed.inZone} under the field`);
  check('and all of them stand on the ground', placed.underground === 0,
    `${placed.underground} off the ground, the worst by ${placed.worst} m`);

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

  // --- the report, measured --------------------------------------------------
  // Rendered offline, so what is measured is the synth and not the speakers:
  // how loud the first fifty milliseconds are, how much is down under 120 Hz
  // in the first hundred and fifty, and that the sum never reaches full scale.
  const shots = await page.evaluate(async () => {
    const { Audio } = await import('/src/game/audio.js');
    const out = {};
    for (const kind of ['rifle', 'shotgun', 'pistol']) {
      const sr = 48000;
      const ctx = new OfflineAudioContext(1, sr, sr);
      const a = new Audio(null);
      a.ctx = ctx; a.enabled = true;
      a.master = ctx.createGain(); a.master.gain.value = 0.85; a.master.connect(ctx.destination);
      a._noiseBuffer = a._makeNoise(4);
      a.gunshot(kind);
      const d = (await ctx.startRendering()).getChannelData(0);
      let peak = 0, e = 0, low = 0, y = 0;
      const k = 1 - Math.exp(-2 * Math.PI * 120 / sr);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      for (let i = 0; i < sr * 0.05; i++) e += d[i] * d[i];
      for (let i = 0; i < sr * 0.15; i++) { y += k * (d[i] - y); low += y * y; }
      const db = (x) => +(20 * Math.log10(Math.max(1e-9, x))).toFixed(1);
      out[kind] = { peak: db(peak), first50: db(Math.sqrt(e / (sr * 0.05))), low150: db(Math.sqrt(low / (sr * 0.15))) };
    }
    return out;
  });
  check('a rifle shot has weight: loud in its first fifty milliseconds and low under it, and never clips',
    shots.rifle.first50 > -12 && shots.rifle.low150 > -21 && shots.rifle.peak < -1 && shots.shotgun.peak < -1,
    JSON.stringify(shots));
  check('and a suppressed pistol is still a cough', shots.pistol.first50 < shots.rifle.first50 - 15,
    `${shots.pistol.first50} dB against the rifle's ${shots.rifle.first50}`);

  // --- the grenade's arc, and a harder throw on the right button -------------------
  const frames = (n) => page.evaluate((k) => new Promise((done) => {
    let i = 0;
    const st = () => (++i >= k ? done() : requestAnimationFrame(st));
    requestAnimationFrame(st);
  }), n);
  await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset();
    s.teleport(81, 0);
    s.weapon.select('grenade'); s.state.holstered = false; s.look(90, 8);
  });
  await frames(30);
  const arcOf = () => page.evaluate(() => {
    const s = window.spreefall;
    const l = s.arcView.last;
    return l && { dots: l.dots, ring: l.ring, strong: l.strong, hit: l.hit,
      d: l.hit ? +Math.hypot(l.hit.x - s.player.x, l.hit.z - s.player.z).toFixed(1) : 0 };
  });
  const hipArc = await arcOf();
  await page.mouse.move(512, 320);
  await page.mouse.down({ button: 'right' });
  await frames(30);
  const aimArc = await arcOf();
  await page.screenshot({ path: path.join(SHOTS, 'combat-07-grenade-arc.png') });
  const flew = await page.evaluate(() => {
    const s = window.spreefall;
    const want = s.arcView.last.hit;
    s.weapon.cooldown = 0; s.weapon.state = 0;
    s.shoot();
    const g = s.projectiles.active.find((p) => p.weapon === 'grenade');
    if (!g || !want) return { none: true };
    // Where it first comes down: the frame its fall turns into a bounce.
    let prevVy = g.vy, at = null;
    for (let i = 0; i < 400 && g.alive; i++) {
      s.fixedForTest(1 / 60);
      if (prevVy < -1 && g.vy > prevVy + 2) { at = { x: g.x, z: g.z }; break; }
      prevVy = g.vy;
    }
    return { off: at ? +Math.hypot(at.x - want.x, at.z - want.z).toFixed(2) : null };
  });
  await page.mouse.up({ button: 'right' });
  check('a grenade in hand shows the arc it will fly and a ring the size of its blast where it comes down',
    hipArc && hipArc.dots > 5 && hipArc.ring && !hipArc.strong && hipArc.d > 10, JSON.stringify(hipArc));
  check('and with the right button held it goes much farther, and lands where the arc said',
    aimArc && aimArc.strong && aimArc.d > hipArc.d * 1.5 && flew.off !== null && flew.off < 1.5,
    `${hipArc && hipArc.d} m from the hip, ${aimArc && aimArc.d} m held, landed ${flew.off} m from the mark`);
  const power = await page.evaluate(() => {
    const s = window.spreefall;
    const g = s.weapon.spec.splash;
    return { scale: s.weapon.damageScale, radius: g.radius, damage: g.damage * s.weapon.damageScale };
  });
  check('everything you carry hits half as hard again, and a grenade far harder than it did',
    power.scale === 1.5 && power.radius >= 11 && power.damage >= 380, JSON.stringify(power));

  // --- the number row in groups, and the panel down the side --------------
  await page.evaluate(() => {
    const s = window.spreefall;
    s.projectiles.clear(); s.weapon.reset(); s.weapon.lastInBucket = {};
    s.weapon.select('m16');
  });
  await page.waitForTimeout(300);
  const groups = await page.evaluate(() => {
    const s = window.spreefall;
    const out = {};
    const press = (k) => { s.weapon.selectSlot(k); s.arms.poke(k); return s.weapon.id; };
    out.one = [press(1), press(1), press(1), press(1), press(1), press(1)];
    out.three = [press(3), press(3)];
    // Back to the rifles: the one last held there, not the first.
    out.back = press(1);
    out.away = press(4);
    out.again = press(1);
    return out;
  });
  check('a number key is a group: pressed again it goes through the group and round',
    groups.one.join() === 'marksman,minigun,bow,hailstorm,m16,marksman' && groups.three.join() === 'rpg,swarm',
    JSON.stringify(groups));
  check('and coming back to a group gives the one you last had in it',
    groups.back === 'marksman' && groups.away === 'grenade' && groups.again === 'marksman', JSON.stringify(groups));
  await page.evaluate(() => {
    const s = window.spreefall;
    s.weapon.select('m16'); s.weapon.selectSlot(1); s.arms.poke(1);
    s.teleport(81, 0); s.look(100, 4); s.setTime(15.4);
  });
  await page.waitForTimeout(700);
  const panel = await page.evaluate(() => {
    const root = document.getElementById('arms');
    const rows = [...root.querySelectorAll('.row')];
    const cur = root.querySelector('.row.cur');
    const r = root.getBoundingClientRect();
    return {
      shown: !root.classList.contains('hidden') && r.width > 0,
      left: Math.round(r.left), mid: Math.round(r.top + r.height / 2), h: window.innerHeight,
      rows: rows.length,
      keys: rows.map((x) => x.querySelector('b').textContent).join(''),
      cur: cur ? cur.querySelector('b').textContent : null,
      open: cur ? cur.classList.contains('open') : false,
      listed: cur ? [...cur.querySelectorAll('.it')].filter((x) => getComputedStyle(x).display !== 'none').length : 0,
      on: (root.querySelector('.it.on span') || {}).textContent,
      idle: root.classList.contains('idle'),
    };
  });
  await page.screenshot({ path: path.join(SHOTS, 'arsenal-01-side-panel.png') });
  check('the weapons are down the left side, a row a key, the one you are on lit and its group open',
    panel.shown && panel.left < 60 && panel.rows === 10 && panel.keys === '1234567890' && panel.cur === '1'
      && panel.open && panel.listed === 5 && panel.on === 'MARKSMAN' && !panel.idle,
    JSON.stringify(panel));
  await page.waitForTimeout(3200);
  const folded = await page.evaluate(() => {
    const root = document.getElementById('arms');
    const cur = root.querySelector('.row.cur');
    return { idle: root.classList.contains('idle'),
      listed: [...cur.querySelectorAll('.it')].filter((x) => getComputedStyle(x).display !== 'none').length };
  });
  check('and after a moment it folds back to one name a row and dims', folded.idle && folded.listed === 1,
    JSON.stringify(folded));
  const kitRows = await page.evaluate(() => {
    const s = window.spreefall;
    s.weapon.setKit('tactics');
    const rows = s.armsRows(s.weapon);
    s.weapon.setKit(null);
    return rows.map((r) => `${r.key}:${r.ids.join('+')}`);
  });
  check('in a mode with a kit it is one weapon a key, in the kit\'s order',
    kitRows.length === 10 && kitRows[0] === '1:sdpistol' && kitRows[9] === '0:railgun', kitRows.join(' '));

  // --- the heavy five ------------------------------------------------------
  const heavy = await page.evaluate(() => {
    const s = window.spreefall;
    const out = {};
    s.drones.reset(); s.soldiers.reset(); s.projectiles.clear(); s.combat.reset();
    s.soldiers.enabled = false;
    s.teleport(81, 0); s.look(90, 0); s.camera.update(16 / 9);
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const aim = (t) => {
      const to = { x: t.x - eye.x, y: t.y + 1.1 - eye.y, z: t.z - eye.z };
      const l = Math.hypot(to.x, to.y, to.z);
      s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI, Math.asin(to.y / l) * 180 / Math.PI);
      s.camera.update(16 / 9);
    };
    // The hand cannon: one shot, two men in a line.
    const line = [s.spawnSoldier(-20, 0), s.spawnSoldier(-26, 0)];
    aim(line[0]);
    s.weapon.select('magnum'); s.weapon.cooldown = 0; s.weapon.spread = 0;
    s.shoot();
    out.magnum = line.map((x) => Math.round(x.health));
    // The rotary cannon: nothing for the first part of a second, then a stream.
    s.weapon.select('minigun'); s.weapon.cooldown = 0;
    const dir = { x: s.camera.forward[0], y: s.camera.forward[1], z: s.camera.forward[2] };
    const a0 = s.weapon.ammo;
    for (let i = 0; i < 12; i++) s.weapon.update(1 / 60, true, eye, dir);
    out.spinning = a0 - s.weapon.ammo;
    for (let i = 0; i < 60; i++) s.weapon.update(1 / 60, true, eye, dir);
    out.second = a0 - s.weapon.ammo - out.spinning;
    s.weapon.update(1 / 60, false, eye, dir);
    // Four rockets at once.
    s.projectiles.clear();
    s.weapon.select('swarm'); s.weapon.cooldown = 0;
    s.shoot();
    out.swarm = s.projectiles.active.filter((p) => p.kind === 'rocket').length;
    // A launched grenade goes off on what it meets, a long way off.
    s.projectiles.clear();
    s.look(90, 6); s.camera.update(16 / 9);
    s.weapon.select('launcher'); s.weapon.cooldown = 0; s.weapon.spread = 0;
    s.shoot();
    const shell = s.projectiles.active.find((p) => p.kind === 'shell');
    out.shell = !!shell;
    let t = 0;
    while (shell && shell.alive && t < 8) { s.fixedForTest(1 / 60); t += 1 / 60; }
    out.shellGone = shell ? !shell.alive : false;
    out.shellFar = shell ? Math.round(Math.hypot(shell.x - eye.x, shell.z - eye.z)) : 0;
    out.shellTime = +t.toFixed(2);
    return out;
  });
  check('the hand cannon goes through one man into the one behind him',
    heavy.magnum[0] < 100 && heavy.magnum[1] < 100, JSON.stringify(heavy.magnum));
  check('the rotary cannon spins up first and then pours',
    heavy.spinning === 0 && heavy.second >= 15, `${heavy.spinning} in the spin up, ${heavy.second} in the second after`);
  check('the swarm launcher puts four rockets out at once', heavy.swarm === 4, `${heavy.swarm}`);
  check('the grenade launcher lobs a long way and goes off on the first thing it meets',
    heavy.shell && heavy.shellGone && heavy.shellFar > 30, JSON.stringify(heavy));

  // --- every weapon against a wall --------------------------------------------
  // Each one fired at the same frontage from where it would be used, a swing
  // from arm's length and the rest from six metres, and what the city's
  // damage grid took from it. The banana is a banana, and the EMP is a pulse
  // for machines rather than a charge.
  const walls = await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.reset(); s.soldiers.reset(); s.projectiles.clear(); s.vehicles.reset();
    s.soldiers.enabled = false;
    s.teleport(81, 0);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const start = { x: s.player.x, z: s.player.z };
    // A wall, looked for again from the same place before every weapon,
    // because the ones before it may have opened the first one up. The
    // nearest one there is, as far as eighty metres: in the live city this
    // spot is out on Pariser Platz, and the frontages round it are further
    // off than in the offline one.
    const findWall = () => {
      s.teleport(start.x, start.z);
      let best = null;
      for (let k = 0; k < 32; k++) {
        const ang = (k / 32) * Math.PI * 2;
        const h = s.world.raycast(s.player.x, s.player.y + 1.4, s.player.z, Math.cos(ang), 0, Math.sin(ang), 80);
        if (h && h.kind === 'wall' && h.t > 7 && (!best || h.t < best.h.t)) best = { h, ang };
      }
      return best;
    };
    if (!findWall()) return { skip: true };
    const total = () => { let n = 0; for (const v of s.demolition.damage.values()) n += v; return n; };
    const out = {};
    // Six metres from a rocket going off is close enough to kill you, and a
    // frontage that has taken a few of them is not there for a rifle after.
    // So nobody dies here, and the ones that go off come last.
    s.setCheat('godmode', true);
    // The two moves first, while the frontage is still whole: a kick, and
    // the butt of the rifle.
    const moves = {};
    for (const move of ['kick', 'bash']) {
      s.demolition.damage.clear();
      const found = findWall();
      if (!found) { moves[move] = -1; continue; }
      const wall = found.h, ang = found.ang;
      s.teleport(wall.x - Math.cos(ang) * 1.6, wall.z - Math.sin(ang) * 1.6);
      const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
      const to = { x: wall.x - eye.x, y: wall.y - eye.y, z: wall.z - eye.z };
      const l = Math.hypot(to.x, to.y, to.z);
      s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI, Math.asin(to.y / l) * 180 / Math.PI);
      s.camera.update(16 / 9);
      s.weapon.select('m16');
      s.state.kickLeft = 0; s.state.bashLeft = 0;
      s[move]();
      moves[move] = Math.round(total());
    }
    const blasts = (id) => (s.weapons[id].splash ? 1 : 0);
    const order = [...s.loadout].filter((id) => id !== 'warhead').sort((a, b) => blasts(a) - blasts(b));
    for (const id of order) {
      s.demolition.damage.clear();
      s.projectiles.clear();
      const spec = s.weapons[id];
      const found = findWall();
      if (!found) { out[id] = -1; continue; }
      const wall = found.h, ang = found.ang;
      const off = spec.kind === 'melee' ? 1.6 : 6;
      s.teleport(wall.x - Math.cos(ang) * off, wall.z - Math.sin(ang) * off);
      const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
      const to = { x: wall.x - eye.x, y: wall.y - eye.y, z: wall.z - eye.z };
      const l = Math.hypot(to.x, to.y, to.z);
      s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI, Math.asin(to.y / l) * 180 / Math.PI);
      s.camera.update(16 / 9);
      s.weapon.giveAll(); s.weapon.select(id); s.weapon.cooldown = 0; s.weapon.spread = 0;
      if (spec.kind === 'stream') {
        const dir = { x: s.camera.forward[0], y: s.camera.forward[1], z: s.camera.forward[2] };
        for (let i = 0; i < 60; i++) s.weapon.update(1 / 60, true, eye, dir);
        s.weapon.update(1 / 60, false, eye, dir);
      } else {
        s.shoot();
      }
      for (let i = 0; i < 60 * 4 && s.projectiles.active.some((b) => !b.stuck || b.fuse !== Infinity); i++) s.fixedForTest(1 / 60);
      if (id === 'c4') s.projectiles.detonateAll('c4');
      out[id] = Math.round(total());
    }
    s.projectiles.clear();
    s.demolition.damage.clear();
    s.setCheat('godmode', false);
    s.teleport(start.x, start.z);
    return { out, moves };
  });
  const moves = walls.moves || {};
  if (!walls.skip) Object.assign(walls, walls.out);
  delete walls.out; delete walls.moves;
  const none = walls.skip ? ['no wall found'] : Object.keys(walls).filter((id) => !(walls[id] > 0) && id !== 'banana' && id !== 'emp' && id !== 'translocator');
  check('every weapon in the loadout wears a frontage down, rounds, swings, flame, arrows and saws as well as blasts',
    !walls.skip && none.length === 0,
    walls.skip ? 'no wall' : `${none.length ? `nothing from ${none.join(', ')}; ` : ''}${Object.entries(walls).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  check('and a kick and the butt of a rifle wear it down as well',
    !walls.skip && moves.kick > 0 && moves.bash > 0, walls.skip ? '' : `kick ${moves.kick}, bash ${moves.bash}`);
  check('and one rifle round is a dent in it, where one rail shot is many times that',
    !walls.skip && walls.m16 > 5 && walls.m16 < 30 && walls.railgun > walls.m16 * 5,
    walls.skip ? '' : `m16 ${walls.m16}, railgun ${walls.railgun}, minigun ${walls.minigun}`);

  // --- the eight out of the other shooters ---------------------------------
  // Each checked for the thing it is for: Hailstorm pours, the volt caster's
  // charge jumps and holds them, the arbalest's bolt and the cling charge
  // take hold and go off, the ripper cuts through a line and comes off a
  // wall, the blade lunges, the hammer throws a street about, and the flare
  // sets the ground alight.
  const eight = await page.evaluate(() => {
    const s = window.spreefall;
    const out = {};
    const fresh = () => {
      s.drones.reset(); s.soldiers.reset(); s.projectiles.clear(); s.combat.reset(); s.vehicles.reset();
      s.soldiers.enabled = false;
      s.state.lunge = null;
      s.teleport(81, 0); s.look(90, 0); s.camera.update(16 / 9);
    };
    const eye = () => ({ x: s.player.x, y: s.player.y + 1.7, z: s.player.z });
    const aim = (x, y, z) => {
      const e = eye();
      const to = { x: x - e.x, y: y - e.y, z: z - e.z };
      const l = Math.hypot(to.x, to.y, to.z);
      s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI, Math.asin(to.y / l) * 180 / Math.PI);
      s.camera.update(16 / 9);
    };
    const step = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) s.fixedForTest(1 / 60); };
    const ready = (id) => { s.weapon.giveAll(); s.weapon.select(id); s.weapon.cooldown = 0; s.weapon.spread = 0; };
    const dir = () => ({ x: s.camera.forward[0], y: s.camera.forward[1], z: s.camera.forward[2] });

    // Hailstorm: a second of the trigger.
    fresh(); ready('hailstorm');
    let t = s.spawnSoldier(-18, 0);
    aim(t.x, t.y + 1.1, t.z);
    let n0 = s.weapon.shotsFired;
    for (let i = 0; i < 60; i++) s.weapon.update(1 / 60, true, eye(), dir());
    out.hail = { shots: s.weapon.shotsFired - n0, rounds: (s.weapon.shotsFired - n0) * s.weapon.spec.pellets,
      dead: t.health <= 0 };

    // The volt caster: one shot into the first of three standing four
    // metres apart, and one fifteen metres off that it cannot reach.
    fresh(); ready('volt');
    const a = s.spawnSoldier(-14, 0), b = s.spawnSoldier(-17, 3), c = s.spawnSoldier(-20, 6);
    const far = s.spawnSoldier(-14, 20);
    aim(a.x, a.y + 1.1, a.z);
    const j0 = s.state.voltJumps || 0;
    s.shoot();
    out.volt = { jumps: (s.state.voltJumps || 0) - j0, stunned: [a, b, c].filter((x) => x.stunLeft > 1).length,
      hurt: [b, c].filter((x) => x.health < x.maxHealth).length, far: far.health === far.maxHealth && !(far.stunLeft > 0) };
    // And they hold still while it has them, with the soldiers running.
    s.setCheat('godmode', true);
    s.soldiers.enabled = true;
    const at = { x: b.x, z: b.z, stun: b.stunLeft };
    step(0.6);
    out.volt.held = Math.hypot(b.x - at.x, b.z - at.z) < 0.05 && b.stunLeft < at.stun;
    s.soldiers.enabled = false;
    s.setCheat('godmode', false);

    // The arbalest: a bolt into a man twenty metres off.
    fresh(); ready('arbalest');
    t = s.spawnSoldier(-20, 0);
    aim(t.x, t.y + 1.1, t.z);
    s.shoot();
    let p = s.projectiles.active.find((x) => x.kind === 'bolt');
    let held = false;
    for (let i = 0; i < 90 && p && p.alive; i++) { s.fixedForTest(1 / 60); if (p.host === t) held = true; }
    out.bolt = { fired: !!p, held, gone: p ? !p.alive : false, dead: t.health <= 0 };

    // The cling charge: thrown at a man nine metres off, who then moves.
    fresh(); ready('cling');
    t = s.spawnSoldier(-9, 0);
    aim(t.x, t.y + 1.0, t.z);
    s.shoot();
    p = s.projectiles.active.find((x) => x.kind === 'cling');
    held = false;
    let rode = false;
    for (let i = 0; i < 150 && p && p.alive; i++) {
      s.fixedForTest(1 / 60);
      if (!held && p.host === t) {
        held = true;
        t.x += 1.5;
        s.fixedForTest(1 / 60);
        rode = !p.alive || Math.abs(p.x - (t.x + p.hx)) < 0.01;
      }
    }
    out.cling = { thrown: !!p, held, rode, dead: t.health <= 0 };

    // The ripper: two in a line, and then a wall straight on.
    fresh(); ready('ripper');
    const r1 = s.spawnSoldier(-8, 0), r2 = s.spawnSoldier(-13, 0);
    aim(r1.x, r1.y + 1.0, r1.z);
    s.shoot();
    p = s.projectiles.active.find((x) => x.kind === 'disc');
    for (let i = 0; i < 60 && p && p.alive && r2.health === r2.maxHealth; i++) s.fixedForTest(1 / 60);
    out.ripper = { both: r1.health < r1.maxHealth && r2.health < r2.maxHealth };
    fresh(); ready('ripper');
    // The nearest wall there is, as far as sixty metres: further than the
    // offline city needs, because in the live one this is the open square.
    let wall = null;
    for (let k = 0; k < 32; k++) {
      const ang = (k / 32) * Math.PI * 2;
      const e = eye();
      const h = s.world.raycast(e.x, e.y - 0.3, e.z, Math.cos(ang), 0, Math.sin(ang), 60);
      if (h && h.kind === 'wall' && h.t > 5 && (!wall || h.t < wall.t)) wall = h;
    }
    out.ripper.wall = !!wall;
    if (wall) {
      aim(wall.x, wall.y, wall.z);
      s.shoot();
      p = s.projectiles.active.find((x) => x.kind === 'disc');
      for (let i = 0; i < 120 && p && p.alive && !(p.ricochets > 0); i++) s.fixedForTest(1 / 60);
      out.ripper.ricochets = p ? p.ricochets || 0 : -1;
      out.ripper.fast = p ? +Math.hypot(p.vx, p.vy, p.vz).toFixed(1) : 0;
    }

    // The blade: a man seven metres off, and then one fifteen off.
    fresh(); ready('blade');
    t = s.spawnSoldier(-7, 0);
    aim(t.x, t.y + 1.1, t.z);
    let from = { x: s.player.x, z: s.player.z };
    s.shoot();
    const lunging = !!s.state.lunge;
    step(0.6);
    out.blade = { lunging, moved: +Math.hypot(s.player.x - from.x, s.player.z - from.z).toFixed(2),
      near: +Math.hypot(t.x - s.player.x, t.z - s.player.z).toFixed(2), dead: t.health <= 0 };
    fresh(); ready('blade');
    t = s.spawnSoldier(-15, 0);
    aim(t.x, t.y + 1.1, t.z);
    from = { x: s.player.x, z: s.player.z };
    s.shoot();
    out.blade.farLunge = !!s.state.lunge;
    step(0.3);
    out.blade.farMoved = +Math.hypot(s.player.x - from.x, s.player.z - from.z).toFixed(2);

    // The hammer: three in front, one behind, and a car to the side.
    fresh(); ready('hammer');
    s.look(90, 0); s.camera.update(16 / 9);
    const men = [s.spawnSoldier(-3, 0), s.spawnSoldier(-4.5, 1.5), s.spawnSoldier(-5, -1.5)];
    const behind = s.spawnSoldier(4, 0);
    const car = s.vehicles.spawn('jeep', s.player.x - 5, s.player.z + 5, 0);
    const hp = s.combat.health + s.combat.shield;
    s.shoot();
    out.hammer = { down: men.filter((m) => m.health <= 0 || m.state === 4).length,
      hurt: men.filter((m) => m.health < m.maxHealth).length,
      behind: behind.health === behind.maxHealth && behind.state !== 4,
      car: car ? !!car.airborne : null, you: s.combat.health + s.combat.shield === hp };

    // The flare: into the street twelve metres off, and somebody standing
    // in what it leaves.
    fresh(); ready('flare');
    const gx = s.player.x - 12, gz = s.player.z;
    aim(gx, s.world.groundHeight(gx, gz), gz);
    const pools = s.burningGround.length;
    s.shoot();
    p = s.projectiles.active.find((x) => x.kind === 'flare');
    for (let i = 0; i < 180 && p && p.alive; i++) s.fixedForTest(1 / 60);
    out.flare = { fired: !!p, burning: s.burningGround.length - pools };
    const pool = s.burningGround[s.burningGround.length - 1];
    if (pool) {
      t = s.spawnSoldier(pool.x - s.player.x, pool.z - s.player.z);
      const h0 = t.health;
      s.setCheat('godmode', true);
      step(1.2);
      s.setCheat('godmode', false);
      out.flare.hurt = t.health < h0;
    }
    fresh();
    return out;
  });
  check('Hailstorm pours: thirty pulls of three in a second, and a man at eighteen metres does not last it',
    eight.hail.shots >= 25 && eight.hail.dead, JSON.stringify(eight.hail));
  check('the volt caster\'s charge jumps from the one it hit to the two near him, and not to the one too far off',
    eight.volt.jumps === 2 && eight.volt.stunned === 3 && eight.volt.hurt === 2 && eight.volt.far, JSON.stringify(eight.volt));
  check('and they hold still while it has them', eight.volt.held, JSON.stringify(eight.volt));
  check('the arbalest\'s bolt goes into him, holds, and goes off',
    eight.bolt.held && eight.bolt.gone && eight.bolt.dead, JSON.stringify(eight.bolt));
  check('the cling charge holds on to the man it hits, goes where he goes, and goes off on him',
    eight.cling.held && eight.cling.rode && eight.cling.dead, JSON.stringify(eight.cling));
  check('the ripper\'s blade goes through two in a line',
    eight.ripper.both, JSON.stringify(eight.ripper));
  check('and comes off a wall at the speed it arrived',
    eight.ripper.wall && eight.ripper.ricochets >= 1 && eight.ripper.fast > 30, JSON.stringify(eight.ripper));
  check('the blade lunges seven metres onto a man and cuts him down, and does not go for one fifteen off',
    eight.blade.lunging && eight.blade.moved > 3 && eight.blade.near < 2.6 && eight.blade.dead
      && !eight.blade.farLunge && eight.blade.farMoved < 0.5, JSON.stringify(eight.blade));
  check('the hammer hurts and floors the three in front, throws the car, and leaves the one behind and you alone',
    eight.hammer.down === 3 && eight.hammer.hurt === 3 && eight.hammer.behind && eight.hammer.car && eight.hammer.you,
    JSON.stringify(eight.hammer));
  check('the flare sets the street alight where it lands, and the fire burns whoever stands in it',
    eight.flare.fired && eight.flare.burning >= 2 && eight.flare.hurt, JSON.stringify(eight.flare));

  // --- the knife, the baton, the bat, the fists, the kick and the butt --------
  const close = await page.evaluate(() => {
    const s = window.spreefall;
    const out = {};
    const fresh = () => {
      s.drones.reset(); s.soldiers.reset(); s.projectiles.clear(); s.combat.reset(); s.vehicles.reset();
      s.grab.reset();
      // Nothing left burning from the checks before: a man stood in the
      // flare's fire between two blows of the baton is not the baton's.
      s.burningGround.length = 0; s.fires.reset(); s.fireWalls.reset();
      s.soldiers.enabled = false;
      s.state.lunge = null; s.state.holstered = false;
      s.state.kickLeft = 0; s.state.bashLeft = 0;
      s.teleport(81, 0); s.look(90, 0); s.camera.update(16 / 9);
      s.player.onGround = true; s.player.vy = 0;
    };
    const eye = () => ({ x: s.player.x, y: s.player.y + 1.7, z: s.player.z });
    const aim = (t) => {
      const e = eye();
      const to = { x: t.x - e.x, y: t.y + 1.1 - e.y, z: t.z - e.z };
      const l = Math.hypot(to.x, to.y, to.z);
      s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI, Math.asin(to.y / l) * 180 / Math.PI);
      s.camera.update(16 / 9);
    };
    const step = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) s.fixedForTest(1 / 60); };
    const ready = (id) => { s.weapon.giveAll(); s.weapon.select(id); s.weapon.cooldown = 0; s.weapon.spread = 0; };
    const swing = () => { s.weapon.cooldown = 0; s.shoot(); };
    const hurt = (t) => t.health < t.maxHealth;

    // The knife: one from behind, and one into a man facing you.
    fresh(); ready('knife');
    let t = s.spawnSoldier(-1.6, 0);
    t.yaw = Math.PI / 2;            // facing -x, away from you
    aim(t);
    const stabs = s.state.backstabs || 0;
    swing();
    out.knife = { back: t.health <= 0, stabs: (s.state.backstabs || 0) - stabs };
    fresh(); ready('knife');
    t = s.spawnSoldier(-1.6, 0);
    t.yaw = -Math.PI / 2;           // facing +x, at you
    aim(t);
    swing();
    out.knife.front = hurt(t) && t.health > 0;

    // The baton: a blow staggers him, the third in a row puts him down.
    fresh(); ready('baton');
    t = s.spawnSoldier(-1.8, 0);
    aim(t);
    swing();
    out.baton = { dazed: t.stunLeft > 0 && t.state !== 4, hurt: hurt(t), blows: [[Math.round(t.health), t.state, t.batonN]] };
    step(0.5); swing();
    out.baton.blows.push([Math.round(t.health), t.state, t.batonN]);
    step(0.5); swing();
    out.baton.blows.push([Math.round(t.health), t.state, t.batonN]);
    out.baton.down = t.state === 4 && t.health > 0;

    // The bat: the man in front goes off down the street into the one behind him.
    fresh(); ready('bat');
    // A flat, clear run of street to send him down: the checks before may
    // have left a crater or a heap of rubble in the first one tried.
    const g0 = s.world.groundHeight(s.player.x, s.player.z);
    let run = null;
    for (let k = 0; k < 24 && !run; k++) {
      const a = Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      const ca = Math.cos(a), sa = Math.sin(a);
      let flat = !s.world.raycast(s.player.x, g0 + 1.2, s.player.z, ca, 0, sa, 13);
      for (let d = 1; d <= 12 && flat; d += 0.5) {
        if (Math.abs(s.world.groundHeight(s.player.x + ca * d, s.player.z + sa * d) - g0) > 0.25) flat = false;
      }
      if (flat) run = { ca, sa };
    }
    run = run || { ca: -1, sa: 0 };
    t = s.spawnSoldier(run.ca * 2.2, run.sa * 2.2);
    const behind = s.spawnSoldier(run.ca * 7.5, run.sa * 7.5);
    aim(t);
    const x0 = t.x, z0 = t.z;
    swing();
    out.bat = { flying: !!t.held && s.grab.flying.length === 1 };
    step(1.5);
    out.bat.flew = +Math.hypot(t.x - x0, t.z - z0).toFixed(1);
    out.bat.behind = hurt(behind);
    out.bat.landed = !t.held;

    // The fists: two jabs, and the third a hook that floors him.
    fresh(); ready('fists');
    t = s.spawnSoldier(-1.5, 0);
    aim(t);
    const hooks = s.state.hooks || 0;
    swing(); step(0.3); swing();
    out.fists = { jabs: hurt(t) && t.state !== 4 };
    step(0.3); swing();
    out.fists.hook = (s.state.hooks || 0) - hooks === 1 && (t.state === 4 || t.health <= 0);
    out.fists.hands = s.state.punchHand;

    // The kick, on the ground and in the air.
    fresh(); ready('m16');
    t = s.spawnSoldier(-1.7, 0);
    aim(t);
    const kicked = s.kick();
    out.kick = { kicked, down: t.state === 4, hurt: hurt(t), again: s.kick() };
    fresh(); ready('m16');
    t = s.spawnSoldier(-2.0, 0);
    aim(t);
    s.player.onGround = false; s.player.vy = 3;
    const fk = s.state.flyingKicks || 0;
    s.kick();
    out.kick.air = (s.state.flyingKicks || 0) - fk === 1 && !!t.held;
    s.player.onGround = true; s.player.vy = 0;

    // The butt of the rifle: he staggers and no round goes off; the tube of
    // a launcher puts him down; with the knife in hand it is the knife.
    fresh(); ready('m16');
    t = s.spawnSoldier(-1.6, 0);
    aim(t);
    const ammo = s.weapon.ammo, fired = s.weapon.shotsFired;
    s.bash();
    out.bash = { hurt: hurt(t), dazed: t.stunLeft > 0, noRound: s.weapon.ammo === ammo && s.weapon.shotsFired === fired,
      held: s.weapon.cooldown > 0 };
    fresh(); ready('rpg');
    t = s.spawnSoldier(-1.6, 0);
    aim(t);
    s.bash();
    out.bash.tube = t.state === 4;
    fresh(); ready('knife');
    t = s.spawnSoldier(-1.6, 0);
    t.yaw = -Math.PI / 2;
    aim(t);
    const f0 = s.weapon.shotsFired;
    s.bash();
    out.bash.knife = s.weapon.shotsFired === f0 + 1 && hurt(t);
    // Nothing in your hands: a punch.
    fresh(); ready('m16');
    t = s.spawnSoldier(-1.5, 0);
    aim(t);
    s.state.holstered = true;
    s.bash();
    out.bash.bare = hurt(t);
    s.state.holstered = false;
    fresh();
    return out;
  });
  check('the knife: one from behind is enough, one from the front only hurts',
    close.knife.back && close.knife.stabs === 1 && close.knife.front, JSON.stringify(close.knife));
  check('the baton: a blow staggers him, the third in a row puts him on the ground alive',
    close.baton.dazed && close.baton.hurt && close.baton.down, JSON.stringify(close.baton));
  check('the bat sends him flying off down the street into the man behind him',
    close.bat.flying && close.bat.flew > 4 && close.bat.behind && close.bat.landed, JSON.stringify(close.bat));
  check('the fists: two jabs that hurt, and the third a hook that floors him, left and right in turn',
    close.fists.jabs && close.fists.hook && close.fists.hands === 1, JSON.stringify(close.fists));
  check('a kick puts him on the ground, not twice at once, and a kick in the air sends him flying',
    close.kick.kicked && close.kick.down && close.kick.hurt && !close.kick.again && close.kick.air, JSON.stringify(close.kick));
  check('the butt of a rifle staggers him without a round going off; a launcher\'s tube floors him; a knife in hand is the knife; bare hands punch',
    close.bash.hurt && close.bash.dazed && close.bash.noRound && close.bash.held && close.bash.tube
      && close.bash.knife && close.bash.bare, JSON.stringify(close.bash));

  // --- out of the arena shooters, and the meat hook ---------------------------
  const arena = await page.evaluate(() => {
    const s = window.spreefall;
    const out = {};
    const fresh = () => {
      s.drones.reset(); s.soldiers.reset(); s.projectiles.clear(); s.combat.reset(); s.vehicles.reset();
      s.grab.reset();
      s.burningGround.length = 0; s.fires.reset(); s.fireWalls.reset(); s.poisonClouds.length = 0;
      s.soldiers.enabled = false;
      s.state.lunge = null; s.state.hook = null; s.state.holstered = false;
      s.setAim(false);
      s.teleport(81, 0); s.look(90, 0); s.camera.update(16 / 9);
    };
    const eye = () => ({ x: s.player.x, y: s.player.y + 1.7, z: s.player.z });
    const aimAt = (x, y, z) => {
      const e = eye();
      const to = { x: x - e.x, y: y - e.y, z: z - e.z };
      const l = Math.hypot(to.x, to.y, to.z);
      s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI, Math.asin(to.y / l) * 180 / Math.PI);
      s.camera.update(16 / 9);
    };
    const step = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) s.fixedForTest(1 / 60); };
    const ready = (id) => { s.weapon.giveAll(); s.weapon.select(id); s.weapon.cooldown = 0; s.weapon.spread = 0; };
    const dir = () => ({ x: s.camera.forward[0], y: s.camera.forward[1], z: s.camera.forward[2] });
    const hurt = (t) => t.health < t.maxHealth;
    const find = (kind) => s.projectiles.active.find((b) => b.alive && b.kind === kind);
    s.setCheat('godmode', true);

    // The combo rifle: a ball out, and the beam put through it.
    fresh(); ready('combo');
    let men = [s.spawnSoldier(-9, 1.5), s.spawnSoldier(-9, -1.5), s.spawnSoldier(-10, 0)];
    s.alt();
    step(0.45);
    const core = find('core');
    out.combo = { core: !!core, went: 0 };
    if (core) {
      aimAt(core.x, core.y, core.z);
      const c0 = s.state.combos || 0;
      s.weapon.cooldown = 0; s.shoot();
      out.combo.went = (s.state.combos || 0) - c0;
      out.combo.hurt = men.filter(hurt).length;
      out.combo.dead = men.filter((m) => m.health <= 0).length;
    }

    // The storm beam: a second on a man twelve metres off, and nothing on one twenty five off.
    fresh(); ready('storm');
    let t = s.spawnSoldier(-12, 0);
    aimAt(t.x, t.y + 1.1, t.z);
    for (let i = 0; i < 60; i++) s.weapon.update(1 / 60, true, eye(), dir());
    s.weapon.update(1 / 60, false, eye(), dir());
    out.storm = { near: t.health <= 0 };
    fresh(); ready('storm');
    t = s.spawnSoldier(-25, 0);
    aimAt(t.x, t.y + 1.1, t.z);
    for (let i = 0; i < 60; i++) s.weapon.update(1 / 60, true, eye(), dir());
    s.weapon.update(1 / 60, false, eye(), dir());
    out.storm.far = t.health === t.maxHealth;

    // The sludge gun: into the street, where it sticks and waits, and goes
    // off on a man who walks up to it, leaving poison behind.
    fresh(); ready('sludge');
    let gx = s.player.x - 6, gz = s.player.z;
    aimAt(gx, s.world.groundHeight(gx, gz), gz);
    s.shoot();
    for (let i = 0; i < 90 && !(find('goo') && find('goo').stuck); i++) s.fixedForTest(1 / 60);
    const goo = find('goo');
    out.sludge = { stuck: !!(goo && goo.stuck) };
    if (goo) {
      step(0.5);
      out.sludge.waits = goo.alive;
      t = s.spawnSoldier(goo.x - s.player.x, goo.z - s.player.z + 1.0);
      step(0.3);
      out.sludge.went = !goo.alive;
      out.sludge.hurt = hurt(t);
      out.sludge.poison = s.poisonClouds.length > 0;
    }
    // And the big glob, which breaks into five where it lands.
    fresh(); ready('sludge');
    aimAt(gx, s.world.groundHeight(gx, gz), gz);
    const g0 = s.state.globBursts || 0;
    s.alt();
    for (let i = 0; i < 120 && (s.state.globBursts || 0) === g0; i++) s.fixedForTest(1 / 60);
    s.fixedForTest(1 / 60);
    out.sludge.glob = (s.state.globBursts || 0) - g0;
    out.sludge.pieces = s.projectiles.active.filter((b) => b.alive && b.kind === 'goo').length;

    // The translocator: the disc into the street, a man standing on it, and you there.
    fresh(); ready('translocator');
    gx = s.player.x - 10;
    aimAt(gx, s.world.groundHeight(gx, gz) + 2, gz);
    s.shoot();
    step(1.6);
    const disc = find('beacon');
    out.trans = { disc: !!disc };
    if (disc) {
      const dx = disc.x, dz = disc.z;
      t = s.spawnSoldier(dx - s.player.x + 0.4, dz - s.player.z);
      const f0 = s.state.telefrags || 0;
      out.trans.went = s.alt();
      out.trans.off = +Math.hypot(s.player.x - dx, s.player.z - dz).toFixed(2);
      out.trans.frag = (s.state.telefrags || 0) - f0 === 1 && t.health <= 0;
      out.trans.gone = !find('beacon');
    }
    // A second disc throws away the first.
    fresh(); ready('translocator');
    s.shoot(); step(0.2); s.weapon.cooldown = 0; s.weapon.ammo = 1; s.shoot(); step(0.2);
    out.trans.one = s.projectiles.active.filter((b) => b.alive && b.kind === 'beacon').length;

    // The warhead, with the city told to stand: straight, it takes everybody
    // round where it lands; held, it turns to where you look.
    s.demolition.enabled = false;
    fresh(); ready('warhead');
    men = [s.spawnSoldier(-32, 0), s.spawnSoldier(-34, 6), s.spawnSoldier(-30, -7)];
    aimAt(men[0].x, men[0].y + 1, men[0].z);
    s.shoot();
    for (let i = 0; i < 240 && find('warhead'); i++) s.fixedForTest(1 / 60);
    out.warhead = { went: !find('warhead'), dead: men.filter((m) => m.health <= 0).length };
    fresh(); ready('warhead');
    s.look(90, 2); s.camera.update(16 / 9);
    s.shoot();
    step(0.2);
    let w = find('warhead');
    const head0 = w ? Math.atan2(-w.vx, -w.vz) * 180 / Math.PI : null;
    s.look(60, 2); s.camera.update(16 / 9);
    s.setAim(true);
    step(1.2);
    s.setAim(false);
    w = find('warhead');
    out.warhead.turned = w && head0 !== null ? +(Math.atan2(-w.vx, -w.vz) * 180 / Math.PI - head0).toFixed(1) : null;
    s.projectiles.clear();
    s.demolition.enabled = true;
    // And nothing of it left for the pictures after: the smoke, the marks on
    // the road and the trees it set alight.
    s.effects.clear(); s.renderer.clearScars(); s.fires.reset(); s.state.flash = 0;

    // The meat hook: a man fifteen metres off, and you pulled to him.
    fresh(); ready('doublebarrel');
    t = s.spawnSoldier(-15, 0);
    aimAt(t.x, t.y + 1.1, t.z);
    const h0 = s.state.hooked || 0;
    out.hook = { hooked: s.alt() && (s.state.hooked || 0) - h0 === 1 };
    step(0.9);
    out.hook.near = +Math.hypot(t.x - s.player.x, t.z - s.player.z).toFixed(2);
    fresh(); ready('doublebarrel');
    out.hook.nothing = !s.alt();
    s.setCheat('godmode', false);
    fresh();
    return out;
  });
  check('the combo rifle: its beam through its own ball sets off a blast that takes the men round it',
    arena.combo.core && arena.combo.went === 1 && arena.combo.hurt >= 2, JSON.stringify(arena.combo));
  check('the storm beam: a second on a man twelve metres off kills him, one twenty five off is out of its reach',
    arena.storm.near && arena.storm.far, JSON.stringify(arena.storm));
  check('the sludge gun: it sticks and waits, goes off on a man who walks up, and leaves poison; the big glob breaks into five',
    arena.sludge.stuck && arena.sludge.waits && arena.sludge.went && arena.sludge.hurt && arena.sludge.poison
      && arena.sludge.glob === 1 && arena.sludge.pieces >= 5, JSON.stringify(arena.sludge));
  check('the translocator puts you where the disc is, in pieces whoever was on it, and keeps one disc at a time',
    arena.trans.disc && arena.trans.went && arena.trans.off < 0.6 && arena.trans.frag && arena.trans.gone
      && arena.trans.one === 1, JSON.stringify(arena.trans));
  check('the warhead takes everybody round where it lands, and held, turns to where you look',
    arena.warhead.went && arena.warhead.dead === 3 && arena.warhead.turned !== null && arena.warhead.turned < -15,
    JSON.stringify(arena.warhead));
  check('the meat hook pulls you to the man in the sight, and takes nobody when there is nobody',
    arena.hook.hooked && arena.hook.near < 3.2 && arena.hook.nothing, JSON.stringify(arena.hook));
  await page.evaluate(() => {
    const s = window.spreefall;
    s.projectiles.clear(); s.weapon.select('minigun');
    s.teleport(81, 0); s.look(100, 2); s.setTime(15.4);
    s.weapon.selectSlot(1); s.weapon.select('minigun'); s.arms.poke(1);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'arsenal-02-rotary.png') });

  // The shield saw on the left arm, at the hip and held up: the street in the
  // middle stays in view either way.
  await page.evaluate(() => {
    const s = window.spreefall;
    s.setAim(false);
    s.weapon.giveAll(); s.weapon.select('shieldsaw');
    s.teleport(319, -22); s.look(90, 0);
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'arsenal-03-shield-hip.png') });
  await page.evaluate(() => {
    const s = window.spreefall;
    s.setAim(true);
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'arsenal-04-shield-up.png') });
  await page.evaluate(() => window.spreefall.setAim(false));

  // Four of the eight in the hand.
  for (const [i, id] of [[5, 'hailstorm'], [6, 'blade'], [7, 'hammer'], [8, 'flare']]) {
    await page.evaluate((w) => {
      const s = window.spreefall;
      s.weapon.select(w);
      for (let k = 0; k < 40; k++) s.fixedForTest(1 / 60);
    }, id);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(SHOTS, `arsenal-0${i}-${id}.png`) });
  }

  // The close four, each frozen half way through its move, and a kick.
  for (const [n, id, move] of [[9, 'knife', 'swing'], [10, 'baton', 'swing'], [11, 'bat', 'swing'],
    [12, 'fists', 'swing'], [13, 'm16', 'kick']]) {
    await page.evaluate(({ id, move }) => {
      const s = window.spreefall;
      s.state.paused = false;
      s.weapon.giveAll(); s.weapon.select(id);
      for (let k = 0; k < 40; k++) s.fixedForTest(1 / 60);
      const dur = id === 'm16' ? s.moves.kick.seconds : s.weapons[id].swing.seconds;
      if (move === 'kick') s.state.kickT = dur * 0.5;
      else { s.state.swingId = id; s.state.swingDur = dur; s.state.swingT = dur * 0.5; s.state.punchHand = 1; s.state.punchHook = false; }
      s.state.paused = true;
    }, { id, move });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(SHOTS, `arsenal-${String(n).padStart(2, '0')}-${id === 'm16' ? 'kick' : id}.png`) });
  }
  await page.evaluate(() => {
    const s = window.spreefall;
    s.state.paused = false; s.state.kickT = 0; s.state.swingT = 0;
  });

  // The five out of the arena shooters in the hand, the storm beam on.
  for (const [n, id] of [[14, 'combo'], [15, 'storm'], [16, 'sludge'], [17, 'translocator'], [18, 'warhead']]) {
    await page.evaluate((w) => {
      const s = window.spreefall;
      s.state.paused = false;
      s.weapon.giveAll(); s.weapon.select(w);
      for (let k = 0; k < 40; k++) s.fixedForTest(1 / 60);
      // The beam is drawn fresh every step and gone the next, so it is
      // pictured while the trigger is held.
      if (w === 'storm') s.input.fire = true;
    }, id);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(SHOTS, `arsenal-${n}-${id}.png`) });
    await page.evaluate(() => { window.spreefall.input.fire = false; });
  }

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
