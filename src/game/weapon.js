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

import { WEAPONS, LOADOUT, KIND, KITS, ARROW_DRAWS, BUCKETS, BUCKET_KEYS, weaponBySlot } from './arsenal.js';
import { THROW } from './throwarc.js';

const STATE = { READY: 0, FIRING: 1, RELOADING: 2, HOLSTERED: 3 };
export const WEAPON_STATE = STATE;
export { WEAPONS, LOADOUT, KIND, KITS, BUCKETS, BUCKET_KEYS, weaponBySlot };

// Kept so older callers and tests that import SPEC still read the rifle.
export const SPEC = WEAPONS.m16;

export class Weapon {
  constructor(world, drones, opts = {}) {
    this.world = world;
    this.drones = drones;
    // Filled in by the game layer once they exist, so the weapon can hit them.
    this.soldiers = opts.soldiers || null;
    this.jets = opts.jets || null;
    this.mechs = opts.mechs || null;
    this.projectiles = opts.projectiles || null;

    // Which head is on the next arrow, as an index into the bow's heads.
    this.arrowHead = 0;
    this.onArrowHead = null;     // fn(head) when it changes
    // And how hard it is drawn, as an index into the bow's draws.
    this.drawWeight = 0;
    this.onDraw = null;          // fn(draw) when it changes
    this.carried = {};
    for (const id of LOADOUT) {
      this.carried[id] = { ammo: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve };
    }
    this.id = 'm16';
    // A mode's own kit, or null for the ordinary number row.
    this.kit = null;
    // The weapon last picked out of each group of the number row.
    this.lastInBucket = {};
    this.onBucket = null;        // fn(key, id) when a number key picks
    // How far a rotary cannon has spun up, 0 to 1.
    this.spin = 0;
    // The cheat that lets the wheel reach every weapon whatever the mode.
    this.everyWeapon = false;

    this.state = STATE.READY;
    this.cooldown = 0;
    this.reloadLeft = 0;
    this.quickCooldown = 0;
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
    // fn(eye, dir, dt, spec) while the flamethrower is pouring, and when it
    // stops; fn(eye, dir, spec) when the second trigger throws a wall.
    this.onStream = null;
    this.onStreamEnd = null;
    this.onWall = null;
    this.streaming = false;
    this.onDryFire = null;
    this.onMelee = null;     // fn(spec, eye, dir) a swing or a cut
    this.onReloadStart = null;
    this.onReloadEnd = null;
    // Set by the game layer from whatever you have picked up.
    this.damageScale = 1;
    this.rateScale = 1;
    this.reloadScale = 1;
    // From the cheat menu. The magazine still counts down on the interface so
    // you can see the rate of fire, it just never reaches the bottom.
    this.infiniteAmmo = false;
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

  /**
   * An ammunition crate. It fills the magazine and the reserve of what you are
   * holding, and tops the rest of the loadout up by a smaller share, so a crate
   * is worth taking whatever is in your hands but is not a full resupply of
   * everything you own.
   *
   * @param {number} held 0 to 1, the share of the held weapon's reserve to add
   * @param {number} others 0 to 1, the same for everything else
   * @returns {number} how many rounds it actually gave you
   */
  resupply(held = 1, others = 0.25) {
    let given = 0;
    for (const id of LOADOUT) {
      const spec = WEAPONS[id];
      const slot = this.carried[id];
      const share = id === this.id ? held : others;
      const want = Math.max(1, Math.round(spec.reserve * share));
      const before = slot.reserve + slot.ammo;
      slot.reserve = Math.min(spec.reserve, slot.reserve + want);
      if (id === this.id && this.state !== STATE.RELOADING) {
        // Top the magazine straight up, so a crate you run over mid fight is
        // felt at once rather than after a reload.
        const room = Math.min(spec.magazine - slot.ammo, slot.reserve);
        slot.ammo += room;
        slot.reserve -= room;
      }
      given += (slot.reserve + slot.ammo) - before;
    }
    return given;
  }

  reset() {
    for (const id of LOADOUT) {
      this.carried[id] = { ammo: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve };
    }
    this.id = 'm16';
    this.state = STATE.READY;
    this.cooldown = 0;
    this.reloadLeft = 0;
    this.quickCooldown = 0;
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
    this.blastHeld = 0;
    this.blastReady = false;
  }

  /** How far a blast plasma charge has got, 0 to 1, or null on a gun without one. */
  get blastCharge() {
    const b = this.spec.blast;
    if (!b) return null;
    return this.blastReady ? 1 : Math.min(1, this.blastHeld / b.hold);
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
    // A charge belongs to the gun it was built up in.
    this.blastHeld = 0;
    this.blastReady = false;
    this.spin = 0;
    if (this.onSwap) this.onSwap(id, this.spec);
    return true;
  }

  /**
   * A number key. In a mode with a kit it is one weapon a key. Otherwise the
   * key is a group: from outside it you get the one of the group you last
   * held (the first, the first time), and from inside it the next one.
   */
  selectSlot(slot) {
    if (this.kit) {
      const id = this.kit[(slot + 9) % 10];
      return id ? this.select(id) : false;
    }
    const bucket = BUCKETS[slot];
    if (!bucket) return false;
    const ids = bucket.ids;
    const at = ids.indexOf(this.id);
    let id;
    if (at >= 0) id = ids[(at + 1) % ids.length];
    else id = this.lastInBucket[slot] && ids.includes(this.lastInBucket[slot]) ? this.lastInBucket[slot] : ids[0];
    this.lastInBucket[slot] = id;
    if (this.onBucket) this.onBucket(slot, id);
    return this.select(id);
  }

  /** Give the number row a mode's kit, or null for the ordinary one. */
  setKit(name) {
    this.kit = name && KITS[name] ? KITS[name] : null;
    if (this.kit && !this.kit.includes(this.id)) this.select(this.kit[0]);
  }

  setHolstered(on) {
    this.holstered = on;
    if (on && this.state === STATE.RELOADING) {
      this.state = STATE.READY;
      this.reloadLeft = 0;
    }
  }

  /** The head on the next arrow, or null for anything but a bow. */
  get head() {
    const heads = this.spec.heads;
    return heads ? heads[this.arrowHead % heads.length] : null;
  }

  /** How hard the bow is drawn, or null for anything else. */
  get draw() {
    const draws = this.spec.draws;
    return draws ? draws[this.drawWeight % draws.length] : null;
  }

  /** The next draw weight along, for a bow. @returns {string|null} */
  cycleDraw() {
    const draws = this.spec.draws;
    if (!draws || this.holstered) return null;
    this.drawWeight = (this.drawWeight + 1) % draws.length;
    if (this.onDraw) this.onDraw(draws[this.drawWeight]);
    return draws[this.drawWeight];
  }

  /** The next head along, for a bow. @returns {string|null} */
  cycleHead() {
    const heads = this.spec.heads;
    if (!heads || this.holstered) return null;
    this.arrowHead = (this.arrowHead + 1) % heads.length;
    if (this.onArrowHead) this.onArrowHead(heads[this.arrowHead]);
    return heads[this.arrowHead];
  }

  startReload() {
    if (this.state === STATE.RELOADING || this.holstered) return false;
    const spec = this.spec;
    if (this.ammo >= spec.magazine || this.reserve <= 0) return false;
    this.state = STATE.RELOADING;
    this.reloadLeft = spec.reloadTime * this.reloadScale;
    if (this.onReloadStart) this.onReloadStart(spec.reloadTime * this.reloadScale);
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

    // Blast plasma builds while the second trigger is held, and is gone if it
    // is let go before it is full. Once it is full it waits for the shot.
    if (spec.blast && !this.blastReady) {
      if (this.aiming && !this.holstered) {
        this.blastHeld += dt;
        if (this.blastHeld >= spec.blast.hold) {
          this.blastReady = true;
          if (this.onBlastReady) this.onBlastReady();
        }
      } else {
        this.blastHeld = 0;
      }
    }

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
    if (this.quickCooldown > 0) this.quickCooldown -= dt;

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

    if (this.holstered) {
      this.streaming = false;
      this.triggerWasDown = trigger;
      return;
    }

    // Something that pours rather than fires: the trigger is a tap, not a
    // pull, and what it costs is fuel a second rather than a round a shot.
    if (spec.kind === KIND.STREAM) {
      this._stream(dt, trigger, spec, eye, dir);
      this.triggerWasDown = trigger;
      return;
    }

    // A semi automatic needs the trigger released between shots. Holding it
    // down on a shotgun should not empty the tube.
    let pulled = spec.auto ? trigger : (trigger && !this.triggerWasDown);
    // Six barrels have to come up to speed before the first round, and wind
    // down at half the rate when you let go.
    if (spec.spinUp) {
      this.spin = Math.max(0, Math.min(1, (this.spin || 0) + (trigger ? dt : -dt * 0.5) / spec.spinUp));
      if (this.spin < 1) pulled = false;
    }
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

  /**
   * The flamethrower, while the trigger is down. Fuel drains on the clock and
   * the game layer is handed the cone to do something with: this class knows
   * what it costs and the game layer knows what it burns.
   */
  _stream(dt, trigger, spec, eye, dir) {
    const was = this.streaming;
    const can = this.ammo > 0 || this.infiniteAmmo;
    this.streaming = !!(trigger && can);
    if (this.streaming) {
      if (!this.infiniteAmmo) {
        this.ammo = Math.max(0, this.ammo - spec.stream.fuelPerSecond * dt);
      }
      this.shotsFired += dt;
      // A small shove, so the thing feels like it is pushing back.
      this.recoilVel += spec.recoilKick * 14 * dt * 60;
      this.kick = Math.min(1, this.kick + dt * 2.2);
      if (this.onStream) this.onStream(eye, dir, dt, spec);
    }
    if (was && !this.streaming && this.onStreamEnd) this.onStreamEnd();
    if (trigger && !can) {
      if (this.reserve > 0) this.startReload();
      else if (this.cooldown <= 0) {
        this.cooldown = 0.5;
        if (this.onDryFire) this.onDryFire();
      }
    }
  }

  /**
   * The second trigger. Only the flamethrower has one: it throws a wall of
   * fire that leaves you and runs away across the ground.
   *
   * @returns {boolean} whether anything was thrown
   */
  altFire(eye, dir) {
    const spec = this.spec;
    if (this.holstered || this.state === STATE.RELOADING) return false;
    if (!spec.wall || !spec.wall.fuel || !this.onWall) return false;
    if (this.cooldown > 0) return false;
    const cost = spec.wall.fuel;
    if (!this.infiniteAmmo && this.ammo < cost) {
      if (this.onDryFire) this.onDryFire();
      this.cooldown = 0.4;
      return false;
    }
    if (!this.infiniteAmmo) this.ammo -= cost;
    this.cooldown = 1.1;
    this.recoilVel += spec.recoilKick * 40;
    this.kick = 1;
    this.onWall(eye, dir, spec);
    return true;
  }

  /** Where in the loadout list this weapon is, for cycling with the wheel. */
  cycle(step) {
    // The wheel goes through a mode's kit when it has one.
    const list = this.everyWeapon ? LOADOUT : (this.kit || LOADOUT);
    const at = Math.max(0, list.indexOf(this.id));
    const next = list[(at + step + list.length * 2) % list.length];
    return this.select(next);
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
    if (this.mechs) {
      const h = this.mechs.raycast(ox, oy, oz, dx, dy, dz, maxT);
      take(h, 'mech', h && h.mech);
    }
    return best;
  }

  /** Applies a hit to whatever kind of thing it was. */
  _damage(hit, amount, dir) {
    if (hit.kind === 'soldier') return this.soldiers.damage(hit.target, amount, dir);
    if (hit.kind === 'jet') return this.jets.damage(hit.target, amount);
    if (hit.kind === 'mech') return this.mechs.damage(hit.target, amount, hit.core);
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
    // Something swung or run: no round, no trace. The game layer finds what
    // was in reach, and a saw's fuel is spent there, on what it cut.
    if (spec.kind === KIND.MELEE) {
      this.cooldown = spec.fireInterval * this.rateScale;
      this.kick = 1;
      this.shotsFired++;
      if (this.onMelee) this.onMelee(spec, eye, dir);
      return;
    }
    // Never below empty. The trigger upstairs will not let a shot through
    // without a round behind it, but the checks fire this directly, and a
    // magazine that reads minus one on the screen is a bug wherever it came
    // from.
    if (!this.infiniteAmmo) this.ammo = Math.max(0, this.ammo - 1);
    const drawn = this.draw ? ARROW_DRAWS[this.draw] : null;
    this.cooldown = spec.fireInterval * this.rateScale * (drawn ? drawn.interval : 1);
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

    if (!this.infiniteAmmo && this.ammo === 0 && this.reserve > 0) this.startReload();
  }

  /** Every magazine and every reserve, full. The cheat menu's first button. */
  giveAll() {
    let given = 0;
    for (const id of LOADOUT) {
      const spec = WEAPONS[id];
      const slot = this.carried[id];
      given += (spec.magazine - slot.ammo) + (spec.reserve - slot.reserve);
      slot.ammo = spec.magazine;
      slot.reserve = spec.reserve;
    }
    // Whatever was mid reload is now loaded.
    if (this.state === STATE.RELOADING) { this.state = STATE.READY; this.reloadLeft = 0; }
    return given;
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
      const dmg = spec.damage * (near.core ? spec.coreMultiplier : 1) * this.damageScale;
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
        shot.killed = this._damage(shot, spec.damage * mult * this.damageScale, dir);
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
    // And a mech, which is the one thing worth locking a rocket onto and was
    // the one thing the lock could not see.
    if (this.mechs) for (const m of this.mechs.active) {
      if (m.alive && m.health > 0 && !m.mine) {
        consider(m, m.x, m.y + m.spec.height * 0.6, m.z);
      }
    }
    return best;
  }

  _fireProjectile(eye, dir, spec) {
    if (!this.projectiles) return;
    // Flak throws a handful at once, each on its own line. A swarm's rockets
    // all go after what the sight is on.
    const count = spec.shards || 1;
    const swarm = spec.homing && count > 1
      ? { homing: spec.homing, target: this._aimedTarget(eye, dir, 0.22, spec.homing.range) } : null;
    for (let i = 1; i < count; i++) {
      const sd = this._spray(dir, this.spread * 1.35);
      this.projectiles.launch(spec.projectile, {
        x: eye.x + sd.x * 0.6, y: eye.y + sd.y * 0.6 - 0.12, z: eye.z + sd.z * 0.6,
        vx: sd.x * spec.muzzleSpeed * (0.8 + Math.random() * 0.4),
        vy: sd.y * spec.muzzleSpeed * (0.8 + Math.random() * 0.4) + 1.2,
        vz: sd.z * spec.muzzleSpeed * (0.8 + Math.random() * 0.4),
        fuse: spec.fuse, splash: this._scaledSplash(spec.splash), weapon: this.id,
        homing: swarm ? swarm.homing : null, target: swarm ? swarm.target : null,
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
    // A full blast plasma charge goes out as one hard orange bolt instead.
    const blast = spec.blast && this.blastReady ? spec.blast : null;
    if (blast) {
      this.blastReady = false;
      this.blastHeld = 0;
    }
    const drawn = this.draw ? ARROW_DRAWS[this.draw] : null;
    const speed = (blast ? blast.speed : spec.muzzleSpeed) * (drawn ? drawn.speed : 1)
      * (spec.kind === KIND.THROW ? this.throwScale : 1);
    const splash = blast ? {
      ...spec.splash,
      radius: spec.splash.radius * blast.radius,
      damage: spec.splash.damage * blast.damage,
      force: spec.splash.force * blast.force,
    } : spec.splash;
    const launched = this.projectiles.launch(blast ? blast.projectile : spec.projectile, {
      x: eye.x + d.x * 0.6, y: eye.y + d.y * 0.6 - 0.12, z: eye.z + d.z * 0.6,
      vx: d.x * speed,
      vy: d.y * speed + (spec.kind === KIND.THROW ? 3.4 : 0),
      vz: d.z * speed,
      fuse: spec.fuse,
      splash: this._scaledSplash(splash),
      slip: spec.slip,
      weapon: this.id,
      homing, target,
      head: this.head,
      draw: this.draw,
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

  /** A blast carries the quad too, but its radius does not grow. */
  _scaledSplash(splash) {
    if (!splash) return splash;
    if (this.damageScale === 1) return splash;
    return { ...splash, damage: splash.damage * this.damageScale };
  }

  /**
   * A grenade off the belt, whatever is in your hands: the suit's quick
   * throw. It comes out of the grenades you carry, magazine first, and it
   * goes the way you are looking with the same lob the grenade itself has.
   *
   * @returns {object|null} the grenade in the air, or null with none left
   */
  /** How hard a throw goes: harder with the right button held. */
  get throwScale() { return this.aiming && !this.holstered ? THROW.far : 1; }

  /** How fast what is in your hands leaves them, if it is thrown. */
  throwSpeed() {
    return this.spec.kind === KIND.THROW ? this.spec.muzzleSpeed * this.throwScale : 0;
  }

  quickGrenade(eye, dir, far = false) {
    if (!this.projectiles || this.quickCooldown > 0) return null;
    const slot = this.carried.grenade;
    if (!slot) return null;
    if (!this.infiniteAmmo) {
      if (slot.ammo > 0) slot.ammo--;
      else if (slot.reserve > 0) slot.reserve--;
      else return null;
    }
    const spec = WEAPONS.grenade;
    this.quickCooldown = 0.7;
    const speed = spec.muzzleSpeed * (far ? THROW.far : 1);
    return this.projectiles.launch(spec.projectile, {
      x: eye.x + dir.x * 0.6, y: eye.y + dir.y * 0.6 - 0.12, z: eye.z + dir.z * 0.6,
      vx: dir.x * speed,
      vy: dir.y * speed + THROW.lift,
      vz: dir.z * speed,
      fuse: spec.fuse,
      splash: this._scaledSplash(spec.splash),
      weapon: 'grenade',
    });
  }

  /** How many grenades there are to throw, the magazine and the reserve. */
  get grenadesLeft() {
    const slot = this.carried.grenade;
    return slot ? slot.ammo + slot.reserve : 0;
  }

  /** Blow every piece of C4 you have put down. */
  detonate() {
    if (!this.projectiles) return 0;
    // The rubber duck goes off on the same trigger as the C4.
    return this.projectiles.detonateAll('c4') + this.projectiles.detonateAll('duck');
  }
}
