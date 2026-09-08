// Keyboard, mouse with pointer lock, touch look plus a virtual stick, and the
// Gamepad API. One object holds the current intent, the game reads it.

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
    this.pointerLocked = false;
    this.sensitivity = 0.0022;
    this.touchSensitivity = 0.0042;
    this.gamepadIndex = null;
    this.onKeyPress = null;   // fn(code) for one shot bindings
    this.enabled = true;

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
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.code === 'Space') this.jumpQueued = true;
    });
    doc.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    doc.addEventListener('pointerlockchange', () => {
      this.pointerLocked = doc.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.pointerLocked);
    });
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
      e.preventDefault();
    }, opts);
    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (this._touchStick === t.identifier) {
          const dx = t.clientX - this._stickCentre[0];
          const dy = t.clientY - this._stickCentre[1];
          const max = 56;
          const l = Math.hypot(dx, dy) || 1;
          const k = Math.min(1, l / max);
          this.moveX = (dx / l) * k;
          this.moveZ = -(dy / l) * k;
          this.run = k > 0.85;
          if (this.onStick) this.onStick(true, this._stickCentre[0], this._stickCentre[1], (dx / l) * k * max, (dy / l) * k * max);
        } else if (this._touchLook && this._touchLook.id === t.identifier) {
          this.lookX += (t.clientX - this._touchLook.x) * this.touchSensitivity;
          this.lookY += (t.clientY - this._touchLook.y) * this.touchSensitivity;
          this._touchLook.x = t.clientX;
          this._touchLook.y = t.clientY;
        }
      }
      e.preventDefault();
    }, opts);
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this._touchStick === t.identifier) {
          this._touchStick = null;
          this.moveX = 0; this.moveZ = 0; this.run = false;
          if (this.onStick) this.onStick(false, 0, 0, 0, 0);
        } else if (this._touchLook && this._touchLook.id === t.identifier) {
          this._touchLook = null;
        }
      }
      e.preventDefault();
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
    let run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    if (this.gamepadIndex !== null && navigator.getGamepads) {
      const gp = navigator.getGamepads()[this.gamepadIndex];
      if (gp) {
        const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
        const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
        const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
        if (lx || ly) { kx += lx; kz -= ly; }
        this.lookX += rx * 0.045;
        this.lookY += ry * 0.045;
        if (gp.buttons[10] && gp.buttons[10].pressed) run = true;
        if (gp.buttons[6] && gp.buttons[6].value > 0.5) run = true;
        if (gp.buttons[0] && gp.buttons[0].pressed) this.jumpQueued = true;
      }
    }

    if (kx || kz) {
      const l = Math.hypot(kx, kz);
      this.moveX = kx / Math.max(1, l);
      this.moveZ = kz / Math.max(1, l);
      this.run = run;
    } else if (this._touchStick === null) {
      this.moveX = 0; this.moveZ = 0; this.run = false;
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
