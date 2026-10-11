// Local metric projection for the playable box.
// Equirectangular about the Brandenburg Gate. Over 2.7 km the error against a
// proper transverse Mercator is a couple of centimetres, which no walker sees.

export const ORIGIN = { lat: 52.5163, lon: 13.3777 };
// The brief gives east 13.4050 but also asks for Alexanderplatz and the
// Fernsehturm, which stand at 13.4094 and 13.4131. The landmark list wins, so
// the east edge runs to 13.4150. See docs/PLAN.md section 7.
export const BBOX = { south: 52.5080, west: 13.3650, north: 52.5250, east: 13.4150 };

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

export function worldBounds() {
  const [x0, z0] = project(BBOX.west, BBOX.north);
  const [x1, z1] = project(BBOX.east, BBOX.south);
  return { minX: x0, minZ: z0, maxX: x1, maxZ: z1, width: x1 - x0, depth: z1 - z0 };
}

export const METRES_PER_DEG_LAT = M_PER_DEG_LAT;
export const METRES_PER_DEG_LON = M_PER_DEG_LON;
