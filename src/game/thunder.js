// What a strike sounds like from so far off, as numbers the sound is then
// made from.
//
// Thunder is the channel heating the air it goes through and the air
// slamming back: every metre of a channel some kilometres long gives its own
// pressure wave, and they reach you one after another, the nearest first, so
// what you hear is a train of claps rolling on for as long as the far end of
// the channel is further off than the near end. Measured, that is mostly ten
// to fifteen seconds, and anything from two to over thirty. Most of its
// energy is low, round fifty cycles and under, and the air takes the high
// part out with distance: close to, the first of it is a sharp crack and a
// tearing, and from a few kilometres it is a low roll and nothing else.
//
// Everything here is arithmetic, so the checks can run it; audio.js plays it.

export const THUNDER = {
  // Under this the strike was close enough to crack.
  crackWithin: 1200,
  // How long it rolls: this much at the least, and this much more for each
  // metre away, to most of half a minute.
  rollBase: 5,
  rollPerMetre: 1 / 330,
  rollMost: 26,
  // How loud, against how far: as loud as it gets at this distance and
  // nearer, quieter as the square root further off, never under the floor.
  loudAt: 400,
  loudFloor: 0.18,
  // The air's lowpass: this many cycles at the strike, falling away by e
  // every this many metres, never under the floor.
  airTop: 9000,
  airFall: 1300,
  airFloor: 260,
  // The rumble is low passed again, about the fifty cycles thunder peaks at
  // and the harmonics above it.
  rumbleTop: 240,
};

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

/**
 * The shape of one roll of thunder.
 * @param {number} distance metres to the strike
 * @param {() => number} rand
 * @returns {{crack:number, roll:number, loud:number, air:number, rumble:number, claps:{t:number, a:number}[]}}
 */
export function thunderShape(distance, rand = Math.random) {
  const T = THUNDER;
  const d = Math.max(50, distance);
  const crack = d < T.crackWithin ? 1 - d / T.crackWithin : 0;
  const roll = clamp((T.rollBase + d * T.rollPerMetre) * (0.75 + rand() * 0.5), T.rollBase * 0.6, T.rollMost);
  const loud = clamp(Math.sqrt(T.loudAt / d), T.loudFloor, 1);
  const air = clamp(T.airTop * Math.exp(-d / T.airFall), T.airFloor, T.airTop);
  const rumble = Math.min(T.rumbleTop, air);
  // The claps: the first, the loudest, at once; the rest bunched towards the
  // start and dying away towards the end.
  const n = Math.round(4 + roll * 0.6 + rand() * 3);
  const claps = [{ t: 0, a: 1 }];
  for (let i = 1; i < n; i++) {
    const t = roll * 0.85 * Math.pow(rand(), 1.5);
    const a = (0.3 + 0.7 * rand()) * Math.exp(-2.2 * t / roll);
    claps.push({ t, a });
  }
  claps.sort((p, q) => p.t - q.t);
  return { crack, roll, loud, air, rumble, claps };
}

/**
 * The rumble's loudness over its roll, sampled this many times a second, as
 * a curve for the gain: each clap comes up in a tenth of a second or so and
 * dies away over one to two, on a bed that fades over the whole roll.
 */
export function rumbleCurve(shape, rate = 60, rand = Math.random) {
  const n = Math.max(2, Math.ceil(shape.roll * rate));
  const out = new Float32Array(n);
  const claps = shape.claps.map((c) => ({ ...c, rise: 0.06 + rand() * 0.18, fall: 0.6 + rand() * 1.4 }));
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * shape.roll;
    let v = 0.14 * Math.exp(-t / (shape.roll * 0.45)) * Math.min(1, t / 0.3);
    for (const c of claps) {
      const x = t - c.t;
      if (x < 0) continue;
      v += c.a * (x < c.rise ? x / c.rise : Math.exp(-(x - c.rise) / c.fall));
    }
    // And all of it gone by the end.
    const tail = 1 - Math.max(0, (t - shape.roll * 0.8) / (shape.roll * 0.2));
    out[i] = Math.max(0.0001, Math.min(1.4, v) * shape.loud * tail);
  }
  return out;
}
