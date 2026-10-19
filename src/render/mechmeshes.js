// The ten mechs, as shapes.
//
// One builder per chassis in `src/game/chassis.js`, each handed an empty mesh
// and the chassis row, and each built nose towards -z with its feet on y = 0,
// the same as everything else here. The guns are put where the row says the
// muzzles are, so the shot leaves the barrel you can see.
//
// Two rules the mech shader reads off the geometry rather than off a part id:
// everything under the chassis' hip line is a leg, and which leg is decided
// by which side of the middle it is on (fore and aft as well, for the one with
// four). So nothing of a leg may cross the middle, and nothing of the torso
// may hang below the hips.
//
// Parts: P the chassis' own paint (50 to 59), A the trim (61), 2 joints and
// frame, 12 the feet, 7 gun metal, 8 ordnance, 24 canopy glass, 1 the eye and
// the reactor, 35 a jet nozzle. On one of theirs the shader swaps the paint
// for gunmetal and the trim for red.

const D = 2, FOOT = 12, GUN = 7, ORD = 8, GLASS = 24, EYE = 1, A = 61, JET = 35;
const paint = (c) => 50 + c.paint;

/** Four barrels in a square, ending at the muzzle, with the block behind. */
function chaingun(m, at, block = 2.2, size = 0.9) {
  const [x, y, z] = at;
  const back = z + 1.0 + block / 2;
  m.box(x, y, back, size, size * 1.05, block, GUN);
  for (const dx of [-0.22, 0.22]) {
    for (const dy of [-0.2, 0.2]) m.box(x + dx * size / 0.9, y + dy * size / 0.9, z + 0.7, 0.16, 0.16, 1.4, GUN);
  }
}

/** A block of tubes whose faces are at the muzzle. */
function pod(m, at, cols, rows, P, depth = 1.8) {
  const [x, y, z] = at;
  const w = cols * 0.38 + 0.3, h = rows * 0.38 + 0.25;
  m.box(x, y, z + depth / 2 + 0.05, w, h, depth, P);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      m.box(x + (i - (cols - 1) / 2) * 0.38, y + (j - (rows - 1) / 2) * 0.38, z + 0.1, 0.26, 0.26, 0.3, ORD);
    }
  }
}

/** A straight leg: foot, ankle, shin, knee, thigh, between the ground and the hip. */
function leg(m, x, hip, P, w = 1.0) {
  const k = hip / 4.2;
  m.box(x, 0.35, -0.25 * k, 1.45 * w, 0.7, 3.0 * k, FOOT);
  m.box(x, 1.05 * k, 0.1, 0.95 * w, 0.8 * k, 1.1 * w, D);
  m.box(x, 2.1 * k, 0, 1.15 * w, 1.7 * k, 1.25 * w, P);
  m.box(x, 3.0 * k, -0.05, 1.0 * w, 0.55 * k, 1.05 * w, D);
  // The thigh stops just under the hip line, so none of it turns with the
  // torso.
  const top = hip - 0.02, bottom = 3.27 * k;
  m.box(x, (top + bottom) / 2, 0.05, 1.35 * w, top - bottom, 1.45 * w, P);
}

/** A reverse jointed leg: the knee goes back and the foot has toes. */
function raptorLeg(m, x, hip, P, w = 1.0) {
  const s = hip / 3.6;
  // Thigh, forward and down from the hip.
  m.plate([[x - 0.35 * w, hip - 0.4, -0.2], [x + 0.35 * w, hip - 0.4, -0.2],
    [x + 0.35 * w, 2.2 * s, -0.75 * s], [x - 0.35 * w, 2.2 * s, -0.75 * s]], 0.7 * w, P);
  m.box(x, 2.2 * s, -0.7 * s, 0.75 * w, 0.55, 0.55, D);           // knee
  // Shin, back and down to the heel.
  m.plate([[x - 0.25 * w, 2.2 * s, -0.7 * s], [x + 0.25 * w, 2.2 * s, -0.7 * s],
    [x + 0.25 * w, 0.75, 0.55 * s], [x - 0.25 * w, 0.75, 0.55 * s]], 0.5 * w, P);
  m.box(x, 0.75, 0.55 * s, 0.6 * w, 0.45, 0.45, D);               // heel joint
  // Foot: a short pad and three toes forward.
  m.box(x, 0.25, 0.25 * s, 0.9 * w, 0.5, 1.0, FOOT);
  for (const dx of [-0.32, 0, 0.32]) m.box(x + dx * w, 0.18, -0.65 * s, 0.22 * w, 0.32, 1.3, FOOT);
  m.box(x, 0.2, 1.0 * s, 0.24 * w, 0.3, 0.7, FOOT);                // the spur behind
}

export const MECH_BUILDERS = {
  // The one the game always had, in its own paint now rather than in a
  // drone's black, with a trim stripe down the chest.
  warden(m, c) {
    const P = paint(c);
    for (const side of [-1, 1]) leg(m, side * 1.25, c.hip, P);
    m.box(0, c.hip + 0.45, 0, 3.10, 0.9, 1.95, P);
    m.box(0, 4.85, 0, 1.60, 0.55, 1.30, D);
    m.box(0, 5.75, 0.05, 3.00, 1.60, 2.10, P);
    m.box(0, 6.45, 0.35, 2.30, 0.70, 1.60, P);
    m.box(0, 5.70, -1.12, 2.00, 1.00, 0.22, GLASS);
    m.box(0, 6.25, -0.95, 0.70, 0.26, 0.26, EYE);
    m.box(0, 5.05, 0.95, 1.10, 0.90, 0.50, EYE);
    for (const side of [-1, 1]) {
      m.box(side * 1.85, 6.05, 0.05, 0.95, 1.10, 1.60, D);
      m.box(side * 1.2, 6.62, -0.2, 0.18, 0.06, 1.7, A);
    }
    chaingun(m, c.muzzle.chaingun);
    pod(m, c.muzzle.rockets, 3, 2, P);
  },

  // Low, broad and heavy: thick legs set wide, a hunched chest twice the
  // width of its head, and two enormous forearms, a shotgun fist on the right
  // and a rocket box on the left.
  bruin(m, c) {
    const P = paint(c);
    for (const side of [-1, 1]) {
      const x = side * 1.55;
      m.box(x, 0.4, -0.2, 1.9, 0.8, 2.8, FOOT);
      m.box(x, 1.3, 0.05, 1.5, 1.2, 1.6, P);
      m.box(x, 2.2, 0, 1.1, 0.6, 1.2, D);
      m.box(x, 2.85, 0.05, 1.7, 1.05, 1.8, P);
    }
    m.box(0, c.hip + 0.4, 0.1, 3.6, 0.8, 2.2, D);             // pelvis
    m.box(0, 4.85, 0.25, 4.2, 1.5, 2.8, P);                   // chest
    m.box(0, 5.75, 0.6, 3.2, 0.6, 2.0, P);                    // hump
    m.box(0, 5.2, -1.3, 1.3, 0.75, 0.7, P);                   // the head, sunk low
    m.box(0, 5.25, -1.67, 1.0, 0.32, 0.06, GLASS);
    m.box(0, 5.5, -1.62, 0.5, 0.12, 0.14, EYE);
    m.box(0, 4.6, 1.75, 1.4, 1.0, 0.5, EYE);                  // reactor
    m.box(0, 4.05, -1.15, 3.2, 0.12, 0.08, A);
    for (const side of [-1, 1]) {
      m.box(side * 2.6, 5.35, 0.1, 1.3, 1.3, 1.9, D);         // shoulder
      m.box(side * 2.75, 4.6, -1.1, 1.5, 1.3, 2.6, P);        // forearm
    }
    // The shotgun fist: a short fat drum of six barrels.
    const [gx, gy, gz] = c.muzzle.chaingun;
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      m.cylinder(gx + Math.cos(a) * 0.32, gy + Math.sin(a) * 0.32, gz + 0.45, 0.12, 0.12, -0.45, 8, GUN, 'z');
    }
    m.cylinder(gx, gy, gz + 0.9, 0.55, 0.55, -0.45, 12, GUN, 'z');
    pod(m, c.muzzle.rockets, 3, 2, P, 1.2);
  },

  // Tall and thin, on long legs, with its head well up and a railgun laid
  // along its right shoulder half again as long as its body is deep.
  heron(m, c) {
    const P = paint(c);
    const h = c.hip;
    for (const side of [-1, 1]) {
      const x = side * 1.0;
      m.box(x, 0.3, -0.3, 1.1, 0.6, 2.6, FOOT);
      m.box(x, 0.95, 0.05, 0.6, 0.7, 0.6, D);
      m.box(x, 2.2, 0.05, 0.7, 1.9, 0.8, P);                  // shin
      m.box(x, 3.3, 0, 0.75, 0.4, 0.75, D);                   // knee
      m.box(x, 4.5, 0.05, 0.85, 2.0, 0.95, P);                // thigh
    }
    m.box(0, h + 0.3, 0, 2.6, 0.6, 1.2, D);                   // hips
    m.box(0, h + 1.0, 0.1, 1.0, 0.8, 0.9, D);                 // waist
    m.box(0, h + 2.1, 0.1, 2.2, 1.5, 1.6, P);                 // chest
    m.box(0, h + 2.95, -0.25, 1.0, 0.6, 1.0, P);              // head
    m.box(0, h + 2.98, -0.78, 0.8, 0.3, 0.06, GLASS);
    m.box(0, h + 3.12, -0.76, 0.3, 0.1, 0.1, EYE);
    m.box(0, h + 1.8, 0.95, 0.8, 0.7, 0.3, EYE);
    m.box(0, h + 2.86, 0.4, 0.06, 1.2, 0.06, D);              // aerial
    for (const side of [-1, 1]) m.box(side * 1.35, h + 2.35, 0.1, 0.6, 0.6, 1.0, D);
    // The rail: a long slab with its coils, from behind the shoulder to the
    // muzzle five metres out in front.
    const [rx, ry, rz] = c.muzzle.chaingun;
    m.box(rx, ry - 0.05, rz + 3.1, 0.42, 0.52, 6.2, GUN);
    for (let i = 0; i < 5; i++) m.box(rx, ry - 0.05, rz + 1.0 + i * 0.9, 0.56, 0.62, 0.22, A);
    m.box(rx, ry - 0.35, rz + 5.6, 0.7, 0.7, 1.2, P);         // the breech
    pod(m, c.muzzle.rockets, 2, 2, P, 1.2);
  },

  // A raptor: reverse knees, a wedge of a body with the cockpit forward, two
  // light guns under the chin and a small pod on its back.
  lynx(m, c) {
    const P = paint(c);
    for (const side of [-1, 1]) raptorLeg(m, side * 0.95, c.hip, P, 1.0);
    m.box(0, c.hip + 0.27, 0.2, 2.4, 0.5, 1.4, D);            // hips
    // The body: a wedge, deep at the back and sharp at the front.
    m.box(0, c.hip + 0.75, 0.25, 2.1, 0.9, 2.0, P);
    m.plate([[-0.95, c.hip + 1.2, -0.75], [0.95, c.hip + 1.2, -0.75],
      [0.7, c.hip + 0.45, -2.0], [-0.7, c.hip + 0.45, -2.0]], 0.3, P);
    m.plate([[-0.75, c.hip + 1.24, -0.7], [0.75, c.hip + 1.24, -0.7],
      [0.55, c.hip + 0.62, -1.75], [-0.55, c.hip + 0.62, -1.75]], 0.06, GLASS);
    m.box(0, c.hip + 0.5, -1.95, 0.5, 0.14, 0.14, EYE);
    m.box(0, c.hip + 0.8, 1.35, 0.9, 0.5, 0.3, EYE);
    m.box(0, c.hip + 1.25, 0.6, 1.6, 0.1, 0.9, A);
    // Two light guns under the chin.
    for (const side of [-1, 1]) {
      const [gx, gy, gz] = c.muzzle.chaingun;
      const x = side * Math.abs(gx);
      m.box(x, gy, gz + 1.0, 0.36, 0.36, 1.2, GUN);
      m.cylinder(x, gy, gz + 0.4, 0.08, 0.08, -0.4, 8, GUN, 'z');
    }
    pod(m, c.muzzle.rockets, 2, 1, P, 1.0);
  },

  // A walking fortress: squat legs, a slab of a body, and two shields as big
  // as doors hung off its shoulders, angled out, with a long cannon between
  // them and a launcher box on its back.
  bastion(m, c) {
    const P = paint(c);
    for (const side of [-1, 1]) leg(m, side * 1.5, c.hip, P, 1.3);
    m.box(0, c.hip + 0.45, 0, 3.6, 0.9, 2.2, D);
    m.box(0, c.hip + 1.65, 0.1, 3.4, 1.6, 2.6, P);
    m.box(0, c.hip + 2.65, 0.25, 2.6, 0.5, 2.0, P);
    m.box(0, c.hip + 1.95, -1.36, 1.6, 0.5, 0.12, GLASS);
    m.box(0, c.hip + 2.35, -1.3, 0.6, 0.16, 0.14, EYE);
    m.box(0, c.hip + 1.2, 1.45, 1.2, 0.8, 0.4, EYE);
    for (const side of [-1, 1]) {
      m.box(side * 2.05, c.hip + 2.0, 0.1, 0.9, 1.1, 1.6, D);
      // The shield: a tall plate, toed out from the front.
      m.box(side * 2.75, c.hip + 1.85, -0.25, 0.24, 3.4, 2.6, P, side * 0.32);
      m.box(side * 2.9, c.hip + 1.85, -0.3, 0.06, 2.8, 0.3, A, side * 0.32);
    }
    const [gx, gy, gz] = c.muzzle.chaingun;
    m.box(gx, gy, gz + 2.3, 0.9, 0.9, 1.6, GUN);
    m.cylinder(gx, gy, gz + 1.6, 0.2, 0.2, -1.6, 12, GUN, 'z');
    m.cylinder(gx, gy, gz + 0.25, 0.28, 0.28, -0.25, 12, GUN, 'z');
    // The launcher on its back, firing over its own head.
    const [rx, ry, rz] = c.muzzle.rockets;
    m.box(rx, ry - 0.5, rz + 0.8, 1.6, 1.0, 1.8, P);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) m.box(rx + (i - 1) * 0.45, ry, rz + 0.3 + j * 0.6, 0.32, 0.12, 0.32, ORD);
    }
  },

  // A missile boat: a lean body carrying two racks of tubes on its shoulders,
  // a jump pack with two burning nozzles on its back, and a light gun under
  // the right arm.
  hornet(m, c) {
    const P = paint(c);
    for (const side of [-1, 1]) leg(m, side * 1.1, c.hip, P, 0.85);
    m.box(0, c.hip + 0.37, 0, 2.6, 0.7, 1.5, D);
    m.box(0, c.hip + 1.25, 0.05, 2.2, 1.3, 1.8, P);
    m.box(0, c.hip + 2.15, -0.25, 1.1, 0.6, 1.0, P);
    m.box(0, c.hip + 2.15, -0.78, 0.9, 0.34, 0.06, GLASS);
    m.box(0, c.hip + 2.4, -0.75, 0.4, 0.1, 0.1, EYE);
    // Black and yellow bands round the chest, which is what a hornet is.
    for (let i = 0; i < 3; i++) m.box(0, c.hip + 0.8 + i * 0.4, 0.05, 2.25, 0.12, 1.85, A);
    // The jump pack.
    m.box(0, c.hip + 1.5, 1.25, 1.8, 1.4, 0.8, D);
    for (const side of [-1, 1]) {
      m.cylinder(side * 0.5, c.hip + 0.9, 1.4, 0.32, 0.4, -0.6, 10, D, 'y');
      m.cylinder(side * 0.5, c.hip + 0.32, 1.4, 0.3, 0.3, 0.04, 10, JET, 'y');
    }
    // A rack on each shoulder, ten tubes a side: the pod at the muzzle and
    // its twin on the other shoulder.
    const [rx, ry, rz] = c.muzzle.rockets;
    pod(m, [rx, ry, rz], 5, 2, P, 1.6);
    pod(m, [-rx, ry, rz], 5, 2, P, 1.6);
    for (const side of [-1, 1]) m.box(side * 1.5, c.hip + 2.1, 0.0, 0.7, 0.7, 0.8, D);
    const [gx, gy, gz] = c.muzzle.chaingun;
    m.box(gx, gy + 0.5, gz + 2.0, 0.6, 1.6, 0.8, P);          // the arm
    chaingun(m, [gx, gy, gz], 1.4, 0.6);
  },

  // Eleven metres. Everything about it is the Warden scaled up and made
  // heavier: a head with a visor, a twin barrelled cannon for an arm, a
  // triple pod, and two stacks on its back.
  colossus(m, c) {
    const P = paint(c);
    for (const side of [-1, 1]) leg(m, side * 1.8, c.hip, P, 1.5);
    m.box(0, c.hip + 0.6, 0, 4.4, 1.2, 2.8, D);
    m.box(0, c.hip + 2.2, 0.1, 4.6, 2.4, 3.2, P);
    m.box(0, c.hip + 3.75, 0.4, 3.4, 0.9, 2.4, P);
    m.box(0, c.hip + 3.7, -1.35, 1.6, 1.1, 1.3, P);           // head
    m.box(0, c.hip + 3.75, -2.02, 1.3, 0.38, 0.06, GLASS);
    m.box(0, c.hip + 3.95, -1.98, 0.6, 0.14, 0.12, EYE);
    m.box(0, c.hip + 1.8, 1.75, 1.8, 1.4, 0.4, EYE);
    m.box(0, c.hip + 1.15, -1.62, 3.6, 0.16, 0.08, A);
    for (const side of [-1, 1]) {
      m.box(side * 2.85, c.hip + 2.9, 0.1, 1.4, 1.6, 2.4, D);
      m.cylinder(side * 1.1, c.hip + 4.2, 1.2, 0.3, 0.3, 1.8, 10, D, 'y');   // stacks
    }
    const [gx, gy, gz] = c.muzzle.chaingun;
    m.box(gx, gy, gz + 3.2, 1.5, 1.5, 3.0, P);
    for (const dx of [-0.32, 0.32]) {
      m.cylinder(gx + dx, gy, gz + 1.7, 0.24, 0.24, -1.7, 12, GUN, 'z');
    }
    pod(m, c.muzzle.rockets, 3, 3, P, 2.4);
  },

  // A spider: four legs from the corners of a low hull, each going out and
  // up to a knee and then down to a foot, with a turret on top that carries
  // a gun and a pod.
  mantis(m, c) {
    const P = paint(c);
    const h = c.hip;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const rx = sx * 1.3, rz = sz * c.hipZ;
        const kx = sx * 2.9, kz = sz * 2.3, ky = h - 0.5;
        const fx = sx * 3.4, fz = sz * 2.9;
        m.box(rx, h - 0.25, rz, 0.9, 0.45, 0.9, D);           // the root
        m.plate([[rx, h - 0.35, rz - 0.25 * sz], [rx, h - 0.35, rz + 0.25 * sz],
          [kx, ky, kz + 0.25 * sz], [kx, ky, kz - 0.25 * sz]], 0.5, P);
        m.box(kx, ky, kz, 0.6, 0.6, 0.6, D);                  // knee
        m.plate([[kx - 0.2 * sx, ky, kz], [kx + 0.2 * sx, ky, kz],
          [fx + 0.15 * sx, 0.45, fz], [fx - 0.15 * sx, 0.45, fz]], 0.45, P);
        m.box(fx, 0.22, fz, 0.8, 0.44, 0.8, FOOT);
      }
    }
    m.box(0, h + 0.27, 0, 3.0, 0.5, 3.0, D);                  // the hull
    m.box(0, h + 0.75, 0, 2.6, 0.6, 2.8, P);
    m.box(0, h + 0.75, -1.45, 2.0, 0.4, 0.1, A);
    m.box(0, h + 1.2, -0.1, 1.6, 0.5, 1.6, P);                // turret
    m.plate([[-0.6, h + 1.3, -0.95], [0.6, h + 1.3, -0.95], [0.5, h + 1.0, -1.35], [-0.5, h + 1.0, -1.35]], 0.06, GLASS);
    m.box(0, h + 1.15, -1.32, 0.3, 0.1, 0.1, EYE);
    m.box(0, h + 0.8, 1.45, 0.8, 0.4, 0.2, EYE);
    chaingun(m, c.muzzle.chaingun, 1.6, 0.6);
    pod(m, c.muzzle.rockets, 2, 2, P, 1.0);
  },

  // A chicken walker: reverse legs under a big angular head that is the
  // whole of its body, guns under the chin, pods on its cheeks, and a ram
  // plate across its brow for when it charges.
  ram(m, c) {
    const P = paint(c);
    for (const side of [-1, 1]) raptorLeg(m, side * 0.9, c.hip, P, 1.15);
    m.box(0, c.hip + 0.27, 0.2, 2.2, 0.5, 1.2, D);
    m.box(0, c.hip + 1.0, 0.0, 2.4, 1.3, 2.6, P);             // the head
    m.plate([[-1.2, c.hip + 1.65, -1.3], [1.2, c.hip + 1.65, -1.3],
      [0.9, c.hip + 0.4, -2.35], [-0.9, c.hip + 0.4, -2.35]], 0.35, P);
    m.box(0, c.hip + 1.75, -1.45, 2.6, 0.3, 0.5, A);          // the ram
    m.box(0, c.hip + 1.15, -2.0, 1.4, 0.3, 0.06, GLASS, 0);
    m.box(0, c.hip + 0.85, -2.25, 0.5, 0.12, 0.12, EYE);
    m.box(0, c.hip + 1.0, 1.4, 1.0, 0.7, 0.3, EYE);
    const [gx, gy, gz] = c.muzzle.chaingun;
    for (const side of [-1, 1]) {
      m.box(side * Math.abs(gx), gy, gz + 0.9, 0.4, 0.4, 1.0, GUN);
      m.cylinder(side * Math.abs(gx), gy, gz + 0.4, 0.1, 0.1, -0.4, 8, GUN, 'z');
    }
    pod(m, c.muzzle.rockets, 2, 2, P, 1.4);
    const [rx, ry, rz] = c.muzzle.rockets;
    pod(m, [-rx, ry, rz], 2, 2, P, 1.4);
  },

  // Faceted and dark, for a radar that is not looking for it: a body of
  // plates at odd angles, thin legs, a beam emitter on the right forearm and
  // a small pod on the left shoulder.
  wraith(m, c) {
    const P = paint(c);
    for (const side of [-1, 1]) leg(m, side * 1.05, c.hip, P, 0.75);
    const h = c.hip;
    m.box(0, h + 0.3, 0, 2.2, 0.6, 1.2, D);
    // The chest as four plates leaning in to a ridge.
    for (const side of [-1, 1]) {
      m.plate([[side * 0.05, h + 2.2, -0.9], [side * 1.25, h + 1.7, -0.6],
        [side * 1.1, h + 0.7, -0.5], [side * 0.05, h + 0.6, -1.0]], 0.2, P);
      m.plate([[side * 0.05, h + 2.2, 0.9], [side * 1.25, h + 1.7, 0.6],
        [side * 1.1, h + 0.7, 0.6], [side * 0.05, h + 0.6, 0.8]], 0.2, P);
      m.plate([[side * 1.25, h + 1.7, -0.6], [side * 1.25, h + 1.7, 0.6],
        [side * 1.1, h + 0.7, 0.6], [side * 1.1, h + 0.7, -0.5]], 0.2, P);
    }
    m.box(0, h + 1.35, 0, 2.0, 1.2, 1.4, D);                  // what is inside
    m.plate([[-0.5, h + 2.55, -0.75], [0.5, h + 2.55, -0.75], [0.3, h + 2.2, -1.15], [-0.3, h + 2.2, -1.15]], 0.3, P);
    m.box(0, h + 2.3, -1.08, 0.7, 0.1, 0.1, EYE);
    m.box(0, h + 1.3, 0.85, 0.7, 0.6, 0.2, EYE);
    m.box(0, h + 2.25, 0.0, 0.08, 0.2, 1.6, A);
    for (const side of [-1, 1]) m.box(side * 1.45, h + 1.7, 0.0, 0.5, 0.7, 1.0, D);
    const [gx, gy, gz] = c.muzzle.chaingun;
    m.box(gx, gy, gz + 2.3, 0.45, 0.55, 2.6, P);
    m.box(gx, gy, gz + 0.6, 0.18, 0.18, 1.2, GUN);
    for (let i = 0; i < 3; i++) m.box(gx, gy, gz + 1.3 + i * 0.5, 0.3, 0.3, 0.1, A);
    pod(m, c.muzzle.rockets, 2, 2, P, 1.1);
  },
};
