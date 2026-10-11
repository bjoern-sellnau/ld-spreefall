// Shared between the offline pipeline and the runtime. Keep the two in step by
// importing this file from both, never by copying numbers.

export const TILE_SIZE = 100;          // metres
export const VERTEX_STRIDE = 20;       // bytes, see docs/PLAN.md 2.1
export const POS_SCALE = 64;           // int16 units per metre
export const UV_SCALE = 32;            // uint16 units per metre
export const HEIGHT_SCALE = 16;        // uint16 units per metre
export const COLLISION_GRID = 33;      // height field samples per tile edge
export const GROUND_SCALE = 256;       // int16 units per metre in the height field

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
  GROUND_FLOOR: 1,
  LANDMARK: 2,
  ROOF_SLOPE: 4,
  NO_WINDOWS: 8,
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
  walkSpeed: 2.6,
  runSpeed: 5.6,
  jumpSpeed: 5.2,
  gravity: 22.0,
  stepUp: 0.4,
};
