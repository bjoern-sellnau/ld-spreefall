// .BACKDOOR: the city as a network you have a way into.
//
// After the hacker games set in a city that runs on one operating system:
// a phone that profiles whoever you point it at (a name, a job, what they
// earn and one thing about them they would rather you did not know), and
// that gets into what they carry and what they drive. Everything a hack
// costs comes out of one battery that fills again by itself, and the hacks
// that take a moment (into somebody's bank, say) want the phone kept on
// them until they are done.
//
// The people, the names and the facts are made up, from a seed each person
// carries, so the same passer by is the same person every time you look.
// This file is the arithmetic; what a hack does to the street is the game
// layer's.

export const BACKDOOR = {
  civilians: 18,          // people about the streets, where Just a Walk has ten
  reach: 48,              // how far the phone reaches, in metres
  cone: 0.12,             // how far off the crosshair a target may be, in radians
  battery: { most: 100, regen: 10, delay: 0.8 },
  hacks: {
    // A passer by.
    distract: { name: 'Distract', cost: 12, seconds: 0, effect: 6 },
    bank: { name: 'Empty account', cost: 25, seconds: 1.4 },
    // A car or a bus in the traffic.
    stall: { name: 'Stall engine', cost: 20, seconds: 0, effect: 9 },
    ram: { name: 'Ram', cost: 30, seconds: 0, effect: 3.5 },
    doors: { name: 'Open the doors', cost: 15, seconds: 0 },
    // The lights at a junction.
    allRed: { name: 'All red', cost: 15, seconds: 0, effect: 10 },
    allGreen: { name: 'All green', cost: 30, seconds: 0, effect: 8 },
  },
};

// --- the people -----------------------------------------------------------

const FIRST = [
  'Jonas', 'Lea', 'Mehmet', 'Aylin', 'Katarzyna', 'Piotr', 'Anh', 'Minh', 'Lukas', 'Sophie',
  'Yusuf', 'Elif', 'Dmitri', 'Olga', 'Malik', 'Amira', 'Finn', 'Mia', 'Emre', 'Zeynep',
  'Tomasz', 'Agnieszka', 'Hassan', 'Layla', 'Felix', 'Hannah', 'Kemal', 'Derya', 'Igor', 'Svetlana',
  'Ben', 'Clara', 'Omar', 'Nour', 'Paul', 'Greta', 'Can', 'Selin', 'Jakub', 'Marta',
];
const LAST = [
  'Schulz', 'Yilmaz', 'Nowak', 'Nguyen', 'Müller', 'Kaya', 'Kowalski', 'Tran', 'Schmidt', 'Demir',
  'Wiśniewski', 'Pham', 'Fischer', 'Öztürk', 'Ivanov', 'Weber', 'Arslan', 'Lewandowski', 'Hoffmann', 'Haddad',
  'Becker', 'Çelik', 'Zieliński', 'Le', 'Wagner', 'Koch', 'Aydın', 'Petrov', 'Krüger', 'Saleh',
];
// What they do, and what it pays a year, roughly.
const JOBS = [
  ['Bike courier', 19000, 26000], ['DJ', 12000, 60000], ['Start-up founder', 0, 140000],
  ['Späti owner', 24000, 38000], ['Tram driver', 34000, 42000], ['Nurse', 36000, 48000],
  ['Barista', 18000, 24000], ['Software developer', 52000, 95000], ['Civil servant', 41000, 64000],
  ['Tattoo artist', 22000, 55000], ['Art student', 6000, 14000], ['Döner cook', 21000, 27000],
  ['Real estate agent', 48000, 160000], ['Bouncer', 26000, 36000], ['Lawyer', 70000, 190000],
  ['Unemployed', 6000, 12000], ['Influencer', 0, 220000], ['Taxi driver', 23000, 34000],
  ['Museum guard', 28000, 33000], ['Teacher', 45000, 62000], ['Bus driver', 33000, 41000],
  ['Pensioner', 14000, 30000], ['Bike mechanic', 24000, 31000], ['Club promoter', 15000, 70000],
  ['Journalist', 30000, 58000], ['Architect', 46000, 90000], ['Locksmith', 30000, 45000],
  ['Night watchman', 25000, 30000], ['Florist', 21000, 29000], ['Lobbyist', 85000, 240000],
];
// One thing about them.
const FACTS = [
  'Has been fare dodging on the U-Bahn for six years',
  'Spends a fifth of their income on döner',
  'Runs an anonymous account complaining about tourists',
  'Owes three months of rent to a landlord in Neukölln',
  'Has never once been let into Berghain',
  'Sublets a flat they do not live in',
  'Searched "how to disappear" eleven times this week',
  'Collects other people\'s parking tickets',
  'Wrote a novel nobody has read, twice',
  'Keeps a second phone nobody knows about',
  'Has a gambling habit on horse racing apps',
  'Pays a stranger to stand in line at the Bürgeramt',
  'Owns forty one houseplants and names all of them',
  'Applied to the same job nine times',
  'Secretly supports Hertha and Union',
  'Has a fake profile on three dating apps',
  'Sold a stolen bike to its owner',
  'Reports neighbours to the Ordnungsamt for fun',
  'Has not opened their post since March',
  'Is on a waiting list for a flat since 2019',
  'Bought a coffee machine with a company card',
  'Keeps cash in a freezer bag in the freezer',
  'Was banned from a Lidl in Wedding',
  'Is the third owner of a stolen e-scooter fleet',
  'Lies about being from Berlin',
  'Has a warrant out in Brandenburg for unpaid fines',
  'Sends voice messages longer than four minutes',
  'Is being blackmailed over a photo from Fusion festival',
];
const RECORDS = [
  'Pickpocketing, Alexanderplatz', 'Bag snatching', 'Assault outside a club', 'Bike theft, nine counts',
  'Car break ins', 'Fraud, online shop', 'Robbery, a Späti', 'Receiving stolen goods',
];

/** A small, fast, seeded generator: the same seed, the same person. */
export function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

/**
 * Who somebody is.
 * @param {number} seed
 * @returns {{name:string, age:number, job:string, income:number, fact:string,
 *   record:string|null, criminal:boolean, bank:number}}
 */
export function profileFor(seed) {
  const r = seeded(Math.floor(seed * 1e9) ^ 0x5bd1e995);
  const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
  const age = 17 + Math.floor(r() * 62);
  const job = age > 67 && r() < 0.8 ? JOBS.find((j) => j[0] === 'Pensioner') : pick(r, JOBS);
  const income = Math.round((job[1] + r() * (job[2] - job[1])) / 100) * 100;
  const fact = pick(r, FACTS);
  // One in nine has a record, and some of those are why there is crime in
  // the street at all.
  const criminal = r() < 0.11;
  const record = criminal ? `${pick(r, RECORDS)}, ${2009 + Math.floor(r() * 16)}` : null;
  // What they have in the bank: a share of a year, and less if they are
  // living on very little.
  const bank = Math.round(income * (0.02 + r() * 0.25) / 10) * 10 + 20;
  return { name, age, job: job[0], income, fact, record, criminal, bank };
}

// --- aiming the phone -------------------------------------------------------

/**
 * What the phone is pointed at: of the candidates within reach, the one
 * nearest the line of the crosshair, if one is within the cone.
 *
 * @param {{x,y,z}} eye
 * @param {{x,y,z}} dir a unit vector
 * @param {{x:number, y:number, z:number}[]} things each with where it is
 * @param {number} reach
 * @param {number} cone radians
 * @returns {{thing:object, off:number, dist:number}|null}
 */
export function pickTarget(eye, dir, things, reach = BACKDOOR.reach, cone = BACKDOOR.cone) {
  let best = null;
  for (const t of things) {
    const dx = t.x - eye.x, dy = t.y - eye.y, dz = t.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.5 || dist > reach) continue;
    const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / dist;
    const off = Math.acos(Math.max(-1, Math.min(1, cos)));
    // Further away is harder to point at, so the cone narrows a little with
    // distance, but never to nothing.
    const allowed = Math.max(cone * 0.45, cone * (1 - dist / (reach * 2.2)));
    if (off > allowed) continue;
    // The nearest to the line, and of two about as near, the closer one.
    const score = off + dist * 0.0006;
    if (!best || score < best.score) best = { thing: t, off, dist, score };
  }
  return best;
}

// --- the phone ----------------------------------------------------------------

export class Phone {
  constructor() {
    this.reset();
  }

  reset() {
    this.battery = BACKDOOR.battery.most;
    this.idle = BACKDOOR.battery.delay;
    this.money = 0;
    this.hacks = 0;
    this.job = null;            // a hack under way: { kind, target, left, total }
  }

  canAfford(kind) {
    const h = BACKDOOR.hacks[kind];
    return !!h && this.battery >= h.cost;
  }

  /**
   * Starts a hack. The battery is paid at once, so a hack that is let go
   * half way through is paid for anyway, as it is with any phone.
   * @returns {string|null} why not, or null if it started
   */
  start(kind, target) {
    const h = BACKDOOR.hacks[kind];
    if (!h) return 'nothing to do';
    if (this.job) return 'busy';
    if (this.battery < h.cost) return 'battery';
    this.battery -= h.cost;
    this.idle = 0;
    this.job = { kind, target, left: h.seconds, total: h.seconds };
    return null;
  }

  /**
   * A step of the phone.
   * @param {number} dt
   * @param {(target:object)=>boolean} [stillOn] whether the phone is still on the job's target
   * @returns {{done:object}|{lost:object}|null} a job that finished or was lost this step
   */
  update(dt, stillOn = () => true) {
    const B = BACKDOOR.battery;
    if (!this.job) {
      this.idle += dt;
      if (this.idle >= B.delay) this.battery = Math.min(B.most, this.battery + B.regen * dt);
      return null;
    }
    const j = this.job;
    if (j.total > 0 && !stillOn(j.target)) {
      this.job = null;
      return { lost: j };
    }
    j.left -= dt;
    if (j.left > 0) return null;
    this.job = null;
    this.hacks++;
    return { done: j };
  }

  /** How far a hack that takes a moment has got, 0 to 1. */
  get progress() {
    const j = this.job;
    return j && j.total > 0 ? 1 - Math.max(0, j.left) / j.total : 0;
  }
}
