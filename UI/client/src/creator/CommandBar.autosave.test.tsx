import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { CommandBar } from './CommandBar';
import { NoticeProvider } from './notices';
import { isDirty, openDefinition, updateDraft, workflowEditorReducer } from '../store/workflowEditor';
import { blankDefinition } from './adapter';

const mocks = vi.hoisted(() => ({ save: vi.fn(), create: vi.fn() }));
vi.mock('../api/steelApi', () => ({
  steelApi: {},
  useListWorkflowsQuery: () => ({ data: { workflows: [] } }),
  useListSkillsQuery: () => ({ data: { skills: [] } }),
  useSaveWorkflowMutation: () => [mocks.create, {}],
  useSaveWorkflowVersionMutation: () => [mocks.save, {}],
  useValidateWorkflowMutation: () => [vi.fn(), {}],
  usePreviewWorkflowMutation: () => [vi.fn(), {}],
  usePublishWorkflowMutation: () => [vi.fn(), {}],
  useDecideApprovalMutation: () => [vi.fn(), {}],
}));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

function setup(version: number | null) {
  vi.useFakeTimers();
  const store = configureStore({ reducer: { workflowEditor: workflowEditorReducer } });
  const definition = { ...blankDefinition(), workflow_id: 'expense', name: 'Expenses' };
  store.dispatch(openDefinition({ workflowId: 'expense', version, definition }));
  const settings = vi.fn();
  render(<Provider store={store}><NoticeProvider><CommandBar onOpenLibrary={vi.fn()} onOpenSettings={settings} onValidated={vi.fn()} validationStatus={null} /></NoticeProvider></Provider>);
  return { store, definition, settings };
}

it('requires the first explicit save, then autosaves edits without overwriting newer edits', async () => {
  const { store, definition } = setup(null);
  await act(async () => { store.dispatch(updateDraft({ ...definition, name: 'Initial setup' })); vi.advanceTimersByTime(1500); });
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  mocks.create.mockImplementationOnce(() => ({ unwrap: async () => ({ ok: true, row: { version: 1, status: 'draft' } }) }));
  await act(async () => { fireEvent.click(screen.getByText('Save', { selector: 'button' })); });
  expect(store.getState().workflowEditor.openVersion).toBe(1);
  let resolve!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => ({ unwrap: () => new Promise((done) => { resolve = done; }) }));
  act(() => { store.dispatch(updateDraft({ ...store.getState().workflowEditor.draft!, name: 'Edit A' })); });
  await act(async () => { vi.advanceTimersByTime(800); });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  act(() => { store.dispatch(updateDraft({ ...store.getState().workflowEditor.draft!, name: 'Edit B' })); });
  await act(async () => { resolve({ ok: true, row: { version: 2, status: 'draft' } }); });
  expect(store.getState().workflowEditor.draft?.name).toBe('Edit B');
  expect(isDirty(store.getState().workflowEditor)).toBe(true);
  mocks.save.mockImplementationOnce(() => ({ unwrap: async () => ({ ok: true, row: { version: 3, status: 'draft' } }) }));
  await act(async () => { vi.advanceTimersByTime(800); });
  expect(isDirty(store.getState().workflowEditor)).toBe(false);
});

it('ignores a save response after opening a different workflow', async () => {
  const { store, definition } = setup(1);
  let resolve!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => ({ unwrap: () => new Promise((done) => { resolve = done; }) }));
  act(() => { store.dispatch(updateDraft({ ...definition, name: 'Old workflow edit' })); });
  await act(async () => { vi.advanceTimersByTime(800); });
  act(() => { store.dispatch(openDefinition({ workflowId: 'another', version: 7, definition: { ...definition, workflow_id: 'another', name: 'Another workflow' } })); });
  await act(async () => { resolve({ ok: true, row: { version: 2, status: 'draft' } }); });
  expect(store.getState().workflowEditor.draft?.name).toBe('Another workflow');
  expect(store.getState().workflowEditor.openVersion).toBe(7);
});

it('keeps failed saves dirty, surfaces a transient alert, and exposes settings through the menu', async () => {
  const { store, definition, settings } = setup(1);
  mocks.save.mockImplementationOnce(() => ({ unwrap: async () => { throw new Error('Offline'); } }));
  act(() => { store.dispatch(updateDraft({ ...definition, name: 'Keep my edits' })); });
  await act(async () => { vi.advanceTimersByTime(800); });
  expect(screen.getByRole('alert').textContent).toContain('Auto save paused');
  expect(isDirty(store.getState().workflowEditor)).toBe(true);
  act(() => { store.dispatch(updateDraft({ ...store.getState().workflowEditor.draft!, name: 'Another edit while offline' })); });
  await act(async () => { vi.advanceTimersByTime(6000); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  mocks.save.mockImplementationOnce(() => ({ unwrap: async () => ({ ok: true, row: { version: 2, status: 'draft' } }) }));
  await act(async () => { fireEvent.click(screen.getByText('Save', { selector: 'button' })); });
  expect(isDirty(store.getState().workflowEditor)).toBe(false);
  expect(screen.queryByText('Inputs & outputs')).toBeNull();
  fireEvent.click(screen.getByLabelText('Workflow menu'));
  fireEvent.click(screen.getByText('Workflow settings'));
  expect(settings).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByLabelText('Edit workflow name'));
  expect((screen.getByLabelText('Workflow name') as HTMLInputElement).readOnly).toBe(false);
});
