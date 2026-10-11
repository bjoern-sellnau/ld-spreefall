// vec2, vec3, vec4, mat4 and quaternions over Float32Array, plus a scratch pool
// so the per frame path never allocates. Every function takes an explicit `out`.

export const EPSILON = 1e-6;

export const vec3 = {
  create: (x = 0, y = 0, z = 0) => { const o = new Float32Array(3); o[0] = x; o[1] = y; o[2] = z; return o; },
  set(o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; },
  copy(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
  add(o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  sub(o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  scale(o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  scaleAndAdd(o, a, b, s) { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
  mul(o, a, b) { o[0] = a[0] * b[0]; o[1] = a[1] * b[1]; o[2] = a[2] * b[2]; return o; },
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  sqrLen: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  cross(o, a, b) {
    const x = a[1] * b[2] - a[2] * b[1];
    const y = a[2] * b[0] - a[0] * b[2];
    const z = a[0] * b[1] - a[1] * b[0];
    o[0] = x; o[1] = y; o[2] = z; return o;
  },
  normalize(o, a) {
    const l = Math.hypot(a[0], a[1], a[2]);
    if (l < EPSILON) { o[0] = 0; o[1] = 0; o[2] = 0; return o; }
    o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o;
  },
  lerp(o, a, b, t) {
    o[0] = a[0] + (b[0] - a[0]) * t;
    o[1] = a[1] + (b[1] - a[1]) * t;
    o[2] = a[2] + (b[2] - a[2]) * t;
    return o;
  },
  transformMat4(o, a, m) {
    const x = a[0], y = a[1], z = a[2];
    let w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w === 0) w = 1;
    const rx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    const ry = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    const rz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    o[0] = rx; o[1] = ry; o[2] = rz; return o;
  },
};

export const vec4 = {
  create: (x = 0, y = 0, z = 0, w = 0) => { const o = new Float32Array(4); o[0] = x; o[1] = y; o[2] = z; o[3] = w; return o; },
  set(o, x, y, z, w) { o[0] = x; o[1] = y; o[2] = z; o[3] = w; return o; },
};

export const vec2 = {
  create: (x = 0, y = 0) => { const o = new Float32Array(2); o[0] = x; o[1] = y; return o; },
  set(o, x, y) { o[0] = x; o[1] = y; return o; },
  len: (a) => Math.hypot(a[0], a[1]),
};

// Column major, the layout WebGL wants.
export const mat4 = {
  create() { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; },
  identity(o) {
    o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o;
  },
  copy(o, a) { o.set(a); return o; },

  multiply(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    o.fill(0);
    o[0] = f / aspect;
    o[5] = f;
    o[11] = -1;
    if (far !== null && far !== Infinity) {
      const nf = 1 / (near - far);
      o[10] = (far + near) * nf;
      o[14] = 2 * far * near * nf;
    } else {
      o[10] = -1;
      o[14] = -2 * near;
    }
    return o;
  },

  ortho(o, left, right, bottom, top, near, far) {
    const lr = 1 / (left - right), bt = 1 / (bottom - top), nf = 1 / (near - far);
    o.fill(0);
    o[0] = -2 * lr; o[5] = -2 * bt; o[10] = 2 * nf;
    o[12] = (left + right) * lr;
    o[13] = (top + bottom) * bt;
    o[14] = (far + near) * nf;
    o[15] = 1;
    return o;
  },

  lookAt(o, eye, centre, up) {
    const zx = eye[0] - centre[0], zy = eye[1] - centre[1], zz = eye[2] - centre[2];
    let zl = Math.hypot(zx, zy, zz);
    if (zl < EPSILON) return mat4.identity(o);
    zl = 1 / zl;
    const z0 = zx * zl, z1 = zy * zl, z2 = zz * zl;
    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    let xl = Math.hypot(x0, x1, x2);
    if (xl < EPSILON) { x0 = 0; x1 = 0; x2 = 0; } else { xl = 1 / xl; x0 *= xl; x1 *= xl; x2 *= xl; }
    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;
    o[0] = x0; o[1] = y0; o[2] = z0; o[3] = 0;
    o[4] = x1; o[5] = y1; o[6] = z1; o[7] = 0;
    o[8] = x2; o[9] = y2; o[10] = z2; o[11] = 0;
    o[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    o[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    o[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    o[15] = 1;
    return o;
  },

  translate(o, a, x, y, z) {
    if (o !== a) o.set(a);
    o[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
    o[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
    o[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
    o[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    return o;
  },

  fromTranslation(o, x, y, z) {
    mat4.identity(o); o[12] = x; o[13] = y; o[14] = z; return o;
  },

  invert(o, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },

  transpose(o, a) {
    if (o === a) {
      const a01 = a[1], a02 = a[2], a03 = a[3], a12 = a[6], a13 = a[7], a23 = a[11];
      o[1] = a[4]; o[2] = a[8]; o[3] = a[12];
      o[4] = a01; o[6] = a[9]; o[7] = a[13];
      o[8] = a02; o[9] = a12; o[11] = a[14];
      o[12] = a03; o[13] = a13; o[14] = a23;
    } else {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[i * 4 + j] = a[j * 4 + i];
    }
    return o;
  },
};

export const quat = {
  create() { const o = new Float32Array(4); o[3] = 1; return o; },
  fromEuler(o, yaw, pitch, roll = 0) {
    const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
    const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
    const cr = Math.cos(roll * 0.5), sr = Math.sin(roll * 0.5);
    o[0] = sr * cp * cy - cr * sp * sy;
    o[1] = cr * sp * cy + sr * cp * sy;
    o[2] = cr * cp * sy - sr * sp * cy;
    o[3] = cr * cp * cy + sr * sp * sy;
    return o;
  },
  normalize(o, a) {
    const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
    o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; o[3] = a[3] / l; return o;
  },
  slerp(o, a, b, t) {
    let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bx = b[0], by = b[1], bz = b[2], bw = b[3];
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let s0, s1;
    if (1 - cos > 1e-6) {
      const omega = Math.acos(cos), sinOm = Math.sin(omega);
      s0 = Math.sin((1 - t) * omega) / sinOm;
      s1 = Math.sin(t * omega) / sinOm;
    } else { s0 = 1 - t; s1 = t; }
    o[0] = s0 * a[0] + s1 * bx;
    o[1] = s0 * a[1] + s1 * by;
    o[2] = s0 * a[2] + s1 * bz;
    o[3] = s0 * a[3] + s1 * bw;
    return o;
  },
  toMat4(o, q) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    o[0] = 1 - (yy + zz); o[1] = xy + wz; o[2] = xz - wy; o[3] = 0;
    o[4] = xy - wz; o[5] = 1 - (xx + zz); o[6] = yz + wx; o[7] = 0;
    o[8] = xz + wy; o[9] = yz - wx; o[10] = 1 - (xx + yy); o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  },
};

// ---------------------------------------------------------------------------
// Frustum, six planes as (nx, ny, nz, d) with n pointing inwards.

export class Frustum {
  constructor() { this.planes = new Float32Array(24); }

  /** Extract from a view projection matrix by the Gribb and Hartmann method. */
  fromMatrix(m) {
    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      const row = i >> 1;
      const sign = (i & 1) ? -1 : 1;
      p[i * 4] = m[3] + sign * m[row];
      p[i * 4 + 1] = m[7] + sign * m[4 + row];
      p[i * 4 + 2] = m[11] + sign * m[8 + row];
      p[i * 4 + 3] = m[15] + sign * m[12 + row];
      const l = Math.hypot(p[i * 4], p[i * 4 + 1], p[i * 4 + 2]) || 1;
      p[i * 4] /= l; p[i * 4 + 1] /= l; p[i * 4 + 2] /= l; p[i * 4 + 3] /= l;
    }
    return this;
  }

  /** True when the axis aligned box is at least partly inside. */
  containsAabb(minX, minY, minZ, maxX, maxY, maxZ) {
    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      const a = p[i * 4], b = p[i * 4 + 1], c = p[i * 4 + 2], d = p[i * 4 + 3];
      // The corner furthest along the plane normal.
      const x = a >= 0 ? maxX : minX;
      const y = b >= 0 ? maxY : minY;
      const z = c >= 0 ? maxZ : minZ;
      if (a * x + b * y + c * z + d < 0) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Ray tests

/** Slab test. Returns the entry distance, or -1 when there is no hit. */
export function rayAabb(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const lo = [minX, minY, minZ], hi = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
    } else {
      const inv = 1 / d[i];
      let t1 = (lo[i] - o[i]) * inv, t2 = (hi[i] - o[i]) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmax < 0 ? -1 : (tmin < 0 ? 0 : tmin);
}

/** Moeller Trumbore. Returns the distance, or -1. */
export function rayTriangle(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-6 ? t : -1;
}

// ---------------------------------------------------------------------------
// Scratch pool. Borrow, use, release, all without touching the allocator.

class Pool {
  constructor(size, count) {
    this.items = [];
    for (let i = 0; i < count; i++) this.items.push(new Float32Array(size));
    this.next = 0;
    this.count = count;
  }
  get() {
    const v = this.items[this.next];
    this.next = (this.next + 1) % this.count;
    return v;
  }
}

const v3Pool = new Pool(3, 64);
const m4Pool = new Pool(16, 32);

export const tmpVec3 = () => v3Pool.get();
export const tmpMat4 = () => m4Pool.get();

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const TAU = Math.PI * 2;
