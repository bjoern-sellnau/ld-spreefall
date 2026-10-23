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

  // --- traffic -------------------------------------------------------------------
  const traffic = await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset();
    s.vehicles.reset();
    s.teleport(81, 0);
    const roads = s.trafficRoads().roads.length;
    let fastest = 0;
    for (let i = 0; i < 60 * 10; i++) {
      s.fixedForTest(1 / 60);
      for (const v of s.vehicles.active) if (v.traffic) fastest = Math.max(fastest, v.speed);
    }
    const list = s.vehicles.active.filter((v) => v.traffic);
    return { roads, cars: list.filter((v) => v.type === 'car').length, buses: list.filter((v) => v.type === 'bus').length,
      fastest: +fastest.toFixed(1),
      near: Math.min(...list.map((v) => Math.round(Math.hypot(v.x - s.player.x, v.z - s.player.z)))) };
  });
  check('the streets have traffic in them: cars and buses, driving',
    traffic.roads > 0 && traffic.cars >= 6 && traffic.buses >= 1 && traffic.fastest > 8, JSON.stringify(traffic));

  // By the side of a long straight street near the square, looking at it,
  // with the street to itself: what the next checks put on it is all there is.
  const byRoad = () => page.evaluate(async () => {
    const s = window.spreefall;
    s.vehicles.reset(); s.soldiers.reset();
    s.teleport(81, 0);
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    const seg = s.straightNear(81, 0, 60);
    if (!seg) return null;
    const ux = (seg.bx - seg.ax) / seg.len, uz = (seg.bz - seg.az) / seg.len;
    const mx = (seg.ax + seg.bx) / 2, mz = (seg.az + seg.bz) / 2;
    const g = s.world.groundHeight(mx, mz);
    let at = null;
    for (const side of [1, -1]) {
      for (const off of [seg.w * 0.5 + 3, seg.w * 0.5 + 1.5]) {
        const px = mx - uz * off * side, pz = mz + ux * off * side;
        if (s.world.lineOfSight(px, s.world.groundHeight(px, pz) + 1.7, pz, mx, g + 1.2, mz)) { at = { px, pz }; break; }
      }
      if (at) break;
    }
    if (!at) at = { px: mx - uz * (seg.w * 0.5 + 2), pz: mz + ux * (seg.w * 0.5 + 2) };
    s.teleport(at.px, at.pz);
    window.road = { mx, mz, ux, uz, yaw: Math.atan2(-ux, -uz), len: seg.len };
    window.keepClear = (keep) => { for (const o of [...s.vehicles.active]) if (!keep.includes(o)) s.vehicles.remove(o); };
    return { len: Math.round(seg.len), w: seg.w };
  });
  // One put on the road, t metres along it from the middle (back is negative).
  const place = (type, t, against = false) => page.evaluate(({ type, t, against }) => {
    const s = window.spreefall;
    const r = window.road;
    const v = s.spawnTraffic(type, { x: r.mx + r.ux * t, z: r.mz + r.uz * t, yaw: r.yaw + (against ? Math.PI : 0) });
    window.lastCar = v;
    return !!v;
  }, { type, t, against });
  const aimAt = (h = 1.2) => page.evaluate(async (h) => {
    const s = window.spreefall;
    const v = window.lastCar;
    const dx = v.x - s.player.x, dz = v.z - s.player.z, dy = v.y + h - (s.player.y + 1.7);
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const t = s.hackTarget;
    return { on: !!t && t.ref === v, kind: t && t.kind, card: document.getElementById('hcname').textContent,
      job: document.getElementById('hcjob').textContent, acts: document.getElementById('hcacts').textContent,
      dist: Math.round(Math.hypot(dx, dz)) };
  }, h);

  const road = await byRoad();
  check('there is a long straight street by the square to watch the traffic on', !!road, JSON.stringify(road));

  // A car that drives: on along the street, on the carriageway.
  await place('car', -25);
  const follows = await page.evaluate(() => {
    const s = window.spreefall;
    const v = window.lastCar;
    const x0 = v.x, z0 = v.z;
    for (let i = 0; i < 60 * 4; i++) { s.fixedForTest(1 / 60); window.keepClear([v]); }
    let onRoad = false;
    for (const r of s.world.manifest.roadLines) {
      const p = r.pts;
      for (let k = 2; k < p.length && !onRoad; k += 2) {
        const ax = p[k - 2], az = p[k - 1], bx = p[k], bz = p[k + 1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((v.x - ax) * dx + (v.z - az) * dz) / l2));
        if (Math.hypot(ax + dx * t - v.x, az + dz * t - v.z) < r.w * 0.5 + 1.5) onRoad = true;
      }
    }
    return { went: Math.round(Math.hypot(v.x - x0, v.z - z0)), onRoad, speed: +v.speed.toFixed(1), crashed: !!v.traffic.crashed };
  });
  check('a car drives on along the street, on the carriageway',
    follows.went > 25 && follows.onRoad && !follows.crashed, JSON.stringify(follows));

  // Somebody in its lane: it stops for them.
  await byRoad();
  await place('car', -30);
  const waits = await page.evaluate(() => {
    const s = window.spreefall;
    const v = window.lastCar;
    v.speed = 10;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const c = s.soldiers.spawnCivilianNear(v.x, v.z, 2, 6);
    c.x = v.x + fx * 18; c.z = v.z + fz * 18; c.targetX = c.x; c.targetZ = c.z; c.phoneLeft = 30;
    for (let i = 0; i < 60 * 3; i++) {
      s.fixedForTest(1 / 60);
      window.keepClear([v]);
      c.x = v.x + fx * 0 + (c.x - v.x); // he stays where he was put
    }
    return { speed: +v.speed.toFixed(2), gap: +Math.hypot(c.x - v.x, c.z - v.z).toFixed(1), hurt: c.health < c.maxHealth };
  });
  check('and stops for somebody standing in its lane', waits.speed < 0.5 && !waits.hurt && waits.gap > 2, JSON.stringify(waits));

  // --- the hacks on them -----------------------------------------------------------
  await byRoad();
  await page.evaluate(() => { window.spreefall.phone.battery = 100; });
  await place('car', -12);
  await page.evaluate(() => { window.lastCar.traffic.stalled = 60; });
  const carSeen = await aimAt(1.0);
  check('the phone gets into a car: its plate, who it is registered to, and Q and E',
    carSeen.on && carSeen.kind === 'car' && /B-[A-Z]{2} \d{4}/.test(carSeen.card) && /Registered to/.test(carSeen.job)
      && /Stall engine/.test(carSeen.acts) && /Ram/.test(carSeen.acts),
    JSON.stringify(carSeen));
  await page.screenshot({ path: path.join(SHOTS, 'backdoor-02-traffic.png') });
  const stall = await page.evaluate(() => {
    const s = window.spreefall;
    const v = window.lastCar;
    v.traffic.stalled = 0;
    v.speed = 11;
    const ok = s.hackKey(0);
    for (let i = 0; i < 60 * 2.5; i++) { s.fixedForTest(1 / 60); window.keepClear([v]); }
    return { ok, speed: +v.speed.toFixed(2), stalled: +v.traffic.stalled.toFixed(1) };
  });
  check('Q stalls it: it stops dead in the road', stall.ok && stall.speed < 0.5 && stall.stalled > 0, JSON.stringify(stall));

  await byRoad();
  await place('car', 20, true);
  await page.evaluate(() => { window.victim = window.lastCar; window.victim.traffic.stalled = 60; });
  await place('car', -8);
  await page.evaluate(() => { window.lastCar.traffic.stalled = 60; window.spreefall.phone.battery = 100; });
  const rammer = await aimAt(1.0);
  const ram = await page.evaluate(() => {
    const s = window.spreefall;
    const a = window.lastCar, b = window.victim;
    const crashes = s.crashes;
    a.traffic.stalled = 0;
    const ok = s.hackKey(1);
    for (let i = 0; i < 60 * 4; i++) { s.fixedForTest(1 / 60); window.keepClear([a, b]); }
    return { ok, crashes: s.crashes - crashes, aHurt: a.health < a.maxHealth, bHurt: b.health < b.maxHealth,
      stopped: !!a.traffic.crashed };
  });
  check('E takes its throttle and sends it into whatever is ahead: a crash, both hurt',
    rammer.on && ram.ok && ram.crashes >= 1 && ram.aHurt && ram.bHurt && ram.stopped, JSON.stringify({ rammer, ram }));

  await byRoad();
  await place('bus', -16);
  await page.evaluate(() => { window.lastCar.traffic.stalled = 60; window.spreefall.phone.battery = 100; });
  const busSeen = await aimAt(2.4);
  const doors = await page.evaluate(() => {
    const s = window.spreefall;
    const v = window.lastCar;
    const people = s.soldiers.active.filter((c) => c.civilian).length;
    const ok = s.hackKey(1);
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    return { ok, out: s.soldiers.active.filter((c) => c.civilian).length - people, speed: +v.speed.toFixed(2),
      again: s.hackKey(1) };
  });
  check('a bus: E opens its doors and its passengers get off, once',
    busSeen.on && /BVG/.test(busSeen.card) && doors.ok && doors.out >= 2 && doors.speed < 1 && !doors.again,
    JSON.stringify({ busSeen, doors }));

  const jacked = await page.evaluate(() => {
    const s = window.spreefall;
    s.vehicles.reset(); s.soldiers.reset();
    const r = window.road;
    const v = s.spawnTraffic('car', { x: r.mx, z: r.mz, yaw: r.yaw });
    v.speed = 0;
    s.teleport(v.x + 2.5, v.z + 2.5);
    const people = s.soldiers.active.length;
    s.toggleVehicle();
    const out = { inIt: s.state.inVehicle === v, traffic: v.traffic, driver: s.soldiers.active.length - people };
    s.toggleVehicle();
    return out;
  });
  check('F at a car in the traffic throws the driver out and it is yours',
    jacked.inIt && jacked.traffic === null && jacked.driver === 1, JSON.stringify(jacked));

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
