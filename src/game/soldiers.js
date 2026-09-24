// Soldiers: the enemy that walks. They use the same world raycast the bullets
// and the drones use, so they take cover behind real buildings, lose you when
// you break line of sight, and cannot see through the Gate any more than you
// can shoot through it.
//
// They are hostile militia in a scenario, not anybody's army: no insignia, no
// nation, no faces. And like everything else with a weapon in this game they
// stay out of the memorial.

const STATE = { PATROL: 0, ADVANCE: 1, FIGHT: 2, COVER: 3, SLIPPED: 4, DYING: 5 };
export const SOLDIER_STATE = STATE;

export const MAX_SOLDIERS = 24;

const SPEC = {
  radius: 0.42,          // the capsule you have to hit
  height: 1.82,
  headRadius: 0.17,      // worth the extra damage
  headY: 1.62,
  walkSpeed: 2.3,
  runSpeed: 5.4,
  health: 100,
  sight: 165,
  fireRange: 95,
  burst: 3,
  burstGap: 0.12,
  reload: 1.9,
  damage: 9,
  accuracy: 0.72,        // the share of their shots that are aimed at you
  aimTime: 0.55,
};
export const SOLDIER_SPEC = SPEC;

const rand = (a, b) => a + Math.random() * (b - a);

class Soldier {
  constructor() { this.alive = false; }

  spawn(x, y, z, tier) {
    this.alive = true;
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vz = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.lean = 0;
    this.walk = Math.random() * 6.28;
    this.health = SPEC.health + tier * 12;
    this.maxHealth = this.health;
    this.state = STATE.PATROL;
    this.stateTime = 0;
    this.hitFlash = 0;
    this.canSee = false;
    this.lastSeen = -99;
    this.aim = 0;
    this.burstLeft = 0;
    this.nextShot = 0;
    this.reloadLeft = 0;
    this.targetX = x;
    this.targetZ = z;
    this.slipLeft = 0;
    this.deathTime = 0;
    this.seed = Math.random();
    return this;
  }
}

export class Soldiers {
  /**
   * @param {object} world for the ground, the raycast and the line of sight
   * @param {(x,y,z)=>boolean} isSanctuary the weapons free zone test
   */
  constructor(world, isSanctuary) {
    this.world = world;
    this.isSanctuary = isSanctuary || (() => false);
    this.pool = [];
    for (let i = 0; i < MAX_SOLDIERS; i++) this.pool.push(new Soldier());
    this.active = [];
    this.enabled = true;
    // The soldiers are the fight. They are on the ground and mostly behind
    // something, so there have to be enough of them that you keep meeting one.
    this.budget = 7;
    this.tier = 0;
    this.spawnTimer = 3;
    this.onShot = null;      // fn(soldier, damage)
    this.onDeath = null;
    this.onSlip = null;
    this.hazards = () => [];
    // Scaled by the difficulty: how often their aimed shot is actually aimed.
    this.accuracyScale = 1;
  }

  reset() {
    for (const s of this.pool) s.alive = false;
    this.active.length = 0;
    this.spawnTimer = 2;
  }

  setTier(tier) {
    this.tier = tier;
    this.budget = Math.min(18, 7 + tier * 2);
  }

  free() {
    for (const s of this.pool) if (!s.alive) return s;
    return null;
  }

  /** Puts one on the ground out of sight, between minR and maxR of the player. */
  spawnNear(px, pz, minR, maxR) {
    const s = this.free();
    if (!s) return null;
    const w = this.world;
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(minR, maxR);
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;
      if (x < w.minX + 20 || x > w.maxX - 20) continue;
      if (z < w.minZ + 20 || z > w.maxZ - 20) continue;
      if (this.isSanctuary(x, 0, z)) continue;
      const g = w.groundHeight(x, z);
      // Somewhere they can actually stand: no wall within arm's reach.
      let boxed = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (w.raycast(x, g + 1.0, z, dx, 0, dz, 1.6)) { boxed = true; break; }
      }
      if (boxed) continue;
      s.spawn(x, g, z, this.tier);
      this.active.push(s);
      return s;
    }
    return null;
  }

  /**
   * @returns {boolean} true when this killed them
   */
  damage(s, amount, from) {
    if (!s.alive || s.state === STATE.DYING) return false;
    s.health -= amount;
    s.hitFlash = 1;
    // Being shot at from somewhere you had not looked is what turns a patrol
    // into a fight.
    if (s.state === STATE.PATROL) { s.state = STATE.ADVANCE; s.stateTime = 0; }
    if (s.health <= 0) {
      s.state = STATE.DYING;
      s.deathTime = 0;
      s.vx = (from && from.x ? from.x : 0) * 1.5;
      s.vz = (from && from.z ? from.z : 0) * 1.5;
      if (this.onDeath) this.onDeath(s);
      return true;
    }
    return false;
  }

  /** A shot against the capsule and the head, nearest first. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    let hit = null;
    for (const s of this.active) {
      if (!s.alive || s.state === STATE.DYING) continue;
      // The head first, because it is worth more and sits inside the capsule's
      // own span at the top.
      const hx = s.x - ox, hy = s.y + SPEC.headY - oy, hz = s.z - oz;
      const hproj = hx * dx + hy * dy + hz * dz;
      if (hproj > 0 && hproj < best) {
        const perp2 = (hx * hx + hy * hy + hz * hz) - hproj * hproj;
        if (perp2 <= SPEC.headRadius * SPEC.headRadius) {
          const back = Math.sqrt(Math.max(0, SPEC.headRadius * SPEC.headRadius - perp2));
          const t = hproj - back;
          if (t >= 0 && t < best) { best = t; hit = { soldier: s, t, core: true }; }
        }
      }
      // Then the body, as a vertical cylinder tested in plan.
      const ex = s.x - ox, ez = s.z - oz;
      const a = dx * dx + dz * dz;
      if (a > 1e-6) {
        const b = ex * dx + ez * dz;
        const c = ex * ex + ez * ez - SPEC.radius * SPEC.radius;
        const disc = b * b - a * c;
        if (disc >= 0) {
          const t = (b - Math.sqrt(disc)) / a;
          if (t >= 0 && t < best) {
            const y = oy + dy * t;
            if (y >= s.y && y <= s.y + SPEC.height) {
              best = t;
              hit = { soldier: s, t, core: false };
            }
          }
        }
      }
    }
    return hit;
  }

  update(dt, player, time) {
    if (!this.enabled) return;
    const w = this.world;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.active.length < this.budget) {
      this.spawnTimer = Math.max(0.9, 2.8 - this.tier * 0.22);
      // They arrive as a section rather than one at a time, which is both how
      // they fight and what makes them read as present in a street.
      const squad = 1 + (Math.random() < 0.55 ? 1 : 0) + (this.tier > 2 && Math.random() < 0.4 ? 1 : 0);
      const first = this.spawnNear(player.x, player.z, 45, 115);
      for (let k = 1; k < squad && first; k++) {
        const mate = this.spawnNear(first.x, first.z, 4, 16);
        if (mate) { mate.targetX = first.targetX; mate.targetZ = first.targetZ; }
      }
    }

    const playerSafe = this.isSanctuary(player.x, player.y, player.z);
    const bananas = this.hazards();

    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.stateTime += dt;
      s.hitFlash = Math.max(0, s.hitFlash - dt * 4);

      if (s.state === STATE.DYING) {
        s.deathTime += dt;
        s.lean = Math.min(1.55, s.lean + dt * 4.2);
        s.x += s.vx * dt; s.z += s.vz * dt;
        s.vx *= 0.9; s.vz *= 0.9;
        s.y = w.groundHeight(s.x, s.z);
        if (s.deathTime > 8) { s.alive = false; this.active.splice(i, 1); }
        continue;
      }

      const dx = player.x - s.x, dz = player.z - s.z;
      const dist = Math.hypot(dx, dz);

      // Line of sight on the same staggered rota as the drones, from their eye
      // to yours, so a parked car of a building really does hide you.
      if (time > s.lastSeen + 0.24) {
        s.lastSeen = time;
        s.canSee = !playerSafe && dist < SPEC.sight
          && w.lineOfSight(s.x, s.y + 1.6, s.z, player.x, player.y, player.z);
      }

      // A banana on the ground is a banana on the ground.
      if (s.state !== STATE.SLIPPED) {
        for (const b of bananas) {
          const r = Math.hypot(b.x - s.x, b.z - s.z);
          if (r < (b.slip.radius || 1) && Math.abs(b.y - s.y) < 1.6) {
            s.state = STATE.SLIPPED;
            s.stateTime = 0;
            s.slipLeft = b.slip.seconds || 3;
            s.vx = (s.vx || 0) * 2.2;
            s.vz = (s.vz || 0) * 2.2;
            if (this.onSlip) this.onSlip(s, b);
            break;
          }
        }
      }

      if (s.state === STATE.SLIPPED) {
        s.slipLeft -= dt;
        s.lean = Math.min(1.5, s.lean + dt * 5);
        s.x += s.vx * dt; s.z += s.vz * dt;
        s.vx *= 0.86; s.vz *= 0.86;
        s.y = w.groundHeight(s.x, s.z);
        if (s.slipLeft <= 0) { s.state = STATE.ADVANCE; s.stateTime = 0; }
        continue;
      }

      s.lean += (0 - s.lean) * Math.min(1, dt * 5);

      if (playerSafe || dist > SPEC.sight * 1.4) {
        if (s.state !== STATE.PATROL) { s.state = STATE.PATROL; s.stateTime = 0; }
      }

      let speed = 0;
      switch (s.state) {
        case STATE.PATROL: {
          if (s.stateTime > 5 || Math.hypot(s.targetX - s.x, s.targetZ - s.z) < 4) {
            this._pickPatrol(s, player.x, player.z);
            s.stateTime = 0;
          }
          speed = SPEC.walkSpeed;
          if (s.canSee && dist < SPEC.sight) { s.state = STATE.ADVANCE; s.stateTime = 0; }
          break;
        }
        case STATE.ADVANCE: {
          s.targetX = player.x; s.targetZ = player.z;
          speed = SPEC.runSpeed;
          if (s.canSee && dist < SPEC.fireRange) { s.state = STATE.FIGHT; s.stateTime = 0; s.aim = 0; }
          else if (!s.canSee && s.stateTime > 6) { s.state = STATE.PATROL; s.stateTime = 0; }
          break;
        }
        case STATE.FIGHT: {
          // Close if far, back off if you are on top of them, otherwise hold
          // and shoot.
          if (dist > SPEC.fireRange * 0.8) { s.targetX = player.x; s.targetZ = player.z; speed = SPEC.walkSpeed; }
          else if (dist < 12) {
            s.targetX = s.x - dx; s.targetZ = s.z - dz; speed = SPEC.walkSpeed;
          } else {
            // Strafe, so they are not a standing target.
            const side = Math.sin(time * 0.7 + s.seed * 6.28);
            s.targetX = s.x - dz / (dist || 1) * side * 8;
            s.targetZ = s.z + dx / (dist || 1) * side * 8;
            speed = SPEC.walkSpeed * 0.7;
          }
          if (!s.canSee) {
            if (s.stateTime > 1.4) { s.state = STATE.ADVANCE; s.stateTime = 0; }
          } else {
            this._shoot(s, dt, player, dist);
          }
          break;
        }
        default: break;
      }

      this._move(s, dt, speed);
      // Face the way it matters: at you in a fight, where they are going
      // otherwise.
      const fx = (s.state === STATE.FIGHT || s.state === STATE.ADVANCE) ? dx : (s.targetX - s.x);
      const fz = (s.state === STATE.FIGHT || s.state === STATE.ADVANCE) ? dz : (s.targetZ - s.z);
      if (Math.abs(fx) + Math.abs(fz) > 0.01) {
        const want = Math.atan2(-fx, -fz);
        let d = want - s.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        s.yaw += d * Math.min(1, dt * 6);
      }

      // Too far behind you and not engaged: recycle rather than simulate.
      if (dist > 320 && !s.canSee) { s.alive = false; this.active.splice(i, 1); }
    }
  }

  _pickPatrol(s, px, pz) {
    const w = this.world;
    const a = Math.random() * Math.PI * 2;
    const r = rand(25, 90);
    let x = s.x + Math.cos(a) * r + (px - s.x) * 0.3;
    let z = s.z + Math.sin(a) * r + (pz - s.z) * 0.3;
    x = Math.min(w.maxX - 15, Math.max(w.minX + 15, x));
    z = Math.min(w.maxZ - 15, Math.max(w.minZ + 15, z));
    s.targetX = x;
    s.targetZ = z;
  }

  /** Walk towards the target, sliding along whatever is in the way. */
  _move(s, dt, speed) {
    if (speed <= 0) { s.walk += dt * 1.5; return; }
    const w = this.world;
    let dx = s.targetX - s.x;
    let dz = s.targetZ - s.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.001) return;
    dx /= l; dz /= l;

    // A probe at chest height, because a kerb is not a wall and should not
    // stop them.
    const probe = 2.2;
    const hit = w.raycast(s.x, s.y + 1.1, s.z, dx, 0, dz, probe);
    if (hit) {
      // Something in the way: turn along it, towards whichever side is open.
      const leftBlocked = !!w.raycast(s.x, s.y + 1.1, s.z, -dz, 0, dx, probe);
      const ndx = leftBlocked ? dz : -dz;
      const ndz = leftBlocked ? -dx : dx;
      dx = ndx; dz = ndz;
    }

    const step = speed * dt;
    const nx = s.x + dx * step;
    const nz = s.z + dz * step;
    // Do not walk into the weapons free zone, and do not walk through a wall.
    if (this.isSanctuary(nx, 0, nz)) {
      s.targetX = s.x - dx * 60;
      s.targetZ = s.z - dz * 60;
      return;
    }
    if (!w.raycast(s.x, s.y + 1.1, s.z, dx, 0, dz, step + SPEC.radius)) {
      s.x = nx; s.z = nz;
    }
    s.y = w.groundHeight(s.x, s.z);
    s.walk += step * 1.9;
  }

  _shoot(s, dt, player, dist) {
    if (s.reloadLeft > 0) { s.reloadLeft -= dt; return; }
    s.aim += dt;
    if (s.aim < SPEC.aimTime) return;
    s.nextShot -= dt;
    if (s.nextShot > 0) return;

    if (s.burstLeft <= 0) s.burstLeft = SPEC.burst;
    s.burstLeft--;
    s.nextShot = SPEC.burstGap;
    if (s.burstLeft <= 0) {
      s.reloadLeft = SPEC.reload * rand(0.7, 1.3);
      s.aim = 0;
    }

    // Distance and their own accuracy decide whether that round is a hit. The
    // shot is reported either way, so you hear it go past.
    const falloff = 1 - Math.min(1, dist / SPEC.fireRange) * 0.55;
    const hit = Math.random() < SPEC.accuracy * falloff * this.accuracyScale;
    if (this.onShot) this.onShot(s, hit ? SPEC.damage : 0);
  }

  get count() { return this.active.length; }
  get engaged() {
    let n = 0;
    for (const s of this.active) if (s.state === STATE.FIGHT || s.state === STATE.ADVANCE) n++;
    return n;
  }
}
