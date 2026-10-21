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
    const g = run.guards[0];
    s.tactics.spot(g, 'seen');
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    s.soldiers.damage(g, 9999, { x: 1, y: 0, z: 0 });
    for (let i = 0; i < 60 * 4; i++) s.fixedForTest(1 / 60);
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
