// The inside of a mech, drawn over the view out of it.
//
// From the cockpit the mech's own model is not drawn at all: eight metres of
// armour round a camera is the thing that used to fill the screen with the
// back of its own head every time it turned or stood near a wall. What you
// get instead is what a pilot sees: the frame of the canopy, a dashboard
// along the bottom with a radar and the state of the machine on it, a
// heading tape, brackets on what is in front of you, and the glass cracking
// as the hull takes hits. All of it a canvas over the frame, no geometry, so
// it never clips into anything and never moves out of the way.

export const COCKPIT = {
  radarRange: 260,        // metres to the edge of the radar
  bracketRange: 320,      // how far off something still gets brackets
  cracksPerHit: 0.07,     // a crack for every this much of the hull lost
  mostCracks: 9,
};

/** Where a point in the world lands on the screen, or null behind you. */
export function project(vp, x, y, z, w, h) {
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (cw <= 0.05) return null;
  return { x: ((cx / cw) * 0.5 + 0.5) * w, y: (0.5 - (cy / cw) * 0.5) * h };
}

/**
 * Where something is on a radar that turns with you: up is the way the
 * torso faces, in a circle of radius one at the radar's range. The torso's
 * nose is (-sin, -cos), the same as every hull in the game.
 */
export function radarSpot(dx, dz, heading, range = COCKPIT.radarRange) {
  const fx = -Math.sin(heading), fz = -Math.cos(heading);
  // Right of the nose is (-fz, fx) turned the other way: (cos, -sin).
  const rx = Math.cos(heading), rz = -Math.sin(heading);
  const ahead = dx * fx + dz * fz;
  const right = dx * rx + dz * rz;
  return { x: right / range, y: -ahead / range, d: Math.hypot(dx, dz) };
}

// A little seeded noise, so the cracks are the same from frame to frame.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class CockpitHud {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.shown = false;
    this.cracks = [];
    this.lastHull = 1;
    this.last = null;      // what was drawn, for the checks
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.canvas.classList.add('hidden');
    this.cracks.length = 0;
    this.lastHull = 1;
  }

  /** A hit takes glass with it: one crack per bit of hull, from a point near where you look. */
  _crack(hull) {
    if (hull >= this.lastHull) { this.lastHull = Math.max(this.lastHull, hull); return; }
    const lost = this.lastHull - hull;
    const n = Math.floor(lost / COCKPIT.cracksPerHit);
    if (n <= 0) return;
    this.lastHull -= n * COCKPIT.cracksPerHit;
    for (let i = 0; i < n && this.cracks.length < COCKPIT.mostCracks; i++) {
      const r = rng((this.cracks.length + 1) * 7919 + Math.floor(hull * 1000));
      const x = 0.12 + r() * 0.76, y = 0.1 + r() * 0.5;
      const arms = [];
      const legs = 4 + Math.floor(r() * 4);
      for (let k = 0; k < legs; k++) {
        const a = (k / legs) * Math.PI * 2 + r() * 0.6;
        const pts = [];
        let px = 0, py = 0, aa = a;
        const steps = 2 + Math.floor(r() * 3);
        for (let s = 0; s < steps; s++) {
          aa += (r() - 0.5) * 0.7;
          const len = 0.012 + r() * 0.026;
          px += Math.cos(aa) * len; py += Math.sin(aa) * len;
          pts.push([px, py]);
        }
        arms.push(pts);
      }
      this.cracks.push({ x, y, arms });
    }
  }

  /**
   * @param {object} o
   * @param {number} o.heading torso heading, radians
   * @param {number} o.pitch view pitch, radians
   * @param {number} o.hull 0..1
   * @param {number} o.shield 0..1, or -1 for none
   * @param {number} o.speed metres a second
   * @param {string} o.name the chassis
   * @param {string} o.arm what is in its hands
   * @param {string} o.ammo rounds or reload
   * @param {string} [o.pod] the rocket pod: ready, or how long until it is
   * @param {string} [o.dash] the dash, the same
   * @param {{dx:number,dz:number,kind:string}[]} o.blips round you, relative
   * @param {{x:number,y:number,d:number,kind:string}[]} o.targets on the screen
   * @param {number} o.time seconds
   */
  draw(o) {
    if (!this.shown) { this.shown = true; this.canvas.classList.remove('hidden'); }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.canvas.clientWidth || window.innerWidth, H = this.canvas.clientHeight || window.innerHeight;
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this._crack(o.hull);

    const amber = 'rgba(255, 196, 120, ';
    const green = 'rgba(140, 255, 200, ';
    const red = 'rgba(255, 86, 64, ';
    const critical = o.hull < 0.16;
    const hurt = o.hull < 0.34;
    const ink = critical ? red : green;

    // The glass: a faint tint toward the edges, as if you were behind it.
    const tint = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.3, W / 2, H * 0.42, Math.max(W, H) * 0.75);
    tint.addColorStop(0, 'rgba(60, 120, 110, 0)');
    tint.addColorStop(1, 'rgba(30, 70, 70, 0.22)');
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);

    // The frame of the canopy: a bar across the top, two pillars coming
    // down and in from the corners, and the sides.
    const frame = '#11141a', edge = 'rgba(226, 201, 141, 0.22)';
    const dash = H * 0.76;
    ctx.fillStyle = frame;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H * 0.05);
    ctx.quadraticCurveTo(W / 2, H * 0.11, 0, H * 0.05);
    ctx.closePath(); ctx.fill();
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? 0 : W;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0 - side * W * 0.075, 0);
      ctx.lineTo(x0 - side * W * 0.16, dash);
      ctx.lineTo(x0 - side * W * 0.12, dash);
      ctx.lineTo(x0, H * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 - side * W * 0.075, 0);
      ctx.lineTo(x0 - side * W * 0.16, dash);
      ctx.stroke();
      // Rivets down the pillar.
      ctx.fillStyle = 'rgba(226, 201, 141, 0.18)';
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        ctx.beginPath();
        ctx.arc(x0 - side * (W * 0.07 + W * 0.075 * t), H * 0.05 + (dash - H * 0.05) * t, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = frame;
    }

    // The dashboard.
    const panel = ctx.createLinearGradient(0, dash, 0, H);
    panel.addColorStop(0, '#1a1e25');
    panel.addColorStop(1, '#0b0d11');
    ctx.fillStyle = panel;
    ctx.beginPath();
    ctx.moveTo(0, dash + H * 0.02);
    ctx.lineTo(W * 0.16, dash);
    ctx.lineTo(W * 0.84, dash);
    ctx.lineTo(W, dash + H * 0.02);
    ctx.lineTo(W, H); ctx.lineTo(0, H);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = edge;
    ctx.beginPath(); ctx.moveTo(W * 0.16, dash); ctx.lineTo(W * 0.84, dash); ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const font = (px, weight = 600) => `${weight} ${px}px ui-monospace, SFMono-Regular, Menlo, monospace`;

    // The radar, in the left hand screen.
    const rr = Math.max(24, Math.min((H - dash) / 2 - 14, 70));
    const rcx = W * 0.27, rcy = dash + (H - dash) / 2 - 4;
    ctx.fillStyle = 'rgba(8, 20, 18, 0.92)';
    ctx.beginPath(); ctx.arc(rcx, rcy, rr + 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `${green}0.35)`;
    ctx.lineWidth = 1;
    for (const k of [1, 0.5]) { ctx.beginPath(); ctx.arc(rcx, rcy, rr * k, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(rcx, rcy - rr); ctx.lineTo(rcx, rcy + rr);
    ctx.moveTo(rcx - rr, rcy); ctx.lineTo(rcx + rr, rcy); ctx.stroke();
    // The sweep.
    const sweep = (o.time * 2.2) % (Math.PI * 2);
    ctx.fillStyle = `${green}0.12)`;
    ctx.beginPath(); ctx.moveTo(rcx, rcy); ctx.arc(rcx, rcy, rr, sweep - 0.5, sweep); ctx.closePath(); ctx.fill();
    // What is round you.
    let onRadar = 0;
    for (const b of o.blips) {
      const p = radarSpot(b.dx, b.dz, o.heading);
      if (p.d > COCKPIT.radarRange) continue;
      onRadar++;
      const x = rcx + p.x * rr, y = rcy + p.y * rr;
      ctx.fillStyle = b.kind === 'ally' ? `${green}0.95)` : `${red}0.95)`;
      if (b.kind === 'mech' || b.kind === 'vehicle') ctx.fillRect(x - 3, y - 3, 6, 6);
      else { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
    }
    // You, in the middle, pointing up.
    ctx.fillStyle = `${amber}1)`;
    ctx.beginPath(); ctx.moveTo(rcx, rcy - 5); ctx.lineTo(rcx + 4, rcy + 4); ctx.lineTo(rcx - 4, rcy + 4); ctx.closePath(); ctx.fill();
    ctx.font = font(9);
    ctx.fillStyle = `${green}0.6)`;
    ctx.fillText(`${COCKPIT.radarRange} m`, rcx, rcy + rr + 10);

    // The systems, in the right hand screen.
    const sx = W * 0.73, sy = dash + (H - dash) / 2;
    const sw = Math.min(W * 0.17, 200), sh = (H - dash) * 0.7;
    ctx.fillStyle = 'rgba(8, 20, 18, 0.92)';
    ctx.fillRect(sx - sw / 2, sy - sh / 2, sw, sh);
    ctx.strokeStyle = `${ink}0.4)`;
    ctx.strokeRect(sx - sw / 2 + 0.5, sy - sh / 2 + 0.5, sw - 1, sh - 1);
    ctx.textAlign = 'left';
    ctx.font = font(10, 700);
    ctx.fillStyle = `${ink}0.95)`;
    ctx.fillText(o.name.toUpperCase(), sx - sw / 2 + 8, sy - sh / 2 + 11);
    const bar = (label, f, row, colour) => {
      const y = sy - sh / 2 + 26 + row * 15;
      ctx.font = font(9);
      ctx.fillStyle = `${green}0.7)`;
      ctx.fillText(label, sx - sw / 2 + 8, y);
      const bx = sx - sw / 2 + 52, bw = sw - 60;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(bx, y - 4, bw, 8);
      ctx.fillStyle = colour;
      ctx.fillRect(bx, y - 4, bw * Math.max(0, Math.min(1, f)), 8);
    };
    bar('HULL', o.hull, 0, critical ? `${red}0.95)` : hurt ? `${amber}0.95)` : `${green}0.85)`);
    if (o.shield >= 0) bar('SHIELD', o.shield, 1, 'rgba(120, 190, 255, 0.9)');
    ctx.font = font(9);
    ctx.fillStyle = `${green}0.75)`;
    const ry = sy - sh / 2 + 26 + 2 * 15 + 2;
    ctx.fillText(`${o.arm.toUpperCase()}`, sx - sw / 2 + 8, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = `${amber}1)`;
    ctx.fillText(o.ammo, sx + sw / 2 - 8, ry);
    ctx.textAlign = 'left';
    ctx.fillStyle = `${green}0.75)`;
    ctx.fillText(`${Math.round(o.speed * 3.6)} KM/H`, sx - sw / 2 + 8, ry + 14);
    if (o.pod !== undefined) {
      ctx.fillText(`POD ${o.pod.toUpperCase()}`, sx - sw / 2 + 8, ry + 28);
      ctx.textAlign = 'right';
      ctx.fillText(`DASH ${o.dash.toUpperCase()}`, sx + sw / 2 - 8, ry + 28);
      ctx.textAlign = 'left';
    }

    // The heading tape, in the middle of the dashboard.
    const deg = ((-o.heading * 180 / Math.PI) % 360 + 360) % 360;
    const tx = W / 2, ty = dash + 16, tw = W * 0.22;
    ctx.save();
    ctx.beginPath(); ctx.rect(tx - tw / 2, ty - 10, tw, 22); ctx.clip();
    ctx.textAlign = 'center';
    for (let d = Math.floor((deg - 40) / 5) * 5; d <= deg + 40; d += 5) {
      const x = tx + (d - deg) * (tw / 80);
      const n = ((d % 360) + 360) % 360;
      ctx.fillStyle = `${green}0.6)`;
      if (n % 45 === 0) {
        ctx.font = font(10, 700);
        ctx.fillText(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][n / 45], x, ty + 2);
      } else {
        ctx.fillRect(x - 0.5, ty - (n % 15 === 0 ? 6 : 3), 1, n % 15 === 0 ? 8 : 5);
      }
    }
    ctx.restore();
    ctx.fillStyle = `${amber}1)`;
    ctx.beginPath(); ctx.moveTo(tx, ty + 10); ctx.lineTo(tx - 4, ty + 15); ctx.lineTo(tx + 4, ty + 15); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = font(11, 700);
    ctx.fillText(String(Math.round(deg)).padStart(3, '0'), tx, ty + 26);

    // A pitch ladder either side of the middle of the glass.
    const cx = W / 2, cy = H / 2;
    const pdeg = o.pitch * 180 / Math.PI;
    ctx.strokeStyle = `${green}0.35)`;
    ctx.fillStyle = `${green}0.45)`;
    ctx.font = font(9);
    for (let p = -20; p <= 20; p += 10) {
      const y = cy + (pdeg - p) * (H / 90);
      if (y < H * 0.12 || y > dash - 10) continue;
      ctx.beginPath();
      ctx.moveTo(cx - 150, y); ctx.lineTo(cx - 110, y);
      ctx.moveTo(cx + 110, y); ctx.lineTo(cx + 150, y);
      ctx.stroke();
      ctx.fillText(String(p), cx - 164, y);
    }

    // Brackets on whatever of theirs is in front of you, the nearest to the
    // middle held with its distance.
    let lock = null;
    for (const t of o.targets) {
      if (t.d > COCKPIT.bracketRange) continue;
      const off = Math.hypot(t.x - cx, t.y - cy);
      if (!lock || off < lock.off) lock = { ...t, off };
    }
    let bracketed = 0;
    for (const t of o.targets) {
      if (t.d > COCKPIT.bracketRange || t.y > dash) continue;
      bracketed++;
      const s = Math.max(9, Math.min(34, 900 / Math.max(1, t.d))) * (t.kind === 'mech' ? 2 : t.kind === 'vehicle' ? 1.5 : 1);
      const held = lock && t.x === lock.x && t.y === lock.y;
      ctx.strokeStyle = held ? `${red}0.95)` : `${red}0.55)`;
      ctx.lineWidth = held ? 2 : 1.2;
      const c = s * 0.4;
      ctx.beginPath();
      for (const [sxn, syn] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = t.x + sxn * s, y = t.y + syn * s;
        ctx.moveTo(x, y - syn * c); ctx.lineTo(x, y); ctx.lineTo(x - sxn * c, y);
      }
      ctx.stroke();
      if (held) {
        ctx.font = font(10, 700);
        ctx.fillStyle = `${red}0.95)`;
        ctx.fillText(`${Math.round(t.d)} m`, t.x, t.y + s + 10);
      }
    }

    // The glass, cracked where it has been hit.
    ctx.strokeStyle = 'rgba(220, 240, 255, 0.55)';
    ctx.lineWidth = 1;
    for (const k of this.cracks) {
      const ox = k.x * W, oy = k.y * H, sc = Math.min(W, H);
      for (const arm of k.arms) {
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        for (const [px, py] of arm) ctx.lineTo(ox + px * sc, oy + py * sc);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(220, 240, 255, 0.25)';
      ctx.beginPath(); ctx.arc(ox, oy, 3, 0, Math.PI * 2); ctx.fill();
    }

    // And the warning light on the dashboard when it is bad.
    if (hurt) {
      const on = critical ? Math.sin(o.time * 12) > 0 : true;
      ctx.font = font(12, 800);
      ctx.fillStyle = on ? `${critical ? red : amber}1)` : `${red}0.25)`;
      ctx.fillText(critical ? 'HULL CRITICAL' : 'HULL DAMAGED', W / 2, dash + (H - dash) * 0.72);
    }

    this.last = { radar: onRadar, bracketed, lock: lock ? Math.round(lock.d) : null, cracks: this.cracks.length, heading: Math.round(deg) };
  }
}
