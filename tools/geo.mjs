// Local metric projection for the city.
//
// Equirectangular about the Brandenburg Gate. Over the original 2.7 km box the
// error against a proper transverse Mercator is a couple of centimetres. Over
// the whole ring, twelve and a half kilometres across, the longitude scale
// drifts by about fifteen metres at the far corners, because the metres in a
// degree of longitude shrink as you go north and this uses one number for all
// of them. That does not matter here and it is not laziness: everything in the
// city, the buildings, the roads, the collision and the map, is projected with
// the same two constants, so the whole place is consistently fifteen metres
// stretched rather than fifteen metres torn. Nothing lines up against an
// external map, and nothing has a seam.

export const ORIGIN = { lat: 52.5163, lon: 13.3777 };
// The original playable box, and now the middle district: the Gate, the
// memorial, the Reichstag, Museum Island and the tower.
//
// The brief gives east 13.4050 but also asks for Alexanderplatz and the
// Fernsehturm, which stand at 13.4094 and 13.4131. The landmark list wins, so
// the east edge runs to 13.4150. See docs/PLAN.md section 7.
export const BBOX = { south: 52.5080, west: 13.3650, north: 52.5250, east: 13.4150 };

// The whole playable area: the bounding box of the Ringbahn, taken from the
// four stations at its corners. See tools/districts.mjs.
export const CITY = { south: 52.4720, west: 13.2840, north: 52.5486, east: 13.4689 };

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 110574.0;
const M_PER_DEG_LON = 111320.0 * Math.cos(ORIGIN.lat * DEG);

export function project(lon, lat) {
  return [
    (lon - ORIGIN.lon) * M_PER_DEG_LON,
    -(lat - ORIGIN.lat) * M_PER_DEG_LAT,
  ];
}

export function unproject(x, z) {
  return [
    ORIGIN.lon + x / M_PER_DEG_LON,
    ORIGIN.lat - z / M_PER_DEG_LAT,
  ];
}

/** The projected box of a lat lon box, without any snapping. */
export function boundsOf(bbox) {
  const [x0, z0] = project(bbox.west, bbox.north);
  const [x1, z1] = project(bbox.east, bbox.south);
  return { minX: x0, minZ: z0, maxX: x1, maxZ: z1, width: x1 - x0, depth: z1 - z0 };
}

export function worldBounds() { return boundsOf(BBOX); }

/**
 * The global tile grid. Every district is cut on the same lines, so a tile
 * index means the same thing in all of them and a district boundary is never
 * in the middle of a tile.
 *
 * @param {number} tileSize metres
 */
export function cityGrid(tileSize) {
  const raw = boundsOf(CITY);
  const minX = Math.floor(raw.minX / tileSize) * tileSize;
  const minZ = Math.floor(raw.minZ / tileSize) * tileSize;
  const nx = Math.ceil((raw.maxX - minX) / tileSize);
  const nz = Math.ceil((raw.maxZ - minZ) / tileSize);
  return {
    minX, minZ, nx, nz, tileSize,
    maxX: minX + nx * tileSize, maxZ: minZ + nz * tileSize,
  };
}

/**
 * One district's bounds, snapped outward onto the global grid.
 *
 * @returns {{minX,minZ,maxX,maxZ,width,depth,tx,tz,nx,nz}} the box in metres
 *   plus where it sits in the global grid, in tiles
 */
export function districtBounds(bbox, tileSize) {
  const grid = cityGrid(tileSize);
  const raw = boundsOf(bbox);
  const tx0 = Math.floor((raw.minX - grid.minX) / tileSize);
  const tz0 = Math.floor((raw.minZ - grid.minZ) / tileSize);
  const tx1 = Math.ceil((raw.maxX - grid.minX) / tileSize);
  const tz1 = Math.ceil((raw.maxZ - grid.minZ) / tileSize);
  const minX = grid.minX + tx0 * tileSize;
  const minZ = grid.minZ + tz0 * tileSize;
  return {
    minX, minZ,
    maxX: grid.minX + tx1 * tileSize,
    maxZ: grid.minZ + tz1 * tileSize,
    width: (tx1 - tx0) * tileSize,
    depth: (tz1 - tz0) * tileSize,
    tx: tx0, tz: tz0, nx: tx1 - tx0, nz: tz1 - tz0,
  };
}

export const METRES_PER_DEG_LAT = M_PER_DEG_LAT;
export const METRES_PER_DEG_LON = M_PER_DEG_LON;
