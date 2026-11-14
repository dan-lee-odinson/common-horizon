// Smoke test for web/public/models/index.html, in a real (headless) browser.
//
//   npm run test:page              (screenshots go to your temp folder)
//   node test-page/page-smoke.mjs --out some/folder
//
// It starts the preview server, opens the page with the local copy of three.js, and checks:
//   - the page reaches its "ready" state with no errors in the browser console;
//   - the summary table and the cards list all five models;
//   - every 3D view drew something (not just background);
//   - the size measured by three.js in the browser matches each model's JSON within 1 percent,
//     and the browser counts the same number of triangles.
// It needs Playwright, which is NOT a dependency of this folder (it is large). If Playwright
// is not installed the test prints SKIPPED and exits 0.

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer } from '../preview-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(here, '../../../web/public/models');
const require = createRequire(import.meta.url);

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const outDir = path.resolve(values.out ?? path.join(os.tmpdir(), 'model-page-screenshots'));

let playwright;
try {
  playwright = require('playwright');
} catch {
  console.log('SKIPPED: Playwright is not installed, so the page test cannot run here.');
  process.exit(0);
}

const problems = [];
const fail = (message) => problems.push(message);

const { server, url } = await startServer({ port: 0 });
const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(`${url}/index.html?three=local`);
  await page.waitForFunction(() => document.body.dataset.state !== 'loading', null, { timeout: 60000 });
  const state = await page.evaluate(() => document.body.dataset.state);
  if (state !== 'ready') fail(`page state is "${state}", expected "ready"; notice: ${await page.textContent('#notice')}`);

  const jsonFiles = fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith('.json'));
  const facts = Object.fromEntries(
    jsonFiles.map((f) => {
      const json = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, f), 'utf8'));
      return [json.id, json];
    }),
  );

  const rows = await page.$$eval('#summary tr', (trs) => trs.length);
  if (rows !== jsonFiles.length) fail(`summary table has ${rows} rows, the folder has ${jsonFiles.length} models`);
  const cards = await page.$$eval('.viewer', (nodes) => nodes.map((n) => ({ id: n.dataset.model, state: n.dataset.state })));
  for (const id of Object.keys(facts)) {
    const card = cards.find((c) => c.id === id);
    if (!card) fail(`no card for ${id}`);
    else if (card.state !== 'ready') fail(`card for ${id} is "${card.state}"`);
  }

  // Let a few frames run, then read what the browser measured and drew.
  await page.waitForTimeout(500);
  const report = await page.evaluate(() =>
    window.__modelViewers.map((v) => ({ id: v.id, size: v.size, triangles: v.triangles, coverage: v.coverage() })),
  );
  for (const r of report) {
    const label = r.id === 'lineup' ? 'line-up view' : `${r.id} view`;
    console.log(`${label}: ${(r.coverage * 100).toFixed(1)}% of pixels show the model`);
    if (!(r.coverage > 0.002)) fail(`${label} looks empty (${(r.coverage * 100).toFixed(2)}% of pixels drawn)`);
    if (r.id === 'lineup') continue;
    const json = facts[r.id];
    const dims = [json.dimensions_m.width_x, json.dimensions_m.height_y, json.dimensions_m.depth_z];
    r.size.forEach((measured, i) => {
      const error = Math.abs(measured - dims[i]) / dims[i];
      if (error > 0.01) fail(`${r.id}: browser measured ${measured.toFixed(3)} m on axis ${'xyz'[i]}, JSON says ${dims[i]} m`);
    });
    if (r.triangles !== json.triangles) fail(`${r.id}: browser counted ${r.triangles} triangles, JSON says ${json.triangles}`);
    console.log(`${r.id}: browser measured ${r.size.map((v) => v.toFixed(3)).join(' x ')} m, ${r.triangles} triangles`);
  }
  for (const message of consoleErrors) fail(`browser console error: ${message}`);

  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, 'page-full.png'), fullPage: true });
  await page.locator('#lineup').screenshot({ path: path.join(outDir, 'lineup.png') });
  for (const id of Object.keys(facts)) {
    await page.locator(`#${id} .viewer canvas`).screenshot({ path: path.join(outDir, `${id}.png`) });
  }
  console.log(`Screenshots: ${outDir}`);

  // Narrow phone-width check: nothing should force sideways scrolling.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) fail(`page scrolls sideways by ${overflow}px at 375px wide`);
  await page.screenshot({ path: path.join(outDir, 'page-phone.png'), fullPage: false });
} finally {
  await browser.close();
  server.close();
}

if (problems.length > 0) {
  for (const p of problems) console.log(`x ${p}`);
  console.log('\nRESULT: FAIL');
  process.exitCode = 1;
} else {
  console.log('\nRESULT: PASS');
}
