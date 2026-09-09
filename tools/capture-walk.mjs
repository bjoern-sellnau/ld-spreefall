// Record the walk from the Brandenburg Gate to the Fernsehturm as a WebM.
// Playwright records the page itself, so what lands in the file is exactly what
// the renderer drew.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'media');
const URL_BASE = process.env.SPREEFALL_URL || 'http://localhost:8080/';
const SECONDS = parseFloat(process.env.SPREEFALL_CLIP_SECONDS || '11');

// A gentle spline east down Unter den Linden, then a turn up to the tower.
const PATH_POINTS = [
  { x: 120, z: -6, yaw: -76, pitch: 2 },
  { x: 420, z: -50, yaw: -80, pitch: 3 },
  { x: 760, z: -70, yaw: -82, pitch: 4 },
  { x: 1120, z: -105, yaw: -78, pitch: 5 },
  { x: 1450, z: -160, yaw: -70, pitch: 8 },
  { x: 1700, z: -280, yaw: -62, pitch: 14 },
  { x: 1930, z: -400, yaw: -56, pitch: 24 },
  { x: 2040, z: -470, yaw: -52, pitch: 32 },
];

function sample(t) {
  const n = PATH_POINTS.length - 1;
  const f = Math.min(0.9999, Math.max(0, t)) * n;
  const i = Math.floor(f);
  const k = f - i;
  const a = PATH_POINTS[i], b = PATH_POINTS[Math.min(n, i + 1)];
  const s = k * k * (3 - 2 * k);
  return {
    x: a.x + (b.x - a.x) * s,
    z: a.z + (b.z - a.z) * s,
    yaw: a.yaw + (b.yaw - a.yaw) * s,
    pitch: a.pitch + (b.pitch - a.pitch) * s,
  };
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({
    executablePath: fs.existsSync(preinstalled) ? preinstalled : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));

  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.spreefall, null, { timeout: 120000 });
  await page.evaluate(() => {
    window.spreefall.skipToWalk();
    window.spreefall.tiles.uploadsPerFrame = 600;
    document.getElementById('hud').classList.add('hidden');
  });

  // Pre stream the whole route so nothing pops in during the clip.
  for (const p of PATH_POINTS) {
    await page.evaluate((v) => window.spreefall.teleport(v.x, v.z), p);
    await page.waitForTimeout(900);
  }

  const start = Date.now();
  const step = 90;
  while (Date.now() - start < SECONDS * 1000) {
    const t = (Date.now() - start) / (SECONDS * 1000);
    const v = sample(t);
    await page.evaluate((p) => {
      const s = window.spreefall;
      s.teleport(p.x, p.z);
      s.look(p.yaw, p.pitch);
      s.setTime(19.1);
    }, v);
    await page.waitForTimeout(step);
  }

  const video = page.video();
  await context.close();
  await browser.close();
  const src = await video.path();
  const dest = path.join(OUT_DIR, 'gate-to-tower.webm');
  fs.renameSync(src, dest);
  const size = fs.statSync(dest).size;
  console.log(`wrote ${path.relative(ROOT, dest)}, ${(size / 1e6).toFixed(2)} MB`);
}

run().catch((e) => { console.error(e); process.exit(1); });
