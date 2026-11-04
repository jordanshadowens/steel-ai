import { expect, test } from '@playwright/test';

// Templates flow on acceptance-quotation: open, edit (unsaved), validate
// to 13 slots, then render a labeled sample preview from explicit example
// values. Saves nothing; publishes nothing.
test('templates validate and render a sample preview', async ({ page }) => {
  await page.goto('/app/index.html#/templates');
  await page.getByRole('button', { name: 'Structural Steel Quotation' }).click();
  await expect(page.getByRole('heading', { name: 'Sections and styles' })).toBeVisible();

  await page.getByLabel('Title', { exact: true }).fill('Sample Title Edit');
  await page.getByLabel('Title', { exact: true }).press('Tab');
  await expect(page.getByText(/unsaved changes/)).toBeVisible();

  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByText('Valid. 13 data slots.')).toBeVisible();

  const samples: Record<string, string> = {
    'customer.attention': 'Estimating',
    'customer.name': 'Lakeview',
    'doc.issued': '2026-11-01',
    'doc.quote_no': 'QT-1',
    'doc.reference': 'IFB',
    'doc.revision': '01',
    'doc.valid_through': '2026-11-16',
    lines: '[{"desc":"Steel","amount":100}]',
    'project.location': 'Atlanta',
    'project.name': 'Annex',
    'scope.text': 'Supply steel.',
    terms: '["Term one."]',
    'totals.price': '248174',
  };
  for (const [slot, value] of Object.entries(samples)) {
    await page.getByLabel(slot, { exact: true }).fill(value);
  }
  const previewResponse = page.waitForResponse(
    (r) => r.url().includes('/api/templates/preview') && r.status() === 200,
    { timeout: 120000 },
  );
  await page.getByRole('button', { name: 'Render sample preview' }).click();
  const resp = await previewResponse;
  expect(resp.headers()['content-type']).toContain('application/pdf');
  expect(resp.headers()['x-steel-sample']).toBe('true');
  await expect(page.locator('iframe[title="Sample template preview"]')).toBeVisible();
  await expect(page.getByText('Example-data preview — not a customer document.')).toBeVisible();
  await page.screenshot({ path: '../docs/architecture/phase6_e2e/templates-preview.png' });
});
