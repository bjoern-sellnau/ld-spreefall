// Tracers, impact sparks and muzzle flashes. A fixed pool, updated on the render
// clock because these are presentation rather than simulation.

// The sparks are additive billboards drawn in one instanced call, so the only
// real cost of a bigger pool is the buffer. A warhead alone wants a hundred
// and fifty of them, and starving the rest of the game of tracers while one
// goes off would be a poor trade.
const MAX = 384;

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
   * Blood off a hit. Dark, heavy, and gone quickly, with a mist that hangs for
   * a moment where the round went in.
   *
   * @param {number} amount a multiplier from the gore settings
   */
  blood(x, y, z, nx, ny, nz, amount = 1) {
    const n = Math.min(40, Math.round(7 * amount));
    for (let i = 0; i < n; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      s.ax = x; s.ay = y; s.az = z;
      const spread = 3.2 * Math.min(2.2, amount);
      s.vx = nx * 4 + (Math.random() - 0.5) * spread;
      s.vy = ny * 4 + (Math.random() - 0.5) * spread + 1.6;
      s.vz = nz * 4 + (Math.random() - 0.5) * spread;
      s.gravity = 16;
      s.maxLife = 0.3 + Math.random() * 0.45;
      s.life = s.maxLife;
      s.r = 0.42; s.g = 0.025; s.b = 0.02;
      s.size = 0.022 + Math.random() * 0.035;
      s.bx = 0; s.by = 0; s.bz = 0;
    }
    // The mist, which is what reads at twenty metres when the drops do not.
    const mist = Math.min(8, Math.round(2 * amount));
    for (let i = 0; i < mist; i++) {
      const s = this._get();
      s.alive = true;
      s.kind = 1;
      s.ax = x + (Math.random() - 0.5) * 0.3;
      s.ay = y + (Math.random() - 0.5) * 0.3;
      s.az = z + (Math.random() - 0.5) * 0.3;
      s.vx = nx * 1.2; s.vy = ny * 1.2 + 0.4; s.vz = nz * 1.2;
      s.gravity = 3.5;
      s.maxLife = 0.22 + Math.random() * 0.2;
      s.life = s.maxLife;
      s.r = 0.34; s.g = 0.03; s.b = 0.03;
      s.size = 0.12 + Math.random() * 0.16 * Math.min(2.4, amount);
      s.bx = 0; s.by = 0; s.bz = 0;
    }
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

  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 2.6);
    for (const s of this.pool) {
      if (!s.alive) continue;
      s.life -= dt;
      if (s.life <= 0) { s.alive = false; continue; }
      if (s.kind === 1) {
        s.vy -= s.gravity * dt;
        s.ax += s.vx * dt;
        s.ay += s.vy * dt;
        s.az += s.vz * dt;
        s.vx *= Math.max(0, 1 - 2.2 * dt);
        s.vz *= Math.max(0, 1 - 2.2 * dt);
      }
    }
  }

  get list() { return this.pool; }
}
