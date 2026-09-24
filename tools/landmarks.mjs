// Bespoke shapes for the buildings people came to see. Each one takes the OSM
// footprint and builds something with the right silhouette, because a flat
// extrusion of the Brandenburg Gate footprint is a shoebox and everyone can tell.

import { MAT, FACADE_FLAG } from '../src/shared/constants.js';
import {
  extrudeBuilding, box, cylinder, dome, sphere, spire, colonnade,
  orientedBox, ringCentroid, flatRoof,
} from './geometry.mjs';

const LM = FACADE_FLAG.LANDMARK | FACADE_FLAG.NO_WINDOWS;

export const LANDMARK_BUILDERS = {
  gate: brandenburgGate,
  reichstag: reichstag,
  cathedral: berlinerDom,
  tv_tower: fernsehturm,
  palace: humboldtForum,
  temple: templeFront,
  tower_dome: towerDome,
  rotunda: rotunda,
  dome_block: domeBlock,
  church: church,
  town_hall: townHall,
  tower: plainTower,
  glass_tower: glassTower,
  glass_block: glassBlock,
  slab_tower: slabTower,
  courtyard: null,   // handled by the normal extruder, it already has a hole
  block: null,
};

function frame(ring) {
  const b = orientedBox(ring);
  const [cx, cz] = ringCentroid(ring);
  return { ...b, cx, cz };
}

// The Gate: twelve Doric columns in two rows of six, an attic, and the quadriga.
function brandenburgGate(mesh, ring, base, def) {
  const f = frame(ring);
  const long = f.lu >= f.lv;
  const L = long ? f.lu : f.lv;          // 65.5 m span
  const W = long ? f.lv : f.lu;          // 11 m depth
  const ax = long ? f.ux : f.vx, az = long ? f.uz : f.vz;
  const bx = long ? f.vx : f.ux, bz = long ? f.vz : f.uz;
  const seed = 3;
  const colH = 15.0;
  const halfL = L / 2, halfW = W / 2;
  const P = (a, b) => [f.cx + ax * a + bx * b, f.cz + az * a + bz * b];

  // Stylobate.
  const [sx, sz] = P(0, 0);
  box(mesh, sx, base - 0.6, sz, L, 0.7, W, MAT.SANDSTONE, { seed, rot: Math.atan2(az, ax), flags: LM });

  for (const side of [-1, 1]) {
    const [x0, z0] = P(-halfL + 3.0, side * (halfW - 2.4));
    const [x1, z1] = P(halfL - 3.0, side * (halfW - 2.4));
    colonnade(mesh, base + 0.1, x0, z0, x1, z1, 6, 1.05, colH, MAT.SANDSTONE, seed);
  }
  // Four cross walls divide the five passages. The middle one stays open, it is
  // the carriageway the Gate was built around.
  const inner = L - 6.0;
  for (let i = 1; i < 5; i++) {
    const t = -halfL + 3.0 + (i * inner) / 5;
    const [wx, wz] = P(t, 0);
    box(mesh, wx, base + 0.1, wz, 1.6, colH, W - 3.0, MAT.SANDSTONE, { seed, rot: Math.atan2(az, ax), flags: LM });
  }
  // Entablature and attic.
  const [ex, ez] = P(0, 0);
  const rot = Math.atan2(az, ax);
  box(mesh, ex, base + colH + 0.55, ez, L, 2.4, W, MAT.SANDSTONE, { seed, rot, flags: LM });
  box(mesh, ex, base + colH + 2.95, ez, L * 0.88, 5.6, W * 0.82, MAT.SANDSTONE, { seed, rot, flags: LM });
  // Quadriga: a plinth, four horses abstracted as blocks, and the chariot.
  const qy = base + colH + 8.55;
  box(mesh, ex, qy, ez, 12.5, 0.7, 4.2, MAT.COPPER, { seed, rot, flags: LM });
  for (let i = 0; i < 4; i++) {
    const [hx, hz] = P(-4.2 + i * 2.6, -0.4);
    box(mesh, hx, qy + 0.7, hz, 1.5, 2.6, 3.6, MAT.COPPER, { seed, rot, flags: LM });
    box(mesh, hx, qy + 3.0, hz - 0.0, 1.1, 1.0, 1.4, MAT.COPPER, { seed, rot, flags: LM });
  }
  const [chx, chz] = P(4.6, 0.2);
  box(mesh, chx, qy + 0.7, chz, 2.6, 2.2, 3.0, MAT.COPPER, { seed, rot, flags: LM });
  box(mesh, chx, qy + 2.9, chz, 0.8, 2.2, 0.8, MAT.COPPER, { seed, rot, flags: LM });
}

// The Reichstag: a stone block with corner towers, a portico and Foster's dome.
function reichstag(mesh, ring, base, def) {
  const f = frame(ring);
  const rot = Math.atan2(f.uz, f.ux);
  const seed = 11;
  const H = 30;
  extrudeBuilding(mesh, { outer: ring, holes: [] }, {
    base, height: H, roofShape: 'flat', wallMat: MAT.SANDSTONE, roofMat: MAT.SANDSTONE,
    seed, levels: 5, landmark: true, noWindows: false, parapet: true,
  });
  const hu = f.lu / 2, hv = f.lv / 2;
  const P = (u, v) => [f.cx + u * f.ux + v * f.vx, f.cz + u * f.uz + v * f.vz];
  // Four corner towers.
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [tx, tz] = P(su * (hu - 7), sv * (hv - 7));
    box(mesh, tx, base + H, tz, 15, 10, 15, MAT.SANDSTONE, { seed, rot, flags: LM });
    spire(mesh, tx, base + H + 10, tz, 15, 5.5, MAT.SANDSTONE, { seed, rot, flags: LM });
  }
  // West portico.
  const [px, pz] = P(-hu - 3.0, 0);
  const [c0x, c0z] = P(-hu - 3.0, -12);
  const [c1x, c1z] = P(-hu - 3.0, 12);
  colonnade(mesh, base, c0x, c0z, c1x, c1z, 6, 1.35, 21, MAT.SANDSTONE, seed);
  box(mesh, px, base + 22.4, pz, 7, 3.0, 30, MAT.SANDSTONE, { seed, rot, flags: LM });
  spire(mesh, px, base + 25.4, pz, 26, 5.0, MAT.SANDSTONE, { seed, rot: rot + Math.PI / 4, flags: LM });
  // The dome: a glass drum and a shallow cap, with the inner cone.
  cylinder(mesh, f.cx, base + H + 1.0, f.cz, 19, 19, 3.0, 28, MAT.SANDSTONE, { seed, flags: LM, capTop: false });
  cylinder(mesh, f.cx, base + H + 4.0, f.cz, 18, 17, 9.0, 28, MAT.GLASS, { seed, flags: LM, capTop: false });
  dome(mesh, f.cx, base + H + 13.0, f.cz, 17, 11.5, 28, 8, MAT.GLASS, { seed, flags: LM });
  cylinder(mesh, f.cx, base + H + 4.0, f.cz, 5.5, 1.2, 14.0, 16, MAT.METAL, { seed, flags: LM });
}

// The Cathedral: a cruciform block, a big copper dome on a drum, four corner
// turrets with their own little domes.
function berlinerDom(mesh, ring, base, def) {
  const f = frame(ring);
  const rot = Math.atan2(f.uz, f.ux);
  const seed = 17;
  const H = 38;
  extrudeBuilding(mesh, { outer: ring, holes: [] }, {
    base, height: H, roofShape: 'flat', wallMat: MAT.SANDSTONE, roofMat: MAT.SANDSTONE,
    seed, levels: 4, landmark: true, parapet: true,
  });
  const hu = f.lu / 2, hv = f.lv / 2;
  const P = (u, v) => [f.cx + u * f.ux + v * f.vx, f.cz + u * f.uz + v * f.vz];
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [tx, tz] = P(su * (hu - 10), sv * (hv - 10));
    cylinder(mesh, tx, base + H, tz, 6.5, 6.0, 9, 14, MAT.SANDSTONE, { seed, flags: LM, capTop: false });
    dome(mesh, tx, base + H + 9, tz, 6.4, 7.5, 14, 6, MAT.COPPER, { seed, flags: LM });
    cylinder(mesh, tx, base + H + 16.5, tz, 0.4, 0.2, 4.5, 6, MAT.METAL, { seed, flags: LM });
  }
  cylinder(mesh, f.cx, base + H, f.cz, 17.5, 17.0, 14, 30, MAT.SANDSTONE, { seed, flags: LM, capTop: false });
  dome(mesh, f.cx, base + H + 14, f.cz, 17.0, 22.0, 30, 10, MAT.COPPER, { seed, flags: LM, onion: 0.06 });
  cylinder(mesh, f.cx, base + H + 35.5, f.cz, 3.2, 2.6, 4.5, 14, MAT.COPPER, { seed, flags: LM, capTop: false });
  dome(mesh, f.cx, base + H + 40.0, f.cz, 2.6, 3.0, 14, 5, MAT.COPPER, { seed, flags: LM });
  cylinder(mesh, f.cx, base + H + 43.0, f.cz, 0.35, 0.15, 6.0, 6, MAT.METAL, { seed, flags: LM });
  box(mesh, f.cx, base + H + 47.5, f.cz, 0.4, 2.6, 0.4, MAT.METAL, { seed, flags: LM });
  box(mesh, f.cx, base + H + 49.4, f.cz, 1.6, 0.4, 0.4, MAT.METAL, { seed, flags: LM });
}

// The Fernsehturm: concrete shaft, sphere, antenna.
function fernsehturm(mesh, ring, base, def) {
  const [cx, cz] = ringCentroid(ring);
  const seed = 23;
  // Base pavilion.
  cylinder(mesh, cx, base, cz, 22, 20, 5.5, 24, MAT.CONCRETE, { seed, flags: LM });
  // The shaft tapers from 16 m to 4.5 m radius over 200 m.
  const segs = [
    [base + 5.5, 40, 15.5, 11.0],
    [base + 45.5, 60, 11.0, 7.6],
    [base + 105.5, 60, 7.6, 5.6],
    [base + 165.5, 34, 5.6, 4.8],
  ];
  for (const [y, h, r0, r1] of segs) {
    cylinder(mesh, cx, y, cz, r0, r1, h, 26, MAT.CONCRETE, { seed, flags: LM, capTop: false });
  }
  // The sphere sits with its centre at 207 m, radius 16 m.
  sphere(mesh, cx, base + 207, cz, 16.4, 30, 16, MAT.METAL, { seed, flags: LM });
  // Observation band and restaurant windows.
  cylinder(mesh, cx, base + 198, cz, 16.2, 16.2, 5.2, 30, MAT.GLASS, { seed, flags: LM, capTop: false });
  cylinder(mesh, cx, base + 206, cz, 15.4, 15.4, 4.4, 30, MAT.GLASS, { seed, flags: LM, capTop: false });
  // Shaft above the sphere, then the antenna.
  cylinder(mesh, cx, base + 220, cz, 4.6, 3.4, 30, 18, MAT.CONCRETE, { seed, flags: LM, capTop: false });
  cylinder(mesh, cx, base + 250, cz, 3.4, 2.6, 30, 14, MAT.METAL, { seed, flags: LM, capTop: false });
  cylinder(mesh, cx, base + 280, cz, 2.0, 0.9, 48, 10, MAT.METAL, { seed, flags: LM, capTop: false });
  cylinder(mesh, cx, base + 328, cz, 0.9, 0.35, 40, 8, MAT.METAL, { seed, flags: LM, capTop: false });
}

function humboldtForum(mesh, ring, base, def) {
  const f = frame(ring);
  const rot = Math.atan2(f.uz, f.ux);
  const seed = 29;
  const H = 30;
  const hu = f.lu / 2, hv = f.lv / 2;
  const inner = [[-hu + 26, -hv + 22], [hu - 26, -hv + 22], [hu - 26, hv - 22], [-hu + 26, hv - 22]]
    .map(([u, v]) => [f.cx + u * f.ux + v * f.vx, f.cz + u * f.uz + v * f.vz]);
  extrudeBuilding(mesh, { outer: ring, holes: [inner] }, {
    base, height: H, roofShape: 'flat', wallMat: MAT.SANDSTONE, roofMat: MAT.SANDSTONE,
    seed, levels: 5, landmark: true, parapet: true,
  });
  const P = (u, v) => [f.cx + u * f.ux + v * f.vx, f.cz + u * f.uz + v * f.vz];
  const [dx, dz] = P(-hu + 30, 0);
  cylinder(mesh, dx, base + H, dz, 13, 12.5, 8, 24, MAT.SANDSTONE, { seed, flags: LM, capTop: false });
  dome(mesh, dx, base + H + 8, dz, 12.5, 14, 24, 8, MAT.COPPER, { seed, flags: LM });
  cylinder(mesh, dx, base + H + 22, dz, 1.2, 0.4, 7, 8, MAT.METAL, { seed, flags: LM });
  // Portico on the long west front.
  const [c0x, c0z] = P(-hu - 1.5, -18);
  const [c1x, c1z] = P(-hu - 1.5, 18);
  colonnade(mesh, base, c0x, c0z, c1x, c1z, 8, 1.1, 20, MAT.SANDSTONE, seed);
  const [px, pz] = P(-hu - 1.5, 0);
  box(mesh, px, base + 21.1, pz, 5.5, 2.6, 40, MAT.SANDSTONE, { seed, rot, flags: LM });
}

// A neoclassical temple front: block plus a colonnade plus a pediment.
function templeFront(mesh, ring, base, def) {
  const f = frame(ring);
  const rot = Math.atan2(f.uz, f.ux);
  const seed = (def.h * 7) | 0;
  const H = Math.max(9, def.h - 6);
  extrudeBuilding(mesh, { outer: ring, holes: [] }, {
    base, height: H, roofShape: 'flat', wallMat: MAT.SANDSTONE, roofMat: MAT.SANDSTONE,
    seed, levels: Math.max(1, Math.round(H / 6)), landmark: true, parapet: false,
  });
  const long = f.lu >= f.lv;
  const hu = f.lu / 2, hv = f.lv / 2;
  const P = (u, v) => [f.cx + u * f.ux + v * f.vx, f.cz + u * f.uz + v * f.vz];
  const span = long ? hv : hu;
  const front = long ? hu : hv;
  const n = Math.max(4, Math.min(12, Math.round((span * 2) / 4.6)));
  const [a0x, a0z] = long ? P(-front - 1.6, -span + 2) : P(-span + 2, -front - 1.6);
  const [a1x, a1z] = long ? P(-front - 1.6, span - 2) : P(span - 2, -front - 1.6);
  colonnade(mesh, base, a0x, a0z, a1x, a1z, n, 0.85, H - 1.5, MAT.SANDSTONE, seed);
  const [ex, ez] = long ? P(-front - 1.6, 0) : P(0, -front - 1.6);
  box(mesh, ex, base + H - 0.4, ez, long ? 4.6 : span * 2, 2.0, long ? span * 2 : 4.6, MAT.SANDSTONE, { seed, rot, flags: LM });
  // Pediment.
  spire(mesh, ex, base + H + 1.6, ez, Math.min(span * 2, 22), 4.4, MAT.SANDSTONE, { seed, rot, flags: LM });
  // Shallow gable over the main block.
  extrudeBuilding(mesh, { outer: ring, holes: [] }, {
    base: base + H, height: 0.2, roofShape: 'gabled', roofHeight: 5.0,
    wallMat: MAT.SANDSTONE, roofMat: MAT.SANDSTONE, seed, levels: 0,
    landmark: true, noWindows: true, skirt: 0, parapet: false,
  });
}

// A square tower crowned with a drum and dome, like the two on Gendarmenmarkt.
function towerDome(mesh, ring, base, def) {
  const f = frame(ring);
  const rot = Math.atan2(f.uz, f.ux);
  const seed = (def.lat * 1000) | 0;
  const H = 24;
  extrudeBuilding(mesh, { outer: ring, holes: [] }, {
    base, height: H, roofShape: 'flat', wallMat: MAT.SANDSTONE, roofMat: MAT.SANDSTONE,
    seed, levels: 4, landmark: true, parapet: false,
  });
  const P = (u, v) => [f.cx + u * f.ux + v * f.vx, f.cz + u * f.uz + v * f.vz];
  const [c0x, c0z] = P(-f.lu / 2 - 1.4, -f.lv / 2 + 2);
  const [c1x, c1z] = P(-f.lu / 2 - 1.4, f.lv / 2 - 2);
  colonnade(mesh, base, c0x, c0z, c1x, c1z, 6, 0.85, H - 2, MAT.SANDSTONE, seed);
  const [ex, ez] = P(-f.lu / 2 - 1.4, 0);
  box(mesh, ex, base + H - 2.0, ez, 4.4, 2.2, f.lv, MAT.SANDSTONE, { seed, rot, flags: LM });
  spire(mesh, ex, base + H + 0.2, ez, Math.min(f.lv, 18), 4.0, MAT.SANDSTONE, { seed, rot, flags: LM });

  cylinder(mesh, f.cx, base + H, f.cz, 11, 10.5, 12, 20, MAT.SANDSTONE, { seed, flags: LM, capTop: false });
  colonnadeRing(mesh, f.cx, base + H + 12, f.cz, 11.6, 16, 0.7, 8.5, seed);
  cylinder(mesh, f.cx, base + H + 12, f.cz, 9.0, 9.0, 8.5, 20, MAT.SANDSTONE, { seed, flags: LM, capTop: false });
  box(mesh, f.cx, base + H + 20.5, f.cz, 24, 1.2, 24, MAT.SANDSTONE, { seed, rot, flags: LM });
  dome(mesh, f.cx, base + H + 21.7, f.cz, 9.6, 12.5, 20, 8, MAT.COPPER, { seed, flags: LM, onion: 0.1 });
  cylinder(mesh, f.cx, base + H + 34.2, f.cz, 1.6, 1.2, 3.4, 10, MAT.COPPER, { seed, flags: LM, capTop: false });
  cylinder(mesh, f.cx, base + H + 37.6, f.cz, 0.4, 0.15, 5.0, 6, MAT.METAL, { seed, flags: LM });
}

function colonnadeRing(mesh, cx, cy, cz, radius, count, r, h, seed) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    cylinder(mesh, cx + Math.cos(a) * radius, cy, cz + Math.sin(a) * radius, r, r * 0.88, h, 8, MAT.SANDSTONE, { seed, flags: LM, capTop: false });
  }
}

function rotunda(mesh, ring, base, def) {
  const [cx, cz] = ringCentroid(ring);
  const seed = 41;
  const r = Math.max(12, Math.min(def.w, def.d) / 2);
  cylinder(mesh, cx, base, cz, r, r, 20, 26, MAT.SANDSTONE, { seed, flags: LM, capTop: false });
  dome(mesh, cx, base + 20, cz, r * 0.97, r * 0.85, 26, 9, MAT.COPPER, { seed, flags: LM });
  cylinder(mesh, cx, base + 20 + r * 0.85, cz, 1.4, 0.6, 4.0, 8, MAT.METAL, { seed, flags: LM });
  colonnade(mesh, base, cx - 9, cz - r - 3.5, cx + 9, cz - r - 3.5, 6, 0.9, 15, MAT.SANDSTONE, seed);
  box(mesh, cx, base + 15.2, cz - r - 3.5, 22, 2.2, 4.4, MAT.SANDSTONE, { seed, flags: LM });
  spire(mesh, cx, base + 17.4, cz - r - 3.5, 20, 3.6, MAT.SANDSTONE, { seed, flags: LM });
}

function domeBlock(mesh, ring, base, def) {
  const f = frame(ring);
  const seed = 43;
  const H = Math.max(16, def.h - 12);
  extrudeBuilding(mesh, { outer: ring, holes: [] }, {
    base, height: H, roofShape: 'flat', wallMat: MAT.SANDSTONE, roofMat: MAT.SANDSTONE,
    seed, levels: Math.round(H / 6), landmark: true, parapet: true,
  });
  const P = (u, v) => [f.cx + u * f.ux + v * f.vx, f.cz + u * f.uz + v * f.vz];
  const [dx, dz] = P(-f.lu / 2 + 16, 0);
  cylinder(mesh, dx, base + H, dz, 12, 11.5, 7, 22, MAT.SANDSTONE, { seed, flags: LM, capTop: false });
  dome(mesh, dx, base + H + 7, dz, 11.5, 13, 22, 8, MAT.COPPER, { seed, flags: LM });
  cylinder(mesh, dx, base + H + 20, dz, 1.0, 0.4, 5, 8, MAT.METAL, { seed, flags: LM });
}

function church(mesh, ring, base, def) {
  const f = frame(ring);
  const rot = Math.atan2(f.uz, f.ux);
  const seed = 47;
  const H = Math.max(14, def.h);
  extrudeBuilding(mesh, { outer: ring, holes: [] }, {
    base, height: H, roofShape: 'gabled', roofHeight: 9,
    wallMat: MAT.BRICK, roofMat: MAT.ROOF, seed, levels: 2, landmark: true, parapet: false,
  });
  const long = f.lu >= f.lv;
  const hu = f.lu / 2, hv = f.lv / 2;
  const P = (u, v) => [f.cx + u * f.ux + v * f.vx, f.cz + u * f.uz + v * f.vz];
  const [tx, tz] = long ? P(-hu + 8, 0) : P(0, -hv + 8);
  const tw = Math.min(f.lu, f.lv) * 0.85;
  box(mesh, tx, base, tz, tw, H + 30, tw, MAT.BRICK, { seed, rot, flags: FACADE_FLAG.LANDMARK });
  spire(mesh, tx, base + H + 30, tz, tw * 1.05, 26, MAT.COPPER, { seed, rot, flags: LM });
  cylinder(mesh, tx, base + H + 56, tz, 0.4, 0.15, 5, 6, MAT.METAL, { seed, flags: LM });
}

function townHall(mesh, ring, base, def) {
  const f = frame(ring);
  const rot = Math.atan2(f.uz, f.ux);
  const seed = 53;
  const hu = f.lu / 2, hv = f.lv / 2;
  const inner = [[-hu + 22, -hv + 20], [hu - 22, -hv + 20], [hu - 22, hv - 20], [-hu + 22, hv - 20]]
    .map(([u, v]) => [f.cx + u * f.ux + v * f.vx, f.cz + u * f.uz + v * f.vz]);
  extrudeBuilding(mesh, { outer: ring, holes: [inner] }, {
    base, height: def.h, roofShape: 'flat', wallMat: MAT.BRICK, roofMat: MAT.ROOF,
    seed, levels: 4, landmark: true, parapet: true,
  });
  const P = (u, v) => [f.cx + u * f.ux + v * f.vx, f.cz + u * f.uz + v * f.vz];
  const [tx, tz] = P(0, -hv + 12);
  box(mesh, tx, base, tz, 17, 60, 17, MAT.BRICK, { seed, rot, flags: FACADE_FLAG.LANDMARK });
  box(mesh, tx, base + 60, tz, 19, 2.0, 19, MAT.BRICK, { seed, rot, flags: LM });
  cylinder(mesh, tx, base + 62, tz, 8.0, 7.0, 6.0, 16, MAT.BRICK, { seed, flags: LM, capTop: false });
  spire(mesh, tx, base + 68, tz, 15, 8.0, MAT.COPPER, { seed, rot, flags: LM });
}

function plainTower(mesh, ring, base, def) {
  const seed = 59;
  extrudeBuilding(mesh, { outer: ring, holes: [] }, {
    base, height: def.h, roofShape: 'flat',
    wallMat: def.material === 'brick' ? MAT.BRICK : MAT.FACADE,
    roofMat: MAT.ROOF, seed, levels: Math.round(def.h / 3.6), landmark: false, parapet: true,
  });
}

function glassTower(mesh, ring, base, def) {
  const seed = 61;
  extrudeBuilding(mesh, { outer: ring, holes: [] }, {
    base, height: def.h, roofShape: 'flat', wallMat: MAT.GLASS, roofMat: MAT.METAL,
    seed, levels: Math.round(def.h / 3.6), landmark: true, parapet: false,
  });
}

function glassBlock(mesh, ring, base, def) {
  const f = frame(ring);
  const seed = 67;
  extrudeBuilding(mesh, { outer: ring, holes: [] }, {
    base, height: def.h * 0.72, roofShape: 'flat', wallMat: MAT.GLASS, roofMat: MAT.METAL,
    seed, levels: Math.round(def.h / 4.2), landmark: true, parapet: false,
  });
  // A tent roof, which is what both the Sony Center and the Hauptbahnhof read as.
  dome(mesh, f.cx, base + def.h * 0.72, f.cz, Math.min(f.lu, f.lv) * 0.56, def.h * 0.34, 20, 5, MAT.GLASS, { seed, flags: LM });
}

function slabTower(mesh, ring, base, def) {
  const seed = 71;
  extrudeBuilding(mesh, { outer: ring, holes: [] }, {
    base, height: def.h, roofShape: 'flat', wallMat: MAT.FACADE, roofMat: MAT.ROOF,
    seed, levels: Math.round(def.h / 3.1), landmark: false, parapet: true,
  });
}
