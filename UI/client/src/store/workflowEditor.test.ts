import { describe, expect, it } from 'vitest';
import { store } from './store';
import { closeDefinition, isDirty, markSaved, openDefinition, redo, undo, updateDraft } from './workflowEditor';
import type { WorkflowDefinition } from '../api/contracts';

const defA: WorkflowDefinition = { workflow_id: 'w', steps: [] };
const defB: WorkflowDefinition = { workflow_id: 'w', steps: [], name: 'B' };

describe('workflowEditor slice', () => {
  it('tracks dirty state and bounded undo/redo', () => {
    store.dispatch(closeDefinition());
    store.dispatch(openDefinition({ workflowId: 'w', version: 1, definition: defA }));
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
