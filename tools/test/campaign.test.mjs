// The campaign book: sites land where they landed last time, a camp taken
// quietly pays the bonus only when it is switched on, a reset can make them
// harder, and the whole thing survives being written out and read back.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Campaign, OPS, SITE, seeded } from '../../src/game/campaign.js';

function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

// A district of open ground two kilometres across.
const finder = (rand) => ({ x: rand() * 2000, z: rand() * 2000 });

test('the same district gets the same sites every time', () => {
  const a = new Campaign(memory());
  a.setMode('tactics');
  const b = new Campaign(memory());
  b.setMode('tactics');
  const sa = a.place('core', finder);
  const sb = b.place('core', finder);
  assert.equal(sa.length, OPS.tactics.perDistrict);
  assert.deepEqual(sa.map((s) => [s.x, s.z]), sb.map((s) => [s.x, s.z]));
  for (let i = 0; i < sa.length; i++) {
    for (let j = i + 1; j < sa.length; j++) {
      assert.ok(Math.hypot(sa[i].x - sa[j].x, sa[i].z - sa[j].z) >= OPS.tactics.spacing);
    }
  }
  // And Slayer puts its nests somewhere else.
  const c = new Campaign(memory());
  c.setMode('slayer');
  assert.notDeepEqual(c.place('core', finder).map((s) => s.x), sa.map((s) => s.x));
});

test('one district in scope, or all of them', () => {
  const c = new Campaign(memory());
  c.setMode('tactics');
  c.set('start', 'core');
  assert.equal(c.inScope('core'), true);
  assert.equal(c.inScope('c0r0'), false);
  assert.deepEqual(c.place('c0r0', finder), []);
  c.set('scope', 'all');
  assert.equal(c.inScope('c0r0'), true);
});

test('a quiet camp pays the bonus, and only when it is switched on', () => {
  const c = new Campaign(memory());
  c.setMode('tactics');
  const [a, b] = c.place('core', finder);
  assert.equal(c.free(a, { quiet: true }), OPS.tactics.points + OPS.tactics.quietBonus);
  assert.equal(c.free(a, { quiet: true }), 0, 'a camp is only taken once');
  c.set('quietBonus', false);
  assert.equal(c.free(b, { quiet: true }), OPS.tactics.points);
  assert.equal(c.book.score, 2 * OPS.tactics.points + OPS.tactics.quietBonus);
});

test('a reset gives them back, harder if asked, and the score stays', () => {
  const c = new Campaign(memory());
  c.setMode('tactics');
  const sites = c.place('core', finder);
  for (const s of sites) c.free(s);
  const score = c.book.score;
  assert.equal(c.summary(['core']).done, 1);
  c.reset({ harder: true });
  assert.ok(sites.every((s) => s.state === SITE.HELD && s.level === 1));
  assert.equal(c.book.score, score);
  assert.equal(c.summary(['core']).done, 0);
  // A level one camp is worth more.
  assert.equal(c.free(sites[0]), OPS.tactics.points + OPS.tactics.perLevel);
});

test('the book is written out and read back', () => {
  const store = memory();
  const c = new Campaign(store);
  c.setMode('slayer');
  c.set('scope', 'all');
  c.set('perDistrict', 6);
  const sites = c.place('core', finder);
  c.free(sites[0]);
  const d = new Campaign(store);
  assert.equal(d.mode, 'slayer');
  assert.equal(d.settings.scope, 'all');
  assert.equal(d.settings.perDistrict.slayer, 6);
  assert.equal(d.sitesIn('core').length, sites.length);
  assert.equal(d.sitesIn('core')[0].state, SITE.FREE);
  assert.equal(d.book.score, c.book.score);
});

test('the seeded source is a source', () => {
  const r = seeded('x');
  const v = Array.from({ length: 1000 }, r);
  assert.ok(v.every((x) => x >= 0 && x < 1));
  assert.ok(Math.abs(v.reduce((a, b) => a + b, 0) / v.length - 0.5) < 0.05);
});
