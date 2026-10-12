// What the city weighs, district by district, against the brief's budget.
//
// The brief asks for the whole playable area to be under twenty five
// megabytes of download. Download is what is measured here, so everything is
// counted gzipped, the way a browser receives it: the page, the code, the
// index and every district bundle that exists. The deployed size is printed
// too, because it is what fills a disk, but it is not the number the budget
// is about.
//
// Exits non zero when the city is over budget, so the workflow that builds
// every district fails loudly rather than quietly shipping thirty megabytes.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DISTRICTS } from './districts.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUB = path.join(ROOT, 'public');
const INDEX = path.join(PUB, 'world.json');
const BUDGET = 25e6;

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

function main() {
  if (!fs.existsSync(INDEX)) {
    console.error('no public/world.json, run: npm run world');
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const rows = index.districts || [];

  // The code and the page, which a player downloads once whatever else they
  // do. Counted from the source tree rather than from dist, so this can be
  // run without a build.
  let codeRaw = 0, codeGz = 0;
  const codeFiles = [path.join(ROOT, 'index.html'), ...walk(path.join(ROOT, 'src'))];
  for (const f of codeFiles) {
    codeRaw += fs.statSync(f).size;
    codeGz += gz(f);
  }

  console.log('district  tier  name                      deployed   download   km2    buildings');
  let raw = 0, download = 0, area = 0, buildings = 0;
  for (const d of rows) {
    const def = DISTRICTS.find((x) => x.id === d.id);
    const km2 = def
      ? ((def.bounds.maxX - def.bounds.minX) * (def.bounds.maxZ - def.bounds.minZ)) / 1e6 : 0;
    raw += d.bytes; download += d.gzip; area += km2; buildings += d.buildings;
    console.log(`${d.id.padEnd(9)} ${String(d.tier).padEnd(5)} ${String(d.name).slice(0, 24).padEnd(24)}`
      + `${(d.bytes / 1e6).toFixed(2).padStart(8)} MB${(d.gzip / 1e6).toFixed(2).padStart(9)} MB`
      + `${km2.toFixed(1).padStart(7)}${String(d.buildings).padStart(11)}`);
  }

  const indexGz = gz(INDEX);
  const total = download + indexGz + codeGz;
  const missing = DISTRICTS.length - rows.length;
  console.log('');
  console.log(`districts       ${rows.length} of ${DISTRICTS.length} built${missing ? `, ${missing} missing` : ''}`);
  console.log(`area            ${area.toFixed(1)} km2`);
  console.log(`buildings       ${buildings}`);
  console.log(`code and page   ${(codeRaw / 1e6).toFixed(2)} MB deployed, ${(codeGz / 1e6).toFixed(2)} MB gzipped`);
  console.log(`index           ${(fs.statSync(INDEX).size / 1e6).toFixed(2)} MB deployed, ${(indexGz / 1e6).toFixed(2)} MB gzipped`);
  console.log(`districts       ${(raw / 1e6).toFixed(2)} MB deployed, ${(download / 1e6).toFixed(2)} MB gzipped`);
  console.log(`per km2         ${(download / Math.max(1, area) / 1e6).toFixed(3)} MB of download`);
  console.log('');
  console.log(`download        ${(total / 1e6).toFixed(2)} MB of the 25.00 MB budget`
    + `${total > BUDGET ? '  OVER' : `, ${((BUDGET - total) / 1e6).toFixed(2)} MB to spare`}`);
  // This only reports. What actually ships is decided by tools/fit-city.mjs,
  // which takes districts outward from the middle until the budget is spent,
  // so a build that comes in over budget is a smaller city rather than a
  // failed deploy.
  if (total > BUDGET) {
    console.log(`                ${((total - BUDGET) / 1e6).toFixed(2)} MB more than the budget, `
      + 'so fit-city will ship fewer districts');
  }
}

main();
