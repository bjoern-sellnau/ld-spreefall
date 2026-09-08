// The world data: manifest, binary bundle, ground height field, surface map and
// the collision segment lookup. Everything the simulation needs, none of the GPU.

import { TILE_SIZE, COLLISION_GRID, GROUND_SCALE, SURFACE } from '../shared/constants.js';

export class World {
  constructor(manifest, buffer) {
    this.manifest = manifest;
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.tileSize = manifest.tileSize;
    this.nx = manifest.tileCountX;
    this.nz = manifest.tileCountZ;
    this.minX = manifest.world.minX;
    this.minZ = manifest.world.minZ;
    this.maxX = manifest.world.maxX;
    this.maxZ = manifest.world.maxZ;
    this.waterLevel = manifest.waterLevel;
    this.tiles = manifest.tiles;
    this.collisionCache = new Map();
    this.heightCache = new Map();
    const sg = manifest.surfaceGrid;
    this.surface = {
      step: sg.step, nx: sg.nx, nz: sg.nz,
      data: new Uint8Array(buffer, sg.offset, sg.length),
    };
  }

  static async load(base = '', onProgress = null) {
    const manifest = await fetch(`${base}world.json`).then((r) => {
      if (!r.ok) throw new Error(`world.json: ${r.status}`);
      return r.json();
    });
    const res = await fetch(`${base}world.bin`);
    if (!res.ok) throw new Error(`world.bin: ${res.status}`);
    const total = parseInt(res.headers.get('content-length') || '0', 10);
    let buffer;
    if (res.body && onProgress) {
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress(total ? got / total : Math.min(0.99, got / 10e6));
      }
      const out = new Uint8Array(got);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      buffer = out.buffer;
    } else {
      buffer = await res.arrayBuffer();
    }
    if (onProgress) onProgress(1);
    return new World(manifest, buffer);
  }

  tileIndex(x, z) {
    const tx = Math.floor((x - this.minX) / this.tileSize);
    const tz = Math.floor((z - this.minZ) / this.tileSize);
    if (tx < 0 || tz < 0 || tx >= this.nx || tz >= this.nz) return -1;
    return tz * this.nx + tx;
  }

  tileOrigin(index) {
    const tx = index % this.nx, tz = (index / this.nx) | 0;
    return [this.minX + tx * this.tileSize, this.minZ + tz * this.tileSize];
  }

  // --- ground -------------------------------------------------------------

  heightField(index) {
    let hf = this.heightCache.get(index);
    if (hf) return hf;
    const rec = this.tiles[index];
    if (!rec) return null;
    const segs = this.view.getUint16(rec.cOff, true);
    const gridOff = rec.cOff + 4 + segs * 12;
    hf = new Int16Array(COLLISION_GRID * COLLISION_GRID);
    for (let i = 0; i < hf.length; i++) hf[i] = this.view.getInt16(gridOff + i * 2, true);
    this.heightCache.set(index, hf);
    return hf;
  }

  /** Bilinear ground height. Outside the box it clamps to the edge tile. */
  groundHeight(x, z) {
    const cx = Math.min(this.maxX - 0.001, Math.max(this.minX, x));
    const cz = Math.min(this.maxZ - 0.001, Math.max(this.minZ, z));
    const index = this.tileIndex(cx, cz);
    if (index < 0) return 0;
    const hf = this.heightField(index);
    if (!hf) return 0;
    const [ox, oz] = this.tileOrigin(index);
    const n = COLLISION_GRID - 1;
    const fx = Math.min(n, Math.max(0, ((cx - ox) / this.tileSize) * n));
    const fz = Math.min(n, Math.max(0, ((cz - oz) / this.tileSize) * n));
    const ix = Math.min(n - 1, Math.floor(fx));
    const iz = Math.min(n - 1, Math.floor(fz));
    const tx = fx - ix, tz = fz - iz;
    const h00 = hf[iz * COLLISION_GRID + ix];
    const h10 = hf[iz * COLLISION_GRID + ix + 1];
    const h01 = hf[(iz + 1) * COLLISION_GRID + ix];
    const h11 = hf[(iz + 1) * COLLISION_GRID + ix + 1];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return (a + (b - a) * tz) / GROUND_SCALE;
  }

  surfaceAt(x, z) {
    const s = this.surface;
    const ix = Math.round((x - this.minX) / s.step);
    const iz = Math.round((z - this.minZ) / s.step);
    if (ix < 0 || iz < 0 || ix >= s.nx || iz >= s.nz) return SURFACE.ASPHALT;
    return s.data[iz * s.nx + ix];
  }

  // --- collision ----------------------------------------------------------

  /**
   * Segments for one tile, as a flat Float32Array of six values each:
   * x1, z1, x2, z2, base, top, in world metres.
   */
  segments(index) {
    let segs = this.collisionCache.get(index);
    if (segs) return segs;
    const rec = this.tiles[index];
    if (!rec) return new Float32Array(0);
    const count = this.view.getUint16(rec.cOff, true);
    const [ox, oz] = this.tileOrigin(index);
    segs = new Float32Array(count * 6);
    let p = rec.cOff + 4;
    for (let i = 0; i < count; i++) {
      segs[i * 6] = this.view.getInt16(p, true) / 64 + ox;
      segs[i * 6 + 1] = this.view.getInt16(p + 2, true) / 64 + oz;
      segs[i * 6 + 2] = this.view.getInt16(p + 4, true) / 64 + ox;
      segs[i * 6 + 3] = this.view.getInt16(p + 6, true) / 64 + oz;
      segs[i * 6 + 4] = this.view.getInt16(p + 8, true) / 32;
      segs[i * 6 + 5] = this.view.getInt16(p + 10, true) / 32;
      p += 12;
    }
    this.collisionCache.set(index, segs);
    return segs;
  }

  /** Call fn(segments, count) for every tile overlapping the box. */
  forEachSegmentTile(minX, minZ, maxX, maxZ, fn) {
    const tx0 = Math.max(0, Math.floor((minX - this.minX) / this.tileSize));
    const tx1 = Math.min(this.nx - 1, Math.floor((maxX - this.minX) / this.tileSize));
    const tz0 = Math.max(0, Math.floor((minZ - this.minZ) / this.tileSize));
    const tz1 = Math.min(this.nz - 1, Math.floor((maxZ - this.minZ) / this.tileSize));
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const segs = this.segments(tz * this.nx + tx);
        if (segs.length) fn(segs, segs.length / 6);
      }
    }
  }

  /** Trees packed in a tile, unpacked to world space. */
  trees(index) {
    const rec = this.tiles[index];
    if (!rec || !rec.trCount) return null;
    const [ox, oz] = this.tileOrigin(index);
    const out = new Float32Array(rec.trCount * 5);
    for (let i = 0; i < rec.trCount; i++) {
      const o = rec.trOff + i * 8;
      out[i * 5] = this.view.getInt16(o, true) / 64 + ox;
      out[i * 5 + 1] = this.view.getInt16(o + 2, true) / 64;
      out[i * 5 + 2] = this.view.getInt16(o + 4, true) / 64 + oz;
      out[i * 5 + 3] = this.view.getUint8(o + 6) / 8;
      out[i * 5 + 4] = this.view.getUint8(o + 7);
    }
    return out;
  }
}
