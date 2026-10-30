// The weather: what the sky is doing, how much of it, and how it changes.
//
// Six kinds, each a set of amounts rather than a switch, so that one can turn
// into another over half a minute instead of snapping: cloud over the sky,
// rain, snow, mist and fog, wind, lightning, and how much darker the day is
// under it. The renderer, the sound and the soldiers all read the blend.
//
// Picked on each game's page before it starts, or random, where it changes
// by itself every few minutes the way the weather over a city does, mostly
// to something next to it (clear to cloud, cloud to rain, rain to a storm and
// back) rather than from a blue sky straight into a thunderstorm. The cheat
// menu can force any of them, turn the whole thing off, make it more or less,
// change how often the random weather turns, and stop the lightning. None of
// that marks a run: the weather is a choice, like the time of day.

const KEY = 'spreefall.weather';

/** The kinds, in the order the menus show them. */
export const KINDS = [
  { id: 'clear', label: 'Clear', note: 'a blue sky with a little high cloud', help: 'A blue sky with a little high cloud, the sun and its shadows, and the stars at night.' },
  { id: 'cloudy', label: 'Cloudy', note: 'grey over, no shadows to speak of', help: 'Grey over: the sun and its shadows go, and so do the stars at night.' },
  { id: 'rain', label: 'Rain', note: 'steady rain, the streets wet and shining', help: 'Steady rain round you; the street darkens, shines and stands in puddles, and dries over five minutes after.' },
  { id: 'storm', label: 'Storm', note: 'heavy rain, wind, lightning and thunder', help: 'Heavy rain and wind, and lightning: the sky flashes, a bolt stands on the skyline and the thunder comes three seconds a kilometre later.' },
  { id: 'fog', label: 'Fog', note: 'under two hundred metres to see, and they cannot see you either', help: 'The view closes to about 180 m, and soldiers see you no further than the fog lets them.' },
  { id: 'snow', label: 'Snow', note: 'falling snow that settles on the street and the roofs', help: 'Flakes that sway as they fall and settle white on everything facing up; rain washes it away.' },
];

/** And random, which is not a kind but a way of choosing one. */
export const RANDOM = { id: 'random', label: 'Random', note: 'it changes by itself every few minutes', help: 'Holds a kind for a few minutes and then turns, mostly to the one next to it; it snows only from November to the middle of March.' };

export const WEATHER = {
  // What each kind is, as amounts from nought to one. Rain and snow are how
  // hard; fog is how much of the haze the visibility below asks for is
  // drawn as low lying fog; dark is how much light the cloud takes away.
  looks: {
    clear: { cloud: 0, rain: 0, snow: 0, wind: 0.15, lightning: 0, dark: 0 },
    cloudy: { cloud: 0.8, rain: 0, snow: 0, wind: 0.35, lightning: 0, dark: 0.3 },
    rain: { cloud: 0.92, rain: 0.6, snow: 0, wind: 0.45, lightning: 0, dark: 0.45 },
    storm: { cloud: 1, rain: 1, snow: 0, wind: 0.95, lightning: 1, dark: 0.65 },
    fog: { cloud: 0.55, rain: 0, snow: 0, wind: 0.05, lightning: 0, dark: 0.3 },
    snow: { cloud: 0.88, rain: 0, snow: 0.8, wind: 0.3, lightning: 0, dark: 0.3 },
  },
  // How far you can see in each, in metres. Fog is under a kilometre by the
  // WMO's own definition, and under 180 metres is what the Met Office calls
  // fog in a forecast for the public; rain and snow take a city's ten to twenty
  // kilometres down to a few, and a downpour or heavy snow to one or less.
  visibility: { clear: 20000, cloudy: 14000, rain: 4000, storm: 1200, fog: 180, snow: 900 },
  // Koschmieder: the distance at which a dark object against the horizon
  // sky drops to the two per cent contrast an eye can just make out is
  // ln(50), 3.912, over the extinction coefficient. Haze is drawn with that
  // coefficient, so a visibility is a fog density.
  koschmieder: 3.912,
  // A change from one kind to the next takes this long, in seconds.
  blend: 30,
  // Random weather holds what it has for a while before it may turn: this
  // many minutes on average, set in the cheat menu, and between half and one
  // and a half times that each time.
  minutes: 4,
  minutesMin: 0.5,
  minutesMax: 20,
  // Where random weather goes next from each kind, by weight. Mostly to the
  // kind next to it: a clear sky clouds over before it rains, a storm eases
  // to rain before it clears. Snow only falls in the colder months (below),
  // and takes the place of rain when it does.
  next: {
    clear: { cloudy: 6, fog: 2, rain: 1 },
    cloudy: { clear: 4, rain: 4, storm: 1, fog: 1 },
    rain: { cloudy: 5, storm: 2, clear: 1 },
    storm: { rain: 6, cloudy: 3 },
    fog: { clear: 4, cloudy: 4 },
    snow: { cloudy: 6, fog: 1, clear: 1 },
  },
  // Days of the year with a chance of snow: November to the middle of March.
  winter: (doy) => doy >= 305 || doy <= 75,
  // How fast the street gets wet and dries, and how fast snow settles and
  // goes, in seconds to the whole way.
  wetting: 50,
  drying: 300,
  settling: 120,
  melting: 400,
  // Lightning in a storm at full strength: one strike this often on average,
  // between this near and this far, in metres.
  strikeEvery: 9,
  strikeNear: 250,
  strikeFar: 4000,
  // A strike is a few strokes down the same channel, which is the flicker
  // you see: high speed video of 432 flashes over Arizona and Sao Paulo
  // counted 3.9 strokes a flash on average, 61.5 ms apart (Saraiva et al.
  // 2010).
  strokes: 3.9,
  interstroke: 0.0615,
  // Sound covers a kilometre in about three seconds: the thunder comes that
  // long after the flash.
  sound: 343,
  // The cheat menu's strength, as a share of what the kind is.
  intensityMin: 0.25,
  intensityMax: 2,
};

const ids = KINDS.map((k) => k.id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** The amounts of a blend of two kinds, k of the way from a to b. */
export function mixLooks(a, b, k) {
  const A = WEATHER.looks[a], B = WEATHER.looks[b];
  const out = {};
  for (const key of Object.keys(A)) out[key] = A[key] + (B[key] - A[key]) * k;
  // Haze adds as extinction, not as distance: half way from twenty kilometres
  // to two hundred metres is a little under four hundred, not ten kilometres.
  const sa = WEATHER.koschmieder / WEATHER.visibility[a];
  const sb = WEATHER.koschmieder / WEATHER.visibility[b];
  out.extinction = sa + (sb - sa) * k;
  out.visibility = WEATHER.koschmieder / out.extinction;
  return out;
}

/** Pick the next kind for random weather. */
export function nextKind(from, rand = Math.random, doy = 166) {
  const table = { ...(WEATHER.next[from] || WEATHER.next.cloudy) };
  // In the colder months what falls is snow; in the rest, never.
  if (WEATHER.winter(doy)) {
    if (table.rain) { table.snow = (table.snow || 0) + table.rain; delete table.rain; }
    if (table.storm) { table.snow = (table.snow || 0) + table.storm * 0.5; delete table.storm; }
  } else {
    delete table.snow;
  }
  const entries = Object.entries(table).filter(([k]) => k !== from);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries.length ? entries[entries.length - 1][0] : 'clear';
}

export class Weather {
  constructor() {
    // What was picked: one of the kinds, or random.
    this.choice = 'clear';
    // The cheat menu's: off is clear and nothing else whatever was picked,
    // strength scales what falls and blows, minutes is how long random holds,
    // lightning can be stopped.
    this.off = false;
    this.intensity = 1;
    this.minutes = WEATHER.minutes;
    this.lightning = true;
    // Where it is: from one kind to another, k of the way.
    this.from = 'clear';
    this.to = 'clear';
    this.k = 1;
    // How long random weather holds before it turns.
    this.hold = 0;
    // What the street has on it, nought to one: water and snow.
    this.wet = 0;
    this.cover = 0;
    // The last flash, fading, and when the next strike is due.
    this.flash = 0;
    this.strikeIn = 0;
    // The strokes of the last strike still to come, and when the next is.
    this.restrokes = 0;
    this.restrokeIn = 0;
    this.strokeFlash = 0;
    this.onChange = null;   // fn(kind) when random weather turns
    this.onStrike = null;   // fn({distance, bearing, delay, strokes}) for a strike
    this.onRestroke = null; // fn() for each stroke after the first
    this.load();
    this.from = this.to = this.target();
  }

  /** The kind it is heading for, from the choice and the cheat menu. */
  target() {
    if (this.off) return 'clear';
    if (this.choice === 'random') return ids.includes(this.to) ? this.to : 'clear';
    return ids.includes(this.choice) ? this.choice : 'clear';
  }

  /** Pick a kind, or random. @returns {boolean} whether it was one there is */
  choose(id, rand = Math.random, doy = 166) {
    if (id !== 'random' && !ids.includes(id)) return false;
    this.choice = id;
    // Random goes on from whatever it is now, and holds that a while first.
    if (id === 'random') this.hold = this._holdFor(rand);
    else this._turn(this.target(), false);
    this.save();
    return true;
  }

  /**
   * A game starting: straight into what was picked, and for random into
   * one of the kinds to begin with, more often a dry one than not.
   */
  start(rand = Math.random, doy = 166) {
    if (this.choice === 'random' && !this.off) {
      const first = { clear: 4, cloudy: 4, rain: 2, fog: 1, storm: 0.5 };
      if (WEATHER.winter(doy)) { first.snow = first.rain + first.storm; delete first.rain; delete first.storm; }
      const entries = Object.entries(first);
      let r = rand() * entries.reduce((s, [, w]) => s + w, 0);
      let pick = 'clear';
      for (const [k, w] of entries) { r -= w; if (r <= 0) { pick = k; break; } }
      this.to = pick;
      this.hold = this._holdFor(rand);
    } else {
      this.to = this.target();
    }
    this.snap();
  }

  /** The cheat menu's off: clear and nothing more, whatever was picked. */
  setOff(off) {
    this.off = !!off;
    this._turn(this.target(), false);
    this.save();
  }

  setIntensity(v) {
    this.intensity = clamp(Number(v) || 1, WEATHER.intensityMin, WEATHER.intensityMax);
    this.save();
  }

  setMinutes(v) {
    this.minutes = clamp(Number(v) || WEATHER.minutes, WEATHER.minutesMin, WEATHER.minutesMax);
    this.save();
  }

  setLightning(on) {
    this.lightning = !!on;
    if (!this.lightning) this.restrokes = 0;
    this.save();
  }

  /** Straight to where it is heading, street and all: for a fresh start and the checks. */
  snap() {
    this.from = this.to;
    this.k = 1;
    const now = this.now();
    this.wet = now.rain > 0 ? 1 : 0;
    this.cover = now.snow > 0 ? 1 : 0;
  }

  _holdFor(rand) {
    return this.minutes * 60 * (0.5 + rand());
  }

  /** Start a change to another kind, from wherever the blend has got to. */
  _turn(kind, announce) {
    if (kind === this.to && this.k >= 1) return;
    // Mid change, the blend so far is where the next one starts from. Two
    // kinds are all a blend can hold, so take whichever it is nearer.
    if (this.k < 1) this.from = this.k < 0.5 ? this.from : this.to;
    else this.from = this.to;
    this.to = kind;
    this.k = this.from === this.to ? 1 : 0;
    if (announce && this.onChange) this.onChange(kind);
  }

  /**
   * A step on.
   * @param {number} dt seconds
   * @param {() => number} rand
   * @param {number} doy the day of the year, for whether it can snow
   */
  update(dt, rand = Math.random, doy = 166) {
    if (this.k < 1) this.k = Math.min(1, this.k + dt / WEATHER.blend);
    if (!this.off && this.choice === 'random') {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.hold = this._holdFor(rand);
        this._turn(nextKind(this.to, rand, doy), true);
      }
    }
    const now = this.now();
    // The street: wet while it rains, drying after; snow settling while it
    // snows, and going again after.
    const rainNow = now.rain > 0.05 ? 1 : 0;
    this.wet = rainNow ? Math.min(1, this.wet + dt / WEATHER.wetting)
      : Math.max(0, this.wet - dt / WEATHER.drying);
    const snowNow = now.snow > 0.05 ? 1 : 0;
    this.cover = snowNow ? Math.min(1, this.cover + dt / WEATHER.settling)
      : Math.max(0, this.cover - dt / WEATHER.melting);
    // Snow melts on a wet street, and rain washes the snow away.
    if (rainNow) this.cover = Math.max(0, this.cover - dt / WEATHER.settling);
    // Lightning.
    this.flash = Math.max(0, this.flash - dt * 2.6);
    if (this.restrokes > 0) {
      this.restrokeIn -= dt;
      if (this.restrokeIn <= 0) {
        this.restrokes--;
        this.restrokeIn += WEATHER.interstroke * (0.5 + rand());
        this.flash = Math.min(1, this.flash + this.strokeFlash * 0.7);
        if (this.onRestroke) this.onRestroke();
      }
    }
    if (now.lightning > 0.05 && this.lightning) {
      this.strikeIn -= dt * now.lightning;
      if (this.strikeIn <= 0) {
        this.strikeIn = WEATHER.strikeEvery * (0.3 + rand() * 1.4);
        const distance = WEATHER.strikeNear + (WEATHER.strikeFar - WEATHER.strikeNear) * rand() * rand();
        // Between one and about seven strokes, 3.9 on average.
        const strokes = Math.round(1 + rand() * 2 * (WEATHER.strokes - 1));
        const strike = { distance, bearing: rand() * Math.PI * 2, delay: distance / WEATHER.sound, strokes };
        // The nearer, the brighter.
        this.strokeFlash = clamp(1.4 - distance / 3000, 0.25, 1);
        this.flash = Math.min(1, this.flash + this.strokeFlash);
        this.restrokes = strokes - 1;
        this.restrokeIn = WEATHER.interstroke * (0.5 + rand());
        if (this.onStrike) this.onStrike(strike);
      }
    } else {
      this.strikeIn = Math.max(this.strikeIn, 2);
    }
  }

  /** The amounts now, with the cheat menu's strength on what falls and blows. */
  now() {
    const m = mixLooks(this.from, this.to, this.k);
    const s = this.intensity;
    m.rain = clamp(m.rain * s, 0, 1.5);
    m.snow = clamp(m.snow * s, 0, 1.5);
    m.wind = clamp(m.wind * s, 0, 1.5);
    m.lightning = this.lightning ? clamp(m.lightning * s, 0, 2) : 0;
    // More of it is less to see by, as extinction.
    if (s !== 1) {
      const base = WEATHER.koschmieder / WEATHER.visibility.clear;
      m.extinction = base + (m.extinction - base) * s;
      m.visibility = WEATHER.koschmieder / m.extinction;
    }
    m.wet = this.wet;
    m.cover = this.cover;
    m.flash = this.flash;
    m.kind = this.k >= 0.5 ? this.to : this.from;
    return m;
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        choice: this.choice, off: this.off, intensity: this.intensity, minutes: this.minutes, lightning: this.lightning,
      }));
    } catch { /* private mode */ }
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!saved) return;
      if (saved.choice === 'random' || ids.includes(saved.choice)) this.choice = saved.choice;
      this.off = !!saved.off;
      if (Number.isFinite(saved.intensity)) this.intensity = clamp(saved.intensity, WEATHER.intensityMin, WEATHER.intensityMax);
      if (Number.isFinite(saved.minutes)) this.minutes = clamp(saved.minutes, WEATHER.minutesMin, WEATHER.minutesMax);
      if (saved.lightning !== undefined) this.lightning = !!saved.lightning;
    } catch { /* a corrupt entry is not worth a crash */ }
  }
}
