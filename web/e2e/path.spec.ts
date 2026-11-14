import { expect, test, type Page } from '@playwright/test';

// The main path through the website, on example data (mock mode):
// load -> pick hardware -> the ranked list appears -> move the slip and the rows reorder
// -> open a site -> go back. Runs at a desktop width and at a phone width.

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 768;
}

async function rowNames(page: Page): Promise<string[]> {
  return page.getByTestId('row-name').allTextContents();
}

test('plan a landing: hardware, ranking, slip, site scene and back', async ({ page }) => {
  const phone = isPhone(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Load
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lunar Landing Site Navigator' })).toBeVisible();
  await expect(page.getByTestId('not-to-scale')).toBeVisible();
  await expect(page.getByTestId('assistant')).toBeVisible();

  // 2. Pick hardware in the mission planner
  if (phone) await page.getByRole('button', { name: 'Planner' }).click();
  await page.getByLabel('Starship lander').check();
  await expect(page.getByTestId('power-number')).toBeVisible();
  if (phone) await page.getByRole('button', { name: 'Close the planner' }).click();

  // 3. The ranked list appears (view 2: site markers + Sites pane)
  await page.getByTestId('show-sites').click();
  if (phone) await page.getByRole('button', { name: 'Sites', exact: true }).click();
  const rows = page.getByTestId('ranked-row');
  await expect(rows).toHaveCount(13);
  const before = await rowNames(page);
  await expect(page.getByTestId('moved')).toHaveCount(0);

  // 4. Move the slip: the rows reorder and show how far they moved
  const slip = page.getByTestId('slip');
  await slip.focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('slip-value')).toHaveText('+7 d');
  await expect.poll(async () => (await rowNames(page)).join(' | '), { timeout: 10_000 }).not.toBe(before.join(' | '));
  await expect(page.getByTestId('moved').first()).toBeVisible();
  const after = await rowNames(page);
  expect([...after].sort()).toEqual([...before].sort());

  // 5. Open a site: first click highlights it, second click opens the site scene
  const name = after[0];
  const row = () => page.getByTestId('ranked-row').filter({ has: page.getByTestId('row-name').getByText(name, { exact: true }) }).getByRole('button').first();
  await row().click();
  await expect(row()).toHaveAttribute('aria-pressed', 'true');
  await row().click();
  await expect(page.getByTestId('back-to-moon')).toBeVisible();
  await expect(page.getByTestId('scene-title')).toHaveText(name);
  if (phone) await page.getByRole('button', { name: 'Horizon', exact: true }).click();
  await expect(page.getByTestId('horizon-full')).toBeVisible();
  await expect(page.getByTestId('horizon-full').getByTestId('ghost-marker')).toBeVisible();

  // 6. Go back to the Moon
  if (phone) await page.getByRole('button', { name: 'Close horizon plot' }).click();
  await page.getByTestId('back-to-moon').click();
  await expect(page.getByTestId('back-to-moon')).toHaveCount(0);
  if (phone) {
    await page.getByRole('button', { name: 'Sites', exact: true }).click();
  }
  await expect(page.getByTestId('ranked-row').first()).toBeVisible();

  expect(errors).toEqual([]);
});
