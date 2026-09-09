import { VERSION, CAMERA_BLOCK, NOISE, FOG, SHADOW } from './common.js';

const HASH11 = `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
`;

// Trees are instanced: a trunk drawn as two crossed quads and a crown drawn as
// three camera facing billboards, all generated from gl_VertexID so no mesh
// data is ever downloaded.

export const TREE_VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
${HASH11}
layout(location = 5) in vec4 iPos;    // xyz base, w height
layout(location = 6) in float iSeed;  // low 7 bits seed, bit 7 marks a lime

out vec3 vWorld;
out vec2 vUv;
out vec3 vNormal;
out vec3 vTangent;
flat out float vSeed;
flat out float vPart;   // 0 trunk, 1 crown
out float vViewDist;

uniform float uShadowPass;

void main() {
  int vid = gl_VertexID;
  int quad = vid / 6;
  int corner = vid % 6;
  // Two triangles per quad.
  vec2 c = vec2(float((corner == 1 || corner == 2 || corner == 4) ? 1 : 0),
                float((corner == 2 || corner == 4 || corner == 5) ? 1 : 0));
  vUv = c;

  float seed = iSeed;
  float isLime = step(128.0, seed);
  float s = mod(seed, 128.0);
  float rnd = hash11(s * 0.137 + 0.31);
  float rnd2 = hash11(s * 0.271 + 1.77);

  float h = iPos.w;
  float trunkH = h * mix(0.24, 0.32, rnd);
  float crownR = h * mix(0.34, 0.44, rnd2) * mix(1.0, 1.10, isLime);

  vec3 base = iPos.xyz;
  vec3 pos;
  vec3 nrm;

  if (quad < 2) {
    // Trunk: two crossed quads, always solid.
    float ang = float(quad) * 1.5708 + rnd * 3.14159;
    vec3 right = vec3(cos(ang), 0.0, sin(ang));
    float r = mix(0.17, 0.30, rnd) * mix(1.0, 1.45, isLime);
    float taper = mix(1.0, 0.55, c.y);
    pos = base + right * (c.x - 0.5) * 2.0 * r * taper + vec3(0.0, c.y * trunkH * 1.2, 0.0);
    nrm = vec3(-right.z, 0.0, right.x);
    vTangent = right;
    vPart = 0.0;
  } else {
    // Crown: billboards that face the camera, offset so it reads as a volume.
    int b = quad - 2;
    vec3 toCam = uCamPos.xyz - base;
    toCam.y = 0.0;
    float l = length(toCam);
    vec3 fwd = l > 0.001 ? toCam / l : vec3(0.0, 0.0, 1.0);
    vec3 right = normalize(vec3(fwd.z, 0.0, -fwd.x));
    vec3 up = vec3(0.0, 1.0, 0.0);
    float bf = float(b);
    float off = (bf - 1.0) * crownR * 0.42;
    float scale = 1.0 - abs(bf - 1.0) * 0.22;
    vec3 centre = base + vec3(0.0, trunkH + crownR * 0.86, 0.0)
                + right * off + fwd * (bf - 1.0) * crownR * 0.30;
    pos = centre + right * (c.x - 0.5) * 2.0 * crownR * scale
                 + up * (c.y - 0.5) * 2.0 * crownR * scale * 1.05;
    // A soft outward normal so the crown lights like a sphere.
    nrm = normalize(right * (c.x - 0.5) * 1.4 + up * (c.y - 0.5) * 1.4 + fwd * 0.9);
    vTangent = right;
    // Wind sway, stronger higher up.
    float sway = sin(uCamPos.w * 0.9 + s * 0.7) * uMisc.w * 0.22 * c.y;
    pos.x += sway;
    pos.z += sway * 0.6;
    vPart = 1.0;
  }

  vWorld = pos;
  vNormal = nrm;
  vSeed = seed;
  vViewDist = length(pos - uCamPos.xyz);
  gl_Position = uViewProj * vec4(pos, 1.0);
}
`;

export const TREE_FS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
${NOISE}
${SHADOW}
${FOG}
in vec3 vWorld;
in vec2 vUv;
in vec3 vNormal;
in vec3 vTangent;
flat in float vSeed;
flat in float vPart;
in float vViewDist;
layout(location = 0) out vec4 fragColour;

void main() {
  float s = mod(vSeed, 128.0);
  float isLime = step(128.0, vSeed);
  vec3 albedo;
  vec3 n = normalize(vNormal);

  if (vPart < 0.5) {
    // Bark.
    float bark = fbm(vec2(vUv.x * 5.0, vUv.y * 22.0) + s);
    albedo = mix(vec3(0.078, 0.062, 0.050), vec3(0.150, 0.126, 0.104), bark);
    if (vUv.x < 0.06 || vUv.x > 0.94) discard;
    // Bend the flat quad normal round like a cylinder, so the trunk has a lit
    // side and a dark side instead of reading as a strip of tape.
    float a = (vUv.x - 0.5) * 2.6;
    n = normalize(n * cos(a) + normalize(vTangent) * sin(a));
    albedo *= 0.82 + 0.30 * (1.0 - abs(vUv.x - 0.5) * 2.0);
  } else {
    // Crown: a blobby alpha mask cut out of noise so the silhouette is not a disc.
    vec2 p = vUv - 0.5;
    float r = length(p * vec2(1.0, 0.94));
    float edge = fbm(vUv * 5.0 + s * 3.1) * 0.17 + fbm(vUv * 13.0 + s) * 0.07;
    if (r > 0.5 - edge) discard;
    float leaf = fbm(vUv * 15.0 + s) * 0.6 + fbm(vUv * 44.0 + s * 2.0) * 0.4;
    vec3 dark = mix(vec3(0.052, 0.092, 0.034), vec3(0.062, 0.108, 0.038), isLime);
    vec3 light = mix(vec3(0.170, 0.270, 0.098), vec3(0.205, 0.305, 0.115), isLime);
    albedo = mix(dark, light, smoothstep(0.25, 0.85, leaf));
    // Every tree is a slightly different green, and the underside is darker.
    albedo *= mix(0.82, 1.18, hash11(s * 1.7));
    albedo = mix(albedo, albedo * vec3(1.16, 1.06, 0.74), hash11(s) * 0.30);
    albedo *= mix(0.62, 1.0, smoothstep(-0.40, 0.32, p.y));
    // Clumps of foliage, so the crown is not a smooth ball.
    float clump = fbm(vUv * 5.5 + s * 4.0);
    albedo *= 0.84 + 0.34 * clump;
    n = normalize(n + vec3(p.x, p.y, 0.0) * 1.1);
  }

  vec3 L = uSunDir.xyz;
  float ndl = max(dot(n, L), 0.0);
  float shadow = shadowFactor(vWorld, ndl, vViewDist);
  // Leaves transmit light, which is what makes a canopy glow from underneath.
  float back = max(-dot(n, L), 0.0) * (vPart > 0.5 ? 0.45 : 0.0);
  float upness = n.y * 0.5 + 0.5;
  vec3 dome = mix(uSkyHorizon.rgb, uSkyZenith.rgb, upness);
  float domeLum = dot(dome, vec3(0.2126, 0.7152, 0.0722));
  vec3 ambient = mix(dome, vec3(domeLum), 0.42) * 2.00 * (0.34 + 0.66 * upness);
  vec3 colour = albedo * (uSunColour.rgb * (ndl * shadow + back * shadow) + ambient);
  colour = applyFog(colour, vWorld, uCamPos.xyz, uSunDir.xyz,
                    uSkyHorizon.rgb, uSkyZenith.rgb, uFog, uSkyZenith.w);
  fragColour = vec4(colour, 1.0);
}
`;

export const TREE_SHADOW_VS = `${VERSION}
precision highp float;
layout(location = 5) in vec4 iPos;
layout(location = 6) in float iSeed;
uniform mat4 uLightViewProj;
out vec2 vUv;
flat out float vSeed;
flat out float vPart;
${HASH11}
void main() {
  int vid = gl_VertexID;
  int quad = vid / 6;
  int corner = vid % 6;
  vec2 c = vec2(float((corner == 1 || corner == 2 || corner == 4) ? 1 : 0),
                float((corner == 2 || corner == 4 || corner == 5) ? 1 : 0));
  vUv = c;
  vSeed = iSeed;
  float s = mod(iSeed, 128.0);
  float rnd = hash11(s * 0.137 + 0.31);
  float rnd2 = hash11(s * 0.271 + 1.77);
  float h = iPos.w;
  float trunkH = h * mix(0.24, 0.32, rnd);
  float crownR = h * mix(0.34, 0.44, rnd2);
  vec3 base = iPos.xyz;
  vec3 pos;
  if (quad < 2) {
    float ang = float(quad) * 1.5708 + rnd * 3.14159;
    vec3 right = vec3(cos(ang), 0.0, sin(ang));
    pos = base + right * (c.x - 0.5) * 0.4 + vec3(0.0, c.y * trunkH * 1.15, 0.0);
    vPart = 0.0;
  } else {
    // For the shadow pass the crown is two fixed cross quads, so the shadow
    // does not swing about when the camera turns.
    int b = quad - 2;
    float ang = float(b) * 1.0472;
    vec3 right = vec3(cos(ang), 0.0, sin(ang));
    vec3 centre = base + vec3(0.0, trunkH + crownR * 0.86, 0.0);
    pos = centre + right * (c.x - 0.5) * 2.0 * crownR
                 + vec3(0.0, (c.y - 0.5) * 2.0 * crownR, 0.0);
    vPart = 1.0;
  }
  gl_Position = uLightViewProj * vec4(pos, 1.0);
}
`;

export const TREE_SHADOW_FS = `${VERSION}
precision highp float;
in vec2 vUv;
flat in float vSeed;
flat in float vPart;
void main() {
  if (vPart > 0.5) {
    vec2 p = vUv - 0.5;
    if (length(p) > 0.44) discard;
  } else if (vUv.x < 0.06 || vUv.x > 0.94) discard;
}
`;
