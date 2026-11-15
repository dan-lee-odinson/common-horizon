import { test } from '@playwright/test';

// Takes the pictures shown in web/README.md, from the running app on example data.
// Run with `npm run screens`. Pictures go to web/docs/screens/.

const DIR = 'docs/screens';

test('stage 1: orbit', async ({ page }, info) => {
  const size = info.project.name;
  await page.goto('/');
  await page.getByTestId('landing-card').waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${DIR}/landing-card-${size}.png` });
  await page.getByTestId('begin').click();
  // Let the entrance settle and the previewed time run on a couple of days.
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${DIR}/stage-1-orbit-${size}.png` });
});

test('stage 2: mission select', async ({ page }, info) => {
  const size = info.project.name;
  const wide = size === '1440x900';
  const view = page.viewportSize()!;
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await page.getByTestId(wide ? 'spotlight-name' : 'mission-hud').waitFor();
  // A week's delay: the ranking has reordered and the rows show how far each site moved.
  await page.getByTestId('slip').fill('7');
  if (wide) await page.getByTestId('moved').first().waitFor();
  // The pointer rests in the middle, so the panels sit square; then the camera comes to rest on the new best site.
  await page.mouse.move(view.width / 2, view.height / 2);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${DIR}/stage-2-mission-select-${size}.png` });
  if (wide) {
    // The site drawer, open on the preset list.
    await page.getByTestId('drawer-toggle').click();
    await page.getByTestId('preset').first().waitFor();
    await page.mouse.move(view.width / 2, view.height / 2);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${DIR}/stage-2-drawer-${size}.png` });
  }
});

test('stage 3: site', async ({ page }, info) => {
  const size = info.project.name;
  const wide = size === '1440x900';
  const view = page.viewportSize()!;
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await page.getByTestId(wide ? 'spotlight-name' : 'mission-hud').waitFor();

  /** Down to the spotlight site; resolves once the camera is at rest and every model is drawn. */
  const down = async () => {
    await page.getByTestId(wide ? 'zoom-to-site' : 'zoom-to-site-phone').click();
    await page.getByTestId('site-hud').waitFor();
    // The reticle names the lander only when the camera has come to rest and the lander's shape is in.
    await page.getByTestId('lander-reticle').locator('[data-marker-tag]').getByText('Starship lander').waitFor({ timeout: 60_000 });
    await page.locator('[data-testid="site-scrub"]:not([disabled])').waitFor({ timeout: 60_000 });
    await page.mouse.move(view.width / 2, view.height / 2);
    await page.waitForTimeout(4000);
  };
  /** Put a preset site in the spotlight (wide layout: the drawer). */
  const spotlight = async (name: string) => {
    await page.getByTestId('drawer-toggle').click();
    await page.getByTestId('preset-search').fill(name);
    await page.getByTestId('preset').first().click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2500);
  };

  if (!wide) {
    await down();
    await page.screenshot({ path: `${DIR}/stage-3-site-${size}.png` });
    return;
  }

  // Daylight near the equator: the Sun 45 degrees up, so the lander's shadow is as long as the lander is tall.
  await spotlight('Apollo 11');
  await down();
  await page.screenshot({ path: `${DIR}/stage-3-site-${size}.png` });
  // The same site after sunset: only the dim fill is left.
  await page.getByTestId('site-scrub').fill('300');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DIR}/stage-3-site-dark-${size}.png` });

  // A site at the south pole: the Sun grazes the terrain skyline and shadows run for kilometres.
  await page.getByTestId('back-to-mission').click();
  await page.locator('[data-testid="zoom-to-site"]:not([disabled])').waitFor({ timeout: 30_000 });
  await spotlight('Shackleton');
  await down();
  await page.screenshot({ path: `${DIR}/stage-3-site-low-sun-${size}.png` });
});
