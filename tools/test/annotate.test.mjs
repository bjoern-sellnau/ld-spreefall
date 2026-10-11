// The annotator is what makes a build from the live Overpass extract carry the
// same landmarks, cards and stelae field as a build from the offline fallback.
// Real OSM has none of the spreefall:* tags, so these fixtures have none either.
import test from 'node:test';
import assert from 'node:assert/strict';

import { annotate } from '../annotate.mjs';
import { LANDMARK_CARDS, MEMORIAL, BUILDINGS } from '../berlin-facts.mjs';

function emptyOsm() {
  return { nodes: new Map(), ways: new Map(), relations: new Map() };
}

let nextId = 1;
function addWay(osm, lonlat, tags) {
  const refs = [];
  for (const [lon, lat] of lonlat) {
    const id = nextId++;
    osm.nodes.set(id, { id, lat, lon, tags: {} });
    refs.push(id);
  }
  refs.push(refs[0]);
  const id = nextId++;
  osm.ways.set(id, { id, refs, tags });
  return osm.ways.get(id);
}

// A rectangle of w by d metres about a lon lat, in degrees.
function rect(lon, lat, w, d) {
  const dLon = w / 2 / (111320 * Math.cos(52.5163 * Math.PI / 180));
  const dLat = d / 2 / 110574;
  return [
    [lon - dLon, lat - dLat], [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat], [lon - dLon, lat + dLat],
  ];
}

const reichstagFact = BUILDINGS.find((b) => b.key === 'reichstag');

test('an extract with no spreefall tags gets all eleven landmark cards', () => {
  const osm = emptyOsm();
  const report = annotate(osm);
  assert.equal(report.cards, LANDMARK_CARDS.length);
  const keys = new Set();
  for (const n of osm.nodes.values()) {
    if (n.tags['spreefall:card']) keys.add(n.tags['spreefall:card']);
  }
  for (const c of LANDMARK_CARDS) assert.ok(keys.has(c.key), `${c.key} has a card`);
  // The memorial card is the anchor of the weapons free zone, so it carries
  // its radius and its text rather than just a name.
  const mem = [...osm.nodes.values()].find((n) => n.tags['spreefall:card'] === 'memorial');
  assert.ok(parseFloat(mem.tags['spreefall:radius']) > 0);
  assert.ok(mem.tags['spreefall:text'].includes('Eisenman'));
});

test('the real memorial outline is used when the extract maps one', () => {
  const osm = emptyOsm();
  const before = osm.ways.size;
  const real = addWay(osm, MEMORIAL.ring, {
    historic: 'memorial', name: 'Denkmal für die ermordeten Juden Europas',
  });
  const report = annotate(osm);
  assert.match(report.memorial, /attached/);
  assert.equal(real.tags.memorial, 'stelae_field');
  assert.equal(real.tags['spreefall:stelae'], String(MEMORIAL.count));
  // No second field was invented on top of the real one.
  const fields = [...osm.ways.values()].filter((w) => w.tags.memorial === 'stelae_field');
  assert.equal(fields.length, 1);
  assert.ok(osm.ways.size > before);
});

test('the memorial is added from the survey when the extract has none', () => {
  const osm = emptyOsm();
  const report = annotate(osm);
  assert.match(report.memorial, /added/);
  const fields = [...osm.ways.values()].filter((w) => w.tags.memorial === 'stelae_field');
  assert.equal(fields.length, 1);
  assert.equal(fields[0].tags['spreefall:stela_w'], String(MEMORIAL.stelaW));
});

test('a real footprint gets the bespoke shape rather than a stamped copy', () => {
  const osm = emptyOsm();
  const real = addWay(osm, rect(reichstagFact.lon, reichstagFact.lat, 130, 90), {
    building: 'yes', name: 'Reichstagsgebäude',
  });
  const report = annotate(osm);
  assert.equal(real.tags['spreefall:kind'], 'reichstag');
  assert.equal(real.tags['spreefall:landmark'], 'reichstag');
  // It keeps the real footprint: nothing was added in the same place.
  const reichstags = [...osm.ways.values()].filter((w) => w.tags['spreefall:landmark'] === 'reichstag');
  assert.equal(reichstags.length, 1);
  assert.ok(report.landmarksTagged >= 1);
});

test('a landmark the extract does not map is added from the survey', () => {
  const osm = emptyOsm();
  const report = annotate(osm);
  const gate = [...osm.ways.values()].find((w) => w.tags['spreefall:landmark'] === 'brandenburg_gate');
  assert.ok(gate, 'the Gate is there');
  assert.equal(gate.tags['spreefall:kind'], 'gate');
  assert.ok(report.landmarksAdded > 0);
});

test('a building fifty metres off is not mistaken for the landmark', () => {
  const osm = emptyOsm();
  // A shed next door, far too small to be the Reichstag.
  addWay(osm, rect(reichstagFact.lon + 0.0008, reichstagFact.lat, 8, 8), { building: 'yes' });
  annotate(osm);
  const tagged = [...osm.ways.values()].filter((w) => w.tags['spreefall:kind'] === 'reichstag');
  assert.equal(tagged.length, 1);
  const shed = [...osm.ways.values()].find((w) => w.tags.building === 'yes' && !w.tags['spreefall:kind']);
  assert.ok(shed, 'the shed is left alone');
});

test('running twice changes nothing the second time', () => {
  const osm = emptyOsm();
  annotate(osm);
  const nodes = osm.nodes.size, ways = osm.ways.size;
  const second = annotate(osm);
  assert.equal(second.cards, 0);
  assert.equal(second.landmarksAdded, 0);
  assert.equal(second.landmarksTagged, 0);
  assert.equal(osm.nodes.size, nodes);
  assert.equal(osm.ways.size, ways);
});
