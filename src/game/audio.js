// All sound is synthesised at runtime on the raw Web Audio API. Nothing is
// downloaded, and the context is only created after the first user gesture.
//
// Beds: traffic near roads, water near the Spree, birds in the parks, a U-Bahn
// rumble near a station entrance. Footsteps are noise bursts filtered per
// surface, so cobblestone, asphalt and grass all sound different.

import { thunderShape, rumbleCurve } from './thunder.js';
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

  /** Rain on the city: a hiss high up and a softer patter under it. */
  _rainBed() {
    const a = this._bedSource('highpass', 2600, 0.5, 0.16);
    const b = this._bedSource('bandpass', 900, 0.6, 0.12);
    return { parts: [a, b], level: 0 };
  }

  /** Wind: low, and swelling in gusts. */
  _windBed() {
    const a = this._bedSource('lowpass', 380, 0.9, 0.34);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = this.ctx.createGain();
    lg.gain.value = 160;
    lfo.connect(lg).connect(a.filter.frequency);
    lfo.start();
    return { parts: [a], level: 0 };
  }

  /** How hard it is raining and blowing, for the two beds. */
  setWeather(rain, wind) {
    if (!this.ctx || !this.enabled) return;
    if (!this.beds.rain) this.beds.rain = this._rainBed();
    if (!this.beds.wind) this.beds.wind = this._windBed();
    this._setBed(this.beds.rain, Math.min(1.2, rain));
    this._setBed(this.beds.wind, Math.min(1.2, wind * wind));
  }

  /**
   * The siren for the extreme weather, the way the warning sirens in
   * Germany do it: a howl rising and falling for a warning, a steady tone
   * for the all clear, and between, short beeps as the count runs down.
   * Shortened from the real minute, since a game has to get on. Not
   * `siren`: that is the camp's, further down, and a second method of the
   * same name would put this one out of reach.
   */
  warnSiren(what) {
    this.lastWarn = what;
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = ctx.createGain();
    if (what === 'count') {
      o.type = 'square';
      o.frequency.setValueAtTime(880, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(lp).connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.2);
      return;
    }
    const len = what === 'clear' ? 3.5 : 4.5;
    if (what === 'clear') {
      o.frequency.setValueAtTime(420, t);
    } else {
      // Up and down, twice over the length of it.
      o.frequency.setValueAtTime(300, t);
      for (let k = 0; k < 4; k++) {
        o.frequency.linearRampToValueAtTime(k % 2 ? 300 : 520, t + (k + 1) * len / 4);
      }
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.5);
    g.gain.setValueAtTime(0.16, t + len - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  /**
   * The beds under the extreme weather, each nought to one at where you
   * are: acid hissing on everything, a firestorm's roar, a tornado's, louder
   * the nearer the funnel, and the hum of an ion storm.
   */
  setExtreme(acid = 0, fire = 0, tornado = 0, ion = 0) {
    if (!this.ctx || !this.enabled) return;
    const want = acid + fire + tornado + ion > 0.001;
    if (!want && !this.beds.acid) return;
    if (!this.beds.acid) {
      this.beds.acid = { parts: [this._bedSource('highpass', 4200, 0.8, 0.22), this._bedSource('bandpass', 2200, 2.5, 0.1)], level: 0 };
      this.beds.firestorm = { parts: [this._bedSource('lowpass', 520, 0.7, 0.5), this._bedSource('bandpass', 1400, 1.2, 0.12)], level: 0 };
      const roar = this._bedSource('bandpass', 140, 0.8, 0.9);
      const whistle = this._bedSource('bandpass', 760, 6, 0.08);
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.31;
      const lg = this.ctx.createGain();
      lg.gain.value = 60;
      lfo.connect(lg).connect(roar.filter.frequency);
      lfo.start();
      this.beds.tornado = { parts: [roar, whistle], level: 0 };
      this.beds.ion = { parts: [this._bedSource('bandpass', 100, 8, 0.25), this._bedSource('highpass', 6000, 0.7, 0.05)], level: 0 };
    }
    this._setBed(this.beds.acid, Math.min(1, acid));
    this._setBed(this.beds.firestorm, Math.min(1, fire));
    this._setBed(this.beds.tornado, Math.min(1.3, tornado));
    this._setBed(this.beds.ion, Math.min(1, ion));
  }

  /** An ion bolt landing this far off: a hard electric crack and a buzz. */
  ionZap(distance = 50) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + distance / 343;
    const near = Math.max(0.05, Math.min(1, 60 / Math.max(10, distance)));
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(5200, t);
    bp.frequency.exponentialRampToValueAtTime(600, t + 0.5);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * near, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 3);
    src.stop(t + 0.65);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.4);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.25 * near, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  /**
   * Thunder from a strike this far off, as long after the flash as sound
   * takes to cover the distance, about three seconds a kilometre. Close to,
   * a sharp crack and a tearing over the first third of a second, and a
   * thump; then, near or far, the roll: low noise under fifty cycles or so,
   * coming and going in claps as the sound of the rest of the channel
   * arrives, for ten seconds or more. The further, the less of the top end
   * the air has left in it. The shape is game/thunder.js.
   */
  thunder(distance = 1000, speed = 343) {
    this.lastThunder = { distance, delay: distance / speed };
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const shape = thunderShape(distance);
    this.lastThunder.shape = shape;
    const t0 = ctx.currentTime + distance / speed;
    if (!this._brownBuffer) this._brownBuffer = this._makeBrown(9);
    // Everything goes through the air on the way to you.
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = shape.air;
    air.Q.value = 0.5;
    air.connect(this.master);

    if (shape.crack > 0) {
      // The tearing: a run of short bright cracks, bunched at the start.
      const tears = Math.round(6 + shape.crack * 12);
      for (let k = 0; k < tears; k++) {
        const at = t0 + 0.36 * Math.pow(Math.random(), 1.6);
        const src = ctx.createBufferSource();
        src.buffer = this._noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 900 + Math.random() * 3200;
        bp.Q.value = 0.9;
        const g = ctx.createGain();
        const peak = shape.loud * shape.crack * (0.35 + Math.random() * 0.65) * 1.1;
        const len = 0.02 + Math.random() * 0.07;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(peak, at + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        src.connect(bp).connect(g).connect(air);
        src.start(at, Math.random() * 3);
        src.stop(at + len + 0.02);
      }
      // The crack itself: everything at once, and a thump under it.
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 180;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(shape.loud * shape.crack * 1.2, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(shape.loud * shape.crack * 0.25, t0 + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
      src.connect(hp).connect(g).connect(air);
      src.start(t0, Math.random() * 3);
      src.stop(t0 + 0.75);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(70, t0);
      o.frequency.exponentialRampToValueAtTime(28, t0 + 0.9);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.exponentialRampToValueAtTime(shape.loud * shape.crack * 0.7, t0 + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
      o.connect(og).connect(this.master);
      o.start(t0);
      o.stop(t0 + 1.2);
    }

    // The roll: deep noise, low passed to the rumble and swelling with each
    // clap, with a second, brighter layer for the first of it.
    const roll = ctx.createBufferSource();
    roll.buffer = this._brownBuffer;
    roll.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = shape.rumble;
    lp.Q.value = 0.7;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 55;
    body.Q.value = 0.9;
    body.gain.value = 6;
    const g = ctx.createGain();
    // The curve is the only thing on this gain: a value set at the same time
    // as a curve starts is one the browser refuses.
    g.gain.value = 0.0001;
    const start = t0 + (shape.crack > 0 ? 0.08 : 0);
    g.gain.setValueCurveAtTime(rumbleCurve(shape), start, shape.roll);
    roll.connect(lp).connect(body).connect(g).connect(air);
    roll.start(start, Math.random() * 6);
    roll.stop(start + shape.roll + 0.1);
    const hi = ctx.createBufferSource();
    hi.buffer = this._brownBuffer;
    hi.loop = true;
    const hlp = ctx.createBiquadFilter();
    hlp.type = 'lowpass';
    hlp.frequency.value = Math.min(shape.air, 900);
    const hg = ctx.createGain();
    const first = Math.min(3, shape.roll * 0.3);
    hg.gain.setValueAtTime(0.0001, start);
    hg.gain.exponentialRampToValueAtTime(shape.loud * 0.35, start + 0.15);
    hg.gain.exponentialRampToValueAtTime(0.0001, start + first);
    hi.connect(hlp).connect(hg).connect(air);
    hi.start(start, Math.random() * 6);
    hi.stop(start + first + 0.1);
  }

  /** Brown noise: white noise added up, so it is all low end, the stuff of a roll. */
  _makeBrown(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    // Faded at the ends, so it loops without a click.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) { d[i] *= i / fade; d[len - 1 - i] *= i / fade; }
    return buf;
  }

  _setBed(bed, level) {
    if (!bed) return;
    bed.level = level;
    const t = this.ctx.currentTime;
    for (const p of bed.parts) p.gain.gain.setTargetAtTime(p.target * level, t, 0.6);
  }

  /**
   * Distance from the player to the nearest road, cheaply, from the surface
   * map. The map belongs to the district you are standing in, and how fine it
   * is depends on that district's tier, so both come from there rather than
   * from the city.
   */
  _proximity(x, z, want, radius) {
    const index = this.world.tileIndex(x, z);
    const rec = index >= 0 ? this.world.tiles[index] : null;
    if (!rec) return Infinity;
    const s = rec.d.surface;
    const step = s.step;
    const r = Math.ceil(radius / step);
    let best = Infinity;
    const ix0 = Math.round((x - s.minX) / step);
    const iz0 = Math.round((z - s.minZ) / step);
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

  /** The rifle. A snap, a crack, a thump with weight in it, then the street answering. */
  // One synth, many voices. A rifle cracks, a shotgun thumps and hisses, a
  // launcher is mostly the rush of its own exhaust, and throwing something is
  // just cloth and air.
  //
  // What makes a shot hit rather than tick is mostly four things, and each is
  // a number here: snap, a millisecond and a half of unfiltered noise that is
  // the leading edge of the report; boom, the low middle under the crack that
  // a small speaker can still play; a body that starts high and drops fast
  // and is driven into a soft clip so it has harmonics a laptop can
  // reproduce; and echo, the slap of the report off the facades across the
  // street a tenth of a second later.
  //
  // And two more, for punch, which is what the guides on weapon sound for
  // games say a shot that sounds weak is missing: kick, a dry sine thump that
  // drops from 110 to 50 Hz in a few hundredths of a second and stays out of
  // the clip, the low end a laptop can still just play; and mech, the click
  // of the action a few milliseconds ahead of the report, which makes the
  // gun sound bigger than the bang alone.
  static SHOT = {
    rifle: { crackHz: 2600, sweepHz: 700, crackGain: 0.42, tail: 0.30,
      bodyHz: 190, bodyEnd: 48, bodyGain: 0.26, bodyTail: 0.16, hp: 900,
      snap: 0.9, boom: 0.22, drive: 2.2, echo: 0.30,
      kick: 0.3, mech: 0.28 },
    shotgun: { crackHz: 1500, sweepHz: 320, crackGain: 0.52, tail: 0.46,
      bodyHz: 140, bodyEnd: 34, bodyGain: 0.38, bodyTail: 0.26, hp: 420,
      snap: 1.0, boom: 0.34, drive: 2.8, echo: 0.36,
      kick: 0.41, mech: 0.32 },
    rpg: { crackHz: 900, sweepHz: 220, crackGain: 0.5, tail: 0.85,
      bodyHz: 110, bodyEnd: 28, bodyGain: 0.34, bodyTail: 0.5, hp: 220,
      snap: 0.35, boom: 0.5, drive: 2.0, echo: 0.4,
      kick: 0.33, mech: 0.0 },
    throw: { crackHz: 3200, sweepHz: 1400, crackGain: 0.12, tail: 0.14,
      bodyHz: 260, bodyEnd: 120, bodyGain: 0.05, bodyTail: 0.08, hp: 1400,
      snap: 0, boom: 0, drive: 1, echo: 0,
      kick: 0.0, mech: 0, level: 0.6 },
    // A rail shot is a crack and a long metallic ring after it.
    rail: { crackHz: 5200, sweepHz: 900, crackGain: 0.40, tail: 0.95,
      bodyHz: 420, bodyEnd: 60, bodyGain: 0.30, bodyTail: 0.7, hp: 600,
      snap: 0.5, boom: 0.22, drive: 1.8, echo: 0.32,
      kick: 0.25, mech: 0.22 },
    // Plasma is more tone than noise, which is what makes it sound like energy
    // rather than gunpowder.
    plasma: { crackHz: 1800, sweepHz: 2600, crackGain: 0.14, tail: 0.18,
      bodyHz: 520, bodyEnd: 900, bodyGain: 0.22, bodyTail: 0.14, hp: 700,
      snap: 0.12, boom: 0.1, drive: 1.4, echo: 0.18,
      kick: 0.1, mech: 0 },
    // The void cannon: hardly any crack, a long low rising body, which is
    // the sound of something heavy leaving rather than of a charge going off.
    void: { crackHz: 600, sweepHz: 1800, crackGain: 0.2, tail: 1.2,
      bodyHz: 60, bodyEnd: 220, bodyGain: 0.55, bodyTail: 1.0, hp: 120,
      snap: 0.1, boom: 0.4, drive: 1.6, echo: 0.3,
      kick: 0.33, mech: 0 },
    // The quiet three. A suppressed pistol is a hard cough and a click, a
    // suppressed rifle a heavier one with a little of the crack left in it,
    // and a bow is the string and nothing else: no snap, no boom, no echo.
    pistol: { crackHz: 3600, sweepHz: 1500, crackGain: 0.10, tail: 0.09,
      bodyHz: 260, bodyEnd: 120, bodyGain: 0.07, bodyTail: 0.06, hp: 1300,
      snap: 0.22, boom: 0.04, drive: 1.2, echo: 0.04,
      kick: 0.06, mech: 0.22, level: 0.4 },
    suppressed: { crackHz: 2400, sweepHz: 900, crackGain: 0.16, tail: 0.16,
      bodyHz: 180, bodyEnd: 70, bodyGain: 0.12, bodyTail: 0.1, hp: 700,
      snap: 0.35, boom: 0.08, drive: 1.4, echo: 0.08,
      kick: 0.1, mech: 0.24, level: 0.45 },
    bow: { crackHz: 900, sweepHz: 420, crackGain: 0.07, tail: 0.18,
      bodyHz: 140, bodyEnd: 95, bodyGain: 0.14, bodyTail: 0.16, hp: 200,
      snap: 0, boom: 0, drive: 1, echo: 0,
      kick: 0.0, mech: 0, level: 0.6 },
    // Both barrels: a shotgun's report with more of everything under it.
    doublebarrel: { crackHz: 1300, sweepHz: 260, crackGain: 0.6, tail: 0.55,
      bodyHz: 120, bodyEnd: 30, bodyGain: 0.45, bodyTail: 0.32, hp: 300,
      snap: 1.0, boom: 0.42, drive: 3.0, echo: 0.42,
      kick: 0.47, mech: 0.34 },
    // A hand cannon: a pistol with a rifle's crack and more under it than
    // either, and a long ring off the street.
    magnum: { crackHz: 2100, sweepHz: 420, crackGain: 0.62, tail: 0.6,
      bodyHz: 150, bodyEnd: 36, bodyGain: 0.42, bodyTail: 0.3, hp: 380,
      snap: 1.0, boom: 0.36, drive: 3.0, echo: 0.48,
      kick: 0.45, mech: 0.3 },
    // Six barrels at twenty five rounds a second: short, hard, no tail to
    // speak of, so they do not run into one mush.
    minigun: { crackHz: 2300, sweepHz: 600, crackGain: 0.36, tail: 0.12,
      bodyHz: 170, bodyEnd: 50, bodyGain: 0.24, bodyTail: 0.07, hp: 700,
      snap: 0.8, boom: 0.12, drive: 2.4, echo: 0.14,
      kick: 0.22, mech: 0.12, level: 0.7 },
    // The thump of a grenade leaving a tube.
    launcher: { crackHz: 700, sweepHz: 180, crackGain: 0.32, tail: 0.3,
      bodyHz: 120, bodyEnd: 40, bodyGain: 0.42, bodyTail: 0.18, hp: 160,
      snap: 0.2, boom: 0.3, drive: 1.8, echo: 0.22,
      kick: 0.3, mech: 0.2 },
    // Forty tonnes firing. Everything here is lower and longer than the hand
    // weapons, because that is the whole difference a listener hears between
    // a rifle and a gun bolted to eight metres of armour: not loudness, which
    // a speaker runs out of, but weight down at the bottom of the range.
    mechgun: { crackHz: 1900, sweepHz: 380, crackGain: 0.58, tail: 0.48,
      bodyHz: 90, bodyEnd: 24, bodyGain: 0.5, bodyTail: 0.40, hp: 300,
      snap: 0.9, boom: 0.36, drive: 2.6, echo: 0.4,
      kick: 0.39, mech: 0.3 },
    mechcannon: { crackHz: 1100, sweepHz: 170, crackGain: 0.72, tail: 1.05,
      bodyHz: 62, bodyEnd: 17, bodyGain: 0.62, bodyTail: 0.78, hp: 130,
      snap: 1.0, boom: 0.45, drive: 3.0, echo: 0.45,
      kick: 0.52, mech: 0.36 },
  };

  /**
   * The bus every shot goes through: a soft clip for the body, and a send to
   * two echoes off the street, a near facade and a far one, darker than the
   * shot.
   */
  _shotBus() {
    if (this._shot) return this._shot;
    const ctx = this.ctx;
    // No compressor: the browser's looks ahead by several milliseconds and
    // turns the leading edge down before it arrives, which was measured to
    // cost the first ten milliseconds of a rifle shot eight decibels. The
    // clip on the body is all the density it needs.
    // Everything but the kick goes through a gentle clip on the way out:
    // louder, and the leading edge held hard rather than rounded off.
    const input = ctx.createGain();
    input.gain.value = 1.12;
    const glue = ctx.createWaveShaper();
    const gc = new Float32Array(2048);
    for (let i = 0; i < gc.length; i++) {
      const x = (i / (gc.length - 1)) * 2 - 1;
      gc[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    glue.curve = gc;
    glue.oversample = '2x';
    // The kick, dry of the clip, and then the two of them summed into a
    // ceiling, because a thump under a report adds up to more than either:
    // the sum is brought down by the most it can reach and rounded off at
    // the top, so nothing past full scale ever reaches the speakers.
    const dry = ctx.createGain();
    const sum = ctx.createGain();
    sum.gain.value = 1 / 1.6;
    const ceiling = ctx.createWaveShaper();
    const cc = new Float32Array(2048);
    for (let i = 0; i < cc.length; i++) {
      const x = (i / (cc.length - 1)) * 2 - 1;
      cc[i] = 0.98 * Math.tanh(2 * x) / Math.tanh(2);
    }
    ceiling.curve = cc;
    input.connect(glue).connect(sum);
    dry.connect(sum);
    sum.connect(ceiling).connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 1;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 2400;
    send.connect(dark);
    const echoes = [];
    for (const [time, level] of [[0.105, 0.42], [0.26, 0.2]]) {
      const d = ctx.createDelay(1);
      d.delayTime.value = time;
      const g = ctx.createGain();
      g.gain.value = level;
      dark.connect(d).connect(g).connect(this.master);
      echoes.push({ d, g });
    }
    // A soft clip for the body: tanh, which rounds the sine into something
    // with odd harmonics in it.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.5) / Math.tanh(2.5);
    }
    shaper.curve = curve;
    // The clip comes out at full scale whatever goes in, so it is trimmed
    // back to sit under the crack rather than over it.
    const trim = ctx.createGain();
    trim.gain.value = 0.55;
    shaper.connect(trim).connect(input);
    this._shot = { input, send, shaper, echoes, dry };
    return this._shot;
  }

  gunshot(kind = 'rifle') {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const v = Audio.SHOT[kind] || Audio.SHOT.rifle;
    const t0 = ctx.currentTime;
    // The action first, then the report a few milliseconds after it.
    const t = v.mech > 0 ? t0 + 0.006 : t0;
    const bus = this._shotBus();
    // The quiet ones stay quiet: the bus is louder than it was, and a
    // suppressed pistol is not meant to be.
    const vin = ctx.createGain();
    vin.gain.value = v.level || 1;
    vin.connect(bus.input);
    if (v.mech > 0) {
      const mc = ctx.createBufferSource();
      mc.buffer = this._noiseBuffer;
      const mf = ctx.createBiquadFilter();
      mf.type = 'bandpass';
      mf.frequency.value = 3800 + Math.random() * 600;
      mf.Q.value = 6;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(0.0001, t0);
      mg.gain.exponentialRampToValueAtTime(v.mech, t0 + 0.0008);
      mg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.02);
      mc.connect(mf).connect(mg).connect(vin);
      mc.start(t0, Math.random() * 3, 0.025);
      mc.stop(t0 + 0.025);
    }
    // Kick: a dry thump under all of it.
    if (v.kick > 0) {
      const k = ctx.createOscillator();
      k.type = 'sine';
      k.frequency.setValueAtTime(110, t);
      k.frequency.exponentialRampToValueAtTime(50, t + 0.045);
      const kg = ctx.createGain();
      kg.gain.setValueAtTime(0.0001, t);
      const kick = v.kick * (v.level || 1);
      kg.gain.exponentialRampToValueAtTime(kick, t + 0.002);
      kg.gain.exponentialRampToValueAtTime(kick * 0.25, t + 0.06);
      kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 + v.bodyTail * 0.3);
      k.connect(kg).connect(bus.dry);
      k.start(t);
      k.stop(t + 0.14 + v.bodyTail * 0.3);
    }
    // The street changes a little from shot to shot, which is what keeps a
    // long burst from sounding like one sample on a loop.
    bus.echoes[0].d.delayTime.setValueAtTime(0.085 + Math.random() * 0.05, t);
    const echoSend = ctx.createGain();
    echoSend.gain.value = v.echo || 0;
    echoSend.connect(bus.send);

    // Snap: the leading edge, a millisecond and a half of raw noise.
    if (v.snap > 0) {
      const sn = ctx.createBufferSource();
      sn.buffer = this._noiseBuffer;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(v.snap, t);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      sn.connect(sg).connect(vin);
      sn.start(t, Math.random() * 3, 0.014);
      sn.stop(t + 0.014);
    }

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
    g.gain.exponentialRampToValueAtTime(v.crackGain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(v.crackGain * 0.05, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.tail);
    src.connect(hp).connect(bp).connect(g);
    g.connect(vin);
    g.connect(echoSend);
    src.start(t, Math.random() * 3, v.tail + 0.06);
    src.stop(t + v.tail + 0.06);

    // Boom: the low middle under the crack, noise through a low pass.
    if (v.boom > 0) {
      const bm = ctx.createBufferSource();
      bm.buffer = this._noiseBuffer;
      bm.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(520, t);
      lp.frequency.exponentialRampToValueAtTime(140, t + 0.18);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.exponentialRampToValueAtTime(v.boom, t + 0.004);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16 + v.bodyTail * 0.5);
      bm.connect(lp).connect(bg);
      bg.connect(vin);
      bg.connect(echoSend);
      const len = 0.2 + v.bodyTail * 0.5;
      bm.start(t, Math.random() * 3, len);
      bm.stop(t + len);
    }

    // Body: a sine that starts high and drops fast, driven into the soft
    // clip, which is what gives it weight on small speakers.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(v.bodyHz * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(v.bodyHz, t + 0.012);
    o.frequency.exponentialRampToValueAtTime(v.bodyEnd, t + 0.10);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(v.bodyGain * (v.drive || 1) * (v.level || 1), t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t + v.bodyTail);
    o.connect(og).connect(bus.shaper);
    o.start(t);
    o.stop(t + v.bodyTail + 0.02);
    // The echo send outlives the shot by the length of the echoes.
    setTimeout(() => { try { echoSend.disconnect(); vin.disconnect(); } catch { /* gone */ } },
      (v.tail + 0.6) * 1000);
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
  /**
   * A demon's roar: a sawtooth growl that drops, under a band of noise, the
   * bigger the demon the deeper. Quieter with distance.
   */
  roar(distance = 0, size = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const level = Math.max(0.05, 1 - distance / 160) * 0.22;
    const base = 120 / Math.sqrt(size);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.8);
    const wob = ctx.createOscillator();
    wob.frequency.value = 23;
    const wg = ctx.createGain();
    wg.gain.value = base * 0.18;
    wob.connect(wg).connect(o.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    o.connect(lp).connect(g).connect(this.master);
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420 / Math.sqrt(size);
    bp.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(level * 0.8, t + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    n.connect(bp).connect(ng).connect(this.master);
    o.start(t); wob.start(t); n.start(t, Math.random() * 3, 1);
    o.stop(t + 1); wob.stop(t + 1); n.stop(t + 1);
  }

  /** A chainsaw biting: a buzzing two stroke that rises as it cuts. */
  saw(seconds = 0.7) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(190, t + seconds * 0.4);
    o.frequency.exponentialRampToValueAtTime(120, t + seconds);
    const am = ctx.createOscillator();
    am.frequency.value = 38;
    const amg = ctx.createGain();
    amg.gain.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
    g.gain.setValueAtTime(0.16, t + seconds * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    am.connect(amg).connect(g.gain);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.7;
    o.connect(bp).connect(g).connect(this.master);
    o.start(t); am.start(t);
    o.stop(t + seconds + 0.05); am.stop(t + seconds + 0.05);
  }

  /** Fire leaving a demon's hand, or landing: a short breathy whoomp. */
  whoomp(distance = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const level = Math.max(0.03, 1 - distance / 120) * 0.2;
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    n.connect(lp).connect(g).connect(this.master);
    n.start(t, Math.random() * 3, 0.5);
    n.stop(t + 0.5);
  }

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
   * A warhead. Three things in sequence, because that is what one sounds like
   * from any distance worth surviving: the crack, then a sub tone that falls
   * for most of a second, then a long roll of noise that takes eight seconds
   * to go away. The roll is the part that sells the size.
   *
   * @param {number} distance metres from you, which only sets how long the
   *   sound takes to arrive and how much of the top end is left on it
   */
  nuke(distance = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    // Sound travels. At six hundred metres that is most of two seconds, and
    // seeing the flash before you hear it is most of the effect.
    const delay = Math.min(3.0, distance / 340);
    const t = ctx.currentTime + delay;
    const near = Math.max(0.12, 1 - distance / 900);

    // The crack, which only exists up close.
    const crack = ctx.createBufferSource();
    crack.buffer = this._noiseBuffer;
    crack.loop = true;
    const ch = ctx.createBiquadFilter();
    ch.type = 'highpass';
    ch.frequency.value = 400 + near * 1400;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(0.5 * near + 0.0002, t + 0.004);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    crack.connect(ch).connect(cg).connect(this.master);
    crack.start(t, Math.random() * 3, 0.4);
    crack.stop(t + 0.4);

    // The sub, falling out of hearing.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, t);
    sub.frequency.exponentialRampToValueAtTime(14, t + 1.5);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.72, t + 0.03);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    sub.connect(sg).connect(this.master);
    sub.start(t);
    sub.stop(t + 2.5);

    // The roll, which is the one that lasts. A lowpass closing slowly over
    // eight seconds of noise is exactly the sound of something very large a
    // long way away, and it is the same trick whatever the distance.
    const roll = ctx.createBufferSource();
    roll.buffer = this._noiseBuffer;
    roll.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.setValueAtTime(900 + near * 1600, t);
    rf.frequency.exponentialRampToValueAtTime(90, t + 7.5);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(0.42, t + 0.12);
    rg.gain.setValueAtTime(0.42, t + 1.4);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 8.0);
    roll.connect(rf).connect(rg).connect(this.master);
    roll.start(t, Math.random() * 2, 8.2);
    roll.stop(t + 8.2);
  }

  /**
   * A building coming down. Not an explosion: there is no crack at the front
   * of it. What you hear is a long tearing rumble that builds over about a
   * second and then falls away over four, with the top end filtered off by
   * however far away it is.
   *
   * @param {number} distance metres
   * @param {number} radius how much came down
   */
  collapse(distance = 0, radius = 20) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + Math.min(1.5, distance / 340);
    const near = Math.max(0.1, 1 - distance / 700);
    const size = Math.min(2.2, 0.5 + radius / 60);

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(260 + near * 900, t);
    lp.frequency.exponentialRampToValueAtTime(110, t + 4.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    // It builds rather than starting at full, which is the whole difference
    // between a collapse and a bang.
    g.gain.exponentialRampToValueAtTime(0.34 * near * size, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 3, 4.7);
    src.stop(t + 4.7);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(48, t);
    sub.frequency.exponentialRampToValueAtTime(21, t + 2.2);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.30 * near * size, t + 0.5);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    sub.connect(sg).connect(this.master);
    sub.start(t);
    sub.stop(t + 2.7);
  }

  /**
   * A tree going up. Sap boiling rather than ordnance: a wet crack with a
   * rush of air after it and no bass at all, which is what separates it from
   * every other bang in this game.
   */
  /**
   * The flamethrower, while it is pouring. One looped noise source through a
   * low shelf with a slow wobble on it, started when the trigger goes down and
   * faded when it comes up, because a flamethrower is a continuous sound and
   * retriggering a one shot sixty times a second is a buzz, not a roar.
   */
  /**
   * A camp's siren: two tones a fourth apart, wailing up and down over two
   * seconds, the way a wind up siren on a pole sounds from a street away.
   * Level is nought to one by distance; nought stops it.
   */
  siren(level) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    if (level > 0.001 && !this._siren) {
      const out = ctx.createGain();
      out.gain.value = 0.0001;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      lp.connect(out).connect(this.master);
      const wail = ctx.createOscillator();
      wail.type = 'sine';
      wail.frequency.value = 0.5;
      const oscs = [];
      for (const [base, depth] of [[560, 260], [747, 346]]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = base;
        const d = ctx.createGain();
        d.gain.value = depth;
        wail.connect(d).connect(o.frequency);
        const g = ctx.createGain();
        g.gain.value = 0.5;
        o.connect(g).connect(lp);
        o.start();
        oscs.push(o);
      }
      wail.start();
      this._siren = { out, wail, oscs };
    }
    if (!this._siren) return;
    const t = ctx.currentTime;
    this._siren.out.gain.setTargetAtTime(Math.max(0.0001, level * 0.16), t, 0.25);
    if (level <= 0.001) {
      const s = this._siren;
      this._siren = null;
      setTimeout(() => {
        try { s.wail.stop(); for (const o of s.oscs) o.stop(); s.out.disconnect(); } catch { /* gone */ }
      }, 1500);
    }
  }

  /** Somebody in a camp is sure of you: a short rising sting, high and thin. */
  /** A bomb ticking: a short hard beep, higher as it runs out. */
  bombBeep(distance = 0, urgent = false) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(urgent ? 2300 : 1750, t);
    const g = ctx.createGain();
    const level = 0.09 * Math.max(0.08, 1 - distance / 90);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  /**
   * The phone getting into something: two quick data chirps, the second
   * higher, and a lower one when it is a hack that failed or was lost.
   */
  hackChirp(ok = true) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const notes = ok ? [1480, 2220] : [620, 410];
    notes.forEach((hz, i) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(hz, t + i * 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.07 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.06);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.07);
      o.stop(t + i * 0.07 + 0.07);
    });
  }

  /** Steam out of a pipe under the road: a hiss, for so long, quieter the further off. */
  hiss(distance = 0, seconds = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const level = 0.09 * Math.max(0.05, 1 - distance / 90);
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer;
    n.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.08);
    g.gain.setValueAtTime(level, t + Math.max(0.1, seconds - 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    n.connect(hp).connect(g).connect(this.master);
    n.start(t, Math.random() * 3);
    n.stop(t + seconds + 0.05);
  }

  /**
   * A wet piece of somebody landing on the street: a slap of filtered noise
   * that drops in pitch as it goes, with a small thud under it.
   * @param {number} size nought to one, how hard it came down
   */
  splat(distance = 0, size = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const level = 0.2 * (0.5 + 0.5 * size) * Math.max(0.04, 1 - distance / 70);
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(900 + Math.random() * 700, t);
    bp.frequency.exponentialRampToValueAtTime(260, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t, Math.random() * 3);
    n.stop(t + 0.18);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    const og = ctx.createGain();
    og.gain.setValueAtTime(level * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.12);
  }

  /**
   * Something swung past your ear: a short whip of air, lower and longer the
   * heavier it is (0 a jab, 1 a bat).
   */
  swing(weight = 0.6) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    const f0 = 2400 - weight * 1300;
    bp.frequency.setValueAtTime(f0 * 0.6, t);
    bp.frequency.exponentialRampToValueAtTime(f0, t + 0.06 + weight * 0.05);
    bp.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + 0.16 + weight * 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1 + weight * 0.08, t + 0.05 + weight * 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2 + weight * 0.12);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t, Math.random() * 3);
    n.stop(t + 0.36);
  }

  /**
   * A blow landing. Under every one a low thump; over it what it was: flesh,
   * a blade going in, the crack of a bat, the steel of a baton, a boot, the
   * butt of a rifle. size 0 to 1.
   */
  strike(kind = 'flesh', size = 0.6) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(kind === 'boot' ? 100 : 130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.16 + 0.16 * size, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 0.18);
    // The surface of it, in noise.
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer;
    const f = ctx.createBiquadFilter();
    const cut = kind === 'blade';
    f.type = cut ? 'highpass' : 'bandpass';
    f.Q.value = cut ? 0.7 : 1.6;
    const hz = { flesh: 700, blade: 2600, wood: 1500, baton: 2100, boot: 500, stock: 1100 }[kind] || 700;
    f.frequency.setValueAtTime(hz, t);
    f.frequency.exponentialRampToValueAtTime(hz * (cut ? 1.6 : 0.45), t + 0.1);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime((cut ? 0.1 : 0.14) * (0.6 + size * 0.6), t + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + (cut ? 0.14 : 0.09));
    n.connect(f).connect(ng).connect(this.master);
    n.start(t, Math.random() * 3);
    n.stop(t + 0.16);
    // Wood and steel ring for a moment: the bat a hollow tock, the baton
    // and the butt of a rifle a short clank.
    if (kind === 'wood' || kind === 'baton' || kind === 'stock') {
      const r = ctx.createOscillator();
      r.type = kind === 'wood' ? 'triangle' : 'square';
      const r0 = kind === 'wood' ? 820 : kind === 'baton' ? 1350 : 610;
      r.frequency.setValueAtTime(r0, t);
      r.frequency.exponentialRampToValueAtTime(r0 * 0.82, t + 0.07);
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.0001, t);
      rg.gain.exponentialRampToValueAtTime(kind === 'wood' ? 0.12 : 0.04, t + 0.003);
      rg.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'wood' ? 0.11 : 0.07));
      r.connect(rg).connect(this.master);
      r.start(t); r.stop(t + 0.13);
    }
  }

  /** A rubber duck: a short squeezed honk, falling at the end. */
  quack(distance = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const near = Math.max(0.05, 1 - distance / 60);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(620, t);
    o.frequency.linearRampToValueAtTime(700, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(380, t + 0.16);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.value = 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * near, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(f).connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.2);
  }

  /** A boot coming down in it: a short wet suck, low and closing. */
  squelch() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(280, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    n.connect(lp).connect(g).connect(this.master);
    n.start(t, Math.random() * 3);
    n.stop(t + 0.26);
  }

  /** The power going: a clunk and the hum of the street falling away under it. */
  blackout() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(100, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 1.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.55);
    this.whoomp(30);
  }

  /** Somebody's phone ringing in the street, quieter the further off. */
  ringtone(distance = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const level = 0.05 * Math.max(0.1, 1 - distance / 60);
    for (let k = 0; k < 6; k++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(k % 2 ? 1320 : 1760, t + k * 0.11);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + k * 0.11);
      g.gain.exponentialRampToValueAtTime(level, t + k * 0.11 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.11 + 0.1);
      o.connect(g).connect(this.master);
      o.start(t + k * 0.11);
      o.stop(t + k * 0.11 + 0.11);
    }
  }

  spotted() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(1300, t + 0.35);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.55);
  }

  flameLoop(on) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) {
      return;
    }
    if (on) {
      if (!this._flame) {
        const src = ctx.createBufferSource();
        src.buffer = this._noiseBuffer;
        src.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        lp.Q.value = 0.9;
        // The flutter: a slow wobble on the cutoff, which is what stops it
        // sounding like a hairdryer.
        const wob = ctx.createOscillator();
        wob.type = 'sine';
        wob.frequency.value = 7.5;
        const wobGain = ctx.createGain();
        wobGain.gain.value = 260;
        wob.connect(wobGain); wobGain.connect(lp.frequency);
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        src.connect(lp); lp.connect(g); g.connect(this.master);
        src.start();
        wob.start();
        this._flame = { src, g, wob };
      }
      this._flame.g.gain.setTargetAtTime(0.22, ctx.currentTime, 0.04);
      this._flameHold = 0.12;
      return;
    }
    if (this._flame) {
      this._flame.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.07);
    }
  }

  /** The wall going out: a deep whoomph with a tail of its own. */
  /**
   * A machine's beam: a short downward zip with a hard edge on it. Nothing
   * like a gunshot, which is the point: in Rise of the Machines you can hear
   * what is shooting at you.
   */
  laser(distance = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + Math.min(0.6, distance / 340);
    const near = Math.max(0.05, 1 - distance / 220);
    if (near < 0.07) return;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(320, t + 0.13);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.5;
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * near, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(bp); bp.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.18);
  }

  /**
   * The hum a machine makes while it is looking for you, and the clipped
   * two tone it gives when it has found you, which is as close to an order as
   * something with no mouth gets.
   */
  machineCall(distance = 0, found = false) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + Math.min(0.6, distance / 340);
    const near = Math.max(0.04, 1 - distance / 160);
    if (near < 0.06) return;
    const notes = found ? [330, 196] : [92, 104];
    let at = t;
    for (const f of notes) {
      const o = ctx.createOscillator();
      o.type = found ? 'square' : 'sawtooth';
      o.frequency.setValueAtTime(f, at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime((found ? 0.11 : 0.05) * near, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + (found ? 0.14 : 0.5));
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = found ? 1400 : 420;
      o.connect(lp); lp.connect(g); g.connect(this.master);
      o.start(at); o.stop(at + (found ? 0.16 : 0.55));
      at += found ? 0.16 : 0.28;
    }
  }

  /** An EMP going off: a rising whine and then everything metal shuts up. */
  emp(distance = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + Math.min(0.6, distance / 340);
    const near = Math.max(0.06, 1 - distance / 260);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(3200, t + 0.26);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26 * near, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.46);

    const hiss = ctx.createBufferSource();
    hiss.buffer = this._noiseBuffer;
    hiss.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t + 0.24);
    hg.gain.exponentialRampToValueAtTime(0.3 * near, t + 0.3);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    hiss.connect(hp); hp.connect(hg); hg.connect(this.master);
    hiss.start(t + 0.24); hiss.stop(t + 0.95);

    // The part that had been missing: the thump. A pulse that is only a whine
    // and a hiss is a sound effect; a pulse with sixty hertz falling out from
    // under it is a weapon going off. The crack on top gives it an edge, so
    // it reads as electrical rather than as a drum.
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(70, t);
    body.frequency.exponentialRampToValueAtTime(21, t + 0.5);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.62 * near, t + 0.012);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
    body.connect(bg); bg.connect(this.master);
    body.start(t); body.stop(t + 0.64);

    const crack = ctx.createBufferSource();
    crack.buffer = this._noiseBuffer;
    crack.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(5200, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.14);
    bp.Q.value = 0.7;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(0.4 * near, t + 0.006);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    crack.connect(bp).connect(cg).connect(this.master);
    crack.start(t, Math.random() * 3, 0.34);
    crack.stop(t + 0.34);
  }

  flameWall() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1600, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 1.2);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(90, t);
    thud.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.26, t + 0.03);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    thud.connect(tg); tg.connect(this.master);
    thud.start(t); thud.stop(t + 0.62);
  }

  /**
   * The swoosh a cartoon makes when somebody's feet go out from under them:
   * a band of noise sliding up and then away, with a wooden knock at the end
   * where he lands. Every bit of it is synthesised here like everything else
   * in this game; there are no samples anywhere in the project.
   */
  swoosh(distance = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + Math.min(0.4, distance / 340);
    const near = Math.max(0.05, 1 - distance / 90);
    if (near < 0.08) return;

    // The slide: noise through a band that sweeps up a couple of octaves and
    // opens out, which is the sound of something travelling past you fast.
    const air = ctx.createBufferSource();
    air.buffer = this._noiseBuffer;
    air.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 7;
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.26);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.42);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32 * near, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
    air.connect(bp); bp.connect(g); g.connect(this.master);
    air.start(t); air.stop(t + 0.5);

    // A rising whistle over the top of it, which is the part that makes it
    // read as comic rather than as a passing lorry.
    const whistle = ctx.createOscillator();
    whistle.type = 'sine';
    whistle.frequency.setValueAtTime(520, t);
    whistle.frequency.exponentialRampToValueAtTime(1500, t + 0.22);
    whistle.frequency.exponentialRampToValueAtTime(680, t + 0.4);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, t);
    wg.gain.exponentialRampToValueAtTime(0.12 * near, t + 0.08);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.44);
    whistle.connect(wg); wg.connect(this.master);
    whistle.start(t); whistle.stop(t + 0.46);

    // And the landing: a short wooden thump a third of a second later, when
    // the back hits the pavement.
    const thumpAt = t + 0.34;
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(140, thumpAt);
    body.frequency.exponentialRampToValueAtTime(58, thumpAt + 0.16);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, thumpAt);
    bg.gain.exponentialRampToValueAtTime(0.3 * near, thumpAt + 0.012);
    bg.gain.exponentialRampToValueAtTime(0.0001, thumpAt + 0.2);
    body.connect(bg); bg.connect(this.master);
    body.start(thumpAt); body.stop(thumpAt + 0.22);
  }

  treeBurst(distance = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + Math.min(1, distance / 340);
    const near = Math.max(0.08, 1 - distance / 220);
    if (near < 0.1) return;

    const crack = ctx.createBufferSource();
    crack.buffer = this._noiseBuffer;
    crack.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1900, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.25);
    bp.Q.value = 1.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26 * near, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    crack.connect(bp).connect(g).connect(this.master);
    crack.start(t, Math.random() * 3, 0.6);
    crack.stop(t + 0.6);
  }

  /**
   * The overkill sting. A wet low splat, which is the body, and under it two
   * detuned saws falling an octave over most of a second, which is the hit a
   * fighting game puts behind the word on the screen. The second voice is a
   * fifth up and quieter, so it reads as a chord and not as a buzz.
   *
   * @param {number} streak kills in a row; each one starts the fall higher
   */
  overkill(streak = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;

    const splat = ctx.createBufferSource();
    splat.buffer = this._noiseBuffer;
    splat.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 0.3);
    lp.Q.value = 4;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.55, t + 0.01);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    splat.connect(lp).connect(sg).connect(this.master);
    splat.start(t, Math.random() * 3, 0.45);
    splat.stop(t + 0.45);

    const base = 92 * Math.pow(1.12, Math.min(6, streak - 1));
    for (const [mul, level] of [[1, 0.2], [1.5, 0.11]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = (Math.random() - 0.5) * 18;
      o.frequency.setValueAtTime(base * mul, t + 0.04);
      o.frequency.exponentialRampToValueAtTime(base * mul * 0.5, t + 0.95);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + 0.04);
      g.gain.exponentialRampToValueAtTime(level, t + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(f).connect(g).connect(this.master);
      o.start(t + 0.04);
      o.stop(t + 1.15);
    }
  }

  /** A tree going over: a long tearing creak and then a soft heavy landing. */
  treeFall(distance = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + Math.min(1, distance / 340);
    const near = Math.max(0.06, 1 - distance / 200);
    if (near < 0.1) return;

    // The creak: a narrow band wandering down, which is fibres letting go.
    const creak = ctx.createOscillator();
    creak.type = 'sawtooth';
    creak.frequency.setValueAtTime(240, t);
    creak.frequency.exponentialRampToValueAtTime(90, t + 1.1);
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 500;
    cf.Q.value = 5;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(0.055 * near, t + 0.2);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    creak.connect(cf).connect(cg).connect(this.master);
    creak.start(t);
    creak.stop(t + 1.25);

    // And the landing, a second later.
    const land = ctx.createBufferSource();
    land.buffer = this._noiseBuffer;
    land.loop = true;
    const lf = ctx.createBiquadFilter();
    lf.type = 'lowpass';
    lf.frequency.setValueAtTime(900, t + 1.1);
    lf.frequency.exponentialRampToValueAtTime(160, t + 1.7);
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0.0001, t + 1.1);
    lg.gain.exponentialRampToValueAtTime(0.2 * near, t + 1.14);
    lg.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    land.connect(lf).connect(lg).connect(this.master);
    land.start(t + 1.1, Math.random() * 2, 0.85);
    land.stop(t + 1.95);
  }

  /**
   * The ion cannon charging: a tone that rises for eight seconds and a
   * shimmer over it that gets faster with the ring. Nothing in this game is
   * allowed to sound mechanical, so it is two detuned saws through a filter
   * that opens rather than a sample of anything.
   */
  ionCharge() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const seconds = 8.9;
    this._ionNodes = [];
    for (const detune of [-7, 0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(520, t + seconds);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(220, t);
      f.frequency.exponentialRampToValueAtTime(2400, t + seconds);
      f.Q.value = 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + 1.2);
      g.gain.exponentialRampToValueAtTime(0.22, t + seconds);
      g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.25);
      o.connect(f).connect(g).connect(this.master);
      o.start(t);
      o.stop(t + seconds + 0.3);
      this._ionNodes.push(o);
    }
  }

  /**
   * Ultra plasma charging: a chord that climbs for the whole of the charge
   * with a fast tremolo on it that speeds up as it goes, and a hiss under it
   * that opens out, so you can hear how far along it is.
   *
   * @param {number} seconds how long the charge is
   */
  ultraCharge(seconds) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const trem = ctx.createOscillator();
    trem.frequency.setValueAtTime(4, t);
    trem.frequency.exponentialRampToValueAtTime(28, t + seconds);
    // The tremolo works on a stage of its own after the three voices, which
    // sits at 0.65 and swings 0.35 either side, so it never inverts them.
    const throb = ctx.createGain();
    throb.gain.value = 0.65;
    const depth = ctx.createGain();
    depth.gain.value = 0.35;
    trem.connect(depth).connect(throb.gain);
    throb.connect(this.master);
    for (const [base, mul] of [[110, 1], [110, 1.5], [110, 2.01]]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(base * mul, t);
      o.frequency.exponentialRampToValueAtTime(base * mul * 6, t + seconds);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(5000, t + seconds);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.12, t + seconds);
      g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.35);
      o.connect(f).connect(g).connect(throb);
      o.start(t);
      o.stop(t + seconds + 0.4);
    }
    trem.start(t);
    trem.stop(t + seconds + 0.4);
    const hiss = ctx.createBufferSource();
    hiss.buffer = this._noiseBuffer;
    hiss.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(3000, t);
    hp.frequency.exponentialRampToValueAtTime(400, t + seconds);
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t);
    hg.gain.exponentialRampToValueAtTime(0.09, t + seconds);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.3);
    hiss.connect(hp).connect(hg).connect(this.master);
    hiss.start(t, 0, seconds + 0.4);
    hiss.stop(t + seconds + 0.4);
  }

  /** And the middle beam: a crack with a very long tail of pressure. */
  ionFire() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(2200, t);
    hp.frequency.exponentialRampToValueAtTime(220, t + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.01);
    g.gain.setValueAtTime(0.42, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random() * 2, 3.6);
    src.stop(t + 3.6);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(130, t);
    sub.frequency.exponentialRampToValueAtTime(18, t + 2.8);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.75, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    sub.connect(sg).connect(this.master);
    sub.start(t);
    sub.stop(t + 3.1);
  }

  /** A warhead on its way down: a falling whistle that arrives with it. */
  incoming(seconds = 3.2) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1150, t);
    o.frequency.exponentialRampToValueAtTime(240, t + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.12, t + seconds * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.08);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + seconds + 0.1);
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
   * Picking something up. Ammunition and health are a short mechanical click
   * with a body to it; the three power ups get a rising chord instead, which
   * is the whole point of hearing one from across a square.
   *
   * @param {string} kind ammo, health, quad, ultra or overload
   */
  pickup(kind) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const chords = {
      quad: [196, 261, 392, 523],
      ultra: [262, 330, 440, 660],
      overload: [220, 277, 440, 554],
    };
    const chord = chords[kind];
    if (chord) {
      for (let i = 0; i < chord.length; i++) {
        const at = i * 0.055;
        const o = ctx.createOscillator();
        o.type = kind === 'overload' ? 'sawtooth' : 'triangle';
        o.frequency.setValueAtTime(chord[i], t + at);
        o.frequency.linearRampToValueAtTime(chord[i] * 1.01, t + at + 0.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(0.085, t + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.62);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 2600;
        o.connect(f).connect(g).connect(this.master);
        o.start(t + at);
        o.stop(t + at + 0.7);
      }
      return;
    }
    // The crate and the kit: a click and a thump, health a little higher.
    const high = kind === 'health';
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(high ? 680 : 420, t);
    o.frequency.exponentialRampToValueAtTime(high ? 1180 : 240, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.17);
    if (this._noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = high ? 2400 : 1200;
      nf.Q.value = 1.1;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.06, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      src.connect(nf).connect(ng).connect(this.master);
      src.start(t, Math.random() * 2, 0.12);
      src.stop(t + 0.12);
    }
  }

  /** A power up running out: the chord, falling instead of rising. */
  powerEnd() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    for (const [hz, at] of [[440, 0], [330, 0.08], [220, 0.16]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.055, t + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.28);
      o.connect(g).connect(this.master);
      o.start(t + at);
      o.stop(t + at + 0.32);
    }
  }

  /**
   * The suit changing mode: a sweep and a low hum for the armour, a thin
   * rising shimmer for the cloak, the same played downwards when it goes off.
   */
  suit(which, on) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const armor = which === 'armor';
    const [a, b] = armor ? [140, 260] : [900, 2400];
    const o = ctx.createOscillator();
    o.type = armor ? 'sawtooth' : 'sine';
    o.frequency.setValueAtTime(on ? a : b, t);
    o.frequency.exponentialRampToValueAtTime(on ? b : a, t + 0.32);
    const f = ctx.createBiquadFilter();
    f.type = armor ? 'lowpass' : 'bandpass';
    f.frequency.value = armor ? 900 : 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(armor ? 0.09 : 0.05, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
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
