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
  // The helicopter's blades. Its mesh is built with the mast on the origin,
  // so the main rotor turns about the origin; the tail rotor turns about its
  // own hub at the end of the boom, faster, on its side.
  if (aInfo.x > 36.5 && aInfo.x < 37.5) p = rotY(iState.w) * p;
  if (aInfo.x > 37.5 && aInfo.x < 38.5) {
    vec3 hub = vec3(p.x, 2.75, 6.3);
    p = hub + rotX(iState.w * 2.3) * (p - hub);
  }
  // A fighter's wheels: down while the channel says two, folded up into the
  // belly otherwise.
  if (aInfo.x > 43.5 && aInfo.x < 44.5 && iState.w < 1.5) p = vec3(p.x * 0.5, -0.2, p.z);
  // A tank's turret, parts 45 to 47: turned about the turret ring by the
  // angle the instance carries, then drawn as the olive, the gun and the
  // dark metal it is made of.
  vec3 nrm = aNormal;
  float part = aInfo.x;
  if (part > 44.5 && part < 47.5) {
    mat3 t = rotY(iState.w);
    vec3 ring = vec3(0.0, 0.0, 0.3);
    p = ring + t * (p - ring);
    nrm = t * nrm;
    part = part < 45.5 ? 31.0 : (part < 46.5 ? 8.0 : 2.0);
  }
  mat3 body = rotY(-iPosYaw.w) * rotZ(iState.y) * rotX(iState.x);
  vec3 world = body * p + iPosYaw.xyz;
  vWorld = world;
  vNormal = normalize(body * nrm);
  vPart = part;
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
    emissive = vec3(0.25, 0.8, 1.0) * 3.2 * pulse;
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
  } else if (vPart < 23.5) {
    // Bone. Only ever visible on somebody who has been burnt down to it, and
    // the charring above takes it the rest of the way to black.
    albedo = vec3(0.50, 0.47, 0.41);
    rough = 0.72;
    metal = 0.0;
  } else if (vPart < 26.5) {
    // Glass, in a windscreen or a canopy. Dark and sharp, with the sky in it.
    // This runs to 26 rather than to the end of the list because a machine
    // reads its skull and its rifle out of 25 and 26 and everything that is
    // not a machine has always had them as glass.
    albedo = vec3(0.022, 0.030, 0.038);
    rough = 0.06;
    metal = 0.85;
  } else if (vPart < 27.5) {
    // S-Bahn red. The lower half of a Berlin carriage, which has been this
    // colour since the twenties.
    albedo = vec3(0.34, 0.055, 0.045);
    rough = 0.52;
    metal = 0.05;
  } else if (vPart < 28.5) {
    // And the ochre above the waist.
    albedo = vec3(0.56, 0.38, 0.09);
    rough = 0.55;
    metal = 0.05;
  } else if (vPart > 29.5 && vPart < 30.5) {
    // The void cannon's green, in its cell and in the ball it fires. Brighter
    // and slower to pulse than plasma, because there is a lot more of it.
    albedo = vec3(0.02);
    // Kept low in red and blue for the same reason as blast plasma's orange:
    // at nine times over, the tonemapper had it white from across a square.
    float pulse = 0.75 + 0.25 * sin(uCamPos.w * 9.0 + vWorld.y * 2.0);
    float face = abs(dot(n, normalize(uCamPos.xyz - vWorld)));
    emissive = mix(vec3(0.0, 1.7, 0.05), vec3(0.3, 3.0, 0.2), face * face) * pulse;
    rough = 0.1;
    metal = 0.0;
  } else if (vPart > 30.5 && vPart < 31.5) {
    // Olive drab, on the jeep and the tank: flat paint with the dust of the
    // street in it, lighter on top where the sun has had it.
    float v = vnoise(vWorld.xz * 1.7 + vWorld.y) * 0.25;
    albedo = vec3(0.20, 0.215, 0.13) * (0.85 + v + 0.12 * max(n.y, 0.0));
    rough = 0.78;
    metal = 0.08;
  } else if (vPart > 31.5 && vPart < 32.5) {
    // Tyres and track pads: rubber, nearly black, no shine.
    albedo = vec3(0.028, 0.027, 0.026);
    rough = 0.95;
    metal = 0.0;
  } else if (vPart > 32.5 && vPart < 33.5) {
    // The air superiority grey a fighter is painted, with the panel lines.
    float panel = smoothstep(0.0, 0.03, abs(fract(vWorld.z * 0.9) - 0.5));
    albedo = vec3(0.30, 0.32, 0.35) * (0.86 + 0.14 * panel);
    rough = 0.48;
    metal = 0.3;
  } else if (vPart > 33.5 && vPart < 34.5) {
    // Headlights.
    albedo = vec3(0.6);
    emissive = vec3(1.0, 0.93, 0.78) * 2.2;
    rough = 0.2;
  } else if (vPart > 34.5 && vPart < 35.5) {
    // The afterburner: orange in the middle of the nozzle.
    albedo = vec3(0.02);
    float flick = 0.8 + 0.2 * sin(uCamPos.w * 40.0);
    emissive = vec3(1.0, 0.45, 0.12) * 6.0 * flick;
    rough = 0.2;
    metal = 0.0;
  } else if (vPart > 35.5 && vPart < 36.5) {
    // The gunship's dark green.
    float v = vnoise(vWorld.xz * 2.1 + vWorld.y) * 0.2;
    albedo = vec3(0.10, 0.125, 0.095) * (0.9 + v);
    rough = 0.62;
    metal = 0.15;
  } else if (vPart > 36.5 && vPart < 38.5) {
    // Rotor blades.
    albedo = vec3(0.045, 0.047, 0.05);
    rough = 0.55;
    metal = 0.3;
  } else if (vPart > 38.5 && vPart < 39.5) {
    // Wheel hubs and road wheels, a shade lighter than the hull round them.
    albedo = vec3(0.15, 0.155, 0.12);
    rough = 0.6;
    metal = 0.35;
  } else if (vPart > 49.5 && vPart < 62.5) {
    // Mech paint. Ten liveries for yours, one per chassis, then theirs, then
    // the two trims. Flat military paint with a little wear on the edges the
    // light catches.
    int k = int(vPart + 0.5) - 50;
    vec3 c = vec3(0.30, 0.33, 0.37);                     // Warden, steel blue
    if (k == 1) c = vec3(0.34, 0.24, 0.14);              // Bruin, bear brown
    else if (k == 2) c = vec3(0.62, 0.63, 0.62);         // Heron, pale grey
    else if (k == 3) c = vec3(0.55, 0.45, 0.28);         // Lynx, sand
    else if (k == 4) c = vec3(0.24, 0.27, 0.16);         // Bastion, olive
    else if (k == 5) c = vec3(0.10, 0.10, 0.10);         // Hornet, black
    else if (k == 6) c = vec3(0.36, 0.09, 0.07);         // Colossus, oxblood
    else if (k == 7) c = vec3(0.11, 0.30, 0.30);         // Mantis, teal
    else if (k == 8) c = vec3(0.62, 0.30, 0.08);         // Ram, signal orange
    else if (k == 9) c = vec3(0.075, 0.07, 0.095);       // Wraith, dark violet
    else if (k == 10) c = vec3(0.11, 0.115, 0.125);      // theirs: gunmetal
    else if (k == 11) c = vec3(0.70, 0.56, 0.10);        // your trim: yellow
    else if (k == 12) c = vec3(0.55, 0.04, 0.03);        // their trim: red
    float wear = vnoise(vWorld.xz * 2.3 + vWorld.y * 1.7);
    albedo = c * (0.82 + 0.3 * wear);
    rough = k == 9 ? 0.85 : 0.6;
    metal = 0.25;
    if (k == 12) emissive = vec3(0.35, 0.02, 0.01);
  } else if (vPart > 43.5 && vPart < 44.5) {
    // Undercarriage legs and wheels.
    albedo = vec3(0.12, 0.125, 0.13);
    rough = 0.5;
    metal = 0.5;
  } else if (vPart > 47.5 && vPart < 48.5) {
    // Blast plasma: the hard kind, which does not bounce and does ten times
    // the harm, and burns a very bright orange rather than cyan so you know
    // which one is coming down on you.
    albedo = vec3(0.02);
    // The tonemapper turns anything this bright white unless the green and
    // blue stay low, so the colour is carried by the ratio rather than the
    // level: an orange rim and a hotter, yellower heart where it faces you.
    float pulse = 0.85 + 0.15 * sin(uCamPos.w * 30.0 + vWorld.y * 4.0);
    float face = abs(dot(n, normalize(uCamPos.xyz - vWorld)));
    emissive = mix(vec3(3.4, 0.38, 0.0), vec3(5.0, 0.75, 0.0), face * face) * pulse;
    rough = 0.1;
    metal = 0.0;
  } else {
    // Glass, in a windscreen or a canopy. Dark and sharp, with the sky in it.
    albedo = vec3(0.022, 0.030, 0.038);
    rough = 0.06;
    metal = 0.85;
  }

  // Somebody who lives here, in the clothes he left the house in. The cloth
  // and the boots take a colour of their own, four coats picked per person
  // out of the fraction the instance carries, so a pavement with a dozen
  // people on it is not a squad in uniform. Everything else about the figure
  // is the same figure, which is the whole reason they cost one draw call.
  if (vCivil > 0.5 && vPart > 3.5 && vPart < 6.5) {
    float who = fract(vCivil);
    vec3 coat = vec3(0.21, 0.19, 0.17);
    if (who < 0.25) coat = vec3(0.26, 0.11, 0.09);
    else if (who < 0.5) coat = vec3(0.09, 0.14, 0.24);
    else if (who < 0.75) coat = vec3(0.23, 0.21, 0.13);
    albedo = vPart < 4.5 ? coat : coat * 0.4;
    rough = 0.93;
    metal = 0.0;
    emissive = vec3(0.0);
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
  // A machine is the same skeleton in steel: cold, a little shiny along the
  // bones, with one red eye in the skull. Stunned, the eye goes out and the
  // steel picks up the blue of whatever hit it.
  if (vMachine > 0.5) {
    float sheen = pow(clamp(dot(normalize(vNormal), normalize(vec3(0.3, 0.9, 0.2))), 0.0, 1.0), 3.0);
    colour = mix(vec3(0.085, 0.092, 0.105), vec3(0.42, 0.46, 0.52), sheen);
    // The skull, part 23, carries the eye: a red that is bright from the
    // front and still visible from the side, so a machine reads as a machine
    // across a square and not only when it is looking at you. The other two
    // channels are nearly nothing, which is what keeps the tonemapper from
    // turning it white.
    if (vPart > 24.5 && vPart < 25.5) {
      float facing = clamp(-normalize(vNormal).z, 0.0, 1.0);
      colour = mix(colour * 0.5, colour, 0.4);
      colour += vec3(2.4, 0.03, 0.02) * (0.35 + 0.65 * facing) * (1.0 - vStun);
    }
    // The rifle is darker than the frame, and its emitter carries the same
    // red as the eye, so you can see which end of a machine to stand behind.
    if (vPart > 25.5 && vPart < 26.5) colour *= 0.55;
    if (vPart > 26.5) colour += vec3(2.2, 0.05, 0.03) * (1.0 - vStun);
    colour = mix(colour, colour * vec3(0.5, 0.7, 1.4), vStun * 0.8);
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
export const DRONE_FS = bodyFS(
  '#define vCharred 0.0\n#define vMachine 0.0\n#define vStun 0.0\n#define vCivil 0.0');
export const SOLDIER_FS = bodyFS(
  'flat in float vCharred;\nflat in float vMachine;\nflat in float vStun;\nflat in float vCivil;');

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
layout(location = 7) in vec4 iExtra;    // x charred 0..1, y machine, z stunned,
                                        // w nought for a soldier, one plus
                                        // which coat he has on for somebody
                                        // who lives here

out vec3 vWorld;
out vec3 vNormal;
flat out float vPart;
flat out float vFlash;
flat out float vCharred;
flat out float vMachine;
flat out float vStun;
flat out float vCivil;
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
  vMachine = iExtra.y;
  vStun = iExtra.z;
  vCivil = iExtra.w;

  // Burnt to the bone. The cloth, the webbing and the helmet shrink into
  // nothing and the skeleton inside them comes out. Both sets of parts are in
  // the one mesh and one of them is always collapsed to a point, which costs
  // a few dozen triangles and no draw calls at all.
  bool bone = aInfo.x > 22.5;
  float keep = bone ? charred : 1.0 - charred;
  // Parts 26 and 27 are the beam rifle, and only a machine carries one. A
  // soldier burnt to the skeleton by the ion cannon is still a dead man, not
  // a machine, and does not stand there holding a gun he never had.
  if (aInfo.x > 25.5) keep = iExtra.y;
  // Somebody on his way to work carries no rifle and wears no helmet. Both
  // shrink into the figure the same way the cloth does on a man who burns,
  // which costs nothing: the parts are in the mesh either way.
  if (iExtra.w > 0.5 && (aInfo.x > 4.5 && aInfo.x < 5.5)) keep = 0.0;
  if (iExtra.w > 0.5 && (aInfo.x > 6.5 && aInfo.x < 7.5)) keep = 0.0;
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

// A mech. The transform is the point of this shader: the legs swing about the
// hips and the torso turns and pitches about the same line, so the thing can
// walk one way and shoot another. Everything else, the materials and the fog
// and the shadows, is the shared body shader.
export const MECH_VS = `${VERSION}
precision highp float;
${CAMERA_BLOCK}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aInfo;     // x part id
layout(location = 5) in vec4 iPosYaw;   // xyz feet position, w leg yaw
layout(location = 6) in vec4 iState;    // x stride, y torso yaw, z hit flash, w torso pitch
layout(location = 7) in vec4 iExtra;    // x mine, y dying, z boost

out vec3 vWorld;
out vec3 vNormal;
flat out float vPart;
flat out float vFlash;
out float vViewDist;

// Where the legs stop, whether there are two or four of them, and for four
// how far fore and aft of the middle their roots are. The chassis' own, set
// for each chassis' draw.
uniform float uHip;
uniform float uGait;
uniform float uHipZ;

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
  float stride = iState.x;
  float swing = sin(stride) * 0.38;

  if (p.y < uHip) {
    // A leg. The two of them are in opposition, and the lower half of each
    // swings a little further than the upper, which is enough of a knee.
    // With four, the diagonals go together, the way a dog walks, and each
    // leg swings about its own root rather than about the middle.
    float side = p.x < 0.0 ? 1.0 : -1.0;
    if (uGait > 0.5) side *= p.z < 0.0 ? 1.0 : -1.0;
    vec3 hip = vec3(p.x, uHip, uGait > 0.5 ? sign(p.z) * uHipZ : 0.0);
    float amount = swing * side * (p.y < uHip * 0.62 ? 1.25 : 1.0);
    mat3 r = rotX(amount);
    p = hip + r * (p - hip);
    n = r * n;
  } else {
    // The torso, which is where the guns are. It turns relative to the legs
    // and it pitches, and both happen about the hip line so that nothing
    // tears at the waist.
    vec3 base = vec3(0.0, uHip, 0.0);
    mat3 t = rotY(iState.y) * rotX(iState.w);
    p = base + t * (p - base);
    n = t * n;
  }

  // The body rises and falls twice a stride, which is most of what makes a
  // walk read as weight.
  p.y += sin(stride * 2.0) * 0.14;

  // Going over, once it is dead.
  float down = clamp(iExtra.y, 0.0, 1.0);
  mat3 fall = rotZ(down * 0.35) * rotX(-down * 1.35);
  p = fall * p;
  n = fall * n;

  mat3 body = rotY(-iPosYaw.w);
  vec3 world = body * p + iPosYaw.xyz;
  vWorld = world;
  vNormal = normalize(body * n);
  // The eye and the reactor are part 1, the red core material. Yours burns
  // blue instead, which is part 11, and that is the only thing that tells the
  // two apart at a distance.
  vPart = (aInfo.x < 1.5 && aInfo.x > 0.5 && iExtra.x > 0.5) ? 11.0 : aInfo.x;
  // Theirs are all in one livery, whichever chassis it is: gunmetal where
  // yours carries its own colour, and red where yours has its trim.
  if (iExtra.x < 0.5 && aInfo.x > 49.5 && aInfo.x < 59.5) vPart = 60.0;
  if (iExtra.x < 0.5 && aInfo.x > 60.5 && aInfo.x < 61.5) vPart = 62.0;
  vFlash = iState.z;
  vViewDist = length(world - uCamPos.xyz);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const DRONE_SHADOW_VS = `${VERSION}
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec2 aInfo;
layout(location = 5) in vec4 iPosYaw;
layout(location = 6) in vec4 iState;
uniform mat4 uLightViewProj;
void main() {
  vec3 p = aPos;
  // A tank's turret casts its shadow where it is pointing.
  if (aInfo.x > 44.5 && aInfo.x < 47.5) {
    float tc = cos(iState.w), ts = sin(iState.w);
    vec3 ring = vec3(0.0, 0.0, 0.3);
    p = ring + mat3(tc, 0.0, -ts, 0.0, 1.0, 0.0, ts, 0.0, tc) * (p - ring);
  }
  float c = cos(-iPosYaw.w), s = sin(-iPosYaw.w);
  mat3 rot = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  gl_Position = uLightViewProj * vec4(rot * p + iPosYaw.xyz, 1.0);
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
  } else if (vPart > 29.5 && vPart < 30.5) {
    // The void cannon's rings and cell: the same green the ball is, pulsing
    // slowly, and brighter for a moment after it fires.
    albedo = vec3(0.02);
    float pulse = 0.75 + 0.25 * sin(uCamPos.w * 5.0 + vModel.z * 30.0);
    emissive = vec3(0.30, 1.0, 0.25) * (1.6 + uMuzzle * 3.0) * pulse;
    rough = 0.2;
    metal = 0.0;
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
