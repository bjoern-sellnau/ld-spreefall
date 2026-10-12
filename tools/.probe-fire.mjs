import fs from 'node:fs';
import { chromium } from 'playwright';
const pre = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: fs.existsSync(pre) ? pre : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.setDefaultTimeout(180000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.spreefall);
await page.evaluate(() => {
  const s = window.spreefall;
  s.skipToWalk(); s.tiles.uploadsPerFrame = 500; s.setQuality('low'); s.setTime(20.5);
  s.cheats.reset(); s.drones.enabled = false; s.jets.enabled = false;
  s.teleport(300, 40); s.look(90, -3);
});
await page.waitForTimeout(3000);
console.log('select:', await page.evaluate(() => {
  const s = window.spreefall;
  s.weapon.giveAll();
  const ok = s.weapon.select('flamer');
  return { ok, id: s.weapon.id, ammo: Math.round(s.weapon.ammo), name: s.weapon.spec.name };
}));
console.log('stream:', await page.evaluate(async () => {
  const s = window.spreefall;
  s.soldiers.spawnNear(s.player.x + 10, s.player.z, 8, 12);
  const before = s.soldiers.active.length;
  const hp0 = s.soldiers.active[0] ? s.soldiers.active[0].health : 0;
  for (let i = 0; i < 90; i++) { s.holdFire(true); await new Promise((r) => requestAnimationFrame(r)); }
  s.holdFire(false);
  const sd = s.soldiers.active[0];
  return { fuelLeft: Math.round(s.weapon.ammo), soldiers: before,
    firstHealth: sd ? Math.round(sd.health) : 'gone', charred: sd ? +(sd.charred || 0).toFixed(2) : 'gone',
    hp0: Math.round(hp0), fires: s.fires.count };
}));
await page.screenshot({ path: '/tmp/claude-0/-home-user-ld-spreefall/e19bc958-3a70-5542-a602-37077540eaeb/scratchpad/flame.png' });
console.log('wall:', await page.evaluate(async () => {
  const s = window.spreefall;
  const made = s.weapon.altFire({ x: s.player.x, y: s.player.y + 1.6, z: s.player.z },
    { x: 1, y: 0, z: 0 });
  const n0 = s.fireWalls.count;
  let travelled = 0;
  for (let i = 0; i < 120; i++) { await new Promise((r) => requestAnimationFrame(r)); }
  const w = s.fireWalls.active[0];
  if (w) travelled = Math.round(w.travelled);
  return { made, walls: n0, travelled, fires: s.fires.count, fuel: Math.round(s.weapon.ammo) };
}));
await page.screenshot({ path: '/tmp/claude-0/-home-user-ld-spreefall/e19bc958-3a70-5542-a602-37077540eaeb/scratchpad/wall.png' });
console.log('incendiary:', await page.evaluate(async () => {
  const s = window.spreefall;
  s.weapon.select('incendiary');
  const x = s.player.x + 30, z = s.player.z;
  s.explode(x, s.world.groundHeight(x, z) + 1, z, { radius: 11, damage: 70 }, { weapon: 'incendiary' });
  await new Promise((r) => requestAnimationFrame(r));
  return { fires: s.fires.count, id: s.weapon.id };
}));
console.log('errors:', errs.slice(0, 5));
await browser.close();
