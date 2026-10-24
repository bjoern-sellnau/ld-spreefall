// A man taken by the throat and thrown, the suit's strength in The Hunt.
//
// The first game did it in strength mode: walk up to somebody, take hold of
// him, and throw him, and the longer the throw was held the harder it went.
// Here it is F to take hold and the trigger to throw, held for a harder one.
//
// While he is held he is not anybody's to move: the soldier pool leaves a
// held body alone, and this puts it out in front of the eye, off its feet.
// Thrown, it is a body in flight rather than a soldier, until it lands, hits
// a wall or goes through somebody else, and what it hits is hurt by how fast
// it was going. Then it is the soldier pool's again, to die or get up.

import { SUIT } from './nanosuit.js';

export const GRAB = SUIT.grab;

export class Grab {
  constructor() {
    this.held = null;       // the soldier in your hand
    this.charge = 0;        // 0 to 1, how hard the throw will be
    this.flying = [];       // { s, vx, vy, vz, age, struck:Set }
  }

  reset() {
    if (this.held) this.held.held = false;
    for (const f of this.flying) f.s.held = false;
    this.held = null;
    this.charge = 0;
    this.flying.length = 0;
  }

  /**
   * Whom F would take: the nearest of theirs in reach and in front, not a
   * demon too big to lift and not one already in the air.
   *
   * @param {{x,z}} at where you stand
   * @param {{x,z}} facing unit vector, the way you look in plan
   * @param {object[]} bodies the soldier pool's active list
   */
  pick(at, facing, bodies) {
    let best = null, bestD = GRAB.reach;
    for (const t of bodies) {
      if (!t.alive || t.health <= 0 || t.civilian || t.state === 5 || t.held) continue;
      if ((t.scale || 1) > GRAB.maxScale || t.machine || (t.dspec && t.dspec.boss)) continue;
      const dx = t.x - at.x, dz = t.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD || (facing.x * dx + facing.z * dz) / (d || 1) < 0.5) continue;
      best = t; bestD = d;
    }
    return best;
  }

  take(s) {
    this.held = s;
    s.held = true;
    s.walk = 0;
    s.vx = 0; s.vz = 0;
    this.charge = 0;
  }

  /**
   * Where a held man is: an arm's length in front of the eye, his feet off
   * the ground, facing you, and kicking.
   */
  hold(dt, eye, yaw, time) {
    const s = this.held;
    if (!s) return;
    // An arm's length out and a little to the right, so the street is still
    // there past his shoulder, and lifted off his feet.
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = -fz, rz = fx;
    s.x = eye.x + fx * 1.45 + rx * 0.35;
    s.z = eye.z + fz * 1.45 + rz * 0.35;
    s.y = eye.y - 1.4;
    s.yaw = yaw + Math.PI;
    s.lean = Math.sin(time * 9) * 0.08;
    s.roll = Math.sin(time * 7.3) * 0.1;
    s.walk = 0;
  }

  /** The trigger held: the throw winds up. */
  windUp(dt) {
    if (this.held) this.charge = Math.min(1, this.charge + dt / GRAB.charge);
  }

  /**
   * Let him go, along the way you are looking, as hard as the wind-up says.
   * @returns {object|null} the body in flight
   */
  release(dir, power = this.charge) {
    const s = this.held;
    if (!s) return null;
    this.held = null;
    this.charge = 0;
    const speed = GRAB.minSpeed + (GRAB.maxSpeed - GRAB.minSpeed) * Math.max(0, Math.min(1, power));
    const f = {
      s, age: 0, struck: new Set(),
      vx: dir.x * speed,
      vy: dir.y * speed + speed * GRAB.lift,
      vz: dir.z * speed,
      spin: 6 + speed * 0.3,
    };
    this.flying.push(f);
    return f;
  }

  /**
   * Somebody sent flying by something other than your hand: a bat, a kick
   * in the air. A body in flight like a thrown one, hurt by what it meets the
   * same way, impact times as hard.
   * @returns {object|null} the body in flight
   */
  launch(s, vx, vy, vz, impact = 1) {
    if (!s || s.held) return null;
    s.held = true;
    s.walk = 0;
    s.vx = 0; s.vz = 0;
    const speed = Math.hypot(vx, vy, vz);
    const f = { s, age: 0, struck: new Set(), vx, vy, vz, spin: 6 + speed * 0.3, impact };
    this.flying.push(f);
    return f;
  }

  /**
   * A step of everything in the air.
   *
   * @param {number} dt
   * @param {object} o
   * @param {object} o.world groundHeight and raycast
   * @param {object[]} o.bodies everyone it could go through
   * @param {(f, speed:number, what:string)=>void} o.onLand it came down: on the ground, a wall or out of time
   * @param {(f, other, speed:number)=>void} o.onStrike it went through somebody on the way
   */
  step(dt, o) {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      const s = f.s;
      f.age += dt;
      f.vy -= GRAB.gravity * dt;
      const speed = Math.hypot(f.vx, f.vy, f.vz);
      const step = speed * dt;
      // A wall in the way, at the height of his middle.
      let what = null;
      if (step > 1e-4) {
        const hit = o.world.raycast(s.x, s.y + 1.0, s.z, f.vx / speed, f.vy / speed, f.vz / speed, step + 0.4);
        if (hit) {
          const t = Math.max(0, hit.t - 0.4);
          s.x += (f.vx / speed) * t; s.y += (f.vy / speed) * t; s.z += (f.vz / speed) * t;
          what = 'wall';
        }
      }
      if (!what) {
        s.x += f.vx * dt; s.y += f.vy * dt; s.z += f.vz * dt;
      }
      s.lean += f.spin * dt;
      // Whoever he goes through.
      for (const other of o.bodies) {
        if (other === s || other.held || f.struck.has(other)) continue;
        if (!other.alive || other.health <= 0 || other.state === 5 || other.civilian) continue;
        const h = 1.8 * (other.scale || 1);
        if (Math.hypot(other.x - s.x, other.z - s.z) > GRAB.hitRadius) continue;
        if (s.y > other.y + h || s.y + 1.8 < other.y) continue;
        f.struck.add(other);
        o.onStrike(f, other, speed);
        // Going through a man takes something out of the throw.
        f.vx *= 0.6; f.vy *= 0.6; f.vz *= 0.6;
      }
      const ground = o.world.groundHeight(s.x, s.z);
      if (!what && s.y <= ground && f.vy <= 0) { s.y = ground; what = 'ground'; }
      if (!what && f.age > 4) what = 'time';
      if (what) {
        this.flying.splice(i, 1);
        s.held = false;
        o.onLand(f, Math.hypot(f.vx, f.vy, f.vz), what);
      }
    }
  }
}
