// The city's own systems, for .BACKDOOR: the steam pipes under the street,
// the power, and what stands on the pavement and in the walls: power boxes
// that can be made to blow, cash machines, and the blockers that rise out of
// the road at a junction.
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
  // Street furniture: something every so far along a carriageway, on
  // alternate sides, out past the kerb; never near a junction or another;
  // and every third place an ATM in the wall behind the pavement instead, if
  // there is a wall within reach.
  street: { every: 55, first: 22, side: 1.3, apart: 24, clear: 12, atmEvery: 3, wallReach: 9 },
  // A power box: how long it crackles before it goes, how long it is burnt
  // out after, how long a trap stays set and how near sets it off.
  box: { fuse: 1.0, spent: 45, trap: 20, trapReach: 3.2 },
  // What it does when it goes: everybody within the radius off their feet,
  // the soldiers hurt (the people who live here less), cars near it stalled,
  // and you hurt if you were stood next to it.
  zap: { radius: 6, hurt: 45, civil: 0.3, push: 5.5, stall: 8, cars: 8, you: 22, youReach: 4 },
  // An ATM: what it holds, how long it is empty after, how long it sprays,
  // and from how far the people come running for it.
  atm: { cash: [80, 420], empty: 120, spray: 8, lure: 25, run: 3.4 },
  // A road blocker: how far before the junction, how long it takes to come
  // up or go down, and how long it stays up.
  // A row is posts a quarter of a metre thick with no more than 1.2 m of
  // air between them, the most British guidance on stopping a vehicle
  // allows, so nothing as wide as a car gets through or sits between two.
  bollards: { set: 7, rise: 0.5, up: 12, spacing: 1.44,
    // Coming up under a car: how fast it throws it, how much it turns it
    // over, how far off the row it goes, and how much of the hull it costs.
    lift: 5.5, tumble: 1.6, shove: 3.5, hull: 0.22 },
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

// --- what stands on the pavement --------------------------------------------

/**
 * The power boxes and the ATMs, along every carriageway in the index.
 * Where they go is the road's business; whether one can stand there is the
 * world's, so the world is asked through two callbacks: whether the line from
 * the road to a spot is clear, and whether there is a wall behind it.
 *
 * @param {(cx:number, cz:number, x:number, z:number) => boolean} clear
 * @param {(x:number, z:number, nx:number, nz:number) => ({x:number, z:number, nx:number, nz:number}|null)} wallBehind
 * @returns {{boxes:object[], atms:object[]}}
 */
export function furnitureOf(index, junctions = [], clear = () => true, wallBehind = () => null) {
  const S = CITY.street;
  const boxes = [], atms = [];
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
  const add = (p) => {
    const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  };
  let count = 0;
  for (const road of index.roads) {
    const pts = road.pts;
    let next = S.first * (0.4 + 0.6 * hash(pts[0] + 3.1, pts[1] - 1.7));
    let run = 0;
    for (let i = 1; i < road.n; i++) {
      const ax = pts[i * 2 - 2], az = pts[i * 2 - 1], bx = pts[i * 2], bz = pts[i * 2 + 1];
      const l = Math.hypot(bx - ax, bz - az);
      while (next <= run + l) {
        const t = (next - run) / (l || 1);
        const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
        next += S.every;
        const ux = (bx - ax) / (l || 1), uz = (bz - az) / (l || 1);
        const side = count++ % 2 ? 1 : -1;
        // Out of the road to one side, past the kerb.
        const nx = -uz * side, nz = ux * side;
        const off = (road.w || 7) / 2 + S.side;
        const x = cx + nx * off, z = cz + nz * off;
        if (junctions.some((j) => Math.hypot(j.x - x, j.z - z) < j.r + S.clear)) continue;
        if (near(x, z, S.apart)) continue;
        if (!clear(cx, cz, x, z)) continue;
        const seed = hash(x * 0.37, z * 0.53);
        if (count % S.atmEvery === 0) {
          const w = wallBehind(x, z, nx, nz);
          if (w) {
            const a = { x: w.x + w.nx * 0.18, z: w.z + w.nz * 0.18, yaw: Math.atan2(-w.nx, -w.nz), seed, empty: 0, spray: 0 };
            atms.push(a);
            add(a);
            continue;
          }
        }
        // Its doors to the road.
        const b = { x, z, yaw: Math.atan2(nx, nz), seed, fuse: 0, spent: 0, trap: 0 };
        boxes.push(b);
        add(b);
      }
      run += l;
    }
  }
  return { boxes, atms };
}

/** What a power box is doing: 0 nothing, 1 about to go, 2 a trap is set, 3 burnt out. */
export const boxState = (b) => (b.spent > 0 ? 3 : b.fuse > 0 ? 1 : b.trap > 0 ? 2 : 0);

/** Whether the phone can do anything with a box: not while it is burnt out or going. */
export const boxReady = (b) => b.spent <= 0 && b.fuse <= 0;

/**
 * A box, a step on.
 * @returns {'blow'|null} 'blow' the moment its fuse runs out
 */
export function boxStep(b, dt) {
  if (b.spent > 0) { b.spent = Math.max(0, b.spent - dt); return null; }
  if (b.fuse > 0) {
    b.fuse -= dt;
    if (b.fuse <= 0) {
      b.fuse = 0;
      b.trap = 0;
      b.spent = CITY.box.spent;
      return 'blow';
    }
    return null;
  }
  if (b.trap > 0) b.trap = Math.max(0, b.trap - dt);
  return null;
}

/**
 * What a box going off does to something this far from it.
 * @returns {{share:number, dx:number, dz:number, d:number}|null}
 */
export function zapOn(b, x, z, radius = CITY.zap.radius) {
  const dx = x - b.x, dz = z - b.z;
  const d = Math.hypot(dx, dz);
  if (d > radius) return null;
  const l = d || 1;
  return { share: 1 - d / radius, dx: d ? dx / l : 1, dz: d ? dz / l : 0, d };
}

/** What an ATM holds, the same every time for the same machine, in tens. */
export function atmCash(a) {
  const [lo, hi] = CITY.atm.cash;
  return Math.round((lo + hash(a.seed * 91.7, a.seed * 13.1) * (hi - lo)) / 10) * 10;
}

/** What an ATM is doing: 0 nothing, 1 spraying notes into the street, 2 empty. */
export const atmState = (a) => (a.spray > 0 ? 1 : a.empty > 0 ? 2 : 0);

export const atmReady = (a) => a.empty <= 0;

export function atmStep(a, dt) {
  if (a.spray > 0) a.spray = Math.max(0, a.spray - dt);
  if (a.empty > 0) a.empty = Math.max(0, a.empty - dt);
}

// --- the blockers ---------------------------------------------------------------

/**
 * A row of blockers across every road into every junction, a few metres
 * before it, flush with the road until the phone raises them.
 * @returns {{x:number, z:number, nx:number, nz:number, ax:number, az:number, w:number, up:number, left:number, j:object}[]}
 */
export function bollardsOf(junctions = []) {
  const B = CITY.bollards;
  const out = [];
  for (const j of junctions) {
    for (const l of j.legs || []) {
      const d = j.r + B.set;
      out.push({ x: j.x + l.dx * d, z: j.z + l.dz * d, nx: l.dx, nz: l.dz, ax: -l.dz, az: l.dx,
        w: l.w || 7, up: 0, left: 0, j });
    }
  }
  return out;
}

/** The posts of a row, where each one stands. */
export function postsOf(row) {
  const n = Math.max(3, Math.ceil((row.w - 0.6) / CITY.bollards.spacing) + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) - 0.5) * (row.w - 0.6);
    out.push({ x: row.x + row.ax * t, z: row.z + row.az * t });
  }
  return out;
}

/** A row, a step on: up while it has time left, down after. */
export function bollardStep(row, dt) {
  const B = CITY.bollards;
  if (row.left > 0) row.left = Math.max(0, row.left - dt);
  const want = row.left > 0 ? 1 : 0;
  const step = dt / B.rise;
  row.up = want > row.up ? Math.min(want, row.up + step) : Math.max(want, row.up - step);
}

/**
 * The posts of a row that are under a vehicle's body, each as where it is in
 * the vehicle's own frame (x to its right, z back from its middle). Posts
 * coming up there come up into the floor of it.
 * @param {{x:number, z:number, yaw:number}} v
 * @param {{L:number, W:number}} hull the box it stands in
 */
export function postsUnder(row, v, hull) {
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  const out = [];
  for (const p of postsOf(row)) {
    const dx = p.x - v.x, dz = p.z - v.z;
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    if (Math.abs(lx) < hull.W / 2 - 0.1 && Math.abs(lz) < hull.L / 2 - 0.15) out.push({ x: lx, z: lz });
  }
  return out;
}

/**
 * Whether a vehicle's nose has reached a row that is up: within a metre of
 * its line and within its width.
 * @param {{x:number, z:number, yaw:number, speed:number, spec:{length?:number}}} v
 */
export function intoBollards(row, v) {
  if (row.up < 0.6) return false;
  const dir = Math.sign(v.speed) || 1;
  const fx = -Math.sin(v.yaw) * dir, fz = -Math.cos(v.yaw) * dir;
  const half = ((v.spec && v.spec.length) || 4) * 0.5;
  const px = v.x + fx * half - row.x, pz = v.z + fz * half - row.z;
  const along = px * row.nx + pz * row.nz;
  const across = px * row.ax + pz * row.az;
  return Math.abs(along) < 0.9 && Math.abs(across) < row.w / 2 + 0.3;
}
