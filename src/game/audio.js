// All sound is synthesised at runtime on the raw Web Audio API. Nothing is
// downloaded, and the context is only created after the first user gesture.
//
// Beds: traffic near roads, water near the Spree, birds in the parks, a U-Bahn
// rumble near a station entrance. Footsteps are noise bursts filtered per
// surface, so cobblestone, asphalt and grass all sound different.

import { SURFACE } from '../shared/constants.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Audio {
  constructor(world) {
    this.world = world;
    this.ctx = null;
    this.enabled = false;
    this.master = null;
    this.beds = {};
    this.stepPhase = 0;
    this.lastStep = 0;
    this.birdTimer = 0;
    this._noiseBuffer = null;
  }

  /** Must be called from inside a user gesture handler. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.enabled = true;
      if (this.master) this.master.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.4);
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this._noiseBuffer = this._makeNoise(4);

    this.beds.traffic = this._trafficBed();
    this.beds.water = this._waterBed();
    this.beds.park = this._parkBed();
    this.beds.metro = this._metroBed();
    this.beds.city = this._cityBed();

    this.enabled = true;
    this.master.gain.setTargetAtTime(0.85, ctx.currentTime, 1.2);
  }

  mute() {
    if (!this.ctx) return;
    this.enabled = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
  }

  toggle() {
    if (!this.ctx || !this.enabled) { this.start(); return true; }
    this.mute();
    return false;
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Pink noise by the Voss McCartney method, which sounds much more like a
    // city than white noise does.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buf;
  }

  _bedSource(filterType, freq, q, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start(ctx.currentTime + Math.random() * 0.4);
    return { src, filter: f, gain: g, target: gain };
  }

  _trafficBed() {
    // A low rumble plus a band around 700 Hz, which is roughly where tyre noise
    // on asphalt sits.
    const a = this._bedSource('lowpass', 340, 0.7, 0.5);
    const b = this._bedSource('bandpass', 760, 0.9, 0.22);
    // A slow swell so it is not a flat hiss.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = this.ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg).connect(b.filter.frequency);
    lfo.start();
    return { parts: [a, b], level: 0 };
  }

  _waterBed() {
    const a = this._bedSource('bandpass', 420, 0.55, 0.42);
    const b = this._bedSource('highpass', 1400, 0.5, 0.10);
    return { parts: [a, b], level: 0 };
  }

  _parkBed() {
    const a = this._bedSource('bandpass', 2600, 1.6, 0.08);
    return { parts: [a], level: 0, birds: true };
  }

  _metroBed() {
    const a = this._bedSource('lowpass', 92, 1.4, 0.7);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lg = this.ctx.createGain();
    lg.gain.value = 0.35;
    lfo.connect(lg).connect(a.gain.gain);
    lfo.start();
    return { parts: [a], level: 0 };
  }

  _cityBed() {
    const a = this._bedSource('bandpass', 1200, 0.4, 0.05);
    return { parts: [a], level: 0 };
  }

  _setBed(bed, level) {
    if (!bed) return;
    bed.level = level;
    const t = this.ctx.currentTime;
    for (const p of bed.parts) p.gain.gain.setTargetAtTime(p.target * level, t, 0.6);
  }

  /** Distance from the player to the nearest road, cheaply, from the surface map. */
  _proximity(x, z, want, radius) {
    const s = this.world.surface;
    const step = s.step;
    const r = Math.ceil(radius / step);
    let best = Infinity;
    const ix0 = Math.round((x - this.world.minX) / step);
    const iz0 = Math.round((z - this.world.minZ) / step);
    for (let dz = -r; dz <= r; dz += 2) {
      for (let dx = -r; dx <= r; dx += 2) {
        const ix = ix0 + dx, iz = iz0 + dz;
        if (ix < 0 || iz < 0 || ix >= s.nx || iz >= s.nz) continue;
        if (s.data[iz * s.nx + ix] !== want) continue;
        const d = Math.hypot(dx, dz) * step;
        if (d < best) best = d;
      }
    }
    return best;
  }

  update(dt, player, camera) {
    if (!this.ctx || !this.enabled) return;
    const x = player.x, z = player.z;

    // Beds, recomputed a few times a second rather than every frame.
    this._bedTimer = (this._bedTimer || 0) - dt;
    if (this._bedTimer <= 0) {
      this._bedTimer = 0.35;
      const road = this._proximity(x, z, SURFACE.ASPHALT, 60);
      const water = this._proximity(x, z, SURFACE.WATER, 130);
      const grass = this._proximity(x, z, SURFACE.GRASS, 90);
      this._setBed(this.beds.traffic, clamp01(1 - road / 55) * 0.9);
      this._setBed(this.beds.water, clamp01(1 - water / 110));
      this._setBed(this.beds.park, clamp01(1 - grass / 70));
      this._setBed(this.beds.city, 0.5);
      let metro = 0;
      for (const st of (this.world.manifest.stations || [])) {
        const d = Math.hypot(st.x - x, st.z - z);
        metro = Math.max(metro, clamp01(1 - d / 70));
      }
      this._setBed(this.beds.metro, metro * 0.8);
    }

    // Birds, occasional chirps while near greenery.
    if (this.beds.park.level > 0.25) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.birdTimer = 1.4 + Math.random() * 4.5;
        this._chirp(this.beds.park.level);
      }
    }

    // Footsteps, driven by distance travelled rather than by a timer, so they
    // speed up when you run.
    const speed = Math.hypot(player.vx || 0, player.vz || 0);
    if (player.onGround && speed > 0.35) {
      this.stepPhase += speed * dt;
      const stride = speed > 4 ? 1.45 : 0.86;
      if (this.stepPhase >= stride) {
        this.stepPhase = 0;
        this._footstep(player.surface, Math.min(1, speed / 5));
      }
    } else {
      this.stepPhase = Math.min(this.stepPhase, 0.6);
    }
  }

  land(surface) { this._footstep(surface, 1.1); }

  // --- combat -------------------------------------------------------------

  /** The rifle. A short noise crack over a body thump, then a tail. */
  gunshot() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;

    // Crack: filtered noise with a very fast decay.
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.09);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.02, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    src.connect(hp).connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 3, 0.36);
    src.stop(t + 0.36);

    // Body: a low sine drop, which is what gives it weight on small speakers.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.10);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.26, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.18);
  }

  dryFire() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3200;
    f.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 3, 0.07);
    src.stop(t + 0.07);
  }

  /** Magazine out, magazine in, bolt. Three clicks spaced over the reload. */
  reload(duration) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const base = ctx.currentTime;
    const clicks = [[0.05, 2100, 0.07], [duration * 0.55, 1500, 0.09], [duration * 0.86, 2800, 0.06]];
    for (const [at, freq, gain] of clicks) {
      const t = base + at;
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = 3.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      src.connect(f).connect(g).connect(this.master);
      src.start(t, Math.random() * 3, 0.09);
      src.stop(t + 0.09);
    }
  }

  /** The confirmation tick when a shot connects. Pitched up for a core hit. */
  hitMarker(core) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(core ? 1750 : 1150, t);
    o.frequency.exponentialRampToValueAtTime(core ? 2400 : 1500, t + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(core ? 0.07 : 0.045, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.08);
  }

  droneDown() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.20, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 3, 0.65);
    src.stop(t + 0.65);
  }

  /** Taking a hit: a dull thud plus a short tinnitus ring. */
  playerHurt() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.32);

    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.value = 3100;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(0.020, t + 0.02);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    ring.connect(rg).connect(this.master);
    ring.start(t);
    ring.stop(t + 1.15);
  }

  /** The drone chorus: one rotor bed whose pitch and level track the nearest. */
  setDroneField(nearest, engaged) {
    if (!this.ctx || !this.enabled) return;
    if (!this.beds.rotor) this.beds.rotor = this._rotorBed();
    const bed = this.beds.rotor;
    const t = this.ctx.currentTime;
    const level = nearest === null ? 0 : clamp01(1 - nearest / 90);
    for (const p of bed.parts) {
      p.gain.gain.setTargetAtTime(p.target * level, t, 0.25);
    }
    if (bed.osc) {
      const hz = 62 + (1 - level) * 10 + engaged * 3;
      bed.osc.frequency.setTargetAtTime(hz, t, 0.3);
    }
  }

  _rotorBed() {
    const ctx = this.ctx;
    const a = this._bedSource('bandpass', 1450, 3.0, 0.16);
    const b = this._bedSource('highpass', 3400, 0.7, 0.05);
    // A buzzing sub under the hiss, amplitude modulated like a rotor.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 64;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 340;
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(f).connect(g).connect(this.master);
    osc.start();
    return { parts: [a, b, { gain: g, target: 0.085 }], osc, level: 0 };
  }

  _footstep(surface, force) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const off = Math.random() * 3;

    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    let dur = 0.09, peak = 0.13;
    switch (surface) {
      case SURFACE.COBBLE:
        f.type = 'bandpass'; f.frequency.value = 1700 + Math.random() * 500; f.Q.value = 2.6;
        dur = 0.075; peak = 0.20;
        break;
      case SURFACE.GRASS:
        f.type = 'bandpass'; f.frequency.value = 620 + Math.random() * 220; f.Q.value = 0.7;
        dur = 0.13; peak = 0.10;
        break;
      case SURFACE.GRAVEL:
        f.type = 'bandpass'; f.frequency.value = 2600 + Math.random() * 900; f.Q.value = 1.1;
        dur = 0.11; peak = 0.15;
        break;
      case SURFACE.STONE:
        f.type = 'bandpass'; f.frequency.value = 1250 + Math.random() * 400; f.Q.value = 2.0;
        dur = 0.085; peak = 0.17;
        break;
      case SURFACE.WATER:
        f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.6;
        dur = 0.2; peak = 0.13;
        break;
      default:
        f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 260; f.Q.value = 1.2;
        dur = 0.09; peak = 0.12;
    }
    peak *= force;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, off, dur + 0.05);
    src.stop(t + dur + 0.06);
  }

  _chirp(level) {
    const ctx = this.ctx;
    const t = ctx.currentTime + Math.random() * 0.2;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const base = 2200 + Math.random() * 1800;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.7), t + 0.05);
    o.frequency.exponentialRampToValueAtTime(base * 0.85, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.028 * level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }
}
