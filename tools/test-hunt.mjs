// The Hunt: the mode on the title card, the hunting grounds, and the suit.
//
// What is checked is what the suit is for: the cloak keeps a guard who is
// looking straight at you from seeing you, a gun fired from it puts you back
// in sight with nothing left in the suit where the bow does not, the armour
// takes a hit into the energy instead of into you, and the sprint, the held
// jump and the punch each do more than the same thing without the suit.
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

  // --- the title card and a run -------------------------------------------------
  const start = await page.evaluate(async () => {
    const s = window.spreefall;
    document.querySelector('.diff.mode[data-mode=hunt]').click();
    const lit = [...document.querySelectorAll('.diff.mode.on')].map((b) => b.dataset.mode);
    const note = document.getElementById('modenote').textContent;
    s.campaign.wipe();
    s.campaign.set('scope', 'district');
    s.campaign.set('start', s.world.home);
    s.campaign.set('perDistrict', 4);
    document.getElementById('playbtn').click();
    s.skipToWalk();
    s.tiles.uploadsPerFrame = 500;
    s.setQuality('low');
    s.startOps();
    s.state.opsTravel = false;
    for (let i = 0; i < 90; i++) s.fixedForTest(1 / 60);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { lit, note, mode: s.campaign.mode, sites: s.campaign.allSites().length, camps: s.tactics.enabled,
      weapon: s.weapon.id, kit: s.weapon.kit && s.weapon.kit.join(' '), hud: document.getElementById('ops').textContent,
      suit: !document.getElementById('suit').classList.contains('hidden') };
  });
  check('The Hunt is a mode on the title card, with its own note',
    start.lit.length === 1 && start.lit[0] === 'hunt' && /suit/.test(start.note), start.note.slice(0, 60));
  check('a run puts hunting grounds in the district, held the way camps are',
    start.mode === 'hunt' && start.sites >= 2 && start.camps && /the hunt/i.test(start.hud) && /grounds/.test(start.hud),
    start.hud);
  check('you start in the suit with the bow in your hands',
    start.suit && start.weapon === 'bow' && start.kit.startsWith('bow'), `${start.weapon}; ${start.kit}`);

  // A guard put in front of you, looking at you, for the cloak.
  const guard = () => page.evaluate(() => {
    const s = window.spreefall;
    s.tactics.clear();
    s.campaign.reset({});
    s.suit.reset();
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    s.teleport(site.x + 60, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    const g = run.guards.find((x) => x.sentry) || run.guards[0];
    for (const o of run.guards) if (o !== g) s.soldiers._retire(o);
    run.guards = [g];
    g.sentry = true;
    window.huntGuard = { g, run };
    const fx = -Math.sin(g.yaw), fz = -Math.cos(g.yaw);
    s.teleport(g.x + fx * 22, g.z + fz * 22);
    s.player.vx = 0; s.player.vz = 0;
    return true;
  });

  // --- the cloak ------------------------------------------------------------------
  await guard();
  await page.keyboard.press('KeyE');
  const cloaked = await page.evaluate(async () => {
    const s = window.spreefall;
    const { g, run } = window.huntGuard;
    const hurt = s.combat.hurt;
    s.combat.hurt = () => false;
    for (let i = 0; i < 60 * 6; i++) s.fixedForTest(1 / 60);
    // The edge of the screen is drawn with the frame.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = { cloak: s.suit.cloak, hidden: s.suit.hidden, suspicion: +g.suspicion.toFixed(2), spotted: run.spotted,
      fx: document.getElementById('suitfx').className };
    // Walking straight into him, he knows.
    const fx = -Math.sin(g.yaw), fz = -Math.cos(g.yaw);
    s.teleport(g.x + fx * 1.5, g.z + fz * 1.5);
    for (let i = 0; i < 60 * 3; i++) s.fixedForTest(1 / 60);
    out.bumped = +g.suspicion.toFixed(2);
    s.combat.hurt = hurt;
    return out;
  });
  check('cloaked, a guard looking straight at you from twenty metres does not see you',
    cloaked.cloak && cloaked.hidden && cloaked.suspicion === 0 && !cloaked.spotted && cloaked.fx === 'cloak',
    JSON.stringify(cloaked));
  check('but walk into him and he knows you are there', cloaked.bumped > 0.3, `${cloaked.bumped}`);

  await guard();
  const bare = await page.evaluate(() => {
    const s = window.spreefall;
    const { g, run } = window.huntGuard;
    const hurt = s.combat.hurt;
    s.combat.hurt = () => false;
    let sure = -1;
    for (let i = 0; i < 60 * 8 && sure < 0; i++) { s.fixedForTest(1 / 60); if (run.spotted) sure = i / 60; }
    s.combat.hurt = hurt;
    return { sure: +sure.toFixed(1) };
  });
  check('and the same guard without the cloak is sure of you within seconds', bare.sure > 0, `${bare.sure} s`);

  // --- shots from the cloak -----------------------------------------------------
  await guard();
  await page.keyboard.press('KeyE');
  const shots = await page.evaluate(() => {
    const s = window.spreefall;
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    s.look(0, 10);
    s.weapon.select('bow');
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    const before = s.suit.energy;
    s.weapon.cooldown = 0;
    s.shoot();
    const bow = { cloak: s.suit.cloak, cost: +(before - s.suit.energy).toFixed(1) };
    s.weapon.select('m16');
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    s.weapon.cooldown = 0;
    s.shoot();
    const gun = { cloak: s.suit.cloak, energy: Math.round(s.suit.energy) };
    s.weapon.select('bow');
    return { bow, gun };
  });
  check('the bow fires from the cloak for a slice of the energy and leaves it up',
    shots.bow.cloak && Math.abs(shots.bow.cost - 22) < 3, JSON.stringify(shots.bow));
  check('a rifle fired from it drops the cloak and empties the suit',
    !shots.gun.cloak && shots.gun.energy === 0, JSON.stringify(shots.gun));

  // --- armour -----------------------------------------------------------------------
  await page.evaluate(() => {
    const s = window.spreefall;
    s.suit.reset();
    s.combat.reset();
    s.setCheat('godmode', false);
  });
  await page.keyboard.press('KeyQ');
  const armour = await page.evaluate(() => {
    const s = window.spreefall;
    const out = { armor: s.suit.armor };
    const take = () => {
      const h0 = s.combat.health + s.combat.shield;
      s.combat.hurt(40, s.player.x + 5, s.player.z, s.player.x, s.player.z);
      return +(h0 - s.combat.health - s.combat.shield).toFixed(1);
    };
    const e0 = s.suit.energy;
    out.withArmor = take();
    out.energy = +(e0 - s.suit.energy).toFixed(1);
    s.suit.armor = false;
    out.without = take();
    s.combat.reset();
    return out;
  });
  check('armour takes most of a hit into the energy instead of into you',
    armour.armor && armour.withArmor < armour.without * 0.3 && armour.energy > 10, JSON.stringify(armour));

  // --- sprint, the held jump, the punch ---------------------------------------------
  const body = await page.evaluate(() => {
    const s = window.spreefall;
    s.suit.reset();
    s.tactics.clear();
    s.soldiers.reset();
    s.teleport(81, 0);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    s.look(90, 0);
    const go = (sprint) => {
      s.teleport(81, 0);
      for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
      s.suit.reset();
      const x0 = s.player.x, z0 = s.player.z;
      s.input.keys.add('KeyW');
      if (sprint) s.input.keys.add('ShiftLeft');
      for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
      s.input.keys.delete('KeyW');
      s.input.keys.delete('ShiftLeft');
      return { d: Math.hypot(s.player.x - x0, s.player.z - z0), energy: s.suit.energy };
    };
    const walk = go(false);
    const sprint = go(true);
    // A jump, tapped and then held.
    const jump = (hold) => {
      s.teleport(81, 0);
      for (let i = 0; i < 20; i++) s.fixedForTest(1 / 60);
      s.suit.reset();
      const y0 = s.player.y;
      let top = y0;
      s.input.keys.add('Space');
      s.input.jumpHeld = true;
      s.input.jumpQueued = true;
      for (let i = 0; i < 90; i++) {
        if (!hold && i === 2) { s.input.keys.delete('Space'); s.input.jumpHeld = false; }
        s.fixedForTest(1 / 60);
        top = Math.max(top, s.player.y);
      }
      s.input.keys.delete('Space');
      s.input.jumpHeld = false;
      return +(top - y0).toFixed(2);
    };
    const tap = jump(false);
    const held = jump(true);
    return { walk: +walk.d.toFixed(1), sprint: +sprint.d.toFixed(1), sprintCost: +(100 - sprint.energy).toFixed(1), tap, held,
      powerJumps: s.state.powerJumps || 0 };
  });
  check('Shift is the suit\'s sprint: well past a run, on energy',
    body.sprint > body.walk * 1.5 && body.sprintCost > 5, JSON.stringify(body));
  check('Space held goes much higher than a tap', body.tap > 0.3 && body.held > body.tap * 2 && body.powerJumps >= 1,
    JSON.stringify(body));

  const punch = await page.evaluate(() => {
    const s = window.spreefall;
    s.suit.reset();
    s.soldiers.reset();
    s.teleport(81, 0);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    s.look(90, 0);
    const fx = -Math.sin(s.camera.yaw), fz = -Math.cos(s.camera.yaw);
    const t = s.spawnSoldier(0, 0);
    if (!t) return { skip: true };
    t.x = s.player.x + fx * 1.8; t.z = s.player.z + fz * 1.8; t.y = s.player.y; t.rise = 0;
    t.state = 1;
    const e0 = s.suit.energy;
    const hit = s.suitPunch();
    return { hit, dead: t.health <= 0 || t.state === 5, cost: +(e0 - s.suit.energy).toFixed(1) };
  });
  check('F punches with the suit\'s strength, for energy', !punch.skip && punch.hit && punch.dead && punch.cost >= 25,
    JSON.stringify(punch));

  // The picture: cloaked, a guard in front of you who has no idea.
  await guard();
  await page.keyboard.press('KeyE');
  await page.evaluate(() => {
    const s = window.spreefall;
    const { g } = window.huntGuard;
    for (let i = 0; i < 40; i++) s.fixedForTest(1 / 60);
    const dx = g.x - s.player.x, dz = g.z - s.player.z;
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, -2);
    s.weapon.select('bow');
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'hunt-01-cloak.png') });

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
