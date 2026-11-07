// The game on a phone, worked out without a page: the stick, the look, which
// buttons where you are, where they go on the screen, and that every key the
// game listens for has a button somewhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { TOUCH, BUTTONS, DRAWER, TOPBAR, RING, stickVector, lookGain, padFor, padLayout, touchKeys } from '../../src/game/touch.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

test('the stick: nothing at its centre or inside the dead zone, then from nought, and running at the rim', () => {
  assert.deepEqual(stickVector(0, 0), { x: 0, z: 0, run: false, k: 0, kx: 0, ky: 0 });
  const R = TOUCH.stick.reach;
  const dead = stickVector(0, -R * TOUCH.stick.dead * 0.9);
  assert.equal(dead.z, 0);
  // Just past the dead zone it barely moves you, rather than jumping.
  assert.ok(stickVector(0, -R * (TOUCH.stick.dead + 0.02)).z < 0.05);
  const half = stickVector(0, -R / 2);
  assert.ok(half.z > 0.3 && half.z < 0.6 && !half.run, JSON.stringify(half));
  const rim = stickVector(0, -R);
  assert.ok(Math.abs(rim.z - 1) < 1e-9 && rim.run);
  // Up the screen is forward, right is right.
  assert.ok(stickVector(R, 0).x > 0.99 && stickVector(0, R).z < -0.99);
  // A thumb past the rim is full speed, and the knob stays on the rim.
  const far = stickVector(R * 3, R * 4);
  assert.ok(Math.abs(Math.hypot(far.x, far.z) - 1) < 1e-9 && Math.abs(Math.hypot(far.kx, far.ky) - R) < 1e-9);
});

test('a drag turns you less the further the sight is zoomed in, and never to nothing', () => {
  const base = TOUCH.look.fov * Math.PI / 180;
  assert.equal(lookGain(base), TOUCH.look.gain);
  assert.ok(Math.abs(lookGain(base / 2) - TOUCH.look.gain / 2) < 1e-12);
  assert.ok(lookGain(base / 100) > 0);
  assert.equal(lookGain(base * 2), TOUCH.look.gain);
});

test('which buttons, for where you are', () => {
  const ids = (c) => { const p = padFor(c); return [...p.ring, ...p.side]; };
  assert.deepEqual(padFor({ playing: false }), { ring: [], side: [] });
  assert.deepEqual(ids({ intro: true }), ['skip']);
  assert.deepEqual(ids({ cinema: true, playing: true }), ['skip']);
  const foot = ids({ playing: true });
  for (const id of ['fire', 'aim', 'jump', 'reload', 'use', 'prev', 'next', 'hit', 'reflex']) assert.ok(foot.includes(id), id);
  assert.equal(padFor({ playing: true }).ring[0], 'fire');
  // .BACKDOOR: the hacks the phone offers, and the blackout; no reflex, since
  // Q and E are the hacks there.
  assert.deepEqual(padFor({ playing: true, backdoor: true, hacks: 2 }).side, ['hack1', 'hack2', 'blackout']);
  assert.deepEqual(padFor({ playing: true, backdoor: true, hacks: 0 }).side, ['blackout']);
  // The Hunt: the suit, and the bow's draw weight only with the bow.
  assert.deepEqual(padFor({ playing: true, suit: true }).side, ['armour', 'cloak', 'grenade', 'visor', 'heat']);
  assert.ok(padFor({ playing: true, suit: true, bow: true }).side.includes('draw'));
  // In something: no aim, no use, and a way out.
  assert.deepEqual(ids({ playing: true, vehicle: 'ground' }), ['fire', 'brake', 'out']);
  assert.deepEqual(ids({ playing: true, vehicle: 'heli' }), ['fire', 'rockets', 'down', 'up', 'out']);
  assert.deepEqual(ids({ playing: true, vehicle: 'jet' }), ['fire', 'rockets', 'out']);
  // Rockets are the second trigger, as in a mech; down is Shift, as on the keys.
  assert.equal(BUTTONS.rockets.hold, 'aim');
  assert.equal(BUTTONS.down.hold, 'run');
  const mech = ids({ playing: true, mech: true });
  for (const id of ['fire', 'pod', 'jump', 'dash', 'reload', 'prev', 'next', 'view', 'out']) assert.ok(mech.includes(id), id);
  // Charges down: a button to blow them, wherever you are.
  assert.ok(ids({ playing: true, charges: true }).includes('blow'));
  assert.ok(ids({ playing: true, vehicle: 'ground', charges: true }).includes('blow'));
});

test('the buttons fit every phone on its side: none over another, all on the screen, a thumb wide, clear of the stick', () => {
  const screens = [[844, 390], [915, 412], [667, 375], [740, 360], [932, 430], [1024, 600]];
  const where = [
    { playing: true }, { playing: true, charges: true }, { playing: true, suit: true, bow: true, charges: true },
    { playing: true, mech: true, charges: true }, { playing: true, backdoor: true, hacks: 2, charges: true },
    { playing: true, vehicle: 'heli', charges: true }, { playing: true, vehicle: 'jet', charges: true },
    { playing: true, vehicle: 'ground' }, { intro: true },
  ];
  for (const [w, h] of screens) {
    for (const c of where) {
      const pad = padFor(c);
      const laid = padLayout(pad, w, h);
      assert.equal(laid.length, pad.ring.length + pad.side.length, `${w}x${h} every button placed`);
      for (let i = 0; i < laid.length; i++) {
        const a = laid[i];
        const at = `${w}x${h} ${a.id}`;
        assert.ok(a.r * 2 >= TOUCH.target - 1e-9, `${at} is ${a.r * 2} across`);
        assert.ok(a.x - a.r >= 0 && a.x + a.r <= w && a.y - a.r >= 0 && a.y + a.r <= h, `${at} on the screen`);
        assert.ok(a.x - a.r >= w * 0.45, `${at} clear of the stick`);
        for (let j = i + 1; j < laid.length; j++) {
          const b = laid[j];
          assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r, `${at} and ${b.id} apart`);
        }
      }
    }
  }
});

test('and held upright too, on the screen and none over another', () => {
  for (const [w, h] of [[390, 844], [412, 915], [375, 667]]) {
    for (const c of [{ playing: true }, { playing: true, suit: true, bow: true, charges: true }]) {
      const laid = padLayout(padFor(c), w, h);
      for (let i = 0; i < laid.length; i++) {
        const a = laid[i];
        assert.ok(a.x - a.r >= 0 && a.x + a.r <= w && a.y - a.r >= 0 && a.y + a.r <= h, `${w}x${h} ${a.id} on the screen`);
        for (let j = i + 1; j < laid.length; j++) {
          assert.ok(Math.hypot(a.x - laid[j].x, a.y - laid[j].y) >= a.r + laid[j].r, `${a.id} and ${laid[j].id}`);
        }
      }
    }
  }
  // The rings as drawn: wider each than the buttons on it and the one inside.
  assert.ok(RING.arcs[1].d - RING.arcs[0].d > RING.arcs[0].r + RING.arcs[1].r);
});

test('every key the game listens for has a button on a phone', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  const start = src.indexOf('input.onKeyPress = (code) => {');
  assert.ok(start > 0, 'the key handler is where it was');
  const end = src.indexOf('\n  };\n', start);
  const handler = src.slice(start, end);
  const heard = new Set(handler.match(/'(Key[A-Z]|Digit[0-9]|F[0-9]{1,2}|Tab|Backquote|Escape|Space|Enter|NumpadEnter|ShiftRight)'/g)
    .map((q) => q.slice(1, -1)));
  const pressed = touchKeys();
  // Enter is the confirm on the target map and the title, which have buttons
  // of their own, and right Shift is a second key for the reflex (E).
  const elsewhere = new Set(['Enter', 'NumpadEnter', 'ShiftRight']);
  const missing = [...heard].filter((k) => !pressed.has(k) && !elsewhere.has(k));
  assert.deepEqual(missing, [], `no button for ${missing.join(', ')}`);
  assert.ok(heard.size > 30, `${heard.size} keys read out of the handler`);
});

test('every button and drawer entry says what it is, and none of it with a dash', () => {
  for (const [id, b] of Object.entries(BUTTONS)) {
    assert.ok(b.label, id);
    assert.equal([b.key, b.hold, b.toggle, b.wheel].filter((x) => x !== undefined).length, 1, `${id} does one thing`);
  }
  for (const g of DRAWER) for (const it of g.items) assert.ok(it.label && (it.key || it.act), `${g.group} ${it.label}`);
  assert.deepEqual(TOPBAR.map((t) => t.id), ['pause', 'map', 'cheats', 'more']);
  const text = JSON.stringify({ BUTTONS, DRAWER, TOPBAR });
  assert.ok(!/[\u2013\u2014]/.test(text));
  for (const f of ['src/game/touch.js', 'src/ui/touchpad.js', 'tools/test-mobile.mjs', 'manifest.webmanifest']) {
    assert.ok(!/[\u2013\u2014]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} has no dash`);
  }
});

test('the manifest opens it full screen and on its side, with icons that are there', () => {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(man.display, 'fullscreen');
  assert.equal(man.orientation, 'landscape');
  for (const ic of man.icons) assert.ok(fs.existsSync(path.join(ROOT, ic.src)), ic.src);
  assert.ok(fs.existsSync(path.join(ROOT, 'icon-180.png')));
});
