import { expect, test, type Page, type Request } from '@playwright/test';

// The main path, in BOTH modes, at a desktop width:
//   load -> pick hardware -> the ranked list appears -> move the launch delay -> open a site ->
//   the horizon chart draws.
// The default config runs it on example data (no backend address). playwright.live.config.ts runs
// the same file against a live backend (VITE_API_BASE), with the project's metadata saying so
// (`npm run test:e2e:live`; the backend must be running and must allow this site's origin).

/** The stored check against NASA JPL Horizons, as the backend's script writes it (two sites only). */
const HORIZONS_CHECK = {
  format: 'common-horizon/horizons-check-summary',
  format_version: 1,
  sites: Object.fromEntries(
    ['nobile', 'shackleton-ridge', 'apollo-11', 'apollo-12', 'apollo-14', 'apollo-15', 'apollo-16', 'apollo-17', 'im-1-odysseus', 'im-2-athena', 'blue-ghost-m1', 'im-3-reiner-gamma', 'blue-ghost-m2', 'blue-ghost-m3', 'draper-cp12', 'chandrayaan-3', 'slim'].map((id) => [
      id,
      {
        sun_max_angle_deg: 0.005991,
        earth_max_angle_deg: 0.000211,
        samples: { sun: 8761, earth: 8761 },
        period: { start_utc: '2027-01-01T00:00Z', stop_utc: '2028-01-01T00:00Z', step_minutes: 60 },
        retrieved_utc: '2026-11-15T14:01Z',
        horizons_url: 'https://ssd.jpl.nasa.gov/api/horizons.api',
      },
    ]),
  ),
};

function isLive(): boolean {
  return test.info().project.metadata?.mode === 'live';
}

async function readout(page: Page, key: string): Promise<string> {
  return (await page.locator(`[data-q="${key}"] [data-q-text]`).first().textContent()) ?? '';
}

/** Every POST /evaluate body the page sends (live mode). */
function watchEvaluate(page: Page): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/evaluate')) bodies.push(r.postDataJSON() as Record<string, unknown>);
  });
  return bodies;
}

const RESULT_ORDER: Record<string, number> = { pass: 0, unknown: 1, fail: 2 };

test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'the main path is checked at a desktop width; the phone layouts have their own tests');
  // The stored Horizons check is a static file served with the website; this branch does not carry
  // it (it comes with the backend's feat/horizons-live), so the test serves the file's shape.
  await page.route('**/data/horizons-check.json', (route) => route.fulfill({ json: HORIZONS_CHECK }));
});

test('main path: hardware, ranking, launch delay, a site and its horizon chart', async ({ page }) => {
  test.setTimeout(150_000);
  const live = isLive();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const evaluateBodies = watchEvaluate(page);

  // ---- load ----
  await page.goto('/');
  await page.getByTestId('begin').click();
  if (live) {
    // The local backend runs its synthetic engine: TEST DATA, never EXAMPLE DATA.
    await expect(page.getByTestId('data-source')).toHaveAttribute('data-source', 'test', { timeout: 30_000 });
    await expect(page.getByTestId('data-source')).toHaveText('Test data');
    await expect(page.getByTestId('example-badge')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('example-badge')).toHaveText('Example data');
  }
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('mission-hud')).toBeVisible();

  // ---- pick hardware ----
  await page.getByTestId('edit-mission').click();
  const planner = page.getByTestId('planner');
  await expect(planner).toHaveAttribute('data-open', 'true');
  // The planner's catalog: its own ids, the four kinds, each figure with its status and source.
  await expect(planner.locator('[data-testid="hardware-row"][data-id="starship_hls"]')).toBeVisible({ timeout: 30_000 });
  await expect(planner.getByTestId('kind-heading')).toHaveCount(4);
  await expect(planner.locator('[data-testid="hardware-row"][data-kind="load"]').first()).toBeVisible();
  const jaxa = planner.locator('[data-testid="hardware-row"][data-id="jaxa_pressurized_rover"]');
  await expect(jaxa.locator('[data-testid="figure"][data-published="false"]')).toContainText('not published');
  await expect(jaxa.getByTestId('figure-source')).not.toHaveText('');
  await expect(planner.locator('[data-testid="hardware-row"][data-id="vsat"]').getByTestId('figure-status')).toHaveText(['company figure']);
  // Starship HLS has two published payload figures: the first is picked until the visitor picks another.
  const options = planner.locator('[data-testid="hardware-row"][data-id="starship_hls"]').getByTestId('capacity-option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toBeChecked();
  await options.nth(1).check();
  await expect(options.nth(1)).toBeChecked();
  // Add a load: a comms relay.
  await planner.locator('[data-testid="hardware-row"][data-id="comms_relay"] input[type="checkbox"]').check();
  await expect(page.getByTestId('mission-summary')).toContainText('Comms relay');
  // The fit check marks the line for the picked figure.
  await expect(planner.getByTestId('fit-status')).toBeVisible({ timeout: 30_000 });
  await expect(planner.locator('[data-testid="fit-notes"] [data-picked]')).toContainText('cargo variants');
  await page.keyboard.press('Escape');
  await expect(planner).toHaveAttribute('data-open', 'false');

  // ---- the ranked list appears, in the answer's order ----
  const rows = page.getByTestId('ranked-row');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('spotlight-name')).not.toHaveText('');
  const results = await page.getByTestId('verdict').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.result ?? ''));
  expect(results.length).toBeGreaterThan(0);
  for (const r of results) expect(['pass', 'unknown', 'fail']).toContain(r);
  // Passing sites first, then unknown, then failing: never re-sorted by score.
  for (let i = 1; i < results.length; i++) expect(RESULT_ORDER[results[i]]).toBeGreaterThanOrEqual(RESULT_ORDER[results[i - 1]]);
  // Starship HLS publishes no slope limit: a site that fails nothing is UNKNOWN, with the requirement, never a pass.
  const verdict = page.getByTestId('spotlight-verdict');
  if ((await verdict.getAttribute('data-result')) === 'unknown') await expect(verdict).toHaveText(/^UNKNOWN: landing slope$/i);
  await expect(page.getByTestId('verdict').first()).not.toHaveText('pass');

  // Transit: our estimate, beside the landing date; the landing is the answer's own.
  await expect(page.getByTestId('transit')).toHaveText('5 days (our estimate)');
  const landing0 = await page.getByTestId('landing').textContent();
  expect(landing0).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);

  // Terrain: the local backend's synthetic engine says it is not modelled; the example model has invented terrain.
  if (live) await expect(page.getByTestId('terrain-note')).toHaveText('smooth Moon, terrain not included');
  else await expect(page.getByTestId('terrain-note')).toHaveCount(0);

  // ---- move the launch delay ----
  await page.getByTestId('slip').fill('7');
  await expect(page.getByTestId('slip-value')).toContainText('+7');
  await expect.poll(() => page.getByTestId('landing').textContent(), { timeout: 60_000 }).not.toBe(landing0);
  await expect(page.getByTestId('rank-strip')).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
  await expect(rows.first()).toBeVisible();
  await expect(page.getByTestId('transit')).toHaveText('5 days (our estimate)');
  if (live) {
    // Every evaluation carried the transit time.
    expect(evaluateBodies.length).toBeGreaterThan(2);
    for (const b of evaluateBodies) expect(b.transit_days).toBe(5);
  }

  // ---- open a site: the horizon chart draws ----
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'site', { timeout: 20_000 });
  await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 60_000 });
  const plot = page.getByTestId('horizon-panel').first();
  await expect(plot).toBeVisible();
  const skyline = plot.locator('[data-skyline]');
  await expect(skyline).toHaveCount(1);
  expect(((await skyline.getAttribute('d')) ?? '').length).toBeGreaterThan(50);
  // The Sun marker says lit or dark: the answer's own word (src/hud/markerTimeline.test.ts holds it to the timeline).
  await expect(page.getByTestId('horizon-sun').first()).toHaveAttribute('data-state', /lit|dark/);
  expect(['lit', 'dark']).toContain(await readout(page, 'sun_state'));

  // The Site stage's notes: terrain, the answer's warnings, and the stored JPL Horizons figures.
  const checks = page.getByTestId('site-checks').first();
  await expect(checks.getByTestId('horizons-check')).toContainText('Checked against NASA JPL Horizons');
  await expect(checks.getByTestId('horizons-check')).toContainText('0.005991°');
  if (live) {
    await expect(page.getByTestId('site-terrain')).toHaveText('smooth Moon, terrain not included');
    await expect(checks.getByTestId('horizon-warnings').locator('li').first()).toBeVisible();
    // Compare now: this backend cannot reach JPL Horizons from here, so the stored figure stands, and it says so.
    await checks.getByTestId('horizons-compare').click();
    await expect(checks.getByTestId('horizons-compare-failed')).toContainText('Showing the stored figure above instead.', { timeout: 20_000 });
  } else {
    await expect(checks.getByTestId('horizons-compare')).toHaveCount(0);
  }

  expect(errors).toEqual([]);
});

test('live mode: Compare now shows both directions and the angle between them', async ({ page }) => {
  test.skip(!isLive(), 'live mode only: example mode has no engine to compare');
  test.setTimeout(120_000);
  const answer = {
    site: { latitude_deg: 0, longitude_deg: 0, site_height_m: 0, observer_height_m: 2 },
    requested_time_utc: '2027-02-15T15:00:00Z',
    time_utc: '2027-02-15T15:00:00Z',
    sun: { horizons: { azimuth_deg: 20.54751, elevation_deg: -1.087997 }, engine: { azimuth_deg: 20.552974, elevation_deg: -1.087942 }, angle_between_deg: 0.005463 },
    earth: { horizons: { azimuth_deg: 156.478955, elevation_deg: 5.766362 }, engine: { azimuth_deg: 156.479153, elevation_deg: 5.766368 }, angle_between_deg: 0.000197 },
    engine_unavailable_reason: null,
    provenance: { horizons: { service: 'JPL Horizons System', url: '', api_url: '', api_version: '1.2', retrieved_utc: '2026-11-15T14:01:00Z', from_cache: false } },
  };
  let asked = 0;
  await page.route('**/api/v1/horizons/compare?**', (route) => {
    asked++;
    return route.fulfill({ json: answer });
  });
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('ranked-row').first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 60_000 });
  const checks = page.getByTestId('site-checks').first();
  await checks.getByTestId('horizons-compare').click();
  const result = checks.getByTestId('horizons-compare-result');
  await expect(result).toContainText('az 20.5475°, el −1.0880°');
  await expect(result).toContainText('az 20.5530°, el −1.0879°');
  await expect(checks.getByTestId('horizons-angle-sun')).toHaveText('0.005463°');
  await expect(checks.getByTestId('horizons-angle-earth')).toHaveText('0.000197°');
  // Asked once, when pressed: never on every frame.
  await page.waitForTimeout(1500);
  expect(asked).toBe(1);
});

test('live mode: the assistant is not available in this version, and a 422 shows the backend’s own message', async ({ page }) => {
  test.skip(!isLive(), 'live mode only: example mode keeps its example assistant');
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  const input = page.getByTestId('chat-input');
  await expect(page.getByTestId('ranked-row').first()).toBeVisible({ timeout: 60_000 });
  await expect(input).toBeDisabled({ timeout: 30_000 });
  await expect(input).toHaveAttribute('placeholder', 'The assistant is not available in this version');
  await expect(page.getByTestId('chat-ask')).toBeDisabled();

  // The backend refuses a request: its own words are shown.
  await page.route('**/evaluate', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 422, json: { detail: "Unknown hardware id 'starship'. Known ids: griffin, starship_hls." } }) : route.continue(),
  );
  await page.getByTestId('slip').fill('3');
  await expect(page.getByTestId('evaluation-error')).toContainText("Unknown hardware id 'starship'. Known ids: griffin, starship_hls.", { timeout: 30_000 });
  // The physics engine is unavailable: said in words.
  await page.unroute('**/evaluate');
  await page.route('**/evaluate', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { detail: 'engine down' } }) : route.continue()));
  await page.getByTestId('slip').fill('4');
  await expect(page.getByTestId('evaluation-error')).toContainText('The physics engine is unavailable right now', { timeout: 30_000 });
});
