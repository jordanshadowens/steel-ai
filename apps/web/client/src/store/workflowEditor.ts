// Unsaved workflow definition under edit. Server rows stay in RTK Query
// cache; this slice owns only the draft, selection, panels, viewport
// preferences and bounded undo. High-frequency pointer motion stays local
// to the graph engine — only committed positions land here.
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { WorkflowDefinition } from '../api/contracts';

const UNDO_CAP = 50;

export type EditorPanel =
  | 'none'
  | 'library'
  | 'inspector'
  | 'issues'
  | 'settings';

interface WorkflowEditorState {
  openSequence: number;
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
  skillDrafts: Record<
    string,
    {
      ok: boolean;
      skill?: { name: string; version: number };
      tests?: unknown;
      note?: string;
      error?: string;
    }
  >;
}

const initialState: WorkflowEditorState = {
  openSequence: 0,
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

function takeHistoryDraft(
  history: string[],
  current: WorkflowDefinition,
  saved: boolean,
): WorkflowDefinition | null {
  const currentJson = snapshot(current);
  while (history.length > 0) {
    const historical = JSON.parse(history.pop()!) as WorkflowDefinition;
    if (saved) {
      historical.workflow_id = current.workflow_id;
      if (current.version === undefined) delete historical.version;
      else historical.version = current.version;
      if (current.status === undefined) delete historical.status;
      else historical.status = current.status;
    }
    if (snapshot(historical) !== currentJson) return historical;
  }
  return null;
}

const slice = createSlice({
  name: 'workflowEditor',
  initialState,
  reducers: {
    openDefinition(
      state,
      action: PayloadAction<{
        workflowId: string;
        version: number | null;
        status?: string | null;
        definition: WorkflowDefinition;
      }>,
    ) {
      const { workflowId, version, status, definition } = action.payload;
      state.openSequence += 1;
      state.openWorkflowId = workflowId;
      state.viewport = normalizeWorkflowViewport(definition.ui?.view);
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
      Object.assign(state, initialState, { openSequence: state.openSequence + 1 });
    },
    updateDraft(state, action: PayloadAction<WorkflowDefinition>) {
      if (!state.draft) {
        return;
      }
      state.past.push(snapshot(state.draft));
      if (state.past.length > UNDO_CAP) {
        state.past.shift();
      }
      state.future = [];
      state.draft = action.payload;
    },
    undo(state) {
      if (!state.draft) return;
      const previous = takeHistoryDraft(state.past, state.draft, state.openVersion !== null);
      if (!previous) return;
      state.future.push(snapshot(state.draft));
      state.draft = previous;
    },
    redo(state) {
      if (!state.draft) return;
      const next = takeHistoryDraft(state.future, state.draft, state.openVersion !== null);
      if (!next) return;
      state.past.push(snapshot(state.draft));
      state.draft = next;
    },
    markSaved(
      state,
      action: PayloadAction<{ version: number | null; status?: string | null }>,
    ) {
      if (!state.draft) {
        return;
      }
      state.savedJson = snapshot(state.draft);
      state.openVersion = action.payload.version;
      if (action.payload.status !== undefined) {
        state.openStatus = action.payload.status;
      }
    },
    acceptSavedDraft(
      state,
      action: PayloadAction<{
        definition: WorkflowDefinition;
        version: number;
        status: string;
      }>,
    ) {
      if (!state.draft) {
        return;
      }
      // The first save fixes the ID. Preserve other edits made while the request was in flight.
      state.draft.version = action.payload.version;
      state.draft.workflow_id = action.payload.definition.workflow_id;
      state.openWorkflowId = action.payload.definition.workflow_id;
      state.savedJson = snapshot({
        ...action.payload.definition,
        version: action.payload.version,
      });
      state.openVersion = action.payload.version;
      state.openStatus = action.payload.status;
    },
    setOpenStatus(state, action: PayloadAction<string | null>) {
      state.openStatus = action.payload;
    },
    selectStep(state, action: PayloadAction<string | null>) {
      state.selectedStepId = action.payload;
      state.panel = action.payload
        ? 'inspector'
        : state.panel === 'inspector'
          ? 'none'
          : state.panel;
    },
    setPanel(state, action: PayloadAction<EditorPanel>) {
      state.panel = action.payload;
      if (action.payload !== 'inspector') {
        state.selectedStepId = null;
      }
    },
    setIssueIndex(state, action: PayloadAction<number>) {
      state.issueIndex = action.payload;
    },
    setViewport(
      state,
      action: PayloadAction<{ x: number; y: number; zoom: number }>,
    ) {
      state.viewport = action.payload;
    },
    setSkillSample(
      state,
      action: PayloadAction<{ stepId: string; param: string; value: string }>,
    ) {
      const { stepId, param, value } = action.payload;
      state.skillSamples[stepId] = {
        ...(state.skillSamples[stepId] ?? {}),
        [param]: value,
      };
    },
    setSkillMode(
      state,
      action: PayloadAction<{
        stepId: string;
        mode: 'saved' | 'new' | 'ref' | null;
      }>,
    ) {
      if (action.payload.mode === null) {
        delete state.skillModes[action.payload.stepId];
      } else {
        state.skillModes[action.payload.stepId] = action.payload.mode;
      }
    },
    setSkillDraft(
      state,
      action: PayloadAction<{
        stepId: string;
        outcome: WorkflowEditorState['skillDrafts'][string] | null;
      }>,
    ) {
      if (action.payload.outcome === null) {
        delete state.skillDrafts[action.payload.stepId];
      } else {
        state.skillDrafts[action.payload.stepId] = action.payload.outcome;
      }
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

export function normalizeWorkflowViewport(
  view: { x: number; y: number; zoom?: number } | null | undefined,
): WorkflowEditorState['viewport'] {
  if (!view || !Number.isFinite(view.x) || !Number.isFinite(view.y) || typeof view.zoom !== 'number' || !Number.isFinite(view.zoom)) {
    return null;
  }
  return { x: view.x, y: view.y, zoom: Math.min(2, Math.max(0.2, view.zoom)) };
}

export function isDirty(state: WorkflowEditorState): boolean {
  if (!state.draft || state.savedJson === null) {
    return false;
  }
  return snapshot(state.draft) !== state.savedJson;
}
