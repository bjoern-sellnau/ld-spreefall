import { VERSION, FULLSCREEN_VS, TONEMAP } from './common.js';

export { FULLSCREEN_VS };

export const BRIGHT_FS = `${VERSION}
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
uniform float uKnee;
layout(location = 0) out vec4 fragColour;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  fragColour = vec4(c * w, 1.0);
}
`;

export const BLUR_FS = `${VERSION}
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uDirection;    // texel sized step
layout(location = 0) out vec4 fragColour;
void main() {
  // Nine tap Gaussian folded into five bilinear fetches.
  vec3 c = texture(uSource, vUv).rgb * 0.2270270270;
  vec2 o1 = uDirection * 1.3846153846;
  vec2 o2 = uDirection * 3.2307692308;
  c += texture(uSource, vUv + o1).rgb * 0.3162162162;
  c += texture(uSource, vUv - o1).rgb * 0.3162162162;
  c += texture(uSource, vUv + o2).rgb * 0.0702702703;
  c += texture(uSource, vUv - o2).rgb * 0.0702702703;
  fragColour = vec4(c, 1.0);
}
`;

export const COMPOSITE_FS = `${VERSION}
precision highp float;
${TONEMAP}
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uTexel;
uniform float uExposure;
uniform float uBloomAmount;
uniform float uVignette;
uniform float uFxaa;
uniform float uRaw;      // 1 while a debug view is up, so nothing is graded
uniform float uSlow;     // 0 to 1, how far into the slowed world we are
layout(location = 0) out vec4 fragColour;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// FXAA 3.11 console variant, trimmed. Enough to kill the stair steps on a
// skyline without a second geometry pass.
vec3 fxaa(sampler2D tex, vec2 uv, vec2 texel) {
  vec3 rgbM = texture(tex, uv).rgb;
  float lM = luma(rgbM);
  float lNW = luma(texture(tex, uv + vec2(-1.0, -1.0) * texel).rgb);
  float lNE = luma(texture(tex, uv + vec2(1.0, -1.0) * texel).rgb);
  float lSW = luma(texture(tex, uv + vec2(-1.0, 1.0) * texel).rgb);
  float lSE = luma(texture(tex, uv + vec2(1.0, 1.0) * texel).rgb);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) return rgbM;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, -8.0, 8.0) * texel;
  vec3 a = 0.5 * (texture(tex, uv + dir * (1.0 / 3.0 - 0.5)).rgb
                + texture(tex, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture(tex, uv - dir * 0.5).rgb
                           + texture(tex, uv + dir * 0.5).rgb);
  float lB = luma(b);
  return (lB < lMin || lB > lMax) ? a : b;
}

void main() {
  vec3 scene = uFxaa > 0.5 ? fxaa(uScene, vUv, uTexel) : texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  if (uRaw > 0.5) { fragColour = vec4(scene, 1.0); return; }
  vec3 c = scene + bloom * uBloomAmount;
  c *= uExposure;
  c = acesTonemap(c);
  // Vignette, gentle enough that nobody notices it until it is gone.
  vec2 d = vUv - 0.5;
  float vig = 1.0 - dot(d, d) * uVignette;
  c *= clamp(vig, 0.0, 1.0);

  // Slowed time: the colour drains towards a cold blue and the corners close
  // in. It is a grade rather than an overlay, so the city keeps its shape and
  // you can still see what is about to hit you.
  if (uSlow > 0.001) {
    float l = luma(c);
    vec3 cold = mix(vec3(l), vec3(l * 0.72, l * 0.86, l * 1.22), 0.65);
    c = mix(c, cold, uSlow * 0.8);
    float edge = 1.0 - dot(d, d) * 2.1 * uSlow;
    c *= clamp(edge, 0.0, 1.0);
    // A faint scan of brightness across the frame, so the still world still
    // has something moving in it.
    c *= 1.0 + uSlow * 0.05 * sin(vUv.y * 140.0);
  }
  fragColour = vec4(linearToSrgb(c), 1.0);
}
`;
