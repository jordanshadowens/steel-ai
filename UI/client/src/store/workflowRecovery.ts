import { workflowEditorReducer } from './workflowEditor';

const KEY = 'steel.workflow-draft.v1';
type EditorState = ReturnType<typeof workflowEditorReducer>;

// Tab-local recovery only; explicit Save/Publish still owns server versions.
export function loadWorkflowRecovery(storage: Storage): EditorState | undefined {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as EditorState;
    if (!s.draft || typeof s.draft.workflow_id !== 'string' || !Array.isArray(s.draft.steps)
      || !s.draft.steps.every((step) => typeof step.step_id === 'string' && typeof step.type === 'string')) return;
    const initial = workflowEditorReducer(undefined, { type: '@@init' });
    return { ...initial, draft: s.draft, savedJson: typeof s.savedJson === 'string' ? s.savedJson : null,
      openWorkflowId: s.openWorkflowId, openVersion: s.openVersion, openStatus: s.openStatus,
      skillSamples: s.skillSamples ?? {}, skillModes: s.skillModes ?? {} };
  } catch { return; }
}

export function saveWorkflowRecovery(storage: Storage, state: EditorState): void {
  try {
    if (!state.draft) storage.removeItem(KEY);
    else storage.setItem(KEY, JSON.stringify({ draft: state.draft, savedJson: state.savedJson,
      openWorkflowId: state.openWorkflowId, openVersion: state.openVersion, openStatus: state.openStatus,
      skillSamples: state.skillSamples, skillModes: state.skillModes }));
  } catch { /* Storage may be blocked or full; never interrupt editing. */ }
}
