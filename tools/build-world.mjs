// The world builder. Reads the cached OSM, produces public/world.bin and
// public/world.json, and prints the stats the brief asks for.

import fs from 'node:fs';
import path from 'node:path';
import { parseOsmXml, counts } from './osm-xml.mjs';
import { annotate } from './annotate.mjs';
import { project, BBOX, worldBounds, ORIGIN } from './geo.mjs';
import { Mesh } from './mesh.mjs';
import { Terrain } from './terrain.mjs';
import { fbm2, hashInt } from './noise.mjs';
import {
  extrudeBuilding, ribbon, groundPolygon, box, ringArea, ringCentroid,
  orientedBox, ringLength,
} from './geometry.mjs';
import { LANDMARK_BUILDERS } from './landmarks.mjs';
import { ROAD_WIDTH } from './synth-osm.mjs';
import {
  TILE_SIZE, VERTEX_STRIDE, POS_SCALE, UV_SCALE, HEIGHT_SCALE,
  COLLISION_GRID, GROUND_SCALE, MAT, SURFACE, FACADE_FLAG, MATERIAL_NAMES,
} from '../src/shared/constants.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW_FILE = path.join(ROOT, 'data', 'raw', 'berlin-center.osm');
const OUT_DIR = path.join(ROOT, 'public');

// ---------------------------------------------------------------------------
// Tag helpers

const LEVEL_HEIGHT = 3.2;

const DEFAULT_HEIGHT_BY_TYPE = {
  church: 20, cathedral: 34, chapel: 12, temple: 18,
  apartments: 5 * LEVEL_HEIGHT, residential: 5 * LEVEL_HEIGHT,
  house: 2 * LEVEL_HEIGHT, detached: 2 * LEVEL_HEIGHT, terrace: 3 * LEVEL_HEIGHT,
  office: 6 * LEVEL_HEIGHT, commercial: 5 * LEVEL_HEIGHT, retail: 3 * LEVEL_HEIGHT,
  hotel: 6 * LEVEL_HEIGHT, industrial: 8, warehouse: 8, garage: 3, garages: 3,
  roof: 4, shed: 3, hut: 3, kiosk: 3, service: 3, carport: 2.6,
  university: 5 * LEVEL_HEIGHT, school: 4 * LEVEL_HEIGHT, hospital: 6 * LEVEL_HEIGHT,
  civic: 5 * LEVEL_HEIGHT, government: 5 * LEVEL_HEIGHT, public: 5 * LEVEL_HEIGHT,
  museum: 20, train_station: 18, palace: 26, castle: 26,
  yes: 5 * LEVEL_HEIGHT,
};

function parseLength(v) {
  if (v === undefined || v === null) return NaN;
  const s = String(v).trim().toLowerCase();
  let m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*m?$/);
  if (m) return parseFloat(m[1]);
  m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*'?\s*(?:([0-9]+(?:\.[0-9]+)?)\s*")?$/);
  if (m && s.includes("'")) return parseFloat(m[1]) * 0.3048 + (m[2] ? parseFloat(m[2]) * 0.0254 : 0);
  m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*ft$/);
  if (m) return parseFloat(m[1]) * 0.3048;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

function buildingHeight(tags) {
  const h = parseLength(tags.height);
  if (Number.isFinite(h) && h > 0.5) return h;
  const levels = parseFloat(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return levels * LEVEL_HEIGHT + 1.0;
  const type = tags.building && tags.building !== 'yes' ? tags.building : (tags['building:part'] || 'yes');
  if (DEFAULT_HEIGHT_BY_TYPE[type] !== undefined) return DEFAULT_HEIGHT_BY_TYPE[type];
  if (tags.amenity === 'place_of_worship') return 20;
  return DEFAULT_HEIGHT_BY_TYPE.yes;
}

function buildingLevels(tags, height) {
  const levels = parseFloat(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return Math.round(levels);
  return Math.max(1, Math.round((height - 1.0) / LEVEL_HEIGHT));
}

const BERLIN_PALETTE = [
  [0.855, 0.796, 0.663], [0.886, 0.843, 0.741], [0.804, 0.749, 0.639],
  [0.784, 0.722, 0.580], [0.863, 0.827, 0.749], [0.761, 0.706, 0.604],
  [0.725, 0.663, 0.549], [0.839, 0.776, 0.659], [0.663, 0.498, 0.369],
  [0.588, 0.376, 0.290], [0.788, 0.765, 0.706], [0.824, 0.796, 0.733],
];

function parseColour(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^#([0-9a-fA-F]{6})$/);
  if (m) {
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  m = s.match(/^#([0-9a-fA-F]{3})$/);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(((n >> 8) & 15) * 17) / 255, (((n >> 4) & 15) * 17) / 255, ((n & 15) * 17) / 255];
  }
  const named = {
    white: [0.94, 0.93, 0.90], grey: [0.6, 0.6, 0.6], gray: [0.6, 0.6, 0.6],
    yellow: [0.88, 0.82, 0.55], red: [0.62, 0.32, 0.26], brown: [0.55, 0.42, 0.32],
    beige: [0.87, 0.82, 0.70], cream: [0.92, 0.89, 0.78], sandstone: [0.82, 0.76, 0.62],
    green: [0.45, 0.55, 0.42], blue: [0.45, 0.55, 0.65], black: [0.22, 0.22, 0.22],
  };
  return named[s.toLowerCase()] || null;
}

const MATERIAL_BY_TAG = {
  brick: MAT.BRICK, glass: MAT.GLASS, concrete: MAT.CONCRETE,
  stone: MAT.SANDSTONE, sandstone: MAT.SANDSTONE, limestone: MAT.SANDSTONE,
  plaster: MAT.FACADE, metal: MAT.METAL, wood: MAT.FACADE,
};

function surfaceId(tags) {
  const s = (tags.surface || '').toLowerCase();
  if (s === 'sett' || s === 'cobblestone' || s === 'paving_stones' || s === 'unhewn_cobblestone') return SURFACE.COBBLE;
  if (s === 'grass' || s === 'ground' || s === 'dirt' || s === 'earth') return SURFACE.GRASS;
  if (s === 'gravel' || s === 'fine_gravel' || s === 'compacted' || s === 'sand') return SURFACE.GRAVEL;
  return SURFACE.ASPHALT;
}

function roadMaterial(tags) {
  const s = surfaceId(tags);
  if (s === SURFACE.COBBLE) return MAT.COBBLE;
  if (s === SURFACE.GRASS) return MAT.GRASS;
  if (s === SURFACE.GRAVEL) return MAT.GRAVEL;
  return MAT.ASPHALT;
}

// ---------------------------------------------------------------------------

function main() {
  const t0 = Date.now();
  if (!fs.existsSync(RAW_FILE)) {
    console.error(`missing ${RAW_FILE}, run: node tools/fetch-osm.mjs`);
    process.exit(1);
  }
  const src = fs.readFileSync(RAW_FILE, 'utf8');
  const osm = parseOsmXml(src);
  const c = counts(osm);
  console.log(`parsed ${(src.length / 1e6).toFixed(2)} MB: nodes ${c.nodes}  ways ${c.ways}  relations ${c.relations}`);

  // Attach the surveyed facts before anything is classified, so a build from
  // the live extract carries the same landmarks, cards and stelae field as one
  // from the offline fallback.
  annotate(osm, { log: (line) => console.log(line) });

  const world = worldBounds();
  const pos = new Map();
  for (const [id, n] of osm.nodes) pos.set(id, project(n.lon, n.lat));

  const wayRing = (way) => {
    const ring = [];
    for (const ref of way.refs) {
      const p = pos.get(ref);
      if (p) ring.push([p[0], p[1]]);
    }
    return ring;
  };

  // --- classify -----------------------------------------------------------
  const buildings = [];     // {outer, holes, tags}
  const roads = [];
  const areas = [];         // pedestrian areas
  const waterPolys = [];
  const greens = [];
  const rails = [];
  const trees = [];
  const memorials = [];
  const attractions = [];
  const stations = [];

  const usedInRelation = new Set();
  for (const rel of osm.relations.values()) {
    if (rel.tags.type !== 'multipolygon') continue;
    for (const m of rel.members) if (m.type === 'way') usedInRelation.add(m.ref);
  }

  const relRings = (rel) => {
    const outers = [], inners = [];
    for (const m of rel.members) {
      if (m.type !== 'way') continue;
      const w = osm.ways.get(m.ref);
      if (!w) continue;
      const ring = wayRing(w);
      if (ring.length < 3) continue;
      (m.role === 'inner' ? inners : outers).push(ring);
    }
    return { outers, inners };
  };

  for (const rel of osm.relations.values()) {
    const t = rel.tags;
    if (t.type !== 'multipolygon') continue;
    const { outers, inners } = relRings(rel);
    if (!outers.length) continue;
    if (t.building || t['building:part']) {
      for (const o of outers) {
        buildings.push({ outer: o, holes: inners.filter((h) => ringInside(h, o)), tags: t });
      }
    } else if (t.natural === 'water' || t.waterway === 'riverbank') {
      for (const o of outers) waterPolys.push({ ring: o, holes: inners, tags: t });
    } else if (t.leisure === 'park' || t.landuse === 'grass' || t.leisure === 'garden') {
      for (const o of outers) greens.push({ ring: o, holes: inners, tags: t });
    }
  }

  for (const way of osm.ways.values()) {
    const t = way.tags;
    if (!t || Object.keys(t).length === 0) continue;
    const ring = wayRing(way);
    if (ring.length < 2) continue;
    const closed = way.refs.length > 3 && way.refs[0] === way.refs[way.refs.length - 1];

    if (t.building || t['building:part']) {
      if (closed && ring.length >= 4) buildings.push({ outer: ring.slice(0, -1), holes: [], tags: t });
      continue;
    }
    if (t.historic === 'memorial' && t.memorial === 'stelae_field' && closed) {
      memorials.push({ ring: ring.slice(0, -1), tags: t });
      continue;
    }
    if (t.natural === 'water' || t.waterway === 'riverbank' || t.water) {
      if (closed) waterPolys.push({ ring: ring.slice(0, -1), holes: [], tags: t });
      continue;
    }
    if (t.waterway) continue;   // the centreline, we use the polygon
    if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass'
        || t.landuse === 'forest' || t.landuse === 'meadow' || t.landuse === 'village_green') {
      if (closed) greens.push({ ring: ring.slice(0, -1), holes: [], tags: t });
      continue;
    }
    if (t.railway === 'rail' || t.railway === 'tram' || t.railway === 'light_rail' || t.railway === 'subway') {
      if (t.railway !== 'subway') rails.push({ line: ring, tags: t });
      continue;
    }
    if (t.highway) {
      if (t.area === 'yes' && closed) { areas.push({ ring: ring.slice(0, -1), tags: t }); continue; }
      roads.push({ line: ring, tags: t });
      continue;
    }
  }

  for (const n of osm.nodes.values()) {
    const t = n.tags;
    if (!t) continue;
    const p = pos.get(n.id);
    if (!p) continue;
    if (t.natural === 'tree') { trees.push({ p, tags: t }); continue; }
    if (t['spreefall:card'] || (t.tourism === 'attraction' && t.name)) { attractions.push({ p, tags: t }); continue; }
    if (t.railway === 'station' || t.railway === 'subway_entrance') { stations.push({ p, tags: t }); }
  }

  console.log(`features: buildings ${buildings.length}  roads ${roads.length}  areas ${areas.length}  water ${waterPolys.length}  green ${greens.length}  rails ${rails.length}  trees ${trees.length}`);

  // --- terrain ------------------------------------------------------------
  let memBox = null;
  if (memorials.length) {
    const r = memorials[0].ring;
    memBox = bboxOf(r);
    memBox.ring = r;
  }
  const terrain = new Terrain(memBox, waterPolys);
  const yAt = (x, z) => terrain.height(x, z);

  const mesh = new Mesh();
  const collision = [];    // {x1,z1,x2,z2,base,top,surface}

  // --- ground base --------------------------------------------------------
  // The fallback surface under everything, as a quad grid. It has to be fine
  // enough that its linear interpolation of the terrain never rises above the
  // road ribbons drawn a hundred millimetres below the true ground, so 12.5 m,
  // and cells that something else already covers are simply not emitted. That
  // second part removes about a third of the world's triangles.
  const gstep = 12.5;
  const gnx = Math.ceil(world.width / gstep);
  const gnz = Math.ceil(world.depth / gstep);
  const cover = buildCoverage(world, roads, areas, greens, waterPolys, buildings, memorials);
  let groundCells = 0, skippedCells = 0;
  for (let iz = 0; iz < gnz; iz++) {
    for (let ix = 0; ix < gnx; ix++) {
      const x0 = world.minX + ix * gstep, x1 = x0 + gstep;
      const z0 = world.minZ + iz * gstep, z1 = z0 + gstep;
      if (cover.cellCovered(x0, z0, gstep)) { skippedCells++; continue; }
      // Nine centimetres down. The grid interpolates the terrain linearly over
      // 12.5 m and the terrain is not linear, so a base plane drawn at the true
      // height pokes through the roads and squares laid on top of it. Ninety
      // millimetres clears that error and is far too small a step to see where
      // the base plane is actually exposed.
      groundPolygon(mesh, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [], MAT.PAVEMENT, yAt, { lift: -0.09 });
      groundCells++;
    }
  }
  console.log(`ground: ${groundCells} base cells drawn, ${skippedCells} skipped as already covered`);

  // --- green -------------------------------------------------------------
  for (const g of greens) {
    groundPolygon(mesh, g.ring, g.holes, MAT.GRASS, yAt, { lift: 0.05, seed: 5 });
  }

  // --- water --------------------------------------------------------------
  const waterLevel = terrain.waterLevel;
  for (const w of waterPolys) {
    groundPolygon(mesh, w.ring, w.holes, MAT.WATER, () => waterLevel, { lift: 0 });
    // The bank: a skirt from the quay edge down to the water, and a wall for
    // collision so the player cannot walk into the Spree.
    const ring = w.ring;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.05) continue;
      const ya = yAt(a[0], a[1]), yb = yAt(b[0], b[1]);
      const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
      const v0 = mesh.vertex(a[0], ya + 0.25, a[1], nx, 0.2, nz, 0, 0, MAT.CONCRETE, 9, 0, FACADE_FLAG.NO_WINDOWS, 2, 200);
      const v1 = mesh.vertex(b[0], yb + 0.25, b[1], nx, 0.2, nz, len, 0, MAT.CONCRETE, 9, 0, FACADE_FLAG.NO_WINDOWS, 2, 200);
      const v2 = mesh.vertex(b[0], waterLevel - 1.5, b[1], nx, 0.2, nz, len, 2.5, MAT.CONCRETE, 9, 0, FACADE_FLAG.NO_WINDOWS, 2, 120);
      const v3 = mesh.vertex(a[0], waterLevel - 1.5, a[1], nx, 0.2, nz, 0, 2.5, MAT.CONCRETE, 9, 0, FACADE_FLAG.NO_WINDOWS, 2, 120);
      mesh.quad(v3, v2, v1, v0);
      collision.push({ x1: a[0], z1: a[1], x2: b[0], z2: b[1], base: waterLevel - 2, top: Math.max(ya, yb) + 1.2, surface: SURFACE.WATER });
    }
  }

  // --- roads --------------------------------------------------------------
  let roadMetres = 0;
  const roadLines = [];
  for (const r of roads) {
    const cls = r.tags.highway;
    const explicit = parseLength(r.tags.width);
    const width = Number.isFinite(explicit) && explicit > 1 ? explicit : (ROAD_WIDTH[cls] || 6);
    const mat = roadMaterial(r.tags);
    const isFoot = cls === 'footway' || cls === 'path' || cls === 'cycleway' || cls === 'steps';
    const lift = isFoot ? 0.06 : 0.0;
    ribbon(mesh, r.line, width / 2, mat, yAt, { lift, flags: 0, seed: hashInt(Math.round(r.line[0][0]), Math.round(r.line[0][1])) & 255 });
    if (!isFoot) {
      // Kerb and pavement either side.
      for (const side of [-1, 1]) {
        const off = offsetLine(r.line, (width / 2 + 1.6) * side);
        ribbon(mesh, off, 1.7, MAT.PAVEMENT, yAt, { lift: 0.12 });
      }
    }
    roadMetres += polylineLength(r.line);
    if (!isFoot) {
      roadLines.push({
        cls,
        w: width,
        pts: simplify(r.line, 1.5).flatMap((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]),
      });
    }
  }
  for (const a of areas) {
    groundPolygon(mesh, a.ring, [], roadMaterial(a.tags), yAt, { lift: 0.05, seed: 3 });
  }

  // --- rails --------------------------------------------------------------
  for (const r of rails) {
    const elevated = r.tags.bridge === 'yes' || r.tags.railway === 'rail';
    if (elevated) {
      // The Stadtbahn runs on a brick viaduct 6 m above the street.
      const line = r.line;
      const yv = (x, z) => yAt(x, z) + 6.2;
      ribbon(mesh, line, 6.0, MAT.GRAVEL, yv, { lift: 0 });
      for (const side of [-1, 1]) {
        const off = offsetLine(line, 6.0 * side);
        for (let i = 1; i < off.length; i++) {
          const a = off[i - 1], b = off[i];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 0.1) continue;
          const nx = (b[1] - a[1]) / len * side, nz = -(b[0] - a[0]) / len * side;
          const ya = yAt(a[0], a[1]), yb = yAt(b[0], b[1]);
          const v0 = mesh.vertex(a[0], ya, a[1], nx, 0, nz, 0, 0, MAT.BRICK, 21, 0, FACADE_FLAG.NO_WINDOWS, 6.2, 190);
          const v1 = mesh.vertex(b[0], yb, b[1], nx, 0, nz, len, 0, MAT.BRICK, 21, 0, FACADE_FLAG.NO_WINDOWS, 6.2, 190);
          const v2 = mesh.vertex(b[0], yb + 6.6, b[1], nx, 0, nz, len, 6.6, MAT.BRICK, 21, 0, FACADE_FLAG.NO_WINDOWS, 6.2, 255);
          const v3 = mesh.vertex(a[0], ya + 6.6, a[1], nx, 0, nz, 0, 6.6, MAT.BRICK, 21, 0, FACADE_FLAG.NO_WINDOWS, 6.2, 255);
          mesh.quad(v3, v2, v1, v0);
          collision.push({ x1: a[0], z1: a[1], x2: b[0], z2: b[1], base: -2, top: 6.6, surface: SURFACE.STONE });
        }
      }
    } else {
      ribbon(mesh, r.line, 3.1, MAT.GRAVEL, yAt, { lift: 0.05 });
    }
    // Rails themselves.
    for (const gauge of [-0.7175, 0.7175]) {
      const off = offsetLine(r.line, gauge);
      ribbon(mesh, off, 0.075, MAT.METAL, elevated ? (x, z) => yAt(x, z) + 6.35 : yAt, { lift: 0.11 });
    }
  }

  // --- buildings ----------------------------------------------------------
  let buildingCount = 0;
  const landmarkIndex = [];
  const palette = new Palette(BERLIN_PALETTE);
  for (const b of buildings) {
    const ring = b.outer;
    if (ring.length < 3) continue;
    const area = ringArea(ring);
    if (area < 6) continue;
    const [cx, cz] = ringCentroid(ring);
    if (cx < world.minX - 60 || cx > world.maxX + 60 || cz < world.minZ - 60 || cz > world.maxZ + 60) continue;
    const base = yAt(cx, cz);
    const tags = b.tags;
    const height = buildingHeight(tags);
    const levels = buildingLevels(tags, height);
    const minH = parseLength(tags.min_height);
    const seed = hashInt(Math.round(cx * 4), Math.round(cz * 4)) & 255;

    const lmKey = tags['spreefall:landmark'];
    const kind = tags['spreefall:kind'];
    const builder = kind ? LANDMARK_BUILDERS[kind] : null;
    if (builder) {
      builder(mesh, ring, base, {
        h: height, w: 0, d: 0, lat: cz, material: tags['building:material'], key: lmKey,
      });
      pushFootprintCollision(collision, ring, base - 1, base + height, SURFACE.STONE);
      buildingCount++;
      landmarkIndex.push({ key: lmKey || kind, name: tags.name || '', x: cx, z: cz, h: height });
      continue;
    }

    const colour = parseColour(tags['building:colour'] || tags.colour);
    const matTag = MATERIAL_BY_TAG[(tags['building:material'] || '').toLowerCase()];
    const wallMat = matTag !== undefined ? matTag : MAT.FACADE;
    // The low six bits of the seed index the facade palette, the top two carry
    // the per building variation the window shader uses.
    const colourIdx = colour ? palette.indexOf(colour) : palette.pick(seed);
    const packedSeed = (colourIdx & 63) | ((seed & 3) << 6);
    const roofShape = (tags['roof:shape'] || 'flat').toLowerCase();
    const roofHeight = parseLength(tags['roof:height']);
    extrudeBuilding(mesh, { outer: ring, holes: b.holes }, {
      base: base + (Number.isFinite(minH) ? minH : 0),
      height: Math.max(2, height - (Number.isFinite(minH) ? minH : 0)),
      roofShape,
      roofHeight: Number.isFinite(roofHeight) ? roofHeight : (roofShape === 'flat' ? 0 : 4.5),
      wallMat, roofMat: MAT.ROOF,
      seed: packedSeed,
      levels,
      landmark: false,
      noWindows: wallMat === MAT.CONCRETE,
    });
    pushFootprintCollision(collision, ring, base - 1, base + height, SURFACE.STONE);
    for (const h of b.holes) pushFootprintCollision(collision, h, base - 1, base + height, SURFACE.STONE);
    buildingCount++;
  }

  // --- the stelae field ---------------------------------------------------
  // The memorial floor is the one place where the terrain has detail finer than
  // the base grid can carry, because the whole point of it is that the ground
  // rolls. It gets its own 2.5 m grid, clipped to the outline, and the base
  // plane is kept out of the way by the coverage mask.
  let stelae = 0;
  for (const m of memorials) {
    const bb = bboxOf(m.ring);
    const fine = 2.5;
    const nxm = Math.ceil((bb.maxX - bb.minX) / fine);
    const nzm = Math.ceil((bb.maxZ - bb.minZ) / fine);
    for (let j = 0; j < nzm; j++) {
      for (let i = 0; i < nxm; i++) {
        const x0 = bb.minX + i * fine, x1 = Math.min(bb.maxX, x0 + fine);
        const z0 = bb.minZ + j * fine, z1 = Math.min(bb.maxZ, z0 + fine);
        if (!pointInRing((x0 + x1) / 2, (z0 + z1) / 2, m.ring)) continue;
        groundPolygon(mesh, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [], MAT.COBBLE, yAt,
          { lift: 0.01, seed: 11 });
      }
    }
    stelae += buildStelae(mesh, collision, m, terrain);
  }

  // --- trees --------------------------------------------------------------
  const treeList = [];
  for (const t of trees) {
    const [x, z] = t.p;
    if (x < world.minX || x > world.maxX || z < world.minZ || z > world.maxZ) continue;
    const h = hashInt(Math.round(x * 8), Math.round(z * 8));
    const isLinden = t.tags['spreefall:row'] === 'linden';
    const height = isLinden ? 13 + (h & 31) / 31 * 4 : 7 + (h & 63) / 63 * 9;
    treeList.push({
      x: Math.round(x * 16) / 16,
      y: Math.round(yAt(x, z) * 16) / 16,
      z: Math.round(z * 16) / 16,
      h: Math.round(height * 8) / 8,
      seed: h & 255,
      kind: isLinden ? 1 : 0,
    });
    collision.push({ x1: x - 0.32, z1: z - 0.32, x2: x + 0.32, z2: z - 0.32, base: -1, top: 3, surface: SURFACE.STONE });
    collision.push({ x1: x + 0.32, z1: z - 0.32, x2: x + 0.32, z2: z + 0.32, base: -1, top: 3, surface: SURFACE.STONE });
    collision.push({ x1: x + 0.32, z1: z + 0.32, x2: x - 0.32, z2: z + 0.32, base: -1, top: 3, surface: SURFACE.STONE });
    collision.push({ x1: x - 0.32, z1: z + 0.32, x2: x - 0.32, z2: z - 0.32, base: -1, top: 3, surface: SURFACE.STONE });
  }

  console.log(`geometry: ${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles, ${buildingCount} buildings, ${stelae} stelae, ${treeList.length} trees, ${(roadMetres / 1000).toFixed(1)} km of road`);

  // --- surface map for footsteps -----------------------------------------
  const surfaceGrid = buildSurfaceGrid(world, roads, areas, greens, waterPolys, memorials);

  // --- tiling and writing -------------------------------------------------
  const bundle = tileAndPack(mesh, collision, treeList, world, terrain, surfaceGrid);

  const manifest = {
    version: 3,
    generator: 'spreefall build-world',
    origin: ORIGIN,
    bbox: BBOX,
    world: {
      minX: round2(world.minX), minZ: round2(world.minZ),
      maxX: round2(world.maxX), maxZ: round2(world.maxZ),
    },
    tileSize: TILE_SIZE,
    tileCountX: bundle.tileCountX,
    tileCountZ: bundle.tileCountZ,
    vertexStride: VERTEX_STRIDE,
    posScale: POS_SCALE,
    uvScale: UV_SCALE,
    heightScale: HEIGHT_SCALE,
    groundScale: GROUND_SCALE,
    collisionGrid: COLLISION_GRID,
    waterLevel,
    materials: MATERIAL_NAMES,
    facadePalette: palette.list.map((c) => c.map((v) => Math.round(v * 255))),
    landmarks: buildLandmarkCards(attractions, landmarkIndex),
    stations: stations.map((s) => ({ name: s.tags.name || '', x: round2(s.p[0]), z: round2(s.p[1]), kind: s.tags.railway })),
    roadLines,
    waterOutlines: waterPolys.map((w) => flatRing(simplify(w.ring, 2.5))),
    greenOutlines: greens.map((g) => flatRing(simplify(g.ring, 3.0))),
    surfaceGrid: {
      step: surfaceGrid.step, nx: surfaceGrid.nx, nz: surfaceGrid.nz,
      offset: bundle.surfaceOffset, length: surfaceGrid.data.length,
    },
    totals: {
      triangles: mesh.triangleCount,
      vertices: mesh.vertexCount,
      buildings: buildingCount,
      stelae,
      trees: treeList.length,
      roadKm: Math.round(roadMetres / 100) / 10,
      collisionSegments: collision.length,
    },
    tiles: bundle.tiles,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'world.bin'), bundle.buffer);
  fs.writeFileSync(path.join(OUT_DIR, 'world.json'), JSON.stringify(manifest));

  const binMB = bundle.buffer.length / 1e6;
  const jsonMB = fs.statSync(path.join(OUT_DIR, 'world.json')).size / 1e6;
  console.log('');
  console.log(`tiles           ${bundle.tiles.length} of ${bundle.tileCountX} by ${bundle.tileCountZ} (${bundle.nonEmpty} non empty)`);
  console.log(`triangles       ${mesh.triangleCount}`);
  console.log(`vertices        ${mesh.vertexCount}`);
  console.log(`collision segs  ${collision.length}`);
  console.log(`world.bin       ${binMB.toFixed(2)} MB`);
  console.log(`world.json      ${jsonMB.toFixed(2)} MB`);
  console.log(`total payload   ${(binMB + jsonMB).toFixed(2)} MB`);
  console.log(`max tile        ${bundle.maxTileKB.toFixed(1)} kB, ${bundle.maxTileTris} triangles`);
  console.log(`mean tile       ${bundle.meanTileKB.toFixed(1)} kB`);
  console.log(`built in        ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------------------

function round2(v) { return Math.round(v * 100) / 100; }

/**
 * A coverage raster of everything that draws its own ground: roads and their
 * pavements, pedestrian areas, parks, water, building footprints and the
 * memorial. Used to drop base ground cells nobody will ever see.
 */
function buildCoverage(world, roads, areas, greens, waterPolys, buildings, memorials) {
  const step = 3.125;
  const nx = Math.ceil(world.width / step) + 2;
  const nz = Math.ceil(world.depth / step) + 2;
  const data = new Uint8Array(nx * nz);
  const put = (x, z) => {
    const ix = Math.round((x - world.minX) / step);
    const iz = Math.round((z - world.minZ) / step);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return;
    data[iz * nx + ix] = 1;
  };
  const fillRing = (ring, grow = 0) => {
    const bb = bboxOf(ring);
    for (let z = bb.minZ - grow; z <= bb.maxZ + grow; z += step) {
      for (let x = bb.minX - grow; x <= bb.maxX + grow; x += step) {
        if (grow > 0 ? pointNearRing(x, z, ring, grow) : pointInRing(x, z, ring)) put(x, z);
      }
    }
  };
  for (const g of greens) fillRing(g.ring);
  for (const w of waterPolys) fillRing(w.ring);
  for (const a of areas) fillRing(a.ring);
  for (const m of memorials) fillRing(m.ring);
  for (const b of buildings) if (b.outer.length >= 3) fillRing(b.outer, 1.5);
  for (const r of roads) {
    const cls = r.tags.highway;
    const explicit = parseLength(r.tags.width);
    const width = Number.isFinite(explicit) && explicit > 1 ? explicit : (ROAD_WIDTH[cls] || 6);
    const half = width / 2 + 3.6;
    for (let i = 1; i < r.line.length; i++) {
      const a = r.line[i - 1], b = r.line[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const steps = Math.max(1, Math.ceil(len / step));
      const nx2 = -(b[1] - a[1]) / len, nz2 = (b[0] - a[0]) / len;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
        for (let o = -half; o <= half; o += step) put(px + nx2 * o, pz + nz2 * o);
      }
    }
  }
  return {
    cellCovered(x0, z0, size) {
      // Every sample inside the cell, plus its edges, has to be covered.
      const n = Math.max(2, Math.round(size / step));
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          const x = x0 + (size * i) / n;
          const z = z0 + (size * j) / n;
          const ix = Math.round((x - world.minX) / step);
          const iz = Math.round((z - world.minZ) / step);
          if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return false;
          if (!data[iz * nx + ix]) return false;
        }
      }
      return true;
    },
  };
}

function pointNearRing(x, z, ring, r) {
  if (pointInRing(x, z, ring)) return true;
  const r2 = r * r;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const ee = ex * ex + ez * ez;
    let t = ee > 1e-9 ? ((x - a[0]) * ex + (z - a[1]) * ez) / ee : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (a[0] + ex * t), dz = z - (a[1] + ez * t);
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

function flatRing(ring) {
  const out = [];
  for (const p of ring) { out.push(Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10); }
  return out;
}

/**
 * A 64 entry facade palette. Exact colours are deduplicated, anything past the
 * cap snaps to the nearest entry, so a building:colour from OSM always shows up
 * as itself or as the closest thing the palette has.
 */
class Palette {
  constructor(seedColours) {
    this.list = [];
    this.byKey = new Map();
    for (const c of seedColours) this.indexOf(c);
  }
  key(c) {
    return `${Math.round(c[0] * 31)}_${Math.round(c[1] * 31)}_${Math.round(c[2] * 31)}`;
  }
  indexOf(c) {
    const k = this.key(c);
    const hit = this.byKey.get(k);
    if (hit !== undefined) return hit;
    if (this.list.length < 64) {
      this.list.push(c);
      this.byKey.set(k, this.list.length - 1);
      return this.list.length - 1;
    }
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.list.length; i++) {
      const d = (this.list[i][0] - c[0]) ** 2 + (this.list[i][1] - c[1]) ** 2 + (this.list[i][2] - c[2]) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    this.byKey.set(k, best);
    return best;
  }
  pick(seed) { return seed % Math.max(1, this.list.length); }
}

function bboxOf(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of ring) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1];
  }
  return { minX, maxX, minZ, maxZ };
}

function ringInside(inner, outer) {
  const p = inner[0];
  return pointInRing(p[0], p[1], outer);
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

function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

function offsetLine(pts, off) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    out.push([p[0] - dz * off, p[1] + dx * off]);
  }
  return out;
}

// Ramer Douglas Peucker, for the minimap polylines.
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let best = -1, bestD = eps;
    const a = pts[i0], b = pts[i1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i][0] - a[0]) * dz - (pts[i][1] - a[1]) * dx) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function pushFootprintCollision(collision, ring, base, top, surface) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) continue;
    collision.push({ x1: a[0], z1: a[1], x2: b[0], z2: b[1], base, top, surface });
  }
}

// Eisenman's grid, clipped to the OSM outline, on the undulating floor.
function buildStelae(mesh, collision, memorial, terrain) {
  const t = memorial.tags;
  const target = parseInt(t['spreefall:stelae'] || '2711', 10);
  const sw = parseFloat(t['spreefall:stela_w'] || '0.95');
  const sd = parseFloat(t['spreefall:stela_d'] || '2.38');
  const gap = parseFloat(t['spreefall:stela_gap'] || '0.95');
  const ring = memorial.ring;
  const bb = bboxOf(ring);
  const pitchX = sw + gap;
  const pitchZ = sd + gap;
  const cols = Math.floor((bb.maxX - bb.minX) / pitchX);
  const rows = Math.floor((bb.maxZ - bb.minZ) / pitchZ);
  const ox = bb.minX + ((bb.maxX - bb.minX) - cols * pitchX) / 2 + pitchX / 2;
  const oz = bb.minZ + ((bb.maxZ - bb.minZ) - rows * pitchZ) / 2 + pitchZ / 2;

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const x = ox + cIdx * pitchX;
      const z = oz + r * pitchZ;
      if (!pointInRing(x, z, ring)) continue;
      cells.push([x, z]);
    }
  }
  // Keep the outermost cells so the field reads as a rectangle, and drop from
  // the inside if the grid overshoots the real count.
  if (cells.length > target) {
    const cx = (bb.minX + bb.maxX) / 2, cz = (bb.minZ + bb.maxZ) / 2;
    cells.sort((a, b) => {
      const da = Math.hypot(a[0] - cx, a[1] - cz), db = Math.hypot(b[0] - cx, b[1] - cz);
      return db - da;
    });
    cells.length = target;
  }

  let n = 0;
  for (const [x, z] of cells) {
    const ground = terrain.height(x, z);
    // The stelae are all roughly the same absolute top, so the field height
    // comes from the floor dipping away, exactly like the real one.
    const u = (x - bb.minX) / (bb.maxX - bb.minX);
    const v = (z - bb.minZ) / (bb.maxZ - bb.minZ);
    const top = 0.35 + 1.55 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)
      + (fbm2(x / 18, z / 18, 2, 313) - 0.5) * 0.9;
    const h = Math.max(0.25, top - ground);
    box(mesh, x, ground, z, sw, h, sd, MAT.STELE, {
      seed: hashInt(Math.round(x * 4), Math.round(z * 4)) & 255,
      flags: FACADE_FLAG.NO_WINDOWS,
    });
    const hw = sw / 2, hd = sd / 2;
    const corners = [[x - hw, z - hd], [x + hw, z - hd], [x + hw, z + hd], [x - hw, z + hd]];
    if (h > 0.5) pushFootprintCollision(collision, corners, ground, ground + h, SURFACE.STONE);
    n++;
  }
  return n;
}

// A coarse raster of what the player is standing on, for footstep sounds and
// for the ground shader to blend surfaces.
function buildSurfaceGrid(world, roads, areas, greens, waterPolys, memorials) {
  const step = 2.5;
  const nx = Math.ceil(world.width / step) + 1;
  const nz = Math.ceil(world.depth / step) + 1;
  const data = new Uint8Array(nx * nz).fill(SURFACE.ASPHALT);
  const put = (x, z, v) => {
    const ix = Math.round((x - world.minX) / step);
    const iz = Math.round((z - world.minZ) / step);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return;
    data[iz * nx + ix] = v;
  };
  const fillRing = (ring, v) => {
    const bb = bboxOf(ring);
    for (let z = bb.minZ; z <= bb.maxZ; z += step) {
      for (let x = bb.minX; x <= bb.maxX; x += step) {
        if (pointInRing(x, z, ring)) put(x, z, v);
      }
    }
  };
  for (const g of greens) fillRing(g.ring, SURFACE.GRASS);
  for (const a of areas) fillRing(a.ring, surfaceId(a.tags));
  for (const r of roads) {
    const cls = r.tags.highway;
    const explicit = parseLength(r.tags.width);
    const width = Number.isFinite(explicit) && explicit > 1 ? explicit : (ROAD_WIDTH[cls] || 6);
    const s = surfaceId(r.tags);
    for (let i = 1; i < r.line.length; i++) {
      const a = r.line[i - 1], b = r.line[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
        const nx2 = -(b[1] - a[1]) / (len || 1), nz2 = (b[0] - a[0]) / (len || 1);
        for (let o = -width / 2; o <= width / 2 + 3.4; o += step) {
          put(px + nx2 * o, pz + nz2 * o, o > width / 2 ? SURFACE.STONE : s);
          put(px - nx2 * o, pz - nz2 * o, o > width / 2 ? SURFACE.STONE : s);
        }
      }
    }
  }
  for (const w of waterPolys) fillRing(w.ring, SURFACE.WATER);
  for (const m of memorials) fillRing(m.ring, SURFACE.STONE);
  return { step, nx, nz, data };
}

function buildLandmarkCards(attractions, landmarkIndex) {
  const out = [];
  for (const a of attractions) {
    const t = a.tags;
    out.push({
      key: t['spreefall:card'] || (t.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name: t.name || 'Landmark',
      x: round2(a.p[0]), z: round2(a.p[1]),
      radius: parseFloat(t['spreefall:radius'] || '45'),
      text: t['spreefall:text'] || '',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tiling and binary packing

function tileAndPack(mesh, collision, trees, world, terrain, surfaceGrid) {
  const tileCountX = Math.ceil(world.width / TILE_SIZE);
  const tileCountZ = Math.ceil(world.depth / TILE_SIZE);
  const tileOf = (x, z) => {
    let tx = Math.floor((x - world.minX) / TILE_SIZE);
    let tz = Math.floor((z - world.minZ) / TILE_SIZE);
    tx = Math.max(0, Math.min(tileCountX - 1, tx));
    tz = Math.max(0, Math.min(tileCountZ - 1, tz));
    return tz * tileCountX + tx;
  };

  // Bucket triangles.
  const buckets = new Array(tileCountX * tileCountZ);
  const tri = mesh.idx;
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i], b = tri[i + 1], c = tri[i + 2];
    const cx = (mesh.px[a] + mesh.px[b] + mesh.px[c]) / 3;
    const cz = (mesh.pz[a] + mesh.pz[b] + mesh.pz[c]) / 3;
    const t = tileOf(cx, cz);
    (buckets[t] || (buckets[t] = [])).push(i);
  }

  // Collision per tile, by segment midpoint, with a copy into every tile the
  // segment overlaps so a wall on a boundary is never missed.
  const colBuckets = new Array(tileCountX * tileCountZ);
  for (const s of collision) {
    const minX = Math.min(s.x1, s.x2), maxX = Math.max(s.x1, s.x2);
    const minZ = Math.min(s.z1, s.z2), maxZ = Math.max(s.z1, s.z2);
    const tx0 = Math.max(0, Math.floor((minX - world.minX) / TILE_SIZE));
    const tx1 = Math.min(tileCountX - 1, Math.floor((maxX - world.minX) / TILE_SIZE));
    const tz0 = Math.max(0, Math.floor((minZ - world.minZ) / TILE_SIZE));
    const tz1 = Math.min(tileCountZ - 1, Math.floor((maxZ - world.minZ) / TILE_SIZE));
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = tz * tileCountX + tx;
        (colBuckets[t] || (colBuckets[t] = [])).push(s);
      }
    }
  }

  const treeBuckets = new Array(tileCountX * tileCountZ);
  for (const t of trees) {
    const k = tileOf(t.x, t.z);
    (treeBuckets[k] || (treeBuckets[k] = [])).push(t);
  }

  const chunks = [];
  let offset = 0;
  const tiles = [];
  let nonEmpty = 0;
  let maxTileBytes = 0, maxTileTris = 0, totalTileBytes = 0;

  for (let tz = 0; tz < tileCountZ; tz++) {
    for (let tx = 0; tx < tileCountX; tx++) {
      const t = tz * tileCountX + tx;
      const originX = world.minX + tx * TILE_SIZE;
      const originZ = world.minZ + tz * TILE_SIZE;
      const list = buckets[t];
      const rec = { tx, tz };
      let bytesThisTile = 0;

      if (list && list.length) {
        nonEmpty++;
        const remap = new Map();
        const order = [];
        for (const i of list) {
          for (let k = 0; k < 3; k++) {
            const v = tri[i + k];
            if (!remap.has(v)) { remap.set(v, order.length); order.push(v); }
          }
        }
        const vcount = order.length;
        const vbuf = Buffer.alloc(vcount * VERTEX_STRIDE);
        let minY = Infinity, maxY = -Infinity;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let k = 0; k < vcount; k++) {
          const v = order[k];
          const lx = mesh.px[v] - originX;
          const ly = mesh.py[v];
          const lz = mesh.pz[v] - originZ;
          if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
          if (lx < minX) minX = lx; if (lx > maxX) maxX = lx;
          if (lz < minZ) minZ = lz; if (lz > maxZ) maxZ = lz;
          const o = k * VERTEX_STRIDE;
          vbuf.writeInt16LE(clampI16(Math.round(lx * POS_SCALE)), o);
          vbuf.writeInt16LE(clampI16(Math.round(ly * POS_SCALE)), o + 2);
          vbuf.writeInt16LE(clampI16(Math.round(lz * POS_SCALE)), o + 4);
          vbuf.writeInt8(clampI8(Math.round(mesh.nx[v] * 127)), o + 6);
          vbuf.writeInt8(clampI8(Math.round(mesh.ny[v] * 127)), o + 7);
          vbuf.writeInt8(clampI8(Math.round(mesh.nz[v] * 127)), o + 8);
          vbuf.writeInt8(clampI8(Math.round((mesh.ao[v] / 255) * 127)), o + 9);
          vbuf.writeUInt16LE(clampU16(Math.round(wrapUv(mesh.u[v]) * UV_SCALE)), o + 10);
          vbuf.writeUInt16LE(clampU16(Math.round(wrapUv(mesh.v[v]) * UV_SCALE)), o + 12);
          vbuf.writeUInt8(mesh.mat[v] & 255, o + 14);
          vbuf.writeUInt8(mesh.seed[v] & 255, o + 15);
          vbuf.writeUInt8(Math.min(255, mesh.levels[v]) & 255, o + 16);
          vbuf.writeUInt8(mesh.flags[v] & 255, o + 17);
          vbuf.writeUInt16LE(clampU16(Math.round(mesh.hgt[v] * HEIGHT_SCALE)), o + 18);
        }
        const use32 = vcount > 65535;
        const ibuf = Buffer.alloc(list.length * 3 * (use32 ? 4 : 2));
        let ip = 0;
        for (const i of list) {
          for (let k = 0; k < 3; k++) {
            const li = remap.get(tri[i + k]);
            if (use32) { ibuf.writeUInt32LE(li, ip); ip += 4; }
            else { ibuf.writeUInt16LE(li, ip); ip += 2; }
          }
        }
        rec.vOff = offset; rec.vCount = vcount;
        chunks.push(vbuf); offset += vbuf.length;
        rec.iOff = offset; rec.iCount = list.length * 3; rec.i32 = use32 ? 1 : 0;
        chunks.push(ibuf); offset += ibuf.length;
        rec.tris = list.length;
        rec.min = [round2(minX), round2(minY), round2(minZ)];
        rec.max = [round2(maxX), round2(maxY), round2(maxZ)];
        bytesThisTile += vbuf.length + ibuf.length;
        if (list.length > maxTileTris) maxTileTris = list.length;
      } else {
        rec.vOff = offset; rec.vCount = 0; rec.iOff = offset; rec.iCount = 0; rec.i32 = 0; rec.tris = 0;
        rec.min = [0, 0, 0]; rec.max = [TILE_SIZE, 1, TILE_SIZE];
      }

      // Collision blob.
      const segs = colBuckets[t] || [];
      const cbuf = Buffer.alloc(4 + segs.length * 12 + COLLISION_GRID * COLLISION_GRID * 2);
      cbuf.writeUInt16LE(segs.length, 0);
      cbuf.writeUInt16LE(COLLISION_GRID, 2);
      let cp = 4;
      for (const s of segs) {
        cbuf.writeInt16LE(clampI16(Math.round((s.x1 - originX) * 64)), cp);
        cbuf.writeInt16LE(clampI16(Math.round((s.z1 - originZ) * 64)), cp + 2);
        cbuf.writeInt16LE(clampI16(Math.round((s.x2 - originX) * 64)), cp + 4);
        cbuf.writeInt16LE(clampI16(Math.round((s.z2 - originZ) * 64)), cp + 6);
        cbuf.writeInt16LE(clampI16(Math.round(s.base * 32)), cp + 8);
        cbuf.writeInt16LE(clampI16(Math.round(s.top * 32)), cp + 10);
        cp += 12;
      }
      for (let gz = 0; gz < COLLISION_GRID; gz++) {
        for (let gx = 0; gx < COLLISION_GRID; gx++) {
          const x = originX + (gx / (COLLISION_GRID - 1)) * TILE_SIZE;
          const z = originZ + (gz / (COLLISION_GRID - 1)) * TILE_SIZE;
          cbuf.writeInt16LE(clampI16(Math.round(terrain.height(x, z) * GROUND_SCALE)), cp);
          cp += 2;
        }
      }
      rec.cOff = offset; rec.cLen = cbuf.length; rec.segs = segs.length;
      chunks.push(cbuf); offset += cbuf.length;
      bytesThisTile += cbuf.length;

      // Trees, packed as 8 bytes each.
      const tl = treeBuckets[t] || [];
      if (tl.length) {
        const tbuf = Buffer.alloc(tl.length * 8);
        for (let k = 0; k < tl.length; k++) {
          const o = k * 8;
          tbuf.writeInt16LE(clampI16(Math.round((tl[k].x - originX) * 64)), o);
          tbuf.writeInt16LE(clampI16(Math.round(tl[k].y * 64)), o + 2);
          tbuf.writeInt16LE(clampI16(Math.round((tl[k].z - originZ) * 64)), o + 4);
          tbuf.writeUInt8(Math.min(255, Math.round(tl[k].h * 8)), o + 6);
          tbuf.writeUInt8(((tl[k].seed & 127) | (tl[k].kind ? 128 : 0)) & 255, o + 7);
        }
        rec.trOff = offset; rec.trCount = tl.length;
        chunks.push(tbuf); offset += tbuf.length;
        bytesThisTile += tbuf.length;
      } else {
        rec.trOff = offset; rec.trCount = 0;
      }

      totalTileBytes += bytesThisTile;
      if (bytesThisTile > maxTileBytes) maxTileBytes = bytesThisTile;
      tiles.push(rec);
    }
  }

  const surfaceOffset = offset;
  chunks.push(Buffer.from(surfaceGrid.data.buffer, surfaceGrid.data.byteOffset, surfaceGrid.data.length));
  offset += surfaceGrid.data.length;

  return {
    buffer: Buffer.concat(chunks),
    tiles, tileCountX, tileCountZ, nonEmpty,
    surfaceOffset,
    maxTileKB: maxTileBytes / 1024,
    meanTileKB: totalTileBytes / Math.max(1, tiles.length) / 1024,
    maxTileTris,
  };
}

function clampI16(v) { return v < -32768 ? -32768 : v > 32767 ? 32767 : v; }
function clampU16(v) { return v < 0 ? 0 : v > 65535 ? 65535 : v; }
function clampI8(v) { return v < -128 ? -128 : v > 127 ? 127 : v; }
function wrapUv(v) {
  // uv is a metre run, which can be negative or very long. Wrap into 0..2048 so
  // it survives the uint16, and keep the phase so tiling patterns line up.
  const period = 2048;
  let x = v % period;
  if (x < 0) x += period;
  return x;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
