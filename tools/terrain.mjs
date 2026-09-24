// Ground height for the whole box. Central Berlin sits on the Warsaw Berlin
// glacial valley and is close to dead flat, about 34 m above sea level, so the
// terrain here is a gentle roll of under a metre plus two deliberate features:
// the undulating floor of the stelae field, and the cut of the Spree.

import { fbm2 } from './noise.mjs';

export class Terrain {
  constructor(memorial, waterPolys) {
    this.memorial = memorial;          // {ring, minX, maxX, minZ, maxZ}
    this.water = waterPolys;           // [{ring, bbox}]
    this.waterLevel = -0.9;
  }

  base(x, z) {
    return (fbm2(x / 420, z / 420, 3, 7) - 0.5) * 1.4
         + (fbm2(x / 95, z / 95, 2, 19) - 0.5) * 0.22;
  }

  // Eisenman's field dips towards the middle. The player walks down into it and
  // the stelae rise past their head without ever getting taller.
  memorialOffset(x, z) {
    const m = this.memorial;
    if (!m) return 0;
    if (x < m.minX - 12 || x > m.maxX + 12 || z < m.minZ - 12 || z > m.maxZ + 12) return 0;
    const u = (x - m.minX) / (m.maxX - m.minX);
    const v = (z - m.minZ) / (m.maxZ - m.minZ);
    const edge = Math.min(1, Math.min(u, 1 - u) * 5) * Math.min(1, Math.min(v, 1 - v) * 5);
    if (edge <= 0) return 0;
    const bowl = -2.4 * Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * Math.sin(Math.PI * Math.min(1, Math.max(0, v)));
    const ripple = (fbm2(x / 26, z / 26, 3, 91) - 0.5) * 1.5;
    return (bowl + ripple) * edge;
  }

  height(x, z) {
    return this.base(x, z) + this.memorialOffset(x, z);
  }
}
