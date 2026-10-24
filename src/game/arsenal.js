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
  MELEE: 'melee',       // in reach, swung or run, and the game layer decides what it met
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
    // Heavier than it was: a room's worth rather than a man's.
    splash: { radius: 11, damage: 260, force: 26 },
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
    // Blast plasma: hold the second trigger for ten seconds and the next shot
    // is one bolt of the hard kind, in orange, that does not bounce, goes off
    // on what it touches and does ten times the harm over half as much again
    // of the street.
    blast: { hold: 10, projectile: 'blast', speed: 90, damage: 10, radius: 1.5, force: 3 },
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

  // Tactics: the quiet three, in the tradition of the outpost games. A
  // pistol with a suppressor on it, a bow, and a marksman's rifle that is
  // suppressed too. noise is how far, in metres, a camp guard hears the shot;
  // anything without a noise is heard a long way off.
  sdpistol: {
    name: 'Suppressed pistol', short: 'SD PISTOL', kind: KIND.HITSCAN, slot: null,
    magazine: 12, reserve: 84, reloadTime: 1.4, fireInterval: 0.2, auto: false,
    damage: 46, coreMultiplier: 3.2, range: 140, pellets: 1,
    spreadHip: 0.012, spreadAim: 0.003, spreadPerShot: 0.006, spreadMax: 0.03,
    spreadRecover: 0.07,
    recoilKick: 0.007, recoilSide: 0.002, recoilRetain: 0.15,
    aimFov: 50, sound: 'pistol', noise: 10,
  },
  bow: {
    name: 'Bow', short: 'BOW', kind: KIND.LAUNCH, slot: null,
    magazine: 1, reserve: 30, reloadTime: 0.55, fireInterval: 0.75, auto: false,
    projectile: 'arrow', muzzleSpeed: 74, range: 240,
    // What the arrow does to whoever it goes into, and how much more to a head.
    damage: 125, coreMultiplier: 3,
    spreadHip: 0.01, spreadAim: 0.0015, spreadPerShot: 0, spreadMax: 0.01,
    spreadRecover: 0.2,
    recoilKick: 0.006, recoilSide: 0.001, recoilRetain: 0.05,
    aimFov: 46, sound: 'bow', noise: 4,
    // What is on the end of the arrow, changed with R while the bow is in
    // your hands: a plain head, one that sets where it lands burning, one
    // that lets out a cloud of poison, and one that goes off.
    heads: ['plain', 'fire', 'poison', 'blast', 'shock'],
    // How hard it is drawn, changed with X: light is quick and weak, strong
    // is slow and hits hard enough to carry a man with it.
    draws: ['medium', 'strong', 'light'],
    // Held the way an archer holds one, not the way a rifle is: upright in
    // the left hand, left of the crosshair, the string drawn back towards
    // the face and the arrow lying straight along the line of sight. An
    // arrow parallel to the view meets the middle of the screen however far
    // off to the side it lies, so it points at the crosshair from the hip
    // and from the aim alike, and the upper limb leans a little to the left
    // so it never stands over what you are aiming at.
    hold: { x: -0.095, y: -0.085, z: -0.140, pitch: 0, yaw: 0, roll: 0.14 },
    aimHold: { x: -0.064, y: -0.056, z: -0.100, pitch: 0, yaw: 0, roll: 0.08 },
    // Or on its side, turned a quarter to the left so the side the arrow
    // lies on is the top: the bow across the bottom of the view, the arrow
    // on top of the grip running up to the crosshair. Along the line of
    // sight as before, so it still points at what the shot hits.
    flatHold: { x: 0.010, y: -0.125, z: -0.100, pitch: 0, yaw: 0, roll: 1.47 },
    flatAim: { x: 0.004, y: -0.092, z: -0.070, pitch: 0, yaw: 0, roll: 1.54 },
  },
  marksman: {
    name: 'Marksman rifle', short: 'MARKSMAN', kind: KIND.HITSCAN, slot: null,
    magazine: 5, reserve: 35, reloadTime: 2.4, fireInterval: 1.05, auto: false,
    damage: 165, coreMultiplier: 2.6, range: 750, pellets: 1, pierce: 1,
    spreadHip: 0.03, spreadAim: 0, spreadPerShot: 0, spreadMax: 0.03,
    spreadRecover: 0.25,
    recoilKick: 0.02, recoilSide: 0.003, recoilRetain: 0.25,
    // A scope: aiming goes to a tight field and a scope picture.
    aimFov: 11, scope: true, sound: 'suppressed', noise: 20,
  },

  // Slayer: in the tradition of the demon shooters. A double barrel that
  // empties both into one thing, a saw that is not for wood, a round shield
  // with teeth that you throw and that comes back, and a flail.
  doublebarrel: {
    name: 'Double barrel', short: 'DOUBLE', kind: KIND.HITSCAN, slot: null,
    magazine: 2, reserve: 48, reloadTime: 1.15, fireInterval: 0.32, auto: false,
    damage: 19, coreMultiplier: 1.6, range: 60, pellets: 18,
    spreadHip: 0.085, spreadAim: 0.06, spreadPerShot: 0.004, spreadMax: 0.1,
    spreadRecover: 0.3,
    recoilKick: 0.032, recoilSide: 0.006, recoilRetain: 0.3,
    aimFov: 56, sound: 'doublebarrel',
  },
  chainsaw: {
    // Fuel, three pips of it, which comes back slowly by itself. What it
    // takes from a demon depends on the size of the demon; what it gives
    // back is ammunition, all over the street.
    name: 'Chainsaw', short: 'SAW', kind: KIND.MELEE, slot: null,
    magazine: 3, reserve: 0, reloadTime: 0.1, fireInterval: 0.9, auto: false,
    reach: 2.8, damage: 1e6, fuel: true, wallHit: 70,
    spreadHip: 0, spreadAim: 0, spreadPerShot: 0, spreadMax: 0, spreadRecover: 1,
    recoilKick: 0.004, recoilSide: 0.004, recoilRetain: 0, aimFov: 64, sound: 'saw',
  },
  shieldsaw: {
    // Thrown, it cuts through what it meets and comes back to your hand.
    // Held up on the second trigger it stops fire, and raised just as the
    // fire arrives it sends it back.
    name: 'Shield saw', short: 'SHIELD', kind: KIND.LAUNCH, slot: null,
    magazine: 1, reserve: 0, reloadTime: 0.1, fireInterval: 0.4, auto: false,
    projectile: 'shieldsaw', muzzleSpeed: 46, range: 40, damage: 150,
    spreadHip: 0.002, spreadAim: 0.001, spreadPerShot: 0, spreadMax: 0.002, spreadRecover: 1,
    recoilKick: 0.006, recoilSide: 0.002, recoilRetain: 0, aimFov: 66, sound: 'throw',
    block: { cone: -0.35, parry: 0.35, parryDamage: 160 },
  },
  flail: {
    // Swung in an arc in front of you: everything in the arc takes it, and
    // a demon low enough on its feet goes down reeling.
    name: 'Flail', short: 'FLAIL', kind: KIND.MELEE, slot: null,
    magazine: 1, reserve: 0, reloadTime: 0.1, fireInterval: 0.75, auto: true,
    reach: 3.8, arc: 0.55, damage: 150, wallHit: 100,
    spreadHip: 0, spreadAim: 0, spreadPerShot: 0, spreadMax: 0, spreadRecover: 1,
    recoilKick: 0.012, recoilSide: 0.004, recoilRetain: 0, aimFov: 64, sound: 'throw',
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
  // The big one, out of the same tradition as the arena four: a slow ball of
  // green that tears out at everybody it passes and leaves a hole in the
  // city you could drive a tram through. The idea is the genre's oldest
  // joke, the name and the numbers are ours.
  void: {
    name: 'Void cannon', short: 'VOID', kind: KIND.LAUNCH, slot: null,
    magazine: 1, reserve: 5, reloadTime: 3.2, fireInterval: 1.8, auto: false,
    projectile: 'void', muzzleSpeed: 26, range: 500,
    spreadHip: 0.004, spreadAim: 0.001, spreadPerShot: 0, spreadMax: 0.004,
    spreadRecover: 0.2,
    recoilKick: 0.05, recoilSide: 0.008, recoilRetain: 0.4,
    aimFov: 54, sound: 'void',
    // A hole nine metres across the face of whatever it meets, which is most
    // of a Berlin frontage between two windows. self is the share of the
    // blast you take yourself, which for this is very little: a gun that
    // kills whoever fires it at a wall in front of him is a gun nobody fires.
    // wreck is what reaches the building grid, which is a heavy rocket's
    // worth: the hole is the point, not the block coming down over it.
    splash: { radius: 24, damage: 700, force: 46, punch: 9, self: 0.08,
      wreck: { radius: 12, damage: 200 } },
    // What comes off the ball: tendrils at everybody within aura of it on the
    // way, and at everybody within reach of where it lands, as long as a wall
    // is not in the way.
    void: { aura: 16, auraDamage: 70, every: 0.14, reach: 48, damage: 450 },
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

  // The heavy five, each the big brother of something already on its key:
  // a revolver that goes through a man into the one behind him, a shotgun
  // with a drum that does not stop, six barrels that have to spin up first,
  // a launcher that lobs the grenade a long way and sets it off on whatever
  // it meets, and four rockets at once.
  magnum: {
    name: 'Hand cannon', short: 'MAGNUM', kind: KIND.HITSCAN, slot: 5,
    magazine: 6, reserve: 48, reloadTime: 2.0, fireInterval: 0.42, auto: false,
    damage: 125, coreMultiplier: 2.6, range: 260, pellets: 1, pierce: 2,
    spreadHip: 0.012, spreadAim: 0.002, spreadPerShot: 0.02, spreadMax: 0.04,
    spreadRecover: 0.12,
    recoilKick: 0.03, recoilSide: 0.006, recoilRetain: 0.25,
    aimFov: 48, sound: 'magnum',
  },
  autoshotgun: {
    name: 'Drum shotgun', short: 'DRUM', kind: KIND.HITSCAN, slot: 2,
    magazine: 20, reserve: 100, reloadTime: 3.0, fireInterval: 0.22, auto: true,
    damage: 15, coreMultiplier: 1.7, range: 70, pellets: 10,
    spreadHip: 0.07, spreadAim: 0.05, spreadPerShot: 0.006, spreadMax: 0.1,
    spreadRecover: 0.25,
    recoilKick: 0.016, recoilSide: 0.005, recoilRetain: 0.22,
    aimFov: 54, sound: 'shotgun',
  },
  minigun: {
    name: 'Rotary cannon', short: 'ROTARY', kind: KIND.HITSCAN, slot: 1,
    magazine: 200, reserve: 600, reloadTime: 3.6, fireInterval: 0.04, auto: true,
    damage: 30, coreMultiplier: 1.8, range: 300, pellets: 1,
    spreadHip: 0.024, spreadAim: 0.014, spreadPerShot: 0.0012, spreadMax: 0.05,
    spreadRecover: 0.12,
    recoilKick: 0.0024, recoilSide: 0.0018, recoilRetain: 0.08,
    aimFov: 56, sound: 'minigun',
    // Seconds of the trigger held before the first round, and it winds down
    // twice as slowly as it winds up, so a pause between bursts costs little.
    spinUp: 0.4,
  },
  launcher: {
    name: 'Grenade launcher', short: 'LAUNCHER', kind: KIND.LAUNCH, slot: 3,
    magazine: 6, reserve: 36, reloadTime: 2.8, fireInterval: 0.55, auto: false,
    projectile: 'shell', muzzleSpeed: 40, range: 260,
    spreadHip: 0.006, spreadAim: 0.002, spreadPerShot: 0, spreadMax: 0.006,
    spreadRecover: 0.2,
    recoilKick: 0.02, recoilSide: 0.003, recoilRetain: 0.2,
    aimFov: 54, sound: 'launcher',
    splash: { radius: 9, damage: 210, force: 24 },
  },
  swarm: {
    name: 'Swarm launcher', short: 'SWARM', kind: KIND.LAUNCH, slot: 3,
    magazine: 4, reserve: 24, reloadTime: 3.2, fireInterval: 1.1, auto: false,
    projectile: 'rocket', muzzleSpeed: 46, range: 600, shards: 4,
    spreadHip: 0.04, spreadAim: 0.03, spreadPerShot: 0, spreadMax: 0.04,
    spreadRecover: 0.2,
    recoilKick: 0.03, recoilSide: 0.005, recoilRetain: 0.3,
    aimFov: 52, sound: 'rpg',
    splash: { radius: 8, damage: 150, force: 22 },
    // Every rocket of the four goes after what the sight was on.
    homing: { turn: 3.2, range: 260 },
  },

  // Eight out of the shooters this one keeps being compared to, each the
  // idea of one weapon there under a name and numbers of our own: the eight
  // stacked barrels of Crysis 3's Typhoon, the electric K-Volt of the Crysis
  // games, DOOM Eternal's Ballista bolt that goes in and goes off a moment
  // later, Far Cry New Dawn's saw launcher, Far Cry's flare gun, and three of
  // Halo's: the plasma grenade that sticks, the sword that closes the
  // distance for you, and the hammer.
  hailstorm: {
    // Eight barrels that do not turn, so no spin up: it simply pours, three
    // rounds a pull thirty times a second, wide and short.
    name: 'Hailstorm', short: 'HAIL', kind: KIND.HITSCAN, slot: 1,
    magazine: 150, reserve: 450, reloadTime: 2.8, fireInterval: 0.033, auto: true,
    damage: 12, coreMultiplier: 1.6, range: 160, pellets: 3,
    spreadHip: 0.032, spreadAim: 0.022, spreadPerShot: 0.0008, spreadMax: 0.05,
    spreadRecover: 0.15,
    recoilKick: 0.0022, recoilSide: 0.0016, recoilRetain: 0.06,
    aimFov: 56, sound: 'minigun',
  },
  volt: {
    // What it hits holds still, and the charge jumps on from there to the
    // next one standing near, and on again, a little weaker each time.
    name: 'Volt caster', short: 'VOLT', kind: KIND.HITSCAN, slot: 8,
    magazine: 60, reserve: 240, reloadTime: 2.0, fireInterval: 0.09, auto: true,
    damage: 20, coreMultiplier: 1.4, range: 80, pellets: 1,
    spreadHip: 0.012, spreadAim: 0.005, spreadPerShot: 0.0015, spreadMax: 0.03,
    spreadRecover: 0.1,
    recoilKick: 0.003, recoilSide: 0.0015, recoilRetain: 0.1,
    aimFov: 52, sound: 'plasma',
    arc: { jumps: 3, reach: 7, share: 0.7, stun: 1.2 },
  },
  arbalest: {
    // The bolt goes into whatever it meets, a wall or a man, and goes off
    // there a moment later. impact is what the bolt itself does going in.
    name: 'Arbalest', short: 'ARBALEST', kind: KIND.LAUNCH, slot: 3,
    magazine: 4, reserve: 24, reloadTime: 2.2, fireInterval: 0.9, auto: false,
    projectile: 'bolt', muzzleSpeed: 130, range: 500, impact: 60,
    spreadHip: 0.004, spreadAim: 0, spreadPerShot: 0, spreadMax: 0.004,
    spreadRecover: 0.2,
    recoilKick: 0.022, recoilSide: 0.003, recoilRetain: 0.25,
    aimFov: 30, sound: 'rail',
    splash: { radius: 6, damage: 210, force: 20 },
  },
  ripper: {
    // A saw blade, flat and fast: through everybody in the way, and off a
    // wall at the same speed it arrived, four times before it is spent. Off
    // the ground it does not come back up: it goes in and stays.
    name: 'Disc ripper', short: 'RIPPER', kind: KIND.LAUNCH, slot: 3,
    magazine: 5, reserve: 30, reloadTime: 2.4, fireInterval: 0.6, auto: false,
    projectile: 'disc', muzzleSpeed: 38, range: 120, damage: 140,
    spreadHip: 0.004, spreadAim: 0.001, spreadPerShot: 0, spreadMax: 0.004,
    spreadRecover: 0.2,
    recoilKick: 0.012, recoilSide: 0.002, recoilRetain: 0.15,
    aimFov: 54, sound: 'throw',
  },
  cling: {
    // Sticks to the first thing it touches, a wall or a man, and goes off
    // there a second later, whichever way he runs.
    name: 'Cling charge', short: 'CLING', kind: KIND.THROW, slot: 4,
    magazine: 1, reserve: 8, reloadTime: 0.75, fireInterval: 0.95, auto: false,
    projectile: 'cling', muzzleSpeed: 24, fuse: 4, range: 120,
    spreadHip: 0.004, spreadAim: 0.001, spreadPerShot: 0, spreadMax: 0.004,
    spreadRecover: 0.2,
    recoilKick: 0.004, recoilSide: 0.001, recoilRetain: 0.1,
    aimFov: 58, sound: 'throw',
    splash: { radius: 7, damage: 250, force: 22 },
  },
  blade: {
    // Anybody in front of you within the lunge, you are on before he can
    // turn, and one cut does it. Nearer than reach, it is only the cut.
    name: 'Lunge blade', short: 'BLADE', kind: KIND.MELEE, slot: 6,
    magazine: 1, reserve: 0, reloadTime: 0.1, fireInterval: 0.55, auto: false,
    reach: 2.6, damage: 600, wallHit: 120,
    lunge: { range: 9, cone: 0.94, speed: 30 },
    spreadHip: 0, spreadAim: 0, spreadPerShot: 0, spreadMax: 0, spreadRecover: 1,
    recoilKick: 0.004, recoilSide: 0.004, recoilRetain: 0, aimFov: 62, sound: 'saw',
  },
  hammer: {
    // Brought down on the street in front of you: everybody in the half
    // circle is hurt and thrown off his feet, a car is thrown into the air,
    // and none of it comes back at you.
    name: 'Quake hammer', short: 'HAMMER', kind: KIND.MELEE, slot: 6,
    magazine: 1, reserve: 0, reloadTime: 0.1, fireInterval: 1.15, auto: false,
    reach: 7, arc: -0.1, damage: 220,
    quake: { push: 9, up: 7, hull: 0.25, edge: 0.4, wall: 320 },
    spreadHip: 0, spreadAim: 0, spreadPerShot: 0, spreadMax: 0, spreadRecover: 1,
    recoilKick: 0.03, recoilSide: 0.004, recoilRetain: 0, aimFov: 62, sound: 'rpg',
  },
  // The four you fight with at arm's length. Each takes the nearest in front
  // of you and in reach, passers by as well, and swing says what it does to
  // him on top of the damage.
  knife: {
    // Short, quick and quiet. From behind one is enough, the way the knife
    // kills in Crysis and the machete in Far Cry 3; from the front it takes a
    // few. Nobody hears it.
    name: 'Knife', short: 'KNIFE', kind: KIND.MELEE, slot: 6,
    magazine: 1, reserve: 0, reloadTime: 0.1, fireInterval: 0.36, auto: true,
    reach: 2.0, arc: 0.6, damage: 55, wallHit: 14,
    swing: { back: 10, quiet: true, cut: true, seconds: 0.26 },
    spreadHip: 0, spreadAim: 0, spreadPerShot: 0, spreadMax: 0, spreadRecover: 1,
    recoilKick: 0.003, recoilSide: 0.003, recoilRetain: 0, aimFov: 64, sound: 'throw',
  },
  baton: {
    // The telescopic police baton Aiden Pearce carries in Watch Dogs: a blow
    // staggers, a third within gap of the last puts him on the ground, and a
    // thief or a brawler in .BACKDOOR is subdued by it rather than hurt.
    name: 'Baton', short: 'BATON', kind: KIND.MELEE, slot: 6,
    magazine: 1, reserve: 0, reloadTime: 0.1, fireInterval: 0.5, auto: true,
    reach: 2.3, arc: 0.5, damage: 20, wallHit: 22,
    swing: { stagger: 0.7, floor: 3, gap: 2.5, push: 3.5, subdue: true, seconds: 0.34 },
    spreadHip: 0, spreadAim: 0, spreadPerShot: 0, spreadMax: 0, spreadRecover: 1,
    recoilKick: 0.005, recoilSide: 0.004, recoilRetain: 0, aimFov: 64, sound: 'throw',
  },
  bat: {
    // A baseball bat, Max Payne's: a slow swing that lifts him off his feet
    // and sends him down the street, through whoever is standing behind him.
    // Anybody too big to lift is knocked flat instead. launch is the speed he
    // leaves at, lift how much of it is upwards, impact how hard what he
    // meets on the way hurts against a thrown man.
    name: 'Baseball bat', short: 'BAT', kind: KIND.MELEE, slot: 6,
    magazine: 1, reserve: 0, reloadTime: 0.1, fireInterval: 0.85, auto: false,
    reach: 2.7, arc: 0.45, damage: 55, wallHit: 60,
    swing: { launch: 18, lift: 0.32, impact: 0.55, push: 9, seconds: 0.5 },
    spreadHip: 0, spreadAim: 0, spreadPerShot: 0, spreadMax: 0, spreadRecover: 1,
    recoilKick: 0.012, recoilSide: 0.006, recoilRetain: 0, aimFov: 64, sound: 'throw',
  },
  fists: {
    // Bare hands, left and right, the fist DOOM started with: quick jabs,
    // and every third in a row (none more than gap apart) a hook at hook
    // times the damage that puts him on the ground.
    name: 'Fists', short: 'FISTS', kind: KIND.MELEE, slot: 6,
    magazine: 1, reserve: 0, reloadTime: 0.1, fireInterval: 0.3, auto: true,
    reach: 1.8, arc: 0.55, damage: 15, wallHit: 8,
    swing: { combo: 3, gap: 0.9, hook: 2.0, push: 6, seconds: 0.24 },
    spreadHip: 0, spreadAim: 0, spreadPerShot: 0, spreadMax: 0, spreadRecover: 1,
    recoilKick: 0.004, recoilSide: 0.003, recoilRetain: 0, aimFov: 66, sound: 'throw',
  },
  flare: {
    // One flare: whatever it goes into is alight, and the ground round it
    // burns for a while after.
    name: 'Flare pistol', short: 'FLARE', kind: KIND.LAUNCH, slot: 7,
    magazine: 1, reserve: 14, reloadTime: 1.1, fireInterval: 0.6, auto: false,
    projectile: 'flare', muzzleSpeed: 50, range: 200,
    spreadHip: 0.006, spreadAim: 0.002, spreadPerShot: 0, spreadMax: 0.006,
    spreadRecover: 0.2,
    recoilKick: 0.016, recoilSide: 0.003, recoilRetain: 0.2,
    aimFov: 54, sound: 'launcher',
    splash: { radius: 3, damage: 55, force: 3, punch: false },
    incendiary: { radius: 6, pools: 3, burnSeconds: 8, damagePerSecond: 85 },
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
WEAPONS.void.hold = { x: 0.220, y: -0.150, z: -0.430, pitch: -0.014, yaw: 0.126, roll: 0.05 };
WEAPONS.splinter.hold = { x: 0.215, y: -0.140, z: -0.420, pitch: -0.012, yaw: 0.135, roll: 0.06 };
WEAPONS.sdpistol.hold = { x: 0.180, y: -0.125, z: -0.300, pitch: -0.010, yaw: 0.150, roll: 0.05 };
WEAPONS.marksman.hold = { x: 0.220, y: -0.150, z: -0.480, pitch: -0.016, yaw: 0.120, roll: 0.04 };
WEAPONS.doublebarrel.hold = { x: 0.205, y: -0.150, z: -0.420, pitch: -0.012, yaw: 0.120, roll: 0.04 };
WEAPONS.chainsaw.hold = { x: 0.200, y: -0.170, z: -0.360, pitch: 0.020, yaw: 0.140, roll: 0.06 };
// The shield is on the left arm and stays there, as in the Doom it comes from:
// at the hip a quarter of it in the corner, held up the left third of the
// screen with its face turned in, and the middle clear either way. Its own
// aim pose, because the shared one puts the sight on the centre line and a
// shield there is a wall in front of your eyes.
WEAPONS.shieldsaw.hold = { x: -0.640, y: -0.270, z: -0.250, pitch: 0.040, yaw: -0.450, roll: -0.180 };
WEAPONS.shieldsaw.aimHold = { x: -0.440, y: -0.100, z: -0.190, pitch: 0.020, yaw: -0.350, roll: -0.120 };
WEAPONS.magnum.hold = { x: 0.175, y: -0.122, z: -0.310, pitch: -0.012, yaw: 0.150, roll: 0.05 };
WEAPONS.autoshotgun.hold = { x: 0.210, y: -0.150, z: -0.420, pitch: -0.012, yaw: 0.122, roll: 0.04 };
WEAPONS.minigun.hold = { x: 0.215, y: -0.175, z: -0.440, pitch: -0.010, yaw: 0.105, roll: 0.03 };
WEAPONS.launcher.hold = { x: 0.215, y: -0.145, z: -0.420, pitch: -0.012, yaw: 0.122, roll: 0.04 };
WEAPONS.swarm.hold = { x: 0.205, y: -0.135, z: -0.440, pitch: -0.012, yaw: 0.115, roll: 0.04 };
WEAPONS.flail.hold = { x: 0.190, y: -0.120, z: -0.320, pitch: 0.100, yaw: 0.180, roll: 0.10 };
WEAPONS.hailstorm.hold = { x: 0.215, y: -0.165, z: -0.430, pitch: -0.010, yaw: 0.115, roll: 0.03 };
WEAPONS.volt.hold = { x: 0.200, y: -0.135, z: -0.380, pitch: -0.012, yaw: 0.130, roll: 0.05 };
WEAPONS.arbalest.hold = { x: 0.210, y: -0.140, z: -0.470, pitch: -0.014, yaw: 0.118, roll: 0.04 };
WEAPONS.ripper.hold = { x: 0.215, y: -0.150, z: -0.420, pitch: -0.012, yaw: 0.125, roll: 0.05 };
WEAPONS.cling.hold = { x: 0.185, y: -0.118, z: -0.175, pitch: 0.06, yaw: 0.22, roll: 0.10 };
WEAPONS.flare.hold = { x: 0.180, y: -0.125, z: -0.300, pitch: -0.010, yaw: 0.150, roll: 0.05 };
// The two you swing are held up and out to the side, and the second trigger
// does not bring them onto the centre line: there is no sight on a sword.
WEAPONS.blade.hold = { x: 0.200, y: -0.150, z: -0.220, pitch: 0.120, yaw: 0.200, roll: 0.25 };
WEAPONS.blade.aimHold = { x: 0.150, y: -0.140, z: -0.220, pitch: 0.100, yaw: 0.150, roll: 0.15 };
WEAPONS.hammer.hold = { x: 0.270, y: -0.250, z: -0.320, pitch: 0.000, yaw: 0.220, roll: 0.30 };
WEAPONS.hammer.aimHold = { x: 0.230, y: -0.230, z: -0.320, pitch: 0.000, yaw: 0.180, roll: 0.22 };
// The knife point up and forward, the baton raised, the bat up over the
// right shoulder, and the right fist up with the forearm going down out of
// the picture: the left one is drawn as its mirror. A positive pitch lifts
// the far end, a positive yaw turns it to the left.
WEAPONS.knife.hold = { x: 0.190, y: -0.150, z: -0.300, pitch: 0.250, yaw: 0.200, roll: 0.25 };
WEAPONS.knife.aimHold = { x: 0.150, y: -0.140, z: -0.300, pitch: 0.200, yaw: 0.150, roll: 0.15 };
WEAPONS.baton.hold = { x: 0.200, y: -0.200, z: -0.300, pitch: 0.550, yaw: 0.180, roll: 0.10 };
WEAPONS.baton.aimHold = { x: 0.170, y: -0.190, z: -0.300, pitch: 0.500, yaw: 0.140, roll: 0.08 };
WEAPONS.bat.hold = { x: 0.220, y: -0.300, z: -0.350, pitch: 1.100, yaw: -0.600, roll: 0.00 };
WEAPONS.bat.aimHold = { x: 0.200, y: -0.290, z: -0.350, pitch: 1.050, yaw: -0.550, roll: 0.00 };
WEAPONS.fists.hold = { x: 0.170, y: -0.190, z: -0.430, pitch: 0.500, yaw: 0.250, roll: -0.30 };
WEAPONS.fists.aimHold = { x: 0.140, y: -0.170, z: -0.410, pitch: 0.450, yaw: 0.200, roll: -0.25 };

/**
 * The heads a bow can carry. Fire and poison do their own harm where they
 * land on top of the arrow's; the blast head is a small charge and is heard
 * like one.
 */
export const ARROW_HEADS = {
  plain: { name: 'Arrow', short: '' },
  fire: { name: 'Fire arrow', short: 'FIRE', damage: 1, burn: { radius: 4.5, seconds: 8, damagePerSecond: 24 },
    colour: [1.0, 0.55, 0.15] },
  poison: { name: 'Poison arrow', short: 'POISON', damage: 0.8,
    cloud: { radius: 5.5, seconds: 9, damagePerSecond: 20 }, colour: [0.45, 1.0, 0.25] },
  // A charge on the head that goes into whoever is near where it lands:
  // a burst of current that stops them where they stand and hurts.
  shock: { name: 'Shock arrow', short: 'SHOCK', damage: 0.7,
    shock: { radius: 5, damage: 70, stun: 2.4 }, colour: [0.5, 0.85, 1.0] },
  blast: { name: 'Explosive arrow', short: 'BLAST', damage: 0.6,
    splash: { radius: 6.5, damage: 240, force: 11 }, colour: [1.0, 0.2, 0.12] },
};

/** How hard the bow is drawn: what it does to the arrow and to the time between them. */
export const ARROW_DRAWS = {
  light: { name: 'Light draw', short: 'LIGHT', damage: 0.65, speed: 0.8, interval: 0.55 },
  medium: { name: 'Medium draw', short: '', damage: 1, speed: 1, interval: 1 },
  strong: { name: 'Strong draw', short: 'STRONG', damage: 1.6, speed: 1.3, interval: 1.6, carry: 4 },
};

/**
 * The number row, in the manner of Half-Life: every key is a group, and
 * pressing it again goes to the next weapon in the group. The first of each
 * is what the key always was, so a hand that knows 1 for the rifle and 4 for
 * a grenade still finds them first.
 */
export const BUCKETS = {
  1: { name: 'Rifles', ids: ['m16', 'marksman', 'minigun', 'bow', 'hailstorm'] },
  2: { name: 'Shotguns', ids: ['shotgun', 'doublebarrel', 'autoshotgun', 'flak'] },
  3: { name: 'Launchers', ids: ['rpg', 'swarm', 'launcher', 'arbalest', 'ripper'] },
  4: { name: 'Thrown', ids: ['grenade', 'incendiary', 'banana', 'c4', 'cling'] },
  5: { name: 'Pistols', ids: ['sdpistol', 'magnum'] },
  6: { name: 'Close', ids: ['chainsaw', 'flail', 'shieldsaw', 'blade', 'hammer', 'knife', 'baton', 'bat', 'fists'] },
  7: { name: 'Fire', ids: ['flamer', 'flare'] },
  8: { name: 'Energy', ids: ['plasma', 'railgun', 'splinter', 'volt'] },
  9: { name: 'Anti armour', ids: ['mechkiller', 'emp'] },
  0: { name: 'Void', ids: ['void'] },
};
export const BUCKET_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

// Everything you carry, in the order of the keys, which is the order the
// wheel goes through them and the order the side of the screen lists them.
export const LOADOUT = BUCKET_KEYS.flatMap((k) => BUCKETS[k].ids);
for (const k of BUCKET_KEYS) for (const id of BUCKETS[k].ids) WEAPONS[id].slot = k;

/**
 * What the number row picks in a mode that has a kit of its own: one to nine
 * and then nought. Everything else is still on its own key and the wheel
 * goes through the kit.
 */
export const KITS = {
  tactics: ['sdpistol', 'bow', 'marksman', 'm16', 'shotgun', 'rpg', 'grenade', 'c4', 'banana', 'railgun'],
  slayer: ['doublebarrel', 'm16', 'plasma', 'rpg', 'railgun', 'shieldsaw', 'flail', 'chainsaw', 'flak', 'void'],
  // The bow first: in the suit it is the one thing you can fire from the cloak.
  hunt: ['bow', 'm16', 'sdpistol', 'marksman', 'shotgun', 'grenade', 'c4', 'rpg', 'railgun', 'banana'],
};

/**
 * What you can do whatever is in your hands. A kick, the way F.E.A.R. and
 * Duke Nukem 3D's Mighty Foot have one, and in the air a flying kick that
 * sends him off down the street like the bat does (air: what it multiplies
 * and how it launches). And a blow with what you are holding, the butt of a
 * rifle, the grip of a pistol, the tube of a launcher, as F.E.A.R. lets you
 * with any of them: weight by the group the weapon is in, a pistol quick and
 * light, a launcher slow and heavy, and a heavy one puts him down. seconds
 * is how long the move takes on the screen, cooldown before the next.
 */
export const MOVES = {
  kick: {
    reach: 2.2, arc: 0.5, damage: 35, push: 8, wallHit: 30, cooldown: 0.7, seconds: 0.42,
    air: { damage: 1.8, launch: 13, lift: 0.25, impact: 0.45 },
  },
  bash: {
    reach: 2.0, arc: 0.55, damage: 40, push: 6, stagger: 0.5, wallHit: 20, cooldown: 0.55, seconds: 0.32,
    weight: { 5: 0.7, 3: 1.4, 9: 1.5, 0: 1.5 }, heavy: ['minigun', 'hailstorm'], floors: 1.4,
  },
};

/** How heavy a blow with this weapon is: by its group, and two that are heavy whatever group. */
export function bashWeight(id) {
  const w = WEAPONS[id];
  if (!w) return 1;
  if (MOVES.bash.heavy.includes(id)) return 1.5;
  return MOVES.bash.weight[w.slot] ?? 1;
}

export function weaponBySlot(slot) {
  return BUCKETS[slot] ? BUCKETS[slot].ids[0] : null;
}
