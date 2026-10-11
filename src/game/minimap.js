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

// What each kind of pad shows as on the map. The same five colours the pads
// themselves glow in, so the map and the street agree.
const PAD_COLOUR = {
  ammo: '#e8a83a',
  health: '#e8574a',
  quad: '#5a86ff',
  ultra: '#ffc64c',
  overload: '#6fe08a',
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
    // Set while a warhead is being aimed: where the cursor is, how far the
    // blast reaches, and whether that point is allowed.
    this.aim = null;
    // Enlarged, the map can be zoomed and pushed about. One is the whole city
    // fitted to the canvas; above that it is a window on it, and centre says
    // where that window is.
    this.zoom = 1;
    this.centre = null;
    // The weapons free zones, so the map can show where nothing may be aimed.
    this.sanctuaries = [];
    // The transform the last draw used, so a click can be turned back into a
    // place in the city.
    this._view = null;
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

  /**
   * @param {{x:number,z:number}|null} at where to open it, usually the player.
   *   The city is twelve kilometres across and a map of all of it at once is a
   *   diagram, not a map, so it opens on a few streets around you and zooms
   *   out from there.
   */
  toggle(at = null) {
    this.big = !this.big;
    if (this.big && at) {
      this.centre = { x: at.x, z: at.z };
      if (this.zoom <= 1) this.zoom = 5;
    }
    this.canvas.classList.toggle('big', this.big);
    requestAnimationFrame(() => this._sizeCanvas());
  }

  /**
   * @param {number} px @param {number} pz where you are
   * @param {number} yaw heading, radians
   * @param {Set} found the landmarks you have stood in front of
   * @param {Array} pads live pickup pads to mark, if any
   */
  draw(px, pz, yaw, found, pads = null) {
    this._sizeCanvas();
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2;
    const wm = this.world;
    // Enlarged, the map shows the whole playable box, north up, fitted to the
    // canvas. Small, it is a heading up window around the player.
    const fit = Math.min(W / (wm.maxX - wm.minX), H / (wm.maxZ - wm.minZ)) * 0.94;
    const scale = this.big ? fit * this.zoom : 0.16 * this.dpr;
    if (this.big && this.centre) this.clampCentre(W, H, scale);
    const originX = this.big ? (this.centre ? this.centre.x : (wm.minX + wm.maxX) / 2) : px;
    const originZ = this.big ? (this.centre ? this.centre.z : (wm.minZ + wm.maxZ) / 2) : pz;
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
    ctx.translate(-originX, -originZ);

    const m = this.world.manifest;

    // The districts, under everything, on the big map only. Berlin inside the
    // Ring is twenty four of them and only a few are ever in memory, so the
    // ones that are not say so rather than reading as empty ground.
    if (this.big) this.drawDistricts(ctx, scale);

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
      if (Math.abs(pts[0] - originX) > reach + 400 && Math.abs(pts[1] - originZ) > reach + 400) continue;
      const style = CLASS_STYLE[r.cls] || CLASS_STYLE.residential;
      ctx.strokeStyle = style[0];
      ctx.lineWidth = style[1] / scale * this.dpr * 0.55;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
    }

    // The weapons free zone, drawn under everything that can be shot at. On
    // the targeting map it also carries the ring the blast may not cross, so
    // a refused target is a thing you can see coming rather than a message
    // you get after clicking.
    for (const z of this.sanctuaries) {
      ctx.fillStyle = 'rgba(226, 201, 141, 0.07)';
      ctx.beginPath();
      ctx.arc(z.x, z.z, z.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(226, 201, 141, 0.45)';
      ctx.lineWidth = 1.4 / scale * this.dpr;
      ctx.stroke();
      if (this.aim) {
        ctx.strokeStyle = 'rgba(226, 112, 90, 0.35)';
        ctx.setLineDash([6 / scale * this.dpr, 7 / scale * this.dpr]);
        ctx.beginPath();
        ctx.arc(z.x, z.z, z.radius + this.aim.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Pickup pads, under the landmark pins because a landmark is the thing you
    // came for and a crate is the thing you pass on the way.
    if (pads && pads.length) {
      const r = (this.big ? 2.2 : 3.2) / scale * this.dpr * 0.5;
      for (const p of pads) {
        if (!this.big && Math.hypot(p.x - px, p.z - pz) > reach) continue;
        ctx.fillStyle = PAD_COLOUR[p.kind] || '#cfcabf';
        ctx.beginPath();
        ctx.arc(p.x, p.z, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Landmark pins.
    for (const l of this.landmarks.list) {
      const seen = found.has(l.key);
      ctx.fillStyle = seen ? '#e2c98d' : 'rgba(226,201,141,0.32)';
      ctx.beginPath();
      ctx.arc(l.x, l.z, (this.big ? 3.6 : 4.5) / scale * this.dpr * 0.5, 0, Math.PI * 2);
      ctx.fill();
      // Zoomed out to the whole city the names of eleven landmarks within a
      // kilometre of each other are one illegible blob, so below about a
      // pixel every fifteen metres they are left as dots.
      if (this.big && scale > 0.065 * this.dpr) {
        ctx.save();
        ctx.translate(l.x, l.z);
        ctx.scale(1 / scale, 1 / scale);
        ctx.fillStyle = seen ? '#e2c98d' : 'rgba(200,195,185,0.55)';
        ctx.font = `${11 * this.dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.strokeStyle = 'rgba(6,7,9,0.85)';
        ctx.lineWidth = 3 * this.dpr;
        ctx.strokeText(l.name, 7 * this.dpr, 4 * this.dpr);
        ctx.fillText(l.name, 7 * this.dpr, 4 * this.dpr);
        ctx.restore();
      }
    }
    ctx.restore();

    // The player: at the centre on the small map, at their real position on the
    // enlarged one.
    ctx.save();
    if (this.big) {
      ctx.translate(cx + (px - originX) * scale, cy + (pz - originZ) * scale);
      ctx.rotate(-yaw);
    } else {
      ctx.translate(cx, cy);
    }
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

    // The aiming reticle, while a warhead is being put somewhere. Drawn in
    // world space so that the ring really is the blast radius on the map and
    // not a fixed number of pixels that lies about the scale.
    if (this.aim) {
      ctx.save();
      ctx.translate(cx, cy);
      if (!this.big) ctx.rotate(yaw);
      ctx.scale(scale, scale);
      ctx.translate(-originX, -originZ);
      const ok = this.aim.allowed !== false;
      ctx.strokeStyle = ok ? 'rgba(226, 112, 90, 0.9)' : 'rgba(120, 120, 128, 0.7)';
      ctx.lineWidth = 2 / scale * this.dpr;
      ctx.beginPath();
      ctx.arc(this.aim.x, this.aim.z, this.aim.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([8 / scale * this.dpr, 8 / scale * this.dpr]);
      ctx.beginPath();
      ctx.arc(this.aim.x, this.aim.z, this.aim.radius * 1.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const t = 14 / scale * this.dpr;
      ctx.beginPath();
      ctx.moveTo(this.aim.x - t, this.aim.z); ctx.lineTo(this.aim.x + t, this.aim.z);
      ctx.moveTo(this.aim.x, this.aim.z - t); ctx.lineTo(this.aim.x, this.aim.z + t);
      ctx.stroke();
      ctx.restore();
    }

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

    this._view = { cx, cy, scale, originX, originZ, big: this.big };
  }

  /**
   * Keeps the window over the city. Zoomed out far enough to see all of it on
   * an axis, that axis stays centred; zoomed in, the edge of the city is as
   * far as the window may go.
   */
  clampCentre(W, H, scale) {
    const wm = this.world;
    const halfW = W / 2 / scale, halfH = H / 2 / scale;
    const midX = (wm.minX + wm.maxX) / 2, midZ = (wm.minZ + wm.maxZ) / 2;
    const roomX = (wm.maxX - wm.minX) / 2 - halfW;
    const roomZ = (wm.maxZ - wm.minZ) / 2 - halfH;
    this.centre.x = roomX <= 0 ? midX
      : Math.min(midX + roomX, Math.max(midX - roomX, this.centre.x));
    this.centre.z = roomZ <= 0 ? midZ
      : Math.min(midZ + roomZ, Math.max(midZ - roomZ, this.centre.z));
  }

  /**
   * The district boxes, their names, and which of them are in memory.
   *
   * @param {CanvasRenderingContext2D} ctx in world space already
   * @param {number} scale canvas pixels per metre, for hairlines and text
   */
  drawDistricts(ctx, scale) {
    const list = this.world.catalogue || [];
    if (!list.length) return;
    ctx.save();
    ctx.lineWidth = 1 / scale;
    for (const d of list) {
      const b = d.bounds;
      const here = this.world.loaded(d.id);
      ctx.fillStyle = here ? 'rgba(26,32,38,0.55)' : 'rgba(16,18,21,0.75)';
      ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
      ctx.strokeStyle = here ? 'rgba(120,150,170,0.35)' : 'rgba(90,96,104,0.22)';
      ctx.strokeRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    }
    ctx.restore();
    // Names, upright and at a readable size whatever the zoom is.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2;
    const originX = this.centre ? this.centre.x : (this.world.minX + this.world.maxX) / 2;
    const originZ = this.centre ? this.centre.z : (this.world.minZ + this.world.maxZ) / 2;
    ctx.font = `${Math.round(11 * this.dpr)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of list) {
      const b = d.bounds;
      const mx = cx + ((b.minX + b.maxX) / 2 - originX) * scale;
      const mz = cy + ((b.minZ + b.maxZ) / 2 - originZ) * scale;
      if (mx < -60 || mz < -20 || mx > W + 60 || mz > H + 20) continue;
      const here = this.world.loaded(d.id);
      ctx.fillStyle = here ? 'rgba(206,214,222,0.72)' : 'rgba(150,156,164,0.40)';
      ctx.fillText(String(d.name || d.id).toUpperCase(), mx, mz);
    }
    ctx.restore();
  }

  /**
   * Zooms about a point on the canvas, so whatever is under the cursor stays
   * under it. That is the only zoom anybody can aim with.
   *
   * @param {number} factor multiplied into the current zoom
   */
  zoomAt(clientX, clientY, factor) {
    if (!this.big || !this._view) return;
    const before = this.worldAt(clientX, clientY);
    this.zoom = Math.min(14, Math.max(1, this.zoom * factor));
    if (!this.centre) {
      this.centre = {
        x: (this.world.minX + this.world.maxX) / 2,
        z: (this.world.minZ + this.world.maxZ) / 2,
      };
    }
    if (!before) return;
    // Redraw with the new zoom so the transform is current, then push the
    // window by however far the point under the cursor moved.
    const v = this._view;
    const fit = Math.min(this.canvas.width / (this.world.maxX - this.world.minX),
      this.canvas.height / (this.world.maxZ - this.world.minZ)) * 0.94;
    const scale = fit * this.zoom;
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (this.canvas.width / rect.width);
    const py = (clientY - rect.top) * (this.canvas.height / rect.height);
    this.centre.x = before.x - (px - v.cx) / scale;
    this.centre.z = before.z - (py - v.cy) / scale;
  }

  /** Drags the window by a movement in canvas pixels. */
  panBy(dxPixels, dyPixels) {
    if (!this.big || !this._view) return;
    if (!this.centre) {
      this.centre = {
        x: (this.world.minX + this.world.maxX) / 2,
        z: (this.world.minZ + this.world.maxZ) / 2,
      };
    }
    const rect = this.canvas.getBoundingClientRect();
    const k = rect.width ? this.canvas.width / rect.width : 1;
    this.centre.x -= dxPixels * k / this._view.scale;
    this.centre.z -= dyPixels * k / this._view.scale;
  }

  /** Back to the whole city. */
  resetView() {
    this.zoom = 1;
    this.centre = null;
  }

  /**
   * A point on the canvas, in metres. Only the north up view is supported,
   * because the heading up one is rotated by whichever way you happen to be
   * looking and nothing wants to click on that.
   *
   * @param {number} clientX @param {number} clientY page coordinates
   * @returns {{x:number,z:number}|null}
   */
  worldAt(clientX, clientY) {
    const v = this._view;
    if (!v || !v.big) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // The canvas is drawn at device resolution and laid out in CSS pixels, so
    // a click has to be taken through both.
    const px = (clientX - rect.left) * (this.canvas.width / rect.width);
    const py = (clientY - rect.top) * (this.canvas.height / rect.height);
    return {
      x: (px - v.cx) / v.scale + v.originX,
      z: (py - v.cy) / v.scale + v.originZ,
    };
  }
}
