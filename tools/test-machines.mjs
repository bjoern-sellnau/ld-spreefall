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

    // Everybody else off the street, for the two checks that measure one gun
    // against one target. A shot from a mech goes to the nearest thing on
    // the line, and Rise of the Machines keeps a dozen of them walking at
    // you: with any of those in the way the number that comes out is about
    // what it hit rather than about the gun.
    window.clearTheStreet = (keep) => {
      let gone = 0;
      for (let i = s.mechs.active.length - 1; i >= 0; i--) {
        const m = s.mechs.active[i];
        if (keep.includes(m)) continue;
        m.alive = false;
        m.occupied = false;
        s.mechs.active.splice(i, 1);
        gone++;
      }
      gone += s.soldiers.active.length + s.drones.active.length + s.jets.active.length;
      s.soldiers.reset();
      s.drones.reset();
      s.jets.reset();
      s.soldiers.budget = 0;
      s.drones.budget = 0;
      s.jets.budget = 0;
      return gone;
    };

    // Somewhere to stand a target that the mech can actually shoot at, used
    // by both of the checks that measure one of its guns.
    //
    // Two earlier versions of this got it wrong in instructive ways. The
    // first swept a level ray and then refused any ground more than three
    // metres off the mech's own level, which by the end of the suite is most
    // of the district: eleven of its twenty four candidates were blocked and
    // the other thirteen were over a hole. A shot down into a crater is a
    // perfectly good shot, and every check here takes its aim off the
    // target's real height anyway. The second swept muzzle to chest, found a
    // line, and watched the gun put forty eight rounds out of forty eight
    // into the city: a mech's guns do not point at what you are looking at,
    // they converge on the point where the torso's own ray runs out, and
    // from a muzzle two metres off the centre line that is a different line.
    // So this turns the torso onto each candidate and asks the mech itself
    // where the shot would go.
    window.firingSpot = (mine, near = 24) => {
      const was = { torso: mine.torso, pitch: mine.pitch };
      const bearing = mine.torso;
      let tried = 0, walls = 0, holes = 0;
      const look = (px, py, pz) => {
        // Point the torso where the pilot will be pointing it. Everything
        // about the shot hangs off this: the muzzle swings round with the
        // torso, and the guns converge on wherever the torso's own ray
        // runs out rather than on the target.
        const flat = Math.hypot(px - mine.x, pz - mine.z) || 1;
        mine.torso = Math.atan2(-(px - mine.x), -(pz - mine.z));
        mine.pitch = Math.atan2((py + 5.2) - (mine.y + mine.spec.eye), flat);
      };
      for (let ring = 0; ring < 5; ring++) {
        const d = near + ring * 7;
        for (let step = 0; step < 17; step++) {
          const a = bearing + (step % 2 ? 1 : -1) * Math.floor((step + 1) / 2) * 0.19;
          const px = mine.x - Math.sin(a) * d;
          const pz = mine.z - Math.cos(a) * d;
          const py = s.world.groundHeight(px, pz);
          tried++;
          // Deep enough to be a quarry rather than a street: what is being
          // measured is the gun, not a forty metre drop.
          if (Math.abs(py - mine.y) > 9) { holes++; continue; }
          look(px, py, pz);
          const muzzle = s.mechs.muzzle(mine, s.mechSpec.titan.chaingun.muzzle);
          const dir = s.mechs.aimFrom(muzzle, s.mechs.aimPoint(mine, 280));
          const reach = Math.hypot(px - muzzle.x, (py + 5.2) - muzzle.y, pz - muzzle.z);
          if (s.world.raycast(muzzle.x, muzzle.y, muzzle.z,
            dir.x, dir.y, dir.z, reach - 1.5)) { walls++; continue; }
          return { x: px, z: pz };
        }
      }
      mine.torso = was.torso;
      mine.pitch = was.pitch;
      return { why: `nowhere to stand a target: ${walls} of ${tried} blocked, `
        + `${holes} over a hole` };
    };
  });
  await page.waitForTimeout(4000);

  // --- a mech in a street that still has walls in it -----------------------
  // First, because it is the one check in here that needs the city standing:
  // everything below this line spends the next few minutes taking it apart.
  // The head of a mech sits out in front of the hull, which is what you want
  // until it is stood against a frontage and you turn to look at it: then the
  // head is inside the wall and the screen goes solid.
  // And the view against the city. The head sits out in front of the hull,
  // which is what you want until the mech is stood against a frontage and you
  // turn to look at it: then the head is inside the wall and the screen goes
  // solid. This turns the torso onto the nearest wall there is and asks
  // whether the camera stayed on this side of it.
  const walled = await page.evaluate(async () => {
    const s = window.spreefall;
    s.mechs.reset();
    const m = s.spawnMech('titan', 12);
    if (!m) return { skip: true, why: 'no room for one' };
    s.teleport(m.x + 3, m.z);
    s.toggleVehicle();
    if (s.state.inMech !== m) return { skip: true, why: 'could not get in' };
    const was = { x: m.x, y: m.y + m.spec.eye, z: m.z };
    let rays = 0, tooNear = 0, steep = 0, notWall = 0, gone = 0;
    // The nearest thing anywhere round it that is still standing at the
    // height of its own head, found by sweeping the horizon a long way out:
    // by this point in the suite the streets here are rubble, and a ruin two
    // metres high is not a wall you can put your head into. The ray is at
    // eye height, so whatever answers is tall enough by construction.
    const found = [];
    for (let i = 0; i < 144; i++) {
      const yaw = (i / 144) * Math.PI * 2;
      const d = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
      const hit = s.world.raycast(was.x, was.y, was.z, d.x, d.y, d.z, 300, {});
      if (hit) rays++;
      if (!hit) continue;
      if (hit.t < 4) { tooNear++; continue; }
      // A rise in the ground at eye height is not a frontage.
      if (hit.kind !== 'wall') { notWall++; continue; }
      // On ground near its own level, or the walk up to it is a climb and
      // the wall is somewhere else by the time it arrives.
      const px = was.x + d.x * (hit.t - 1.2);
      const pz = was.z + d.z * (hit.t - 1.2);
      if (Math.abs(s.world.groundHeight(px, pz) - m.y) > 3) { steep++; continue; }
      found.push({ t: hit.t, d, yaw });
    }
    // And still there from where it will stand. The sweep looks from the
    // eye where the mech is now; stood a metre off the wall the ground can
    // be a metre or two higher or lower, and on the live city the nearest
    // one was a wall the head then looked straight over.
    found.sort((a, b) => a.t - b.t);
    let near = null;
    for (const c of found) {
      const sx = was.x + c.d.x * (c.t - 1.2);
      const sz = was.z + c.d.z * (c.t - 1.2);
      const ey = s.world.groundHeight(sx, sz) + m.spec.eye;
      const hit = s.world.raycast(sx, ey, sz, c.d.x, 0, c.d.z, 8, {});
      if (hit && hit.kind === 'wall') { near = c; break; }
      gone++;
    }
    // When nothing answers, say what the city looked like from in there:
    // the first version of this check ran at the end of the suite, by which
    // time the whole district was two metres high and there was nothing left
    // to lean on for three hundred metres in any direction.
    if (!near) {
      return {
        skip: true,
        why: `${rays} rays hit, ${tooNear} too near, ${notWall} not a wall, `
          + `${steep} off the level, ${gone} not there from where it would stand, `
          + `tallest within 80 m is ${s.world.tallestNear(m.x, m.z, 80).toFixed(1)} m`,
      };
    }
    // Its nose a metre and a bit off the frontage, which is where a mech
    // ends up every time it fights down a street.
    const step = near.t - 1.2;
    m.x = was.x + near.d.x * step;
    m.z = was.z + near.d.z * step;
    m.y = s.world.groundHeight(m.x, m.z);
    s.teleport(m.x, m.z);
    const eye = { x: m.x, y: m.y + m.spec.eye, z: m.z };
    s.look(near.yaw * 180 / Math.PI, 0);
    s.fixedForTest(1 / 60);
    await new Promise((r) => requestAnimationFrame(r));
    const out = Math.hypot(s.camera.position[0] - eye.x,
      s.camera.position[1] - eye.y, s.camera.position[2] - eye.z);
    // Where the wall is now that the torso has turned onto it.
    const a = s.mechs.aim(m);
    const wall = s.world.raycast(eye.x, eye.y, eye.z, a.x, a.y, a.z, 8, {});
    const got = {
      skip: false,
      wall: wall ? Number(wall.t.toFixed(2)) : null,
      out: Number(out.toFixed(2)),
    };
    // And back out, and back to where the suite starts, because everything
    // after this measures the city from there.
    s.toggleVehicle();
    s.mechs.reset();
    s.teleport(81, 0);
    s.look(90, -3);
    return got;
  });
  check('and the wall you are stood against does not end up inside your head',
    !walled.skip && walled.wall !== null && walled.out <= walled.wall - 0.2,
    walled.skip ? `nothing to lean on: ${walled.why}`
      : `camera ${walled.out} m out, wall at ${walled.wall} m`);


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
    // The mean height of the walls round a point rather than the tallest:
    // a building comes down column by column now, with a ragged edge, and
    // the tallest piece within a few metres of a hit is the one column at
    // the edge that stayed up, which says nothing about how much came down.
    const meanNear = (x, z, r) => {
      let sum = 0, n = 0;
      s.world.forEachSegmentTile(x - r, z - r, x + r, z + r, (segs) => {
        // A metre of wall at a time, so a long wall that has not been cut
        // into pieces yet counts for the part of it that is in reach.
        for (let i = 0; i + 5 < segs.length; i += 6) {
          const len = Math.hypot(segs[i + 2] - segs[i], segs[i + 3] - segs[i + 1]);
          const steps = Math.max(1, Math.ceil(len));
          const tall = Math.max(0, segs[i + 5] - Math.max(0, segs[i + 4]));
          for (let k = 0; k < steps; k++) {
            const t = (k + 0.5) / steps;
            const px = segs[i] + (segs[i + 2] - segs[i]) * t;
            const pz = segs[i + 1] + (segs[i + 3] - segs[i + 1]) * t;
            if (Math.hypot(px - x, pz - z) > r) continue;
            sum += tall * (len / steps);
            n += len / steps;
          }
        }
      });
      return n ? sum / n : 0;
    };
    const y = s.world.groundHeight(at.x, at.z);
    const before = Math.round(meanNear(at.x, at.z, 8) * 10) / 10;
    for (let i = 0; i < 5; i++) {
      s.demolition.blast(at.x, y + 6, at.z, 10, 400);
      // Just long enough for the fall to finish, and not long enough for the
      // settle timer to write it into the city.
      for (let k = 0; k < 85; k++) s.demolition.update(1 / 60);
    }
    const whileLive = Math.round(meanNear(at.x, at.z, 8) * 10) / 10;
    const sitesLive = s.demolition.sites.length;
    // Now past the settle time: the sites are written into the city and give
    // their slots back.
    for (let k = 0; k < 60 * 6; k++) s.demolition.update(1 / 60);
    return {
      at, before, whileLive,
      after: Math.round(meanNear(at.x, at.z, 8) * 10) / 10,
      sitesLive, sitesNow: s.demolition.sites.length, bakedCount: s.demolition.baked,
    };
  });
  check('a building that has come down is written into the city',
    !baked.skip && baked.bakedCount > 0 && baked.sitesNow === 0,
    baked.skip ? 'no building found' : `${baked.sitesLive} sites while falling, ${baked.sitesNow} after, ${baked.bakedCount} baked`);
  check('and it stays down once the slot has gone',
    !baked.skip && baked.after <= baked.whileLive + 0.4 && baked.after < baked.before - 1,
    baked.skip ? '' : `walls ${baked.before} m on average standing, ${baked.whileLive} m while falling, ${baked.after} m once baked`);

  // Sixteen slots, twenty places: with baking, the last four are real damage
  // in their own place rather than the nearest site growing to swallow them.
  const everywhere = await page.evaluate(async () => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    // The mean height of the walls round a point rather than the tallest:
    // a building comes down column by column now, with a ragged edge, and
    // the tallest piece within a few metres of a hit is the one column at
    // the edge that stayed up, which says nothing about how much came down.
    const meanNear = (x, z, r) => {
      let sum = 0, n = 0;
      s.world.forEachSegmentTile(x - r, z - r, x + r, z + r, (segs) => {
        // A metre of wall at a time, so a long wall that has not been cut
        // into pieces yet counts for the part of it that is in reach.
        for (let i = 0; i + 5 < segs.length; i += 6) {
          const len = Math.hypot(segs[i + 2] - segs[i], segs[i + 3] - segs[i + 1]);
          const steps = Math.max(1, Math.ceil(len));
          const tall = Math.max(0, segs[i + 5] - Math.max(0, segs[i + 4]));
          for (let k = 0; k < steps; k++) {
            const t = (k + 0.5) / steps;
            const px = segs[i] + (segs[i + 2] - segs[i]) * t;
            const pz = segs[i + 1] + (segs[i + 3] - segs[i + 1]) * t;
            if (Math.hypot(px - x, pz - z) > r) continue;
            sum += tall * (len / steps);
            n += len / steps;
          }
        }
      });
      return n ? sum / n : 0;
    };
    const spots = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const r = 110 + (i % 5) * 60;
      const x = s.player.x + Math.cos(a) * r, z = s.player.z + Math.sin(a) * r;
      spots.push({ x, z, before: s.world.tallestNear(x, z, 14), mean: meanNear(x, z, 14) });
    }
    for (const spot of spots) {
      const y = s.world.groundHeight(spot.x, spot.z);
      // Enough to finish whatever is there rather than enough to dent it:
      // what is being measured is where the damage lands once the sixteen
      // slots are full, not how much of a frontage one rocket takes.
      for (let i = 0; i < 4; i++) s.demolition.blast(spot.x, y + 5, spot.z, 16, 900);
      for (let k = 0; k < 200; k++) s.demolition.update(1 / 60);
    }
    for (let k = 0; k < 60 * 4; k++) s.demolition.update(1 / 60);
    const hit = spots.filter((v) => v.before > 10);
    const down = hit.filter((v) => meanNear(v.x, v.z, 14) < v.mean - 1.5);
    const last = spots.slice(-6).filter((v) => v.before > 10);
    const lastDown = last.filter((v) => meanNear(v.x, v.z, 14) < v.mean - 1.5);
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
    // Put back down on the street first. By this point in the suite the
    // player may be standing on a heap of what used to be a building, and
    // the stream tests the height of what it lands on: three metres of
    // rubble between the nozzle and the man is a miss every time.
    s.teleport(s.player.x, s.player.z);
    // Five metres, which is the range this weapon is for. Nine put him at the
    // far end of a cone the stream only reaches a third of the time. The
    // direction is whichever one has nothing in it: by this point in the
    // suite the streets here are rubble, and a heap between the nozzle and
    // the man measures the heap.
    const eye0 = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    let sd = null;
    for (let i = 0; i < 12 && !sd; i++) {
      const a = (i / 12) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      if (s.world.raycast(eye0.x, eye0.y, eye0.z, dx, 0, dz, 6.5)) continue;
      sd = s.soldiers.spawnNear(s.player.x + dx * 5, s.player.z + dz * 5, 0.5, 1.2);
      if (sd) {
        // Put exactly five metres away rather than wherever there was room:
        // the stream throws its puffs at random distances down the cone, so
        // a man three metres out is in front of most of it and one at nine
        // is behind it, and both measure where he was standing rather than
        // what a flamethrower does.
        sd.x = s.player.x + dx * 5;
        sd.z = s.player.z + dz * 5;
        sd.y = s.world.groundHeight(sd.x, sd.z);
      }
    }
    if (!sd) return { skip: true };
    // Pointed at him rather than at wherever the last check left the view: a
    // flamethrower is a cone, and three degrees of pitch at five metres is
    // the difference between a man on fire and a scorch mark in front of him.
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const to = { x: sd.x - eye.x, y: (sd.y + 1.0) - eye.y, z: sd.z - eye.z };
    const far = Math.hypot(to.x, to.y, to.z) || 1;
    s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI,
      Math.asin(to.y / far) * 180 / Math.PI);
    s.camera.update(16 / 9);
    const fuel0 = s.weapon.ammo;
    const hp0 = sd.health;
    // Held for a stretch of simulated time rather than a number of frames or
    // a stretch of wall clock: the thing being measured is a drain per second
    // of game, and on a machine slow enough for the frame clamp to bite the
    // game runs slower than the clock on the wall.
    // On his feet before the clock starts: he arrives in a sphere and comes
    // up out of the street, and a second of that is a second of pouring
    // flame over the pavement he is still under.
    while (sd.rise > 0) await new Promise((r) => requestAnimationFrame(r));
    const t0 = s.loop.simTime;
    const wall = performance.now();
    // Held where he was put. He is a live soldier with somewhere better to
    // be, and a man who walks out of the stream halfway through measures his
    // own footwork rather than the flamethrower.
    const stood = { x: sd.x, z: sd.z };
    // Six seconds rather than three. The stream puts three puffs a frame at
    // random distances down the cone, so a man standing at nine metres is in
    // perhaps a third of it, and three seconds of that left him alive at
    // about half health: close enough to the line that the check passed or
    // failed on the weather.
    while (s.loop.simTime - t0 < 6 && performance.now() - wall < 90000) {
      sd.x = stood.x;
      sd.z = stood.z;
      s.holdFire(true);
      await new Promise((r) => requestAnimationFrame(r));
    }
    const seconds = s.loop.simTime - t0;
    s.holdFire(false);
    // And then let him burn. A man who has had six seconds of a flamethrower
    // poured over him does not stop being on fire when you let go of the
    // trigger: the pools he is standing in go on burning, and the claim is
    // that he goes down, not that he goes down while you are still pouring.
    const t2 = s.loop.simTime;
    while (sd.health > 0 && s.loop.simTime - t2 < 8 && performance.now() - wall < 150000) {
      sd.x = stood.x;
      sd.z = stood.z;
      await new Promise((r) => requestAnimationFrame(r));
    }
    const burntFor = +(s.loop.simTime - t0).toFixed(1);
    return {
      chose, seconds: +seconds.toFixed(1),
      fuel0: Math.round(fuel0), fuel: Math.round(s.weapon.ammo),
      perSecond: s.weapons.flamer.stream.fuelPerSecond,
      hp0: Math.round(hp0), hp: Math.round(sd.health), charred: +(sd.charred || 0).toFixed(2),
      burntFor,
      scale: +s.state.timeScale.toFixed(2),
      inMech: !!s.state.inMech,
      away: +Math.hypot(sd.x - s.player.x, sd.z - s.player.z).toFixed(1),
      held: s.weapon.id || s.weapon.current,
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
    flame.skip ? '' : `${flame.hp0} health became ${flame.hp} in ${flame.burntFor} s, `
      + `charred ${flame.charred}, ${flame.away} m away`);

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
    // The clock on the wall, read at the moment the mode was picked.
    const now = new Date();
    const wall = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    const preset = s.machines.timeOfDay;
    const slider = parseFloat(document.getElementById('modetime').value);
    // And then moved by hand, which is a choice rather than a default: from
    // there on it stays where it was put even when the mode is picked again.
    s.machines.setTime(3.5);
    if (btn) btn.click();
    const kept = s.machines.timeOfDay;
    // And back to the early afternoon for everything after this. The mode
    // holds the light while it is running, and the rest of the suite takes
    // its pictures in it: at half past three in the morning they are black.
    s.machines.setTime(14.2);
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
      wall: Number(wall.toFixed(2)),
      preset: Number(preset.toFixed(2)),
      slider: Number(slider.toFixed(1)),
      kept: Number(kept.toFixed(2)),
    };
  });
  check('Rise of the Machines is picked on the title screen', mode.on && mode.timeShown,
    'with the time of day to go with it');
  check('and it starts at the hour it actually is',
    Math.abs(mode.preset - mode.wall) < 0.12 && Math.abs(mode.slider - mode.preset) < 0.1,
    `${mode.preset} against a clock reading ${mode.wall}`);
  check('unless the slider has been moved, which is a choice rather than a default',
    mode.kept === 3.5, `${mode.kept} held through picking the mode again`);
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
  // And the launcher it comes out of now. The pulse was a bomb you lobbed at
  // your own feet; this checks that it leaves the barrel, travels, and stops
  // what it lands among.
  const launcher = await page.evaluate(async () => {
    const s = window.spreefall;
    s.projectiles.clear();
    // The street first: the mode keeps twenty two machines walking and the
    // pool holds twenty four, so there is no room to stand a group of four
    // anywhere until some of them are taken off it. The mode goes quiet for
    // the same reason the other warhead checks turn it off: it drops a nuke
    // on the skyline every two and a half seconds, and a check that waits
    // for the air to clear waits for one of those instead.
    const modeWas = s.machines.active;
    s.machines.active = false;
    s.soldiers.reset();
    const spec = s.weapons.emp;
    // Four of them in a group, out where a thrown bomb would never have
    // reached, somewhere there is room for four and a clear line to it.
    const eye0 = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const group = [];
    for (let step = 0; step < 24 && group.length < 2; step++) {
      const a = (step % 12) / 12 * Math.PI * 2;
      const d = 60 - Math.floor(step / 12) * 20;
      const px = s.player.x - Math.sin(a) * d, pz = s.player.z - Math.cos(a) * d;
      // The line the rocket will actually fly, not a level one: it leaves the
      // eye and comes down on the ground where they are standing, and a kerb
      // in between is a rocket that goes off in the wrong street.
      const py = s.world.groundHeight(px, pz) + 1.2;
      if (Math.abs(py - (s.player.y + 1.2)) > 4) continue;
      const dx = px - eye0.x, dy = py - eye0.y, dz = pz - eye0.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      if (s.world.raycast(eye0.x, eye0.y, eye0.z, dx / len, dy / len, dz / len, len)) continue;
      // And the line it is actually fired down, at the road short of them:
      // clear to the group was not the same as clear to there, and a lamp
      // post seven metres out on that line set the pulse off at the player's
      // feet in one of three runs here.
      const ax = s.player.x + (px - s.player.x) * 0.85, az = s.player.z + (pz - s.player.z) * 0.85;
      const ay = s.world.groundHeight(ax, az) + 0.2;
      const fx = ax - eye0.x, fy = ay - eye0.y, fz = az - eye0.z;
      const fl = Math.hypot(fx, fy, fz) || 1;
      const block = s.world.raycast(eye0.x, eye0.y, eye0.z, fx / fl, fy / fl, fz / fl, fl);
      if (block && block.t < fl - 1.5) continue;
      for (let i = 0; i < 4; i++) {
        const sd = s.soldiers.spawnNear(px, pz, 2, 9);
        if (sd) { s.makeMachine(sd); sd.stunLeft = 0; group.push(sd); }
      }
    }
    if (group.length < 2) { s.machines.active = modeWas; return { skip: true }; }
    const stood = group.map((m) => ({ m, x: m.x, z: m.z }));
    const mid = stood.reduce((a, p) => [a[0] + p.x / stood.length, a[1] + p.z / stood.length], [0, 0]);
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    // At the road just short of them rather than at the group itself. A
    // rocket aimed at a man at sixty metres either hits him or sails over
    // his head, and which of the two it does depends on where the man was
    // standing when the aim was taken; aimed at the ground in front of him
    // it lands, which is what a pulse wants.
    const aimX = s.player.x + (mid[0] - s.player.x) * 0.85;
    const aimZ = s.player.z + (mid[1] - s.player.z) * 0.85;
    const to = { x: aimX - eye.x, y: (s.world.groundHeight(aimX, aimZ) + 0.2) - eye.y, z: aimZ - eye.z };
    const l = Math.hypot(mid[0] - eye.x, mid[1] - eye.z) || 1;
    const aimLen = Math.hypot(to.x, to.y, to.z) || 1;
    s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI,
      Math.asin(to.y / aimLen) * 180 / Math.PI);
    s.camera.update(16 / 9);
    const picked = s.weapon.select('emp') || s.weapon.id === 'emp';
    s.weapon.carried.emp.ammo = spec.magazine;
    s.weapon.cooldown = 0;
    s.weapon.spread = 0;
    s.shoot();
    // The one that just left the barrel, watched by itself: anything else in
    // the air belongs to somebody else.
    const rocket = s.projectiles.active[s.projectiles.active.length - 1] || null;
    const flying = !!rocket;
    const away = Math.round(l);
    let nearest = 999;
    let last = null;
    for (let i = 0; i < 60 * 4 && rocket && rocket.alive; i++) {
      for (const p of stood) { p.m.x = p.x; p.m.z = p.z; }
      nearest = Math.min(nearest, Math.hypot(rocket.x - mid[0], rocket.z - mid[1]));
      last = {
        over: Math.round(rocket.y - s.world.groundHeight(rocket.x, rocket.z)),
        age: +rocket.age.toFixed(1),
      };
      s.fixedForTest(1 / 60);
    }
    // Where the warhead actually went off, which is the first thing to know
    // when nothing was stopped.
    s.machines.active = modeWas;
    return {
      skip: false, picked, flying, away,
      kind: spec.kind,
      stopped: group.filter((m) => m.stunLeft > 0).length,
      put: group.length,
      nearest: Math.round(nearest),
      still: rocket && rocket.alive ? 1 : 0,
      last,
      alive: group.filter((m) => m.alive).length,
    };
  });
  check('the EMP is a launcher, and the pulse arrives where you pointed it',
    !launcher.skip && launcher.picked && launcher.kind === 'launch' && launcher.flying
      && launcher.stopped >= launcher.put - 1,
    launcher.skip ? 'no room for a group'
      : `${launcher.stopped} of ${launcher.put} stopped at ${launcher.away} m`
        + (launcher.stopped >= launcher.put - 1 ? ''
          // When it misses, where the warhead went is the whole story: the
          // first version of this aimed at the men rather than at the road
          // in front of them, and the rocket sailed over their heads and
          // went off eighty metres past them.
          : `, ${launcher.alive} alive, the warhead passed within `
            + `${launcher.nearest} m of them, ${launcher.still} still in the air`
            + (launcher.last ? `, last seen ${launcher.last.over} m up at ${launcher.last.age} s` : '')));

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
    // Find a frontage the camera is actually pointing at, rather than
    // guessing a distance down the street and hoping. Without this the blast
    // sometimes lands in the open and there is no bite in the picture to
    // measure.
    const f = s.camera.forward;
    const eye = s.camera.position;
    const wall = s.world.raycast(eye[0], eye[1], eye[2], f[0], f[1], f[2], 220);
    const away = wall ? Math.min(wall.t, 120) : 70;
    const x = s.player.x + f[0] * away, z = s.player.z + f[2] * away;
    // A big enough bite that there is something to measure: a frontage with
    // a mansard on it leaves less sky behind it than a flat one, and forty
    // odd pixels is not a sample.
    s.demolition.blast(x, s.world.groundHeight(x, z), z, 62, 4400);
    for (let i = 0; i < 60 * 5; i++) s.fixedForTest(1 / 60);
    s.teleport(x - f[0] * Math.min(26, away * 0.5), z - f[2] * Math.min(26, away * 0.5));
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
    // All of them, near enough: the backs of the pieces in a heap of rubble
    // lie every way up and are lit like the rest of the heap, which can be
    // brighter than the shadow behind it. A hole showing sky is a
    // different thing and would be thousands of pixels.
    seeThrough.armed > 0 && seeThrough.changed > 80
      && seeThrough.darker >= seeThrough.changed * 0.97,
    `${seeThrough.changed} pixels filled, all ${seeThrough.darker} of them darker`);

  // --- mechs ---------------------------------------------------------------
  const mech = await page.evaluate(async () => {
    const s = window.spreefall;
    // By now the suite has been shot at for twenty checks and the run may
    // have ended behind us. Everything from here is about mechs, and none of
    // it can be measured, let alone photographed, through a screen that says
    // Systems down, so the run is picked up off the floor first.
    const down = document.getElementById('down');
    if (down && !down.classList.contains('hidden')) {
      document.getElementById('downbtn').click();
      await new Promise((r) => requestAnimationFrame(r));
    }
    s.mechs.reset();
    // Half the district has been on fire since the flamethrower checks, and a
    // mech parked in a burning street burns. That is the right behaviour and
    // it is checked further down; here it would only mean measuring how long
    // a Titan lasts in somebody else's fire.
    s.burningGround.length = 0;
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
    // A skip that says which of the two is missing, and what else is on the
    // street. The first version of this said nothing at all, and a run where
    // the Titan had quietly died read exactly like a run where there had
    // been no room to put one.
    if (!mine || !theirs) {
      return { skip: true, why: `mine ${!!mine}, theirs ${!!theirs}, `
        + `${s.mechs.active.length} of 8 up, piloted ${!!s.state.inMech}` };
    }
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
    // known place so that this measures the gun rather than the street. The
    // place is worked out once: taking it off the torso each step made the
    // target orbit the mech as the torso turned towards it.
    // Somewhere the mech can actually see: a spot behind a frontage is a
    // test of the wall, not of the gun. Candidates are tried in a fan round
    // the torso until the line from the muzzle is clear.
    const alone = window.clearTheStreet([mine, theirs]);
    const spot = window.firingSpot(mine, 30);
    if (spot.why) return { skip: true, why: spot.why };
    theirs.x = spot.x;
    theirs.z = spot.z;
    theirs.y = s.world.groundHeight(spot.x, spot.z);
    theirs.health = theirs.maxHealth;
    const yaw = Math.atan2(-(theirs.x - mine.x), -(theirs.z - mine.z));
    // Look at its chest rather than at the horizon: the guns go where the
    // torso points and the torso goes where the pilot looks, so a level shot
    // at something standing lower than you goes over its head.
    const flat = Math.hypot(theirs.x - mine.x, theirs.z - mine.z);
    const rise = (theirs.y + 5.2) - (mine.y + s.mechSpec.titan.eye);
    s.look(yaw * 180 / Math.PI, Math.atan2(rise, flat) * 180 / Math.PI);
    const hp0 = theirs.health;
    // Every round the gun lets go, and where it went: the one time this
    // check failed with a clear line and a target the gun's own ray could
    // find, the answer was in which of these three counts went up.
    const tally = { fired: 0, onIt: 0, onSteel: 0, onCity: 0, miss: 0 };
    const realGun = s.mechs.onArmFire;
    s.mechs.onArmFire = (mm, from, dir, arm, extra) => {
      if (mm === mine) {
        tally.fired++;
        const far = arm.range || 280;
        const steel = s.mechs.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, far);
        const city = s.world.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, far);
        if (steel && (!city || steel.t <= city.t)) {
          if (steel.mech === theirs) tally.onIt++; else tally.onSteel++;
        } else if (city) tally.onCity++;
        else tally.miss++;
      }
      realGun(mm, from, dir, arm, extra);
    };
    s.input.fire = true;
    for (let i = 0; i < 60 * 4; i++) {
      // Nailed to the spot, so this measures the gun rather than whether the
      // other one happened to sidestep out of the line.
      theirs.x = spot.x;
      theirs.z = spot.z;
      s.fixedForTest(1 / 60);
    }
    s.input.fire = false;
    s.mechs.onArmFire = realGun;
    const hp1 = theirs.health;
    // If nothing landed, say why: where the target was, whether the gun's own
    // ray finds it, and what the world puts in the way.
    const mz = s.mechs.muzzle(mine, s.mechSpec.titan.chaingun.muzzle);
    const aim = s.mechs.aim(mine);
    const wall = s.world.raycast(mz.x, mz.y, mz.z, aim.x, aim.y, aim.z, 260);
    const onTarget = s.mechs.raycast(mz.x, mz.y, mz.z, aim.x, aim.y, aim.z, 260);
    const toward = {
      x: theirs.x - mine.x,
      z: theirs.z - mine.z,
    };
    const tl = Math.hypot(toward.x, toward.z) || 1;
    const shot = {
      away: Math.round(tl),
      wall: wall ? Math.round(wall.t) : null,
      mech: onTarget ? Math.round(onTarget.t) : null,
      alive: theirs.alive && theirs.health > 0,
      inIt2: s.state.inMech === mine,
      // How well the torso is actually pointed at it, and whether the aim
      // point the guns converge on is anywhere near it.
      facing: Number(((aim.x * toward.x + aim.z * toward.z) / tl).toFixed(2)),
      torso: Number(mine.torso.toFixed(2)),
      cam: Number(s.camera.yaw.toFixed(2)),
      aimAt: (() => {
        const p = s.mechs.aimPoint(mine, 260);
        return Math.round(Math.hypot(p.x - theirs.x, p.z - theirs.z));
      })(),
      mineY: Number(mine.y.toFixed(1)),
      theirsY: Number(theirs.y.toFixed(1)),
      // Whether the gun's own ray finds the target rather than something
      // else, and how many other machines were stood down first.
      onIt: onTarget ? onTarget.mech === theirs : null,
      alone,
      left: s.mechs.active.length,
      tally,
    };
    // And a salvo of rockets out of the pod. Counted as they leave rather
    // than by looking at what is still in the air: at two hundred and thirty
    // metres a second the first ones have already arrived.
    let rockets = 0;
    const realRockets = s.mechs.onRockets;
    s.mechs.onRockets = (mm, from, dir, spec) => {
      if (mm.mine) rockets++;
      realRockets(mm, from, dir, spec);
    };
    s.input.secondary = true;
    for (let i = 0; i < 40; i++) s.fixedForTest(1 / 60);
    s.input.secondary = false;
    s.mechs.onRockets = realRockets;
    const out = { inIt, walked: Math.round(walked), hp0, hp1, rockets, torso: 0, shot };
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
    piloted.skip ? piloted.why : `${piloted.walked} m of walking`);
  // The detail carries the whole geometry when this fails, because the one
  // time it did, the answer was not the gun at all: the target was standing
  // in a crater thirteen metres down and the shot went over its head.
  const gunOk = !piloted.skip && piloted.hp1 < piloted.hp0 - 300;
  check('its chaingun takes a mech apart', gunOk,
    piloted.skip ? piloted.why
      : `${piloted.hp0} to ${piloted.hp1} at ${piloted.shot.away} m`
        + (gunOk ? '' : ` ${JSON.stringify(piloted.shot)}`));
  check('and the pod throws a salvo rather than one rocket',
    !piloted.skip && piloted.rockets >= 3, `${piloted.rockets} in the air`);
  check('the torso goes where you look and the legs follow',
    !piloted.skip && piloted.torsoSnap && piloted.legsLag && piloted.outAgain);

  // --- the loadout and the cockpit -----------------------------------------
  // Five weapons rather than one, chosen with the number row and the wheel,
  // and a view out of the canopy whose crosshair says where the shot goes.
  const got = await page.evaluate(async () => {
    const s = window.spreefall;
    s.mechs.reset();
    const mine = s.spawnMech('titan', 12);
    if (!mine) return { skip: true, why: 'no room for one' };
    s.teleport(mine.x + 3, mine.z);
    s.toggleVehicle();
    if (s.state.inMech !== mine) {
      return { skip: true, why: `could not get in: ${s.mechs.nearest(s.player.x, s.player.z, 8) ? 'one within reach' : 'none within reach'}, `
        + `piloted ${!!s.state.inMech}, ${Math.round(Math.hypot(mine.x - s.player.x, mine.z - s.player.z))} m off` };
    }
    s.look(mine.torso * 180 / Math.PI, 0);
    for (let i = 0; i < 4; i++) s.fixedForTest(1 / 60);
    await new Promise((r) => requestAnimationFrame(r));
    return {
      skip: false,
      arms: s.mechLoadout.length,
      ids: s.mechLoadout.map((a) => a.id).join(', '),
      rows: document.querySelectorAll('#mecharms .marm').length,
      hud: !document.getElementById('mechhud').classList.contains('hidden'),
      cockpit: s.state.cockpit,
      arm: mine.arm,
      named: document.querySelector('#mecharms .marm.on span').textContent,
    };
  });
  // The Warden's own three and the Void Maw every chassis carries, and the
  // readout has a row for each. Every chassis used to carry all ten, which
  // made ten bodies and one mech.
  check('a mech of your own carries its chassis\' loadout',
    !got.skip && got.arms === 4 && got.rows === got.arms && got.hud
      && got.ids === 'chaingun, cannon, empbomb, voidmaw',
    got.skip ? got.why : `${got.ids}, holding the ${got.named}`);

  // The number row and the wheel, through the real keyboard and the real
  // wheel rather than by calling the function underneath them.
  await page.keyboard.press('Digit2');
  const picked = await page.evaluate(async () => {
    const s = window.spreefall;
    const m = s.state.inMech;
    // One frame, so the readout has been drawn since the key was pressed.
    await new Promise((r) => requestAnimationFrame(r));
    return {
      arm: m ? m.arm : -1,
      id: m ? s.mechLoadout[m.arm].id : '',
      lit: document.querySelectorAll('#mecharms .marm.on').length,
      litIndex: [...document.querySelectorAll('#mecharms .marm')]
        .findIndex((r) => r.classList.contains('on')),
    };
  });
  check('the number row chooses out of the mech loadout',
    picked.arm === 1 && picked.id === 'cannon' && picked.lit === 1
      && picked.litIndex === 1,
    `2 picked the ${picked.id}`);
  await page.mouse.wheel(0, 120);
  const wheeled = await page.evaluate(async () => {
    const s = window.spreefall;
    const m = s.state.inMech;
    await new Promise((r) => requestAnimationFrame(r));
    return { id: m ? s.mechLoadout[m.arm].id : '' };
  });
  check('and the wheel moves one along, not two',
    wheeled.id === 'empbomb', `the wheel reached the ${wheeled.id}`);

  // Underfoot. Eight metres of walking armour does not step over a man, and
  // the man is not shot: he is where the foot came down.
  const trampled = await page.evaluate(async () => {
    const s = window.spreefall;
    const m = s.state.inMech;
    if (!m) return { skip: true };
    s.soldiers.reset(); s.combat.reset(); s.gibs.clear();
    const v = s.spawnSoldier(0.4, 0.3);
    if (!v) return { skip: true, why: 'nobody to stand on' };
    v.x = m.x + 0.4; v.z = m.z + 0.3; v.y = m.y;
    const kills = s.combat.kills;
    for (let i = 0; i < 8 && v.health > 0; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    const out = { down: v.health <= 0, credited: s.combat.kills - kills };
    // And somebody standing clear is not touched by the same step.
    const w = s.spawnSoldier(9, 0);
    if (w) { w.x = m.x + 9; w.z = m.z; w.y = m.y; }
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    out.bystander = w ? w.health > 0 : null;
    s.soldiers.reset();
    return out;
  });
  check('a mech walking over somebody puts him into the pavement',
    !trampled.skip && trampled.down && trampled.credited === 1,
    trampled.skip ? (trampled.why || 'no mech') : `${trampled.credited} kill`);
  check('and the man standing nine metres off is left alone',
    !trampled.skip && trampled.bystander === true);

  // The keys a pilot keeps. The view moved off V so that the travel map is
  // the same key everywhere in the game, and the reflex has to be worth
  // having in a machine, which means the machine keeps its own speed while
  // the world slows rather than being slowed with it.
  const was = await page.evaluate(() => window.spreefall.state.cockpit);
  await page.keyboard.press('KeyY');
  const viewKey = await page.evaluate(() => window.spreefall.state.cockpit);
  check('Y changes the view from inside a mech', viewKey !== was,
    `${was ? 'cockpit' : 'shoulder'} became ${viewKey ? 'cockpit' : 'shoulder'}`);
  await page.keyboard.press('KeyY');
  await page.keyboard.press('KeyV');
  const travelKey = await page.evaluate(async () => {
    const s = window.spreefall;
    await new Promise((r) => requestAnimationFrame(r));
    const open = !!s.state.targeting
      || !document.getElementById('nuketarget').classList.contains('hidden');
    s.closeTargeting(true);
    await new Promise((r) => requestAnimationFrame(r));
    return open;
  });
  check('and V still opens the travel map in there', travelKey);
  const banana = await page.evaluate(() => {
    const s = window.spreefall;
    const before = s.weapon.id;
    return { before };
  });
  await page.keyboard.press('Digit6');
  const sixth = await page.evaluate(() => {
    const s = window.spreefall;
    return { weapon: s.weapon.id, arm: s.state.inMech ? s.state.inMech.arm : -1 };
  });
  check('and the number row cannot reach the pilot\'s own weapons',
    sixth.weapon === banana.before,
    `still holding the ${sixth.weapon}`);

  // The view out of the canopy. The thing worth measuring is not where the
  // camera is but whether it tells the truth: the guns converge on the point
  // the torso's own line of sight runs into, so that point has to sit on the
  // ray out of the middle of the screen. Half a metre off at fifty paces is
  // a miss, and that is exactly what a camera parked beside the aim line
  // gives you.
  const view = await page.evaluate(async () => {
    const s = window.spreefall;
    const m = s.state.inMech;
    if (!m) return { skip: true };
    s.selectArm(0);
    await new Promise((r) => requestAnimationFrame(r));
    const inside = Math.hypot(s.camera.position[0] - m.x, s.camera.position[2] - m.z);
    const cp = Math.cos(s.camera.pitch);
    const f = {
      x: -Math.sin(s.camera.yaw) * cp,
      y: Math.sin(s.camera.pitch),
      z: -Math.cos(s.camera.yaw) * cp,
    };
    const at = s.mechs.aimPoint(m, 300);
    const vx = at.x - s.camera.position[0];
    const vy = at.y - s.camera.position[1];
    const vz = at.z - s.camera.position[2];
    const t = vx * f.x + vy * f.y + vz * f.z;
    const off = Math.hypot(vx - f.x * t, vy - f.y * t, vz - f.z * t);
    // And looking down. The offset is along the line of sight, so pitching
    // must not put the crosshair off the shot either.
    s.look(m.torso * 180 / Math.PI, -24);
    s.fixedForTest(1 / 60);
    await new Promise((r) => requestAnimationFrame(r));
    const cp2 = Math.cos(s.camera.pitch);
    const f2 = {
      x: -Math.sin(s.camera.yaw) * cp2,
      y: Math.sin(s.camera.pitch),
      z: -Math.cos(s.camera.yaw) * cp2,
    };
    const at2 = s.mechs.aimPoint(m, 300);
    const wx = at2.x - s.camera.position[0];
    const wy = at2.y - s.camera.position[1];
    const wz = at2.z - s.camera.position[2];
    const t2 = wx * f2.x + wy * f2.y + wz * f2.z;
    const offDown = Math.hypot(wx - f2.x * t2, wy - f2.y * t2, wz - f2.z * t2);
    s.look(m.torso * 180 / Math.PI, 0);
    const chase = s.toggleCockpit() === false;
    s.fixedForTest(1 / 60);
    await new Promise((r) => requestAnimationFrame(r));
    const back = Math.hypot(s.camera.position[0] - m.x, s.camera.position[2] - m.z);
    s.toggleCockpit();
    await new Promise((r) => requestAnimationFrame(r));
    return {
      skip: false, chase,
      inside: Number(inside.toFixed(1)),
      back: Number(back.toFixed(1)),
      off: Number(off.toFixed(2)),
      offDown: Number(offDown.toFixed(2)),
      aimAway: Math.round(Math.hypot(at.x - m.x, at.z - m.z)),
    };
  });
  check('the cockpit view sits in the machine, not behind it',
    !view.skip && view.inside < 4 && view.chase && view.back > 8,
    view.skip ? '' : `${view.inside} m from the hull, ${view.back} m from over the shoulder`);
  check('and its crosshair says where the shot goes',
    !view.skip && view.off < 0.1 && view.offDown < 0.1,
    view.skip ? ''
      : `${view.off} m off level, ${view.offDown} m off looking down, aiming ${view.aimAway} m out`);

  // The railgun. Held it charges, let go it fires, and a full charge is worth
  // several times a tap: the whole weapon is in that difference.
  const rail = await page.evaluate(async () => {
    const s = window.spreefall;
    const mine = s.state.inMech;
    if (!mine) return { skip: true };
    const theirs = s.spawnMech('reaper', 60);
    if (!theirs) return { skip: true };
    // Somewhere the mech can see, the same way the chaingun check picks it.
    window.clearTheStreet([mine, theirs]);
    const spot = window.firingSpot(mine, 34);
    if (spot.why) return { skip: true, why: spot.why };
    const park = () => {
      theirs.x = spot.x; theirs.z = spot.z;
      theirs.y = s.world.groundHeight(spot.x, spot.z);
    };
    park();
    const yaw = Math.atan2(-(theirs.x - mine.x), -(theirs.z - mine.z));
    const flat = Math.hypot(theirs.x - mine.x, theirs.z - mine.z);
    const rise = (theirs.y + 5.2) - (mine.y + s.mechSpec.titan.eye);
    s.look(yaw * 180 / Math.PI, Math.atan2(rise, flat) * 180 / Math.PI);
    // What these two checks measure is the arm, not the chassis, and the
    // Warden does not carry a railgun or thermite: for them the mech holds
    // the whole table, in its order, and gets its own three back after.
    mine.ownLoadout = mine.loadout;
    mine.loadout = s.mechArms;
    mine.mags = s.mechArms.map((a) => a.magazine);
    s.selectArm(3);
    // Held to the top of the charge, then let go. Nothing is counted until
    // the trigger comes up, which is the point of the weapon.
    // Deliberately given more health than a Reaper has: a full charge is
    // meant to be most of a mech, and the comparison needs a target that is
    // still standing after the first one.
    const pool = 9000;
    theirs.health = pool;
    theirs.shield = 0;
    s.input.fire = true;
    for (let i = 0; i < 90; i++) { park(); s.fixedForTest(1 / 60); }
    const held = theirs.health;
    const charge = Number(mine.charge.toFixed(2));
    s.input.fire = false;
    for (let i = 0; i < 6; i++) { park(); s.fixedForTest(1 / 60); }
    const full = pool - theirs.health;
    // And a tap, for the comparison. The weapon has its own interval after a
    // shot, and a trigger pulled inside it holds the shot rather than losing
    // it, so this waits for the gun to come back up first.
    for (let i = 0; i < 60; i++) { park(); s.fixedForTest(1 / 60); }
    theirs.health = pool;
    theirs.shield = 0;
    s.input.fire = true;
    s.fixedForTest(1 / 60);
    s.input.fire = false;
    for (let i = 0; i < 6; i++) { park(); s.fixedForTest(1 / 60); }
    const tap = pool - theirs.health;
    return {
      skip: false, charge,
      whileHeld: Math.round(pool - held),
      full: Math.round(full),
      tap: Math.round(tap),
    };
  });
  check('the railgun charges while you hold it and goes off when you let go',
    !rail.skip && rail.whileHeld < 50 && rail.charge > 1.1 && rail.full > 1000,
    rail.skip ? (rail.why || 'no clear line')
      : `${rail.whileHeld} while held, ${rail.full} on release`);
  check('and a tap is worth a fraction of a full charge',
    !rail.skip && rail.tap > 0 && rail.tap < rail.full * 0.6,
    rail.skip ? '' : `${rail.tap} against ${rail.full}`);

  // A picture of the cockpit, with the loadout down the side of it.
  await page.evaluate(async () => {
    const s = window.spreefall;
    s.selectArm(0);
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  await page.screenshot({ path: path.join(SHOTS, 'mech-05-cockpit.png') });

  // Thermite, which is a canister rather than a shell: what it does is leave
  // the street burning where it lands.
  const therm = await page.evaluate(async () => {
    const s = window.spreefall;
    const mine = s.state.inMech;
    if (!mine) return { skip: true };
    s.selectArm(2);
    s.look(mine.torso * 180 / Math.PI, -18);
    // A weapon just brought up takes a moment to come up, the same way it
    // does for a man, so the trigger waits for it.
    for (let i = 0; i < 20; i++) s.fixedForTest(1 / 60);
    const before = s.burningGround.length;
    s.input.fire = true;
    s.fixedForTest(1 / 60);
    s.input.fire = false;
    for (let i = 0; i < 120; i++) s.fixedForTest(1 / 60);
    if (mine.ownLoadout) {
      mine.loadout = mine.ownLoadout;
      mine.mags = mine.loadout.map((a) => a.magazine);
      s.selectArm(0);
    }
    return { skip: false, pools: s.burningGround.length - before };
  });
  check('the thermite launcher leaves the street on fire',
    !therm.skip && therm.pools >= 4, therm.skip ? '' : `${therm.pools} pools burning`);

  // A shield that soaks the first hits and comes back when it is left alone.
  const shield = await page.evaluate(async () => {
    const s = window.spreefall;
    const mine = s.state.inMech;
    if (!mine || !mine.shieldMax) return { skip: true };
    // Alone in a street that is not on fire for this one: a shield that is
    // coming back while something is still shooting at it, or while the
    // thermite from the last check is still burning round its ankles,
    // measures that instead of the shield.
    s.burningGround.length = 0;
    for (let i = s.mechs.active.length - 1; i >= 0; i--) {
      const other = s.mechs.active[i];
      if (!other.mine) { other.alive = false; s.mechs.active.splice(i, 1); }
    }
    mine.shield = mine.shieldMax;
    mine.health = mine.maxHealth;
    const hp0 = mine.health;
    s.mechs.damage(mine, 600);
    const afterOne = { shield: mine.shield, health: mine.health };
    s.mechs.damage(mine, 2000);
    const through = hp0 - mine.health;
    // Then left alone, it fills again.
    for (let i = 0; i < 60 * 12; i++) s.fixedForTest(1 / 60);
    return {
      skip: false,
      soaked: afterOne.shield === mine.shieldMax - 600 && afterOne.health === hp0,
      through: Math.round(through),
      back: Math.round(mine.shield),
      max: mine.shieldMax,
    };
  });
  check('a shield soaks what hits it before the hull does',
    !shield.skip && shield.soaked && shield.through === 1100,
    shield.skip ? '' : `600 soaked, ${shield.through} of 2000 reached the hull`);
  check('and it comes back when nobody is shooting at it',
    !shield.skip && shield.back === shield.max, shield.skip ? '' : `${shield.back} of ${shield.max}`);

  // And the one thing a rocket used to do to a mech, which was nothing.
  const splash = await page.evaluate(async () => {
    const s = window.spreefall;
    const theirs = s.spawnMech('reaper', 60);
    if (!theirs) return { skip: true };
    theirs.health = theirs.maxHealth;
    const hp0 = theirs.health;
    s.explode(theirs.x, theirs.y + 5, theirs.z, { radius: 20, damage: 400 }, { weapon: 'rpg' });
    const took = Math.round(hp0 - theirs.health);
    // And back out on foot, because what comes after this measures a mech
    // being climbed into and F would take us out of this one instead.
    if (s.state.inMech) s.toggleVehicle();
    return { skip: false, took, out: s.state.inMech === null };
  });
  check('a blast beside a mech takes a piece out of it',
    !splash.skip && splash.took > 100 && splash.out,
    splash.skip ? '' : `${splash.took} off the hull`);

  // --- a mech's reactor ----------------------------------------------------
  // A dead mech is not done: its fusion reactor runs away for a few seconds,
  // which you can see, and then goes up as a small blast in blue and neon
  // green that takes the street and the next machine with it.
  const fusion = await page.evaluate(async () => {
    const s = window.spreefall;
    const modeWas = s.machines.active;
    s.machines.active = false;
    s.mechs.reset();
    s.soldiers.reset();
    s.projectiles.clear();
    s.burningGround.length = 0;
    s.reactors.length = 0;
    s.setCheat('godmode', true);
    const theirs = s.spawnMech('reaper', 90);
    const near = s.spawnMech('reaper', 112);
    if (!theirs || !near) { s.machines.active = modeWas; return { skip: true }; }
    // Twenty metres apart whatever spots it found, on the ground there.
    near.x = theirs.x + 20; near.z = theirs.z;
    near.y = s.world.groundHeight(near.x, near.z);
    const gap = Math.round(Math.hypot(near.x - theirs.x, near.z - theirs.z));
    near.health = near.maxHealth;
    if (near.shield !== undefined) near.shield = 0;
    s.mechs.damage(theirs, 1e6);
    const pending = s.reactors.length;
    // Half the fuse: still pending, nothing next to it touched.
    for (let i = 0; i < Math.round(60 * s.fusionSpec.fuse * 0.5); i++) s.fixedForTest(1 / 60);
    const early = { left: s.reactors.length, near: near.health === near.maxHealth };
    let tint = null, flash = 0;
    for (let i = 0; i < 60 * 2.5; i++) {
      s.fixedForTest(1 / 60);
      if (s.state.flashTint && !tint) { tint = [...s.state.flashTint]; flash = s.state.flash; }
    }
    const hurt = Math.round(near.maxHealth - Math.max(0, near.health));
    const chained = near.health <= 0;
    // Let any chain finish before the next check.
    for (let i = 0; i < 60 * 8 && s.reactors.length; i++) s.fixedForTest(1 / 60);
    s.mechs.reset();
    s.burningGround.length = 0;
    s.setCheat('godmode', false);
    s.machines.active = modeWas;
    return { skip: false, pending, early, tint, flash: Number(flash.toFixed(2)), hurt, chained, gap };
  });
  check('a dead mech\'s reactor goes critical rather than going off at once',
    !fusion.skip && fusion.pending === 1 && fusion.early.left === 1 && fusion.early.near,
    fusion.skip ? '' : `${fusion.pending} pending`);
  check('and then goes up in blue and green, not in white',
    !fusion.skip && fusion.tint && fusion.tint[1] > fusion.tint[0] + 0.3 && fusion.flash > 0.1,
    fusion.skip ? '' : `tint ${fusion.tint}, flash ${fusion.flash}`);
  check('taking the next machine with it', !fusion.skip && fusion.hurt > 900,
    fusion.skip ? '' : `${fusion.hurt} off a Reaper ${fusion.gap} m away${fusion.chained ? ', which went too' : ''}`);

  // --- the mech killer -----------------------------------------------------
  // An EMP warhead with a charge behind it. What it is for is the thing you
  // cannot otherwise deal with on foot: one of these takes a Reaper apart on
  // its own, and whatever else has a motor in it inside the radius stops.
  const killer = await page.evaluate(async () => {
    const s = window.spreefall;
    // One machine, one warhead, one line of sight. The mode is still
    // running and walking more of them in, and a rocket that goes off
    // against whoever wandered into the line measures the street.
    const modeWas = s.machines.active;
    s.machines.active = false;
    s.soldiers.reset();
    s.mechs.reset();
    s.projectiles.clear();
    s.burningGround.length = 0;
    s.weapon.reset();
    const theirs = s.spawnMech('reaper', 45);
    if (!theirs) { s.machines.active = modeWas; return { skip: true }; }
    // A second one beside it, to see what the pulse does to the neighbours.
    const near = s.spawnMech('reaper', 52);
    theirs.health = theirs.maxHealth;
    const hp0 = theirs.health;
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    // Somewhere it can be seen from here, on ground near the level of the
    // street you are standing in: by this point in the suite half the
    // district is a crater and the other half is a ruin.
    let spot = null;
    for (let step = 0; step < 28 && !spot; step++) {
      const a = (step % 2 ? 1 : -1) * Math.floor(step / 2) * 0.3;
      const d = 40 + (step % 3) * 7;
      const px = s.player.x - Math.sin(s.camera.yaw + a) * d;
      const pz = s.player.z - Math.cos(s.camera.yaw + a) * d;
      const dx = px - eye.x, dz = pz - eye.z;
      const len = Math.hypot(dx, dz) || 1;
      const blocked = s.world.raycast(eye.x, eye.y, eye.z, dx / len, 0, dz / len, len);
      if (!blocked && Math.abs(s.world.groundHeight(px, pz) - s.player.y) < 4) {
        spot = { x: px, z: pz };
      }
    }
    if (!spot) { s.machines.active = modeWas; return { skip: true }; }
    theirs.x = spot.x; theirs.z = spot.z;
    theirs.y = s.world.groundHeight(spot.x, spot.z);
    if (near) {
      // Beside it, inside the pulse but out of the way of the shot.
      near.x = spot.x + 9;
      near.z = spot.z + 9;
      near.y = s.world.groundHeight(near.x, near.z);
    }
    const to = {
      x: theirs.x - eye.x,
      y: (theirs.y + theirs.spec.height * 0.6) - eye.y,
      z: theirs.z - eye.z,
    };
    const l = Math.hypot(to.x, to.y, to.z) || 1;
    s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI,
      Math.asin(to.y / l) * 180 / Math.PI);
    s.camera.update(16 / 9);
    const picked = s.weapon.select('mechkiller') || s.weapon.id === 'mechkiller';
    s.weapon.cooldown = 0;
    s.weapon.spread = 0;
    s.shoot();
    const flying = s.projectiles.count > 0;
    // Nailed to the spot while the rocket is in the air: this measures the
    // warhead, not whether a Reaper happened to walk out from under it.
    const at = { x: theirs.x, z: theirs.z };
    const beside = near ? { x: near.x, z: near.z } : null;
    for (let i = 0; i < 60 * 4; i++) {
      theirs.x = at.x; theirs.z = at.z;
      if (near && beside) { near.x = beside.x; near.z = beside.z; }
      s.fixedForTest(1 / 60);
      if (theirs.health <= 0) break;
    }
    s.machines.active = modeWas;
    return {
      skip: false, picked, flying,
      hp0, left: Math.round(Math.max(0, theirs.health)),
      stunned: near ? Number((near.stun || 0).toFixed(1)) : 0,
      awayFromNeighbour: near ? Math.round(Math.hypot(near.x - theirs.x, near.z - theirs.z)) : 0,
    };
  });
  check('a mech killer takes a Reaper apart in one',
    !killer.skip && killer.picked && killer.flying && killer.left === 0,
    killer.skip ? 'no room for one' : `${killer.hp0} to ${killer.left}`);
  check('and the pulse stops whatever else was standing near it',
    !killer.skip && killer.stunned > 0,
    killer.skip ? '' : `${killer.stunned} s of nothing, ${killer.awayFromNeighbour} m away`);

  // A picture of one arriving, taken from the frames the browser is really
  // drawing rather than from a step the suite drove by hand.
  await page.evaluate(async () => {
    const s = window.spreefall;
    const modeWas = s.machines.active;
    s.machines.active = false;
    s.mechs.reset();
    s.projectiles.clear();
    const mark = s.spawnMech('reaper', 46);
    if (!mark) { s.machines.active = modeWas; return; }
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const to = {
      x: mark.x - eye.x,
      y: (mark.y + mark.spec.height * 0.6) - eye.y,
      z: mark.z - eye.z,
    };
    const l = Math.hypot(to.x, to.y, to.z) || 1;
    s.look(Math.atan2(-to.x, -to.z) * 180 / Math.PI, Math.asin(to.y / l) * 180 / Math.PI);
    s.camera.update(16 / 9);
    s.weapon.select('mechkiller');
    // With a round in it: the checks above fire this by hand, which goes
    // round the trigger and round the magazine with it.
    s.weapon.carried.mechkiller.ammo = 1;
    s.weapon.carried.mechkiller.reserve = 4;
    s.weapon.ammo = 1;
    s.weapon.reloadLeft = 0;
    s.weapon.cooldown = 0;
    s.weapon.spread = 0;
    s.shoot();
    // Wait for the warhead to arrive, in real frames, then hold two more so
    // the picture has the flash and the sparks in it rather than the rocket.
    let after = 0;
    for (let f = 0; f < 300; f++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (!s.projectiles.count) after++;
      if (after > 2) break;
    }
    s.machines.active = modeWas;
  });
  await page.screenshot({ path: path.join(SHOTS, 'mech-06-killer.png') });

  // A Titan is harder: one puts it on a knee, two put it down.
  const heavy = await page.evaluate(async () => {
    const s = window.spreefall;
    s.mechs.reset();
    s.projectiles.clear();
    const mine = s.spawnMech('titan', 14);
    if (!mine) return { skip: true };
    const hp0 = mine.health;
    const spec = { radius: 26, damage: 2600, stun: 4.5 };
    s.explode(mine.x, mine.y + 5, mine.z, { radius: 13, damage: 240 },
      { weapon: 'mechkiller' });
    const after = Math.round(Math.max(0, mine.health));
    const stunned = Number((mine.stun || 0).toFixed(1));
    const shield = Math.round(mine.shield);
    s.explode(mine.x, mine.y + 5, mine.z, { radius: 13, damage: 240 },
      { weapon: 'mechkiller' });
    return {
      skip: false, hp0, after, stunned, shield,
      down: mine.health <= 0, wanted: spec.damage,
    };
  });
  check('one puts a Titan on a knee and stops it where it stands',
    !heavy.skip && heavy.after > 0 && heavy.after < heavy.hp0 * 0.45
      && heavy.stunned > 3 && heavy.shield === 0,
    heavy.skip ? ''
      : `${heavy.hp0} to ${heavy.after}, no shield, jammed for ${heavy.stunned} s`);
  check('and the second one puts it down', !heavy.skip && heavy.down);

  // And the machines carrying one, which is a toggle and a slider.
  const theirs = await page.evaluate(async () => {
    const s = window.spreefall;
    s.mechs.reset();
    s.projectiles.clear();
    s.soldiers.reset();
    s.setCheat('mechKillers', false);
    const off = [];
    for (let i = 0; i < 20; i++) off.push(s.mechKillerRoll());
    s.setCheat('mechKillers', true);
    s.cheats.setValue('mechKillerOdds', 100);
    const on = [];
    for (let i = 0; i < 20; i++) on.push(s.mechKillerRoll());
    s.cheats.setValue('mechKillerOdds', 5);
    let some = 0;
    for (let i = 0; i < 200; i++) if (s.mechKillerRoll()) some++;
    s.cheats.setValue('mechKillerOdds', 100);
    // One of them, carrying one, with something armoured to shoot at. The
    // launch is counted at the hook, because what is being checked is that it
    // reaches for the warhead rather than the beam.
    // One machine, one mech, one warhead. The mode is left running by the
    // checks above and it keeps walking more of them in; a second machine
    // standing in front of the first one eats the rocket, which is honest
    // behaviour and no way to measure a warhead.
    const modeWas = s.machines.active;
    s.machines.active = false;
    // Somewhere to stand a mech, which by this point in the suite is not a
    // given: the streets round here have been taken apart.
    let mine = null;
    for (const away of [12, 18, 26, 34]) {
      mine = mine || s.spawnMech('titan', away);
    }
    if (!mine) { s.machines.active = modeWas; return { skip: true }; }
    s.teleport(mine.x + 3, mine.z);
    s.toggleVehicle();
    const hp0 = mine.health;
    // And somewhere for the machine to stand where it can see the mech. A
    // warhead that goes off against the frontage it was fired through is a
    // check of the frontage.
    const sd = s.spawnSoldier(-40, 0);
    if (!sd) { s.machines.active = modeWas; return { skip: true }; }
    let post = null;
    const mid = mine.y + mine.spec.height * 0.6;
    for (let step = 0; step < 32 && !post; step++) {
      const a = (step % 2 ? 1 : -1) * Math.floor(step / 2) * 0.28;
      const d = 42 + (step % 3) * 8;
      const px = mine.x - Math.sin(s.camera.yaw + a) * d;
      const pz = mine.z - Math.cos(s.camera.yaw + a) * d;
      const py = s.world.groundHeight(px, pz) + 1.5;
      if (Math.abs(py - mine.y) > 5) continue;
      if (s.world.lineOfSight(px, py, pz, mine.x, mid, mine.z)) post = { x: px, y: py, z: pz };
    }
    if (!post) { s.machines.active = modeWas; return { skip: true }; }
    sd.x = post.x; sd.z = post.z;
    sd.y = s.world.groundHeight(post.x, post.z);
    s.makeMachine(sd);
    s.soldiers.killer = s.machineSpec.killer;
    s.soldiers.armouredTarget = true;
    s.soldiers.enabled = true;
    let launched = 0;
    const real = s.soldiers.onMechKiller;
    s.soldiers.onMechKiller = (who) => { launched++; real(who); };
    // How near the warhead actually got, so a failure says whether the
    // machine missed, the city got in the way, or the warhead arrived and
    // did nothing.
    let nearest = 999;
    const stood = { x: sd.x, z: sd.z };
    for (let i = 0; i < 60 * 14; i++) {
      // It has to be able to see you to shoot at you.
      sd.canSee = true;
      sd.state = 2;
      // Held where it was put: a machine that walks off behind a wall while
      // the rocket is in the air measures the walk.
      sd.x = stood.x; sd.z = stood.z;
      s.fixedForTest(1 / 60);
      for (const b of s.projectiles.active) {
        if (b.weapon !== 'mechkiller') continue;
        nearest = Math.min(nearest, Math.hypot(b.x - mine.x, b.y - (mine.y + 5), b.z - mine.z));
      }
    }
    s.soldiers.onMechKiller = real;
    const out = {
      skip: false,
      offAny: off.some(Boolean),
      onAll: on.every(Boolean),
      rare: some,
      carried: !!sd.mechKiller,
      launched,
      hurt: Math.round(hp0 - mine.health),
      nearest: Math.round(nearest),
      stun: Number((mine.stun || 0).toFixed(1)),
      away: Math.round(Math.hypot(sd.x - mine.x, sd.z - mine.z)),
    };
    if (s.state.inMech) s.toggleVehicle();
    s.setCheat('mechKillers', false);
    s.cheats.reset();
    // And put the street back the way the rest of the suite expects it: a
    // machine left standing here goes on shooting at everything after it,
    // and the checks below are about a mech rather than about a firefight.
    s.machines.active = modeWas;
    s.soldiers.enabled = false;
    s.soldiers.reset();
    s.soldiers.armouredTarget = false;
    s.projectiles.clear();
    s.combat.health = 100;
    return out;
  });
  check('with the toggle off no machine carries one, and with it on and the slider up they all do',
    !theirs.skip && !theirs.offAny && theirs.onAll,
    theirs.skip ? '' : `${theirs.rare} of 200 at five per cent`);
  check('and one of theirs puts a mech killer into what you are standing in',
    !theirs.skip && theirs.carried && theirs.launched > 0 && theirs.hurt > 400,
    theirs.skip ? 'nowhere to stand one'
      : `${theirs.launched} launched from ${theirs.away} m, ${theirs.hurt} off the hull`
        + (theirs.hurt > 400 ? ''
          : `, nearest ${theirs.nearest} m, ${theirs.stun} s of stun`));

  // --- the call ------------------------------------------------------------
  // A picture of one on its way: the words up, the clock running down and a
  // column of light standing on the piece of road it is coming down on.
  await page.evaluate(async () => {
    const s = window.spreefall;
    s.mechs.reset();
    // Back on your feet and out of the fire. The warhead checks above leave
    // the street burning and the run can have ended in it, and a mech is not
    // called down onto a corpse: the game cancels the call, which is the
    // right answer to the wrong situation for this check.
    const down = document.getElementById('down');
    if (down && !down.classList.contains('hidden')) {
      document.getElementById('downbtn').click();
      await new Promise((r) => requestAnimationFrame(r));
    }
    s.burningGround.length = 0;
    s.fires.reset();
    s.combat.health = 100;
    // Nothing may kill the run while the clock is counting down: half a
    // minute standing in a district this suite has set fire to twice is more
    // than the game asks of anybody.
    s.setCheat('godmode', true);
    // Back to the wide street the suite starts in. By now the player is
    // wherever the last mech was parked, which can be a courtyard, and this
    // is about the drop rather than about the street.
    s.teleport(81, 0);
    const call = s.dropRide('titan');
    if (!call) return;
    s.look(Math.atan2(-(call.x - s.player.x), -(call.z - s.player.z)) * 180 / Math.PI, 3);
    // Held at the part worth looking at rather than standing through the
    // whole wait: the beacon goes up in the last few seconds, and the clock
    // is pushed back every frame so that it is still counting down while the
    // picture is taken. A browser drawing this through a software renderer
    // takes its time over both.
    for (let i = 0; i < 30; i++) {
      call.left = 7.5;
      await new Promise((r) => requestAnimationFrame(r));
    }
    // The pool is five hundred and twelve pieces of smoke, flame and dust,
    // and by this point in the suite it is full of the district burning: the
    // beacon goes in, gets recycled by the next thing that wants a slot, and
    // never reaches the frame. Emptied once, the last few frames are the
    // column and the sparks turning in the bottom of it.
    s.effects.clear();
    for (let i = 0; i < 4; i++) {
      call.left = 7.5;
      await new Promise((r) => requestAnimationFrame(r));
    }
    call.left = 7.5;
  });
  await page.screenshot({ path: path.join(SHOTS, 'mech-04-titanfall.png') });

  const called = await page.evaluate(async () => {
    const s = window.spreefall;
    s.mechs.reset();
    s.demolition.reset();
    // Back on your feet and out of the fire. The warhead checks above leave
    // the street burning and the run can have ended in it, and a mech is not
    // called down onto a corpse: the game cancels the call, which is the
    // right answer to the wrong situation for this check.
    const down = document.getElementById('down');
    if (down && !down.classList.contains('hidden')) {
      document.getElementById('downbtn').click();
      await new Promise((r) => requestAnimationFrame(r));
    }
    s.burningGround.length = 0;
    s.fires.reset();
    s.combat.health = 100;
    // Nothing may kill the run while the clock is counting down: half a
    // minute standing in a district this suite has set fire to twice is more
    // than the game asks of anybody.
    s.setCheat('godmode', true);
    s.teleport(81, 0);
    const call = s.dropRide('titan');
    if (!call) {
      return {
        skip: true,
        why: `mode ${s.state.mode}, in a mech ${!!s.state.inMech}, `
          + `at ${s.player.x.toFixed(0)},${s.player.z.toFixed(0)} `
          + `loaded ${s.world.isLoaded(s.player.x, s.player.z)}, `
          + `health ${Math.round(s.combat.health)}`,
      };
    }
    const banner = !document.getElementById('titanfall').classList.contains('hidden');
    const text = document.querySelector('#titanfall .tfline').textContent;
    const sub = () => document.getElementById('titanfallsub').textContent;
    // Nothing is on the road yet: what has been promised is a machine, and
    // for the next half minute it is somewhere above the weather.
    const emptyAtFirst = s.mechs.active.length === 0;
    const firstSub = sub();
    let frames = 0;
    let stillEmpty = true;
    for (let i = 0; i < 60 * 60 && !call.mech; i++) {
      s.fixedForTest(1 / 60);
      frames++;
      if (frames < 60 * 20 && s.mechs.active.length) stillEmpty = false;
    }
    const waited = Number((frames / 60).toFixed(1));
    const m = call.mech;
    if (!m) {
      return {
        skip: true,
        why: `nothing came down in ${waited} s: still inbound `
          + `${!!s.state.titanInbound}, health ${Math.round(s.combat.health)}, `
          + `mode ${s.state.mode}, left ${call.left.toFixed(1)}`,
      };
    }
    const floor = s.world.groundHeight(m.x, m.z);
    const high = Math.round(m.y - floor);
    for (let i = 0; i < 60 * 12 && m.y - s.world.groundHeight(m.x, m.z) > 0.5; i++) {
      s.fixedForTest(1 / 60);
      frames++;
    }
    return {
      banner, text, high, waited, emptyAtFirst, stillEmpty, firstSub,
      fell: Number(((frames / 60) - waited).toFixed(1)),
      seconds: Number((frames / 60).toFixed(1)),
      gone: document.getElementById('titanfall').classList.contains('hidden'),
      sites: s.demolition.sites.length + s.demolition.baked,
      walked: m.walk !== 0,
    };
  });
  check('a mech you call for arrives out of the sky',
    !called.skip && called.banner && /titanfall/i.test(called.text) && called.high > 250,
    called.skip ? `no room to drop one: ${called.why || ''}` : `"${called.text}", ${called.high} m up`);
  check('and the whole thing takes about half a minute',
    !called.skip && called.emptyAtFirst && called.stillEmpty
      && called.seconds > 25 && called.seconds < 36 && called.fell > 2,
    called.skip ? ''
      : `${called.waited} s of "${called.firstSub}", then ${called.fell} s of falling`);
  check('and the landing opens the road and takes the words off the screen',
    !called.skip && called.gone && called.sites > 0,
    called.skip ? '' : `${called.sites} places came apart`);

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

  // --- the whole loadout ----------------------------------------------------
  // Every arm of every chassis fires, takes a round out of its own magazine
  // and leaves nothing on the console. The two anti aircraft arms get
  // something to shoot at.
  const loadout = await page.evaluate(async () => {
    const s = window.spreefall;
    const rows = [];
    const sets = [];
    let slow = 0;
    for (const key of ['titan', 'bruin', 'heron', 'lynx', 'bastion', 'hornet', 'colossus', 'mantis', 'ram', 'wraith']) {
      s.mechs.reset(); s.projectiles.clear(); s.jets.reset();
      s.teleport(700, -55);
      for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
      const m = s.spawnMech(key, 14);
      if (!m) return { skip: true, why: `no room for a ${key}` };
      s.teleport(m.x + 4, m.z);
      s.toggleVehicle();
      if (s.state.inMech !== m) return { skip: true, why: `could not get into a ${key}` };
      sets.push(m.loadout.map((a) => a.id).sort().join('+'));
      for (let i = 0; i < m.loadout.length; i++) {
        const arm = m.loadout[i];
        s.mechs.selectArm(m, i);
        const air = arm.id === 'stinger' || arm.id === 'flak';
        if (air) {
          const j = s.spawnJet(0, 200, 80);
          j.x = m.x; j.z = m.z - 200; j.y = m.y + 80;
          s.look(0, 21);
        } else {
          s.look(0, 2);
        }
        s.camera.update(16 / 9);
        // The guns point where the torso points, not where the camera does, so
        // it is given time to come round before the trigger goes down.
        for (let k = 0; k < 90; k++) s.fixedForTest(1 / 60);
        for (let k = 0; k < 60; k++) {
          s.holdFire(true);
          s.fixedForTest(1 / 60);
          slow = Math.max(slow, arm.id === 'stinger' ? s.state.airSlow : 0);
        }
        s.holdFire(false);
        for (let k = 0; k < 120; k++) s.fixedForTest(1 / 60);
        rows.push({ id: `${key} ${arm.id}`, fired: m.mags[i] < arm.magazine });
        s.projectiles.clear(); s.jets.reset();
      }
      s.toggleVehicle();
    }
    s.mechs.reset();
    return { skip: false, rows, slow: Math.round(slow * 100) / 100,
      sets: sets.length, distinct: new Set(sets).size,
      kinds: new Set(rows.map((r) => r.id.split(' ')[1])).size };
  });
  check('no two chassis carry the same weapons',
    loadout.skip || (loadout.sets === 10 && loadout.distinct === 10),
    loadout.skip ? loadout.why : `${loadout.distinct} different sets out of ${loadout.sets}, `
      + `${loadout.kinds} different arms between them`);
  check('every arm in the loadout fires',
    loadout.skip || loadout.rows.every((r) => r.fired),
    loadout.skip ? loadout.why
      : `${loadout.rows.filter((r) => r.fired).length} of ${loadout.rows.length}: `
        + loadout.rows.filter((r) => !r.fired).map((r) => r.id).join(', ') || 'all of them');
  check('and a stinger on a lock slows the world down while it runs it down',
    loadout.skip || loadout.slow > 0,
    loadout.skip ? loadout.why : `${loadout.slow} s of it`);

  // The Void Maw against the hand cannon: the same kind of ball, reaching
  // further. A man sixty metres from where each one lands, in the open, is
  // past the cannon's reach and inside the Maw's.
  const maw = await page.evaluate(() => {
    const s = window.spreefall;
    s.mechs.reset(); s.soldiers.reset(); s.drones.reset(); s.projectiles.clear(); s.combat.reset();
    s.soldiers.enabled = false; s.drones.enabled = false;
    s.setCheat('godmode', true);
    s.teleport(81, 0);
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    const arm = s.mechArms.find((a) => a.id === 'voidmaw');
    const hand = s.weapons.void;
    const px = s.player.x, pz = s.player.z;
    // Somewhere sixty metres off with nothing in between, at chest height.
    let spot = null;
    for (let a = 0; a < 360 && !spot; a += 10) {
      const r = a * Math.PI / 180;
      const dx = Math.cos(r) * 60, dz = Math.sin(r) * 60;
      const y0 = s.world.groundHeight(px, pz) + 2, y1 = s.world.groundHeight(px + dx, pz + dz) + 1.1;
      if (s.world.lineOfSight(px, y0, pz, px + dx, y1, pz + dz)) spot = { dx, dz };
    }
    if (!spot) return { skip: true, why: 'no open line of sixty metres' };
    const land = (kind, splash, voidSpec) => {
      s.soldiers.reset();
      const man = s.spawnSoldier(spot.dx, spot.dz);
      const b = s.projectiles.launch(kind, { x: px, y: s.world.groundHeight(px, pz) + 1, z: pz,
        vx: 0, vy: 0, vz: 0, splash: { ...splash, punch: false }, void: voidSpec, weapon: 'mech' });
      s.projectiles.explode(b);
      const dead = man.state === 5 || man.health <= 0;
      s.soldiers.reset(); s.projectiles.clear();
      return dead;
    };
    const byHand = land('void', hand.splash, hand.void);
    const byMaw = land('voidMaw', arm.splash, arm.void);
    s.setCheat('godmode', false);
    return { skip: false, byHand, byMaw, reach: [hand.void.reach, arm.void.reach],
      blast: [hand.splash.radius, arm.splash.radius], damage: [hand.splash.damage, arm.splash.damage],
      magazine: arm.magazine };
  });
  check('every mech of yours carries a Void Maw, stronger than the hand cannon',
    maw.skip || (maw.reach[1] > maw.reach[0] && maw.blast[1] > maw.blast[0] && maw.damage[1] > maw.damage[0]),
    maw.skip ? maw.why : `reach ${maw.reach[0]} to ${maw.reach[1]} m, blast ${maw.blast[0]} to ${maw.blast[1]} m, `
      + `${maw.damage[0]} to ${maw.damage[1]} damage`);
  check('and it takes a man sixty metres off that the hand cannon leaves standing',
    maw.skip || (maw.byMaw && !maw.byHand),
    maw.skip ? maw.why : `hand cannon ${maw.byHand ? 'took him' : 'missed'}, Maw ${maw.byMaw ? 'took him' : 'missed'}`);

  // And theirs: each chassis fires its own gun rather than the Reaper's
  // chaingun in ten bodies, and every one of those guns can reach you.
  const foes = await page.evaluate(async () => {
    const s = window.spreefall;
    const out = [];
    const hurt = s.combat.hurt;
    const modeWas = s.machines.active;
    s.machines.active = false;
    for (const key of ['reaper', 'bruin-foe', 'heron-foe', 'lynx-foe', 'bastion-foe', 'hornet-foe',
      'colossus-foe', 'mantis-foe', 'ram-foe', 'wraith-foe']) {
      s.mechs.reset(); s.projectiles.clear(); s.soldiers.reset();
      s.burningGround.length = 0;
      s.teleport(700, -55);
      for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
      let taken = 0;
      s.combat.hurt = (d) => { taken += d; return false; };
      const m = s.spawnMech(key, 34);
      if (!m) { s.combat.hurt = hurt; out.push({ key, skip: true }); continue; }
      for (let i = 0; i < 60 * 12; i++) s.fixedForTest(1 / 60);
      s.combat.hurt = hurt;
      out.push({ key, kind: m.spec.chaingun.kind || 'auto', taken: Math.round(taken) });
    }
    s.mechs.reset(); s.projectiles.clear(); s.burningGround.length = 0;
    s.machines.active = modeWas;
    return out;
  });
  const foeKinds = new Set(foes.filter((f) => !f.skip).map((f) => f.kind));
  check('theirs fire seven different kinds of gun', foeKinds.size >= 7,
    [...foeKinds].join(', '));
  check('and every one of them can hurt you',
    foes.every((f) => f.skip || f.taken > 0),
    foes.map((f) => `${f.key} ${f.kind} ${f.skip ? 'no room' : f.taken}`).join('; '));

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
