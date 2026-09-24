// Tracers, impact sparks and muzzle flashes. A fixed pool, updated on the render
// clock because these are presentation rather than simulation.

const MAX = 256;

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
