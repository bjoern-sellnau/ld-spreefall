// What the city costs, and what you wait for when you walk into a district.
//
// There used to be a hard rule here: the brief asked for the playable area to
// come down in under twenty five megabytes, and since the game holds one
// district at a time, this failed a deploy if the code plus any single
// district went over that. The rule has been lifted. It never bound anything
// in the end, because the biggest district in the city is under five
// megabytes with the code beside it, and holding detail back against a number
// that was never reached is the wrong way round: what matters is whether the
// thing is playable, which is a wait you will sit through and a frame rate
// you can move in, not a figure.
//
// So this reports rather than enforces. A ceiling is still available for
// anyone who wants one, and then it does fail, because a limit nobody acts on
// is not a limit.
//
//   node tools/fit-city.mjs                  report what each district costs
//   node tools/fit-city.mjs --budget=12      and fail if one is over 12 MB
//   node tools/fit-city.mjs --whole=25       and cut the city to fit as well

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
  const whole = process.argv.find((a) => a.startsWith('--whole='));
  // No ceiling unless one is asked for.
  const perDistrict = arg ? parseFloat(arg.slice('--budget='.length)) * 1e6 : Infinity;
  const wholeBudget = whole ? parseFloat(whole.slice('--whole='.length)) * 1e6 : 0;
  if (!fs.existsSync(INDEX)) {
    console.error('no public/world.json, run: npm run world');
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));

  // The page and the code come down whatever else does, and so does the index.
  let code = 0, codeRaw = 0;
  for (const f of [path.join(ROOT, 'index.html'), ...walk(path.join(ROOT, 'src'))]) {
    code += gz(f);
    codeRaw += fs.statSync(f).size;
  }
  const fixed = code + gz(INDEX);

  const rows = index.districts
    .filter((d) => d.built !== false)
    .sort((a, b) => b.gzip - a.gzip);
  const tooBig = rows.filter((d) => fixed + d.gzip > perDistrict);

  console.log(`a district costs   the code and the index, ${(fixed / 1e6).toFixed(2)} MB, plus itself`);
  console.log('');
  console.log('district  km from the middle   download   with the code');
  for (const d of rows.slice(0, 10)) {
    console.log(`${d.id.padEnd(9)} ${String(ringOf(d.id)).padStart(6)} km          `
      + `${(d.gzip / 1e6).toFixed(2).padStart(6)} MB   ${((fixed + d.gzip) / 1e6).toFixed(2).padStart(6)} MB`
      + `${fixed + d.gzip > perDistrict ? '   TOO BIG' : ''}`);
  }
  if (rows.length > 10) console.log(`and ${rows.length - 10} smaller districts`);

  const city = rows.reduce((a, d) => a + d.gzip, 0);
  const deployed = rows.reduce((a, d) => a + d.bytes, 0);
  // The overflight bundles are deployed beside the fine ones and count
  // against the page host's ceiling, even though a walker never fetches one.
  const loGz = rows.reduce((a, d) => a + (d.lo ? d.lo.gzip : 0), 0);
  const loRaw = rows.reduce((a, d) => a + (d.lo ? d.lo.bytes : 0), 0);
  console.log('');
  console.log(`districts          ${rows.length} of ${DISTRICTS.length} built`);
  // The one number that decides whether this is playable at all: what comes
  // down before you can walk, which is the code, the index and the biggest
  // district you might land in.
  console.log(`to play            ${((fixed + (rows[0] ? rows[0].gzip : 0)) / 1e6).toFixed(2)} MB of download`
    + `${Number.isFinite(perDistrict) ? `, against ${(perDistrict / 1e6).toFixed(2)} MB` : ''}`
    + `${tooBig.length ? '  OVER' : ''}`);
  console.log(`the whole city     ${(city / 1e6).toFixed(2)} MB of download, `
    + `${(deployed / 1e6).toFixed(2)} MB deployed`);
  console.log(`overflight         ${(loGz / 1e6).toFixed(2)} MB of download, `
    + `${(loRaw / 1e6).toFixed(2)} MB deployed`);
  // GitHub Pages will not serve a published site over a gigabyte, and the
  // site is the fine city plus the overflight bundles plus the code. This is
  // the number that decides whether a deploy is possible at all, so it is
  // printed whether or not anything else is over a budget.
  const site = deployed + loRaw + codeRaw + fs.statSync(INDEX).size;
  console.log(`published site     ${(site / 1e6).toFixed(2)} MB of 1000 MB`
    + `${site > 1000e6 ? '   OVER, the host will not serve it' : ''}`);

  if (tooBig.length) {
    console.log('');
    console.log(`${tooBig.length} district${tooBig.length === 1 ? ' is' : 's are'} over the `
      + `${(perDistrict / 1e6).toFixed(2)} MB you asked for: `
      + `${tooBig.map((d) => d.id).join(', ')}. Split them in tools/districts.mjs.`);
    if (!dry) process.exit(1);
  }

  // Cutting the city down is now something you ask for rather than the
  // default, because the whole of Berlin is the point.
  if (!wholeBudget || dry) return;
  let spent = fixed;
  const keep = [];
  const drop = [];
  const touching = (a, b) => {
    const near = (p, q) => Math.abs(p - q) < 1;
    const overlapX = Math.min(a.bounds.maxX, b.bounds.maxX) - Math.max(a.bounds.minX, b.bounds.minX) > 1;
    const overlapZ = Math.min(a.bounds.maxZ, b.bounds.maxZ) - Math.max(a.bounds.minZ, b.bounds.minZ) > 1;
    return (overlapZ && (near(a.bounds.maxX, b.bounds.minX) || near(a.bounds.minX, b.bounds.maxX)))
      || (overlapX && (near(a.bounds.maxZ, b.bounds.minZ) || near(a.bounds.minZ, b.bounds.maxZ)));
  };
  const pending = [...index.districts].sort((a, b) => ringOf(a.id) - ringOf(b.id));
  for (;;) {
    const at = pending.findIndex((d) => (keep.length === 0 ? d.id === CORE_ID : keep.some((k) => touching(k, d)))
      && spent + d.gzip <= wholeBudget);
    if (at < 0) break;
    const [d] = pending.splice(at, 1);
    keep.push(d);
    spent += d.gzip;
  }
  drop.push(...pending);
  console.log('');
  console.log(`cut to ${(wholeBudget / 1e6).toFixed(2)} MB: shipping ${keep.length}, leaving out ${drop.length}`);
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
