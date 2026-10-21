// SPREE|FALL. Entry point: load the world, build the renderer, run the loop.

import { createContext } from './engine/gl.js';
import { World, tileMesh } from './engine/world.js';
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
import { ARROW_HEADS } from './game/arsenal.js';
import { Combat, COMBAT, DIFFICULTY } from './game/combat.js';
import { Effects } from './game/effects.js';
import { Projectiles } from './game/projectiles.js';
import { Soldiers } from './game/soldiers.js';
import { Reflex, REFLEX } from './game/reflex.js';
import { Jets } from './game/jets.js';
import { Pickups, PICKUP } from './game/pickups.js';
import { Cheats, SWITCHES, GORE, ACTIONS, SPAWNS, RIDES, SETTINGS } from './game/cheats.js';
import { CHASSIS } from './game/chassis.js';
import { Ultra, ULTRA, ULTRA_STATE, VOID_STORM } from './game/ultra.js';
import { Gibs } from './game/gibs.js';
import { Cars } from './game/cars.js';
import { Trains, TRAIN } from './game/trains.js';
import { bakeCrush } from './game/bake.js';
import { fineGround, fineWalls, holeInWall } from './game/remesh.js';
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
import { HealthBars } from './ui/healthbars.js';
import { CompassBar, bearing, distanceLabel } from './ui/compassbar.js';
import { Campaign, OPS, SITE } from './game/campaign.js';
import { Tactics, TACTICS, campSpot } from './game/tactics.js';
import { DEMON, GAZER, DEMON_LEVEL, makeDemon, makeGazer } from './game/demons.js';
import { Slayer, SLAYER } from './game/slayer.js';
import { PLAYER, SPAWN, SURFACE, VERTEX_STRIDE, POS_SCALE, FACADE_FLAG } from './shared/constants.js';

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('view'), loading: $('loading'), loadbar: $('loadbar'), loadnote: $('loadnote'),
  title: $('title'), play: $('playbtn'), hud: $('hud'), minimap: $('minimap'),
  compass: $('compasslabel'), cards: $('cardhost'), toast: $('toast'), overkill: $('overkill'), debug: $('debug'),
  found: $('found'), total: $('total'), district: $('district'), photo: $('photo'), tod: $('tod'), doy: $('doy'),
  todLabel: $('todlabel'), doyLabel: $('doylabel'), shoot: $('shoot'), copylink: $('copylink'),
  photoClose: $('photoclose'), help: $('helppanel'), helpClose: $('helpclose'),
  completion: $('completion'), completionText: $('completiontext'), completionClose: $('completionclose'),
  opsEnd: $('opsend'), opsEndTitle: $('opsendtitle'), opsEndText: $('opsendtext'), opsEndStats: $('opsendstats'),
  opsEndAgain: $('opsendagain'), opsEndMenu: $('opsendmenu'),
  btnMap: $('btnmap'), btnPhoto: $('btnphoto'), btnSound: $('btnsound'), btnHelp: $('btnhelp'),
  mapTools: $('maptools'), mapIn: $('mapin'), mapOut: $('mapout'),
  mapFit: $('mapfit'), mapHere: $('maphere'), mapZoom: $('mapzoom'),
  mapUnmark: $('mapunmark'), compassBar: $('compassbar'),
  btnTravel: $('btntravel'),
  crosshair: $('crosshair'), gunmark: $('gunmark'), blastCharge: $('blastcharge'), hitmarker: $('hitmarker'), damage: $('damage'),
  streetName: $('streetname'),
  combat: $('combat'), healthbar: $('healthbar'), healthnum: $('healthnum'),
  ammonum: $('ammonum'), reservenum: $('reservenum'), reloadhint: $('reloadhint'),
  shieldbar: $('shieldbar'), shieldnum: $('shieldnum'), shieldflash: $('shieldflash'),
  reflexbar: $('reflexbar'), lockon: $('lockon'), locktext: $('locktext'),
  diffnote: $('diffnote'),
  weaponname: $('weaponname'),
  tiernum: $('tiernum'), contactnum: $('contactnum'), scorenum: $('scorenum'),
  killfeed: $('killfeed'), powers: $('powers'),
  buildInfo: $('buildinfo'),
  cheats: $('cheats'), cheatActions: $('cheatactions'), cheatSwitches: $('cheatswitches'),
  cheatValues: $('cheatvalues'),
  crossing: $('crossing'), crossName: $('crossname'), crossNote: $('crossnote'),
  crossFill: $('crossfill'), crossHint: $('crosshint'),
  crossSightLine: $('crosssightline'), crossSight: $('crosssight'),
  modeNote: $('modenote'), timePick: $('timepick'),
  opsSetup: $('opssetup'), opsStart: $('opsstart'), opsCount: $('opscount'), opsCountNum: $('opscountnum'),
  opsCountLabel: $('opscountlabel'), opsQuiet: $('opsquiet'), opsBosses: $('opsbosses'),
  opsProgress: $('opsprogress'), opsWipe: $('opswipe'),
  bossbar: $('bossbar'), bossName: $('bossname'), bossFill: $('bossfill'),
  ops: $('ops'), opsTitle: $('opstitle'), opsLine: $('opsline'), opsAlert: $('opsalert'),
  opsPanel: $('opspanel'), opsPanelTitle: $('opspaneltitle'), opsPanelLine: $('opspanelline'),
  opsList: $('opslist'), opsReset: $('opsreset'), opsHarder: $('opsharder'), opsClose: $('opsclose'),
  modeTime: $('modetime'), modeTimeLabel: $('modetimelabel'),
  cheatSpawns: $('cheatspawns'), cheatRides: $('cheatrides'),
  cheatMine: $('cheatmine'), cheatFoe: $('cheatfoe'),
  vehiclePanel: $('vehicle'), vehicleName: $('vehiclename'), vehicleKeys: $('vehiclekeys'),
  vehicleHull: $('vehiclehull'), vehicleSpeed: $('vehiclespeed'),
  vehicleSpeedUnit: $('vehiclespeedunit'),
  vehicleAltStat: $('vehiclealtstat'), vehicleAlt: $('vehiclealt'),
  vehicleGun: $('vehiclegun'), vehicleGunLabel: $('vehiclegunlabel'),
  vehicleRockStat: $('vehiclerockstat'), vehicleRock: $('vehiclerock'),
  vehicleDashStat: $('vehicledashstat'), vehicleDash: $('vehicledash'),
  vehicleWarn: $('vehiclewarn'),
  rideHint: $('ridehint'), rideHintName: $('ridehintname'), scope: $('scope'),
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
  ultraPanel: $('ultrapanel'),
  down: $('down'), downText: $('downtext'), downBtn: $('downbtn'),
  touchui: $('touchui'), stick: $('stick'), knob: $('stickknob'),
  btnJump: $('btnjump'), btnRun: $('btnrun'), source: $('datasource'),
  attribution: $('attribution'), controlhint: $('controlhint'),
};

const DEG = Math.PI / 180;
// The colour a warhead washes the frame to, and the one a mech's reactor does.
const WHITE_FLASH = [1.0, 0.985, 0.94];
const FUSION_FLASH = [0.55, 1.0, 0.92];
// A mech carries a fusion reactor, and when the machine round it is killed the
// containment goes after it: a few seconds of the reactor running away, which
// you can see and hear, then a small fusion blast. Small for a weapon, which
// is a fiftieth of a warhead's radius cubed; very large for a street. Your
// own goes longer, so that being blown clear of it means something.
const FUSION = {
  fuse: 2.6, fuseOwn: 5.0,
  splash: { radius: 46, damage: 1100, burst: 7, fusion: true },
};

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
  // the city's landmarks when they were built: the cards and the memorial's
  // force field. Both are taken again whenever the city changes shape, so the
  // memorial is still shielded after Mitte has been dropped and reloaded.
  const placeDomes = () => {
    renderer.field.domes = combat.sanctuaries.map((f) => ({
      x: f.x, y: world.groundHeight(f.x, f.z), z: f.z, radius: f.radius,
    }));
  };
  // The ground under the field is never dug, which the world asks about
  // every time it is asked how high the ground is.
  // Trees, fires and the bytes a ruin is baked into keep to the field whether
  // it is open or not; craters ask whether it is open as well.
  world.shielded = (x, z) => combat.inField(x, z);
  world.fieldOpen = false;
  world.onManifest = (manifest) => {
    landmarks.refresh(manifest);
    combat.refreshSanctuaries(manifest);
    placeDomes();
  };
  placeDomes();
  // The field keeps the memorial whole; it does not keep anybody out of it.
  // Nothing below is told about it except what could damage the place.
  const shielded = (x, y, z) => combat.isShielded(x, y, z);
  // Nor is it burnt: a scorch mark that would land under the field is not
  // put down at all.
  const addScar = renderer.addScar.bind(renderer);
  renderer.addScar = (x, y, z, ...rest) => (shielded(x, y, z) ? undefined : addScar(x, y, z, ...rest));
  const drones = new Drones(world);
  // Filled in by the soldier layer below, and referenced by the blast handler
  // before it exists, which is why it is a binding rather than a constant.
  let soldiers = null;   // built below, once combat exists to ask about zones
  const projectiles = new Projectiles(world, (x, y, z, splash, body) => explode(x, y, z, splash, body));
  const weapon = new Weapon(world, drones, { projectiles });
  const effects = new Effects();
  const reflex = new Reflex();
  reflex.drainScale = combat.rules.reflexDrain;
  soldiers = new Soldiers(world);
  const jets = new Jets(world);
  jets.accuracyScale = combat.rules.enemyAccuracy;
  const pickups = new Pickups(world);
  const cheats = new Cheats();
  const gibs = new Gibs(world);
  const cars = new Cars(world);
  const trains = new Trains(world);
  const demolition = new Demolition(world, shielded);
  demolition.inField = (x, z) => combat.inField(x, z);
  // A finished site that reaches into the field while it is open is not
  // baked yet: baked, what it did to the memorial could not be taken back.
  demolition.holdBake = (site) => combat.fieldOpen && reachesField(site);
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

  // A crater needs vertices inside it to move, and the ground is a quad grid
  // at 12.5 m in the middle of town. Before anything is displaced the ground
  // around the hole is cut down to three metres an edge, which is finer than
  // the collision field it has to agree with, and the tiles that changed go
  // back to the card. The worked area is wider than the crater's own reach so
  // that the join between cut and uncut ground sits where nothing moves.
  //
  // How fine depends on the hole. The collision is the bowl itself, so the
  // picture has to be close to it everywhere, and a flat piece across a
  // curved bowl is furthest out in the middle, by about an eighth of its
  // edge squared times the curvature there. Keeping that under fifteen
  // centimetres is an edge of a metre in a rocket's hole and three in a
  // warhead's; three everywhere left the middle of a small crater a metre
  // shallower in the picture than underfoot, which is standing inside the
  // ground and looking out of the bottom of the map.
  demolition.onCrater = (site) => {
    const reach = site.craterRadius * DEMO.rimOut + 6;
    const edge = Math.max(0.7, Math.min(3.0,
      site.craterRadius * Math.sqrt(0.1 / Math.max(0.05, site.depth))));
    const changed = fineGround(world, site.x, site.z, reach, edge);
    if (changed.length) tiles.refresh(changed);
  };

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
      // Cut the same way it was the first time, so the ruin replayed is
      // the ruin that was left.
      refineSite({ ...scar });
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
  const fireWalls = new FireWalls(world, shielded);
  const machines = new Machines();
  const ion = new Ion(world);
  const ultra = new Ultra(world);
  const healthBars = new HealthBars(document.getElementById('healthbars'));
  const compassBar = new CompassBar(el.compassBar);
  // Operations: the campaign book that Tactics and Slayer keep, and the part
  // of Tactics that runs, which mans the camps near you out of the soldiers.
  const campaign = new Campaign();
  const tactics = new Tactics(campaign, world, soldiers);
  const storm = new Ultra(world, null, VOID_STORM);
  const vehicles = new Vehicles(world);
  const mechs = new Mechs(world);
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
    targeting: false,
    // Just a Walk: nothing is sent after you. What the cheat menu brings out
    // by hand is still real, and still fights; it simply does not come back
    // once it is dead. Remembered between visits, because a mode is a choice
    // about what you came for rather than a setting.
    peaceful: (() => {
      try { return localStorage.getItem('spreefall.walk') === '1'; } catch { return false; }
    })(),
    blastSlow: 0,
    // While a Stinger is running down what it locked onto.
    airSlow: 0,
    // Seconds of slow motion left over a kill that emptied the street. Kept
    // apart from blastSlow because they are different switches and either
    // may be on without the other.
    killSlow: 0,
    // The overkill setting's beat: half a second of nearly nothing moving.
    goreStop: 0,
    // And how long before another one may do it again.
    killRest: 0,
    mapMode: 'nuke',
    pendingNuke: null,
    travelTo: null,
    lockWanted: false,
    nukeRainTimer: 4,
    flash: 0,
    flashTint: null,
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
    // Which district you are standing in, so that walking into another one is
    // something the game notices. It used to be noticed by the loading card,
    // which is no longer in the way.
    districtIn: null,
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
      // Everybody within earshot who is not in this fight gets out of it.
      soldiers.scare(player.x, player.z, 70);
      // And a camp guard within earshot comes to see. A suppressed weapon
      // carries a few metres; everything else carries a long way.
      if (tactics.enabled) soldiers.hear(player.x, player.z, spec.noise ?? TACTICS.noise.shot);
    }
    if (tactics.enabled && shot.end && shot.from) {
      tactics.shotRadio(shot.from, shot.end, spec.damage || 20);
      tactics.shotBox(shot.from, shot.end, spec.damage || 20);
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
        // And if what it went into was a parked car, the car has an opinion
        // about it. Two magazines or one rocket and it goes up.
        hitCar(shot.end.x, shot.end.y, shot.end.z, spec.damage || 12);
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
    // Heard a great deal further than a rifle, and run from accordingly.
    soldiers.scare(x, z, Math.max(90, splash.radius * 3));
    if (tactics.enabled) {
      soldiers.hear(x, z, TACTICS.noise.explosion);
      tactics.hitRadio(x, y, z, splash.damage || 50, splash.radius * 0.8 + 1);
      tactics.hitBox(x, y, z, splash.damage || 50, splash.radius * 0.8 + 1);
    }
    strikeField(x, y, z, splash.radius);
    if (splash.fusion) {
      // A mech's reactor: the warhead's code path at a fiftieth of the
      // volume, in blue and neon green, and a flash that washes the frame
      // to cyan rather than to white.
      audio.nuke(dist);
      audio.ultraCharge(0.35);
      effects.fusion(x, y, z, splash.radius);
      state.flash = Math.max(state.flash, Math.min(0.95, 0.12 + 1.1 * Math.exp(-dist / 160)));
      state.flashTint = FUSION_FLASH;
      if (cheats.slowBlast) state.blastSlow = 1.6;
      renderer.addScar(x, y, z, splash.radius * 1.1, 1, 0);
      renderer.addScar(x, y, z, splash.radius * 0.5, 1, 0);
      debris(x, y, z, splash.radius * 0.4);
    } else if (splash.nuke) {
      // A warhead is the same code path as a grenade with different numbers,
      // which is the point of having the numbers in one place. What it gets of
      // its own is the look: a white frame, a column of fire, and a mark on
      // the city a quarter of a kilometre across.
      audio.nuke(dist);
      effects.nuke(x, y, z, splash.radius);
      state.flashTint = null;
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
      renderer.addScar(x, y, z, splash.radius * 1.1, 1, 0);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.random();
        const r = splash.radius * 0.55;
        renderer.addScar(x + Math.cos(a) * r, y, z + Math.sin(a) * r,
          splash.radius * 0.8, 0.9, 0);
      }
      debris(x, y, z, splash.radius * 0.35);
    } else {
      // A hundred of these a second is one roar, not a hundred bangs: the
      // quiet ones are heard one time in twelve.
      if (!splash.quiet || Math.random() < 0.08) audio.explosion();
      effects.explode(x, y, z);
      effects.blast(x, y, z, splash.radius);
      // Mark whatever it went off against, and open it. The soot reaches
      // further than the damage does, which is how a blast looks on a wall;
      // the hole is a fraction of the blast, the same way a crater is, and
      // only a charge with real weight behind it makes one at all.
      // A fraction of the blast, the way a crater is. The first pass had it at
      // 0.38 of the radius, which took most of a storey out of a frontage for
      // one rocket: dramatic, and wrong by about double.
      // Not everything that goes off cuts a hole through masonry. A car going
      // up is a tank of petrol: it burns, it throws its own panels about, and
      // it leaves a wreck. Giving it a punch took the wreck away again, and
      // the lamp post beside it with it.
      // A weapon built to open a building says how far, in its own row.
      const punch = splash.punch === false ? 0
        : typeof splash.punch === 'number' ? splash.punch
          : (splash.damage >= 90 ? Math.min(3.0, splash.radius * 0.21) : 0);
      renderer.addScar(x, y, z, splash.radius * 1.5,
        Math.min(1, splash.damage / 180), punch);
      // A hole has to have something behind it. The tiles round a blast are
      // drawn a second time inside out, which is what fills a hole with the
      // inside of the building instead of with the sky, and until now only a
      // collapse asked for that.
      if (punch > 0) scarTiles(x, z, splash.radius);
      // And the hole is cut into the wall rather than only drawn over it. The
      // shader's version is one of sixteen marks and goes when the ring comes
      // round again; this one is in the buffers and in the collision, so what
      // you can see through you can also shoot and walk through, and it is
      // still there an hour later.
      // With the buildings switch off the city stays standing, and that
      // includes not having holes cut in it.
      if (punch > 0 && demolition.buildings) {
        const opened = holeInWall(world, x, y, z, punch);
        if (opened.length) {
          tiles.refresh(opened);
          for (const i of opened) renderer.scarredTiles.add(i);
        }
        demolition.punch(x, y, z, punch);
      }
      debris(x, y, z, splash.radius);
    }
    const big = splash.nuke || splash.fusion;
    effects.shake = Math.min(big ? 2.6 : 1.4, effects.shake
      + Math.max(0, 1 - dist / (splash.radius * 3)) * (big ? 2.2 : 0.9));

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
      // And a vehicle, which is a motor with seats round it.
      for (const v of [...vehicles.active]) {
        if (!v.alive || Math.hypot(v.x - x, v.z - z) > empSpec.radius) continue;
        v.speed *= 0.2;
      }
      audio.emp(dist);
      // The pulse, drawn as a pulse: a ring that travels out to exactly the
      // radius it reaches, so what it caught and what it missed is on the
      // screen rather than in the kill feed. The first version of this was a
      // blue flash and a handful of sparks, and it read as nothing at all.
      effects.emp(x, world.groundHeight(x, z), z, empSpec.radius);
      // What it does to the screen you are looking at, falling off with
      // distance: close enough and the frame goes white for a moment.
      const near = Math.max(0, 1 - dist / (empSpec.radius * 2.2));
      state.flash = Math.min(0.85, state.flash + 0.55 * near * near);
      effects.shake = Math.min(1.6, effects.shake + 0.7 * near);
      renderer.addScar(x, y, z, empSpec.radius * 0.4, 0.3);
      const stopped = caught + heavy;
      if (stopped) {
        audio.hitMarker(heavy > 0);
        showHitmarker(heavy > 0 ? 'core' : '');
        feed(`<b>EMP</b> ${stopped} stopped`);
        toast(heavy
          ? `${stopped} down, ${heavy} of them heavy`
          : `${stopped} stopped where ${stopped === 1 ? 'it' : 'they'} stood`);
      }
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

    // The void cannon's ball, landing: a green flash the size of the blast,
    // and a tendril out to everybody within reach that a wall does not hide.
    const voidSpec = (body && body.void) || (row && row.void) || null;
    if (voidSpec) voidBurst(x, y, z, splash, voidSpec);

    // And what it did to the city itself. Small blasts add up on a grid and
    // bring a frontage down when they have done enough; a warhead takes its
    // whole radius at once.
    // Some blasts do not dig: a car going up is a tank of petrol and a lot of
    // noise, and it should not leave a shell hole under its own wreck, which
    // is what left the burnt out shell standing in the air over one.
    // A charge can say what it does to the grid apart from what it does to
    // people: the void cannon kills across a square and opens a frontage,
    // and bringing the whole block down on top of the hole was not the idea.
    const wreck = splash.wreck || splash;
    demolition.blast(x, y, z, wreck.radius, wreck.damage, splash.crater !== false);
    // Anything that leaves a mark sets light to the trees in it. The radius
    // is wider than the blast, because fire spreads and a blast does not.
    fires.ignite(x, y, z, splash.radius * (splash.nuke || splash.fusion ? 1.15 : 1.9),
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
      // Nor the Warlord's its own.
      if (mk.spec.boss && body && body.weapon === 'warlord') continue;
      // One with a heart takes a blast in full only when it goes off at the heart.
      const atHeart = !mk.spec.heart || (() => {
        const h = mechs.heart(mk);
        return Math.hypot(h.x - x, h.y - by, h.z - z) < Math.max(3, splash.radius * 0.4);
      })();
      if (mechs.damage(mk, dmg, atHeart)) { creditTarget(mk, false, 'mech'); killed++; }
    }
    for (const v of [...vehicles.active]) {
      if (v.health <= 0) continue;
      const r = Math.hypot(v.x - x, v.y + 1.0 - by, v.z - z);
      if (r > splash.radius) continue;
      if (!reach(v.x, v.y + 1.0, v.z)) continue;
      vehicles.damage(v, splash.damage * (1 - r / splash.radius));
    }
    // A charge that landed looking for a car. It takes the nearest one within
    // reach and that car is the bomb: the shaped charge is small, what goes
    // off is a tank of petrol with a street around it.
    if (body && body.carbomb) {
      const car = cars.at(x, z, body.carbomb);
      if (car) {
        cars.destroy(car);
        feed('<b>car bomb</b> armed');
      }
    }
    // Every parked car in it. A blast beside one sets it off, which sets off
    // the one parked in front of it, which is a street you can take apart one
    // bonnet at a time.
    for (const car of cars.near(x, z, splash.radius * 0.9)) {
      const r = Math.hypot(car.x - x, car.z - z);
      cars.hurt(car, splash.damage * (1 - r / (splash.radius * 0.9)));
    }
    // And you, unless you are inside something, in which case the thing you
    // are inside has already taken it above and taking it twice would mean a
    // rocket that kills the pilot through the armour it just dented.
    const toPlayer = Math.hypot(player.x - x, player.y + PLAYER.eye - by, player.z - z);
    if (!state.inMech && !state.inVehicle && toPlayer < splash.radius
      && reach(player.x, player.y + PLAYER.eye, player.z)) {
      combat.hurt(splash.damage * (splash.self ?? 0.55) * (1 - toPlayer / splash.radius),
        x, z, player.x, player.z);
    }
    if (killed > 1) toast(`${killed} at once`);
    return killed;
  }

  // --- the void cannon ------------------------------------------------------
  /**
   * Everybody within reach of a point who can be seen from it: soldiers,
   * drones and mechs, each with the height a tendril should arrive at.
   */
  function voidTargets(x, y, z, reach) {
    const out = [];
    const seen = (ax, ay, az) => world.lineOfSight(x, y, z, ax, ay, az);
    for (const sd of soldiers.active) {
      if (!sd.alive || sd.health <= 0) continue;
      if (Math.hypot(sd.x - x, sd.y + 1.1 - y, sd.z - z) > reach) continue;
      if (seen(sd.x, sd.y + 1.1, sd.z)) out.push({ kind: 'soldier', t: sd, y: sd.y + 1.1 });
    }
    for (const d of drones.active) {
      if (d.health <= 0) continue;
      if (Math.hypot(d.x - x, d.y - y, d.z - z) > reach) continue;
      if (seen(d.x, d.y, d.z)) out.push({ kind: 'drone', t: d, y: d.y });
    }
    for (const mk of mechs.active) {
      if (mk.health <= 0 || mk === state.inMech) continue;
      const mid = mk.y + mk.spec.height * 0.72;
      if (Math.hypot(mk.x - x, mid - y, mk.z - z) > reach) continue;
      if (seen(mk.x, mid, mk.z)) out.push({ kind: 'mech', t: mk, y: mid });
    }
    return out;
  }

  /** A green tendril from one point to another, crooked, and gone in a blink. */
  function tendril(ax, ay, az, bx, by, bz) {
    const n = 4;
    let px = ax, py = ay, pz = az;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const j = i < n ? 0.9 : 0;
      const qx = ax + (bx - ax) * k + (Math.random() - 0.5) * j;
      const qy = ay + (by - ay) * k + (Math.random() - 0.5) * j;
      const qz = az + (bz - az) * k + (Math.random() - 0.5) * j;
      effects.lance(px, py, pz, qx, qy, qz, 0.35, 1.0, 0.3);
      px = qx; py = qy; pz = qz;
    }
    effects.flash(bx, by, bz, 1.2, 0.4, 1.0, 0.35, 0.18);
  }

  /** What a tendril does to whatever it reached. */
  function voidHit(v, damage, fromX, fromZ) {
    const t = v.t;
    if (v.kind === 'soldier') {
      const r = Math.hypot(t.x - fromX, t.z - fromZ) || 1;
      if (soldiers.damage(t, damage, { x: (t.x - fromX) / r, y: 0, z: (t.z - fromZ) / r })) {
        creditTarget(t, false, 'soldier');
        return true;
      }
    } else if (v.kind === 'drone') {
      if (drones.damage(t, damage)) { creditTarget(t, false, 'drone'); return true; }
    } else if (mechs.damage(t, damage * 2)) {
      creditTarget(t, false, 'mech');
      return true;
    }
    return false;
  }

  /** The ball landing: a green flash and a tendril to everybody in reach. */
  function voidBurst(x, y, z, splash, spec) {
    effects.flash(x, y, z, splash.radius * 0.9, 0.35, 1.0, 0.3, 0.5);
    effects.flash(x, y, z, splash.radius * 0.4, 0.8, 1.0, 0.7, 0.3);
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const r = Math.random() * splash.radius * 0.7;
      effects.spark(x + Math.sin(b) * Math.cos(a) * r, y + Math.cos(b) * r * 0.6 + 1,
        z + Math.sin(b) * Math.sin(a) * r, 0.35, 1.0, 0.3);
    }
    state.flash = Math.max(state.flash, 0.35);
    let n = 0;
    for (const v of voidTargets(x, y + 1, z, spec.reach)) {
      tendril(x, y + 1, z, v.t.x, v.y, v.t.z);
      if (voidHit(v, spec.damage, x, z)) n++;
    }
    if (n) feed(`<b>void</b> ${n} taken`);
    return n;
  }

  /**
   * The ball in flight: green sparks off it, and every so often a tendril out
   * to whoever it is passing, which is the part that makes it more than a
   * slow rocket.
   */
  function voidTick(dt) {
    for (const b of projectiles.active) {
      if ((b.kind !== 'void' && !b.void) || !b.alive) continue;
      const spec = b.void || WEAPONS.void.void;
      for (let i = 0; i < 3; i++) {
        effects.spark(b.x + (Math.random() - 0.5) * 1.4, b.y + (Math.random() - 0.5) * 1.4,
          b.z + (Math.random() - 0.5) * 1.4, 0.35, 1.0, 0.3);
      }
      b.zap = (b.zap ?? 0) - dt;
      if (b.zap > 0) continue;
      b.zap = spec.every;
      for (const v of voidTargets(b.x, b.y, b.z, spec.aura)) {
        tendril(b.x, b.y, b.z, v.t.x, v.y, v.t.z);
        voidHit(v, spec.auraDamage, b.x, b.z);
      }
    }
  }

  /**
   * Whatever the blast knocked off the wall. The raycast tells us which
   * surfaces are near enough to lose something, so debris comes off the
   * building rather than out of the air.
   *
   * It marked the wall and left it at that, and the only chunks a blast made
   * were the ones a collapse stage made, which start at the line the building
   * broke at. Shoot a shopfront and the pieces fell past you from the roof.
   * The surfaces found here are the ones the blast actually reached, so they
   * are also the ones to throw into the street.
   */
  function debris(x, y, z, radius) {
    // What the pieces have behind them. A rocket is about eight metres of
    // blast and throws them properly; a grenade at two metres only chips the
    // render off. Spread over as many surfaces as the rays find, with a
    // ceiling, so a blast in a courtyard with walls on all sides does not
    // empty the chunk pool on its own.
    const force = Math.max(0.35, Math.min(1.4, radius / 8));
    let thrown = 0;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
      const hit = world.raycast(x, y, z, Math.cos(a), 0.1 - Math.random() * 0.4, Math.sin(a),
        radius * 1.2);
      if (!hit || hit.kind === 'ground') continue;
      effects.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.kind);
      if (thrown >= 18) continue;
      // Nearer the middle of the blast is hit harder, which is the difference
      // between the wall you aimed at and the one across the street.
      const near = Math.max(0, 1 - hit.t / Math.max(1, radius * 1.2));
      const n = Math.min(18 - thrown, 1 + Math.round(near * 2.5));
      gibs.spall(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, n, force * (0.45 + near * 0.8));
      thrown += n;
    }
  }

  /** One kill, however it was made: by a bullet, a blast or a fall. */
  // How far away a fight is still the fight you are in, for the last kill.
  // A hundred and fifty metres was the whole street and everything over it:
  // in a real fight something is always alive somewhere in a circle that
  // size, so the slow motion never came, which is what was reported. Sixty
  // five is the piece of city you are actually in.
  const LAST_KILL_REACH = 65;
  // And it may not happen again straight away, or clearing a square one body
  // at a time turns into a stutter.
  const LAST_KILL_REST = 5;

  /**
   * How many of them are still up and anywhere near you. Dying is not up: a
   * soldier on his way down has no health left and is on his own time.
   *
   * @param {number} reach metres, beyond which it is somebody else's fight
   */
  function hostilesAlive(x, z, reach = LAST_KILL_REACH) {
    let n = 0;
    const near = (a) => Math.hypot(a.x - x, a.z - z) <= reach;
    for (const d of drones.active) if (d.health > 0 && near(d)) n++;
    for (const sd of soldiers.active) if (sd.health > 0 && near(sd)) n++;
    for (const j of jets.active) if (j.health > 0 && near(j)) n++;
    // Your own machine is not a hostile, whether you are sitting in it or
    // have left it standing in the road.
    for (const m of mechs.active) if (!m.mine && m.alive && m.health > 0 && near(m)) n++;
    return n;
  }

  /**
   * What the frontage you are aiming at has taken, and what it has left. The
   * damage is kept on a grid of cells about one Berlin block frontage
   * across, which is the unit that comes down, so what this answers is the
   * cell your shot would land in rather than some notion of a building.
   *
   * Only while the menu asks for it, and only on a wall: the ground and the
   * sky have nothing to say here.
   */
  function showBuildingDamage() {
    if (!cheats.showDamage || state.mode !== 'walk') {
      if (!el.buildInfo.classList.contains('hidden')) el.buildInfo.classList.add('hidden');
      return;
    }
    const eye = camera.position;
    const f = camera.forward;
    const hit = world.raycast(eye[0], eye[1], eye[2], f[0], f[1], f[2], 220);
    if (!hit) { el.buildInfo.classList.add('hidden'); return; }
    const x = eye[0] + f[0] * hit.t;
    const z = eye[2] + f[2] * hit.t;
    const d = demolition.damageAt(x, z);
    const tall = world.tallestNear(x, z, 10);
    el.buildInfo.classList.remove('hidden');
    el.buildInfo.innerHTML = tall < 2.5
      ? `<i>nothing standing here</i>`
      : `<b>${d.left}</b> left of <b>${d.whole}</b> <i>stage ${d.stage} of ${d.stages}, `
        + `${Math.round(tall)} m standing, ${Math.round(hit.t)} m away</i>`;
  }

  /**
   * Is a mech's head inside a building rather than beside one? Eight rays at
   * head height, out as far as the hull is wide and then some. If nearly all
   * of them are stopped, the machine is standing in the building rather than
   * against it, and the cockpit view is the inside of a wall, which is black:
   * that is what the view out of a mech standing in a frontage was. There is
   * no test for a roof over it because nothing in this city has one the
   * collision knows about.
   *
   * @returns {boolean} true when the shoulder view should take over
   */
  function mechEyeBoxedIn(m) {
    const y = m.y + m.spec.eye;
    const reach = (m.spec.radius || 2.3) * 2.6;
    let hits = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1],
      [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]]) {
      if (world.raycast(m.x, y, m.z, dx, 0, dz, reach)) hits++;
    }
    return hits >= 7;
  }

  /**
   * Anything under the feet of a machine this size. Eight metres of walking
   * armour does not step over a man: it puts him into the pavement. The foot
   * is the hull's own radius, and anybody standing well above it, on a heap
   * or a roof, is not underneath it.
   *
   * @param {object} m the mech doing the walking
   */
  function trampleUnderfoot(m) {
    const reach = (m.spec.radius || 2.3) * 1.15;
    for (const sd of [...soldiers.active]) {
      if (sd.health <= 0) continue;
      if (Math.hypot(sd.x - m.x, sd.z - m.z) > reach) continue;
      if (sd.y > m.y + 2.2) continue;
      const dir = { x: 0, y: -1, z: 0 };
      if (soldiers.damage(sd, 9999, dir)) {
        creditTarget(sd, false, 'soldier');
        feed('<b>underfoot</b>');
        // Flat, wide and in the road: what is left of somebody a mech has
        // walked over is a stain rather than a body.
        if (cheats.bleeding) {
          const k = cheats.goreScale;
          effects.stain(sd.x, world.groundHeight(sd.x, sd.z), sd.z, 1.1 + k * 0.3, 60);
          effects.blood(sd.x, sd.y + 0.3, sd.z, 0, 0.6, 0, k * 1.2);
        }
        audio.treeBurst(Math.hypot(player.x - sd.x, player.z - sd.z) + 30);
      }
    }
  }

  function creditTarget(target, core, kind) {
    const dist = Math.hypot(target.x - player.x, target.z - player.z);
    combat.creditKill(core, dist);
    // A body that came apart does not also catch fire.
    if (!target.gibbed) effects.explode(target.x, target.y, target.z);
    audio.droneDown();
    const name = target.demon ? (DEMON[target.demon] ? DEMON[target.demon].name : GAZER.name).toLowerCase()
      : kind === true ? 'drone' : (kind === false ? 'soldier' : kind);
    // In Slayer every demon is worth its points in the campaign as well.
    if (target.demon && campaign.mode === 'slayer') {
      campaign.book.score += DEMON[target.demon] ? DEMON[target.demon].points : GAZER.points;
      campaign.save();
    }
    feed(`<b>${name} down</b> ${Math.round(dist)} m${core ? ' <i>core</i>' : ''}`);
    // The last kill, in slow motion. It fires on the kill that emptied the
    // ground around you, and on no other: a flourish on every kill is not a
    // flourish, it is a stutter, and the whole point of the switch is the
    // quiet after the last of them goes down. The one you just killed has to
    // have been near you as well, or a rocket fired across the district
    // would do it.
    if (cheats.lastKill && state.mode === 'walk' && state.killRest <= 0
      && dist <= LAST_KILL_REACH
      && hostilesAlive(player.x, player.z) === 0) {
      state.killSlow = 2.2;
      state.killRest = LAST_KILL_REST;
      feed('<i>last kill</i>');
    }
  }
  weapon.onDryFire = () => audio.dryFire();
  weapon.onReloadStart = (seconds) => audio.reload(seconds);
  // A full blast plasma charge says so, out loud and on the screen.
  weapon.onBlastReady = () => {
    audio.ultraCharge(0.5);
    toast('blast plasma ready');
  };

  weapon.onSwap = (id, spec) => {
    audio.swap();
    toast(spec.name);
    el.weaponname.textContent = weaponLabel(spec);
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

  /**
   * What theirs fires, by the kind its chassis gives it. The Reaper's
   * chaingun is the `auto` at the bottom; the rest are the chassis' own: a
   * shotgun, a rail, shells, a swarm of small rockets, thermite and a beam.
   */
  const FOE_FIRE = {
    shotgun(m, from, dir, gun) {
      audio.gunshot('mechgun');
      for (let i = 0; i < gun.pellets; i++) foeRound(m, from, dir, gun, 0.55);
      effects.flash(from.x, from.y, from.z, 2.6, 1.0, 0.7, 0.35, 0.08);
    },
    rail(m, from, dir, gun) {
      // One bolt with a long wait between: it is the shot you hear coming
      // for three seconds and then have to have moved out of.
      audio.gunshot('rail');
      const hit = world.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, gun.range);
      const reach = hit ? hit.t : gun.range;
      const end = { x: from.x + dir.x * reach, y: from.y + dir.y * reach, z: from.z + dir.z * reach };
      effects.lance(from.x, from.y, from.z, end.x, end.y, end.z, 1.0, 0.25, 0.2);
      effects.flash(from.x, from.y, from.z, 3.4, 1.0, 0.3, 0.25, 0.12);
      const near = pointToRay(player.x, player.y + PLAYER.eye * 0.6, player.z, from, dir, reach);
      if (near < 1.3 && combat.health > 0) combat.hurt(gun.damage, m.x, m.z, player.x, player.z);
      if (hit) {
        effects.impact(end.x, end.y, end.z, hit.nx || 0, hit.ny || 1, hit.nz || 0, 'wall');
        demolition.blast(end.x, end.y, end.z, 3, gun.damage * 2);
      }
    },
    shell(m, from, dir, gun) {
      audio.gunshot('mechcannon');
      const d = spreadDir(dir, gun.spread);
      projectiles.launch('rocket', {
        x: from.x, y: from.y, z: from.z,
        vx: d.x * gun.speed, vy: d.y * gun.speed, vz: d.z * gun.speed,
        splash: gun.splash, weapon: m.spec.boss ? 'warlord' : 'reaper',
      });
      effects.flash(from.x, from.y, from.z, 2.8, 1.0, 0.6, 0.3, 0.08);
    },
    swarm(m, from, dir, gun) {
      // Little rockets, a handful at a time, that wander on the way.
      audio.gunshot('rpg');
      const d = spreadDir(dir, gun.spread);
      projectiles.launch('rocket', {
        x: from.x, y: from.y, z: from.z,
        vx: d.x * gun.speed, vy: d.y * gun.speed + 4, vz: d.z * gun.speed,
        splash: gun.splash, weapon: 'reaper',
      });
    },
    thermite(m, from, dir, gun) {
      audio.gunshot('rpg');
      const d = spreadDir(dir, gun.spread);
      projectiles.launch('rocket', {
        x: from.x, y: from.y, z: from.z,
        vx: d.x * gun.speed, vy: d.y * gun.speed + 6, vz: d.z * gun.speed,
        splash: gun.splash, weapon: 'reaper', thermite: gun.fire,
      });
    },
    laser(m, from, dir, gun) {
      // A beam held on you for a second and a half, a little at a time.
      const hit = world.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, gun.range);
      const reach = hit ? hit.t : gun.range;
      const end = { x: from.x + dir.x * reach, y: from.y + dir.y * reach, z: from.z + dir.z * reach };
      effects.lance(from.x, from.y, from.z, end.x, end.y, end.z, 0.75, 0.2, 1.0);
      if (Math.random() < 0.2) audio.laser(Math.hypot(player.x - m.x, player.z - m.z));
      const near = pointToRay(player.x, player.y + PLAYER.eye * 0.6, player.z, from, dir, reach);
      if (near < 1.0 && combat.health > 0) combat.hurt(gun.damage, m.x, m.z, player.x, player.z);
      if (hit && Math.random() < 0.3) {
        effects.impact(end.x, end.y, end.z, hit.nx || 0, hit.ny || 1, hit.nz || 0, 'wall');
      }
    },
  };

  /** A direction knocked off true by up to this much. */
  function spreadDir(dir, amount) {
    const d = {
      x: dir.x + (Math.random() - 0.5) * amount,
      y: dir.y + (Math.random() - 0.5) * amount,
      z: dir.z + (Math.random() - 0.5) * amount,
    };
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    return { x: d.x / l, y: d.y / l, z: d.z / l };
  }

  /** One round of theirs, which hurts you if it goes through you. */
  function foeRound(m, from, dir, gun, wide = 0.9) {
    const d = spreadDir(dir, gun.spread);
    const hit = world.raycast(from.x, from.y, from.z, d.x, d.y, d.z, gun.range);
    const reach = hit ? hit.t : gun.range;
    const end = { x: from.x + d.x * reach, y: from.y + d.y * reach, z: from.z + d.z * reach };
    effects.tracer(from.x, from.y, from.z, end.x, end.y, end.z, false);
    if (hit) effects.impact(end.x, end.y, end.z, hit.nx || 0, hit.ny || 1, hit.nz || 0, 'wall');
    const near = pointToRay(player.x, player.y + PLAYER.eye * 0.6, player.z, from, d, reach);
    if (near < wide && combat.health > 0) combat.hurt(gun.damage, m.x, m.z, player.x, player.z);
  }

  /** A chaingun round, from a mech, at whatever is in front of it. */
  mechs.onChaingun = (m, from, dir, gun) => {
    if (!m.mine && gun.kind && FOE_FIRE[gun.kind]) {
      FOE_FIRE[gun.kind](m, from, dir, gun);
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
    if (tactics.enabled && m.mine) soldiers.hear(from.x, from.z, TACTICS.noise.explosion);
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

    // --- the heavy arms ---------------------------------------------------

    if (arm.kind === 'laser') {
      // A beam rather than a round: no spread, no travel, and it does not
      // stop at the first thing it burns through. What it lands on catches.
      const hit = world.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, arm.range);
      const reach = hit ? hit.t : arm.range;
      const end = {
        x: from.x + dir.x * reach, y: from.y + dir.y * reach, z: from.z + dir.z * reach,
      };
      effects.lance(from.x, from.y, from.z, end.x, end.y, end.z, 1.0, 0.42, 0.18);
      effects.flash(from.x, from.y, from.z, 2.4, 1.0, 0.5, 0.2, 0.06);
      const through = new Set();
      for (let i = 0; i < arm.pierce; i++) {
        if (!mechHit(from, dir, reach, arm.damage, through)) break;
      }
      if (hit) {
        effects.flash(end.x, end.y, end.z, 2.0, 1.0, 0.55, 0.2, 0.07);
        effects.impact(end.x, end.y, end.z, hit.nx || 0, hit.ny || 1, hit.nz || 0, 'wall');
        demolition.blast(end.x, end.y, end.z, 3.0, arm.damage);
        scarTiles(end.x, end.z, 4);
        hitCar(end.x, end.y, end.z, arm.damage);
        // It cuts, and what it cuts smoulders. Not every shot, or a held
        // trigger would set a street alight in a second and a half.
        if (Math.random() < 0.08) fires.ignite(end.x, world.groundHeight(end.x, end.z), end.z, 5, 0.6);
      }
      return;
    }

    if (arm.kind === 'flak') {
      // Lead it onto whatever is in the air in front of you, and let the
      // shell burst beside it. With nothing up there it is a heavy shell on
      // a long fuse, which is a different and perfectly good thing to have.
      const target = airLock(from, dir, arm.lockRange, arm.lockCone);
      const d = spread(arm.spread);
      projectiles.launch('rocket', {
        x: from.x, y: from.y, z: from.z,
        vx: d.x * arm.speed, vy: d.y * arm.speed, vz: d.z * arm.speed,
        splash: arm.splash, weapon: 'mech',
        fuse: arm.fuse,
        target, proximity: target ? arm.proximity : 0,
      });
      if (m === state.inMech && target) toast('flak, on it');
      return;
    }

    if (arm.kind === 'stinger') {
      const target = airLock(from, dir, arm.lockRange, arm.lockCone);
      if (!target) {
        if (m === state.inMech) toast('nothing in the air');
        return;
      }
      projectiles.launch('rocket', {
        x: from.x, y: from.y, z: from.z,
        vx: dir.x * arm.speed, vy: dir.y * arm.speed, vz: dir.z * arm.speed,
        splash: arm.splash, weapon: 'mech',
        homing: { turn: 5.5, reach: arm.lockRange }, target,
      });
      // And the world slows while it runs it down, which is the whole point
      // of locking something up rather than leading it.
      if (m === state.inMech) {
        state.airSlow = arm.slow;
        feed('<b>stinger</b> locked');
      }
      return;
    }

    if (arm.kind === 'carbomb') {
      const d = spread(arm.spread);
      projectiles.launch('rocket', {
        x: from.x, y: from.y, z: from.z,
        vx: d.x * arm.speed, vy: d.y * arm.speed, vz: d.z * arm.speed,
        splash: arm.splash, weapon: 'mech', carbomb: arm.reach,
      });
      return;
    }

    if (arm.kind === 'void') {
      // The ball carries its own reach, so the tendrils on the way and the
      // burst where it lands are the arm's and not the hand cannon's.
      const d = spread(arm.spread);
      projectiles.launch('voidMaw', {
        x: from.x, y: from.y, z: from.z,
        vx: d.x * arm.speed, vy: d.y * arm.speed, vz: d.z * arm.speed,
        splash: arm.splash, void: arm.void, weapon: 'mech',
      });
      return;
    }

    if (arm.kind === 'empbomb') {
      const d = spread(arm.spread);
      projectiles.launch('rocket', {
        x: from.x, y: from.y, z: from.z,
        vx: d.x * arm.speed, vy: d.y * arm.speed, vz: d.z * arm.speed,
        splash: arm.splash, weapon: 'mech', emp: arm.emp,
      });
      return;
    }
  };

  /**
   * What is in the air in front of the barrel: the nearest jet or drone
   * inside a narrow cone. Flak leads it, the Stinger chases it.
   *
   * @returns {object|null} the body, which is what a homing shot steers at
   */
  function airLock(from, dir, range, cone) {
    let best = null, bestT = Infinity;
    const look = (body, y) => {
      const vx = body.x - from.x, vy = y - from.y, vz = body.z - from.z;
      const t = vx * dir.x + vy * dir.y + vz * dir.z;
      if (t <= 6 || t > range) return;
      const off = Math.hypot(vx - dir.x * t, vy - dir.y * t, vz - dir.z * t);
      if (off > cone * t) return;
      if (t < bestT) { bestT = t; best = body; }
    };
    for (const j of jets.active) if (j.health > 0) look(j, j.y);
    for (const d of drones.active) if (d.health > 0) look(d, d.y);
    return best;
  }

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
      splash: rockets.splash, weapon: m.mine ? 'mech' : (m.spec.boss ? 'warlord' : 'reaper'),
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

  // Every district that lands, however it was asked for, gets the damage you
  // did to it back. It used to be put back by hand at the two places that
  // waited for a fetch; the streamer fetches without waiting for anything, so
  // the record is restored where the bytes arrive instead.
  world.onDistrict = (d) => { restoreScars(d.id); cars.add(d); trains.gather(); };
  world.onDrop = (d) => { cars.drop(d); };
  // Anything already in memory by the time this is wired up, which is the
  // district the game boots into.
  for (const d of world.districts.values()) cars.add(d);
  trains.gather();
  // One going over while you are under the arches, heard rather than seen.
  trains.onPass = (away) => audio.jetPass ? audio.jetPass(away) : null;

  // --- the parked cars ------------------------------------------------------
  // A car is four boxes baked into a tile with a collision box beside it, so
  // what is left of one that has gone up has to be written back into the same
  // bytes: the geometry onto the road and the collision box down with it.
  cars.onFlatten = (car) => {
    const { tiles: changed } = bakeCrush(world, car.x, car.z, 3.1, 2.2);
    if (changed.length) {
      tiles.refresh(changed);
      for (const i of changed) renderer.scarredTiles.add(i);
    }
    // And nothing to walk into any more. The segments inside the footprint
    // are cut to the road, which is what the collapse of a frontage does to
    // its walls, through the same per tile split so the whole street does not
    // come down with the car.
    const base = world.groundHeight(car.x, car.z);
    const seen = new Set();
    world.forEachSegmentTile(car.x - 3, car.z - 3, car.x + 3, car.z + 3,
      (segs, count, index) => { seen.add(index); });
    for (const index of seen) {
      const segs = demolition.splitTile(index);
      const count = segs.length / 6;
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        const mx = (segs[o] + segs[o + 2]) * 0.5;
        const mz = (segs[o + 1] + segs[o + 3]) * 0.5;
        if (Math.hypot(mx - car.x, mz - car.z) > 2.9) continue;
        // Only what is car sized. A frontage that happens to run past the
        // kerb is metres tall and is left exactly where it is.
        if (segs[o + 5] - segs[o + 4] > 2.4) continue;
        // Still something to bump into: a burnt out shell is knee high and
        // solid, not a mark on the road.
        if (segs[o + 5] > base + 0.72) { segs[o + 5] = base + 0.72; }
      }
    }
    world.heightCache.clear();
  };

  // What setting one off looks like. The blast itself goes through the same
  // explode() everything else uses, so it hurts what is standing next to it,
  // cuts the frontage behind it and leaves a mark on the road; a petrol fire
  // on top of that, because a car that goes up goes on burning.
  const carBlasts = [];
  cars.onDestroyed = (car) => {
    // Not at once, and not all at the same moment: a row of cars going up one
    // after the other is a chain, and a chain that fires inside its own blast
    // is a thousand deep stack of them.
    carBlasts.push({ x: car.x, z: car.z, at: state.time + 0.08 + Math.random() * 0.3 });
  };

  function updateCarBlasts() {
    for (let i = carBlasts.length - 1; i >= 0; i--) {
      if (carBlasts[i].at > state.time) continue;
      const b = carBlasts.splice(i, 1)[0];
      const y = world.groundHeight(b.x, b.z);
      explode(b.x, y + 0.8, b.z, CAR_BLAST, { weapon: 'car' });
      gibs.rubble(b.x, y + 1.1, b.z, 4.5, 12, 1.6);
      fires.ignite(b.x, y, b.z, 7, 1);
      effects.flame(b.x, y + 0.7, b.z, 4.4, 1);
      burning.push({ x: b.x, y, z: b.z, radius: 6.0, left: 16, damagePerSecond: 26 });
      feed('<i>car</i> burning');
    }
  }

  /**
   * What goes into the street when a car does. Less than a rocket and more
   * than a grenade, and it reaches far enough to take the next car along with
   * it, which is the whole pleasure of a row of them.
   */
  const CAR_BLAST = { radius: 11, damage: 120, crater: false, punch: false };

  /**
   * A round or a blast landing on a parked car.
   *
   * @returns {boolean} whether that was the one that set it off
   */
  function hitCar(x, y, z, damage) {
    const car = cars.at(x, z, 2.4);
    if (!car) return false;
    if (y > world.groundHeight(x, z) + 2.2) return false;
    return cars.hurt(car, damage);
  }

  mechs.onEject = () => { if (state.inMech) leaveMech(false); };

  // Reactors running away, each until its fuse is out.
  const reactors = mechs.reactors;

  mechs.onDestroyed = (m) => {
    if (m.demon === 'warlord') { warlordDown(m); return; }
    // The machine is dead; the reactor in it is not, yet. A small blast and
    // a shower of parts now, so a kill still reads as a kill, and the real
    // one when the containment goes.
    explode(m.x, m.y + 3.0, m.z, { radius: 12, damage: 160, crater: false }, { weapon: 'mech' });
    gibs.rubble(m.x, m.y + 2.0, m.z, 9, 16, 2.4);
    const own = state.inMech === m;
    reactors.push({ m, left: own ? FUSION.fuseOwn : FUSION.fuse, spark: 0, chord: false });
    feed(`<b>${m.spec.name.toLowerCase()} down</b>, reactor critical`);
    if (own) {
      leaveMech(true);
      toast('reactor critical, get clear');
    }
  };

  /**
   * The few seconds between a mech going down and its reactor going up: blue
   * sparks out of the wreck, faster as it runs, the charge chord rising under
   * it, and then the fusion blast where the wreck is lying.
   */
  function updateReactors(dt) {
    for (let i = reactors.length - 1; i >= 0; i--) {
      const r = reactors[i];
      const m = r.m;
      r.left -= dt;
      if (!r.chord && r.left < 2.0) {
        r.chord = true;
        audio.ultraCharge(Math.max(0.4, r.left));
      }
      // Sparks, more of them the nearer it is.
      r.spark -= dt;
      if (r.spark <= 0) {
        r.spark = Math.max(0.03, Math.min(0.25, r.left * 0.08));
        const h = (m.spec.height || 8) * (0.3 + Math.random() * 0.5);
        effects.spark(m.x + (Math.random() - 0.5) * 3, m.y + h,
          m.z + (Math.random() - 0.5) * 3, 0.35, 0.95, 0.75);
        effects.flash(m.x, m.y + h, m.z, 2.5 + Math.random() * 2, 0.4, 1.0, 0.8, 0.12);
      }
      if (r.left > 0) continue;
      reactors.splice(i, 1);
      const g = world.groundHeight(m.x, m.z);
      explode(m.x, g + 2.0, m.z, FUSION.splash, { weapon: 'mech' });
      fires.ignite(m.x, g, m.z, 16, 1);
      burning.push({ x: m.x, y: g, z: m.z, radius: 12, left: 18, damagePerSecond: 40 });
      feed(`<b>${m.spec.name.toLowerCase()}</b> reactor breach`);
    }
  }

  /**
   * Every machine on its feet, against the trees it is standing in. Checked a
   * few times a second rather than every step: a Titan walks at eleven metres
   * a second and a tree is four metres across, so nothing is walked past
   * between one check and the next.
   */
  let treeSweep = 0;
  function walkOverTrees() {
    treeSweep++;
    if (treeSweep % 8) return;
    for (const m of mechs.active) {
      if (!m.alive) continue;
      flattenTrees(m.x, m.z, (m.spec.radius || 2.3) + 1.2);
    }
    // And anything on wheels or tracks going at a decent lick.
    for (const v of vehicles.active) {
      if (!v.alive || v.spec.kind !== 'ground' || Math.abs(v.speed) < SMASH.from) continue;
      flattenTrees(v.x, v.z, (v.spec.radius || 1.5) + 0.6);
    }
  }

  /**
   * Eight metres of machine walking into a lime.
   *
   * The view out of a Titan is at six metres, which on Unter den Linden is
   * the middle of the canopy, and the whole screen was leaves. The crowns
   * nearest the camera thin out so you can see past them at all, and this is
   * the other half of it: a machine that walks through a row of trees leaves
   * no row of trees. Trunks go out of the instance buffer and out of the
   * collision, which is the same thing a fire does to them.
   *
   * @returns {number} how many went down
   */
  function flattenTrees(x, z, radius) {
    const w = world;
    let n = 0;
    const tx0 = Math.max(0, Math.floor((x - radius - w.minX) / w.tileSize));
    const tx1 = Math.min(w.nx - 1, Math.floor((x + radius - w.minX) / w.tileSize));
    const tz0 = Math.max(0, Math.floor((z - radius - w.minZ) / w.tileSize));
    const tz1 = Math.min(w.nz - 1, Math.floor((z + radius - w.minZ) / w.tileSize));
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const data = w.trees(tz * w.nx + tx);
        if (!data) continue;
        for (let i = 0; i < data.length; i += 5) {
          const px = data[i], py = data[i + 1], pz = data[i + 2];
          if (Math.hypot(px - x, pz - z) > radius) continue;
          if (!w.killTree(px, pz)) continue;
          const h = data[i + 3];
          effects.dust(px, py + h * 0.5, pz, h * 0.35);
          gibs.rubble(px, py + h * 0.4, pz, 2.4, 5, h * 0.3);
          n++;
        }
      }
    }
    if (n) audio.treeFall(Math.hypot(player.x - x, player.z - z));
    return n;
  }

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
    else if (best.kind === 'mech') killed = mechs.damage(best.target, damage, best.core);
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

  /**
   * Which walls a collapse site actually has, and where. Ten rays out from
   * the middle just above the pavement, keeping the first point on each
   * separate face.
   *
   * A site is a damage cell about a Berlin block frontage across, and its
   * middle is usually in the road. Rubble was being dropped in a disc around
   * that middle, so half of it came down in the carriageway with nothing
   * above it. What comes off a building comes off its frontage.
   *
   * @returns {{x: number, z: number, t: number}[]} points a step off each face
   */
  function facesAround(x, y, z, radius, most = 6) {
    const out = [];
    const start = Math.random() * Math.PI * 2;
    for (let i = 0; i < 10 && out.length < most; i++) {
      const a = start + (i / 10) * Math.PI * 2;
      const hit = world.raycast(x, y, z, Math.cos(a), 0, Math.sin(a), radius * 1.15);
      if (!hit || hit.kind === 'ground') continue;
      if (out.some((p) => Math.hypot(p.x - hit.x, p.z - hit.z) < 4)) continue;
      out.push({ x: hit.x + hit.nx * 0.5, z: hit.z + hit.nz * 0.5, t: hit.t });
    }
    return out;
  }

  /**
   * Cuts the buildings in a site into pieces before it starts to fall, once
   * per site, so it has columns and storeys to break along. Past seventy
   * metres everything in it comes down to the ground anyway, and cutting a
   * district that size into storeys is a second's work for nothing.
   */
  function refineSite(site) {
    if (site.fined || site.walls === false) return;
    site.fined = true;
    if (site.radius > 70) return;
    const edge = Math.max(2.5, Math.min(4.5, site.radius / 7));
    const changed = fineWalls(world, site.x, site.z, site.radius * 1.05, edge);
    if (changed.length) tiles.refresh(changed);
  }

  demolition.onRefine = refineSite;

  demolition.onStage = (site, level, was) => {
    scarTiles(site.x, site.z, site.radius);
    const share = level - was;
    const chunks = Math.min(40, 6 + Math.round(site.radius * share * 1.4));
    const faces = facesAround(site.x, site.y + 2.5, site.z, site.radius);
    // Each face breaks at its own height. The break line used to be the
    // tallest wall anywhere in the site, and the chunks went down every
    // face the rays found at that height: a rocket between a six storey
    // block and the two storey house beside it dropped stone out of empty
    // air twelve metres over the house. Measured, two chunks in five came
    // from more than two metres above anything that was standing under them.
    const broken = [];
    for (const f of faces) {
      const tall = world.tallestNear(f.x, f.z, 1.5);
      if (tall < 2) continue;
      broken.push({ ...f, tall, at: site.y + tall * (1 - was) });
    }
    let dustAt = site.y + 2;
    if (broken.length) {
      // Down the front of the building, a share of the chunks to each face,
      // and a cloud at the foot of the nearest two: a facade coming down puts
      // as much dust into the street as it does at the break.
      const each = Math.max(2, Math.round(chunks / broken.length));
      broken.sort((a, b) => a.t - b.t);
      for (let i = 0; i < broken.length; i++) {
        const f = broken[i];
        gibs.rubble(f.x, f.at, f.z, Math.min(5, Math.max(2, site.radius * 0.3)),
          each, f.tall * share);
        if (i < 2) effects.dust(f.x, site.y + 3, f.z, site.radius * 0.3);
        dustAt = Math.max(dustAt, f.at);
      }
    } else {
      // Nothing found standing round the middle. Whatever is there comes off
      // whatever is under the middle itself, and if that is nothing the
      // chunks are kicked up off the ground rather than dropped out of the sky.
      const tall = world.tallestNear(site.x, site.z, 4);
      const at = site.y + Math.max(1, tall * (1 - was));
      gibs.rubble(site.x, at, site.z, Math.min(site.radius, 6), Math.min(chunks, 12),
        Math.max(1, tall * share));
      dustAt = at;
    }
    effects.dust(site.x, dustAt, site.z, site.radius * (0.5 + share * 0.6));
    // And the cloud a building makes coming down, which is most of what you
    // see of it: it rolls out along the street at the height of a man and
    // hangs there, grey and thick enough to hide the street behind it.
    effects.collapseDust(site.x, site.y, site.z, site.radius * (0.4 + share * 0.8),
      Math.max(6, dustAt - site.y));
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
      if (combat.isShielded(px, py, pz)) continue;
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

  // --- arrow heads ----------------------------------------------------------------
  /** The weapon's name on the HUD, with the head on the next arrow for a bow. */
  function weaponLabel(spec) {
    const head = spec.heads ? ARROW_HEADS[weapon.head] : null;
    return head && head.short ? `${spec.short} ${head.short}` : spec.short;
  }
  weapon.onArrowHead = (head) => {
    const row = ARROW_HEADS[head];
    toast(row ? row.name : head);
    audio.swap();
    el.weaponname.textContent = weaponLabel(weapon.spec);
  };

  // Poison let out by an arrow: it hangs, and it hurts whoever breathes it.
  const poisonClouds = [];
  function updatePoison(dt) {
    for (let i = poisonClouds.length - 1; i >= 0; i--) {
      const c = poisonClouds[i];
      c.left -= dt;
      if (c.left <= 0) { poisonClouds.splice(i, 1); continue; }
      c.puff -= dt;
      if (c.puff <= 0) {
        c.puff = 0.22;
        effects.gas(c.x, c.y, c.z, c.radius, Math.min(1, c.left / 2));
      }
      for (const sd of [...soldiers.active]) {
        if (!sd.alive || sd.health <= 0 || sd.state === 5) continue;
        if (Math.hypot(sd.x - c.x, sd.z - c.z) > c.radius + 0.4 || Math.abs(sd.y - c.y) > 3) continue;
        if (soldiers.damage(sd, c.damagePerSecond * dt, { x: 0, y: 0, z: 0 })) creditTarget(sd, false, 'soldier');
      }
      if (!state.inMech && !state.inVehicle && combat.health > 0
          && Math.hypot(player.x - c.x, player.z - c.z) < c.radius && Math.abs(player.y - c.y) < 3) {
        combat.hurt(c.damagePerSecond * 0.5 * dt, c.x, c.z, player.x, player.z);
      }
    }
  }

  // Wherever an arrow lands, in somebody or in a wall, its head does its work.
  projectiles.onArrowHead = (b, x, y, z) => {
    // An arrow into a camp's radio or alarm box breaks it like a round does.
    if (tactics.enabled) {
      const harm = (WEAPONS.bow.damage || 100);
      tactics.hitRadio(x, y, z, harm, 0.6);
      tactics.hitBox(x, y, z, harm, 0.6);
    }
    const row = ARROW_HEADS[b.head];
    if (!row) return;
    const g = world.groundHeight(x, z);
    if (row.burn) {
      const bn = row.burn;
      fires.ignite(x, g, z, bn.radius, 0.8);
      renderer.addScar(x, g, z, bn.radius * 0.7, 0.5);
      if (!combat.isShielded(x, g, z)) {
        burning.push({ x, y: g, z, radius: bn.radius, left: bn.seconds, damagePerSecond: bn.damagePerSecond });
      }
      for (let i = 0; i < 5; i++) effects.flame(x + (Math.random() - 0.5) * 2, g + 0.3, z + (Math.random() - 0.5) * 2, 2.2, 0.9);
      audio.flameWall();
    } else if (row.cloud) {
      const cl = row.cloud;
      poisonClouds.push({ x, y: g, z, radius: cl.radius, left: cl.seconds, damagePerSecond: cl.damagePerSecond, puff: 0 });
      effects.gas(x, g, z, cl.radius, 1.6);
    } else if (row.splash) {
      explode(x, y, z, row.splash, { weapon: 'bow' });
    }
  };

  /** What an arrow with a head leaves behind it in the air. */
  function arrowTrails() {
    for (const b of projectiles.active || []) {
      if (!b.alive || b.stuck || !b.head || b.head === 'plain') continue;
      const row = ARROW_HEADS[b.head];
      if (!row || !row.colour) continue;
      const [r, g, bl] = row.colour;
      if (b.head === 'fire' && Math.random() < 0.6) effects.flame(b.x, b.y - 0.2, b.z, 0.5, 0.5);
      else effects.spark(b.x, b.y, b.z, r, g, bl);
    }
  }

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
    if (combat.isShielded(x, y, z)) return;
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
    if (tactics.enabled) soldiers.hear(m.x, m.z, TACTICS.noise.explosion);
    // A tank fires where its gun is pointing, which is where the turret has
    // got to rather than where you are looking.
    const dir = v.spec.turret ? vehicles.gunDirection(v, camera.pitch) : {
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

  // A vehicle driven into something hard enough goes through it: a tree goes
  // over, a parked car goes up, a wall gets a hole the size of what hit it and
  // the frontage round it takes the blow, more of it for the tank. The edge
  // of the river holds, and so does the memorial while its field does.
  const SMASH = { from: 7, perMass: 1, radiusBase: 1.6, radiusPer: 1 / 11, maxRadius: 7 };
  vehicles.onSmash = (v, speed, hit) => {
    if (speed < SMASH.from || !hit) return false;
    const segs = world.segments(hit.tile);
    if (!segs || hit.seg === undefined) return false;
    const o = hit.seg;
    const base = segs[o + 4], top = segs[o + 5];
    if (base < world.waterLevel - 1) return false;
    const len = Math.hypot(segs[o + 2] - segs[o], segs[o + 3] - segs[o + 1]);
    const hx = hit.x, hy = hit.y, hz = hit.z;
    const away = Math.hypot(player.x - hx, player.z - hz);
    // A trunk: four short sides round a box a little over half a metre.
    if (len < 0.8 && top - base <= 4.5) {
      const n = flattenTrees(hx, hz, 1.6);
      if (n) { effects.shake = Math.min(1.2, effects.shake + 0.25); return true; }
    }
    // A parked car.
    if (top - base < 2.5) {
      const car = cars.at(hx, hz, 4);
      if (car) {
        cars.destroy(car);
        effects.shake = Math.min(1.4, effects.shake + 0.4);
        return true;
      }
    }
    if (shielded(hx, hy, hz)) return false;
    const mass = (v.spec.mass || 1) * SMASH.perMass;
    const energy = speed * speed * mass;
    const radius = Math.min(SMASH.maxRadius, SMASH.radiusBase + Math.sqrt(energy) * SMASH.radiusPer);
    const cut = demolition.punch(hx, hy, hz, radius);
    demolition.blast(hx, hy, hz, radius * 1.5, energy * 0.8, false);
    effects.impact(hx, hy, hz, hit.nx || 0, 0, hit.nz || 0, 'wall');
    effects.dust(hx, Math.max(world.groundHeight(hx, hz), hy - 1), hz, radius * 1.4);
    gibs.rubble(hx, hy, hz, radius * 0.8, Math.round(4 + radius * 2), 1.2);
    audio.land(0);
    if (away < 160) audio.explosion();
    if (v === state.inVehicle) effects.shake = Math.min(1.6, effects.shake + 0.5 + radius * 0.05);
    state.smashes = (state.smashes || 0) + 1;
    return cut > 0;
  };

  vehicles.onBump = (v, speed) => {
    if (speed < 4) return;
    effects.impact(v.x, v.y + 1, v.z, 0, 1, 0, 'wall');
    if (v === state.inVehicle) {
      effects.shake = Math.min(1, effects.shake + Math.min(0.4, speed * 0.02));
    }
  };

  /**
   * The ring that shows where a tank's gun is pointing: the end of its line
   * of fire, put on the screen. It turns green once the turret has caught up
   * with the view.
   */
  function placeGunMark() {
    const v = state.inVehicle;
    if (!v || !v.spec.turret || v.health <= 0) {
      el.gunmark.classList.add('hidden');
      return;
    }
    const m = vehicles.muzzle(v);
    const d = vehicles.gunDirection(v, camera.pitch);
    const hit = world.raycast(m.x, m.y, m.z, d.x, d.y, d.z, 400, {});
    const t = hit ? hit.t : 400;
    const p = [m.x + d.x * t, m.y + d.y * t, m.z + d.z * t];
    const vp = camera.viewProj;
    const cx = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const cy = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    if (cw <= 0.01) { el.gunmark.classList.add('hidden'); return; }
    el.gunmark.classList.remove('hidden');
    el.gunmark.style.left = `${((cx / cw) * 0.5 + 0.5) * window.innerWidth}px`;
    el.gunmark.style.top = `${(0.5 - (cy / cw) * 0.5) * window.innerHeight}px`;
    let off = (camera.yaw - (v.yaw + v.turret)) % (Math.PI * 2);
    if (off > Math.PI) off -= Math.PI * 2;
    if (off < -Math.PI) off += Math.PI * 2;
    el.gunmark.classList.toggle('laid', Math.abs(off) < 0.02);
  }

  /**
   * A bar over everything hostile in sight: soldiers and machines, drones,
   * jets and their mechs. Passers by and anything of yours get none.
   */
  const hostiles = [];
  /** The nearest boss within reach, Warlord or tyrant, on the long bar. */
  function placeBossBar() {
    let best = null, bestD = 260;
    for (const mk of mechs.active) {
      if (!mk.alive || mk.demon !== 'warlord' || mk.health <= 0) continue;
      const d = Math.hypot(mk.x - player.x, mk.z - player.z);
      if (d < bestD) { bestD = d; best = mk; }
    }
    if (!best) {
      for (const sd of soldiers.active) {
        if (!sd.alive || sd.demon !== 'tyrant' || sd.health <= 0 || sd.state === 5) continue;
        const d = Math.hypot(sd.x - player.x, sd.z - player.z);
        if (d < bestD) { bestD = d; best = sd; }
      }
    }
    const show = !!best && state.mode === 'walk' && !photo.active;
    el.bossbar.classList.toggle('hidden', !show);
    if (!show) return;
    const warlord = best.demon === 'warlord';
    el.bossbar.classList.toggle('tyrant', !warlord);
    el.bossName.textContent = warlord ? 'The Warlord' : 'Tyrant';
    el.bossFill.style.transform = `scaleX(${Math.max(0, best.health / best.maxHealth).toFixed(4)})`;
  }

  function placeHealthBars() {
    placeBossBar();
    const wall = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, wall - (state.hbWall || wall)));
    state.hbWall = wall;
    if (photo.active) { healthBars.hide(); return; }
    hostiles.length = 0;
    for (const sd of soldiers.active) {
      if (!sd.alive || sd.civilian || sd.health <= 0 || sd.state === 5) continue;
      const sc = sd.scale || 1;
      // A boss has the long bar at the top of the screen instead.
      if (sd.demon === 'tyrant') continue;
      const kind = sd.demon === 'brute' ? 'jet' : sd.machine ? 'machine' : 'soldier';
      hostiles.push({ body: sd, kind,
        x: sd.x, y: sd.y + 2.15 * sc + (sd.demon ? 0.25 * sc : 0), z: sd.z, health: sd.health, max: sd.maxHealth });
    }
    for (const d of drones.active) {
      if (d.health <= 0) continue;
      hostiles.push({ body: d, kind: 'drone', x: d.x, y: d.y + (d.demon ? 1.8 : 0.9), z: d.z,
        health: d.health, max: d.maxHealth });
    }
    for (const j of jets.active) {
      if (!j.alive || j.health <= 0) continue;
      hostiles.push({ body: j, kind: 'jet', x: j.x, y: j.y + 2.6, z: j.z,
        health: j.health, max: j.maxHealth });
    }
    for (const mk of mechs.active) {
      if (mk.mine || mk.health <= 0 || mk.demon) continue;
      hostiles.push({ body: mk, kind: 'mech', x: mk.x, y: mk.y + mk.spec.height + 0.8, z: mk.z,
        health: mk.health, max: mk.maxHealth });
    }
    const eye = camera.position
      ? { x: camera.position[0], y: camera.position[1], z: camera.position[2] }
      : { x: player.x, y: player.y + PLAYER.eye, z: player.z };
    healthBars.update(hostiles, camera.viewProj, eye,
      (x, y, z) => world.lineOfSight(eye.x, eye.y, eye.z, x, y, z),
      dt, wall, window.innerWidth, window.innerHeight);
  }

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
      ? 'it flies where you look; W S throttle, A D turn, Space up, right mouse down, left mouse fires'
      : (near.spec.turret
        ? 'W forward, S back, A D steer, mouse lays the turret, Shift brake, left mouse fires'
        : 'W forward, S back, A D steer, Shift brake, left mouse fires');
    // You look where it is pointing. Before this the camera kept the heading
    // you had on foot, so a tank parked across your line of sight drove off
    // sideways or straight past you when you pressed forward, which reads as
    // reverse however the hull is actually moving.
    camera.yaw = near.yaw + (near.turret || 0);
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

  /**
   * The rows down the right, one per weapon the mech you are in carries.
   * Built again only when you climb into a chassis with a different set.
   */
  const armRows = [];
  let armRowsFor = null;
  function buildArmRows() {
    const m = state.inMech;
    const loadout = m ? m.loadout : [];
    if (armRowsFor === loadout) return;
    armRowsFor = loadout;
    armRows.length = 0;
    el.mechArms.textContent = '';
    for (let i = 0; i < loadout.length; i++) {
      const row = document.createElement('div');
      row.className = 'marm';
      const key = document.createElement('u');
      key.textContent = String((i + 1) % 10);
      const name = document.createElement('span');
      name.textContent = loadout[i].name;
      const ammo = document.createElement('b');
      ammo.textContent = String(loadout[i].magazine);
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
      + `1 to ${m.loadout.length} or the wheel changes weapon, Shift dashes, Y changes the view, `
      + 'E is the reflex, V is the travel map';
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
    // a side street: it is dropped. Asking for a Titan is asking for whichever
    // chassis is picked in the menu.
    if (type === 'titan') type = cheats.myMech();
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
      // Handed over at cruise, with the lever where cruise is.
      v.throttle = 0.6;
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
          'it flies where you look; W S throttle, A D turn, Space up, right mouse down, left mouse fires';
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
    const m = mechs.spawn(type, spot.x, spot.z, spot.a + Math.PI);
    // Eight metres of it does not walk round the corner: it arrives, the
    // same way the men do, in a sphere the size of the thing inside it.
    if (m && !m.mine) arriveAt(m.x, m.z, 4.4, 2.4);
    return m;
  }

  /**
   * Something arriving where there was nothing: a sphere of light standing on
   * the street, a scorch mark under it, and the crack of the air closing.
   *
   * @param {number} radius how big the sphere is
   * @param {number} scale how much of everything, for a machine over a man
   */
  function arriveAt(x, z, radius, scale = 1, tint = null) {
    const y = world.groundHeight(x, z);
    // Whatever just appeared on the street, the people on it do not wait to
    // find out what it is.
    soldiers.scare(x, z, 20 + radius * 9);
    effects.arrival(x, y, z, radius, scale, tint);
    renderer.addScar(x, y, z, radius * 1.1, 0.45);
    const away = Math.hypot(player.x - x, player.z - z);
    if (away < 140) audio.emp(away);
  }

  /**
   * Somewhere near you with room for eight metres of machine: loaded ground,
   * nothing within seven metres in any of the four directions, so it is not
   * dropped into a courtyard it cannot walk out of.
   *
   * @param {number} away how far out to look
   * @returns {{x,z,a}|null}
   */
  function mechSpot(away = 14, cx = player.x, cz = player.z) {
    // Several rings rather than one. A single ring at a fixed distance is a
    // coin toss in a street with anything in it: the first version of this
    // answered no about one call in three from a cratered square, and a
    // Titan that cannot be called because of where you happen to be standing
    // is a Titan you do not have.
    // And the room it asks for is given up a bit at a time. Seven metres
    // clear on four sides is a comfortable place to put one down; in a
    // street that has been shelled flat there may be nowhere like that at
    // all, and a machine that cannot be called because of where you happen
    // to be standing is a machine you do not have. So the first pass asks
    // for seven, the next for four and a half, the last for two and a half,
    // and below that it takes whatever loaded ground it can find.
    for (const clear of [7, 4.5, 2.5]) {
      for (const scale of [1, 0.7, 1.4, 1.9, 0.5, 2.4]) {
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2 + Math.random() * 0.2;
          const r = away * scale * (0.9 + Math.random() * 0.2);
          const x = cx + Math.cos(a) * r;
          const z = cz + Math.sin(a) * r;
          if (!placeable(x, z)) continue;
          let boxed = false;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (world.raycast(x, world.groundHeight(x, z) + 3.0, z, dx, 0, dz, clear)) {
              boxed = true; break;
            }
          }
          if (boxed) continue;
          return { x, z, a };
        }
      }
    }
    // Nothing anywhere near that has room. Take whatever ground will have
    // one, working outwards: a machine standing against a lamp post is a
    // machine, and no machine at all is a button that does nothing.
    for (let r = away; r <= away * 12; r *= 1.6) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2 + r;
        const x = player.x + Math.cos(a) * r;
        const z = player.z + Math.sin(a) * r;
        if (placeable(x, z)) return { x, z, a };
      }
    }
    return null;
  }

  /**
   * Is this somewhere a machine may be put down at all? Loaded ground, and
   * not the memorial: the layer refuses one there anyway, and a spot the
   * spawner is happy with that the layer then throws away is the same as no
   * spot, with the difference that nobody can see why.
   */
  function placeable(x, z) {
    return world.isLoaded(x, z);
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

  // Ultra plasma: the balls leave orbit through the ordinary projectile
  // layer, so they bounce off the real streets and go off through the same
  // blast every other weapon uses.
  ultra.launch = (from, v) => projectiles.launch(cheats.ultra.blast ? 'ultraBlast' : 'ultra', {
    x: from.x, y: from.y, z: from.z, vx: v.x, vy: v.y, vz: v.z,
    splash: cheats.ultra.blast ? ULTRA.blastSplash : ULTRA.splash, weapon: 'ultra',
  });
  ultra.onCharge = (seconds) => {
    audio.ultraCharge(seconds);
    toast('ultra plasma, charging');
    feed('<i>ultra plasma</i> charging');
  };
  ultra.onRain = () => {
    audio.explosion();
    state.flash = Math.max(state.flash, 0.25);
    feed(`<b>ultra plasma</b> ${ultra.left} inbound`);
  };
  ultra.onDone = (sent) => { feed(`<i>ultra plasma</i> ${sent} away`); };
  const ultraLive = () => {
    let n = 0;
    for (const b of projectiles.active) if (b.kind === 'ultra' || b.kind === 'ultraBlast') n++;
    return n;
  };

  // Void storm: the void cannon's ball from orbit. Each one carries the
  // cannon's reach with it, so it tears out at whoever it passes on the way
  // down and lands the way the cannon's own shot does.
  storm.launch = (from, v) => projectiles.launch('voidStorm', {
    x: from.x, y: from.y, z: from.z, vx: v.x, vy: v.y, vz: v.z,
    splash: VOID_STORM.splash, void: VOID_STORM.void, weapon: 'storm',
  });
  storm.onCharge = (seconds) => {
    audio.ultraCharge(seconds);
    toast('void storm, charging');
    feed('<i>void storm</i> charging');
  };
  storm.onRain = () => {
    audio.explosion();
    state.flash = Math.max(state.flash, 0.3);
    feed(`<b>void storm</b> ${storm.left} inbound`);
  };
  storm.onDone = (sent) => { feed(`<i>void storm</i> ${sent} away`); };
  const stormLive = () => {
    let n = 0;
    for (const b of projectiles.active) if (b.kind === 'voidStorm') n++;
    return n;
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
    if (cheats.overkill) overkill(s, dir);
    // The kill itself is credited by whoever made it, the same as any other,
    // because a gib is still one dead soldier and not two.
    return n;
  };

  // --- overkill -------------------------------------------------------------
  // The setting past the top of the gore menu, and deliberately out of all
  // proportion: the fighting games that stop the clock and put a word across
  // the screen when somebody is finished. Everything here is on top of the
  // burst the ordinary switches already made.
  const fountains = [];
  const OVERKILL_WORDS = ['OVERKILL', 'SPLATTER', 'TOTAL CARNAGE', 'NO MERCY', 'EXCESSIVE', 'MESSY'];
  const overkillRun = { streak: 0, at: -10, shown: 0 };
  function overkill(s, dir) {
    const floor = world.groundHeight(s.x, s.z);
    // The skeleton leaves the body the way the round was going, which is the
    // one picture everybody remembers from the games this is a nod to.
    gibs.bones(s.x, s.y + 0.9, s.z, dir, 3);
    // A second burst thrown up rather than out, so it comes back down over
    // everyone standing near for a second or two after the kill.
    gibs.burst(s.x, s.y, s.z, { x: 0, y: 0, z: 0 }, 4, 16);
    // And a fountain where they stood, on the render clock below.
    fountains.push({ x: s.x, y: floor, z: s.z, life: 2.8, max: 2.8, next: 0 });
    effects.stain(s.x, floor, s.z, 2.8, 60);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 7;
      const px = s.x + Math.cos(a) * r, pz = s.z + Math.sin(a) * r;
      effects.stain(px, world.groundHeight(px, pz), pz, 0.3 + Math.random() * 0.7, 60);
    }
    // Whatever wall is within nine metres gets sprayed: eight rays out at
    // chest height, and a burst of blood against every face one of them meets.
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.random() * 0.3;
      const hit = world.raycast(s.x, s.y + 1.2, s.z, Math.cos(a), 0, Math.sin(a), 9);
      if (!hit || hit.kind === 'ground') continue;
      effects.blood(hit.x + hit.nx * 0.15, hit.y, hit.z + hit.nz * 0.15, hit.nx, 0.15, hit.nz, 3);
    }
    // The clock stops for a beat, which is what makes the word land.
    state.goreStop = Math.max(state.goreStop, 0.5);
    effects.shake = Math.min(1, effects.shake + 0.35);
    const now = state.time;
    overkillRun.streak = now - overkillRun.at < 3 ? overkillRun.streak + 1 : 1;
    overkillRun.at = now;
    overkillRun.shown++;
    const word = OVERKILL_WORDS[(Math.random() * OVERKILL_WORDS.length) | 0];
    el.overkill.textContent = overkillRun.streak > 1 ? `${word} x${overkillRun.streak}` : word;
    el.overkill.classList.remove('show');
    // Read the layout once so the animation starts again from its first frame.
    void el.overkill.offsetWidth;
    el.overkill.classList.add('show');
    clearTimeout(overkill._t);
    overkill._t = setTimeout(() => el.overkill.classList.remove('show'), 1400);
    audio.overkill(overkillRun.streak);
  }
  function updateFountains(dt) {
    for (let i = fountains.length - 1; i >= 0; i--) {
      const f = fountains[i];
      f.life -= dt;
      if (f.life <= 0 || !cheats.bleeding) { fountains.splice(i, 1); continue; }
      f.next -= dt;
      if (f.next > 0) continue;
      f.next = 0.06;
      // Strongest at the start and dying away, the way a pulse does.
      const k = f.life / f.max;
      const pulse = 0.75 + 0.25 * Math.sin(f.life * 18);
      effects.blood(f.x, f.y + 0.3, f.z, (Math.random() - 0.5) * 0.25,
        (1.2 + 1.4 * k) * pulse, (Math.random() - 0.5) * 0.25, 1.2 + 2.2 * k);
    }
  }
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
    // Bones rather than rubble: what is standing there is a skeleton, and it
    // comes down as one. The dust is the ash going with it.
    gibs.bones(s.x, s.y + 0.6, s.z, { x: 0, y: 0, z: 0 }, 0.8 * cheats.goreScale);
    effects.dust(s.x, s.y + 0.4, s.z, 1.4);
    audio.treeFall(Math.hypot(player.x - s.x, player.z - s.z) + 60);
    feed('<b>crumbled</b>');
  };
  // Shot while it was still standing. Harder, louder and thrown the way the
  // bullet was going, and it counts for nothing: whoever that was has been
  // dead since the fire went through.
  soldiers.onShatter = (s, dir) => {
    gibs.bones(s.x, s.y + 0.9, s.z, dir, 1.4 * cheats.goreScale);
    effects.dust(s.x, s.y + 0.9, s.z, 1.1);
    effects.shake = Math.min(1, effects.shake + 0.05);
    audio.treeFall(Math.hypot(player.x - s.x, player.z - s.z) + 40);
    feed('<i>bones</i>');
  };
  // Terminator: the sphere stands on the street for a moment and he comes up
  // through it. The second it takes is in the soldier layer, which keeps him
  // under the pavement, blind and harmless, until he is on his feet.
  soldiers.onArrive = (s) => arriveAt(s.x, s.z, 1.7, 1);
  soldiers.onSlip = (s) => {
    toast('down he goes');
    feed('<b>slipped</b> on a banana');
    audio.swoosh(Math.hypot(player.x - s.x, player.z - s.z));
  };

  drones.onShot = (d, damage) => {
    if (combat.health <= 0) return;
    // A gazer does not shoot: it spits fire, which you can see coming.
    if (d.demon) { demonFire(d.x, d.y - 0.2, d.z, GAZER.fire, 1, 1.5); return; }
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

  // How many people are about the place in Just a Walk. Enough that a street
  // has somebody on it and a square has a few, and few enough that the pool
  // the soldiers come out of is not full of them when you call a squad in.
  const CIVILIANS = 10;

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
    // Every weapon, whatever the mode hands out: the wheel goes through all of
    // them, and switching it on loads them.
    if (cheats.everyWeapon && !weapon.everyWeapon) weapon.giveAll();
    weapon.everyWeapon = cheats.everyWeapon;
    // Switching the drones off stops them coming and takes down whatever is
    // already up, because an enemy frozen in the air is worse than no enemy.
    if (drones.enabled === cheats.noDrones) {
      drones.enabled = !cheats.noDrones;
      if (cheats.noDrones) drones.reset();
    }
    // What a blast is allowed to take with it. Both on is the game as it
    // ships; either one off stops that half of it from here on, and leaves
    // whatever has already come down exactly where it fell.
    demolition.buildings = cheats.wreckBuildings;
    demolition.ground = cheats.wreckGround;
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
    // Which mech is yours, and which of theirs: a chip per chassis, lit on
    // the one that is picked, with what it is for written under the row.
    for (const side of ['mine', 'foe']) {
      const host = side === 'mine' ? el.cheatMine : el.cheatFoe;
      const say = document.createElement('div');
      say.className = 'mechsay';
      const chips = [];
      // What it carries, said the way the menu talks: yours by its arms,
      // theirs by its gun.
      const FOE_GUN = { auto: 'a chaingun in bursts', shotgun: 'a shotgun', rail: 'a railgun',
        shell: 'a cannon', swarm: 'a swarm of small rockets', thermite: 'thermite', laser: 'a beam' };
      const armsLine = (row, which) => (which === 'mine'
        ? `Carries ${row.loadout.map((id) => (ARMS.find((a) => a.id === id) || { name: id }).name).join(', ')}.`
        : `Fires ${FOE_GUN[(row.gun && row.gun.kind) || 'auto']} and rockets.`);
      const show = () => {
        const id = cheats.mechs[side];
        for (const c of chips) c.el.classList.toggle('on', c.id === id);
        const row = CHASSIS.find((c) => c.id === id);
        say.textContent = row ? `${row.name}: ${row.role}. ${armsLine(row, side)}` : 'a different one every time';
      };
      const options = [...CHASSIS.map((c) => ({ id: c.id, label: c.name, note: c.role })),
        ...(side === 'foe' ? [{ id: 'random', label: 'Random', note: 'a different one every time' }] : [])];
      for (const o of options) {
        const b = document.createElement('button');
        b.className = 'chip';
        b.dataset.mech = `${side}:${o.id}`;
        b.textContent = o.label;
        b.title = o.note;
        b.addEventListener('click', () => {
          cheats.chooseMech(side, o.id);
          show();
          toast(side === 'mine' ? `${o.label} on the next titanfall` : `theirs: ${o.label.toLowerCase()}`);
        });
        host.appendChild(b);
        chips.push({ id: o.id, el: b });
      }
      host.appendChild(say);
      show();
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
   * and belongs to the same budget.
   *
   * @returns {number} how many actually arrived
   */
  /**
   * Rise of the Machines, while it is running: keep the streets populated,
   * drop warheads on the skyline, and hold the sky where the mode wants it.
   */
  /**
   * The floor of last resort, put under whatever district you are in.
   *
   * Nothing should ever see it: the streets, the parks and the water are all
   * above it and between them they cover the ground completely. What it is
   * for is the times when they do not. A gap in the ground mesh, a tile that
   * has not arrived yet, the void past the edge of a district, a hole left by
   * something that came down: all of those show the sky otherwise, and from
   * inside a city the sky at your feet reads as a white hole in the world
   * that flickers as you walk past it.
   *
   * Fourteen metres under the lowest ground in the district, which is three
   * metres deeper than the deepest crater this game can dig, so a crater is
   * still a crater and not a hole with a floor painted across it. It is
   * worked out once per district and costs two triangles a frame.
   */
  let bedrockFor = null;
  // The street you are standing in. Looked up four times a second rather than
  // every frame: it walks every named centreline in memory, and the answer
  // cannot change between two frames of walking anyway.
  let streetWas = null;
  let streetDue = 0;
  let streetFresh = 0;

  function updateStreetName(dt) {
    streetDue -= dt;
    if (streetFresh > 0) {
      streetFresh = Math.max(0, streetFresh - dt);
      if (streetFresh === 0) el.streetName.classList.remove('fresh');
    }
    if (streetDue > 0) return;
    streetDue = 0.25;
    // Wherever you are looking out of, which is a mech or a vehicle when you
    // are in one: the street under a Titan is the street it is standing in.
    const ride = state.inMech || state.inVehicle;
    const at = ride ? ride : player;
    const found = world.streetAt(at.x, at.z);
    const name = found ? found.name : null;
    if (name === streetWas) return;
    streetWas = name;
    el.streetName.classList.toggle('hidden', !name);
    if (!name) { el.streetName.classList.remove('fresh'); return; }
    el.streetName.textContent = name;
    // Up for a few seconds whenever it changes, which is the moment anybody
    // wants to read it, then back to the faint version that stays out of the
    // way of a shot.
    el.streetName.classList.add('fresh');
    streetFresh = 4.0;
  }

  function updateBedrock() {
    const entry = world.entryAt(player.x, player.z);
    // The loaded state is part of the key as well as the district: asked
    // before the bytes arrive, the ground answers nought everywhere, and a
    // floor worked out from that would stay at nought for a district built
    // on a hill.
    const key = entry
      ? `${entry.id}:${world.loaded(entry.id) ? (world.isOverflight(entry.id) ? 'lo' : 'in') : 'out'}`
      : null;
    if (bedrockFor === key) return;
    bedrockFor = key;
    if (!entry) { renderer.bedrock = null; return; }
    const b = entry.bounds;
    let low = Infinity;
    const n = 24;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = b.minX + (b.maxX - b.minX) * (i / n);
        const z = b.minZ + (b.maxZ - b.minZ) * (j / n);
        const g = world.groundHeight(x, z);
        if (Number.isFinite(g) && g < low) low = g;
      }
    }
    if (!Number.isFinite(low)) low = 0;
    // Out past the district's own edge as well, because the void beyond a
    // district you have not walked into yet is the same hole seen sideways.
    const pad = 1200;
    renderer.bedrock = {
      y: low - 14,
      minX: b.minX - pad, minZ: b.minZ - pad,
      maxX: b.maxX + pad, maxZ: b.maxZ + pad,
    };
  }

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
      spawnMech(cheats.foeMech(), MACHINES.mechFrom
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
        if (spawnMech(cheats.foeMech(), 60 + Math.random() * 60)) made++;
      } else if (kind === 'machines') {
        // The same soldier layer and the same spawner, and then the same one
        // line the end of the world mode uses to turn a soldier into one.
        const s = soldiers.spawnNear(player.x, player.z, 28, 90);
        if (s) { makeMachine(s, rollMechKiller()); made++; }
      } else if (kind === 'civilians') {
        // Nearer than the soldiers come in, because they are walking past
        // rather than arriving, and you asked to see them.
        if (soldiers.spawnCivilianNear(player.x, player.z, 12, 60)) made++;
      } else if (kind === 'demons') {
        // A pack: mostly ghouls, a brute, and something overhead.
        const which = i === 0 ? 'brute' : i === 1 ? 'gazer' : 'ghoul';
        if (spawnDemonNear(which, player.x, player.z, 24, 70)) made++;
      } else if (kind === 'warlord') {
        if (spawnWarlord(player.x, player.z, 40, 60)) made++;
      }
    }
    // The soldier layer's budget counts everybody in it, the people walking
    // past and the machines included, so it goes up with what was asked for
    // or the next squad is held back to make room for a passer by.
    if (kind === 'soldiers' || kind === 'machines' || kind === 'civilians' || kind === 'demons') {
      soldiers.budget = Math.max(soldiers.budget, soldiers.active.length);
    }
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
    } else if (id === 'ultra') {
      openMap('ultra');
      return;
    } else if (id === 'storm') {
      openMap('storm');
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
    ultra: {
      hint: 'Set how many, how wide, from where and how steep, then click the city. '
        + 'Wheel zooms, drag moves. Esc to think better of it.',
      armed: 'Enter to fire, Esc to cancel.',
      button: 'Fire',
    },
    storm: {
      hint: 'Set how many, how wide, from where and how steep, then click the city. '
        + 'Wheel zooms, drag moves. Esc to think better of it.',
      armed: 'Enter to fire, Esc to cancel.',
      button: 'Fire',
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
    targetMap.aim = { x: player.x, z: player.z, radius: aimRadius(mode), allowed: true, ...aimArrow(mode) };
    el.nukeTarget.classList.toggle('travel', mode === 'travel');
    el.ultraPanel.classList.toggle('hidden', mode !== 'ultra' && mode !== 'storm');
    if (mode === 'ultra' || mode === 'storm') showUltra();
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
      // The numbers are spent once it has fired or been cancelled, so they go
      // at once rather than riding the zoom back down.
      el.ultraPanel.classList.add('hidden');
      return;
    }
    state.targeting = false;
    state.mapPull = null;
    state.pendingNuke = null;
    targetMap.aim = null;
    el.nukeTarget.classList.add('hidden');
    el.targetConfirm.classList.add('hidden');
    el.ultraPanel.classList.add('hidden');
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
    state.pendingNuke = { x, z };
    const inside = countInside(x, z, radius);
    const u = state.mapMode === 'storm' ? cheats.storm : cheats.ultra;
    el.confirmWhere.textContent = state.mapMode === 'ion'
      ? `${away} m away. Three beams for ${Math.round(ION.charge)} seconds, `
        + `then ${radius} m of everything. ${inside} target${inside === 1 ? '' : 's'} inside.`
      : state.mapMode === 'ultra'
        ? `${away} m away. ${u.count} plasma balls over ${radius} m, from the `
          + `${compassName(u.bearing)} at ${u.tilt}\u00b0, after ${ULTRA.charge.toFixed(0)} seconds of charge. `
          + `${inside} target${inside === 1 ? '' : 's'} inside.`
        : state.mapMode === 'storm'
          ? `${away} m away. ${u.count} void balls over ${radius} m, from the `
            + `${compassName(u.bearing)} at ${u.tilt}\u00b0, after ${VOID_STORM.charge.toFixed(0)} seconds of charge. `
            + `${inside} target${inside === 1 ? '' : 's'} inside.`
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
    if (state.mapMode === 'ultra') {
      if (!ultra.fire(at.x, at.z, cheats.ultra)) {
        el.targetHint.textContent = ultra.active
          ? 'the last one is still coming down'
          : 'it cannot be fired there';
        return false;
      }
      cheats.used = true;
      applyCheats();
      closeTargeting();
      return true;
    }
    if (state.mapMode === 'storm') {
      if (!storm.fire(at.x, at.z, cheats.storm)) {
        el.targetHint.textContent = storm.active
          ? 'the last one is still coming down'
          : 'it cannot be fired there';
        return false;
      }
      cheats.used = true;
      applyCheats();
      closeTargeting();
      return true;
    }
    if (state.mapMode === 'ion') {
      if (!ion.fire(at.x, at.z)) {
        el.targetHint.textContent = ion.firing
          ? 'the cannon is already firing'
          : 'it cannot be fired there';
        return false;
      }
      cheats.used = true;
      applyCheats();
      closeTargeting();
      return true;
    }
    if (!dropNuke(at.x, at.z)) {
      el.targetHint.textContent = 'it cannot be dropped there';
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
    // The map says no to a district nobody has built, and so does the flight:
    // there is nothing there to land on, and the landing would hold for good.
    const target = world.entryAt(tx, tz);
    if (target && !world.isBuilt(target)) return false;
    travel.start({
      x: player.x, y: player.y + PLAYER.eye, z: player.z,
      yaw: camera.yaw, pitch: camera.pitch,
    }, {
      x: tx, y: world.groundHeight(tx, tz) + PLAYER.eye, z: tz,
      yaw: camera.yaw, pitch: -0.04,
    });
    state.travelTo = { x: tx, z: tz };
    state.mode = 'travel';
    // Up there the view runs to the horizon, so the tiles have to come up
    // much further out than they do in a street.
    tiles.setFlying(true);
    // The place you are flying to may be in a district that is not in memory,
    // and the flight is seven seconds of warning that you are coming. Start
    // fetching it now and bring the tiles in along the way, so the city is
    // there when you arrive rather than appearing around you afterwards.
    const far = target;
    if (far && (!world.loaded(far.id) || world.isOverflight(far.id))) {
      // The flight is the loading screen: it takes seven seconds and the
      // district lands inside that, so there is nothing to wait for at the
      // far end. If it does not, the landing holds in the air until it does.
      // Anything still falling where you are standing goes into the record
      // before you leave it behind.
      demolition.bakeAll();
      world.reloadFine(far.id).then(() => {
        tiles.uploadsPerFrame = 10000;
        tiles.updateResidency(tx, tz, loop.frame);
        tiles.uploadsPerFrame = 8;
        // What you took off from is let go by the streamer on the far side,
        // because by then it is a long way behind you. It used to be dropped
        // here by hand, on the rule that one district was all there was.
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
      // Loaded rather than entered: `enterOnly` drops every other district,
      // which is what the card used to be for. The streamer decides what is
      // let go now, by distance and by a memory ceiling, so walking back the
      // way you came finds the district you left still there.
      await world.loadDistrict(entry.id, (p) => {
        el.crossFill.style.width = `${Math.round(p * 100)}%`;
      });
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

  // How much city is held at once, and how far out it is fetched from.
  //
  // One district at a time was the old answer and it is what made crossing a
  // boundary a card and a wait. The world layer could always hold several,
  // and the only thing missing was anybody asking it to.
  //
  // The reach is measured to a district's box, so a neighbour starts coming
  // down while you are still nine hundred metres inside your own, which is a
  // couple of minutes of walking at this speed and far longer than the fetch.
  // The drop distance is much larger than the reach so that walking back and
  // forth over a boundary cannot thrash. The ceiling is on bytes rather than
  // on a count, because a district is anything from three to seventeen
  // megabytes.
  const STREAM = { reach: 900, drop: 2600, most: 6, bytes: 128e6, every: 0.5 };
  // And the same thing for a flight, which is a different problem. The
  // camera crosses the city at four hundred metres a second, so a circle of
  // nine hundred metres around it gives a district two seconds of warning
  // and most of them would land behind you. This reaches further, looks up
  // the line of the flight rather than in a circle, and asks more often.
  // It can afford to: an overflight bundle is under a megabyte.
  //
  // The reach is a little more than the distance the tiles come up from at
  // this height, because a tile with no district behind it is a hole in the
  // ground rather than a tile that is merely coarse.
  const FLIGHT = { reach: 2900, drop: 4200, most: 10, bytes: 128e6, every: 0.25, lead: 1400 };
  let streamDue = 0;
  // The ceiling is set for the standard city, where a district is three to
  // forty megabytes. A city built at tier 0 has districts of a hundred and
  // more, so the ceiling grows to three of its biggest: the one you are in,
  // the one you are walking towards and the one behind you. Never past a
  // gigabyte and a half, which is what a desktop browser will give a tab
  // without complaint.
  const holdBytes = (plan) => Math.min(1.5e9, Math.max(plan.bytes, 3 * world.heaviest));

  /**
   * The district streamer. Keeps the one you are in, the ones you are near,
   * and nothing past the drop distance, inside a memory ceiling.
   */
  function streamCity(x, z, dt = 0) {
    const here = world.idAt(x, z);
    el.district.textContent = world.nameAt(x, z) || 'Berlin';
    el.district.classList.toggle('loading', !!state.crossing);
    if (!here || state.crossing) return;
    // Which of the two builds a fresh fetch asks for. A flight crosses the
    // city at four hundred metres a second, which leaves a district a few
    // seconds between coming into reach and going past, and its own bundle
    // is between three and forty megabytes. The overflight bundle is a
    // twentieth of that and arrives. Walking never asks for it, which is
    // what keeps two districts you can walk between at the same tier.
    const flying = state.mode === 'travel';
    const variant = flying ? 'over' : 'fine';
    const plan = flying ? FLIGHT : STREAM;
    // In the air the circle is centred ahead of the camera, on the line it is
    // flying, so what comes down is the corridor rather than what is already
    // behind. Never past the far end, or the last few seconds would be spent
    // holding districts on the other side of where you are landing.
    let cx = x, cz = z;
    if (flying && state.travelTo) {
      const dx = state.travelTo.x - x, dz = state.travelTo.z - z;
      const away = Math.hypot(dx, dz);
      if (away > 1) {
        const step = Math.min(FLIGHT.lead, away);
        cx = x + (dx / away) * step;
        cz = z + (dz / away) * step;
      }
    }
    // Fetching is throttled: it walks the whole catalogue of eighty one
    // districts, and nothing it decides can change inside half a second of
    // walking, or a quarter of one of flying.
    streamDue -= dt;
    if (streamDue <= 0) {
      streamDue = plan.every;
      // The landing is held whatever the ceiling says, at the fine tier.
      const pin = flying && state.travelTo ? world.idAt(state.travelTo.x, state.travelTo.z) : null;
      world.keepAround(cx, cz, plan.reach, plan.drop, plan.most, holdBytes(plan), variant, pin);
    }
    // And if you are somehow standing on ground that is not in yet, which is
    // a fast travel or a deep link rather than a walk, the card is still
    // there to wait behind.
    // Flying over ground that is not in yet is not a reason to stop the
    // flight and raise the card. What has to be stood on is the far end, and
    // beginTravel asked for that at the fine tier before the take off.
    if (!world.loaded(here)) {
      if (state.mode !== 'travel') crossInto(x, z);
      return;
    }
    // Arriving somewhere new. This used to happen inside the card, which was
    // also the only place that knew you had changed district; now that you
    // can walk across without one, the arrival is noticed here instead.
    if (state.districtIn !== here) {
      const first = state.districtIn === null;
      state.districtIn = here;
      // A district with no jeep in it is a district you have to walk out of.
      // The ones you left behind are two kilometres away and are let go with
      // the pool; this parks a set around wherever you came out.
      if (!first && state.mode === 'walk') parkVehicles({ x, z });
    }
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
    if (mode === 'ultra') return cheats.ultra.radius;
    if (mode === 'storm') return cheats.storm.radius;
    return nukeRadius();
  }

  /** The way ultra plasma or the void storm comes in, for the arrow the map draws. */
  function aimArrow(mode) {
    const u = mode === 'ultra' ? cheats.ultra : mode === 'storm' ? cheats.storm : null;
    return u ? { bearing: u.bearing, tilt: u.tilt } : {};
  }

  // The four numbers, on the map while it is up for ultra plasma. Each one
  // moves the circle or the arrow as it is dragged, and a point already
  // picked is asked about again with the new numbers.
  // The void storm uses the same panel with its own four numbers, and no
  // blast switch: a void ball is already the hard kind.
  const ultraRows = {};
  const rainMode = () => (state.mapMode === 'storm' ? 'storm' : 'ultra');
  function showUltra() {
    const mode = rainMode();
    const u = mode === 'storm' ? cheats.storm : cheats.ultra;
    const spec = mode === 'storm' ? VOID_STORM : ULTRA;
    const toggle = document.getElementById('ultrablast');
    if (toggle) {
      toggle.checked = !!u.blast;
      toggle.closest('label').classList.toggle('hidden', mode === 'storm');
    }
    for (const key of Object.keys(ultraRows)) {
      const row = ultraRows[key];
      const [lo, hi] = spec.limits[key];
      row.slider.min = String(lo);
      row.slider.max = String(hi);
      if (key === 'count') row.name.textContent = mode === 'storm' ? 'Void balls' : 'Plasma balls';
      row.slider.value = String(Math.min(Number(row.slider.max), u[key]));
      if (row.box) row.box.value = String(u[key]);
      row.say.textContent = key === 'count' ? `${u.count}`
        : key === 'radius' ? `${u.radius} m`
          : key === 'bearing' ? `${u.bearing}\u00b0 ${compassName(u.bearing)}` : `${u.tilt}\u00b0`;
    }
  }
  function compassName(b) {
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8];
  }
  function setUltra(key, v) {
    const mode = rainMode();
    if (mode === 'storm') cheats.setStorm(key, v);
    else cheats.setUltra(key, v);
    showUltra();
    if (targetMap.aim) {
      targetMap.aim = { ...targetMap.aim, radius: aimRadius(mode), ...aimArrow(mode) };
    }
    if (state.pendingNuke) armNuke(state.pendingNuke.x, state.pendingNuke.z);
    else drawTargetMap();
  }
  for (const [key, label] of [['count', 'Plasma balls'], ['radius', 'Radius'],
    ['bearing', 'Coming in from'], ['tilt', 'Angle off the vertical']]) {
    const row = document.createElement('label');
    row.className = 'urow';
    row.dataset.ultra = key;
    const name = document.createElement('b');
    name.textContent = label;
    const say = document.createElement('span');
    const slider = document.createElement('input');
    slider.type = 'range';
    const [lo, hi] = ULTRA.limits[key];
    slider.min = String(lo);
    slider.max = String(hi);
    slider.step = '1';
    slider.addEventListener('input', () => setUltra(key, slider.value));
    row.append(name, say, slider);
    let box = null;
    if (key === 'count') {
      // The slider stops at its top; the box takes any number at all.
      box = document.createElement('input');
      box.type = 'number';
      box.min = '1';
      box.step = '1';
      box.addEventListener('change', () => setUltra(key, box.value));
      row.append(box);
    }
    el.ultraPanel.appendChild(row);
    ultraRows[key] = { slider, box, say, name };
  }
  // And which kind comes down: the rifle's plasma, or blast plasma.
  const blastRow = document.createElement('label');
  blastRow.className = 'urow toggle';
  const blastName = document.createElement('b');
  blastName.textContent = 'Blast plasma';
  const blastSay = document.createElement('span');
  blastSay.textContent = 'harder, orange, no bounce, ten times the harm';
  const blastToggle = document.createElement('input');
  blastToggle.type = 'checkbox';
  blastToggle.id = 'ultrablast';
  blastToggle.addEventListener('change', () => setUltra('blast', blastToggle.checked));
  blastRow.append(blastName, blastSay, blastToggle);
  el.ultraPanel.appendChild(blastRow);

  function aimAt(x, z) {
    const r = aimRadius(state.mapMode);
    targetMap.aim = {
      x, z, radius: r,
      allowed: true,
      ...aimArrow(state.mapMode),
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

  // --- the memorial ------------------------------------------------------------
  //
  // The field holds against everything from outside. Stand inside it and it
  // opens: what is in it can be broken like anything else in the city. Step
  // out and it closes, and everything in it is as it was: the stelae, the
  // ground, the scorch marks. It can be destroyed and it always comes back.
  function reachesField(site) {
    for (const f of combat.sanctuaries) {
      const reach = site.radius + (site.craterRadius || 0) * 2;
      if (Math.hypot(site.x - f.x, site.z - f.z) < f.radius + reach) return true;
    }
    return false;
  }

  function memorialStep() {
    if (!combat.sanctuaries.length) return;
    const inside = combat.inField(player.x, player.z);
    if (inside === !!combat.fieldOpen) return;
    // What is under it is taken down as it is before it can be touched.
    if (inside) for (const f of combat.sanctuaries) demolition.snapshotIn(f.x, f.z, f.radius);
    combat.fieldOpen = inside;
    world.fieldOpen = inside;
    renderer.field.open = inside;
    world.heightCache.clear();
    if (!inside) restoreMemorial();
  }

  /** Everything under the field back as it was. @returns {number} what was put back */
  function restoreMemorial() {
    let n = 0;
    for (const f of combat.sanctuaries) {
      for (const site of demolition.sites) {
        if (site.spared || !reachesField(site)) continue;
        site.spared = true;
        n++;
      }
      n += demolition.restoreIn();
      n += world.spareCraters(f.x, f.z, f.radius);
      n += renderer.clearScarsIn(f.x, f.z, f.radius);
      for (let i = burning.length - 1; i >= 0; i--) {
        if (Math.hypot(burning[i].x - f.x, burning[i].z - f.z) < f.radius) { burning.splice(i, 1); n++; }
      }
    }
    world.heightCache.clear();
    if (n) {
      // The field shows where it put things back, all round its edge.
      for (const f of combat.sanctuaries) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const x = f.x + Math.cos(a) * f.radius, z = f.z + Math.sin(a) * f.radius;
          renderer.field.struck(x, world.groundHeight(x, z) + 6, z, state.time, 1.6);
        }
      }
      audio.emp(30);
      toast('the memorial stands again');
      feed('<i>memorial</i> it cannot be destroyed, it will always come back');
    }
    state.memorialRestored = (state.memorialRestored || 0) + (n ? 1 : 0);
    return n;
  }

  /**
   * A blast that reaches the memorial lights its force field from the point
   * where it touched: the middle of the blast if it went off inside, the edge
   * of the field facing it if not. What it does to the memorial is nothing,
   * which is the demolition layer's business.
   */
  function strikeField(x, y, z, radius) {
    for (const f of combat.sanctuaries) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d >= f.radius + radius) continue;
      const at = d < f.radius ? { x, z } : { x: f.x + ((x - f.x) / d) * f.radius, z: f.z + ((z - f.z) / d) * f.radius };
      renderer.field.struck(at.x, Math.max(y, world.groundHeight(at.x, at.z) + 2), at.z,
        state.time, Math.min(3, Math.max(0.3, radius / 12)));
    }
  }

  /**
   * Nuke rain. One warhead every few seconds, somewhere you can see but not
   * where you are standing; the memorial's field takes any that land on it.
   * Because it has to pick a point that is allowed, it tries a handful and
   * gives this tick up rather than looping until it finds one.
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
    // Just a Walk means nothing is ever sent after you, and the tier is the
    // one thing that got round that. The budgets are held at nought at the
    // top of the step; the threat level is raised from inside combat.update,
    // which runs after it, and the jets' own update runs after that again. So
    // a section spawned by hand and then killed raised the tier, gave the
    // jets a budget of two, and a flight took off before the next step could
    // put the budget back. Which is what was reported: soldiers by hand in
    // Just a Walk, and then jets nobody asked for.
    if (state.peaceful || campaign.active) {
      drones.budget = 0;
      soldiers.budget = 0;
      jets.budget = 0;
      return;
    }
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

  // --- operations: Tactics and Slayer ---------------------------------------
  const builtDistricts = () => world.catalogue.filter((d) => world.isBuilt(d));
  const opsWord = () => (campaign.mode === 'slayer' ? 'nest' : 'camp');

  /** The setup under the mode buttons on the title card. */
  function showOps() {
    el.opsSetup.classList.toggle('hidden', !campaign.active);
    if (!campaign.active) return;
    const set = campaign.settings;
    for (const b of el.opsSetup.querySelectorAll('[data-scope]')) {
      b.classList.toggle('on', b.dataset.scope === set.scope);
    }
    const list = builtDistricts();
    if (el.opsStart.options.length !== list.length) {
      el.opsStart.textContent = '';
      for (const d of list) {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = d.name;
        el.opsStart.appendChild(o);
      }
    }
    el.opsStart.value = set.start && list.some((d) => d.id === set.start) ? set.start
      : (world.idAt(player.x, player.z) || world.home);
    const [lo, hi] = OPS[campaign.mode].perDistrictRange;
    el.opsCount.min = String(lo);
    el.opsCount.max = String(hi);
    el.opsCount.value = String(set.perDistrict[campaign.mode]);
    el.opsCountNum.textContent = String(set.perDistrict[campaign.mode]);
    el.opsCountLabel.textContent = `${opsWord() === 'nest' ? 'Nests' : 'Camps'} per district`;
    el.opsQuiet.checked = set.quietBonus;
    el.opsBosses.checked = set.bosses;
    for (const r of el.opsSetup.querySelectorAll('.opstactics')) r.classList.toggle('hidden', campaign.mode !== 'tactics');
    for (const r of el.opsSetup.querySelectorAll('.opsslayer')) r.classList.toggle('hidden', campaign.mode !== 'slayer');
    const sum = campaign.summary(list.map((d) => d.id));
    el.opsProgress.textContent = sum.total
      ? `${sum.free} of ${sum.total} ${opsWord()}s taken so far, ${sum.done} of ${sum.districts} `
        + `district${sum.districts === 1 ? '' : 's'} done, score ${sum.score.toLocaleString()}`
        + (sum.level ? `, level ${sum.level + 1}` : '')
      : `Nothing taken yet. The ${opsWord()}s are put down the first time you are in a district.`;
    el.opsWipe.textContent = 'start this campaign again';
  }
  for (const b of el.opsSetup.querySelectorAll('[data-scope]')) {
    b.addEventListener('click', () => { campaign.set('scope', b.dataset.scope); showOps(); });
  }
  el.opsStart.addEventListener('change', () => { campaign.set('start', el.opsStart.value); showOps(); });
  el.opsCount.addEventListener('input', () => { campaign.set('perDistrict', el.opsCount.value); showOps(); });
  el.opsQuiet.addEventListener('change', () => { campaign.set('quietBonus', el.opsQuiet.checked); });
  el.opsBosses.addEventListener('change', () => { campaign.set('bosses', el.opsBosses.checked); });
  el.opsWipe.addEventListener('click', () => {
    // Twice, so a stray click does not throw a campaign away.
    if (el.opsWipe.dataset.armed !== '1') {
      el.opsWipe.dataset.armed = '1';
      el.opsWipe.textContent = 'click again to wipe it';
      setTimeout(() => { el.opsWipe.dataset.armed = ''; showOps(); }, 3000);
      return;
    }
    el.opsWipe.dataset.armed = '';
    campaign.wipe();
    tactics.clear();
    slayer.clear();
    showOps();
  });

  /** A run starting: the start district, if one is set, is flown to once the intro is over. */
  function startOps() {
    tactics.clear();
    slayer.clear();
    state.opsEnded = false;
    state.opsEndAt = 0;
    state.opsStartedAt = state.time;
    if (!campaign.active) { el.ops.classList.add('hidden'); return; }
    if (!campaign.settings.start) campaign.set('start', el.opsStart.value || world.idAt(player.x, player.z) || world.home);
    state.opsTravel = true;
    state.opsPlaceAt = 0;
  }

  // --- the end of an operation ---------------------------------------------------
  //
  // Every camp or nest in scope taken: a card with what it came to, and the
  // question of what next, a new operation on the same settings or the
  // title screen.
  function opsEndCheck(dt) {
    if (state.opsEnded || !campaign.active) return;
    const sum = campaign.summary(builtDistricts().map((d) => d.id));
    if (!sum || !sum.districts || sum.done < sum.districts) { state.opsEndAt = 0; return; }
    // A moment for the last capture to be seen and heard first.
    state.opsEndAt = (state.opsEndAt || 0) + dt;
    if (state.opsEndAt < 2.5) return;
    state.opsEnded = true;
    showOpsEnd(sum);
  }

  function showOpsEnd(sum) {
    const slay = campaign.mode === 'slayer';
    const where = campaign.settings.scope === 'all' ? 'Berlin'
      : ((world.entryFor(campaign.settings.start) || {}).name || 'the district');
    el.opsEndTitle.textContent = slay ? 'The presence is broken' : 'Operation complete';
    el.opsEndText.textContent = slay
      ? `Not one nest is left in ${where}.`
      : `Every camp in ${where} is yours.`;
    const minutes = Math.max(0, Math.round((state.time - (state.opsStartedAt || 0)) / 60));
    const rows = [
      [slay ? 'Nests destroyed' : 'Camps taken', `${sum.free} of ${sum.total}`],
      ...(slay ? [] : [['Taken without an alarm', `${sum.quiet || 0}`]]),
      ['Level', `${(sum.level || 0) + 1}`],
      ['Score', `${sum.score}`],
      ['Time', `${minutes} min`],
    ];
    el.opsEndStats.innerHTML = rows.map(([k, v]) => `<li>${k}<b>${v}</b></li>`).join('');
    el.opsEnd.classList.remove('hidden');
    input.exitLock();
    audio.ultraCharge && audio.ultraCharge(0.6);
  }

  el.opsEndAgain.addEventListener('click', () => {
    el.opsEnd.classList.add('hidden');
    campaign.wipe();
    soldiers.reset();
    drones.reset();
    startOps();
    toast(campaign.mode === 'slayer' ? 'a new operation: the nests are back' : 'a new operation: the camps are manned again');
    if (!isTouch) input.requestLock();
  });
  // The title screen is where the page starts, so that is the way back to it:
  // everything in the run is left behind, the campaign book is kept.
  el.opsEndMenu.addEventListener('click', () => { location.reload(); });

  /** Somewhere on a road near the middle of a district, to land on. */
  function districtLanding(entry) {
    const b = entry.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    let best = null, bestD = Infinity;
    for (const r of (entry.sketch && entry.sketch.roads) || []) {
      for (let i = 0; i + 1 < r.length; i += 2) {
        const d = Math.hypot(r[i] - cx, r[i + 1] - cz);
        if (d < bestD) { bestD = d; best = { x: r[i], z: r[i + 1] }; }
      }
    }
    return best || { x: cx, z: cz };
  }

  /** Every step of a run in Tactics or Slayer. */
  function opsStep(dt) {
    // The shield coming up, for the parry, and the saw's fuel: these are the
    // Slayer weapons' and work in any mode that hands them out.
    const blocking = weapon.id === 'shieldsaw' && weapon.aiming;
    if (blocking && !state.blocking) state.blockAt = state.time;
    state.blocking = blocking;
    sawFuel(dt);
    if (!campaign.active) return;
    if (state.mode !== 'walk') return;
    if (state.opsTravel) {
      state.opsTravel = false;
      const e = world.entryFor(campaign.settings.start);
      if (e && world.isBuilt(e) && world.idAt(player.x, player.z) !== e.id) {
        const at = districtLanding(e);
        beginTravel(at.x, at.z);
        return;
      }
    }
    // Put the sites down in any district in scope that is in memory and has
    // none yet. One district a second at most: the search is a few hundred
    // raycasts.
    state.opsPlaceAt = (state.opsPlaceAt || 0) - dt;
    if (state.opsPlaceAt <= 0) {
      state.opsPlaceAt = 1;
      for (const id of world.loadedIds) {
        if (!campaign.inScope(id) || campaign.sitesIn(id) || world.isOverflight(id)) continue;
        const entry = world.entryFor(id);
        if (!entry) continue;
        const placed = campaign.place(id, (rand, clear) => campSpot(world, entry, rand, clear,
          (x, y, z) => combat.inField(x, z)));
        if (placed.length) feed(`<i>${entry.name}</i> ${placed.length} ${opsWord()}${placed.length === 1 ? '' : 's'}`);
        break;
      }
    }
    if (campaign.mode === 'slayer') slayer.update(dt, player);
    opsEndCheck(dt);
    if (campaign.mode === 'tactics') {
      soldiers.playerSpeed = Math.hypot(player.vx || 0, player.vz || 0);
      tactics.update(dt, player);
      // The siren, as loud as the nearest one that is going.
      let level = 0;
      for (const r of tactics.live.values()) {
        if (!r.alarm) continue;
        const d = Math.hypot(r.site.x - player.x, r.site.z - player.z);
        level = Math.max(level, Math.max(0, 1 - d / 500));
      }
      audio.siren(level);
    } else {
      audio.siren(0);
    }
  }

  // An arrow going into somebody: its own harm, three times over in the head,
  // and no noise at all.
  projectiles.onArrow = (b, hit) => {
    const row = WEAPONS[b.weapon] || WEAPONS.bow;
    const t = hit.target;
    const core = !!hit.core;
    const headRow = ARROW_HEADS[b.head];
    const dmg = (row.damage || 100) * (core ? (row.coreMultiplier || 1) : 1) * (weapon.damageScale || 1)
      * (headRow && headRow.damage !== undefined ? headRow.damage : 1);
    const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
    const dir = { x: b.vx / sp, y: 0, z: b.vz / sp };
    let killed = false;
    let kind = hit.actorKind;
    if (kind === 'soldier') {
      killed = soldiers.damage(t, dmg, dir);
      effects.blood(hit.x, hit.y, hit.z, dir.x, 0.3, dir.z, cheats.goreScale * (core ? 1.6 : 1));
    } else if (kind === 'drone') killed = drones.damage(t, dmg);
    else if (kind === 'jet') killed = jets.damage(t, dmg);
    else if (kind === 'mech') killed = mechs.damage(t, dmg * 0.25, core);
    else if (kind === 'vehicle') { vehicles.damage(t, dmg * 0.25); kind = null; }
    if (!kind) return;
    audio.hitMarker(core);
    showHitmarker(killed ? 'kill' : (core ? 'core' : ''));
    if (killed) creditTarget(t, core, kind);
  };

  /**
   * Somebody you can take down without a sound: a soldier within arm's reach,
   * in front of you, who has not been told about you and is not fighting.
   */
  function takedownTarget() {
    let best = null, bestD = 2.6;
    const fx = camera.forward[0], fz = camera.forward[2];
    const fl = Math.hypot(fx, fz) || 1;
    for (const s of soldiers.active) {
      if (!s.alive || s.civilian || s.health <= 0 || s.state === 5 || s.rise > 0) continue;
      // A demon reeling is a finisher, from further off and whatever it was doing.
      if (s.demon) {
        if (!(s.staggered > 0)) continue;
        const dx = s.x - player.x, dz = s.z - player.z;
        const d = Math.hypot(dx, dz) - 0.42 * (s.scale || 1);
        if (d > 3.2 || d > bestD + 0.6) continue;
        if ((dx * fx + dz * fz) / (fl * (Math.hypot(dx, dz) || 1)) < 0.4) continue;
        best = s; bestD = d;
        continue;
      }
      if (s.state !== 0) continue;
      if (s.post && s.post.alert) continue;
      const dx = s.x - player.x, dz = s.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      if ((dx * fx + dz * fz) / (fl * (d || 1)) < 0.55) continue;
      best = s; bestD = d;
    }
    return best;
  }

  /** The takedown itself. @returns {boolean} whether there was one to do */
  function takedown() {
    if (state.mode !== 'walk' || state.inVehicle || state.inMech) return false;
    const s = takedownTarget();
    if (!s) return false;
    const dx = s.x - player.x, dz = s.z - player.z;
    const d = Math.hypot(dx, dz) || 1;
    if (s.demon) {
      // A finisher: the demon goes, in pieces, and gives you health for it.
      soldiers.damage(s, 1e6, { x: dx / d, y: 0.3, z: dz / d });
      for (let i = 0; i < 3; i++) effects.blood(s.x, s.y + 1.2 * (s.scale || 1), s.z, dx / d, 0.6, dz / d, cheats.goreScale * 2);
      const got = Math.round(combat.heal(30));
      effects.shake = Math.min(1.2, effects.shake + 0.35);
      audio.roar(1, s.scale || 1);
      audio.hitMarker(true);
      feed(`<b>finisher</b> +${got} health`);
      creditTarget(s, true, 'soldier');
      state.finishers = (state.finishers || 0) + 1;
      return true;
    }
    // Silent: nobody hears it, but anybody who can see the body will find it.
    const killed = soldiers.damage(s, 9999, { x: dx / d, y: 0, z: dz / d });
    effects.blood(s.x, s.y + 1.3, s.z, dx / d, 0.2, dz / d, cheats.goreScale * 0.7);
    effects.shake = Math.min(1, effects.shake + 0.12);
    audio.gunshot('bow');
    feed('<b>takedown</b>');
    if (killed) creditTarget(s, true, 'soldier');
    state.takedowns = (state.takedowns || 0) + 1;
    return true;
  }

  // --- demons ----------------------------------------------------------------
  // Their fire is looking for you and nothing else, so the projectile layer
  // is told where you are.
  projectiles.player = player;

  /**
   * Fire from a demon at you: one ball or a volley, led a little to where you
   * are going, spread across a volley so it is a wall rather than a line.
   */
  function demonFire(x, y, z, fire, volley = 1, size = 1) {
    const chest = { x: player.x, y: player.y + 1.2, z: player.z };
    const d0 = Math.hypot(chest.x - x, chest.y - y, chest.z - z) || 1;
    const t = d0 / fire.speed;
    const aim = { x: chest.x + (player.vx || 0) * t * 0.6, y: chest.y, z: chest.z + (player.vz || 0) * t * 0.6 };
    for (let i = 0; i < volley; i++) {
      const off = volley > 1 ? (i - (volley - 1) / 2) * 1.6 : 0;
      const ax = aim.x + off * Math.cos(Math.atan2(aim.z - z, aim.x - x) + Math.PI / 2);
      const az = aim.z + off * Math.sin(Math.atan2(aim.z - z, aim.x - x) + Math.PI / 2);
      const dx = ax - x, dy = aim.y - y, dz = az - z;
      const l = Math.hypot(dx, dy, dz) || 1;
      projectiles.launch('fireball', {
        x, y, z,
        vx: dx / l * fire.speed, vy: dy / l * fire.speed + 0.6 * t, vz: dz / l * fire.speed,
        splash: { radius: fire.radius, damage: fire.damage }, weapon: 'demon',
      });
    }
    audio.whoomp(Math.hypot(player.x - x, player.z - z) / size);
  }

  projectiles.onHostile = (b, x, y, z, direct) => {
    // The shield saw held up: fire from in front is stopped, and fire that
    // arrives just as the shield comes up goes back the way it came.
    if (direct && weapon.id === 'shieldsaw' && weapon.aimBlend > 0.5 && !state.inMech && !state.inVehicle) {
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      const f = camera.forward;
      const facing = (b.vx * f[0] + b.vy * f[1] + b.vz * f[2]) / sp;
      const block = WEAPONS.shieldsaw.block;
      if (facing < block.cone) {
        for (let i = 0; i < 12; i++) effects.spark(x, y, z, 1.0, 0.75, 0.3);
        audio.hitMarker(true);
        if (state.time - (state.blockAt ?? -9) < block.parry) {
          const eye = { x: player.x, y: player.y + PLAYER.eye, z: player.z };
          projectiles.launch('blast', {
            x: eye.x + f[0] * 0.8, y: eye.y + f[1] * 0.8, z: eye.z + f[2] * 0.8,
            vx: f[0] * 70, vy: f[1] * 70, vz: f[2] * 70,
            splash: { radius: 2.4, damage: block.parryDamage, force: 6 }, weapon: 'shieldsaw',
          });
          feed('<b>parry</b>');
          state.parries = (state.parries || 0) + 1;
        } else {
          state.blocks = (state.blocks || 0) + 1;
        }
        return;
      }
    }
    const r = b.splash ? b.splash.radius : 2;
    effects.flash(x, y, z, r * 0.9, 1.0, 0.45, 0.08, 0.25);
    for (let i = 0; i < 14; i++) {
      effects.spark(x + (Math.random() - 0.5) * r, y + Math.random() * r * 0.6,
        z + (Math.random() - 0.5) * r, 1.0, 0.45 + Math.random() * 0.3, 0.05);
    }
    renderer.addScar(x, world.groundHeight(x, z), z, r * 0.45, 0.35);
    const toPlayer = Math.hypot(player.x - x, player.y + 1.0 - y, player.z - z);
    if (!direct && toPlayer > r) return;
    const dmg = (b.splash ? b.splash.damage : 15) * (direct ? 1 : 1 - toPlayer / r);
    if (state.inMech) mechs.damage(state.inMech, dmg * 2);
    else if (state.inVehicle) vehicles.damage(state.inVehicle, dmg * 2);
    else if (combat.health > 0) combat.hurt(dmg, x, z, player.x, player.z);
  };

  soldiers.onFireball = (s, fire) => {
    const sc = s.scale || 1;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    demonFire(s.x + fx * 0.6 * sc, s.y + 1.35 * sc, s.z + fz * 0.6 * sc, fire, fire.volley || 1, sc);
  };

  soldiers.onMelee = (s, melee) => {
    const d = Math.hypot(player.x - s.x, player.z - s.z);
    effects.shake = Math.min(1.4, effects.shake + 0.2 + (melee.slam ? 0.6 : 0));
    audio.roar(d, s.scale || 1);
    if (melee.slam) {
      // The tyrant brings both fists down: a ring of dust and whoever is
      // inside it takes the blow.
      effects.flash(s.x, s.y + 0.5, s.z, melee.slam, 1.0, 0.5, 0.15, 0.3);
      renderer.addScar(s.x, s.y, s.z, melee.slam * 0.5, 0.7);
      state.flash = Math.max(state.flash, 0.2);
    }
    if (state.inMech) { mechs.damage(state.inMech, melee.damage * 2); return; }
    if (state.inVehicle) { vehicles.damage(state.inVehicle, melee.damage * 2); return; }
    if (combat.health > 0) combat.hurt(melee.damage, s.x, s.z, player.x, player.z);
  };

  soldiers.onCharge = (s) => {
    audio.roar(Math.hypot(player.x - s.x, player.z - s.z), s.scale || 1);
  };

  /**
   * A demon out of the street near a point: a soldier, made one, coming up
   * through a portal of red and orange instead of the blue sphere; or a
   * drone, made the floating one, out of the same portal in the air.
   */
  const HELL = [1.0, 0.28, 0.06];
  function spawnDemonNear(kind, x, z, minR, maxR, level = 0) {
    if (kind === 'warlord') return spawnWarlord(x, z, minR, maxR, level);
    if (kind === 'gazer') {
      const d = drones.spawnNear(x, z, minR, maxR);
      if (d) {
        makeGazer(d, level);
        effects.arrival(d.x, d.y - 1.5, d.z, 2.4, 1.2, HELL);
      }
      return d;
    }
    const was = soldiers.onArrive;
    const big = kind === 'tyrant' ? 5.5 : kind === 'brute' ? 2.6 : 1.8;
    soldiers.onArrive = (s) => arriveAt(s.x, s.z, big, kind === 'tyrant' ? 2 : 1, HELL);
    const s = soldiers.spawnNear(x, z, minR, maxR);
    soldiers.onArrive = was;
    if (s) makeDemon(s, kind, level);
    return s;
  }

  // Slayer's nests in play.
  const slayer = new Slayer(campaign, world,
    (kind, x, z, min, max, level) => spawnDemonNear(kind, x, z, min, max, level),
    (b) => {
      if (b.demon === 'gazer' || b.demon === 'warlord') {
        b.alive = false;
        const pool = b.demon === 'gazer' ? drones.active : mechs.active;
        const i = pool.indexOf(b);
        if (i >= 0) pool.splice(i, 1);
      } else {
        soldiers._retire(b);
      }
    });
  slayer.onWake = (site) => {
    toast('the nest wakes');
    feed(`<b>nest</b> ${world.nameAt(site.x, site.z)} wakes`);
    audio.roar(Math.hypot(player.x - site.x, player.z - site.z), 2.5);
  };
  slayer.onWave = (site, run) => {
    const last = run.wave === run.waves.length - 1;
    const word = run.final && last ? 'the ground is shaking. The Warlord comes'
      : run.boss && run.waves[run.wave].tyrant ? 'something very large is coming'
        : `wave ${run.wave + 1} of ${run.waves.length}`;
    toast(word);
  };
  // The last nest of the whole operation keeps the Warlord for the end.
  slayer.isFinal = (site) => {
    if (campaign.settings.scope !== 'all') return true;
    const sum = campaign.summary(builtDistricts().map((d) => d.id));
    return !!sum && sum.done >= sum.districts - 1;
  };
  slayer.onHeavy = (site, run, kind, b) => {
    if (kind === 'warlord') return;
    feed(`<b>${DEMON[kind] ? DEMON[kind].name : 'Gazer'}</b> inbound`);
    if (kind === 'tyrant') { audio.roar(Math.hypot(player.x - b.x, player.z - b.z), 3.5); effects.shake = 1.2; }
  };
  slayer.onReset = () => { toast('the nest calls them back'); };
  slayer.onFree = (site, pts) => {
    toast(`nest destroyed  +${pts}`);
    feed(`<b>nest destroyed</b> ${world.nameAt(site.x, site.z)} +${pts}`);
    combat.score += pts;
    audio.explosion();
    effects.flash(site.x, world.groundHeight(site.x, site.z) + 2, site.z, 8, 1.0, 0.4, 0.1, 0.6);
    state.flash = Math.max(state.flash, 0.3);
    const list = campaign.sitesIn(site.d) || [];
    if (list.length && list.every((x) => x.state === SITE.FREE)) {
      toast(`${world.nameAt(site.x, site.z)}: the presence is broken`);
      feed(`<b>${world.nameAt(site.x, site.z)}</b> is free of them`);
    }
  };

  // --- the Warlord ---------------------------------------------------------------
  //
  // Slayer's great boss walks on a mech's legs and is hit like one, so the
  // mech layer does its walking, aiming and firing. What is its own is here:
  // the way it arrives, the two times it calls its own when it is hurt, the
  // ring along the ground when both hooves come down, and how it dies.
  const WARLORD_PHASES = [
    { at: 0.66, summon: { ghoul: 4, gazer: 1 }, faster: 1.2, say: 'the Warlord calls its own' },
    { at: 0.33, summon: { ghoul: 3, brute: 2, gazer: 1 }, faster: 1.45, say: 'the Warlord is enraged' },
  ];
  const WARLORD_POINTS = 25000;
  const quakes = [];

  function spawnWarlord(x, z, minR, maxR, level = 0) {
    // Out of a ring round the point, or, asked for none, on the point.
    const spot = maxR > 0 ? mechSpot((minR + maxR) / 2, x, z) : { x, z };
    if (!spot) return null;
    const yaw = Math.atan2(-(player.x - spot.x), -(player.z - spot.z));
    const m = mechs.spawn('warlord', spot.x, spot.z, yaw);
    if (!m) return null;
    m.demon = 'warlord';
    m.health = m.maxHealth = MECH.warlord.health * (1 + DEMON_LEVEL * level);
    m.bossPhase = 0;
    m.quakeLeft = MECH.warlord.quake.every;
    m.rage = 0;
    arriveAt(m.x, m.z, 7.5, 3, HELL);
    audio.roar(Math.hypot(player.x - m.x, player.z - m.z), 4);
    effects.shake = Math.min(1.8, effects.shake + 1.2);
    feed('<b>Warlord</b> has come');
    return m;
  }

  /** The heavier half of a mech's step, for the Warlord: its phases and its quake. */
  function warlordStep(dt) {
    for (const m of mechs.active) {
      if (!m.alive || m.demon !== 'warlord' || m.health <= 0) continue;
      const left = m.health / m.maxHealth;
      const next = WARLORD_PHASES[m.bossPhase];
      if (next && left < next.at) {
        m.bossPhase++;
        m.rage = m.bossPhase / WARLORD_PHASES.length;
        // Faster on its feet and quicker between bursts, on a spec of its own.
        const base = MECH.warlord;
        m.spec = { ...m.spec, walk: base.walk * next.faster, torsoTurn: base.torsoTurn * next.faster,
          chaingun: { ...m.spec.chaingun, rest: base.chaingun.rest / next.faster },
          rockets: { ...m.spec.rockets, interval: base.rockets.interval / next.faster } };
        toast(next.say);
        audio.roar(Math.hypot(player.x - m.x, player.z - m.z), 4);
        effects.shake = Math.min(1.8, effects.shake + 0.9);
        effects.flash(m.x, m.y + 6, m.z, 14, 1.0, 0.3, 0.05, 0.5);
        for (const [kind, n] of Object.entries(next.summon)) {
          for (let i = 0; i < n; i++) {
            const b = spawnDemonNear(kind, m.x, m.z, 8, 26, 0);
            // Counted with the nest it came out of, if there is one.
            if (b && m.nest) {
              const r = slayer.live.get(m.nest);
              if (r) { r.demons.add(b); r.total++; b.nest = m.nest; }
            }
          }
        }
      }
      // Both hooves down: a ring along the ground, which a jump clears.
      const q = m.spec.quake;
      const away = Math.hypot(player.x - m.x, player.z - m.z);
      m.quakeLeft -= dt;
      if (m.quakeLeft <= 0 && away < q.near && m.stun <= 0) {
        m.quakeLeft = q.every / (1 + 0.3 * m.bossPhase);
        quakes.push({ x: m.x, y: m.y, z: m.z, r: m.spec.radius, spec: q, hit: false, puff: 0 });
        audio.explosion();
        effects.shake = Math.min(1.8, effects.shake + 0.7);
        effects.dust(m.x, m.y, m.z, 6);
        renderer.addScar(m.x, m.y, m.z, 5, 0.5);
      }
    }
    for (let i = quakes.length - 1; i >= 0; i--) {
      const w = quakes[i];
      w.r += w.spec.speed * dt;
      // Grit and sparks thrown up along the front of it.
      w.puff -= dt;
      if (w.puff <= 0) {
        w.puff = 0.05;
        const n = Math.round(10 + w.r * 0.8);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + Math.random() * 0.2;
          const px = w.x + Math.cos(a) * w.r, pz = w.z + Math.sin(a) * w.r;
          effects.spark(px, world.groundHeight(px, pz) + 0.3, pz, 1.0, 0.45, 0.08);
        }
      }
      const d = Math.hypot(player.x - w.x, player.z - w.z);
      if (!w.hit && Math.abs(d - w.r) < 1.4 && player.onGround && combat.health > 0
        && !state.inMech && !state.inVehicle) {
        w.hit = true;
        combat.hurt(w.spec.damage, w.x, w.z, player.x, player.z);
        effects.shake = Math.min(1.8, effects.shake + 0.6);
      }
      if (w.r > w.spec.reach) quakes.splice(i, 1);
    }
  }

  /** And how it goes: in fire rather than in a reactor. */
  function warlordDown(m) {
    const g = world.groundHeight(m.x, m.z);
    explode(m.x, g + 4, m.z, { radius: 14, damage: 160, crater: true }, { weapon: 'warlord' });
    effects.flash(m.x, g + 6, m.z, 30, 1.0, 0.3, 0.05, 1.2);
    effects.arrival(m.x, g, m.z, 9, 3, HELL);
    gibs.rubble(m.x, g + 3, m.z, 12, 20, 2.6);
    fires.ignite(m.x, g, m.z, 14, 1);
    audio.roar(Math.hypot(player.x - m.x, player.z - m.z), 5);
    effects.shake = Math.min(2.0, effects.shake + 1.4);
    state.flash = Math.max(state.flash, 0.5);
    combat.score += WARLORD_POINTS;
    if (campaign.mode === 'slayer') {
      campaign.book.score += WARLORD_POINTS;
      campaign.save();
    }
    toast(`the Warlord is dead  +${WARLORD_POINTS}`);
    feed(`<b>Warlord down</b> +${WARLORD_POINTS}`);
    state.warlordKills = (state.warlordKills || 0) + 1;
  }

  // --- the Slayer weapons -------------------------------------------------------
  /** Everything hostile within reach of you, in front, that a wall does not hide. */
  function inReach(reach, arc) {
    const fx = camera.forward[0], fz = camera.forward[2];
    const fl = Math.hypot(fx, fz) || 1;
    const eye = { x: player.x, y: player.y + PLAYER.eye, z: player.z };
    const out = [];
    for (const s of soldiers.active) {
      if (!s.alive || s.civilian || s.health <= 0 || s.state === 5 || s.rise > 0) continue;
      const dx = s.x - player.x, dz = s.z - player.z;
      const d = Math.hypot(dx, dz) - 0.42 * (s.scale || 1);
      if (d > reach) continue;
      if ((dx * fx + dz * fz) / (fl * (Math.hypot(dx, dz) || 1)) < arc) continue;
      if (!world.lineOfSight(eye.x, eye.y, eye.z, s.x, s.y + 1.0, s.z)) continue;
      out.push({ kind: 'soldier', t: s, d });
    }
    for (const g of drones.active) {
      if (!g.alive || g.health <= 0) continue;
      const dx = g.x - player.x, dz = g.z - player.z;
      const d = Math.hypot(dx, g.y - eye.y, dz) - g.radius;
      if (d > reach) continue;
      if ((dx * fx + dz * fz) / (fl * (Math.hypot(dx, dz) || 1)) < arc) continue;
      out.push({ kind: 'drone', t: g, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  weapon.onMelee = (spec, eye, dir) => {
    if (spec.fuel) {
      // The saw takes the nearest thing in front of you, if it has the fuel
      // for something that size.
      const near = inReach(spec.reach, 0.5)[0];
      if (!near) { audio.saw(0.25); return; }
      const t = near.t;
      const size = t.demon === 'tyrant' ? 99 : t.demon === 'brute' ? 2 : 1;
      if (size > 3) { toast('too big for the saw'); return; }
      if (weapon.ammo < size) { toast(`the saw needs ${size} fuel`); audio.dryFire(); return; }
      weapon.ammo -= size;
      audio.saw(0.8);
      const dx = t.x - player.x, dz = t.z - player.z, dl = Math.hypot(dx, dz) || 1;
      const killed = near.kind === 'drone' ? drones.damage(t, 1e6)
        : soldiers.damage(t, 1e6, { x: dx / dl, y: 0.4, z: dz / dl });
      for (let i = 0; i < 4; i++) effects.blood(t.x, t.y + 1.1, t.z, dx / dl, 0.5, dz / dl, cheats.goreScale * 2.5);
      effects.shake = Math.min(1.4, effects.shake + 0.4);
      // Ammunition everywhere: some of every reserve back.
      const got = weapon.resupply(0.5, 0.35);
      feed(`<b>chainsaw</b> +${got} rounds`);
      if (killed) creditTarget(t, false, near.kind);
      return;
    }
    // The flail: everything in the arc.
    const hits = inReach(spec.reach, spec.arc);
    effects.shake = Math.min(1, effects.shake + 0.15);
    audio.swoosh(0);
    for (const h of hits) {
      const t = h.t;
      const dx = t.x - player.x, dz = t.z - player.z, dl = Math.hypot(dx, dz) || 1;
      const amount = spec.damage * (weapon.damageScale || 1);
      const killed = h.kind === 'drone' ? drones.damage(t, amount)
        : soldiers.damage(t, amount, { x: dx / dl, y: 0.2, z: dz / dl });
      effects.blood(t.x, t.y + 1.1, t.z, dx / dl, 0.3, dz / dl, cheats.goreScale);
      audio.hitMarker(false);
      showHitmarker(killed ? 'kill' : '');
      if (killed) creditTarget(t, false, h.kind);
    }
  };

  projectiles.onSaw = (b, hit) => {
    const t = hit.target;
    const amount = (WEAPONS.shieldsaw.damage || 150) * (weapon.damageScale || 1);
    const sp = Math.hypot(b.vx, b.vz) || 1;
    let killed = false;
    if (hit.actorKind === 'soldier') killed = soldiers.damage(t, amount, { x: b.vx / sp, y: 0, z: b.vz / sp });
    else if (hit.actorKind === 'drone') killed = drones.damage(t, amount);
    else if (hit.actorKind === 'mech') killed = mechs.damage(t, amount * 0.3, false);
    else if (hit.actorKind === 'jet') killed = jets.damage(t, amount);
    for (let i = 0; i < 10; i++) effects.spark(hit.x, hit.y, hit.z, 1.0, 0.8, 0.4);
    effects.blood(hit.x, hit.y, hit.z, b.vx / sp, 0.2, b.vz / sp, cheats.goreScale);
    audio.hitMarker(false);
    showHitmarker(killed ? 'kill' : '');
    if (killed) creditTarget(t, false, hit.actorKind);
  };
  projectiles.onSawBack = () => {
    weapon.carried.shieldsaw.ammo = 1;
    audio.hitMarker(true);
  };

  // Fuel for the saw comes back by itself, one pip at a time, up to one.
  function sawFuel(dt) {
    const slot = weapon.carried.chainsaw;
    if (!slot || slot.ammo >= 1) { state.fuelLeft = 15; return; }
    state.fuelLeft = (state.fuelLeft ?? 15) - dt;
    if (state.fuelLeft <= 0) { slot.ammo = 1; state.fuelLeft = 15; }
  }

  soldiers.onStagger = (s) => { if (Math.hypot(s.x - player.x, s.z - player.z) < 30) audio.roar(20, s.scale || 1); };

  soldiers.onSpot = (s, how) => { if (tactics.enabled) tactics.spot(s, how); };
  soldiers.onDown = (s) => { if (tactics.enabled) tactics.guardDown(s); };
  tactics.onSpotted = (site, run, guard, how) => {
    if (run.spotters.size === 1) {
      audio.spotted();
      feed(how === 'heard' ? '<i>they heard that</i>' : how === 'hit' ? '<i>he knows you are there</i>' : '<b>spotted</b>');
    }
  };
  tactics.onBody = () => { feed('<i>they found a body</i>'); };
  tactics.onAlarm = (site, run) => {
    toast(run.radioUp ? 'alarm: they are calling for help' : 'alarm, but the radio is down');
    feed(`<b>alarm</b> ${world.nameAt(site.x, site.z)}`);
  };
  tactics.onRadio = (site, run) => {
    const p = tactics.radioAt(site);
    effects.flash(p.x, p.y, p.z, 1.6, 1.0, 0.7, 0.4, 0.2);
    for (let i = 0; i < 24; i++) {
      effects.spark(p.x + (Math.random() - 0.5) * 0.6, p.y + Math.random() * 0.5,
        p.z + (Math.random() - 0.5) * 0.6, 1.0, 0.75, 0.35);
    }
    audio.hitMarker(true);
    feed(run.alarm ? '<b>radio down</b> nobody else is coming' : '<b>radio down</b>');
    toast('radio destroyed');
  };
  tactics.onBox = (site, run, wasSounding) => {
    const p = tactics.boxAt(site);
    effects.flash(p.x, p.y, p.z, 1.4, 1.0, 0.8, 0.2, 0.2);
    for (let i = 0; i < 18; i++) {
      effects.spark(p.x + (Math.random() - 0.5) * 0.5, p.y + Math.random() * 0.4,
        p.z + (Math.random() - 0.5) * 0.5, 1.0, 0.85, 0.3);
    }
    audio.hitMarker(true);
    feed(wasSounding ? '<b>alarm off</b> the siren is quiet' : '<b>alarm box down</b> they cannot sound the alarm');
    toast(wasSounding ? 'alarm silenced' : 'alarm disabled');
  };
  tactics.onCall = (site, run, count) => {
    // Help comes the way everybody arrives in this game: out of the street,
    // in a sphere, from a little way off, and it knows where you are.
    let n = 0;
    for (let i = 0; i < count; i++) {
      const s = soldiers.spawnNear(site.x, site.z, 45, 95);
      if (!s) break;
      s.state = 1;
      s.reinforcement = site.id;
      if ((site.level || 0) >= TACTICS.machinesFrom && i % 2 === 1) makeMachine(s);
      n++;
    }
    if (n) {
      feed(`<b>reinforcements</b> ${n} inbound`);
      toast(`${n} reinforcements inbound`);
    }
  };

  tactics.onFree = (site, pts, run) => {
    const quiet = !run.spotted && !run.alarm;
    toast(quiet && campaign.settings.quietBonus ? `camp taken, undetected  +${pts}` : `camp taken  +${pts}`);
    feed(`<b>camp taken</b> ${world.nameAt(site.x, site.z)} +${pts}`);
    audio.ultraCharge(0.5);
    combat.score += pts;
    const list = campaign.sitesIn(site.d) || [];
    if (list.length && list.every((x) => x.state === SITE.FREE)) {
      toast(`${world.nameAt(site.x, site.z)} is free`);
      feed(`<b>${world.nameAt(site.x, site.z)}</b> every camp taken`);
    }
  };

  /** The line at the top of the screen. */
  function opsHud() {
    if (!campaign.active || state.mode === 'title') { el.ops.classList.add('hidden'); return; }
    el.ops.classList.remove('hidden');
    const here = world.idAt(player.x, player.z);
    const list = (here && campaign.sitesIn(here)) || [];
    const free = list.filter((x) => x.state === SITE.FREE).length;
    const sum = campaign.summary(builtDistricts().map((d) => d.id));
    el.opsTitle.textContent = campaign.mode === 'slayer' ? 'Slayer' : 'Tactics';
    const fight = campaign.mode === 'slayer' ? slayer.active(player.x, player.z) : null;
    el.opsLine.textContent = !campaign.inScope(here)
      ? `outside the operation  ·  score ${sum.score.toLocaleString()}`
      : campaign.mode === 'slayer'
        ? `${world.nameAt(player.x, player.z)} presence ${Math.round(slayer.presence(here) * 100)}%  ·  `
          + (fight ? `wave ${Math.min(fight.wave + 1, fight.waves.length)}/${fight.waves.length}, ${slayer.left(fight)} left  ·  `
            : `${free}/${list.length} nests  ·  `)
          + `score ${sum.score.toLocaleString()}`
        : `${world.nameAt(player.x, player.z)} ${free}/${list.length} ${opsWord()}s  ·  `
          + `${sum.done}/${sum.districts} districts  ·  score ${sum.score.toLocaleString()}`;
    let alert = '';
    if (campaign.mode === 'tactics') {
      for (const r of tactics.live.values()) {
        if (!r.manned) continue;
        if (r.alarm) { alert = r.radioUp ? 'alarm' : 'alarm, radio down'; break; }
        if (r.spotted) alert = 'spotted';
      }
      if (!alert) {
        const w = tactics.wariest(player.x, player.z);
        if (w > 0.05) alert = `seen ${Math.round(w * 100)}%`;
      }
    }
    el.opsAlert.textContent = alert;
    el.opsAlert.dataset.level = alert.startsWith('seen') ? 'wary' : alert ? 'alarm' : '';
  }

  /** The journal on J: every district in the operation and how it stands. */
  function showOpsPanel() {
    const list = builtDistricts();
    const sum = campaign.summary(list.map((d) => d.id));
    el.opsPanelTitle.textContent = campaign.mode === 'slayer' ? 'Spree Fall Slayer' : 'Spree Fall Tactics';
    el.opsPanelLine.textContent = `Score ${sum.score.toLocaleString()}, level ${sum.level + 1}, `
      + `${sum.free} of ${sum.total} ${opsWord()}s taken`
      + (campaign.mode === 'tactics' ? `, ${sum.quiet} without an alarm.` : '.');
    el.opsList.textContent = '';
    for (const d of list) {
      if (!campaign.inScope(d.id)) continue;
      const sites = campaign.sitesIn(d.id);
      const row = document.createElement('div');
      const done = sites && sites.length && sites.every((x) => x.state === SITE.FREE);
      row.className = `opsd${done ? ' done' : ''}`;
      const name = document.createElement('span');
      name.textContent = d.name;
      const n = document.createElement('b');
      n.textContent = sites ? `${sites.filter((x) => x.state === SITE.FREE).length} / ${sites.length}` : 'not visited';
      row.append(name, n);
      el.opsList.appendChild(row);
    }
    el.opsReset.textContent = `give the ${opsWord()}s back`;
    el.opsHarder.textContent = 'give them back, harder';
  }
  function toggleOpsPanel(show) {
    if (!campaign.active || state.mode === 'title') return;
    const on = show === undefined ? el.opsPanel.classList.contains('hidden') : show;
    el.opsPanel.classList.toggle('hidden', !on);
    if (on) {
      showOpsPanel();
      state.lockWanted = state.lockWanted || input.pointerLocked;
      input.exitLock();
    } else {
      relock();
    }
  }
  el.opsClose.addEventListener('click', () => toggleOpsPanel(false));
  const giveBack = (harder) => {
    tactics.clear();
    slayer.clear();
    const n = campaign.reset({ harder });
    toast(harder ? `${n} ${opsWord()}s back, at level ${campaign.book.level + 1}` : `${n} ${opsWord()}s back`);
    showOpsPanel();
  };
  el.opsReset.addEventListener('click', () => giveBack(false));
  el.opsHarder.addEventListener('click', () => giveBack(true));

  function beginWalk() {
    el.title.classList.add('hidden');
    el.hud.classList.remove('hidden');
    startOps();
    landmarks.reset();
    combat.reset();
    drones.reset();
    weapon.reset();
    // Tactics and Slayer have a number row of their own.
    weapon.setKit(campaign.active ? campaign.mode : null);
    pickups.reset();
    gibs.clear();
    demolition.reset();
    fires.reset();
    cars.reset();
    renderer.clearCollapses();
    renderer.clearFires();
    effects.clear();
    audio.start();
    el.btnSound.textContent = 'sound on';
    if (deepLink) {
      state.mode = 'walk';
      state.walking = true;
    } else {
      intro.restart();
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
  const modeNow = () => (campaign.active ? campaign.mode
    : state.peaceful ? 'walk' : (machines.active ? 'machines' : 'berlin'));
  const showMode = () => {
    const now = modeNow();
    for (const b of modeButtons) b.classList.toggle('on', b.dataset.mode === now);
    el.modeNote.textContent = now === 'tactics'
      ? 'Armed camps across the city, to be taken one at a time. Take one without anybody raising the alarm for the bonus; break the radio and nobody comes to help them.'
      : now === 'slayer'
        ? 'The city has been overrun. Every district has nests that fill with demons as you fight; kill them all and the presence there is broken.'
        : now === 'machines'
      ? 'Warheads come down every few seconds, the sky is gone, and what walks the streets is steel with one red eye. G flame, V an EMP to stop them, then anything you like.'
      : now === 'walk'
        ? 'Nothing is hunting you. The whole of Berlin to walk about in, and the cheat menu to bring anything out by hand if you change your mind.'
        : 'A walk through the real city, with the real fight in it.';
    el.timePick.classList.toggle('hidden', now !== 'machines');
    applyMachineLook();
    showOps();
  };
  for (const b of modeButtons) {
    b.addEventListener('click', () => {
      state.peaceful = b.dataset.mode === 'walk';
      campaign.setMode(b.dataset.mode);
      try { localStorage.setItem('spreefall.walk', state.peaceful ? '1' : '0'); } catch { /* private mode */ }
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

  // The mode buttons sit in a row of the same class. They are not
  // difficulties, and counting them as such cleared their highlight the
  // moment one was clicked.
  const diffButtons = [...document.querySelectorAll('.difficulty .diff:not(.mode)')];
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
      mapTools();
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

  // --- the big map's controls ----------------------------------------------
  // The map you open with M could always be zoomed with the wheel, and that
  // was all it could do: it opens on a few hundred metres around you, the
  // whole of Berlin is zoom one, and there was no way back to it short of
  // twenty eight turns of the wheel. So it has the same three buttons the
  // targeting map has had since it was built, plus a readout of how far out
  // you are and how wide the window is in metres.
  // --- the compass and your own mark ----------------------------------------
  //
  // A mark is put down by clicking the big map, taken up by clicking it again
  // or with the button, and goes by itself once you are standing on it. A
  // click near a camp or nest puts the mark on it.
  const MARK_REACHED = 14;
  function setMark(at) {
    if (!at) { state.waypoint = null; minimap.waypoint = null; el.mapUnmark.classList.add('hidden'); return; }
    let x = at.x, z = at.z;
    if (campaign.active) {
      const snap = Math.max(25, minimap.spanAcross() * 0.02);
      for (const st of campaign.allSites()) {
        if (Math.hypot(st.x - x, st.z - z) < snap) { x = st.x; z = st.z; break; }
      }
    }
    state.waypoint = { x, z };
    minimap.waypoint = state.waypoint;
    el.mapUnmark.classList.remove('hidden');
    feed(`<i>mark</i> ${world.nameAt(x, z) || 'set'}, ${distanceLabel(Math.hypot(x - player.x, z - player.z))}`);
  }
  el.minimap.addEventListener('click', (ev) => {
    if (!minimap.big) return;
    const at = minimap.worldAt(ev.clientX, ev.clientY);
    if (!at) return;
    const w = state.waypoint;
    const near = Math.max(12, minimap.spanAcross() * 0.015);
    if (w && Math.hypot(w.x - at.x, w.z - at.z) < near) setMark(null);
    else setMark(at);
    mapTools();
  });
  el.minimap.addEventListener('contextmenu', (ev) => {
    if (!minimap.big) return;
    ev.preventDefault();
    setMark(null);
  });
  el.mapUnmark.addEventListener('click', () => setMark(null));

  /** The compass across the top, with the sites of an operation and your mark on it. */
  function placeCompass(heading) {
    if (state.mode !== 'walk' || photo.active || minimap.big) { compassBar.hide(); return; }
    const marks = [];
    let goal = null, goalSite = null;
    if (campaign.active) {
      let best = Infinity;
      for (const st of campaign.allSites()) {
        const dist = Math.hypot(st.x - player.x, st.z - player.z);
        const free = st.state === SITE.FREE;
        const m = { bearing: bearing(player.x, player.z, st.x, st.z), dist, free,
          hot: !free && isHot(st), kind: campaign.mode, goal: false };
        marks.push(m);
        if (!free && dist < best) { best = dist; goal = m; goalSite = st; }
      }
      if (goal) goal.goal = true;
    }
    minimap.goal = goalSite;
    const w = state.waypoint;
    if (w) {
      const dist = Math.hypot(w.x - player.x, w.z - player.z);
      if (dist < MARK_REACHED) {
        toast('you are there');
        setMark(null);
      } else {
        marks.push({ bearing: bearing(player.x, player.z, w.x, w.z), dist, free: false, hot: false,
          kind: 'mark', goal: true });
      }
    }
    compassBar.draw(heading, marks, state.time);
  }
  /** A camp with its alarm going, or a nest in a fight. */
  function isHot(site) {
    if (campaign.mode === 'slayer') {
      const r = slayer.live.get(site.id);
      return !!(r && r.phase !== 'idle');
    }
    const r = tactics.live.get(site.id);
    return !!(r && r.alarm);
  }

  function mapTools() {
    el.mapTools.classList.toggle('hidden', !minimap.big);
    if (!minimap.big) return;
    // A locked pointer belongs to the game, and while it is locked the canvas
    // takes every click: the buttons were there and could not be pressed.
    if (!photo.active) input.exitLock();
    const across = minimap.spanAcross();
    // How far out, and how wide the window is in metres. The second number is
    // the one that means anything standing in the city; the first is the one
    // that tells you the wheel did something.
    const wide = across >= 2000
      ? `${(across / 1000).toFixed(1)} km` : `${Math.round(across)} m`;
    el.mapZoom.textContent = `${minimap.zoom.toFixed(1)}x  ${wide} across`;
  }
  function mapZoomStep(factor) {
    const r = el.minimap.getBoundingClientRect();
    minimap.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
    mapTools();
  }
  el.btnMap.addEventListener('click', () => {
    minimap.toggle({ x: player.x, z: player.z });
    mapTools();
    if (!minimap.big && !isTouch && !photo.active) input.requestLock();
  });
  el.mapIn.addEventListener('click', () => mapZoomStep(1.5));
  el.mapOut.addEventListener('click', () => mapZoomStep(1 / 1.5));
  el.mapFit.addEventListener('click', () => { minimap.resetView(); mapTools(); });
  el.mapHere.addEventListener('click', () => {
    minimap.centre = { x: player.x, z: player.z };
    minimap.openSpan = 0;
    minimap.zoom = Math.max(minimap.zoom, 60);
    mapTools();
  });
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
        // Nought is the tenth, the way a number row runs out.
        const raw = Number(code.slice(5));
        const n = raw === 0 ? 10 : raw;
        const carried = state.inMech.loadout.length;
        if (n >= 1 && n <= carried) { mechs.selectArm(state.inMech, n - 1); return; }
        // A number past the end of the mech's loadout is not the pilot's
        // rifle. Six used to fall through to what the man inside is carrying
        // and put a banana on the screen of something eight metres tall.
        toast(`the ${state.inMech.spec.name} carries ${carried}`);
        return;
      }
      // And neither is any of the keys that reach over his shoulder.
      if (code === 'KeyZ' || code === 'KeyB' || code === 'KeyX'
        || code === 'KeyK' || code === 'KeyQ' || code === 'KeyT') return;
      // The view used to be on V, which is the travel map everywhere else in
      // the game, so climbing into a mech took free travel away from you.
      if (code === 'KeyY') { toggleCockpit(); return; }
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
      case 'KeyM':
        minimap.toggle({ x: player.x, z: player.z });
        mapTools();
        if (!minimap.big && !isTouch && !photo.active) input.requestLock();
        break;
      case 'KeyH': el.help.classList.toggle('hidden'); break;
      case 'KeyJ': toggleOpsPanel(); break;
      case 'KeyN': {
        const on = audio.toggle();
        el.btnSound.textContent = on ? 'sound on' : 'sound off';
        break;
      }
      case 'KeyR':
        // With the bow in hand R changes the head on the next arrow; the bow
        // nocks its own.
        if (weapon.spec.heads) weapon.cycleHead();
        else weapon.startReload();
        break;
      case 'KeyG':
        state.holstered = !state.holstered;
        toast(state.holstered ? 'weapon holstered' : 'weapon ready');
        break;
      case 'KeyF': if (!takedown()) toggleVehicle(); break;
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
    // The last one standing, going down slowly. A shade faster than a blast,
    // because what you are watching is a body rather than a building.
    if (state.killSlow > 0) {
      state.killSlow = Math.max(0, state.killSlow - dt);
      scale = Math.min(scale, 0.25);
    }
    if (state.goreStop > 0) {
      state.goreStop = Math.max(0, state.goreStop - dt);
      scale = Math.min(scale, 0.1);
    }
    // A Stinger in the air. Shallower than a blast, because you are still
    // flying the machine while you watch it.
    if (state.airSlow > 0) {
      state.airSlow = Math.max(0, state.airSlow - dt);
      scale = Math.min(scale, 0.34);
    }
    if (state.killRest > 0) state.killRest = Math.max(0, state.killRest - dt);
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
    updateBedrock();
    updateStreetName(dt);

    // A pilot whose machine is no longer there is put back on their feet.
    // Everything that takes a mech away in the ordinary course of things
    // tells the game first, so this never fires in a normal run; what it
    // catches is the machine going out from under you some other way, and
    // the alternative is piloting a mech that is not in the world any more,
    // which locks you out of your own weapons and the key to get out again.
    if (state.inMech && (!state.inMech.alive || !state.inMech.occupied)) {
      leaveMech(false);
    }

    // Just a Walk. The budgets are held at nought rather than the layers
    // switched off, so that anything the cheat menu brings out by hand is a
    // real enemy with a real fight in it; it simply is not replaced when it
    // goes down, and nothing is sent after you in the first place.
    // Tactics and Slayer send nothing after you either: what there is to
    // fight is in the camps and the nests, and the reinforcements a camp
    // calls are its own.
    if (state.peaceful || campaign.active) {
      drones.budget = 0;
      soldiers.budget = 0;
      jets.budget = 0;
    }
    // And who is about. A city with nobody hunting you is still a city with
    // people in it; one that is being shelled is not, and the ones who were
    // there have already gone.
    soldiers.civilianBudget = state.peaceful ? CIVILIANS : 0;

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
      voidTick(worldDt);
      gibs.update(worldDt);
      demolition.update(worldDt);
      fires.update(worldDt, player);
      fireWalls.update(worldDt);
      updateBurning(worldDt);
      updatePoison(worldDt);
      arrowTrails();
      updateReactors(worldDt);
      warlordStep(worldDt);
      memorialStep();
      updateCarBlasts();
      trains.update(worldDt, player);
      ion.update(worldDt);
      ultra.update(worldDt, ultraLive());
      storm.update(worldDt, stormLive());
      opsStep(worldDt);
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
      // The pilot's clock rather than the world's, the same way your legs
      // keep most of their speed on foot. A machine slowed by exactly as much
      // as everything around it is a reflex that does nothing at all, which
      // is how it felt from the cockpit.
      mechs.update(selfDt, { x: player.x, y: player.y, z: player.z }, controls);
      walkOverTrees();
      trampleUnderfoot(m);
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
      // In the air the keys turn the view, the same as the mouse does, and
      // the aircraft flies where the view is pointing. Right is a yaw that
      // goes down, the same as it is on foot.
      if (air && !photo.active && input.moveX) {
        camera.yaw -= input.moveX * 1.1 * selfDt;
      }
      const controls = {
        throttle: photo.active ? 0 : input.moveZ,
        steer: photo.active ? 0 : (air ? 0 : -input.moveX),
        // Where you are looking, which is where an aircraft goes, and where a
        // tank lays its turret.
        aimYaw: air && !photo.active ? camera.yaw : undefined,
        turretAim: v.spec.turret && !photo.active ? camera.yaw : undefined,
        aimPitch: air && !photo.active ? camera.pitch : undefined,
        pitch: 0,
        roll: 0,
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
      // Except on a tank, where the mouse lays the turret: the view stays
      // where you put it while the hull turns under it, and the turret works
      // its way round to it.
      if (!air && !v.spec.turret) camera.yaw += v.yaw - hullWas;
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
    // The cheat menu and the target map are both modal: the mouse belongs to
    // them, so nothing fires while either is up.
    const paused = state.targeting || !el.cheats.classList.contains('hidden');
    const holstered = state.holstered || photo.active
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
    voidTick(worldDt);
    gibs.update(worldDt);
    demolition.update(worldDt);
    fires.update(worldDt, player);
    fireWalls.update(worldDt);
    updateBurning(worldDt);
    updatePoison(worldDt);
    arrowTrails();
    updateReactors(worldDt);
    warlordStep(worldDt);
    memorialStep();
    updateCarBlasts();
    trains.update(worldDt, player);
    ion.update(worldDt);
    ultra.update(worldDt, ultraLive());
    storm.update(worldDt, stormLive());
    opsStep(worldDt);
    // The ones nobody is in still sit there and still burn.
    if (!state.inVehicle) vehicles.update(worldDt, null, state.time);
    // And the ones hunting you keep walking whether or not you are in one.
    if (!state.inMech) {
      mechs.update(worldDt, { x: player.x, y: player.y, z: player.z }, null);
      walkOverTrees();
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
      const landing = state.travelTo ? world.idAt(state.travelTo.x, state.travelTo.z) : null;
      // Whether the district is in, not whether there is a tile under the
      // exact spot: a tile with nothing in it is not in the bundle at all,
      // and on the live city a flight to the middle of the Hansaviertel held
      // over a tile like that for good, a few hundred metres up.
      if (p.finished && state.travelTo && landing
        && world.isBuilt(world.entryFor(landing))
        && (!world.loaded(landing) || world.isOverflight(landing))) {
        el.district.textContent = `landing in ${world.nameAt(state.travelTo.x, state.travelTo.z) || 'Berlin'}`;
        el.district.classList.add('loading');
        // Held up because what is under the landing is the coarse build.
        // The take off asked for the city and the memory ceiling can have
        // let it go again since, so ask once more rather than hold here for
        // good waiting on a fetch nobody started.
        if (landing && world.isOverflight(landing)) world.reloadFine(landing).catch(() => {});
      } else if (p.finished) {
        const at = state.travelTo;
        player.teleport(at.x, at.z);
        // Whatever you were sitting in comes with you. Leaving a mech
        // standing on the other side of Berlin because you used the map is
        // not travel, it is losing your mech.
        if (state.inMech) {
          const m = state.inMech;
          m.x = at.x; m.z = at.z;
          m.y = world.groundHeight(at.x, at.z);
          m.vx = 0; m.vy = 0; m.vz = 0;
        }
        state.prev = { x: at.x, y: player.y, z: at.z };
        state.curr = { x: at.x, y: player.y, z: at.z };
        camera.yaw = p.yaw;
        camera.pitch = p.pitch;
        state.mode = 'walk';
        el.hud.classList.remove('flying');
        travel.cancel();
        state.travelTo = null;
        tiles.setFlying(false);
        // The corridor is let go at the moment the flight ends. Those are
        // the coarse build, a walker must never be able to reach one, and
        // the streamer brings back whatever is near at the fine tier within
        // half a second.
        world.dropOverflight(world.idAt(at.x, at.z));
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
      // The title screen holds the first frame of the drone arc. It used to
      // sample the flight instead, which started its clock: read the title
      // for longer than the flight lasts and pressing play skipped straight
      // to the pavement.
      const p = state.dronePose || intro.pose(0);
      camera.position[0] = p.x;
      camera.position[1] = p.y;
      camera.position[2] = p.z;
      camera.yaw = p.yaw;
      camera.pitch = p.pitch;
    } else if (state.inMech && state.cockpit && state.inMech.spec.cockpit
      && !mechEyeBoxedIn(state.inMech)) {
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
    updateFountains(elapsed);
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
    // A reactor's flash is its own colour until the frame has come back.
    if (state.flash <= 0.001) state.flashTint = null;
    renderer.flashTint = state.flashTint || WHITE_FLASH;
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
      // A new shape for every shot: the flash going up again is a new shot.
      if (state.muzzle > (state.muzzleWas || 0) + 0.25) state.muzzleSeed = Math.random();
      state.muzzleWas = state.muzzle;
      renderer.viewmodel = {
        x: mix(hip.x, VM_AIM.x) + bobX + state.sway.x * 0.30,
        y: mix(hip.y, VM_AIM.y) + bobY - state.sway.y * 0.26 - hol * 0.34,
        z: mix(hip.z, VM_AIM.z) + kick * 0.030,
        pitch: mix(hip.pitch, VM_AIM.pitch) + kick * 0.075 - state.sway.y * 0.5 - hol * 0.95,
        yaw: mix(hip.yaw, VM_AIM.yaw) - state.sway.x * 0.8,
        roll: mix(hip.roll, VM_AIM.roll) + state.sway.x * 0.45 + hol * 0.5,
        muzzle: state.muzzle * (1 - hol),
        seed: state.muzzleSeed || 0,
        weapon: weapon.id,
      };
      renderer.actors.updateDrones(drones.active);
      renderer.actors.updateSoldiers(soldiers.active);
      renderer.actors.updateJets(jets.active);
      renderer.actors.updateProjectiles(projectiles.active);
      renderer.actors.updateSparks(effects.list);
      renderer.actors.updatePickups(pickups.live, camera.position);
      renderer.actors.updateGibs(gibs.active);
      renderer.actors.updateVehicles([...vehicles.active, ...trains.cars]);
      renderer.actors.updateMechs(mechs.active);
      renderer.actors.updateCamps(tactics.enabled ? tactics.drawList(player.x, player.z) : []);
      renderer.actors.updateNests(slayer.enabled ? slayer.drawList(player.x, player.z) : []);
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
      renderer.actors.updateVehicles(live ? [...vehicles.active, ...trains.cars] : []);
      renderer.actors.updateMechs(live ? mechs.active : []);
      renderer.actors.updateCamps(live && tactics.enabled
        ? tactics.drawList(camera.position[0], camera.position[2], 1600) : []);
      renderer.actors.updateNests(live && slayer.enabled
        ? slayer.drawList(camera.position[0], camera.position[2], 1600) : []);
      renderer.drawActors = live;
    }

    // The target map's zoom runs on the wall clock, here rather than in the
    // simulation, because the simulation is paused while the map is up.
    if (state.mapPull) stepMapPull(loop.stats.intervalMs / 1000);

    // Keep the city around whoever is being followed: the district they are
    // in, the ones within reach, and nothing beyond the drop distance. This
    // starts fetches and returns at once; tiles appear as the bytes land.
    streamCity(camera.position[0], camera.position[2], loop.stats.intervalMs / 1000);
    checkBoundary();
    tiles.updateResidency(camera.position[0], camera.position[2], loop.frame);
    // Dynamic resolution, fed the real cost of the last frame. When it decides
    // to move, the scene target is rebuilt at the new size; the page and the
    // interface never change.
    renderer.setCollapses(demolition.sites);
    renderer.setFires(fires.sites);
    if (renderer.updateDynamicScale(loop.stats.intervalMs)) resize();
    // Through a scope there is no rifle in the way of the picture.
    if (renderer.viewmodel && weapon.spec.scope && weapon.aimBlend > 0.85) renderer.viewmodel = null;
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
      placeGunMark();
      placeHealthBars();
      opsHud();
      // How far a blast plasma charge has got, under the crosshair while it
      // builds, and what it is once it is full.
      const charge = weapon.blastCharge;
      el.blastCharge.classList.toggle('hidden', !(charge > 0) || weapon.holstered);
      if (charge > 0) {
        el.blastCharge.textContent = charge >= 1 ? 'BLAST PLASMA READY'
          : `BLAST PLASMA ${Math.floor(charge * 100)}%`;
        el.blastCharge.classList.toggle('ready', charge >= 1);
      }
      showBuildingDamage();
      // Aiming narrows the field of view, which is most of what aiming is.
      camera.fov = 68 * DEG + (weapon.spec.aimFov * DEG - 68 * DEG) * weapon.aimBlend;
      // What you are standing next to. Vehicles were always here and F always
      // worked, but nothing on the screen said so, which is the same thing as
      // them not working.
      const near = (state.inVehicle || state.inMech) ? null
        : (mechs.nearest(player.x, player.z, 9) || vehicles.nearest(player.x, player.z, 7));
      // A man who has not seen you, within arm's reach, comes before any car.
      const quietKill = (state.inVehicle || state.inMech) ? null : takedownTarget();
      el.rideHint.classList.toggle('hidden', !near && !quietKill);
      if (quietKill) el.rideHintName.textContent = quietKill.demon ? 'Finish' : 'Takedown';
      else if (near) el.rideHintName.textContent = near.spec.name;
      // The scope: a picture of one, and no rifle in the way of it.
      const scoped = !!weapon.spec.scope && weapon.aimBlend > 0.85 && !weapon.holstered;
      el.scope.classList.toggle('hidden', !scoped);
      rideHud();
      mechHud();
    }

    if (state.mode === 'walk' || state.mode === 'landing' || state.mode === 'travel'
      || state.mode === 'cinema') {
      minimap.sites = campaign.active ? campaign.allSites() : null;
      minimap.siteKind = campaign.mode;
      minimap.draw(camera.position[0], camera.position[2], camera.yaw, landmarks.found,
        state.mode === 'title' ? null : pickups.live,
        vehicles.active.filter((v) => v.alive && !v.occupied && v.health > 0));
      if (minimap.big) mapTools();
      el.found.textContent = String(landmarks.foundInGoal);
      const deg = ((-camera.yaw * 180 / Math.PI) % 360 + 360) % 360;
      const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      el.compass.textContent = `${names[Math.round(deg / 45) % 8]} ${Math.round(deg)}`;
      placeCompass(deg);
    } else {
      compassBar.hide();
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
    combat, drones, weapon, effects, projectiles, reflex, jets, pickups, cheats, gibs, cars,
    trains, trainSpec: TRAIN,
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
    ultra, ultraSpec: ULTRA, ultraState: ULTRA_STATE,
    storm, stormSpec: VOID_STORM,
    takedown: () => takedown(), takedownTarget: () => takedownTarget(),
    demonSpec: DEMON, gazerSpec: GAZER,
    spawnDemon(kind, dx, dz, level = 0) {
      // Put down exactly where it was asked for, for a test that needs it there.
      if (kind === 'warlord') {
        return spawnWarlord(player.x + dx, player.z + dz, 0, 0, level);
      }
      if (kind === 'gazer') {
        const d = this.spawnDrone(dx, 8, dz);
        if (d) makeGazer(d, level);
        return d;
      }
      const s = this.spawnSoldier(dx, dz);
      if (s) makeDemon(s, kind, level);
      return s;
    },
    slayer, slayerSpec: SLAYER,
    warlordPhases: WARLORD_PHASES, quakes, warlordPoints: WARLORD_POINTS,
    placeHealthBars: () => placeHealthBars(),
    campaign, tactics, tacticsSpec: TACTICS, opsStep: (dt) => opsStep(dt), opsPanel: (on) => toggleOpsPanel(on),
    showOps: () => showOps(),
    startOps: () => startOps(),
    reactors, fusionSpec: FUSION,
    compassBar, setMark: (at) => setMark(at),
    toggleMap() { minimap.toggle({ x: player.x, z: player.z }); mapTools(); return minimap.big; },
    restoreMemorial: () => restoreMemorial(),
    poisonClouds, burningCount: () => burning.length,
    vehicles, vehicleSpec: VEHICLE,
    mechs, mechSpec: MECH, mechArms: ARMS,
    /** The arms the mech you are in carries, in the order the keys pick them. */
    get mechLoadout() { return state.inMech ? state.inMech.loadout : []; },
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
    get flightPlan() { return FLIGHT; },
    get streamCeiling() { return holdBytes(STREAM); },
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
      // On his feet at once. This one is the handle the tests put a man
      // exactly where they need him with; the sphere and the second it takes
      // to come up through it belong to the ways the game itself sends them.
      s.rise = 0;
      s.y = world.groundHeight(x, z);
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
    setAim(on) { input.secondary = !!on; },
    fireWalls,
    /**
     * The height of the ground as it is actually drawn at a point: the tile's
     * own triangles, the ones on the card, rather than the collision field.
     *
     * The two are meant to agree, and the whole reason a crater had to be
     * 55 m across was that at 12.5 m of ground quad they could not. This is
     * what lets a test say so in metres instead of by eye.
     *
     * @returns {number|null} metres, or null where nothing is drawn
     */
    /** The mesh a tile is drawn from, own buffer or district bytes. */
    tileMeshForTest(index) {
      const rec = world.tiles[index];
      return rec ? tileMesh(rec) : null;
    },
    drawnGround(x, z) {
      const index = world.tileIndex(x, z);
      if (index < 0) return null;
      const rec = world.tiles[index];
      if (!rec) return null;
      const m = tileMesh(rec);
      if (!m.vCount || !m.iCount) return null;
      const [ox, oz] = world.tileOrigin(index);
      const idx = m.i32
        ? new Uint32Array(m.buffer, m.iOff, m.iCount)
        : new Uint16Array(m.buffer, m.iOff, m.iCount);
      const at = (i) => {
        const o = m.vOff + i * VERTEX_STRIDE;
        return [
          m.view.getInt16(o, true) / POS_SCALE + ox,
          m.view.getInt16(o + 2, true) / POS_SCALE,
          m.view.getInt16(o + 4, true) / POS_SCALE + oz,
          m.view.getUint8(o + 17),
        ];
      };
      let best = null;
      for (let i = 0; i < idx.length; i += 3) {
        const a = at(idx[i]), b = at(idx[i + 1]), c = at(idx[i + 2]);
        if (!(a[3] & FACADE_FLAG.GROUND)) continue;
        // Barycentric, in the ground plane.
        const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(d) < 1e-6) continue;
        const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
        const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
        const w = 1 - u - v;
        if (u < -0.001 || v < -0.001 || w < -0.001) continue;
        const y = u * a[1] + v * b[1] + w * c[1];
        // The topmost ground under the point: a street drawn over a pavement
        // drawn over the base grid is three triangles deep in places.
        if (best === null || y > best) best = y;
      }
      return best;
    },
    /** A round into a parked car, for the tests. */
    hitCarForTest(x, z, damage) {
      return hitCar(x, world.groundHeight(x, z) + 0.9, z, damage);
    },
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
