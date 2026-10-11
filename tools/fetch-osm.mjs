// Overpass client. Downloads a district, caches the raw XML, prints counts.
//
//   node tools/fetch-osm.mjs                     the middle district only
//   node tools/fetch-osm.mjs --district=c2r1     one named district
//   node tools/fetch-osm.mjs --all               every district, in order
//   node tools/fetch-osm.mjs --force             always refetch
//   node tools/fetch-osm.mjs --offline           skip the network, synthesise
//
// Each district is one query over its own box plus a margin, because one query
// for all of Berlin is a few hundred megabytes that no mirror wants to serve
// and this machine would struggle to parse. The margin is there so a building
// sitting on a district boundary arrives whole in both of them; which of the
// two actually builds it is decided by its middle, in build-world.
//
// If every mirror is unreachable the script falls back to tools/synth-osm.mjs so
// the rest of the build still has an input. That fallback is announced loudly.

import fs from 'node:fs';
import path from 'node:path';
import { BBOX } from './geo.mjs';
import { DISTRICTS, CORE_ID, districtById, fetchBbox, extent } from './districts.mjs';
import { parseOsmXml, counts } from './osm-xml.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');

/**
 * Where a district's extract lives. The middle one keeps the name it has
 * always had, so a cache built before the city had districts is still a hit.
 */
export function rawFile(id) {
  return path.join(RAW_DIR, id === CORE_ID ? 'berlin-center.osm' : `district-${id}.osm`);
}

export function metaFile(id) {
  return path.join(RAW_DIR, id === CORE_ID ? 'source.json' : `district-${id}.json`);
}

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

/**
 * The query for one box. Outer districts ask for less, because what they do
 * not build they should not download: a tier two district is blocks, roads,
 * water and parks, and the amenity, historic and tourism tags that drive the
 * landmark cards in the middle of town are left on the server.
 *
 * @param {object} bbox the box to ask for
 * @param {number} tier 0 is the middle of town, 2 is out by the ring
 */
export function overpassQuery(bbox = BBOX, tier = 0) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  if (tier >= 2) {
    return `[out:xml][timeout:180][bbox:${b}];
(
  way["building"];
  relation["building"];
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)$"];
  way["railway"];
  way["waterway"];
  way["natural"];
  relation["natural"];
  way["landuse"];
  relation["landuse"];
  way["leisure"];
  relation["leisure"];
  way["man_made"];
  node["natural"="tree"];
  node["railway"="station"];
  node["place"];
);
(._;>;);
out body;`;
  }
  return `[out:xml][timeout:180][bbox:${b}];
(
  way["building"];
  relation["building"];
  way["building:part"];
  way["highway"];
  way["railway"];
  way["waterway"];
  way["natural"];
  relation["natural"];
  way["landuse"];
  relation["landuse"];
  way["leisure"];
  relation["leisure"];
  way["man_made"];
  way["barrier"];
  way["amenity"];
  relation["amenity"];
  way["historic"];
  relation["historic"];
  way["tourism"];
  node["natural"="tree"];
  node["railway"="station"];
  node["railway"="subway_entrance"];
  node["historic"];
  node["tourism"];
  node["amenity"];
  node["place"];
);
(._;>;);
out body;`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryMirror(url, query, attempt, until = Infinity) {
  const controller = new AbortController();
  const budget = Math.max(5000, Math.min(240000, until - Date.now()));
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      headers: { 'User-Agent': 'spreefall-build/1.0 (OSM city reconstruction demo)' },
      signal: controller.signal,
    });
    if (res.status === 429 || res.status === 504 || res.status === 503) {
      throw new Error(`rate limited, status ${res.status}`);
    }
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    if (text.length < 2048) throw new Error(`suspiciously small response, ${text.length} bytes`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Four attempts across every mirror, but under one wall clock deadline. A
 * single query can hold a connection open for four minutes, and four attempts
 * across three mirrors is most of an hour, which is longer than the build that
 * is waiting for it. When the deadline passes the caller falls back, which is
 * a worse city but a finished one.
 */
export async function fetchOverpass(query, { attempts = 4, deadlineMs = 600000 } = {}) {
  const until = Date.now() + deadlineMs;
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    for (const url of MIRRORS) {
      if (Date.now() > until) {
        throw lastErr || new Error(`overpass did not answer within ${Math.round(deadlineMs / 1000)} s`);
      }
      try {
        process.stdout.write(`  try ${url} (attempt ${attempt + 1})\n`);
        const text = await tryMirror(url, query, attempt, until);
        return { text, source: url };
      } catch (err) {
        lastErr = err;
        process.stdout.write(`    failed: ${err.message}\n`);
      }
    }
    const wait = Math.round(2000 * Math.pow(2, attempt) * (0.7 + Math.random() * 0.6));
    if (Date.now() + wait > until) break;
    process.stdout.write(`  all mirrors failed, backing off ${wait} ms\n`);
    await sleep(wait);
  }
  throw lastErr || new Error('overpass unreachable');
}

async function main() {
  const force = process.argv.includes('--force');
  const offline = process.argv.includes('--offline');
  const all = process.argv.includes('--all');
  const named = process.argv.find((a) => a.startsWith('--district='));
  fs.mkdirSync(RAW_DIR, { recursive: true });

  let wanted;
  if (all) wanted = DISTRICTS;
  else if (named) {
    const d = districtById(named.slice('--district='.length));
    if (!d) { console.error(`no such district: ${named}`); process.exit(1); }
    wanted = [d];
  } else wanted = [districtById(CORE_ID)];

  for (const district of wanted) {
    await fetchDistrict(district, { force, offline });
  }
}

async function fetchDistrict(district, { force, offline }) {
  const file = rawFile(district.id);
  const meta = metaFile(district.id);
  const e = extent(district.bbox);
  const label = `${district.id} (tier ${district.tier}, ${e.area.toFixed(1)} km2)`;

  if (!force && fs.existsSync(file)) {
    const m = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, 'utf8')) : {};
    console.log(`cache hit: ${label} ${(fs.statSync(file).size / 1e6).toFixed(2)} MB, source ${m.source || 'unknown'}`);
    report(file);
    return;
  }

  let text = null;
  let source = 'synthetic';
  if (!offline) {
    console.log(`fetching ${label} from Overpass`);
    try {
      const got = await fetchOverpass(overpassQuery(fetchBbox(district), district.tier));
      text = got.text;
      source = got.source;
    } catch (err) {
      console.error(`\nOverpass is unreachable: ${err.message}`);
    }
  }

  if (text === null) {
    console.error(`falling back to the synthesised dataset for ${district.id}, see docs/PLAN.md section 7\n`);
    const { buildSyntheticOsm } = await import('./synth-osm.mjs');
    text = buildSyntheticOsm(district);
    source = 'synthetic';
  }

  fs.writeFileSync(file, text);
  fs.writeFileSync(meta, JSON.stringify({
    source, district: district.id, tier: district.tier, bbox: district.bbox,
    fetchedAt: new Date().toISOString(), bytes: text.length,
  }, null, 2));
  console.log(`wrote ${file}, ${(text.length / 1e6).toFixed(2)} MB, source ${source}`);
  report(file);
}

function report(file) {
  const data = parseOsmXml(fs.readFileSync(file, 'utf8'));
  const c = counts(data);
  console.log(`nodes ${c.nodes}  ways ${c.ways}  relations ${c.relations}`);
  let buildings = 0, highways = 0, water = 0, trees = 0;
  for (const w of data.ways.values()) {
    if (w.tags.building) buildings++;
    if (w.tags.highway) highways++;
    if (w.tags.natural === 'water' || w.tags.waterway) water++;
  }
  for (const r of data.relations.values()) if (r.tags.building) buildings++;
  for (const nd of data.nodes.values()) if (nd.tags && nd.tags.natural === 'tree') trees++;
  console.log(`buildings ${buildings}  highways ${highways}  water ${water}  trees ${trees}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
