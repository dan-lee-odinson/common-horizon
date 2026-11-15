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
  if (size === '1440x900') {
    // Zoomed all the way out: the whole Earth, to scale beside the Moon.
    await page.getByTestId('orbit-zoom').click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${DIR}/stage-1-orbit-whole-earth-${size}.png` });
    await page.getByTestId('orbit-zoom').click();

    // The view turned by hand: the Moon's night side faces the camera and the Sun, at its true
    // direction and true apparent size, rises over the Moon's edge.
    // Held at 45 hours after the landing (2027-02-17 12:00 UTC), the instant the Earth-lighting test
    // uses, and with the camera's sway at rest so the picture is the same on every run.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('preview-scrub').fill('45');
    await page.waitForTimeout(1500);
    // Drag the picture: 300 pixels left carries the camera 90 degrees east, to the side of the Moon
    // away from the Sun; 67 pixels up lowers it to 10 degrees above the ring plane, where the Sun
    // stands just clear of the Moon's top edge (the Moon is 8.3 degrees in radius from here).
    await page.mouse.move(930, 640);
    await page.mouse.down();
    await page.mouse.move(630, 573, { steps: 12 });
    await page.mouse.up();
    await page.mouse.move(720, 560);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${DIR}/stage-1-orbit-sunrise-${size}.png` });
  }
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
    await page.getByTestId('zoom-to-site').click();
    await page.getByTestId('site-hud').waitFor();
    // The reticle names the lander only when the camera has come to rest and the lander's shape is in.
    await page.getByTestId('lander-reticle').locator('[data-marker-tag]').getByText('Starship HLS').waitFor({ timeout: 60_000 });
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

// The Moon's maps sit on the site markers' coordinates: the app's own marker, put on two craters
// by their published coordinates, lands on each crater in the picture.
for (const crater of [
  { name: 'tycho', lat: '-43.3', lon: '348.6' },
  { name: 'copernicus', lat: '9.6', lon: '339.9' },
]) {
  test(`moon alignment: the marker on ${crater.name}`, async ({ page }, info) => {
    const size = info.project.name;
    test.skip(size !== '1440x900', 'one size is enough for this proof');
    await page.goto('/');
    await page.getByTestId('begin').click();
    await page.getByTestId('enter-mission').click();
    await page.getByTestId('spotlight-name').waitFor();
    // A week's delay puts the Sun high over this part of the near side, so the craters and their rays show.
    await page.getByTestId('slip').fill('7');
    await page.getByTestId('drawer-toggle').click();
    await page.getByTestId('mode-custom').click();
    await page.getByTestId('lat-input').fill(crater.lat);
    await page.getByTestId('lon-input').fill(crater.lon);
    await page.getByTestId('go-coordinate').click();
    await page.getByTestId('site-drawer-close').click();
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `${DIR}/moon-alignment-${crater.name}-${size}.png` });
  });
}
