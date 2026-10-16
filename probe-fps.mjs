import fs from 'node:fs';
import { chromium } from 'playwright';
const pre = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: fs.existsSync(pre) ? pre : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
page.setDefaultTimeout(120000);
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.spreefall);
const out = await page.evaluate(async () => {
  const s = window.spreefall;
  s.skipToWalk();
  s.tiles.uploadsPerFrame = 500;
  for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r));
  s.teleport(0, 0);
  s.look(90, -4);
  for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r));
  const samples = [];
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    samples.push(s.loop.stats.intervalMs);
  }
  samples.sort((a, b) => a - b);
  return {
    medianIntervalMs: Number(samples[Math.floor(samples.length / 2)].toFixed(1)),
    draws: s.loop.stats.drawCalls,
    tris: s.loop.stats.triangles,
  };
});
console.log(JSON.stringify(out));
await browser.close();
