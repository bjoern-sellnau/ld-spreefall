// A static file server for local development and for the headless checks.
// No dependencies, byte range support, correct MIME types.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.env.PORT || '8080', 10);
const DIR = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
  '.osm': 'application/xml; charset=utf-8',
};

/**
 * What a development page is: the commit checked out and when it was made.
 * The Pages build writes a version.json of its own; this answers in its place
 * when there is none on the disk.
 */
function devVersion() {
  const git = (args) => { try { return execSync(`git ${args}`, { cwd: ROOT }).toString().trim(); } catch { return ''; } };
  return { build: 'dev', commit: git('rev-parse --short HEAD'), time: git('log -1 --format=%cI') || null };
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/version.json' && !fs.existsSync(path.join(DIR, 'version.json'))) {
    const body = JSON.stringify(devVersion());
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' });
    res.end(body);
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.join(DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIR)) { res.writeHead(403).end('forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${st.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Cache-Control': 'no-cache',
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`serving ${DIR} on http://localhost:${PORT}/`);
});
