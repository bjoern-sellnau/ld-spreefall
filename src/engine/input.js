// Keyboard, mouse with pointer lock, touch look plus a virtual stick, and the
// Gamepad API. One object holds the current intent, the game reads it.

import { stickVector, lookGain } from '../game/touch.js';

export class Input {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui || document.body;
    this.keys = new Set();
    this.moveX = 0;          // -1 left, +1 right
    this.moveZ = 0;          // -1 back, +1 forward
    this.lookX = 0;          // accumulated yaw delta, radians
    this.lookY = 0;          // accumulated pitch delta, radians
    this.run = false;
    this.jumpQueued = false;
    this.jumpHeld = false;   // held, for anything that climbs rather than hops
    this.pointerLocked = false;
    this.sensitivity = 0.0022;
    // Radians a pixel of drag turns you, asked each time so that it follows
    // the field of view; the game sets it to the camera's.
    this.touchGain = () => lookGain(68 * Math.PI / 180);
    // Held by a button on a phone: run, the way Shift is held. Kept apart
    // from run, which the stick and the keys set afresh every frame.
    this.touchRun = false;
    // Whether the stick pushed to its rim runs. On foot it does; in a car the
    // same input is the brake and in a helicopter the climb, so there the
    // game turns it off and the rim is only full throttle.
    this.stickRuns = true;
    this.gamepadIndex = null;
    this.onKeyPress = null;   // fn(code) for one shot bindings
    this.enabled = true;
    this.fire = false;        // primary held
    this.secondary = false;   // aim held
    this.onButton = null;     // fn(name) for a one shot button: 'bash' the middle one or R3, 'kick' B

    this._touchLook = null;
    this._touchStick = null;
    this._stickCentre = [0, 0];
    this._install();
  }

  _install() {
    const doc = document;
    doc.addEventListener('keydown', (e) => {
      if (e.repeat) { e.preventDefault(); return; }
      this.keys.add(e.code);
      if (this.onKeyPress) this.onKeyPress(e.code, e);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
        'F1', 'F2', 'F3'].includes(e.code)) e.preventDefault();
      if (e.code === 'Space') { this.jumpQueued = true; this.jumpHeld = true; }
    });
    doc.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.jumpHeld = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.jumpHeld = false; });

    doc.addEventListener('pointerlockchange', () => {
      this.pointerLocked = doc.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.pointerLocked);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.fire = true;
      if (e.button === 2) { this.secondary = true; e.preventDefault(); }
      // The middle button, the wheel pressed, which would otherwise start
      // the page scrolling by itself.
      if (e.button === 1) { e.preventDefault(); if (this.onButton) this.onButton('bash'); }
    });
    doc.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.secondary = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // The wheel cycles what you are holding. It only counts while the pointer
    // is locked, so scrolling the page before you start does not rummage
    // through your pockets.
    this.canvas.addEventListener('wheel', (e) => {
      if (!this.pointerLocked) return;
      e.preventDefault();
      if (this.onWheel) this.onWheel(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    window.addEventListener('blur', () => { this.fire = false; this.secondary = false; });

    doc.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      this.lookX += e.movementX * this.sensitivity;
      this.lookY += e.movementY * this.sensitivity;
    });

    // Touch: the left half of the screen drives the stick, the right half looks.
    const opts = { passive: false };
    this.canvas.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.45 && this._touchStick === null) {
          this._touchStick = t.identifier;
          this._stickCentre = [t.clientX, t.clientY];
          if (this.onStick) this.onStick(true, t.clientX, t.clientY, 0, 0);
        } else if (this._touchLook === null) {
          this._touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
      // Only a touch the browser lets us keep; one it has already given to
      // a scroll is left to it.
      if (e.cancelable) e.preventDefault();
    }, opts);
    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (this._touchStick === t.identifier) {
          const v = stickVector(t.clientX - this._stickCentre[0], t.clientY - this._stickCentre[1]);
          this.moveX = v.x;
          this.moveZ = v.z;
          this.run = (v.run && this.stickRuns) || this.touchRun;
          if (this.onStick) this.onStick(true, this._stickCentre[0], this._stickCentre[1], v.kx, v.ky);
        } else if (this._touchLook && this._touchLook.id === t.identifier) {
          const g = this.touchGain();
          this.lookX += (t.clientX - this._touchLook.x) * g;
          this.lookY += (t.clientY - this._touchLook.y) * g;
          this._touchLook.x = t.clientX;
          this._touchLook.y = t.clientY;
        }
      }
      if (e.cancelable) e.preventDefault();
    }, opts);
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this._touchStick === t.identifier) {
          this._touchStick = null;
          this.moveX = 0; this.moveZ = 0; this.run = this.touchRun;
          if (this.onStick) this.onStick(false, 0, 0, 0, 0);
        } else if (this._touchLook && this._touchLook.id === t.identifier) {
          this._touchLook = null;
        }
      }
      if (e.cancelable) e.preventDefault();
    };
    this.canvas.addEventListener('touchend', end, opts);
    this.canvas.addEventListener('touchcancel', end, opts);

    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
    });
  }

  requestLock() {
    if (this.canvas.requestPointerLock) {
      const r = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => this.canvas.requestPointerLock());
    }
  }

  exitLock() { if (document.exitPointerLock) document.exitPointerLock(); }

  isDown(code) { return this.keys.has(code); }

  /** Fold keyboard and gamepad into moveX, moveZ, run and jump for this frame. */
  poll() {
    if (!this.enabled) { this.moveX = 0; this.moveZ = 0; return; }
    let kx = 0, kz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) kz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) kz -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    let run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchRun;

    if (this.gamepadIndex !== null && navigator.getGamepads) {
      const gp = navigator.getGamepads()[this.gamepadIndex];
      if (gp) {
        const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
        const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
        const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
        if (lx || ly) { kx += lx; kz -= ly; }
        this.lookX += rx * 0.045;
        this.lookY += ry * 0.045;
        // L3 runs. The left trigger used to as well, but it aims now, and a
        // pad that sprints every time you bring the sight up is unusable.
        if (gp.buttons[10] && gp.buttons[10].pressed) run = true;
        if (gp.buttons[0] && gp.buttons[0].pressed) this.jumpQueued = true;
        if (gp.buttons[7] && gp.buttons[7].value > 0.4) this.fire = true;
        else if (this._padFire) this.fire = false;
        this._padFire = !!(gp.buttons[7] && gp.buttons[7].value > 0.4);
        const aimBtn = !!(gp.buttons[6] && gp.buttons[6].value > 0.4);
        if (aimBtn) this.secondary = true; else if (this._padAim) this.secondary = false;
        this._padAim = aimBtn;
        // R3 a blow with what is in your hands, B a kick, once a press.
        const r3 = !!(gp.buttons[11] && gp.buttons[11].pressed);
        const b = !!(gp.buttons[1] && gp.buttons[1].pressed);
        if (r3 && !this._padR3 && this.onButton) this.onButton('bash');
        if (b && !this._padB && this.onButton) this.onButton('kick');
        this._padR3 = r3;
        this._padB = b;
      }
    }

    if (kx || kz) {
      const l = Math.hypot(kx, kz);
      this.moveX = kx / Math.max(1, l);
      this.moveZ = kz / Math.max(1, l);
      this.run = run;
    } else if (this._touchStick === null) {
      this.moveX = 0; this.moveZ = 0; this.run = run;
    } else if (this.touchRun) {
      this.run = true;
    }
  }

  /** Consume the accumulated look delta. */
  takeLook() {
    const x = this.lookX, y = this.lookY;
    this.lookX = 0; this.lookY = 0;
    return [x, y];
  }

  takeJump() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }
}
