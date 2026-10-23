// .BACKDOOR: the mode on the title card, the phone and what it gets into.
//
// What is checked is what a player sees and does: the mode is a button with
// its own note, the street has more people in it, pointing at one of them
// brings up who they are, Q makes their phone ring and stops them where
// they stand, E empties their account into yours while the phone is kept on
// them and is lost if it is not, and the battery pays for all of it and
// fills again by itself.
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
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.spreefall, null, { timeout: 120000 });

  // --- the title card ---------------------------------------------------------
  const start = await page.evaluate(async () => {
    const s = window.spreefall;
    try { localStorage.removeItem('spreefall.backdoor.money'); } catch { /* private */ }
    document.querySelector('.diff.mode[data-mode=backdoor]').click();
    const lit = [...document.querySelectorAll('.diff.mode.on')].map((b) => b.dataset.mode);
    const note = document.getElementById('modenote').textContent;
    document.getElementById('playbtn').click();
    s.skipToWalk();
    s.tiles.uploadsPerFrame = 500;
    s.setQuality('low');
    s.teleport(81, 0); s.look(90, -4); s.setTime(15.4);
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { lit, note, budget: s.soldiers.civilianBudget, peaceful: s.state.peaceful,
      phone: !document.getElementById('phone').classList.contains('hidden'),
      money: document.getElementById('phmoney').textContent };
  });
  check('.BACKDOOR is a mode on the title card, with its own note',
    start.lit.length === 1 && start.lit[0] === 'backdoor' && /phone/.test(start.note), start.note.slice(0, 60));
  check('it is the peaceful city with more people in it, and the phone on the screen',
    start.peaceful && start.budget === 18 && start.phone && start.money === '€0', JSON.stringify(start));

  // One of them, held twelve metres in front of you, and nobody else about:
  // the mode keeps the street topped up, and a passer by with somewhere to be
  // walks off out of the crosshair, so the check holds both still.
  const stand = () => page.evaluate(async () => {
    const s = window.spreefall;
    clearInterval(window.pin);
    s.soldiers.reset();
    const c = s.soldiers.spawnCivilianNear(s.player.x, s.player.z, 8, 20);
    const X = s.player.x - 12, Z = s.player.z + 0.4;
    window.who = c;
    window.pin = setInterval(() => {
      for (const o of [...s.soldiers.active]) if (o !== c && o.civilian) s.soldiers._retire(o);
      if (window.unpinned) return;
      c.x = X; c.z = Z; c.y = s.world.groundHeight(X, Z);
      c.targetX = X - 30; c.targetZ = Z;
    }, 0);
    window.unpinned = false;
    s.look(90, -2);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    return true;
  });

  // --- the profiler --------------------------------------------------------------
  await stand();
  const seen = await page.evaluate(async () => {
    const s = window.spreefall;
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const t = s.hackTarget;
    const p = s.profileOf(window.who);
    const card = document.getElementById('hackcard');
    return { on: !!t && t.ref === window.who, shown: !card.classList.contains('hidden'),
      name: document.getElementById('hcname').textContent, want: p.name,
      job: document.getElementById('hcjob').textContent, acts: document.getElementById('hcacts').textContent,
      mark: !document.getElementById('hackmark').classList.contains('hidden') };
  });
  await page.screenshot({ path: path.join(SHOTS, 'backdoor-01-profiler.png') });
  check('pointed at somebody, the phone says who they are',
    seen.on && seen.shown && seen.mark && seen.name === seen.want && /a year/.test(seen.job),
    `${seen.name}; ${seen.job}`);
  check('and what it can do to them, on Q and E', /Q\s*Distract/.test(seen.acts) && /E\s*(Empty account|Account empty)/.test(seen.acts),
    seen.acts);
  const away = await page.evaluate(async () => {
    const s = window.spreefall;
    s.look(0, -2);
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    const out = { target: !!s.hackTarget, card: !document.getElementById('hackcard').classList.contains('hidden') };
    s.look(90, -2);
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    return out;
  });
  check('and nothing when it is pointed at nobody', !away.target && !away.card, JSON.stringify(away));

  // --- Q: their phone rings and they stop to look at it ---------------------------
  const distract = await page.evaluate(async () => {
    const s = window.spreefall;
    const bat = s.phone.battery;
    const ok = s.hackKey(0);
    window.unpinned = true;                         // on his way somewhere, if nothing stops him
    return { bat, ok };
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const s = window.spreefall;
    const c = window.who;
    const x0 = c.x;
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    return { phoneLeft: c.phoneLeft, moved: Math.abs(c.x - x0), bat: s.phone.battery };
  });
  check('Q rings their phone: they stop where they are and look at it, for battery',
    distract.ok && after.phoneLeft > 0 && after.moved < 0.05 && after.bat < distract.bat - 5,
    JSON.stringify({ distract, after }));

  // --- E: their account, kept on them until it is done ---------------------------
  await stand();
  const bank = await page.evaluate(async () => {
    const s = window.spreefall;
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    const p = s.profileOf(window.who);
    const had = p.bank;
    s.phone.battery = 100;
    const money = s.phone.money;
    const ok = s.hackKey(1);
    return { had, money, ok };
  });
  await page.waitForFunction(() => !window.spreefall.phone.job, null, { timeout: 30000 }).catch(() => {});
  const banked = await page.evaluate(() => {
    const s = window.spreefall;
    return { money: s.phone.money, left: s.profileOf(window.who).bank,
      shown: document.getElementById('phmoney').textContent,
      again: document.getElementById('hcacts').textContent };
  });
  check('E empties their account into yours once the phone has been kept on them',
    bank.ok && banked.money === bank.money + bank.had && banked.left === 0,
    `${bank.had} taken, ${banked.shown}`);
  check('and there is nothing left to take a second time', /Account empty/.test(banked.again), banked.again);
  check('and what you have taken is kept for the next time',
    await page.evaluate(() => parseInt(localStorage.getItem('spreefall.backdoor.money'), 10)) === banked.money);

  await stand();
  const lost = await page.evaluate(async () => {
    const s = window.spreefall;
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    s.phone.battery = 100;
    const money = s.phone.money;
    const ok = s.hackKey(1);
    s.look(0, -2);
    for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r));
    return { ok, job: !!s.phone.job, same: s.phone.money === money, bat: s.phone.battery };
  });
  check('looked away half way, the hack is lost and the battery stays spent',
    lost.ok && !lost.job && lost.same && lost.bat < 100, JSON.stringify(lost));

  const empty = await page.evaluate(async () => {
    const s = window.spreefall;
    s.look(90, -2);
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    s.phone.battery = 4;
    const refused = !s.hackKey(0);
    const toast = (document.getElementById('toast') || {}).textContent || '';
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 2500));
    return { refused, toast, bat: s.phone.battery, low: document.getElementById('phone').classList.contains('low'),
      secs: (performance.now() - t0) / 1000 };
  });
  check('with the battery flat it says so, and it fills again by itself',
    empty.refused && /battery/.test(empty.toast) && empty.bat > 4, JSON.stringify(empty));

  await page.evaluate(() => clearInterval(window.pin));
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
