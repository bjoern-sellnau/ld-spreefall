// Rain and snow: a box of drops or flakes round the camera, drawn in one
// instanced call.
//
// Each one has a fixed place in a box forty metres across and twenty five
// high, and falls through it at its own speed; the box is laid over the
// world rather than carried with you, so walking through the rain passes
// the drops instead of dragging them along, and it wraps, so there is never
// an edge to walk out of. How hard it is coming down is how many of them are
// drawn. Rain is a streak along the way it falls, as long as a drop travels
// in a twenty fifth of a second, which is what the eye smears it into; snow
// is a soft flake that sways as it drifts.
//
// How fast: a raindrop of two millimetres falls at six and a half metres a
// second and one of five, a downpour's, at a little over nine (Atlas,
// Srivastava and Sekhon's fit, 9.65 - 10.3 e^(-0.6 D)); snowflakes stuck
// together fall at anything from 0.4 to 1.2 (Locatelli and Hobbs).

import { createProgram } from '../engine/gl.js';
import { VERSION, CAMERA_BLOCK } from '../shaders/common.js';

export const PRECIP = {
  count: 9000,
  box: [40, 25, 40],
  rainSpeed: [6.5, 9.2],
  snowSpeed: [0.4, 1.2],
  // How far a drop moves in the time the eye smears it over.
  smear: 1 / 25,
};

const VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
layout(location = 0) in vec4 aSeed;   // xyz place in the box, w speed share
uniform vec3 uBox;
uniform vec2 uSpeed;                  // slowest, fastest
uniform vec3 uWind;                   // metres a second
uniform float uSnow;                  // 0 rain, 1 snow
uniform float uSmear;
out vec2 vUv;
out float vFade;
void main() {
  float t = uCamPos.w;
  float speed = mix(uSpeed.x, uSpeed.y, aSeed.w);
  vec3 vel = vec3(uWind.x, -speed, uWind.z);
  // Snow sways as it falls.
  vec3 sway = uSnow * vec3(sin(t * 1.3 + aSeed.x * 40.0), 0.0, cos(t * 1.1 + aSeed.z * 40.0)) * 0.35;
  vec3 p = aSeed.xyz * uBox + vel * t + sway;
  // Wrapped into the box round the eye.
  vec3 rel = mod(p - uCamPos.xyz + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uCamPos.xyz + rel;
  // Thinner towards the sides of the box, so its edge never shows.
  vec3 edge = abs(rel) / (uBox * 0.5);
  vFade = (1.0 - smoothstep(0.65, 1.0, max(edge.x, edge.z))) * (1.0 - smoothstep(0.7, 1.0, edge.y));
  int corner = gl_VertexID % 6;
  vec2 q = vec2(corner == 1 || corner == 2 || corner == 4 ? 1.0 : 0.0,
                corner == 2 || corner == 4 || corner == 5 ? 1.0 : 0.0);
  vUv = q;
  vec3 view = normalize(world - uCamPos.xyz);
  vec3 along, across;
  float len, wid;
  if (uSnow > 0.5) {
    // A flake faces you.
    across = normalize(cross(view, vec3(0.0, 1.0, 0.0)));
    along = normalize(cross(across, view));
    len = 0.045; wid = 0.045;
  } else {
    along = normalize(vel);
    across = normalize(cross(along, view));
    len = length(vel) * uSmear; wid = 0.014;
  }
  world += along * (q.y - 0.5) * len + across * (q.x - 0.5) * wid;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

const FS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
uniform float uSnow;
uniform float uAlpha;
uniform vec4 uTint;      // rgb what the rain has in it, a how much
uniform float uEmber;    // 1: embers, glowing on their own
in vec2 vUv;
in float vFade;
layout(location = 0) out vec4 fragColour;
void main() {
  vec2 c = vUv - 0.5;
  float a;
  if (uSnow > 0.5) a = smoothstep(0.5, 0.15, length(c));
  else a = (1.0 - smoothstep(0.2, 0.5, abs(c.x))) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
  // Lit by the sky: pale grey by day, nearly nothing at night, and white in
  // a lightning flash.
  vec3 sky = mix(uSkyHorizon.rgb, uSkyZenith.rgb, 0.4);
  float lum = dot(sky, vec3(0.2126, 0.7152, 0.0722));
  vec3 col = vec3(0.7, 0.74, 0.8) * (0.25 + lum * 2.2) + vec3(1.0) * uWeather.z * 1.5;
  if (uSnow > 0.5) col = vec3(0.92, 0.94, 0.98) * (0.35 + lum * 2.4) + vec3(1.0) * uWeather.z;
  col = mix(col, uTint.rgb * (0.4 + lum * 2.0), uTint.a);
  if (uEmber > 0.5) col = vec3(3.2, 1.2, 0.25) * (0.6 + 0.4 * fract(vUv.x * 7.0 + vFade * 13.0));
  fragColour = vec4(col, a * vFade * uAlpha);
}
`;

export class Precip {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, VS, FS, 'precip');
    const seeds = new Float32Array(PRECIP.count * 4);
    // A fixed scatter, the same every time: what changes is how many show.
    let s = 1234567;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
    this.drawn = 0;
  }

  /**
   * @param {{rain:number, snow:number, wind:number}} weather amounts now
   * @param {number} windYaw which way the wind blows, radians
   */
  draw(weather, windYaw = 0) {
    this.drawn = 0;
    if (!weather) return 0;
    // Embers out of a firestorm fall like snow and glow like nothing else.
    const embers = (weather.embers || 0) > Math.max(weather.rain, weather.snow);
    const snow = embers || weather.snow > weather.rain;
    const amount = Math.min(1.5, embers ? weather.embers : (snow ? weather.snow : weather.rain));
    if (amount < 0.02) return 0;
    const gl = this.gl;
    const n = Math.min(PRECIP.count, Math.round(PRECIP.count * amount / 1.5));
    const wind = (snow ? 2.5 : 4) * weather.wind;
    const tint = weather.precipTint || [0, 0, 0, 0];
    this.prog.use()
      .vec3('uBox', PRECIP.box[0], PRECIP.box[1], PRECIP.box[2])
      .vec2('uSpeed', ...(snow ? PRECIP.snowSpeed : PRECIP.rainSpeed))
      .vec3('uWind', Math.sin(windYaw) * wind, 0, Math.cos(windYaw) * wind)
      .float('uSnow', snow ? 1 : 0)
      .float('uSmear', PRECIP.smear)
      .float('uAlpha', snow ? 0.85 : 0.42)
      .vec4('uTint', tint[0], tint[1], tint[2], tint[3])
      .float('uEmber', embers ? 1 : 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    this.drawn = n;
    return 1;
  }
}
