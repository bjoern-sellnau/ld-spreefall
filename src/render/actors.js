// Everything that moves: the drones, the tracers and sparks, and the weapon in
// your hands. All of the geometry is generated here in JavaScript, because the
// project ships no models.

import { createProgram } from '../engine/gl.js';
import { mat4 } from '../engine/math.js';
import {
  DRONE_VS, DRONE_FS, DRONE_SHADOW_VS, DRONE_SHADOW_FS,
  SPARK_VS, SPARK_FS, VIEWMODEL_VS, VIEWMODEL_FS,
} from '../shaders/actors.js';

const MAX_DRONES = 48;
const MAX_SPARKS = 256;

// --- mesh building ---------------------------------------------------------

/** True when the triangle's own normal agrees with the one it declares. */
function facesForward(a, b, c, n) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
  return gx * n[0] + gy * n[1] + gz * n[2] >= 0;
}

export class MeshBuild {
  constructor() { this.v = []; this.i = []; this.n = 0; }

  /** A box from its centre, with a part id carried through to the shader. */
  box(cx, cy, cz, w, h, d, part, rotY = 0) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const P = (x, y, z) => [cx + x * c - z * s, cy + y, cz + x * s + z * c];
    const N = (x, y, z) => [x * c - z * s, y, x * s + z * c];
    const faces = [
      { n: N(1, 0, 0), p: [P(hw, -hh, -hd), P(hw, -hh, hd), P(hw, hh, hd), P(hw, hh, -hd)] },
      { n: N(-1, 0, 0), p: [P(-hw, -hh, hd), P(-hw, -hh, -hd), P(-hw, hh, -hd), P(-hw, hh, hd)] },
      { n: N(0, 0, 1), p: [P(hw, -hh, hd), P(-hw, -hh, hd), P(-hw, hh, hd), P(hw, hh, hd)] },
      { n: N(0, 0, -1), p: [P(-hw, -hh, -hd), P(hw, -hh, -hd), P(hw, hh, -hd), P(-hw, hh, -hd)] },
      { n: [0, 1, 0], p: [P(-hw, hh, -hd), P(hw, hh, -hd), P(hw, hh, hd), P(-hw, hh, hd)] },
      { n: [0, -1, 0], p: [P(-hw, -hh, hd), P(hw, -hh, hd), P(hw, -hh, -hd), P(-hw, -hh, -hd)] },
    ];
    for (const f of faces) this.quad(f.p, f.n, part);
  }

  // Faces are wound to agree with the normal they declare rather than trusting
  // the order they were written in. Getting this wrong means back face culling
  // eats the whole model, which is a silent and very confusing failure.
  quad(p, n, part) {
    const base = this.n;
    for (const q of p) this.vertex(q, n, part);
    if (facesForward(p[0], p[1], p[2], n)) {
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.i.push(base + 2, base + 1, base, base + 3, base + 2, base);
    }
  }

  tri(p, n, part) {
    const base = this.n;
    for (const q of p) this.vertex(q, n, part);
    if (facesForward(p[0], p[1], p[2], n)) this.i.push(base, base + 1, base + 2);
    else this.i.push(base + 2, base + 1, base);
  }

  vertex(p, n, part) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], part, 0);
    this.n++;
  }

  cylinder(cx, cy, cz, rBottom, rTop, h, seg, part, axis = 'y') {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const at = (c, s, r, t) => (axis === 'y'
        ? [cx + c * r, cy + t, cz + s * r]
        : [cx + c * r, cy + s * r, cz + t]);
      const nAt = (c, s) => (axis === 'y' ? [c, 0, s] : [c, s, 0]);
      this.quad(
        [at(c0, s0, rBottom, 0), at(c1, s1, rBottom, 0), at(c1, s1, rTop, h), at(c0, s0, rTop, h)],
        nAt((c0 + c1) / 2, (s0 + s1) / 2), part,
      );
    }
    // Caps.
    const capN = axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    for (const [r, t, sign] of [[rTop, h, 1], [rBottom, 0, -1]]) {
      if (r < 0.001) continue;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const at = (a, rr) => (axis === 'y'
          ? [cx + Math.cos(a) * rr, cy + t, cz + Math.sin(a) * rr]
          : [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, cz + t]);
        const centre = axis === 'y' ? [cx, cy + t, cz] : [cx, cy, cz + t];
        const n = capN.map((c) => c * sign);
        const p = sign > 0 ? [centre, at(a0, r), at(a1, r)] : [centre, at(a1, r), at(a0, r)];
        this.tri(p, n, part);
      }
    }
  }

  icosphere(cx, cy, cz, r, seg, rings, part) {
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const at = (ii, jj) => {
          const phi = (jj / rings) * Math.PI - Math.PI / 2;
          const th = (ii / seg) * Math.PI * 2;
          return [
            cx + Math.cos(phi) * Math.cos(th) * r,
            cy + Math.sin(phi) * r,
            cz + Math.cos(phi) * Math.sin(th) * r,
          ];
        };
        const p = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        const n = p.map((q) => [(q[0] - cx) / r, (q[1] - cy) / r, (q[2] - cz) / r]);
        const base = this.n;
        for (let k = 0; k < 4; k++) this.vertex(p[k], n[k], part);
        if (facesForward(p[0], p[1], p[2], n[0])) {
          this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
        } else {
          this.i.push(base + 2, base + 1, base, base + 3, base + 2, base);
        }
      }
    }
  }

  /** A flat ring, used for the blurred rotor discs. */
  ring(cx, cy, cz, rInner, rOuter, seg, part) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const at = (a, r) => [cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r];
      this.quad([at(a0, rInner), at(a1, rInner), at(a1, rOuter), at(a0, rOuter)], [0, 1, 0], part);
      this.quad([at(a0, rOuter), at(a1, rOuter), at(a1, rInner), at(a0, rInner)], [0, -1, 0], part);
    }
  }
}

/**
 * A quadrotor about 1.6 m across: a flat hull, a glowing core, four arms and
 * four rotor discs. Part ids: 0 hull, 1 core, 2 arm, 3 rotor.
 */
export function buildDroneMesh() {
  const m = new MeshBuild();
  m.box(0, 0, 0, 0.78, 0.26, 0.78, 0);
  m.box(0, 0.16, 0, 0.5, 0.2, 0.5, 0);
  m.box(0, -0.13, 0.30, 0.34, 0.16, 0.22, 0);        // sensor pod at the front
  m.icosphere(0, -0.02, 0.0, 0.2, 10, 6, 1);          // the core
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    m.box(sx * 0.34, 0.0, sz * 0.34, 0.62, 0.09, 0.14, 2, Math.atan2(sz, sx));
    m.cylinder(sx * 0.62, -0.06, sz * 0.62, 0.075, 0.065, 0.16, 8, 2);
    m.ring(sx * 0.62, 0.11, sz * 0.62, 0.10, 0.44, 14, 3);
  }
  return m;
}

/**
 * The weapon, in view space: the eye is at the origin and the muzzle points
 * down -z. Laid out so the butt of the stock sits about ten centimetres in
 * front of the eye and the muzzle about ninety, which is what puts a rifle in
 * the lower right of the frame rather than across all of it.
 * Part ids: 0 receiver, 1 barrel, 2 polymer, 3 sight, 4 muzzle flash.
 */
export function buildWeaponMesh() {
  const m = new MeshBuild();
  //        cx    cy      cz     w      h      d     part
  m.box(0, 0.000, -0.150, 0.052, 0.072, 0.115, 2);      // stock comb
  m.box(0, -0.022, -0.225, 0.050, 0.086, 0.075, 2);     // stock wrist
  m.box(0, 0.006, -0.360, 0.056, 0.092, 0.215, 0);      // receiver
  m.box(0, 0.052, -0.375, 0.040, 0.016, 0.230, 0);      // top rail
  m.box(0, 0.010, -0.560, 0.040, 0.050, 0.185, 1);      // handguard
  m.cylinder(0, 0.012, -0.640, 0.013, 0.013, -0.220, 10, 1, 'z');   // barrel
  m.box(0, 0.012, -0.868, 0.026, 0.026, 0.052, 1);      // muzzle device
  m.box(0, -0.098, -0.300, 0.042, 0.115, 0.062, 2);     // pistol grip
  m.box(0, -0.070, -0.395, 0.038, 0.105, 0.085, 2);     // magazine
  m.box(0, 0.082, -0.400, 0.030, 0.038, 0.060, 3);      // sight body
  m.box(0, 0.104, -0.400, 0.036, 0.006, 0.066, 3);      // sight hood
  m.box(0, 0.088, -0.400, 0.006, 0.014, 0.004, 3);      // the post you aim with
  // Flash cone at the muzzle. Invisible unless the shader is told otherwise.
  m.cylinder(0, 0.012, -0.894, 0.005, 0.070, -0.170, 10, 4, 'z');
  return m;
}

// --- renderer --------------------------------------------------------------

export class Actors {
  constructor(gl, caps) {
    this.gl = gl;
    this.caps = caps;

    this.progDrone = createProgram(gl, DRONE_VS, DRONE_FS, 'drone');
    this.progDroneShadow = createProgram(gl, DRONE_SHADOW_VS, DRONE_SHADOW_FS, 'droneShadow');
    this.progSpark = createProgram(gl, SPARK_VS, SPARK_FS, 'spark');
    this.progViewmodel = createProgram(gl, VIEWMODEL_VS, VIEWMODEL_FS, 'viewmodel');

    // The drone shader samples the shadow cascades, so it has to be told which
    // texture units they are on. Left at the default of zero it samples a
    // sampler2DShadow from a unit holding an ordinary texture, and every draw
    // fails with INVALID_OPERATION and renders nothing at all.
    this.progDrone.use().int('uShadow0', 4).int('uShadow1', 5);

    this.drone = this._uploadMesh(buildDroneMesh(), MAX_DRONES, 2);
    this.weapon = this._uploadMesh(buildWeaponMesh(), 0, 0);

    // Sparks are three vec4s per instance, six vertices drawn from gl_VertexID.
    this.sparkData = new Float32Array(MAX_SPARKS * 12);
    this.sparkCount = 0;
    this.sparkVao = gl.createVertexArray();
    this.sparkVbo = gl.createBuffer();
    gl.bindVertexArray(this.sparkVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sparkVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.sparkData.byteLength, gl.DYNAMIC_DRAW);
    for (let k = 0; k < 3; k++) {
      const loc = 5 + k;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 48, k * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);

    this.viewProj = mat4.create();
    this.viewMat = mat4.create();
    this.muzzle = 0;
  }

  _uploadMesh(build, instances, instanceVec4s) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(build.v), gl.STATIC_DRAW);
    const stride = 32;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    const use32 = build.n > 65535;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,
      use32 ? new Uint32Array(build.i) : new Uint16Array(build.i), gl.STATIC_DRAW);

    let instVbo = null;
    let instData = null;
    if (instances > 0) {
      instData = new Float32Array(instances * instanceVec4s * 4);
      instVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
      gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
      for (let k = 0; k < instanceVec4s; k++) {
        const loc = 5 + k;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, instanceVec4s * 16, k * 16);
        gl.vertexAttribDivisor(loc, 1);
      }
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    return {
      vao, vbo, ibo, instVbo, instData,
      count: build.i.length,
      indexType: use32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      instanceCount: 0,
    };
  }

  /** Pack the live drones into the instance buffer. */
  updateDrones(list) {
    const gl = this.gl;
    const data = this.drone.instData;
    let n = 0;
    for (const d of list) {
      if (!d.alive || n >= MAX_DRONES) continue;
      const o = n * 8;
      data[o] = d.x; data[o + 1] = d.y; data[o + 2] = d.z; data[o + 3] = d.yaw;
      data[o + 4] = d.tilt; data[o + 5] = d.roll; data[o + 6] = d.hitFlash; data[o + 7] = d.rotor;
      n++;
    }
    this.drone.instanceCount = n;
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.drone.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  drawDrones() {
    if (!this.drone.instanceCount) return 0;
    const gl = this.gl;
    this.progDrone.use();
    gl.bindVertexArray(this.drone.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.drone.count, this.drone.indexType, 0,
      this.drone.instanceCount);
    gl.bindVertexArray(null);
    return 1;
  }

  drawDroneShadows(lightViewProj) {
    if (!this.drone.instanceCount) return 0;
    const gl = this.gl;
    this.progDroneShadow.use().mat4('uLightViewProj', lightViewProj);
    gl.bindVertexArray(this.drone.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.drone.count, this.drone.indexType, 0,
      this.drone.instanceCount);
    gl.bindVertexArray(null);
    return 1;
  }

  /** @param {Array} sparks entries from the effects pool */
  updateSparks(sparks) {
    const gl = this.gl;
    const data = this.sparkData;
    let n = 0;
    for (const s of sparks) {
      if (!s.alive || n >= MAX_SPARKS) continue;
      const o = n * 12;
      data[o] = s.ax; data[o + 1] = s.ay; data[o + 2] = s.az; data[o + 3] = s.kind;
      data[o + 4] = s.bx; data[o + 5] = s.by; data[o + 6] = s.bz;
      data[o + 7] = Math.max(0, s.life / s.maxLife);
      data[o + 8] = s.r; data[o + 9] = s.g; data[o + 10] = s.b; data[o + 11] = s.size;
      n++;
    }
    this.sparkCount = n;
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sparkVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  drawSparks() {
    if (!this.sparkCount) return 0;
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    this.progSpark.use();
    gl.bindVertexArray(this.sparkVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.sparkCount);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    return 1;
  }

  /**
   * The viewmodel, in its own narrow projection with a cleared depth buffer so
   * it can never poke through a wall.
   */
  drawViewmodel(aspect, pose, muzzle) {
    const gl = this.gl;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    mat4.perspective(this.viewProj, 55 * Math.PI / 180, aspect, 0.004, 6);

    // Build the weapon transform: aim blend, sway, recoil kick and holster.
    const m = this.viewMat;
    mat4.identity(m);
    const t = mat4.create();
    mat4.fromTranslation(t, pose.x, pose.y, pose.z);
    mat4.multiply(m, m, t);
    rotate(m, pose.pitch, pose.yaw, pose.roll);

    this.progViewmodel.use()
      .mat4('uViewModelProj', this.viewProj)
      .mat4('uViewModelMat', m)
      .float('uMuzzle', muzzle);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.bindVertexArray(this.weapon.vao);
    gl.drawElements(gl.TRIANGLES, this.weapon.count, this.weapon.indexType, 0);
    gl.bindVertexArray(null);
    return 1;
  }

  dispose() {
    const gl = this.gl;
    for (const mesh of [this.drone, this.weapon]) {
      gl.deleteVertexArray(mesh.vao);
      gl.deleteBuffer(mesh.vbo);
      gl.deleteBuffer(mesh.ibo);
      if (mesh.instVbo) gl.deleteBuffer(mesh.instVbo);
    }
    gl.deleteVertexArray(this.sparkVao);
    gl.deleteBuffer(this.sparkVbo);
  }
}

const _rot = mat4.create();
function rotate(m, pitch, yaw, roll) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // Yaw, then pitch, then roll, written out rather than composed, because three
  // matrix multiplies per frame for one object is silly.
  _rot[0] = cy * cr + sy * sp * sr;
  _rot[1] = cp * sr;
  _rot[2] = -sy * cr + cy * sp * sr;
  _rot[3] = 0;
  _rot[4] = -cy * sr + sy * sp * cr;
  _rot[5] = cp * cr;
  _rot[6] = sy * sr + cy * sp * cr;
  _rot[7] = 0;
  _rot[8] = sy * cp;
  _rot[9] = -sp;
  _rot[10] = cy * cp;
  _rot[11] = 0;
  _rot[12] = 0; _rot[13] = 0; _rot[14] = 0; _rot[15] = 1;
  mat4.multiply(m, m, _rot);
}
