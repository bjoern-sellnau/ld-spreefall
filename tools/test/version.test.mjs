// The build line under the title: the build and Berlin's own time.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLine, loadBuildLine } from '../../src/ui/version.js';

test('the build and the time it was made, on Berlin time, summer and winter', () => {
  // 23:30 UTC on the 23rd is half past one on the 24th in Berlin in summer time.
  assert.equal(buildLine({ build: 263, time: '2026-10-23T23:30:00Z' }), 'build 263 | 24.10.2026 um 01:30');
  // And after the clocks go back, an hour less.
  assert.equal(buildLine({ build: 'dev', time: '2026-12-01T08:05:00Z' }), 'build dev | 01.12.2026 um 09:05');
});

test('without a time it says only which build, and without anything that it is a development one', () => {
  assert.equal(buildLine({ build: 12 }), 'build 12');
  assert.equal(buildLine(null), 'build dev');
  assert.equal(buildLine({ build: 5, time: 'not a time' }), 'build 5');
});

test('a missing or broken version.json does not stop the title', async () => {
  assert.equal(await loadBuildLine(async () => ({ ok: false })), 'build dev');
  assert.equal(await loadBuildLine(async () => { throw new Error('offline'); }), 'build dev');
  assert.equal(await loadBuildLine(async () => ({ ok: true, json: async () => ({ build: 7, time: '2026-06-01T10:00:00Z' }) })),
    'build 7 | 01.06.2026 um 12:00');
});
