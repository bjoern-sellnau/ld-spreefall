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
  // --- the gun, and where its shot comes from ------------------------------
  const gun = await page.evaluate(async () => {
    const s = window.spreefall;
    const m = s.soldiers.active.find((x) => x.machine) || s.makeMachine(
      s.soldiers.spawnNear(s.player.x + 14, s.player.z, 0.5, 1.5));
    if (!m) return { skip: true };
    m.yaw = 1.1;
    s.effects.clear();
    s.soldiers.onBeam(m, 0);
    const live = s.effects.pool.filter((p) => p.alive);
    const lines = live.filter((p) => p.kind === 0);
    const columns = live.filter((p) => p.kind === 5);
    const l = lines[0];
    const muzzle = s.machineMuzzle(m);
    return {
      lines: lines.length,
      columns: columns.length,
      fromGun: l ? Math.round(Math.hypot(l.ax - muzzle.x, l.ay - muzzle.y, l.az - muzzle.z) * 100) / 100 : -1,
      startHeight: l ? Math.round((l.ay - m.y) * 100) / 100 : -1,
      endsAtCamera: l
        ? Math.round(Math.hypot(l.bx - s.camera.position[0], l.by - s.camera.position[1],
          l.bz - s.camera.position[2]) * 100) / 100
        : -1,
      offCentre: Math.round(Math.hypot(muzzle.x - m.x, muzzle.z - m.z) * 100) / 100,
      // And on the side it is facing, which is the half of this that a
      // distance cannot tell you: a muzzle in its back is exactly as far from
      // the middle as one in its hands.
      ahead: Math.round(((muzzle.x - m.x) * -Math.sin(m.yaw)
        + (muzzle.z - m.z) * -Math.cos(m.yaw)) * 100) / 100,
    };
  });
  check('a machine shoots a line from its gun, not a column from the sky',
    !gun.skip && gun.lines === 1 && gun.columns === 0 && gun.fromGun < 0.01,
    `${gun.lines} line, ${gun.columns} columns, ${gun.fromGun} m from the muzzle`);
  check('and the shot starts at the end of the barrel',
    !gun.skip && gun.ahead > 0.6 && gun.startHeight > 0.9 && gun.startHeight < 1.5
      && gun.endsAtCamera < 0.01,
    `${gun.ahead} m in front of it, ${gun.startHeight} m up, ending at the eye`);

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

  // --- you cannot see through the city ------------------------------------
  // A wall and a street are single surfaces with no thickness. Take a bite
  // out of one and the back of the next surface faces you, and a culled back
  // face is a hole through the world: sky where the inside of a ruin should
  // be. This counts sky coloured pixels in the band below the horizon, with
  // the second pass off and then on.
  const seeThrough = await page.evaluate(async () => {
    const s = window.spreefall;
    // Read the frame out of the context itself, in a callback registered
    // after the loop's own, so this runs once the frame has been drawn and
    // before the browser composites it away. Reading the canvas element any
    // other way gets an empty buffer, because nothing here asks for the
    // drawing buffer to be preserved.
    // Read the frame out of the context itself, in a callback registered
    // after the loop's own, so this runs once the frame has been drawn and
    // before the browser composites it away. Reading the canvas element any
    // other way gets an empty buffer, because nothing here asks for the
    // drawing buffer to be preserved.
    const grabNow = () => {
      const gl = s.renderer.gl;
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return buf;
    };
    s.demolition.reset();
    s.renderer.scarredTiles.clear();
    s.setCheat('godmode', true);
    s.setTime(13);
    // A bite out of the frontage down the street, then stand back and look in.
    s.teleport(0, 0);
    s.look(90, -4);
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    const f = s.camera.forward;
    const x = s.player.x + f[0] * 70, z = s.player.z + f[2] * 70;
    s.demolition.blast(x, s.world.groundHeight(x, z), z, 46, 3400);
    for (let i = 0; i < 60 * 5; i++) s.fixedForTest(1 / 60);
    s.teleport(x - f[0] * 26, z - f[2] * 26);
    // Wait for the dust to settle, literally: smoke and sparks are bright and
    // they drift, and two frames taken while they are still up differ for
    // reasons that have nothing to do with what is being measured.
    s.effects.clear();
    s.gibs.clear();
    for (let i = 0; i < 40 && s.effects.list.length; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      s.effects.clear();
    }
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
    const armed = s.renderer.scarredTiles.size;
    // Nothing may move between the two frames, or this measures the city
    // rather than the pass.
    s.soldiers.enabled = false;
    s.drones.active.length = 0;
    // Both frames inside one animation frame, drawn back to back from the
    // same state: the simulation does not advance between them, so anything
    // that differs is the pass and nothing else.
    const pair = await new Promise((resolve) => requestAnimationFrame(() => {
      const kept = [...s.renderer.scarredTiles];
      s.loop.onRender(1, 0);
      const a = grabNow();
      s.renderer.scarredTiles.clear();
      s.loop.onRender(1, 0);
      const b = grabNow();
      for (const i of kept) s.renderer.scarredTiles.add(i);
      resolve([a, b]);
    }));
    const on = pair[0], off = pair[1];
    s.soldiers.enabled = true;
    // How much sky is showing through the city, in each of the two frames.
    // Sky is the one thing that cannot legitimately be behind a wall, so
    // counting it is counting the holes. The same frame twice, so leaves
    // moving in the wind and the clock ticking cancel out.
    // What the pass did to the picture. Every pixel it touches is a hole it
    // filled, so every pixel it touches must be darker than it was.
    let changed = 0, darker = 0;
    for (let i = 0; i < on.length; i += 4) {
      const a = on[i] + on[i + 1] + on[i + 2];
      const b = off[i] + off[i + 1] + off[i + 2];
      if (Math.abs(a - b) < 24) continue;
      changed++;
      if (a < b) darker++;
    }
    return { armed, changed, darker };
  });
  check('a bite out of the city is dark inside rather than see through',
    seeThrough.armed > 0 && seeThrough.changed > 300
      && seeThrough.darker === seeThrough.changed,
    `${seeThrough.changed} pixels filled, all ${seeThrough.darker} of them darker`);

  // --- mechs ---------------------------------------------------------------
  const mech = await page.evaluate(async () => {
    const s = window.spreefall;
    s.mechs.reset();
    // The suite has been shot at for a while by now and a Reaper hits hard;
    // this is about the mechs, not about whether the run survives them.
    s.setCheat('godmode', true);
    s.combat.health = 100;
    const mine = s.spawnMech('titan', 12);
    const theirs = s.spawnMech('reaper', 70);
    if (!mine || !theirs) return { skip: true };
    // Theirs walks at you rather than standing where it was put.
    const was = Math.hypot(theirs.x - s.player.x, theirs.z - s.player.z);
    for (let i = 0; i < 60 * 10; i++) s.fixedForTest(1 / 60);
    const now = Math.hypot(theirs.x - s.player.x, theirs.z - s.player.z);
    // And it walks on its feet: never in the air, never under the road.
    let worstGap = 0;
    for (let i = 0; i < 60 * 2; i++) {
      s.fixedForTest(1 / 60);
      worstGap = Math.max(worstGap, Math.abs(theirs.y - s.world.groundHeight(theirs.x, theirs.z)));
    }
    return {
      closed: Math.round(was - now),
      away: Math.round(now),
      worstGap: Number(worstGap.toFixed(2)),
      health: theirs.health,
      hurt: s.combat.health < 100,
    };
  });
  check('a mech of theirs walks in on you',
    !mech.skip && mech.worstGap < 0.6
      && (mech.closed > 12 || mech.away < 50),
    mech.skip ? 'no room for one'
      : `closed ${mech.closed} m to ${mech.away} m, feet ${mech.worstGap} m off the ground`);

  const piloted = await page.evaluate(async () => {
    const s = window.spreefall;
    const mine = s.mechs.active.find((m) => m.mine);
    const theirs = s.mechs.active.find((m) => !m.mine);
    if (!mine || !theirs) return { skip: true };
    s.teleport(mine.x + 3, mine.z);
    s.toggleVehicle();
    const inIt = s.state.inMech === mine;
    // Walk it, looking the way it is already facing.
    s.look(mine.torso * 180 / Math.PI, 0);
    const was = { x: mine.x, z: mine.z };
    s.input.keys.add('KeyW');
    for (let i = 0; i < 90; i++) s.fixedForTest(1 / 60);
    s.input.keys.delete('KeyW');
    const walked = Math.hypot(mine.x - was.x, mine.z - was.z);
    // Then put the chaingun on the other one, which is stood in the open at a
    // known distance so that this measures the gun rather than the street.
    theirs.x = mine.x - Math.sin(mine.torso) * 40;
    theirs.z = mine.z - Math.cos(mine.torso) * 40;
    theirs.y = s.world.groundHeight(theirs.x, theirs.z);
    theirs.health = theirs.maxHealth;
    const yaw = Math.atan2(-(theirs.x - mine.x), -(theirs.z - mine.z));
    s.look(yaw * 180 / Math.PI, 0);
    const hp0 = theirs.health;
    s.input.fire = true;
    for (let i = 0; i < 60 * 4; i++) {
      // Nailed to the spot, so this measures the gun rather than whether the
      // other one happened to sidestep out of the line.
      theirs.x = mine.x - Math.sin(mine.torso) * 40;
      theirs.z = mine.z - Math.cos(mine.torso) * 40;
      s.fixedForTest(1 / 60);
    }
    s.input.fire = false;
    const hp1 = theirs.health;
    // And a salvo of rockets out of the pod.
    const before = s.projectiles.active.length;
    s.input.secondary = true;
    for (let i = 0; i < 40; i++) s.fixedForTest(1 / 60);
    s.input.secondary = false;
    const rockets = s.projectiles.active.length - before;
    const out = { inIt, walked: Math.round(walked), hp0, hp1, rockets, torso: 0 };
    // The torso goes where you look and the legs follow it rather than leading.
    s.look((yaw + 1.2) * 180 / Math.PI, 0);
    const legsWere = mine.yaw;
    s.fixedForTest(1 / 60);
    out.torsoSnap = Math.abs(mine.torso - s.camera.yaw) < 0.01;
    out.legsLag = Math.abs(mine.yaw - legsWere) < 0.1;
    s.toggleVehicle();
    out.outAgain = s.state.inMech === null;
    return out;
  });
  check('and you can climb into one of your own',
    !piloted.skip && piloted.inIt && piloted.walked > 10,
    piloted.skip ? '' : `${piloted.walked} m of walking`);
  check('its chaingun takes a mech apart',
    !piloted.skip && piloted.hp1 < piloted.hp0 - 300,
    piloted.skip ? '' : `${piloted.hp0} to ${piloted.hp1}`);
  check('and the pod throws a salvo rather than one rocket',
    !piloted.skip && piloted.rockets >= 3, `${piloted.rockets} in the air`);
  check('the torso goes where you look and the legs follow',
    !piloted.skip && piloted.torsoSnap && piloted.legsLag && piloted.outAgain);

  const stomp = await page.evaluate(async () => {
    const s = window.spreefall;
    const mine = s.mechs.active.find((m) => m.mine);
    if (!mine) return { skip: true };
    s.demolition.reset();
    s.teleport(mine.x + 3, mine.z);
    s.toggleVehicle();
    const hp = s.combat.health;
    const floor = s.world.groundHeight(mine.x, mine.z);
    s.input.jumpHeld = true;
    for (let i = 0; i < 8; i++) s.fixedForTest(1 / 60);
    s.input.jumpHeld = false;
    let peak = mine.y;
    for (let i = 0; i < 200; i++) { s.fixedForTest(1 / 60); peak = Math.max(peak, mine.y); }
    const out = {
      jumped: Number((peak - floor).toFixed(1)),
      sites: s.demolition.sites.length + s.demolition.baked,
      pilotHurt: s.combat.health < hp,
    };
    s.toggleVehicle();
    return out;
  });
  check('it jumps, and the landing opens the road',
    !stomp.skip && stomp.jumped > 2 && stomp.sites > 0,
    stomp.skip ? '' : `${stomp.jumped} m up, ${stomp.sites} places came apart underneath`);
  check('and the pilot inside the armour is fine', !stomp.skip && !stomp.pilotHurt);

  await page.evaluate(async () => {
    const s = window.spreefall;
    const mine = s.mechs.active.find((m) => m.mine);
    if (mine) { s.teleport(mine.x + 4, mine.z); s.look(mine.torso * 180 / Math.PI + 160, -6); }
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  await page.screenshot({ path: path.join(SHOTS, 'mech-03-pair.png') });

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
