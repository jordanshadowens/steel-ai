import { beforeEach, expect, it } from 'vitest';
import { blankDefinition } from '../creator/adapter';
import { openDefinition, setSkillMode, setSkillSample, updateDraft, workflowEditorReducer } from './workflowEditor';
import { loadWorkflowRecovery, preserveLocalRecovery, saveWorkflowRecovery } from './workflowRecovery';

beforeEach(() => sessionStorage.clear());

it('preserves both local drafts when legacy recovery conflicts with the current local key', () => {
  sessionStorage.setItem('steel.workflow-draft.v1', 'older unsaved draft');
  sessionStorage.setItem('steel.workflow-draft.local.v1', 'newer unsaved draft');
  preserveLocalRecovery(sessionStorage);
  expect(sessionStorage.getItem('steel.workflow-draft.v1')).toBe('older unsaved draft');
  expect(sessionStorage.getItem('steel.workflow-draft.local.v1')).toBe('newer unsaved draft');
});

it('recovers unsaved fields and sample values without marking the draft saved', () => {
  const initial = workflowEditorReducer(undefined, openDefinition({ workflowId: 'test', version: 1, definition: blankDefinition() }));
  const draft = structuredClone(initial.draft!);
  draft.steps![0].name = 'Expense details';
  const edited = workflowEditorReducer(workflowEditorReducer(initial, updateDraft(draft)),
    setSkillSample({ stepId: 'start', param: 'expenses', value: '123' }));
  saveWorkflowRecovery(sessionStorage, workflowEditorReducer(edited, setSkillMode({ stepId: 'start', mode: 'new' })));
  const recovered = loadWorkflowRecovery(sessionStorage)!;
  expect(recovered.draft?.steps?.[0].name).toBe('Expense details');
  expect(recovered.savedJson).toBe(initial.savedJson);
  expect(JSON.stringify(recovered.draft)).not.toBe(recovered.savedJson);
  expect(recovered.skillSamples.start.expenses).toBe('123');
  expect(recovered.skillModes.start).toBe('new');
});

it('ignores corrupt recovery and removes recovery when the draft is closed', () => {
  sessionStorage.setItem('steel.workflow-draft.v1', '{broken');
  expect(loadWorkflowRecovery(sessionStorage)).toBeUndefined();
  saveWorkflowRecovery(sessionStorage, workflowEditorReducer(undefined, { type: '@@init' }));
  expect(sessionStorage.getItem('steel.workflow-draft.v1')).toBeNull();
});
