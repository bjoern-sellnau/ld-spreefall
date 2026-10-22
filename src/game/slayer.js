// Spree Fall Slayer, in play: the nests near you, and the fights they start.
//
// A nest is a lump of something that should not be in a Berlin street, put
// down on open ground the way a Tactics camp is. Walk up to one and it wakes:
// the demons come out of portals round it in waves, and they keep coming as
// you kill them, never more than so many at once, the heavy ones last, until
// the wave is spent; a breath, and the next. Spend the last wave and the
// nest is dead and the presence in the district is that much less. Run from
// the fight and the nest calls its demons back and waits for you.
//
// With bosses on, the last nest still standing in a district keeps a tyrant
// for its last wave, and the last nest of the whole operation keeps one more
// wave after that: the Warlord.

import { SITE } from './campaign.js';

export const SLAYER = {
  // Within this a nest wakes; past this in the middle of a fight it resets.
  trigger: 75,
  leash: 240,
  // Where they come out: a ring round the nest.
  ring: [12, 34],
  // How many are up at once, and how much faster they come at higher levels.
  alive: 8,
  alivePerLevel: 2,
  // The waves, as how many of each. A level multiplies the counts.
  waves: [
    { ghoul: 5 },
    { ghoul: 4, gazer: 1, brute: 1 },
    { ghoul: 5, gazer: 2, brute: 2 },
  ],
  perLevel: 0.35,
  // The boss wave, when there is one.
  boss: { ghoul: 4, tyrant: 1 },
  // And the end of the operation.
  final: { ghoul: 4, gazer: 2, warlord: 1 },
  // Seconds between waves, and between one portal and the next.
  between: 3,
  spawnGap: 0.4,
};

// Heavy ones come out last in a wave, which is how the genre paces it: the
// floor fills with fodder and then something large arrives.
const ORDER = { ghoul: 0, gazer: 1, brute: 2, tyrant: 3, warlord: 4 };

const gone = (b) => !b.alive || b.health <= 0 || b.state === 5;

export class Slayer {
  /**
   * @param {object} campaign the book
   * @param {object} world for the ground
   * @param {(kind, x, z, min, max, level) => object|null} spawn a demon out of a portal
   * @param {(body) => void} despawn put one back where it came from
   */
  constructor(campaign, world, spawn, despawn) {
    this.campaign = campaign;
    this.world = world;
    this.spawn = spawn;
    this.despawn = despawn;
    this.live = new Map();      // site id -> runtime
    this.extreme = 0;           // waves a nest holds with extreme enemies on, 0 for the usual
    this.onWake = null;         // fn(site, run)
    this.onWave = null;         // fn(site, run) a wave begins
    this.onHeavy = null;        // fn(site, run, kind, body) a brute or worse arrives
    this.onFree = null;         // fn(site, points, run)
    this.onReset = null;        // fn(site, run) you ran and it waits
    // Whether a nest is the last of the operation, which the game layer knows
    // better than the book: it knows which districts there are.
    this.isFinal = () => this.campaign.settings.scope !== 'all';
  }

  get enabled() { return this.campaign.mode === 'slayer'; }

  run(site) {
    let r = this.live.get(site.id);
    if (!r) {
      r = { site, phase: 'idle', wave: 0, waves: [], queue: [], demons: new Set(),
        spawnLeft: 0, betweenLeft: 0, killed: 0, total: 0, boss: false, final: false };
      this.live.set(site.id, r);
    }
    return r;
  }

  clear() {
    for (const r of this.live.values()) this._reset(r, false);
    this.live.clear();
  }

  /** The waves a nest at this level holds, with the boss if it is owed one. */
  plan(site, withBoss, final = false) {
    const k = 1 + SLAYER.perLevel * (site.level || 0);
    // With extreme enemies on, as many waves as the cheat menu says: the
    // three as they are, and every one past the last a little bigger than
    // the one before it.
    const extreme = this.extremeFrom ? this.extremeFrom() : this.extreme;
    const count = extreme > 0 ? extreme : SLAYER.waves.length;
    const waves = [];
    for (let i = 0; i < count; i++) {
      const w = SLAYER.waves[Math.min(i, SLAYER.waves.length - 1)];
      const grow = 1 + 0.15 * Math.max(0, i - (SLAYER.waves.length - 1));
      const out = {};
      for (const kind of Object.keys(w)) out[kind] = Math.max(1, Math.round(w[kind] * k * grow));
      waves.push(out);
    }
    if (withBoss) waves.push({ ...SLAYER.boss });
    if (withBoss && final) waves.push({ ...SLAYER.final });
    return waves;
  }

  _queue(wave) {
    const q = [];
    for (const kind of Object.keys(wave)) for (let i = 0; i < wave[kind]; i++) q.push(kind);
    // Fodder first in a shuffled order, the heavy ones after.
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    q.sort((a, b) => ORDER[a] - ORDER[b]);
    return q;
  }

  _wake(r) {
    const site = r.site;
    const others = (this.campaign.sitesIn(site.d) || []).filter((x) => x !== site && x.state !== SITE.FREE);
    r.boss = this.campaign.settings.bosses && others.length === 0;
    r.final = r.boss && !!this.isFinal(site);
    r.waves = this.plan(site, r.boss, r.final);
    r.total = r.waves.reduce((n, w) => n + Object.values(w).reduce((a, b) => a + b, 0), 0);
    r.killed = 0;
    r.wave = 0;
    r.queue = this._queue(r.waves[0]);
    r.phase = 'fight';
    r.spawnLeft = 0.6;
    if (this.onWake) this.onWake(site, r);
    if (this.onWave) this.onWave(site, r);
  }

  _reset(r, tell = true) {
    for (const b of r.demons) if (!gone(b)) this.despawn(b);
    r.demons.clear();
    r.phase = 'idle';
    r.queue = [];
    r.wave = 0;
    r.killed = 0;
    if (tell && this.onReset) this.onReset(r.site, r);
  }

  /** How many are left to kill at a nest in a fight, the queue and the living. */
  left(r) {
    let n = r.queue.length;
    for (const b of r.demons) if (!gone(b)) n++;
    for (let w = r.wave + 1; w < r.waves.length; w++) {
      n += Object.values(r.waves[w]).reduce((a, b) => a + b, 0);
    }
    return n;
  }

  /**
   * The presence in a district, nought to one: each nest still standing is
   * its share, and a nest in a fight counts by what is left of it.
   */
  presence(districtId) {
    const sites = this.campaign.sitesIn(districtId);
    if (!sites || !sites.length) return 1;
    let p = 0;
    for (const s of sites) {
      if (s.state === SITE.FREE) continue;
      const r = this.live.get(s.id);
      p += r && r.phase !== 'idle' && r.total ? this.left(r) / r.total : 1;
    }
    return p / sites.length;
  }

  /** The nest in a fight near you, if any. */
  active(px, pz) {
    for (const r of this.live.values()) {
      if (r.phase !== 'idle' && Math.hypot(r.site.x - px, r.site.z - pz) < SLAYER.leash) return r;
    }
    return null;
  }

  update(dt, player) {
    if (!this.enabled) return;
    for (const site of this.campaign.allSites()) {
      if (site.state === SITE.FREE) continue;
      const r = this.run(site);
      const d = Math.hypot(site.x - player.x, site.z - player.z);
      if (r.phase === 'idle') {
        if (d < SLAYER.trigger && this.world.isLoaded(site.x, site.z)) this._wake(r);
        continue;
      }
      if (d > SLAYER.leash) { this._reset(r); continue; }
      // Count the dead.
      for (const b of [...r.demons]) {
        if (gone(b)) { r.demons.delete(b); r.killed++; }
      }
      if (r.phase === 'between') {
        r.betweenLeft -= dt;
        if (r.betweenLeft <= 0) {
          r.phase = 'fight';
          r.queue = this._queue(r.waves[r.wave]);
          r.spawnLeft = 0.3;
          if (this.onWave) this.onWave(site, r);
        }
        continue;
      }
      // Out of the portals, as long as there is room.
      const cap = SLAYER.alive + SLAYER.alivePerLevel * (site.level || 0);
      r.spawnLeft -= dt;
      if (r.queue.length && r.demons.size < cap && r.spawnLeft <= 0) {
        const kind = r.queue[0];
        const far = kind === 'warlord' ? [32, 46] : kind === 'tyrant' ? [22, 40] : SLAYER.ring;
        const b = this.spawn(kind, site.x, site.z, far[0], far[1], site.level || 0);
        if (b) {
          r.queue.shift();
          b.nest = site.id;
          r.demons.add(b);
          if (kind !== 'ghoul' && this.onHeavy) this.onHeavy(site, r, kind, b);
        }
        r.spawnLeft = SLAYER.spawnGap;
      }
      // A wave spent: the next, or the nest is done.
      if (!r.queue.length && r.demons.size === 0) {
        r.wave++;
        if (r.wave < r.waves.length) {
          r.phase = 'between';
          r.betweenLeft = SLAYER.between;
        } else {
          r.phase = 'idle';
          const pts = this.campaign.free(site);
          if (this.onFree) this.onFree(site, pts, r);
        }
      }
    }
  }

  drawList(px, pz, reach = 800) {
    const out = [];
    for (const site of this.campaign.allSites()) {
      if (Math.hypot(site.x - px, site.z - pz) > reach) continue;
      if (!this.world.isLoaded(site.x, site.z)) continue;
      const r = this.live.get(site.id);
      out.push({ x: site.x, y: this.world.groundHeight(site.x, site.z), z: site.z, yaw: site.yaw,
        free: site.state === SITE.FREE, awake: !!(r && r.phase !== 'idle') });
    }
    out.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    return out;
  }
}
