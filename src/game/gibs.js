// The pieces, when the cheat menu says a killing hit should take somebody
// apart rather than lay them down.
//
// A gib is a rigid chunk with a velocity and a spin, and it is the same kind
// of object the grenades are: it asks the world what is in the way rather than
// being told. It asks less often, though. A raycast per chunk per frame with
// forty chunks in the air is a cost nothing here can justify, so a chunk
// collides against walls only while it is still moving fast, and against the
// ground height field for the rest of its life. The visible difference is that
// a chunk that has already come to rest will not be stopped by a wall it is
// sliding into, and the invisible difference is about half a millisecond a
// frame.

const MAX = 96;

/** How much of each kind a body is made of, by the part id the shader reads. */
const PARTS = [
  19, 19, 19, 19, 19,   // flesh, most of it
  20, 20,               // the pale pieces
  4, 4,                 // cloth
  6,                    // webbing and boots
  5,                    // helmet
  7,                    // what they were carrying
];

class Gib {
  constructor() { this.alive = false; }
}

export class Gibs {
  /** @param {object} world for the ground height and the wall raycast */
  constructor(world) {
    this.world = world;
    this.pool = [];
    for (let i = 0; i < MAX; i++) this.pool.push(new Gib());
    this.active = [];
    // Set by the game layer when blood is switched on: fn(x, y, z) for a drop
    // coming off something in flight, and fn(x, y, z, size) for what is left
    // where one of them stops.
    this.onDrip = null;
    this.onPool = null;
  }

  clear() {
    for (const g of this.pool) g.alive = false;
    this.active.length = 0;
  }

  _free() {
    for (const g of this.pool) if (!g.alive) return g;
    // Everything is in the air: take the oldest, which is the one nearest to
    // fading out anyway.
    let worst = this.active[0];
    for (const g of this.active) if (g.life < worst.life) worst = g;
    this._remove(worst);
    return worst;
  }

  _remove(g) {
    g.alive = false;
    const i = this.active.indexOf(g);
    if (i >= 0) this.active.splice(i, 1);
  }

  /**
   * Somebody coming apart.
   *
   * @param {number} x @param {number} y feet height @param {number} z
   * @param {object} dir the direction the hit came from, as a unit vector; the
   *   pieces go with it, which is what makes a shot from behind look like one
   * @param {number} scale the gore multiplier: how many pieces, how far
   * @returns {number} how many chunks it actually made
   */
  /**
   * A building coming down. The same chunks, made of concrete and brick
   * instead, thrown outward along the ground rather than up: a wall falls
   * into the street, it does not go into the air.
   *
   * @param {number} radius the collapse radius, which sets how far they go
   * @returns {number} how many chunks it made
   */
  rubble(x, y, z, radius, count = 22, fallHeight = 0) {
    const n = Math.min(MAX, count);
    for (let i = 0; i < n; i++) {
      const g = this._free();
      g.alive = true;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.75;
      g.x = x + Math.cos(a) * r;
      g.z = z + Math.sin(a) * r;
      // It comes off the line the building broke at, and off a band of that
      // line rather than a single height, so a storey coming away drops from
      // where the storey was.
      g.y = y - Math.random() * Math.max(1, fallHeight);
      // Masonry does not launch. It tips off the edge and falls, so the
      // outward speed is small and most of what happens is gravity.
      const out = 0.8 + Math.random() * 3.4;
      g.vx = Math.cos(a) * out;
      g.vy = -0.5 + Math.random() * 2.0;
      g.vz = Math.sin(a) * out;
      g.yaw = Math.random() * 6.28;
      g.pitch = Math.random() * 6.28;
      g.roll = Math.random() * 6.28;
      g.spinY = (Math.random() - 0.5) * 7;
      g.spinX = (Math.random() - 0.5) * 7;
      g.spinZ = (Math.random() - 0.5) * 7;
      g.scale = 1.1 + Math.random() * 2.6;
      g.part = Math.random() < 0.72 ? 21 : 22;
      g.maxLife = 26 + Math.random() * 20;
      g.life = g.maxLife;
      g.resting = false;
      g.dripAt = 0;
      g.wet = false;
      // Heavier than a piece of somebody: it hardly bounces, it slides less,
      // and it takes the spin out of itself the moment it lands.
      g.mass = 2.2 + g.scale;
      g.heap = { x, z, radius };
      this.active.push(g);
    }
    return n;
  }

  /**
   * Bones. What is left of somebody who has been burnt down to them and is
   * then shot, or who has stood there long enough to come apart on his own.
   * Bigger pieces than a gib burst, lighter, nothing wet about them, and no
   * blood: there is none left in a skeleton.
   *
   * @returns {number} how many pieces went up
   */
  bones(x, y, z, dir, scale = 1) {
    const n = Math.min(MAX, Math.round(11 * Math.min(7.5, scale)));
    const push = 1 + 0.3 * Math.min(7.5, scale);
    for (let i = 0; i < n; i++) {
      const g = this._free();
      g.alive = true;
      const up = 0.2 + Math.random() * 1.6;
      g.x = x + (Math.random() - 0.5) * 0.5;
      g.y = y + up;
      g.z = z + (Math.random() - 0.5) * 0.5;
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const speed = (2.0 + Math.random() * 5.5) * push;
      g.vx = Math.sin(b) * Math.cos(a) * speed + (dir ? dir.x : 0) * 3.4 * push;
      g.vy = Math.cos(b) * speed * 0.65 + 3.2 + Math.random() * 2.6;
      g.vz = Math.sin(b) * Math.sin(a) * speed + (dir ? dir.z : 0) * 3.4 * push;
      g.yaw = Math.random() * 6.28;
      g.pitch = Math.random() * 6.28;
      g.roll = Math.random() * 6.28;
      g.spinY = (Math.random() - 0.5) * 18;
      g.spinX = (Math.random() - 0.5) * 18;
      g.spinZ = (Math.random() - 0.5) * 18;
      g.scale = 0.7 + Math.random() * 1.1;
      // Mostly bone, with the odd pale scrap of what he was wearing.
      g.part = Math.random() < 0.82 ? 23 : 20;
      g.maxLife = 14 + Math.random() * 8;
      g.life = g.maxLife;
      g.resting = false;
      g.mass = 0.8;
      g.heap = null;
      g.dripAt = 0;
      g.wet = false;
      this.active.push(g);
    }
    return n;
  }

  burst(x, y, z, dir, scale = 1) {
    // Past the top gore switch there is nothing left to give: sixteen pieces
    // a point of scale runs the pool dry at six, and the throw keeps going a
    // little further than that.
    const n = Math.min(MAX, Math.round(16 * Math.min(7.5, scale)));
    const push = 1 + 0.35 * Math.min(7.5, scale);
    for (let i = 0; i < n; i++) {
      const g = this._free();
      g.alive = true;
      // Spread over the height of a body rather than out of one point, or the
      // whole burst looks like it came from their belt.
      const up = 0.25 + Math.random() * 1.5;
      g.x = x + (Math.random() - 0.5) * 0.4;
      g.y = y + up;
      g.z = z + (Math.random() - 0.5) * 0.4;
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const speed = (2.5 + Math.random() * 6.5) * push;
      g.vx = Math.sin(b) * Math.cos(a) * speed + (dir ? dir.x : 0) * 4 * push;
      g.vy = Math.cos(b) * speed * 0.7 + 3.5 + Math.random() * 3;
      g.vz = Math.sin(b) * Math.sin(a) * speed + (dir ? dir.z : 0) * 4 * push;
      g.yaw = Math.random() * 6.28;
      g.pitch = Math.random() * 6.28;
      g.roll = Math.random() * 6.28;
      g.spinY = (Math.random() - 0.5) * 22;
      g.spinX = (Math.random() - 0.5) * 22;
      g.spinZ = (Math.random() - 0.5) * 22;
      g.scale = 0.55 + Math.random() * 0.85;
      g.part = PARTS[(Math.random() * PARTS.length) | 0];
      g.maxLife = 9 + Math.random() * 5;
      g.life = g.maxLife;
      g.resting = false;
      g.mass = 1;
      g.heap = null;
      g.dripAt = 0;
      g.wet = g.part === 19 || g.part === 20;
      this.active.push(g);
    }
    return n;
  }

  update(dt) {
    const w = this.world;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const g = this.active[i];
      g.life -= dt;
      if (g.life <= 0) { this._remove(g); continue; }
      if (g.resting) continue;

      g.vy -= 22 * dt;
      g.yaw += g.spinY * dt;
      g.pitch += g.spinX * dt;
      g.roll += g.spinZ * dt;

      // A wet piece leaves a trail behind it, on a timer rather than every
      // frame, so the rate does not change with the frame rate.
      if (g.wet && this.onDrip) {
        g.dripAt -= dt;
        if (g.dripAt <= 0) {
          g.dripAt = 0.035 + Math.random() * 0.05;
          this.onDrip(g.x, g.y, g.z);
        }
      }

      const speed = Math.hypot(g.vx, g.vy, g.vz);
      // Walls, but only while it is still worth asking. Below six metres a
      // second a chunk is tumbling to a stop and the ground is the only thing
      // it is going to meet.
      if (speed > 6) {
        const d = 1 / speed;
        const hit = w.raycast(g.x, g.y, g.z, g.vx * d, g.vy * d, g.vz * d, speed * dt + 0.12);
        if (hit && hit.kind !== 'ground') {
          const dot = g.vx * hit.nx + g.vy * hit.ny + g.vz * hit.nz;
          g.vx -= 2 * dot * hit.nx; g.vy -= 2 * dot * hit.ny; g.vz -= 2 * dot * hit.nz;
          g.vx *= 0.3; g.vy *= 0.3; g.vz *= 0.3;
          g.x = hit.x + hit.nx * 0.08;
          g.y = hit.y + hit.ny * 0.08;
          g.z = hit.z + hit.nz * 0.08;
          // Something that hits a wall at speed leaves most of itself on it.
          g.spinY *= 0.4; g.spinX *= 0.4; g.spinZ *= 0.4;
          continue;
        }
      }

      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;

      // What it comes to rest on. Over the middle of a collapse that is the
      // heap, not the street: pieces pile up where the building was and thin
      // out towards the edge of it, which is the shape rubble actually makes
      // and the one the geometry underneath has taken too.
      const floor = w.groundHeight(g.x, g.z);
      let rest = floor + 0.08 * g.scale;
      if (g.heap) {
        const d = Math.hypot(g.x - g.heap.x, g.z - g.heap.z);
        const k = Math.max(0, 1 - d / Math.max(1, g.heap.radius));
        rest += Math.min(3.5, g.heap.radius * 0.07) * k * k;
      }
      if (g.y <= rest) {
        g.y = rest;
        // Restitution falls with mass: a lump of concrete lands once and
        // stays, a piece of somebody skips.
        const bounceAt = -1.2 * g.mass;
        if (g.vy < bounceAt) {
          g.vy = -g.vy * (0.22 / g.mass);
          g.vx *= 0.5; g.vz *= 0.5;
          g.spinY *= 0.5; g.spinX *= 0.3; g.spinZ *= 0.3;
        } else {
          g.vy = 0;
          // Rolling, then friction: whatever is still sliding turns as it
          // goes, and the turn is what takes the rest of the speed out.
          const slide = Math.hypot(g.vx, g.vz);
          if (slide > 0.4) {
            const radius = Math.max(0.1, 0.12 * g.scale);
            g.spinX = (g.vz / radius) * 0.35;
            g.spinZ = (-g.vx / radius) * 0.35;
            g.pitch += g.spinX * dt;
            g.roll += g.spinZ * dt;
          }
          const drag = Math.max(0, 1 - (5 + g.mass * 2.5) * dt);
          g.vx *= drag;
          g.vz *= drag;
          g.spinX *= Math.max(0, 1 - 9 * dt);
          g.spinZ *= Math.max(0, 1 - 9 * dt);
          g.spinY *= Math.max(0, 1 - 6 * dt);
          if (slide < 0.25) {
            // Lie flat where it stopped, rather than standing on a corner.
            g.resting = true;
            g.pitch = 0;
            g.roll = 0;
            // Not every piece leaves one, or a burst paints the whole
            // square rather than marking where the pieces came to rest.
            if (g.wet && this.onPool && Math.random() < 0.34) {
              this.onPool(g.x, floor, g.z, 0.16 + g.scale * 0.2);
            }
          }
        }
      }
    }
  }

  get count() { return this.active.length; }
}
