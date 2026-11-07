// The buttons on a phone. What is shown where, and what each one sends, is
// game/touch.js; this puts it on the page and listens to the thumbs.
//
// Touch events rather than pointer events, the way the stick and the look
// on the canvas already listen, so each thumb is followed by its own
// identifier from the moment it comes down to the moment it lifts, wherever
// it slides to, and a held button is let go however the thumb leaves it.

import { BUTTONS, DRAWER, TOPBAR, padFor, padLayout } from '../game/touch.js';

export class TouchPad {
  /**
   * @param {HTMLElement} root the layer the buttons go in
   * @param {import('../engine/input.js').Input} input
   * @param {{press:(code:string)=>void, wheel:(dir:number)=>void,
   *   fullscreen:()=>void}} hooks what a button can ask the game for
   */
  constructor(root, input, hooks) {
    this.root = root;
    this.input = input;
    this.hooks = hooks;
    this.held = new Map();      // touch identifier -> { id, x, y }
    this.buttons = {};
    this.shown = '';
    this.size = '';
    this.drawerOpen = false;
    this.aimOn = false;         // the sight is up because the aim button put it up
    this._build();
  }

  _build() {
    const pad = document.createElement('div');
    pad.id = 'tpad';
    for (const [id, b] of Object.entries(BUTTONS)) {
      const el = document.createElement('button');
      el.className = `tb tb-${id} hidden`;
      el.dataset.id = id;
      el.textContent = b.label;
      el.setAttribute('aria-label', b.title || b.label);
      pad.appendChild(el);
      this.buttons[id] = el;
    }
    this.root.appendChild(pad);
    this.pad = pad;
    // The room the buttons have, inside the notch and the home bar, kept as
    // it changes rather than measured every frame.
    this.box = { w: window.innerWidth, h: window.innerHeight };
    const measure = () => {
      const w = pad.clientWidth, h = pad.clientHeight;
      if (w > 0 && h > 0) this.box = { w, h };
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(pad);
    window.addEventListener('resize', measure);

    const top = document.createElement('div');
    top.id = 'ttop';
    for (const t of TOPBAR) {
      const el = document.createElement('button');
      el.className = 'tt';
      el.dataset.top = t.id;
      el.textContent = t.label;
      el.setAttribute('aria-label', t.title || t.label);
      el.addEventListener('click', (e) => {
        e.preventDefault();
        if (t.act === 'drawer') this.toggleDrawer();
        else { this.toggleDrawer(false); this.hooks.press(t.key); }
      });
      top.appendChild(el);
    }
    this.root.appendChild(top);
    this.top = top;

    const drawer = document.createElement('div');
    drawer.id = 'tdrawer';
    drawer.className = 'hidden';
    for (const g of DRAWER) {
      const head = document.createElement('div');
      head.className = 'tdhead';
      head.textContent = g.group;
      drawer.appendChild(head);
      const row = document.createElement('div');
      row.className = `tdrow tdrow-${g.group.replace(/\s+/g, '')}`;
      for (const it of g.items) {
        const el = document.createElement('button');
        el.className = 'td';
        el.textContent = it.label;
        if (it.key) el.dataset.key = it.key;
        if (it.help) el.title = it.help;
        el.addEventListener('click', (e) => {
          e.preventDefault();
          this.toggleDrawer(false);
          if (it.act === 'fullscreen') this.hooks.fullscreen();
          else this.hooks.press(it.key);
        });
        row.appendChild(el);
      }
      drawer.appendChild(row);
    }
    const close = document.createElement('button');
    close.className = 'td tdclose';
    close.textContent = 'close';
    close.addEventListener('click', (e) => { e.preventDefault(); this.toggleDrawer(false); });
    drawer.appendChild(close);
    this.root.appendChild(drawer);
    this.drawer = drawer;

    const opts = { passive: false };
    pad.addEventListener('touchstart', (e) => this._start(e), opts);
    pad.addEventListener('touchmove', (e) => this._move(e), opts);
    pad.addEventListener('touchend', (e) => this._end(e), opts);
    pad.addEventListener('touchcancel', (e) => this._end(e), opts);
  }

  toggleDrawer(on = !this.drawerOpen) {
    this.drawerOpen = on;
    this.drawer.classList.toggle('hidden', !on);
    this.top.querySelector('[data-top=more]').classList.toggle('on', on);
  }

  _start(e) {
    if (e.cancelable) e.preventDefault();
    for (const t of e.changedTouches) {
      const el = t.target && t.target.closest ? t.target.closest('.tb') : null;
      if (!el) continue;
      const id = el.dataset.id;
      this.held.set(t.identifier, { id, x: t.clientX, y: t.clientY });
      el.classList.add('down');
      this._down(id);
    }
  }

  _move(e) {
    if (e.cancelable) e.preventDefault();
    for (const t of e.changedTouches) {
      const h = this.held.get(t.identifier);
      if (!h) continue;
      // The fire button looks as well: a thumb on it that slides turns you,
      // so you can hold the trigger and follow what you are shooting at.
      if (BUTTONS[h.id].look) {
        const g = this.input.touchGain();
        this.input.lookX += (t.clientX - h.x) * g;
        this.input.lookY += (t.clientY - h.y) * g;
      }
      h.x = t.clientX; h.y = t.clientY;
    }
  }

  _end(e) {
    if (e.cancelable) e.preventDefault();
    for (const t of e.changedTouches) {
      const h = this.held.get(t.identifier);
      if (!h) continue;
      this.held.delete(t.identifier);
      if (![...this.held.values()].some((o) => o.id === h.id)) {
        this.buttons[h.id].classList.remove('down');
        this._up(h.id);
      }
    }
  }

  _down(id) {
    const b = BUTTONS[id];
    const inp = this.input;
    if (b.key) this.hooks.press(b.key);
    else if (b.wheel) this.hooks.wheel(b.wheel);
    else if (b.toggle === 'aim') { inp.secondary = !inp.secondary; this.aimOn = inp.secondary; }
    else if (b.hold === 'fire') inp.fire = true;
    else if (b.hold === 'aim') inp.secondary = true;
    else if (b.hold === 'run') inp.touchRun = true;
    else if (b.hold === 'jump') { inp.jumpQueued = true; inp.jumpHeld = true; }
  }

  _up(id) {
    const b = BUTTONS[id];
    const inp = this.input;
    if (b.hold === 'fire') inp.fire = false;
    else if (b.hold === 'aim') inp.secondary = false;
    else if (b.hold === 'run') inp.touchRun = false;
    else if (b.hold === 'jump') inp.jumpHeld = false;
  }

  /** Lets go of everything a thumb is holding, and the sight with it. */
  release() {
    for (const h of this.held.values()) {
      this.buttons[h.id].classList.remove('down');
      this._up(h.id);
    }
    this.held.clear();
    this.input.touchRun = false;
  }

  /**
   * Once a frame: which buttons for where you are, where they go for the
   * size of the screen, and what the ones that change say.
   *
   * @param {object} c what padFor takes, and labels: {id: text} to put on
   *   buttons whose words follow the game (the phone's hacks)
   */
  update(c, w = this.box.w, h = this.box.h) {
    const pad = padFor(c);
    const key = `${pad.ring.join()}|${pad.side.join()}`;
    const size = `${w}x${h}`;
    if (key !== this.shown || size !== this.size) {
      // Whatever a thumb held on a button that is going is let go of.
      const keep = new Set([...pad.ring, ...pad.side]);
      for (const [tid, hd] of this.held) {
        if (keep.has(hd.id)) continue;
        this.buttons[hd.id].classList.remove('down');
        this._up(hd.id);
        this.held.delete(tid);
      }
      for (const [id, el] of Object.entries(this.buttons)) el.classList.toggle('hidden', !keep.has(id));
      // A sight left up on foot is not carried into a vehicle, where the same
      // input is the helicopter going down or a mech's rocket pod.
      if (!keep.has('aim') && this.aimOn) { this.input.secondary = false; this.aimOn = false; }
      for (const p of padLayout(pad, w, h)) {
        const el = this.buttons[p.id];
        el.style.left = `${(p.x - p.r).toFixed(1)}px`;
        el.style.top = `${(p.y - p.r).toFixed(1)}px`;
        el.style.width = el.style.height = `${(p.r * 2).toFixed(1)}px`;
      }
      this.shown = key;
      this.size = size;
    }
    if (!c.playing && this.held.size) this.release();
    if (!c.playing && this.drawerOpen && !c.intro) this.toggleDrawer(false);
    this.top.classList.toggle('hidden', !c.playing);
    if (this.aimOn && !this.input.secondary) this.aimOn = false;
    this.buttons.aim.classList.toggle('on', !!this.input.secondary);
    const labels = c.labels || {};
    for (const id of ['hack1', 'hack2']) {
      const want = labels[id] || BUTTONS[id].label;
      if (this.buttons[id].textContent !== want) this.buttons[id].textContent = want;
    }
  }
}

/**
 * A map under the thumb: one finger drags it, two pinch it in and out. A
 * tap is left alone, so it reaches the map as the click it already answers.
 *
 * @param {HTMLElement} el
 * @param {{on:()=>boolean, pan:(dx:number, dy:number)=>void,
 *   zoom:(cx:number, cy:number, factor:number)=>void}} map
 */
export function touchMap(el, map) {
  let one = null, two = null;
  const pair = (ts) => {
    const a = ts[0], b = ts[1];
    return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
      cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
  };
  el.addEventListener('touchstart', (e) => {
    if (!map.on()) return;
    if (e.touches.length >= 2) { two = pair(e.touches); one = null; } else {
      one = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!map.on()) return;
    if (e.cancelable) e.preventDefault();
    if (e.touches.length >= 2 && two) {
      const p = pair(e.touches);
      map.zoom(p.cx, p.cy, p.d / two.d);
      two = p;
    } else if (one && e.touches.length === 1) {
      const t = e.touches[0];
      map.pan(t.clientX - one.x, t.clientY - one.y);
      one = { x: t.clientX, y: t.clientY };
    }
  }, { passive: false });
  const end = (e) => {
    if (e.touches.length < 2) two = null;
    if (e.touches.length === 0) one = null;
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}
