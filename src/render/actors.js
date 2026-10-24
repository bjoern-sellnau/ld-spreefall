// Everything that moves: the drones, the tracers and sparks, and the weapon in
// your hands. All of the geometry is generated here in JavaScript, because the
// project ships no models.

import { createProgram } from '../engine/gl.js';
import { CHASSIS, WARLORD } from '../game/chassis.js';
import { MECH_BUILDERS } from './mechmeshes.js';
import { mat4 } from '../engine/math.js';
import {
  DRONE_VS, DRONE_FS, DRONE_SHADOW_VS, DRONE_SHADOW_FS,
  SPARK_VS, SPARK_FS, VIEWMODEL_VS, VIEWMODEL_FS, SOLDIER_VS, SOLDIER_FS, SOLDIER_SHADOW_VS,
  PICKUP_VS, GIB_VS, MECH_VS,
} from '../shaders/actors.js';

const MAX_DRONES = 48;
const MAX_SPARKS = 3072;
const MAX_PROPS = 32;
const MAX_SOLDIERS = 24;
const MAX_JETS = 6;
const MAX_VEHICLES = 8;
// Camps near enough to draw at once.
const MAX_CAMPS = 12;
const MAX_SIGNALS = 96;
const MAX_COVERS = 64;
const MAX_BOXES = 48;
const MAX_ATMS = 24;
const MAX_POSTS = 160;
const MAX_MECHS = 8;
const MAX_PICKUPS = 16;
const MAX_GIBS = 1536;
// Ultra plasma's balls in the air at once, which is its own ceiling.
const MAX_ULTRA = 480;
// And the void storm's balls, which VOID_STORM.maxLive holds to 48.
const MAX_STORM = 64;
// Past this there is no point drawing a pad: the fog has it anyway.
const PICKUP_RANGE = 260;

// --- mesh building ---------------------------------------------------------

/** True when the triangle's own normal agrees with the one it declares. */
function facesForward(a, b, c, n) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
  return gx * n[0] + gy * n[1] + gz * n[2] >= 0;
}

export class MeshBuild {
  // flag rides along in the second info component. Everything ignores it
  // except the pickups, where it says which parts of the mesh float.
  constructor() { this.v = []; this.i = []; this.n = 0; this.flag = 0; }

  /** A box from its centre, with a part id carried through to the shader. */
  box(cx, cy, cz, w, h, d, part, rotY = 0) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const P = (x, y, z) => [cx + x * c - z * s, cy + y, cz + x * s + z * c];
    const N = (x, y, z) => [x * c - z * s, y, x * s + z * c];
    const faces = [
      { n: N(1, 0, 0), p: [P(hw, -hh, -hd), P(hw, -hh, hd), P(hw, hh, hd), P(hw, hh, -hd)] },
      { n: N(-1, 0, 0), p: [P(-hw, -hh, hd), P(-hw, -hh, -hd), P(-hw, hh, -hd), P(-hw, hh, hd)] },
      { n: N(0, 0, 1), p: [P(hw, -hh, hd), P(-hw, -hh, hd), P(-hw, hh, hd), P(hw, hh, hd)] },
      { n: N(0, 0, -1), p: [P(-hw, -hh, -hd), P(hw, -hh, -hd), P(hw, hh, -hd), P(-hw, hh, -hd)] },
      { n: [0, 1, 0], p: [P(-hw, hh, -hd), P(hw, hh, -hd), P(hw, hh, hd), P(-hw, hh, hd)] },
      { n: [0, -1, 0], p: [P(-hw, -hh, hd), P(hw, -hh, hd), P(hw, -hh, -hd), P(-hw, -hh, -hd)] },
    ];
    for (const f of faces) this.quad(f.p, f.n, part);
  }

  // Faces are wound to agree with the normal they declare rather than trusting
  // the order they were written in. Getting this wrong means back face culling
  // eats the whole model, which is a silent and very confusing failure.
  quad(p, n, part) {
    const base = this.n;
    for (const q of p) this.vertex(q, n, part);
    if (facesForward(p[0], p[1], p[2], n)) {
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.i.push(base + 2, base + 1, base, base + 3, base + 2, base);
    }
  }

  tri(p, n, part) {
    const base = this.n;
    for (const q of p) this.vertex(q, n, part);
    if (facesForward(p[0], p[1], p[2], n)) this.i.push(base, base + 1, base + 2);
    else this.i.push(base + 2, base + 1, base);
  }

  vertex(p, n, part) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], part, this.flag);
    this.n++;
  }

  cylinder(cx, cy, cz, rBottom, rTop, h, seg, part, axis = 'y') {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const at = (c, s, r, t) => (axis === 'y'
        ? [cx + c * r, cy + t, cz + s * r]
        : axis === 'x' ? [cx + t, cy + s * r, cz + c * r]
          : [cx + c * r, cy + s * r, cz + t]);
      const nAt = (c, s) => (axis === 'y' ? [c, 0, s] : axis === 'x' ? [0, s, c] : [c, s, 0]);
      this.quad(
        [at(c0, s0, rBottom, 0), at(c1, s1, rBottom, 0), at(c1, s1, rTop, h), at(c0, s0, rTop, h)],
        nAt((c0 + c1) / 2, (s0 + s1) / 2), part,
      );
    }
    // Caps.
    // An x axis is what a wheel needs: the first wheels here were y
    // cylinders, which is a wheel lying flat on the road like a coin.
    const capN = axis === 'y' ? [0, 1, 0] : axis === 'x' ? [1, 0, 0] : [0, 0, 1];
    for (const [r, t, sign] of [[rTop, h, 1], [rBottom, 0, -1]]) {
      if (r < 0.001) continue;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const at = (a, rr) => (axis === 'y'
          ? [cx + Math.cos(a) * rr, cy + t, cz + Math.sin(a) * rr]
          : axis === 'x' ? [cx + t, cy + Math.sin(a) * rr, cz + Math.cos(a) * rr]
            : [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, cz + t]);
        const centre = axis === 'y' ? [cx, cy + t, cz] : axis === 'x' ? [cx + t, cy, cz] : [cx, cy, cz + t];
        const n = capN.map((c) => c * sign);
        const p = sign > 0 ? [centre, at(a0, r), at(a1, r)] : [centre, at(a1, r), at(a0, r)];
        this.tri(p, n, part);
      }
    }
  }

  icosphere(cx, cy, cz, r, seg, rings, part) {
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const at = (ii, jj) => {
          const phi = (jj / rings) * Math.PI - Math.PI / 2;
          const th = (ii / seg) * Math.PI * 2;
          return [
            cx + Math.cos(phi) * Math.cos(th) * r,
            cy + Math.sin(phi) * r,
            cz + Math.cos(phi) * Math.sin(th) * r,
          ];
        };
        const p = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        const n = p.map((q) => [(q[0] - cx) / r, (q[1] - cy) / r, (q[2] - cz) / r]);
        const base = this.n;
        for (let k = 0; k < 4; k++) this.vertex(p[k], n[k], part);
        if (facesForward(p[0], p[1], p[2], n[0])) {
          this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
        } else {
          this.i.push(base + 2, base + 1, base, base + 3, base + 2, base);
        }
      }
    }
  }

  /**
   * A flat four cornered panel with a thickness: a wing, a fin, a sloped
   * armour plate. The corners go round the outline in order, the panel is
   * pushed half its thickness either way along its own normal, and the four
   * edges are closed.
   */
  plate(pts, thick, part) {
    const [a, b, c] = pts;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((k) => k / l);
    const h = thick / 2;
    const top = pts.map((q) => [q[0] + n[0] * h, q[1] + n[1] * h, q[2] + n[2] * h]);
    const bot = pts.map((q) => [q[0] - n[0] * h, q[1] - n[1] * h, q[2] - n[2] * h]);
    this.quad(top, n, part);
    this.quad([bot[3], bot[2], bot[1], bot[0]], n.map((k) => -k), part);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const e = [pts[j][0] - pts[i][0], pts[j][1] - pts[i][1], pts[j][2] - pts[i][2]];
      let o = [e[1] * n[2] - e[2] * n[1], e[2] * n[0] - e[0] * n[2], e[0] * n[1] - e[1] * n[0]];
      const ol = Math.hypot(o[0], o[1], o[2]) || 1;
      o = o.map((k) => k / ol);
      // Which way is out: away from the middle of the panel.
      const mid = [0, 1, 2].map((k) => (pts[0][k] + pts[1][k] + pts[2][k] + pts[3][k]) / 4);
      const em = [0, 1, 2].map((k) => (pts[i][k] + pts[j][k]) / 2 - mid[k]);
      if (o[0] * em[0] + o[1] * em[1] + o[2] * em[2] < 0) o = o.map((k) => -k);
      this.quad([bot[i], bot[j], top[j], top[i]], o, part);
    }
  }

  /** A flat ring, used for the blurred rotor discs. */
  ring(cx, cy, cz, rInner, rOuter, seg, part) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const at = (a, r) => [cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r];
      this.quad([at(a0, rInner), at(a1, rInner), at(a1, rOuter), at(a0, rOuter)], [0, 1, 0], part);
      this.quad([at(a0, rOuter), at(a1, rOuter), at(a1, rInner), at(a0, rInner)], [0, -1, 0], part);
    }
  }
}

/**
 * A quadrotor about 1.6 m across: a flat hull, a glowing core, four arms and
 * four rotor discs. Part ids: 0 hull, 1 core, 2 arm, 3 rotor.
 */
export function buildDroneMesh() {
  const m = new MeshBuild();
  m.box(0, 0, 0, 0.78, 0.26, 0.78, 0);
  m.box(0, 0.16, 0, 0.5, 0.2, 0.5, 0);
  m.box(0, -0.13, 0.30, 0.34, 0.16, 0.22, 0);        // sensor pod at the front
  m.icosphere(0, -0.02, 0.0, 0.2, 10, 6, 1);          // the core
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    m.box(sx * 0.34, 0.0, sz * 0.34, 0.62, 0.09, 0.14, 2, Math.atan2(sz, sx));
    m.cylinder(sx * 0.62, -0.06, sz * 0.62, 0.075, 0.065, 0.16, 8, 2);
    m.ring(sx * 0.62, 0.11, sz * 0.62, 0.10, 0.44, 14, 3);
  }
  return m;
}

/**
 * The flash at a muzzle, as two planes crossed along the barrel (part 7) and a
 * disc across the end of it (part 8), both drawn from either side. Neither
 * needs a normal, so the normal slot carries where on the flash a vertex is:
 * across the plume and along it for the planes, a position on the disc for the
 * disc. The shader cuts the shapes out of that, a different star each shot.
 */
function muzzleFlash(m, cx, cy, z0, len, r) {
  const both = (base) => m.i.push(base, base + 1, base + 2, base, base + 2, base + 3,
    base + 2, base + 1, base, base + 3, base + 2, base);
  for (const [ax, ay] of [[1, 0], [0, 1]]) {
    const base = m.n;
    for (const [v, u] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
      m.vertex([cx + ax * v * r * 1.3, cy + ay * v * r * 1.3, z0 - u * len], [v, 0, u], 7);
    }
    both(base);
  }
  const base = m.n;
  const d = r * 1.7;
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    m.vertex([cx + x * d, cy + y * d, z0 - 0.006], [x, y, 0], 8);
  }
  both(base);
}

/**
 * The weapon, in view space: the eye is at the origin and the muzzle points
 * down -z. Laid out so the butt of the stock sits about ten centimetres in
 * front of the eye and the muzzle about ninety, which is what puts a rifle in
 * the lower right of the frame rather than across all of it.
 * Part ids: 0 receiver, 1 barrel, 2 polymer, 3 sight, 7 and 8 the muzzle flash.
 */
export function buildWeaponMesh() {
  const m = new MeshBuild();
  //        cx    cy      cz     w      h      d     part
  m.box(0, 0.000, -0.150, 0.052, 0.072, 0.115, 2);      // stock comb
  m.box(0, -0.022, -0.225, 0.050, 0.086, 0.075, 2);     // stock wrist
  m.box(0, 0.006, -0.360, 0.056, 0.092, 0.215, 0);      // receiver
  m.box(0, 0.052, -0.375, 0.040, 0.016, 0.230, 0);      // top rail
  m.box(0, 0.010, -0.560, 0.040, 0.050, 0.185, 1);      // handguard
  m.cylinder(0, 0.012, -0.640, 0.013, 0.013, -0.220, 10, 1, 'z');   // barrel
  m.box(0, 0.012, -0.868, 0.026, 0.026, 0.052, 1);      // muzzle device
  m.box(0, -0.098, -0.300, 0.042, 0.115, 0.062, 2);     // pistol grip
  m.box(0, -0.070, -0.395, 0.038, 0.105, 0.085, 2);     // magazine
  m.box(0, 0.082, -0.400, 0.030, 0.038, 0.060, 3);      // sight body
  m.box(0, 0.104, -0.400, 0.036, 0.006, 0.066, 3);      // sight hood
  m.box(0, 0.088, -0.400, 0.006, 0.014, 0.004, 3);      // the post you aim with
  // The flash at the muzzle. Invisible unless the shader is told otherwise.
  muzzleFlash(m, 0, 0.012, -0.894, 0.170, 0.070);
  return m;
}

/**
 * The rest of what you can carry. Same parts palette as the rifle: 0 receiver,
 * 1 barrel steel, 2 polymer, 3 sight, 7 and 8 the flash the shader hides
 * between shots. Everything is measured in metres from the eye, muzzle towards -z.
 */
export function buildShotgunMesh() {
  const m = new MeshBuild();
  m.box(0, -0.010, -0.170, 0.056, 0.080, 0.150, 2);      // stock
  m.box(0, -0.028, -0.250, 0.050, 0.092, 0.075, 2);      // wrist
  m.box(0, 0.004, -0.360, 0.062, 0.086, 0.200, 0);       // receiver
  m.cylinder(0, 0.020, -0.470, 0.019, 0.019, -0.330, 10, 1, 'z');   // barrel
  m.cylinder(0, -0.014, -0.470, 0.016, 0.016, -0.300, 10, 1, 'z');  // tube magazine
  m.box(0, -0.008, -0.560, 0.046, 0.044, 0.130, 2);      // pump
  m.box(0, -0.092, -0.300, 0.044, 0.110, 0.060, 2);      // grip
  m.box(0, 0.040, -0.372, 0.010, 0.014, 0.010, 3);       // bead
  muzzleFlash(m, 0, 0.020, -0.802, 0.200, 0.090);
  return m;
}

export function buildRpgMesh() {
  const m = new MeshBuild();
  m.cylinder(0, 0.000, -0.520, 0.048, 0.048, -0.760, 14, 0, 'z');   // tube
  m.cylinder(0, 0.000, -0.180, 0.060, 0.060, -0.110, 14, 0, 'z');   // blast cone
  m.box(0, -0.080, -0.430, 0.040, 0.110, 0.062, 2);      // grip
  m.box(0, -0.052, -0.620, 0.036, 0.070, 0.055, 2);      // forward grip
  m.box(0, 0.062, -0.520, 0.028, 0.034, 0.240, 3);       // sight rail
  // The warhead, sticking out of the front where you can see it.
  m.cylinder(0, 0.000, -0.900, 0.052, 0.052, -0.120, 12, 1, 'z');
  m.cylinder(0, 0.000, -1.020, 0.052, 0.006, -0.130, 12, 1, 'z');   // the nose
  muzzleFlash(m, 0, 0.000, -0.902, 0.260, 0.130);
  return m;
}

export function buildGrenadeMesh() {
  const m = new MeshBuild();
  // A fist, near enough: the body in your hand with the lever along it.
  m.cylinder(0, -0.010, -0.300, 0.048, 0.048, -0.110, 12, 2, 'z');
  m.cylinder(0, -0.010, -0.410, 0.030, 0.030, -0.030, 10, 0, 'z');
  m.box(0.040, -0.010, -0.345, 0.014, 0.070, 0.090, 0);
  m.box(0.052, 0.020, -0.410, 0.030, 0.006, 0.030, 3);   // the ring
  return m;
}

export function buildC4Mesh() {
  const m = new MeshBuild();
  m.box(0, -0.020, -0.330, 0.150, 0.075, 0.110, 5);      // the brick
  m.box(0, 0.024, -0.330, 0.090, 0.014, 0.060, 0);       // the taped detonator
  m.box(0.030, 0.034, -0.330, 0.012, 0.010, 0.012, 3);   // the light
  m.box(-0.086, -0.020, -0.300, 0.026, 0.060, 0.050, 0); // the trigger in your hand
  return m;
}

export function buildBananaMesh() {
  const m = new MeshBuild();
  // Eight segments swept along an arc, which is all a banana is.
  const R = 0.135;
  for (let i = 0; i < 8; i++) {
    const t = (i / 7) - 0.5;
    const a = t * 1.5;
    const x = Math.sin(a) * R * 0.5;
    const z = -0.330 - Math.cos(a) * R * 0.45;
    const y = -0.020 + Math.cos(a * 1.6) * 0.020 - 0.02;
    const r = 0.030 * (1 - Math.abs(t) * 1.3);
    if (r > 0.004) m.box(x, y, z, r * 2, r * 2, 0.040, 6);
  }
  m.box(Math.sin(-0.75) * R * 0.5, -0.048, -0.330 - Math.cos(-0.75) * R * 0.45, 0.014, 0.014, 0.030, 2);
  return m;
}

/**
 * The things you throw, as they look in the world rather than in your hands.
 * All four share one mesh so they can be drawn in a single instanced call; the
 * shader picks which part of it to show by the part ids, and each projectile
 * carries a kind that scales the others to nothing.
 */
export function buildProjectileMesh(kind) {
  const m = new MeshBuild();
  if (kind === 'rocket') {
    m.cylinder(0, 0, 0, 0.09, 0.09, 0.46, 10, 8, 'z');
    m.cylinder(0, 0, 0.23, 0.09, 0.02, 0.16, 10, 8, 'z');
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      m.box(Math.cos(a) * 0.12, Math.sin(a) * 0.12, -0.20, 0.10, 0.02, 0.12, 8, a);
    }
  } else if (kind === 'grenade') {
    m.icosphere(0, 0, 0, 0.085, 10, 6, 8);
    m.cylinder(0, 0.085, 0, 0.032, 0.032, 0.05, 8, 7, 'y');
  } else if (kind === 'c4') {
    m.box(0, 0, 0, 0.22, 0.09, 0.15, 9);
    m.box(0, 0.052, 0, 0.10, 0.02, 0.07, 7);
  } else if (kind === 'plasma') {
    m.icosphere(0, 0, 0, 0.16, 10, 6, 11);
  } else if (kind === 'blast') {
    // Blast plasma out of the rifle: a bigger, harder bolt in orange.
    m.icosphere(0, 0, 0, 0.24, 10, 6, 48);
    m.cylinder(0, 0, 0.12, 0.2, 0.02, 1.4, 8, 48, 'z');
  } else if (kind === 'flak') {
    m.box(0, 0, 0, 0.14, 0.10, 0.14, 8);
    m.box(0, 0, 0, 0.08, 0.18, 0.08, 8);
  } else if (kind === 'ultra') {
    // The rifle's bolt, three times across, with the streak it burns behind
    // it on the way down: from a street away a ball the size of a football
    // is a pixel, and a pixel falling reads as snow. Nose towards -z, so the
    // tail runs back along +z.
    m.icosphere(0, 0, 0, 0.5, 10, 6, 11);
    m.cylinder(0, 0, 0.25, 0.42, 0.03, 7, 8, 11, 'z');
  } else if (kind === 'ultraBlast') {
    // The same comet out of orbit, as blast plasma: orange, and a longer
    // streak, because it is not slowing down for anything.
    m.icosphere(0, 0, 0, 0.6, 10, 6, 48);
    m.cylinder(0, 0, 0.3, 0.5, 0.03, 10, 8, 48, 'z');
  } else if (kind === 'void') {
    // One green ball the size of a man's chest. The glow round it is sparks,
    // drawn by the game layer while it flies.
    m.icosphere(0, 0, 0, 0.7, 12, 6, 30);
  } else if (kind === 'voidMaw') {
    // The mech's: the same ball, nearly twice across, so it reads as the
    // bigger thing before it lands.
    m.icosphere(0, 0, 0, 1.3, 14, 7, 30);
  } else if (kind === 'shieldsaw') {
    m.cylinder(0, 0, 0, 0.30, 0.30, 0.05, 18, 2, 'y');
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      m.box(Math.cos(a) * 0.32, 0.025, Math.sin(a) * 0.32, 0.06, 0.04, 0.06, 44, a);
    }
  } else if (kind === 'bolt') {
    // Forty centimetres of steel with a glowing head at the front, -z.
    m.cylinder(0, 0, 0.20, 0.008, 0.008, -0.40, 6, 8, 'z');
    m.cylinder(0, 0, -0.20, 0.022, 0.0, -0.07, 8, 48, 'z');
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      m.box(Math.cos(a) * 0.016, Math.sin(a) * 0.016, 0.17, 0.004 + Math.abs(Math.cos(a)) * 0.026,
        0.004 + Math.abs(Math.sin(a)) * 0.026, 0.06, 44);
    }
  } else if (kind === 'cling') {
    // A ball of light the size of a fist, which is what you see stuck to him.
    m.icosphere(0, 0, 0, 0.09, 10, 6, 11);
  } else if (kind === 'disc') {
    m.cylinder(0, 0, 0, 0.18, 0.18, 0.02, 18, 44, 'y');
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      m.box(Math.cos(a) * 0.19, 0.01, Math.sin(a) * 0.19, 0.04, 0.02, 0.04, 44, a);
    }
  } else if (kind === 'flare') {
    m.icosphere(0, 0, 0, 0.06, 8, 5, 48);
    m.cylinder(0, 0, 0.05, 0.03, 0.01, 0.25, 6, 48, 'z');
  } else if (kind === 'fireball') {
    // A demon's fire: a ball of the blast orange.
    m.icosphere(0, 0, 0, 0.3, 10, 6, 48);
    m.cylinder(0, 0, 0.2, 0.22, 0.02, 0.6, 8, 48, 'z');
  } else if (kind === 'arrow') {
    // Seventy centimetres of shaft, a steel head at the front, which is -z
    // like everything else that flies here, and three vanes at the back.
    m.cylinder(0, 0, 0.36, 0.0045, 0.0045, -0.70, 6, 2, 'z');
    m.cylinder(0, 0, -0.34, 0.012, 0.0, -0.07, 6, 44, 'z');
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      m.box(Math.cos(a) * 0.014, Math.sin(a) * 0.014, 0.30, 0.002 + Math.abs(Math.cos(a)) * 0.022,
        0.002 + Math.abs(Math.sin(a)) * 0.022, 0.09, 12);
    }
  } else if (kind === 'splinter') {
    m.box(0, 0, 0.06, 0.030, 0.030, 0.22, 11);
    m.box(0, 0, -0.10, 0.012, 0.012, 0.10, 8);
  } else if (kind === 'nuke') {
    // A free fall bomb, about two and a half metres long: a fat body, a
    // rounded nose and four tail fins in a box. Nose towards -z like
    // everything else that flies here.
    m.cylinder(0, 0, 0.6, 0.34, 0.34, -1.5, 12, 8, 'z');
    m.cylinder(0, 0, -0.9, 0.34, 0.10, -0.45, 12, 8, 'z');
    m.cylinder(0, 0, 0.6, 0.34, 0.26, 0.30, 12, 8, 'z');
    // The band round the middle, in the warning colour.
    m.cylinder(0, 0, -0.25, 0.355, 0.355, -0.22, 12, 18, 'z');
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      m.box(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0.78, 0.44, 0.04, 0.54, 0, a);
    }
    // The box the fins sit in, which is the shape that makes it read as a bomb
    // rather than as a rocket.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      m.box(Math.cos(a) * 0.40, Math.sin(a) * 0.40, 0.90, 0.80, 0.03, 0.34, 0, a);
    }
  } else {
    // The banana, which is the same arc as the one in your hand, lying down.
    const R = 0.16;
    for (let i = 0; i < 7; i++) {
      const t = (i / 6) - 0.5;
      const a = t * 1.6;
      const x = Math.sin(a) * R * 0.6;
      const z = Math.cos(a) * R * 0.4;
      const r = 0.036 * (1 - Math.abs(t) * 1.25);
      if (r > 0.006) m.box(x, 0.02, z, r * 2, r * 2, 0.05, 10);
    }
  }
  return m;
}

/** The arena four, in the hand. Same parts palette as the other viewmodels. */
export function buildRailgunMesh() {
  const m = new MeshBuild();
  m.box(0, -0.008, -0.180, 0.050, 0.070, 0.170, 2);      // stock
  m.box(0, 0.004, -0.380, 0.058, 0.090, 0.260, 0);       // body
  m.box(0, 0.056, -0.400, 0.030, 0.026, 0.300, 3);       // scope
  m.cylinder(0, 0.056, -0.250, 0.024, 0.024, -0.060, 10, 3, 'z');
  // Twin rails with the gap between them, which is the whole look.
  m.box(-0.022, 0.014, -0.700, 0.014, 0.030, 0.420, 1);
  m.box(0.022, 0.014, -0.700, 0.014, 0.030, 0.420, 1);
  m.box(0, 0.014, -0.520, 0.070, 0.016, 0.060, 0);
  m.box(0, -0.094, -0.300, 0.042, 0.115, 0.060, 2);      // grip
  muzzleFlash(m, 0, 0.014, -0.912, 0.150, 0.060);
  return m;
}

export function buildPlasmaMesh() {
  const m = new MeshBuild();
  m.box(0, -0.006, -0.230, 0.062, 0.084, 0.230, 0);      // body
  m.box(0, 0.050, -0.300, 0.034, 0.030, 0.180, 3);       // sight block
  m.cylinder(0, 0.006, -0.520, 0.030, 0.030, -0.300, 12, 1, 'z');   // barrel
  m.icosphere(0, 0.006, -0.360, 0.052, 10, 6, 5);        // the cell, glowing
  m.box(0, -0.090, -0.250, 0.044, 0.110, 0.062, 2);      // grip
  m.box(0, -0.030, -0.430, 0.040, 0.050, 0.090, 2);      // fore grip
  muzzleFlash(m, 0, 0.006, -0.826, 0.170, 0.075);
  return m;
}

export function buildVoidMesh() {
  const m = new MeshBuild();
  m.box(0, -0.012, -0.240, 0.090, 0.100, 0.260, 0);      // the housing
  m.box(0, 0.060, -0.260, 0.040, 0.026, 0.180, 3);       // top rail
  m.cylinder(0, 0.000, -0.370, 0.058, 0.058, -0.340, 14, 1, 'z');   // the barrel
  // Three green rings down the barrel and the cell behind them, which is
  // what tells you at a glance that this is not the plasma rifle.
  for (const z of [-0.420, -0.520, -0.620]) {
    m.cylinder(0, 0.000, z, 0.068, 0.068, -0.030, 14, 30, 'z');
  }
  m.cylinder(0, 0.000, -0.710, 0.072, 0.050, -0.040, 14, 1, 'z');   // muzzle lip
  m.box(0, 0.000, -0.300, 0.096, 0.044, 0.070, 30);      // the cell window
  m.box(0, -0.100, -0.250, 0.044, 0.110, 0.062, 2);      // grip
  m.box(0, -0.056, -0.450, 0.050, 0.044, 0.110, 2);      // fore grip
  return m;
}

export function buildFlakMesh() {
  const m = new MeshBuild();
  m.box(0, -0.004, -0.250, 0.070, 0.096, 0.260, 0);      // receiver
  m.cylinder(0, 0.010, -0.560, 0.042, 0.052, -0.340, 12, 1, 'z');   // wide bore
  m.cylinder(0, 0.010, -0.880, 0.056, 0.062, -0.060, 12, 0, 'z');   // muzzle ring
  m.box(0, -0.092, -0.280, 0.046, 0.112, 0.064, 2);      // grip
  m.box(0, -0.048, -0.470, 0.044, 0.070, 0.100, 2);      // pump
  m.box(0, 0.058, -0.300, 0.026, 0.024, 0.090, 3);       // sight
  muzzleFlash(m, 0, 0.010, -0.902, 0.220, 0.110);
  return m;
}

/** A pistol with a suppressor on it: slide, frame, grip, the can, sights. */
export function buildPistolMesh() {
  const m = new MeshBuild();
  m.box(0, 0.020, -0.300, 0.030, 0.034, 0.190, 0);       // slide
  m.box(0, -0.008, -0.290, 0.028, 0.022, 0.170, 2);      // frame
  m.box(0, -0.070, -0.230, 0.030, 0.110, 0.052, 2, 0);   // grip
  m.box(0, -0.030, -0.250, 0.008, 0.026, 0.040, 0);      // trigger guard
  m.cylinder(0, 0.020, -0.395, 0.017, 0.017, -0.150, 12, 1, 'z');   // suppressor
  m.box(0, 0.042, -0.380, 0.004, 0.010, 0.006, 3);       // front sight
  m.box(0, 0.042, -0.220, 0.018, 0.010, 0.008, 3);       // rear sight
  muzzleFlash(m, 0, 0.020, -0.545, 0.05, 0.025);
  return m;
}

/**
 * A recurve bow held across the body: the riser in the hand, two limbs that
 * sweep back, the string, and an arrow on the rest pointing down range.
 */
export function buildBowMesh() {
  const m = new MeshBuild();
  m.box(0, 0.000, -0.400, 0.026, 0.150, 0.032, 0);       // riser
  m.box(0, -0.008, -0.396, 0.030, 0.060, 0.038, 2);      // the grip in it
  for (const sgn of [1, -1]) {
    // Each limb in three pieces, swept back towards you.
    m.box(0, sgn * 0.110, -0.394, 0.036, 0.080, 0.016, 2);
    m.box(0, sgn * 0.180, -0.378, 0.030, 0.070, 0.014, 2);
    m.box(0, sgn * 0.240, -0.356, 0.024, 0.060, 0.012, 2);
  }
  // The string, from tip to tip, pulled back a little to the nock.
  m.box(0, 0.135, -0.300, 0.0025, 0.230, 0.0025, 3);
  m.box(0, -0.135, -0.300, 0.0025, 0.230, 0.0025, 3);
  // The arrow on the rest, nocked on the string.
  m.cylinder(0.010, 0.008, -0.210, 0.0035, 0.0035, -0.560, 6, 1, 'z');
  m.cylinder(0.010, 0.008, -0.770, 0.009, 0.0, -0.050, 6, 3, 'z');
  m.box(0.010, 0.018, -0.240, 0.002, 0.018, 0.060, 2);
  return m;
}

/**
 * The tech bow, after the hunter's compound bow of the nanosuit games: a
 * riser in black carbon with its middle cut away, split limbs short and
 * steep, a cam at each tip with the cables running back between them, a
 * stabiliser forward and a strip of light down the riser that is brighter
 * the moment after a shot. Ours, drawn from the descriptions: a compound
 * bow, utilitarian, for a man who fires it from the cloak.
 */
export function buildTechBowMesh() {
  const m = new MeshBuild();
  // The riser: two rails with a gap between them, a grip and a shelf.
  m.box(0, 0.075, -0.402, 0.024, 0.090, 0.030, 31);
  m.box(0, -0.075, -0.402, 0.024, 0.090, 0.030, 31);
  m.box(0, 0.000, -0.418, 0.020, 0.070, 0.012, 31);      // the spine behind the cut out
  m.box(0, -0.010, -0.396, 0.030, 0.056, 0.040, 2);      // grip
  m.box(0.012, 0.016, -0.410, 0.020, 0.008, 0.036, 31);  // the shelf the arrow rests on
  // The light down the face of it.
  m.box(-0.0135, 0.075, -0.402, 0.003, 0.070, 0.006, 32);
  m.box(-0.0135, -0.075, -0.402, 0.003, 0.070, 0.006, 32);
  for (const sgn of [1, -1]) {
    // Split limbs: two thin blades side by side, steep and short.
    for (const off of [-0.009, 0.009]) {
      m.box(off, sgn * 0.150, -0.392, 0.008, 0.070, 0.014, 31);
      m.box(off, sgn * 0.205, -0.372, 0.008, 0.050, 0.012, 31);
    }
    // The cam, a wheel on its side across the tip, with its axle.
    m.cylinder(-0.011, sgn * 0.238, -0.356, 0.024, 0.024, 0.022, 14, 3, 'x');
    m.box(0, sgn * 0.238, -0.356, 0.030, 0.006, 0.006, 3);
    m.box(-0.0135, sgn * 0.238, -0.356, 0.002, 0.014, 0.014, 32);   // a point of light in the cam
  }
  // The string, tip to tip, pulled back to the nock, and the two cables
  // running between the cams.
  m.box(0, 0.135, -0.300, 0.0025, 0.230, 0.0025, 3);
  m.box(0, -0.135, -0.300, 0.0025, 0.230, 0.0025, 3);
  m.box(0.006, 0, -0.352, 0.002, 0.470, 0.002, 3);
  m.box(-0.006, 0, -0.348, 0.002, 0.470, 0.002, 3);
  // A stabiliser forward of the grip, a short sight on the riser.
  m.cylinder(0, -0.040, -0.420, 0.007, 0.007, -0.170, 8, 31, 'z');
  m.cylinder(0, -0.040, -0.590, 0.013, 0.013, -0.030, 10, 3, 'z');
  m.box(0.020, 0.050, -0.420, 0.014, 0.024, 0.010, 3);
  m.box(0.020, 0.050, -0.426, 0.004, 0.004, 0.002, 32);
  // The arrow on the rest, nocked on the string: a black shaft and a
  // broadhead.
  m.cylinder(0.010, 0.008, -0.210, 0.0035, 0.0035, -0.560, 6, 31, 'z');
  m.cylinder(0.010, 0.008, -0.770, 0.009, 0.0, -0.050, 6, 3, 'z');
  m.box(0.010, 0.018, -0.240, 0.002, 0.018, 0.060, 32);
  return m;
}

/**
 * The tactic bow, after the modern takedown recurve of the jungle shooters:
 * a machined riser in olive with windows cut in it, long black limbs that
 * sweep back and then curl forward at the tips, a pin sight with two
 * bright fibre pins on the left of the window, an arrow rest and a short
 * stabiliser. Ours too: a recurve with the stock two pin sight, which is
 * what the descriptions agree on.
 */
export function buildTacticBowMesh() {
  const m = new MeshBuild();
  // The riser: a long olive bar with two windows cut out of it.
  m.box(0, 0.060, -0.400, 0.024, 0.060, 0.034, 33);
  m.box(0, -0.060, -0.400, 0.024, 0.060, 0.034, 33);
  m.box(0, 0.000, -0.412, 0.024, 0.060, 0.010, 33);
  m.box(0, -0.008, -0.394, 0.032, 0.060, 0.040, 2);      // grip, wrapped
  for (const sgn of [1, -1]) {
    // Limbs in four pieces: back, back, and then the tip curling forward.
    m.box(0, sgn * 0.118, -0.396, 0.034, 0.060, 0.014, 2);
    m.box(0, sgn * 0.180, -0.380, 0.030, 0.070, 0.012, 2);
    m.box(0, sgn * 0.240, -0.360, 0.026, 0.060, 0.011, 2);
    m.box(0, sgn * 0.282, -0.374, 0.022, 0.034, 0.010, 2);   // the recurve
    m.box(0, sgn * 0.300, -0.390, 0.018, 0.018, 0.010, 3);   // tip and string groove
    // Limb bolts.
    m.cylinder(-0.013, sgn * 0.090, -0.400, 0.007, 0.007, 0.004, 8, 3, 'x');
  }
  // The string to the curled tips, pulled back to the nock.
  m.box(0, 0.150, -0.340, 0.0025, 0.300, 0.0025, 3);
  m.box(0, -0.150, -0.340, 0.0025, 0.300, 0.0025, 3);
  // The sight: a bracket out to the left and two fibre pins in it.
  m.box(-0.026, 0.030, -0.412, 0.030, 0.008, 0.010, 33);
  m.box(-0.040, 0.034, -0.412, 0.004, 0.044, 0.016, 3);
  for (const y of [0.044, 0.026]) {
    m.box(-0.032, y, -0.412, 0.012, 0.003, 0.003, 3);
    m.box(-0.026, y, -0.412, 0.003, 0.003, 0.003, 34);   // the bright end
  }
  // A rest, and a short stabiliser.
  m.box(0.012, 0.016, -0.408, 0.016, 0.004, 0.020, 3);
  m.cylinder(0, -0.050, -0.418, 0.009, 0.009, -0.120, 8, 33, 'z');
  // The arrow on the rest: a carbon shaft, a field point and fletching.
  m.cylinder(0.010, 0.008, -0.210, 0.0035, 0.0035, -0.560, 6, 1, 'z');
  m.cylinder(0.010, 0.008, -0.770, 0.009, 0.0, -0.050, 6, 3, 'z');
  m.box(0.010, 0.018, -0.240, 0.002, 0.018, 0.060, 2);
  return m;
}

/** A marksman's rifle: a long receiver, a suppressor as long again, a scope. */
export function buildMarksmanMesh() {
  const m = new MeshBuild();
  m.box(0, -0.010, -0.170, 0.050, 0.080, 0.170, 2);      // stock
  m.box(0, 0.004, -0.360, 0.054, 0.070, 0.240, 0);       // receiver
  m.box(0, -0.004, -0.560, 0.044, 0.050, 0.180, 2);      // fore end
  m.cylinder(0, 0.010, -0.480, 0.012, 0.012, -0.280, 10, 1, 'z');   // barrel
  m.cylinder(0, 0.010, -0.760, 0.024, 0.024, -0.220, 12, 1, 'z');   // suppressor
  m.box(0, -0.090, -0.290, 0.040, 0.110, 0.058, 2);      // grip
  m.box(0, -0.060, -0.380, 0.034, 0.080, 0.070, 0);      // magazine
  m.cylinder(0, 0.072, -0.250, 0.022, 0.022, -0.260, 12, 3, 'z');   // scope tube
  m.cylinder(0, 0.072, -0.230, 0.028, 0.022, -0.030, 12, 3, 'z');   // eyepiece
  m.cylinder(0, 0.072, -0.500, 0.022, 0.032, -0.040, 12, 3, 'z');   // objective
  m.box(0, 0.046, -0.330, 0.020, 0.020, 0.030, 3);       // mount
  m.box(0, 0.046, -0.440, 0.020, 0.020, 0.030, 3);
  muzzleFlash(m, 0, 0.010, -0.980, 0.07, 0.03);
  return m;
}

/** Two barrels side by side, a short stock and a fat fore end. */
export function buildDoubleBarrelMesh() {
  const m = new MeshBuild();
  m.box(0, -0.020, -0.180, 0.058, 0.085, 0.170, 2);      // stock
  m.box(0, -0.004, -0.320, 0.064, 0.070, 0.120, 0);      // breech
  for (const side of [-1, 1]) {
    m.cylinder(side * 0.017, 0.012, -0.380, 0.016, 0.016, -0.380, 10, 1, 'z');
  }
  m.box(0, -0.020, -0.470, 0.060, 0.040, 0.160, 2);      // fore end
  m.box(0, -0.090, -0.250, 0.044, 0.110, 0.060, 2);      // grip
  m.box(0, 0.032, -0.740, 0.008, 0.010, 0.010, 3);       // bead
  muzzleFlash(m, 0, 0.012, -0.760, 0.20, 0.10);
  return m;
}

/** A chainsaw: engine, handles, and a long bar with its teeth. */
export function buildChainsawMesh() {
  const m = new MeshBuild();
  m.box(0, -0.020, -0.280, 0.110, 0.130, 0.220, 0);      // engine
  m.box(0, 0.070, -0.250, 0.030, 0.050, 0.150, 2);       // top handle
  m.box(0, -0.100, -0.200, 0.040, 0.080, 0.050, 2);      // rear grip
  m.box(0, -0.020, -0.600, 0.022, 0.080, 0.460, 1);      // the bar
  for (let i = 0; i < 12; i++) {
    const z = -0.40 - i * 0.036;
    m.box(0, 0.026, z, 0.026, 0.012, 0.014, 3);
    m.box(0, -0.066, z - 0.018, 0.026, 0.012, 0.014, 3);
  }
  return m;
}

/** A round shield with a ring of teeth, held on the left. */
export function buildShieldSawMesh() {
  const m = new MeshBuild();
  m.cylinder(0, 0, -0.330, 0.200, 0.200, -0.030, 20, 0, 'z');
  m.cylinder(0, 0, -0.362, 0.060, 0.040, -0.020, 12, 3, 'z');   // boss
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    m.box(Math.cos(a) * 0.215, Math.sin(a) * 0.215, -0.345, 0.04, 0.04, 0.02, 3, 0);
  }
  m.box(0, 0, -0.300, 0.030, 0.120, 0.030, 2);           // the grip behind it
  return m;
}

/** A revolver with a long barrel: a cylinder you can see, a heavy frame. */
export function buildMagnumMesh() {
  const m = new MeshBuild();
  m.box(0, -0.090, -0.230, 0.036, 0.110, 0.056, 2);      // grip
  m.box(0, 0.000, -0.300, 0.040, 0.050, 0.110, 0);       // frame
  m.cylinder(0, 0.000, -0.270, 0.034, 0.034, -0.060, 6, 1, 'z');   // the cylinder
  m.cylinder(0, 0.012, -0.340, 0.014, 0.014, -0.230, 10, 1, 'z');  // barrel
  m.box(0, -0.008, -0.450, 0.020, 0.018, 0.200, 0);      // the lug under it
  m.box(0, 0.034, -0.550, 0.006, 0.014, 0.010, 3);       // front sight
  m.box(0, -0.040, -0.300, 0.010, 0.030, 0.030, 3);      // trigger guard
  muzzleFlash(m, 0, 0.012, -0.572, 0.14, 0.07);
  return m;
}

/** A shotgun with a drum under it: short, fat and boxy. */
export function buildAutoShotgunMesh() {
  const m = new MeshBuild();
  m.box(0, -0.010, -0.180, 0.054, 0.080, 0.160, 2);      // stock
  m.box(0, 0.006, -0.360, 0.062, 0.084, 0.240, 0);       // receiver
  m.cylinder(0, 0.020, -0.480, 0.020, 0.020, -0.300, 12, 1, 'z');  // barrel
  m.cylinder(0, -0.080, -0.380, 0.080, 0.080, -0.090, 18, 2, 'z'); // the drum
  m.box(0, -0.100, -0.250, 0.040, 0.100, 0.056, 2);      // grip
  m.box(0, 0.056, -0.380, 0.016, 0.014, 0.200, 3);       // rail
  muzzleFlash(m, 0, 0.020, -0.790, 0.20, 0.10);
  return m;
}

/** Six barrels round a spindle, a motor housing and a carry handle. */
export function buildMinigunMesh() {
  const m = new MeshBuild();
  m.box(0, -0.010, -0.300, 0.110, 0.110, 0.220, 0);      // motor housing
  m.box(0, 0.090, -0.300, 0.024, 0.050, 0.180, 2);       // carry handle
  m.box(0, -0.110, -0.260, 0.040, 0.090, 0.060, 2);      // grip
  m.box(0.080, -0.060, -0.280, 0.060, 0.090, 0.130, 2);  // the belt box
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    m.cylinder(Math.cos(a) * 0.034, Math.sin(a) * 0.034 - 0.010, -0.410, 0.011, 0.011, -0.420, 8, 1, 'z');
  }
  m.cylinder(0, -0.010, -0.420, 0.054, 0.054, -0.030, 14, 0, 'z');   // the clamps
  m.cylinder(0, -0.010, -0.760, 0.054, 0.054, -0.030, 14, 0, 'z');
  muzzleFlash(m, 0, -0.010, -0.830, 0.22, 0.12);
  return m;
}

/** A fat tube on a stock, with a ladder sight for the long lob. */
export function buildLauncherMesh() {
  const m = new MeshBuild();
  m.box(0, -0.020, -0.180, 0.052, 0.080, 0.160, 2);      // stock
  m.box(0, -0.004, -0.330, 0.070, 0.076, 0.150, 0);      // breech
  m.cylinder(0, 0.004, -0.400, 0.040, 0.040, -0.330, 14, 1, 'z');  // tube
  m.cylinder(0, 0.004, -0.720, 0.046, 0.046, -0.030, 14, 0, 'z');  // muzzle ring
  m.box(0, -0.096, -0.280, 0.040, 0.100, 0.056, 2);      // grip
  m.box(0, -0.060, -0.520, 0.034, 0.060, 0.060, 2);      // fore grip
  m.box(0, 0.060, -0.420, 0.030, 0.050, 0.010, 3);       // ladder sight
  muzzleFlash(m, 0, 0.004, -0.760, 0.18, 0.10);
  return m;
}

/** Four tubes in a square box, on the shoulder like the rocket launcher. */
export function buildSwarmMesh() {
  const m = new MeshBuild();
  m.box(0, 0.000, -0.560, 0.150, 0.150, 0.720, 0);       // the pod
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    m.cylinder(x * 0.036, y * 0.036, -0.920, 0.026, 0.026, -0.020, 10, 3, 'z');
  }
  m.box(0, -0.120, -0.430, 0.040, 0.110, 0.062, 2);      // grip
  m.box(0, 0.096, -0.520, 0.028, 0.040, 0.200, 3);       // sight
  muzzleFlash(m, 0, 0.000, -0.930, 0.240, 0.150);
  return m;
}

/** A flail: a haft, a short chain and a spiked head. */
export function buildFlailMesh() {
  const m = new MeshBuild();
  m.cylinder(0, -0.080, -0.200, 0.018, 0.020, 0.260, 8, 2, 'y');  // haft
  for (let i = 0; i < 4; i++) m.box(0.010 * i, 0.190 + i * 0.035, -0.205 - i * 0.02, 0.016, 0.03, 0.016, 1);
  m.icosphere(0.05, 0.360, -0.290, 0.070, 10, 6, 0);
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0]]) {
    m.box(0.05 + dx * 0.085, 0.360 + dy * 0.085, -0.290 + dz * 0.085, 0.025, 0.025, 0.025, 3);
  }
  return m;
}

/** Eight short barrels stacked two by four in a block: Hailstorm. */
export function buildHailstormMesh() {
  const m = new MeshBuild();
  m.box(0, -0.020, -0.200, 0.056, 0.090, 0.170, 2);      // stock
  m.box(0, 0.000, -0.400, 0.110, 0.120, 0.240, 0);       // the block
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 2; c++) {
      m.cylinder(-0.026 + c * 0.052, -0.040 + r * 0.027, -0.520, 0.012, 0.012, -0.090, 8, 1, 'z');
    }
  }
  m.box(0, -0.100, -0.320, 0.044, 0.100, 0.056, 2);      // grip
  m.box(0, -0.075, -0.480, 0.040, 0.060, 0.070, 2);      // fore grip
  m.box(0, 0.070, -0.380, 0.024, 0.024, 0.080, 3);       // sight
  muzzleFlash(m, 0, 0.000, -0.612, 0.20, 0.09);
  return m;
}

/** A stubby gun with coils down the barrel that crackle: the Volt caster. */
export function buildVoltMesh() {
  const m = new MeshBuild();
  m.box(0, 0.000, -0.260, 0.060, 0.082, 0.240, 0);       // body
  m.cylinder(0, 0.004, -0.380, 0.020, 0.020, -0.200, 10, 1, 'z');
  for (let i = 0; i < 4; i++) m.cylinder(0, 0.004, -0.400 - i * 0.045, 0.034, 0.034, -0.016, 12, 36, 'z');
  m.box(0, 0.052, -0.250, 0.030, 0.020, 0.110, 36);      // the cell on top
  m.box(0, -0.090, -0.260, 0.042, 0.110, 0.056, 2);      // grip
  muzzleFlash(m, 0, 0.004, -0.590, 0.10, 0.05);
  return m;
}

/** A crossbow in steel with a bolt laid on it, its head glowing. */
export function buildArbalestMesh() {
  const m = new MeshBuild();
  m.box(0, -0.020, -0.200, 0.050, 0.080, 0.180, 2);      // stock
  m.box(0, 0.000, -0.420, 0.060, 0.060, 0.300, 0);       // tiller
  m.box(0, 0.010, -0.600, 0.340, 0.024, 0.030, 1);       // the prod
  m.box(-0.170, 0.010, -0.580, 0.020, 0.030, 0.060, 3);
  m.box(0.170, 0.010, -0.580, 0.020, 0.030, 0.060, 3);
  m.cylinder(0, 0.040, -0.300, 0.006, 0.006, -0.330, 6, 3, 'z');   // the bolt
  m.cylinder(0, 0.040, -0.630, 0.014, 0.0, -0.050, 8, 35, 'z');    // its head
  m.box(0, -0.090, -0.300, 0.040, 0.100, 0.056, 2);      // grip
  m.box(0, 0.074, -0.360, 0.030, 0.040, 0.090, 3);       // scope
  return m;
}

/** A frame with a saw blade sitting in it, ready to go. */
export function buildRipperMesh() {
  const m = new MeshBuild();
  m.box(0, -0.020, -0.200, 0.052, 0.080, 0.160, 2);      // stock
  m.box(0, -0.010, -0.420, 0.070, 0.050, 0.300, 0);      // the rail
  m.cylinder(0, 0.030, -0.480, 0.110, 0.110, 0.012, 20, 3, 'y');   // the blade
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    m.box(Math.cos(a) * 0.118, 0.036, -0.480 + Math.sin(a) * 0.118, 0.022, 0.012, 0.022, 1, a);
  }
  m.box(0, -0.096, -0.300, 0.040, 0.100, 0.056, 2);      // grip
  return m;
}

/** A ball of blue light in a cage you can hold: the cling charge. */
export function buildClingMesh() {
  const m = new MeshBuild();
  m.icosphere(0, 0, -0.16, 0.032, 10, 6, 32);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    m.box(Math.cos(a) * 0.034, 0, -0.16 + Math.sin(a) * 0.034, 0.008, 0.07, 0.008, 1, a);
  }
  return m;
}

/** A hilt and two prongs of light pointing forward: the lunge blade. */
export function buildBladeMesh() {
  const m = new MeshBuild();
  m.box(0, -0.070, -0.120, 0.034, 0.110, 0.040, 2);      // the hilt
  m.box(0, -0.005, -0.140, 0.070, 0.030, 0.050, 0);      // guard
  m.box(-0.020, 0.000, -0.330, 0.010, 0.016, 0.340, 32); // two prongs
  m.box(0.020, 0.000, -0.330, 0.010, 0.016, 0.340, 32);
  m.box(-0.014, 0.000, -0.520, 0.006, 0.010, 0.050, 32);
  m.box(0.014, 0.000, -0.520, 0.006, 0.010, 0.050, 32);
  return m;
}

/** A fighting knife: a black grip, a small guard and a bright blade, point forward. */
export function buildKnifeMesh() {
  const m = new MeshBuild();
  m.box(0, -0.008, -0.062, 0.026, 0.032, 0.110, 41);     // the grip
  m.box(0, -0.004, -0.122, 0.034, 0.060, 0.012, 0);      // the guard
  m.box(0, 0.000, -0.212, 0.007, 0.030, 0.170, 40);      // the blade
  m.box(0, 0.006, -0.312, 0.007, 0.016, 0.034, 40);      // and its point
  m.box(0, 0.016, -0.190, 0.009, 0.004, 0.120, 0);       // the spine
  return m;
}

/** A telescopic baton run out: a foam grip and two steel sections, a tip on the end. */
export function buildBatonMesh() {
  const m = new MeshBuild();
  m.cylinder(0, 0, -0.064, 0.019, 0.019, 0.014, 10, 0, 'z');     // the end cap
  m.cylinder(0, 0, -0.200, 0.017, 0.017, 0.136, 10, 41, 'z');    // the grip
  m.cylinder(0, 0, -0.340, 0.012, 0.012, 0.140, 10, 1, 'z');     // the first section
  m.cylinder(0, 0, -0.470, 0.0095, 0.0095, 0.130, 10, 1, 'z');   // the second
  m.cylinder(0, 0, -0.492, 0.013, 0.013, 0.022, 10, 3, 'z');     // the tip
  return m;
}

/** A baseball bat in pale ash, its handle taped, a knob at the end. */
export function buildBatMesh() {
  const m = new MeshBuild();
  m.cylinder(0, 0, -0.035, 0.022, 0.022, 0.015, 12, 39, 'z');    // the knob
  m.cylinder(0, 0, -0.170, 0.0135, 0.0135, 0.135, 12, 41, 'z');  // the taped handle
  m.cylinder(0, 0, -0.420, 0.027, 0.0135, 0.250, 12, 39, 'z');   // the taper
  m.cylinder(0, 0, -0.800, 0.033, 0.027, 0.380, 14, 39, 'z');    // the barrel
  return m;
}

/**
 * A fist, knuckles forward, with the wrist, the forearm and the cuff of a
 * sleeve behind it. side 1 is the right hand, -1 the left.
 */
export function buildFistMesh(side = 1) {
  const m = new MeshBuild();
  const X = (x) => x * side;
  m.box(0, 0, 0, 0.080, 0.064, 0.086, 38);                   // the back of the hand and the palm
  for (let i = 0; i < 4; i++) {
    const x = X(-0.029 + i * 0.0195);
    m.box(x, 0.010, -0.050, 0.018, 0.030, 0.022, 38);        // the knuckles
    m.box(x, -0.018, -0.042, 0.018, 0.026, 0.026, 38);       // the fingers folded under them
  }
  m.box(X(-0.044), -0.016, -0.026, 0.020, 0.022, 0.048, 38, side * 0.35);   // the thumb across
  m.cylinder(0, -0.004, 0.040, 0.027, 0.031, 0.170, 10, 38, 'z');          // the wrist and forearm
  m.cylinder(0, -0.004, 0.150, 0.037, 0.041, 0.200, 10, 41, 'z');          // the sleeve
  return m;
}

/** A boot and the leg of a pair of trousers, for a kick: the toe forward, the leg going back from the ankle. */
export function buildBootMesh() {
  const m = new MeshBuild();
  m.box(0, -0.040, -0.120, 0.105, 0.028, 0.300, 41);     // the sole
  m.box(0, 0.020, -0.100, 0.095, 0.090, 0.240, 43);      // the upper
  m.box(0, 0.002, -0.238, 0.090, 0.056, 0.060, 43);      // the toe cap
  m.box(0, 0.068, -0.120, 0.070, 0.008, 0.120, 2);       // the laces
  m.cylinder(0, 0.050, 0.010, 0.050, 0.062, 0.460, 10, 42, 'z');   // the trouser leg
  return m;
}

/** A long haft and a head like a paving stone, its striking face hot. */
export function buildHammerMesh() {
  const m = new MeshBuild();
  m.cylinder(0, -0.260, -0.300, 0.016, 0.016, 0.440, 8, 2, 'y');  // haft
  m.box(0, 0.200, -0.300, 0.090, 0.100, 0.200, 0);       // head
  m.box(0, 0.200, -0.405, 0.096, 0.106, 0.012, 35);      // the face
  m.box(0, 0.200, -0.195, 0.070, 0.080, 0.012, 1);
  for (const y of [0.155, 0.245]) m.box(0, y, -0.300, 0.094, 0.010, 0.204, 3);
  return m;
}

/** A fat barrel in orange red plastic, and the flare in it glowing. */
export function buildFlareMesh() {
  const m = new MeshBuild();
  m.box(0, -0.085, -0.230, 0.036, 0.110, 0.056, 37);     // grip
  m.box(0, 0.000, -0.290, 0.044, 0.056, 0.100, 37);      // frame
  m.cylinder(0, 0.008, -0.330, 0.030, 0.030, -0.170, 12, 37, 'z');
  m.cylinder(0, 0.008, -0.497, 0.022, 0.022, -0.004, 12, 35, 'z');  // the flare in the barrel
  m.box(0, -0.040, -0.290, 0.010, 0.030, 0.030, 0);      // trigger guard
  muzzleFlash(m, 0, 0.008, -0.502, 0.12, 0.06);
  return m;
}

export function buildSplinterMesh() {
  const m = new MeshBuild();
  m.box(0, 0.000, -0.260, 0.058, 0.080, 0.280, 0);       // body
  // The magazine of darts sits on top, where you can see it.
  for (let i = 0; i < 5; i++) {
    m.box(-0.030 + i * 0.015, 0.058, -0.330, 0.008, 0.034, 0.150, 6);
  }
  m.cylinder(0, 0.004, -0.500, 0.022, 0.018, -0.260, 10, 1, 'z');
  m.box(0, -0.088, -0.270, 0.042, 0.110, 0.060, 2);      // grip
  m.box(0, 0.046, -0.240, 0.022, 0.020, 0.070, 3);       // sight
  muzzleFlash(m, 0, 0.004, -0.762, 0.140, 0.055);
  return m;
}

/**
 * What is lying in the street. Every pickup is a steel plate on the pavement
 * with the thing itself turning above it, which is the arena shooter shape and
 * is readable at a hundred metres because the item glows and the plate does
 * not. The mesh is built about the pad centre, so the pad is at y -0.9 and the
 * item sits around the origin.
 *
 * Parts: 12 the plate, then 13 ammunition, 14 health, 15 quad, 16 ultrashield,
 * 17 overload. Anything built while flag is 1 turns and bobs in the shader.
 */
export function buildPickupMesh(kind) {
  const m = new MeshBuild();
  const part = { ammo: 13, health: 14, quad: 15, ultra: 16, overload: 17 }[kind] || 13;

  // The plate, with a rim around it in the kind's own colour. It stands a
  // clear fourteen centimetres proud of the collision height, because the
  // street that is drawn is not the height field that is collided against:
  // pavements and plazas are laid up to twelve centimetres above it, and a
  // plate any lower than this disappears into the one it happens to be on.
  m.cylinder(0, -0.76, 0, 0.92, 0.92, 0.07, 18, 12);
  m.ring(0, -0.685, 0, 0.74, 0.92, 22, part);

  // Everything from here up floats.
  m.flag = 1;
  if (kind === 'ammo') {
    // A crate with two straps over it.
    m.box(0, 0, 0, 0.70, 0.46, 0.52, part);
    m.box(0, 0.26, 0, 0.60, 0.08, 0.42, 12);
    m.box(-0.20, 0.02, 0, 0.08, 0.50, 0.56, 12);
    m.box(0.20, 0.02, 0, 0.08, 0.50, 0.56, 12);
  } else if (kind === 'health') {
    // A cross, which needs no caption in any language.
    m.box(0, 0, 0, 0.72, 0.24, 0.20, part);
    m.box(0, 0, 0, 0.24, 0.72, 0.20, part);
  } else if (kind === 'quad') {
    // Two pyramids base to base: an octahedron, sharp enough to read as a
    // threat at a distance.
    m.cylinder(0, 0.00, 0, 0.40, 0.001, 0.46, 4, part);
    m.cylinder(0, 0.00, 0, 0.40, 0.001, -0.46, 4, part);
  } else if (kind === 'ultra') {
    // A shell: a sphere inside a pair of standing hoops.
    m.icosphere(0, 0, 0, 0.30, 12, 8, part);
    for (const a of [0, Math.PI / 2]) {
      for (let i = 0; i < 16; i++) {
        const t0 = (i / 16) * Math.PI * 2, t1 = ((i + 1) / 16) * Math.PI * 2;
        const at = (t, r) => [Math.cos(a) * Math.cos(t) * r, Math.sin(t) * r,
          Math.sin(a) * Math.cos(t) * r];
        const n = [Math.cos(a) * Math.cos((t0 + t1) / 2), Math.sin((t0 + t1) / 2),
          Math.sin(a) * Math.cos((t0 + t1) / 2)];
        m.quad([at(t0, 0.44), at(t1, 0.44), at(t1, 0.50), at(t0, 0.50)], n, part);
        m.quad([at(t0, 0.50), at(t1, 0.50), at(t1, 0.44), at(t0, 0.44)],
          [-n[0], -n[1], -n[2]], part);
      }
    }
  } else {
    // Overload: a bolt, three slabs stepped down and across.
    for (let i = 0; i < 3; i++) {
      m.box((i - 1) * 0.15, (1 - i) * 0.24, 0, 0.24, 0.30, 0.15, part, 0.5);
    }
    m.box(0, 0, 0, 0.12, 0.76, 0.12, part, 0.5);
  }
  m.flag = 0;
  return m;
}

/**
 * One chunk, built about its own centre at roughly twenty centimetres across.
 * It is three overlapping boxes rather than one, because a single box tumbling
 * reads as a crate and three offset ones read as a piece of something. The
 * part id in the mesh is ignored: the shader takes it from the instance.
 */
export function buildGibMesh() {
  const m = new MeshBuild();
  m.box(0, 0, 0, 0.17, 0.13, 0.15, 0);
  m.box(0.06, 0.04, -0.03, 0.11, 0.10, 0.09, 0, 0.7);
  m.box(-0.05, -0.04, 0.04, 0.09, 0.08, 0.12, 0, -0.5);
  return m;
}

/**
 * A lump of a building, about the size of a gib before it is scaled: a
 * flattened, lopsided stone with flat facets, and a broken slab of floor
 * leaning against it. The gib mesh is three boxes, which tumbling through
 * the air reads as a piece of somebody; lying in a heap two metres across it
 * read as a pile of crates. Masonry breaks along planes, and a facet that
 * catches the sun on one side and not the other is what reads as stone.
 */
export function buildRubbleMesh() {
  const m = new MeshBuild();
  // A seeded jitter, so the mesh is the same every load.
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lump = (cx, cy, cz, rx, ry, rz) => {
    const SEG = 6, RINGS = 4;
    const pts = [];
    for (let r = 0; r <= RINGS; r++) {
      const v = r / RINGS;
      const phi = v * Math.PI;
      const row = [];
      for (let s = 0; s < SEG; s++) {
        const th = (s / SEG) * Math.PI * 2 + (r % 2) * 0.5;
        const k = r === 0 || r === RINGS ? 1 : 0.72 + rnd() * 0.5;
        row.push([cx + Math.sin(phi) * Math.cos(th) * rx * k,
          cy + Math.cos(phi) * ry * (0.8 + rnd() * 0.3),
          cz + Math.sin(phi) * Math.sin(th) * rz * k]);
      }
      pts.push(row);
    }
    const face = (a, b, c) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      // Outward, away from the middle of the lump.
      const mx = (a[0] + b[0] + c[0]) / 3 - cx, my = (a[1] + b[1] + c[1]) / 3 - cy;
      const mz = (a[2] + b[2] + c[2]) / 3 - cz;
      if (nx * mx + ny * my + nz * mz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      m.tri([a, b, c], [nx / l, ny / l, nz / l], 0);
    };
    for (let r = 0; r < RINGS; r++) {
      for (let s = 0; s < SEG; s++) {
        const a = pts[r][s], b = pts[r][(s + 1) % SEG];
        const c = pts[r + 1][s], d = pts[r + 1][(s + 1) % SEG];
        if (r > 0) face(a, b, c);
        if (r < RINGS - 1) face(b, d, c);
      }
    }
  };
  lump(0, 0, 0, 0.17, 0.09, 0.13);
  lump(0.08, 0.03, -0.05, 0.08, 0.06, 0.07);
  // The slab: a piece of floor, thin and broad, at an angle.
  m.box(-0.07, -0.01, 0.06, 0.2, 0.035, 0.12, 0, 0.6);
  return m;
}

/**
 * A fighter, about fifteen metres long, nose towards -z like everything else
 * here. The origin is the middle of the fuselage, which sits 1.9 m over the
 * road on its wheels. Parts: 33 the grey it is painted, 2 dark metal, 24 the
 * canopy, 8 the missiles, 32 tyres, 35 the afterburner, 44 the undercarriage,
 * which folds away once it is off the ground.
 *
 * The first one was a box with five boxes either side for a wing, in the
 * same near black as a drone. This is a fuselage that tapers to a nose, a
 * cranked delta, two fins, and the paint fighters actually wear.
 */
export function buildJetMesh() {
  const m = new MeshBuild();
  const P = 33;
  // The fuselage, front to back: the radome, the forward body, the wide
  // middle where the intakes and the wing root are, and the tail.
  m.cylinder(0, -0.05, -5.0, 0.62, 0.06, -2.6, 14, 2, 'z');
  m.cylinder(0, 0, -1.2, 0.95, 0.66, -3.8, 14, P, 'z');
  m.box(0, -0.05, 1.5, 2.1, 1.15, 5.4, P);
  m.cylinder(0, 0, 4.2, 0.95, 0.78, 2.3, 14, P, 'z');
  // The spine behind the canopy, which is what gives it a back.
  m.box(0, 0.62, 0.6, 0.9, 0.35, 4.6, P);
  // Canopy: a bubble in two pieces, the windscreen and the hood.
  m.cylinder(0, 0.55, -2.3, 0.46, 0.18, -1.5, 12, 24, 'z');
  m.box(0, 0.62, -1.7, 0.86, 0.56, 1.3, 24);
  // Intakes either side under the wing root, black inside.
  for (const side of [-1, 1]) {
    m.box(side * 1.12, -0.25, -0.9, 0.62, 0.9, 2.2, P);
    m.box(side * 1.12, -0.25, -2.02, 0.5, 0.74, 0.06, 2);
  }
  // A cranked delta: a long root, a short tip, swept well back.
  for (const side of [-1, 1]) {
    m.plate([
      [side * 1.0, -0.05, -1.8], [side * 5.8, -0.12, 2.6],
      [side * 5.8, -0.12, 3.6], [side * 1.0, -0.05, 3.8],
    ], 0.14, P);
    // Tailplanes.
    m.plate([
      [side * 1.0, 0.0, 4.6], [side * 3.4, 0.0, 6.0],
      [side * 3.4, 0.0, 6.8], [side * 1.0, 0.0, 6.5],
    ], 0.1, P);
    // Two fins, canted out the way most of them are now.
    m.plate([
      [side * 0.55, 0.55, 3.4], [side * 0.55, 0.55, 6.2],
      [side * 1.1, 3.0, 6.7], [side * 1.0, 3.0, 5.5],
    ], 0.1, P);
    // A missile under each wing and one on each tip.
    m.cylinder(side * 3.2, -0.42, -0.2, 0.13, 0.13, 2.8, 8, 8, 'z');
    m.cylinder(side * 3.2, -0.42, -0.2, 0.13, 0.02, -0.4, 8, 8, 'z');
    m.box(side * 3.2, -0.22, 1.1, 0.06, 0.3, 1.2, 2);
    m.cylinder(side * 5.85, -0.12, 1.2, 0.09, 0.09, 2.4, 8, 8, 'z');
    // Main gear, under the intakes.
    m.box(side * 1.25, -1.2, 1.3, 0.14, 1.3, 0.14, 44);
    m.cylinder(side * 1.15, -1.57, 1.3, 0.33, 0.33, side * 0.28, 10, 44, 'x');
  }
  // Nose gear.
  m.box(0, -1.15, -4.0, 0.12, 1.2, 0.12, 44);
  m.cylinder(-0.13, -1.62, -4.0, 0.28, 0.28, 0.26, 10, 44, 'x');
  // The nozzle and what is burning in it.
  m.cylinder(0, 0, 6.5, 0.78, 0.66, 0.8, 14, 2, 'z');
  m.cylinder(0, 0, 7.31, 0.58, 0.52, 0.06, 14, 35, 'z');
  return m;
}

/**
 * A light military four by four, four and a half metres long, nose towards -z.
 * Parts: 31 the olive it is painted, 2 dark metal, 32 tyres, 39 wheel hubs,
 * 24 glass, 6 the seats, 8 the gun, 34 the headlights.
 */
/**
 * A camp, for Tactics: a ring of sandbags with gaps to walk in through, two
 * tents, crates, a radio on a table with its mast, a flagpole in the middle
 * and a siren on a pole. Sixteen metres across, built round its own middle
 * with the ground at nought.
 *
 * Parts 64 sandbag, 65 canvas, 66 wood, 67 the radio set, 68 its mast, 69 the
 * light on top of the mast, 70 poles, 71 the flag, 72 the siren. The radio's
 * three parts vanish when it is shot to pieces, the flag turns blue when the
 * camp is taken and the siren goes red while the alarm is on: all three are
 * read off the instance in the vertex shader.
 */
export const CAMP_RADIO = { x: 6.5, z: -5.0, y: 1.05 };
// The alarm box, on the siren's pole at chest height, facing into the camp:
// break it and the siren cannot be sounded.
export const CAMP_ALARM = { x: -6.2, z: -3.32, y: 1.35 };
export function buildCampMesh() {
  const m = new MeshBuild();
  // The sandbags: four arcs of two courses, with a gap between each pair of
  // arcs for a way in.
  const R = 14;
  for (let k = 0; k < 4; k++) {
    const a0 = (k * 90 + 16) * Math.PI / 180;
    const a1 = (k * 90 + 74) * Math.PI / 180;
    const n = Math.round((a1 - a0) * R / 1.3);
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < n; i++) {
        const a = a0 + (i + 0.5 + (row ? 0.5 : 0)) / n * (a1 - a0);
        if (row && i === n - 1) continue;
        m.box(Math.cos(a) * R, 0.24 + row * 0.44, Math.sin(a) * R, 1.25, 0.44, 0.62, 64, a + Math.PI / 2);
      }
    }
  }
  // A tent: a ridge along its length, two pitched sides and two ends.
  const tent = (cx, cz, rot, w, l, h) => {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const P = (x, y, z) => [cx + x * c - z * sn, y, cz + x * sn + z * c];
    const N = (x, y, z) => [x * c - z * sn, y, x * sn + z * c];
    const hw = w / 2, hl = l / 2;
    const slope = Math.hypot(hw, h);
    m.quad([P(-hw, 0, -hl), P(-hw, 0, hl), P(0, h, hl), P(0, h, -hl)], N(-h / slope, hw / slope, 0), 65);
    m.quad([P(hw, 0, hl), P(hw, 0, -hl), P(0, h, -hl), P(0, h, hl)], N(h / slope, hw / slope, 0), 65);
    m.tri([P(-hw, 0, -hl), P(0, h, -hl), P(hw, 0, -hl)], N(0, 0, -1), 65);
    m.tri([P(hw, 0, hl), P(0, h, hl), P(-hw, 0, hl)], N(0, 0, 1), 65);
  };
  tent(-5.2, 3.6, 0.35, 3.2, 4.6, 2.4);
  tent(4.6, 5.4, -0.5, 3.0, 4.2, 2.2);
  // Crates.
  m.box(-2.2, 0.5, -6.4, 1.0, 1.0, 1.0, 66, 0.2);
  m.box(-1.1, 0.5, -6.2, 1.0, 1.0, 1.0, 66, 0.05);
  m.box(-1.7, 1.5, -6.3, 1.0, 1.0, 1.0, 66, 0.4);
  m.box(-8.2, 0.4, -1.5, 2.0, 0.8, 0.9, 66, 1.2);
  // The radio: a table, the set on it, a mast and the light on the mast.
  const r = CAMP_RADIO;
  m.box(r.x, 0.38, r.z, 1.5, 0.08, 0.8, 66);
  for (const [dx, dz] of [[-0.65, -0.32], [0.65, -0.32], [-0.65, 0.32], [0.65, 0.32]]) {
    m.box(r.x + dx, 0.18, r.z + dz, 0.08, 0.36, 0.08, 66);
  }
  m.box(r.x, 0.62, r.z, 0.62, 0.42, 0.42, 67);
  m.box(r.x + 0.2, 0.9, r.z, 0.08, 0.16, 0.08, 67);
  m.cylinder(r.x + 0.55, 0.4, r.z - 0.1, 0.05, 0.03, 6.2, 6, 68);
  m.box(r.x + 0.55, 6.65, r.z - 0.1, 0.16, 0.16, 0.16, 69);
  // The flagpole in the middle, and the flag.
  m.cylinder(0, 0, 0, 0.07, 0.05, 7.4, 8, 70);
  m.box(0.85, 6.75, 0, 1.6, 1.0, 0.05, 71);
  // The siren on its pole.
  m.cylinder(-6.2, 0, -3.6, 0.06, 0.05, 4.2, 6, 70);
  m.cylinder(-6.2, 4.2, -3.6, 0.22, 0.32, 0.45, 10, 72);
  // And the alarm box on the pole: a yellow housing, a red lamp on top, and
  // a conduit up to the siren.
  const al = CAMP_ALARM;
  m.box(al.x, al.y - 0.3, al.z, 0.5, 0.6, 0.26, 85);
  m.box(al.x, al.y + 0.06, al.z + 0.04, 0.18, 0.12, 0.18, 86);
  m.box(al.x + 0.18, al.y + 0.02, al.z - 0.08, 0.06, 2.8, 0.06, 70);
  return m;
}

/**
 * A nest, for Slayer: a mound of flesh with a heart in the top of it, bone
 * spikes round it and roots across the street. Parts 75 flesh, 76 bone, 77
 * the heart. Dead, it slumps and the heart goes dark; awake, the heart
 * beats hard. Both are read off the instance in the vertex shader.
 */
export function buildNestMesh() {
  const m = new MeshBuild();
  m.cylinder(0, 0, 0, 3.4, 2.2, 1.4, 16, 75);
  m.cylinder(0, 1.4, 0, 2.2, 1.0, 1.1, 14, 75);
  m.icosphere(0, 2.75, 0, 1.0, 14, 8, 77);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    const r = 3.2 + (i % 3) * 0.5;
    m.cylinder(Math.cos(a) * r, 0, Math.sin(a) * r, 0.22, 0.02, 2.6 + (i % 4) * 0.9, 6, 76);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const len = 4 + (i % 3) * 2;
    m.box(Math.cos(a) * (3 + len / 2), 0.18, Math.sin(a) * (3 + len / 2), len, 0.36, 0.5, 75, -a);
  }
  return m;
}

/**
 * A city car: a saloon of no make in particular. The paint is part 90,
 * which the shader turns into one of six colours by the instance, so a
 * street of them is not one car twenty times; one of the six is the ivory
 * of a Berlin taxi, which also gets the sign on the roof.
 */
export function buildCarMesh() {
  const m = new MeshBuild();
  const P = 90;
  m.box(0, 0.62, 0, 1.76, 0.5, 4.4, P);                     // the body
  m.box(0, 0.42, -2.18, 1.7, 0.22, 0.12, 2);                // bumpers
  m.box(0, 0.42, 2.18, 1.7, 0.22, 0.12, 2);
  // The cabin, narrower than the body, with a raked screen front and back.
  m.box(0, 1.15, 0.25, 1.56, 0.52, 2.1, P);
  m.plate([[-0.76, 0.9, -0.8], [0.76, 0.9, -0.8], [0.72, 1.38, -0.55], [-0.72, 1.38, -0.55]], 0.04, 24);
  m.plate([[-0.76, 0.9, 1.45], [0.76, 0.9, 1.45], [0.72, 1.38, 1.22], [-0.72, 1.38, 1.22]], 0.04, 24);
  for (const side of [-1, 1]) {
    m.box(side * 0.79, 1.15, 0.28, 0.04, 0.38, 1.8, 24);    // side windows
    for (const z of [-1.35, 1.35]) {
      m.cylinder(side * 0.72, 0.36, z, 0.36, 0.36, side * 0.2, 14, 32, 'x');
      m.cylinder(side * 0.93, 0.36, z, 0.17, 0.17, side * 0.02, 10, 39, 'x');
    }
    m.box(side * 0.6, 0.68, -2.22, 0.3, 0.12, 0.04, 34);     // headlights
    m.box(side * 0.62, 0.7, 2.22, 0.3, 0.12, 0.04, 99);      // tail lights
  }
  return m;
}

/**
 * A Berlin double decker in the city's yellow (part 96), black window bands
 * along both decks and a dark skirt (97).
 */
export function buildBusMesh() {
  const m = new MeshBuild();
  const Y = 96;
  m.box(0, 2.25, 0, 2.5, 3.9, 11.6, Y);                      // the body, both decks
  m.box(0, 0.42, 0, 2.48, 0.5, 11.4, 97);                    // the skirt
  for (const side of [-1, 1]) {
    m.box(side * 1.255, 1.55, 0.2, 0.02, 0.9, 10.4, 24);     // lower deck windows
    m.box(side * 1.255, 3.25, 0, 0.02, 0.9, 10.9, 24);       // upper deck windows
    for (const z of [-3.9, 4.0]) {
      m.cylinder(side * 1.08, 0.5, z, 0.5, 0.5, side * 0.2, 16, 32, 'x');
      m.cylinder(side * 1.3, 0.5, z, 0.24, 0.24, side * 0.02, 10, 39, 'x');
    }
    m.box(side * 0.9, 0.8, -5.82, 0.32, 0.16, 0.04, 34);     // headlights
    m.box(side * 0.95, 0.9, 5.82, 0.22, 0.3, 0.04, 99);      // tail lights
  }
  m.box(0, 1.6, -5.81, 2.3, 1.4, 0.04, 24);                  // windscreen
  m.box(0, 3.3, -5.81, 2.3, 0.9, 0.04, 24);                  // upper front window
  m.box(0, 4.0, -5.82, 1.6, 0.26, 0.05, 98);                 // the destination board, lit
  m.box(0, 4.26, 0, 2.4, 0.08, 11.4, 97);                    // roof
  return m;
}

/**
 * A traffic light on its mast, Berlin style: a dark housing on a thin pole
 * with red, amber and green (parts 101 to 103) facing whoever is coming,
 * each under a visor. Which are lit the instance says, in the rotor
 * channel: 0 red, 1 red and amber, 2 green, 3 amber, 4 dark.
 */
export function buildSignalMesh() {
  const m = new MeshBuild();
  m.cylinder(0, 0, 0, 0.075, 0.06, 3.5, 8, 100);                // the mast
  m.box(0, 2.9, 0, 0.34, 1.02, 0.26, 100);                      // the housing
  m.box(0, 2.9, 0.15, 0.52, 1.2, 0.03, 100);                    // the board behind it
  for (const [y, part] of [[3.22, 101], [2.9, 102], [2.58, 103]]) {
    m.icosphere(0, y, -0.12, 0.1, 10, 6, part);                 // the lamp
    m.box(0, y + 0.13, -0.2, 0.26, 0.025, 0.14, 100);           // its visor
  }
  return m;
}

/**
 * A cover in the road over the steam pipe: a flat iron disc with a rim
 * (part 107). The instance says what it is doing, and the shader makes it
 * glow before it goes (108) and a black hole once it has (109).
 */
export function buildCoverMesh() {
  const m = new MeshBuild();
  m.cylinder(0, 0, 0, 0.5, 0.5, 0.03, 14, 107);
  m.cylinder(0, 0.03, 0, 0.42, 0.4, 0.02, 14, 107);
  return m;
}

/**
 * A power box on the pavement: a grey green cabinet with a lip on top and a
 * lamp in the door (parts 110 and 111). The instance says what it is doing:
 * crackling blue before it goes (112), its lamp blinking red while a trap is
 * set (114), and burnt black once it has gone (113).
 */
export function buildPowerBoxMesh() {
  const m = new MeshBuild();
  m.box(0, 0.62, 0, 0.92, 1.24, 0.42, 110);
  m.box(0, 1.27, 0, 0.98, 0.05, 0.48, 110);
  m.box(-0.23, 0.64, -0.215, 0.42, 1.1, 0.012, 110);           // the two doors
  m.box(0.23, 0.64, -0.215, 0.42, 1.1, 0.012, 110);
  m.box(0.3, 1.08, -0.226, 0.06, 0.06, 0.012, 111);            // the lamp
  return m;
}

/**
 * An ATM let into a wall: a steel fascia (115) with a screen lit blue (116),
 * green and flickering while it throws its notes (117), dead once empty (118).
 */
export function buildAtmMesh() {
  const m = new MeshBuild();
  m.box(0, 1.2, 0.02, 0.74, 1.04, 0.2, 115);
  m.box(0, 1.42, -0.085, 0.36, 0.26, 0.02, 116);              // the screen
  m.box(0, 1.1, -0.1, 0.26, 0.16, 0.06, 115);                  // the keypad
  m.box(0, 0.92, -0.09, 0.3, 0.03, 0.04, 116);                 // the slot
  return m;
}

/**
 * One road blocker: a steel post (119) with a red reflective band (120). The
 * whole post sinks into the road by as much as the instance says it is not up.
 */
export function buildBollardMesh() {
  const m = new MeshBuild();
  m.cylinder(0, 0, 0, 0.12, 0.12, 0.9, 10, 119);
  m.cylinder(0, 0.6, 0, 0.125, 0.125, 0.14, 10, 120);
  m.cylinder(0, 0.9, 0, 0.12, 0.1, 0.03, 10, 119);
  return m;
}

export function buildJeepMesh() {
  const m = new MeshBuild();
  const P = 31;
  m.box(0, 0.56, 0, 1.4, 0.28, 4.1, 2);                   // the frame
  // The body is built round the wheels rather than over them: a tub between
  // the axles, a nose in front of them, a back behind, and wheel arches.
  m.box(0, 0.98, -0.02, 1.36, 0.6, 4.0, P);
  for (const side of [-1, 1]) {
    m.box(side * 0.87, 0.98, -0.02, 0.38, 0.6, 1.32, P);   // between the wheels
    m.box(side * 0.87, 0.98, -1.93, 0.38, 0.6, 0.36, P);   // ahead of the front
    m.box(side * 0.87, 0.98, 1.88, 0.38, 0.6, 0.44, P);    // behind the back
    for (const z of [-1.3, 1.25]) {
      m.box(side * 0.9, 1.31, z, 0.46, 0.08, 1.12, P);     // the arch over it
      m.cylinder(side * 0.7, 0.43, z, 0.43, 0.43, side * 0.34, 14, 32, 'x');
      m.cylinder(side * 1.04, 0.43, z, 0.2, 0.2, side * 0.02, 10, 39, 'x');
    }
  }
  // Bonnet, sloping a little to the grille.
  m.plate([[-0.95, 1.36, -0.75], [0.95, 1.36, -0.75], [0.95, 1.24, -2.12], [-0.95, 1.24, -2.12]], 0.1, P);
  m.box(0, 0.98, -2.12, 1.5, 0.5, 0.08, 2);               // grille
  for (const side of [-1, 1]) m.box(side * 0.6, 1.08, -2.17, 0.22, 0.16, 0.04, 34);
  m.box(0, 0.6, -2.22, 1.98, 0.2, 0.22, 2);               // bumper
  // Windscreen, raked back, in a frame.
  m.plate([[-0.86, 1.4, -0.66], [0.86, 1.4, -0.66], [0.86, 1.98, -0.46], [-0.86, 1.98, -0.46]], 0.05, 24);
  for (const side of [-1, 1]) m.box(side * 0.9, 1.7, -0.56, 0.07, 0.62, 0.07, 2);
  m.box(0, 2.0, -0.46, 1.86, 0.07, 0.07, 2);
  // Two seats, and the sides and back of the load bed behind them.
  for (const side of [-1, 1]) {
    m.box(side * 0.42, 1.4, -0.05, 0.5, 0.18, 0.5, 6);
    m.box(side * 0.42, 1.68, 0.2, 0.5, 0.5, 0.1, 6);
    m.box(side * 0.89, 1.48, 1.05, 0.08, 0.36, 1.85, P);
  }
  m.box(0, 1.48, 1.98, 1.86, 0.36, 0.08, P);
  m.cylinder(0, 1.22, 2.02, 0.38, 0.38, 0.26, 14, 32, 'z');   // the spare
  // Roll bar and the gun on its post.
  for (const side of [-1, 1]) m.box(side * 0.86, 1.95, 0.55, 0.08, 1.0, 0.08, 2);
  m.box(0, 2.45, 0.55, 1.8, 0.08, 0.08, 2);
  m.cylinder(0, 1.3, 0.95, 0.06, 0.06, 1.0, 8, 8, 'y');
  m.box(0, 2.38, 0.75, 0.18, 0.22, 0.75, 8);
  m.cylinder(0, 2.4, 0.38, 0.045, 0.045, -0.95, 8, 8, 'z');
  m.box(0.18, 2.32, 0.8, 0.18, 0.18, 0.3, P);             // the ammunition box
  m.box(-0.8, 2.2, 1.9, 0.03, 1.5, 0.03, 2);               // aerial
  return m;
}

/**
 * One S-Bahn carriage, as it runs on the Stadtbahn viaduct over the city.
 *
 * Eighteen metres of it, three wide, with the two tone paint Berlin has used
 * since the twenties: red below the waist, ochre above it. Parts: 27 is the
 * red, 28 the ochre, 24 the glass, 0 the roof and the gear under the floor.
 * It is drawn through the vehicle pipeline because a carriage is a box that
 * moves, which is what that pipeline is for, and three of them in a row are
 * three instances of one mesh.
 */
export function buildTrainMesh() {
  const m = new MeshBuild();
  const L = 17.4, W = 2.95;
  m.box(0, 1.55, 0, W, 1.50, L, 27);                 // the red below the waist
  m.box(0, 2.72, 0, W, 0.84, L, 28);                 // ochre above it
  m.box(0, 3.26, 0, W - 0.22, 0.30, L - 0.5, 0);     // roof
  // The window band, a hand's breadth proud of the side so it reads as glass
  // rather than as paint.
  for (const side of [-1, 1]) {
    m.box(side * (W / 2 + 0.02), 2.72, 0, 0.06, 0.66, L - 1.6, 24);
  }
  // The cab ends: a darker face and a windscreen.
  for (const end of [-1, 1]) {
    m.box(0, 2.55, end * (L / 2 - 0.08), W - 0.3, 1.0, 0.1, 24);
    m.box(0, 1.05, end * (L / 2 - 0.05), W - 0.5, 0.5, 0.12, 0);
  }
  // Skirt and bogies, so it does not float over the rails.
  m.box(0, 0.72, 0, W - 0.5, 0.55, L - 1.2, 0);
  for (const z of [-L / 2 + 2.6, L / 2 - 2.6]) {
    m.box(0, 0.42, z, W - 0.35, 0.5, 2.9, 2);
    for (const side of [-1, 1]) {
      for (const dz of [-0.95, 0.95]) {
        m.cylinder(side * 0.72, 0.42, z + dz, 0.42, 0.42, side * 0.12, 8, 2, 'y');
      }
    }
  }
  return m;
}

/**
 * A main battle tank, nine metres with the gun, nose towards -z. Parts: 31
 * the olive, 2 dark metal and the tracks, 39 road wheels, 8 the gun, and the
 * turret's own 45 olive, 46 gun and 47 dark metal, which turn with it.
 *
 * Tracks with road wheels you can see, a sloped glacis, a turret with angled
 * cheeks and a bustle, and a long gun with an evacuator on it, which is the
 * outline anybody reads as a tank. The first one was four stacked boxes.
 */
export function buildTankMesh() {
  const m = new MeshBuild();
  const P = 31;
  for (const side of [-1, 1]) {
    m.box(side * 1.55, 0.55, 0, 0.62, 0.9, 6.5, 2);          // track
    for (let i = 0; i < 6; i++) {
      m.cylinder(side * 1.86, 0.42, -2.35 + i * 0.94, 0.36, 0.36, side * 0.05, 12, 39, 'x');
    }
    m.cylinder(side * 1.86, 0.72, -3.05, 0.3, 0.3, side * 0.05, 10, 39, 'x');   // idler
    m.cylinder(side * 1.86, 0.72, 3.05, 0.34, 0.34, side * 0.05, 10, 39, 'x');  // sprocket
    m.box(side * 1.6, 1.08, -0.3, 0.72, 0.36, 5.9, P);       // skirt
  }
  m.box(0, 1.0, 0.15, 2.5, 0.8, 6.2, P);                    // lower hull
  m.box(0, 1.5, 0.35, 3.3, 0.24, 5.8, P);                   // fenders and deck
  // The glacis: one sloped plate from the deck down to the nose.
  m.plate([[-1.6, 1.58, -2.55], [1.6, 1.58, -2.55], [1.4, 0.75, -3.35], [-1.4, 0.75, -3.35]], 0.14, P);
  m.box(0, 1.6, 2.95, 3.0, 0.3, 0.5, 2);                    // engine deck grille
  // Turret. Everything from here on turns with it, so it is built in parts
  // of its own, 45 to 47, which the shader turns about the turret ring and
  // then draws as the olive, the gun and the dark metal they stand for.
  const T = 45, G = 46, D = 47;
  m.box(0, 2.08, 0.45, 2.5, 0.62, 2.7, T);
  for (const side of [-1, 1]) {
    m.box(side * 0.82, 2.08, -1.15, 0.95, 0.58, 1.0, T, side * 0.42);   // cheeks
    // Smoke dischargers on the cheek.
    for (let k = 0; k < 3; k++) {
      m.cylinder(side * 1.3, 2.25 + k * 0.1, -0.6, 0.06, 0.06, -0.25, 6, D, 'z');
    }
  }
  m.box(0, 2.12, 2.15, 2.2, 0.52, 0.9, T);                  // bustle
  m.cylinder(0.6, 2.38, 0.65, 0.34, 0.3, 0.26, 12, T, 'y'); // commander
  m.box(-0.55, 2.47, 0.3, 0.6, 0.12, 0.6, D);               // loader's hatch
  m.box(0, 2.08, -1.6, 0.66, 0.5, 0.5, T);                  // mantlet
  m.cylinder(0, 2.1, -1.8, 0.14, 0.12, -4.0, 12, G, 'z');   // the gun
  m.cylinder(0, 2.1, -3.2, 0.2, 0.2, -0.6, 12, G, 'z');     // evacuator
  m.cylinder(0, 2.1, -5.7, 0.17, 0.17, -0.2, 12, G, 'z');   // muzzle
  m.cylinder(0.6, 2.6, 0.5, 0.03, 0.03, -0.7, 6, G, 'z');   // the roof gun
  return m;
}

/**
 * A gunship: a narrow body with two seats one behind the other, stub wings
 * with rocket pods, a long tail and four blades. Nose towards -z, and the
 * origin is under the mast at the bottom of the skids, so the rotor turns
 * about the origin and the aircraft stands on the road with nothing under
 * it. Parts: 36 the green it is painted, 24 glass, 2 dark metal, 8 the gun
 * and the pods, 37 the main blades, 38 the tail rotor.
 */
export function buildHeliMesh() {
  const m = new MeshBuild();
  const P = 36;
  m.box(0, 1.5, -0.1, 1.15, 1.25, 4.0, P);                  // body
  m.box(0, 1.35, -2.5, 0.95, 0.95, 1.0, P);                 // nose
  m.cylinder(0, 1.3, -3.0, 0.45, 0.14, -0.7, 12, P, 'z');
  // Two seats in a line, the gunner low and in front, the pilot behind and
  // above him: the stepped canopy is what makes it read as a gunship.
  m.box(0, 2.22, -1.75, 0.86, 0.55, 1.2, 24);
  m.box(0, 2.42, -0.7, 0.86, 0.65, 1.0, 24);
  for (const side of [-1, 1]) {
    m.box(side * 0.62, 2.35, 0.5, 0.48, 0.55, 1.9, P);      // engines
    m.box(side * 0.62, 2.35, 1.5, 0.36, 0.36, 0.12, 2);     // exhausts
    m.box(side * 1.2, 1.5, 0.0, 1.3, 0.1, 0.85, P);         // stub wing
    m.cylinder(side * 1.55, 1.18, -0.6, 0.22, 0.22, 1.2, 10, 8, 'z');   // pod
    m.box(side * 0.82, 0.06, -0.3, 0.1, 0.1, 3.2, 2);       // skid
    m.box(side * 0.68, 0.45, -1.1, 0.08, 0.8, 0.08, 2);
    m.box(side * 0.68, 0.45, 0.6, 0.08, 0.8, 0.08, 2);
  }
  // The tail, tapering, with a fin and a tailplane at the end of it.
  m.cylinder(0, 1.75, 1.9, 0.4, 0.2, 4.4, 10, P, 'z');
  m.box(0, 2.55, 6.25, 0.14, 1.5, 0.9, P);
  m.box(0, 1.85, 5.6, 1.7, 0.08, 0.5, P);
  // Tail rotor, on the left of the fin, turning about its own hub.
  m.box(0.16, 2.75, 6.3, 0.04, 1.5, 0.16, 38);
  m.box(0.16, 2.75, 6.3, 0.04, 0.16, 1.5, 38);
  // Mast, hub and four blades.
  m.cylinder(0, 2.6, 0, 0.13, 0.11, 0.55, 10, 2, 'y');
  m.box(0, 3.18, 0, 0.6, 0.12, 0.6, 2);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    m.box(Math.cos(a) * 2.75, 3.18, Math.sin(a) * 2.75, 5.2, 0.05, 0.34, 37, a);
  }
  // The gun under the chin.
  m.cylinder(0, 0.88, -2.3, 0.22, 0.22, 0.28, 10, 8, 'y');
  m.cylinder(0, 0.88, -2.35, 0.05, 0.05, -1.0, 8, 8, 'z');
  return m;
}

/**
 * A soldier. Built standing at the origin with their feet on the ground and
 * facing -z, the same way the weapon points, so one yaw puts them anywhere.
 * Parts: 4 cloth, 5 helmet, 6 webbing, 7 the rifle.
 *
 * The limbs are separate boxes placed where a walk cycle can swing them in the
 * vertex shader, which is why the arms and legs are their own parts rather than
 * one silhouette.
 */
export function buildSoldierMesh() {
  const m = new MeshBuild();
  // Legs. Part ids carry the walk phase: 40 and 41 are the two legs, 42 and 43
  // the two arms, and the shader reads the fractional part.
  m.box(-0.11, 0.42, 0, 0.19, 0.84, 0.22, 4);       // left leg
  m.box(0.11, 0.42, 0, 0.19, 0.84, 0.22, 4);        // right leg
  m.box(-0.11, 0.05, -0.04, 0.20, 0.10, 0.30, 6);   // left boot
  m.box(0.11, 0.05, -0.04, 0.20, 0.10, 0.30, 6);    // right boot

  // Torso, with the webbing over it.
  m.box(0, 1.14, 0, 0.46, 0.62, 0.27, 4);
  m.box(0, 1.16, -0.005, 0.40, 0.44, 0.30, 6);      // vest
  m.box(0, 0.84, 0, 0.44, 0.12, 0.26, 6);           // belt

  // Arms, held towards the weapon.
  m.box(-0.30, 1.16, -0.05, 0.16, 0.54, 0.18, 4);
  m.box(0.30, 1.16, -0.05, 0.16, 0.54, 0.18, 4);

  // Head and helmet.
  m.box(0, 1.52, 0, 0.21, 0.24, 0.23, 6);           // neck and face, in shadow
  m.box(0, 1.66, 0, 0.29, 0.16, 0.31, 5);           // helmet
  m.box(0, 1.60, -0.14, 0.24, 0.07, 0.05, 5);       // visor

  // The rifle, carried across the body.
  m.box(0.18, 1.14, -0.30, 0.06, 0.09, 0.52, 7);
  m.box(0.18, 1.08, -0.16, 0.05, 0.14, 0.10, 7);

  // What is left when the cloth has gone. These are inside the body and
  // scaled away to nothing by the vertex shader unless this one has been
  // burnt, at which point the cloth and the webbing go instead and this is
  // all that is standing. Part 8, which the shader renders as charred bone.
  m.box(0, 1.16, 0, 0.055, 0.60, 0.055, 23);            // spine
  for (let i = 0; i < 5; i++) {
    const y = 1.00 + i * 0.105;
    const w = 0.30 - Math.abs(i - 2) * 0.03;
    m.box(0, y, 0, w, 0.035, 0.17, 23);                 // ribs
  }
  m.box(0, 0.88, 0, 0.26, 0.10, 0.16, 23);              // pelvis
  m.box(0, 1.47, 0, 0.075, 0.10, 0.075, 23);            // neck
  // The skull and the jaw have a part id of their own, so that a machine can
  // put an eye in the head without lighting up the whole skeleton.
  m.box(0, 1.60, 0, 0.19, 0.20, 0.20, 25);              // skull
  m.box(0, 1.56, -0.10, 0.13, 0.06, 0.04, 25);          // jaw
  for (const side of [-1, 1]) {
    m.box(side * 0.11, 0.42, 0, 0.065, 0.84, 0.065, 23);     // leg
    m.box(side * 0.11, 0.05, -0.04, 0.09, 0.07, 0.22, 23);   // foot
    m.box(side * 0.30, 1.16, -0.05, 0.055, 0.54, 0.055, 23); // arm
    m.box(side * 0.22, 1.42, 0, 0.17, 0.05, 0.05, 23);       // collarbone
  }

  // The beam rifle, which only a machine carries. It is in the same mesh as
  // everything else and the vertex shader collapses it for anyone who is not
  // one, the same trick the skeleton uses. The soldier's own rifle is cloth
  // side work and goes when the cloth goes, which is why a machine stood
  // there shooting with empty hands until this was put in.
  //
  // Held across the body in both hands, pointing where the body points, with
  // the emitter at the front as its own part so it can glow without the whole
  // gun glowing. MACHINE_MUZZLE below is where the beam comes out, in the
  // model's own coordinates, so the gun and the shot cannot drift apart.
  m.box(0.20, 1.16, -0.34, 0.085, 0.11, 0.86, 26);          // body
  m.box(0.20, 1.26, -0.20, 0.07, 0.10, 0.34, 26);           // sight rail
  m.box(0.20, 1.06, -0.12, 0.06, 0.16, 0.12, 26);           // grip
  m.box(0.20, 1.16, 0.18, 0.13, 0.15, 0.16, 26);            // power pack
  m.box(0.20, 1.16, -0.80, 0.055, 0.055, 0.14, 27);         // emitter

  // Horns, which only a demon has: two that sweep up and back from the
  // brow, collapsed to nothing on anybody else.
  for (const side of [-1, 1]) {
    m.box(side * 0.12, 1.76, 0.00, 0.06, 0.16, 0.06, 29, side * 0.3);
    m.box(side * 0.17, 1.88, 0.05, 0.045, 0.12, 0.045, 29, side * 0.5);
    m.box(side * 0.20, 1.97, 0.11, 0.03, 0.09, 0.03, 29, side * 0.6);
  }
  return m;
}

/**
 * Slayer's floating demon: a fat sphere of hide with one great eye in the
 * front, a mouth under it and two horns. Built facing -z like a drone, and
 * drawn through the same body shader. Parts 40 hide, 41 horn and mouth, 42
 * the eye.
 */
export function buildGazerMesh() {
  const m = new MeshBuild();
  m.icosphere(0, 0, 0, 1.15, 16, 10, 40);
  m.icosphere(0, 0.18, -0.95, 0.40, 12, 8, 42);
  m.box(0, -0.42, -0.95, 0.85, 0.16, 0.32, 41);
  for (const side of [-1, 1]) {
    m.box(side * 0.55, 0.95, -0.1, 0.16, 0.42, 0.16, 41, side * 0.4);
    m.box(side * 0.68, 1.25, 0.05, 0.10, 0.28, 0.10, 41, side * 0.6);
  }
  return m;
}

/**
 * Where a machine's beam comes out, in the body's own coordinates. The
 * renderer builds the gun around this point and main.js turns it into a world
 * position with the same rotation the vertex shader uses.
 */
export const MACHINE_MUZZLE = [0.20, 1.16, -0.88];

// The hip line of a mech, in its own coordinates. Everything below it is leg
// and swings; everything above it is torso and turns. The vertex shader uses
// the same number, which is why it is here rather than written twice.
export const MECH_HIP = 4.2;

/**
 * A mech. Eight metres, two legs, a turning torso with a chaingun on one arm
 * and a rocket pod on the other, and one lit eye.
 *
 * Built facing negative z with its feet at zero, like everything else here.
 * Part ids are chosen to land on materials the shared body shader already
 * has: 0 is hull plate, 2 is the lighter steel of a joint, 7 is gun metal, 12
 * is a scuffed plate, 24 is glass, and 1 is the glowing core, which the
 * vertex shader swaps for 11, the blue energy material, when the mech is
 * yours. That is the whole difference between a thing hunting you and the
 * thing you are standing in: one number per instance.
 */
/**
 * One chassis, as a mesh: the builder in `mechmeshes.js` for it, handed the
 * row out of the chassis table so that its guns are where the shots leave.
 */
export function buildChassisMesh(c) {
  const m = new MeshBuild();
  MECH_BUILDERS[c.id](m, c);
  return m;
}

/** The Warden, which is what the game called a mech before there were ten. */
export function buildMechMesh() { return buildChassisMesh(CHASSIS[0]); }

/**
 * Where a mech's guns are, in its own coordinates, for the game layer. These
 * are the same numbers the mesh above is built around, exported so that the
 * shot and the barrel it comes out of cannot drift apart.
 */
export const MECH_MUZZLE = {
  chaingun: [2.05, 5.60, -3.20],
  rockets: [-2.05, 6.30, -1.55],
};

// --- renderer --------------------------------------------------------------

export class Actors {
  constructor(gl, caps) {
    this.gl = gl;
    this.caps = caps;

    this.progDrone = createProgram(gl, DRONE_VS, DRONE_FS, 'drone');
    this.progDroneShadow = createProgram(gl, DRONE_SHADOW_VS, DRONE_SHADOW_FS, 'droneShadow');
    this.progSpark = createProgram(gl, SPARK_VS, SPARK_FS, 'spark');
    this.progViewmodel = createProgram(gl, VIEWMODEL_VS, VIEWMODEL_FS, 'viewmodel');

    // The drone shader samples the shadow cascades, so it has to be told which
    // texture units they are on. Left at the default of zero it samples a
    // sampler2DShadow from a unit holding an ordinary texture, and every draw
    // fails with INVALID_OPERATION and renders nothing at all.
    this.progDrone.use().int('uShadow0', 4).int('uShadow1', 5);
    this.progSoldier = createProgram(gl, SOLDIER_VS, SOLDIER_FS, 'soldier');
    this.progSoldierShadow = createProgram(gl, SOLDIER_SHADOW_VS, DRONE_SHADOW_FS, 'soldierShadow');
    this.progSoldier.use().int('uShadow0', 4).int('uShadow1', 5);
    // A mech rides the shared body shader with a transform of its own.
    this.progMech = createProgram(gl, MECH_VS, DRONE_FS, 'mech');
    this.progMech.use().int('uShadow0', 4).int('uShadow1', 5);
    this.progPickup = createProgram(gl, PICKUP_VS, DRONE_FS, 'pickup');
    this.progPickup.use().int('uShadow0', 4).int('uShadow1', 5);
    this.progGib = createProgram(gl, GIB_VS, DRONE_FS, 'gib');
    this.progGib.use().int('uShadow0', 4).int('uShadow1', 5);

    this.drone = this._uploadMesh(buildDroneMesh(), MAX_DRONES, 2);
    this.gazer = this._uploadMesh(buildGazerMesh(), MAX_DRONES, 2);
    // Three vec4s rather than two: the third carries how burnt they are,
    // which the walk and the fall had no room left for.
    this.soldier = this._uploadMesh(buildSoldierMesh(), MAX_SOLDIERS, 3);
    this.jet = this._uploadMesh(buildJetMesh(), MAX_JETS, 2);
    // Three vec4s: where it is and which way its legs point, then the stride,
    // the torso and the hit flash, then whether it is yours and how far over
    // it has gone.
    // A mesh per chassis, each with room for every mech there can be, since
    // nothing stops all eight on the street being the same one.
    this.mechMeshes = [...CHASSIS, WARLORD].map((c) => ({ chassis: c, mesh: this._uploadMesh(buildChassisMesh(c), MAX_MECHS, 3) }));
    this.mech = this.mechMeshes[0].mesh;
    // What you can get into. The fighter you can fly is the same mesh as the
    // ones that come after you, because it is the same aircraft.
    // Tactics camps, drawn through the same body shader as the vehicles.
    this.camp = this._uploadMesh(buildCampMesh(), MAX_CAMPS, 2);
    // Slayer's nests, through the same shader.
    this.nest = this._uploadMesh(buildNestMesh(), MAX_CAMPS, 2);
    // The traffic lights round you in .BACKDOOR, through the same shader.
    this.signal = this._uploadMesh(buildSignalMesh(), MAX_SIGNALS, 2);
    this.cover = this._uploadMesh(buildCoverMesh(), MAX_COVERS, 2);
    this.powerBox = this._uploadMesh(buildPowerBoxMesh(), MAX_BOXES, 2);
    this.atm = this._uploadMesh(buildAtmMesh(), MAX_ATMS, 2);
    this.bollard = this._uploadMesh(buildBollardMesh(), MAX_POSTS, 2);
    this.vehicles = {
      car: this._uploadMesh(buildCarMesh(), 24, 2),
      bus: this._uploadMesh(buildBusMesh(), 6, 2),
      jeep: this._uploadMesh(buildJeepMesh(), MAX_VEHICLES, 2),
      tank: this._uploadMesh(buildTankMesh(), MAX_VEHICLES, 2),
      heli: this._uploadMesh(buildHeliMesh(), MAX_VEHICLES, 2),
      jet: this._uploadMesh(buildJetMesh(), MAX_VEHICLES, 2),
      // Six carriages is two trains on the same stretch of viaduct, which is
      // more than Berlin manages at rush hour.
      train: this._uploadMesh(buildTrainMesh(), 6, 2),
    };
    // Every viewmodel is uploaded once. They are a few hundred triangles each,
    // so carrying all six costs less than switching would.
    this.weapons = {
      m16: this._uploadMesh(buildWeaponMesh(), 0, 0),
      shotgun: this._uploadMesh(buildShotgunMesh(), 0, 0),
      rpg: this._uploadMesh(buildRpgMesh(), 0, 0),
      grenade: this._uploadMesh(buildGrenadeMesh(), 0, 0),
      c4: this._uploadMesh(buildC4Mesh(), 0, 0),
      banana: this._uploadMesh(buildBananaMesh(), 0, 0),
      railgun: this._uploadMesh(buildRailgunMesh(), 0, 0),
      plasma: this._uploadMesh(buildPlasmaMesh(), 0, 0),
      flak: this._uploadMesh(buildFlakMesh(), 0, 0),
      splinter: this._uploadMesh(buildSplinterMesh(), 0, 0),
      sdpistol: this._uploadMesh(buildPistolMesh(), 0, 0),
      bow: this._uploadMesh(buildBowMesh(), 0, 0),
      bowTech: this._uploadMesh(buildTechBowMesh(), 0, 0),
      bowTactic: this._uploadMesh(buildTacticBowMesh(), 0, 0),
      marksman: this._uploadMesh(buildMarksmanMesh(), 0, 0),
      doublebarrel: this._uploadMesh(buildDoubleBarrelMesh(), 0, 0),
      chainsaw: this._uploadMesh(buildChainsawMesh(), 0, 0),
      shieldsaw: this._uploadMesh(buildShieldSawMesh(), 0, 0),
      flail: this._uploadMesh(buildFlailMesh(), 0, 0),
      void: this._uploadMesh(buildVoidMesh(), 0, 0),
      magnum: this._uploadMesh(buildMagnumMesh(), 0, 0),
      autoshotgun: this._uploadMesh(buildAutoShotgunMesh(), 0, 0),
      minigun: this._uploadMesh(buildMinigunMesh(), 0, 0),
      launcher: this._uploadMesh(buildLauncherMesh(), 0, 0),
      swarm: this._uploadMesh(buildSwarmMesh(), 0, 0),
      hailstorm: this._uploadMesh(buildHailstormMesh(), 0, 0),
      volt: this._uploadMesh(buildVoltMesh(), 0, 0),
      arbalest: this._uploadMesh(buildArbalestMesh(), 0, 0),
      ripper: this._uploadMesh(buildRipperMesh(), 0, 0),
      cling: this._uploadMesh(buildClingMesh(), 0, 0),
      blade: this._uploadMesh(buildBladeMesh(), 0, 0),
      hammer: this._uploadMesh(buildHammerMesh(), 0, 0),
      flare: this._uploadMesh(buildFlareMesh(), 0, 0),
      knife: this._uploadMesh(buildKnifeMesh(), 0, 0),
      baton: this._uploadMesh(buildBatonMesh(), 0, 0),
      bat: this._uploadMesh(buildBatMesh(), 0, 0),
      fists: this._uploadMesh(buildFistMesh(1), 0, 0),
      // Not weapons of their own: the left fist beside the right, and the
      // boot that comes up into view for a kick.
      fistL: this._uploadMesh(buildFistMesh(-1), 0, 0),
      boot: this._uploadMesh(buildBootMesh(), 0, 0),
    };
    this.weapon = this.weapons.m16;

    this.gib = this._uploadMesh(buildGibMesh(), MAX_GIBS, 2);
    // Rubble draws through the same program out of its own mesh.
    this.rubble = this._uploadMesh(buildRubbleMesh(), MAX_GIBS, 2);

    // The pads. One instanced mesh per kind, drawn only for what is near you.
    this.pickups = {};
    for (const kind of ['ammo', 'health', 'quad', 'ultra', 'overload']) {
      this.pickups[kind] = this._uploadMesh(buildPickupMesh(kind), MAX_PICKUPS, 2);
    }

    // The things in flight. One instanced mesh per kind, because a rocket and
    // a banana have nothing in common but the shader.
    this.props = {
      rocket: this._uploadMesh(buildProjectileMesh('rocket'), MAX_PROPS, 2),
      grenade: this._uploadMesh(buildProjectileMesh('grenade'), MAX_PROPS, 2),
      shell: this._uploadMesh(buildProjectileMesh('grenade'), MAX_PROPS, 2),
      c4: this._uploadMesh(buildProjectileMesh('c4'), MAX_PROPS, 2),
      plasma: this._uploadMesh(buildProjectileMesh('plasma'), MAX_PROPS, 2),
      flak: this._uploadMesh(buildProjectileMesh('flak'), MAX_PROPS, 2),
      splinter: this._uploadMesh(buildProjectileMesh('splinter'), MAX_PROPS, 2),
      banana: this._uploadMesh(buildProjectileMesh('banana'), MAX_PROPS, 2),
      nuke: this._uploadMesh(buildProjectileMesh('nuke'), 8, 2),
      void: this._uploadMesh(buildProjectileMesh('void'), 8, 2),
      voidStorm: this._uploadMesh(buildProjectileMesh('void'), MAX_STORM, 2),
      voidMaw: this._uploadMesh(buildProjectileMesh('voidMaw'), 8, 2),
      ultra: this._uploadMesh(buildProjectileMesh('ultra'), MAX_ULTRA, 2),
      blast: this._uploadMesh(buildProjectileMesh('blast'), MAX_PROPS, 2),
      ultraBlast: this._uploadMesh(buildProjectileMesh('ultraBlast'), MAX_ULTRA, 2),
      arrow: this._uploadMesh(buildProjectileMesh('arrow'), MAX_PROPS, 2),
      fireball: this._uploadMesh(buildProjectileMesh('fireball'), MAX_PROPS * 2, 2),
      shieldsaw: this._uploadMesh(buildProjectileMesh('shieldsaw'), 4, 2),
      bolt: this._uploadMesh(buildProjectileMesh('bolt'), MAX_PROPS, 2),
      cling: this._uploadMesh(buildProjectileMesh('cling'), MAX_PROPS, 2),
      disc: this._uploadMesh(buildProjectileMesh('disc'), MAX_PROPS, 2),
      flare: this._uploadMesh(buildProjectileMesh('flare'), MAX_PROPS, 2),
    };

    // Sparks are three vec4s per instance, six vertices drawn from gl_VertexID.
    // Two buffers rather than one, because the two halves need different blend
    // state: fire and tracers are added to the frame and blood is drawn over
    // it. WebGL2 has no base instance, so a single buffer could not be drawn
    // as two ranges without splitting the call by hand anyway.
    const makeSparkBuffer = () => {
      const data = new Float32Array(MAX_SPARKS * 12);
      const vao = gl.createVertexArray();
      const vbo = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      for (let k = 0; k < 3; k++) {
        const loc = 5 + k;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 48, k * 16);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
      return { data, vao, vbo, count: 0 };
    };
    this.sparks = makeSparkBuffer();
    this.blood = makeSparkBuffer();

    this.viewProj = mat4.create();
    this.viewMat = mat4.create();
    this.muzzle = 0;
  }

  _uploadMesh(build, instances, instanceVec4s) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(build.v), gl.STATIC_DRAW);
    const stride = 32;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    const use32 = build.n > 65535;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,
      use32 ? new Uint32Array(build.i) : new Uint16Array(build.i), gl.STATIC_DRAW);

    let instVbo = null;
    let instData = null;
    if (instances > 0) {
      instData = new Float32Array(instances * instanceVec4s * 4);
      instVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
      gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
      for (let k = 0; k < instanceVec4s; k++) {
        const loc = 5 + k;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, instanceVec4s * 16, k * 16);
        gl.vertexAttribDivisor(loc, 1);
      }
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    return {
      vao, vbo, ibo, instVbo, instData,
      count: build.i.length,
      indexType: use32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      instanceCount: 0,
      // How many of it the buffer was made for. The vehicles all had the same
      // ceiling until the carriages turned up with one of their own.
      maxInstances: instances,
    };
  }

  /** Pack the live drones into the instance buffer. */
  updateDrones(list) {
    const gl = this.gl;
    // A drone and a gazer are the same thing to the game and two meshes here.
    for (const mesh of [this.drone, this.gazer]) {
      const data = mesh.instData;
      const gazer = mesh === this.gazer;
      let n = 0;
      for (const d of list) {
        if (!d.alive || n >= MAX_DRONES || !!d.demon !== gazer) continue;
        const o = n * 8;
        data[o] = d.x; data[o + 1] = d.y; data[o + 2] = d.z; data[o + 3] = d.yaw;
        data[o + 4] = d.tilt; data[o + 5] = d.roll; data[o + 6] = d.hitFlash; data[o + 7] = d.rotor;
        n++;
      }
      mesh.instanceCount = n;
      if (n > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 8);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
    }
  }

  /** Sorts what is in the air into its per kind instance buffers. */
  updateProjectiles(list) {
    const gl = this.gl;
    const counts = { rocket: 0, grenade: 0, c4: 0, banana: 0, plasma: 0, flak: 0,
      splinter: 0, nuke: 0, void: 0, ultra: 0, blast: 0, ultraBlast: 0, voidStorm: 0, voidMaw: 0, arrow: 0, fireball: 0, shieldsaw: 0,
      bolt: 0, cling: 0, disc: 0, flare: 0 };
    for (const b of list) {
      const mesh = this.props[b.kind];
      if (!mesh || counts[b.kind] === undefined) continue;
      const cap = b.kind === 'nuke' || b.kind === 'void' || b.kind === 'voidMaw' ? 8
        : b.kind === 'ultra' || b.kind === 'ultraBlast' ? MAX_ULTRA
          : b.kind === 'voidStorm' ? MAX_STORM : b.kind === 'fireball' ? MAX_PROPS * 2
            : b.kind === 'shieldsaw' ? 4 : MAX_PROPS;
      if (counts[b.kind] >= cap) continue;
      const o = counts[b.kind] * 8;
      const d = mesh.instData;
      // A rocket points where it is going; everything else tumbles.
      const flying = b.kind === 'rocket' || b.kind === 'splinter' || b.kind === 'nuke'
        || b.kind === 'ultra' || b.kind === 'blast' || b.kind === 'ultraBlast' || b.kind === 'arrow'
        || b.kind === 'fireball' || b.kind === 'bolt' || b.kind === 'flare';
      // An arrow that has gone in keeps pointing the way it was going.
      const vx = b.stuck && b.fx !== undefined ? b.fx : b.vx;
      const vy = b.stuck && b.fx !== undefined ? b.fy : b.vy;
      const vz = b.stuck && b.fx !== undefined ? b.fz : b.vz;
      const yaw = flying ? Math.atan2(-vx, -vz) : b.spin * 0.7;
      const pitch = flying ? Math.asin(Math.max(-1, Math.min(1, vy
        / (Math.hypot(vx, vy, vz) || 1)))) : b.spin;
      // Negated for the shader, as the vehicles are: a rocket flying west was
      // drawn with its nose to the east.
      d[o] = b.x; d[o + 1] = b.y; d[o + 2] = b.z; d[o + 3] = -yaw;
      d[o + 4] = pitch; d[o + 5] = flying ? 0 : b.spin * 0.5; d[o + 6] = 0; d[o + 7] = 0;
      counts[b.kind]++;
    }
    for (const kind in this.props) {
      const mesh = this.props[kind];
      mesh.instanceCount = counts[kind];
      if (counts[kind] > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.instData, 0, counts[kind] * 8);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
    }
  }

  updateSoldiers(list) {
    const gl = this.gl;
    const data = this.soldier.instData;
    let n = 0;
    for (const s of list) {
      if (!s.alive || n >= MAX_SOLDIERS) continue;
      const o = n * 12;
      data[o] = s.x; data[o + 1] = s.y; data[o + 2] = s.z; data[o + 3] = s.yaw;
      // x carries the fall, which is both death and a banana, y the roll a
      // ragdoll picks up from the hit, w the walk phase.
      data[o + 4] = s.lean; data[o + 5] = s.roll || 0;
      data[o + 6] = s.hitFlash; data[o + 7] = s.walk;
      // x charred, y machine, z stunned: a machine is drawn as steel and its
      // eye goes out while an EMP has hold of it.
      data[o + 8] = s.charred || 0;
      // One for a machine; a demon sends its kind's code, two and up.
      // Five and six are theirs in The Hunt, the grunt and the stalker.
      data[o + 9] = s.machine ? 1 : (s.demon && s.dspec ? s.dspec.code : (s.look || 0));
      data[o + 10] = s.machine && s.stunLeft > 0 ? Math.min(1, s.stunLeft / 2)
        : (s.demon && s.staggered > 0 ? 1 : 0);
      // Nought for a soldier; for somebody who lives here, one plus which
      // coat he has on, which the shader reads out of the fraction.
      data[o + 11] = s.civilian ? 1 + Math.min(0.99, s.who || 0) : 0;
      n++;
    }
    this.soldier.instanceCount = n;
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.soldier.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  drawSoldiers() {
    if (!this.soldier.instanceCount) return 0;
    const gl = this.gl;
    this.progSoldier.use();
    gl.bindVertexArray(this.soldier.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.soldier.count, this.soldier.indexType, 0,
      this.soldier.instanceCount);
    gl.bindVertexArray(null);
    return 1;
  }

  updateJets(list) {
    const gl = this.gl;
    const data = this.jet.instData;
    let n = 0;
    for (const j of list) {
      if (!j.alive || n >= MAX_JETS) continue;
      const o = n * 8;
      // Negated for the same reason as the vehicles: see updateVehicles.
      data[o] = j.x; data[o + 1] = j.y; data[o + 2] = j.z; data[o + 3] = -j.yaw;
      data[o + 4] = j.pitch; data[o + 5] = j.roll; data[o + 6] = j.hitFlash;
      data[o + 7] = j.afterburner;
      n++;
    }
    this.jet.instanceCount = n;
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.jet.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  drawJets() {
    if (!this.jet.instanceCount) return 0;
    const gl = this.gl;
    // Jets bank and pitch, so they ride the drone transform, which already
    // does yaw, then roll, then pitch in that order.
    this.progDrone.use();
    gl.bindVertexArray(this.jet.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.jet.count, this.jet.indexType, 0,
      this.jet.instanceCount);
    gl.bindVertexArray(null);
    return 1;
  }

  /**
   * Packs the pads that are up and near enough to matter.
   * @param {Array} list live pads, each with x y z bob spin
   * @param {Float32Array|Array} camPos where you are, for the range cut
   */
  updatePickups(list, camPos) {
    const gl = this.gl;
    const counts = { ammo: 0, health: 0, quad: 0, ultra: 0, overload: 0 };
    const cx = camPos ? camPos[0] : 0;
    const cz = camPos ? camPos[2] : 0;
    for (const p of list) {
      const mesh = this.pickups[p.kind];
      if (!mesh || counts[p.kind] >= MAX_PICKUPS) continue;
      const dx = p.x - cx, dz = p.z - cz;
      if (dx * dx + dz * dz > PICKUP_RANGE * PICKUP_RANGE) continue;
      const o = counts[p.kind] * 8;
      const d = mesh.instData;
      d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z; d[o + 3] = p.spin;
      d[o + 4] = Math.sin(p.bob) * 0.13; d[o + 5] = 0; d[o + 6] = 0; d[o + 7] = 0;
      counts[p.kind]++;
    }
    for (const kind in this.pickups) {
      const mesh = this.pickups[kind];
      mesh.instanceCount = counts[kind];
      if (counts[kind] > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.instData, 0, counts[kind] * 8);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
    }
  }

  drawPickups() {
    const gl = this.gl;
    let draws = 0;
    this.progPickup.use();
    for (const kind in this.pickups) {
      const mesh = this.pickups[kind];
      if (!mesh.instanceCount) continue;
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.indexType, 0, mesh.instanceCount);
      draws++;
    }
    gl.bindVertexArray(null);
    return draws;
  }

  updateGibs(list) {
    const gl = this.gl;
    const flesh = this.gib.instData, stone = this.rubble.instData;
    let n = 0, k = 0;
    for (const g of list) {
      if (!g.alive) continue;
      // Broken render and brick are parts 21 and 22, and go to the rubble.
      const isStone = g.part > 20.5 && g.part < 22.5;
      if (isStone ? k >= MAX_GIBS : n >= MAX_GIBS) continue;
      const data = isStone ? stone : flesh;
      const o = (isStone ? k++ : n++) * 8;
      data[o] = g.x; data[o + 1] = g.y; data[o + 2] = g.z; data[o + 3] = g.yaw;
      data[o + 4] = g.pitch; data[o + 5] = g.roll; data[o + 6] = g.scale; data[o + 7] = g.part;
    }
    for (const [mesh, count] of [[this.gib, n], [this.rubble, k]]) {
      mesh.instanceCount = count;
      if (count > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.instData, 0, count * 8);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
    }
  }

  drawGibs() {
    if (!this.gib.instanceCount && !this.rubble.instanceCount) return 0;
    const gl = this.gl;
    this.progGib.use();
    let calls = 0;
    for (const mesh of [this.gib, this.rubble]) {
      if (!mesh.instanceCount) continue;
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.indexType, 0, mesh.instanceCount);
      calls++;
    }
    gl.bindVertexArray(null);
    return calls;
  }

  updateVehicles(list) {
    const gl = this.gl;
    const counts = { car: 0, bus: 0, jeep: 0, tank: 0, heli: 0, jet: 0, train: 0 };
    // The live ones first and the burnt out shells after, so a street full of
    // wrecks never leaves a car that is still driving without a body.
    const ordered = list.some((v) => v.health <= 0)
      ? [...list.filter((v) => !(v.health <= 0)), ...list.filter((v) => v.health <= 0)] : list;
    for (const v of ordered) {
      const mesh = this.vehicles[v.type];
      if (!v.alive || !mesh || counts[v.type] >= mesh.maxInstances) continue;
      const o = counts[v.type] * 8;
      const d = mesh.instData;
      d[o] = v.x; d[o + 1] = v.y; d[o + 2] = v.z;
      // A vehicle goes along (-sin yaw, -cos yaw), the same as the camera and
      // the bullets, and the body shader turns by rotY(-w), which puts a nose
      // built along -z at (sin w, -cos w). So it is handed the heading
      // negated. It was handed the heading itself, which is right going
      // north or south and wrong by everything else: a tank driving west was
      // drawn facing east, so W looked like reverse and A and D like each
      // other. A train's yaw is along its track, (sin, cos), and a carriage
      // is the same either way round, so it takes pi less it.
      d[o + 3] = v.type === 'train' ? Math.PI - v.yaw : -v.yaw;
      // Burning, it goes black over a couple of seconds; the flash channel
      // carries that below nought.
      d[o + 4] = v.pitch; d[o + 5] = v.roll;
      d[o + 6] = v.health > 0 ? v.hitFlash : -Math.min(1, 0.25 + (v.dying || 0) / 2.5);
      // A fighter has no rotor: the channel says whether its wheels are down,
      // as two or nought, the same way an enemy jet sends its afterburner in
      // nought to one, which leaves the gear of those always up.
      // A tank sends its turret's angle on the hull instead, which the shader
      // turns the turret's own parts by.
      // A car has neither, and sends which of the six paints it wears.
      d[o + 7] = v.type === 'jet' ? (v.gearDown === false ? 0 : 2)
        : (v.type === 'tank' ? (v.turret || 0) : (v.type === 'car' ? (v.paint || 0) : v.rotor));
      counts[v.type]++;
    }
    for (const type in this.vehicles) {
      const mesh = this.vehicles[type];
      mesh.instanceCount = counts[type];
      if (counts[type] > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.instData, 0, counts[type] * 8);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
    }
  }

  /** @param {Array} list live mechs */
  updateMechs(list) {
    const gl = this.gl;
    for (const { chassis, mesh } of this.mechMeshes) {
      const data = mesh.instData;
      let n = 0;
      for (const m of list) {
        if (!m.alive || n >= MAX_MECHS) continue;
        if ((m.spec.chassis || 'warden') !== chassis.id) continue;
        const o = n * 12;
        data[o] = m.x; data[o + 1] = m.y; data[o + 2] = m.z; data[o + 3] = m.yaw;
        // The torso angle is relative to the legs, because that is what the
        // shader turns it by.
        data[o + 4] = m.walk;
        data[o + 5] = m.torso - m.yaw;
        data[o + 6] = m.hitFlash;
        data[o + 7] = m.pitch;
        data[o + 8] = m.mine ? 1 : 0;
        data[o + 9] = m.health > 0 ? 0 : Math.min(1, (m.dying || 0) / 1.6);
        data[o + 10] = m.dashLeft > 0 ? 1 : 0;
        // How angry the Warlord is, for the glow of its heart and eyes.
        data[o + 11] = m.rage || 0;
        n++;
      }
      mesh.instanceCount = n;
      if (n > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 12);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
    }
  }

  /** How many mechs are drawn this frame, and how many triangles that is. */
  get mechStats() {
    let count = 0, tris = 0;
    for (const { mesh } of this.mechMeshes) {
      count += mesh.instanceCount;
      tris += mesh.instanceCount * (mesh.count / 3);
    }
    return { count, tris };
  }

  drawMechs() {
    const gl = this.gl;
    let draws = 0;
    for (const { chassis, mesh } of this.mechMeshes) {
      if (!mesh.instanceCount) continue;
      // Where its legs stop, and whether it walks on two or four, are the
      // chassis' own: the shader splits the mesh there.
      this.progMech.use()
        .float('uHip', chassis.hip)
        .float('uGait', chassis.gait === 'quad' ? 1 : 0)
        .float('uHipZ', chassis.hipZ || 0);
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.indexType, 0, mesh.instanceCount);
      draws++;
    }
    gl.bindVertexArray(null);
    return draws;
  }

  drawMechShadows(lightViewProj) {
    const gl = this.gl;
    let draws = 0;
    for (const { mesh } of this.mechMeshes) {
      if (!mesh.instanceCount) continue;
      this.progDroneShadow.use().mat4('uLightViewProj', lightViewProj);
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.indexType, 0, mesh.instanceCount);
      draws++;
    }
    gl.bindVertexArray(null);
    return draws;
  }

  /**
   * @param {{x:number,y:number,z:number,yaw:number,free:boolean,
   *   radioDown:boolean,alarm:boolean,flash:number}[]} list camps to draw
   */
  updateCamps(list) {
    const gl = this.gl;
    const mesh = this.camp;
    const d = mesh.instData;
    let n = 0;
    for (const c of list) {
      if (n >= MAX_CAMPS) break;
      const o = n * 8;
      d[o] = c.x; d[o + 1] = c.y; d[o + 2] = c.z;
      // Negated for the shader, as the vehicles are.
      d[o + 3] = -c.yaw;
      d[o + 4] = 0; d[o + 5] = 0; d[o + 6] = c.flash || 0;
      // Three switches in one channel: taken, radio down, alarm on.
      d[o + 7] = (c.free ? 1 : 0) + (c.radioDown ? 2 : 0) + (c.alarm ? 4 : 0) + (c.boxDown ? 8 : 0);
      n++;
    }
    mesh.instanceCount = n;
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  /** Slayer's nests: taken slumps them, awake makes the heart beat hard. */
  updateNests(list) {
    const gl = this.gl;
    const mesh = this.nest;
    const d = mesh.instData;
    let n = 0;
    for (const c of list) {
      if (n >= MAX_CAMPS) break;
      const o = n * 8;
      d[o] = c.x; d[o + 1] = c.y; d[o + 2] = c.z; d[o + 3] = -c.yaw;
      d[o + 4] = 0; d[o + 5] = 0; d[o + 6] = 0;
      d[o + 7] = (c.free ? 1 : 0) + (c.awake ? 2 : 0);
      n++;
    }
    mesh.instanceCount = n;
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  /** @param {{x:number,y:number,z:number,yaw:number,light:number}[]} list traffic lights to draw */
  updateSignals(list) { this._fillStreet(this.signal, MAX_SIGNALS, list); }

  /** @param {{x:number,y:number,z:number,yaw:number,light:number}[]} list covers in the road, light their state */
  updateCovers(list) { this._fillStreet(this.cover, MAX_COVERS, list); }

  /** Power boxes, ATMs and blocker posts, each with its state in the light channel. */
  updateBoxes(list) { this._fillStreet(this.powerBox, MAX_BOXES, list); }
  updateAtms(list) { this._fillStreet(this.atm, MAX_ATMS, list); }
  updateBollards(list) { this._fillStreet(this.bollard, MAX_POSTS, list); }

  _fillStreet(mesh, most, list) {
    const gl = this.gl;
    const d = mesh.instData;
    let n = 0;
    for (const c of list) {
      if (n >= most) break;
      const o = n * 8;
      d[o] = c.x; d[o + 1] = c.y; d[o + 2] = c.z; d[o + 3] = -c.yaw;
      d[o + 4] = 0; d[o + 5] = 0; d[o + 6] = 0;
      d[o + 7] = c.light;
      n++;
    }
    mesh.instanceCount = n;
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  drawCamps() {
    const gl = this.gl;
    let draws = 0;
    for (const mesh of [this.camp, this.nest, this.signal, this.cover, this.powerBox, this.atm, this.bollard]) {
      if (!mesh.instanceCount) continue;
      this.progDrone.use();
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.indexType, 0, mesh.instanceCount);
      draws++;
    }
    gl.bindVertexArray(null);
    return draws;
  }

  drawCampShadows(lightViewProj) {
    const gl = this.gl;
    let draws = 0;
    for (const mesh of [this.camp, this.nest, this.signal, this.cover, this.powerBox, this.atm, this.bollard]) {
      if (!mesh.instanceCount) continue;
      this.progDroneShadow.use().mat4('uLightViewProj', lightViewProj);
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.indexType, 0, mesh.instanceCount);
      draws++;
    }
    gl.bindVertexArray(null);
    return draws;
  }

  drawVehicles() {
    const gl = this.gl;
    let draws = 0;
    // They ride the drone transform, which already does yaw, then roll, then
    // pitch, and spins anything with part three as a rotor.
    this.progDrone.use();
    for (const type in this.vehicles) {
      const mesh = this.vehicles[type];
      if (!mesh.instanceCount) continue;
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.indexType, 0, mesh.instanceCount);
      draws++;
    }
    gl.bindVertexArray(null);
    return draws;
  }

  drawProjectiles() {
    const gl = this.gl;
    let draws = 0;
    this.progDrone.use();
    for (const kind in this.props) {
      const mesh = this.props[kind];
      if (!mesh.instanceCount) continue;
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.indexType, 0, mesh.instanceCount);
      draws++;
    }
    gl.bindVertexArray(null);
    return draws;
  }

  drawDrones() {
    const gl = this.gl;
    let draws = 0;
    for (const mesh of [this.drone, this.gazer]) {
      if (!mesh.instanceCount) continue;
      this.progDrone.use();
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.indexType, 0, mesh.instanceCount);
      draws++;
    }
    gl.bindVertexArray(null);
    return draws;
  }

  drawDroneShadows(lightViewProj) {
    const gl = this.gl;
    let draws = 0;
    for (const mesh of [this.drone, this.gazer]) {
      if (!mesh.instanceCount) continue;
      this.progDroneShadow.use().mat4('uLightViewProj', lightViewProj);
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.indexType, 0, mesh.instanceCount);
      draws++;
    }
    gl.bindVertexArray(null);
    return draws;
  }

  drawSoldierShadows(lightViewProj) {
    if (!this.soldier.instanceCount) return 0;
    const gl = this.gl;
    this.progSoldierShadow.use().mat4('uLightViewProj', lightViewProj);
    gl.bindVertexArray(this.soldier.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.soldier.count, this.soldier.indexType, 0,
      this.soldier.instanceCount);
    gl.bindVertexArray(null);
    return 1;
  }

  /** @param {Array} sparks entries from the effects pool */
  updateSparks(sparks) {
    const gl = this.gl;
    this.sparks.count = 0;
    this.blood.count = 0;
    for (const s of sparks) {
      if (!s.alive) continue;
      // Kinds three and four are blood and go in the other buffer.
      const into = s.kind > 2.5 ? this.blood : this.sparks;
      if (into.count >= MAX_SPARKS) continue;
      const o = into.count * 12;
      const data = into.data;
      data[o] = s.ax; data[o + 1] = s.ay; data[o + 2] = s.az; data[o + 3] = s.kind;
      data[o + 4] = s.bx; data[o + 5] = s.by; data[o + 6] = s.bz;
      data[o + 7] = Math.max(0, s.life / s.maxLife);
      data[o + 8] = s.r; data[o + 9] = s.g; data[o + 10] = s.b; data[o + 11] = s.size;
      into.count++;
    }
    for (const buf of [this.sparks, this.blood]) {
      if (!buf.count) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.data, 0, buf.count * 12);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** How many sparks of either sort are being drawn. */
  get sparkCount() { return this.sparks.count + this.blood.count; }

  drawSparks() {
    const gl = this.gl;
    if (!this.sparks.count && !this.blood.count) return 0;
    let draws = 0;
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    this.progSpark.use();
    if (this.sparks.count) {
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(this.sparks.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.sparks.count);
      draws++;
    }
    if (this.blood.count) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.blood.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.blood.count);
      draws++;
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.BLEND);
    return draws;
  }

  /**
   * The viewmodel, in its own narrow projection with a cleared depth buffer so
   * it can never poke through a wall.
   */
  drawViewmodel(aspect, pose, muzzle) {
    const gl = this.gl;
    const mesh = (pose.weapon && this.weapons[pose.weapon]) || this.weapons.m16;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    mat4.perspective(this.viewProj, 55 * Math.PI / 180, aspect, 0.004, 6);

    // Build the weapon transform: aim blend, sway, recoil kick and holster.
    const m = this.viewMat;
    mat4.identity(m);
    const t = mat4.create();
    mat4.fromTranslation(t, pose.x, pose.y, pose.z);
    mat4.multiply(m, m, t);
    rotate(m, pose.pitch, pose.yaw, pose.roll);

    this.progViewmodel.use()
      .mat4('uViewModelProj', this.viewProj)
      .mat4('uViewModelMat', m)
      .float('uMuzzle', muzzle)
      .float('uMuzzleSeed', pose.seed || 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
    // Anything else in view with it: the other fist, a boot coming up for a
    // kick. Each has its own place and turn, and no flash.
    let draws = 1;
    for (const e of pose.extras || []) {
      const em = this.weapons[e.weapon];
      if (!em) continue;
      mat4.identity(m);
      mat4.fromTranslation(t, e.x, e.y, e.z);
      mat4.multiply(m, m, t);
      rotate(m, e.pitch, e.yaw, e.roll);
      this.progViewmodel.mat4('uViewModelMat', m).float('uMuzzle', 0);
      gl.bindVertexArray(em.vao);
      gl.drawElements(gl.TRIANGLES, em.count, em.indexType, 0);
      draws++;
    }
    gl.bindVertexArray(null);
    return draws;
  }

  dispose() {
    const gl = this.gl;
    for (const mesh of [this.drone, this.soldier, this.jet, this.gib, this.rubble,
      ...this.mechMeshes.map((e) => e.mesh),
      ...Object.values(this.weapons),
      ...Object.values(this.props), ...Object.values(this.pickups),
      ...Object.values(this.vehicles)]) {
      gl.deleteVertexArray(mesh.vao);
      gl.deleteBuffer(mesh.vbo);
      gl.deleteBuffer(mesh.ibo);
      if (mesh.instVbo) gl.deleteBuffer(mesh.instVbo);
    }
    for (const buf of [this.sparks, this.blood]) {
      gl.deleteVertexArray(buf.vao);
      gl.deleteBuffer(buf.vbo);
    }
  }
}

const _rot = mat4.create();
function rotate(m, pitch, yaw, roll) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // Yaw, then pitch, then roll, written out rather than composed, because three
  // matrix multiplies per frame for one object is silly.
  _rot[0] = cy * cr + sy * sp * sr;
  _rot[1] = cp * sr;
  _rot[2] = -sy * cr + cy * sp * sr;
  _rot[3] = 0;
  _rot[4] = -cy * sr + sy * sp * cr;
  _rot[5] = cp * cr;
  _rot[6] = sy * sr + cy * sp * cr;
  _rot[7] = 0;
  _rot[8] = sy * cp;
  _rot[9] = -sp;
  _rot[10] = cy * cp;
  _rot[11] = 0;
  _rot[12] = 0; _rot[13] = 0; _rot[14] = 0; _rot[15] = 1;
  mat4.multiply(m, m, _rot);
}
