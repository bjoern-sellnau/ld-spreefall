// Berlin, cut into districts.
//
// The playable area is the whole city, out to the administrative boundary: a
// box 45.7 km across and 37.4 km down, 1,706 square kilometres of which the
// city itself is about 891. Sources for the extent are in tools/geo.mjs.
//
// The lattice is not regular, and that is deliberate. Near the middle a
// district is small, because small districts stream in quickly and the detail
// there is high; further out they are large, because a district is one
// Overpass query and one build, and nobody wants four hundred of either. So
// the city is laid out in bands:
//
//   core    the original playable box, the Gate and the memorial      1 of them
//   ring    inside the Ringbahn, about 1.7 by 1.9 km each            23
//   inner   out to Steglitz, Lichterfelde, Treptow, 4 km cells       ~24
//   outer   the rest of Berlin, 8 km cells                           ~19
//
// Every cut is made on the lines of one city wide tile grid, so the districts
// partition the city exactly: every tile belongs to one district, and a
// building belongs to the district its middle is in and is built once.
//
// Detail falls off with distance from the middle, because the whole city at
// the detail of Mitte would be hundreds of megabytes. What the tiers change is
// in TIERS below, and what it costs is printed by the build.

import { BBOX, CITY, RING, cityGrid, boundsOf, unproject } from './geo.mjs';
import { TILE_SIZE } from '../src/shared/constants.js';

export { CITY, RING };

// Where the cuts want to be inside the ring, in degrees. The middle column and
// the middle band are the original box, so its edges appear in both lists; the
// rest are laid out either side of it at about 1.7 km and 1.9 km. Each of
// these is then rounded to the nearest line of the global tile grid.
const RING_LON = [RING.west, 13.3150, 13.3400, BBOX.west, BBOX.east, 13.4400, RING.east];
const RING_LAT = [RING.south, 52.4910, BBOX.south, BBOX.north, RING.north];

// The band between the ring and the rest of the city, where Steglitz,
// Lichterfelde, Treptow, Wedding's northern half and Charlottenburg's western
// half are. Four kilometre cells.
const INNER_CELL = 4000;
// And the rest of Berlin, in eight kilometre cells.
const OUTER_CELL = 8000;
// How far the inner band reaches, in metres from the Gate. Twelve kilometres
// takes in everything most people mean by Berlin before they start naming
// outskirts.
const INNER_REACH = { x: 13000, z: 11000 };

/**
 * What each tier of detail carries. Tier 0 is the city the game shipped with.
 * Everything here is read by the build; nothing reads it at runtime.
 */
export const TIERS = [
  {
    // The middle. Every building, the landmark models, the stelae field, the
    // window shader, trees from the extract, the full height field. Measured
    // on the live extract: 7.7 MB of download for 6.5 square kilometres,
    // which is a third of the budget for six per cent of the ring, and worth
    // it, because this is the Berlin the brief asks for by name.
    name: 'full',
    minArea: 6, simplify: 0, roofs: true, windows: true, landmarks: true,
    // Relief on the frontages: the cornice under the eaves and the band over
    // the shop windows. Only here, because it is two quads an edge on every
    // building and it is only worth that from the pavement.
    relief: true,
    // And what stands on it: lamps, parked cars, bins and benches. Same
    // reasoning as the relief, and the same tier.
    props: true,
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
    // centrelines, and a coarser ground.
    name: 'near',
    minArea: 40, simplify: 1.2, roofs: true, windows: true, landmarks: true,
    trees: 1, driveOnly: false, grid: 17, kerbs: false, groundStep: 25,
    boxBelow: 0, service: true, surfaceStep: 5.0, roadSimplify: 1.5,
  },
  {
    // The rest of the ring. Still solid and still climbable, small ones
    // become the box that fits them, a third of the trees, and only the
    // roads you can drive on. Roofs and windows are on, and both were off
    // here for years on the assumption that they were expensive. The windows
    // cost nothing at all, and the roofs came out cheaper than the flat ones
    // they replaced: see the note on `roofs` in tools/build-world.mjs.
    //
    // The windows stay on, and they are the reason this tier stopped reading
    // as a warehouse estate. They are not geometry: `windows` sets one flag
    // bit on the vertex and the whole pattern is a fragment shader that reads
    // the building's own storey count, so this costs nothing in the download
    // and nothing in triangles. It was off here for a long time for no better
    // reason than that it sounded expensive.
    name: 'block',
    minArea: 120, simplify: 2.5, roofs: true, windows: true, landmarks: true,
    trees: 0.3, driveOnly: true, grid: 9, kerbs: false, groundStep: 50,
    boxBelow: 700, service: false, surfaceStep: 10.0, roadSimplify: 5.0,
  },
  {
    // Out past the ring: Steglitz, Lichterfelde, Treptow and the rest. An
    // outline of a city rather than a city. Everything is solid, everything
    // can be walked on and driven through, and nothing has any detail it does
    // not need to be those two things. The windows are the exception, for the
    // same reason as the tier above: they are a flag bit, not geometry, and
    // the shader now draws the average of a frontage rather than a pattern
    // once a storey goes under a pixel, so a suburb five kilometres off is a
    // tone rather than a flicker.
    name: 'outline',
    minArea: 250, simplify: 4.0, roofs: true, windows: true, landmarks: true,
    trees: 0, driveOnly: true, grid: 5, kerbs: false, groundStep: 100,
    boxBelow: 2000, service: false, surfaceStep: 20.0, roadSimplify: 10.0,
  },
  {
    // The edge of the box, which is mostly Brandenburg: fields, lakes, forest
    // and the odd village. Built so the city has somewhere to end rather than
    // a wall, and built as cheaply as this project knows how.
    name: 'sketch',
    minArea: 600, simplify: 8.0, roofs: false, windows: false, landmarks: false,
    trees: 0, driveOnly: true, grid: 5, kerbs: false, groundStep: 200,
    boxBelow: 100000, service: false, surfaceStep: 40.0, roadSimplify: 20.0,
  },
  {
    // Not a band of the city: the second build of every district inside the
    // inner band, for a fast travel flight to pass over at four hundred
    // metres up. Nothing here is walked on, so the ground, the footstep map
    // and the height field are the cheapest the build can make them, and
    // every building is the box that fits it.
    //
    // What is not cut is how many buildings there are. The sketch tier above
    // drops everything under 600 m2, which kept eighteen per cent of them in
    // the districts this was measured on, and a city with one house in five
    // reads as a bombed one from the air rather than a coarse one. A box is
    // ten triangles, so the way to spend less is not to have fewer of them.
    // The landmarks stay for the same reason: the one thing you look for out
    // of a window at four hundred metres is the Fernsehturm.
    //
    // The roofs and the windows stay on because both are cheaper on than
    // off, which is measured twice over in this tree: a flat roof is a cap
    // plus a parapet and a parapet is two triangles an edge, and a window is
    // one flag bit on the vertex and a fragment shader. Turning them off
    // here made i24 larger than its own fine build.
    name: 'overflight',
    minArea: 250, simplify: 8.0, roofs: true, windows: true, landmarks: true,
    trees: 0, driveOnly: true, grid: 5, kerbs: false, groundStep: 200,
    boxBelow: 100000, service: false, surfaceStep: 40.0, roadSimplify: 20.0,
  },
];

/** The id of the district that holds the original box. */
export const CORE_ID = 'core';

/**
 * The row of TIERS a district is built at a second time, for the fast travel
 * flight to pass over.
 *
 * A flight crosses the city at four hundred metres a second, which gives a
 * district a few seconds between coming into reach and going past. Its own
 * bundle is between three and forty megabytes and does not arrive in that.
 */
export const OVERFLIGHT_TIER = 5;

/**
 * The coarsest district that is worth building twice.
 *
 * Measured on the districts this was written against, gzipped, own build
 * against overflight build: Mitte 4.76 to 1.57 MB, Ring 4-1 2.46 to 1.94,
 * Ring 3-2 0.81 to 0.46, and Steglitz 2.86 to 2.85. The last one is the
 * answer: out past the ring a district is already within a hair of the
 * overflight row, because two thirds of what it weighs is building walls and
 * the overflight row keeps the same walls. Those fly over themselves.
 */
export const OVERFLIGHT_UNTIL = 2;

/** Degrees of margin a fetch takes around a district, for walls on the cut. */
export const FETCH_MARGIN = 0.0025;   // about 170 m north to south

const grid = cityGrid(TILE_SIZE);

/** A metre position as a column of the global tile grid. */
function colAt(x) {
  return Math.max(0, Math.min(grid.nx, Math.round((x - grid.minX) / TILE_SIZE)));
}
function rowAt(z) {
  return Math.max(0, Math.min(grid.nz, Math.round((z - grid.minZ) / TILE_SIZE)));
}

/** Cut lines for a box in degrees, as columns of the global grid. */
function cutsFrom(edges, axis) {
  const out = edges.map((e) => {
    const b = boundsOf({ west: e, east: e, south: e, north: e });
    return axis === 'x' ? colAt(b.minX) : rowAt(b.minZ);
  });
  out.sort((a, b) => a - b);
  return [...new Set(out)];
}

/** Even cuts of about `cell` metres between two grid lines, ending on both. */
function evenCuts(from, to, cell) {
  const span = to - from;
  if (span <= 0) return [from];
  const n = Math.max(1, Math.round((span * TILE_SIZE) / cell));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(from + Math.round((span * i) / n));
  return [...new Set(out)];
}

function cellsBetween(xCuts, zCuts, skip) {
  const out = [];
  for (let r = 0; r < zCuts.length - 1; r++) {
    for (let c = 0; c < xCuts.length - 1; c++) {
      const tx = xCuts[c], tz = zCuts[r];
      const nx = xCuts[c + 1] - tx, nz = zCuts[r + 1] - tz;
      if (nx <= 0 || nz <= 0) continue;
      // A cell that is inside a finer band is left to that band.
      if (skip && skip(tx, tz, nx, nz)) continue;
      out.push({ tx, tz, nx, nz });
    }
  }
  return out;
}

function withBox(cell) {
  const minX = grid.minX + cell.tx * TILE_SIZE;
  const minZ = grid.minZ + cell.tz * TILE_SIZE;
  const maxX = minX + cell.nx * TILE_SIZE;
  const maxZ = minZ + cell.nz * TILE_SIZE;
  const [west, north] = unproject(minX, minZ);
  const [east, south] = unproject(maxX, maxZ);
  return {
    ...cell,
    bounds: { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ },
    bbox: { west, east, south, north },
  };
}

function makeDistricts() {
  const out = [];

  // --- the ring, in fine cells -------------------------------------------
  const ringX = cutsFrom(RING_LON, 'x');
  const ringZ = cutsFrom(RING_LAT, 'z');
  const core = boundsOf(BBOX);
  const coreTx = colAt(core.minX);
  const coreTz = rowAt(core.minZ);
  const coreCol = ringX.indexOf(coreTx);
  const coreRow = ringZ.indexOf(coreTz);
  for (const cell of cellsBetween(ringX, ringZ, null)) {
    const col = ringX.indexOf(cell.tx);
    const row = ringZ.indexOf(cell.tz);
    const isCore = col === coreCol && row === coreRow;
    const away = Math.max(Math.abs(col - coreCol), Math.abs(row - coreRow));
    const edgeOn = Math.abs(col - coreCol) + Math.abs(row - coreRow) === 1;
    out.push({
      ...withBox(cell),
      id: isCore ? CORE_ID : `c${col}r${row}`,
      band: 'ring', col, row, core: isCore,
      tier: isCore ? 0 : (away === 1 && edgeOn ? 1 : 2),
    });
  }

  // --- the band out to Steglitz, Lichterfelde and Treptow ------------------
  const ringBox = {
    x0: Math.min(...ringX), x1: Math.max(...ringX),
    z0: Math.min(...ringZ), z1: Math.max(...ringZ),
  };
  const innerBox = {
    x0: colAt(-INNER_REACH.x), x1: colAt(INNER_REACH.x),
    z0: rowAt(-INNER_REACH.z), z1: rowAt(INNER_REACH.z),
  };
  const insideRing = (tx, tz, nx, nz) => tx >= ringBox.x0 && tx + nx <= ringBox.x1
    && tz >= ringBox.z0 && tz + nz <= ringBox.z1;
  const innerX = [...new Set([
    ...evenCuts(innerBox.x0, ringBox.x0, INNER_CELL),
    ...evenCuts(ringBox.x0, ringBox.x1, INNER_CELL),
    ...evenCuts(ringBox.x1, innerBox.x1, INNER_CELL),
  ])].sort((a, b) => a - b);
  const innerZ = [...new Set([
    ...evenCuts(innerBox.z0, ringBox.z0, INNER_CELL),
    ...evenCuts(ringBox.z0, ringBox.z1, INNER_CELL),
    ...evenCuts(ringBox.z1, innerBox.z1, INNER_CELL),
  ])].sort((a, b) => a - b);
  let n = 0;
  for (const cell of cellsBetween(innerX, innerZ, insideRing)) {
    out.push({
      ...withBox(cell),
      id: `i${n}`, band: 'inner', col: 0, row: 0, core: false,
      tier: 3,
    });
    n++;
  }

  // --- and the rest of Berlin ---------------------------------------------
  const insideInner = (tx, tz, nx, nz) => tx >= innerBox.x0 && tx + nx <= innerBox.x1
    && tz >= innerBox.z0 && tz + nz <= innerBox.z1;
  const outerX = [...new Set([
    ...evenCuts(0, innerBox.x0, OUTER_CELL),
    ...evenCuts(innerBox.x0, innerBox.x1, OUTER_CELL),
    ...evenCuts(innerBox.x1, grid.nx, OUTER_CELL),
  ])].sort((a, b) => a - b);
  const outerZ = [...new Set([
    ...evenCuts(0, innerBox.z0, OUTER_CELL),
    ...evenCuts(innerBox.z0, innerBox.z1, OUTER_CELL),
    ...evenCuts(innerBox.z1, grid.nz, OUTER_CELL),
  ])].sort((a, b) => a - b);
  let m = 0;
  for (const cell of cellsBetween(outerX, outerZ, insideInner)) {
    out.push({
      ...withBox(cell),
      id: `o${m}`, band: 'outer', col: 0, row: 0, core: false,
      tier: 4,
    });
    m++;
  }

  // Nearest the middle first, which is the order everything else wants them
  // in: the fetcher, the builder and the thing that decides what ships.
  const mid = { x: 0, z: 0 };
  out.sort((a, b) => {
    const da = Math.hypot((a.bounds.minX + a.bounds.maxX) / 2 - mid.x,
      (a.bounds.minZ + a.bounds.maxZ) / 2 - mid.z);
    const db = Math.hypot((b.bounds.minX + b.bounds.maxX) / 2 - mid.x,
      (b.bounds.minZ + b.bounds.maxZ) / 2 - mid.z);
    return da - db;
  });
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
