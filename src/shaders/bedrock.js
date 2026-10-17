import { VERSION, CAMERA_BLOCK, FOG } from './common.js';

/**
 * The floor of last resort.
 *
 * One quad, a dozen metres under the lowest ground in the district, drawn
 * before the city. Nothing should ever see it: the streets, the parks and the
 * water are all above it and they cover it completely. What it is for is the
 * times when they do not. A gap in the ground mesh, a tile that has not
 * arrived yet, the void past the edge of a district, a hole left by something
 * that came down: all of those used to show the sky, which from inside a city
 * reads as a white hole in the world and flickers as you walk past it. Now
 * they show dark ground a long way down, which reads as a pit, and a pit in a
 * city that has been shelled is not a bug.
 *
 * It costs two triangles and no buffers: the corners come out of the vertex
 * id and a uniform, and the fog is the same fog everything else uses, so the
 * thing sits in the same weather as the city above it.
 */
export const BEDROCK_VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
uniform vec4 uBedBox;    // minX, minZ, maxX, maxZ
uniform float uBedY;
out vec3 vWorld;
void main() {
  int order[6] = int[6](0, 1, 2, 0, 2, 3);
  int k = order[gl_VertexID];
  float x = (k == 0 || k == 3) ? uBedBox.x : uBedBox.z;
  float z = (k == 0 || k == 1) ? uBedBox.y : uBedBox.w;
  vWorld = vec3(x, uBedY, z);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}
`;

export const BEDROCK_FS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
${FOG}
in vec3 vWorld;
layout(location = 0) out vec4 fragColour;
void main() {
  // Dark, and in the same light as everything else: a tenth of the horizon
  // plus a trace of sun. At night it is nearly black, by day it is the colour
  // of a cellar.
  vec3 col = uSkyHorizon.rgb * 0.10 + uSunColour.rgb * 0.02;
  fragColour = vec4(applyFog(col, vWorld, uCamPos.xyz, uSunDir.xyz,
    uSkyHorizon.rgb, uSkyZenith.rgb, uFog, uSkyZenith.w), 1.0);
}
`;
