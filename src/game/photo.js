// Photo mode: hide the interface, hold the clock still, scrub the time of day
// and save a PNG. The canvas is re rendered with preserveDrawingBuffer off, so
// the grab happens inside the same frame as the draw.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export function dayLabel(doy) {
  const d = new Date(Date.UTC(2026, 0, 1));
  d.setUTCDate(d.getUTCDate() + Math.round(doy) - 1);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function timeLabel(tod) {
  const h = Math.floor(tod) % 24;
  const m = Math.floor((tod - Math.floor(tod)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export class PhotoMode {
  constructor(canvas, hud, photoBar, attribution) {
    this.canvas = canvas;
    this.hud = hud;
    this.bar = photoBar;
    this.attribution = attribution;
    this.active = false;
    this.pendingShot = false;
  }

  enter() {
    this.active = true;
    this.hud.classList.add('hidden');
    this.bar.classList.remove('hidden');
  }

  exit() {
    this.active = false;
    this.hud.classList.remove('hidden');
    this.bar.classList.add('hidden');
  }

  toggle() { this.active ? this.exit() : this.enter(); return this.active; }

  /** Ask for a grab. The renderer calls capture() right after the next draw. */
  requestShot() { this.pendingShot = true; }

  capture(meta) {
    this.pendingShot = false;
    const src = this.canvas;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0);

    // Burn in the attribution, because the licence requires it to travel with
    // the picture and screenshots travel further than the page does.
    const pad = Math.round(out.width * 0.012);
    const size = Math.max(11, Math.round(out.width * 0.0125));
    ctx.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
    const line1 = 'SPREE|FALL  ' + meta;
    const line2 = 'Map data © OpenStreetMap contributors, ODbL';
    const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + pad * 2;
    ctx.fillStyle = 'rgba(8,9,11,0.55)';
    ctx.fillRect(pad * 0.6, out.height - pad * 0.6 - size * 3.1, w, size * 3.0);
    ctx.fillStyle = 'rgba(226,201,141,0.92)';
    ctx.fillText(line1, pad * 1.2, out.height - pad * 0.6 - size * 1.75);
    ctx.fillStyle = 'rgba(235,232,226,0.78)';
    ctx.fillText(line2, pad * 1.2, out.height - pad * 0.6 - size * 0.5);

    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `spreefall-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }
}
