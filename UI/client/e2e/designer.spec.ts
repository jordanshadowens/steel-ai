import { expect, test } from '@playwright/test';

// M4 section-11 UI acceptance (part 1): two schemas authored, published,
// and filled through the real UI; workflow binding run through the Runner;
// template binding rendered through the real preview pipeline.
const ts = Date.now();
const BOOK = `E2EBook${ts}`;
const AUTHOR = `E2EAuthor${ts}`;
const WF = `e2e-bind-${ts}`;

test.describe.serial('designer acceptance', () => {
async function addField(
  page: import('@playwright/test').Page,
  spec: { name: string; ftype: string; required?: boolean; precision?: string; scale?: string; options?: string },
) {
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(spec.name);
  await page.getByLabel('Field type').selectOption(spec.ftype);
  if (spec.required) await page.getByLabel('required', { exact: true }).check();
  if (spec.precision) await page.getByLabel(/Precision/).fill(spec.precision);
  if (spec.scale) await page.getByLabel(/Scale/).fill(spec.scale);
  if (spec.options) await page.getByLabel(/Options/).fill(spec.options);
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  await expect(page.getByRole('cell', { name: spec.name, exact: true })).toBeVisible();
}

test('designer: two schemas end to end in the UI', async ({ page }) => {
  await page.goto('/app/index.html#/designer');
  await expect(page.getByRole('button', { name: 'Data Designer' }).first()).toBeVisible();

  // Schema 1: Book with four typed fields.
  await page.getByLabel('New type name').fill(BOOK);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(BOOK) }).first()).toBeVisible();
  await addField(page, { name: 'title', ftype: 'text', required: true });
  await addField(page, { name: 'pages', ftype: 'integer' });
  await addField(page, { name: 'price', ftype: 'decimal', precision: '10', scale: '2' });
  await addField(page, { name: 'genre', ftype: 'enum', options: 'fiction\nnonfiction' });

  // Publish v1 from the UI review flow.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Check draft' }).click();
  await expect(page.getByText('Draft is valid.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish new version' }).click();
  await expect(page.getByText(/Published v1/)).toBeVisible();

  // Records through the UI form.
  await page.getByRole('button', { name: 'Records', exact: true }).click();
  await page.getByRole('button', { name: 'Add record' }).click();
  await page.getByLabel(/^title/).fill('Acceptance Tome');
  await page.getByLabel(/^pages/).fill('123');
  await page.getByLabel(/^price/).fill('29.99');
  await page.getByLabel(/^genre/).selectOption('fiction');
  await page.getByRole('button', { name: 'Save record' }).click();
  await expect(page.getByRole('cell', { name: 'Acceptance Tome' })).toBeVisible();

  // Schema 2: Author, published, then related to Book.
  await page.getByLabel('New type name').fill(AUTHOR);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Schema', exact: true }).click();
  await addField(page, { name: 'name', ftype: 'text', required: true });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Publish new version' }).click();
  await expect(page.getByText(/Published v1/)).toBeVisible();
  await page.getByRole('button', { name: 'Schema', exact: true }).click();
  await page.getByRole('button', { name: 'Add relationship' }).click();
  await page.getByLabel('Relationship name').fill('wrote');
  await page.getByLabel('Relationship target type').selectOption({ label: BOOK });
  await page.getByRole('button', { name: 'Add relationship', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'wrote', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Publish new version' }).click();
  await expect(page.getByText(/Published v2/)).toBeVisible();

  // Canvas renders both cards and the connector.
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(page.getByText(BOOK).first()).toBeVisible();
  await expect(page.getByText(AUTHOR).first()).toBeVisible();
});

test('designer: transfer and rollback in the UI', async ({ page }) => {
  await page.goto('/app/index.html#/designer');
  await page.getByRole('button', { name: new RegExp(BOOK) }).first().click();

  // Export shows real schema JSON; prefixed import creates drafts.
  await page.getByRole('button', { name: 'Import / Export', exact: true }).click();
  await page.getByLabel('Types to export').fill(`${BOOK}, ${AUTHOR}`);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exported = page.getByLabel('Exported schema');
  await expect(exported).toContainText(BOOK);
  const docText = (await exported.textContent()) ?? '';
  expect(docText).toContain('steel-schema/1');
  await page.getByLabel('Schema JSON to import').fill(docText);
  await page.getByLabel('Name prefix (optional)').fill('e2e2_');
  await page.getByRole('button', { name: 'Check import' }).click();
  await expect(page.getByText('Ready to import')).toBeVisible();
  await page.getByRole('button', { name: 'Import as drafts' }).click();
  await expect(page.getByText(/Imported 2 draft type/)).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`e2e2_${BOOK}`) }).first()).toBeVisible();

  // v2 then rollback to v1, versions table tells the truth.
  await page.getByRole('button', { name: 'Schema', exact: true }).click();
  await addField(page, { name: 'note', ftype: 'text' });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Publish new version' }).click();
  await expect(page.getByText(/Published v2/)).toBeVisible();
  await page.getByLabel('Rollback to version').fill('1');
  await page.getByRole('button', { name: 'Roll back', exact: true }).click();
  await expect(page.getByRole('row', { name: /v1 published/ })).toBeVisible();
});

test('bindings: workflow run picks a live record, template renders it', async ({ page, request }) => {
  // Author + publish the bound workflow (approval flow included).
  const definition = {
    workflow_id: WF,
    version: 1,
    status: 'draft',
    policy: { execution_approval: 'none' },
    inputs: [{ name: 'book', type: 'string', required: true, designer: { type: BOOK } }],
    steps: [
      { step_id: 'scope', type: 'input_collection', name: 'Scope', config: { fields: ['book'] }, on_success: 'fetch' },
      { step_id: 'fetch', type: 'database_retrieval', name: 'Fetch', config: { designer: { type: BOOK, limit: 10 } }, on_success: 'out' },
      { step_id: 'out', type: 'output_composition', name: 'Out', config: { mapping: { rows: { from: 'fetch.rows' } } }, on_success: 'end' },
    ],
    limits: { max_rounds: 10, max_iterations: 10 },
    outputs: { rows: { from: 'out.rows' } },
  };
  const created = await request.post('/api/workflows', { data: { definition } });
  expect(created.status()).toBe(200);
  const pubReq = await request.post(`/api/workflows/${WF}/publish`, { data: { version: 1 } });
  expect(pubReq.status()).toBe(200);
  const { approval_id } = (await pubReq.json()) as { approval_id: number };
  const decided = await request.post(`/api/approvals/${approval_id}/decide`, { data: { decision: 'approved', decided_by: 'e2e' } });
  expect(decided.status()).toBe(200);

  // Run it through the Runner UI with the record picker.
  await page.goto('/app/index.html#/runner');
  await page.locator('#runner-workflow').selectOption(WF);
  await expect(page.getByLabel('Published version')).toBeVisible();
  await page.getByLabel(/^book/).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Review inputs' }).click();
  await expect(page.getByRole('heading', { name: '3. Review and start' })).toBeVisible();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByText(/— sealed/)).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('cell', { name: 'Acceptance Tome' })).toBeVisible();

  // The same record renders through the template pipeline with a binding.
  const spec = {
    schema: 'steel-doc/1',
    template_id: 'e2e-bind',
    version: 1,
    title: 'Binding proof',
    page: { size: 'letter', orientation: 'portrait', margin_in: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } },
    styles: { font: 'Arial', heading_font: 'Arial', size_pt: 11, heading_color: '#000000', text_color: '#000000', muted_color: '#000000', rule_color: '#000000', table_header_fill: '#000000', table_grid_color: '#000000' },
    sections: [],
  };
  const types = await request.get('/api/designer/types');
  const bookRow = ((await types.json()) as { types: Array<{ type_id: string; name: string }> }).types.find((t) => t.name === BOOK);
  expect(bookRow).toBeTruthy();
  const found = await request.post(`/api/designer/types/${bookRow!.type_id}/records/query`, { data: { filters: { title: 'Acceptance Tome' } } });
  const recordId = ((await found.json()) as { records: Array<{ record_id: string }> }).records[0].record_id;
  const preview = await request.post('/api/templates/preview', {
    data: { spec, sample: {}, designer: { heading: { type: BOOK, record_id: recordId, field: 'title' } } },
  });
  expect(preview.status()).toBe(200);
  expect(preview.headers()['content-type']).toContain('application/pdf');
  const pdf = await preview.body();
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
});
});
