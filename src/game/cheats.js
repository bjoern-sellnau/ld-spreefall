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
/** For good, in seconds: longer than anybody plays, and still a number. */
export const FOREVER = 1e9;

/**
 * The gore multiplier at the overkill setting. The pools it draws on were
 * made larger for it, so this is what they now hold rather than a number
 * that runs into a ceiling and stops meaning anything.
 */
export const OVERKILL_SCALE = 12;
/** And ultra comical gore, past that: the pools were made bigger again for it. */
export const ULTRA_COMIC_SCALE = 18;

/** Every switch, in one list, so saving and clearing cannot miss one. */
const KEYS = ['godmode', 'infiniteAmmo', 'everyWeapon', 'nukeRain', 'noDrones', 'cinematic',
  'slowBlast', 'mechKillers', 'wreckBuildings', 'wreckGround', 'lastKill', 'showDamage',
  'gib', 'ragdoll', 'blood', 'ultraGore', 'maxGore', 'overkill', 'comicGore',
  'ultraComic', 'footprints', 'piecesForever', 'goreBudget',
  'extremeEnemies', 'crazyReality', 'oneManArmy', 'nightmare'];

/** The switches, in the order the menu shows them. */
export const SWITCHES = [
  { id: 'godmode', label: 'God mode', note: 'nothing can hurt you', help: 'Nothing takes your health or your shield: no shot, blast, fall, fire or weather.' },
  { id: 'infiniteAmmo', label: 'Infinite ammunition', note: 'no magazine ever empties', help: 'Magazines never run dry and nothing has to be reloaded.' },
  { id: 'everyWeapon', label: 'Every weapon in every mode', note: 'Tactics and Slayer keep their number row, and the wheel goes through every weapon the game has, loaded', help: 'Tactics and Slayer keep their own weapons on the number row, and the weapon wheel offers every weapon in the game, loaded.' },
  { id: 'nukeRain', label: 'Nuke rain', note: 'one falls on the city every few seconds', help: 'A warhead comes down somewhere in the city every few seconds for as long as it is on, with the warhead radius set below.' },
  { id: 'noDrones', label: 'No drones', note: 'they stop coming and the ones up leave', help: 'No more drones are sent, and the ones in the air fly off.' },
  { id: 'cinematic', label: 'Cinematic warheads', note: 'the camera follows one down and circles what is left', help: 'When a warhead falls the camera follows it down and circles what is left; space takes you back.' },
  { id: 'slowBlast', label: 'Slow motion blasts', note: 'the world drops to a crawl while something goes off', help: 'The world slows to a crawl for a moment while something big goes off near you.' },
  { id: 'mechKillers', label: 'Machines carry mech killers', note: 'some of them get the EMP warhead as well, and it is meant for what you are standing in', help: 'Some of the machines carry the EMP mech killer warhead, meant for the mech you are in; how many is the setting below.' },
  // The two destruction switches are the only ones here that start on,
  // because they are the game as it ships: a city that comes down is the
  // point of it. They are in the menu so that you can have the other half,
  // which is a Berlin that stays standing while you fight in it, and so that
  // a slow machine can be given one less thing to do.
  { id: 'wreckBuildings', label: 'Buildings can be destroyed', note: 'blasts cut frontages back and bring them down; off leaves the city standing', def: true, help: 'On as the game ships: blasts cut frontages back and bring buildings down. Off leaves the city standing whatever hits it.' },
  { id: 'wreckGround', label: 'Ground can be cratered', note: 'warheads dig a hole where they land; off keeps the street level', def: true, help: 'On as the game ships: warheads dig a crater where they land. Off keeps the street level.' },
  { id: 'lastKill', label: 'Slow motion on the last kill', note: 'killing the last one standing near you drops the world to a crawl for a moment', help: 'Killing the last enemy standing near you slows the world for a moment.' },
  { id: 'showDamage', label: 'Show what a building has left', note: 'what the frontage you are aiming at has taken, and how much more it takes to bring it down', help: 'Shows what the frontage under the crosshair has taken, and how much more brings it down.' },
  // Help that does not stop coming: a camp or a hunting ground that calls
  // for it gets as many waves as the setting below says, bigger and closer
  // together, and a nest in Slayer as many waves of demons.
  { id: 'extremeEnemies', label: 'Extreme enemies', note: 'a call for help brings wave after wave of it, as many as the setting says; a Slayer nest holds that many waves too', help: 'A call for help brings wave after wave of it, as many as the waves setting below, and a Slayer nest holds that many waves of demons.' },
  // The screen as a lens you are looking through: dust off every blast near
  // you, blood when you are hit or something dies close, soot from fire.
  { id: 'crazyReality', label: 'Crazy reality', note: 'the screen gets dirty: dust off blasts near you, blood when you are hit or a kill is close, soot from fire; it clears slowly', help: 'The screen gets dirty like a lens: dust from blasts near you, blood when you are hit or a kill is close, soot from fire. It clears slowly; in a mech only the glass gets dirty.' },
  // Everything against you, and more of it every wave.
  { id: 'oneManArmy', label: 'One Man Army', note: 'wave after wave, each worse than the last: squads, jeeps, a tank, mechs that get heavier, bombs, jets, bigger armies', help: 'Everything against you, in waves, each worse than the last: squads, jeeps, a tank, heavier mechs, bombs, jets and bigger armies.' },
  // And the city's own super weapons on their side too.
  { id: 'nightmare', label: 'Nightmare', note: 'One Man Army, and from the third wave the ion cannon, ultra plasma, a void storm and a warhead come down near you in turn', help: 'One Man Army, and from the third wave the ion cannon, ultra plasma, a void storm and a warhead come down near you in turn.' },
];

export const GORE = [
  { id: 'gib', label: 'Tear enemies apart', note: 'a killing hit takes them to pieces', help: 'A killing hit takes a body to pieces.' },
  { id: 'ragdoll', label: 'Ragdoll', note: 'they fall with the momentum of the shot', help: 'Bodies fall with the push of the shot that killed them instead of a set fall.' },
  { id: 'blood', label: 'Blood', note: 'hits spray, and it lands on the street', help: 'Hits spray blood, and it lands on the street and stays there a while.' },
  { id: 'ultraGore', label: 'Ultra gore', note: 'all of the above, considerably more of it', help: 'Tearing, ragdoll and blood together, with considerably more of each.' },
  { id: 'maxGore', label: 'Ultra gore, and then some', note: 'as much blood as the pools can hold and a shot that throws a body across the street; add the tearing switch and every piece the game owns comes with it', help: 'As much blood as the pools hold, and a shot throws a body across the street; with tearing on as well, every piece the game owns comes with it.' },
  // Past the top, and on purpose out of proportion: the fighting games that
  // put a word across the screen when somebody is finished. Every kill comes
  // apart, the skeleton leaves the body, pieces go up and rain down for a
  // second or two, and a fountain stands where they were.
  { id: 'overkill', label: 'Overkill', note: 'every kill an execution: the skeleton leaves the body, pieces rain down, a fountain stands where they were and a word goes across the screen', help: 'Every kill an execution in the manner of the fighting games: the skeleton leaves the body, pieces rain down, a fountain stands and a word goes across the screen.' },
  // And past that, on purpose a cartoon: blood the red of a comic book,
  // gushing from every hit and raining after every kill, heads that pop, a
  // splash on the screen when it happens close, and the word in yellow.
  { id: 'comicGore', label: 'Comic carnage', note: 'overkill drawn as a comic book: bright red blood by the bucket from every hit, heads that pop, blood rain, splashes on the screen and the word in yellow', help: 'Overkill drawn as a comic book: bright red blood by the bucket, heads that pop, blood rain, splashes on the screen and the word in yellow.' },
  // And past the comic book, for anybody who wants it absurd: more blood
  // than makes any sense, a body in a great many more pieces, every one of
  // them landing with a splat and staying where it lands, and a squelch
  // underfoot when you walk through it.
  { id: 'ultraComic', label: 'Ultra comical gore', note: 'comic carnage past all sense: far more blood, bodies in many more pieces that splat when they land and stay where they fall, and a squelch when you walk through it', help: 'Comic carnage past all sense: far more blood, bodies in many more pieces that splat and stay where they land, and a squelch underfoot.' },
  { id: 'footprints', label: 'Red footprints', note: 'walk through blood and you leave red footprints for a while, and so does anybody else who walks through it', help: 'Walking through blood leaves red footprints for a while, yours and everybody else who walks through it.' },
  // How long the pieces lie there, and what to do about it on a slow machine.
  { id: 'piecesForever', label: 'Pieces stay for good', note: 'with ultra comical gore, what is left of them lies there for good; off, it goes after the time set below', def: true, help: 'With ultra comical gore, the pieces lie there for good. Off, they go after the time set under numbers you can turn.' },
  { id: 'goreBudget', label: 'Performance limit', note: 'while the frame rate is under the limit set below, the pieces, pools and footprints lying about are cleared, oldest first', help: 'While the frame rate is under the limit set below, the pieces, pools and footprints lying about are cleared, oldest first, to keep the game smooth.' },
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
  { id: 'allWeapons', label: 'All weapons', note: 'every magazine and every reserve, full', help: 'Fills every magazine and every reserve of every weapon you can carry, at once.' },
  { id: 'refill', label: 'Reload everything', note: 'top up what you are carrying', help: 'Tops up the magazines and reserves of what you are carrying now, without adding weapons.' },
  { id: 'nuke', label: 'Drop a nuke', note: 'pick the target on the map', help: 'Opens the target map: click a place, check the confirmation and release. A warhead with the radius set below comes down there.' },
  { id: 'ion', label: 'Ion cannon', note: 'three beams, then the middle one', help: 'Opens the target map for the ion cannon: three beams walk in, then the middle one burns out a circle as wide as the ion cannon radius below.' },
  { id: 'ultra', label: 'Ultra plasma', note: 'a rain of plasma from orbit: as many as you like, as wide as you like, from where you like', help: 'Opens the target map with the ultra plasma panel: how many balls, how wide they spread and where they come from, then the target.' },
  { id: 'storm', label: 'Void storm', note: 'the void cannon\'s ball, from orbit, by the dozen', help: 'Opens the target map for a void storm: the void cannon ball dropped from orbit by the dozen on the place you pick.' },
];

/** Bringing more of them out. Each button is one squad, flight or section. */
export const SPAWNS = [
  { id: 'soldiers', label: 'Soldiers', note: 'a section of six, in the streets around you', count: 6, help: 'A section of six hostile soldiers in the streets round you.' },
  { id: 'drones', label: 'Drones', note: 'four, overhead', count: 4, help: 'Four armed drones overhead that hunt you.' },
  { id: 'jets', label: 'Jets', note: 'two, running in from half a kilometre', count: 2, help: 'Two fighter jets that run in from half a kilometre and strafe the street.' },
  { id: 'reapers', label: 'Enemy mechs', note: 'two, eight metres of walking gun', count: 2, help: 'Two enemy mechs, eight metres tall, of the chassis picked under their mechs.' },
  { id: 'machines', label: 'Machines', note: 'six of them, steel under the skin and a beam rifle each', count: 6, help: 'Six machines out of Rise of the Machines: steel under the skin, each with a beam rifle, some with a mech killer if that switch is on.' },
  { id: 'civilians', label: 'Passers by', note: 'eight people on their way somewhere, who run from a shot', count: 8, help: 'Eight passers by who walk about and run from gunfire. They are no threat.' },
  { id: 'demons', label: 'Demons', note: 'a pack: ghouls that throw fire, a brute that charges, a gazer overhead', count: 7, help: 'A pack from Slayer: ghouls that throw fire, a brute that charges and a gazer that floats overhead.' },
  { id: 'warlord', label: 'Warlord', note: 'Slayer\'s great boss: nine metres, a rocket arm, a heart to aim at', count: 1, help: 'Slayer\'s great boss, nine metres tall with a rocket arm; aim for the glowing heart.' },
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
    help: 'How far a warhead from this menu or from nuke rain reaches: what is inside burns or comes down, and the crater grows with it.',
    min: 60, max: 900, step: 10, def: 170,
  },
  {
    id: 'ionRadius', label: 'Ion cannon radius', unit: 'm',
    note: 'how much of the city the middle beam takes',
    help: 'How much of the city the middle beam of the ion cannon takes.',
    min: 80, max: 900, step: 10, def: 210,
  },
  {
    id: 'mechKillerOdds', label: 'Machines with a mech killer', unit: '%',
    note: 'how many of them carry one, when they are allowed to at all',
    help: 'With machines carry mech killers on, the share of machines that carry one.',
    min: 5, max: 100, step: 5, def: 25,
  },
  {
    // How many waves extreme enemies sends. The box beside the slider takes
    // a number typed in, for the same range.
    id: 'extremeWaves', label: 'Extreme enemies: waves', unit: 'waves',
    note: 'how many waves of help a call brings with extreme enemies on, and how many a Slayer nest holds',
    help: 'With extreme enemies on, how many waves of help a call brings and how many waves a Slayer nest holds. The box beside it takes a typed number.',
    min: 1, max: 50, step: 1, def: 6, box: true,
  },
  {
    id: 'boneTime', label: 'Skeletons collapse after', unit: 's',
    note: 'a burnt body falls to pieces after this long; nought leaves them standing for good',
    help: 'How long a body burnt to a skeleton stands before it falls to pieces; nought leaves them standing for good.',
    min: 0, max: 120, step: 1, def: 18,
  },
  {
    id: 'pieceTime', label: 'Pieces stay for', unit: 's',
    note: 'how long what is left of a body lies there with ultra comical gore, when it does not stay for good',
    help: 'With ultra comical gore on and pieces stay for good off, how long the pieces of a body lie in the street.',
    min: 5, max: 600, step: 5, def: 90,
  },
  {
    id: 'fpsFloor', label: 'Performance limit', unit: 'fps',
    note: 'with the performance limit on, under this many frames a second what is lying about is cleared',
    help: 'With the performance limit switch on: under this many frames a second, what is lying about is cleared, oldest first.',
    min: 10, max: 60, step: 1, def: 30,
  },
];

/**
 * The two bows, and which one is in your hands. By mode is the tech bow in
 * The Hunt, where it belongs to the suit, and the tactic bow everywhere
 * else. A choice, like the mechs: it does not mark the run.
 */
export const BOWS = [
  { id: 'mode', label: 'By mode', note: 'the tech bow in The Hunt, the tactic bow everywhere else', help: 'The bow goes with the mode: the Tech Bow in The Hunt, where it belongs to the suit, the Tactic Bow everywhere else.' },
  { id: 'tech', label: 'Tech Bow', note: 'a compound bow in black carbon with cams at the tips and a light down the riser', help: 'Always the Tech Bow: a black carbon compound bow with cams at the tips and a light down the riser.' },
  { id: 'tactic', label: 'Tactic Bow', note: 'a takedown recurve in olive and black with a two pin sight', help: 'Always the Tactic Bow: an olive and black takedown recurve with a two pin sight.' },
];

/** How either bow is held: on its side with the arrow on top, or upright. */
export const BOW_HOLDS = [
  { id: 'flat', label: 'Held flat', note: 'on its side under the crosshair, the arrow lying on top of it', help: 'The bow lies on its side under the crosshair with the arrow on top of it.' },
  { id: 'upright', label: 'Held upright', note: 'upright in the left hand, left of the crosshair', help: 'The bow stands upright in the left hand, to the left of the crosshair.' },
];

/** Things to get into, parked where you are standing. */
export const RIDES = [
  { id: 'jeep', label: 'Jeep', note: 'fast, open, a gun on the back', help: 'A jeep parked beside you: fast and open, with a gun on the back. F gets in and out.' },
  { id: 'tank', label: 'Tank', note: 'slow, hard to kill, one very large gun', help: 'A tank parked beside you: slow and hard to kill, one big gun, the turret follows the mouse. F to get in.' },
  { id: 'heli', label: 'Helicopter', note: 'hovers; space climbs, right mouse drops rockets', help: 'A helicopter: it hovers, space climbs, the right mouse button drops rockets. F to get in.' },
  { id: 'jet', label: 'Fighter', note: 'arrives in the air with you in it; it will not fly below forty metres a second', help: 'A fighter that starts in the air with you in it; it flies where you look and will not go below forty metres a second.' },
  { id: 'titan', label: 'Mech', note: 'yours: five weapons, a rocket pod, a dash and a landing that opens the road', help: 'Your own mech, the chassis picked under your mech, dropped from orbit: it lands in half a minute and opens the road where it lands. F to climb in.' },
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
    // Which bow: by mode, or one of the two whatever the mode.
    this.bow = 'mode';
    // And how it is held.
    this.bowHold = 'flat';
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
    if (this.ultraComic) return ULTRA_COMIC_SCALE;
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
  get gibbing() { return this.gib || this.ultraGore || this.overkill || this.comical; }
  get bleeding() { return this.blood || this.ultraGore || this.maxGore || this.overkill || this.comical; }
  get tumbling() { return this.ragdoll || this.ultraGore || this.maxGore || this.overkill || this.comical; }
  /** Every kill an execution: overkill, or the comic book version of it. */
  get excess() { return this.overkill || this.comical; }
  /** The comic book, or the one past it. */
  get comical() { return this.comicGore || this.ultraComic; }
  /**
   * How long a piece of somebody lies where it fell, in seconds: nought for
   * as long as it always has, which is ultra comical gore off.
   */
  get pieceLife() {
    if (!this.ultraComic) return 0;
    return this.piecesForever ? FOREVER : this.value('pieceTime');
  }

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

  /** Pick a bow. @returns {boolean} whether it was one there is */
  chooseBow(id) {
    if (!BOWS.some((b) => b.id === id)) return false;
    this.bow = id;
    this.save();
    if (this.onChange) this.onChange('bow', id);
    return true;
  }

  /** Hold the bow flat or upright. @returns {boolean} whether it was one there is */
  chooseBowHold(id) {
    if (!BOW_HOLDS.some((b) => b.id === id)) return false;
    this.bowHold = id;
    this.save();
    if (this.onChange) this.onChange('bowHold', id);
    return true;
  }

  /** Which of the two bows is in your hands in this mode. */
  bowFor(mode) {
    if (this.bow === 'tech' || this.bow === 'tactic') return this.bow;
    return mode === 'hunt' ? 'tech' : 'tactic';
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
      const out = { values: this.values, mechs: this.mechs, ultra: this.ultra, storm: this.storm, bow: this.bow, bowHold: this.bowHold };
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
      if (saved.bow && BOWS.some((b) => b.id === saved.bow)) this.bow = saved.bow;
      if (saved.bowHold && BOW_HOLDS.some((b) => b.id === saved.bowHold)) this.bowHold = saved.bowHold;
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
