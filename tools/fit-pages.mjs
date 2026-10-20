// The pages profile: the standard city, then as much of it at tier 0 as GitHub
// Pages will publish.
//
// Pages will not publish a site over a gigabyte (github/docs,
// content/pages/getting-started-with-github-pages/github-pages-limits.md), and
// the whole city at tier 0 is five times that. So this starts from a standard
// build and moves districts up one at a time, from the middle outward: each is
// rebuilt at tier 0 with a tier 2 overflight, the site is weighed, and one
// that takes it over the ceiling is built back the way it was. What a
// district costs at tier 0 is not guessed from a ratio, because the ratio runs
// from four to twenty depending on the district; it is built and weighed.
//
//   node tools/fit-pages.mjs                  up to 950 MB
//   node tools/fit-pages.mjs --ceiling=900    up to 900 MB
//   node tools/fit-pages.mjs --minutes=8      and stop after eight minutes
//
// A district fetched with the short list of tags is fetched again with the
// long one first, live only: one Overpass will not give up stays where it was.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DISTRICTS, PROFILES, wantsFullQuery } from './districts.mjs';
import { metaFile } from './fetch-osm.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUB = path.join(ROOT, 'public');
const INDEX = path.join(PUB, 'world.json');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const size = (rel) => {
  const p = path.join(PUB, rel);
  return fs.existsSync(p) ? fs.statSync(p).size : 0;
};

/**
 * What the published site weighs: the page, the code, the index and every
 * bundle the index lists, which is what tools/build-dist.mjs ships. The code
 * is counted before its comments are stripped, so this errs high.
 */
export function siteBytes() {
  let bytes = fs.statSync(path.join(ROOT, 'index.html')).size + fs.statSync(INDEX).size;
  for (const f of walk(path.join(ROOT, 'src'))) bytes += fs.statSync(f).size;
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  for (const d of index.districts) {
    if (d.built === false || !d.bin) continue;
    bytes += size(d.bin) + size(d.json);
    if (d.lo) bytes += size(d.lo.bin) + size(d.lo.json);
  }
  return bytes;
}

function run(args) {
  const r = spawnSync(process.execPath, ['--max-old-space-size=12000', ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
  });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/** Whether a district's extract carries the long list of tags tier 0 needs. */
function hasFullTags(id) {
  const file = metaFile(id);
  if (!fs.existsSync(file)) return false;
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (m.source === 'synthetic') return true;
  return (m.query || (m.tier !== undefined && !wantsFullQuery(m.tier) ? 'reduced' : 'full')) === 'full';
}

function main() {
  const arg = (key, fallback) => {
    const a = process.argv.find((s) => s.startsWith(`--${key}=`));
    return a ? Number(a.slice(key.length + 3)) : fallback;
  };
  const ceiling = arg('ceiling', 950) * 1e6;
  const until = Date.now() + arg('minutes', Infinity) * 60000;
  const up = PROFILES.pages.promoted;
  if (!fs.existsSync(INDEX)) {
    console.error('no public/world.json, build the city first');
    process.exit(1);
  }
  const start = siteBytes();
  console.log(`site ${(start / 1e6).toFixed(2)} MB, ceiling ${(ceiling / 1e6).toFixed(0)} MB`);

  // Nearest the middle first, which is the order the district table is in.
  const built = new Map(JSON.parse(fs.readFileSync(INDEX, 'utf8')).districts
    .filter((d) => d.built !== false).map((d) => [d.id, d]));
  const moved = [], refused = [];
  let misses = 0;
  for (const row of DISTRICTS) {
    const entry = built.get(row.id);
    if (!entry) continue;
    if (entry.tier === up.tier && entry.lo && entry.lo.tier === up.over) { moved.push(row.id); continue; }
    if (Date.now() > until) { console.log('out of time'); break; }
    // Three in a row that do not fit means the ones further out, which are
    // bigger, will not either.
    if (misses >= 3) break;
    if (!hasFullTags(row.id)) {
      run(['tools/fetch-osm.mjs', `--district=${row.id}`, `--tier=${up.tier}`, '--live-only']);
      if (!hasFullTags(row.id)) {
        console.log(`${row.id.padEnd(6)} skipped, Overpass would not give up the full tags`);
        continue;
      }
    }
    const before = siteBytes();
    const r = run(['tools/build-world.mjs', `--district=${row.id}`, `--tier=${up.tier}`, `--over=${up.over}`]);
    const after = siteBytes();
    if (r.ok && after <= ceiling) {
      moved.push(row.id);
      misses = 0;
      console.log(`${row.id.padEnd(6)} tier ${entry.tier} to ${up.tier}, `
        + `+${((after - before) / 1e6).toFixed(2)} MB, site ${(after / 1e6).toFixed(2)} MB`);
      continue;
    }
    // Back the way it was, which is the standard build of it.
    run(['tools/build-world.mjs', `--district=${row.id}`]);
    refused.push(row.id);
    misses++;
    console.log(`${row.id.padEnd(6)} would be ${(after / 1e6).toFixed(2)} MB`
      + `${r.ok ? '' : ' (the build failed)'}, left at tier ${entry.tier}`);
  }
  const end = siteBytes();
  console.log('');
  console.log(`at tier 0     ${moved.length}: ${moved.join(', ') || 'none'}`);
  console.log(`did not fit   ${refused.join(', ') || 'none'}`);
  console.log(`site          ${(start / 1e6).toFixed(2)} MB to ${(end / 1e6).toFixed(2)} MB of ${(ceiling / 1e6).toFixed(0)}`);
  if (end > 1000e6) {
    console.error('over the gigabyte Pages will publish');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
