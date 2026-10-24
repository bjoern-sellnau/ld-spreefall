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
    const aim = async () => {
      const dx = v.x - s.player.x, dz = v.z - s.player.z, dy = v.y + h - (s.player.y + 1.7);
      s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI);
      for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    };
    await aim();
    // Something on the pavement in the way (a parked car, a lamp, a tree in
    // the live city): step up to the kerb beside it, as anybody would.
    if (!(s.hackTarget && s.hackTarget.ref === v) && window.road) {
      const r = window.road;
      for (const side of [1, -1]) {
        s.teleport(v.x - r.uz * side * 6, v.z + r.ux * side * 6);
        await aim();
        if (s.hackTarget && s.hackTarget.ref === v) break;
      }
    }
    const dx = v.x - s.player.x, dz = v.z - s.player.z;
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

  // The baton on the one who started a fight: the takedown by hand, from a swing.
  await crime('brawl', [-9, 1], [-13, 1]);
  await steps(60 * 5);
  const batoned = await page.evaluate(() => {
    const s = window.spreefall;
    const o = window.live.o;
    s.teleport(o.x + 1.4, o.z);
    const dx = o.x - s.player.x, dz = o.z - s.player.z;
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, -10);
    s.camera.update(16 / 9);
    s.weapon.giveAll(); s.weapon.select('baton'); s.weapon.cooldown = 0;
    const rep = s.crimes.rep;
    s.shoot();
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    return { phase: window.live.c.phase, over: window.live.c.over, rep: s.crimes.rep - rep };
  });
  check('the baton on the one who started it is the takedown by hand: subdued, and your name better for it',
    batoned.over === 'subdued' && batoned.rep > 0, JSON.stringify(batoned));

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
    // Its order over a cycle and a bit, both ways, off the clock the traffic
    // runs: wherever in the cycle it starts, every change is the next one in
    // the German order, and it goes all the way round.
    const seq = [], both = [];
    const next = { green: 'amber', amber: 'red', red: 'redAmber', redAmber: 'green' };
    let wrong = 0;
    for (let i = 0; i < 60 * 34; i++) {
      s.fixedForTest(1 / 60);
      const a = s.lightAt(j, 0), b = s.lightAt(j, 1);
      if (seq.length && seq[seq.length - 1] !== a && next[seq[seq.length - 1]] !== a) wrong++;
      if (seq[seq.length - 1] !== a) seq.push(a);
      if (a === 'green' && b === 'green') both.push(i);
    }
    window.keepClear([]);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const masts = s.signalMasts(80).filter((k) => k.j === j);
    return { names: j.names, legs: j.legs.length, r: +j.r.toFixed(1), masts: masts.length,
      drawn: s.renderer.actors.signal.instanceCount, seq: seq.join('>'), both: both.length, wrong,
      round: ['green', 'amber', 'red', 'redAmber'].every((l) => seq.includes(l)),
      lit: masts.map((k) => k.light) };
  });
  check('junctions where a bigger road meets another have lights, a mast for every way in, drawn',
    !!junction && junction.legs >= 4 && junction.masts === junction.legs && junction.drawn >= junction.masts,
    JSON.stringify(junction && { names: junction.names, legs: junction.legs, masts: junction.masts, drawn: junction.drawn }));
  check('and they change the German way: green, amber, red, red and amber, never green both ways',
    !!junction && junction.round && junction.wrong === 0 && junction.seq.split('>').length >= 5 && junction.both === 0,
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
    // Straight on where its stretch of road ends, not a turning at random.
    v.traffic.through = true;
    for (let i = 0; i < 60 * 7; i++) { s.fixedForTest(1 / 60); window.keepClear([v]); }
    const short = Math.hypot(v.x - j.x, v.z - j.z);
    const held = { speed: +v.speed.toFixed(2), short: +short.toFixed(1) };
    // E: green both ways, and it goes.
    s.phone.battery = s.backdoorSpec.battery.most;
    const ok2 = s.hackKey(1);
    const green = [s.lightAt(j, 0), s.lightAt(j, 1)];
    // Through, whichever way out it takes: at the end of a stretch of road
    // a driver picks one of the ways on at random, and in the live city the
    // map's ways end at most junctions, so straight on is one choice of
    // several. Into the junction and the length of its approach and more.
    let moved = 0, closest = Infinity;
    for (let i = 0; i < 60 * 5; i++) {
      const x0 = v.x, z0 = v.z;
      s.fixedForTest(1 / 60); window.keepClear([v]);
      moved += Math.hypot(v.x - x0, v.z - z0);
      closest = Math.min(closest, Math.hypot(v.x - j.x, v.z - j.z));
    }
    const past = (v.x - j.x) * l.dx + (v.z - j.z) * l.dz;
    for (const k of j.group || [j]) k.hack = null;
    return { ok, both, held, r: j.r, ok2, green, past: +past.toFixed(1), moved: +moved.toFixed(1),
      closest: +closest.toFixed(1) };
  });
  check('Q turns it red both ways, and a car coming up to it waits short of it',
    red.ok && red.both.every((b) => b === 'red') && red.held.speed < 0.5 && red.held.short > red.r && red.held.short < red.r + 12,
    JSON.stringify(red));
  check('E turns it green both ways, and the car goes on through',
    red.ok2 && red.green.every((b) => b === 'green') && red.closest < red.r && red.moved > red.held.short + red.r,
    JSON.stringify({ green: red.green, closest: red.closest, moved: red.moved, past: red.past }));

  // Green both ways with somebody coming each way: nobody gives way.
  const pile = await page.evaluate(async () => {
    const s = window.spreefall;
    const j = window.junction;
    s.vehicles.reset();
    const a = j.legs.find((k) => k.phase === 0), b = j.legs.find((k) => k.phase === 1);
    for (const k of j.group || [j]) k.hack = { kind: 'green', left: 60 };
    // Each driven through on its own first, from 30 m out, straight on, and
    // where it was at every step: the line it really takes and when. Set
    // off together along straight lines from where they started, they once
    // went through 4.9 m apart, the live city's lanes not being straight
    // lines, and half a second either way is a miss.
    const alone = (l) => {
      const V = s.spawnTraffic('car', { x: j.x + l.dx * 30, z: j.z + l.dz * 30, yaw: Math.atan2(l.dx, l.dz) });
      V.speed = 9;
      V.traffic.through = true;
      const path = [];
      for (let i = 0; i < 60 * 6; i++) {
        path.push({ x: V.x, z: V.z, yaw: V.yaw, speed: V.speed });
        s.fixedForTest(1 / 60);
        window.keepClear([V]);
      }
      s.vehicles.remove(V);
      return path;
    };
    const pa = alone(a), pb = alone(b);
    // Where the two lines cross, and each put back on its own line the same
    // time short of it, going as it was going there.
    let meet = { d: Infinity, ia: 0, ib: 0 };
    for (let ia = 0; ia < pa.length; ia += 2) {
      for (let ib = 0; ib < pb.length; ib += 2) {
        const d = Math.hypot(pa[ia].x - pb[ib].x, pa[ia].z - pb[ib].z);
        if (d < meet.d) meet = { d, ia, ib };
      }
    }
    const lead = Math.min(120, meet.ia, meet.ib);
    const sa = pa[meet.ia - lead], sb = pb[meet.ib - lead];
    const A = s.spawnTraffic('car', { x: sa.x, z: sa.z, yaw: sa.yaw });
    const B = s.spawnTraffic('car', { x: sb.x, z: sb.z, yaw: sb.yaw });
    A.x = sa.x; A.z = sa.z; A.yaw = sa.yaw; A.speed = sa.speed;
    B.x = sb.x; B.z = sb.z; B.yaw = sb.yaw; B.speed = sb.speed;
    A.traffic.through = B.traffic.through = true;
    const crashes = s.crashes;
    let closest = Infinity;
    for (let i = 0; i < 60 * 6 && s.crashes === crashes; i++) {
      s.fixedForTest(1 / 60);
      window.keepClear([A, B]);
      closest = Math.min(closest, Math.hypot(A.x - B.x, A.z - B.z));
    }
    for (const k of j.group || [j]) k.hack = null;
    return { crashed: s.crashes - crashes, a: !!A.traffic.crashed, b: !!B.traffic.crashed,
      hurt: A.health < A.spec.health && B.health < B.spec.health, closest: +closest.toFixed(1),
      lines: +meet.d.toFixed(1), lead: +(lead / 60).toFixed(1) };
  });
  check('green both ways with a car coming each way: nobody gives way, and they crash',
    pile.crashed > 0 && pile.a && pile.b && pile.hurt, JSON.stringify(pile));

  // --- the steam pipes -------------------------------------------------------------
  // A cover with straight road behind it, and you on the pavement off to its
  // side, looking at it.
  const pipe = await page.evaluate(async () => {
    const s = window.spreefall;
    s.vehicles.reset(); s.soldiers.reset();
    s.crimes.live = null; s.crimes.next = 1e9;
    s.teleport(81, 0);
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    const list = s.coversNear(200);
    for (const c of list) {
      const p = c.p;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      // Straight road 45 m behind it: a car put there faces it.
      const v = s.spawnTraffic('car', { x: p.x - fx * 45, z: p.z - fz * 45, yaw: p.yaw });
      if (!v) continue;
      const ok = Math.cos(v.yaw - p.yaw) > 0.97 && Math.abs(Math.hypot(v.x - p.x, v.z - p.z) - 45) < 3;
      s.vehicles.remove(v);
      if (!ok) continue;
      // Somewhere off to the side that can see it.
      for (const side of [1, -1]) {
        for (const off of [9, 7, 12]) {
          const px = p.x + fz * off * side - fx * 8, pz = p.z - fx * off * side - fz * 8;
          const g = s.world.groundHeight(px, pz);
          if (!s.world.lineOfSight(px, g + 1.7, pz, p.x, s.world.groundHeight(p.x, p.z) + 0.1, p.z)) continue;
          window.pipe = p;
          s.teleport(px, pz);
          for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
          const dx = p.x - s.player.x, dz = p.z - s.player.z, dy = s.world.groundHeight(p.x, p.z) + 0.1 - (s.player.y + 1.7);
          s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI);
          for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
          const t = s.hackTarget;
          return { count: list.length, drawn: s.renderer.actors.cover.instanceCount,
            on: !!t && t.kind === 'pipe' && t.ref === p, card: document.getElementById('hcname').textContent,
            job: document.getElementById('hcjob').textContent, acts: document.getElementById('hcacts').textContent };
        }
      }
    }
    return { count: list.length, drawn: s.renderer.actors.cover.instanceCount, on: false };
  });
  check('there are covers over the steam pipe in the road, drawn, and the phone gets into one',
    pipe.count > 3 && pipe.drawn > 3 && pipe.on && pipe.card === 'Steam pipe'
      && /Q\s*Vent steam/.test(pipe.acts) && /E\s*Blow the pipe/.test(pipe.acts),
    JSON.stringify(pipe));

  const vent = await page.evaluate(async () => {
    const s = window.spreefall;
    const p = window.pipe;
    // What this is about is the steam: any lights on the way are held green
    // for it, or a car waiting at a red one would pass for one waiting for
    // the steam.
    const held = s.junctions().filter((j) => Math.hypot(j.x - p.x, j.z - p.z) < 120);
    for (const j of held) j.hack = { kind: 'green', left: 1e9 };
    s.phone.battery = s.backdoorSpec.battery.most;
    const ok = s.hackKey(0);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    // Off the road once it is going: you stood eight metres short of the
    // pipe to get into it, and where the lane runs near the kerb a car
    // stopped for you there, 13 m short, and stayed stopped after.
    const stood = { x: s.player.x, z: s.player.z };
    s.teleport(p.x + fz * 40, p.z - fx * 40);
    const v = s.spawnTraffic('car', { x: p.x - fx * 45, z: p.z - fz * 45, yaw: p.yaw });
    v.speed = 10;
    v.traffic.through = true;
    let steam = 0;
    for (let i = 0; i < 60 * 5; i++) {
      s.fixedForTest(1 / 60);
      window.keepClear([v]);
      if (i === 60) steam = s.effects.list.filter((e) => e.alive && Math.hypot(e.ax - p.x, e.az - p.z) < 6 && e.r > 0.8).length;
    }
    const gap = Math.hypot(v.x - p.x, v.z - p.z);
    const out = { ok, venting: p.vent > 0, steam, speed: +v.speed.toFixed(2), gap: +gap.toFixed(1) };
    // And once it stops, on it goes: on down the road, whichever way the
    // road takes it, since at the end of a stretch the driver picks the way
    // on at random, and in the live city that is sometimes back round.
    p.vent = 0;
    let moved = 0;
    for (let i = 0; i < 60 * 5; i++) {
      const x0 = v.x, z0 = v.z;
      s.fixedForTest(1 / 60); window.keepClear([v]);
      moved += Math.hypot(v.x - x0, v.z - z0);
    }
    out.moved = +moved.toFixed(1);
    out.past = +(((v.x - p.x) * fx + (v.z - p.z) * fz)).toFixed(1);
    s.vehicles.remove(v);
    for (const j of held) j.hack = null;
    // And back where you stood, looking at the cover, for blowing it.
    s.teleport(stood.x, stood.z);
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    const dx = p.x - s.player.x, dz = p.z - s.player.z, dy = s.world.groundHeight(p.x, p.z) + 0.1 - (s.player.y + 1.7);
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    return out;
  });
  check('Q vents steam across the road, and a car stops short of it until it stops',
    vent.ok && vent.venting && vent.steam > 5 && vent.speed < 0.5 && vent.gap > 2.5 && vent.moved > vent.gap + 3, JSON.stringify(vent));

  const blow = await page.evaluate(async () => {
    const s = window.spreefall;
    const p = window.pipe;
    s.phone.battery = s.backdoorSpec.battery.most;
    while (p.spent > 0 || p.fuse > 0) { p.spent = 0; p.fuse = 0; }
    const ok = s.hackKey(1);
    // A car that has stopped right on it, and somebody on the kerb beside it.
    const v = s.spawnTraffic('car', { x: p.x, z: p.z, yaw: p.yaw });
    v.x = p.x; v.z = p.z; v.speed = 0; v.traffic.stalled = 99;
    const c = s.soldiers.spawnCivilianNear(p.x, p.z, 2, 8);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    c.x = p.x + fz * 3.5; c.z = p.z - fx * 3.5; c.y = s.world.groundHeight(c.x, c.z);
    c.targetX = c.x; c.targetZ = c.z;
    const hull = v.health;
    let high = 0, floored = false, glow = false;
    for (let i = 0; i < 60 * 3.2; i++) {
      s.fixedForTest(1 / 60);
      for (const o of [...s.vehicles.active]) if (o !== v) s.vehicles.remove(o);
      if (s.coversNear(200).some((k) => k.p === p && k.light === 2)) glow = true;
      high = Math.max(high, v.y - s.world.groundHeight(v.x, v.z));
      if (c.state === 4) floored = true;
      if (i === Math.round(60 * 1.45)) {
        for (let k = 0; k < 2; k++) await new Promise((r) => requestAnimationFrame(r));
        window.shotNow = true;
      }
    }
    return { ok, glow, high: +high.toFixed(2), hull: Math.round(hull), left: Math.round(v.health), down: v.airborne === false,
      floored, civilianUp: c.health > 0, spent: p.spent > 0, blown: s.state.pipesBlown };
  });
  check('E blows it: a car on it goes up in the air and comes down hurt, and somebody beside it is knocked flat',
    blow.ok && blow.glow && blow.high > 1 && blow.left < blow.hull && blow.down && blow.floored && blow.civilianUp && blow.spent,
    JSON.stringify(blow));

  // The moment it goes, for the screenshot: again, with a fresh cover, from where you stand.
  await page.evaluate(async () => {
    const s = window.spreefall;
    const p = window.pipe;
    p.spent = 0; p.fuse = 0;
    s.vehicles.reset();
    const v = s.spawnTraffic('car', { x: p.x, z: p.z, yaw: p.yaw });
    v.x = p.x; v.z = p.z; v.speed = 0; v.traffic.stalled = 99;
    s.phone.battery = s.backdoorSpec.battery.most;
    s.hackKey(1);
    for (let i = 0; i < 60 * 1.35; i++) { s.fixedForTest(1 / 60); for (const o of [...s.vehicles.active]) if (o !== v) s.vehicles.remove(o); }
    for (let k = 0; k < 2; k++) await new Promise((r) => requestAnimationFrame(r));
  });
  await page.screenshot({ path: path.join(SHOTS, 'backdoor-05-steam.png') });

  // --- the blackout --------------------------------------------------------------
  // At night, looking down the street at the windows: B, and the light goes.
  const lum = () => page.evaluate(() => new Promise((res) => {
    const s = window.spreefall;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const gl = s.renderer.gl;
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let sum = 0, n = 0;
      // The upper two thirds, where the fronts are, not the HUD along the bottom.
      for (let y = Math.floor(h * 0.35); y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const o = (y * w + x) * 4;
          sum += 0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2]; n++;
        }
      }
      res(sum / n);
    }));
  }));
  await page.evaluate(async () => {
    const s = window.spreefall;
    s.vehicles.reset(); s.soldiers.reset();
    s.teleport(81, 0); s.setTime(1);
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
  });
  // At one in the morning what light there is comes out of the windows, so
  // the way to look is the brightest way round: the live city and the
  // offline one have their buildings in different places.
  let lit = -1, facing = 0;
  for (let yaw = 0; yaw < 360; yaw += 45) {
    await page.evaluate(async (yaw) => {
      window.spreefall.look(yaw, 6);
      for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    }, yaw);
    const l = await lum();
    if (l > lit) { lit = l; facing = yaw; }
  }
  const before = await page.evaluate(async (yaw) => {
    const s = window.spreefall;
    s.look(yaw, 6);
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    return { night: +s.renderer.night.toFixed(2), out: s.renderer.blackout, facing: yaw };
  }, facing);
  lit = await lum();
  const cut = await page.evaluate(async () => {
    const s = window.spreefall;
    for (let k = 0; k < 6; k++) s.soldiers.spawnCivilianNear(s.player.x, s.player.z, 10, 40);
    s.phone.battery = s.backdoorSpec.battery.most;
    const ok = s.blackoutKey();
    for (let i = 0; i < 20; i++) s.fixedForTest(1 / 60);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const j = s.junctions()[0];
    return { ok, out: +s.renderer.blackout.toFixed(2), light: j ? s.lightAt(j, 0) : null,
      masts: s.signalMasts(200).every((m) => m.light === 4),
      looking: s.soldiers.active.filter((c) => c.civilian && c.phoneLeft > 0).length,
      line: document.getElementById('phblack').textContent,
      again: s.blackoutKey(), battery: Math.round(s.phone.battery) };
  });
  const dark = await lum();
  check('B at night: the windows and the lamps go out, the street gets darker, the lights at the junctions go dark',
    before.night > 0.95 && cut.ok && cut.out > 0.95 && cut.light === 'off' && cut.masts && dark < lit * 0.8,
    JSON.stringify({ before, lit: +lit.toFixed(1), dark: +dark.toFixed(1), out: cut.out, light: cut.light }));
  check('and everybody stops to look at a phone with no signal; it takes the whole battery, once at a time',
    cut.looking >= 3 && /BLACKOUT/.test(cut.line) && cut.again === false && cut.battery < 5,
    JSON.stringify({ looking: cut.looking, line: cut.line, again: cut.again, battery: cut.battery }));
  const back = await page.evaluate(async () => {
    const s = window.spreefall;
    for (let i = 0; i < 60 * (s.citySpec.blackout.seconds + 3); i++) s.fixedForTest(1 / 60);
    const j = s.junctions()[0];
    return { on: s.blackout.on, out: s.renderer.blackout, light: j ? s.lightAt(j, 0) : null };
  });
  const relit = await lum();
  check('and after a quarter of a minute the power comes back',
    !back.on && back.out === 0 && back.light !== 'off' && relit > dark * 1.25, JSON.stringify({ ...back, relit: +relit.toFixed(1) }));

  // The pair for the record: down the street, at night, and then without the power.
  await page.evaluate(async () => {
    const s = window.spreefall;
    s.look(270, 6);
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  await page.screenshot({ path: path.join(SHOTS, 'backdoor-06-night.png') });
  await page.evaluate(async () => {
    const s = window.spreefall;
    s.phone.battery = s.backdoorSpec.battery.most;
    s.blackoutKey();
    for (let i = 0; i < 20; i++) s.fixedForTest(1 / 60);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  await page.screenshot({ path: path.join(SHOTS, 'backdoor-07-blackout.png') });

  // --- power boxes, ATMs and road blockers -----------------------------------
  // Daylight and the power back for these.
  await page.evaluate(() => {
    const s = window.spreefall;
    s.blackout.left = 0; s.blackout.dark = 0; s.setTime(14);
    s.vehicles.reset(); s.soldiers.reset();
    s.crimes.live = null; s.crimes.next = 1e9;
    s.teleport(81, 0);
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    // Stand somewhere that can see it, look at it, and see whether the phone
    // is on it.
    window.onTo = async (ref, x, y, z) => {
      for (const off of [6, 8, 5, 10]) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const px = x + Math.cos(a) * off, pz = z + Math.sin(a) * off;
          const g = s.world.groundHeight(px, pz);
          if (!s.world.lineOfSight(px, g + 1.7, pz, x, y, z)) continue;
          s.teleport(px, pz);
          for (let i = 0; i < 2; i++) s.fixedForTest(1 / 60);
          const dx = x - s.player.x, dz = z - s.player.z, dy = y - (s.player.y + 1.7);
          s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI);
          for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
          // The same one, or the one standing in its place if the street was
          // worked out again since.
          const t = s.hackTarget;
          if (t && (t.ref === ref || (Math.abs(t.ref.x - ref.x) < 0.3 && Math.abs(t.ref.z - ref.z) < 0.3))) return true;
        }
      }
      return false;
    };
  });
  const street = await page.evaluate(async () => {
    const s = window.spreefall;
    const boxes = s.boxesNear(250), atms = s.atmsNear(400), rows = s.bollardRows();
    // An ATM is in a wall: within half a metre of one, behind it.
    const inWall = atms.slice(0, 6).filter((a) => {
      const f = a.f, g = s.world.groundHeight(f.x, f.z);
      const h = s.world.raycast(f.x - Math.sin(f.yaw) * 0.3, g + 1.2, f.z - Math.cos(f.yaw) * 0.3, Math.sin(f.yaw), 0, Math.cos(f.yaw), 1.2);
      return h && h.kind === 'wall';
    }).length;
    // The nearest one the phone can be got onto: something else can stand
    // between you and the first.
    let on = false;
    for (const k of boxes.slice(0, 8)) {
      const b = k.f;
      if (await window.onTo(b, b.x, s.world.groundHeight(b.x, b.z) + 0.9, b.z)) { on = true; break; }
    }
    return { boxes: boxes.length, atms: atms.length, inWall, rows: rows.length, on,
      card: document.getElementById('hcname').textContent, acts: document.getElementById('hcacts').textContent,
      drawn: s.renderer.actors.powerBox.instanceCount };
  });
  check('power boxes stand along the pavements, ATMs are in the walls behind them, blockers wait at the junctions',
    street.boxes >= 5 && street.atms >= 1 && street.inWall >= 1 && street.rows >= 8 && street.drawn >= 3, JSON.stringify(street));
  check('and the phone gets into a power box: overload it, or set it as a trap',
    street.on && street.card === 'Power box' && /Q\s*Overload/.test(street.acts) && /E\s*Set a trap/.test(street.acts),
    JSON.stringify(street));

  const zapped = await page.evaluate(async () => {
    const s = window.spreefall;
    const b = s.hackTarget.ref;
    // Three people beside it and a car at the kerb next to it.
    const people = [];
    for (let i = 0; i < 3; i++) {
      const c = s.soldiers.spawnCivilianNear(b.x, b.z, 2, 6);
      if (!c) continue;
      const a = (i / 3) * Math.PI * 2;
      c.x = b.x + Math.cos(a) * 2.5; c.z = b.z + Math.sin(a) * 2.5; c.y = s.world.groundHeight(c.x, c.z);
      c.targetX = c.x; c.targetZ = c.z; c.rise = 0;
      people.push(c);
    }
    const car = s.spawnTraffic('car', { x: b.x - Math.sin(b.yaw) * 4, z: b.z - Math.cos(b.yaw) * 4, yaw: b.yaw + Math.PI / 2 });
    // Waiting at the kerb beside it.
    if (car) { car.x = b.x - Math.sin(b.yaw) * 4; car.z = b.z - Math.cos(b.yaw) * 4; car.speed = 0; }
    s.phone.battery = s.backdoorSpec.battery.most;
    const blown = s.state.boxesBlown || 0;
    const ok = s.hackKey(0);
    const crackling = s.boxesNear(250).some((k) => k.f === b && k.light === 1);
    let floored = 0;
    for (let i = 0; i < 60 * 1.6; i++) {
      s.fixedForTest(1 / 60);
      if (i === 70) floored = people.filter((c) => c.state === 4 || c.health <= 0).length;
    }
    const out = { ok, crackling, blown: (s.state.boxesBlown || 0) - blown, floored, people: people.length,
      stalled: car && car.traffic ? car.traffic.stalled > 0 : null, burnt: s.boxesNear(250).some((k) => k.f === b && k.light === 3) };
    s.soldiers.reset();
    if (car) s.vehicles.remove(car);
    return out;
  });
  check('overloaded, it crackles, then blows: the people round it are off their feet and the car beside it stalls',
    zapped.ok && zapped.crackling && zapped.blown === 1 && zapped.floored >= 2 && zapped.stalled !== false && zapped.burnt,
    JSON.stringify(zapped));

  const trapped = await page.evaluate(async () => {
    const s = window.spreefall;
    const b0 = s.boxesNear(250).map((k) => k.f).find((f) => f.spent <= 0 && f.fuse <= 0);
    const on = await window.onTo(b0, b0.x, s.world.groundHeight(b0.x, b0.z) + 0.9, b0.z);
    const b = s.hackTarget.ref;
    s.phone.battery = s.backdoorSpec.battery.most;
    const ok = s.hackKey(1);
    const set = b.trap > 0;
    // Nothing near it: it waits.
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    const waited = b.spent <= 0 && b.trap > 0;
    // Somebody walking along the pavement past it.
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    const ax = -fz, az = fx;
    const c = s.soldiers.spawnCivilianNear(b.x, b.z, 8, 12);
    c.rise = 0;
    c.x = b.x + ax * 9 + fx * 0.8; c.z = b.z + az * 9 + fz * 0.8; c.y = s.world.groundHeight(c.x, c.z);
    c.directed = { x: b.x - ax * 5 + fx * 0.8, z: b.z - az * 5 + fz * 0.8, speed: 2.5 };
    const blown = s.state.boxesBlown || 0;
    let t = 0, closest = 99;
    while ((s.state.boxesBlown || 0) === blown && t < 8) {
      s.fixedForTest(1 / 60); t += 1 / 60;
      closest = Math.min(closest, Math.hypot(c.x - b.x, c.z - b.z));
    }
    const out = { on, ok, set, waited, went: (s.state.boxesBlown || 0) - blown, after: +t.toFixed(1),
      floored: c.state === 4 || c.health <= 0, closest: +closest.toFixed(1) };
    c.directed = null;
    s.soldiers.reset();
    return out;
  });
  check('a trap waits, and goes off on whoever walks up to it',
    trapped.on && trapped.ok && trapped.set && trapped.waited && trapped.went === 1 && trapped.floored, JSON.stringify(trapped));

  const atm = await page.evaluate(async () => {
    const s = window.spreefall;
    const list = s.atmsNear(400);
    let a = null;
    for (const k of list) {
      const f = k.f;
      const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
      const y = s.world.groundHeight(f.x, f.z) + 1.3;
      // In front of it, on the pavement.
      for (const off of [4, 6, 3]) {
        const px = f.x + fx * off, pz = f.z + fz * off;
        const g = s.world.groundHeight(px, pz);
        if (!s.world.lineOfSight(px, g + 1.7, pz, f.x + fx * 0.2, y, f.z + fz * 0.2)) continue;
        s.teleport(px, pz);
        for (let i = 0; i < 2; i++) s.fixedForTest(1 / 60);
        const dx = f.x - s.player.x, dz = f.z - s.player.z, dy = y - (s.player.y + 1.7);
        s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI);
        for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
        const t = s.hackTarget;
        if (t && t.kind === 'atm' && Math.abs(t.ref.x - f.x) < 0.3 && Math.abs(t.ref.z - f.z) < 0.3) { a = t.ref; break; }
      }
      if (a) break;
    }
    if (!a) return { found: false, count: list.length };
    const card = document.getElementById('hcname').textContent, acts = document.getElementById('hcacts').textContent;
    s.phone.battery = s.backdoorSpec.battery.most;
    const money = s.phone.money;
    const ok = s.hackKey(0);
    // It takes a moment, with the phone kept on it.
    const t0 = performance.now();
    while (s.phone.job && performance.now() - t0 < 30000) await new Promise((r) => requestAnimationFrame(r));
    const got = s.phone.money - money;
    const empty = a.empty > 0;
    // And the next one: spray it, with people about: out in front of it, on
    // its side of the wall where they can see it, and with the traffic kept
    // off the street. Anywhere in a ring round it put some behind the
    // frontage it is in, and a crash in the traffic sends people running
    // the other way, cash or no cash; once none of four came.
    a.empty = 0;
    window.keepClear([]);
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    const ga = s.world.groundHeight(a.x, a.z);
    const people = [];
    for (const [out, along] of [[6, -6], [7, 6], [9, -9], [10, 9], [5, -3], [8, 3], [12, 0], [4, 7]]) {
      if (people.length >= 4) break;
      const x = a.x + fx * out - fz * along, z = a.z + fz * out + fx * along;
      const g = s.world.groundHeight(x, z);
      if (!s.world.lineOfSight(x, g + 1, z, a.x + fx * 0.5, ga + 1, a.z + fz * 0.5)) continue;
      const c = s.soldiers.spawnCivilianNear(a.x, a.z, 2, 8);
      if (!c) break;
      c.x = x; c.z = z; c.y = g; c.targetX = x; c.targetZ = z;
      c.rise = 0; c.panicLeft = 0;
      people.push(c);
    }
    const before = people.map((c) => Math.hypot(c.x - a.x, c.z - a.z));
    s.phone.battery = s.backdoorSpec.battery.most;
    const ok2 = s.hackKey(1);
    for (let i = 0; i < 60 * 3; i++) { s.fixedForTest(1 / 60); window.keepClear([]); }
    const closer = people.filter((c, i) => Math.hypot(c.x - a.x, c.z - a.z) < before[i] - 3).length;
    const out = { found: true, card, acts, ok, got, empty, ok2, spraying: a.spray > 0, people: people.length, closer };
    s.soldiers.reset();
    return out;
  });
  check('an ATM in the wall pays out what it holds, and is empty after',
    atm.found && atm.card === 'ATM' && /Q\s*Withdraw/.test(atm.acts) && atm.ok && atm.got >= 80 && atm.empty, JSON.stringify(atm));
  check('or throws its cash into the street, and the people near come running for it',
    atm.found && atm.ok2 && atm.spraying && atm.people >= 2 && atm.closer >= 2, JSON.stringify(atm));

  const blockers = await page.evaluate(async () => {
    const s = window.spreefall;
    // A row with straight road behind it, coming into the junction.
    const rows = s.bollardRows().filter((r) => Math.hypot(r.x - 81, r.z) < 400)
      .sort((a, b) => Math.hypot(a.x - 81, a.z) - Math.hypot(b.x - 81, b.z));
    for (const row of rows) {
      const yaw = Math.atan2(row.nx, row.nz);
      const v = s.spawnTraffic('car', { x: row.x + row.nx * 30, z: row.z + row.nz * 30, yaw });
      if (!v) continue;
      const along = (v.x - row.x) * row.nx + (v.z - row.z) * row.nz;
      const across = (v.x - row.x) * row.ax + (v.z - row.z) * row.az;
      if (Math.cos(v.yaw - yaw) < 0.95 || Math.abs(along - 30) > 4 || Math.abs(across) > row.w / 2) { s.vehicles.remove(v); continue; }
      const on = await window.onTo(row, row.x, s.world.groundHeight(row.x, row.z) + 0.4, row.z);
      if (!on) { s.vehicles.remove(v); continue; }
      const live = s.hackTarget.ref;
      const card = document.getElementById('hcname').textContent, acts = document.getElementById('hcacts').textContent;
      // The lights held green, so what stops it is the blockers.
      for (const j of s.junctions()) if (Math.hypot(j.x - row.x, j.z - row.z) < 60) j.hack = { kind: 'green', left: 1e9 };
      s.phone.battery = s.backdoorSpec.battery.most;
      const ok = s.hackKey(0);
      v.speed = 11;
      const hull = v.health;
      let t = 0;
      for (; t < 6; t += 1 / 60) {
        // Held at it until it meets them: the driver would brake for you
        // standing ahead with the phone, and then it is not eleven.
        v.speed = 11;
        s.fixedForTest(1 / 60);
        window.keepClear([v]);
        if (v.traffic && v.traffic.crashed) break;
      }
      for (let i = 0; i < 30; i++) { s.fixedForTest(1 / 60); window.keepClear([v]); }
      const nose = (v.x - row.x) * row.nx + (v.z - row.z) * row.nz - (v.spec.length || 4) / 2;
      const out = { ok, card, acts, up: +live.up.toFixed(2), crashed: !!(v.traffic && v.traffic.crashed), hurt: v.health < hull,
        speed: +Math.abs(v.speed).toFixed(2), nose: +nose.toFixed(2), crashes: s.state.bollardCrashes || 0,
        dent: v.dent.map((d) => +d.toFixed(2)), broke: v.broke };
      for (const j of s.junctions()) j.hack = null;
      live.left = 0;
      s.vehicles.remove(v);
      return out;
    }
    return { found: false };
  });
  check('road blockers come up out of the road at a junction, and a car driving into them is stopped dead and damaged',
    blockers.ok && blockers.card === 'Road blockers' && blockers.up === 1 && blockers.crashed && blockers.hurt
      && blockers.speed < 1.5 && blockers.nose > -1.5, JSON.stringify(blockers));
  // Eleven metres a second into them: 0.045 of its nose a metre a second,
  // the headlights out past 0.3, and the windscreen cracked from eight.
  check('and its nose shows it: pushed in, the headlights out and the windscreen crazed, the tail untouched',
    blockers.dent && blockers.dent[0] > 0.3 && blockers.dent[1] === 0 && (blockers.broke & 16) && (blockers.broke & 1)
      && !(blockers.broke & 2), JSON.stringify({ dent: blockers.dent, broke: blockers.broke }));

  // --- what a vehicle shows of what has been done to it ----------------------
  // A car parked in the middle of the street, side on to you on the kerb,
  // and the rifle into its side: low first, then through the windows.
  await byRoad();
  const shotCar = await page.evaluate(async () => {
    const s = window.spreefall;
    const r = window.road;
    s.effects.clear();
    const v = s.vehicles.spawn('car', r.mx, r.mz, r.yaw);
    v.paint = 2;
    window.lastCar = v;
    window.keepClear([v]);
    s.weapon.giveAll(); s.weapon.select('m16');
    const fire = async (h, n) => {
      for (let k = 0; k < n && v.health > 0; k++) {
        const ex = s.player.x, ey = s.player.y + 1.7, ez = s.player.z;
        const dx = v.x - ex, dy = v.y + h - ey, dz = v.z - ez;
        const l = Math.hypot(dx, dy, dz);
        s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.asin(dy / l) * 180 / Math.PI);
        s.camera.update(16 / 9);
        s.weapon.cooldown = 0; s.weapon.spread = 0; s.weapon.ammo = 30;
        s.shoot();
      }
    };
    // Which side of it faces you.
    const lx = Math.cos(v.yaw) * (s.player.x - v.x) - Math.sin(v.yaw) * (s.player.z - v.z);
    const side = lx < 0 ? 2 : 3, pane = lx < 0 ? 4 : 8;
    await fire(0.55, 4);
    const low = { holes: v.holes[side], broke: v.broke, share: v.health / v.maxHealth };
    await fire(1.15, 4);
    const high = { holes: v.holes[side], broke: v.broke, dent: +v.dent[side].toFixed(2), share: +(v.health / v.maxHealth).toFixed(2),
      panes: s.state.panesBroken || 0 };
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    for (let i = 0; i < 3; i++) await new Promise((res) => requestAnimationFrame(res));
    return { low, high, side, pane, smoke: s.effects.list.filter((p) => p.alive && p.kind === 6).length };
  });
  check('rounds into a car make holes in the side they went into, and only above the waistline take the glass with them',
    shotCar.low.holes === 4 && !(shotCar.low.broke & shotCar.pane) && shotCar.high.holes === 8 && (shotCar.high.broke & shotCar.pane)
      && shotCar.high.panes >= 1, JSON.stringify(shotCar));
  check('a round makes a hole and not much of a dent, and eight of them leave a car still running',
    shotCar.high.dent < 0.3 && shotCar.high.share > 0.55 && shotCar.smoke === 0, JSON.stringify(shotCar.high));
  await page.screenshot({ path: path.join(SHOTS, 'backdoor-09-shot-car.png') });

  const burning = await page.evaluate(async () => {
    const s = window.spreefall;
    const v = window.lastCar;
    const stages = [];
    const smokeOf = () => s.effects.list.filter((p) => p.alive && p.kind === 6);
    let shots = 8;
    s.weapon.select('m16');
    while (v.health > 0 && shots < 60) {
      const ex = s.player.x, ey = s.player.y + 1.7, ez = s.player.z;
      const dx = v.x - ex, dy = v.y + 0.6 - ey, dz = v.z - ez;
      const l = Math.hypot(dx, dy, dz);
      s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.asin(dy / l) * 180 / Math.PI);
      s.camera.update(16 / 9);
      s.weapon.cooldown = 0; s.weapon.spread = 0; s.weapon.ammo = 30;
      s.shoot();
      shots++;
      for (let i = 0; i < 6; i++) s.fixedForTest(1 / 60);
      const share = v.health / v.maxHealth;
      const st = share < 0.15 ? 'fire' : share < 0.3 ? 'black' : share < 0.55 ? 'smoke' : null;
      if (st && !stages.some((x) => x.st === st)) {
        // A fifth of a second at it first, so the first puff of the new
        // colour is out: the last of the old one was let go up to 0.14 s ago.
        for (let i = 0; i < 12; i++) s.fixedForTest(1 / 60);
        const puffs = smokeOf().filter((p) => p.life > p.maxLife - 0.2);
        stages.push({ st, shots, puffs: puffs.length, dark: puffs.length ? +Math.min(...puffs.map((p) => p.r)).toFixed(2) : null });
      }
      if (share < 0.15) break;
    }
    // A second of it on fire, for the picture; and the world held still for
    // it, or a slow machine burns the car out while the picture is taken.
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    s.state.paused = true;
    for (let i = 0; i < 3; i++) await new Promise((res) => requestAnimationFrame(res));
    return { stages, shots, lit: +v.health.toFixed(1) };
  });
  await page.screenshot({ path: path.join(SHOTS, 'backdoor-10-burning-car.png') });
  const burnt = await page.evaluate(() => {
    const s = window.spreefall;
    const v = window.lastCar;
    // On fire it burns down by itself, and goes up.
    let t = 0;
    for (; t < 15 && v.health > 0; t += 1 / 60) s.fixedForTest(1 / 60);
    s.state.paused = false;
    return { burnt: +t.toFixed(1), dead: v.health <= 0 };
  });
  const stage = (st) => burning.stages.find((x) => x.st === st);
  check('shot on, the engine smokes grey, then black, and then it is on fire',
    stage('smoke') && stage('black') && stage('fire') && stage('smoke').puffs > 0 && stage('black').dark < stage('smoke').dark
      && burning.shots <= 30, JSON.stringify(burning.stages));
  check('and once it is burning it burns down by itself and goes up, the way any vehicle does',
    burnt.dead && burnt.burnt > 2 && burnt.burnt < 12, JSON.stringify({ lit: burning.lit, ...burnt }));

  // Blockers coming up under a car standing over them: they come up into its
  // floor under the nose and throw it, nose up, back off the row.
  const thrown = await page.evaluate(async () => {
    const s = window.spreefall;
    s.vehicles.reset();
    s.effects.clear();
    const rows = s.bollardRows().filter((r) => Math.hypot(r.x - 81, r.z) < 400 && r.up === 0 && !(r.left > 0))
      .sort((a, b) => Math.hypot(a.x - 81, a.z) - Math.hypot(b.x - 81, b.z));
    for (const row of rows) {
      // Coming into the junction, its nose a metre past the row.
      const yaw = Math.atan2(row.nx, row.nz);
      const v = s.vehicles.spawn('car', row.x + row.nx * 1.2, row.z + row.nz * 1.2, yaw);
      v.paint = 4;
      const on = await window.onTo(row, row.x, s.world.groundHeight(row.x, row.z) + 0.4, row.z);
      if (!on || s.hackTarget.ref !== row) { s.vehicles.remove(v); continue; }
      window.keepClear([v]);
      const g0 = v.y, lifts = s.state.bollardLifts || 0;
      s.phone.battery = s.backdoorSpec.battery.most;
      const ok = s.hackKey(0);
      let top = 0, pitch = 0, flew = false, apex = null;
      for (let t = 0; t < 3; t += 1 / 60) {
        s.fixedForTest(1 / 60);
        window.keepClear([v]);
        if (v.airborne) flew = true;
        if (v.y - g0 > top) top = v.y - g0;
        pitch = Math.max(pitch, v.pitch);
        if (flew && !apex && v.lift < 0.6) apex = { x: v.x, y: v.y, z: v.z };
        if (flew && !v.airborne) break;
      }
      const away = (v.x - row.x) * row.nx + (v.z - row.z) * row.nz;
      return { ok, flew, top: +top.toFixed(2), pitch: +pitch.toFixed(2), away: +away.toFixed(2),
        lifts: (s.state.bollardLifts || 0) - lifts, hurt: v.health < v.maxHealth, dent: v.dent.map((d) => +d.toFixed(2)),
        row: { x: row.x, z: row.z, nx: row.nx, nz: row.nz }, apex };
    }
    return { found: false };
  });
  check('blockers coming up under a car throw it into the air, nose up, and back off the row',
    thrown.ok && thrown.flew && thrown.lifts === 1 && thrown.top > 0.6 && thrown.pitch > 0.3 && thrown.away > 1.2 && thrown.hurt
      && thrown.dent[0] > 0, JSON.stringify(thrown));
  // The picture: the same again, held at the top of the throw.
  if (thrown.row) {
    await page.evaluate(async (row0) => {
      const s = window.spreefall;
      const row = s.bollardRows().find((r) => r.x === row0.x && r.z === row0.z);
      row.left = 0; row.up = 0;
      s.vehicles.reset(); s.effects.clear();
      const v = s.vehicles.spawn('car', row.x + row.nx * 1.2, row.z + row.nz * 1.2, Math.atan2(row.nx, row.nz));
      v.paint = 4;
      // From the kerb, side on, a little back.
      const px = row.x + row.ax * 9 + row.nx * 2, pz = row.z + row.az * 9 + row.nz * 2;
      s.teleport(px, pz);
      const dx = v.x - px, dz = v.z - pz;
      s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, 4);
      row.left = 12;
      for (let t = 0; t < 2 && !(v.airborne && v.lift < 1.5); t += 1 / 60) s.fixedForTest(1 / 60);
      s.state.paused = true;
      for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    }, thrown.row);
    await page.screenshot({ path: path.join(SHOTS, 'backdoor-11-thrown-car.png') });
    await page.evaluate(() => { window.spreefall.state.paused = false; });
  }

  // The picture: a power box going up on the pavement, held at the moment it
  // goes (the world stopped, the frame still drawn).
  await page.evaluate(async () => {
    const s = window.spreefall;
    const b0 = s.boxesNear(250).map((k) => k.f).find((f) => f.spent <= 0 && f.fuse <= 0);
    await window.onTo(b0, b0.x, s.world.groundHeight(b0.x, b0.z) + 0.9, b0.z);
    const b = s.hackTarget.ref;
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    s.teleport(b.x + fx * 7 - fz * 2, b.z + fz * 7 + fx * 2);
    const dx = b.x - s.player.x, dz = b.z - s.player.z;
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, -6);
    s.effects.clear();
    s.phone.battery = s.backdoorSpec.battery.most;
    s.hackKey(0);
    for (let i = 0; i < 64 && !(b.spent > 0); i++) s.fixedForTest(1 / 60);
    s.state.paused = true;
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  await page.screenshot({ path: path.join(SHOTS, 'backdoor-08-power-box.png') });
  await page.evaluate(() => { window.spreefall.state.paused = false; });

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
