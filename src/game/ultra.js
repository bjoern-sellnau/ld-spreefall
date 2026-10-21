// Ultra plasma: a rain of plasma from orbit.
//
// Fired from the cheat menu onto a circle picked on the map, like the ion
// cannon, with four numbers set before you fire: how many balls, how wide
// the circle is, which way they come in from and how steeply. Then the
// system charges for a few seconds, which you can hear, and after that the
// balls come down, the same bouncing bolts the plasma rifle fires and a good
// deal bigger, as many as you asked for, until the circle is full of them.
//
// There is no ceiling on how many. What is bounded is how many are in the
// air at once, which is what the projectile pool and the frame can carry:
// the rest wait their turn in a queue that is just a number, so asking for a
// hundred thousand costs nothing until they are falling.

export const ULTRA = {
  // How long the system charges after you fire.
  charge: 4.2,
  // Where they come from: this far over the ground, at this speed.
  height: 420,
  speed: 120,
  // How many come down a second at first, and how fast that grows to the
  // most it ever is.
  rate: 30,
  rateMax: 140,
  rampSeconds: 6,
  // The most in the air at once.
  maxLive: 480,
  // What one ball does where it goes off. Under ninety on purpose: past that
  // a blast cuts its hole into the wall it is against, which is a re-mesh of
  // the tile, and a hundred of those a second is not a frame rate.
  splash: { radius: 5.5, damage: 80, force: 11, quiet: true },
  // Blast plasma, a switch on the same panel: the hard orange kind, which does
  // not bounce, goes off on the first thing it touches and does ten times the
  // harm over half as much again of the street. It cuts no holes in walls one
  // by one, for the reason above; it brings frontages down by weight instead.
  blastSplash: { radius: 8.25, damage: 800, force: 33, quiet: true, punch: false },
  // What the menu starts on.
  defaults: { count: 300, radius: 140, bearing: 225, tilt: 30, blast: false },
  // The sliders' ends. The count slider stops at the top of the slider and
  // the box beside it takes any number at all.
  limits: {
    count: [1, 3000], radius: [20, 1200], bearing: [0, 359], tilt: [0, 75],
  },
};

// Void storm: the same thing with the void cannon's ball instead of a plasma
// bolt. Far fewer of them, because each one is a ball of green that reaches
// out at everybody it passes and lands like the cannon's own shot: a flash
// the width of a street and a tendril to everybody in reach. It cuts no
// holes in walls one at a time, for the reason given for ultra plasma; the
// wreck is the cannon's own, and enough of them bring a block down.
export const VOID_STORM = {
  charge: 6,
  height: 420,
  speed: 90,
  rate: 3,
  rateMax: 14,
  rampSeconds: 6,
  // Every one in the air looks for somebody to reach seven times a second,
  // which is what holds this down, not the pool.
  maxLive: 48,
  splash: { radius: 24, damage: 700, force: 46, quiet: true, punch: false, self: 0.08,
    wreck: { radius: 12, damage: 200 } },
  void: { aura: 16, auraDamage: 70, every: 0.14, reach: 48, damage: 450 },
  defaults: { count: 60, radius: 160, bearing: 225, tilt: 20 },
  limits: {
    count: [1, 600], radius: [20, 1200], bearing: [0, 359], tilt: [0, 75],
  },
};

const STATE = { OFF: 0, CHARGE: 1, RAIN: 2 };
export const ULTRA_STATE = STATE;

/** A setting held to what it may be. The count has no top. */
export function clampUltra(key, v, spec = ULTRA) {
  if (key === 'blast') return v === true || v === 'true' || v === 1;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return spec.defaults[key];
  const [lo, hi] = spec.limits[key];
  if (key === 'count') return Math.max(lo, n);
  if (key === 'bearing') return ((n % 360) + 360) % 360;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Which way a ball travels, as a unit vector, for a compass bearing it comes
 * from (0 north, 90 east) and a tilt off the vertical.
 */
export function ultraDirection(bearing, tilt) {
  const b = bearing * Math.PI / 180, t = tilt * Math.PI / 180;
  // North is -z in this world and east is +x, so the place it comes from
  // lies along (sin b, -cos b); it travels the other way.
  return { x: -Math.sin(b) * Math.sin(t), y: -Math.cos(t), z: Math.cos(b) * Math.sin(t) };
}

export class Ultra {
  /**
   * @param {object} world for the ground under the circle
   * @param {(x,y,z)=>boolean} isSanctuary the memorial, which this cannot touch
   * @param {object} spec ULTRA, or VOID_STORM for the void cannon's ball
   */
  constructor(world, isSanctuary, spec = ULTRA) {
    this.world = world;
    this.spec = spec;
    this.isSanctuary = isSanctuary || (() => false);
    this.state = STATE.OFF;
    this.left = 0;           // still to come
    this.sent = 0;           // already on their way
    this.t = 0;
    this.acc = 0;
    this.shot = null;        // {x, z, radius, bearing, tilt, count}
    this.onCharge = null;    // fn(seconds) when it starts charging
    this.onRain = null;      // fn() when the first ones leave
    this.onDone = null;      // fn(sent) when the last one has left
    this.launch = null;      // fn(from, velocity) -> body or null
  }

  get active() { return this.state !== STATE.OFF; }
  get charging() { return this.state === STATE.CHARGE; }

  /**
   * @param {object} opts {count, radius, bearing, tilt}
   * @returns {boolean} whether it fired: not into the memorial, and not while
   *   the last one is still coming down
   */
  fire(x, z, opts) {
    if (this.active) return false;
    const spec = this.spec;
    const radius = clampUltra('radius', opts.radius, spec);
    // Any part of the circle over the memorial is refused, the same as the
    // other two: a ball bounces, and the circle is where they land.
    for (let a = 0; a < 16; a++) {
      const ang = a / 16 * Math.PI * 2;
      for (const r of [0, radius * 0.5, radius]) {
        if (this.isSanctuary(x + Math.cos(ang) * r, 0, z + Math.sin(ang) * r)) return false;
      }
    }
    this.shot = {
      x, z, radius,
      count: clampUltra('count', opts.count, spec),
      bearing: clampUltra('bearing', opts.bearing, spec),
      tilt: clampUltra('tilt', opts.tilt, spec),
    };
    this.left = this.shot.count;
    this.sent = 0;
    this.t = 0;
    this.acc = 0;
    this.state = STATE.CHARGE;
    if (this.onCharge) this.onCharge(spec.charge);
    return true;
  }

  reset() {
    this.state = STATE.OFF;
    this.left = 0;
    this.shot = null;
  }

  /**
   * @param {number} dt
   * @param {number} live how many balls are in the air now
   */
  update(dt, live) {
    if (this.state === STATE.OFF) return;
    const spec = this.spec;
    this.t += dt;
    if (this.state === STATE.CHARGE) {
      if (this.t < spec.charge) return;
      this.state = STATE.RAIN;
      this.t = 0;
      if (this.onRain) this.onRain();
    }
    const ramp = Math.min(1, this.t / spec.rampSeconds);
    const rate = spec.rate + (spec.rateMax - spec.rate) * ramp;
    this.acc += rate * dt;
    const s = this.shot;
    const dir = ultraDirection(s.bearing, s.tilt);
    let room = Math.max(0, spec.maxLive - live);
    while (this.acc >= 1 && this.left > 0 && room > 0) {
      this.acc -= 1;
      // Spread evenly over the disc, not bunched in the middle of it.
      const r = s.radius * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const tx = s.x + Math.cos(a) * r, tz = s.z + Math.sin(a) * r;
      const ty = this.world.groundHeight(tx, tz);
      // Back up the line it comes in on until it is the full height up.
      const back = spec.height / Math.max(0.2, -dir.y);
      const from = { x: tx - dir.x * back, y: ty - dir.y * back, z: tz - dir.z * back };
      const speed = spec.speed * (0.9 + Math.random() * 0.2);
      if (this.launch && this.launch(from, { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed })) {
        this.left--;
        this.sent++;
        room--;
      } else {
        break;
      }
    }
    // A queue that cannot get out does not pile up speed it will spend all
    // at once later.
    this.acc = Math.min(this.acc, 4);
    if (this.left <= 0) {
      const sent = this.sent;
      this.reset();
      if (this.onDone) this.onDone(sent);
    }
  }
}
