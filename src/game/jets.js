// Fighter jets. The drones hover and the soldiers walk; a jet does neither.
//
// It flies a circuit: it comes in from a long way out, lines up on where you
// are going to be, fires on the pass, and then breaks off and comes round
// again. It never stops, which is what makes it different to fight. You cannot
// chase it, you can only be ready for the next pass.
//
// The whole thing is a state machine over one curve: bank towards a heading,
// hold a height, and never turn faster than the turn rate allows.

const STATE = { INBOUND: 0, ATTACK: 1, BREAK: 2, ORBIT: 3, DYING: 4 };
export const JET_STATE = STATE;

export const MAX_JETS = 6;

const SPEC = {
  radius: 3.2,           // it is a big thing to hit, which is the only mercy
  speed: 92,             // metres a second, about 330 km/h
  attackSpeed: 118,
  turnRate: 0.62,        // radians a second: a wide, committed turn
  climbRate: 16,
  health: 260,
  cruiseHeight: 120,
  attackHeight: 62,
  runIn: 620,            // how far out it turns in for a pass
  breakOff: 90,          // how close it gets before it pulls away
  gunRange: 220,
  gunDamage: 7,
  gunInterval: 0.09,
  burst: 9,
  missileEvery: 2,       // a missile on every other pass
};
export const JET_SPEC = SPEC;

const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

class Jet {
  constructor() { this.alive = false; }

  spawn(x, y, z, yaw, tier) {
    this.alive = true;
    this.x = x; this.y = y; this.z = z;
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.speed = SPEC.speed;
    this.health = SPEC.health + tier * 30;
    this.state = STATE.INBOUND;
    this.stateTime = 0;
    this.hitFlash = 0;
    this.passes = 0;
    this.burstLeft = 0;
    this.nextShot = 0;
    this.afterburner = 0;
    this.deathTime = 0;
    this.seed = Math.random();
    // Where it is heading on this pass. Set when it turns in.
    this.aimX = x; this.aimZ = z;
    return this;
  }
}

export class Jets {
  constructor(world, isSanctuary) {
    this.world = world;
    this.isSanctuary = isSanctuary || (() => false);
    this.pool = [];
    for (let i = 0; i < MAX_JETS; i++) this.pool.push(new Jet());
    this.active = [];
    this.enabled = true;
    this.budget = 0;          // no jets until the threat is up
    this.tier = 0;
    this.spawnTimer = 12;
    this.accuracyScale = 1;
    this.onGun = null;        // fn(jet, damage, fromX, fromZ)
    this.onMissile = null;    // fn(jet, target)
    this.onDeath = null;
    this.onPass = null;
  }

  reset() {
    for (const j of this.pool) j.alive = false;
    this.active.length = 0;
    this.spawnTimer = 12;
  }

  /** Jets arrive at threat three and there are never many. */
  setTier(tier) {
    this.tier = tier;
    this.budget = tier < 2 ? 0 : Math.min(3, tier - 1);
  }

  free() {
    for (const j of this.pool) if (!j.alive) return j;
    return null;
  }

  /** Comes in from the edge of the box, high and far out. */
  spawnFar(px, pz) {
    const j = this.free();
    if (!j) return null;
    const w = this.world;
    const a = Math.random() * Math.PI * 2;
    const r = rand(SPEC.runIn * 0.8, SPEC.runIn * 1.2);
    const x = Math.min(w.maxX - 40, Math.max(w.minX + 40, px + Math.cos(a) * r));
    const z = Math.min(w.maxZ - 40, Math.max(w.minZ + 40, pz + Math.sin(a) * r));
    const y = w.groundHeight(x, z) + SPEC.cruiseHeight + rand(-20, 30);
    j.spawn(x, y, z, Math.atan2(-(px - x), -(pz - z)), this.tier);
    this.active.push(j);
    return j;
  }

  damage(j, amount) {
    if (!j.alive || j.state === STATE.DYING) return false;
    j.health -= amount;
    j.hitFlash = 1;
    if (j.health <= 0) {
      j.state = STATE.DYING;
      j.deathTime = 0;
      if (this.onDeath) this.onDeath(j);
      return true;
    }
    return false;
  }

  /** A sphere around the fuselage. A jet is big and moving; that is the trade. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    let hit = null;
    for (const j of this.active) {
      if (!j.alive || j.state === STATE.DYING) continue;
      const ex = j.x - ox, ey = j.y - oy, ez = j.z - oz;
      const proj = ex * dx + ey * dy + ez * dz;
      if (proj < 0 || proj > best) continue;
      const perp2 = (ex * ex + ey * ey + ez * ez) - proj * proj;
      if (perp2 > SPEC.radius * SPEC.radius) continue;
      const back = Math.sqrt(Math.max(0, SPEC.radius * SPEC.radius - perp2));
      const t = proj - back;
      if (t < 0 || t > best) continue;
      best = t;
      // The intakes are the soft part, which rewards a shot into the front.
      hit = { jet: j, t, core: perp2 < (SPEC.radius * 0.35) ** 2 };
    }
    return hit;
  }

  update(dt, player, time) {
    if (!this.enabled) return;
    const w = this.world;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.active.length < this.budget) {
      this.spawnTimer = rand(14, 26);
      this.spawnFar(player.x, player.z);
    }

    const playerSafe = this.isSanctuary(player.x, player.y, player.z);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const j = this.active[i];
      j.stateTime += dt;
      j.hitFlash = Math.max(0, j.hitFlash - dt * 4);

      if (j.state === STATE.DYING) {
        // Down it goes, trailing and turning.
        j.deathTime += dt;
        j.pitch = Math.max(-1.1, j.pitch - dt * 0.9);
        j.roll += dt * 2.4;
        j.speed = Math.max(30, j.speed - dt * 18);
        this._fly(j, dt);
        const ground = w.groundHeight(j.x, j.z);
        if (j.y <= ground + 2 || j.deathTime > 9) {
          j.alive = false;
          this.active.splice(i, 1);
        }
        continue;
      }

      const dx = player.x - j.x, dz = player.z - j.z;
      const dist = Math.hypot(dx, dz);

      switch (j.state) {
        case STATE.INBOUND: {
          // Aim at a point ahead of where you are, so it arrives where you are
          // going rather than where you were.
          j.aimX = player.x + (player.vx || 0) * 1.4;
          j.aimZ = player.z + (player.vz || 0) * 1.4;
          this._steerTo(j, j.aimX, j.aimZ, dt);
          this._hold(j, SPEC.attackHeight, dt);
          j.speed += (SPEC.attackSpeed - j.speed) * Math.min(1, dt * 0.6);
          if (dist < SPEC.gunRange && !playerSafe) {
            j.state = STATE.ATTACK;
            j.stateTime = 0;
            j.burstLeft = SPEC.burst;
            j.passes++;
            if (this.onPass) this.onPass(j);
            if (this.onMissile && j.passes % SPEC.missileEvery === 0) this.onMissile(j);
          }
          break;
        }
        case STATE.ATTACK: {
          this._steerTo(j, j.aimX, j.aimZ, dt);
          this._hold(j, SPEC.attackHeight, dt);
          if (!playerSafe) this._guns(j, dt, player, dist);
          if (dist < SPEC.breakOff || j.stateTime > 4) {
            j.state = STATE.BREAK;
            j.stateTime = 0;
            j.afterburner = 1;
          }
          break;
        }
        case STATE.BREAK: {
          // Straight out and climbing, away from you.
          const awayX = j.x + (j.x - player.x) * 3;
          const awayZ = j.z + (j.z - player.z) * 3;
          this._steerTo(j, awayX, awayZ, dt);
          this._hold(j, SPEC.cruiseHeight, dt);
          j.afterburner = Math.max(0, j.afterburner - dt * 0.5);
          if (dist > SPEC.runIn * 0.55 || j.stateTime > 9) {
            j.state = STATE.ORBIT;
            j.stateTime = 0;
          }
          break;
        }
        case STATE.ORBIT: {
          // A wide turn back in. The circle is what gives you the gap between
          // passes to do something about it.
          const a = Math.atan2(j.z - player.z, j.x - player.x) + dt * 0.45;
          const r = Math.max(SPEC.runIn * 0.5, dist);
          this._steerTo(j, player.x + Math.cos(a) * r, player.z + Math.sin(a) * r, dt);
          this._hold(j, SPEC.cruiseHeight, dt);
          j.speed += (SPEC.speed - j.speed) * Math.min(1, dt * 0.5);
          if (j.stateTime > rand(2.5, 4.5)) { j.state = STATE.INBOUND; j.stateTime = 0; }
          break;
        }
        default: break;
      }

      this._fly(j, dt);

      // Out of the box, or too far to matter.
      if (j.x < w.minX - 200 || j.x > w.maxX + 200 || j.z < w.minZ - 200 || j.z > w.maxZ + 200) {
        this._steerTo(j, (w.minX + w.maxX) * 0.5, (w.minZ + w.maxZ) * 0.5, dt);
      }
      if (dist > SPEC.runIn * 2.5) { j.alive = false; this.active.splice(i, 1); }
    }
  }

  /** Turn towards a point on the ground, banking into it. */
  _steerTo(j, x, z, dt) {
    const want = Math.atan2(-(x - j.x), -(z - j.z));
    const d = wrap(want - j.yaw);
    const turn = Math.max(-SPEC.turnRate, Math.min(SPEC.turnRate, d * 1.6)) * dt;
    j.yaw += turn;
    // Bank in proportion to the turn, because a jet that turns flat looks wrong
    // in a way everybody notices without knowing why.
    const wantRoll = Math.max(-1.1, Math.min(1.1, d * 1.3));
    j.roll += (wantRoll - j.roll) * Math.min(1, dt * 2.2);
  }

  /** Hold a height above the ground under it, pitching to get there. */
  _hold(j, above, dt) {
    const ground = this.world.groundHeight(j.x, j.z);
    const want = ground + above;
    const err = want - j.y;
    const climb = Math.max(-SPEC.climbRate, Math.min(SPEC.climbRate, err * 0.6));
    j.y += climb * dt;
    j.pitch += (Math.max(-0.4, Math.min(0.4, climb / SPEC.climbRate * 0.4)) - j.pitch)
      * Math.min(1, dt * 2);
  }

  _fly(j, dt) {
    j.x += -Math.sin(j.yaw) * j.speed * dt;
    j.z += -Math.cos(j.yaw) * j.speed * dt;
  }

  _guns(j, dt, player, dist) {
    if (j.burstLeft <= 0) return;
    j.nextShot -= dt;
    if (j.nextShot > 0) return;
    j.nextShot = SPEC.gunInterval;
    j.burstLeft--;
    // A cannon pass is mostly noise and near misses, which is the point: it is
    // there to move you, not to kill you outright.
    const falloff = 1 - Math.min(1, dist / SPEC.gunRange) * 0.6;
    const hit = Math.random() < 0.26 * falloff * this.accuracyScale;
    if (this.onGun) this.onGun(j, hit ? SPEC.gunDamage : 0);
  }

  get count() { return this.active.length; }
  get engaged() {
    let n = 0;
    for (const j of this.active) if (j.state === STATE.ATTACK || j.state === STATE.INBOUND) n++;
    return n;
  }
}
