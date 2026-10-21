// Operations: the two campaigns played across the real city.
//
// Tactics puts armed camps in the districts, to be taken one at a time, and
// pays more for a camp taken without anybody raising the alarm. Slayer puts
// nests of demons in them instead, and a district is free when the presence
// in it has been killed off. Both are the same thing underneath: a few sites
// per district, placed on open ground the first time the district is in
// memory, held or freed, kept in the browser so a campaign outlives a reload,
// and played either in the one district you start in or across all of them.
//
// The idea of a map of outposts to liberate quietly, and of arenas that fill
// with demons in waves, belongs to the genres those two games made. The names,
// the numbers and the city are ours.

export const SITE = { HELD: 0, FREE: 1 };

export const OPS = {
  tactics: {
    name: 'Spree Fall Tactics',
    site: 'camp',
    // How many to a district, and how far apart, in metres.
    perDistrict: 4,
    perDistrictRange: [1, 8],
    spacing: 170,
    // The clear ground a camp is put down on: nothing within this of the
    // middle at chest height, in eight directions.
    clear: 13,
    radius: 16,
    // What a camp is worth, and what taking it without an alarm adds.
    points: 1000,
    quietBonus: 1500,
    // And per level of difficulty a camp has been reset to.
    perLevel: 400,
  },
  slayer: {
    name: 'Spree Fall Slayer',
    site: 'nest',
    perDistrict: 3,
    perDistrictRange: [1, 8],
    spacing: 220,
    clear: 16,
    radius: 26,
    points: 1500,
    quietBonus: 0,
    perLevel: 600,
  },
};

const KEY = 'spreefall.ops.v1';

/** A small seeded generator, so a district's sites land where they landed last time. */
export function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blankBook() {
  return { score: 0, level: 0, taken: 0, quiet: 0, sites: {} };
}

export class Campaign {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.storage = storage;
    this.mode = null;
    this.settings = {
      scope: 'district',     // 'district' or 'all'
      start: null,           // the district id you start in, and the one played in 'district'
      quietBonus: true,      // Tactics: pay extra for a camp taken without an alarm
      bosses: true,          // Slayer: a boss in the last nest of a district
      perDistrict: { tactics: OPS.tactics.perDistrict, slayer: OPS.slayer.perDistrict },
    };
    this.books = { tactics: blankBook(), slayer: blankBook() };
    this.onChange = null;
    this.load();
  }

  get active() { return this.mode === 'tactics' || this.mode === 'slayer'; }
  get spec() { return this.active ? OPS[this.mode] : null; }
  get book() { return this.active ? this.books[this.mode] : null; }

  setMode(mode) {
    this.mode = mode === 'tactics' || mode === 'slayer' ? mode : null;
    this.save();
  }

  set(key, value) {
    if (key === 'scope') this.settings.scope = value === 'all' ? 'all' : 'district';
    else if (key === 'start') this.settings.start = value || null;
    else if (key === 'quietBonus') this.settings.quietBonus = !!value;
    else if (key === 'bosses') this.settings.bosses = !!value;
    else if (key === 'perDistrict' && this.active) {
      const [lo, hi] = OPS[this.mode].perDistrictRange;
      const n = Math.round(Number(value));
      if (Number.isFinite(n)) this.settings.perDistrict[this.mode] = Math.max(lo, Math.min(hi, n));
    } else return false;
    this.save();
    return true;
  }

  /** Whether a district counts in the campaign as it is set up. */
  inScope(districtId) {
    if (!this.active || !districtId) return false;
    return this.settings.scope === 'all' || !this.settings.start || districtId === this.settings.start;
  }

  /** The sites already placed in a district, or null if it has not been visited. */
  sitesIn(districtId) {
    const b = this.book;
    return b && b.sites[districtId] ? b.sites[districtId] : null;
  }

  /**
   * Put a district's sites down, the first time it is in memory. The finder
   * is the game layer's: it knows the ground. It is handed a seeded random
   * source and asked for a candidate, and anything too close to a site
   * already taken is passed over.
   *
   * @param {string} districtId
   * @param {(rand:()=>number, clear:number)=>{x:number,z:number}|null} find
   * @returns {Array} the sites, new or as they were
   */
  place(districtId, find) {
    const b = this.book;
    if (!b || !this.inScope(districtId)) return [];
    if (b.sites[districtId]) return b.sites[districtId];
    const spec = this.spec;
    const want = this.settings.perDistrict[this.mode];
    const rand = seeded(`${this.mode}:${districtId}`);
    const out = [];
    // Ask for the full clearance first and give some of it up if the
    // district is too built up to have that many squares that open.
    for (const clear of [spec.clear, spec.clear * 0.75, spec.clear * 0.55]) {
      for (let tries = 0; tries < 260 && out.length < want; tries++) {
        const c = find(rand, clear);
        if (!c) continue;
        if (out.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < spec.spacing)) continue;
        out.push({
          id: `${districtId}:${out.length}`,
          d: districtId,
          x: Math.round(c.x * 10) / 10,
          z: Math.round(c.z * 10) / 10,
          yaw: Math.round(rand() * 628) / 100,
          level: b.level,
          state: SITE.HELD,
        });
      }
      if (out.length >= want) break;
    }
    b.sites[districtId] = out;
    this.save();
    return out;
  }

  /** Every site placed so far, in scope. */
  allSites() {
    const b = this.book;
    if (!b) return [];
    const out = [];
    for (const id of Object.keys(b.sites)) {
      if (!this.inScope(id)) continue;
      for (const s of b.sites[id]) out.push(s);
    }
    return out;
  }

  /**
   * A site taken. What it is worth: the base, its level, and for Tactics the
   * bonus for nobody having raised the alarm, when that is switched on.
   *
   * @returns {number} the points it paid
   */
  free(site, { quiet = false } = {}) {
    const b = this.book;
    if (!b || site.state === SITE.FREE) return 0;
    const spec = this.spec;
    site.state = SITE.FREE;
    let pts = spec.points + spec.perLevel * (site.level || 0);
    if (quiet && spec.quietBonus && this.settings.quietBonus) {
      pts += spec.quietBonus;
      b.quiet++;
    }
    b.score += pts;
    b.taken++;
    this.save();
    if (this.onChange) this.onChange('free', site, pts);
    return pts;
  }

  /**
   * Put the sites back in enemy hands: all of them, or the ones in one
   * district. Harder raises the level they come back at.
   */
  reset({ harder = false, district = null } = {}) {
    const b = this.book;
    if (!b) return 0;
    if (harder) b.level++;
    let n = 0;
    for (const id of Object.keys(b.sites)) {
      if (district && id !== district) continue;
      for (const s of b.sites[id]) {
        s.state = SITE.HELD;
        s.level = b.level;
        n++;
      }
    }
    this.save();
    if (this.onChange) this.onChange('reset', null, n);
    return n;
  }

  /** Forget everything for this campaign: sites, score and level. */
  wipe() {
    if (!this.active) return;
    this.books[this.mode] = blankBook();
    this.save();
    if (this.onChange) this.onChange('wipe', null, 0);
  }

  /**
   * How far along: sites free of the ones placed, and districts finished of
   * the ones in scope. A district nobody has been to yet is not finished.
   *
   * @param {string[]} builtIds every district there is to play in
   */
  summary(builtIds = []) {
    const b = this.book;
    if (!b) return null;
    let free = 0, total = 0;
    for (const s of this.allSites()) { total++; if (s.state === SITE.FREE) free++; }
    const scope = this.settings.scope === 'all' ? builtIds
      : (this.settings.start ? [this.settings.start] : builtIds.slice(0, 1));
    let done = 0;
    for (const id of scope) {
      const list = b.sites[id];
      if (list && list.length && list.every((s) => s.state === SITE.FREE)) done++;
    }
    return { free, total, done, districts: scope.length, score: b.score, level: b.level, quiet: b.quiet };
  }

  save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(KEY, JSON.stringify({ mode: this.mode, settings: this.settings, books: this.books }));
    } catch { /* private mode: the campaign lasts the session */ }
  }

  load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.mode === 'tactics' || s.mode === 'slayer') this.mode = s.mode;
      if (s.settings) {
        if (s.settings.scope) this.settings.scope = s.settings.scope === 'all' ? 'all' : 'district';
        if (typeof s.settings.start === 'string') this.settings.start = s.settings.start;
        if (s.settings.quietBonus !== undefined) this.settings.quietBonus = !!s.settings.quietBonus;
        if (s.settings.bosses !== undefined) this.settings.bosses = !!s.settings.bosses;
        if (s.settings.perDistrict) {
          for (const m of ['tactics', 'slayer']) {
            const n = Number(s.settings.perDistrict[m]);
            const [lo, hi] = OPS[m].perDistrictRange;
            if (Number.isFinite(n)) this.settings.perDistrict[m] = Math.max(lo, Math.min(hi, Math.round(n)));
          }
        }
      }
      for (const m of ['tactics', 'slayer']) {
        const b = s.books && s.books[m];
        if (!b) continue;
        const book = blankBook();
        for (const k of ['score', 'level', 'taken', 'quiet']) if (Number.isFinite(b[k])) book[k] = b[k];
        if (b.sites && typeof b.sites === 'object') {
          for (const id of Object.keys(b.sites)) {
            if (!Array.isArray(b.sites[id])) continue;
            book.sites[id] = b.sites[id].filter((x) => x && Number.isFinite(x.x) && Number.isFinite(x.z))
              .map((x) => ({ id: String(x.id), d: id, x: x.x, z: x.z, yaw: Number(x.yaw) || 0,
                level: Number(x.level) || 0, state: x.state === SITE.FREE ? SITE.FREE : SITE.HELD }));
          }
        }
        this.books[m] = book;
      }
    } catch { /* a corrupt entry is a fresh campaign */ }
  }
}
