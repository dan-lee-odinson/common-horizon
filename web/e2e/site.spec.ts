import { expect, test, type Page } from '@playwright/test';

// Stage 3, SITE, on example data (mock mode): the way down from mission select, time through the
// stay, the instrument around the scene, and the way back. Every check polls the page's own state;
// none waits a fixed time for something to have happened.

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 768;
}

/** Text of one readout, found by its quantity name. */
async function readout(page: Page, key: string): Promise<string> {
  return (await page.locator(`[data-q="${key}"] [data-q-text]`).first().textContent()) ?? '';
}

async function enterMission(page: Page, path = '/') {
  await page.goto(path);
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('mission-hud')).toBeVisible();
  if (!isPhone(page)) await expect(page.getByTestId('spotlight-name')).not.toHaveText('', { timeout: 30_000 });
}

/** Spotlight a preset site by name, through the site drawer. */
async function spotlight(page: Page, name: string) {
  await page.getByTestId('drawer-toggle').click();
  await page.getByTestId('preset-search').fill(name);
  await page.getByTestId('preset').first().click();
  await expect(page.getByTestId('spotlight-name')).toHaveText(name);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('site-drawer')).toHaveAttribute('data-open', 'false');
}

/** "Zoom in to this site", and wait for the stage and its data. */
async function zoomIn(page: Page) {
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'site', { timeout: 15_000 });
  await expect(page.getByTestId('site-hud')).toBeVisible();
  // The horizon answer for this site: the scrubber is live once it is in.
  await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 30_000 });
}

/** The scrubber's value: hours since the landing. */
function hours(page: Page): Promise<number> {
  return page.getByTestId('site-scrub').evaluate((el) => Number((el as HTMLInputElement).value));
}

/** "+7 d 01 h" as hours: 169. */
function sinceLandingHours(text: string): number {
  const m = /^([+−])(\d+) d (\d+) h$/.exec(text);
  if (!m) return Number.NaN;
  return (m[1] === '−' ? -1 : 1) * (Number(m[2]) * 24 + Number(m[3]));
}

/** Resolves after the page has drawn two more frames: everything a frame writes has been written. */
function twoFrames(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/** Everything that says "lit" or "dark" on the stage, and the timeline period under the needle. */
function litEverywhere(page: Page) {
  return page.evaluate(() => {
    const q = (sel: string) => document.querySelector<HTMLElement>(sel);
    const timeline = q('[data-testid="stay-timeline"]')!;
    const f = Number(timeline.dataset.f);
    // The period the needle stands in, read off the bar itself.
    const under = Array.from(timeline.querySelectorAll<HTMLElement>('.stay-period')).filter((p) => f >= Number(p.dataset.from) && f <= Number(p.dataset.to));
    return {
      readout: q('[data-q="sun_state"] [data-q-text]')!.textContent,
      timeline: timeline.dataset.state,
      dot: q('[data-testid="horizon-sun"]')?.dataset.state ?? null,
      hud: q('[data-testid="site-hud"]')!.dataset.lit,
      periods: under.map((p) => (p.dataset.lit === 'true' ? 'lit' : 'dark')),
    };
  });
}

interface Box {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The glass panels of the stage that are on screen, as boxes. */
function panels(page: Page): Promise<Box[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="site-hud"] [data-panel]'))
      .filter((el) => el.offsetWidth > 0 && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.testid ?? el.getAttribute('aria-label') ?? '', left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }),
  );
}

function overlap(a: Omit<Box, 'id'>, b: Omit<Box, 'id'>): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Where the spotlight site's marker is on screen in mission select, once the camera has come to
 * rest: the same place at five looks in a row, two seconds in all (the camera's turn to a new site
 * and the picture's slide when a panel closes are both shorter than that).
 */
async function restingSiteMarker(page: Page): Promise<{ x: number; y: number }> {
  const read = () =>
    page.evaluate(() => {
      const m = document.querySelector<HTMLElement>('[data-testid="mission-hud"] [data-marker="site"]');
      return m && m.dataset.visible === 'true' ? `${m.dataset.ax},${m.dataset.ay}` : '';
    });
  let last = '';
  let same = 0;
  await expect
    .poll(
      async () => {
        const now = await read();
        same = now !== '' && now === last ? same + 1 : 0;
        last = now;
        return same;
      },
      { timeout: 30_000, intervals: [400] },
    )
    .toBeGreaterThanOrEqual(4);
  const [x, y] = last.split(',').map(Number);
  return { x, y };
}

/** What the 3D scene says of the Sun and Earth: drawn "above" or "below" the skyline band, or "none". */
async function sceneSays(page: Page): Promise<{ sun: string | null; earth: string | null }> {
  const world = page.getByTestId('world');
  return { sun: await world.getAttribute('data-site-sun'), earth: await world.getAttribute('data-site-earth') };
}

/** The same, read off the horizon plot's own markers against its own skyline. */
async function plotSays(page: Page): Promise<{ sun: string; earth: string }> {
  const word = (v: string | null) => (v === null ? 'none' : v === 'true' ? 'above' : 'below');
  return { sun: word(await page.getByTestId('horizon-sun').getAttribute('data-above')), earth: word(await page.getByTestId('horizon-earth').getAttribute('data-above')) };
}

/** Smallest text size drawn inside an element, in pixels (HTML and SVG text alike). */
function smallestText(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).evaluate((root) => {
    let smallest = Infinity;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim()) continue;
      if (parent.closest('.sr-only')) continue;
      const style = getComputedStyle(parent);
      if (style.visibility === 'hidden' || parent.getClientRects().length === 0) continue;
      smallest = Math.min(smallest, parseFloat(style.fontSize));
    }
    return smallest;
  });
}

test('site: zoom in from mission select; the title, the clocks, the sky readouts and the true-size statement are there', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin !== 'http://localhost:4173') foreign.push(r.url());
  });
  await enterMission(page);
  // A site with the Sun up, low in the east, at the landing (the best site's Sun has not yet risen).
  await spotlight(page, 'Apollo 14');
  const name = 'Apollo 14';
  // One 3D space throughout: the same single canvas before the dive and at the site.
  await expect(page.locator('canvas')).toHaveCount(1);
  await zoomIn(page);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('scene-title')).toHaveText(name);
  await expect(page.getByTestId('site-rank')).toContainText('Rank');

  // The stage arrives paused at the landing, with both clocks and the sky readouts filled.
  await expect(page.getByTestId('site-play')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => readout(page, 'utc')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  expect(await readout(page, 'ltc')).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{6}$/);
  expect(await readout(page, 'since_landing')).toBe('+0 d 00 h');
  expect(await hours(page)).toBe(0);
  await expect.poll(() => readout(page, 'sun_el')).toMatch(/^[+−]?\d+\.\d$/);
  expect(await readout(page, 'sun_az')).toMatch(/^\d+\.\d$/);
  expect(['lit', 'dark']).toContain(await readout(page, 'sun_state'));
  expect(await readout(page, 'earth_az')).toMatch(/^\d+\.\d$/);

  // Both discs are stated to be at true apparent size, with the two widths as readouts.
  const trueSize = page.getByTestId('true-size');
  await expect(trueSize).toContainText('true apparent size');
  await expect(trueSize).toContainText('mean distances');
  expect(await readout(page, 'sun_width')).toBe('0.53');
  expect(await readout(page, 'earth_width')).toMatch(/^1\.9[01]$/);
  await expect(trueSize.locator('[data-q="sun_width"]')).toHaveText('0.53°');
  await expect(trueSize.locator('[data-q="earth_width"]')).toHaveText(/^1\.9[01]°$/);
  // The ground is the real ground from the height files, and the words say where it comes from;
  // the rings on the ground say what they measure.
  await expect(page.getByTestId('world')).toHaveAttribute('data-site-ground', 'terrain');
  await expect(page.getByTestId('site-ground-source')).toContainText('Ground: NASA LOLA via Moon Trek (');
  await expect(page.getByTestId('site-ground-source')).toContainText('true scale. No cast shadows.');
  await expect(page.getByTestId('site-illustration-ground')).toHaveCount(0);
  const rings = page.getByTestId('site-rings');
  await expect(rings.locator('[data-q="ground_ring_minor"]')).toHaveText(/^10\s?m$/);
  await expect(rings.locator('[data-q="ground_ring_major"]')).toHaveText(/^100\s?m$/);

  // The hardware of the example mission, with each model's height (the crewed habitat's power load has no model).
  await expect(page.getByTestId('hardware-row')).toHaveCount(4);
  await expect.poll(() => readout(page, 'hw_height:starship_hls')).toBe('52');
  expect(await readout(page, 'hw_height:hab_crewed')).toBe('no model');
  expect(await readout(page, 'hw_count:vsat')).toBe('× 4');
  // It is drawn at true scale, and its place is said to be an illustration. Every shape has loaded:
  // no row says its item is missing from the picture.
  await expect(page.getByTestId('site-illustration')).toContainText('true scale');
  await expect(page.getByTestId('site-illustration')).toContainText('Where each piece stands is an illustration');
  await expect(page.getByTestId('hardware-shape')).toHaveCount(0);

  // The reticle is on the lander and names it once the camera has come to rest; it is clear of every panel.
  const reticle = page.getByTestId('lander-reticle');
  await expect(reticle).toHaveAttribute('data-visible', 'true');
  await expect(reticle).toHaveAttribute('data-follows', 'lander');
  await expect(reticle.locator('[data-marker-tag]')).toHaveText('Starship HLS');
  // The Sun is up at this landing: its tag is in the picture too, with the readout's own elevation.
  const sunTag = page.getByTestId('body-label-sun');
  await expect(sunTag).toHaveAttribute('data-visible', 'true');
  await expect.poll(async () => sunTag.locator('[data-q="sun_el"] [data-q-text]').textContent()).toBe(await readout(page, 'sun_el'));
  await expect
    .poll(async () => {
      const marks = [reticle.locator('svg'), reticle.locator('[data-marker-tag]'), sunTag.locator('[data-marker-tag]')];
      const found = await Promise.all(marks.map((m) => m.boundingBox()));
      if (found.some((b) => b === null)) return ['a marker is missing'];
      const boxes = found.map((b) => ({ left: b!.x, top: b!.y, right: b!.x + b!.width, bottom: b!.y + b!.height }));
      return (await panels(page)).filter((p) => boxes.some((b) => overlap(b, p))).map((p) => p.id);
    })
    .toEqual([]);

  // Nothing on the stage is set smaller than 12 px.
  expect(await smallestText(page, 'site-hud')).toBeGreaterThanOrEqual(12);
  // The Mission Assistant is one press away, as in Orbit.
  await expect(page.getByTestId('assistant-open')).toBeVisible();

  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

test('site: Play runs the clock and moves the Sun dot, Pause stops it, the speed changes the rate, and it stops at the end of the stay', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  await enterMission(page);
  await zoomIn(page);
  const play = page.getByTestId('site-play');
  const dot = page.getByTestId('horizon-sun');
  await expect(dot).toHaveAttribute('data-state', /lit|dark/);
  const dotAtLanding = await dot.evaluate((el) => (el as HTMLElement).style.transform);
  const azAtLanding = await readout(page, 'sun_az');

  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect(play).toHaveText('Pause');
  await expect.poll(() => hours(page)).toBeGreaterThan(6);
  expect(await readout(page, 'since_landing')).not.toBe('+0 d 00 h');
  expect(await dot.evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(dotAtLanding);
  expect(await readout(page, 'sun_az')).not.toBe(azAtLanding);

  // The rate follows the speed: simulated hours for each second of real time, measured in the page
  // from the landing each time, so the end of the stay is never in the way.
  const rateAt = async (speed: string) => {
    await page.getByTestId('site-restart').click();
    await page.getByTestId(`speed-${speed}`).click();
    await expect(page.getByTestId(`speed-${speed}`)).toHaveAttribute('aria-checked', 'true');
    await play.click();
    await expect(play).toHaveAttribute('aria-pressed', 'true');
    const rate = await page.evaluate(
      () =>
        new Promise<number>((done) => {
          const input = document.querySelector<HTMLInputElement>('[data-testid="site-scrub"]')!;
          const t0 = performance.now();
          const v0 = Number(input.value);
          const look = () => {
            const v = Number(input.value);
            // Long enough to see the clock move on at either speed.
            if (v - v0 >= 6 || performance.now() - t0 > 3000) done(((v - v0) / (performance.now() - t0)) * 1000);
            else requestAnimationFrame(look);
          };
          requestAnimationFrame(look);
        }),
    );
    await play.click();
    await expect(play).toHaveAttribute('aria-pressed', 'false');
    return rate;
  };
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  const slow = await rateAt('0.5');
  const fast = await rateAt('6');
  expect(slow).toBeGreaterThan(0);
  // Twelve times faster by the labels (0.5 and 6 days a second); the frame rate of the test browser varies.
  expect(fast / slow).toBeGreaterThan(4);
  // The arrow keys move through the speeds, choosing as they go.
  await page.getByTestId('speed-6').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('speed-2')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('speed-2')).toBeFocused();
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');

  // Pause: the clock and the readouts hold.
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect(play).toHaveText('Play');
  await twoFrames(page);
  const held = [await hours(page), await readout(page, 'utc')];
  await twoFrames(page);
  expect([await hours(page), await readout(page, 'utc')]).toEqual(held);

  // The clock stops at the end of the stay, and Play then starts again from the landing.
  await page.getByTestId('site-scrub').fill('330');
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
  expect(await hours(page)).toBe(336);
  expect(await readout(page, 'since_landing')).toBe('+14 d 00 h');
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => hours(page)).toBeLessThan(336);
  await page.getByTestId('site-restart').click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => hours(page)).toBe(0);
  expect(await readout(page, 'since_landing')).toBe('+0 d 00 h');
});

test('site: the scrubber takes the keyboard and the pointer, and the readouts, the plot and the timeline agree', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  await enterMission(page);
  // Apollo 11: the Sun sets about eleven days into the stay, so the timeline has both states.
  await spotlight(page, 'Apollo 11');
  await zoomIn(page);
  const scrub = page.getByTestId('site-scrub');
  await expect(scrub).toHaveAttribute('aria-label', 'Time in the stay');
  expect(await scrub.evaluate((el) => [(el as HTMLInputElement).min, (el as HTMLInputElement).max, (el as HTMLInputElement).step])).toEqual(['0', '336', '0.25']);

  // A typed value (what assistive technology does): three days in.
  await scrub.fill('72');
  await expect.poll(() => readout(page, 'since_landing')).toBe('+3 d 00 h');
  expect(await readout(page, 'utc')).toBe('2027-02-18 15:00:00');
  // The Sun dot carries the readouts' own figures.
  const dot = page.getByTestId('horizon-sun');
  await expect.poll(async () => dot.getAttribute('data-az')).toBe(await readout(page, 'sun_az'));
  expect(await dot.getAttribute('data-el')).toBe(await readout(page, 'sun_el'));
  await expect(scrub).toHaveAttribute('aria-valuetext', /^\+3 d 00 h from the landing, 2027-02-18 15:00:00 UTC, (lit|dark)$/);

  // Arrows step an hour (six with Shift), PageUp and PageDown a day, Home and End go to the ends.
  await scrub.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => hours(page)).toBe(73);
  expect(await readout(page, 'since_landing')).toBe('+3 d 01 h');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => hours(page)).toBe(71);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => hours(page)).toBe(77);
  await page.keyboard.press('PageUp');
  await expect.poll(() => hours(page)).toBe(101);
  expect(await readout(page, 'since_landing')).toBe('+4 d 05 h');
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageDown');
  await expect.poll(() => hours(page)).toBe(53);
  await page.keyboard.press('Home');
  await expect.poll(() => hours(page)).toBe(0);
  expect(await readout(page, 'since_landing')).toBe('+0 d 00 h');
  await page.keyboard.press('PageDown');
  expect(await hours(page)).toBe(0);
  await page.keyboard.press('End');
  await expect.poll(() => hours(page)).toBe(336);
  expect(await readout(page, 'since_landing')).toBe('+14 d 00 h');
  await page.keyboard.press('ArrowRight');
  expect(await hours(page)).toBe(336);
  // Space plays and pauses from the scrubber.
  await page.keyboard.press('Home');
  await page.keyboard.press(' ');
  await expect(page.getByTestId('site-play')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(' ');
  await expect(page.getByTestId('site-play')).toHaveAttribute('aria-pressed', 'false');

  // At stops across the stay, everything that says lit or dark says the same, and it is what the
  // timeline shows under the needle.
  const seen = new Set<string>();
  for (const at of [0, 40, 100, 200, 250, 270, 300, 336]) {
    await scrub.fill(String(at));
    await expect.poll(() => hours(page)).toBe(at);
    await twoFrames(page);
    const state = await litEverywhere(page);
    expect(['lit', 'dark']).toContain(state.readout);
    expect(state.timeline).toBe(state.readout);
    expect(state.dot).toBe(state.readout);
    expect(state.hud).toBe(state.readout === 'lit' ? 'true' : 'false');
    expect(state.periods).toContain(state.readout);
    seen.add(state.readout!);
  }
  expect([...seen].sort()).toEqual(['dark', 'lit']);
  // In darkness nothing casts a shadow, and the next change is a sunrise or none in view.
  await scrub.fill('300');
  await expect.poll(() => readout(page, 'sun_state')).toBe('dark');
  expect(await readout(page, 'shadow_per_metre')).toBe('none');
  await scrub.fill('100');
  await expect.poll(() => readout(page, 'sun_state')).toBe('lit');
  expect(await readout(page, 'shadow_per_metre')).toMatch(/^\d/);
  await expect(page.locator('[data-q="next_change"] [data-q-label]').first()).toHaveText(/^Sunset in/);

  // "Jump to the next sunset": from the landing straight to just after the Sun goes behind the terrain.
  await scrub.fill('0');
  await expect.poll(() => hours(page)).toBe(0);
  const jump = page.getByTestId('site-jump');
  await expect(jump).toHaveAttribute('aria-label', 'Jump to the next sunset');
  await jump.click();
  await expect.poll(() => readout(page, 'sun_state')).toBe('dark');
  const landed = await hours(page);
  expect(landed).toBeGreaterThan(255);
  expect(landed).toBeLessThan(275);
  await expect(page.getByTestId('site-play')).toHaveAttribute('aria-pressed', 'false');
  // No sunrise is left before the end of this stay: the control says so and is switched off.
  await expect(jump).toBeDisabled();
  await expect(jump).toHaveAttribute('aria-label', 'No sunrise or sunset ahead in the stay');

  // The pointer: a press anywhere on the lane moves the clock there, a drag carries it along, and
  // the keyboard carries on from where the pointer left it.
  const lane = (await page.getByTestId('stay-lane').boundingBox())!;
  const y = lane.y + lane.height / 2;
  await page.mouse.click(lane.x + lane.width * 0.25, y);
  await expect.poll(async () => Math.abs((await hours(page)) - 84)).toBeLessThanOrEqual(1);
  await expect(scrub).toBeFocused();
  await page.mouse.move(lane.x + lane.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(lane.x + lane.width * 0.5, y, { steps: 5 });
  // While the pointer is down the clock follows it (the readout says where it is).
  // (Half way along is seven days in.)
  await expect.poll(async () => Math.abs(sinceLandingHours(await readout(page, 'since_landing')) - 168)).toBeLessThanOrEqual(1);
  await page.mouse.move(lane.x + lane.width * 0.75, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await hours(page)) - 252)).toBeLessThanOrEqual(1);
  const afterDrag = await hours(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => hours(page)).toBe(afterDrag + 1);
  // A drag past the end stops at the end.
  await page.mouse.move(lane.x + lane.width * 0.9, y);
  await page.mouse.down();
  await page.mouse.move(lane.x + lane.width + 80, y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => hours(page)).toBe(336);
});

test('site: with a launch delay the timeline shows the planned landing, the delay and the stay, and before the landing the stage says so', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  await enterMission(page);
  await page.getByTestId('slip').fill('14');
  await expect(page.getByTestId('slip-value')).toContainText('+14');
  // The ranking for the delayed landing is in (the spotlight is no longer marked as updating).
  await expect(page.getByTestId('spotlight')).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 });
  const name = (await page.getByTestId('spotlight-name').textContent())!;
  await zoomIn(page);
  await expect(page.getByTestId('scene-title')).toHaveText(name);

  // The lane runs from the planned landing: 14 days of delay, then 14 days of stay.
  const scrub = page.getByTestId('site-scrub');
  expect(await scrub.evaluate((el) => [(el as HTMLInputElement).min, (el as HTMLInputElement).max])).toEqual(['-336', '336']);
  await expect(page.getByTestId('ghost-marker')).toBeVisible();
  const label = page.getByTestId('stay-lead-label');
  await expect(label).toContainText('Planned landing');
  await expect(label.locator('[data-q="delay"]')).toHaveText('delay +14 days');
  const lane = (await page.getByTestId('stay-lane').boundingBox())!;
  const lead = (await page.getByTestId('stay-lead').boundingBox())!;
  const bracket = (await page.getByTestId('stay-bracket').boundingBox())!;
  const ghost = (await page.getByTestId('ghost-marker').boundingBox())!;
  // The hatched lead-in is the first half; the stay bracket is the second; the ghost marker is at the start.
  expect(Math.abs(lead.x - lane.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(lead.width - lane.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(bracket.x - (lane.x + lane.width / 2))).toBeLessThanOrEqual(2);
  expect(Math.abs(bracket.x + bracket.width - (lane.x + lane.width))).toBeLessThanOrEqual(2);
  expect(Math.abs(ghost.x - lane.x)).toBeLessThanOrEqual(2);

  // The stage arrives paused at the landing: the needle is where the stay begins.
  const hud = page.getByTestId('site-hud');
  expect(await hours(page)).toBe(0);
  expect(await readout(page, 'since_landing')).toBe('+0 d 00 h');
  await expect(hud).toHaveAttribute('data-phase', 'stay');
  await expect(page.getByTestId('before-landing')).toBeHidden();
  const needle = (await page.getByTestId('stay-needle').boundingBox())!;
  expect(Math.abs(needle.x + needle.width / 2 - (lane.x + lane.width / 2))).toBeLessThanOrEqual(2);
  // At the landing the hardware stands at the site, and the reticle names the lander.
  const world = page.getByTestId('world');
  const reticleName = page.getByTestId('lander-reticle').locator('[data-marker-tag]');
  await expect(world).toHaveAttribute('data-site-hardware', 'shown');
  await expect(reticleName).toHaveText('Starship HLS');

  // Scrubbing into the delay: the stage says it is before the landing, and how long until it.
  await scrub.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(hud).toHaveAttribute('data-phase', 'before-landing');
  const before = page.getByTestId('before-landing');
  await expect(before).toBeVisible();
  await expect(before).toContainText('before landing');
  await expect(before.locator('[data-q="to_landing"]')).toHaveText('1 h');
  expect(await readout(page, 'since_landing')).toBe('−0 d 01 h');
  // No lander stands there yet: the scene shows the site without hardware, and the reticle marks the bare landing point.
  expect(await readout(page, 'shadow_lander')).toBe('not landed');
  await expect(world).toHaveAttribute('data-site-hardware', 'hidden');
  await expect(reticleName).toHaveText('Landing point');
  await page.keyboard.press('Home');
  await expect.poll(() => hours(page)).toBe(-336);
  expect(await readout(page, 'since_landing')).toBe('−14 d 00 h');
  await expect(before.locator('[data-q="to_landing"]')).toHaveText('14 d');
  // The sky is still read from the data there: the Sun has a direction and the site is lit or dark.
  expect(await readout(page, 'sun_az')).toMatch(/^\d+\.\d$/);
  expect(['lit', 'dark']).toContain(await readout(page, 'sun_state'));
  const state = await litEverywhere(page);
  expect(state.timeline).toBe(state.readout);
  expect(state.periods).toContain(state.readout);

  // A press on the lane's first tenth is also before the landing.
  await page.keyboard.press('End');
  await expect(hud).toHaveAttribute('data-phase', 'stay');
  await page.mouse.click(lane.x + lane.width * 0.1, lane.y + lane.height / 2);
  await expect.poll(() => hours(page)).toBeLessThan(-200);
  await expect(hud).toHaveAttribute('data-phase', 'before-landing');

  // Play runs the stay: pressed before the landing, it starts from the landing.
  const play = page.getByTestId('site-play');
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => hours(page)).toBeGreaterThanOrEqual(0);
  await expect(hud).toHaveAttribute('data-phase', 'stay');
  await play.click();
  // "Back to the landing" returns to the landing, not to the planned landing.
  await scrub.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => hours(page)).toBe(-336);
  await page.getByTestId('site-restart').click();
  await expect.poll(() => hours(page)).toBe(0);
  await expect(hud).toHaveAttribute('data-phase', 'stay');
  await expect(world).toHaveAttribute('data-site-hardware', 'shown');
  await expect(reticleName).toHaveText('Starship HLS');
});

test('site: down and back twice, to two different sites: one canvas throughout, and the camera returns to where it was', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  // Three flights down and two back, each watched to its end: longer than one ordinary test.
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('begin').click();
  // One 3D space: the same single canvas in every stage.
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('mission-hud')).toBeVisible();
  await expect(page.getByTestId('spotlight-name')).not.toHaveText('', { timeout: 30_000 });
  const first = (await page.getByTestId('spotlight-name').textContent())!;
  const firstAt = await restingSiteMarker(page);
  await expect(page.locator('canvas')).toHaveCount(1);

  /** Down to the spotlight site, leave time running, and back. */
  const downAndBack = async (name: string) => {
    // A double press starts one flight, not two.
    await page.getByTestId('zoom-to-site').dblclick();
    await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'site', { timeout: 15_000 });
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.getByTestId('scene-title')).toHaveText(name);
    await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId('lander-reticle')).toHaveAttribute('data-visible', 'true');
    // Time is left running: going back stops it, and the next visit starts paused at the landing.
    await page.getByTestId('site-scrub').fill('48');
    await page.getByTestId('site-play').click();
    await page.getByTestId('back-to-mission').click();
    await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission');
    await expect(page.getByTestId('spotlight-name')).toHaveText(name);
    await expect(page.getByTestId('zoom-to-site')).toBeEnabled({ timeout: 15_000 });
    // The reticle that rode down with the camera has let go.
    await expect(page.getByTestId('lander-reticle')).toHaveAttribute('data-visible', 'false');
    await expect(page.locator('canvas')).toHaveCount(1);
  };

  await downAndBack(first);
  // The camera is back in the Moon's world, on the same pose: the site's marker is where it was.
  const back = await restingSiteMarker(page);
  expect(Math.abs(back.x - firstAt.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(back.y - firstAt.y)).toBeLessThanOrEqual(2);

  // Another site, down and back again.
  const second = first === 'Apollo 11' ? 'Apollo 15' : 'Apollo 11';
  await spotlight(page, second);
  const secondAt = await restingSiteMarker(page);
  await downAndBack(second);
  const backAgain = await restingSiteMarker(page);
  expect(Math.abs(backAgain.x - secondAt.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(backAgain.y - secondAt.y)).toBeLessThanOrEqual(2);

  // A third visit starts paused at the landing.
  await zoomIn(page);
  await expect(page.getByTestId('site-play')).toHaveAttribute('aria-pressed', 'false');
  expect(await hours(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('site: Orbit opens straight from the site, with the camera back in the Moon’s world', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enterMission(page);
  await zoomIn(page);
  await expect(page.getByTestId('lander-reticle')).toHaveAttribute('data-visible', 'true');
  await page.getByTestId('stage-orbit').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'orbit');
  await expect(page.getByTestId('orbit-hud')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect.poll(() => readout(page, 'utc')).toMatch(/^\d{4}-\d{2}-\d{2} /);
  // The camera came back from the site's world (metres) to the Moon's: Earth stands in the Orbit
  // picture with its tag, inside the window.
  const earth = page.getByTestId('body-label-earthLimb');
  await expect(earth).toHaveAttribute('data-visible', 'true', { timeout: 15_000 });
  const view = page.viewportSize()!;
  await expect
    .poll(async () => {
      const [x, y] = [Number(await earth.getAttribute('data-ax')), Number(await earth.getAttribute('data-ay'))];
      return x > 0 && x < view.width && y > 0 && y < view.height;
    })
    .toBe(true);
  // The scene no longer speaks of the site's sky, and the reticle has let go.
  await expect(page.getByTestId('world')).not.toHaveAttribute('data-site-sun');
  await expect(page.getByTestId('lander-reticle')).toHaveAttribute('data-visible', 'false');
  // And down again from Orbit: mission select, then the site, as before.
  await page.getByTestId('stage-mission').click();
  await expect(page.getByTestId('mission-hud')).toBeVisible();
  await restingSiteMarker(page);
  expect(errors).toEqual([]);
});

test('site: the Sun and Earth stand above or below the skyline in the 3D scene exactly as on the horizon plot', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  await enterMission(page);
  // Apollo 11: the Sun sets about eleven days into the stay.
  await spotlight(page, 'Apollo 11');
  await zoomIn(page);
  // The scene carries a tag for each body (shown while the body is in the clear part of the picture).
  await expect(page.getByTestId('body-label-sun')).toHaveCount(1);
  await expect(page.getByTestId('body-label-earth')).toHaveCount(1);
  const scrub = page.getByTestId('site-scrub');
  const seen = new Set<string>();
  for (const at of [0, 120, 290, 330]) {
    await scrub.fill(String(at));
    await expect.poll(() => hours(page)).toBe(at);
    await twoFrames(page);
    const plot = await plotSays(page);
    expect(['above', 'below']).toContain(plot.sun);
    expect(['above', 'below']).toContain(plot.earth);
    await expect.poll(() => sceneSays(page)).toEqual(plot);
    // And both agree with the word on the Sun panel.
    expect(await readout(page, 'sun_state')).toBe(plot.sun === 'above' ? 'lit' : 'dark');
    seen.add(plot.sun);
  }
  expect([...seen].sort()).toEqual(['above', 'below']);

  // "Look" turns the view to a body: Earth stands high over this site, out of the picture on
  // arrival; after the press its tag is in the picture, inside the window and clear of the panels.
  await scrub.fill('0');
  await expect.poll(() => hours(page)).toBe(0);
  const view = page.viewportSize()!;
  for (const body of ['earth', 'sun'] as const) {
    await page.getByTestId(`look-${body}`).click();
    const tag = page.getByTestId(`body-label-${body}`);
    await expect(tag).toHaveAttribute('data-visible', 'true', { timeout: 15_000 });
    await expect
      .poll(async () => {
        const box = await tag.locator('[data-marker-tag]').boundingBox();
        if (!box) return ['no tag'];
        const b = { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
        const out = b.left < 0 || b.top < 0 || b.right > view.width || b.bottom > view.height ? ['outside the window'] : [];
        return [...out, ...(await panels(page)).filter((p) => overlap(b, p)).map((p) => p.id)];
      })
      .toEqual([]);
    // The tag carries the readout's own elevation.
    expect(await tag.locator(`[data-q="${body}_el"] [data-q-text]`).textContent()).toBe(await readout(page, `${body}_el`));
  }
  // Looking up at the sky takes the lander out of the picture; "Reset view" brings it back.
  const reticle = page.getByTestId('lander-reticle');
  await page.getByTestId('look-earth').click();
  await expect(reticle).toHaveAttribute('data-visible', 'false', { timeout: 15_000 });
  await page.getByTestId('reset-view').click();
  await expect(reticle).toHaveAttribute('data-visible', 'true', { timeout: 15_000 });
  await expect
    .poll(async () => {
      const box = await reticle.locator('svg').boundingBox();
      if (!box) return ['no reticle'];
      const b = { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
      return (await panels(page)).filter((p) => overlap(b, p)).map((p) => p.id);
    })
    .toEqual([]);
});

test('site: "Back" pressed during the descent, and "Zoom in" again straight after, leave the stage working', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enterMission(page);
  const name = (await page.getByTestId('spotlight-name').textContent())!;
  const before = await restingSiteMarker(page);
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'site', { timeout: 15_000 });
  // At once: the camera is still on its way down to the lander.
  await page.getByTestId('back-to-mission').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission');
  await expect(page.getByTestId('spotlight-name')).toHaveText(name);
  await expect(page.getByTestId('zoom-to-site')).toBeEnabled({ timeout: 15_000 });
  const after = await restingSiteMarker(page);
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  // Down again, straight away: the stage arrives whole.
  await zoomIn(page);
  await expect(page.getByTestId('scene-title')).toHaveText(name);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('lander-reticle').locator('[data-marker-tag]')).toHaveText('Starship HLS');
  await expect.poll(async () => (await sceneSays(page)).sun).toMatch(/above|below/);
  expect(errors).toEqual([]);
});

test('site: a resize during the dive does not hold it up', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  await enterMission(page);
  const name = (await page.getByTestId('spotlight-name').textContent())!;
  await restingSiteMarker(page);
  // Press, and time the flight in the page: from the press to the change of stage.
  const flight = page.evaluate(
    () =>
      new Promise<number>((done) => {
        const app = document.querySelector<HTMLElement>('[data-testid="app"]')!;
        const t0 = performance.now();
        new MutationObserver(() => {
          if (app.dataset.stage === 'site') done(performance.now() - t0);
        }).observe(app, { attributes: true, attributeFilter: ['data-stage'] });
        document.querySelector<HTMLButtonElement>('[data-testid="zoom-to-site"]')!.click();
      }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  // The dive takes a second and a half. Had the resize stopped it, the stage would only change when
  // the flight's time limit (four and a half seconds) ran out.
  expect(await flight).toBeLessThan(4000);
  await expect(page.getByTestId('scene-title')).toHaveText(name);
  await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByTestId('lander-reticle')).toHaveAttribute('data-visible', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // And the way back still works at the new size.
  await page.getByTestId('back-to-mission').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission');
  await expect(page.getByTestId('zoom-to-site')).toBeEnabled({ timeout: 15_000 });
});

for (const [width, height] of [
  [1280, 720],
  [1440, 760],
  [1920, 1080],
] as const) {
  test(`site: everything fits at ${width} x ${height}, with no panel over another`, async ({ page }) => {
    test.skip(isPhone(page), 'the phone layout has its own test');
    await page.setViewportSize({ width, height });
    await enterMission(page);
    await zoomIn(page);
    await expect(page.getByTestId('site-console')).toBeVisible();
    await expect(page.getByTestId('horizon-panel')).toBeVisible();
    // The pointer rests in the middle, so the panels sit square.
    await page.mouse.move(width / 2, height / 2);
    await expect
      .poll(async () => {
        const boxes = await panels(page);
        const clashes: string[] = [];
        for (let i = 0; i < boxes.length; i++) {
          if (boxes[i].left < -1 || boxes[i].top < 55 || boxes[i].right > width + 1 || boxes[i].bottom > height + 1) clashes.push(`${boxes[i].id} leaves the window`);
          for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) clashes.push(`${boxes[i].id} over ${boxes[j].id}`);
        }
        return clashes;
      })
      .toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await smallestText(page, 'site-hud')).toBeGreaterThanOrEqual(12);
  });
}

test('site: under reduced motion there is no flight, nothing plays by itself, and Play works on a press', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterMission(page);
  const name = (await page.getByTestId('spotlight-name').textContent())!;
  // A cut: the stage changes in the same step as the press, with no flight in between.
  const stageAfterPress = await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-testid="zoom-to-site"]')!.click();
    return new Promise<string>((done) => requestAnimationFrame(() => done(document.querySelector<HTMLElement>('[data-testid="app"]')!.dataset.stage!)));
  });
  expect(stageAfterPress).toBe('site');
  await expect(page.getByTestId('scene-title')).toHaveText(name);
  await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 30_000 });
  // Nothing auto-plays.
  const play = page.getByTestId('site-play');
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  const utc = await readout(page, 'utc');
  await twoFrames(page);
  await twoFrames(page);
  expect(await hours(page)).toBe(0);
  expect(await readout(page, 'utc')).toBe(utc);
  // Play still works when asked for.
  await play.click();
  await expect.poll(() => hours(page)).toBeGreaterThan(2);
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  // And back is a cut too.
  const stageAfterBack = await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-testid="back-to-mission"]')!.click();
    return new Promise<string>((done) => requestAnimationFrame(() => done(document.querySelector<HTMLElement>('[data-testid="app"]')!.dataset.stage!)));
  });
  expect(stageAfterBack).toBe('mission');
  await expect(page.getByTestId('spotlight-name')).toHaveText(name);
  await expect(page.getByTestId('zoom-to-site')).toBeEnabled();
});

test('site: without WebGL the instrument still works over the flat fallback', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  await enterMission(page, '/?webgl=off');
  const name = (await page.getByTestId('spotlight-name').textContent())!;
  await zoomIn(page);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByTestId('site-scene-fallback')).toBeVisible();
  await expect(page.getByTestId('scene-title')).toHaveText(name);
  // The horizon plot takes the scene's place; the clocks, the readouts and the timeline all run.
  await expect(page.getByTestId('site-flat').getByTestId('horizon-panel')).toBeVisible();
  await expect(page.getByTestId('horizon-sun')).toHaveAttribute('data-state', /lit|dark/);
  await page.getByTestId('site-scrub').fill('72');
  await expect.poll(() => readout(page, 'since_landing')).toBe('+3 d 00 h');
  expect(await page.getByTestId('horizon-sun').getAttribute('data-az')).toBe(await readout(page, 'sun_az'));
  const play = page.getByTestId('site-play');
  await play.click();
  await expect.poll(() => hours(page)).toBeGreaterThan(76);
  await play.click();
  // Nothing is drawn at a size here, so the line about true size is left out; the widths stay as readouts.
  await expect(page.getByTestId('true-size')).toHaveCount(0);
  expect(await readout(page, 'sun_width')).toBe('0.53');
  expect(await readout(page, 'earth_width')).toMatch(/^1\.9[01]$/);
  await expect.poll(() => readout(page, 'hw_height:starship_hls')).toBe('52');
  // No panel covers another, the fallback sentence included.
  const sentence = (await page.getByTestId('site-scene-fallback').boundingBox())!;
  const boxes = await panels(page);
  for (const p of boxes) expect(overlap({ left: sentence.x, top: sentence.y, right: sentence.x + sentence.width, bottom: sentence.y + sentence.height }, p), p.id).toBe(false);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `${boxes[i].id} over ${boxes[j].id}`).toBe(false);
  await page.getByTestId('back-to-mission').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission');
  await expect(page.getByTestId('spotlight-name')).toHaveText(name);
});

test('comparison: each saved site has the compact horizon plot over its lit and dark periods, with nothing under 12 px', async ({ page }) => {
  test.skip(isPhone(page), 'the comparison is opened from the site drawer, which the phone test does not cover');
  await enterMission(page);
  await page.getByTestId('save-site').click();
  await page.getByTestId('slip').fill('7');
  await expect(page.getByTestId('spotlight')).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 });
  await page.getByTestId('drawer-toggle').click();
  await page.getByTestId('compare-open').click();
  const sheet = page.getByTestId('compare-panel');
  await expect(sheet).toHaveAttribute('data-open', 'true');
  const column = page.getByTestId('compare-column').first();
  await expect(column.getByTestId('horizon-compact')).toBeVisible({ timeout: 30_000 });
  await expect(column.getByTestId('stay-compact')).toBeVisible();
  // The plot's Sun dot is placed, and the timeline carries the planned-landing marker for the delay.
  await expect(column.getByTestId('horizon-sun')).toHaveAttribute('data-state', /lit|dark/);
  await expect(column.getByTestId('ghost-marker')).toBeVisible();
  // Read-only: there is no scrubber in the comparison.
  await expect(column.getByTestId('site-scrub')).toHaveCount(0);
  expect(await smallestText(page, 'compare-panel')).toBeGreaterThanOrEqual(12);
});

test('site on a phone: zoom in, play, the sheet, and back, with nothing scrolling sideways', async ({ page }) => {
  test.skip(!isPhone(page), 'the wide layout has its own tests');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enterMission(page);
  await zoomIn(page);
  await expect(page.getByTestId('site-hud')).toHaveAttribute('data-layout', 'phone');
  const title = (await page.getByTestId('scene-title').textContent())!;
  expect(title.length).toBeGreaterThan(2);
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);

  // Every control is a full touch target, inside the window.
  const controls = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="site-hud"] button, [data-testid="site-hud"] input'))
      .filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.testid ?? el.getAttribute('aria-label') ?? el.textContent ?? '', width: Math.round(r.width), height: Math.round(r.height), left: r.left, right: r.right };
      }),
  );
  expect(controls.length).toBeGreaterThanOrEqual(7);
  for (const c of controls) {
    expect(c.width, c.id).toBeGreaterThanOrEqual(44);
    expect(c.height, c.id).toBeGreaterThanOrEqual(44);
    expect(c.left, c.id).toBeGreaterThanOrEqual(0);
    expect(c.right, c.id).toBeLessThanOrEqual(390);
  }

  // Both discs are stated to be at true apparent size, and the ground's source is given.
  await expect(page.getByTestId('true-size')).toContainText('true apparent size');
  await expect(page.getByTestId('true-size').locator('[data-q="sun_width"]')).toHaveText('0.53°');
  await expect(page.getByTestId('site-ground-pointer')).toHaveText('Ground: LOLA heights, true scale.');

  // Play runs the clock; Pause holds it.
  const play = page.getByTestId('site-play');
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await play.click();
  await expect.poll(() => hours(page)).toBeGreaterThan(3);
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');

  // The sheet rises above the dock, holds the plot and the readouts, and time can still be scrubbed.
  const toggle = page.getByTestId('site-horizon-toggle');
  await toggle.click();
  const sheet = page.getByTestId('site-sheet');
  await expect(sheet).toHaveAttribute('data-open', 'true');
  await expect(sheet.getByTestId('horizon-panel')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => readout(page, 'utc')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  await expect
    .poll(async () => {
      const s = (await sheet.boundingBox())!;
      const d = (await page.getByTestId('site-dock').boundingBox())!;
      return Math.round(s.y + s.height - d.y);
    })
    .toBeLessThanOrEqual(1);
  // The sheet says where the ground comes from.
  await expect(sheet.getByTestId('site-ground-source')).toContainText('Ground: NASA LOLA via Moon Trek (');
  await page.getByTestId('site-scrub').fill('120');
  await expect.poll(() => readout(page, 'since_landing')).toBe('+5 d 00 h');
  expect(await page.getByTestId('horizon-sun').getAttribute('data-az')).toBe(await readout(page, 'sun_az'));
  expect(await smallestText(page, 'site-hud')).toBeGreaterThanOrEqual(12);
  expect(await fits()).toBe(true);
  await toggle.click();
  await expect(sheet).toHaveAttribute('data-open', 'false');

  // Back to mission select, and down again to the same site.
  await page.getByTestId('back-to-mission').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission');
  await expect(page.getByTestId('zoom-to-site')).toBeEnabled({ timeout: 15_000 });
  await zoomIn(page);
  await expect(page.getByTestId('scene-title')).toHaveText(title);
  await expect(page.getByTestId('site-play')).toHaveAttribute('aria-pressed', 'false');
  expect(await hours(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('site: with the Data checks band measured after arrival (reduced motion), a low Sun stays in the picture above it', async ({ page }) => {
  test.skip(isPhone(page), 'the band is a desktop layout');
  // With reduced motion the camera is placed at once, before the band below it has been measured:
  // it then settles to the lower pitch the smaller picture needs, so the Sun, four degrees up, stays in view.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterMission(page);
  await spotlight(page, 'Apollo 14');
  await zoomIn(page);
  const band = page.getByTestId('site-checks-panel');
  await expect(band).toBeVisible();
  const sunTag = page.getByTestId('body-label-sun');
  await expect(sunTag).toHaveAttribute('data-visible', 'true', { timeout: 30_000 });
  // The picture is framed above the band: the reticle and both tags are clear of it.
  const reticle = page.getByTestId('lander-reticle');
  await expect(reticle).toHaveAttribute('data-visible', 'true');
  const b = (await band.boundingBox())!;
  for (const mark of [reticle.locator('svg'), reticle.locator('[data-marker-tag]'), sunTag.locator('[data-marker-tag]')]) {
    const m = (await mark.boundingBox())!;
    expect(m.y + m.height).toBeLessThanOrEqual(b.y);
  }
});

// ---------- the ground ----------

test('site ground: the real ground at Shackleton ridge, from the 5 m model', async ({ page }) => {
  await enterMission(page);
  test.skip(isPhone(page), 'the phone layout has its own test');
  await spotlight(page, 'Shackleton Connecting Ridge');
  await zoomIn(page);
  await expect(page.getByTestId('world')).toHaveAttribute('data-site-ground', 'terrain');
  await expect(page.getByTestId('site-ground-source')).toContainText('(5 m near, 100 m far)');
  await expect(page.getByTestId('site-illustration-ground')).toHaveCount(0);
});

test('site ground: at Apollo 17 the near ground comes from the global model, and the model sizes say so', async ({ page }) => {
  await enterMission(page);
  test.skip(isPhone(page), 'the phone layout has its own test');
  await spotlight(page, 'Apollo 17');
  await zoomIn(page);
  await expect(page.getByTestId('world')).toHaveAttribute('data-site-ground', 'terrain');
  await expect(page.getByTestId('site-ground-source')).toContainText('(237 m near, 237 m far)');
});

test('site ground: when the near file cannot be loaded, the level ground and its caption stay', async ({ page }) => {
  await page.route('**/site-terrain/*.near.f32', (route) => route.abort());
  await enterMission(page);
  test.skip(isPhone(page), 'the phone layout has its own test');
  await zoomIn(page);
  await expect(page.getByTestId('site-illustration-ground')).toHaveText('The ground is an illustration.');
  await expect(page.getByTestId('world')).toHaveAttribute('data-site-ground', 'level');
  await expect(page.getByTestId('ground-panel')).toHaveCount(0);
});

test('site ground: a custom point keeps the level ground and its caption', async ({ page }) => {
  await enterMission(page);
  test.skip(isPhone(page), 'the phone layout has its own test');
  await page.getByTestId('drawer-toggle').click();
  await page.getByTestId('mode-custom').click();
  await page.getByTestId('lat-input').fill('-88.5');
  await page.getByTestId('lon-input').fill('45');
  await page.getByTestId('go-coordinate').click();
  await expect(page.getByTestId('spotlight-name')).toContainText('Custom point');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('spotlight-rank')).toHaveText(/^\d\d$/, { timeout: 20_000 });
  await zoomIn(page);
  await expect(page.getByTestId('site-illustration-ground')).toHaveText('The ground is an illustration.');
  await expect(page.getByTestId('world')).toHaveAttribute('data-site-ground', 'level');
});


test('site ground: at Apollo 17 the far terrain is drawn, and the screen says the sunlight numbers use a smooth horizon, with 14.0 degrees', async ({ page }) => {
  await enterMission(page);
  test.skip(isPhone(page), 'the phone layout has its own test');
  await spotlight(page, 'Apollo 17');
  await zoomIn(page);
  await expect(page.getByTestId('world')).toHaveAttribute('data-site-ground', 'terrain');
  await expect(page.getByTestId('site-ground-source')).toHaveText(
    'Ground: NASA LOLA via Moon Trek (237 m near, 237 m far), true scale. No cast shadows.',
  );
  const line = page.getByTestId('site-ground-smooth-horizon');
  await expect(line).toHaveText('Sunlight numbers here use a smooth horizon. The drawn terrain rises to 14.0 degrees and is not in them.');
  await expect(line.locator('[data-q="terrain_rise_deg"]')).toHaveText('14.0');
});

test('site ground: at Shackleton ridge the sunlight numbers use the terrain skyline, so there is no smooth-horizon line', async ({ page }) => {
  await enterMission(page);
  test.skip(isPhone(page), 'the phone layout has its own test');
  await spotlight(page, 'Shackleton Connecting Ridge');
  await zoomIn(page);
  await expect(page.getByTestId('world')).toHaveAttribute('data-site-ground', 'terrain');
  await expect(page.getByTestId('site-ground-source')).toContainText('(5 m near, 100 m far)');
  await expect(page.getByTestId('site-ground-smooth-horizon')).toHaveCount(0);
});

test('site ground: when only the far file cannot be loaded, the near ground stays, eased back to level ground', async ({ page }) => {
  await page.route('**/site-terrain/*.far.f32', (route) => route.abort());
  await enterMission(page);
  test.skip(isPhone(page), 'the phone layout has its own test');
  await spotlight(page, 'Apollo 17');
  await zoomIn(page);
  await expect(page.getByTestId('world')).toHaveAttribute('data-site-ground', 'terrain-near');
  await expect(page.getByTestId('site-ground-source')).toContainText('true scale to 640 m, then level (an illustration)');
  await expect(page.getByTestId('site-ground-smooth-horizon')).toHaveCount(0);
});

for (const name of ['Apollo 17', 'Shackleton Connecting Ridge']) {
  test(`site: on arrival at ${name} the skyline is in the clear part of the picture, with sky above it`, async ({ page }) => {
    await enterMission(page);
    test.skip(isPhone(page), 'the phone layout has its own test');
    await spotlight(page, name);
    await zoomIn(page);
    const world = page.getByTestId('world');
    // The real ground, near and far, is in: the view has settled to it.
    await expect(world).toHaveAttribute('data-site-ground', 'terrain');
    // The data's skyline line and the drawn terrain's top, toward the way the camera faces, both
    // project inside the clear part of the window, at least 24 px below its top.
    await expect(world).toHaveAttribute('data-site-skyline', 'in-view');
  });
}

// ---------- the surface picture ----------

for (const [name, words] of [
  ['Apollo 15', 'Surface: LRO camera mosaic (NASA/GSFC/Arizona State University).'],
  ['Shackleton Connecting Ridge', 'Surface: relief drawn from LOLA heights.'],
] as const) {
  test(`site surface: at ${name} the ground carries its surface picture, and the Ground panel says what it is`, async ({ page }) => {
    await enterMission(page);
    test.skip(isPhone(page), 'the phone layout has its own test');
    await spotlight(page, name);
    await zoomIn(page);
    const world = page.getByTestId('world');
    await expect(world).toHaveAttribute('data-site-ground', 'terrain');
    await expect(world).toHaveAttribute('data-site-surface', 'picture');
    await expect(page.getByTestId('site-ground-surface')).toHaveText(words);
  });
}

test('site surface: when the picture cannot be loaded, the ground stays plain grey and nothing is said of a picture', async ({ page }) => {
  await page.route('**/site-texture/*.jpg', (route) => route.abort());
  await enterMission(page);
  test.skip(isPhone(page), 'the phone layout has its own test');
  await spotlight(page, 'Apollo 15');
  await zoomIn(page);
  const world = page.getByTestId('world');
  await expect(world).toHaveAttribute('data-site-ground', 'terrain');
  // It was asked for, and fell back.
  await expect(world).toHaveAttribute('data-site-surface', 'plain');
  await expect(page.getByTestId('site-ground-source')).toBeVisible();
  await expect(page.getByTestId('site-ground-surface')).toHaveCount(0);
});
