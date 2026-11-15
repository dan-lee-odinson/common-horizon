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
