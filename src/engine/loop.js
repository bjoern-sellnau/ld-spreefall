// Fixed timestep simulation with interpolated rendering, so the physics is
// deterministic at 60 Hz whatever the display is doing.

export class Loop {
  constructor({ hz = 60, maxFrame = 0.25, onFixed, onRender }) {
    this.dt = 1 / hz;
    this.maxFrame = maxFrame;
    this.onFixed = onFixed;
    this.onRender = onRender;
    this.accumulator = 0;
    this.last = 0;
    this.running = false;
    this.frame = 0;
    this.stats = { fps: 0, frameMs: 0, simSteps: 0, drawCalls: 0, triangles: 0, tiles: 0 };
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._raf = null;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    let elapsed = (now - this.last) / 1000;
    this.last = now;
    if (elapsed > this.maxFrame) elapsed = this.maxFrame;

    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= this.dt && steps < 8) {
      this.onFixed(this.dt);
      this.accumulator -= this.dt;
      steps++;
    }
    if (steps === 8) this.accumulator = 0;   // give up rather than spiral

    const alpha = this.accumulator / this.dt;
    const t0 = performance.now();
    this.onRender(alpha, elapsed);
    const t1 = performance.now();

    this.stats.simSteps = steps;
    this.stats.frameMs = this.stats.frameMs * 0.9 + (t1 - t0) * 0.1;
    this._fpsAcc += elapsed;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.stats.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    this.frame++;
  }
}
