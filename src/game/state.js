// Position, heading and time of day encoded in the URL hash, so a link opens on
// exactly the same view. Format: #x,z,yaw,pitch,tod,doy with x and z in metres
// to one decimal and the angles in degrees.

export function encodeState(s) {
  const f = (v, d = 1) => Number(v.toFixed(d));
  return `#${f(s.x)},${f(s.z)},${f(s.yaw * 180 / Math.PI)},${f(s.pitch * 180 / Math.PI)},${f(s.tod, 2)},${Math.round(s.doy)}`;
}

export function decodeState(hash) {
  if (!hash || hash.length < 2) return null;
  const parts = hash.slice(1).split(',').map(Number);
  if (parts.length < 5 || parts.some((v) => !Number.isFinite(v))) return null;
  return {
    x: parts[0],
    z: parts[1],
    yaw: parts[2] * Math.PI / 180,
    pitch: parts[3] * Math.PI / 180,
    tod: Math.min(24, Math.max(0, parts[4])),
    doy: parts.length > 5 ? Math.min(365, Math.max(1, parts[5])) : 166,
  };
}

export function writeState(s) {
  const h = encodeState(s);
  if (location.hash !== h) history.replaceState(null, '', h);
  return location.origin + location.pathname + h;
}
