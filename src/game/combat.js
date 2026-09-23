// Player health, the threat level that rises as you fight, and the weapons free
// zone. Keeping this separate from the weapon and the drones means the rules of
// the game live in one readable place.

export const COMBAT = {
  maxHealth: 100,
  regenDelay: 5.0,
  regenRate: 11,
  tierKills: [0, 6, 14, 26, 42, 62, 88],
};

export class Combat {
  constructor(manifest) {
    this.health = COMBAT.maxHealth;
    this.sinceHit = 99;
    this.score = 0;
    this.kills = 0;
    this.cores = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.tier = 0;
    this.downs = 0;
    this.started = 0;
    this.onHurt = null;
    this.onDown = null;
    this.onTier = null;
    this.damageDir = { x: 0, z: 0, at: -99 };

    // The memorial is a weapons free zone. Peter Eisenman's field is a memorial
    // to the murdered Jews of Europe, and turning it into a place to shoot in
    // would be grotesque. Inside it the weapon holsters itself and the drones
    // keep out.
    this.sanctuaries = [];
    for (const l of (manifest.landmarks || [])) {
      if (l.key === 'memorial') {
        this.sanctuaries.push({ x: l.x, z: l.z, radius: 135, name: l.name });
      }
    }
  }

  reset() {
    this.health = COMBAT.maxHealth;
    this.sinceHit = 99;
    this.score = 0;
    this.kills = 0;
    this.cores = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.tier = 0;
    this.downs = 0;
    this.started = performance.now();
  }

  /** True inside a weapons free zone. */
  isSanctuary(x, y, z) {
    for (const s of this.sanctuaries) {
      const dx = x - s.x, dz = z - s.z;
      if (dx * dx + dz * dz < s.radius * s.radius) return true;
    }
    return false;
  }

  sanctuaryName(x, z) {
    for (const s of this.sanctuaries) {
      const dx = x - s.x, dz = z - s.z;
      if (dx * dx + dz * dz < s.radius * s.radius) return s.name;
    }
    return null;
  }

  hurt(amount, fromX, fromZ, px, pz) {
    if (this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.sinceHit = 0;
    this.streak = 0;
    const dx = fromX - px, dz = fromZ - pz;
    const l = Math.hypot(dx, dz) || 1;
    this.damageDir = { x: dx / l, z: dz / l, at: performance.now() };
    if (this.onHurt) this.onHurt(amount);
    if (this.health <= 0) {
      this.downs++;
      if (this.onDown) this.onDown();
    }
  }

  creditKill(core, distance) {
    this.kills++;
    if (core) this.cores++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    // Distance and a clean core hit are both worth something.
    const base = 100;
    const far = Math.min(150, Math.round(distance * 0.6));
    this.score += base + far + (core ? 120 : 0) + Math.min(200, this.streak * 12);
    const next = COMBAT.tierKills[this.tier + 1];
    if (next !== undefined && this.kills >= next) {
      this.tier++;
      if (this.onTier) this.onTier(this.tier);
    }
  }

  /** Full heal and back on your feet, from wherever you went down. */
  revive() {
    this.health = COMBAT.maxHealth;
    this.sinceHit = 0;
  }

  update(dt) {
    this.sinceHit += dt;
    if (this.health > 0 && this.health < COMBAT.maxHealth && this.sinceHit > COMBAT.regenDelay) {
      this.health = Math.min(COMBAT.maxHealth, this.health + COMBAT.regenRate * dt);
    }
  }

  get elapsed() {
    return this.started ? (performance.now() - this.started) / 1000 : 0;
  }
}
