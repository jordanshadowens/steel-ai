import { expect, test } from '@playwright/test';

// Runner flow on the isolated acceptance-quotation test workflow: fill all
// 16 inputs (no pasted JSON for scalars; arrays use the advanced fallback),
// review, execute to sealed, see structured outputs and a draft document
// with customer download still blocked. Never releases.
test('runner executes to a draft document', async ({ page }) => {
  await page.goto('/app/index.html#/runner');
  await page.locator('#runner-workflow').selectOption('acceptance-quotation');
  await expect(page.getByLabel('Published version')).toBeVisible();

  const strings: Record<string, string> = {
    customer_name: 'Lakeview Development Group',
    attention: 'Project Estimating Team',
    project_name: 'Riverside Distribution Annex',
    project_location: 'Atlanta, Georgia',
    quote_no: 'QT-2026-1042',
    revision: `e2e-${Date.now()}`,
    issued: '2026-11-01',
    valid_through: '2026-11-16',
    reference: 'IFB / Structural Package',
    scope_text: 'Supply and fabricate approximately 42 US short tons of structural steel.',
  };
  for (const [name, value] of Object.entries(strings)) {
    await page.getByLabel(new RegExp(`^${name}`)).fill(value);
  }
  await page.getByLabel(/^amount_a/).fill('155000');
  await page.getByLabel(/^amount_b/).fill('16500');
  await page.getByLabel(/^amount_c/).fill('8500');
  await page.getByLabel(/^amount_d/).fill('68174');
  await page.getByLabel(/^lines/).fill(JSON.stringify([
    { desc: 'Steel package', amount: 155000 },
    { desc: 'Coatings', amount: 16500 },
    { desc: 'Freight', amount: 8500 },
    { desc: 'Erection', amount: 68174 },
  ]));
  await page.getByLabel(/^terms/).fill(JSON.stringify(['Term one.', 'Term two.']));

  await page.getByRole('button', { name: 'Review inputs' }).click();
  await expect(page.getByRole('heading', { name: '3. Review and start' })).toBeVisible();
  await page.getByRole('button', { name: 'Start run' }).click();

  await expect(page.getByText(/— sealed/)).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('cell', { name: '248174' })).toBeVisible();
  await expect(page.getByText('Customer download blocked until release.')).toBeVisible();
  await page.screenshot({ path: '../docs/architecture/phase6_e2e/runner-sealed.png' });

  // History shows the persisted run; opening it never reruns.
  await page.getByRole('heading', { name: 'Run history' }).scrollIntoViewIfNeeded();
  const rows = page.locator('.list-card .list-row');
  await expect(rows.first()).toBeVisible();
});

test('runner validates inputs before running', async ({ page }) => {
  await page.goto('/app/index.html#/runner');
  await page.locator('#runner-workflow').selectOption('acceptance-quotation');
  await expect(page.getByLabel('Published version')).toBeVisible();
  await page.getByRole('button', { name: 'Review inputs' }).click();
  await expect(page.getByText('is required').first()).toBeVisible();
});

