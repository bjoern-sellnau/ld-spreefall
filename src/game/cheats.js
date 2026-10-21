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

import { CHASSIS, chassisById, mechKey } from './chassis.js';
import { ULTRA, VOID_STORM, clampUltra } from './ultra.js';

const KEY = 'spreefall.cheats';

/**
 * The gore multiplier at the overkill setting. The pools it draws on were
 * made larger for it, so this is what they now hold rather than a number
 * that runs into a ceiling and stops meaning anything.
 */
export const OVERKILL_SCALE = 12;

/** Every switch, in one list, so saving and clearing cannot miss one. */
const KEYS = ['godmode', 'infiniteAmmo', 'everyWeapon', 'nukeRain', 'noDrones', 'cinematic',
  'slowBlast', 'mechKillers', 'wreckBuildings', 'wreckGround', 'lastKill', 'showDamage',
  'gib', 'ragdoll', 'blood', 'ultraGore', 'maxGore', 'overkill', 'comicGore'];

/** The switches, in the order the menu shows them. */
export const SWITCHES = [
  { id: 'godmode', label: 'God mode', note: 'nothing can hurt you' },
  { id: 'infiniteAmmo', label: 'Infinite ammunition', note: 'no magazine ever empties' },
  { id: 'everyWeapon', label: 'Every weapon in every mode', note: 'Tactics and Slayer keep their number row, and the wheel goes through every weapon the game has, loaded' },
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
  { id: 'showDamage', label: 'Show what a building has left', note: 'what the frontage you are aiming at has taken, and how much more it takes to bring it down' },
];

export const GORE = [
  { id: 'gib', label: 'Tear enemies apart', note: 'a killing hit takes them to pieces' },
  { id: 'ragdoll', label: 'Ragdoll', note: 'they fall with the momentum of the shot' },
  { id: 'blood', label: 'Blood', note: 'hits spray, and it lands on the street' },
  { id: 'ultraGore', label: 'Ultra gore', note: 'all of the above, considerably more of it' },
  { id: 'maxGore', label: 'Ultra gore, and then some', note: 'as much blood as the pools can hold and a shot that throws a body across the street; add the tearing switch and every piece the game owns comes with it' },
  // Past the top, and on purpose out of proportion: the fighting games that
  // put a word across the screen when somebody is finished. Every kill comes
  // apart, the skeleton leaves the body, pieces go up and rain down for a
  // second or two, and a fountain stands where they were.
  { id: 'overkill', label: 'Overkill', note: 'every kill an execution: the skeleton leaves the body, pieces rain down, a fountain stands where they were and a word goes across the screen' },
  // And past that, on purpose a cartoon: blood the red of a comic book,
  // gushing from every hit and raining after every kill, heads that pop, a
  // splash on the screen when it happens close, and the word in yellow.
  { id: 'comicGore', label: 'Comic carnage', note: 'overkill drawn as a comic book: bright red blood by the bucket from every hit, heads that pop, blood rain, splashes on the screen and the word in yellow' },
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
  { id: 'ultra', label: 'Ultra plasma', note: 'a rain of plasma from orbit: as many as you like, as wide as you like, from where you like' },
  { id: 'storm', label: 'Void storm', note: 'the void cannon\'s ball, from orbit, by the dozen' },
];

/** Bringing more of them out. Each button is one squad, flight or section. */
export const SPAWNS = [
  { id: 'soldiers', label: 'Soldiers', note: 'a section of six, in the streets around you', count: 6 },
  { id: 'drones', label: 'Drones', note: 'four, overhead', count: 4 },
  { id: 'jets', label: 'Jets', note: 'two, running in from half a kilometre', count: 2 },
  { id: 'reapers', label: 'Enemy mechs', note: 'two, eight metres of walking gun', count: 2 },
  { id: 'machines', label: 'Machines', note: 'six of them, steel under the skin and a beam rifle each', count: 6 },
  { id: 'civilians', label: 'Passers by', note: 'eight people on their way somewhere, who run from a shot', count: 8 },
  { id: 'demons', label: 'Demons', note: 'a pack: ghouls that throw fire, a brute that charges, a gazer overhead', count: 7 },
  { id: 'warlord', label: 'Warlord', note: 'Slayer\'s great boss: nine metres, a rocket arm, a heart to aim at', count: 1 },
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
    // Every switch, at what it is before anybody touches the menu. Built out
    // of the list rather than written out one by one, and that is not tidiness:
    // `set` refuses an id it cannot find a boolean behind, so a switch that
    // was in the list and not in the constructor could not be turned on at
    // all. Its row in the menu did nothing, and it only came alive after
    // pressing all off once, which is what reset does. The last kill spent a
    // day like that.
    for (const id of KEYS) this[id] = DEFAULTS[id];
    // The numeric settings, by id, starting at what the game ships with.
    this.values = {};
    for (const s of SETTINGS) this.values[s.id] = s.def;
    // Which mech you are sent, and which of theirs come for you. A choice
    // rather than a cheat: it does not mark the run, and all off leaves it
    // where you put it.
    this.mechs = { mine: CHASSIS[0].id, foe: CHASSIS[0].id };
    // Ultra plasma: how many, how wide, from which way and how steep. Kept
    // with the choices rather than the switches, for the same reason.
    this.ultra = { ...ULTRA.defaults };
    // And the void storm's, the same four.
    this.storm = { ...VOID_STORM.defaults };
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
    if (this.overkill || this.comicGore) return OVERKILL_SCALE;
    if (this.maxGore) return 7.5;
    return this.ultraGore ? 4.2 : 1;
  }

  /** True when a kill should come apart rather than fall over. */
  // Deliberately not the top switch. Coming apart is the absence of a death:
  // there is no body left to throw, so a switch whose whole point is the
  // throw cannot also be the one that takes the body away. Turn on the
  // tearing switch as well and you get both, with every piece the pool has.
  // Overkill takes all three: it is the one switch where nobody is left
  // lying in the street in one piece.
  get gibbing() { return this.gib || this.ultraGore || this.overkill || this.comicGore; }
  get bleeding() { return this.blood || this.ultraGore || this.maxGore || this.overkill || this.comicGore; }
  get tumbling() { return this.ragdoll || this.ultraGore || this.maxGore || this.overkill || this.comicGore; }
  /** Every kill an execution: overkill, or the comic book version of it. */
  get excess() { return this.overkill || this.comicGore; }

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

  /**
   * Pick a chassis for one side. Theirs may also be 'random', which is a
   * new throw of the dice for every one that arrives.
   *
   * @param {'mine'|'foe'} side
   * @returns {boolean} whether it was one there is
   */
  chooseMech(side, id) {
    if (side !== 'mine' && side !== 'foe') return false;
    const ok = CHASSIS.some((c) => c.id === id) || (side === 'foe' && id === 'random');
    if (!ok) return false;
    this.mechs[side] = id;
    this.save();
    if (this.onChange) this.onChange(`mech:${side}`, id);
    return true;
  }

  /** Set one of ultra plasma's four numbers, held to what it may be. */
  setUltra(key, v) {
    if (!(key in ULTRA.defaults)) return false;
    this.ultra[key] = clampUltra(key, v);
    this.save();
    return true;
  }

  /** And the void storm's. */
  setStorm(key, v) {
    if (!(key in VOID_STORM.defaults)) return false;
    this.storm[key] = clampUltra(key, v, VOID_STORM);
    this.save();
    return true;
  }

  /** The mech table key for the next one of yours to come down. */
  myMech() { return mechKey(this.mechs.mine, true); }

  /** And for the next one of theirs, thrown again each time when random. */
  foeMech(rand = Math.random) {
    const id = this.mechs.foe === 'random'
      ? CHASSIS[Math.floor(rand() * CHASSIS.length) % CHASSIS.length].id
      : chassisById(this.mechs.foe).id;
    return mechKey(id, false);
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
      const out = { values: this.values, mechs: this.mechs, ultra: this.ultra, storm: this.storm };
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
      if (saved.ultra) {
        for (const k of Object.keys(ULTRA.defaults)) {
          if (saved.ultra[k] !== undefined) this.ultra[k] = clampUltra(k, saved.ultra[k]);
        }
      }
      if (saved.storm) {
        for (const k of Object.keys(VOID_STORM.defaults)) {
          if (saved.storm[k] !== undefined) this.storm[k] = clampUltra(k, saved.storm[k], VOID_STORM);
        }
      }
      if (saved.mechs) {
        if (CHASSIS.some((c) => c.id === saved.mechs.mine)) this.mechs.mine = saved.mechs.mine;
        if (saved.mechs.foe === 'random' || CHASSIS.some((c) => c.id === saved.mechs.foe)) {
          this.mechs.foe = saved.mechs.foe;
        }
      }
      if (this.any) this.used = true;
    } catch { /* a corrupt entry is not worth a crash */ }
  }
}
