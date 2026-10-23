// Where a grenade will go: the arc it flies and the spot it first comes down,
// worked out with the same gravity, drag and world the thrown one will meet,
// so the line on the screen is the throw and not a guess at it.
//
// Held on the right mouse button a throw goes harder: farther, and flatter at
// the start. Counter-Strike has the long throw on the left button and a lob
// on the right; here the left is the plain throw and the right is the one you
// line up, because aiming is what the right button is for everywhere else.

export const THROW = {
  far: 1.6,           // how much harder a throw on the right button goes
  lift: 3.4,          // the same lift a throw gets in the weapon
  dt: 1 / 40,         // the step of the arc
  maxTime: 5,         // how far ahead it is worked out, in seconds
};

/**
 * @param {object} world raycast(x, y, z, dx, dy, dz, max) -> {t, x, y, z}|null
 * @param {{x,y,z}} from where it leaves the hand
 * @param {{x,y,z}} dir unit vector, where you are looking
 * @param {number} speed how hard
 * @param {{gravity:number, drag:number, radius:number}} spec the projectile's
 * @returns {{points:number[][], hit:{x,y,z,t:number}|null}}
 */
export function throwArc(world, from, dir, speed, spec) {
  let x = from.x, y = from.y, z = from.z;
  let vx = dir.x * speed, vy = dir.y * speed + THROW.lift, vz = dir.z * speed;
  const points = [[x, y, z]];
  const g = spec.gravity || 0, drag = spec.drag || 0, r = spec.radius || 0.1;
  for (let t = 0; t < THROW.maxTime; t += THROW.dt) {
    vy -= g * THROW.dt;
    if (drag) {
      const k = Math.max(0, 1 - drag * THROW.dt);
      vx *= k; vy *= k; vz *= k;
    }
    const v = Math.hypot(vx, vy, vz);
    if (v < 1e-6) break;
    const step = v * THROW.dt;
    const hit = world.raycast(x, y, z, vx / v, vy / v, vz / v, step + r);
    if (hit) {
      const d = Math.max(0, hit.t - r);
      x += (vx / v) * d; y += (vy / v) * d; z += (vz / v) * d;
      points.push([x, y, z]);
      return { points, hit: { x, y, z, t: t + d / v } };
    }
    x += vx * THROW.dt; y += vy * THROW.dt; z += vz * THROW.dt;
    points.push([x, y, z]);
  }
  return { points, hit: null };
}
