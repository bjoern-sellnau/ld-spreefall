// Pipeline unit tests. Run with: node --test tools/test/
import test from 'node:test';
import assert from 'node:assert/strict';

import { triangulate, signedArea } from '../earcut.mjs';
import { parseOsmXml, counts } from '../osm-xml.mjs';
import { Mesh } from '../mesh.mjs';
import {
  extrudeBuilding, orientedBox, ringArea, ringCentroid,
  box, cylinder, dome, sphere, spire, ribbon, groundPolygon, colonnade,
} from '../geometry.mjs';
import { project, unproject, worldBounds } from '../geo.mjs';
import { MAT } from '../../src/shared/constants.js';

// --- helpers ---------------------------------------------------------------

function polyArea(mesh) {
  let abs = 0, signed = 0;
  for (let i = 0; i < mesh.idx.length; i += 3) {
    const a = mesh.idx[i], b = mesh.idx[i + 1], c = mesh.idx[i + 2];
    const ux = mesh.px[b] - mesh.px[a], uy = mesh.py[b] - mesh.py[a], uz = mesh.pz[b] - mesh.pz[a];
    const vx = mesh.px[c] - mesh.px[a], vy = mesh.py[c] - mesh.py[a], vz = mesh.pz[c] - mesh.pz[a];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    abs += Math.hypot(nx, ny, nz) / 2;
    signed += Math.hypot(nx, ny, nz) / 2;
  }
  return { abs, signed };
}

/** Signed volume of the triangle soup. Positive means outward facing normals. */
function meshVolume(mesh) {
  let v = 0;
  for (let i = 0; i < mesh.idx.length; i += 3) {
    const a = mesh.idx[i], b = mesh.idx[i + 1], c = mesh.idx[i + 2];
    const ax = mesh.px[a], ay = mesh.py[a], az = mesh.pz[a];
    const bx = mesh.px[b], by = mesh.py[b], bz = mesh.pz[b];
    const cx = mesh.px[c], cy = mesh.py[c], cz = mesh.pz[c];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

/** Weld by position, then check every edge is used exactly twice, in opposite directions. */
function watertight(mesh) {
  const key = (i) => `${mesh.px[i].toFixed(4)},${mesh.py[i].toFixed(4)},${mesh.pz[i].toFixed(4)}`;
  const weld = new Map();
  const id = new Array(mesh.vertexCount);
  for (let i = 0; i < mesh.vertexCount; i++) {
    const k = key(i);
    if (!weld.has(k)) weld.set(k, weld.size);
    id[i] = weld.get(k);
  }
  const edges = new Map();
  let degenerate = 0;
  for (let i = 0; i < mesh.idx.length; i += 3) {
    const t = [id[mesh.idx[i]], id[mesh.idx[i + 1]], id[mesh.idx[i + 2]]];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) { degenerate++; continue; }
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      const ek = a < b ? `${a}_${b}` : `${b}_${a}`;
      const dir = a < b ? 1 : -1;
      edges.set(ek, (edges.get(ek) || 0) + dir);
    }
  }
  let unmatched = 0;
  for (const v of edges.values()) if (v !== 0) unmatched++;
  return { unmatched, edgeCount: edges.size, degenerate, weldedVertices: weld.size };
}

// --- tests -----------------------------------------------------------------

test('projection round trips to under a millimetre', () => {
  for (const [lon, lat] of [[13.3777, 52.5163], [13.4094, 52.5208], [13.3650, 52.5080]]) {
    const [x, z] = project(lon, lat);
    const [lo, la] = unproject(x, z);
    assert.ok(Math.abs(lo - lon) < 1e-9, `lon ${lo} vs ${lon}`);
    assert.ok(Math.abs(la - lat) < 1e-9, `lat ${la} vs ${lat}`);
  }
  const w = worldBounds();
  assert.ok(w.width > 3300 && w.width < 3500, `width ${w.width}`);
  assert.ok(w.depth > 1800 && w.depth < 1950, `depth ${w.depth}`);
});

test('the XML reader handles entities, self closing tags and nesting', () => {
  const src = `<?xml version='1.0'?>
<osm version="0.6">
  <node id="1" lat="52.5" lon="13.3"/>
  <node id='2' lat='52.51' lon='13.31'><tag k='name' v='Caf&#233; &quot;Zoo&quot; &amp; Bar'/></node>
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="1"/><tag k="building" v="yes"/></way>
  <relation id="20"><member type="way" ref="10" role="outer"/><tag k="type" v="multipolygon"/></relation>
</osm>`;
  const d = parseOsmXml(src);
  assert.deepEqual(counts(d), { nodes: 2, ways: 1, relations: 1 });
  assert.equal(d.nodes.get(2).tags.name, 'Café "Zoo" & Bar');
  assert.deepEqual(d.ways.get(10).refs, [1, 2, 1]);
  assert.equal(d.relations.get(20).members[0].role, 'outer');
  assert.equal(d.nodes.get(1).lat, 52.5);
});

test('ear clipping conserves area, with and without holes', () => {
  const cases = [
    { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [], area: 100 },
    { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [[[3, 3], [3, 7], [7, 7], [7, 3]]], area: 84 },
    { outer: [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]], holes: [[[2, 2], [2, 6], [6, 6], [6, 2]]], area: 240 },
    {
      outer: [[0, 0], [30, 0], [30, 30], [0, 30]],
      holes: [[[2, 2], [2, 8], [8, 8], [8, 2]], [[20, 20], [20, 27], [27, 27], [27, 20]]],
      area: 900 - 36 - 49,
    },
  ];
  for (const c of cases) {
    const { verts, indices } = triangulate(c.outer, c.holes);
    let abs = 0, sgn = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = verts[indices[i]], b = verts[indices[i + 1]], cc = verts[indices[i + 2]];
      const s = ((b[0] - a[0]) * (cc[1] - a[1]) - (b[1] - a[1]) * (cc[0] - a[0])) / 2;
      abs += Math.abs(s); sgn += s;
    }
    assert.ok(Math.abs(abs - c.area) < 1e-6, `absolute area ${abs} vs ${c.area}`);
    assert.ok(Math.abs(sgn - c.area) < 1e-6, `no flipped triangles: signed ${sgn} vs ${c.area}`);
  }
});

test('an L shaped building with a courtyard extrudes to a watertight solid', () => {
  // Plan: a 20 by 20 L with a 12 by 12 bite out of the north east, and a 4 by 4
  // courtyard hole punched through it. Six outer vertices, four inner.
  const outer = [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]];
  const hole = [[2, 2], [2, 6], [6, 6], [6, 2]];
  const height = 12;
  const mesh = new Mesh();
  extrudeBuilding(mesh, { outer, holes: [hole] }, {
    base: 0, height, roofShape: 'flat', wallMat: MAT.FACADE, roofMat: MAT.ROOF,
    seed: 7, levels: 4, skirt: 0, parapet: false, capBottom: true,
  });

  const footprintArea = 20 * 8 + 8 * 12 - 4 * 4;   // 240
  assert.equal(footprintArea, 240);

  // 10 wall edges give 2 triangles each, and the two caps are the same
  // triangulation of a 6 vertex outline with one 4 vertex hole.
  const capTris = triangulate(outer, [hole]).indices.length / 3;
  assert.equal(capTris, 10);
  assert.equal(mesh.triangleCount, 10 * 2 + capTris * 2, 'triangle count');

  const wt = watertight(mesh);
  assert.equal(wt.degenerate, 0, 'no degenerate triangles');
  assert.equal(wt.unmatched, 0, `every edge is shared by two opposite triangles, ${wt.unmatched} were not`);

  const vol = meshVolume(mesh);
  assert.ok(vol > 0, `outward facing normals give a positive volume, got ${vol}`);
  assert.ok(Math.abs(vol - footprintArea * height) < 1e-6, `volume ${vol} vs ${footprintArea * height}`);

  // Every wall normal must point away from the solid.
  for (let i = 0; i < mesh.vertexCount; i++) {
    if (Math.abs(mesh.ny[i]) > 0.5) continue;
    const n = Math.hypot(mesh.nx[i], mesh.ny[i], mesh.nz[i]);
    assert.ok(Math.abs(n - 1) < 1e-6, `wall normal is unit length, got ${n}`);
  }
});

test('a hipped and a gabled roof stay inside their footprint', () => {
  const outer = [[0, 0], [24, 0], [24, 14], [0, 14]];
  for (const shape of ['gabled', 'hipped']) {
    const mesh = new Mesh();
    extrudeBuilding(mesh, { outer, holes: [] }, {
      base: 0, height: 15, roofShape: shape, roofHeight: 5,
      seed: 1, levels: 4, skirt: 0,
    });
    let maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < mesh.vertexCount; i++) {
      maxY = Math.max(maxY, mesh.py[i]);
      minX = Math.min(minX, mesh.px[i]);
      maxX = Math.max(maxX, mesh.px[i]);
    }
    assert.ok(Math.abs(maxY - 20) < 0.02, `${shape} ridge at 20, got ${maxY}`);
    assert.ok(minX > -0.05 && maxX < 24.05, `${shape} stays in plan, ${minX}..${maxX}`);
    assert.ok(mesh.triangleCount > 8, `${shape} produced geometry`);
  }
});

test('oriented box finds the long axis of a rotated rectangle', () => {
  const a = 0.4;
  const c = Math.cos(a), s = Math.sin(a);
  const ring = [[-30, -6], [30, -6], [30, 6], [-30, 6]].map(([u, v]) => [u * c - v * s, u * s + v * c]);
  const b = orientedBox(ring);
  const long = Math.max(b.lu, b.lv), short = Math.min(b.lu, b.lv);
  assert.ok(Math.abs(long - 60) < 0.6, `long side ${long}`);
  assert.ok(Math.abs(short - 12) < 0.6, `short side ${short}`);
  assert.ok(Math.abs(ringArea(ring) - 720) < 1e-6);
  const [cx, cz] = ringCentroid(ring);
  assert.ok(Math.hypot(cx, cz) < 1e-6, 'centroid at the origin');
});

test('ring winding is reported consistently', () => {
  const ccw = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.ok(signedArea(ccw) > 0);
  assert.ok(signedArea(ccw.slice().reverse()) < 0);
});

test('every generator winds its faces to match the normals it declares', () => {
  const cases = {
    box: (m) => box(m, 5, 0, -3, 8, 12, 6, MAT.CONCRETE, { rot: 0.6 }),
    cylinder: (m) => cylinder(m, 0, 0, 0, 6, 3, 20, 16, MAT.CONCRETE, {}),
    dome: (m) => dome(m, 0, 10, 0, 9, 11, 18, 7, MAT.COPPER, {}),
    sphere: (m) => sphere(m, 2, 30, -4, 7, 20, 10, MAT.METAL, {}),
    spire: (m) => spire(m, 0, 12, 0, 10, 9, MAT.COPPER, { rot: 0.3 }),
    ribbon: (m) => ribbon(m, [[0, 0], [40, 6], [90, 4]], 7, MAT.ASPHALT, () => 0, {}),
    ground: (m) => groundPolygon(m, [[0, 0], [30, 0], [30, 20], [0, 20]], [[[8, 8], [8, 14], [16, 14], [16, 8]]], MAT.GRASS, () => 0, {}),
    colonnade: (m) => colonnade(m, 0, -10, 0, 10, 0, 5, 1.1, 14, MAT.SANDSTONE, 3),
    gabled: (m) => extrudeBuilding(m, { outer: [[0, 0], [26, 0], [26, 12], [0, 12]], holes: [] },
      { base: 0, height: 14, roofShape: 'gabled', roofHeight: 5, seed: 1, levels: 4, skirt: 0 }),
    hipped: (m) => extrudeBuilding(m, { outer: [[0, 0], [26, 0], [26, 12], [0, 12]], holes: [] },
      { base: 0, height: 14, roofShape: 'hipped', roofHeight: 5, seed: 1, levels: 4, skirt: 0 }),
    courtyard: (m) => extrudeBuilding(m, {
      outer: [[0, 0], [40, 0], [40, 30], [0, 30]],
      holes: [[[10, 8], [10, 22], [30, 22], [30, 8]]],
    }, { base: 0, height: 20, roofShape: 'flat', seed: 2, levels: 6, skirt: 0 }),
  };
  for (const [name, build] of Object.entries(cases)) {
    const mesh = new Mesh();
    build(mesh);
    assert.ok(mesh.triangleCount > 0, `${name} produced triangles`);
    let bad = 0, checked = 0;
    for (let i = 0; i < mesh.idx.length; i += 3) {
      const a = mesh.idx[i], b = mesh.idx[i + 1], c = mesh.idx[i + 2];
      const ux = mesh.px[b] - mesh.px[a], uy = mesh.py[b] - mesh.py[a], uz = mesh.pz[b] - mesh.pz[a];
      const vx = mesh.px[c] - mesh.px[a], vy = mesh.py[c] - mesh.py[a], vz = mesh.pz[c] - mesh.pz[a];
      const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
      const glen = Math.hypot(gx, gy, gz);
      if (glen < 1e-9) continue;
      const nx = (mesh.nx[a] + mesh.nx[b] + mesh.nx[c]) / 3;
      const ny = (mesh.ny[a] + mesh.ny[b] + mesh.ny[c]) / 3;
      const nz = (mesh.nz[a] + mesh.nz[b] + mesh.nz[c]) / 3;
      const nlen = Math.hypot(nx, ny, nz);
      if (nlen < 1e-6) continue;
      checked++;
      if ((gx * nx + gy * ny + gz * nz) / (glen * nlen) < 0.02) bad++;
    }
    assert.ok(checked > 0, `${name} had normals to check`);
    assert.equal(bad, 0, `${name}: ${bad} of ${checked} triangles are wound against their normal`);
  }
});
