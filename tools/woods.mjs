// Woods, planted.
//
// The city's trees come from OpenStreetMap, one node a tree, and in Berlin
// the nodes are mostly street trees: the Senate's register holds the street
// trees and only part of the trees in its parks (Geoportal Berlin, via the
// OSM wiki's page on city tree registers), and nobody has imported even that
// (the same page lists the import as "tba"). A wood is mapped as an area,
// natural=wood or landuse=forest, which nearly every data consumer reads as
// the same thing (OSM wiki, Tag:natural=wood). The build read neither, so
// the Tiergarten, which is two thirds trees, was a lawn with the street trees
// round its edge and whatever trees somebody had mapped one by one.
//
// So the build plants what the map says is wooded and has no trees of its
// own on it: one tree to a cell of a grid laid over the whole city, moved off
// the middle of its cell by a hash of where the cell is. The grid and the
// hash are the city's, not the district's, so two districts that share a wood
// plant the same trees on each side of the cut and never the same tree twice.
//
// A park that is known to be mostly trees, where the map has the park and
// not all of its woods, gets groves on the ground the map leaves unsaid, as
// many as make up the share the sources give; lawns, water, paths and
// buildings stay open. Only the parks in WOODED_PARKS, because a park in
// general can be an open field (the Tempelhofer Feld is a park).

import { fbm2, hashInt } from './noise.mjs';

export const WOODS = {
  // One tree a cell: 13 m is 59 trees a hectare, the density measured in
  // tools/synth-osm.mjs as a wood you walk into at a third of a frame more
  // than a lawn, under software rendering.
  spacing: 13,
  // How far off the middle of its cell a tree may stand, as a share of the
  // cell, so the rows of the grid do not show.
  jitter: 0.75,
  // Grown trees. The crown is 0.34 to 0.44 of the height across its radius
  // (src/shaders/trees.js), so from 13 m up the crowns meet at this spacing
  // and the canopy closes, which is what a wood looks like from above.
  height: [13, 22],
  // Clear of a path or a road by this much past its own half width and the
  // pavement roadIndex already allows for.
  roadMargin: 1.0,
  // A tree somebody mapped this close takes the place of a planted one.
  nearTree: 7,
  // How big a grove is in a wooded park, in metres: the wavelength of the
  // noise that says where the trees stand and where the clearings are.
  grove: 110,
};

/**
 * Parks that are mostly trees, and how much of them. The Grosser Tiergarten:
 * about 200 ha, of which about 70 ha, some 35 per cent, is open land, lawns
 * and meadows, in the biotope mapping published by Rohner (2008), Verh. Bot.
 * Ver. Berlin Brandenburg 141, pp. 5 to 29; the rest is the woody ground
 * between them.
 */
export const WOODED_PARKS = [
  { names: ['Großer Tiergarten', 'Grosser Tiergarten'], wooded: 0.65 },
];

/** natural=wood and landuse=forest: the same thing to nearly every map. */
export function isWood(tags) {
  return !!tags && (tags.natural === 'wood' || tags.landuse === 'forest');
}

/** Ground that stays open in a park: lawns, meadows, pitches and play. */
export function isOpen(tags) {
  if (!tags) return false;
  return ['grass', 'meadow', 'village_green', 'recreation_ground', 'cemetery'].includes(tags.landuse)
    || ['pitch', 'playground', 'dog_park', 'sports_centre', 'stadium', 'golf_course', 'garden',
      'swimming_pool', 'track'].includes(tags.leisure)
    || ['grassland', 'heath', 'scrub', 'sand', 'beach'].includes(tags.natural)
    || tags.place === 'square';
}

/** How much of a park is wooded, if it is one of WOODED_PARKS, or 0. */
export function woodedShare(tags) {
  if (!tags || tags.leisure !== 'park' || !tags.name) return 0;
  const p = WOODED_PARKS.find((w) => w.names.includes(tags.name));
  return p ? p.wooded : 0;
}

/** Whether x, z is inside a ring, by the crossing rule. */
export function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and in none of its holes. */
export function inArea(x, z, a) {
  if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) return false;
  if (!inRing(x, z, a.ring)) return false;
  for (const h of a.holes || []) if (inRing(x, z, h)) return false;
  return true;
}

/** An area with its bounds worked out once. */
export function area(ring, holes = []) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { ring, holes, minX, minZ, maxX, maxZ };
}

/**
 * A point test over many areas: a coarse grid of which areas reach into
 * which cell, so a test looks at a handful of rings rather than all of them.
 */
export function areaIndex(list, cell = 50) {
  const grid = new Map();
  for (const a of list) {
    for (let i = Math.floor(a.minX / cell); i <= Math.floor(a.maxX / cell); i++) {
      for (let k = Math.floor(a.minZ / cell); k <= Math.floor(a.maxZ / cell); k++) {
        const key = `${i},${k}`;
        const l = grid.get(key);
        if (l) l.push(a); else grid.set(key, [a]);
      }
    }
  }
  return (x, z) => {
    const l = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
    if (!l) return false;
    for (const a of l) if (inArea(x, z, a)) return true;
    return false;
  };
}

/** Where the tree of grid cell i, k stands: the city's grid, the city's hash. */
export function cellTree(i, k, S = WOODS.spacing) {
  const h = hashInt(i * 7919 + 13, k * 104729 + 7);
  const jx = ((h & 1023) / 1023 - 0.5) * WOODS.jitter;
  const jz = (((h >>> 10) & 1023) / 1023 - 0.5) * WOODS.jitter;
  return [(i + 0.5 + jx) * S, (k + 0.5 + jz) * S];
}

// The noise is not spread evenly between nought and one, so a share of the
// ground is turned into a threshold through a table of what the noise does
// over a large patch of the city, made once and the same for every district.
let quantiles = null;
function groveThreshold(share) {
  if (!quantiles) {
    const v = [];
    for (let i = 0; i < 64; i++) {
      for (let k = 0; k < 64; k++) v.push(fbm2(i * 0.37 + 0.11, k * 0.41 + 0.07, 3, 17));
    }
    quantiles = v.sort((a, b) => a - b);
  }
  if (share >= 1) return -Infinity;
  if (share <= 0) return Infinity;
  return quantiles[Math.min(quantiles.length - 1, Math.floor((1 - share) * quantiles.length))];
}

/** Whether a point in a wooded park is in a grove, given the share of groves wanted. */
export function inGrove(x, z, share) {
  return fbm2(x / WOODS.grove, z / WOODS.grove, 3, 17) >= groveThreshold(share);
}

/**
 * Plant the woods.
 *
 * @param {object} o
 * @param {Array<{ring:Array, holes?:Array}>} o.woods natural=wood and landuse=forest
 * @param {Array<{ring:Array, holes?:Array, wooded:number}>} o.parks the wooded parks
 * @param {Array<{ring:Array, holes?:Array}>} o.open lawns and the like, inside parks
 * @param {{minX:number, minZ:number, maxX:number, maxZ:number}} o.box the district
 * @param {(x:number, z:number) => boolean} [o.blocked] water, buildings
 * @param {(x:number, z:number, margin:number) => boolean} [o.nearRoad] from roadIndex
 * @param {Array<[number, number]>} [o.trees] trees already mapped
 * @returns {{planted:Array<{p:[number,number], tags:object}>, wood:number, grove:number,
 *   parks:Array<{name:string, wooded:number, mapped:number, open:number, groves:number}>}}
 */
export function plantWoods(o) {
  const S = WOODS.spacing;
  const box = o.box;
  const blocked = o.blocked || (() => false);
  const nearRoad = o.nearRoad || (() => false);
  const inBox = (x, z) => x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ;

  // The trees that are there already, in a grid of their own.
  const TC = WOODS.nearTree;
  const had = new Map();
  for (const [x, z] of o.trees || []) {
    const key = `${Math.floor(x / TC)},${Math.floor(z / TC)}`;
    const l = had.get(key);
    if (l) l.push([x, z]); else had.set(key, [[x, z]]);
  }
  const nearTree = (x, z) => {
    const ci = Math.floor(x / TC), ck = Math.floor(z / TC);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let k = ck - 1; k <= ck + 1; k++) {
        const l = had.get(`${i},${k}`);
        if (!l) continue;
        for (const [px, pz] of l) if (Math.hypot(px - x, pz - z) < TC) return true;
      }
    }
    return false;
  };
  const free = (x, z) => inBox(x, z) && !blocked(x, z) && !nearRoad(x, z, WOODS.roadMargin) && !nearTree(x, z);

  const woods = (o.woods || []).map((w) => area(w.ring, w.holes));
  const inWood = areaIndex(woods);
  const opens = (o.open || []).map((w) => area(w.ring, w.holes));
  const inOpen = areaIndex(opens);

  const planted = [];
  const done = new Set();
  // Every cell of the grid over a box, cut to the district.
  const cells = (a, fn) => {
    const x0 = Math.max(a.minX, box.minX), x1 = Math.min(a.maxX, box.maxX);
    const z0 = Math.max(a.minZ, box.minZ), z1 = Math.min(a.maxZ, box.maxZ);
    if (x0 > x1 || z0 > z1) return;
    for (let i = Math.floor(x0 / S) - 1; i <= Math.floor(x1 / S); i++) {
      for (let k = Math.floor(z0 / S) - 1; k <= Math.floor(z1 / S); k++) fn(i, k);
    }
  };

  let wood = 0;
  for (const w of woods) {
    cells(w, (i, k) => {
      const key = `${i},${k}`;
      if (done.has(key)) return;
      const [x, z] = cellTree(i, k);
      if (!inArea(x, z, w)) return;
      done.add(key);
      if (!free(x, z)) return;
      planted.push({ p: [x, z], tags: { 'spreefall:fill': 'wood' } });
      wood++;
    });
  }

  let grove = 0;
  const parks = [];
  for (const pk of o.parks || []) {
    const a = area(pk.ring, pk.holes);
    // What the map says about this park, measured on its own grid: how much
    // of it is a mapped wood, how much is mapped open, and what is left.
    let all = 0, mapped = 0, open = 0;
    const rest = [];
    cells(a, (i, k) => {
      const [x, z] = cellTree(i, k);
      if (!inBox(x, z) || !inArea(x, z, a)) return;
      all++;
      if (inWood(x, z)) { mapped++; return; }
      if (inOpen(x, z) || blocked(x, z)) { open++; return; }
      rest.push([i, k, x, z]);
    });
    if (!all) continue;
    // The groves make up what the mapped woods fall short of, out of the
    // ground the map leaves unsaid.
    const want = Math.max(0, Math.min(1, (pk.wooded * all - mapped) / Math.max(1, rest.length)));
    let n = 0;
    for (const [i, k, x, z] of rest) {
      const key = `${i},${k}`;
      if (done.has(key)) continue;
      done.add(key);
      if (!inGrove(x, z, want)) continue;
      if (!free(x, z)) continue;
      planted.push({ p: [x, z], tags: { 'spreefall:fill': 'grove' } });
      n++;
    }
    grove += n;
    parks.push({ name: pk.name || 'park', wooded: pk.wooded, mapped: mapped / all, open: open / all, groves: want });
  }
  return { planted, wood, grove, parks };
}
