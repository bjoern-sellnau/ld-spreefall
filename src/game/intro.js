// The opening drone shot: a slow arc above Pariser Platz that drifts towards the
// Gate and settles at eye height when the player presses to walk.

import { clamp, smoothstep } from '../engine/math.js';

export class Intro {
  constructor(spawnX, spawnZ, groundY) {
    this.x0 = spawnX;
    this.z0 = spawnZ;
    this.groundY = groundY;
    this.t = 0;
    this.done = false;
    this.landing = false;
    this.landT = 0;
    this.startedAt = 0;
    this.landStartedAt = 0;
  }

  /**
   * The camera move is timed off the wall clock rather than off the frame
   * delta. Frame deltas are clamped so that a stall cannot blow up the physics,
   * and a cinematic that stretches to six seconds because the machine is slow
   * looks broken.
   * @returns {{x,y,z,yaw,pitch}}
   */
  sample(nowSeconds) {
    if (!this.startedAt) this.startedAt = nowSeconds;
    this.t = nowSeconds - this.startedAt;
    const t = this.t;
    // A 70 m radius arc, slowly descending from 130 m to 62 m, swinging round
    // to end up looking west at the Gate.
    const ang = -0.55 + t * 0.045;
    const radius = 96 - t * 1.4;
    const height = 132 - t * 2.4;
    const x = this.x0 + Math.sin(ang) * radius * 0.7 + 40;
    const z = this.z0 + Math.cos(ang) * radius;
    const y = this.groundY + Math.max(38, height);
    // Always looking at the Gate, which is 110 m west of the spawn.
    const tx = this.x0 - 118, tz = this.z0 - 4;
    const yaw = Math.atan2(-(tx - x), -(tz - z));
    const pitch = Math.atan2(-(y - this.groundY - 18), Math.hypot(tx - x, tz - z));
    return { x, y, z, yaw, pitch };
  }

  /** Blend from the drone pose to the player pose over 1.7 seconds. */
  land(nowSeconds, from, to) {
    if (!this.landStartedAt) this.landStartedAt = nowSeconds;
    this.landT = nowSeconds - this.landStartedAt;
    const k = smoothstep(0, 1, clamp(this.landT / 1.7, 0, 1));
    const lerpAngle = (a, b, f) => {
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return a + d * f;
    };
    return {
      x: from.x + (to.x - from.x) * k,
      y: from.y + (to.y - from.y) * k,
      z: from.z + (to.z - from.z) * k,
      yaw: lerpAngle(from.yaw, to.yaw, k),
      pitch: from.pitch + (to.pitch - from.pitch) * k,
      finished: k >= 1,
    };
  }
}
