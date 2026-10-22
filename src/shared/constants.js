// Shared between the offline pipeline and the runtime. Keep the two in step by
// importing this file from both, never by copying numbers.

export const TILE_SIZE = 100;          // metres
export const VERTEX_STRIDE = 20;       // bytes, see docs/PLAN.md 2.1
export const POS_SCALE = 64;           // int16 units per metre
export const UV_SCALE = 32;            // uint16 units per metre
export const HEIGHT_SCALE = 16;        // uint16 units per metre
export const COLLISION_GRID = 33;      // height field samples per tile edge
export const GROUND_SCALE = 256;       // int16 units per metre in the height field
// How far above the collision height field anything laid flat on the street
// has to sit to be seen. The street that is drawn is not the height field that
// is collided against: pavements are laid 0.12 m proud of it, plazas and grass
// 0.05. Anything lower than this disappears under whichever surface it landed
// on. Used by the pickup pads and by the stains on the pavement.
export const SURFACE_CLEARANCE = 0.14;

export const MAT = {
  FACADE: 0,
  ROOF: 1,
  ASPHALT: 2,
  COBBLE: 3,
  PAVEMENT: 4,
  GRASS: 5,
  WATER: 6,
  CONCRETE: 7,
  SANDSTONE: 8,
  COPPER: 9,
  GLASS: 10,
  BRICK: 11,
  GRAVEL: 12,
  METAL: 13,
  MARKING: 14,
  STELE: 15,      // the memorial concrete, deliberately darker than the rest
  GOLD: 16,       // gilded bronze: the Victoria, and the rings on her column
};

export const MATERIAL_NAMES = Object.keys(MAT);

// Surface ids carried by the collision layer, used to pick a footstep sound.
export const SURFACE = {
  ASPHALT: 0,
  COBBLE: 1,
  GRASS: 2,
  WATER: 3,
  GRAVEL: 4,
  STONE: 5,
};

export const FACADE_FLAG = {
  // The bottom band of a wall, where the shop windows are.
  GROUND_FLOOR: 1,
  LANDMARK: 2,
  ROOF_SLOPE: 4,
  NO_WINDOWS: 8,
  // This vertex is the ground: a street, a pavement, a park, a square, the
  // water, a railway bed. The collapse code moves these into craters and
  // leaves the walls to be cut instead, so it has to be able to tell them
  // apart. It used to read GROUND_FLOOR for this, which is the bottom of a
  // building and not the ground at all, so no crater was ever drawn in a
  // street while the collision had a ten metre hole in it. That is what made
  // you fall through a road that looked solid.
  GROUND: 16,
  // Baked rubble: a wall that came down and has been written into the tile
  // buffers for good, so the fragment shader keeps treating it as rubble long
  // after the collapse that made it has given up its uniform slot.
  RUBBLE: 32,
  // The fallback plane that fills whatever the rest of the city did not draw.
  // It lies nine centimetres under everything, and nine centimetres is less
  // than a twenty four bit depth buffer can tell apart past about six hundred
  // metres, so out there it used to swap places with the road on top of it
  // and shimmer. The vertex shader sinks anything carrying this flag further
  // the further away it is, by about what the depth buffer loses, and a plane
  // nobody can see is a plane that can go as deep as it likes.
  BASE: 64,
};

export const SPAWN = {
  lat: 52.51625,
  lon: 13.37940,
  yaw: Math.PI / 2,      // facing west, towards the Gate
  eyeHeight: 1.7,
};

export const PLAYER = {
  radius: 0.35,
  height: 1.8,
  eye: 1.7,
  // Not a walk in the street's sense (that is about 1.25 m/s): the pace a
  // shooter moves at without the run key, which there is nearer five. This
  // is a brisk jog, and it stays under the 4 m/s a guard counts as running.
  walkSpeed: 3.5,
  runSpeed: 5.6,
  jumpSpeed: 5.2,
  gravity: 22.0,
  stepUp: 0.4,
  // How fast you go down with ground that is sinking under you. A crater
  // opening where you are standing used to leave you hanging over it and then
  // dropping; this is the speed you ride it down at instead. It is below free
  // fall on purpose: you are going down with the street, not falling off it.
  rideDown: 9.0,
};
