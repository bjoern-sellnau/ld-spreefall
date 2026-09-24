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
WEAPONS.railgun.hold = { x: 0.215, y: -0.142, z: -0.500, pitch: -0.018, yaw: 0.118, roll: 0.04 };
WEAPONS.plasma.hold = { x: 0.220, y: -0.146, z: -0.430, pitch: -0.014, yaw: 0.130, roll: 0.05 };
WEAPONS.flak.hold = { x: 0.225, y: -0.150, z: -0.440, pitch: -0.010, yaw: 0.128, roll: 0.05 };
WEAPONS.splinter.hold = { x: 0.215, y: -0.140, z: -0.420, pitch: -0.012, yaw: 0.135, roll: 0.06 };

export const LOADOUT = [
  'm16', 'shotgun', 'rpg', 'grenade', 'c4', 'banana',
  'railgun', 'plasma', 'flak', 'splinter',
];

export function weaponBySlot(slot) {
  for (const id of LOADOUT) if (WEAPONS[id].slot === slot) return id;
  return null;
}
