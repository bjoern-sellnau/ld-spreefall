// The S-Bahn on the Stadtbahn viaduct.
//
// A train is three carriages nose to tail running along a railway the builder
// wrote into the manifest, at the height of the viaduct deck. It is scenery
// with a timetable: nothing shoots it, nothing rides it, and it is there
// because a city with a railway through the middle of it should have
// something on the railway. Standing under the arches on Friedrichstrasse and
// hearing one go over is most of the point of having built the viaduct.
//
// It is drawn through the vehicle pipeline, which already takes a mesh and a
// list of positions, so a carriage costs an instance rather than a draw call.

export const TRAIN = {
  cars: 3,
  carLength: 17.4,
  gap: 1.1,
  speed: 17,              // metres a second, which is a shade over 60 km/h
  // How high the floor of a carriage sits over the ground the viaduct stands
  // on: 6.35 m of deck and rail, and the body on top of its bogies.
  deck: 6.35,
  // How far from the player a train is worth running at all. Beyond this the
  // line still has one, it simply is not stepped until you are near it.
  reach: 900,
};

export class Trains {
  /** @param {object} world the streamed city */
  constructor(world) {
    this.world = world;
    this.lines = [];
    this.cars = [];
    this.onPass = null;     // fn(distance) as one goes by, for the noise
    this._passed = new Map();
  }

  /** Every elevated railway in memory, as a polyline with its own length. */
  gather() {
    const out = [];
    for (const r of this.world.manifest.railLines || []) {
      if (!r.up || !r.pts || r.pts.length < 4) continue;
      const pts = [];
      for (let i = 0; i < r.pts.length; i += 2) pts.push([r.pts[i], r.pts[i + 1]]);
      let len = 0;
      for (let i = 1; i < pts.length; i++) {
        len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      }
      if (len < 120) continue;
      out.push({ id: r.id || out.length, pts, length: len, at: len * 0.25, dir: 1 });
    }
    // A line that is already running keeps where it had got to, so a district
    // landing next door does not teleport the train back to the start.
    for (const line of out) {
      const had = this.lines.find((l) => l.pts.length === line.pts.length
        && Math.abs(l.pts[0][0] - line.pts[0][0]) < 1
        && Math.abs(l.pts[0][1] - line.pts[0][1]) < 1);
      if (had) { line.at = had.at; line.dir = had.dir; }
    }
    this.lines = out;
    return out.length;
  }

  /** A point and a heading at a distance along a line. */
  _at(line, d) {
    let left = Math.max(0, Math.min(line.length, d));
    const pts = line.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len <= 0) continue;
      if (left <= len) {
        const t = left / len;
        return {
          x: a[0] + (b[0] - a[0]) * t,
          z: a[1] + (b[1] - a[1]) * t,
          yaw: Math.atan2(b[0] - a[0], b[1] - a[1]),
        };
      }
      left -= len;
    }
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    return { x: b[0], z: b[1], yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  }

  /**
   * One step. The train runs to the end of the line and comes back, which is
   * what a railway that leaves the city looks like from inside it.
   *
   * @param {number} dt seconds
   * @param {{x:number,z:number}} eye where the player is
   */
  update(dt, eye) {
    this.cars.length = 0;
    const span = TRAIN.carLength + TRAIN.gap;
    for (const line of this.lines) {
      // The train runs whether or not you are near it, and is only drawn when
      // you are. Stepping it only when it was near froze it the moment it ran
      // past the edge of that circle, which is to say for good: a train that
      // does not move never comes back.
      line.at += TRAIN.speed * dt * line.dir;
      if (line.at > line.length - span * TRAIN.cars) line.dir = -1;
      else if (line.at < span * TRAIN.cars) line.dir = 1;
      const head = this._at(line, line.at);
      const away = Math.hypot(head.x - eye.x, head.z - eye.z);
      if (away > TRAIN.reach) continue;
      for (let i = 0; i < TRAIN.cars; i++) {
        const at = this._at(line, line.at - i * span * line.dir);
        const y = this.world.groundHeight(at.x, at.z) + TRAIN.deck;
        this.cars.push({
          type: 'train', alive: true,
          x: at.x, y, z: at.z,
          yaw: line.dir > 0 ? at.yaw : at.yaw + Math.PI,
          pitch: 0, roll: 0, hitFlash: 0, rotor: 0,
        });
      }
      // The noise, once per pass rather than every step: a train coming over
      // the arches you are standing under is one event, not sixty a second.
      if (this.onPass && away < 160) {
        const last = this._passed.get(line) || 0;
        if (away < last - 8 || last === 0) this.onPass(away);
        this._passed.set(line, away);
      } else {
        this._passed.set(line, 0);
      }
    }
    return this.cars;
  }

  reset() {
    this.cars.length = 0;
    this._passed.clear();
    for (const line of this.lines) { line.at = line.length * 0.25; line.dir = 1; }
  }
}
