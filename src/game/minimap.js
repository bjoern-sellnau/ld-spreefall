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

// How much of the city the enlarged map opens on, in metres across the
// canvas. The whole of Berlin at once is a diagram rather than a map: it
// opens on the streets you are standing in, and the wheel takes it out from
// there.
const OPEN_SPAN = 700;

// As far in as the wheel goes, in metres across the canvas. A ceiling in
// zoom units cannot be written down here: a zoom is a ratio against the
// whole city fitted to the canvas, and the city is forty six kilometres
// across, so the same number means a street in one place and a district in
// another.
const TIGHTEST_SPAN = 140;

// Which streets get their name written first when two labels want the same
// patch of screen. A main road beats a side street, which is how a paper map
// does it as well.
const LABEL_RANK = {
  motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
  pedestrian: 5, residential: 6, unclassified: 7, living_street: 8, service: 9,
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
    // Metres across that the map should fit while it is in span mode, which
    // is how it opens. The zoom is worked out from this on every draw until
    // the wheel is touched, because the canvas is still its small size on
    // the first frame after the map is opened and a zoom worked out against
    // that one is wrong by whatever the two sizes differ by.
    this.openSpan = 0;
    this.across = 0;              // metres across the window, set by draw
    this.centre = null;
    // How many street names the last draw managed to fit on, which is a
    // number the tests read.
    this.labelsDrawn = 0;
    // As far in as the wheel may go on this canvas, worked out on each draw
    // from TIGHTEST_SPAN.
    this.maxZoom = 40;
    // The memorial's force field, so the map shows what nothing can damage.
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
      // Held as a span rather than as a zoom until the wheel is touched: see
      // the field.
      if (this.zoom <= 1) this.openSpan = OPEN_SPAN;
    }
    this.canvas.classList.toggle('big', this.big);
    requestAnimationFrame(() => this._sizeCanvas());
  }

  /**
   * @param {number} px @param {number} pz where you are
   * @param {number} yaw heading, radians
   * @param {Set} found the landmarks you have stood in front of
   * @param {Array} pads live pickup pads to mark, if any
   * @param {Array} rides vehicles standing empty, if any
   */
  draw(px, pz, yaw, found, pads = null, rides = null) {
    this._sizeCanvas();
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2;
    const wm = this.world;
    // Enlarged, the map shows the whole playable box, north up, fitted to the
    // canvas. Small, it is a heading up window around the player.
    const fit = Math.min(W / (wm.maxX - wm.minX), H / (wm.maxZ - wm.minZ)) * 0.94;
    // In span mode the zoom follows the canvas, so the map shows the same
    // piece of city whatever size it has been given.
    // How far the wheel may go, worked out against this canvas and this city.
    this.maxZoom = Math.max(2, (W / TIGHTEST_SPAN) / fit);
    if (this.big && this.openSpan) {
      this.zoom = Math.min(this.maxZoom, Math.max(1, (W / this.openSpan) / fit));
    }
    const scale = this.big ? fit * this.zoom : 0.16 * this.dpr;
    // What the window is actually showing, in metres, taken from the same
    // scale the drawing uses rather than worked out a second time: the two
    // disagreed by thirty kilometres when they were computed separately.
    this.across = W / scale;
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
    if (this.big) {
      this.drawDistrictBoxes(ctx, scale);
      this.drawSketches(ctx, scale);
      // Names last of the three, so a street drawn across the city does not
      // go through the label of the district it belongs to.
      this.drawDistrictNames(ctx, scale);
    }

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

    // The memorial's force field, drawn under everything that can be shot
    // at. Nothing is refused there any more; the circle is where a blast
    // does the place no harm.
    for (const z of this.sanctuaries) {
      ctx.fillStyle = 'rgba(110, 190, 255, 0.08)';
      ctx.beginPath();
      ctx.arc(z.x, z.z, z.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(130, 205, 255, 0.55)';
      ctx.lineWidth = 1.4 / scale * this.dpr;
      ctx.stroke();
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

    // Vehicles standing empty. A square rather than a dot, because the thing
    // a player is asking the map is not where something is but what it is,
    // and the answer here is always the same: something you can get into.
    if (rides && rides.length) {
      const r = (this.big ? 2.6 : 3.8) / scale * this.dpr * 0.5;
      ctx.fillStyle = '#7fd6c9';
      for (const v of rides) {
        if (!this.big && Math.hypot(v.x - px, v.z - pz) > reach) continue;
        ctx.fillRect(v.x - r, v.z - r, r * 2, r * 2);
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

    // The street names, in screen pixels rather than in metres: text that is
    // scaled with the map is either a hairline or a billboard, and never the
    // size you can read.
    this.drawStreetNames(W, H, scale, originX, originZ);

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
      // Ultra plasma's way in: an arrow from the side it comes from, its
      // shaft the longer the flatter it comes in, its point on the circle.
      if (this.aim.bearing !== undefined) {
        const b = this.aim.bearing * Math.PI / 180;
        const sx = Math.sin(b), sz = -Math.cos(b);
        const flat = Math.min(75, this.aim.tilt || 0) / 75;
        const tip = this.aim.radius + 6 / scale * this.dpr;
        const len = (24 + 90 * flat) / scale * this.dpr;
        const x0 = this.aim.x + sx * (tip + len), z0 = this.aim.z + sz * (tip + len);
        const x1 = this.aim.x + sx * tip, z1 = this.aim.z + sz * tip;
        const head = 10 / scale * this.dpr;
        ctx.lineWidth = 3 / scale * this.dpr;
        ctx.beginPath();
        ctx.moveTo(x0, z0); ctx.lineTo(x1 + sx * head * 0.5, z1 + sz * head * 0.5);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(x1, z1);
        ctx.lineTo(x1 + sx * head - sz * head * 0.6, z1 + sz * head + sx * head * 0.6);
        ctx.lineTo(x1 + sx * head + sz * head * 0.6, z1 + sz * head - sx * head * 0.6);
        ctx.closePath();
        ctx.fill();
      }
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
  /**
   * The name of every street that there is room for, lying along the road it
   * belongs to. Only on the enlarged map, and only once it is zoomed in far
   * enough that the names are worth reading: the whole city at once is one
   * illegible grey smear, so below about a metre to the pixel they are left
   * off and the map is roads and districts as before.
   *
   * A label is kept only if nothing has already been written where it would
   * go, measured as a box around the text, and the main roads are offered
   * their places first. That is the whole of the layout: a map that writes
   * every name it has is a map with no names on it.
   *
   * @param {number} W @param {number} H the canvas, in device pixels
   * @param {number} scale device pixels per metre
   * @param {number} originX @param {number} originZ what is at the middle
   */
  drawStreetNames(W, H, scale, originX, originZ) {
    this.labelsDrawn = 0;
    const all = this.world.manifest.streets;
    if (!this.big || !all || !all.length) return;
    if (scale < 0.9 * this.dpr) return;
    const ctx = this.ctx;
    const cx = W / 2, cy = H / 2;
    // Nearest first and main roads before side streets, so the names that go
    // on are the ones you would have asked for.
    const order = [];
    const halfW = W / 2 / scale + 60, halfH = H / 2 / scale + 60;
    for (const l of all) {
      if (Math.abs(l.x - originX) > halfW || Math.abs(l.z - originZ) > halfH) continue;
      order.push(l);
    }
    order.sort((a, b) => (LABEL_RANK[a.c] ?? 9) - (LABEL_RANK[b.c] ?? 9));

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed = [];
    for (const l of order) {
      const rank = LABEL_RANK[l.c] ?? 9;
      const size = (rank <= 2 ? 12 : rank <= 4 ? 11 : 10) * this.dpr;
      ctx.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
      const w = ctx.measureText(l.n).width + 6 * this.dpr;
      const h = size + 4 * this.dpr;
      const sx = cx + (l.x - originX) * scale;
      const sy = cy + (l.z - originZ) * scale;
      if (sx < -w || sx > W + w || sy < -h || sy > H + h) continue;
      // The box is measured without the turn, which is a little generous for
      // a street running across the map and costs nothing but a gap.
      let free = true;
      for (const b of placed) {
        if (Math.abs(sx - b.x) * 2 < w + b.w && Math.abs(sy - b.y) * 2 < h + b.h) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      placed.push({ x: sx, y: sy, w, h });
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(l.a);
      ctx.strokeStyle = 'rgba(8,9,11,0.9)';
      ctx.lineWidth = 3 * this.dpr;
      ctx.lineJoin = 'round';
      ctx.strokeText(l.n, 0, 0);
      ctx.fillStyle = rank <= 2 ? 'rgba(206,201,190,0.95)' : 'rgba(170,168,160,0.85)';
      ctx.fillText(l.n, 0, 0);
      ctx.restore();
      this.labelsDrawn++;
    }
    ctx.restore();
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

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
  /**
   * The city the map cannot see.
   *
   * Only the district you are standing in has its streets in memory, so every
   * other one used to be a labelled grey rectangle: eighty one of them, which
   * is not a city anybody can pick a target on. The index carries a sketch of
   * each district built, a few hundred bytes of big roads, water and parks,
   * and this draws them. It is one path per kind rather than one per road,
   * because eighty one districts is thousands of little strokes and the map
   * is redrawn on every drag.
   */
  drawSketches(ctx, scale) {
    const list = this.world.catalogue || [];
    if (!list.length) return;
    const ring = (path, flat) => {
      path.moveTo(flat[0], flat[1]);
      for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
      path.closePath();
    };
    const water = new Path2D();
    const green = new Path2D();
    const roads = new Path2D();
    let any = false;
    for (const d of list) {
      // The one you are in draws itself, in full, out of its own manifest.
      // A district held at the overflight tier does not: that build carries
      // no street lines, so during a flight it keeps being drawn from the
      // sketch rather than dropping off the map.
      if (!d.sketch || (this.world.loaded(d.id) && !this.world.isOverflight(d.id))) continue;
      any = true;
      for (const w of d.sketch.water) ring(water, w);
      for (const g of d.sketch.green) ring(green, g);
      for (const r of d.sketch.roads) {
        roads.moveTo(r[0], r[1]);
        for (let i = 2; i < r.length; i += 2) roads.lineTo(r[i], r[i + 1]);
      }
    }
    if (!any) return;
    ctx.save();
    // Dimmer than the district you are in, because this is a sketch of a
    // place you are not standing in and the map should say which is which.
    ctx.fillStyle = '#132a34';
    ctx.fill(water);
    ctx.fillStyle = '#16200f';
    ctx.fill(green);
    ctx.strokeStyle = 'rgba(140, 147, 156, 0.42)';
    ctx.lineWidth = Math.max(0.8, 1.25 / scale * this.dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(roads);
    ctx.restore();
  }

  drawDistrictBoxes(ctx, scale) {
    const list = this.world.catalogue || [];
    if (!list.length) return;
    ctx.save();
    ctx.lineWidth = 1 / scale;
    for (const d of list) {
      const b = d.bounds;
      const here = this.world.loaded(d.id);
      // Three states, not two: the one you are in, one that is built and a
      // loading screen away, and one that nobody has built yet, which is
      // drawn as unsurveyed ground so the map never promises a street that
      // is not there.
      const built = d.built !== false;
      ctx.fillStyle = here ? 'rgba(26,32,38,0.55)'
        : (built ? 'rgba(16,18,21,0.75)' : 'rgba(12,12,14,0.86)');
      ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
      ctx.strokeStyle = here ? 'rgba(120,150,170,0.35)'
        : (built ? 'rgba(90,96,104,0.22)' : 'rgba(70,74,80,0.14)');
      ctx.strokeRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    }
    ctx.restore();
  }

  /** Names, upright and at a readable size whatever the zoom is. */
  drawDistrictNames(ctx, scale) {
    const list = this.world.catalogue || [];
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
      // A name only where there is room for it. Eighty one districts across a
      // canvas this size is eighty one names on top of each other, which says
      // less than none of them: below the width of its own label a district
      // is a rectangle and nothing more.
      const label = String(d.name || d.id).toUpperCase();
      if (ctx.measureText(label).width > (b.maxX - b.minX) * scale - 6) continue;
      const here = this.world.loaded(d.id);
      const built = d.built !== false;
      ctx.fillStyle = here ? 'rgba(206,214,222,0.72)'
        : (built ? 'rgba(150,156,164,0.40)' : 'rgba(120,124,130,0.22)');
      ctx.fillText(label, mx, mz);
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
    // The wheel takes the map out of span mode: from here the zoom is
    // whatever the player has asked for.
    this.openSpan = 0;
    const before = this.worldAt(clientX, clientY);
    this.zoom = Math.min(this.maxZoom, Math.max(1, this.zoom * factor));
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
  /**
   * How wide the window is, in metres. What a scale bar would say, and the
   * only number on a map that means anything to somebody standing in it.
   */
  spanAcross() { return this.across || 0; }

  resetView() {
    this.zoom = 1;
    this.openSpan = 0;
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
