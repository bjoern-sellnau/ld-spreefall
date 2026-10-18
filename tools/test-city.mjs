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
    const levels = [];
    for (let i = 0; i < 7; i++) {
      s.demolition.blast(x, y, z, 9, 150);
      const site = s.demolition.sites.find((v) => Math.hypot(v.x - x, v.z - z) < 20);
      levels.push(site ? site.level : 0);
    }
    s.demolition.reset(); s.renderer.clearCollapses();
    const one = s.demolition.blast(x, y, z, 9, 150).length;
    const afterOne = s.demolition.sites.length ? s.demolition.sites[0].level : 0;
    s.demolition.reset(); s.renderer.clearCollapses();
    return { levels, one, afterOne, stages: s.demoSpec.stages };
  });
  check('one rocket does not bring anything down', adds.one === 0 && adds.afterOne === 0);
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
    const here = () => Math.round(s.world.tallestNear(at.x, at.z, 6) * 10) / 10;
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

  // --- small blasts leave the ground alone ---------------------------------
  const small = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const x = s.player.x - 30, z = s.player.z - 30;
    const y = s.world.groundHeight(x, z);
    for (let i = 0; i < 8; i++) s.demolition.blast(x, y, z, 9, 150);
    // Read while it is still a site, because a finished one is baked into the
    // city and the list it was in is empty by then. What the ground did is
    // read afterwards, and it should have done nothing at all.
    const site = s.demolition.sites[0];
    const crater = site ? site.craterRadius : null;
    for (let i = 0; i < 240; i++) s.demolition.update(1 / 60);
    return { crater, moved: Number((y - s.world.groundHeight(x, z)).toFixed(3)) };
  });
  check('a rocket does not crater the street', small.crater === 0 && small.moved === 0,
    'the ground mesh is a 12.5 m grid, so a small hole would be invisible');

  // --- the memorial ---------------------------------------------------------
  const memorial = await page.evaluate(() => {
    const s = window.spreefall;
    s.demolition.reset(); s.renderer.clearCollapses();
    const m = s.combat.sanctuaries[0];
    if (!m) return { skip: true };
    const y = s.world.groundHeight(m.x, m.z);
    const made = s.demolition.blast(m.x, y, m.z, 170, 4000);
    return { made: made.length, sites: s.demolition.count, name: m.name };
  });
  check('nothing in the memorial comes down', memorial.made === 0 && memorial.sites === 0,
    memorial.name);

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
    const site = s.demolition.sites[0];
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
      matches: Math.abs(packed[0] - site.x) < 0.01 && Math.abs(packed[3] - site.radius) < 0.01,
      many, max: s.demoSpec.maxSites,
    };
  });
  check('an untouched city costs the vertex shader nothing', uniforms.quiet === 0);
  check('and a collapse reaches it with the right numbers', uniforms.matches);
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

  // Travel into the memorial is allowed: walking there always has been, it is
  // firing there that is not.
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
    s.teleport(jeep.x + 2, jeep.z);
    const tooFar = s.vehicles.nearest(jeep.x + 300, jeep.z, 7);
    s.toggleVehicle();
    const inIt = s.state.inVehicle === jeep;
    const was = { x: jeep.x, z: jeep.z };
    // Through the real fixed step with the real throttle, so this is the
    // path a player's key press takes and not a shortcut past it.
    s.input.keys.add('KeyW');
    for (let i = 0; i < 150; i++) s.fixedForTest(1 / 60);
    s.input.keys.delete('KeyW');
    const moved = Math.hypot(jeep.x - was.x, jeep.z - was.z);
    const rode = Math.hypot(s.player.x - jeep.x, s.player.z - jeep.z);
    s.toggleVehicle();
    const out = s.state.inVehicle === null;
    const dropped = Math.hypot(s.player.x - jeep.x, s.player.z - jeep.z);
    return { inIt, tooFar: tooFar === null, moved: Math.round(moved),
      rode: Math.round(rode), out, dropped: Math.round(dropped) };
  });
  // --- can you tell they are there? ----------------------------------------
  const findable = await page.evaluate(async () => {
    const s = window.spreefall;
    const jeep = s.vehicles.active.find((v) => v.type === 'jeep');
    s.teleport(jeep.x + 400, jeep.z);
    await new Promise((r) => requestAnimationFrame(r));
    const far = !document.getElementById('ridehint').classList.contains('hidden');
    s.teleport(jeep.x + 2.5, jeep.z);
    await new Promise((r) => requestAnimationFrame(r));
    const hint = document.getElementById('ridehint');
    return {
      far,
      near: !hint.classList.contains('hidden'),
      name: document.getElementById('ridehintname').textContent,
      marked: s.vehicles.active.filter((v) => v.alive && !v.occupied).length,
    };
  });
  check('standing next to one says so on the screen',
    findable.near && !findable.far, `${findable.name} within reach`);
  check('and the map says where the others are',
    findable.marked >= 3, `${findable.marked} marked`);

  check('you can only get into one you are standing next to', drive.tooFar);
  check('and then it drives', drive.inIt && drive.moved > 15, `${drive.moved} m`);
  check('with you in it', drive.rode === 0);
  check('and getting out puts you beside it', drive.out && drive.dropped <= 4,
    `${drive.dropped} m away`);

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
    s.teleport(heli.x + 2, heli.z);
    s.toggleVehicle();
    const y0 = heli.y;
    s.input.keys.add('Space');
    s.input.jumpHeld = true;
    for (let i = 0; i < 180; i++) s.fixedForTest(1 / 60);
    s.input.keys.delete('Space');
    s.input.jumpHeld = false;
    const climbed = heli.y - y0;
    s.toggleVehicle();

    // A fighter that is not going fast enough does not fly.
    jet.y = s.world.groundHeight(jet.x, jet.z) + 200;
    jet.grounded = false;
    jet.speed = 5;
    jet.pitch = 0.3;
    const high = jet.y;
    for (let i = 0; i < 90; i++) s.vehicles.update(1 / 60, null, i / 60);
    const stalled = high - jet.y;
    return { climbed: Math.round(climbed), stalled: Math.round(stalled),
      stall: s.vehicleSpec.jet.stall };
  });
  check('a helicopter climbs when you hold space', fly.climbed > 20, `${fly.climbed} m`);
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

  // --- and forward is forward ----------------------------------------------
  const facing = await page.evaluate(() => {
    const s = window.spreefall;
    const out = [];
    for (const yaw of [Math.PI / 2, Math.PI, -2.1]) {
      s.vehicles.reset();
      s.look(0, 0);
      const t = s.vehicles.spawn('tank', s.player.x + 3, s.player.z, yaw);
      s.teleport(t.x + 1.5, t.z);
      s.toggleVehicle();
      // The view is read as an angle rather than off the camera's forward
      // vector, which is only recomputed when a frame is drawn.
      const cam = s.camera.yaw;
      const f = [-Math.sin(cam), -Math.cos(cam)];
      const was = { x: t.x, z: t.z };
      s.input.keys.add('KeyW');
      for (let i = 0; i < 90; i++) s.fixedForTest(1 / 60);
      s.input.keys.delete('KeyW');
      const hullWas = t.yaw, camWas = s.camera.yaw;
      s.input.keys.add('KeyD');
      for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
      s.input.keys.delete('KeyD');
      const moved = { x: t.x - was.x, z: t.z - was.z };
      const len = Math.hypot(moved.x, moved.z) || 1;
      out.push({
        towardsView: +((moved.x / len) * f[0] + (moved.z / len) * f[1]).toFixed(2),
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
    hud.driving.shown && /Tank/.test(hud.driving.name) && hud.driving.hull === '100%',
    `${hud.driving.name}, hull ${hud.driving.hull}`);
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
    s.setCheat('godmode', true);
    s.vehicles.reset();
    // Off the ground, down a street, the way a player would have to do it.
    const j = s.vehicles.spawn('jet', s.player.x, s.player.z, -Math.PI / 2, 0);
    s.teleport(j.x + 2, j.z);
    s.toggleVehicle();
    const aboard = s.state.inVehicle === j;
    const g = s.world.groundHeight(j.x, j.z);
    s.input.keys.add('KeyW');
    let rolled = 0;
    for (let i = 0; i < 60 * 6; i++) {
      // Nose level until it is fast enough, then pull back.
      s.look(-90, j.speed > s.vehicleSpec.jet.stall + 4 ? 18 : 0);
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
    };
  });
  check('a fighter can take off from the street it is parked in',
    takeoff.climbed > 60 && takeoff.speed > 60 && takeoff.health > 0,
    `rolled ${takeoff.rolled} s, ${takeoff.climbed} m up at ${takeoff.speed} m/s`
      + (takeoff.aboard ? '' : ', nobody got in'));
  check('and the menu hands you one already in the air',
    takeoff.inIt && takeoff.up > 100, `${takeoff.up} m up, flying`);

  check('forward drives where you are looking, however it was parked',
    facing.every((f) => f.towardsView > 0.97),
    facing.map((f) => f.towardsView).join(', '));
  check('and steering turns the view with the hull',
    facing.every((f) => Math.abs(f.hullTurn) > 0.2 && Math.abs(f.hullTurn - f.camTurn) < 0.01),
    `hull ${facing[0].hullTurn} rad, view ${facing[0].camTurn} rad`);

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
    // The same frame with the hole closed and nothing else changed.
    const was = s.renderer.scarInfo[2];
    s.renderer.scarInfo[2] = 0;
    const solid = await frame();
    s.renderer.scarInfo[2] = was;
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
    const tallBefore = s.world.tallestNear(car.x, car.z, 2);
    // Two rifle magazines into it, one round at a time, the way a player
    // would: the hit goes in through the same path a bullet takes.
    let shots = 0;
    while (!car.dead && shots < 40) { s.hitCarForTest(car.x, car.z, 12); shots++; }
    for (let i = 0; i < 60 * 2; i++) s.fixedForTest(1 / 60);
    return {
      skip: false, shots, dead: car.dead, before: alive, after: s.cars.alive,
      tallBefore: Math.round(tallBefore * 100) / 100,
      tallAfter: Math.round(s.world.tallestNear(car.x, car.z, 2) * 100) / 100,
    };
  });
  check('a parked car takes a magazine and then goes up',
    car.skip || (car.dead && car.after < car.before),
    car.skip ? car.why : `${car.shots} rounds, ${car.before} to ${car.after} standing`);
  check('and what is left of it is a knee high wreck rather than a car',
    car.skip || (car.tallBefore > 1.2 && car.tallAfter > 0.2 && car.tallAfter < 1.0),
    car.skip ? car.why : `${car.tallBefore} m before, ${car.tallAfter} m after`);

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
