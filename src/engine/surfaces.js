// Surface maps, generated at load time.
//
// Everything in this city is shaded procedurally, which gets the structure
// right: a road knows where its own centre line is, a pavement knows where
// its joints are, and both stay sharp at any angle because the pattern is
// widened to the pixel footprint instead of being faded out by eye. What it
// does not get is grain. A fractal noise evaluated per pixel costs a dozen
// texture-free instructions, aliases the moment a feature goes sub pixel, and
// has to be faded away at distance, which is why the middle distance of this
// city has always been flat colour.
//
// So the grain is baked instead. These are tiling maps, built once when the
// page loads, out of the same kind of noise the shader used to run per pixel,
// and handed to the card as one array texture with a mip chain on it. The
// card then does the averaging for free, which is the thing a mip chain is
// for, and a surface keeps its texture out to the horizon rather than going
// smooth at thirty metres.
//
// Nothing is downloaded. This is a few hundred lines of arithmetic over a
// megabyte of bytes, which is about a frame's work, and it is why there is no
// texture file anywhere in this project.
//
// One layer per material, four channels, and they are deliberately not an
// albedo: the colour of a wall comes from the palette and the colour of a
// road comes from the shader, so what is stored here is what the surface does
// to the light rather than what colour it is.
//
//   R, G  the surface normal in tangent space, x and y, around 0.5
//   B     the grain: a multiplier on the albedo, around 0.5 for no change
//   A     ambient occlusion: how buried this point is in its own relief

/** How wide each layer is. */
export const SURFACE_SIZE = 256;

/**
 * Which layer each material uses, and how many metres of world one tile of
 * it covers. The scale matters as much as the pattern: asphalt at half a
 * metre is sandpaper and at eight metres is a tarpaulin.
 */
export const SURFACE_LAYER = {
  asphalt: 0,
  cobble: 1,
  pavement: 2,
  gravel: 3,
  roof: 4,
  brick: 5,
  stone: 6,
  plaster: 7,
  grass: 8,
  metal: 9,
};

export const SURFACE_COUNT = Object.keys(SURFACE_LAYER).length;

/** How many metres across one tile of each layer is. */
export const SURFACE_SCALE = {
  asphalt: 3.0,
  cobble: 2.4,
  pavement: 3.0,
  gravel: 1.6,
  roof: 2.0,
  brick: 2.4,
  stone: 3.2,
  plaster: 3.2,
  grass: 2.6,
  metal: 2.0,
};

// --- noise ----------------------------------------------------------------
// Periodic, so a tile meets itself on every edge. An ordinary hash of the
// integer lattice does not do that: the cell at the right hand edge has to be
// the cell at the left hand one, which means the lattice coordinates wrap
// before they are hashed rather than after.

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

/** Value noise on a lattice that repeats every `period` cells. */
function valueNoise(x, y, period, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = fade(x - x0), fy = fade(y - y0);
  const wrap = (v) => ((v % period) + period) % period;
  const xa = wrap(x0), xb = wrap(x0 + 1);
  const ya = wrap(y0), yb = wrap(y0 + 1);
  const a = hash2(xa, ya, seed), b = hash2(xb, ya, seed);
  const c = hash2(xa, yb, seed), d = hash2(xb, yb, seed);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/**
 * Fractal noise over the periodic lattice. `cells` is how many cells of the
 * first octave fit across the tile, so every octave after it is still a whole
 * number of cells and the tile still meets itself.
 */
function fbm(u, v, cells, octaves, seed) {
  let sum = 0, amp = 0.5, total = 0, period = cells;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u * period, v * period, period, seed + o * 101) * amp;
    total += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / total;
}

/** Worley cells on a periodic lattice: distance to the nearest point, 0..1. */
function cellNoise(u, v, cells, seed) {
  const x = u * cells, y = v * cells;
  const xi = Math.floor(x), yi = Math.floor(y);
  const wrap = (p) => ((p % cells) + cells) % cells;
  let best = 9, second = 9, bestId = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const wx = wrap(cx), wy = wrap(cy);
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 7);
      const d = Math.hypot(px - x, py - y);
      if (d < best) { second = best; best = d; bestId = hash2(wx, wy, seed + 13); }
      else if (d < second) second = d;
    }
  }
  return { near: Math.min(1, best), edge: Math.min(1, second - best), id: bestId };
}

// --- the height field each material has -----------------------------------
// Each of these answers one question: how high is this material at this point
// on its own tile, in metres of relief. Everything else in a layer, the
// normal, the grain and the occlusion, is worked out from that one answer, so
// a material is described once rather than three times over.

function heightAt(kind, u, v) {
  switch (kind) {
    case 'asphalt': {
      // Chippings in bitumen: a fine rough with a slow swell under it, which
      // is what makes a road read as laid rather than as painted on.
      const fine = fbm(u, v, 24, 4, 11);
      const swell = fbm(u, v, 3, 2, 29);
      return fine * 0.0022 + swell * 0.004;
    }
    case 'cobble': {
      // Berlin sett. The stones themselves are drawn by the shader, which
      // knows where the kerb is; what is baked is the pitting on top of them
      // and the sand in the joints.
      const c = cellNoise(u, v, 18, 3);
      const pit = fbm(u, v, 32, 3, 41);
      return c.near * 0.004 + pit * 0.0016;
    }
    case 'pavement': {
      // Cast slabs: almost flat, with the aggregate just showing through.
      const grit = fbm(u, v, 40, 3, 53);
      return grit * 0.0015 + fbm(u, v, 5, 2, 59) * 0.0012;
    }
    case 'gravel': {
      const c = cellNoise(u, v, 26, 61);
      return (1.0 - c.near) * 0.012 + fbm(u, v, 48, 2, 67) * 0.002;
    }
    case 'roof': {
      // Pantiles: the shader lays the courses, this is the clay itself.
      const grain = fbm(u, v, 22, 3, 71);
      return grain * 0.003 + fbm(u, v, 6, 2, 73) * 0.002;
    }
    case 'brick': {
      // Fired brick, pitted and uneven, with the sand of the mortar on top.
      const pit = fbm(u, v, 36, 4, 79);
      const swell = fbm(u, v, 8, 2, 83);
      return pit * 0.0035 + swell * 0.0025;
    }
    case 'stone': {
      // Dressed sandstone: a tooled face rather than a rough one.
      const tool = fbm(u * 3.0, v, 20, 3, 89);
      const grain = fbm(u, v, 30, 3, 97);
      return tool * 0.0024 + grain * 0.0012;
    }
    case 'plaster': {
      // Rendered and painted. Nearly flat, which is the point: what gives a
      // Berlin block its surface is the trowel under the paint.
      // Fine. The first pass had it at seven cells across three metres,
      // which is half metre blobs, and a Berlin frontage came out looking
      // like it had damp rather than render on it.
      const trowel = fbm(u, v, 18, 3, 103);
      return trowel * 0.0022 + fbm(u, v, 44, 2, 107) * 0.0007;
    }
    case 'grass': {
      const tuft = fbm(u, v, 34, 3, 109);
      return tuft * 0.010 + fbm(u, v, 5, 2, 113) * 0.006;
    }
    case 'metal': {
      // Rolled sheet: a faint directional swell and nothing else.
      return fbm(u, v * 2.5, 12, 3, 127) * 0.0016;
    }
    default:
      return 0;
  }
}

/** How much the grain changes the albedo, as a share either side of one. */
const GRAIN = {
  asphalt: 0.34, cobble: 0.26, pavement: 0.22, gravel: 0.42, roof: 0.30,
  brick: 0.34, stone: 0.24, plaster: 0.13, grass: 0.46, metal: 0.16,
};

/**
 * One layer, as RGBA bytes.
 *
 * The normal is a central difference on the height field, in the same units
 * the height is in, so a material whose relief is measured in millimetres
 * gets a normal that leans by about as much as the real thing does. The
 * occlusion is the drop from the local average: a point sitting in a hollow
 * of its own surface sees less of the sky than one on a ridge, and that is
 * the whole of what makes baked relief read as relief rather than as a
 * pattern of light and dark.
 *
 * @param {string} kind a key of SURFACE_LAYER
 * @param {number} size pixels on a side
 * @returns {Uint8Array} size * size * 4 bytes
 */
export function surfaceLayer(kind, size = SURFACE_SIZE) {
  const out = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) h[y * size + x] = heightAt(kind, x / size, y / size);
  }
  // Metres across one pixel of the tile, so the slope is a real slope.
  const step = (SURFACE_SCALE[kind] || 2.0) / size;
  const grain = GRAIN[kind] ?? 0.25;
  // The height the occlusion is measured against, and the spread of the
  // height field, so a material with a millimetre of relief and one with a
  // centimetre both come out using the whole of the byte.
  let lo = Infinity, hi = -Infinity, sum = 0;
  for (let i = 0; i < h.length; i++) {
    if (h[i] < lo) lo = h[i];
    if (h[i] > hi) hi = h[i];
    sum += h[i];
  }
  const mean = sum / h.length;
  const span = Math.max(1e-6, hi - lo);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xm = (x + size - 1) % size, xp = (x + 1) % size;
      const ym = (y + size - 1) % size, yp = (y + 1) % size;
      const dx = (h[y * size + xp] - h[y * size + xm]) / (2 * step);
      const dy = (h[yp * size + x] - h[ym * size + x]) / (2 * step);
      // A normal out of two slopes, normalised, then folded into a byte.
      const len = Math.hypot(-dx, -dy, 1);
      const nx = -dx / len, ny = -dy / len;
      const level = (h[i] - lo) / span;
      const ao = 1 - Math.max(0, (mean - h[i]) / span) * 1.4;
      const g = 0.5 + ((level - 0.5) * 2) * grain * 0.5;
      const o = i * 4;
      out[o] = Math.max(0, Math.min(255, Math.round((nx * 0.5 + 0.5) * 255)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round((ny * 0.5 + 0.5) * 255)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(g * 255)));
      out[o + 3] = Math.max(0, Math.min(255, Math.round(Math.max(0, ao) * 255)));
    }
  }
  return out;
}

/**
 * Every layer, back to back, in the order SURFACE_LAYER gives them: the shape
 * texImage3D wants for an array texture.
 *
 * @returns {{data: Uint8Array, size: number, layers: number, millis: number}}
 */
export function buildSurfaceMaps(size = SURFACE_SIZE) {
  const started = (typeof performance !== 'undefined' ? performance : Date).now();
  const names = Object.keys(SURFACE_LAYER).sort((a, b) => SURFACE_LAYER[a] - SURFACE_LAYER[b]);
  const data = new Uint8Array(size * size * 4 * names.length);
  names.forEach((name, i) => data.set(surfaceLayer(name, size), i * size * size * 4));
  const ended = (typeof performance !== 'undefined' ? performance : Date).now();
  return { data, size, layers: names.length, millis: Math.round(ended - started) };
}
