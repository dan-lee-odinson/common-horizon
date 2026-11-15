import { expect, test, type Page } from '@playwright/test';
import { dragTurn, sunPlace, sunRadiusPx, turnedElevation } from '../src/scene/orbitTurn';
import { ORBIT_VIEW, hitBall, orbitCameraFrame, orbitCameraLongitude, orbitDistance, orbitRay, orbitZoomDistance, projectOrbit, projectOrbitPoint, worldPoint } from '../src/scene/orbitView';

// The Orbit picture itself, checked on the real screen: Earth's day side faces the Sun (the same
// direction that lights the Moon) and its night side is drawn dark; the Sun's own disc stands where
// its direction meets the picture; the view turns by drag and by arrow keys and "Reset view"
// returns it; and with the view turned, everything still keeps clear of the glass panels.
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

/**
 * The middle of the brightest thing near a point of the page: the centre of mass of the pixels
 * within `half` pixels of it that are nearly white. This is how the tests find where the Sun's
 * disc really is in the picture. Null when nothing there is that bright.
 */
async function brightCentre(page: Page, near: Sample, half = 40): Promise<{ x: number; y: number; pixels: number } | null> {
  const shot = await page.screenshot();
  return page.evaluate(
    async ({ b64, near, half }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const x0 = Math.round(near.x) - half;
      const y0 = Math.round(near.y) - half;
      const d = g.getImageData(x0, y0, half * 2 + 1, half * 2 + 1).data;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = 0; y <= half * 2; y++) {
        for (let x = 0; x <= half * 2; x++) {
          const i = (y * (half * 2 + 1) + x) * 4;
          const light = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          if (light < 0.8) continue;
          sx += x0 + x + 0.5;
          sy += y0 + y + 0.5;
          n++;
        }
      }
      return n ? { x: sx / n, y: sy / n, pixels: n } : null;
    },
    { b64: shot.toString('base64'), near, half },
  );
}

/**
 * Waits for the picture to be drawn a number of times. The test browser draws the 3D scene in
 * software, a few frames a second, and a change takes a few frames to reach the tags (the camera
 * moves in one frame, the scene measures in the next, the HUD writes in the one after).
 */
async function frames(page: Page, count = 6) {
  await page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        const step = (left: number) => (left <= 0 ? done() : requestAnimationFrame(() => step(left - 1)));
        step(n);
      }),
    count,
  );
}

/** Opens Orbit with the preview held at a number of hours after the landing, the camera at rest. */
async function orbitAt(page: Page, hours: number) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByTestId('begin').click();
  await expect.poll(() => readout(page, 'subsolar_lon'), { timeout: 30_000 }).toMatch(/^\d/);
  await page.getByTestId('preview-scrub').fill(String(hours));
  // The pointer rests clear of Earth and of every control.
  await page.mouse.move(720, 470);
  await frames(page);
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

// ---------- Turning the view ----------

/** How far the view is turned, as the page reports it (degrees of longitude and of elevation). */
async function turn(page: Page): Promise<{ lon: number; lat: number }> {
  const hud = page.getByTestId('orbit-hud');
  return { lon: Number(await hud.getAttribute('data-turn-lon')), lat: Number(await hud.getAttribute('data-turn-lat')) };
}

/** Presses a key a number of times, with the keyboard on the page itself (not on the preview scrubber). */
async function press(page: Page, key: string, times = 1) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
}

/** Waits until the view is turned by exactly this much and the picture has caught up. */
async function turnedTo(page: Page, lon: number, lat: number) {
  await expect.poll(() => turn(page)).toEqual({ lon, lat });
  await frames(page);
}

async function markerAt(page: Page, name: string): Promise<{ x: number; y: number; r: number; visible: boolean }> {
  const m = page.locator(`[data-marker="${name}"]`);
  return { x: Number(await m.getAttribute('data-ax')), y: Number(await m.getAttribute('data-ay')), r: Number(await m.getAttribute('data-ar')), visible: (await m.getAttribute('data-visible')) === 'true' };
}

test('orbit: dragging turns the view and it stays turned, the arrow keys turn it too, and Reset view returns to the standard view', async ({ page }) => {
  const { width, height } = page.viewportSize()!;
  await orbitAt(page, 45);
  const reset = page.getByTestId('orbit-reset-view');
  await turnedTo(page, 0, 0);
  await expect(reset).toBeHidden();
  const before = await markerAt(page, 'earthLimb');

  // Drag the picture: with the mouse on desktop, with one finger on the phone.
  const from = { x: width / 2, y: isPhone(page) ? height * 0.52 : 150 };
  const by = { x: 120, y: 40 };
  if (isPhone(page)) {
    await page.evaluate(
      ({ from, by }) => {
        const canvas = document.querySelector('canvas')!;
        const fire = (type: string, x: number, y: number) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        fire('pointerdown', from.x, from.y);
        for (let i = 1; i <= 8; i++) fire('pointermove', from.x + (by.x * i) / 8, from.y + (by.y * i) / 8);
        fire('pointerup', from.x + by.x, from.y + by.y);
      },
      { from, by },
    );
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 8 });
    await page.mouse.up();
  }
  // The picture follows the pointer: right carries the camera west, down raises it. (The phone picture is rolled 48 degrees.)
  const want = dragTurn({ lon: 0, lat: 0 }, by.x, by.y, isPhone(page) ? (48 * Math.PI) / 180 : 0);
  await expect.poll(async () => Math.abs((await turn(page)).lon - want.lon) + Math.abs((await turn(page)).lat - want.lat)).toBeLessThan(0.11);
  if (!isPhone(page)) expect(await turn(page)).toEqual({ lon: -36, lat: 12 });
  // Released, the view stays where it was left, and the way back is offered.
  await frames(page);
  const held = await turn(page);
  expect(Math.abs(held.lon - want.lon) + Math.abs(held.lat - want.lat)).toBeLessThan(0.11);
  await expect(reset).toBeVisible();
  if (!isPhone(page)) expect((await markerAt(page, 'earthLimb')).x).not.toBe(before.x);

  // The arrow keys turn it too: 3 degrees a press, 15 with Shift.
  await press(page, 'ArrowRight', 2);
  await press(page, 'ArrowUp');
  await expect.poll(async () => (await turn(page)).lon - held.lon).toBeCloseTo(6, 1);
  await expect.poll(async () => (await turn(page)).lat - held.lat).toBeCloseTo(3, 1);
  await press(page, 'Shift+ArrowLeft');
  await expect.poll(async () => (await turn(page)).lon - held.lon).toBeCloseTo(6 - 15, 1);
  // On the preview scrubber the arrow keys still belong to the scrubber.
  const scrub = page.getByTestId('preview-scrub');
  const utc = await readout(page, 'utc');
  const turned = await turn(page);
  await scrub.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => readout(page, 'utc')).not.toBe(utc);
  expect(await turn(page)).toEqual(turned);
  await scrub.fill('45');

  // Reset view: back to the standard view, and the control goes away.
  await reset.click();
  await turnedTo(page, 0, 0);
  await expect(reset).toBeHidden();
  if (!isPhone(page)) {
    await expect.poll(async () => Math.hypot((await markerAt(page, 'earthLimb')).x - before.x, (await markerAt(page, 'earthLimb')).y - before.y)).toBeLessThan(2);
  }
});

test('orbit: the Sun’s disc stands where its direction meets the picture, 0.53 degrees across; the Moon hides it; the edge glow shows only while the Sun is outside the frame', async ({ page }) => {
  test.skip(isPhone(page), 'the picture arithmetic here is for the upright desktop picture');
  const { width, height } = page.viewportSize()!;
  await orbitAt(page, 45);
  const glow = page.getByTestId('sun-edge-glow');
  const disc = page.locator('[data-marker="sunDisc"]');
  const g = { sunLat: await degrees(page, 'subsolar_lat'), sunLon: await degrees(page, 'subsolar_lon'), earthLon: await degrees(page, 'subearth_lon') };
  const sun = worldPoint(g.sunLat, g.sunLon, 1);
  const distance = orbitDistance(width, height, false);
  /** Where the arithmetic puts the Sun's disc for a turn of the view. */
  const sunAt = (lon: number, lat: number) => {
    const cameraLon = orbitCameraLongitude(g.earthLon, 'left', lon);
    const elevation = turnedElevation(lat);
    return projectOrbitPoint(sunPlace(orbitCameraFrame(cameraLon, elevation, distance).position, sun), cameraLon, elevation, distance, width, height);
  };

  // The standard view: the Sun is outside the frame, so the glow at the frame's edge shows and there is no Sun tag.
  await expect(glow).toHaveAttribute('data-visible', 'true');
  await expect(disc).toHaveAttribute('data-visible', 'false');

  // Turn the camera a quarter of the way round and down to 12 degrees above the ring plane: the
  // Moon's night side faces the camera and the Sun stands 3 degrees clear of its top edge. (The
  // Moon is 8.3 degrees in radius from here; at 9 degrees up the Sun would be half behind its edge.)
  await press(page, 'Shift+ArrowRight', 6);
  await press(page, 'Shift+ArrowDown', 1);
  await press(page, 'ArrowDown', 1);
  await turnedTo(page, 90, -18);
  const rising = sunAt(90, -18);
  expect(rising.x).toBeGreaterThan(width / 2 - 40);
  expect(rising.x).toBeLessThan(width / 2 + 40);
  await expect(disc).toHaveAttribute('data-visible', 'true');
  // The disc's place on screen is the projection of the Sun's direction.
  await expect.poll(async () => Math.hypot((await markerAt(page, 'sunDisc')).x - rising.x, (await markerAt(page, 'sunDisc')).y - rising.y)).toBeLessThan(2.5);
  await expect(disc.locator('[data-marker-tag]')).toHaveText('Sun');
  // True apparent size: 0.53 degrees across is about 14 pixels in this picture.
  expect(Math.abs((await markerAt(page, 'sunDisc')).r - sunRadiusPx(height))).toBeLessThan(0.6);
  expect(sunRadiusPx(height) * 2).toBeGreaterThan(13);
  expect(sunRadiusPx(height) * 2).toBeLessThan(15);
  // The picture agrees. The disc itself (the nearly white pixels, found in the screenshot) is centred
  // on the projection of the Sun's direction, and it is about as big as a disc 0.53 degrees across.
  const seen = await brightCentre(page, rising);
  expect(seen, 'no bright disc where the Sun should be').not.toBeNull();
  expect(Math.hypot(seen!.x - rising.x, seen!.y - rising.y)).toBeLessThan(2);
  const discArea = Math.PI * sunRadiusPx(height) ** 2;
  expect(seen!.pixels).toBeGreaterThan(discArea * 0.5);
  expect(seen!.pixels).toBeLessThan(discArea * 1.6);
  // The glow two disc widths away is plainly dimmer: the glow is not the disc.
  const [centre, glowOnly] = await brightnessAt(page, [rising, { x: rising.x + sunRadiusPx(height) * 4, y: rising.y - 4 }], 1);
  expect(centre).toBeGreaterThan(glowOnly + 0.15);

  // A second pose, with the Sun well off to the left of the Moon and the camera in the ring plane:
  // here a disc placed from the Moon's centre instead of from the camera would be 9 pixels out.
  await press(page, 'Shift+ArrowLeft', 1);
  await press(page, 'ArrowDown', 4);
  await turnedTo(page, 75, -30);
  const aside = sunAt(75, -30);
  expect(aside.x).toBeLessThan(width / 2 - 300);
  await expect(disc).toHaveAttribute('data-visible', 'true');
  await expect.poll(async () => Math.hypot((await markerAt(page, 'sunDisc')).x - aside.x, (await markerAt(page, 'sunDisc')).y - aside.y)).toBeLessThan(2.5);
  const seenAside = await brightCentre(page, aside);
  expect(seenAside, 'no bright disc where the Sun should be').not.toBeNull();
  expect(Math.hypot(seenAside!.x - aside.x, seenAside!.y - aside.y)).toBeLessThan(2);
  await expect(glow).toHaveAttribute('data-visible', 'false');
  await expect(disc.locator('[data-marker-tag]')).toHaveText('Sun');
  // With the Sun in the frame the disc shows, and the glow at the frame's edge does not.
  await expect(glow).toHaveAttribute('data-visible', 'false');

  // Straight behind the Moon: the Moon is now in front of the Sun.
  await press(page, 'Shift+ArrowRight', 1);
  await turnedTo(page, 90, -30);
  await expect(disc.locator('[data-marker-tag]')).toHaveText('Sun (behind the Moon)');
  const hidden = sunAt(90, -30);
  await expect.poll(async () => Math.hypot((await markerAt(page, 'sunDisc')).x - hidden.x, (await markerAt(page, 'sunDisc')).y - hidden.y)).toBeLessThan(2.5);
  // The picture agrees: where the Sun would be, the Moon's dark face.
  const [covered] = await brightnessAt(page, [hidden], 1);
  expect(covered).toBeLessThan(0.3);
  expect(await brightCentre(page, hidden, 20)).toBeNull();
  // The Sun is still inside the frame (behind the Moon), so there is still no glow at the frame's edge.
  await expect(glow).toHaveAttribute('data-visible', 'false');

  // Back to the standard view: the Sun is out of the frame again, and the edge glow returns.
  await page.getByTestId('orbit-reset-view').click();
  await turnedTo(page, 0, 0);
  await expect(glow).toHaveAttribute('data-visible', 'true');
  await expect(disc).toHaveAttribute('data-visible', 'false');
});

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlap = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Does the straight line from (x1, y1) to (x2, y2) pass through a box? */
function crosses(seg: { x1: number; y1: number; x2: number; y2: number }, b: Box): boolean {
  let lo = 0;
  let hi = 1;
  for (const [p, d, min, max] of [
    [seg.x1, seg.x2 - seg.x1, b.left, b.right],
    [seg.y1, seg.y2 - seg.y1, b.top, b.bottom],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (p <= min || p >= max) return false;
      continue;
    }
    const a = (min - p) / d;
    const c = (max - p) / d;
    lo = Math.max(lo, Math.min(a, c));
    hi = Math.min(hi, Math.max(a, c));
  }
  return hi > lo;
}

test('orbit: with the view turned all the way round, tags, the lines of sunlight and the edge glow still never touch a glass panel, and Earth never stands in front of the Moon', async ({ page }) => {
  test.skip(isPhone(page), 'on phones the panels are two short cards above the scene');
  test.setTimeout(240_000);
  const { width, height } = page.viewportSize()!;
  await orbitAt(page, 45);
  await turnedTo(page, 0, 0);
  let sunTags = 0;
  let earthGone = 0;
  let earthShown = 0;
  // Twice round the Moon in steps of 30 degrees: at the standard height, and down at the ring plane.
  for (const lat of [0, -30]) {
    if (lat !== 0) await press(page, 'Shift+ArrowDown', 2);
    for (let step = 1; step <= 12; step++) {
      await press(page, 'Shift+ArrowRight', 2);
      await turnedTo(page, (lat === 0 ? 0 : 360) + step * 30, lat);
      const state = await page.evaluate(() => {
        const box = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        const panels = Array.from(document.querySelectorAll('[data-panel]')).map(box);
        const tags = Array.from(document.querySelectorAll<HTMLElement>('[data-marker]'))
          .filter((m) => m.dataset.visible === 'true')
          .map((m) => ({ name: m.dataset.marker!, tag: box(m.querySelector('[data-marker-tag]')!) }));
        const svg = document.querySelector('[data-testid="sunlight-lines"]')!;
        const origin = svg.getBoundingClientRect();
        const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
        for (const path of Array.from(svg.querySelectorAll('path'))) {
          if (Number(getComputedStyle(path).opacity) < 0.02) continue;
          for (const m of (path.getAttribute('d') ?? '').matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)) lines.push({ x1: Number(m[1]) + origin.left, y1: Number(m[2]) + origin.top, x2: Number(m[3]) + origin.left, y2: Number(m[4]) + origin.top });
        }
        const glowNode = document.querySelector<HTMLElement>('[data-testid="sun-edge-glow"]')!;
        return { panels, tags, lines, glow: glowNode.dataset.visible === 'true' ? box(glowNode) : null };
      });
      const where = `turned ${step * 30} degrees east, ${lat} degrees up`;
      expect(state.panels.length).toBeGreaterThanOrEqual(4);
      for (const p of state.panels) {
        for (const t of state.tags) expect(overlap(t.tag, p), `the ${t.name} tag overlaps a panel, ${where}`).toBe(false);
        for (const line of state.lines) expect(crosses(line, p), `a line of sunlight crosses a panel, ${where}`).toBe(false);
        if (state.glow) expect(overlap(state.glow, p), `the edge glow overlaps a panel, ${where}`).toBe(false);
      }
      if (state.tags.some((t) => t.name === 'sunDisc')) sunTags++;
      if (state.tags.some((t) => t.name === 'earthLimb')) earthShown++;
      else earthGone++;
    }
  }
  // The round trip met both: views with the Sun's tag in the picture, and views from Earth's side of the Moon.
  expect(sunTags).toBeGreaterThan(0);
  expect(earthShown).toBeGreaterThan(2);
  expect(earthGone).toBeGreaterThan(2);

  // From Earth's own side of the Moon (the camera over the point Earth is overhead): Earth is not
  // drawn, and the Moon's lit near side is in plain view.
  await page.getByTestId('orbit-reset-view').click();
  await turnedTo(page, 0, 0);
  await press(page, 'Shift+ArrowLeft', 9);
  await press(page, 'ArrowLeft', 2);
  await press(page, 'Shift+ArrowDown', 2);
  await turnedTo(page, -141, -30);
  await expect(page.locator('[data-marker="earthLimb"]')).toHaveAttribute('data-visible', 'false');
  const moon = await brightnessAt(page, [
    { x: width / 2 + 60, y: height / 2 - 60 },
    { x: width / 2 - 60, y: height / 2 + 60 },
    { x: width / 2 + 90, y: height / 2 + 40 },
  ]);
  for (const b of moon) expect(b).toBeGreaterThan(0.22);

  // Zoomed all the way out from that side, Earth (drawn 11.5 Moon radii away) would stand right
  // between the camera and the Moon. It is not drawn: no Earth tag, and the Moon is still there to see.
  await page.getByTestId('orbit-zoom').click();
  await expect(page.getByTestId('orbit-zoom')).toHaveAttribute('aria-pressed', 'true');
  await frames(page, 8);
  await expect(page.locator('[data-marker="earthLimb"]')).toHaveAttribute('data-visible', 'false');
  // The Moon is small now (about 59 pixels in radius), lit on its right and in plain view: there
  // is bright ground at its middle and black sky a little way outside it, where Earth's disc
  // (about 170 pixels in radius here) would otherwise be.
  const far = await brightnessAt(page, [
    { x: width / 2 + 25, y: height / 2 - 10 },
    { x: width / 2 + 5, y: height / 2 - 120 },
    { x: width / 2 - 110, y: height / 2 - 90 },
  ]);
  expect(far[0]).toBeGreaterThan(0.2);
  expect(far[1]).toBeLessThan(0.08);
  expect(far[2]).toBeLessThan(0.08);
});

test('orbit: the slow sway pauses while the view is turned and resumes after Reset view', async ({ page }) => {
  test.skip(isPhone(page), 'read from Earth’s tag, which the phone cards cover');
  test.setTimeout(90_000);
  // Ordinary motion: the camera sways a few degrees either side of its place.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.getByTestId('begin').click();
  await expect.poll(() => readout(page, 'subsolar_lon'), { timeout: 30_000 }).toMatch(/^\d/);
  await page.getByTestId('preview-toggle').click();
  await page.mouse.move(720, 470);
  await page.waitForTimeout(3500);
  /** How far Earth's tag moves on screen in three seconds. */
  const drift = async () => {
    const a = await markerAt(page, 'earthLimb');
    await page.waitForTimeout(3000);
    const b = await markerAt(page, 'earthLimb');
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  expect(await drift()).toBeGreaterThanOrEqual(2);
  // Turned (one press of an arrow key is enough): once the picture has caught up, it holds still.
  await press(page, 'ArrowRight');
  await expect.poll(() => turn(page)).toEqual({ lon: 3, lat: 0 });
  await page.waitForTimeout(1500);
  await frames(page);
  expect(await drift()).toBe(0);
  // Reset view: the sway picks up again.
  await page.getByTestId('orbit-reset-view').click();
  await expect.poll(() => turn(page)).toEqual({ lon: 0, lat: 0 });
  await page.waitForTimeout(2000);
  expect(await drift()).toBeGreaterThanOrEqual(1);
});
