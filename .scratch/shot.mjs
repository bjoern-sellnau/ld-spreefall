import { chromium } from 'playwright';
const views = JSON.parse(process.argv[2]);
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage']});
const p = await b.newPage({viewport:{width:1280,height:720}});
p.on('pageerror', e=>console.log('[pageerror]', e.message));
p.on('console', m=>{ if(m.type()==='error') console.log('[err]', m.text().slice(0,300)); });
await p.goto('http://localhost:8080/', {waitUntil:'load', timeout:60000});
await p.waitForFunction(()=>!!window.spreefall, null, {timeout:90000});
await p.evaluate(()=>{ window.spreefall.skipToWalk(); window.spreefall.tiles.uploadsPerFrame=500; });
for (const v of views) {
  await p.evaluate(v => { const s=window.spreefall; s.teleport(v.x, v.z); s.look(v.yaw, v.pitch); s.setTime(v.tod); }, v);
  await p.waitForTimeout(v.wait || 5000);
  await p.screenshot({ path: `docs/screenshots/${v.name}.png` });
  const st = await p.evaluate(()=>({tris:window.spreefall.renderer.stats.triangles,draws:window.spreefall.renderer.stats.drawCalls,vis:window.spreefall.tiles.stats.visible,alt:(window.spreefall.renderer.sunAltitude*180/Math.PI).toFixed(1),y:window.spreefall.player.y.toFixed(2)}));
  console.log(v.name, JSON.stringify(st));
}
await b.close();
