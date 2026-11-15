import { expect, test, type Page } from '@playwright/test';

// The path through the three stages, on example data (mock mode), at a desktop and a phone width:
// landing card and Begin -> Orbit (the readouts run) -> mission select.

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 768;
}

/** Text of one readout, found by its quantity name. */
async function readout(page: Page, key: string): Promise<string> {
  return (await page.locator(`[data-q="${key}"] [data-q-text]`).first().textContent()) ?? '';
}

test('landing card: says what the app is, traps focus, and Begin, Escape and About work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  const card = page.getByTestId('landing-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Common Horizon' })).toBeVisible();
  await expect(card).toContainText('Where to land on the Moon, and when.');
  await expect(card).toContainText('Common Horizon ranks lunar landing sites for a mission you define.');
  await expect(card).toContainText('Set your mission: lander, hardware, launch date and length of stay.');
  await expect(card).toContainText('Zoom in to a site and watch the Sun cross its horizon.');
  await expect(card).toContainText('Not endorsed by NASA.');
  await expect(card).toContainText('Numbers marked “Example data” are placeholders.');
  // Text only: the card carries no picture and no logo.
  await expect(card.locator('img, svg')).toHaveCount(0);

  // Focus starts on Begin and Tab stays inside the card.
  const begin = page.getByTestId('begin');
  await expect(begin).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(begin).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(begin).toBeFocused();

  // Begin closes it; the Orbit HUD arrives.
  await begin.click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('orbit-hud')).toBeVisible();
  await expect(page.getByTestId('enter-mission')).toBeVisible();

  // About opens it again; Escape closes it and focus returns to About.
  await page.getByTestId('about').click();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('about')).toBeFocused();

  // A press outside closes it too.
  await page.getByTestId('about').click();
  await expect(card).toBeVisible();
  await page.mouse.click(6, (page.viewportSize()?.height ?? 900) - 6);
  await expect(card).toHaveCount(0);

  // It does not come back by itself during the same visit.
  await page.reload();
  await expect(page.getByTestId('orbit-hud')).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('orbit: the readouts run from real data, the preview pauses, and mission select opens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('begin').click();

  await expect(page.getByTestId('example-badge')).toHaveText('Example data');
  // The caption says what is drawn: the Sun at its true direction and size, Earth at true size but nearer than it is, and what is not computed.
  const caption = page.getByTestId('not-to-scale');
  await expect(caption).toContainText(
    isPhone(page)
      ? 'Sun: true direction and true apparent size. Earth: true size, drawn much nearer than it is. Drag to turn the view.'
      : 'The Sun is at its true direction and true apparent size. Earth is at true size but drawn much nearer than it is. Drag, or use the arrow keys, to turn the view.',
  );
  await expect(caption).toContainText('which face points at the Moon is not computed.');
  await expect(caption).not.toContainText('direction marker');

  // The Sun's overhead longitude is a number of degrees east, and it moves as time runs.
  await expect.poll(() => readout(page, 'subsolar_lon'), { timeout: 30_000 }).toMatch(/^\d{1,3}\.\d{2}$/);
  const lon1 = await readout(page, 'subsolar_lon');
  const utc1 = await readout(page, 'utc');
  await expect.poll(() => readout(page, 'subsolar_lon'), { timeout: 10_000 }).not.toBe(lon1);
  await expect.poll(() => readout(page, 'utc')).not.toBe(utc1);

  // Pause: the readouts hold still.
  const toggle = page.getByTestId('preview-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const held = await readout(page, 'utc');
  await page.waitForTimeout(700);
  expect(await readout(page, 'utc')).toBe(held);
  await toggle.click();
  await expect.poll(() => readout(page, 'utc')).not.toBe(held);

  if (!isPhone(page)) {
    // The south pole season, with its one-line note on tap.
    const season = page.getByTestId('season');
    await expect(season).toHaveText(/Lunar south pole: (summer|winter)/);
    await season.click();
    await expect(page.getByTestId('season-note')).toHaveText('The Moon’s south pole has seasons. In its summer, sunlit periods there run longer.');
  }

  // Earth's bracket is its real range: the swing of its overhead point over the stay, in degrees.
  if (!isPhone(page)) {
    expect(await readout(page, 'earth_swing_lon')).toMatch(/^\d{1,2}\.\d{2}$/);
    expect(Number(await readout(page, 'earth_swing_lon'))).toBeLessThan(20);
  }

  // The one clear action.
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('mission-hud')).toBeVisible();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission');
  expect(errors).toEqual([]);
});

// ---------- The Sun's tick, Earth, their tags and the sunlight stay clear of the glass panels ----------

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function overlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Does the straight line from (x1, y1) to (x2, y2) pass through a box? */
function crosses(seg: { x1: number; y1: number; x2: number; y2: number }, b: Box): boolean {
  let lo = 0;
  let hi = 1;
  for (const [p, d, min, max] of [
    [seg.x1, seg.x2 - seg.x1, b.left, b.right],
    [seg.y1, seg.y2 - seg.y1, b.top, b.bottom],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (p <= min || p >= max) return false;
      continue;
    }
    const a = (min - p) / d;
    const c = (max - p) / d;
    lo = Math.max(lo, Math.min(a, c));
    hi = Math.min(hi, Math.max(a, c));
  }
  return hi > lo;
}

test('orbit: through a whole lunar day, markers, their tags, the lines of sunlight and the edge glow never touch a glass panel, and the zoom control goes out to the whole Earth and back', async ({ page }) => {
  test.skip(isPhone(page), 'on phones the panels are two short cards above the scene; checked by the phone layout test');
  await page.goto('/');
  await page.getByTestId('begin').click();
  await expect.poll(() => readout(page, 'subsolar_lon'), { timeout: 30_000 }).toMatch(/^\d/);
  await page.getByTestId('preview-toggle').click();

  const scrub = page.getByTestId('preview-scrub');
  const max = Number(await scrub.getAttribute('max'));
  expect(max).toBeGreaterThan(700);
  let sunSeen = 0;
  let earthSeen = 0;
  let linesSeen = 0;
  let glowSeen = 0;
  for (let i = 0; i <= 12; i++) {
    await scrub.fill(String(Math.round((max * i) / 12)));
    await page.waitForTimeout(450);
    const state = await page.evaluate(() => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const panels = Array.from(document.querySelectorAll('[data-panel]')).map(box);
      const markers = Array.from(document.querySelectorAll<HTMLElement>('[data-marker]'))
        .filter((m) => m.dataset.visible === 'true')
        .map((m) => {
          const x = Number(m.dataset.ax);
          const y = Number(m.dataset.ay);
          const r = Number(m.dataset.ar);
          return { name: m.dataset.marker!, body: { left: x - r, top: y - r, right: x + r, bottom: y + r }, tag: box(m.querySelector('[data-marker-tag]')!) };
        });
      // The lines of sunlight as they are drawn (each "M x y L x y" of the paths), and the glow at the frame's edge.
      const svg = document.querySelector('[data-testid="sunlight-lines"]')!;
      const origin = svg.getBoundingClientRect();
      const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
      for (const path of Array.from(svg.querySelectorAll('path'))) {
        if (Number(getComputedStyle(path).opacity) < 0.02) continue;
        for (const m of (path.getAttribute('d') ?? '').matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)) lines.push({ x1: Number(m[1]) + origin.left, y1: Number(m[2]) + origin.top, x2: Number(m[3]) + origin.left, y2: Number(m[4]) + origin.top });
      }
      const glowNode = document.querySelector<HTMLElement>('[data-testid="sun-edge-glow"]')!;
      const glow = glowNode.dataset.visible === 'true' ? box(glowNode) : null;
      return { panels, markers, lines, glow };
    });
    expect(state.panels.length).toBeGreaterThanOrEqual(4);
    // Sunlight crosses the picture at every step, and none of it touches a panel.
    expect(state.lines.length, `no lines of sunlight at step ${i}`).toBeGreaterThan(4);
    linesSeen += state.lines.length;
    for (const line of state.lines) for (const p of state.panels) expect(crosses(line, p), `a line of sunlight crosses a panel at step ${i}`).toBe(false);
    if (state.glow) {
      glowSeen++;
      for (const p of state.panels) expect(overlap(state.glow, p), `the edge glow overlaps a panel at step ${i}`).toBe(false);
    }
    for (const m of state.markers) {
      if (m.name === 'sun') sunSeen++;
      if (m.name === 'earthLimb') earthSeen++;
      for (const p of state.panels) {
        expect(overlap(m.body, p), `${m.name} overlaps a panel at step ${i}`).toBe(false);
        expect(overlap(m.tag, p), `${m.name} tag overlaps a panel at step ${i}`).toBe(false);
      }
    }
  }
  // Earth's limb is in view the whole time; the Sun's tick on its ring is hidden only while it is behind the Moon.
  expect(earthSeen).toBe(13);
  expect(sunSeen).toBeGreaterThanOrEqual(6);
  // In the standard view the Sun itself is never in the frame, so the glow at the frame's edge shows
  // (except where the panels leave it no room).
  expect(linesSeen).toBeGreaterThan(13 * 8);
  expect(glowSeen).toBeGreaterThanOrEqual(8);

  // The caption says what is to scale, and the zoom control takes the picture out to the whole Earth and back.
  await expect(page.getByTestId('not-to-scale')).toContainText('Earth is at true size but drawn much nearer than it is.');
  const zoom = page.getByTestId('orbit-zoom');
  await expect(zoom).toHaveAttribute('aria-pressed', 'false');
  await zoom.click();
  await expect(zoom).toHaveAttribute('aria-pressed', 'true');
  await expect(zoom).toHaveText(/Back to the Moon/);
  await page.waitForTimeout(1500);
  // Zoomed out, Earth's tag still stands clear of every panel.
  const clash = await page.evaluate(() => {
    const tag = document.querySelector('[data-marker="earthLimb"] [data-marker-tag]');
    if (!tag) return 'no Earth tag';
    const t = tag.getBoundingClientRect();
    for (const p of Array.from(document.querySelectorAll('[data-panel]'))) {
      const r = p.getBoundingClientRect();
      if (t.left < r.right && r.left < t.right && t.top < r.bottom && r.top < t.bottom) return 'the Earth tag overlaps a panel';
    }
    return '';
  });
  expect(clash).toBe('');
  await zoom.click();
  await expect(zoom).toHaveAttribute('aria-pressed', 'false');
});

// ---------- Stage 2, mission select ----------

async function enterMission(page: Page) {
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('mission-hud')).toBeVisible();
  await expect(page.getByTestId('spotlight-name')).not.toHaveText('', { timeout: 30_000 });
}

async function stripNames(page: Page): Promise<string[]> {
  return page.getByTestId('row-name').allTextContents();
}

/**
 * From now on, notes how far any row of the ranked strip is ever put off its place. A reorder
 * starts its slide by placing each row where it was, in the same step that reorders the page: that
 * is what is caught here, whatever the frame rate. (Read it back with `rowsSlid`.)
 */
async function watchRows(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { slid: number };
    w.slid = 0;
    const list = document.querySelector('[data-testid="ranked-strip"]')!;
    const look = () => {
      for (const row of Array.from(list.querySelectorAll<HTMLElement>('[data-testid="ranked-row"]'))) w.slid = Math.max(w.slid, Math.abs(new DOMMatrix(getComputedStyle(row).transform).m42));
    };
    new MutationObserver(look).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  });
}

function rowsSlid(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { slid: number }).slid);
}

/** The glass panels of mission select and the drawer's handle, as boxes on screen. */
async function missionPanels(page: Page): Promise<(Box & { id: string })[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="mission-hud"] [data-panel], [data-testid="drawer-toggle"]'))
      .filter((el) => getComputedStyle(el).visibility !== 'hidden')
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.testid ?? '', left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }),
  );
}

interface SiteMarker {
  visible: boolean;
  /** The reticle, out to the tips of its ticks. */
  body: Box;
  tag: Box;
}

/** The spotlight site's marker once the camera and the tag have come to rest. */
async function restingMarker(page: Page): Promise<SiteMarker> {
  const sample = () =>
    page.evaluate(() => {
      const m = document.querySelector<HTMLElement>('[data-marker="site"]');
      if (!m) return null;
      const t = m.querySelector('[data-marker-tag]')!.getBoundingClientRect();
      const x = Number(m.dataset.ax);
      const y = Number(m.dataset.ay);
      // The anchor carries the radius of the reticle's outer ring; its ticks reach half as far again (0.5 / 0.34).
      const r = (Number(m.dataset.ar) * 0.5) / 0.34;
      return { visible: m.dataset.visible === 'true', body: { left: x - r, top: y - r, right: x + r, bottom: y + r }, tag: { left: t.left, top: t.top, right: t.right, bottom: t.bottom } };
    });
  let last = '';
  let same = 0;
  let marker: SiteMarker | null = null;
  await expect
    .poll(
      async () => {
        marker = await sample();
        const now = JSON.stringify(marker);
        same = marker?.visible && now === last ? same + 1 : 0;
        last = now;
        return same;
      },
      { timeout: 30_000, intervals: [400] },
    )
    .toBeGreaterThanOrEqual(2);
  return marker!;
}

/** Names of the panels the marker's reticle or its tag touch. Empty means clear. */
function touching(marker: SiteMarker, panels: (Box & { id: string })[]): string[] {
  return panels.flatMap((p) => [overlap(marker.body, p) ? `reticle on ${p.id}` : '', overlap(marker.tag, p) ? `tag on ${p.id}` : '']).filter(Boolean);
}

test('mission select: one site in the spotlight, a short strip, and the delay reorders the ranking', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout of mission select is covered by the phone test');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enterMission(page);

  // The spotlight is the best-ranked site: rank 01, a name, a pass or fail word and the readouts.
  await expect(page.getByTestId('spotlight-rank')).toHaveText('01');
  const best = (await page.getByTestId('spotlight-name').textContent())!;
  expect(best.length).toBeGreaterThan(2);
  await expect(page.getByTestId('spotlight-verdict')).toHaveText(/^(pass|fail: .+)$/);
  expect(await readout(page, 'sunlight_percent')).toMatch(/^\d{1,3}\.\d$/);
  expect(await readout(page, 'sunlight_hours')).toMatch(/^[\d,]+$/);
  expect(await readout(page, 'score')).toMatch(/^\d{1,3}$/);
  await expect(page.locator('[data-q="score"] [data-q-unit]')).toHaveText('/ 100');
  expect(await readout(page, 'earth_link')).toMatch(/^(in contact|intermittent|out of contact)$/);
  expect(await readout(page, 'power_margin')).toMatch(/^([+−]\d+|no supply|no load)$/);
  await expect(page.getByTestId('zoom-to-site')).toHaveText('Zoom in to this site');

  // The south pole's season on the landing date, with its note on hover, on focus and until Escape.
  const season = page.getByTestId('season');
  const note = page.getByTestId('season-note');
  await expect(season).toHaveText(/^Lunar south pole: (summer|winter)$/);
  await expect(note).toBeHidden();
  await season.hover();
  await expect(note).toBeVisible();
  await expect(note).toHaveText('The Moon’s south pole has seasons. In its summer, sunlit periods there run longer.');
  // A click while the pointer rests on it keeps the note open.
  await season.click();
  await expect(note).toBeVisible();
  await page.mouse.move(700, 620);
  await page.getByTestId('edit-mission').focus();
  await expect(note).toBeHidden();
  await season.focus();
  await expect(note).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(note).toBeHidden();
  await expect(season).toBeFocused();

  // The strip is short: a few rows, not every preset. The presets are in the drawer.
  const rows = page.getByTestId('ranked-row');
  expect(await rows.count()).toBeLessThanOrEqual(5);
  await expect(page.getByTestId('strip-range')).toHaveText(/^01 to 0\d of 17$/);
  await expect(page.getByTestId('site-drawer')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('preset').first()).toBeHidden();
  await expect(rows.first().getByTestId('row-name')).toHaveText(best);
  await expect(rows.first().getByTestId('verdict')).toHaveText(/pass|fail/);

  // Rows slide only when the ranking reorders.
  await watchRows(page);

  // Arrow keys move the spotlight down the ranking, and back.
  const before = await stripNames(page);
  await page.getByTestId('ranked-strip').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('spotlight-rank')).toHaveText('02');
  await expect(page.getByTestId('spotlight-name')).toHaveText(before[1]);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('spotlight-rank')).toHaveText('01');
  // Further down, the strip moves its window to keep the spotlight in the middle.
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('spotlight-rank')).toHaveText('04');
  await expect(page.getByTestId('strip-range')).toHaveText('02 to 06 of 17');
  // End and Home jump to the last and the first site.
  await page.keyboard.press('End');
  await expect(page.getByTestId('spotlight-rank')).toHaveText('17');
  await expect(page.getByTestId('strip-range')).toHaveText('13 to 17 of 17');
  await expect(page.locator('[data-testid="ranked-row"][aria-selected="true"] [data-testid="row-rank"]')).toHaveText('17');
  await page.keyboard.press('Home');
  await expect(page.getByTestId('spotlight-rank')).toHaveText('01');
  await expect(page.getByTestId('ranked-strip')).toBeFocused();
  // A click on a row moves the spotlight too.
  await rows.nth(2).click();
  await expect(page.getByTestId('spotlight-name')).toHaveText(before[2]);
  // "Follow the best site" lets the spotlight follow the ranking again.
  await page.getByTestId('follow-best').click();
  await expect(page.getByTestId('follow-best')).toHaveCount(0);
  await expect(page.getByTestId('spotlight-name')).toHaveText(best);
  // Moving the spotlight through the ranking never animated the rows: keys and clicks answer at once.
  expect(await rowsSlid(page)).toBe(0);

  // The delay: +7 days moves the landing a week along the lunar day, and the ranking reorders.
  const planned = (await page.getByTestId('planned-launch').textContent())!;
  const landing = (await page.getByTestId('landing').textContent())!;
  expect(planned).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
  const slip = page.getByTestId('slip');
  await slip.focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('slip-value')).toHaveText('+7days');
  await expect.poll(async () => (await stripNames(page)).join(' | '), { timeout: 15_000 }).not.toBe(before.join(' | '));
  await expect(page.getByTestId('moved').first()).toBeVisible();
  await expect(page.getByTestId('moved').first()).toContainText(/(up|down) \d+ places? since the plan/);
  await expect(page.getByTestId('spotlight-rank')).toHaveText('01');
  await expect(page.getByTestId('spotlight-name')).not.toHaveText(best);
  await expect(page.getByTestId('spotlight-moved')).toContainText(/up \d+ places? since the plan/);
  await expect(page.getByTestId('rank-announcement')).toHaveText(/^Delay 7 days: .+ is now first/);
  await expect(slip).toBeFocused();
  // The reorder itself slid the rows to their new places: they started from where they were, a row or more away.
  expect(await rowsSlid(page)).toBeGreaterThan(40);

  // The delay moves the landing, never the planned launch: not on the bar, not in the planner.
  await expect(page.getByTestId('planned-launch')).toHaveText(planned);
  await expect(page.getByTestId('landing')).not.toHaveText(landing);
  await page.getByTestId('edit-mission').click();
  await expect(page.getByTestId('launch-input')).toHaveValue('2027-02-10T15:00');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('mission select: the strip and the delay take the keyboard as the stage arrives, and keep it while the ranking updates', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout of mission select is covered by the phone test');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Slow example answers (2.5 s each): "a newer ranking is on its way" lasts long enough to look at.
  await page.goto('/?mock=slow');
  await page.getByTestId('begin').click();
  // The ranking arrives while still in Orbit, so the strip is there from the stage's first frame.
  await expect(page.getByTestId('orbit-hud')).toContainText('Earth link, stay', { timeout: 30_000 });

  // From the moment the stage is on the page until its entrance has finished, on every frame:
  // the strip and the delay scrubber accept keyboard focus.
  await page.evaluate(() => {
    const w = window as unknown as { arrival: Promise<{ frames: number; refused: string[] }> };
    w.arrival = new Promise((resolve) => {
      const refused = new Set<string>();
      let frames = 0;
      let waited = 0;
      const probe = () => {
        const strip = document.querySelector<HTMLElement>('[data-testid="ranked-strip"]');
        const slip = document.querySelector<HTMLElement>('[data-testid="slip"]');
        if (!strip || !slip) return requestAnimationFrame(probe);
        const entering = [strip, slip].some((el) => getComputedStyle(el.closest('[data-enter]')!).opacity !== '1');
        for (const el of [strip, slip]) {
          el.focus();
          if (document.activeElement !== el) refused.add(el.dataset.testid!);
          el.blur();
        }
        if (entering) frames++;
        // Done once the entrance has been seen and is over (or, if it is never seen, after a long while: the test then fails on `frames`).
        else if (frames > 0 || ++waited > 900) return resolve({ frames, refused: Array.from(refused) });
        requestAnimationFrame(probe);
      };
      new MutationObserver((_, seen) => {
        if (!document.querySelector('[data-testid="ranked-strip"]')) return;
        seen.disconnect();
        probe();
      }).observe(document.body, { childList: true, subtree: true });
    });
  });
  await page.getByTestId('enter-mission').click();
  const arrival = await page.evaluate(() => (window as unknown as { arrival: Promise<{ frames: number; refused: string[] }> }).arrival);
  expect(arrival.frames).toBeGreaterThan(0);
  expect(arrival.refused).toEqual([]);

  const spotlight = page.getByTestId('spotlight');
  const strip = page.getByTestId('ranked-strip');
  const slip = page.getByTestId('slip');
  await expect(page.getByTestId('spotlight-rank')).toHaveText('01');
  await expect(spotlight).toHaveAttribute('aria-busy', 'false');
  const best = (await page.getByTestId('spotlight-name').textContent())!;
  const before = await stripNames(page);
  const planned = (await page.getByTestId('planned-launch').textContent())!;
  const landing = (await page.getByTestId('landing').textContent())!;
  // The strip must stay the very same element throughout: mark it.
  await strip.evaluate((el) => el.setAttribute('data-kept', 'yes'));

  // A new delay. Until its ranking arrives, the previous one stays on screen, marked as updating.
  await slip.focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  const look = () =>
    page.evaluate(() => {
      const el = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      return {
        delay: el('slip-value')?.textContent,
        spotlightBusy: el('spotlight')?.getAttribute('aria-busy'),
        spotlightState: el('spotlight')?.dataset.state ?? 'site',
        stripBusy: el('rank-strip')?.getAttribute('aria-busy'),
        kept: el('ranked-strip')?.dataset.kept,
        name: el('spotlight-name')?.textContent,
        rank: el('spotlight-rank')?.textContent,
        rows: Array.from(document.querySelectorAll('[data-testid="row-name"]'), (r) => r.textContent),
        planned: el('planned-launch')?.textContent,
        landing: el('landing')?.textContent,
        focus: (document.activeElement as HTMLElement | null)?.dataset.testid,
        said: el('rank-announcement')?.textContent,
      };
    });
  await expect.poll(look).toEqual({
    delay: '+7days',
    spotlightBusy: 'true',
    spotlightState: 'site',
    stripBusy: 'true',
    kept: 'yes',
    name: best,
    rank: '01',
    rows: before,
    planned,
    landing,
    focus: 'slip',
    said: '',
  });
  // Quietly marked: the stale figures are dimmed, not hidden, and nothing spins.
  await expect.poll(() => page.getByTestId('spotlight-rank').evaluate((el) => Number(getComputedStyle(el.closest('.settling')!).opacity))).toBeLessThan(0.8);
  expect(await page.getByTestId('spotlight-rank').evaluate((el) => Number(getComputedStyle(el.closest('.settling')!).opacity))).toBeGreaterThan(0.4);

  // The strip still takes the keyboard meanwhile.
  await strip.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('spotlight-name')).toHaveText(before[1]);
  await expect(strip).toBeFocused();

  // The new ranking lands: the same strip, still holding the focus, now in the new order.
  await expect(spotlight).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
  await expect(page.getByTestId('rank-strip')).toHaveAttribute('aria-busy', 'false');
  await expect(strip).toBeFocused();
  await expect(strip).toHaveAttribute('data-kept', 'yes');
  expect(await stripNames(page)).not.toEqual(before);
  await expect(page.getByTestId('spotlight-name')).toHaveText(before[1]);
  await expect(page.getByTestId('rank-announcement')).toHaveText(/^Delay 7 days: .+ is now first/);
  await expect(page.getByTestId('planned-launch')).toHaveText(planned);
  await expect(page.getByTestId('landing')).not.toHaveText(landing);
  await expect.poll(() => page.getByTestId('spotlight-rank').evaluate((el) => Number(getComputedStyle(el.closest('.settling')!).opacity))).toBe(1);

  // A point typed in a moment ago has no row until its ranking arrives: the spotlight shows its
  // name with dashes for its figures, and the strip keeps the ranking it has.
  await page.getByTestId('drawer-toggle').click();
  await page.getByTestId('mode-custom').click();
  await page.getByTestId('lat-input').fill('-88.5');
  await page.getByTestId('lon-input').fill('45');
  const ranked = await stripNames(page);
  await page.getByTestId('go-coordinate').click();
  await expect(page.getByTestId('spotlight-pending')).toHaveText('Working out this site…');
  await expect(page.getByTestId('spotlight-name')).toContainText('Custom point');
  await expect(page.getByTestId('spotlight-rank')).toHaveText('—');
  await expect(spotlight).toHaveAttribute('aria-busy', 'true');
  expect(await stripNames(page)).toEqual(ranked);
  await expect(page.getByTestId('spotlight-rank')).toHaveText(/^\d\d$/, { timeout: 20_000 });
  await expect(page.getByTestId('strip-range')).toHaveText(/of 18$/);
  expect(errors).toEqual([]);
});

test('mission select: under reduced motion the strip reorders at once', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout of mission select is covered by the phone test');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterMission(page);
  const before = await stripNames(page);
  await watchRows(page);
  await page.getByTestId('slip').fill('7');
  await expect.poll(async () => (await stripNames(page)).join(' | '), { timeout: 15_000 }).not.toBe(before.join(' | '));
  await expect(page.getByTestId('rank-announcement')).toContainText('is now first');
  // The rows are in their new order, and none was ever put off its place.
  expect(await rowsSlid(page)).toBe(0);
});

test('mission select: the spotlight site’s marker and its tag stay clear of the glass panels', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout of mission select is covered by the phone test');
  await enterMission(page);
  const clear = async (what: string) => {
    const marker = await restingMarker(page);
    expect(touching(marker, await missionPanels(page)), what).toEqual([]);
    const view = page.viewportSize()!;
    for (const box of [marker.body, marker.tag]) {
      expect(box.left, what).toBeGreaterThanOrEqual(0);
      expect(box.top, what).toBeGreaterThanOrEqual(0);
      expect(box.right, what).toBeLessThanOrEqual(view.width);
      expect(box.bottom, what).toBeLessThanOrEqual(view.height);
    }
  };
  const drawer = page.getByTestId('site-drawer');
  const drawerIn = () => drawer.evaluate((el) => window.innerWidth - el.getBoundingClientRect().right);

  // The best site with no delay sits near the Moon's equator: the middle of the picture.
  expect((await missionPanels(page)).map((p) => p.id).sort()).toEqual(['assistant', 'drawer-toggle', 'mission-bar', 'rank-strip', 'spotlight']);
  await clear('a site near the equator');

  // Two weeks' delay puts a site at the south pole in the spotlight: low on the Moon, with a long name.
  await page.getByTestId('slip').fill('14');
  await expect(page.getByTestId('spotlight-name')).toHaveText('Shackleton Connecting Ridge', { timeout: 15_000 });
  await clear('a site at the south pole');

  // The drawer opens beside it: the tag steps to the other side.
  await page.getByTestId('drawer-toggle').click();
  await expect.poll(drawerIn).toBeGreaterThanOrEqual(19);
  expect((await missionPanels(page)).map((p) => p.id)).toContain('site-drawer');
  await clear('the south pole, drawer open');

  // A point near the north pole sits high on the Moon, where the mission bar is: the picture comes down.
  await page.getByTestId('mode-custom').click();
  await page.getByTestId('lat-input').fill('88.5');
  await page.getByTestId('lon-input').fill('45');
  await page.getByTestId('go-coordinate').click();
  await expect(page.getByTestId('spotlight-name')).toContainText('Custom point 88.50° N');
  await expect(page.getByTestId('spotlight-rank')).toHaveText(/^\d\d$/);
  await clear('a point at the north pole, drawer open');
  await page.getByTestId('site-drawer-close').click();
  await expect(drawer).toHaveAttribute('data-open', 'false');
  await clear('a point at the north pole');

  // The assistant's history rises over the lower part of the scene: the picture moves up out of its way.
  await page.getByTestId('follow-best').click();
  await expect(page.getByTestId('spotlight-name')).toHaveText('Shackleton Connecting Ridge');
  const input = page.getByTestId('chat-input');
  for (const [i, q] of ['Why does the delay matter?', 'What about power at night and batteries?', 'How does Earth contact work?'].entries()) {
    await input.fill(q);
    await input.press('Enter');
    await expect(page.getByTestId('chat-log').locator('[data-state="answer"]')).toHaveCount(i + 1);
  }
  await clear('the south pole, history open');
  await page.getByTestId('drawer-toggle').click();
  await expect.poll(drawerIn).toBeGreaterThanOrEqual(19);
  await clear('the south pole, history and drawer open');
});

for (const [width, height, rowsAtLeast] of [
  [1280, 720, 3],
  [1920, 1080, 5],
] as const) {
  test(`mission select: everything fits at ${width} x ${height}`, async ({ page }) => {
    test.skip(isPhone(page), 'the phone layout of mission select is covered by the phone test');
    await page.setViewportSize({ width, height });
    // The layout is measured at rest. With reduced motion nothing slides in, flies or drifts with
    // the pointer (the entrance is a plain fade), so every panel is in its place from the start.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterMission(page);
    // Two weeks' delay: the Earth link reads "intermittent", the longest word a readout shows.
    await page.getByTestId('slip').fill('14');
    await expect(page.getByTestId('spotlight-name')).toHaveText('Shackleton Connecting Ridge', { timeout: 15_000 });
    await expect(page.locator('[data-q="earth_link"] [data-q-text]')).toHaveText('intermittent');

    const layout = await page.evaluate(() => {
      const box = (id: string) => {
        const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      // A readout's text against its own cell, and anything that scrolls or is cut off sideways.
      const spill = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="spotlight"] .readout')).map((cell) => {
        const text = document.createRange();
        text.selectNodeContents(cell.querySelector('.readout-value')!);
        return Math.round(text.getBoundingClientRect().right - cell.getBoundingClientRect().right);
      });
      const cut = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="mission-bar"] *, [data-testid="spotlight"] *, [data-testid="rank-strip"] [data-testid="verdict"]'))
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' && !el.matches('.truncate, .line-clamp-2, .sr-only'))
        .map((el) => el.dataset.testid ?? el.className);
      return {
        spotlight: box('spotlight'),
        strip: box('rank-strip'),
        bar: box('mission-bar'),
        handle: box('drawer-toggle'),
        assistant: box('assistant'),
        rows: document.querySelectorAll('[data-testid="ranked-row"]').length,
        spill,
        cut,
        sideways: document.documentElement.scrollWidth > window.innerWidth || document.querySelector('[data-testid="app"]')!.scrollLeft !== 0,
      };
    });
    // A handful of rows, and the strip ends above the bottom of the window, level with the assistant or higher.
    expect(layout.rows).toBeGreaterThanOrEqual(rowsAtLeast);
    expect(layout.rows).toBeLessThanOrEqual(5);
    expect(layout.strip.bottom).toBeLessThanOrEqual(layout.assistant.bottom + 4);
    expect(layout.strip.top).toBeGreaterThan(layout.spotlight.bottom);
    // Nothing leaves the window, and the panels do not run into each other.
    for (const b of [layout.spotlight, layout.strip, layout.bar, layout.handle, layout.assistant]) {
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(width);
      expect(b.bottom).toBeLessThanOrEqual(height);
    }
    expect(overlap(layout.spotlight, layout.bar)).toBe(false);
    expect(overlap(layout.strip, layout.assistant)).toBe(false);
    expect(overlap(layout.bar, layout.handle)).toBe(false);
    expect(overlap(layout.bar, layout.assistant)).toBe(false);
    // No readout runs out of its cell, nothing is cut off and nothing scrolls sideways.
    for (const over of layout.spill) expect(over).toBeLessThanOrEqual(0);
    expect(layout.cut).toEqual([]);
    expect(layout.sideways).toBe(false);
    // The marker and its tag are clear of the panels at this size too.
    expect(touching(await restingMarker(page), await missionPanels(page))).toEqual([]);
  });
}

test('mission select: the drawer holds the presets and the coordinate entry', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout of mission select is covered by the phone test');
  await enterMission(page);
  const drawer = page.getByTestId('site-drawer');
  await expect(drawer).toHaveAttribute('data-open', 'false');

  // It slides in; focus moves into it; the presets are a searchable list.
  await page.getByTestId('drawer-toggle').click();
  await expect(drawer).toHaveAttribute('data-open', 'true');
  await expect(drawer).toBeFocused();
  // Tab goes into the drawer while it is still sliding in from beyond the edge: the stage itself never scrolls sideways.
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('site-drawer-close')).toBeFocused();
  expect(await page.getByTestId('app').evaluate((el) => el.scrollLeft)).toBe(0);
  await expect(page.getByTestId('preset')).toHaveCount(17);
  await page.getByTestId('preset-search').fill('apollo');
  await expect(page.getByTestId('preset')).toHaveCount(6);
  await page.getByTestId('preset-search').fill('zzz');
  await expect(page.getByTestId('preset-none')).toBeVisible();
  await page.getByTestId('preset-search').fill('athena');
  await page.getByTestId('preset').click();
  await expect(page.getByTestId('spotlight-name')).toHaveText('IM-2 Athena');

  // Custom coordinates: a bad latitude is refused in words; a good point becomes the spotlight.
  await page.getByTestId('mode-custom').click();
  await page.getByTestId('lat-input').fill('120');
  await page.getByTestId('lon-input').fill('10');
  await page.getByTestId('go-coordinate').click();
  await expect(page.getByTestId('coordinate-note')).toHaveText('Latitude must be a number between −90 and 90.');
  await page.getByTestId('lat-input').fill('-88.5');
  await page.getByTestId('lon-input').fill('45');
  await page.getByTestId('hemi-input').selectOption('W');
  await page.getByTestId('go-coordinate').click();
  await expect(page.getByTestId('spotlight-name')).toContainText('Custom point');
  await expect(page.getByTestId('custom-site')).toContainText('88.500° S, 315.000° E');
  await expect(page.getByTestId('strip-range')).toHaveText(/of 18$/);

  // Save it and compare: the comparison opens as a sheet and Escape closes it.
  await page.getByTestId('save-site').click();
  await page.getByTestId('compare-open').click();
  await expect(page.getByTestId('compare-panel')).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('compare-column')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('compare-panel')).toHaveAttribute('data-open', 'false');

  // The drawer slides out again.
  await page.getByTestId('drawer-toggle').click({ force: true }).catch(() => undefined);
  await page.getByTestId('site-drawer-close').click().catch(() => undefined);
});

test('mission select: edit the mission, and the battery box always agrees with the checks', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout of mission select is covered by the phone test');
  await enterMission(page);
  await expect(page.getByTestId('mission-summary')).toContainText('Starship lander, Hab unit, Rover 1, Solar panels × 4, 2,000 kWh, 14 days.');

  await page.getByTestId('edit-mission').click();
  const planner = page.getByTestId('planner');
  await expect(planner).toHaveAttribute('data-open', 'true');
  await expect(planner).toBeFocused();
  const power = page.getByTestId('power-number');
  await expect(power).toHaveAttribute('data-level', /good|thin|short/);

  // A bad entry counts as none, at once, and says so.
  const box = page.getByTestId('storage-input');
  await box.fill('-5');
  await expect(page.getByTestId('storage-note')).toHaveAttribute('data-status', 'invalid');
  await expect(page.getByTestId('storage-note')).toContainText('counts as 0 kWh');
  await power.click();
  await expect(page.getByTestId('storage-counted')).toHaveAttribute('data-kwh', '0');
  // Leaving the box clears the bad text: the box then shows what the checks use.
  await box.blur();
  await expect(box).toHaveValue('');

  // A figure above the cap becomes the cap, in the box too, and says so.
  await box.fill('5000000');
  await expect(box).toHaveValue('1000000');
  await expect(page.getByTestId('storage-note')).toHaveText('Capped at 1,000,000 kWh, the most this planner accepts.');
  await expect(page.getByTestId('storage-counted')).toHaveAttribute('data-kwh', '1000000');

  // A stay long enough to include a lunar night, no storage and a solar-only plan: short at
  // night, with the storage that would cover it.
  await page.getByTestId('stay-input').fill('30');
  await box.fill('');
  await expect(power).toHaveAttribute('data-level', 'short', { timeout: 15_000 });
  await expect(power).toHaveAttribute('data-limiting', 'night');
  await expect(page.getByTestId('power-words')).toHaveText('power short at night');
  const needed = Number(await page.getByTestId('storage-needed').getAttribute('data-kwh'));
  expect(needed).toBeGreaterThan(0);
  await box.fill(String(needed));
  await expect(power).toHaveAttribute('data-level', /good|thin/);
  await expect(page.getByTestId('night-advice')).toHaveCount(0);

  // Hardware and stay change the one-line summary behind the sheet.
  await page.getByLabel('Nuclear generator').check();
  await page.keyboard.press('Escape');
  await expect(planner).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('edit-mission')).toBeFocused();
  await expect(page.getByTestId('mission-summary')).toContainText('Nuclear generator');
  await expect(page.getByTestId('mission-summary')).toContainText('30 days.');
});

test('mission select: the assistant runs along the bottom and covers no control', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout of mission select is covered by the phone test');
  await enterMission(page);
  const input = page.getByTestId('chat-input');
  const questions = ['Why does the delay matter?', 'What about power at night and batteries?', 'How does Earth contact work?'];
  for (const [i, q] of questions.entries()) {
    await input.fill(q);
    await input.press('Enter');
    await expect(page.getByTestId('chat-log').locator('[data-state="answer"]')).toHaveCount(i + 1);
  }
  await expect(page.getByTestId('chat-announcer')).toContainText('Earth link depends');

  // The history: at least six lines tall, at most 40 % of the window.
  const panel = page.getByTestId('chat-panel');
  const p = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(p.height).toBeLessThanOrEqual(viewport.height * 0.4 + 1);
  const log = await page.getByTestId('chat-log').evaluate((e) => ({ height: e.clientHeight, line: parseFloat(getComputedStyle(e).lineHeight) }));
  expect(log.height).toBeGreaterThanOrEqual(6 * log.line);

  // It covers no control outside itself: not the spotlight, the strip, the delay or the drawer handle.
  const covered = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="assistant"]')!.getBoundingClientRect();
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="mission-hud"] button, [data-testid="mission-hud"] input, [data-testid="mission-hud"] [role="option"]'))) {
      if (el.closest('[data-testid="assistant"]') || el.closest('[inert]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.left < a.right && a.left < r.right && r.top < a.bottom && a.top < r.bottom) out.push(el.dataset.testid ?? el.textContent?.slice(0, 30) ?? el.tagName);
    }
    return out;
  });
  expect(covered).toEqual([]);

  // Escape hides it, the button shows it again, Clear empties it.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.getByTestId('chat-expand').click();
  await expect(panel).toBeVisible();
  await page.getByTestId('chat-clear').click();
  await expect(page.getByTestId('chat-panel')).toHaveCount(0);
});

test('zoom in to the site and come back', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout is covered by the phone test');
  await enterMission(page);
  const name = (await page.getByTestId('spotlight-name').textContent())!;
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'site', { timeout: 15_000 });
  await expect(page.getByTestId('scene-title')).toHaveText(name);
  await page.getByTestId('back-to-mission').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission');
  await expect(page.getByTestId('spotlight-name')).toHaveText(name);
});
