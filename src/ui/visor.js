// The suit's eyes, for The Hunt: the visor that tags what you look at, and
// Nano Vision that shows what is warm.
//
// The visor (B) is a narrower view with a scan over the middle of it: hold
// something of theirs in the middle long enough and it is tagged, and a tag
// stays on the screen over it wherever it goes, through walls, for as long as
// it lives. Nano Vision (N) turns the city cold and blue and puts every body
// that can be seen up in white and orange, at the cost of the suit's energy.
// Both draw on one canvas over the frame, the way the health bars and the
// cockpit do: no geometry, so nothing to clip.

export const VISOR = {
  fov: 42,             // degrees, while the visor is up
  cone: 0.09,          // how far from the middle (in the screen's half widths) a scan holds
  scan: 0.45,          // seconds held to tag one
  range: 260,          // metres a tag can be put on
  nanoDrain: 6,        // energy a second for Nano Vision
};

/** Where a point lands on the screen, or null behind the camera. */
function project(vp, x, y, z, w, h) {
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (cw <= 0.05) return null;
  return { x: ((cx / cw) * 0.5 + 0.5) * w, y: (0.5 - (cy / cw) * 0.5) * h, w: cw };
}

/** Any of him in sight: the head over a crate counts as much as the chest. */
function sees(o, e) {
  return o.seen(e.x, e.y + e.h * 0.92, e.z) || o.seen(e.x, e.y + e.h * 0.55, e.z);
}

export class Visor {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.up = false;          // B
    this.nano = false;        // N
    this.tags = new Set();    // bodies tagged
    this.scanning = null;     // { body, t }
    this.shown = false;
    this.last = null;
    this.onTag = null;        // fn(body)
  }

  reset() {
    this.up = false;
    this.nano = false;
    this.tags.clear();
    this.scanning = null;
  }

  /**
   * One frame.
   * @param {object} o
   * @param {Float32Array} o.vp the camera's view projection
   * @param {{x,y,z}} o.eye
   * @param {{body:object,x:number,y:number,z:number,h:number,kind:string}[]} o.bodies of theirs, alive
   * @param {(x,y,z)=>boolean} o.seen a line of sight from the eye
   * @param {number} o.dt
   * @param {number} o.time
   * @param {boolean} o.active whether any of it applies (in the suit)
   */
  draw(o) {
    const W = this.canvas.clientWidth || window.innerWidth, H = this.canvas.clientHeight || window.innerHeight;
    const anything = o.active && (this.up || this.nano || this.tags.size > 0);
    if (!anything) {
      if (this.shown) { this.shown = false; this.canvas.classList.add('hidden'); }
      this.last = { tags: this.tags.size, drawnTags: 0, warm: 0, scan: 0 };
      return;
    }
    if (!this.shown) { this.shown = true; this.canvas.classList.remove('hidden'); }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Forget the dead.
    for (const b of [...this.tags]) {
      if (!o.bodies.some((x) => x.body === b)) this.tags.delete(b);
    }

    // Nano Vision: what can be seen is warm.
    let warm = 0;
    if (this.nano) {
      for (const e of o.bodies) {
        const feet = project(o.vp, e.x, e.y, e.z, W, H);
        const head = project(o.vp, e.x, e.y + e.h, e.z, W, H);
        if (!feet || !head) continue;
        if (feet.x < -60 || feet.x > W + 60 || head.y > H || feet.y < 0) continue;
        if (!sees(o, e)) continue;
        warm++;
        const tall = Math.max(6, feet.y - head.y);
        const wide = tall * (e.kind === 'mech' ? 0.7 : e.kind === 'vehicle' ? 1.6 : 0.34);
        const cx = (feet.x + head.x) / 2, cy = (feet.y + head.y) / 2;
        const g = ctx.createRadialGradient(cx, cy - tall * 0.15, 1, cx, cy, Math.max(wide, tall) * 0.62);
        g.addColorStop(0, 'rgba(255, 255, 235, 0.95)');
        g.addColorStop(0.35, 'rgba(255, 196, 70, 0.85)');
        g.addColorStop(0.7, 'rgba(255, 90, 30, 0.5)');
        g.addColorStop(1, 'rgba(255, 60, 20, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, wide * 0.6, tall * 0.56, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The visor's scan: the one nearest the middle, inside the cone, in sight.
    let scan = 0;
    if (this.up) {
      // The frame of it.
      ctx.strokeStyle = 'rgba(150, 230, 255, 0.55)';
      ctx.lineWidth = 1;
      const r = Math.min(W, H) * 0.32;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + sx * r, H / 2 + sy * r * 0.62 - sy * 22);
        ctx.lineTo(W / 2 + sx * r, H / 2 + sy * r * 0.62);
        ctx.lineTo(W / 2 + sx * r - sx * 22, H / 2 + sy * r * 0.62);
        ctx.stroke();
      }
      ctx.font = '600 10px ui-monospace, Menlo, monospace';
      ctx.fillStyle = 'rgba(150, 230, 255, 0.8)';
      ctx.textAlign = 'center';
      ctx.fillText(`VISOR  ${this.tags.size} TAGGED`, W / 2, H / 2 + r * 0.62 + 16);
      let best = null, bestOff = VISOR.cone * W / 2;
      for (const e of o.bodies) {
        if (this.tags.has(e.body)) continue;
        if (Math.hypot(e.x - o.eye.x, e.z - o.eye.z) > VISOR.range) continue;
        const p = project(o.vp, e.x, e.y + e.h * 0.6, e.z, W, H);
        if (!p) continue;
        const off = Math.hypot(p.x - W / 2, p.y - H / 2);
        if (off > bestOff) continue;
        if (!sees(o, e)) continue;
        best = { e, p }; bestOff = off;
      }
      if (best) {
        if (!this.scanning || this.scanning.body !== best.e.body) this.scanning = { body: best.e.body, t: 0 };
        this.scanning.t += o.dt;
        scan = Math.min(1, this.scanning.t / VISOR.scan);
        ctx.strokeStyle = 'rgba(150, 230, 255, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(best.p.x, best.p.y, 16, -Math.PI / 2, -Math.PI / 2 + scan * Math.PI * 2);
        ctx.stroke();
        if (scan >= 1) {
          this.tags.add(best.e.body);
          this.scanning = null;
          if (this.onTag) this.onTag(best.e.body);
        }
      } else {
        this.scanning = null;
      }
    }

    // The tags, over them wherever they are, walls or none.
    let drawnTags = 0;
    for (const e of o.bodies) {
      if (!this.tags.has(e.body)) continue;
      const p = project(o.vp, e.x, e.y + e.h + 0.5, e.z, W, H);
      if (!p) continue;
      const x = Math.max(12, Math.min(W - 12, p.x)), y = Math.max(12, Math.min(H - 12, p.y));
      drawnTags++;
      const pulse = 0.75 + 0.25 * Math.sin(o.time * 5);
      ctx.fillStyle = `rgba(255, 70, 50, ${pulse})`;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y + 7); ctx.lineTo(x - 6, y - 3); ctx.lineTo(x + 6, y - 3);
      ctx.closePath();
      ctx.stroke(); ctx.fill();
      const d = Math.hypot(e.x - o.eye.x, e.z - o.eye.z);
      ctx.font = '600 9px ui-monospace, Menlo, monospace';
      ctx.fillStyle = 'rgba(255, 150, 130, 0.9)';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(d)}`, x, y - 8);
    }
    this.last = { tags: this.tags.size, drawnTags, warm, scan: +scan.toFixed(2) };
  }
}
