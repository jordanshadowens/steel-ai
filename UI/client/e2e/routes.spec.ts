import { expect, test } from '@playwright/test';

// Route cutover: product paths serve the shell with the right destination,
// legacy bookmarks redirect, unknown paths stay JSON 404 (never the shell),
// and refresh/deep links work.
test('product routes and legacy redirects', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Workflow Creator' }).first()).toBeVisible();
  await expect(page.getByText('Open a workflow to edit its steps on the canvas.')).toBeVisible();

  await page.goto('/runner');
  await expect(page.getByRole('heading', { name: 'Workflow Runner' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Workflow Runner' })).toBeVisible();

  await page.goto('/templates');
  await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible();

  await page.goto('/creator.html');
  await expect(page).toHaveURL(/\/creator$/);

  const missing = await request.get('/nope-missing');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('application/json');
});
