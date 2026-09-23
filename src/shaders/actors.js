import { VERSION, CAMERA_BLOCK, NOISE, FOG, SHADOW } from './common.js';

// Drones are one generated mesh drawn instanced, with a per instance transform
// packed into two vec4s: position and yaw, then tilt, roll, hit flash and state.

export const DRONE_VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aInfo;     // x part id, y rotor phase weight
layout(location = 5) in vec4 iPosYaw;   // xyz world position, w yaw
layout(location = 6) in vec4 iState;    // x tilt, y roll, z hit flash, w rotor angle

out vec3 vWorld;
out vec3 vNormal;
flat out float vPart;
flat out float vFlash;
out float vViewDist;

mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}
mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}
mat3 rotZ(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}

void main() {
  vec3 p = aPos;
  // Rotor discs spin about their own centre before the body transform.
  if (aInfo.x > 2.5) {
    vec3 hub = vec3(sign(p.x) * 0.62, p.y, sign(p.z) * 0.62);
    p = hub + rotY(iState.w * (sign(p.x) * sign(p.z) > 0.0 ? 1.0 : -1.0)) * (p - hub);
  }
  mat3 body = rotY(-iPosYaw.w) * rotZ(iState.y) * rotX(iState.x);
  vec3 world = body * p + iPosYaw.xyz;
  vWorld = world;
  vNormal = normalize(body * aNormal);
  vPart = aInfo.x;
  vFlash = iState.z;
  vViewDist = length(world - uCamPos.xyz);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const DRONE_FS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
${NOISE}
${SHADOW}
${FOG}
in vec3 vWorld;
in vec3 vNormal;
flat in float vPart;
flat in float vFlash;
in float vViewDist;
layout(location = 0) out vec4 fragColour;

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 albedo;
  vec3 emissive = vec3(0.0);
  float rough = 0.45;
  float metal = 0.55;

  if (vPart < 0.5) {
    // Hull: dark anodised shell with a panel line or two.
    float panel = smoothstep(0.0, 0.02, abs(fract(vWorld.y * 6.0) - 0.5) * 0.4);
    albedo = vec3(0.055, 0.060, 0.070) * (0.7 + 0.5 * panel);
  } else if (vPart < 1.5) {
    // The core, which is the thing worth aiming at.
    albedo = vec3(0.02);
    float pulse = 0.62 + 0.38 * sin(uCamPos.w * 6.0 + vWorld.x);
    emissive = vec3(1.0, 0.24, 0.12) * 5.2 * pulse;
    rough = 0.1;
  } else if (vPart < 2.5) {
    // Arms.
    albedo = vec3(0.085, 0.090, 0.100);
    rough = 0.38;
  } else {
    // Rotor discs: a thin blurred ring rather than modelled blades.
    albedo = vec3(0.13, 0.14, 0.16);
    rough = 0.7;
    metal = 0.2;
  }

  vec3 L = uSunDir.xyz;
  float ndl = max(dot(n, L), 0.0);
  float shadow = shadowFactor(vWorld, ndl, vViewDist);
  float upness = n.y * 0.5 + 0.5;
  vec3 dome = mix(uSkyHorizon.rgb, uSkyZenith.rgb, upness);
  float domeLum = dot(dome, vec3(0.2126, 0.7152, 0.0722));
  dome = mix(dome, vec3(domeLum), 0.42) * 2.0;
  vec3 ambient = dome * (0.34 + 0.66 * upness);

  vec3 V = normalize(uCamPos.xyz - vWorld);
  vec3 H = normalize(L + V);
  float gloss = pow(max(1.0 - rough, 0.001), 2.0) * 512.0 + 2.0;
  float spec = pow(max(dot(n, H), 0.0), gloss) * (1.0 - rough) * shadow;

  vec3 colour = albedo * (uSunColour.rgb * ndl * shadow + ambient)
              + uSunColour.rgb * spec * mix(0.08, 1.2, metal)
              + emissive;
  // A white flash on the frame it takes a hit, so a connect is unmistakable.
  colour = mix(colour, vec3(3.0, 2.4, 1.6), vFlash * 0.75);
  colour = applyFog(colour, vWorld, uCamPos.xyz, uSunDir.xyz,
                    uSkyHorizon.rgb, uSkyZenith.rgb, uFog, uSkyZenith.w);
  fragColour = vec4(colour, 1.0);
}
`;

export const DRONE_SHADOW_VS = `${VERSION}
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 5) in vec4 iPosYaw;
layout(location = 6) in vec4 iState;
uniform mat4 uLightViewProj;
void main() {
  float c = cos(-iPosYaw.w), s = sin(-iPosYaw.w);
  mat3 rot = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  gl_Position = uLightViewProj * vec4(rot * aPos + iPosYaw.xyz, 1.0);
}
`;

export const DRONE_SHADOW_FS = `${VERSION}
precision highp float;
void main() {}
`;

// ---------------------------------------------------------------------------
// Tracers and impact sparks, drawn as camera facing quads with additive blend.

export const SPARK_VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
layout(location = 5) in vec4 iA;    // xyz start, w kind (0 tracer, 1 spark, 2 flash)
layout(location = 6) in vec4 iB;    // xyz end or velocity, w life 0..1
layout(location = 7) in vec4 iC;    // rgb colour, w width

out vec2 vUv;
flat out float vKind;
flat out float vLife;
flat out vec3 vColour;

void main() {
  int corner = gl_VertexID % 6;
  vec2 c = vec2(float((corner == 1 || corner == 2 || corner == 4) ? 1 : 0),
                float((corner == 2 || corner == 4 || corner == 5) ? 1 : 0));
  vUv = c;
  vKind = iA.w;
  vLife = iB.w;
  vColour = iC.rgb;

  vec3 pos;
  if (iA.w < 0.5) {
    // Tracer: a ribbon from start to end, always turned to face the eye.
    vec3 a = iA.xyz, b = iB.xyz;
    vec3 axis = b - a;
    vec3 mid = (a + b) * 0.5;
    vec3 toEye = normalize(uCamPos.xyz - mid);
    vec3 side = normalize(cross(normalize(axis), toEye)) * iC.w;
    pos = a + axis * c.x + side * (c.y - 0.5) * 2.0;
  } else {
    // Spark or muzzle flash: a billboard at a point.
    vec3 centre = iA.xyz;
    vec3 fwd = normalize(uCamPos.xyz - centre);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);
    float s = iC.w;
    pos = centre + right * (c.x - 0.5) * 2.0 * s + up * (c.y - 0.5) * 2.0 * s;
  }
  gl_Position = uViewProj * vec4(pos, 1.0);
}
`;

export const SPARK_FS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
in vec2 vUv;
flat in float vKind;
flat in float vLife;
flat in vec3 vColour;
layout(location = 0) out vec4 fragColour;

void main() {
  float a;
  if (vKind < 0.5) {
    // Tracer: bright core with a soft edge, fading towards the tail.
    float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
    a = pow(across, 2.2) * mix(0.15, 1.0, vUv.x);
  } else {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    a = pow(max(0.0, 1.0 - r), 2.4);
  }
  a *= vLife;
  if (a < 0.004) discard;
  fragColour = vec4(vColour * a, a);
}
`;

// ---------------------------------------------------------------------------
// The weapon in your hands. Drawn after the scene with its own projection and a
// cleared depth buffer, which is how a viewmodel avoids clipping into walls.

export const VIEWMODEL_VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aInfo;   // x part id

uniform mat4 uViewModelProj;
uniform mat4 uViewModelMat;

out vec3 vLocal;
out vec3 vModel;
out vec3 vNormal;
flat out float vPart;

void main() {
  vec4 p = uViewModelMat * vec4(aPos, 1.0);
  vLocal = p.xyz;
  vModel = aPos;
  vNormal = mat3(uViewModelMat) * aNormal;
  vPart = aInfo.x;
  gl_Position = uViewModelProj * p;
}
`;

export const VIEWMODEL_FS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
${NOISE}
in vec3 vLocal;
in vec3 vModel;
in vec3 vNormal;
flat in float vPart;

uniform float uMuzzle;     // 0..1, decays after each shot
layout(location = 0) out vec4 fragColour;

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 albedo;
  vec3 emissive = vec3(0.0);
  float rough = 0.42;
  float metal = 0.7;

  if (vPart < 0.5) {
    albedo = vec3(0.052, 0.055, 0.062);            // receiver
  } else if (vPart < 1.5) {
    albedo = vec3(0.075, 0.078, 0.086);            // barrel and handguard
    rough = 0.3;
  } else if (vPart < 2.5) {
    albedo = vec3(0.045, 0.040, 0.036);            // grip and stock, polymer
    rough = 0.72;
    metal = 0.05;
  } else if (vPart < 3.5) {
    albedo = vec3(0.10, 0.10, 0.11);               // sight
    rough = 0.25;
  } else {
    // Muzzle flash cone. It is geometry that exists all the time, so it has to
    // take itself out of the picture between shots rather than draw as a black
    // spike off the barrel.
    if (uMuzzle < 0.02) discard;
    // The cone runs 170 mm forward from the muzzle device. It retracts towards
    // the barrel as the flash decays, so what you see is a flash going out
    // rather than a lamp dimming on the end of the gun.
    float t = clamp((vModel.z + 0.894) / -0.170, 0.0, 1.0);
    if (t > uMuzzle) discard;
    albedo = vec3(0.0);
    emissive = vec3(1.0, 0.74, 0.38) * (1.0 - t * 0.6) * 6.5;
    fragColour = vec4(emissive, 1.0);
    return;
  }

  // Lit from the sky and from the scene generally, not from the world sun
  // direction, because a viewmodel that goes black when you face away from the
  // sun reads as a bug.
  vec3 keyDir = normalize(vec3(-0.35, 0.72, 0.6));
  float ndl = max(dot(n, keyDir), 0.0);
  float rim = pow(1.0 - max(dot(n, normalize(-vLocal)), 0.0), 3.0);
  vec3 dome = mix(uSkyHorizon.rgb, uSkyZenith.rgb, n.y * 0.5 + 0.5);
  float domeLum = dot(dome, vec3(0.2126, 0.7152, 0.0722));
  dome = mix(dome, vec3(domeLum), 0.55) * 1.15;

  vec3 key = max(uSunColour.rgb, vec3(0.30)) * ndl * 0.75;
  vec3 colour = albedo * (key + dome) + dome * rim * 0.5 * (1.0 - rough) + emissive;
  fragColour = vec4(colour, 1.0);
}
`;
