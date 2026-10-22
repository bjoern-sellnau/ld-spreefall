// The line a grenade will fly, drawn over the view while one is in your hand,
// and a ring the size of its blast where it first comes down. Brighter and
// warmer while the right button is held, which is the harder throw.
//
// A canvas over the frame like the rest of the HUD: the arc is worked out in
// the world (throwarc.js) and only projected here.

import { project } from './cockpit.js';

export class ArcView {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.shown = false;
    this.last = null;      // what was drawn, for the checks
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.last = null;
    if (this.canvas) this.canvas.classList.add('hidden');
  }

  /**
   * @param {{points:number[][], hit:object|null}} arc
   * @param {Float32Array} vp view projection
   * @param {{strong:boolean, radius:number}} o
   */
  draw(arc, vp, o) {
    if (!this.canvas) return;
    if (!this.shown) { this.shown = true; this.canvas.classList.remove('hidden'); }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.canvas.clientWidth || window.innerWidth, H = this.canvas.clientHeight || window.innerHeight;
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const colour = o.strong ? '255, 150, 70' : '255, 226, 160';
    // Dots along the arc, every few steps, fading in from the hand so the
    // near end does not sit on top of the weapon.
    let dots = 0;
    const pts = arc.points;
    for (let i = 3; i < pts.length; i += 2) {
      const [x, y, z] = pts[i];
      const p = project(vp, x, y, z, W, H);
      if (!p) continue;
      const a = Math.min(1, (i - 2) / 8) * (o.strong ? 0.95 : 0.75);
      ctx.fillStyle = `rgba(${colour}, ${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, o.strong ? 3.2 : 2.6, 0, Math.PI * 2);
      ctx.fill();
      dots++;
    }
    // Where it comes down, and how far the blast reaches there.
    let ring = false;
    if (arc.hit && o.radius > 0) {
      const { x, y, z } = arc.hit;
      ctx.strokeStyle = `rgba(${colour}, ${o.strong ? 0.95 : 0.8})`;
      ctx.lineWidth = o.strong ? 2.4 : 1.8;
      ctx.beginPath();
      let first = true;
      for (let k = 0; k <= 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        const p = project(vp, x + Math.cos(a) * o.radius, y + 0.15, z + Math.sin(a) * o.radius, W, H);
        if (!p) { first = true; continue; }
        if (first) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        first = false;
        ring = true;
      }
      ctx.stroke();
      const c = project(vp, x, y + 0.15, z, W, H);
      if (c) {
        ctx.fillStyle = `rgba(${colour}, 0.9)`;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.last = { dots, ring, strong: !!o.strong, hit: arc.hit };
  }
}
