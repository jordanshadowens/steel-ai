// Unsaved workflow definition under edit. Server rows stay in RTK Query
// cache; this slice owns only the draft, selection, panels, viewport
// preferences and bounded undo. High-frequency pointer motion stays local
// to the graph engine — only committed positions land here.
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { WorkflowDefinition } from '../api/contracts';

const UNDO_CAP = 50;

export type EditorPanel = 'none' | 'library' | 'inspector' | 'issues' | 'settings';

interface WorkflowEditorState {
  openWorkflowId: string | null;
  openVersion: number | null;
  openStatus: string | null;
  draft: WorkflowDefinition | null;
  savedJson: string | null;
  selectedStepId: string | null;
  panel: EditorPanel;
  issueIndex: number;
  viewport: { x: number; y: number; zoom: number } | null;
  past: string[];
  future: string[];
  // Session-only skill authoring state: never saved into the definition.
  skillSamples: Record<string, Record<string, string>>;
  skillModes: Record<string, 'saved' | 'new' | 'ref'>;
  skillDrafts: Record<string, { ok: boolean; skill?: { name: string; version: number }; tests?: unknown; note?: string; error?: string }>;
}

const initialState: WorkflowEditorState = {
  openWorkflowId: null,
  openVersion: null,
  openStatus: null,
  draft: null,
  savedJson: null,
  selectedStepId: null,
  panel: 'none',
  issueIndex: 0,
  viewport: null,
  past: [],
  future: [],
  skillSamples: {},
  skillModes: {},
  skillDrafts: {},
};

function snapshot(draft: WorkflowDefinition): string {
  return JSON.stringify(draft);
}

const slice = createSlice({
  name: 'workflowEditor',
  initialState,
  reducers: {
    openDefinition(state, action: PayloadAction<{ workflowId: string; version: number | null; status?: string | null; definition: WorkflowDefinition }>) {
      const { workflowId, version, status, definition } = action.payload;
      state.openWorkflowId = workflowId;
      state.openVersion = version;
      state.openStatus = status ?? null;
      state.draft = definition;
      state.savedJson = snapshot(definition);
      state.selectedStepId = null;
      state.panel = 'none';
      state.issueIndex = 0;
      state.past = [];
      state.future = [];
      state.skillSamples = {};
      state.skillModes = {};
      state.skillDrafts = {};
    },
    closeDefinition(state) {
      Object.assign(state, initialState);
    },
    updateDraft(state, action: PayloadAction<WorkflowDefinition>) {
      if (!state.draft) return;
      state.past.push(snapshot(state.draft));
      if (state.past.length > UNDO_CAP) state.past.shift();
      state.future = [];
      state.draft = action.payload;
    },
    undo(state) {
      const prev = state.past.pop();
      if (!state.draft || prev === undefined) return;
      state.future.push(snapshot(state.draft));
      state.draft = JSON.parse(prev) as WorkflowDefinition;
    },
    redo(state) {
      const next = state.future.pop();
      if (!state.draft || next === undefined) return;
      state.past.push(snapshot(state.draft));
      state.draft = JSON.parse(next) as WorkflowDefinition;
    },
    markSaved(state, action: PayloadAction<{ version: number | null; status?: string | null }>) {
      if (!state.draft) return;
      state.savedJson = snapshot(state.draft);
      state.openVersion = action.payload.version;
      if (action.payload.status !== undefined) state.openStatus = action.payload.status;
    },
    acceptSavedDraft(state, action: PayloadAction<{ definition: WorkflowDefinition; version: number; status: string }>) {
      if (!state.draft) return;
      // A save response must never replace edits made while it was in flight.
      state.draft.version = action.payload.version;
      state.savedJson = snapshot({ ...action.payload.definition, version: action.payload.version });
      state.openVersion = action.payload.version;
      state.openStatus = action.payload.status;
    },
    setOpenStatus(state, action: PayloadAction<string | null>) {
      state.openStatus = action.payload;
    },
    selectStep(state, action: PayloadAction<string | null>) {
      state.selectedStepId = action.payload;
      state.panel = action.payload ? 'inspector' : state.panel === 'inspector' ? 'none' : state.panel;
    },
    setPanel(state, action: PayloadAction<EditorPanel>) {
      state.panel = action.payload;
      if (action.payload !== 'inspector') state.selectedStepId = null;
    },
    setIssueIndex(state, action: PayloadAction<number>) {
      state.issueIndex = action.payload;
    },
    setViewport(state, action: PayloadAction<{ x: number; y: number; zoom: number }>) {
      state.viewport = action.payload;
    },
    setSkillSample(state, action: PayloadAction<{ stepId: string; param: string; value: string }>) {
      const { stepId, param, value } = action.payload;
      state.skillSamples[stepId] = { ...(state.skillSamples[stepId] ?? {}), [param]: value };
    },
    setSkillMode(state, action: PayloadAction<{ stepId: string; mode: 'saved' | 'new' | 'ref' | null }>) {
      if (action.payload.mode === null) delete state.skillModes[action.payload.stepId];
      else state.skillModes[action.payload.stepId] = action.payload.mode;
    },
    setSkillDraft(state, action: PayloadAction<{ stepId: string; outcome: WorkflowEditorState['skillDrafts'][string] | null }>) {
      if (action.payload.outcome === null) delete state.skillDrafts[action.payload.stepId];
      else state.skillDrafts[action.payload.stepId] = action.payload.outcome;
    },
  },
});

export const {
  openDefinition,
  closeDefinition,
  updateDraft,
  undo,
  redo,
  markSaved,
  acceptSavedDraft,
  setOpenStatus,
  setSkillSample,
  setSkillMode,
  setSkillDraft,
  selectStep,
  setPanel,
  setIssueIndex,
  setViewport,
} = slice.actions;

export const workflowEditorReducer = slice.reducer;

export function isDirty(state: WorkflowEditorState): boolean {
  if (!state.draft || state.savedJson === null) return false;
  return snapshot(state.draft) !== state.savedJson;
}
