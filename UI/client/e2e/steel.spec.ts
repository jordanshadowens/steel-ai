import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// P900 steel regression through the Runner UI: the known fictitious input
// retains ~38.16768 tons, ~$240,897.77 customer price, and the 8% markup /
// ~7.4074% margin relationship. Test assertions only — no UI production
// code computes, defaults, or hardcodes these values.
const scope = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'p900-scope.json'), 'utf8');

test('p900 steel regression holds end to end', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/app/index.html#/runner');
  await page.locator('#runner-workflow').selectOption('steel_customer_estimate');
  await expect(page.getByLabel('Published version')).toBeVisible();
  await page.getByLabel(/^scope/).fill(scope);
  await page.getByRole('button', { name: 'Review inputs' }).click();
  await page.getByRole('button', { name: 'Start run' }).click();
  // The estimate pauses at its human approval step; approve to continue.
  await page.getByRole('region', { name: 'Execution' }).getByRole('button', { name: 'Approve' }).click({ timeout: 120000 });
  await expect(page.getByText(/— sealed/)).toBeVisible({ timeout: 210000 });
  await expect(page.getByRole('cell', { name: /38\.16768/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /240897\.772241/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /7\.40740740742/ })).toBeVisible();
});
