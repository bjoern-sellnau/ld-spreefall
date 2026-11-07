// Everything a weapon can put in the air has something to draw. The renderer
// keeps one instanced mesh per kind of projectile, and for a long while it
// also kept a list of kinds written out by hand; the kinds added after that
// list (the warhead among them) had a mesh and were never drawn. These checks
// read the source, so they need no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Every file under src, read once. */
function sources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(read(p));
    }
  };
  walk('src');
  return out.join('\n');
}

/** The kinds the renderer has a mesh for: the keys of `this.props = { ... }`. */
function drawnKinds() {
  const src = read('src/render/actors.js');
  const start = src.indexOf('this.props = {');
  assert.ok(start > 0, 'the projectile meshes are where they were');
  const end = src.indexOf('\n    };', start);
  return new Set([...src.slice(start, end).matchAll(/^\s+([a-zA-Z]+): this\._uploadMesh\(/gm)].map((m) => m[1]));
}

test('every kind of projectile a weapon or the game fires has a mesh to draw', () => {
  const all = sources();
  const fired = new Set([
    ...[...all.matchAll(/projectile: '([a-zA-Z]+)'/g)].map((m) => m[1]),
    ...[...all.matchAll(/projectiles\.launch\('([a-zA-Z]+)'/g)].map((m) => m[1]),
  ]);
  assert.ok(fired.size > 20, `${fired.size} kinds read out of the source`);
  const drawn = drawnKinds();
  const missing = [...fired].filter((k) => !drawn.has(k));
  assert.deepEqual(missing, [], `nothing draws ${missing.join(', ')}`);
  assert.ok(fired.has('warhead') && drawn.has('warhead'));
});

test('and the renderer draws every kind it has a mesh for, with no list of its own to forget one', () => {
  const src = read('src/render/actors.js');
  const start = src.indexOf('updateProjectiles(list) {');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  assert.ok(/for \(const kind in this\.props\) counts\[kind\] = 0;/.test(body), 'the counts come from the meshes');
  assert.ok(/mesh\.maxInstances/.test(body), 'and each stops at what its buffer holds');
});
