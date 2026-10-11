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
    // window shader, trees from the extract, the full height field.
    name: 'full',
    minArea: 6, simplify: 0, roofs: true, windows: true, landmarks: true,
    trees: 1, driveOnly: false, grid: 33, kerbs: true, groundStep: 12.5,
    boxBelow: 0, service: true, surfaceStep: 2.5, roadSimplify: 0,
  },
  {
    // Next door. Still walkable detail, but sheds and garages go, the
    // footprints lose their centimetre wiggles, and the height field is
    // halved, which Berlin can afford because Berlin is flat.
    name: 'near',
    minArea: 24, simplify: 0.7, roofs: true, windows: true, landmarks: true,
    trees: 1, driveOnly: false, grid: 17, kerbs: true, groundStep: 12.5,
    boxBelow: 0, service: true, surfaceStep: 2.5, roadSimplify: 0,
  },
  {
    // The rest of the way out to the ring. Blocks: every building still solid
    // and still climbable, but roofs flattened, no window detail, half the
    // trees, no kerbs, only the roads you can drive on, and a nine point
    // height field.
    name: 'block',
    minArea: 80, simplify: 2.2, roofs: false, windows: false, landmarks: true,
    trees: 0.35, driveOnly: true, grid: 9, kerbs: false, groundStep: 50,
    // A small building out here becomes the box that fits it: four walls
    // instead of nine, which halves what the far half of the city costs. The
    // big ones, the ones that give a street its shape, keep their footprint.
    boxBelow: 450, service: false, surfaceStep: 5.0, roadSimplify: 3.0,
  },
];

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
      const ring = Math.max(Math.abs(col - coreCol), Math.abs(row - coreRow));
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
        tier: Math.min(TIERS.length - 1, ring),
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
