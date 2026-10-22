// The suit, for The Hunt. A mixture of the three games it comes from: the
// first one's four powers (armour, speed, strength and the cloak), the way
// the second and third made two of those modes you switch on (armour and
// cloak, Q and E) and the other two things the suit simply does when you ask
// it to (a sprint that runs on energy, a jump that goes higher held), and the
// third one's bow, which can be fired from the cloak for part of the energy
// where any gun takes all of it and puts you back in sight.
//
// Everything runs on one bar of energy. It comes back by itself after a
// moment of not being used, and anything that empties it switches off what
// was drawing on it. The numbers are ours.

export const SUIT = {
  energy: 100,
  // How long after the last thing that cost energy it starts coming back,
  // and how fast.
  regenDelay: 1.4,
  regen: 24,
  armor: {
    // A trickle while it is on, more while you move in it.
    drainStill: 1.2,
    drainMove: 3.5,
    // What of a hit the suit takes instead of you, and what each point of
    // that costs in energy.
    absorb: 0.8,
    costPerPoint: 0.55,
    // Heavier: a little slower on your feet.
    speed: 0.88,
  },
  cloak: {
    drainStill: 2.5,
    drainWalk: 7,
    drainRun: 20,
    // A gun fired from the cloak empties the suit and drops it. The bow
    // costs this much instead and leaves it up.
    bowCost: 22,
    // Inside this, they bump into you whatever the suit says.
    near: 3.2,
    // And it takes a moment to come up, as it does in the games.
    rise: 0.35,
  },
  sprint: { drain: 15, speed: 1.75, min: 8 },
  jump: { cost: 22, boost: 1.75, hold: 0.18 },
  // Nano Vision, the heat view of the second and third games: a steady
  // drain for as long as it is up.
  nano: { drain: 6 },
  punch: { cost: 30, damage: 260, reach: 2.6, force: 16 },
  // How long it waits before trying again after being emptied.
  stall: 1.2,
};

export class Nanosuit {
  constructor() {
    this.reset();
    this.onEmpty = null;   // fn(what) a mode dropped because the energy ran out
    this.onBreak = null;   // fn() the cloak dropped by a shot
  }

  reset() {
    this.energy = SUIT.energy;
    this.armor = false;
    this.cloak = false;
    this.nano = false;
    this.cloakAge = 0;
    this.sprinting = false;
    this.idle = SUIT.regenDelay;
    this.stalled = 0;
  }

  /** Fully up: the cloak has finished coming on. */
  get hidden() { return this.cloak && this.cloakAge >= SUIT.cloak.rise; }

  _spend(n) {
    if (n <= 0) return true;
    this.idle = 0;
    this.energy = Math.max(0, this.energy - n);
    if (this.energy <= 0) {
      this.stalled = SUIT.stall;
      const dropped = [];
      if (this.cloak) { this.cloak = false; dropped.push('cloak'); }
      if (this.armor) { this.armor = false; dropped.push('armor'); }
      if (this.nano) { this.nano = false; dropped.push('nano vision'); }
      if (dropped.length && this.onEmpty) this.onEmpty(dropped);
      return false;
    }
    return true;
  }

  /** Q. The two are not exclusive in the later games, and are not here. */
  toggleArmor() {
    if (!this.armor && (this.stalled > 0 || this.energy < 5)) return false;
    this.armor = !this.armor;
    return this.armor;
  }

  /** N. */
  toggleNano() {
    if (!this.nano && (this.stalled > 0 || this.energy < 5)) return false;
    this.nano = !this.nano;
    return this.nano;
  }

  /** E. */
  toggleCloak() {
    if (!this.cloak && (this.stalled > 0 || this.energy < 5)) return false;
    this.cloak = !this.cloak;
    this.cloakAge = 0;
    return this.cloak;
  }

  /**
   * A step of the suit.
   * @param {number} dt
   * @param {{speed:number, sprint:boolean}} body how fast you are going, and whether you want to sprint
   * @returns {number} what to multiply your speed by
   */
  update(dt, body) {
    this.stalled = Math.max(0, this.stalled - dt);
    if (this.cloak) this.cloakAge += dt;
    let drain = 0;
    const moving = body.speed > 0.6;
    if (this.armor) drain += moving ? SUIT.armor.drainMove : SUIT.armor.drainStill;
    if (this.nano) drain += SUIT.nano.drain;
    if (this.cloak) {
      drain += body.speed > 5 ? SUIT.cloak.drainRun : moving ? SUIT.cloak.drainWalk : SUIT.cloak.drainStill;
    }
    // The sprint is the suit's: it runs while there is energy for it, and
    // takes a little left over before it will start again.
    const want = body.sprint && moving;
    if (want && (this.sprinting || this.energy > SUIT.sprint.min) && this.stalled <= 0) {
      this.sprinting = true;
      drain += SUIT.sprint.drain;
    } else {
      this.sprinting = false;
    }
    if (drain > 0) this._spend(drain * dt);
    else {
      this.idle += dt;
      if (this.idle >= SUIT.regenDelay) this.energy = Math.min(SUIT.energy, this.energy + SUIT.regen * dt);
    }
    if (this.energy <= 0) this.sprinting = false;
    let k = 1;
    if (this.sprinting) k *= SUIT.sprint.speed;
    if (this.armor) k *= SUIT.armor.speed;
    return k;
  }

  /**
   * A hit. With the armour on most of it goes into the suit's energy
   * instead of into you, for as long as there is energy to take it.
   * @returns {number} what reaches you
   */
  absorb(amount) {
    if (!this.armor || amount <= 0) return amount;
    const want = amount * SUIT.armor.absorb;
    const can = this.energy / SUIT.armor.costPerPoint;
    const taken = Math.min(want, can);
    this._spend(taken * SUIT.armor.costPerPoint);
    return amount - taken;
  }

  /**
   * Something fired. The bow from the cloak costs a slice and keeps it up;
   * anything else drops it and empties the suit.
   * @returns {boolean} whether the cloak is still up
   */
  fired(isBow) {
    if (!this.cloak) return false;
    if (isBow) {
      this._spend(SUIT.cloak.bowCost);
      return this.cloak;
    }
    this.cloak = false;
    this.cloakAge = 0;
    this._spend(this.energy);
    if (this.onBreak) this.onBreak();
    return false;
  }

  /** A jump held: higher, for energy. The multiplier, or 1 if there is not enough. */
  powerJump() {
    if (this.energy < SUIT.jump.cost || this.stalled > 0) return 1;
    this._spend(SUIT.jump.cost);
    return SUIT.jump.boost;
  }

  /** A strength punch: true if there was energy for it. */
  punch() {
    if (this.energy < SUIT.punch.cost || this.stalled > 0) return false;
    this._spend(SUIT.punch.cost);
    return true;
  }
}
