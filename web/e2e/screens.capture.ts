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
  await page.goto('/');
  await page.getByTestId('begin').click();
  await page.getByTestId('enter-mission').click();
  await page.getByTestId('spotlight-name').waitFor();
  // A week's delay: the ranking has reordered and the rows show how far each site moved.
  await page.getByTestId('slip').fill('7');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${DIR}/stage-2-mission-select-${size}.png` });
  if (size === '1440x900') {
    await page.getByTestId('drawer-toggle').click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${DIR}/stage-2-drawer-${size}.png` });
  }
});
