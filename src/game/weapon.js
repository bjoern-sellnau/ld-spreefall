// The weapon. Hitscan, because a projectile that takes 40 ms to cross a street
// is a worse experience than one that does not, and because the raycast against
// the real collision layer is what makes cover mean anything: you cannot shoot
// a drone through the Brandenburg Gate.

const STATE = { READY: 0, FIRING: 1, RELOADING: 2, HOLSTERED: 3 };
export const WEAPON_STATE = STATE;

export const SPEC = {
  magazine: 30,
  reloadTime: 1.55,
  fireInterval: 0.105,
  damage: 38,
  coreMultiplier: 2.2,
  range: 320,
  spreadHip: 0.016,
  spreadAim: 0.0035,
  spreadPerShot: 0.0075,
  spreadMax: 0.055,
  spreadRecover: 0.055,
  recoilKick: 0.0125,
  recoilSide: 0.004,
  aimFov: 42 * Math.PI / 180,
};

export class Weapon {
  constructor(world, drones) {
    this.world = world;
    this.drones = drones;
    this.state = STATE.READY;
    this.ammo = SPEC.magazine;
    this.reserve = 240;
    this.cooldown = 0;
    this.reloadLeft = 0;
    this.spread = SPEC.spreadHip;
    this.aiming = false;
    this.aimBlend = 0;
    this.holsterBlend = 0;
    // Recoil is carried as a camera offset that decays, so the view kicks and
    // settles rather than permanently dragging the aim upward.
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilVel = 0;
    this.kick = 0;
    this.shotsFired = 0;
    this.hits = 0;
    this.onFire = null;      // fn({from, dir, hit, drone, core, killed})
    this.onDryFire = null;
    this.onReloadStart = null;
    this.onReloadEnd = null;
    this.holstered = false;
  }

  reset() {
    this.state = STATE.READY;
    this.ammo = SPEC.magazine;
    this.reserve = 240;
    this.cooldown = 0;
    this.reloadLeft = 0;
    this.spread = SPEC.spreadHip;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.kick = 0;
    this.shotsFired = 0;
    this.hits = 0;
  }

  get accuracy() {
    return this.shotsFired ? this.hits / this.shotsFired : 0;
  }

  setHolstered(on) {
    this.holstered = on;
    if (on && this.state === STATE.RELOADING) {
      this.state = STATE.READY;
      this.reloadLeft = 0;
    }
  }

  startReload() {
    if (this.holstered) return false;
    if (this.state === STATE.RELOADING) return false;
    if (this.ammo >= SPEC.magazine || this.reserve <= 0) return false;
    this.state = STATE.RELOADING;
    this.reloadLeft = SPEC.reloadTime;
    if (this.onReloadStart) this.onReloadStart();
    return true;
  }

  /**
   * @param {boolean} trigger held down this step
   * @param {{x,y,z}} eye
   * @param {{x,y,z}} dir normalised look direction
   */
  update(dt, trigger, eye, dir) {
    this.holsterBlend += ((this.holstered ? 1 : 0) - this.holsterBlend) * Math.min(1, dt * 7);
    this.aimBlend += ((this.aiming && !this.holstered ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 11);

    // Recoil settles back on a spring.
    const target = 0;
    this.recoilVel += (target - this.recoilPitch) * 62 * dt;
    this.recoilVel *= Math.max(0, 1 - 9 * dt);
    this.recoilPitch += this.recoilVel * dt;
    this.recoilYaw += (0 - this.recoilYaw) * Math.min(1, dt * 7);
    this.kick += (0 - this.kick) * Math.min(1, dt * 9);

    const base = this.aiming ? SPEC.spreadAim : SPEC.spreadHip;
    this.spread += (base - this.spread) * Math.min(1, dt / SPEC.spreadRecover);

    if (this.cooldown > 0) this.cooldown -= dt;

    if (this.state === STATE.RELOADING) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        const want = SPEC.magazine - this.ammo;
        const take = Math.min(want, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.state = STATE.READY;
        if (this.onReloadEnd) this.onReloadEnd();
      }
      return;
    }

    if (this.holstered) return;

    if (trigger && this.cooldown <= 0) {
      if (this.ammo > 0) this.fire(eye, dir);
      else {
        this.cooldown = 0.32;
        if (this.onDryFire) this.onDryFire();
        this.startReload();
      }
    }
  }

  fire(eye, dir) {
    this.ammo--;
    this.cooldown = SPEC.fireInterval;
    this.shotsFired++;

    // Spread is a small random cone around the look direction.
    const s = this.spread;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * s;
    // Build a basis around dir to offset within.
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
    dx /= dl; dy /= dl; dz /= dl;

    // World first, so a drone behind a wall cannot be hit through it.
    const wallHit = this.world.raycast(eye.x, eye.y, eye.z, dx, dy, dz, SPEC.range);
    const wallT = wallHit ? wallHit.t : SPEC.range;
    const droneHit = this.drones.raycast(eye.x, eye.y, eye.z, dx, dy, dz, wallT);

    let end, killed = false, drone = null, core = false, surface = 'air';
    if (droneHit) {
      drone = droneHit.drone;
      core = droneHit.core;
      const dmg = SPEC.damage * (core ? SPEC.coreMultiplier : 1);
      killed = this.drones.damage(drone, dmg);
      this.hits++;
      end = {
        x: eye.x + dx * droneHit.t,
        y: eye.y + dy * droneHit.t,
        z: eye.z + dz * droneHit.t,
        nx: -dx, ny: -dy, nz: -dz,
      };
      surface = 'drone';
    } else if (wallHit) {
      end = { x: wallHit.x, y: wallHit.y, z: wallHit.z, nx: wallHit.nx, ny: wallHit.ny, nz: wallHit.nz };
      surface = wallHit.kind;
    } else {
      end = {
        x: eye.x + dx * SPEC.range,
        y: eye.y + dy * SPEC.range,
        z: eye.z + dz * SPEC.range,
        nx: -dx, ny: -dy, nz: -dz,
      };
    }

    // Climb the spread cone and kick the view.
    this.spread = Math.min(SPEC.spreadMax, this.spread + SPEC.spreadPerShot);
    const aimScale = 1 - this.aimBlend * 0.4;
    this.recoilVel += SPEC.recoilKick * 60 * aimScale;
    this.recoilYaw += (Math.random() - 0.5) * SPEC.recoilSide * aimScale;
    this.kick = 1;

    if (this.onFire) {
      this.onFire({
        from: { x: eye.x, y: eye.y, z: eye.z },
        dir: { x: dx, y: dy, z: dz },
        end, drone, core, killed, surface,
      });
    }
    if (this.ammo === 0) this.startReload();
  }
}
