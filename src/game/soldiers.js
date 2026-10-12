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
    this.roll = 0;
    this.spinLean = 0;
    this.spinRoll = 0;
    this.vy = 0;
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
    this.gibbed = false;
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
    // Called instead of onDeath when a killing hit is meant to take them to
    // pieces. The game layer makes the chunks; this file only decides when.
    this.onGib = null;
    // Set from the cheat menu. With nothing on, a death is the canned fall
    // this game has always had.
    this.gore = { gib: false, ragdoll: false, scale: 1 };
    this.onSlip = null;
    // What is left of somebody the ion cannon burnt. Zero means they stand
    // there for the rest of the session, which is what the game did before
    // this was settable; anything else is how many seconds they hold before
    // they come apart.
    this.boneTime = 0;
    this.onCrumble = null;     // fn(soldier) when a skeleton goes down
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
      // Nobody walks out of a district that has not landed yet.
      if (w.isLoaded && !w.isLoaded(x, z)) continue;
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
      const dir = from || { x: 0, y: 0, z: 0 };
      // Coming apart is not a death animation, it is the absence of one: there
      // is no body left to lie down, so they leave the active list here and
      // the pieces are somebody else's problem.
      if (this.gore.gib) {
        // The flag outlives the soldier for exactly as long as the caller
        // needs to credit the kill, which is how the game layer knows not to
        // put a fireball where a body would have been.
        s.gibbed = true;
        if (this.onGib) this.onGib(s, dir);
        this._retire(s);
        return true;
      }
      s.state = STATE.DYING;
      s.deathTime = 0;
      s.vx = (dir.x || 0) * 1.5;
      s.vz = (dir.z || 0) * 1.5;
      if (this.gore.ragdoll) {
        // Momentum from the shot rather than a timer. A hit from the front
        // puts them on their back, a hit from the side turns them, and the
        // body carries that rotation until the ground takes it away.
        const push = 1.6 + this.gore.scale * 0.5;
        s.vx = (dir.x || 0) * 4.2 * push + (Math.random() - 0.5) * 1.2;
        s.vz = (dir.z || 0) * 4.2 * push + (Math.random() - 0.5) * 1.2;
        s.vy = 1.9 + Math.random() * 1.9;
        // Which way they turn comes from where the hit landed relative to the
        // way they were facing, so it is the shot that decides, not a dice.
        const facing = Math.atan2(-(dir.x || 0), -(dir.z || 0)) - s.yaw;
        s.spinLean = (2.6 + Math.random() * 2.4) * Math.sign(Math.cos(facing) || 1);
        s.spinRoll = Math.sin(facing) * (2.2 + Math.random() * 2.0);
      }
      if (this.onDeath) this.onDeath(s);
      return true;
    }
    return false;
  }

  /** Off the active list at once, whatever the reason. */
  _retire(s) {
    s.alive = false;
    const i = this.active.indexOf(s);
    if (i >= 0) this.active.splice(i, 1);
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
        // Burnt to the bone: what is left does not fall over. It stands where
        // it was, black, until the timer in the cheat menu says otherwise.
        if ((s.charred || 0) >= 0.95) {
          s.lean += (0 - s.lean) * Math.min(1, dt * 2.5);
          s.roll += (0 - s.roll) * Math.min(1, dt * 2.5);
          s.y = w.groundHeight(s.x, s.z);
          if (this.boneTime > 0 && s.deathTime > this.boneTime) {
            if (this.onCrumble) this.onCrumble(s);
            this._retire(s);
          }
          continue;
        }
        if (this.gore.ragdoll) {
          // A rigid body, not a jointed one. The whole figure tumbles about
          // its feet with the angular momentum the shot gave it, falls, lands,
          // and slides to a stop. It is the cheap version of a ragdoll and it
          // is the honest name for what is happening here.
          s.vy -= 19 * dt;
          s.x += s.vx * dt; s.z += s.vz * dt;
          s.lean += s.spinLean * dt;
          s.roll += s.spinRoll * dt;
          const ground = w.groundHeight(s.x, s.z);
          const lying = Math.abs(Math.sin(s.lean)) > 0.82 || Math.abs(Math.sin(s.roll)) > 0.82;
          s.y += s.vy * dt;
          if (s.y <= ground) {
            s.y = ground;
            if (s.vy < -2) { s.vy = -s.vy * 0.18; } else { s.vy = 0; }
            // Once it is down the ground eats the spin, and a body that is
            // already flat stops turning rather than rolling across the square.
            const brake = lying ? 9 : 3.2;
            s.spinLean *= Math.max(0, 1 - brake * dt);
            s.spinRoll *= Math.max(0, 1 - brake * dt);
            s.vx *= Math.max(0, 1 - 5.5 * dt);
            s.vz *= Math.max(0, 1 - 5.5 * dt);
          }
          // Settle flat rather than leaving them propped at an angle. The
          // roll goes to the nearest half turn rather than to zero, because
          // the two stable ways to lie are on your back and on your face, and
          // which one you end up in is decided by how far the hit turned you.
          if (Math.abs(s.spinLean) < 0.25 && s.y <= ground + 0.01) {
            const target = Math.sign(s.lean || 1) * Math.PI * 0.5;
            s.lean += (target - s.lean) * Math.min(1, dt * 3);
            const rest = Math.round(s.roll / Math.PI) * Math.PI;
            s.roll += (rest - s.roll) * Math.min(1, dt * 2);
          }
        } else {
          s.lean = Math.min(1.55, s.lean + dt * 4.2);
          s.x += s.vx * dt; s.z += s.vz * dt;
          s.vx *= 0.9; s.vz *= 0.9;
          s.y = w.groundHeight(s.x, s.z);
        }
        if (s.deathTime > 8) { this._retire(s); }
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
            // Feet out from under him. The slide keeps whatever he was doing
            // and adds a shove of its own, so he goes past the banana rather
            // than stopping on it, and the body goes over backwards with a
            // spin, which is the whole point of a banana.
            const run = Math.hypot(s.vx || 0, s.vz || 0) || 1;
            const push = 5.5 + run;
            s.vx = ((s.vx || 0) / run) * push;
            s.vz = ((s.vz || 0) / run) * push;
            s.spin = (Math.random() < 0.5 ? -1 : 1) * (2.4 + Math.random() * 2.2);
            s.lean = -0.25;
            if (this.onSlip) this.onSlip(s, b);
            break;
          }
        }
      }

      if (s.state === STATE.SLIPPED) {
        s.slipLeft -= dt;
        // Backwards, not forwards: the legs come up and the back goes down,
        // all the way flat, and he turns as he slides.
        s.lean = Math.max(-1.62, s.lean - dt * 6.5);
        s.roll = (s.roll || 0) + (s.spin || 0) * dt * 0.35;
        s.yaw += (s.spin || 0) * dt;
        s.x += s.vx * dt; s.z += s.vz * dt;
        s.vx *= 0.93; s.vz *= 0.93;
        s.y = w.groundHeight(s.x, s.z);
        if (s.slipLeft <= 0) {
          s.state = STATE.ADVANCE;
          s.stateTime = 0;
          s.lean = 0;
          s.roll = 0;
          s.spin = 0;
        }
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
      if (dist > 320 && !s.canSee) { this._retire(s); }
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
