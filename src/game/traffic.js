// Traffic: cars and buses on the real streets, for .BACKDOOR.
//
// Each one drives a centreline out of the map in the right hand lane, a
// share of the road's width to the right of the line, and at the end of the
// line takes whichever other line starts or ends near it, or turns round if
// none does. It keeps its distance from whatever is in its lane ahead of
// it, waits for anybody standing in the road, and a bus stops every so
// often as if there were a stop there. What it drives is an ordinary
// vehicle: this only decides what its driver would do with the pedals and
// the wheel, so a hacked one, a crashed one or one you have taken out of
// the traffic is the same machine as any other.

import { wrap, headingTo } from './convoy.js';

export const TRAFFIC = {
  cars: 12, buses: 2,           // round you at once
  near: 45, far: 170,           // where they appear, and past where they are let go
  lane: 0.27,                   // a share of the road's width right of the line
  laneMost: 2.4,
  look: 9,                      // metres ahead it steers for
  cruise: { car: 12.5, bus: 8.5 },
  corner: 5,
  gap: 8,                       // what it leaves to the one in front, plus its speed
  join: 14,                     // how near the end of one line another must begin
  busStop: { every: 260, wait: 5 },
  paints: 6,                    // car colours, one of which is a taxi
};

const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'living_street',
]);
const BUS_ROADS = new Set(['primary', 'secondary', 'tertiary', 'trunk']);

const CELL = 20;
const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

/**
 * The lines a car may drive, and where each one begins and ends, so the end
 * of one can find the next.
 * @param {{cls:string, w:number, pts:number[]}[]} lines the map's road centrelines
 */
export function roadIndex(lines) {
  const roads = [];
  const ends = new Map();
  for (const r of lines || []) {
    if (!DRIVABLE.has(r.cls) || !r.pts || r.pts.length < 4) continue;
    let len = 0;
    for (let i = 2; i < r.pts.length; i += 2) len += Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1]);
    if (len < 12) continue;
    const li = roads.length;
    roads.push({ cls: r.cls, w: r.w || 7, pts: r.pts, len, n: r.pts.length / 2 });
    for (const end of [0, 1]) {
      const x = end ? r.pts[r.pts.length - 2] : r.pts[0];
      const z = end ? r.pts[r.pts.length - 1] : r.pts[1];
      const k = key(x, z);
      let cell = ends.get(k);
      if (!cell) { cell = []; ends.set(k, cell); }
      cell.push({ li, end, x, z });
    }
  }
  return { roads, ends };
}

/** Point i of a road. */
const pt = (road, i) => ({ x: road.pts[i * 2], z: road.pts[i * 2 + 1] });

/** How far right of the line the lane is. */
export function laneOffset(road) {
  return Math.min(TRAFFIC.laneMost, road.w * TRAFFIC.lane);
}

/**
 * Where a driver on a road is making for: the first point along it at least
 * the look distance ahead, moved into the right hand lane.
 * @param {object} road
 * @param {{i:number, dir:number}} run i is the point it is driving towards
 * @param {{x:number,z:number}} at where the vehicle is
 * @returns {{x:number, z:number, end:boolean}} end when the line has run out
 */
export function aimPoint(road, run, at, look = TRAFFIC.look) {
  let i = run.i;
  const last = run.dir > 0 ? road.n - 1 : 0;
  while (i !== last && Math.hypot(pt(road, i).x - at.x, pt(road, i).z - at.z) < look) i += run.dir;
  run.i = i;
  const p = pt(road, i);
  const prev = pt(road, Math.max(0, Math.min(road.n - 1, i - run.dir)));
  let dx = p.x - prev.x, dz = p.z - prev.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  // Right of travel is (-dz, dx): going north (-z) it is east (+x).
  const off = laneOffset(road);
  const end = i === last && Math.hypot(p.x - at.x, p.z - at.z) < look;
  return { x: p.x - dz * off, z: p.z + dx * off, end };
}

/**
 * The line to take at the end of this one: another that begins or ends
 * within the join distance, not the one it is on, picked at random; or this
 * one back the other way if there is none.
 */
export function nextLeg(index, li, dir, rand = Math.random) {
  const road = index.roads[li];
  const endPt = dir > 0 ? pt(road, road.n - 1) : pt(road, 0);
  const found = [];
  const cx = Math.floor(endPt.x / CELL), cz = Math.floor(endPt.z / CELL);
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      for (const e of index.ends.get(`${cx + a},${cz + b}`) || []) {
        if (e.li === li) continue;
        if (Math.hypot(e.x - endPt.x, e.z - endPt.z) > TRAFFIC.join) continue;
        found.push(e);
      }
    }
  }
  if (!found.length) {
    return { li, dir: -dir, i: dir > 0 ? road.n - 2 : 1 };
  }
  const e = found[Math.floor(rand() * found.length)];
  const next = index.roads[e.li];
  // Joined at its start it is driven forwards from there, at its end backwards.
  return e.end === 0 ? { li: e.li, dir: 1, i: 1 } : { li: e.li, dir: -1, i: next.n - 2 };
}

/**
 * Somewhere to put a new one: a point on a drivable road between near and
 * far from (px, pz) that the caller agrees to, facing along the road.
 * @param {(x:number,z:number)=>boolean} ok
 */
export function pickSpawn(index, px, pz, { near = TRAFFIC.near, far = TRAFFIC.far, rand = Math.random, ok = () => true, bus = false } = {}) {
  const roads = index.roads;
  if (!roads.length) return null;
  // Every stretch of road in the ring, then a few of them at random: a
  // random road out of the whole city is nearly always somewhere else.
  const ring = [];
  roads.forEach((road, li) => {
    if (bus && !BUS_ROADS.has(road.cls)) return;
    for (let i = 1; i < road.n; i++) {
      const a = pt(road, i - 1), b = pt(road, i);
      const d = Math.hypot((a.x + b.x) / 2 - px, (a.z + b.z) / 2 - pz);
      if (d >= near && d <= far) ring.push([li, i]);
    }
  });
  if (!ring.length) return null;
  for (let t = 0; t < 12; t++) {
    const [li, i] = ring[Math.floor(rand() * ring.length)];
    const road = roads[li];
    const a = pt(road, i - 1), b = pt(road, i);
    const x0 = (a.x + b.x) / 2, z0 = (a.z + b.z) / 2;
    const dir = rand() < 0.5 ? 1 : -1;
    const from = dir > 0 ? a : b, to = dir > 0 ? b : a;
    let dx = to.x - from.x, dz = to.z - from.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const off = laneOffset(road);
    const x = x0 - dz * off, z = z0 + dx * off;
    if (!ok(x, z)) continue;
    return { li, dir, i: dir > 0 ? i : i - 1, x, z, yaw: headingTo(dx, dz) };
  }
  return null;
}

/**
 * The longest straight stretch of carriageway near a point, of at least so
 * long: somewhere to stand by a road and watch it.
 * @returns {{ax:number, az:number, bx:number, bz:number, w:number, len:number}|null}
 */
export function straightNear(index, x, z, minLen = 40, within = 400) {
  let best = null;
  for (const road of index.roads) {
    for (let i = 1; i < road.n; i++) {
      const a = pt(road, i - 1), b = pt(road, i);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < minLen) continue;
      const d = Math.hypot((a.x + b.x) / 2 - x, (a.z + b.z) / 2 - z);
      if (d > within) continue;
      if (!best || d < best.d) best = { ax: a.x, az: a.z, bx: b.x, bz: b.z, w: road.w, len, d };
    }
  }
  return best;
}

/**
 * The lane nearest a point, facing whichever way along the road is nearer
 * the heading given: for putting one exactly where it is wanted.
 */
export function nearestLane(index, x, z, yaw = 0) {
  let best = null;
  index.roads.forEach((road, li) => {
    for (let i = 1; i < road.n; i++) {
      const a = pt(road, i - 1), b = pt(road, i);
      const dx = b.x - a.x, dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const px = a.x + dx * t, pz = a.z + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (best && d >= best.d) continue;
      const fwd = headingTo(dx, dz);
      const dir = Math.cos(wrap(fwd - yaw)) >= 0 ? 1 : -1;
      const l = Math.sqrt(l2);
      const ux = (dx / l) * dir, uz = (dz / l) * dir;
      const off = laneOffset(road);
      best = { d, li, dir, i: dir > 0 ? i : i - 1, x: px - uz * off, z: pz + ux * off, yaw: headingTo(ux, uz) };
    }
  });
  return best;
}

/**
 * What the driver does this step.
 * @param {object} v the vehicle, with v.traffic = { li, i, dir, ... }
 * @param {object} index from roadIndex
 * @param {{x:number,z:number,yaw?:number,speed?:number,r?:number}[]} others what else is on the road (vehicles, people)
 * @param {number} dt
 * @returns {{throttle:number, steer:number, brake:boolean}}
 */
export function drive(v, index, others, dt, rand = Math.random) {
  const t = v.traffic;
  const kind = v.type === 'bus' ? 'bus' : 'car';
  // Stalled by a hack, or crashed: the handbrake and nothing else.
  if (t.stalled > 0 || t.crashed) {
    t.stalled = Math.max(0, (t.stalled || 0) - dt);
    return { throttle: 0, steer: 0, brake: true };
  }
  // A bus at its stop.
  if (t.waiting > 0) {
    t.waiting -= dt;
    return { throttle: 0, steer: 0, brake: true };
  }
  let road = index.roads[t.li];
  if (!road) return { throttle: 0, steer: 0, brake: true };
  let aim = aimPoint(road, t, v);
  if (aim.end) {
    const n = nextLeg(index, t.li, t.dir, rand);
    t.li = n.li; t.dir = n.dir; t.i = n.i;
    road = index.roads[t.li];
    aim = aimPoint(road, t, v);
  }
  const err = wrap(headingTo(aim.x - v.x, aim.z - v.z) - v.yaw);
  const bend = Math.min(1, Math.abs(err) / 1.1);
  let want = TRAFFIC.cruise[kind] + (TRAFFIC.corner - TRAFFIC.cruise[kind]) * bend;

  // Whatever is in the lane ahead: the vehicle's own frame, forward along
  // its heading and right across it.
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  const rx = -fz, rz = fx;
  const reach = TRAFFIC.gap + Math.max(0, v.speed) * 1.1 + (v.spec ? v.spec.length * 0.5 : 2);
  let blocked = Infinity;
  for (const o of others) {
    if (o === v || o.ref === v) continue;
    const dx = o.x - v.x, dz = o.z - v.z;
    const ahead = dx * fx + dz * fz;
    if (ahead <= 0 || ahead > reach) continue;
    const side = Math.abs(dx * rx + dz * rz);
    if (side > 1.4 + (o.r || 0.4)) continue;
    // One coming the other way in its own lane is passed, not waited for.
    if (o.yaw !== undefined && Math.cos(o.yaw - v.yaw) < -0.5 && ahead > 6) continue;
    blocked = Math.min(blocked, ahead);
  }
  if (blocked < Infinity) want = Math.min(want, Math.max(0, (blocked - TRAFFIC.gap * 0.6) * 0.8));

  // A bus pulls in every so far.
  if (kind === 'bus') {
    t.since = (t.since || 0) + Math.max(0, v.speed) * dt;
    if (t.since > TRAFFIC.busStop.every) {
      t.since = 0;
      t.waiting = TRAFFIC.busStop.wait;
      t.stops = (t.stops || 0) + 1;
    }
  }
  const steer = Math.max(-1, Math.min(1, err * 2.2));
  return {
    throttle: v.speed < want - 0.3 ? 1 : 0,
    steer,
    brake: v.speed > want + 1.5 || (want < 0.5 && v.speed > 0.2),
  };
}
