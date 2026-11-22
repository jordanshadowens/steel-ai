import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { Inspector } from './Inspector';
import {
  openDefinition,
  selectStep,
  setPanel,
  workflowEditorReducer,
} from '../store/workflowEditor';
import { END_NODE_ID, REASON_TOOLS, STEP_TYPES, defaultConfig } from './adapter';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
);

vi.mock('../api/steelApi', () => ({
  useListSkillsQuery: () => ({
    data: {
      skills: [
        {
          name: 'starter_example',
          version: 1,
          status: 'verified',
          source: 'seed',
          input_params: [],
          description: 'Starter example',
        },
        {
          name: 'my_calculation',
          version: 1,
          status: 'verified',
          source: 'learned',
          input_params: [],
          description: 'Workspace calculation',
        },
      ],
    },
  }),
  useDraftSkillMutation: () => [vi.fn(), {}],
  useDraftLanguageMutation: () => [vi.fn(), { isLoading: false }],
  useListTemplatesQuery: () => ({ data: { templates: [] } }),
  useGetTemplateVersionsQuery: () => ({ data: { versions: [] } }),
  useGetTemplateVersionQuery: () => ({ data: { slots: [] } }),
  useGetDesignerWorkspaceQuery: () => ({
    data: { types: [{ name: 'project', type_id: 'project', version: 1, status: 'active', fields: [] }] },
    isLoading: false,
    error: undefined,
  }),
  useGetDesignerVersionQuery: () => ({
    currentData: { spec: { fields: [{ name: 'Team', status: 'active', ftype: 'text' }] } },
  }),
  useListDesignerRecordsQuery: () => ({
    data: { records: [] },
    isLoading: false,
    error: undefined,
  }),
}));

afterEach(cleanup);

it('hides starter examples unless requested while preserving an existing pin', () => {
  const store = configureStore({
    reducer: { workflowEditor: workflowEditorReducer },
  });
  store.dispatch(
    openDefinition({
      workflowId: 'skills',
      version: null,
      definition: {
        workflow_id: 'skills',
        inputs: [],
        steps: [
          {
            step_id: 'calc',
            name: 'Calculation',
            type: 'skill_execution',
            config: {},
            on_success: 'end',
          },
        ],
      },
    }),
  );
  store.dispatch(selectStep('calc'));
  render(
    <Provider store={store}>
      <Inspector bodySel={null} setBodySel={() => {}} />
    </Provider>,
  );
  fireEvent.click(screen.getByLabelText('Use a saved skill'));
  expect(screen.queryByText('starter_example', { exact: true })).toBeNull();
  expect(screen.getByText('my_calculation', { exact: true })).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Show starter examples'));
  const row = screen
    .getByText('starter_example', { exact: true })
    .closest('li')!;
  fireEvent.click(row.querySelector('button')!);
  fireEvent.click(screen.getByLabelText('Show starter examples'));
  expect(screen.getByText('starter_example', { exact: true })).toBeTruthy();
  expect(screen.getByText('Pinned v1')).toBeTruthy();
});

it('uses the shared configuration layout and routing controls for every step type', () => {
  const store = configureStore({
    reducer: { workflowEditor: workflowEditorReducer },
  });
  store.dispatch(
    openDefinition({
      workflowId: 'layouts',
      version: null,
      definition: {
        workflow_id: 'layouts',
        inputs: [],
        steps: STEP_TYPES.map(({ value }) => ({
          step_id: value,
          type: value,
          name: value,
          config: defaultConfig(value),
          on_success: 'end',
        })),
      },
    }),
  );
  const view = () => (
    <Provider store={store}>
      <Inspector bodySel={null} setBodySel={() => {}} />
    </Provider>
  );
  const mounted = render(view());
  for (const { value, label } of STEP_TYPES) {
    store.dispatch(selectStep(value));
    mounted.rerender(view());
    expect(
      screen.getByText('Configure this step and connect its data'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Step details' })).toBeTruthy();
    expect(mounted.container.querySelector('.step-settings input')).toBe(
      screen.getByLabelText('Step id'),
    );
    expect(screen.getByRole('region', { name: 'Routing' })).toBeTruthy();
    expect(screen.getByLabelText('On success')).toBeTruthy();
    expect(screen.getByText(label, { selector: '.count-badge' })).toBeTruthy();
    expect(
      mounted.container.querySelector('.step-settings.configuration-card'),
    ).toBeTruthy();
  }
});

it('retains all Creator checkbox values and calculation modes after leaving and returning', () => {
  const store = configureStore({
    reducer: { workflowEditor: workflowEditorReducer },
  });
  store.dispatch(
    openDefinition({
      workflowId: 'persist',
      version: null,
      definition: {
        workflow_id: 'persist',
        inputs: [{ name: 'amount', type: 'number', required: false }],
        steps: [
          {
            step_id: 'calc',
            type: 'skill_execution',
            config: {},
            on_success: 'end',
          },
          {
            step_id: 'reason',
            type: 'model_reasoning',
            config: {},
            on_success: 'end',
          },
        ],
      },
    }),
  );
  const view = () => (
    <Provider store={store}>
      <Inspector bodySel={null} setBodySel={() => {}} />
    </Provider>
  );
  const mounted = render(view());
  const step = (id: string) => {
    store.dispatch(selectStep(id));
    mounted.rerender(view());
  };
  const settings = () => {
    store.dispatch(setPanel('settings'));
    mounted.rerender(view());
  };
  const check = (label: string, expected: boolean) =>
    expect((screen.getByLabelText(label) as HTMLInputElement).checked).toBe(
      expected,
    );

  step('calc');
  fireEvent.click(screen.getByLabelText('Describe a new calculation'));
  step('reason');
  step('calc');
  check('Describe a new calculation', true);
  for (const mode of [
    'Resolve at run time',
    'Use a saved skill',
    'Describe a new calculation',
  ]) {
    fireEvent.click(screen.getByLabelText(mode));
    step('reason');
    step('calc');
    check(mode, true);
  }
  for (const expected of [true, false]) {
    fireEvent.click(screen.getByLabelText('Deferred (acquire at run time)'));
    step('reason');
    step('calc');
    check('Deferred (acquire at run time)', expected);
    step('reason');
    for (const tool of REASON_TOOLS) {
      fireEvent.click(screen.getByLabelText(tool));
    }
    step('calc');
    step('reason');
    for (const tool of REASON_TOOLS) {
      check(tool, expected);
    }
    settings();
    fireEvent.click(screen.getByLabelText('Input 1 required'));
    step('calc');
    settings();
    check('Input 1 required', expected);
    step('calc');
  }
  settings();
  expect(screen.queryByText('Not validated')).toBeNull();
  expect(screen.queryByLabelText('Four-eyes publish')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Limits' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Input presentation' })).toBeNull();
  expect(screen.queryByLabelText('Bound designer type')).toBeNull();
  expect(
    Array.from((screen.getByLabelText('Input 1 type') as HTMLSelectElement).options)
      .map((option) => [option.text, option.value]),
  ).toEqual([
    ['Text', 'string'],
    ['Number', 'number'],
    ['Boolean', 'boolean'],
    ['JSON', 'object'],
    ['Array', 'array'],
  ]);
  step(END_NODE_ID);
  expect(screen.getByRole('complementary', { name: 'Finish' })).toBeTruthy();
  const bindings = screen.getByRole('region', { name: 'Bindings' });
  expect(bindings.contains(screen.getByRole('group', { name: 'Workflow outputs' }))).toBe(true);
  fireEvent.click(screen.getByText('Workflow input bindings'));
  fireEvent.change(screen.getByLabelText('Bound designer type'), {
    target: { value: 'project' },
  });
  settings();
  expect(screen.queryByLabelText('Bound designer type')).toBeNull();
  step(END_NODE_ID);
  expect((screen.getByLabelText('Bound designer type') as HTMLSelectElement).value)
    .toBe('project');
  expect(store.getState().workflowEditor.draft?.inputs?.[0]?.designer)
    .toEqual({ type: 'project' });
  settings();
  expect(screen.queryByRole('region', { name: 'Bindings' })).toBeNull();
  step(END_NODE_ID);
  fireEvent.click(screen.getByText('+ Add output'));
  fireEvent.change(screen.getByLabelText('Output name'), {
    target: { value: 'total' },
  });
  fireEvent.change(screen.getByLabelText('Step output'), {
    target: { value: 'amount' },
  });
  fireEvent.click(screen.getByText('Add', { selector: 'button' }));
  settings();
  expect(screen.queryByRole('region', { name: 'Bindings' })).toBeNull();
  step(END_NODE_ID);
  expect(
    (screen.getByLabelText('Source for total') as HTMLInputElement).value,
  ).toBe('amount');
  expect(screen.getByText('1 mapped')).toBeTruthy();
  expect(store.getState().workflowEditor.draft?.outputs?.total).toEqual({ from: 'amount' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove output total' }));
  expect(screen.getByText('0 mapped')).toBeTruthy();

  fireEvent.click(screen.getByText('+ Add output'));
  fireEvent.change(screen.getByLabelText('Output name'), { target: { value: 'team' } });
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'model' } });
  fireEvent.change(screen.getByLabelText('Data model'), { target: { value: 'project' } });
  fireEvent.change(screen.getByLabelText('Model field'), { target: { value: 'Team' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  const draft = store.getState().workflowEditor.draft;
  expect(draft?.outputs?.team).toEqual({ from: 'model_team' });
  expect(draft?.inputs).toContainEqual({
    name: 'model_team',
    type: 'string',
    required: true,
    designer: { type: 'project', mode: 'value', field: 'Team' },
  });
});
