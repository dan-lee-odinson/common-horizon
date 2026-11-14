// Tests for the review page that need no browser (the browser test is test-page/page-smoke.mjs).
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRIEF } from '../brief-figures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.resolve(here, '../../../web/public/models/index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8'));

test('review page loads the same three.js version as package.json', () => {
  const versions = [...page.matchAll(/three@([0-9][^/'"]*)\//g)].map((m) => m[1]);
  assert.ok(versions.length > 0, 'no pinned three.js version found in index.html');
  for (const v of versions) assert.equal(v, pkg.dependencies.three);
});

test('review page lists every model of the brief, in the order of the brief', () => {
  const match = page.match(/const MODEL_IDS = \[([^\]]*)\]/);
  assert.ok(match, 'MODEL_IDS not found in index.html');
  const ids = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, Object.keys(BRIEF));
});

test('review page has no external resources other than the pinned three.js CDN', () => {
  const urls = [...page.matchAll(/https?:\/\/[^\s'"<>)]+/g)].map((m) => m[0]);
  for (const u of urls) assert.match(u, /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@/, `unexpected URL ${u}`);
});
