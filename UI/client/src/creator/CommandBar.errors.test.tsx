import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { CommandBar } from './CommandBar';
import { NoticeProvider } from './notices';
import { openDefinition, workflowEditorReducer } from '../store/workflowEditor';
import { blankDefinition } from './adapter';

const mocks = vi.hoisted(() => ({ save: vi.fn(), create: vi.fn() }));
vi.mock('../api/steelApi', () => ({
  steelApi: { endpoints: { getWorkflowVersions: { initiate: () => ({}) } } },
  useListWorkflowsQuery: () => ({ data: { workflows: [] } }),
  useListSkillsQuery: () => ({ data: { skills: [] } }),
  useSaveWorkflowMutation: () => [mocks.create, {}],
  useSaveWorkflowVersionMutation: () => [mocks.save, {}],
  useValidateWorkflowMutation: () => [vi.fn(), {}],
  usePreviewWorkflowMutation: () => [vi.fn(), {}],
  usePublishWorkflowMutation: () => [vi.fn(), {}],
  useDecideApprovalMutation: () => [vi.fn(), {}],
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows the structured validation error on save failure, not generic Request failed', async () => {
  const store = configureStore({ reducer: { workflowEditor: workflowEditorReducer } });
  const definition = { ...blankDefinition(), workflow_id: 'fresh_expense_acceptance', name: 'Fresh Expense Acceptance' };
  store.dispatch(openDefinition({ workflowId: 'fresh_expense_acceptance', version: null, definition }));
  mocks.create.mockImplementationOnce(() => ({
    unwrap: async () => { throw { status: 400, data: { ok: false, errors: ['steps[0].start.config.fields: "item" is not a declared input'] } }; },
  }));
  render(<Provider store={store}><NoticeProvider><CommandBar onOpenLibrary={vi.fn()} onOpenSettings={vi.fn()} onValidated={vi.fn()} validationStatus={null} /></NoticeProvider></Provider>);
  await act(async () => { fireEvent.click(screen.getByText('Save', { selector: 'button' })); });
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain('Save failed');
  expect(alert.textContent).toContain('"item" is not a declared input');
  expect(alert.textContent).not.toContain('Request failed');
  expect(alert.textContent).toContain('Your draft is kept locally');
});
