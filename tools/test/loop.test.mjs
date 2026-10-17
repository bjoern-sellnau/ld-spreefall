// The fixed timestep loop, driven by hand. The one thing it must never do is
// believe a frame that says it took less than no time: that is where a
// simulation that stops while the picture keeps moving comes from.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Loop } from '../../src/engine/loop.js';

/** A loop with the browser's frame callback replaced by a function to call. */
function harness() {
  let next = null;
  globalThis.requestAnimationFrame = (f) => { next = f; return 1; };
  globalThis.cancelAnimationFrame = () => { next = null; };
  let fixed = 0;
  let rendered = 0;
  const loop = new Loop({ onFixed: () => { fixed++; }, onRender: () => { rendered++; } });
  return {
    loop,
    frame(at) { const f = next; next = null; f(at); },
    get fixed() { return fixed; },
    get rendered() { return rendered; },
  };
}

test('the first frame sets the clock rather than running the simulation', () => {
  const h = harness();
  h.loop.start();
  h.frame(12000);
  assert.equal(h.fixed, 0);
  assert.equal(h.rendered, 1);
  h.frame(12100);
  assert.equal(h.fixed, 6, 'a tenth of a second is six steps of a sixtieth');
});

test('a frame stamped before the one ahead of it does not stop the simulation', () => {
  const h = harness();
  h.loop.start();
  h.frame(12000);
  h.frame(9000);                       // three seconds into the past
  assert.equal(h.fixed, 0, 'nothing runs on it');
  assert.equal(h.loop.accumulator >= 0, true, 'and nothing is owed afterwards');
  h.frame(9100);
  assert.equal(h.fixed, 6, 'the next real frame runs its steps as usual');
});

test('a very slow frame is clamped rather than run in full', () => {
  const h = harness();
  h.loop.start();
  h.frame(1000);
  h.frame(11000);                      // ten seconds
  assert.equal(h.fixed, 15, 'a quarter of a second of simulation, and no more');
});
