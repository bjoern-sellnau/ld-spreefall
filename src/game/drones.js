// The things you shoot. Autonomous quadrotors that patrol the city, notice you
// when they have a clear line, close in and fire, and break off when hurt.
//
// Deliberately not people. This is a photoreal reconstruction of a real city
// including a memorial to murdered people, and human targets in it would be
// grotesque. Machines also make the harder and more interesting problem:
// something that has to fly around real buildings, hold a line of sight through
// a real street grid, and be tracked in three dimensions rather than two.

const STATE = { PATROL: 0, PURSUE: 1, ATTACK: 2, EVADE: 3, DYING: 4 };
export const DRONE_STATE = STATE;

const MAX_DRONES = 48;

function rand(a, b) { return a + Math.random() * (b - a); }

export class Drone {
  constructor() { this.alive = false; }

  spawn(x, y, z, tier) {
    this.alive = true;
    this.state = STATE.PATROL;
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.tilt = 0;
    this.roll = 0;
    this.maxHealth = 100 + tier * 20;
    this.health = this.maxHealth;
    this.seed = Math.random();
    this.spin = rand(28, 38);
    this.rotor = Math.random() * Math.PI * 2;
    this.cruise = rand(9, 15) + tier * 0.8;
    this.speed = rand(6.5, 9.5) + tier * 0.9;
    this.fireCooldown = rand(1.2, 3.0);
    this.burst = 0;
    this.stateTime = 0;
    this.targetX = x; this.targetY = y; this.targetZ = z;
    this.lastSeen = -999;
    this.deathTime = 0;
    this.hitFlash = 0;
    this.tier = tier;
    return this;
  }

  get radius() { return 0.85; }
  /** The small bright core. Hitting it counts double. */
  get coreRadius() { return 0.34; }
}

export class Drones {
  /**
   * @param {World} world
   * @param {(x:number,y:number,z:number)=>boolean} isSanctuary weapons free zone test
   */
  constructor(world, isSanctuary) {
    this.world = world;
    this.isSanctuary = isSanctuary || (() => false);
    this.pool = [];
    for (let i = 0; i < MAX_DRONES; i++) this.pool.push(new Drone());
    this.active = [];
    this.spawnTimer = 2.5;
    this.tier = 0;
    this.kills = 0;
    this.onShot = null;      // fn(drone, damageToPlayer)
    this.onDeath = null;     // fn(drone)
    this.enabled = true;
    // Drones are the garnish, not the meal. They own the sky and are visible
    // from everywhere, so a handful of them reads as far more than a handful.
    this.budget = 2;
    this._los = { t: 0, next: 0 };
  }

  reset() {
    for (const d of this.pool) d.alive = false;
    this.active.length = 0;
    this.spawnTimer = 2.5;
    this.tier = 0;
    this.kills = 0;
  }

  setTier(tier) {
    this.tier = tier;
    this.budget = Math.min(7, 2 + tier);
  }

  free() { return this.pool.find((d) => !d.alive) || null; }

  /** Somewhere in the air, off to one side, with a roof or a street below it. */
  spawnNear(px, pz, minR, maxR) {
    const d = this.free();
    if (!d) return null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(minR, maxR);
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;
      if (x < this.world.minX + 20 || x > this.world.maxX - 20) continue;
      if (z < this.world.minZ + 20 || z > this.world.maxZ - 20) continue;
      if (this.isSanctuary(x, 0, z)) continue;
      const g = this.world.groundHeight(x, z);
      const y = g + rand(22, 46);
      d.spawn(x, y, z, this.tier);
      this.active.push(d);
      return d;
    }
    return null;
  }

  damage(drone, amount) {
    if (!drone.alive || drone.state === STATE.DYING) return false;
    drone.health -= amount;
    drone.hitFlash = 1;
    if (drone.health <= 0) {
      drone.state = STATE.DYING;
      drone.stateTime = 0;
      drone.deathTime = 0;
      // A dying rotor throws it sideways before it drops.
      drone.vx += rand(-4, 4);
      drone.vz += rand(-4, 4);
      drone.vy = rand(1, 3);
      this.kills++;
      if (this.onDeath) this.onDeath(drone);
      return true;
    }
    if (drone.state === STATE.ATTACK && Math.random() < 0.4) {
      drone.state = STATE.EVADE;
      drone.stateTime = 0;
    }
    return false;
  }

  /** Steer away from anything solid within a couple of metres. */
  _avoid(d, dt) {
    const w = this.world;
    const probe = 6.0;
    let ax = 0, az = 0;
    // Four horizontal probes, cheap and enough for a flier that is not trying
    // to thread a doorway.
    for (let i = 0; i < 4; i++) {
      const a = d.yaw + i * (Math.PI / 2);
      const dx = Math.cos(a), dz = Math.sin(a);
      const h = w.raycast(d.x, d.y, d.z, dx, 0, dz, probe);
      if (h) {
        const push = (probe - h.t) / probe;
        ax -= dx * push * 34;
        az -= dz * push * 34;
      }
    }
    const ground = w.groundHeight(d.x, d.z);
    const clearance = d.y - ground;
    if (clearance < 8) d.vy += (8 - clearance) * 2.2 * dt;
    if (clearance > 70) d.vy -= (clearance - 70) * 0.6 * dt;
    d.vx += ax * dt;
    d.vz += az * dt;
  }

  _pickPatrolTarget(d, px, pz) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(40, 130);
    let x = d.x + Math.cos(a) * r;
    let z = d.z + Math.sin(a) * r;
    // Drift back towards the player so the city does not empty out behind you.
    x += (px - d.x) * 0.25;
    z += (pz - d.z) * 0.25;
    x = Math.min(this.world.maxX - 15, Math.max(this.world.minX + 15, x));
    z = Math.min(this.world.maxZ - 15, Math.max(this.world.minZ + 15, z));
    d.targetX = x;
    d.targetZ = z;
    d.targetY = this.world.groundHeight(x, z) + rand(16, 44);
  }

  /**
   * @param {number} dt fixed step seconds
   * @param {{x:number,y:number,z:number,alive:boolean}} player eye position
   */
  update(dt, player, time) {
    if (!this.enabled) return;
    const w = this.world;

    // Keep the sky populated near the player without ever spawning in view.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.active.length < this.budget) {
      this.spawnTimer = Math.max(2.4, 7.0 - this.tier * 0.5);
      this.spawnNear(player.x, player.z, 110, 190);
    }

    const playerSafe = this.isSanctuary(player.x, player.y, player.z);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const d = this.active[i];
      d.stateTime += dt;
      d.rotor += d.spin * dt;
      d.hitFlash = Math.max(0, d.hitFlash - dt * 4);

      if (d.state === STATE.DYING) {
        d.deathTime += dt;
        d.vy -= 16 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        d.roll += dt * 7;
        d.tilt += dt * 4;
        const ground = w.groundHeight(d.x, d.z);
        if (d.y <= ground + 0.4 || d.deathTime > 6) {
          d.alive = false;
          this.active.splice(i, 1);
        }
        continue;
      }

      const dx = player.x - d.x, dy = player.y - d.y, dz = player.z - d.z;
      const dist = Math.hypot(dx, dy, dz);

      // Line of sight is the expensive part, so it is staggered rather than
      // run for every drone every step.
      if (time > d.lastSeen + 0.22) {
        d.lastSeen = time;
        d.canSee = !playerSafe && dist < 220
          && w.lineOfSight(d.x, d.y, d.z, player.x, player.y, player.z);
      }

      // Too far out, or the player is in the weapons free zone: go back to patrol.
      if (dist > 260 || playerSafe) {
        if (d.state !== STATE.PATROL) { d.state = STATE.PATROL; d.stateTime = 0; }
      }

      switch (d.state) {
        case STATE.PATROL: {
          if (d.stateTime > 4 || Math.hypot(d.targetX - d.x, d.targetZ - d.z) < 12) {
            this._pickPatrolTarget(d, player.x, player.z);
            d.stateTime = 0;
          }
          if (d.canSee && dist < 170 && !playerSafe) { d.state = STATE.PURSUE; d.stateTime = 0; }
          break;
        }
        case STATE.PURSUE: {
          d.targetX = player.x - (dx / (dist || 1)) * 26;
          d.targetZ = player.z - (dz / (dist || 1)) * 26;
          d.targetY = player.y + 14 + Math.sin(time * 0.7 + d.seed * 9) * 4;
          if (!d.canSee && d.stateTime > 3) { d.state = STATE.PATROL; d.stateTime = 0; }
          if (d.canSee && dist < 55) { d.state = STATE.ATTACK; d.stateTime = 0; }
          break;
        }
        case STATE.ATTACK: {
          // Hold a stand off distance and strafe, so it is a moving target.
          const ring = 34;
          const ang = Math.atan2(d.z - player.z, d.x - player.x) + dt * 0.55;
          d.targetX = player.x + Math.cos(ang) * ring;
          d.targetZ = player.z + Math.sin(ang) * ring;
          d.targetY = player.y + 10 + Math.sin(time * 1.3 + d.seed * 5) * 3.5;
          if (!d.canSee) { d.state = STATE.PURSUE; d.stateTime = 0; }
          else if (dist > 80) { d.state = STATE.PURSUE; d.stateTime = 0; }
          else {
            d.fireCooldown -= dt;
            if (d.fireCooldown <= 0) {
              d.fireCooldown = rand(1.6, 3.2) - this.tier * 0.08;
              if (this.onShot) this.onShot(d, 8 + this.tier * 1.5);
            }
          }
          break;
        }
        case STATE.EVADE: {
          const ang = Math.atan2(d.z - player.z, d.x - player.x);
          d.targetX = player.x + Math.cos(ang) * 90;
          d.targetZ = player.z + Math.sin(ang) * 90;
          d.targetY = d.y + 12;
          if (d.stateTime > 2.4) { d.state = STATE.PURSUE; d.stateTime = 0; }
          break;
        }
        default: break;
      }

      // Steering: accelerate towards the target, damped, then avoid the city.
      const tx = d.targetX - d.x, ty = d.targetY - d.y, tz = d.targetZ - d.z;
      const tLen = Math.hypot(tx, ty, tz) || 1;
      const want = Math.min(d.speed, tLen * 1.4);
      const ax = (tx / tLen) * want, ay = (ty / tLen) * want, az = (tz / tLen) * want;
      const k = 2.6;
      d.vx += (ax - d.vx) * Math.min(1, k * dt);
      d.vy += (ay - d.vy) * Math.min(1, k * dt);
      d.vz += (az - d.vz) * Math.min(1, k * dt);

      this._avoid(d, dt);

      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;

      // Face travel, and tilt into it like a real quadrotor.
      const speed2 = Math.hypot(d.vx, d.vz);
      if (speed2 > 0.4) {
        const want2 = Math.atan2(d.vz, d.vx);
        let diff = want2 - d.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        d.yaw += diff * Math.min(1, dt * 3.5);
      }
      d.tilt += (Math.min(0.42, speed2 * 0.045) - d.tilt) * Math.min(1, dt * 3);
      d.roll += ((d.state === STATE.ATTACK ? Math.sin(time * 2 + d.seed * 7) * 0.16 : 0) - d.roll)
        * Math.min(1, dt * 2.5);

      // Out of the box, or wandered into the weapons free zone: turn around.
      if (this.isSanctuary(d.x, d.y, d.z)) {
        const cx = d.x - player.x, cz = d.z - player.z;
        const l = Math.hypot(cx, cz) || 1;
        d.targetX = d.x + (cx / l) * 80;
        d.targetZ = d.z + (cz / l) * 80;
        d.vx += (cx / l) * 12 * dt;
        d.vz += (cz / l) * 12 * dt;
      }
      if (d.x < w.minX + 8 || d.x > w.maxX - 8 || d.z < w.minZ + 8 || d.z > w.maxZ - 8) {
        d.targetX = (w.minX + w.maxX) * 0.5;
        d.targetZ = (w.minZ + w.maxZ) * 0.5;
      }
      // Far behind the player and not engaged: recycle rather than simulate.
      if (dist > 340 && d.state === STATE.PATROL) {
        d.alive = false;
        this.active.splice(i, 1);
      }
    }
  }

  /**
   * Nearest drone along a ray, within maxDist. Sphere test against the hull and
   * the core, so a centre hit can count for more.
   * @returns {{drone:Drone, t:number, core:boolean}|null}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    let hit = null;
    for (const d of this.active) {
      if (!d.alive || d.state === DRONE_STATE.DYING) continue;
      const ex = d.x - ox, ey = d.y - oy, ez = d.z - oz;
      const proj = ex * dx + ey * dy + ez * dz;
      if (proj < 0 || proj > best) continue;
      const perp2 = (ex * ex + ey * ey + ez * ez) - proj * proj;
      const r = d.radius;
      if (perp2 > r * r) continue;
      const back = Math.sqrt(Math.max(0, r * r - perp2));
      const t = proj - back;
      if (t < 0 || t > best) continue;
      best = t;
      const cr = d.coreRadius;
      hit = { drone: d, t, core: perp2 <= cr * cr };
    }
    return hit;
  }

  get count() { return this.active.length; }
  get engaged() {
    let n = 0;
    for (const d of this.active) {
      if (d.state === STATE.PURSUE || d.state === STATE.ATTACK) n++;
    }
    return n;
  }
}
