// A compass across the top of the screen, in the manner of the open world
// shooters: the heading in ticks and letters sliding past under a fixed mark,
// and on it the camps or nests of an operation where they lie, red while they
// are held and blue once they are yours, the nearest one held larger and with
// its distance under it, and a mark of your own put on the map in yellow.
// When one of those is behind you it waits at the edge the near way round,
// with an arrow, so there is always a way to where you are going.

const SPAN = 80;          // degrees either side of the middle
const NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** A difference of two headings, in degrees, the short way round. */
export function turn(from, to) {
  return ((to - from) % 360 + 540) % 360 - 180;
}

/** The heading of a point from another, in degrees, nought north and ninety east. */
export function bearing(fromX, fromZ, toX, toZ) {
  return (Math.atan2(toX - fromX, -(toZ - fromZ)) * 180 / Math.PI + 360) % 360;
}

/** A distance as a person reads it off a compass. */
export function distanceLabel(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export class CompassBar {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.shown = false;
    // What was drawn last, for the checks.
    this.last = null;
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.canvas.classList.add('hidden');
  }

  /**
   * @param {number} heading where you are looking, degrees
   * @param {{bearing:number, dist:number, free:boolean, hot:boolean, kind:string, goal:boolean}[]} marks
   * @param {number} time seconds, for the pulse of one that is awake
   */
  draw(heading, marks, time = 0) {
    if (!this.shown) {
      this.shown = true;
      this.canvas.classList.remove('hidden');
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 560, cssH = this.canvas.clientHeight || 40;
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const mid = cssW / 2;
    const px = (cssW / 2 - 14) / SPAN;      // pixels to a degree
    const strip = 20;                        // the band the ticks sit in
    const at = (deg) => mid + turn(heading, deg) * px;

    // The band, fading out at both ends.
    const fade = ctx.createLinearGradient(0, 0, cssW, 0);
    fade.addColorStop(0, 'rgba(8, 9, 12, 0)');
    fade.addColorStop(0.15, 'rgba(8, 9, 12, 0.55)');
    fade.addColorStop(0.85, 'rgba(8, 9, 12, 0.55)');
    fade.addColorStop(1, 'rgba(8, 9, 12, 0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, cssW, strip);

    // Ticks every five degrees, longer at fifteen, letters at forty five.
    const first = Math.ceil((heading - SPAN) / 5) * 5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = first; d <= heading + SPAN; d += 5) {
      const x = at(d);
      const edge = Math.min(1, Math.max(0, (cssW / 2 - Math.abs(x - mid)) / 60));
      const n = ((d % 360) + 360) % 360;
      if (n % 45 === 0) {
        ctx.font = `${n % 90 === 0 ? 700 : 600} ${n % 90 === 0 ? 12 : 10}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = n === 0 ? `rgba(255, 196, 120, ${edge})` : `rgba(236, 228, 210, ${edge})`;
        ctx.fillText(NAMES[n / 45], x, strip / 2 + 1);
      } else {
        const long = n % 15 === 0;
        ctx.fillStyle = `rgba(236, 228, 210, ${edge * (long ? 0.75 : 0.4)})`;
        ctx.fillRect(x - 0.5, long ? 5 : 8, 1, long ? 10 : 5);
      }
    }

    // The sites. The nearest held one last, so it is on top.
    const order = [...marks].sort((a, b) => (a.goal - b.goal) || (b.dist - a.dist));
    const goals = [];
    for (const mk of order) {
      const off = turn(heading, mk.bearing);
      let x = mid + off * px;
      const inside = Math.abs(off) <= SPAN - 2;
      if (!inside && !mk.goal) continue;
      if (!inside) x = off < 0 ? 16 : cssW - 16;
      const size = mk.goal ? 6.5 : 4.5;
      const pulse = mk.hot ? 0.55 + 0.45 * Math.sin(time * 9) : 1;
      const colour = mk.kind === 'mark' ? 'rgba(255, 214, 92, 1)'
        : mk.free ? `rgba(110, 170, 255, ${0.9 * pulse})` : `rgba(255, 82, 64, ${pulse})`;
      ctx.fillStyle = colour;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const y = strip / 2;
      if (mk.kind === 'mark') {
        // Your own mark: a pin.
        ctx.arc(x, y - size * 0.35, size * 0.85, Math.PI * 0.85, Math.PI * 2.15);
        ctx.lineTo(x, y + size * 1.2);
        ctx.closePath();
      } else if (mk.kind === 'slayer') {
        // A nest: a round eye with two horns.
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.moveTo(x - size * 0.9, y - size * 0.5);
        ctx.lineTo(x - size * 1.25, y - size * 1.45);
        ctx.lineTo(x - size * 0.35, y - size * 0.95);
        ctx.moveTo(x + size * 0.9, y - size * 0.5);
        ctx.lineTo(x + size * 1.25, y - size * 1.45);
        ctx.lineTo(x + size * 0.35, y - size * 0.95);
      } else {
        // A camp: a tent.
        ctx.moveTo(x, y - size * 1.2);
        ctx.lineTo(x + size * 1.15, y + size * 0.9);
        ctx.lineTo(x - size * 1.15, y + size * 0.9);
        ctx.closePath();
      }
      ctx.stroke();
      ctx.fill();
      if (!inside) {
        // Behind you: an arrow the near way round.
        const dir = off < 0 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(x + dir * (size + 9), y);
        ctx.lineTo(x + dir * (size + 3), y - 4);
        ctx.lineTo(x + dir * (size + 3), y + 4);
        ctx.closePath();
        ctx.fill();
      }
      if (mk.goal) {
        goals.push({ kind: mk.kind, x: Math.round(x), behind: !inside });
        ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = mk.kind === 'mark' ? 'rgba(255, 224, 140, 0.95)'
          : mk.free ? 'rgba(160, 200, 255, 0.95)' : 'rgba(255, 170, 150, 0.95)';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = 3;
        const tx = Math.min(cssW - 28, Math.max(28, x));
        ctx.fillText(distanceLabel(mk.dist), tx, strip + 10);
        ctx.shadowBlur = 0;
      }
    }

    // Where you are looking.
    ctx.fillStyle = 'rgba(255, 196, 120, 0.95)';
    ctx.beginPath();
    ctx.moveTo(mid, strip - 1);
    ctx.lineTo(mid - 4, strip + 5);
    ctx.lineTo(mid + 4, strip + 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(mid - 0.5, 0, 1, 4);

    this.last = { heading, marks: marks.length, goals, width: cssW };
  }
}
