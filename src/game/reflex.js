// Super reflexes: the world slows down and you do not.
//
// The trick is that only the simulation is scaled. Looking around, the weapon
// and the interface all still run on the real clock, so the drones crawl and
// your aim does not, which is the whole point of the fantasy. Scaling
// everything would just be a slower game.
//
// A high jump comes out of the same meter, because both are the same idea: for
// a few seconds you are quicker than the city is.

export const REFLEX = {
  capacity: 5.0,        // seconds of slow motion on a full meter
  scale: 0.32,          // how slow the world gets
  ease: 0.14,           // seconds to blend in and out, so it is not a jolt
  refill: 0.34,         // meter per second once you are out of it
  refillDelay: 1.2,     // quiet before it starts coming back
  minToStart: 0.9,      // do not let it be switched on for a tenth of a second
  leapCost: 1.1,        // what a high jump takes out of the meter
  leapBoost: 1.75,      // and what it does to the jump
};

export class Reflex {
  constructor(rules = {}) {
    this.capacity = rules.capacity || REFLEX.capacity;
    this.meter = this.capacity;
    this.active = false;
    this.blend = 0;          // 0 real time, 1 fully slowed
    this.sinceUse = 99;
    this.drainScale = 1;     // the difficulty decides how dear it is
    this.onStart = null;
    this.onStop = null;
    this.onEmpty = null;
  }

  reset() {
    this.meter = this.capacity;
    this.active = false;
    this.blend = 0;
    this.sinceUse = 99;
  }

  get fraction() { return this.capacity ? this.meter / this.capacity : 0; }
  get ready() { return this.meter >= REFLEX.minToStart; }

  /** @returns {boolean} whether it is on now */
  toggle() {
    if (this.active) { this.stop(); return false; }
    return this.start();
  }

  start() {
    if (this.active || !this.ready) return false;
    this.active = true;
    this.sinceUse = 0;
    if (this.onStart) this.onStart();
    return true;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.sinceUse = 0;
    if (this.onStop) this.onStop();
  }

  /** Spends a slice of the meter for a jump. @returns {number} the boost */
  leap() {
    if (this.meter < REFLEX.leapCost) return 1;
    this.meter -= REFLEX.leapCost;
    this.sinceUse = 0;
    return REFLEX.leapBoost;
  }

  /**
   * Runs on the real clock, before the simulation, and returns what to multiply
   * the simulation step by.
   * @param {number} realDt seconds of wall clock
   */
  update(realDt) {
    if (this.active) {
      this.meter -= realDt * this.drainScale;
      this.sinceUse = 0;
      if (this.meter <= 0) {
        this.meter = 0;
        this.active = false;
        if (this.onEmpty) this.onEmpty();
        if (this.onStop) this.onStop();
      }
    } else {
      this.sinceUse += realDt;
      if (this.sinceUse > REFLEX.refillDelay && this.meter < this.capacity) {
        this.meter = Math.min(this.capacity, this.meter + REFLEX.refill * realDt);
      }
    }

    const target = this.active ? 1 : 0;
    const k = Math.min(1, realDt / REFLEX.ease);
    this.blend += (target - this.blend) * k;
    if (this.blend < 0.001) this.blend = 0;
    return this.timeScale;
  }

  /** 1 at normal speed, REFLEX.scale when fully in it. */
  get timeScale() { return 1 + (REFLEX.scale - 1) * this.blend; }
}
