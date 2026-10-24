// Hands, feet, blades and the butt of a rifle: the arithmetic of a blow,
// apart from the game so it can be checked on its own. The game finds who was
// in reach and does the harm; this says whether you were behind him, which
// punch of a run this one is, and how many times the baton has had him.

/**
 * Whether you are behind him: he faces away from where you stand, more or
 * less. A soldier faces -sin(yaw), -cos(yaw), the way the camera does.
 */
export function fromBehind(px, pz, s, cone = 0.35) {
  const dx = s.x - px, dz = s.z - pz;
  const d = Math.hypot(dx, dz) || 1;
  const fx = -Math.sin(s.yaw || 0), fz = -Math.cos(s.yaw || 0);
  return (fx * dx + fz * dz) / d > cone;
}

/**
 * A run of punches: how many in a row, and whether this one is the hook.
 * A pause longer than gap starts the count again.
 * @param {{n?:number, last?:number}} run kept between punches
 */
export function punchCombo(run, now, swing) {
  if (!(now - (run.last ?? -Infinity) <= swing.gap)) run.n = 0;
  run.last = now;
  run.n = (run.n || 0) + 1;
  return { n: run.n, hook: run.n % swing.combo === 0 };
}

/** The baton's count on one man: blows no more than gap apart. */
export function batonCount(s, now, swing) {
  if (!(now - (s.batonLast ?? -Infinity) <= swing.gap)) s.batonN = 0;
  s.batonLast = now;
  s.batonN = (s.batonN || 0) + 1;
  return s.batonN;
}

/** How far through a move is on the screen: out and back, 0 to 1 to 0. */
export function moveCurve(left, seconds) {
  if (!(left > 0) || !(seconds > 0)) return 0;
  return Math.sin(Math.PI * Math.min(1, Math.max(0, 1 - left / seconds)));
}
