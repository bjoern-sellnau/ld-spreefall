// The game on a phone, in a real browser told it is one: a screen 844 by 390
// on its side, touched and not hovered over. Every check here is done with
// real touches sent through the browser's own input (DevTools protocol),
// thumbs coming down, sliding and lifting with an identifier each, so what is
// tested is what a thumb on the glass would do, not a function call.
// Fails on any console error.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { padFor } from '../src/game/touch.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const URL_BASE = process.env.SPREEFALL_URL || 'http://localhost:8080/';
const W = 844, H = 390;

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  ${detail}` : ''}`);
}

/** Thumbs on the glass: each one down, moved and up, the rest held where they are. */
class Thumbs {
  constructor(cdp) { this.cdp = cdp; this.on = new Map(); }
  points() { return [...this.on].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 1 })); }
  async down(id, x, y) { this.on.set(id, { x, y }); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.points() }); }
  async move(id, x, y) { this.on.set(id, { x, y }); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.points() }); }
  // A touch end carries no points: one thumb of two is lifted by a move that
  // leaves it out, and the last by an end.
  async up(id) {
    this.on.delete(id);
    if (this.on.size) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.points() });
    else await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  /** Down and up again where it came down, which is a tap. */
  async tap(x, y, id = 9) { await this.down(id, x, y); await this.up(id); }
  /** One thumb slid from a to b in steps. */
  async drag(id, a, b, steps = 8, pause = 0) {
    await this.down(id, a.x, a.y);
    for (let i = 1; i <= steps; i++) {
      await this.move(id, a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
      if (pause) await new Promise((r) => setTimeout(r, pause));
    }
  }
}

/** Where a selector is on the screen, and whether all of it is. */
async function box(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const shown = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height,
      inside: shown && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, shown };
  }, sel);
}

/** A button along the top, once the bar is back after whatever had the screen. */
async function topButton(page, id) {
  await page.waitForFunction(() => !document.getElementById('ttop').classList.contains('hidden'), null, { timeout: 30000 })
    .catch(async (err) => {
      // Say what has the screen instead.
      console.log(await page.evaluate(() => {
        const s = window.spreefall;
        const up = [...document.querySelectorAll('.panel, .overlay, #pause, #nuketarget')].filter((e) => !e.classList.contains('hidden')).map((e) => e.id);
        return JSON.stringify({ mode: s.state.mode, paused: s.state.paused, targeting: s.state.targeting, big: s.minimap.big, up, ctx: s.touchContext() });
      }));
      throw err;
    });
  return box(page, `[data-top=${id}]`);
}

/** The buttons on the right as they are drawn: which, where and how big. */
async function padNow(page) {
  return page.evaluate(() => [...document.querySelectorAll('#tpad .tb:not(.hidden)')].map((b) => {
    const r = b.getBoundingClientRect();
    return { id: b.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2, d: r.width, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }));
}

/** Runs the world on by whole fixed steps, so a check reads it after it happened. */
async function steps(page, n) {
  await page.evaluate((k) => { for (let i = 0; i < k; i++) { window.spreefall.input.poll(); window.spreefall.fixedForTest(1 / 60); } }, n);
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
    viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  context.setDefaultTimeout(180000);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // What the page asks of the browser for the whole screen and its side,
  // counted, since a headless browser has no screen to give it.
  await page.addInitScript(() => {
    window.__asked = { full: 0, turn: [] };
    Element.prototype.requestFullscreen = function () { window.__asked.full++; return Promise.resolve(); };
    if (screen.orientation) screen.orientation.lock = (o) => { window.__asked.turn.push(o); return Promise.resolve(); };
  });
  const cdp = await context.newCDPSession(page);
  const thumbs = new Thumbs(cdp);

  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.spreefall, null, { timeout: 120000 });
  await page.waitForTimeout(800);

  // --- the page knows it is on a phone, and is set up for one -------------------
  const phone = await page.evaluate(() => {
    const s = window.spreefall;
    return {
      isTouch: s.isTouch, body: document.body.classList.contains('touch'),
      coarse: matchMedia('(pointer: coarse)').matches,
      quality: s.renderer.quality,
      dpr: s.renderer.dpr, canvas: document.getElementById('view').width / innerWidth,
      ceiling: s.streamCeiling,
      manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href'),
      icon: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href'),
    };
  });
  check('on a phone the page knows it: touch, a coarse pointer, and the buttons in place of the mouse',
    phone.isTouch && phone.body && phone.coarse, JSON.stringify(phone));
  check('and it draws at no more than one and a half device pixels, a tier down, inside half a gigabyte',
    phone.dpr <= 1.5 && phone.canvas <= 1.5 + 1e-6 && phone.quality !== 'high' && phone.ceiling <= 5.12e8,
    JSON.stringify(phone));
  const files = await page.evaluate(async (m) => {
    const man = await (await fetch(m)).json();
    const icons = await Promise.all(['icon-180.png', ...man.icons.map((i) => i.src)].map(async (f) => (await fetch(f)).status));
    return { display: man.display, orientation: man.orientation, icons };
  }, phone.manifest);
  check('a manifest that opens it full screen and on its side from the home screen, with its icons',
    files.display === 'fullscreen' && files.orientation === 'landscape' && files.icons.every((st) => st === 200),
    JSON.stringify(files));

  // --- the title: everything on it reachable with a thumb ------------------------
  const newGame = await box(page, '#newgame');
  await page.screenshot({ path: path.join(SHOTS, 'mobile-01-title.png') });
  check('the title fits a phone on its side, Neues Spiel on the screen and as big as a thumb',
    newGame && newGame.inside && newGame.h >= 40, JSON.stringify(newGame));
  await thumbs.tap(newGame.x, newGame.y);
  await page.waitForTimeout(400);
  const mode = await box(page, '#tpmodes [data-mode=machines]');
  await thumbs.tap(mode.x, mode.y);
  await page.waitForTimeout(500);
  const play = await box(page, '#playbtn');
  await page.screenshot({ path: path.join(SHOTS, 'mobile-02-mode.png') });
  check('the game\'s page keeps Spielen on the screen, however far its settings go',
    play && play.inside && play.h >= 40, JSON.stringify(play));
  await thumbs.tap(play.x, play.y);
  await page.waitForFunction(() => ['intro', 'walk', 'landing'].includes(window.spreefall.state.mode), null, { timeout: 120000 });
  const asked = await page.evaluate(() => window.__asked);
  check('Spielen asks for the whole screen and the phone on its side, from the tap itself',
    asked.full === 1 && asked.turn.includes('landscape'), JSON.stringify(asked));
  // The flight in is skipped by a tap on the city.
  const introBefore = await page.evaluate(() => window.spreefall.state.mode);
  if (introBefore === 'intro') { await thumbs.tap(W / 2, H / 2); await page.waitForTimeout(300); }
  const introAfter = await page.evaluate(() => window.spreefall.state.mode);
  check('a tap on the city skips the flight in', introBefore !== 'intro' || introAfter !== 'intro',
    `${introBefore} -> ${introAfter}`);
  await page.waitForFunction(() => window.spreefall.state.mode === 'walk', null, { timeout: 120000 });
  await page.evaluate(() => {
    const s = window.spreefall;
    // God mode by the cheat itself, which the menu puts back when it shuts.
    s.setCheat('godmode', true);
    s.soldiers.budget = 0; s.drones.budget = 0; s.jets.budget = 0;
    s.soldiers.reset(); s.drones.reset && s.drones.reset();
  });
  await page.waitForTimeout(1500);

  // --- the buttons on foot -------------------------------------------------------
  const foot = await padNow(page);
  const want = padFor({ playing: true });
  const ids = foot.map((b) => b.id);
  const overlaps = [];
  for (let i = 0; i < foot.length; i++) {
    for (let j = i + 1; j < foot.length; j++) {
      const a = foot[i], b = foot[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < (a.d + b.d) / 2) overlaps.push(`${a.id}/${b.id}`);
    }
  }
  await page.screenshot({ path: path.join(SHOTS, 'mobile-03-play.png') });
  check('on foot: fire, aim, reload, jump, use, the weapon either way, hit and slow motion, on the right',
    [...want.ring, ...want.side].every((id) => ids.includes(id)) && ids.length === want.ring.length + want.side.length,
    ids.join(' '));
  check('every one at least 48 pixels across, all of it on the screen, none over another, none in the stick\'s half',
    foot.every((b) => b.d >= 47.5 && b.left >= 0 && b.top >= 0 && b.right <= W && b.bottom <= H && b.left >= W * 0.45)
      && overlaps.length === 0,
    JSON.stringify({ smallest: Math.min(...foot.map((b) => b.d)).toFixed(1), overlaps }));
  const top = await page.evaluate(() => [...document.querySelectorAll('#ttop .tt')].map((b) => {
    const r = b.getBoundingClientRect(); return { id: b.dataset.top, w: r.width, h: r.height };
  }));
  check('along the top: pause, the map, the cheats and the rest, each at least 44 pixels high',
    top.map((t) => t.id).join() === 'pause,map,cheats,more' && top.every((t) => t.h >= 44 && t.w >= 44),
    JSON.stringify(top));
  const hidden = await page.evaluate(() => ({
    controls: getComputedStyle(document.getElementById('controls')).display,
    arms: getComputedStyle(document.getElementById('arms')).display,
  }));
  check('the mouse\'s row of buttons and the weapons list are out of the thumbs\' way',
    hidden.controls === 'none' && hidden.arms === 'none', JSON.stringify(hidden));
  const btn = (id) => foot.find((b) => b.id === id);

  // --- the stick: walk, and run at its rim --------------------------------------
  const walk = { x: 190, y: 300 };
  const walked = {};
  walked.from = await page.evaluate(() => ({ x: window.spreefall.player.x, z: window.spreefall.player.z }));
  await thumbs.down(1, walk.x, walk.y);
  await thumbs.move(1, walk.x, walk.y - 30);
  walked.half = await page.evaluate(() => ({ z: window.spreefall.input.moveZ, run: window.spreefall.input.run }));
  await thumbs.move(1, walk.x, walk.y - 60);
  walked.rim = await page.evaluate(() => ({ z: window.spreefall.input.moveZ, run: window.spreefall.input.run }));
  await steps(page, 60);
  walked.to = await page.evaluate(() => ({ x: window.spreefall.player.x, z: window.spreefall.player.z }));
  await thumbs.up(1);
  walked.after = await page.evaluate(() => { window.spreefall.input.poll(); return { z: window.spreefall.input.moveZ, run: window.spreefall.input.run }; });
  walked.metres = +Math.hypot(walked.to.x - walked.from.x, walked.to.z - walked.from.z).toFixed(2);
  check('a thumb on the left is a stick: half way out walks, at the rim it runs, and you go',
    walked.half.z > 0.3 && walked.half.z < 0.8 && !walked.half.run && walked.rim.z > 0.95 && walked.rim.run && walked.metres > 2,
    JSON.stringify(walked));
  check('and lifted, you stop', walked.after.z === 0 && !walked.after.run, JSON.stringify(walked.after));

  // --- the look, and slower with the sight up -----------------------------------
  const turn = async (dx) => {
    const y0 = await page.evaluate(() => window.spreefall.camera.yaw);
    await thumbs.drag(2, { x: 560, y: 160 }, { x: 560 + dx, y: 160 }, 6);
    await thumbs.up(2);
    await page.waitForTimeout(120);
    return Math.abs(await page.evaluate(() => window.spreefall.camera.yaw) - y0);
  };
  const plain = await turn(100);
  const aimB = btn('aim');
  await thumbs.tap(aimB.x, aimB.y);
  await page.waitForTimeout(700);
  const aimedState = await page.evaluate(() => ({ on: window.spreefall.input.secondary, lit: document.querySelector('.tb-aim').classList.contains('on'), fov: window.spreefall.camera.fov }));
  const zoomed = await turn(100);
  await thumbs.tap(aimB.x, aimB.y);
  await page.waitForTimeout(300);
  const aimOff = await page.evaluate(() => window.spreefall.input.secondary);
  check('a drag on the right turns you, a hundred pixels a fair way round', plain > 0.25 && plain < 0.7,
    `${plain.toFixed(3)} rad`);
  check('aim stays up until it is tapped again, and with it up the same drag turns you less',
    aimedState.on && aimedState.lit && !aimOff && zoomed < plain * 0.95,
    JSON.stringify({ ...aimedState, zoomed: +zoomed.toFixed(3), plain: +plain.toFixed(3), aimOff }));

  // --- fire, and turning with the thumb still on it -----------------------------
  const fireB = btn('fire');
  const shot = {};
  shot.before = await page.evaluate(() => window.spreefall.weapon.ammo);
  shot.yaw0 = await page.evaluate(() => window.spreefall.camera.yaw);
  await thumbs.down(3, fireB.x, fireB.y);
  shot.held = await page.evaluate(() => window.spreefall.input.fire);
  await page.waitForTimeout(600);
  for (let i = 1; i <= 6; i++) await thumbs.move(3, fireB.x - i * 12, fireB.y);
  await page.waitForTimeout(150);
  shot.yaw1 = await page.evaluate(() => window.spreefall.camera.yaw);
  await thumbs.up(3);
  shot.after = await page.evaluate(() => ({ fire: window.spreefall.input.fire, ammo: window.spreefall.weapon.ammo }));
  check('fire held fires, and lifted stops', shot.held && shot.after.ammo < shot.before && !shot.after.fire,
    JSON.stringify(shot));
  check('and a thumb sliding off it turns you while you shoot', Math.abs(shot.yaw1 - shot.yaw0) > 0.1,
    `${(shot.yaw1 - shot.yaw0).toFixed(3)} rad`);

  // --- reload, jump, the weapon either way ---------------------------------------
  // A few rounds off the top, so there is something to reload, and then the
  // magazine full again after the tap.
  await page.waitForFunction(() => window.spreefall.weapon.reloadLeft <= 0, null, { timeout: 30000 });
  await thumbs.down(3, fireB.x, fireB.y);
  await page.waitForFunction(() => window.spreefall.weapon.ammo < window.spreefall.weapon.spec.magazine, null, { timeout: 30000 });
  await thumbs.up(3);
  const rel = btn('reload');
  await thumbs.tap(rel.x, rel.y);
  const reloading = await page.waitForFunction(() => window.spreefall.weapon.ammo === window.spreefall.weapon.spec.magazine, null, { timeout: 30000 })
    .then(() => true, () => false);
  const jmp = btn('jump');
  await page.waitForFunction(() => window.spreefall.player.grounded !== false, null, { timeout: 10000 }).catch(() => {});
  const y0 = await page.evaluate(() => window.spreefall.player.y);
  await thumbs.down(4, jmp.x, jmp.y);
  const y1 = await page.evaluate(() => {
    const s = window.spreefall;
    let top = s.player.y;
    for (let i = 0; i < 30; i++) { s.input.poll(); s.fixedForTest(1 / 60); top = Math.max(top, s.player.y); }
    return top;
  });
  await thumbs.up(4);
  const w0 = await page.evaluate(() => window.spreefall.weapon.id);
  const nx = btn('next');
  await thumbs.tap(nx.x, nx.y);
  const w1 = await page.evaluate(() => window.spreefall.weapon.id);
  const pv = btn('prev');
  await thumbs.tap(pv.x, pv.y);
  const w2 = await page.evaluate(() => window.spreefall.weapon.id);
  check('reload reloads, jump jumps, and the arrows go to the next weapon and back',
    reloading && y1 > y0 + 0.2 && w1 !== w0 && w2 === w0, JSON.stringify({ reloading, rise: +(y1 - y0).toFixed(2), w0, w1, w2 }));

  // --- the rest of the keys, behind the three dots ---------------------------------
  const more = await topButton(page, 'more');
  await thumbs.tap(more.x, more.y);
  await page.waitForTimeout(300);
  const drawer = await page.evaluate(() => ({
    open: !document.getElementById('tdrawer').classList.contains('hidden'),
    keys: [...document.querySelectorAll('#tdrawer .td[data-key]')].map((b) => b.dataset.key),
    small: [...document.querySelectorAll('#tdrawer .td')].filter((b) => b.getBoundingClientRect().height < 44).length,
  }));
  await page.screenshot({ path: path.join(SHOTS, 'mobile-04-drawer.png') });
  const three = await box(page, '#tdrawer .td[data-key=Digit3]');
  await thumbs.tap(three.x, three.y);
  await page.waitForTimeout(300);
  const after3 = await page.evaluate(() => ({ id: window.spreefall.weapon.id, open: !document.getElementById('tdrawer').classList.contains('hidden') }));
  check('the three dots open every other key: the number row, the weapons of their own, the panels and the settings',
    drawer.open && drawer.small === 0 && ['Digit1', 'Digit0', 'KeyZ', 'KeyK', 'Backquote', 'KeyV', 'KeyP', 'KeyJ', 'F1', 'F7'].every((k) => drawer.keys.includes(k)),
    JSON.stringify({ open: drawer.open, n: drawer.keys.length, small: drawer.small }));
  check('and a key in it does what the key does: 3 is the launcher, and the drawer shuts',
    after3.id === 'rpg' && !after3.open, JSON.stringify(after3));

  // --- pause, and back ---------------------------------------------------------------
  const pauseB = await topButton(page, 'pause');
  await thumbs.tap(pauseB.x, pauseB.y);
  await page.waitForTimeout(400);
  const paused = await page.evaluate(() => ({
    paused: window.spreefall.state.paused,
    pad: document.querySelectorAll('#tpad .tb:not(.hidden)').length,
    top: !document.getElementById('ttop').classList.contains('hidden'),
  }));
  await page.screenshot({ path: path.join(SHOTS, 'mobile-05-pause.png') });
  const resume = await box(page, '#pauseresume');
  await thumbs.tap(resume.x, resume.y);
  await page.waitForTimeout(400);
  const resumed = await page.evaluate(() => !window.spreefall.state.paused);
  check('pause stops the world and puts the buttons away, and Weiter brings both back',
    paused.paused && paused.pad === 0 && !paused.top && resumed && resume.inside, JSON.stringify({ ...paused, resumed }));

  // --- the cheats, scrolled with a thumb -------------------------------------------
  const cheatsB = await topButton(page, 'cheats');
  await thumbs.tap(cheatsB.x, cheatsB.y);
  await page.waitForTimeout(400);
  const menu = await page.evaluate(() => {
    const c = document.getElementById('cheats');
    const r = c.getBoundingClientRect();
    return { open: !c.classList.contains('hidden'), tall: c.scrollHeight > c.clientHeight, inside: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
  });
  // A thumb pushing the list up, a frame or so between each step of it.
  const cm = await box(page, '#cheats');
  await thumbs.drag(5, { x: cm.x, y: cm.y + 100 }, { x: cm.x, y: cm.y - 100 }, 10, 16);
  await thumbs.up(5);
  await page.waitForTimeout(400);
  const scrolled = await page.evaluate(() => document.getElementById('cheats').scrollTop);
  await page.screenshot({ path: path.join(SHOTS, 'mobile-06-cheats.png') });
  await page.evaluate(() => window.spreefall.cheatMenu(false));
  await page.waitForTimeout(400);
  check('the cheats fit the screen and scroll under a thumb', menu.open && menu.inside && menu.tall && scrolled > 40,
    JSON.stringify({ ...menu, scrolled }));

  // --- the map: drag, pinch, mark, close --------------------------------------------
  const mapB = await topButton(page, 'map');
  await thumbs.tap(mapB.x, mapB.y);
  await page.waitForTimeout(700);
  const centre = () => page.evaluate(() => { const c = window.spreefall.minimap.centre; return c ? `${c.x.toFixed(1)},${c.z.toFixed(1)}` : 'whole'; });
  const m0 = await page.evaluate(() => ({ big: window.spreefall.minimap.big, span: window.spreefall.minimap.spanAcross() }));
  m0.cx = await centre();
  const mm = await box(page, '#minimap');
  await thumbs.drag(6, { x: mm.x, y: mm.y }, { x: mm.x + 120, y: mm.y + 40 }, 6);
  await thumbs.up(6);
  const m1 = await page.evaluate(() => ({ span: window.spreefall.minimap.spanAcross() }));
  m1.cx = await centre();
  await thumbs.down(6, mm.x - 40, mm.y);
  await thumbs.down(7, mm.x + 40, mm.y);
  for (let i = 1; i <= 6; i++) { await thumbs.move(6, mm.x - 40 - i * 15, mm.y); await thumbs.move(7, mm.x + 40 + i * 15, mm.y); }
  await thumbs.up(7); await thumbs.up(6);
  const m2 = await page.evaluate(() => ({ span: window.spreefall.minimap.spanAcross() }));
  await thumbs.tap(mm.x + 60, mm.y - 30);
  await page.waitForTimeout(200);
  const marked = await page.evaluate(() => !!window.spreefall.state.waypoint);
  await page.screenshot({ path: path.join(SHOTS, 'mobile-07-map.png') });
  const closeB = await box(page, '#mapclose');
  await thumbs.tap(closeB.x, closeB.y);
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => !window.spreefall.minimap.big);
  check('the map opens big from the top; one thumb drags it, two pinch it in, a tap sets the mark, close shuts it',
    m0.big && m1.cx !== m0.cx && m2.span < m1.span * 0.9 && marked && closed && closeB.inside,
    JSON.stringify({ m0, m1, m2, marked, closed }));

  // --- a vehicle: in by the hint or use, drive by the stick, out ---------------------
  // A jeep three metres ahead: the hint over it is the button to get in.
  await page.evaluate(() => {
    const s = window.spreefall;
    const yaw = s.camera.yaw;
    s.vehicles.spawn('jeep', s.player.x - Math.sin(yaw) * 3.5, s.player.z - Math.cos(yaw) * 3.5, yaw);
  });
  await page.waitForFunction(() => !document.getElementById('ridehint').classList.contains('hidden'), null, { timeout: 30000 });
  // The sight left up on foot must not ride along.
  await thumbs.tap(btn('aim').x, btn('aim').y);
  const hint = await box(page, '#ridehint');
  await thumbs.tap(hint.x, hint.y);
  await page.waitForTimeout(600);
  const car = await page.evaluate(() => {
    const s = window.spreefall;
    return { inIt: !!s.state.inVehicle, aim: s.input.secondary, ids: [...document.querySelectorAll('#tpad .tb:not(.hidden)')].map((b) => b.dataset.id),
      ctx: s.touchContext() };
  });
  // Full forward on the stick is full throttle, not the brake the rim would
  // be on foot, where it runs.
  await thumbs.down(1, walk.x, walk.y);
  await thumbs.move(1, walk.x, walk.y - 60);
  const rimRuns = await page.evaluate(() => window.spreefall.input.run);
  await page.waitForFunction(() => { const v = window.spreefall.state.inVehicle; return v && Math.abs(v.speed) > 3; }, null, { timeout: 30000 }).catch(() => {});
  const speed = await page.evaluate(() => Math.abs(window.spreefall.state.inVehicle ? window.spreefall.state.inVehicle.speed : 0));
  await page.screenshot({ path: path.join(SHOTS, 'mobile-08-jeep.png') });
  await thumbs.up(1);
  const outB = (await padNow(page)).find((b) => b.id === 'out');
  if (outB) await thumbs.tap(outB.x, outB.y);
  await page.waitForTimeout(600);
  const out = await page.evaluate(() => !window.spreefall.state.inVehicle);
  // Getting out asks whether to leave a bomb in it; its own buttons answer.
  const rigAsked = await page.evaluate(() => !document.getElementById('vbomb').classList.contains('hidden'));
  if (rigAsked) {
    const no = await box(page, '#vbombno');
    await thumbs.tap(no.x, no.y);
    await page.waitForTimeout(400);
  }
  const rigGone = await page.evaluate(() => document.getElementById('vbomb').classList.contains('hidden'));
  check('the hint over the jeep is a button that gets you in, and its buttons are fire, brake and out, the sight not carried in',
    car.inIt && car.ids.join() === ['fire', 'brake', 'out'].join() && !car.aim, JSON.stringify(car));
  check('the stick drives it, the rim full throttle and not the brake, and out gets you out',
    speed > 3 && !rimRuns && out, JSON.stringify({ speed: +speed.toFixed(2), rimRuns, out }));
  check('and the question about a bomb in it is answered with a tap', rigAsked && rigGone, JSON.stringify({ rigAsked, rigGone }));

  // --- another game from the pause: The Hunt, its suit on the buttons -----------------
  const switchTo = async (m) => {
    const p = await topButton(page, 'pause');
    await thumbs.tap(p.x, p.y);
    await page.waitForTimeout(400);
    await page.evaluate((mm2) => document.querySelector(`#pausemodes [data-mode="${mm2}"]`).scrollIntoView(), m);
    const it = await box(page, `#pausemodes [data-mode="${m}"]`);
    await thumbs.tap(it.x, it.y);
    await page.waitForFunction(() => window.spreefall.state.mode === 'walk' && !window.spreefall.state.paused, null, { timeout: 120000 });
    await page.waitForTimeout(600);
  };
  await switchTo('hunt');
  // The buttons follow on the next frame drawn.
  await page.waitForFunction(() => !!document.querySelector('#tpad .tb-cloak:not(.hidden)'), null, { timeout: 30000 }).catch(() => {});
  const hunt = await padNow(page);
  const cloakB = hunt.find((b) => b.id === 'cloak');
  if (cloakB) await thumbs.tap(cloakB.x, cloakB.y);
  await page.waitForTimeout(200);
  const suitMode = await page.evaluate(() => (window.spreefall.suit.cloak ? 'cloak on' : 'cloak off'));
  await page.screenshot({ path: path.join(SHOTS, 'mobile-09-hunt.png') });
  check('in The Hunt the suit is on the buttons: armour, cloak, a grenade, the visor and the heat',
    ['armour', 'cloak', 'grenade', 'visor', 'heat'].every((id) => hunt.some((b) => b.id === id)) && !hunt.some((b) => b.id === 'reflex'),
    hunt.map((b) => b.id).join(' '));
  check('and cloak puts the cloak on', suitMode === 'cloak on', suitMode);

  await switchTo('backdoor');
  await page.waitForFunction(() => !!document.querySelector('#tpad .tb-blackout:not(.hidden)'), null, { timeout: 30000 }).catch(() => {});
  const bd = await padNow(page);
  const bdCtx = await page.evaluate(() => JSON.stringify(window.spreefall.touchContext()));
  await page.screenshot({ path: path.join(SHOTS, 'mobile-10-backdoor.png') });
  check('in .BACKDOOR the blackout is on the buttons, and the phone\'s hacks when it points at something',
    bd.some((b) => b.id === 'blackout') && !bd.some((b) => b.id === 'cloak'), `${bd.map((b) => b.id).join(' ')} ${bdCtx}`);

  // --- held upright ---------------------------------------------------------------
  await page.setViewportSize({ width: H, height: W });
  await page.waitForTimeout(700);
  const upright = await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display !== 'none');
  await page.screenshot({ path: path.join(SHOTS, 'mobile-11-upright.png') });
  const go = await box(page, '#rotatego');
  await thumbs.tap(go.x, go.y);
  await page.waitForTimeout(500);
  const asked2 = await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display === 'none');
  const tall = await padNow(page);
  check('held upright it asks to be turned, and lets you play upright, every button still on the screen',
    upright && asked2 && tall.length > 0 && tall.every((b) => b.left >= 0 && b.right <= H && b.top >= 0 && b.bottom <= W),
    JSON.stringify({ upright, dismissed: asked2, buttons: tall.length }));
  await page.setViewportSize({ width: W, height: H });

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

run().catch((err) => { console.error(err); process.exit(1); });
