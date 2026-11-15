import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// The Site map on the Site stage, on example data (mock mode). NASA Moon Trek is never reached from
// the test: every request to trek.nasa.gov is intercepted, and the test decides whether it is
// answered (a small grey picture), refused, or left hanging. The tile addresses the page asks for
// are checked against the grid arithmetic (util/moonTrek.ts, whose unit tests hold the figures
// Planning checked on the live service).

const TILE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNMyChgYGBgYmBgYGBgAAAOugE8ZYmolgAAAABJRU5ErkJggg==', 'base64');
/**
 * Moon Trek's own legend pictures, as the service sent them on 15 November 2026 (NASA imagery):
 * the small tall one the global and 75° slope layers use, and the two wide ones of the ridge.
 * The 45° "under 10°" legend is the same size as the ridge's slope legend.
 */
const LEGENDS = (() => {
  const file = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/moon-trek-legends/${name}`, import.meta.url)));
  const tall = { body: file('LRO_LOLA_ClrSlope_Global_16ppd.png'), contentType: 'image/png' };
  const wide = { body: file('ColorSlope_LRO_LOLA_DEM_SPole875_5mp_v04.jpg'), contentType: 'image/jpeg' };
  const wider = { body: file('ColorSlope_10below_LRO_LOLA_DEM_SPole875_5m.jpg'), contentType: 'image/jpeg' };
  return new Map([
    ['LRO_LOLA_ClrSlope_Global_16ppd', tall],
    ['LRO_LOLA_ClrSlope_SPole75S_120m', tall],
    ['ColorSlope_LRO_LOLA_DEM_SPole875_5mp_v04', wide],
    ['LOLA_RGB_Slope_below_10deg_SPole45', wide],
    ['ColorSlope_10below_LRO_LOLA_DEM_SPole875_5m', wider],
  ]);
})();
const STORED_NOTE = 'Stored picture. NASA Moon Trek could not be reached.';
const NO_PICTURE_NOTE = 'NASA Moon Trek could not be reached, and there is no stored picture for this point.';

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 768;
}

interface Trek {
  /** Every address asked of trek.nasa.gov, in order. */
  asked: string[];
  mode: 'answer' | 'refuse' | 'hang';
}

async function interceptTrek(page: Page, mode: Trek['mode']): Promise<Trek> {
  const trek: Trek = { asked: [], mode };
  await page.route('https://trek.nasa.gov/**', (route) => {
    trek.asked.push(route.request().url());
    if (trek.mode === 'refuse') return route.abort('failed');
    // Left without an answer: the map's own six seconds run out.
    if (trek.mode === 'hang') return;
    const legend = /\/TrekWS\/rest\/cat\/legend\/stream\?label=(\w+)/.exec(route.request().url());
    if (legend) {
      const picture = LEGENDS.get(legend[1]);
      return picture ? route.fulfill({ status: 200, ...picture }) : route.fulfill({ status: 404, body: 'no legend' });
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG });
  });
  return trek;
}

/** "zoom/row/col.ext" of the tiles asked for since `from`. */
function tilesAsked(trek: Trek, from = 0): string[] {
  return trek.asked
    .slice(from)
    .filter((u) => u.includes('/tiles/Moon/'))
    .map((u) => u.split('/default028mm/')[1]);
}

async function enterMission(page: Page) {
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await expect(page.getByTestId('mission-hud')).toBeVisible();
  if (!isPhone(page)) await expect(page.getByTestId('spotlight-name')).not.toHaveText('', { timeout: 30_000 });
}

async function spotlight(page: Page, name: string) {
  await page.getByTestId('drawer-toggle').click();
  await page.getByTestId('preset-search').fill(name);
  await page.getByTestId('preset').first().click();
  await expect(page.getByTestId('spotlight-name')).toHaveText(name);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('site-drawer')).toHaveAttribute('data-open', 'false');
}

async function zoomIn(page: Page) {
  await page.getByTestId('zoom-to-site').scrollIntoViewIfNeeded();
  await page.getByTestId('zoom-to-site').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-stage', 'site', { timeout: 15_000 });
  await expect(page.getByTestId('site-hud')).toBeVisible();
}

async function openMap(page: Page) {
  const toggle = page.getByTestId('site-map-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.getByTestId('site-map')).toBeVisible();
}

/** The scene's labelled markers that show on top of the open map panel. */
function tagsOverPanel(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const p = document.querySelector('[data-testid="site-map"]')!.getBoundingClientRect();
    return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="site-marker"]'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const shown = r.width > 0 && getComputedStyle(el).visibility !== 'hidden';
        return shown && r.left < p.right && p.left < r.right && r.top < p.bottom && p.top < r.bottom;
      })
      .map((el) => el.textContent ?? '');
  });
}

/** Where the legend picture is drawn, and whether all of it shows inside the panel without scrolling. */
function legendInPanel(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="site-map"]')!;
    const scroller = document.querySelector<HTMLElement>('[data-testid="site-map-scroll"]')!;
    const img = document.querySelector<HTMLImageElement>('[data-testid="site-map-legend"] img')!;
    const p = panel.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    return {
      loaded: img.complete && img.naturalWidth > 0,
      natural: [img.naturalWidth, img.naturalHeight],
      drawn: [Math.round(r.width), Math.round(r.height)],
      rendering: getComputedStyle(img).imageRendering,
      inside: r.left >= p.left - 0.5 && r.right <= p.right + 0.5 && r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5,
      scrolls: scroller.scrollHeight > scroller.clientHeight + 1,
    };
  });
}

/** Every combination of the rows and columns given, as "zoom/row/col.ext". */
function grid(zoom: number, rows: number[], cols: number[], ext: string): string[] {
  return rows.flatMap((r) => cols.map((c) => `${zoom}/${r}/${c}.${ext}`));
}

test('site map: the stored picture at once, the live tiles over it, the layers, the zoom and the link', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout is checked in its own test');
  const trek = await interceptTrek(page, 'answer');
  await enterMission(page);
  await spotlight(page, 'Apollo 15');
  await zoomIn(page);
  // Closed until asked for: the stage looks as it did.
  await expect(page.getByTestId('site-map')).toHaveCount(0);
  await expect(page.getByTestId('site-map-toggle')).toHaveText('Site map · NASA Moon Trek');
  const band = page.locator('[data-site-zone="checks"]');
  await expect(band).toBeVisible();
  await openMap(page);
  await expect(page.getByTestId('site-map-close')).toBeFocused();
  // The panel takes the room down to the console: the Data checks band steps aside while it is open.
  await expect(band).toBeHidden();

  const frame = page.getByTestId('site-map-frame');
  await expect(page.getByTestId('site-map-stored')).toHaveAttribute('src', /(^|\/)site-context\/apollo-15\.jpg$/);
  await expect(frame).toHaveAttribute('data-state', 'live');
  await expect(frame).toHaveAttribute('data-showing', 'live');
  // 26.13239° N, 3.6333° E at zoom 7: pixel (33429.4, 11626.7); the view is 960 / cos(lat) wide before the squeeze.
  expect(tilesAsked(trek).sort()).toEqual(grid(7, [44, 45, 46], [128, 129, 130, 131, 132], 'jpg').sort());
  expect(trek.asked[0]).toMatch(/^https:\/\/trek\.nasa\.gov\/tiles\/Moon\/EQ\/LRO_WAC_Mosaic_Global_303ppd_v02\/1\.0\.0\/default\/default028mm\/7\//);
  await expect(page.locator('[data-testid="site-map-tiles"] img[data-tile]')).toHaveCount(15);
  const squeeze = await page.getByTestId('site-map-tiles').evaluate((el) => (el as HTMLElement).style.transform);
  expect(squeeze).toMatch(/^scaleX\(0\.8977\d*\)$/);
  await expect(page.getByTestId('site-map-marker')).toBeVisible();
  await expect(page.getByTestId('site-map-scale')).toHaveText('20 km');
  await expect(page.getByTestId('site-map-caption')).toHaveText('LRO WAC Mosaic v2 · NASA Moon Trek · 167 m per pixel');
  await expect(page.getByTestId('site-map-status')).toHaveText('');
  // The scene's name tags (drawn above the HUD) never show over the panel.
  await expect.poll(() => tagsOverPanel(page)).toEqual([]);

  // The layers this site has: no "Slope under 10°" outside the south polar grid.
  const layers = page.getByTestId('site-map-layers').getByRole('button');
  await expect(layers).toHaveText(['Photo', 'Terrain', 'Slope']);
  await expect(layers.nth(0)).toHaveAttribute('aria-pressed', 'true');

  // Three zoom steps around the site.
  let from = trek.asked.length;
  await page.getByTestId('site-map-zoom-in').click();
  await expect(frame).toHaveAttribute('data-zoom', '8');
  await expect(frame).toHaveAttribute('data-state', 'live');
  await expect(page.getByTestId('site-map-zoom-in')).toBeDisabled();
  expect(tilesAsked(trek, from).every((t) => t.startsWith('8/'))).toBe(true);
  await expect(page.getByTestId('site-map-caption')).toHaveText('LRO WAC Mosaic v2 · NASA Moon Trek · 83 m per pixel');
  await page.getByTestId('site-map-zoom-out').click();
  await page.getByTestId('site-map-zoom-out').click();
  await expect(frame).toHaveAttribute('data-zoom', '6');
  await expect(page.getByTestId('site-map-zoom-out')).toBeDisabled();
  await expect(page.getByTestId('site-map-scale')).toHaveText('50 km');
  await page.getByTestId('site-map-zoom-in').click();
  await expect(frame).toHaveAttribute('data-zoom', '7');

  // Slope: the regional layer, enlarged from its finest tiles, with Moon Trek's own legend.
  from = trek.asked.length;
  await layers.nth(2).click();
  await expect(layers.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(frame).toHaveAttribute('data-layer', 'LRO_LOLA_ClrSlope_Global_16ppd');
  await expect(frame).toHaveAttribute('data-state', 'live');
  expect(tilesAsked(trek, from).length).toBeGreaterThan(0);
  expect(tilesAsked(trek, from).every((t) => t.startsWith('2/') && t.endsWith('.png'))).toBe(true);
  await expect(page.getByTestId('site-map-caption')).toHaveText('LOLA Slope 16ppd, Colorized · NASA Moon Trek · regional, about 5 km per pixel');
  await expect(page.getByTestId('site-map-legend').getByRole('img')).toHaveAttribute('src', 'https://trek.nasa.gov/moon/TrekWS/rest/cat/legend/stream?label=LRO_LOLA_ClrSlope_Global_16ppd');
  // Moon Trek's small legend (50 x 150) at 3x with square pixels, beside the map, all of it inside the panel.
  await expect(page.getByTestId('site-map-legend')).toHaveAttribute('data-placement', 'side');
  await expect.poll(() => legendInPanel(page)).toEqual({ loaded: true, natural: [50, 150], drawn: [150, 450], rendering: 'pixelated', inside: true, scrolls: false });
  await layers.nth(1).click();
  await expect(page.getByTestId('site-map-legend')).toHaveCount(0);

  // Out to Moon Trek itself, and to Lunar QuickMap on a 300 x 146 km box around the site (its equirectangular map), each in a new tab.
  const link = page.getByTestId('site-map-trek');
  await expect(link).toHaveText('Open in Moon Trek');
  await expect(link).toHaveAttribute('href', 'https://trek.nasa.gov/moon/#v=0.1&x=3.6333&y=26.13239&z=8&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104903&d=&locale=&b=moon');
  await expect(link).toHaveAttribute('target', '_blank');
  const quickMap = page.getByTestId('site-map-quickmap');
  await expect(quickMap).toHaveText('Open in QuickMap (LROC)');
  await expect(quickMap).toHaveAttribute('href', 'https://quickmap.lroc.im-ldi.com/?prjExtent=-39826%2C719422%2C260174%2C865422&proj=16');
  await expect(quickMap).toHaveAttribute('target', '_blank');
  await expect(quickMap).toHaveAttribute('rel', 'noopener noreferrer');

  // Escape closes it, and focus goes back to the button.
  await page.getByTestId('site-map-close').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('site-map')).toHaveCount(0);
  await expect(page.getByTestId('site-map-toggle')).toBeFocused();
  await expect(band).toBeVisible();
});

test('site map: keeps the stored picture when Moon Trek is refused, and when six seconds pass', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout is checked in its own test');
  const trek = await interceptTrek(page, 'refuse');
  await enterMission(page);
  await spotlight(page, 'Shackleton Connecting Ridge');
  await zoomIn(page);
  await openMap(page);
  const frame = page.getByTestId('site-map-frame');

  await expect(frame).toHaveAttribute('data-state', 'stored');
  await expect(frame).toHaveAttribute('data-showing', 'stored');
  await expect(page.getByTestId('site-map-status')).toHaveText(STORED_NOTE);
  await expect(page.getByTestId('site-map-tiles')).toHaveCount(0);
  await expect(page.getByTestId('site-map-stored')).toBeVisible();
  // The south polar grid at zoom 7, from the ridge's 87.5° shaded relief: (16342.7, 16521.2) is in tile row 64, column 63.
  expect(tilesAsked(trek)).toContain('7/64/63.png');
  expect(trek.asked.every((u) => u.includes('/SP/LRO_LOLA_ClrShade_SPole875_5mp_v04/'))).toBe(true);
  await expect(page.getByTestId('site-map-caption')).toHaveText('LRO LOLA DEM, S Pole, 87.5 deg, ColorHillshade · NASA Moon Trek · 67 m per pixel · 0° longitude is up');
  await expect(page.getByTestId('site-map-layers').getByRole('button')).toHaveText(['Photo', 'Terrain', 'Slope', 'Under 10°']);

  // Another layer that cannot be reached: the caption names the stored picture's layer, which is what is shown.
  await page.getByTestId('site-map-layers').getByRole('button', { name: 'Photo' }).click();
  await expect(frame).toHaveAttribute('data-layer', 'LRO_WAC_Mosaic_SPole60_100m_v02');
  await expect(frame).toHaveAttribute('data-state', 'stored');
  await expect(page.getByTestId('site-map-caption')).toContainText('LRO LOLA DEM, S Pole, 87.5 deg, ColorHillshade');

  // Moon Trek does not answer at all: the tiles wait six seconds, then the stored picture stays (enlarged for the zoom).
  trek.mode = 'hang';
  await page.getByTestId('site-map-zoom-in').click();
  await expect(frame).toHaveAttribute('data-zoom', '8');
  await expect(frame).toHaveAttribute('data-state', 'loading');
  await expect(page.getByTestId('site-map-stored')).toBeVisible();
  await expect(frame).toHaveAttribute('data-state', 'stored', { timeout: 10_000 });
  await expect(page.getByTestId('site-map-status')).toHaveText(STORED_NOTE);
  expect(await page.getByTestId('site-map-stored').evaluate((el) => (el as HTMLElement).style.transform)).toBe('scale(2)');
});

test('site map: the ridge’s wide legends show whole inside the panel at 1440 x 900, and the layer buttons keep to one line', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout is checked in its own test');
  await interceptTrek(page, 'answer');
  await enterMission(page);
  await spotlight(page, 'Shackleton Connecting Ridge');
  await zoomIn(page);
  await openMap(page);
  const frame = page.getByTestId('site-map-frame');
  await expect(frame).toHaveAttribute('data-state', 'live');

  // The four buttons on one line, whichever layer is shown.
  const oneLine = async () => {
    const tops = await page
      .getByTestId('site-map-layers')
      .getByRole('button')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(tops).toHaveLength(4);
    expect(new Set(tops).size).toBe(1);
  };
  await oneLine();

  const layers = page.getByTestId('site-map-layers');
  for (const [name, label, natural] of [
    ['Slope', 'ColorSlope_LRO_LOLA_DEM_SPole875_5mp_v04', [615, 145]],
    ['Under 10°', 'ColorSlope_10below_LRO_LOLA_DEM_SPole875_5m', [1440, 340]],
  ] as const) {
    await layers.getByRole('button', { name, exact: true }).click();
    await expect(frame).toHaveAttribute('data-layer', label);
    await expect(frame).toHaveAttribute('data-state', 'live');
    await expect(page.getByTestId('site-map-legend')).toHaveAttribute('data-placement', 'below');
    await expect.poll(() => legendInPanel(page)).toMatchObject({ loaded: true, natural, inside: true, scrolls: false });
    await oneLine();
    // The legend as wide as the map; the map gives up the height the legend takes, and stays a usable size.
    const [legendBox, mapBox] = [await page.getByTestId('site-map-legend').getByRole('img').boundingBox(), await frame.boundingBox()];
    expect(Math.abs(legendBox!.width - mapBox!.width)).toBeLessThanOrEqual(1);
    expect(mapBox!.width).toBeGreaterThanOrEqual(280);
  }
  await expect(page.getByTestId('site-map-caption')).toHaveText('LRO LOLA Color Slope < 10 deg, S Pole, 87.5 deg · NASA Moon Trek · 67 m per pixel · 0° longitude is up');
});

test('site map: a view across 180° asks for the wrapped columns', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout is checked in its own test');
  const trek = await interceptTrek(page, 'answer');
  await enterMission(page);
  await spotlight(page, 'Blue Ghost Mission 2 (planned)');
  await zoomIn(page);
  await openMap(page);
  await expect(page.getByTestId('site-map-frame')).toHaveAttribute('data-state', 'live');
  // 24.9° S, 177.4° E at zoom 7: pixel (65062.7, 20916.9). The view runs past column 255 into column 0 again.
  expect(tilesAsked(trek).sort()).toEqual(grid(7, [80, 81, 82], [252, 253, 254, 255, 0], 'jpg').sort());
  // Column 0 is drawn east of column 255, not at the far side of the map.
  const at = (tile: string) => page.locator(`[data-tile="${tile}"]`).evaluate((el) => el.getBoundingClientRect().left);
  expect(await at('7/81/0')).toBeGreaterThan(await at('7/81/255'));
});

test('site map: a custom point has a plain placeholder until the tiles are in', async ({ page }) => {
  test.skip(isPhone(page), 'the phone layout is checked in its own test');
  const trek = await interceptTrek(page, 'hang');
  await enterMission(page);
  await page.getByTestId('drawer-toggle').click();
  await page.getByTestId('mode-custom').click();
  await page.getByTestId('lat-input').fill('10');
  await page.getByTestId('lon-input').fill('20');
  await page.getByTestId('go-coordinate').click();
  await expect(page.getByTestId('spotlight-name')).toContainText('Custom point');
  await page.keyboard.press('Escape');
  await zoomIn(page);
  await openMap(page);
  const frame = page.getByTestId('site-map-frame');

  await expect(page.getByTestId('site-map-stored')).toHaveCount(0);
  await expect(page.getByTestId('site-map-placeholder')).toBeVisible();
  await expect(frame).toHaveAttribute('data-state', 'loading');
  expect(trek.asked.some((u) => u.includes('site-context'))).toBe(false);
  // Six seconds without an answer: no picture to keep, and the panel says so.
  await expect(frame).toHaveAttribute('data-state', 'stored', { timeout: 10_000 });
  await expect(frame).toHaveAttribute('data-showing', 'none');
  await expect(page.getByTestId('site-map-status')).toHaveText(NO_PICTURE_NOTE);
  await expect(page.getByTestId('site-map-caption')).toHaveCount(0);

  // Moon Trek answers: the tiles cover the placeholder.
  trek.mode = 'answer';
  await page.getByTestId('site-map-zoom-in').click();
  await expect(frame).toHaveAttribute('data-state', 'live');
  await expect(page.getByTestId('site-map-placeholder')).toHaveCount(0);
  await expect(page.getByTestId('site-map-trek')).toHaveAttribute('href', /x=20&y=10&/);
});

test('site map on a phone: opens over the scene, inside the window and above the dock', async ({ page }) => {
  test.skip(!isPhone(page), 'the desktop layout is checked above');
  await interceptTrek(page, 'answer');
  await enterMission(page);
  await zoomIn(page);
  await openMap(page);
  await expect(page.getByTestId('site-map-frame')).toHaveAttribute('data-state', 'live');
  const panel = (await page.getByTestId('site-map').boundingBox())!;
  const dock = (await page.getByTestId('site-dock').boundingBox())!;
  const view = page.viewportSize()!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(view.width);
  expect(panel.y + panel.height).toBeLessThanOrEqual(dock.y);
  await expect.poll(() => tagsOverPanel(page)).toEqual([]);
  await page.getByTestId('site-map-close').click();
  await expect(page.getByTestId('site-map')).toHaveCount(0);
  await expect(page.getByTestId('site-map-toggle')).toBeFocused();
});
