import { expect, test } from '@playwright/test';

// Narrow-screen pass: the list/form designer path stays usable at 360px.
test.use({ viewport: { width: 360, height: 800 } });

test('designer works at 360px width', async ({ page }) => {
  await page.goto('/app/index.html#/designer');
  await expect(page.getByRole('button', { name: 'Data Designer' }).first()).toBeVisible();
  for (const tab of ['Schema', 'Canvas', 'Records', 'Publish', 'Import / Export']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
  }
  // No horizontal overflow on the narrow layout.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // Canvas tab loads its toolbar instead of a blank card.
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(page.getByLabel('Search types')).toBeVisible();
});
