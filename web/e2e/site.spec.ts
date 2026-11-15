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
}

/** "Zoom in to this site", and wait for the stage and its data. */
async function zoomIn(page: Page) {
  await page.getByTestId(isPhone(page) ? 'zoom-to-site-phone' : 'zoom-to-site').click();
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
  const name = (await page.getByTestId('spotlight-name').textContent())!;
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
  // What is an illustration is said to be one.
  await expect(page.getByTestId('site-illustration-ground')).toHaveText('The ground is an illustration.');

  // The hardware of the example mission, with each model's height (the rover has no model).
  await expect(page.getByTestId('hardware-row')).toHaveCount(4);
  await expect.poll(() => readout(page, 'hw_height:starship')).toBe('52');
  expect(await readout(page, 'hw_height:rover')).toBe('no model');
  expect(await readout(page, 'hw_count:solar')).toBe('× 4');

  // The reticle is on the landing point, clear of every panel.
  const reticle = page.getByTestId('lander-reticle');
  await expect(reticle).toHaveAttribute('data-visible', 'true');
  await expect(reticle).toContainText('Landing point');
  await expect
    .poll(async () => {
      const mark = await reticle.locator('svg').boundingBox();
      const tag = await reticle.locator('[data-marker-tag]').boundingBox();
      if (!mark || !tag) return ['no reticle'];
      const boxes = [mark, tag].map((b) => ({ left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height }));
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

  // Scrubbing into the delay: the stage says it is before the landing, and how long until it.
  await scrub.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(hud).toHaveAttribute('data-phase', 'before-landing');
  const before = page.getByTestId('before-landing');
  await expect(before).toBeVisible();
  await expect(before).toContainText('before landing');
  await expect(before.locator('[data-q="to_landing"]')).toHaveText('1 h');
  expect(await readout(page, 'since_landing')).toBe('−0 d 01 h');
  // No lander stands there yet.
  expect(await readout(page, 'shadow_lander')).toBe('not landed');
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
});

test('site: back to mission select returns to the same spotlight, time after time, and Orbit opens from the site', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout has its own test');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enterMission(page);
  const name = (await page.getByTestId('spotlight-name').textContent())!;
  for (let round = 0; round < 2; round++) {
    // A double press starts one flight, not two.
    await page.getByTestId('zoom-to-site').dblclick();
    await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'site', { timeout: 15_000 });
    await expect(page.getByTestId('scene-title')).toHaveText(name);
    await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 30_000 });
    // Time is left running: going back stops it, and the next visit starts paused at the landing.
    await page.getByTestId('site-scrub').fill('48');
    await page.getByTestId('site-play').click();
    await page.getByTestId('back-to-mission').click();
    await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission');
    await expect(page.getByTestId('spotlight-name')).toHaveText(name);
    await expect(page.getByTestId('zoom-to-site')).toBeEnabled({ timeout: 15_000 });
  }
  await zoomIn(page);
  await expect(page.getByTestId('site-play')).toHaveAttribute('aria-pressed', 'false');
  expect(await hours(page)).toBe(0);
  // Orbit, straight from the site.
  await page.getByTestId('stage-orbit').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'orbit');
  await expect(page.getByTestId('orbit-hud')).toBeVisible();
  await expect.poll(() => readout(page, 'utc')).toMatch(/^\d{4}-\d{2}-\d{2} /);
  expect(errors).toEqual([]);
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
  await expect.poll(() => readout(page, 'hw_height:starship')).toBe('52');
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

  // Both discs are stated to be at true apparent size, and the ground to be an illustration.
  await expect(page.getByTestId('true-size')).toContainText('true apparent size');
  await expect(page.getByTestId('true-size').locator('[data-q="sun_width"]')).toHaveText('0.53°');
  await expect(page.getByTestId('site-illustration-ground')).toBeVisible();

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
  await expect(page.getByTestId('zoom-to-site-phone')).toBeEnabled({ timeout: 15_000 });
  await zoomIn(page);
  await expect(page.getByTestId('scene-title')).toHaveText(title);
  await expect(page.getByTestId('site-play')).toHaveAttribute('aria-pressed', 'false');
  expect(await hours(page)).toBe(0);
  expect(errors).toEqual([]);
});
