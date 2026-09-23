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

  /** One traced shot. Returns what it found. */
  _trace(eye, d, spec) {
    // World first, so nothing behind a wall can be hit through it.
    const wallHit = this.world.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, spec.range);
    const wallT = wallHit ? wallHit.t : spec.range;
    const droneHit = this.drones ? this.drones.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, wallT) : null;
    const soldierHit = this.soldiers
      ? this.soldiers.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, droneHit ? droneHit.t : wallT)
      : null;

    if (soldierHit) {
      return {
        kind: 'soldier', t: soldierHit.t, soldier: soldierHit.soldier, core: soldierHit.core,
        end: {
          x: eye.x + d.x * soldierHit.t, y: eye.y + d.y * soldierHit.t, z: eye.z + d.z * soldierHit.t,
          nx: -d.x, ny: -d.y, nz: -d.z,
        },
      };
    }
    if (droneHit) {
      return {
        kind: 'drone', t: droneHit.t, drone: droneHit.drone, core: droneHit.core,
        end: {
          x: eye.x + d.x * droneHit.t, y: eye.y + d.y * droneHit.t, z: eye.z + d.z * droneHit.t,
          nx: -d.x, ny: -d.y, nz: -d.z,
        },
      };
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

  _fireHitscan(eye, dir, spec) {
    const pellets = spec.pellets || 1;
    let best = null;
    let hitAnything = false;
    for (let i = 0; i < pellets; i++) {
      const d = this._spray(dir, this.spread);
      const shot = this._trace(eye, d, spec);
      const isTarget = shot.kind === 'drone' || shot.kind === 'soldier';
      if (isTarget) {
        hitAnything = true;
        const mult = shot.core ? spec.coreMultiplier : 1;
        const dmg = spec.damage * mult;
        if (shot.kind === 'drone') shot.killed = this.drones.damage(shot.drone, dmg);
        else shot.killed = this.soldiers.damage(shot.soldier, dmg, dir);
      }
      // The report is about the most interesting pellet: a kill beats a hit,
      // a hit beats a wall, and one wall is as good as another.
      if (!best || (isTarget && !(best.kind === 'drone' || best.kind === 'soldier'))
        || (shot.killed && !best.killed)) best = shot;
      if (this.onFire) {
        this.onFire({
          from: { x: eye.x, y: eye.y, z: eye.z },
          dir: d,
          end: shot.end,
          drone: shot.drone || null,
          soldier: shot.soldier || null,
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

  _fireProjectile(eye, dir, spec) {
    if (!this.projectiles) return;
    const d = this._spray(dir, this.spread);
    const launched = this.projectiles.launch(spec.projectile, {
      x: eye.x + d.x * 0.6, y: eye.y + d.y * 0.6 - 0.12, z: eye.z + d.z * 0.6,
      vx: d.x * spec.muzzleSpeed,
      vy: d.y * spec.muzzleSpeed + (spec.kind === KIND.THROW ? 3.4 : 0),
      vz: d.z * spec.muzzleSpeed,
      fuse: spec.fuse,
      splash: spec.splash,
      slip: spec.slip,
      weapon: this.id,
    });
    if (spec.kind === KIND.PLACE && this.onPlace) this.onPlace(launched);
    if (this.onFire) {
      this.onFire({
        from: { x: eye.x, y: eye.y, z: eye.z },
        dir: d,
        end: null,
        drone: null, soldier: null, core: false, killed: false,
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
