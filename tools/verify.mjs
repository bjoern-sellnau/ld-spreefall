// Headless verification and screenshots. Loads the page in Chromium with a real
// GPU path (SwiftShader when there is no hardware), waits for the world, walks
// to a set of fixed viewpoints and saves a screenshot for each, and fails on any
// console error or page exception.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const URL_BASE = process.env.SPREEFALL_URL || 'http://localhost:8080/';

// Fixed viewpoints, so a screenshot can be compared across builds.
// x and z are metres in the local plane, yaw and pitch in degrees.
export const VIEWPOINTS = [
  { name: '01-pariser-platz', x: 81, z: 0, yaw: 90, pitch: -1, tod: 17.9,
    caption: 'The spawn on Pariser Platz, looking west at the Brandenburg Gate' },
  { name: '02-through-the-gate', x: -34, z: 4, yaw: -90, pitch: 1, tod: 8.6,
    caption: 'West of the Gate, looking back east down Unter den Linden' },
  { name: '03-unter-den-linden', x: 560, z: -52, yaw: -88, pitch: 3, tod: 16.5,
    caption: 'The lime avenue on Unter den Linden' },
  { name: '04-memorial', x: 45, z: 260, yaw: 20, pitch: -4, tod: 13.0,
    caption: 'Inside the field of 2711 stelae' },
  { name: '05-reichstag', x: -100, z: -240, yaw: 20, pitch: 6, tod: 6.8,
    caption: 'The Reichstag from Scheidemannstrasse at sunrise' },
  { name: '06-museum-island', x: 1395, z: -195, yaw: -46, pitch: 17, tod: 18.4,
    caption: 'The Berlin Cathedral over the Lustgarten' },
  { name: '07-tv-tower', x: 1960, z: -430, yaw: -52, pitch: 30, tod: 19.0,
    caption: 'Under the Fernsehturm on Karl-Liebknecht-Strasse' },
  { name: '08-tower-over-the-roofs', x: 1560, z: -180, yaw: -58, pitch: 22, tod: 19.4,
    caption: 'The Fernsehturm over the roofs from Schlossplatz, with the Cathedral dome on the left' },
  { name: '08b-pariser-platz-east', x: 138, z: -8, yaw: -76, pitch: 5, tod: 20.2,
    caption: 'Looking east off Pariser Platz down Unter den Linden' },
  { name: '09-night', x: 700, z: -66, yaw: -90, pitch: 1, tod: 23.6,
    caption: 'Unter den Linden after dark, with the windows lit' },
  { name: '10-gendarmenmarkt', x: 1040, z: 300, yaw: 0, pitch: 6, tod: 11.2,
    caption: 'Gendarmenmarkt between the two cathedrals' },
  { name: '11-potsdamer-platz', x: -95, z: 745, yaw: -60, pitch: 12, tod: 15.4,
    caption: 'Potsdamer Platz and the towers' },
  { name: '12-spree', x: 830, z: -640, yaw: -90, pitch: 0, tod: 7.6,
    caption: 'The Spree by the Reichstagufer' },
];

async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  // The image ships its own Chromium at a different build number than the npm
  // package expects, so point Playwright at it directly rather than downloading.
  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({
    executablePath: fs.existsSync(preinstalled) ? preinstalled : undefined,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

  const errors = [];
  const logs = [];
  page.on('console', (msg) => {
    const text = `${msg.type()}: ${msg.text()}`;
    logs.push(text);
    if (msg.type() === 'error') errors.push(text);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

  console.log(`opening ${URL_BASE}`);
  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 90000 });

  await page.waitForFunction(() => !!window.spreefall, null, { timeout: 120000 });
  const info = await page.evaluate(() => ({
    renderer: window.spreefall.renderer.caps.renderer,
    totals: window.spreefall.world.manifest.totals,
    tiles: window.spreefall.world.tiles.length,
  }));
  console.log(`renderer: ${info.renderer}`);
  console.log(`world: ${JSON.stringify(info.totals)}`);

  await page.evaluate(() => window.spreefall.skipToWalk());
  await page.waitForTimeout(1200);

  const results = [];
  for (const v of VIEWPOINTS) {
    await page.evaluate((vp) => {
      const s = window.spreefall;
      s.teleport(vp.x, vp.z);
      s.look(vp.yaw, vp.pitch);
      s.setTime(vp.tod);
      s.renderer.timeOfDay = vp.tod;
      s.tiles.uploadsPerFrame = 400;
    }, v);
    // Let the tiles stream in and the shadow cascades settle.
    await page.waitForTimeout(2600);
    const shot = path.join(SHOTS, `${v.name}.png`);
    await page.screenshot({ path: shot });
    const stats = await page.evaluate(() => ({
      fps: window.spreefall.loop.stats.fps,
      frameMs: window.spreefall.loop.stats.frameMs,
      tris: window.spreefall.renderer.stats.triangles,
      draws: window.spreefall.renderer.stats.drawCalls,
      tiles: window.spreefall.tiles.stats.visible,
    }));
    results.push({ ...v, ...stats, file: path.relative(ROOT, shot) });
    console.log(`  ${v.name.padEnd(22)} ${stats.tris.toLocaleString().padStart(9)} tris  ${String(stats.draws).padStart(4)} draws  ${stats.frameMs.toFixed(1)} ms`);
  }

  // A short walk, to prove the controller does not fall through the world or
  // walk into a building.
  const walk = await page.evaluate(async () => {
    const s = window.spreefall;
    s.teleport(81, 0);
    s.look(90, 0);
    const start = { x: s.player.x, z: s.player.z };
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 240; i++) {
      s.player.step(1 / 60, 3.4, 0.2, false);
      minY = Math.min(minY, s.player.y);
      maxY = Math.max(maxY, s.player.y);
    }
    return {
      start, end: { x: s.player.x, z: s.player.z },
      moved: Math.hypot(s.player.x - start.x, s.player.z - start.z),
      minY, maxY, walked: s.player.distanceWalked,
    };
  });
  console.log(`walk: moved ${walk.moved.toFixed(1)} m, y stayed between ${walk.minY.toFixed(2)} and ${walk.maxY.toFixed(2)}`);

  await browser.close();

  fs.writeFileSync(path.join(SHOTS, 'index.json'), JSON.stringify({
    renderer: info.renderer, totals: info.totals, results, walk,
    capturedAt: new Date().toISOString(),
  }, null, 2));

  if (errors.length) {
    console.error(`\n${errors.length} console errors:`);
    for (const e of errors.slice(0, 12)) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log('\nno console errors');
}

run().catch((e) => { console.error(e); process.exit(1); });
