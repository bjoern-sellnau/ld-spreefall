// The cheat menu's state, in one place, so that every system that has to care
// reads the same object rather than each keeping its own flag.
//
// Two kinds of thing live here. Switches, which stay on until you turn them
// off, and which the menu renders as toggles. And the gore settings, which are
// all off by default: the game without them has no blood in it at all, and
// that is the version anybody gets who does not go looking.
//
// A run with any of these on is marked as such. The score still counts up,
// because it is your game, but the interface says plainly that it was not a
// clean run and the end screen says so too.

const KEY = 'spreefall.cheats';

/** Every switch, in one list, so saving and clearing cannot miss one. */
const KEYS = ['godmode', 'infiniteAmmo', 'nukeRain', 'noDrones', 'cinematic',
  'slowBlast', 'mechKillers', 'wreckBuildings', 'wreckGround', 'lastKill',
  'gib', 'ragdoll', 'blood', 'ultraGore', 'maxGore'];

/** The switches, in the order the menu shows them. */
export const SWITCHES = [
  { id: 'godmode', label: 'God mode', note: 'nothing can hurt you' },
  { id: 'infiniteAmmo', label: 'Infinite ammunition', note: 'no magazine ever empties' },
  { id: 'nukeRain', label: 'Nuke rain', note: 'one falls on the city every few seconds' },
  { id: 'noDrones', label: 'No drones', note: 'they stop coming and the ones up leave' },
  { id: 'cinematic', label: 'Cinematic warheads', note: 'the camera follows one down and circles what is left' },
  { id: 'slowBlast', label: 'Slow motion blasts', note: 'the world drops to a crawl while something goes off' },
  { id: 'mechKillers', label: 'Machines carry mech killers', note: 'some of them get the EMP warhead as well, and it is meant for what you are standing in' },
  // The two destruction switches are the only ones here that start on,
  // because they are the game as it ships: a city that comes down is the
  // point of it. They are in the menu so that you can have the other half,
  // which is a Berlin that stays standing while you fight in it, and so that
  // a slow machine can be given one less thing to do.
  { id: 'wreckBuildings', label: 'Buildings can be destroyed', note: 'blasts cut frontages back and bring them down; off leaves the city standing', def: true },
  { id: 'wreckGround', label: 'Ground can be cratered', note: 'warheads dig a hole where they land; off keeps the street level', def: true },
  { id: 'lastKill', label: 'Slow motion on the last kill', note: 'killing the last one standing near you drops the world to a crawl for a moment' },
];

export const GORE = [
  { id: 'gib', label: 'Tear enemies apart', note: 'a killing hit takes them to pieces' },
  { id: 'ragdoll', label: 'Ragdoll', note: 'they fall with the momentum of the shot' },
  { id: 'blood', label: 'Blood', note: 'hits spray, and it lands on the street' },
  { id: 'ultraGore', label: 'Ultra gore', note: 'all of the above, considerably more of it' },
  { id: 'maxGore', label: 'Ultra gore, and then some', note: 'as much blood as the pools can hold and a shot that throws a body across the street; add the tearing switch and every piece the game owns comes with it' },
];

/**
 * What every switch is before anybody touches the menu. Nearly all of them
 * are off, and the two destruction switches are on, so "has this run been
 * cheated" is a comparison against this rather than a test for true.
 */
const DEFAULTS = {};
for (const id of KEYS) {
  const spec = SWITCHES.find((s) => s.id === id) || GORE.find((s) => s.id === id);
  DEFAULTS[id] = !!(spec && spec.def);
}

/** The one shot buttons. The handlers are wired up by the game layer. */
export const ACTIONS = [
  { id: 'allWeapons', label: 'All weapons', note: 'every magazine and every reserve, full' },
  { id: 'refill', label: 'Reload everything', note: 'top up what you are carrying' },
  { id: 'nuke', label: 'Drop a nuke', note: 'pick the target on the map' },
  { id: 'ion', label: 'Ion cannon', note: 'three beams, then the middle one' },
];

/** Bringing more of them out. Each button is one squad, flight or section. */
export const SPAWNS = [
  { id: 'soldiers', label: 'Soldiers', note: 'a section of six, in the streets around you', count: 6 },
  { id: 'drones', label: 'Drones', note: 'four, overhead', count: 4 },
  { id: 'jets', label: 'Jets', note: 'two, running in from half a kilometre', count: 2 },
  { id: 'reapers', label: 'Enemy mechs', note: 'two, eight metres of walking gun', count: 2 },
];

/**
 * Settings with a number behind them rather than a yes or a no.
 *
 * Each one has a plain default that is the game as it ships, so a menu nobody
 * has touched behaves exactly as it did before these existed. The warhead
 * radius is the obvious one to want bigger; the skeleton timer is the one
 * that decides whether a street full of burnt bones is a moment or a
 * monument, and zero means they stay.
 */
export const SETTINGS = [
  {
    id: 'nukeRadius', label: 'Warhead radius', unit: 'm',
    note: 'how far a warhead reaches, in metres',
    min: 60, max: 900, step: 10, def: 170,
  },
  {
    id: 'ionRadius', label: 'Ion cannon radius', unit: 'm',
    note: 'how much of the city the middle beam takes',
    min: 80, max: 900, step: 10, def: 210,
  },
  {
    id: 'mechKillerOdds', label: 'Machines with a mech killer', unit: '%',
    note: 'how many of them carry one, when they are allowed to at all',
    min: 5, max: 100, step: 5, def: 25,
  },
  {
    id: 'boneTime', label: 'Skeletons collapse after', unit: 's',
    note: 'a burnt body falls to pieces after this long; nought leaves them standing for good',
    min: 0, max: 120, step: 1, def: 18,
  },
];

/** Things to get into, parked where you are standing. */
export const RIDES = [
  { id: 'jeep', label: 'Jeep', note: 'fast, open, a gun on the back' },
  { id: 'tank', label: 'Tank', note: 'slow, hard to kill, one very large gun' },
  { id: 'heli', label: 'Helicopter', note: 'hovers; space climbs, right mouse drops rockets' },
  { id: 'jet', label: 'Fighter', note: 'arrives in the air with you in it; it will not fly below forty metres a second' },
  { id: 'titan', label: 'Mech', note: 'yours: five weapons, a rocket pod, a dash and a landing that opens the road' },
];

export class Cheats {
  constructor() {
    this.godmode = false;
    this.infiniteAmmo = false;
    this.nukeRain = false;
    this.noDrones = false;
    this.cinematic = false;
    this.slowBlast = false;
    this.mechKillers = false;
    this.wreckBuildings = true;
    this.wreckGround = true;
    this.gib = false;
    this.ragdoll = false;
    this.blood = false;
    this.ultraGore = false;
    this.maxGore = false;
    // The numeric settings, by id, starting at what the game ships with.
    this.values = {};
    for (const s of SETTINGS) this.values[s.id] = s.def;
    // Set the first time anything is switched on, and never cleared, so that
    // turning a cheat off again does not launder the run.
    this.used = false;
    this.onChange = null;
    this.load();
  }

  /** @returns {boolean} true when anything at all is on */
  get any() {
    return KEYS.some((id) => this[id] !== DEFAULTS[id]) || this.anyValue;
  }

  /**
   * How much of everything the gore settings ask for. Ultra gore is not a
   * fourth effect, it is a multiplier over the other three, which is both what
   * it means and the only way to make it feel like more rather than different.
   * The switch above it is the same multiplier again, set where the pools
   * run out: past this there is nothing left to spend.
   */
  get goreScale() {
    if (this.maxGore) return 7.5;
    return this.ultraGore ? 4.2 : 1;
  }

  /** True when a kill should come apart rather than fall over. */
  // Deliberately not the top switch. Coming apart is the absence of a death:
  // there is no body left to throw, so a switch whose whole point is the
  // throw cannot also be the one that takes the body away. Turn on the
  // tearing switch as well and you get both, with every piece the pool has.
  get gibbing() { return this.gib || this.ultraGore; }
  get bleeding() { return this.blood || this.ultraGore || this.maxGore; }
  get tumbling() { return this.ragdoll || this.ultraGore || this.maxGore; }

  set(id, on) {
    if (!(id in this) || typeof this[id] !== 'boolean') return false;
    this[id] = !!on;
    if (this[id] !== DEFAULTS[id]) this.used = true;
    this.save();
    if (this.onChange) this.onChange(id, this[id]);
    return true;
  }

  toggle(id) { return this.set(id, !this[id]); }

  /** What a numeric setting is on, which is its default until it is moved. */
  value(id) {
    const spec = SETTINGS.find((s) => s.id === id);
    if (!spec) return 0;
    const v = this.values[id];
    return Number.isFinite(v) ? v : spec.def;
  }

  /**
   * Move one. Anything away from the default marks the run, the same way a
   * switch does, because a warhead twice the size is not the game as given.
   *
   * @returns {boolean} whether the value was accepted
   */
  setValue(id, v) {
    const spec = SETTINGS.find((s) => s.id === id);
    if (!spec) return false;
    const n = Math.min(spec.max, Math.max(spec.min, Math.round(v / spec.step) * spec.step));
    this.values[id] = n;
    if (n !== spec.def) this.used = true;
    this.save();
    if (this.onChange) this.onChange(id, n);
    return true;
  }

  /** True when a setting has been moved off what the game ships with. */
  get anyValue() {
    return SETTINGS.some((s) => this.value(s.id) !== s.def);
  }

  /** Everything off. Does not clear the mark on the run. */
  reset() {
    for (const id of KEYS) this[id] = DEFAULTS[id];
    for (const s of SETTINGS) this.values[s.id] = s.def;
    this.save();
    if (this.onChange) this.onChange(null, false);
  }

  save() {
    try {
      const out = { values: this.values };
      for (const id of KEYS) out[id] = this[id];
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch { /* private mode, and it does not matter */ }
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      for (const id in saved) {
        if (id in this && typeof this[id] === 'boolean') this[id] = !!saved[id];
      }
      if (saved.values) {
        for (const s of SETTINGS) {
          const v = saved.values[s.id];
          if (Number.isFinite(v)) this.values[s.id] = Math.min(s.max, Math.max(s.min, v));
        }
      }
      if (this.any) this.used = true;
    } catch { /* a corrupt entry is not worth a crash */ }
  }
}
