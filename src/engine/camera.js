// First person camera. Yaw and pitch, an interpolated eye position, and the
// matrices the renderer needs.

import { mat4, vec3, clamp, Frustum } from './math.js';

const PITCH_LIMIT = Math.PI / 2 - 0.02;

export class Camera {
  constructor() {
    this.yaw = 0;
    this.pitch = 0;
    this.fov = 68 * Math.PI / 180;
    this.near = 0.08;
    this.far = 4200;
    this.aspect = 1;
    this.position = vec3.create(0, 1.7, 0);
    this.forward = vec3.create(0, 0, -1);
    this.right = vec3.create(1, 0, 0);
    this.up = vec3.create(0, 1, 0);
    this.view = mat4.create();
    this.proj = mat4.create();
    this.viewProj = mat4.create();
    this.invViewProj = mat4.create();
    this.frustum = new Frustum();
    this._target = vec3.create();
  }

  rotate(dx, dy) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  update(aspect) {
    this.aspect = aspect;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    // yaw 0 looks down -z, which is north in our projection.
    vec3.set(this.forward, -sy * cp, sp, -cy * cp);
    vec3.set(this.right, cy, 0, -sy);
    vec3.cross(this.up, this.right, this.forward);
    vec3.normalize(this.up, this.up);

    vec3.add(this._target, this.position, this.forward);
    mat4.lookAt(this.view, this.position, this._target, this.up);
    mat4.perspective(this.proj, this.fov, aspect, this.near, this.far);
    mat4.multiply(this.viewProj, this.proj, this.view);
    mat4.invert(this.invViewProj, this.viewProj);
    this.frustum.fromMatrix(this.viewProj);
  }

  /** Horizontal basis for walking, so looking up does not slow you down. */
  walkBasis(out) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    out[0] = -sy; out[1] = -cy;    // forward on the ground
    out[2] = cy; out[3] = -sy;     // right on the ground
    return out;
  }
}
