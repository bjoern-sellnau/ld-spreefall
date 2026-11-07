// Planting the woods the map draws as areas: as thick as a wood, clear of the
// paths, the same trees on both sides of a district's edge, and a wooded park
// as wooded as the sources say it is.

import test from 'node:test';
import assert from 'node:assert/strict';

import { WOODS, isWood, isOpen, woodedShare, plantWoods, inRing } from '../woods.mjs';

const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const BIG = { minX: -5000, minZ: -5000, maxX: 5000, maxZ: 5000 };

test('which areas are woods, which ground stays open, and which parks are mostly trees', () => {
  assert.ok(isWood({ natural: 'wood' }) && isWood({ landuse: 'forest' }));
  assert.ok(!isWood({ leisure: 'park' }) && !isWood({ landuse: 'grass' }));
  assert.ok(isOpen({ landuse: 'grass' }) && isOpen({ leisure: 'playground' }) && isOpen({ landuse: 'meadow' }));
  assert.ok(!isOpen({ natural: 'wood' }));
  assert.equal(woodedShare({ leisure: 'park', name: 'Großer Tiergarten' }), 0.65);
  assert.equal(woodedShare({ leisure: 'park', name: 'Grosser Tiergarten' }), 0.65);
  // A park is not a wood by being a park: the Tempelhofer Feld is one.
  assert.equal(woodedShare({ leisure: 'park', name: 'Tempelhofer Feld' }), 0);
});

test('a wood is planted as thick as a wood, inside its outline and out of its holes', () => {
  const hole = square(80, 80, 120, 120);
  const r = plantWoods({ woods: [{ ring: square(0, 0, 200, 200), holes: [hole] }], box: BIG });
  const ha = (200 * 200 - 40 * 40) / 10000;
  const perHa = r.planted.length / ha;
  const want = 10000 / (WOODS.spacing * WOODS.spacing);
  assert.ok(Math.abs(perHa - want) / want < 0.12, `${perHa.toFixed(1)} a hectare, ${want.toFixed(1)} wanted`);
  for (const t of r.planted) {
    const [x, z] = t.p;
    assert.ok(x >= 0 && x <= 200 && z >= 0 && z <= 200, 'inside');
    assert.ok(!inRing(x, z, hole), 'not in the hole');
    assert.equal(t.tags['spreefall:fill'], 'wood');
  }
  // The same wood plants the same trees every time.
  const again = plantWoods({ woods: [{ ring: square(0, 0, 200, 200), holes: [hole] }], box: BIG });
  assert.deepEqual(again.planted.map((t) => t.p), r.planted.map((t) => t.p));
});

test('the paths through a wood stay clear, and a mapped tree takes the place of a planted one', () => {
  // A footpath along z = 100, as roadIndex would answer for one 2.5 m wide.
  const nearRoad = (x, z, margin) => Math.abs(z - 100) < 1.25 + 1.7 + margin;
  const mapped = [[50, 50], [150, 150]];
  const r = plantWoods({ woods: [{ ring: square(0, 0, 200, 200) }], box: BIG, nearRoad, trees: mapped });
  for (const t of r.planted) {
    assert.ok(Math.abs(t.p[1] - 100) >= 1.25 + 1.7 + WOODS.roadMargin, `${t.p} on the path`);
    for (const [mx, mz] of mapped) assert.ok(Math.hypot(t.p[0] - mx, t.p[1] - mz) >= WOODS.nearTree);
  }
  // And water or a building is nobody's wood either.
  const blocked = (x, z) => x > 150;
  const b = plantWoods({ woods: [{ ring: square(0, 0, 200, 200) }], box: BIG, blocked });
  assert.ok(b.planted.length > 100 && b.planted.every((t) => t.p[0] <= 150));
});

test('a wood cut by a district edge is planted once, the same trees either side', () => {
  const wood = [{ ring: square(-150, -100, 150, 100) }];
  const whole = plantWoods({ woods: wood, box: BIG }).planted.map((t) => t.p.join());
  const west = plantWoods({ woods: wood, box: { minX: -5000, minZ: -5000, maxX: 0, maxZ: 5000 } }).planted;
  const east = plantWoods({ woods: wood, box: { minX: 0, minZ: -5000, maxX: 5000, maxZ: 5000 } }).planted;
  const halves = [...west, ...east].map((t) => t.p.join());
  assert.equal(new Set(halves).size, halves.length, 'no tree planted twice');
  assert.deepEqual([...halves].sort(), [...whole].sort(), 'and none left out');
});

test('a wooded park comes out as wooded as the sources say, groves round its lawns', () => {
  // 600 by 600 m of park with a mapped wood over a quarter of it and a lawn
  // over another quarter.
  const park = { ring: square(0, 0, 600, 600), wooded: 0.65 };
  const woods = [{ ring: square(0, 0, 300, 300) }];
  const open = [{ ring: square(300, 300, 600, 600) }];
  const r = plantWoods({ woods, parks: [park], open, box: BIG });
  const cells = (600 * 600) / (WOODS.spacing * WOODS.spacing);
  const share = (r.wood + r.grove) / cells;
  assert.ok(Math.abs(share - 0.65) < 0.06, `${(share * 100).toFixed(0)} per cent wooded`);
  for (const t of r.planted) {
    if (t.tags['spreefall:fill'] !== 'grove') continue;
    assert.ok(!(t.p[0] > 300 && t.p[1] > 300), 'no grove on the lawn');
    assert.ok(!(t.p[0] < 300 && t.p[1] < 300), 'and none doubled in the mapped wood');
  }
  assert.ok(Math.abs(r.parks[0].mapped - 0.25) < 0.03 && Math.abs(r.parks[0].open - 0.25) < 0.03);
  // A park mapped wooded to more than its share gets no groves at all.
  const full = plantWoods({ woods: [{ ring: square(0, 0, 600, 500) }], parks: [park], box: BIG });
  assert.equal(full.grove, 0);
  // And the groves are groves: most planted cells have a planted neighbour.
  const at = new Set(r.planted.filter((t) => t.tags['spreefall:fill'] === 'grove')
    .map((t) => `${Math.floor(t.p[0] / WOODS.spacing)},${Math.floor(t.p[1] / WOODS.spacing)}`));
  let together = 0;
  for (const key of at) {
    const [i, k] = key.split(',').map(Number);
    if (at.has(`${i + 1},${k}`) || at.has(`${i},${k + 1}`) || at.has(`${i - 1},${k}`) || at.has(`${i},${k - 1}`)) together++;
  }
  assert.ok(together / at.size > 0.85, `${together} of ${at.size} next to another`);
});
