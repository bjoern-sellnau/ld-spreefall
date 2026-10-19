// Mechs: eight metres of walking gun platform, theirs and yours.
//
// A mech is not a vehicle and it is not a soldier. It walks, so it follows the
// ground and steps over kerbs the way a person does; it is a machine, so it
// turns its legs slowly and its torso quickly, and what it is aiming with is
// the torso. That split is the whole feel of the thing: the legs commit to a
// direction and the guns do not have to.
//
// Theirs hunt you in Rise of the Machines and can be dropped from the cheat
// menu. Yours is the same body with better numbers and a cockpit, and it is
// driven by the same update: a pilot is a set of controls instead of an
// intent, which means one physics path rather than two that drift apart.
//
// Everything here collides against the same world as everything else in this
// project: the ground height field under the feet and the collision segments
// in front of the hull, out of the raycast the bullets use.

import { CHASSIS, mechKey } from './chassis.js';

export const MECH = {
  // Theirs. Slower than you, hits hard at range, and does not give ground.
  reaper: {
    name: 'Reaper',
    mine: false,
    height: 7.0, radius: 2.3, eye: 6.0,
    chase: 17, chaseUp: 9.5,
    health: 2400,
    walk: 6.4, turn: 1.0, torsoTurn: 2.0, climb: 1.4, gravity: 22,
    // How far out it opens fire, and how close it tries to get.
    engage: 170, keep: 38,
    // Five rounds, then two seconds of nothing, because a mech that fires
    // without pausing kills you from across a square before you have found
    // which window it is standing next to.
    chaingun: {
      damage: 11, interval: 0.16, burst: 5, rest: 2.0,
      spread: 0.05, range: 200, muzzle: [2.05, 5.6, -3.2],
    },
    // Rockets are for the far half of the street. Close in it uses the
    // chaingun, because a salvo at twenty metres is not a fight, it is a
    // cutscene in which you die.
    rockets: {
      salvo: 4, gap: 0.22, interval: 7.0, speed: 170, minRange: 55,
      splash: { radius: 11, damage: 120, force: 16 }, muzzle: [-2.05, 6.3, -1.4],
    },
  },
  // Yours. Faster, tougher, with a dash and a landing that opens the street.
  titan: {
    name: 'Titan',
    mine: true,
    height: 7.0, radius: 2.4, eye: 6.3,
    // Where the camera hangs when you are looking at it from outside. Behind
    // and above, like everything else you can get into here, because a mech
    // is a thing worth looking at.
    chase: 17, chaseUp: 9.5,
    // And where the pilot's head is for the view from inside: this far in
    // front of the torso's own eye, along the line the torso is looking down.
    // On that line rather than near it, because the guns converge on what
    // that line runs into, and a camera parked beside it would put the
    // crosshair half a metre under the shot at fifty paces. Far enough out to
    // clear the canopy, which is a plate two centimetres thick in the mesh
    // and from behind is all you would see.
    cockpit: 1.6,
    health: 3600,
    walk: 11.5, turn: 2.6, torsoTurn: 5.0, climb: 1.6, gravity: 22,
    jump: 11.5,
    // Yours carries the five arm weapons and a shield that comes back.
    arms: true,
    shield: { max: 1500, rate: 300, wait: 5.0 },
    dash: { speed: 27, seconds: 0.85, cooldown: 3.6 },
    chaingun: {
      damage: 24, interval: 0.075, burst: 0, rest: 0,
      spread: 0.022, range: 260, muzzle: [2.05, 5.6, -3.2],
    },
    // A salvo is six rockets in half a second, and they go fast enough to
    // reach what you aimed at before it has walked out from under them. The
    // first pass had them at a hundred and fifteen metres a second, which is
    // a lob rather than a launch.
    rockets: {
      salvo: 6, gap: 0.07, interval: 3.0, speed: 230,
      splash: { radius: 14, damage: 230, force: 22 }, muzzle: [-2.05, 6.3, -1.4],
    },
    // What a forty tonne landing does to whatever is standing under it.
    stomp: { radius: 11, damage: 420, force: 26, speed: 9 },
  },
};

MECH.titan.chassis = 'warden';
MECH.reaper.chassis = 'warden';

/**
 * The other nine, yours and theirs, out of the chassis table: the Titan and
 * the Reaper with the numbers each chassis changes laid over them. Nested
 * rows (the chaingun, the rockets, the shield, the dash, the stomp) are
 * merged a field at a time, so a chassis that only changes the size of its
 * salvo keeps the Titan's rocket speed and splash.
 */
function overlay(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? { ...base[k], ...v } : v;
  }
  return out;
}
for (const c of CHASSIS) {
  const shape = {
    height: c.height, radius: c.radius, eye: c.eye, chase: c.chase, chaseUp: c.chaseUp,
    chassis: c.id,
  };
  const mine = overlay(overlay(MECH.titan, shape), c.mine);
  mine.cockpit = c.cockpit;
  mine.chaingun = { ...mine.chaingun, muzzle: c.muzzle.chaingun };
  mine.rockets = { ...mine.rockets, muzzle: c.muzzle.rockets };
  mine.arm = c.arm;
  const foe = overlay(overlay(MECH.reaper, shape), c.foe);
  foe.chaingun = { ...foe.chaingun, muzzle: c.muzzle.chaingun };
  foe.rockets = { ...foe.rockets, muzzle: c.muzzle.rockets };
  if (c === CHASSIS[0]) {
    // The first chassis is the Titan and the Reaper, under the names the
    // game has always used for them.
    Object.assign(MECH.titan, { arm: c.arm });
    continue;
  }
  mine.name = c.name;
  foe.name = c.name;
  MECH[mechKey(c.id, true)] = mine;
  MECH[mechKey(c.id, false)] = foe;
}

/**
 * Calling one down.
 *
 * The wait is most of it. A Titan you can have the instant you ask for one is
 * not a thing you call for, it is a thing you carry, and the words on the
 * screen are a promise rather than an announcement: half a minute of standing
 * in the open knowing it is coming, with a mark on the road where it will
 * land, and then four seconds of watching three hundred metres of sky turn
 * into forty tonnes.
 *
 * Three hundred and twenty metres at thirty six metres a second, under the
 * same gravity everything else falls at, works out at four seconds: long
 * enough to look up, short enough that the thing arrives rather than settles.
 */
export const TITANFALL = { wait: 25, height: 320, speed: 36, beacon: 8 };

/**
 * What a mech of yours carries.
 *
 * Five primaries, one at a time, switched with the number keys or the wheel,
 * in the spirit of the Titan loadouts: a chaingun that hoses, a cannon that
 * punches, a thermite launcher that denies a street, a railgun you charge for
 * one enormous shot, and a close range slug thrower. The ordnance, the rocket
 * pod, is on the right mouse whatever is in the hands, and the dash and the
 * landing are the rest of it.
 *
 * Each one is a row of numbers, the same way the hand weapons are, because
 * every difference between a chaingun and a railgun that this game cares
 * about is a number. `shake` is how hard it hits your own screen, which is
 * most of what makes forty tonnes feel like forty tonnes.
 */
export const ARMS = [
  {
    id: 'chaingun', name: 'XO Chaingun', kind: 'auto', mount: 'chaingun',
    damage: 38, interval: 0.07, spread: 0.02, range: 280,
    magazine: 200, reload: 2.8, shake: 0.045, sound: 'mechgun',
  },
  {
    id: 'cannon', name: '40 mm Cannon', kind: 'shell', mount: 'chaingun',
    speed: 320, interval: 0.8, spread: 0.004,
    splash: { radius: 10, damage: 320, force: 20 },
    magazine: 12, reload: 3.2, shake: 0.34, sound: 'mechcannon',
  },
  {
    id: 'thermite', name: 'Thermite Launcher', kind: 'thermite', mount: 'rockets',
    speed: 95, interval: 1.2, spread: 0.01,
    splash: { radius: 8, damage: 180, force: 12 },
    fire: { radius: 22, pools: 7, burnSeconds: 12, damagePerSecond: 170 },
    magazine: 6, reload: 3.6, shake: 0.26, sound: 'rpg',
  },
  {
    id: 'railgun', name: 'Plasma Railgun', kind: 'rail', mount: 'chaingun',
    // Held to charge. Letting go early still fires, for less: the charge is
    // a multiplier on the hit rather than a gate in front of it.
    charge: 1.2, damage: 420, chargedDamage: 1500, range: 900, pierce: 4,
    interval: 0.75, magazine: 6, reload: 3.4, shake: 0.55, sound: 'rail',
  },
  {
    id: 'leadwall', name: 'Leadwall', kind: 'shotgun', mount: 'chaingun',
    pellets: 14, damage: 78, spread: 0.11, range: 75,
    interval: 0.7, magazine: 8, reload: 2.9, shake: 0.4, sound: 'mechgun',
  },
  // A very large anti aircraft gun. The shell bursts beside whatever is in
  // the air rather than on it, which is what flak is: it does not have to hit.
  // On the ground it is an ordinary heavy shell with a long fuse.
  {
    id: 'flak', name: '88 mm Flak', kind: 'flak', mount: 'chaingun',
    speed: 520, interval: 0.34, spread: 0.008,
    splash: { radius: 30, damage: 300, force: 16 },
    proximity: 17, fuse: 4.0, lockRange: 900, lockCone: 0.22,
    magazine: 24, reload: 4.6, shake: 0.5, sound: 'mechcannon',
  },
  // A beam that does not stop at the first wall. Held down it is continuous,
  // and what it cuts through goes on burning.
  {
    id: 'laser', name: 'Power Laser', kind: 'laser', mount: 'chaingun',
    damage: 150, interval: 0.05, range: 420, pierce: 3,
    magazine: 320, reload: 5.0, shake: 0.018, sound: 'rail',
  },
  // A charge thrown at a parked car. It is a small bomb on its own and a very
  // large one when it lands on a car, which is the whole idea: the street
  // does the work and you only have to pick which car.
  {
    id: 'carbomb', name: 'Car Bomb', kind: 'carbomb', mount: 'rockets',
    speed: 62, interval: 1.6, spread: 0.005,
    splash: { radius: 9, damage: 150, force: 10 },
    reach: 7,
    magazine: 4, reload: 4.4, shake: 0.3, sound: 'rpg',
  },
  // Lock onto something flying and the world slows down while the missile
  // runs it down, so that you watch it arrive instead of waiting for it.
  {
    id: 'stinger', name: 'Stinger', kind: 'stinger', mount: 'rockets',
    speed: 165, interval: 1.0, lockRange: 800, lockCone: 0.30,
    splash: { radius: 15, damage: 560, force: 14 }, slow: 2.4,
    magazine: 6, reload: 3.8, shake: 0.25, sound: 'rpg',
  },
  // And the one for the other machines: nothing with a motor in it moves
  // inside the pulse, which on something eight metres tall is seven seconds
  // of standing still in the open.
  {
    id: 'empbomb', name: 'EMP Bomb', kind: 'empbomb', mount: 'rockets',
    speed: 92, interval: 2.0, spread: 0.004,
    splash: { radius: 7, damage: 40, force: 5 },
    emp: { radius: 48, seconds: 7 },
    magazine: 4, reload: 5.2, shake: 0.32, sound: 'rpg',
  },
];

/** The arm by id, for the interface and the tests. */
export function armById(id) { return ARMS.find((a) => a.id === id) || null; }

/**
 * How far up and down a torso turns. The pilot's view is held to the same
 * number, so that where you are looking and where the guns are pointed cannot
 * come apart.
 */
export const MECH_PITCH = 0.7;

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

/** Shortest signed angle from a to b. */
function turnTowards(a, b, most) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + clamp(d, -most, most);
}

class Mech {
  constructor() { this.alive = false; }
}

export class Mechs {
  /**
   * @param {object} world the collision world
   * @param {(x,y,z)=>boolean} isSanctuary nothing walks into the memorial
   */
  constructor(world, isSanctuary) {
    this.world = world;
    this.isSanctuary = isSanctuary || (() => false);
    this.pool = [];
    for (let i = 0; i < 8; i++) this.pool.push(new Mech());
    this.active = [];
    this.piloted = null;
    this.enabled = true;
    this.onChaingun = null;    // fn(mech, from, dir, spec)
    this.onArmFire = null;     // fn(mech, from, dir, arm, extra) for the loadout
    this.onArmChange = null;   // fn(mech, arm)
    this.onReload = null;      // fn(mech, arm)
    this.onRockets = null;     // fn(mech, from, dir, spec)
    this.onStep = null;        // fn(mech, hard)
    this.onStomp = null;       // fn(mech, spec)
    this.onDestroyed = null;   // fn(mech)
    this.onEject = null;       // fn(mech) when the layer takes one out from under its pilot
  }

  get count() { return this.active.length; }

  reset() {
    // Whoever was flying one is standing in the street again, and is told so
    // before the machine goes: a pilot left holding a mech that is no longer
    // in the world has no weapons, no cockpit and no key to get out.
    const was = this.piloted;
    for (const m of this.pool) { m.alive = false; m.occupied = false; }
    this.active.length = 0;
    this.piloted = null;
    if (was && this.onEject) this.onEject(was);
  }

  free() { return this.pool.find((m) => !m.alive) || null; }

  /**
   * Puts one on the street.
   *
   * @param {string} type a key of MECH
   * @returns {object|null} the mech, or null when there is no room for one
   */
  spawn(type, x, z, yaw = 0) {
    const spec = MECH[type];
    if (!spec || !this.enabled) return null;
    if (this.isSanctuary(x, 0, z)) return null;
    const m = this.free();
    if (!m) return null;
    m.alive = true;
    m.type = type;
    m.spec = spec;
    m.mine = !!spec.mine;
    m.x = x;
    m.z = z;
    m.y = this.world.groundHeight(x, z);
    m.vy = 0;
    m.yaw = yaw;          // the legs
    m.torso = yaw;        // where the guns point
    m.pitch = 0;
    m.walk = 0;           // the stride phase
    m.speed = 0;
    m.health = spec.health;
    m.maxHealth = spec.health;
    m.hitFlash = 0;
    m.occupied = false;
    m.dying = 0;
    m.onGround = true;
    m.gunTimer = 0;
    m.burstLeft = 0;
    m.restLeft = 0;
    m.rocketTimer = spec.rockets.interval * Math.random();
    m.salvoLeft = 0;
    m.salvoTimer = 0;
    m.dashLeft = 0;
    m.dashCool = 0;
    m.stepAt = 0;
    // The loadout, for the ones that have one. A magazine per arm, so
    // switching away from an empty railgun and back does not refill it.
    // Each chassis arrives holding the weapon it was built round.
    m.arm = Math.max(0, ARMS.findIndex((a) => a.id === spec.arm));
    m.armTimer = 0;
    m.reloadLeft = 0;
    m.charge = 0;
    m.wasFiring = false;
    m.mags = ARMS.map((a) => a.magazine);
    // A shield over the hull that comes back when nothing has hit it for a
    // few seconds. It is what lets a mech walk into a street, take the first
    // volley and walk out again.
    m.shield = spec.shield ? spec.shield.max : 0;
    m.shieldMax = spec.shield ? spec.shield.max : 0;
    m.shieldWait = 0;
    // Stopped where it stands. An EMP warhead does this, and while it lasts
    // nothing about the machine works: not the legs, not the guns, and not
    // the shield, which is the whole point of putting one into it first.
    m.stun = 0;
    // How tall it is, on the body rather than only on the spec, because a
    // rocket that chases reads the height off whatever it is chasing and a
    // mech without one gets chased at the ankles.
    m.height = spec.height;
    this.active.push(m);
    return m;
  }

  /**
   * Drops one out of the sky.
   *
   * Same mech, same spawn, with two hundred metres of air underneath it and
   * enough speed to arrive like forty tonnes rather than settle like a leaf.
   * The landing goes through the ordinary stomp, which opens the road, with
   * the drop flag making it the heavier version.
   *
   * @returns {object|null}
   */
  drop(type, x, z, yaw = 0, height = TITANFALL.height, speed = TITANFALL.speed) {
    const m = this.spawn(type, x, z, yaw);
    if (!m) return null;
    m.y = this.world.groundHeight(x, z) + height;
    m.vy = -speed;
    m.onGround = false;
    m.dropping = true;
    return m;
  }

  /** The nearest of yours you could climb into. */
  nearest(x, z, within = 8) {
    let best = null;
    let bestD = within;
    for (const m of this.active) {
      if (!m.alive || !m.mine || m.occupied || m.health <= 0) continue;
      const d = Math.hypot(m.x - x, m.z - z);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  enter(m) {
    if (!m || !m.mine || m.occupied || m.health <= 0) return false;
    m.occupied = true;
    this.piloted = m;
    return true;
  }

  /** @returns {{x,z,y}|null} where to put the pilot down */
  leave() {
    const m = this.piloted;
    if (!m) return null;
    m.occupied = false;
    this.piloted = null;
    const side = m.yaw + Math.PI / 2;
    const x = m.x + Math.cos(side) * (m.spec.radius + 2.0);
    const z = m.z + Math.sin(side) * (m.spec.radius + 2.0);
    return { x, z, y: this.world.groundHeight(x, z) };
  }

  /**
   * Where a gun on this mech is in the world, from the mount point in the
   * body's own coordinates. The torso carries the guns, so this turns with
   * the torso and not with the legs.
   */
  muzzle(m, mount) {
    const c = Math.cos(m.torso), s = Math.sin(m.torso);
    return {
      x: m.x + c * mount[0] + s * mount[2],
      y: m.y + mount[1],
      z: m.z - s * mount[0] + c * mount[2],
    };
  }

  /**
   * Where the guns are pointed, as a point in the world rather than as a
   * direction: the first thing the torso's own line of sight runs into, or a
   * long way down that line when it runs into nothing.
   *
   * The guns are on the arms, two metres out from the middle of the body. A
   * gun that fired straight down its own barrel would put every round two
   * metres to the right of whatever the pilot was looking at, which at thirty
   * metres is a clean miss against something three metres wide. So they
   * converge on this point instead, the way a real gun mount is harmonised,
   * and what you are looking at is what you hit.
   */
  aimPoint(m, range) {
    const a = this.aim(m);
    const eye = { x: m.x, y: m.y + m.spec.eye, z: m.z };
    const hit = this.world.raycast(eye.x, eye.y, eye.z, a.x, a.y, a.z, range);
    const t = hit ? hit.t : range;
    return { x: eye.x + a.x * t, y: eye.y + a.y * t, z: eye.z + a.z * t };
  }

  /** From a gun to the point the torso is looking at, as a unit vector. */
  aimFrom(from, at) {
    const dx = at.x - from.x, dy = at.y - from.y, dz = at.z - from.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / l, y: dy / l, z: dz / l };
  }

  /** Which way the torso is pointing, as a unit vector including the pitch. */
  aim(m) {
    const cp = Math.cos(m.pitch);
    return {
      x: -Math.sin(m.torso) * cp,
      y: Math.sin(m.pitch),
      z: -Math.cos(m.torso) * cp,
    };
  }

  /**
   * Stops one where it stands, for a while.
   *
   * @returns {boolean} whether it was standing to begin with
   */
  stunFor(m, seconds) {
    if (!m || !m.alive || m.health <= 0) return false;
    m.stun = Math.max(m.stun || 0, seconds);
    // The shield goes with it. It is held up by the same electronics the
    // pulse has just stopped, and an EMP that left it standing would be a
    // weapon with nothing to recommend it over a shell: what this is for is
    // taking the armour off so that whatever arrives next lands on the hull.
    m.shield = 0;
    // And it does not start filling again until the machine has come back.
    m.shieldWait = Math.max(m.shieldWait, seconds);
    m.charge = 0;
    m.wasFiring = false;
    m.salvoLeft = 0;
    if (this.onStun) this.onStun(m, seconds);
    return true;
  }

  damage(m, amount) {
    if (!m.alive || m.health <= 0) return false;
    m.hitFlash = 1;
    if (m.shieldMax) {
      m.shieldWait = m.spec.shield.wait;
      if (m.shield > 0) {
        const soaked = Math.min(m.shield, amount);
        m.shield -= soaked;
        amount -= soaked;
        if (amount <= 0) return false;
      }
    }
    m.health -= amount;
    if (m.health > 0) return false;
    m.health = 0;
    m.dying = 0.01;
    if (m.occupied) { m.occupied = false; this.piloted = null; }
    if (this.onDestroyed) this.onDestroyed(m);
    return true;
  }

  /**
   * A ray against the mechs, so the player's weapons hit them the same way
   * they hit everything else. The body is a box: a tall one for the torso and
   * a wider, shorter one for the legs, which between them are close enough to
   * the silhouette that nothing is hit through a gap it did not deserve.
   *
   * @returns {{t:number, mech:object, core:boolean}|null}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    for (const m of this.active) {
      if (!m.alive || m.health <= 0) continue;
      const hit = this._hitBody(m, ox, oy, oz, dx, dy, dz, maxT);
      if (hit && (!best || hit.t < best.t)) best = { t: hit.t, mech: m, core: hit.core };
    }
    return best;
  }

  _hitBody(m, ox, oy, oz, dx, dy, dz, maxT) {
    const legs = this._hitBox(m, ox, oy, oz, dx, dy, dz, maxT,
      m.spec.radius * 0.8, 0, m.spec.height * 0.55);
    const torso = this._hitBox(m, ox, oy, oz, dx, dy, dz, maxT,
      m.spec.radius * 1.15, m.spec.height * 0.55, m.spec.height);
    if (torso && (!legs || torso < legs)) return { t: torso, core: true };
    if (legs) return { t: legs, core: false };
    return null;
  }

  /** Slab test against an axis aligned box round the mech. */
  _hitBox(m, ox, oy, oz, dx, dy, dz, maxT, r, y0, y1) {
    const minX = m.x - r, maxX = m.x + r;
    const minZ = m.z - r, maxZ = m.z + r;
    const minY = m.y + y0, maxY = m.y + y1;
    let t0 = 0, t1 = maxT;
    const slab = (o, d, lo, hi) => {
      if (Math.abs(d) < 1e-6) return o >= lo && o <= hi;
      let a = (lo - o) / d, b = (hi - o) / d;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      return t1 >= t0;
    };
    if (!slab(ox, dx, minX, maxX)) return null;
    if (!slab(oy, dy, minY, maxY)) return null;
    if (!slab(oz, dz, minZ, maxZ)) return null;
    return t0 > 0 ? t0 : null;
  }

  /**
   * One step of everything that is walking.
   *
   * @param {number} dt
   * @param {object} target where you are, for the ones hunting you
   * @param {object|null} controls what the pilot is asking for, when one of
   *   these is yours: {forward, strafe, yaw, pitch, fire, rockets, dash, jump}
   */
  update(dt, target, controls = null) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      m.hitFlash = Math.max(0, m.hitFlash - dt * 4);
      if (m.shieldMax && m.health > 0) {
        m.shieldWait = Math.max(0, m.shieldWait - dt);
        if (m.shieldWait <= 0 && m.shield < m.shieldMax) {
          m.shield = Math.min(m.shieldMax, m.shield + m.spec.shield.rate * dt);
        }
      }
      if (m.health <= 0) {
        // Down on one knee, then over, then gone.
        m.dying += dt;
        m.vy -= m.spec.gravity * dt;
        m.y = Math.max(this.world.groundHeight(m.x, m.z), m.y + m.vy * dt);
        if (m.dying > 12) { m.alive = false; this.active.splice(i, 1); }
        continue;
      }
      if (m.stun > 0) {
        // Dead on its feet. It still falls, and the ground still holds it up,
        // but it does not walk, aim or fire, and the shield does not come
        // back: the timer above was reset by the same hit that stopped it.
        m.stun -= dt;
        m.speed = 0;
        this._ground(m, dt);
        continue;
      }
      if (m.occupied && controls) this._pilot(m, dt, controls, target);
      else this._hunt(m, dt, target);
      this._ground(m, dt);
    }
  }

  // --- what a pilot asks for ------------------------------------------------

  _pilot(m, dt, c, target) {
    const s = m.spec;
    // The torso goes where you are looking, at once. The legs follow the way
    // the thing is actually travelling rather than the way the torso faces,
    // which is what stops it walking sideways across its own feet when you
    // strafe and looking as though it were walking backwards every time you
    // turned round: the legs were pointing where you looked while the body
    // moved somewhere else.
    m.torso = c.yaw;
    m.pitch = clamp(c.pitch, -MECH_PITCH, MECH_PITCH);

    if (m.dashCool > 0) m.dashCool -= dt;
    if (c.dash && m.dashLeft <= 0 && m.dashCool <= 0) {
      m.dashLeft = s.dash.seconds;
      m.dashCool = s.dash.cooldown;
    }
    if (m.dashLeft > 0) m.dashLeft -= dt;

    const speed = m.dashLeft > 0 ? s.dash.speed : s.walk;
    // Forward is where the torso points, so you walk where you look.
    const fx = -Math.sin(m.torso), fz = -Math.cos(m.torso);
    const rx = Math.cos(m.torso), rz = -Math.sin(m.torso);
    const wx = (fx * c.forward + rx * c.strafe) * speed;
    const wz = (fz * c.forward + rz * c.strafe) * speed;
    const going = Math.hypot(wx, wz) > 0.1 ? Math.atan2(-wx, -wz) : m.torso;
    m.yaw = turnTowards(m.yaw, going, s.turn * dt);
    this._move(m, dt, wx, wz);

    if (c.jump && m.onGround) { m.vy = s.jump; m.onGround = false; }

    this._guns(m, dt, c.fire, c.rockets);
  }

  // --- and what the other ones decide for themselves -----------------------

  _hunt(m, dt, target) {
    const s = m.spec;
    if (!target) return;
    const dx = target.x - m.x, dz = target.z - m.z;
    const away = Math.hypot(dx, dz) || 1;
    const want = Math.atan2(-dx, -dz);
    // The torso tracks you whatever the legs are doing.
    m.torso = turnTowards(m.torso, want, s.torsoTurn * dt);
    const eye = m.y + s.eye;
    const dy = (target.y + 1.4) - eye;
    m.pitch = clamp(Math.atan2(dy, away), -MECH_PITCH, MECH_PITCH);

    // Walk in until it is close enough to be a problem, then hold. Either
    // way the legs are turned to the way it is going rather than to the way
    // it is looking, so it walks rather than sliding sideways.
    let wx = 0, wz = 0;
    if (away > s.keep) {
      const fx = -Math.sin(want), fz = -Math.cos(want);
      wx = fx * s.walk; wz = fz * s.walk;
    } else {
      // Close in, it sidesteps rather than standing still, so a mech is not a
      // wall you can lean on.
      const side = (Math.floor(Math.abs(m.walk) / 6) % 2 === 0) ? 1 : -1;
      wx = Math.cos(want) * side * s.walk * 0.45;
      wz = -Math.sin(want) * side * s.walk * 0.45;
    }
    const going = Math.hypot(wx, wz) > 0.1 ? Math.atan2(-wx, -wz) : want;
    m.yaw = turnTowards(m.yaw, going, s.turn * dt);
    this._move(m, dt, wx, wz);

    const canSee = away < s.engage && this._lineOfSight(m, target);
    const rockets = s.rockets.minRange ? away > s.rockets.minRange : true;
    this._guns(m, dt, canSee, canSee && rockets && away < s.engage * 0.9);
  }

  _lineOfSight(m, target) {
    const from = this.muzzle(m, m.spec.chaingun.muzzle);
    const tx = target.x - from.x, ty = (target.y + 1.2) - from.y, tz = target.z - from.z;
    const l = Math.hypot(tx, ty, tz) || 1;
    const hit = this.world.raycast(from.x, from.y, from.z, tx / l, ty / l, tz / l, l);
    return !hit;
  }

  // --- guns -----------------------------------------------------------------

  /** Puts a different weapon in the hands, by index or by step. */
  selectArm(m, index) {
    if (!m.spec.arms) return m.arm;
    const n = ARMS.length;
    m.arm = ((index % n) + n) % n;
    m.charge = 0;
    m.reloadLeft = 0;
    m.armTimer = Math.max(m.armTimer, 0.25);
    if (this.onArmChange) this.onArmChange(m, ARMS[m.arm]);
    return m.arm;
  }

  cycleArm(m, step) { return this.selectArm(m, m.arm + (step > 0 ? 1 : -1)); }

  /** What is in its hands, and how much of it is left. */
  arm(m) { return m.spec.arms ? ARMS[m.arm] : null; }

  /**
   * The arm weapons, for a mech that carries them.
   *
   * One weapon at a time, each with its own magazine, its own rhythm and its
   * own way of leaving the barrel: a stream of rounds, a shell, a canister of
   * thermite, a charged bolt, or a wall of slugs. What each of those does
   * when it arrives is the game layer's business; this decides when, where
   * from and how much of it.
   */
  _armFire(m, dt, want) {
    const arm = ARMS[m.arm];
    if (m.armTimer > 0) m.armTimer -= dt;
    if (m.reloadLeft > 0) {
      m.reloadLeft -= dt;
      if (m.reloadLeft <= 0) m.mags[m.arm] = arm.magazine;
      m.charge = 0;
      m.wasFiring = false;
      return;
    }
    if (m.mags[m.arm] <= 0) {
      m.reloadLeft = arm.reload;
      if (this.onReload) this.onReload(m, arm);
      return;
    }

    // The railgun is the one that works differently: holding charges it and
    // letting go fires it, and a shot let go early is a weaker shot rather
    // than no shot at all.
    if (arm.kind === 'rail') {
      if (want) {
        m.charge = Math.min(arm.charge, m.charge + dt);
        m.wasFiring = true;
        return;
      }
      // Let go and it goes off. If the weapon is still in its own interval,
      // or has only just been brought up, the shot waits for that rather
      // than being thrown away: a charge you have held for a second is not
      // something to lose to a timer.
      if (!m.wasFiring) return;
      if (m.armTimer > 0) return;
      const k = clamp(m.charge / arm.charge, 0, 1);
      m.wasFiring = false;
      m.charge = 0;
      m.armTimer = arm.interval;
      m.mags[m.arm]--;
      this._leaveBarrel(m, arm, { charged: k });
      return;
    }

    if (!want || m.armTimer > 0) return;
    m.armTimer = arm.interval;
    m.mags[m.arm]--;
    this._leaveBarrel(m, arm, {});
  }

  /** Where a shot starts and which way it goes, then over to the game. */
  _leaveBarrel(m, arm, extra) {
    if (!this.onArmFire) return;
    const mount = arm.mount === 'rockets' ? m.spec.rockets.muzzle : m.spec.chaingun.muzzle;
    const from = this.muzzle(m, mount);
    const dir = this.aimFrom(from, this.aimPoint(m, arm.range || 400));
    this.onArmFire(m, from, dir, arm, extra);
  }

  _guns(m, dt, wantGun, wantRockets) {
    const s = m.spec;
    // A mech with a loadout fires that instead of the fixed chaingun.
    if (s.arms) {
      this._armFire(m, dt, wantGun);
      this._pod(m, dt, wantRockets);
      return;
    }
    const gun = s.chaingun;
    if (m.gunTimer > 0) m.gunTimer -= dt;
    if (m.restLeft > 0) m.restLeft -= dt;
    if (wantGun && m.gunTimer <= 0 && m.restLeft <= 0) {
      m.gunTimer = gun.interval;
      if (gun.burst) {
        if (m.burstLeft <= 0) m.burstLeft = gun.burst;
        m.burstLeft--;
        if (m.burstLeft <= 0) m.restLeft = gun.rest;
      }
      if (this.onChaingun) {
        const from = this.muzzle(m, gun.muzzle);
        this.onChaingun(m, from, this.aimFrom(from, this.aimPoint(m, gun.range)), gun);
      }
    }

    this._pod(m, dt, wantRockets);
  }

  /** The rocket pod, which every mech has whatever is in its hands. */
  _pod(m, dt, want) {
    const rockets = m.spec.rockets;
    if (m.rocketTimer > 0) m.rocketTimer -= dt;
    if (want && m.rocketTimer <= 0 && m.salvoLeft <= 0) {
      m.salvoLeft = rockets.salvo;
      m.salvoTimer = 0;
      m.rocketTimer = rockets.interval;
    }
    if (m.salvoLeft > 0) {
      m.salvoTimer -= dt;
      if (m.salvoTimer <= 0) {
        m.salvoTimer = rockets.gap;
        m.salvoLeft--;
        if (this.onRockets) {
          const from = this.muzzle(m, rockets.muzzle);
          this.onRockets(m, from, this.aimFrom(from, this.aimPoint(m, 400)), rockets);
        }
      }
    }
  }

  // --- walking --------------------------------------------------------------

  /**
   * A step across the ground, with the hull stopped by walls and walked round
   * them rather than into them.
   *
   * A mech that only stops at a wall is a mech that never arrives: the real
   * city is full of frontages, and one of these spawning two hundred metres
   * away with a building in between used to walk into it and stay there. So
   * when the way ahead is blocked it tries the two ways along the wall, keeps
   * whichever is clear for a second or two so it does not dither in a
   * doorway, and slides.
   */
  _move(m, dt, wx, wz) {
    const s = m.spec;
    const step = Math.hypot(wx, wz) * dt;
    if (step > 0.0001) {
      const len = Math.hypot(wx, wz) || 1;
      let dx = wx / len;
      let dz = wz / len;
      const clear = (ax, az, reach) => !this.world.raycast(
        m.x, m.y + s.height * 0.5, m.z, ax, 0, az, reach);
      const reach = step + s.radius + 1.5;
      m.slideLeft = (m.slideLeft || 0) - dt;
      if (!clear(dx, dz, reach)) {
        // Blocked. Try along the wall, keeping the side it picked last time
        // while that side is still open.
        const left = [-dz, dx];
        const right = [dz, -dx];
        const side = m.slideLeft > 0 && m.slideSide
          ? m.slideSide
          : (clear(left[0], left[1], s.radius + 6) ? left
            : (clear(right[0], right[1], s.radius + 6) ? right : null));
        if (side && clear(side[0], side[1], s.radius + 2)) {
          m.slideSide = side;
          m.slideLeft = 1.6;
          dx = side[0]; dz = side[1];
          wx = dx * len * 0.8; wz = dz * len * 0.8;
        } else {
          dx = 0; dz = 0; wx = 0; wz = 0;
        }
      }
      if (dx !== 0 || dz !== 0) {
        const nx = m.x + wx * dt, nz = m.z + wz * dt;
        if (!this.isSanctuary(nx, 0, nz)) { m.x = nx; m.z = nz; }
      }
      m.speed = Math.hypot(wx, wz);
      // The stride, and a footfall twice a cycle. Its sign is the sign of the
      // travel along the legs' own facing: going backwards plays the cycle
      // backwards, which is the difference between stepping back and
      // moonwalking.
      const lx = -Math.sin(m.yaw), lz = -Math.cos(m.yaw);
      const sense = (wx * lx + wz * lz) >= 0 ? 1 : -1;
      const was = m.walk;
      m.walk += dt * (2.2 + m.speed * 0.26) * sense;
      if (Math.floor(was / Math.PI) !== Math.floor(m.walk / Math.PI) && m.onGround) {
        if (this.onStep) this.onStep(m, m.speed > s.walk * 0.9);
      }
    } else {
      m.speed = 0;
      m.walk += dt * 0.6;
    }
  }

  /** Gravity, the ground, and what a landing does. */
  _ground(m, dt) {
    const s = m.spec;
    const floor = this.world.groundHeight(m.x, m.z);
    m.vy -= s.gravity * dt;
    m.y += m.vy * dt;
    if (m.y <= floor + 0.001) {
      const fell = m.vy;
      m.y = floor;
      m.vy = 0;
      if (!m.onGround && this.onStomp && (m.dropping || (s.stomp && fell < -s.stomp.speed))) {
        // A drop lands harder than a jump, because it has come two hundred
        // metres rather than three.
        const stomp = s.stomp || MECH.titan.stomp;
        this.onStomp(m, m.dropping
          ? { ...stomp, radius: stomp.radius * 1.8, damage: stomp.damage * 1.6 }
          : stomp, m.dropping);
        m.dropping = false;
      }
      m.onGround = true;
    } else if (m.onGround && m.y - floor < s.climb && m.vy <= 0) {
      // A kerb, a step, a pile of rubble: it walks up it rather than falling
      // off and landing again. Only while it is already walking, though: this
      // test used to catch a jump on the way down as well, which quietly
      // cancelled the landing and with it every stomp.
      m.y = floor;
      m.vy = 0;
      m.onGround = true;
    } else {
      m.onGround = false;
    }
  }
}
