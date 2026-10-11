import { VERSION, CAMERA_BLOCK, SKY, NOISE } from './common.js';

export const SKY_VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
out vec3 vRay;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vec2 ndc = p * 2.0 - 1.0;
  vec4 far = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec4 near = uInvViewProj * vec4(ndc, -1.0, 1.0);
  vRay = far.xyz / far.w - near.xyz / near.w;
  // Sit exactly on the far plane so the sky never covers anything.
  gl_Position = vec4(ndc, 1.0, 1.0);
}
`;

export const SKY_FS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
${NOISE}
${SKY}
in vec3 vRay;
layout(location = 0) out vec4 fragColour;

void main() {
  vec3 dir = normalize(vRay);
  vec3 col = skyColour(dir, uSunDir.xyz, uSkyZenith.rgb, uSkyHorizon.rgb, uSkyZenith.w);

  // Stars, only once the sun is well down.
  float night = uSkyZenith.w;
  if (night > 0.02 && dir.y > -0.02) {
    vec2 sp = dir.xz / max(dir.y + 0.35, 0.05) * 42.0;
    vec3 c = cells(sp);
    float star = smoothstep(0.055, 0.0, c.x) * step(0.86, c.z);
    float twinkle = 0.6 + 0.4 * sin(uCamPos.w * 2.7 + c.z * 43.0);
    col += vec3(0.85, 0.9, 1.0) * star * twinkle * night * 1.4 * smoothstep(-0.02, 0.18, dir.y);
  }

  // Thin high cloud, drifting. Enough to break up an empty sky.
  float cl = fbm(dir.xz / max(dir.y + 0.22, 0.06) * 0.55 + vec2(uCamPos.w * 0.0035, 0.0));
  float cover = smoothstep(0.56, 0.86, cl) * smoothstep(0.0, 0.16, dir.y);
  vec3 cloudLit = mix(uSkyHorizon.rgb, vec3(1.0, 0.96, 0.92) * (0.35 + uSunColour.r * 0.5), 0.55);
  col = mix(col, cloudLit, cover * 0.42 * (1.0 - night * 0.7));

  fragColour = vec4(col, 1.0);
}
`;
