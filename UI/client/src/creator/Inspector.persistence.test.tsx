import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { Inspector } from './Inspector';
import { openDefinition, selectStep, setPanel, workflowEditorReducer } from '../store/workflowEditor';
import { REASON_TOOLS, STEP_TYPES, defaultConfig } from './adapter';

vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });

vi.mock('../api/steelApi', () => ({
  useListSkillsQuery: () => ({ data: { skills: [] } }),
  useDraftSkillMutation: () => [vi.fn(), {}],
  useListTemplatesQuery: () => ({ data: { templates: [] } }),
  useGetTemplateVersionsQuery: () => ({ data: { versions: [] } }),
  useGetTemplateVersionQuery: () => ({ data: { slots: [] } }),
  useGetDesignerWorkspaceQuery: () => ({ data: { types: [] }, isLoading: false, error: undefined }),
  useListDesignerRecordsQuery: () => ({ data: { records: [] }, isLoading: false, error: undefined }),
}));

afterEach(cleanup);

it('uses the shared configuration layout and routing controls for every step type', () => {
  const store = configureStore({ reducer: { workflowEditor: workflowEditorReducer } });
  store.dispatch(openDefinition({ workflowId: 'layouts', version: null, definition: {
    workflow_id: 'layouts', inputs: [],
    steps: STEP_TYPES.map(({ value }) => ({ step_id: value, type: value, name: value, config: defaultConfig(value), on_success: 'end' })),
  } }));
  const view = () => <Provider store={store}><Inspector bodySel={null} setBodySel={() => {}} /></Provider>;
  const mounted = render(view());
  for (const { value, label } of STEP_TYPES) {
    store.dispatch(selectStep(value)); mounted.rerender(view());
    expect(screen.getByText('Configure this step and connect its data')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Step details' })).toBeTruthy();
    expect(mounted.container.querySelector('.step-settings input')).toBe(screen.getByLabelText('Step id'));
    expect(screen.getByRole('region', { name: 'Routing' })).toBeTruthy();
    expect(screen.getByLabelText('On success')).toBeTruthy();
    expect(screen.getByText(label, { selector: '.count-badge' })).toBeTruthy();
    expect(mounted.container.querySelector('.step-settings.configuration-card')).toBeTruthy();
  }
});

it('retains all Creator checkbox values and calculation modes after leaving and returning', () => {
  const store = configureStore({ reducer: { workflowEditor: workflowEditorReducer } });
  store.dispatch(openDefinition({ workflowId: 'persist', version: null, definition: {
    workflow_id: 'persist', inputs: [{ name: 'amount', type: 'number', required: false }],
    steps: [
      { step_id: 'calc', type: 'skill_execution', config: {}, on_success: 'end' },
      { step_id: 'reason', type: 'model_reasoning', config: {}, on_success: 'end' },
    ],
  } }));
  const view = () => <Provider store={store}><Inspector bodySel={null} setBodySel={() => {}} /></Provider>;
  const mounted = render(view());
  const step = (id: string) => { store.dispatch(selectStep(id)); mounted.rerender(view()); };
  const settings = () => { store.dispatch(setPanel('settings')); mounted.rerender(view()); };
  const check = (label: string, expected: boolean) => expect((screen.getByLabelText(label) as HTMLInputElement).checked).toBe(expected);

  step('calc');
  fireEvent.click(screen.getByLabelText('Describe a new calculation'));
  step('reason'); step('calc');
  check('Describe a new calculation', true);
  for (const mode of ['Resolve at run time', 'Use a saved skill', 'Describe a new calculation']) {
    fireEvent.click(screen.getByLabelText(mode));
    step('reason'); step('calc'); check(mode, true);
  }
  for (const expected of [true, false]) {
    fireEvent.click(screen.getByLabelText('Deferred (acquire at run time)'));
    step('reason'); step('calc'); check('Deferred (acquire at run time)', expected);
    step('reason');
    for (const tool of REASON_TOOLS) fireEvent.click(screen.getByLabelText(tool));
    step('calc'); step('reason');
    for (const tool of REASON_TOOLS) check(tool, expected);
    settings();
    fireEvent.click(screen.getByLabelText('Input 1 required'));
    fireEvent.click(screen.getByLabelText('Four-eyes publish'));
    step('calc'); settings();
    check('Input 1 required', expected);
    check('Four-eyes publish', expected);
    step('calc');
  }
  settings();
  expect(screen.getByText('Not validated')).toBeTruthy();
  fireEvent.click(screen.getByText('+ Add binding'));
  fireEvent.change(screen.getByLabelText('New output key'), { target: { value: 'total' } });
  fireEvent.change(screen.getByLabelText('New output source'), { target: { value: 'amount' } });
  fireEvent.click(screen.getByText('Add', { selector: 'button' }));
  step('calc'); settings();
  expect((screen.getByLabelText('Source for total') as HTMLInputElement).value).toBe('amount');
  expect(screen.getByText('1 mapped')).toBeTruthy();
});
