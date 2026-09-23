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

export const LOADOUT = ['m16', 'shotgun', 'rpg', 'grenade', 'c4', 'banana'];

export function weaponBySlot(slot) {
  for (const id of LOADOUT) if (WEAPONS[id].slot === slot) return id;
  return null;
}
