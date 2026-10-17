// What you can carry. One table, because every difference between a rifle and a
// shotgun that matters to the game is a number, and the code that fires them is
// the same code.
//
// Hitscan weapons trace the real collision layer, so cover is cover: you cannot
// shoot anything through the Brandenburg Gate. Thrown and launched weapons hand
// off to the projectile layer, which walks the same geometry.

export const KIND = {
  HITSCAN: 'hitscan',   // traced the instant you pull
  LAUNCH: 'launch',     // leaves the muzzle fast and flat
  THROW: 'throw',       // leaves your hand on an arc
  PLACE: 'place',       // stuck where you put it, fired later
  STREAM: 'stream',     // pours while you hold it, and burns what it touches
};

/**
 * recoilKick is the impulse into the view spring, in radians a second.
 * recoilRetain is the share of that climb the view keeps once the spring has
 * settled: zero would be a laser, one would be the old bug where every shot
 * walked the aim into the sky and left it there.
 */
export const WEAPONS = {
  m16: {
    name: 'M16', short: 'M16', kind: KIND.HITSCAN, slot: 1,
    magazine: 30, reserve: 240, reloadTime: 1.55, fireInterval: 0.105, auto: true,
    damage: 34, coreMultiplier: 2.2, range: 320, pellets: 1,
    spreadHip: 0.016, spreadAim: 0.0035, spreadPerShot: 0.0055, spreadMax: 0.046,
    spreadRecover: 0.055,
    recoilKick: 0.0062, recoilSide: 0.0022, recoilRetain: 0.22,
    aimFov: 42, sound: 'rifle',
  },
  shotgun: {
    name: 'Shotgun', short: 'SHOTGUN', kind: KIND.HITSCAN, slot: 2,
    magazine: 8, reserve: 56, reloadTime: 2.6, fireInterval: 0.78, auto: false,
    damage: 13, coreMultiplier: 1.7, range: 72, pellets: 11,
    spreadHip: 0.075, spreadAim: 0.052, spreadPerShot: 0.004, spreadMax: 0.09,
    spreadRecover: 0.3,
    recoilKick: 0.021, recoilSide: 0.004, recoilRetain: 0.3,
    aimFov: 54, sound: 'shotgun',
  },
  rpg: {
    name: 'Rocket launcher', short: 'RPG', kind: KIND.LAUNCH, slot: 3,
    magazine: 1, reserve: 7, reloadTime: 2.9, fireInterval: 1.0, auto: false,
    projectile: 'rocket', muzzleSpeed: 52, range: 600,
    spreadHip: 0.006, spreadAim: 0.002, spreadPerShot: 0, spreadMax: 0.006,
    spreadRecover: 0.2,
    recoilKick: 0.026, recoilSide: 0.004, recoilRetain: 0.35,
    aimFov: 50, sound: 'rpg',
    splash: { radius: 9.5, damage: 165, force: 26 },
    // Hold the sight on something for lockTime and the rocket will chase it.
    lock: { time: 0.9, cone: 0.16, range: 320, turn: 4.5 },
  },
  grenade: {
    name: 'Grenade', short: 'GRENADE', kind: KIND.THROW, slot: 4,
    magazine: 1, reserve: 9, reloadTime: 0.75, fireInterval: 0.95, auto: false,
    projectile: 'grenade', muzzleSpeed: 24, fuse: 2.7, range: 120,
    spreadHip: 0.004, spreadAim: 0.001, spreadPerShot: 0, spreadMax: 0.004,
    spreadRecover: 0.2,
    recoilKick: 0.004, recoilSide: 0.001, recoilRetain: 0.1,
    aimFov: 58, sound: 'throw',
    splash: { radius: 8, damage: 135, force: 20 },
  },
  c4: {
    name: 'C4', short: 'C4', kind: KIND.PLACE, slot: 5,
    magazine: 1, reserve: 5, reloadTime: 0.9, fireInterval: 0.8, auto: false,
    projectile: 'c4', muzzleSpeed: 12, range: 60,
    spreadHip: 0.003, spreadAim: 0.001, spreadPerShot: 0, spreadMax: 0.003,
    spreadRecover: 0.2,
    recoilKick: 0.003, recoilSide: 0.001, recoilRetain: 0.1,
    aimFov: 58, sound: 'throw',
    splash: { radius: 11, damage: 240, force: 34 },
  },
  // The arena four. These come out of the tradition the deathmatch shooters
  // built: a rail shot that goes through everyone in the line, plasma you can
  // bounce round a corner, flak that fills a doorway, and darts that chase.
  // Names and numbers are ours, the ideas are the genre's.
  railgun: {
    name: 'Railgun', short: 'RAIL', kind: KIND.HITSCAN, slot: 7,
    magazine: 5, reserve: 25, reloadTime: 2.2, fireInterval: 1.35, auto: false,
    damage: 115, coreMultiplier: 1.8, range: 900, pellets: 1, pierce: 4,
    spreadHip: 0.009, spreadAim: 0, spreadPerShot: 0, spreadMax: 0.009,
    spreadRecover: 0.25,
    recoilKick: 0.018, recoilSide: 0.002, recoilRetain: 0.3,
    aimFov: 22, sound: 'rail', tracer: 'rail',
  },
  plasma: {
    name: 'Plasma rifle', short: 'PLASMA', kind: KIND.LAUNCH, slot: 8,
    magazine: 40, reserve: 200, reloadTime: 1.9, fireInterval: 0.11, auto: true,
    projectile: 'plasma', muzzleSpeed: 68, range: 300,
    spreadHip: 0.014, spreadAim: 0.005, spreadPerShot: 0.002, spreadMax: 0.03,
    spreadRecover: 0.1,
    recoilKick: 0.004, recoilSide: 0.0015, recoilRetain: 0.12,
    aimFov: 50, sound: 'plasma',
    splash: { radius: 2.6, damage: 34, force: 6 },
  },
  flak: {
    name: 'Flak cannon', short: 'FLAK', kind: KIND.LAUNCH, slot: 9,
    magazine: 6, reserve: 42, reloadTime: 2.5, fireInterval: 0.85, auto: false,
    projectile: 'flak', muzzleSpeed: 42, range: 160, shards: 7,
    spreadHip: 0.055, spreadAim: 0.035, spreadPerShot: 0.004, spreadMax: 0.07,
    spreadRecover: 0.3,
    recoilKick: 0.019, recoilSide: 0.004, recoilRetain: 0.28,
    aimFov: 54, sound: 'shotgun',
    splash: { radius: 3.4, damage: 42, force: 9 },
  },
  splinter: {
    name: 'Splinter gun', short: 'SPLINTER', kind: KIND.LAUNCH, slot: 0,
    magazine: 24, reserve: 120, reloadTime: 2.1, fireInterval: 0.13, auto: true,
    projectile: 'splinter', muzzleSpeed: 52, range: 220,
    spreadHip: 0.02, spreadAim: 0.008, spreadPerShot: 0.001, spreadMax: 0.035,
    spreadRecover: 0.12,
    recoilKick: 0.003, recoilSide: 0.001, recoilRetain: 0.1,
    aimFov: 52, sound: 'plasma',
    // They steer towards whoever they were fired at and go off in a cluster.
    // A dart at 52 m/s turning at 3.2 rad/s sweeps a sixteen metre circle,
    // which is a graceful curve past a man rather than into him.
    homing: { turn: 9.5, range: 90 },
    splash: { radius: 2.2, damage: 26, force: 4 },
  },

  banana: {
    name: 'Banana', short: 'BANANA', kind: KIND.THROW, slot: 6,
    magazine: 1, reserve: 14, reloadTime: 0.5, fireInterval: 0.7, auto: false,
    projectile: 'banana', muzzleSpeed: 19, range: 90,
    spreadHip: 0.005, spreadAim: 0.002, spreadPerShot: 0, spreadMax: 0.005,
    spreadRecover: 0.2,
    recoilKick: 0.002, recoilSide: 0.001, recoilRetain: 0.05,
    aimFov: 58, sound: 'throw',
    // No splash. It lies there, and whoever walks onto it goes down.
    slip: { radius: 1.05, seconds: 3.4 },
  },
  incendiary: {
    name: 'Incendiary bomb', short: 'INCENDIARY', kind: KIND.THROW, slot: null,
    magazine: 1, reserve: 6, reloadTime: 1.1, fireInterval: 1.2, auto: false,
    projectile: 'incendiary', muzzleSpeed: 21, fuse: 2.2, range: 120,
    spreadHip: 0.005, spreadAim: 0.002, spreadPerShot: 0, spreadMax: 0.005,
    spreadRecover: 0.2,
    recoilKick: 0.005, recoilSide: 0.001, recoilRetain: 0.08,
    aimFov: 58, sound: 'throw',
    // A small blast and a large fire. The damage is in the burning, not in
    // the bang: what this does is set fire to everything inside it and leave
    // the place alight for half a minute.
    splash: { radius: 11, damage: 70, force: 12 },
    incendiary: { radius: 26, pools: 7, burnSeconds: 9, damagePerSecond: 110 },
  },
  emp: {
    // A launcher rather than a bomb you lob at your feet. The pulse was
    // always the point and the delivery was always the problem: an arc you
    // had to judge, a fuse that went off late, and a radius you could not
    // put where you wanted it. This one goes where you are pointing, at
    // seventy metres a second, and goes off on what it hits.
    name: 'EMP launcher', short: 'EMP', kind: KIND.LAUNCH, slot: null,
    magazine: 2, reserve: 8, reloadTime: 2.4, fireInterval: 0.9, auto: false,
    projectile: 'rocket', muzzleSpeed: 70, range: 400,
    spreadHip: 0.006, spreadAim: 0.002, spreadPerShot: 0, spreadMax: 0.006,
    spreadRecover: 0.2,
    recoilKick: 0.022, recoilSide: 0.004, recoilRetain: 0.3,
    aimFov: 52, sound: 'rpg',
    // It does almost nothing to a person and almost nothing to a wall. What
    // it does is stop everything with a motor in it, long enough to walk up
    // and put something in it.
    splash: { radius: 7, damage: 20, force: 8 },
    emp: { radius: 38, seconds: 7.5 },
  },
  mechkiller: {
    name: 'Mech killer', short: 'MECH KILLER', kind: KIND.LAUNCH, slot: null,
    magazine: 1, reserve: 4, reloadTime: 3.4, fireInterval: 1.4, auto: false,
    projectile: 'rocket', muzzleSpeed: 78, range: 600,
    spreadHip: 0.006, spreadAim: 0.0015, spreadPerShot: 0, spreadMax: 0.006,
    spreadRecover: 0.2,
    recoilKick: 0.036, recoilSide: 0.006, recoilRetain: 0.4,
    aimFov: 50, sound: 'rpg',
    // Against a street it is a heavy rocket and no more: this is not a
    // second warhead, and four of them will not flatten a square.
    splash: { radius: 13, damage: 240, force: 30 },
    // Against anything with a motor it is an EMP, which is what stops the
    // escort while the warhead deals with the thing they are escorting.
    emp: { radius: 40, seconds: 9 },
    // And against armour it is what it is named after. Enough to take a
    // Reaper apart on its own, enough to put a Titan on one knee, and
    // whatever is still standing afterwards stands there doing nothing for a
    // few seconds, which is the opening the second one goes through.
    mechKill: { radius: 26, damage: 3000, stun: 4.5 },
    // It chases, because a mech walks at eleven metres a second and a rocket
    // you have to lead is a rocket that lands where it was.
    lock: { time: 0.8, cone: 0.2, range: 360, turn: 4.2 },
  },
  flamer: {
    name: 'Flamethrower', short: 'FLAMER', kind: KIND.STREAM, slot: 7,
    // The magazine is fuel, and it burns down about four times a second while
    // the trigger is held rather than a round at a time.
    magazine: 320, reserve: 640, reloadTime: 2.4, fireInterval: 0.055, auto: true,
    range: 22, damage: 0, sound: 'flame',
    spreadHip: 0.02, spreadAim: 0.02, spreadPerShot: 0, spreadMax: 0.02,
    spreadRecover: 0.2,
    recoilKick: 0.0016, recoilSide: 0.0006, recoilRetain: 0.04,
    aimFov: 58,
    // The stream itself: how far it reaches, how wide the cone is at that
    // distance, what it does a second to whatever is in it, and how fast it
    // sets a person alight.
    stream: { reach: 22, cone: 0.20, damagePerSecond: 190, burnPerSecond: 0.75, fuelPerSecond: 26 },
    // The wall: a line of fire that leaves you and runs away across the
    // ground, burning what it goes over. It costs a slug of fuel rather than
    // a round, so you can throw two if you are full and none if you are not.
    // burnSeconds is what it leaves on the road behind it: the trees it goes
    // past catch light, but a street with no trees on it has to go on burning
    // too, or the wall is a flash rather than a fire.
    wall: {
      fuel: 90, width: 11, speed: 16, reach: 150, life: 9,
      damagePerSecond: 240, burnPerSecond: 1.6, ignite: 7,
      burnSeconds: 11, groundDamagePerSecond: 95,
    },
  },
};

/**
 * Where each one sits in your hands, as an offset over the default rifle pose
 * in main.js. A rifle is held out at arm's length and a grenade is not, and a
 * banana held like a rifle is a dark speck in the middle of the screen, which
 * is what the first version of this looked like.
 */
WEAPONS.rpg.hold = { x: 0.205, y: -0.132, z: -0.430, pitch: -0.012, yaw: 0.115, roll: 0.04 };
WEAPONS.grenade.hold = { x: 0.185, y: -0.118, z: -0.175, pitch: 0.06, yaw: 0.22, roll: 0.10 };
WEAPONS.c4.hold = { x: 0.180, y: -0.128, z: -0.150, pitch: 0.05, yaw: 0.26, roll: 0.08 };
WEAPONS.banana.hold = { x: 0.175, y: -0.105, z: -0.120, pitch: 0.09, yaw: 0.30, roll: 0.16 };
WEAPONS.emp.hold = { x: 0.208, y: -0.134, z: -0.440, pitch: -0.012, yaw: 0.116, roll: 0.04 };
WEAPONS.incendiary.hold = { x: 0.182, y: -0.120, z: -0.168, pitch: 0.055, yaw: 0.235, roll: 0.09 };
WEAPONS.mechkiller.hold = { x: 0.210, y: -0.138, z: -0.470, pitch: -0.014, yaw: 0.112, roll: 0.04 };
WEAPONS.flamer.hold = { x: 0.200, y: -0.126, z: -0.330, pitch: -0.008, yaw: 0.120, roll: 0.03 };
WEAPONS.railgun.hold = { x: 0.215, y: -0.142, z: -0.500, pitch: -0.018, yaw: 0.118, roll: 0.04 };
WEAPONS.plasma.hold = { x: 0.220, y: -0.146, z: -0.430, pitch: -0.014, yaw: 0.130, roll: 0.05 };
WEAPONS.flak.hold = { x: 0.225, y: -0.150, z: -0.440, pitch: -0.010, yaw: 0.128, roll: 0.05 };
WEAPONS.splinter.hold = { x: 0.215, y: -0.140, z: -0.420, pitch: -0.012, yaw: 0.135, roll: 0.06 };

export const LOADOUT = [
  'm16', 'shotgun', 'rpg', 'grenade', 'c4', 'banana', 'flamer', 'incendiary',
  'emp', 'mechkiller', 'railgun', 'plasma', 'flak', 'splinter',
];

export function weaponBySlot(slot) {
  for (const id of LOADOUT) if (WEAPONS[id].slot === slot) return id;
  return null;
}
