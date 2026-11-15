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
  await expect(page.getByTestId('not-to-scale')).toContainText('sizes and distances not to scale');

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

// ---------- The Sun, Earth and their tags stay clear of the glass panels ----------

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function overlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

test('orbit: through a whole lunar day, markers and their tags never touch a glass panel, and Earth never covers the Moon', async ({ page }) => {
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
      return { panels, markers };
    });
    expect(state.panels.length).toBeGreaterThanOrEqual(4);
    for (const m of state.markers) {
      if (m.name === 'sun') sunSeen++;
      if (m.name === 'earth') earthSeen++;
      for (const p of state.panels) {
        expect(overlap(m.body, p), `${m.name} overlaps a panel at step ${i}`).toBe(false);
        expect(overlap(m.tag, p), `${m.name} tag overlaps a panel at step ${i}`).toBe(false);
      }
    }
  }
  // Earth is in view the whole time; the Sun is hidden only while it is behind the Moon.
  expect(earthSeen).toBe(13);
  expect(sunSeen).toBeGreaterThanOrEqual(6);
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
  expect(await readout(page, 'score')).toMatch(/^\d{1,3}$/);

  // The strip is short: a few rows, not every preset. The presets are in the drawer.
  const rows = page.getByTestId('ranked-row');
  expect(await rows.count()).toBeLessThanOrEqual(5);
  await expect(page.getByTestId('strip-range')).toHaveText(/^1 to \d of 17$/);
  await expect(page.getByTestId('site-drawer')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('preset').first()).toBeHidden();
  await expect(rows.first().getByTestId('row-name')).toHaveText(best);
  await expect(rows.first().getByTestId('verdict')).toHaveText(/pass|fail/);

  // Arrow keys move the spotlight down the ranking, and back.
  const before = await stripNames(page);
  await page.getByTestId('ranked-strip').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('spotlight-rank')).toHaveText('02');
  await expect(page.getByTestId('spotlight-name')).toHaveText(before[1]);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('spotlight-rank')).toHaveText('01');
  // "Follow the best site" lets the spotlight follow the ranking again.
  await page.getByTestId('follow-best').click();
  await expect(page.getByTestId('follow-best')).toHaveCount(0);

  // The delay: +7 days moves the landing a week along the lunar day, and the ranking reorders.
  const slip = page.getByTestId('slip');
  await slip.focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('slip-value')).toHaveText('+7days');
  await expect.poll(async () => (await stripNames(page)).join(' | '), { timeout: 15_000 }).not.toBe(before.join(' | '));
  await expect(page.getByTestId('moved').first()).toBeVisible();
  await expect(page.getByTestId('spotlight-rank')).toHaveText('01');
  await expect(page.getByTestId('spotlight-name')).not.toHaveText(best);
  await expect(page.getByTestId('rank-announcement')).toContainText('is now first');
  expect(errors).toEqual([]);
});

test('mission select: the drawer holds the presets and the coordinate entry', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout of mission select is covered by the phone test');
  await enterMission(page);
  const drawer = page.getByTestId('site-drawer');
  await expect(drawer).toHaveAttribute('data-open', 'false');

  // It slides in; focus moves into it; the presets are a searchable list.
  await page.getByTestId('drawer-toggle').click();
  await expect(drawer).toHaveAttribute('data-open', 'true');
  await expect(drawer).toBeFocused();
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
