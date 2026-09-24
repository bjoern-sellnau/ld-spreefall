// Everything that moves: the drones, the tracers and sparks, and the weapon in
// your hands. All of the geometry is generated here in JavaScript, because the
// project ships no models.

import { createProgram } from '../engine/gl.js';
import { mat4 } from '../engine/math.js';
import {
  DRONE_VS, DRONE_FS, DRONE_SHADOW_VS, DRONE_SHADOW_FS,
  SPARK_VS, SPARK_FS, VIEWMODEL_VS, VIEWMODEL_FS, SOLDIER_VS, SOLDIER_SHADOW_VS,
} from '../shaders/actors.js';

const MAX_DRONES = 48;
const MAX_SPARKS = 256;
const MAX_PROPS = 32;
const MAX_SOLDIERS = 24;
const MAX_JETS = 6;

// --- mesh building ---------------------------------------------------------

/** True when the triangle's own normal agrees with the one it declares. */
function facesForward(a, b, c, n) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
  return gx * n[0] + gy * n[1] + gz * n[2] >= 0;
}

export class MeshBuild {
  constructor() { this.v = []; this.i = []; this.n = 0; }

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
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], part, 0);
    this.n++;
  }

  cylinder(cx, cy, cz, rBottom, rTop, h, seg, part, axis = 'y') {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const at = (c, s, r, t) => (axis === 'y'
        ? [cx + c * r, cy + t, cz + s * r]
        : [cx + c * r, cy + s * r, cz + t]);
      const nAt = (c, s) => (axis === 'y' ? [c, 0, s] : [c, s, 0]);
      this.quad(
        [at(c0, s0, rBottom, 0), at(c1, s1, rBottom, 0), at(c1, s1, rTop, h), at(c0, s0, rTop, h)],
        nAt((c0 + c1) / 2, (s0 + s1) / 2), part,
      );
    }
    // Caps.
    const capN = axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    for (const [r, t, sign] of [[rTop, h, 1], [rBottom, 0, -1]]) {
      if (r < 0.001) continue;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const at = (a, rr) => (axis === 'y'
          ? [cx + Math.cos(a) * rr, cy + t, cz + Math.sin(a) * rr]
          : [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, cz + t]);
        const centre = axis === 'y' ? [cx, cy + t, cz] : [cx, cy, cz + t];
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
 * The weapon, in view space: the eye is at the origin and the muzzle points
 * down -z. Laid out so the butt of the stock sits about ten centimetres in
 * front of the eye and the muzzle about ninety, which is what puts a rifle in
 * the lower right of the frame rather than across all of it.
 * Part ids: 0 receiver, 1 barrel, 2 polymer, 3 sight, 4 muzzle flash.
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
  // Flash cone at the muzzle. Invisible unless the shader is told otherwise.
  m.cylinder(0, 0.012, -0.894, 0.005, 0.070, -0.170, 10, 7, 'z');
  return m;
}

/**
 * The rest of what you can carry. Same parts palette as the rifle: 0 receiver,
 * 1 barrel steel, 2 polymer, 3 sight, 4 the flash cone the shader hides between
 * shots. Everything is measured in metres from the eye, muzzle towards -z.
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
  m.cylinder(0, 0.020, -0.802, 0.006, 0.090, -0.200, 10, 7, 'z');
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
  m.cylinder(0, 0.000, -0.902, 0.006, 0.130, -0.260, 10, 7, 'z');
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
  } else if (kind === 'flak') {
    m.box(0, 0, 0, 0.14, 0.10, 0.14, 8);
    m.box(0, 0, 0, 0.08, 0.18, 0.08, 8);
  } else if (kind === 'splinter') {
    m.box(0, 0, 0.06, 0.030, 0.030, 0.22, 11);
    m.box(0, 0, -0.10, 0.012, 0.012, 0.10, 8);
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
  m.cylinder(0, 0.014, -0.912, 0.004, 0.060, -0.150, 10, 7, 'z');
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
  m.cylinder(0, 0.006, -0.826, 0.005, 0.075, -0.170, 10, 7, 'z');
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
  m.cylinder(0, 0.010, -0.902, 0.006, 0.110, -0.220, 10, 7, 'z');
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
  m.cylinder(0, 0.004, -0.762, 0.004, 0.055, -0.140, 10, 7, 'z');
  return m;
}

/**
 * A fighter jet, built nose towards -z like everything else here, about
 * fourteen metres long. Parts: 0 airframe, 5 canopy, 8 intakes and nozzles,
 * 11 the afterburner glow.
 */
export function buildJetMesh() {
  const m = new MeshBuild();
  // Fuselage: a long box with a tapered nose made of two shrinking sections.
  m.box(0, 0, -1.2, 1.5, 1.3, 7.0, 0);
  m.box(0, 0.05, -5.2, 1.1, 0.95, 1.2, 0);
  m.box(0, 0.05, -6.1, 0.7, 0.6, 0.8, 0);
  m.cylinder(0, 0.05, -6.5, 0.32, 0.04, -0.9, 8, 0, 'z');      // the nose
  // Canopy.
  m.box(0, 0.72, -3.4, 0.85, 0.5, 2.2, 5);
  // Wings, swept back by offsetting each panel further aft as it goes out.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      m.box(side * (1.0 + t * 3.4), -0.05, -0.4 + t * 2.4,
        0.9, 0.22 - t * 0.1, 3.2 - t * 1.9, 0);
    }
    // Tailplane and fin.
    m.box(side * 1.3, 0.1, 2.6, 1.6, 0.18, 1.5, 0);
    m.box(side * 0.55, 1.1, 2.3, 0.16, 1.9, 2.0, 0);
    // Intake under the wing root.
    m.box(side * 0.95, -0.45, -2.2, 0.55, 0.6, 2.6, 8);
    // Engine nozzle at the back, with the glow inside it.
    m.cylinder(side * 0.45, 0, 2.3, 0.42, 0.46, 0.9, 10, 8, 'z');
    m.cylinder(side * 0.45, 0, 2.9, 0.34, 0.30, 0.5, 10, 11, 'z');
  }
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
  return m;
}

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
    this.progSoldier = createProgram(gl, SOLDIER_VS, DRONE_FS, 'soldier');
    this.progSoldierShadow = createProgram(gl, SOLDIER_SHADOW_VS, DRONE_SHADOW_FS, 'soldierShadow');
    this.progSoldier.use().int('uShadow0', 4).int('uShadow1', 5);

    this.drone = this._uploadMesh(buildDroneMesh(), MAX_DRONES, 2);
    this.soldier = this._uploadMesh(buildSoldierMesh(), MAX_SOLDIERS, 2);
    this.jet = this._uploadMesh(buildJetMesh(), MAX_JETS, 2);
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
    };
    this.weapon = this.weapons.m16;

    // The things in flight. One instanced mesh per kind, because a rocket and
    // a banana have nothing in common but the shader.
    this.props = {
      rocket: this._uploadMesh(buildProjectileMesh('rocket'), MAX_PROPS, 2),
      grenade: this._uploadMesh(buildProjectileMesh('grenade'), MAX_PROPS, 2),
      c4: this._uploadMesh(buildProjectileMesh('c4'), MAX_PROPS, 2),
      plasma: this._uploadMesh(buildProjectileMesh('plasma'), MAX_PROPS, 2),
      flak: this._uploadMesh(buildProjectileMesh('flak'), MAX_PROPS, 2),
      splinter: this._uploadMesh(buildProjectileMesh('splinter'), MAX_PROPS, 2),
      banana: this._uploadMesh(buildProjectileMesh('banana'), MAX_PROPS, 2),
    };

    // Sparks are three vec4s per instance, six vertices drawn from gl_VertexID.
    this.sparkData = new Float32Array(MAX_SPARKS * 12);
    this.sparkCount = 0;
    this.sparkVao = gl.createVertexArray();
    this.sparkVbo = gl.createBuffer();
    gl.bindVertexArray(this.sparkVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sparkVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.sparkData.byteLength, gl.DYNAMIC_DRAW);
    for (let k = 0; k < 3; k++) {
      const loc = 5 + k;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 48, k * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);

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
    };
  }

  /** Pack the live drones into the instance buffer. */
  updateDrones(list) {
    const gl = this.gl;
    const data = this.drone.instData;
    let n = 0;
    for (const d of list) {
      if (!d.alive || n >= MAX_DRONES) continue;
      const o = n * 8;
      data[o] = d.x; data[o + 1] = d.y; data[o + 2] = d.z; data[o + 3] = d.yaw;
      data[o + 4] = d.tilt; data[o + 5] = d.roll; data[o + 6] = d.hitFlash; data[o + 7] = d.rotor;
      n++;
    }
    this.drone.instanceCount = n;
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.drone.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  /** Sorts what is in the air into its per kind instance buffers. */
  updateProjectiles(list) {
    const gl = this.gl;
    const counts = { rocket: 0, grenade: 0, c4: 0, banana: 0, plasma: 0, flak: 0, splinter: 0 };
    for (const b of list) {
      const mesh = this.props[b.kind];
      if (!mesh || counts[b.kind] >= MAX_PROPS) continue;
      const o = counts[b.kind] * 8;
      const d = mesh.instData;
      // A rocket points where it is going; everything else tumbles.
      const flying = b.kind === 'rocket' || b.kind === 'splinter';
      const yaw = flying ? Math.atan2(-b.vx, -b.vz) : b.spin * 0.7;
      const pitch = flying ? Math.asin(Math.max(-1, Math.min(1, b.vy
        / (Math.hypot(b.vx, b.vy, b.vz) || 1)))) : b.spin;
      d[o] = b.x; d[o + 1] = b.y; d[o + 2] = b.z; d[o + 3] = yaw;
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
      const o = n * 8;
      data[o] = s.x; data[o + 1] = s.y; data[o + 2] = s.z; data[o + 3] = s.yaw;
      // x carries the fall, which is both death and a banana, y the walk phase.
      data[o + 4] = s.lean; data[o + 5] = 0; data[o + 6] = s.hitFlash; data[o + 7] = s.walk;
      n++;
    }
    this.soldier.instanceCount = n;
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.soldier.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 8);
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
      data[o] = j.x; data[o + 1] = j.y; data[o + 2] = j.z; data[o + 3] = j.yaw;
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
    if (!this.drone.instanceCount) return 0;
    const gl = this.gl;
    this.progDrone.use();
    gl.bindVertexArray(this.drone.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.drone.count, this.drone.indexType, 0,
      this.drone.instanceCount);
    gl.bindVertexArray(null);
    return 1;
  }

  drawDroneShadows(lightViewProj) {
    if (!this.drone.instanceCount) return 0;
    const gl = this.gl;
    this.progDroneShadow.use().mat4('uLightViewProj', lightViewProj);
    gl.bindVertexArray(this.drone.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.drone.count, this.drone.indexType, 0,
      this.drone.instanceCount);
    gl.bindVertexArray(null);
    return 1;
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
    const data = this.sparkData;
    let n = 0;
    for (const s of sparks) {
      if (!s.alive || n >= MAX_SPARKS) continue;
      const o = n * 12;
      data[o] = s.ax; data[o + 1] = s.ay; data[o + 2] = s.az; data[o + 3] = s.kind;
      data[o + 4] = s.bx; data[o + 5] = s.by; data[o + 6] = s.bz;
      data[o + 7] = Math.max(0, s.life / s.maxLife);
      data[o + 8] = s.r; data[o + 9] = s.g; data[o + 10] = s.b; data[o + 11] = s.size;
      n++;
    }
    this.sparkCount = n;
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sparkVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  drawSparks() {
    if (!this.sparkCount) return 0;
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    this.progSpark.use();
    gl.bindVertexArray(this.sparkVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.sparkCount);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    return 1;
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
      .float('uMuzzle', muzzle);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
    gl.bindVertexArray(null);
    return 1;
  }

  dispose() {
    const gl = this.gl;
    for (const mesh of [this.drone, this.soldier, this.jet, ...Object.values(this.weapons),
      ...Object.values(this.props)]) {
      gl.deleteVertexArray(mesh.vao);
      gl.deleteBuffer(mesh.vbo);
      gl.deleteBuffer(mesh.ibo);
      if (mesh.instVbo) gl.deleteBuffer(mesh.instVbo);
    }
    gl.deleteVertexArray(this.sparkVao);
    gl.deleteBuffer(this.sparkVbo);
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
