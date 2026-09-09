// The minimap, drawn on a 2D canvas from the same OSM road data the world is
// built from, plus the water outlines and the landmark pins.

const CLASS_STYLE = {
  motorway: ['#6c6459', 3.2],
  trunk: ['#6c6459', 3.0],
  primary: ['#635c52', 2.8],
  secondary: ['#575249', 2.2],
  tertiary: ['#4c483f', 1.8],
  residential: ['#413e37', 1.5],
  unclassified: ['#413e37', 1.4],
  living_street: ['#3b3831', 1.3],
  service: ['#343128', 1.0],
  pedestrian: ['#4a463c', 1.6],
};

export class Minimap {
  constructor(canvas, world, landmarks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.landmarks = landmarks;
    this.scale = 0.16;          // pixels per metre at the normal size
    this.big = false;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this._sizeCanvas();
  }

  _sizeCanvas() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(64, Math.round(r.width * this.dpr));
    const h = Math.max(64, Math.round(r.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  toggle() {
    this.big = !this.big;
    this.canvas.classList.toggle('big', this.big);
    requestAnimationFrame(() => this._sizeCanvas());
  }

  draw(px, pz, yaw, found) {
    this._sizeCanvas();
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2;
    const scale = (this.big ? 0.10 : 0.16) * this.dpr;
    const reach = Math.hypot(W, H) / 2 / scale;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0e1013';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (!this.big) {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(cx, cy) - 1, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.translate(cx, cy);
    // North up on the big map, heading up on the small one.
    if (!this.big) ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-px, -pz);

    const m = this.world.manifest;

    // Water first.
    ctx.fillStyle = '#16303c';
    ctx.strokeStyle = '#16303c';
    for (const w of (m.waterOutlines || [])) {
      ctx.beginPath();
      for (let i = 0; i < w.length; i += 2) {
        if (i === 0) ctx.moveTo(w[0], w[1]); else ctx.lineTo(w[i], w[i + 1]);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Parks.
    ctx.fillStyle = '#182415';
    for (const g of (m.greenOutlines || [])) {
      ctx.beginPath();
      for (let i = 0; i < g.length; i += 2) {
        if (i === 0) ctx.moveTo(g[0], g[1]); else ctx.lineTo(g[i], g[i + 1]);
      }
      ctx.closePath();
      ctx.fill();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of m.roadLines) {
      const pts = r.pts;
      // Cheap reject: skip anything whose first point is far away.
      if (Math.abs(pts[0] - px) > reach + 400 && Math.abs(pts[1] - pz) > reach + 400) continue;
      const style = CLASS_STYLE[r.cls] || CLASS_STYLE.residential;
      ctx.strokeStyle = style[0];
      ctx.lineWidth = style[1] / scale * this.dpr * 0.55;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
    }

    // Landmark pins.
    for (const l of this.landmarks.list) {
      const seen = found.has(l.key);
      ctx.fillStyle = seen ? '#e2c98d' : 'rgba(226,201,141,0.32)';
      ctx.beginPath();
      ctx.arc(l.x, l.z, 4.5 / scale * this.dpr * 0.5, 0, Math.PI * 2);
      ctx.fill();
      if (this.big) {
        ctx.save();
        ctx.translate(l.x, l.z);
        ctx.scale(1 / scale, 1 / scale);
        ctx.fillStyle = seen ? '#e2c98d' : 'rgba(200,195,185,0.55)';
        ctx.font = `${11 * this.dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(l.name, 8 * this.dpr, 4 * this.dpr);
        ctx.restore();
      }
    }
    ctx.restore();

    // The player, always at the centre, always pointing up on the small map.
    ctx.save();
    ctx.translate(cx, cy);
    if (this.big) ctx.rotate(-yaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.2 * this.dpr;
    const s = 6 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.66, s * 0.7);
    ctx.lineTo(0, s * 0.34);
    ctx.lineTo(-s * 0.66, s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North arrow.
    ctx.save();
    ctx.translate(cx, cy);
    if (!this.big) ctx.rotate(yaw);
    const r = Math.min(cx, cy) - 10 * this.dpr;
    ctx.fillStyle = '#e2c98d';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(4 * this.dpr, -r + 9 * this.dpr);
    ctx.lineTo(-4 * this.dpr, -r + 9 * this.dpr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
