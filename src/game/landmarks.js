// Landmark discovery. Within the card radius of a landmark the card slides in,
// once. Finding all of them shows the completion screen.

export class Landmarks {
  constructor(manifest, host, onComplete) {
    this.list = (manifest.landmarks || []).filter((l) => l.text);
    // The walk is finished when the landmarks of the district you started in
    // have all been found. Districts that arrive later add cards to read, and
    // they are worth reading, but the goal you were given does not move while
    // you are walking towards it.
    this.goal = new Set(this.list.map((l) => l.key));
    this.found = new Set();
    this.host = host;
    this.onComplete = onComplete;
    this.cooldown = 0;
    this.active = [];
    this.startTime = 0;
    this.completed = false;
  }

  get total() { return this.goal.size; }

  /** Of the goal, which is what the interface counts. */
  get foundInGoal() {
    let n = 0;
    for (const key of this.goal) if (this.found.has(key)) n++;
    return n;
  }

  /**
   * The city grew or shrank: take the cards again. Whatever has already been
   * found stays found, so walking out of a district and back in does not hand
   * you the same card twice.
   */
  refresh(manifest) {
    this.list = (manifest.landmarks || []).filter((l) => l.text);
  }

  reset() {
    this.found.clear();
    this.completed = false;
    this.startTime = performance.now();
    this.host.innerHTML = '';
  }

  /** Nearest undiscovered landmark, for the map hint. */
  nearest(x, z) {
    let best = null, bestD = Infinity;
    for (const l of this.list) {
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < bestD) { bestD = d; best = l; }
    }
    return { landmark: best, distance: bestD };
  }

  update(x, z, dt, distanceWalked) {
    this.cooldown -= dt;
    for (const l of this.list) {
      if (this.found.has(l.key)) continue;
      if (Math.hypot(l.x - x, l.z - z) > (l.radius || 45)) continue;
      this.found.add(l.key);
      this.show(l);
      if (this.foundInGoal === this.goal.size && !this.completed) {
        this.completed = true;
        const seconds = (performance.now() - this.startTime) / 1000;
        setTimeout(() => this.onComplete(seconds, distanceWalked), 1400);
      }
      break;    // one card at a time, so they never pile up
    }
  }

  show(l) {
    const el = document.createElement('div');
    el.className = 'card';
    const h = document.createElement('h3');
    h.textContent = l.name;
    const p = document.createElement('p');
    p.textContent = l.text;
    el.appendChild(h);
    el.appendChild(p);
    this.host.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 500);
    }, 9000);
  }
}
