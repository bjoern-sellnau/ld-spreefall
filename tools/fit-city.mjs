// Fit the city into the budget by choosing how much of it to ship.
//
// The brief allows twenty five megabytes of download for the whole playable
// area. Berlin inside the Ring, measured on the live extract rather than
// guessed, does not fit at any detail this project can build and still call
// walkable, so something has to give, and the thing that gives is extent: the
// city ships outward from the middle until the budget is spent, and the
// districts that do not fit are not deployed.
//
// This runs after the build and before the packaging. It reads the index,
// takes districts in order of distance from Mitte, keeps what fits, and
// deletes the bundles of what does not so the packager cannot ship them by
// accident. The log says exactly what was left out and by how much, because
// that number is the answer to "how much of Berlin fits" and it should not
// have to be worked out from a stack trace.
//
//   node tools/fit-city.mjs                 fit to 25 MB of download
//   node tools/fit-city.mjs --budget=18     fit to another figure
//   node tools/fit-city.mjs --dry           say what it would do

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DISTRICTS, CORE_ID } from './districts.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUB = path.join(ROOT, 'public');
const INDEX = path.join(PUB, 'world.json');

function gz(file) {
  return zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * How far a district is from the middle, in kilometres. Districts are not the
 * same size any more, so counting them is meaningless; the distance between
 * the middles is not.
 */
function ringOf(id) {
  const d = DISTRICTS.find((x) => x.id === id);
  const core = DISTRICTS.find((x) => x.core);
  if (!d || !core) return 999;
  const dx = (d.bounds.minX + d.bounds.maxX) / 2 - (core.bounds.minX + core.bounds.maxX) / 2;
  const dz = (d.bounds.minZ + d.bounds.maxZ) / 2 - (core.bounds.minZ + core.bounds.maxZ) / 2;
  return Math.round(Math.hypot(dx, dz) / 1000);
}

function main() {
  const dry = process.argv.includes('--dry');
  const arg = process.argv.find((a) => a.startsWith('--budget='));
  const budget = (arg ? parseFloat(arg.slice('--budget='.length)) : 25) * 1e6;
  if (!fs.existsSync(INDEX)) {
    console.error('no public/world.json, run: npm run world');
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));

  // The page and the code come down whatever else does, so they are spent
  // before the first district is.
  let code = 0;
  for (const f of [path.join(ROOT, 'index.html'), ...walk(path.join(ROOT, 'src'))]) code += gz(f);
  let spent = code + gz(INDEX);

  // Outward from the middle, and within a ring, smallest first, so a cheap
  // district is never left out because an expensive one came first.
  const order = [...index.districts].sort((a, b) => {
    if (a.id === CORE_ID) return -1;
    if (b.id === CORE_ID) return 1;
    const ra = ringOf(a.id), rb = ringOf(b.id);
    if (ra !== rb) return ra - rb;
    return a.gzip - b.gzip;
  });

  // Greedy outward, but only into a district that touches one already being
  // shipped. Without that rule the budget could be spent on a cheap district
  // across the city from everything else, and the player would be able to see
  // it on the map and never walk to it.
  const touching = (a, b) => {
    const near = (p, q) => Math.abs(p - q) < 1;
    const overlapX = Math.min(a.bounds.maxX, b.bounds.maxX) - Math.max(a.bounds.minX, b.bounds.minX) > 1;
    const overlapZ = Math.min(a.bounds.maxZ, b.bounds.maxZ) - Math.max(a.bounds.minZ, b.bounds.minZ) > 1;
    return (overlapZ && (near(a.bounds.maxX, b.bounds.minX) || near(a.bounds.minX, b.bounds.maxX)))
      || (overlapX && (near(a.bounds.maxZ, b.bounds.minZ) || near(a.bounds.minZ, b.bounds.maxZ)));
  };
  const keep = [];
  const drop = [];
  const pending = [...order];
  for (;;) {
    const at = pending.findIndex((d) => (keep.length === 0 ? d.id === CORE_ID : keep.some((k) => touching(k, d)))
      && spent + d.gzip <= budget);
    if (at < 0) break;
    const [d] = pending.splice(at, 1);
    keep.push(d);
    spent += d.gzip;
  }
  drop.push(...pending);
  drop.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  console.log(`budget          ${(budget / 1e6).toFixed(2)} MB of download`);
  console.log(`code and page   ${(code / 1e6).toFixed(2)} MB gzipped`);
  for (const d of order) {
    const kept = keep.includes(d);
    console.log(`${kept ? '  ship ' : '  skip '} ${d.id.padEnd(6)} ${String(ringOf(d.id)).padStart(2)} km  `
      + `${String(d.name).slice(0, 22).padEnd(23)}${(d.gzip / 1e6).toFixed(2).padStart(6)} MB`);
  }
  console.log('');
  console.log(`shipping        ${keep.length} of ${index.districts.length} districts built, `
    + `${DISTRICTS.length} in the city`);
  console.log(`download        ${(spent / 1e6).toFixed(2)} MB, `
    + `${((budget - spent) / 1e6).toFixed(2)} MB of the budget unspent`);
  if (drop.length) {
    // Two different reasons, and they mean different things: one is the
    // budget, the other is a district with nothing shipped between it and
    // Mitte, which you could see on the map and never walk to.
    const noRoom = drop.filter((d) => spent + d.gzip > budget);
    const cutOff = drop.filter((d) => spent + d.gzip <= budget);
    if (noRoom.length) {
      console.log(`no room for     ${noRoom.map((d) => d.id).join(', ')}, `
        + `${(noRoom.reduce((a, d) => a + d.gzip, 0) / 1e6).toFixed(2)} MB more than the budget has left`);
    }
    if (cutOff.length) {
      console.log(`cut off         ${cutOff.map((d) => d.id).join(', ')}, `
        + 'nothing shipped between them and the middle');
    }
  }

  if (dry) return;
  index.districts = keep;
  index.builtAt = new Date().toISOString();
  fs.writeFileSync(INDEX, JSON.stringify(index));
  for (const d of drop) {
    for (const f of [d.bin, d.json]) {
      const p = path.join(PUB, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
}

main();
