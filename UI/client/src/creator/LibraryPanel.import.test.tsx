import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { LibraryPanel } from './LibraryPanel';
import { NoticeProvider } from './notices';
import { workflowEditorReducer } from '../store/workflowEditor';
import { blankDefinition } from './adapter';
const mocks = vi.hoisted(() => ({ validate: vi.fn() }));
vi.mock('../api/steelApi', () => ({
  steelApi: {},
  useListWorkflowsQuery: () => ({data:{workflows:[]}}),
  useListTrashedWorkflowsQuery: () => ({data:{workflows:[]}}),
  useRestoreWorkflowMutation: () => [vi.fn(),{}],
  useDeleteWorkflowMutation: () => [vi.fn(),{}],
  useGetWorkflowDependenciesQuery: () => ({}),
  useValidateWorkflowMutation: () => [mocks.validate,{}],
}));
vi.mock('motion/react', () => ({ motion: { aside: 'aside' } }));
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function setup() {
  const store = configureStore({reducer:{workflowEditor:workflowEditorReducer}});
  const close = vi.fn();
  render(<Provider store={store}><NoticeProvider><LibraryPanel onClose={close}/></NoticeProvider></Provider>);
  fireEvent.click(screen.getByText('Import JSON'));
  return {store,close};
}
it('requires successful server validation before opening the imported definition', async () => {
  mocks.validate.mockReturnValue({unwrap:async()=>({ok:false,errors:['Invalid approval route']})});
  const {store,close} = setup();
  fireEvent.change(screen.getByLabelText('Workflow definition'),{target:{value:JSON.stringify(blankDefinition())}});
  await act(async()=>{fireEvent.click(screen.getByText('Validate and import'));});
  expect(screen.getByRole('alert').textContent).toContain('Invalid approval route');
  expect(store.getState().workflowEditor.draft).toBeNull();
  expect(close).not.toHaveBeenCalled();
});
it('imports published JSON as an unsaved draft without publishing or overwriting a version', async () => {
  mocks.validate.mockReturnValue({unwrap:async()=>({ok:true,errors:[]})});
  const {store,close} = setup();
  const source = {...blankDefinition(),workflow_id:'review',version:7,status:'published'};
  fireEvent.change(screen.getByLabelText('Workflow definition'),{target:{value:JSON.stringify(source)}});
  await act(async()=>{fireEvent.click(screen.getByText('Validate and import'));});
  expect(store.getState().workflowEditor.openVersion).toBeNull();
  expect(store.getState().workflowEditor.draft).toMatchObject({workflow_id:'review',version:1,status:'draft'});
  expect(close).toHaveBeenCalledOnce();
});
it('rejects invalid JSON without making an API call', async () => {
  setup();
  fireEvent.change(screen.getByLabelText('Workflow definition'),{target:{value:'{broken'}});
  await act(async()=>{fireEvent.click(screen.getByText('Validate and import'));});
  expect(mocks.validate).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeTruthy();
});

