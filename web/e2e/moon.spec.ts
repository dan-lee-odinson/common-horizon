import { expect, test, type Page } from '@playwright/test';

// The Moon's real surface: the right pair of maps for the device, loaded from the app's own files,
// and the caption says what is on screen.

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

test('moon surface: the right pair of maps for this device, from the app itself, and the caption says so', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/textures/moon/')) asked.push(r.url());
  });
  await page.goto('/');
  await page.getByTestId('begin').click();
  const note = page.getByTestId('moon-surface-note');
  await expect(note).toHaveAttribute('data-surface', 'map', { timeout: 30_000 });
  await expect(note).toHaveText('The Moon’s surface is NASA’s CGI Moon Kit color map, made for visual use.');

  const origin = new URL(page.url()).origin;
  expect(asked.length).toBe(2);
  for (const url of asked) expect(new URL(url).origin).toBe(origin);
  const want = isPhone(page) ? '2k' : '4k';
  const never = isPhone(page) ? '4k' : '2k';
  expect(asked.some((u) => u.endsWith(`moon-color-${want}.jpg`))).toBe(true);
  expect(asked.some((u) => u.endsWith(`moon-normal-${want}.jpg`))).toBe(true);
  expect(asked.some((u) => u.includes(`-${never}.jpg`))).toBe(false);
});

test('moon surface: when the maps cannot be loaded the drawn surface stays and the caption says it is an illustration', async ({ page }) => {
  await page.route('**/textures/moon/**', (route) => route.abort());
  await page.goto('/');
  await page.getByTestId('begin').click();
  const note = page.getByTestId('moon-surface-note');
  await expect(note).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(note).toHaveAttribute('data-surface', 'drawn');
  await expect(note).toHaveText('The Moon’s surface pattern is an illustration, not a map.');
});
