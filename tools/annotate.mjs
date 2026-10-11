// Attaches the surveyed Berlin facts to whatever OSM the build was given.
//
// The offline fallback in synth-osm.mjs writes its own spreefall:* tags, so a
// build from it gets the bespoke landmark shapes, the eleven landmark cards and
// the stelae field for free. A build from the live Overpass extract does not:
// real OSM has never heard of spreefall:kind, so without this pass the deployed
// city loses the Gate's columns, the Reichstag dome, every landmark card and the
// whole memorial, and with the memorial goes the weapons free zone that depends
// on it.
//
// So this runs on every build, whatever the source. It prefers the real feature
// every time: where OSM already maps the thing, the surveyed facts are attached
// to the real footprint, and only what is genuinely absent is added.

import { project, unproject } from './geo.mjs';
import { ringArea, ringCentroid } from './geometry.mjs';
import { BUILDINGS, MEMORIAL, LANDMARK_CARDS } from './berlin-facts.mjs';
import { LANDMARK_BUILDERS } from './landmarks.mjs';

// Ids for anything we have to add ourselves. Real OSM ids are positive and
// nowhere near this, so nothing we mint can collide with something real.
const SYNTHETIC_ID_BASE = 9_000_000_000;

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The ring of a closed way in world metres, or null when it is not an area. */
function wayRing(way, pos) {
  if (!way.refs || way.refs.length < 4) return null;
  if (way.refs[0] !== way.refs[way.refs.length - 1]) return null;
  const ring = [];
  for (let i = 0; i < way.refs.length - 1; i++) {
    const p = pos.get(way.refs[i]);
    if (!p) return null;
    ring.push(p);
  }
  return ring.length >= 3 ? ring : null;
}

/** The outer ring of a multipolygon relation, largest first, in world metres. */
function relationRing(rel, ways, pos) {
  let best = null;
  let bestArea = 0;
  for (const m of rel.members) {
    if (m.type !== 'way' || m.role === 'inner') continue;
    const w = ways.get(m.ref);
    if (!w) continue;
    const ring = wayRing(w, pos);
    if (!ring) continue;
    const a = Math.abs(ringArea(ring));
    if (a > bestArea) { bestArea = a; best = ring; }
  }
  return best;
}

export function annotate(osm, { log = () => {} } = {}) {
  const pos = new Map();
  for (const n of osm.nodes.values()) pos.set(n.id, project(n.lon, n.lat));

  let nextId = SYNTHETIC_ID_BASE;
  const mintNode = (lon, lat, tags) => {
    const id = nextId++;
    osm.nodes.set(id, { id, lat, lon, tags });
    pos.set(id, project(lon, lat));
    return id;
  };
  const mintWay = (lonlat, tags) => {
    const refs = lonlat.map(([lon, lat]) => mintNode(lon, lat, {}));
    refs.push(refs[0]);
    const id = nextId++;
    osm.ways.set(id, { id, refs, tags });
    return id;
  };

  // Every closed area in the source, with its centre and size, so each fact
  // below can look for the real feature before inventing one.
  const areas = [];
  for (const way of osm.ways.values()) {
    const ring = wayRing(way, pos);
    if (!ring) continue;
    const area = Math.abs(ringArea(ring));
    if (area < 30) continue;
    const [cx, cz] = ringCentroid(ring);
    areas.push({ tags: way.tags, area, cx, cz });
  }
  for (const rel of osm.relations.values()) {
    if (rel.tags.type !== 'multipolygon') continue;
    const ring = relationRing(rel, osm.ways, pos);
    if (!ring) continue;
    const area = Math.abs(ringArea(ring));
    if (area < 30) continue;
    const [cx, cz] = ringCentroid(ring);
    areas.push({ tags: rel.tags, area, cx, cz });
  }

  const report = { cards: 0, landmarksTagged: 0, landmarksAdded: 0, added: [], memorial: 'none' };

  // --- the landmark cards -------------------------------------------------
  // These carry the name, the radius and the sentence of history, and the game
  // reads the weapons free zone off the memorial card, so they are not optional.
  const haveCard = new Set();
  for (const n of osm.nodes.values()) {
    if (n.tags && n.tags['spreefall:card']) haveCard.add(n.tags['spreefall:card']);
  }
  for (const c of LANDMARK_CARDS) {
    if (haveCard.has(c.key)) continue;
    mintNode(c.lon, c.lat, {
      tourism: 'attraction', name: c.name,
      'spreefall:card': c.key,
      'spreefall:radius': String(c.radius),
      'spreefall:text': c.text,
    });
    report.cards++;
  }

  // --- the stelae field ---------------------------------------------------
  // OSM maps the memorial, but it does not say how many stelae stand in it or
  // how big they are, so the surveyed numbers are attached to the real outline
  // where there is one.
  const memTags = {
    historic: 'memorial',
    memorial: 'stelae_field',
    name: MEMORIAL.name,
    'spreefall:stelae': String(MEMORIAL.count),
    'spreefall:stela_w': String(MEMORIAL.stelaW),
    'spreefall:stela_d': String(MEMORIAL.stelaD),
    'spreefall:stela_gap': String(MEMORIAL.gap),
  };
  let memorialDone = false;
  for (const way of osm.ways.values()) {
    if (way.tags && way.tags.memorial === 'stelae_field') { memorialDone = true; break; }
  }
  if (!memorialDone) {
    const ring = MEMORIAL.ring.map(([lon, lat]) => project(lon, lat));
    const [mx, mz] = ringCentroid(ring);
    const wanted = Math.abs(ringArea(ring));
    let best = null;
    let bestScore = Infinity;
    for (const way of osm.ways.values()) {
      const t = way.tags;
      if (!t) continue;
      const name = norm(t.name);
      const named = name.includes('ermordeten juden') || name.includes('holocaust');
      if (!named && t.historic !== 'memorial') continue;
      const r = wayRing(way, pos);
      if (!r) continue;
      const a = Math.abs(ringArea(r));
      if (a < wanted * 0.25) continue;
      const [cx, cz] = ringCentroid(r);
      const d = Math.hypot(cx - mx, cz - mz);
      if (d > 260) continue;
      const score = d - (named ? 200 : 0);
      if (score < bestScore) { bestScore = score; best = way; }
    }
    if (best) {
      Object.assign(best.tags, memTags);
      report.memorial = 'attached to the OSM outline';
    } else {
      mintWay(MEMORIAL.ring, { ...memTags });
      report.memorial = 'added from the surveyed outline';
    }
  } else {
    report.memorial = 'already tagged in the source';
  }

  // --- the buildings people came to see -----------------------------------
  // Only the ones with a shape of their own. A block or a courtyard is what the
  // ordinary extruder already makes of a real footprint, so those are left
  // alone rather than stamped over the top of what OSM maps.
  // Anything the source already claims is left exactly as it is, which is what
  // makes this pass safe to run on the offline fallback as well.
  const claimed = new Set();
  for (const a of areas) {
    if (a.tags && a.tags['spreefall:landmark']) claimed.add(a.tags['spreefall:landmark']);
  }

  for (const b of BUILDINGS) {
    if (!b.kind || !LANDMARK_BUILDERS[b.kind]) continue;
    if (claimed.has(b.key)) continue;
    const [bx, bz] = project(b.lon, b.lat);
    const wanted = b.w * b.d;
    const reach = Math.max(45, Math.hypot(b.w, b.d) * 0.6);

    let best = null;
    let bestScore = -Infinity;
    for (const a of areas) {
      const t = a.tags;
      // Anything that could be the structure itself. OSM maps the Gate as a
      // monument rather than a building, the Fernsehturm as a man made tower,
      // and several of these as attractions, so the tag is a weak filter and
      // the scoring below does the real work.
      if (!t) continue;
      if (!t.building && !t['building:part'] && !t.historic && !t.man_made
        && !t.tourism && !t.amenity) continue;
      if (t['spreefall:kind']) continue;
      const d = Math.hypot(a.cx - bx, a.cz - bz);
      if (d > reach) continue;
      if (a.area < wanted * 0.15) continue;
      // Near and big, with a matching name counting for a lot: OSM splits big
      // landmarks into parts, and the named one is the part we want.
      const named = norm(t.name) && norm(b.name).includes(norm(t.name).split(' ')[0]);
      const score = a.area - d * 40 + (named ? 4000 : 0);
      if (score > bestScore) { bestScore = score; best = a; }
    }

    if (best) {
      best.tags['spreefall:landmark'] = b.key;
      best.tags['spreefall:kind'] = b.kind;
      claimed.add(b.key);
      if (!best.tags.name) best.tags.name = b.name;
      if (!best.tags.height && !best.tags['building:levels']) best.tags.height = String(b.h);
      if (!best.tags['building:material']) best.tags['building:material'] = b.material;
      if (!best.tags['building:colour']) best.tags['building:colour'] = b.colour;
      if (!best.tags.building) best.tags.building = 'yes';
      report.landmarksTagged++;
    } else {
      // Nothing of the kind in the data: fall back to the surveyed footprint.
      const rot = (b.rot || 0) * Math.PI / 180;
      const cosA = Math.cos(rot), sinA = Math.sin(rot);
      const hw = b.w / 2, hd = b.d / 2;
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => {
        const x = bx + u * cosA - v * sinA;
        const z = bz + u * sinA + v * cosA;
        return unproject(x, z);
      });
      mintWay(corners, {
        building: 'yes', name: b.name, height: String(b.h),
        'building:levels': String(Math.max(1, Math.round(b.h / 4.2))),
        'building:material': b.material,
        'building:colour': b.colour,
        'spreefall:landmark': b.key,
        'spreefall:kind': b.kind,
      });
      report.landmarksAdded++;
      report.added.push(b.key);
    }
  }

  log(`facts: ${report.cards} cards added, ${report.landmarksTagged} landmarks found in the data, `
    + `${report.landmarksAdded} added from the survey`
    + `${report.added.length ? ` (${report.added.join(', ')})` : ''}`
    + `, stelae field ${report.memorial}`);
  return report;
}
