// Berlin as districts: the index, the streaming, and the seams.
//
// A districted city has three ways to be quietly wrong, and all three of them
// look fine in a screenshot. The tile grid can disagree with itself, so two
// districts claim the same ground or leave a strip between them. The ground
// can arrive before or after the thing standing on it, so you walk into a
// street that has no collision or fall through one that has no height field.
// And a district can be let go while something still points into its bytes,
// which is a crash a minute later rather than a crash now. So this suite
// counts tiles, walks across boundaries, drops districts under the player's
// feet and asks the simulation to keep running afterwards.
//
// It needs more than one district built. With only the middle one in the
// index the streaming checks say so and skip rather than pass by default.
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
    s.setQuality('low');
  });
  await page.waitForTimeout(3500);

  // --- the index ----------------------------------------------------------
  const index = await page.evaluate(() => {
    const s = window.spreefall;
    const w = s.world;
    return {
      grid: [w.nx, w.nz],
      size: [Math.round(w.maxX - w.minX), Math.round(w.maxZ - w.minZ)],
      districts: w.catalogue.map((d) => ({
        id: d.id, name: d.name, tier: d.tier,
        tx: d.tx, tz: d.tz, nx: d.nx, nz: d.nz,
        mb: Math.round(d.bytes / 1e5) / 10,
      })),
      loaded: w.loadedIds,
      home: w.home,
      here: w.nameAt(s.player.x, s.player.z),
    };
  });
  const many = index.districts.length > 1;
  check('the city is one tile grid, whoever built the pieces',
    index.grid[0] > 100 && index.grid[1] > 60,
    `${index.grid[0]} by ${index.grid[1]} tiles, ${(index.size[0] / 1000).toFixed(1)} by ${(index.size[1] / 1000).toFixed(1)} km`);
  check('and the districts in it do not overlap', (() => {
    const seen = new Set();
    for (const d of index.districts) {
      for (let j = 0; j < d.nz; j++) {
        for (let i = 0; i < d.nx; i++) {
          const key = (d.tz + j) * index.grid[0] + (d.tx + i);
          if (seen.has(key)) return false;
          seen.add(key);
        }
      }
    }
    return true;
  })(), `${index.districts.length} districts, ${index.districts.reduce((a, d) => a + d.nx * d.nz, 0)} tiles between them`);
  // The streamer has had a few seconds by now, so the neighbour may well be
  // in already. What has to be true is that you start in the middle of town
  // and that the whole city is not in memory.
  check('you start in the middle of town',
    index.loaded.includes(index.home) && index.here === 'Mitte',
    `${index.here}, holding ${index.loaded.join(', ')}`);
  check('and the index says what each district costs',
    index.districts.every((d) => d.mb > 0),
    index.districts.map((d) => `${d.id} ${d.mb} MB`).join(', '));

  // --- it only holds what is near -----------------------------------------
  const held = await page.evaluate(() => {
    const s = window.spreefall;
    return {
      bytes: Math.round(s.world.residentBytes / 1e5) / 10,
      tiles: s.world.tiles.filter(Boolean).length,
      all: s.world.catalogue.reduce((a, d) => a + d.bytes, 0),
    };
  });
  check('memory holds one district, not the city',
    held.bytes * 1e5 <= held.all * 0.95 || !many,
    `${held.bytes} MB of ${Math.round(held.all / 1e5) / 10} MB, ${held.tiles} tiles live`);

  // --- walking into the next one ------------------------------------------
  const neighbour = await page.evaluate(() => {
    const s = window.spreefall;
    const home = s.world.entryFor(s.world.home);
    let best = null, bestAway = Infinity;
    for (const d of s.world.catalogue) {
      if (d.id === home.id) continue;
      const away = Math.hypot(
        (d.bounds.minX + d.bounds.maxX) / 2 - (home.bounds.minX + home.bounds.maxX) / 2,
        (d.bounds.minZ + d.bounds.maxZ) / 2 - (home.bounds.minZ + home.bounds.maxZ) / 2,
      );
      if (away < bestAway) { bestAway = away; best = d; }
    }
    return best;
  });

  if (!many) {
    check('a second district to walk into', false, 'only one district is built, run npm run world:offline');
  } else {
    // Stand on our side of the boundary and walk across it.
    const crossing = await page.evaluate(async (other) => {
      const s = window.spreefall;
      const home = s.world.entryFor(s.world.home);
      // The shared edge, in metres, and a point either side of it.
      const sharedX = Math.abs(other.bounds.maxX - home.bounds.minX) < 1
        ? home.bounds.minX
        : (Math.abs(other.bounds.minX - home.bounds.maxX) < 1 ? home.bounds.maxX : null);
      const z = Math.max(home.bounds.minZ, other.bounds.minZ) + 80;
      if (sharedX === null) return { skip: true };
      const inside = sharedX === home.bounds.minX ? sharedX + 25 : sharedX - 25;
      const beyond = sharedX === home.bounds.minX ? sharedX - 25 : sharedX + 25;
      s.teleport(inside, z);
      // Put the neighbour back on the wire first, so what is being measured
      // is the arrival of a district rather than one that is already here.
      s.world.unloadDistrict(other.id);
      const before = {
        loaded: s.world.loadedIds.slice(),
        isLoadedBeyond: s.world.isLoaded(beyond, z),
      };
      const t0 = performance.now();
      await s.world.loadDistrict(other.id);
      const after = {
        ms: Math.round(performance.now() - t0),
        loaded: s.world.loadedIds.slice(),
        isLoadedBeyond: s.world.isLoaded(beyond, z),
        groundInside: Math.round(s.world.groundHeight(inside, z) * 100) / 100,
        groundBeyond: Math.round(s.world.groundHeight(beyond, z) * 100) / 100,
        nameBeyond: s.world.nameAt(beyond, z),
        tiles: s.world.tiles.filter(Boolean).length,
      };
      return { before, after, inside, beyond, z };
    }, neighbour);

    if (crossing.skip) {
      check('the two districts share an edge', false, 'the nearest one is not next door');
    } else {
      check('the ground beyond the boundary is not there before the district is',
        crossing.before.isLoadedBeyond === false,
        `${crossing.before.loaded.join(', ')} loaded`);
      check('and it is there afterwards, at a height that matches this side',
        crossing.after.isLoadedBeyond === true
          && Math.abs(crossing.after.groundBeyond - crossing.after.groundInside) < 1.2,
        `${crossing.after.groundInside} m inside, ${crossing.after.groundBeyond} m beyond`);
      check('the district says its own name',
        !!crossing.after.nameBeyond && crossing.after.nameBeyond !== crossing.before.name,
        crossing.after.nameBeyond);

      // The seam itself: no hole, no double floor. Sampled across the edge.
      const seam = await page.evaluate((at) => {
        const s = window.spreefall;
        const out = [];
        for (let d = -40; d <= 40; d += 4) {
          const x = at.inside < at.beyond ? at.inside + d : at.inside - d;
          out.push(Math.round(s.world.groundHeight(x, at.z) * 100) / 100);
        }
        let worst = 0;
        for (let i = 1; i < out.length; i++) {
          worst = Math.max(worst, Math.abs(out[i] - out[i - 1]));
        }
        return { worst: Math.round(worst * 100) / 100, samples: out.length };
      }, crossing);
      check('and the ground does not step at the seam', seam.worst < 0.45,
        `worst step ${seam.worst} m over ${seam.samples} samples across the edge`);

      // Walking it for real, rather than teleporting.
      const walked = await page.evaluate(async (at) => {
        const s = window.spreefall;
        const toward = at.beyond > at.inside ? 1 : -1;
        s.teleport(at.inside - toward * 6, at.z);
        const from = { x: s.player.x, y: s.player.y };
        for (let i = 0; i < 400; i++) {
          s.player.step(1 / 60, toward * 5.2, 0, false);
          await new Promise((r) => setTimeout(r, 0));
          if (Math.abs(s.player.x - at.beyond) < 3) break;
        }
        return {
          moved: Math.round((s.player.x - from.x) * toward * 10) / 10,
          y: Math.round(s.player.y * 100) / 100,
          dropped: from.y - s.player.y,
          where: s.world.nameAt(s.player.x, s.player.z),
        };
      }, crossing);
      check('you can walk across the boundary on your feet',
        walked.moved > 20 && walked.dropped < 1.5,
        `${walked.moved} m into ${walked.where}, ${walked.y} m up`);

      await page.screenshot({ path: path.join(SHOTS, 'district-01-across.png') });

      // --- letting one go ---------------------------------------------------
      // Measured on the district furthest from the one being dropped, because
      // next door is supposed to stay: the point of the drop distance is that
      // what is behind you is kept until it is properly behind you.
      const dropped = await page.evaluate(async () => {
        const s = window.spreefall;
        const home = s.world.entryFor(s.world.home);
        const hx = (home.bounds.minX + home.bounds.maxX) / 2;
        const hz = (home.bounds.minZ + home.bounds.maxZ) / 2;
        let far = null, bestAway = -1;
        for (const d of s.world.catalogue) {
          const away = Math.hypot((d.bounds.minX + d.bounds.maxX) / 2 - hx,
            (d.bounds.minZ + d.bounds.maxZ) / 2 - hz);
          if (away > bestAway) { bestAway = away; far = d; }
        }
        await s.world.loadDistrict(home.id);
        await s.world.loadDistrict(far.id);
        const x = (far.bounds.minX + far.bounds.maxX) / 2;
        const z = (far.bounds.minZ + far.bounds.maxZ) / 2;
        s.teleport(x, z);
        const homeTiles = s.world.entryFor(home.id);
        const first = homeTiles.tz * s.world.nx + homeTiles.tx;
        const before = {
          loaded: s.world.loadedIds.slice(),
          homeOnCard: s.tiles.resident.has(first),
          away: Math.round(bestAway),
        };
        s.world.keepAround(x, z, 900, 1500, 9);
        // And keep simulating, because a stale pointer into a district that
        // has gone is a crash on the next frame rather than on this one.
        for (let i = 0; i < 90; i++) {
          s.player.step(1 / 60, 2, 0, false);
          await new Promise((r) => requestAnimationFrame(r));
        }
        let onCard = 0;
        for (let j = 0; j < homeTiles.nz; j++) {
          for (let i = 0; i < homeTiles.nx; i++) {
            if (s.tiles.resident.has((homeTiles.tz + j) * s.world.nx + homeTiles.tx + i)) onCard++;
          }
        }
        return {
          before,
          after: s.world.loadedIds.slice(),
          homeTilesOnCard: onCard,
          tiles: s.world.tiles.filter(Boolean).length,
          bytes: Math.round(s.world.residentBytes / 1e5) / 10,
          standing: Math.round(s.player.y * 100) / 100,
          ground: Math.round(s.world.groundHeight(s.player.x, s.player.z) * 100) / 100,
          here: s.world.nameAt(s.player.x, s.player.z),
        };
      });
      check('a district you are a long way from is let go',
        !dropped.after.includes('core') && dropped.before.loaded.includes('core'),
        `${dropped.before.loaded.join(', ')} became ${dropped.after.join(', ')} from ${dropped.before.away} m away, ${dropped.bytes} MB held`);
      check('and not one of its tiles is left on the card',
        dropped.homeTilesOnCard === 0,
        `${dropped.homeTilesOnCard} of the dropped district's tiles still resident`);
      check('and the simulation carries on standing on what is left',
        Math.abs(dropped.standing - dropped.ground) < 1.0,
        `standing at ${dropped.standing} m on ground at ${dropped.ground} m in ${dropped.here}`);
    }
  }

  // --- the map ------------------------------------------------------------
  const map = await page.evaluate(() => {
    const s = window.spreefall;
    s.minimap.toggle({ x: s.player.x, z: s.player.z });
    const near = s.minimap.zoom;
    s.minimap.zoom = 1; s.minimap.centre = null;
    return { near, districts: s.world.catalogue.length };
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, 'district-02-map.png') });
  check('the map opens on the streets around you rather than on all of Berlin',
    map.near >= 4, `zoom ${map.near}`);

  const cityView = await page.evaluate(() => {
    const s = window.spreefall;
    const m = s.minimap;
    // Every district box has to land inside the canvas at the city view.
    const W = m.canvas.width, H = m.canvas.height;
    const fit = Math.min(W / (s.world.maxX - s.world.minX), H / (s.world.maxZ - s.world.minZ)) * 0.94;
    let inside = 0;
    for (const d of s.world.catalogue) {
      const mx = W / 2 + ((d.bounds.minX + d.bounds.maxX) / 2 - (s.world.minX + s.world.maxX) / 2) * fit;
      const my = H / 2 + ((d.bounds.minZ + d.bounds.maxZ) / 2 - (s.world.minZ + s.world.maxZ) / 2) * fit;
      if (mx > 0 && my > 0 && mx < W && my < H) inside++;
    }
    m.toggle();
    return { inside, total: s.world.catalogue.length };
  });
  check('and zoomed out the whole city fits on it',
    cityView.inside === cityView.total,
    `${cityView.inside} of ${cityView.total} districts on the canvas`);

  // --- travelling across the city -----------------------------------------
  if (many) {
    const flight = await page.evaluate(async (other) => {
      const s = window.spreefall;
      const home = s.world.entryFor(s.world.home);
      await s.world.loadDistrict(home.id);
      s.teleport((home.bounds.minX + home.bounds.maxX) / 2, (home.bounds.minZ + home.bounds.maxZ) / 2);
      // Let go of everything but here, so the flight has something to fetch.
      for (const id of s.world.loadedIds) {
        if (id !== home.id) s.world.unloadDistrict(id);
      }
      const far = s.world.entryFor(other.id);
      const tx = (far.bounds.minX + far.bounds.maxX) / 2;
      const tz = (far.bounds.minZ + far.bounds.maxZ) / 2;
      const started = s.beginTravel(tx, tz);
      const loadedAtStart = s.world.loadedIds.slice();
      for (let i = 0; i < 1800; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        if (s.state.mode === 'walk') break;
      }
      return {
        started,
        loadedAtStart,
        landedIn: s.world.nameAt(s.player.x, s.player.z),
        onGround: Math.abs(s.player.y - s.world.groundHeight(s.player.x, s.player.z)) < 1.2,
        out: Math.round(Math.hypot(s.player.x - tx, s.player.z - tz)),
        mode: s.state.mode,
      };
    }, neighbour);
    check('free travel reaches a district that was not in memory when it started',
      flight.started && flight.mode === 'walk' && flight.out < 6,
      `${flight.loadedAtStart.join(', ')} at take off, landed ${flight.out} m out in ${flight.landedIn}`);
    check('and puts you down on ground rather than in the air',
      flight.onGround);
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
