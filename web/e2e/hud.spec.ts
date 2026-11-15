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
      // The panel's own bottom padding (no text there) against the open scene just below the panel.
      const inside = await brightness(page, box.x + box.width / 2, box.y + box.height - 9);
      const outside = await brightness(page, box.x + box.width / 2, box.y + box.height + 14);
      expect(outside).toBeGreaterThan(40);
      // Whether or not the browser dims the backdrop, the backing is under half as bright as the scene.
      expect(inside).toBeLessThan(outside * 0.5);
    }
  });
}
