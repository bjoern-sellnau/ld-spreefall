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
import { Pickups, PICKUP } from './game/pickups.js';
import { Cheats, SWITCHES, GORE, ACTIONS, SPAWNS, RIDES, SETTINGS } from './game/cheats.js';
import { Gibs } from './game/gibs.js';
import { Demolition, DEMO, bite, craterAt } from './game/demolition.js';
import { Travel, TRAVEL } from './game/travel.js';
import { Cinema, CINEMA } from './game/cinema.js';
import { Fires } from './game/fires.js';
import { FireWalls } from './game/firewall.js';
import { Machines, MACHINES, makeMachine, empBurst } from './game/machines.js';
import { Ion, ION, ION_STATE } from './game/ion.js';
import { Vehicles, VEHICLE } from './game/vehicles.js';
import { Mechs, MECH, ARMS, MECH_PITCH, TITANFALL } from './game/mechs.js';
import { MACHINE_MUZZLE } from './render/actors.js';
import { PLAYER, SPAWN, SURFACE } from './shared/constants.js';

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('view'), loading: $('loading'), loadbar: $('loadbar'), loadnote: $('loadnote'),
  title: $('title'), play: $('playbtn'), hud: $('hud'), minimap: $('minimap'),
  compass: $('compasslabel'), cards: $('cardhost'), toast: $('toast'), debug: $('debug'),
  found: $('found'), total: $('total'), district: $('district'), photo: $('photo'), tod: $('tod'), doy: $('doy'),
  todLabel: $('todlabel'), doyLabel: $('doylabel'), shoot: $('shoot'), copylink: $('copylink'),
  photoClose: $('photoclose'), help: $('helppanel'), helpClose: $('helpclose'),
  completion: $('completion'), completionText: $('completiontext'), completionClose: $('completionclose'),
  btnMap: $('btnmap'), btnPhoto: $('btnphoto'), btnSound: $('btnsound'), btnHelp: $('btnhelp'),
  btnTravel: $('btntravel'),
  crosshair: $('crosshair'), hitmarker: $('hitmarker'), damage: $('damage'),
  combat: $('combat'), healthbar: $('healthbar'), healthnum: $('healthnum'),
  ammonum: $('ammonum'), reservenum: $('reservenum'), reloadhint: $('reloadhint'),
  shieldbar: $('shieldbar'), shieldnum: $('shieldnum'), shieldflash: $('shieldflash'),
  reflexbar: $('reflexbar'), lockon: $('lockon'), locktext: $('locktext'),
  diffnote: $('diffnote'),
  weaponname: $('weaponname'),
  tiernum: $('tiernum'), contactnum: $('contactnum'), scorenum: $('scorenum'),
  sanctuary: $('sanctuary'), killfeed: $('killfeed'), powers: $('powers'),
  cheats: $('cheats'), cheatActions: $('cheatactions'), cheatSwitches: $('cheatswitches'),
  cheatValues: $('cheatvalues'),
  crossing: $('crossing'), crossName: $('crossname'), crossNote: $('crossnote'),
  crossFill: $('crossfill'), crossHint: $('crosshint'),
  crossSightLine: $('crosssightline'), crossSight: $('crosssight'),
  modeNote: $('modenote'), timePick: $('timepick'),
  modeTime: $('modetime'), modeTimeLabel: $('modetimelabel'),
  cheatSpawns: $('cheatspawns'), cheatRides: $('cheatrides'),
  vehiclePanel: $('vehicle'), vehicleName: $('vehiclename'), vehicleKeys: $('vehiclekeys'),
  vehicleHull: $('vehiclehull'), vehicleSpeed: $('vehiclespeed'),
  vehicleSpeedUnit: $('vehiclespeedunit'),
  vehicleAltStat: $('vehiclealtstat'), vehicleAlt: $('vehiclealt'),
  vehicleGun: $('vehiclegun'), vehicleGunLabel: $('vehiclegunlabel'),
  vehicleRockStat: $('vehiclerockstat'), vehicleRock: $('vehiclerock'),
  vehicleDashStat: $('vehicledashstat'), vehicleDash: $('vehicledash'),
  vehicleWarn: $('vehiclewarn'),
  rideHint: $('ridehint'), rideHintName: $('ridehintname'),
  titanfall: $('titanfall'), titanfallSub: $('titanfallsub'),
  mechHud: $('mechhud'), mechArms: $('mecharms'), mechCharge: $('mechcharge'),
  mechName: $('mechname'),
  mechHull: $('mechhull'), mechHullNum: $('mechhullnum'),
  mechShieldLine: $('mechshieldline'), mechShield: $('mechshield'),
  mechShieldNum: $('mechshieldnum'),
  mechAmmo: $('mechammo'), mechPod: $('mechpod'), mechDash: $('mechdash'),
  mechWarn: $('mechwarn'),
  cheatGore: $('cheatgore'), cheatsClose: $('cheatsclose'), cheatsReset: $('cheatsreset'),
  cheatMark: $('cheatmark'), nukeTarget: $('nuketarget'), targetMap: $('targetmap'),
  targetHint: $('targethint'), cinemaHint: $('cinemahint'),
  targetIn: $('targetin'), targetOut: $('targetout'),
  targetFit: $('targetfit'), targetZoom: $('targetzoom'),
  targetConfirm: $('targetconfirm'), confirmWhere: $('confirmwhere'),
  confirmSelf: $('confirmself'), confirmFire: $('confirmfire'),
  confirmCancel: $('confirmcancel'),
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
  // Districts arrive and leave while you walk, and two things took a copy of
  // the city's landmarks when they were built: the cards and the weapons free
  // zone. Both are taken again whenever the city changes shape, so the
  // memorial is still a sanctuary after Mitte has been dropped and reloaded.
  world.onManifest = (manifest) => {
    landmarks.refresh(manifest);
    combat.refreshSanctuaries(manifest);
  };
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
  const pickups = new Pickups(world, (x, y, z) => combat.isSanctuary(x, y, z));
  const cheats = new Cheats();
  const gibs = new Gibs(world);
  const demolition = new Demolition(world, (x, y, z) => combat.isSanctuary(x, y, z));
  // A ruin that has stopped moving is written into the city's own bytes, and
  // the card needs the new ones. Nothing else changes: the same ruin, drawn
  // from the buffers instead of from a uniform slot, which is then free for
  // the next explosion somewhere else entirely.
  demolition.onBaked = (indices) => {
    tiles.refresh(indices);
    // A ruin written into the bytes is still a ruin with holes in it.
    for (const i of indices) renderer.scarredTiles.add(i);
  };
  // And the city remembers it. The bytes a ruin was written into are thrown
  // away when the district is unloaded, so the record goes to the world,
  // which puts it back the next time the district is loaded.
  demolition.onScar = (scar) => world.recordScar(scar);

  /**
   * Puts the ruins back in a district that has just been loaded.
   *
   * Everything about a finished ruin is in eight numbers, and replaying them
   * is the same code the live collapse ends with, so what you walk back into
   * is what you left: same cut, same heap, same crater.
   *
   * @param {string} id the district
   */
  function restoreScars(id) {
    const list = world.scarsFor(id);
    if (!list.length) return 0;
    const touched = new Set();
    for (const scar of list) {
      for (const i of demolition.replay(scar)) touched.add(i);
      scarTiles(scar.x, scar.z, scar.radius);
    }
    if (touched.size) tiles.refresh([...touched]);
    return list.length;
  }
  // A tree that has burnt down is struck off the tile it stood in, and that
  // tile's instance buffer is built again without it. It does not come back
  // when the fire burns out, and it does not come back when you walk away:
  // only a reload rebuilds the city from the bundle.
  world.onTreesChanged = (index) => tiles.refreshTrees(index);
  const travel = new Travel();
  const cinema = new Cinema();
  const fires = new Fires(world);
  const fireWalls = new FireWalls(world, (x, y, z) => combat.isSanctuary(x, y, z));
  const machines = new Machines();
  const ion = new Ion(world, (x, y, z) => combat.isSanctuary(x, y, z));
  const vehicles = new Vehicles(world, (x, y, z) => combat.isSanctuary(x, y, z));
  const mechs = new Mechs(world, (x, y, z) => combat.isSanctuary(x, y, z));
  weapon.mechs = mechs;
  soldiers.hazards = () => projectiles.hazards();
  soldiers.accuracyScale = combat.rules.enemyAccuracy;
  // A rocket goes off on whoever it hits, not on the wall behind them.
  // What a flying thing runs into on its way, so a rocket goes off against
  // the man it was aimed at rather than against the wall behind him. Every
  // body in the city is asked, the nearest one wins, and the answer says what
  // kind it is: the gun on a tank reads that to decide what to damage, and
  // without it a shell went through a soldier and did nothing at all.
  projectiles.hitActors = (x, y, z, dx, dy, dz, maxT) => {
    let best = null;
    const take = (hit, kind, target) => {
      if (!hit || !target || hit.t > maxT) return;
      if (!best || hit.t < best.t) best = { t: hit.t, kind, target, core: !!hit.core };
    };
    const vHit = vehicles.raycast(x, y, z, dx, dy, dz, maxT);
    take(vHit, 'vehicle', vHit && vHit.target);
    const d = drones.raycast(x, y, z, dx, dy, dz, maxT);
    take(d, 'drone', d && d.drone);
    const sHit = soldiers.raycast(x, y, z, dx, dy, dz, maxT);
    take(sHit, 'soldier', sHit && sHit.soldier);
    const jHit = jets.raycast(x, y, z, dx, dy, dz, maxT);
    take(jHit, 'jet', jHit && jHit.jet);
    // And a mech, which is the largest thing in the street and used to be the
    // one thing a rocket flew straight through.
    const mHit = mechs.raycast(x, y, z, dx, dy, dz, maxT);
    take(mHit, 'mech', mHit && mHit.mech);
    return best;
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

  // A link can point anywhere in the city, including a district that is not
  // the one the game loads first. Whichever it is, it is on the ground before
  // the walk starts rather than a hole you fall through.
  if (!world.isLoaded(spawn.x, spawn.z)) {
    const entry = world.entryAt(spawn.x, spawn.z);
    if (entry) {
      el.loadnote.textContent = `loading ${entry.name}`;
      try {
        await world.loadDistrict(entry.id, (p) => {
          el.loadbar.style.width = `${Math.round(p * 100)}%`;
        });
      } catch (err) {
        toast(`${entry.name} could not be loaded`);
      }
    }
  }

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

  // The pads are scattered once, around wherever you came in, so a deep link
  // into Museum Island gets a map laid out around Museum Island.
  pickups.place(spawn.x, spawn.z);
  parkVehicles();

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
    targeting: false,
    blastSlow: 0,
    mapMode: 'nuke',
    pendingNuke: null,
    travelTo: null,
    lockWanted: false,
    nukeRainTimer: 4,
    flash: 0,
    autoQualityDone: false,
    frameSamples: [],
    lastGround: true,
    // What you are sitting in, if anything. A vehicle drives and a mech
    // walks, and they are different enough to be two fields rather than one
    // with a kind on it.
    inVehicle: null,
    inMech: null,
    // Whether you are looking out of the mech's canopy or down at it from
    // over its shoulder. The cockpit is where you start, because it is what a
    // Titan is for; V swaps.
    cockpit: true,
    // A frame of muzzle glare on the inside of the canopy, which is what
    // tells you the thing you are sitting in has just fired.
    mechFlash: 0,
    unbuiltSaid: null,
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
      // A round into a man sprays rather than sparks, and only when the cheat
      // menu says so. Everything else in the city still throws grit.
      if (shot.surface === 'soldier' && cheats.bleeding) {
        // The spray goes the way the round was travelling, not back along it:
        // what you see from behind the rifle is the exit side.
        effects.blood(shot.end.x, shot.end.y, shot.end.z,
          -shot.end.nx, Math.abs(shot.end.ny) * 0.4 + 0.3, -shot.end.nz,
          cheats.goreScale * (shot.core ? 1.8 : 1));
        if (Math.random() < 0.5 || shot.core) {
          const px = shot.end.x - shot.end.nx * (0.6 + Math.random() * 1.6);
          const pz = shot.end.z - shot.end.nz * (0.6 + Math.random() * 1.6);
          effects.stain(px, world.groundHeight(px, pz), pz,
            0.14 + Math.random() * 0.22 * cheats.goreScale, 26);
        }
      } else {
        effects.impact(shot.end.x, shot.end.y, shot.end.z,
          shot.end.nx, shot.end.ny, shot.end.nz, shot.surface);
      }
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
    const dist = Math.hypot(player.x - x, player.y + PLAYER.eye - y, player.z - z);
    if (splash.nuke) {
      // A warhead is the same code path as a grenade with different numbers,
      // which is the point of having the numbers in one place. What it gets of
      // its own is the look: a white frame, a column of fire, and a mark on
      // the city a quarter of a kilometre across.
      audio.nuke(dist);
      effects.nuke(x, y, z, splash.radius);
      cinema.detonated(x, y, z);
      // A warhead going off in slow motion, if that is switched on. It runs
      // on its own clock rather than out of the reflex meter, because this
      // is a thing to watch rather than a thing to fight through.
      if (cheats.slowBlast) state.blastSlow = 3.2;
      // The flash is as bright as the distance allows, falling off smoothly
      // rather than over a cliff. Standing on top of one takes the whole
      // frame; watching from half a kilometre away is a glare you can see
      // past; from the far side of the city it is a flicker.
      state.flash = Math.min(1.1, 0.18 + 1.25 * Math.exp(-dist / 300));
      // Four marks across the blast rather than one, because a single scar
      // that wide reads as a circle painted on the ground.
      renderer.addScar(x, y, z, splash.radius * 1.1, 1);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.random();
        const r = splash.radius * 0.55;
        renderer.addScar(x + Math.cos(a) * r, y, z + Math.sin(a) * r,
          splash.radius * 0.8, 0.9);
      }
      debris(x, y, z, splash.radius * 0.35);
    } else {
      audio.explosion();
      effects.explode(x, y, z);
      effects.blast(x, y, z, splash.radius);
      // Mark whatever it went off against. The soot reaches further than the
      // damage does, which is how a blast looks on a wall.
      renderer.addScar(x, y, z, splash.radius * 1.5,
        Math.min(1, splash.damage / 180));
      debris(x, y, z, splash.radius);
    }
    effects.shake = Math.min(splash.nuke ? 2.6 : 1.4, effects.shake
      + Math.max(0, 1 - dist / (splash.radius * 3)) * (splash.nuke ? 2.2 : 0.9));

    // An incendiary is a small blast and a large fire: the pools it leaves
    // are what it is for, and they go down here so that anything which can
    // set one off, a thrown bomb or a vehicle gun, gets the same behaviour.
    if (body && body.weapon && WEAPONS[body.weapon] && WEAPONS[body.weapon].incendiary) {
      incendiaryBurst(x, world.groundHeight(x, z), z, WEAPONS[body.weapon].incendiary);
    }
    // A thermite canister out of a mech carries its fire on the body rather
    // than in a weapon row, because the mech's arms are their own table. The
    // pools it leaves are the same pools.
    if (body && body.thermite) {
      incendiaryBurst(x, world.groundHeight(x, z), z, body.thermite);
    }
    // An EMP: a blue ring, a rising whine, and everything with a motor in it
    // inside the radius stops where it stands. The numbers come off the
    // weapon that threw it, or off the body itself when the thing that fired
    // it was not holding one of ours.
    const row = body && body.weapon ? WEAPONS[body.weapon] : null;
    const empSpec = (body && body.emp) || (row && row.emp) || null;
    if (empSpec) {
      const caught = empBurst(soldiers.active, drones.active, x, y, z, empSpec.radius);
      // A mech has a motor in it too. It is the largest thing an EMP can
      // catch and the one it was worth building for.
      let heavy = 0;
      for (const mk of [...mechs.active]) {
        if (Math.hypot(mk.x - x, mk.z - z) > empSpec.radius) continue;
        if (mechs.stunFor(mk, empSpec.seconds)) heavy++;
      }
      audio.emp(dist);
      effects.flash(x, y + 1.5, z, empSpec.radius * 0.5, 0.35, 0.7, 1.0, 0.5);
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2;
        const r = empSpec.radius * (0.3 + Math.random() * 0.7);
        effects.spark(x + Math.cos(a) * r, y + 0.6 + Math.random() * 2,
          z + Math.sin(a) * r, 0.4, 0.75, 1.0);
      }
      renderer.addScar(x, y, z, empSpec.radius * 0.4, 0.3);
      if (caught + heavy) feed(`<b>EMP</b> ${caught + heavy} down`);
    }

    // And the warhead behind the EMP, which is the part that is meant for
    // armour. It goes off against the machine rather than against the
    // street: the blast above has already dealt with the street, and what
    // this adds is enough to take a Reaper apart in one and to put a Titan
    // on one knee. Whatever is left standing is stopped for a few seconds,
    // which is the opening a second one goes through.
    const killSpec = (body && body.mechKill) || (row && row.mechKill) || null;
    if (killSpec) {
      effects.flash(x, y + 2.0, z, killSpec.radius * 0.8, 0.8, 0.9, 1.0, 0.35);
      effects.shake = Math.min(2.0, effects.shake
        + Math.max(0, 1 - dist / (killSpec.radius * 3)) * 1.2);
      for (const mk of [...mechs.active]) {
        if (!mk.alive || mk.health <= 0) continue;
        const mid = mk.y + mk.spec.height * 0.72;
        const r = Math.hypot(mk.x - x, mid - y, mk.z - z);
        if (r > killSpec.radius) continue;
        // It falls off with distance, but not by much: a warhead that only
        // works on a direct hit is a warhead that mostly does nothing, and
        // a rocket at a mech's feet is as much of a hit as anybody gets.
        const dmg = killSpec.damage * (1 - 0.35 * (r / killSpec.radius));
        mechs.stunFor(mk, killSpec.stun);
        for (let i = 0; i < 12; i++) {
          effects.spark(mk.x + (Math.random() - 0.5) * 4,
            mk.y + 2 + Math.random() * 5,
            mk.z + (Math.random() - 0.5) * 4, 0.45, 0.8, 1.0);
        }
        if (mechs.damage(mk, dmg)) {
          creditTarget(mk, true, 'mech');
          feed('<b>mech killer</b> one down');
        } else if (mk === state.inMech) {
          toast('systems jammed');
        }
      }
    }

    // And what it did to the city itself. Small blasts add up on a grid and
    // bring a frontage down when they have done enough; a warhead takes its
    // whole radius at once.
    demolition.blast(x, y, z, splash.radius, splash.damage);
    // Anything that leaves a mark sets light to the trees in it. The radius
    // is wider than the blast, because fire spreads and a blast does not.
    fires.ignite(x, y, z, splash.radius * (splash.nuke ? 1.15 : 1.9),
      Math.min(1, 0.5 + splash.damage / 400));

    // Where the damage radiates from, which is not always where the mark is.
    // A grenade goes off at the point it stopped. A warhead's fireball is tens
    // of metres above the crater, and that matters: a blast centred on the
    // cobbles has no line of sight to anything at all, because the first thing
    // the ray meets is the street it started on.
    const by = y + (splash.burst || 0);
    const reach = (ax, ay, az) => world.lineOfSight(x, by, z, ax, ay, az);

    let killed = 0;
    for (const d of [...drones.active]) {
      const r = Math.hypot(d.x - x, d.y - by, d.z - z);
      if (r > splash.radius) continue;
      // Line of sight, so a wall between the grenade and the target is a wall.
      if (!reach(d.x, d.y, d.z)) continue;
      const dmg = splash.damage * (1 - r / splash.radius);
      if (drones.damage(d, dmg)) { creditTarget(d, false, 'drone'); killed++; }
    }
    if (soldiers) {
      for (const sd of [...soldiers.active]) {
        const r = Math.hypot(sd.x - x, sd.y + 0.9 - by, sd.z - z);
        if (r > splash.radius) continue;
        if (!reach(sd.x, sd.y + 0.9, sd.z)) continue;
        const dmg = splash.damage * (1 - r / splash.radius);
        // A warhead throws what is left of them away from it.
        const away = { x: (sd.x - x) / (r || 1), y: 0, z: (sd.z - z) / (r || 1) };
        if (soldiers.damage(sd, dmg, away)) {
          creditTarget(sd, false, 'soldier'); killed++;
        }
      }
    }
    for (const j of [...jets.active]) {
      const r = Math.hypot(j.x - x, j.y - by, j.z - z);
      if (r > splash.radius * 1.6) continue;      // a jet is a big thing to miss
      if (jets.damage(j, splash.damage * (1 - r / (splash.radius * 1.6)))) killed++;
    }
    // And the mechs, which were left out of this for a whole phase: a rocket
    // landing at a Titan's feet took its paint off and nothing else. Measured
    // to the middle of the torso rather than to the ground between its feet,
    // because that is where the thing is.
    for (const mk of [...mechs.active]) {
      if (mk.health <= 0) continue;
      const mid = mk.y + mk.spec.height * 0.72;
      const r = Math.hypot(mk.x - x, mid - by, mk.z - z);
      if (r > splash.radius * 1.3) continue;
      if (!reach(mk.x, mid, mk.z)) continue;
      const dmg = splash.damage * (1 - r / (splash.radius * 1.3));
      // Its own salvo does not take its own legs off.
      if (mk === state.inMech && body && body.weapon === 'mech') continue;
      if (mechs.damage(mk, dmg)) { creditTarget(mk, false, 'mech'); killed++; }
    }
    for (const v of [...vehicles.active]) {
      if (v.health <= 0) continue;
      const r = Math.hypot(v.x - x, v.y + 1.0 - by, v.z - z);
      if (r > splash.radius) continue;
      if (!reach(v.x, v.y + 1.0, v.z)) continue;
      vehicles.damage(v, splash.damage * (1 - r / splash.radius));
    }
    // And you, unless you are inside something, in which case the thing you
    // are inside has already taken it above and taking it twice would mean a
    // rocket that kills the pilot through the armour it just dented.
    const toPlayer = Math.hypot(player.x - x, player.y + PLAYER.eye - by, player.z - z);
    if (!state.inMech && !state.inVehicle && toPlayer < splash.radius
      && reach(player.x, player.y + PLAYER.eye, player.z)) {
      combat.hurt(splash.damage * 0.55 * (1 - toPlayer / splash.radius),
        x, z, player.x, player.z);
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
    // A body that came apart does not also catch fire.
    if (!target.gibbed) effects.explode(target.x, target.y, target.z);
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
  // The wheel, while the pointer is locked. In a mech it goes through the
  // mech's five; on foot it goes through what you are carrying, and a
  // holstered weapon stays holstered.
  input.onWheel = (dir) => {
    if (state.inMech && state.inMech.spec.arms) { mechs.cycleArm(state.inMech, dir); return; }
    if (!state.holstered) weapon.cycle(dir);
  };
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

  /**
   * Where a machine's shot starts: the emitter on the rifle it is holding,
   * carried through the same rotation the vertex shader puts the body
   * through, so the line in the air leaves the end of the gun you can see
   * rather than the middle of its chest.
   */
  function machineMuzzle(s) {
    const [mx, my, mz] = MACHINE_MUZZLE;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    // The body's own axes in the world. A model's negative z is the way the
    // figure faces, which is the same direction the soldier layer means by
    // its yaw: (-sin, -cos). Written out rather than taken from the shader by
    // eye, because getting the sign wrong puts the muzzle in its back and
    // nothing on the screen says so.
    return {
      x: s.x + c * mx + sn * mz,
      y: s.y + my,
      z: s.z - sn * mx + c * mz,
    };
  }

  // A machine's beam: one bright red line that arrives all at once, a crack
  // rather than a bang, and a scorch where it lands.
  soldiers.onBeam = (s, damage) => {
    const from = machineMuzzle(s);
    const to = { x: camera.position[0], y: camera.position[1], z: camera.position[2] };
    effects.lance(from.x, from.y, from.z, to.x, to.y, to.z, 1.0, 0.1, 0.08);
    audio.laser(Math.hypot(player.x - s.x, player.z - s.z));
    effects.flash(from.x, from.y, from.z, 2.4, 1.0, 0.15, 0.1, 0.07);
    if (damage > 0 && combat.health > 0) combat.hurt(damage, s.x, s.z, player.x, player.z);
  };
  // --- mechs ----------------------------------------------------------------
  // Eight metres of walking gun platform. The hooks below are everything the
  // mech layer knows about this game: it decides when a gun goes off and
  // where the muzzle is, and this decides what that does to the city.

  /** A chaingun round, from a mech, at whatever is in front of it. */
  mechs.onChaingun = (m, from, dir, gun) => {
    const spread = gun.spread;
    const d = {
      x: dir.x + (Math.random() - 0.5) * spread,
      y: dir.y + (Math.random() - 0.5) * spread,
      z: dir.z + (Math.random() - 0.5) * spread,
    };
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    d.x /= l; d.y /= l; d.z /= l;
    const hit = world.raycast(from.x, from.y, from.z, d.x, d.y, d.z, gun.range);
    const reach = hit ? hit.t : gun.range;
    const end = { x: from.x + d.x * reach, y: from.y + d.y * reach, z: from.z + d.z * reach };
    audio.gunshot('mechgun');
    effects.tracer(from.x, from.y, from.z, end.x, end.y, end.z, m.mine);
    if (hit) effects.impact(end.x, end.y, end.z, hit.nx || 0, hit.ny || 1, hit.nz || 0, 'wall');
    if (m.mine) {
      // Yours hits whatever is out there, through the same raycasts the rifle
      // uses, so cover works the same way for a mech as for a man.
      mechHit(from, d, Math.min(reach, gun.range), gun.damage);
    } else {
      // Theirs hits you, if the line is clear and you are near it.
      // A near miss is a miss. The spread is already in the direction, so the
      // only question here is whether this round went through you, and the
      // answer has to be a body's width rather than a bus's.
      const near = pointToRay(player.x, player.y + PLAYER.eye * 0.6, player.z, from, d, reach);
      if (near < 0.9 && combat.health > 0) combat.hurt(gun.damage, m.x, m.z, player.x, player.z);
    }
  };

  /**
   * A shot out of whatever your mech has in its hands.
   *
   * Five weapons, five ways of arriving. The chaingun hoses rounds; the
   * cannon throws a shell; the thermite launcher lobs a canister that leaves
   * the street burning; the railgun fires a bolt that goes through whatever
   * is in the way; the Leadwall throws fourteen slugs at once. Each one
   * shakes your own screen by its own amount, which is most of what makes
   * forty tonnes feel like forty tonnes rather than like a rifle on stilts.
   */
  mechs.onArmFire = (m, from, dir, arm, extra) => {
    audio.gunshot(arm.sound);
    if (m === state.inMech) {
      effects.shake = Math.min(2.0, effects.shake + arm.shake);
      state.mechFlash = 1;
    }
    const spread = (amount) => {
      const d = {
        x: dir.x + (Math.random() - 0.5) * amount,
        y: dir.y + (Math.random() - 0.5) * amount,
        z: dir.z + (Math.random() - 0.5) * amount,
      };
      const l = Math.hypot(d.x, d.y, d.z) || 1;
      return { x: d.x / l, y: d.y / l, z: d.z / l };
    };

    if (arm.kind === 'auto' || arm.kind === 'shotgun') {
      const shots = arm.kind === 'shotgun' ? arm.pellets : 1;
      for (let i = 0; i < shots; i++) {
        const d = spread(arm.spread);
        const hit = world.raycast(from.x, from.y, from.z, d.x, d.y, d.z, arm.range);
        const reach = hit ? hit.t : arm.range;
        const end = {
          x: from.x + d.x * reach, y: from.y + d.y * reach, z: from.z + d.z * reach,
        };
        effects.tracer(from.x, from.y, from.z, end.x, end.y, end.z, m.mine);
        if (hit) {
          effects.impact(end.x, end.y, end.z, hit.nx || 0, hit.ny || 1, hit.nz || 0, 'wall');
          demolition.blast(end.x, end.y, end.z, 2.4, arm.damage * 0.5);
          scarTiles(end.x, end.z, 3);
        }
        mechHit(from, d, reach, arm.damage);
      }
      return;
    }

    if (arm.kind === 'shell' || arm.kind === 'thermite') {
      const d = spread(arm.spread);
      projectiles.launch('rocket', {
        x: from.x, y: from.y, z: from.z,
        vx: d.x * arm.speed, vy: d.y * arm.speed, vz: d.z * arm.speed,
        splash: arm.splash,
        weapon: 'mech',
        // The canister is what sets the street alight when it lands, and the
        // blast layer reads it off the body the same way a hand incendiary
        // is read off its weapon row.
        thermite: arm.kind === 'thermite' ? arm.fire : null,
      });
      return;
    }

    if (arm.kind === 'rail') {
      // A bolt that does not stop at the first thing it hits. Everything
      // along the line takes it, up to the number of bodies the spec allows,
      // and the world still stops it: a railgun goes through four machines,
      // not through four streets.
      const charged = extra && extra.charged ? extra.charged : 0;
      const damage = arm.damage + (arm.chargedDamage - arm.damage) * charged;
      const hit = world.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, arm.range);
      const reach = hit ? hit.t : arm.range;
      const end = {
        x: from.x + dir.x * reach, y: from.y + dir.y * reach, z: from.z + dir.z * reach,
      };
      effects.lance(from.x, from.y, from.z, end.x, end.y, end.z,
        0.45, 0.85, 1.0);
      effects.flash(from.x, from.y, from.z, 3.0 + charged * 4, 0.4, 0.8, 1.0, 0.1);
      const through = new Set();
      for (let i = 0; i < arm.pierce; i++) {
        const got = mechHit(from, dir, reach, damage, through);
        if (!got) break;
        effects.flash(from.x + dir.x * got.t, from.y + dir.y * got.t, from.z + dir.z * got.t,
          2.0, 0.5, 0.9, 1.0, 0.08);
      }
      if (hit) {
        explode(end.x, end.y, end.z,
          { radius: 6 + charged * 6, damage: damage * 0.5 }, { weapon: 'mech' });
      }
      return;
    }
  };

  mechs.onArmChange = (m, arm) => {
    if (m !== state.inMech) return;
    audio.swap();
    toast(arm.name);
  };
  mechs.onReload = (m, arm) => {
    if (m !== state.inMech) return;
    audio.reload(arm.reload);
  };

  /** One rocket out of a pod. */
  mechs.onRockets = (m, from, dir, rockets) => {
    projectiles.launch('rocket', {
      x: from.x, y: from.y, z: from.z,
      vx: dir.x * rockets.speed, vy: dir.y * rockets.speed, vz: dir.z * rockets.speed,
      splash: rockets.splash, weapon: m.mine ? 'mech' : 'reaper',
    });
    audio.gunshot('mechcannon');
    if (m.mine) effects.shake = Math.min(1.1, effects.shake + 0.12);
  };

  // A footfall you can feel from a street away.
  mechs.onStep = (m, hard) => {
    const away = Math.hypot(m.x - player.x, m.z - player.z);
    if (away > 180) return;
    audio.land(0);
    const close = Math.max(0, 1 - away / 60);
    effects.shake = Math.min(1.0, effects.shake + close * (hard ? 0.22 : 0.12));
    effects.dust(m.x, m.y, m.z, 1.6);
  };

  // And the landing, which opens the road. This is not an explosion: it is
  // forty tonnes arriving, so it goes through the city and through whatever
  // is standing in the circle, and the pilot inside the armour is fine.
  mechs.onStomp = (m, stomp, dropped = false) => {
    if (dropped) {
      el.titanfall.classList.add('hidden');
      state.titanInbound = null;
      state.flash = Math.min(0.5, state.flash + 0.22);
      feed(`<b>${m.spec.name.toLowerCase()} down</b> ready to board`);
      toast(`${m.spec.name} is down. F to get in.`);
    }
    audio.explosion();
    effects.blast(m.x, m.y + 0.4, m.z, stomp.radius);
    effects.dust(m.x, m.y, m.z, stomp.radius * 0.7);
    renderer.addScar(m.x, m.y, m.z, stomp.radius * 0.8, 0.7);
    demolition.blast(m.x, m.y, m.z, stomp.radius, stomp.damage);
    gibs.rubble(m.x, m.y + 0.5, m.z, 4, 8, 1.4);
    for (const sd of [...soldiers.active]) {
      const away = Math.hypot(sd.x - m.x, sd.z - m.z);
      if (away > stomp.radius) continue;
      const share = stomp.damage * (1 - away / stomp.radius);
      if (soldiers.damage(sd, share, { x: (sd.x - m.x) / (away || 1), y: 0.4, z: (sd.z - m.z) / (away || 1) })) {
        creditTarget(sd, false, 'soldier');
      }
    }
    for (const v of [...vehicles.active]) {
      const away = Math.hypot(v.x - m.x, v.z - m.z);
      if (away < stomp.radius) vehicles.damage(v, stomp.damage * (1 - away / stomp.radius));
    }
    for (const other of [...mechs.active]) {
      if (other === m) continue;
      const away = Math.hypot(other.x - m.x, other.z - m.z);
      if (away < stomp.radius && mechs.damage(other, stomp.damage * 0.6 * (1 - away / stomp.radius))) {
        creditTarget(other, true, 'mech');
      }
    }
    effects.shake = Math.min(1.6, effects.shake + 0.8);
  };

  mechs.onDestroyed = (m) => {
    explode(m.x, m.y + 3.0, m.z, { radius: 26, damage: 420 }, { weapon: 'mech' });
    gibs.rubble(m.x, m.y + 2.0, m.z, 9, 16, 2.4);
    feed(`<b>${m.spec.name.toLowerCase()} down</b>`);
    if (state.inMech === m) leaveMech(true);
  };

  /**
   * How near a point is to a ray, for working out whether a shot that was not
   * aimed at anything in particular went through you anyway.
   */
  function pointToRay(px, py, pz, from, dir, reach) {
    const vx = px - from.x, vy = py - from.y, vz = pz - from.z;
    const t = Math.max(0, Math.min(reach, vx * dir.x + vy * dir.y + vz * dir.z));
    return Math.hypot(vx - dir.x * t, vy - dir.y * t, vz - dir.z * t);
  }

  /**
   * What your mech's guns hit: the same enemies your rifle hits.
   *
   * The optional set holds whatever an earlier shot on this same line already
   * took, which is how the railgun goes through a rank of machines rather
   * than hitting the front one four times. Returns the body it hit, or null,
   * so a piercing shot knows when the line has run out of targets.
   */
  function mechHit(from, d, reach, damage, through = null) {
    let best = null;
    const take = (hit, kind, target) => {
      if (!hit || hit.t > reach || !target) return;
      if (through && through.has(target)) return;
      if (!best || hit.t < best.t) best = { t: hit.t, kind, target, core: !!hit.core };
    };
    const dr = drones.raycast(from.x, from.y, from.z, d.x, d.y, d.z, reach);
    take(dr, 'drone', dr && dr.drone);
    const sd = soldiers.raycast(from.x, from.y, from.z, d.x, d.y, d.z, reach);
    take(sd, 'soldier', sd && sd.soldier);
    const jt = jets.raycast(from.x, from.y, from.z, d.x, d.y, d.z, reach);
    take(jt, 'jet', jt && jt.jet);
    const mc = mechs.raycast(from.x, from.y, from.z, d.x, d.y, d.z, reach);
    if (mc && !mc.mech.mine) take(mc, 'mech', mc.mech);
    if (!best) return null;
    if (through) through.add(best.target);
    let killed = false;
    if (best.kind === 'soldier') killed = soldiers.damage(best.target, damage, d);
    else if (best.kind === 'jet') killed = jets.damage(best.target, damage);
    else if (best.kind === 'mech') killed = mechs.damage(best.target, damage);
    else killed = drones.damage(best.target, damage);
    if (killed) creditTarget(best.target, best.core, best.kind);
    return best;
  }

  /**
   * One of theirs putting a mech killer into what you are standing in.
   *
   * The same warhead you carry, out of a shoulder tube rather than a
   * launcher, and it chases: a Titan walks at eleven metres a second and a
   * rocket that has to be led is a rocket that lands behind it.
   */
  soldiers.onMechKiller = (sd) => {
    const spec = WEAPONS.mechkiller;
    const ride = state.inMech || state.inVehicle;
    const to = ride
      ? { x: ride.x, y: ride.y + (ride.spec.height || 2) * 0.6, z: ride.z }
      : { x: player.x, y: player.y + PLAYER.eye, z: player.z };
    // Out in front of it rather than out of the middle of it. The list of
    // bodies a rocket asks about has the firing machine on it, and a warhead
    // that starts inside its own launcher goes off in its own hands.
    const eye = { x: sd.x, y: sd.y + 1.5, z: sd.z };
    const dx = to.x - eye.x, dy = to.y - eye.y, dz = to.z - eye.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const from = {
      x: eye.x + dx / l * 1.8, y: eye.y + dy / l * 1.8, z: eye.z + dz / l * 1.8,
    };
    projectiles.launch('rocket', {
      x: from.x, y: from.y, z: from.z,
      vx: dx / l * spec.muzzleSpeed,
      vy: dy / l * spec.muzzleSpeed,
      vz: dz / l * spec.muzzleSpeed,
      splash: spec.splash,
      weapon: 'mechkiller',
      // Carried on the body rather than read off the weapon row, because the
      // row belongs to what you are holding and this one left somebody
      // else's shoulder.
      emp: spec.emp,
      mechKill: spec.mechKill,
      homing: spec.lock ? { turn: spec.lock.turn * 0.6, range: spec.lock.range } : null,
      target: ride || { x: player.x, y: player.y, z: player.z, height: 1.8, alive: true },
    });
    audio.gunshot('rpg');
    effects.flash(from.x, from.y, from.z, 2.0, 1.0, 0.6, 0.25, 0.1);
    feed('<b>mech killer</b> inbound');
  };

  soldiers.onStunSpark = (s) => {
    effects.spark(s.x + (Math.random() - 0.5), s.y + 0.8 + Math.random() * 0.9,
      s.z + (Math.random() - 0.5), 0.5, 0.75, 1.0);
  };

  soldiers.onShot = (s, damage) => {
    audio.gunshot('rifle');
    effects.tracer(s.x, s.y + 1.45, s.z,
      camera.position[0], camera.position[1], camera.position[2], false);
    if (damage > 0 && combat.health > 0) combat.hurt(damage, s.x, s.z, player.x, player.z);
  };
  // Coming apart. The soldier is already off the active list by the time this
  // runs, so everything here is about what is left behind.
  // Each stage of a building coming apart: the dust and the pieces come off
  // the line it has been cut back to, not out of the ground, so a top storey
  // going is a top storey going and not a puff at your feet.
  /**
   * Marks the tiles a blast has taken a bite out of, so the renderer can draw
   * them inside out afterwards and a hole shows the inside of the world
   * instead of the sky behind it. Costs one pass over a handful of tiles, and
   * nothing at all in a city nobody has hit yet.
   */
  function scarTiles(x, z, radius) {
    const w = world;
    const r = radius + 6;
    const tx0 = Math.max(0, Math.floor((x - r - w.minX) / w.tileSize));
    const tx1 = Math.min(w.nx - 1, Math.floor((x + r - w.minX) / w.tileSize));
    const tz0 = Math.max(0, Math.floor((z - r - w.minZ) / w.tileSize));
    const tz1 = Math.min(w.nz - 1, Math.floor((z + r - w.minZ) / w.tileSize));
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) renderer.scarredTiles.add(tz * w.nx + tx);
    }
  }

  demolition.onStage = (site, level, was) => {
    scarTiles(site.x, site.z, site.radius);
    const share = level - was;
    // How tall whatever is in the site still was before this stage. The
    // tallest wall inside it is the best answer available without asking the
    // geometry, and asking the geometry would mean a raycast per stage.
    const standing = Math.max(4, world.tallestNear(site.x, site.z, site.radius));
    const breakAt = site.y + standing * (1 - was);
    effects.dust(site.x, breakAt, site.z, site.radius * (0.5 + share * 0.6));
    gibs.rubble(site.x, breakAt, site.z, site.radius,
      Math.min(40, 6 + Math.round(site.radius * share * 1.4)),
      standing * share);
    const away = Math.round(Math.hypot(player.x - site.x, player.z - site.z));
    audio.collapse(away, site.radius * (0.4 + share));
    feed(level >= 1
      ? `<i>collapsed</i> ${Math.round(site.radius * 2)} m across, ${away} m away`
      : `<i>caving in</i> ${Math.round(level * 100)}%, ${away} m away`);
  };

  fires.onFlame = (tree, strength) => effects.flame(tree.x, tree.y, tree.z, tree.height, strength);
  fires.onBurst = (tree) => {
    effects.treeBurst(tree.x, tree.y, tree.z, tree.height);

    // Burning wood, thrown about. The same chunks the buildings use, in the
    // charred part of the palette.
    gibs.rubble(tree.x, tree.y + tree.height * 0.5, tree.z, tree.height * 0.4, 7, tree.height * 0.3);
    audio.treeBurst(Math.hypot(player.x - tree.x, player.z - tree.z));
  };
  fires.onTopple = (tree) => {
    audio.treeFall(Math.hypot(player.x - tree.x, player.z - tree.z));
  };
  // Burst or fallen, a tree is struck off the city when the fire has finished
  // with it: out of the instance buffer so it is not drawn, out of the
  // collision so its trunk stops blocking, and not back on a reload of the
  // tile. A burnt stand of limes stays a burnt stand of limes.
  fires.onGone = (tree) => world.killTree(tree.x, tree.z);

  // --- the flamethrower -----------------------------------------------------
  // Everything in the cone in front of you burns: soldiers char and go down,
  // drones and jets come apart, trees catch, and the ground behind what you
  // hit goes on burning after you let go. The weapon itself knows none of
  // this; it hands over a cone and a time step.
  function burnAt(x, y, z, radius, dt, damagePerSecond, burnPerSecond) {
    for (const sd of [...soldiers.active]) {
      if (Math.hypot(sd.x - x, sd.z - z) > radius + 0.9) continue;
      if (Math.abs(sd.y - y) > 3.2) continue;
      sd.charred = Math.min(1, (sd.charred || 0) + burnPerSecond * dt);
      if (Math.random() < dt * 7) effects.flame(sd.x, sd.y + 0.8, sd.z, 1.9, 0.5);
      if (soldiers.damage(sd, damagePerSecond * dt, { x: 0, y: 0, z: 0 })) {
        creditTarget(sd, false, 'soldier');
      }
    }
    for (const d of [...drones.active]) {
      if (Math.hypot(d.x - x, d.z - z) > radius + 2 || Math.abs(d.y - y) > 7) continue;
      if (drones.damage(d, damagePerSecond * 0.8 * dt)) creditTarget(d, false, 'drone');
    }
    for (const v of [...vehicles.active]) {
      if (!v.alive || Math.hypot(v.x - x, v.z - z) > radius + 3) continue;
      vehicles.damage(v, damagePerSecond * 0.5 * dt);
    }
    // A mech standing in it cooks, which is the whole point of thermite:
    // a street you have set alight is a street a machine cannot hold.
    for (const mk of [...mechs.active]) {
      if (!mk.alive || mk.health <= 0) continue;
      if (Math.hypot(mk.x - x, mk.z - z) > radius + mk.spec.radius) continue;
      if (Math.abs(mk.y - y) > 8) continue;
      // A fifth of what it does to a vehicle and a seventh of what it does to
      // a person: this is armour plate, and the point of setting the street
      // alight under one is to make it leave rather than to melt it where it
      // stands. Thermite is the one that carries enough to matter.
      if (mechs.damage(mk, damagePerSecond * 0.15 * dt)) creditTarget(mk, false, 'mech');
    }
    // And you, because a wall of fire does not know whose it is. Unless you
    // are inside something: the burning street round a Titan's ankles is the
    // Titan's problem, and a pilot cooked to death inside forty tonnes of
    // armour by his own thermite was this layer's own idea of justice.
    if (!state.inMech && !state.inVehicle
        && Math.hypot(player.x - x, player.z - z) < radius * 0.8
        && Math.abs(player.y - y) < 2.4 && combat.health > 0) {
      combat.hurt(damagePerSecond * 0.35 * dt, x, z, player.x, player.z);
    }
  }

  /**
   * What an incendiary does when it goes off: a modest blast, then a ring of
   * burning pools around where it landed, so the street itself is on fire for
   * the next half minute rather than the bomb being a brighter grenade.
   */
  function incendiaryBurst(x, y, z, spec) {
    const n = spec.pools;
    fires.ignite(x, y, z, spec.radius * 0.5, 1);
    renderer.addScar(x, y, z, spec.radius * 0.8, 0.8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const r = spec.radius * (0.3 + Math.random() * 0.7);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const py = world.groundHeight(px, pz);
      if (combat.isSanctuary(px, py, pz)) continue;
      fires.ignite(px, py, pz, 8, 0.9);
      renderer.addScar(px, py, pz, 4.5, 0.6);
      effects.flame(px, py + 0.5, pz, 3.0, 0.9);
      burning.push({ x: px, y: py, z: pz, radius: 7.5, left: spec.burnSeconds,
        damagePerSecond: spec.damagePerSecond });
    }
    audio.flameWall();
  }

  // Ground that is on fire and will burn anything standing in it. The pools
  // an incendiary leaves, kept here rather than in the fire module, because
  // that one is about trees and this one is about people.
  const burning = [];

  function updateBurning(dt) {
    for (let i = burning.length - 1; i >= 0; i--) {
      const b = burning[i];
      b.left -= dt;
      if (b.left <= 0) { burning.splice(i, 1); continue; }
      burnAt(b.x, b.y, b.z, b.radius, dt, b.damagePerSecond, 1.1);
      if (Math.random() < dt * 9) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * b.radius;
        effects.flame(b.x + Math.cos(a) * r, b.y + 0.3, b.z + Math.sin(a) * r, 2.6, 0.8);
      }
    }
  }

  weapon.onStream = (eye, dir, dt, spec) => {
    const reach = spec.stream.reach;
    // Where the stream stops: the first wall in front of you, so you cannot
    // burn somebody through the Brandenburg Gate.
    const hit = world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, reach);
    const far = hit ? Math.max(1.5, hit.t - 0.6) : reach;
    // Flame along the cone, thicker and slower the further it has gone.
    for (let i = 0; i < 3; i++) {
      const t = 2 + Math.random() * (far - 2);
      const spread = spec.stream.cone * t * 0.5;
      const x = eye.x + dir.x * t + (Math.random() - 0.5) * spread;
      const y = eye.y + dir.y * t + (Math.random() - 0.5) * spread * 0.6;
      const z = eye.z + dir.z * t + (Math.random() - 0.5) * spread;
      effects.flame(x, y - 0.4, z, 1.1 + t * 0.07, 0.55 + 0.4 * (t / far));
      burnAt(x, y, z, 1.6 + t * spec.stream.cone, dt,
        spec.stream.damagePerSecond, spec.stream.burnPerSecond);
    }
    // What it lands on catches, so a hedge keeps burning after you stop.
    if (Math.random() < dt * 5) {
      const x = eye.x + dir.x * far, y = eye.y + dir.y * far, z = eye.z + dir.z * far;
      fires.ignite(x, world.groundHeight(x, z), z, 7, 0.8);
      renderer.addScar(x, y, z, 3.4, 0.5);
    }
    audio.flameLoop(true);
    state.muzzle = Math.max(state.muzzle, 0.5);
    effects.flash(eye.x + dir.x * 1.2, eye.y + dir.y * 1.2, eye.z + dir.z * 1.2,
      2.2, 1.0, 0.55, 0.2, 0.05);
  };
  weapon.onStreamEnd = () => audio.flameLoop(false);

  weapon.onWall = (eye, dir, spec) => {
    const wall = fireWalls.throw_({ x: player.x, y: player.y, z: player.z },
      { x: dir.x, z: dir.z }, spec.wall);
    if (!wall) { toast('not here'); return; }
    audio.flameWall();
    effects.shake = Math.min(1.2, effects.shake + 0.3);
    feed('<b>wall of fire</b>');
  };

  fireWalls.onFlame = (x, y, z, height, strength) => effects.flame(x, y, z, height, strength);
  fireWalls.onBurn = (x, y, z, radius, dt) => {
    const spec = WEAPONS.flamer.wall;
    burnAt(x, y, z, radius, dt, spec.damagePerSecond, spec.burnPerSecond);
  };
  fireWalls.onIgnite = (x, y, z, radius) => {
    const spec = WEAPONS.flamer.wall;
    // Trees first, where there are any, and then the road itself. The road is
    // the part that matters on a street with nothing growing on it: a fire
    // module that only knows about trees would leave Leipziger Strasse
    // untouched after a wall of fire had crossed it.
    fires.ignite(x, y, z, radius, 0.9);
    renderer.addScar(x, y, z, radius * 0.9, 0.55);
    if (combat.isSanctuary(x, y, z)) return;
    burning.push({ x, y, z, radius: Math.max(5, radius * 0.6), left: spec.burnSeconds,
      damagePerSecond: spec.groundDamagePerSecond });
  };

  // --- vehicles -------------------------------------------------------------
  // The gun on whatever you are driving. It goes through the same hitscan and
  // the same projectiles everything else uses; the only thing a vehicle gun
  // has that a rifle does not is a muzzle that is four metres in front of
  // your face.
  vehicles.onFire = (v, gun) => {
    const m = vehicles.muzzle(v);
    const dir = {
      x: camera.forward[0], y: camera.forward[1], z: camera.forward[2],
    };
    if (gun.kind === 'shell') {
      projectiles.launch('rocket', {
        x: m.x, y: m.y, z: m.z,
        vx: dir.x * gun.speed, vy: dir.y * gun.speed, vz: dir.z * gun.speed,
        splash: gun.splash, weapon: 'tank',
      });
      audio.gunshot('launcher');
      effects.shake = Math.min(1.4, effects.shake + 0.45);
      effects.flash(m.x, m.y, m.z, 2.2, 1.0, 0.7, 0.3, 0.12);
      return;
    }
    const spread = gun.spread;
    const d = {
      x: dir.x + (Math.random() - 0.5) * spread,
      y: dir.y + (Math.random() - 0.5) * spread,
      z: dir.z + (Math.random() - 0.5) * spread,
    };
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    d.x /= l; d.y /= l; d.z /= l;
    const wall = world.raycast(m.x, m.y, m.z, d.x, d.y, d.z, 420);
    const actor = projectiles.hitActors(m.x, m.y, m.z, d.x, d.y, d.z,
      wall ? wall.t : 420);
    const t = actor ? actor.t : (wall ? wall.t : 420);
    const end = { x: m.x + d.x * t, y: m.y + d.y * t, z: m.z + d.z * t };
    effects.tracer(m.x, m.y, m.z, end.x, end.y, end.z, true);
    if (actor) {
      const target = actor.target;
      if (actor.kind === 'soldier') {
        if (soldiers.damage(target, gun.damage, d)) creditTarget(target, false, 'soldier');
        if (cheats.bleeding) {
          effects.blood(end.x, end.y, end.z, -d.x, 0.4, -d.z, cheats.goreScale);
        }
      } else if (actor.kind === 'drone') {
        if (drones.damage(target, gun.damage)) creditTarget(target, false, 'drone');
      } else if (actor.kind === 'jet') {
        jets.damage(target, gun.damage);
      } else if (actor.kind === 'vehicle') {
        vehicles.damage(target, gun.damage);
      }
      audio.hitMarker(false);
      showHitmarker('');
    } else if (wall) {
      effects.impact(end.x, end.y, end.z, wall.nx, wall.ny, wall.nz, wall.kind);
    }
    audio.gunshot('rifle');
    state.muzzle = 1;
    effects.shake = Math.min(1, effects.shake + 0.03);
  };

  vehicles.onLaunch = (v, rocket) => {
    const m = vehicles.muzzle(v);
    const dir = { x: camera.forward[0], y: camera.forward[1], z: camera.forward[2] };
    projectiles.launch('rocket', {
      x: m.x, y: m.y - 0.6, z: m.z,
      vx: dir.x * rocket.speed, vy: dir.y * rocket.speed, vz: dir.z * rocket.speed,
      splash: rocket.splash, weapon: v.type,
    });
    audio.gunshot('launcher');
    effects.shake = Math.min(1.2, effects.shake + 0.2);
  };

  vehicles.onDestroyed = (v) => {
    explode(v.x, v.y + 1.2, v.z, { radius: 16, damage: 300 });
    gibs.rubble(v.x, v.y + 1, v.z, 6, 12, 2);
    feed(`<i>${v.spec.name.toLowerCase()} destroyed</i>`);
    if (state.inVehicle === v) leaveVehicle(true);
  };

  vehicles.onBump = (v, speed) => {
    if (speed < 4) return;
    effects.impact(v.x, v.y + 1, v.z, 0, 1, 0, 'wall');
    if (v === state.inVehicle) {
      effects.shake = Math.min(1, effects.shake + Math.min(0.4, speed * 0.02));
    }
  };

  /** Into the nearest one, or out of the one you are in. */
  function toggleVehicle() {
    if (state.mode !== 'walk') return;
    if (state.inMech) { leaveMech(false); return; }
    if (state.inVehicle) { leaveVehicle(false); return; }
    // A mech first: it is the bigger thing and you are standing under it.
    const mech = mechs.nearest(player.x, player.z, 9);
    if (mech) { enterMech(mech); return; }
    const near = vehicles.nearest(player.x, player.z, 7);
    if (!near) { toast('nothing to get into'); return; }
    if (!vehicles.enter(near)) return;
    state.inVehicle = near;
    state.holstered = true;
    el.hud.classList.add('driving');
    el.vehiclePanel.classList.remove('hidden');
    el.vehicleName.textContent = near.spec.name;
    el.vehicleKeys.textContent = near.spec.kind === 'air'
      ? 'W S throttle, A D roll, mouse flies, Space up, right mouse down, left mouse fires'
      : 'W forward, S back, A D steer, Shift brake, left mouse fires';
    // You look where it is pointing. Before this the camera kept the heading
    // you had on foot, so a tank parked across your line of sight drove off
    // sideways or straight past you when you pressed forward, which reads as
    // reverse however the hull is actually moving.
    camera.yaw = near.yaw;
    camera.pitch = Math.min(camera.pitch, -0.05);
    audio.swap();
    toast(`${near.spec.name}. F to get out.`);
  }

  /**
   * The readout for whatever you are in: a jeep, a tank, an aircraft or a
   * mech. One panel for all four, because the questions are the same ones in
   * every case and they are the questions a driver actually has: how much of
   * this thing is left, how fast is it going, can I fire yet, and in the air,
   * how far is it to the ground.
   *
   * Everything here is read off the entity rather than tracked separately, so
   * the numbers on the screen are the numbers the simulation is using.
   */
  function rideHud() {
    const ride = state.inMech || state.inVehicle;
    if (!ride) return;
    const spec = ride.spec;
    const mech = ride === state.inMech;
    const hull = Math.max(0, ride.health) / (ride.maxHealth || spec.health);
    el.vehicleName.textContent = `${spec.name} ${Math.max(0, Math.round(ride.health))}`;
    el.vehicleHull.style.width = `${Math.round(hull * 100)}%`;
    el.vehiclePanel.classList.toggle('hurt', hull < 0.34);
    el.vehiclePanel.classList.toggle('critical', hull < 0.16);

    // Speed, in the unit a person reads: kilometres an hour on the ground and
    // in the air, because metres a second means nothing at a glance.
    const speed = mech ? ride.speed : Math.abs(ride.speed);
    el.vehicleSpeed.textContent = String(Math.round(speed * 3.6));
    el.vehicleSpeedUnit.textContent = 'km/h';

    // Altitude, for the two that fly, measured to the ground under them
    // rather than to sea level, which is the number that matters when you are
    // about to put a helicopter into a roof.
    const air = !mech && spec.kind === 'air';
    el.vehicleAltStat.classList.toggle('hidden', !air);
    if (air) {
      const up = Math.max(0, ride.y - world.groundHeight(ride.x, ride.z));
      el.vehicleAlt.textContent = String(Math.round(up));
    }

    // The guns. A cooldown is shown as the seconds left rather than as a bar,
    // because what a tank wants to know is when, not how far along.
    const gunLeft = mech
      ? Math.max(0, ride.restLeft || 0)
      : Math.max(0, ride.cooldown || 0);
    el.vehicleGunLabel.textContent = mech ? 'chaingun' : (spec.gun.kind === 'shell' ? 'shell' : 'gun');
    el.vehicleGun.textContent = gunLeft > 0.08 ? `${gunLeft.toFixed(1)}s` : 'ready';
    el.vehicleGun.parentElement.classList.toggle('cold', gunLeft > 0.08);

    const rockets = mech ? spec.rockets : spec.rocket;
    el.vehicleRockStat.classList.toggle('hidden', !rockets);
    if (rockets) {
      const left = mech
        ? Math.max(0, ride.rocketTimer || 0)
        : Math.max(0, ride.rocketCooldown || 0);
      el.vehicleRock.textContent = left > 0.08 ? `${left.toFixed(1)}s` : 'ready';
      el.vehicleRockStat.classList.toggle('cold', left > 0.08);
    }

    // And the one thing only a mech has.
    el.vehicleDashStat.classList.toggle('hidden', !(mech && spec.dash));
    if (mech && spec.dash) {
      const left = Math.max(0, ride.dashCool || 0);
      el.vehicleDash.textContent = ride.dashLeft > 0 ? 'now'
        : (left > 0.08 ? `${left.toFixed(1)}s` : 'ready');
      el.vehicleDashStat.classList.toggle('cold', left > 0.08 && ride.dashLeft <= 0);
    }

    // What is about to go wrong, in one line. A fighter below its stall speed
    // is falling whatever the throttle says, and a hull under a sixth is the
    // last warning you get.
    let warn = '';
    if (!mech && spec.stall && air && Math.abs(ride.speed) < spec.stall) warn = 'stall';
    else if (hull < 0.16) warn = 'hull critical';
    else if (air && ride.y - world.groundHeight(ride.x, ride.z) < 12 && ride.vy < -6) {
      warn = 'pull up';
    }
    el.vehicleWarn.textContent = warn;
    el.vehicleWarn.classList.toggle('hidden', !warn);
  }

  // --- the cockpit ----------------------------------------------------------
  // What the pilot of a mech of your own sees. The loadout rows are built
  // once out of the mech's own table and then only have their classes and
  // their numbers changed, because five rows rebuilt sixty times a second is
  // five rows of garbage a second for no gain.

  /** The rows down the right, one per weapon, built from ARMS. */
  const armRows = [];
  function buildArmRows() {
    if (armRows.length) return;
    for (let i = 0; i < ARMS.length; i++) {
      const row = document.createElement('div');
      row.className = 'marm';
      const key = document.createElement('u');
      key.textContent = String(i + 1);
      const name = document.createElement('span');
      name.textContent = ARMS[i].name;
      const ammo = document.createElement('b');
      ammo.textContent = String(ARMS[i].magazine);
      row.append(key, name, ammo);
      el.mechArms.append(row);
      armRows.push({ row, ammo });
    }
  }

  /**
   * The cockpit readout, once a frame.
   *
   * Everything here is read off the mech itself, the same way the vehicle
   * panel is: the magazine on the screen is the magazine the simulation will
   * fire out of, and the charge bar is the charge the next shot will carry.
   */
  function mechHud() {
    const m = state.inMech;
    if (!m || !m.spec.arms) return;
    const arm = mechs.arm(m);
    for (let i = 0; i < armRows.length; i++) {
      const r = armRows[i];
      const left = m.mags[i];
      r.row.classList.toggle('on', i === m.arm);
      r.row.classList.toggle('empty', left <= 0);
      r.ammo.textContent = String(left);
    }

    const hull = Math.max(0, m.health) / (m.maxHealth || m.spec.health);
    el.mechHull.style.width = `${Math.round(hull * 100)}%`;
    el.mechHullNum.textContent = String(Math.max(0, Math.round(m.health)));
    el.mechHud.classList.toggle('hurt', hull < 0.34);
    el.mechHud.classList.toggle('critical', hull < 0.16);

    el.mechShieldLine.classList.toggle('hidden', !m.shieldMax);
    if (m.shieldMax) {
      const sh = Math.max(0, m.shield) / m.shieldMax;
      el.mechShield.style.width = `${Math.round(sh * 100)}%`;
      el.mechShieldNum.textContent = String(Math.max(0, Math.round(m.shield)));
    }

    // What is in the hands: the rounds left, or how long until it has any.
    if (m.reloadLeft > 0) el.mechAmmo.textContent = `${m.reloadLeft.toFixed(1)}s`;
    else el.mechAmmo.textContent = String(m.mags[m.arm]);
    el.mechAmmo.parentElement.classList.toggle('cold', m.reloadLeft > 0);

    const pod = Math.max(0, m.rocketTimer || 0);
    el.mechPod.textContent = pod > 0.08 ? `${pod.toFixed(1)}s` : 'ready';
    el.mechPod.parentElement.classList.toggle('cold', pod > 0.08);

    const dash = Math.max(0, m.dashCool || 0);
    el.mechDash.textContent = m.dashLeft > 0 ? 'now'
      : (dash > 0.08 ? `${dash.toFixed(1)}s` : 'ready');
    el.mechDash.parentElement.classList.toggle('cold', dash > 0.08 && m.dashLeft <= 0);

    // The charge, for the one weapon that has any. The reticle goes blue with
    // it, so you can see the shot building without looking away from it.
    const charging = arm && arm.kind === 'rail' && m.charge > 0.01;
    el.mechHud.classList.toggle('charging', !!charging);
    if (charging) {
      el.mechCharge.firstElementChild.style.width =
        `${Math.round(clamp(m.charge / arm.charge, 0, 1) * 100)}%`;
    }

    let warn = '';
    if (m.stun > 0) warn = `systems jammed ${m.stun.toFixed(1)}s`;
    else if (hull < 0.16) warn = 'hull critical';
    else if (m.reloadLeft > 0) warn = 'reloading';
    else if (m.mags[m.arm] <= 0) warn = 'empty';
    el.mechWarn.textContent = warn;
    el.mechWarn.classList.toggle('hidden', !warn);
  }

  /** Out of the canopy, or over the shoulder, and back. */
  function toggleCockpit() {
    state.cockpit = !state.cockpit;
    el.hud.classList.toggle('cockpit', state.cockpit);
    toast(state.cockpit ? 'cockpit' : 'over the shoulder');
  }

  /**
   * Into the cockpit. You see out of the canopy, the torso goes where you
   * look and the legs follow where it walks, the trigger fires whichever of
   * the five is in its hands, and the right button empties the pod.
   */
  function enterMech(m) {
    if (!mechs.enter(m)) return;
    state.inMech = m;
    state.holstered = true;
    el.hud.classList.add('driving');
    el.vehiclePanel.classList.remove('hidden');
    el.vehicleName.textContent = m.spec.name;
    el.vehicleKeys.textContent =
      'W A S D walks, mouse aims, left mouse fires, right mouse empties the pod, '
      + '1 to 5 or the wheel changes weapon, Shift dashes, V changes the view';
    camera.yaw = m.torso;
    if (m.spec.arms) {
      buildArmRows();
      el.mechName.textContent = m.spec.name;
      el.mechHud.classList.remove('hidden');
      el.hud.classList.add('piloting');
      el.hud.classList.toggle('cockpit', state.cockpit);
      mechHud();
      const arm = mechs.arm(m);
      if (arm) toast(`${m.spec.name}. ${arm.name}.`);
    } else {
      toast(`${m.spec.name}. F to get out.`);
    }
    audio.swap();
  }

  function leaveMech(thrown) {
    const m = state.inMech;
    if (!m) return;
    const out = mechs.leave() || { x: m.x, z: m.z };
    state.inMech = null;
    state.holstered = false;
    el.hud.classList.remove('driving');
    el.hud.classList.remove('piloting', 'cockpit');
    el.mechHud.classList.add('hidden');
    el.vehiclePanel.classList.add('hidden');
    player.teleport(out.x, out.z);
    state.prev = { x: out.x, y: player.y, z: out.z };
    state.curr = { x: out.x, y: player.y, z: out.z };
    if (thrown) {
      combat.hurt(30, m.x, m.z, out.x, out.z);
      toast('blown clear');
    }
  }

  function leaveVehicle(thrown) {
    const v = state.inVehicle;
    if (!v) return;
    const out = vehicles.leave() || { x: v.x, z: v.z, y: v.y };
    state.inVehicle = null;
    state.holstered = false;
    el.hud.classList.remove('driving');
    el.vehiclePanel.classList.add('hidden');
    player.teleport(out.x, out.z);
    state.prev = { x: out.x, y: player.y, z: out.z };
    state.curr = { x: out.x, y: player.y, z: out.z };
    if (thrown) {
      combat.hurt(22, v.x, v.z, out.x, out.z);
      toast('thrown clear');
    }
  }

  /**
   * One of whatever you asked for, parked a few metres away on the first
   * clear spot going round you.
   */
  function dropRide(type) {
    if (state.mode !== 'walk') return null;
    cheats.used = true;
    applyCheats();
    // A mech is not in the vehicle table at all, and it does not walk out of
    // a side street: it is dropped.
    if (MECH[type]) return callTitan(type);
    // A fighter needs a runway, and a street is not one. Asked for from the
    // menu it arrives in the air, already flying, with you in it: the cheat
    // is the take off. It can still be taken off the ground if you find
    // somewhere long enough and straight enough to roll.
    const spec = VEHICLE[type];
    if (spec && spec.stall) {
      const yaw = camera.yaw;
      const ahead = 60;
      const x = player.x - Math.sin(yaw) * ahead;
      const z = player.z - Math.cos(yaw) * ahead;
      const v = vehicles.spawn(type, x, z, yaw, 180);
      if (!v) return null;
      v.speed = spec.stall * 1.6;
      v.pitch = 0.05;
      if (state.inVehicle) leaveVehicle(false);
      if (state.inMech) leaveMech(false);
      if (vehicles.enter(v)) {
        state.inVehicle = v;
        state.holstered = true;
        el.hud.classList.add('driving');
        el.vehiclePanel.classList.remove('hidden');
        el.vehicleName.textContent = v.spec.name;
        el.vehicleKeys.textContent =
          'W S throttle, A D roll, mouse flies, Space up, right mouse down, left mouse fires';
        camera.yaw = v.yaw;
        audio.swap();
      }
      return v;
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = player.x + Math.cos(a) * 9;
      const z = player.z + Math.sin(a) * 9;
      let boxed = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (world.raycast(x, world.groundHeight(x, z) + 1.2, z, dx, 0, dz, 5)) {
          boxed = true; break;
        }
      }
      if (boxed) continue;
      const v = vehicles.spawn(type, x, z, a + Math.PI);
      if (v) return v;
    }
    return null;
  }

  /**
   * Calls one down.
   *
   * It picks a clear spot a little way off, puts the words on the screen, and
   * drops forty tonnes from two hundred metres. The landing is the arrival:
   * it opens the road under it, and anything standing there is standing in
   * the wrong place.
   *
   * @param {string} type a key of MECH
   * @returns {object|null} the mech on its way down
   */
  function callTitan(type) {
    const spot = mechSpot(26);
    if (!spot) { toast('no room to drop one here'); return null; }
    const yaw = Math.atan2(-(player.x - spot.x), -(player.z - spot.z));
    // Nothing is spawned yet. What exists is a promise and a place: the
    // machine is somewhere above the weather for the next half minute, and
    // the only thing on the ground is the mark it is coming down on.
    state.titanInbound = {
      type, x: spot.x, z: spot.z, yaw,
      left: TITANFALL.wait, mark: 0, mech: null,
    };
    el.titanfallSub.textContent = `${MECH[type].name} inbound ${TITANFALL.wait}`;
    el.titanfall.classList.remove('hidden');
    audio.machineCall(0, true);
    feed('<b>standby for titanfall</b>');
    toast(`${MECH[type].name} inbound. Stand clear.`);
    return state.titanInbound;
  }

  /**
   * The wait, while it is on its way.
   *
   * Counts down on the screen, marks the road it is coming down on, and when
   * the clock runs out puts the thing in the sky above that mark. From there
   * the ordinary fall takes over, and the landing clears the banner.
   */
  function titanTick(dt) {
    const call = state.titanInbound;
    if (!call) return;
    // Already falling: the banner stays up until it lands, which the stomp
    // takes care of.
    if (call.mech) {
      if (!call.mech.alive) { el.titanfall.classList.add('hidden'); state.titanInbound = null; }
      return;
    }
    // Two ways a call is lost before anything leaves the sky: you have gone
    // somewhere else, so the ground it was coming down on is not loaded any
    // more, or you are dead, and a machine landing on a corpse helps nobody.
    if (!world.isLoaded(call.x, call.z) || combat.health <= 0) {
      el.titanfall.classList.add('hidden');
      state.titanInbound = null;
      return;
    }
    call.left -= dt;
    const name = MECH[call.type].name;
    el.titanfallSub.textContent = call.left > 0
      ? `${name} inbound ${Math.ceil(call.left)}`
      : `${name} coming down`;

    // The mark on the road: a column of light standing where it will land,
    // which opens out in the last few seconds, and a ring of sparks turning
    // in the bottom of it. Anybody near enough to be flattened can see what
    // is about to happen to them, which is the difference between a drop and
    // an accident. The column is re-emitted every step by design: a beam is
    // a thing that is there until it is not.
    const y = world.groundHeight(call.x, call.z);
    const close = call.left < TITANFALL.beacon;
    effects.beam(call.x, y + 0.1, call.z,
      close ? 220 : 130, close ? 3.4 : 1.2, 1.0, 0.80, 0.32, 7);
    call.mark -= dt;
    if (call.mark <= 0) {
      call.mark = close ? 0.1 : 0.3;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + state.time;
        effects.spark(call.x + Math.cos(a) * 3.4, y + 0.4 + Math.random(),
          call.z + Math.sin(a) * 3.4, 1.0, 0.82, 0.35);
      }
    }
    if (call.left > 0) return;

    // Down it comes. If the street has filled up in the meantime there is
    // nowhere to put it, and the call is simply lost: better than dropping
    // forty tonnes into a space it cannot stand in.
    const m = mechs.drop(call.type, call.x, call.z, call.yaw);
    if (!m) {
      el.titanfall.classList.add('hidden');
      state.titanInbound = null;
      toast('the drop was waved off');
      return;
    }
    call.mech = m;
    audio.machineCall(0, true);
  }

  /**
   * Puts a mech on the street near you, in the first place one fits.
   *
   * It is a bigger thing than a jeep, so the search is wider and it asks for
   * clear ground in four directions rather than two: a mech wedged into a
   * courtyard it cannot walk out of is worse than no mech at all.
   *
   * @param {string} type a key of MECH
   * @param {number} away how far out to look
   * @returns {object|null}
   */
  function spawnMech(type, away = 14) {
    const spot = mechSpot(away);
    if (!spot) return null;
    return mechs.spawn(type, spot.x, spot.z, spot.a + Math.PI);
  }

  /**
   * Somewhere near you with room for eight metres of machine: loaded ground,
   * nothing within seven metres in any of the four directions, so it is not
   * dropped into a courtyard it cannot walk out of.
   *
   * @param {number} away how far out to look
   * @returns {{x,z,a}|null}
   */
  function mechSpot(away = 14) {
    // Several rings rather than one. A single ring at a fixed distance is a
    // coin toss in a street with anything in it: the first version of this
    // answered no about one call in three from a cratered square, and a
    // Titan that cannot be called because of where you happen to be standing
    // is a Titan you do not have.
    for (const scale of [1, 0.7, 1.4, 1.9, 0.5, 2.4]) {
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + Math.random() * 0.2;
        const r = away * scale * (0.9 + Math.random() * 0.2);
        const x = player.x + Math.cos(a) * r;
        const z = player.z + Math.sin(a) * r;
        if (!world.isLoaded(x, z)) continue;
        let boxed = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (world.raycast(x, world.groundHeight(x, z) + 3.0, z, dx, 0, dz, 7)) {
            boxed = true; break;
          }
        }
        if (boxed) continue;
        return { x, z, a };
      }
    }
    return null;
  }

  /**
   * Puts a few where you can find them: once after the world loads, and again
   * each time you cross into a district, because the ones you left behind
   * went out of memory with the streets they were parked on.
   *
   * @param {{x,z}} at the middle of the search
   */
  function parkVehicles(at = spawn) {
    const kinds = ['jeep', 'jeep', 'tank', 'heli', 'jet'];
    let placed = 0;
    for (let i = 0; i < kinds.length; i++) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const a = Math.random() * Math.PI * 2;
        const r = 30 + Math.random() * 110;
        const x = at.x + Math.cos(a) * r;
        const z = at.z + Math.sin(a) * r;
        if (combat.isSanctuary(x, 0, z)) continue;
        // Somewhere a vehicle could actually sit: nothing within its own
        // length in four directions.
        let boxed = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (world.raycast(x, world.groundHeight(x, z) + 1.2, z, dx, 0, dz, 6)) {
            boxed = true; break;
          }
        }
        if (boxed) continue;
        const air = kinds[i] === 'heli' || kinds[i] === 'jet';
        if (vehicles.spawn(kinds[i], x, z, a, air ? 0 : 0)) { placed++; break; }
      }
    }
    return placed;
  }

  // --- the ion cannon -------------------------------------------------------
  // What is under a beam. Soldiers burn down to the bone, drones and jets
  // come apart, and you are not exempt.
  ion.onSweep = (x, z, radius, dt) => {
    const burn = dt * 2.6;
    for (const sd of [...soldiers.active]) {
      if (Math.hypot(sd.x - x, sd.z - z) > radius) continue;
      sd.charred = Math.min(1, (sd.charred || 0) + burn);
      if (soldiers.damage(sd, 220 * dt, { x: 0, y: 0, z: 0 })) {
        // Burnt rather than blown apart: whatever is left stays standing
        // until the ground takes it.
        sd.charred = 1;
        creditTarget(sd, false, 'soldier');
      }
      if (Math.random() < dt * 6) {
        effects.flame(sd.x, sd.y, sd.z, 2.0, 0.5);
      }
    }
    for (const d of [...drones.active]) {
      if (Math.hypot(d.x - x, d.z - z) > radius + 3) continue;
      if (drones.damage(d, 400 * dt)) creditTarget(d, false, 'drone');
    }
    for (const j of [...jets.active]) {
      if (Math.hypot(j.x - x, j.z - z) > radius + 10) continue;
      jets.damage(j, 400 * dt);
    }
    if (Math.hypot(player.x - x, player.z - z) < radius && combat.health > 0) {
      combat.hurt(260 * dt, x, z, player.x, player.z);
    }
    // And it sets light to whatever it is standing on.
    if (Math.random() < dt * 1.4) fires.ignite(x, 0, z, radius * 2.2, 0.8);
  };

  ion.onCharge = () => {
    audio.ionCharge();
    toast('ion cannon, charging');
    feed('<i>ion cannon</i> charging');
  };

  ion.onMain = (x, y, z) => {
    audio.ionFire();
    if (cheats.slowBlast) state.blastSlow = 6.0;
    // One blast, bigger than a warhead, straight through the normal path so
    // the buildings, the trees and the collision all hear about it the same
    // way they would from anything else.
    explode(x, y + 40, z, {
      radius: ionRadius(), damage: ION.damage, burst: 40, nuke: true,
    });
    state.flash = Math.max(state.flash, 1.1);
  };

  ion.onDone = () => { feed('<i>ion cannon</i> spent'); };

  gibs.onDrip = (x, y, z) => { if (cheats.bleeding) effects.drip(x, y, z); };
  gibs.onPool = (x, y, z, size) => { if (cheats.bleeding) effects.stain(x, y, z, size); };

  soldiers.onGib = (s, dir) => {
    const n = gibs.burst(s.x, s.y, s.z, dir, cheats.goreScale);
    if (cheats.bleeding) {
      const k = cheats.goreScale;
      // Three sprays up the height of where they were standing rather than
      // one out of the middle, so a burst looks like a body coming apart and
      // not like a bucket going over.
      for (const up of [0.4, 1.0, 1.5]) {
        effects.blood(s.x, s.y + up, s.z,
          (Math.random() - 0.5) * 1.2, 1, (Math.random() - 0.5) * 1.2, k * 1.6);
      }
      effects.stain(s.x, s.y, s.z, 0.75 + k * 0.22);
      for (let i = 0; i < Math.round(1 + k * 0.6); i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.8 + Math.random() * 2.4 * k;
        const px = s.x + Math.cos(a) * r, pz = s.z + Math.sin(a) * r;
        effects.stain(px, world.groundHeight(px, pz), pz, 0.2 + Math.random() * 0.35);
      }
    }
    effects.shake = Math.min(1, effects.shake + 0.12);
    // The kill itself is credited by whoever made it, the same as any other,
    // because a gib is still one dead soldier and not two.
    return n;
  };
  soldiers.onDeath = (s) => {
    if (!cheats.bleeding) return;
    const k = cheats.goreScale;
    effects.blood(s.x, s.y + 1.1, s.z, 0, 1, 0, k);
    // The pool arrives a moment after they do rather than with them, which is
    // the difference between a body bleeding and a body landing in a puddle.
    setTimeout(() => {
      if (!cheats.bleeding) return;
      effects.stain(s.x, world.groundHeight(s.x, s.z), s.z, 0.5 + k * 0.16, 40);
    }, 700);
  };
  // A skeleton that has stood long enough comes apart where it stands: a
  // handful of bone coloured pieces, a dry clatter, and nothing left.
  soldiers.onCrumble = (s) => {
    gibs.rubble(s.x, s.y + 0.9, s.z, 0.5, 7, 1.1);
    effects.dust(s.x, s.y + 0.4, s.z, 1.4);
    audio.treeFall(Math.hypot(player.x - s.x, player.z - s.z) + 60);
    feed('<b>crumbled</b>');
  };
  soldiers.onSlip = (s) => {
    toast('down he goes');
    feed('<b>slipped</b> on a banana');
    audio.swoosh(Math.hypot(player.x - s.x, player.z - s.z));
  };

  drones.onShot = (d, damage) => {
    if (combat.health <= 0) return;
    effects.tracer(d.x, d.y - 0.2, d.z, camera.position[0], camera.position[1], camera.position[2], false);
    combat.hurt(damage, d.x, d.z, player.x, player.z);
  };

  // Taking something off a pad. Ammunition and health apply here and are done;
  // the three power ups hand off to combat, which owns their clocks.
  pickups.onTaken = (pad, spec) => {
    audio.pickup(pad.kind);
    if (pad.kind === 'ammo') {
      const given = weapon.resupply(spec.held, spec.others);
      feed(given > 0 ? `<b>ammunition</b> +${given}` : '<b>ammunition</b> full');
      return;
    }
    if (pad.kind === 'health') {
      const got = Math.round(combat.heal(spec.heal));
      feed(got > 0 ? `<b>medical kit</b> +${got}` : '<b>medical kit</b> full');
      return;
    }
    combat.givePower(pad.kind, spec);
  };
  combat.onPower = (kind, spec) => {
    feed(`<i>${spec.label}</i> ${spec.seconds}s`);
    toast(spec.name);
  };
  combat.onPowerEnd = () => audio.powerEnd();

  // --- cheats -------------------------------------------------------------
  // The menu is built from the tables in cheats.js rather than written out in
  // the HTML, so adding a switch is adding a row there and nothing else.

  const NUKE = {
    // The numbers a warhead is made of. The radius is the one that matters:
    // everything else here is set so that it reads at that size.
    // burst is how far above the crater the fireball sits. Everything within
    // the radius of that point and in sight of it is inside the blast.
    radius: 170, damage: 4000, drop: 430, speed: 105, fall: 3.2, burst: 55,
  };

  /** Everything that reads a cheat, told what the cheats now say. */
  function applyCheats() {
    combat.godmode = cheats.godmode;
    combat.cheated = cheats.used;
    weapon.infiniteAmmo = cheats.infiniteAmmo;
    // Switching the drones off stops them coming and takes down whatever is
    // already up, because an enemy frozen in the air is worse than no enemy.
    if (drones.enabled === cheats.noDrones) {
      drones.enabled = !cheats.noDrones;
      if (cheats.noDrones) drones.reset();
    }
    soldiers.gore.gib = cheats.gibbing;
    soldiers.gore.ragdoll = cheats.tumbling;
    soldiers.gore.scale = cheats.goreScale;
    soldiers.boneTime = cheats.value('boneTime');
    el.cheatMark.classList.toggle('hidden', !cheats.used);
    for (const sw of cheatRows) sw.el.classList.toggle('on', !!cheats[sw.id]);
  }

  const cheatRows = [];
  // The sliders, so that resetting the menu can put them back where they
  // started without rebuilding the whole thing.
  const settingShown = [];

  function buildCheatMenu() {
    for (const a of ACTIONS) {
      const b = document.createElement('button');
      b.className = 'act';
      b.dataset.action = a.id;
      b.innerHTML = `<b>${a.label}</b><i>${a.note}</i>`;
      b.addEventListener('click', () => runCheatAction(a.id));
      el.cheatActions.appendChild(b);
    }
    for (const ride of RIDES) {
      const b = document.createElement('button');
      b.className = 'act';
      b.dataset.ride = ride.id;
      b.innerHTML = `<b>${ride.label}</b><i>${ride.note}</i>`;
      b.addEventListener('click', () => {
        const v = dropRide(ride.id);
        // A mech is not parked outside: it is half a minute away and says so
        // itself, on the banner and on the road.
        if (!v) toast('no room for one here');
        else if (!MECH[ride.id]) toast(`${v.spec.name} outside. F to get in.`);
      });
      el.cheatRides.appendChild(b);
    }
    for (const sp of SPAWNS) {
      const b = document.createElement('button');
      b.className = 'act';
      b.dataset.spawn = sp.id;
      b.innerHTML = `<b>${sp.label}</b><i>${sp.note}</i>`;
      b.addEventListener('click', () => {
        const n = spawnWave(sp.id, sp.count);
        toast(n ? `${n} ${sp.label.toLowerCase()}` : 'no room for any more');
      });
      el.cheatSpawns.appendChild(b);
    }
    for (const spec of SETTINGS) {
      const row = document.createElement('label');
      row.className = 'val';
      row.dataset.setting = spec.id;
      const num = document.createElement('span');
      num.className = 'num';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(spec.min);
      slider.max = String(spec.max);
      slider.step = String(spec.step);
      slider.value = String(cheats.value(spec.id));
      const show = () => {
        const v = cheats.value(spec.id);
        // Nought on a timer does not mean nought seconds, it means never, and
        // the menu should say so rather than making you work it out.
        num.textContent = v === 0 && spec.unit === 's' ? 'never' : `${v} ${spec.unit}`;
      };
      slider.addEventListener('input', () => {
        cheats.setValue(spec.id, parseFloat(slider.value));
        show();
        applyCheats();
      });
      const name = document.createElement('b');
      name.textContent = spec.label;
      const note = document.createElement('i');
      note.textContent = spec.note;
      row.appendChild(name);
      row.appendChild(num);
      row.appendChild(note);
      row.appendChild(slider);
      el.cheatValues.appendChild(row);
      show();
      settingShown.push({ spec, slider, show });
    }
    for (const [list, host, gore] of [[SWITCHES, el.cheatSwitches, false],
      [GORE, el.cheatGore, true]]) {
      for (const sw of list) {
        const b = document.createElement('button');
        b.className = gore ? 'sw gore' : 'sw';
        b.dataset.cheat = sw.id;
        b.innerHTML = `<span class="box"></span><span>${sw.label}<i>${sw.note}</i></span>`;
        b.addEventListener('click', () => {
          cheats.toggle(sw.id);
          applyCheats();
          toast(`${sw.label}: ${cheats[sw.id] ? 'on' : 'off'}`);
        });
        host.appendChild(b);
        cheatRows.push({ id: sw.id, el: b });
      }
    }
  }
  buildCheatMenu();

  /**
   * More of them, now. Each goes in through the same spawn the game uses, so
   * a soldier put here is a soldier like any other: it finds a place to stand,
   * keeps out of the weapons free zone, and belongs to the same budget.
   *
   * @returns {number} how many actually arrived
   */
  /**
   * Rise of the Machines, while it is running: keep the streets populated,
   * drop warheads on the skyline, and hold the sky where the mode wants it.
   */
  /**
   * Whether the machine walking in now is one of the ones carrying a mech
   * killer. Rolled when it arrives rather than when it shoots, so what a
   * street holds is settled and a given one either has one or does not.
   */
  function rollMechKiller() {
    if (!cheats.mechKillers) return false;
    return Math.random() < cheats.value('mechKillerOdds') / 100;
  }

  function machinesTick(dt) {
    if (!machines.active || state.mode !== 'walk') return;
    // What they are looking at. A warhead meant for armour is not spent on a
    // man on foot, and this is the only place that knows the difference.
    soldiers.armouredTarget = !!(state.inMech || state.inVehicle);
    const standing = soldiers.active.filter((s) => s.machine && s.alive).length;
    if (machines.tickSpawn(dt, standing)) {
      const made = soldiers.spawnNear(player.x, player.z, MACHINES.spawnFrom, MACHINES.spawnTo);
      if (made) makeMachine(made, rollMechKiller());
    }
    // And the heavy ones, walking in from further out.
    const heavies = mechs.active.filter((m) => !m.mine && m.health > 0).length;
    if (machines.tickMech(dt, heavies)) {
      spawnMech('reaper', MACHINES.mechFrom
        + Math.random() * (MACHINES.mechTo - MACHINES.mechFrom));
    }
    // The hum, and the two tone they give when one of them has you. Spread
    // out over whoever is nearest, so a street full of them is a chorus
    // rather than a machine gun of beeps.
    state.machineVoice = (state.machineVoice || 0) - dt;
    if (state.machineVoice <= 0) {
      state.machineVoice = 1.4 + Math.random() * 1.6;
      let near = null, bestD = 150;
      let hunting = false;
      for (const s2 of soldiers.active) {
        if (!s2.machine || !s2.alive || s2.stunLeft > 0) continue;
        const d = Math.hypot(s2.x - player.x, s2.z - player.z);
        if (d < bestD) { bestD = d; near = s2; hunting = !!s2.canSee; }
      }
      if (near) audio.machineCall(bestD, hunting);
    }

    if (machines.tickRain(dt)) {
      // Somewhere you can see, rather than on top of you: the horizon is the
      // point of this, and a warhead in your lap every two seconds is not a
      // game.
      for (let attempt = 0; attempt < 6; attempt++) {
        const a = Math.random() * Math.PI * 2;
        const far = 420 + Math.random() * 900;
        const x = player.x + Math.cos(a) * far;
        const z = player.z + Math.sin(a) * far;
        if (x < world.minX + 80 || x > world.maxX - 80) continue;
        if (z < world.minZ + 80 || z > world.maxZ - 80) continue;
        if (!world.isLoaded(x, z)) continue;
        if (sanctuaryWithin(x, z, nukeRadius())) continue;
        dropNuke(x, z, true);
        break;
      }
    }
  }

  /** The end of the world, as a set of numbers the renderer understands. */
  function applyMachineLook() {
    if (machines.active) {
      renderer.timeOfDay = machines.timeOfDay;
      renderer.fogDensity = MACHINES.fog;
      renderer.armageddon = 1;
      soldiers.beam = MACHINES.beam;
      soldiers.killer = MACHINES.killer;
      el.hud.classList.add('machines');
    } else {
      renderer.fogDensity = 0.00075;
      renderer.armageddon = 0;
      soldiers.beam = null;
      soldiers.killer = null;
      el.hud.classList.remove('machines');
    }
  }

  function spawnWave(kind, count) {
    if (state.mode !== 'walk') return 0;
    cheats.used = true;
    applyCheats();
    let made = 0;
    for (let i = 0; i < count; i++) {
      if (kind === 'soldiers') {
        // The spawner picks the spot, which is what keeps them out of walls
        // and out of the memorial. Raising the budget along with them means
        // the field does not quietly delete what you just asked for.
        if (soldiers.spawnNear(player.x, player.z, 28, 90)) made++;
      } else if (kind === 'drones') {
        if (drones.spawnNear(player.x, player.z, 55, 130)) made++;
      } else if (kind === 'jets') {
        if (jets.spawnFar(player.x, player.z)) made++;
      } else if (kind === 'reapers') {
        if (spawnMech('reaper', 60 + Math.random() * 60)) made++;
      }
    }
    if (kind === 'soldiers') soldiers.budget = Math.max(soldiers.budget, soldiers.active.length);
    if (kind === 'drones') drones.budget = Math.max(drones.budget, drones.active.length);
    if (kind === 'jets') jets.budget = Math.max(jets.budget, jets.active.length);
    return made;
  }

  function runCheatAction(id) {
    if (id === 'allWeapons') {
      cheats.used = true;
      const n = weapon.giveAll();
      toast(`every weapon loaded, ${n} rounds`);
      feed('<i>cheat</i> all weapons');
    } else if (id === 'refill') {
      cheats.used = true;
      const n = weapon.resupply(1, 1);
      toast(n > 0 ? `${n} rounds` : 'already full');
    } else if (id === 'nuke') {
      openTargeting();
      return;
    } else if (id === 'ion') {
      openMap('ion');
      return;
    }
    applyCheats();
  }

  function toggleCheatMenu(show) {
    const on = show === undefined ? el.cheats.classList.contains('hidden') : show;
    el.cheats.classList.toggle('hidden', !on);
    if (on) {
      // Remember whether the mouse was actually captured, so that closing the
      // menu gives it back only to somebody who had it. Asking for a lock
      // nobody asked for is both rude and, if one is already pending, an
      // exception.
      state.lockWanted = input.pointerLocked;
      input.exitLock();
      applyCheats();
    } else {
      relock();
    }
  }

  /** The pointer, back to where it was before a panel took it. */
  function relock() {
    if (isTouch || state.mode !== 'walk') return;
    if (!state.lockWanted || input.pointerLocked) return;
    state.lockWanted = false;
    input.requestLock();
  }
  el.cheatsClose.addEventListener('click', () => toggleCheatMenu(false));
  el.cheatsReset.addEventListener('click', () => {
    cheats.reset();
    for (const row of settingShown) {
      row.slider.value = String(cheats.value(row.spec.id));
      row.show();
    }
    applyCheats();
  });

  // --- putting a warhead somewhere ----------------------------------------
  // The target is picked on a map rather than down the sight, because the
  // thing has a radius of a hundred and seventy metres and you want to see
  // what is inside it before you commit.

  const targetMap = new Minimap(el.targetMap, world, landmarks);
  targetMap.big = true;
  targetMap.sanctuaries = combat.sanctuaries;
  // The enlarged map shows the zone too, because it is a fact about the city
  // and not only about warheads.
  minimap.sanctuaries = combat.sanctuaries;

  // The same map serves two jobs: putting a warhead somewhere and flying
  // somewhere. They differ in what the circle means, what the confirmation
  // says and what the button does, and in nothing else.
  const MAP_MODE = {
    nuke: {
      hint: 'Click the city to put a warhead on it. '
        + 'Wheel zooms, drag moves. Esc to think better of it.',
      armed: 'Enter to release, Esc to cancel.',
      button: 'Release',
    },
    travel: {
      hint: 'Click anywhere in the city to fly there. '
        + 'Wheel zooms, drag moves. Esc to stay where you are.',
      armed: 'Enter to go, Esc to cancel.',
      button: 'Fly there',
    },
    ion: {
      hint: 'Click the city to put the ion cannon on it. '
        + 'Wheel zooms, drag moves. Esc to think better of it.',
      armed: 'Enter to open fire, Esc to cancel.',
      button: 'Open fire',
    },
  };

  function openMap(mode) {
    if (state.mode !== 'walk') return;
    // Hide the menu without going through the toggle, which would ask for the
    // pointer back on the way out and then have it taken away again one line
    // later. Asking for a lock you are about to drop throws in Chrome.
    el.cheats.classList.add('hidden');
    state.lockWanted = state.lockWanted || input.pointerLocked;
    state.targeting = true;
    state.mapMode = mode;
    state.pendingNuke = null;
    // The map comes out from under your feet rather than appearing: it opens
    // on the street you are standing in and pulls back over half a second to
    // the scale you pick a target at. Closing runs the same move backwards,
    // so a warhead ends where you are rather than cutting to it.
    targetMap.resetView();
    targetMap.centre = { x: player.x, z: player.z };
    targetMap.zoom = MAP_ZOOM.near;
    state.mapPull = { from: MAP_ZOOM.near, to: MAP_ZOOM.pick, t: 0, back: false };
    targetMap.aim = { x: player.x, z: player.z, radius: aimRadius(mode), allowed: true };
    el.nukeTarget.classList.toggle('travel', mode === 'travel');
    el.nukeTarget.classList.remove('hidden');
    el.targetConfirm.classList.add('hidden');
    el.confirmFire.textContent = MAP_MODE[mode].button;
    el.targetHint.textContent = MAP_MODE[mode].hint;
    input.exitLock();
    drawTargetMap();
  }

  // How far out the target map pulls, and how long it takes.
  const MAP_ZOOM = { near: 9, pick: 2.2, seconds: 0.55 };

  function openTargeting() { openMap('nuke'); }
  function openTravel() { openMap('travel'); }

  /**
   * Shuts the map. With `rush` it goes at once, which is what a cancel wants;
   * otherwise it flies back down onto you first, which is what firing wants.
   */
  function closeTargeting(rush = false) {
    if (!state.targeting) return;
    if (!rush && !state.mapPull) {
      state.mapPull = {
        from: targetMap.zoom, to: MAP_ZOOM.near, t: 0, back: true,
        fromCentre: targetMap.centre ? { ...targetMap.centre } : { x: player.x, z: player.z },
      };
      return;
    }
    state.targeting = false;
    state.mapPull = null;
    state.pendingNuke = null;
    targetMap.aim = null;
    el.nukeTarget.classList.add('hidden');
    el.targetConfirm.classList.add('hidden');
    relock();
  }

  /**
   * The pull: half a second of zoom, on the wall clock, between the street you
   * are standing in and the scale you aim at.
   */
  function stepMapPull(dt) {
    const pull = state.mapPull;
    if (!pull) return;
    pull.t = Math.min(1, pull.t + dt / MAP_ZOOM.seconds);
    const k = pull.t * pull.t * (3 - 2 * pull.t);
    targetMap.zoom = pull.from + (pull.to - pull.from) * k;
    if (pull.back) {
      // On the way back the window slides onto you as well as zooming in, so
      // the last thing the map shows is where you are standing.
      targetMap.centre = {
        x: pull.fromCentre.x + (player.x - pull.fromCentre.x) * k,
        z: pull.fromCentre.z + (player.z - pull.fromCentre.z) * k,
      };
    }
    if (pull.t >= 1) {
      const wasBack = pull.back;
      state.mapPull = null;
      if (wasBack) closeTargeting(true);
    }
    drawTargetMap();
  }

  function drawTargetMap() {
    targetMap.draw(player.x, player.z, camera.yaw, landmarks.found, pickups.live);
    el.targetZoom.textContent = `${targetMap.zoom.toFixed(1)}x`;
  }

  /** How many of them, and you, are inside a circle. */
  function countInside(x, z, radius) {
    let n = 0;
    for (const list of [drones.active, soldiers.active, jets.active]) {
      for (const a of list) {
        if (a.alive === false) continue;
        if (Math.hypot(a.x - x, a.z - z) <= radius) n++;
      }
    }
    return n;
  }

  /**
   * Picking a point is not the same as agreeing to put a warhead on it, so the
   * first click arms it and says what is inside the circle, including you, and
   * the second one releases it.
   */
  function armNuke(x, z) {
    // The reticle and the question are set together, so the circle you are
    // being asked about is always the circle you can see.
    aimAt(x, z);
    const away = Math.round(Math.hypot(x - player.x, z - player.z));
    if (state.mapMode === 'travel') {
      // Except a district nobody has built yet, which is on the map because
      // the map is all of Berlin, and which there is nothing to land in.
      const where = world.entryAt(x, z);
      if (where && !world.isBuilt(where)) {
        state.pendingNuke = null;
        el.targetConfirm.classList.add('hidden');
        el.targetHint.textContent = `${where.name || where.id} is not built yet`;
        return false;
      }
      // Nothing else is off limits here. Walking into the memorial has always
      // been allowed; it is firing in it that is not.
      state.pendingNuke = { x, z };
      el.confirmWhere.textContent = away >= 1000
        ? `${(away / 1000).toFixed(2)} km from here. About ${Math.round(estimateFlight(away))} seconds.`
        : `${away} m from here. About ${Math.round(estimateFlight(away))} seconds.`;
      el.confirmSelf.classList.add('hidden');
      el.targetConfirm.classList.remove('hidden');
      el.targetHint.textContent = MAP_MODE.travel.armed;
      return true;
    }
    const radius = aimRadius(state.mapMode);
    if (sanctuaryWithin(x, z, radius)) {
      el.targetHint.textContent = 'not there: the memorial is a weapons free zone';
      el.targetConfirm.classList.add('hidden');
      state.pendingNuke = null;
      return false;
    }
    state.pendingNuke = { x, z };
    const inside = countInside(x, z, radius);
    el.confirmWhere.textContent = state.mapMode === 'ion'
      ? `${away} m away. Three beams for ${Math.round(ION.charge)} seconds, `
        + `then ${radius} m of everything. ${inside} target${inside === 1 ? '' : 's'} inside.`
      : `${away} m away, ${radius} m across, ${inside} target${inside === 1 ? '' : 's'} inside.`;
    const self = away < radius;
    el.confirmSelf.classList.toggle('hidden', !self);
    el.confirmSelf.textContent = combat.godmode
      ? 'You are inside it. God mode is on.'
      : 'You are inside it. This will kill you.';
    el.targetConfirm.classList.remove('hidden');
    el.targetHint.textContent = MAP_MODE[state.mapMode].armed;
    return true;
  }

  /** Roughly how long the flight will take, for the confirmation. */
  function estimateFlight(distance) {
    return TRAVEL.rise + TRAVEL.fall
      + clamp(distance / TRAVEL.cruiseSpeed, TRAVEL.minCruise, TRAVEL.maxCruise);
  }

  /** Whichever the map is for. */
  function releaseNuke() {
    const at = state.pendingNuke;
    if (!at) return false;
    if (state.mapMode === 'travel') {
      // The flight is its own camera move, so the map goes at once rather
      // than flying back onto a player who is about to leave.
      closeTargeting(true);
      beginTravel(at.x, at.z);
      return true;
    }
    if (state.mapMode === 'ion') {
      if (!ion.fire(at.x, at.z)) {
        el.targetHint.textContent = ion.firing
          ? 'the cannon is already firing'
          : 'not there: the memorial is a weapons free zone';
        return false;
      }
      cheats.used = true;
      applyCheats();
      closeTargeting();
      return true;
    }
    if (!dropNuke(at.x, at.z)) {
      el.targetHint.textContent = 'not there: the memorial is a weapons free zone';
      return false;
    }
    closeTargeting();
    return true;
  }

  /**
   * Up, across and down. The player does not move until the camera lands, so
   * nothing can shoot at a body that is not there, and the weapon stays
   * holstered for the whole flight.
   */
  function beginTravel(x, z) {
    const tx = Math.min(world.maxX - 10, Math.max(world.minX + 10, x));
    const tz = Math.min(world.maxZ - 10, Math.max(world.minZ + 10, z));
    travel.start({
      x: player.x, y: player.y + PLAYER.eye, z: player.z,
      yaw: camera.yaw, pitch: camera.pitch,
    }, {
      x: tx, y: world.groundHeight(tx, tz) + PLAYER.eye, z: tz,
      yaw: camera.yaw, pitch: -0.04,
    });
    state.travelTo = { x: tx, z: tz };
    state.mode = 'travel';
    // The place you are flying to may be in a district that is not in memory,
    // and the flight is seven seconds of warning that you are coming. Start
    // fetching it now and bring the tiles in along the way, so the city is
    // there when you arrive rather than appearing around you afterwards.
    const far = world.entryAt(tx, tz);
    if (far && !world.loaded(far.id)) {
      // The flight is the loading screen: it takes seven seconds and the
      // district lands inside that, so there is nothing to wait for at the
      // far end. If it does not, the landing holds in the air until it does.
      // Anything still falling where you are standing goes into the record
      // before you leave it behind.
      demolition.bakeAll();
      world.loadDistrict(far.id).then(() => {
        restoreScars(far.id);
        tiles.uploadsPerFrame = 10000;
        tiles.updateResidency(tx, tz, loop.frame);
        tiles.uploadsPerFrame = 8;
        // One district at a time: whatever we took off from goes now.
        for (const id of world.loadedIds) {
          if (id !== far.id) world.unloadDistrict(id);
        }
      }).catch(() => toast(`${far.name} could not be loaded`));
    }
    tiles.updateResidency(tx, tz, loop.frame);
    return true;
  }

  /**
   * Crossing into another district.
   *
   * One district is in memory at a time, so this is a wait rather than a
   * stream: the screen says which part of Berlin is coming and what is in it,
   * the bytes land, the old district is let go, and you are put down on the
   * other side. Everything that was happening is left where it was, because
   * the simulation is not what is being swapped, the city is.
   *
   * @param {number} x @param {number} z where you are going
   * @param {string} why what to say under the name
   * @returns {Promise<boolean>} whether the district is now in
   */
  async function crossInto(x, z, why = '') {
    const entry = world.entryAt(x, z);
    if (!entry) return false;
    if (world.loaded(entry.id)) return true;
    if (state.crossing) return false;
    // A district of Berlin that has not been built yet is on the map and in
    // the index, because the city is the whole city whatever is built, but
    // there is nothing to walk into. Saying so is better than a loading
    // screen that never fills.
    if (!world.isBuilt(entry)) {
      if (state.unbuiltSaid !== entry.id) {
        state.unbuiltSaid = entry.id;
        toast(`${entry.name || 'that part of Berlin'} is not built yet`);
      }
      return false;
    }
    state.crossing = entry.id;
    el.crossName.textContent = entry.name || 'Berlin';
    // The one thing in there worth walking towards. It is chosen when the
    // district is built, so it is in the little index and can be named before
    // a single byte of the district itself has arrived.
    el.crossSight.textContent = entry.sight || '';
    el.crossSightLine.classList.toggle('hidden', !entry.sight);
    el.crossNote.textContent = why || districtBlurb(entry);
    el.crossFill.style.width = '0%';
    el.crossHint.textContent = `${(entry.bytes / 1e6).toFixed(1)} MB of city`;
    el.crossing.classList.remove('hidden');
    input.exitLock();
    // Anything still coming down goes into the record before the district it
    // is standing in is let go, or the last building you hit would be the one
    // building that got away.
    demolition.bakeAll();
    try {
      await world.enterOnly(x, z, (p) => {
        el.crossFill.style.width = `${Math.round(p * 100)}%`;
      });
      restoreScars(entry.id);
    } catch (err) {
      el.crossHint.textContent = 'that district could not be loaded';
      await new Promise((r) => setTimeout(r, 1200));
    }
    state.crossing = null;
    el.crossing.classList.add('hidden');
    // You were held at the boundary while it loaded, and the district you were
    // standing in has just been let go, so the last thing this does is put you
    // down on the other side rather than on ground that is no longer there.
    if (!world.isLoaded(player.x, player.z) && world.isLoaded(x, z)) {
      player.teleport(x, z);
      state.prev = { x, y: player.y, z };
      state.curr = { x, y: player.y, z };
    }
    // The vehicles that were parked in the district you have left went with
    // it, so the new one gets its own, parked around where you came out. The
    // one you are sitting in, if you drove here, comes with you.
    for (let i = vehicles.active.length - 1; i >= 0; i--) {
      const v = vehicles.active[i];
      if (v === state.inVehicle) continue;
      v.alive = false;
      vehicles.active.splice(i, 1);
    }
    parkVehicles({ x, z });
    tiles.uploadsPerFrame = 10000;
    tiles.updateResidency(x, z, loop.frame);
    tiles.uploadsPerFrame = renderer.quality === 'low' ? 3 : renderer.quality === 'medium' ? 5 : 8;
    if (!isTouch && state.lockWanted) relock();
    return world.isLoaded(x, z);
  }

  /**
   * What to say about a district while it loads: the landmark it is known for
   * if the data gave it one, and how much of it there is. Nothing invented:
   * the names come out of the district's own extract.
   */
  function districtBlurb(entry) {
    const km2 = ((entry.bounds.maxX - entry.bounds.minX)
      * (entry.bounds.maxZ - entry.bounds.minZ)) / 1e6;
    const parts = [`${km2.toFixed(1)} square kilometres`, `${entry.buildings} buildings`];
    if (entry.roadKm) parts.push(`${entry.roadKm} km of street`);
    return parts.join(', ');
  }

  /**
   * The district streamer. One district is in memory, and the next one is a
   * loading screen away: the whole of Berlin is eighty one districts and more
   * than two hundred megabytes, and what a player holds is the one they are
   * standing in.
   */
  function streamCity(x, z) {
    const here = world.idAt(x, z);
    el.district.textContent = world.nameAt(x, z) || 'Berlin';
    el.district.classList.toggle('loading', !!state.crossing);
    if (!here || state.crossing) return;
    // Walking at a boundary: when the ground ahead belongs to another
    // district, that is where you are going, and the screen says so. The
    // controller holds you at the edge until the bytes are in.
    if (!world.loaded(here)) crossInto(x, z);
  }

  /**
   * Are you about to walk out of the district you are in?
   *
   * Looks at the edge you are nearest and at the way you are facing rather
   * than at where your feet are: the controller holds you at the boundary of
   * what is loaded, so by the time your feet are over it you would be stuck
   * against an invisible wall waiting for a load that nothing had started.
   */
  function checkBoundary() {
    if (state.crossing || state.mode !== 'walk' || state.inVehicle) return;
    const here = world.entryFor(world.idAt(player.x, player.z));
    if (!here) return;
    // How close the nearest edge is, and which way it lies.
    const toWest = player.x - here.bounds.minX;
    const toEast = here.bounds.maxX - player.x;
    const toNorth = player.z - here.bounds.minZ;
    const toSouth = here.bounds.maxZ - player.z;
    const near = Math.min(toWest, toEast, toNorth, toSouth);
    if (near > 30) return;
    // A point just over whichever edge is nearest.
    let x = player.x, z = player.z;
    if (near === toWest) x = here.bounds.minX - 6;
    else if (near === toEast) x = here.bounds.maxX + 6;
    else if (near === toNorth) z = here.bounds.minZ - 6;
    else z = here.bounds.maxZ + 6;
    const next = world.idAt(x, z);
    if (!next || next === here.id || world.loaded(next)) return;
    // Only when you are actually walking at it, so standing near a boundary
    // does not drag the next district in behind you.
    const facing = { x: camera.forward[0], z: camera.forward[2] };
    const toward = (x - player.x) * facing.x + (z - player.z) * facing.z;
    if (toward <= 0) return;
    crossInto(x, z);
  }

  /**
   * What a warhead and the ion cannon reach, which the cheat menu can turn up
   * and which everything that draws a circle or asks about the memorial has
   * to read rather than assume.
   */
  function nukeRadius() { return cheats.value('nukeRadius') || NUKE.radius; }
  function ionRadius() { return cheats.value('ionRadius') || ION.blast; }

  /** How big the circle on the map is, which is what each mode is about. */
  function aimRadius(mode) {
    if (mode === 'travel') return 14;
    if (mode === 'ion') return ionRadius();
    return nukeRadius();
  }

  function aimAt(x, z) {
    const r = aimRadius(state.mapMode);
    targetMap.aim = {
      x, z, radius: r,
      allowed: state.mapMode === 'travel' || !sanctuaryWithin(x, z, r),
    };
  }

  // Zoom and pan. A map of a three kilometre city on a five hundred pixel
  // canvas puts a hundred and seventy metre circle at twenty five pixels, and
  // nobody can pick a street with that.
  el.targetIn.addEventListener('click', () => { zoomStep(1.5); });
  el.targetOut.addEventListener('click', () => { zoomStep(1 / 1.5); });
  el.targetFit.addEventListener('click', () => { targetMap.resetView(); drawTargetMap(); });
  function zoomStep(factor) {
    const r = el.targetMap.getBoundingClientRect();
    targetMap.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
    drawTargetMap();
  }
  el.targetMap.addEventListener('wheel', (ev) => {
    if (!state.targeting) return;
    ev.preventDefault();
    targetMap.zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.18 : 1 / 1.18);
    drawTargetMap();
  }, { passive: false });

  const drag = { on: false, x: 0, y: 0, moved: 0 };
  el.targetMap.addEventListener('mousedown', (ev) => {
    if (!state.targeting) return;
    drag.on = true; drag.x = ev.clientX; drag.y = ev.clientY; drag.moved = 0;
    el.targetMap.classList.add('dragging');
  });
  window.addEventListener('mouseup', () => {
    drag.on = false;
    el.targetMap.classList.remove('dragging');
  });

  el.targetMap.addEventListener('mousemove', (ev) => {
    if (!state.targeting) return;
    if (drag.on) {
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      drag.x = ev.clientX; drag.y = ev.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      targetMap.panBy(dx, dy);
      drawTargetMap();
      return;
    }
    // While a target is armed the reticle stays on it rather than following
    // the cursor, or the circle you are being asked about is not the circle
    // you can see.
    if (state.pendingNuke) return;
    const at = targetMap.worldAt(ev.clientX, ev.clientY);
    if (!at) return;
    aimAt(at.x, at.z);
    el.targetHint.textContent = targetMap.aim.allowed
      ? `${Math.round(Math.hypot(at.x - player.x, at.z - player.z))} m away`
      : 'not there: that is the memorial';
    drawTargetMap();
  });

  el.targetMap.addEventListener('click', (ev) => {
    if (!state.targeting) return;
    // A click that moved the map is a drag, not a target.
    if (drag.moved > 4) { drag.moved = 0; return; }
    const at = targetMap.worldAt(ev.clientX, ev.clientY);
    if (!at) return;
    armNuke(at.x, at.z);
    drawTargetMap();
  });

  el.confirmFire.addEventListener('click', () => releaseNuke());
  el.confirmCancel.addEventListener('click', () => {
    state.pendingNuke = null;
    el.targetConfirm.classList.add('hidden');
    el.targetHint.textContent = MAP_MODE[state.mapMode].hint;
  });

  /**
   * A warhead comes in from four hundred metres up and takes about three
   * seconds to arrive, so you get to watch it come down and hear it before it
   * lands. It refuses to be aimed at the memorial, and the circle on the map
   * goes grey rather than red when you hold the cursor over it.
   *
   * @returns {boolean} false when the target was refused
   */
  /**
   * @param {boolean} ofTheMode true when it is Rise of the Machines dropping
   *   it rather than you. The mode's own warheads are the mode, so they do
   *   not mark the run the way reaching for one in the cheat menu does.
   */
  function dropNuke(x, z, ofTheMode = false) {
    if (sanctuaryWithin(x, z, nukeRadius())) return false;
    if (!ofTheMode) {
      cheats.used = true;
      applyCheats();
    }
    const ground = world.groundHeight(x, z);
    const body = projectiles.launch('nuke', {
      x, y: ground + NUKE.drop, z,
      vx: 0, vy: -NUKE.speed, vz: 0,
      splash: {
        radius: nukeRadius(),
        // A bigger warhead is a bigger warhead: the damage and the height the
        // fireball radiates from go up with the radius rather than staying at
        // what a hundred and seventy metre one does.
        damage: NUKE.damage * Math.max(1, nukeRadius() / NUKE.radius),
        burst: NUKE.burst * Math.max(1, Math.sqrt(nukeRadius() / NUKE.radius)),
        nuke: true,
      },
    });
    audio.incoming(NUKE.fall);
    if (cheats.cinematic && state.mode === 'walk') startCinema(body, x, z);
    return true;
  }

  /**
   * Hands the camera to the warhead. The player stays exactly where they
   * were and the world keeps running underneath, slowed; nothing about this
   * is a cutaway to somewhere else.
   */
  function startCinema(body, x, z) {
    cinema.start({
      x: player.x, y: player.y + PLAYER.eye, z: player.z,
      yaw: camera.yaw, pitch: camera.pitch,
    }, body, { x, z, y: world.groundHeight(x, z) });
    state.mode = 'cinema';
    el.hud.classList.add('flying');
    el.cinemaHint.classList.remove('hidden');
    input.exitLock();
  }

  function endCinema() {
    if (state.mode !== 'cinema') return;
    cinema.stop();
    state.mode = 'walk';
    el.hud.classList.remove('flying');
    el.cinemaHint.classList.add('hidden');
    relock();
  }

  /** True when a circle of this radius would reach into a weapons free zone. */
  function sanctuaryWithin(x, z, radius) {
    for (const sanctuary of combat.sanctuaries) {
      const dx = x - sanctuary.x, dz = z - sanctuary.z;
      if (Math.hypot(dx, dz) < sanctuary.radius + radius) return true;
    }
    return false;
  }

  /**
   * Nuke rain. One warhead every few seconds, somewhere you can see but not
   * where you are standing, and never into the memorial. Because it has to
   * pick a point that is allowed, it tries a handful and gives this tick up
   * rather than looping until it finds one.
   */
  function rainTick(dt) {
    if (!cheats.nukeRain || state.mode !== 'walk') return;
    state.nukeRainTimer -= dt;
    if (state.nukeRainTimer > 0) return;
    state.nukeRainTimer = 5.5 + Math.random() * 4;
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const far = 260 + Math.random() * 520;
      const x = player.x + Math.cos(a) * far;
      const z = player.z + Math.sin(a) * far;
      if (x < world.minX + 60 || x > world.maxX - 60) continue;
      if (z < world.minZ + 60 || z > world.maxZ - 60) continue;
      if (!world.isLoaded(x, z)) continue;
      if (dropNuke(x, z)) return;
    }
  }

  // Any change at all, including the all off button and anything a test does
  // straight to the object, goes back out to the systems that read it. Without
  // this, switching a cheat off would leave it on everywhere that matters.
  cheats.onChange = () => applyCheats();
  applyCheats();

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
      (cheats.used ? 'With cheats on, so this one does not count for much. ' : '')
      + `You held out for ${formatClock(combat.elapsed)} at threat level ${combat.tier + 1}, `
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
    pickups.reset();
    gibs.clear();
    renderer.clearScars();
    // What came down stays down. Dying does not rebuild the city.
    drones.setTier(Math.max(0, combat.tier - 1));
    effects.clear();
    if (!isTouch) input.requestLock();
  });

  // The power up chips. The row is rebuilt only when the set of things you are
  // carrying changes; the seconds inside it are written every frame, which is
  // one text node per chip rather than a DOM rebuild at sixty hertz.
  const powerChips = new Map();
  function drawPowers() {
    for (const kind of ['quad', 'ultra', 'overload']) {
      const left = combat.powers[kind];
      const chip = powerChips.get(kind);
      if (left <= 0) {
        if (chip) { chip.root.remove(); powerChips.delete(kind); }
        continue;
      }
      if (!chip) {
        const root = document.createElement('div');
        root.className = kind;
        const b = document.createElement('b');
        b.textContent = PICKUP[kind].label;
        const em = document.createElement('em');
        root.append(b, em);
        el.powers.appendChild(root);
        powerChips.set(kind, { root, em, shown: -1 });
        continue;
      }
      const secs = Math.ceil(left);
      if (secs !== chip.shown) {
        chip.shown = secs;
        chip.em.textContent = `${secs}s`;
      }
      chip.root.classList.toggle('ending', left <= 3);
    }
  }

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
    pickups.reset();
    gibs.clear();
    demolition.reset();
    fires.reset();
    renderer.clearCollapses();
    renderer.clearFires();
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
  // Which game this is. Berlin is the city as it stands; Rise of the Machines
  // is the same city after it has gone, and it is picked here rather than in
  // the cheat menu because it is a mode, not a cheat: the score counts.
  const modeButtons = [...document.querySelectorAll('.diff.mode')];
  const showMode = () => {
    for (const b of modeButtons) {
      b.classList.toggle('on', (b.dataset.mode === 'machines') === machines.active);
    }
    el.modeNote.textContent = machines.active
      ? 'Warheads come down every few seconds, the sky is gone, and what walks the streets is steel with one red eye. G flame, V an EMP to stop them, then anything you like.'
      : 'A walk through the real city, with the real fight in it.';
    el.timePick.classList.toggle('hidden', !machines.active);
    applyMachineLook();
  };
  for (const b of modeButtons) {
    b.addEventListener('click', () => {
      machines.set(b.dataset.mode === 'machines');
      // Picking the mode puts the clock back on the hour it actually is,
      // unless the slider has been moved: a tab left open since the morning
      // should still start the end of the world at this afternoon.
      machines.syncClock();
      showModeTime();
      showMode();
    });
  }
  el.modeTime.addEventListener('input', () => {
    machines.setTime(parseFloat(el.modeTime.value));
    el.modeTimeLabel.textContent = timeLabel(machines.timeOfDay);
    if (machines.active) renderer.timeOfDay = machines.timeOfDay;
  });
  /** The slider and its label, from whatever the mode's time is now. */
  function showModeTime() {
    el.modeTime.value = String(machines.timeOfDay.toFixed(1));
    el.modeTimeLabel.textContent = timeLabel(machines.timeOfDay);
  }
  showModeTime();
  showMode();

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

  // The wheel. On the big map and the target map it zooms, which is what a
  // wheel is for; everywhere else it changes weapon, which is the only way to
  // reach the two that do not fit on the number row.
  window.addEventListener('wheel', (ev) => {
    if (state.targeting) return;              // the target map has its own
    if (minimap.big) {
      minimap.zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.18 : 1 / 1.18);
      ev.preventDefault();
      return;
    }
    if (state.mode !== 'walk' || photo.active) return;
    if (!el.cheats.classList.contains('hidden')) return;
    // While the pointer is locked the canvas has already handled this one and
    // the event is only here because it bubbled, so handling it again would
    // skip two weapons for every notch of the wheel.
    if (input.pointerLocked) return;
    // Sitting in a mech, the wheel goes through the mech's five rather than
    // through the thirteen in your own hands.
    if (state.inMech && state.inMech.spec.arms) {
      mechs.cycleArm(state.inMech, ev.deltaY > 0 ? 1 : -1);
      ev.preventDefault();
      return;
    }
    weapon.cycle(ev.deltaY > 0 ? 1 : -1);
    ev.preventDefault();
  }, { passive: false });

  el.btnMap.addEventListener('click', () => minimap.toggle({ x: player.x, z: player.z }));
  el.btnTravel.addEventListener('click', () => openTravel());
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
    if (code === 'Escape') {
      el.help.classList.add('hidden');
      // One step back rather than straight out: if a target is armed, Escape
      // disarms it and leaves the map up.
      if (state.targeting && state.pendingNuke) {
        state.pendingNuke = null;
        el.targetConfirm.classList.add('hidden');
        el.targetHint.textContent = MAP_MODE[state.mapMode].hint;
        return;
      }
      closeTargeting(true);
      toggleCheatMenu(false);
      return;
    }
    if (state.mode === 'cinema') {
      // Anything gets you out, but space is what the screen says.
      if (code === 'Space' || code === 'Escape' || code === 'Enter') endCinema();
      return;
    }
    if (state.targeting && (code === 'Enter' || code === 'NumpadEnter')) {
      releaseNuke();
      return;
    }
    if (state.mode === 'title') { if (code === 'Enter' || code === 'Space') beginWalk(); return; }
    if (state.mode === 'intro') { skipIntro(); return; }
    // In a mech of your own, some of these keys belong to the mech. The
    // number row chooses out of its loadout rather than out of what the pilot
    // left on the pavement, R reloads what the mech is holding, and V is the
    // view: the number keys would otherwise put a rifle into the hands of a
    // man sitting inside eight metres of armour.
    if (state.inMech && state.inMech.spec.arms && !photo.active) {
      if (code.startsWith('Digit')) {
        const n = Number(code.slice(5));
        if (n >= 1 && n <= ARMS.length) { mechs.selectArm(state.inMech, n - 1); return; }
      }
      if (code === 'KeyV') { toggleCockpit(); return; }
      if (code === 'KeyR') {
        const m = state.inMech;
        const arm = mechs.arm(m);
        if (arm && m.reloadLeft <= 0 && m.mags[m.arm] < arm.magazine) {
          m.reloadLeft = arm.reload;
          audio.reload(arm.reload);
        }
        return;
      }
    }
    switch (code) {
      case 'KeyP': togglePhoto(); break;
      case 'KeyM': minimap.toggle({ x: player.x, z: player.z }); break;
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
      case 'KeyF': toggleVehicle(); break;
      case 'F4': state.debug = !state.debug; el.debug.classList.toggle('hidden', !state.debug); break;
      case 'KeyC': toggleCheatMenu(); break;
      case 'KeyV': if (state.targeting) closeTargeting(true); else openTravel(); break;
      case 'KeyQ': weapon.select(state.lastWeapon || 'm16'); break;
      case 'KeyE': case 'ShiftRight': reflex.toggle(); break;
      // The flamethrower sits past the number row, so it has a key of its own
      // and the wheel reaches it as well. Z rather than G: G holsters, and a
      // second case for the same key in the same switch is never reached,
      // which is how this one spent a day doing nothing.
      case 'KeyZ': weapon.select('flamer'); break;
      case 'KeyB': weapon.select('incendiary'); break;
      case 'KeyX': weapon.select('emp'); break;
      case 'KeyK': weapon.select('mechkiller'); break;
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
    let scale = reflex.update(dt);
    // Two other things can slow the world down: a cinematic warhead for as
    // long as it is running, and the slow motion switch for a few seconds
    // after anything large goes off. Whichever is slowest wins, so they do
    // not multiply into a standstill.
    if (state.blastSlow > 0) {
      state.blastSlow = Math.max(0, state.blastSlow - dt);
      scale = Math.min(scale, 0.18);
    }
    if (state.mode === 'cinema') {
      scale = Math.min(scale, cinema.timeScale(performance.now() / 1000));
    }
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

    // While the camera is off following a warhead the city keeps running,
    // because the whole point of the shot is watching what happens to it.
    // The player does not: they are standing where you left them, and the
    // controls are not theirs for the moment.
    if (state.mode === 'cinema') {
      const eye = { x: player.x, y: player.y + PLAYER.eye, z: player.z, alive: combat.health > 0 };
      combat.update(worldDt);
      projectiles.update(worldDt);
      gibs.update(worldDt);
      demolition.update(worldDt);
      fires.update(worldDt, player);
      fireWalls.update(worldDt);
      updateBurning(worldDt);
      ion.update(worldDt);
      drones.update(worldDt, eye, state.time);
      soldiers.update(worldDt, eye, state.time);
      jets.update(worldDt, { ...eye, vx: 0, vz: 0 }, state.time);
      audio.setTimeScale(scale);
      return;
    }

    if (state.mode !== 'walk') return;

    state.prev.x = player.x; state.prev.y = player.y; state.prev.z = player.z;

    // Piloting. Same idea as driving, except that what you are in walks: the
    // torso goes where you look at once, the legs chase the torso, and you
    // are wherever the cockpit is.
    if (state.inMech) {
      const m = state.inMech;
      const controls = {
        forward: photo.active ? 0 : input.moveZ,
        strafe: photo.active ? 0 : input.moveX,
        yaw: camera.yaw,
        pitch: camera.pitch,
        fire: input.fire && !photo.active,
        rockets: input.secondary && !photo.active,
        dash: input.run && !photo.active,
        jump: input.jumpHeld && !photo.active,
      };
      mechs.update(worldDt, { x: player.x, y: player.y, z: player.z }, controls);
      // A torso only turns so far up and down, and the view is held to the
      // same limit: looking past where the guns can point would mean a
      // crosshair that no longer says where the shot goes.
      camera.pitch = clamp(camera.pitch, -MECH_PITCH, MECH_PITCH);
      player.teleport(m.x, m.z);
      state.curr.x = m.x; state.curr.y = m.y; state.curr.z = m.z;
      state.prev.x = m.x; state.prev.y = m.y; state.prev.z = m.z;
      player.vx = 0; player.vz = 0;
      landmarks.update(m.x, m.z, dt, player.distanceWalked);
      runCombatWorld(dt, worldDt, scale);
      return;
    }

    // Driving. The controls go to the vehicle instead of to your legs, and
    // you go wherever it goes.
    if (state.inVehicle) {
      const v = state.inVehicle;
      const air = v.spec.kind === 'air';
      const controls = {
        throttle: photo.active ? 0 : input.moveZ,
        steer: photo.active ? 0 : (air ? input.moveX : -input.moveX),
        // In the air the mouse flies it: looking up pitches up and the roll
        // comes off the same stick as the yaw. The sign here was inverted,
        // which on a helicopter only changed which way it leaned, and on a
        // fighter meant that pulling back on the stick put the nose into the
        // road.
        pitch: air && !photo.active ? clamp(camera.pitch * 1.6, -1, 1) : 0,
        roll: air && !photo.active ? clamp(input.moveX * -1, -1, 1) : 0,
        lift: air && !photo.active ? (input.run ? 1 : (input.jumpHeld ? 1 : (input.secondary ? -1 : 0))) : 0,
        brake: !air && input.run,
        fire: input.fire && !photo.active,
        secondary: false,
      };
      // The view turns with the hull. Steering a vehicle turns the thing you
      // are sitting in, and a camera that ignored that would leave you
      // driving sideways across your own screen within one corner. Free look
      // still works: this adds the hull's own turn to whatever you are doing
      // with the mouse rather than taking the mouse away.
      const hullWas = v.yaw;
      vehicles.update(selfDt, controls, state.time);
      if (!air) camera.yaw += v.yaw - hullWas;
      // Dead or alive, you are where it is.
      player.teleport(v.x, v.z);
      state.curr.x = v.x; state.curr.y = v.y; state.curr.z = v.z;
      state.prev.x = v.x; state.prev.y = v.y; state.prev.z = v.z;
      player.vx = 0; player.vz = 0;
      landmarks.update(v.x, v.z, dt, player.distanceWalked);
      runCombatWorld(dt, worldDt, scale);
      return;
    }

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
    // The cheat menu and the target map are both modal: the mouse belongs to
    // them, so nothing fires while either is up.
    const paused = state.targeting || !el.cheats.classList.contains('hidden');
    const holstered = state.holstered || photo.active || state.inSanctuary
      || combat.health <= 0 || paused;
    weapon.setHolstered(holstered);
    // A flamethrower has nothing to aim down. Its second trigger throws a
    // wall of fire instead, once per press rather than while it is held.
    const hasAlt = !!weapon.spec.wall;
    weapon.aiming = input.secondary && !holstered && !hasAlt;

    const dir = {
      x: camera.forward[0], y: camera.forward[1], z: camera.forward[2],
    };
    if (hasAlt && input.secondary && !state.altWasDown && !holstered
        && !photo.active && combat.health > 0 && !paused) {
      weapon.altFire(eye, dir);
    }
    state.altWasDown = input.secondary;
    const wantFire = input.fire && !photo.active && combat.health > 0 && !paused;
    weapon.update(dt, wantFire, eye, dir);
    // Recoil composes with looking around here, in one place. It is carried as
    // an offset: whatever the last frame added is taken back before this
    // frame's is applied, so when the spring settles the view is exactly where
    // you were pointing it. Only the small permanent share each weapon keeps
    // stays behind, which is what makes a burst walk without stranding your aim
    // in the sky the way the first version did.
    applyRecoil();

    runCombatWorld(dt, worldDt, scale);
  }

  /**
   * Everything in the city that keeps happening whether you are walking,
   * driving or being carried along by a cinematic. The one thing it does not
   * do is move you: that belongs to whoever is at the controls.
   */
  function runCombatWorld(dt, worldDt, scale) {
    const eye = {
      x: player.x, y: player.y + PLAYER.eye, z: player.z, alive: combat.health > 0,
    };
    // The world runs on the slowed clock. The weapon does not, which is
    // why a magazine goes further in here than it does outside.
    combat.update(worldDt);
    // What you are carrying scales what the weapon does. Read every step rather
    // than pushed on pickup, so a power running out takes effect on its own.
    weapon.damageScale = combat.damageScale;
    weapon.rateScale = combat.rateScale;
    weapon.reloadScale = combat.reloadScale;
    // The pads turn on the world clock but are taken on your own position, so
    // walking over one in the slow still picks it up.
    pickups.update(worldDt, { x: player.x, y: player.y, z: player.z });
    projectiles.update(worldDt);
    gibs.update(worldDt);
    demolition.update(worldDt);
    fires.update(worldDt, player);
    fireWalls.update(worldDt);
    updateBurning(worldDt);
    ion.update(worldDt);
    // The ones nobody is in still sit there and still burn.
    if (!state.inVehicle) vehicles.update(worldDt, null, state.time);
    // And the ones hunting you keep walking whether or not you are in one.
    if (!state.inMech) {
      mechs.update(worldDt, { x: player.x, y: player.y, z: player.z }, null);
    }
    rainTick(worldDt);
    titanTick(worldDt);
    machinesTick(worldDt);
    drones.update(worldDt, eye, state.time);
    soldiers.update(worldDt, eye, state.time);
    jets.update(worldDt, { ...eye, vx: player.vx, vz: player.vz }, state.time);

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
    } else if (state.mode === 'cinema') {
      const p = cinema.sample(wall);
      if (p) state.dronePose = p;
    } else if (state.mode === 'travel') {
      const p = travel.sample(wall);
      state.dronePose = p;
      el.hud.classList.add('flying');
      // Nobody is put down on ground that has not arrived. The flight holds
      // its last frame, a few hundred metres up, until the district is in.
      if (p.finished && state.travelTo && !world.isLoaded(state.travelTo.x, state.travelTo.z)) {
        el.district.textContent = `landing in ${world.nameAt(state.travelTo.x, state.travelTo.z) || 'Berlin'}`;
        el.district.classList.add('loading');
      } else if (p.finished) {
        const at = state.travelTo;
        player.teleport(at.x, at.z);
        state.prev = { x: at.x, y: player.y, z: at.z };
        state.curr = { x: at.x, y: player.y, z: at.z };
        camera.yaw = p.yaw;
        camera.pitch = p.pitch;
        state.mode = 'walk';
        el.hud.classList.remove('flying');
        travel.cancel();
        state.travelTo = null;
        if (!isTouch && state.lockWanted) relock();
      }
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
    } else if (state.mode === 'title' || state.mode === 'intro'
      || state.mode === 'landing' || state.mode === 'travel'
      || state.mode === 'cinema') {
      const p = state.dronePose || intro.sample(performance.now() / 1000);
      camera.position[0] = p.x;
      camera.position[1] = p.y;
      camera.position[2] = p.z;
      camera.yaw = p.yaw;
      camera.pitch = p.pitch;
    } else if (state.inMech && state.cockpit && state.inMech.spec.cockpit) {
      // Out of the canopy. The head is a point in the body's own coordinates,
      // so it turns with the torso and rides the hull: the camera is carried
      // by the machine rather than hung in the air near it.
      //
      // The bob is the whole of why this view is worth having. Eight metres
      // of walking gun platform puts your head through a small circle twice a
      // stride, and the same `walk` counter the legs are drawn from drives it,
      // so what you feel is the step you can see. It is deliberately small:
      // an amplitude that reads as weight in a still frame reads as seasick
      // in motion.
      const m = state.inMech;
      const ms = m.spec;
      const a = mechs.aim(m);
      // How far out in front of the eye the head sits. The head is outside
      // the hull, which is the point of it, and a mech standing with its
      // shoulder against a frontage turns that head into the frontage: the
      // view went solid every time you looked at the building you were
      // stood next to. So the city gets a say, the same way it does over
      // the shoulder. Pulled all the way in the camera is back inside the
      // torso, which draws as nothing at all, and the shot still goes where
      // the crosshair is, because every one of these points is on the aim
      // line rather than beside it.
      const eye = { x: m.x, y: m.y + ms.eye, z: m.z };
      let lead = ms.cockpit;
      const blocked = world.raycast(eye.x, eye.y, eye.z, a.x, a.y, a.z, lead + 0.4);
      if (blocked) lead = Math.max(0, blocked.t - 0.4);
      const stride = Math.sin(m.walk * 2) * (m.onGround ? 1 : 0.2);
      const sway = Math.cos(m.walk) * (m.onGround ? 1 : 0.2);
      const moving = Math.min(1, m.speed / ms.walk);
      camera.position[0] = eye.x + a.x * lead + Math.cos(m.torso) * sway * 0.10 * moving;
      camera.position[1] = eye.y + a.y * lead + stride * 0.16 * moving;
      camera.position[2] = eye.z + a.z * lead - Math.sin(m.torso) * sway * 0.10 * moving;
    } else if (state.inMech) {
      // Or from over the shoulder: behind and above, with the look you are
      // holding, pulled in when a wall gets between. The same camera a tank
      // gets, from higher up, because a mech is also a thing worth looking at.
      const m = state.inMech;
      const ms = m.spec;
      camera.position[0] = m.x - camera.forward[0] * ms.chase;
      camera.position[1] = m.y + ms.chaseUp - camera.forward[1] * ms.chase;
      camera.position[2] = m.z - camera.forward[2] * ms.chase;
      const toCam = {
        x: camera.position[0] - m.x,
        y: camera.position[1] - (m.y + ms.chaseUp),
        z: camera.position[2] - m.z,
      };
      const l = Math.hypot(toCam.x, toCam.y, toCam.z) || 1;
      const blocked = world.raycast(m.x, m.y + ms.chaseUp, m.z,
        toCam.x / l, toCam.y / l, toCam.z / l, l);
      if (blocked) {
        const t = Math.max(2.5, blocked.t - 0.8);
        camera.position[0] = m.x + (toCam.x / l) * t;
        camera.position[1] = m.y + ms.chaseUp + (toCam.y / l) * t;
        camera.position[2] = m.z + (toCam.z / l) * t;
      }
      const floor = world.groundHeight(camera.position[0], camera.position[2]) + 1.2;
      if (camera.position[1] < floor) camera.position[1] = floor;
    } else if (state.inVehicle) {
      // A chase camera, hung behind and above whatever you are in, with the
      // look you are holding. Third person because the inside of a tank is
      // not a thing this project is going to model.
      const v = state.inVehicle;
      const s = v.spec;
      const back = s.chase;
      camera.position[0] = v.x - camera.forward[0] * back;
      camera.position[1] = v.y + s.chaseUp - camera.forward[1] * back;
      camera.position[2] = v.z - camera.forward[2] * back;
      // Never through a wall: pull in until the shot is clear.
      const toCam = {
        x: camera.position[0] - v.x, y: camera.position[1] - (v.y + s.chaseUp),
        z: camera.position[2] - v.z,
      };
      const l = Math.hypot(toCam.x, toCam.y, toCam.z) || 1;
      const blocked = world.raycast(v.x, v.y + s.chaseUp, v.z,
        toCam.x / l, toCam.y / l, toCam.z / l, l);
      if (blocked) {
        const t = Math.max(1.5, blocked.t - 0.6);
        camera.position[0] = v.x + (toCam.x / l) * t;
        camera.position[1] = v.y + s.chaseUp + (toCam.y / l) * t;
        camera.position[2] = v.z + (toCam.z / l) * t;
      }
      const floor = world.groundHeight(camera.position[0], camera.position[2]) + 0.9;
      if (camera.position[1] < floor) camera.position[1] = floor;
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
    // The beams are redrawn every frame rather than left to decay, because
    // unlike a spark a beam is a thing that is there until it is not.
    if (ion.firing) {
      for (const b of ion.beams) {
        const g = world.groundHeight(b.x, b.z);
        const hot = b.main ? 1 : 0;
        effects.beam(b.x, g, b.z, ION.height, b.radius,
          0.55 + hot * 0.45, 0.85 + hot * 0.15, 1.0, b.x * 0.37 + b.z * 0.11);
        // A second, wider and dimmer, so the column has an atmosphere round
        // it rather than an edge.
        effects.beam(b.x, g, b.z, ION.height * 0.75, b.radius * 2.6,
          0.10 + hot * 0.2, 0.22 + hot * 0.2, 0.34, b.x * 0.19);
        // And where it is standing.
        if (Math.random() < 0.6) {
          effects.flash(b.x, g + 1.5, b.z, b.radius * (b.main ? 2.6 : 1.5),
            0.6, 0.9, 1.0, 0.1);
        }
      }
    }
    // The muzzle flash fades over about seventy milliseconds, but the decay is
    // capped per frame so that a long frame cannot swallow it whole: a flash
    // that never renders at all is worse than one that lingers on a hitch.
    state.muzzle = Math.max(0, state.muzzle - Math.min(elapsed, 1 / 45) * 14);
    // The whiteout from a warhead. Squared on the way out, so it holds for a
    // moment at full and then lets go quickly rather than cross fading. The
    // per frame cap the muzzle flash uses is deliberately not applied here:
    // that cap guarantees a flash is seen at all, and applying it to a full
    // screen whiteout means a machine running at four frames a second sits in
    // white for fifteen seconds. This one decays on the real clock.
    state.flash = Math.max(0, state.flash - elapsed * 1.3);
    // Your own muzzle, seen from inside the canopy. A forty millimetre shell
    // leaving an arm two metres from your head lights the glass up, and from
    // over the shoulder it is the city that lights up instead, so this only
    // counts when you are sitting in it.
    if (state.mechFlash > 0) {
      if (state.inMech && state.cockpit) {
        state.flash = Math.min(0.5, state.flash + state.mechFlash * 0.16);
      }
      state.mechFlash = Math.max(0, state.mechFlash - elapsed * 6);
    }
    renderer.flash = state.flash * state.flash;
    if (effects.shake > 0.001) {
      const k = effects.shake * effects.shake * 0.09;
      const t = state.time * 47;
      camera.position[0] += Math.sin(t * 1.7) * k;
      camera.position[1] += Math.sin(t * 2.3 + 1.1) * k;
      camera.position[2] += Math.sin(t * 1.3 + 2.7) * k;
    }

    camera.update(w / Math.max(1, h));

    // --- the weapon in your hands ---
    if (state.mode === 'walk' && !photo.active && !state.inVehicle && !state.inMech) {
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
      renderer.actors.updatePickups(pickups.live, camera.position);
      renderer.actors.updateGibs(gibs.active);
      renderer.actors.updateVehicles(vehicles.active);
      renderer.actors.updateMechs(mechs.active);
      renderer.drawActors = true;
    } else {
      renderer.viewmodel = null;
      // In the air on the way somewhere the city is still the city: the
      // drones are still up, the pads still glow and the rubble is still
      // where it fell. Only the weapon goes away.
      const live = state.mode === 'walk' || state.mode === 'travel'
        || state.mode === 'cinema';
      renderer.actors.updateDrones(live ? drones.active : []);
      renderer.actors.updateSoldiers(live ? soldiers.active : []);
      renderer.actors.updateJets(live ? jets.active : []);
      renderer.actors.updateProjectiles(live ? projectiles.active : []);
      renderer.actors.updateSparks(live ? effects.list : []);
      renderer.actors.updatePickups(live ? pickups.live : [], camera.position);
      renderer.actors.updateGibs(live ? gibs.active : []);
      renderer.actors.updateVehicles(live ? vehicles.active : []);
      renderer.actors.updateMechs(live ? mechs.active : []);
      renderer.drawActors = live;
    }

    // The target map's zoom runs on the wall clock, here rather than in the
    // simulation, because the simulation is paused while the map is up.
    if (state.mapPull) stepMapPull(loop.stats.intervalMs / 1000);

    // Keep the city around whoever is being followed: the district they are
    // in, the ones within reach, and nothing beyond the drop distance. This
    // starts fetches and returns at once; tiles appear as the bytes land.
    streamCity(camera.position[0], camera.position[2]);
    checkBoundary();
    tiles.updateResidency(camera.position[0], camera.position[2], loop.frame);
    // Dynamic resolution, fed the real cost of the last frame. When it decides
    // to move, the scene target is rebuilt at the new size; the page and the
    // interface never change.
    renderer.setCollapses(demolition.sites);
    renderer.setFires(fires.sites);
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
      drawPowers();
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
      // What you are standing next to. Vehicles were always here and F always
      // worked, but nothing on the screen said so, which is the same thing as
      // them not working.
      const near = (state.inVehicle || state.inMech) ? null
        : (mechs.nearest(player.x, player.z, 9) || vehicles.nearest(player.x, player.z, 7));
      el.rideHint.classList.toggle('hidden', !near);
      if (near) el.rideHintName.textContent = near.spec.name;
      rideHud();
      mechHud();
    }

    if (state.mode === 'walk' || state.mode === 'landing' || state.mode === 'travel'
      || state.mode === 'cinema') {
      minimap.draw(camera.position[0], camera.position[2], camera.yaw, landmarks.found,
        state.mode === 'title' ? null : pickups.live,
        vehicles.active.filter((v) => v.alive && !v.occupied && v.health > 0));
      el.found.textContent = String(landmarks.foundInGoal);
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
    world, renderer, tiles, camera, player, loop, state, landmarks, audio, input, minimap,
    combat, drones, weapon, effects, projectiles, reflex, jets, pickups, cheats, gibs,
    demolition, demoSpec: DEMO, demoBite: bite, demoCrater: craterAt, travelSpec: TRAVEL,
    fires,
    explode(x, y, z, splash, body) { return explode(x, y, z, splash, body || null); },
    pickupSpecs: PICKUP,
    nukeSpec: NUKE,
    targetMap,
    dropNuke(x, z) { return dropNuke(x, z); },
    openTargeting() { openTargeting(); },
    openTravel() { openTravel(); },
    cinema, cinemaSpec: CINEMA,
    ion, ionSpec: ION, ionState: ION_STATE,
    vehicles, vehicleSpec: VEHICLE,
    mechs, mechSpec: MECH, mechArms: ARMS,
    selectArm(i) { return state.inMech ? mechs.selectArm(state.inMech, i) : -1; },
    cycleArm(step) { return state.inMech ? mechs.cycleArm(state.inMech, step) : -1; },
    toggleCockpit() { toggleCockpit(); return state.cockpit; },
    spawnMech(type, away) { return spawnMech(type, away); },
    enterMech(m) { return enterMech(m); },
    leaveMech() { return leaveMech(false); },
    toggleVehicle() { toggleVehicle(); },
    dropRide(type) { return dropRide(type); },
    parkVehicles() { return parkVehicles(); },
    endCinema() { endCinema(); },
    travel,
    beginTravel(x, z) { return beginTravel(x, z); },
    armNuke(x, z) { return armNuke(x, z); },
    releaseNuke() { return releaseNuke(); },
    closeTargeting() { closeTargeting(true); },
    /**
     * Finish the map's zoom now rather than over half a second. For the
     * tests, which measure the scale of the map and would otherwise be
     * reading it mid flight.
     */
    settleMap() {
      if (!state.mapPull) return false;
      const pull = state.mapPull;
      targetMap.zoom = pull.to;
      if (pull.back) targetMap.centre = { x: player.x, z: player.z };
      state.mapPull = null;
      drawTargetMap();
      return true;
    },
    cheatMenu(on) { toggleCheatMenu(on); },
    setCheat(id, on) { const ok = cheats.set(id, on); applyCheats(); return ok; },
    cheatAction(id) { runCheatAction(id); },
    spawnWave(kind, count) { return spawnWave(kind, count); },
    rainTick(dt) { rainTick(dt); },
    fixedForTest(dt) { fixed(dt); },
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
    /** Drops a pad right under you, for the tests and for nothing else. */
    dropPickup(kind, dx = 0, dz = 0) {
      const x = player.x + dx, z = player.z + dz;
      const pad = { kind, x, y: world.groundHeight(x, z) + 0.9, z,
        ready: true, timer: 0, bob: 0, spin: 0 };
      pickups.pads.push(pad);
      return pad;
    },
    // Holding the trigger, for whatever pours rather than fires. The input
    // layer sets the same flag when a mouse button is down.
    holdFire(on) { input.fire = !!on; },
    fireWalls,
    burningGround: burning,
    machines, machineSpec: MACHINES,
    // The same way one arrives in the mode: with the warhead rolled for it,
    // so a check sees what a player would see.
    makeMachine(s, killer = rollMechKiller()) { return makeMachine(s, killer); },
    mechKillerRoll() { return rollMechKiller(); },
    machinesTick(dt) { machinesTick(dt); },
    machineMuzzle(s) { return machineMuzzle(s); },
    setMode(name) { machines.set(name === 'machines'); applyMachineLook(); return machines.active; },
    crossInto(x, z) { return crossInto(x, z); },
    crossingShown() { return !el.crossing.classList.contains('hidden'); },
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
    altFire() {
      return weapon.altFire(
        { x: player.x, y: player.y + PLAYER.eye, z: player.z },
        { x: camera.forward[0], y: camera.forward[1], z: camera.forward[2] },
      );
    },
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
