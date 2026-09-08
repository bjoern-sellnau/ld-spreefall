// A hand written OSM XML reader. Single forward pass over the text, no library.
// Handles <node>, <way>, <relation>, <tag>, <nd>, <member>, self closing or not,
// attribute values in single or double quotes, and the five XML entities.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[body] !== undefined ? ENT[body] : m;
  });
}

// Reads name="value" pairs out of a raw tag body.
function readAttrs(src, from, to) {
  const attrs = {};
  let i = from;
  while (i < to) {
    while (i < to && /\s/.test(src[i])) i++;
    if (i >= to) break;
    const nameStart = i;
    while (i < to && src[i] !== '=' && !/\s/.test(src[i]) && src[i] !== '/' && src[i] !== '>') i++;
    const name = src.slice(nameStart, i);
    while (i < to && /\s/.test(src[i])) i++;
    if (src[i] !== '=') { if (name) attrs[name] = ''; continue; }
    i++;
    while (i < to && /\s/.test(src[i])) i++;
    const q = src[i];
    if (q !== '"' && q !== "'") break;
    i++;
    const valStart = i;
    while (i < to && src[i] !== q) i++;
    attrs[name] = decode(src.slice(valStart, i));
    i++;
  }
  return attrs;
}

/**
 * @param {string} src raw OSM XML
 * @returns {{nodes: Map<number,{id:number,lat:number,lon:number,tags:Object}>,
 *            ways: Map<number,{id:number,refs:number[],tags:Object}>,
 *            relations: Map<number,{id:number,members:{type:string,ref:number,role:string}[],tags:Object}>}}
 */
export function parseOsmXml(src) {
  const nodes = new Map();
  const ways = new Map();
  const relations = new Map();

  let current = null;      // the element tags/nd/member lines attach to
  let currentKind = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt) + 3; if (i < 3) break; continue; }
    if (src.startsWith('<?', lt)) { i = src.indexOf('?>', lt) + 2; if (i < 2) break; continue; }
    let gt = lt + 1;
    let quote = 0;
    while (gt < n) {
      const c = src[gt];
      if (quote) { if (c === String.fromCharCode(quote)) quote = 0; }
      else if (c === '"' || c === "'") quote = c.charCodeAt(0);
      else if (c === '>') break;
      gt++;
    }
    if (gt >= n) break;

    const closing = src[lt + 1] === '/';
    const selfClosing = src[gt - 1] === '/';
    let ns = lt + (closing ? 2 : 1);
    let ne = ns;
    while (ne < gt && !/[\s/>]/.test(src[ne])) ne++;
    const name = src.slice(ns, ne);
    const body = selfClosing ? gt - 1 : gt;

    if (closing) {
      if (name === 'node' || name === 'way' || name === 'relation') { current = null; currentKind = ''; }
      i = gt + 1;
      continue;
    }

    switch (name) {
      case 'node': {
        const a = readAttrs(src, ne, body);
        const el = { id: +a.id, lat: +a.lat, lon: +a.lon, tags: {} };
        nodes.set(el.id, el);
        if (!selfClosing) { current = el; currentKind = 'node'; }
        break;
      }
      case 'way': {
        const a = readAttrs(src, ne, body);
        const el = { id: +a.id, refs: [], tags: {} };
        ways.set(el.id, el);
        if (!selfClosing) { current = el; currentKind = 'way'; }
        break;
      }
      case 'relation': {
        const a = readAttrs(src, ne, body);
        const el = { id: +a.id, members: [], tags: {} };
        relations.set(el.id, el);
        if (!selfClosing) { current = el; currentKind = 'relation'; }
        break;
      }
      case 'tag': {
        if (current) {
          const a = readAttrs(src, ne, body);
          current.tags[a.k] = a.v;
        }
        break;
      }
      case 'nd': {
        if (current && currentKind === 'way') {
          const a = readAttrs(src, ne, body);
          current.refs.push(+a.ref);
        }
        break;
      }
      case 'member': {
        if (current && currentKind === 'relation') {
          const a = readAttrs(src, ne, body);
          current.members.push({ type: a.type, ref: +a.ref, role: a.role || '' });
        }
        break;
      }
      default: break;
    }
    i = gt + 1;
  }

  return { nodes, ways, relations };
}

export function counts(data) {
  return { nodes: data.nodes.size, ways: data.ways.size, relations: data.relations.size };
}
