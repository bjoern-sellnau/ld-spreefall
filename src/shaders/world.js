import { VERSION, CAMERA_BLOCK, NOISE, FOG, SHADOW } from './common.js';
import { MAT, POS_SCALE, UV_SCALE, HEIGHT_SCALE, FACADE_FLAG } from '../shared/constants.js';

// What a blast does to the shape of the city, shared by the colour pass and
// the shadow pass so a flattened building does not go on casting a standing
// shadow.
//
// A site is a circle on the ground with a progress from zero to one. Inside
// it, anything that is not ground is pulled down towards the ground and
// pushed outward, which is a building folding in on itself; the ground itself
// is pulled into a bowl, which is a crater. The profile is deliberately
// simple and is mirrored exactly in src/game/demolition.js, because the
// collision has to agree with what you can see: if the two drift, you fall
// through a street that looks solid or walk on air over a crater.
export const MAX_COLLAPSE = 16;

export const COLLAPSE = `
uniform vec4 uCollapse[${16}];      // xyz centre at ground level, w collapse radius
uniform vec4 uCollapseInfo[${16}];  // x level, y crater depth, z crater radius, w heap (negative: crater only)
uniform int uCollapseCount;

// How far the fall runs ahead of itself at the middle of a site. A whole
// district does not come down in one piece: the centre goes first and the
// edge follows a beat later.
const float COLLAPSE_WAVE = 0.7;
// The ejecta ring around a crater, as a share of its depth, and how far out
// it reaches as a multiple of its radius.
const float CRATER_RIM = 0.18;
const float CRATER_RIM_OUT = 1.75;

// A cheap deterministic value in 0..1 from a position, so two vertices in the
// same place agree and a wall does not tear as it comes down.
float collapseHash(vec3 p) {
  return fract(sin(dot(floor(p * 2.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// How far into a site a point is: one at the middle, zero at the rim.
float collapseBite(vec3 p, vec4 site) {
  float d = length(p.xz - site.xz);
  return 1.0 - smoothstep(site.w * 0.30, site.w, d);
}

// The level this particular point has reached. The middle of a site is ahead
// of the edge, so a big collapse rolls outward instead of dropping flat.
float collapseLocal(float level, float bite) {
  return clamp(level * (1.0 + COLLAPSE_WAVE) - COLLAPSE_WAVE * (1.0 - bite), 0.0, 1.0) * bite;
}

/**
 * What the ground does: a bowl inside the crater radius and a raised ring of
 * thrown up earth just outside it. Everything beyond that is untouched, which
 * is the point. A warhead with a blast radius of a hundred and seventy metres
 * does not leave a hundred and seventy metre hole; it knocks a district down
 * and digs a crater a fraction of that across in the middle of it.
 */
float craterAt(vec2 p, vec4 site, float depth, float craterRadius, float level) {
  if (craterRadius <= 0.0 || depth <= 0.0) return 0.0;
  float r = length(p - site.xz);
  // Not named out: that is a reserved word in GLSL and the compiler says so
  // in a way that takes a minute to read.
  float outer = craterRadius * CRATER_RIM_OUT;
  if (r >= outer) return 0.0;
  if (r < craterRadius) {
    float k = 1.0 - smoothstep(0.0, craterRadius, r);
    return -depth * k * k * level;
  }
  float t = (r - craterRadius) / (outer - craterRadius);
  return depth * CRATER_RIM * sin(3.14159265 * t) * level;
}

/**
 * Moves one vertex. Returns how far gone it is, 0 to 1, which the colour pass
 * uses to turn a facade into rubble. A vertex below the line the building has
 * been cut back to does not move and does not get marked, so a block that has
 * lost its top two storeys is still a block for the two below them.
 *
 * @param height the building's own height, from the vertex attribute
 */
float applyCollapse(inout vec3 p, inout vec3 n, bool isGround, float height) {
  float worst = 0.0;
  for (int i = 0; i < ${16}; i++) {
    if (i >= uCollapseCount) break;
    vec4 site = uCollapse[i];
    if (site.w <= 0.0) continue;
    float bite = collapseBite(p, site);
    if (bite <= 0.0) continue;
    float level = collapseLocal(uCollapseInfo[i].x, bite);
    if (level <= 0.0) continue;

    if (isGround) {
      p.y += craterAt(p.xz, site, uCollapseInfo[i].y, uCollapseInfo[i].z,
                      min(1.0, uCollapseInfo[i].x));
      continue;
    }

    // A negative heap means this site digs its crater and leaves every wall
    // in it standing: the buildings switch in the cheat menu was off when it
    // opened. The sign carries it because both uniform vectors are full and
    // a heap of rubble is never less than nothing.
    if (uCollapseInfo[i].w < 0.0) continue;

    // Where this building has been cut back to. At a quarter gone it is the
    // top quarter that is missing; at one it is the whole thing.
    float above = p.y - site.y;
    if (above <= 0.001) continue;
    float full = max(height, above);
    float cut = full * (1.0 - level);
    if (above <= cut) continue;

    float jitter = collapseHash(p);
    float heap = uCollapseInfo[i].w * (0.3 + jitter * 0.8) * bite;
    float landed = min(above, cut + heap);
    float fell = above - landed;
    p.y -= fell;
    // What fell spreads out as it lands, by how far it fell rather than by
    // how tall the building was, so a top storey coming off scatters and a
    // whole block folding in piles up.
    vec2 away = p.xz - site.xz;
    float l = max(0.001, length(away));
    p.xz += (away / l) * fell * (0.09 + jitter * 0.13);
    p.x += (jitter - 0.5) * fell * 0.30;
    p.z += (collapseHash(p.zyx) - 0.5) * fell * 0.30;
    worst = max(worst, clamp(fell / max(1.0, above), 0.0, 1.0));
  }
  // Rubble has no walls left in it: the normals go flat as the fall completes,
  // or a collapsed facade lights like a facade lying down.
  if (worst > 0.0 && !isGround) n = normalize(mix(n, vec3(0.0, 1.0, 0.0), worst * 0.8));
  return worst;
}
`;

export const WORLD_VS = `${VERSION}
precision highp float;
precision highp int;
${CAMERA_BLOCK}
layout(location = 0) in ivec3 aPos;
layout(location = 1) in vec4 aNormal;
layout(location = 2) in uvec2 aUv;
layout(location = 3) in uvec4 aPacked;
layout(location = 4) in uint aHeight;

uniform vec3 uTileOrigin;
${COLLAPSE}

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
flat out uint vMat;
flat out uint vSeed;
flat out uint vLevels;
flat out uint vFlags;
flat out float vHeight;
out float vAo;
out float vFall;

void main() {
  vec3 p = vec3(aPos) * ${(1 / POS_SCALE).toFixed(8)} + uTileOrigin;
  vec3 nrm = normalize(aNormal.xyz);
  float bHeight = float(aHeight) * ${(1 / HEIGHT_SCALE).toFixed(8)};
  // Bit 16 is FACADE_FLAG.GROUND. It used to read bit 1, which is the shop
  // window band at the bottom of a wall, so streets were treated as walls and
  // never moved: the collision had a crater in it and the picture did not.
  vFall = uCollapseCount > 0
    ? applyCollapse(p, nrm, (aPacked.w & ${FACADE_FLAG.GROUND}u) != 0u, bHeight)
    : 0.0;
  // A ruin that was baked into the buffers is rubble for good, whether or not
  // the site that made it still has a slot.
  if ((aPacked.w & ${FACADE_FLAG.RUBBLE}u) != 0u) vFall = max(vFall, 1.0);
  // The fallback plane, pushed down by about what the depth buffer loses at
  // this distance. A twenty four bit buffer resolves roughly the square of
  // the distance over the near plane, so the correction is quadratic too: a
  // couple of centimetres down the street, a quarter of a metre at three
  // hundred, and never more than a metre and a half. Nothing is ever meant to
  // see this plane, and where it is exposed it is the ground far enough away
  // that a metre of it is a pixel.
  if ((aPacked.w & ${FACADE_FLAG.BASE}u) != 0u) {
    float away = distance(p.xz, uCamPos.xz);
    p.y -= min(1.5, away * away * 2.5e-6);
  }
  vWorld = p;
  vNormal = nrm;
  vAo = clamp(aNormal.w * 2.0, 0.0, 1.0);
  vUv = vec2(aUv) * ${(1 / UV_SCALE).toFixed(8)};
  vMat = aPacked.x;
  vSeed = aPacked.y;
  vLevels = aPacked.z;
  vFlags = aPacked.w;
  vHeight = bHeight;
  gl_Position = uViewProj * vec4(p, 1.0);
}
`;

export const WORLD_FS = `${VERSION}
precision highp float;
precision highp int;
${CAMERA_BLOCK}
${NOISE}
${SHADOW}
${FOG}

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
flat in uint vMat;
flat in uint vSeed;
flat in uint vLevels;
flat in uint vFlags;
flat in float vHeight;
in float vAo;
in float vFall;

// Distance to the eye, per fragment. It used to be a varying, which is wrong the
// moment a triangle is large: a square the size of Pariser Platz has its corners
// a hundred metres away, so the interpolated distance under your feet came out
// as ninety metres and every distance based effect, the shadow cascade choice
// included, used that. It costs one length() to get it right.
float vViewDist;

uniform vec3 uPalette[64];
// Blast marks. Up to sixteen of them, newest first, each a centre and a radius
// with a severity. The loop only runs as far as uScarCount, so a city nobody
// has fired at costs nothing at all for this.
#define MAX_SCARS 16
uniform vec4 uScars[MAX_SCARS];      // xyz centre, w radius
uniform vec4 uScarInfo[MAX_SCARS];   // x severity 0..1, y age in seconds
uniform int uScarCount;
uniform int uDebugMode;   // 0 off, 1 material, 2 normals, 3 uv, 4 world position
// 1 while the damaged tiles are drawn inside out, to fill the holes a blast
// leaves in one sided geometry. See Renderer.renderScene.
uniform float uInside;

layout(location = 0) out vec4 fragColour;

const uint FLAG_GROUND = 1u;
const uint FLAG_LANDMARK = 2u;
const uint FLAG_ROOF_SLOPE = 4u;
const uint FLAG_NO_WINDOWS = 8u;

// Procedural detail has no mip chain, so it has to be faded by hand or it turns
// into moire the moment a pixel covers more than about half a feature. These
// measure the pixel footprint in metres, in world space for the ground and in
// facade space for walls, and fade a pattern out as its features go sub pixel.
// That is what a mip chain would do, and it is a lot cheaper than distance
// thresholds picked by eye, which are wrong at every grazing angle.
// The isotropic equivalent pixel footprint on the ground, in metres. The
// geometric mean rather than the maximum, because a road seen edge on has a
// footprint a metre long and a centimetre wide, and the maximum would throw
// away detail that is still perfectly resolved across the road.
float groundFootprint() {
  return sqrt(max(fwidth(vWorld.x), 1e-5) * max(fwidth(vWorld.z), 1e-5));
}

float detailFade(float featureSize) {
  return 1.0 - smoothstep(featureSize * 0.7, featureSize * 2.6, groundFootprint());
}

float detailFadeUv(float featureSize) {
  float px = max(fwidth(vUv.x), fwidth(vUv.y));
  return 1.0 - smoothstep(featureSize * 0.7, featureSize * 2.6, px);
}

struct Surface {
  vec3 albedo;
  float roughness;
  float metallic;
  vec3 emissive;
  vec3 normal;
};

// ---------------------------------------------------------------------------
// Facades. The window grid is derived from the level count so a five storey
// block gets five rows of windows, and every building has its own rhythm.

Surface facade(vec3 base, int wallKind) {
  Surface s;
  s.normal = vNormal;
  s.roughness = 0.86;
  s.metallic = 0.0;
  s.emissive = vec3(0.0);

  float seedF = float(vSeed >> 6u);
  float rnd = hash11(seedF * 7.31 + float(vSeed & 63u) * 1.13 + 0.5);
  float levels = max(float(vLevels), 1.0);
  float total = max(vHeight, 3.0);
  // A landmark is not a block of flats. Its openings are fewer, taller, wider
  // apart and arched, and it has a rusticated base rather than shopfronts.
  bool mon = (vFlags & FLAG_LANDMARK) != 0u;
  float floorH = mon ? max(total / levels, 4.5) : clamp(total / levels, 2.7, 5.4);
  float groundH = mon ? min(floorH * 1.05, total * 0.42)
                      : min(max(floorH * 1.22, 3.6), total * 0.6);

  float y = vUv.y;
  float x = vUv.x;

  // The wall itself, before any openings are cut into it.
  vec3 wall = base;
  float wallRough = 0.86;
  if (wallKind == 1) {
    // Coursed stone.
    vec2 p = vUv / 0.82;
    p.x += floor(p.y) * 0.5;
    vec2 f = fract(p);
    float joint = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float line = smoothstep(0.0, 0.05, joint);
    wall = base * (0.92 + 0.14 * hash12(floor(p)));
    wall = mix(wall * 0.70, wall, line);
    wallRough = 0.84;
  } else if (wallKind == 2) {
    // Brickwork, Berlin uses a lot of it north of the Spree.
    vec2 p = vUv / vec2(0.24, 0.083);
    p.x += floor(p.y) * 0.5;
    vec2 f = fract(p);
    float joint = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float line = smoothstep(0.0, 0.14, joint);
    wall = base * (0.86 + 0.28 * hash12(floor(p)));
    wall = mix(base * 0.55 + vec3(0.06), wall, line);
    wallRough = 0.92;
  } else if (wallKind == 3) {
    float n = fbm(vUv * 2.2) * 0.10 + fbm(vUv * 9.0) * 0.05;
    wall = base * (0.92 + n);
    float board = smoothstep(0.0, 0.035, abs(fract(vUv.y / 1.2) - 0.5) * 1.2);
    wall *= mix(0.9, 1.0, board);
    wallRough = 0.9;
  } else {
    // Plaster, with mottling and a little grime running down from the sills.
    float grime = fbm(vec2(x * 0.5, y * 0.5) + seedF * 3.0) * 0.14;
    wall = base * (1.0 - grime);
  }

  // Plinth.
  if (y < 1.05) {
    s.albedo = mix(wall * 0.58, vec3(0.30, 0.29, 0.275), 0.5) * (0.7 + 0.3 * vAo);
    s.roughness = 0.92;
    return s;
  }

  float bandW = mon ? mix(5.0, 7.0, rnd) : mix(2.5, 3.6, rnd);
  float colIndex = floor(x / bandW);
  float fx = fract(x / bandW);

  if (y < groundH && mon) {
    // A rusticated plinth storey with deep horizontal channels.
    float course = fract(y / 1.05);
    float channel = smoothstep(0.0, 0.10, min(course, 1.0 - course));
    vec3 col = wall * mix(0.66, 1.04, channel);
    float opening = step(0.5 - 0.10, fx) * step(fx, 0.5 + 0.10)
                  * step(1.3, y) * step(y, groundH - 1.0);
    col = mix(col, vec3(0.045, 0.052, 0.062), opening);
    s.albedo = col * (0.74 + 0.26 * vAo);
    s.roughness = opening > 0.5 ? 0.2 : wallRough;
    s.emissive = vec3(1.0, 0.84, 0.6) * 1.1 * opening * uMisc.y;
    return s;
  }

  if (y < groundH) {
    // Shopfronts: a wide glazed bay with a mullion, a stall riser and a fascia.
    float bay = fract(x / (bandW * 1.5));
    float fascia = smoothstep(groundH - 0.78, groundH - 0.58, y);
    if (y > 1.05 && y < groundH - 0.85 && bay > 0.12 && bay < 0.88) {
      float lit = step(0.42, hash12(vec2(colIndex, 3.0) + seedF));
      s.emissive = vec3(1.0, 0.86, 0.62) * 2.2 * lit * uMisc.y;
      s.albedo = vec3(0.055, 0.070, 0.085);
      s.roughness = 0.14;
      s.metallic = 0.08;
      return s;
    }
    s.albedo = mix(wall * 0.90, vec3(0.36, 0.34, 0.32), fascia * 0.55) * (0.72 + 0.28 * vAo);
    s.roughness = wallRough;
    return s;
  }

  float upper = y - groundH;
  float rowIndex = floor(upper / floorH);
  float fy = fract(upper / floorH);

  // Openings: about a third of the bay wide and about half the storey tall,
  // which is roughly the proportion of a Berlin Gruenderzeit window.
  float wWide = mon ? mix(0.085, 0.130, hash11(seedF * 3.7 + 1.9))
                    : mix(0.155, 0.245, hash11(seedF * 3.7 + 1.9));
  float wTall = mon ? mix(0.44, 0.60, hash11(seedF * 5.1 + 2.3))
                    : mix(0.30, 0.44, hash11(seedF * 5.1 + 2.3));
  float dx = abs(fx - 0.5);
  float dy = fy - (mon ? 0.22 : 0.30);
  float widthHere = wWide;
  if (mon) {
    // Round the head of the opening into an arch over its top quarter.
    float archStart = wTall * 0.74;
    if (dy > archStart) {
      float t = clamp((dy - archStart) / max(wTall - archStart, 1e-4), 0.0, 1.0);
      widthHere = wWide * sqrt(max(1.0 - t * t, 0.0));
    }
  }
  bool inOpening = dx < widthHere && dy > 0.0 && dy < wTall;

  float eaves = smoothstep(total - groundH - 1.0, total - groundH - 0.6, upper);
  float cornice = 1.0 - smoothstep(0.0, 0.18, upper);

  if (inOpening && eaves < 0.5) {
    float roll = hash12(vec2(colIndex, rowIndex) + seedF * 17.0);
    // A reveal of a few centimetres, so the frame catches the sun.
    bool inGlass = dx < widthHere - (mon ? 0.020 : 0.030) && dy > 0.035 && dy < wTall - (mon ? 0.020 : 0.035);
    if (!inGlass) {
      s.albedo = mix(wall, vec3(0.86, 0.85, 0.82), 0.55) * (0.8 + 0.2 * vAo);
      s.roughness = 0.6;
      return s;
    }
    // A transom bar across the top third of the sash.
    bool bar = (!mon && abs(dy - wTall * 0.66) < 0.012) || abs(dx) < (mon ? 0.008 : 0.010);
    if (bar) {
      s.albedo = vec3(0.62, 0.61, 0.58);
      s.roughness = 0.55;
      return s;
    }
    s.albedo = vec3(0.050, 0.064, 0.082) * (0.6 + 0.8 * roll);
    s.roughness = 0.10;
    s.metallic = 0.06;
    s.emissive = vec3(1.0, 0.83, 0.58) * 2.0 * step(0.55, roll) * uMisc.y;
    return s;
  }

  // Sill and lintel bands, and the string course between the storeys.
  float sill = smoothstep(0.020, 0.0, abs(dy + 0.022)) * step(dx, wWide + 0.035);
  float band = 1.0 - cornice * 0.14 - eaves * 0.08;
  vec3 col = wall * band;
  col = mix(col, col * 1.22, sill);
  col *= 1.0 - clamp((1.0 - y / max(total, 1.0)) * 0.08, 0.0, 0.08);
  s.albedo = col * (0.72 + 0.28 * vAo);
  s.roughness = wallRough;
  return s;
}

// ---------------------------------------------------------------------------
// Ground surfaces.

Surface asphalt() {
  Surface s;
  s.normal = vNormal;
  s.metallic = 0.0;
  s.emissive = vec3(0.0);
  float grain = fbm(vWorld.xz * 3.1) * 0.10 + fbm(vWorld.xz * 21.0) * 0.05 * detailFade(0.050);
  vec3 col = vec3(0.088, 0.090, 0.096) + grain * 0.5;
  float across = vUv.x;
  float along = vUv.y;
  float halfW = max(vHeight * 0.5, 2.0);

  // Markings are widened to the pixel footprint across the road, and the dashes
  // dissolve into a continuous line once a pixel is longer than a gap. Drawn
  // any other way, a road seen almost edge on turns into an interference
  // pattern rather than a road.
  float wAcross = max(fwidth(across), 0.0005);
  float wAlong = max(fwidth(along), 0.0005);
  float centre = 1.0 - smoothstep(0.06, 0.13 + wAcross * 1.5, abs(across));
  float dashSoft = smoothstep(2.2, 4.5, wAlong);
  float dash = mix(step(0.42, fract(along / 9.0)), 0.58, dashSoft);
  float edge = 1.0 - smoothstep(0.09, 0.17 + wAcross * 1.5, abs(abs(across) - (halfW - 0.42)));
  float lanes = 0.0;
  if (halfW > 5.0) {
    float lanePitch = halfW / floor(halfW / 3.1);
    float d = abs(fract(across / lanePitch + 0.5) - 0.5) * lanePitch;
    lanes = (1.0 - smoothstep(0.06, 0.12 + wAcross * 1.5, d))
          * mix(step(0.5, fract(along / 7.0)), 0.5, dashSoft)
          * step(1.2, abs(across));
  }
  float paint = clamp(max(centre * dash, max(edge, lanes)), 0.0, 1.0);
  // Once the marking itself is thinner than a pixel there is nothing to draw.
  paint *= 1.0 - smoothstep(0.16, 0.55, wAcross);
  float wear = 0.55 + 0.45 * fbm(vWorld.xz * 6.0);
  col = mix(col, vec3(0.74, 0.72, 0.66) * wear, paint * 0.9);
  s.albedo = col;
  s.roughness = mix(0.72, 0.5, paint);
  return s;
}

Surface cobble() {
  Surface s;
  s.metallic = 0.0;
  s.emissive = vec3(0.0);
  // Berlin sett is a granite cube about a hand across, so ten centimetres.
  const float stone = 9.5;
  vec3 c = cells(vWorld.xz * stone);
  float fp = groundFootprint() * stone;
  float joint = smoothstep(0.0, max(0.16, fp * 1.3), c.y);
  float toneFade = 1.0 - smoothstep(0.5, 1.7, fp);
  float tone = mix(1.0, 0.56 + 0.42 * c.z, toneFade);
  vec3 col = vec3(0.215, 0.210, 0.203) * tone;
  col = mix(vec3(0.062, 0.062, 0.058), col, joint);
  vec2 g = vec2(dFdx(c.x), dFdy(c.x)) * 3.0 * toneFade;
  s.normal = normalize(vNormal + vec3(g.x, 0.0, g.y) * joint);
  s.albedo = col;
  s.roughness = mix(0.55, 0.86, joint);
  return s;
}

Surface pavement() {
  Surface s;
  s.metallic = 0.0;
  s.emissive = vec3(0.0);
  const float slab = 0.75;
  vec2 p = vWorld.xz / slab;
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float joint = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  // The joint is widened to the pixel footprint rather than faded out, so it
  // blurs into a soft band at distance instead of turning into moire.
  float fp = groundFootprint() / slab;
  float line = smoothstep(0.0, max(0.035, fp * 1.6), joint);
  float cellFade = 1.0 - smoothstep(0.55, 1.6, fp);
  float tone = mix(1.0, 0.80 + 0.22 * hash12(cell), cellFade);
  vec3 col = vec3(0.215, 0.208, 0.196) * tone;
  col = mix(col * 0.42, col, line);
  col += (fbm(vWorld.xz * 8.0) - 0.5) * 0.05 * detailFade(0.12);
  s.normal = vNormal;
  s.albedo = col;
  s.roughness = 0.86;
  return s;
}

Surface grass() {
  Surface s;
  s.metallic = 0.0;
  s.emissive = vec3(0.0);
  float fade = detailFade(0.060);
  float n = fbm(vWorld.xz * 2.3);
  float n2 = mix(0.5, fbm(vWorld.xz * 14.0), fade);
  vec3 a = vec3(0.098, 0.156, 0.068);
  vec3 b = vec3(0.150, 0.218, 0.094);
  vec3 col = mix(a, b, n) * (0.82 + 0.36 * n2);
  s.normal = normalize(vNormal + vec3(dFdx(n2), 0.0, dFdy(n2)) * 1.5 * fade);
  s.albedo = col;
  s.roughness = 0.95;
  return s;
}

Surface gravel() {
  Surface s;
  s.metallic = 0.0;
  s.emissive = vec3(0.0);
  vec3 c = cells(vWorld.xz * 11.0);
  vec3 col = vec3(0.26, 0.245, 0.225) * (0.72 + 0.5 * c.z);
  s.normal = vNormal;
  s.albedo = col;
  s.roughness = 0.94;
  return s;
}

Surface water() {
  Surface s;
  s.metallic = 0.0;
  s.emissive = vec3(0.0);
  float t = uCamPos.w;
  vec2 p = vWorld.xz;
  // Two scrolling wave trains at different scales give a believable ripple
  // without a normal map.
  float h1 = fbm(p * 0.22 + vec2(t * 0.055, t * 0.021));
  float h2 = fbm(p * 0.65 - vec2(t * 0.033, t * 0.078));
  float h = h1 * 0.7 + h2 * 0.3;
  vec2 grad = vec2(dFdx(h), dFdy(h)) * 60.0;
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
  s.normal = n;
  vec3 view = normalize(uCamPos.xyz - vWorld);
  vec3 refl = reflect(-view, n);
  // Sky approximation: the horizon colour near the horizon, zenith above.
  vec3 sky = mix(uSkyHorizon.rgb, uSkyZenith.rgb, clamp(refl.y * 1.6, 0.0, 1.0));
  float fres = pow(1.0 - clamp(dot(view, n), 0.0, 1.0), 4.0);
  fres = mix(0.035, 1.0, fres);
  vec3 deep = vec3(0.030, 0.055, 0.062);
  s.albedo = mix(deep, sky * 0.9, fres);
  // A specular glint off the sun, which is what sells moving water.
  float spec = pow(max(dot(refl, uSunDir.xyz), 0.0), 220.0);
  s.emissive = uSunColour.rgb * spec * 3.4;
  s.roughness = 0.06;
  return s;
}

// The four roof tones, chosen in the builder from roof:material and
// roof:colour and carried in the two bits above the palette index. Four is
// what you can tell apart from a street: the dark tile most of this city is
// under, the red tile of the older blocks, grey slate, and copper gone green.
const vec3 ROOF_TONE[4] = vec3[4](
  vec3(0.128, 0.098, 0.092),
  vec3(0.196, 0.086, 0.060),
  vec3(0.104, 0.112, 0.118),
  vec3(0.074, 0.152, 0.126));

Surface roofTiles() {
  Surface s;
  s.metallic = 0.0;
  s.emissive = vec3(0.0);
  vec2 p = vUv * vec2(2.6, 2.2);
  float rows = fract(p.y);
  float line = smoothstep(0.0, 0.07, rows) * smoothstep(0.0, 0.07, 1.0 - rows);
  float tone = 0.75 + 0.35 * hash12(floor(p));
  vec3 col = ROOF_TONE[int((vSeed >> 6u) & 3u)] * tone;
  col = mix(col * 0.6, col, line);
  s.normal = vNormal;
  s.albedo = col;
  s.roughness = 0.88;
  return s;
}

Surface stone(vec3 tint, float rough, float blockScale) {
  Surface s;
  s.metallic = 0.0;
  s.emissive = vec3(0.0);
  vec2 p = vUv / blockScale;
  p.x += floor(p.y) * 0.5;
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float joint = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float fade = detailFadeUv(0.045);
  float line = mix(1.0, smoothstep(0.0, 0.04, joint), fade);
  float tone = mix(1.0, 0.9 + 0.16 * hash12(cell), fade);
  vec3 col = tint * tone;
  col = mix(col * 0.72, col, line);
  col *= 1.0 - fbm(vUv * 1.3) * 0.12;
  s.normal = vNormal;
  s.albedo = col * (0.74 + 0.26 * vAo);
  s.roughness = rough;
  return s;
}

Surface brick() {
  Surface s = stone(vec3(0.360, 0.170, 0.120), 0.9, 0.24);
  return s;
}

Surface concrete() {
  Surface s;
  s.metallic = 0.0;
  s.emissive = vec3(0.0);
  float n = fbm(vUv * 2.2) * 0.10 + fbm(vUv * 9.0) * 0.05;
  vec3 col = vec3(0.310, 0.305, 0.292) * (0.92 + n);
  // Shuttering marks.
  float board = smoothstep(0.0, 0.035, abs(fract(vUv.y / 1.2) - 0.5) * 1.2);
  col *= mix(0.9, 1.0, board);
  s.normal = vNormal;
  s.albedo = col * (0.72 + 0.28 * vAo);
  s.roughness = 0.88;
  return s;
}

// Eisenman's stelae are dark grey precast concrete, near enough charcoal in
// daylight, with the shutter marks and the pour lines still showing.
Surface stele() {
  Surface s;
  s.metallic = 0.0;
  s.emissive = vec3(0.0);
  float fade = detailFadeUv(0.060);
  float n = (fbm(vUv * 3.0) - 0.5) * 0.16 + (fbm(vUv * 14.0) - 0.5) * 0.09 * fade;
  vec3 col = vec3(0.108, 0.106, 0.104) * (1.0 + n);
  // The horizontal joint where each block was cast.
  float pour = smoothstep(0.0, 0.030, abs(fract(vUv.y / 1.15) - 0.5) * 1.15);
  col *= mix(0.82, 1.0, mix(1.0, pour, fade));
  // Weathering runs down the faces.
  col *= 1.0 - fbm(vec2(vUv.x * 6.0, vUv.y * 0.7)) * 0.12;
  s.normal = vNormal;
  s.albedo = col * (0.70 + 0.30 * vAo);
  s.roughness = 0.92;
  return s;
}

Surface copper() {
  Surface s;
  float n = fbm(vUv * 0.9);
  vec3 patina = mix(vec3(0.145, 0.330, 0.276), vec3(0.205, 0.400, 0.330), n);
  s.albedo = patina * (0.86 + 0.2 * fbm(vUv * 6.0));
  s.roughness = 0.55;
  s.metallic = 0.15;
  s.emissive = vec3(0.0);
  s.normal = vNormal;
  return s;
}

Surface glassPanel() {
  Surface s;
  vec2 p = vec2(vUv.x / 1.5, vUv.y / 3.4);
  vec2 f = fract(p);
  float mull = smoothstep(0.0, 0.055, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  vec3 view = normalize(uCamPos.xyz - vWorld);
  vec3 refl = reflect(-view, vNormal);
  vec3 sky = mix(uSkyHorizon.rgb, uSkyZenith.rgb, clamp(refl.y * 1.5, 0.0, 1.0));
  float fres = pow(1.0 - clamp(dot(view, vNormal), 0.0, 1.0), 3.0);
  vec3 col = mix(vec3(0.035, 0.052, 0.068), sky * 0.55, mix(0.16, 0.92, fres));
  col = mix(vec3(0.20, 0.21, 0.22), col, mull);
  float lit = step(0.6, hash12(floor(p)));
  s.emissive = vec3(1.0, 0.86, 0.64) * 1.6 * lit * uMisc.y * mull;
  s.albedo = col;
  s.roughness = mix(0.5, 0.08, mull);
  s.metallic = 0.25 * mull;
  s.normal = vNormal;
  return s;
}

Surface metalPanel() {
  Surface s;
  s.albedo = vec3(0.42, 0.44, 0.46) * (0.86 + 0.2 * fbm(vUv * 4.0));
  s.roughness = 0.34;
  s.metallic = 0.7;
  s.emissive = vec3(0.0);
  s.normal = vNormal;
  return s;
}

// ---------------------------------------------------------------------------

void main() {
  vViewDist = length(vWorld - uCamPos.xyz);
  uint m = vMat;
  Surface s;
  // Anything with storeys and no explicit ban gets a facade cut into it, so a
  // stone or brick block is a building rather than a slab.
  bool wantWindows = (vFlags & FLAG_NO_WINDOWS) == 0u && vLevels > 0u && vHeight > 3.0;
  if (m == ${MAT.FACADE}u) {
    vec3 base = uPalette[int(vSeed & 63u)];
    if (wantWindows) s = facade(base, 0); else s = stone(base, 0.86, 0.9);
  }
  else if (m == ${MAT.SANDSTONE}u && wantWindows) s = facade(vec3(0.470, 0.418, 0.318), 1);
  else if (m == ${MAT.BRICK}u && wantWindows) s = facade(vec3(0.360, 0.170, 0.120), 2);
  else if (m == ${MAT.CONCRETE}u && wantWindows) s = facade(vec3(0.310, 0.305, 0.292), 3);
  else if (m == ${MAT.ROOF}u) s = roofTiles();
  else if (m == ${MAT.ASPHALT}u) s = asphalt();
  else if (m == ${MAT.COBBLE}u) s = cobble();
  else if (m == ${MAT.PAVEMENT}u) s = pavement();
  else if (m == ${MAT.GRASS}u) s = grass();
  else if (m == ${MAT.WATER}u) s = water();
  else if (m == ${MAT.CONCRETE}u) s = concrete();
  else if (m == ${MAT.STELE}u) s = stele();
  else if (m == ${MAT.SANDSTONE}u) s = stone(vec3(0.560, 0.500, 0.386), 0.84, 1.35);
  else if (m == ${MAT.COPPER}u) s = copper();
  else if (m == ${MAT.GLASS}u) s = glassPanel();
  else if (m == ${MAT.BRICK}u) s = brick();
  else if (m == ${MAT.GRAVEL}u) s = gravel();
  else if (m == ${MAT.METAL}u) s = metalPanel();
  else s = pavement();

  if (uDebugMode != 0) {
    vec3 d;
    if (uDebugMode == 1) {
      float f = float(m);
      d = vec3(fract(f * 0.2237), fract(f * 0.4013 + 0.33), fract(f * 0.7311 + 0.66));
      d = mix(d, s.albedo * 3.0, 0.15);
    } else if (uDebugMode == 2) {
      d = normalize(s.normal) * 0.5 + 0.5;
    } else if (uDebugMode == 3) {
      d = vec3(fract(vUv * 0.5), 0.0);
    } else if (uDebugMode == 4) {
      d = vec3(fract(vWorld.xz * 0.5), fract(vWorld.y * 0.5));
    } else if (uDebugMode == 5) {
      d = vec3(float(m) / 16.0);
    } else if (uDebugMode == 6) {
      d = vec3(detailFade(0.030));
    } else {
      d = vec3(clamp(vViewDist / 200.0, 0.0, 1.0));
    }
    fragColour = vec4(d, 1.0);
    return;
  }

  vec3 n = normalize(s.normal);
  // The inside of a surface. Every wall and every street in this city is one
  // sided, so this is what you are looking at through a hole a blast has
  // made: the back of the ground, the back of a wall, the inside of a ruin.
  // It is lit with the normal turned round and then taken down to almost
  // nothing, because the inside of the world has no light in it, and a black
  // bite reads as damage where a bright one reads as a bug.
  float inside = (gl_FrontFacing && uInside < 0.5) ? 1.0 : 0.0;
  if (!gl_FrontFacing) n = -n;
  vec3 L = uSunDir.xyz;
  vec3 V = normalize(uCamPos.xyz - vWorld);
  float ndl = max(dot(n, L), 0.0);

  float shadow = shadowFactor(vWorld, ndl, vViewDist);
  vec3 direct = uSunColour.rgb * ndl * shadow;

  // Ambient. Sky irradiance is blue but nothing like as blue as the sky itself
  // looks, because most of the hemisphere is pale near the horizon, so the dome
  // term is pulled towards neutral before it is applied. Without that, every
  // shadow in the city reads as midnight blue.
  float upness = n.y * 0.5 + 0.5;
  vec3 dome = mix(uSkyHorizon.rgb, uSkyZenith.rgb, upness);
  float domeLum = dot(dome, vec3(0.2126, 0.7152, 0.0722));
  dome = mix(dome, vec3(domeLum), 0.42) * 2.00;
  // Light bounced off the street, warm and coming from below.
  vec3 bounce = vec3(0.20, 0.185, 0.160) * (uSunColour.r * 0.48 + 0.10);
  vec3 ambient = dome * (0.34 + 0.66 * upness) + bounce * (1.0 - upness * 0.7);
  ambient *= mix(0.62, 1.0, vAo);
  // Contact darkening near the ground so buildings sit on the street.
  ambient *= mix(0.80, 1.0, clamp(vWorld.y * 0.28, 0.0, 1.0));

  // --- what came down ------------------------------------------------------
  // A fragment that has been moved by a collapse is no longer a facade. The
  // render goes to broken concrete and brick dust, the windows go with it, and
  // the whole thing roughens. This is the colour half of what the vertex
  // shader did to the shape.
  if (vFall > 0.001) {
    float grit = vnoise(vWorld.xz * 2.6 + vWorld.y * 1.4) * 0.5
               + vnoise(vWorld.xz * 11.0) * 0.25;
    vec3 rubble = vec3(0.185, 0.172, 0.158) * (0.55 + grit * 0.9);
    s.albedo = mix(s.albedo, rubble, clamp(vFall * 1.25, 0.0, 1.0));
    s.roughness = mix(s.roughness, 0.97, vFall);
    s.metallic = mix(s.metallic, 0.0, vFall);
    s.emissive *= 1.0 - clamp(vFall * 2.0, 0.0, 1.0);
  }

  // --- what the explosions did ---------------------------------------------
  // Scorching, cracked render and blown out windows around each blast, falling
  // off with distance from it. What moves is handled above; this is the mark
  // left on everything that is still standing.
  float scorch = 0.0;
  float shatter = 0.0;
  for (int i = 0; i < uScarCount; i++) {
    vec3 d = vWorld - uScars[i].xyz;
    float r = uScars[i].w;
    float dist = length(d);
    if (dist > r) continue;
    float t = 1.0 - dist / r;
    float sev = uScarInfo[i].x;
    // A ragged edge rather than a circle, from the same noise the facades use.
    float edge = vnoise(vWorld.xz * 1.7 + vWorld.y * 0.9 + float(i) * 17.0) * 0.35;
    float mark = smoothstep(0.0, 0.45, t + edge - 0.25) * sev;
    scorch = max(scorch, mark);
    shatter = max(shatter, smoothstep(0.1, 0.75, t) * sev);
  }
  if (scorch > 0.001) {
    // Soot: darker, rougher, and it kills the specular on whatever it is on.
    s.albedo = mix(s.albedo, s.albedo * 0.16 + vec3(0.012, 0.010, 0.009), scorch * 0.9);
    s.roughness = mix(s.roughness, 0.98, scorch * 0.8);
    s.metallic = mix(s.metallic, 0.0, scorch);
    // Glass near a blast is gone: the lit window becomes a hole.
    s.emissive *= 1.0 - clamp(shatter * 1.4, 0.0, 1.0);
  }

  vec3 diffuse = s.albedo * (direct + ambient);

  // A single Blinn Phong lobe stands in for the specular. Cheap, and enough.
  vec3 H = normalize(L + V);
  float gloss = pow(max(1.0 - s.roughness, 0.001), 2.0) * 512.0 + 2.0;
  float spec = pow(max(dot(n, H), 0.0), gloss) * (1.0 - s.roughness) * shadow;
  vec3 specular = uSunColour.rgb * spec * mix(0.06, 1.0, s.metallic);
  // Sky reflection on wet looking or metallic surfaces.
  float fres = pow(1.0 - max(dot(n, V), 0.0), 5.0) * (1.0 - s.roughness);
  specular += mix(uSkyHorizon.rgb, uSkyZenith.rgb, upness) * fres * 0.30;

  vec3 colour = diffuse + specular + s.emissive;
  // Looking at the back of the world: the broken edge of a street or the
  // inside of a wall that has had a bite taken out of it. Nearly black, with
  // a little of the surface left so the shape is still readable, and the fog
  // still on top so a hole three streets away is not a black hole punched in
  // the picture.
  colour = mix(colour * 0.09, colour, inside);
  colour = applyFog(colour, vWorld, uCamPos.xyz, uSunDir.xyz,
                    uSkyHorizon.rgb, uSkyZenith.rgb, uFog, uSkyZenith.w);
  fragColour = vec4(colour, 1.0);
}
`;

export const SHADOW_VS = `${VERSION}
precision highp float;
precision highp int;
layout(location = 0) in ivec3 aPos;
layout(location = 3) in uvec4 aPacked;
layout(location = 4) in uint aHeight;
uniform mat4 uLightViewProj;
uniform vec3 uTileOrigin;
${COLLAPSE}
void main() {
  vec3 p = vec3(aPos) * ${(1 / POS_SCALE).toFixed(8)} + uTileOrigin;
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  if (uCollapseCount > 0) {
    applyCollapse(p, nrm, (aPacked.w & ${FACADE_FLAG.GROUND}u) != 0u,
      float(aHeight) * ${(1 / HEIGHT_SCALE).toFixed(8)});
  }
  gl_Position = uLightViewProj * vec4(p, 1.0);
}
`;

export const SHADOW_FS = `${VERSION}
precision highp float;
void main() {}
`;
