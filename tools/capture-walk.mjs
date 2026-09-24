// Record the walk from the Brandenburg Gate to the Fernsehturm as a WebM.
// Playwright records the page itself, so what lands in the file is exactly what
// the renderer drew.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'media');
const URL_BASE = process.env.SPREEFALL_URL || 'http://localhost:8080/';
const SECONDS = parseFloat(process.env.SPREEFALL_CLIP_SECONDS || '11');
const FPS = parseInt(process.env.SPREEFALL_CLIP_FPS || '12', 10);
const WIDTH = 1280;
const HEIGHT = 720;
const TIME_OF_DAY = 19.1;

// A gentle spline east down Unter den Linden, then a turn up to the tower.
const PATH_POINTS = [
  { x: 200, z: -11, yaw: -75.9, pitch: 3 },
  { x: 537, z: -32, yaw: -73.8, pitch: 5 },
  { x: 875, z: -54, yaw: -70.7, pitch: 8 },
  { x: 1212, z: -78, yaw: -65.7, pitch: 11 },
  { x: 1545, z: -125, yaw: -58.1, pitch: 16 },
  { x: 1790, z: -300, yaw: -60.0, pitch: 22 },
  { x: 1935, z: -420, yaw: -56.0, pitch: 29 },
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

// Playwright records video through its own ffmpeg build, pinned to a revision.
// This image ships a slightly newer one, so point the expected path at it rather
// than trying to download anything.
function ensureFfmpeg() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return;
  let want;
  try {
    const list = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'node_modules', 'playwright-core', 'browsers.json'), 'utf8'));
    want = (list.browsers.find((b) => b.name === 'ffmpeg') || {}).revision;
  } catch { return; }
  if (!want) return;
  const wantDir = path.join(root, `ffmpeg-${want}`);
  if (fs.existsSync(path.join(wantDir, 'ffmpeg-linux'))) return;
  const have = fs.readdirSync(root).find((d) => /^ffmpeg-\d+$/.test(d)
    && fs.existsSync(path.join(root, d, 'ffmpeg-linux')));
  if (!have) return;
  fs.mkdirSync(wantDir, { recursive: true });
  fs.symlinkSync(path.join(root, have, 'ffmpeg-linux'), path.join(wantDir, 'ffmpeg-linux'));
  fs.writeFileSync(path.join(wantDir, 'INSTALLATION_COMPLETE'), '');
  console.log(`aliased ffmpeg-${want} to ${have}`);
}

/** Ask ffmpeg where the picture actually is inside the padded frame. */
function detectCrop(ffmpeg, file) {
  const r = spawnSync(ffmpeg, [
    '-hide_banner', '-ss', '2', '-i', file, '-frames:v', '24',
    '-vf', 'cropdetect=24:2:0', '-f', 'null', '-',
  ], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const hits = [...out.matchAll(/crop=(\d+:\d+:\d+:\d+)/g)].map((m) => m[1]);
  if (!hits.length) return null;
  const last = hits[hits.length - 1];
  const [w, h] = last.split(':').map(Number);
  if (!w || !h || w < 200 || h < 120) return null;
  console.log(`cropping the screencast padding to ${last}`);
  return last;
}

function findFfmpeg() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return null;
  const dir = fs.readdirSync(root).find((d) => /^ffmpeg-\d+$/.test(d)
    && fs.existsSync(path.join(root, d, 'ffmpeg-linux')));
  return dir ? path.join(root, dir, 'ffmpeg-linux') : null;
}

/** A minimal PNG reader, enough to measure where the picture stops. */
function readPng(file) {
  const buf = fs.readFileSync(file);
  let o = 8;
  const idat = [];
  let w = 0, h = 0, colourType = 0;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IHDR') { w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12); colourType = buf[o + 17]; }
    if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colourType === 6 ? 4 : 3;
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[(y - 1) * stride + x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

/**
 * Chromium's screencast pads the frame with a flat grey band. cropdetect is
 * built for black bars and will not find it, so measure it: scan up from the
 * bottom for the first row that is not one flat colour.
 */
function measureContent(pngFile) {
  const img = readPng(pngFile);
  const rowVaries = (y) => {
    let lo = 255, hi = 0;
    for (let x = 0; x < img.w; x += 4) {
      const v = img.data[(y * img.w + x) * img.ch];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo > 6;
  };
  let bottom = img.h;
  while (bottom > img.h * 0.5 && !rowVaries(bottom - 1)) bottom--;
  let right = img.w;
  const colVaries = (x) => {
    let lo = 255, hi = 0;
    for (let y = 0; y < bottom; y += 4) {
      const v = img.data[(y * img.w + x) * img.ch];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo > 6;
  };
  while (right > img.w * 0.5 && !colVaries(right - 1)) right--;
  // Even dimensions, which the encoder wants.
  bottom -= bottom % 2;
  right -= right % 2;
  return { width: right, height: bottom, full: { w: img.w, h: img.h } };
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  ensureFfmpeg();
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) { console.error('no ffmpeg available'); process.exit(1); }

  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({
    executablePath: fs.existsSync(preinstalled) ? preinstalled : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));

  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.spreefall, null, { timeout: 120000 });
  await page.evaluate(() => {
    window.spreefall.skipToWalk();
    window.spreefall.tiles.uploadsPerFrame = 800;
    window.spreefall.renderer.setQuality('medium');
    document.getElementById('hud').classList.add('hidden');
  });

  process.stdout.write('streaming the route ');
  for (const p of PATH_POINTS) {
    await page.evaluate((v) => {
      const s = window.spreefall;
      s.teleport(v.x, v.z);
      s.look(v.yaw, v.pitch);
      s.setTime(v.tod);
    }, { ...p, tod: TIME_OF_DAY });
    await page.waitForTimeout(1000);
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  const start = Date.now();
  process.stdout.write('walking ');
  while (Date.now() - start < SECONDS * 1000) {
    const t = (Date.now() - start) / (SECONDS * 1000);
    const v = sample(t);
    await page.evaluate((p) => {
      const s = window.spreefall;
      s.teleport(p.x, p.z);
      s.look(p.yaw, p.pitch);
      s.setTime(p.tod);
    }, { ...v, tod: TIME_OF_DAY });
    await page.waitForTimeout(70);
  }
  // Hold on the last pose. The screencast lags a busy rasteriser by a second or
  // two, so without this the trimmed tail stops short of the destination.
  const last = sample(1);
  await page.evaluate((p) => {
    const s = window.spreefall;
    s.teleport(p.x, p.z);
    s.look(p.yaw, p.pitch);
    s.setTime(p.tod);
  }, { ...last, tod: TIME_OF_DAY });
  await page.waitForTimeout(3200);
  process.stdout.write('\n');

  const video = page.video();
  await context.close();
  await browser.close();
  const src = await video.path();

  const probe = path.join(OUT_DIR, 'probe.png');
  spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-sseof', `-${(SECONDS * 0.5).toFixed(1)}`, '-i', src, '-frames:v', '1', probe],
    { stdio: 'inherit' });
  let crop = null;
  if (fs.existsSync(probe)) {
    const box = measureContent(probe);
    if (box.width < box.full.w || box.height < box.full.h) {
      crop = `${box.width}:${box.height}:0:0`;
      console.log(`screencast padding found, cropping to ${crop} from ${box.full.w}x${box.full.h}`);
    }
    fs.rmSync(probe, { force: true });
  }

  const filters = [];
  if (crop) filters.push(`crop=${crop}`);
  filters.push(`scale=${WIDTH}:${HEIGHT}:flags=lanczos`);

  const dest = path.join(OUT_DIR, 'gate-to-tower.webm');
  const r = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-sseof', `-${SECONDS.toFixed(1)}`, '-i', src,
    '-vf', filters.join(','),
    '-c:v', 'libvpx', '-b:v', '1800k', '-crf', '28', '-pix_fmt', 'yuv420p', '-an', dest,
  ], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('ffmpeg failed'); process.exit(1); }

  // No GIF here: the ffmpeg that ships with Playwright is a minimal build with
  // seven video filters and one encoder, and it has neither palettegen nor a
  // gif encoder. With a full ffmpeg on the path, one line does it:
  //   ffmpeg -i gate-to-tower.webm -vf "fps=12,scale=720:-1:flags=lanczos,\
  //     split[a][b];[a]palettegen[p];[b][p]paletteuse" gate-to-tower.gif
  fs.rmSync(src, { force: true });

  for (const f of [dest]) {
    if (fs.existsSync(f)) {
      console.log(`wrote ${path.relative(ROOT, f)}, ${(fs.statSync(f).size / 1e6).toFixed(2)} MB`);
    }
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
