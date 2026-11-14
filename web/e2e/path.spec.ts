import { expect, test, type Page } from '@playwright/test';

// The main path through the website, on example data (mock mode):
// load -> pick hardware -> the ranked list appears -> move the slip and the rows reorder
// -> open a site -> go back. Then four checks from the first round of polish: battery storage
// against a site's darkness, the assistant's floating conversation, "Zoom in to this site", and
// zooming out to Earth and the Sun. Every test runs at a desktop width and at a phone width.

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
  // The Sites pane is part of the site scene too (a floating pane on desktop, a drawer on phones).
  if (!phone) await expect(page.getByTestId('sites-pane')).toBeVisible();
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

// ---------- Battery storage: the night check names itself and passes once storage covers the dark ----------

/** Phones keep the planner in a drawer; run `fn` with it open. */
async function inPlanner(page: Page, fn: () => Promise<void>) {
  if (isPhone(page)) await page.getByRole('button', { name: 'Planner' }).click();
  await fn();
  if (isPhone(page)) await page.getByRole('button', { name: 'Close the planner' }).click();
}

/** Show the site markers and pick a preset site (phones: through the Sites drawer). */
async function pickPreset(page: Page, siteId: string) {
  await page.getByTestId('show-sites').click();
  if (isPhone(page)) await page.getByRole('button', { name: 'Sites', exact: true }).click();
  await page.getByRole('combobox', { name: /Preset sites/ }).selectOption(siteId);
  if (isPhone(page)) await page.getByRole('button', { name: 'Close sites' }).click();
}

test('power: a solar-only plan fails at night, then passes with enough battery storage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  await inPlanner(page, async () => {
    await page.getByLabel('Starship lander').check();
    await page.getByRole('checkbox', { name: /^Solar panels/ }).check();
    await expect(page.getByTestId('storage-row')).toBeVisible();
  });
  // Blue Ghost Mission 1: a long darkness in the default 14-day stay.
  await pickPreset(page, 'blue-ghost-m1');

  await inPlanner(page, async () => {
    const power = page.getByTestId('power-number');
    await expect(power).toHaveAttribute('data-level', 'short');
    await expect(power).toHaveAttribute('data-limiting', 'night');
    await expect(page.getByTestId('power-words')).toHaveText('power short at night');
    await expect(page.getByTestId('night-advice')).toContainText('Add battery storage or a nuclear generator to cover the dark hours.');
    const needed = page.getByTestId('storage-needed');
    await expect(needed).toContainText(/of storage would cover this site['’]s darkness/);
    const kwh = Number(await needed.getAttribute('data-kwh'));
    expect(kwh).toBeGreaterThan(0);

    // Type the storage the planner asks for: the night check passes.
    await page.getByLabel('Battery storage').fill(String(kwh));
    await expect(power).not.toHaveAttribute('data-level', 'short');
    await expect(power).toHaveAttribute('data-level', /good|thin/);
    await expect(page.getByTestId('night-advice')).toHaveCount(0);

    // The other way: no storage, the nuclear generator instead.
    await page.getByLabel('Battery storage').fill('');
    await expect(power).toHaveAttribute('data-level', 'short');
    await page.getByLabel('Nuclear generator').check();
    await expect(power).toHaveAttribute('data-level', 'good');
  });
  expect(errors).toEqual([]);
});

// ---------- The assistant's conversation floats over the scene ----------

async function sceneBox(page: Page) {
  const workspace = await page.getByTestId('workspace').boundingBox();
  const canvas = await page.locator('[data-testid="moon-scene"] canvas').boundingBox();
  return { workspace, canvas };
}

test('chat: opening the conversation does not move or resize the scene behind it', async ({ page }) => {
  await page.goto('/');
  // Wait until the 3D canvas has sized itself to the workspace (it starts at the browser's 300 x 150).
  await expect
    .poll(async () => {
      const { workspace, canvas } = await sceneBox(page);
      return Boolean(workspace && canvas && Math.abs(canvas.width - workspace.width) < 1 && Math.abs(canvas.height - workspace.height) < 1);
    })
    .toBe(true);
  const before = await sceneBox(page);
  const box = page.getByRole('textbox', { name: 'Ask the assistant' });

  const questions = ['Why does the slip matter?', 'What about power at night and batteries?', 'How does Earth contact work?'];
  for (const [i, q] of questions.entries()) {
    await box.fill(q);
    await box.press('Enter');
    await expect(page.getByTestId('chat-log').locator('[data-state="answer"]')).toHaveCount(i + 1);
    expect(await sceneBox(page)).toEqual(before);
  }

  // The panel sits on top of the question bar, shows several rows and stays within 40 % of the window.
  const panel = page.getByTestId('chat-panel');
  await expect(panel).toBeVisible();
  const p = (await panel.boundingBox())!;
  const bar = (await page.getByTestId('assistant').boundingBox())!;
  expect(Math.abs(p.y + p.height - bar.y)).toBeLessThanOrEqual(2);
  const viewport = page.viewportSize()!;
  expect(p.height).toBeLessThanOrEqual(viewport.height * 0.4 + 1);
  const log = await page.getByTestId('chat-log').evaluate((e) => ({ height: e.clientHeight, line: parseFloat(getComputedStyle(e).lineHeight) }));
  expect(log.height).toBeGreaterThanOrEqual(6 * log.line);
  await expect(page.getByTestId('chat-announcer')).toContainText('Earth link depends');

  // Escape hides it, the button shows it again, Clear empties it: the scene never moves.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  expect(await sceneBox(page)).toEqual(before);
  await page.getByTestId('chat-expand').click();
  await expect(panel).toBeVisible();
  await page.getByTestId('chat-clear').click();
  await expect(page.getByTestId('chat-panel')).toHaveCount(0);
  expect(await sceneBox(page)).toEqual(before);
});

// ---------- "Zoom in to this site" ----------

test('zoom: "Zoom in to this site" flies to the site scene, and Back to Moon flies out', async ({ page }) => {
  await page.goto('/');
  await inPlanner(page, () => page.getByLabel('Starship lander').check());
  await page.getByTestId('show-sites').click();
  if (isPhone(page)) await page.getByRole('button', { name: 'Sites', exact: true }).click();
  await page.getByRole('combobox', { name: /Preset sites/ }).selectOption('apollo-15');

  // The selected-site card's main action.
  const zoom = page.getByTestId('zoom-to-site');
  await expect(zoom).toHaveText('Zoom in to this site');
  await zoom.click();
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-flight', 'in');
  await expect(page.getByTestId('back-to-moon')).toBeVisible();
  await expect(page.getByTestId('scene-title')).toHaveText('Apollo 15');
  await expect(page.getByTestId('site-scene')).toBeVisible();

  // Back to Moon reverses it, and the same action waits beside the site's label on the Moon.
  await page.getByTestId('back-to-moon').click();
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-flight', 'out');
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-flight', '');
  const onLabel = page.getByTestId('zoom-to-site-label');
  await expect(onLabel).toBeVisible();

  // With reduced motion the switch is instant: no flight.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await onLabel.click();
  await expect(page.getByTestId('back-to-moon')).toBeVisible();
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-flight', '');
});

// ---------- Earth and the Sun in the Moon view ----------

test('moon view: zooming out with the wheel brings Earth into view, and back in to the Moon', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('[data-testid="moon-scene"] canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('not-to-scale')).toContainText('sizes and distances not to scale');
  const earth = page.getByTestId('edge-arrow-earth');
  await expect(earth).toHaveAttribute('data-in-view', 'false');

  const c = (await canvas.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  for (let i = 0; i < 15 && (await earth.getAttribute('data-in-view')) !== 'true'; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(250);
  }
  await expect(earth).toHaveAttribute('data-in-view', 'true');
  await expect(page.getByTestId('space-label-earth')).toBeVisible();

  for (let i = 0; i < 15 && (await earth.getAttribute('data-in-view')) !== 'false'; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(250);
  }
  await expect(earth).toHaveAttribute('data-in-view', 'false');
});
