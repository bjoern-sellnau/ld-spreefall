// The world data: manifest, binary bundle, ground height field, surface map and
// the collision segment lookup. Everything the simulation needs, none of the GPU.

import { craterProfile, CRATER_RIM_OUT } from '../shared/crater.js';
import { TILE_SIZE, COLLISION_GRID, GROUND_SCALE, SURFACE } from '../shared/constants.js';

/**
 * Ray against the vertical quad standing on segment a to b between base and top.
 * Returns the distance along the ray, or -1.
 */
function rayVerticalQuad(ox, oy, oz, dx, dy, dz, ax, az, bx, bz, base, top) {
  const ex = bx - ax, ez = bz - az;
  // Cross product of the ray direction and the edge, in the ground plane.
  const denom = dx * ez - dz * ex;
  if (Math.abs(denom) < 1e-9) return -1;
  const rx = ax - ox, rz = az - oz;
  const t = (rx * ez - rz * ex) / denom;
  if (t < 0) return -1;
  const s = (rx * dz - rz * dx) / denom;
  if (s < 0 || s > 1) return -1;
  const y = oy + dy * t;
  if (y < base || y > top) return -1;
  return t;
}

const EMPTY = new Float32Array(0);

/** Distance from a point to a box, zero inside it. */
export function boxDistance(x, z, box) {
  const dx = Math.max(box.minX - x, 0, x - box.maxX);
  const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
  return Math.hypot(dx, dz);
}

/** Distance from a point to a line segment, all in the ground plane. */
export function segmentDistance(px, pz, x1, z1, x2, z2) {
  const ex = x2 - x1, ez = z2 - z1;
  const len2 = ex * ex + ez * ez;
  let t = len2 > 1e-9 ? ((px - x1) * ex + (pz - z1) * ez) / len2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  return Math.hypot(px - (x1 + ex * t), pz - (z1 + ez * t));
}

export class World {
  /**
   * The city, as an index plus however many districts are in memory.
   *
   * There is one tile grid over the whole of Berlin inside the Ring, and a
   * district owns a rectangle of it. Tile records are dropped into one sparse
   * array as districts arrive, each record remembering which district's buffer
   * its offsets are in, so everything downstream, the collision, the height
   * field, the raycasts and the renderer, carries on addressing the city by
   * tile index and does not know or care that the bytes came from eight files.
   *
   * @param {object} index the city index, public/world.json
   */
  constructor(index) {
    this.index = index;
    this.base = '';
    this.tileSize = index.tileSize;
    this.nx = index.tileCountX;
    this.nz = index.tileCountZ;
    this.minX = index.world.minX;
    this.minZ = index.world.minZ;
    this.maxX = index.world.maxX;
    this.maxZ = index.world.maxZ;
    this.waterLevel = index.waterLevel !== undefined ? index.waterLevel : -0.9;
    this.tiles = new Array(this.nx * this.nz).fill(null);
    this.districts = new Map();        // id -> loaded district
    this.pending = new Map();          // id -> promise, so two asks are one fetch
    this.missing = new Set();          // ids the index promised and the server has not
    this.collisionCache = new Map();
    this.heightCache = new Map();
    // Craters, by the tiles they reach. The ground under a crater is the
    // bowl itself rather than the height field: the field is a sample every
    // 3.1 m in the middle of town and every 25 m out past the ring, which
    // cannot hold a hole a few metres across, and it was the reason every
    // crater in the game was kept shallow enough to be a dent.
    this.craters = new Map();
    this.craterKeys = new Map();
    // Trees that have burnt down, by tile index and ordinal within the tile.
    // Kept on the world rather than in the bundle bytes, because the bundle
    // is what a reload reads and a reload is meant to bring the city back.
    this.deadTrees = new Map();
    // What has been knocked down, district by district. A district is thrown
    // away when you leave it and fetched again when you come back, so without
    // this the city quietly repairs itself behind you: these are the few
    // numbers per ruin that let it be put back exactly as it was.
    this.scars = new Map();        // district id -> array of scar records
    this.onTreesChanged = null;        // fn(tileIndex) when one has gone
    // A district landing and a district going are each watched by more than
    // one part of the game: the tile manager has to clear the holes it marked
    // in the grid while the bytes were still coming, and the game layer has to
    // put the damage back. These were single slots, and the second assignment
    // simply threw the first one away, which left every streamed in district
    // with its tiles marked as not there: you walked into Ring 3-2 and stood
    // on ground you could not see.
    this.districtListeners = [];       // fn(district) when one lands
    this.dropListeners = [];           // fn(district, indices) before one goes
    // What the rest of the game reads. The arrays are the same objects for the
    // life of the world and are filled and emptied in place as districts come
    // and go, so anything holding a reference keeps seeing the truth.
    this.manifest = {
      origin: index.origin,
      bbox: index.bbox,
      city: index.city,
      tileSize: index.tileSize,
      materials: index.materials,
      facadePalette: index.facadePalette,
      waterLevel: this.waterLevel,
      landmarks: [],
      stations: [],
      roadLines: [],
      // The railways, so the game can run a train along one. Only the
      // elevated ones matter for that: the Stadtbahn is on a viaduct and a
      // tram is in the street with everything else.
      railLines: [],
      // Street name labels, from whichever districts are in memory. The
      // district you are standing in is the one whose names you can read.
      streets: [],
      waterOutlines: [],
      greenOutlines: [],
      totals: { triangles: 0, vertices: 0, buildings: 0, stelae: 0, trees: 0, roadKm: 0, collisionSegments: 0 },
    };
  }

  /** Every district the index knows about, built or not. */
  get catalogue() { return this.index.districts || []; }

  entryFor(id) { return this.catalogue.find((d) => d.id === id) || null; }

  /**
   * Is there anything to load for this district?
   *
   * The index lists every district of Berlin so that the map can draw the
   * whole city, but a district nobody has built yet has no bundle behind it.
   * Asking for one would be a pair of four hundred and fours, so everything
   * that loads goes through here first.
   */
  /**
   * Writes down a ruin against the district it is in.
   *
   * @param {{x,z}} scar as the demolition layer records it
   */
  recordScar(scar) {
    const entry = this.entryAt(scar.x, scar.z);
    if (!entry) return null;
    let list = this.scars.get(entry.id);
    if (!list) { list = []; this.scars.set(entry.id, list); }
    list.push(scar);
    return entry.id;
  }

  /** Everything knocked down in a district, oldest first. */
  scarsFor(id) { return this.scars.get(id) || []; }

  /** How many ruins are being remembered across the whole city. */
  get scarCount() {
    let n = 0;
    for (const list of this.scars.values()) n += list.length;
    return n;
  }

  isBuilt(entry) {
    const d = typeof entry === 'string' ? this.entryFor(entry) : entry;
    return !!(d && d.built !== false && d.bin && d.json);
  }

  /** The district entry a point in metres falls in, loaded or not. */
  entryAt(x, z) {
    for (const d of this.catalogue) {
      const b = d.bounds;
      if (x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ) return d;
    }
    return null;
  }

  loaded(id) { return this.districts.has(id); }

  /** True when the ground under a point is in memory. */
  isLoaded(x, z) {
    const index = this.tileIndex(x, z);
    return index >= 0 && this.tiles[index] !== null;
  }

  get loadedIds() { return [...this.districts.keys()]; }

  /** The name of the district a point is in, for the interface. */
  nameAt(x, z) {
    const e = this.entryAt(x, z);
    return e ? e.name : '';
  }

  /**
   * The index, and the district you start in. The rest arrive as you go.
   *
   * @param {string} base where the bundles are served from
   * @param {(p:number)=>void} onProgress 0 to 1 over the home district
   */
  static async load(base = '', onProgress = null) {
    const index = await fetch(`${base}world.json`).then((r) => {
      if (!r.ok) throw new Error(`world.json: ${r.status}`);
      return r.json();
    });
    if (!index.districts || !index.districts.length) {
      throw new Error('the index has no districts in it');
    }
    const world = new World(index);
    world.base = base;
    const home = index.home && world.entryFor(index.home)
      ? index.home : index.districts[0].id;
    world.home = home;
    await world.loadDistrict(home, onProgress);
    return world;
  }

  /**
   * Fetch one district and splice it into the city. Asking twice while it is
   * in flight gets the same promise, which is what stops the player walking
   * back and forth across a boundary from fetching it twice.
   *
   * @param {string} id the district
   * @param {Function|null} onProgress called with 0 to 1 as the bytes arrive
   * @param {string} variant 'fine' for the district's own tier, 'over' for
   *   the overflight bundle a fast travel flight passes over. The variant
   *   only decides what a fresh fetch asks for: a district already in memory
   *   is handed back as it is, because swapping one underneath a player who
   *   can see it buys nothing and costs a fetch.
   * @returns {Promise<object|null>} the district, or null when there is no
   *   such district in the index
   */
  loadDistrict(id, onProgress = null, variant = 'fine') {
    if (this.districts.has(id)) return Promise.resolve(this.districts.get(id));
    const waiting = this.pending.get(id);
    if (waiting) return waiting;
    const entry = this.entryFor(id);
    if (!entry) return Promise.resolve(null);
    if (!this.isBuilt(entry)) return Promise.resolve(null);
    const job = this._fetchDistrict(entry, onProgress, variant === 'over' && entry.lo ? entry.lo : null)
      .then((district) => {
        this.pending.delete(id);
        return district;
      })
      .catch((err) => {
        this.pending.delete(id);
        throw err;
      });
    this.pending.set(id, job);
    return job;
  }

  async _fetchDistrict(entry, onProgress, lo = null) {
    // Either the district's own pair of files or its overflight pair. They
    // are two builds of the same box and interchangeable everywhere below:
    // same tile indices, same global grid, their own height field size.
    const files = lo || entry;
    const manifest = await fetch(`${this.base}${files.json}`).then((r) => {
      if (!r.ok) throw new Error(`${files.json}: ${r.status}`);
      return r.json();
    });
    const res = await fetch(`${this.base}${files.bin}`);
    if (!res.ok) throw new Error(`${files.bin}: ${res.status}`);
    const total = parseInt(res.headers.get('content-length') || '0', 10) || files.bytes;
    let buffer;
    if (res.body && onProgress) {
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress(total ? Math.min(1, got / total) : Math.min(0.99, got / 10e6));
      }
      const out = new Uint8Array(got);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      buffer = out.buffer;
    } else {
      buffer = await res.arrayBuffer();
    }
    if (onProgress) onProgress(1);
    return this.adopt(entry, manifest, buffer);
  }

  /**
   * Put a fetched district into the city. Separate from the fetch so a test,
   * or a build step, can hand over bytes it already has.
   */
  adopt(entry, manifest, buffer) {
    if (this.districts.has(entry.id)) return this.districts.get(entry.id);
    const sg = manifest.surfaceGrid;
    const district = {
      id: entry.id,
      entry,
      manifest,
      tier: manifest.tier,
      // Which of the two builds this is. The map asks, because a district
      // held at the overflight tier carries no street lines to draw and has
      // to keep being drawn from its sketch in the index.
      overflight: !!manifest.overflight,
      name: manifest.name || entry.name || entry.id,
      buffer,
      view: new DataView(buffer),
      bytes: new Uint8Array(buffer),
      grid: manifest.collisionGrid,
      indices: [],
      surface: {
        step: sg.step, nx: sg.nx, nz: sg.nz,
        minX: manifest.world.minX, minZ: manifest.world.minZ,
        data: new Uint8Array(buffer, sg.offset, sg.length),
      },
    };
    for (const rec of manifest.tiles) {
      // The record knows where its bytes are and the district knows how fine
      // its height field is, both of which differ between tiers.
      rec.d = district;
      rec.view = district.view;
      rec.grid = district.grid;
      this.tiles[rec.t] = rec;
      district.indices.push(rec.t);
    }
    this.districts.set(entry.id, district);
    this._mergeManifest(district, 1);
    for (const fn of this.districtListeners) fn(district);
    return district;
  }

  /** Called with each district as it lands. More than one caller may ask. */
  set onDistrict(fn) { if (fn) this.districtListeners.push(fn); }

  /** Called with each district just before it goes. */
  set onDrop(fn) { if (fn) this.dropListeners.push(fn); }

  /**
   * Let a district go: its tiles, its caches and its bytes. The renderer is
   * told first so it can free whatever it has on the card.
   */
  unloadDistrict(id) {
    const district = this.districts.get(id);
    if (!district) return false;
    for (const fn of this.dropListeners) fn(district, district.indices);
    for (const t of district.indices) {
      this.tiles[t] = null;
      this.collisionCache.delete(t);
      this.heightCache.delete(t);
      // The holes go with the ground they were in. They are put back from
      // the scars when the district lands again, the same as the ruins.
      const holes = this.craters.get(t);
      if (holes) for (const c of [...holes]) this.removeCrater(c);
    }
    this._mergeManifest(district, -1);
    this.districts.delete(id);
    return true;
  }

  /** Add or remove a district's share of what the game reads. */
  _mergeManifest(district, sign) {
    const m = this.manifest;
    const d = district.manifest;
    const lists = ['landmarks', 'stations', 'roadLines', 'railLines', 'streets',
      'waterOutlines', 'greenOutlines'];
    if (sign > 0) {
      for (const key of lists) {
        for (const item of (d[key] || [])) {
          if (item && typeof item === 'object' && !Array.isArray(item)) item.district = district.id;
          m[key].push(item);
        }
      }
      for (const key of Object.keys(m.totals)) {
        m.totals[key] = Math.round(((m.totals[key] || 0) + (d.totals[key] || 0)) * 10) / 10;
      }
    } else {
      for (const key of lists) {
        const mine = new Set(d[key] || []);
        // Spliced in place rather than replaced, because anything that took a
        // reference to the array itself has to keep seeing the truth.
        const kept = m[key].filter((item) => !mine.has(item));
        m[key].length = 0;
        for (const item of kept) m[key].push(item);
      }
      for (const key of Object.keys(m.totals)) {
        m.totals[key] = Math.round(((m.totals[key] || 0) - (d.totals[key] || 0)) * 10) / 10;
      }
    }
    if (this.onManifest) this.onManifest(m, district, sign);
  }

  /**
   * Keep the city around a point in memory: the district it is in, every
   * district whose box comes within reach, and nothing further out than the
   * drop distance. Called every frame by the game; it starts fetches and
   * returns immediately.
   *
   * @param {number} reach metres, how close a district has to be to be wanted
   * @param {number} drop metres, how far before one is let go
   * @returns {Array<string>} the ids being fetched right now
   */
  /**
   * Hold exactly one district: the one a point is in.
   *
   * Berlin is eighty one districts and two hundred and forty megabytes. A
   * player holds one of them, between two and eight, and changes it at a
   * boundary with a loading screen rather than carrying its neighbours about
   * on the chance of walking into them. That is what makes the whole city
   * possible rather than the part of it that fits in a budget.
   *
   * @returns {Promise<object|null>} the district, once it is in
   */
  async enterOnly(x, z, onProgress = null) {
    const here = this.entryAt(x, z);
    if (!here || !this.isBuilt(here)) return null;
    const district = await this.loadDistrict(here.id, onProgress);
    // Only once the new one is in. Letting the old district go first would
    // leave the player standing on nothing if the fetch failed.
    if (district) {
      for (const id of [...this.districts.keys()]) {
        if (id !== here.id) this.unloadDistrict(id);
      }
    }
    return district;
  }

  /** Which district a point is in, by id, loaded or not. */
  idAt(x, z) {
    const e = this.entryAt(x, z);
    return e ? e.id : null;
  }

  /** True if this district has a second, coarser bundle to fly over. */
  hasOverflight(id) {
    const entry = this.entryFor(id);
    return !!(entry && entry.lo);
  }

  /** True if what is in memory for this district is the overflight bundle. */
  isOverflight(id) {
    const d = this.districts.get(id);
    return !!(d && d.overflight);
  }

  /**
   * Make sure a district is in at its own tier, swapping out the overflight
   * bundle if that is what is there. Used at either end of a flight: you
   * land on the city, never on the sketch of it.
   */
  reloadFine(id, onProgress = null) {
    if (this.isOverflight(id)) this.unloadDistrict(id);
    return this.loadDistrict(id, onProgress, 'fine');
  }

  /**
   * Let go of every district held at the overflight tier. Called when a
   * flight ends, so that nothing a walker can reach is ever the coarse build
   * and no two districts you can walk between are at different tiers.
   *
   * @param {string|null} keep one to leave alone, the one being landed in
   * @returns {number} how many were dropped
   */
  dropOverflight(keep = null) {
    let n = 0;
    for (const id of [...this.districts.keys()]) {
      if (id === keep || !this.isOverflight(id)) continue;
      this.unloadDistrict(id);
      n++;
    }
    return n;
  }

  keepAround(x, z, reach = 900, drop = 2600, max = 9, maxBytes = Infinity, variant = 'fine', pin = null) {
    const want = new Set();
    const here = this.entryAt(x, z);
    if (here) want.add(here.id);
    // A district that must not be let go whatever the distance or the
    // ceiling says: the one a flight is landing in. While you are in the air
    // you are still standing where you took off, so the landing is the
    // furthest district held and the first the ceiling dropped. On the live
    // city, where Mitte alone is thirty nine megabytes, the flight fetched
    // its landing, dropped it, fetched it again, and never came down.
    if (pin) want.add(pin);
    const sorted = this.catalogue
      .map((d) => ({ d, away: boxDistance(x, z, d.bounds) }))
      .sort((a, b) => a.away - b.away);
    for (const { d, away } of sorted) {
      if (want.size >= max) break;
      if (!this.isBuilt(d)) continue;
      if (away <= reach) want.add(d.id);
    }
    for (const id of want) {
      // A fetch the streamer starts has nobody waiting on it, so a district
      // whose bytes are not on the server has to be swallowed here or it is
      // an unhandled rejection every half second. The index can promise a
      // district a deploy did not finish building.
      if (!this.districts.has(id)) {
        this.loadDistrict(id, null, id === pin ? 'fine' : variant).catch(() => {
          if (!this.missing.has(id)) {
            this.missing.add(id);
            console.warn(`spreefall: ${id} is in the index but not on the server`);
          }
        });
      }
    }
    for (const id of this.districts.keys()) {
      if (want.has(id) || id === pin) continue;
      const entry = this.entryFor(id);
      if (!entry) continue;
      if (boxDistance(x, z, entry.bounds) > drop) this.unloadDistrict(id);
    }
    // And a ceiling on what is held, because the drop distance alone does not
    // give one: a district is between three and seventeen megabytes, and the
    // cells out past the ring are four and eight kilometres across, so
    // whether half a dozen of them fit in memory depends on which half dozen.
    // The furthest goes first, and whatever you are standing in never does.
    if (Number.isFinite(maxBytes)) {
      const mine = here ? here.id : null;
      while (this.residentBytes > maxBytes) {
        let worst = null, worstAway = -1;
        for (const id of this.districts.keys()) {
          if (id === mine || id === pin) continue;
          const entry = this.entryFor(id);
          const away = entry ? boxDistance(x, z, entry.bounds) : Infinity;
          if (away > worstAway) { worstAway = away; worst = id; }
        }
        if (!worst) break;
        this.unloadDistrict(worst);
      }
    }
    return [...this.pending.keys()];
  }

  /** How many bytes of city are in memory. */
  get residentBytes() {
    let total = 0;
    for (const d of this.districts.values()) total += d.buffer.byteLength;
    return total;
  }

  tileIndex(x, z) {
    const tx = Math.floor((x - this.minX) / this.tileSize);
    const tz = Math.floor((z - this.minZ) / this.tileSize);
    if (tx < 0 || tz < 0 || tx >= this.nx || tz >= this.nz) return -1;
    return tz * this.nx + tx;
  }

  tileOrigin(index) {
    const tx = index % this.nx, tz = (index / this.nx) | 0;
    return [this.minX + tx * this.tileSize, this.minZ + tz * this.tileSize];
  }

  // --- ground -------------------------------------------------------------

  /**
   * The quantised ground of one tile. How fine it is depends on the district's
   * tier, so the field carries its own size: thirty three points across in the
   * middle of town, nine out by the ring, where Berlin is flat enough that the
   * difference is a couple of centimetres.
   *
   * @returns {Int16Array|null} with an `n` property, the points across
   */
  heightField(index) {
    let hf = this.heightCache.get(index);
    if (hf) return hf;
    const rec = this.tiles[index];
    if (!rec) return null;
    const view = rec.view;
    const segs = view.getUint16(rec.cOff, true);
    const n = view.getUint16(rec.cOff + 2, true) || rec.grid || COLLISION_GRID;
    const gridOff = rec.cOff + 4 + segs * 12;
    hf = new Int16Array(n * n);
    for (let i = 0; i < hf.length; i++) hf[i] = view.getInt16(gridOff + i * 2, true);
    hf.n = n;
    this.heightCache.set(index, hf);
    return hf;
  }

  /** The points across the height field of a tile, for anything editing it. */
  gridOf(index) {
    const hf = this.heightField(index);
    return hf ? hf.n : COLLISION_GRID;
  }

  /**
   * How far apart the ground samples are at a point, in metres: 3.125 in the
   * middle of town and coarser outside it. Anything digging a hole has to
   * know, because a hole narrower than this cannot be in the collision at all
   * and so has no business being in the picture either.
   */
  groundStep(x, z) {
    const index = this.tileIndex(x, z);
    if (index < 0) return this.tileSize / (COLLISION_GRID - 1);
    return this.tileSize / Math.max(1, this.gridOf(index) - 1);
  }

  /** Bilinear ground height. Outside the box it clamps to the edge tile. */
  groundHeight(x, z) {
    const cx = Math.min(this.maxX - 0.001, Math.max(this.minX, x));
    const cz = Math.min(this.maxZ - 0.001, Math.max(this.minZ, z));
    const index = this.tileIndex(cx, cz);
    if (index < 0) return 0;
    if (!this.heightField(index)) return this._edgeHeight(index, cx, cz);
    return this._sampleGround(index, cx, cz) + this.craterOffset(index, cx, cz);
  }

  /** What the craters over a tile do to the ground at a point in it. */
  craterOffset(index, x, z) {
    const list = this.craters.get(index);
    if (!list) return 0;
    let d = 0;
    for (const c of list) d += craterProfile(x, z, c, c.level);
    return d;
  }

  /**
   * Put a crater into the ground, or change how far it has been dug. A
   * crater is known by where it is and how wide, so the same hole replayed
   * when its district comes back replaces itself rather than doubling.
   *
   * @param {{x,z,craterRadius,depth,level}} c the crater; kept, not copied
   * @returns {number} how many tiles it reaches
   */
  setCrater(c) {
    const key = `${c.x.toFixed(2)},${c.z.toFixed(2)}`;
    const had = this.craterKeys.get(key);
    if (had && had !== c) this.removeCrater(had);
    if (!(c.level > 0) || !(c.depth > 0)) { this.removeCrater(c); return 0; }
    this.craterKeys.set(key, c);
    const r = c.craterRadius * CRATER_RIM_OUT;
    const tx0 = Math.max(0, Math.floor((c.x - r - this.minX) / this.tileSize));
    const tx1 = Math.min(this.nx - 1, Math.floor((c.x + r - this.minX) / this.tileSize));
    const tz0 = Math.max(0, Math.floor((c.z - r - this.minZ) / this.tileSize));
    const tz1 = Math.min(this.nz - 1, Math.floor((c.z + r - this.minZ) / this.tileSize));
    let n = 0;
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const index = tz * this.nx + tx;
        let list = this.craters.get(index);
        if (!list) { list = []; this.craters.set(index, list); }
        if (!list.includes(c)) list.push(c);
        n++;
      }
    }
    return n;
  }

  /** Take a crater out of the ground again. */
  removeCrater(c) {
    for (const [index, list] of this.craters) {
      const at = list.indexOf(c);
      if (at < 0) continue;
      list.splice(at, 1);
      if (!list.length) this.craters.delete(index);
    }
    for (const [key, v] of this.craterKeys) if (v === c) this.craterKeys.delete(key);
  }

  /** Every crater gone, for a reset. */
  clearCraters() {
    this.craters.clear();
    this.craterKeys.clear();
  }

  /**
   * The ground where there is no tile: off the edge of what has been built,
   * or on a district that has not arrived yet. This used to answer nought,
   * and nought in a district standing forty metres above sea level is a
   * forty metre hole with you at the bottom of it, which is what falling
   * through the floor was. It answers with the nearest ground there is
   * instead, so the city ends in a plateau rather than in a pit.
   */
  _edgeHeight(index, x, z) {
    const tx = index % this.nx;
    const tz = (index / this.nx) | 0;
    for (let r = 1; r <= 3; r++) {
      let best = null, bestD = Infinity;
      for (let j = -r; j <= r; j++) {
        for (let i = -r; i <= r; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const ox = tx + i, oz = tz + j;
          if (ox < 0 || oz < 0 || ox >= this.nx || oz >= this.nz) continue;
          const idx = oz * this.nx + ox;
          if (!this.tiles[idx]) continue;
          const [cxx, czz] = this.tileOrigin(idx);
          const px = Math.min(cxx + this.tileSize - 0.01, Math.max(cxx, x));
          const pz = Math.min(czz + this.tileSize - 0.01, Math.max(czz, z));
          const d = Math.hypot(px - x, pz - z);
          if (d < bestD) { bestD = d; best = [idx, px, pz]; }
        }
      }
      if (best) return this._sampleGround(best[0], best[1], best[2]);
    }
    return 0;
  }

  /** Bilinear read out of one tile's height field, which has to be there. */
  _sampleGround(index, cx, cz) {
    const hf = this.heightField(index);
    if (!hf) return 0;
    const [ox, oz] = this.tileOrigin(index);
    const across = hf.n;
    const n = across - 1;
    const fx = Math.min(n, Math.max(0, ((cx - ox) / this.tileSize) * n));
    const fz = Math.min(n, Math.max(0, ((cz - oz) / this.tileSize) * n));
    const ix = Math.min(n - 1, Math.floor(fx));
    const iz = Math.min(n - 1, Math.floor(fz));
    const tx = fx - ix, tz = fz - iz;
    const h00 = hf[iz * across + ix];
    const h10 = hf[iz * across + ix + 1];
    const h01 = hf[(iz + 1) * across + ix];
    const h11 = hf[(iz + 1) * across + ix + 1];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return (a + (b - a) * tz) / GROUND_SCALE;
  }

  surfaceAt(x, z) {
    const index = this.tileIndex(x, z);
    const rec = index >= 0 ? this.tiles[index] : null;
    if (!rec) return SURFACE.ASPHALT;
    const s = rec.d.surface;
    const ix = Math.round((x - s.minX) / s.step);
    const iz = Math.round((z - s.minZ) / s.step);
    if (ix < 0 || iz < 0 || ix >= s.nx || iz >= s.nz) return SURFACE.ASPHALT;
    return s.data[iz * s.nx + ix];
  }

  // --- collision ----------------------------------------------------------

  /**
   * Segments for one tile, as a flat Float32Array of six values each:
   * x1, z1, x2, z2, base, top, in world metres.
   */
  segments(index) {
    let segs = this.collisionCache.get(index);
    if (segs) return segs;
    const rec = this.tiles[index];
    if (!rec) return EMPTY;
    const view = rec.view;
    const count = view.getUint16(rec.cOff, true);
    const [ox, oz] = this.tileOrigin(index);
    segs = new Float32Array(count * 6);
    let p = rec.cOff + 4;
    for (let i = 0; i < count; i++) {
      segs[i * 6] = view.getInt16(p, true) / 64 + ox;
      segs[i * 6 + 1] = view.getInt16(p + 2, true) / 64 + oz;
      segs[i * 6 + 2] = view.getInt16(p + 4, true) / 64 + ox;
      segs[i * 6 + 3] = view.getInt16(p + 6, true) / 64 + oz;
      segs[i * 6 + 4] = view.getInt16(p + 8, true) / 32;
      segs[i * 6 + 5] = view.getInt16(p + 10, true) / 32;
      p += 12;
    }
    this.collisionCache.set(index, segs);
    return segs;
  }

  /** Call fn(segments, count, tileIndex) for every tile overlapping the box. */
  forEachSegmentTile(minX, minZ, maxX, maxZ, fn) {
    const tx0 = Math.max(0, Math.floor((minX - this.minX) / this.tileSize));
    const tx1 = Math.min(this.nx - 1, Math.floor((maxX - this.minX) / this.tileSize));
    const tz0 = Math.max(0, Math.floor((minZ - this.minZ) / this.tileSize));
    const tz1 = Math.min(this.nz - 1, Math.floor((maxZ - this.minZ) / this.tileSize));
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const index = tz * this.nx + tx;
        const segs = this.segments(index);
        if (segs.length) fn(segs, segs.length / 6, index);
      }
    }
  }

  /**
   * The name of the street you are standing in, or null out in the open.
   *
   * Measured to the centreline rather than to a map label: a label is a point
   * every two hundred and forty metres and the nearest one can easily be on
   * the next street over. This walks the named centrelines in memory and
   * takes the nearest one whose carriageway you are actually on, with a
   * couple of metres of pavement either side so that standing on the kerb
   * still counts.
   *
   * Ties go to the wider road, because a junction is where two names meet and
   * the one people use is the bigger of them.
   *
   * @param {number} slack how far outside the carriageway still counts
   * @returns {{name: string, away: number, cls: string}|null}
   */
  streetAt(x, z, slack = 3.5) {
    const lines = this.manifest.roadLines;
    if (!lines || !lines.length) return null;
    let best = null;
    for (const r of lines) {
      if (!r.n) continue;
      const pts = r.pts;
      // How far outside this particular road still counts as being in it.
      const reach = r.w * 0.5 + slack;
      let near = Infinity;
      for (let i = 2; i < pts.length; i += 2) {
        const ax = pts[i - 2], az = pts[i - 1], bx = pts[i], bz = pts[i + 1];
        // A box test first: most ways in memory are nowhere near you, and
        // this is the whole of the cost on every one of them.
        if (Math.min(ax, bx) - reach > x || Math.max(ax, bx) + reach < x) continue;
        if (Math.min(az, bz) - reach > z || Math.max(az, bz) + reach < z) continue;
        const d = segmentDistance(x, z, ax, az, bx, bz);
        if (d < near) near = d;
      }
      if (near > reach) continue;
      if (!best || near < best.away - 0.5
        || (Math.abs(near - best.away) <= 0.5 && r.w > best.w)) {
        best = { name: r.n, away: near, cls: r.cls, w: r.w };
      }
    }
    if (!best) return null;
    return { name: best.name, away: Math.round(best.away * 10) / 10, cls: best.cls };
  }

  /**
   * The tallest thing standing in a circle, in metres above the ground there.
   * Used to decide where a collapse breaks, which wants an answer in one pass
   * over the segments rather than a raycast. The ground can be given: after
   * a crater the ground at the middle is ten metres down, and a wall that
   * did not move would read ten metres taller against it.
   */
  tallestNear(x, z, radius, ground = this.groundHeight(x, z)) {
    let best = 0;
    const g = ground;
    this.forEachSegmentTile(x - radius, z - radius, x + radius, z + radius, (segs, count) => {
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        // The distance to the wall, not to the middle of it. A facade thirty
        // metres long has its midpoint nowhere near most of itself.
        if (segmentDistance(x, z, segs[o], segs[o + 1], segs[o + 2], segs[o + 3]) > radius) {
          continue;
        }
        const h = segs[o + 5] - g;
        if (h > best) best = h;
      }
    });
    return best;
  }

  // --- raycasting ---------------------------------------------------------

  /**
   * Nearest hit along a ray against the city: the vertical faces in the
   * collision layer plus the ground height field. The same query serves the
   * bullets and the drone line of sight, so it walks the tile grid with a 2D
   * DDA rather than testing every segment in a bounding box.
   *
   * @returns {{t:number, x:number, y:number, z:number, nx:number, ny:number, nz:number, kind:string}|null}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 400, out = null) {
    const hit = out || this._rayHit || (this._rayHit = {
      t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: '',
    });
    let best = maxDist;
    let found = false;

    // --- walls ---
    const ts = this.tileSize;
    let tx = Math.floor((ox - this.minX) / ts);
    let tz = Math.floor((oz - this.minZ) / ts);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const invDx = Math.abs(dx) < 1e-9 ? Infinity : 1 / dx;
    const invDz = Math.abs(dz) < 1e-9 ? Infinity : 1 / dz;
    // Distance along the ray to the next tile boundary on each axis.
    let tMaxX = invDx === Infinity ? Infinity
      : ((this.minX + (tx + (stepX > 0 ? 1 : 0)) * ts) - ox) * invDx;
    let tMaxZ = invDz === Infinity ? Infinity
      : ((this.minZ + (tz + (stepZ > 0 ? 1 : 0)) * ts) - oz) * invDz;
    const tDeltaX = invDx === Infinity ? Infinity : Math.abs(ts * invDx);
    const tDeltaZ = invDz === Infinity ? Infinity : Math.abs(ts * invDz);

    let travelled = 0;
    let guard = 0;
    while (travelled <= best && guard++ < 256) {
      if (tx >= 0 && tz >= 0 && tx < this.nx && tz < this.nz) {
        const segs = this.segments(tz * this.nx + tx);
        const count = segs.length / 6;
        for (let i = 0; i < count; i++) {
          const o = i * 6;
          const t = rayVerticalQuad(
            ox, oy, oz, dx, dy, dz,
            segs[o], segs[o + 1], segs[o + 2], segs[o + 3], segs[o + 4], segs[o + 5],
          );
          if (t < 0 || t >= best) continue;
          best = t;
          found = true;
          const ex = segs[o + 2] - segs[o], ez = segs[o + 3] - segs[o + 1];
          const len = Math.hypot(ex, ez) || 1;
          // Face the normal back towards where the ray came from.
          let nx = ez / len, nz = -ex / len;
          if (nx * dx + nz * dz > 0) { nx = -nx; nz = -nz; }
          hit.nx = nx; hit.ny = 0; hit.nz = nz;
          hit.kind = 'wall';
          // Which segment, so a test can say what stopped it.
          hit.tile = tz * this.nx + tx;
          hit.seg = o;
        }
      }
      // Advance to the next tile.
      if (tMaxX < tMaxZ) { travelled = tMaxX; tx += stepX; tMaxX += tDeltaX; }
      else { travelled = tMaxZ; tz += stepZ; tMaxZ += tDeltaZ; }
      if (!Number.isFinite(travelled)) break;
    }

    // --- ground ---
    // Marched rather than solved, because the height field is bilinear and a
    // closed form is not worth it. The step is fine near the shooter and coarse
    // far away, which is where the error stops mattering.
    if (dy < 0.999) {
      let t = 0;
      let prevGap = oy - this.groundHeight(ox, oz);
      while (t < best) {
        const step = Math.max(0.35, t * 0.05);
        const nt = Math.min(best, t + step);
        const px = ox + dx * nt, py = oy + dy * nt, pz = oz + dz * nt;
        const gap = py - this.groundHeight(px, pz);
        if (gap <= 0) {
          // Bisect once for a tidy impact position.
          let lo = t, hi = nt;
          for (let k = 0; k < 8; k++) {
            const mid = (lo + hi) * 0.5;
            const g = (oy + dy * mid) - this.groundHeight(ox + dx * mid, oz + dz * mid);
            if (g <= 0) hi = mid; else lo = mid;
          }
          if (hi < best) {
            best = hi;
            found = true;
            hit.nx = 0; hit.ny = 1; hit.nz = 0;
            hit.kind = 'ground';
          }
          break;
        }
        prevGap = gap;
        if (nt >= best) break;
        t = nt;
      }
    }

    if (!found) return null;
    hit.t = best;
    hit.x = ox + dx * best;
    hit.y = oy + dy * best;
    hit.z = oz + dz * best;
    return hit;
  }

  /** True when nothing solid stands between the two points. */
  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.001) return true;
    const h = this.raycast(ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.05);
    return h === null;
  }

  /**
   * Trees packed in a tile, unpacked to world space, minus the ones that have
   * burnt down. A tree that bursts or goes over is gone for the rest of the
   * session: it is struck off here, the tile's instance buffer is built again
   * without it, and nothing short of a reload brings it back.
   */
  trees(index) {
    const rec = this.tiles[index];
    if (!rec || !rec.trCount) return null;
    const dead = this.deadTrees.get(index);
    const live = dead ? rec.trCount - dead.size : rec.trCount;
    if (live <= 0) return null;
    const [ox, oz] = this.tileOrigin(index);
    const view = rec.view;
    const out = new Float32Array(live * 5);
    let k = 0;
    for (let i = 0; i < rec.trCount; i++) {
      if (dead && dead.has(i)) continue;
      const o = rec.trOff + i * 8;
      out[k * 5] = view.getInt16(o, true) / 64 + ox;
      out[k * 5 + 1] = view.getInt16(o + 2, true) / 64;
      out[k * 5 + 2] = view.getInt16(o + 4, true) / 64 + oz;
      out[k * 5 + 3] = view.getUint8(o + 6) / 8;
      out[k * 5 + 4] = view.getUint8(o + 7);
      k++;
    }
    return out;
  }

  /**
   * The nearest tree to a point in a tile, as its ordinal in that tile's
   * instance list, so a tree that has burnt down can be named without
   * carrying an id for every tree in Berlin.
   *
   * @returns {number} the ordinal, or -1
   */
  treeAt(index, x, z, within = 1.5) {
    const rec = this.tiles[index];
    if (!rec || !rec.trCount) return -1;
    const [ox, oz] = this.tileOrigin(index);
    const view = rec.view;
    let best = -1, bestD = within * within;
    for (let i = 0; i < rec.trCount; i++) {
      const o = rec.trOff + i * 8;
      const tx = view.getInt16(o, true) / 64 + ox;
      const tz = view.getInt16(o + 4, true) / 64 + oz;
      const d = (tx - x) * (tx - x) + (tz - z) * (tz - z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /**
   * Strikes a tree off for good.
   *
   * @returns {boolean} true when this one had not already gone, which is what
   *   decides whether the tile has to be sent to the card again
   */
  killTree(x, z) {
    const index = this.tileIndex(x, z);
    if (index < 0) return false;
    const ordinal = this.treeAt(index, x, z);
    if (ordinal < 0) return false;
    let dead = this.deadTrees.get(index);
    if (!dead) { dead = new Set(); this.deadTrees.set(index, dead); }
    if (dead.has(ordinal)) return false;
    dead.add(ordinal);
    // And its trunk stops blocking. A tree is four short segments round a
    // 0.64 m box; without this you walk into an invisible post where a tree
    // burnt down an hour ago.
    const segs = this.segments(index);
    for (let i = 0; i < segs.length; i += 6) {
      const mx = (segs[i] + segs[i + 2]) * 0.5;
      const mz = (segs[i + 1] + segs[i + 3]) * 0.5;
      if (Math.hypot(mx - x, mz - z) > 0.9) continue;
      if (segs[i + 5] - segs[i + 4] > 4.5) continue;     // a wall, not a trunk
      segs[i + 5] = segs[i + 4];
    }
    if (this.onTreesChanged) this.onTreesChanged(index);
    return true;
  }

  /** How many trees have been burnt down, for the interface and the tests. */
  get deadTreeCount() {
    let n = 0;
    for (const set of this.deadTrees.values()) n += set.size;
    return n;
  }
}

/**
 * The vertices and indices a tile draws from.
 *
 * Normally that is a slice of the district's own bytes, exactly as the file
 * laid it out. A tile the game has re-meshed carries its own buffer instead:
 * a crater needs vertices inside it to move, and a 12.5 m ground quad has
 * none. Everything that reads or writes a tile's geometry goes through here,
 * so that the uploader, the baker and the re-mesher cannot disagree about
 * which buffer is the real one.
 *
 * The collision and the trees are not in here. They stay in the district's
 * bytes, which is where `rec.cOff` and `rec.trOff` point, and nothing about
 * re-meshing touches them.
 *
 * @param {object} rec a tile record
 * @returns {{buffer: ArrayBuffer, view: DataView, vOff: number, vCount: number,
 *   iOff: number, iCount: number, i32: boolean, tris: number,
 *   min: number[], max: number[]}}
 */
export function tileMesh(rec) {
  return rec.mesh || {
    buffer: rec.d.buffer, view: rec.view,
    vOff: rec.vOff, vCount: rec.vCount,
    iOff: rec.iOff, iCount: rec.iCount,
    i32: !!rec.i32, tris: rec.tris,
    min: rec.min, max: rec.max,
  };
}
