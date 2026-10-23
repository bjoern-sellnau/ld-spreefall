// Everything that leaves your hand and arrives somewhere else under its own
// steam: rockets, grenades, C4 and the banana.
//
// They move by integration and collide against the same raycast the bullets
// use, so a grenade bounces off the real wall of a real building and rolls
// down the real kerb. Nothing here knows what it is going to hit; it asks the
// world, like everything else in this project.

// Room for ultra plasma, which keeps up to 480 balls in the air on top of
// whatever else is flying. Bodies are plain objects in an array, and a pool
// this size costs nothing while it is empty.
const MAX = 640;

export const PROJECTILE = {
  rocket: {
    radius: 0.22, gravity: 0, drag: 0, bounce: 0, armTime: 0.02, maxAge: 7,
    detonateOnContact: true, trail: 'smoke', light: true, spin: 0,
  },
  grenade: {
    radius: 0.10, gravity: 19.6, drag: 0.12, bounce: 0.42, armTime: 0.25,
    detonateOnContact: false, trail: 'none', light: false, spin: 14,
  },
  shell: {
    // Out of the grenade launcher: the grenade's drop at a third of its
    // weight, so it carries, and it goes off on the first thing it touches.
    radius: 0.09, gravity: 7, drag: 0.02, bounce: 0, armTime: 0.06, maxAge: 9,
    detonateOnContact: true, trail: 'smoke', light: false, spin: 18,
  },
  incendiary: {
    // Heavier than a grenade and it does not bounce about: it lands where it
    // was thrown, which is what you want from something that sets a street on
    // fire rather than clears a room.
    radius: 0.13, gravity: 19.6, drag: 0.1, bounce: 0.18, armTime: 0.2,
    detonateOnContact: false, trail: 'none', light: true, spin: 9,
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
  ultra: {
    // A plasma bolt the size of a football, coming down from orbit. It
    // bounces like the rifle's, twice, and goes off on the third thing it
    // meets or when it runs out of speed.
    radius: 0.5, gravity: 2.2, drag: 0, bounce: 0.55, armTime: 0.02, maxAge: 16,
    detonateOnContact: false, bounces: 2, trail: 'glow', light: true, spin: 0,
  },
  blast: {
    // Blast plasma out of the rifle, after a long hold of the second trigger:
    // harder than a bolt, so it does not bounce, it goes off on the first
    // thing it touches.
    radius: 0.24, gravity: 1.0, drag: 0, bounce: 0, armTime: 0.02, maxAge: 4,
    detonateOnContact: true, trail: 'glow', light: true, spin: 0,
  },
  ultraBlast: {
    // And out of orbit, the same way.
    radius: 0.6, gravity: 2.2, drag: 0, bounce: 0, armTime: 0.02, maxAge: 16,
    detonateOnContact: true, trail: 'glow', light: true, spin: 0,
  },
  flak: {
    radius: 0.10, gravity: 14, drag: 0.05, bounce: 0.3, armTime: 0.02, maxAge: 2.6,
    detonateOnContact: false, bounces: 1, trail: 'spark', light: false, spin: 22,
  },
  splinter: {
    radius: 0.09, gravity: 1.5, drag: 0, bounce: 0, armTime: 0.05, maxAge: 3.5,
    detonateOnContact: true, trail: 'spark', light: true, spin: 26,
  },
  void: {
    // Big and slow on purpose: you see it go, and so does everybody it is
    // going past. It goes off on the first thing it touches.
    radius: 0.7, gravity: 0, drag: 0, bounce: 0, armTime: 0.05, maxAge: 9,
    detonateOnContact: true, trail: 'void', light: true, spin: 3,
  },
  shieldsaw: {
    // Thrown flat and spinning: it cuts through what it meets, turns round
    // after a moment or off a wall, and comes back to your hand.
    radius: 0.32, gravity: 0, drag: 0, bounce: 0, armTime: 0.0, maxAge: 4,
    detonateOnContact: false, saw: true, out: 0.6, back: 42, trail: 'spark', light: true, spin: 30,
  },
  fireball: {
    // A demon's fire. It is not ours: it does not go through the blast that
    // knocks the city down, it does not hurt other demons, and the only
    // thing it is looking for is you.
    radius: 0.3, gravity: 1.2, drag: 0, bounce: 0, armTime: 0.05, maxAge: 6,
    detonateOnContact: true, hostile: true, trail: 'glow', light: true, spin: 6,
  },
  arrow: {
    // An arrow: it drops, it goes into whatever it meets and stays there, and
    // the harm it does is its own rather than a blast's.
    radius: 0.03, gravity: 6.5, drag: 0.01, bounce: 0, armTime: 0.0, maxAge: 25,
    detonateOnContact: false, sticks: true, arrow: true, trail: 'none', light: false, spin: 0,
  },
  voidMaw: {
    // The mech's void arm: the cannon's ball nearly twice across, a little
    // quicker, and with the range a forty tonne gun ought to have.
    radius: 1.3, gravity: 0, drag: 0, bounce: 0, armTime: 0.08, maxAge: 14,
    detonateOnContact: true, trail: 'void', light: true, spin: 2,
  },
  voidStorm: {
    // The same ball out of orbit: faster, because four hundred metres at the
    // cannon's walking pace is a quarter of a minute, and given long enough
    // to come in at a slant from a long way off.
    radius: 0.7, gravity: 0, drag: 0, bounce: 0, armTime: 0.05, maxAge: 28,
    detonateOnContact: true, trail: 'void', light: true, spin: 3,
  },
  nuke: {
    // Dropped rather than fired, so it comes in fast and nothing stops it on
    // the way down. The radius is the warhead's own body, not its blast.
    radius: 0.6, gravity: 19.6, drag: 0, bounce: 0, armTime: 0.1, maxAge: 20,
    detonateOnContact: true, trail: 'smoke', light: true, spin: 2,
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
    this.onArrow = null;     // fn(body, hit) when an arrow goes into somebody
    this.onArrowHead = null; // fn(body, x, y, z) wherever an arrow lands, for its head
    // Hostile fire: where the player is, and what to do when it arrives.
    this.player = null;      // {x, y, z} at the feet
    this.onHostile = null;   // fn(body, x, y, z, direct) when it goes off
    this.onSaw = null;       // fn(body, hit) the shield saw goes through somebody
    this.onSawBack = null;   // fn(body) and comes back to the hand
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
    // Two things a shot can carry on itself rather than in a weapon row,
    // because a mech's arms are their own table and so is a warhead: the
    // fire a thermite canister leaves behind, and the pulse an EMP puts out.
    b.thermite = o.thermite || null;
    b.emp = o.emp || null;
    b.mechKill = o.mechKill || null;
    // And what a void ball reaches out with, when it was not the cannon's.
    b.void = o.void || null;
    // An arrow's head: plain, fire, poison or blast.
    b.head = o.head || null;
    b.draw = o.draw || null;
    // Flak: how near the thing it was fired at the shell has to get before it
    // bursts. A shell that has to hit an aircraft is a shell that never does.
    b.proximity = o.proximity || 0;
    // And the charge that is looking for a parked car to be.
    b.carbomb = o.carbomb || 0;
    b.spin = 0;
    b.fx = undefined;
    b.returning = false;
    b.hitSet = null;
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
      // Close enough to what it was fired at. The target is a body rather
      // than a point, so a shell chasing a jet bursts where the jet is now.
      if (b.proximity > 0 && b.target) {
        const t = b.target;
        if (t.health === undefined || t.health > 0) {
          if (Math.hypot(t.x - b.x, (t.y || 0) - b.y, t.z - b.z) <= b.proximity) {
            this.explode(b);
            continue;
          }
        } else {
          b.proximity = 0;
        }
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
        if (b.age > (b.spec.arrow ? 25 : 240)) this._remove(b);
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

      // The shield saw: out for a moment, then back to the hand, which it
      // reaches whatever is in the way, because a weapon that can be lost
      // round a corner is a weapon you stop throwing.
      if (b.spec.saw && this.player) {
        const p = this.player;
        const hx = p.x - b.x, hy = p.y + 1.3 - b.y, hz = p.z - b.z;
        const hd = Math.hypot(hx, hy, hz) || 1;
        if (b.age > b.spec.out) b.returning = true;
        if (b.returning) {
          if (hd < 1.4 || b.age > b.spec.maxAge - 0.1) {
            if (this.onSawBack) this.onSawBack(b);
            this._remove(b);
            continue;
          }
          b.vx = hx / hd * b.spec.back; b.vy = hy / hd * b.spec.back; b.vz = hz / hd * b.spec.back;
          b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          // On the way back it still cuts.
          if (this.hitActors) {
            const a = this.hitActors(b.x, b.y, b.z, hx / hd, hy / hd, hz / hd, 1.2);
            if (a && a.kind !== 'vehicle' && !(b.hitSet && b.hitSet.has(a.target))) {
              (b.hitSet || (b.hitSet = new Set())).add(a.target);
              if (this.onSaw) this.onSaw(b, { kind: 'actor', actorKind: a.kind, target: a.target, core: false,
                x: b.x, y: b.y, z: b.z });
            }
          }
          continue;
        }
      }

      // Hostile fire looks for you and for nothing else.
      if (b.spec.hostile && this.player && b.age > b.spec.armTime) {
        const p = this.player;
        const cy = Math.max(p.y + 0.2, Math.min(p.y + 1.6, b.y));
        if (Math.hypot(b.x - p.x, b.y - cy, b.z - p.z) < 0.55 + b.spec.radius) {
          if (this.onHostile) this.onHostile(b, b.x, b.y, b.z, true);
          this._remove(b);
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
        if (this.hitActors && !b.spec.hostile) {
          const actor = this.hitActors(b.x, b.y, b.z, dx, dy, dz, hit ? hit.t : dist);
          if (actor && (!hit || actor.t < hit.t)) {
            hit = {
              t: actor.t, kind: 'actor', target: actor.target,
              actorKind: actor.kind, core: !!actor.core,
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

        if (b.spec.hostile) {
          if (this.onHostile) this.onHostile(b, b.x, b.y, b.z, false);
          this._remove(b);
          remaining = 0;
          break;
        }

        // The saw goes through a body and on, and off a wall it turns home.
        if (b.spec.saw) {
          if (hit.kind === 'actor') {
            if (!(b.hitSet && b.hitSet.has(hit.target))) {
              (b.hitSet || (b.hitSet = new Set())).add(hit.target);
              if (this.onSaw) this.onSaw(b, hit);
            }
            b.x += dx * Math.min(remaining * speed, 1.2);
            b.y += dy * Math.min(remaining * speed, 1.2);
            b.z += dz * Math.min(remaining * speed, 1.2);
            remaining = 0;
            break;
          }
          b.returning = true;
          remaining = 0;
          break;
        }

        // An arrow goes into a body and is done, or into a wall and stays.
        if (b.spec.arrow) {
          if (hit.kind === 'actor') {
            if (this.onArrow) this.onArrow(b, hit);
            if (this.onArrowHead) this.onArrowHead(b, hit.x, hit.y, hit.z);
            this._remove(b);
            remaining = 0;
            break;
          }
          if (this.onArrowHead) this.onArrowHead(b, b.x + dx * 0.22, b.y + dy * 0.22, b.z + dz * 0.22);
          b.stuck = true;
          b.fx = b.vx; b.fy = b.vy; b.fz = b.vz;
          b.vx = b.vy = b.vz = 0;
          // Into the surface by a third of its length.
          b.x += dx * 0.22; b.y += dy * 0.22; b.z += dz * 0.22;
          remaining = 0;
          break;
        }

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
