// Tracers, impact sparks and muzzle flashes. A fixed pool, updated on the render
// clock because these are presentation rather than simulation.

import { SURFACE_CLEARANCE } from '../shared/constants.js';

// The sparks are additive billboards drawn in one instanced call, so the only
// real cost of a bigger pool is the buffer. A warhead alone wants a hundred
// and fifty of them, and starving the rest of the game of tracers while one
// goes off would be a poor trade. The top gore switch asks for three sprays
// of a hundred and thirty at once, hence the room above that.
// The overkill setting asks for a fountain on top of that, hence 2048.
const MAX = 2048;
// How many stains the street may carry at once. Past this the oldest goes.
const MAX_POOLS = 128;

class Spark {
  constructor() { this.alive = false; }
}

export class Effects {
  constructor() {
    this.pool = [];
    for (let i = 0; i < MAX; i++) this.pool.push(new Spark());
    this.shake = 0;
  }

  _get() {
    for (const s of this.pool) if (!s.alive) return s;
    // Everything is busy: steal the oldest.
    let worst = this.pool[0];
    for (const s of this.pool) if (s.life < worst.life) worst = s;
    return worst;
  }

  clear() { for (const s of this.pool) s.alive = false; this.shake = 0; }

  tracer(ax, ay, az, bx, by, bz, warm) {
    const s = this._get();
    s.alive = true;
    s.kind = 0;
    s.ax = ax; s.ay = ay; s.az = az;
    s.bx = bx; s.by = by; s.bz = bz;
    s.maxLife = 0.075;
    s.life = s.maxLife;
    s.r = warm ? 1.0 : 0.85;
    s.g = warm ? 0.72 : 0.86;
    s.b = warm ? 0.32 : 1.0;
    s.size = 0.028;
    s.vx = 0; s.vy = 0; s.vz = 0;
    s.gravity = 0;
  }

  /**
   * A lance: the same line a tracer draws, but thicker, in whatever colour it
   * is given and lasting long enough to be seen as a line rather than as a
   * flicker. What a machine shoots with.
   *
   * It is not called beam, and that is not pedantry. It was, and so is the
   * column of light further down this file, and a class keeps the last method
   * of a name: every machine shot was quietly drawn as a pillar standing on
   * the machine and going up into the sky. Two methods in one class may not
   * share a name, and nothing in the language will tell you when they do.
   */
  lance(ax, ay, az, bx, by, bz, r, g, b) {
    const s = this._get();
    s.alive = true;
    s.kind = 0;
    s.ax = ax; s.ay = ay; s.az = az;
    s.bx = bx; s.by = by; s.bz = bz;
    s.maxLife = 0.12;
    s.life = s.maxLife;
    s.r = r; s.g = g; s.b = b;
    s.size = 0.075;
    s.vx = 0; s.vy = 0; s.vz = 0;
    s.gravity = 0;
  }

  /** One small bright point, for something electrical going wrong. */
  spark(x, y, z, r, g, b) {
    const s = this._get();
    s.alive = true;
    s.kind = 1;
    s.ax = x; s.ay = y; s.az = z;
    s.bx = 0; s.by = 0; s.bz = 0;
    s.maxLife = 0.35;
    s.life = s.maxLife;
    s.r = r; s.g = g; s.b = b;
    s.size = 0.09;
    s.vx = (Math.random() - 0.5) * 3.2;
    s.vy = 1.4 + Math.random() * 2.4;
    s.vz = (Math.random() - 0.5) * 3.2;
    s.gravity = 9;
  }

  flash(x, y, z, size, r, g, b, life) {
    const s = this._get();
    s.alive = true;
    s.kind = 2;
    s.ax = x; s.ay = y; s.az = z;
    s.bx = 0; s.by = 0; s.bz = 0;
    s.maxLife = life;
    s.life = life;
    s.r = r; s.g = g; s.b = b;
    s.size = size;
    s.vx = 0; s.vy = 0; s.vz = 0;
    s.gravity = 0;
  }

  /** A little burst of sparks off a surface, thrown along the normal. */
  impact(x, y, z, nx, ny, nz, kind) {
    const warm = kind === 'drone';
    this.flash(x, y, z, warm ? 0.55 : 0.32,
      warm ? 1.0 : 0.9, warm ? 0.55 : 0.78, warm ? 0.22 : 0.62, warm ? 0.13 : 0.085);
    const n = warm ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      s.ax = x; s.ay = y; s.az = z;
      const spread = 3.4;
      s.vx = nx * 3 + (Math.random() - 0.5) * spread;
      s.vy = ny * 3 + (Math.random() - 0.5) * spread + 1.2;
      s.vz = nz * 3 + (Math.random() - 0.5) * spread;
      s.gravity = 9.5;
      s.maxLife = 0.28 + Math.random() * 0.4;
      s.life = s.maxLife;
      s.r = warm ? 1.0 : 1.0;
      s.g = warm ? 0.48 : 0.80;
      s.b = warm ? 0.20 : 0.52;
      s.size = 0.028 + Math.random() * 0.03;
      s.bx = 0; s.by = 0; s.bz = 0;
    }
  }

  /** A drone coming apart. */
  /**
   * A blast that reads at its real size: one bright core, a ring of fire
   * thrown outward to the radius that actually does the damage, and smoke that
   * hangs. The radius matters, because a player needs to learn how far a
   * grenade reaches by watching one go off.
   */
  blast(x, y, z, radius) {
    this.flash(x, y, z, radius * 0.9, 1.0, 0.62, 0.26, 0.26);
    this.flash(x, y, z, radius * 0.45, 1.0, 0.92, 0.7, 0.14);
    const n = Math.min(60, 18 + Math.round(radius * 3));
    for (let i = 0; i < n; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      // Fire leaves the centre in every direction at a speed that puts it at
      // the edge of the blast about when it fades.
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const speed = radius * (0.9 + Math.random() * 1.4);
      s.ax = x; s.ay = y; s.az = z;
      s.vx = Math.sin(b) * Math.cos(a) * speed;
      s.vy = Math.cos(b) * speed * 0.7 + 2.5;
      s.vz = Math.sin(b) * Math.sin(a) * speed;
      s.gravity = 9;
      s.maxLife = 0.35 + Math.random() * 0.8;
      s.life = s.maxLife;
      s.r = 1.0; s.g = 0.35 + Math.random() * 0.4; s.b = 0.12;
      s.size = 0.08 + Math.random() * 0.16;
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    // Smoke, slower and colder, left behind where it went off.
    for (let i = 0; i < 10; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      s.ax = x + (Math.random() - 0.5) * radius * 0.5;
      s.ay = y + Math.random() * radius * 0.4;
      s.az = z + (Math.random() - 0.5) * radius * 0.5;
      s.vx = (Math.random() - 0.5) * 1.6;
      s.vy = 1.2 + Math.random() * 1.4;
      s.vz = (Math.random() - 0.5) * 1.6;
      s.gravity = -0.6;
      s.maxLife = 1.2 + Math.random() * 1.1;
      s.life = s.maxLife;
      s.r = 0.28; s.g = 0.26; s.b = 0.24;
      s.size = 0.3 + Math.random() * 0.5;
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    this.shake = Math.min(1.4, this.shake + 0.4);
  }

  /**
   * Something arriving where there was nothing. A sphere of light stands on
   * the street for a moment, closes in on itself, and whatever came through
   * it is standing there when it goes.
   *
   * It is built out of the same three pieces as the pulse, because they are
   * the right three: a core that is almost white, a shell of sparks that
   * travels inwards rather than out, which is what makes it read as
   * something arriving rather than something exploding, and arcs crawling up
   * off the ground around it.
   *
   * @param {number} radius how big the sphere is, in metres
   * @param {number} scale how much of everything, for a machine rather than
   *   a man
   */
  arrival(x, y, z, radius, scale = 1, tint = null) {
    // The light of it: blue for anybody arriving, or a tint for what comes
    // up out of a portal of its own (a demon's is red and orange).
    const c = tint || [0.52, 0.84, 1.0];
    this.flash(x, y + radius * 0.5, z, radius * 1.1, Math.min(1, c[0] * 1.4), c[1] * 1.07, c[2], 0.20);
    this.flash(x, y + radius * 0.5, z, radius * 0.45, 1.0, tint ? c[1] * 1.6 : 1.0, tint ? c[2] * 2 : 1.0, 0.13);
    // The shell. Points scattered over a sphere, each of them falling in
    // towards the middle of it and arriving as it dies.
    const n = Math.min(120, Math.round((34 + radius * 10) * scale));
    for (let i = 0; i < n; i++) {
      const p = this._get();
      p.alive = true;
      p.kind = 1;
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const sx = Math.sin(b) * Math.cos(a), sy = Math.cos(b), sz = Math.sin(b) * Math.sin(a);
      const life = 0.34 + Math.random() * 0.26;
      p.ax = x + sx * radius;
      p.ay = y + radius * 0.55 + sy * radius * 0.8;
      p.az = z + sz * radius;
      p.vx = -sx * radius / life;
      p.vy = -sy * radius * 0.8 / life;
      p.vz = -sz * radius / life;
      p.gravity = 0;
      p.maxLife = life;
      p.life = life;
      p.r = c[0]; p.g = c[1]; p.b = c[2];
      p.size = 0.18 + Math.random() * 0.26;
      p.bx = 0; p.by = 0; p.bz = 0;
    }
    for (let i = 0; i < Math.round(8 * scale); i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.2 + Math.random() * 0.8);
      this.lance(x + Math.cos(a) * r, y, z + Math.sin(a) * r,
        x + Math.cos(a) * r * 0.3, y + radius * (0.6 + Math.random()), z + Math.sin(a) * r * 0.3,
        Math.min(1, c[0] * 1.2), c[1] * 1.05, c[2]);
    }
    for (let i = 0; i < Math.round(14 * scale); i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.sqrt(Math.random());
      this.spark(x + Math.cos(a) * r, y + 0.2 + Math.random() * radius,
        z + Math.sin(a) * r, c[0] * 1.1, c[1], c[2]);
    }
  }

  /**
   * An electromagnetic pulse going off.
   *
   * Not an explosion, and it should not look like one: no fire, no smoke, no
   * debris. What it has instead is a hard white core, a blue ring that
   * travels out along the ground to exactly the radius the pulse reaches, so
   * you can see what it caught and what it missed, and a crackle of arcs
   * standing in the middle of it. The ring is the important part: an EMP that
   * reads as a flash and a noise tells you nothing about where its edge was.
   *
   * @param {number} radius how far the pulse reaches, in metres
   */
  emp(x, y, z, radius) {
    this.flash(x, y + 1.2, z, radius * 0.5, 0.75, 0.92, 1.0, 0.18);
    this.flash(x, y + 1.2, z, radius * 0.22, 1.0, 1.0, 1.0, 0.10);
    // The ring. Flat, and it arrives at the edge as it fades, so what you
    // see is the shape of the thing rather than a glow.
    const n = Math.min(84, 30 + Math.round(radius));
    for (let i = 0; i < n; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.08;
      const life = 0.42 + Math.random() * 0.12;
      const speed = radius / life;
      s.ax = x; s.ay = y + 0.5 + Math.random() * 0.6; s.az = z;
      s.vx = Math.cos(a) * speed;
      s.vy = 0.4;
      s.vz = Math.sin(a) * speed;
      s.gravity = 0;
      s.maxLife = life;
      s.life = life;
      s.r = 0.42; s.g = 0.78; s.b = 1.0;
      s.size = 0.22 + Math.random() * 0.3;
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    // And the arcs, which are what a pulse sounds like drawn as lines.
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.1 + Math.random() * 0.5);
      const up = 1 + Math.random() * 7;
      this.lance(x, y + 0.3, z,
        x + Math.cos(a) * r, y + up, z + Math.sin(a) * r, 0.6, 0.86, 1.0);
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.sqrt(Math.random());
      this.spark(x + Math.cos(a) * r, y + 0.4 + Math.random() * 2.5,
        z + Math.sin(a) * r, 0.5, 0.82, 1.0);
    }
    this.shake = Math.min(1.4, this.shake + 0.5);
  }

  /**
   * A warhead. The shape a mushroom cloud actually has, at the scale this
   * particle pool can afford: a flat ring racing out along the ground, a
   * column going up through the middle of it, and a cap that spreads at the
   * top of the column. Nothing here is a texture; it is the same billboards
   * everything else uses, thrown along the right paths.
   *
   * @param {number} radius the blast radius, in metres
   */
  nuke(x, y, z, radius) {
    this.flash(x, y + 10, z, radius * 1.6, 1.0, 0.95, 0.82, 0.8);
    this.flash(x, y + 10, z, radius * 0.8, 1.0, 1.0, 0.98, 0.45);

    // The ground ring. Flat, fast, and it is what tells you how far it reached.
    for (let i = 0; i < 40; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      const a = (i / 40) * Math.PI * 2 + Math.random() * 0.1;
      const speed = radius * (0.7 + Math.random() * 0.4);
      s.ax = x; s.ay = y + 2; s.az = z;
      s.vx = Math.cos(a) * speed;
      s.vy = 3 + Math.random() * 6;
      s.vz = Math.sin(a) * speed;
      s.gravity = 1.2;
      s.maxLife = 2.2 + Math.random() * 1.8;
      s.life = s.maxLife;
      s.r = 1.0; s.g = 0.52 + Math.random() * 0.3; s.b = 0.18;
      s.size = radius * (0.09 + Math.random() * 0.09);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    // The stem, which rises for most of ten seconds and is the part you watch
    // from the far side of the city.
    for (let i = 0; i < 46; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.26;
      const up = i / 46;
      s.ax = x + Math.cos(a) * r;
      s.ay = y + 4 + up * radius * 0.7;
      s.az = z + Math.sin(a) * r;
      s.vx = Math.cos(a) * 4;
      s.vy = 26 + Math.random() * 26;
      s.vz = Math.sin(a) * 4;
      s.gravity = 1.4;
      s.maxLife = 5.5 + Math.random() * 3.5;
      s.life = s.maxLife;
      // Hot at the bottom, cooling as it goes up, and never grey: these are
      // additive billboards, and grey smoke added to a bright sky is nothing
      // at all. What makes a cloud read here is a warm colour going dark, not
      // a dark colour going transparent.
      const heat = 1 - up * 0.75;
      s.r = 0.55 + heat * 0.45;
      s.g = 0.22 + heat * 0.5;
      s.b = 0.12 + heat * 0.16;
      s.size = radius * (0.14 + Math.random() * 0.12);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    // The cap, thrown outward at the top of the stem.
    for (let i = 0; i < 40; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      const a = (i / 40) * Math.PI * 2 + Math.random() * 0.3;
      const out = radius * (0.35 + Math.random() * 0.55);
      s.ax = x + Math.cos(a) * radius * 0.08;
      s.ay = y + radius * 0.5 + Math.random() * radius * 0.3;
      s.az = z + Math.sin(a) * radius * 0.08;
      s.vx = Math.cos(a) * out * 0.42;
      s.vy = 15 + Math.random() * 11;
      s.vz = Math.sin(a) * out * 0.42;
      s.gravity = 2.2;
      s.maxLife = 6.0 + Math.random() * 4.0;
      s.life = s.maxLife;
      s.r = 0.70; s.g = 0.40; s.b = 0.24;
      s.size = radius * (0.17 + Math.random() * 0.15);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    this.shake = Math.min(2.4, this.shake + 1.6);
  }

  /**
   * A mech's reactor letting go: the warhead's shape, a ring, a stem and a
   * cap, in the colours of a fusion plasma instead of a fire. Electric blue
   * at the heart, neon green at the edges, and a shell of sparks thrown out
   * in every direction at once, which a chemical blast does not do.
   */
  fusion(x, y, z, radius) {
    // Additive, like everything else here: two greens on top of each other
    // are a paler green, so the colours are kept dark and saturated and let
    // the overlap do the brightening, or the whole thing goes to mint.
    this.flash(x, y + 4, z, radius * 1.5, 0.05, 0.75, 0.35, 0.9);
    this.flash(x, y + 4, z, radius * 0.7, 0.08, 0.45, 1.0, 0.5);
    this.flash(x, y + 4, z, radius * 0.25, 0.7, 0.9, 1.0, 0.25);
    // The ground ring, neon green, fast.
    for (let i = 0; i < 48; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      const a = (i / 48) * Math.PI * 2 + Math.random() * 0.08;
      const speed = radius * (0.9 + Math.random() * 0.35);
      s.ax = x; s.ay = y + 1.5; s.az = z;
      s.vx = Math.cos(a) * speed;
      s.vy = 2 + Math.random() * 4;
      s.vz = Math.sin(a) * speed;
      s.gravity = 1.0;
      s.maxLife = 1.6 + Math.random() * 1.2;
      s.life = s.maxLife;
      s.r = 0.04; s.g = 0.7; s.b = 0.22 + Math.random() * 0.12;
      s.size = radius * (0.1 + Math.random() * 0.08);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    // The shell: a sphere of sparks, the same speed in every direction.
    for (let i = 0; i < 70; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const h = Math.sqrt(1 - u * u);
      const speed = radius * (1.2 + Math.random() * 0.3);
      s.ax = x; s.ay = y + 5; s.az = z;
      s.vx = Math.cos(a) * h * speed;
      s.vy = Math.abs(u) * speed * 0.8;
      s.vz = Math.sin(a) * h * speed;
      s.gravity = 4;
      s.maxLife = 0.7 + Math.random() * 0.6;
      s.life = s.maxLife;
      s.r = 0.1; s.g = 0.5; s.b = 1.0;
      s.size = 0.8 + Math.random() * 1.4;
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    // The stem: white blue at the bottom, going green as it climbs.
    for (let i = 0; i < 34; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.2;
      const up = i / 34;
      s.ax = x + Math.cos(a) * r;
      s.ay = y + 3 + up * radius * 0.8;
      s.az = z + Math.sin(a) * r;
      s.vx = Math.cos(a) * 3;
      s.vy = 20 + Math.random() * 18;
      s.vz = Math.sin(a) * 3;
      s.gravity = 1.4;
      s.maxLife = 3.5 + Math.random() * 2.5;
      s.life = s.maxLife;
      // Electric blue at the bottom, neon green by the top.
      s.r = 0.03;
      s.g = 0.22 + up * 0.38;
      s.b = 0.62 - up * 0.42;
      s.size = radius * (0.14 + Math.random() * 0.1);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    // The cap, thrown outward at the top, the greenest part of it.
    for (let i = 0; i < 32; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      const a = (i / 32) * Math.PI * 2 + Math.random() * 0.3;
      const out = radius * (0.35 + Math.random() * 0.5);
      s.ax = x + Math.cos(a) * radius * 0.08;
      s.ay = y + radius * 0.6 + Math.random() * radius * 0.3;
      s.az = z + Math.sin(a) * radius * 0.08;
      s.vx = Math.cos(a) * out * 0.45;
      s.vy = 12 + Math.random() * 9;
      s.vz = Math.sin(a) * out * 0.45;
      s.gravity = 2.0;
      s.maxLife = 4.5 + Math.random() * 3.0;
      s.life = s.maxLife;
      s.r = 0.03; s.g = 0.5 + Math.random() * 0.15; s.b = 0.16 + Math.random() * 0.12;
      s.size = radius * (0.16 + Math.random() * 0.12);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    this.shake = Math.min(2.4, this.shake + 1.1);
  }

  /**
   * One tick of a tree burning: a tongue of flame out of the crown and a
   * thread of smoke off the top of it. Called a few times a second per tree
   * rather than every frame, so the look does not change with the frame rate.
   *
   * @param {number} height the tree's height, so the flame sits in the crown
   * @param {number} strength 0 to 1, how hard it is going
   */
  flame(x, y, z, height, strength = 1) {
    const crown = y + height * 0.55;
    const spread = height * 0.22;
    const s = this._get();
    s.alive = true;
    s.kind = 1;
    s.ax = x + (Math.random() - 0.5) * spread;
    s.ay = crown + (Math.random() - 0.5) * spread;
    s.az = z + (Math.random() - 0.5) * spread;
    s.vx = (Math.random() - 0.5) * 1.2;
    s.vy = 2.6 + Math.random() * 3.4;
    s.vz = (Math.random() - 0.5) * 1.2;
    s.gravity = -1.6;
    s.maxLife = 0.5 + Math.random() * 0.6;
    s.life = s.maxLife;
    const heat = Math.random();
    s.r = 1.0; s.g = 0.30 + heat * 0.45; s.b = 0.06 + heat * 0.1;
    s.size = (0.5 + Math.random() * 0.9) * strength;
    s.bx = 0; s.by = 0; s.bz = 0;

    // Smoke off the top, which is what you see from the far end of a street.
    if (Math.random() < 0.45) {
      const m = this._get();
      m.alive = true;
      m.kind = 1;
      m.ax = x + (Math.random() - 0.5) * spread;
      m.ay = crown + height * 0.3;
      m.az = z + (Math.random() - 0.5) * spread;
      m.vx = (Math.random() - 0.5) * 1.6;
      m.vy = 3.5 + Math.random() * 2.5;
      m.vz = (Math.random() - 0.5) * 1.6;
      m.gravity = -1.0;
      m.maxLife = 2.4 + Math.random() * 2.2;
      m.life = m.maxLife;
      m.r = 0.26; m.g = 0.23; m.b = 0.21;
      m.size = 0.9 + Math.random() * 1.6;
      m.bx = 0; m.by = 0; m.bz = 0;
    }
  }

  /**
   * A column of light standing on the street. Rewritten every frame rather
   * than left to decay, because unlike everything else in this pool a beam
   * is a thing that is there until it is not.
   *
   * @param {number} height how far up it goes
   * @param {number} width its radius at the bottom
   */
  beam(x, y, z, height, width, r, g, b, seed = 0) {
    const s = this._get();
    s.alive = true;
    s.kind = 5;
    s.ax = x; s.ay = y; s.az = z;
    s.bx = height; s.by = 0; s.bz = seed;
    // Long enough to survive a slow frame, short enough that a beam nobody
    // re-emits is gone before anybody notices it is still there.
    s.maxLife = 0.2;
    s.life = s.maxLife;
    s.r = r; s.g = g; s.b = b;
    s.size = width;
    s.gravity = 0;
    s.vx = 0; s.vy = 0; s.vz = 0;
    return s;
  }

  /**
   * A tree going up. Not an explosion: what happens is the sap boils and the
   * crown comes apart all at once, so it is a sphere of fire and a shower of
   * burning leaves rather than a shockwave.
   */
  treeBurst(x, y, z, height) {
    const crown = y + height * 0.6;
    this.flash(x, crown, z, height * 0.5, 1.0, 0.52, 0.16, 0.28);
    for (let i = 0; i < 26; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const speed = 4 + Math.random() * 11;
      s.ax = x; s.ay = crown; s.az = z;
      s.vx = Math.sin(b) * Math.cos(a) * speed;
      s.vy = Math.cos(b) * speed * 0.8 + 3;
      s.vz = Math.sin(b) * Math.sin(a) * speed;
      s.gravity = 7;
      s.maxLife = 0.7 + Math.random() * 1.3;
      s.life = s.maxLife;
      s.r = 1.0; s.g = 0.34 + Math.random() * 0.35; s.b = 0.10;
      s.size = 0.16 + Math.random() * 0.3;
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    this.shake = Math.min(1.2, this.shake + 0.18);
  }

  /**
   * The dust off a building coming down. Pale and bright rather than dark,
   * because these are additive billboards and dark smoke added to a daylight
   * street is nothing at all. It rolls outward along the ground first and
   * lifts afterwards, which is what a collapse does and what distinguishes it
   * from an explosion.
   *
   * @param {number} radius the collapse radius
   */
  dust(x, y, z, radius) {
    const ring = Math.min(48, 16 + Math.round(radius * 0.5));
    for (let i = 0; i < ring; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      const a = (i / ring) * Math.PI * 2 + Math.random() * 0.4;
      const speed = radius * (0.35 + Math.random() * 0.5);
      s.ax = x + Math.cos(a) * radius * 0.3;
      s.ay = y + 1 + Math.random() * radius * 0.3;
      s.az = z + Math.sin(a) * radius * 0.3;
      s.vx = Math.cos(a) * speed;
      s.vy = 1.5 + Math.random() * 4;
      s.vz = Math.sin(a) * speed;
      s.gravity = -0.9;
      s.maxLife = 2.6 + Math.random() * 2.6;
      s.life = s.maxLife;
      s.r = 0.42; s.g = 0.395; s.b = 0.355;
      s.size = radius * (0.14 + Math.random() * 0.16);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    // The column over the middle of it.
    for (let i = 0; i < 12; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      s.ax = x + (Math.random() - 0.5) * radius * 0.5;
      s.ay = y + 2 + Math.random() * radius;
      s.az = z + (Math.random() - 0.5) * radius * 0.5;
      s.vx = (Math.random() - 0.5) * 3;
      s.vy = 4 + Math.random() * 7;
      s.vz = (Math.random() - 0.5) * 3;
      s.gravity = -0.5;
      s.maxLife = 3.4 + Math.random() * 2.6;
      s.life = s.maxLife;
      s.r = 0.38; s.g = 0.36; s.b = 0.33;
      s.size = radius * (0.18 + Math.random() * 0.2);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    this.shake = Math.min(2.0, this.shake + 0.5);
  }

  /**
   * A cloud of poison: low, slow, sickly green, hanging where it was let out.
   */
  gas(x, y, z, radius, strength = 1) {
    const n = Math.round(10 * strength);
    for (let i = 0; i < n; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.8;
      s.ax = x + Math.cos(a) * r;
      s.ay = y + 0.3 + Math.random() * 1.6;
      s.az = z + Math.sin(a) * r;
      s.vx = Math.cos(a) * 0.6;
      s.vy = 0.2 + Math.random() * 0.5;
      s.vz = Math.sin(a) * 0.6;
      s.gravity = -0.05;
      s.maxLife = 1.6 + Math.random() * 1.4;
      s.life = s.maxLife;
      s.r = 0.32; s.g = 0.62; s.b = 0.16;
      s.size = radius * (0.22 + Math.random() * 0.18);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
  }

  /**
   * Blood off a hit. Dark, heavy, and gone quickly, with a mist that hangs for
   * a moment where the round went in.
   *
   * @param {number} amount a multiplier from the gore settings
   */
  blood(x, y, z, nx, ny, nz, amount = 1) {
    // The ceiling is where the top gore switch lands. Everything under it
    // asks for less and gets exactly what it asked for.
    const k = Math.min(12, amount);
    const n = Math.min(220, Math.round(18 * k));
    for (let i = 0; i < n; i++) {
      const s = this._get();
      s.alive = true;
      // Kind three is blood, and the only reason it is a kind of its own is
      // the blend. Everything else in this pool is drawn additively, which is
      // right for fire and tracers and hopeless for blood: dark red added to a
      // grey street comes out brighter than the street. Blood is drawn over
      // the frame instead, which is why it looks like blood.
      s.kind = 3;
      s.ax = x; s.ay = y; s.az = z;
      const spread = 4.6 * k;
      s.vx = nx * 5.5 + (Math.random() - 0.5) * spread;
      s.vy = ny * 5.5 + (Math.random() - 0.5) * spread + 2.2;
      s.vz = nz * 5.5 + (Math.random() - 0.5) * spread;
      s.gravity = 16;
      s.maxLife = 0.45 + Math.random() * 0.7;
      s.life = s.maxLife;
      s.r = 0.095; s.g = 0.009; s.b = 0.008;
      s.size = 0.03 + Math.random() * 0.06 * k;
      // The comic book: a red you could paint a fire engine with, in drops
      // the size of coins, thrown further and hanging longer.
      if (this.comic) {
        s.r = 0.62; s.g = 0.012; s.b = 0.01;
        s.size *= 1.9;
        s.vx *= 1.25; s.vy = s.vy * 1.3 + 1.5; s.vz *= 1.25;
        s.maxLife *= 1.5; s.life = s.maxLife;
      }
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    // The mist, which is what reads at twenty metres when the drops do not.
    const mist = Math.min(40, Math.round(6 * k));
    for (let i = 0; i < mist; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 3;
      s.ax = x + (Math.random() - 0.5) * 0.4;
      s.ay = y + (Math.random() - 0.5) * 0.4;
      s.az = z + (Math.random() - 0.5) * 0.4;
      s.vx = nx * 1.6 + (Math.random() - 0.5);
      s.vy = ny * 1.6 + 0.6;
      s.vz = nz * 1.6 + (Math.random() - 0.5);
      s.gravity = 3.0;
      s.maxLife = 0.35 + Math.random() * 0.35;
      s.life = s.maxLife;
      s.r = 0.085; s.g = 0.011; s.b = 0.010;
      s.size = (0.18 + Math.random() * 0.26) * k;
      if (this.comic) { s.r = 0.5; s.g = 0.01; s.b = 0.01; s.size *= 1.4; }
      s.bx = 0; s.by = 0; s.bz = 0;
    }
  }

  /**
   * What is left on the pavement afterwards. Named for what it is rather than
   * for the pool it comes out of, because this class already has a pool and it
   * is the array of particles.
   *
   * What is left on the pavement afterwards. A flat disc rather than a
   * billboard, lying where it landed, spreading a little and then staying put
   * for half a minute. This is the part that makes a street look like
   * something happened in it rather than like something is happening in it.
   *
   * @param {number} y the ground height at that point, not the wound height
   */
  stain(x, y, z, size = 1, seconds = 34) {
    // Pools live for most of a minute, so left alone they would fill the pool
    // and starve the tracers. Past a budget the oldest one is taken for the
    // new one, which is the same ring buffer the blast marks use.
    let live = 0;
    let oldest = null;
    for (const p of this.pool) {
      if (!p.alive || p.kind !== 4) continue;
      live++;
      if (!oldest || p.life < oldest.life) oldest = p;
    }
    const s = live >= MAX_POOLS && oldest ? oldest : this._get();
    s.alive = true;
    s.kind = 4;
    s.ax = x; s.ay = y + SURFACE_CLEARANCE; s.az = z;
    s.vx = 0; s.vy = 0; s.vz = 0;
    s.gravity = 0;
    s.maxLife = seconds;
    s.life = seconds;
    s.r = 0.048; s.g = 0.0055; s.b = 0.005;
    s.size = size;
    if (this.comic) { s.r = 0.3; s.g = 0.008; s.b = 0.006; s.size = size * 1.25; }
    // The spread, in bx, and the seed that gives it an edge, in bz. A pool
    // opens out over the first second or so and then stops.
    s.bx = 0;
    s.by = 0;
    s.bz = Math.random() * 100;
    return s;
  }

  /** One drop falling off something in flight. */
  drip(x, y, z) {
    const s = this._get();
    s.alive = true;
    s.kind = 3;
    s.ax = x; s.ay = y; s.az = z;
    s.vx = (Math.random() - 0.5) * 0.8;
    s.vy = -0.4;
    s.vz = (Math.random() - 0.5) * 0.8;
    s.gravity = 14;
    s.maxLife = 0.5 + Math.random() * 0.5;
    s.life = s.maxLife;
    s.r = 0.09; s.g = 0.009; s.b = 0.008;
    if (this.comic) { s.r = 0.6; s.g = 0.012; s.b = 0.01; s.size = (s.size || 0.05) * 1.8; }
    s.size = 0.026 + Math.random() * 0.022;
    s.bx = 0; s.by = 0; s.bz = 0;
  }

  explode(x, y, z) {
    this.flash(x, y, z, 2.4, 1.0, 0.55, 0.2, 0.22);
    this.flash(x, y, z, 1.1, 1.0, 0.86, 0.6, 0.12);
    for (let i = 0; i < 22; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      s.ax = x; s.ay = y; s.az = z;
      s.vx = (Math.random() - 0.5) * 13;
      s.vy = (Math.random() - 0.5) * 13 + 2;
      s.vz = (Math.random() - 0.5) * 13;
      s.gravity = 11;
      s.maxLife = 0.5 + Math.random() * 0.9;
      s.life = s.maxLife;
      s.r = 1.0; s.g = 0.42 + Math.random() * 0.3; s.b = 0.16;
      s.size = 0.05 + Math.random() * 0.07;
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    this.shake = Math.min(1, this.shake + 0.22);
  }

  /**
   * The cloud out of a building coming down. Drawn over the frame rather than
   * added to it, in the pool the blood uses, because dust is darker than the
   * sky and added to it is nothing at all: grey added to a bright afternoon
   * comes out as a brighter afternoon. It rolls out low along the ground,
   * fast at first and then hanging, and a column goes up out of the middle.
   *
   * @param {number} height how tall what came down was
   */
  collapseDust(x, y, z, radius, height) {
    const surge = Math.min(70, 18 + Math.round(radius * 1.1));
    for (let i = 0; i < surge; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 3;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius * 0.7;
      s.ax = x + Math.cos(a) * r;
      s.ay = y + 1.5 + Math.random() * 3;
      s.az = z + Math.sin(a) * r;
      // Against a drag of 2.2 a second this carries about a radius out.
      const speed = radius * (1.4 + Math.random() * 1.8);
      s.vx = Math.cos(a) * speed;
      s.vy = 0.4 + Math.random() * 1.6;
      s.vz = Math.sin(a) * speed;
      s.gravity = -0.12;
      s.maxLife = 8 + Math.random() * 7;
      s.life = s.maxLife;
      const g = 0.5 + Math.random() * 0.12;
      s.r = g * 1.05; s.g = g; s.b = g * 0.9;
      s.size = 3 + radius * (0.16 + Math.random() * 0.18);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    const column = Math.min(30, 8 + Math.round(radius * 0.5));
    for (let i = 0; i < column; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 3;
      s.ax = x + (Math.random() - 0.5) * radius * 0.8;
      s.ay = y + Math.random() * height;
      s.az = z + (Math.random() - 0.5) * radius * 0.8;
      s.vx = (Math.random() - 0.5) * 2;
      s.vy = 1.5 + Math.random() * 3.5;
      s.vz = (Math.random() - 0.5) * 2;
      s.gravity = -0.2;
      s.maxLife = 7 + Math.random() * 6;
      s.life = s.maxLife;
      const g = 0.55 + Math.random() * 0.1;
      s.r = g * 1.04; s.g = g; s.b = g * 0.9;
      s.size = 4 + radius * (0.2 + Math.random() * 0.2);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 2.6);
    for (const s of this.pool) {
      if (!s.alive) continue;
      s.life -= dt;
      if (s.life <= 0) { s.alive = false; continue; }
      if (s.kind === 1 || s.kind === 3) {
        s.vy -= s.gravity * dt;
        s.ax += s.vx * dt;
        s.ay += s.vy * dt;
        s.az += s.vz * dt;
        s.vx *= Math.max(0, 1 - 2.2 * dt);
        s.vz *= Math.max(0, 1 - 2.2 * dt);
      } else if (s.kind === 5) {
        // A beam is redrawn by whoever owns it; it does not drift.
      } else if (s.kind === 4) {
        // A pool opens out and then stops. bx carries how far it has got.
        s.bx = Math.min(1, s.bx + dt * 1.6);
      }
    }
  }

  get list() { return this.pool; }
}
