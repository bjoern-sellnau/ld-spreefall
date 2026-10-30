// Somewhere to stand out of the weather: bus shelters and kiosks with an
// awning, along the pavements of the real streets.
//
// A bus shelter is the kind Berlin has everywhere, a glass back and ends
// under a flat roof on a steel frame, with a bench and the stop's sign: a
// green H on a yellow disc, the way the road traffic regulations draw a
// stop. A kiosk is a booth with its awning out over the pavement. What
// counts is the roof: anybody under it is out of the rain, the acid, the
// embers and the bolts, for as long as it stands. A bolt or a tornado or a
// blast brings it down, and then it is no shelter at all.
//
// Arithmetic only, so the checks can run it.

export const SHELTERS = {
  // One every so many metres of street, starting part of the way along,
  // this far past the kerb, and none within so many metres of a junction or
  // another one.
  every: 130, first: 45, side: 2.6, clear: 16, apart: 60,
  // The kinds: how wide along the street, how deep, and how high the roof
  // is; and the stretch under the roof, in its own frame (x along the
  // street, z out towards the road negative).
  kinds: {
    stop: { w: 4.2, d: 1.6, h: 2.5, under: { x: 2.0, z0: -1.05, z1: 0.75 } },
    kiosk: { w: 3.2, d: 2.0, h: 2.7, under: { x: 1.55, z0: -2.5, z1: -1.0 } },
  },
  // How much a shelter takes before it comes down.
  health: 100,
};

const hash = (x, z) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Shelters along every road of an index: one every so far, on alternate
 * sides, facing the road, where `clear` says there is room.
 * @param {{roads:{pts:number[], n:number, w?:number}[]}} index
 * @param {{x:number, z:number, r:number}[]} junctions
 * @param {(cx:number, cz:number, x:number, z:number, bx:number, bz:number) => boolean} clear
 *   from the middle of the road to the spot, and the spot to just behind it
 */
export function sheltersOf(index, junctions = [], clear = () => true) {
  const S = SHELTERS;
  const out = [];
  let count = 0;
  for (const road of index.roads) {
    const pts = road.pts;
    let next = S.first + S.every * hash(pts[0] * 0.13, pts[1] * 0.17);
    let run = 0;
    for (let i = 1; i < road.n; i++) {
      const ax = pts[i * 2 - 2], az = pts[i * 2 - 1], bx = pts[i * 2], bz = pts[i * 2 + 1];
      const l = Math.hypot(bx - ax, bz - az);
      while (next <= run + l) {
        const t = (next - run) / (l || 1);
        next += S.every;
        const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
        const ux = (bx - ax) / (l || 1), uz = (bz - az) / (l || 1);
        const side = count++ % 2 ? 1 : -1;
        const nx = -uz * side, nz = ux * side;
        const off = (road.w || 7) / 2 + S.side;
        const x = cx + nx * off, z = cz + nz * off;
        if (junctions.some((j) => Math.hypot(j.x - x, j.z - z) < (j.r || 8) + S.clear)) continue;
        if (out.some((o) => Math.hypot(o.x - x, o.z - z) < S.apart)) continue;
        if (!clear(cx, cz, x, z, x + nx * 1.4, z + nz * 1.4)) continue;
        const seed = hash(x * 0.37, z * 0.53);
        const kind = seed < 0.34 ? 'kiosk' : 'stop';
        // Its open side to the road: its own minus z points at the kerb.
        out.push({ x, z, yaw: Math.atan2(nx, nz), kind, seed, health: S.health, broken: false });
      }
      run += l;
    }
  }
  return out;
}

/** A point in a shelter's own frame: x along the street, z towards the road negative. */
export function shelterLocal(sh, x, z) {
  // The shelter's minus z is (-sin yaw, -cos yaw) in the world, the same
  // turn as everything else drawn this way.
  const c = Math.cos(sh.yaw), s = Math.sin(sh.yaw);
  const dx = x - sh.x, dz = z - sh.z;
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

/** Whether a point is under a shelter's roof, below it, while it stands. */
export function covers(sh, x, y, z, ground = 0) {
  if (sh.broken) return false;
  const K = SHELTERS.kinds[sh.kind];
  const l = shelterLocal(sh, x, z);
  if (Math.abs(l.x) > K.under.x || l.z < K.under.z0 || l.z > K.under.z1) return false;
  return y < ground + K.h - 0.2;
}

/** The nearest standing shelter within reach of a point, or null. */
export function nearestShelter(list, x, z, reach = 80) {
  let best = null, bestD = reach;
  for (const sh of list) {
    if (sh.broken) continue;
    const d = Math.hypot(sh.x - x, sh.z - z);
    if (d < bestD) { bestD = d; best = sh; }
  }
  return best;
}

/** Where to stand to be under it: the middle of the stretch under its roof. */
export function standIn(sh, k = 0) {
  const K = SHELTERS.kinds[sh.kind];
  // Spread along it, so three people do not stand on one spot.
  const lx = ((k % 3) - 1) * K.under.x * 0.55;
  const lz = (K.under.z0 + K.under.z1) / 2;
  const c = Math.cos(sh.yaw), s = Math.sin(sh.yaw);
  return { x: sh.x + c * lx + s * lz, z: sh.z - s * lx + c * lz };
}

/** It takes so much; at nothing it comes down. Returns whether it did now. */
export function hurtShelter(sh, amount) {
  if (sh.broken) return false;
  sh.health -= amount;
  if (sh.health > 0) return false;
  sh.health = 0;
  sh.broken = true;
  return true;
}
