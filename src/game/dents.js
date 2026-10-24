// What a vehicle looks like after it has been shot at, run into and blown
// about: the damage model.
//
// The hull is the box the vehicle stands in, and a hit lands on one of its
// four sides: the nose, the tail, the left or the right. Each side keeps how
// far it is pushed in, nought to one, and the shader pushes the panels on
// that side in by it and scuffs them. Above the waistline a hit goes through
// the glass: the windscreen is laminated, two sheets on a plastic film, and
// crazes white where it is hit but stays in its frame; the side and rear
// windows are toughened, and go all at once into small pieces and leave the
// frame empty. A nose pushed in far enough loses its headlights and then its
// bumper, and a tail its lights and its bumper, which fall off into the road.
// As the hull runs down the engine smokes, grey and then black, and then it
// burns, and at nothing it goes up the way it always has.
//
// Everything here is arithmetic on a vehicle's own numbers, so the checks can
// run it without a browser; vehicles.js calls it and main.js draws what it
// says happened.

export const DENTS = {
  // A side takes this much of the hull to be pushed in as far as it goes: a
  // car that has lost half of what it can take into its nose has no nose.
  perHull: 2.2,
  // A round makes a hole rather than a dent: it pushes in only this share of
  // what a blow of the same harm would, and leaves a hole, up to fifteen a
  // side that show.
  bulletDent: 0.25,
  holes: 15,
  // A blast pushes in the side facing it by its share, the sides next to it
  // by less, and the far side by nothing.
  blastSide: 0.45,
  // The nose loses its lights past this, and its bumper past the next.
  lights: 0.3,
  bumper: 0.6,
  // Running into something: how far a nose goes in for each metre a second,
  // and how fast the windscreen has to be going to crack on it.
  crashPerSpeed: 0.045,
  crashGlass: 8,
  // How far each side can go in, as a share of the hull's half length and
  // half width.
  depth: { along: 0.2, across: 0.32 },
  // The engine smokes below this share of the hull, black below the next,
  // and burns below the last.
  smoke: 0.55,
  black: 0.3,
  flames: 0.15,
  // Once it burns it loses this share of its hull a second, so it goes up
  // about seven seconds later whatever else happens.
  burn: 0.02,
};

// The bits a vehicle carries for what has broken.
export const BROKE = {
  screen: 1, rearScreen: 2, left: 4, right: 8,
  headlights: 16, taillights: 32, frontBumper: 64, rearBumper: 128,
};

// The box each kind stands in, in its own metres: length, width, height,
// where the glass starts, where its engine is (x, y, z with the nose along
// minus z), and how much of a bullet's harm gets through its skin. A round
// goes through a door and out of the other side without stopping much: it
// takes most of a magazine to set a car alight, about the same for a jeep,
// three for a bus, and a tank's armour is the point of a tank.
export const HULLS = {
  car: { L: 4.5, W: 1.8, H: 1.42, glass: 0.88, engine: [0, 0.8, -1.6], bullets: 0.3 },
  bus: { L: 11.7, W: 2.5, H: 4.3, glass: 1.1, engine: [0, 1.0, 5.2], bullets: 0.2 },
  jeep: { L: 4.5, W: 2.0, H: 2.0, glass: 1.4, engine: [0, 1.2, -1.5], bullets: 0.3 },
  tank: { L: 6.7, W: 3.7, H: 2.6, glass: 99, engine: [0, 1.6, 2.8], bullets: 0.03 },
};

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

/** The zones, in the order the dent array keeps them. */
export const ZONE = { front: 0, rear: 1, left: 2, right: 3 };

/** A fresh vehicle's damage: nothing pushed in and nothing broken. */
export function freshDamage(v) {
  v.dent = [0, 0, 0, 0];
  v.holes = [0, 0, 0, 0];
  v.broke = 0;
  return v;
}

/** The rounds in each side, four bits a side, in one number for the shader. */
export function packHoles(v) {
  const h = v.holes || [0, 0, 0, 0];
  const c = (n) => Math.min(DENTS.holes, n | 0);
  return c(h[0]) + c(h[1]) * 16 + c(h[2]) * 256 + c(h[3]) * 4096;
}

/**
 * A point in the world in the vehicle's own frame: x to its right, y up from
 * where it stands, z back from its middle, so the nose is at minus half its
 * length. A vehicle goes along (-sin yaw, -cos yaw).
 */
export function toLocal(v, x, y, z) {
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  const dx = x - v.x, dz = z - v.z;
  return { x: c * dx - s * dz, y: y - v.y, z: s * dx + c * dz };
}

/** And a direction, the same way, without the move. */
export function dirToLocal(v, dx, dz) {
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

/** Which side of its box a point in its own frame is on. */
export function zoneOf(hull, lx, lz) {
  const ax = Math.abs(lx) / (hull.W / 2), az = Math.abs(lz) / (hull.L / 2);
  if (az >= ax) return lz < 0 ? ZONE.front : ZONE.rear;
  return lx < 0 ? ZONE.left : ZONE.right;
}

/**
 * A ray against the box a vehicle stands in, turned with it. The ray in the
 * world, its length, and back the distance along it, where it went in in the
 * vehicle's own frame, or null.
 */
export function boxHit(v, hull, ox, oy, oz, dx, dy, dz, maxT) {
  const o = toLocal(v, ox, oy, oz);
  const d = dirToLocal(v, dx, dz);
  const lo = [-hull.W / 2, 0, -hull.L / 2], hi = [hull.W / 2, hull.H, hull.L / 2];
  const O = [o.x, o.y, o.z], D = [d.x, dy, d.z];
  let t0 = 0, t1 = maxT;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(D[k]) < 1e-9) {
      if (O[k] < lo[k] || O[k] > hi[k]) return null;
      continue;
    }
    let a = (lo[k] - O[k]) / D[k], b = (hi[k] - O[k]) / D[k];
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  return { t: t0, lx: O[0] + D[0] * t0, ly: O[1] + D[1] * t0, lz: O[2] + D[2] * t0 };
}

/**
 * Which glass a point in the vehicle's own frame would go through, as a bit,
 * or nought below the waistline.
 */
export function glassAt(hull, ly, zone) {
  if (ly < hull.glass) return 0;
  return [BROKE.screen, BROKE.rearScreen, BROKE.left, BROKE.right][zone];
}

/**
 * A side pushed in by a share of the hull, and whatever that breaks off it.
 * Returns the bits that broke this time.
 */
export function pushIn(v, zone, share) {
  if (!v.dent) freshDamage(v);
  v.dent[zone] = clamp(v.dent[zone] + share, 0, 1);
  let now = 0;
  const d = v.dent[zone];
  if (zone === ZONE.front) {
    if (d >= DENTS.lights) now |= BROKE.headlights;
    if (d >= DENTS.bumper) now |= BROKE.frontBumper;
  } else if (zone === ZONE.rear) {
    if (d >= DENTS.lights) now |= BROKE.taillights;
    if (d >= DENTS.bumper) now |= BROKE.rearBumper;
  }
  return breakBits(v, now);
}

/** Sets bits, and says which of them were not set before. */
export function breakBits(v, bits) {
  const fresh = bits & ~v.broke;
  v.broke |= bits;
  return fresh;
}

/**
 * A shot, a blow or a bullet landing at a point in the vehicle's own frame,
 * for this much of its hull. Returns the zone and what broke.
 */
export function hitAt(v, hull, lx, ly, lz, amount, bullet = false) {
  const zone = zoneOf(hull, lx, lz);
  const share = amount / (v.maxHealth || 1) * DENTS.perHull * (bullet ? DENTS.bulletDent : 1);
  if (bullet) {
    if (!v.holes) v.holes = [0, 0, 0, 0];
    v.holes[zone] = Math.min(DENTS.holes, v.holes[zone] + 1);
  }
  let broke = pushIn(v, zone, share);
  const glass = glassAt(hull, ly, zone);
  if (glass) broke |= breakBits(v, glass);
  return { zone, broke };
}

/**
 * A blast from a point in the world: each side pushed in by how squarely it
 * faces it, and the glass on the sides facing it gone if it was enough to
 * matter.
 */
export function blastFrom(v, hull, bx, bz, amount) {
  const l = toLocal(v, bx, v.y, bz);
  const len = Math.hypot(l.x, l.z) || 1;
  const nx = l.x / len, nz = l.z / len;
  const facing = [Math.max(0, -nz), Math.max(0, nz), Math.max(0, -nx), Math.max(0, nx)];
  const share = amount / (v.maxHealth || 1) * DENTS.perHull * DENTS.blastSide;
  let broke = 0;
  for (let z = 0; z < 4; z++) {
    if (facing[z] < 0.05) continue;
    broke |= pushIn(v, z, share * facing[z]);
    if (amount > (v.maxHealth || 1) * 0.08 && facing[z] > 0.3) {
      broke |= breakBits(v, [BROKE.screen, BROKE.rearScreen, BROKE.left, BROKE.right][z]);
    }
  }
  return broke;
}

/**
 * Driven into something at so many metres a second, nose first or tail
 * first: the end that hit goes in, and the windscreen cracks on a hard one.
 */
export function crash(v, speed, nose = true) {
  const zone = nose ? ZONE.front : ZONE.rear;
  let broke = pushIn(v, zone, Math.abs(speed) * DENTS.crashPerSpeed);
  if (Math.abs(speed) >= DENTS.crashGlass) broke |= breakBits(v, nose ? BROKE.screen : BROKE.rearScreen);
  return broke;
}

/** What the engine is doing: nothing, 'smoke', 'black' or 'fire'. */
export function engineState(v) {
  if (!(v.health > 0)) return null;
  const share = v.health / (v.maxHealth || 1);
  if (share < DENTS.flames) return 'fire';
  if (share < DENTS.black) return 'black';
  if (share < DENTS.smoke) return 'smoke';
  return null;
}
