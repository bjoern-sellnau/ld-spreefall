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
      'wreckBuildings', 'wreckGround', 'lastKill',
      'gib', 'ragdoll', 'blood', 'ultraGore', 'maxGore', 'overkill', 'comicGore', 'everyWeapon', 'oneManArmy', 'nightmare']
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

  // --- what a blast is allowed to take -------------------------------------
  // Three warheads, each on its own building, each read for both halves of
  // the destruction: how much of the frontage is left, and how far the
  // street under it moved. Measured off the collision rather than off the
  // picture, because the collision is what the two switches have to keep in
  // step with what you can see.
  await page.evaluate(() => {
    window.W = {
      /** A building to drop one on, near the offset and out of the memorial. */
      spot(ox) {
        const s = window.spreefall;
        for (let d = 10; d < 240; d += 6) {
          for (let i = 0; i < 48; i++) {
            const a = (i / 48) * Math.PI * 2;
            const x = s.player.x + ox + Math.cos(a) * d;
            const z = s.player.z + Math.sin(a) * d;
            if (s.world.tallestNear(x, z, 8) > 14 && !s.combat.isShielded(x, 0, z)) {
              return { x, z };
            }
          }
        }
        return null;
      },
      /** One warhead, and what it left behind once the dust had settled. */
      hit(at) {
        const s = window.spreefall;
        const y = s.world.groundHeight(at.x, at.z);
        // How tall the frontage is, measured from the street as it was
        // before any of this. The world measures a wall from the ground
        // under it, and the ground under this one is about to drop ten
        // metres, which on its own would read as a building that grew.
        const tall = () => {
          const h = s.world.tallestNear(at.x, at.z, 8);
          return h > 0 ? h + s.world.groundHeight(at.x, at.z) - y : 0;
        };
        const tallBefore = tall();
        s.demolition.blast(at.x, y, at.z, 170, 4000);
        const site = s.demolition.sites[0] || null;
        const crater = site ? Math.round(site.craterRadius) : 0;
        // Long enough for the fall to finish and the ruin to be written into
        // the city, so these are readings off the baked bytes.
        for (let i = 0; i < 400; i++) s.demolition.update(1 / 60);
        return {
          crater,
          lost: Number((tallBefore - tall()).toFixed(1)),
          sank: Number((y - s.world.groundHeight(at.x, at.z)).toFixed(2)),
        };
      },
    };
  });

  const wreck = await page.evaluate(() => {
    const s = window.spreefall;
    const out = {};
    for (const [name, ox, buildings, ground] of [
      ['both', -340, true, true],
      ['noBuildings', 0, false, true],
      ['noGround', 340, true, false],
    ]) {
      s.demolition.reset(); s.renderer.clearCollapses();
      s.setCheat('wreckBuildings', buildings);
      s.setCheat('wreckGround', ground);
      const at = window.W.spot(ox);
      out[name] = at ? window.W.hit(at) : null;
    }
    s.setCheat('wreckBuildings', true);
    s.setCheat('wreckGround', true);
    s.demolition.reset(); s.renderer.clearCollapses();
    return out;
  });
  check('with both switches on a warhead takes the frontage and the street',
    !!wreck.both && wreck.both.lost > 5 && wreck.both.sank > 1,
    wreck.both ? `${wreck.both.lost} m of wall gone, street down ${wreck.both.sank} m`
      : 'no building found');
  check('with the buildings switch off the frontage stays up and the hole is still dug',
    !!wreck.noBuildings && wreck.noBuildings.lost <= 0.1 && wreck.noBuildings.sank > 1,
    wreck.noBuildings ? `${wreck.noBuildings.lost} m of wall gone, street down ${wreck.noBuildings.sank} m`
      : 'no building found');
  check('and with the ground switch off the street stays level and the buildings still come down',
    !!wreck.noGround && wreck.noGround.crater === 0 && wreck.noGround.sank === 0
      && wreck.noGround.lost > 5,
    wreck.noGround ? `${wreck.noGround.lost} m of wall gone, street down ${wreck.noGround.sank} m`
      : 'no building found');

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
    const fall = (ragdoll, top) => {
      s.cheats.reset(); s.soldiers.reset();
      if (ragdoll) s.setCheat('ragdoll', true);
      if (top) s.setCheat('maxGore', true);
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
    const top = fall(true, true);
    s.cheats.reset(); s.soldiers.reset();
    return { off, on, top };
  });
  check('without ragdoll a body falls straight down and barely moves',
    doll.off.lean > 1.4 && doll.off.roll === 0 && doll.off.thrown < 0.6,
    `lean ${doll.off.lean}, roll ${doll.off.roll}, ${doll.off.thrown} m`);
  check('with it on the shot throws them, lifts them and turns them',
    doll.on.thrown > 1.2 && doll.on.roll > 0.4 && doll.on.air > 0.05 && doll.on.lean > 1.0,
    `turned ${doll.on.roll} rad, ${doll.on.air} m off the ground, ${doll.on.thrown} m back`);
  check('and the switch above ultra gore throws them half again as far',
    doll.top.thrown > doll.on.thrown * 1.3,
    `${doll.on.thrown} m becomes ${doll.top.thrown} m`);

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
    s.setCheat('maxGore', true);
    const max = hit();
    s.cheats.reset(); s.soldiers.reset(); s.effects.clear();
    return { off, on, ultra, max };
  });
  check('a hit throws no blood with the switch off', blood.off === 0);
  check('and does with it on', blood.on > 14, `${blood.on} drops`);
  check('and ultra gore throws considerably more of it', blood.ultra > blood.on * 1.8,
    `${blood.on} to ${blood.ultra}`);
  check('and the switch above it more again', blood.max > blood.ultra * 1.25,
    `${blood.ultra} to ${blood.max}`);

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

  // --- overkill: past the top, on purpose ---------------------------------
  const over = await page.evaluate(async () => {
    const s = window.spreefall;
    const kill = (setting) => {
      s.cheats.reset(); s.soldiers.reset(); s.gibs.clear(); s.effects.clear();
      for (const id of setting) s.setCheat(id, true);
      const v = s.spawnSoldier(-10, 1);
      s.soldiers.damage(v, 9999, { x: -1, y: 0, z: 0.2 });
      const chunks = s.gibs.count;
      const bones = s.gibs.active.filter((g) => g.alive && g.part === 23).length;
      // Thrown up hard enough to come back down from above head height.
      const rain = s.gibs.active.filter((g) => g.alive && g.vy > 14).length;
      return { chunks, bones, rain, gibbed: !!v.gibbed };
    };
    const ultra = kill(['ultraGore']);
    const top = kill(['overkill']);
    const word = document.getElementById('overkill');
    const shown = { text: word.textContent, on: word.classList.contains('show') };
    const stop = s.state.goreStop;
    // A second kill straight after counts as a run.
    const v2 = s.spawnSoldier(-12, -3);
    s.soldiers.damage(v2, 9999, { x: -1, y: 0, z: 0 });
    const streak = word.textContent;
    // The fountain runs on the render clock: a few real frames, then the
    // blood in the air that is still going up, which is the fountain and not
    // the drops falling off the pieces.
    s.effects.clear();
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const high = s.effects.list.filter((p) => p.alive && p.kind === 3 && p.vy > 4).length;
    s.cheats.reset(); s.soldiers.reset(); s.gibs.clear(); s.effects.clear();
    return { ultra, top, shown, stop, high, streak };
  });
  check('overkill takes every kill apart, with nothing else switched on',
    over.top.gibbed && over.top.chunks > over.ultra.chunks * 2.5,
    `${over.ultra.chunks} pieces at ultra, ${over.top.chunks} at overkill`);
  // Thirty three pieces of which each is bone four times in five, and the
  // bursts after it take the oldest slots once the pool of 256 is full: the
  // count lands anywhere from the high teens to the high twenties, so this
  // asks for a skeleton's worth rather than for a number it happens to hit.
  check('and the skeleton comes out with it', over.top.bones >= 12 && over.ultra.bones === 0,
    `${over.top.bones} bones`);
  check('and part of it goes up to rain back down', over.top.rain > 20, `${over.top.rain} pieces going up`);
  check('and the clock stops for a beat while a word goes across the screen',
    over.stop > 0 && over.shown.on && over.shown.text.length > 3,
    `"${over.shown.text}", ${over.stop.toFixed(2)} s`);
  check('and a fountain keeps going where they stood', over.high > 30,
    `${over.high} drops going up a few frames on`);
  check('and a second kill straight after is counted as a run', / x2$/.test(over.streak), over.streak);

  // --- comic carnage: overkill drawn as a comic book --------------------------
  const comic = await page.evaluate(async () => {
    const s = window.spreefall;
    s.cheats.reset(); s.soldiers.reset(); s.gibs.clear(); s.effects.clear();
    s.setCheat('comicGore', true);
    const v = s.spawnSoldier(-6, 1);
    s.soldiers.damage(v, 9999, { x: -1, y: 0, z: 0.2 });
    const word = document.getElementById('overkill');
    const out = { gibbed: !!v.gibbed, chunks: s.gibs.count, comicWord: word.classList.contains('comic'),
      text: word.textContent, rain: s.bloodRain.length,
      splashes: document.querySelectorAll('#splatter i').length };
    // The blood is the red of a comic book, not the near black of the rest.
    s.effects.clear();
    s.effects.blood(0, 2, 0, 0, 1, 0, 1);
    const drops = s.effects.list.filter((p) => p.alive && p.kind === 3);
    out.red = drops.length ? +Math.max(...drops.map((p) => p.r)).toFixed(2) : 0;
    s.effects.clear();
    s.soldiers.reset(); s.gibs.clear();
    return out;
  });
  check('comic carnage takes them apart with the word in yellow, red rain and blood on the lens',
    comic.gibbed && comic.comicWord && comic.rain >= 1 && comic.splashes >= 2 && /!/.test(comic.text),
    JSON.stringify(comic));
  check('and its blood is a comic book red', comic.red > 0.4, `${comic.red}`);
  // And against the wall: a kill beside a frontage leaves blood on it.
  const wall = await page.evaluate(async () => {
    const s = window.spreefall;
    s.cheats.reset(); s.setCheat('comicGore', true); s.setCheat('godmode', true);
    s.soldiers.reset(); s.gibs.clear(); s.effects.clear(); s.renderer.clearBlood();
    // A pale wall to see it on: the long north face of the Brandenburg
    // Gate's cross wall south of the carriageway, from inside the passage.
    const g0 = s.world.groundHeight(0, 6);
    const probe = s.world.raycast(0, g0 + 1.2, 6, 0, 0, -1, 20);
    const found = probe && probe.kind === 'wall' ? { x: 0, z: 6, a: -Math.PI / 2, t: probe.t } : null;
    if (!found) return { skip: true };
    s.teleport(found.x, found.z);
    const before = s.state.wallSplats || 0;
    const dx = Math.cos(found.a), dz = Math.sin(found.a);
    const v = s.spawnSoldier(dx * (found.t - 2), dz * (found.t - 2));
    v.rise = 0; v.y = s.world.groundHeight(v.x, v.z);
    s.soldiers.damage(v, 9999, { x: dx, y: 0.1, z: dz });
    const out = { skip: false, splats: (s.state.wallSplats || 0) - before, count: s.renderer.bloodCount };
    // The picture of it, with the smoke and the fountain gone, from a step back.
    s.teleport(s.player.x - dx * 1.5, s.player.z - dz * 1.5);
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, 2);
    s.effects.clear(); s.gibs.clear();
    s.bloodRain.length = 0; s.gushes.length = 0;
    return out;
  });
  await page.waitForTimeout(5600);
  await page.evaluate(() => {
    window.spreefall.effects.clear(); window.spreefall.gibs.clear();
    document.getElementById('splatter').innerHTML = '';
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'cheat-08-comic-wall.png') });
  check('a comic kill beside a frontage leaves its blood on the wall', !wall.skip && wall.splats >= 1 && wall.count >= 1,
    JSON.stringify(wall));
  await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset(); s.renderer.clearBlood(); s.soldiers.reset();
    s.teleport(81, 0);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
  });

  // The picture: three in front of you, gone at once.
  await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset(); s.setCheat('comicGore', true); s.setCheat('godmode', true);
    s.soldiers.reset(); s.gibs.clear(); s.effects.clear();
    s.look(90, -4); s.camera.update(16 / 10);
    const fx = s.camera.forward[0], fz = s.camera.forward[2];
    for (const [a, b] of [[7, -2], [9, 1.5], [6, 2.5]]) {
      const v = s.spawnSoldier(fx * a - fz * b, fz * a + fx * b);
      v.rise = 0;
      s.soldiers.damage(v, 9999, { x: fx, y: 0.2, z: fz });
    }
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, 'cheat-07-comic.png') });
  await page.evaluate(() => { const s = window.spreefall; s.cheats.reset(); s.soldiers.reset(); s.gibs.clear(); });

  // --- what is left of somebody who burned ---------------------------------
  const bones = await page.evaluate(async () => {
    const s = window.spreefall;
    const burnt = (at) => {
      // Charred and killed by the burn, which is the path the flamethrower
      // and the ion cannon both end in: no body falls, a skeleton stands.
      const v = s.spawnSoldier(at, 0);
      v.charred = 1;
      s.soldiers.damage(v, 9999, { x: 0, y: 0, z: 0 });
      v.charred = 1;
      return v;
    };
    s.cheats.reset(); s.soldiers.reset(); s.gibs.clear(); s.combat.reset();
    s.soldiers.enabled = true;
    const budget = s.soldiers.budget;
    s.soldiers.budget = 0;

    // One left alone. It stands for a while and then comes apart on its own.
    const a = burnt(-14);
    const standing = s.soldiers.isBones(a);
    let stoodFor = 0;
    for (let i = 0; i < 60 * 40 && a.alive; i++) {
      s.soldiers.update(1 / 60, { x: s.player.x, y: s.player.y + 1.7, z: s.player.z, alive: true }, i / 60);
      stoodFor += 1 / 60;
    }
    const crumbled = { gone: !a.alive, after: Math.round(stoodFor), bones: s.gibs.count };

    // One shot where it stands.
    s.gibs.clear(); s.soldiers.reset(); s.weapon.reset();
    const b = burnt(-12);
    const kills = s.combat.kills;
    const ex = s.player.x, ey = s.player.y + 1.7, ez = s.player.z;
    const vx = b.x - ex, vy = b.y + 1.1 - ey, vz = b.z - ez;
    const l = Math.hypot(vx, vy, vz);
    s.look(Math.atan2(-vx, -vz) * 180 / Math.PI, Math.asin(vy / l) * 180 / Math.PI);
    s.camera.update(16 / 9);
    s.weapon.select('m16'); s.weapon.cooldown = 0; s.weapon.spread = 0;
    s.shoot();
    const shot = { gone: !b.alive, bones: s.gibs.count, credited: s.combat.kills - kills };

    s.soldiers.budget = budget;
    s.soldiers.enabled = false;
    s.cheats.reset(); s.soldiers.reset(); s.gibs.clear();
    return { standing, crumbled, shot };
  });
  check('somebody burnt to the bone is left standing', bones.standing);
  check('and comes apart on his own rather than standing there for ever',
    bones.crumbled.gone && bones.crumbled.bones > 4,
    `after ${bones.crumbled.after} s, ${bones.crumbled.bones} bones`);
  check('a shot at one takes it to pieces where it stands',
    bones.shot.gone && bones.shot.bones > 6,
    `${bones.shot.bones} bones`);
  check('and it counts for nothing, because he was already dead',
    bones.shot.credited === 0, `${bones.shot.credited} kills`);

  // --- what a building has left --------------------------------------------
  const damage = await page.evaluate(async () => {
    const s = window.spreefall;
    s.cheats.reset();
    s.demolition.reset(); s.renderer.clearCollapses();
    // Find a frontage to look at, and look at it.
    // Something that is still standing, rather than the first thing the ray
    // happens to hit: by this point in the suite half the street is a ruin
    // two metres high, and what a ruin has left is a different question.
    const eye = s.camera.position;
    let wall = null;
    for (let i = 0; i < 48 && !wall; i++) {
      s.look((i / 48) * 720, i % 2 ? -2 : 2);
      s.camera.update(16 / 9);
      const g = s.camera.forward;
      const hit = s.world.raycast(eye[0], eye[1], eye[2], g[0], g[1], g[2], 200);
      if (!hit) continue;
      const hx = eye[0] + g[0] * hit.t, hz = eye[2] + g[2] * hit.t;
      if (s.world.tallestNear(hx, hz, 10) > 6) wall = hit;
    }
    if (!wall) return { skip: true };
    const d = s.camera.forward;
    const x = eye[0] + d[0] * wall.t, z = eye[2] + d[2] * wall.t;
    const before = s.demolition.damageAt(x, z);
    const off = !document.getElementById('buildinfo').classList.contains('hidden');
    s.setCheat('showDamage', true);
    await new Promise((r) => requestAnimationFrame(r));
    const shown = document.getElementById('buildinfo').textContent;
    // Put some damage into that cell and ask again.
    s.demolition.blast(x, s.world.groundHeight(x, z), z, 9, 300);
    for (let i = 0; i < 60; i++) s.demolition.update(1 / 60);
    const after = s.demolition.damageAt(x, z);
    await new Promise((r) => requestAnimationFrame(r));
    const shownAfter = document.getElementById('buildinfo').textContent;
    s.setCheat('showDamage', false);
    await new Promise((r) => requestAnimationFrame(r));
    const hiddenAgain = document.getElementById('buildinfo').classList.contains('hidden');
    s.demolition.reset(); s.renderer.clearCollapses();
    return {
      off, shown, shownAfter, hiddenAgain,
      left0: before.left, left1: after.left, whole: before.whole,
    };
  });
  check('the menu can show what a building has left',
    !damage.skip && damage.off === false && /left of/.test(damage.shown || '')
      && damage.hiddenAgain,
    damage.skip ? 'no wall to look at' : (damage.shown || '').slice(0, 60));
  check('and the number comes down as you take the frontage apart',
    !damage.skip && damage.left1 < damage.left0 && damage.left0 === damage.whole,
    damage.skip ? '' : `${damage.left0} of ${damage.whole} became ${damage.left1}`);

  // --- the last kill -------------------------------------------------------
  // Killed through the weapon rather than by calling damage, because the
  // slow motion hangs off the credit and the credit comes from the shot.
  const lastKill = await page.evaluate(async () => {
    const s = window.spreefall;
    const kill = async (on, others, far = 0) => {
      s.cheats.reset();
      s.soldiers.reset(); s.drones.reset(); s.combat.reset();
      // And the rest the last one put on it, or the cases after the first
      // are all still inside its cooldown.
      s.state.killSlow = 0; s.state.blastSlow = 0; s.state.killRest = 0;
      if (on) s.setCheat('lastKill', true);
      // Company, near enough to count as the fight you are in.
      for (let i = 0; i < others; i++) s.spawnSoldier(-40 - i * 5, 14 + i * 3);
      // And company that is somebody else's problem, a street and a half
      // away. This is what used to stop it firing at all: in a live fight
      // something is always alive somewhere within a hundred and fifty
      // metres, which is what the old reach was.
      for (let i = 0; i < far; i++) s.spawnSoldier(-150 - i * 8, 40);
      const v = s.spawnSoldier(-16, 1);
      const ex = s.player.x, ey = s.player.y + 1.7, ez = s.player.z;
      const vx = v.x - ex, vy = v.y + 1.1 - ey, vz = v.z - ez;
      const l = Math.hypot(vx, vy, vz);
      s.look(Math.atan2(-vx, -vz) * 180 / Math.PI, Math.asin(vy / l) * 180 / Math.PI);
      s.camera.update(16 / 9);
      s.weapon.select('railgun');
      for (let i = 0; i < 4 && v.alive; i++) {
        s.weapon.cooldown = 0; s.weapon.spread = 0; s.shoot();
      }
      const slow = s.state.killSlow;
      // And what the world actually did with it, which is the point of it.
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      const scale = s.state.timeScale;
      s.cheats.reset(); s.soldiers.reset(); s.weapon.reset();
      s.state.killSlow = 0; s.state.killRest = 0;
      return { dead: !v.alive, slow: Number(slow.toFixed(2)), scale: Number(scale.toFixed(2)) };
    };
    return {
      alone: await kill(true, 0),
      company: await kill(true, 3),
      off: await kill(false, 0),
      acrossTown: await kill(true, 0, 3),
    };
  });
  check('the last one standing goes down in slow motion',
    lastKill.alone.dead && lastKill.alone.slow > 1 && lastKill.alone.scale < 0.4,
    `${lastKill.alone.slow} s left, world at ${lastKill.alone.scale} of real time`);
  check('and a kill with three of them still up does not slow anything',
    lastKill.company.dead && lastKill.company.slow === 0 && lastKill.company.scale === 1,
    `${lastKill.company.slow} s, world at ${lastKill.company.scale}`);
  check('nor does the last kill with the switch off',
    lastKill.off.dead && lastKill.off.slow === 0 && lastKill.off.scale === 1,
    `${lastKill.off.slow} s, world at ${lastKill.off.scale}`);
  check('and three of them a street and a half away do not stop it',
    lastKill.acrossTown.dead && lastKill.acrossTown.slow > 1
      && lastKill.acrossTown.scale < 0.4,
    `${lastKill.acrossTown.slow} s left, world at ${lastKill.acrossTown.scale}`);

  // --- Just a Walk ---------------------------------------------------------
  // Nothing is sent after you, and what the menu brings out by hand is still
  // a real enemy: alive, moving, and not replaced when it goes down.
  const quiet = await page.evaluate(async () => {
    const s = window.spreefall;
    s.cheats.reset();
    s.soldiers.reset(); s.drones.reset(); s.jets.reset();
    s.state.peaceful = true;
    s.soldiers.enabled = true; s.drones.enabled = true; s.jets.enabled = true;
    // Budgets as a fight would set them. The mode has to take them back.
    s.soldiers.budget = 8; s.drones.budget = 6; s.jets.budget = 2;
    const t0 = s.loop.simTime;
    while (s.loop.simTime - t0 < 12) await new Promise((r) => requestAnimationFrame(r));
    // The people who live here do not count: they are not sent after you,
    // they were here first.
    const sent = s.soldiers.active.filter((v) => !v.civilian).length
      + s.drones.active.length + s.jets.active.length;

    // And by hand.
    const made = s.spawnWave('drones', 4);
    const up = s.drones.active.length;
    const where = s.drones.active.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join('|');
    const t1 = s.loop.simTime;
    while (s.loop.simTime - t1 < 3) await new Promise((r) => requestAnimationFrame(r));
    const moved = s.drones.active.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join('|') !== where;
    const stillUp = s.drones.active.length;

    s.state.peaceful = false;
    s.soldiers.enabled = false; s.drones.enabled = false; s.jets.enabled = false;
    s.soldiers.reset(); s.drones.reset(); s.jets.reset();
    return { sent, made, up, moved, stillUp };
  });
  check('in Just a Walk nothing is sent after you',
    quiet.sent === 0, `${quiet.sent} arrived in twelve seconds with the budgets full`);
  check('and what the menu brings out by hand is still real',
    quiet.made === 4 && quiet.up === 4 && quiet.moved && quiet.stillUp === 4,
    `${quiet.up} up, ${quiet.moved ? 'flying' : 'frozen'}`);

  // Killing what you spawned raises the threat level, and the threat level is
  // what gives the jets a budget. The budgets are held at nought at the top of
  // the step and the tier is applied from inside combat.update, which runs
  // after it: for the rest of that step the jets had a budget and a flight
  // took off. Reported as soldiers by hand in Just a Walk and then jets.
  const tiered = await page.evaluate(async () => {
    const s = window.spreefall;
    s.cheats.reset();
    s.soldiers.reset(); s.drones.reset(); s.jets.reset();
    s.state.peaceful = true;
    s.soldiers.enabled = true; s.drones.enabled = true; s.jets.enabled = true;
    s.combat.reset();
    // Straight to the level that calls for air support, the way a fight gets
    // there, and then let the city run.
    for (let t = 0; t <= 4; t++) if (s.combat.onTier) s.combat.onTier(t);
    const t0 = s.loop.simTime;
    while (s.loop.simTime - t0 < 10) await new Promise((r) => requestAnimationFrame(r));
    const out = {
      jets: s.jets.active.length, drones: s.drones.active.length,
      budgets: [s.jets.budget, s.drones.budget, s.soldiers.budget],
    };
    s.state.peaceful = false;
    s.soldiers.enabled = false; s.drones.enabled = false; s.jets.enabled = false;
    s.soldiers.reset(); s.drones.reset(); s.jets.reset();
    s.combat.reset();
    return out;
  });
  check('and the threat level never calls in air support in Just a Walk',
    tiered.jets === 0 && tiered.drones === 0,
    `${tiered.jets} jets and ${tiered.drones} drones at threat five, budgets ${tiered.budgets.join('/')}`);

  // --- the people who live here --------------------------------------------
  const folk = await page.evaluate(async () => {
    const s = window.spreefall;
    s.cheats.reset();
    s.soldiers.reset(); s.drones.reset(); s.jets.reset();
    s.state.peaceful = true;
    s.soldiers.enabled = true;
    const t0 = s.loop.simTime;
    while (s.loop.simTime - t0 < 14 && s.soldiers.civilianCount < 6) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    const out = { count: s.soldiers.civilianCount };
    const who = s.soldiers.active.filter((v) => v.civilian);
    out.armed = who.filter((v) => v.state === 1 || v.state === 2).length;
    // They walk: a stretch of simulation moves them about the place.
    const before = who.map((v) => `${v.x.toFixed(1)},${v.z.toFixed(1)}`);
    const t1 = s.loop.simTime;
    while (s.loop.simTime - t1 < 2) await new Promise((r) => requestAnimationFrame(r));
    out.moved = who.filter((v, i) => `${v.x.toFixed(1)},${v.z.toFixed(1)}` !== before[i]).length;

    // And a shot sends them running away from it rather than towards it.
    //
    // Three of them are stood where a shot will be heard first, which is not
    // cheating: a gunshot scares everybody inside seventy metres, and this
    // measures that rather than where six people happened to wander. They
    // spawn in a ring thirty to a hundred and twenty metres out and then walk
    // an errand, so on about one run in eight nobody was inside the seventy
    // at the moment of the shot and the check failed on the dice, reporting
    // nought of nought. It did exactly that once.
    const near = who.slice(0, 3);
    near.forEach((v, i) => {
      const want = 22 + i * 14;
      // Somewhere in the open at that distance, so that running away from the
      // shot is something they can actually do.
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2 + i * 0.7;
        const x = s.player.x + Math.cos(a) * want;
        const z = s.player.z + Math.sin(a) * want;
        if (!s.world.isLoaded(x, z)) continue;
        const g = s.world.groundHeight(x, z);
        if (s.world.raycast(x, g + 1.2, z, Math.cos(a), 0, Math.sin(a), 14)) continue;
        v.x = x; v.z = z; v.y = g;
        break;
      }
      v.panicLeft = 0;
    });
    const away0 = near.map((v) => Math.hypot(v.x - s.player.x, v.z - s.player.z));
    s.weapon.select('m16'); s.weapon.cooldown = 0; s.weapon.spread = 0;
    s.shoot();
    out.scared = near.filter((v) => v.panicLeft > 0).length;
    out.heard = near.length;
    const t2 = s.loop.simTime;
    while (s.loop.simTime - t2 < 2.5) await new Promise((r) => requestAnimationFrame(r));
    out.further = near.filter((v, i) =>
      Math.hypot(v.x - s.player.x, v.z - s.player.z) > away0[i] + 1.5).length;

    s.state.peaceful = false;
    s.soldiers.civilianBudget = 0;
    s.soldiers.enabled = false;
    s.soldiers.reset(); s.weapon.reset();
    return out;
  });
  check('people are about the place in Just a Walk',
    folk.count >= 6 && folk.armed === 0, `${folk.count} of them, none in the fight`);
  check('and they are going somewhere', folk.moved > 0, `${folk.moved} on the move`);
  check('a shot sends everybody within earshot running',
    folk.heard > 0 && folk.scared === folk.heard,
    `${folk.scared} of ${folk.heard} bolted`);
  check('and they run away from it rather than past it',
    folk.further >= Math.ceil(folk.heard * 0.6),
    `${folk.further} of ${folk.heard} further off two seconds later`);

  // --- how they arrive -----------------------------------------------------
  const arrival = await page.evaluate(async () => {
    const s = window.spreefall;
    s.soldiers.reset(); s.effects.clear();
    s.state.peaceful = false;
    // The layer has to be running, or nobody comes up out of anything: the
    // rise is in the soldier update, which is where it belongs.
    const was = s.soldiers.enabled;
    s.soldiers.enabled = true;
    s.soldiers.budget = 0;
    const made = s.spawnWave('soldiers', 2);
    const v = s.soldiers.active[0];
    if (!v) return { skip: true };
    const ground = s.world.groundHeight(v.x, v.z);
    const sphere = s.effects.list.filter((p) => p.alive && p.kind === 1).length;
    const under = Number((ground - v.y).toFixed(2));
    const t0 = s.loop.simTime;
    while (s.loop.simTime - t0 < 1.4) await new Promise((r) => requestAnimationFrame(r));
    const standing = Number(Math.abs(v.y - s.world.groundHeight(v.x, v.z)).toFixed(2));
    s.soldiers.enabled = was;
    s.soldiers.reset(); s.effects.clear();
    return { made, sphere, under, standing };
  });
  check('they arrive in a sphere of light rather than walking round a corner',
    !arrival.skip && arrival.made === 2 && arrival.sphere > 30,
    arrival.skip ? 'nobody arrived' : `${arrival.sphere} points of light`);
  check('and come up through it onto their feet',
    !arrival.skip && arrival.under > 0.8 && arrival.standing < 0.2,
    arrival.skip ? '' : `${arrival.under} m under the street, then ${arrival.standing} m off it`);

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
      .filter((a) => s.combat.isShielded(a.x, 0, a.z)).length;
    s.soldiers.reset(); s.drones.reset(); s.jets.reset();
    return { made, live, inZone };
  });
  check('the menu brings a section, a flight and a pair out',
    waves.made.soldiers === 6 && waves.made.drones === 4 && waves.made.jets === 2,
    `${waves.live.soldiers} soldiers, ${waves.live.drones} drones, ${waves.live.jets} jets`);
  check('and the memorial is not kept clear of them', waves.inZone >= 0,
    `${waves.inZone} arrived under the field`);

  // --- which mech, yours and theirs --------------------------------------
  const picked = await page.evaluate(async () => {
    const s = window.spreefall;
    const chips = (side) => [...document.querySelectorAll(`[data-mech^="${side}:"]`)].map((b) => b.dataset.mech);
    const mineChips = chips('mine'), foeChips = chips('foe');
    // Yours: pick one with the chip, as a player would, and call it down.
    document.querySelector('[data-mech="mine:bruin"]').click();
    const lit = document.querySelector('[data-mech="mine:bruin"]').classList.contains('on');
    s.mechs.reset();
    const call = s.dropRide('titan');
    const inbound = s.state.titanInbound ? s.state.titanInbound.type : null;
    s.state.titanInbound = null;
    document.getElementById('titanfall').classList.add('hidden');
    const bruin = s.mechs.spawn('bruin', s.player.x + 30, s.player.z, 0);
    const arm = bruin ? s.mechs.arm(bruin).id : null;
    // Theirs: one chassis, then the dice.
    s.mechs.reset();
    document.querySelector('[data-mech="foe:heron"]').click();
    s.spawnWave('reapers', 2);
    const herons = s.mechs.active.map((m) => m.type);
    s.mechs.reset();
    document.querySelector('[data-mech="foe:random"]').click();
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(s.cheats.foeMech());
    s.spawnWave('reapers', 2);
    const randoms = s.mechs.active.map((m) => m.type);
    // Every one of them is drawn, by the mesh of its own chassis.
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    const drawn = s.renderer.actors.mechStats.count;
    const live = s.mechs.active.filter((m) => m.alive).length;
    s.mechs.reset();
    s.cheats.chooseMech('mine', 'warden');
    s.cheats.chooseMech('foe', 'warden');
    return { mineChips: mineChips.length, foeChips: foeChips.length, lit, call: !!call, inbound, arm,
      herons, seen: seen.size, randoms, drawn, live };
  });
  check('the menu offers ten mechs for you and ten and random for them',
    picked.mineChips === 10 && picked.foeChips === 11, `${picked.mineChips} and ${picked.foeChips}`);
  check('the one you pick is the one that is called down',
    picked.lit && picked.call && picked.inbound === 'bruin', `${picked.inbound} inbound`);
  check('and it comes down holding the weapon it was built round', picked.arm === 'leadwall', picked.arm);
  check('theirs come as the chassis you pick',
    picked.herons.length === 2 && picked.herons.every((t) => t === 'heron-foe'), picked.herons.join(', '));
  check('or a different one each time on random',
    picked.seen >= 7 && picked.randoms.every((t) => t === 'reaper' || /-foe$/.test(t)),
    `${picked.seen} kinds in sixty throws`);
  check('and every one on the street is drawn', picked.drawn === picked.live && picked.live > 0,
    `${picked.drawn} of ${picked.live}`);

  // The two rows that were missing: machines and people walking past.
  const kinds = await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset();
    const machines = s.spawnWave('machines', 6);
    const steel = s.soldiers.active.filter((a) => a.machine && !a.civilian).length;
    s.soldiers.reset();
    const civilians = s.spawnWave('civilians', 8);
    const people = s.soldiers.active.filter((a) => a.civilian && !a.machine).length;
    const near = s.soldiers.active.filter((a) => a.civilian
      && Math.hypot(a.x - s.player.x, a.z - s.player.z) <= 61).length;
    const buttons = [...document.querySelectorAll('[data-spawn]')].map((b) => b.dataset.spawn);
    s.soldiers.reset();
    return { machines, steel, civilians, people, near, buttons };
  });
  check('the menu has a row for machines and one for passers by',
    kinds.buttons.includes('machines') && kinds.buttons.includes('civilians'),
    kinds.buttons.join(', '));
  check('and the machines row brings six machines',
    kinds.machines === 6 && kinds.steel === 6, `${kinds.steel} of ${kinds.machines}`);
  check('and the passers by row brings eight people, close enough to see',
    kinds.civilians === 8 && kinds.people === 8 && kinds.near === 8,
    `${kinds.people} people, ${kinds.near} within sixty metres`);

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
  // The memorial was a place a warhead could not be put. It is under a force
  // field now, so it can be, and the field takes it.
  const refused = await page.evaluate(() => {
    const s = window.spreefall;
    const mem = s.combat.sanctuaries[0];
    if (!mem) return { skip: true };
    return {
      onIt: s.dropNuke(mem.x, mem.z) === true,
      name: mem.name,
    };
  });
  check('a warhead can be put on the memorial, and its field takes it', refused.onIt, refused.name);

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
    const fired = s.ion.fire(m.x, m.z);
    s.ion.stop();
    return { memorial: fired === true, name: m.name };
  });
  check('and so can the ion cannon', ionRefused.memorial, ionRefused.name);

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
    s.settleMap();
    const host = document.getElementById('nuketarget');
    const open = !host.classList.contains('hidden');
    const c = document.getElementById('targetmap');
    const r = c.getBoundingClientRect();
    // The map opens on where you are standing, so the middle of it is you.
    // And the scale has to be the same everywhere: a quarter of the canvas is
    // a quarter of what the canvas is showing, whatever the zoom is on.
    const mid = s.targetMap.worldAt(r.left + r.width / 2, r.top + r.height / 2);
    const quarter = s.targetMap.worldAt(r.left + r.width * 0.25, r.top + r.height / 2);
    const edge = s.targetMap.worldAt(r.left, r.top + r.height / 2);
    const shown = Math.abs(mid.x - edge.x) * 2;
    s.closeTargeting();
    return {
      open, closed: host.classList.contains('hidden'),
      midErr: Math.round(Math.hypot(mid.x - s.player.x, mid.z - s.player.z)),
      quarterErr: Math.round(Math.abs((mid.x - quarter.x) / (shown * 0.25) - 1) * 100),
      shown: Math.round(shown),
    };
  });
  // Berlin, on the map of Berlin. Only the district you are standing in has
  // its streets in memory; every other built one is drawn from the sketch in
  // the index, and this counts the pixels inside one of those rectangles to
  // say whether anything was drawn there at all.
  const sketched = await page.evaluate(() => {
    const s = window.spreefall;
    s.openTargeting();
    s.settleMap();
    const c = document.getElementById('targetmap');
    const ctx = c.getContext('2d');
    const built = (s.world.catalogue || []).filter((d) => d.built !== false
      && !s.world.loaded(d.id) && d.sketch);
    if (!built.length) { s.closeTargeting(); return { skip: true }; }
    // The one with the most in its sketch, which is the one a reader would
    // look at first.
    built.sort((a, b) => b.sketch.roads.length - a.sketch.roads.length);
    const d = built[0];
    const r = c.getBoundingClientRect();
    // The district's rectangle in canvas pixels, pulled in a little so the
    // border of the box itself is not counted.
    const corner = (x, z) => {
      const v = s.targetMap._view;
      return {
        px: (c.width / 2 + (x - v.originX) * v.scale),
        py: (c.height / 2 + (z - v.originZ) * v.scale),
      };
    };
    const a = corner(d.bounds.minX, d.bounds.minZ);
    const b = corner(d.bounds.maxX, d.bounds.maxZ);
    const x0 = Math.max(0, Math.min(a.px, b.px) + 3);
    const x1 = Math.min(c.width, Math.max(a.px, b.px) - 3);
    const z0 = Math.max(0, Math.min(a.py, b.py) + 3);
    const z1 = Math.min(c.height, Math.max(a.py, b.py) - 3);
    const w = Math.round(x1 - x0), h = Math.round(z1 - z0);
    if (w < 8 || h < 8) { s.closeTargeting(); return { skip: true }; }
    const data = ctx.getImageData(Math.round(x0), Math.round(z0), w, h).data;
    // The box is filled with a flat dark colour. Anything brighter than that
    // is something the sketch drew.
    let drawn = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 110) drawn++;
    }
    const share = (drawn / (w * h)) * 100;
    s.closeTargeting();
    return {
      skip: false, id: d.id, roads: d.sketch.roads.length,
      share: Number(share.toFixed(2)), w, h,
    };
  });
  check('a district you are not standing in is still drawn as streets',
    !sketched.skip && sketched.share > 1,
    sketched.skip ? 'nothing built outside this district'
      : `${sketched.id}: ${sketched.roads} roads, ${sketched.share}% of its box`);

  const zoomed = await page.evaluate(() => {
    const s = window.spreefall;
    s.openTargeting();
    s.settleMap();
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
    s.settleMap();
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

  // --- ultra plasma ----------------------------------------------------------
  // The four numbers on the map, the arrow they draw, the charge you hear,
  // and then the circle filling with the plasma rifle's balls, as many as
  // were asked for and no more, including more than the slider goes to.
  const ultra = await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.setCheat('godmode', true);
    s.projectiles.clear();
    s.cheatAction('ultra');
    s.settleMap();
    const panel = document.getElementById('ultrapanel');
    const shown = !panel.classList.contains('hidden');
    const rows = [...panel.querySelectorAll('.urow')].map((r) => r.dataset.ultra);
    const slide = (key, v) => {
      const input = panel.querySelector(`.urow[data-ultra=${key}] input[type=range]`);
      input.value = String(v);
      input.dispatchEvent(new Event('input'));
    };
    slide('radius', 90);
    slide('bearing', 90);
    slide('tilt', 40);
    // Past the top of the slider, through the box beside it.
    const box = panel.querySelector('.urow[data-ultra=count] input[type=number]');
    box.value = '4321';
    box.dispatchEvent(new Event('change'));
    const set = { ...s.cheats.ultra };
    const aim = { ...s.targetMap.aim };
    const x = s.player.x + 600, z = s.player.z;
    const armed = s.armNuke(x, z);
    const says = document.getElementById('confirmwhere').textContent;
    // The count goes back down for the rest so the test does not take all day.
    box.value = '260';
    box.dispatchEvent(new Event('change'));
    s.armNuke(x, z);
    const released = s.releaseNuke();
    const closed = panel.classList.contains('hidden');
    const charging = s.ultra.charging;
    // Charging: nothing leaves yet.
    for (let i = 0; i < Math.round(60 * (s.ultraSpec.charge - 0.5)); i++) s.fixedForTest(1 / 60);
    const duringCharge = s.projectiles.active.filter((b) => b.kind === 'ultra').length;
    const again = s.ultra.fire(x, z, s.cheats.ultra);
    // Where each one first reaches the ground; after that it bounces like
    // the rifle's do and may roll out past the edge, which is not the aim.
    let most = 0, landed = 0, spread = 0, n = 0, out = 0;
    const dirs = [];
    const down = new Map();
    for (let i = 0; i < 60 * 14; i++) {
      s.fixedForTest(1 / 60);
      let live = 0;
      for (const b of s.projectiles.active) {
        if (b.kind !== 'ultra') continue;
        live++;
        if (dirs.length < 40 && b.vy < 0) dirs.push({ vx: b.vx, vy: b.vy, vz: b.vz });
        // The pool hands the same body out again; a younger one is a new ball.
        if (down.has(b) && b.age < down.get(b)) down.delete(b);
        if (down.has(b)) { down.set(b, b.age); continue; }
        // Its first bounce, off a street or a roof or a wall, is where it
        // came down; the rifle's balls bounce on from there, and so do these.
        if (b.bouncesLeft < 2) {
          down.set(b, b.age);
          const off = Math.hypot(b.x - x, b.z - z);
          spread = Math.max(spread, off);
          if (off > 95) out++;
          n++;
        }
      }
      most = Math.max(most, live);
    }
    landed = n;
    const sent = 260 - s.ultra.left;
    const done = !s.ultra.active;
    // The way they came: from the east (bearing 90) means travelling west.
    let mx = 0, my = 0, mz = 0;
    for (const d of dirs) { mx += d.vx; my += d.vy; mz += d.vz; }
    const tilt = Math.atan2(Math.hypot(mx, mz), -my) * 180 / Math.PI;
    s.projectiles.clear();
    s.cheats.reset();
    return { shown, rows, set, aim, armed, says, released, closed, charging, duringCharge,
      again, most, landed, out, spread: Math.round(spread), sent, done,
      west: mx < 0 && Math.abs(mz) < Math.abs(mx) * 0.3, tilt: Math.round(tilt),
      maxLive: s.ultraSpec.maxLive };
  });
  check('ultra plasma opens the map with its four numbers',
    ultra.shown && ['count', 'radius', 'bearing', 'tilt'].every((k) => ultra.rows.includes(k)),
    ultra.rows.join(', '));
  check('and the count takes more than the slider goes to', ultra.set.count === 4321,
    `${ultra.set.count}`);
  check('the radius, bearing and angle go onto the map',
    ultra.aim.radius === 90 && ultra.aim.bearing === 90 && ultra.aim.tilt === 40,
    JSON.stringify(ultra.aim));
  check('and into the question before it fires', ultra.armed && /4321 plasma balls over 90 m/.test(ultra.says),
    ultra.says);
  check('firing closes the map and starts the charge', ultra.released && ultra.closed && ultra.charging);
  check('nothing comes down while it charges', ultra.duringCharge === 0);
  check('and it will not fire a second time on top', ultra.again === false);
  check('then exactly as many as were asked for come down', ultra.sent === 260 && ultra.done,
    `${ultra.sent} sent`);
  // A ball coming in at forty degrees meets a roof before the street: one
  // aimed at the far side of a thirty metre block lands on its near edge,
  // twenty five metres short, which is the circle seen from where it comes.
  // How many do depends on what is standing there: about one in ten in an
  // untouched street, more where a ruin from an earlier check still stands.
  check('they first come down inside the circle', ultra.landed > 200
    && ultra.out <= ultra.landed * 0.15 && ultra.spread <= 90 + 30 * Math.tan(40 * Math.PI / 180) + 5,
    `${ultra.landed} landed, ${ultra.out} past the edge, ${ultra.spread} m out at most`);
  check('from the side and at the angle that was set', ultra.west && Math.abs(ultra.tilt - 40) < 4,
    `${ultra.tilt} degrees`);
  check('never more in the air than the pool can carry', ultra.most <= ultra.maxLive,
    `${ultra.most} at once`);

  // Blast plasma, from the switch on the same panel.
  const blastRain = await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.setCheat('godmode', true);
    s.projectiles.clear();
    s.cheatAction('ultra');
    s.settleMap();
    const toggle = document.getElementById('ultrablast');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const on = s.cheats.ultra.blast;
    const box = document.querySelector('.urow[data-ultra=count] input[type=number]');
    box.value = '40';
    box.dispatchEvent(new Event('change'));
    const x = s.player.x + 600, z = s.player.z;
    s.armNuke(x, z);
    s.releaseNuke();
    const kinds = {};
    let damage = 0, bounces = 0;
    s.projectiles.onBounce = (b) => { if (b.kind === 'ultraBlast') bounces++; };
    for (let i = 0; i < 60 * 14; i++) {
      s.fixedForTest(1 / 60);
      for (const b of s.projectiles.active) {
        kinds[b.kind] = (kinds[b.kind] || 0) + 1;
        if (b.kind === 'ultraBlast') damage = b.splash.damage;
      }
    }
    s.projectiles.onBounce = null;
    s.projectiles.clear();
    s.cheats.setUltra('blast', false);
    s.cheats.reset();
    return { on, kinds, damage, bounces };
  });
  check('blast plasma is a switch on the ultra plasma map, and it rains orange',
    blastRain.on && blastRain.kinds.ultraBlast > 0 && !blastRain.kinds.ultra,
    JSON.stringify(blastRain.kinds));
  check('at ten times the harm, with no bounce', blastRain.damage === 800 && blastRain.bounces === 0,
    `${blastRain.damage} damage, ${blastRain.bounces} bounces`);

  // --- the void storm ------------------------------------------------------
  const voidStorm = await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.setCheat('godmode', true);
    s.projectiles.clear();
    s.soldiers.reset();
    const ultraCount = s.cheats.ultra.count;
    s.cheatAction('storm');
    s.settleMap();
    const panel = document.getElementById('ultrapanel');
    const shown = !panel.classList.contains('hidden');
    const toggleHidden = document.getElementById('ultrablast').closest('label').classList.contains('hidden');
    const label = panel.querySelector('.urow[data-ultra=count] b').textContent;
    const box = document.querySelector('.urow[data-ultra=count] input[type=number]');
    box.value = '12';
    box.dispatchEvent(new Event('change'));
    const radius = document.querySelector('.urow[data-ultra=radius] input[type=range]');
    radius.value = '40';
    radius.dispatchEvent(new Event('input'));
    const x = s.player.x + 420, z = s.player.z;
    const ground = s.world.groundHeight(x, z);
    const crowd = [];
    for (let i = 0; i < 4; i++) crowd.push(s.spawnSoldier(420 + (i - 1.5) * 8, 6));
    s.armNuke(x, z);
    const fired = s.releaseNuke();
    const kinds = {};
    let most = 0, carried = 0;
    const launch = s.projectiles.launch.bind(s.projectiles);
    let launched = 0;
    s.projectiles.launch = (kind, o) => { if (kind === 'voidStorm') launched++; return launch(kind, o); };
    for (let i = 0; i < 60 * 22; i++) {
      s.fixedForTest(1 / 60);
      let n = 0;
      for (const b of s.projectiles.active) {
        kinds[b.kind] = (kinds[b.kind] || 0) + 1;
        if (b.kind === 'voidStorm') { n++; if (b.void && b.void.reach === s.stormSpec.void.reach) carried++; }
      }
      most = Math.max(most, n);
    }
    s.projectiles.launch = launch;
    const dead = crowd.filter((c) => c.state === 5).length;
    const left = s.projectiles.active.filter((b) => b.kind === 'voidStorm').length;
    s.projectiles.clear();
    s.soldiers.reset();
    const out = { shown, toggleHidden, label, fired, kinds, most, carried, launched, dead, left,
      count: s.cheats.storm.count, radius: s.cheats.storm.radius, ultraCount: s.cheats.ultra.count,
      ultraBefore: ultraCount, active: s.storm.active, ground: Math.round(ground) };
    s.cheats.reset();
    return out;
  });
  check('the void storm opens the same panel, with its own numbers and no blast switch',
    voidStorm.shown && voidStorm.toggleHidden && voidStorm.label === 'Void balls'
      && voidStorm.count === 12 && voidStorm.radius === 40 && voidStorm.ultraCount === voidStorm.ultraBefore,
    `${voidStorm.label}, ${voidStorm.count} over ${voidStorm.radius} m, ultra plasma still ${voidStorm.ultraCount}`);
  check('it fires, and rains the void cannon\'s ball and nothing else',
    voidStorm.fired && voidStorm.kinds.voidStorm > 0 && !voidStorm.kinds.ultra && !voidStorm.kinds.void,
    JSON.stringify(voidStorm.kinds));
  check('every one of them, carrying the cannon\'s reach', voidStorm.launched === 12 && voidStorm.carried > 0
    && voidStorm.left === 0 && !voidStorm.active,
    `${voidStorm.launched} sent, ${voidStorm.left} still up`);
  check('and it takes the people standing under it', voidStorm.dead === 4,
    `${voidStorm.dead} of 4`);
  check('never more in the air than it allows', voidStorm.most <= 48, `${voidStorm.most} at once`);

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
    s.settleMap();
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
    s.teleport(81, 0); s.look(90, -3);
    s.cheats.setUltra('count', 1500);
    s.cheats.setUltra('radius', 150);
    s.cheats.setUltra('bearing', 250);
    s.cheats.setUltra('tilt', 30);
    s.cheatAction('ultra');
    s.settleMap();
    s.armNuke(s.player.x + 330, s.player.z);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'cheat-05-ultra-map.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    s.setCheat('godmode', true);
    s.releaseNuke();
    s.closeTargeting();
    s.look(268, 14); s.setTime(16.4);
    s.state.flash = 0;
    for (let i = 0; i < 60 * (s.ultraSpec.charge + 5.5); i++) s.fixedForTest(1 / 60);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'cheat-06-ultra-rain.png') });
  await page.evaluate(() => {
    const s = window.spreefall;
    s.ultra.reset(); s.projectiles.clear(); s.cheats.reset();
  });

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

  // --- crazy reality: the glass gets dirty ---------------------------------------
  const grime = await page.evaluate(async () => {
    const s = window.spreefall;
    const frames = (n) => new Promise((done) => {
      let i = 0;
      const step = () => (++i >= n ? done() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });
    s.cheats.reset(); s.gibs.clear(); s.effects.clear(); s.soldiers.reset(); s.projectiles.clear();
    s.teleport(81, 0); s.look(90, -2);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const out = {};
    // Off: a blast beside you leaves the glass clean.
    s.explode(s.player.x - 14, s.player.y + 1, s.player.z - 3, { radius: 8, damage: 0 }, { weapon: 'rpg' });
    await frames(3);
    out.off = s.grime.dirt.total;
    s.setCheat('crazyReality', true);
    s.setCheat('godmode', true);
    s.explode(s.player.x - 14, s.player.y + 1, s.player.z - 3, { radius: 8, damage: 0 }, { weapon: 'rpg' });
    s.combat.hurt(20, s.player.x + 10, s.player.z, s.player.x, s.player.z);
    // Fire at your feet.
    s.burningGround.push({ x: s.player.x + 2, y: s.player.y, z: s.player.z, radius: 4, left: 3, damagePerSecond: 0 });
    await frames(40);
    s.burningGround.length = 0;
    const d = s.grime.dirt;
    out.dust = +d.dust.toFixed(2); out.blood = +d.blood.toFixed(2); out.soot = +d.soot.toFixed(2);
    out.shown = !document.getElementById('grime').classList.contains('hidden');
    out.splats = s.grime.splats.length;
    s.setCheat('godmode', false);
    return out;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, 'cheat-09-crazy-reality.png') });
  const cleared = await page.evaluate(async () => {
    const s = window.spreefall;
    // A quarter of a minute and more: it has cleared by itself.
    s.grime.draw(40, true);
    const later = s.grime.dirt.total;
    const hidden = document.getElementById('grime').classList.contains('hidden');
    s.setCheat('crazyReality', false);
    return { later, hidden };
  });
  check('crazy reality off leaves the glass clean', grime.off === 0, JSON.stringify(grime));
  check('on, a blast beside you throws dust on it, a hit puts blood on it and fire puts soot on it',
    grime.dust > 0.5 && grime.blood > 0.3 && grime.soot > 0.1 && grime.shown, JSON.stringify(grime));
  check('and it clears by itself', cleared.later === 0 && cleared.hidden, JSON.stringify(cleared));
  check('and one blast beside you and one hit cover the glass with it, not a few specks',
    grime.splats >= 40, `${grime.splats} splats`);

  // In a mech the glass is the canopy: the frame and the dashboard under it
  // are not, and nothing lands on them.
  const mechGrime = await page.evaluate(async () => {
    const s = window.spreefall;
    const frames = (n) => new Promise((done) => {
      let i = 0;
      const step = () => (++i >= n ? done() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });
    s.mechs.reset();
    s.teleport(81, 0);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const mine = s.spawnMech('titan', 12);
    if (!mine) return { skip: true, why: 'no room for one' };
    s.teleport(mine.x + 3, mine.z);
    s.toggleVehicle();
    if (s.state.inMech !== mine) return { skip: true, why: 'could not get in' };
    if (!s.state.cockpit) s.toggleCockpit();
    s.setCheat('godmode', true);
    s.setCheat('crazyReality', true);
    s.look(mine.torso * 180 / Math.PI, -2);
    for (let i = 0; i < 4; i++) s.grime.dust(1, i % 2 ? -1 : 1);
    for (let i = 0; i < 4; i++) s.grime.blood(1, 0);
    await frames(6);
    const c = document.getElementById('grime');
    const ctx = c.getContext('2d');
    const band = (y0, y1) => {
      const y = Math.round(c.height * y0), h = Math.max(1, Math.round(c.height * (y1 - y0)));
      const d = ctx.getImageData(Math.round(c.width * 0.2), y, Math.round(c.width * 0.6), h).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit++;
      return lit / (d.length / 4);
    };
    return { skip: false, cockpit: !document.getElementById('cockpithud').classList.contains('hidden'),
      glass: +band(0.3, 0.7).toFixed(3), dash: +band(0.8, 0.98).toFixed(3) };
  });
  if (!mechGrime.skip) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'cheat-10-mech-grime.png') });
  }
  check('in a mech it lands on the canopy and not on the dashboard under it',
    !mechGrime.skip && mechGrime.cockpit && mechGrime.glass > 0.05 && mechGrime.dash === 0, JSON.stringify(mechGrime));
  await page.evaluate(() => {
    const s = window.spreefall;
    s.grime.clear();
    s.setCheat('crazyReality', false);
    s.setCheat('godmode', false);
    if (s.state.inMech) s.leaveMech();
    s.mechs.reset();
  });

  // --- One Man Army and Nightmare --------------------------------------------------
  // Wave after wave, each worse than the last; and with Nightmare the city's
  // super weapons come down near you as well.
  const oma = await page.evaluate(() => {
    const s = window.spreefall;
    s.teleport(81, 0); s.look(90, -2);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const out = { chassis: s.foeChassis.length };
    s.setCheat('godmode', true);
    s.setCheat('oneManArmy', true);
    // Nothing at once: the first wave comes on its clock.
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    out.early = s.onslaught.level;
    s.onslaught.clock = 0.01;
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    out.w1 = s.state.onslaughtLast;
    s.onslaught.level = 5; s.onslaught.clock = 0.01;
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    out.w6 = s.state.onslaughtLast;
    out.bombs = s.projectiles.active.filter((p) => p.weapon === 'bomb').length;
    out.mechs = s.mechs.active.filter((m) => m.alive && !m.mine).length;
    out.toast = document.getElementById('toast') ? document.getElementById('toast').textContent : '';
    return out;
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(SHOTS, 'cheat-11-one-man-army.png') });
  check('One Man Army: nothing at once, then a squad, and by the sixth wave jeeps and a tank, mechs, bombs and a jet',
    oma.early === 0 && oma.w1 && oma.w1.level === 1 && oma.w1.soldiers > 0 && !oma.w1.mechs
      && oma.w6.level === 6 && oma.w6.convoy && oma.w6.mechs >= 1 && oma.mechs >= 1 && oma.w6.bombs > 0 && oma.bombs > 0
      && oma.w6.jets >= 1 && oma.w6.soldiers + oma.w6.machines > oma.w1.soldiers,
    JSON.stringify(oma));
  const nightmare = await page.evaluate(() => {
    const s = window.spreefall;
    s.setCheat('nightmare', true);
    s.soldiers.reset(); s.mechs.reset();
    s.onslaught.level = 2; s.onslaught.supers = 0; s.onslaught.clock = 0.01;
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    const ion = s.state.onslaughtLast.superweapon;
    const out = { ion, firing: s.ion.firing };
    // Ultra plasma with a squad of theirs 60 m east of you: it still comes
    // down on you, but on the side away from them.
    s.soldiers.reset(); s.mechs.reset();
    const squad = [];
    for (const [dx, dz] of [[60, 0], [62, 5], [58, -4], [64, -2]]) {
      const g = s.spawnSoldier(dx, dz);
      if (g) { g.state = 0; g.rise = 0; squad.push(g); }
    }
    out.squad = squad.length;
    s.onslaught.level = 4; s.onslaught.supers = 1; s.onslaught.clock = 0.01;
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    out.ultra = s.state.onslaughtLast.superweapon;
    if (out.ultra) out.ultraWest = out.ultra.x < s.player.x;
    s.ultra.reset && s.ultra.reset();
    // Look at the warhead.
    s.onslaught.level = 9; s.onslaught.supers = 3; s.onslaught.clock = 0.01;
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    out.nuke = s.state.onslaughtLast.superweapon;
    out.falling = s.projectiles.active.filter((p) => p.kind === 'nuke').length;
    s.look(90, 30);
    return out;
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'cheat-12-nightmare.png') });
  const N = { ion: 90, ultra: 30, nuke: 70 };
  check('Nightmare: the ion cannon and a warhead come down on you, not off somewhere',
    nightmare.ion && nightmare.ion.kind === 'ion' && nightmare.firing && nightmare.ion.away <= N.ion + 1
      && nightmare.nuke && nightmare.nuke.kind === 'nuke' && nightmare.falling === 1 && nightmare.nuke.away <= N.nuke + 1,
    JSON.stringify({ ion: nightmare.ion, nuke: nightmare.nuke, falling: nightmare.falling }));
  check('and moves off you only to spare its own: ultra plasma with a squad of theirs to the east lands west of you, with none of them in it',
    nightmare.squad >= 3 && nightmare.ultra && nightmare.ultra.kind === 'ultra' && nightmare.ultraWest
      && nightmare.ultra.theirs === 0 && nightmare.ultra.away <= N.ultra + 1,
    JSON.stringify({ squad: nightmare.squad, ultra: nightmare.ultra }));
  await page.evaluate(() => {
    const s = window.spreefall;
    s.setCheat('nightmare', false);
    s.setCheat('oneManArmy', false);
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    s.setCheat('godmode', false);
    s.mechs.reset();
  });

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
