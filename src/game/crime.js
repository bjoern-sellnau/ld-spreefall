// Crime in the street, for .BACKDOOR.
//
// Every so often somebody in the street near you does something they
// should not, and the phone hears about it before anybody else does: a
// thief walks up to somebody, takes their bag and runs, or a fight starts
// between two people and goes on until somebody stops it or one of them is
// on the ground. You can stop it by hand (a takedown puts the offender down
// without killing him), by phone (ring his phone and he stops to look at
// it, which in a fight is the end of the fight), or by anything else that
// stops a man, which costs more of your good name than it earns.
//
// This file is the crime itself, as a small machine: given where everybody
// is, where each of them should be going and what has just happened. Who
// the people are, and what a hit or a takedown does to them, is the game
// layer's.

export const CRIME = {
  first: 14,                    // seconds into a visit before the first
  every: [24, 42],              // between one and the next
  near: [35, 110],              // how far from you it happens
  snatch: 1.5,                  // how close a thief gets before he takes it
  fight: 1.8,                   // and two who are about to fight
  walk: 1.7, run: 4.7,          // the offender's pace, walking up and running off (you run 5.6)
  escape: 120,                  // a thief this far from you is gone
  escapeAfter: 6,               // after running at least this long
  limit: 60,                    // and any crime is over after this long
  hit: { every: 0.85, damage: 11, back: 0.3 },
  rep: { subdued: 10, brokenUp: 8, killed: 4, escaped: -5, victimDown: -8, innocent: -12 },
  reward: [60, 240],
  kinds: ['theft', 'brawl'],
};

const RECORD = { theft: 'Bag snatching', brawl: 'Assault' };

/** What the offender's record says, when a crime makes one of him. */
export const crimeRecord = (kind) => RECORD[kind] || 'Disorder';

/**
 * A crime about to happen.
 * @param {'theft'|'brawl'} kind
 */
export function newCrime(kind) {
  return { kind, phase: 'approach', t: 0, phaseT: 0, hitIn: CRIME.hit.every * 0.5, hits: 0, over: null };
}

/**
 * A step of a crime.
 *
 * @param {object} c from newCrime
 * @param {number} dt
 * @param {object} w where everybody is and how they are:
 *   o: {x, z, up, subdued, distracted} the offender
 *   v: {x, z, up} the victim
 *   p: {x, z} you
 * @returns {{offender:object|null, victim:object|null, events:string[]}}
 *   where each of the two should go ({x, z, speed, face?} or null to leave
 *   them be), and what happened: 'snatch', 'hit', 'hitBack', 'escaped',
 *   'subdued', 'killed', 'brokenUp', 'victimDown', 'timeout'
 */
export function crimeStep(c, dt, w) {
  const out = { offender: null, victim: null, events: [] };
  if (c.over) return out;
  c.t += dt;
  c.phaseT += dt;
  const end = (why) => { c.over = why; out.events.push(why); return out; };

  // However it ends for the offender, it ends.
  if (!w.o.up) return end(w.o.subdued ? 'subdued' : 'killed');
  const dx = w.v.x - w.o.x, dz = w.v.z - w.o.z;
  const apart = Math.hypot(dx, dz);

  if (c.phase === 'approach') {
    if (!w.v.up) return end('timeout');
    if (c.t > CRIME.limit) return end('timeout');
    const reach = c.kind === 'theft' ? CRIME.snatch : CRIME.fight;
    if (apart <= reach) {
      if (c.kind === 'theft') {
        c.phase = 'flee'; c.phaseT = 0;
        out.events.push('snatch');
      } else {
        c.phase = 'fight'; c.phaseT = 0;
      }
    } else {
      // Up to them, at a walk, as if he had somewhere to be, while they
      // stand there with no idea.
      out.offender = { x: w.v.x, z: w.v.z, speed: CRIME.walk };
      out.victim = { x: w.v.x, z: w.v.z, speed: 0 };
      return out;
    }
  }

  if (c.phase === 'flee') {
    // Away from the one he robbed and from you, picked fresh each step.
    let ax = w.o.x - (w.v.x + w.p.x) / 2, az = w.o.z - (w.v.z + w.p.z) / 2;
    const l = Math.hypot(ax, az) || 1;
    out.offender = { x: w.o.x + (ax / l) * 40, z: w.o.z + (az / l) * 40, speed: CRIME.run };
    const far = Math.hypot(w.o.x - w.p.x, w.o.z - w.p.z);
    if (far > CRIME.escape && c.phaseT > CRIME.escapeAfter) return end('escaped');
    if (c.t > CRIME.limit) return end('escaped');
    return out;
  }

  if (c.phase === 'fight') {
    if (!w.v.up) return end('victimDown');
    // A phone going off in the middle of it is the end of it: he looks, the
    // other one gets away.
    if (w.o.distracted) return end('brokenUp');
    if (c.t > CRIME.limit) return end('timeout');
    const face = Math.atan2(-dx, -dz);
    out.offender = { x: w.o.x, z: w.o.z, speed: 0, face };
    out.victim = { x: w.v.x, z: w.v.z, speed: 0, face: face + Math.PI };
    // Kept close enough to reach: one that has been pushed off comes back.
    if (apart > CRIME.fight * 1.6) out.offender = { x: w.v.x, z: w.v.z, speed: CRIME.walk };
    c.hitIn -= dt;
    if (c.hitIn <= 0 && apart <= CRIME.fight * 1.6) {
      c.hitIn = CRIME.hit.every;
      c.hits++;
      out.events.push(c.hits % 3 === 0 ? 'hitBack' : 'hit');
    }
    return out;
  }
  return out;
}

/** Where a crime's good name goes, for how it ended and who ended it. */
export function repFor(over) {
  const R = CRIME.rep;
  return over === 'subdued' ? R.subdued : over === 'brokenUp' ? R.brokenUp : over === 'killed' ? R.killed
    : over === 'escaped' || over === 'timeout' ? R.escaped : over === 'victimDown' ? R.victimDown : 0;
}

/** Whether a crime that ended this way was stopped. */
export const stopped = (over) => over === 'subdued' || over === 'brokenUp' || over === 'killed';
