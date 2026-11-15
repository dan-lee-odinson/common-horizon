import { expect, test, type Page } from '@playwright/test';

// Two faults that came from keeping the HUD's layers in 3D, checked on the real screen:
// glass that no longer dims what is behind it, and a first press that is lost.

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

/** Mean brightness (0..255) of a small square of the screen, read from a screenshot. */
async function brightness(page: Page, x: number, y: number, size = 6): Promise<number> {
  const shot = await page.screenshot({ clip: { x, y, width: size, height: size } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  }, shot.toString('base64'));
}

test('the panels stay still while the pointer moves (no parallax), on the Orbit stage and in mission select', async ({ page }) => {
  test.skip(isPhone(page), 'a pointer is a desktop matter');
  test.setTimeout(90_000);
  // Ordinary motion, where the panels used to shift and lean with the pointer.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('enter-mission')).toBeVisible();
  /** Every HUD layer's place and its own transform, after the pointer has rested at one point. */
  const layersWith = async (x: number, y: number) => {
    await page.mouse.move(x, y, { steps: 6 });
    await page.waitForTimeout(1500);
    return page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.hud-layer')).map((el) => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), getComputedStyle(el).transform];
      }),
    );
  };
  const { width, height } = page.viewportSize()!;
  // (The entrance has settled once the same point twice gives the same places.)
  await layersWith(40, 40);
  const corner = await layersWith(40, 40);
  expect(corner.length).toBeGreaterThan(0);
  expect(await layersWith(width - 40, height - 40)).toEqual(corner);
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('spotlight')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await layersWith(width / 2, 40);
  const top = await layersWith(width / 2, 40);
  expect(await layersWith(width - 300, height - 200)).toEqual(top);
});

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
] as const) {
  test(`panels, the planner and the presets drawer still take clicks on all three stages at ${width} x ${height}`, async ({ page }) => {
    test.skip(isPhone(page), 'the desktop layouts at two sizes');
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height });
    // (Each click below is Playwright's: it fails if anything else would receive the press.)
    await page.goto('/');
    await page.getByTestId('begin').click();
    // Orbit: a control on a panel, then the panel's main button.
    const preview = page.getByTestId('preview-toggle');
    const was = await preview.getAttribute('aria-pressed');
    await preview.click();
    await expect(preview).not.toHaveAttribute('aria-pressed', was ?? '');
    await preview.click();
    await expect(preview).toHaveAttribute('aria-pressed', was ?? '');
    await page.getByTestId('enter-mission').click();
    await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission');
    await expect(page.getByTestId('ranked-row').first()).toBeVisible({ timeout: 60_000 });
    // Mission select: the planner, one of its rows, and the presets drawer with one preset.
    await page.getByTestId('edit-mission').click();
    const planner = page.getByTestId('planner');
    await expect(planner).toHaveAttribute('data-open', 'true');
    const relay = planner.locator('[data-testid="hardware-row"][data-id="comms_relay"] input[type="checkbox"]');
    await relay.click();
    await expect(relay).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(planner).toHaveAttribute('data-open', 'false');
    await page.getByTestId('drawer-toggle').click();
    await expect(page.getByTestId('site-drawer')).toHaveAttribute('data-open', 'true');
    await page.getByTestId('preset-search').click();
    await page.getByTestId('preset-search').fill('Apollo 14');
    await page.getByTestId('preset').first().click();
    await expect(page.getByTestId('spotlight-name')).toHaveText('Apollo 14');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('site-drawer')).toHaveAttribute('data-open', 'false');
    await page.getByTestId('ranked-row').nth(1).click();
    await page.getByTestId('zoom-to-site').click();
    // Site: the console's play button, the Sun panel's Look, Reset view, and Data checks where it is a button.
    await expect(page.getByTestId('site-scrub')).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId('lander-reticle')).toHaveAttribute('data-visible', 'true', { timeout: 60_000 });
    const play = page.getByTestId('site-play');
    await play.click();
    await expect(play).toHaveAttribute('aria-pressed', 'true');
    await play.click();
    await expect(play).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('look-sun').click();
    await page.getByTestId('look-earth').click();
    await page.getByTestId('reset-view').click();
    if (height <= 820) {
      await page.getByTestId('site-checks-show').click();
      await page.getByTestId('site-checks-hide').click();
      await expect(page.getByTestId('site-checks-panel')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('site-checks-panel')).toBeVisible();
    }
    await page.getByTestId('back-to-mission').click();
    await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission');
  });
}

test('orbit: a press on "Enter mission select" counts after the pointer has rested over the picture', async ({ page }) => {
  test.skip(isPhone(page), 'a resting pointer is a desktop matter');
  await page.goto('/');
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('enter-mission')).toBeVisible();
  await page.mouse.move(720, 430);
  await page.waitForTimeout(3000);
  const box = (await page.getByTestId('enter-mission').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'mission', { timeout: 15_000 });
});

for (const motion of ['reduce', 'no-preference'] as const) {
  test(`site: the side panels keep a dark backing over lit ground (motion: ${motion})`, async ({ page }) => {
    test.skip(isPhone(page), 'the wings are a desktop layout');
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto('/');
    await page.getByTestId('begin').click();
    await page.getByTestId('enter-mission').click();
    await expect(page.getByTestId('spotlight-name')).not.toHaveText('', { timeout: 30_000 });
    // A site with the Sun high at the landing, so the ground under the panel is brightly lit.
    await page.getByTestId('drawer-toggle').click();
    await page.getByTestId('preset-search').fill('Blue Ghost Mission 1');
    await page.getByTestId('preset').first().click();
    await expect(page.getByTestId('spotlight-name')).toHaveText('Blue Ghost Mission 1');
    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-to-site').click();
    await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'site', { timeout: 30_000 });
    const panel = page.getByTestId('sun-panel');
    await expect(panel).toBeVisible();
    // Sampled several times after the arrival: the fault this guards came and went with the entrance.
    for (const wait of [3000, 2500, 2500]) {
      await page.waitForTimeout(wait);
      const box = (await panel.boundingBox())!;
      // The panel's own bottom padding (no text there) against the open scene just beside it, above
      // the Data checks band that rests on the console.
      const band = await page.getByTestId('site-checks-panel').boundingBox();
      const inside = await brightness(page, box.x + box.width / 2, box.y + box.height - 9);
      const outside = await brightness(page, box.x + box.width + 24, band ? Math.min(box.y + box.height - 9, band.y - 14) : box.y + box.height - 9);
      expect(outside).toBeGreaterThan(40);
      // Whether or not the browser dims the backdrop, the backing is under half as bright as the scene.
      expect(inside).toBeLessThan(outside * 0.5);
    }
  });
}
