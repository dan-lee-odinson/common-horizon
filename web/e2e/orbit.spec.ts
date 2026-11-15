import { expect, test, type Page } from '@playwright/test';
import { ORBIT_VIEW, hitBall, orbitCameraLongitude, orbitDistance, orbitRay, orbitZoomDistance, projectOrbit, worldPoint } from '../src/scene/orbitView';

// The Orbit picture itself, checked on the real screen: Earth's day side faces the Sun (the same
// direction that lights the Moon) and its night side is drawn dark.
// These run with reduced motion, so the camera holds its standard pose (no sway, no lean) and the
// arithmetic in src/scene/orbitView.ts says exactly which pixel shows which point of Earth.

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

async function readout(page: Page, key: string): Promise<string> {
  return (await page.locator(`[data-q="${key}"] [data-q-text]`).first().textContent()) ?? '';
}

/** A readout as a signed number: "2.27" with the unit "° S" is -2.27. */
async function degrees(page: Page, key: string): Promise<number> {
  const text = await readout(page, key);
  const unit = (await page.locator(`[data-q="${key}"] [data-q-unit]`).first().textContent()) ?? '';
  return Number(text) * (/[SW]/.test(unit) ? -1 : 1);
}

interface Sample {
  x: number;
  y: number;
}

/** Brightness (0 to 1, as shown on screen) at points of the page: the mean of a small square round each, read from one screenshot. */
async function brightnessAt(page: Page, points: Sample[], half = 2): Promise<number[]> {
  const shot = await page.screenshot();
  return page.evaluate(
    async ({ b64, points, half }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const k = img.width / window.innerWidth;
      return points.map((p) => {
        const d = g.getImageData(Math.round(p.x * k) - half, Math.round(p.y * k) - half, half * 2 + 1, half * 2 + 1).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return sum / (d.length / 4) / 255;
      });
    },
    { b64: shot.toString('base64'), points, half },
  );
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Opens Orbit with the preview held at a number of hours after the landing, the camera at rest. */
async function orbitAt(page: Page, hours: number) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByTestId('begin').click();
  await expect.poll(() => readout(page, 'subsolar_lon'), { timeout: 30_000 }).toMatch(/^\d/);
  await page.getByTestId('preview-scrub').fill(String(hours));
  // The pointer rests clear of Earth and of every control.
  await page.mouse.move(720, 470);
}

/** Points of Earth on screen for the standard camera, each with the cosine of the Sun's angle above its own ground. */
function earthOnScreen(g: { sunLat: number; sunLon: number; earthLat: number; earthLon: number }, width: number, height: number, zoom: number) {
  const cameraLon = orbitCameraLongitude(g.earthLon, 'left');
  const distance = orbitZoomDistance(orbitDistance(width, height, false), zoom);
  const centre = worldPoint(g.earthLat, g.earthLon, ORBIT_VIEW.earthDistance);
  const sun = worldPoint(g.sunLat, g.sunLon, 1);
  const disc = projectOrbit(g.earthLat, g.earthLon, ORBIT_VIEW.earthDistance, cameraLon, ORBIT_VIEW.elevation, distance, width, height);
  const points: (Sample & { cosSun: number; edge: number })[] = [];
  for (let y = 78; y < height - 20; y += 12) {
    for (let x = 12; x < width / 2; x += 12) {
      const ray = orbitRay(x, y, cameraLon, ORBIT_VIEW.elevation, distance, width, height);
      const n = hitBall(ray.origin, ray.dir, centre, ORBIT_VIEW.earthRadius);
      if (!n) continue;
      // How squarely this point of Earth faces the camera: 1 at the middle of the disc, 0 on its limb.
      const edge = -(n.x * ray.dir.x + n.y * ray.dir.y + n.z * ray.dir.z);
      points.push({ x, y, cosSun: n.x * sun.x + n.y * sun.y + n.z * sun.z, edge });
    }
  }
  return { points, disc: { x: disc.x, y: disc.y, r: ORBIT_VIEW.earthRadius * disc.scale } };
}

test('orbit: at 2027-02-17 12:00 UTC the part of Earth on screen is its night side and is drawn dark; zoomed out, its day side is the Sun’s side, as the Moon’s is', async ({ page }) => {
  test.skip(isPhone(page), 'the phone picture is rolled; the arithmetic here is for the upright desktop picture');
  const { width, height } = page.viewportSize()!;
  // 45 hours after the landing (2027-02-15 15:00 UTC). The scrubber moves in whole hours.
  await orbitAt(page, 45);
  await expect.poll(() => readout(page, 'utc')).toBe('2027-02-17 12:00:00');
  const g = { sunLat: await degrees(page, 'subsolar_lat'), sunLon: await degrees(page, 'subsolar_lon'), earthLat: await degrees(page, 'subearth_lat'), earthLon: await degrees(page, 'subearth_lon') };
  expect(g.sunLon).toBeCloseTo(45.99, 1);
  expect(g.earthLon).toBeCloseTo(352.93, 1);
  await expect(page.locator('[data-marker="earthLimb"]')).toHaveAttribute('data-visible', 'true');
  await page.waitForTimeout(1200);

  // The usual view: every point of Earth on screen is on its night side (the arithmetic), and the
  // screen shows it dark (the picture). Points near the limb are left out: the thin line of air is there.
  const near = earthOnScreen(g, width, height, 0);
  const face = near.points.filter((p) => p.edge > 0.35);
  expect(face.length).toBeGreaterThan(150);
  // (At the far left of the screen the limb comes within a degree or so of the day-night line: the
  // Sun is nowhere more than 6 degrees up, and nowhere up at all away from the limb.)
  for (const p of near.points) expect(p.cosSun, `the point of Earth at ${p.x}, ${p.y} is in daylight`).toBeLessThan(0.1);
  for (const p of face) expect(p.cosSun, `the point of Earth at ${p.x}, ${p.y} is on the day side`).toBeLessThan(0);
  const dark = await brightnessAt(page, face);
  // Dim, but not black: still readable as Earth.
  expect(median(dark)).toBeLessThan(0.07);
  expect(median(dark)).toBeGreaterThan(0.004);
  // No more than a few stray points (the leader line and Earth's own line cross the disc) are brighter.
  expect(dark.filter((b) => b > 0.12).length).toBeLessThan(face.length * 0.06);

  // The whole Earth: about 30 to 40 percent of the disc is lit, on its left, the Sun's side.
  await page.getByTestId('orbit-zoom').click();
  await expect(page.getByTestId('orbit-zoom')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1500);
  const far = earthOnScreen(g, width, height, 1);
  const day = far.points.filter((p) => p.cosSun > 0.35 && p.edge > 0.3);
  const night = far.points.filter((p) => p.cosSun < -0.25 && p.edge > 0.3);
  expect(day.length).toBeGreaterThan(8);
  expect(night.length).toBeGreaterThan(20);
  // The day side is the left of the disc: toward the Sun, which is to the left of the Moon here.
  for (const p of day) expect(p.x).toBeLessThan(far.disc.x);
  const dayLight = median(await brightnessAt(page, day));
  const nightLight = median(await brightnessAt(page, night));
  expect(dayLight).toBeGreaterThan(0.2);
  expect(nightLight).toBeLessThan(0.07);
  expect(dayLight).toBeGreaterThan(nightLight * 5);

  // The Moon is lit from the same side: its left half is bright and its right half dark.
  const moonAt = projectOrbit(0, 0, 0, orbitCameraLongitude(g.earthLon, 'left'), ORBIT_VIEW.elevation, orbitZoomDistance(orbitDistance(width, height, false), 1), width, height);
  const [moonLeft, moonRight] = await brightnessAt(page, [
    { x: moonAt.x - moonAt.scale * 0.55, y: moonAt.y - moonAt.scale * 0.45 },
    { x: moonAt.x + moonAt.scale * 0.55, y: moonAt.y - moonAt.scale * 0.45 },
  ]);
  expect(moonLeft).toBeGreaterThan(moonRight * 2.5);
});

// ---------- Earth's surface: NASA's map, the right copy for the device ----------

test('earth surface: the right copy of NASA’s map for this device, from the app itself, and the caption credits it and says what is not computed', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/textures/earth/')) asked.push(r.url());
  });
  await page.goto('/');
  await page.getByTestId('begin').click();
  const note = page.getByTestId('earth-surface-note');
  await expect(note).toHaveAttribute('data-surface', 'map', { timeout: 30_000 });
  await expect(note).toContainText('NASA');
  await expect(note).toContainText('Blue Marble map');
  await expect(note).toContainText('Stöckli');
  await expect(note).toContainText('turns once a day');
  await expect(note).toContainText('which face points at the Moon is not computed.');

  const origin = new URL(page.url()).origin;
  expect(asked.length).toBe(1);
  expect(new URL(asked[0]).origin).toBe(origin);
  // 2K on phones, 4K on desktop.
  expect(asked[0].endsWith(`earth-color-${isPhone(page) ? '2k' : '4k'}.jpg`)).toBe(true);
});

test('earth surface: when the map cannot be loaded the drawn surface stays and the caption says it is an illustration', async ({ page }) => {
  await page.route('**/textures/earth/**', (route) => route.abort());
  await page.goto('/');
  await page.getByTestId('begin').click();
  const note = page.getByTestId('earth-surface-note');
  await expect(note).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(note).toHaveAttribute('data-surface', 'drawn');
  await expect(note).toHaveText('Earth’s surface pattern is an illustration, not a map; it turns once a day, and which face points at the Moon is not computed.');
});

// ---------- The Sun is not a ball beside the Moon ----------

test('orbit: the Sun ring carries a tick and a tag with the Sun’s overhead longitude, and no glowing ball', async ({ page }) => {
  test.skip(isPhone(page), 'the picture arithmetic here is for the upright desktop picture');
  const { width, height } = page.viewportSize()!;
  await orbitAt(page, 45);
  const tag = page.locator('[data-marker="sun"]');
  await expect(tag).toHaveAttribute('data-visible', 'true');
  await expect(tag.locator('[data-marker-tag]')).toHaveText(/^Sun overhead\s*45\.99° E$/i);
  // The tag stands at the tick: on the Sun ring, in the ring's plane, at the Sun's overhead longitude.
  const g = { sunLon: await degrees(page, 'subsolar_lon'), earthLon: await degrees(page, 'subearth_lon') };
  const cameraLon = orbitCameraLongitude(g.earthLon, 'left');
  const distance = orbitDistance(width, height, false);
  const tick = projectOrbit(0, g.sunLon, 1.7, cameraLon, ORBIT_VIEW.elevation, distance, width, height);
  // (Polled: the tag takes a frame or two to follow the scrubber.)
  await expect.poll(async () => Math.hypot(Number(await tag.getAttribute('data-ax')) - tick.x, Number(await tag.getAttribute('data-ay')) - tick.y)).toBeLessThan(3);
  await page.waitForTimeout(800);
  // Where the ball and its glow used to be (just outside the tick, away from the Moon and the tag) the sky is dark.
  const out = { x: tick.x + (tick.x - width / 2) * 0.09, y: tick.y + (tick.y - height / 2) * 0.09 - 26 };
  const [sky] = await brightnessAt(page, [out], 6);
  expect(sky).toBeLessThan(0.2);
});
