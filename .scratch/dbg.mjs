import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage']});
const p = await b.newPage({viewport:{width:1200,height:700}});
p.on('console', m => console.log('['+m.type()+']', m.text().slice(0,1500)));
p.on('pageerror', e => console.log('[pageerror]', e.message, '\n', (e.stack||'').slice(0,1200)));
p.on('requestfailed', r => console.log('[reqfail]', r.url(), r.failure()?.errorText));
await p.goto('http://localhost:8080/', {waitUntil:'load', timeout:60000});
await p.waitForTimeout(15000);
console.log('has spreefall:', await p.evaluate(()=>!!window.spreefall));
console.log('loadnote:', await p.evaluate(()=>document.getElementById('loadnote')?.textContent));
console.log('extra:', await p.evaluate(()=>document.querySelector('#loading pre')?.textContent||''));
await b.close();
