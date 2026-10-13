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
      salvo: 4, gap: 0.22, interval: 7.0, speed: 92, minRange: 55,
      splash: { radius: 11, damage: 120, force: 16 }, muzzle: [-2.05, 6.3, -1.4],
    },
  },
  // Yours. Faster, tougher, with a dash and a landing that opens the street.
  titan: {
    name: 'Titan',
    mine: true,
    height: 7.0, radius: 2.4, eye: 6.3,
    // Where the camera hangs. Behind and above, like everything else you can
    // get into here: a mech is a thing worth looking at, and the inside of
    // one is no more modelled than the inside of a tank.
    chase: 17, chaseUp: 9.5,
    health: 3600,
    walk: 11.5, turn: 2.6, torsoTurn: 5.0, climb: 1.6, gravity: 22,
    jump: 11.5,
    dash: { speed: 27, seconds: 0.85, cooldown: 3.6 },
    chaingun: {
      damage: 24, interval: 0.075, burst: 0, rest: 0,
      spread: 0.022, range: 260, muzzle: [2.05, 5.6, -3.2],
    },
    rockets: {
      salvo: 6, gap: 0.09, interval: 3.4, speed: 115,
      splash: { radius: 14, damage: 230, force: 22 }, muzzle: [-2.05, 6.3, -1.4],
    },
    // What a forty tonne landing does to whatever is standing under it.
    stomp: { radius: 11, damage: 420, force: 26, speed: 9 },
  },
};

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
    this.onRockets = null;     // fn(mech, from, dir, spec)
    this.onStep = null;        // fn(mech, hard)
    this.onStomp = null;       // fn(mech, spec)
    this.onDestroyed = null;   // fn(mech)
  }

  get count() { return this.active.length; }

  reset() {
    for (const m of this.pool) m.alive = false;
    this.active.length = 0;
    this.piloted = null;
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
    this.active.push(m);
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

  damage(m, amount) {
    if (!m.alive || m.health <= 0) return false;
    m.health -= amount;
    m.hitFlash = 1;
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
      if (m.health <= 0) {
        // Down on one knee, then over, then gone.
        m.dying += dt;
        m.vy -= m.spec.gravity * dt;
        m.y = Math.max(this.world.groundHeight(m.x, m.z), m.y + m.vy * dt);
        if (m.dying > 12) { m.alive = false; this.active.splice(i, 1); }
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
    // The torso goes where you are looking, at once; the legs follow it, which
    // is what makes turning feel like forty tonnes rather than like a mouse.
    m.torso = c.yaw;
    m.pitch = clamp(c.pitch, -0.7, 0.7);
    m.yaw = turnTowards(m.yaw, m.torso, s.turn * dt);

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
    m.pitch = clamp(Math.atan2(dy, away), -0.7, 0.7);

    // Walk in until it is close enough to be a problem, then hold.
    if (away > s.keep) {
      m.yaw = turnTowards(m.yaw, want, s.turn * dt);
      const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
      this._move(m, dt, fx * s.walk, fz * s.walk);
    } else {
      // Close in, it sidesteps rather than standing still, so a mech is not a
      // wall you can lean on.
      const side = (Math.floor(m.walk / 6) % 2 === 0) ? 1 : -1;
      const rx = Math.cos(m.yaw) * side, rz = -Math.sin(m.yaw) * side;
      m.yaw = turnTowards(m.yaw, want, s.turn * dt);
      this._move(m, dt, rx * s.walk * 0.45, rz * s.walk * 0.45);
    }

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

  _guns(m, dt, wantGun, wantRockets) {
    const s = m.spec;
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

    const rockets = s.rockets;
    if (m.rocketTimer > 0) m.rocketTimer -= dt;
    if (wantRockets && m.rocketTimer <= 0 && m.salvoLeft <= 0) {
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
      // The stride, and a footfall twice a cycle.
      const was = m.walk;
      m.walk += dt * (2.2 + m.speed * 0.26);
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
      if (!m.onGround && s.stomp && fell < -s.stomp.speed && this.onStomp) {
        this.onStomp(m, s.stomp);
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
