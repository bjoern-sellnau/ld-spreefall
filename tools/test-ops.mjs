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
