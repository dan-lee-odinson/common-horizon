// Tests for the preview server: it serves the page, the models and three.js, and nothing else.
// Run: npm test

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../preview-server.mjs';

const { server, url } = await startServer({ port: 0 });
after(() => server.close());

// Raw request, so the path is sent exactly as written (no URL clean-up by the client).
function get(rawPath) {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (response) => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'] }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('serves the page, the models and the allowed three.js folders', async () => {
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/index.html')).status, 200);
  const glb = await get('/starship-lander.glb');
  assert.equal(glb.status, 200);
  assert.equal(glb.type, 'model/gltf-binary');
  assert.equal((await get('/vendor/three/build/three.module.js')).status, 200);
  assert.equal((await get('/vendor/three/examples/jsm/loaders/GLTFLoader.js')).status, 200);
});

test('refuses paths that try to leave the allowed folders', async () => {
  for (const rawPath of [
    '/../package.json',
    '/%2e%2e/%2e%2e/README.md',
    '/..%2f..%2fREADME.md',
    '/vendor/three/package.json',
    '/vendor/three/build%2f..%2fpackage.json',
    '/vendor/three/build/../package.json',
    '/vendor/three/examples/jsm/../../package.json',
    '/vendor/three/build/%2e%2e/%2e%2e/%2e%2e/package.json',
    '/index.html%00.png',
  ]) {
    assert.equal((await get(rawPath)).status, 404, rawPath);
  }
});
