// Fixed timestep simulation with interpolated rendering, so the physics is
// deterministic at 60 Hz whatever the display is doing.

export class Loop {
  constructor({ hz = 60, maxFrame = 0.25, onFixed, onRender }) {
    this.dt = 1 / hz;
    this.maxFrame = maxFrame;
    this.onFixed = onFixed;
    this.onRender = onRender;
    this.accumulator = 0;
    // Seconds of simulation that have actually been run. On a machine slow
    // enough for the frame clamp to bite this falls behind the wall clock,
    // which is the point: anything measuring a rate per second has to measure
    // it against this and not against how long it sat there waiting.
    this.simTime = 0;
    this.last = 0;
    this.running = false;
    this.frame = 0;
    // frameMs is the cost of our own render call. intervalMs is the wall clock
    // between frames, which is the only number that knows about the GPU: the
    // draw calls return long before the work is done, so a dynamic resolution
    // controller fed frameMs would think a machine at four frames a second had
    // plenty of headroom.
    this.stats = {
      fps: 0, frameMs: 0, intervalMs: 16.7, simSteps: 0, drawCalls: 0, triangles: 0, tiles: 0,
    };
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._raf = null;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    // The clock is taken from the first frame callback rather than from here.
    // They are not the same reading: a callback is stamped with the time its
    // frame began, and switching the loop on in the middle of a slow frame
    // put `last` a long way ahead of the stamp that came after it.
    this.last = 0;
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
    if (!this.last) this.last = now;
    let elapsed = (now - this.last) / 1000;
    this.last = now;
    if (elapsed > this.maxFrame) elapsed = this.maxFrame;
    // A frame cannot have taken less than no time, and one that says it did
    // used to be believed: the accumulator went seconds into the red and the
    // simulation stood still, rendering all the while, until the wall clock
    // had caught up with it. That is what a city that kept drawing while
    // nothing in it moved was, and it was worst in the first seconds after
    // the loading screen, which is when the frames are slowest.
    if (elapsed < 0) elapsed = 0;

    this.accumulator += elapsed;
    // The cap has to cover a whole clamped frame, otherwise a slow machine runs
    // the simulation in slow motion instead of just at a lower frame rate:
    // maxFrame seconds of simulation at dt each.
    const maxSteps = Math.ceil(this.maxFrame / this.dt) + 1;
    let steps = 0;
    while (this.accumulator >= this.dt && steps < maxSteps) {
      this.onFixed(this.dt);
      this.accumulator -= this.dt;
      this.simTime += this.dt;
      steps++;
    }
    if (steps === maxSteps) this.accumulator = 0;   // give up rather than spiral

    const alpha = this.accumulator / this.dt;
    const t0 = performance.now();
    this.onRender(alpha, elapsed);
    const t1 = performance.now();

    this.stats.intervalMs = this.stats.intervalMs * 0.9 + Math.min(500, elapsed * 1000) * 0.1;
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
