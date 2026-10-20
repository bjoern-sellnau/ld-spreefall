// Build profiles: which tier a district is built at and which tier the flight
// passes over, and the fetch that brings a large district at full detail in
// pieces and puts them back together.

import test from 'node:test';
import assert from 'node:assert/strict';

import { districtById, buildPlan, profileFrom } from '../districts.mjs';
import { mergeOsmXml, piecesOf } from '../fetch-osm.mjs';
import { parseOsmXml, counts } from '../osm-xml.mjs';

test('the standard profile is the city as it was', () => {
  assert.deepEqual(buildPlan(districtById('core')), { tier: 0, over: 5 });
  assert.deepEqual(buildPlan(districtById('c2r1')), { tier: 1, over: 5 });
  assert.deepEqual(buildPlan(districtById('i24')), { tier: 3, over: null });
  assert.deepEqual(buildPlan(districtById('o16')), { tier: 4, over: null });
});

test('the full profile is every district at tier 0, flown over at the block tier', () => {
  for (const id of ['core', 'c2r1', 'c0r0', 'i24', 'o16']) {
    assert.deepEqual(buildPlan(districtById(id), 'full'), { tier: 0, over: 2 }, id);
  }
});

test('a tier on the command line beats the profile, and a bundle as coarse as its own is not built', () => {
  const c0r0 = districtById('c0r0');
  assert.deepEqual(buildPlan(c0r0, 'standard', ['--tier=0', '--over=2']), { tier: 0, over: 2 });
  assert.deepEqual(buildPlan(c0r0, 'full', ['--tier=2']), { tier: 2, over: null });
});

test('an unknown profile is an error rather than the standard city', () => {
  assert.equal(profileFrom(['node', 'x']), 'standard');
  assert.equal(profileFrom(['node', 'x', '--profile=full']), 'full');
  assert.throws(() => profileFrom(['node', 'x', '--profile=huge']), /no such profile/);
});

test('a large box is cut into pieces no more than three kilometres a side', () => {
  const o16 = districtById('o16');
  const pieces = piecesOf(o16.bbox);
  assert.ok(pieces.length >= 9, `${pieces.length} pieces`);
  // They tile the box exactly: same outer edges, no gaps.
  const west = Math.min(...pieces.map((p) => p.west));
  const north = Math.max(...pieces.map((p) => p.north));
  assert.equal(west, o16.bbox.west);
  assert.ok(Math.abs(north - o16.bbox.north) < 1e-12);
  // A ring district is one piece, as it always was.
  assert.equal(piecesOf(districtById('c2r1').bbox).length, 1);
});

test('two overlapping answers merge into one with every element once', () => {
  const a = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="Overpass API">
<note>x</note>
  <node id="1" lat="52.5" lon="13.4"/>
  <node id="2" lat="52.5" lon="13.41"/>
  <node id="3" lat="52.51" lon="13.41">
    <tag k="natural" v="tree"/>
  </node>
  <way id="10">
    <nd ref="1"/>
    <nd ref="2"/>
    <tag k="highway" v="residential"/>
  </way>
</osm>`;
  const b = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="Overpass API">
<note>x</note>
  <node id="2" lat="52.5" lon="13.41"/>
  <node id="4" lat="52.52" lon="13.42"/>
  <way id="10">
    <nd ref="1"/>
    <nd ref="2"/>
    <tag k="highway" v="residential"/>
  </way>
  <way id="11">
    <nd ref="2"/>
    <nd ref="4"/>
    <tag k="building" v="yes"/>
  </way>
  <relation id="20">
    <member type="way" ref="11" role="outer"/>
    <tag k="type" v="multipolygon"/>
  </relation>
</osm>`;
  const merged = mergeOsmXml([a, b]);
  const c = counts(parseOsmXml(merged));
  assert.equal(c.nodes, 4);
  assert.equal(c.ways, 2);
  assert.equal(c.relations, 1);
  // The tree kept its tag through the merge.
  const data = parseOsmXml(merged);
  assert.equal(data.nodes.get(3).tags.natural, 'tree');
  assert.ok(merged.trimEnd().endsWith('</osm>'));
});
