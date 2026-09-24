// Shared GLSL, assembled as strings. Keeping it here rather than in separate
// .glsl files means the whole page is JS modules and nothing extra is fetched.

export const VERSION = '#version 300 es\n';

export const CAMERA_BLOCK = `
layout(std140) uniform Camera {
  mat4 uViewProj;
  mat4 uView;
  mat4 uInvViewProj;
  vec4 uCamPos;          // xyz eye, w time in seconds
  vec4 uSunDir;          // xyz direction to the sun, w sun altitude
  vec4 uSunColour;       // rgb light colour, w shadow strength
  vec4 uSkyZenith;       // rgb, w night factor 0 day 1 night
  vec4 uSkyHorizon;      // rgb, w haze
  vec4 uFog;             // x density, y height falloff, z start, w far
  mat4 uShadowMat0;
  mat4 uShadowMat1;
  vec4 uShadowSplit;     // x split0, y split1, z texel0, w texel1
  vec4 uMisc;            // x exposure, y night window mix, z quality, w wind
};
`;

// Cheap hashes and value noise. No texture fetches, no downloads.
export const NOISE = `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += vnoise(p) * a; p *= 2.03; a *= 0.5; }
  return s;
}
// Worley style cells, used for cobblestones.
vec3 cells(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float best = 8.0, second = 8.0;
  vec2 bestId = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(i + g);
      float d = length(g + o - f);
      if (d < best) { second = best; best = d; bestId = i + g; }
      else if (d < second) { second = d; }
    }
  }
  return vec3(best, second - best, hash12(bestId));
}
`;

export const TONEMAP = `
// The ACES fit by Stephen Hill, widely used and cheap.
vec3 acesTonemap(vec3 x) {
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840,
                       0.35458, 0.90834, 0.13383,
                       0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3( 1.60475, -0.10208, -0.00327,
                       -0.53108,  1.10813, -0.07276,
                       -0.07367, -0.00605,  1.07602);
  vec3 v = m1 * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0.0, 1.0);
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 1e-5), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

// An analytic sky: a Rayleigh tinted gradient with a Mie lobe around the sun.
export const SKY = `
vec3 skyColour(vec3 dir, vec3 sunDir, vec3 zenith, vec3 horizon, float night) {
  float up = clamp(dir.y, -0.2, 1.0);
  float t = pow(1.0 - max(up, 0.0), 5.0);
  vec3 base = mix(zenith, horizon, clamp(t, 0.0, 1.0));
  float cosT = dot(normalize(dir), sunDir);
  // Mie forward scattering keeps a glow around the sun.
  float g = 0.76;
  float mie = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
  vec3 sunTint = mix(vec3(1.0, 0.62, 0.30), vec3(1.0, 0.94, 0.86), clamp(sunDir.y * 2.2, 0.0, 1.0));
  base += sunTint * mie * 0.030 * (1.0 - night) * smoothstep(-0.12, 0.06, sunDir.y);
  // The sun disc, half a degree across.
  float disc = smoothstep(0.99976, 0.99992, cosT);
  base += sunTint * disc * 42.0 * smoothstep(-0.04, 0.03, sunDir.y);
  // Ground haze below the horizon.
  base = mix(base, mix(horizon, vec3(0.10, 0.10, 0.11), 0.55), smoothstep(0.0, -0.09, dir.y));
  return base;
}
`;

export const FOG = `
// Height fog: thicker low down, so the Fernsehturm floats above it.
vec3 applyFog(vec3 colour, vec3 worldPos, vec3 camPos, vec3 sunDir, vec3 horizon, vec3 zenith, vec4 fogParams, float night) {
  vec3 d = worldPos - camPos;
  float dist = length(d);
  if (dist < fogParams.z) return colour;
  vec3 dir = d / max(dist, 0.001);
  float density = fogParams.x;
  float falloff = fogParams.y;
  float hEye = max(camPos.y, 0.0);
  float hDir = dir.y;
  float f;
  if (abs(hDir) < 1e-4) {
    f = density * exp(-falloff * hEye) * (dist - fogParams.z);
  } else {
    f = (density / (falloff * hDir)) * exp(-falloff * hEye) * (1.0 - exp(-falloff * hDir * (dist - fogParams.z)));
  }
  f = 1.0 - exp(-max(f, 0.0));
  float sunAmount = max(dot(dir, sunDir), 0.0);
  vec3 fogColour = mix(mix(horizon, zenith, clamp(dir.y * 1.4, 0.0, 1.0)),
                       mix(vec3(1.0, 0.78, 0.52), horizon, 0.35),
                       pow(sunAmount, 6.0) * 0.6 * (1.0 - night));
  return mix(colour, fogColour, clamp(f, 0.0, 1.0));
}
`;

// Two cascade shadow lookup with a 3 by 3 percentage closer filter.
export const SHADOW = `
uniform highp sampler2DShadow uShadow0;
uniform highp sampler2DShadow uShadow1;

float sampleCascade(highp sampler2DShadow tex, vec4 sc, float texel) {
  vec3 p = sc.xyz / sc.w;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      s += texture(tex, vec3(p.xy + vec2(float(x), float(y)) * texel, p.z));
    }
  }
  return s / 9.0;
}

float shadowFactor(vec3 worldPos, float ndl, float viewDist) {
  if (uSunColour.w < 0.01) return 1.0;
  float bias = mix(0.0022, 0.010, 1.0 - clamp(ndl, 0.0, 1.0));
  vec3 p = worldPos + vec3(0.0, bias * 3.0, 0.0);
  float s;
  if (viewDist < uShadowSplit.x) {
    s = sampleCascade(uShadow0, uShadowMat0 * vec4(p, 1.0), uShadowSplit.z);
    float blend = smoothstep(uShadowSplit.x * 0.82, uShadowSplit.x, viewDist);
    if (blend > 0.0) {
      float s1 = sampleCascade(uShadow1, uShadowMat1 * vec4(p, 1.0), uShadowSplit.w);
      s = mix(s, s1, blend);
    }
  } else if (viewDist < uShadowSplit.y) {
    s = sampleCascade(uShadow1, uShadowMat1 * vec4(p, 1.0), uShadowSplit.w);
    s = mix(s, 1.0, smoothstep(uShadowSplit.y * 0.85, uShadowSplit.y, viewDist));
  } else {
    s = 1.0;
  }
  return mix(1.0, s, uSunColour.w);
}
`;

export const FULLSCREEN_VS = `${VERSION}
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
