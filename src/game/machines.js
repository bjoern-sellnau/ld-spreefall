// Rise of the Machines.
//
// A second way to play the same city. The sun is gone, the sky is the colour
// of a dead screen, warheads come down every few seconds somewhere on the
// skyline, and the things walking the streets are not people: steel skeletons
// with a red eye each, which hum while they look for you and shoot a beam
// when they find you.
//
// Nothing here is a new enemy type. A machine is a soldier with a different
// body, a different gun and no skin, because the soldier already knows how to
// take cover behind a real wall and how to lose you when you break line of
// sight, and that behaviour is the expensive part. What this module owns is
// the mode itself: what it changes, how fast the sky falls in, and what an
// EMP does to a machine.

export const MACHINES = {
  // How often a warhead lands somewhere while this is running. The ordinary
  // nuke rain is every five to nine seconds; this is the end of the world.
  rainEvery: 2.6,
  rainSpread: 1.4,
  // The look: the time of day is chosen on the title screen, but the fog and
  // the sky are the mode's own.
  fog: 0.0023,
  skyZenith: [0.055, 0.060, 0.075],
  skyHorizon: [0.30, 0.16, 0.10],
  sunColour: [0.95, 0.42, 0.22],
  // How many machines are kept walking, and how far out they come in. This
  // is an army rather than a patrol: the soldier layer holds twenty four at
  // once and the mode runs the streets right up to that, because a handful of
  // figures in the distance is not what the end of the world looks like.
  patrol: 22,
  spawnEvery: 1.1,
  spawnFrom: 70,
  spawnTo: 220,
  // The beam. It is hitscan like a rifle, but it is slower to line up and it
  // is visible for a moment, so being shot at is something you can see coming
  // from across a square.
  beam: { damage: 18, interval: 1.15, charge: 0.45, range: 190 },
  // What an EMP does to one.
  stun: { seconds: 7.5, radius: 34, damageMultiplier: 4 },
  // And the heavy ones. Two at a time is plenty: a Reaper is eight metres of
  // walking gun and the city is not wide enough for a herd of them.
  mechs: 2,
  mechEvery: 14,
  mechFrom: 90,
  mechTo: 200,
};

/**
 * The mode. It holds no entities of its own: it turns things on and off and
 * answers questions about what the world should look like while it is on.
 */
export class Machines {
  constructor() {
    this.active = false;
    this.timeOfDay = 20.2;
    this.spawnTimer = 0;
    this.rainTimer = 0;
    this.mechTimer = 6;
    this.kills = 0;
  }

  /** @param {boolean} on */
  set(on) {
    this.active = !!on;
    this.spawnTimer = 0;
    this.rainTimer = 0;
    this.mechTimer = 6;
    return this.active;
  }

  /** How long until the next warhead, in this mode's own time. */
  tickRain(dt) {
    if (!this.active) return false;
    this.rainTimer -= dt;
    if (this.rainTimer > 0) return false;
    this.rainTimer = MACHINES.rainEvery + Math.random() * MACHINES.rainSpread;
    return true;
  }

  /** Whether another Reaper should be walked in. */
  tickMech(dt, standing) {
    if (!this.active) return false;
    this.mechTimer = (this.mechTimer || 0) - dt;
    if (this.mechTimer > 0) return false;
    this.mechTimer = MACHINES.mechEvery;
    return standing < MACHINES.mechs;
  }

  /** Whether another machine should be put on the street this frame. */
  tickSpawn(dt, standing) {
    if (!this.active) return false;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return false;
    this.spawnTimer = MACHINES.spawnEvery;
    return standing < MACHINES.patrol;
  }
}

/**
 * Turns a soldier into a machine.
 *
 * Everything the soldier layer already does carries on working: it walks, it
 * takes cover, it loses you behind a wall. What changes is what it is made of
 * and what it shoots with.
 */
export function makeMachine(s) {
  s.machine = true;
  // The body is the skeleton the ion cannon leaves, and it is steel rather
  // than bone because of the flag, not because of a second mesh.
  s.charred = 1;
  s.stunLeft = 0;
  s.beamCharge = 0;
  s.hum = Math.random() * 6.283;
  s.health = Math.round(s.health * 1.35);
  s.maxHealth = s.health;
  return s;
}

/**
 * An EMP going off. Everything metal within the radius stops, and stays
 * stopped long enough for you to walk up to it.
 *
 * @returns {number} how many were caught
 */
export function empBurst(soldiers, drones, x, y, z, radius = MACHINES.stun.radius) {
  let caught = 0;
  for (const s of soldiers) {
    if (!s.machine || !s.alive) continue;
    if (Math.hypot(s.x - x, s.z - z) > radius) continue;
    s.stunLeft = MACHINES.stun.seconds;
    s.beamCharge = 0;
    caught++;
  }
  for (const d of drones) {
    if (Math.hypot(d.x - x, d.z - z) > radius) continue;
    // A drone has nothing to stand on when its motors stop.
    d.stunLeft = MACHINES.stun.seconds;
    caught++;
  }
  return caught;
}
