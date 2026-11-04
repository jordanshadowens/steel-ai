import { expect, test } from '@playwright/test';

// 100-node interaction probe. Requires the Vite dev server (which exposes
// the inspection hook) — run: npm run dev, then
// STEEL_PERF=1 BASE_URL=http://127.0.0.1:5173 npx playwright test perf
test('100 visible nodes stay interactive', async ({ page }) => {
  test.skip(process.env.STEEL_PERF !== '1', 'needs the dev server');
  await page.goto('/');
  const opened = await page.evaluate(() => {
    const store = (window as unknown as { __steelStore?: { dispatch: (a: unknown) => void } }).__steelStore;
    if (!store) return false;
    const steps = [];
    for (let i = 0; i < 100; i++) {
      steps.push({
        step_id: `s${i}`,
        type: 'input_collection',
        name: `Step ${i}`,
        config: { fields: ['item'], prompt: '' },
        on_success: i === 99 ? 'end' : `s${i + 1}`,
      });
    }
    const t0 = performance.now();
    store.dispatch({
      type: 'workflowEditor/openDefinition',
      payload: { workflowId: 'perf', version: null, status: 'new', definition: { workflow_id: 'perf', inputs: [], steps, ui: { positions: {} } } },
    });
    return performance.now() - t0;
  });
  expect(opened).not.toBe(false);
  await expect(page.locator('.react-flow__node')).toHaveCount(101, { timeout: 30000 });

  // Selection stays snappy.
  const t0 = Date.now();
  await page.locator('.step-node').nth(50).click();
  await expect(page.getByRole('complementary', { name: /Step:/ })).toBeVisible();
  const selectMs = Date.now() - t0;
  console.log(`perf: dispatch=${JSON.stringify(opened)}ms select=${selectMs}ms`);
  expect(selectMs).toBeLessThan(5000);

  // A drag completes and marks the draft dirty without errors.
  const node = page.locator('.step-node').nth(10);
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 120, box!.y + box!.height / 2 + 60, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText(/unsaved changes/)).toBeVisible({ timeout: 10000 });
});
