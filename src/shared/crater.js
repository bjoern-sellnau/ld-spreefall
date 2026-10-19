// The shape of a crater, in one place.
//
// A bowl that is deepest in the middle and flat at its radius, and a lip of
// thrown up ground round it out to 1.75 radii. The world shader and the bake
// in src/game/bake.js carry their own copies of the same arithmetic, because
// one is GLSL and the other has to match it number for number; this is the
// copy the collision uses.

export const CRATER_RIM = 0.18;
export const CRATER_RIM_OUT = 1.75;

/**
 * What a crater does to the ground at a point.
 *
 * @param {number} x @param {number} z the point, world metres
 * @param {{x:number,z:number,craterRadius:number,depth:number}} c the crater
 * @param {number} level 0 to 1, how much of it has been dug
 * @returns {number} metres to add to the ground: negative in the bowl,
 *   positive on the lip, nought outside
 */
export function craterProfile(x, z, c, level = 1) {
  if (!(c.craterRadius > 0) || !(c.depth > 0) || !(level > 0)) return 0;
  const r = Math.hypot(x - c.x, z - c.z);
  const outer = c.craterRadius * CRATER_RIM_OUT;
  if (r >= outer) return 0;
  if (r < c.craterRadius) {
    const t = r / c.craterRadius;
    const k = 1 - t * t * (3 - 2 * t);
    return -c.depth * k * k * level;
  }
  const t = (r - c.craterRadius) / (outer - c.craterRadius);
  return c.depth * CRATER_RIM * Math.sin(Math.PI * t) * level;
}
