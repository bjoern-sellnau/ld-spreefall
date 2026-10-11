// The camera when a warhead is on its way: it leaves you, pulls back, follows
// the thing down, and then circles what is left of the place it landed until
// you press something.
//
// Three phases and no editing. The hard part of a shot like this is not the
// path, it is knowing where to point: a bomb falling from four hundred metres
// is a small object a long way off, and a camera that chases it from behind
// shows an empty sky. So the camera takes a station beside the fall line and
// looks at the bomb from there, which keeps the city in frame the whole way
// down and means the impact happens in the middle of something rather than at
// the bottom of nothing.
//
// Like the opening shot and free travel, it runs off the wall clock. A
// cinematic that stretches because the machine is busy is a bug.

import { clamp, smoothstep } from '../engine/math.js';

export const CINEMA = {
  pull: 1.1,            // seconds to leave the player and take the station
  // Where the station is, relative to the fall line: out to one side, and
  // part of the way up it.
  standOff: 150,
  standUp: 0.45,
  // The orbit after it goes off.
  orbitRadius: 320,
  orbitHeight: 170,
  orbitSpeed: 0.17,     // radians a second
  orbitRise: 14,        // metres a second, so it pulls away as it goes round
  // How far the world is slowed. A bomb takes three seconds to fall; held at
  // a fifth of speed for all of it that is fifteen seconds of watching an
  // object get smaller, so the shot starts near real time and eases down as
  // it comes in. The slow part is the part worth slowing.
  fast: 0.85,
  slow: 0.18,
  slowFrom: 0.45,       // how far down the fall the easing starts
  // And for how long after the detonation, before the world comes back up to
  // speed under the orbit.
  slowAfter: 4.5,
};

function lerpAngle(a, b, f) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

/** Where a camera at a has to look to see b. */
function lookAt(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const flat = Math.hypot(dx, dz) || 0.001;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, flat) };
}

export class Cinema {
  constructor() {
    this.active = false;
    this.phase = 'off';
    this.body = null;
    this.impact = null;
  }

  /**
   * @param {object} from the eye, now
   * @param {object} body the warhead on its way down, which this will follow
   * @param {object} target where it is aimed, as x and z and the ground there
   */
  start(from, body, target) {
    this.active = true;
    this.phase = 'pull';
    this.body = body;
    this.target = { ...target };
    this.impact = null;
    this.start0 = body ? body.y : null;
    this.startedAt = 0;
    this.wentOffAt = 0;
    this.from = { ...from };

    // The station: out to one side of the fall line, by an amount that keeps
    // the ground under the bomb in shot, and part of the way up it.
    const toward = Math.atan2(target.x - from.x, target.z - from.z);
    const side = toward + Math.PI / 2;
    this.station = {
      x: target.x + Math.sin(side) * CINEMA.standOff,
      z: target.z + Math.cos(side) * CINEMA.standOff,
      y: target.y + (body ? (body.y - target.y) * CINEMA.standUp : 160),
    };
    // Which way round the orbit goes, so it carries on turning the way the
    // camera was already moving rather than reversing at the detonation.
    this.orbitFrom = Math.atan2(this.station.x - target.x, this.station.z - target.z);
    return this;
  }

  /** Called by the game layer the moment the warhead goes off. */
  detonated(x, y, z) {
    if (!this.active) return;
    this.impact = { x, y, z };
    this.phase = 'orbit';
    this.wentOffAt = 0;
  }

  stop() {
    this.active = false;
    this.phase = 'off';
    this.body = null;
  }

  /** How far down the fall line the warhead has got, 0 to 1. */
  get fallen() {
    if (!this.body || !this.body.alive) return 1;
    const top = this.start0 || (this.start0 = this.body.y);
    const span = Math.max(1, top - this.target.y);
    return clamp((top - this.body.y) / span, 0, 1);
  }

  /** How much of real time the world gets while this is running. */
  timeScale(nowSeconds) {
    if (!this.active) return 1;
    if (this.phase !== 'orbit') {
      return CINEMA.fast + (CINEMA.slow - CINEMA.fast)
        * smoothstep(CINEMA.slowFrom, 1, this.fallen);
    }
    const since = this.wentOffAt ? nowSeconds - this.wentOffAt : 0;
    // The world comes back up to speed under the orbit rather than snapping.
    return CINEMA.slow + (1 - CINEMA.slow) * smoothstep(0, 1, clamp(since / CINEMA.slowAfter, 0, 1));
  }

  /**
   * @returns {{x,y,z,yaw,pitch,phase}} where the camera is and what it is
   *   looking at, or null when this is not running
   */
  sample(nowSeconds) {
    if (!this.active) return null;
    if (!this.startedAt) this.startedAt = nowSeconds;
    const t = nowSeconds - this.startedAt;

    if (this.phase === 'orbit') {
      if (!this.wentOffAt) this.wentOffAt = nowSeconds;
      const since = nowSeconds - this.wentOffAt;
      const at = this.impact || this.target;
      const a = this.orbitFrom + since * CINEMA.orbitSpeed;
      const pos = {
        x: at.x + Math.sin(a) * CINEMA.orbitRadius,
        y: at.y + CINEMA.orbitHeight + since * CINEMA.orbitRise,
        z: at.z + Math.cos(a) * CINEMA.orbitRadius,
      };
      // Looking at the column rather than at the crater, because the column
      // is the thing that is happening.
      const look = lookAt(pos, { x: at.x, y: at.y + 90, z: at.z });
      return { ...pos, ...look, phase: 'orbit' };
    }

    // Where the warhead is. Once it is gone the station holds and the orbit
    // takes over on the next frame.
    const bomb = this.body && this.body.alive
      ? { x: this.body.x, y: this.body.y, z: this.body.z }
      : { x: this.target.x, y: this.target.y + 2, z: this.target.z };

    if (t < CINEMA.pull) {
      // Off the street and out to the station, turning onto the bomb as it
      // goes, so the handover is one move rather than a cut.
      const k = smoothstep(0, 1, clamp(t / CINEMA.pull, 0, 1));
      const pos = {
        x: this.from.x + (this.station.x - this.from.x) * k,
        y: this.from.y + (this.station.y - this.from.y) * k,
        z: this.from.z + (this.station.z - this.from.z) * k,
      };
      const look = lookAt(pos, bomb);
      return {
        ...pos,
        yaw: lerpAngle(this.from.yaw, look.yaw, k),
        pitch: this.from.pitch + (look.pitch - this.from.pitch) * k,
        phase: 'pull',
      };
    }

    // Holding station and tracking it down. The station sinks with the bomb,
    // but more slowly, so the shot closes as it lands.
    const fall = clamp((this.station.y - bomb.y) / Math.max(1, this.station.y - this.target.y), 0, 1);
    const pos = {
      x: this.station.x + (this.target.x - this.station.x) * fall * 0.35,
      y: this.station.y - (this.station.y - (this.target.y + 60)) * fall * 0.55,
      z: this.station.z + (this.target.z - this.station.z) * fall * 0.35,
    };
    return { ...pos, ...lookAt(pos, bomb), phase: 'chase' };
  }
}
