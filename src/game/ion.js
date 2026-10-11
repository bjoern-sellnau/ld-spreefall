// The ion cannon.
//
// Three beams come down in a ring around the target and walk round it,
// speeding up as they go. Anything they pass over burns, and what is left of
// a person when they have finished is a blackened skeleton. Then the beams
// meet in the middle and the whole circle goes up at once.
//
// None of this is a weapon you carry. It is fired from the cheat menu onto a
// point picked on the map, and it is the one thing in the game whose radius
// is bigger than a warhead's.

export const ION = {
  // Where the three beams come down, and how wide each one burns.
  ring: 58,
  beamRadius: 5.0,
  beams: 3,
  // The charge: how long the ring turns before the middle fires, and how
  // fast it is turning at the start and at the end of that.
  charge: 8.0,
  spinFrom: 0.45,
  spinTo: 6.2,
  // The pause after the ring stops and before the middle opens up, which is
  // the only part of this that is pure theatre.
  hold: 0.9,
  // The main beam: how long it burns and how far it reaches.
  mainTime: 2.4,
  mainRadius: 19,
  blast: 210,
  damage: 9000,
  // How high the beams are drawn. Well above anything in the city.
  height: 600,
};

const STATE = { OFF: 0, RING: 1, HOLD: 2, MAIN: 3, DONE: 4 };
export const ION_STATE = STATE;

export class Ion {
  /**
   * @param {object} world for the ground under the beams
   * @param {(x,y,z)=>boolean} isSanctuary the memorial, which this cannot touch
   */
  constructor(world, isSanctuary) {
    this.world = world;
    this.isSanctuary = isSanctuary || (() => false);
    this.state = STATE.OFF;
    this.t = 0;
    this.angle = 0;
    this.x = 0;
    this.z = 0;
    this.y = 0;
    this.onSweep = null;     // fn(x, z, radius, dt) for whatever is under a beam
    this.onMain = null;      // fn(x, y, z) when the middle fires
    this.onCharge = null;    // fn() the moment it starts
    this.onDone = null;
  }

  get firing() { return this.state !== STATE.OFF && this.state !== STATE.DONE; }

  /** @returns {boolean} false when the target is refused */
  fire(x, z) {
    if (this.firing) return false;
    if (this.isSanctuary(x, 0, z)) return false;
    this.x = x;
    this.z = z;
    this.y = this.world.groundHeight(x, z);
    this.state = STATE.RING;
    this.t = 0;
    this.angle = 0;
    if (this.onCharge) this.onCharge();
    return true;
  }

  stop() { this.state = STATE.OFF; this.t = 0; }

  /** How fast the ring is turning right now, radians a second. */
  get spin() {
    if (this.state !== STATE.RING) return 0;
    const k = Math.min(1, this.t / ION.charge);
    // Squared, so most of the speeding up happens at the end and the last
    // second is the one that reads.
    return ION.spinFrom + (ION.spinTo - ION.spinFrom) * k * k;
  }

  /**
   * Where the beams are, for drawing and for whatever is standing under one.
   * @returns {Array<{x,z,radius,main:boolean}>}
   */
  get beams() {
    const out = [];
    if (this.state === STATE.RING || this.state === STATE.HOLD) {
      for (let i = 0; i < ION.beams; i++) {
        const a = this.angle + (i / ION.beams) * Math.PI * 2;
        out.push({
          x: this.x + Math.cos(a) * ION.ring,
          z: this.z + Math.sin(a) * ION.ring,
          radius: ION.beamRadius,
          main: false,
        });
      }
    } else if (this.state === STATE.MAIN) {
      // One column, opening out over the time it burns.
      const k = Math.min(1, this.t / (ION.mainTime * 0.4));
      out.push({ x: this.x, z: this.z, radius: ION.mainRadius * (0.25 + k * 0.75), main: true });
    }
    return out;
  }

  update(dt) {
    if (!this.firing) return;
    this.t += dt;
    if (this.state === STATE.RING) {
      this.angle += this.spin * dt;
      // Whatever the beams are standing on takes it.
      if (this.onSweep) {
        for (const b of this.beams) this.onSweep(b.x, b.z, b.radius, dt);
      }
      if (this.t >= ION.charge) { this.state = STATE.HOLD; this.t = 0; }
      return;
    }
    if (this.state === STATE.HOLD) {
      if (this.t >= ION.hold) {
        this.state = STATE.MAIN;
        this.t = 0;
        if (this.onMain) this.onMain(this.x, this.y, this.z);
      }
      return;
    }
    if (this.state === STATE.MAIN) {
      if (this.onSweep) this.onSweep(this.x, this.z, ION.mainRadius, dt);
      if (this.t >= ION.mainTime) {
        this.state = STATE.DONE;
        if (this.onDone) this.onDone();
      }
    }
  }

  /** Seconds until the middle fires, for the interface. */
  get countdown() {
    if (this.state === STATE.RING) return Math.max(0, ION.charge - this.t) + ION.hold;
    if (this.state === STATE.HOLD) return Math.max(0, ION.hold - this.t);
    return 0;
  }
}
