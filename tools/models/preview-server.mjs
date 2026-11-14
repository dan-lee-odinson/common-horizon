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

// Map a URL path to a file, refusing anything outside the allowed folders.
function resolveFile(urlPath) {
  let root;
  let rest;
  if (urlPath.startsWith('/vendor/three/')) {
    root = THREE_DIR;
    rest = urlPath.slice('/vendor/three/'.length);
    if (!rest.startsWith('build/') && !rest.startsWith('examples/jsm/')) return null;
  } else {
    root = PAGE_DIR;
    rest = urlPath.slice(1) || 'index.html';
  }
  const file = path.resolve(root, rest);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return file;
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
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(file).pipe(response);
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
