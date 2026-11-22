import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { DesignerField, SkillRow, WorkflowDefinition, WorkflowVersionRow } from '../src/api/contracts';

const teamField: DesignerField = {
  field_id: 'team-field',
  name: 'Team',
  ftype: 'text',
  position: 0,
  required: true,
  unique: false,
  repeated: false,
  default: null,
  validation: {},
  status: 'active',
};
const teamModel = {
  type_id: 'teams',
  name: 'Teams',
  version: 1,
  status: 'active',
  workspace_id: 'test',
  fields: [teamField],
};

const libraryModule = /\/LibraryPanel(?:\.tsx|-[\w-]+\.js)(?:\?|$)/;
const skillInspectorModule = /\/SkillStepInspector(?:\.tsx|-[\w-]+\.js)(?:\?|$)/;
const runPlanModule = /\/RunPlanSteps(?:\.tsx|-[\w-]+\.js)(?:\?|$)/;

async function mockCreator(
  page: Page,
  options: {
    errors?: string[];
    saveErrors?: string[];
    previewErrors?: string[];
    omitPreviewPlan?: boolean;
    validateErrors?: string[];
    skills?: SkillRow[];
    modelListUnavailable?: () => boolean;
    modelArchived?: boolean;
    beforeModelList?: () => Promise<void>;
    beforeValidate?: () => Promise<void>;
    beforePreview?: () => Promise<void>;
    publish?: (version: number) => Promise<void>;
    saved?: WorkflowVersionRow[];
  } = {},
) {
  const rows: WorkflowVersionRow[] = [...(options.saved ?? [])];
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const path = requestUrl.pathname;
    const method = request.method();
    let data: unknown;
    if (path === '/api/runtime-config') data = { mode: 'local' };
    else if (path === '/api/health') data = { ok: true };
    else if (path === '/api/skills') data = { skills: options.skills ?? [] };
    else if (path === '/api/designer/workspace') {
      await options.beforeModelList?.();
      if (options.modelListUnavailable?.()) {
        await route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
        return;
      }
      const showModel = !options.modelArchived || requestUrl.searchParams.get('include_archived') === '1';
      data = {
        workspace: 'test',
        types: showModel ? [{ ...teamModel, status: options.modelArchived ? 'archived' : 'active' }] : [],
      };
    }
    else if (path === '/api/designer/types/teams/versions/1') data = { spec: teamModel };
    else if (path === '/api/workflows/preview') {
      await options.beforePreview?.();
      if (options.previewErrors?.length) {
        await route.fulfill({ status: 400, json: { ok: false, errors: options.previewErrors } });
        return;
      }
      const definition = request.postDataJSON().definition as WorkflowDefinition;
      const steps = new Map(definition.steps?.map((step) => [step.step_id, step]));
      const entry = definition.steps?.[0]?.step_id;
      const order = [];
      const visited = new Set<string>();
      for (let id = entry; id && !visited.has(id); ) {
        const step = steps.get(id);
        if (!step) break;
        order.push(step);
        visited.add(id);
        id = step.on_success;
      }
      data = { ok: true, plan: options.omitPreviewPlan ? undefined : { entry, order } };
    } else if (path === '/api/workflows/validate') {
      if (options.validateErrors?.length) {
        await route.fulfill({ status: 400, json: { ok: false, errors: options.validateErrors } });
        return;
      }
      await options.beforeValidate?.();
      data = { ok: !options.errors?.length, errors: options.errors ?? [] };
    } else if (path.endsWith('/publish')) {
      await options.publish?.(request.postDataJSON().version);
      data = { approval_id: 42, status: 'pending' };
    } else if (path === '/api/approvals/42/decide') {
      data = { approval: { status: request.postDataJSON().decision } };
    } else if (method === 'POST' && (path === '/api/workflows' || path.endsWith('/versions'))) {
      if (options.saveErrors?.length) {
        await route.fulfill({ status: 400, json: { ok: false, errors: options.saveErrors } });
        return;
      }
      const definition = request.postDataJSON().definition as WorkflowDefinition;
      const currentVersions = rows.filter(({ workflow_id }) => workflow_id === definition.workflow_id);
      if (path === '/api/workflows' && currentVersions.length > 0) {
        await route.fulfill({ status: 409, json: { ok: false, error: 'Workflow ID already exists.' } });
        return;
      }
      const row: WorkflowVersionRow = {
        workflow_id: definition.workflow_id,
        name: definition.name,
        version: Math.max(0, ...currentVersions.map(({ version }) => version)) + 1,
        status: 'draft',
        created_at: '2026-11-22T05:00:00Z',
        definition,
      };
      rows.unshift(row);
      data = { ok: true, row };
    } else if (path === '/api/workflows') data = { workflows: rows };
    else if (path === '/api/workflows/test-flow') data = { versions: rows.filter(({ workflow_id }) => workflow_id === 'test-flow') };
    else {
      await route.fulfill({ status: 404, json: { error: 'Unexpected test request' } });
      return;
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/app/');
  return rows;
}

async function createDraft(page: Page) {
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  await page.getByLabel('Workflow id', { exact: true }).fill('test-flow');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toContainText('v1 · saved');
}

test('open the other workspace pages and return to Creator', async ({ page }) => {
  await mockCreator(page);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const [label, heading] of [
    ['Workflow Runner', 'Workflow Runner'],
    ['Data Designer', 'Data models'],
  ]) {
    await nav.getByText(label, { exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await nav.getByText('Workflow Creator', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'New workflow', exact: true })).toBeVisible();
  await page.goBack();
  await expect(nav.getByRole('link', { name: 'Data Designer' })).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(nav.getByRole('link', { name: 'Workflow Creator' })).toHaveAttribute('aria-current', 'page');
});

test('the workspace header fits a phone and the retired Templates link opens Creator', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockCreator(page);
  await page.goto('/app/index.html#/templates');
  await expect(page).toHaveURL(/#\/$/);
  const header = page.getByRole('banner');
  const nav = header.getByRole('navigation', { name: 'Primary' });
  await expect(header.getByRole('link', { name: 'Steel AI', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Workflow Creator' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Workflow Runner' })).toHaveAttribute('href', '#/runner');
  await expect(nav.getByRole('link')).toHaveCount(3);
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (const [width, height] of [[667, 375], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'New workflow', exact: true })).toBeInViewport();
  }
});

test('a long account name leaves Sign out accessible on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockCreator(page);
  const email = 'a-very-long-workspace-account-name@example.invalid';
  await page.route('**/api/runtime-config', (route) => route.fulfill({ json: {
    mode: 'account',
    authMethod: 'session-cookie',
    firebase: { apiKey: 'test', projectId: 'test', authDomain: 'example.invalid' },
  } }));
  await page.route('**/api/workspace', (route) => route.fulfill({ json: { mode: 'account', skillsScope: 'account' } }));
  await page.route('**/api/session', (route) => route.fulfill({ json: {
    uid: 'test-account', email, expiresAt: Date.now() + 60_000, access: { runtimePreviewEligible: true },
  } }));
  await page.reload();
  const header = page.getByRole('banner');
  await expect(header.getByTitle(email)).toBeVisible();
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await header.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Open your workspace' })).toBeVisible();
});

test('edit a workflow in landscape without the inspector covering canvas controls', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await mockCreator(page);
  await createDraft(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Workflow settings' });
  await expect(inspector.getByLabel('Workflow id', { exact: true })).toBeInViewport();
  const toolbar = page.getByRole('toolbar', { name: 'Canvas view' });
  await toolbar.getByRole('button', { name: 'Find step', exact: true }).click({ trial: true });
  const [panelBounds, toolbarBounds] = await Promise.all([inspector.boundingBox(), toolbar.boundingBox()]);
  expect(toolbarBounds!.x + toolbarBounds!.width).toBeLessThan(panelBounds!.x);
});

test('a short phone gives the inspector room to edit workflow settings', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await mockCreator(page);
  await createDraft(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Workflow settings' });
  const toolbar = page.getByRole('toolbar', { name: 'Canvas view', includeHidden: true });
  await expect(inspector.getByLabel('Workflow id', { exact: true })).toBeInViewport();
  await expect(toolbar).toBeHidden();
  await inspector.getByRole('button', { name: /Close/ }).click();
  await expect(toolbar).toBeVisible();
});

test('Trash shows loading and retry before showing an empty list', async ({ page }) => {
  await mockCreator(page);
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  await page.route((url) => url.pathname === '/api/workflows' && url.searchParams.get('trash') === '1', async (route) => {
    if (first) {
      first = false;
      await pending;
      await route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
    } else {
      await route.fulfill({ json: { workflows: [] } });
    }
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  const library = page.getByRole('complementary', { name: 'Workflow library' });
  await library.getByRole('button', { name: 'Trash', exact: true }).click();
  try {
    await expect(library.getByRole('status')).toHaveText('Loading Trash…');
    await expect(library.getByText('Trash is empty.')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(library.getByRole('alert')).toHaveText('Could not load Trash.');
  await expect(library.getByText('Trash is empty.')).toHaveCount(0);
  await library.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(library.getByText('Trash is empty.')).toBeVisible();
});

test('the Library refreshes when a workflow disappears before opening', async ({ page }) => {
  const rows = await mockCreator(page, { saved: [{
    workflow_id: 'test-flow', name: 'Removed workflow', version: 1, status: 'draft',
    definition: { workflow_id: 'test-flow' },
  }] });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  const library = page.getByRole('complementary', { name: 'Workflow library' });
  const workflow = library.getByRole('button', { name: 'Removed workflow', exact: true });
  await expect(workflow).toBeVisible();
  rows.length = 0;
  await page.route('**/api/workflows/test-flow', (route) => route.fulfill({ status: 404, json: {} }));
  await workflow.click();
  await expect(page.getByRole('alert')).toContainText('Removed workflow is no longer available.');
  await expect(library.getByText('No workflows yet.')).toBeVisible();
  await expect(library.getByRole('searchbox', { name: 'Search', exact: true })).toBeFocused();
});

test('switching to Trash cancels navigation from a pending workflow open', async ({ page }) => {
  const saved = { workflow_id: 'test-flow', name: 'Slow workflow', version: 1, status: 'draft', definition: { workflow_id: 'test-flow' } };
  await mockCreator(page, { saved: [saved] });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/workflows/test-flow', async (route) => {
    await pending;
    await route.fulfill({ json: { versions: [saved] } });
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  const library = page.getByRole('complementary', { name: 'Workflow library' });
  try {
    await library.getByRole('button', { name: 'Slow workflow', exact: true }).click();
    await expect(library.getByText('Opening Slow workflow…')).toBeVisible();
    await library.getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(library.getByText('Opening Slow workflow…')).toHaveCount(0);
    const response = page.waitForResponse('**/api/workflows/test-flow');
    release();
    await (await response).finished();
    await expect(library.getByRole('button', { name: 'Trash', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
  } finally {
    release();
  }
});

test('restoring from Trash refreshes both workflow lists', async ({ page }) => {
  const rows = await mockCreator(page);
  const restored = { workflow_id: 'test-flow', name: 'Restored workflow', version: 1, status: 'draft', definition: { workflow_id: 'test-flow' } };
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let attempts = 0;
  await page.route((url) => url.pathname === '/api/workflows' && url.searchParams.get('trash') === '1',
    (route) => route.fulfill({ json: { workflows: rows.length ? [] : [restored] } }));
  await page.route('**/api/workflows/test-flow/restore', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await pending;
      await route.fulfill({ json: { ok: false, workflow_id: 'test-flow' } });
    } else {
      rows.push(restored);
      await route.fulfill({ json: { ok: true, workflow_id: 'test-flow' } });
    }
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  const library = page.getByRole('complementary', { name: 'Workflow library' });
  const search = library.getByRole('searchbox', { name: 'Search', exact: true });
  await search.fill('restored');
  await library.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(search).toHaveValue('');
  const restore = library.getByRole('button', { name: 'Restore Restored workflow' });
  try {
    await expect(library.getByText('Restored workflow', { exact: true })).toBeVisible();
    await search.fill('missing');
    await expect(library.getByText('No deleted workflows match your search.')).toBeVisible();
    await library.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toBeFocused();
    await expect(library.getByRole('button', { name: 'Restored workflow', exact: true })).toHaveCount(0);
    await restore.click();
    await expect(restore).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByRole('alert')).toContainText('Could not restore Restored workflow. Try again.');
  await expect(restore).toBeEnabled();
  await restore.click();
  await expect(library.getByText('Trash is empty.')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not restore Restored workflow.' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Restored Restored workflow.' })).toBeVisible();
  await library.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(search).toHaveValue('restored');
  await expect(library.getByRole('button', { name: 'Restored workflow', exact: true })).toBeVisible();
});

test('export downloads the saved version and imports it as a new draft', async ({ page }) => {
  const definition = {
    workflow_id: 'test-flow', name: 'Saved workflow',
    inputs: [{ name: 'team', type: 'string', required: true }],
  };
  const rows = await mockCreator(page, { saved: [{
    workflow_id: 'test-flow', name: 'Saved workflow', version: 2, status: 'draft',
    definition,
  }, {
    workflow_id: 'test-flow', name: 'Saved workflow', version: 1, status: 'draft',
    definition: { ...definition, inputs: [] },
  }] });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/workflows/test-flow', async (route) => {
    await pending;
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  const library = page.getByRole('complementary', { name: 'Workflow library' });
  try {
    await library.getByRole('button', { name: 'Actions for Saved workflow' }).click();
    await page.getByRole('menuitem', { name: 'Export latest JSON' }).click();
    await expect(library.getByRole('status')).toHaveText('Exporting Saved workflow…');
    const download = page.waitForEvent('download');
    release();
    const file = await download;
    expect(file.suggestedFilename()).toBe('test-flow-v2.json');
    const payload = await readFile(await file.path());
    expect(JSON.parse(payload.toString('utf8'))).toEqual(definition);
    await expect(library.getByText('Exporting Saved workflow…')).toHaveCount(0);
    await page.route('**/api/workflows/test-flow', (route) => route.fulfill({ status: 503, json: {} }), { times: 1 });
    await library.getByRole('button', { name: 'Actions for Saved workflow' }).click();
    await library.getByRole('menuitem', { name: 'Export latest JSON' }).click();
    const error = page.getByRole('alert').filter({ hasText: 'Could not export Saved workflow. Try again.' });
    await expect(error).toBeVisible();
    const newerDefinition = { ...definition, name: 'Saved elsewhere' };
    rows.push({ workflow_id: 'test-flow', name: newerDefinition.name, version: 3, status: 'draft', definition: newerDefinition });
    const retry = page.waitForEvent('download');
    await library.getByRole('button', { name: 'Actions for Saved workflow' }).click();
    await library.getByRole('menuitem', { name: 'Export latest JSON' }).click();
    const newerFile = await retry;
    expect(newerFile.suggestedFilename()).toBe('test-flow-v3.json');
    await expect(error).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Download started for Saved elsewhere v3.' })).toBeVisible();
    expect(JSON.parse(await readFile(await newerFile.path(), 'utf8'))).toEqual(newerDefinition);
    await library.getByRole('button', { name: 'Actions for Saved workflow' }).click();
    await library.getByRole('menuitem', { name: 'Versions', exact: true }).click();
    const olderDownload = page.waitForEvent('download');
    await library.getByRole('button', { name: 'Export v1 JSON', exact: true }).click();
    const olderFile = await olderDownload;
    expect(olderFile.suggestedFilename()).toBe('test-flow-v1.json');
    expect(JSON.parse(await readFile(await olderFile.path(), 'utf8'))).toEqual({ ...definition, inputs: [] });
    await library.getByRole('button', { name: 'Import JSON' }).click();
    const importer = page.getByRole('dialog', { name: 'Import workflow' });
    await importer.getByLabel('JSON file').setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer: payload });
    await expect(importer.getByLabel('Workflow definition')).toHaveValue(payload.toString('utf8'));
    await importer.getByRole('button', { name: 'Validate and import' }).click();
    await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toContainText('unsaved');
    await expect(page.getByLabel('Input 1 name', { exact: true })).toHaveValue('team');
    const id = page.getByLabel('Workflow id', { exact: true });
    await expect(id).toHaveAccessibleDescription(/already in use/);
    await id.fill('copied-workflow');
    await page.keyboard.press('Control+s');
    await expect.poll(() => rows.find(({ workflow_id }) => workflow_id === 'copied-workflow')).toMatchObject({
      version: 1,
      definition: { ...definition, workflow_id: 'copied-workflow' },
    });
    expect(rows.filter(({ workflow_id }) => workflow_id === 'test-flow').map(({ version }) => version)).toEqual([2, 1, 3]);
    expect(rows.find(({ workflow_id, version }) => workflow_id === 'test-flow' && version === 2)?.definition).toEqual(definition);
  } finally {
    release();
  }
});

test('a failed library download leaves the draft editable', async ({ page }) => {
  const rows = await mockCreator(page);
  await page.route(libraryModule, (route) => route.abort());
  await createDraft(page);
  await page.getByRole('button', { name: '+ Add step', exact: true }).click();
  const stepSearch = page.getByRole('searchbox', { name: 'Search step types' });
  await stepSearch.fill('Set results');
  await stepSearch.press('Enter');
  const openLibrary = page.getByRole('button', { name: 'Workflows', exact: true });
  await openLibrary.press('Enter');
  const library = page.getByRole('complementary', { name: 'Workflow library' });
  await expect(library.getByRole('status')).toContainText('Couldn’t load the workflow library');
  await library.getByRole('button', { name: 'Close library' }).click();
  await expect(library).toHaveCount(0);
  await expect(openLibrary).toBeFocused();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toContainText('v2 · saved');
  expect(rows[0].definition.steps?.map(({ step_id }) => step_id)).toEqual(['start', 'step2']);
});

test('starting over names the action and keeps the draft when canceled', async ({ page }) => {
  await mockCreator(page);
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  const id = page.getByLabel('Workflow id', { exact: true });
  await id.fill('unfinished');
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  const library = page.getByRole('complementary', { name: 'Workflow library' });
  await library.getByRole('button', { name: 'New workflow', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(confirm).toContainText('start a new workflow');
  await confirm.getByRole('button', { name: 'Keep editing' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(id).toHaveValue('unfinished');
  const workflows = page.getByRole('button', { name: 'Workflows', exact: true });
  await workflows.click();
  await library.getByRole('button', { name: 'Library', exact: true }).press('Escape');
  await expect(library).toHaveCount(0);
  await expect(workflows).toBeFocused();
});

test('switching to a saved version asks before replacing an unsaved draft', async ({ page }) => {
  await mockCreator(page, { saved: [{
    workflow_id: 'test-flow', name: 'Saved workflow', version: 2, status: 'draft',
    definition: { workflow_id: 'test-flow', name: 'Saved workflow' },
  }] });
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  const id = page.getByLabel('Workflow id', { exact: true });
  await id.fill('unfinished');
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  const saved = page.getByRole('button', { name: 'Saved workflow', exact: true });
  await saved.click();
  const confirm = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(confirm).toContainText('open Saved workflow v2');
  await confirm.getByRole('button', { name: 'Keep editing' }).click();
  await expect(id).toHaveValue('unfinished');
  const workflows = page.getByRole('button', { name: 'Workflows', exact: true });
  await expect(page.getByRole('complementary', { name: 'Workflow library' })).toHaveCount(0);
  await expect(workflows).toBeFocused();
  await workflows.press('Enter');
  await saved.click();
  await confirm.getByRole('button', { name: 'Discard and switch' }).click();
  await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toContainText('draft v2');
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue('Saved workflow');
});

test('canceling import while validation runs keeps the JSON for retry', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await mockCreator(page, { beforeValidate: () => pending });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  const library = page.getByRole('complementary', { name: 'Workflow library' });
  const importButton = library.getByRole('button', { name: 'Import JSON' });
  try {
    await importButton.click();
    const dialog = page.getByRole('dialog', { name: 'Import workflow' });
    const json = '{"workflow_id":"test-flow"}';
    await dialog.getByLabel('Workflow definition').fill(json);
    await dialog.getByRole('button', { name: 'Validate and import' }).click();
    await expect(dialog.getByRole('button', { name: 'Validating...' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await importButton.click();
    await expect(dialog.getByLabel('Workflow definition')).toHaveValue(json);
    await expect(dialog.getByRole('button', { name: 'Validate and import' })).toBeEnabled();
    const response = page.waitForResponse('**/api/workflows/validate');
    release();
    await (await response).finished();
    await expect(dialog.getByLabel('Workflow definition')).toHaveValue(json);
  } finally {
    release();
  }
});

test('a new workflow needs an unused ID before its first save', async ({ page }) => {
  const rows = await mockCreator(page, {
    saved: [{ workflow_id: 'test-flow', name: 'Existing workflow', version: 1, status: 'draft', definition: { workflow_id: 'test-flow' } }],
  });
  const list = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/workflows');
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  await list;
  const id = page.getByLabel('Workflow id', { exact: true });
  await expect(id).toBeFocused();
  await expect(id).toHaveAttribute('aria-required', 'true');
  await expect(id).toHaveAttribute('autocapitalize', 'none');
  await expect(id).toHaveAttribute('spellcheck', 'false');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a workflow ID in Settings.');
  await expect(id).toBeFocused();
  await id.fill('test-flow');
  await id.press('Enter');
  await expect(id).toHaveAccessibleDescription(/That workflow ID is already in use/);
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('alert')).toContainText('That workflow ID is already in use.');
  await expect(id).toBeFocused();
  expect(rows).toHaveLength(1);
  await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();
  rows.push({ workflow_id: 'late-id', name: 'Saved elsewhere', version: 1, status: 'draft', definition: { workflow_id: 'late-id' } });
  await id.fill('  late-id  ');
  const conflict = page.waitForResponse((response) => response.status() === 409 && response.request().method() === 'POST');
  await page.keyboard.press('Control+s');
  await conflict;
  await expect(page.getByRole('alert')).toContainText('Enter a different ID in Settings.');
  await expect(id).toHaveValue('late-id');
  await expect(id).toBeFocused();
  await expect(id).toHaveAccessibleDescription(/already in use/);
  await id.fill('new-workflow');
  await id.press('Enter');
  await expect(id).not.toHaveAttribute('aria-invalid', 'true');
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].workflow_id).toBe('new-workflow');
  expect(rows[0].version).toBe(1);
  expect(rows.find(({ workflow_id }) => workflow_id === 'test-flow')?.version).toBe(1);
});

test('create, connect, save, and follow a validation issue', async ({ page }) => {
  const rows = await mockCreator(page, { errors: ['steps[1].step2.config.mapping: missing value'] });
  await createDraft(page);
  const versionHistoryRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/workflows/test-flow') {
      versionHistoryRequests.push(request.url());
    }
  });
  await page.getByRole('button', { name: '+ Add step', exact: true }).click();
  await expect(page.getByLabel('Connect after')).toHaveValue('start');
  await expect(page.getByLabel('Connect after').getByRole('option', { name: 'Start (start)' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Document', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Spreadsheet / Slides', exact: true })).toHaveCount(0);
  const stepSearch = page.getByRole('searchbox', { name: 'Search step types' });
  for (const name of ['document', 'spreadsheet', 'presentation']) {
    await stepSearch.fill(name);
    await expect(page.getByText('No matching steps.', { exact: true })).toBeVisible();
  }
  await page.getByRole('dialog', { name: 'Add step' }).getByRole('button', { name: 'Clear search' }).click();
  await expect(stepSearch).toHaveValue('');
  await expect(stepSearch).toBeFocused();
  for (const type of ['document_generation', 'artifact_generation']) {
    const retiredStep = await page.evaluateHandle((stepType) => {
      const transfer = new DataTransfer();
      transfer.setData('application/steel-step', stepType);
      return transfer;
    }, type);
    await page.locator('.react-flow').dispatchEvent('drop', { dataTransfer: retiredStep });
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await retiredStep.dispose();
  }
  await stepSearch.fill('Set results');
  await stepSearch.press('Enter');
  await expect(page.getByRole('heading', { name: 'Set results', exact: true })).toBeFocused();
  await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toContainText('v2 · saved');
  expect(versionHistoryRequests).toHaveLength(0);
  expect(rows[0].definition.steps?.map(({ step_id, on_success }) => [step_id, on_success])).toEqual([
    ['start', 'step2'],
    ['step2', 'end'],
  ]);

  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await page.getByTitle('Go to step step2', { exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Step: Set results' })).toBeVisible();
});

test('Finish keeps its width when font metrics change', async ({ page }) => {
  await mockCreator(page);
  await createDraft(page);
  const finish = page.locator('.end-node');
  await expect(finish).toBeVisible();
  const widths = await finish.evaluate((node) => {
    node.style.fontFamily = 'Arial, sans-serif';
    const before = node.offsetWidth;
    node.style.fontFamily = 'Courier New, monospace';
    return [before, node.offsetWidth];
  });
  expect(widths[1]).toBe(widths[0]);
});

test('drag a step onto the canvas and save its connection', async ({ page }) => {
  const rows = await mockCreator(page);
  await createDraft(page);
  await page.getByRole('button', { name: '+ Add step', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Add step' });
  await expect(panel.getByLabel('Connect after')).toHaveValue('start');
  await panel.getByRole('button', { name: /^Set results/ }).dragTo(page.locator('.react-flow__pane'), {
    targetPosition: { x: 540, y: 180 },
  });
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.react-flow__node[data-id="step2"]')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.steps?.map(({ step_id, on_success }) => [step_id, on_success])).toEqual([
    ['start', 'step2'], ['step2', 'end'],
  ]);
  const savedSteps = rows[0].definition.steps;
  const originalPosition = rows[0].definition.ui?.positions?.step2;
  await page.getByRole('button', { name: 'Arrange', exact: true }).click();
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.ui?.positions?.step2).toEqual({ x: 380, y: 60 });
  expect(rows[0].definition.ui?.positions?.step2).not.toEqual(originalPosition);
  expect(rows[0].definition.steps).toEqual(savedSteps);
});

test('reload restores an unsaved workflow and its canvas view', async ({ page }) => {
  const saveErrors: string[] = [];
  const rows = await mockCreator(page, { saveErrors });
  await createDraft(page);
  saveErrors.push('Server unavailable.');
  await page.getByRole('button', { name: '+ Add step', exact: true }).click();
  await page.getByRole('button', { name: /Set results/ }).click();
  await expect(page.getByTitle('Canvas zoom')).toHaveText('100%');
  const viewport = page.locator('.react-flow__viewport');
  const initialZoom = await viewport.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.waitForFunction((zoom) => {
    const raw = sessionStorage.getItem('steel.workflow-draft.local.v1');
    if (!raw) return false;
    const recovery = JSON.parse(raw);
    return recovery.draft.steps.length === 2 && recovery.viewport?.zoom < zoom;
  }, initialZoom);
  const transform = await viewport.evaluate((element) => getComputedStyle(element).transform);
  await page.reload();

  await expect(page.locator('.react-flow__node[data-id="step2"]')).toBeAttached();
  await expect(viewport).toHaveCSS('transform', transform);
  const zoomIn = page.getByRole('button', { name: 'Zoom in', exact: true });
  await expect(zoomIn).toBeEnabled();
  for (let attempt = 0; attempt < 8 && await zoomIn.isEnabled(); attempt++) {
    await zoomIn.click();
  }
  await expect(zoomIn).toBeDisabled();
  await expect(page.getByTitle('Canvas zoom')).toHaveText('200%');
  const reset = page.getByRole('button', { name: 'Reset view', exact: true });
  await reset.click();
  await expect(page.getByTitle('Canvas zoom')).toHaveText('100%');
  await expect(reset).toBeDisabled();
  expect(rows[0].definition.steps).toHaveLength(1);
});

test('a rejected save opens Issues and links to the affected step', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const rows = await mockCreator(page, {
    saveErrors: [`steps[0].start.config.fields.${'long_field_name_'.repeat(12)}: missing value`],
  });
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  await page.getByLabel('Workflow id', { exact: true }).fill('test-flow');
  await page.keyboard.press('Control+s');

  await expect(page.getByRole('alert')).toContainText('See Issues for details.');
  await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('alert')).toContainText('See Issues for details.');
  const issues = page.getByRole('complementary', { name: 'Validation issues' });
  await expect(issues).toContainText('missing value');
  expect(await issues.evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true);
  await page.getByTitle('Go to step start', { exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Step: Start' })).toBeVisible();
  expect(rows).toHaveLength(0);
});

test('input issues focus the named field in Settings', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const rows = await mockCreator(page, {
    errors: ['inputs[0].name: reserved name', 'inputs.1.type: unsupported type', 'inputs[1].required: expected boolean'],
    saved: [{
      workflow_id: 'test-flow', name: 'Repair inputs', version: 1, status: 'draft',
      definition: {
        workflow_id: 'test-flow',
        inputs: [{ name: 'first', type: 'string' }, { name: 'bad name', type: 'string' }],
        steps: [{ step_id: 'start', type: 'input_collection', on_success: 'end' }],
      },
    }],
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Repair inputs', exact: true }).click();
  await page.getByRole('button', { name: /^Issues \(/ }).click();
  await page.getByTitle('Go to input 2 name', { exact: true }).click();
  const second = page.getByLabel('Input 2 name', { exact: true });
  await expect(second).toBeFocused();
  await second.fill('second_value');
  await second.press('Tab');
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.inputs?.[1]?.name).toBe('second_value');
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await page.getByTitle('Go to input 1 name', { exact: true }).click();
  await expect(page.getByLabel('Input 1 name', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await page.getByTitle('Go to input 2 type', { exact: true }).click();
  await expect(page.getByLabel('Input 2 type', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await page.getByTitle('Go to input 2 required', { exact: true }).click();
  await expect(page.getByLabel('Input 2 required', { exact: true })).toBeFocused();
});

test('validation responses apply only to the submitted draft', async ({ page }) => {
  let started = () => {};
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  let release = () => {};
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  await mockCreator(page, {
    errors: ['steps[0].start.config.fields: missing value'],
    beforeValidate: () => {
      started();
      return responseGate;
    },
  });
  await createDraft(page);
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await requestStarted;
  await page.getByRole('button', { name: '+ Add step', exact: true }).click();
  await page.getByRole('button', { name: /Set results/ }).click();

  release();
  const validate = page.getByRole('button', { name: 'Validate', exact: true });
  await expect(validate).toBeEnabled();
  const issue = page.getByTitle('Go to step start', { exact: true });
  await expect(issue).toHaveCount(0);
  await validate.click();
  await expect(issue).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(issue).toHaveCount(0);
  await expect(page.getByText('Click Validate to check this draft on the server.')).toBeVisible();
});

test('editing a published workflow creates a separate draft version', async ({ page }) => {
  const definition: WorkflowDefinition = {
    workflow_id: 'test-flow',
    name: 'Published workflow',
    steps: [{ step_id: 'start', type: 'input_collection', on_success: 'end' }],
  };
  const rows = await mockCreator(page, {
    saved: [{ workflow_id: 'test-flow', name: definition.name, version: 1, status: 'published', definition }],
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Published workflow', exact: true }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Workflow commands' });
  await expect(toolbar).toContainText('published v1');
  await page.getByRole('button', { name: '+ Add step', exact: true }).click();
  await page.getByRole('button', { name: /Set results/ }).click();
  await expect(toolbar).toContainText('draft from published v1');
  await toolbar.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toolbar).toContainText('draft v2');
  expect(rows[0].definition.steps).toHaveLength(2);
  expect(rows[1]).toMatchObject({ version: 1, status: 'published', definition });
  await expect(page.getByRole('complementary', { name: 'Step: Set results' })).toBeVisible();
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  const latestVersion = page.getByRole('button', { name: 'Published workflow', exact: true });
  await expect(latestVersion).toHaveAttribute('aria-current', 'true');
  const row = latestVersion.locator('..');
  await expect(row.getByText('Published v1', { exact: true })).toBeVisible();
  await expect(row.getByText('v2', { exact: true })).toBeVisible();
  const statusFilter = page.getByLabel('Latest version status');
  await statusFilter.selectOption('published');
  await expect(row).toHaveCount(0);
  await expect(page.getByText('No workflows match your filters.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workflows 0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(statusFilter).toHaveValue('all');
  await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeFocused();
  await statusFilter.selectOption('draft');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Actions for Published workflow' }).click();
  rows.unshift({ ...rows[0], version: 3 });
  await page.getByRole('menuitem', { name: 'Compare with published' }).click();
  const comparison = page.getByRole('dialog', { name: 'Compare versions' });
  await expect(comparison.getByLabel('From version')).toHaveValue('1');
  await expect(comparison.getByLabel('To version')).toHaveValue('2');
  await comparison.getByRole('button', { name: 'Close', exact: true }).click();
  rows.splice(rows.findIndex((entry) => entry.version === 2), 1);
  await row.getByRole('button', { name: 'Actions for Published workflow' }).click();
  await page.getByRole('menuitem', { name: 'Compare with published' }).click();
  await expect(comparison.getByText('Choose another version. One of the selected versions is unavailable.')).toBeVisible();
  await comparison.getByRole('button', { name: 'Close', exact: true }).click();
  await row.getByRole('button', { name: 'Actions for Published workflow' }).click();
  await page.getByRole('menuitem', { name: 'Versions', exact: true }).click();
  await page.getByRole('button', { name: 'v1 (published)', exact: true }).click();
  await expect(toolbar).toContainText('published v1');
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  await expect(row.getByText('Open at v1', { exact: true })).toBeVisible();
  await expect(latestVersion).not.toHaveAttribute('aria-current', 'true');
  await row.getByRole('button', { name: 'Actions for Published workflow' }).click();
  await page.getByRole('menuitem', { name: 'Compare saved v1 with latest' }).click();
  await expect(comparison.getByLabel('From version')).toHaveValue('1');
  await expect(comparison.getByLabel('To version')).toHaveValue('3');
  await comparison.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Close library' }).click();
  rows.sort((a, b) => a.version - b.version);
  const latestVersionRequest = page.waitForRequest((request) =>
    request.method() === 'GET' && new URL(request.url()).pathname === '/api/workflows/test-flow');
  await toolbar.getByRole('button', { name: 'Save', exact: true }).click();
  await latestVersionRequest;
  await expect(toolbar).toContainText('draft v4');
  await expect(page.getByRole('status').filter({ hasText: 'Saved v4 as draft.' })).toContainText('Based on v1. The latest saved version before this was v3.');
  expect(rows[0].definition.steps).toHaveLength(1);
  expect(rows.find(({ version }) => version === 1)?.status).toBe('published');
});

test('a failed first save preserves edits for a retry', async ({ page }) => {
  const rows = await mockCreator(page);
  let failNextSave = true;
  await page.route('**/api/workflows', async (route) => {
    if (route.request().method() !== 'POST' || !failNextSave) {
      await route.fallback();
      return;
    }
    failNextSave = false;
    await route.fulfill({ status: 503, json: { error: 'Temporarily unavailable.' } });
  });
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  const id = page.getByLabel('Workflow id', { exact: true });
  await id.fill('test-flow');
  const shortcutHandled = await id.evaluate((field) => !field.dispatchEvent(new KeyboardEvent('keydown', {
    key: 's', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true,
  })));
  expect(shortcutHandled).toBe(false);
  await expect(id).toBeFocused();
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('alert')).toContainText('Your edits are still in this draft. Click Save to try again.');
  await expect(id).toHaveValue('test-flow');
  expect(rows).toHaveLength(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toContainText('v1 · saved');
  expect(rows[0]).toMatchObject({ workflow_id: 'test-flow', version: 1 });
  await expect(page.getByRole('alert').filter({ hasText: 'Your edits are still in this draft.' })).toHaveCount(0);
});

test('manual save succeeds when version history is unavailable', async ({ page }) => {
  const rows = await mockCreator(page);
  await createDraft(page);
  let release!: () => void;
  const history = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/workflows/test-flow', async (route) => {
    await history;
    await route.fulfill({ status: 503, json: {} });
  });
  const toolbar = page.getByRole('toolbar', { name: 'Workflow commands' });
  let saveRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/workflows/test-flow/versions') {
      saveRequests++;
    }
  });
  try {
    await toolbar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(toolbar.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    await page.keyboard.press('Control+s');
    await page.keyboard.press('Control+s');
    expect(rows.map(({ version }) => version)).toEqual([1]);
  } finally {
    release();
  }
  await expect(toolbar).toContainText('v2 · saved');
  expect(rows.map(({ version }) => version)).toEqual([2, 1]);
  expect(saveRequests).toBe(1);
});

test('rejecting publication keeps the submitted version as a draft', async ({ page }) => {
  await mockCreator(page);
  await createDraft(page);
  const publish = page.getByRole('button', { name: 'Publish', exact: true });
  await publish.click();
  await page.getByRole('button', { name: 'Request approval' }).click();
  const approval = page.getByRole('dialog', { name: 'Publication approval' });
  await approval.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Publication rejected for test-flow v1. It remains a draft.' })).toBeVisible();
  await expect(approval).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toContainText('draft v1');
  await expect(publish).toBeEnabled();
});

test('a failed publish request can be retried for the same version', async ({ page }) => {
  await mockCreator(page);
  await createDraft(page);
  await page.route('**/api/workflows/test-flow/publish', (route) => route.fulfill({
    status: 503, json: { error: 'Temporarily unavailable.' },
  }), { times: 1 });
  const publish = page.getByRole('button', { name: 'Publish', exact: true });
  const review = page.getByRole('dialog', { name: 'Review publication' });
  await publish.click();
  await review.getByRole('button', { name: 'Request approval' }).click();
  await expect(page.getByRole('alert')).toContainText('Open Publish to try again.');
  await publish.click();
  await expect(review.getByRole('heading')).toHaveText('Publish v1?');
  await review.getByRole('button', { name: 'Request approval' }).click();
  await expect(page.getByRole('dialog', { name: 'Publication approval' })).toBeVisible();
  await expect(page.getByText(/Could not request approval for test-flow v1/)).toHaveCount(0);
});

test('a publish request confirms the original workflow after switching workflows', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await mockCreator(page, { publish: () => pending });
  await createDraft(page);
  try {
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('button', { name: 'Request approval' }).click();
    await expect(page.getByRole('button', { name: 'Requesting approval…', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await page.getByRole('complementary', { name: 'Workflow library' }).getByRole('button', { name: 'New workflow' }).click();
    const id = page.getByLabel('Workflow id', { exact: true });
    await expect(id).toBeFocused();
    release();
    await expect(page.getByRole('status').filter({ hasText: 'Requested approval for test-flow v1.' })).toBeVisible();
    const approval = page.getByRole('dialog', { name: 'Publication approval' });
    await expect(approval).toHaveCount(0);
    await expect(id).toBeFocused();
  } finally {
    release();
  }
});

test('approval stays attached to the version that was submitted', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  let releasePublish: () => void = () => {};
  const publishing = new Promise<void>((resolve) => { releasePublish = resolve; });
  await mockCreator(page, {
    publish: async (version) => {
      expect(version).toBe(2);
      await publishing;
    },
  });
  await createDraft(page);
  const originalName = 'AnnualReview'.repeat(10);
  const saveNotice = page.getByRole('status').filter({ hasText: 'Saved v1 as draft.' });
  await expect(saveNotice).toBeVisible();
  await page.getByRole('button', { name: 'Edit workflow name' }).click();
  await expect(saveNotice).toBeVisible();
  await page.getByRole('textbox', { name: 'Workflow name' }).fill(originalName);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Workflow commands' });
  await expect(toolbar).toContainText('v2 · saved');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review publication' });
  await expect(review.getByRole('heading')).toHaveText('Publish v2?');
  expect(await review.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await expect(review.getByRole('definition').filter({ hasText: 'test-flow' })).toBeVisible();
  const request = page.waitForRequest('**/workflows/test-flow/publish');
  await page.getByRole('button', { name: 'Request approval' }).click();
  await request;

  await page.getByRole('button', { name: 'Edit workflow name' }).click();
  await page.getByRole('textbox', { name: 'Workflow name' }).fill('New draft name');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toolbar).toContainText('v3 · saved');
  releasePublish();

  const approval = page.getByRole('dialog', { name: 'Publication approval' });
  await expect(approval.getByRole('heading', { name: 'Review v2' })).toBeVisible();
  await expect(approval.getByRole('definition').filter({ hasText: originalName })).toBeVisible();
  expect(await approval.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await expect(approval.getByText('This decision applies to v2. The editor is open to v3.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Review approval for v2' }).click();
  let finishDecision!: () => void;
  const decision = new Promise<void>((resolve) => { finishDecision = resolve; });
  let attempts = 0;
  await page.route('**/api/approvals/42/decide', async (route) => {
    if (++attempts === 1) {
      await route.fulfill({ status: 503, json: { error: 'Temporarily unavailable.' } });
      return;
    }
    await decision;
    await route.fallback();
  });
  try {
    const comment = approval.getByRole('textbox', { name: 'Comment (optional)' });
    await comment.fill('Ready for publication');
    await approval.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(approval.getByRole('alert')).toContainText('Could not save the decision.');
    await expect(comment).toHaveValue('Ready for publication');
    await approval.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(approval.getByRole('status')).toHaveText('Saving decision…');
    await expect(approval.getByRole('textbox', { name: 'Comment (optional)' })).toBeDisabled();
  } finally {
    finishDecision();
  }
  await expect(page.getByText('Published test-flow v2.')).toBeVisible();
  await expect(page.getByText('Requested approval for test-flow v2.', { exact: true })).toHaveCount(0);
  await expect(toolbar).toContainText('draft v3');
});

for (const width of [320, 820, 920]) test(`find and show a step with the inspector open at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 640 });
  await mockCreator(page);
  await createDraft(page);
  const actions = page.getByRole('group', { name: 'Workflow actions' });
  await expect(actions.getByRole('button')).toHaveCount(4);
  const buttons = await actions.getByRole('button').evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().toJSON()),
  );
  expect(new Set(buttons.map((button) => button.top)).size).toBe(1);
  expect(buttons.every((button) => button.left >= 0 && button.right <= width)).toBe(true);

  const finder = page.getByRole('button', { name: 'Find step', exact: true });
  await finder.click();
  await page.getByRole('dialog', { name: 'Find step' }).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(finder).toBeFocused();
  await finder.click();
  const search = page.getByRole('searchbox', { name: 'Search by name, ID, or type' });
  await expect(search).toBeFocused();
  await search.fill('start');
  await search.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Step: Start' })).toBeVisible();
  await expect.poll(() => page.evaluate((desktop) => {
    const step = document.querySelector('.react-flow__node[data-id="start"]');
    const inspector = document.querySelector('.inspector');
    if (!step || !inspector) return false;
    const nodeBounds = step.getBoundingClientRect();
    const panelBounds = inspector.getBoundingClientRect();
    return desktop ? nodeBounds.right < panelBounds.left : nodeBounds.bottom < panelBounds.top;
  }, width > 900)).toBe(true);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reset view', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  await expect.poll(() => page.locator('.react-flow__node').evaluateAll((nodes, desktop) => {
    const panel = document.querySelector('.inspector')?.getBoundingClientRect();
    return Boolean(panel && nodes.length === 2 && nodes.every((node) => {
      const bounds = node.getBoundingClientRect();
      return desktop ? bounds.right < panel.left : bounds.bottom < panel.top;
    }));
  }, width > 900)).toBe(true);
  const addStep = page.getByRole('button', { name: '+ Add step', exact: true });
  await addStep.click();
  const palette = page.getByRole('dialog', { name: 'Add step' });
  await expect(palette.getByRole('searchbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await expect(addStep).toBeFocused();
});

test('retry loading data models without losing the output name', async ({ page }) => {
  let unavailable = true;
  await mockCreator(page, { modelListUnavailable: () => unavailable });
  await createDraft(page);
  await page.getByRole('button', { name: 'Find step', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search by name, ID, or type' });
  await search.fill('Finish');
  await search.press('Enter');
  const finish = page.getByRole('complementary', { name: 'Finish', exact: true });
  await expect(finish.getByText('Add an output to return a step result or a field from a data model.')).toBeVisible();
  await finish.getByRole('button', { name: '+ Add output', exact: true }).click();
  await finish.getByLabel('Output name').fill('team');
  await finish.getByLabel('Source type').selectOption('model');

  await expect(finish.getByRole('alert')).toHaveText('Could not load data models.');
  unavailable = false;
  await finish.getByRole('button', { name: 'Retry', exact: true }).click();
  await finish.getByLabel('Data model', { exact: true }).selectOption('teams');
  await expect(finish.getByLabel('Data model', { exact: true })).toHaveAttribute('aria-required', 'true');
  await expect(finish.getByLabel('Model field', { exact: true })).toHaveAttribute('aria-required', 'true');
  await expect(finish.getByLabel('Model field').locator('option[value="Team"]')).toHaveCount(1);
  await expect(finish.getByLabel('Output name')).toHaveValue('team');
  await finish.getByRole('button', { name: 'Cancel', exact: true }).click();
  const addOutput = finish.getByRole('button', { name: '+ Add output', exact: true });
  await expect(addOutput).toBeFocused();
  await addOutput.press('Enter');
  await expect(finish.getByLabel('Output name')).toHaveValue('');
  await expect(finish.getByLabel('Source type')).toHaveValue('step');
  await finish.getByLabel('Step result', { exact: true }).selectOption('$path');
  const path = finish.getByLabel('Step output', { exact: true });
  await expect(path).toBeFocused();
  await expect(path).toHaveAccessibleDescription('Enter the step ID and field separated by a dot.');
  await finish.getByLabel('Output name', { exact: true }).fill('result');
  await path.fill('  start.item  ');
  await finish.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(finish.getByLabel('Source for result', { exact: true })).toHaveValue('start.item');
});

test('Finish restores a saved model source after a delayed model list loads', async ({ page }) => {
  let releaseModels!: () => void;
  const modelList = new Promise<void>((resolve) => { releaseModels = resolve; });
  await mockCreator(page, {
    beforeModelList: () => modelList,
    saved: [{
      workflow_id: 'test-flow', version: 1, name: 'Saved model output', status: 'draft',
      definition: {
        workflow_id: 'test-flow',
        steps: [{ step_id: 'start', type: 'input_collection', on_success: 'end' }],
        inputs: [{ name: 'team', type: 'string', designer: { type: 'Teams', field: 'Team', mode: 'value' } }],
        outputs: { result: { from: 'team' } },
      },
    }],
  });
  try {
    await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
    await page.getByRole('button', { name: 'Saved model output', exact: true }).click();
    await page.locator('.end-node').click();
    const finish = page.getByRole('complementary', { name: 'Finish' });
    await finish.getByRole('button', { name: 'Change source for result' }).click();
    await expect(finish.getByRole('status')).toContainText('Loading model data');
    releaseModels();
    await expect(finish.getByLabel('Data model', { exact: true })).toHaveValue('teams');
    await expect(finish.getByLabel('Data model', { exact: true }).locator('option:checked')).toHaveText('Teams (v1)');
    await expect(finish.getByLabel('Model field', { exact: true })).toHaveValue('Team');
  } finally {
    releaseModels();
  }
});

test('Finish explains a removed model field and lets you replace it', async ({ page }) => {
  await mockCreator(page, {
    saved: [{
      workflow_id: 'test-flow', version: 1, name: 'Saved model output', status: 'draft',
      definition: {
        workflow_id: 'test-flow',
        steps: [{ step_id: 'start', type: 'input_collection', on_success: 'end' }],
        inputs: [{ name: 'team', type: 'string', designer: { type: 'teams', field: 'Old Team', mode: 'value' } }],
        outputs: { result: { from: 'team' } },
      },
    }],
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Saved model output', exact: true }).click();
  await page.locator('.end-node').click();
  const finish = page.getByRole('complementary', { name: 'Finish' });
  await finish.getByRole('button', { name: 'Change source for result' }).click();
  await expect(finish.getByRole('alert')).toContainText('Old Team is no longer active in Teams v1');
  const save = finish.getByRole('button', { name: 'Apply', exact: true });
  await expect(save).toBeDisabled();
  await finish.getByLabel('Model field', { exact: true }).selectOption('Team');
  await save.click();
  await expect(finish.getByLabel('Source for result', { exact: true })).toHaveAccessibleDescription('Data model · Teams · Team');
});

test('Finish labels an archived model on a saved output', async ({ page }) => {
  await mockCreator(page, {
    modelArchived: true,
    saved: [{
      workflow_id: 'test-flow', version: 1, name: 'Saved model output', status: 'draft',
      definition: {
        workflow_id: 'test-flow',
        steps: [{ step_id: 'start', type: 'input_collection', on_success: 'end' }],
        inputs: [{ name: 'team', type: 'string', designer: { type: 'teams', field: 'Team', mode: 'value' } }],
        outputs: { result: { from: 'team' } },
      },
    }],
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Saved model output', exact: true }).click();
  await page.locator('.end-node').click();
  const finish = page.getByRole('complementary', { name: 'Finish' });
  await expect(finish.getByText('Data model · Teams · Team · Archived', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(finish.getByLabel('Source for result', { exact: true })).toHaveAccessibleDescription('Data model · Teams · Team · Archived');
  await finish.getByRole('button', { name: '+ Add output', exact: true }).click();
  await finish.getByLabel('Source type').selectOption('model');
  await expect(finish.getByLabel('Data model', { exact: true }).locator('option[value="teams"]')).toHaveCount(0);
});

test('two model outputs share one input and removing both clears it', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const rows = await mockCreator(page);
  await createDraft(page);
  await page.getByRole('button', { name: 'Find step', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search by name, ID, or type' });
  await search.fill('Finish');
  await search.press('Enter');
  const finish = page.getByRole('complementary', { name: 'Finish' });

  for (const name of ['team', 'team_copy']) {
    await finish.getByRole('button', { name: '+ Add output', exact: true }).click();
    await expect(finish.getByLabel('Output name')).toBeFocused();
    await finish.getByLabel('Output name').fill(name);
    await finish.getByLabel('Source type').selectOption('model');
    await finish.getByLabel('Data model', { exact: true }).selectOption('teams');
    await finish.getByLabel('Model field').selectOption('Team');
    await finish.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(finish.getByText('2 mapped')).toBeVisible();
  expect(await finish.evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true);
  await expect(finish.getByText(/Data model.*Teams.*Team$/).filter({ visible: true })).toHaveCount(2);
  await finish.getByRole('button', { name: '+ Add output', exact: true }).click();
  const outputName = finish.getByLabel('Output name');
  await outputName.fill(' team ');
  const stepResult = finish.getByLabel('Step result');
  await expect(stepResult.getByRole('option', { name: 'Start · item' })).toBeAttached();
  await stepResult.selectOption('start.item');
  await expect(outputName).toHaveAccessibleDescription('That output name is already in use.');
  await outputName.press('Enter');
  await expect(finish.getByText('2 mapped')).toBeVisible();
  await outputName.fill('submitted');
  const sourceType = finish.getByLabel('Source type');
  await sourceType.selectOption('model');
  await finish.getByLabel('Data model', { exact: true }).selectOption('teams');
  await finish.getByLabel('Model field').selectOption('Team');
  await sourceType.selectOption('step');
  await expect(finish.getByLabel('Output name')).toHaveValue('submitted');
  await expect(stepResult).toHaveValue('');
  const add = finish.getByRole('button', { name: 'Add', exact: true });
  await expect(add).toBeDisabled();
  await stepResult.selectOption('start.item');
  await finish.getByLabel('Output name').press('Enter');
  await expect(finish.getByRole('button', { name: '+ Add output', exact: true })).toBeFocused();
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.outputs).toEqual({
    team: { from: 'model_team' },
    team_copy: { from: 'model_team' },
    submitted: { from: 'start.item' },
  });
  expect(rows[0].definition.inputs?.filter((input) => input.designer)).toHaveLength(1);

  const changeTeam = finish.getByRole('button', { name: 'Change source for team', exact: true });
  await changeTeam.press('Enter');
  await expect(finish.getByLabel('Output name')).toHaveValue('team');
  await expect(finish.getByText('Current source Data model · Teams · Team', { exact: true })).toBeVisible();
  await expect(finish.getByLabel('Source type')).toHaveValue('model');
  await expect(finish.getByLabel('Source type')).toBeFocused();
  await expect(finish.getByLabel('Model field')).toHaveValue('Team');
  await finish.getByLabel('Source type').selectOption('step');
  await finish.getByLabel('Step result').selectOption('start.item');
  await finish.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(changeTeam).toBeFocused();
  await expect(finish.getByLabel('Source for team', { exact: true })).toHaveValue('model_team');
  await changeTeam.press('Enter');
  await finish.getByLabel('Source type').selectOption('step');
  await finish.getByLabel('Step result').selectOption('start.item');
  await finish.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(changeTeam).toBeFocused();
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.outputs?.team).toEqual({ from: 'start.item' });
  expect(rows[0].definition.inputs?.filter((input) => input.designer)).toHaveLength(1);

  await changeTeam.press('Enter');
  await expect(finish.getByLabel('Step result')).toHaveValue('start.item');
  await expect(finish.getByText('Current source start.item', { exact: true })).toBeVisible();
  await finish.getByLabel('Source type').selectOption('model');
  await finish.getByLabel('Data model', { exact: true }).selectOption('teams');
  await finish.getByLabel('Model field').selectOption('Team');
  await finish.getByRole('button', { name: 'Apply', exact: true }).click();
  const teamSource = finish.getByLabel('Source for team', { exact: true });
  await expect(teamSource).toHaveValue('model_team');
  await page.keyboard.press('Control+z');
  await expect(teamSource).toHaveValue('start.item');
  await teamSource.fill('  start.item  ');
  await teamSource.press('Tab');
  await expect(teamSource).toHaveValue('start.item');

  await finish.getByRole('button', { name: 'Remove output team', exact: true }).click();
  const remainingRemoval = finish.getByRole('button', { name: 'Remove output team_copy', exact: true });
  await expect(remainingRemoval).toBeFocused();
  await remainingRemoval.press('Enter');
  const finalRemoval = finish.getByRole('button', { name: 'Remove output submitted', exact: true });
  await expect(finalRemoval).toBeFocused();
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.inputs?.map((input) => input.name)).toEqual(['item']);
  expect(rows[0].definition.outputs).toEqual({ submitted: { from: 'start.item' } });
  await finalRemoval.press('Enter');
  await expect(finish.getByRole('button', { name: '+ Add output', exact: true })).toBeFocused();
});

test('find a workflow by an earlier saved name on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCreator(page, {
    saved: [{
      workflow_id: 'shipping', name: 'Shipping report', version: 1, status: 'published',
      created_at: '2026-11-22T06:00:00Z', definition: { workflow_id: 'shipping' },
    }, ...['Monthly report', 'Billing report', 'Billing report'].map((name, index) => ({
      workflow_id: 'test-flow',
      name,
      version: index + 1,
      status: 'draft',
      created_at: '2026-11-22T05:00:00Z',
      definition: { workflow_id: 'test-flow', name },
    })).reverse()],
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search', exact: true });
  await expect(search).toBeFocused();
  await search.press('Escape');
  await expect(search).toHaveCount(0);
  const open = page.getByRole('button', { name: 'Open workflow', exact: true });
  await expect(open).toBeFocused();
  await open.press('Enter');
  await expect(search).toBeFocused();
  const library = page.getByRole('complementary', { name: 'Workflow library' });
  const sorted = library.getByRole('button', { name: /^(Billing|Shipping) report$/ });
  await expect(sorted).toHaveText(['Billing report', 'Shipping report']);
  await library.getByLabel('Sort by').selectOption('recent');
  await expect(sorted).toHaveText(['Shipping report', 'Billing report']);
  await expect(library.locator('time[datetime="2026-11-22T06:00:00Z"]')).toBeVisible();
  expect(await library.evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true);
  await search.fill('Monthly report');
  await expect(page.getByRole('button', { name: 'Billing report', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Billing report' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click({ trial: true });
  await page.getByRole('menuitem', { name: 'Versions', exact: true }).click();
  const history = page.getByRole('list', { name: 'Versions of Billing report' });
  await expect(history.getByText('Monthly report', { exact: true })).toBeVisible();
  expect(await history.evaluate((list) => list.scrollWidth <= list.clientWidth)).toBe(true);
  const compareFromHistory = history.getByRole('button', { name: 'Compare v1 with latest' });
  await compareFromHistory.click();
  const comparison = page.getByRole('dialog', { name: 'Compare versions' });
  await expect(comparison.getByLabel('From version')).toHaveValue('1');
  await expect(comparison.getByLabel('To version')).toHaveValue('3');
  await comparison.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(compareFromHistory).toBeFocused();
  await search.press('Enter');
  await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toContainText('v3');
});

test('compare two saved definitions from the library', async ({ page }) => {
  await mockCreator(page);
  await createDraft(page);
  await page.getByRole('button', { name: '+ Add step', exact: true }).click();
  await page.getByRole('button', { name: /Set results/ }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Workflow commands' });
  await expect(toolbar).toContainText('v2 · saved');

  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  await page.getByRole('button', { name: 'Untitled', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Workflow library' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Untitled' }).click();
  await page.getByRole('menuitem', { name: 'Versions', exact: true }).click();
  const history = page.getByRole('list', { name: 'Versions of Untitled' });
  await expect(history.locator('time[datetime="2026-11-22T05:00:00Z"]')).toHaveCount(2);
  await expect(history.getByRole('button', { name: 'v2 (draft)', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(history.getByText('Open in editor', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'v2 (draft)', exact: true }).click();
  await expect(history).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node[data-id="step2"]')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(page.locator('.react-flow__node[data-id="step2"]')).toBeVisible();
  await page.route('**/api/workflows/test-flow', (route) => route.fulfill({ status: 503, json: {} }), { times: 1 });
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Untitled' }).click();
  await page.getByRole('menuitem', { name: 'Compare versions' }).click();
  const dialog = page.getByRole('dialog', { name: 'Compare versions' });
  await expect(dialog.getByRole('alert')).toContainText('Could not load versions.');
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByLabel('From version')).toHaveValue('1');
  await expect(dialog.getByLabel('To version')).toHaveValue('2');
  const changes = dialog.getByRole('list', { name: 'Version changes' });
  await dialog.getByLabel('Show changes').selectOption('Added');
  await expect(changes.getByRole('listitem')).toHaveCount(1);
  await dialog.getByLabel('Show changes').selectOption('all');
  const added = changes.getByRole('listitem').filter({ hasText: 'Step · Set results' });
  await expect(added).toContainText('Added');
  await added.getByText('Show changes for Set results', { exact: true }).click();
  await expect(added.getByRole('region', { name: 'From v1' })).toContainText('Not set');
  await expect(added.getByRole('region', { name: 'To v2' })).toContainText('"type": "output_composition"');
  await expect(changes.getByRole('listitem').filter({ hasText: 'Step · Start' })).toContainText('Changed');
  await changes.getByText('Show changes for Start', { exact: true }).click();
  await expect(changes.getByRole('listitem').filter({ hasText: 'Step · Start' }).getByRole('region', { name: 'From v1' })).toContainText('"on_success": "end"');
  await expect(changes.getByRole('listitem').filter({ hasText: 'Step · Start' }).getByRole('region', { name: 'To v2' })).toContainText('"on_success": "step2"');
  await dialog.getByLabel('Show changes').selectOption('Added');
  await dialog.getByRole('button', { name: 'Swap versions', exact: true }).click();
  await expect(dialog.getByLabel('Show changes')).toHaveValue('Removed');
  await expect(changes.getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByLabel('From version')).toHaveValue('2');
  await expect(dialog.getByLabel('To version')).toHaveValue('1');
  await expect(added).toContainText('Removed');
  await added.getByText('Show changes for Set results', { exact: true }).click();
  await expect(added.getByRole('region', { name: 'From v2' })).toContainText('"type": "output_composition"');
  await expect(added.getByRole('region', { name: 'To v1' })).toContainText('Not set');
});

test('version comparison identifies steps that share a name', async ({ page }) => {
  const saved = [2, 1].map((version): WorkflowVersionRow => ({
    workflow_id: 'test-flow', name: 'Shared names', version, status: 'draft',
    definition: {
      workflow_id: 'test-flow',
      steps: ['first', 'second'].map((step_id) => ({
        step_id, name: 'Review', type: 'human_approval', config: { prompt: `Review ${version}`, route: 'same' },
      })),
    },
  }));
  await mockCreator(page, { saved });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Shared names' }).click();
  await page.getByRole('menuitem', { name: 'Compare versions' }).click();
  const comparison = page.getByRole('dialog', { name: 'Compare versions' });
  await expect(comparison.getByLabel('Workflow being compared').getByRole('definition').filter({ hasText: 'test-flow' })).toBeVisible();
  await expect(comparison.getByRole('status')).toHaveText('2 changes');
  const changes = page.getByRole('list', { name: 'Version changes' });
  await expect(changes.getByText('Step · Review (first)', { exact: true })).toBeVisible();
  await expect(changes.getByText('Step · Review (second)', { exact: true })).toBeVisible();
  const first = changes.getByRole('listitem').filter({ hasText: 'Step · Review (first)' });
  await first.getByText('Show changes for Review (first)', { exact: true }).click();
  await expect(first.getByRole('region', { name: 'To v2' })).toContainText('"prompt": "Review 2"');
  await expect(first.getByRole('region', { name: 'To v2' })).not.toContainText('"route"');
});

test('compare versions with only a canvas layout change on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCreator(page, {
    saved: [40, 240].map((x, index) => ({
      workflow_id: 'test-flow',
      name: 'Layout test',
      version: index + 1,
      status: 'draft',
      definition: {
        workflow_id: 'test-flow',
        name: 'Layout test',
        steps: [{ step_id: 'start', type: 'input_collection', on_success: 'end' }],
        ui: { positions: { start: { x, y: 70 } } },
      },
    })).reverse(),
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Layout test' }).click();
  await page.getByRole('menuitem', { name: 'Compare versions' }).click();
  const dialog = page.getByRole('dialog', { name: 'Compare versions' });
  const changes = dialog.getByRole('list', { name: 'Version changes' });
  await expect(changes.getByRole('listitem')).toHaveCount(1);
  await changes.getByText('Show changes for Canvas layout', { exact: true }).click();
  await expect(changes.getByRole('region', { name: 'From v1' })).toContainText('"x": 40');
  await expect(changes.getByRole('region', { name: 'To v2' })).toContainText('"x": 240');
  await page.keyboard.press('Tab');
  await expect(changes.getByLabel('Configuration from v1')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(changes.getByLabel('Configuration from v2')).toBeFocused();
  const fromBounds = await changes.getByRole('region', { name: 'From v1' }).boundingBox();
  const toBounds = await changes.getByRole('region', { name: 'To v2' }).boundingBox();
  expect(fromBounds).not.toBeNull();
  expect(toBounds).not.toBeNull();
  expect(toBounds!.y).toBeGreaterThan(fromBounds!.y);
  expect(await changes.evaluate((list) => list.scrollWidth <= list.clientWidth)).toBe(true);
  await dialog.getByLabel('From version').selectOption('2');
  await expect(dialog.getByText('Choose two different versions to compare.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Swap versions' })).toBeDisabled();
});

test('move a workflow input and compare the saved input order', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const inputs = ['item', 'quantity'].map((name) => ({ name, type: 'string' }));
  const rows = await mockCreator(page, { saved: [{
    workflow_id: 'test-flow',
    name: 'Input order test',
    version: 1,
    status: 'draft',
    definition: {
      workflow_id: 'test-flow',
      name: 'Input order test',
      inputs,
      steps: [{ step_id: 'start', type: 'input_collection', name: 'Start', config: { fields: ['item', 'quantity'], prompt: '' }, on_success: 'end' }],
    },
  }] });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Input order test', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settingsInputs = page.getByRole('region', { name: 'Inputs', exact: true });
  await expect(settingsInputs).toBeVisible();
  expect(await settingsInputs.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Move input quantity up' }).click();
  await expect(page.getByLabel('Input 1 name')).toHaveValue('quantity');
  await expect(page.getByLabel('Input 1 name')).toBeFocused();
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.inputs?.map((input) => input.name)).toEqual(['quantity', 'item']);
  expect(rows[0].definition.steps?.[0].config?.fields).toEqual(['quantity', 'item']);
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Input order test' }).click();
  await page.getByRole('menuitem', { name: 'Compare versions' }).click();
  await expect(page.getByText('Show changes for Input order', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Compare versions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Actions for Input order test' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Actions for Input order test' })).toHaveCount(0);
  await expect(settingsInputs).toBeVisible();
});

test('removing the last loop step points back to the empty loop', async ({ page }) => {
  const rows = await mockCreator(page, { saved: [{
    workflow_id: 'test-flow',
    name: 'Loop test',
    version: 1,
    status: 'draft',
    definition: {
      workflow_id: 'test-flow',
      name: 'Loop test',
      inputs: [{ name: 'items', type: 'array' }],
      steps: [{
        step_id: 'repeat',
        type: 'iteration',
        config: { over: 'items', body: [{ step_id: 'check', name: 'Check item', type: 'human_approval', on_success: 'end' }] },
        on_success: 'end',
      }],
    },
  }] });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Loop test', exact: true }).click();
  await page.getByRole('button', { name: 'Find step', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search by name, ID, or type' });
  await search.fill('Check item');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Delete step', exact: true }).click();
  const loop = page.getByRole('complementary', { name: 'Step: repeat', exact: true });
  await expect(loop.getByLabel('List source')).toHaveValue('items');
  await page.getByRole('button', { name: 'Issues (1)', exact: true }).click();
  await page.getByRole('button', { name: /Add at least one step inside loop.*Go to step repeat/ }).click();
  await expect(loop.getByLabel('List source')).toBeVisible();
  await loop.getByLabel('Body step type').selectOption('output_composition');
  await loop.getByRole('button', { name: 'Add to body' }).click();
  const results = page.getByRole('complementary', { name: 'Body step: Set results' });
  await expect(results.getByRole('heading', { name: 'Set results', exact: true })).toBeFocused();
  await results.getByRole('button', { name: /Back to loop/ }).click();
  const connectAfter = loop.getByLabel('Connect after');
  await expect(connectAfter).toHaveValue('b1');
  await expect(connectAfter.getByRole('option', { name: 'Set results (b1)' })).toHaveCount(1);
  await connectAfter.selectOption('b1');
  await loop.getByLabel('Body step type').selectOption('output_composition');
  await loop.getByRole('button', { name: 'Add to body' }).click();
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.steps?.[0].config?.body).toMatchObject([
    { step_id: 'b1', type: 'output_composition', config: { mapping: {} }, on_success: 'b2' },
    { step_id: 'b2', type: 'output_composition', config: { mapping: {} }, on_success: 'end' },
  ]);
  await results.getByRole('button', { name: /Back to loop/ }).click();
  await expect(loop.getByText('On success → Set results (b2)', { exact: true })).toBeVisible();
  await loop.getByRole('button', { name: 'Set results (b1)', exact: true }).click();
  await results.getByLabel('On failure', { exact: true }).selectOption('b2');
  await results.getByRole('button', { name: /Back to loop/ }).click();
  await expect(loop.getByText('On failure → Set results (b2)', { exact: true })).toBeVisible();
  await connectAfter.selectOption('');
  await loop.getByLabel('Body step type').selectOption('conditional_routing');
  await loop.getByRole('button', { name: 'Add to body' }).click();
  await page.getByRole('button', { name: 'Issues (1)', exact: true }).click();
  await page.getByRole('button', { name: /No route inside loop.*Go to step b3/ }).click();
  await expect(page.getByRole('complementary', { name: 'Body step: Branch' })).toBeVisible();
  const branch = page.getByRole('complementary', { name: 'Body step: Branch' });
  await branch.getByRole('button', { name: 'Add rule', exact: true }).click();
  await page.getByRole('button', { name: 'Issues (2)', exact: true }).click();
  const filters = page.getByRole('group', { name: 'Filter issues' });
  const issueRows = page.getByRole('complementary', { name: 'Validation issues' }).getByRole('button', { name: /^(Error|Warning)\./ });
  await expect(issueRows.first()).toHaveAccessibleName(/^Error\./);
  await expect(issueRows.last()).toHaveAccessibleName(/^Warning\./);
  await expect(filters.getByRole('button', { name: 'All (2)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(filters.getByRole('button', { name: 'Warnings (1)', exact: true })).toBeVisible();
  await filters.getByRole('button', { name: 'Errors (1)', exact: true }).click();
  await expect(page.getByRole('button', { name: /No route inside loop/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Choose a value source for rule 1.*Go to step b3/ }).click();
  await expect(branch.getByRole('heading', { name: 'Branch', exact: true })).toBeFocused();
});

test('repair a branch whose saved destination is missing', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 720 });
  const rows = await mockCreator(page, { saved: [{
    workflow_id: 'test-flow',
    name: 'Branch repair',
    version: 1,
    status: 'draft',
    definition: {
      workflow_id: 'test-flow',
      name: 'Branch repair',
      steps: [
        { step_id: 'route', type: 'conditional_routing', on_success: 'missing_default', config: {
          rules: [
            { when: { ref: 'total', op: 'gt', value: 100 }, goto: 'missing_review' },
            { when: { all: [{ ref: 'total', op: 'exists' }] }, goto: 'end' },
          ],
        } },
        { step_id: 'review_a', name: 'Review', type: 'human_approval', on_success: 'end' },
        { step_id: 'review_b', name: 'Review', type: 'human_approval', on_success: 'end' },
      ],
    },
  }] });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Branch repair', exact: true }).click();
  await page.getByRole('button', { name: 'Find step', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search by name, ID, or type' });
  await search.fill('route');
  await search.press('Enter');
  await page.getByRole('button', { name: /Issues \(/ }).click();
  await page.getByRole('button', { name: /rule 1 points at missing step "missing_review"/ }).click();
  const destination = page.getByLabel('Go to', { exact: true }).first();
  await expect(destination).toBeFocused();
  await expect(destination).toHaveAttribute('aria-invalid', 'true');
  await expect(destination).toHaveValue('missing_review');
  await expect(destination.getByRole('option', { name: 'Unavailable: missing_review' })).toHaveCount(1);
  await destination.selectOption({ label: 'Review (review_b)' });
  await page.getByRole('button', { name: /Issues \(/ }).click();
  await page.getByRole('button', { name: /next step points at missing step "missing_default"/ }).click();
  const fallback = page.getByLabel('If no rule matches', { exact: true });
  await expect(fallback).toBeFocused();
  const followFallback = page.getByRole('button', { name: 'Follow fallback route', exact: true });
  await expect(followFallback).toBeDisabled();
  await fallback.selectOption('end');
  await expect(followFallback).toBeEnabled();
  await expect(page.locator('.react-flow__node[data-id="route"]').getByTitle('If no rule matches')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge[data-id="ok:route"]')).toContainText('Rule 2 or if no rule matches');
  await expect(page.locator('.react-flow__edge[data-id="ok:route"]')).toHaveAccessibleName('Rule 2 or if no rule matches. Edge from route to Finish');
  await expect(page.locator('.react-flow__edge[data-id="cond:route:1"]')).toHaveCount(0);
  const fit = page.getByRole('button', { name: 'Fit graph', exact: true });
  await fit.click({ trial: true });
  const inspector = page.getByRole('complementary', { name: 'Step: route', exact: true });
  expect((await inspector.boundingBox())?.width).toBeLessThan(520);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click({ trial: true });
  const condition = page.getByLabel('Condition JSON');
  for (const invalid of ['null', '{}']) {
    await condition.fill(invalid);
    await condition.blur();
    await expect(page.getByText('Use an all or any list, or provide a ref and op.')).toBeVisible();
  }
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.steps?.[0].config?.rules).toEqual([
    { when: { ref: 'total', op: 'gt', value: 100 }, goto: 'review_b' },
    { when: { all: [{ ref: 'total', op: 'exists' }] }, goto: 'end' },
  ]);
  const branch = page.getByRole('region', { name: 'Branch rules' });
  await branch.getByRole('button', { name: 'Add rule', exact: true }).click();
  await expect(branch.getByLabel('Value source', { exact: true }).last()).toBeFocused();
  await page.getByRole('button', { name: /^Issues \(/ }).click();
  await expect(page.getByRole('button', { name: /Choose a value source for rule 3.*Go to step route/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close issues', exact: true }).click();
  await followFallback.click();
  const finish = page.getByRole('complementary', { name: 'Finish', exact: true });
  await expect(finish.getByRole('heading', { name: 'Finish', exact: true })).toBeFocused();
});

test('keep numeric drafts editable and save only valid limits', async ({ page }) => {
  const rows = await mockCreator(page);
  await createDraft(page);
  await page.getByRole('button', { name: '+ Add step', exact: true }).click();
  await page.getByRole('button', { name: /Look up data/ }).click();
  const limit = page.getByRole('spinbutton', { name: 'Limit', exact: true });
  await limit.fill('0');
  await limit.press('Tab');
  await expect(page.getByText('Enter a number of at least 1.')).toBeVisible();
  await limit.fill('3.5');
  await limit.press('Tab');
  await expect(page.getByText('Enter a whole number.')).toBeVisible();
  await limit.fill('25');
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.steps?.[1]?.config?.limit).toBe(25);
  await limit.clear();
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.steps?.[1]?.config?.limit).toBeUndefined();
});

test('open and navigate a 100-step workflow', async ({ page }) => {
  const steps = Array.from({ length: 100 }, (_, i) => ({
    step_id: `step_${i + 1}`,
    name: `Review stage ${i + 1}`,
    type: 'human_approval',
    config: { prompt: `Review stage ${i + 1}` },
    on_success: i === 99 ? 'end' : `step_${i + 2}`,
  }));
  await mockCreator(page, {
    saved: [{
      workflow_id: 'test-flow',
      name: '100-step workflow',
      version: 1,
      status: 'draft',
      definition: { workflow_id: 'test-flow', name: '100-step workflow', steps },
    }],
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: '100-step workflow', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(101);
  await page.getByRole('button', { name: 'Find step', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search by name, ID, or type' });
  const finder = page.getByRole('dialog', { name: 'Find step' });
  await search.fill('missing-step-name');
  await expect(finder.getByRole('status')).toHaveText('No matching steps.');
  await finder.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await search.fill('step_87 approval');
  await expect(page.getByRole('dialog', { name: 'Find step' }).getByRole('status')).toHaveText('1 result');
  await search.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Step: Review stage 87' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).focus();
  await page.keyboard.press('/');
  await expect(page.getByRole('dialog', { name: 'Find step' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Find step', exact: true }).focus();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await search.fill('Review stage 8');
  await expect(page.getByRole('dialog', { name: 'Find step' }).getByRole('status')).toHaveText('11 results');
  const exact = page.getByRole('button', { name: /Review stage 8 .*step_8$/ });
  await search.press('ArrowDown');
  await expect(exact).toBeFocused();
  await exact.press('End');
  const last = page.getByRole('button', { name: /Review stage 89 .*step_89$/ });
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await last.press('Home');
  await expect(exact).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Review stage 80 .*step_80$/ })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(exact).toBeFocused();
  await exact.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Step: Review stage 8', exact: true })).toBeVisible();
  const name = page.getByLabel('Step name', { exact: true });
  await name.press('End');
  await name.press('/');
  await expect(name).toHaveValue('Review stage 8/');
  await expect(page.getByRole('dialog', { name: 'Find step' })).toHaveCount(0);
});

test('add missing mappings for the saved calculation version', async ({ page }) => {
  const rows = await mockCreator(page, {
    skills: [
      { name: 'cost', version: 3, status: 'verified', input_params: ['subtotal'] },
      { name: 'cost', version: 2, status: 'verified', input_params: ['quantity', 'price'] },
    ],
    saved: [{
      workflow_id: 'test-flow',
      name: 'Calculate cost',
      version: 1,
      status: 'draft',
      definition: {
        workflow_id: 'test-flow',
        name: 'Calculate cost',
        inputs: [{ name: 'units', type: 'number' }],
        steps: [{
          step_id: 'cost',
          type: 'skill_execution',
          config: { skill: { name: 'cost', version: 2 }, inputs_mapping: { quantity: { from: 'units' } } },
          on_success: 'end',
        }],
      },
    }],
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Calculate cost', exact: true }).click();
  await page.locator('.react-flow__node[data-id="cost"]').click();
  await expect(page.getByText('Parameters: quantity, price')).toBeVisible();
  await expect(page.getByText('Parameters: subtotal')).toHaveCount(0);
  const add = page.getByRole('button', { name: 'Add missing parameter mappings' });
  await add.click();
  await expect(page.getByLabel('Source for quantity')).toHaveValue('units');
  const bindings = page.getByRole('region', { name: 'Bindings', exact: true });
  await bindings.getByRole('button', { name: '+ Add binding', exact: true }).click();
  const key = bindings.getByLabel('New binding key');
  await expect(key).toBeFocused();
  await key.fill(' quantity ');
  await bindings.getByLabel('New binding source').fill('another_input');
  await expect(key).toHaveAttribute('aria-invalid', 'true');
  await expect(bindings.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await expect(bindings.getByLabel('Source for quantity')).toHaveValue('units');

  await expect(page.getByLabel('Source for price')).toHaveValue('');
  await expect(add).toHaveCount(0);
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => rows[0].definition.steps?.[0].config?.inputs_mapping).toMatchObject({
    quantity: { from: 'units' },
    price: { from: '' },
  });
});

test('a failed calculation inspector download preserves the saved configuration', async ({ page }) => {
  await page.route(skillInspectorModule, (route) => route.abort());
  const config = { skill: { name: 'cost', version: 2 }, inputs_mapping: { quantity: { from: 'units' } } };
  const rows = await mockCreator(page, { saved: [{
    workflow_id: 'test-flow', name: 'Calculate cost', version: 1, status: 'draft',
    definition: {
      workflow_id: 'test-flow', name: 'Calculate cost',
      inputs: [{ name: 'units', type: 'number' }],
      steps: [{ step_id: 'cost', type: 'skill_execution', config, on_success: 'end' }],
    },
  }] });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Calculate cost', exact: true }).click();
  await page.locator('.react-flow__node[data-id="cost"]').click();
  await expect(page.getByRole('alert')).toContainText('Could not load these step settings.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => rows[0].version).toBe(2);
  expect(rows[0].definition.steps?.[0].config).toEqual(config);
});

test('deleting an output source links to Finish and undo restores it', async ({ page }) => {
  const rows = await mockCreator(page, {
    errors: ['outputs.legacy.from: unsupported value'],
    saved: [{
      workflow_id: 'test-flow',
      version: 1,
      name: 'Workflow with output',
      status: 'draft',
      definition: {
        workflow_id: 'test-flow',
        name: 'Workflow with output',
        steps: [
          { step_id: 'start', type: 'input_collection', on_success: 'build' },
          { step_id: 'build', type: 'output_composition', on_success: 'end' },
        ],
        outputs: { report: { from: 'build.report' }, legacy: { from: 42, description: 'Existing report' } },
      },
    }],
  });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Workflow with output', exact: true }).click();
  await page.locator('.react-flow__node[data-id="build"]').click();
  await page.getByRole('button', { name: 'Delete step', exact: true }).click();
  const issues = page.getByRole('button', { name: /^Issues \(/ });
  await issues.press('Enter');
  const missingSource = page.getByTitle('Go to output report', { exact: true }).filter({ hasText: 'build.report' });
  await expect(missingSource).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(issues).toBeFocused();
  await issues.press('Enter');
  await missingSource.click();
  await expect(page.getByRole('complementary', { name: 'Finish', exact: true })).toBeVisible();
  await expect(page.getByLabel('Source for report', { exact: true })).toHaveValue('build.report');
  await expect(page.getByLabel('Source for report', { exact: true })).toHaveAccessibleDescription('This step or input no longer exists.');
  await expect(page.getByText('0 mapped', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Source for report', { exact: true })).toBeFocused();

  await page.keyboard.press('Tab');
  await page.keyboard.press('Control+z');
  await expect(missingSource).toHaveCount(0);
  await expect(page.locator('.react-flow__node[data-id="build"]')).toBeVisible();
  await expect(page.getByLabel('Source for report', { exact: true })).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('1 mapped', { exact: true })).toBeVisible();
  const legacy = page.getByLabel('Source for legacy', { exact: true });
  await expect(legacy).toHaveValue('');
  await expect(legacy).toHaveAccessibleDescription('Choose a source.');
  await legacy.fill('build.report');
  await legacy.press('Enter');
  await expect(legacy).not.toHaveAttribute('aria-invalid', 'true');
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.outputs?.legacy).toEqual({ from: 'build.report', description: 'Existing report' });
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await page.getByTitle('Go to output legacy', { exact: true }).filter({ hasText: 'unsupported value' }).click();
  await expect(legacy).toBeFocused();
});

test('saved generator steps remain readable and keep their configuration', async ({ page }) => {
  const generator = {
    step_id: 'old_document',
    type: 'document_generation' as const,
    config: { template: 'report-template' },
    on_success: 'old_sheet',
  };
  const sheet = {
    step_id: 'old_sheet',
    type: 'artifact_generation' as const,
    config: { kind: 'sheet' },
    on_success: 'old_slides',
  };
  const slides = {
    step_id: 'old_slides',
    type: 'artifact_generation' as const,
    config: { kind: 'slide' },
    on_success: 'end',
  };
  const rows = await mockCreator(page, {
    saved: [{
      workflow_id: 'test-flow',
      version: 1,
      name: 'Legacy workflow',
      status: 'draft',
      definition: {
        workflow_id: 'test-flow',
        name: 'Legacy workflow',
        steps: [generator, sheet, slides],
      },
    }],
  });

  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Legacy workflow', exact: true }).click();
  await expect(page.getByText('Spreadsheet (retired)', { exact: true })).toBeVisible();
  await expect(page.getByText('Presentation (retired)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Find step', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search by name, ID, or type' });
  await search.fill('old_document');
  await search.press('Enter');
  await expect(page.getByText('This generator is retired.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicate after this step' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toContainText('v2');
  expect(rows[0].definition.steps).toMatchObject([generator, sheet, slides]);
});

test('a missing step route is marked invalid until repaired', async ({ page }) => {
  await mockCreator(page, { saved: [{
    workflow_id: 'test-flow', name: 'Broken route', version: 1, status: 'draft',
    definition: { workflow_id: 'test-flow', steps: [
      { step_id: 'start', type: 'input_collection', on_success: 'deleted_step', on_failure: 'deleted_fallback' },
    ] },
  }] });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Broken route', exact: true }).click();
  await expect(page.locator('.react-flow__edge[data-id="ok:start"], .react-flow__edge[data-id="fail:start"]')).toHaveCount(0);
  await page.getByRole('button', { name: /Issues \(/ }).click();
  await page.getByRole('button', { name: /next step points at missing step.*Go to step start/ }).click();
  const route = page.getByLabel('On success', { exact: true });
  await expect(route).toBeFocused();
  await expect(route).toHaveAttribute('aria-invalid', 'true');
  await expect(route).toHaveAccessibleDescription(/This destination is unavailable/);
  await route.selectOption('end');
  await expect(route).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.react-flow__edge[data-id="ok:start"]')).toBeVisible();
  await page.getByRole('button', { name: /Issues \(/ }).click();
  await page.getByRole('button', { name: /failure route points at missing step.*Go to step start/ }).click();
  const failure = page.getByLabel('On failure', { exact: true });
  await expect(failure).toBeFocused();
  await expect(failure).toHaveAttribute('aria-invalid', 'true');
  await failure.selectOption('');
  await expect(failure).not.toHaveAttribute('aria-invalid', 'true');
});

test('changing the success route from the keyboard updates the canvas and saved workflow', async ({ page }) => {
  const rows = await mockCreator(page);
  await createDraft(page);
  await page.getByRole('button', { name: '+ Add step', exact: true }).click();
  await page.getByLabel('Connect after').selectOption('');
  const search = page.getByRole('searchbox', { name: 'Search step types' });
  await search.fill('Set results');
  await search.press('Enter');
  await page.locator('.react-flow__node[data-id="start"]').click();
  const route = page.getByLabel('On success', { exact: true });
  await expect(route).toHaveValue('end');
  await route.press('Home');
  await expect(route).toHaveValue('step2');
  await expect(page.locator('.react-flow__edge[data-id="ok:start"]')).toHaveAttribute('aria-label', /start to step2/);
  const failure = page.getByLabel('On failure', { exact: true });
  await failure.press('End');
  await expect(failure).toHaveValue('end');
  const failureEdge = page.locator('.react-flow__edge[data-id="fail:start"]');
  await expect(failureEdge).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.steps?.find(({ step_id }) => step_id === 'start')?.on_success).toBe('step2');
  expect(rows[0].definition.steps?.find(({ step_id }) => step_id === 'start')?.on_failure).toBe('end');
  await failure.press('Home');
  await expect(failure).toHaveValue('');
  await expect(failureEdge).toHaveCount(0);
  await page.keyboard.press('Control+s');
  await expect.poll(() => rows[0].definition.steps?.find(({ step_id }) => step_id === 'start')?.on_failure).toBeUndefined();
});

test('duplicate a configured step and undo the copy in one action', async ({ page }) => {
  await mockCreator(page);
  await createDraft(page);
  const node = page.locator('.react-flow__node[data-id="start"]');
  await node.click();
  const workflows = page.getByRole('button', { name: 'Workflows', exact: true });
  await workflows.click();
  const library = page.getByRole('complementary', { name: 'Workflow library' });
  await library.getByRole('button', { name: 'Library', exact: true }).press('Escape');
  await expect(library).toHaveCount(0);
  await expect(workflows).toBeFocused();
  await expect(page.getByRole('complementary', { name: 'Step: Start', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete step', exact: true })).toBeDisabled();
  await expect(page.getByText('A workflow needs at least one step.')).toBeVisible();
  const duplicate = page.getByRole('button', { name: 'Duplicate after this step', exact: true });
  const position = await node.evaluate((element) => element.style.transform);
  await duplicate.focus();
  await duplicate.press('ArrowRight');
  expect(await node.evaluate((element) => element.style.transform)).toBe(position);
  const originalX = await node.evaluate((element) => new DOMMatrixReadOnly(element.style.transform).m41);
  await node.focus();
  await node.press('ArrowRight');
  await expect.poll(() => node.evaluate((element) => new DOMMatrixReadOnly(element.style.transform).m41)).toBeGreaterThan(originalX);
  await duplicate.click();
  await expect(page.getByRole('complementary', { name: 'Step: Start copy' })).toBeVisible();
  await expect(page.getByLabel('Fields (comma-separated)')).toHaveValue('item');
  await expect(page.locator('.react-flow__node[data-id="start_copy"]')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node[data-id="start_copy"]')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Step: Start copy' })).toHaveCount(0);
  await expect(node).toBeVisible();
});

for (const [command, option] of [['Preview', 'previewErrors'], ['Validate', 'validateErrors']] as const) {
  test(`${command} links a rejected draft to the affected step`, async ({ page }) => {
    await mockCreator(page, { [option]: ['steps[0].start.config.fields: missing value'] });
    await createDraft(page);
    const trigger = page.getByRole('button', { name: command, exact: true });
    const heading = page.getByRole('heading', { name: 'Issues', exact: true });
    await trigger.click();
    await expect(heading).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(heading).toBeFocused();
    await page.getByRole('button', { name: /Error.*missing value.*Go to step start/ }).click();
    const inspector = page.getByRole('complementary', { name: 'Step: Start' });
    await expect(inspector.getByRole('heading', { name: 'Start', exact: true })).toBeFocused();
    await expect(page.getByRole('complementary', { name: 'Validation issues' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Run plan' })).toHaveCount(0);
  });
}

test('Validate distinguishes warnings from errors', async ({ page }) => {
  await mockCreator(page);
  await createDraft(page);
  await page.getByRole('button', { name: '+ Add step', exact: true }).click();
  await page.getByLabel('Connect after').selectOption('');
  const search = page.getByRole('searchbox', { name: 'Search step types' });
  await search.fill('Set results');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No errors. See Issues for 1 warning.' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Validation issues' }).getByRole('status')).toHaveText('0 errors, 1 warning');
  await expect(page.getByTitle('Go to step step2').filter({ hasText: 'No route' })).toBeVisible();
});

test('Validate and Preview report a rejection with no server details', async ({ page }) => {
  await mockCreator(page);
  await createDraft(page);
  await page.route('**/api/workflows/{validate,preview}', (route) => route.fulfill({ json: { ok: false } }));
  for (const [command, message] of [
    ['Validate', 'Validation failed without an explanation. Try Validate again.'],
    ['Preview', 'Preview failed without an explanation. Try Preview again.'],
  ]) {
    await page.getByRole('button', { name: command, exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: message });
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'Dismiss' }).click();
  }
});

test('Preview reports when the server returns no run plan', async ({ page }) => {
  await mockCreator(page, { omitPreviewPlan: true });
  await createDraft(page);
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  await preview.click();
  await expect(page.getByRole('alert')).toContainText('No run plan was returned. Try Preview again.');
  await expect(page.getByRole('dialog', { name: 'Run plan' })).toHaveCount(0);
  await expect(preview).toBeEnabled();
});

test('an empty Preview step list still shows workflow settings and mappings', async ({ page }) => {
  await mockCreator(page, { saved: [{
    workflow_id: 'test-flow', name: 'Empty plan', version: 1, status: 'draft',
    definition: {
      workflow_id: 'test-flow',
      inputs: [
        { name: 'item', type: 'string', required: true },
        { name: 'model_team', type: 'string', designer: { type: 'Teams', mode: 'value', field: 'Team' } },
      ],
      outputs: { result: { from: 'item' }, team: { from: 'model_team' } },
      policy: { execution_approval: 'always' },
    },
  }] });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Empty plan', exact: true }).click();
  await page.route('**/api/workflows/preview', (route) => route.fulfill({ json: { ok: true, plan: { order: [] } } }));
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const plan = page.getByRole('dialog', { name: 'Run plan' });
  await expect(plan.getByRole('status')).toHaveText('No steps in the plan.');
  await expect(plan.getByRole('region', { name: 'Workflow inputs' })).toContainText('item');
  await expect(plan.getByRole('region', { name: 'Workflow outputs' })).toContainText('result');
  await expect(plan.getByRole('region', { name: 'Workflow outputs' })).toContainText('Data model · Teams · Team');
  await expect(plan.getByLabel('Approval policy')).toContainText('Every run');
  await expect(plan.getByRole('list', { name: 'Unreachable steps' })).toHaveCount(0);
  await plan.getByRole('button', { name: 'Edit outputs in Finish' }).click();
  await expect(page.getByRole('complementary', { name: 'Finish', exact: true }).getByRole('heading', { name: 'Finish', exact: true })).toBeFocused();
  await expect(page.getByLabel('Source for result', { exact: true })).toHaveValue('item');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await plan.getByRole('button', { name: 'Edit output team', exact: true }).click();
  await expect(page.getByLabel('Source for team', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await plan.getByRole('button', { name: 'Edit input item', exact: true }).click();
  await expect(page.getByLabel('Input 1 name', { exact: true })).toBeFocused();
});

test('a failed Preview download leaves the workflow editable', async ({ page }) => {
  await page.route(runPlanModule, (route) => route.abort());
  await mockCreator(page);
  await createDraft(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load Preview. Reload the page and try again.');
  await expect(page.getByRole('dialog', { name: 'Run plan' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Workflow settings' })).toBeVisible();
});

test('a failed Preview download preserves an unsaved workflow', async ({ page }) => {
  const rows = await mockCreator(page);
  await page.route(runPlanModule, (route) => route.abort());
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  const id = page.getByLabel('Workflow id', { exact: true });
  await id.fill('unsaved-workflow');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Save your changes, then reload the page.');
  await expect(id).toHaveValue('unsaved-workflow');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toContainText('v1 · saved');
  expect(rows[0].workflow_id).toBe('unsaved-workflow');
});

test('Preview shows progress while the run plan loads', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let releaseModule!: () => void;
  const moduleDownload = new Promise<void>((resolve) => { releaseModule = resolve; });
  await page.route(runPlanModule, async (route) => {
    await moduleDownload;
    await route.continue();
  });
  let planDownloads = 0;
  page.on('request', (request) => {
    if (runPlanModule.test(request.url())) planDownloads++;
  });
  await mockCreator(page, { beforePreview: () => pending });
  await createDraft(page);
  expect(planDownloads).toBe(0);
  try {
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const loading = page.getByRole('button', { name: 'Planning…', exact: true });
    await expect(loading).toBeDisabled();
    await expect(loading).toHaveAttribute('aria-busy', 'true');
    release();
    const plan = page.getByRole('dialog', { name: 'Run plan' });
    await expect.poll(() => planDownloads).toBe(1);
    await expect(loading).toBeDisabled();
    await expect(plan).toHaveCount(0);
    releaseModule();
    await expect(plan).toBeVisible();
    expect(planDownloads).toBe(1);
    const identity = plan.getByLabel('Previewed workflow');
    await expect(identity).toContainText('Workflow IDtest-flow');
  } finally {
    release();
    releaseModule();
  }
});

test('a delayed Preview does not open over a new workflow', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await mockCreator(page, { beforePreview: () => pending });
  await createDraft(page);
  try {
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Planning…' })).toBeDisabled();
    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    const library = page.getByRole('complementary', { name: 'Workflow library' });
    await library.getByRole('button', { name: 'New workflow', exact: true }).click();
    const id = page.getByLabel('Workflow id', { exact: true });
    await expect(id).toBeFocused();
    release();
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
    await expect(page.getByRole('dialog', { name: 'Run plan' })).toHaveCount(0);
    await expect(id).toBeFocused();
  } finally {
    release();
  }
});

test('Preview keeps long workflow and step names within a phone viewport', async ({ page }) => {
  const longName = 'LongWorkflowName'.repeat(12);
  await page.setViewportSize({ width: 320, height: 640 });
  await mockCreator(page, { saved: [{
    workflow_id: 'test-flow', name: longName, version: 1, status: 'draft',
    definition: { workflow_id: 'test-flow', name: longName, steps: [
      { step_id: 'start', name: 'LongStepName'.repeat(14), type: 'input_collection', on_success: 'end' },
    ] },
  }] });
  await page.route('**/api/workflows/preview', (route) => route.fulfill({
    json: { ok: true, plan: { order: [{ step_id: 'start', type: 'input_collection' }] } },
  }));
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: longName, exact: true }).click();
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  await preview.click();
  const plan = page.getByRole('dialog', { name: 'Run plan' });
  await expect(plan.getByRole('list', { name: 'Default path' }).getByText('Starts here', { exact: true })).toBeVisible();
  expect(await plan.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(plan).toHaveCount(0);
  await expect(preview).toBeFocused();
});

test('preview separates the default path from a failure destination', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const outputSource = `repeat.${'long_field_'.repeat(12)}items`;
  const definition: WorkflowDefinition = {
    workflow_id: 'test-flow',
    name: 'Routes',
    inputs: [{ name: 'items', type: 'array', required: true }],
    outputs: { result: { from: outputSource }, older_result: { from: 'deleted.value' }, blank_result: { from: '' } },
    steps: [
      { step_id: 'start', type: 'input_collection', name: 'Start', config: { fields: [] }, on_success: 'route', on_failure: 'recover' },
      {
        step_id: 'route',
        type: 'conditional_routing',
        config: { rules: [{ when: { ref: 'total', op: 'gt', value: 100 }, goto: 'recover' }] },
        on_success: 'repeat',
      },
      {
        step_id: 'repeat',
        type: 'iteration',
        config: { over: 'items', max_iterations: 10, body: [
          { step_id: 'review', name: 'Check item', type: 'human_approval', on_success: 'check_route', on_failure: 'recover' },
          { step_id: 'check_route', type: 'conditional_routing', on_success: 'end', config: { rules: [{ when: { ref: 'item', op: 'exists' }, goto: 'review' }] } },
        ] },
        on_success: 'empty_branch',
      },
      { step_id: 'empty_branch', name: 'No rules yet', type: 'conditional_routing', config: { rules: [] }, on_success: 'end', on_failure: 'removed_step' },
      { step_id: 'isolated', type: 'output_composition', name: 'Unused result', on_success: 'end' },
      { step_id: 'recover', type: 'human_approval', name: 'Review failure', config: { prompt: 'Check the failure' }, on_success: 'end' },
      { step_id: 'unused_review', type: 'human_approval', name: 'Review failure', on_success: 'end' },
    ],
  };
  await mockCreator(page, { saved: [{ workflow_id: 'test-flow', version: 1, status: 'draft', definition, name: 'Routes' }] });
  await page.getByRole('button', { name: 'Open workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const plan = page.getByRole('dialog', { name: 'Run plan' });
  await expect(plan.getByText('Preview shows what would run. No steps have run.', { exact: true })).toBeVisible();
  await expect(plan.getByRole('definition').filter({ hasText: /^v1$/ })).toBeVisible();
  await expect(plan.getByRole('list', { name: 'Default path' })).toContainText('On failureReview failure (recover)');
  await expect(plan.getByRole('list', { name: 'Default path' })).toContainText('total > 100');
  await expect(plan.getByRole('list', { name: 'Default path' }).getByText('If no rule matches', { exact: true }).filter({ visible: true })).toHaveCount(2);
  await plan.getByRole('button', { name: 'removed_step (missing)', exact: true }).click();
  await expect(page.getByLabel('On failure', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(plan.getByRole('list', { name: 'Other destinations' })).toContainText('Wait for approval: Check the failure');
  await expect(plan.getByRole('list', { name: 'Unreachable steps' })).toContainText('Unused result');
  await expect(plan.getByRole('list', { name: 'Unreachable steps' }).getByRole('button', { name: 'Review failure (unused_review)', exact: true })).toBeVisible();
  await expect(plan.getByRole('list', { name: 'Other destinations' }).getByRole('button', { name: 'Review failure (recover)', exact: true })).toBeVisible();
  await plan.getByText('Loop steps', { exact: true }).click();
  await expect(plan.getByText('Repeat for each item in items.')).toBeVisible();
  await expect(plan.getByRole('button', { name: 'Check item', exact: true })).toHaveCount(2);
  await expect(plan.getByText('Finish loop', { exact: true })).toBeVisible();
  await expect(plan.getByText('item exists', { exact: true })).toBeVisible();
  await plan.getByRole('definition').getByRole('button', { name: 'check_route', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Body step: check_route', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(plan).toBeVisible();
  expect(await plan.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  expect(await plan.evaluate((dialog) => {
    const bounds = dialog.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= window.innerHeight && dialog.scrollHeight > dialog.clientHeight;
  })).toBe(true);
  await expect(plan.getByText('First run', { exact: true })).toBeVisible();
  await expect(plan.getByRole('region', { name: 'Workflow inputs' })).toContainText(/itemsArray.*Required/);
  await plan.getByRole('button', { name: 'Edit inputs in Settings' }).click();
  const settings = page.getByRole('complementary', { name: 'Workflow settings' });
  await expect(settings.getByRole('heading', { name: 'Workflow settings', exact: true })).toBeFocused();
  let releaseSave = () => {};
  const allowSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route('**/api/workflows/test-flow/versions', async (route) => {
    await allowSave;
    await route.fallback();
  });
  try {
    await page.getByLabel('Execution approval').selectOption('always');
    await page.getByLabel('Skill approval').selectOption('auto');
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(plan.getByRole('definition').filter({ hasText: 'Unsaved draft' })).toBeVisible();
  } finally {
    releaseSave();
  }
  await expect(page.getByRole('toolbar', { name: 'Workflow commands' })).toContainText('v2 · saved');
  await expect(plan.getByRole('definition').filter({ hasText: 'Unsaved draft' })).toBeVisible();
  await expect(plan.getByText('Every run', { exact: true })).toBeVisible();
  await expect(plan.getByText('Skip skill approval', { exact: true })).toBeVisible();
  await plan.getByText('Loop steps', { exact: true }).click();
  await plan.getByRole('button', { name: 'recover (missing)', exact: true }).click();
  await expect(page.getByLabel('On failure', { exact: true })).toBeFocused();
  await expect(plan).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Body step: Check item' })).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(plan.getByRole('region', { name: 'Workflow outputs' })).toContainText(outputSource);
  await expect(plan.getByRole('region', { name: 'Workflow outputs' })).toContainText('deleted.value Source missing');
  await plan.getByRole('button', { name: 'Source missing for older_result' }).click();
  await expect(page.getByLabel('Source for older_result', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await plan.getByRole('button', { name: 'Choose a source for blank_result' }).click();
  await expect(page.getByLabel('Source for blank_result', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await plan.getByRole('button', { name: 'Edit outputs in Finish' }).click();
  const finish = page.getByRole('complementary', { name: 'Finish', exact: true });
  await expect(finish).toBeVisible();
  await finish.getByRole('button', { name: 'Change source for result', exact: true }).click();
  await expect(finish.getByText(`Current source ${outputSource}`, { exact: true })).toBeVisible();
  expect(await finish.evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true);
  await finish.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await plan.getByRole('list', { name: 'Default path' }).getByRole('listitem').filter({
    hasText: 'On failureReview failure',
  }).getByRole('button', { name: 'Review failure (recover)', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Step: Review failure' })).toBeVisible();
  await page.getByRole('button', { name: 'Find step', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search by name, ID, or type' });
  await search.fill('Check item');
  await expect(page.getByRole('button', { name: /Check item.*In repeat/ })).toBeVisible();
  await search.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Body step: Check item' })).toBeVisible();
});
