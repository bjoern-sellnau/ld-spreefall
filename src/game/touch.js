// The game on a phone: what the thumbs do, worked out without a page, so the
// checks can read it. The touch layer on the page (ui/touchpad.js) draws
// what this says and sends what it is told to.
//
// Every button does one of three things the keyboard and the mouse already
// do: press a key the game listens for, hold down one of the inputs the
// mouse and Shift and Space hold (fire, aim, run, jump), or turn the wheel.
// So a button can never do something a key does not, and what a key does in
// a mech, in the suit or in .BACKDOOR it does from the button as well.

export const TOUCH = {
  // The stick: how far the thumb goes for full speed, in CSS pixels, the
  // share of that it can wander without moving you, and past what share
  // you run, as a stick pushed to its rim does on a pad.
  stick: { reach: 56, dead: 0.12, run: 0.85 },
  // Looking: radians a CSS pixel of drag at the unzoomed field of view, and
  // the field of view that is (camera.js). Zoomed in, a pixel turns you
  // less, in proportion, so the sight stays where the thumb puts it.
  look: { gain: 0.0042, fov: 68 },
  // The smallest a button may be, in CSS pixels: Apple asks for 44 points
  // and Google for 48 dp, both about the same length on the glass; 48.
  target: 48,
  // Phones: the most the device pixel ratio is taken at, the quality tier a
  // phone starts on (the game drops it further by itself if the frames are
  // slow) and the most the district streamer holds, in bytes.
  phone: { dpr: 1.5, quality: 'medium', hold: 5.12e8 },
};

/**
 * The stick: a thumb dx, dy CSS pixels from where it came down. Forward is
 * up the screen. A thumb inside the dead zone does not move you, and past it
 * the speed starts from nought rather than jumping, so creeping is possible.
 *
 * @returns {{x:number, z:number, run:boolean, k:number, kx:number, ky:number}}
 *   x right, z forward, each -1 to 1; k how far out, 0 to 1; and kx, ky
 *   where to draw the knob, in pixels from the centre, held to the rim
 */
export function stickVector(dx, dy, S = TOUCH.stick) {
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return { x: 0, z: 0, run: false, k: 0, kx: 0, ky: 0 };
  const out = Math.min(1, l / S.reach);
  const k = out <= S.dead ? 0 : (out - S.dead) / (1 - S.dead);
  const ux = dx / l, uy = dy / l;
  return {
    x: ux * k, z: -uy * k, run: out > S.run, k,
    kx: ux * out * S.reach, ky: uy * out * S.reach,
  };
}

/** Radians a CSS pixel of drag turns you, at a field of view in radians. */
export function lookGain(fov, L = TOUCH.look) {
  const base = L.fov * Math.PI / 180;
  return L.gain * Math.max(0.15, Math.min(1, fov / base));
}

/**
 * Every button there is. `key` presses that key; `hold` holds an input down
 * while the thumb is on it; `toggle` turns one on and off; `wheel` turns the
 * wheel. A button with `look` also looks round while the thumb drags off it,
 * so you can shoot and turn with the one thumb.
 */
export const BUTTONS = {
  fire: { label: 'fire', hold: 'fire', look: true },
  aim: { label: 'aim', toggle: 'aim' },
  jump: { label: 'jump', hold: 'jump' },
  reload: { label: 'reload', key: 'KeyR' },
  use: { label: 'use', key: 'KeyF' },
  prev: { label: '‹', wheel: -1, title: 'previous weapon' },
  next: { label: '›', wheel: 1, title: 'next weapon' },
  hit: { label: 'hit', key: 'Tab' },
  reflex: { label: 'slow', key: 'KeyE' },
  blow: { label: 'blow', key: 'KeyT' },
  skip: { label: 'skip', key: 'Space' },
  // .BACKDOOR: the phone's two hacks on what it points at, and the blackout.
  hack1: { label: 'hack', key: 'KeyQ' },
  hack2: { label: 'hack', key: 'KeyE' },
  blackout: { label: 'blackout', key: 'KeyB' },
  // The Hunt: the suit's two modes, the visor, the heat view, a grenade and
  // with the bow its draw weight.
  armour: { label: 'armour', key: 'KeyQ' },
  cloak: { label: 'cloak', key: 'KeyE' },
  visor: { label: 'visor', key: 'KeyB' },
  heat: { label: 'heat', key: 'KeyN' },
  grenade: { label: 'grenade', key: 'KeyG' },
  draw: { label: 'draw', key: 'KeyX' },
  // Driving and flying, and a mech: the second trigger held, Shift held, and
  // out again.
  brake: { label: 'brake', hold: 'run' },
  up: { label: 'up', hold: 'jump' },
  down: { label: 'down', hold: 'aim' },
  pod: { label: 'pod', hold: 'aim' },
  dash: { label: 'dash', hold: 'run' },
  view: { label: 'view', key: 'KeyY' },
  out: { label: 'out', key: 'KeyF' },
};

/**
 * Where the buttons go: the fire button in the bottom right corner, where the
 * right thumb rests, the ones used with it on a ring round it and the next on
 * a wider one, and what belongs to the mode on a third, further out. Each
 * arc is a radius from the fire button's centre and the angles along it, 180
 * being straight left and 90 straight up; r is a button's radius. The rings
 * are spaced so no two buttons touch: 104 and 176 apart by more than the
 * buttons on them, and the steps along each arc wider than a button.
 */
export const RING = {
  corner: 70,
  fire: 44,
  arcs: [
    { d: 104, r: 30, angles: [180, 135, 90] },
    { d: 176, r: 27, angles: [180, 155, 130, 105] },
  ],
  side: [
    { d: 246, r: 26, angles: [178, 160, 142, 124, 106, 88] },
    // Filled from the top down, so the first ones on it stay clear of the
    // left half of a small phone, where the stick is.
    { d: 314, r: 26, angles: [130, 146, 162, 178] },
  ],
};

/**
 * The buttons placed for a screen w by h CSS pixels: each one's centre and
 * radius, measured from the top left. Smaller screens get the rings drawn in,
 * but no button below the smallest a finger can be sure of.
 *
 * @param {{ring:string[], side:string[]}} pad what padFor said
 * @returns {{id:string, x:number, y:number, r:number}[]}
 */
export function padLayout(pad, w, h, R = RING) {
  // Scaled to the height of a phone on its side, and held in by the width
  // when it is upright, so the rings fit across it.
  const s = Math.max(0.82, Math.min(1.2, Math.min(h, w * 0.6) / 390));
  const least = TOUCH.target / 2;
  const fx = w - R.corner * s, fy = h - R.corner * s;
  const out = [];
  const at = (id, d, deg, r) => {
    const a = deg * Math.PI / 180;
    out.push({ id, x: fx + Math.cos(a) * d * s, y: fy - Math.sin(a) * d * s, r: Math.max(least, r * s) });
  };
  const ring = pad.ring.slice();
  if (ring[0] === 'fire') { out.push({ id: 'fire', x: fx, y: fy, r: Math.max(least, R.fire * s) }); ring.shift(); }
  let i = 0;
  for (const arc of R.arcs) for (const deg of arc.angles) { if (i < ring.length) at(ring[i++], arc.d, deg, arc.r); }
  // Anything on the ring past its slots goes out to the side with the rest.
  const side = [...ring.slice(i), ...pad.side];
  let j = 0;
  for (const arc of R.side) for (const deg of arc.angles) { if (j < side.length) at(side[j++], arc.d, deg, arc.r); }
  return out;
}

/**
 * What is on the right of the screen, for where you are: the slots round the
 * fire button and the column of what belongs to the mode, in order.
 *
 * @param {object} c what the game says is going on:
 *   playing, intro, cinema (booleans); vehicle ('ground', 'air' or null);
 *   mech, suit, backdoor, bow, charges, hacks (how many the phone offers)
 * @returns {{ring:string[], side:string[]}}
 */
export function padFor(c) {
  if (c.intro || c.cinema) return { ring: ['skip'], side: [] };
  if (!c.playing) return { ring: [], side: [] };
  const side = [];
  let ring;
  if (c.mech) {
    ring = ['fire', 'pod', 'reload', 'jump', 'dash', 'prev', 'next'];
    side.push('view', 'out');
  } else if (c.vehicle === 'air') {
    ring = ['fire', 'down', 'up'];
    side.push('out');
  } else if (c.vehicle) {
    ring = ['fire', 'brake'];
    side.push('out');
  } else {
    ring = ['fire', 'aim', 'reload', 'jump', 'use', 'prev', 'next', 'hit'];
    if (c.backdoor) {
      if (c.hacks > 0) side.push('hack1');
      if (c.hacks > 1) side.push('hack2');
      side.push('blackout');
    } else if (c.suit) {
      side.push('armour', 'cloak', 'grenade', 'visor', 'heat');
      if (c.bow) side.push('draw');
    } else {
      side.push('reflex');
    }
  }
  if (c.charges) side.push('blow');
  return { ring, side };
}

/**
 * Everything else the keyboard does, behind the button with three dots: the
 * number row, the keys of their own, the panels and the settings. The checks
 * hold this against the game's own key handler, so no key is left with no
 * way to press it on a phone.
 */
export const DRAWER = [
  { group: 'weapons', items: [
    { label: '1', key: 'Digit1' }, { label: '2', key: 'Digit2' }, { label: '3', key: 'Digit3' },
    { label: '4', key: 'Digit4' }, { label: '5', key: 'Digit5' }, { label: '6', key: 'Digit6' },
    { label: '7', key: 'Digit7' }, { label: '8', key: 'Digit8' }, { label: '9', key: 'Digit9' },
    { label: '0', key: 'Digit0' },
    { label: 'last', key: 'KeyQ', help: 'back to the last weapon' },
    { label: 'flamer', key: 'KeyZ' }, { label: 'fire bomb', key: 'KeyB' },
    { label: 'EMP', key: 'KeyX' }, { label: 'mech killer', key: 'KeyK' },
    { label: 'holster', key: 'KeyG', help: 'put it away; in The Hunt, a grenade' },
  ] },
  { group: 'moves', items: [
    { label: 'hit', key: 'Tab' }, { label: 'kick', key: 'Backquote' },
    { label: 'reflexes', key: 'KeyE' }, { label: 'blow charges', key: 'KeyT' },
    { label: 'mech view', key: 'KeyY' },
  ] },
  { group: 'the game', items: [
    { label: 'map', key: 'KeyM' }, { label: 'travel', key: 'KeyV' },
    { label: 'photo', key: 'KeyP' }, { label: 'journal', key: 'KeyJ' },
    { label: 'cheats', key: 'KeyC' }, { label: 'sound', key: 'KeyN' },
    { label: 'help', key: 'KeyH' }, { label: 'full screen', act: 'fullscreen' },
  ] },
  { group: 'settings', items: [
    { label: 'low', key: 'F1' }, { label: 'medium', key: 'F2' }, { label: 'high', key: 'F3' },
    { label: 'easy', key: 'F5' }, { label: 'normal', key: 'F6' }, { label: 'hard', key: 'F7' },
    { label: 'debug', key: 'F4' },
  ] },
];

/** Along the top, while you play: the pause, the map, the cheats and the rest. */
export const TOPBAR = [
  { id: 'pause', label: 'pause', key: 'Escape' },
  { id: 'map', label: 'map', key: 'KeyM' },
  { id: 'cheats', label: 'cheats', key: 'KeyC' },
  { id: 'more', label: '⋯', act: 'drawer', title: 'everything else' },
];

/** Every key a phone can press, from any button anywhere. */
export function touchKeys() {
  const keys = new Set();
  for (const b of Object.values(BUTTONS)) if (b.key) keys.add(b.key);
  for (const g of DRAWER) for (const it of g.items) if (it.key) keys.add(it.key);
  for (const t of TOPBAR) if (t.key) keys.add(t.key);
  return keys;
}
