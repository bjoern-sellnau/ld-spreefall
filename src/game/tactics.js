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
import { CAMP_RADIO, CAMP_ALARM } from '../render/actors.js';

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
  // How a guard who has not been told notices you: out to this range, inside
  // this cone (the cosine of half its angle), anywhere within near, at this
  // rate, slower to forget, and faster if you are running.
  stealth: { range: 80, cone: 0.5, near: 3.2, fill: 1.0, decay: 0.2, run: 1.7 },
  // Between a guard being sure and the siren going: kill him in that time and
  // nobody else finds out.
  spotDelay: 2.6,
  // What makes a noise, and how far it carries to a guard.
  noise: { shot: 130, explosion: 240 },
  // A body is found by anybody within this who can see it.
  bodySight: 30,
  // The radio: how much it takes, how long after the alarm it calls for help,
  // how many waves, how far apart, and how many in each.
  radioHealth: 40,
  // The alarm box: a few rounds, and then the siren cannot be sounded.
  boxHealth: 30,
  callDelay: 9,
  waves: 2,
  waveGap: 38,
  waveSize: 3,
  // Walked away from with the alarm on: it stands down after this long.
  forget: 40,
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
    this.onAlarm = null;        // fn(site, run) the siren starts
    this.onSpotted = null;      // fn(site, run, guard, how) somebody is sure
    this.onCall = null;         // fn(site, run, count) a wave of help is sent
    this.onRadio = null;        // fn(site, run) the radio is in pieces
    this.onBox = null;          // fn(site, run, wasSounding) the alarm box is broken
    this.onBody = null;         // fn(site, run, finder) a body is found
    this.onClear = null;        // fn() every camp stood down, for what is on its way
    soldiers.stealth = TACTICS.stealth;
  }

  /** The camp a guard belongs to, as its runtime record. */
  campOf(s) {
    if (!s || !s.post) return null;
    return this.live.get(s.post.camp) || null;
  }

  /** A guard is sure: the camp starts counting down to its alarm. */
  spot(s, how) {
    const r = this.campOf(s);
    if (!r || r.alarm || r.site.state === SITE.FREE) return;
    if (!r.spotted) r.spotTimer = TACTICS.spotDelay;
    r.spotted = true;
    r.spotters.add(s);
    if (this.onSpotted) this.onSpotted(r.site, r, s, how);
  }

  /**
   * A guard is down. His mates who can see where he fell go to look, and
   * that makes them more than halfway sure already.
   */
  guardDown(s) {
    const r = this.campOf(s);
    if (!r) return;
    r.spotters.delete(s);
    if (r.alarm) return;
    let found = null;
    for (const g of this.standing(r)) {
      if (g === s || g.post.alert) continue;
      const d = Math.hypot(g.x - s.x, g.z - s.z);
      if (d > TACTICS.bodySight) continue;
      if (!this.world.lineOfSight(g.x, g.y + 1.6, g.z, s.x, s.y + 0.6, s.z)) continue;
      g.suspicion = Math.max(g.suspicion, 0.6);
      g.sentry = false;
      g.targetX = s.x; g.targetZ = s.z;
      g.lookX = s.x; g.lookZ = s.z;
      found = g;
    }
    if (found) { r.bodies++; if (this.onBody) this.onBody(r.site, r, found); }
  }

  /** The siren. Everybody in the camp knows, and the radio calls for help. */
  raiseAlarm(r) {
    if (r.alarm) return;
    // With the alarm box broken there is nothing to sound: they know, and
    // fight, but the siren is silent and nobody is called.
    if (!r.boxUp) {
      for (const g of r.guards) {
        if (!g.post) continue;
        g.post.alert = true;
        g.sentry = false;
        g.suspicion = 1;
        if (g.alive && g.health > 0 && g.state === 0) { g.state = 1; g.stateTime = 0; }
      }
      r.spotted = false;
      r.silent = true;
      return;
    }
    r.alarm = true;
    r.alarmed = true;
    r.alarmTime = 0;
    r.waves = 0;
    r.nextWave = TACTICS.callDelay;
    for (const g of r.guards) {
      if (!g.post) continue;
      g.post.alert = true;
      g.sentry = false;
      g.suspicion = 1;
      if (g.alive && g.health > 0 && g.state === 0) { g.state = 1; g.stateTime = 0; }
    }
    if (this.onAlarm) this.onAlarm(r.site, r);
  }

  /** Where a camp's radio is in the world, from its yaw. */
  radioAt(site) {
    const c = Math.cos(site.yaw), sn = Math.sin(site.yaw);
    // The body shader turns a camp by rotY of the heading (it is handed the
    // heading negated and negates it again), and rotY(a) takes (x, z) to
    // (cos a x + sin a z, cos a z - sin a x).
    const x = site.x + c * CAMP_RADIO.x + sn * CAMP_RADIO.z;
    const z = site.z - sn * CAMP_RADIO.x + c * CAMP_RADIO.z;
    return { x, y: this.world.groundHeight(site.x, site.z) + CAMP_RADIO.y, z };
  }

  /** Where a camp's alarm box is in the world. */
  boxAt(site) {
    const c = Math.cos(site.yaw), sn = Math.sin(site.yaw);
    const x = site.x + c * CAMP_ALARM.x + sn * CAMP_ALARM.z;
    const z = site.z - sn * CAMP_ALARM.x + c * CAMP_ALARM.z;
    return { x, y: this.world.groundHeight(site.x, site.z) + CAMP_ALARM.y - 0.2, z };
  }

  /** Damage to whichever alarm box is within reach of a point. */
  hitBox(x, y, z, amount, reach = 0.6) {
    for (const r of this.live.values()) {
      if (!r.boxUp || r.site.state === SITE.FREE) continue;
      const p = this.boxAt(r.site);
      if (Math.hypot(p.x - x, p.y - y, p.z - z) > reach) continue;
      r.boxHealth -= amount;
      r.radioFlash = 1;
      if (r.boxHealth <= 0) {
        r.boxUp = false;
        const was = r.alarm;
        // A siren going quiet stops calling for help as well.
        r.alarm = false;
        if (this.onBox) this.onBox(r.site, r, was);
      }
      return true;
    }
    return false;
  }

  /** A shot along a segment: does it pass through an alarm box on the way? */
  shotBox(a, b, amount) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    for (const r of this.live.values()) {
      if (!r.boxUp || r.site.state === SITE.FREE) continue;
      const p = this.boxAt(r.site);
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2));
      const q = { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t };
      if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 0.42) return this.hitBox(p.x, p.y, p.z, amount, 0.01);
    }
    return false;
  }

  /** Damage to whichever radio is within reach of a point. */
  hitRadio(x, y, z, amount, reach = 0.6) {
    for (const r of this.live.values()) {
      if (!r.radioUp || r.site.state === SITE.FREE) continue;
      const p = this.radioAt(r.site);
      if (Math.hypot(p.x - x, p.y - y, p.z - z) > reach) continue;
      r.radioHealth -= amount;
      r.radioFlash = 1;
      if (r.radioHealth <= 0) {
        r.radioUp = false;
        if (this.onRadio) this.onRadio(r.site, r);
      }
      return true;
    }
    return false;
  }

  /** A shot along a segment: does it pass through a radio on the way? */
  shotRadio(a, b, amount) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    for (const r of this.live.values()) {
      if (!r.radioUp || r.site.state === SITE.FREE) continue;
      const p = this.radioAt(r.site);
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2));
      const q = { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t };
      if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 0.45) return this.hitRadio(p.x, p.y, p.z, amount, 0.01);
    }
    return false;
  }

  /** The most sure any guard in a camp within reach is, for the interface. */
  wariest(px, pz, reach = 160) {
    let most = 0;
    for (const r of this.live.values()) {
      if (!r.manned || r.alarm) continue;
      if (Math.hypot(r.site.x - px, r.site.z - pz) > reach) continue;
      for (const g of this.standing(r)) if (!g.post.alert) most = Math.max(most, g.suspicion || 0);
    }
    return most;
  }

  get enabled() { return this.campaign.camps; }

  /** The runtime record for a site, made the first time it is asked for. */
  run(site) {
    let r = this.live.get(site.id);
    if (!r) {
      r = { site, guards: [], manned: false, alarm: false, alarmed: false, radioUp: true,
        radioHealth: TACTICS.radioHealth, radioFlash: 0, boxUp: true, boxHealth: TACTICS.boxHealth, silent: false, spotted: false, spotTimer: 0,
        spotters: new Set(), alarmTime: 0, waves: 0, nextWave: 0, away: 0, bodies: 0 };
      this.live.set(site.id, r);
    }
    return r;
  }

  /** Everything off: no guards, no records. Called when a run starts or the mode changes. */
  clear() {
    for (const r of this.live.values()) this._standDown(r);
    this.live.clear();
    if (this.onClear) this.onClear();
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
    r.alarmed = false;
    r.bodies = 0;
    r.spotters.clear();
    // A camp manned afresh has a working radio again.
    r.radioUp = true;
    r.radioHealth = TACTICS.radioHealth;
    // And a working alarm box.
    r.boxUp = true;
    r.boxHealth = TACTICS.boxHealth;
    r.silent = false;
    if (this.onManned) this.onManned(s0, r);
  }

  _standDown(r) {
    for (const s of r.guards) {
      if (s.alive && s.health > 0 && s.state !== 5) this.soldiers._retire(s);
    }
    r.guards = [];
    r.manned = false;
    r.alarm = false;
    r.spotted = false;
    r.spotters.clear();
    r.away = 0;
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
      r.radioFlash = Math.max(0, r.radioFlash - dt * 4);
      // Walked away from before anybody knew you were there: it stands down
      // and is manned in full when you come back. With the alarm on it waits
      // a while first, in case you are coming straight back.
      if (d > TACTICS.depopulate) {
        r.away += dt;
        if (!r.alarm || r.away > TACTICS.forget) { this._standDown(r); continue; }
      } else {
        r.away = 0;
      }
      if (r.guards.length && this.standing(r).length === 0) {
        // No alarm ever sounded: that is the bonus. Seen but silenced in
        // time still counts; the siren is what it is about.
        const pts = this.campaign.free(site, { quiet: !r.alarmed });
        r.alarm = false;
        if (this.onFree) this.onFree(site, pts, r);
        continue;
      }
      // Somebody is sure: unless every one who is sure goes down first, the
      // siren goes.
      if (r.spotted && !r.alarm) {
        for (const g of [...r.spotters]) if (!g.alive || g.health <= 0 || g.state === 5) r.spotters.delete(g);
        if (r.spotters.size === 0) {
          r.spotted = false;
        } else {
          r.spotTimer -= dt;
          if (r.spotTimer <= 0) this.raiseAlarm(r);
        }
      }
      // The alarm is on and the radio works: help is called, in waves.
      if (r.alarm) {
        r.alarmTime += dt;
        if (r.radioUp && r.waves < TACTICS.waves) {
          r.nextWave -= dt;
          if (r.nextWave <= 0) {
            r.waves++;
            r.nextWave = TACTICS.waveGap;
            if (this.onCall) this.onCall(site, r, TACTICS.waveSize + (site.level || 0));
          }
        }
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
        free: site.state === SITE.FREE, radioDown: !r.radioUp, alarm: r.alarm, flash: r.radioFlash,
        boxDown: !r.boxUp });
    }
    out.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    return out;
  }
}
