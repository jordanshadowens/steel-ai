import { describe, expect, it } from 'vitest';
import { store } from './store';
import {
  acceptSavedDraft,
  closeDefinition,
  isDirty,
  markSaved,
  openDefinition,
  redo,
  setViewport,
  undo,
  updateDraft,
} from './workflowEditor';
import type { WorkflowDefinition } from '../api/contracts';

const defA: WorkflowDefinition = { workflow_id: 'w', steps: [] };
const defB: WorkflowDefinition = { workflow_id: 'w', steps: [], name: 'B' };

describe('workflowEditor slice', () => {
  it('tracks dirty state and bounded undo/redo', () => {
    store.dispatch(closeDefinition());
    store.dispatch(
      openDefinition({ workflowId: 'w', version: 1, definition: defA }),
    );
    expect(isDirty(store.getState().workflowEditor)).toBe(false);
    store.dispatch(updateDraft(defB));
    expect(isDirty(store.getState().workflowEditor)).toBe(true);
    expect(store.getState().workflowEditor.draft?.name).toBe('B');
    store.dispatch(undo());
    expect(store.getState().workflowEditor.draft?.name).toBeUndefined();
    expect(isDirty(store.getState().workflowEditor)).toBe(false);
    store.dispatch(redo());
    expect(store.getState().workflowEditor.draft?.name).toBe('B');
    store.dispatch(markSaved({ version: 2 }));
    expect(isDirty(store.getState().workflowEditor)).toBe(false);
    expect(store.getState().workflowEditor.openVersion).toBe(2);
  });
});

it('loads the saved canvas view and clears it when a version has no saved zoom', () => {
  const definition = { ...defA, ui: { view: { x: 15, y: -25, w: 0, h: 0, zoom: 0.75 } } };
  store.dispatch(openDefinition({ workflowId: 'w', version: 1, definition }));
  const opened = store.getState().workflowEditor;
  expect(opened.viewport).toEqual({ x: 15, y: -25, zoom: 0.75 });
  store.dispatch(setViewport({ x: 230, y: 140, zoom: 1.25 }));
  store.dispatch(openDefinition({ workflowId: 'w', version: 2, definition: defB }));
  expect(store.getState().workflowEditor.viewport).toBeNull();
  expect(store.getState().workflowEditor.openSequence).toBe(opened.openSequence + 1);
});

it('keeps the saved ID and version when undoing across the first save and autosaves', () => {
  const original = { workflow_id: '', name: 'Untitled', steps: [] };
  const first = { ...original, workflow_id: 'saved-workflow' };
  store.dispatch(openDefinition({ workflowId: '', version: null, definition: original }));
  store.dispatch(updateDraft(first));
  store.dispatch(acceptSavedDraft({ definition: first, version: 1, status: 'draft' }));
  store.dispatch(undo());
  expect(store.getState().workflowEditor.draft).toEqual({ ...first, version: 1 });

  const renamed = { ...first, name: 'Renamed' };
  store.dispatch(updateDraft(renamed));
  store.dispatch(acceptSavedDraft({ definition: renamed, version: 2, status: 'draft' }));
  store.dispatch(undo());
  expect(store.getState().workflowEditor.draft).toEqual({ ...first, version: 2 });
  store.dispatch(redo());
  expect(store.getState().workflowEditor.draft).toEqual({ ...renamed, version: 2 });
  expect(isDirty(store.getState().workflowEditor)).toBe(false);
});
