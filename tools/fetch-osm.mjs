// Overpass client. Downloads a district, caches the raw XML, prints counts.
//
//   node tools/fetch-osm.mjs                     the middle district only
//   node tools/fetch-osm.mjs --district=c2r1     one named district
//   node tools/fetch-osm.mjs --all               every district, in order
//   node tools/fetch-osm.mjs --force             always refetch
//   node tools/fetch-osm.mjs --offline           skip the network, synthesise
//   node tools/fetch-osm.mjs --all --profile=full   every district with the
//                                                full set of tags tier 0 needs
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
import {
  DISTRICTS, CORE_ID, districtById, fetchBbox, extent, profileFrom, buildPlan, wantsFullQuery,
} from './districts.mjs';
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
  if (!wantsFullQuery(tier)) {
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

/**
 * A box cut into pieces no bigger than `most` metres a side. The full query
 * over one of the eight kilometre districts is seventy square kilometres of
 * every tag the middle of town is built from, and a mirror gives up on that
 * long before it is done; nine pieces of it each come back.
 */
export function piecesOf(bbox, most = 3000) {
  const e = extent(bbox);
  const nx = Math.max(1, Math.ceil(e.width / most));
  const nz = Math.max(1, Math.ceil(e.depth / most));
  const out = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      out.push({
        west: bbox.west + ((bbox.east - bbox.west) * i) / nx,
        east: bbox.west + ((bbox.east - bbox.west) * (i + 1)) / nx,
        south: bbox.south + ((bbox.north - bbox.south) * j) / nz,
        north: bbox.south + ((bbox.north - bbox.south) * (j + 1)) / nz,
      });
    }
  }
  return out;
}

/**
 * Several Overpass answers as one. Pieces of one box overlap wherever a way
 * crosses a cut, because each piece brings every way that touches it and
 * every node of those ways, so an element is kept once, by its type and id.
 * Overpass writes nodes, then ways, then relations; so does this, each in id
 * order, which is what a single query over the whole box would have given.
 */
export function mergeOsmXml(texts) {
  const kept = { node: new Map(), way: new Map(), relation: new Map() };
  let head = null;
  for (const text of texts) {
    const first = text.search(/<(node|way|relation)\s/);
    if (head === null) head = first < 0 ? text.replace(/<\/osm>\s*$/, '') : text.slice(0, first);
    if (first < 0) continue;
    const re = /<(node|way|relation)\s[^>]*?(\/?)>/g;
    re.lastIndex = first;
    let m;
    while ((m = re.exec(text))) {
      const type = m[1];
      let end = re.lastIndex;
      // An element with children runs to its own closing tag. None of the
      // three is ever nested inside another of the same type.
      if (!m[2]) {
        const close = text.indexOf(`</${type}>`, end);
        if (close < 0) break;
        end = close + type.length + 3;
      }
      const id = /\sid="(-?\d+)"/.exec(m[0]);
      if (id && !kept[type].has(id[1])) kept[type].set(id[1], text.slice(m.index, end));
      re.lastIndex = end;
    }
  }
  const lines = [head ? head.trimEnd() : '<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6">'];
  for (const type of ['node', 'way', 'relation']) {
    const ids = [...kept[type].keys()].sort((a, b) => Number(a) - Number(b));
    for (const id of ids) lines.push(`  ${kept[type].get(id)}`);
  }
  lines.push('</osm>', '');
  return lines.join('\n');
}

async function main() {
  const force = process.argv.includes('--force');
  const offline = process.argv.includes('--offline');
  // What the deploy uses: a district that Overpass will not give up is left
  // out rather than invented. The synthetic fallback exists so that this
  // repository builds and plays with no network at all; it is a stand in for
  // development, and a stand in has no business being deployed as Berlin.
  const liveOnly = process.argv.includes('--live-only');
  // How long Overpass gets, in seconds, for a caller with a clock of its own.
  const limit = process.argv.find((a) => a.startsWith('--deadline='));
  const deadlineMs = limit ? Number(limit.slice('--deadline='.length)) * 1000 : 600000;
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

  // The tier a district is fetched for is the tier it is going to be built
  // at, which the profile decides: a full build wants every district with
  // the tags of the middle of town.
  const profile = profileFrom(process.argv);
  let missed = 0;
  for (const row of wanted) {
    const district = { ...row, tier: buildPlan(row, profile, process.argv).tier };
    if (!await fetchDistrict(district, { force, offline, liveOnly, deadlineMs })) missed++;
  }
  if (missed) console.log(`\n${missed} district${missed === 1 ? '' : 's'} left for next time`);
}

/** @returns {Promise<boolean>} whether there is an extract for it now */
async function fetchDistrict(district, { force, offline, liveOnly = false, deadlineMs = 600000 }) {
  const file = rawFile(district.id);
  const meta = metaFile(district.id);
  const e = extent(district.bbox);
  const label = `${district.id} (tier ${district.tier}, ${e.area.toFixed(1)} km2)`;

  const full = wantsFullQuery(district.tier);
  if (!force && fs.existsSync(file)) {
    const m = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, 'utf8')) : {};
    // An extract fetched with the short list of tags cannot be built at a
    // tier that wants the long one: the shop fronts, the amenities and the
    // barriers are not in it. Older extracts did not say which they were,
    // and their tier does. A synthetic one is the same whatever is asked.
    const had = m.query || (m.tier !== undefined && !wantsFullQuery(m.tier) ? 'reduced' : 'full');
    const stale = full && had === 'reduced' && m.source !== 'synthetic' && !offline;
    if (!stale) {
      console.log(`cache hit: ${label} ${(fs.statSync(file).size / 1e6).toFixed(2)} MB, source ${m.source || 'unknown'}`);
      report(file);
      return true;
    }
    console.log(`refetching ${label}: the extract has the short list of tags and this build wants the full one`);
  }

  let text = null;
  let source = 'synthetic';
  if (!offline) {
    const pieces = full ? piecesOf(fetchBbox(district)) : [fetchBbox(district)];
    console.log(`fetching ${label} from Overpass`
      + `${pieces.length > 1 ? ` in ${pieces.length} pieces` : ''}`);
    const until = Date.now() + deadlineMs;
    try {
      const texts = [];
      for (const [i, box] of pieces.entries()) {
        if (pieces.length > 1) console.log(`  piece ${i + 1} of ${pieces.length}`);
        const got = await fetchOverpass(overpassQuery(box, district.tier),
          { deadlineMs: Math.max(5000, until - Date.now()) });
        texts.push(got.text);
        source = got.source;
      }
      text = texts.length === 1 ? texts[0] : mergeOsmXml(texts);
    } catch (err) {
      console.error(`\nOverpass is unreachable: ${err.message}`);
    }
  }

  if (text === null && liveOnly) {
    console.error(`leaving ${district.id} out: Overpass would not answer and this is a live only run\n`);
    return false;
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
    query: full ? 'full' : 'reduced',
    fetchedAt: new Date().toISOString(), bytes: text.length,
  }, null, 2));
  console.log(`wrote ${file}, ${(text.length / 1e6).toFixed(2)} MB, source ${source}`);
  report(file);
  return true;
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
