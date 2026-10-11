// Exercises the game layer in a real browser: the intro, the landmark cards,
// the enlarged map, photo mode and its PNG download, the shareable URL, the
// audio graph, and the completion screen. Fails on any console error.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const URL_BASE = process.env.SPREEFALL_URL || 'http://localhost:8080/';

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  ${detail}` : ''}`);
}

async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({
    executablePath: fs.existsSync(preinstalled) ? preinstalled : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  // A software rasteriser needs longer than the thirty second default to hand
  // back a frame, on this machine and on a CI runner alike.
  context.setDefaultTimeout(180000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.spreefall, null, { timeout: 120000 });

  // --- title and intro ----------------------------------------------------
  check('title screen is shown', await page.isVisible('#title'));
  await page.screenshot({ path: path.join(SHOTS, 'ui-01-title.png') });

  await page.click('#playbtn');
  await page.waitForTimeout(2500);
  const mode = await page.evaluate(() => window.spreefall.state.mode);
  check('pressing play starts the drone intro', mode === 'intro' || mode === 'landing', `mode ${mode}`);
  await page.screenshot({ path: path.join(SHOTS, 'ui-02-intro.png') });

  // Clicking skips the intro and lands the camera.
  await page.mouse.click(640, 400);
  await page.waitForTimeout(4200);
  const mode2 = await page.evaluate(() => window.spreefall.state.mode);
  check('clicking lands the camera and starts the walk', mode2 === 'walk', `mode ${mode2}`);

  // This suite is about the interface, so the fight is switched off for it.
  // On the live city it is not, and the first run of this file there ended with
  // the player shot dead halfway through: the systems down panel came up over
  // the whole screen and every later click landed on that instead of on what it
  // was aimed at.
  await page.evaluate(() => {
    const s = window.spreefall;
    s.drones.enabled = false; s.drones.reset();
    s.soldiers.enabled = false; s.soldiers.reset();
    s.combat.reset();
  });

  // --- landmark cards ------------------------------------------------------
  await page.evaluate(() => {
    const s = window.spreefall;
    const l = s.world.manifest.landmarks.find((x) => x.key === 'brandenburg_gate');
    s.teleport(l.x + 8, l.z + 8);
  });
  await page.waitForTimeout(1400);
  const cardText = await page.textContent('#cardhost').catch(() => '');
  check('walking up to the Gate slides a card in', /Brandenburg/i.test(cardText || ''), (cardText || '').slice(0, 40));
  await page.screenshot({ path: path.join(SHOTS, 'ui-03-card.png') });

  // --- minimap ------------------------------------------------------------
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(700);
  check('M enlarges the map', await page.evaluate(() => document.getElementById('minimap').classList.contains('big')));
  await page.screenshot({ path: path.join(SHOTS, 'ui-04-map.png') });
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(400);

  // --- photo mode ----------------------------------------------------------
  await page.evaluate(() => { const s = window.spreefall; s.teleport(1560, -180); s.look(-58, 22); });
  await page.waitForTimeout(2500);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(600);
  check('P opens photo mode and hides the interface',
    await page.isHidden('#hud') && await page.isVisible('#photo'));

  await page.evaluate(() => {
    const el = document.getElementById('tod');
    el.value = '6.4';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  const todLabel = await page.textContent('#todlabel');
  check('the time slider moves the sun', todLabel === '06:24', `label ${todLabel}`);
  await page.screenshot({ path: path.join(SHOTS, 'ui-05-photo.png') });

  const download = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#shoot');
  let saved = null;
  try {
    const d = await download;
    saved = await d.path();
    check('save PNG produces a download', !!saved, d.suggestedFilename());
  } catch (e) {
    check('save PNG produces a download', false, e.message);
  }
  if (saved) {
    const size = fs.statSync(saved).size;
    check('the saved PNG has real content', size > 40000, `${(size / 1024).toFixed(0)} kB`);
    fs.copyFileSync(saved, path.join(SHOTS, 'ui-06-saved-photo.png'));
  }

  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);

  // --- shareable URL -------------------------------------------------------
  // The pointer is locked, and a synthetic click jumps the mouse across the
  // page, which the game reads as an enormous look. That is right for a game
  // and wrong for a test, so the lock goes before anything is clicked and the
  // view is set after.
  await page.evaluate(() => { window.spreefall.input.exitLock(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { const s = window.spreefall; s.teleport(420, -40); s.look(-88, 3); s.setTime(12.25); });
  await page.waitForFunction(() => /^#4[12]\d(\.\d)?,/.test(location.hash), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  const hash = await page.evaluate(() => location.hash);
  check('the URL carries the position, heading and time', /^#-?\d+(\.\d+)?,/.test(hash), hash);

  const page2 = await context.newPage();
  page2.on('pageerror', (e) => errors.push(`pageerror(2): ${e.message}`));
  await page2.goto(URL_BASE + hash, { waitUntil: 'load', timeout: 90000 });
  await page2.waitForFunction(() => !!window.spreefall, null, { timeout: 120000 });
  const restored = await page2.evaluate(() => ({
    x: window.spreefall.player.x, z: window.spreefall.player.z,
    yaw: window.spreefall.camera.yaw * 180 / Math.PI,
    tod: window.spreefall.renderer.timeOfDay,
  }));
  check('opening that link restores the same view',
    Math.abs(restored.x - 420) < 2 && Math.abs(restored.z + 40) < 2
    && Math.abs(restored.tod - 12.25) < 0.02 && Math.abs(restored.yaw + 88) < 1,
    JSON.stringify(restored));
  await page2.close();

  // --- audio ---------------------------------------------------------------
  const audio = await page.evaluate(() => {
    const a = window.spreefall.audio;
    return { hasContext: !!a.ctx, state: a.ctx ? a.ctx.state : null, enabled: a.enabled, beds: a.beds ? Object.keys(a.beds).length : 0 };
  });
  check('the audio graph is built after the first gesture',
    audio.hasContext && audio.beds >= 5, JSON.stringify(audio));

  await page.click('#btnsound');
  await page.waitForTimeout(300);
  const muted = await page.evaluate(() => window.spreefall.audio.enabled);
  check('the sound button mutes', muted === false);
  await page.click('#btnsound');

  // --- completion ----------------------------------------------------------
  await page.evaluate(async () => {
    const s = window.spreefall;
    for (const l of s.world.manifest.landmarks) {
      if (!l.text) continue;
      s.teleport(l.x, l.z);
      s.landmarks.update(l.x, l.z, 0.016, s.player.distanceWalked);
    }
  });
  await page.waitForTimeout(2200);
  const done = await page.evaluate(() => ({
    found: window.spreefall.landmarks.found.size,
    total: window.spreefall.landmarks.total,
    shown: !document.getElementById('completion').classList.contains('hidden'),
    text: document.getElementById('completiontext').textContent,
  }));
  check('finding every landmark shows the completion screen',
    done.found === done.total && done.shown, `${done.found}/${done.total}`);
  check('the completion screen reports time and distance',
    /kilometres/.test(done.text) && /minutes/.test(done.text), done.text.slice(0, 70));
  await page.screenshot({ path: path.join(SHOTS, 'ui-07-completion.png') });

  // --- help and quality ----------------------------------------------------
  await page.evaluate(() => document.getElementById('completionclose').click());
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(400);
  check('H opens the help panel', await page.isVisible('#helppanel'));
  await page.keyboard.press('KeyH');

  // The number row carries the weapons now, so the tiers are on the function
  // keys, and the number row is checked for what it actually does.
  await page.keyboard.press('F1');
  await page.waitForTimeout(1400);
  check('F1 drops to the low quality tier',
    await page.evaluate(() => window.spreefall.renderer.quality) === 'low');
  await page.keyboard.press('F3');
  await page.waitForTimeout(1400);
  check('F3 returns to high',
    await page.evaluate(() => window.spreefall.renderer.quality) === 'high');

  await page.keyboard.press('Digit2');
  await page.waitForTimeout(500);
  check('2 brings up the shotgun',
    await page.evaluate(() => window.spreefall.weapon.id) === 'shotgun');
  await page.keyboard.press('Digit6');
  await page.waitForTimeout(500);
  const banana = await page.evaluate(() => ({
    id: window.spreefall.weapon.id,
    label: document.getElementById('weaponname').textContent,
  }));
  check('6 is the banana, and the interface says so',
    banana.id === 'banana' && banana.label === 'BANANA', JSON.stringify(banana));
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(500);
  check('Q goes back to what you had before',
    await page.evaluate(() => window.spreefall.weapon.id) === 'shotgun');

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  if (errors.length) {
    console.error(`\n${errors.length} console errors:`);
    for (const e of errors.slice(0, 10)) console.error(`  ${e}`);
  }
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
  if (failed.length || errors.length) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
