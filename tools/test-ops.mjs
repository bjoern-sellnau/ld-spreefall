// Drives the two campaigns in a real browser: Spree Fall Tactics, the camps
// across the city to be taken one at a time, and Spree Fall Slayer, the
// nests of demons. Every check is a claim the mode makes, checked by playing
// it: the camps are put down on open ground and stay where they were put,
// the men in them keep to their post, a camp taken without an alarm pays the
// bonus, and the journal can give the camps back, harder.
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

  // --- the title card -------------------------------------------------------
  const title = await page.evaluate(() => {
    const s = window.spreefall;
    const btn = document.querySelector('.diff.mode[data-mode=tactics]');
    btn.click();
    const setup = document.getElementById('opssetup');
    const lit = [...document.querySelectorAll('.diff.mode.on')].map((b) => b.dataset.mode);
    const options = [...document.getElementById('opsstart').options].map((o) => o.value);
    const quietShown = !setup.querySelector('.opstactics').classList.contains('hidden');
    const bossesShown = !setup.querySelector('.opsslayer').classList.contains('hidden');
    document.querySelector('.diff.mode[data-mode=berlin]').click();
    const goneAgain = setup.classList.contains('hidden');
    document.querySelector('.diff.mode[data-mode=tactics]').click();
    return { mode: s.campaign.mode, shown: !setup.classList.contains('hidden'), lit, options,
      quietShown, bossesShown, goneAgain, home: s.world.home };
  });
  check('Tactics is a mode on the title card, and stays lit when picked',
    title.mode === 'tactics' && title.lit.length === 1 && title.lit[0] === 'tactics',
    `${title.lit.join(', ')}`);
  check('and it brings its setup with it: where to play, where to start, how many camps',
    title.shown && title.options.length > 0 && title.options.includes(title.home)
      && title.quietShown && !title.bossesShown && title.goneAgain,
    `${title.options.length} districts to start in`);

  // --- a run ------------------------------------------------------------------
  const placed = await page.evaluate(async () => {
    const s = window.spreefall;
    s.campaign.wipe();
    s.campaign.set('scope', 'district');
    s.campaign.set('start', s.world.home);
    s.campaign.set('perDistrict', 4);
    s.skipToWalk();
    s.tiles.uploadsPerFrame = 500;
    s.setQuality('low');
    s.startOps();
    s.state.opsTravel = false;
    s.setCheat('godmode', true);
    for (let i = 0; i < 90; i++) s.fixedForTest(1 / 60);
    const sites = s.campaign.allSites();
    let minGap = Infinity;
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        minGap = Math.min(minGap, Math.hypot(sites[i].x - sites[j].x, sites[i].z - sites[j].z));
      }
    }
    // Open ground: nothing at chest height within ten metres of the middle.
    let boxed = 0;
    for (const c of sites) {
      const g = s.world.groundHeight(c.x, c.z);
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        if (s.world.raycast(c.x, g + 1.4, c.z, Math.cos(a), 0, Math.sin(a), 7)) { boxed++; break; }
      }
    }
    // The line is drawn with the frame, not the step.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { n: sites.length, minGap: Math.round(minGap), boxed, budget: s.soldiers.budget + s.drones.budget + s.jets.budget,
      first: sites[0] ? { id: sites[0].id, x: sites[0].x, z: sites[0].z } : null,
      hud: document.getElementById('ops').textContent };
  });
  check('the start district gets its camps, on open ground and well apart',
    placed.n >= 2 && placed.boxed === 0 && placed.minGap >= 170,
    `${placed.n} camps, ${placed.minGap} m apart at the closest, ${placed.boxed} boxed in`);
  check('and nothing else is sent after you', placed.budget === 0, `budget ${placed.budget}`);
  check('the line at the top says where you stand', /tactics/i.test(placed.hud) && /camps/.test(placed.hud),
    placed.hud);

  // --- the compass, a mark of your own, and the order at the top ------------
  const compass = await page.evaluate(async () => {
    const s = window.spreefall;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const site = s.campaign.allSites()[0];
    // Facing the first camp: it is on the bar, in the middle.
    s.teleport(site.x + 300, site.z);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    s.look(90, 0);
    await frame();
    const out = {};
    const bar = document.getElementById('compassbar');
    out.shown = !bar.classList.contains('hidden');
    out.ahead = s.compassBar.last ? { ...s.compassBar.last } : null;
    // Turned round, it waits at the edge.
    s.look(-90, 0);
    await frame();
    out.behind = { ...s.compassBar.last };
    // The street name sits under the compass and the operation line under that.
    const box = (id) => document.getElementById(id).getBoundingClientRect();
    const street = document.getElementById('streetname');
    const hid = street.classList.contains('hidden');
    street.textContent = street.textContent || 'Unter den Linden';
    street.classList.remove('hidden');
    out.order = { bar: box('compassbar').bottom, street: box('streetname').top, ops: box('ops').top,
      streetBottom: box('streetname').bottom };
    if (hid) street.classList.add('hidden');
    return out;
  });
  check('a compass across the top, with the nearest camp on it and how far',
    compass.shown && compass.ahead && compass.ahead.goals.length === 1
      && Math.abs(compass.ahead.goals[0].x - compass.ahead.width / 2) < 12 && !compass.ahead.goals[0].behind,
    JSON.stringify(compass.ahead));
  check('turned away, the camp waits at the edge with an arrow', compass.behind.goals[0].behind,
    JSON.stringify(compass.behind.goals));
  check('the compass, then the street name, then the operation line, nothing on top of anything',
    compass.order.street >= compass.order.bar - 1 && compass.order.ops >= compass.order.streetBottom - 1,
    JSON.stringify(compass.order));

  // A mark: open the map, click it, and the compass points there.
  await page.evaluate(() => { const s = window.spreefall; if (!s.minimap.big) s.toggleMap(); });
  await page.waitForTimeout(700);
  const target = await page.evaluate(() => {
    const r = document.getElementById('minimap').getBoundingClientRect();
    const x = r.left + r.width * 0.7, y = r.top + r.height * 0.4;
    const top = document.elementFromPoint(x, y);
    return { x, y, top: top ? (top.id || top.className) : null };
  });
  await page.mouse.click(target.x, target.y);
  const marked = await page.evaluate((target) => {
    const s = window.spreefall;
    return { mark: s.state.waypoint ? { ...s.state.waypoint } : null, big: s.minimap.big, top: target.top,
      button: !document.getElementById('mapunmark').classList.contains('hidden') };
  }, target);
  await page.evaluate(() => window.spreefall.toggleMap());
  await page.waitForTimeout(300);
  const toMark = await page.evaluate(async () => {
    const s = window.spreefall;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const w = s.state.waypoint;
    if (!w) return null;
    // Face it, and it is in the middle of the bar.
    const a = Math.atan2(-(w.x - s.player.x), -(w.z - s.player.z));
    s.look(a * 180 / Math.PI, 0);
    await frame();
    const goal = (s.compassBar.last.goals || []).find((g) => g.kind === 'mark');
    const centred = !!goal && Math.abs(goal.x - s.compassBar.last.width / 2) < 12;
    // Stand on it and it goes.
    s.teleport(w.x + 3, w.z + 3);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    await frame();
    return { centred, gone: !s.state.waypoint };
  });
  check('click the big map and there is a mark, with a button to take it off', !!marked.mark && marked.button,
    JSON.stringify(marked));
  check('the compass points at the mark, and it goes once you are there', !!toMark && toMark.centred && toMark.gone,
    JSON.stringify(toMark));
  await page.evaluate(async () => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[0];
    s.teleport(site.x + 120, site.z + 30);
    s.setMark({ x: site.x - 400, z: site.z + 500 });
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    s.look(80, 2);
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SHOTS, 'ops-09-compass.png') });
  await page.evaluate(() => window.spreefall.setMark(null));

  // --- through the Brandenburg Gate ---------------------------------------------
  const gate = await page.evaluate(() => {
    const s = window.spreefall;
    const out = [];
    // The gate stands across x = 0, its passages running east to west; the
    // middle one and one either side of it, then a cross wall.
    for (const z of [3.3, 15.2, -8.6, 9.27]) {
      s.teleport(25, z);
      for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
      s.look(90, 0);
      s.input.keys.add('KeyW');
      for (let i = 0; i < 60 * 20; i++) s.fixedForTest(1 / 60);
      s.input.keys.delete('KeyW');
      out.push(+s.player.x.toFixed(1));
    }
    return out;
  });
  check('the Brandenburg Gate can be walked through, its five passages open and its walls solid',
    gate[0] < -10 && gate[1] < -10 && gate[2] < -10 && gate[3] > 3, JSON.stringify(gate));

  const again = await page.evaluate(() => {
    const s = window.spreefall;
    const before = s.campaign.allSites().map((c) => `${c.x},${c.z}`).join(' ');
    // Read back from storage, the way a reload would.
    const raw = localStorage.getItem('spreefall.ops.v1');
    const book = JSON.parse(raw).books.tactics.sites;
    const after = Object.values(book).flat().map((c) => `${c.x},${c.z}`).join(' ');
    return { same: before === after, n: Object.values(book).flat().length };
  });
  check('the camps are kept, so a reload finds them where they were', again.same && again.n === placed.n);

  // --- manned, stood down, taken ---------------------------------------------
  const manned = await page.evaluate(() => {
    const s = window.spreefall;
    // Blind for now: this is about where they stand, not what they see.
    s.soldiers.stealth = { range: 0, cone: 2, near: 0, fill: 0, decay: 1, run: 1 };
    const site = s.campaign.allSites()[0];
    s.teleport(site.x + 40, site.z);
    for (let i = 0; i < 20; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    const guards = run.guards.length;
    // Ten seconds: they walk their rounds and nobody leaves.
    s.combat.reset();
    const hurt = s.combat.hurt;
    s.combat.hurt = () => false;
    let far = 0;
    for (let i = 0; i < 600; i++) {
      s.fixedForTest(1 / 60);
      for (const g of run.guards) far = Math.max(far, Math.hypot(g.x - site.x, g.z - site.z));
    }
    s.combat.hurt = hurt;
    const sentries = run.guards.filter((g) => g.sentry).length;
    // Away, and back: stood down, then manned in full again.
    s.teleport(site.x + 900, site.z);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    const down = !run.manned && run.guards.length === 0;
    s.teleport(site.x + 40, site.z);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    return { guards, sentries, far: Math.round(far), down, back: run.guards.length };
  });
  check('a camp within reach is manned', manned.guards >= 5 && manned.sentries >= 2,
    `${manned.guards} guards, ${manned.sentries} of them sentries`);
  check('and its guards keep to their post', manned.far <= 30, `${manned.far} m out at the furthest`);
  check('walk away and it stands down, come back and it is manned again', manned.down && manned.back === manned.guards);

  await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[0];
    s.teleport(site.x + 34, site.z + 6);
    s.look(80, -6);
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'ops-01-camp.png') });

  const taken = await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[0];
    const run = s.tactics.live.get(site.id);
    const before = s.campaign.book.score;
    // Taken from out of sight in one go: the deaths are not seen by anybody.
    for (const g of run.guards) { g.health = 1; }
    const down = s.soldiers.onDown;
    s.soldiers.onDown = null;
    for (const g of run.guards) s.soldiers.damage(g, 9999, { x: 1, y: 0, z: 0 });
    s.soldiers.onDown = down;
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    s.soldiers.stealth = s.tacticsSpec.stealth;
    return { state: site.state, paid: s.campaign.book.score - before, quiet: s.campaign.book.quiet };
  });
  check('the last guard down takes the camp, and a quiet one pays the bonus',
    taken.state === 1 && taken.paid === 2500 && taken.quiet === 1, `+${taken.paid}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'ops-02-camp-taken.png') });

  // --- the journal -----------------------------------------------------------
  const journal = await page.evaluate(() => {
    const s = window.spreefall;
    s.opsPanel(true);
    const open = !document.getElementById('opspanel').classList.contains('hidden');
    const rows = document.querySelectorAll('#opslist .opsd').length;
    document.getElementById('opsharder').click();
    const sites = s.campaign.allSites();
    const back = sites.every((c) => c.state === 0 && c.level === 1);
    const line = document.getElementById('opspanelline').textContent;
    s.opsPanel(false);
    // A level one camp has a man more in it.
    const site = sites[0];
    s.teleport(site.x + 40, site.z);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    return { open, rows, back, line, guards: run.guards.length };
  });
  check('J opens the journal, with a row for the district', journal.open && journal.rows >= 1, journal.line);
  check('and it gives the camps back, harder', journal.back && journal.guards === manned.guards + 1,
    `${journal.guards} guards at level two`);

  // --- being seen -------------------------------------------------------------
  // A fresh camp at level one, nobody alerted, and you a long way off.
  const fresh = () => page.evaluate(() => {
    const s = window.spreefall;
    s.tactics.clear();
    s.campaign.reset({});
    s.soldiers.reset();
    s.projectiles.clear();
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    s.teleport(site.x + 30, site.z + 30);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    return site.id;
  });

  const seen = await page.evaluate(async () => {
    const s = window.spreefall;
    s.tactics.clear();
    s.campaign.reset({});
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    s.teleport(site.x + 60, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    const g = run.guards.find((x) => x.sentry) || run.guards[0];
    for (const o of run.guards) if (o !== g) s.soldiers._retire(o);
    run.guards = [g];
    g.sentry = true;
    const hurt = s.combat.hurt;
    s.combat.hurt = () => false;
    // Behind him, twelve metres back, standing still: nothing.
    const fx = -Math.sin(g.yaw), fz = -Math.cos(g.yaw);
    const stand = (d) => {
      const x = g.x + fx * d, z = g.z + fz * d;
      s.teleport(x, z);
      s.player.vx = 0; s.player.vz = 0;
    };
    stand(-12);
    for (let i = 0; i < 300; i++) s.fixedForTest(1 / 60);
    const behind = g.suspicion;
    // In front of him, forty metres out: it builds, he stops, and then he is sure.
    stand(40);
    let half = -1, sure = -1;
    for (let i = 0; i < 60 * 12 && sure < 0; i++) {
      s.fixedForTest(1 / 60);
      if (half < 0 && g.suspicion >= 0.5) half = i / 60;
      if (run.spotted) sure = i / 60;
    }
    // Then, if he is not stopped, the alarm.
    let alarm = -1;
    for (let i = 0; i < 60 * 5 && alarm < 0; i++) {
      s.fixedForTest(1 / 60);
      if (run.alarm) alarm = i / 60;
    }
    s.combat.hurt = hurt;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { behind: +behind.toFixed(2), half: +half.toFixed(1), sure: +sure.toFixed(1), alarm: +alarm.toFixed(1),
      alertAll: run.guards.every((x) => x.post.alert), hud: document.getElementById('opsalert').textContent,
      siren: s.tactics.drawList(s.player.x, s.player.z).some((c) => c.alarm) };
  });
  check('a sentry does not see you behind him', seen.behind === 0, `${seen.behind}`);
  check('in front of him he takes a moment to be sure, then he is', seen.half > 0.3 && seen.sure > seen.half,
    `half sure after ${seen.half} s, sure after ${seen.sure} s`);
  check('and a guard left to it sounds the alarm', seen.alarm >= 0 && seen.alertAll && seen.siren,
    `${seen.alarm} s later, ${seen.hud}`);

  await fresh();
  const silenced = await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    s.teleport(site.x + 60, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    // Only the one: the rest are kept from seeing you for themselves, which
    // is a different check.
    s.soldiers.stealth = { range: 0, cone: 2, near: 0, fill: 0, decay: 1, run: 1 };
    const g = run.guards[0];
    s.tactics.spot(g, 'seen');
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    s.soldiers.damage(g, 9999, { x: 1, y: 0, z: 0 });
    for (let i = 0; i < 60 * 4; i++) s.fixedForTest(1 / 60);
    s.soldiers.stealth = s.tacticsSpec.stealth;
    return { alarm: run.alarm, spotted: run.spotted };
  });
  check('kill the one who saw you before he gets to it and there is no alarm',
    !silenced.alarm && !silenced.spotted);

  await fresh();
  const heard = await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    s.teleport(site.x + 100, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    s.weapon.select('m16');
    s.weapon.cooldown = 0;
    s.look(0, 40);
    s.shoot();
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    return { spotted: run.spotted, heard: run.spotters.size };
  });
  check('a rifle shot a hundred metres off is heard in the camp', heard.spotted && heard.heard >= 2,
    `${heard.heard} of them heard it`);

  await fresh();
  const radio = await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    s.teleport(site.x + 60, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    // The alarm with the radio working: help after the call delay.
    s.tactics.raiseAlarm(run);
    const before = s.soldiers.active.filter((x) => x.reinforcement === site.id).length;
    for (let i = 0; i < 60 * (s.tacticsSpec.callDelay + 1); i++) s.fixedForTest(1 / 60);
    const came = s.soldiers.active.filter((x) => x.reinforcement === site.id).length - before;
    // A shot straight through the radio, from three metres.
    const p = s.tactics.radioAt(site);
    const from = { x: p.x + 3, y: p.y, z: p.z };
    let shots = 0;
    while (run.radioUp && shots < 10) { s.tactics.shotRadio(from, { x: p.x - 3, y: p.y, z: p.z }, 34); shots++; }
    const waves = run.waves;
    for (let i = 0; i < 60 * (s.tacticsSpec.waveGap + 2); i++) s.fixedForTest(1 / 60);
    return { came, down: !run.radioUp, shots, wavesAfter: run.waves, waves,
      drawn: s.tactics.drawList(s.player.x, s.player.z).find((c) => Math.abs(c.x - site.x) < 1) };
  });
  check('with the alarm on and the radio working, help comes', radio.came >= 3, `${radio.came} reinforcements`);
  check('the radio can be shot to pieces', radio.down && radio.shots === 2 && radio.drawn && radio.drawn.radioDown,
    `${radio.shots} rounds`);
  check('and once it is down nobody else is called', radio.wavesAfter === radio.waves, `${radio.waves} wave`);
  await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    s.teleport(site.x + 30, site.z + 8);
    s.look(70, -4);
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'ops-03-alarm.png') });

  const loud = await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    const run = s.tactics.live.get(site.id);
    const before = s.campaign.book.score;
    for (const g of run.guards) s.soldiers.damage(g, 9999, { x: 1, y: 0, z: 0 });
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    return { state: site.state, paid: s.campaign.book.score - before, siren: run.alarm, level: site.level };
  });
  check('a camp taken after the alarm pays no bonus, and the siren stops',
    loud.state === 1 && loud.paid === 1000 + 400 * loud.level && !loud.siren,
    `+${loud.paid}`);

  // --- the quiet three, and a takedown ---------------------------------------
  await page.evaluate(() => {
    const s = window.spreefall;
    // Through the real button: the kit is set where a run starts.
    document.getElementById('playbtn').click();
    s.skipToWalk();
    s.state.opsTravel = false;
  });
  const kit = {};
  for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
    await page.keyboard.press(k);
    kit[k] = await page.evaluate(() => window.spreefall.weapon.id);
  }
  check('in Tactics the number row starts with the quiet three',
    kit.Digit1 === 'sdpistol' && kit.Digit2 === 'bow' && kit.Digit3 === 'marksman' && kit.Digit4 === 'm16',
    JSON.stringify(kit));

  await fresh();
  const quiet = await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    s.teleport(site.x + 50, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    s.soldiers.stealth = { range: 0, cone: 2, near: 0, fill: 0, decay: 1, run: 1 };
    const heardBy = (id) => {
      s.weapon.select(id);
      s.weapon.cooldown = 0;
      s.look(0, 50);
      s.shoot();
      for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
      return run.spotters.size;
    };
    const pistol = heardBy('sdpistol');
    const bow = heardBy('bow');
    const marksman = heardBy('marksman');
    s.projectiles.clear();
    const rifle = heardBy('m16');
    s.soldiers.stealth = s.tacticsSpec.stealth;
    return { pistol, bow, marksman, rifle };
  });
  check('the pistol, the bow and the marksman rifle are not heard from fifty metres; a rifle is',
    quiet.pistol === 0 && quiet.bow === 0 && quiet.marksman === 0 && quiet.rifle >= 2, JSON.stringify(quiet));

  await fresh();
  const arrow = await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    s.teleport(site.x + 60, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    s.soldiers.stealth = { range: 0, cone: 2, near: 0, fill: 0, decay: 1, run: 1 };
    const g = run.guards[0];
    // An arrow from six metres at his head.
    const from = { x: g.x + 6, y: g.y + 1.62, z: g.z };
    s.projectiles.launch('arrow', { x: from.x, y: from.y, z: from.z, vx: -74, vy: 0.6, vz: 0, weapon: 'bow' });
    for (let i = 0; i < 20; i++) s.fixedForTest(1 / 60);
    const dead = g.state === 5 || !g.alive;
    // And one into the ground, which stays there.
    s.projectiles.launch('arrow', { x: g.x + 3, y: g.y + 2, z: g.z + 3, vx: 0, vy: -40, vz: 0, weapon: 'bow' });
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    const stuck = s.projectiles.active.filter((b) => b.kind === 'arrow' && b.stuck).length;
    s.soldiers.stealth = s.tacticsSpec.stealth;
    return { dead, alarm: run.alarm, heard: run.spotters.size, stuck };
  });
  check('an arrow in the head kills a guard without a sound', arrow.dead && !arrow.alarm && arrow.heard === 0);
  check('and an arrow that misses stays where it went in', arrow.stuck === 1);

  // The heads: R changes them with the bow in hand, and each does its own work.
  await page.evaluate(() => { const s = window.spreefall; s.weapon.select('bow'); s.weapon.arrowHead = 0; });
  const heads = [];
  for (let i = 0; i < 4; i++) {
    heads.push(await page.evaluate(() => ({ head: window.spreefall.weapon.head,
      label: document.getElementById('weaponname').textContent })));
    await page.keyboard.press('KeyR');
  }
  const headed = await page.evaluate(() => {
    const s = window.spreefall;
    const out = {};
    const site = s.campaign.allSites()[0];
    const hurt = s.combat.hurt;
    s.combat.hurt = () => false;
    // Three men standing in the open, one for each head, well apart.
    const put = (dx) => {
      const g = s.spawnSoldier(dx, 40);
      g.state = 0; g.rise = 0; g.y = s.world.groundHeight(g.x, g.z);
      return g;
    };
    s.teleport(site.x + 300, site.z + 300);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    s.soldiers.stealth = { range: 0, cone: 2, near: 0, fill: 0, decay: 1, run: 1 };
    const shotAt = (g, head) => {
      // Into the ground at his feet, from above, so only the head can do it.
      s.projectiles.launch('arrow', { x: g.x + 1.2, y: g.y + 3, z: g.z, vx: 0, vy: -40, vz: 0, weapon: 'bow', head });
    };
    const fire = put(-30), poison = put(0), blast = put(30);
    const h0 = { fire: fire.health, poison: poison.health, blast: blast.health };
    const burning0 = s.burningCount();
    shotAt(fire, 'fire'); shotAt(poison, 'poison'); shotAt(blast, 'blast');
    for (let i = 0; i < 12; i++) s.fixedForTest(1 / 60);
    out.burning = s.burningCount() - burning0;
    out.clouds = s.poisonClouds.length;
    out.blastHit = blast.health < h0.blast || blast.state === 5 || !blast.alive;
    for (let i = 0; i < 60 * 6; i++) {
      // Held where they stand, so the fire and the gas have them to work on.
      for (const g of [fire, poison]) if (g.alive && g.state !== 5) { g.vx = 0; g.vz = 0; }
      s.fixedForTest(1 / 60);
    }
    out.fireHurt = fire.health < h0.fire || fire.state === 5 || !fire.alive;
    out.poisonHurt = poison.health < h0.poison || poison.state === 5 || !poison.alive;
    s.combat.hurt = hurt;
    s.soldiers.stealth = s.tacticsSpec.stealth;
    s.soldiers.reset();
    return out;
  });
  check('R with the bow in hand goes plain, fire, poison, explosive, and the HUD says which',
    heads.map((h) => h.head).join(',') === 'plain,fire,poison,blast' && /FIRE/.test(heads[1].label)
      && /POISON/.test(heads[2].label) && /BLAST/.test(heads[3].label), JSON.stringify(heads));
  check('a fire arrow sets the ground burning and burns who stands in it', headed.burning >= 1 && headed.fireHurt,
    JSON.stringify(headed));
  check('a poison arrow lets out a cloud that hurts who breathes it', headed.clouds >= 1 && headed.poisonHurt,
    JSON.stringify(headed));
  check('an explosive arrow goes off where it lands', headed.blastHit, JSON.stringify(headed));

  await fresh();
  const knife = await page.evaluate(async () => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    s.teleport(site.x + 60, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    // Everybody else out of the way, so nobody sees it.
    const g = run.guards[0];
    for (const o of run.guards) if (o !== g) s.soldiers._retire(o);
    run.guards = [g];
    g.sentry = true;
    s.soldiers.stealth = { range: 0, cone: 2, near: 0, fill: 0, decay: 1, run: 1 };
    // Behind him, a metre and a half back, looking at him.
    const fx = -Math.sin(g.yaw), fz = -Math.cos(g.yaw);
    s.teleport(g.x - fx * 1.5, g.z - fz * 1.5);
    s.look(Math.atan2(-fx, -fz) * 180 / Math.PI, -10);
    s.camera.update(16 / 10);
    const offered = s.takedownTarget() === g;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const hint = document.getElementById('ridehintname').textContent;
    window.T = { g, run };
    return { offered, hint };
  });
  await page.keyboard.press('KeyF');
  Object.assign(knife, await page.evaluate(() => {
    const s = window.spreefall;
    const { g, run } = window.T;
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    s.soldiers.stealth = s.tacticsSpec.stealth;
    return { dead: g.state === 5 || !g.alive, alarm: run.alarm, spotted: run.spotted };
  }));
  check('behind an unaware guard, F is a takedown', knife.offered && knife.hint === 'Takedown', knife.hint);
  check('and it is silent: no alarm, nobody spotted you', knife.dead && !knife.alarm && !knife.spotted);

  const scope = await page.evaluate(async () => {
    const s = window.spreefall;
    s.weapon.select('marksman');
    s.setAim(true);
    for (let i = 0; i < 40; i++) s.fixedForTest(1 / 60);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const on = !document.getElementById('scope').classList.contains('hidden');
    s.setAim(false);
    for (let i = 0; i < 40; i++) s.fixedForTest(1 / 60);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const off = document.getElementById('scope').classList.contains('hidden');
    return { on, off };
  });
  check('the marksman rifle aims through a scope', scope.on && scope.off);

  await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[2] || s.campaign.allSites()[0];
    s.teleport(site.x + 30, site.z + 8);
    s.look(70, -2);
    s.weapon.select('bow');
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'ops-04-bow.png') });

  // --- demons -----------------------------------------------------------------
  const demons = await page.evaluate(() => {
    const s = window.spreefall;
    s.tactics.clear();
    s.soldiers.reset(); s.drones.reset(); s.projectiles.clear();
    s.teleport(81, 0);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    const out = {};
    for (const kind of ['ghoul', 'brute', 'tyrant']) {
      const d = s.spawnDemon(kind, -30, 0);
      d.rise = 0;
      d.y = s.world.groundHeight(d.x, d.z);
      out[kind] = { health: d.health, scale: d.scale };
    }
    const gz = s.spawnDemon('gazer', -26, 8);
    out.gazer = { health: gz.health, radius: gz.radius };
    // A shot at the tyrant's head, three and a half times as high as a man's.
    const t = s.soldiers.active.find((x) => x.demon === 'tyrant');
    const eye = { x: t.x + 20, y: t.y + 1.62 * 3.5, z: t.z };
    const hit = s.soldiers.raycast(eye.x, eye.y, eye.z, -1, 0, 0, 40);
    out.headshot = !!(hit && hit.soldier === t && hit.core);
    return out;
  });
  check('three demons that walk and one that floats, the tyrant three and a half times a man',
    demons.ghoul.health > 0 && demons.brute.health > demons.ghoul.health && demons.tyrant.health >= 9000
      && demons.tyrant.scale === 3.5 && demons.gazer.health > 0 && demons.gazer.radius > 1,
    JSON.stringify(demons));
  check('and it is hit where it is drawn: a head shot at three and a half times the height', demons.headshot);

  const hunt = await page.evaluate(() => {
    const s = window.spreefall;
    let hurt = 0, fire = 0, roars = 0, maxSpeed = 0;
    const hurtWas = s.combat.hurt;
    s.combat.hurt = (d) => { hurt += d; return false; };
    const launch = s.projectiles.launch.bind(s.projectiles);
    s.projectiles.launch = (k, o) => { if (k === 'fireball') fire++; return launch(k, o); };
    const charge = s.soldiers.onCharge;
    s.soldiers.onCharge = (d) => { roars++; charge(d); };
    const brute = s.soldiers.active.find((x) => x.demon === 'brute');
    const start = s.soldiers.active.filter((x) => x.demon).map((x) => Math.hypot(x.x - s.player.x, x.z - s.player.z));
    let px = brute.x, pz = brute.z;
    for (let i = 0; i < 60 * 6; i++) {
      s.fixedForTest(1 / 60);
      maxSpeed = Math.max(maxSpeed, Math.hypot(brute.x - px, brute.z - pz) * 60);
      px = brute.x; pz = brute.z;
    }
    const end = s.soldiers.active.filter((x) => x.demon).map((x) => Math.hypot(x.x - s.player.x, x.z - s.player.z));
    s.projectiles.launch = launch;
    s.soldiers.onCharge = charge;
    s.combat.hurt = hurtWas;
    // Their fire does not hurt each other.
    const ghoul = s.soldiers.active.find((x) => x.demon === 'ghoul');
    const before = ghoul.health;
    s.projectiles.launch('fireball', { x: ghoul.x + 4, y: ghoul.y + 1.2, z: ghoul.z, vx: -30, vy: 0, vz: 0,
      splash: { radius: 3, damage: 40 }, weapon: 'demon' });
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    return { hurt: Math.round(hurt), fire, roars, maxSpeed: Math.round(maxSpeed),
      closer: end.every((d, i) => d < start[i]), friendly: ghoul.health === before };
  });
  check('they come for you, claw and burn', hunt.closer && hunt.hurt > 30 && hunt.fire >= 2,
    `${hunt.hurt} harm in six seconds, ${hunt.fire} fireballs`);
  check('the brute charges, roaring', hunt.roars >= 1 && hunt.maxSpeed >= 10, `${hunt.maxSpeed} m/s at its fastest`);
  check('and their fire does not touch another demon', hunt.friendly);
  await page.evaluate(() => {
    const s = window.spreefall;
    s.teleport(81, 0);
    s.soldiers.reset(); s.drones.reset(); s.projectiles.clear();
    s.spawnDemon('ghoul', -12, -4); s.spawnDemon('brute', -18, 5); s.spawnDemon('tyrant', -42, 0);
    s.spawnDemon('gazer', -22, -8);
    for (const x of s.soldiers.active) { x.rise = 0; x.y = s.world.groundHeight(x.x, x.z); }
    // Held still for the picture.
    s.soldiers.enabled = false; s.drones.enabled = false;
    s.look(90, 6);
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'ops-05-demons.png') });
  await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.enabled = true; s.drones.enabled = true;
    s.soldiers.reset(); s.drones.reset(); s.projectiles.clear();
  });

  // --- Slayer: nests, waves, presence, a boss --------------------------------
  const slay = await page.evaluate(() => {
    const s = window.spreefall;
    document.querySelector('.diff.mode[data-mode=slayer]').click();
    const bossesShown = !document.querySelector('#opssetup .opsslayer').classList.contains('hidden');
    s.campaign.wipe();
    s.campaign.set('scope', 'district');
    s.campaign.set('start', s.world.home);
    s.campaign.set('perDistrict', 3);
    s.campaign.set('bosses', true);
    s.startOps();
    s.state.opsTravel = false;
    s.soldiers.reset(); s.drones.reset(); s.projectiles.clear();
    s.teleport(81, 0);
    for (let i = 0; i < 90; i++) s.fixedForTest(1 / 60);
    const nests = s.campaign.allSites();
    return { mode: s.campaign.mode, bossesShown, n: nests.length,
      presence: s.slayer.presence(s.world.home) };
  });
  check('Slayer is a mode too, with bosses on its setup', slay.mode === 'slayer' && slay.bossesShown);
  check('and its nests are put down, the presence whole', slay.n >= 2 && slay.presence === 1,
    `${slay.n} nests`);

  const fightNest = (index, killAll) => page.evaluate(([index, killAll]) => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[index];
    const run = s.slayer.run(site);
    s.teleport(site.x + 50, site.z);
    const hurt = s.combat.hurt;
    s.combat.hurt = () => false;
    let woke = false, most = 0, kinds = {}, presenceMid = 1, waves = 0, lastWave = -1;
    for (let i = 0; i < 60 * 240 && site.state === 0; i++) {
      s.fixedForTest(1 / 60);
      if (run.phase !== 'idle') woke = true;
      if (run.wave !== lastWave) { waves++; lastWave = run.wave; }
      most = Math.max(most, run.demons.size);
      for (const b of run.demons) kinds[b.demon] = (kinds[b.demon] || 0) + 1;
      if (woke && i % 20 === 0) {
        if (run.killed > 6 && presenceMid === 1) presenceMid = s.slayer.presence(site.d);
        if (killAll) {
          for (const b of [...run.demons]) {
            if (b.rise > 0) continue;
            if (b.demon === 'gazer') s.drones.damage(b, 1e6);
            else if (b.demon === 'warlord') s.mechs.damage(b, 1e6);
            else s.soldiers.damage(b, 1e6, { x: 1, y: 0, z: 0 });
          }
        }
      }
    }
    s.combat.hurt = hurt;
    return { woke, free: site.state === 1, most, kinds: Object.keys(kinds), presenceMid: +presenceMid.toFixed(2),
      waves, boss: run.boss, final: run.final, killed: run.killed, total: run.total, presence: +s.slayer.presence(site.d).toFixed(2) };
  }, [index, killAll]);

  const first = await fightNest(0, true);
  check('walk up to a nest and it wakes, and they come in waves', first.woke && first.waves >= 3,
    `${first.waves} waves, ${first.kinds.join(', ')}`);
  check('never more than so many at once', first.most <= 8, `${first.most} at once`);
  check('kill them all and the nest is dead, and the presence falls', first.free && first.killed === first.total
    && first.presence < 1 && !first.boss, `${first.killed} killed, presence ${first.presence}`);

  // Run from a fight: it calls them back.
  const ran = await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[1];
    const run = s.slayer.run(site);
    s.teleport(site.x + 50, site.z);
    for (let i = 0; i < 60 * 3; i++) s.fixedForTest(1 / 60);
    const up = run.demons.size;
    s.teleport(site.x + 600, site.z);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    return { up, idle: run.phase === 'idle', left: run.demons.size, held: site.state === 0 };
  });
  check('run from a fight and the nest calls them back and waits', ran.up > 0 && ran.idle && ran.left === 0 && ran.held);

  // Every nest but the last taken by hand: the last keeps a tyrant.
  await page.evaluate(() => {
    const s = window.spreefall;
    const sites = s.campaign.allSites();
    for (let i = 1; i < sites.length - 1; i++) s.campaign.free(sites[i]);
  });
  await page.evaluate(() => {
    const s = window.spreefall;
    const sites = s.campaign.allSites();
    const site = sites[sites.length - 1];
    s.teleport(site.x + 40, site.z + 10);
    for (let i = 0; i < 60 * 4; i++) s.fixedForTest(1 / 60);
    s.soldiers.enabled = false; s.drones.enabled = false;
    s.look(80, 4);
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'ops-06-nest.png') });
  await page.evaluate(() => { const s = window.spreefall; s.soldiers.enabled = true; s.drones.enabled = true; });
  const last = await fightNest(slay.n - 1, true);
  check('with bosses on, the last nest in a district keeps a tyrant', last.boss && last.kinds.includes('tyrant'),
    last.kinds.join(', '));
  check('and the last nest of the operation keeps the Warlord after it', last.final && last.kinds.includes('warlord'),
    last.kinds.join(', '));
  check('and when it falls the district is free of them', last.free && last.presence === 0, `presence ${last.presence}`);

  // --- the Warlord -------------------------------------------------------------
  const lord = await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset(); s.drones.reset(); s.projectiles.clear();
    s.teleport(81, 0);
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    const m = s.spawnDemon('warlord', -45, 0);
    const out = { spawned: !!m };
    if (!m) return out;
    out.height = m.spec.height;
    out.boss = !!m.spec.boss;
    // Held still and its guns quiet while it is measured.
    m.spec = { ...m.spec, engage: 0, walk: 0 };
    for (let i = 0; i < 20; i++) s.fixedForTest(1 / 60);
    s.placeHealthBars();
    out.bar = !document.getElementById('bossbar').classList.contains('hidden');
    out.barName = document.getElementById('bossname').textContent;
    // A shot at the heart is the core, a shot at a leg is not.
    const eye = { x: s.player.x, y: s.player.y + 1.7, z: s.player.z };
    const ray = (p) => {
      const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
      const l = Math.hypot(dx, dy, dz);
      return s.mechs.raycast(eye.x, eye.y, eye.z, dx / l, dy / l, dz / l, 200);
    };
    const h = s.mechs.heart(m);
    const atHeart = ray(h);
    const atLeg = ray({ x: m.x, y: m.y + 1.5, z: m.z });
    out.heart = !!atHeart && atHeart.core;
    out.leg = !!atLeg && !atLeg.core;
    // And what that is worth.
    const before = m.health;
    s.mechs.damage(m, 300, true);
    out.heartHit = before - m.health;
    const mid = m.health;
    s.mechs.damage(m, 300, false);
    out.hideHit = mid - m.health;
    m.health = m.maxHealth;
    return out;
  });
  check('the Warlord comes, nine metres of it, with the long bar at the top of the screen',
    lord.spawned && lord.boss && lord.height >= 9 && lord.bar && /warlord/i.test(lord.barName),
    `${lord.height} m, ${lord.barName}`);
  check('its heart is where a shot counts, its legs are hide', lord.heart && lord.leg);
  check('and the hide takes a third of what the heart takes', lord.heartHit === 300 && Math.abs(lord.hideHit - 99) < 1,
    `${lord.heartHit} at the heart, ${lord.hideHit} on the hide`);

  // The quake: stood still it hurts, jumped it does not.
  const quake = await page.evaluate(() => {
    const s = window.spreefall;
    const m = s.mechs.active.find((x) => x.demon === 'warlord' && x.health > 0);
    const out = {};
    const hurt = s.combat.hurt;
    const ring = (jump) => {
      s.quakes.length = 0;
      s.teleport(m.x + 11, m.z);
      for (let i = 0; i < 20; i++) s.fixedForTest(1 / 60);
      let taken = 0, rings = 0, ground = 0;
      const away = Math.round(Math.hypot(s.player.x - m.x, s.player.z - m.z));
      s.combat.hurt = (amount) => { taken += amount; return false; };
      m.quakeLeft = 0.05;
      for (let i = 0; i < 60 * 3; i++) {
        if (jump) {
          for (const w of s.quakes) {
            const d = Math.hypot(s.player.x - w.x, s.player.z - w.z);
            if (Math.abs(d - w.r) < 6 && s.player.onGround) { s.player.vy = 7; s.player.onGround = false; }
          }
        }
        rings = Math.max(rings, s.quakes.length);
        if (s.player.onGround) ground++;
        s.fixedForTest(1 / 60);
      }
      return { taken, rings, away, ground, health: s.combat.health, mode: s.state.mode };
    };
    out.stood = ring(false);
    out.jumped = ring(true);
    s.combat.hurt = hurt;
    return out;
  });
  check('both hooves down send a ring along the ground that hurts where you stand',
    quake.stood.rings >= 1 && quake.stood.taken >= 55, JSON.stringify(quake.stood));
  check('and a jump clears it', quake.jumped.rings >= 1 && quake.jumped.taken === 0, JSON.stringify(quake.jumped));

  // Its phases: hurt it past two thirds and it calls its own, past a third
  // and it is angry; then down, for the points.
  const phases = await page.evaluate(() => {
    const s = window.spreefall;
    const m = s.mechs.active.find((x) => x.demon === 'warlord' && x.health > 0);
    const out = {};
    const hurt = s.combat.hurt;
    s.combat.hurt = () => false;
    const demons = () => s.soldiers.active.filter((x) => x.demon && x.health > 0).length
      + s.drones.active.filter((x) => x.demon && x.health > 0).length;
    const base = s.mechSpec.warlord.walk;
    const d0 = demons();
    m.health = m.maxHealth * 0.6;
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    out.one = { phase: m.bossPhase, called: demons() - d0, faster: m.spec.walk > base };
    const d1 = demons();
    m.health = m.maxHealth * 0.3;
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    out.two = { phase: m.bossPhase, called: demons() - d1, rage: m.rage };
    const score = s.campaign.book.score;
    const kills = s.state.warlordKills || 0;
    s.mechs.damage(m, 1e7);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    out.dead = m.health <= 0 && (s.state.warlordKills || 0) === kills + 1;
    out.points = s.campaign.book.score - score;
    s.placeHealthBars();
    out.barGone = document.getElementById('bossbar').classList.contains('hidden');
    s.combat.hurt = hurt;
    return out;
  });
  check('hurt past two thirds it calls its own and walks faster', phases.one.phase === 1 && phases.one.called >= 4
    && phases.one.faster, `${phases.one.called} called`);
  check('past a third it calls more and burns hotter', phases.two.phase === 2 && phases.two.called >= 5
    && phases.two.rage === 1, `${phases.two.called} called`);
  check('and it dies, for the points, and the bar goes', phases.dead && phases.points >= 25000 && phases.barGone,
    `+${phases.points}`);

  await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset(); s.drones.reset(); s.projectiles.clear();
    s.soldiers.enabled = false; s.drones.enabled = false;
    s.weapon.select('doublebarrel');
    s.teleport(81, 0);
    s.look(90, 8); s.camera.update(16 / 10);
    const fwd = { x: s.camera.forward[0], z: s.camera.forward[2] };
    const m = s.spawnDemon('warlord', fwd.x * 34, fwd.z * 34);
    m.spec = { ...m.spec, engage: 0, walk: 0 };
    m.health = m.maxHealth * 0.3;
    m.rage = 1;
    s.state.hurtOff = s.combat.hurt;
    s.combat.hurt = () => false;
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'ops-08-warlord.png') });
  await page.evaluate(() => {
    const s = window.spreefall;
    s.combat.hurt = s.state.hurtOff;
    s.soldiers.enabled = true; s.drones.enabled = true;
    for (const m of [...s.mechs.active]) if (m.demon === 'warlord') { m.alive = false; }
    s.mechs.active.length = 0;
  });

  // --- the Slayer weapons -----------------------------------------------------
  await page.evaluate(() => {
    const s = window.spreefall;
    document.getElementById('playbtn').click();
    s.skipToWalk();
    s.state.opsTravel = false;
    s.soldiers.reset(); s.drones.reset(); s.projectiles.clear();
    s.teleport(81, 0);
  });
  const skit = {};
  for (const k of ['Digit1', 'Digit6', 'Digit7', 'Digit8']) {
    await page.keyboard.press(k);
    skit[k] = await page.evaluate(() => window.spreefall.weapon.id);
  }
  check('in Slayer the number row is the double barrel, the shield saw, the flail and the chainsaw among the rest',
    skit.Digit1 === 'doublebarrel' && skit.Digit6 === 'shieldsaw' && skit.Digit7 === 'flail' && skit.Digit8 === 'chainsaw',
    JSON.stringify(skit));

  const melee = await page.evaluate(() => {
    const s = window.spreefall;
    const out = {};
    const eye = () => ({ x: s.player.x, y: s.player.y + 1.7, z: s.player.z });
    const put = (kind, dx, dz) => {
      const d = s.spawnDemon(kind, dx, dz);
      d.rise = 0; d.y = s.world.groundHeight(d.x, d.z);
      return d;
    };
    s.soldiers.enabled = false;
    // Facing west: two ghouls just in front, side by side, for the flail.
    s.look(90, 0); s.camera.update(16 / 10);
    const fwd = { x: s.camera.forward[0], z: s.camera.forward[2] };
    const a = put('ghoul', fwd.x * 2.5 - fwd.z * 0.8, fwd.z * 2.5 + fwd.x * 0.8);
    const b = put('ghoul', fwd.x * 2.5 + fwd.z * 0.8, fwd.z * 2.5 - fwd.x * 0.8);
    s.weapon.select('flail'); s.weapon.cooldown = 0;
    s.shoot();
    out.flail = [a.health < a.maxHealth, b.health < b.maxHealth];
    // The flail again: both low enough now to reel.
    s.weapon.cooldown = 0;
    out.reel = a.staggered > 0 || a.state === 5;
    // A finisher on one that reels, and health for it: a fresh one, brought
    // low by an ordinary hit so that it reels the way it would in a fight.
    s.soldiers.reset();
    s.combat.health = 50;
    const target = put('ghoul', fwd.x * 2.2, fwd.z * 2.2);
    target.health = target.maxHealth * 0.3;
    s.soldiers.damage(target, target.maxHealth * 0.15, { x: fwd.x, y: 0, z: fwd.z });
    const reeling = target.staggered > 0;
    const hint = reeling && s.takedownTarget() === target;
    s.takedown();
    out.finisher = { reeling, hint, dead: target.state === 5 || !target.alive, health: Math.round(s.combat.health) };
    s.soldiers.reset();
    // The chainsaw: one fuel for a ghoul, two for a brute, none for the tyrant.
    s.weapon.select('chainsaw');
    s.weapon.carried.chainsaw.ammo = 3;
    s.weapon.carried.m16.reserve = 0;
    const g = put('ghoul', fwd.x * 2, fwd.z * 2);
    s.weapon.cooldown = 0; s.shoot();
    out.sawGhoul = { dead: g.state === 5 || !g.alive, fuel: s.weapon.carried.chainsaw.ammo, rounds: s.weapon.carried.m16.reserve };
    s.soldiers.reset();
    const br = put('brute', fwd.x * 2.4, fwd.z * 2.4);
    s.weapon.cooldown = 0; s.shoot();
    out.sawBrute = { dead: br.state === 5 || !br.alive, fuel: s.weapon.carried.chainsaw.ammo };
    s.soldiers.reset();
    s.weapon.carried.chainsaw.ammo = 3;
    const ty = put('tyrant', fwd.x * 3.5, fwd.z * 3.5);
    s.weapon.cooldown = 0; s.shoot();
    out.sawTyrant = { alive: ty.state !== 5, fuel: s.weapon.carried.chainsaw.ammo };
    s.soldiers.reset();
    // Fuel comes back by itself, one pip.
    s.weapon.carried.chainsaw.ammo = 0;
    for (let i = 0; i < 60 * 16; i++) s.fixedForTest(1 / 60);
    out.fuelBack = s.weapon.carried.chainsaw.ammo;
    // The double barrel: a ghoul at four metres goes down in two.
    s.weapon.select('doublebarrel'); s.weapon.spread = 0;
    const dg = put('ghoul', fwd.x * 4, fwd.z * 4);
    s.look(90, -1); s.camera.update(16 / 10);
    for (let i = 0; i < 2 && dg.state !== 5; i++) { s.weapon.cooldown = 0; s.weapon.spread = 0; s.shoot(); }
    out.double = dg.state === 5 || !dg.alive;
    s.soldiers.reset();
    s.soldiers.enabled = true;
    return out;
  });
  check('the flail takes everything in its arc', melee.flail.every(Boolean));
  check('a demon low on its feet reels, and F finishes it for health', melee.finisher.hint && melee.finisher.dead
    && melee.finisher.health > 50, JSON.stringify(melee.finisher));
  check('the chainsaw takes a ghoul for one fuel and gives ammunition back', melee.sawGhoul.dead
    && melee.sawGhoul.fuel === 2 && melee.sawGhoul.rounds > 0, JSON.stringify(melee.sawGhoul));
  check('a brute for two, and not the tyrant at all', melee.sawBrute.dead && melee.sawBrute.fuel === 0
    && melee.sawTyrant.alive && melee.sawTyrant.fuel === 3);
  check('and the fuel comes back by itself', melee.fuelBack === 1);
  check('the double barrel puts a ghoul down at four metres', melee.double);

  const shield = await page.evaluate(() => {
    const s = window.spreefall;
    const put = (kind, dx, dz) => {
      const d = s.spawnDemon(kind, dx, dz);
      d.rise = 0; d.y = s.world.groundHeight(d.x, d.z);
      return d;
    };
    s.soldiers.enabled = false;
    s.look(90, 0); s.camera.update(16 / 10);
    const f = { x: s.camera.forward[0], z: s.camera.forward[2] };
    const a = put('ghoul', f.x * 6, f.z * 6);
    const b = put('ghoul', f.x * 11, f.z * 11);
    s.weapon.select('shieldsaw');
    s.weapon.carried.shieldsaw.ammo = 1;
    s.weapon.cooldown = 0; s.weapon.spread = 0;
    s.look(90, -4); s.camera.update(16 / 10);
    s.shoot();
    const thrown = s.weapon.carried.shieldsaw.ammo === 0;
    for (let i = 0; i < 60 * 3; i++) s.fixedForTest(1 / 60);
    const out = { thrown, both: a.health < a.maxHealth && b.health < b.maxHealth, back: s.weapon.carried.shieldsaw.ammo === 1 };
    s.soldiers.reset();
    // Held up: fire from in front does nothing to you.
    s.combat.reset();
    const before = s.combat.health + s.combat.shield;
    s.setAim(true);
    for (let i = 0; i < 40; i++) s.fixedForTest(1 / 60);
    const eye = { x: s.player.x, y: s.player.y + 1.2, z: s.player.z };
    s.projectiles.launch('fireball', { x: eye.x + f.x * 12, y: eye.y, z: eye.z + f.z * 12,
      vx: -f.x * 30, vy: 0, vz: -f.z * 30, splash: { radius: 2, damage: 30 }, weapon: 'demon' });
    for (let i = 0; i < 40; i++) s.fixedForTest(1 / 60);
    out.blocked = s.combat.health + s.combat.shield === before;
    // Raised just as it arrives: it goes back.
    s.setAim(false);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    s.projectiles.launch('fireball', { x: eye.x + f.x * 4, y: eye.y, z: eye.z + f.z * 4,
      vx: -f.x * 30, vy: 0, vz: -f.z * 30, splash: { radius: 2, damage: 30 }, weapon: 'demon' });
    s.setAim(true);
    let blast = 0;
    const launch = s.projectiles.launch.bind(s.projectiles);
    s.projectiles.launch = (k, o) => { if (k === 'blast') blast++; return launch(k, o); };
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    s.projectiles.launch = launch;
    s.setAim(false);
    out.parried = blast === 1;
    s.projectiles.clear();
    s.soldiers.enabled = true;
    return out;
  });
  check('the shield saw cuts through two in a line and comes back to the hand',
    shield.thrown && shield.both && shield.back, JSON.stringify(shield));
  check('held up it stops fire from in front, and raised just in time it sends it back',
    shield.blocked && shield.parried);

  await page.evaluate(() => {
    const s = window.spreefall;
    s.weapon.select('doublebarrel');
    s.look(90, 2);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'ops-07-doublebarrel.png') });

  // --- the memorial: broken from inside its field, whole again outside -------
  const memorial = await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.enabled = false; s.drones.enabled = false; s.soldiers.reset(); s.drones.reset();
    s.projectiles.clear();
    const f = s.combat.sanctuaries[0];
    if (!f) return null;
    const step = (n) => { for (let i = 0; i < n; i++) s.fixedForTest(1 / 60); };
    // How much stone stands under the field, and the ground at one point.
    const stone = () => {
      let h = 0;
      s.world.forEachSegmentTile(f.x - 70, f.z - 70, f.x + 70, f.z + 70, (segs, count) => {
        for (let i = 0; i < count; i++) {
          const o = i * 6;
          const mx = (segs[o] + segs[o + 2]) / 2, mz = (segs[o + 1] + segs[o + 3]) / 2;
          if (Math.hypot(mx - f.x, mz - f.z) < 60) h += segs[o + 5] - segs[o + 4];
        }
      });
      return h;
    };
    const at = [f.x + 22, f.z + 14];
    const ground = () => s.world.groundHeight(at[0], at[1]);
    const shells = () => {
      for (const [dx, dz] of [[22, 14], [-18, 20], [10, -24], [26, -6], [22, 14]]) {
        const x = f.x + dx, z = f.z + dz;
        s.explode(x, s.world.groundHeight(x, z) + 1, z, { radius: 16, damage: 1600 }, { weapon: 'rpg' });
      }
    };
    const out = {};
    const stone0 = stone(), ground0 = ground();
    // From outside the field holds.
    s.teleport(f.x, f.z + f.radius + 40);
    step(10);
    shells();
    step(60 * 8);
    out.outside = { stone: +(stone() / stone0).toFixed(4), ground: +(ground() - ground0).toFixed(2), open: !!s.combat.fieldOpen };
    // Inside it opens, and the same shells break it.
    s.teleport(f.x - 10, f.z - 10);
    step(10);
    out.opened = !!s.combat.fieldOpen;
    shells();
    step(60 * 12);
    out.inside = { stone: +(stone() / stone0).toFixed(4), ground: +(ground() - ground0).toFixed(2),
      held: s.demolition.sites.filter((x) => !x.spared).length };
    // Out again: it closes, and all of it is put back.
    const restored = s.state.memorialRestored || 0;
    s.teleport(f.x, f.z + f.radius + 40);
    step(10);
    out.closed = { open: !!s.combat.fieldOpen, restored: (s.state.memorialRestored || 0) - restored,
      stone: +(stone() / stone0).toFixed(4), ground: +(ground() - ground0).toFixed(2) };
    // And in again it is still whole.
    s.teleport(f.x - 10, f.z - 10);
    step(60 * 3);
    out.back = { open: !!s.combat.fieldOpen, stone: +(stone() / stone0).toFixed(4),
      ground: +(ground() - ground0).toFixed(2) };
    out.field = { x: f.x, z: f.z, r: f.radius };
    return out;
  });
  check('the memorial field holds against everything from outside',
    !!memorial && memorial.outside.stone === 1 && memorial.outside.ground === 0 && !memorial.outside.open,
    JSON.stringify(memorial && memorial.outside));
  check('stand inside and it opens, and the stelae can be broken',
    !!memorial && memorial.opened && memorial.inside.stone < 0.995 && memorial.inside.held > 0,
    JSON.stringify(memorial && memorial.inside));
  check('step out and the memorial stands again, stone and ground',
    !!memorial && !memorial.closed.open && memorial.closed.restored === 1 && memorial.closed.stone === 1
      && memorial.closed.ground === 0, JSON.stringify(memorial && memorial.closed));
  check('and walking back in finds it whole', !!memorial && memorial.back.open && memorial.back.stone === 1
    && memorial.back.ground === 0, JSON.stringify(memorial && memorial.back));

  // The pictures: broken from inside, then whole again after a step outside.
  const shellsInside = () => page.evaluate(() => {
    const s = window.spreefall;
    const f = s.combat.sanctuaries[0];
    s.teleport(f.x - 40, f.z + 35);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    for (const [dx, dz] of [[0, 0], [8, -8], [-6, -4], [4, 6], [14, -16], [-2, -14], [10, 2], [-14, 10]]) {
      const x = f.x + dx, z = f.z + dz;
      s.explode(x, s.world.groundHeight(x, z) + 1, z, { radius: 26, damage: 4000 }, { weapon: 'rpg' });
    }
    for (let i = 0; i < 60 * 8; i++) s.fixedForTest(1 / 60);
    s.look(-45, -6);
  });
  await shellsInside();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(SHOTS, 'ops-10-memorial-broken.png') });
  await page.evaluate(() => {
    const s = window.spreefall;
    const f = s.combat.sanctuaries[0];
    s.teleport(f.x, f.z + f.radius + 40);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    s.teleport(f.x - 40, f.z + 35);
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    s.look(-45, -6);
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'ops-11-memorial-whole.png') });

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
