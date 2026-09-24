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
  // One synth, four voices. A rifle cracks, a shotgun thumps and hisses, a
  // launcher is mostly the rush of its own exhaust, and throwing something is
  // just cloth and air.
  static SHOT = {
    rifle: { crackHz: 2600, sweepHz: 700, crackGain: 0.42, tail: 0.30,
      bodyHz: 190, bodyEnd: 48, bodyGain: 0.26, bodyTail: 0.16, hp: 900 },
    shotgun: { crackHz: 1500, sweepHz: 320, crackGain: 0.52, tail: 0.46,
      bodyHz: 140, bodyEnd: 34, bodyGain: 0.38, bodyTail: 0.26, hp: 420 },
    rpg: { crackHz: 900, sweepHz: 220, crackGain: 0.5, tail: 0.85,
      bodyHz: 110, bodyEnd: 28, bodyGain: 0.34, bodyTail: 0.5, hp: 220 },
    throw: { crackHz: 3200, sweepHz: 1400, crackGain: 0.12, tail: 0.14,
      bodyHz: 260, bodyEnd: 120, bodyGain: 0.05, bodyTail: 0.08, hp: 1400 },
    // A rail shot is a crack and a long metallic ring after it.
    rail: { crackHz: 5200, sweepHz: 900, crackGain: 0.40, tail: 0.95,
      bodyHz: 420, bodyEnd: 60, bodyGain: 0.30, bodyTail: 0.7, hp: 600 },
    // Plasma is more tone than noise, which is what makes it sound like energy
    // rather than gunpowder.
    plasma: { crackHz: 1800, sweepHz: 2600, crackGain: 0.14, tail: 0.18,
      bodyHz: 520, bodyEnd: 900, bodyGain: 0.22, bodyTail: 0.14, hp: 700 },
  };

  gunshot(kind = 'rifle') {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const v = Audio.SHOT[kind] || Audio.SHOT.rifle;
    const t = ctx.currentTime;

    // Crack: filtered noise with a very fast decay.
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = v.hp;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(v.crackHz, t);
    bp.frequency.exponentialRampToValueAtTime(v.sweepHz, t + 0.09);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v.crackGain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(v.crackGain * 0.05, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.tail);
    src.connect(hp).connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 3, v.tail + 0.06);
    src.stop(t + v.tail + 0.06);

    // Body: a low sine drop, which is what gives it weight on small speakers.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(v.bodyHz, t);
    o.frequency.exponentialRampToValueAtTime(v.bodyEnd, t + 0.10);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(v.bodyGain, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + v.bodyTail);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + v.bodyTail + 0.02);
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

  /**
   * A blast: a crack of noise on top, a body that drops an octave and a half,
   * and a tail long enough to bounce off the buildings that are not modelled
   * as reflectors. Cheap, and it reads as a long way away from a rifle.
   */
  explosion() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.62, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 3, 1.6);
    src.stop(t + 1.6);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.55);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.85);
  }

  /**
   * The shield going down: a hard electrical crack with a falling tone under
   * it. It has to be unmistakable, because it is the only warning you get that
   * the next hit is the one that hurts.
   */
  shieldBreak() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(4200, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.35);
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 3, 0.5);
    src.stop(t + 0.5);

    for (const [hz, end, at, gain] of [[880, 180, 0, 0.16], [1320, 240, 0.02, 0.1]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(hz, t + at);
      o.frequency.exponentialRampToValueAtTime(end, t + at + 0.4);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t + at);
      og.gain.exponentialRampToValueAtTime(gain, t + at + 0.01);
      og.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.45);
      o.connect(og).connect(this.master);
      o.start(t + at);
      o.stop(t + at + 0.5);
    }
  }

  /**
   * The shield coming back: a tone that rises while it charges and resolves
   * when it is full, held as long as the recharge takes rather than fired and
   * forgotten, so the sound tells you how far along it is.
   */
  shieldCharge(on, seconds = 2.4) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) {
      return;
    }
    const t = ctx.currentTime;
    if (!on) {
      if (this._shieldOsc) {
        this._shieldGain.gain.cancelScheduledValues(t);
        this._shieldGain.gain.setTargetAtTime(0.0001, t, 0.05);
        const osc = this._shieldOsc;
        osc.stop(t + 0.4);
        this._shieldOsc = null;
        this._shieldGain = null;
      }
      return;
    }
    if (this._shieldOsc) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(760, t + Math.max(0.3, seconds));
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 7.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 26;
    lfo.connect(lfoGain).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    lfo.start(t);
    lfo.stop(t + Math.max(0.3, seconds) + 0.6);
    this._shieldOsc = o;
    this._shieldGain = g;
  }

  /** The chime when it is full again, so you know you can step out. */
  shieldFull() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    for (const [hz, at] of [[784, 0], [1046, 0.07]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.10, t + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.30);
      o.connect(g).connect(this.master);
      o.start(t + at);
      o.stop(t + at + 0.34);
    }
  }

  /**
   * Entering and leaving the slow: a swept filter on everything, so the city
   * goes underwater, plus a sub tone that sits under the whole thing. The
   * master chain grows a lowpass the first time this is called, which keeps the
   * ordinary graph as cheap as it was.
   */
  reflex(on) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    this._ensureSlowFilter();
    if (!this._slowFilter) return;
    this._slowFilter.frequency.cancelScheduledValues(t);
    this._slowFilter.frequency.setTargetAtTime(on ? 620 : 20000, t, 0.12);
    if (on) {
      if (this._slowOsc) return;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + 0.18);
      o.connect(g).connect(this.master);
      o.start(t);
      this._slowOsc = o;
      this._slowGain = g;
    } else if (this._slowOsc) {
      this._slowGain.gain.cancelScheduledValues(t);
      this._slowGain.gain.setTargetAtTime(0.0001, t, 0.1);
      this._slowOsc.stop(t + 0.6);
      this._slowOsc = null;
      this._slowGain = null;
    }
  }

  _ensureSlowFilter() {
    if (this._slowFilter || !this.ctx || !this.master) return;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 20000;
    f.Q.value = 0.7;
    // Splice it in front of the destination without disturbing anything that
    // is already connected to the master bus.
    try {
      this.master.disconnect();
    } catch { /* nothing was connected yet */ }
    this.master.connect(f);
    f.connect(this._masterDestination || this.ctx.destination);
    this._slowFilter = f;
  }

  /** The rotor bed drops in pitch with the world, which sells the slow. */
  setTimeScale(scale) {
    const bed = this.beds && this.beds.rotor;
    if (!bed || !bed.osc || !this.ctx) return;
    this._timeScale = scale;
  }

  /**
   * A jet going past: noise swept from bright to dark with a doppler drop in
   * the body of it. It is a fly by rather than a positional loop, because what
   * matters is that you hear the pass coming and know to move.
   */
  jetPass() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 0.9);
    bp.frequency.exponentialRampToValueAtTime(260, t + 2.2);
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.30, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.22, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.setValueAtTime(-0.8, t);
      pan.pan.linearRampToValueAtTime(0.8, t + 2.0);
      src.connect(bp).connect(g).connect(pan).connect(this.master);
    } else {
      src.connect(bp).connect(g).connect(this.master);
    }
    src.start(t, Math.random() * 3, 2.8);
    src.stop(t + 2.8);

    // The engine note under it, dropping as it goes away.
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(88, t);
    o.frequency.setValueAtTime(88, t + 0.9);
    o.frequency.exponentialRampToValueAtTime(52, t + 2.2);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.09, t + 0.7);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 2.6);
  }

  /** Two quick clicks: one weapon down, the next one up. */
  swap() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    for (const [at, hz, level] of [[0, 2100, 0.075], [0.085, 3000, 0.095]]) {
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = hz;
      f.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(level, t + at + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.055);
      src.connect(f).connect(g).connect(this.master);
      src.start(t + at, Math.random() * 3, 0.07);
      src.stop(t + at + 0.07);
    }
  }

  /** The thrust of a reflex leap: a short upward whoosh. */
  leap() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.28);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 3, 0.4);
    src.stop(t + 0.4);
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
