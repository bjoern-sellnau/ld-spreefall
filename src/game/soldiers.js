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

/**
 * Somebody who lives here. They are soldiers in the one sense that matters to
 * the engine: the same walking, the same ground under them, the same capsule
 * to hit and the same one draw call. Everything else about them is in
 * civilianStep, and it comes to about fifteen lines, because a passer by has
 * exactly two things on his mind.
 */
const CIVIL = {
  health: 45,
  walkSpeed: 1.5,
  runSpeed: 5.0,
  // How long they keep running after something frightened them, and how far
  // away a noise still counts as something frightening.
  panic: 7.5,
  // A new place to be, when they get where they were going.
  errand: [16, 55],
};
export const CIVILIAN_SPEC = CIVIL;

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
    this.mechKiller = false;
    this.killerLeft = 0;
    this.deathTime = 0;
    this.gibbed = false;
    // Out of the same pool as everybody else, so whatever the last one was
    // has to be forgotten here rather than left to surprise somebody.
    this.civilian = false;
    // And a machine is a soldier with three fields set on it, which a passer
    // by drawn from the same slot afterwards kept: steel, a red eye and a
    // beam rifle on somebody out for a walk.
    this.machine = false;
    this.stunLeft = 0;
    this.beamCharge = 0;
    this.panicLeft = 0;
    this.who = 0;
    // Coming up out of the street. For as long as this is running he is
    // under it, he does nothing and he sees nothing: the sphere he arrived
    // in is still closing.
    this.rise = RISE_TIME;
    // Under the street from the first frame he exists, so nobody ever sees
    // one standing in the open waiting for the sphere to finish.
    this.y = y - RISE_DEPTH;
    this.charred = 0;
    this.seed = Math.random();
    // A camp guard keeps to his post: where it is, how far he walks from it,
    // and whether he stands still looking out instead of walking at all.
    this.post = null;
    this.sentry = false;
    // How sure a guard is that somebody is there, nought to one. At one he
    // has seen you, and the camp's business takes it from there.
    this.suspicion = 0;
    this.lookX = x; this.lookZ = z;
    // Slayer: what kind of demon this is, if any, its numbers, and how much
    // bigger than a man it is drawn and hit.
    this.demon = null;
    this.dspec = null;
    this.scale = 1;
    this.charging = 0;
    this.staggered = 0;
    this.reeled = false;
    this.nest = null;
    // The Hunt: theirs, drawn in their own shape, and one kept waiting at a
    // hunting ground.
    this.ceph = null;
    this.look = 0;
    this.dormant = false;
    // Not in somebody's hand, nor in the air from one.
    this.held = false;
    return this;
  }
}

/** How long one of them takes to come up out of the ground. */
const RISE_TIME = 1.0;
/** How far under the street he starts. */
const RISE_DEPTH = 1.9;

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
    // Rise of the Machines: what a steel one shoots with, and what happens
    // when an EMP has hold of it. Null in the ordinary game.
    this.beam = null;
    this.onBeam = null;
    this.onStunSpark = null;
    // The heavy warhead some of them carry, when the cheat menu allows it:
    // the numbers behind it, whether what they are shooting at is armour
    // worth spending one on, and where the launch is reported to.
    this.killer = null;
    this.armouredTarget = false;
    this.onMechKiller = null;
    // What is left of somebody the ion cannon burnt. Zero means they stand
    // there for the rest of the session, which the game used to do by
    // default and which reads, fairly, as dead men standing about; anything
    // else is how many seconds they hold before they come apart.
    this.boneTime = 18;
    this.onCrumble = null;     // fn(soldier) when a skeleton goes down
    // fn(soldier) the moment one arrives, for the sphere of light it comes
    // up through.
    this.onArrive = null;
    // Passers by: how many should be about, and the timer that brings the
    // next one in. Nought is a city with nobody in it, which is what every
    // mode but Just a Walk is.
    this.civilianBudget = 0;
    this.civilianTimer = 0;
    this.onPanic = null;       // fn(soldier) the first moment one bolts
    // fn(soldier, dir) when a standing skeleton is shot to pieces.
    this.onShatter = null;
    this.hazards = () => [];
    // Scaled by the difficulty: how often their aimed shot is actually aimed.
    this.accuracyScale = 1;
    // Tactics. How a camp guard who has not been told about you notices you:
    // the numbers, how fast you are moving, and who to tell when he has.
    this.stealth = null;          // {range, cone, near, fill, decay, run}
    this.playerSpeed = 0;
    // The suit's cloak: inside this many metres you are seen anyway, and
    // nought when it is off.
    this.cloak = 0;
    this.onSpot = null;           // fn(soldier, how) 'seen', 'heard' or 'hit'
    this.onDown = null;           // fn(soldier) the moment one is killed
    // Slayer: a demon's claws, its fire and its charge, which the game layer
    // turns into harm, projectiles and sound.
    this.onMelee = null;          // fn(soldier, melee)
    this.onFireball = null;       // fn(soldier, fire)
    this.onCharge = null;         // fn(soldier)
    this.onStagger = null;        // fn(soldier) one starts to reel
  }

  /**
   * A demon's step. It does not patrol and it does not make up its mind: it
   * comes for you, claws when it is close, throws fire when it can see you
   * and has the breath, and the heavy one charges across open ground.
   */
  _demonStep(s, dt, player, dist, dx, dz) {
    const sp = s.dspec;
    // One kept at a hunting ground waits there, turning about, until the
    // camp knows, until it sees you close, or until it is hurt.
    if (s.dormant) {
      // The sight check runs on a rota; the cloak counts from the moment it is up.
      const sees = s.canSee && !(this.cloak && dist > this.cloak);
      if ((s.post && s.post.alert) || (sees && dist < 26) || s.health < s.maxHealth) {
        s.dormant = false;
        s.wokeBy = s.post && s.post.alert ? 'alert' : s.health < s.maxHealth ? 'hurt' : 'saw';
      } else {
        s.yaw += dt * 0.4 * Math.sin(s.seed * 6.28 + s.walk);
        s.walk += dt * 0.3;
        return;
      }
    }
    s.lean += (0 - s.lean) * Math.min(1, dt * 5);
    s.meleeLeft -= dt;
    s.fireLeft -= dt;
    s.chargeLeft -= dt;
    if (s.staggered > 0) {
      // Reeling: it stands there, which is the moment to finish it.
      s.staggered -= dt;
      s.walk += dt * 0.5;
      return;
    }
    let speed = sp.run;
    const reach = sp.melee.range + SPEC.radius * s.scale;
    if (sp.charge) {
      if (s.charging > 0) {
        s.charging -= dt;
        speed = sp.charge.speed;
      } else if (s.chargeLeft <= 0 && s.canSee && dist > sp.charge.from && dist < sp.charge.to) {
        s.charging = sp.charge.seconds;
        s.chargeLeft = sp.charge.every;
        if (this.onCharge) this.onCharge(s);
      }
    }
    if (dist <= reach) {
      speed = 0;
      s.charging = 0;
      if (s.meleeLeft <= 0) {
        s.meleeLeft = sp.melee.interval;
        if (this.onMelee) this.onMelee(s, sp.melee);
      }
    } else if (sp.fire && s.canSee && dist < sp.fire.range && s.fireLeft <= 0 && s.charging <= 0) {
      s.fireLeft = rand(sp.fire.interval[0], sp.fire.interval[1]);
      if (this.onFireball) this.onFireball(s, sp.fire);
    }
    s.targetX = player.x;
    s.targetZ = player.z;
    this._move(s, dt, speed);
    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
      const want = Math.atan2(-dx, -dz);
      let d = want - s.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      s.yaw += d * Math.min(1, dt * 8);
    }
  }

  /**
   * A guard who has not been told: he sees you only inside his cone of
   * vision, and only slowly, faster the nearer you are and the faster you
   * are moving; close enough, he notices you whichever way he faces.
   *
   * @returns {boolean} true the moment he is sure
   */
  _notice(s, dt, player, dist, dx, dz) {
    const st = this.stealth;
    if (!st) return true;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const facing = (fx * dx + fz * dz) / (dist || 1);
    const inCone = facing > st.cone;
    let rate = 0;
    if (inCone && dist < st.range) {
      const k = 1 - dist / st.range;
      rate = st.fill * (0.08 + k * k * 1.6);
    } else if (dist < st.near) {
      rate = st.fill * 0.55;
    }
    if (this.playerSpeed > 4) rate *= st.run;
    else if (this.playerSpeed < 0.5) rate *= 0.6;
    s.suspicion = Math.min(1, s.suspicion + rate * dt);
    if (rate > 0) { s.lookX = player.x; s.lookZ = player.z; }
    return s.suspicion >= 1;
  }

  /**
   * A noise: every camp guard within the radius who has not been told is
   * told, and goes to see.
   *
   * @returns {number} how many heard it
   */
  hear(x, z, radius) {
    let n = 0;
    for (const s of this.active) {
      if (!s.post || s.post.alert || s.civilian || s.health <= 0 || s.state === STATE.DYING) continue;
      if (Math.hypot(s.x - x, s.z - z) > radius) continue;
      s.suspicion = 1;
      s.sentry = false;
      s.lookX = x; s.lookZ = z;
      s.targetX = x; s.targetZ = z;
      s.state = STATE.ADVANCE;
      s.stateTime = 0;
      if (this.onSpot) this.onSpot(s, 'heard');
      n++;
    }
    return n;
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

  /**
   * Puts one on the ground out of sight, between minR and maxR of the
   * player. One that arrives comes through a sphere of light, which the
   * street runs from; one that does not (somebody who lives here) just walks
   * in.
   */
  spawnNear(px, pz, minR, maxR, arrive = true) {
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
      if (arrive && this.onArrive) this.onArrive(s);
      return s;
    }
    return null;
  }

  /** How many of the people about the place are the ones who live here. */
  get civilianCount() {
    let n = 0;
    for (const s of this.active) if (s.civilian && s.health > 0) n++;
    return n;
  }

  /**
   * Somebody on his way somewhere. No sphere and no rising out of the
   * pavement: he was here before you were, and he walks in from the next
   * street like anybody else.
   */
  spawnCivilianNear(px, pz, minR, maxR) {
    const s = this.spawnNear(px, pz, minR, maxR, false);
    if (!s) return null;
    s.civilian = true;
    s.rise = 0;
    s.y = this.world.groundHeight(s.x, s.z);
    s.health = CIVIL.health;
    s.maxHealth = CIVIL.health;
    s.panicLeft = 0;
    // Which coat he has on, which the shader reads out of the fraction, and
    // who he is to a phone that profiles him (.BACKDOOR): the slot is reused,
    // so whatever was known about the last one in it goes.
    s.who = Math.random();
    s.profile = null;
    s.phoneLeft = 0;
    s.directed = null;
    s.crime = null;
    s.subdued = false;
    this._errand(s);
    return s;
  }

  /** Somewhere else to be, a street or two away. */
  _errand(s) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(CIVIL.errand[0], CIVIL.errand[1]);
    this.sendTo(s, s.x + Math.cos(a) * r, s.z + Math.sin(a) * r);
  }

  /**
   * A noise everybody within earshot runs away from: a shot, a blast, a
   * machine arriving. They do not know what it was and they do not look.
   *
   * @param {number} radius how far it was heard
   * @returns {number} how many of them took to their heels
   */
  scare(x, z, radius) {
    let n = 0;
    for (const s of this.active) {
      if (!s.civilian || s.health <= 0) continue;
      if (Math.hypot(s.x - x, s.z - z) > radius) continue;
      const first = s.panicLeft <= 0;
      s.panicLeft = CIVIL.panic;
      s.fleeX = x; s.fleeZ = z;
      if (first && this.onPanic) this.onPanic(s);
      n++;
    }
    return n;
  }

  /**
   * A passer by, in full. Away from whatever frightened him while it is
   * still ringing in his ears, and otherwise about his business.
   */
  _civilianStep(s, dt, player) {
    const w = this.world;
    // The ones behind you are somebody else's neighbours now. Without this
    // they pile up in the streets you have left and the budget keeps every
    // one of them walking a kilometre away.
    if (player && Math.hypot(s.x - player.x, s.z - player.z) > 260) {
      this._retire(s);
      return;
    }
    s.panicLeft = Math.max(0, (s.panicLeft || 0) - dt);
    const running = s.panicLeft > 0;
    // A phone that rang: he stops where he is and looks at it, unless
    // something has frightened him, which beats any message.
    // The one committing a crime is past being frightened, but not past
    // looking at his phone.
    if ((!running || (s.directed && s.directed.bold)) && s.phoneLeft > 0) {
      s.phoneLeft = Math.max(0, s.phoneLeft - dt);
      s.vx = 0; s.vz = 0;
      s.y = w.groundHeight(s.x, s.z);
      s.canSee = false;
      return;
    }
    // Somebody else decides where he goes: a crime he is in. The one who
    // started it is not put off by a noise; the one it is happening to is.
    if (s.directed && (!running || s.directed.bold)) {
      const d = s.directed;
      if (d.speed > 0) {
        s.targetX = d.x; s.targetZ = d.z;
        this._move(s, dt, d.speed);
        s.yaw = Math.atan2(-(s.targetX - s.x), -(s.targetZ - s.z));
      } else {
        s.vx = 0; s.vz = 0;
      }
      if (d.face !== undefined) s.yaw = d.face;
      s.y = w.groundHeight(s.x, s.z);
      s.canSee = false;
      return;
    }
    if (running) {
      // Straight away from it, picked fresh each step so that turning a
      // corner does not send him back towards the noise.
      let dx = s.x - (s.fleeX || 0), dz = s.z - (s.fleeZ || 0);
      const l = Math.hypot(dx, dz) || 1;
      this.sendTo(s, s.x + (dx / l) * 50, s.z + (dz / l) * 50);
    } else if (Math.hypot(s.targetX - s.x, s.targetZ - s.z) < 2.2) {
      this._errand(s);
    }
    this._move(s, dt, running ? CIVIL.runSpeed : CIVIL.walkSpeed);
    s.yaw = Math.atan2(-(s.targetX - s.x), -(s.targetZ - s.z));
    s.y = w.groundHeight(s.x, s.z);
    // He is not in the fight and never was: no aim, no burst, no state to
    // speak of, and nothing counts him as a contact.
    s.canSee = false;
  }

  /**
   * Is this one a skeleton standing there waiting for something to happen to
   * it? Burnt to the bone, on its feet, and nothing else is going to move it.
   */
  isBones(s) {
    return !!s && s.alive && s.state === STATE.DYING && (s.charred || 0) >= 0.95;
  }

  /**
   * Shoot a skeleton and it comes apart. There is nothing left to kill, so
   * this is not damage and credits nobody: it is a pile of bones that used
   * to be standing up.
   *
   * @returns {boolean} whether there was a skeleton there to break
   */
  shatter(s, from) {
    if (!this.isBones(s)) return false;
    if (this.onShatter) this.onShatter(s, from || { x: 0, y: 0, z: 0 });
    this._retire(s);
    return true;
  }

  /**
   * @returns {boolean} true when this killed them
   */
  damage(s, amount, from) {
    // A skeleton has no health left to take off, but it is still standing in
    // the way of a bullet, and a bullet through a skeleton takes it apart.
    if (this.isBones(s)) {
      this.shatter(s, from);
      return false;            // already dead: a heap of bones credits nobody
    }
    if (!s.alive || s.state === STATE.DYING) return false;
    s.health -= amount;
    s.hitFlash = 1;
    // Being shot at from somewhere you had not looked is what turns a patrol
    // into a fight.
    if (s.state === STATE.PATROL) { s.state = STATE.ADVANCE; s.stateTime = 0; }
    if (s.health > 0 && s.post && !s.post.alert && this.onSpot) {
      s.suspicion = 1;
      this.onSpot(s, 'hit');
    }
    // A demon low on its feet reels for a moment, which is the moment to
    // finish it. Once each, and never the tyrant.
    if (s.demon && s.health > 0 && !s.dspec.boss && !s.reeled && s.health < s.maxHealth * 0.22) {
      s.reeled = true;
      s.staggered = 3;
      if (this.onStagger) this.onStagger(s);
    }
    if (s.health <= 0 && this.onDown) this.onDown(s);
    if (s.health <= 0) {
      // Whatever he was in the middle of, he is not doing it now. Without
      // this a man killed while he was still coming up out of the street
      // went on coming up for ever, because the rise runs before the dying.
      s.rise = 0;
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
      if (!s.alive) continue;
      // A body on its way down is not a target. A skeleton standing there
      // is: it is in the way of the bullet, and the bullet takes it apart.
      if (s.state === STATE.DYING && !this.isBones(s)) continue;
      // The head first, because it is worth more and sits inside the capsule's
      // own span at the top.
      // A demon is drawn bigger than a man, and is hit bigger too.
      const sc = s.scale || 1;
      const headR = SPEC.headRadius * sc;
      const hx = s.x - ox, hy = s.y + SPEC.headY * sc - oy, hz = s.z - oz;
      const hproj = hx * dx + hy * dy + hz * dz;
      if (hproj > 0 && hproj < best) {
        const perp2 = (hx * hx + hy * hy + hz * hz) - hproj * hproj;
        if (perp2 <= headR * headR) {
          const back = Math.sqrt(Math.max(0, headR * headR - perp2));
          const t = hproj - back;
          if (t >= 0 && t < best) { best = t; hit = { soldier: s, t, core: true }; }
        }
      }
      // Then the body, as a vertical cylinder tested in plan.
      const ex = s.x - ox, ez = s.z - oz;
      const a = dx * dx + dz * dz;
      if (a > 1e-6) {
        const b = ex * dx + ez * dz;
        const c = ex * ex + ez * ez - SPEC.radius * sc * SPEC.radius * sc;
        const disc = b * b - a * c;
        if (disc >= 0) {
          const t = (b - Math.sqrt(disc)) / a;
          if (t >= 0 && t < best) {
            const y = oy + dy * t;
            // The body stops at the neck. It ran to the top of the head and,
            // being the nearer surface, took every level shot at a head.
            if (y >= s.y && y <= s.y + (SPEC.headY - SPEC.headRadius) * sc) {
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

    // The people who live here. They keep walking whatever else is going on,
    // and they are brought in on a timer of their own so that a city with
    // nobody hunting you is still a city with somebody in it.
    this.civilianTimer -= dt;
    if (this.civilianTimer <= 0 && this.civilianCount < this.civilianBudget) {
      this.civilianTimer = 1.6;
      this.spawnCivilianNear(player.x, player.z, 30, 120);
    }

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

      // Held by the throat, or in the air after being thrown: the suit moves
      // him, not his legs, and nobody fires a rifle from there.
      if (s.held) { s.walk = 0; continue; }

      // An EMP has it: nothing moves, nothing shoots, and whatever you do to
      // it next lands four times as hard.
      if (s.machine && s.stunLeft > 0) {
        s.stunLeft -= dt;
        s.walk = 0;
        s.beamCharge = 0;
        if (this.onStunSpark && Math.random() < dt * 5) this.onStunSpark(s);
        continue;
      }

      // Still coming up. Nothing thinks, nothing shoots and nothing walks
      // until it is on its feet.
      if (s.rise > 0) {
        s.rise -= dt;
        const k = Math.max(0, Math.min(1, s.rise / RISE_TIME));
        s.y = w.groundHeight(s.x, s.z) - RISE_DEPTH * k * k;
        s.walk = 0;
        s.vx = 0; s.vz = 0;
        continue;
      }

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

      // Somebody who lives here, and who is still alive: nothing below this
      // line is his. He has no state, no aim, no burst and no quarrel with
      // anybody. Dying, on the other hand, is the same for everybody, which
      // is why this sits under it rather than over it.
      if (s.civilian) { this._civilianStep(s, dt, player); continue; }

      const dx = player.x - s.x, dz = player.z - s.z;
      const dist = Math.hypot(dx, dz);

      // Line of sight on the same staggered rota as the drones, from their eye
      // to yours, so a parked car of a building really does hide you.
      if (time > s.lastSeen + 0.24) {
        s.lastSeen = time;
        // Cloaked, you are not there to be seen until they walk into you.
        s.canSee = !playerSafe && dist < SPEC.sight && !(this.cloak && dist > this.cloak)
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

      if (s.demon) { this._demonStep(s, dt, player, dist, dx, dz); continue; }

      s.lean += (0 - s.lean) * Math.min(1, dt * 5);

      if (playerSafe || dist > SPEC.sight * 1.4) {
        if (s.state !== STATE.PATROL) { s.state = STATE.PATROL; s.stateTime = 0; }
      }

      let speed = 0;
      switch (s.state) {
        case STATE.PATROL: {
          if (s.post && s.sentry) {
            // A sentry holds his spot and looks out; he only moves once he
            // has a reason to.
            s.targetX = s.x; s.targetZ = s.z;
            speed = 0;
          } else {
            if (s.stateTime > 5 || Math.hypot(s.targetX - s.x, s.targetZ - s.z) < (s.post ? 1.5 : 4)) {
              this._pickPatrol(s, player.x, player.z);
              s.stateTime = 0;
            }
            speed = SPEC.walkSpeed * (s.post ? 0.6 : 1);
          }
          if (s.post && !s.post.alert) {
            // A guard nobody has told: he has to notice you first, and while
            // he is making up his mind he stops and looks.
            if (s.canSee && dist < SPEC.sight && this._notice(s, dt, player, dist, dx, dz)) {
              s.state = STATE.ADVANCE; s.stateTime = 0;
              s.sentry = false;
              if (this.onSpot) this.onSpot(s, 'seen');
            } else if (!s.canSee) {
              s.suspicion = Math.max(0, s.suspicion - dt * (this.stealth ? this.stealth.decay : 0.25));
            }
            if (s.suspicion > 0.3) speed = 0;
          } else if (s.canSee && dist < SPEC.sight) { s.state = STATE.ADVANCE; s.stateTime = 0; }
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
      // A guard making up his mind turns to where he thinks he saw you.
      const wary = s.state === STATE.PATROL && s.post && s.suspicion > 0.3;
      const fx = (s.state === STATE.FIGHT || s.state === STATE.ADVANCE) ? dx
        : wary ? (s.lookX - s.x) : (s.targetX - s.x);
      const fz = (s.state === STATE.FIGHT || s.state === STATE.ADVANCE) ? dz
        : wary ? (s.lookZ - s.z) : (s.targetZ - s.z);
      if (Math.abs(fx) + Math.abs(fz) > 0.01) {
        const want = Math.atan2(-fx, -fz);
        let d = want - s.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        s.yaw += d * Math.min(1, dt * 6);
      }

      // Too far behind you and not engaged: recycle rather than simulate. A
      // camp guard is the camp's to stand down, not this.
      if (dist > 320 && !s.canSee && !s.post) { this._retire(s); }
    }
  }

  /** Somewhere to walk to, kept inside the city. */
  sendTo(s, x, z) {
    const w = this.world;
    s.targetX = Math.min(w.maxX - 15, Math.max(w.minX + 15, x));
    s.targetZ = Math.min(w.maxZ - 15, Math.max(w.minZ + 15, z));
  }

  _pickPatrol(s, px, pz) {
    const w = this.world;
    if (s.post) {
      // A round of the camp, never further out than the post allows.
      const a = Math.random() * Math.PI * 2;
      const r = rand(3, s.post.r);
      s.targetX = s.post.x + Math.cos(a) * r;
      s.targetZ = s.post.z + Math.sin(a) * r;
      return;
    }
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
    // A machine does not carry a rifle. It lines up, the eye brightens, and
    // then a beam arrives: slower than a burst, visible while it charges, and
    // it does not miss by as much as a man does.
    if (s.machine) {
      s.beamCharge = (s.beamCharge || 0) + dt;
      // One of them carrying a mech killer uses it on armour and on nothing
      // else: the warhead is for what you are standing in, and a man on foot
      // is not worth one. Whether what it is looking at counts as armour is
      // the game layer's business, not this one's.
      if (s.mechKiller && this.armouredTarget && this.onMechKiller && this.killer) {
        s.killerLeft -= dt;
        if (s.killerLeft <= 0 && dist < this.killer.range) {
          s.killerLeft = this.killer.interval;
          s.beamCharge = 0;
          this.onMechKiller(s);
          return;
        }
      }
      if (this.beam && s.beamCharge >= this.beam.charge + this.beam.interval) {
        s.beamCharge = 0;
        const falloff = 1 - Math.min(1, dist / this.beam.range) * 0.4;
        const hit = Math.random() < 0.62 * falloff * this.accuracyScale;
        if (this.onBeam) this.onBeam(s, hit ? this.beam.damage : 0);
      }
      return;
    }
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
