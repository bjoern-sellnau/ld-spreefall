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
    // Crime is started by hand further down; none of its own meanwhile.
    s.crimes.next = 1e9;
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

  // --- crime ------------------------------------------------------------------------
  // One started by hand, with the two in it put where the check can watch
  // them, and nothing else started while it runs.
  const crime = (kind, oAt, vAt) => page.evaluate(({ kind, oAt, vAt }) => {
    const s = window.spreefall;
    s.vehicles.reset(); s.soldiers.reset();
    s.teleport(81, 0);
    s.crimes.next = 1e9;
    s.crimes.live = null;
    const live = s.crimeBegin(kind);
    if (!live) return null;
    const put = (sd, [dx, dz]) => {
      sd.x = s.player.x + dx; sd.z = s.player.z + dz;
      sd.y = s.world.groundHeight(sd.x, sd.z);
      sd.targetX = sd.x; sd.targetZ = sd.z;
    };
    put(live.o, oAt); put(live.v, vAt);
    window.live = live;
    return { toast: (document.getElementById('toast') || {}).textContent || '', rep: s.crimes.rep, money: s.phone.money };
  }, { kind, oAt, vAt });
  const steps = (n, also = '') => page.evaluate(({ n }) => {
    const s = window.spreefall;
    for (let i = 0; i < n; i++) {
      s.fixedForTest(1 / 60);
      for (const o of [...s.vehicles.active]) s.vehicles.remove(o);
      for (const c of [...s.soldiers.active]) if (c.civilian && c !== window.live.o && c !== window.live.v) s.soldiers._retire(c);
    }
    const l = window.live;
    return { phase: l.c.phase, over: l.c.over, oUp: l.o.alive && l.o.health > 0 && l.o.state !== 5,
      vHealth: Math.round(l.v.health), apart: +Math.hypot(l.o.x - l.v.x, l.o.z - l.v.z).toFixed(1),
      oFar: Math.round(Math.hypot(l.o.x - s.player.x, l.o.z - s.player.z)), live: !!s.crimes.live };
  }, { n });

  const theft = await crime('theft', [-10, 2], [-18, -3]);
  check('a crime starts near you and the phone says so: what, how far, which way',
    theft && /CRIME DETECTED: bag theft, \d+ m [NESW]+/.test(theft.toast), theft && theft.toast);
  const snatched = await steps(60 * 7);
  check('the thief walks up, takes the bag and runs', snatched.phase === 'flee' && snatched.apart > 5 && !snatched.over,
    JSON.stringify(snatched));
  const offenderCard = await page.evaluate(async () => {
    const s = window.spreefall;
    const o = window.live.o;
    // Held where he is while the phone is pointed at him: at a frame or two
    // a second, a man running is out of the crosshair before it is drawn.
    const X = o.x, Z = o.z;
    window.pinO = setInterval(() => { o.x = X; o.z = Z; }, 0);
    const dx = o.x - s.player.x, dz = o.z - s.player.z;
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, -2);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    return { on: !!s.hackTarget && s.hackTarget.ref === o, rec: document.getElementById('hcrec').textContent,
      mark: !document.getElementById('crimemark').classList.contains('hidden'),
      line: document.getElementById('phcrime').textContent };
  });
  await page.screenshot({ path: path.join(SHOTS, 'backdoor-03-crime.png') });
  check('pointed at him the phone calls him the offender, a red mark over him and the crime on the phone',
    offenderCard.on && /OFFENDER: bag theft/.test(offenderCard.rec) && offenderCard.mark && /thief running/.test(offenderCard.line),
    JSON.stringify(offenderCard));
  const caught = await page.evaluate(async () => {
    const s = window.spreefall;
    s.phone.battery = 100;
    const rang = s.hackKey(0) && s.hackTarget && s.hackTarget.ref === window.live.o;
    clearInterval(window.pinO);
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    const o = window.live.o;
    const x0 = o.x;
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    const stood = Math.abs(o.x - x0) < 0.05;
    // Up behind him, and F.
    const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw);
    s.teleport(o.x - fx * 1.6, o.z - fz * 1.6);
    s.look(Math.atan2(-fx, -fz) * 180 / Math.PI, -10);
    s.camera.update(16 / 9);
    const rep = s.crimes.rep, money = s.phone.money;
    const took = s.takedown();
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    return { rang, stood, took, over: window.live.c.over, rep: s.crimes.rep - rep, paid: s.phone.money - money,
      stopped: s.crimes.stopped, toast: (document.getElementById('toast') || {}).textContent || '' };
  });
  check('Q stops him where he is, and F takes him down: crime stopped, paid and your name better for it',
    caught.rang && caught.stood && caught.took && caught.over === 'subdued' && caught.rep > 0 && caught.paid > 0
      && /CRIME STOPPED/.test(caught.toast), JSON.stringify(caught));

  await crime('brawl', [-9, 1], [-13, 1]);
  const fight = await steps(60 * 5);
  check('a fight: they square up and the one who started it lays into the other',
    fight.phase === 'fight' && fight.vHealth < 100 && !fight.over, JSON.stringify(fight));
  const broken = await page.evaluate(async () => {
    const s = window.spreefall;
    const o = window.live.o;
    const dx = o.x - s.player.x, dz = o.z - s.player.z;
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, -2);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    s.phone.battery = 100;
    const rep = s.crimes.rep;
    const rang = s.hackKey(0);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    return { rang, over: window.live.c.over, rep: s.crimes.rep - rep, oUp: o.alive && o.health > 0 };
  });
  check('and his phone ringing breaks it up, nobody hurt any further',
    broken.rang && broken.over === 'brokenUp' && broken.rep > 0 && broken.oUp, JSON.stringify(broken));

  await crime('theft', [-6, 1], [-8, 1]);
  const got = await page.evaluate(() => {
    const s = window.spreefall;
    const rep = s.crimes.rep, failed = s.crimes.failed;
    // You stand still and watch him go.
    for (let i = 0; i < 60 * 45 && !window.live.c.over; i++) {
      s.fixedForTest(1 / 60);
      for (const o of [...s.vehicles.active]) s.vehicles.remove(o);
    }
    return { over: window.live.c.over, rep: s.crimes.rep - rep, failed: s.crimes.failed - failed,
      far: Math.round(Math.hypot(window.live.o.x - s.player.x, window.live.o.z - s.player.z)) };
  });
  check('a thief nobody stops gets away, and that costs your good name',
    got.over === 'escaped' && got.rep < 0 && got.failed === 1, JSON.stringify(got));

  const innocent = await page.evaluate(async () => {
    const s = window.spreefall;
    s.soldiers.reset(); s.vehicles.reset();
    s.crimes.live = null;
    const c = s.soldiers.spawnCivilianNear(s.player.x, s.player.z, 4, 8);
    const fx = -Math.sin(s.camera.yaw), fz = -Math.cos(s.camera.yaw);
    c.x = s.player.x + fx * 6; c.z = s.player.z + fz * 6; c.y = s.world.groundHeight(c.x, c.z);
    c.targetX = c.x; c.targetZ = c.z; c.phoneLeft = 30;
    const rep = s.crimes.rep;
    s.weapon.select('m16');
    for (let k = 0; k < 12 && c.health > 0; k++) {
      const ex = s.player.x, ey = s.player.y + 1.7, ez = s.player.z;
      const dx = c.x - ex, dy = c.y + 1.2 - ey, dz = c.z - ez;
      const l = Math.hypot(dx, dy, dz);
      s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.asin(dy / l) * 180 / Math.PI);
      s.camera.update(16 / 9);
      s.weapon.cooldown = 0; s.weapon.spread = 0; s.weapon.ammo = 30;
      s.shoot();
    }
    return { dead: c.health <= 0, rep: s.crimes.rep - rep };
  });
  check('and somebody who was only walking down the street costs it too, shot',
    innocent.dead && innocent.rep < 0, JSON.stringify(innocent));

  // --- the lights --------------------------------------------------------------
  // The nearest junction with lights to the square, with the street to
  // itself, and you on the pavement a few metres off one of its masts.
  const junction = await page.evaluate(async () => {
    const s = window.spreefall;
    s.vehicles.reset(); s.soldiers.reset();
    s.crimes.live = null; s.crimes.next = 1e9;
    s.teleport(81, 0);
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    const js = s.junctions().filter((j) => j.legs.length >= 4)
      .sort((a, b) => Math.hypot(a.x - 81, a.z) - Math.hypot(b.x - 81, b.z));
    const j = js[0];
    if (!j) return null;
    window.junction = j;
    // Stand back from the mast on the widest road's leg, on its own side.
    const m = j.masts.find((k) => k.phase === 0) || j.masts[0];
    const l = j.legs[j.masts.indexOf(m)];
    const px = m.x + l.dx * 9 + l.dz * 1.2, pz = m.z + l.dz * 9 - l.dx * 1.2;
    s.teleport(px, pz);
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    window.mast = m;
    // Its order over a cycle and a bit, both ways, off the clock the traffic runs.
    const seq = [], both = [];
    for (let i = 0; i < 60 * 34; i++) {
      s.fixedForTest(1 / 60);
      const a = s.lightAt(j, 0), b = s.lightAt(j, 1);
      if (seq[seq.length - 1] !== a) seq.push(a);
      if (a === 'green' && b === 'green') both.push(i);
    }
    window.keepClear([]);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const masts = s.signalMasts(80).filter((k) => k.j === j);
    return { names: j.names, legs: j.legs.length, r: +j.r.toFixed(1), masts: masts.length,
      drawn: s.renderer.actors.signal.instanceCount, seq: seq.join('>'), both: both.length,
      lit: masts.map((k) => k.light) };
  });
  check('junctions where a bigger road meets another have lights, a mast for every way in, drawn',
    !!junction && junction.legs >= 4 && junction.masts === junction.legs && junction.drawn >= junction.masts,
    JSON.stringify(junction && { names: junction.names, legs: junction.legs, masts: junction.masts, drawn: junction.drawn }));
  check('and they change the German way: green, amber, red, red and amber, never green both ways',
    !!junction && /green>amber>red>redAmber>green/.test(junction.seq) && junction.both === 0,
    junction && junction.seq);

  const aimMast = () => page.evaluate(async () => {
    const s = window.spreefall;
    const m = window.mast;
    const y = s.world.groundHeight(m.x, m.z) + 2.9;
    const dx = m.x - s.player.x, dz = m.z - s.player.z, dy = y - (s.player.y + 1.7);
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const t = s.hackTarget;
    return { on: !!t && t.kind === 'signal' && t.ref === window.junction, card: document.getElementById('hcname').textContent,
      job: document.getElementById('hcjob').textContent, fact: document.getElementById('hcfact').textContent,
      acts: document.getElementById('hcacts').textContent };
  });
  const lights = await aimMast();
  await page.screenshot({ path: path.join(SHOTS, 'backdoor-04-lights.png') });
  check('pointed at a mast, the phone shows the junction, what each way shows, and Q and E',
    lights.on && lights.card === 'Traffic lights' && junction.names.every((n) => lights.job.includes(n))
      && /(green|amber|red)/.test(lights.fact) && /Q\s*All red/.test(lights.acts) && /E\s*All green/.test(lights.acts),
    `${lights.job}; ${lights.fact}; ${lights.acts}`);

  // Q: red both ways, and a car coming up to it waits short of it.
  const red = await page.evaluate(async () => {
    const s = window.spreefall;
    const j = window.junction;
    s.phone.battery = s.backdoorSpec.battery.most;
    const ok = s.hackKey(0);
    const both = [s.lightAt(j, 0), s.lightAt(j, 1)];
    // A car on the widest road, 60 m out, driving in.
    const l = j.legs.find((k) => k.phase === 0);
    const v = s.spawnTraffic('car', { x: j.x + l.dx * 60, z: j.z + l.dz * 60, yaw: Math.atan2(l.dx, l.dz) });
    v.speed = 10;
    for (let i = 0; i < 60 * 7; i++) { s.fixedForTest(1 / 60); window.keepClear([v]); }
    const short = Math.hypot(v.x - j.x, v.z - j.z);
    const held = { speed: +v.speed.toFixed(2), short: +short.toFixed(1) };
    // E: green both ways, and it goes.
    s.phone.battery = s.backdoorSpec.battery.most;
    const ok2 = s.hackKey(1);
    const green = [s.lightAt(j, 0), s.lightAt(j, 1)];
    for (let i = 0; i < 60 * 5; i++) { s.fixedForTest(1 / 60); window.keepClear([v]); }
    const past = (v.x - j.x) * l.dx + (v.z - j.z) * l.dz;
    j.hack = null;
    return { ok, both, held, r: j.r, ok2, green, past: +past.toFixed(1) };
  });
  check('Q turns it red both ways, and a car coming up to it waits short of it',
    red.ok && red.both.every((b) => b === 'red') && red.held.speed < 0.5 && red.held.short > red.r && red.held.short < red.r + 12,
    JSON.stringify(red));
  check('E turns it green both ways, and the car goes on through', red.ok2 && red.green.every((b) => b === 'green') && red.past < -red.r,
    JSON.stringify({ green: red.green, past: red.past }));

  // Green both ways with somebody coming each way: nobody gives way.
  const pile = await page.evaluate(async () => {
    const s = window.spreefall;
    const j = window.junction;
    s.vehicles.reset();
    const a = j.legs.find((k) => k.phase === 0), b = j.legs.find((k) => k.phase === 1);
    const A = s.spawnTraffic('car', { x: j.x + a.dx * 30, z: j.z + a.dz * 30, yaw: Math.atan2(a.dx, a.dz) });
    const B = s.spawnTraffic('car', { x: j.x + b.dx * 30, z: j.z + b.dz * 30, yaw: Math.atan2(b.dx, b.dz) });
    // Each the same way short of where their lanes cross, so they get there together.
    const fa = [-Math.sin(A.yaw), -Math.cos(A.yaw)], fb = [-Math.sin(B.yaw), -Math.cos(B.yaw)];
    const den = fa[0] * fb[1] - fa[1] * fb[0];
    const t = ((B.x - A.x) * fb[1] - (B.z - A.z) * fb[0]) / den;
    const P = { x: A.x + fa[0] * t, z: A.z + fa[1] * t };
    A.x = P.x - fa[0] * 32; A.z = P.z - fa[1] * 32;
    B.x = P.x - fb[0] * 32; B.z = P.z - fb[1] * 32;
    A.speed = B.speed = 9;
    j.hack = { kind: 'green', left: 8 };
    const crashes = s.crashes;
    let closest = Infinity;
    for (let i = 0; i < 60 * 6 && s.crashes === crashes; i++) {
      s.fixedForTest(1 / 60);
      window.keepClear([A, B]);
      closest = Math.min(closest, Math.hypot(A.x - B.x, A.z - B.z));
    }
    j.hack = null;
    return { crashed: s.crashes - crashes, a: !!A.traffic.crashed, b: !!B.traffic.crashed,
      hurt: A.health < A.spec.health && B.health < B.spec.health, closest: +closest.toFixed(1) };
  });
  check('green both ways with a car coming each way: nobody gives way, and they crash',
    pile.crashed > 0 && pile.a && pile.b && pile.hurt, JSON.stringify(pile));

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
