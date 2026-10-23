// The city's own systems, for .BACKDOOR: the steam pipes under the street,
// and the power.
//
// Under every carriageway there is a pipe, and every so far along it a cover
// in the road. The phone can open one a little, which puts a column of steam
// across the road that the traffic stops for and the people walk round, or
// all the way, which blows the cover and whatever is standing on it into the
// air. And it can cut the power to the whole street for a while: the windows
// and the lamps go out, the lights at the junctions go dark, and everybody
// stops to wonder why.
//
// This file is where the covers are, what each one is doing, what a blast
// does to whatever is near it, and the blackout's own clock. What a blast
// looks like and who it lands on is the game layer's.

export const CITY = {
  pipes: {
    every: 85,                  // metres between covers along a carriageway
    first: 30,                  // and the first this far along it, at most
    clear: 10,                  // none in a junction, or this near one
    apart: 14,                  // nor two this near each other
    vent: 8,                    // seconds of steam
    fuse: 1.2,                  // seconds of hiss before it goes
    spent: 40,                  // seconds before a blown one is a cover again
  },
  blast: {
    radius: 7,                  // what is inside it goes up
    up: 9,                      // metres a second, straight up, at the middle
    hull: 0.45,                 // of a vehicle's hull, at the middle
    people: 6,                  // metres: anybody nearer is knocked off their feet
    push: 7,                    // and this hard
    hurt: 20,                   // you, at the middle
  },
  blackout: { seconds: 15, cut: 0.15, back: 1.6 },
};

/** A number from a position that is the same every time, 0 to 1. */
const hash = (x, z) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Where the covers are: on the line of every carriageway, every so far
 * along it, never in a junction, and never two on top of each other where
 * two lines run down the same street.
 * @param {{roads:{pts:number[], n:number}[]}} index from roadIndex
 * @param {{x:number, z:number, r:number}[]} junctions
 * @returns {{x:number, z:number, yaw:number, vent:number, fuse:number, spent:number}[]}
 */
export function pipesOf(index, junctions = []) {
  const P = CITY.pipes;
  const out = [];
  const CELL = 30;
  const grid = new Map();
  const near = (x, z, r) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const p of grid.get(`${cx + a},${cz + b}`) || []) if (Math.hypot(p.x - x, p.z - z) < r) return true;
      }
    }
    return false;
  };
  for (const road of index.roads) {
    const pts = road.pts;
    let next = P.first * (0.4 + 0.6 * hash(pts[0], pts[1]));
    let run = 0;
    for (let i = 1; i < road.n; i++) {
      const ax = pts[i * 2 - 2], az = pts[i * 2 - 1], bx = pts[i * 2], bz = pts[i * 2 + 1];
      const l = Math.hypot(bx - ax, bz - az);
      while (next <= run + l) {
        const t = (next - run) / (l || 1);
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        next += P.every;
        if (junctions.some((j) => Math.hypot(j.x - x, j.z - z) < j.r + P.clear)) continue;
        if (near(x, z, P.apart)) continue;
        const p = { x, z, yaw: Math.atan2(-(bx - ax), -(bz - az)), vent: 0, fuse: 0, spent: 0 };
        out.push(p);
        const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(p);
      }
      run += l;
    }
  }
  return out;
}

/** What a cover is doing: 0 nothing, 1 venting, 2 about to go, 3 blown. */
export const pipeState = (p) => (p.spent > 0 ? 3 : p.fuse > 0 ? 2 : p.vent > 0 ? 1 : 0);

/**
 * A cover, a step on.
 * @returns {'blow'|null} 'blow' the moment its fuse runs out
 */
export function pipeStep(p, dt) {
  if (p.spent > 0) { p.spent = Math.max(0, p.spent - dt); return null; }
  if (p.fuse > 0) {
    p.fuse -= dt;
    if (p.fuse <= 0) {
      p.fuse = 0;
      p.vent = 0;
      p.spent = CITY.pipes.spent;
      return 'blow';
    }
    return null;
  }
  if (p.vent > 0) p.vent = Math.max(0, p.vent - dt);
  return null;
}

/** Whether the phone can do anything with a cover: not while it is blown. */
export const pipeReady = (p) => p.spent <= 0 && p.fuse <= 0;

/**
 * What a blast does to something this far from it: how hard it is thrown up
 * and out, and how much of it is hurt, all falling off to nothing at the
 * edge.
 * @returns {{up:number, out:number, share:number, dx:number, dz:number}|null}
 */
export function blastOn(p, x, z) {
  const B = CITY.blast;
  const dx = x - p.x, dz = z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > B.radius) return null;
  const k = 1 - d / B.radius;
  const l = d || 1;
  return { up: B.up * (0.45 + 0.55 * k), out: B.push * k, share: k, dx: d ? dx / l : 1, dz: d ? dz / l : 0 };
}

/**
 * The power, cut and back. Out at once, and back over a second and a half
 * with a flicker, the way a street comes back on.
 */
export class Blackout {
  constructor() { this.left = 0; this.dark = 0; this.t = 0; }

  get on() { return this.left > 0; }

  /** Cut it, if it is not already. */
  start() {
    if (this.left > 0) return false;
    this.left = CITY.blackout.seconds;
    return true;
  }

  /** @returns {'back'|null} 'back' the step the power comes back */
  update(dt) {
    const C = CITY.blackout;
    this.t += dt;
    let ev = null;
    if (this.left > 0) {
      this.left -= dt;
      if (this.left <= 0) { this.left = 0; ev = 'back'; }
      this.dark = Math.min(1, this.dark + dt / C.cut);
    } else {
      this.dark = Math.max(0, this.dark - dt / C.back);
    }
    return ev;
  }

  /** How much of the light is out, 0 to 1, with the flicker coming back. */
  get out() {
    if (this.left > 0 || this.dark <= 0) return this.dark;
    return Math.sin(this.t * 37) > 0.2 ? this.dark : this.dark * 0.35;
  }
}
