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
