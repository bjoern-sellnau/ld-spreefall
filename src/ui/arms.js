// What you carry, down the left side of the screen, in the manner of the
// Half-Life weapon menu turned on its side: one row a number key, the key in
// a box, and in it the weapon that key would give you. The row you are on is
// lit and its ammunition is a bar under the name. Press a key or turn the
// wheel and that key's group opens, every weapon in it listed with its own
// bar, for a couple of seconds, and then the panel folds back and dims.
//
// In a mode with a kit of its own it is one weapon a key, in the kit's order.

import { BUCKETS, BUCKET_KEYS, WEAPONS } from '../game/arsenal.js';

export const ARMS = {
  open: 2.4,       // seconds a group stays open after a pick
  dim: 0.55,       // how far the panel fades when nothing is happening
};

/**
 * The rows the panel shows, as data: a pure function of what the weapon
 * carries, so the checks can read it without a page.
 *
 * @param {import('../game/weapon.js').Weapon} weapon
 * @returns {{key:number, name:string, ids:string[], pick:string, current:boolean}[]}
 */
export function armsRows(weapon) {
  if (weapon.kit) {
    return weapon.kit.map((id, i) => ({
      key: (i + 1) % 10, name: WEAPONS[id].name, ids: [id], pick: id, current: id === weapon.id,
    }));
  }
  return BUCKET_KEYS.map((key) => {
    const ids = BUCKETS[key].ids;
    const current = ids.includes(weapon.id);
    const last = weapon.lastInBucket ? weapon.lastInBucket[key] : null;
    const pick = current ? weapon.id : (last && ids.includes(last) ? last : ids[0]);
    return { key, name: BUCKETS[key].name, ids, pick, current };
  });
}

/** How full a weapon is, 0 to 1, magazine and reserve together. */
export function armsFill(weapon, id) {
  const spec = WEAPONS[id];
  const c = weapon.carried[id];
  if (!c) return 0;
  const most = spec.magazine + spec.reserve;
  return most > 0 ? Math.max(0, Math.min(1, (c.ammo + c.reserve) / most)) : 0;
}

export class ArmsPanel {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.builtFor = undefined;    // the kit the rows were built for
    this.rows = [];
    this.openKey = null;
    this.openLeft = 0;
    this.lastId = null;
    this.shown = false;
  }

  /** A number key or the wheel: open that key's group for a moment. */
  poke(key) {
    this.openKey = key;
    this.openLeft = ARMS.open;
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.add('hidden');
  }

  _build(weapon) {
    this.builtFor = weapon.kit;
    this.root.innerHTML = '';
    this.rows = [];
    for (const row of armsRows(weapon)) {
      const r = document.createElement('div');
      r.className = 'row';
      const k = document.createElement('b');
      k.textContent = String(row.key);
      r.appendChild(k);
      const list = document.createElement('div');
      list.className = 'list';
      const items = {};
      for (const id of row.ids) {
        const it = document.createElement('div');
        it.className = 'it';
        const name = document.createElement('span');
        name.textContent = WEAPONS[id].short;
        const bar = document.createElement('i');
        const fill = document.createElement('u');
        bar.appendChild(fill);
        it.append(name, bar);
        list.appendChild(it);
        items[id] = { it, fill, fillAt: -1, cls: '' };
      }
      r.appendChild(list);
      this.root.appendChild(r);
      this.rows.push({ key: row.key, el: r, items, cls: '' });
    }
  }

  /**
   * @param {number} dt real seconds
   * @param {object} weapon
   * @param {boolean} visible
   */
  update(dt, weapon, visible) {
    if (!visible) { this.hide(); return; }
    if (!this.shown) { this.shown = true; this.root.classList.remove('hidden'); }
    if (this.builtFor !== weapon.kit || !this.rows.length) this._build(weapon);
    // A change of weapon by any route (the wheel, a pickup, a mode) opens its
    // group as a key would.
    if (weapon.id !== this.lastId) {
      if (this.lastId !== null) {
        const row = armsRows(weapon).find((r) => r.current);
        if (row) this.poke(row.key);
      }
      this.lastId = weapon.id;
    }
    this.openLeft = Math.max(0, this.openLeft - dt);
    if (this.openLeft <= 0) this.openKey = null;
    this.root.classList.toggle('idle', this.openKey === null);
    const data = armsRows(weapon);
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const row = this.rows[i];
      const open = this.openKey === d.key && d.ids.length > 1;
      const cls = `row${d.current ? ' cur' : ''}${open ? ' open' : ''}`;
      if (cls !== row.cls) { row.el.className = cls; row.cls = cls; }
      for (const id of d.ids) {
        const item = row.items[id];
        const f = armsFill(weapon, id);
        const want = `it${id === d.pick ? ' pick' : ''}${id === weapon.id ? ' on' : ''}${f <= 0 ? ' dry' : ''}`;
        if (want !== item.cls) { item.it.className = want; item.cls = want; }
        const pct = Math.round(f * 100);
        if (pct !== item.fillAt) { item.fill.style.width = `${pct}%`; item.fillAt = pct; }
      }
    }
  }
}
