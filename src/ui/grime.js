// Crazy reality: the screen as a lens you are looking through, and getting
// dirty.
//
// A blast near you throws dust across it, heaviest on the side it went off
// and in the lower half, where it settles. A hit puts blood on it, from the
// side the shot came from, and blood runs: each splat grows up to three
// drips that crawl down the glass for a few seconds. Fire puts soot round
// the edges. Together they leave a film, a haze in from the edges that is
// brown, or red where there is blood. All of it fades over half a minute or
// so, the way a visor clears, and more of the same on top of it is darker
// rather than more numerous past a point.
//
// It is one canvas over the HUD, like the health bars and the visor: no
// geometry, and nothing drawn at all while it is clean. In a mech it is
// cut to the canopy, since the frame and the dashboard are not glass.

export const GRIME = {
  max: 220,              // splats held at once; the oldest go first
  // And of each kind, so one kind never pushes the others off the glass.
  cap: { dust: 120, blood: 50, soot: 40 },
  life: { dust: 22, blood: 30, soot: 32 },
  // How far a blast reaches the screen, beyond its own radius, in metres.
  dustReach: 70,
  // How fast a drip runs, in screen heights a second, and how far.
  drip: { speed: 0.04, run: 0.34 },
  // The film all of it leaves: a brown haze in from the edges, and a red
  // one where there is blood, as thick as there is dirt, up to this much.
  film: { per: 0.012, most: 0.5, bloodPer: 0.03, bloodMost: 0.35 },
};

/** A small, stable random number from a seed, so a splat keeps its shape. */
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class Grime {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.splats = [];
    this.seed = 1;
    this.enabled = false;
    this.shown = false;
    this.last = { dust: 0, blood: 0, soot: 0, total: 0 };
  }

  clear() { this.splats.length = 0; }

  _add(kind, x, y, r, alpha, extra = {}) {
    if (!this.enabled) return;
    let mine = 0;
    for (const s of this.splats) if (s.kind === kind) mine++;
    if (mine >= GRIME.cap[kind]) this.splats.splice(this.splats.findIndex((s) => s.kind === kind), 1);
    if (this.splats.length >= GRIME.max) this.splats.shift();
    this.splats.push({ kind, x, y, r, alpha, age: 0, life: GRIME.life[kind] * (0.8 + hash(this.seed) * 0.4), seed: this.seed++, ...extra });
  }

  /**
   * A blast: dust over the screen, more the closer and the bigger.
   * @param {number} strength 0 to 1
   * @param {number} side -1 left, 0 ahead, 1 right: where it went off
   */
  dust(strength, side = 0) {
    if (!this.enabled || strength <= 0.02) return;
    const n = Math.round(12 + strength * 40);
    for (let i = 0; i < n; i++) {
      const a = hash(this.seed * 1.7), b = hash(this.seed * 2.3), c = hash(this.seed * 3.1);
      // Weighted to the side it came from and to the lower half.
      const x = Math.min(0.98, Math.max(0.02, 0.5 + side * 0.25 + (a - 0.5) * 1.1));
      const y = Math.min(0.98, 0.2 + Math.sqrt(b) * 0.82);
      this._add('dust', x, y, 0.035 + c * 0.1 * (0.5 + strength), Math.min(1, 0.55 + strength * 0.45));
    }
  }

  /**
   * Blood on the glass: a splat or a few, from the side it came from, each
   * with a drip that runs.
   * @param {number} strength 0 to 1
   * @param {number} side -1 left, 0 ahead, 1 right
   */
  blood(strength, side = 0) {
    if (!this.enabled || strength <= 0.02) return;
    const n = 2 + Math.floor(strength * 4);
    for (let i = 0; i < n; i++) {
      const a = hash(this.seed * 1.3), b = hash(this.seed * 2.9), c = hash(this.seed * 4.7);
      const x = Math.min(0.97, Math.max(0.03, 0.5 + side * 0.3 + (a - 0.5) * 0.8));
      const y = 0.08 + b * 0.72;
      const drips = [];
      const k = 1 + Math.floor(c * 3);
      for (let d = 0; d < k; d++) drips.push({ dx: (hash(this.seed + d * 9.1) - 0.5) * 0.9, run: 0 });
      this._add('blood', x, y, 0.016 + c * 0.05 * (0.6 + strength), Math.min(1, 0.6 + strength * 0.35), { drips });
    }
  }

  /** Soot round the edges, from fire close by. */
  soot(strength) {
    if (!this.enabled || strength <= 0.02) return;
    for (let i = 0; i < 2; i++) {
      const a = hash(this.seed * 5.3), b = hash(this.seed * 6.1);
      // On an edge: which one, and where along it.
      const edge = Math.floor(a * 4);
      const t = b;
      const x = edge === 0 ? 0.02 : edge === 1 ? 0.98 : t;
      const y = edge === 2 ? 0.03 : edge === 3 ? 0.97 : t;
      this._add('soot', x, y, 0.07 + strength * 0.1, Math.min(1, 0.4 + strength * 0.45));
    }
  }

  /** How dirty it is, for the tests: how much of each, by weight. */
  get dirt() {
    const out = { dust: 0, blood: 0, soot: 0, total: 0 };
    for (const s of this.splats) {
      const w = s.alpha * Math.max(0, 1 - s.age / s.life);
      out[s.kind] += w;
      out.total += w;
    }
    return out;
  }

  /**
   * One frame: age what is there and draw it.
   * @param {number} dt seconds
   * @param {boolean} active whether it may show at all (in the street, cheat on)
   * @param {((ctx, W:number, H:number)=>void)|null} clip where the glass is,
   *   when it is not the whole screen: in a mech, the canopy and not the
   *   frame or the dashboard
   */
  draw(dt, active, clip = null) {
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.age += dt;
      if (s.drips) for (const d of s.drips) d.run = Math.min(GRIME.drip.run, d.run + dt * GRIME.drip.speed * (0.6 + hash(s.seed) * 0.8));
      if (s.age >= s.life) this.splats.splice(i, 1);
    }
    if (!this.canvas) { this.last = this.dirt; return; }
    const show = active && this.enabled && this.splats.length > 0;
    if (!show) {
      if (this.shown) {
        this.shown = false;
        this.canvas.classList.add('hidden');
      }
      this.last = this.dirt;
      return;
    }
    if (!this.shown) { this.shown = true; this.canvas.classList.remove('hidden'); }
    const W = this.canvas.clientWidth || window.innerWidth, H = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (clip) clip(ctx, W, H);
    const S = Math.min(W, H);
    for (const s of this.splats) {
      const fade = Math.max(0, 1 - s.age / s.life);
      // Fades in over a fraction of a second rather than appearing.
      const a = s.alpha * fade * Math.min(1, s.age * 8 + 0.3);
      const x = s.x * W, y = s.y * H, r = s.r * S;
      if (s.kind === 'dust') {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(196, 174, 138, ${a * 0.75})`);
        g.addColorStop(0.5, `rgba(176, 154, 120, ${a * 0.4})`);
        g.addColorStop(1, 'rgba(160, 140, 108, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        // And grit in it: a few hard specks.
        ctx.fillStyle = `rgba(60, 50, 38, ${a * 0.85})`;
        for (let k = 0; k < 9; k++) {
          const px = x + (hash(s.seed * 11 + k) - 0.5) * r * 1.6;
          const py = y + (hash(s.seed * 13 + k) - 0.5) * r * 1.6;
          const sz = 1 + hash(s.seed * 7 + k) * 2;
          ctx.fillRect(px, py, sz, sz);
        }
      } else if (s.kind === 'blood') {
        // A ragged blob: a ring of lobes round a middle.
        ctx.fillStyle = `rgba(120, 6, 10, ${a})`;
        ctx.beginPath();
        const lobes = 9;
        for (let k = 0; k <= lobes; k++) {
          const t = (k / lobes) * Math.PI * 2;
          const rr = r * (0.7 + hash(s.seed * 17 + k) * 0.6);
          const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        // Droplets thrown round it.
        for (let k = 0; k < 6; k++) {
          const t = hash(s.seed * 19 + k) * Math.PI * 2;
          const d = r * (1.2 + hash(s.seed * 23 + k) * 1.4);
          ctx.beginPath();
          ctx.arc(x + Math.cos(t) * d, y + Math.sin(t) * d, 1 + hash(s.seed * 29 + k) * r * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
        // The runs, darker as they go.
        if (s.drips) {
          ctx.strokeStyle = `rgba(100, 4, 8, ${a * 0.9})`;
          ctx.lineCap = 'round';
          for (const d of s.drips) {
            if (d.run <= 0.002) continue;
            const sx = x + d.dx * r;
            ctx.lineWidth = Math.max(1.5, r * 0.18);
            ctx.beginPath();
            ctx.moveTo(sx, y);
            ctx.lineTo(sx + d.dx * 2, y + d.run * H);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(sx + d.dx * 2, y + d.run * H, Math.max(1.5, r * 0.14), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // A wet highlight, so it reads as on the glass and not in the world.
        ctx.fillStyle = `rgba(255, 190, 190, ${a * 0.18})`;
        ctx.beginPath();
        ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(18, 16, 14, ${a})`);
        g.addColorStop(0.6, `rgba(24, 22, 20, ${a * 0.55})`);
        g.addColorStop(1, 'rgba(30, 28, 26, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // The film the lot of it leaves on the glass, heaviest at the edges.
    const dirt = this.dirt;
    const F = GRIME.film;
    const haze = Math.min(F.most, dirt.total * F.per);
    const red = Math.min(F.bloodMost, dirt.blood * F.bloodPer);
    if (haze > 0.01 || red > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2, S * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, 'rgba(120, 100, 70, 0)');
      g.addColorStop(1, `rgba(${Math.round(110 + 60 * (red / (haze + red + 1e-6)))}, ${Math.round(88 - 60 * (red / (haze + red + 1e-6)))}, 60, ${Math.max(haze, red)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    this.last = dirt;
  }
}
