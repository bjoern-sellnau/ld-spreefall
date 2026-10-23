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
    roads.push({ cls: r.cls, w: r.w || 7, pts: r.pts, len, n: r.pts.length / 2, name: r.n || '' });
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
export function drive(v, index, others, dt, rand = Math.random, signals = null) {
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

  // The lights ahead, if any.
  const lights = signals ? lightsAhead(v, signals.junctions, signals.time) : { want: Infinity, reckless: false };
  want = Math.min(want, lights.want);

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
    // Green both ways, he has right of way, and anybody crossing is not his problem.
    if (lights.reckless && o.yaw !== undefined && Math.cos(o.yaw - v.yaw) < 0.7) continue;
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

// --- the lights ---------------------------------------------------------------
//
// A junction where a bigger road meets another gets lights, the way it does
// in Berlin: two directions, each its turn, with the German order of things
// (red, red and amber together for a second, green, three seconds of amber
// at 50 km/h, red), and two seconds of red both ways between them. The map
// fetch keeps roads and not the signal nodes, so where the lights are is
// worked out from where the lines meet.

export const SIGNALS = {
  green: 10, amber: 3, allRed: 2, redAmber: 1,
  meet: 6,                      // how close two lines come to meet
  merge: 15,                    // and two meetings this close are one junction
  link: 45,                     // and junctions this close one crossing: both carriageways of an avenue
  stop: 2,                      // where a car waits, short of the junction
  look: 18,                     // how far ahead a driver watches for a light
  near: 260,                    // junctions run and drawn round you
  classes: new Set(['primary', 'secondary', 'tertiary', 'trunk']),
};

/** The direction a heading belongs to at a junction: 0 along its axis, 1 across. */
export const phaseOf = (j, yaw) => (Math.abs(Math.cos(yaw - j.axis)) >= Math.SQRT1_2 ? 0 : 1);

/**
 * What a direction's light shows: 'green', 'amber', 'red', 'redAmber', or
 * 'off' when the junction is dark. A hacked junction shows whatever it was
 * told to, both ways.
 */
export function lightAt(j, phase, time) {
  if (j.dark) return 'off';
  if (j.hack) return j.hack.kind;
  const S = SIGNALS;
  const half = S.green + S.amber + S.allRed;
  const m = (((time + j.offset - phase * half) % (half * 2)) + half * 2) % (half * 2);
  if (m < S.green) return 'green';
  if (m < S.green + S.amber) return 'amber';
  if (m >= half * 2 - S.redAmber) return 'redAmber';
  return 'red';
}

/**
 * Every junction with lights: where two lines meet, one of them a bigger
 * road, with at least three ways out of it in two directions.
 * @returns {{x:number, z:number, r:number, axis:number, offset:number,
 *   legs:{yaw:number, dx:number, dz:number, w:number, phase:number, name:string}[], names:string[]}[]}
 */
export function junctionsOf(index) {
  const S = SIGNALS;
  const segs = [];
  index.roads.forEach((road, li) => {
    for (let i = 1; i < road.n; i++) {
      const a = pt(road, i - 1), b = pt(road, i);
      segs.push({ li, i, ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
  });
  // Segments by the cells along them.
  const G = 40;
  const grid = new Map();
  segs.forEach((s, k) => {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const steps = Math.max(1, Math.ceil(len / (G / 2)));
    const cells = new Set();
    for (let t = 0; t <= steps; t++) {
      const x = s.ax + ((s.bx - s.ax) * t) / steps, z = s.az + ((s.bz - s.az) * t) / steps;
      cells.add(`${Math.floor(x / G)},${Math.floor(z / G)}`);
    }
    for (const c of cells) {
      let list = grid.get(c);
      if (!list) { list = []; grid.set(c, list); }
      list.push(k);
    }
  });
  // Where any two lines meet: they cross, or one ends on the other.
  const meets = [];
  const near = (px, pz, s) => {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / l2));
    const x = s.ax + dx * t, z = s.az + dz * t;
    return { d: Math.hypot(px - x, pz - z), x, z };
  };
  const tried = new Set();
  for (const list of grid.values()) {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        const A = segs[list[p]], B = segs[list[q]];
        if (A.li === B.li) continue;
        const pair = list[p] < list[q] ? `${list[p]}:${list[q]}` : `${list[q]}:${list[p]}`;
        if (tried.has(pair)) continue;
        tried.add(pair);
        const rx = A.bx - A.ax, rz = A.bz - A.az, sx = B.bx - B.ax, sz = B.bz - B.az;
        const den = rx * sz - rz * sx;
        if (Math.abs(den) > 1e-6) {
          const t = ((B.ax - A.ax) * sz - (B.az - A.az) * sx) / den;
          const u = ((B.ax - A.ax) * rz - (B.az - A.az) * rx) / den;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { meets.push({ x: A.ax + rx * t, z: A.az + rz * t }); continue; }
        }
        for (const [S1, S2] of [[A, B], [B, A]]) {
          for (const [px, pz] of [[S1.ax, S1.az], [S1.bx, S1.bz]]) {
            const n = near(px, pz, S2);
            if (n.d <= S.meet) meets.push({ x: (px + n.x) / 2, z: (pz + n.z) / 2 });
          }
        }
      }
    }
  }
  // One junction for meetings close together.
  const groups = [];
  const byCell = new Map();
  for (const m of meets) {
    const cx = Math.floor(m.x / S.merge), cz = Math.floor(m.z / S.merge);
    let g = null;
    for (let a = -1; a <= 1 && !g; a++) {
      for (let b = -1; b <= 1 && !g; b++) {
        g = (byCell.get(`${cx + a},${cz + b}`) || []).find((o) => Math.hypot(o.x - m.x, o.z - m.z) < S.merge) || null;
      }
    }
    if (g) { g.sx += m.x; g.sz += m.z; g.n++; g.x = g.sx / g.n; g.z = g.sz / g.n; continue; }
    g = { x: m.x, z: m.z, sx: m.x, sz: m.z, n: 1 };
    groups.push(g);
    const k = `${cx},${cz}`;
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k).push(g);
  }
  const out = [];
  const reach = S.meet + 4;
  for (const g of groups) {
    // The ways out: along every line that passes, both ways along it unless
    // it ends here.
    const best = new Map();
    const cx = Math.floor(g.x / G), cz = Math.floor(g.z / G);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const k of grid.get(`${cx + a},${cz + b}`) || []) {
          const s = segs[k];
          const n = near(g.x, g.z, s);
          const was = best.get(s.li);
          if (n.d <= reach && (!was || n.d < was.d)) best.set(s.li, { d: n.d, s, x: n.x, z: n.z });
        }
      }
    }
    const legs = [];
    for (const [li, b] of best) {
      const road = index.roads[li];
      let dx = b.s.bx - b.s.ax, dz = b.s.bz - b.s.az;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const start = pt(road, 0), end = pt(road, road.n - 1);
      const atStart = Math.hypot(start.x - b.x, start.z - b.z) < reach;
      const atEnd = Math.hypot(end.x - b.x, end.z - b.z) < reach;
      if (!atEnd) legs.push({ dx, dz, w: road.w, cls: road.cls, name: road.name });
      if (!atStart) legs.push({ dx: -dx, dz: -dz, w: road.w, cls: road.cls, name: road.name });
    }
    if (legs.length < 3 || !legs.some((l) => S.classes.has(l.cls))) continue;
    // The axis is the widest road's; the other direction is whatever crosses it.
    const widest = legs.reduce((a, b) => (b.w > a.w ? b : a));
    const axis = headingTo(widest.dx, widest.dz);
    for (const l of legs) {
      l.yaw = headingTo(l.dx, l.dz);
      l.phase = Math.abs(Math.cos(l.yaw - axis)) >= Math.SQRT1_2 ? 0 : 1;
    }
    if (!legs.some((l) => l.phase === 1) || !legs.some((l) => l.phase === 0)) continue;
    const r = Math.max(...legs.map((l) => l.w)) / 2 + 1.5;
    const names = [...new Set(legs.map((l) => l.name).filter(Boolean))];
    const seed = Math.abs(Math.sin(g.x * 12.9898 + g.z * 78.233) * 43758.5453) % 1;
    out.push({ x: g.x, z: g.z, r, axis, legs, names, offset: seed * 2 * (S.green + S.amber + S.allRed), hack: null, dark: false });
  }
  // Junctions this close are one crossing with one set of lights: a street
  // across an avenue meets each of its carriageways, and lights that ran
  // apart would stop a car between the two on its own green. They share the
  // axis of the widest road among them, one timing, and whatever is done to
  // one of them.
  const parent = out.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let a = 0; a < out.length; a++) {
    for (let b = a + 1; b < out.length; b++) {
      if (Math.hypot(out[a].x - out[b].x, out[a].z - out[b].z) <= S.link) parent[root(a)] = root(b);
    }
  }
  const crossings = new Map();
  out.forEach((j, i) => {
    const k = root(i);
    if (!crossings.has(k)) crossings.set(k, []);
    crossings.get(k).push(j);
  });
  for (const group of crossings.values()) {
    let widest = null;
    for (const j of group) for (const l of j.legs) if (!widest || l.w > widest.w) widest = l;
    const axis = headingTo(widest.dx, widest.dz);
    const offset = group[0].offset;
    for (const j of group) {
      j.axis = axis;
      j.offset = offset;
      j.group = group;
      for (const l of j.legs) l.phase = Math.abs(Math.cos(l.yaw - axis)) >= Math.SQRT1_2 ? 0 : 1;
    }
  }
  return out;
}

/**
 * Where the masts stand: one for each way in, on the right of whoever is
 * coming, facing them.
 */
export function mastsOf(j) {
  return j.legs.map((l) => {
    const out = j.r + 1.5, side = l.w / 2 + 0.8;
    // Coming in along -leg, the right hand side is (leg.z, -leg.x).
    return { x: j.x + l.dx * out + l.dz * side, z: j.z + l.dz * out - l.dx * side, yaw: l.yaw, phase: l.phase, j };
  });
}

/**
 * How fast a driver may go for the lights ahead of him, if they say
 * anything: Infinity when they do not. A light that has been told to show
 * green both ways also tells him to pay no attention to anybody crossing.
 */
export function lightsAhead(v, junctions, time) {
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  const rx = -fz, rz = fx;
  const speed = Math.max(0, v.speed || 0);
  let want = Infinity, reckless = false;
  for (const j of junctions || []) {
    const dx = j.x - v.x, dz = j.z - v.z;
    const ahead = dx * fx + dz * fz;
    if (ahead < -j.r || ahead > j.r + SIGNALS.look + speed * 1.5) continue;
    if (Math.abs(dx * rx + dz * rz) > j.r + 4) continue;
    const light = lightAt(j, phaseOf(j, v.yaw), time);
    if (j.hack && j.hack.kind === 'green') reckless = true;
    // Nobody's turn: up to it and through it at a crawl, looking both ways.
    if (light === 'off') { want = Math.min(want, TRAFFIC.corner); continue; }
    const toLine = ahead - j.r - SIGNALS.stop;
    if (toLine < -0.5) continue;                 // over the line: on through
    if (light === 'red' || light === 'redAmber'
      || (light === 'amber' && toLine > (speed * speed) / (2 * 5) + 1)) {
      want = Math.min(want, Math.max(0, toLine * 0.7));
    }
  }
  return { want, reckless };
}
