// Character controller. A vertical capsule swept against the 2D collision
// segments, with sliding, step up over kerbs, gravity and jumping. No library.

import { PLAYER, SURFACE } from '../shared/constants.js';

const SUBSTEPS = 4;
const SKIN = 0.02;

export class CharacterController {
  constructor(world) {
    this.world = world;
    this.x = 0; this.y = 0; this.z = 0;
    this.vy = 0;
    this.onGround = false;
    this.radius = PLAYER.radius;
    this.height = PLAYER.height;
    this.stepUp = PLAYER.stepUp;
    this.groundY = 0;
    this.surface = SURFACE.ASPHALT;
    this.distanceWalked = 0;
    this.noclip = false;
    this._segBuf = new Float32Array(4096 * 6);
    this._segCount = 0;
  }

  teleport(x, z, y = null) {
    this.x = x; this.z = z;
    this.groundY = this.world.groundHeight(x, z);
    this.y = y === null ? this.groundY : y;
    this.vy = 0;
  }

  /** Gather the segments that could matter this step, once per step. */
  gather(minX, minZ, maxX, maxZ) {
    const buf = this._segBuf;
    let n = 0;
    const lo = this.y - 0.4, hi = this.y + this.height;
    this.world.forEachSegmentTile(minX, minZ, maxX, maxZ, (segs, count) => {
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        const base = segs[o + 4], top = segs[o + 5];
        if (top < lo || base > hi) continue;                 // above or below us
        const sx1 = segs[o], sz1 = segs[o + 1], sx2 = segs[o + 2], sz2 = segs[o + 3];
        if (Math.min(sx1, sx2) > maxX || Math.max(sx1, sx2) < minX) continue;
        if (Math.min(sz1, sz2) > maxZ || Math.max(sz1, sz2) < minZ) continue;
        if (n * 6 + 6 > buf.length) break;
        buf[n * 6] = sx1; buf[n * 6 + 1] = sz1;
        buf[n * 6 + 2] = sx2; buf[n * 6 + 3] = sz2;
        buf[n * 6 + 4] = base; buf[n * 6 + 5] = top;
        n++;
      }
    });
    this._segCount = n;
  }

  /**
   * Push the capsule out of every segment it overlaps, then repeat, which is a
   * cheap and very stable substitute for a true swept solve at walking speed.
   * Returns true when something was hit.
   */
  resolve() {
    const buf = this._segBuf;
    const r = this.radius;
    let hit = false;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let i = 0; i < this._segCount; i++) {
        const o = i * 6;
        const base = buf[o + 4], top = buf[o + 5];
        // A low obstacle we are standing on top of is not a wall.
        if (top <= this.y + this.stepUp + 0.001) continue;
        if (base >= this.y + this.height) continue;
        const ax = buf[o], az = buf[o + 1], bx = buf[o + 2], bz = buf[o + 3];
        const ex = bx - ax, ez = bz - az;
        const ee = ex * ex + ez * ez;
        if (ee < 1e-9) continue;
        let t = ((this.x - ax) * ex + (this.z - az) * ez) / ee;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + ex * t, pz = az + ez * t;
        let dx = this.x - px, dz = this.z - pz;
        let d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d < 1e-6) {
          // Dead on the segment: push along its normal.
          dx = -ez; dz = ex;
          d = Math.hypot(dx, dz) || 1;
        }
        const push = (r - d) + SKIN;
        this.x += (dx / d) * push;
        this.z += (dz / d) * push;
        moved = true;
        hit = true;
      }
      if (!moved) break;
    }
    return hit;
  }

  /** The highest solid top under the capsule, for kerbs, steps and stelae. */
  supportHeight() {
    const buf = this._segBuf;
    const r = this.radius;
    let best = this.world.groundHeight(this.x, this.z);
    const ceiling = this.y + this.stepUp + 0.001;
    for (let i = 0; i < this._segCount; i++) {
      const o = i * 6;
      const top = buf[o + 5];
      if (top <= best || top > ceiling) continue;
      const ax = buf[o], az = buf[o + 1], bx = buf[o + 2], bz = buf[o + 3];
      const ex = bx - ax, ez = bz - az;
      const ee = ex * ex + ez * ez;
      if (ee < 1e-9) continue;
      let t = ((this.x - ax) * ex + (this.z - az) * ez) / ee;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = this.x - (ax + ex * t), dz = this.z - (az + ez * t);
      if (dx * dx + dz * dz <= r * r) best = top;
    }
    return best;
  }

  /**
   * One fixed simulation step.
   * @param {number} dt seconds
   * @param {number} wishX desired horizontal velocity, metres per second
   * @param {number} wishZ
   * @param {boolean} jump
   * @param {number} jumpBoost multiplier on the jump, for the reflex leap
   */
  step(dt, wishX, wishZ, jump, jumpBoost = 1) {
    const startX = this.x, startZ = this.z;

    if (this.noclip) {
      this.x += wishX * dt * 4;
      this.z += wishZ * dt * 4;
      this.y += this.vy * dt;
      return;
    }

    // One gather per step covers the whole sweep plus a margin.
    const reach = Math.hypot(wishX, wishZ) * dt + this.radius + 1.0;
    this.gather(this.x - reach, this.z - reach, this.x + reach, this.z + reach);

    // Horizontal move in substeps so nothing is tunnelled through at a run.
    const stepX = (wishX * dt) / SUBSTEPS;
    const stepZ = (wishZ * dt) / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      this.x += stepX;
      this.z += stepZ;
      this.resolve();
    }

    // Vertical.
    this.vy -= PLAYER.gravity * dt;
    this.y += this.vy * dt;

    const support = this.supportHeight();
    this.groundY = support;
    if (this.y <= support + 0.001) {
      this.y = support;
      if (this.vy < 0) this.vy = 0;
      this.onGround = true;
    } else if (this.y - support < this.stepUp && this.vy <= 0) {
      // Walking up a kerb: snap rather than fall off and re-land.
      this.y = support;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    if (jump && this.onGround) {
      this.vy = PLAYER.jumpSpeed * jumpBoost;
      this.onGround = false;
    }

    // Keep the player inside the box.
    const m = this.world;
    const pad = 2;
    if (this.x < m.minX + pad) this.x = m.minX + pad;
    if (this.x > m.maxX - pad) this.x = m.maxX - pad;
    if (this.z < m.minZ + pad) this.z = m.minZ + pad;
    if (this.z > m.maxZ - pad) this.z = m.maxZ - pad;

    this.distanceWalked += Math.hypot(this.x - startX, this.z - startZ);
    this.surface = this.world.surfaceAt(this.x, this.z);
  }
}
