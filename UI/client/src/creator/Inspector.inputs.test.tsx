import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { Inspector } from './Inspector';
import { blankDefinition } from './adapter';
import { openDefinition, selectStep, setPanel, workflowEditorReducer } from '../store/workflowEditor';

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

function setup() {
  const store = configureStore({ reducer: { workflowEditor: workflowEditorReducer } });
  store.dispatch(openDefinition({ workflowId: '', version: null, status: 'new', definition: blankDefinition() }));
  const view = () => <Provider store={store}><Inspector bodySel={null} setBodySel={() => {}} requiredSetup /></Provider>;
  const mounted = render(view());
  const rerender = () => mounted.rerender(view());
  return { store, rerender };
}

it('commits input renames on blur (not per keystroke) and keeps the default start consistent', () => {
  const { store, rerender } = setup();
  const nameBox = screen.getByLabelText('Input 1 name') as HTMLInputElement;
  expect(nameBox.value).toBe('item');
  fireEvent.change(nameBox, { target: { value: 'food_total' } });
  rerender();
  // Typing buffers locally: the draft is untouched until blur (no transient resets).
  expect(store.getState().workflowEditor.draft?.inputs?.[0].name).toBe('item');
  expect((screen.getByLabelText('Input 1 name') as HTMLInputElement).value).toBe('food_total');
  fireEvent.blur(screen.getByLabelText('Input 1 name'));
  rerender();
  const draft = store.getState().workflowEditor.draft!;
  expect(draft.inputs?.[0].name).toBe('food_total');
  expect((draft.steps?.[0]?.config as { fields: string[] }).fields).toEqual(['food_total']);
  // Type/required preserved across the rename commit.
  expect(draft.inputs?.[0].type).toBe('string');
  expect(draft.inputs?.[0].required).toBe(true);
});

it('adds typed inputs via settings and preserves them across navigation', () => {
  const { store, rerender } = setup();
  fireEvent.click(screen.getByText('+ Add input'));
  rerender();
  fireEvent.click(screen.getByText('+ Add input'));
  rerender();
  let draft = store.getState().workflowEditor.draft!;
  expect(draft.inputs?.map((i) => i.name)).toEqual(['item', 'input2', 'input3']);
  expect((draft.steps?.[0]?.config as { fields: string[] }).fields).toEqual(['item', 'input2', 'input3']);

  const rename = (label: string, next: string) => {
    fireEvent.change(screen.getByLabelText(label), { target: { value: next } });
    fireEvent.blur(screen.getByLabelText(label));
    rerender();
  };
  rename('Input 1 name', 'food_total');
  rename('Input 2 name', 'supplies_total');
  rename('Input 3 name', 'other_total');
  for (const n of [1, 2, 3]) {
    fireEvent.change(screen.getByLabelText(`Input ${n} type`), { target: { value: 'number' } });
    const box = screen.getByLabelText(`Input ${n} required`) as HTMLInputElement;
    if (!box.checked) fireEvent.click(box);
    rerender();
  }
  draft = store.getState().workflowEditor.draft!;
  expect((draft.steps?.[0]?.config as { fields: string[] }).fields).toEqual(['food_total', 'supplies_total', 'other_total']);
  // Navigation preserves the configured inputs, types, and checks.
  store.dispatch(selectStep('start'));
  rerender();
  store.dispatch(setPanel('settings'));
  rerender();
  expect((screen.getByLabelText('Input 1 name') as HTMLInputElement).value).toBe('food_total');
  expect((screen.getByLabelText('Input 2 type') as HTMLSelectElement).value).toBe('number');
  expect((screen.getByLabelText('Input 3 required') as HTMLInputElement).checked).toBe(true);
});

it('offers explicit sync for a stale default start without rewriting custom workflows', () => {
  const store = configureStore({ reducer: { workflowEditor: workflowEditorReducer } });
  const stale = blankDefinition();
  stale.inputs = [{ name: 'food_total', type: 'number', required: true }];
  stale.steps = [{ step_id: 'start', type: 'input_collection', name: 'Start', config: { fields: ['item'], prompt: '' }, on_success: 'end' }];
  store.dispatch(openDefinition({ workflowId: '', version: null, status: 'new', definition: stale }));
  const view = () => <Provider store={store}><Inspector bodySel={null} setBodySel={() => {}} requiredSetup /></Provider>;
  const mounted = render(view());
  expect(screen.getByText(/Start still collects item/)).toBeTruthy();
  fireEvent.click(screen.getByText('Sync start fields to inputs'));
  mounted.rerender(view());
  const draft = store.getState().workflowEditor.draft!;
  expect((draft.steps?.[0]?.config as { fields: string[] }).fields).toEqual(['food_total']);

});
