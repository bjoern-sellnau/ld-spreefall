// Everything that moves: the drones, the tracers and sparks, and the weapon in
// your hands. All of the geometry is generated here in JavaScript, because the
// project ships no models.

import { createProgram } from '../engine/gl.js';
import { mat4 } from '../engine/math.js';
import {
  DRONE_VS, DRONE_FS, DRONE_SHADOW_VS, DRONE_SHADOW_FS,
  SPARK_VS, SPARK_FS, VIEWMODEL_VS, VIEWMODEL_FS, SOLDIER_VS, SOLDIER_FS, SOLDIER_SHADOW_VS,
  PICKUP_VS, GIB_VS,
} from '../shaders/actors.js';

const MAX_DRONES = 48;
const MAX_SPARKS = 512;
const MAX_PROPS = 32;
const MAX_SOLDIERS = 24;
const MAX_JETS = 6;
const MAX_VEHICLES = 8;
const MAX_PICKUPS = 16;
const MAX_GIBS = 96;
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
 * A jeep, about four and a half metres long, nose towards -z like everything
 * else here. Parts: 0 hull, 2 arms for the frame, 6 webbing for the canvas,
 * 8 ordnance steel for the gun, 24 glass.
 */
export function buildJeepMesh() {
  const m = new MeshBuild();
  m.box(0, 0.75, -0.1, 1.95, 0.55, 4.10, 0);          // body
  m.box(0, 1.08, 0.75, 1.80, 0.45, 1.70, 0);          // rear deck
  m.box(0, 1.20, -1.05, 1.70, 0.35, 1.40, 24);        // windscreen and cab
  m.box(0, 0.52, -1.95, 1.90, 0.40, 0.30, 0);         // front bumper
  m.box(0, 1.15, -2.05, 1.60, 0.45, 0.14, 24);        // grille
  for (const side of [-1, 1]) {
    // Wheels, as short cylinders lying on their side.
    for (const z of [-1.35, 1.25]) {
      m.cylinder(side * 0.98, 0.45, z, 0.45, 0.45, side * 0.26, 10, 2, 'y');
    }
    m.box(side * 0.92, 1.35, 0.55, 0.10, 0.90, 0.10, 2);   // roll bar
  }
  m.box(0, 1.82, 0.55, 1.90, 0.10, 0.10, 2);
  // The mounted gun on the back.
  m.cylinder(0, 1.95, 0.30, 0.10, 0.10, 0.55, 8, 8, 'y');
  m.box(0, 2.30, -0.20, 0.16, 0.16, 1.40, 8);
  m.box(0, 2.30, 0.45, 0.34, 0.26, 0.40, 8);
  return m;
}

/**
 * A tank, seven and a half metres long with the gun over the front. Parts:
 * 0 hull, 2 track steel, 8 the barrel.
 */
export function buildTankMesh() {
  const m = new MeshBuild();
  m.box(0, 1.15, 0, 3.10, 0.80, 6.40, 0);             // hull
  m.box(0, 1.70, 0.10, 2.70, 0.40, 4.60, 0);          // glacis
  m.box(0, 2.15, 0.40, 2.10, 0.60, 2.60, 0);          // turret
  m.box(0, 2.55, 0.80, 1.10, 0.30, 1.20, 0);          // cupola
  m.cylinder(0, 2.30, -0.85, 0.17, 0.14, -3.60, 10, 8, 'z');   // barrel
  m.box(0, 2.30, -1.20, 0.46, 0.46, 0.55, 8);         // mantlet
  for (const side of [-1, 1]) {
    m.box(side * 1.62, 0.70, 0, 0.55, 1.10, 6.60, 2);      // track
    for (let i = 0; i < 5; i++) {
      m.cylinder(side * 1.62, 0.62, -2.4 + i * 1.2, 0.46, 0.46, side * 0.1, 8, 2, 'y');
    }
  }
  return m;
}

/**
 * A helicopter: a bulbous cab, a tail boom, and two rotor discs. Parts:
 * 0 hull, 24 glass, 3 the blurred rotor, 8 the skids and the gun.
 */
export function buildHeliMesh() {
  const m = new MeshBuild();
  m.box(0, 1.60, -0.40, 2.00, 1.70, 3.60, 0);         // cab
  m.box(0, 1.85, -2.10, 1.50, 1.20, 1.10, 24);        // canopy
  m.box(0, 1.90, 1.90, 0.80, 0.70, 3.40, 0);          // tail boom
  m.box(0, 2.35, 3.45, 0.22, 1.30, 0.80, 0);          // fin
  m.box(0, 1.95, 3.30, 1.40, 0.16, 0.60, 0);          // tailplane
  // Main rotor: a mast and a wide thin disc.
  m.cylinder(0, 2.45, -0.40, 0.14, 0.12, 0.60, 8, 8, 'y');
  m.ring(0, 3.10, -0.40, 0.25, 5.40, 18, 3);
  // Tail rotor, standing on its side.
  for (let i = 0; i < 14; i++) {
    const a0 = (i / 14) * Math.PI * 2, a1 = ((i + 1) / 14) * Math.PI * 2;
    const at = (a, r) => [0.42, 2.30 + Math.sin(a) * r, 3.45 + Math.cos(a) * r];
    m.quad([at(a0, 0.2), at(a1, 0.2), at(a1, 1.1), at(a0, 1.1)], [1, 0, 0], 3);
    m.quad([at(a0, 1.1), at(a1, 1.1), at(a1, 0.2), at(a0, 0.2)], [-1, 0, 0], 3);
  }
  for (const side of [-1, 1]) {
    m.box(side * 1.05, 0.12, -0.30, 0.14, 0.14, 3.20, 8);   // skid
    m.box(side * 0.70, 0.65, -0.90, 0.10, 1.05, 0.10, 8);
    m.box(side * 0.70, 0.65, 0.70, 0.10, 1.05, 0.10, 8);
  }
  m.box(0, 0.95, -2.30, 0.40, 0.34, 0.90, 8);         // chin gun
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
  return m;
}

/**
 * Where a machine's beam comes out, in the body's own coordinates. The
 * renderer builds the gun around this point and main.js turns it into a world
 * position with the same rotation the vertex shader uses.
 */
export const MACHINE_MUZZLE = [0.20, 1.16, -0.88];

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
    this.progPickup = createProgram(gl, PICKUP_VS, DRONE_FS, 'pickup');
    this.progPickup.use().int('uShadow0', 4).int('uShadow1', 5);
    this.progGib = createProgram(gl, GIB_VS, DRONE_FS, 'gib');
    this.progGib.use().int('uShadow0', 4).int('uShadow1', 5);

    this.drone = this._uploadMesh(buildDroneMesh(), MAX_DRONES, 2);
    // Three vec4s rather than two: the third carries how burnt they are,
    // which the walk and the fall had no room left for.
    this.soldier = this._uploadMesh(buildSoldierMesh(), MAX_SOLDIERS, 3);
    this.jet = this._uploadMesh(buildJetMesh(), MAX_JETS, 2);
    // What you can get into. The fighter you can fly is the same mesh as the
    // ones that come after you, because it is the same aircraft.
    this.vehicles = {
      jeep: this._uploadMesh(buildJeepMesh(), MAX_VEHICLES, 2),
      tank: this._uploadMesh(buildTankMesh(), MAX_VEHICLES, 2),
      heli: this._uploadMesh(buildHeliMesh(), MAX_VEHICLES, 2),
      jet: this._uploadMesh(buildJetMesh(), MAX_VEHICLES, 2),
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
    };
    this.weapon = this.weapons.m16;

    this.gib = this._uploadMesh(buildGibMesh(), MAX_GIBS, 2);

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
      c4: this._uploadMesh(buildProjectileMesh('c4'), MAX_PROPS, 2),
      plasma: this._uploadMesh(buildProjectileMesh('plasma'), MAX_PROPS, 2),
      flak: this._uploadMesh(buildProjectileMesh('flak'), MAX_PROPS, 2),
      splinter: this._uploadMesh(buildProjectileMesh('splinter'), MAX_PROPS, 2),
      banana: this._uploadMesh(buildProjectileMesh('banana'), MAX_PROPS, 2),
      nuke: this._uploadMesh(buildProjectileMesh('nuke'), 8, 2),
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
    const counts = { rocket: 0, grenade: 0, c4: 0, banana: 0, plasma: 0, flak: 0,
      splinter: 0, nuke: 0 };
    for (const b of list) {
      const mesh = this.props[b.kind];
      if (!mesh || counts[b.kind] === undefined) continue;
      if (counts[b.kind] >= (b.kind === 'nuke' ? 8 : MAX_PROPS)) continue;
      const o = counts[b.kind] * 8;
      const d = mesh.instData;
      // A rocket points where it is going; everything else tumbles.
      const flying = b.kind === 'rocket' || b.kind === 'splinter' || b.kind === 'nuke';
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
      const o = n * 12;
      data[o] = s.x; data[o + 1] = s.y; data[o + 2] = s.z; data[o + 3] = s.yaw;
      // x carries the fall, which is both death and a banana, y the roll a
      // ragdoll picks up from the hit, w the walk phase.
      data[o + 4] = s.lean; data[o + 5] = s.roll || 0;
      data[o + 6] = s.hitFlash; data[o + 7] = s.walk;
      // x charred, y machine, z stunned: a machine is drawn as steel and its
      // eye goes out while an EMP has hold of it.
      data[o + 8] = s.charred || 0;
      data[o + 9] = s.machine ? 1 : 0;
      data[o + 10] = s.machine && s.stunLeft > 0 ? Math.min(1, s.stunLeft / 2) : 0;
      data[o + 11] = 0;
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
    const data = this.gib.instData;
    let n = 0;
    for (const g of list) {
      if (!g.alive || n >= MAX_GIBS) continue;
      const o = n * 8;
      data[o] = g.x; data[o + 1] = g.y; data[o + 2] = g.z; data[o + 3] = g.yaw;
      data[o + 4] = g.pitch; data[o + 5] = g.roll; data[o + 6] = g.scale; data[o + 7] = g.part;
      n++;
    }
    this.gib.instanceCount = n;
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gib.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  drawGibs() {
    if (!this.gib.instanceCount) return 0;
    const gl = this.gl;
    this.progGib.use();
    gl.bindVertexArray(this.gib.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.gib.count, this.gib.indexType, 0,
      this.gib.instanceCount);
    gl.bindVertexArray(null);
    return 1;
  }

  updateVehicles(list) {
    const gl = this.gl;
    const counts = { jeep: 0, tank: 0, heli: 0, jet: 0 };
    for (const v of list) {
      const mesh = this.vehicles[v.type];
      if (!v.alive || !mesh || counts[v.type] >= MAX_VEHICLES) continue;
      const o = counts[v.type] * 8;
      const d = mesh.instData;
      d[o] = v.x; d[o + 1] = v.y; d[o + 2] = v.z; d[o + 3] = v.yaw;
      d[o + 4] = v.pitch; d[o + 5] = v.roll; d[o + 6] = v.hitFlash; d[o + 7] = v.rotor;
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
    for (const mesh of [this.drone, this.soldier, this.jet, this.gib,
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
