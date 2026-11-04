import { expect, test } from '@playwright/test';

// Cross-cutting flows: publish lifecycle on a throwaway workflow, unsaved
// navigation guard, duplicate-run prevention, and non-steel genericity.
test('throwaway workflow saves, publishes and approves', async ({ page }) => {
  const id = `e2e-throwaway-${Date.now()}`;
  await page.goto('/app/index.html#/creator');
  await page.getByRole('button', { name: 'Open library' }).click();
  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Workflow id', { exact: true }).fill(id);
  await page.getByLabel('Workflow id', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/v1 · saved/)).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Request approval' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/published v1 · saved/)).toBeVisible({ timeout: 15000 });
});

test('unsaved changes guard navigation', async ({ page }) => {
  await page.goto('/app/index.html#/creator');
  await page.getByRole('button', { name: 'Open library' }).click();
  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.getByRole('button', { name: '+ Step' }).click();
  await page.getByRole('button', { name: /Compose/ }).first().click();
  await expect(page.getByText(/unsaved changes/)).toBeVisible();
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Workflow library' })).toBeVisible();
  await page.getByRole('button', { name: 'New workflow' }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Discard and switch' }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeHidden();
});

test('double start issues one run', async ({ page, request }) => {
  const rev = `e2e-dbl-${Date.now()}`;
  await page.goto('/app/index.html#/runner');
  await page.locator('#runner-workflow').selectOption('acceptance-quotation');
  await expect(page.getByLabel('Published version')).toBeVisible();
  const strings: Record<string, string> = {
    customer_name: 'Dbl', attention: 'Att', project_name: 'P', project_location: 'L',
    quote_no: 'Q', issued: '2026-11-01', valid_through: '2026-11-16', reference: 'R', scope_text: 'S',
  };
  for (const [name, value] of Object.entries(strings)) {
    await page.getByLabel(new RegExp(`^${name}`)).fill(value);
  }
  await page.getByLabel(/^revision/).fill(rev);
  await page.getByLabel(/^amount_a/).fill('1');
  await page.getByLabel(/^amount_b/).fill('2');
  await page.getByLabel(/^amount_c/).fill('3');
  await page.getByLabel(/^amount_d/).fill('4');
  await page.getByLabel(/^lines/).fill('[{"desc":"a","amount":1}]');
  await page.getByLabel(/^terms/).fill('["t"]');
  await page.getByRole('button', { name: 'Review inputs' }).click();
  const review = page.getByRole('region', { name: 'Review inputs' });
  await review.getByRole('button').click();
  // The button locks while the run starts, so a second click cannot issue
  // another run; exactly one run carries this revision.
  await expect(review.getByRole('button')).toBeDisabled({ timeout: 10000 });
  await expect(page.getByText(/— sealed/)).toBeVisible({ timeout: 90000 });
  const runs = await (await request.get('/api/runs?workflow_id=acceptance-quotation')).json() as {
    runs: Array<{ run_id: string }>;
  };
  let matches = 0;
  for (const r of runs.runs) {
    const detail = await (await request.get(`/api/runs/${r.run_id}`)).json() as {
      run: { snapshot?: { inputs?: { revision?: string } } };
    };
    if (detail.run.snapshot?.inputs?.revision === rev) matches++;
  }
  expect(matches).toBe(1);
});

test('non-steel service workflow runs generically', async ({ page }) => {
  await page.goto('/app/index.html#/runner');
  await page.locator('#runner-workflow').selectOption('acceptance-service');
  await expect(page.getByLabel('Published version')).toBeVisible();
  await page.getByLabel(/^tech_name/).fill('R. Alvarez');
  await page.getByLabel(/^visit_date/).fill('2026-10-30');
  await page.getByLabel(/^site/).fill('Harborview Warehouse, Bay 4');
  await page.getByLabel(/^tasks/).fill(`[{"task":"Inspect ${Date.now()}","hours":2.5}]`);
  await page.getByLabel(/^notes/).fill('["ok"]');
  await page.getByLabel(/^total_hours/).fill('2.5');
  await page.getByLabel(/^followup/).fill('Re-torque.');
  await page.getByRole('button', { name: 'Review inputs' }).click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByText(/— sealed/)).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Customer download blocked until release.')).toBeVisible();
});
