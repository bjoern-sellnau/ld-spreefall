// Spree Fall Slayer's demons, as numbers.
//
// Three that walk and one that floats. They are built on the two pools the
// game already has rather than on new ones: a demon that walks is a soldier
// with a kind set on it, drawn larger and in its own colours with horns the
// soldier mesh carries hidden, and given a step of its own in soldiers.js
// that hunts instead of patrolling; the one that floats is a drone with a
// flag, drawn as a sphere with an eye, that spits fire instead of shooting.
// So they bleed, burn, ragdoll and come apart like everything else here.
//
// The roster is the genre's: a quick one that throws fire, a heavy one that
// charges, a floating one, and something very large to finish a district
// with. The names and the numbers are ours.

export const DEMON = {
  // Quick and thin, it throws fire and closes to claw.
  ghoul: {
    code: 2, name: 'Ghoul', health: 110, scale: 1.08, run: 6.2,
    melee: { range: 2.0, damage: 14, interval: 0.85 },
    fire: { range: 70, interval: [1.4, 3.0], speed: 28, damage: 16, radius: 2.0, volley: 1 },
    points: 100,
  },
  // Heavy, all muscle, no ranged attack: it charges, and it hits like a car.
  brute: {
    code: 3, name: 'Brute', health: 620, scale: 1.65, run: 4.4,
    charge: { speed: 12, seconds: 1.5, every: 5, from: 9, to: 34 },
    melee: { range: 2.4, damage: 38, interval: 1.2 },
    points: 400,
  },
  // The end of a district: very large, very slow, and fire in volleys.
  tyrant: {
    code: 4, name: 'Tyrant', health: 9000, scale: 3.5, run: 3.1,
    melee: { range: 2.3, damage: 60, interval: 2.2, slam: 12 },
    fire: { range: 140, interval: [2.2, 3.2], speed: 32, damage: 28, radius: 3.4, volley: 5 },
    points: 5000, boss: true,
  },
};

// The Hunt's aliens, in the manner of the second and third nanosuit games:
// the stalker is quick, light and close, and knocks you off your feet; the
// grunt is their infantry, a soldier in their shape who carries a gun. Both
// are drawn on the soldier body like the demons, in their own colours.
DEMON.stalker = {
  code: 6, name: 'Stalker', health: 240, scale: 1.15, run: 8.6,
  charge: { speed: 15, seconds: 0.8, every: 3.5, from: 6, to: 26 },
  melee: { range: 2.1, damage: 20, interval: 0.75, launch: 7.5 },
  points: 250, ceph: true,
};

export const CEPH = {
  grunt: { code: 5, name: 'Grunt', health: 300, scale: 1.22 },
  // The alpha of a hunting ground: a tall walker of theirs whose ping is an
  // EMP that hurts whoever is inside it and empties the suit.
  pinger: { chassis: 'heron-foe', health: 1.5, ping: { every: 6, radius: 50, damage: 30, stall: 2.5 } },
};

/** A soldier in their shape: the same rifle and the same mind, more of him. */
export function makeGrunt(s, level = 0) {
  s.ceph = 'grunt';
  s.look = CEPH.grunt.code;
  s.scale = CEPH.grunt.scale;
  s.health = CEPH.grunt.health * (1 + DEMON_LEVEL * level);
  s.maxHealth = s.health;
  s.machine = false;
  s.civilian = false;
  return s;
}

// The floating one: a drone with a flag.
export const GAZER = {
  name: 'Gazer', health: 380, radius: 1.5, points: 250,
  fire: { speed: 22, damage: 22, radius: 2.6 },
};

/** Each level of a nest makes what comes out of it this much tougher. */
export const DEMON_LEVEL = 0.25;

/** Turn a freshly spawned soldier into a demon of a kind. */
export function makeDemon(s, kind, level = 0) {
  const spec = DEMON[kind] || DEMON.ghoul;
  s.demon = kind in DEMON ? kind : 'ghoul';
  s.dspec = spec;
  s.scale = spec.scale;
  s.health = spec.health * (1 + DEMON_LEVEL * level);
  s.maxHealth = s.health;
  s.meleeLeft = 0.5;
  s.fireLeft = spec.fire ? spec.fire.interval[0] * (0.5 + Math.random()) : 0;
  s.chargeLeft = spec.charge ? 1.5 * Math.random() : 0;
  s.charging = 0;
  // Demons hunt: no patrol, no making up their minds.
  s.state = 1;
  s.stateTime = 0;
  s.machine = false;
  s.civilian = false;
  return s;
}

/** And a drone into the floating one. */
export function makeGazer(d, level = 0) {
  d.demon = 'gazer';
  d.maxHealth = GAZER.health * (1 + DEMON_LEVEL * level);
  d.health = d.maxHealth;
  return d;
}
