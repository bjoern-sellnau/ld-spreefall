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
  touchui: $('touchui'), stick: $('stick'), knob: $('stickknob'),
  btnJump: $('btnjump'), btnRun: $('btnrun'), source: $('datasource'),
  attribution: $('attribution'), controlhint: $('controlhint'),
};

const DEG = Math.PI / 180;
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

  input.onLockChange = (locked) => {
    el.canvas.classList.toggle('locked', locked);
    if (!locked && state.mode === 'walk' && !photo.active) toast('click to look around again');
  };

  function beginWalk() {
    el.title.classList.add('hidden');
    el.hud.classList.remove('hidden');
    landmarks.reset();
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
    audio.update(dt, player, camera);

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

    camera.update(w / Math.max(1, h));
    tiles.updateResidency(camera.position[0], camera.position[2], loop.frame);
    renderer.render(camera, state.time, w, h);

    if (photo.pendingShot) {
      photo.capture(`${timeLabel(renderer.timeOfDay)}, ${dayLabel(renderer.dayOfYear)}`);
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
        + `walked     ${(player.distanceWalked / 1000).toFixed(3)} km`;
    }
  }

  const loop = new Loop({ hz: 60, onFixed: fixed, onRender: render });

  el.loading.classList.add('hidden');
  el.title.classList.remove('hidden');
  loop.start();

  // Expose a small handle for the headless checks and for the curious.
  window.spreefall = {
    world, renderer, tiles, camera, player, loop, state, landmarks, audio,
    teleport(x, z) { player.teleport(x, z); state.prev = { x, y: player.y, z }; state.curr = { x, y: player.y, z }; },
    look(yawDeg, pitchDeg) { camera.yaw = yawDeg * DEG; camera.pitch = pitchDeg * DEG; },
    setTime(t) { renderer.timeOfDay = t; el.tod.value = String(t); },
    debugMode(n) { renderer.debugMode = n | 0; },
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
