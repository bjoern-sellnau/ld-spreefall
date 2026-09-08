// Builds an OSM XML document for the playable box without touching the network.
//
// The surveyed geometry in berlin-facts.mjs (street centrelines, landmark
// footprints, the Spree and the Spreekanal, the parks) is written out verbatim.
// The gaps between those streets are then filled with generated Berlin style
// perimeter blocks, so the city has the density it needs to be worth walking
// through. Everything downstream of the parser cannot tell the two apart, which
// is the point: the moment a real Overpass response lands in data/raw it is
// used instead and nothing else in the build changes.

import { BBOX, project } from './geo.mjs';
import {
  STREETS, PATHS, WATERWAYS, PARKS, BUILDINGS, MEMORIAL,
  STATIONS, RAILWAYS, LANDMARK_CARDS,
} from './berlin-facts.mjs';

const M_LAT = 110574.0;
const M_LON = 111320.0 * Math.cos(52.5163 * Math.PI / 180);
const mToLat = (m) => m / M_LAT;
const mToLon = (m) => m / M_LON;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class OsmDoc {
  constructor() {
    this.nodes = [];
    this.ways = [];
    this.relations = [];
    this.nid = 1000000;
    this.wid = 2000000;
    this.rid = 3000000;
  }
  node(lat, lon, tags = null) {
    const id = ++this.nid;
    this.nodes.push({ id, lat, lon, tags });
    return id;
  }
  way(refs, tags) {
    const id = ++this.wid;
    this.ways.push({ id, refs, tags });
    return id;
  }
  relation(members, tags) {
    const id = ++this.rid;
    this.relations.push({ id, members, tags });
    return id;
  }
  // A closed ring of [lon, lat] pairs becomes a way whose first and last refs match.
  ring(pts, tags) {
    const refs = pts.map(([lon, lat]) => this.node(lat, lon));
    refs.push(refs[0]);
    return this.way(refs, tags);
  }
  line(pts, tags) {
    return this.way(pts.map(([lon, lat]) => this.node(lat, lon)), tags);
  }
  toXml() {
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<osm version="0.6" generator="spreefall synth-osm">');
    out.push(`  <bounds minlat="${BBOX.south}" minlon="${BBOX.west}" maxlat="${BBOX.north}" maxlon="${BBOX.east}"/>`);
    for (const n of this.nodes) {
      const lat = n.lat.toFixed(7), lon = n.lon.toFixed(7);
      if (!n.tags || Object.keys(n.tags).length === 0) {
        out.push(`  <node id="${n.id}" lat="${lat}" lon="${lon}"/>`);
      } else {
        out.push(`  <node id="${n.id}" lat="${lat}" lon="${lon}">`);
        for (const k in n.tags) out.push(`    <tag k="${esc(k)}" v="${esc(n.tags[k])}"/>`);
        out.push('  </node>');
      }
    }
    for (const w of this.ways) {
      out.push(`  <way id="${w.id}">`);
      for (const r of w.refs) out.push(`    <nd ref="${r}"/>`);
      for (const k in w.tags) out.push(`    <tag k="${esc(k)}" v="${esc(w.tags[k])}"/>`);
      out.push('  </way>');
    }
    for (const r of this.relations) {
      out.push(`  <relation id="${r.id}">`);
      for (const m of r.members) out.push(`    <member type="${m.type}" ref="${m.ref}" role="${m.role}"/>`);
      for (const k in r.tags) out.push(`    <tag k="${esc(k)}" v="${esc(r.tags[k])}"/>`);
      out.push('  </relation>');
    }
    out.push('</osm>');
    return out.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Occupancy raster, used to keep generated blocks out of roads, water and parks.

const CELL = 2.0;   // metres

class Mask {
  constructor() {
    const [x0, z0] = project(BBOX.west, BBOX.north);
    const [x1, z1] = project(BBOX.east, BBOX.south);
    this.x0 = x0; this.z0 = z0;
    this.nx = Math.ceil((x1 - x0) / CELL) + 2;
    this.nz = Math.ceil((z1 - z0) / CELL) + 2;
    this.data = new Uint8Array(this.nx * this.nz);
  }
  idx(ix, iz) { return iz * this.nx + ix; }
  get(x, z) {
    const ix = Math.floor((x - this.x0) / CELL);
    const iz = Math.floor((z - this.z0) / CELL);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return 255;
    return this.data[this.idx(ix, iz)];
  }
  fillPolygon(pts, value, growM = 0) {
    // Scanline fill in raster space, then a cheap dilation for the margin.
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) { if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1]; }
    const g = growM;
    let iz0 = Math.max(0, Math.floor((minZ - g - this.z0) / CELL));
    let iz1 = Math.min(this.nz - 1, Math.ceil((maxZ + g - this.z0) / CELL));
    const xs = [];
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = this.z0 + (iz + 0.5) * CELL;
      xs.length = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[j], b = pts[i];
        if ((a[1] > z) === (b[1] > z)) continue;
        xs.push(a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const ix0 = Math.max(0, Math.floor((xs[k] - g - this.x0) / CELL));
        const ix1 = Math.min(this.nx - 1, Math.ceil((xs[k + 1] + g - this.x0) / CELL));
        for (let ix = ix0; ix <= ix1; ix++) this.data[this.idx(ix, iz)] = value;
      }
    }
    if (g > 0) {
      // Also stamp the outline so thin polygons keep their margin.
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        this.stampSegment(pts[j], pts[i], g, value);
      }
    }
  }
  // Exact capsule rasterisation: a cell is set when its centre is within half
  // metres of the segment. A disc per sample over dilated by a whole cell, which
  // is the difference between a dense city and an empty one.
  stampSegment(a, b, half, value) {
    const minX = Math.min(a[0], b[0]) - half, maxX = Math.max(a[0], b[0]) + half;
    const minZ = Math.min(a[1], b[1]) - half, maxZ = Math.max(a[1], b[1]) + half;
    const ix0 = Math.max(0, Math.floor((minX - this.x0) / CELL));
    const ix1 = Math.min(this.nx - 1, Math.ceil((maxX - this.x0) / CELL));
    const iz0 = Math.max(0, Math.floor((minZ - this.z0) / CELL));
    const iz1 = Math.min(this.nz - 1, Math.ceil((maxZ - this.z0) / CELL));
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const ee = ex * ex + ez * ez;
    const h2 = half * half;
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = this.z0 + (iz + 0.5) * CELL;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = this.x0 + (ix + 0.5) * CELL;
        let t = ee > 1e-9 ? ((x - a[0]) * ex + (z - a[1]) * ez) / ee : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (a[0] + ex * t), dz = z - (a[1] + ez * t);
        if (dx * dx + dz * dz <= h2) this.data[this.idx(ix, iz)] = value;
      }
    }
  }
  stampPolyline(pts, half, value) {
    for (let i = 1; i < pts.length; i++) this.stampSegment(pts[i - 1], pts[i], half, value);
  }
  rectFree(cx, cz, w, d, cosA, sinA) {
    const hw = w / 2, hd = d / 2;
    const stepsX = Math.max(2, Math.ceil(w / CELL));
    const stepsZ = Math.max(2, Math.ceil(d / CELL));
    for (let i = 0; i <= stepsX; i++) {
      const u = -hw + (w * i) / stepsX;
      for (let k = 0; k <= stepsZ; k++) {
        const v = -hd + (d * k) / stepsZ;
        const x = cx + u * cosA - v * sinA;
        const z = cz + u * sinA + v * cosA;
        if (this.get(x, z) !== 0) return false;
      }
    }
    return true;
  }
  stampRect(cx, cz, w, d, cosA, sinA, value) {
    const hw = w / 2, hd = d / 2;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [
      cx + u * cosA - v * sinA,
      cz + u * sinA + v * cosA,
    ]);
    this.fillPolygon(corners, value, 0.2);
  }
}

// Road half widths by class, metres.
export const ROAD_WIDTH = {
  motorway: 16, trunk: 15, primary: 14, secondary: 10, tertiary: 8.5,
  residential: 7, living_street: 6, service: 4.5, unclassified: 7,
  pedestrian: 8, footway: 2.5, cycleway: 2, path: 2, steps: 2.5, track: 3,
};

const PALETTE = [
  '#d9c9a3', '#e2d6ba', '#cdbfa2', '#c8b894', '#dcd2bd', '#c2b49a',
  '#b9a98c', '#d6c6a8', '#a97f5e', '#96604a', '#c9c2b4', '#d2cbbb',
];

// ---------------------------------------------------------------------------

export function buildSyntheticOsm() {
  const doc = new OsmDoc();
  const mask = new Mask();
  const rnd = mulberry32(20260908);

  const toWorld = (pts) => pts.map(([lon, lat]) => project(lon, lat));

  // Water first, it beats everything else.
  const waterRings = [];
  for (const w of WATERWAYS) {
    const world = toWorld(w.pts);
    const ring = offsetRibbon(world, w.half);
    waterRings.push(ring);
    const lonlat = ring.map((p) => worldToLonLat(p));
    doc.ring(lonlat, {
      natural: 'water', water: 'river', name: w.name, 'waterway': 'riverbank',
    });
    doc.line(w.pts, { waterway: 'river', name: w.name });
    mask.fillPolygon(ring, 3, 6);
  }

  // Parks.
  for (const p of PARKS) {
    const world = toWorld(p.ring);
    doc.ring(p.ring, p.kind === 'park'
      ? { leisure: 'park', name: p.name }
      : { landuse: 'grass', name: p.name });
    mask.fillPolygon(world, 2, 3);
  }

  // Streets and paths.
  const streetWorld = [];
  for (const s of STREETS) {
    if (s.cls === 'pedestrian_area') {
      doc.ring(s.pts, { highway: 'pedestrian', area: 'yes', name: s.name, surface: s.surface });
      mask.fillPolygon(toWorld(s.pts), 1, 2);
      continue;
    }
    const tags = { highway: s.cls, name: s.name, surface: s.surface };
    if (s.lanes) tags.lanes = String(s.lanes);
    tags.width = String(ROAD_WIDTH[s.cls] || 7);
    doc.line(s.pts, tags);
    const world = toWorld(s.pts);
    streetWorld.push({ def: s, world });
    mask.stampPolyline(world, (ROAD_WIDTH[s.cls] || 7) / 2 + 1.2, 1);
  }
  for (const p of PATHS) {
    doc.line(p.pts, { highway: p.cls, surface: p.surface, name: p.name });
    mask.stampPolyline(toWorld(p.pts), 1.8, 1);
  }

  // Railways.
  for (const r of RAILWAYS) {
    doc.line(r.pts, { railway: r.kind, name: r.name, bridge: r.kind === 'rail' ? 'yes' : 'no' });
    mask.stampPolyline(toWorld(r.pts), 5, 1);
  }

  // The memorial outline. The stelae themselves are generated by build-world.
  doc.ring(MEMORIAL.ring, {
    historic: 'memorial', 'memorial': 'stelae_field', name: MEMORIAL.name,
    'spreefall:stelae': String(MEMORIAL.count),
    'spreefall:stela_w': String(MEMORIAL.stelaW),
    'spreefall:stela_d': String(MEMORIAL.stelaD),
    'spreefall:stela_gap': String(MEMORIAL.gap),
  });
  mask.fillPolygon(toWorld(MEMORIAL.ring), 4, 4);

  // Named buildings.
  for (const b of BUILDINGS) {
    const [cx, cz] = project(b.lon, b.lat);
    const rot = (b.rot || 0) * Math.PI / 180;
    const cosA = Math.cos(rot), sinA = Math.sin(rot);
    const hw = b.w / 2, hd = b.d / 2;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [
      cx + u * cosA - v * sinA,
      cz + u * sinA + v * cosA,
    ]);
    const lonlat = corners.map(worldToLonLat);
    const tags = {
      building: 'yes', name: b.name, height: String(b.h),
      'building:levels': String(Math.max(1, Math.round(b.h / 4.2))),
      'building:material': b.material,
      'building:colour': b.colour,
      'spreefall:landmark': b.key,
      'spreefall:kind': b.kind,
    };
    if (b.kind === 'courtyard') {
      // Real courtyard blocks: an inner ring makes it a multipolygon.
      const ihw = hw - 16, ihd = hd - 16;
      if (ihw > 6 && ihd > 6) {
        const inner = [[-ihw, -ihd], [ihw, -ihd], [ihw, ihd], [-ihw, ihd]].map(([u, v]) => [
          cx + u * cosA - v * sinA,
          cz + u * sinA + v * cosA,
        ]).map(worldToLonLat);
        const outerWay = doc.ring(lonlat, {});
        const innerWay = doc.ring(inner, {});
        doc.relation(
          [{ type: 'way', ref: outerWay, role: 'outer' }, { type: 'way', ref: innerWay, role: 'inner' }],
          { type: 'multipolygon', ...tags },
        );
        mask.stampRect(cx, cz, b.w + 6, b.d + 6, cosA, sinA, 4);
        continue;
      }
    }
    doc.ring(lonlat, tags);
    mask.stampRect(cx, cz, b.w + 6, b.d + 6, cosA, sinA, 4);
  }

  // Trees. Four rows of limes down Unter den Linden, plus the Tiergarten and
  // street rows elsewhere.
  let treeCount = 0;
  const lindenSpine = toWorld(STREETS.find((s) => s.name === 'Unter den Linden').pts);
  for (const off of [-13, -5.5, 5.5, 13]) {
    for (const p of sampleAlong(offsetLine(lindenSpine, off), 9.5)) {
      const [lon, lat] = worldToLonLat(p);
      doc.node(lat, lon, { natural: 'tree', species: 'Tilia', 'spreefall:row': 'linden' });
      treeCount++;
    }
  }
  for (const s of streetWorld) {
    if (s.def.cls !== 'secondary' && s.def.cls !== 'primary') continue;
    if (s.def.name === 'Unter den Linden') continue;
    const off = (ROAD_WIDTH[s.def.cls] || 7) / 2 + 3.2;
    for (const side of [-1, 1]) {
      for (const p of sampleAlong(offsetLine(s.world, off * side), 16)) {
        if (mask.get(p[0], p[1]) === 3) continue;
        const [lon, lat] = worldToLonLat(p);
        doc.node(lat, lon, { natural: 'tree' });
        treeCount++;
      }
    }
  }
  for (const park of PARKS) {
    const world = toWorld(park.ring);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of world) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
    }
    const area = (maxX - minX) * (maxZ - minZ);
    const n = Math.min(1400, Math.floor(area / 380));
    for (let i = 0; i < n; i++) {
      const x = minX + rnd() * (maxX - minX);
      const z = minZ + rnd() * (maxZ - minZ);
      if (!pointInRing(x, z, world)) continue;
      if (mask.get(x, z) === 1 || mask.get(x, z) === 3) continue;
      const [lon, lat] = worldToLonLat([x, z]);
      doc.node(lat, lon, { natural: 'tree' });
      treeCount++;
    }
  }

  // Stations.
  for (const st of STATIONS) {
    doc.node(st.lat, st.lon, {
      railway: st.kind === 'station' ? 'station' : 'subway_entrance',
      name: st.name,
      ...(st.kind === 'subway' ? { station: 'subway' } : {}),
    });
  }

  // Landmark points, so the card system has anchors even without footprints.
  for (const c of LANDMARK_CARDS) {
    doc.node(c.lat, c.lon, {
      tourism: 'attraction', name: c.name,
      'spreefall:card': c.key,
      'spreefall:radius': String(c.radius),
      'spreefall:text': c.text,
    });
  }

  // Generated perimeter blocks along every street with a frontage.
  const generated = fillBlocks(doc, mask, streetWorld, rnd);

  return doc.toXml();
}

function fillBlocks(doc, mask, streets, rnd) {
  let made = 0;
  let attempts = 0;
  const order = streets.slice().sort((a, b) => lineLength(b.world) - lineLength(a.world));
  for (const s of order) {
    const cls = s.def.cls;
    if (cls === 'footway' || cls === 'cycleway') continue;
    const halfRoad = (ROAD_WIDTH[cls] || 7) / 2;
    const setback = halfRoad + 2.6;
    for (const side of [-1, 1]) {
      const front = offsetLine(s.world, setback * side);
      let t = 4 + rnd() * 8;
      const total = lineLength(front);
      while (t < total - 8) {
        const width = 13 + rnd() * 18;          // frontage along the street
        const depth = 15 + rnd() * 13;          // into the block
        const at = pointAt(front, t + width / 2);
        if (!at) break;
        const [px, pz, dx, dz] = at;
        // The building sits behind the frontage line, away from the road.
        const nx = -dz * side, nz = dx * side;
        const cx = px + nx * (depth / 2);
        const cz = pz + nz * (depth / 2);
        const cosA = dx, sinA = dz;
        attempts++;
        if (mask.rectFree(cx, cz, width - 1.6, depth - 1.6, cosA, sinA)) {
          emitBlock(doc, cx, cz, width, depth, cosA, sinA, rnd, cls);
          mask.stampRect(cx, cz, width, depth, cosA, sinA, 4);
          made++;
          t += width + 0.3 + rnd() * 1.0;
        } else {
          t += 6;
        }
      }
    }
  }
  if (process.env.SPREEFALL_DEBUG) console.error(`blocks: ${made} placed of ${attempts} attempts`);
  return made;
}

function emitBlock(doc, cx, cz, w, d, cosA, sinA, rnd, roadClass) {
  const hw = w / 2, hd = d / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [
    cx + u * cosA - v * sinA,
    cz + u * sinA + v * cosA,
  ]).map(worldToLonLat);

  // Berlin capped its eaves at 22 m for a century, which is why the skyline is
  // so flat. Five to seven levels covers most of it.
  const r = rnd();
  let levels;
  if (r < 0.06) levels = 3 + Math.floor(rnd() * 2);
  else if (r < 0.82) levels = 5 + Math.floor(rnd() * 2);
  else if (r < 0.96) levels = 7;
  else levels = 8 + Math.floor(rnd() * 2);
  const kindRoll = rnd();
  const building = kindRoll < 0.55 ? 'apartments'
    : kindRoll < 0.8 ? 'residential'
    : kindRoll < 0.94 ? 'office' : 'retail';
  const roofRoll = rnd();
  const roof = roofRoll < 0.5 ? 'flat' : roofRoll < 0.82 ? 'gabled' : 'hipped';
  const tags = {
    building,
    'building:levels': String(levels),
    'building:colour': PALETTE[Math.floor(rnd() * PALETTE.length)],
    'building:material': rnd() < 0.14 ? 'brick' : 'plaster',
    'roof:shape': roof,
  };
  if (roof !== 'flat') tags['roof:height'] = (3.5 + rnd() * 3.5).toFixed(1);
  if (roadClass === 'primary' || roadClass === 'secondary') tags.shop = 'yes';
  doc.ring(corners, tags);
}

// ---------------------------------------------------------------------------
// Small geometry helpers in world metres.

function worldToLonLat([x, z]) {
  return [13.3777 + x / M_LON, 52.5163 - z / M_LAT];
}

function lineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

function pointAt(pts, dist) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    if (acc + len >= dist) {
      const t = (dist - acc) / len;
      return [pts[i - 1][0] + dx * t, pts[i - 1][1] + dz * t, dx / len, dz / len];
    }
    acc += len;
  }
  return null;
}

function sampleAlong(pts, spacing) {
  const out = [];
  const total = lineLength(pts);
  for (let t = spacing * 0.5; t < total; t += spacing) {
    const p = pointAt(pts, t);
    if (p) out.push([p[0], p[1]]);
  }
  return out;
}

// Offset a polyline sideways. Positive is to the left of travel.
function offsetLine(pts, off) {
  if (Math.abs(off) < 1e-6) return pts.slice();
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    out.push([p[0] - dz * off, p[1] + dx * off]);
  }
  return out;
}

// A closed ring around a polyline of the given half width.
function offsetRibbon(pts, half) {
  const left = offsetLine(pts, half);
  const right = offsetLine(pts, -half).reverse();
  return left.concat(right);
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a[1] > z) !== (b[1] > z)) {
      const xx = a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
      if (x < xx) inside = !inside;
    }
  }
  return inside;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const xml = buildSyntheticOsm();
  process.stdout.write(xml);
}
