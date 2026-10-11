// Free travel: you pick a place on the map and the camera takes you there.
//
// It is one move in three parts, and the parts are the point. A cut would be
// cheaper and would also throw away the one thing this project has, which is a
// city laid out the way the real one is. So the camera lifts off the street
// until the whole district is under it, flies across at a height where you can
// read the streets going by, and comes down on the far side. You arrive
// knowing roughly where you are, which is what a map on its own never tells
// you.
//
// Everything here runs off the wall clock rather than the simulation step, for
// the same reason the opening shot does: a flight that stretches to twelve
// seconds because the machine is busy looks broken.

import { clamp, smoothstep } from '../engine/math.js';

export const TRAVEL = {
  rise: 1.5,            // seconds going up
  fall: 2.1,            // seconds coming down
  minCruise: 1.2,
  maxCruise: 7.0,
  cruiseSpeed: 400,     // metres a second across the top
  minHeight: 150,       // above the ground at either end
  maxHeight: 440,
  // How much of the distance is converted into altitude. A short hop stays
  // low, a trip across the city goes high enough to see both ends of it.
  heightPerMetre: 0.13,
  // Negative is down in this camera. Straight down is unusable as a yaw
  // reference, so the look is held about fifteen degrees off vertical the
  // whole way across: enough to read the streets going by underneath and
  // enough to see where you are going.
  cruisePitch: -1.30,
};

/** Shortest way round the circle. */
function lerpAngle(a, b, f) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

export class Travel {
  constructor() {
    this.active = false;
    this.startedAt = 0;
    this.from = null;
    this.to = null;
  }

  /**
   * @param {object} from where the eye is now: x, y, z, yaw, pitch
   * @param {object} to where it is going: x, y, z, yaw
   * @returns {object} itself, so a caller can read the timings
   */
  start(from, to) {
    this.active = true;
    this.startedAt = 0;
    this.from = { ...from };
    this.to = { ...to, pitch: to.pitch !== undefined ? to.pitch : -0.04 };
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    this.distance = d;
    this.height = Math.max(from.y, to.y)
      + clamp(TRAVEL.minHeight + d * TRAVEL.heightPerMetre,
        TRAVEL.minHeight, TRAVEL.maxHeight);
    this.cruise = clamp(d / TRAVEL.cruiseSpeed, TRAVEL.minCruise, TRAVEL.maxCruise);
    this.total = TRAVEL.rise + this.cruise + TRAVEL.fall;
    // Which way the flight is pointing. Held through the whole move, so the
    // city does not spin round you on the way.
    this.heading = d > 1 ? Math.atan2(-(to.x - from.x), -(to.z - from.z)) : from.yaw;
    return this;
  }

  cancel() { this.active = false; }

  /**
   * @param {number} nowSeconds wall clock
   * @returns {{x,y,z,yaw,pitch,phase,finished}} phase is rise, cruise or fall
   */
  sample(nowSeconds) {
    if (!this.startedAt) this.startedAt = nowSeconds;
    const t = nowSeconds - this.startedAt;
    const from = this.from, to = this.to;

    if (t < TRAVEL.rise) {
      // Straight up off the street, turning onto the heading and tipping the
      // view down as it goes, so by the top you are looking at the map.
      const k = smoothstep(0, 1, clamp(t / TRAVEL.rise, 0, 1));
      return {
        x: from.x, z: from.z,
        y: from.y + (this.height - from.y) * k,
        yaw: lerpAngle(from.yaw, this.heading, k),
        pitch: from.pitch + (TRAVEL.cruisePitch - from.pitch) * k,
        phase: 'rise',
        finished: false,
      };
    }

    const afterRise = t - TRAVEL.rise;
    if (afterRise < this.cruise) {
      // Across. Eased at both ends rather than linear, or the stop at the far
      // side reads as the camera hitting a wall.
      const k = smoothstep(0, 1, clamp(afterRise / this.cruise, 0, 1));
      return {
        x: from.x + (to.x - from.x) * k,
        z: from.z + (to.z - from.z) * k,
        y: this.height,
        yaw: this.heading,
        pitch: TRAVEL.cruisePitch,
        phase: 'cruise',
        finished: false,
      };
    }

    const k = smoothstep(0, 1, clamp((afterRise - this.cruise) / TRAVEL.fall, 0, 1));
    return {
      x: to.x, z: to.z,
      y: this.height + (to.y - this.height) * k,
      yaw: lerpAngle(this.heading, to.yaw, k),
      pitch: TRAVEL.cruisePitch + (to.pitch - TRAVEL.cruisePitch) * k,
      phase: 'fall',
      finished: k >= 1,
    };
  }
}
