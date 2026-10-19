// Ten mechs, as numbers.
//
// A chassis is everything that makes one mech different from another: its
// size, where its hips are, how fast it walks and turns, how much it takes,
// how high it jumps and how far it dashes, where its guns are, and which of
// the arm weapons it comes down holding. The meshes in
// `src/render/mechmeshes.js` are built around the same numbers, so a muzzle
// here and a barrel there cannot drift apart.
//
// Every chassis comes in two versions out of one row: yours, with a shield,
// a dash, the arm weapons and a cockpit, painted in the chassis' own colour;
// and theirs, the same body in the enemy's gunmetal with red trim, a slower
// walk, a chaingun that fires in bursts and a rocket salvo with a long rest
// after it. The first row is the one the game always had, and its two
// versions are still called the Titan and the Reaper.
//
// The names and the shapes are ours. The ideas, a heavy brawler, a tall
// marksman, a light raptor, a spider, a walking fortress, are the genre's.

/**
 * @typedef {object} Chassis
 * @property {string} id
 * @property {string} name
 * @property {string} role one line for the menu
 * @property {number} hip where the legs end and the torso starts, in metres
 * @property {'biped'|'quad'} gait
 * @property {number} hipZ for a four legged one, how far fore and aft of the
 *   middle the leg roots are
 * @property {number} height @property {number} radius @property {number} eye
 * @property {{chaingun:number[], rockets:number[]}} muzzle in body coordinates
 * @property {number} paint which of the ten liveries, 0 to 9
 * @property {string} arm the arm weapon it arrives holding
 */
export const CHASSIS = [
  {
    id: 'warden', name: 'Warden', role: 'the all rounder: chaingun, rocket pod, a dash and a shield',
    hip: 4.2, gait: 'biped', hipZ: 0,
    height: 7.0, radius: 2.4, eye: 6.3, cockpit: 1.6, chase: 17, chaseUp: 9.5,
    muzzle: { chaingun: [2.05, 5.6, -3.2], rockets: [-2.05, 6.3, -1.55] },
    paint: 0, arm: 'chaingun',
    mine: {},
    foe: {},
  },
  {
    id: 'bruin', name: 'Bruin', role: 'heavy brawler: slow, broad, a shotgun fist and a big shield',
    hip: 3.4, gait: 'biped', hipZ: 0,
    height: 6.8, radius: 3.0, eye: 5.6, cockpit: 1.8, chase: 18, chaseUp: 9.5,
    muzzle: { chaingun: [2.75, 4.5, -2.7], rockets: [-2.75, 5.4, -1.4] },
    paint: 1, arm: 'leadwall',
    mine: { health: 5200, walk: 8.6, turn: 2.0, torsoTurn: 4.0, jump: 8,
      shield: { max: 2200, rate: 320, wait: 5.5 }, dash: { speed: 22, seconds: 0.7, cooldown: 4.5 },
      stomp: { radius: 13, damage: 560, force: 30, speed: 9 } },
    foe: { health: 3600, walk: 5.0, keep: 22 },
  },
  {
    id: 'heron', name: 'Heron', role: 'tall marksman: long legs, a railgun on the shoulder, thin armour',
    hip: 5.8, gait: 'biped', hipZ: 0,
    height: 9.6, radius: 2.2, eye: 8.6, cockpit: 1.6, chase: 20, chaseUp: 12,
    muzzle: { chaingun: [1.45, 8.25, -5.3], rockets: [-1.4, 8.4, -1.25] },
    paint: 2, arm: 'railgun',
    mine: { health: 2800, walk: 12.5, turn: 2.4, torsoTurn: 4.4, climb: 2.0, jump: 12,
      shield: { max: 1200, rate: 280, wait: 5.0 }, dash: { speed: 28, seconds: 0.8, cooldown: 3.6 } },
    foe: { health: 1900, walk: 7.0, engage: 240, keep: 90,
      chaingun: { damage: 34, interval: 0.9, burst: 1, rest: 2.4, spread: 0.01, range: 300 } },
  },
  {
    id: 'lynx', name: 'Lynx', role: 'light raptor: reverse knees, very fast, a long dash, little armour',
    hip: 3.6, gait: 'biped', hipZ: 0,
    height: 5.4, radius: 1.9, eye: 4.6, cockpit: 1.4, chase: 14, chaseUp: 7.5,
    muzzle: { chaingun: [0.85, 3.85, -2.75], rockets: [-0.9, 5.05, -0.9] },
    paint: 3, arm: 'chaingun',
    mine: { health: 2300, walk: 17, turn: 3.4, torsoTurn: 6.5, jump: 14,
      shield: { max: 1000, rate: 300, wait: 4.0 }, dash: { speed: 36, seconds: 0.7, cooldown: 2.2 },
      stomp: { radius: 8, damage: 300, force: 18, speed: 9 } },
    foe: { health: 1500, walk: 9.5, keep: 30 },
  },
  {
    id: 'bastion', name: 'Bastion', role: 'walking fortress: shoulder shields, a cannon, the biggest shield of all',
    hip: 3.8, gait: 'biped', hipZ: 0,
    height: 7.4, radius: 3.0, eye: 6.2, cockpit: 1.8, chase: 19, chaseUp: 10,
    muzzle: { chaingun: [2.35, 5.2, -3.45], rockets: [-1.55, 7.25, 0.15] },
    paint: 4, arm: 'cannon',
    mine: { health: 6200, walk: 7.2, turn: 1.7, torsoTurn: 3.5, jump: 6,
      shield: { max: 3000, rate: 380, wait: 5.5 }, dash: { speed: 18, seconds: 0.6, cooldown: 5.0 } },
    foe: { health: 4200, walk: 4.2, keep: 50 },
  },
  {
    id: 'hornet', name: 'Hornet', role: 'missile boat: two racks of ten, jump jets that clear a roof',
    hip: 4.0, gait: 'biped', hipZ: 0,
    height: 7.2, radius: 2.3, eye: 6.2, cockpit: 1.6, chase: 17, chaseUp: 9.5,
    muzzle: { chaingun: [1.75, 5.0, -2.65], rockets: [-2.15, 7.05, -1.35] },
    paint: 5, arm: 'stinger',
    mine: { health: 3000, walk: 11, jump: 22,
      shield: { max: 1300, rate: 300, wait: 5.0 }, dash: { speed: 30, seconds: 0.9, cooldown: 3.0 },
      rockets: { salvo: 10, gap: 0.05, interval: 3.4 } },
    foe: { health: 2100, walk: 6.4, engage: 220, rockets: { salvo: 8, interval: 6.0 } },
  },
  {
    id: 'colossus', name: 'Colossus', role: 'eleven metres: slow as a tram, a landing that flattens a square',
    hip: 5.4, gait: 'biped', hipZ: 0,
    height: 11.0, radius: 3.4, eye: 9.6, cockpit: 2.0, chase: 25, chaseUp: 14,
    muzzle: { chaingun: [3.25, 7.4, -4.7], rockets: [-3.3, 8.6, -2.05] },
    paint: 6, arm: 'flak',
    mine: { health: 8500, walk: 6.4, turn: 1.4, torsoTurn: 3.0, climb: 2.6, jump: 5,
      shield: { max: 3500, rate: 400, wait: 6.0 }, dash: { speed: 16, seconds: 0.6, cooldown: 6.0 },
      stomp: { radius: 18, damage: 800, force: 34, speed: 9 } },
    foe: { health: 6000, walk: 3.6, engage: 200, keep: 60,
      chaingun: { damage: 18, interval: 0.2, burst: 6, rest: 2.2 } },
  },
  {
    id: 'mantis', name: 'Mantis', role: 'four legged spider: low, wide, climbs what the others cannot',
    hip: 3.8, gait: 'quad', hipZ: 1.25,
    height: 5.6, radius: 3.2, eye: 5.0, cockpit: 1.6, chase: 17, chaseUp: 8.5,
    muzzle: { chaingun: [0.9, 5.25, -3.1], rockets: [-1.1, 5.6, -0.85] },
    paint: 7, arm: 'thermite',
    mine: { health: 4200, walk: 12, turn: 3.2, torsoTurn: 5.5, climb: 2.6, jump: 9,
      shield: { max: 1600, rate: 300, wait: 5.0 }, dash: { speed: 30, seconds: 0.7, cooldown: 3.0 } },
    foe: { health: 2800, walk: 7.0 },
  },
  {
    id: 'ram', name: 'Ram', role: 'chicken walker: no arms, a head full of guns and a charge that hits like a train',
    hip: 4.4, gait: 'biped', hipZ: 0,
    height: 7.0, radius: 2.2, eye: 5.6, cockpit: 1.8, chase: 17, chaseUp: 9,
    muzzle: { chaingun: [0.6, 4.75, -3.05], rockets: [-1.55, 5.6, -1.65] },
    paint: 8, arm: 'cannon',
    mine: { health: 3400, walk: 14, turn: 2.8, torsoTurn: 3.0, jump: 10,
      shield: { max: 1500, rate: 300, wait: 5.0 }, dash: { speed: 40, seconds: 0.6, cooldown: 3.0 },
      stomp: { radius: 12, damage: 480, force: 28, speed: 9 } },
    foe: { health: 2300, walk: 8.0 },
  },
  {
    id: 'wraith', name: 'Wraith', role: 'faceted and dark: fast, a beam on the arm, a shield that comes back quickly',
    hip: 4.4, gait: 'biped', hipZ: 0,
    height: 7.6, radius: 2.0, eye: 6.7, cockpit: 1.6, chase: 17, chaseUp: 9.5,
    muzzle: { chaingun: [1.6, 5.6, -3.85], rockets: [-1.5, 6.6, -1.05] },
    paint: 9, arm: 'laser',
    mine: { health: 2600, walk: 15, turn: 3.0, torsoTurn: 6.0, jump: 13,
      shield: { max: 1400, rate: 500, wait: 3.0 }, dash: { speed: 34, seconds: 0.8, cooldown: 1.8 } },
    foe: { health: 1800, walk: 8.5 },
  },
];

/** The chassis by id, or the first one for anything it does not know. */
export function chassisById(id) {
  return CHASSIS.find((c) => c.id === id) || CHASSIS[0];
}

/**
 * The key a chassis goes by in the mech table. The first one keeps the two
 * names the game always used for it, so everything that asks for a Titan or
 * a Reaper still gets one.
 */
export function mechKey(id, mine) {
  const c = chassisById(id);
  if (c === CHASSIS[0]) return mine ? 'titan' : 'reaper';
  return mine ? c.id : `${c.id}-foe`;
}
