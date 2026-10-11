// A plain triangle soup with the attributes the runtime shader wants. The
// pipeline builds one of these for the whole world and the tiler cuts it up.

export class Mesh {
  constructor() {
    this.px = []; this.py = []; this.pz = [];
    this.nx = []; this.ny = []; this.nz = [];
    this.u = []; this.v = [];
    this.mat = []; this.seed = []; this.levels = []; this.flags = []; this.hgt = []; this.ao = [];
    this.idx = [];
  }

  get vertexCount() { return this.px.length; }
  get triangleCount() { return this.idx.length / 3; }

  vertex(x, y, z, nx, ny, nz, u, v, mat, seed = 0, levels = 0, flags = 0, hgt = 0, ao = 255) {
    this.px.push(x); this.py.push(y); this.pz.push(z);
    this.nx.push(nx); this.ny.push(ny); this.nz.push(nz);
    this.u.push(u); this.v.push(v);
    this.mat.push(mat); this.seed.push(seed); this.levels.push(levels);
    this.flags.push(flags); this.hgt.push(hgt); this.ao.push(ao);
    return this.px.length - 1;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
}

/** Newell normal of a polygon given as [x, y, z] triples. */
export function polygonNormal(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j], b = pts[i];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}
