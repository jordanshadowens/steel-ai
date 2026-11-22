import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { LibraryPanel } from './LibraryPanel';
import { NoticeProvider } from './notices';
import { openDefinition, updateDraft, workflowEditorReducer } from '../store/workflowEditor';
import { blankDefinition } from './adapter';
const mocks = vi.hoisted(() => ({ validate: vi.fn() }));
vi.mock('../api/steelApi', () => ({
  steelApi: {},
  useListWorkflowsQuery: () => ({ data: { workflows: [] } }),
  useListTrashedWorkflowsQuery: () => ({ data: { workflows: [] } }),
  useRestoreWorkflowMutation: () => [vi.fn(), {}],
  useDeleteWorkflowMutation: () => [vi.fn(), {}],
  useGetWorkflowDependenciesQuery: () => ({}),
  useValidateWorkflowMutation: () => [mocks.validate, {}],
}));
vi.mock('motion/react', () => ({ useIsPresent: () => true }));
vi.mock('motion/react-m', () => ({ aside: 'aside' }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup() {
  const store = configureStore({
    reducer: { workflowEditor: workflowEditorReducer },
  });
  const close = vi.fn();
  const { unmount } = render(
    <Provider store={store}>
      <NoticeProvider>
        <LibraryPanel onClose={close} />
      </NoticeProvider>
    </Provider>,
  );
  fireEvent.click(screen.getByText('Import JSON'));
  return { store, close, unmount };
}
it.each(['response', 'rejection'])('requires successful server validation before opening the imported definition (%s)', async (kind) => {
  const errors = ['Invalid approval route'];
  mocks.validate.mockReturnValue({
    unwrap: kind === 'response'
      ? async () => ({ ok: false, errors })
      : async () => { throw { status: 422, data: { errors } }; },
  });
  const { store, close } = setup();
  fireEvent.change(screen.getByLabelText('Workflow definition'), {
    target: { value: JSON.stringify(blankDefinition()) },
  });
  await act(async () => {
    fireEvent.click(screen.getByText('Validate and import'));
  });
  expect(screen.getByRole('alert').textContent).toContain(
    'Invalid approval route',
  );
  expect(store.getState().workflowEditor.draft).toBeNull();
  expect(close).not.toHaveBeenCalled();
});
it('imports published JSON as an unsaved draft without publishing or overwriting a version', async () => {
  mocks.validate.mockReturnValue({
    unwrap: async () => ({ ok: true, errors: [] }),
  });
  const { store, close } = setup();
  const source = {
    ...blankDefinition(),
    workflow_id: 'review',
    version: 7,
    status: 'published',
  };
  fireEvent.change(screen.getByLabelText('Workflow definition'), {
    target: { value: JSON.stringify(source) },
  });
  await act(async () => {
    fireEvent.click(screen.getByText('Validate and import'));
  });
  expect(store.getState().workflowEditor.openVersion).toBeNull();
  expect(store.getState().workflowEditor.draft).toMatchObject({
    workflow_id: 'review',
    version: 1,
    status: 'draft',
  });
  expect(close).toHaveBeenCalledOnce();
});
it('rejects invalid JSON without making an API call', async () => {
  setup();
  fireEvent.change(screen.getByLabelText('Workflow definition'), {
    target: { value: '{broken' },
  });
  await act(async () => {
    fireEvent.click(screen.getByText('Validate and import'));
  });
  expect(mocks.validate).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeTruthy();
});

it('returns to the entered JSON when replacing an unsaved draft is canceled', async () => {
  mocks.validate.mockReturnValue({ unwrap: async () => ({ ok: true, errors: [] }) });
  const { store, close } = setup();
  const draft = blankDefinition();
  act(() => {
    store.dispatch(openDefinition({ workflowId: draft.workflow_id, version: null, definition: draft }));
    store.dispatch(updateDraft({ ...draft, workflow_id: 'unfinished' }));
  });
  const json = JSON.stringify({ ...blankDefinition(), workflow_id: 'imported' });
  fireEvent.change(screen.getByLabelText('Workflow definition'), { target: { value: json } });
  await act(async () => {
    fireEvent.click(screen.getByText('Validate and import'));
  });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Back to import' }));
  expect((screen.getByLabelText('Workflow definition') as HTMLTextAreaElement).value).toBe(json);
  expect(store.getState().workflowEditor.draft?.workflow_id).toBe('unfinished');
  expect(close).not.toHaveBeenCalled();
});

it('ignores successful validation after leaving the library', async () => {
  let finishValidation!: (result: { ok: boolean }) => void;
  const pending = new Promise<{ ok: boolean }>((resolve) => { finishValidation = resolve; });
  mocks.validate.mockReturnValue({ unwrap: () => pending });
  const { store, close, unmount } = setup();
  fireEvent.change(screen.getByLabelText('Workflow definition'), {
    target: { value: JSON.stringify(blankDefinition()) },
  });
  fireEvent.click(screen.getByText('Validate and import'));
  expect(mocks.validate).toHaveBeenCalledOnce();
  unmount();
  await act(async () => { finishValidation({ ok: true }); });
  expect(store.getState().workflowEditor.draft).toBeNull();
  expect(close).not.toHaveBeenCalled();
});

it('keeps newer text when a pending JSON file read finishes', async () => {
  setup();
  let finishRead!: (json: string) => void;
  const pending = new Promise<string>((resolve) => { finishRead = resolve; });
  const file = { size: 18, text: vi.fn(() => pending) };
  const definition = screen.getByLabelText('Workflow definition') as HTMLTextAreaElement;
  const validate = screen.getByRole('button', { name: 'Validate and import' }) as HTMLButtonElement;
  fireEvent.change(definition, { target: { value: '{"workflow_id":"previous"}' } });
  fireEvent.change(screen.getByLabelText('JSON file'), { target: { files: [file] } });
  expect(screen.getByRole('status').textContent).toBe('Reading JSON file…');
  expect(validate.disabled).toBe(true);
  fireEvent.change(definition, { target: { value: '{"workflow_id":"typed"}' } });
  expect(validate.disabled).toBe(false);
  await act(async () => { finishRead('{"workflow_id":"file"}'); });
  expect(file.text).toHaveBeenCalledOnce();
  expect(definition.value).toBe('{"workflow_id":"typed"}');
});
