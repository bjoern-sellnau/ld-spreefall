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
import { Weapon, SPEC as WEAPON } from './game/weapon.js';
import { Combat, COMBAT } from './game/combat.js';
import { Effects } from './game/effects.js';
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
  const combat = new Combat(m);
  const drones = new Drones(world, (x, y, z) => combat.isSanctuary(x, y, z));
  const weapon = new Weapon(world, drones);
  const effects = new Effects();

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

  weapon.onFire = (shot) => {
    audio.gunshot();
    // The tracer leaves the muzzle, not the eye, so it agrees with the weapon
    // you can see in your hands. Hip fire holds the barrel down and right; the
    // aim blend brings it back onto the centre line.
    const off = 1 - weapon.aimBlend;
    const mx = shot.from.x + camera.right[0] * 0.09 * off + camera.up[0] * (-0.13 - 0.03 * off)
      + camera.forward[0] * 0.55;
    const my = shot.from.y + camera.right[1] * 0.09 * off + camera.up[1] * (-0.13 - 0.03 * off)
      + camera.forward[1] * 0.55;
    const mz = shot.from.z + camera.right[2] * 0.09 * off + camera.up[2] * (-0.13 - 0.03 * off)
      + camera.forward[2] * 0.55;
    effects.tracer(mx, my, mz, shot.end.x, shot.end.y, shot.end.z, true);
    effects.impact(shot.end.x, shot.end.y, shot.end.z,
      shot.end.nx, shot.end.ny, shot.end.nz, shot.surface);
    effects.shake = Math.min(1, effects.shake + 0.07);
    state.muzzle = 1;
    if (shot.drone) {
      audio.hitMarker(shot.core);
      showHitmarker(shot.killed ? 'kill' : (shot.core ? 'core' : ''));
      if (shot.killed) {
        const dist = Math.hypot(shot.drone.x - player.x, shot.drone.z - player.z);
        combat.creditKill(shot.core, dist);
        effects.explode(shot.drone.x, shot.drone.y, shot.drone.z);
        audio.droneDown();
        feed(`<b>drone down</b> ${Math.round(dist)} m${shot.core ? ' <i>core</i>' : ''}`);
      }
    }
  };
  weapon.onDryFire = () => audio.dryFire();
  weapon.onReloadStart = () => audio.reload(WEAPON.reloadTime);

  drones.onShot = (d, damage) => {
    if (combat.health <= 0) return;
    effects.tracer(d.x, d.y - 0.2, d.z, camera.position[0], camera.position[1], camera.position[2], false);
    combat.hurt(damage, d.x, d.z, player.x, player.z);
  };

  combat.onHurt = () => {
    audio.playerHurt();
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
    feed(`<b>threat level ${tier + 1}</b>`);
    toast(`threat level ${tier + 1}`);
  };

  el.downBtn.addEventListener('click', () => {
    el.down.classList.add('hidden');
    combat.revive();
    weapon.reset();
    drones.reset();
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
      case 'Digit1': setQuality('low'); break;
      case 'Digit2': setQuality('medium'); break;
      case 'Digit3': setQuality('high'); break;
      default: break;
    }
  };

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
    state.time += dt;
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
    player.step(dt, wishX, wishZ, !photo.active && input.takeJump());
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
    // The recoil kick is applied to the camera here rather than inside the
    // weapon, so that looking around and recoil compose in one place.
    camera.pitch = clamp(camera.pitch + weapon.recoilPitch * dt * 60, -1.55, 1.55);
    camera.yaw += weapon.recoilYaw * dt * 60;
    weapon.recoilPitch *= Math.max(0, 1 - 12 * dt);

    combat.update(dt);
    drones.update(dt, eye, state.time);

    audio.update(dt, player, camera);
    let nearest = null;
    for (const d of drones.active) {
      if (d.state === DRONE_STATE.DYING) continue;
      const dd = Math.hypot(d.x - eye.x, d.y - eye.y, d.z - eye.z);
      if (nearest === null || dd < nearest) nearest = dd;
    }
    audio.setDroneField(nearest, drones.engaged);

    urlTimer += dt;
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
      const mix = (a, b) => a + (b - a) * aim;
      // A weight left behind by the turn keeps its own orientation, so in view
      // space it rotates against the look: the translation follows the sway and
      // the rotation opposes it. Recoil lifts the muzzle and pushes the weapon
      // back towards the eye. Holstering drops it and turns the muzzle down and
      // away, so it leaves the frame at the bottom rather than across it.
      renderer.viewmodel = {
        x: mix(VM_HIP.x, VM_AIM.x) + bobX + state.sway.x * 0.30,
        y: mix(VM_HIP.y, VM_AIM.y) + bobY - state.sway.y * 0.26 - hol * 0.34,
        z: mix(VM_HIP.z, VM_AIM.z) + kick * 0.030,
        pitch: mix(VM_HIP.pitch, VM_AIM.pitch) + kick * 0.075 - state.sway.y * 0.5 - hol * 0.95,
        yaw: mix(VM_HIP.yaw, VM_AIM.yaw) - state.sway.x * 0.8,
        roll: mix(VM_HIP.roll, VM_AIM.roll) + state.sway.x * 0.45 + hol * 0.5,
        muzzle: state.muzzle * (1 - hol),
      };
      renderer.actors.updateDrones(drones.active);
      renderer.actors.updateSparks(effects.list);
      renderer.drawActors = true;
    } else {
      renderer.viewmodel = null;
      renderer.actors.updateDrones(state.mode === 'walk' ? drones.active : []);
      renderer.actors.updateSparks(state.mode === 'walk' ? effects.list : []);
      renderer.drawActors = state.mode === 'walk';
    }

    tiles.updateResidency(camera.position[0], camera.position[2], loop.frame);
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
      el.ammonum.textContent = String(weapon.ammo);
      el.reservenum.textContent = String(weapon.reserve);
      el.combat.classList.toggle('empty', weapon.ammo === 0);
      el.reloadhint.classList.toggle('hidden', weapon.state !== 2);
      el.tiernum.textContent = String(combat.tier + 1);
      el.contactnum.textContent = String(drones.engaged);
      el.scorenum.textContent = combat.score.toLocaleString();
      // The crosshair opens with the spread cone.
      const px = Math.round(6 + (weapon.spread / WEAPON.spreadMax) * 30);
      el.crosshair.style.setProperty('--gap', `${px}px`);
      el.crosshair.classList.toggle('aiming', weapon.aimBlend > 0.6);
      el.crosshair.classList.toggle('holstered', weapon.holstered);
      // Aiming narrows the field of view, which is most of what aiming is.
      camera.fov = 68 * DEG + (WEAPON.aimFov - 68 * DEG) * weapon.aimBlend;
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
        + `frame      ${loop.stats.frameMs.toFixed(2)} ms\n`
        + `draw calls ${s.drawCalls} (+${s.shadowDraws} shadow)\n`
        + `triangles  ${s.triangles.toLocaleString()}\n`
        + `tiles      ${ts.visible} visible, ${ts.resident} resident\n`
        + `gpu bytes  ${(ts.bytes / 1e6).toFixed(1)} MB\n`
        + `quality    ${renderer.quality}\n`
        + `pos        ${camera.position[0].toFixed(1)}, ${camera.position[1].toFixed(1)}, ${camera.position[2].toFixed(1)}\n`
        + `ground     ${player.groundY.toFixed(2)}  surface ${['asphalt', 'cobble', 'grass', 'water', 'gravel', 'stone'][player.surface]}\n`
        + `sun alt    ${(renderer.sunAltitude * 180 / Math.PI).toFixed(1)} deg, night ${renderer.night.toFixed(2)}\n`
        + `walked     ${(player.distanceWalked / 1000).toFixed(3)} km\n`
        + `drones     ${drones.count} live, ${drones.engaged} engaged, tier ${combat.tier + 1}\n`
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
    combat, drones, weapon, effects,
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
    viewmodelPose: { hip: VM_HIP, aim: VM_AIM },
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
