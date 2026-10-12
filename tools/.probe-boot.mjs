import fs from 'node:fs';
import { chromium } from 'playwright';
const pre = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: fs.existsSync(pre) ? pre : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 600, height: 380 } });
page.setDefaultTimeout(60000);
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
try {
  await page.waitForFunction(() => !!window.spreefall, null, { timeout: 45000 });
  console.log('booted ok');
} catch {
  console.log('DID NOT BOOT');
}
console.log(errs.slice(0, 6).join('\n') || 'no errors');
await browser.close();
