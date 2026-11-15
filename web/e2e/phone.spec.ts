import { expect, test, type Page } from '@playwright/test';

// A phone-width walk through the three stages: each loads, its main controls work, and nothing
// scrolls sideways.

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

async function noSidewaysScroll(page: Page, where: string) {
  const over = await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) - window.innerWidth);
  expect(over, `${where} scrolls sideways`).toBeLessThanOrEqual(0);
}

test('phone: the three stages load and can be used at 390 px wide', async ({ page }) => {
  test.skip(!isPhone(page), 'this walk is for the phone width');
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Orbit, behind the landing card.
  await page.goto('/');
  await expect(page.getByTestId('landing-card')).toBeVisible();
  await noSidewaysScroll(page, 'the landing card');
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('enter-mission')).toBeVisible();
  await expect(page.getByTestId('not-to-scale')).toBeVisible();
  await noSidewaysScroll(page, 'Orbit');

  // Mission select: the spotlight, the ranked strip, the delay and the presets are all reachable.
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('spotlight-name')).not.toHaveText('', { timeout: 30_000 });
  await expect(page.getByTestId('spotlight-rank')).toHaveText('01');
  await expect(page.getByTestId('zoom-to-site')).toBeVisible();
  await noSidewaysScroll(page, 'Mission select');
  const first = (await page.getByTestId('spotlight-name').textContent())!;
  const rows = page.getByTestId('ranked-row');
  await rows.nth(1).scrollIntoViewIfNeeded();
  await rows.nth(1).click();
  await expect(page.getByTestId('spotlight-rank')).toHaveText('02');
  await expect(page.getByTestId('spotlight-name')).not.toHaveText(first);
  const toggle = page.getByTestId('drawer-toggle');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(page.getByTestId('site-drawer')).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('preset').first()).toBeVisible();
  await noSidewaysScroll(page, 'the site drawer');
  await page.getByTestId('site-drawer-close').click();
  await expect(page.getByTestId('site-drawer')).toHaveAttribute('data-open', 'false');

  // Site: arrive, play, and come back.
  const name = (await page.getByTestId('spotlight-name').textContent())!;
  await page.getByTestId('zoom-to-site').scrollIntoViewIfNeeded();
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'site', { timeout: 20_000 });
  await expect(page.getByTestId('scene-title')).toHaveText(name);
  await noSidewaysScroll(page, 'Site');
  await page.getByTestId('back-to-mission').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission', { timeout: 20_000 });
  await expect(page.getByTestId('spotlight-name')).toHaveText(name);
  expect(errors).toEqual([]);
});
