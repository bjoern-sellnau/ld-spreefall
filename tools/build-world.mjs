// The world builder. Reads a district's cached OSM, produces
// public/world-<id>.bin and .json for it, keeps public/world.json as the index
// of every district built so far, and prints the stats the brief asks for.
//
//   node tools/build-world.mjs                   the middle district
//   node tools/build-world.mjs --district=c2r1   one named district
//   node tools/build-world.mjs --all             every district with an extract
//
// Districts are cut on the lines of one city wide tile grid, so a tile index
// means the same thing in every one of them, and each district only builds
// what has its middle inside its own box: a building on a boundary belongs to
// one district and is built once. The detail tier comes from the district
// table, and what it costs is in the budget line at the end.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseOsmXml, counts } from './osm-xml.mjs';
import { annotate } from './annotate.mjs';
import { project, BBOX, CITY, worldBounds, cityGrid, ORIGIN } from './geo.mjs';
import { DISTRICTS, TIERS, CORE_ID, districtById } from './districts.mjs';
import { Mesh } from './mesh.mjs';
import { Terrain } from './terrain.mjs';
import { fbm2, hashInt } from './noise.mjs';
import {
  extrudeBuilding, ribbon, groundPolygon, box, ringArea, ringCentroid,
  orientedBox, ringLength, lampPost, parkedCar, streetBin, bench,
} from './geometry.mjs';
import { LANDMARK_BUILDERS } from './landmarks.mjs';
import { ROAD_WIDTH } from './synth-osm.mjs';
import {
  TILE_SIZE, VERTEX_STRIDE, POS_SCALE, UV_SCALE, HEIGHT_SCALE,
  COLLISION_GRID, GROUND_SCALE, MAT, SURFACE, FACADE_FLAG, MATERIAL_NAMES,
} from '../src/shared/constants.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const OUT_DIR = path.join(ROOT, 'public');
const INDEX_FILE = path.join(OUT_DIR, 'world.json');

function rawFile(id) {
  return path.join(RAW_DIR, id === CORE_ID ? 'berlin-center.osm' : `district-${id}.osm`);
}

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

const BERLIN_SEEDS = [
  [0.855, 0.796, 0.663], [0.886, 0.843, 0.741], [0.804, 0.749, 0.639],
  [0.784, 0.722, 0.580], [0.863, 0.827, 0.749], [0.761, 0.706, 0.604],
  [0.725, 0.663, 0.549], [0.839, 0.776, 0.659], [0.663, 0.498, 0.369],
  [0.588, 0.376, 0.290], [0.788, 0.765, 0.706], [0.824, 0.796, 0.733],
];

/**
 * Sixty of the twelve Berlin tones, five shades of each.
 *
 * The palette has to be identical in every district, because a vertex carries
 * an index into it and the renderer uploads one palette for the whole city. It
 * used to be grown as the data asked for colours, which was fine while there
 * was one district and wrong the moment there were two: index seven would have
 * meant sandstone in Mitte and brick in Wedding. So it is computed here, the
 * same way every time, and a building that states its own colour is snapped to
 * the nearest entry.
 */
function buildPalette() {
  const out = [];
  const shades = [0.88, 0.96, 1.0, 1.05, 1.12];
  for (const seed of BERLIN_SEEDS) {
    for (const k of shades) {
      out.push(seed.map((c) => Math.min(1, Math.max(0, c * k))));
    }
  }
  // A few greys for the concrete and the postwar blocks.
  out.push([0.72, 0.72, 0.70], [0.63, 0.64, 0.63], [0.80, 0.80, 0.78], [0.55, 0.56, 0.57]);
  return out;
}

const BERLIN_PALETTE = buildPalette();

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

// What a roof is made of, where the tagging says. Anything not in here, and
// anything untagged, is the tiled roof the city is mostly covered in.
const ROOF_MATERIAL_BY_TAG = {
  copper: MAT.COPPER, zinc: MAT.METAL, metal: MAT.METAL, metal_sheet: MAT.METAL,
  steel: MAT.METAL, aluminium: MAT.METAL, tin: MAT.METAL,
  glass: MAT.GLASS, concrete: MAT.CONCRETE, gravel: MAT.GRAVEL,
};

/**
 * Which of the four roof tones this one is. The shader carries four, because
 * four is what you can tell apart from a street: the dark tile most of the
 * city has, the red tile of the older blocks, grey slate, and copper gone
 * green. The material is believed first and the colour read only if there is
 * no material, because a colour is somebody's guess at a photograph.
 *
 * @returns {number} 0 dark tile, 1 red tile, 2 slate, 3 copper
 */
function roofTone(tags) {
  const mat = (tags['roof:material'] || '').toLowerCase();
  if (mat === 'copper') return 3;
  if (mat === 'slate' || mat === 'zinc' || mat === 'metal' || mat === 'eternit'
    || mat === 'metal_sheet' || mat === 'tin') return 2;
  if (mat.includes('tile') || mat === 'clay' || mat === 'brick') return 1;
  const c = parseColour(tags['roof:colour'] || tags['roof:color']);
  if (!c) return 0;
  const [r, g, b] = c;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (r > 0.3 && r > g * 1.35 && r > b * 1.35) return 1;
  if (g > 0.26 && g > r * 1.15 && g > b * 1.05) return 3;
  if (max - min < 0.09 && max > 0.42) return 2;
  return 0;
}

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
  const all = process.argv.includes('--all');
  const named = process.argv.find((a) => a.startsWith('--district='));
  let wanted;
  if (all) {
    wanted = DISTRICTS.filter((d) => fs.existsSync(rawFile(d.id)));
    if (!wanted.length) {
      console.error('no district extracts at all, run: node tools/fetch-osm.mjs --all');
      process.exit(1);
    }
    const missing = DISTRICTS.length - wanted.length;
    if (missing) console.log(`building ${wanted.length} districts, ${missing} have no extract yet`);
  } else if (named) {
    const d = districtById(named.slice('--district='.length));
    if (!d) { console.error(`no such district: ${named}`); process.exit(1); }
    wanted = [d];
  } else {
    wanted = [districtById(CORE_ID)];
  }
  for (const district of wanted) buildDistrict(district);
  writeIndexSummary();
}

function buildDistrict(district) {
  const t0 = Date.now();
  const tier = TIERS[district.tier];
  const RAW_FILE = rawFile(district.id);
  if (!fs.existsSync(RAW_FILE)) {
    console.error(`missing ${RAW_FILE}, run: node tools/fetch-osm.mjs --district=${district.id}`);
    process.exit(1);
  }
  console.log('');
  console.log(`=== ${district.id}  tier ${district.tier} (${tier.name})  ${district.nx} by ${district.nz} tiles ===`);
  const src = fs.readFileSync(RAW_FILE, 'utf8');
  const osm = parseOsmXml(src);
  const c = counts(osm);
  console.log(`parsed ${(src.length / 1e6).toFixed(2)} MB: nodes ${c.nodes}  ways ${c.ways}  relations ${c.relations}`);

  // Attach the surveyed facts before anything is classified, so a build from
  // the live extract carries the same landmarks, cards and stelae field as one
  // from the offline fallback.
  annotate(osm, {
    log: (line) => console.log(line),
    box: {
      minX: district.bounds.minX, minZ: district.bounds.minZ,
      maxX: district.bounds.maxX, maxZ: district.bounds.maxZ,
    },
  });

  // The district's own block of the global grid. Already tile aligned, so no
  // tile is ever shared between two districts.
  const world = {
    minX: district.bounds.minX, minZ: district.bounds.minZ,
    maxX: district.bounds.maxX, maxZ: district.bounds.maxZ,
    width: district.bounds.width, depth: district.bounds.depth,
  };
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
  let buildings = [];       // {outer, holes, tags}
  let roads = [];
  let areas = [];           // pedestrian areas
  let waterPolys = [];
  let greens = [];
  let rails = [];
  let trees = [];
  let memorials = [];
  let attractions = [];
  let stations = [];
  const places = [];        // place=suburb and friends, for the district's name

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
        buildings.push({
          outer: o, holes: inners.filter((h) => ringInside(h, o)), tags: t,
          part: !!t['building:part'] && !t.building,
        });
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
      if (closed && ring.length >= 4) {
        buildings.push({
          outer: ring.slice(0, -1), holes: [], tags: t,
          part: !!t['building:part'] && !t.building,
        });
      }
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
    if (t.railway === 'station' || t.railway === 'subway_entrance') { stations.push({ p, tags: t }); continue; }
    // Only the kinds of place a district can be named after, so a city node
    // alone in a district leaves it with its grid name rather than calling it
    // Berlin.
    if (t.place && t.name && PLACE_RANK[t.place]) {
      places.push({ p, tags: t, rank: PLACE_RANK[t.place] });
    }
  }

  console.log(`features: buildings ${buildings.length}  roads ${roads.length}  areas ${areas.length}  water ${waterPolys.length}  green ${greens.length}  rails ${rails.length}  trees ${trees.length}`);

  // --- the district's own share of it -------------------------------------
  // The extract covers the district plus a margin, so that a wall standing on
  // a boundary arrives whole. Everything is now cut down to the district
  // itself: areas and lines are clipped to the box, and anything with a middle
  // is kept by its middle, which is what stops two districts from both
  // building the same house.
  const box = { minX: world.minX, minZ: world.minZ, maxX: world.maxX, maxZ: world.maxZ };
  const inBox = (x, z) => x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ;
  const before = { buildings: buildings.length, roads: roads.length, trees: trees.length };
  buildings = buildings.filter((b) => {
    if (b.outer.length < 3) return false;
    const [cx, cz] = ringCentroid(b.outer);
    return inBox(cx, cz);
  });
  trees = trees.filter((t) => inBox(t.p[0], t.p[1]));
  attractions = attractions.filter((a) => inBox(a.p[0], a.p[1]));
  stations = stations.filter((st) => inBox(st.p[0], st.p[1]));
  memorials = memorials.filter((m) => {
    const [cx, cz] = ringCentroid(m.ring);
    return inBox(cx, cz);
  });
  roads = clipLines(roads, box);
  rails = clipLines(rails, box);
  areas = clipRings(areas, box, 'ring');
  greens = clipRings(greens, box, 'ring');
  waterPolys = clipRings(waterPolys, box, 'ring');
  console.log(`district share: buildings ${buildings.length} of ${before.buildings}  roads ${roads.length} of ${before.roads}  trees ${trees.length} of ${before.trees}`);

  // --- what this tier leaves out ------------------------------------------
  if (tier.minArea > 6) {
    const kept = buildings.filter((b) => ringArea(b.outer) >= tier.minArea);
    console.log(`tier ${district.tier}: ${buildings.length - kept.length} buildings under ${tier.minArea} m2 dropped`);
    buildings = kept;
  }
  if (tier.simplify > 0) {
    for (const b of buildings) {
      const s2 = simplify([...b.outer, b.outer[0]], tier.simplify);
      if (s2.length >= 4) b.outer = s2.slice(0, -1);
      b.holes = b.holes.map((h) => {
        const hs = simplify([...h, h[0]], tier.simplify);
        return hs.length >= 4 ? hs.slice(0, -1) : h;
      });
    }
  }
  if (tier.driveOnly) {
    roads = roads.filter((r) => !FOOT_CLASSES.has(r.tags.highway)
      && (tier.service || r.tags.highway !== 'service'));
  }
  if (tier.roadSimplify > 0) {
    // A ribbon costs four vertices per point of the line it follows, and a
    // kerbside wiggle of half a metre is not worth four vertices out here.
    for (const r of roads) {
      const line = simplify(r.line, tier.roadSimplify);
      if (line.length >= 2) r.line = line;
    }
    for (const r of rails) {
      const line = simplify(r.line, tier.roadSimplify);
      if (line.length >= 2) r.line = line;
    }
  }
  if (tier.boxBelow > 0) {
    let boxed = 0;
    for (const b of buildings) {
      if (b.holes.length || ringArea(b.outer) >= tier.boxBelow) continue;
      const ob = orientedBox(b.outer);
      if (!ob || !(ob.lu > 1) || !(ob.lv > 1)) continue;
      const hu = ob.lu / 2, hv = ob.lv / 2;
      b.outer = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([u, v]) => [
        ob.cx + u * ob.ux + v * ob.vx,
        ob.cz + u * ob.uz + v * ob.vz,
      ]);
      boxed++;
    }
    console.log(`tier ${district.tier}: ${boxed} small buildings reduced to the box that fits them`);
  }
  if (tier.trees < 1) {
    trees = trees.filter((t) => {
      const h = hashInt(Math.round(t.p[0] * 8), Math.round(t.p[1] * 8)) & 1023;
      return h / 1023 < tier.trees;
    });
  }

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

  // What each part of the city costs in vertices. Printed at the end,
  // because the first real build showed the roads were two thirds of the
  // geometry and nobody had asked where the bytes were going.
  const spent = {};
  let mark = 0;
  const since = (name) => { spent[name] = (spent[name] || 0) + (mesh.vertexCount - mark); mark = mesh.vertexCount; };
  mark = mesh.vertexCount;

  // --- green -------------------------------------------------------------
  for (const g of greens) {
    groundPolygon(mesh, g.ring, g.holes, MAT.GRASS, yAt, { lift: 0.05, seed: 5 });
  }

  since('parks');
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

  since('water');
  // --- roads --------------------------------------------------------------
  let roadMetres = 0;
  let roadPoints = 0;
  const roadLines = [];
  // Where the street names go on the map. Only the district you are in
  // carries them, which is both what you want to read and the reason they
  // cost nothing on a city of eighty one of these.
  const streetNames = [];
  for (const r of roads) {
    const cls = r.tags.highway;
    const explicit = parseLength(r.tags.width);
    const width = Number.isFinite(explicit) && explicit > 1 ? explicit : (ROAD_WIDTH[cls] || 6);
    const mat = roadMaterial(r.tags);
    const isFoot = cls === 'footway' || cls === 'path' || cls === 'cycleway' || cls === 'steps';
    const lift = isFoot ? 0.06 : 0.0;
    ribbon(mesh, r.line, width / 2, mat, yAt, { lift, flags: 0, seed: hashInt(Math.round(r.line[0][0]), Math.round(r.line[0][1])) & 255 });
    if (!isFoot && tier.kerbs) {
      // Kerb and pavement either side.
      for (const side of [-1, 1]) {
        const off = offsetLine(r.line, (width / 2 + 1.6) * side);
        ribbon(mesh, off, 1.7, MAT.PAVEMENT, yAt, { lift: 0.12 });
      }
    }
    roadMetres += polylineLength(r.line);
    roadPoints += r.line.length;
    if (!isFoot) {
      // The name rides along with the centreline, not only with the labels
      // the map draws. A label is a point every two hundred and forty metres,
      // which is fine for writing a name across a map and useless for
      // answering what street you are standing in: the nearest one can be a
      // hundred metres away on the next street over.
      const line = {
        cls,
        w: width,
        pts: simplify(r.line, 1.5).flatMap((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]),
      };
      if (r.tags.name) line.n = r.tags.name;
      roadLines.push(line);
      if (r.tags.name) streetNames.push(...streetLabels(r.tags.name, r.line, cls));
    }
  }
  for (const a of areas) {
    groundPolygon(mesh, a.ring, [], roadMaterial(a.tags), yAt, { lift: 0.05, seed: 3 });
  }

  // --- what stands on the street ------------------------------------------
  // Lamps, parked cars, bins and benches, laid along the kerb of every street
  // that has one. They are ordinary mesh rather than an instanced layer of
  // their own, because a tile is already drawn in one call and a lamp post is
  // a few dozen triangles. All of it together is 75,000 triangles across
  // Mitte, against 188,000 for the city it stands in. Where each one goes is
  // decided by a hash of the position, so two builds put them in the same
  // places.
  let props = 0;
  let lamps = 0, cars = 0;
  if (tier.props) {
    const LAMPS_ON = new Set(['primary', 'secondary', 'tertiary', 'residential',
      'living_street', 'unclassified', 'pedestrian']);
    const PARKING_ON = new Set(['residential', 'tertiary', 'living_street', 'unclassified']);
    const chance = (x, z, salt) =>
      ((hashInt(Math.round(x * 3) + salt, Math.round(z * 3)) >>> 8) & 1023) / 1023;
    const clear = (x, z) => {
      if (x < world.minX + 4 || x > world.maxX - 4) return false;
      if (z < world.minZ + 4 || z > world.maxZ - 4) return false;
      // Not in the river, and not in the memorial.
      for (const w of waterPolys) if (pointInRing(x, z, w.ring)) return false;
      for (const m of memorials) if (pointInRing(x, z, m.ring)) return false;
      return true;
    };
    // And nothing stands inside anything else. Streets cross, so the lamp one
    // of them puts at its kerb lands on the car the other one parked there,
    // and the first build of this had a lamp post growing up through a car
    // roof. A coarse grid of what has been put down already, with the trees
    // seeded into it, and a new piece has to clear all of it.
    const CELL = 6;
    const placed = new Map();
    const keep = (x, z, r) => {
      const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
      const list = placed.get(k);
      if (list) list.push([x, z, r]); else placed.set(k, [[x, z, r]]);
    };
    const room = (x, z, r) => {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          const list = placed.get(`${ix},${iz}`);
          if (!list) continue;
          for (const [px, pz, pr] of list) {
            if (Math.hypot(px - x, pz - z) < pr + r) return false;
          }
        }
      }
      return true;
    };
    // A tree is a trunk and a canopy over the pavement; a lamp inside one is
    // the same nonsense as a lamp inside a car.
    for (const t of trees) keep(t.p[0], t.p[1], 1.6);
    for (const r of roads) {
      const cls = r.tags.highway;
      if (!LAMPS_ON.has(cls)) continue;
      const explicit = parseLength(r.tags.width);
      const width = Number.isFinite(explicit) && explicit > 1 ? explicit : (ROAD_WIDTH[cls] || 6);
      const kerb = width / 2 + 1.0;
      const line = r.line;
      // Walk the centreline at a fixed step, so the spacing is the spacing on
      // the ground rather than one post per node.
      let run = 0, since = 1e9, sinceCar = 1e9, sinceSeat = 1e9;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const seg = Math.hypot(dx, dz);
        if (seg < 0.01) continue;
        const ux = dx / seg, uz = dz / seg;
        const yaw = Math.atan2(ux, uz);
        for (let t = 0; t < seg; t += 2) {
          const x = a[0] + ux * t, z = a[1] + uz * t;
          run += 2; since += 2; sinceCar += 2; sinceSeat += 2;
          // The lamps alternate sides down the street, the way they do here.
          if (since >= 45) {
            const side = (Math.floor(run / 45) % 2) ? 1 : -1;
            const px = x - uz * kerb * side, pz = z + ux * kerb * side;
            if (clear(px, pz) && room(px, pz, 0.9)) {
              keep(px, pz, 0.9);
              const g = yAt(px, pz);
              lampPost(mesh, px, g, pz, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2),
                { seed: hashInt(Math.round(px), Math.round(pz)) & 255 });
              // As wide as the pole is, rather than as wide as is easy: the
              // mast is a third of a metre across at the foot and half that
              // at the lantern, and a box twice its width is a thing you
              // bump into beside a lamp post rather than on it.
              pushPostCollision(collision, px, pz, g, g + 6.2, 0.15);
              props++; lamps++;
            }
            since = 0;
          }
          if (PARKING_ON.has(cls) && sinceCar >= 20 && chance(x, z, 17) < 0.5) {
            const side = chance(x, z, 91) < 0.5 ? 1 : -1;
            const px = x - uz * (width / 2 - 0.1) * side;
            const pz = z + ux * (width / 2 - 0.1) * side;
            if (clear(px, pz) && room(px, pz, 2.5)) {
              keep(px, pz, 2.5);
              const g = yAt(px, pz);
              parkedCar(mesh, px, g, pz, yaw,
                { seed: hashInt(Math.round(px), Math.round(pz)) & 255 });
              pushBoxCollision(collision, px, pz, yaw, 1.78, 4.3, g, g + 1.5);
              props++; cars++;
            }
            sinceCar = 0;
          }
          if (sinceSeat >= 95 && (cls === 'pedestrian' || cls === 'primary')) {
            const side = chance(x, z, 53) < 0.5 ? 1 : -1;
            const px = x - uz * (kerb + 1.4) * side, pz = z + ux * (kerb + 1.4) * side;
            if (clear(px, pz) && room(px, pz, 1.1)) {
              keep(px, pz, 1.1);
              const g = yAt(px, pz);
              if (chance(x, z, 7) < 0.5) bench(mesh, px, g, pz, yaw + Math.PI / 2);
              else streetBin(mesh, px, g, pz);
              props++;
            }
            sinceSeat = 0;
          }
        }
      }
    }
  }

  since('roads');
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

  since('rails');
  // --- buildings ----------------------------------------------------------
  // Simple 3D Buildings: a building that is more than a box is mapped as an
  // outline plus a set of building:part pieces, each with its own height, and
  // the outline is a rough envelope that is not meant to be drawn once the
  // pieces are there. Drawing both is what turned every tower in this city
  // into the box around it, which is what you were looking at before.
  const parentsWithParts = markBuildingParts(buildings, (b) => {
    // Only a piece that is itself going to be built may take its outline out
    // of the picture. A piece under the district's smallest building, or one
    // whose middle falls outside the box, is dropped by the loop below, and
    // without this test it took the whole building with it: the outline was
    // not drawn because the piece had claimed it, and the piece was not
    // drawn either, so what stood there was nothing at all.
    if (ringArea(b.outer) < tier.minArea) return false;
    const [bx, bz] = ringCentroid(b.outer);
    return bx >= world.minX - 60 && bx <= world.maxX + 60
      && bz >= world.minZ - 60 && bz <= world.maxZ + 60;
  });
  let buildingCount = 0;
  let blankWalls = 0;
  const landmarkIndex = [];
  const palette = new Palette(BERLIN_PALETTE, { frozen: true });
  for (const b of buildings) {
    const ring = b.outer;
    if (ring.length < 3) continue;
    const area = ringArea(ring);
    if (area < tier.minArea) continue;
    const [cx, cz] = ringCentroid(ring);
    if (cx < world.minX - 60 || cx > world.maxX + 60 || cz < world.minZ - 60 || cz > world.maxZ + 60) continue;
    // Its pieces are drawn instead, and they carry their own collision, so
    // the envelope is left out of both. A piece that is missing leaves a gap
    // you can walk into, which is rarer and kinder than a tower inside a box.
    if (b.hasParts) continue;
    const base = yAt(cx, cz);
    const tags = b.tags;
    const height = buildingHeight(tags);
    const levels = buildingLevels(tags, height);
    // Where the volume starts, for a piece that hangs over a passage or a
    // tower that begins at the tenth floor. Metres win over levels, which is
    // the order the tagging scheme puts them in.
    const minLevels = parseFloat(tags['building:min_level']);
    const minMetres = parseLength(tags.min_height);
    const minH = Number.isFinite(minMetres) ? minMetres
      : (Number.isFinite(minLevels) && minLevels > 0 ? minLevels * LEVEL_HEIGHT : NaN);
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
    // Out past the inner districts every roof is flat. A pitched roof is four
    // more vertices and a different normal per metre of frontage, and from the
    // next street over it reads as a flat roof anyway.
    const roofShape = tier.roofs
      ? (tags['roof:shape'] || 'flat').toLowerCase().trim().replace(/[\s-]+/g, '_') : 'flat';
    // How tall the roof is. Metres if they are given, otherwise the roof
    // levels, otherwise the four and a half metres a Berlin pitch is. The
    // height on the building is to the top of the roof, which is why the
    // walls give this back rather than carrying the roof on top of their
    // full height, and why nothing is allowed to be more than two fifths
    // roof: a tagged roof:height taller than the building it is on is a
    // mistake somebody made, not a spire.
    const roofLevels = parseFloat(tags['roof:levels']);
    const roofTagged = tier.roofs ? parseLength(tags['roof:height']) : 0;
    let roofHeight = Number.isFinite(roofTagged) ? roofTagged
      : (Number.isFinite(roofLevels) && roofLevels > 0 ? roofLevels * LEVEL_HEIGHT * 0.8
        : (roofShape === 'flat' ? 0 : 4.5));
    if (!tier.roofs || roofShape === 'flat') roofHeight = 0;
    const roofAcross = (tags['roof:orientation'] || '').toLowerCase().trim() === 'across';
    const roofDirTag = parseFloat(tags['roof:direction']);
    const roofMatTag = ROOF_MATERIAL_BY_TAG[(tags['roof:material'] || '').toLowerCase()];
    const from = base + (Number.isFinite(minH) ? minH : 0);
    const solid = Math.max(2, height - (Number.isFinite(minH) ? minH : 0));
    const roofH = Math.max(0, Math.min(roofHeight, solid * 0.4));
    // Whether this one gets the window shader. It is one flag bit and the
    // pattern itself costs nothing to carry, so the only reason to refuse it
    // is that the wall is not a frontage: raw concrete has no windows cut
    // into it wherever it stands.
    const blank = wallMat === MAT.CONCRETE || !tier.windows;
    if (blank) blankWalls++;
    extrudeBuilding(mesh, { outer: ring, holes: b.holes }, {
      base: from,
      height: Math.max(2, solid - roofH),
      // The skirt is the bit of wall carried below the ground so that a
      // building on a slope has no gap under it. A volume that starts ten
      // metres up has no ground to meet, and a skirt there is a wall hanging
      // in the air under an archway.
      skirt: Number.isFinite(minH) && minH > 0.5 ? 0 : undefined,
      roofShape,
      roofHeight: roofH,
      roofAcross,
      roofDir: Number.isFinite(roofDirTag) ? roofDirTag : undefined,
      // A frontage with a cornice on it, and a band over the windows where
      // the ground floor is a shop. Whether it is a shop is whatever the
      // tagging says: a shop tag, a retail building, or anything with a
      // counter in it.
      relief: !!tier.relief,
      shopfront: !!tier.relief && !!(tags.shop || tags.amenity
        || tags.building === 'retail' || tags.building === 'commercial'),
      wallMat, roofMat: roofMatTag !== undefined ? roofMatTag : MAT.ROOF,
      // The roof carries the same palette entry as the walls in its low bits,
      // which nothing reads, and its tone in the two above, which the roof
      // shader does.
      roofSeed: (packedSeed & 63) | (roofTone(tags) << 6),
      seed: packedSeed,
      levels,
      landmark: false,
      noWindows: blank,
    });
    // A volume that starts above the street is collided against from where it
    // starts, so you can walk under the arch you can see under.
    const collideFrom = Number.isFinite(minH) && minH > 0.5 ? from : base - 1;
    pushFootprintCollision(collision, ring, collideFrom, base + height, SURFACE.STONE);
    for (const h of b.holes) pushFootprintCollision(collision, h, collideFrom, base + height, SURFACE.STONE);
    buildingCount++;
  }

  since('buildings');
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

  since('stelae');
  // --- ground base --------------------------------------------------------
  // The fallback surface under everything, as a quad grid, laid last because
  // what it has to fill is whatever the rest of the city did not.
  //
  // It has to be fine enough that its linear interpolation of the terrain
  // never rises above the road ribbons drawn a hundred millimetres below the
  // true ground, so 12.5 m, and cells that something else has already drawn
  // are simply not emitted. That second part removes about a third of the
  // world's triangles.
  //
  // What counts as already drawn is read off the triangles in the mesh rather
  // than off the polygons they came from, and that is the whole point. The
  // first version of this asked the source data: it filled a park's outline
  // into a mask and skipped the base ground under it, including under the
  // holes in that park, which are exactly the parts the park does not draw.
  // The result was a hole in the world you could see the sky through,
  // standing on ground the collision layer said was solid. A polygon that
  // fails to triangulate, a ring clipped away at a district edge and a
  // building footprint that is not ground at all were all the same mistake.
  // Asking the mesh cannot be wrong about this, because the mesh is the
  // picture.
  const gstep = tier.groundStep;
  const gnx = Math.ceil(world.width / gstep);
  const gnz = Math.ceil(world.depth / gstep);
  const cover = drawnGroundCoverage(world, mesh, yAt);
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
      groundPolygon(mesh, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [], MAT.PAVEMENT, yAt,
        { lift: -0.09, flags: FACADE_FLAG.BASE });
      groundCells++;
    }
  }
  console.log(`ground: ${groundCells} base cells drawn, ${skippedCells} skipped as already drawn`);
  since('ground');
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

  console.log('vertices: ' + Object.entries(spent).filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${Math.round(v / 1000)}k`).join(', ')
    + `  (${roadPoints} road points over ${(roadMetres / 1000).toFixed(1)} km)`);
  console.log(`windows: ${buildingCount - blankWalls} of ${buildingCount} buildings have them`);
  console.log(`geometry: ${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles, ${buildingCount} buildings, ${stelae} stelae, ${treeList.length} trees, ${lamps} lamps, ${cars} cars, ${props - lamps - cars} seats and bins, ${(roadMetres / 1000).toFixed(1)} km of road`);

  // --- surface map for footsteps -----------------------------------------
  const surfaceGrid = buildSurfaceGrid(world, roads, areas, greens, waterPolys, memorials, tier.surfaceStep);

  // --- tiling and writing -------------------------------------------------
  const bundle = tileAndPack(mesh, collision, treeList, world, terrain, surfaceGrid, tier.grid);

  // The district's own file. Tile records carry their index in the global
  // grid, so the runtime can drop them straight into one city wide array
  // whatever order the districts arrive in.
  for (let i = 0; i < bundle.tiles.length; i++) {
    const rec = bundle.tiles[i];
    rec.t = (district.tz + rec.tz) * cityTiles.nx + (district.tx + rec.tx);
  }

  const name = districtName(district, places);
  const manifest = {
    version: 4,
    generator: 'spreefall build-world',
    district: district.id,
    name,
    tier: district.tier,
    tx: district.tx,
    tz: district.tz,
    nx: district.nx,
    nz: district.nz,
    world: {
      minX: round2(world.minX), minZ: round2(world.minZ),
      maxX: round2(world.maxX), maxZ: round2(world.maxZ),
    },
    collisionGrid: tier.grid,
    waterLevel,
    facadePalette: palette.list.map((c) => c.map((v) => Math.round(v * 255))),
    landmarks: buildLandmarkCards(attractions, landmarkIndex),
    stations: stations.map((s) => ({ name: s.tags.name || '', x: round2(s.p[0]), z: round2(s.p[1]), kind: s.tags.railway })),
    roadLines,
    streets: streetNames,
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
  const binName = `world-${district.id}.bin`;
  const jsonName = `world-${district.id}.json`;
  fs.writeFileSync(path.join(OUT_DIR, binName), bundle.buffer);
  fs.writeFileSync(path.join(OUT_DIR, jsonName), JSON.stringify(manifest));

  const binBytes = bundle.buffer.length;
  const jsonBytes = fs.statSync(path.join(OUT_DIR, jsonName)).size;
  const sketch = citySketch(roadLines, manifest.waterOutlines, manifest.greenOutlines);
  const gz = gzipSize(path.join(OUT_DIR, binName)) + gzipSize(path.join(OUT_DIR, jsonName));
  updateIndex(district, {
    name, tier: district.tier,
    bin: binName, json: jsonName,
    bytes: binBytes + jsonBytes, gzip: gz,
    tiles: bundle.tiles.length, nonEmpty: bundle.nonEmpty,
    triangles: mesh.triangleCount,
    buildings: buildingCount,
    trees: treeList.length,
    roadKm: Math.round(roadMetres / 100) / 10,
    tallest: Math.round(bundle.tallest * 10) / 10,
    waterLevel,
    landmarks: manifest.landmarks.length,
    sight: pickSight(manifest.landmarks, manifest.stations, world),
    sketch,
    builtAt: new Date().toISOString(),
  });

  const binMB = binBytes / 1e6;
  const jsonMB = jsonBytes / 1e6;
  console.log('');
  console.log(`name            ${name}`);
  console.log(`tiles           ${bundle.tiles.length} of ${bundle.tileCountX} by ${bundle.tileCountZ} (${bundle.nonEmpty} non empty)`);
  console.log(`triangles       ${mesh.triangleCount}`);
  console.log(`vertices        ${mesh.vertexCount}`);
  console.log(`collision segs  ${collision.length}`);
  console.log(`${binName.padEnd(16)}${binMB.toFixed(2)} MB`);
  console.log(`${jsonName.padEnd(16)}${jsonMB.toFixed(2)} MB`);
  console.log(`over the wire   ${(gz / 1e6).toFixed(2)} MB gzipped`);
  const sp = bundle.spend;
  const kb = (v) => `${(v / 1024).toFixed(0)} kB`;
  console.log(`bytes           vertices ${kb(sp.vertices)}, indices ${kb(sp.indices)}, `
    + `height fields ${kb(sp.grids)}, walls ${kb(sp.segments)}, trees ${kb(sp.trees)}, `
    + `footsteps ${kb(sp.surface)}`);
  console.log(`max tile        ${bundle.maxTileKB.toFixed(1)} kB, ${bundle.maxTileTris} triangles`);
  console.log(`mean tile       ${bundle.meanTileKB.toFixed(1)} kB`);
  console.log(`built in        ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------------------
// Districts: the index, the names, and cutting the extract down to one box.

const cityTiles = cityGrid(TILE_SIZE);

// Which place tag wins when a district has several in it.
//
// A city node is not a district name. The first live build of the whole city
// called the middle district Berlin, because OpenStreetMap puts a
// place=city node for Berlin in the middle of Mitte and it outranked
// everything else; a district two kilometres across wants the name of the
// quarter it covers, so city and town are not names a district can take.
const PLACE_RANK = {
  suburb: 5, quarter: 4, neighbourhood: 3, village: 3, borough: 2,
  city_block: 1, hamlet: 1,
};

const FOOT_CLASSES = new Set(['footway', 'path', 'cycleway', 'steps', 'bridleway']);

/**
 * What to call a district. Taken from the place nodes in its own extract, the
 * highest ranking one nearest the middle, so a box over Prenzlauer Berg is
 * called Prenzlauer Berg because OpenStreetMap says a node in the middle of it
 * is. Nothing here guesses: with no place node the district keeps its grid
 * name, which is what the offline fallback produces.
 */
/**
 * What to call a district before anything has been built in it.
 *
 * A built district is named after the quarter its extract puts in the middle
 * of it; a placeholder has no extract, so it gets a label off the lattice
 * instead, which is at least true: where in Berlin it is and how far out.
 */
function placeholderName(district) {
  if (district.core) return 'Mitte';
  if (district.band === 'ring') return `Ring ${district.col + 1}-${district.row + 1}`;
  const b = district.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const km = Math.round(Math.hypot(cx, cz) / 1000);
  const dirs = ['north', 'north east', 'east', 'south east',
    'south', 'south west', 'west', 'north west'];
  // Screen z goes south, so the bearing is measured against negative z.
  const a = Math.atan2(cx, -cz);
  const dir = dirs[(Math.round((a / (Math.PI * 2)) * 8) + 8) % 8];
  return `${km} km ${dir}`;
}

function districtName(district, places) {
  // The middle district is the brief's own box, drawn round the Gate, and the
  // project has called it Mitte since the first commit.
  // Out past the ring a district has no row and column to be named after, so
  // the fallback is its own id. A live extract almost always has a place node
  // in it and this is never seen; the offline fallback is where it shows.
  const fallback = placeholderName(district);
  if (!places.length) return fallback;
  const cx = (district.bounds.minX + district.bounds.maxX) / 2;
  const cz = (district.bounds.minZ + district.bounds.maxZ) / 2;
  const span = Math.max(district.bounds.width, district.bounds.depth);
  let best = null, bestScore = -Infinity;
  for (const p of places) {
    const away = Math.hypot(p.p[0] - cx, p.p[1] - cz);
    const score = p.rank * 2 - (away / span) * 3;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best ? best.tags.name : fallback;
}

function gzipSize(file) {
  return zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
}

function readIndex() {
  if (!fs.existsSync(INDEX_FILE)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    return j && j.districts ? j : null;
  } catch { return null; }
}

/**
 * The index is written after every district, so a build that is interrupted
 * leaves behind a city of the districts that finished rather than nothing.
 */
function updateIndex(district, entry) {
  const previous = readIndex();
  // The header is written fresh every time and the district list is carried
  // over, so a change to anything city wide, the palette for instance, reaches
  // the index on the next district built rather than on the next clean build.
  const index = {
    version: 4,
    generator: 'spreefall build-world',
    origin: ORIGIN,
    city: CITY,
    bbox: BBOX,
    tileSize: TILE_SIZE,
    tileCountX: cityTiles.nx,
    tileCountZ: cityTiles.nz,
    world: {
      minX: round2(cityTiles.minX), minZ: round2(cityTiles.minZ),
      maxX: round2(cityTiles.maxX), maxZ: round2(cityTiles.maxZ),
    },
    vertexStride: VERTEX_STRIDE,
    posScale: POS_SCALE,
    uvScale: UV_SCALE,
    heightScale: HEIGHT_SCALE,
    groundScale: GROUND_SCALE,
    collisionGrid: COLLISION_GRID,
    materials: MATERIAL_NAMES,
    facadePalette: BERLIN_PALETTE.map((c) => c.map((v) => Math.round(v * 255))),
    waterLevel: -0.9,
    home: CORE_ID,
    districts: previous ? previous.districts : [],
  };
  // A district whose bundle is not on this disk does not belong in this
  // index. The index is committed so the game runs from a fresh clone, and
  // without this pass it carried entries for districts built on a developer's
  // machine: the deploy then listed bundles it had never built, and the game
  // asked for them and got four hundred and four.
  index.districts = index.districts.filter((d) => d.id !== district.id
    && fs.existsSync(path.join(OUT_DIR, `world-${d.id}.bin`))
    && fs.existsSync(path.join(OUT_DIR, `world-${d.id}.json`)));
  index.districts.push({
    id: district.id,
    tier: district.tier,
    col: district.col, row: district.row,
    tx: district.tx, tz: district.tz, nx: district.nx, nz: district.nz,
    bounds: {
      minX: round2(district.bounds.minX), minZ: round2(district.bounds.minZ),
      maxX: round2(district.bounds.maxX), maxZ: round2(district.bounds.maxZ),
    },
    bbox: district.bbox,
    built: true,
    ...entry,
  });
  // Every other district of Berlin goes in as a placeholder. The map is the
  // whole city whatever is built, so the eighty that are not here yet are
  // drawn as ground nobody has surveyed, with their names and their size, and
  // the game refuses to walk or fly into one rather than loading a file that
  // is not there. A placeholder carries no bytes and the budget passes over
  // it, because nothing about it is downloaded.
  const have = new Set(index.districts.map((d) => d.id));
  for (const d of DISTRICTS) {
    if (have.has(d.id)) continue;
    index.districts.push({
      id: d.id, tier: d.tier, col: d.col, row: d.row,
      tx: d.tx, tz: d.tz, nx: d.nx, nz: d.nz,
      bounds: {
        minX: round2(d.bounds.minX), minZ: round2(d.bounds.minZ),
        maxX: round2(d.bounds.maxX), maxZ: round2(d.bounds.maxZ),
      },
      bbox: d.bbox,
      name: placeholderName(d),
      built: false,
      bytes: 0, gzip: 0,
    });
  }
  index.districts.sort((a, b) => (a.row - b.row) || (a.col - b.col));
  index.builtAt = new Date().toISOString();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index));
}

/**
 * A district drawn in a few hundred bytes, for the map of the whole city.
 *
 * The map can only draw the district you are standing in, because that is the
 * only one whose streets are in memory, and every other one was a labelled
 * rectangle: eighty one grey boxes, which is not a city you can pick a target
 * on. This goes into the index instead, which is loaded before anything else
 * and weighs nothing: the big roads, the water and the parks, flattened to
 * whole metres and simplified hard, because at the scale the whole of Berlin
 * fits on a screen a kerb is a tenth of a pixel.
 */
function citySketch(roadLines, waterOutlines, greenOutlines) {
  const KEEP = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link',
    'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary',
    'residential', 'unclassified', 'pedestrian', 'living_street']);
  const pairs = (flat) => {
    const out = [];
    for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
    return out;
  };
  const whole = (pts) => {
    const out = [];
    for (const p of pts) {
      const x = Math.round(p[0]), z = Math.round(p[1]);
      // Rounding to the metre puts neighbouring points on top of each other,
      // and a run of identical points is bytes for nothing.
      if (out.length >= 2 && out[out.length - 2] === x && out[out.length - 1] === z) continue;
      out.push(x, z);
    }
    return out;
  };
  let roads = [];
  for (const r of roadLines) {
    if (!KEEP.has(r.cls)) continue;
    const line = whole(simplify(pairs(r.pts), 30));
    if (line.length >= 4) roads.push(line);
  }
  // A cap, so that one dense district cannot run away with the index. The
  // longest ones are the ones that read as a city from above.
  if (roads.length > 220) {
    const len = (l) => {
      let d = 0;
      for (let i = 2; i < l.length; i += 2) d += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
      return d;
    };
    roads = roads.map((l) => [len(l), l]).sort((a, b) => b[0] - a[0]).slice(0, 220)
      .map((p) => p[1]);
  }
  const water = [];
  for (const w of waterOutlines) {
    const ring = whole(simplify(pairs(w), 25));
    if (ring.length >= 8) water.push(ring);
  }
  const green = [];
  for (const g of greenOutlines) {
    const ring = whole(simplify(pairs(g), 35));
    // Anything smaller than a city block is a shrub at this scale.
    if (ring.length >= 8 && flatRingArea(ring) > 20000) green.push(ring);
  }
  return { roads, water, green };
}

/** The area of a ring given as a flat run of coordinates. */
function flatRingArea(flat) {
  let a = 0;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    a += flat[j] * flat[i + 1] - flat[i] * flat[j + 1];
  }
  return Math.abs(a) / 2;
}

/** The budget table: what the whole city costs, district by district. */
function writeIndexSummary() {
  const index = readIndex();
  if (!index) return;
  // Only what was actually built. The index also carries a placeholder for
  // every district of Berlin that is not here yet, so that the map can draw
  // the whole city; a placeholder has no bytes and nothing to weigh.
  const rows = index.districts.filter((d) => d.built !== false);
  let bytes = 0, gz = 0, tris = 0, buildings = 0, trees = 0, road = 0;
  console.log('');
  console.log('district  tier  name                       MB     gz MB   triangles  buildings');
  for (const d of rows) {
    bytes += d.bytes; gz += d.gzip; tris += d.triangles;
    buildings += d.buildings; trees += d.trees; road += d.roadKm;
    console.log(`${d.id.padEnd(9)} ${String(d.tier).padEnd(5)} ${String(d.name).slice(0, 24).padEnd(25)}`
      + `${(d.bytes / 1e6).toFixed(2).padStart(6)} ${(d.gzip / 1e6).toFixed(2).padStart(7)}  `
      + `${String(d.triangles).padStart(9)}  ${String(d.buildings).padStart(9)}`);
  }
  const indexGz = gzipSize(INDEX_FILE);
  const total = gz + indexGz;
  console.log('');
  console.log(`${rows.length} of ${DISTRICTS.length} districts built`);
  console.log(`triangles       ${tris}`);
  console.log(`buildings       ${buildings}`);
  console.log(`trees           ${trees}`);
  console.log(`road            ${road.toFixed(1)} km`);
  console.log(`index           ${(fs.statSync(INDEX_FILE).size / 1e6).toFixed(2)} MB, ${(indexGz / 1e6).toFixed(2)} MB gzipped`);
  console.log(`deployed        ${(bytes / 1e6).toFixed(2)} MB`);
  console.log(`download        ${(total / 1e6).toFixed(2)} MB gzipped, against a 25 MB budget`
    + `${total > 25e6 ? '  OVER' : ''}`);
}

/**
 * Clip polylines to a box. A road that leaves the district is cut at the edge
 * and comes back as a separate piece, so the neighbour draws its own half and
 * neither of them draws the other's.
 */
function clipLines(list, box) {
  const out = [];
  for (const item of list) {
    for (const piece of clipPolyline(item.line, box)) {
      if (piece.length >= 2) out.push({ ...item, line: piece });
    }
  }
  return out;
}

function clipPolyline(line, box) {
  // Liang Barsky per segment, pieces joined while they stay inside. Testing
  // the points alone misses the case that caught me out: a two point street
  // whose ends are both outside the district and which crosses the whole of
  // it, which is most of the streets in most districts.
  const pieces = [];
  let current = [];
  const push = (p) => {
    const last = current[current.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) current.push(p);
  };
  for (let i = 1; i < line.length; i++) {
    const seg = clipSegment(line[i - 1], line[i], box);
    if (!seg) {
      if (current.length >= 2) pieces.push(current);
      current = [];
      continue;
    }
    push(seg.a);
    push(seg.b);
    // The segment left the box part way along, so the piece ends here.
    if (seg.exits) {
      if (current.length >= 2) pieces.push(current);
      current = [];
    }
  }
  if (current.length >= 2) pieces.push(current);
  return pieces;
}

/**
 * The part of one segment that is inside the box.
 *
 * @returns {{a,b,exits}|null} the clipped ends, and whether the segment leaves
 *   the box before its own end, which is what breaks a piece in two
 */
function clipSegment(p0, p1, box) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  let t0 = 0, t1 = 1;
  const edges = [
    [-dx, p0[0] - box.minX],
    [dx, box.maxX - p0[0]],
    [-dz, p0[1] - box.minZ],
    [dz, box.maxZ - p0[1]],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;            // parallel to this edge and outside
      continue;
    }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return {
    a: [p0[0] + dx * t0, p0[1] + dz * t0],
    b: [p0[0] + dx * t1, p0[1] + dz * t1],
    exits: t1 < 1 - 1e-9,
  };
}

/** Sutherland Hodgman against the four edges of the box. */
function clipRings(list, box, key) {
  const out = [];
  for (const item of list) {
    const ring = clipRing(item[key], box);
    if (ring.length < 3) continue;
    const holes = (item.holes || []).map((h) => clipRing(h, box)).filter((h) => h.length >= 3);
    out.push({ ...item, [key]: ring, holes });
  }
  return out;
}

function clipRing(ring, box) {
  let poly = ring;
  const edges = [
    (p) => p[0] >= box.minX, (p) => p[0] <= box.maxX,
    (p) => p[1] >= box.minZ, (p) => p[1] <= box.maxZ,
  ];
  const at = [
    (a, b) => lerpTo(a, b, (box.minX - a[0]) / (b[0] - a[0])),
    (a, b) => lerpTo(a, b, (box.maxX - a[0]) / (b[0] - a[0])),
    (a, b) => lerpTo(a, b, (box.minZ - a[1]) / (b[1] - a[1])),
    (a, b) => lerpTo(a, b, (box.maxZ - a[1]) / (b[1] - a[1])),
  ];
  for (let e = 0; e < 4 && poly.length; e++) {
    const keep = edges[e];
    const next = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const ina = keep(a), inb = keep(b);
      if (ina && inb) next.push(b);
      else if (ina && !inb) next.push(at[e](a, b));
      else if (!ina && inb) { next.push(at[e](a, b)); next.push(b); }
    }
    poly = next;
  }
  return poly;
}

function lerpTo(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

// ---------------------------------------------------------------------------

function round2(v) { return Math.round(v * 100) / 100; }

/**
 * A coverage raster of the ground the city has actually drawn.
 *
 * Every triangle in the mesh that is flagged as ground and lies at ground
 * level is rasterised into a three metre grid. Roads, pavements, parks,
 * water, squares and the memorial floor all end up in here because all of
 * them are laid flat and say so; a roof does not, and neither does the
 * viaduct the Stadtbahn runs on six metres up, which is what the height test
 * is for. What is left over is where the base plane has to go.
 */
function drawnGroundCoverage(world, mesh, yAt) {
  // Three quarters of a metre, which is sixteen samples across a base cell.
  // The first version of this rasterised at 3.125 m and left the holes it was
  // written to close: a path through a park is a three metre gap in the park
  // polygon with a two metre ribbon drawn down the middle of it, and the half
  // metre of nothing either side fell between the samples. A grid this fine
  // costs twenty megabytes for the largest district and nothing at all at
  // runtime, because it is thrown away when the build ends.
  const step = 0.78125;
  const nx = Math.ceil(world.width / step) + 2;
  const nz = Math.ceil(world.depth / step) + 2;
  const data = new Uint8Array(nx * nz);
  const ix = (x) => Math.round((x - world.minX) / step);
  const iz = (z) => Math.round((z - world.minZ) / step);
  for (let i = 0; i < mesh.idx.length; i += 3) {
    const a = mesh.idx[i], b = mesh.idx[i + 1], c = mesh.idx[i + 2];
    if (!(mesh.flags[a] & FACADE_FLAG.GROUND)) continue;
    const ax = mesh.px[a], az = mesh.pz[a];
    const bx = mesh.px[b], bz = mesh.pz[b];
    const cx = mesh.px[c], cz = mesh.pz[c];
    // At ground level, or below it: water sits in its own bed and a sunken
    // square is still a square. Anything standing well above the terrain is
    // a surface with a view, not a surface you walk on.
    const my = (mesh.py[a] + mesh.py[b] + mesh.py[c]) / 3;
    const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
    if (my - yAt(mx, mz) > 1.5) continue;
    const x0 = ix(Math.min(ax, bx, cx)), x1 = ix(Math.max(ax, bx, cx));
    const z0 = iz(Math.min(az, bz, cz)), z1 = iz(Math.max(az, bz, cz));
    if (x1 < 0 || z1 < 0 || x0 >= nx || z0 >= nz) continue;
    // Edge functions once, then the sign of each sample against them.
    const e0x = bx - ax, e0z = bz - az;
    const e1x = cx - bx, e1z = cz - bz;
    const e2x = ax - cx, e2z = az - cz;
    const area = e0x * (cz - az) - e0z * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    const sign = area > 0 ? 1 : -1;
    for (let j = Math.max(0, z0); j <= Math.min(nz - 1, z1); j++) {
      const pz = world.minZ + j * step;
      for (let k = Math.max(0, x0); k <= Math.min(nx - 1, x1); k++) {
        const px = world.minX + k * step;
        if ((e0x * (pz - az) - e0z * (px - ax)) * sign < 0) continue;
        if ((e1x * (pz - bz) - e1z * (px - bx)) * sign < 0) continue;
        if ((e2x * (pz - cz) - e2z * (px - cx)) * sign < 0) continue;
        data[j * nx + k] = 1;
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
          const px = ix(x), pz = iz(z);
          if (px < 0 || pz < 0 || px >= nx || pz >= nz) return false;
          if (!data[pz * nx + px]) return false;
        }
      }
      return true;
    },
  };
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
/**
 * The facade palette. Vertices carry an index into it, and the renderer
 * uploads one palette for the whole city, so every district has to agree on
 * what index seven means. It is therefore frozen: the Berlin tones are the
 * palette, and a building that gives its own colour in the data is snapped to
 * the nearest tone rather than appended, which is what used to happen and
 * would have had the same index mean two colours in two districts.
 */
class Palette {
  constructor(seedColours, { frozen = false } = {}) {
    this.list = [];
    this.byKey = new Map();
    this.frozen = false;
    for (const c of seedColours) this.indexOf(c);
    this.frozen = frozen;
  }
  key(c) {
    return `${Math.round(c[0] * 31)}_${Math.round(c[1] * 31)}_${Math.round(c[2] * 31)}`;
  }
  indexOf(c) {
    const k = this.key(c);
    const hit = this.byKey.get(k);
    if (hit !== undefined) return hit;
    if (!this.frozen && this.list.length < 64) {
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

/**
 * Works out which outlines have building:part pieces inside them, so the
 * outline can be left undrawn and the pieces drawn in its place. A piece
 * belongs to the outline its middle falls in; nested outlines are rare enough
 * that the first match is the right one.
 *
 * @param {Array<{outer:Array,tags:Object,part:boolean}>} list every building
 *   and piece in the district, in the order they were read
 * @param {(piece)=>boolean} buildable whether a piece will actually be drawn.
 *   One that will not may not claim an outline, or the building disappears.
 * @returns {number} how many outlines were taken over by their pieces
 */
export function markBuildingParts(list, buildable = () => true) {
  const CELL = 120;
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  const whole = [];
  for (const b of list) {
    if (b.part || b.outer.length < 3) continue;
    const bb = bboxOf(b.outer);
    b._bb = bb;
    whole.push(b);
    for (let j = Math.floor(bb.minZ / CELL); j <= Math.floor(bb.maxZ / CELL); j++) {
      for (let i = Math.floor(bb.minX / CELL); i <= Math.floor(bb.maxX / CELL); i++) {
        const k = key(i, j);
        let cell = grid.get(k);
        if (!cell) { cell = []; grid.set(k, cell); }
        cell.push(b);
      }
    }
  }
  let taken = 0;
  for (const p of list) {
    if (!p.part || p.outer.length < 3) continue;
    if (!buildable(p)) continue;
    const [px, pz] = ringCentroid(p.outer);
    const cell = grid.get(key(Math.floor(px / CELL), Math.floor(pz / CELL)));
    if (!cell) continue;
    for (const b of cell) {
      if (b === p) continue;
      const bb = b._bb;
      if (px < bb.minX || px > bb.maxX || pz < bb.minZ || pz > bb.maxZ) continue;
      if (!pointInRing(px, pz, b.outer)) continue;
      if (!b.hasParts) { b.hasParts = true; taken++; }
      break;
    }
  }
  return taken;
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

// How far apart the name of a street is written along it, and the shortest
// piece of road worth writing on at all. A street is many ways in OSM and
// each one is labelled on its own, which is what you want on a map: the name
// is near you wherever on it you are standing.
const LABEL_SPACING = 240;
const LABEL_SHORTEST = 30;

/**
 * Where to write a street's name, and at what angle. One label every so many
 * metres along the way, sitting on the piece of it that is there, so the
 * text lies along the road rather than across it.
 *
 * @param {string} name what it is called
 * @param {Array<[number,number]>} line the way, in world metres
 * @param {string} cls the OSM highway class, which decides the size
 * @returns {Array<{n:string,x:number,z:number,a:number,c:string}>}
 */
function streetLabels(name, line, cls) {
  const total = polylineLength(line);
  if (total < LABEL_SHORTEST) return [];
  const out = [];
  const count = Math.max(1, Math.round(total / LABEL_SPACING));
  // Spread over the way rather than from one end, so two labels are never on
  // top of each other at a junction.
  for (let k = 0; k < count; k++) {
    const want = total * (k + 0.5) / count;
    let run = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (run + seg < want) { run += seg; continue; }
      const t = seg > 0 ? (want - run) / seg : 0;
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      // Never upside down: a name read from the other end is the same name.
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      out.push({
        n: name,
        x: Math.round(a[0] + (b[0] - a[0]) * t),
        z: Math.round(a[1] + (b[1] - a[1]) * t),
        a: Math.round(ang * 100) / 100,
        c: cls,
      });
      break;
    }
  }
  return out;
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

/**
 * A square of collision round something standing on the pavement: a lamp
 * post, a bollard. Four segments, the same way a tree trunk is done, so
 * that what you can see you can also walk into.
 */
function pushPostCollision(collision, x, z, base, top, half) {
  const ring = [[x - half, z - half], [x + half, z - half],
    [x + half, z + half], [x - half, z + half]];
  pushFootprintCollision(collision, ring, base, top, SURFACE.STONE);
}

/**
 * The same, for something longer than it is wide and parked at an angle: a
 * car. A square the width of a car is a metre and a half of nothing at each
 * end that you walk straight through, so this is the real rectangle, turned
 * the way the thing is turned.
 */
function pushBoxCollision(collision, x, z, yaw, wide, long, base, top) {
  // Along the road is (sin yaw, cos yaw), the same convention the mesh uses,
  // and across it is the perpendicular.
  const lx = Math.sin(yaw), lz = Math.cos(yaw);
  const wx = Math.cos(yaw), wz = -Math.sin(yaw);
  const hw = wide / 2, hl = long / 2;
  const at = (a, b) => [x + wx * a + lx * b, z + wz * a + lz * b];
  const ring = [at(-hw, -hl), at(hw, -hl), at(hw, hl), at(-hw, hl)];
  pushFootprintCollision(collision, ring, base, top, SURFACE.STONE);
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
function buildSurfaceGrid(world, roads, areas, greens, waterPolys, memorials, step = 2.5) {
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

/**
 * The one place in a district worth naming on the loading screen.
 *
 * The crossing screen has to say where you are going before any of the
 * district has arrived, so the name has to live in the small index that is
 * loaded once at the start rather than in the district's own file. This picks
 * it: a landmark that came with a written card first, because those are the
 * ones a person has heard of, then any named attraction, then the station the
 * district is built around, each time the one nearest the middle. Nothing is
 * invented. A district whose extract named nothing gets null and the screen
 * leaves the line out.
 *
 * @param {Array} landmarks the district's landmark cards
 * @param {Array} stations its railway stations
 * @param {{minX,minZ,maxX,maxZ}} world its box in metres
 * @returns {string|null}
 */
function pickSight(landmarks, stations, world) {
  const cx = (world.minX + world.maxX) / 2;
  const cz = (world.minZ + world.maxZ) / 2;
  const nearest = (list) => {
    let best = null; let bestD = Infinity;
    for (const it of list) {
      if (!it.name) continue;
      const d = Math.hypot(it.x - cx, it.z - cz);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  };
  const told = nearest(landmarks.filter((l) => l.text));
  if (told) return told.name;
  const any = nearest(landmarks);
  if (any) return any.name;
  const stop = nearest(stations.filter((s) => s.kind === 'station'))
    || nearest(stations);
  return stop ? stop.name : null;
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

function tileAndPack(mesh, collision, trees, world, terrain, surfaceGrid, grid = COLLISION_GRID) {
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
  const spend = { vertices: 0, indices: 0, grids: 0, segments: 0, trees: 0, surface: 0 };
  let nonEmpty = 0;
  let maxTileBytes = 0, maxTileTris = 0, totalTileBytes = 0;
  let tallest = 0;

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
        spend.vertices += vbuf.length;
        rec.iOff = offset; rec.iCount = list.length * 3; rec.i32 = use32 ? 1 : 0;
        chunks.push(ibuf); offset += ibuf.length;
        spend.indices += ibuf.length;
        rec.tris = list.length;
        rec.min = [round2(minX), round2(minY), round2(minZ)];
        rec.max = [round2(maxX), round2(maxY), round2(maxZ)];
        if (maxY > tallest) tallest = maxY;
        bytesThisTile += vbuf.length + ibuf.length;
        if (list.length > maxTileTris) maxTileTris = list.length;
      } else {
        rec.vOff = offset; rec.vCount = 0; rec.iOff = offset; rec.iCount = 0; rec.i32 = 0; rec.tris = 0;
        rec.min = [0, 0, 0]; rec.max = [TILE_SIZE, 1, TILE_SIZE];
      }

      // Collision blob.
      const segs = colBuckets[t] || [];
      const cbuf = Buffer.alloc(4 + segs.length * 12 + grid * grid * 2);
      cbuf.writeUInt16LE(segs.length, 0);
      cbuf.writeUInt16LE(grid, 2);
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
      for (let gz = 0; gz < grid; gz++) {
        for (let gx = 0; gx < grid; gx++) {
          const x = originX + (gx / (grid - 1)) * TILE_SIZE;
          const z = originZ + (gz / (grid - 1)) * TILE_SIZE;
          cbuf.writeInt16LE(clampI16(Math.round(terrain.height(x, z) * GROUND_SCALE)), cp);
          cp += 2;
        }
      }
      rec.cOff = offset; rec.cLen = cbuf.length; rec.segs = segs.length;
      chunks.push(cbuf); offset += cbuf.length;
      bytesThisTile += cbuf.length;
      spend.grids += grid * grid * 2;
      spend.segments += 4 + segs.length * 12;

      // Trees, packed as 8 bytes each.
      const tl = treeBuckets[t] || [];
      if (tl.length) {
        const tbuf = Buffer.alloc(tl.length * 8);
        spend.trees += tl.length * 8;
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

  spend.surface = surfaceGrid.data.length;
  const surfaceOffset = offset;
  chunks.push(Buffer.from(surfaceGrid.data.buffer, surfaceGrid.data.byteOffset, surfaceGrid.data.length));
  offset += surfaceGrid.data.length;

  return {
    buffer: Buffer.concat(chunks),
    tiles, tileCountX, tileCountZ, nonEmpty,
    surfaceOffset,
    maxTileKB: maxTileBytes / 1024,
    meanTileKB: totalTileBytes / Math.max(1, tiles.length) / 1024,
    maxTileTris, tallest, spend,
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
