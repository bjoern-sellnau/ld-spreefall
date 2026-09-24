// SPREE|FALL. Entry point: load the world, build the renderer, run the loop.

import { createContext } from './engine/gl.js';
import { World } from './engine/world.js';
import { TileManager } from './engine/tiles.js';
import { Camera } from './engine/camera.js';
import { Input } from './engine/input.js';
import { CharacterController } from './engine/controller.js';
import { Loop } from './engine/loop.js';
import { clamp } from './engine/math.js';
import { Renderer, QUALITY } from './render/renderer.js';
import { Landmarks } from './game/landmarks.js';
import { Minimap } from './game/minimap.js';
import { Audio } from './game/audio.js';
import { Intro } from './game/intro.js';
import { PhotoMode, dayLabel, timeLabel } from './game/photo.js';
import { decodeState, writeState } from './game/state.js';
import { Drones, DRONE_STATE } from './game/drones.js';
import { Weapon, LOADOUT, WEAPONS } from './game/weapon.js';
import { Combat, COMBAT, DIFFICULTY } from './game/combat.js';
import { Effects } from './game/effects.js';
import { Projectiles } from './game/projectiles.js';
import { Soldiers } from './game/soldiers.js';
import { Reflex, REFLEX } from './game/reflex.js';
import { Jets } from './game/jets.js';
import { PLAYER, SPAWN, SURFACE } from './shared/constants.js';

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('view'), loading: $('loading'), loadbar: $('loadbar'), loadnote: $('loadnote'),
  title: $('title'), play: $('playbtn'), hud: $('hud'), minimap: $('minimap'),
  compass: $('compasslabel'), cards: $('cardhost'), toast: $('toast'), debug: $('debug'),
  found: $('found'), total: $('total'), photo: $('photo'), tod: $('tod'), doy: $('doy'),
  todLabel: $('todlabel'), doyLabel: $('doylabel'), shoot: $('shoot'), copylink: $('copylink'),
  photoClose: $('photoclose'), help: $('helppanel'), helpClose: $('helpclose'),
  completion: $('completion'), completionText: $('completiontext'), completionClose: $('completionclose'),
  btnMap: $('btnmap'), btnPhoto: $('btnphoto'), btnSound: $('btnsound'), btnHelp: $('btnhelp'),
  crosshair: $('crosshair'), hitmarker: $('hitmarker'), damage: $('damage'),
  combat: $('combat'), healthbar: $('healthbar'), healthnum: $('healthnum'),
  ammonum: $('ammonum'), reservenum: $('reservenum'), reloadhint: $('reloadhint'),
  shieldbar: $('shieldbar'), shieldnum: $('shieldnum'), shieldflash: $('shieldflash'),
  reflexbar: $('reflexbar'), lockon: $('lockon'), locktext: $('locktext'),
  diffnote: $('diffnote'),
  weaponname: $('weaponname'),
  tiernum: $('tiernum'), contactnum: $('contactnum'), scorenum: $('scorenum'),
  sanctuary: $('sanctuary'), killfeed: $('killfeed'),
  down: $('down'), downText: $('downtext'), downBtn: $('downbtn'),
  touchui: $('touchui'), stick: $('stick'), knob: $('stickknob'),
  btnJump: $('btnjump'), btnRun: $('btnrun'), source: $('datasource'),
  attribution: $('attribution'), controlhint: $('controlhint'),
};

const DEG = Math.PI / 180;

// Where the weapon sits relative to the eye, in metres and radians. Hip fire
// holds it down and to the right, far enough forward that the receiver is not
// pressed into your face. Aiming slides the sight onto the centre line, which
// is what the narrowed field of view is actually for: the post at local y
// 0.088 has to come down to zero, so the aim pose carries that offset.
const VM_HIP = { x: 0.225, y: -0.150, z: -0.460, pitch: -0.015, yaw: 0.135, roll: 0.050 };
const VM_AIM = { x: 0.000, y: -0.089, z: -0.330, pitch: 0.000, yaw: 0.000, roll: 0.000 };

const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;

function fatal(message, detail) {
  el.loading.classList.remove('hidden');
  el.loadbar.style.width = '100%';
  el.loadbar.style.background = '#c05a4a';
  el.loadnote.textContent = message;
  if (detail) {
    const p = document.createElement('pre');
    p.style.cssText = 'color:#8b8781;font-size:11px;max-width:70vw;margin:14px auto 0;white-space:pre-wrap;text-align:left';
    p.textContent = String(detail).slice(0, 900);
    el.loadnote.after(p);
  }
  console.error(message, detail);
}

function toast(text, ms = 2200) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove('show'), ms);
}

// Project a lat lon to our metric plane, matching tools/geo.mjs exactly.
function project(manifest, lon, lat) {
  const o = manifest.origin;
  const mLon = 111320.0 * Math.cos(o.lat * DEG);
  return [(lon - o.lon) * mLon, -(lat - o.lat) * 110574.0];
}

async function main() {
  let ctx;
  try {
    ctx = createContext(el.canvas, { antialias: false, preserveDrawingBuffer: true });
  } catch (err) {
    fatal('This browser does not support WebGL2.', err.message);
    return;
  }
  const { gl, caps } = ctx;

  let world;
  try {
    world = await World.load('public/', (p) => {
      el.loadbar.style.width = `${Math.round(p * 100)}%`;
      el.loadnote.textContent = p < 1 ? `loading the city, ${Math.round(p * 100)} per cent` : 'building buffers';
    });
  } catch (err) {
    fatal('The world bundle could not be loaded. Run: npm run world', err.message);
    return;
  }

  const m = world.manifest;
  el.total.textContent = String((m.landmarks || []).filter((l) => l.text).length);
  el.source.textContent = m.totals
    ? ` ${m.totals.buildings} buildings, ${m.totals.roadKm} km of street, ${m.totals.trees} trees.`
    : '';

  const tiles = new TileManager(gl, world);
  let renderer;
  try {
    renderer = new Renderer(gl, caps, world, tiles);
  } catch (err) {
    fatal('A shader failed to build.', err.message);
    return;
  }

  const camera = new Camera();
  const player = new CharacterController(world);
  const input = new Input(el.canvas);
  const landmarks = new Landmarks(m, el.cards, showCompletion);
  const minimap = new Minimap(el.minimap, world, landmarks);
  const audio = new Audio(world);
  const photo = new PhotoMode(el.canvas, el.hud, el.photo, el.attribution);

  // --- the shooter --------------------------------------------------------
  // The difficulty is chosen on the title screen and remembered, because the
  // first thing anyone wants after dying twice is a different one.
  let wanted = 'normal';
  try { wanted = localStorage.getItem('spreefall.difficulty') || 'normal'; } catch { /* private mode */ }
  const combat = new Combat(m, wanted);
  const drones = new Drones(world, (x, y, z) => combat.isSanctuary(x, y, z));
  // Filled in by the soldier layer below, and referenced by the blast handler
  // before it exists, which is why it is a binding rather than a constant.
  let soldiers = null;   // built below, once combat exists to ask about zones
  const projectiles = new Projectiles(world, (x, y, z, splash, body) => explode(x, y, z, splash, body));
  const weapon = new Weapon(world, drones, { projectiles });
  const effects = new Effects();
  const reflex = new Reflex();
  reflex.drainScale = combat.rules.reflexDrain;
  soldiers = new Soldiers(world, (x, y, z) => combat.isSanctuary(x, y, z));
  const jets = new Jets(world, (x, y, z) => combat.isSanctuary(x, y, z));
  jets.accuracyScale = combat.rules.enemyAccuracy;
  soldiers.hazards = () => projectiles.hazards();
  soldiers.accuracyScale = combat.rules.enemyAccuracy;
  // A rocket goes off on whoever it hits, not on the wall behind them.
  projectiles.hitActors = (x, y, z, dx, dy, dz, maxT) => {
    const d = drones.raycast(x, y, z, dx, dy, dz, maxT);
    const sHit = soldiers.raycast(x, y, z, dx, dy, dz, d ? d.t : maxT);
    const jHit = jets.raycast(x, y, z, dx, dy, dz, sHit ? sHit.t : (d ? d.t : maxT));
    if (jHit) return { t: jHit.t, target: jHit.jet };
    if (sHit) return { t: sHit.t, target: sHit.soldier };
    return d ? { t: d.t, target: d.drone } : null;
  };

  // A jet's cannon pass, and the missile it drops on every second run.
  jets.onGun = (j, damage) => {
    audio.gunshot('rifle');
    effects.tracer(j.x, j.y - 1, j.z,
      camera.position[0] + (Math.random() - 0.5) * 6,
      camera.position[1] - 1 + Math.random() * 2,
      camera.position[2] + (Math.random() - 0.5) * 6, false);
    if (damage > 0 && combat.health > 0) combat.hurt(damage, j.x, j.z, player.x, player.z);
  };
  jets.onMissile = (j) => {
    audio.gunshot('rpg');
    const dx = player.x - j.x, dy = (player.y + PLAYER.eye) - j.y, dz = player.z - j.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    projectiles.launch('rocket', {
      x: j.x, y: j.y - 1.2, z: j.z,
      vx: dx / l * 70, vy: dy / l * 70, vz: dz / l * 70,
      splash: { radius: 8, damage: 90, force: 18 },
      weapon: 'jet',
      // It chases you, but slowly enough that moving is an answer.
      homing: { turn: 1.5, range: 400 },
      target: { x: player.x, y: player.y, z: player.z, height: 1.8, alive: true },
    });
    toast('missile inbound');
  };
  jets.onPass = () => audio.jetPass();
  jets.onDeath = (j) => {
    effects.blast(j.x, j.y, j.z, 10);
    audio.explosion();
    creditTarget(j, false, 'jet');
  };
  weapon.soldiers = soldiers;
  weapon.jets = jets;

  // --- spawn ---------------------------------------------------------------
  const [sx, sz] = project(m, SPAWN.lon, SPAWN.lat);
  let spawn = { x: sx, z: sz, yaw: SPAWN.yaw, pitch: -0.04, tod: 17.4, doy: 166 };
  const fromUrl = decodeState(location.hash);
  const deepLink = !!fromUrl;
  if (fromUrl) spawn = { ...spawn, ...fromUrl };

  renderer.timeOfDay = spawn.tod;
  renderer.dayOfYear = spawn.doy;
  el.tod.value = String(spawn.tod);
  el.doy.value = String(spawn.doy);
  el.todLabel.textContent = timeLabel(spawn.tod);
  el.doyLabel.textContent = dayLabel(spawn.doy);

  player.teleport(spawn.x, spawn.z);
  camera.yaw = spawn.yaw;
  camera.pitch = spawn.pitch;

  // Warm up the tiles around the spawn before we show anything.
  tiles.primeSkyline();
  tiles.uploadsPerFrame = 10000;
  tiles.updateResidency(spawn.x, spawn.z, 0);
  tiles.uploadsPerFrame = 8;
  player.teleport(spawn.x, spawn.z);

  const intro = new Intro(spawn.x, spawn.z, world.groundHeight(spawn.x, spawn.z));

  // --- view state ----------------------------------------------------------
  const state = {
    // title, intro, landing, walk. A link that already carries a view skips the
    // drone shot and holds that exact view behind the title card, otherwise the
    // intro camera would throw away the heading the link asked for.
    mode: 'title',
    deepLink,
    walking: false,
    time: 0,
    prev: { x: player.x, y: player.y, z: player.z },
    curr: { x: player.x, y: player.y, z: player.z },
    dronePose: null,
    landFrom: null,
    debug: false,
    holstered: false,
    muzzle: 0,
    sway: { x: 0, y: 0 },
    timeScale: 1,
    charging: false,
    shieldTimer: 0,
    recoilApplied: { pitch: 0, yaw: 0 },
    bob: 0,
    inSanctuary: false,
    autoQualityDone: false,
    frameSamples: [],
    lastGround: true,
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, isTouch ? 2 : 2);
    const w = el.canvas.clientWidth || window.innerWidth;
    const h = el.canvas.clientHeight || window.innerHeight;
    el.canvas.width = Math.round(w * dpr);
    el.canvas.height = Math.round(h * dpr);
    renderer.resize(w, h, dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- interface wiring ----------------------------------------------------
  if (isTouch) {
    el.touchui.classList.remove('hidden');
    el.controlhint.innerHTML = 'Drag on the <b>left</b> to walk, on the <b>right</b> to look. '
      + 'Buttons for jump and run are bottom right.';
  }

  input.onStick = (on, cx, cy, kx, ky) => {
    el.stick.classList.toggle('on', on);
    if (on) {
      el.stick.style.left = `${cx}px`;
      el.stick.style.top = `${cy}px`;
      el.knob.style.transform = `translate(${kx}px, ${ky}px)`;
    }
  };
  el.btnJump.addEventListener('touchstart', (e) => { e.preventDefault(); input.jumpQueued = true; });
  el.btnRun.addEventListener('touchstart', (e) => { e.preventDefault(); input.run = !input.run; el.btnRun.textContent = input.run ? 'walk' : 'run'; });

  // --- combat glue --------------------------------------------------------

  function feed(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    el.killfeed.appendChild(d);
    setTimeout(() => d.remove(), 3600);
    while (el.killfeed.childElementCount > 5) el.killfeed.firstChild.remove();
  }

  function showHitmarker(kind) {
    el.hitmarker.className = kind;
    // Restart the animation by forcing a reflow.
    void el.hitmarker.offsetWidth;
    el.hitmarker.classList.add('on');
  }

  /** Where the muzzle is in the world, for tracers and for the flash. */
  function muzzlePoint(from) {
    // Hip fire holds the barrel down and right; the aim blend brings it back
    // onto the centre line, so the tracer agrees with what you can see.
    const off = 1 - weapon.aimBlend;
    return {
      x: from.x + camera.right[0] * 0.09 * off + camera.up[0] * (-0.13 - 0.03 * off)
        + camera.forward[0] * 0.55,
      y: from.y + camera.right[1] * 0.09 * off + camera.up[1] * (-0.13 - 0.03 * off)
        + camera.forward[1] * 0.55,
      z: from.z + camera.right[2] * 0.09 * off + camera.up[2] * (-0.13 - 0.03 * off)
        + camera.forward[2] * 0.55,
    };
  }

  weapon.onFire = (shot) => {
    const spec = weapon.spec;
    // A shotgun reports every pellet. One bang, one flash, one kick, but a
    // tracer and an impact each, because that spray is the whole weapon.
    const first = !shot.pellet;
    if (first) {
      audio.gunshot(spec.sound);
      effects.shake = Math.min(1, effects.shake + (spec.kind === 'hitscan' ? 0.07 : 0.16));
      state.muzzle = 1;
    }
    const m = muzzlePoint(shot.from);
    if (shot.end) {
      effects.tracer(m.x, m.y, m.z, shot.end.x, shot.end.y, shot.end.z, true);
      effects.impact(shot.end.x, shot.end.y, shot.end.z,
        shot.end.nx, shot.end.ny, shot.end.nz, shot.surface);
    }
    if (shot.target) {
      audio.hitMarker(shot.core);
      showHitmarker(shot.killed ? 'kill' : (shot.core ? 'core' : ''));
      if (shot.killed) creditTarget(shot.target, shot.core, shot.surface);
    }
  };

  /**
   * A blast, wherever it came from. Everything inside the radius takes damage
   * that falls off with distance, and that includes you: standing next to your
   * own rocket is a choice with consequences.
   */
  function explode(x, y, z, splash, body) {
    audio.explosion();
    effects.explode(x, y, z);
    effects.blast(x, y, z, splash.radius);
    // Mark whatever it went off against. The soot reaches further than the
    // damage does, which is how a blast looks on a wall.
    renderer.addScar(x, y, z, splash.radius * 1.5,
      Math.min(1, splash.damage / 180));
    debris(x, y, z, splash.radius);
    const dist = Math.hypot(player.x - x, player.y + PLAYER.eye - y, player.z - z);
    effects.shake = Math.min(1.4, effects.shake
      + Math.max(0, 1 - dist / (splash.radius * 3)) * 0.9);

    let killed = 0;
    for (const d of [...drones.active]) {
      const r = Math.hypot(d.x - x, d.y - y, d.z - z);
      if (r > splash.radius) continue;
      // Line of sight, so a wall between the grenade and the target is a wall.
      if (!world.lineOfSight(x, y, z, d.x, d.y, d.z)) continue;
      const dmg = splash.damage * (1 - r / splash.radius);
      if (drones.damage(d, dmg)) { creditTarget(d, false, 'drone'); killed++; }
    }
    if (soldiers) {
      for (const sd of [...soldiers.active]) {
        const r = Math.hypot(sd.x - x, sd.y + 0.9 - y, sd.z - z);
        if (r > splash.radius) continue;
        if (!world.lineOfSight(x, y, z, sd.x, sd.y + 0.9, sd.z)) continue;
        const dmg = splash.damage * (1 - r / splash.radius);
        if (soldiers.damage(sd, dmg, { x: 0, y: 0, z: 0 })) {
          creditTarget(sd, false, 'soldier'); killed++;
        }
      }
    }
    for (const j of [...jets.active]) {
      const r = Math.hypot(j.x - x, j.y - y, j.z - z);
      if (r > splash.radius * 1.6) continue;      // a jet is a big thing to miss
      if (jets.damage(j, splash.damage * (1 - r / (splash.radius * 1.6)))) killed++;
    }
    if (dist < splash.radius
      && world.lineOfSight(x, y, z, player.x, player.y + PLAYER.eye, player.z)) {
      combat.hurt(splash.damage * 0.55 * (1 - dist / splash.radius), x, z, player.x, player.z);
    }
    if (killed > 1) toast(`${killed} at once`);
    return killed;
  }

  /**
   * Whatever the blast knocked off the wall. The raycast tells us which
   * surfaces are near enough to lose something, so debris comes off the
   * building rather than out of the air.
   */
  function debris(x, y, z, radius) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
      const hit = world.raycast(x, y, z, Math.cos(a), 0.1 - Math.random() * 0.4, Math.sin(a),
        radius * 1.2);
      if (!hit || hit.kind === 'ground') continue;
      effects.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.kind);
    }
  }

  /** One kill, however it was made: by a bullet, a blast or a fall. */
  function creditTarget(target, core, kind) {
    const dist = Math.hypot(target.x - player.x, target.z - player.z);
    combat.creditKill(core, dist);
    effects.explode(target.x, target.y, target.z);
    audio.droneDown();
    const name = kind === true ? 'drone' : (kind === false ? 'soldier' : kind);
    feed(`<b>${name} down</b> ${Math.round(dist)} m${core ? ' <i>core</i>' : ''}`);
  }
  weapon.onDryFire = () => audio.dryFire();
  weapon.onReloadStart = (seconds) => audio.reload(seconds);
  weapon.onSwap = (id, spec) => {
    audio.swap();
    toast(spec.name);
    el.weaponname.textContent = spec.short;
    el.combat.classList.toggle('explosive', spec.kind !== 'hitscan');
  };
  input.onWheel = (dir) => { if (!state.holstered) weapon.cycle(dir); };
  // The lock indicator: a ring that closes as the lock fills, and reads solid
  // when the rocket will chase whatever you are pointing at.
  weapon.onLock = (target, progress) => {
    const on = !!target && progress > 0.01;
    el.lockon.classList.toggle('hidden', !on);
    if (!on) return;
    el.lockon.style.setProperty('--p', String(progress));
    el.lockon.classList.toggle('locked', progress >= 1);
    el.locktext.textContent = progress >= 1 ? 'locked' : 'lock';
  };
  // Q goes back to whatever you were holding before, which is the swap you
  // actually want in a fight.
  weapon.onSwapFrom = (from) => { state.lastWeapon = from; };

  soldiers.onShot = (s, damage) => {
    audio.gunshot('rifle');
    effects.tracer(s.x, s.y + 1.45, s.z,
      camera.position[0], camera.position[1], camera.position[2], false);
    if (damage > 0 && combat.health > 0) combat.hurt(damage, s.x, s.z, player.x, player.z);
  };
  soldiers.onSlip = (s) => {
    toast('down he goes');
    feed('<b>slipped</b> on a banana');
  };

  drones.onShot = (d, damage) => {
    if (combat.health <= 0) return;
    effects.tracer(d.x, d.y - 0.2, d.z, camera.position[0], camera.position[1], camera.position[2], false);
    combat.hurt(damage, d.x, d.z, player.x, player.z);
  };

  reflex.onStart = () => { audio.reflex(true); el.hud.classList.add('slow'); };
  reflex.onStop = () => { audio.reflex(false); el.hud.classList.remove('slow'); };
  reflex.onEmpty = () => toast('reflex spent');

  combat.onShieldBreak = () => {
    audio.shieldBreak();
    effects.shake = Math.min(1.4, effects.shake + 0.35);
    el.shieldflash.classList.add('broken', 'on');
    clearTimeout(state.shieldTimer);
    state.shieldTimer = setTimeout(() => el.shieldflash.classList.remove('on'), 520);
    toast('shield down');
  };
  combat.onShieldFull = () => {
    audio.shieldCharge(false);
    audio.shieldFull();
    el.shieldflash.classList.remove('broken');
  };
  combat.onDifficulty = (rules) => {
    toast(`${rules.label}`);
    try { localStorage.setItem('spreefall.difficulty', rules.name); } catch { /* private mode */ }
    soldiers.accuracyScale = rules.enemyAccuracy;
    jets.accuracyScale = rules.enemyAccuracy;
    reflex.drainScale = rules.reflexDrain;
  };

  combat.onHurt = () => {
    audio.playerHurt();
    // A hit that the shield ate flashes blue at the edge of the screen; one
    // that reached you is the red vignette below.
    if (combat.shield > 0) {
      el.shieldflash.classList.remove('broken');
      el.shieldflash.classList.add('on');
      clearTimeout(state.shieldTimer);
      state.shieldTimer = setTimeout(() => el.shieldflash.classList.remove('on'), 220);
    }
    effects.shake = Math.min(1, effects.shake + 0.3);
    const dir = combat.damageDir;
    // Put the red vignette on the side the shot came from.
    const basis = new Float32Array(4);
    camera.walkBasis(basis);
    const right = dir.x * basis[2] + dir.z * basis[3];
    const fwd = dir.x * basis[0] + dir.z * basis[1];
    el.damage.style.setProperty('--dx', `${50 + right * 46}%`);
    el.damage.style.setProperty('--dy', `${50 - fwd * 30}%`);
    el.damage.classList.add('on');
    clearTimeout(combat._dmgTimer);
    combat._dmgTimer = setTimeout(() => el.damage.classList.remove('on'), 140);
  };

  combat.onDown = () => {
    input.exitLock();
    el.downText.textContent =
      `You held out for ${formatClock(combat.elapsed)} at threat level ${combat.tier + 1}, `
      + `took down ${combat.kills} drone${combat.kills === 1 ? '' : 's'} `
      + `and scored ${combat.score.toLocaleString()}. Nothing here is permanent.`;
    el.down.classList.remove('hidden');
  };

  combat.onTier = (tier) => {
    drones.setTier(tier);
    soldiers.setTier(tier);
    jets.setTier(tier);
    if (tier === 2) toast('air support inbound');
    feed(`<b>threat level ${tier + 1}</b>`);
    toast(`threat level ${tier + 1}`);
  };

  el.downBtn.addEventListener('click', () => {
    el.down.classList.add('hidden');
    combat.revive();
    weapon.reset();
    drones.reset();
    soldiers.reset();
    jets.reset();
    projectiles.clear();
    reflex.reset();
    renderer.clearScars();
    drones.setTier(Math.max(0, combat.tier - 1));
    effects.clear();
    if (!isTouch) input.requestLock();
  });

  function formatClock(seconds) {
    const mm = Math.floor(seconds / 60);
    const ss = Math.floor(seconds % 60);
    return `${mm}:${String(ss).padStart(2, '0')}`;
  }

  input.onLockChange = (locked) => {
    el.canvas.classList.toggle('locked', locked);
    if (!locked && state.mode === 'walk' && !photo.active) toast('click to look around again');
  };

  function beginWalk() {
    el.title.classList.add('hidden');
    el.hud.classList.remove('hidden');
    landmarks.reset();
    combat.reset();
    drones.reset();
    weapon.reset();
    effects.clear();
    audio.start();
    el.btnSound.textContent = 'sound on';
    if (deepLink) {
      state.mode = 'walk';
      state.walking = true;
    } else {
      state.mode = 'intro';
      state.dronePose = intro.sample(performance.now() / 1000);
    }
    if (!isTouch) input.requestLock();
  }
  el.play.addEventListener('click', beginWalk);

  // The difficulty buttons on the title screen.
  const diffButtons = [...document.querySelectorAll('.difficulty .diff')];
  const showDifficulty = () => {
    for (const b of diffButtons) b.classList.toggle('on', b.dataset.diff === combat.rules.name);
    const r = combat.rules;
    el.diffnote.textContent = r.name === 'easy'
      ? 'Shields take the hit first and come back fast, your health comes back too, and they shoot straighter than you do only half the time.'
      : r.name === 'hard'
        ? 'Thin shields, a long wait before they come back, and everything out there hits harder and more often.'
        : 'Shields take the hit first and come back on their own after a few seconds out of the fire. Your health does not.';
  };
  for (const b of diffButtons) {
    b.addEventListener('click', () => {
      combat.setDifficulty(b.dataset.diff);
      showDifficulty();
    });
  }
  showDifficulty();

  function skipIntro() {
    if (state.mode !== 'intro') return;
    state.mode = 'landing';
    state.landFrom = { ...state.dronePose };
  }

  el.btnMap.addEventListener('click', () => minimap.toggle());
  el.btnHelp.addEventListener('click', () => el.help.classList.toggle('hidden'));
  el.helpClose.addEventListener('click', () => el.help.classList.add('hidden'));
  el.btnSound.addEventListener('click', () => {
    const on = audio.toggle();
    el.btnSound.textContent = on ? 'sound on' : 'sound off';
  });
  el.btnPhoto.addEventListener('click', () => togglePhoto());
  el.photoClose.addEventListener('click', () => togglePhoto());
  el.completionClose.addEventListener('click', () => el.completion.classList.add('hidden'));

  function togglePhoto() {
    const on = photo.toggle();
    if (on) { input.exitLock(); } else if (!isTouch) { input.requestLock(); }
  }

  el.tod.addEventListener('input', () => {
    renderer.timeOfDay = parseFloat(el.tod.value);
    el.todLabel.textContent = timeLabel(renderer.timeOfDay);
  });
  el.doy.addEventListener('input', () => {
    renderer.dayOfYear = parseInt(el.doy.value, 10);
    el.doyLabel.textContent = dayLabel(renderer.dayOfYear);
  });
  el.shoot.addEventListener('click', () => photo.requestShot());
  el.copylink.addEventListener('click', async () => {
    const url = writeState({
      x: player.x, z: player.z, yaw: camera.yaw, pitch: camera.pitch,
      tod: renderer.timeOfDay, doy: renderer.dayOfYear,
    });
    try {
      await navigator.clipboard.writeText(url);
      toast('link copied');
    } catch {
      toast(url, 6000);
    }
  });

  el.canvas.addEventListener('click', () => {
    if (state.mode === 'intro') { skipIntro(); return; }
    if (state.mode === 'walk' && !photo.active && !isTouch && !input.pointerLocked) input.requestLock();
  });

  input.onKeyPress = (code) => {
    if (code === 'Escape') { el.help.classList.add('hidden'); return; }
    if (state.mode === 'title') { if (code === 'Enter' || code === 'Space') beginWalk(); return; }
    if (state.mode === 'intro') { skipIntro(); return; }
    switch (code) {
      case 'KeyP': togglePhoto(); break;
      case 'KeyM': minimap.toggle(); break;
      case 'KeyH': el.help.classList.toggle('hidden'); break;
      case 'KeyN': {
        const on = audio.toggle();
        el.btnSound.textContent = on ? 'sound on' : 'sound off';
        break;
      }
      case 'KeyR': weapon.startReload(); break;
      case 'KeyG':
        state.holstered = !state.holstered;
        toast(state.holstered ? 'weapon holstered' : 'weapon ready');
        break;
      case 'KeyF': state.debug = !state.debug; el.debug.classList.toggle('hidden', !state.debug); break;
      case 'KeyQ': weapon.select(state.lastWeapon || 'm16'); break;
      case 'KeyE': case 'ShiftRight': reflex.toggle(); break;
      case 'KeyT': {
        const n = weapon.detonate();
        if (n) toast(`${n} charge${n === 1 ? '' : 's'} blown`);
        break;
      }
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
      case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9': case 'Digit0':
        weapon.selectSlot(Number(code.slice(5)));
        break;
      // The number row carries the weapons now, so the quality tiers moved to
      // the function keys.
      case 'F1': setQuality('low'); break;
      case 'F2': setQuality('medium'); break;
      case 'F3': setQuality('high'); break;
      case 'F5': combat.setDifficulty('easy'); break;
      case 'F6': combat.setDifficulty('normal'); break;
      case 'F7': combat.setDifficulty('hard'); break;
      default: break;
    }
  };

  /**
   * Recoil composes with looking around here, in one place. It is carried as an
   * offset: whatever the last frame added is taken back before this frame's is
   * applied, so when the spring settles the view is exactly where you were
   * pointing it. Only the small permanent share each weapon keeps stays behind,
   * which is what makes a burst walk without stranding your aim in the sky the
   * way the first version did.
   */
  function applyRecoil() {
    camera.pitch = clamp(
      camera.pitch - state.recoilApplied.pitch + weapon.recoilPitch + weapon.takeClimb(),
      -1.55, 1.55);
    camera.yaw += weapon.recoilYaw - state.recoilApplied.yaw;
    state.recoilApplied.pitch = weapon.recoilPitch;
    state.recoilApplied.yaw = weapon.recoilYaw;
  }

  function setQuality(name) {
    renderer.setQuality(name);
    resize();
    toast(`quality: ${name}`);
  }

  function showCompletion(seconds, metres) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    el.completionText.textContent =
      `You walked ${(metres / 1000).toFixed(2)} kilometres in ${mins} minutes ${secs} seconds `
      + `and stood in front of all eleven. The Spree keeps going east from here.`;
    el.completion.classList.remove('hidden');
  }

  // --- simulation ----------------------------------------------------------
  const basis = new Float32Array(4);
  let urlTimer = 0;

  function fixed(dt) {
    // dt is a slice of real time. The reflex decides how much of it the world
    // gets: you keep all of it, which is the whole trick.
    const scale = reflex.update(dt);
    const worldDt = dt * scale;
    // You slow down too, but nothing like as much, so you can walk out of a
    // burst that is hanging in the air.
    const selfDt = dt * (0.55 + 0.45 * scale);
    state.timeScale = scale;
    state.time += worldDt;
    input.poll();

    if (state.mode === 'intro' || state.mode === 'landing') return;

    const [lx, ly] = input.takeLook();
    if (state.mode === 'walk' && !photo.active) camera.rotate(lx, ly);

    if (state.mode !== 'walk') return;

    state.prev.x = player.x; state.prev.y = player.y; state.prev.z = player.z;

    let wishX = 0, wishZ = 0;
    if (!photo.active) {
      camera.walkBasis(basis);
      const speed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
      wishX = (basis[0] * input.moveZ + basis[2] * input.moveX) * speed;
      wishZ = (basis[1] * input.moveZ + basis[3] * input.moveX) * speed;
    }
    const wasGround = player.onGround;
    // Jumping while the reflex is running spends a slice of the meter and
    // throws you most of a storey into the air.
    const jumped = !photo.active && input.takeJump();
    let boost = 1;
    if (jumped && player.onGround && reflex.active) {
      boost = reflex.leap();
      if (boost > 1) audio.leap();
    }
    player.step(selfDt, wishX, wishZ, jumped, boost);
    player.vx = wishX; player.vz = wishZ;
    if (!wasGround && player.onGround) audio.land(player.surface);

    state.curr.x = player.x; state.curr.y = player.y; state.curr.z = player.z;

    landmarks.update(player.x, player.z, dt, player.distanceWalked);

    // --- combat ---
    const eye = {
      x: player.x,
      y: player.y + PLAYER.eye,
      z: player.z,
      alive: combat.health > 0,
    };
    state.inSanctuary = combat.isSanctuary(eye.x, eye.y, eye.z);
    const holstered = state.holstered || photo.active || state.inSanctuary || combat.health <= 0;
    weapon.setHolstered(holstered);
    weapon.aiming = input.secondary && !holstered;

    const dir = {
      x: camera.forward[0], y: camera.forward[1], z: camera.forward[2],
    };
    const wantFire = input.fire && !photo.active && combat.health > 0;
    weapon.update(dt, wantFire, eye, dir);
    // Recoil composes with looking around here, in one place. It is carried as
    // an offset: whatever the last frame added is taken back before this
    // frame's is applied, so when the spring settles the view is exactly where
    // you were pointing it. Only the small permanent share each weapon keeps
    // stays behind, which is what makes a burst walk without stranding your aim
    // in the sky the way the first version did.
    applyRecoil();

    // The world runs on the slowed clock. The weapon above does not, which is
    // why a magazine goes further in here than it does outside.
    combat.update(worldDt);
    projectiles.update(worldDt);
    drones.update(worldDt, eye, state.time);
    soldiers.update(worldDt, { x: player.x, y: player.y + PLAYER.eye, z: player.z,
      alive: combat.health > 0 }, state.time);
    jets.update(worldDt, { x: player.x, y: player.y + PLAYER.eye, z: player.z,
      vx: player.vx, vz: player.vz, alive: combat.health > 0 }, state.time);

    audio.update(dt, player, camera);
    audio.setTimeScale(scale);
    let nearest = null;
    for (const d of drones.active) {
      if (d.state === DRONE_STATE.DYING) continue;
      const dd = Math.hypot(d.x - eye.x, d.y - eye.y, d.z - eye.z);
      if (nearest === null || dd < nearest) nearest = dd;
    }
    audio.setDroneField(nearest, drones.engaged);

    urlTimer += worldDt;
    if (urlTimer > 0.6) {
      urlTimer = 0;
      writeState({
        x: player.x, z: player.z, yaw: camera.yaw, pitch: camera.pitch,
        tod: renderer.timeOfDay, doy: renderer.dayOfYear,
      });
    }
  }

  function render(alpha, elapsed) {
    const w = el.canvas.width, h = el.canvas.height;

    // The drone shot and the landing blend run off wall clock time, not off the
    // fixed simulation step. On a slow machine the simulation falls behind real
    // time, and a cinematic that plays in slow motion because the GPU is busy is
    // just a bug.
    const wall = performance.now() / 1000;
    if (state.mode === 'intro') {
      state.dronePose = intro.sample(wall);
      if (intro.t > 13.5) skipIntro();
    } else if (state.mode === 'landing') {
      const to = {
        x: player.x, y: player.y + PLAYER.eye, z: player.z,
        yaw: camera.yaw, pitch: camera.pitch,
      };
      const p = intro.land(wall, state.landFrom, to);
      state.dronePose = p;
      if (p.finished) { state.mode = 'walk'; state.walking = true; }
    }

    if (state.mode === 'title' && state.deepLink) {
      camera.position[0] = player.x;
      camera.position[1] = player.y + PLAYER.eye;
      camera.position[2] = player.z;
    } else if (state.mode === 'title' || state.mode === 'intro' || state.mode === 'landing') {
      const p = state.dronePose || intro.sample(performance.now() / 1000);
      camera.position[0] = p.x;
      camera.position[1] = p.y;
      camera.position[2] = p.z;
      camera.yaw = p.yaw;
      camera.pitch = p.pitch;
    } else {
      camera.position[0] = state.prev.x + (state.curr.x - state.prev.x) * alpha;
      camera.position[1] = state.prev.y + (state.curr.y - state.prev.y) * alpha + PLAYER.eye;
      camera.position[2] = state.prev.z + (state.curr.z - state.prev.z) * alpha;
      // A very small head bob, enough to feel like walking and not enough to
      // make anyone ill.
      if (player.onGround) {
        const sp = Math.hypot(player.vx || 0, player.vz || 0);
        camera.position[1] += Math.sin(state.time * (sp > 4 ? 11.5 : 7.4)) * Math.min(0.035, sp * 0.008);
      }
    }

    // Screen shake from firing and from explosions, applied to the eye rather
    // than to the aim, so it never moves where your shots go.
    effects.update(elapsed);
    // The muzzle flash fades over about seventy milliseconds, but the decay is
    // capped per frame so that a long frame cannot swallow it whole: a flash
    // that never renders at all is worse than one that lingers on a hitch.
    state.muzzle = Math.max(0, state.muzzle - Math.min(elapsed, 1 / 45) * 14);
    if (effects.shake > 0.001) {
      const k = effects.shake * effects.shake * 0.09;
      const t = state.time * 47;
      camera.position[0] += Math.sin(t * 1.7) * k;
      camera.position[1] += Math.sin(t * 2.3 + 1.1) * k;
      camera.position[2] += Math.sin(t * 1.3 + 2.7) * k;
    }

    camera.update(w / Math.max(1, h));

    // --- the weapon in your hands ---
    if (state.mode === 'walk' && !photo.active) {
      const speed = Math.hypot(player.vx || 0, player.vz || 0);
      state.bob += elapsed * (speed > 4 ? 11.5 : 7.4) * Math.min(1, speed / 2.6);
      // Sway lags the look, which is what makes a viewmodel feel like a weight.
      // Yaw wraps at pi, so the shortest way round is the one that counts, or
      // turning past south would fling the weapon across the screen.
      const lookX = camera.yaw, lookY = camera.pitch;
      let dYaw = lookX - (state.lastYaw ?? lookX);
      if (dYaw > Math.PI) dYaw -= Math.PI * 2;
      if (dYaw < -Math.PI) dYaw += Math.PI * 2;
      state.sway.x += dYaw;
      state.sway.y += lookY - (state.lastPitch ?? lookY);
      state.lastYaw = lookX;
      state.lastPitch = lookY;
      state.sway.x *= Math.max(0, 1 - 7 * elapsed);
      state.sway.y *= Math.max(0, 1 - 7 * elapsed);

      const aim = weapon.aimBlend;
      const hol = weapon.holsterBlend;
      const bobX = Math.sin(state.bob) * 0.009 * (1 - aim) * Math.min(1, speed / 2.6);
      const bobY = Math.abs(Math.cos(state.bob)) * -0.007 * (1 - aim) * Math.min(1, speed / 2.6);
      const kick = weapon.kick;
      // Hip fire holds the weapon down and to the right. Aiming brings the
      // sight onto the centre line, which is what the narrowed field of view
      // is actually for.
      // Each weapon may sit differently in the hand; the aim pose is shared,
      // because aiming means putting the sight on the centre line whatever you
      // are holding.
      const hip = weapon.spec.hold ? { ...VM_HIP, ...weapon.spec.hold } : VM_HIP;
      const mix = (a, b) => a + (b - a) * aim;
      // A weight left behind by the turn keeps its own orientation, so in view
      // space it rotates against the look: the translation follows the sway and
      // the rotation opposes it. Recoil lifts the muzzle and pushes the weapon
      // back towards the eye. Holstering drops it and turns the muzzle down and
      // away, so it leaves the frame at the bottom rather than across it.
      renderer.viewmodel = {
        x: mix(hip.x, VM_AIM.x) + bobX + state.sway.x * 0.30,
        y: mix(hip.y, VM_AIM.y) + bobY - state.sway.y * 0.26 - hol * 0.34,
        z: mix(hip.z, VM_AIM.z) + kick * 0.030,
        pitch: mix(hip.pitch, VM_AIM.pitch) + kick * 0.075 - state.sway.y * 0.5 - hol * 0.95,
        yaw: mix(hip.yaw, VM_AIM.yaw) - state.sway.x * 0.8,
        roll: mix(hip.roll, VM_AIM.roll) + state.sway.x * 0.45 + hol * 0.5,
        muzzle: state.muzzle * (1 - hol),
        weapon: weapon.id,
      };
      renderer.actors.updateDrones(drones.active);
      renderer.actors.updateSoldiers(soldiers.active);
      renderer.actors.updateJets(jets.active);
      renderer.actors.updateProjectiles(projectiles.active);
      renderer.actors.updateSparks(effects.list);
      renderer.drawActors = true;
    } else {
      renderer.viewmodel = null;
      renderer.actors.updateDrones(state.mode === 'walk' ? drones.active : []);
      renderer.actors.updateSoldiers(state.mode === 'walk' ? soldiers.active : []);
      renderer.actors.updateJets(state.mode === 'walk' ? jets.active : []);
      renderer.actors.updateProjectiles(state.mode === 'walk' ? projectiles.active : []);
      renderer.actors.updateSparks(state.mode === 'walk' ? effects.list : []);
      renderer.drawActors = state.mode === 'walk';
    }

    tiles.updateResidency(camera.position[0], camera.position[2], loop.frame);
    // Dynamic resolution, fed the real cost of the last frame. When it decides
    // to move, the scene target is rebuilt at the new size; the page and the
    // interface never change.
    if (renderer.updateDynamicScale(loop.stats.intervalMs)) resize();
    renderer.render(camera, state.time, w, h);

    if (photo.pendingShot) {
      photo.capture(`${timeLabel(renderer.timeOfDay)}, ${dayLabel(renderer.dayOfYear)}`);
    }

    if (state.mode === 'walk' && !photo.active) {
      // Combat interface.
      const hp = Math.round(combat.health);
      el.healthbar.style.width = `${Math.max(0, combat.health)}%`;
      el.healthnum.textContent = String(hp);
      el.combat.classList.toggle('hurt', combat.health < 45);
      el.shieldbar.style.width = `${combat.shieldFraction * 100}%`;
      el.shieldnum.textContent = String(Math.round(combat.shield));
      el.combat.classList.toggle('recharging', combat.recharging);
      el.reflexbar.style.width = `${reflex.fraction * 100}%`;
      el.combat.classList.toggle('reflexready', reflex.ready);
      renderer.reflex = reflex.blend;
      el.combat.classList.toggle('broken', combat.shield <= 0);
      // The recharge tone runs for as long as the recharge does.
      const wantCharge = combat.recharging && combat.health > 0;
      if (wantCharge !== state.charging) {
        state.charging = wantCharge;
        audio.shieldCharge(wantCharge,
          (combat.maxShield - combat.shield) / combat.rules.shieldRate);
      }
      el.ammonum.textContent = String(weapon.ammo);
      el.reservenum.textContent = String(weapon.reserve);
      el.combat.classList.toggle('empty', weapon.ammo === 0);
      el.reloadhint.classList.toggle('hidden', weapon.state !== 2);
      el.tiernum.textContent = String(combat.tier + 1);
      el.contactnum.textContent = String(drones.engaged + soldiers.engaged + jets.engaged);
      el.scorenum.textContent = combat.score.toLocaleString();
      // The crosshair opens with the spread cone.
      const px = Math.round(6 + (weapon.spread / weapon.spec.spreadMax) * 30);
      el.crosshair.style.setProperty('--gap', `${px}px`);
      el.crosshair.classList.toggle('aiming', weapon.aimBlend > 0.6);
      el.crosshair.classList.toggle('holstered', weapon.holstered);
      // Aiming narrows the field of view, which is most of what aiming is.
      camera.fov = 68 * DEG + (weapon.spec.aimFov * DEG - 68 * DEG) * weapon.aimBlend;
      if (state.inSanctuary !== state.sanctuaryShown) {
        state.sanctuaryShown = state.inSanctuary;
        if (state.inSanctuary) {
          const name = combat.sanctuaryName(player.x, player.z) || 'This place';
          el.sanctuary.innerHTML =
            `<b>weapons free zone</b>${name} is a memorial. `
            + 'The weapon holsters itself here and nothing will follow you in.';
          el.sanctuary.classList.remove('hidden');
        } else {
          el.sanctuary.classList.add('hidden');
        }
      }
    }

    if (state.mode === 'walk' || state.mode === 'landing') {
      minimap.draw(camera.position[0], camera.position[2], camera.yaw, landmarks.found);
      el.found.textContent = String(landmarks.found.size);
      const deg = ((-camera.yaw * 180 / Math.PI) % 360 + 360) % 360;
      const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      el.compass.textContent = `${names[Math.round(deg / 45) % 8]} ${Math.round(deg)}`;
    }

    // Automatic quality tier from the first three seconds of real frames.
    if (!state.autoQualityDone && state.mode !== 'title') {
      state.frameSamples.push(elapsed);
      if (state.frameSamples.length > 20 && state.time > 3.2) {
        const sorted = state.frameSamples.slice(-90).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] * 1000;
        state.autoQualityDone = true;
        if (median > 26) { setQuality('low'); }
        else if (median > 17) { setQuality('medium'); }
      }
    }

    if (state.debug) {
      const s = renderer.stats;
      const ts = tiles.stats;
      el.debug.textContent =
        `fps        ${loop.stats.fps.toFixed(1)}\n`
        + `frame      ${loop.stats.frameMs.toFixed(2)} ms cpu, ${loop.stats.intervalMs.toFixed(1)} ms wall\n`
        + `draw calls ${s.drawCalls} (+${s.shadowDraws} shadow)\n`
        + `triangles  ${s.triangles.toLocaleString()}\n`
        + `tiles      ${ts.visible} visible, ${ts.resident} resident\n`
        + `gpu bytes  ${(ts.bytes / 1e6).toFixed(1)} MB\n`
        + `quality    ${renderer.quality}, scale ${(renderer.effectiveScale * 100).toFixed(0)}%`
        + ` (${renderer.width} by ${renderer.height})\n`
        + `drones     ${drones.count} live, soldiers ${soldiers.count} live\n`
        + `reflex     ${(reflex.fraction * 100).toFixed(0)}%, time ${state.timeScale.toFixed(2)}x\n`
        + `pos        ${camera.position[0].toFixed(1)}, ${camera.position[1].toFixed(1)}, ${camera.position[2].toFixed(1)}\n`
        + `ground     ${player.groundY.toFixed(2)}  surface ${['asphalt', 'cobble', 'grass', 'water', 'gravel', 'stone'][player.surface]}\n`
        + `sun alt    ${(renderer.sunAltitude * 180 / Math.PI).toFixed(1)} deg, night ${renderer.night.toFixed(2)}\n`
        + `walked     ${(player.distanceWalked / 1000).toFixed(3)} km\n`
        + `engaged    ${drones.engaged + soldiers.engaged}, tier ${combat.tier + 1}\n`
        + `weapon     ${weapon.ammo}/${weapon.reserve}  spread ${(weapon.spread * 1000).toFixed(1)} mrad  `
        + `accuracy ${(weapon.accuracy * 100).toFixed(0)}%\n`
        + `health     ${combat.health.toFixed(0)}  score ${combat.score}  kills ${combat.kills}`;
    }
  }

  const loop = new Loop({ hz: 60, onFixed: fixed, onRender: render });

  el.loading.classList.add('hidden');
  el.title.classList.remove('hidden');
  loop.start();

  // Expose a small handle for the headless checks and for the curious.
  window.spreefall = {
    world, renderer, tiles, camera, player, loop, state, landmarks, audio, input,
    combat, drones, weapon, effects, projectiles, reflex, jets,
    get soldiers() { return soldiers; },
    spawnJet(dx, dz, height = 80) {
      const j = jets.free();
      if (!j) return null;
      const x = player.x + dx, z = player.z + dz;
      j.spawn(x, world.groundHeight(x, z) + height, z,
        Math.atan2(-(player.x - x), -(player.z - z)), combat.tier);
      jets.active.push(j);
      return j;
    },
    spawnSoldier(dx, dz) {
      const s = soldiers.free();
      if (!s) return null;
      const x = player.x + dx, z = player.z + dz;
      s.spawn(x, world.groundHeight(x, z), z, combat.tier);
      soldiers.active.push(s);
      return s;
    },
    spawnDrone(dx, dy, dz) {
      const d = drones.free();
      if (!d) return null;
      d.spawn(player.x + dx, player.y + PLAYER.eye + dy, player.z + dz, combat.tier);
      drones.active.push(d);
      return d;
    },
    shoot() {
      weapon.fire(
        { x: player.x, y: player.y + PLAYER.eye, z: player.z },
        { x: camera.forward[0], y: camera.forward[1], z: camera.forward[2] },
      );
    },
    teleport(x, z) { player.teleport(x, z); state.prev = { x, y: player.y, z }; state.curr = { x, y: player.y, z }; },
    look(yawDeg, pitchDeg) { camera.yaw = yawDeg * DEG; camera.pitch = pitchDeg * DEG; },
    setTime(t) { renderer.timeOfDay = t; el.tod.value = String(t); },
    debugMode(n) { renderer.debugMode = n | 0; },
    setQuality(name) { setQuality(name); },
    viewmodelPose: { hip: VM_HIP, aim: VM_AIM },
    applyRecoil() { applyRecoil(); },
    loadout: LOADOUT,
    weapons: WEAPONS,
    skipToWalk() {
      el.title.classList.add('hidden');
      el.hud.classList.remove('hidden');
      landmarks.reset();
      state.mode = 'walk';
      state.walking = true;
    },
  };
}

main().catch((e) => fatal('Something went wrong while starting up.', e.stack || e.message));
