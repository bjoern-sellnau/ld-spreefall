// What you are holding, and what happens when you pull the trigger.
//
// Hitscan weapons trace the instant you fire, because a bullet that takes 40 ms
// to cross a street is a worse experience than one that does not, and because
// the raycast against the real collision layer is what makes cover mean
// something. Launched and thrown weapons hand off to the projectile layer.
//
// Recoil is an offset, not an increment. The old version added the kick into
// the camera pitch every frame and let a spring pull its own variable back to
// zero, which meant the view climbed and stayed climbed: after a magazine you
// were looking at the sky. Now the view carries the offset while it lasts and
// gets it back as it decays, minus the small share each weapon is allowed to
// keep. That share is what makes a burst walk, rather than a stuck aim.

import { WEAPONS, LOADOUT, KIND, weaponBySlot } from './arsenal.js';

const STATE = { READY: 0, FIRING: 1, RELOADING: 2, HOLSTERED: 3 };
export const WEAPON_STATE = STATE;
export { WEAPONS, LOADOUT, KIND, weaponBySlot };

// Kept so older callers and tests that import SPEC still read the rifle.
export const SPEC = WEAPONS.m16;

export class Weapon {
  constructor(world, drones, opts = {}) {
    this.world = world;
    this.drones = drones;
    // Filled in by the game layer once they exist, so the weapon can hit them.
    this.soldiers = opts.soldiers || null;
    this.jets = opts.jets || null;
    this.projectiles = opts.projectiles || null;

    this.carried = {};
    for (const id of LOADOUT) {
      this.carried[id] = { ammo: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve };
    }
    this.id = 'm16';

    this.state = STATE.READY;
    this.cooldown = 0;
    this.reloadLeft = 0;
    this.spread = WEAPONS.m16.spreadHip;
    this.aiming = false;
    this.aimBlend = 0;
    this.holsterBlend = 0;
    this.swapBlend = 0;

    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilVel = 0;
    this.climb = 0;          // the permanent share, taken by the game layer
    this.kick = 0;
    this.shotsFired = 0;
    this.hits = 0;
    this.triggerWasDown = false;
    // Rocket lock. Hold the sight on something and it fills; look away and it
    // empties twice as fast, so a lock is something you commit to.
    this.lockTarget = null;
    this.lockProgress = 0;
    this.onLock = null;

    this.onFire = null;
    this.onDryFire = null;
    this.onReloadStart = null;
    this.onReloadEnd = null;
    this.onSwap = null;
    this.onSwapFrom = null;
    this.onPlace = null;
    this.holstered = false;
  }

  get spec() { return WEAPONS[this.id]; }
  get ammo() { return this.carried[this.id].ammo; }
  set ammo(n) { this.carried[this.id].ammo = n; }
  get reserve() { return this.carried[this.id].reserve; }
  set reserve(n) { this.carried[this.id].reserve = n; }
  get name() { return this.spec.name; }

  reset() {
    for (const id of LOADOUT) {
      this.carried[id] = { ammo: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve };
    }
    this.id = 'm16';
    this.state = STATE.READY;
    this.cooldown = 0;
    this.reloadLeft = 0;
    this.spread = this.spec.spreadHip;
    this.aiming = false;
    this.aimBlend = 0;
    this.holsterBlend = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilVel = 0;
    this.climb = 0;
    this.kick = 0;
    this.shotsFired = 0;
    this.hits = 0;
    this.holstered = false;
  }

  /** @returns {number} the permanent recoil climb since the last call, radians */
  takeClimb() {
    const c = this.climb;
    this.climb = 0;
    return c;
  }

  select(id) {
    if (!WEAPONS[id] || id === this.id) return false;
    const from = this.id;
    this.id = id;
    if (this.onSwapFrom) this.onSwapFrom(from);
    this.state = STATE.READY;
    this.reloadLeft = 0;
    this.cooldown = Math.max(this.cooldown, 0.35);   // the time it takes to bring up
    this.spread = this.spec.spreadHip;
    this.swapBlend = 1;
    if (this.onSwap) this.onSwap(id, this.spec);
    return true;
  }

  selectSlot(slot) {
    const id = weaponBySlot(slot);
    return id ? this.select(id) : false;
  }

  cycle(dir) {
    const i = LOADOUT.indexOf(this.id);
    const n = LOADOUT.length;
    return this.select(LOADOUT[(i + (dir > 0 ? 1 : n - 1)) % n]);
  }

  setHolstered(on) {
    this.holstered = on;
    if (on && this.state === STATE.RELOADING) {
      this.state = STATE.READY;
      this.reloadLeft = 0;
    }
  }

  startReload() {
    if (this.state === STATE.RELOADING || this.holstered) return false;
    const spec = this.spec;
    if (this.ammo >= spec.magazine || this.reserve <= 0) return false;
    this.state = STATE.RELOADING;
    this.reloadLeft = spec.reloadTime;
    if (this.onReloadStart) this.onReloadStart(spec.reloadTime);
    return true;
  }

  get accuracy() {
    return this.shotsFired ? this.hits / this.shotsFired : 0;
  }

  update(dt, trigger, eye, dir) {
    const spec = this.spec;
    this.holsterBlend += ((this.holstered ? 1 : 0) - this.holsterBlend) * Math.min(1, dt * 7);
    this.aimBlend += ((this.aiming && !this.holstered ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 11);
    this.swapBlend += (0 - this.swapBlend) * Math.min(1, dt * 6);

    // The view spring. It pulls the whole offset back, so the shot kicks and
    // then returns to where you were pointing.
    this.recoilVel += (0 - this.recoilPitch) * 74 * dt;
    this.recoilVel *= Math.max(0, 1 - 11 * dt);
    this.recoilPitch += this.recoilVel * dt;
    this.recoilYaw += (0 - this.recoilYaw) * Math.min(1, dt * 8);
    this.kick += (0 - this.kick) * Math.min(1, dt * 9);

    const base = this.aiming ? spec.spreadAim : spec.spreadHip;
    this.spread += (base - this.spread) * Math.min(1, dt / spec.spreadRecover);

    this._updateLock(dt, spec, eye, dir);

    if (this.cooldown > 0) this.cooldown -= dt;

    if (this.state === STATE.RELOADING) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        const want = spec.magazine - this.ammo;
        const take = Math.min(want, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.state = STATE.READY;
        if (this.onReloadEnd) this.onReloadEnd();
      }
      this.triggerWasDown = trigger;
      return;
    }

    if (this.holstered) { this.triggerWasDown = trigger; return; }

    // A semi automatic needs the trigger released between shots. Holding it
    // down on a shotgun should not empty the tube.
    const pulled = spec.auto ? trigger : (trigger && !this.triggerWasDown);
    if (pulled && this.cooldown <= 0) {
      if (this.ammo > 0) this.fire(eye, dir);
      else if (this.reserve > 0) {
        this.cooldown = 0.32;
        if (this.onDryFire) this.onDryFire();
        this.startReload();
      } else {
        this.cooldown = 0.5;
        if (this.onDryFire) this.onDryFire();
      }
    }
    this.triggerWasDown = trigger;
  }

  _updateLock(dt, spec, eye, dir) {
    if (!spec.lock || this.holstered || !eye || !dir) {
      if (this.lockProgress || this.lockTarget) {
        this.lockProgress = 0;
        this.lockTarget = null;
        if (this.onLock) this.onLock(null, 0);
      }
      return;
    }
    const seen = this._aimedTarget(eye, dir, spec.lock.cone, spec.lock.range);
    if (seen && seen === this.lockTarget) {
      this.lockProgress = Math.min(1, this.lockProgress + dt / spec.lock.time);
    } else if (seen) {
      this.lockTarget = seen;
      this.lockProgress = dt / spec.lock.time;
    } else {
      this.lockProgress -= dt / (spec.lock.time * 0.5);
      if (this.lockProgress <= 0) { this.lockProgress = 0; this.lockTarget = null; }
    }
    if (this.onLock) this.onLock(this.lockTarget, this.lockProgress);
  }

  /** A direction inside the spread cone around dir. */
  _spray(dir, spread) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    let ux = -dir.z, uy = 0, uz = dir.x;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uz /= ul;
    const vx = uy * dir.z - uz * dir.y;
    const vy = uz * dir.x - ux * dir.z;
    const vz = ux * dir.y - uy * dir.x;
    let dx = dir.x + (ux * Math.cos(a) + vx * Math.sin(a)) * r;
    let dy = dir.y + (uy * Math.cos(a) + vy * Math.sin(a)) * r;
    let dz = dir.z + (uz * Math.cos(a) + vz * Math.sin(a)) * r;
    const dl = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / dl, y: dy / dl, z: dz / dl };
  }

  /**
   * The nearest target of any kind along a ray, no further than maxT. One
   * search rather than three chained ones, so adding a kind of enemy does not
   * mean another rung of nested raycasts.
   */
  _nearestTarget(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    const take = (hit, kind, target) => {
      if (!hit) return;
      if (!best || hit.t < best.t) best = { t: hit.t, core: !!hit.core, kind, target };
    };
    if (this.drones) {
      const h = this.drones.raycast(ox, oy, oz, dx, dy, dz, maxT);
      take(h, 'drone', h && h.drone);
    }
    if (this.soldiers) {
      const h = this.soldiers.raycast(ox, oy, oz, dx, dy, dz, maxT);
      take(h, 'soldier', h && h.soldier);
    }
    if (this.jets) {
      const h = this.jets.raycast(ox, oy, oz, dx, dy, dz, maxT);
      take(h, 'jet', h && h.jet);
    }
    return best;
  }

  /** Applies a hit to whatever kind of thing it was. */
  _damage(hit, amount, dir) {
    if (hit.kind === 'soldier') return this.soldiers.damage(hit.target, amount, dir);
    if (hit.kind === 'jet') return this.jets.damage(hit.target, amount);
    return this.drones.damage(hit.target, amount);
  }

  /** One traced shot. Returns what it found. */
  _trace(eye, d, spec) {
    // World first, so nothing behind a wall can be hit through it.
    const wallHit = this.world.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, spec.range);
    const wallT = wallHit ? wallHit.t : spec.range;
    const near = this._nearestTarget(eye.x, eye.y, eye.z, d.x, d.y, d.z, wallT);

    if (near) {
      const out = {
        kind: near.kind, t: near.t, core: near.core, target: near.target,
        end: {
          x: eye.x + d.x * near.t, y: eye.y + d.y * near.t, z: eye.z + d.z * near.t,
          nx: -d.x, ny: -d.y, nz: -d.z,
        },
      };
      out[near.kind] = near.target;
      return out;
    }
    if (wallHit) {
      return {
        kind: wallHit.kind, t: wallHit.t,
        end: { x: wallHit.x, y: wallHit.y, z: wallHit.z, nx: wallHit.nx, ny: wallHit.ny, nz: wallHit.nz },
      };
    }
    return {
      kind: 'air', t: spec.range,
      end: {
        x: eye.x + d.x * spec.range, y: eye.y + d.y * spec.range, z: eye.z + d.z * spec.range,
        nx: -d.x, ny: -d.y, nz: -d.z,
      },
    };
  }

  fire(eye, dir) {
    const spec = this.spec;
    this.ammo--;
    this.cooldown = spec.fireInterval;
    this.shotsFired++;

    if (spec.kind === KIND.HITSCAN) this._fireHitscan(eye, dir, spec);
    else this._fireProjectile(eye, dir, spec);

    // Climb the cone, kick the view, and keep only the share this weapon is
    // allowed to keep.
    this.spread = Math.min(spec.spreadMax, this.spread + spec.spreadPerShot);
    const aimScale = 1 - this.aimBlend * 0.4;
    this.recoilVel += spec.recoilKick * 60 * aimScale;
    this.recoilYaw += (Math.random() - 0.5) * spec.recoilSide * aimScale;
    this.climb += spec.recoilKick * spec.recoilRetain * aimScale;
    this.kick = 1;

    if (this.ammo === 0 && this.reserve > 0) this.startReload();
  }

  /**
   * A rail shot does not stop at the first man. It goes through as many as
   * pierce allows, and only a wall ends it, which is the whole reason to line
   * a corridor up before you pull.
   */
  _firePiercing(eye, dir, spec) {
    const d = this._spray(dir, this.spread);
    const wallHit = this.world.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, spec.range);
    const wallT = wallHit ? wallHit.t : spec.range;
    const seen = new Set();
    let hits = 0;
    let from = 0;
    for (let i = 0; i < spec.pierce; i++) {
      const ox = eye.x + d.x * from, oy = eye.y + d.y * from, oz = eye.z + d.z * from;
      const left = wallT - from;
      if (left <= 0.01) break;
      const near = this._nearestTarget(ox, oy, oz, d.x, d.y, d.z, left);
      if (!near) break;
      const target = near.target;
      if (seen.has(target)) { from += near.t + 0.4; continue; }
      seen.add(target);
      const dmg = spec.damage * (near.core ? spec.coreMultiplier : 1);
      const killed = this._damage(near, dmg, dir);
      hits++;
      if (this.onFire) {
        this.onFire({
          from: { x: eye.x, y: eye.y, z: eye.z },
          dir: d,
          end: {
            x: ox + d.x * near.t, y: oy + d.y * near.t, z: oz + d.z * near.t,
            nx: -d.x, ny: -d.y, nz: -d.z,
          },
          drone: near.kind === 'drone' ? target : null,
          soldier: near.kind === 'soldier' ? target : null,
          jet: near.kind === 'jet' ? target : null,
          target,
          core: !!near.core, killed, surface: near.kind,
          pellet: hits, pellets: 1, beam: true,
        });
      }
      from += near.t + 0.4;
    }
    if (hits) this.hits++;
    // The beam itself always reaches the wall, whoever was standing in it.
    if (this.onFire) {
      this.onFire({
        from: { x: eye.x, y: eye.y, z: eye.z },
        dir: d,
        end: wallHit
          ? { x: wallHit.x, y: wallHit.y, z: wallHit.z, nx: wallHit.nx, ny: wallHit.ny, nz: wallHit.nz }
          : {
            x: eye.x + d.x * spec.range, y: eye.y + d.y * spec.range, z: eye.z + d.z * spec.range,
            nx: -d.x, ny: -d.y, nz: -d.z,
          },
        drone: null, soldier: null, jet: null, target: null, core: false, killed: false,
        surface: wallHit ? wallHit.kind : 'air',
        pellet: 0, pellets: 1, beam: true, pierced: hits,
      });
    }
  }

  _fireHitscan(eye, dir, spec) {
    if (spec.pierce) { this._firePiercing(eye, dir, spec); return; }
    const pellets = spec.pellets || 1;
    let best = null;
    let hitAnything = false;
    for (let i = 0; i < pellets; i++) {
      const d = this._spray(dir, this.spread);
      const shot = this._trace(eye, d, spec);
      const isTarget = !!shot.target;
      if (isTarget) {
        hitAnything = true;
        const mult = shot.core ? spec.coreMultiplier : 1;
        shot.killed = this._damage(shot, spec.damage * mult, dir);
      }
      // The report is about the most interesting pellet: a kill beats a hit,
      // a hit beats a wall, and one wall is as good as another.
      if (!best || (isTarget && !best.target) || (shot.killed && !best.killed)) best = shot;
      if (this.onFire) {
        this.onFire({
          from: { x: eye.x, y: eye.y, z: eye.z },
          dir: d,
          end: shot.end,
          drone: shot.drone || null,
          soldier: shot.soldier || null,
          jet: shot.jet || null,
          target: shot.target || null,
          core: !!shot.core,
          killed: !!shot.killed,
          surface: shot.kind,
          pellet: i,
          pellets,
        });
      }
    }
    if (hitAnything) this.hits++;
  }

  /** Whoever the sight is on, for the darts and for a locked rocket. */
  _aimedTarget(eye, dir, cone, range) {
    let best = null;
    let bestDot = Math.cos(cone);
    const consider = (o, x, y, z) => {
      const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
      const l = Math.hypot(dx, dy, dz);
      if (l > range || l < 1) return;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / l;
      if (dot < bestDot) return;
      // It is only a target if you can see it.
      if (!this.world.lineOfSight(eye.x, eye.y, eye.z, x, y, z)) return;
      bestDot = dot;
      best = o;
    };
    if (this.drones) for (const d of this.drones.active) {
      if (d.alive && d.state !== 4) consider(d, d.x, d.y, d.z);
    }
    if (this.soldiers) for (const s of this.soldiers.active) {
      if (s.alive && s.state !== 5) consider(s, s.x, s.y + 1.1, s.z);
    }
    if (this.jets) for (const j of this.jets.active) {
      if (j.alive && j.state !== 4) consider(j, j.x, j.y, j.z);
    }
    return best;
  }

  _fireProjectile(eye, dir, spec) {
    if (!this.projectiles) return;
    // Flak throws a handful at once, each on its own line.
    const count = spec.shards || 1;
    for (let i = 1; i < count; i++) {
      const sd = this._spray(dir, this.spread * 1.35);
      this.projectiles.launch(spec.projectile, {
        x: eye.x + sd.x * 0.6, y: eye.y + sd.y * 0.6 - 0.12, z: eye.z + sd.z * 0.6,
        vx: sd.x * spec.muzzleSpeed * (0.8 + Math.random() * 0.4),
        vy: sd.y * spec.muzzleSpeed * (0.8 + Math.random() * 0.4) + 1.2,
        vz: sd.z * spec.muzzleSpeed * (0.8 + Math.random() * 0.4),
        fuse: spec.fuse, splash: spec.splash, weapon: this.id,
      });
    }
    const d = this._spray(dir, this.spread);
    // Darts chase whoever the sight is on; a rocket only chases what you have
    // actually held the sight on long enough to lock.
    let homing = null;
    let target = null;
    if (spec.homing) {
      homing = spec.homing;
      target = this._aimedTarget(eye, dir, 0.22, spec.homing.range);
    } else if (spec.lock && this.lockTarget && this.lockProgress >= 1) {
      homing = { turn: spec.lock.turn, range: spec.lock.range };
      target = this.lockTarget;
    }
    const launched = this.projectiles.launch(spec.projectile, {
      x: eye.x + d.x * 0.6, y: eye.y + d.y * 0.6 - 0.12, z: eye.z + d.z * 0.6,
      vx: d.x * spec.muzzleSpeed,
      vy: d.y * spec.muzzleSpeed + (spec.kind === KIND.THROW ? 3.4 : 0),
      vz: d.z * spec.muzzleSpeed,
      fuse: spec.fuse,
      splash: spec.splash,
      slip: spec.slip,
      weapon: this.id,
      homing, target,
    });
    if (spec.lock) {
      // Clearing it silently leaves the ring on screen for ever, because the
      // interface only hears about a lock when this says so.
      this.lockProgress = 0;
      this.lockTarget = null;
      if (this.onLock) this.onLock(null, 0);
    }
    if (spec.kind === KIND.PLACE && this.onPlace) this.onPlace(launched);
    if (this.onFire) {
      this.onFire({
        from: { x: eye.x, y: eye.y, z: eye.z },
        dir: d,
        end: null,
        drone: null, soldier: null, jet: null, target: null, core: false, killed: false,
        surface: 'launch',
        projectile: launched,
        pellet: 0, pellets: 1,
      });
    }
  }

  /** Blow every piece of C4 you have put down. */
  detonate() {
    if (!this.projectiles) return 0;
    return this.projectiles.detonateAll('c4');
  }
}
