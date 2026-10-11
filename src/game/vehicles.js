// Things you can get into and drive or fly.
//
// Four of them, and they divide into two kinds rather than four: something
// with wheels or tracks that follows the ground, and something with rotors or
// wings that does not. Everything else is numbers. A tank is a jeep that is
// slow, heavy, turns badly and hits very hard; a jet is a helicopter that
// cannot hover and falls out of the sky below a hundred and forty kilometres
// an hour.
//
// They collide against the same world everything else in this project does:
// the ground height field under the wheels and the collision segments in
// front of the bumper, from the same raycast the bullets use. Nothing here
// has a physics library behind it and nothing here needs one.

export const KIND = { GROUND: 'ground', AIR: 'air' };

export const VEHICLE = {
  jeep: {
    name: 'Jeep', kind: KIND.GROUND,
    topSpeed: 24, reverse: 8, accel: 14, brake: 22, drag: 0.8,
    turn: 1.9, turnAtSpeed: 0.55,
    health: 420, mass: 1,
    // Where you sit, and where the camera hangs behind you.
    eye: 1.55, chase: 9.5, chaseUp: 3.4,
    radius: 1.5, length: 4.4,
    gun: { kind: 'hitscan', damage: 26, interval: 0.09, spread: 0.022, muzzle: [0, 1.9, -1.2] },
    climb: 0.9,          // the tallest kerb it will go up
  },
  tank: {
    name: 'Tank', kind: KIND.GROUND,
    topSpeed: 12, reverse: 5, accel: 6, brake: 10, drag: 1.4,
    turn: 0.85, turnAtSpeed: 0.8,
    health: 2600, mass: 4,
    eye: 2.5, chase: 15, chaseUp: 5.5,
    radius: 2.1, length: 7.4,
    gun: { kind: 'shell', damage: 240, interval: 2.6, spread: 0.004, muzzle: [0, 2.5, -5.0],
      speed: 160, splash: { radius: 11, damage: 260 } },
    climb: 1.4,
  },
  heli: {
    name: 'Helicopter', kind: KIND.AIR,
    topSpeed: 52, accel: 16, drag: 0.55,
    lift: 16, gravity: 9.8, maxClimb: 14,
    turn: 1.2, pitchRate: 0.9, rollRate: 1.6, bank: 0.55,
    health: 700, mass: 2,
    eye: 1.8, chase: 14, chaseUp: 4.5,
    radius: 3.2,
    gun: { kind: 'hitscan', damage: 34, interval: 0.075, spread: 0.018, muzzle: [0, -0.6, -3.2] },
    rocket: { interval: 0.5, speed: 110, splash: { radius: 13, damage: 190 } },
  },
  jet: {
    name: 'Fighter', kind: KIND.AIR,
    topSpeed: 180, accel: 34, drag: 0.08,
    lift: 0, gravity: 9.8, maxClimb: 90,
    // Below this it stops flying and starts falling, which is the whole
    // difference between this and the helicopter.
    stall: 38,
    turn: 0.5, pitchRate: 0.85, rollRate: 2.4, bank: 1.0,
    health: 900, mass: 2,
    eye: 1.2, chase: 26, chaseUp: 6,
    radius: 4.5,
    gun: { kind: 'hitscan', damage: 44, interval: 0.06, spread: 0.012, muzzle: [0, -0.3, -7] },
    rocket: { interval: 0.9, speed: 190, splash: { radius: 22, damage: 420 } },
  },
};

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

class Vehicle {
  constructor() { this.alive = false; }
}

export class Vehicles {
  /**
   * @param {object} world for the ground and the walls
   * @param {(x,y,z)=>boolean} isSanctuary nothing is parked in the memorial
   */
  constructor(world, isSanctuary) {
    this.world = world;
    this.isSanctuary = isSanctuary || (() => false);
    this.pool = [];
    for (let i = 0; i < 24; i++) this.pool.push(new Vehicle());
    this.active = [];
    this.driving = null;        // the one you are in, if any
    this.onFire = null;         // fn(vehicle, shot) for the gun
    this.onLaunch = null;       // fn(vehicle, spec) for a rocket or a shell
    this.onDestroyed = null;
    this.onBump = null;         // fn(vehicle, speed) when it hits something
  }

  reset() {
    for (const v of this.pool) v.alive = false;
    this.active.length = 0;
    this.driving = null;
  }

  free() { return this.pool.find((v) => !v.alive) || null; }

  /**
   * Puts one somewhere.
   * @param {string} type a key of VEHICLE
   * @returns {object|null}
   */
  spawn(type, x, z, yaw = 0, height = 0) {
    const spec = VEHICLE[type];
    if (!spec) return null;
    if (this.isSanctuary(x, 0, z)) return null;
    const v = this.free();
    if (!v) return null;
    v.alive = true;
    v.type = type;
    v.spec = spec;
    v.x = x;
    v.z = z;
    v.y = this.world.groundHeight(x, z) + (spec.kind === KIND.AIR ? height : 0);
    v.yaw = yaw;
    v.pitch = 0;
    v.roll = 0;
    v.speed = 0;
    v.vy = 0;
    v.health = spec.health;
    v.maxHealth = spec.health;
    v.hitFlash = 0;
    v.cooldown = 0;
    v.rocketCooldown = 0;
    v.rotor = 0;
    v.throttle = 0;
    v.occupied = false;
    v.dying = 0;
    v.grounded = spec.kind === KIND.GROUND || height <= 0;
    this.active.push(v);
    return v;
  }

  /** The nearest one you could get into, or null. */
  nearest(x, z, within = 6) {
    let best = null;
    let bestD = within;
    for (const v of this.active) {
      if (!v.alive || v.occupied || v.health <= 0) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  enter(v) {
    if (!v || v.occupied || v.health <= 0) return false;
    v.occupied = true;
    this.driving = v;
    return true;
  }

  /** @returns {{x,z,y}|null} where to put the driver down */
  leave() {
    const v = this.driving;
    if (!v) return null;
    v.occupied = false;
    this.driving = null;
    // Out of the left hand side, on the ground under it.
    const side = v.yaw + Math.PI / 2;
    const x = v.x + Math.cos(side) * (v.spec.radius + 1.4);
    const z = v.z + Math.sin(side) * (v.spec.radius + 1.4);
    return { x, z, y: this.world.groundHeight(x, z) };
  }

  damage(v, amount) {
    if (!v.alive || v.health <= 0) return false;
    v.health -= amount;
    v.hitFlash = 1;
    if (v.health > 0) return false;
    v.health = 0;
    v.dying = 0.01;
    if (v.occupied) { v.occupied = false; this.driving = null; }
    if (this.onDestroyed) this.onDestroyed(v);
    return true;
  }

  /**
   * @param {object} controls what the driver is asking for:
   *   throttle -1..1, steer -1..1, lift -1..1, pitch, roll, fire, secondary
   */
  update(dt, controls, time) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const v = this.active[i];
      v.hitFlash = Math.max(0, v.hitFlash - dt * 4);
      if (v.spec.kind === KIND.AIR) v.rotor += dt * (v.health > 0 ? 26 : 4);

      if (v.health <= 0) {
        // Down. Air falls, ground stops, and after a while it is gone.
        v.dying += dt;
        if (v.spec.kind === KIND.AIR) {
          v.vy -= 16 * dt;
          v.y += v.vy * dt;
          v.x += Math.sin(v.yaw) * -v.speed * dt;
          v.z += Math.cos(v.yaw) * -v.speed * dt;
          v.roll += dt * 2.2;
          v.pitch -= dt * 0.8;
          const g = this.world.groundHeight(v.x, v.z);
          if (v.y <= g) { v.y = g; v.vy = 0; v.speed *= 0.2; }
        } else {
          v.speed *= Math.max(0, 1 - 3 * dt);
        }
        if (v.dying > 14) { v.alive = false; this.active.splice(i, 1); }
        continue;
      }

      const c = v === this.driving ? controls : null;
      if (v.spec.kind === KIND.GROUND) this._drive(v, dt, c);
      else this._fly(v, dt, c);

      if (v.cooldown > 0) v.cooldown -= dt;
      if (v.rocketCooldown > 0) v.rocketCooldown -= dt;
      if (c) this._shoot(v, c, dt);
    }
  }

  // --- a thing with wheels -------------------------------------------------

  _drive(v, dt, c) {
    const s = v.spec;
    const throttle = c ? c.throttle : 0;
    const steer = c ? c.steer : 0;

    if (throttle > 0) v.speed += s.accel * throttle * dt;
    else if (throttle < 0) v.speed += s.accel * 0.7 * throttle * dt;
    if (c && c.brake) v.speed -= Math.sign(v.speed) * s.brake * dt;
    // Drag, always.
    v.speed -= v.speed * s.drag * dt;
    if (Math.abs(v.speed) < 0.05) v.speed = 0;
    v.speed = clamp(v.speed, -s.reverse, s.topSpeed);

    // Steering is worth less the faster you are going, which is what stops a
    // jeep at full speed turning on the spot.
    const grip = 1 - clamp(Math.abs(v.speed) / s.topSpeed, 0, 1) * s.turnAtSpeed;
    // And nothing turns while it is standing still, except a tank, which
    // turns on its tracks.
    const rolling = s === VEHICLE.tank ? 1 : clamp(Math.abs(v.speed) / 3, 0, 1);
    v.yaw += steer * s.turn * grip * rolling * dt * Math.sign(v.speed || 1);

    const step = v.speed * dt;
    if (step !== 0) {
      const dx = Math.sin(v.yaw) * -1, dz = Math.cos(v.yaw) * -1;
      const dir = step > 0 ? 1 : -1;
      // What is in front of the bumper, from the same raycast the bullets
      // use. A vehicle that drove through walls would make the whole city a
      // decoration.
      const hit = this.world.raycast(v.x, v.y + 1.0, v.z,
        dx * dir, 0, dz * dir, Math.abs(step) + s.length * 0.5);
      if (hit && hit.kind === 'wall') {
        if (this.onBump) this.onBump(v, Math.abs(v.speed));
        v.speed *= -0.15;
      } else {
        v.x += dx * step;
        v.z += dz * step;
      }
    }

    // Follow the ground, and refuse anything steeper than it can climb.
    const g = this.world.groundHeight(v.x, v.z);
    const rise = g - v.y;
    if (rise > s.climb) {
      // Too steep: back off and lose the speed into it.
      v.x -= Math.sin(v.yaw) * -v.speed * dt;
      v.z += Math.cos(v.yaw) * v.speed * dt;
      v.speed *= -0.1;
    } else {
      v.y += rise * Math.min(1, dt * 12);
    }

    // Pitch and roll from the slope, so it leans into a kerb.
    const ahead = this.world.groundHeight(v.x - Math.sin(v.yaw) * 2.5,
      v.z + Math.cos(v.yaw) * 2.5);
    const side = this.world.groundHeight(v.x + Math.cos(v.yaw) * 1.5,
      v.z + Math.sin(v.yaw) * 1.5);
    const wantPitch = clamp(Math.atan2(ahead - v.y, 2.5), -0.5, 0.5);
    const wantRoll = clamp(Math.atan2(side - v.y, 1.5), -0.4, 0.4);
    v.pitch += (wantPitch - v.pitch) * Math.min(1, dt * 6);
    v.roll += (wantRoll - v.roll) * Math.min(1, dt * 6);
  }

  // --- a thing with rotors or wings ---------------------------------------

  _fly(v, dt, c) {
    const s = v.spec;
    const throttle = c ? c.throttle : 0;
    const steer = c ? c.steer : 0;
    const pitchIn = c ? c.pitch : 0;
    const rollIn = c ? c.roll : 0;
    const lift = c ? c.lift : 0;

    v.throttle += (clamp(throttle, s.stall ? 0 : -1, 1) - v.throttle) * Math.min(1, dt * 2);

    if (s.stall === undefined) {
      // A helicopter. Thrust is up out of its own rotor disc, so pitching
      // forward is what makes it go forward, and the throttle is speed.
      v.speed += (v.throttle * s.topSpeed - v.speed) * Math.min(1, dt * s.accel / 10);
      v.speed -= v.speed * s.drag * dt;
      v.vy += (lift * s.maxClimb - v.vy) * Math.min(1, dt * 2.2);
      // It sinks when nobody is holding it up.
      if (!c) v.vy -= s.gravity * dt * 0.4;
    } else {
      // A fighter. Thrust is forward and lift comes out of going fast; below
      // the stall it stops flying.
      v.speed += (v.throttle * s.topSpeed - v.speed) * Math.min(1, dt * s.accel / 60);
      v.speed = Math.max(0, v.speed - v.speed * s.drag * dt);
      const flying = clamp(v.speed / s.stall, 0, 1);
      // Where the nose is pointing decides where it goes, once it is flying.
      v.vy = Math.sin(v.pitch) * v.speed * flying - s.gravity * (1 - flying) * 2.2;
    }

    v.yaw += steer * s.turn * dt;
    v.pitch = clamp(v.pitch + pitchIn * s.pitchRate * dt, -1.2, 1.2);
    v.roll = clamp(v.roll + rollIn * s.rollRate * dt, -1.4, 1.4);
    // Banking turns you, which is how an aircraft actually changes heading.
    v.yaw -= Math.sin(v.roll) * s.bank * dt;
    if (!rollIn) v.roll += (0 - v.roll) * Math.min(1, dt * 1.4);
    if (!pitchIn && s.stall === undefined) v.pitch += (0 - v.pitch) * Math.min(1, dt * 1.8);

    const fwd = Math.cos(v.pitch) * v.speed;
    v.x += Math.sin(v.yaw) * -fwd * dt;
    v.z += Math.cos(v.yaw) * -fwd * dt;
    v.y += v.vy * dt;

    // The ground, and anything standing on it. Only something that was in
    // the air a moment ago can land hard: a parked aircraft is pressed into
    // the ground by its own weight every frame, and counting that as an
    // impact destroys it where it stands, which is exactly what the first
    // version of this did.
    const g = this.world.groundHeight(v.x, v.z) + s.radius * 0.6;
    if (v.y < g) {
      const impact = v.grounded ? 0 : Math.max(0, -v.vy) + Math.abs(v.speed) * 0.3;
      v.y = g;
      v.vy = 0;
      v.grounded = true;
      if (impact > 14) {
        if (this.onBump) this.onBump(v, impact);
        this.damage(v, impact * 12);
      } else {
        v.speed *= 0.86;
      }
    } else {
      v.grounded = false;
    }
    // And walls, but only when it is actually moving into one: a parked
    // aircraft with a building beside it is parked, not crashing.
    const hit = Math.abs(fwd) < 1 ? null : this.world.raycast(v.x, v.y, v.z,
      Math.sin(v.yaw) * -1, 0, Math.cos(v.yaw) * -1, Math.abs(fwd) * dt + s.radius);
    if (hit && hit.kind === 'wall') {
      if (this.onBump) this.onBump(v, Math.abs(v.speed));
      this.damage(v, Math.abs(v.speed) * 9);
      v.speed *= -0.1;
    }
  }

  // --- what they shoot -----------------------------------------------------

  _shoot(v, c, dt) {
    const s = v.spec;
    if (c.fire && s.gun && v.cooldown <= 0) {
      v.cooldown = s.gun.interval;
      if (this.onFire) this.onFire(v, s.gun);
    }
    if (c.secondary && s.rocket && v.rocketCooldown <= 0) {
      v.rocketCooldown = s.rocket.interval;
      if (this.onLaunch) this.onLaunch(v, s.rocket);
    }
  }

  /** Where the gun is, in the world. */
  muzzle(v) {
    const m = v.spec.gun.muzzle;
    const c = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    return {
      x: v.x + m[0] * c - m[2] * sn,
      y: v.y + m[1],
      z: v.z + m[0] * sn + m[2] * c,
    };
  }

  /** A sphere around the hull, for the bullets and the blasts. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    let hit = null;
    for (const v of this.active) {
      if (!v.alive || v.health <= 0) continue;
      const r = v.spec.radius;
      const cy = v.y + r * 0.7;
      const ex = v.x - ox, ey = cy - oy, ez = v.z - oz;
      const t = ex * dx + ey * dy + ez * dz;
      if (t < 0 || t > best) continue;
      const d = Math.hypot(ex - dx * t, ey - dy * t, ez - dz * t);
      if (d > r) continue;
      best = t;
      hit = { t, target: v, kind: 'vehicle', core: false };
    }
    return hit;
  }

  get count() { return this.active.length; }
}
