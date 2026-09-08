// Overpass client. Downloads the playable box, caches the raw XML, prints counts.
//
//   node tools/fetch-osm.mjs            fetch if the cache is missing
//   node tools/fetch-osm.mjs --force    always refetch
//   node tools/fetch-osm.mjs --offline  skip the network, synthesise instead
//
// If every mirror is unreachable the script falls back to tools/synth-osm.mjs so
// the rest of the build still has an input. That fallback is announced loudly.

import fs from 'node:fs';
import path from 'node:path';
import { BBOX } from './geo.mjs';
import { parseOsmXml, counts } from './osm-xml.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const RAW_FILE = path.join(RAW_DIR, 'berlin-center.osm');
const META_FILE = path.join(RAW_DIR, 'source.json');

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

export function overpassQuery(bbox = BBOX) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
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
);
(._;>;);
out body;`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryMirror(url, query, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
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

export async function fetchOverpass(query, { attempts = 4 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    for (const url of MIRRORS) {
      try {
        process.stdout.write(`  try ${url} (attempt ${attempt + 1})\n`);
        const text = await tryMirror(url, query, attempt);
        return { text, source: url };
      } catch (err) {
        lastErr = err;
        process.stdout.write(`    failed: ${err.message}\n`);
      }
    }
    const wait = Math.round(2000 * Math.pow(2, attempt) * (0.7 + Math.random() * 0.6));
    process.stdout.write(`  all mirrors failed, backing off ${wait} ms\n`);
    await sleep(wait);
  }
  throw lastErr || new Error('overpass unreachable');
}

async function main() {
  const force = process.argv.includes('--force');
  const offline = process.argv.includes('--offline');
  fs.mkdirSync(RAW_DIR, { recursive: true });

  if (!force && fs.existsSync(RAW_FILE)) {
    const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, 'utf8')) : {};
    console.log(`cache hit: ${RAW_FILE} (${(fs.statSync(RAW_FILE).size / 1e6).toFixed(2)} MB, source ${meta.source || 'unknown'})`);
    report();
    return;
  }

  let text = null;
  let source = 'synthetic';
  if (!offline) {
    console.log('fetching the playable box from Overpass');
    try {
      const got = await fetchOverpass(overpassQuery());
      text = got.text;
      source = got.source;
    } catch (err) {
      console.error(`\nOverpass is unreachable: ${err.message}`);
    }
  }

  if (text === null) {
    console.error('falling back to the synthesised dataset, see docs/PLAN.md section 7\n');
    const { buildSyntheticOsm } = await import('./synth-osm.mjs');
    text = buildSyntheticOsm();
    source = 'synthetic';
  }

  fs.writeFileSync(RAW_FILE, text);
  fs.writeFileSync(META_FILE, JSON.stringify({
    source, bbox: BBOX, fetchedAt: new Date().toISOString(), bytes: text.length,
  }, null, 2));
  console.log(`wrote ${RAW_FILE}, ${(text.length / 1e6).toFixed(2)} MB, source ${source}`);
  report();
}

function report() {
  const data = parseOsmXml(fs.readFileSync(RAW_FILE, 'utf8'));
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
