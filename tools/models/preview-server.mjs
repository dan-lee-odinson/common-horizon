// Tiny static web server for reviewing the models page without the rest of the website.
//
//   npm run preview            then open http://localhost:8080/?three=local
//
// It serves web/public/models/ at "/" and, at "/vendor/three/", the copy of three.js that
// `npm install` put in node_modules, so the page also works with no internet connection
// (that is what "?three=local" selects). Without "?three=local" the page loads three.js
// from the jsDelivr CDN, the same as on the website.
// Uses only Node's built-in modules.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_DIR = path.resolve(here, '../../web/public/models');
const THREE_DIR = path.resolve(here, 'node_modules/three');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

// Map a URL path to a file, refusing anything outside the allowed folders. The path is
// resolved first and checked afterwards, so tricks like "build%2f..%2f" cannot escape.
export function resolveFile(urlPath) {
  if (urlPath.includes('\0')) return null;
  const inside = (root, file) => file === root || file.startsWith(root + path.sep);
  if (urlPath.startsWith('/vendor/three/')) {
    const file = path.resolve(THREE_DIR, `.${urlPath.slice('/vendor/three'.length)}`);
    const relative = path.relative(THREE_DIR, file).split(path.sep).join('/');
    if (!inside(THREE_DIR, file)) return null;
    if (!relative.startsWith('build/') && !relative.startsWith('examples/jsm/')) return null;
    return file;
  }
  const file = path.resolve(PAGE_DIR, `.${urlPath === '/' ? '/index.html' : urlPath}`);
  return inside(PAGE_DIR, file) ? file : null;
}

export function startServer({ port = 8080, host = '127.0.0.1' } = {}) {
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    let file = resolveFile(urlPath);
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found\n');
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = fs.createReadStream(file);
    stream.on('error', () => response.destroy()); // e.g. file removed mid-read: drop this response only
    stream.pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ server, url: `http://${host === '127.0.0.1' ? 'localhost' : host}:${address.port}` });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  const { url } = await startServer({ port });
  console.log(`Models page:            ${url}/`);
  console.log(`Offline (local three):  ${url}/?three=local`);
  console.log('Press Ctrl+C to stop.');
}
