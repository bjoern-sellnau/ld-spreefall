// Produce dist/, a folder that can be copied straight onto GitHub Pages or
// Cloudflare Pages. No bundler, because the whole thing is native ES modules and
// the browser resolves them itself. What this does is copy, minify the CSS a
// little, strip the comments from the JS, and print the payload budget.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

const COPY = [
  'index.html',
  'src',
  'public/world.json',
];

/**
 * The district bundles the index lists, which is not the same as the ones on
 * the disk: fit-city drops the districts that do not fit the budget out of
 * the index, and anything left over in public/ is not shipped.
 */
function districtFiles() {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'world.json'), 'utf8'));
  const out = [];
  for (const d of index.districts || []) {
    for (const rel of [`public/${d.bin}`, `public/${d.json}`]) {
      if (fs.existsSync(path.join(ROOT, rel))) out.push(rel);
      else { console.error(`the index lists ${rel}, which is not here`); process.exit(1); }
    }
  }
  return out;
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// A deliberately conservative comment stripper: it understands strings, template
// literals and regular expression literals well enough not to eat any code.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let prevSignificant = '';
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      let depth = 0;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { out += ch + (src[i + 1] || ''); i += 2; continue; }
        if (quote === '`' && ch === '$' && src[i + 1] === '{') { depth++; out += '${'; i += 2; continue; }
        if (quote === '`' && depth > 0 && ch === '}') { depth--; out += ch; i++; continue; }
        out += ch; i++;
        if (ch === quote && depth === 0) break;
      }
      prevSignificant = quote;
      continue;
    }
    if (c === '/' && /[=(,:[!&|?{};+\-*%\n]/.test(prevSignificant || '\n')) {
      // A regular expression literal.
      out += c; i++;
      let inClass = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { out += ch + (src[i + 1] || ''); i += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { out += ch; i++; break; }
        else if (ch === '\n') break;
        out += ch; i++;
      }
      while (i < n && /[gimsuyd]/.test(src[i])) { out += src[i]; i++; }
      prevSignificant = '/';
      continue;
    }
    if (!/\s/.test(c)) prevSignificant = c;
    out += c;
    i++;
  }
  // Collapse the blank lines the comments left behind.
  return out.split('\n').map((l) => l.replace(/[ \t]+$/, '')).filter((l, idx, arr) => {
    if (l !== '') return true;
    return arr[idx - 1] !== '';
  }).join('\n');
}

function minifyCss(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function copyInto(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copyInto(path.join(src, name), path.join(dest, name));
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ext = path.extname(src);
  if (ext === '.js' || ext === '.mjs') {
    fs.writeFileSync(dest, stripComments(fs.readFileSync(src, 'utf8')));
  } else if (ext === '.css') {
    fs.writeFileSync(dest, minifyCss(fs.readFileSync(src, 'utf8')));
  } else {
    fs.copyFileSync(src, dest);
  }
}

function main() {
  if (!fs.existsSync(path.join(ROOT, 'public', 'world.json'))) {
    console.error('public/world.json is missing. Run: npm run world');
    process.exit(1);
  }
  const districts = districtFiles();
  if (!districts.length) {
    console.error('no district bundles in public/. Run: npm run world');
    process.exit(1);
  }
  COPY.push(...districts);
  rmrf(DIST);
  fs.mkdirSync(DIST, { recursive: true });
  for (const rel of COPY) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) { console.error(`missing ${rel}`); process.exit(1); }
    copyInto(src, path.join(DIST, rel));
  }
  // GitHub Pages runs Jekyll by default, which drops folders starting with an
  // underscore and can rewrite things. This turns it off.
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
  fs.writeFileSync(path.join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n');

  const files = walk(DIST);
  let raw = 0, gz = 0;
  const rows = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const g = zlib.gzipSync(buf, { level: 9 }).length;
    raw += buf.length;
    gz += g;
    rows.push([path.relative(DIST, f), buf.length, g]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  console.log('dist/ contents, largest first');
  for (const [name, r, g] of rows.slice(0, 12)) {
    console.log(`  ${name.padEnd(34)} ${(r / 1024).toFixed(1).padStart(9)} kB  ${(g / 1024).toFixed(1).padStart(9)} kB gzipped`);
  }
  if (rows.length > 12) console.log(`  and ${rows.length - 12} smaller files`);
  console.log('');
  console.log(`files          ${files.length}`);
  console.log(`total          ${(raw / 1e6).toFixed(2)} MB`);
  console.log(`over the wire  ${(gz / 1e6).toFixed(2)} MB gzipped`);
  // What a player downloads to play is the code, the index and the one
  // district they are in, because the game holds one at a time. That is the
  // figure the brief's twenty five megabytes is held against, and it is
  // checked by tools/fit-city.mjs, which knows what each district weighs.
  // Here the whole of what is deployed is simply reported: it is the other
  // honest number and for all of Berlin it is hundreds of megabytes.
  console.log(`the whole city ${(gz / 1e6).toFixed(2)} MB of download if you visited every district`);
}

main();
