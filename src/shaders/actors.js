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
  // Rotor discs spin about their own centre before the body transform. Only
  // part three does: the same shader draws soldiers and the things you throw,
  // and none of those have rotors.
  if (aInfo.x > 2.5 && aInfo.x < 3.5) {
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

const bodyFS = (charred) => `${VERSION}
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
${charred}

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
  } else if (vPart < 3.5) {
    // Rotor discs: a thin blurred ring rather than modelled blades.
    albedo = vec3(0.13, 0.14, 0.16);
    rough = 0.7;
    metal = 0.2;
  } else if (vPart < 4.5) {
    // Soldier cloth. Field grey, matte, with a little variation so a squad
    // does not look like one object drawn six times.
    float v = hash11(floor(vWorld.x * 0.7) + floor(vWorld.z * 0.7) * 31.0);
    albedo = vec3(0.085, 0.092, 0.078) * (0.85 + 0.3 * v);
    rough = 0.92;
    metal = 0.02;
  } else if (vPart < 5.5) {
    // Helmet and visor.
    albedo = vec3(0.035, 0.038, 0.040);
    rough = 0.35;
    metal = 0.3;
    // The visor catches the sun, which is what picks them out of a street.
    emissive = vec3(0.9, 0.22, 0.12) * 0.7;
  } else if (vPart < 6.5) {
    // Webbing, boots, pouches.
    albedo = vec3(0.045, 0.043, 0.038);
    rough = 0.95;
    metal = 0.05;
  } else if (vPart < 7.5) {
    // The rifle they carry.
    albedo = vec3(0.05, 0.052, 0.058);
    rough = 0.4;
    metal = 0.7;
  } else if (vPart < 8.5) {
    // Ordnance steel: rocket bodies, grenade shells.
    albedo = vec3(0.07, 0.078, 0.062);
    rough = 0.5;
    metal = 0.6;
  } else if (vPart < 9.5) {
    // Plastic explosive, with the detonator light blinking on top of it.
    albedo = vec3(0.68, 0.66, 0.60);
    rough = 0.85;
    metal = 0.02;
    float blink = step(0.5, fract(uCamPos.w * 1.6));
    emissive = vec3(1.0, 0.1, 0.06) * 3.0 * blink;
  } else if (vPart < 10.5) {
    // A banana.
    albedo = vec3(0.86, 0.72, 0.13);
    rough = 0.6;
    metal = 0.05;
  } else if (vPart < 11.5) {
    // Energy: a plasma bolt or a dart in flight. Its own light source, so it
    // reads at a hundred metres against a grey street.
    albedo = vec3(0.02);
    float pulse = 0.75 + 0.25 * sin(uCamPos.w * 22.0 + vWorld.x * 3.0);
    emissive = vec3(0.35, 0.85, 1.0) * 7.0 * pulse;
    rough = 0.1;
    metal = 0.0;
  } else if (vPart < 12.5) {
    // The pad a pickup stands on: a scuffed steel plate, no light of its own.
    albedo = vec3(0.10, 0.105, 0.115);
    rough = 0.55;
    metal = 0.6;
  } else if (vPart < 17.5) {
    // The five pickups. Each has its own colour and each throbs, because the
    // one thing they all have to do is be seen down a street.
    vec3 tint = vec3(1.0);
    float force = 3.0;
    // The tints are deliberately near zero in two channels. An emissive that is
    // bright in all three comes out of the tone map white, whatever colour it
    // started as, and five white shapes in a street tell you nothing.
    if (vPart < 13.5) {
      tint = vec3(1.0, 0.46, 0.05);            // ammunition, amber on olive
      albedo = vec3(0.13, 0.15, 0.08);
      force = 1.5;
    } else if (vPart < 14.5) {
      tint = vec3(1.0, 0.045, 0.03);           // the medical cross
      albedo = vec3(0.30, 0.04, 0.035);
      force = 3.4;
    } else if (vPart < 15.5) {
      tint = vec3(0.045, 0.22, 1.0);           // quad damage
      albedo = vec3(0.02, 0.04, 0.18);
      force = 4.2;
    } else if (vPart < 16.5) {
      tint = vec3(1.0, 0.62, 0.02);            // ultrashield
      albedo = vec3(0.18, 0.13, 0.03);
      force = 3.6;
    } else {
      tint = vec3(0.10, 1.0, 0.22);            // overload
      albedo = vec3(0.03, 0.15, 0.05);
      force = 3.6;
    }
    float pulse = 0.68 + 0.32 * sin(uCamPos.w * 3.4 + vPart);
    emissive = tint * force * pulse;
    rough = 0.25;
    metal = 0.2;
  } else if (vPart < 18.5) {
    // A hazard stripe. Painted, not lit: the band round a warhead reads from
    // the colour and the contrast, and a bomb that glows looks like a toy.
    float band = step(0.5, fract((vWorld.x + vWorld.y + vWorld.z) * 2.2));
    albedo = mix(vec3(0.52, 0.30, 0.03), vec3(0.06, 0.06, 0.07), band);
    rough = 0.6;
    metal = 0.15;
  } else if (vPart < 19.5) {
    // Flesh. Dark, wet and not very red, because blood on a dull street at
    // four in the afternoon is nearly black and the bright version looks
    // like paint.
    float v = hash11(floor(vWorld.x * 9.0) + floor(vWorld.z * 9.0) * 17.0);
    albedo = vec3(0.19, 0.030, 0.028) * (0.7 + 0.6 * v);
    rough = 0.32;
    metal = 0.0;
  } else if (vPart < 20.5) {
    // Bone and torn webbing, the pale pieces, so a burst of gibs is not one
    // uniform colour.
    albedo = vec3(0.56, 0.52, 0.45);
    rough = 0.8;
    metal = 0.02;
  } else if (vPart < 21.5) {
    // Broken render and concrete, off a building that came down.
    float v = hash11(floor(vWorld.x * 3.0) + floor(vWorld.z * 3.0) * 23.0);
    albedo = vec3(0.30, 0.285, 0.262) * (0.6 + 0.7 * v);
    rough = 0.96;
    metal = 0.0;
  } else if (vPart < 22.5) {
    // Brick out of the same wall.
    float v = hash11(floor(vWorld.x * 3.0) + floor(vWorld.y * 7.0));
    albedo = vec3(0.26, 0.115, 0.082) * (0.7 + 0.6 * v);
    rough = 0.93;
    metal = 0.0;
  } else {
    // Bone. Only ever visible on somebody who has been burnt down to it, and
    // the charring above takes it the rest of the way to black.
    albedo = vec3(0.50, 0.47, 0.41);
    rough = 0.72;
    metal = 0.0;
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
  // Burnt. Everything goes to charcoal and what little light is left in it
  // comes out of the cracks rather than off the surface.
  if (vCharred > 0.001) {
    float crack = hash11(floor(vWorld.y * 14.0) + floor(vWorld.x * 9.0) * 7.0);
    colour = mix(colour, vec3(0.020, 0.017, 0.015), vCharred);
    colour += vec3(1.0, 0.22, 0.03) * step(0.88, crack) * vCharred * 0.9;
  }
  // A white flash on the frame it takes a hit, so a connect is unmistakable.
  colour = mix(colour, vec3(3.0, 2.4, 1.6), vFlash * 0.75);
  colour = applyFog(colour, vWorld, uCamPos.xyz, uSunDir.xyz,
                    uSkyHorizon.rgb, uSkyZenith.rgb, uFog, uSkyZenith.w);
  fragColour = vec4(colour, 1.0);
}
`;

// The pieces. One mesh, drawn instanced, with the chunk's size and what it is
// made of carried per instance rather than baked into the geometry, so a burst
// of a dozen different looking chunks is still a single draw call.
export const GIB_VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aInfo;
layout(location = 5) in vec4 iPosYaw;   // xyz world position, w yaw
layout(location = 6) in vec4 iState;    // x pitch, y roll, z scale, w part id

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
  mat3 r = rotY(iPosYaw.w) * rotZ(iState.y) * rotX(iState.x);
  vec3 world = r * (aPos * iState.z) + iPosYaw.xyz;
  vWorld = world;
  vNormal = normalize(r * aNormal);
  // Each chunk declares what it is made of, so one mesh covers flesh, cloth,
  // a helmet and a piece of rifle without four meshes and four draw calls.
  vPart = iState.w;
  vFlash = 0.0;
  vViewDist = length(world - uCamPos.xyz);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

// Pickups ride the drone's fragment shader too. What is different is the
// motion: the pad stays flat on the pavement while the thing standing on it
// turns and bobs. Which is which comes from the mesh itself, in the second
// component of the vertex info, so one instanced draw carries both.
export const PICKUP_VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aInfo;     // x part id, y 1 if this part floats
layout(location = 5) in vec4 iPosYaw;   // xyz pad position, w spin
layout(location = 6) in vec4 iState;    // x bob height, y unused, z flash, w unused

out vec3 vWorld;
out vec3 vNormal;
flat out float vPart;
flat out float vFlash;
out float vViewDist;

void main() {
  vec3 p = aPos;
  vec3 n = aNormal;
  if (aInfo.y > 0.5) {
    float c = cos(iPosYaw.w), s = sin(iPosYaw.w);
    mat3 spin = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
    p = spin * p;
    n = spin * n;
    p.y += iState.x;
  }
  vec3 world = p + iPosYaw.xyz;
  vWorld = world;
  vNormal = normalize(n);
  vPart = aInfo.x;
  vFlash = iState.z;
  vViewDist = length(world - uCamPos.xyz);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

// The drones and everything else that is not a soldier can never be charred,
// so their build of the shader has the term compiled out rather than reading
// a varying nothing writes.
export const DRONE_FS = bodyFS('#define vCharred 0.0');
export const SOLDIER_FS = bodyFS('flat in float vCharred;');

// Soldiers share the drone's fragment shader and its instance layout, and
// differ only in what the vertex stage does with the transform: a walk cycle
// that swings the limbs, and a fall that lays the whole body down. The limbs
// know which they are from their own position rather than from an extra
// attribute, which keeps the vertex format the same as everything else here.
export const SOLDIER_VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aInfo;     // x part id
layout(location = 5) in vec4 iPosYaw;   // xyz feet position, w yaw
layout(location = 6) in vec4 iState;    // x fall, y roll, z hit flash, w walk phase
layout(location = 7) in vec4 iExtra;    // x charred 0..1

out vec3 vWorld;
out vec3 vNormal;
flat out float vPart;
flat out float vFlash;
flat out float vCharred;
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
  vec3 n = aNormal;
  float walk = iState.w;
  float charred = iExtra.x;
  vCharred = charred;

  // Burnt to the bone. The cloth, the webbing and the helmet shrink into
  // nothing and the skeleton inside them comes out. Both sets of parts are in
  // the one mesh and one of them is always collapsed to a point, which costs
  // a few dozen triangles and no draw calls at all.
  bool bone = aInfo.x > 22.5;
  float keep = bone ? charred : 1.0 - charred;
  if (keep < 0.999) {
    // Collapse towards the body's own centre line rather than towards the
    // origin, so what shrinks goes into the figure instead of into its feet.
    vec3 core = vec3(0.0, p.y, 0.0);
    p = core + (p - core) * keep;
    p.y = mix(p.y, 0.0, (1.0 - keep) * 0.0);
  }
  if (keep <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // Legs swing about the hip, arms about the shoulder, in opposition. Anything
  // above the belt and inboard of the shoulders is the trunk and stays put.
  float swing = sin(walk) * 0.5;
  if (p.y < 0.86) {
    // A leg. Which one decides the phase.
    float side = p.x < 0.0 ? 1.0 : -1.0;
    vec3 hip = vec3(p.x, 0.86, 0.0);
    mat3 r = rotX(swing * side);
    p = hip + r * (p - hip);
    n = r * n;
  } else if (abs(p.x) > 0.22 && p.y > 0.86 && p.y < 1.5) {
    // An arm, swinging the other way to the leg on the same side.
    float side = p.x < 0.0 ? -1.0 : 1.0;
    vec3 shoulder = vec3(p.x, 1.42, 0.0);
    mat3 r = rotX(swing * side * 0.6);
    p = shoulder + r * (p - shoulder);
    n = r * n;
  }

  // The fall: rotate the whole body about the feet. This is death, and it is
  // also what a banana does to you. The roll is zero unless the ragdoll cheat
  // is on, and then it carries whichever way the hit turned them, which is the
  // difference between a body that lies down and one that is knocked over.
  mat3 fall = rotZ(iState.y) * rotX(-iState.x);
  p = fall * p;
  n = fall * n;

  mat3 body = rotY(-iPosYaw.w);
  vec3 world = body * p + iPosYaw.xyz;
  vWorld = world;
  vNormal = normalize(body * n);
  vPart = aInfo.x;
  vFlash = iState.z;
  vViewDist = length(world - uCamPos.xyz);
  gl_Position = uViewProj * vec4(world, 1.0);
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

// A soldier's shadow has to lie down when they do, or a dead man goes on
// casting a standing shadow on the pavement next to his own body.
export const SOLDIER_SHADOW_VS = `${VERSION}
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 5) in vec4 iPosYaw;
layout(location = 6) in vec4 iState;
uniform mat4 uLightViewProj;
void main() {
  float fc = cos(-iState.x), fs = sin(-iState.x);
  mat3 pitch = mat3(1.0, 0.0, 0.0, 0.0, fc, fs, 0.0, -fs, fc);
  float rc = cos(iState.y), rs = sin(iState.y);
  mat3 fall = mat3(rc, rs, 0.0, -rs, rc, 0.0, 0.0, 0.0, 1.0) * pitch;
  float c = cos(-iPosYaw.w), s = sin(-iPosYaw.w);
  mat3 rot = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  gl_Position = uLightViewProj * vec4(rot * (fall * aPos) + iPosYaw.xyz, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Tracers and impact sparks, drawn as camera facing quads with additive blend.

export const SPARK_VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
layout(location = 5) in vec4 iA;    // xyz start, w kind
layout(location = 6) in vec4 iB;    // xyz end or spread, w life 0..1
layout(location = 7) in vec4 iC;    // rgb colour, w width
// Kinds: 0 tracer, 1 spark, 2 muzzle or blast flash, 3 blood, 4 a pool of it
// on the ground, 5 a column of light standing on the street. Three and four
// are drawn in a second pass with an ordinary alpha blend; the rest are
// additive.

out vec2 vUv;
flat out float vKind;
flat out float vLife;
flat out float vSeed;
flat out vec3 vColour;

void main() {
  int corner = gl_VertexID % 6;
  vec2 c = vec2(float((corner == 1 || corner == 2 || corner == 4) ? 1 : 0),
                float((corner == 2 || corner == 4 || corner == 5) ? 1 : 0));
  vUv = c;
  vKind = iA.w;
  vLife = iB.w;
  vSeed = iB.z;
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
  } else if (iA.w > 4.5) {
    // A column standing on the ground, turned to face the eye. iB.x is how
    // tall it is and iC.w how wide.
    vec3 base = iA.xyz;
    vec3 toEye = uCamPos.xyz - base;
    toEye.y = 0.0;
    float l = length(toEye);
    vec3 fwd = l > 0.001 ? toEye / l : vec3(0.0, 0.0, 1.0);
    vec3 right = normalize(vec3(fwd.z, 0.0, -fwd.x));
    pos = base + right * (c.x - 0.5) * 2.0 * iC.w + vec3(0.0, c.y * iB.x, 0.0);
  } else if (iA.w > 3.5) {
    // A pool on the pavement: flat, not turned to face anybody, growing to its
    // full size over the first second.
    vec3 centre = iA.xyz;
    float s = iC.w * mix(0.35, 1.0, iB.x);
    pos = centre + vec3((c.x - 0.5) * 2.0 * s, 0.0, (c.y - 0.5) * 2.0 * s);
  } else {
    // Spark, flash or a drop of blood: a billboard at a point.
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
flat in float vSeed;
flat in vec3 vColour;
layout(location = 0) out vec4 fragColour;

void main() {
  float a;
  if (vKind < 0.5) {
    // Tracer: bright core with a soft edge, fading towards the tail.
    float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
    a = pow(across, 2.2) * mix(0.15, 1.0, vUv.x);
  } else if (vKind > 4.5) {
    // A column. Hard bright core, soft shoulders, and it thins as it goes up
    // so the top of it disappears into the sky rather than being cut off.
    float across = abs(vUv.x - 0.5) * 2.0;
    float core = pow(max(0.0, 1.0 - across), 7.0);
    float glow = pow(max(0.0, 1.0 - across), 1.6) * 0.42;
    float up = 1.0 - smoothstep(0.35, 1.0, vUv.y) * 0.75;
    float pulse = 0.88 + 0.12 * sin(vSeed * 40.0 + vUv.y * 24.0);
    // Not faded by its life: a beam is on or it is not.
    float a = (core + glow) * up * pulse;
    if (a < 0.004) discard;
    fragColour = vec4(vColour * a, a);
    return;
  } else if (vKind > 3.5) {
    // A pool. A disc with a ragged edge, because a round one looks painted on.
    vec2 d = vUv - 0.5;
    float ang = atan(d.y, d.x);
    float edge = 0.46 + 0.045 * sin(ang * 5.0 + vSeed) + 0.03 * sin(ang * 9.0 - vSeed * 2.0);
    a = smoothstep(edge, edge - 0.09, length(d));
    // It dries from the rim inward over the last few seconds rather than
    // fading out as a whole, which is what a drying stain does.
    a *= smoothstep(0.0, 0.12, vLife);
    if (a < 0.01) discard;
    fragColour = vec4(vColour, a * 0.88);
    return;
  } else {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    a = pow(max(0.0, 1.0 - r), 2.4);
  }
  a *= vLife;
  if (a < 0.004) discard;
  // Blood is the one thing here that is darker than what is behind it, so it
  // is written as a colour with an alpha rather than as light to be added.
  if (vKind > 2.5) { fragColour = vec4(vColour, a); return; }
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
  } else if (vPart < 5.5) {
    // Plastic explosive in your hands, with the detonator light on it.
    albedo = vec3(0.70, 0.68, 0.62);
    rough = 0.85;
    metal = 0.02;
    float blink = step(0.5, fract(uCamPos.w * 1.6));
    emissive = vec3(1.0, 0.1, 0.06) * 2.0 * blink;
  } else if (vPart < 6.5) {
    // A banana. It has to read as one at a glance, so it is the one thing in
    // the hand that is not a shade of gunmetal.
    albedo = vec3(0.88, 0.74, 0.14);
    rough = 0.55;
    metal = 0.04;
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
