// The force field over the memorial.
//
// It used to be a weapons free zone: the weapon holstered itself and nothing
// would fight there. Now you can fight anywhere, and the memorial is kept
// whole by a field instead, which takes every blast that lands in it and
// shows that it did. This draws it: a low dome of hexagons, faint until
// something hits it, then lit from the point of the hit outward.
//
// The dome is generated in the vertex shader from the vertex index, so it
// has no buffers at all.

import { createProgram } from '../engine/gl.js';
import { VERSION, CAMERA_BLOCK } from '../shaders/common.js';

const SEG = 64;      // round the dome
const RINGS = 20;    // up it
/** How tall the dome is against how wide, so it reads as a lid on the place. */
export const FIELD_RISE = 0.32;

const VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
uniform vec4 uField;   // xyz middle on the ground, w radius
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
void main() {
  int quad = gl_VertexID / 6;
  int corner = gl_VertexID - quad * 6;
  int i = quad - (quad / ${SEG}) * ${SEG};
  int j = quad / ${SEG};
  ivec2 c = corner == 0 ? ivec2(0, 0) : corner == 1 ? ivec2(1, 0) : corner == 2 ? ivec2(1, 1)
    : corner == 3 ? ivec2(0, 0) : corner == 4 ? ivec2(1, 1) : ivec2(0, 1);
  float u = float(i + c.x) / ${SEG}.0 * 6.2831853;
  float v = float(j + c.y) / ${RINGS}.0 * 1.5707963;
  vec3 s = vec3(cos(v) * cos(u), sin(v), cos(v) * sin(u));
  float r = uField.w;
  vec3 p = uField.xyz + vec3(s.x * r, s.y * r * ${FIELD_RISE.toFixed(3)}, s.z * r);
  vWorld = p;
  // The normal of the squashed dome, which is the sphere's scaled the other way.
  vNormal = normalize(vec3(s.x, s.y / ${FIELD_RISE.toFixed(3)}, s.z));
  vUv = vec2(u * r / 6.0, v * r * ${FIELD_RISE.toFixed(3)} / 4.0);
  gl_Position = uViewProj * vec4(p, 1.0);
}
`;

const FS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
uniform vec4 uField;
uniform vec4 uHit;      // xyz the last hit, w seconds since it
uniform float uGlow;    // how lit the whole field still is, 0 to 1
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
out vec4 outColor;

// Distance to the nearest edge of a hexagonal cell, small on the lines.
float hexEdge(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5;
  vec2 b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  return 0.5 - max(dot(q, normalize(vec2(1.0, 1.7320508))), q.x);
}

void main() {
  vec3 toEye = normalize(uCamPos.xyz - vWorld);
  float facing = abs(dot(normalize(vNormal), toEye));
  float rim = pow(1.0 - facing, 3.0);
  float line = 1.0 - smoothstep(0.02, 0.07, hexEdge(vUv));
  // A ring running out from the last hit, across the dome.
  float since = uHit.w;
  float d = length(vWorld - uHit.xyz);
  float front = since * 70.0;
  float ring = exp(-pow((d - front) / 6.0, 2.0)) * exp(-since * 1.6);
  float near = exp(-d / 18.0) * exp(-since * 3.0);
  // Faint at rest, a shimmer that drifts so it is seen to be there.
  float shimmer = 0.5 + 0.5 * sin(uCamPos.w * 1.3 + vUv.x * 0.7 + vUv.y * 1.1);
  float a = 0.015 + rim * 0.10 + line * (0.035 + 0.04 * shimmer)
          + (line * 0.6 + 0.4) * (ring * 0.9 + near * 1.2 + uGlow * 0.25);
  // Gone into the ground at the foot, so it does not cut a hard line on it.
  a *= smoothstep(0.0, 2.5, vWorld.y - uField.y);
  vec3 colour = mix(vec3(0.25, 0.65, 1.0), vec3(0.75, 0.95, 1.0), clamp(ring + near, 0.0, 1.0));
  outColor = vec4(colour * a * 2.2, 1.0);
}
`;

export class ForceField {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, VS, FS, 'forceField');
    this.vao = gl.createVertexArray();
    /** @type {{x:number,y:number,z:number,radius:number}[]} */
    this.domes = [];
    this.hit = { x: 0, y: -1e5, z: 0, at: -1e3 };
    this.glow = 0;
  }

  /** Something landed on it. */
  struck(x, y, z, time, strength = 1) {
    this.hit.x = x; this.hit.y = y; this.hit.z = z; this.hit.at = time;
    this.glow = Math.min(1, this.glow + 0.35 * strength);
  }

  /** Additive, over everything opaque, with the depth test on and no writes. */
  draw(time, dt = 1 / 60) {
    if (!this.domes.length) return 0;
    const gl = this.gl;
    this.glow = Math.max(0, this.glow - dt * 0.8);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    const p = this.prog.use();
    gl.bindVertexArray(this.vao);
    for (const d of this.domes) {
      p.vec4('uField', d.x, d.y, d.z, d.radius);
      p.vec4('uHit', this.hit.x, this.hit.y, this.hit.z, Math.max(0, time - this.hit.at));
      p.float('uGlow', this.glow);
      gl.drawArrays(gl.TRIANGLES, 0, SEG * RINGS * 6);
    }
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    return this.domes.length;
  }
}
