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

/** The stored Sun check against NASA Moon Trek: the layout of the backend's web/public/data/moon-trek-sun-check.json (feat/moon-trek-slope). */
const MOON_TREK_CHECK = {
  format: 'common-horizon/moon-trek-sun-check-summary',
  format_version: 1,
  sites: Object.fromEntries(
    Object.keys(HORIZONS_CHECK.sites).map((id) => [
      id,
      { sun_max_angle_deg: 0.006048, samples: 8761, period: { start_utc: '2027-01-01T00:00Z', stop_utc: '2028-01-01T00:00Z', step_minutes: 60 }, retrieved_utc: '2026-11-15T16:34:39Z', moon_trek_url: 'https://trek.nasa.gov/getAzElfromT1' },
    ]),
  ),
};

const MOON_TREK_SLOPE = 'slope of the best-fit plane to LOLA heights within 500 m (NASA Moon Trek)';
/** The synthetic engine's slope_source (backend on main): the label the live main path shows. */
const SYNTHETIC_SLOPE = 'synthetic engine: terrain is not modelled, 0 is a placeholder, not a measured slope';

/** What the backend's Moon Trek slope change (PR #23) sends: slope_source on each result, and the longer landing-slope sentence. */
/** The same, written to sit inside parentheses, as the backend's landing-slope sentence has it. */
const MOON_TREK_SLOPE_INLINE = 'slope of the best-fit plane to LOLA heights within 500 m, NASA Moon Trek';
/** The landing-slope sentence for Starship HLS, which publishes no slope limit (main's wording, b5c219b). */
const SLOPE_UNCHECKED = `Regional slope 6.58 deg (${MOON_TREK_SLOPE_INLINE}); no published slope limit for Starship HLS, so no pass or fail.`;
/** The longest sentence: a lander with a limit, so the slope is checked, and the screening note after it. */
const SLOPE_CHECKED = `Regional slope 6.58 deg (${MOON_TREK_SLOPE_INLINE}); Griffin accepts up to 10 deg. Regional terrain screening over a circle 1 km across, not a touchdown safety assessment.`;

/**
 * The live backend's answers given the fields of PR #23 (merged into main): every site gets a Moon
 * Trek slope and its source. `checked`: the slope passes a lander's limit, with the longest sentence.
 */
async function answersLikePR23(page: Page, checked = false): Promise<void> {
  await page.route('**/evaluate', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    for (const r of body.results ?? []) {
      r.slope_deg = 6.58;
      r.slope_source = MOON_TREK_SLOPE;
      for (const q of r.requirements ?? []) {
        if (q.requirement !== 'landing slope') continue;
        q.detail = checked ? SLOPE_CHECKED : SLOPE_UNCHECKED;
        if (checked) q.passed = true;
      }
      if (checked && r.verdict) {
        r.verdict.unknown_requirements = (r.verdict.unknown_requirements ?? []).filter((n: string) => n !== 'landing slope');
        if (r.verdict.result === 'unknown' && r.verdict.unknown_requirements.length === 0) r.verdict.result = 'pass';
      }
    }
    await route.fulfill({ response: res, json: body });
  });
}

type Rect = { left: number; top: number; right: number; bottom: number };
async function rect(page: Page, testId: string): Promise<Rect> {
  return page.getByTestId(testId).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
}

/** True when every part of the element's text lies inside the box (half a pixel of slack). */
async function inside(page: Page, testId: string, box: Rect): Promise<boolean> {
  return page.getByTestId(testId).first().evaluate((e, b) => {
    const rects = [...e.getClientRects()];
    const range = document.createRange();
    range.selectNodeContents(e);
    rects.push(...range.getClientRects());
    return rects.every((r) => r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5);
  }, box);
}

/** The Data checks band at 1440 x 900: all of it in view, above the console, and nothing in it scrolled away. */
async function checksAllVisible(page: Page): Promise<void> {
  const panel = await rect(page, 'site-checks-panel');
  const consoleBox = await rect(page, 'site-console');
  expect(panel.top).toBeGreaterThanOrEqual(0);
  expect(panel.bottom).toBeLessThanOrEqual(consoleBox.top);
  const body = page.getByTestId('site-checks-body');
  expect(await body.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(0);
  expect(await body.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'the main path is checked at a desktop width; the phone layouts have their own tests');
  // The stored Horizons check is a static file served with the website; this branch does not carry
  // it (it comes with the backend's feat/horizons-live), so the test serves the file's shape.
  await page.route('**/data/horizons-check.json', (route) => route.fulfill({ json: HORIZONS_CHECK }));
  // The Moon Trek check comes with the backend's feat/moon-trek-slope (not merged): the test serves its layout.
  await page.route('**/data/moon-trek-sun-check.json', (route) => route.fulfill({ json: MOON_TREK_CHECK }));
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
  // The answer's own words, in the answer's order: passing sites first, then unknown, then failing (never re-sorted by score).
  const answered = await page.getByTestId('verdict').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.answerResult ?? ''));
  expect(answered.length).toBeGreaterThan(0);
  for (const r of answered) expect(['pass', 'unknown', 'fail']).toContain(r);
  for (let i = 1; i < answered.length; i++) expect(RESULT_ORDER[answered[i]]).toBeGreaterThanOrEqual(RESULT_ORDER[answered[i - 1]]);
  // Starship HLS publishes no slope limit: where the slope is the only requirement left unchecked,
  // the verdict shows as PASS with the reason beside it, in the backend's place in the order.
  const verdict = page.getByTestId('spotlight-verdict');
  if ((await verdict.getAttribute('data-result')) === 'pass') {
    await expect(verdict).toHaveText(/^pass$/i);
    await expect(page.getByTestId('slope-note')).toHaveText('Slope not checked: no published slope limit for this lander');
  }
  const first = page.getByTestId('verdict').first();
  if ((await first.getAttribute('data-answer-result')) === 'unknown' && (await first.getAttribute('data-result')) === 'pass') {
    await expect(first).toHaveAttribute('title', 'pass. Slope not checked: no published slope limit for this lander');
  }
  // The slope, when the answer has it: the figure, then what it is (its slope_source, or the requirement's name).
  await expect(page.getByTestId('spotlight-slope')).toHaveText(live ? `0.0° ${SYNTHETIC_SLOPE}` : /^\d+\.\d° example model: an invented slope, not a measured one$/);

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

  // The Site stage's Data checks: the stored checks first (JPL Horizons, then NASA Moon Trek), then
  // the slope and terrain notes; all of it in view at 1440 x 900, with nothing scrolled away.
  const checks = page.getByTestId('site-checks-panel');
  await expect(checks.getByTestId('horizons-check')).toContainText('Checked against NASA JPL Horizons');
  await expect(checks.getByTestId('horizons-check')).toContainText('0.005991°');
  await expect(checks.getByTestId('moon-trek-check')).toHaveText('Checked against NASA Moon Trek: Sun within 0.006048°');
  await expect(checks.getByTestId('horizons-check')).toBeInViewport({ ratio: 1 });
  await expect(checks.getByTestId('moon-trek-check')).toBeInViewport({ ratio: 1 });
  await checksAllVisible(page);
  const order = await checks.locator('[data-testid]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
  expect(order.indexOf('horizons-check')).toBeLessThan(order.indexOf('moon-trek-check'));
  expect(order.indexOf('moon-trek-check')).toBeLessThan(order.indexOf('site-slope'));
  if (live) {
    await expect(checks.getByTestId('site-terrain-note')).toHaveText('smooth Moon, terrain not included');
    expect(order.indexOf('site-slope')).toBeLessThan(order.indexOf('site-terrain-note'));
    // The synthetic engine reports the slope as 0, and its slope_source says what that 0 is.
    await expect(checks.getByTestId('site-slope')).toHaveText(`0.0° ${SYNTHETIC_SLOPE}`);
    await expect(checks.getByTestId('horizons-compare')).toBeInViewport({ ratio: 1 });
    // The answer's warnings, on request.
    await expect(checks.getByTestId('horizon-warnings')).toBeHidden();
    await checks.getByTestId('horizon-warnings-toggle').click();
    await expect(checks.getByTestId('horizon-warnings').locator('li').first()).toBeVisible();
    await checks.getByTestId('horizon-warnings-toggle').click();
    // Compare now: this backend cannot reach JPL Horizons from here, so the stored figure stands, and it says so.
    await checks.getByTestId('horizons-compare').click();
    await expect(checks.getByTestId('horizons-compare-failed')).toContainText('Showing the stored figure above instead.', { timeout: 20_000 });
  } else {
    await expect(checks.getByTestId('horizons-compare')).toHaveCount(0);
  }

  expect(errors).toEqual([]);
});

test('the planner: the reactor is one choice, its two rows linked, and both rows still go to the backend', async ({ page }) => {
  test.setTimeout(120_000);
  const live = isLive();
  const evaluateBodies: { hardware: { id: string; count: number }[] }[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/evaluate')) evaluateBodies.push(r.postDataJSON());
  });
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('ranked-row').first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('edit-mission').click();
  const planner = page.getByTestId('planner');
  const payload = planner.locator('[data-testid="hardware-row"][data-id="fsp_40kwe"]');
  const power = planner.locator('[data-testid="hardware-row"][data-id="fission_40kwe"]');
  await expect(payload).toBeVisible({ timeout: 30_000 });
  // The Payload heading says what its rows count for; both reactor rows say they are linked.
  await expect(planner.getByTestId('payload-heading-note')).toHaveText('Mass for the fit check only. Power is set under Power sources and Loads.');
  for (const row of [payload, power]) await expect(row.getByTestId('linked-note')).toHaveText('Linked: its mass counts under Payload and its 40 kW under Power sources.');
  const box = (row: typeof payload) => row.locator('input[type="checkbox"]');
  await expect(box(payload)).not.toBeChecked();
  await expect(box(power)).not.toBeChecked();
  // Ticking the payload row ticks the power row; counting either counts both.
  await box(payload).check();
  await expect(box(power)).toBeChecked();
  await payload.getByRole('button', { name: /^More / }).click();
  await expect(payload.getByTestId('hardware-count')).toHaveText('2');
  await expect(power.getByTestId('hardware-count')).toHaveText('2');
  await power.getByRole('button', { name: /^Fewer / }).click();
  await expect(payload.getByTestId('hardware-count')).toHaveText('1');
  await expect(power.getByTestId('hardware-count')).toHaveText('1');
  if (live) {
    // The request is unchanged in shape: both catalog rows, each with the same count.
    await expect
      .poll(() => evaluateBodies.at(-1)?.hardware.filter((h) => h.id === 'fsp_40kwe' || h.id === 'fission_40kwe'), { timeout: 30_000 })
      .toEqual([
        { id: 'fission_40kwe', count: 1 },
        { id: 'fsp_40kwe', count: 1 },
      ]);
  }
  // Unticking either row clears both.
  await box(power).uncheck();
  await expect(box(payload)).not.toBeChecked();
  await expect(box(power)).not.toBeChecked();
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
  const checks = page.getByTestId('site-checks-panel');
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

test('live mode, with the backend’s Moon Trek slopes (PR #23): the long label and sentence wrap, and nothing overflows', async ({ page }) => {
  test.skip(!isLive(), 'live mode only: the answers are the backend’s, given PR #23’s fields');
  test.setTimeout(120_000);
  await answersLikePR23(page);
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('ranked-row').first()).toBeVisible({ timeout: 60_000 });
  // The spotlight: the slope with slope_source as its label, wrapping inside the panel.
  const slope = page.getByTestId('spotlight-slope');
  await expect(slope).toHaveText(`6.6° ${MOON_TREK_SLOPE}`);
  await expect(slope).toHaveAttribute('title', /so no pass or fail\.$/);
  const spot = await rect(page, 'spotlight');
  expect(await inside(page, 'spotlight-slope', spot)).toBe(true);
  expect(await slope.evaluate((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().height > 20)).toBe(true);
  // Every line of text in the spotlight lies inside it. (Its scroll width says nothing here: the corner brackets are drawn 4 px outside every panel.)
  expect(await inside(page, 'spotlight', spot)).toBe(true);
  // The Site stage: the same, in the Data checks band, all of it in view.
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 60_000 });
  const checks = page.getByTestId('site-checks-panel');
  await expect(checks.getByTestId('site-slope')).toHaveText(`6.6° ${MOON_TREK_SLOPE}`);
  await expect(checks.getByTestId('site-slope-note')).toHaveText('Slope not checked: no published slope limit for this lander');
  await expect(checks.getByTestId('site-slope-note')).toHaveAttribute('title', SLOPE_UNCHECKED);
  const band = await rect(page, 'site-checks-panel');
  for (const id of ['horizons-check', 'moon-trek-check', 'site-slope', 'site-slope-note', 'site-terrain-note']) expect(await inside(page, id, band), id).toBe(true);
  await checksAllVisible(page);
});

test('live mode, PR #23, a checked slope: the longest sentence, with the screening note, wraps inside the Data checks band', async ({ page }) => {
  test.skip(!isLive(), 'live mode only: the answers are the backend’s, given PR #23’s fields');
  test.setTimeout(120_000);
  await answersLikePR23(page, true);
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('ranked-row').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('spotlight-slope')).toHaveAttribute('title', SLOPE_CHECKED);
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 60_000 });
  const checks = page.getByTestId('site-checks-panel');
  // With the slope checked there is no "not checked" note: the backend's sentence stands in its place, whole.
  await expect(checks.getByTestId('site-slope-note')).toHaveCount(0);
  const detail = checks.getByTestId('site-slope-detail');
  await expect(detail).toHaveText(SLOPE_CHECKED);
  expect(await detail.evaluate((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().height > 30)).toBe(true);
  const band = await rect(page, 'site-checks-panel');
  for (const id of ['horizons-check', 'moon-trek-check', 'site-slope', 'site-slope-detail']) expect(await inside(page, id, band), id).toBe(true);
  await checksAllVisible(page);
});

test('a short window (1280 x 720): the Data checks band is shown on request, so the picture keeps its height', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('ranked-row').first()).toBeVisible({ timeout: 60_000 });
  // A site where the Sun stands low in the east at the landing: its tag needs the picture's full height.
  await page.getByTestId('drawer-toggle').click();
  await page.getByTestId('preset-search').fill('Apollo 14');
  await page.getByTestId('preset').first().click();
  await expect(page.getByTestId('spotlight-name')).toHaveText('Apollo 14');
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 60_000 });
  const show = page.getByTestId('site-checks-show');
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('site-checks-panel')).toHaveCount(0);
  await expect(page.getByTestId('body-label-sun')).toHaveAttribute('data-visible', 'true', { timeout: 30_000 });
  // On request: the band, the stored check first, above the console.
  await show.click();
  await expect(show).toHaveAttribute('aria-expanded', 'true');
  const checks = page.getByTestId('site-checks-panel');
  await expect(checks.getByTestId('horizons-check')).toBeInViewport({ ratio: 1 });
  const order = await checks.locator('[data-testid]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
  expect(order.indexOf('horizons-check')).toBeLessThan(order.indexOf('site-slope'));
  expect((await rect(page, 'site-checks-panel')).bottom).toBeLessThanOrEqual((await rect(page, 'site-console')).top);
  // Put away again: the focus goes back to the button that showed it.
  await checks.getByTestId('site-checks-hide').click();
  await expect(page.getByTestId('site-checks-panel')).toHaveCount(0);
  await expect(show).toBeFocused();
  await expect(show).toHaveAttribute('aria-expanded', 'false');
});

test('a short window (1280 x 720) with Data checks open: a label from the 3D scene never shows through the panel', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('ranked-row').first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId('lander-reticle')).toHaveAttribute('data-visible', 'true', { timeout: 60_000 });
  await page.getByTestId('site-checks-show').click();
  const band = page.getByTestId('site-checks-panel');
  await expect(band.getByTestId('horizons-check')).toBeVisible();
  /** The labels the scene draws over its canvas (the hardware markers' names): text inside the scene's own layer. */
  const sceneLabels = () =>
    page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="world"] *')].filter((e) => e.childElementCount === 0 && (e.textContent ?? '').trim() !== '').length);
  await expect.poll(sceneLabels, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  // The scene's labels let the pointer through, so the hit test would skip them whatever is on top.
  // For this check only, they take the pointer: the hit test then follows the order things are drawn in.
  await page.addStyleTag({ content: '[data-testid="world"] * { pointer-events: auto !important; }' });
  const seen = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="site-checks-panel"]')!;
    const p = panel.getBoundingClientRect();
    const labels = [...document.querySelectorAll<HTMLElement>('[data-testid="world"] *')].filter((e) => e.childElementCount === 0 && (e.textContent ?? '').trim() !== '');
    // Every line of the panel's text, as boxes.
    const lines: DOMRect[] = [];
    const walk = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!(n.textContent ?? '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      lines.push(...range.getClientRects());
    }
    const cut = (a: DOMRect | { left: number; top: number; right: number; bottom: number }, b: typeof a) => {
      const box = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
      return box.right - box.left > 1 && box.bottom - box.top > 1 ? box : null;
    };
    let underPanel = 0;
    const throughText: string[] = [];
    for (const label of labels) {
      const l = label.getBoundingClientRect();
      if (!cut(l, p)) continue;
      underPanel++;
      // Wherever the label and a line of the panel's text meet, the panel is what is drawn on top.
      for (const line of lines) {
        const both = cut(l, line);
        if (!both) continue;
        for (const fx of [0.2, 0.5, 0.8]) {
          const x = both.left + (both.right - both.left) * fx;
          const y = (both.top + both.bottom) / 2;
          const top = document.elementFromPoint(x, y);
          if (!top?.closest('[data-testid="site-checks-panel"]')) throughText.push(`${(label.textContent ?? '').trim()} at ${Math.round(x)}, ${Math.round(y)}`);
        }
      }
    }
    return { underPanel, throughText };
  });
  // The case this guards happens here: the habitat's marker lands under the open panel.
  expect(seen.underPanel).toBeGreaterThan(0);
  expect(seen.throughText).toEqual([]);
});

test('live mode: with no Moon Trek file there is no Moon Trek line', async ({ page }) => {
  test.skip(!isLive(), 'checked once, in live mode');
  test.setTimeout(120_000);
  await page.unroute('**/data/moon-trek-sun-check.json');
  await page.route('**/data/moon-trek-sun-check.json', (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('ranked-row').first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId('site-checks-panel').getByTestId('horizons-check')).toBeVisible();
  await expect(page.getByTestId('moon-trek-check')).toHaveCount(0);
});

test('a score range and its "/ 100" stay inside the spotlight at every tested size', async ({ page }) => {
  test.skip(!isLive(), 'live mode, where the answer can be given the widest range, 85–100');
  test.setTimeout(150_000);
  await page.route('**/evaluate', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    for (const r of body.results ?? []) Object.assign(r, { score: null, score_min: 85, score_max: 100 });
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  const score = page.getByTestId('spotlight').locator('[data-q="score"]');
  await expect(score.locator('[data-q-text]')).toHaveText('85–100', { timeout: 60_000 });
  await expect(score.locator('[data-q-unit]')).toHaveText('/ 100');
  for (const [width, height] of [
    [1280, 720],
    [1440, 760],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(async () => {
        const spot = await rect(page, 'spotlight');
        return score.evaluate((e, b) => [...e.querySelectorAll('[data-q-text], [data-q-unit]')].every((x) => x.getBoundingClientRect().right <= b.right + 0.5), spot);
      }, { message: `${width} x ${height}` })
      .toBe(true);
  }
});
