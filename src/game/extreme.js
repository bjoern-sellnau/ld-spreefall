// Weather past anything real, for the game: acid rain that eats what it
// lands on, an ion storm whose bolts burn people to nothing and break what
// they hit, a tornado that throws people and trees about, and a firestorm.
//
// Each is switched on in the cheat menu, and then comes on its own, at
// random, a few minutes apart on average; more than one at once if the dice
// say so. Each is announced first, the way a warning comes over the radio and
// the phone, with the time to find shelter in, and given the all clear when
// it is over. Where it happens is round you: a stretch of the city some
// hundreds of metres across, which you can get out of, or a tornado on a
// line that passes close by.
//
// Everything here is arithmetic and bookkeeping, so the checks can run it;
// main.js does what each one does to the city.

export const EXTREME = {
  kinds: {
    acid: {
      name: 'Säureregen', en: 'acid rain',
      help: 'Green rain that eats whoever is out in it down to the bones and melts the trees; cars corrode, and you lose health in the open.',
      // How long it rains, the stretch it covers, how hard it eats at a
      // person in the open (a share of what he can take, a second) and how
      // many trees it melts a second while it is at its height.
      last: [35, 60], radius: 220, harm: 0.12, trees: 0.6, you: 6,
    },
    ion: {
      name: 'Ionensturm', en: 'ion storm',
      help: 'Violet bolts every second or so; whoever is within a few metres burns to a skeleton, and cars, trees, bus shelters and frontages are wrecked.',
      // A bolt this often, on anything in the stretch, and what it does
      // where it lands: everybody within the reach is burnt to nothing.
      last: [30, 50], radius: 180, every: 0.7, reach: 4.5, blast: 7, you: 70,
    },
    tornado: {
      name: 'Wirbelsturm', en: 'tornado',
      help: 'A funnel that passes close: whoever it takes is thrown up and bursts on landing, trees are torn out and cars thrown. Its core reaches you even under a roof.',
      // How fast the funnel goes over the ground, how wide its core is and
      // how far round it the wind still takes things, and what it costs you
      // a second inside it. It comes from a quarter of a kilometre off on a
      // line that passes within a few dozen metres of where you were.
      last: [40, 60], speed: 9, core: 14, reach: 38, from: 250, miss: 30, you: 10, lift: 18,
    },
    fire: {
      name: 'Feuersturm', en: 'firestorm',
      help: 'An orange sky raining embers: people in the open burn, trees catch fire and cars burn.',
      // The stretch it burns, what it does to a person in the open, and how
      // often it sets a tree alight.
      last: [30, 50], radius: 200, harm: 0.16, trees: 0.8, you: 9,
    },
  },
  // Warned this long before it comes.
  warn: 20,
  // On average this many minutes between one and the next of all those
  // switched on, between half and one and a half times that each time.
  minutes: 5,
  minutesMin: 1,
  minutesMax: 20,
  // How long it takes to come on and to go, in seconds.
  ramp: 6,
};

export const EXTREME_KINDS = Object.keys(EXTREME.kinds);

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

/** What the warning says, word for word. */
export function warningText(kind, seconds = EXTREME.warn) {
  const K = EXTREME.kinds[kind];
  return `Achtung: ${K.name} wird erwartet in ${Math.max(0, Math.ceil(seconds))} Sekunden. Suchen Sie sich Schutz!`;
}
export function arrivalText(kind) {
  return `${EXTREME.kinds[kind].name}! Suchen Sie sofort Schutz.`;
}
export function allClearText(kind) {
  return `Entwarnung: ${EXTREME.kinds[kind].name} ist vorüber.`;
}

/**
 * Where a tornado goes: from a point a quarter of a kilometre off, on a line
 * that passes within so many metres of where you were, at its own speed.
 */
export function tornadoPath(x, z, rand = Math.random) {
  const K = EXTREME.kinds.tornado;
  const a = rand() * Math.PI * 2;
  const sx = x + Math.cos(a) * K.from, sz = z + Math.sin(a) * K.from;
  // Aimed at a point beside you, so it passes close and does not have to
  // come through you.
  const side = (rand() - 0.5) * 2 * K.miss;
  const tx = x - Math.sin(a) * side, tz = z + Math.cos(a) * side;
  const l = Math.hypot(tx - sx, tz - sz) || 1;
  return { x: sx, z: sz, dx: (tx - sx) / l, dz: (tz - sz) / l };
}

/** How strong an event is now, nought to one: coming on, at it, going. */
export function strength(e) {
  if (e.warnLeft > 0) return 0;
  const r = EXTREME.ramp;
  return clamp(Math.min(e.age / r, (e.last - e.age) / r), 0, 1);
}

export class Extreme {
  constructor() {
    this.enabled = { acid: false, ion: false, tornado: false, fire: false };
    this.minutes = EXTREME.minutes;
    this.events = [];          // { kind, x, z, warnLeft, age, last, path?, said:{} }
    this.nextIn = 0;
    this.onSay = null;         // fn(text, kind, what) what: 'warn' | 'arrive' | 'clear' | 'count'
    this.load();
    this.nextIn = this._wait(Math.random);
  }

  get any() { return EXTREME_KINDS.some((k) => this.enabled[k]); }

  _wait(rand) { return this.minutes * 60 * (0.5 + rand()); }

  setEnabled(kind, on) {
    if (kind === 'all') { for (const k of EXTREME_KINDS) this.enabled[k] = !!on; }
    else this.enabled[kind] = !!on;
    this.save();
  }

  setMinutes(m) {
    this.minutes = clamp(m, EXTREME.minutesMin, EXTREME.minutesMax);
    this.nextIn = Math.min(this.nextIn, this._wait(Math.random));
    this.save();
  }

  /** The one of a kind that is coming or here, if there is one. */
  event(kind) { return this.events.find((e) => e.kind === kind) || null; }

  /**
   * Warn of one now, round this point, whatever the dice say. The cheat
   * menu's buttons and the checks use it; the dice use it too.
   */
  announce(kind, x, z, rand = Math.random, warn = EXTREME.warn) {
    if (!EXTREME.kinds[kind] || this.event(kind)) return null;
    const K = EXTREME.kinds[kind];
    const e = {
      kind, x, z, warnLeft: warn, age: 0,
      last: K.last[0] + (K.last[1] - K.last[0]) * rand(), said: {},
    };
    if (kind === 'tornado') {
      e.path = tornadoPath(x, z, rand);
      e.fx = e.path.x; e.fz = e.path.z;
      e.last = Math.max(e.last, (2 * K.from) / K.speed);
    }
    this.events.push(e);
    // With no time to warn, it is here.
    if (warn > 0) this._say(warningText(kind, warn), kind, 'warn');
    else { e.warnLeft = 0; this._say(arrivalText(kind), kind, 'arrive'); }
    return e;
  }

  /** Over now, whatever was left of it. */
  stop(kind) {
    const e = this.event(kind);
    if (!e) return false;
    this.events.splice(this.events.indexOf(e), 1);
    if (e.warnLeft <= 0) this._say(allClearText(kind), kind, 'clear');
    return true;
  }

  clear() { this.events.length = 0; }

  _say(text, kind, what) { if (this.onSay) this.onSay(text, kind, what); }

  /**
   * A step: the countdowns, the events running, and the dice for the next.
   * @param {number} dt
   * @param {{x:number, z:number}} at where you are, for where the next one comes
   */
  update(dt, at, rand = Math.random) {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.warnLeft > 0) {
        const before = Math.ceil(e.warnLeft);
        e.warnLeft -= dt;
        const after = Math.ceil(Math.max(0, e.warnLeft));
        // Every five seconds of the countdown, and each of the last three.
        if (after > 0 && after !== before && (after % 5 === 0 || after <= 3)) {
          this._say(warningText(e.kind, after), e.kind, 'count');
        }
        if (e.warnLeft <= 0) {
          e.warnLeft = 0;
          this._say(arrivalText(e.kind), e.kind, 'arrive');
        }
        continue;
      }
      e.age += dt;
      if (e.path) {
        const K = EXTREME.kinds.tornado;
        e.fx += e.path.dx * K.speed * dt;
        e.fz += e.path.dz * K.speed * dt;
      }
      if (e.age >= e.last) {
        this.events.splice(i, 1);
        this._say(allClearText(e.kind), e.kind, 'clear');
      }
    }
    if (!this.any) { this.nextIn = Math.max(this.nextIn, 1); return; }
    this.nextIn -= dt;
    if (this.nextIn > 0) return;
    this.nextIn = this._wait(rand);
    const free = EXTREME_KINDS.filter((k) => this.enabled[k] && !this.event(k));
    if (!free.length) return;
    const kind = free[Math.min(free.length - 1, Math.floor(rand() * free.length))];
    const a = rand() * Math.PI * 2, off = rand() * 40;
    this.announce(kind, at.x + Math.cos(a) * off, at.z + Math.sin(a) * off, rand);
  }

  /** How strong each kind is now, and where. */
  now() {
    const out = { acid: 0, ion: 0, tornado: 0, fire: 0 };
    for (const e of this.events) out[e.kind] = Math.max(out[e.kind], strength(e));
    return out;
  }

  /**
   * How much of a kind there is at a point: its strength, inside its
   * stretch, fading over the last fifth of it; for the tornado, how close
   * to the funnel, one in the core and nothing past its reach.
   */
  at(kind, x, z) {
    const e = this.event(kind);
    if (!e) return 0;
    const s = strength(e);
    if (s <= 0) return 0;
    const K = EXTREME.kinds[kind];
    if (kind === 'tornado') {
      const d = Math.hypot(x - e.fx, z - e.fz);
      if (d <= K.core) return s;
      return s * clamp(1 - (d - K.core) / (K.reach - K.core), 0, 1);
    }
    const d = Math.hypot(x - e.x, z - e.z);
    return s * clamp((K.radius - d) / (K.radius * 0.2), 0, 1);
  }

  save() {
    try {
      localStorage.setItem('spreefall.extreme', JSON.stringify({ enabled: this.enabled, minutes: this.minutes }));
    } catch { /* private window */ }
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem('spreefall.extreme') || 'null');
      if (!saved) return;
      for (const k of EXTREME_KINDS) if (saved.enabled && k in saved.enabled) this.enabled[k] = !!saved.enabled[k];
      if (Number.isFinite(saved.minutes)) this.minutes = clamp(saved.minutes, EXTREME.minutesMin, EXTREME.minutesMax);
    } catch { /* nothing kept */ }
  }
}
