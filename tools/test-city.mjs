// What the city does when it is hit, and what the camera does when you ask to
// be somewhere else.
//
// The claims checked here are the ones that are easy to fake and hard to
// notice: that a building which looks flattened really has stopped blocking
// bullets, that a crater you can see is a crater you can walk into, and that
// the profile the collision uses is the same one the vertex shader draws. If
// those two ever drift you fall through a street that looks solid, so they
// are compared number for number rather than by eye.
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
    s.teleport(81, 0); s.look(90, -2); s.setTime(15.6);
    s.setQuality('low');
  });
  await page.waitForTimeout(4000);

  // --- the city has a floor everywhere -------------------------------------
  // Holes in the ground are the one fault in this project that the collision
  // layer cannot see: you cannot fall through one, you just look down and
  // find the sky where the street should be. So the check is taken from the
  // picture, and with the sky switched off, because against a blue sky a hole
  // and the Spree are the same handful of blue pixels. With nothing drawn
  // behind the city, a hole is black and nothing else is.
  const floor = await page.evaluate(async () => {
    const s = window.spreefall;
    s.renderer.drawSky = false;
    const w = s.world;
    const worst = { sky: 0, at: null };
    let total = 0, places = 0;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = 81 + dx * 260, z = dz * 260;
        if (!w.isLoaded(x, z)) continue;
        s.teleport(x, z);
        // Everything within sight has to be on the card before this means
        // anything, so the streaming is given as long as it needs.
        let quiet = 0;
        for (let i = 0; i < 400 && quiet < 4; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          quiet = s.tiles.stats.uploads === 0 ? quiet + 1 : 0;
        }
        const y = w.groundHeight(x, z) + 220;
        s.state.mode = 'cinema';
        for (let i = 0; i < 12; i++) {
          s.state.dronePose = { x, y, z, yaw: 0, pitch: -Math.PI / 2 + 0.001 };
          await new Promise((r) => requestAnimationFrame(r));
        }
        const gl = s.renderer.gl;
        const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
        const buf = new Uint8Array(bw * bh * 4);
        await new Promise((r) => requestAnimationFrame(() => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          r();
        }));
        let black = 0, seen = 0;
        for (let i = 0; i < buf.length; i += 4) {
          seen++;
          if (buf[i] < 12 && buf[i + 1] < 12 && buf[i + 2] < 12) black++;
        }
        const share = (black / seen) * 100;
        total += share;
        places++;
        if (share > worst.sky) { worst.sky = share; worst.at = [Math.round(x), Math.round(z)]; }
      }
    }
    s.state.mode = 'walk';
    s.renderer.drawSky = true;
    s.teleport(81, 0);
    s.look(90, -2);
    return {
      places,
      worst: Number(worst.sky.toFixed(2)),
      at: worst.at,
      mean: places ? Number((total / places).toFixed(2)) : 0,
    };
  });
  check('looking straight down anywhere in the district, there is ground under you',
    floor.places >= 9 && floor.worst < 0.2,
    `${floor.places} places, worst ${floor.worst}% of the frame`
      + (floor.at ? ` at ${floor.at[0]},${floor.at[1]}` : ''));

  // --- and a floor under the floor -----------------------------------------
  // The ground will have a hole in it again one day: a district that has not
  // arrived, a polygon the triangulator gave up on, a tile evicted while you
  // turned round. What must never happen again is the sky showing through it,
  // because from inside a city the sky at your feet reads as a white hole in
  // the world and it flickers as you walk. So there is a floor of last resort
  // a dozen metres down, and this punches a hole on purpose to see it work.
  const bedrock = await page.evaluate(async () => {
    const s = window.spreefall;
    const w = s.world;
    s.renderer.drawSky = false;
    const sky = async () => {
      const gl = s.renderer.gl;
      const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
      const buf = new Uint8Array(bw * bh * 4);
      await new Promise((r) => requestAnimationFrame(() => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        r();
      }));
      let black = 0, total = 0;
      for (let i = 0; i < buf.length; i += 4) {
        total++;
        if (buf[i] < 12 && buf[i + 1] < 12 && buf[i + 2] < 12) black++;
      }
      return +(black / total * 100).toFixed(2);
    };
    const x = s.player.x, z = s.player.z;
    const ix = Math.floor((x - w.minX) / w.tileSize);
    const iz = Math.floor((z - w.minZ) / w.tileSize);
    const doomed = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) doomed.push((iz + dz) * w.nx + (ix + dx));
    }
    // Hanging over the hole, looking straight down at it.
    const y = w.groundHeight(x, z) + 90;
    const hold = async () => {
      s.state.mode = 'cinema';
      for (let i = 0; i < 10; i++) {
        s.state.dronePose = { x, y, z, yaw: 0, pitch: -Math.PI / 2 + 0.001 };
        await new Promise((r) => requestAnimationFrame(r));
      }
    };
    await hold();
    const whole = await sky();
    // Nothing may be uploaded again while the hole is open.
    const uploads = s.tiles.uploadsPerFrame;
    s.tiles.uploadsPerFrame = 0;
    const kept = s.renderer.bedrock;
    for (const t of doomed) s.tiles.evict(t);
    await hold();
    const withFloor = await sky();
    s.renderer.bedrock = null;
    for (const t of doomed) s.tiles.evict(t);
    await hold();
    const withoutFloor = await sky();
    s.renderer.bedrock = kept;
    s.tiles.uploadsPerFrame = uploads;
    s.state.mode = 'walk';
    s.renderer.drawSky = true;
    return { whole, withFloor, withoutFloor, y: kept ? Math.round(kept.y) : null };
  });
  check('a hole in the ground shows dark ground, not sky',
    bedrock.whole < 0.2 && bedrock.withoutFloor > 50 && bedrock.withFloor < 0.2,
    `${bedrock.withoutFloor}% of the frame was sky with no floor under it, `
      + `${bedrock.withFloor}% with one at ${bedrock.y} m`);

  // --- a tile that is not there --------------------------------------------
  // Every tile with nothing in it, and every district still on the wire, used
  // to answer nought metres when asked how high the ground was. Nought is sea
  // level, and a district standing forty metres above it is then a forty
  // metre hole with you at the bottom of it: that is what falling through the
  // floor was. The neighbours are put on a hill here so that nought would be
  // obvious, and then the tile under the question is taken away.
  const missing = await page.evaluate(() => {
    const s = window.spreefall;
    const w = s.world;
    const x = s.player.x + 220, z = s.player.z + 60;
    const index = w.tileIndex(x, z);
    const tx = index % w.nx, tz = (index / w.nx) | 0;
    // Forty metres up, on every tile around the one we are about to remove.
    const raised = [];
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const idx = (tz + j) * w.nx + (tx + i);
        const hf = w.heightField(idx);
        if (!hf) continue;
        hf.fill(40 * 256);
        raised.push(idx);
      }
    }
    const before = w.groundHeight(x, z);
    const rec = w.tiles[index];
    w.tiles[index] = null;
    w.heightCache.delete(index);
    const after = w.groundHeight(x, z);
    // And put the city back the way it was.
    w.tiles[index] = rec;
    for (const idx of raised) w.heightCache.delete(idx);
    w.heightCache.delete(index);
    return {
      neighbours: raised.length,
      before: Number(before.toFixed(2)),
      after: Number(after.toFixed(2)),
    };
  });
  check('a tile that is not there is not a hole you fall through',
    missing.neighbours >= 4 && Math.abs(missing.after - missing.before) < 1.5,
    `${missing.before} m with the tile, ${missing.after} m without it`);

  // --- damage adds up ------------------------------------------------------
  const adds = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const x = s.player.x - 40, z = s.player.z + 10;
    const y = s.world.groundHeight(x, z);
    // The sites that take buildings with them. A blast also opens a hole in
    // the road of its own, and that one is at level one from the moment it
    // is made: it is a hole, it does not come apart in quarters.
    const frontage = (v) => !v.craterOnly && Math.hypot(v.x - x, v.z - z) < 20;
    const levels = [];
    for (let i = 0; i < 7; i++) {
      s.demolition.blast(x, y, z, 9, 150);
      const site = s.demolition.sites.find(frontage);
      levels.push(site ? site.level : 0);
    }
    s.demolition.reset(); s.renderer.clearCollapses();
    const one = s.demolition.blast(x, y, z, 9, 150).filter((v) => !v.craterOnly).length;
    const first = s.demolition.sites.find((v) => !v.craterOnly);
    const afterOne = first ? first.level : 0;
    s.demolition.reset(); s.renderer.clearCollapses();
    return { levels, one, afterOne, stages: s.demoSpec.stages };
  });
  check('one rocket does not bring any building down', adds.one === 0 && adds.afterOne === 0);
  check('and a frontage comes apart a piece at a time rather than at once',
    new Set(adds.levels).size >= 4 && adds.levels[adds.levels.length - 1] === 1
    && adds.levels[1] > 0 && adds.levels[1] < 1,
    adds.levels.join(' '));
  check('every step is a fraction of the building, not all of it',
    adds.levels.every((v, i) => i === 0 || v >= adds.levels[i - 1])
    && adds.levels.filter((v) => v > 0 && v < 1).length >= 2,
    `${adds.stages} steps from standing to a heap`);

  // --- what comes down stops being there -----------------------------------
  const walls = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const x = s.player.x - 70, z = s.player.z;
    const y = s.world.groundHeight(x, z);
    // Count the walls a ring of rays finds before and after, at head height.
    // A ring of rays from the middle. Two ranges, because a collapse is not
    // uniform: the middle of it is flattened and the rim keeps most of its
    // height, which is both what a blast does and what the profile says.
    const probe = (height, reach) => {
      let hits = 0;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const h = s.world.raycast(x, y + height, z, Math.cos(a), 0, Math.sin(a), reach);
        if (h && h.kind === 'wall') hits++;
      }
      return hits;
    };
    const before = probe(5, 60);
    s.demolition.blast(x, y, z, 90, 3000);
    // Taken while it is still a site. A finished one is written into the tile
    // buffers and gives its slot back, so by the end of this it is a ruin in
    // the city rather than an entry in a list.
    const radius = Math.round(s.demolition.sites[0].radius);
    const halfway = (() => { for (let i = 0; i < 30; i++) s.demolition.update(1 / 60); return probe(5, 60); })();
    for (let i = 0; i < 240; i++) s.demolition.update(1 / 60);
    const inner = probe(5, 32);
    const rim = probe(5, 72);
    const low = probe(0.6, 32);
    return { before, halfway, inner, rim, low, radius };
  });
  check('a square with buildings round it has walls in it', walls.before >= 6,
    `${walls.before} of 24 rays hit one`);

  // The heights come down in steps, and only where the damage landed.
  const bySteps = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    // Somewhere with a real building on it, found by asking rather than by
    // picking a coordinate that might be an empty square.
    let at = null;
    for (let d = 20; d <= 90 && !at; d += 4) {
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const x = s.player.x + Math.cos(a) * d, z = s.player.z + Math.sin(a) * d;
        if (s.world.tallestNear(x, z, 6) > 14) { at = { x, z }; break; }
      }
    }
    if (!at) return { skip: true };
    // And a second building well clear of the first, so the claim that the
    // damage stayed where it landed is measured on something that was never
    // in reach of it rather than on a circle drawn round the hit.
    let away = null;
    for (let d = 46; d <= 150 && !away; d += 4) {
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const x = at.x + Math.cos(a) * d, z = at.z + Math.sin(a) * d;
        if (s.world.tallestNear(x, z, 6) > 14) { away = { x, z }; break; }
      }
    }
    const y = s.world.groundHeight(at.x, at.z);
    // The same reach the search used, or the point it found may have
    // nothing inside a tighter circle and every reading comes back zero.
    // The mean height of the walls within reach, a metre of wall at a time.
    // The tallest was the measure once, but a building comes down column by
    // column now with a ragged edge, and the tallest piece near the hit is
    // the one column at the edge that stayed up while the rest came down.
    const meanNear = (px, pz, r) => {
      let sum = 0, n = 0;
      s.world.forEachSegmentTile(px - r, pz - r, px + r, pz + r, (segs) => {
        for (let i = 0; i + 5 < segs.length; i += 6) {
          const len = Math.hypot(segs[i + 2] - segs[i], segs[i + 3] - segs[i + 1]);
          const steps = Math.max(1, Math.ceil(len));
          const tall = Math.max(0, segs[i + 5] - Math.max(0, segs[i + 4]));
          for (let k = 0; k < steps; k++) {
            const t = (k + 0.5) / steps;
            const qx = segs[i] + (segs[i + 2] - segs[i]) * t;
            const qz = segs[i + 1] + (segs[i + 3] - segs[i + 1]) * t;
            if (Math.hypot(qx - px, qz - pz) > r) continue;
            sum += tall * (len / steps);
            n += len / steps;
          }
        }
      });
      return n ? sum / n : 0;
    };
    const here = () => Math.round(meanNear(at.x, at.z, 8) * 10) / 10;
    // A rocket touches up to four cells of the damage grid, so a site can
    // reach the far side of the frontage it hit. What it must not do is take
    // the neighbours with it, which is what these two read.
    const near = () => Math.round(s.world.tallestNear(at.x, at.z, 22) * 10) / 10;
    const other = () => (away
      ? Math.round(s.world.tallestNear(away.x, away.z, 6) * 10) / 10 : 0);
    const steps = [{ hit: here(), rest: near(), other: other() }];
    for (let i = 0; i < 5; i++) {
      s.demolition.blast(at.x, y + 6, at.z, 9, 150);
      for (let k = 0; k < 400; k++) s.demolition.update(1 / 60);
      steps.push({ hit: here(), rest: near(), other: other() });
    }
    s.demolition.reset(); s.renderer.clearCollapses();
    return { steps, away: !!away, apart: away
      ? Math.round(Math.hypot(away.x - at.x, away.z - at.z)) : 0 };
  });
  check('a facade loses its height in steps rather than in one go',
    !bySteps.skip && bySteps.steps.filter((v, i) => i > 0
      && v.hit < bySteps.steps[i - 1].hit).length >= 3,
    bySteps.skip ? 'no building found' : bySteps.steps.map((v) => v.hit).join(' to '));
  const last = bySteps.skip ? null : bySteps.steps[bySteps.steps.length - 1];
  check('and the rest of the block keeps nearly all of its height',
    !bySteps.skip && last.rest >= bySteps.steps[0].rest - 2,
    bySteps.skip ? '' : `${bySteps.steps[0].rest} m at 22 m, still ${last.rest} m`);
  check('while the building up the road is not touched at all',
    !bySteps.skip && (!bySteps.away || last.other >= bySteps.steps[0].other - 0.1),
    bySteps.skip || !bySteps.away ? 'no second building found'
      : `${bySteps.steps[0].other} m, still ${last.other} m, ${bySteps.apart} m away`);
  check('the walls are still there while it is falling', walls.halfway === walls.before);
  check('and gone at head height in the middle of it once it has fallen',
    walls.inner === 0, `${walls.before} to ${walls.inner} within 32 m`);
  check('while the rim of it keeps most of its height', walls.rim > 0,
    `${walls.rim} of 24 out to 72 m, on a ${walls.radius} m site`);
  check('and the heap is still there at knee height', walls.low > 0,
    `${walls.low} of 24`);

  // --- the crater is real --------------------------------------------------
  const crater = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const x = s.player.x + 400, z = s.player.z + 40;
    const before = s.world.groundHeight(x, z);
    s.demolition.blast(x, before, z, 170, 4000);
    const site = s.demolition.sites[0];
    for (let i = 0; i < 400; i++) s.demolition.update(1 / 60);
    // Walk out along one radius and record what the ground did.
    const profile = [];
    for (let d = 0; d <= site.radius; d += 4) {
      profile.push({ d, moved: Number((s.world.groundHeight(x + d, z) - before).toFixed(2)) });
    }
    // The collision and the shape the shader draws are the same function,
    // compared number for number rather than by eye.
    let worst = 0;
    for (const f of [0.05, 0.2, 0.4, 0.6, 0.85, 1.2, 1.6, 2.4]) {
      const px = x + site.craterRadius * f;
      const want = s.demoCrater(px, z, site);
      const got = s.world.groundHeight(px, z) - before;
      worst = Math.max(worst, Math.abs(got - want));
    }
    return {
      collapse: Math.round(site.radius),
      craterRadius: Math.round(site.craterRadius),
      depth: Number(site.depth.toFixed(2)),
      deepest: Math.min(...profile.map((p) => p.moved)),
      highest: Math.max(...profile.map((p) => p.moved)),
      flatFrom: (profile.find((p) => p.d > site.craterRadius * 2 && Math.abs(p.moved) < 0.1)
        || { d: -1 }).d,
      worst: Number(worst.toFixed(2)),
    };
  });
  check('a warhead digs a hole you can walk into', crater.deepest < -5,
    `${(-crater.deepest).toFixed(1)} m deep`);
  check('and the hole is a fraction of the blast, not all of it',
    crater.craterRadius < crater.collapse * 0.35,
    `${crater.craterRadius} m of crater inside a ${crater.collapse} m collapse`);
  check('with a ring of thrown up ground round the lip', crater.highest > 0.5,
    `${crater.highest.toFixed(1)} m proud`);
  check('and flat street again well inside the collapse',
    crater.flatFrom > 0 && crater.flatFrom < crater.collapse,
    `level again ${crater.flatFrom} m out`);
  check('and the collision agrees with the shape the shader draws',
    crater.worst < 1.2, `worst ${crater.worst} m out over eight radii`);

  // --- and it takes you with it --------------------------------------------
  // The crater opens under the player's own feet, through the real fixed
  // step, and the gap between where the player is and where the ground is is
  // watched the whole way down. A hole that arrives in one frame leaves that
  // gap at six metres and then drops you into it.
  const rode = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const x = s.player.x, z = s.player.z;
    const before = s.world.groundHeight(x, z);
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    s.demolition.blast(x + 3, before, z, 170, 4000);
    let worstGap = 0;
    let fastest = 0;
    for (let i = 0; i < 400; i++) {
      s.fixedForTest(1 / 60);
      const g = s.world.groundHeight(s.player.x, s.player.z);
      worstGap = Math.max(worstGap, s.player.y - g);
      fastest = Math.min(fastest, s.player.vy || 0);
    }
    return {
      sank: Number((before - s.world.groundHeight(s.player.x, s.player.z)).toFixed(1)),
      worstGap: Number(worstGap.toFixed(2)),
      fastest: Number(fastest.toFixed(1)),
      onGround: s.player.onGround,
      health: s.combat.health,
    };
  });
  check('the ground going down under you takes you with it',
    rode.sank > 3 && rode.worstGap < 0.6,
    `${rode.sank} m down, never more than ${rode.worstGap} m above it`);
  check('rather than leaving you in the air to fall',
    rode.fastest > -4 && rode.onGround,
    `worst fall ${-rode.fastest} m/s, standing at the bottom`);

  // --- the memorial ---------------------------------------------------------
  const memorial = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const m = s.combat.sanctuaries[0];
    if (!m) return { skip: true };
    const y = s.world.groundHeight(m.x, m.z);
    // The field keeps the place, whatever goes off on it: the stelae stand
    // and the ground is not dug, after the collapse has run its course.
    const px = m.x + 15, pz = m.z + 10;
    const before = { g: s.world.groundHeight(px, pz), t: s.world.tallestNear(px, pz, 12) };
    s.demolition.blast(m.x, y, m.z, 170, 4000);
    for (let i = 0; i < 60 * 8; i++) s.fixedForTest(1 / 60);
    const after = { g: s.world.groundHeight(px, pz), t: s.world.tallestNear(px, pz, 12) };
    s.demolition.reset(); s.renderer.clearCollapses();
    return {
      dug: +Math.abs(after.g - before.g).toFixed(2),
      fell: +(before.t - after.t).toFixed(2),
      name: m.name,
    };
  });
  check('nothing in the memorial comes down', !memorial.skip && memorial.dug < 0.05 && memorial.fell < 0.1,
    `${memorial.name}: ground ${memorial.dug} m, walls ${memorial.fell} m lower`);

  // --- the shader is told about it ------------------------------------------
  const uniforms = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const quiet = s.renderer.collapseCount;
    const x = s.player.x - 200, z = s.player.z;
    const y = s.world.groundHeight(x, z);
    s.demolition.blast(x, y, z, 80, 3000);
    for (let i = 0; i < 120; i++) s.demolition.update(1 / 60);
    s.renderer.setCollapses(s.demolition.sites);
    // Read now: the sixty blasts below run out of slots and merge into the
    // nearest site, which grows this one to hundreds of metres.
    const first = s.demolition.sites[0];
    const site = first ? { x: first.x, radius: first.radius } : null;
    const packed = Array.from(s.renderer.collapse.slice(0, 4));
    // And a lot of them never take more slots than the shader has.
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const px = s.player.x + Math.cos(a) * (200 + i * 9);
      const pz = s.player.z + Math.sin(a) * (200 + i * 9);
      s.demolition.blast(px, s.world.groundHeight(px, pz), pz, 70, 3000);
    }
    s.renderer.setCollapses(s.demolition.sites);
    const many = { sites: s.demolition.count, uniforms: s.renderer.collapseCount };
    s.demolition.reset(); s.renderer.clearCollapses();
    return {
      quiet, after: s.renderer.collapseCount,
      matches: !!site && Math.abs(packed[0] - site.x) < 0.01 && Math.abs(packed[3] - site.radius) < 0.01,
      detail: site ? `site at ${site.x.toFixed(1)} r ${site.radius.toFixed(1)}, slot 0 at ${packed[0].toFixed(1)} r ${packed[3].toFixed(1)}`
        : `no site left after two seconds, blast at ${Math.round(x)}, ${Math.round(z)}`,
      many, max: s.demoSpec.maxSites,
    };
  });
  check('an untouched city costs the vertex shader nothing', uniforms.quiet === 0);
  check('and a collapse reaches it with the right numbers', uniforms.matches, uniforms.detail);
  check('sixty blasts never ask for more slots than there are',
    uniforms.many.sites <= uniforms.max && uniforms.many.uniforms <= uniforms.max,
    `${uniforms.many.sites} sites, ${uniforms.max} slots`);

  // --- trees that burn ------------------------------------------------------
  const fire = await page.evaluate(async () => {
    const s = window.spreefall;
    s.fires.reset(); s.renderer.clearFires();
    // Where the trees actually are, rather than a coordinate that might be a
    // square with nothing on it.
    const w = s.world;
    let best = null;
    for (let tz = 0; tz < w.nz; tz++) {
      for (let tx = 0; tx < w.nx; tx++) {
        const d = w.trees(tz * w.nx + tx);
        if (!d || d.length < 5 * 8) continue;
        let mx = 0, mz = 0;
        const n = d.length / 5;
        for (let i = 0; i < d.length; i += 5) { mx += d[i]; mz += d[i + 2]; }
        if (!best || n > best.n) best = { x: mx / n, z: mz / n, n };
      }
    }
    if (!best) return { skip: true };
    const quiet = s.renderer.fireCount;
    const site = s.fires.ignite(best.x, 0, best.z, 70, 1);
    if (!site) return { skip: true };
    const caught = site.trees.length;
    const willBurst = site.trees.filter((t) => t.bursts).length;
    // Nobody has given up yet.
    const early = site.trees.filter((t) => t.done).length;
    // Run the fire out, on this file's clock rather than the game's, so the
    // test does not depend on how fast the machine is.
    const seen = { burst: 0, topple: 0, flames: 0 };
    s.fires.onBurst = () => { seen.burst++; };
    s.fires.onTopple = () => { seen.topple++; };
    const realFlame = s.fires.onFlame;
    s.fires.onFlame = () => { seen.flames++; };
    const me = { x: best.x, z: best.z };
    for (let i = 0; i < 60 * 14; i++) s.fires.update(1 / 60, me);
    s.renderer.setFires(s.fires.sites);
    const uniforms = s.renderer.fireCount;
    const gone = site.trees.filter((t) => t.gone).length;
    const done = site.trees.filter((t) => t.done).length;
    // And the edge of a fire catches after the middle of it.
    const byDistance = site.trees
      .map((t) => ({ d: Math.hypot(t.x - best.x, t.z - best.z), at: t.caughtAt }))
      .sort((a, b) => a.d - b.d);
    const ordered = byDistance.every((t, i) =>
      i === 0 || t.at >= byDistance[i - 1].at - 1e-6);
    s.fires.onFlame = realFlame;
    s.fires.reset(); s.renderer.clearFires();
    return { quiet, caught, willBurst, early, seen, uniforms, gone, done, ordered,
      total: site.trees.length };
  });
  check('a fire takes hold of the trees that are really there',
    !fire.skip && fire.caught > 10, fire.skip ? 'no trees found' : `${fire.caught} of them`);
  check('and none of them is alight the instant it starts', fire.early === 0);
  check('they catch from the middle of the fire outward', fire.ordered);
  check('some burn until they burst and the rest go over',
    fire.seen.burst > 0 && fire.seen.topple > 0
    && fire.seen.burst + fire.seen.topple === fire.total,
    `${fire.seen.burst} burst, ${fire.seen.topple} fell, out of ${fire.total}`);
  check('and which it is was decided by the tree, not by a dice',
    fire.seen.burst === fire.willBurst,
    'the same seed the shader reads picks it');
  check('a burning tree makes flames while it burns', fire.seen.flames > 50,
    `${fire.seen.flames} over fourteen seconds`);
  check('an unburnt city costs the tree shader nothing', fire.quiet === 0);
  check('and a fire reaches it', fire.uniforms === 1);

  const lit = await page.evaluate(() => {
    const s = window.spreefall;
    s.fires.reset(); s.renderer.clearFires();
    const w = s.world;
    let at = null;
    for (let tz = 0; tz < w.nz && !at; tz++) {
      for (let tx = 0; tx < w.nx; tx++) {
        const d = w.trees(tz * w.nx + tx);
        if (!d || d.length < 5 * 8) continue;
        at = { x: d[0], z: d[2] };
        break;
      }
    }
    if (!at) return { skip: true };
    s.projectiles.clear();
    // A rocket into the trees, through the real blast path.
    s.explode(at.x, s.world.groundHeight(at.x, at.z) + 1, at.z,
      { radius: 9, damage: 150 });
    const n = s.fires.count;
    const trees = n ? s.fires.sites[0].trees.length : 0;
    s.fires.reset(); s.renderer.clearFires();
    return { n, trees };
  });
  check('a rocket into a row of trees sets them alight',
    !lit.skip && lit.n === 1 && lit.trees > 0,
    lit.skip ? 'no trees found' : `${lit.trees} caught`);

  // --- free travel ----------------------------------------------------------
  const flight = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    s.teleport(81, 0);
    s.openTravel();
    const host = document.getElementById('nuketarget');
    const opened = !host.classList.contains('hidden') && host.classList.contains('travel');
    const armed = s.armNuke(s.player.x + 1200, s.player.z - 260);
    const says = document.getElementById('confirmwhere').textContent;
    const button = document.getElementById('confirmfire').textContent;
    const beforeMode = s.state.mode;
    s.releaseNuke();
    return {
      opened, armed, says, button, beforeMode,
      mode: s.state.mode,
      stillHere: Math.round(Math.hypot(s.player.x - 81, s.player.z)),
      closed: host.classList.contains('hidden'),
    };
  });
  check('the travel map opens in its own mode', flight.opened);
  check('and says how far and how long', /km from here\. About \d+ seconds\./.test(flight.says),
    flight.says);
  check('and asks before it moves you', flight.button === 'Fly there'
    && flight.beforeMode === 'walk' && flight.stillHere === 0);
  check('releasing it starts the flight rather than teleporting you',
    flight.mode === 'travel' && flight.closed);

  // The shape of the move: up first, across at height, then down.
  const shape = await page.evaluate(async () => {
    const s = window.spreefall;
    const seen = [];
    const t0 = performance.now() / 1000;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const p = s.state.dronePose;
      if (s.state.mode !== 'travel' || !p) break;
      seen.push({ t: performance.now() / 1000 - t0, y: p.y, phase: p.phase, pitch: p.pitch });
    }
    return {
      phases: [...new Set(seen.map((v) => v.phase))].join(''),
      peak: Math.round(Math.max(...seen.map((v) => v.y))),
      start: Math.round(seen[0] ? seen[0].y : 0),
      lookedDown: seen.some((v) => v.pitch < -1),
    };
  });
  check('it climbs well above the roofs', shape.peak > 200,
    `${shape.start} m to ${shape.peak} m`);
  check('and looks down at the city on the way', shape.lookedDown);
  check('through rise, cruise and fall in that order',
    /rise/.test(shape.phases) && /cruise/.test(shape.phases), shape.phases);

  const arrived = await page.evaluate(async () => {
    const s = window.spreefall;
    for (let i = 0; i < 900; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (s.state.mode === 'walk') break;
    }
    return {
      mode: s.state.mode,
      off: Math.round(Math.hypot(s.player.x - (81 + 1200), s.player.z - (-260))),
      onGround: Math.abs(s.player.y - s.world.groundHeight(s.player.x, s.player.z)) < 1.5,
      hudBack: !document.getElementById('hud').classList.contains('flying'),
    };
  });
  check('and it puts you down exactly where you asked', arrived.mode === 'walk' && arrived.off <= 1,
    `${arrived.off} m out`);
  check('on the ground, with the interface back', arrived.onGround && arrived.hudBack);

  // Travel into the memorial is allowed, as walking and fighting there are:
  // the force field keeps the place whole, not anybody out of it.
  const intoMemorial = await page.evaluate(() => {
    const s = window.spreefall;
    const m = s.combat.sanctuaries[0];
    s.openTravel();
    const ok = s.armNuke(m.x, m.z);
    s.closeTargeting();
    return { ok, name: m.name };
  });
  check('and you may still travel into the memorial', intoMemorial.ok, intoMemorial.name);

  // --- things you can get into ----------------------------------------------
  const rides = await page.evaluate(() => {
    const s = window.spreefall;
    s.vehicles.reset();
    s.teleport(81, 0);
    const made = ['jeep', 'tank', 'heli', 'jet']
      .map((t) => s.vehicles.spawn(t, s.player.x - 14 - Math.random() * 20,
        s.player.z + (Math.random() - 0.5) * 20, 1.4));
    return { n: s.vehicles.count, types: made.map((v) => v && v.type).join(' ') };
  });
  check('all four of them can be put in the street', rides.n === 4, rides.types);

  const parked = await page.evaluate(async () => {
    const s = window.spreefall;
    // Left alone, nothing happens to any of them.
    const before = s.vehicles.active.map((v) => v.health);
    for (let i = 0; i < 60 * 6; i++) s.vehicles.update(1 / 60, null, i / 60);
    const after = s.vehicles.active.map((v) => v.health);
    return { same: before.every((h, i) => after[i] === h), count: s.vehicles.count };
  });
  check('and parked ones are still parked six seconds later', parked.same,
    'an aircraft on the ground is not crashing');

  const drive = await page.evaluate(async () => {
    const s = window.spreefall;
    const jeep = s.vehicles.active.find((v) => v.type === 'jeep');
    // F takes the nearest thing you can get into, a mech first, so nothing
    // else is left within reach of the jeep while this gets into it.
    s.mechs.reset();
    const others = s.vehicles.active.filter((v) => v !== jeep).map((v) => ({ v, x: v.x, z: v.z }));
    for (const o of others) o.v.x += 200;
    s.teleport(jeep.x + 2, jeep.z);
    const tooFar = s.vehicles.nearest(jeep.x + 300, jeep.z, 7);
    s.toggleVehicle();
    const inIt = s.state.inVehicle === jeep;
    const got = s.state.inVehicle ? s.state.inVehicle.type : (s.state.inMech ? 'a mech' : 'nothing');
    const was = { x: jeep.x, z: jeep.z };
    // Through the real fixed step with the real throttle, so this is the
    // path a player's key press takes and not a shortcut past it.
    s.input.keys.add('KeyW');
    for (let i = 0; i < 150; i++) s.fixedForTest(1 / 60);
    s.input.keys.delete('KeyW');
    const moved = Math.hypot(jeep.x - was.x, jeep.z - was.z);
    const rode = Math.hypot(s.player.x - jeep.x, s.player.z - jeep.z);
    // Stopped first: out of it at speed is a bail out, and it drives on
    // without you (phase 119, checked in the ops suite). This is the
    // ordinary getting out.
    jeep.speed = 0;
    s.toggleVehicle();
    const out = s.state.inVehicle === null;
    const dropped = Math.hypot(s.player.x - jeep.x, s.player.z - jeep.z);
    for (const o of others) { o.v.x = o.x; o.v.z = o.z; }
    return { inIt, got, tooFar: tooFar === null, moved: Math.round(moved),
      rode: Math.round(rode), out, dropped: Math.round(dropped) };
  });
  // --- can you tell they are there? ----------------------------------------
  const findable = await page.evaluate(async () => {
    const s = window.spreefall;
    const jeep = s.vehicles.active.find((v) => v.type === 'jeep');
    // Two frames: the hint is set in the draw, and the first frame after a
    // teleport can be one the loop spent on something else.
    const frames = async () => {
      for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
    };
    s.teleport(jeep.x + 400, jeep.z);
    await frames();
    const far = !document.getElementById('ridehint').classList.contains('hidden');
    const farWhat = far ? document.getElementById('ridehintname').textContent : '';
    s.teleport(jeep.x + 2.5, jeep.z);
    await frames();
    const hint = document.getElementById('ridehint');
    return {
      far, farWhat, rigging: !!s.rigging(),
      near: !hint.classList.contains('hidden'),
      name: document.getElementById('ridehintname').textContent,
      marked: s.vehicles.active.filter((v) => v.alive && !v.occupied).length,
    };
  });
  check('standing next to one says so on the screen',
    findable.near && !findable.far, `${findable.name} within reach`
      + (findable.far ? `, and at 400 m too: ${findable.farWhat}` : '') + (findable.rigging ? ', asked to rig' : ''));
  check('and the map says where the others are',
    findable.marked >= 3, `${findable.marked} marked`);

  check('you can only get into one you are standing next to', drive.tooFar);
  check('and then it drives', drive.inIt && drive.moved > 15, `${drive.moved} m, in ${drive.got}`);
  check('with you in it', drive.rode === 0);
  check('and getting out puts you beside it', drive.out && drive.dropped <= 4,
    `${drive.dropped} m away`);

  // --- faster, and through whatever is in the way -----------------------------
  const ram = await page.evaluate(() => {
    const s = window.spreefall;
    s.vehicles.reset();
    s.soldiers.enabled = false; s.drones.enabled = false;
    const out = {};
    // How fast the jeep gets on the flat: along the open length of Unter den
    // Linden east of the spawn, eight seconds of full throttle.
    s.teleport(160, 3.3);
    const j = s.vehicles.spawn('jeep', 162, 3.3, -Math.PI / 2);
    s.teleport(j.x + 1.5, j.z);
    s.look(-90, 0);
    s.toggleVehicle();
    s.input.keys.add('KeyW');
    let top = 0;
    for (let i = 0; i < 60 * 8; i++) { s.fixedForTest(1 / 60); top = Math.max(top, Math.abs(j.speed)); }
    s.input.keys.delete('KeyW');
    s.toggleVehicle();
    out.top = +top.toFixed(1);
    // A wall: from the square, the nearest frontage taller than a house in
    // some direction, between twenty five and seventy metres off.
    const from = { x: 81, z: 0 };
    const walls = [];
    for (let k = 0; k < 72 && walls.length < 2; k++) {
      const a = (k / 72) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      const g = s.world.groundHeight(from.x, from.z);
      const hit = s.world.raycast(from.x, g + 1, from.z, dx, 0, dz, 70);
      if (!hit || hit.kind !== 'wall' || hit.t < 25) continue;
      const segs = s.world.segments(hit.tile);
      const o = hit.seg;
      if (segs[o + 5] - segs[o + 4] < 8) continue;
      // A second one well round from the first, so the tank meets a wall
      // the jeep has not already been through.
      if (walls.length && Math.abs(Math.atan2(dz, dx) - walls[0].a) < 0.9) continue;
      walls.push({ dx, dz, t: hit.t, a: Math.atan2(dz, dx) });
    }
    if (walls.length < 2) return { ...out, walls: walls.length };
    const drive = (type, wall) => {
      s.vehicles.reset();
      s.teleport(from.x, from.z);
      const yaw = Math.atan2(-wall.dx, -wall.dz);
      const v = s.vehicles.spawn(type, from.x, from.z, yaw);
      s.teleport(v.x - wall.dx * 2, v.z - wall.dz * 2);
      s.look(yaw * 180 / Math.PI, 0);
      s.toggleVehicle();
      const smashes = s.state.smashes || 0;
      s.input.keys.add('KeyW');
      let past = 0;
      for (let i = 0; i < 60 * 10; i++) {
        s.fixedForTest(1 / 60);
        past = Math.max(past, (v.x - from.x) * wall.dx + (v.z - from.z) * wall.dz);
      }
      s.input.keys.delete('KeyW');
      s.toggleVehicle();
      return { smashes: (s.state.smashes || 0) - smashes, past: +past.toFixed(1), wallAt: +wall.t.toFixed(1) };
    };
    out.jeep = drive('jeep', walls[0]);
    out.tank = drive('tank', walls[1]);
    s.soldiers.enabled = true; s.drones.enabled = true;
    return out;
  });
  check('the jeep reaches its top speed, past a hundred and thirty kilometres an hour', ram.top >= 36,
    `${ram.top} m/s`);
  check('driven into a frontage the jeep goes through it, and on out the other side',
    !!ram.jeep && ram.jeep.smashes >= 1 && ram.jeep.past > ram.jeep.wallAt + 8, JSON.stringify(ram.jeep));
  check('and so does the tank', !!ram.tank && ram.tank.smashes >= 1 && ram.tank.past > ram.tank.wallAt + 8,
    JSON.stringify(ram.tank));
  await page.evaluate(() => window.spreefall.parkVehicles && window.spreefall.parkVehicles());

  // --- nothing left hanging in the air after a collapse -----------------------
  // A piece of roof or wall whose corners stand in different collapse
  // columns, one of which came down while another stood, is a slab hanging
  // in the air. Counted after shells landing beside each other (the site
  // grows) and after a warhead, from the tile bytes before and after.
  const slabs = await page.evaluate(async () => {
    const s = window.spreefall;
    const W = await import('/src/engine/world.js');
    const C = await import('/src/shared/constants.js');
    s.soldiers.enabled = false; s.drones.enabled = false; s.soldiers.reset(); s.drones.reset();
    const w = s.world;
    const read = (index) => {
      const rec = w.tiles[index]; if (!rec) return null;
      const m = W.tileMesh(rec); const [ox, oz] = w.tileOrigin(index);
      const v = m.view; const pos = []; const ground = []; const up = [];
      for (let i = 0; i < m.vCount; i++) {
        const o = m.vOff + i * C.VERTEX_STRIDE;
        pos.push([v.getInt16(o, true) / C.POS_SCALE + ox, v.getInt16(o + 2, true) / C.POS_SCALE, v.getInt16(o + 4, true) / C.POS_SCALE + oz]);
        ground.push((v.getUint8(o + 17) & C.FACADE_FLAG.GROUND) !== 0);
        up.push(v.getInt8(o + 7) / 127);
      }
      const idx = m.i32 ? new Uint32Array(m.buffer, m.iOff, m.iCount) : new Uint16Array(m.buffer, m.iOff, m.iCount);
      return { pos, ground, up, idx: Array.from(idx) };
    };
    const out = [];
    const runCase = (name, blasts, cx, cz, reach) => {
      // The street before anything went off, and how high the heap can be:
      // a roof that came down lies on the rubble, and over a warhead's
      // crater that rubble is above the bottom of the hole.
      const streetY = w.groundHeight(cx, cz);
      const heapTop = Math.min(3.5, blasts[blasts.length - 1][2] * 0.11) * 1.1 + 1.3;
      for (const [x, z, r, d] of blasts) {
        const g = w.groundHeight(x, z);
        s.demolition.blast(x, g + 2, z, r, d);
      }
      let frames = 0;
      while (s.refineJobs.length && frames < 400) { s.refineStep(); frames++; }
      // How high the heap can be is the site's to say, not the last blast's:
      // shells landing beside each other merge into one site whose radius,
      // and so whose rubble, grows with every one. A roof that came down lies
      // at most the site's rubble (with its jitter) and a metre of slide over
      // where the site stands.
      const sites = s.demolition.sites.filter((x) => !x.craterOnly && x.level > 0
        && Math.hypot(x.x - cx, x.z - cz) < reach + x.radius);
      const heapAt = sites.length
        ? Math.max(...sites.map((x) => x.y + x.rubble * 1.1 + 1.0)) - streetY + 0.3 : heapTop;
      // Snapshot after every refine, before anything has moved.
      const tiles = new Set();
      w.forEachSegmentTile(cx - reach, cz - reach, cx + reach, cz + reach, (a, b, index) => tiles.add(index));
      const snap = new Map();
      for (const t of tiles) { const r = read(t); if (r) snap.set(t, r); }
      for (let i = 0; i < 60 * 14; i++) s.fixedForTest(1 / 60);
      s.demolition.bakeAll();
      let sheets = 0, tris = 0, roofs = 0, roofsDown = 0, highest = 0; const where = [];
      const cell = (v) => Math.floor(v / 4);
      for (const [t, before] of snap) {
        const after = read(t);
        if (!after || after.pos.length < before.pos.length) continue;
        for (let i = 0; i < after.idx.length; i += 3) {
          const vs = [after.idx[i], after.idx[i + 1], after.idx[i + 2]];
          if (vs.some((v) => v >= before.pos.length || before.ground[v])) continue;
          tris++;
          const P = vs.map((v) => before.pos[v]);
          // A roof that came down with its column and still hangs above the
          // heap, over the inside of the building where nothing holds it:
          // what a partly fallen block left over Steglitz.
          if (vs.every((v) => before.up[v] > 0.5)) {
            const dropped = vs.map((v) => before.pos[v][1] - after.pos[v][1]);
            if (Math.min(...dropped) > 0.5) {
              roofsDown++;
              const up = Math.min(...vs.map((v) => after.pos[v][1] - streetY));
              if (up > heapAt) { roofs++; highest = Math.max(highest, up); }
            }
          }
          const sameCell = P.every((p) => cell(p[0]) === cell(P[0][0]) && cell(p[2]) === cell(P[0][2]));
          if (sameCell) continue;
          const fall = vs.map((v) => before.pos[v][1] - after.pos[v][1]);
          const k = fall.indexOf(Math.min(...fall));
          const standing = after.pos[vs[k]][1] - w.groundHeight(after.pos[vs[k]][0], after.pos[vs[k]][2]);
          if (Math.max(...fall) > 3 && Math.min(...fall) < 0.5 && standing > 2) {
            sheets++;
            const mx = (P[0][0] + P[1][0] + P[2][0]) / 3, mz = (P[0][2] + P[1][2] + P[2][2]) / 3;
            where.push(Math.round(Math.hypot(mx - cx, mz - cz)));
          }
        }
      }
      const R = blasts[blasts.length - 1][2];
      out.push({ name, frames, sheets, roofs, roofsDown, heap: +heapAt.toFixed(2), highest: +highest.toFixed(2), tris, refineMs: Math.round(s.state.refineMs || 0), where: where.sort((a, b) => a - b), R });
    };
    // Shells landing beside each other, so the site grows.
    runCase('grown', [[300, -60, 10, 900], [312, -52, 10, 900], [322, -66, 10, 900], [306, -74, 10, 900], [316, -60, 12, 1400]], 312, -62, 70);
    // A warhead.
    runCase('warhead', [[700, 200, 120, 6000]], 700, 200, 140);
    return out;
  });
  const grown = slabs.find((x) => x.name === 'grown'), warhead = slabs.find((x) => x.name === 'warhead');
  check('shells landing beside each other leave nothing hanging in the air',
    grown && grown.sheets <= 2, JSON.stringify(grown));
  check('and nor does a warhead, cut a few tiles a frame', warhead && warhead.sheets === 0 && warhead.frames > 1,
    JSON.stringify(warhead));
  check('and a roof whose column went comes down to the heap rather than hanging over the inside',
    grown && warhead && grown.roofsDown + warhead.roofsDown > 0 && grown.roofs === 0 && warhead.roofs === 0,
    `${grown && grown.roofs} and ${warhead && warhead.roofs} roof pieces left above the heap, `
      + `of ${grown && grown.roofsDown} and ${warhead && warhead.roofsDown} that came down`);
  await page.evaluate(() => { const s = window.spreefall; s.soldiers.enabled = true; s.drones.enabled = true; });

  const fly = await page.evaluate(async () => {
    const s = window.spreefall;
    // A live one. The checks above shoot at what is parked here, and a blast
    // beside a helicopter now takes a piece out of it, so by this point the
    // one from earlier can be a wreck: a wreck does not climb, and that is
    // not what this is asking about.
    const live = (kind) => s.vehicles.active.find((v) => v.type === kind && v.health > 0);
    if (!live('heli') || !live('jet')) s.parkVehicles();
    const heli = live('heli');
    const jet = live('jet');
    if (!heli || !jet) return { climbed: -1, stalled: -1, stall: 0 };
    // The jet out of the way while you get in: F takes the nearest, and a
    // fighter is fifteen metres of wing parked beside the helicopter, so
    // now and then it was the nearest and this measured a jet that does not
    // climb on Space. That was the intermittent nought.
    const jetAt = { x: jet.x, z: jet.z };
    jet.x += 90;
    s.teleport(heli.x + 2, heli.z);
    s.toggleVehicle();
    // What it got you into, and whether it could, for when it climbs nowhere.
    const inside = s.state.inVehicle === heli ? 'heli'
      : (s.state.inVehicle ? s.state.inVehicle.type : (s.state.inMech ? 'a mech' : `nothing, mode ${s.state.mode}`));
    const y0 = heli.y;
    s.input.keys.add('Space');
    s.input.jumpHeld = true;
    for (let i = 0; i < 180; i++) s.fixedForTest(1 / 60);
    s.input.keys.delete('Space');
    s.input.jumpHeld = false;
    const climbed = heli.y - y0;
    s.toggleVehicle();
    jet.x = jetAt.x; jet.z = jetAt.z;

    // A fighter that is not going fast enough does not fly.
    jet.y = s.world.groundHeight(jet.x, jet.z) + 200;
    jet.grounded = false;
    jet.speed = 5;
    jet.pitch = 0.3;
    const high = jet.y;
    for (let i = 0; i < 90; i++) s.vehicles.update(1 / 60, null, i / 60);
    const stalled = high - jet.y;
    return { climbed: Math.round(climbed), stalled: Math.round(stalled),
      stall: s.vehicleSpec.jet.stall, inside };
  });
  check('a helicopter climbs when you hold space', fly.climbed > 20, `${fly.climbed} m, in ${fly.inside}`);
  check('and a fighter below its stall speed falls out of the sky',
    fly.stalled > 20, `${fly.stalled} m in a second and a half, under ${fly.stall} m/s`);

  const shot = await page.evaluate(() => {
    const s = window.spreefall;
    s.vehicles.reset();
    const tank = s.vehicles.spawn('tank', s.player.x - 20, s.player.z, 0);
    const before = tank.health;
    // Everything that can shoot at anything else can shoot at these too.
    const hit = s.vehicles.raycast(s.player.x, s.player.y + 1.7, s.player.z,
      (tank.x - s.player.x) / 20, 0, (tank.z - s.player.z) / 20, 60);
    if (hit) s.vehicles.damage(hit.target, 3000);
    const out = { found: !!hit, before, after: tank.health, dead: tank.health === 0 };
    s.vehicles.reset();
    return out;
  });
  check('and they can be shot at like anything else',
    shot.found && shot.dead, `${shot.before} to ${shot.after}`);

  // A vehicle that is done for burns for a few seconds and then goes up in a
  // fireball much bigger than itself, with fire thrown round it and left on
  // the street.
  const caught = await page.evaluate(() => {
    const s = window.spreefall;
    s.vehicles.reset();
    // Clear air for the picture: the tank before this one leaves its smoke.
    s.effects.clear();
    const jeep = s.vehicles.spawn('jeep', s.player.x - 16, s.player.z, 0);
    if (!jeep) return { skip: true };
    s.look(90, -8);
    const was = { caught: s.state.wrecksCaught || 0, blown: s.state.wrecksBlown || 0, fire: s.burningGround.length };
    s.vehicles.damage(jeep, 99999);
    return { skip: false, was, caught: (s.state.wrecksCaught || 0) - was.caught, blownAtOnce: (s.state.wrecksBlown || 0) - was.blown };
  });
  await page.waitForTimeout(1500);
  if (!caught.skip) await page.screenshot({ path: path.join(SHOTS, 'city-06-vehicle-burning.png') });
  const went = await page.evaluate(() => {
    const s = window.spreefall;
    const early = s.state.wrecksBlown || 0;
    return { early };
  });
  await page.waitForTimeout(2600);
  if (!caught.skip) await page.screenshot({ path: path.join(SHOTS, 'city-07-vehicle-blast.png') });
  const after = await page.evaluate(() => {
    const s = window.spreefall;
    // However slowly the frames come, it has gone by now.
    for (let i = 0; i < 60 * 4; i++) s.fixedForTest(1 / 60);
    const out = { blown: s.state.wrecksBlown || 0, fire: s.burningGround.length };
    s.vehicles.reset();
    return out;
  });
  check('a vehicle that is done for burns first, then goes up with fire left burning round it',
    !caught.skip && caught.caught === 1 && caught.blownAtOnce === 0 && went.early === caught.was.blown
      && after.blown === caught.was.blown + 1 && after.fire > caught.was.fire,
    JSON.stringify({ caught, went, after }));

  // --- and forward is forward ----------------------------------------------
  const facing = await page.evaluate(() => {
    const s = window.spreefall;
    const out = [];
    for (const yaw of [Math.PI / 2, Math.PI, -2.1]) {
      s.vehicles.reset();
      // From the open square, every time: the player is wherever the last
      // test left the jeep, which can be a kerb or a wall away from a tank
      // that then measures nothing because it cannot move.
      s.teleport(81, 0);
      s.look(0, 0);
      const t = s.vehicles.spawn('tank', s.player.x + 3, s.player.z, yaw);
      s.teleport(t.x + 1.5, t.z);
      s.toggleVehicle();
      // The view is read as an angle rather than off the camera's forward
      // vector, which is only recomputed when a frame is drawn.
      const cam = s.camera.yaw;
      const f = [-Math.sin(cam), -Math.cos(cam)];
      const was = { x: t.x, z: t.z };
      const got = s.state.inVehicle === t && s.vehicles.driving === t;
      s.input.keys.add('KeyW');
      let top = 0;
      for (let i = 0; i < 90; i++) { s.fixedForTest(1 / 60); top = Math.max(top, t.speed); }
      s.input.keys.delete('KeyW');
      const hullWas = t.yaw, camWas = s.camera.yaw;
      s.input.keys.add('KeyD');
      for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
      s.input.keys.delete('KeyD');
      const moved = { x: t.x - was.x, z: t.z - was.z };
      const len = Math.hypot(moved.x, moved.z) || 1;
      // And which way the hull is drawn, from what the renderer hands the
      // shader: rotY(-w) puts a nose built along -z at (sin w, -cos w). A tank
      // driving west used to be drawn facing east.
      s.renderer.actors.updateVehicles(s.vehicles.active);
      const w = s.renderer.actors.vehicles.tank.instData[3];
      const nose = [Math.sin(w), -Math.cos(w)];
      const heading = [-Math.sin(t.yaw), -Math.cos(t.yaw)];
      out.push({
        towardsView: +((moved.x / len) * f[0] + (moved.z / len) * f[1]).toFixed(2),
        got, top: +top.toFixed(1), mode: s.state.mode, moveZ: s.input.moveZ,
        drawnAlong: +(nose[0] * heading[0] + nose[1] * heading[1]).toFixed(2),
        hullTurn: +(t.yaw - hullWas).toFixed(2),
        camTurn: +(s.camera.yaw - camWas).toFixed(2),
      });
      s.toggleVehicle();
    }
    return out;
  });
  // --- the readout in front of you -----------------------------------------
  const hud = await page.evaluate(async () => {
    const s = window.spreefall;
    const read = () => ({
      name: document.getElementById('vehiclename').textContent,
      hull: document.getElementById('vehiclehull').style.width,
      speed: Number(document.getElementById('vehiclespeed').textContent),
      alt: document.getElementById('vehiclealtstat').classList.contains('hidden')
        ? null : Number(document.getElementById('vehiclealt').textContent),
      gun: document.getElementById('vehiclegun').textContent,
      warn: document.getElementById('vehiclewarn').classList.contains('hidden')
        ? '' : document.getElementById('vehiclewarn').textContent,
      shown: !document.getElementById('vehicle').classList.contains('hidden'),
    });
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    s.vehicles.reset();
    // The fire the wrecks before this left on the street (phase 118) is put
    // out, or the tank drives through it and the panel is right to say so.
    s.burningGround.length = 0;
    s.teleport(81, 0);
    s.look(0, 0);
    // A tank, driven, then shot at, then fired.
    const t = s.vehicles.spawn('tank', s.player.x + 4, s.player.z, 0);
    s.teleport(t.x + 1.5, t.z);
    s.toggleVehicle();
    s.input.keys.add('KeyW');
    // The fastest the panel ever showed, rather than whatever it reads at the
    // end: a tank that found a wall on the way is still a tank that drove.
    let topSpeed = 0;
    for (let i = 0; i < 180; i++) {
      s.fixedForTest(1 / 60);
      if (i % 10 === 0) { await frame(); topSpeed = Math.max(topSpeed, read().speed); }
    }
    s.input.keys.delete('KeyW');
    await frame();
    const driving = read();
    driving.topSpeed = topSpeed;
    // What the panel should say: whatever the street did to it on the way.
    driving.actual = `${Math.round(t.health / t.maxHealth * 100)}%`;
    s.vehicles.damage(t, t.maxHealth * 0.9);
    s.input.fire = true;
    for (let i = 0; i < 4; i++) s.fixedForTest(1 / 60);
    s.input.fire = false;
    await frame();
    const hurt = read();
    const critical = document.getElementById('vehicle').classList.contains('critical');
    s.toggleVehicle();
    // And a helicopter, which has one number a tank does not.
    s.vehicles.reset();
    const h = s.vehicles.spawn('heli', s.player.x + 4, s.player.z, 0, 0);
    s.teleport(h.x + 1.5, h.z);
    s.toggleVehicle();
    s.input.keys.add('Space');
    s.input.jumpHeld = true;
    for (let i = 0; i < 200; i++) s.fixedForTest(1 / 60);
    s.input.keys.delete('Space');
    s.input.jumpHeld = false;
    await frame();
    const flying = read();
    s.toggleVehicle();
    await frame();
    const onFoot = read();
    return { driving, hurt, critical, flying, onFoot };
  });
  check('what you are driving says what it is and what is left of it',
    hud.driving.shown && /Tank/.test(hud.driving.name) && hud.driving.hull === hud.driving.actual
      && parseInt(hud.driving.hull, 10) >= 90,
    `${hud.driving.name}, hull ${hud.driving.hull} of ${hud.driving.actual}`);
  check('and how fast it is going and whether the gun is ready',
    hud.driving.topSpeed > 12 && hud.hurt.gun !== 'ready',
    `up to ${hud.driving.topSpeed} km/h, gun ${hud.hurt.gun} after firing`);
  check('the hull bar falls with the hull, and goes red near the end',
    parseInt(hud.hurt.hull, 10) <= 10 && hud.critical,
    `${hud.hurt.hull} left`);
  check('an aircraft also reads its height above the ground',
    hud.flying.alt !== null && hud.flying.alt > 8,
    `${hud.flying.alt} m up`);
  check('and the panel goes away when you get out', !hud.onFoot.shown);

  // --- and the fighter actually flies --------------------------------------
  const takeoff = await page.evaluate(async () => {
    const s = window.spreefall;
    // The vehicles that go up in the checks before this one can kill you,
    // and since phase 120 dying is four seconds of slow motion with the
    // camera going round the body: the run is stood up before it flies.
    const down = document.getElementById('down');
    const wasDown = !!(s.state.death || (down && !down.classList.contains('hidden')));
    if (wasDown) document.getElementById('downbtn').click();
    s.setCheat('godmode', true);
    s.vehicles.reset();
    // And the fire the wrecks before it left on the street (phase 118) is
    // put out, or a fighter parked in it burns before it rolls.
    const burning = s.burningGround.length;
    s.burningGround.length = 0;
    // Off the ground, down a street, the way a player would have to do it.
    // The run is measured the width of the wings and from knee height up,
    // since a heap of rubble from the checks before is low and a wall at the
    // side of a street is only in the way of a wing tip: one ray down the
    // middle at three metres missed both, and a fighter rolled into one.
    const clearRun = (x, z, dx, dz) => {
      const g0 = s.world.groundHeight(x, z);
      let run = 400;
      for (const side of [-4.5, 0, 4.5]) {
        for (const up of [0.7, 1.6, 3]) {
          const hit = s.world.raycast(x - dz * side, g0 + up, z + dx * side, dx, 0, dz, 400);
          if (hit) run = Math.min(run, hit.t);
        }
      }
      return run;
    };
    // And from where: where you stand is wherever the checks before this one
    // left you, among their ruins, and in the live city that was 33 m of
    // room at best. So the long straight streets round the square are tried
    // too, from either end, and the fighter is put at the start of the
    // clearest of all of them.
    let best = { x: s.player.x, z: s.player.z, yaw: -Math.PI / 2, run: 0 };
    const tryRun = (x, z, dx, dz) => {
      if (s.world.isLoaded && !s.world.isLoaded(x, z)) return;
      const run = clearRun(x, z, dx, dz);
      if (run > best.run) best = { x, z, yaw: Math.atan2(-dx, -dz), run };
    };
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      tryRun(s.player.x, s.player.z, Math.cos(a), Math.sin(a));
    }
    for (const road of s.trafficRoads().roads) {
      for (let k = 2; k < road.pts.length; k += 2) {
        const ax = road.pts[k - 2], az = road.pts[k - 1], bx = road.pts[k], bz = road.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 150 || Math.hypot((ax + bx) / 2 - 81, (az + bz) / 2) > 900) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        tryRun(ax + ux * 5, az + uz * 5, ux, uz);
        tryRun(bx - ux * 5, bz - uz * 5, -ux, -uz);
      }
    }
    if (best.run > 0 && (best.x !== s.player.x || best.z !== s.player.z)) {
      s.teleport(best.x, best.z);
      for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    }
    const bestYaw = best.yaw, bestRun = best.run;
    const j = s.vehicles.spawn('jet', s.player.x, s.player.z, bestYaw, 0);
    s.teleport(j.x + 2, j.z);
    s.toggleVehicle();
    const aboard = s.state.inVehicle === j;
    const g = s.world.groundHeight(j.x, j.z);
    s.input.keys.add('KeyW');
    let rolled = 0;
    for (let i = 0; i < 60 * 6; i++) {
      // Nose level until it is fast enough, then pull back.
      s.look(bestYaw * 180 / Math.PI, j.speed > s.vehicleSpec.jet.stall + 4 ? 18 : 0);
      s.fixedForTest(1 / 60);
      // Wheels down is the spawn height, not zero: an aircraft sits on its
      // undercarriage.
      if (j.y - g < 4) rolled = i / 60;
    }
    s.input.keys.delete('KeyW');
    const climbed = j.y - g;
    const speed = j.speed;
    const health = j.health;
    if (s.state.inVehicle) s.toggleVehicle();
    // And from the menu, which hands you one already flying.
    const called = s.dropRide('jet');
    const inIt = s.state.inVehicle === called;
    const up = called ? called.y - s.world.groundHeight(called.x, called.z) : 0;
    if (s.state.inVehicle) s.toggleVehicle();
    return {
      rolled: Number(rolled.toFixed(1)),
      climbed: Math.round(climbed),
      speed: Math.round(speed),
      health,
      inIt,
      aboard,
      up: Math.round(up),
      wasDown, burning, run: Math.round(bestRun),
    };
  });
  check('a fighter can take off from the street it is parked in',
    takeoff.climbed > 60 && takeoff.speed > 60 && takeoff.health > 0,
    `rolled ${takeoff.rolled} s on a ${takeoff.run} m run, ${takeoff.climbed} m up at ${takeoff.speed} m/s, hull ${Math.round(takeoff.health)}, ${takeoff.burning} fires put out first`
      + (takeoff.aboard ? '' : ', nobody got in') + (takeoff.wasDown ? ', stood up first' : ''));
  check('and the menu hands you one already in the air',
    takeoff.inIt && takeoff.up > 100, `${takeoff.up} m up, flying`);

  // --- and it goes where you look ---------------------------------------------
  const steer = await page.evaluate(() => {
    const s = window.spreefall;
    s.setCheat('godmode', true);
    s.vehicles.reset();
    const j = s.dropRide('jet');
    if (!j) return { error: 'no ride' };
    const deg = 180 / Math.PI;
    const off = (want) => Math.round(Math.abs(Math.atan2(Math.sin(j.yaw - want), Math.cos(j.yaw - want))) * deg);
    const hold = (yaw, pitch, seconds) => {
      let bank = 0;
      for (let i = 0; i < 60 * seconds; i++) {
        s.look(yaw * deg, pitch);
        s.fixedForTest(1 / 60);
        if (Math.abs(j.roll) > Math.abs(bank)) bank = j.roll;
      }
      return bank;
    };
    const yaw0 = j.yaw;
    const leftBank = hold(yaw0 + 1.2, 0, 5);
    const left = off(yaw0 + 1.2);
    const rightBank = hold(yaw0 - 1.2, 0, 7);
    const right = off(yaw0 - 1.2);
    // Level, looking at the horizon: it should hold its height.
    hold(j.yaw, 0, 2);
    const y0 = j.y;
    hold(j.yaw, 0, 3);
    const drift = Math.round((j.y - y0) / 3);
    // And with the keys alone: right turns right, the same as on foot.
    const before = j.yaw;
    s.input.keys.add('KeyD');
    for (let i = 0; i < 60 * 2; i++) s.fixedForTest(1 / 60);
    s.input.keys.delete('KeyD');
    const keyTurn = Math.atan2(Math.sin(j.yaw - before), Math.cos(j.yaw - before));
    const alive = j.health > 0;
    if (s.state.inVehicle) s.toggleVehicle();
    return { left, right, leftBank, rightBank, drift, keyTurn, alive };
  });
  check('a fighter turns onto where you look, left and right',
    !steer.error && steer.left < 8 && steer.right < 8 && steer.alive,
    steer.error || `${steer.left} and ${steer.right} degrees off after the turn`);
  check('and banks into the turn it is making',
    // Positive roll lifts the right wing in the shader's rotZ: a left bank.
    steer.leftBank > 0.3 && steer.rightBank < -0.3,
    `${(steer.leftBank || 0).toFixed(2)} turning left, ${(steer.rightBank || 0).toFixed(2)} turning right`);
  check('and holds its height looking at the horizon', Math.abs(steer.drift) < 6,
    `${steer.drift} m a second`);
  check('and the right key turns it right', steer.keyTurn < -0.3,
    `${(steer.keyTurn || 0).toFixed(2)} rad`);

  check('forward drives where you are looking, however it was parked',
    facing.every((f) => f.towardsView > 0.97),
    facing.map((f) => f.towardsView).join(', ')
      + (facing.some((f) => !(f.towardsView > 0.97)) ? ` ${JSON.stringify(facing[0])}` : ''));
  check('and the hull is drawn pointing the way it drives',
    facing.every((f) => f.drawnAlong > 0.99),
    facing.map((f) => f.drawnAlong).join(', '));
  // A tank's view is the turret's, laid with the mouse, so the hull turns
  // under it and the view stays where you put it.
  check('and steering turns the hull under a view that stays where you put it',
    facing.every((f) => Math.abs(f.hullTurn) > 0.2 && Math.abs(f.camTurn) < 0.01),
    `hull ${facing[0].hullTurn} rad, view ${facing[0].camTurn} rad`);

  const turret = await page.evaluate(() => {
    const s = window.spreefall;
    s.vehicles.reset();
    s.look(0, 0);
    const t = s.vehicles.spawn('tank', s.player.x + 3, s.player.z, 0.4);
    s.teleport(t.x + 1.5, t.z);
    s.toggleVehicle();
    // Look well round to the left and see how far the turret has got.
    s.camera.yaw = t.yaw + 1.2;
    s.camera.pitch = 0.05;
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    const half = t.turret;
    for (let i = 0; i < 60 * 3; i++) s.fixedForTest(1 / 60);
    const laid = t.turret;
    // And fire it: the shell leaves the muzzle along the turret. Read off the
    // launch itself, because the last projectile in the pool after a step is
    // not necessarily this one, and a shell into a wall at eight metres is
    // gone before anybody looks at it.
    let shell = null;
    const launch = s.projectiles.launch.bind(s.projectiles);
    s.projectiles.launch = (kind, o) => {
      if (o && o.weapon === 'tank') shell = { ...o };
      return launch(kind, o);
    };
    t.cooldown = 0;
    s.input.fire = true;
    s.fixedForTest(1 / 60);
    s.input.fire = false;
    s.projectiles.launch = launch;
    const turretYaw = t.yaw + t.turret;
    const want = [-Math.sin(turretYaw), -Math.cos(turretYaw)];
    const sp = shell ? Math.hypot(shell.vx, shell.vz) || 1 : 1;
    const out = {
      half: +half.toFixed(2),
      laid: +laid.toFixed(2),
      fired: !!shell,
      along: shell ? +((shell.vx / sp) * want[0] + (shell.vz / sp) * want[1]).toFixed(3) : 0,
      ahead: shell ? +(((shell.x - t.x) * want[0] + (shell.z - t.z) * want[1])).toFixed(1) : 0,
    };
    s.toggleVehicle();
    return out;
  });
  check('a tank turret comes round to where you look, not at once',
    turret.half > 0.15 && turret.half < 0.6 && Math.abs(turret.laid - 1.2) < 0.02,
    `${turret.half} rad after half a second, ${turret.laid} of 1.2 after three and a half`);
  check('and the shell leaves the muzzle along the turret',
    turret.fired && turret.along > 0.99 && turret.ahead > 4,
    `along ${turret.along}, ${turret.ahead} m out in front of the hull`);

  // --- the pictures ---------------------------------------------------------
  await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.demolition.reset(); s.renderer.clearCollapses(); s.renderer.clearScars();
    s.gibs.clear(); s.effects.clear(); s.state.flash = 0;
    s.teleport(81, 0); s.look(90, -2); s.setTime(15.9);
    const x = s.player.x - 70, z = s.player.z;
    const y = s.world.groundHeight(x, z);
    // Two rounds, so the picture is a building half down rather than a heap:
    // half down is the thing worth showing.
    for (let i = 0; i < 2; i++) {
      s.demolition.blast(x, y + 8, z, 40, 500);
      for (let k = 0; k < 160; k++) { s.demolition.update(1 / 60); s.gibs.update(1 / 60); }
    }
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(SHOTS, 'city-01-collapse.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    const x = s.player.x - 70, z = s.player.z;
    const y = s.world.groundHeight(x, z);
    for (let i = 0; i < 3; i++) {
      s.demolition.blast(x, y + 8, z, 40, 500);
      for (let k = 0; k < 160; k++) { s.demolition.update(1 / 60); s.gibs.update(1 / 60); }
    }
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(SHOTS, 'city-04-flattened.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses(); s.renderer.clearScars();
    s.gibs.clear(); s.effects.clear(); s.state.flash = 0;
    s.setCheat('godmode', true);
    s.teleport(120, -6); s.look(268, -4); s.setTime(16.2);
    s.dropNuke(s.player.x + 330, s.player.z + 20);
    for (let i = 0; i < 60 * 5; i++) { s.projectiles.update(1 / 60); s.demolition.update(1 / 60); }
  });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(SHOTS, 'city-02-warhead.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    s.cheats.reset();
    s.demolition.reset(); s.renderer.clearCollapses(); s.renderer.clearScars();
    s.gibs.clear(); s.effects.clear(); s.state.flash = 0;
    s.vehicles.reset();
    s.teleport(81, 0); s.look(96, -4); s.setTime(16.6);
    s.vehicles.spawn('jeep', s.player.x - 16, s.player.z + 5, 1.1);
    s.vehicles.spawn('tank', s.player.x - 27, s.player.z - 5, 1.9);
    s.vehicles.spawn('heli', s.player.x - 44, s.player.z + 12, 0.7);
    s.vehicles.spawn('jet', s.player.x - 62, s.player.z - 12, 1.5);
  });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(SHOTS, 'city-05-vehicles.png') });

  await page.evaluate(() => {
    const s = window.spreefall;
    s.vehicles.reset();
    s.teleport(81, 0);
    s.beginTravel(s.player.x + 1200, s.player.z - 200);
  });
  await page.waitForTimeout(3400);
  await page.screenshot({ path: path.join(SHOTS, 'city-03-travel.png') });
  await page.evaluate(async () => {
    const s = window.spreefall;
    for (let i = 0; i < 900; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (s.state.mode === 'walk') break;
    }
    s.teleport(81, 0);
    s.demolition.reset(); s.renderer.clearCollapses();
  });

  // --- a hole shot in a frontage ------------------------------------------
  // A shell opens the wall it goes off against. The honest way to measure a
  // thing the fragment shader does is to draw the frame twice, once with the
  // hole and once with the same scar at nought, and count what moved: if the
  // discard never fires the two frames are the same buffer.
  const hole = await page.evaluate(async () => {
    const s = window.spreefall;
    const grab = () => {
      const gl = s.renderer.gl;
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return { buf, w, h };
    };
    const frame = () => new Promise((r) => {
      requestAnimationFrame(() => requestAnimationFrame(() => r(grab())));
    });
    s.demolition.reset();
    s.renderer.clearCollapses();
    s.renderer.scarredTiles.clear();
    // The shell's mark has to be the first in the ring, which is where the
    // hole is read from below, whatever went off earlier in the suite.
    s.renderer.clearScars();
    s.setCheat('godmode', true);
    s.setTime(11);
    s.teleport(81, 0);
    s.state.holstered = true;
    // A frontage the camera is pointing at, found by asking rather than by
    // guessing a bearing.
    let best = null;
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const d = { x: -Math.sin(a), z: -Math.cos(a) };
      const hit = s.world.raycast(s.player.x, s.player.y + 1.6, s.player.z, d.x, 0, d.z, 90);
      if (!hit || hit.t < 14) continue;
      if (s.world.tallestNear(s.player.x + d.x * hit.t, s.player.z + d.z * hit.t, 4) < 14) continue;
      if (!best || hit.t < best.t) best = { t: hit.t, a, d };
    }
    if (!best) return { skip: true, why: 'no frontage to shoot at' };
    s.teleport(s.player.x + best.d.x * (best.t - 13), s.player.z + best.d.z * (best.t - 13));
    s.look(best.a * 180 / Math.PI, 0);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    await frame();
    const eye = s.camera.position.slice();
    const f = s.camera.forward.slice();
    const ahead = s.world.raycast(eye[0], eye[1], eye[2], f[0], f[1], f[2], 120);
    if (!ahead) return { skip: true, why: 'nothing in front of the camera' };
    s.explode(eye[0] + f[0] * (ahead.t - 0.6), eye[1] + f[1] * (ahead.t - 0.6),
      eye[2] + f[2] * (ahead.t - 0.6), { radius: 11, damage: 240 }, { weapon: 'rpg' });
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    const punched = await frame();
    // The same frame with the hole closed and nothing else changed. The
    // shell's mark is the one that punches: whatever else the blast set off
    // (a parked car, a tree, more of them in the live city than in the
    // synthetic one) can put marks of its own in the ring before it.
    const info = s.renderer.scarInfo;
    let k = 0;
    for (let i = 0; i < s.renderer.scarCount; i++) if (info[i * 4 + 2] > info[k * 4 + 2]) k = i;
    const was = info[k * 4 + 2];
    info[k * 4 + 2] = 0;
    const solid = await frame();
    info[k * 4 + 2] = was;
    let moved = 0;
    for (let i = 0; i < punched.buf.length; i += 4) {
      if (Math.abs(punched.buf[i] - solid.buf[i])
        + Math.abs(punched.buf[i + 1] - solid.buf[i + 1])
        + Math.abs(punched.buf[i + 2] - solid.buf[i + 2]) > 24) moved++;
    }
    s.demolition.reset();
    s.renderer.clearCollapses();
    return { skip: false, punch: Math.round(was * 100) / 100, moved,
      share: Math.round(moved / (punched.w * punched.h) * 1000) / 10 };
  });
  check('a shell opens the wall it goes off against',
    !hole.skip && hole.punch > 1 && hole.share > 0.5,
    hole.skip ? hole.why : `${hole.punch} m of hole, ${hole.share}% of the frame through it`);

  // --- a rocket digs a hole, and it is the hole you stand in ---------------
  // This used to be the other way round: nothing under 55 m of blast dug at
  // all, because the ground mesh is a 12.5 m grid and a small hole had no
  // vertices inside it to move. The ground is cut finer where a blast lands
  // now, so what is tested is that the two agree.
  const small = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    // An open patch of street that nothing earlier in this suite has already
    // knocked about: by this point the city round the player is rubble in
    // places, and a hole measured in a ruin measures the ruin.
    let x = 0, z = 0, found = false;
    for (let r = 30; r <= 90 && !found; r += 20) {
      for (let a = 0; a < 12 && !found; a++) {
        const px = s.player.x + Math.cos(a / 12 * Math.PI * 2) * r;
        const pz = s.player.z + Math.sin(a / 12 * Math.PI * 2) * r;
        const i = s.world.tileIndex(px, pz);
        if (i < 0 || !s.world.tiles[i] || s.world.tiles[i].mesh) continue;
        if (s.world.tallestNear(px, pz, 12) > 0.6) continue;
        const drawn = s.drawnGround(px, pz);
        if (drawn === null) continue;
        if (Math.abs(drawn - s.world.groundHeight(px, pz)) > 0.2) continue;
        x = px; z = pz; found = true;
      }
    }
    if (!found) return { skip: true, why: 'nowhere level left to dig' };
    const y = s.world.groundHeight(x, z);
    const index = s.world.tileIndex(x, z);
    const before = s.world.tiles[index] ? s.world.tiles[index].vCount : 0;
    s.demolition.blast(x, y, z, 9, 150);
    const site = s.demolition.sites.find((v) => v.craterRadius > 0) || null;
    const crater = site ? site.craterRadius : 0;
    const depth = site ? site.depth : 0;
    for (let i = 0; i < 240; i++) s.demolition.update(1 / 60);
    const rec = s.world.tiles[index];
    // Across the hole: what you walk on against what you can see.
    let worst = 0;
    const rows = [];
    for (let d = 0; d <= crater * 2.2; d += 1.2) {
      const coll = s.world.groundHeight(x + d, z) - y;
      const drawn = s.drawnGround(x + d, z);
      if (drawn === null) continue;
      rows.push(d);
      worst = Math.max(worst, Math.abs(coll - (drawn - y)));
    }
    return {
      skip: false,
      crater: Number(crater.toFixed(1)), depth: Number(depth.toFixed(2)),
      dug: Number((y - s.world.groundHeight(x, z)).toFixed(2)),
      before, after: rec && rec.mesh ? rec.mesh.vCount : before,
      worst: Number(worst.toFixed(2)), points: rows.length,
    };
  });
  check('a rocket digs a hole in the street',
    small.skip || (small.crater > 3 && small.dug > 0.4),
    small.skip ? small.why : `${small.crater} m across, ${small.dug} m down`);
  check('and the ground under it is cut fine enough to show one',
    small.skip || small.after > small.before * 1.2,
    small.skip ? small.why : `${small.before} vertices in the tile, ${small.after} after`);
  check('and the hole you can see is the hole you stand in',
    small.skip || (small.points > 4 && small.worst < 0.4),
    small.skip ? small.why : `worst ${small.worst} m apart over ${small.points} points`);

  // --- the parked cars ------------------------------------------------------
  const car = await page.evaluate(async () => {
    const s = window.spreefall;
    s.cars.reset();
    const alive = s.cars.alive;
    if (!alive) return { skip: true, why: 'no cars in this district' };
    let car = null;
    for (const c of s.cars.list) {
      if (Math.hypot(c.x, c.z) > 1200) continue;
      car = c; break;
    }
    // Measured inside the car's own footprint: it is 1.78 by 4.3, so a metre
    // and a bit finds its own sides and not the bin on the pavement.
    const tallBefore = s.world.tallestNear(car.x, car.z, 1.2);
    // Two rifle magazines into it, one round at a time, the way a player
    // would: the hit goes in through the same path a bullet takes.
    let shots = 0;
    const blownBefore = s.state.carsBlown || 0;
    while (!car.dead && shots < 40) { s.hitCarForTest(car.x, car.z, 12); shots++; }
    // It burns before it goes.
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    const atOneSecond = (s.state.carsBlown || 0) - blownBefore;
    for (let i = 0; i < 60 * 3; i++) s.fixedForTest(1 / 60);
    const atFour = (s.state.carsBlown || 0) - blownBefore;
    return {
      skip: false, shots, dead: car.dead, before: alive, after: s.cars.alive, atOneSecond, atFour,
      tallBefore: Math.round(tallBefore * 100) / 100,
      tallAfter: Math.round(s.world.tallestNear(car.x, car.z, 1.2) * 100) / 100,
    };
  });
  check('a parked car takes a magazine and then goes up',
    car.skip || (car.dead && car.after < car.before),
    car.skip ? car.why : `${car.shots} rounds, ${car.before} to ${car.after} standing`);
  check('and it burns for a couple of seconds before it goes up',
    car.skip || (car.atOneSecond === 0 && car.atFour >= 1),
    car.skip ? car.why : `${car.atOneSecond} gone after a second, ${car.atFour} after four`);
  check('and what is left of it is a knee high wreck rather than a car',
    car.skip || (car.tallBefore > 1.2 && car.tallAfter > 0.2 && car.tallAfter < 1.0),
    car.skip ? car.why : `${car.tallBefore} m before, ${car.tallAfter} m after`);

  // --- and the hole is a hole rather than a picture of one -----------------
  // The shader's punch is one of sixteen marks and goes when the ring comes
  // round again. This is the other half: the hole is cut out of the buffers
  // and out of the collision, so what you can see through you can shoot
  // through, and the wall above it is still a wall.
  const opened = await page.evaluate(() => {
    const s = window.spreefall;
    s.setCheat('wreckBuildings', true);
    s.demolition.reset(); s.renderer.clearCollapses();
    s.teleport(700, -55);
    for (let i = 0; i < 40; i++) s.fixedForTest(1 / 60);
    let best = null;
    for (let yaw = 0; yaw < 360; yaw += 4) {
      s.look(yaw, 0); s.camera.update(16 / 9);
      const e = s.camera.position, f = s.camera.forward;
      const hit = s.world.raycast(e[0], e[1], e[2], f[0], f[1], f[2], 40);
      if (!hit || hit.kind !== 'wall' || hit.t < 6) continue;
      // On the wall itself rather than beside it: by this point in the suite
      // there is rubble in these streets, and a metre of heap in front of a
      // building passes a test that asks what is standing within four metres.
      if (s.world.tallestNear(hit.x, hit.z, 1.5) < 8) continue;
      if (!best || hit.t < best.t) best = { yaw, t: hit.t };
    }
    if (!best) return { skip: true, why: 'no frontage within forty metres' };
    s.look(best.yaw, 0); s.camera.update(16 / 9);
    const e = s.camera.position.slice(), f = s.camera.forward.slice();
    const solid = s.world.raycast(e[0], e[1], e[2], f[0], f[1], f[2], 80);
    const at = { x: e[0] + f[0] * (solid.t - 0.4), y: e[1] + f[1] * (solid.t - 0.4),
      z: e[2] + f[2] * (solid.t - 0.4) };
    const index = s.world.tileIndex(at.x, at.z);
    const before = s.world.tiles[index] ? s.world.tiles[index].vCount : 0;
    // How many walls stand across the shot at the height it goes in at, and
    // how near the nearest of them is.
    const crossing = (px, py, pz) => {
      let n = 0, near = 99;
      s.world.forEachSegmentTile(px - 5, pz - 5, px + 5, pz + 5, (sg, count) => {
        for (let i = 0; i < count; i++) {
          const o = i * 6;
          if (sg[o + 4] > py || sg[o + 5] < py) continue;
          const ex = sg[o + 2] - sg[o], ez = sg[o + 3] - sg[o + 1];
          const len2 = ex * ex + ez * ez || 1;
          let t = ((px - sg[o]) * ex + (pz - sg[o + 1]) * ez) / len2;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(sg[o] + ex * t - px, sg[o + 1] + ez * t - pz);
          if (d < 3) { n++; near = Math.min(near, d); }
        }
      });
      return { n, near: Number(near.toFixed(2)) };
    };
    const was = crossing(at.x, at.y, at.z);
    // Hard enough to open a hole, not hard enough to bring the frontage down:
    // a stage costs 180 and a punch needs 90.
    s.explode(at.x, at.y, at.z, { radius: 9, damage: 120 }, { weapon: 'rpg' });
    for (let i = 0; i < 90; i++) s.fixedForTest(1 / 60);
    const through = s.world.raycast(e[0], e[1], e[2], f[0], f[1], f[2], 80);
    // The same line, tilted up over the top of the hole.
    const ux = f[0], uy = 0.55, uz = f[2];
    const ul = Math.hypot(ux, uy, uz);
    const above = s.world.raycast(e[0], e[1], e[2], ux / ul, uy / ul, uz / ul, 80);
    const rec = s.world.tiles[index];
    let segs = 0;
    s.world.forEachSegmentTile(at.x - 4, at.z - 4, at.x + 4, at.z + 4, (sg, count) => {
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        const mx = (sg[o] + sg[o + 2]) * 0.5, mz = (sg[o + 1] + sg[o + 3]) * 0.5;
        if (Math.hypot(mx - at.x, mz - at.z) < 4 && sg[o + 5] - sg[o + 4] > 3) segs++;
      }
    });
    return {
      skip: false,
      wrecking: s.demolition.buildings,
      segs, was, now: crossing(at.x, at.y, at.z),
      kind: through ? through.kind : 'none',
      wallAt: Number(solid.t.toFixed(1)),
      openFor: through ? Number(through.t.toFixed(1)) : null,
      above: above ? Number(above.t.toFixed(1)) : null,
      standing: Number(s.world.tallestNear(at.x, at.z, 3).toFixed(1)),
      before, after: rec && rec.mesh ? rec.mesh.vCount : before,
    };
  });
  // Measured on the wall rather than down the line: a street of terraces has
  // another frontage a metre or two behind the one you hit, and whether the
  // shot carries on into the next room is not what this is about. What it is
  // about is that where the shell went in there is no longer a wall.
  check('a shell opens the wall in the collision, not only in the picture',
    opened.skip || (opened.was.near < 1 && opened.now.near > 1.4),
    opened.skip ? opened.why
      : `a wall ${opened.was.near} m from the burst before, `
        + `nothing within ${opened.now.near} m of it after`);
  check('and the hole is cut out of the tile rather than painted on it',
    opened.skip || opened.after > opened.before * 1.2,
    opened.skip ? opened.why : `${opened.before} vertices, ${opened.after} after`);
  check('and the building above the hole is still standing',
    opened.skip || (opened.above !== null && opened.standing > 8),
    opened.skip ? opened.why
      : `${opened.standing} m of it left, wall overhead at ${opened.above} m`);

  // --- the viaduct is a bridge, and there is an S-Bahn on it ---------------
  // The brick viaduct the Stadtbahn runs on was a 6.6 m wall across every
  // street the railway crosses: Friedrichstrasse ended at it. The crossings
  // are found in the map rather than written down, because this runs against
  // the synthetic city here and against OpenStreetMap's in CI, and the
  // corner that was Friedrichstrasse in one is a station hall in the other.
  const viaduct = await page.evaluate(async () => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const man = s.world.manifest;
    const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'bridleway', 'pedestrian', 'service']);
    const rails = (man.railLines || []).filter((r) => r.up);
    const roads = (man.roadLines || []).filter((r) => !FOOT.has(r.cls));
    const seg = (flat, i) => [[flat[i], flat[i + 1]], [flat[i + 2], flat[i + 3]]];
    const crossings = [];
    for (const r of rails) {
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const [a, b] = seg(r.pts, i);
        for (const road of roads) {
          for (let j = 0; j + 3 < road.pts.length; j += 2) {
            const [c, d] = seg(road.pts, j);
            const ex = b[0] - a[0], ez = b[1] - a[1], fx = d[0] - c[0], fz = d[1] - c[1];
            const den = ex * fz - ez * fx;
            if (Math.abs(den) < 1e-9) continue;
            const t = ((c[0] - a[0]) * fz - (c[1] - a[1]) * fx) / den;
            const u = ((c[0] - a[0]) * ez - (c[1] - a[1]) * ex) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            const fl = Math.hypot(fx, fz) || 1;
            // Square enough to be a street going under, not one running
            // alongside the arches.
            if (Math.abs(den) / ((Math.hypot(ex, ez) * fl) || 1) < 0.5) continue;
            crossings.push({ x: a[0] + ex * t, z: a[1] + ez * t, dx: fx / fl, dz: fz / fl, name: road.n || road.cls });
          }
        }
      }
    }
    // One per place: two tracks and a dual carriageway make four crossings
    // of the same corner.
    const places = [];
    for (const c of crossings) {
      if (places.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 30)) continue;
      places.push(c);
    }
    const shown = places.slice(0, 12);
    const results = [];
    for (const c of shown) {
      s.teleport(c.x - c.dx * 30, c.z - c.dz * 30);
      for (let i = 0; i < 4; i++) s.fixedForTest(1 / 60);
      // Along the street from sixteen metres one side to sixteen the other,
      // at the height of somebody's head. It was at 0.9 m, and on the real
      // city two of the three streets it reported blocked were stopped by
      // a parked car, 4.3 m long and 1.5 m high, which you walk round.
      const fx = c.x - c.dx * 16, fz = c.z - c.dz * 16;
      const y = s.world.groundHeight(fx, fz) + 1.9;
      // Each ray with a result of its own: the world hands back one shared
      // object unless it is given another, so the second ray used to write
      // over the first and every report described the arch at deck height
      // instead of whatever had stopped the street.
      const hit = s.world.raycast(fx, y, fz, c.dx, 0, c.dz, 32, {});
      const up = s.world.raycast(fx, s.world.groundHeight(fx, fz) + 5.9, fz, c.dx, 0, c.dz, 32, {});
      // What it ran into, when it ran into something: the wall's foot and
      // top over the street, how long it is and how square to the railway,
      // which tells a pier (six and a half metres, a metre and a half long,
      // along the line) from a building or a wall somebody else put there.
      // The ray hands back the segment it stopped on, which is the one to
      // describe: the nearest segment to the hit point was a lintel four
      // metres up three times running, which cannot stop a ray at 0.9 m.
      let what = null;
      if (hit) try {
        const hx = fx + c.dx * hit.t, hz = fz + c.dz * hit.t;
        const g = s.world.groundHeight(hx, hz);
        const g0 = s.world.groundHeight(fx, fz);
        if (hit.kind !== 'wall') {
          what = `the ground: ${(g - g0).toFixed(1)} m higher than where it started`;
        } else {
          const segs = s.world.segments(hit.tile);
          const [x1, z1, x2, z2, base, top] = segs.slice(hit.seg, hit.seg + 6);
          const ex = x2 - x1, ez = z2 - z1, len = Math.hypot(ex, ez) || 1;
          // And everything else standing within a metre of it that reaches
          // down to head height, by length, which tells a pier from a house.
          const others = [];
          for (let i = 0; i + 5 < segs.length; i += 6) {
            if (i === hit.seg) continue;
            const [a1, b1, a2, b2, lo, hi] = segs.slice(i, i + 6);
            const fx2 = a2 - a1, fz2 = b2 - b1, l2 = fx2 * fx2 + fz2 * fz2 || 1;
            const u = Math.max(0, Math.min(1, ((hx - a1) * fx2 + (hz - b1) * fz2) / l2));
            if (Math.hypot(a1 + fx2 * u - hx, b1 + fz2 * u - hz) > 1) continue;
            if (lo - g > 2) continue;
            others.push(`${Math.sqrt(l2).toFixed(1)} m ${(lo - g).toFixed(1)}..${(hi - g).toFixed(1)}`);
          }
          what = `${(base - g).toFixed(1)} to ${(top - g).toFixed(1)} m up, ${len.toFixed(1)} m long, `
            + `${Math.round(Math.abs(ex * c.dx + ez * c.dz) / len * 100)}% along the street, `
            + `ground ${(g - g0).toFixed(1)} m from the start`
            + (others.length ? `; also ${others.slice(0, 4).join(', ')}` : '');
        }
      } catch (e) { what = `could not tell: ${e.message}`; }
      results.push({ name: c.name, at: [Math.round(c.x), Math.round(c.z)], through: !hit,
        hit: hit ? Math.round(hit.t) : null, what, deck: !!up,
        standing: Number(s.world.tallestNear(c.x, c.z, 8).toFixed(1)) });
    }
    const first = shown[0] || { x: 637, z: -422 };
    // The train, run up to a crossing on the line that passes it. It is put
    // a hundred metres short of it first rather than waited for: a line can
    // be kilometres long.
    s.teleport(first.x, first.z + 40);
    for (let i = 0; i < 4; i++) s.fixedForTest(1 / 60);
    const lines = s.trains.lines.length;
    let line = null, best = 0, bestD = 1e9;
    for (const l of s.trains.lines) {
      let run = 0;
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1], b = l.pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let t = 0; t <= 1; t += 0.02) {
          const d = Math.hypot(a[0] + (b[0] - a[0]) * t - first.x, a[1] + (b[1] - a[1]) * t - first.z);
          if (d < bestD) { bestD = d; best = run + len * t; line = l; }
        }
        run += len;
      }
    }
    if (line) { line.at = Math.max(60, best - 110); line.dir = 1; }
    let near = 999;
    for (let i = 0; i < 60 * 20 && near > 20; i++) {
      s.fixedForTest(1 / 60);
      for (const c of s.trains.cars) near = Math.min(near, Math.hypot(c.x - first.x, c.z - first.z));
    }
    const car = s.trains.cars.find((c) => Math.hypot(c.x - first.x, c.z - first.z) < 60) || null;
    return {
      places: places.length, results,
      lines, longest: Math.round(Math.max(0, ...s.trains.lines.map((l) => l.length))),
      cars: s.trains.cars.length, near: Math.round(near),
      carHeight: car ? Number((car.y - s.world.groundHeight(car.x, car.z)).toFixed(1)) : null,
    };
  });
  const through = viaduct.results.filter((r) => r.through);
  const blockedAt = viaduct.results.filter((r) => !r.through)
    .map((r) => `${r.name} at ${r.at.join(', ')} after ${r.hit} m (${r.what || 'no wall found'})`);
  check('a street runs under the viaduct instead of into it',
    viaduct.results.length > 0 && through.length === viaduct.results.length
      && viaduct.results.every((r) => r.standing > 5),
    `${through.length} of ${viaduct.results.length} crossings clear at head height`
      + (blockedAt.length ? `; blocked: ${blockedAt.join('; ')}` : ''));
  check('and the arch is still brick above the arch',
    viaduct.results.length > 0 && viaduct.results.every((r) => r.deck),
    `${viaduct.results.filter((r) => r.deck).length} of ${viaduct.results.length} stopped at deck height`);
  check('an S-Bahn runs along the line on top of it',
    viaduct.lines > 0 && viaduct.cars >= 3 && viaduct.near <= 20,
    `${viaduct.cars} carriages on ${viaduct.lines} lines, the longest ${viaduct.longest} m, nearest ${viaduct.near} m from the crossing`);
  check('and it rides on the viaduct rather than in the street',
    viaduct.carHeight !== null && viaduct.carHeight > 5 && viaduct.carHeight < 9,
    `${viaduct.carHeight} m over the ground`);

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
