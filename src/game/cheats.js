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

/** The switches, in the order the menu shows them. */
export const SWITCHES = [
  { id: 'godmode', label: 'God mode', note: 'nothing can hurt you' },
  { id: 'infiniteAmmo', label: 'Infinite ammunition', note: 'no magazine ever empties' },
  { id: 'nukeRain', label: 'Nuke rain', note: 'one falls on the city every few seconds' },
];

export const GORE = [
  { id: 'gib', label: 'Tear enemies apart', note: 'a killing hit takes them to pieces' },
  { id: 'ragdoll', label: 'Ragdoll', note: 'they fall with the momentum of the shot' },
  { id: 'blood', label: 'Blood', note: 'hits spray, and it lands on the street' },
  { id: 'ultraGore', label: 'Ultra gore', note: 'all of the above, considerably more of it' },
];

/** The one shot buttons. The handlers are wired up by the game layer. */
export const ACTIONS = [
  { id: 'allWeapons', label: 'All weapons', note: 'every magazine and every reserve, full' },
  { id: 'refill', label: 'Reload everything', note: 'top up what you are carrying' },
  { id: 'nuke', label: 'Drop a nuke', note: 'pick the target on the map' },
];

/** Bringing more of them out. Each button is one squad, flight or section. */
export const SPAWNS = [
  { id: 'soldiers', label: 'Soldiers', note: 'a section of six, in the streets around you', count: 6 },
  { id: 'drones', label: 'Drones', note: 'four, overhead', count: 4 },
  { id: 'jets', label: 'Jets', note: 'two, running in from half a kilometre', count: 2 },
];

export class Cheats {
  constructor() {
    this.godmode = false;
    this.infiniteAmmo = false;
    this.nukeRain = false;
    this.gib = false;
    this.ragdoll = false;
    this.blood = false;
    this.ultraGore = false;
    // Set the first time anything is switched on, and never cleared, so that
    // turning a cheat off again does not launder the run.
    this.used = false;
    this.onChange = null;
    this.load();
  }

  /** @returns {boolean} true when anything at all is on */
  get any() {
    return this.godmode || this.infiniteAmmo || this.nukeRain
      || this.gib || this.ragdoll || this.blood || this.ultraGore;
  }

  /**
   * How much of everything the gore settings ask for. Ultra gore is not a
   * fourth effect, it is a multiplier over the other three, which is both what
   * it means and the only way to make it feel like more rather than different.
   */
  get goreScale() { return this.ultraGore ? 4.2 : 1; }

  /** True when a kill should come apart rather than fall over. */
  get gibbing() { return this.gib || this.ultraGore; }
  get bleeding() { return this.blood || this.ultraGore; }
  get tumbling() { return this.ragdoll || this.ultraGore; }

  set(id, on) {
    if (!(id in this) || typeof this[id] !== 'boolean') return false;
    this[id] = !!on;
    if (this[id]) this.used = true;
    this.save();
    if (this.onChange) this.onChange(id, this[id]);
    return true;
  }

  toggle(id) { return this.set(id, !this[id]); }

  /** Everything off. Does not clear the mark on the run. */
  reset() {
    for (const id of ['godmode', 'infiniteAmmo', 'nukeRain', 'gib', 'ragdoll',
      'blood', 'ultraGore']) this[id] = false;
    this.save();
    if (this.onChange) this.onChange(null, false);
  }

  save() {
    try {
      const out = {};
      for (const id of ['godmode', 'infiniteAmmo', 'nukeRain', 'gib', 'ragdoll',
        'blood', 'ultraGore']) out[id] = this[id];
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
      if (this.any) this.used = true;
    } catch { /* a corrupt entry is not worth a crash */ }
  }
}
