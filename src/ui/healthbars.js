// A bar over the head of everything that is trying to kill you.
//
// One small strip per enemy in sight: soldiers and the machines among them,
// drones, jets and their mechs, never a passer by and never anything of
// yours. The strip is a pool of plain elements over the canvas, placed each
// frame by the same projection the renderer uses, because a few dozen
// absolutely positioned divs cost nothing and need no shader of their own.
//
// What it shows is the fraction left, green going to red, with the part a
// hit just took off held in white for a moment before it drains away, so a
// connect reads on the bar as well as on the body.

export const HEALTHBAR = {
  // The most on the screen at once: the nearest ones win.
  max: 24,
  // How far off each kind still gets one, in metres.
  range: { soldier: 110, machine: 130, drone: 180, jet: 700, mech: 520 },
  // How wide, in pixels at ten metres, and the narrowest and widest it gets.
  size: { soldier: 64, machine: 64, drone: 64, jet: 150, mech: 260 },
  minWidth: 26,
  maxWidth: { soldier: 74, machine: 74, drone: 74, jet: 110, mech: 150 },
  // How often a line of sight is asked again for the same one, in seconds.
  sightEvery: 0.2,
  // How long the white chip of a fresh hit takes to drain away.
  chipSeconds: 0.6,
};

/** The colour of what is left: green when whole, through amber, to red. */
export function healthColour(f) {
  const k = Math.max(0, Math.min(1, f));
  const r = k > 0.5 ? Math.round(255 * (1 - k) * 2) : 255;
  const g = k > 0.5 ? 220 : Math.round(220 * k * 2);
  return `rgb(${Math.max(70, r)}, ${g}, 60)`;
}

export class HealthBars {
  /** @param {HTMLElement} root the layer the bars live in */
  constructor(root) {
    this.root = root;
    this.pool = [];
    for (let i = 0; i < HEALTHBAR.max; i++) {
      const bar = document.createElement('div');
      bar.className = 'hbar hidden';
      const chip = document.createElement('i');
      chip.className = 'chip';
      const fill = document.createElement('b');
      bar.append(chip, fill);
      root.appendChild(bar);
      this.pool.push({ bar, chip, fill, on: false });
    }
    this.shown = 0;
  }

  /**
   * @param {{body:object, kind:string, x:number, y:number, z:number,
   *   health:number, max:number}[]} list everything hostile and alive, with
   *   the point over its head the bar sits on
   * @param {Float32Array} vp the camera's view projection
   * @param {{x:number,y:number,z:number}} eye
   * @param {(x,y,z)=>boolean} seen a line of sight from the eye
   * @param {number} dt @param {number} time
   * @param {number} w @param {number} h the canvas size in CSS pixels
   */
  update(list, vp, eye, seen, dt, time, w, h) {
    const near = [];
    for (const e of list) {
      if (!(e.health > 0) || !(e.max > 0)) continue;
      const d = Math.hypot(e.x - eye.x, e.y - eye.y, e.z - eye.z);
      if (d > (HEALTHBAR.range[e.kind] || 110)) continue;
      // In front of the camera and on the screen, with a margin for the bar.
      const cx = vp[0] * e.x + vp[4] * e.y + vp[8] * e.z + vp[12];
      const cy = vp[1] * e.x + vp[5] * e.y + vp[9] * e.z + vp[13];
      const cw = vp[3] * e.x + vp[7] * e.y + vp[11] * e.z + vp[15];
      if (cw <= 0.05) continue;
      const sx = ((cx / cw) * 0.5 + 0.5) * w;
      const sy = (0.5 - (cy / cw) * 0.5) * h;
      if (sx < -40 || sx > w + 40 || sy < -20 || sy > h + 20) continue;
      near.push({ e, d, sx, sy });
    }
    near.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const p of near) {
      if (n >= this.pool.length) break;
      const b = p.e.body;
      // Through a wall it is not in sight, and the bar would say where it is.
      if (b._hbAt === undefined || time - b._hbAt > HEALTHBAR.sightEvery || time < b._hbAt) {
        b._hbAt = time;
        b._hbSeen = seen(p.e.x, p.e.y, p.e.z);
      }
      if (!b._hbSeen) continue;
      const f = Math.max(0, Math.min(1, p.e.health / p.e.max));
      // The chip: what was there a moment ago, catching up with what is.
      if (b._hbChip === undefined || b._hbChip < f) b._hbChip = f;
      else b._hbChip = Math.max(f, b._hbChip - dt / HEALTHBAR.chipSeconds);
      const slot = this.pool[n++];
      const width = Math.round(Math.max(HEALTHBAR.minWidth,
        Math.min(HEALTHBAR.maxWidth[p.e.kind] || 74, (HEALTHBAR.size[p.e.kind] || 64) * 10 / Math.max(1, p.d))));
      if (!slot.on) { slot.bar.classList.remove('hidden'); slot.on = true; }
      slot.bar.style.transform = `translate(${Math.round(p.sx - width / 2)}px, ${Math.round(p.sy)}px)`;
      slot.bar.style.width = `${width}px`;
      slot.bar.dataset.kind = p.e.kind;
      slot.fill.style.width = `${(f * 100).toFixed(1)}%`;
      slot.fill.style.background = healthColour(f);
      slot.chip.style.width = `${(b._hbChip * 100).toFixed(1)}%`;
      slot.f = f;
    }
    for (let i = n; i < this.pool.length; i++) {
      const slot = this.pool[i];
      if (slot.on) { slot.bar.classList.add('hidden'); slot.on = false; }
    }
    this.shown = n;
  }

  hide() {
    for (const slot of this.pool) {
      if (slot.on) { slot.bar.classList.add('hidden'); slot.on = false; }
    }
    this.shown = 0;
  }
}
