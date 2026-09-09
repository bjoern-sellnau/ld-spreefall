// Solar position for Berlin, from the NOAA solar position algorithm. Good to
// well under a degree, which is far better than anyone can tell from a shadow.

const DEG = Math.PI / 180;

export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * @returns {{altitude:number, azimuth:number, declination:number}} radians.
 *          azimuth is measured clockwise from north.
 */
export function solarPosition(date, latDeg, lonDeg) {
  const jd = julianDay(date);
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const epsilon = (23.439 - 0.0000004 * n) * DEG;

  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  let rightAscension = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));

  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lmst = (gmst * 15 + lonDeg) * DEG;
  let hourAngle = lmst - rightAscension;
  while (hourAngle > Math.PI) hourAngle -= 2 * Math.PI;
  while (hourAngle < -Math.PI) hourAngle += 2 * Math.PI;

  const lat = latDeg * DEG;
  const altitude = Math.asin(
    Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(declination) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle),
  );
  return { altitude, azimuth, declination, hourAngle };
}

/**
 * Direction the sunlight travels, in world space. Our world has x east, y up
 * and z south, so an azimuth measured clockwise from north maps to
 * (sin az) east and (-cos az) north, and north is -z.
 */
export function sunDirection(date, lat, lon, out) {
  const { altitude, azimuth } = solarPosition(date, lat, lon);
  const cosAlt = Math.cos(altitude);
  out[0] = Math.sin(azimuth) * cosAlt;      // east
  out[1] = Math.sin(altitude);              // up
  out[2] = -Math.cos(azimuth) * cosAlt;     // north is -z, so this is +z for south
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l;
  return { altitude, azimuth };
}

/** Build a Date for a given day of year and hour, in Berlin local time. */
export function berlinDate(dayOfYear, hours) {
  const year = 2026;
  const d = new Date(Date.UTC(year, 0, 1));
  d.setUTCDate(d.getUTCDate() + Math.floor(dayOfYear) - 1);
  // Central European Summer Time between the last Sundays of March and October.
  const month = d.getUTCMonth();
  const summer = month > 2 && month < 9;
  const offset = summer ? 2 : 1;
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMinutes(Math.round((hours - offset) * 60));
  return d;
}

/** A warm to cool light colour that tracks the sun altitude. */
export function sunColour(altitude, out) {
  const a = Math.max(-0.14, altitude);
  const t = Math.min(1, Math.max(0, (a + 0.06) / 0.55));
  // Deep orange at the horizon through to a neutral white high up.
  const r = 1.0;
  const g = 0.42 + 0.52 * t;
  const b = 0.16 + 0.78 * t * t;
  const strength = Math.max(0, Math.min(1.25, Math.sin(Math.max(0, a) + 0.04) * 1.5));
  out[0] = r * strength;
  out[1] = g * strength;
  out[2] = b * strength;
  return out;
}
