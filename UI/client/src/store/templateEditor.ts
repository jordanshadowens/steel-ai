// Unsaved template spec under edit. Mirrors the workflow editor split:
// published/draft versions live in RTK Query cache; this slice owns the
// working spec, selection and panels.
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { AnyTemplateSpec, TemplateKind } from '../api/contracts';

const UNDO_CAP = 50;

export type TemplatePanel = 'none' | 'library' | 'section' | 'settings';

interface TemplateEditorState {
  openTemplateId: string | null;
  openVersion: number | null;
  kind: TemplateKind;
  spec: AnyTemplateSpec | null;
  savedJson: string | null;
  selectedSection: number | null;
  panel: TemplatePanel;
  past: string[];
  future: string[];
  // Session-only example values for sample previews: never saved.
  sampleValues: Record<string, string>;
}

const initialState: TemplateEditorState = {
  openTemplateId: null,
  openVersion: null,
  kind: 'document',
  spec: null,
  savedJson: null,
  selectedSection: null,
  panel: 'none',
  past: [],
  future: [],
  sampleValues: {},
};

function snapshot(spec: AnyTemplateSpec): string {
  return JSON.stringify(spec);
}

export function detectKind(spec: unknown): TemplateKind {
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const s = spec as Record<string, unknown>;
    if (s.schema === 'steel-template/1' && (s.kind === 'spreadsheet' || s.kind === 'presentation')) return s.kind;
  }
  return 'document';
}

const slice = createSlice({
  name: 'templateEditor',
  initialState,
  reducers: {
    openSpec(state, action: PayloadAction<{ templateId: string; version: number | null; spec: AnyTemplateSpec; kind?: TemplateKind }>) {
      const { templateId, version, spec } = action.payload;
      state.openTemplateId = templateId;
      state.openVersion = version;
      state.kind = action.payload.kind ?? detectKind(spec);
      state.spec = spec;
      state.savedJson = snapshot(spec);
      state.selectedSection = null;
      state.panel = 'none';
      state.past = [];
      state.future = [];
      state.sampleValues = {};
    },
    closeSpec(state) {
      Object.assign(state, initialState);
    },
    updateSpec(state, action: PayloadAction<AnyTemplateSpec>) {
      if (!state.spec) return;
      state.past.push(snapshot(state.spec));
      if (state.past.length > UNDO_CAP) state.past.shift();
      state.future = [];
      state.spec = action.payload;
    },
    undoSpec(state) {
      const prev = state.past.pop();
      if (!state.spec || prev === undefined) return;
      state.future.push(snapshot(state.spec));
      state.spec = JSON.parse(prev) as AnyTemplateSpec;
    },
    redoSpec(state) {
      const next = state.future.pop();
      if (!state.spec || next === undefined) return;
      state.past.push(snapshot(state.spec));
      state.spec = JSON.parse(next) as AnyTemplateSpec;
    },
    markSpecSaved(state, action: PayloadAction<{ version: number | null }>) {
      if (!state.spec) return;
      state.savedJson = snapshot(state.spec);
      state.openVersion = action.payload.version;
    },
    selectSection(state, action: PayloadAction<number | null>) {
      state.selectedSection = action.payload;
      state.panel = action.payload === null ? state.panel : 'section';
    },
    setTemplatePanel(state, action: PayloadAction<TemplatePanel>) {
      state.panel = action.payload;
      if (action.payload !== 'section') state.selectedSection = null;
    },
    setSampleValue(state, action: PayloadAction<{ slot: string; value: string }>) {
      state.sampleValues[action.payload.slot] = action.payload.value;
    },
  },
});

export const {
  openSpec,
  closeSpec,
  updateSpec,
  undoSpec,
  redoSpec,
  markSpecSaved,
  selectSection,
  setTemplatePanel,
  setSampleValue,
} = slice.actions;

export const templateEditorReducer = slice.reducer;

export function isSpecDirty(state: TemplateEditorState): boolean {
  if (!state.spec || state.savedJson === null) return false;
  return snapshot(state.spec) !== state.savedJson;
}
