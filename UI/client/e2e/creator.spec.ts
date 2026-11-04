import { expect, test } from '@playwright/test';

// Creator flows against the real server and a seeded database
// (steel_customer_estimate). The app bundle is served at /app/index.html.
test.beforeEach(async ({ page }) => {
  await page.goto('/app/index.html');
  await page.getByRole('button', { name: 'Open library' }).click();
  await page.getByRole('button', { name: 'steel_customer_estimate' }).first().click();
  await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
});

test('creator opens a workflow on the canvas', async ({ page }) => {
  await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toBeVisible();
  await expect(page.locator('.react-flow__edge')).not.toHaveCount(0);
  await page.screenshot({ path: '../docs/architecture/phase6_e2e/creator-canvas.png' });
});

test('node selection opens the inspector', async ({ page }) => {
  await page.locator('.react-flow__node').first().click();
  await expect(page.getByRole('complementary', { name: /Step:/ })).toBeVisible();
  await expect(page.getByLabel(/What should this step do/)).toBeVisible();
});

test('validate reports a quiet valid status', async ({ page }) => {
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByText(/· valid/)).toBeVisible();
});

test('palette inserts a step with undo', async ({ page }) => {
  const before = await page.locator('.step-node').count();
  await page.getByRole('button', { name: '+ Step' }).click();
  await page.getByRole('button', { name: /Compose/ }).first().click();
  await expect(page.locator('.step-node')).toHaveCount(before + 1);
  await expect(page.getByText(/unsaved changes/)).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.step-node')).toHaveCount(before);
});
