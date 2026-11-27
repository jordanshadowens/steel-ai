import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceSetupImport } from './WorkspaceSetupImport';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), prepare: vi.fn(), apply: vi.fn(), epoch: 1 }));

vi.mock('../auth/session', () => ({
  authenticatedFetch: mocks.fetch,
  getSession: () => ({ epoch: mocks.epoch }),
  sessionIsCurrent: (epoch: number) => epoch === mocks.epoch,
}));

vi.mock('./workspaceSetup', () => ({
  parseWorkspaceSetup: JSON.parse,
  prepareWorkspaceSetup: mocks.prepare,
  applyWorkspaceSetup: mocks.apply,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  mocks.epoch = 1;
});

function openSetup() {
  const refresh = vi.fn();
  render(<WorkspaceSetupImport onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Import setup' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Setup JSON' }), { target: { value: '{}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview setup' }));
  return refresh;
}

function enablePreview() {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  mocks.prepare.mockImplementation(async (request) => {
    await request('/export');
    return { missingModels: ['MetricPoint'], missingBindings: 1 };
  });
  mocks.apply.mockImplementation(async (request) => {
    await request('/import', { doc: {} });
    return { publishedModels: ['MetricPoint'], insertedBindings: 1 };
  });
}

it('shows a preview before making changes and refreshes Designer after Apply', async () => {
  enablePreview();
  const refresh = openSetup();
  const apply = await screen.findByRole('button', { name: 'Apply setup' });
  expect(screen.getByText('MetricPoint')).toBeTruthy();
  expect(screen.getByText('1 binding to add')).toBeTruthy();
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.fetch).toHaveBeenCalledWith('/api/designer/export', undefined);
  fireEvent.click(apply);
  expect(await screen.findByText(/Published 1 model and added 1 binding/)).toBeTruthy();
  expect(mocks.fetch).toHaveBeenCalledWith('/api/designer/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"doc":{}}',
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not apply a preview to a different signed-in workspace', async () => {
  enablePreview();
  openSetup();
  const apply = await screen.findByRole('button', { name: 'Apply setup' });
  mocks.epoch++;
  fireEvent.click(apply);
  expect((await screen.findByRole('alert')).textContent).toContain('workspace session changed');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Preview setup' })).toBeTruthy();
});
