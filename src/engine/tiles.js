// Tile streaming. Uploads the tiles around the player, evicts the ones behind,
// and hands the renderer a frustum culled list every frame.

import { VERTEX_STRIDE } from '../shared/constants.js';

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
    this.stats = { resident: 0, visible: 0, uploads: 0, triangles: 0, bytes: 0 };
    this._queue = [];
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
    if (!rec) return null;
    const [ox, oz] = world.tileOrigin(index);
    const tile = {
      index, ox, oz,
      minX: ox + rec.min[0], minY: rec.min[1], minZ: oz + rec.min[2],
      maxX: ox + rec.max[0], maxY: rec.max[1], maxZ: oz + rec.max[2],
      count: rec.iCount,
      indexType: rec.i32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      tris: rec.tris,
      vao: null, vbo: null, ibo: null,
      treeVao: null, treeVbo: null, treeCount: 0,
      bytes: 0,
      lastUsed: 0,
    };

    if (rec.iCount > 0) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER,
        new Uint8Array(world.buffer, rec.vOff, rec.vCount * VERTEX_STRIDE), gl.STATIC_DRAW);

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
      const ibytes = rec.iCount * (rec.i32 ? 4 : 2);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,
        new Uint8Array(world.buffer, rec.iOff, ibytes), gl.STATIC_DRAW);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

      tile.vao = vao; tile.vbo = vbo; tile.ibo = ibo;
      tile.bytes = rec.vCount * VERTEX_STRIDE + ibytes;
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
