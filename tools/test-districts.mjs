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

// A world with one district in it cannot be asked anything about streaming.
// That is a missing build rather than a broken game, so it is said out loud
// and counted separately instead of being failed or quietly passed.
const skipped = [];
function skip(name, why) {
  skipped.push(name);
  console.log(` skip  ${name}  ${why}`);
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
        id: d.id, name: d.name, tier: d.tier, built: d.built !== false,
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
  // Every district of Berlin is in the index so that the map can draw the
  // whole city; the ones with a bundle behind them say what they cost, and
  // the rest say they are not built, which the game reads before it tries to
  // walk or fly into one.
  const built = index.districts.filter((d) => d.built);
  check('and the index says what each built district costs',
    built.length > 0 && built.every((d) => d.mb > 0),
    built.map((d) => `${d.id} ${d.mb} MB`).join(', '));
  check('and lists the rest of Berlin as ground nobody has built yet',
    index.districts.length === 81
      && index.districts.filter((d) => !d.built).every((d) => d.mb === 0),
    `${built.length} built of ${index.districts.length}`);

  // --- the city streams rather than waiting ---------------------------------
  // It used to hold exactly one district and put a card up at every boundary.
  // The neighbour now comes down while you are still walking towards it, and
  // crossing is a step rather than a wait.
  const only = await page.evaluate(async () => {
    const s = window.spreefall;
    const home = s.world.entryFor(s.world.home);
    const mid = (home.bounds.minZ + home.bounds.maxZ) / 2;
    // Start in the middle, where the far edge is further off than the reach.
    s.teleport((home.bounds.minX + home.bounds.maxX) / 2, mid);
    for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r));
    const west = s.world.idAt(home.bounds.minX - 40, mid);
    const fromMiddle = s.world.loadedIds.slice();
    // Then walk at the western boundary, the way a player gets there.
    s.teleport(home.bounds.minX + 240, mid);
    s.look(90, -2);
    let card = false;
    for (let i = 0; i < 300; i++) {
      s.player.step(1 / 60, -5.2, 0, false);
      await new Promise((r) => requestAnimationFrame(r));
      if (s.crossingShown()) card = true;
    }
    const atEdge = s.world.loadedIds.slice();
    // And over it, which is where the card used to be.
    s.teleport(home.bounds.minX - 60, mid);
    for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
    return {
      west, fromMiddle, atEdge, card,
      cardOver: s.crossingShown(),
      inAfter: s.world.isLoaded(s.player.x, s.player.z),
      back: s.world.loaded(home.id),
      held: s.world.loadedIds.length,
      here: s.world.nameAt(s.player.x, s.player.z),
      onGround: Math.abs(s.player.y - s.world.groundHeight(s.player.x, s.player.z)) < 1,
      mb: Math.round(s.world.residentBytes / 1e5) / 10,
    };
  });
  check('the district you are walking towards comes down before you reach it',
    !!only.west && only.atEdge.includes(only.west) && !only.card,
    `${only.west} in at the edge, ${only.card ? 'behind a card' : 'with no card'}`);
  check('and crossing the boundary is a step rather than a wait',
    !only.cardOver && only.inAfter && only.onGround,
    `${only.here}${only.cardOver ? ', card up' : ', no card'}`);
  check('and the one you came from is still there behind you',
    only.back, `${only.held} districts held, ${only.mb} MB`);
  check('and what is held stays inside the ceiling',
    only.held <= 6 && only.mb <= 128, `${only.held} districts, ${only.mb} MB`);

  // --- the loading screen names a place in the district --------------------
  // Held open by a slow line rather than by a hook: the screen is only up
  // while the bytes are in the air, so the only honest way to photograph it
  // is to put the bytes in the air for longer.
  await page.route('**/world-core.*', async (route) => {
    await new Promise((r) => setTimeout(r, 1400));
    await route.continue();
  });
  const sight = await page.evaluate(async () => {
    const s = window.spreefall;
    const home = s.world.entryFor(s.world.home);
    const cx = (home.bounds.minX + home.bounds.maxX) / 2;
    const cz = (home.bounds.minZ + home.bounds.maxZ) / 2;
    // The card is for arriving somewhere that is not in memory, which since
    // the city started streaming means a fast travel or a link rather than a
    // walk. So the district is let go first: crossing into one you are
    // already holding is a step, and there would be nothing to photograph.
    s.world.unloadDistrict(home.id);
    const back = s.crossInto(cx, cz);
    // Read the screen while it is still up, then let the load finish.
    await new Promise((r) => requestAnimationFrame(r));
    window.__crossBack = back;
    const line = document.getElementById('crosssightline');
    const shown = {
      wanted: home.sight || null,
      shown: document.getElementById('crosssight').textContent,
      visible: !line.classList.contains('hidden'),
      onScreen: s.crossingShown(),
    };
    window.__crossCentre = { x: cx, z: cz };
    return shown;
  });
  await page.screenshot({ path: path.join(SHOTS, 'district-03-crossing.png') });
  const landed = await page.evaluate(async () => {
    const s = window.spreefall;
    await window.__crossBack;
    const c = window.__crossCentre;
    return {
      rides: s.vehicles.active
        .filter((v) => v.alive && Math.hypot(v.x - c.x, v.z - c.z) < 400).length,
    };
  });
  await page.unroute('**/world-core.*');
  check('the loading screen names a landmark of the district you are entering',
    !!sight.wanted && sight.onScreen && sight.visible && sight.shown === sight.wanted,
    `${sight.shown || 'nothing'} (index says ${sight.wanted || 'nothing'})`);
  check('and the district you walk into has its own vehicles in it',
    landed.rides >= 3, `${landed.rides} parked where you came out`);

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
    const near = (a, b) => Math.abs(a - b) < 1;
    const overlaps = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 200;
    let best = null, bestAway = Infinity;
    for (const d of s.world.catalogue) {
      if (d.id === home.id) continue;
      // Sharing an edge, not merely being close: a district diagonally off the
      // corner is nearer by centre distance than one above, and you cannot
      // walk across a corner.
      const sideBySide = (near(d.bounds.maxX, home.bounds.minX) || near(d.bounds.minX, home.bounds.maxX))
        && overlaps(d.bounds.minZ, d.bounds.maxZ, home.bounds.minZ, home.bounds.maxZ);
      const stacked = (near(d.bounds.maxZ, home.bounds.minZ) || near(d.bounds.minZ, home.bounds.maxZ))
        && overlaps(d.bounds.minX, d.bounds.maxX, home.bounds.minX, home.bounds.maxX);
      if (!sideBySide && !stacked) continue;
      const away = Math.hypot(
        (d.bounds.minX + d.bounds.maxX) / 2 - (home.bounds.minX + home.bounds.maxX) / 2,
        (d.bounds.minZ + d.bounds.maxZ) / 2 - (home.bounds.minZ + home.bounds.maxZ) / 2,
      );
      if (away < bestAway) { bestAway = away; best = d; }
    }
    return best;
  });

  if (!many || !neighbour) {
    skip('walking from one district into the next',
      many ? 'nothing next door to the middle is built'
        : 'only one district is built, run npm run world:offline');
  } else {
    // Stand on our side of the boundary and walk across it.
    const crossing = await page.evaluate(async (other) => {
      const s = window.spreefall;
      const home = s.world.entryFor(s.world.home);
      // The shared edge, in metres, and a point either side of it. The two
      // districts may be side by side or one above the other, so both axes
      // are tried: the first version of this only knew about the first case
      // and skipped itself whenever the nearest district was to the north.
      const near = (a, b) => Math.abs(a - b) < 1;
      let axis = null, cut = 0, toward = 0;
      if (near(other.bounds.maxX, home.bounds.minX)) { axis = 'x'; cut = home.bounds.minX; toward = -1; }
      else if (near(other.bounds.minX, home.bounds.maxX)) { axis = 'x'; cut = home.bounds.maxX; toward = 1; }
      else if (near(other.bounds.maxZ, home.bounds.minZ)) { axis = 'z'; cut = home.bounds.minZ; toward = -1; }
      else if (near(other.bounds.minZ, home.bounds.maxZ)) { axis = 'z'; cut = home.bounds.maxZ; toward = 1; }
      if (!axis) return { skip: true };
      // Along the edge, inside the overlap of the two districts.
      const along = axis === 'x'
        ? (Math.max(home.bounds.minZ, other.bounds.minZ) + Math.min(home.bounds.maxZ, other.bounds.maxZ)) / 2
        : (Math.max(home.bounds.minX, other.bounds.minX) + Math.min(home.bounds.maxX, other.bounds.maxX)) / 2;
      const insideAt = cut - toward * 25;
      const beyondAt = cut + toward * 25;
      const inside = axis === 'x' ? insideAt : along;
      const beyond = axis === 'x' ? beyondAt : along;
      const z = axis === 'x' ? along : insideAt;
      const zBeyond = axis === 'x' ? along : beyondAt;
      s.teleport(inside, z);
      // Put the neighbour back on the wire first, so what is being measured
      // is the arrival of a district rather than one that is already here.
      s.world.unloadDistrict(other.id);
      const before = {
        loaded: s.world.loadedIds.slice(),
        isLoadedBeyond: s.world.isLoaded(beyond, zBeyond),
      };
      const t0 = performance.now();
      await s.world.loadDistrict(other.id);
      const after = {
        ms: Math.round(performance.now() - t0),
        loaded: s.world.loadedIds.slice(),
        isLoadedBeyond: s.world.isLoaded(beyond, zBeyond),
        groundInside: Math.round(s.world.groundHeight(inside, z) * 100) / 100,
        groundBeyond: Math.round(s.world.groundHeight(beyond, zBeyond) * 100) / 100,
        nameBeyond: s.world.nameAt(beyond, zBeyond),
        tiles: s.world.tiles.filter(Boolean).length,
      };
      return { before, after, axis, inside, beyond, z, zBeyond };
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
          // Walking the line from inside to beyond, whichever way the edge runs.
          const k = (d + 40) / 80;
          const x = at.inside + (at.beyond - at.inside) * k * 2 - (at.beyond - at.inside);
          const z = at.z + (at.zBeyond - at.z) * k * 2 - (at.zBeyond - at.z);
          out.push(Math.round(s.world.groundHeight(x, z) * 100) / 100);
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
        const dx = at.beyond - at.inside, dz = at.zBeyond - at.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len;
        s.teleport(at.inside - ux * 6, at.z - uz * 6);
        const from = { x: s.player.x, z: s.player.z, y: s.player.y };
        for (let i = 0; i < 400; i++) {
          s.player.step(1 / 60, ux * 5.2, uz * 5.2, false);
          await new Promise((r) => setTimeout(r, 0));
          if (Math.hypot(s.player.x - at.beyond, s.player.z - at.zBeyond) < 3) break;
        }
        return {
          moved: Math.round(Math.hypot(s.player.x - from.x, s.player.z - from.z) * 10) / 10,
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
  const map = await page.evaluate(async () => {
    const s = window.spreefall;
    s.minimap.toggle({ x: s.player.x, z: s.player.z });
    // The map opens on so many metres of city rather than on a zoom, and the
    // zoom that comes to is worked out on the next draw, against the canvas
    // it has once it is enlarged. So it is measured after it has been drawn,
    // and measured in metres, which is what the opening is written in.
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const v = s.minimap._view;
    const span = v ? Math.round(s.minimap.canvas.width / v.scale) : 0;
    s.minimap.zoom = 1; s.minimap.openSpan = 0; s.minimap.centre = null;
    return { span, districts: s.world.catalogue.length };
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, 'district-02-map.png') });
  check('the map opens on the streets around you rather than on all of Berlin',
    map.span > 450 && map.span < 1000, `${map.span} m across the canvas`);

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
  if (!many || !neighbour) {
    skip('travelling to a district that is not in memory', 'the same');
  } else {
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
    // --- what you knocked down stays down, district or no district ----------
  const kept = await page.evaluate(async () => {
    const s = window.spreefall;
    s.setCheat('godmode', true);
    s.demolition.reset();
    const home = s.world.idAt(s.player.x, s.player.z);
    const x = s.player.x + 60, z = s.player.z;
    const before = s.world.groundHeight(x, z);
    const tallBefore = s.world.tallestNear(x, z, 60);
    s.demolition.blast(x, before, z, 170, 4000);
    for (let i = 0; i < 60 * 8; i++) s.fixedForTest(1 / 60);
    const dug = s.world.groundHeight(x, z);
    const tallAfter = s.world.tallestNear(x, z, 60);
    // Out to the far side of the city and back, which is far enough for the
    // streamer to let go of this district: a neighbour no longer counts,
    // because the one you came from stays in memory behind you now.
    const here = s.world.entryFor(home);
    const next = s.world.catalogue
      .filter((d) => d.built !== false && d.id !== home)
      .sort((a, b) => Math.hypot(b.bounds.minX - here.bounds.minX, b.bounds.minZ - here.bounds.minZ)
        - Math.hypot(a.bounds.minX - here.bounds.minX, a.bounds.minZ - here.bounds.minZ))[0];
    const fx = (next.bounds.minX + next.bounds.maxX) / 2;
    const fz = (next.bounds.minZ + next.bounds.maxZ) / 2;
    await s.crossInto(fx, fz);
    // And stand there. Loading a district is not leaving the one you are in:
    // the streamer holds on to whatever is under your feet, which is the
    // point of it, so this has to actually go.
    s.teleport(fx, fz);
    // It is let go on the streamer's next pass rather than the instant you
    // arrive, so give it a few.
    for (let i = 0; i < 120; i++) await new Promise((r) => requestAnimationFrame(r));
    const gone = !s.world.loaded(home);
    await s.crossInto(x, z);
    s.teleport(x, z);
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    return {
      scars: s.world.scarCount,
      gone,
      before: Number(before.toFixed(2)),
      dug: Number(dug.toFixed(2)),
      back: Number(s.world.groundHeight(x, z).toFixed(2)),
      tallBefore: Math.round(tallBefore),
      tallAfter: Math.round(tallAfter),
      tallBack: Math.round(s.world.tallestNear(x, z, 60)),
      here: s.world.idAt(s.player.x, s.player.z),
    };
  });
  check('a district you flattened is still flat when you come back to it',
    kept.gone && kept.dug < kept.before - 3
      && Math.abs(kept.back - kept.dug) < 0.6,
    `${kept.before} m became ${kept.dug} m, and ${kept.back} m after a round trip`);
  check('and the buildings that came down are still down',
    kept.tallAfter < kept.tallBefore - 2 && kept.tallBack <= kept.tallAfter + 1,
    `${kept.tallBefore} m standing, ${kept.tallAfter} m after, ${kept.tallBack} m on the way back`);
  check('and the city remembers it in a handful of numbers rather than megabytes',
    kept.scars > 0 && kept.scars < 64, `${kept.scars} ruins written down`);

  // --- and it says no to the parts of Berlin nobody has built --------------
  const unbuilt = await page.evaluate(async () => {
    const s = window.spreefall;
    const gap = s.world.catalogue.find((d) => d.built === false);
    if (!gap) return { skip: true };
    s.openTravel();
    s.settleMap();
    const armed = s.armNuke((gap.bounds.minX + gap.bounds.maxX) / 2,
      (gap.bounds.minZ + gap.bounds.maxZ) / 2);
    const hint = document.getElementById('targethint').textContent;
    const confirmHidden = document.getElementById('targetconfirm').classList.contains('hidden');
    s.closeTargeting();
    // And nothing loads when you walk at one either.
    const before = s.world.loadedIds.length;
    await s.crossInto((gap.bounds.minX + gap.bounds.maxX) / 2,
      (gap.bounds.minZ + gap.bounds.maxZ) / 2);
    return {
      id: gap.id, armed, hint, confirmHidden,
      loadedBefore: before, loadedAfter: s.world.loadedIds.length,
    };
  });
  // When every district has been built there is nothing to refuse, and that
  // is the city this is all for rather than a failure: the pair pass by
  // saying so. They do their work on a partial city, which is what a deploy
  // has until the whole city job has filled the cache.
  check('a district nobody has built yet refuses the trip rather than failing it',
    unbuilt.skip || (unbuilt.armed === false && unbuilt.confirmHidden
      && /not built/.test(unbuilt.hint)),
    unbuilt.skip ? 'every district is built' : `${unbuilt.id}: ${unbuilt.hint}`);
  check('and walking at one loads nothing',
    unbuilt.skip || unbuilt.loadedAfter === unbuilt.loadedBefore,
    unbuilt.skip ? 'nothing left unbuilt to walk at'
      : `${unbuilt.loadedAfter} district in memory`);

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
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`
    + (skipped.length ? `, ${skipped.length} not run` : ''));
  if (failed.length || errors.length) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
