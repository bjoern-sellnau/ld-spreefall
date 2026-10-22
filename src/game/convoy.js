// Help that drives in. When a camp's radio gets through, the men it sends
// come up the street in a jeep and jump down at the camp, and when it is
// serious a tank comes with them and shells you from the end of the road.
//
// The way there is found on a coarse grid over the streets rather than on
// the road graph: the centrelines are simplified at build time, so the point
// where two streets meet is often not a point either of them still has, and
// a graph built from shared points falls apart at every junction. A grid
// does not care. A cell a road runs through is cheap, open ground costs more,
// and a cell with a wall in it costs a great deal, so they keep to the
// streets and go through a building only when nothing else gets there (and
// they can: anything driven hard enough goes through a wall in this game).

/** What a convoy does, in numbers. */
export const CONVOY = {
  cell: 4,              // metres to a grid cell
  margin: 80,           // how far past the two ends the grid reaches
  road: 1,              // what a cell costs, on a road
  open: 4,              // and on open ground
  wall: 60,             // and through a wall
  from: [170, 240],     // how far from the camp they set out
  seat: 4,              // men in a jeep
  // Serious: the second wave of a call, or a camp at this level or above.
  tankFrom: 2,
  jeep: { cruise: 17, corner: 6, stop: 22, look: 10 },
  tank: { cruise: 9, corner: 4, stop: 55, look: 12 },
  // The tank's gun, gentler than the one you get: you have to live through it.
  shell: { interval: 5.2, speed: 120, spread: 0.018, splash: { radius: 8, damage: 60 }, range: 150, aim: 0.06 },
  stuck: { slow: 1.2, after: 1.6, back: 1.3 },
};

const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'bridleway', 'pedestrian']);

/** The shorter way round from one heading to another, in radians. */
export function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** The heading that points a hull along (dx, dz): its nose is (-sin, -cos). */
export function headingTo(dx, dz) {
  return Math.atan2(-dx, -dz);
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Is a point on a carriageway, within slack of its edge? */
export function onRoad(lines, x, z, slack = 1) {
  for (const r of lines) {
    if (FOOT.has(r.cls)) continue;
    const reach = r.w * 0.5 + slack;
    const p = r.pts;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
      if (Math.min(ax, bx) - reach > x || Math.max(ax, bx) + reach < x) continue;
      if (Math.min(az, bz) - reach > z || Math.max(az, bz) + reach < z) continue;
      if (segDist(x, z, ax, az, bx, bz) <= reach) return true;
    }
  }
  return false;
}

/**
 * A way from one point to another over the streets.
 *
 * @param {object} o
 * @param {Array} o.lines the road centrelines, {cls, w, pts}
 * @param {(minX,minZ,maxX,maxZ,fn)=>void} [o.walls] calls fn(x0,z0,x1,z1) per wall
 * @returns {{x:number,z:number}[]|null} points from start to end, or null
 */
export function planRoute({ lines, walls, fromX, fromZ, toX, toZ, cell = CONVOY.cell, margin = CONVOY.margin }) {
  const minX = Math.min(fromX, toX) - margin, maxX = Math.max(fromX, toX) + margin;
  const minZ = Math.min(fromZ, toZ) - margin, maxZ = Math.max(fromZ, toZ) + margin;
  const nx = Math.ceil((maxX - minX) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1;
  const cost = new Float32Array(nx * nz).fill(CONVOY.open);
  const at = (x, z) => [Math.floor((x - minX) / cell), Math.floor((z - minZ) / cell)];

  // The streets: every cell whose middle is on a carriageway.
  for (const r of lines) {
    if (FOOT.has(r.cls)) continue;
    const half = r.w * 0.5;
    const p = r.pts;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
      if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX) continue;
      if (Math.max(az, bz) < minZ || Math.min(az, bz) > maxZ) continue;
      const [i0, j0] = at(Math.min(ax, bx) - half, Math.min(az, bz) - half);
      const [i1, j1] = at(Math.max(ax, bx) + half, Math.max(az, bz) + half);
      for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++) {
        for (let k = Math.max(0, i0); k <= Math.min(nx - 1, i1); k++) {
          const cx = minX + (k + 0.5) * cell, cz = minZ + (j + 0.5) * cell;
          if (segDist(cx, cz, ax, az, bx, bz) <= Math.max(half, cell * 0.6)) cost[j * nx + k] = CONVOY.road;
        }
      }
    }
  }
  // The walls, walked along in steps of half a cell.
  if (walls) {
    walls(minX, minZ, maxX, maxZ, (x0, z0, x1, z1) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (cell * 0.5)));
      for (let s = 0; s <= n; s++) {
        const [k, j] = at(x0 + (x1 - x0) * s / n, z0 + (z1 - z0) * s / n);
        if (k >= 0 && k < nx && j >= 0 && j < nz) cost[j * nx + k] = CONVOY.wall;
      }
    });
  }

  // A star, eight ways round, with the straight line as the guess.
  const [sk, sj] = at(fromX, fromZ), [ek, ej] = at(toX, toZ);
  const clampI = (v, n) => Math.max(0, Math.min(n - 1, v));
  const start = clampI(sj, nz) * nx + clampI(sk, nx);
  const goal = clampI(ej, nz) * nx + clampI(ek, nx);
  const g = new Float32Array(nx * nz).fill(Infinity);
  const prev = new Int32Array(nx * nz).fill(-1);
  const shut = new Uint8Array(nx * nz);
  const heap = [];
  const push = (f, i) => {
    heap.push([f, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const guess = (i) => Math.hypot((i % nx) - (goal % nx), Math.floor(i / nx) - Math.floor(goal / nx));
  g[start] = 0;
  push(guess(start), start);
  const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [, i] = pop();
    if (shut[i]) continue;
    shut[i] = 1;
    if (i === goal) break;
    const k = i % nx, j = Math.floor(i / nx);
    for (const [dk, dj, d] of STEPS) {
      const kk = k + dk, jj = j + dj;
      if (kk < 0 || kk >= nx || jj < 0 || jj >= nz) continue;
      const n = jj * nx + kk;
      if (shut[n]) continue;
      const step = g[i] + d * (cost[n] + cost[i]) * 0.5;
      if (step < g[n]) { g[n] = step; prev[n] = i; push(step + guess(n), n); }
    }
  }
  if (prev[goal] < 0 && goal !== start) return null;
  const cells = [];
  for (let i = goal; i >= 0; i = prev[i]) { cells.push(i); if (i === start) break; }
  cells.reverse();
  const path = cells.map((i) => ({ x: minX + ((i % nx) + 0.5) * cell, z: minZ + (Math.floor(i / nx) + 0.5) * cell }));
  path[0] = { x: fromX, z: fromZ };
  path[path.length - 1] = { x: toX, z: toZ };
  // How much of the way is on a street, for the checks.
  path.road = cells.filter((i) => cost[i] === CONVOY.road).length / cells.length;
  return path;
}

/**
 * The controls for a vehicle following a path: which way to turn, how hard
 * to press, and when it has got there. Moves `run.at` along as it passes
 * points. Backs off and turns when it has been stuck against something.
 *
 * @param {object} v the vehicle, {x, z, yaw, speed}
 * @param {object} run {path, at, stuck, backing}
 * @param {object} spec CONVOY.jeep or CONVOY.tank
 * @param {{x:number,z:number}} goal where it is going in the end
 * @param {number} dt
 * @returns {{throttle:number, steer:number, brake:boolean, there:boolean}}
 */
export function follow(v, run, spec, goal, dt) {
  const left = Math.hypot(goal.x - v.x, goal.z - v.z);
  if (left <= spec.stop) {
    return { throttle: 0, steer: 0, brake: Math.abs(v.speed) > 0.3, there: Math.abs(v.speed) < 0.6 };
  }
  // The point to make for: the first one on the path at least the look
  // distance away, or the goal itself once the path has run out.
  const path = run.path || [];
  while (run.at < path.length - 1 && Math.hypot(path[run.at].x - v.x, path[run.at].z - v.z) < spec.look) run.at++;
  const aim = run.at < path.length && Math.hypot(path[path.length - 1].x - v.x, path[path.length - 1].z - v.z) > spec.look
    ? path[run.at] : goal;
  const err = wrap(headingTo(aim.x - v.x, aim.z - v.z) - v.yaw);

  // Stuck: pressing on and going nowhere. Back off for a moment, turned the
  // other way, and try again.
  if (run.backing > 0) {
    run.backing -= dt;
    return { throttle: -1, steer: -Math.sign(err || 1), brake: false, there: false };
  }
  if (Math.abs(v.speed) < CONVOY.stuck.slow) run.stuck += dt;
  else run.stuck = 0;
  if (run.stuck > CONVOY.stuck.after) {
    run.stuck = 0;
    run.backing = CONVOY.stuck.back;
  }

  // Slower into a corner than along a straight, and slowing for the stop.
  const bend = Math.min(1, Math.abs(err) / 1.2);
  let want = spec.cruise + (spec.corner - spec.cruise) * bend;
  want = Math.min(want, Math.max(spec.corner, (left - spec.stop) * 0.7));
  const steer = Math.max(-1, Math.min(1, err * 2.2));
  return {
    throttle: v.speed < want ? 1 : 0,
    steer,
    brake: v.speed > want + 3,
    there: false,
  };
}
