// Drives the cheat menu in a real browser. Every one of these is a claim the
// menu makes about what a switch does, checked by doing it: god mode is tested
// by being shot, infinite ammunition by firing two hundred rounds, the nuke by
// dropping one on somebody, and the memorial by trying to drop one on it and
// being told no.
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
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
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
    // The spawners stay off throughout: every target in this file is one this
    // file put there, so a check never races a patrol wandering into frame.
    s.drones.enabled = false;
    s.soldiers.enabled = false;
    s.jets.enabled = false;
    s.cheats.reset();
    s.teleport(81, 0); s.look(90, -2); s.setTime(15.4);
    s.setQuality('low');
  });
  await page.waitForTimeout(4000);

  // --- the menu itself -----------------------------------------------------
  const menu = await page.evaluate(() => {
    const s = window.spreefall;
    s.cheatMenu(true);
    const panel = document.getElementById('cheats');
    const open = !panel.classList.contains('hidden');
    const switches = [...panel.querySelectorAll('.sw')].map((b) => b.dataset.cheat);
    // Only the one shot buttons: the spawn row shares the class.
    const actions = [...panel.querySelectorAll('.act[data-action]')].map((b) => b.dataset.action);
    s.cheatMenu(false);
    return { open, closed: panel.classList.contains('hidden'), switches, actions };
  });
  check('the menu opens and closes', menu.open && menu.closed);
  check('every switch the brief asked for is in it',
    ['godmode', 'infiniteAmmo', 'nukeRain', 'noDrones', 'cinematic', 'slowBlast',
      'gib', 'ragdoll', 'blood', 'ultraGore']
      .every((id) => menu.switches.includes(id)),
    menu.switches.join(', '));
  check('and every button',
    ['allWeapons', 'refill', 'nuke', 'ion'].every((id) => menu.actions.includes(id)),
    menu.actions.join(', '));

  // Clicking a row really is what flips the flag, rather than the test poking
  // the object the row is supposed to be driving.
  const clicked = await page.evaluate(() => {
    const s = window.spreefall;
    s.cheatMenu(true);
    const row = document.querySelector('#cheats .sw[data-cheat="godmode"]');
    row.click();
    const on = s.cheats.godmode && s.combat.godmode && row.classList.contains('on');
    row.click();
    const off = !s.cheats.godmode && !s.combat.godmode && !row.classList.contains('on');
    s.cheatMenu(false);
    return { on, off, marked: s.cheats.used };
  });
  check('clicking a row switches the cheat under it', clicked.on && clicked.off);
  check('and the run stays marked after it is switched off again', clicked.marked);

  const marked = await page.evaluate(() =>
    !document.getElementById('cheatmark').classList.contains('hidden'));
  check('which the interface says', marked);

  // --- god mode ------------------------------------------------------------
  const god = await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset(); s.combat.reset();
    s.combat.hurt(70, 10, 10, 0, 0);
    const mortal = { shield: Math.round(s.combat.shield), health: Math.round(s.combat.health) };
    s.combat.reset();
    s.setCheat('godmode', true);
    for (let i = 0; i < 40; i++) s.combat.hurt(500, 10, 10, 0, 0);
    const divine = { shield: Math.round(s.combat.shield), health: Math.round(s.combat.health) };
    // The warning still works: you are told where it came from.
    const warned = s.combat.damageDir.x !== 0 || s.combat.damageDir.z !== 0;
    s.setCheat('godmode', false);
    return { mortal, divine, warned };
  });
  check('without god mode a hit lands', god.mortal.shield < 120, `shield ${god.mortal.shield}`);
  check('with it on, twenty thousand damage does nothing',
    god.divine.shield === 120 && god.divine.health === 100);
  check('and you are still told which way it came from', god.warned);

  // --- infinite ammunition and the two loading buttons ---------------------
  const ammo = await page.evaluate(() => {
    const s = window.spreefall;
    s.weapon.reset(); s.weapon.select('m16');
    s.setCheat('infiniteAmmo', true);
    for (let i = 0; i < 200; i++) { s.weapon.cooldown = 0; s.shoot(); }
    const left = s.weapon.ammo;
    const fired = s.weapon.shotsFired;
    s.setCheat('infiniteAmmo', false);
    return { left, fired, magazine: s.weapon.spec.magazine };
  });
  check('infinite ammunition fires two hundred rounds out of a thirty round magazine',
    ammo.left === ammo.magazine && ammo.fired === 200, `${ammo.fired} fired, ${ammo.left} left`);

  const all = await page.evaluate(() => {
    const s = window.spreefall;
    s.weapon.reset();
    for (const id of s.loadout) { s.weapon.carried[id].ammo = 0; s.weapon.carried[id].reserve = 0; }
    s.cheatAction('allWeapons');
    const short = s.loadout.filter((id) =>
      s.weapon.carried[id].ammo < s.weapons[id].magazine
      || s.weapon.carried[id].reserve < s.weapons[id].reserve);
    return { short, n: s.loadout.length };
  });
  check('all weapons fills every magazine and every reserve in the loadout',
    all.short.length === 0, `${all.n} weapons, ${all.short.length} left short`);

  const refill = await page.evaluate(() => {
    const s = window.spreefall;
    s.weapon.select('m16');
    s.weapon.carried.m16.ammo = 1; s.weapon.carried.m16.reserve = 3;
    s.cheatAction('refill');
    return { ...s.weapon.carried.m16 };
  });
  check('and reload everything tops up what you are holding',
    refill.ammo === 30 && refill.reserve > 3, `${refill.ammo} + ${refill.reserve}`);

  // --- the gore switches ---------------------------------------------------
  // Each of these is checked twice: once with the switch off, to show the game
  // without it is the game it always was, and once with it on.
  const gib = await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset(); s.soldiers.reset(); s.gibs.clear(); s.combat.reset();
    const plain = s.spawnSoldier(-14, 2);
    s.soldiers.damage(plain, 9999, { x: 1, y: 0, z: 0 });
    const off = { bodies: s.soldiers.active.length, chunks: s.gibs.count, state: plain.state };

    s.soldiers.reset(); s.gibs.clear();
    s.setCheat('gib', true);
    const torn = s.spawnSoldier(-14, 2);
    s.soldiers.damage(torn, 9999, { x: 1, y: 0, z: 0 });
    const on = { bodies: s.soldiers.active.length, chunks: s.gibs.count };

    // And the kill still counts once, not twice and not never.
    const kills = s.combat.kills;
    s.cheats.reset(); s.soldiers.reset(); s.gibs.clear();
    return { off, on, kills };
  });
  check('with the switch off a killed soldier lies down and leaves no pieces',
    gib.off.bodies === 1 && gib.off.chunks === 0 && gib.off.state === 5);
  check('with it on there is no body and there are pieces',
    gib.on.bodies === 0 && gib.on.chunks > 6, `${gib.on.chunks} chunks`);

  const credited = await page.evaluate(() => {
    const s = window.spreefall;
    s.combat.reset(); s.soldiers.reset(); s.gibs.clear();
    s.setCheat('gib', true);
    const victim = s.spawnSoldier(-14, 2);
    s.look(90, 0);
    // Through the real kill path, so the credit comes from where it always
    // comes from rather than from the gib handler.
    const before = s.combat.kills;
    s.weapon.select('railgun'); s.weapon.cooldown = 0; s.weapon.spread = 0;
    const ex = s.player.x, ey = s.player.y + 1.7, ez = s.player.z;
    const vx = victim.x - ex, vy = victim.y + 1.1 - ey, vz = victim.z - ez;
    const l = Math.hypot(vx, vy, vz);
    s.look(Math.atan2(-vx, -vz) * 180 / Math.PI, Math.asin(vy / l) * 180 / Math.PI);
    s.camera.update(16 / 9);
    for (let i = 0; i < 4 && victim.alive; i++) { s.weapon.cooldown = 0; s.weapon.spread = 0; s.shoot(); }
    const after = s.combat.kills;
    s.cheats.reset(); s.soldiers.reset(); s.gibs.clear(); s.weapon.reset();
    return { gained: after - before, chunks: s.gibs.count, gone: !victim.alive };
  });
  check('a soldier shot to pieces is credited exactly once',
    credited.gained === 1 && credited.gone, `${credited.gained} kill`);

  const doll = await page.evaluate(() => {
    const s = window.spreefall;
    // A body only falls while the soldiers are being updated, and the rest of
    // this file keeps them switched off so nothing wanders into a check. Here
    // they are switched back on with the budget at zero, which runs everyone
    // already on the field and spawns nobody new.
    const budget = s.soldiers.budget;
    const fall = (ragdoll) => {
      s.cheats.reset(); s.soldiers.reset();
      if (ragdoll) s.setCheat('ragdoll', true);
      s.soldiers.enabled = true;
      s.soldiers.budget = 0;
      const v = s.spawnSoldier(-18, 0);
      v.yaw = 0;
      s.soldiers.damage(v, 9999, { x: 1, y: 0, z: 0.35 });
      const x0 = v.x, z0 = v.z;
      const me = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z, alive: true };
      // The turn is measured at its widest rather than where it stops: a body
      // settles onto its back or its face, and both of those read as a roll
      // of zero or of half a turn once it is down.
      let peakRoll = 0;
      let air = 0;
      for (let i = 0; i < 240; i++) {
        s.soldiers.update(1 / 60, me, i / 60);
        peakRoll = Math.max(peakRoll, Math.abs(v.roll));
        air = Math.max(air, v.y - s.world.groundHeight(v.x, v.z));
      }
      s.soldiers.enabled = false;
      s.soldiers.budget = budget;
      return {
        alive: v.alive,
        lean: Number(Math.abs(v.lean).toFixed(2)),
        roll: Number(peakRoll.toFixed(2)),
        air: Number(air.toFixed(2)),
        thrown: Number(Math.hypot(v.x - x0, v.z - z0).toFixed(2)),
      };
    };
    const off = fall(false);
    const on = fall(true);
    s.cheats.reset(); s.soldiers.reset();
    return { off, on };
  });
  check('without ragdoll a body falls straight down and barely moves',
    doll.off.lean > 1.4 && doll.off.roll === 0 && doll.off.thrown < 0.6,
    `lean ${doll.off.lean}, roll ${doll.off.roll}, ${doll.off.thrown} m`);
  check('with it on the shot throws them, lifts them and turns them',
    doll.on.thrown > 1.2 && doll.on.roll > 0.4 && doll.on.air > 0.05 && doll.on.lean > 1.0,
    `turned ${doll.on.roll} rad, ${doll.on.air} m off the ground, ${doll.on.thrown} m back`);

  const blood = await page.evaluate(() => {
    const s = window.spreefall;
    // Kind three is blood. Counting by kind rather than by colour, because
    // the colour is tuned by eye and a test that breaks every time somebody
    // darkens it is a test nobody keeps.
    const red = () => s.effects.list.filter((p) => p.alive && p.kind === 3).length;
    const hit = () => {
      s.effects.clear(); s.soldiers.reset(); s.combat.reset();
      const v = s.spawnSoldier(-20, 1);
      v.health = 9999;
      const ex = s.player.x, ey = s.player.y + 1.7, ez = s.player.z;
      const vx = v.x - ex, vy = v.y + 1.1 - ey, vz = v.z - ez;
      const l = Math.hypot(vx, vy, vz);
      s.look(Math.atan2(-vx, -vz) * 180 / Math.PI, Math.asin(vy / l) * 180 / Math.PI);
      s.camera.update(16 / 9);
      s.weapon.select('m16'); s.weapon.cooldown = 0; s.weapon.spread = 0;
      s.shoot();
      return red();
    };
    s.cheats.reset();
    const off = hit();
    s.setCheat('blood', true);
    const on = hit();
    s.setCheat('ultraGore', true);
    const ultra = hit();
    s.cheats.reset(); s.soldiers.reset(); s.effects.clear();
    return { off, on, ultra };
  });
  check('a hit throws no blood with the switch off', blood.off === 0);
  check('and does with it on', blood.on > 14, `${blood.on} drops`);
  check('and ultra gore throws considerably more of it', blood.ultra > blood.on * 1.8,
    `${blood.on} to ${blood.ultra}`);

  // Blood is drawn over the frame rather than added to it, which is the whole
  // reason it reads as blood and not as embers, and it leaves the street
  // marked afterwards.
  const stains = await page.evaluate(async () => {
    const s = window.spreefall;
    s.cheats.pads = null;
    s.cheats.reset(); s.soldiers.reset(); s.gibs.clear(); s.effects.clear();
    s.setCheat('gib', true); s.setCheat('blood', true); s.setCheat('ultraGore', true);
    for (const [dx, dz] of [[-9, -1], [-12, 4], [-15, -5]]) {
      const v = s.spawnSoldier(dx, dz);
      s.soldiers.damage(v, 9999, { x: -1, y: 0, z: 0.2 });
    }
    for (let i = 0; i < 180; i++) { s.gibs.update(1 / 60); s.effects.update(1 / 60); }
    const live = s.effects.list.filter((p) => p.alive);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const pools = live.filter((p) => p.kind === 4);
    // A pool lies flat at the surface clearance rather than at the wound.
    const flat = pools.every((p) => Math.abs(p.ay - (s.world.groundHeight(p.ax, p.az) + 0.14)) < 0.01);
    // Something additive as well, so the two passes can be told apart: at
    // this moment there is nothing but blood in the air otherwise.
    s.effects.blast(s.player.x - 12, s.player.y + 1, s.player.z, 6);
    s.renderer.actors.updateSparks(s.effects.list);
    const out = {
      chunks: s.gibs.count,
      pools: pools.length,
      flat,
      additive: s.renderer.actors.sparks.count,
      alpha: s.renderer.actors.blood.count,
    };
    s.cheats.reset(); s.soldiers.reset(); s.gibs.clear(); s.effects.clear();
    return out;
  });
  check('ultra gore takes three of them to forty odd pieces', stains.chunks > 40,
    `${stains.chunks} chunks`);
  check('and leaves the street marked', stains.pools > 5 && stains.flat,
    `${stains.pools} stains, all lying flat on the surface`);
  check('with the blood on its own alpha blended pass',
    stains.alpha > 0 && stains.additive > 0,
    `${stains.additive} additive, ${stains.alpha} alpha`);

  // --- more of them, on demand ---------------------------------------------
  const waves = await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset(); s.drones.reset(); s.jets.reset();
    const made = {
      soldiers: s.spawnWave('soldiers', 6),
      drones: s.spawnWave('drones', 4),
      jets: s.spawnWave('jets', 2),
    };
    const live = {
      soldiers: s.soldiers.active.length,
      drones: s.drones.active.length,
      jets: s.jets.active.length,
    };
    const inZone = [...s.soldiers.active, ...s.drones.active]
      .filter((a) => s.combat.isSanctuary(a.x, 0, a.z)).length;
    s.soldiers.reset(); s.drones.reset(); s.jets.reset();
    return { made, live, inZone };
  });
  check('the menu brings a section, a flight and a pair out',
    waves.made.soldiers === 6 && waves.made.drones === 4 && waves.made.jets === 2,
    `${waves.live.soldiers} soldiers, ${waves.live.drones} drones, ${waves.live.jets} jets`);
  check('and none of them in the weapons free zone', waves.inZone === 0);

  // --- switching the drones off --------------------------------------------
  const noDrones = await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.drones.enabled = true; s.drones.reset();
    s.spawnWave('drones', 4);
    const up = s.drones.active.length;
    s.setCheat('noDrones', true);
    const after = { live: s.drones.active.length, enabled: s.drones.enabled };
    s.setCheat('noDrones', false);
    const back = s.drones.enabled;
    s.drones.enabled = false; s.drones.reset();
    return { up, after, back };
  });
  check('switching the drones off clears the sky', noDrones.up === 4
    && noDrones.after.live === 0 && noDrones.after.enabled === false,
    `${noDrones.up} up, ${noDrones.after.live} left`);
  check('and switching it back lets them come again', noDrones.back === true);

  // --- the camera that follows a warhead down -------------------------------
  const cine = await page.evaluate(async () => {
    const s = window.spreefall;
    s.cheats.reset(); s.projectiles.clear();
    s.teleport(900, 0);
    s.setCheat('godmode', true);
    // Without the switch, dropping one leaves you on the ground.
    s.dropNuke(s.player.x + 300, s.player.z);
    const plain = s.state.mode;
    s.projectiles.clear();
    s.setCheat('cinematic', true);
    const was = { x: s.player.x, z: s.player.z };
    s.dropNuke(s.player.x + 300, s.player.z);
    const started = s.state.mode;
    // The player does not move, and the simulation keeps running.
    const phases = new Set();
    let slowest = 1;
    let highest = 0;
    for (let i = 0; i < 900; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (s.state.mode !== 'cinema') break;
      if (s.state.dronePose) phases.add(s.state.dronePose.phase);
      slowest = Math.min(slowest, s.state.timeScale);
      highest = Math.max(highest, s.camera.position[1]);
      if (phases.has('orbit') && i > 40) break;
    }
    const moved = Math.round(Math.hypot(s.player.x - was.x, s.player.z - was.z));
    s.endCinema();
    const ended = s.state.mode;
    s.cheats.reset(); s.projectiles.clear();
    return { plain, started, phases: [...phases].join(' '), slowest: Number(slowest.toFixed(2)),
      highest: Math.round(highest), moved, ended };
  });
  check('without the switch a warhead leaves you where you are', cine.plain === 'walk');
  check('with it on the camera takes over', cine.started === 'cinema');
  check('it pulls off the street, follows it down and circles the hole',
    /pull/.test(cine.phases) && /chase/.test(cine.phases) && /orbit/.test(cine.phases),
    cine.phases);
  check('the world runs slowly while it does', cine.slowest < 0.4,
    `down to ${cine.slowest} of real time`);
  check('and you are still standing where you were', cine.moved === 0);
  check('and space gives you back the controls', cine.ended === 'walk');

  // --- warheads ------------------------------------------------------------
  const refused = await page.evaluate(() => {
    const s = window.spreefall;
    const mem = s.combat.sanctuaries[0];
    if (!mem) return { skip: true };
    return {
      onIt: s.dropNuke(mem.x, mem.z) === false,
      // And the edge of the exclusion: just inside is refused, well outside is
      // allowed, which is the radius of the blast plus the radius of the zone.
      justInside: s.dropNuke(mem.x + mem.radius + s.nukeSpec.radius - 20, mem.z) === false,
      wellOutside: s.dropNuke(mem.x + mem.radius + s.nukeSpec.radius + 120, mem.z) === true,
      name: mem.name,
    };
  });
  check('a warhead cannot be put on the memorial', refused.onIt, refused.name);
  check('nor near enough for the blast to reach it', refused.justInside,
    `zone ${135} m plus blast ${170} m`);
  check('but it can go anywhere else', refused.wellOutside);

  const nuke = await page.evaluate(() => {
    const s = window.spreefall;
    s.projectiles.clear(); s.soldiers.reset(); s.combat.reset(); s.effects.clear();
    s.setCheat('godmode', true);
    // Out along Unter den Linden, well clear of the memorial.
    s.teleport(900, 0);
    const near = s.spawnSoldier(-50, 8);
    const far = s.spawnSoldier(-700, 20);
    const dropped = s.dropNuke(s.player.x - 50, s.player.z + 8);
    const inFlight = s.projectiles.active.filter((b) => b.kind === 'nuke').length;
    const startY = Math.round(s.projectiles.active[0] ? s.projectiles.active[0].y - s.player.y : 0);
    for (let i = 0; i < 60 * 8; i++) s.projectiles.update(1 / 60);
    return {
      dropped, inFlight, startY,
      gone: s.projectiles.active.filter((b) => b.kind === 'nuke').length,
      near: { dying: near.state === 5, health: Math.round(near.health) },
      far: { alive: far.alive, health: Math.round(far.health) },
      flash: Number(s.state.flash.toFixed(2)),
      scars: s.renderer.scarCount,
    };
  });
  check('a warhead is dropped from four hundred metres up', nuke.dropped && nuke.startY > 380,
    `${nuke.startY} m`);
  check('and it comes down on its own', nuke.inFlight === 1 && nuke.gone === 0);
  check('fifty metres from the burst is not survivable', nuke.near.dying,
    `health ${nuke.near.health}`);
  check('seven hundred metres away is untouched', nuke.far.health === 100);
  check('it whites the frame out', nuke.flash > 0.5, `flash ${nuke.flash}`);
  check('and it leaves a mark on the city', nuke.scars >= 4, `${nuke.scars} marks`);

  const rain = await page.evaluate(() => {
    const s = window.spreefall;
    s.projectiles.clear(); s.renderer.clearScars();
    s.setCheat('nukeRain', true);
    s.state.nukeRainTimer = 0.1;
    let dropped = 0;
    // Only the rain tick is driven here, so the count is the rain's doing and
    // nothing else in the fixed step can have added to it. Each one is cleared
    // before it can reach the ground, or seventy seconds of this would be
    // seventy seconds of detonations.
    for (let i = 0; i < 60 * 70; i++) {
      const before = s.projectiles.count;
      s.rainTick(1 / 60);
      if (s.projectiles.count > before) dropped++;
      s.projectiles.clear();
    }
    // And separately: the rain is actually wired into the fixed step, rather
    // than being a function the test is the only caller of.
    s.state.nukeRainTimer = 0.05;
    let viaStep = 0;
    for (let i = 0; i < 180; i++) {
      const before = s.projectiles.count;
      s.fixedForTest(1 / 60);
      if (s.projectiles.count > before) viaStep++;
      s.projectiles.clear();
    }
    s.setCheat('nukeRain', false);
    s.state.nukeRainTimer = 9;
    s.projectiles.clear();
    return { dropped, viaStep };
  });
  check('nuke rain keeps dropping them', rain.dropped >= 6,
    `${rain.dropped} in seventy seconds`);
  check('and it runs off the simulation step, not off this test', rain.viaStep >= 1);

  // --- the ion cannon -------------------------------------------------------
  const ionRefused = await page.evaluate(() => {
    const s = window.spreefall;
    const m = s.combat.sanctuaries[0];
    s.ion.stop();
    return { memorial: s.ion.fire(m.x, m.z) === false, name: m.name };
  });
  check('the ion cannon cannot be put on the memorial either', ionRefused.memorial,
    ionRefused.name);

  const ionRun = await page.evaluate(async () => {
    const s = window.spreefall;
    s.ion.stop();
    s.soldiers.reset(); s.demolition.reset(); s.renderer.clearCollapses();
    s.fires.reset(); s.renderer.clearFires();
    s.setCheat('godmode', true);
    s.teleport(900, 0);
    const at = { x: s.player.x - 160, z: s.player.z };
    // A ring of them standing exactly where the beams sweep.
    s.soldiers.enabled = true;
    const budget = s.soldiers.budget;
    s.soldiers.budget = 0;
    const ring = s.ionSpec.ring;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const v = s.spawnSoldier(at.x - s.player.x + Math.cos(a) * ring,
        at.z - s.player.z + Math.sin(a) * ring);
      if (v) { v.health = 99999; v.charred = 0; }
    }
    const standing = s.soldiers.active.length;
    const fired = s.ion.fire(at.x, at.z);
    const twice = s.ion.fire(at.x + 40, at.z);
    const states = [];
    const spins = [];
    let charredPeak = 0;
    // Driven on this file's clock, so the test does not depend on the frame
    // rate of a software renderer.
    for (let i = 0; i < 60 * 13; i++) {
      s.ion.update(1 / 60);
      if (i % 60 === 0) { states.push(s.ion.state); spins.push(Number(s.ion.spin.toFixed(1))); }
      charredPeak = Math.max(charredPeak,
        s.soldiers.active.filter((v) => (v.charred || 0) > 0.5).length);
    }
    const out = {
      standing, fired, twice,
      states: [...new Set(states)].join(''),
      spinRose: spins[1] < spins[6],
      spins: `${spins[1]} to ${spins[6]}`,
      charredPeak,
      collapses: s.demolition.count,
      done: s.ion.state === s.ionState.DONE,
    };
    s.ion.stop();
    s.soldiers.budget = budget;
    s.soldiers.enabled = false; s.soldiers.reset();
    s.demolition.reset(); s.renderer.clearCollapses();
    s.fires.reset(); s.renderer.clearFires();
    s.cheats.reset();
    return out;
  });
  check('the ion cannon fires once and will not be fired again while it is going',
    ionRun.fired === true && ionRun.twice === false);
  check('it goes through the ring, the pause and the middle beam',
    /1/.test(ionRun.states) && /2/.test(ionRun.states) && /3/.test(ionRun.states)
    && ionRun.done, `states ${ionRun.states}`);
  check('and the ring speeds up as it turns', ionRun.spinRose,
    `${ionRun.spins} radians a second`);
  check('anything the beams pass over burns down to the bone',
    ionRun.charredPeak >= 4, `${ionRun.charredPeak} of ${ionRun.standing} charred`);
  check('and the middle beam takes the whole circle down',
    ionRun.collapses > 0, `${ionRun.collapses} collapse sites`);

  // --- the target map ------------------------------------------------------
  const map = await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.teleport(81, 0);
    s.openTargeting();
    const host = document.getElementById('nuketarget');
    const open = !host.classList.contains('hidden');
    const c = document.getElementById('targetmap');
    const r = c.getBoundingClientRect();
    // The middle of the map is the middle of the world, and a quarter of the
    // way across it is a quarter of the way across the world. If the click to
    // world transform were wrong, one of these would be.
    const mid = s.targetMap.worldAt(r.left + r.width / 2, r.top + r.height / 2);
    const quarter = s.targetMap.worldAt(r.left + r.width * 0.25, r.top + r.height / 2);
    const want = { x: (s.world.minX + s.world.maxX) / 2, z: (s.world.minZ + s.world.maxZ) / 2 };
    const span = (s.world.maxX - s.world.minX);
    s.closeTargeting();
    return {
      open, closed: host.classList.contains('hidden'),
      midErr: Math.round(Math.hypot(mid.x - want.x, mid.z - want.z)),
      quarterErr: Math.round(Math.abs((mid.x - quarter.x) / (span * 0.25) - 1) * 100),
    };
  });
  const zoomed = await page.evaluate(() => {
    const s = window.spreefall;
    s.openTargeting();
    const c = document.getElementById('targetmap');
    const r = c.getBoundingClientRect();
    // Near the middle, where the window is free to move. Zooming at the very
    // edge of the city is clamped, which is checked separately below.
    const px = r.left + r.width * 0.45, py = r.top + r.height * 0.5;
    const before = s.targetMap.worldAt(px, py);
    const wide = Math.abs(s.targetMap.worldAt(r.left + r.width * 0.8, py).x
      - s.targetMap.worldAt(r.left + r.width * 0.3, py).x);
    s.targetMap.zoomAt(px, py, 4);
    s.targetMap.draw(s.player.x, s.player.z, s.camera.yaw, new Set(), []);
    const after = s.targetMap.worldAt(px, py);
    const held = Math.hypot(after.x - before.x, after.z - before.z);
    // The same half of the canvas now covers a quarter of the ground.
    const close = Math.abs(s.targetMap.worldAt(r.left + r.width * 0.8, py).x
      - s.targetMap.worldAt(r.left + r.width * 0.3, py).x);
    const ratio = wide / close;
    // Pan, then ask for the whole city back.
    const centreBefore = { ...s.targetMap.centre };
    s.targetMap.panBy(120, -60);
    s.targetMap.draw(s.player.x, s.player.z, s.camera.yaw, new Set(), []);
    const panned = Math.hypot(s.targetMap.centre.x - centreBefore.x,
      s.targetMap.centre.z - centreBefore.z);
    s.targetMap.resetView();
    s.targetMap.draw(s.player.x, s.player.z, s.camera.yaw, new Set(), []);
    const reset = s.targetMap.zoom;
    // And it will not be pushed off the edge of the city.
    s.targetMap.zoomAt(px, py, 3);
    s.targetMap.panBy(-99999, -99999);
    s.targetMap.draw(s.player.x, s.player.z, s.camera.yaw, new Set(), []);
    const inside = s.targetMap.centre.x > s.world.minX && s.targetMap.centre.x < s.world.maxX;
    s.targetMap.resetView();
    s.closeTargeting();
    return { held: Number(held.toFixed(2)), ratio: Number(ratio.toFixed(2)),
      wide: Math.round(wide), close: Math.round(close),
      panned: Math.round(panned), reset, inside };
  });
  check('zooming holds whatever is under the cursor', zoomed.held < 1.5,
    `${zoomed.held} m of drift at four times`);
  check('and four times really is four times', Math.abs(zoomed.ratio - 4) < 0.1,
    `${zoomed.wide} m of city becomes ${zoomed.close} m across the same pixels`);
  check('the map can be pushed about and put back', zoomed.panned > 10 && zoomed.reset === 1);
  check('and it will not be pushed off the edge of the city', zoomed.inside);

  const twoStep = await page.evaluate(() => {
    const s = window.spreefall;
    s.projectiles.clear();
    s.openTargeting();
    const armed = s.armNuke(s.player.x + 800, s.player.z);
    const beforeRelease = s.projectiles.active.filter((b) => b.kind === 'nuke').length;
    const says = document.getElementById('confirmwhere').textContent;
    // Cancelling really cancels.
    document.getElementById('confirmcancel').click();
    const cancelled = document.getElementById('targetconfirm').classList.contains('hidden');
    const afterCancel = s.releaseNuke();
    s.armNuke(s.player.x + 800, s.player.z);
    s.releaseNuke();
    const flying = s.projectiles.active.filter((b) => b.kind === 'nuke').length;
    s.projectiles.clear();
    s.closeTargeting();
    return { armed, beforeRelease, says, cancelled, afterCancel, flying };
  });
  check('picking a target does not release anything', twoStep.armed && twoStep.beforeRelease === 0,
    twoStep.says);
  check('and picking again takes it back', twoStep.cancelled && twoStep.afterCancel === false);
  check('and confirming is what sends it', twoStep.flying === 1);

  check('the target map opens and closes', map.open && map.closed);
  check('and a click on it lands where you clicked', map.midErr <= 2,
    `${map.midErr} m out at the centre`);
  check('at the right scale all the way across', map.quarterErr <= 6,
    `${map.quarterErr}% off a quarter of the city`);

  // --- what nothing switched on looks like ---------------------------------
  const clean = await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    return {
      god: s.combat.godmode, ammo: s.weapon.infiniteAmmo,
      gib: s.soldiers.gore.gib, ragdoll: s.soldiers.gore.ragdoll,
      any: s.cheats.any,
    };
  });
  check('all off really is all off',
    !clean.god && !clean.ammo && !clean.gib && !clean.ragdoll && !clean.any);

  // --- the pictures --------------------------------------------------------
  await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.soldiers.reset(); s.gibs.clear(); s.projectiles.clear(); s.effects.clear();
    s.renderer.clearScars();
    s.combat.reset(); s.weapon.reset();
    s.teleport(81, 0); s.look(90, -3); s.setTime(16.4);
    s.state.flash = 0;
    s.cheatMenu(true);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, 'cheat-01-menu.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    s.cheatMenu(false);
    s.openTargeting();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'cheat-02-targeting.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    s.closeTargeting();
    s.setCheat('godmode', true);
    s.teleport(120, -6); s.look(268, -4); s.setTime(16.4);
    s.state.flash = 0;
    s.dropNuke(s.player.x + 520, s.player.z + 30);
    for (let i = 0; i < 60 * 5; i++) s.projectiles.update(1 / 60);
  });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(SHOTS, 'cheat-03-warhead.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.setCheat('gib', true); s.setCheat('blood', true); s.setCheat('ultraGore', true);
    s.gibs.clear(); s.effects.clear(); s.state.flash = 0;
    s.teleport(81, 0); s.look(92, -4);
    for (const [dx, dz] of [[-9, -2], [-12, 3], [-15, -5], [-11, 7]]) {
      const v = s.spawnSoldier(dx, dz);
      s.soldiers.damage(v, 9999, { x: -1, y: 0, z: 0.2 });
    }
    for (let i = 0; i < 40; i++) s.gibs.update(1 / 60);
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, 'cheat-04-gore.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset(); s.gibs.clear(); s.effects.clear();
    s.soldiers.reset(); s.projectiles.clear();
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
