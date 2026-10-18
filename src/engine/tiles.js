// Tile streaming. Uploads the tiles around the player, evicts the ones behind,
// and hands the renderer a frustum culled list every frame.

import { VERTEX_STRIDE } from '../shared/constants.js';
import { tileMesh } from './world.js';

export const ATTRIB = {
  POSITION: 0,
  NORMAL: 1,
  UV: 2,
  PACKED: 3,
  HEIGHT: 4,
  INSTANCE: 5,
};

export class TileManager {
  constructor(gl, world, opts = {}) {
    this.gl = gl;
    this.world = world;
    this.resident = new Map();          // index -> gpu tile
    this.uploadRadius = opts.uploadRadius || 760;
    this.evictRadius = opts.evictRadius || 1000;
    this.maxResident = opts.maxResident || 520;
    this.uploadsPerFrame = opts.uploadsPerFrame || 6;
    this.visible = [];
    this.stats = { resident: 0, visible: 0, uploads: 0, triangles: 0, bytes: 0, skyline: 0 };
    this._queue = [];

    // Tiles carrying something tall enough to be part of the skyline stay
    // resident wherever the player is. Without this the Fernsehturm, which is
    // two kilometres from the Gate, simply is not there when you look east, and
    // that view is the whole point of the fog. There are only a couple of dozen
    // of them and they cost about twelve thousand triangles in total.
    this.skyline = [];
    this.skylineSet = new Set();
    // Tiles the city does not have in memory yet. Without this the uploader
    // spends every frame queueing the same two hundred holes in the grid where
    // a district has not arrived.
    this.absent = new Set();
    this.addSkyline(world.tiles);
    // Districts come and go while the game runs, so the skyline grows with
    // them and whatever is on the card for a district that goes is freed.
    world.onDistrict = (district) => {
      for (const t of district.indices) this.absent.delete(t);
      this.addSkyline(district.manifest.tiles);
      for (const index of this.skyline) {
        if (!this.resident.has(index)) this.upload(index);
      }
    };
    world.onDrop = (district, indices) => {
      for (const t of indices) {
        this.evict(t);
        this.absent.delete(t);
        if (this.skylineSet.has(t)) {
          this.skylineSet.delete(t);
          const at = this.skyline.indexOf(t);
          if (at >= 0) this.skyline.splice(at, 1);
        }
      }
      this.stats.skyline = this.skyline.length;
    };
  }

  /**
   * Anything tall enough to be seen from the next district over stays
   * resident, wherever you are.
   *
   * @param {Array} records tile records, sparse or dense
   */
  addSkyline(records) {
    for (const rec of records) {
      if (!rec || rec.tris <= 0 || rec.max[1] <= 40) continue;
      const index = rec.t !== undefined ? rec.t : records.indexOf(rec);
      if (this.skylineSet.has(index)) continue;
      this.skyline.push(index);
      this.skylineSet.add(index);
    }
    this.stats.skyline = this.skyline.length;
  }

  /** Upload the skyline tiles once, before the first frame. */
  primeSkyline() {
    for (const index of this.skyline) if (!this.resident.has(index)) this.upload(index);
  }

  setQuality(tier) {
    if (tier === 'low') { this.uploadRadius = 460; this.evictRadius = 620; this.uploadsPerFrame = 3; }
    else if (tier === 'medium') { this.uploadRadius = 640; this.evictRadius = 860; this.uploadsPerFrame = 5; }
    else { this.uploadRadius = 900; this.evictRadius = 1200; this.uploadsPerFrame = 8; }
  }

  upload(index) {
    const gl = this.gl;
    const world = this.world;
    const rec = world.tiles[index];
    if (!rec) { this.absent.add(index); return null; }
    const [ox, oz] = world.tileOrigin(index);
    // Its own buffer if the game has re-meshed it, the file's bytes if not.
    const m = tileMesh(rec);
    const tile = {
      index, ox, oz,
      minX: ox + m.min[0], minY: m.min[1], minZ: oz + m.min[2],
      maxX: ox + m.max[0], maxY: m.max[1], maxZ: oz + m.max[2],
      count: m.iCount,
      indexType: m.i32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      tris: m.tris,
      vao: null, vbo: null, ibo: null,
      treeVao: null, treeVbo: null, treeCount: 0,
      bytes: 0,
      lastUsed: 0,
    };

    if (m.iCount > 0) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER,
        new Uint8Array(m.buffer, m.vOff, m.vCount * VERTEX_STRIDE), gl.STATIC_DRAW);

      gl.enableVertexAttribArray(ATTRIB.POSITION);
      gl.vertexAttribIPointer(ATTRIB.POSITION, 3, gl.SHORT, VERTEX_STRIDE, 0);
      gl.enableVertexAttribArray(ATTRIB.NORMAL);
      gl.vertexAttribPointer(ATTRIB.NORMAL, 4, gl.BYTE, true, VERTEX_STRIDE, 6);
      gl.enableVertexAttribArray(ATTRIB.UV);
      gl.vertexAttribIPointer(ATTRIB.UV, 2, gl.UNSIGNED_SHORT, VERTEX_STRIDE, 10);
      gl.enableVertexAttribArray(ATTRIB.PACKED);
      gl.vertexAttribIPointer(ATTRIB.PACKED, 4, gl.UNSIGNED_BYTE, VERTEX_STRIDE, 14);
      gl.enableVertexAttribArray(ATTRIB.HEIGHT);
      gl.vertexAttribIPointer(ATTRIB.HEIGHT, 1, gl.UNSIGNED_SHORT, VERTEX_STRIDE, 18);

      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      const ibytes = m.iCount * (m.i32 ? 4 : 2);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,
        new Uint8Array(m.buffer, m.iOff, ibytes), gl.STATIC_DRAW);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

      tile.vao = vao; tile.vbo = vbo; tile.ibo = ibo;
      tile.bytes = m.vCount * VERTEX_STRIDE + ibytes;
    }

    const trees = world.trees(index);
    if (trees) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, trees, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(ATTRIB.INSTANCE);
      gl.vertexAttribPointer(ATTRIB.INSTANCE, 4, gl.FLOAT, false, 20, 0);
      gl.vertexAttribDivisor(ATTRIB.INSTANCE, 1);
      gl.enableVertexAttribArray(ATTRIB.INSTANCE + 1);
      gl.vertexAttribPointer(ATTRIB.INSTANCE + 1, 1, gl.FLOAT, false, 20, 16);
      gl.vertexAttribDivisor(ATTRIB.INSTANCE + 1, 1);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      tile.treeVao = vao;
      tile.treeVbo = vbo;
      tile.treeCount = trees.length / 5;
      tile.bytes += trees.byteLength;
    }

    this.resident.set(index, tile);
    return tile;
  }

  /**
   * The bytes of a tile changed under us, because a ruin was baked into them.
   * The simplest correct answer is to throw the tile away and upload it
   * again from the district buffer: it is one tile, it happens when a
   * building finishes falling, and anything cleverer would have to know which
   * vertices moved.
   *
   * @param {Iterable<number>} indices tiles whose bytes were rewritten
   */
  refresh(indices) {
    for (const index of indices) {
      if (!this.resident.has(index)) continue;
      this.evict(index);
      this.upload(index);
    }
  }

  /**
   * One tile's trees changed, because one of them burnt down. Only the
   * instance buffer is rebuilt; the tile's own geometry is untouched.
   */
  refreshTrees(index) {
    const gl = this.gl;
    const tile = this.resident.get(index);
    if (!tile) return;
    const trees = this.world.trees(index);
    if (!trees) {
      if (tile.treeVao) gl.deleteVertexArray(tile.treeVao);
      if (tile.treeVbo) gl.deleteBuffer(tile.treeVbo);
      tile.treeVao = null; tile.treeVbo = null; tile.treeCount = 0;
      return;
    }
    if (!tile.treeVbo) { this.evict(index); this.upload(index); return; }
    gl.bindBuffer(gl.ARRAY_BUFFER, tile.treeVbo);
    gl.bufferData(gl.ARRAY_BUFFER, trees, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    tile.treeCount = trees.length / 5;
  }

  evict(index) {
    const gl = this.gl;
    const tile = this.resident.get(index);
    if (!tile) return;
    if (tile.vao) gl.deleteVertexArray(tile.vao);
    if (tile.vbo) gl.deleteBuffer(tile.vbo);
    if (tile.ibo) gl.deleteBuffer(tile.ibo);
    if (tile.treeVao) gl.deleteVertexArray(tile.treeVao);
    if (tile.treeVbo) gl.deleteBuffer(tile.treeVbo);
    this.resident.delete(index);
  }

  /** Queue the tiles near the player, nearest first, and evict the far ones. */
  updateResidency(px, pz, frame) {
    const world = this.world;
    const ts = world.tileSize;
    const r = Math.ceil(this.uploadRadius / ts);
    const ctx = Math.floor((px - world.minX) / ts);
    const ctz = Math.floor((pz - world.minZ) / ts);
    this._queue.length = 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = ctx + dx, tz = ctz + dz;
        if (tx < 0 || tz < 0 || tx >= world.nx || tz >= world.nz) continue;
        const cx = world.minX + (tx + 0.5) * ts;
        const cz = world.minZ + (tz + 0.5) * ts;
        const d = Math.hypot(cx - px, cz - pz);
        if (d > this.uploadRadius) continue;
        const index = tz * world.nx + tx;
        const t = this.resident.get(index);
        if (t) { t.lastUsed = frame; continue; }
        if (this.absent.has(index)) continue;
        this._queue.push([d, index]);
      }
    }
    this._queue.sort((a, b) => a[0] - b[0]);
    let uploads = 0;
    for (const [, index] of this._queue) {
      if (uploads >= this.uploadsPerFrame) break;
      const t = this.upload(index);
      if (t) t.lastUsed = frame;
      uploads++;
    }
    this.stats.uploads = uploads;

    // Evict.
    if (this.resident.size > this.maxResident || uploads === 0) {
      for (const [index, tile] of this.resident) {
        if (this.skylineSet.has(index)) continue;
        const cx = tile.ox + ts * 0.5, cz = tile.oz + ts * 0.5;
        if (Math.hypot(cx - px, cz - pz) > this.evictRadius) this.evict(index);
      }
    }
    this.stats.resident = this.resident.size;
  }

  /** Frustum cull into this.visible, sorted near to far. */
  cull(frustum, px, pz) {
    this.visible.length = 0;
    let tris = 0, bytes = 0;
    for (const tile of this.resident.values()) {
      if (!tile.vao && !tile.treeVao) continue;
      if (!frustum.containsAabb(tile.minX, tile.minY - 2, tile.minZ, tile.maxX, tile.maxY + 2, tile.maxZ)) continue;
      tile.dist = Math.hypot((tile.minX + tile.maxX) * 0.5 - px, (tile.minZ + tile.maxZ) * 0.5 - pz);
      this.visible.push(tile);
      tris += tile.tris;
      bytes += tile.bytes;
    }
    this.visible.sort((a, b) => a.dist - b.dist);
    this.stats.visible = this.visible.length;
    this.stats.triangles = tris;
    this.stats.bytes = bytes;
    return this.visible;
  }

  /** Every resident tile that overlaps the box, for the shadow pass. */
  collectBox(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    for (const tile of this.resident.values()) {
      if (!tile.vao) continue;
      if (tile.maxX < minX || tile.minX > maxX || tile.maxZ < minZ || tile.minZ > maxZ) continue;
      out.push(tile);
    }
    return out;
  }

  disposeAll() {
    for (const index of [...this.resident.keys()]) this.evict(index);
  }
}
