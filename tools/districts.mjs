// Berlin inside the Ring, cut into districts.
//
// The playable area is the bounding box of the Ringbahn, taken from the four
// stations that sit at its corners rather than from a round number:
//
//   west    Westkreuz      52.5010 N, 13.2840 E
//   east    Ostkreuz       52.5031 N, 13.4689 E
//   north   Gesundbrunnen  52.5486 N, 13.3894 E
//   south   Suedkreuz      52.4720 N, 13.3670 E
//
// That box is 12.5 km by 8.5 km, about 106 square kilometres, and the ring
// itself encloses about 88 of them; the corners of the box fall outside the
// ring, which is what the difference is. Sources are in docs/PLAN.md.
//
// A district is a block of the global tile grid, anchored so that the original
// playable box, the one with the Gate and the memorial in it, is exactly one
// district. The cuts are made in tiles, not in degrees, so the districts
// partition the city exactly: every tile belongs to one district, and a
// building belongs to the district its middle is in and is built once.
//
// Detail falls off with distance from the middle, because the whole city at
// the detail of Mitte is about a hundred and thirty megabytes and the budget
// is twenty five. What the tiers change is in TIERS below, and what it costs
// is printed by the build.

import { BBOX, CITY, cityGrid, boundsOf, unproject } from './geo.mjs';
import { TILE_SIZE } from '../src/shared/constants.js';

export { CITY };

// Where the cuts want to be, in degrees. The middle column and the middle band
// are the original box, so its edges appear in both lists; the rest are laid
// out either side of it at about 1.7 km and 1.9 km. Each of these is then
// rounded to the nearest line of the global tile grid.
const LON_EDGES = [CITY.west, 13.3150, 13.3400, BBOX.west, BBOX.east, 13.4400, CITY.east];
const LAT_EDGES = [CITY.south, 52.4910, BBOX.south, BBOX.north, CITY.north];

/**
 * What each tier of detail carries. Tier 0 is the city the game shipped with.
 * Everything here is read by the build; nothing reads it at runtime.
 */
export const TIERS = [
  {
    // The middle. Every building, the landmark models, the stelae field, the
    // window shader, trees from the extract, the full height field. Measured
    // on the live extract: 7.7 MB of download for 6.5 square kilometres,
    // which is a third of the budget for six per cent of the city, and worth
    // it, because this is the Berlin the brief asks for by name.
    name: 'full',
    minArea: 6, simplify: 0, roofs: true, windows: true, landmarks: true,
    trees: 1, driveOnly: false, grid: 33, kerbs: true, groundStep: 12.5,
    boxBelow: 0, service: true, surfaceStep: 2.5,
    // Even here the centrelines are simplified. OpenStreetMap puts a node
    // every few metres round a kerb, every node is four vertices of ribbon
    // and twelve with the pavements, and half a metre of wiggle is not
    // visible from inside the street.
    roadSimplify: 0.5,
  },
  {
    // The four districts you walk into from the middle. Still has its roofs,
    // its windows and its trees, but no pavements, simplified footprints and
    // centrelines, and a coarser ground. The first version of this tier kept
    // everything and cost as much per square kilometre as Mitte did, which is
    // how the whole city came to seventy megabytes.
    name: 'near',
    minArea: 40, simplify: 1.2, roofs: true, windows: true, landmarks: true,
    trees: 1, driveOnly: false, grid: 17, kerbs: false, groundStep: 25,
    boxBelow: 0, service: true, surfaceStep: 5.0, roadSimplify: 1.5,
  },
  {
    // Most of the city. Blocks: every building still solid and still
    // climbable, but roofs flattened, no window detail, small ones become the
    // box that fits them, a third of the trees, and only the roads you can
    // drive on.
    name: 'block',
    minArea: 120, simplify: 2.5, roofs: false, windows: false, landmarks: true,
    trees: 0.3, driveOnly: true, grid: 9, kerbs: false, groundStep: 50,
    boxBelow: 700, service: false, surfaceStep: 10.0, roadSimplify: 5.0,
  },
  {
    // The corners of the box, which are the parts outside the ring: Westend,
    // the far side of the Spree, the fields south of Tempelhof. You can still
    // walk and drive in them and everything in them is solid, but they are
    // built as an outline of a city rather than a city, because the budget
    // for the whole place is twenty five megabytes and the middle of town is
    // worth more of it than the edge of the map.
    name: 'outline',
    minArea: 250, simplify: 4.0, roofs: false, windows: false, landmarks: true,
    trees: 0, driveOnly: true, grid: 5, kerbs: false, groundStep: 100,
    boxBelow: 2000, service: false, surfaceStep: 20.0, roadSimplify: 10.0,
  },
];

/**
 * Which tier a district is built at, by how far out it is.
 *
 * Measured on the live extract rather than chosen: at the first set of tiers
 * the whole city was 70.6 MB of download against a 25 MB budget, and the
 * districts next to the middle were costing as much per square kilometre as
 * the middle itself. Only the four districts you can walk into directly from
 * Mitte are built at walking detail now; the rest of the ring is blocks, and
 * the corners outside it are an outline.
 */
function tierFor(colAway, rowAway) {
  const ring = Math.max(colAway, rowAway);
  if (ring === 0) return 0;
  // Edge to edge with the middle, not corner to corner: you can walk into it.
  if (ring === 1 && colAway + rowAway === 1) return 1;
  if (ring <= 2) return 2;
  return 3;
}

/** The id of the district that holds the original box. */
export const CORE_ID = 'core';

/** Degrees of margin a fetch takes around a district, for walls on the cut. */
export const FETCH_MARGIN = 0.0025;   // about 170 m north to south

function cuts(edges, axis) {
  const grid = cityGrid(TILE_SIZE);
  const out = [];
  for (const e of edges) {
    const b = boundsOf({ west: e, east: e, south: e, north: e });
    const metres = axis === 'x' ? b.minX : b.minZ;
    const base = axis === 'x' ? grid.minX : grid.minZ;
    const span = axis === 'x' ? grid.nx : grid.nz;
    out.push(Math.max(0, Math.min(span, Math.round((metres - base) / TILE_SIZE))));
  }
  // Latitude runs the other way from z, so the cuts come out descending.
  out.sort((a, b) => a - b);
  return [...new Set(out)];
}

function makeDistricts() {
  const grid = cityGrid(TILE_SIZE);
  const xCuts = cuts(LON_EDGES, 'x');
  const zCuts = cuts(LAT_EDGES, 'z');
  // The original box, in tiles, so the cell that matches it can be found.
  const core = boundsOf(BBOX);
  const coreTx = Math.round((core.minX - grid.minX) / TILE_SIZE);
  const coreTz = Math.round((core.minZ - grid.minZ) / TILE_SIZE);
  const coreCol = xCuts.indexOf(coreTx);
  const coreRow = zCuts.indexOf(coreTz);
  const out = [];
  for (let row = 0; row < zCuts.length - 1; row++) {
    for (let col = 0; col < xCuts.length - 1; col++) {
      const tx = xCuts[col], tz = zCuts[row];
      const nx = xCuts[col + 1] - tx, nz = zCuts[row + 1] - tz;
      const isCore = col === coreCol && row === coreRow;
      const minX = grid.minX + tx * TILE_SIZE;
      const minZ = grid.minZ + tz * TILE_SIZE;
      const maxX = minX + nx * TILE_SIZE;
      const maxZ = minZ + nz * TILE_SIZE;
      // The lat lon box of exactly those tiles, which is what gets fetched.
      const [west, north] = unproject(minX, minZ);
      const [east, south] = unproject(maxX, maxZ);
      out.push({
        id: isCore ? CORE_ID : `c${col}r${row}`,
        col, row, core: isCore,
        tier: tierFor(Math.abs(col - coreCol), Math.abs(row - coreRow)),
        tx, tz, nx, nz,
        bounds: { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ },
        bbox: { west, east, south, north },
      });
    }
  }
  return out;
}

export const DISTRICTS = makeDistricts();

export function districtById(id) {
  return DISTRICTS.find((d) => d.id === id) || null;
}

/** The district a point in metres is in, or null outside the city. */
export function districtAt(x, z) {
  return DISTRICTS.find((d) => x >= d.bounds.minX && x < d.bounds.maxX
    && z >= d.bounds.minZ && z < d.bounds.maxZ) || null;
}

/** The box a district is fetched with: its own box plus a margin. */
export function fetchBbox(district) {
  const b = district.bbox;
  return {
    west: b.west - FETCH_MARGIN * 1.6, east: b.east + FETCH_MARGIN * 1.6,
    south: b.south - FETCH_MARGIN, north: b.north + FETCH_MARGIN,
  };
}

/** Metres across and down, and square kilometres. */
export function extent(bbox) {
  const mPerLat = 110574.0;
  const mPerLon = 111320.0 * Math.cos(((bbox.south + bbox.north) / 2) * Math.PI / 180);
  const width = (bbox.east - bbox.west) * mPerLon;
  const depth = (bbox.north - bbox.south) * mPerLat;
  return { width, depth, area: (width * depth) / 1e6 };
}
