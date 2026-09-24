// Player health, the threat level that rises as you fight, and the weapons free
// zone. Keeping this separate from the weapon and the drones means the rules of
// the game live in one readable place.

export const COMBAT = {
  maxHealth: 100,
  maxShield: 120,
  regenDelay: 5.0,
  regenRate: 11,
  tierKills: [0, 6, 14, 26, 42, 62, 88],
};

/**
 * What a difficulty actually changes. Shields are the layer that decides
 * whether a fight is survivable: they take the hit first, come back on their
 * own, and make the difference between a firefight you can learn from and one
 * that ends before you have found the shooter.
 *
 * shieldDelay is the quiet you need before they start coming back, and
 * shieldRate is how fast, in points a second. Health does not come back on its
 * own except on easy, which is most of what makes it easy.
 */
export const DIFFICULTY = {
  easy: {
    name: 'easy', label: 'Easy',
    shield: 150, shieldDelay: 2.6, shieldRate: 70,
    incoming: 0.5, healthRegen: 7, enemyAccuracy: 0.55, reflexDrain: 0.55,
  },
  normal: {
    name: 'normal', label: 'Normal',
    shield: 120, shieldDelay: 4.2, shieldRate: 45,
    incoming: 1.0, healthRegen: 0, enemyAccuracy: 1.0, reflexDrain: 1.0,
  },
  hard: {
    name: 'hard', label: 'Hard',
    shield: 80, shieldDelay: 6.0, shieldRate: 32,
    incoming: 1.5, healthRegen: 0, enemyAccuracy: 1.25, reflexDrain: 1.4,
  },
};

export class Combat {
  constructor(manifest, difficulty = 'normal') {
    this.rules = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.health = COMBAT.maxHealth;
    this.shield = this.rules.shield;
    this.maxShield = this.rules.shield;
    this.shieldBroke = false;
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
    this.onShieldBreak = null;
    this.onShieldFull = null;
    this.onDifficulty = null;
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

  /** Switching difficulty mid game is allowed, and refills you. */
  setDifficulty(name) {
    const rules = DIFFICULTY[name];
    if (!rules || rules === this.rules) return false;
    this.rules = rules;
    this.maxShield = rules.shield;
    this.shield = rules.shield;
    this.health = COMBAT.maxHealth;
    if (this.onDifficulty) this.onDifficulty(rules);
    return true;
  }

  reset() {
    this.health = COMBAT.maxHealth;
    this.shield = this.rules.shield;
    this.maxShield = this.rules.shield;
    this.shieldBroke = false;
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

  /**
   * The shield takes it first and what is left over reaches you. A hit that
   * empties the shield spends only what the shield had left, so the shot that
   * breaks it does not also take a bite out of your health: the break is the
   * warning, and you get the moment after it to find cover.
   */
  hurt(amount, fromX, fromZ, px, pz) {
    if (this.health <= 0) return;
    const scaled = amount * this.rules.incoming;
    this.sinceHit = 0;
    this.streak = 0;
    let left = scaled;
    if (this.shield > 0) {
      const taken = Math.min(this.shield, left);
      this.shield -= taken;
      left -= taken;
      if (this.shield <= 0) {
        this.shield = 0;
        this.shieldBroke = true;
        left = 0;
        if (this.onShieldBreak) this.onShieldBreak();
      }
    }
    this.health = Math.max(0, this.health - left);
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
    this.shield = this.maxShield;
    this.shieldBroke = false;
    this.sinceHit = 0;
  }

  update(dt) {
    this.sinceHit += dt;
    if (this.health <= 0) return;
    const r = this.rules;
    if (this.shield < this.maxShield && this.sinceHit > r.shieldDelay) {
      const before = this.shield;
      this.shield = Math.min(this.maxShield, this.shield + r.shieldRate * dt);
      if (before < this.maxShield && this.shield >= this.maxShield) {
        this.shieldBroke = false;
        if (this.onShieldFull) this.onShieldFull();
      }
    }
    // Health only comes back on easy. Everywhere else the shield is the thing
    // that recovers, and a bad fight leaves a mark you carry.
    if (r.healthRegen > 0 && this.health < COMBAT.maxHealth && this.sinceHit > r.shieldDelay) {
      this.health = Math.min(COMBAT.maxHealth, this.health + r.healthRegen * dt);
    }
  }

  /** 0 to 1, for the bar and for the shader that tints the screen. */
  get shieldFraction() { return this.maxShield ? this.shield / this.maxShield : 0; }
  get recharging() { return this.shield < this.maxShield && this.sinceHit > this.rules.shieldDelay; }

  get elapsed() {
    return this.started ? (performance.now() - this.started) / 1000 : 0;
  }
}
