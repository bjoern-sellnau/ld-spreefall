// Everything that leaves your hand and arrives somewhere else under its own
// steam: rockets, grenades, C4 and the banana.
//
// They move by integration and collide against the same raycast the bullets
// use, so a grenade bounces off the real wall of a real building and rolls
// down the real kerb. Nothing here knows what it is going to hit; it asks the
// world, like everything else in this project.

const MAX = 64;

export const PROJECTILE = {
  rocket: {
    radius: 0.22, gravity: 0, drag: 0, bounce: 0, armTime: 0.02, maxAge: 7,
    detonateOnContact: true, trail: 'smoke', light: true, spin: 0,
  },
  grenade: {
    radius: 0.10, gravity: 19.6, drag: 0.12, bounce: 0.42, armTime: 0.25,
    detonateOnContact: false, trail: 'none', light: false, spin: 14,
  },
  c4: {
    // Sticks where it lands and waits for you.
    radius: 0.12, gravity: 19.6, drag: 0.35, bounce: 0.08, armTime: 0.2,
    detonateOnContact: false, sticks: true, trail: 'none', light: true, spin: 6,
  },
  plasma: {
    radius: 0.16, gravity: 2.2, drag: 0, bounce: 0.55, armTime: 0.02,
    // A bolt burns out. Without this a slow one hangs over the city for a
    // minute, because the gravity on it is deliberately almost nothing.
    maxAge: 3.2,
    detonateOnContact: false, bounces: 2, trail: 'glow', light: true, spin: 0,
    // A bolt that has run out of bounces goes off on the next thing it meets.
  },
  flak: {
    radius: 0.10, gravity: 14, drag: 0.05, bounce: 0.3, armTime: 0.02, maxAge: 2.6,
    detonateOnContact: false, bounces: 1, trail: 'spark', light: false, spin: 22,
  },
  splinter: {
    radius: 0.09, gravity: 1.5, drag: 0, bounce: 0, armTime: 0.05, maxAge: 3.5,
    detonateOnContact: true, trail: 'spark', light: true, spin: 26,
  },
  banana: {
    radius: 0.12, gravity: 19.6, drag: 0.2, bounce: 0.25, armTime: 0.2,
    detonateOnContact: false, sticks: true, trail: 'none', light: false, spin: 10,
    // It never goes off. It lies there being a banana.
    inert: true,
  },
};

class Body {
  constructor() { this.alive = false; }
}

export class Projectiles {
  /**
   * @param {object} world the collision world, for raycasting
   * @param {(x,y,z,splash)=>void} onExplode called when something goes off
   */
  constructor(world, onExplode) {
    this.world = world;
    this.onExplode = onExplode || (() => {});
    this.pool = [];
    for (let i = 0; i < MAX; i++) this.pool.push(new Body());
    this.active = [];
    this.onBounce = null;
    // Set by the game layer: the same raycast the bullets use against drones
    // and soldiers. Without it a rocket flies through the man it was aimed at
    // and goes off on the wall behind him, which is exactly what the first
    // version of this did.
    this.hitActors = null;
  }

  clear() {
    for (const b of this.pool) b.alive = false;
    this.active.length = 0;
  }

  _free() {
    for (const b of this.pool) if (!b.alive) return b;
    // Everything is busy: take the oldest, which is the one that has been in
    // the air longest and is least likely to be the one you just threw.
    let worst = this.active[0];
    for (const b of this.active) if (b.age > worst.age) worst = b;
    this._remove(worst);
    return worst;
  }

  _remove(b) {
    b.alive = false;
    const i = this.active.indexOf(b);
    if (i >= 0) this.active.splice(i, 1);
  }

  /**
   * @param {string} kind a key of PROJECTILE
   * @param {object} o {x,y,z, vx,vy,vz, fuse, splash, slip, weapon}
   */
  launch(kind, o) {
    const spec = PROJECTILE[kind] || PROJECTILE.grenade;
    const b = this._free();
    b.alive = true;
    b.kind = kind;
    b.spec = spec;
    b.x = o.x; b.y = o.y; b.z = o.z;
    b.vx = o.vx; b.vy = o.vy; b.vz = o.vz;
    b.fuse = o.fuse !== undefined ? o.fuse : Infinity;
    b.splash = o.splash || null;
    b.slip = o.slip || null;
    b.weapon = o.weapon || kind;
    b.age = 0;
    b.stuck = false;
    b.bouncesLeft = spec.bounces !== undefined ? spec.bounces : Infinity;
    b.homing = o.homing || null;
    b.target = o.target || null;
    b.spin = 0;
    b.seed = Math.random();
    this.active.push(b);
    return b;
  }

  /** Blow everything of one kind at once, which is what the C4 trigger is. */
  detonateAll(kind) {
    let n = 0;
    for (const b of [...this.active]) {
      if (b.kind !== kind) continue;
      this.explode(b);
      n++;
    }
    return n;
  }

  explode(b) {
    if (!b.alive) return;
    this._remove(b);
    if (b.splash) this.onExplode(b.x, b.y, b.z, b.splash, b);
  }

  /** The bananas lying about, for whoever might step on one. */
  hazards() {
    const out = [];
    for (const b of this.active) if (b.slip && b.stuck) out.push(b);
    return out;
  }

  update(dt) {
    const w = this.world;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.age += dt;
      b.spin += b.spec.spin * dt;

      if (b.fuse !== Infinity) {
        b.fuse -= dt;
        if (b.fuse <= 0) { this.explode(b); continue; }
      }
      // Anything with a burn time goes off where it runs out, so nothing
      // loiters over the city waiting for a wall.
      if (b.spec.maxAge && b.age > b.spec.maxAge) {
        if (b.splash) this.explode(b); else this._remove(b);
        continue;
      }

      if (b.stuck) {
        // A stuck charge still ages out, so a forgotten banana does not live
        // forever in a city you have walked away from.
        if (b.age > 240) this._remove(b);
        continue;
      }

      // Chasing. A dart or a locked rocket turns towards its target at a fixed
      // rate, which is what makes it dodgeable: it can out turn a man but not
      // a corner.
      if (b.homing && b.target && b.target.alive !== false) {
        const tx = b.target.x - b.x;
        const ty = (b.target.y + (b.target.height ? b.target.height * 0.5 : 0.9)) - b.y;
        const tz = b.target.z - b.z;
        const tl = Math.hypot(tx, ty, tz);
        if (tl > 0.5 && tl < (b.homing.range || 400)) {
          const speed = Math.hypot(b.vx, b.vy, b.vz) || 1;
          const k = Math.min(1, b.homing.turn * dt);
          b.vx += (tx / tl * speed - b.vx) * k;
          b.vy += (ty / tl * speed - b.vy) * k;
          b.vz += (tz / tl * speed - b.vz) * k;
          // Keep the speed it was launched with, so steering costs nothing.
          const now = Math.hypot(b.vx, b.vy, b.vz) || 1;
          b.vx *= speed / now; b.vy *= speed / now; b.vz *= speed / now;
        }
      }

      // A proximity fuse for anything that chases: a warhead that only goes
      // off on a direct hit is a warhead that mostly misses, and the splash is
      // there to do the work anyway.
      if (b.homing && b.target && b.splash && b.age > b.spec.armTime) {
        const px = b.target.x - b.x;
        const py = (b.target.y + (b.target.height ? b.target.height * 0.5 : 0.9)) - b.y;
        const pz = b.target.z - b.z;
        if (Math.hypot(px, py, pz) < Math.max(1.4, b.splash.radius * 0.35)) {
          this.explode(b);
          continue;
        }
      }

      if (b.spec.gravity) b.vy -= b.spec.gravity * dt;
      if (b.spec.drag) {
        const k = Math.max(0, 1 - b.spec.drag * dt);
        b.vx *= k; b.vy *= k; b.vz *= k;
      }

      let travel = Math.hypot(b.vx, b.vy, b.vz) * dt;
      if (travel < 1e-6) { b.stuck = b.spec.sticks; continue; }

      // Step along the path, asking the world what is in the way. Two bounces
      // in one frame is enough for a corner; more than that and it is resting.
      let remaining = dt;
      for (let step = 0; step < 3 && remaining > 1e-5; step++) {
        const speed = Math.hypot(b.vx, b.vy, b.vz);
        if (speed < 1e-6) break;
        const dx = b.vx / speed, dy = b.vy / speed, dz = b.vz / speed;
        const dist = speed * remaining + b.spec.radius;
        let hit = w.raycast(b.x, b.y, b.z, dx, dy, dz, dist);
        // Whoever is in the way counts too, and the nearer of the two wins.
        if (this.hitActors) {
          const actor = this.hitActors(b.x, b.y, b.z, dx, dy, dz, hit ? hit.t : dist);
          if (actor && (!hit || actor.t < hit.t)) {
            hit = {
              t: actor.t, kind: 'actor', target: actor.target,
              x: b.x + dx * actor.t, y: b.y + dy * actor.t, z: b.z + dz * actor.t,
              nx: -dx, ny: -dy, nz: -dz,
            };
          }
        }
        if (!hit) {
          b.x += b.vx * remaining;
          b.y += b.vy * remaining;
          b.z += b.vz * remaining;
          remaining = 0;
          break;
        }

        // Stop just short of the surface.
        const t = Math.max(0, hit.t - b.spec.radius);
        b.x += dx * t; b.y += dy * t; b.z += dz * t;
        const used = t / speed;
        remaining = Math.max(0, remaining - used);

        // A bolt with bounces left rebounds; one without goes off.
        if (b.bouncesLeft !== undefined && b.bouncesLeft !== Infinity && b.age > b.spec.armTime) {
          if (b.bouncesLeft <= 0 || hit.kind === 'actor') {
            this.explode(b);
            remaining = 0;
            b.alive = false;
            break;
          }
          b.bouncesLeft--;
        }
        if (b.spec.detonateOnContact && b.age > b.spec.armTime) {
          this.explode(b);
          remaining = 0;
          b.alive = false;
          break;
        }

        const nx = hit.nx, ny = hit.ny, nz = hit.nz;
        const dot = b.vx * nx + b.vy * ny + b.vz * nz;
        b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; b.vz -= 2 * dot * nz;
        const keep = b.spec.bounce;
        b.vx *= keep; b.vy *= keep; b.vz *= keep;
        // Friction along the surface, so a grenade does not skate for ever.
        b.vx *= 0.82; b.vz *= 0.82;
        if (this.onBounce) this.onBounce(b, hit);

        // A bolt of energy never comes to rest on the cobbles. When it runs
        // out of speed it goes off, which is also what stops a plasma round
        // lying in the street for four seconds waiting for its fuse.
        if (b.spec.bounces !== undefined && Math.hypot(b.vx, b.vy, b.vz) < 3) {
          this.explode(b);
          remaining = 0;
          b.alive = false;
          break;
        }
        if (b.spec.sticks || Math.hypot(b.vx, b.vy, b.vz) < 1.2) {
          b.stuck = true;
          b.vx = b.vy = b.vz = 0;
          // Sit on the surface rather than in it.
          b.x += nx * 0.02; b.y += ny * 0.02; b.z += nz * 0.02;
          remaining = 0;
          break;
        }
      }

      if (!b.alive) continue;
      // Anything that leaves the box, or falls through the world, is done.
      if (b.y < -40 || b.age > 30) this._remove(b);
    }
  }

  get count() { return this.active.length; }
}
