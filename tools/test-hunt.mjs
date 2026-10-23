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

  // --- by the throat, and thrown ------------------------------------------------------
  const thrown = await page.evaluate(() => {
    const s = window.spreefall;
    s.suit.reset();
    s.soldiers.reset();
    s.soldiers.enabled = false;
    s.projectiles.clear();
    s.teleport(81, 0);
    // Parked at random on every load, and a jeep on the line would take the throw.
    for (const v of [...s.vehicles.active]) {
      if (Math.hypot(v.x - s.player.x, v.z - s.player.z) < 60) s.vehicles.remove(v);
    }
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    // Level, and the camera's own vectors brought up to date: the throw goes
    // where the camera points, and that is only worked out when it is drawn.
    s.look(90, 0); s.camera.update(16 / 9);
    const fx = -Math.sin(s.camera.yaw), fz = -Math.cos(s.camera.yaw);
    const put = (d) => {
      const t = s.spawnSoldier(0, 0);
      t.x = s.player.x + fx * d; t.z = s.player.z + fz * d; t.y = s.world.groundHeight(t.x, t.z); t.rise = 0;
      t.state = 1;
      return t;
    };
    const g = put(1.8);
    const other = put(9);
    const e0 = s.suit.energy;
    const took = s.suitGrab();
    const out = { took, held: s.grab.held === g, cost: +(e0 - s.suit.energy).toFixed(1) };
    // Held: in front of you and off his feet, and he fires nothing.
    const shotsBefore = s.combat.health;
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    out.ahead = +Math.hypot(g.x - s.player.x, g.z - s.player.z).toFixed(2);
    out.up = +(g.y - s.world.groundHeight(g.x, g.z)).toFixed(2);
    out.holstered = s.weapon.holstered;
    out.unhurt = s.combat.health >= shotsBefore;
    // The trigger held for a full wind-up, then let go.
    s.input.fire = true;
    for (let i = 0; i < 70; i++) s.fixedForTest(1 / 60);
    out.charge = +s.grab.charge.toFixed(2);
    s.input.fire = false;
    s.fixedForTest(1 / 60);
    // The man behind has not stood still for the wind-up: put him back on
    // the line, eight metres out.
    other.x = s.player.x + fx * 8; other.z = s.player.z + fz * 8; other.y = s.world.groundHeight(other.x, other.z);
    out.flying = s.grab.flying.length;
    out.free = !s.grab.held;
    for (let i = 0; i < 300 && s.grab.flying.length; i++) s.fixedForTest(1 / 60);
    out.landed = s.grab.flying.length === 0;
    out.gDead = g.health <= 0 || g.state === 5 || !g.alive;
    out.otherHurt = other.health < 100 || other.state === 5 || !other.alive;
    out.hits = s.state.thrownHits || 0;
    out.what = s.state.thrownWhat;
    out.flew = +Math.hypot(g.x - s.player.x, g.z - s.player.z).toFixed(1);
    s.soldiers.enabled = true;
    return out;
  });
  check('F takes a man in reach by the throat and holds him up in front of you, gun away',
    thrown.took && thrown.held && thrown.cost >= 10 && thrown.ahead < 1.6 && thrown.up > 0.1 && thrown.holstered && thrown.unhurt,
    JSON.stringify(thrown));
  check('the trigger held winds up a throw, and he goes through the man behind him',
    thrown.charge >= 0.99 && thrown.free && thrown.landed && thrown.gDead && thrown.otherHurt && thrown.hits >= 1 && thrown.flew > 6,
    JSON.stringify(thrown));

  // A picture of one held up, the street behind him.
  await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.enabled = false;
    s.look(90, -4);
    const fx = -Math.sin(s.camera.yaw), fz = -Math.cos(s.camera.yaw);
    const t = s.spawnSoldier(0, 0);
    t.x = s.player.x + fx * 1.6; t.z = s.player.z + fz * 1.6; t.y = s.world.groundHeight(t.x, t.z); t.rise = 0;
    s.suit.reset();
    s.suitGrab();
    for (let i = 0; i < 20; i++) s.fixedForTest(1 / 60);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'hunt-06-grab.png') });
  await page.evaluate(() => { const s = window.spreefall; s.suitGrab(); s.soldiers.enabled = true; });

  // --- a grenade off the belt -----------------------------------------------------------
  await page.evaluate(() => {
    const s = window.spreefall;
    s.projectiles.clear();
    s.weapon.select('bow');
    s.weapon.quickCooldown = 0;
    window.huntGren = s.weapon.grenadesLeft;
  });
  await page.keyboard.press('KeyG');
  const gren = await page.evaluate(() => {
    const s = window.spreefall;
    return { before: window.huntGren, after: s.weapon.grenadesLeft, weapon: s.weapon.id, inAir: s.projectiles.count,
      holstered: !!s.state.holstered };
  });
  check('G in the suit throws a grenade without putting the bow away',
    gren.after === gren.before - 1 && gren.weapon === 'bow' && gren.inAir >= 1 && !gren.holstered, JSON.stringify(gren));
  await page.evaluate(() => window.spreefall.projectiles.clear());

  // --- the visor and Nano Vision ----------------------------------------------------
  // A guard who will not see you, in the middle of the screen, twenty metres off.
  const lookAtGuard = () => page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.stealth = { range: 0, cone: 2, near: 0, fill: 0, decay: 1, run: 1 };
    window.huntHurt = s.combat.hurt;
    s.combat.hurt = () => false;
    const { g } = window.huntGuard;
    const ex = s.player.x, ey = s.player.y + 1.7, ez = s.player.z;
    const dx = g.x - ex, dy = g.y + 1.1 - ey, dz = g.z - ez;
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI);
    g.vx = 0; g.vz = 0;
    return Math.round(Math.hypot(dx, dz));
  });
  await guard();
  await lookAtGuard();
  const fov0 = await page.evaluate(() => window.spreefall.camera.fov);
  await page.keyboard.press('KeyB');
  const visor = await page.evaluate(async () => {
    const s = window.spreefall;
    // The scan counts at most a tenth of a second a frame, so on a slow
    // renderer it is frames that have to pass, not a second and a half.
    for (let i = 0; i < 240 && !s.visor.tags.has(window.huntGuard.g); i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    const out = { up: s.visor.up, fov: s.camera.fov, tags: s.visor.tags.size, tagged: s.visor.tags.has(window.huntGuard.g),
      drawn: s.visor.last ? s.visor.last.drawnTags : 0 };
    return out;
  });
  await page.screenshot({ path: path.join(SHOTS, 'hunt-02-visor.png') });
  await page.keyboard.press('KeyB');
  const throughWalls = await page.evaluate(async () => {
    const s = window.spreefall;
    // Nothing in sight anywhere: the tag is still drawn over him.
    const los = s.world.lineOfSight;
    s.world.lineOfSight = () => false;
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    const out = { up: s.visor.up, drawn: s.visor.last ? s.visor.last.drawnTags : 0 };
    s.world.lineOfSight = los;
    return out;
  });
  check('B puts the visor up, narrows the view, and holding a guard in the middle tags him',
    visor.up && visor.fov < fov0 && visor.tagged && visor.drawn >= 1, JSON.stringify({ ...visor, fov0 }));
  check('the tag stays over him with the visor down, and through walls', !throughWalls.up && throughWalls.drawn >= 1,
    JSON.stringify(throughWalls));

  await page.keyboard.press('KeyN');
  const nano = await page.evaluate(async () => {
    const s = window.spreefall;
    // Frames rather than a wait on the clock, for the same reason as the scan.
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
    const out = { on: s.suit.nano, filtered: document.getElementById('view').classList.contains('nano'),
      warm: s.visor.last ? s.visor.last.warm : 0, energy: Math.round(s.suit.energy) };
    return out;
  });
  await page.screenshot({ path: path.join(SHOTS, 'hunt-03-nano.png') });
  check('N is Nano Vision: the city goes cold, the guard shows warm, and it costs energy',
    nano.on && nano.filtered && nano.warm >= 1 && nano.energy < 100, JSON.stringify(nano));
  await page.keyboard.press('KeyN');
  await page.evaluate(() => {
    const s = window.spreefall;
    s.combat.hurt = window.huntHurt;
    s.soldiers.stealth = s.tacticsSpec.stealth;
  });

  // --- the two bows ---------------------------------------------------------------------
  // In The Hunt the bow in your hands is the tech bow; the cheat menu can put
  // the tactic bow there instead, or either everywhere.
  const bows = {};
  await page.evaluate(() => {
    const s = window.spreefall;
    s.teleport(81, 0); s.look(95, -6);
    s.weapon.select('bow');
    s.state.holstered = false;
  });
  await page.waitForTimeout(1200);
  bows.hunt = await page.evaluate(() => ({ model: window.spreefall.renderer.viewmodel.weapon,
    label: document.getElementById('weaponname').textContent }));
  await page.screenshot({ path: path.join(SHOTS, 'hunt-07-tech-bow.png') });
  await page.evaluate(() => window.spreefall.cheatMenu(true));
  await page.click('[data-bow="tactic"]');
  await page.evaluate(() => window.spreefall.cheatMenu(false));
  await page.waitForTimeout(1200);
  bows.chosen = await page.evaluate(() => ({ model: window.spreefall.renderer.viewmodel.weapon,
    label: document.getElementById('weaponname').textContent }));
  await page.screenshot({ path: path.join(SHOTS, 'hunt-08-tactic-bow.png') });
  await page.evaluate(() => window.spreefall.cheatMenu(true));
  await page.click('[data-bow="mode"]');
  // The menu holsters the weapon while it is up, and gives it back a frame
  // after it closes.
  await page.evaluate(() => { window.spreefall.cheatMenu(false); document.activeElement.blur(); });
  await page.waitForTimeout(400);
  // Held flat by default, on its side with the arrow on top, or upright and
  // left of the crosshair from the menu; either way with the arrow along the
  // line of sight, so it points at the crosshair. The pose as set, from the
  // hip and aimed: the turn of the head sways it about for a moment, which
  // is not how it is held.
  bows.pose = await page.evaluate(async () => {
    const s = window.spreefall;
    const { hold, aimHold, flatHold, flatAim } = s.weapon.spec;
    const flatRoll = +s.renderer.viewmodel.roll.toFixed(2);
    const flatHeld = s.cheats.bowHold;
    s.cheatMenu(true);
    document.querySelector('[data-bowhold="upright"]').click();
    s.cheatMenu(false);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    const uprightX = +s.renderer.viewmodel.x.toFixed(3);
    s.cheatMenu(true);
    document.querySelector('[data-bowhold="flat"]').click();
    s.cheatMenu(false);
    document.activeElement.blur();
    return { flatHeld, flatRoll, uprightX, hold, aimHold, flatHold, flatAim };
  });
  const along = (p) => p && p.yaw === 0 && p.pitch === 0;
  const upright = (p) => along(p) && p.x < -0.05 && p.roll > 0 && p.roll < 0.3;
  const flat = (p) => along(p) && p.roll > 1.3 && p.roll < 1.65 && p.y < -0.04 && Math.abs(p.x) < 0.03;
  check('the bow is held flat with the arrow on top, or upright from the menu, its arrow along the line of sight either way',
    bows.pose.flatHeld === 'flat' && bows.pose.flatRoll > 1.3 && bows.pose.uprightX < -0.05
      && upright(bows.pose.hold) && upright(bows.pose.aimHold) && flat(bows.pose.flatHold) && flat(bows.pose.flatAim),
    JSON.stringify(bows.pose));
  check('in The Hunt the bow is the tech bow, and the cheat menu can hand you the tactic bow instead',
    bows.hunt.model === 'bowTech' && /TECH BOW/.test(bows.hunt.label)
      && bows.chosen.model === 'bowTactic' && /TACTIC BOW/.test(bows.chosen.label), JSON.stringify(bows));

  // --- the bow: draw weights and the shock head ---------------------------------------
  await page.evaluate(() => { const s = window.spreefall; s.weapon.select('bow'); s.weapon.drawWeight = 0; s.weapon.arrowHead = 0; });
  const draws = [];
  for (let i = 0; i < 3; i++) {
    draws.push(await page.evaluate(() => {
      const s = window.spreefall;
      s.weapon.cooldown = 0;
      s.weapon.ammo = 1;
      s.weapon.state = 0;
      s.look(0, 30);
      s.shoot();
      return { draw: s.weapon.draw, label: document.getElementById('weaponname').textContent, cooldown: +s.weapon.cooldown.toFixed(2) };
    }));
    await page.keyboard.press('KeyX');
  }
  check('X changes the draw weight: medium, strong, light, with the time between arrows to match',
    draws.map((d) => d.draw).join(',') === 'medium,strong,light' && /STRONG/.test(draws[1].label)
      && draws[1].cooldown > draws[0].cooldown && draws[2].cooldown < draws[0].cooldown, JSON.stringify(draws));

  const shock = await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset();
    s.teleport(81, 0);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    s.soldiers.stealth = { range: 0, cone: 2, near: 0, fill: 0, decay: 1, run: 1 };
    const put = (dx, dz) => {
      const g = s.spawnSoldier(dx, dz);
      g.state = 0; g.rise = 0; g.y = s.world.groundHeight(g.x, g.z);
      return g;
    };
    const a = put(-20, 30), b = put(-17, 31), far = put(10, 30);
    a.health = b.health = far.health = 400;
    s.projectiles.launch('arrow', { x: a.x + 1.5, y: a.y + 3, z: a.z, vx: 0, vy: -40, vz: 0, weapon: 'bow', head: 'shock' });
    for (let i = 0; i < 12; i++) s.fixedForTest(1 / 60);
    const down = (g) => g.state === 4 || g.state === 5 || !g.alive;
    const out = { a: down(a), b: down(b), far: down(far), hurt: a.health < 400 && b.health < 400, farHurt: far.health < 400 };
    s.soldiers.stealth = s.tacticsSpec.stealth;
    s.soldiers.reset();
    return out;
  });
  check('a shock arrow puts down and hurts the two beside where it lands, and not the one twenty metres off',
    shock.a && shock.b && shock.hurt && !shock.far && !shock.farHurt, JSON.stringify(shock));

  // --- theirs, at the grounds ---------------------------------------------------------
  const ceph = await page.evaluate(() => {
    const s = window.spreefall;
    // The arrows from the draw check are still in the air, and one into a
    // ground's alarm box tells the ground.
    s.projectiles.clear();
    s.tactics.clear();
    s.campaign.reset({});
    s.soldiers.reset();
    s.mechs.reset();
    s.suit.reset();
    const sites = s.campaign.allSites();
    const site = sites[1] || sites[0];
    site.level = 0;
    // Not the last one held in the district, so no walker for this check.
    s.teleport(site.x + 60, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    const grunts = run.guards.filter((g) => g.ceph === 'grunt' && g.look === 5);
    const stalkers = run.guards.filter((g) => g.demon === 'stalker');
    const out = { guards: run.guards.length, grunts: grunts.length, stalkers: stalkers.length,
      dormant: stalkers.every((g) => g.dormant), alpha: !!run.alpha, gruntHp: grunts[0] ? grunts[0].health : 0 };
    // Cloaked and twenty metres off it does not stir.
    const st = stalkers[0];
    const hurt = s.combat.hurt;
    s.combat.hurt = () => false;
    s.suit.toggleCloak();
    // Up in full before going near: it takes a moment, and he would see that.
    for (let i = 0; i < 40; i++) s.fixedForTest(1 / 60);
    s.teleport(st.x + 18, st.z);
    const at0 = { x: st.x, z: st.z };
    for (let i = 0; i < 60 * 3; i++) s.fixedForTest(1 / 60);
    out.stillDormant = st.dormant;
    out.wokeBy = st.wokeBy || null;
    out.hp = Math.round(st.health);
    out.stayed = Math.round(Math.hypot(st.x - at0.x, st.z - at0.z));
    // The alarm, and it comes.
    s.tactics.raiseAlarm(run);
    const d0 = Math.hypot(st.x - s.player.x, st.z - s.player.z);
    for (let i = 0; i < 60 * 2; i++) s.fixedForTest(1 / 60);
    out.woke = !st.dormant;
    out.closed = Math.round(d0 - Math.hypot(st.x - s.player.x, st.z - s.player.z));
    s.combat.hurt = hurt;
    return out;
  });
  check('a hunting ground holds men in black, grunts of theirs among them, and stalkers waiting by the middle',
    ceph.grunts >= 1 && ceph.stalkers >= 1 && ceph.dormant && ceph.gruntHp >= 300 && !ceph.alpha, JSON.stringify(ceph));
  check('a stalker waits through a cloaked man nearby, and comes when the alarm goes',
    ceph.stillDormant && ceph.stayed <= 2 && ceph.woke && ceph.closed > 5, JSON.stringify(ceph));

  const blow = await page.evaluate(() => {
    const s = window.spreefall;
    s.soldiers.reset();
    s.suit.reset();
    s.combat.reset();
    s.teleport(81, 0);
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    const t = s.spawnSoldier(0, 0);
    if (!t) return { skip: true };
    s.makeDemon(t, 'stalker', 0);
    t.x = s.player.x + 1.4; t.z = s.player.z; t.y = s.player.y; t.rise = 0; t.meleeLeft = 0;
    const y0 = s.player.y, launched = s.state.launched || 0, h0 = s.combat.health + s.combat.shield;
    let top = y0;
    for (let i = 0; i < 40; i++) { s.fixedForTest(1 / 60); top = Math.max(top, s.player.y); }
    return { launched: (s.state.launched || 0) - launched, rose: +(top - y0).toFixed(2), hurt: h0 - s.combat.health - s.combat.shield };
  });
  check('a stalker\'s blow hurts and lifts you off your feet', !blow.skip && blow.launched >= 1 && blow.rose > 1 && blow.hurt > 0,
    JSON.stringify(blow));

  const alpha = await page.evaluate(() => {
    const s = window.spreefall;
    s.tactics.clear();
    s.campaign.reset({});
    s.soldiers.reset();
    s.mechs.reset();
    s.suit.reset();
    s.combat.reset();
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    site.level = 1;
    s.teleport(site.x + 45, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const run = s.tactics.live.get(site.id);
    const out = { alpha: !!run.alpha, pinger: !!(run.alpha && run.alpha.pinger) };
    if (!run.alpha) return out;
    // The ping: armour on, inside its reach.
    s.suit.toggleArmor();
    const m = run.alpha;
    s.teleport(m.x + 30, m.z);
    const pings = s.state.pings || 0;
    const hurt = s.combat.hurt;
    let hits = 0;
    s.combat.hurt = (...a) => { hits++; return hurt.apply(s.combat, a); };
    for (let i = 0; i < 60 * 8 && (s.state.pings || 0) === pings; i++) s.fixedForTest(1 / 60);
    out.pinged = (s.state.pings || 0) - pings;
    out.energy = Math.round(s.suit.energy);
    out.armor = s.suit.armor;
    s.combat.hurt = hurt;
    // Every man and alien down, and the ground is still held while the walker stands.
    for (const g of run.guards) s.soldiers.damage(g, 1e6, { x: 1, y: 0, z: 0 });
    for (let i = 0; i < 10; i++) s.fixedForTest(1 / 60);
    out.heldWithAlpha = site.state;
    s.mechs.damage(m, 1e7, true);
    for (let i = 0; i < 60 * 3; i++) s.fixedForTest(1 / 60);
    out.freedAfter = site.state;
    site.level = 0;
    return out;
  });
  check('from level one a walker of theirs stands over the ground', alpha.alpha && alpha.pinger, JSON.stringify(alpha));
  check('its ping empties the suit, armour and all', alpha.pinged >= 1 && alpha.energy === 0 && !alpha.armor,
    JSON.stringify(alpha));
  check('and the ground is not clear until the walker is down too', alpha.heldWithAlpha === 0 && alpha.freedAfter === 1,
    JSON.stringify(alpha));

  // The picture: a grunt and a stalker at a ground.
  await page.evaluate(() => {
    const s = window.spreefall;
    s.tactics.clear();
    s.campaign.reset({});
    s.soldiers.reset();
    s.mechs.reset();
    s.suit.reset();
    const site = s.campaign.allSites()[2] || s.campaign.allSites()[0];
    site.level = 0;
    s.teleport(site.x + 40, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    s.soldiers.stealth = { range: 0, cone: 2, near: 0, fill: 0, decay: 1, run: 1 };
    const run = s.tactics.live.get(site.id);
    const st = run.guards.find((g) => g.demon === 'stalker');
    const gr = run.guards.find((g) => g.ceph === 'grunt');
    const a = st || gr;
    if (gr && st) { gr.x = st.x + 2.5; gr.z = st.z + 1; gr.state = 0; gr.vx = gr.vz = 0; }
    s.teleport(a.x + 9, a.z + 4);
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    const dx = a.x - s.player.x, dz = a.z - s.player.z;
    s.look(Math.atan2(-dx, -dz) * 180 / Math.PI, -4);
    s.soldiers.enabled = false;
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'hunt-04-ceph.png') });
  await page.evaluate(() => { const s = window.spreefall; s.soldiers.enabled = true; s.soldiers.stealth = s.tacticsSpec.stealth; });

  // --- the end of a hunt ------------------------------------------------------------
  const over = await page.evaluate(async () => {
    const s = window.spreefall;
    s.tactics.clear();
    s.soldiers.reset();
    s.mechs.reset();
    for (const site of s.campaign.allSites()) if (site.state !== 1) s.campaign.free(site, { quiet: true });
    for (let i = 0; i < 60 * 4; i++) s.fixedForTest(1 / 60);
    await new Promise((r) => requestAnimationFrame(r));
    const card = document.getElementById('opsend');
    return { shown: !card.classList.contains('hidden'), title: document.getElementById('opsendtitle').textContent,
      stats: document.getElementById('opsendstats').textContent };
  });
  await page.screenshot({ path: path.join(SHOTS, 'hunt-05-end.png') });
  check('every ground cleared ends the hunt, on a card of its own', over.shown && /hunt is over/i.test(over.title)
    && /Grounds cleared/.test(over.stats), JSON.stringify(over));
  await page.evaluate(() => document.getElementById('opsend').classList.add('hidden'));

  // Dying and coming back clears the street. It used to clear the guards out
  // of a ground near you with it, and the ground then counted as taken with
  // nobody having taken it: a run that opened with grounds already cleared.
  const respawn = await page.evaluate(() => {
    const s = window.spreefall;
    s.tactics.clear();
    s.campaign.reset({});
    const site = s.campaign.allSites()[0];
    s.teleport(site.x + 40, site.z);
    for (let i = 0; i < 30; i++) s.fixedForTest(1 / 60);
    const r = s.tactics.live.get(site.id);
    const manned = !!(r && r.manned && r.guards.length);
    const freeBefore = s.campaign.summary([]).free;
    document.getElementById('downbtn').click();
    for (let i = 0; i < 60; i++) s.fixedForTest(1 / 60);
    const r2 = s.tactics.live.get(site.id);
    return { manned, freeBefore, freeAfter: s.campaign.summary([]).free, held: site.state !== 1,
      label: document.getElementById('weaponname').textContent, short: s.weapon.spec.short,
      again: !!(r2 && r2.manned && r2.guards.some((g) => g.alive && g.health > 0)) };
  });
  check('coming back after dying leaves the grounds held, and manned again', respawn.manned && respawn.held
    && respawn.freeAfter === respawn.freeBefore && respawn.again, JSON.stringify(respawn));
  check('and the name under the ammunition is the weapon you come back with', respawn.label === respawn.short,
    `${respawn.label} for ${respawn.short}`);

  // --- kills feed the suit -------------------------------------------------------
  const ups = await page.evaluate(() => {
    const s = window.spreefall;
    s.suit.reset();
    const out = {};
    s.suitKill('soldier'); s.suitKill('soldier');
    out.before = { ...s.suit.level };
    s.suitKill('soldier');
    out.after3 = { ...s.suit.level };
    out.bar = s.suit.maxEnergy;
    out.full = s.suit.energy === s.suit.maxEnergy;
    out.toast = (document.getElementById('toast') || {}).textContent || '';
    out.kept = s.campaign.book.suit ? s.campaign.book.suit.level.energy : null;
    s.suitKill('mech');
    out.afterMech = { ...s.suit.level };
    for (let i = 0; i < 3; i++) s.fixedForTest(1 / 60);
    return out;
  });
  // The pips are drawn with the frame, and a frame on a slow runner can take
  // longer than any fixed wait: wait for one that has them, for a while.
  await page.waitForFunction(() => {
    const sp = document.querySelector('#suitups [data-up=energy] i');
    return !!sp && sp.style.getPropertyValue('--lv') !== '' && sp.style.getPropertyValue('--lv') !== '0%';
  }, null, { timeout: 8000 }).catch(() => {});
  const pips = await page.evaluate(() => {
    const sp = document.querySelector('#suitups [data-up=energy] i');
    return { lv: sp ? sp.style.getPropertyValue('--lv') : null,
      flashing: !!document.querySelector('#suitups span.up') };
  });
  check('kills in a hunt feed the suit: three men and the bar is bigger and full, a mech and you are quicker',
    ups.before.energy === 0 && ups.after3.energy === 1 && ups.bar > 100 && ups.full
      && ups.afterMech.speed === 1 && /SUIT UPGRADE/.test(ups.toast),
    JSON.stringify(ups));
  check('and the hunt keeps them, and the suit shows them as pips', ups.kept === 1 && pips.lv === '20%',
    JSON.stringify({ kept: ups.kept, pips }));
  await page.screenshot({ path: path.join(SHOTS, 'hunt-08-suit-upgrade.png') });

  // --- death from above -----------------------------------------------------------
  const slam = await page.evaluate(() => {
    const s = window.spreefall;
    s.tactics.clear(); s.soldiers.reset(); s.mechs.reset(); s.effects.clear();
    const site = s.campaign.allSites()[1] || s.campaign.allSites()[0];
    s.teleport(site.x + 140, site.z);
    for (let i = 0; i < 5; i++) s.fixedForTest(1 / 60);
    const t = s.spawnSoldier(-4, 0);
    t.rise = 0; t.state = 0;
    const by = s.spawnSoldier(-5.5, 1.2);
    by.rise = 0; by.state = 0;
    const kills = s.combat.kills;
    const cat = s.suit.catalyst + s.suit.steps * 100;
    // Six metres up and coming down at him.
    s.player.y = t.y + 6; s.player.onGround = false; s.player.vy = -2;
    s.look(90, -45);
    const seen = s.airTakedownTarget();
    const grounded = (() => { s.player.onGround = true; const x = s.airTakedownTarget(); s.player.onGround = false; return x; })();
    const went = s.airTakedown();
    for (let i = 0; i < 24; i++) s.fixedForTest(1 / 60);
    return { seen: seen && seen.kind, grounded: !!grounded, went, dead: t.health <= 0, by: Math.round(by.health),
      kills: s.combat.kills - kills, fed: s.suit.catalyst + s.suit.steps * 100 > cat,
      off: +Math.hypot(s.player.x - t.x, s.player.z - t.z).toFixed(2), slam: !!s.state.slam };
  });
  check('in the air over a man, F takes him from above, and not from the ground',
    slam.seen === 'soldier' && !slam.grounded && slam.went && slam.dead && !slam.slam && slam.off < 0.5,
    JSON.stringify(slam));
  check('and the one beside him goes down hurt, and the kill feeds the suit',
    slam.by < 100 && slam.kills >= 1 && slam.fed, JSON.stringify(slam));
  const mechSlam = await page.evaluate(() => {
    const s = window.spreefall;
    s.mechs.reset();
    const m = s.spawnMech('lynx', 18);
    if (!m) return { none: true };
    m.mine = false;
    const top = m.y + m.spec.height;
    s.teleport(m.x + 1.5, m.z + 1);
    s.player.y = top + 3; s.player.onGround = false; s.player.vy = 0;
    s.look(Math.atan2(-(m.x - s.player.x), -(m.z - s.player.z)) * 180 / Math.PI, -60);
    s.suit.energy = s.suit.maxEnergy;
    const e0 = s.suit.energy;
    const seen = s.airTakedownTarget();
    const went = s.airTakedown();
    const spent = e0 - s.suit.energy;
    for (let i = 0; i < 24; i++) s.fixedForTest(1 / 60);
    const out = { seen: seen && seen.kind, went, spent: Math.round(spent), dead: m.health <= 0,
      reactor: s.mechs.reactors.some((r) => r.m === m), vy: +s.player.vy.toFixed(1), slam: !!s.state.slam,
      takedowns: s.state.mechTakedowns || 0 };
    s.look(Math.atan2(-(m.x - s.player.x), -(m.z - s.player.z)) * 180 / Math.PI, -35);
    return out;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, 'hunt-09-mech-takedown.png') });
  check('come down on one of their mechs and F tears its reactor out: it falls with no fusion blast, for suit energy',
    mechSlam.seen === 'mech' && mechSlam.went && mechSlam.dead && !mechSlam.reactor && mechSlam.spent >= 30
      && mechSlam.takedowns >= 1,
    JSON.stringify(mechSlam));
  check('and you are thrown clear of it', mechSlam.vy > 3 && !mechSlam.slam, JSON.stringify(mechSlam));

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

  // On the title a hunt under way says so: the play button carries on with
  // it and a second one starts a new one from nothing.
  const title = await page.evaluate(() => {
    const s = window.spreefall;
    const site = s.campaign.allSites()[0];
    s.campaign.free(site, {});
    s.showOps();
    const play = document.getElementById('playbtn').textContent;
    const progress = document.getElementById('opsprogress').textContent;
    const fresh = document.getElementById('playnew');
    const offered = !fresh.classList.contains('hidden') ? fresh.textContent : null;
    fresh.click();
    return { play, progress, offered, after: s.campaign.summary([]), playAfter: document.getElementById('playbtn').textContent,
      held: s.campaign.allSites().every((x) => x.state !== 1) };
  });
  check('a hunt under way is carried on from the title with Weiterspielen, or started again with Neu anfangen',
    title.play === 'Weiterspielen' && /^1 of \d+ grounds taken so far/.test(title.progress) && title.offered === 'Neu anfangen'
      && title.after.free === 0 && title.after.score === 0 && title.held && title.playAfter === 'Spielen',
    JSON.stringify(title));

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
