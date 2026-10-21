// Spree Fall Tactics, in play: the camps near you, the men in them, and what
// happens when the last of those men goes down.
//
// The campaign book (campaign.js) knows where every camp is and whether it
// has been taken. This file is the part that runs: a camp within reach is
// manned out of the ordinary soldier pool, its guards keep to their post,
// and a camp whose guards are all down is taken. A camp you walk away from
// while nobody knows you were there stands down again, and is manned afresh
// when you come back, which is how a camp in a game like this has always
// worked: the point is the camp, not the count.

import { SITE } from './campaign.js';
import { makeMachine } from './machines.js';

export const TACTICS = {
  // Manned within this of you, stood down past this.
  populate: 280,
  depopulate: 460,
  // Guards: this many, more at each level, and never past the most.
  guards: 5,
  guardsPerLevel: 1,
  guardsMost: 11,
  // From this level on, one in three of them is a machine.
  machinesFrom: 2,
  // Where they stand: a ring this wide round the flagpole.
  ring: [4, 12],
  // How far from the post a guard on patrol walks before he turns back.
  post: 15,
  // How much of a camp's ring a guard can still be in and count as in it.
  radius: 16,
};

/**
 * A spot for a camp: loaded, dry, not under the memorial's field, level, and
 * open for `clear` metres all round at chest height.
 */
export function campSpot(world, entry, rand, clear, shielded = () => false) {
  const b = entry.bounds;
  const margin = 70;
  const x = b.minX + margin + rand() * Math.max(1, b.maxX - b.minX - margin * 2);
  const z = b.minZ + margin + rand() * Math.max(1, b.maxZ - b.minZ - margin * 2);
  if (!world.isLoaded(x, z)) return null;
  if (shielded(x, 0, z)) return null;
  const g = world.groundHeight(x, z);
  if (g < (world.waterLevel ?? -0.9) + 0.4) return null;
  // Level ground: a camp on a slope is a camp half in the air.
  for (const [dx, dz] of [[9, 0], [-9, 0], [0, 9], [0, -9]]) {
    if (!world.isLoaded(x + dx, z + dz)) return null;
    if (Math.abs(world.groundHeight(x + dx, z + dz) - g) > 1.3) return null;
  }
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    if (world.raycast(x, g + 1.4, z, Math.cos(a), 0, Math.sin(a), clear)) return null;
  }
  return { x, z };
}

export class Tactics {
  /**
   * @param {object} campaign the book
   * @param {object} world for the ground
   * @param {object} soldiers the pool the guards come out of
   */
  constructor(campaign, world, soldiers) {
    this.campaign = campaign;
    this.world = world;
    this.soldiers = soldiers;
    this.live = new Map();      // site id -> runtime state
    this.onFree = null;         // fn(site, points, run)
    this.onManned = null;       // fn(site, run)
  }

  get enabled() { return this.campaign.mode === 'tactics'; }

  /** The runtime record for a site, made the first time it is asked for. */
  run(site) {
    let r = this.live.get(site.id);
    if (!r) {
      r = { site, guards: [], manned: false, alarm: false, radioUp: true, radioFlash: 0,
        spotted: false, alarmTime: 0, called: false };
      this.live.set(site.id, r);
    }
    return r;
  }

  /** Everything off: no guards, no records. Called when a run starts or the mode changes. */
  clear() {
    for (const r of this.live.values()) this._standDown(r);
    this.live.clear();
  }

  /** How many guards a camp at this level carries. */
  guardCount(level) {
    return Math.min(TACTICS.guardsMost, TACTICS.guards + TACTICS.guardsPerLevel * (level || 0));
  }

  _man(r) {
    const s0 = r.site;
    const w = this.world;
    const n = this.guardCount(s0.level);
    r.guards = [];
    for (let i = 0; i < n; i++) {
      const s = this.soldiers.free();
      if (!s) break;
      const a = s0.yaw + (i / n) * Math.PI * 2 + 0.3;
      const rr = TACTICS.ring[0] + ((i * 37) % 10) / 10 * (TACTICS.ring[1] - TACTICS.ring[0]);
      const x = s0.x + Math.cos(a) * rr, z = s0.z + Math.sin(a) * rr;
      s.spawn(x, w.groundHeight(x, z), z, s0.level || 0);
      // Already here: no sphere, no rising out of the street.
      s.rise = 0;
      s.y = w.groundHeight(x, z);
      s.post = { x: s0.x, z: s0.z, r: TACTICS.post, camp: s0.id };
      // Every other one stands his ground looking outwards; the rest walk.
      s.sentry = i % 2 === 0;
      s.yaw = Math.atan2(-(x - s0.x), -(z - s0.z)) + Math.PI;
      s.targetX = x; s.targetZ = z;
      if ((s0.level || 0) >= TACTICS.machinesFrom && i % 3 === 2) makeMachine(s);
      this.soldiers.active.push(s);
      r.guards.push(s);
    }
    r.manned = true;
    r.spotted = false;
    if (this.onManned) this.onManned(s0, r);
  }

  _standDown(r) {
    for (const s of r.guards) {
      if (s.alive && s.health > 0 && s.state !== 5) this.soldiers._retire(s);
    }
    r.guards = [];
    r.manned = false;
  }

  /** The guards of a camp still standing. */
  standing(r) {
    return r.guards.filter((s) => s.alive && s.health > 0 && s.state !== 5);
  }

  update(dt, player) {
    if (!this.enabled) return;
    for (const site of this.campaign.allSites()) {
      const r = this.run(site);
      const d = Math.hypot(site.x - player.x, site.z - player.z);
      if (site.state === SITE.FREE) {
        if (r.manned) this._standDown(r);
        continue;
      }
      if (!r.manned) {
        if (d < TACTICS.populate && this.world.isLoaded(site.x, site.z)) this._man(r);
        continue;
      }
      // Walked away from before anybody knew you were there: it stands down
      // and is manned in full when you come back.
      if (d > TACTICS.depopulate && !r.alarm) {
        this._standDown(r);
        continue;
      }
      if (r.guards.length && this.standing(r).length === 0) {
        const pts = this.campaign.free(site, { quiet: !r.spotted && !r.alarm });
        r.alarm = false;
        if (this.onFree) this.onFree(site, pts, r);
      }
    }
  }

  /** The camps worth drawing: placed, in memory and within reach. */
  drawList(px, pz, reach = 700) {
    const out = [];
    for (const site of this.campaign.allSites()) {
      if (Math.hypot(site.x - px, site.z - pz) > reach) continue;
      if (!this.world.isLoaded(site.x, site.z)) continue;
      const r = this.run(site);
      out.push({ x: site.x, y: this.world.groundHeight(site.x, site.z), z: site.z, yaw: site.yaw,
        free: site.state === SITE.FREE, radioDown: !r.radioUp, alarm: r.alarm, flash: r.radioFlash });
    }
    out.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    return out;
  }
}
