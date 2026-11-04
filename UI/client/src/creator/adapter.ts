// Thin adapter between persisted workflow definitions and the graph
// engine. Only step identity, edge routing and node positions cross here;
// no graph-library data is ever serialized into the definition.
import { MarkerType } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import type { StepType, WorkflowDefinition, WorkflowStep } from '../api/contracts';

export const STEP_TYPES: Array<{ value: StepType; label: string; hint: string }> = [
  { value: 'input_collection', label: 'Collect inputs', hint: 'Gather project information' },
  { value: 'model_reasoning', label: 'Reason', hint: 'Model analysis with tools' },
  { value: 'database_retrieval', label: 'Look up data', hint: 'Read a project table' },
  { value: 'skill_retrieval', label: 'Find skill', hint: 'Search verified calculations' },
  { value: 'skill_execution', label: 'Calculate', hint: 'Run a verified skill' },
  { value: 'conditional_routing', label: 'Branch', hint: 'Route on conditions' },
  { value: 'iteration', label: 'Loop', hint: 'Repeat over a list' },
  { value: 'human_approval', label: 'Approval', hint: 'Pause for a human decision' },
  { value: 'output_composition', label: 'Compose', hint: 'Assemble results' },
  { value: 'document_generation', label: 'Document', hint: 'Generate the customer PDF' },
  { value: 'artifact_generation', label: 'Spreadsheet / Slides', hint: 'Generate an editable workbook or deck' },
];

export const TYPE_LABELS: Record<string, string> = {};
for (const t of STEP_TYPES) TYPE_LABELS[t.value] = t.label;

export const PRED_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'] as const;
export const PROJECT_TABLES = ['project_details', 'project_connections', 'connection_types', 'fabrication_productivity', 'material_inventory', 'labor_rates'];
export const REASON_TOOLS = ['case_search', 'skill_search', 'skill_execute', 'decline_action', 'skill_history', 'project_data'];

export const END_NODE_ID = '__end__';

export interface StepNodeData extends Record<string, unknown> {
  stepId: string;
  label: string;
  typeLabel: string;
  stepType: string;
  ruleCount: number;
}

// Edge identity never relies on color alone: success is solid, failure is
// dashed with an "on failure" label, conditionals are dotted with rule labels.
export const EDGE_CLASS = {
  success: 'edge-success',
  failure: 'edge-failure',
  conditional: 'edge-conditional',
} as const;

export function blankDefinition(): WorkflowDefinition {
  return {
    workflow_id: '',
    name: 'Untitled',
    version: 1,
    status: 'draft',
    inputs: [{ name: 'item', type: 'string', required: true }],
    steps: [{ step_id: 'start', type: 'input_collection', name: 'Start', config: { fields: ['item'], prompt: '' }, on_success: 'end' }],
    limits: { max_rounds: 40, max_iterations: 100 },
    outputs: {},
    policy: { execution_approval: 'first_run', skill_approval: 'new_names', four_eyes: false },
    ui: { positions: {} },
  };
}

export function defaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    case 'input_collection': return { fields: [], prompt: '' };
    case 'model_reasoning': return { goal: '', tools_allowed: ['project_data'], max_rounds: 3 };
    case 'database_retrieval': return { table: PROJECT_TABLES[0], limit: 100 };
    case 'skill_retrieval': return { query_template: '', top_k: 3 };
    case 'skill_execution': return { calculation_nl: '', deferred: true, inputs_mapping: {}, on_miss: 'propose' };
    case 'conditional_routing': return { rules: [] };
    case 'iteration': return { over: '', max_iterations: 10, body: [] };
    case 'human_approval': return { prompt: '' };
    case 'output_composition': return { mapping: {} };
    case 'document_generation': return { template: '' };
    case 'artifact_generation': return { kind: 'sheet', template: '' };
    default: return {};
  }
}

// New-workflow default start: exactly the factory shape (single
// input_collection `start` named `Start`, prompt '', fields array, end
// routing). Used to gate the bounded settings mirror below; any canvas
// customization (second step, renamed start, custom prompt/routing, extra
// config keys) opts out and preserves explicit fields.
export function isDefaultStartDefinition(def: WorkflowDefinition): boolean {
  const steps = def.steps ?? [];
  if (steps.length !== 1) return false;
  const s = steps[0];
  if (s.step_id !== 'start' || s.type !== 'input_collection') return false;
  if ((s.name ?? '') !== 'Start') return false;
  if ((s.on_success ?? '') !== 'end') return false;
  if (s.on_failure !== undefined) return false;
  const c = (s.config ?? {}) as Record<string, unknown>;
  if (typeof c.prompt !== 'string' || c.prompt !== '') return false;
  if (!Array.isArray(c.fields) || !c.fields.every((f) => typeof f === 'string')) return false;
  if (!Object.keys(c).every((k) => k === 'fields' || k === 'prompt')) return false;
  return true;
}

// True when the default start fields mirror the declared inputs in order.
// Add/remove mirror only while this holds, so explicit custom fields on
// old workflows are never silently rewritten.
export function defaultStartMirrorsInputs(def: WorkflowDefinition): boolean {
  if (!isDefaultStartDefinition(def)) return false;
  const fields = ((def.steps?.[0]?.config ?? {}) as { fields?: unknown }).fields as string[];
  const names = (def.inputs ?? []).map((i) => i.name);
  if (fields.length !== names.length) return false;
  return fields.every((f, i) => f === names[i]);
}

function fixInputRef(ref: unknown, oldName: string, newName: string): unknown {
  if (typeof ref !== 'string') return ref;
  if (ref === oldName) return newName;
  if (ref.startsWith(`${oldName}.`) || ref.startsWith(`${oldName}[`)) return newName + ref.slice(oldName.length);
  return ref;
}

function rewriteInputRefsInPredicateList(
  preds: Array<{ ref?: unknown }>,
  oldName: string,
  newName: string,
): void {
  for (const p of preds) {
    if (p && typeof p.ref === 'string') p.ref = fixInputRef(p.ref, oldName, newName) as string;
  }
}

function rewriteInputRefsInCondition(
  cond: unknown,
  oldName: string,
  newName: string,
): void {
  if (!cond || typeof cond !== 'object') return;
  const c = cond as { all?: unknown; any?: unknown; ref?: unknown };
  if (Array.isArray(c.all)) rewriteInputRefsInPredicateList(c.all as Array<{ ref?: unknown }>, oldName, newName);
  else if (Array.isArray(c.any)) rewriteInputRefsInPredicateList(c.any as Array<{ ref?: unknown }>, oldName, newName);
  else if (typeof c.ref === 'string') c.ref = fixInputRef(c.ref, oldName, newName) as string;
}

function rewriteInputRefsInSteps(steps: WorkflowStep[], oldName: string, newName: string): void {
  for (const s of steps) {
    const c = (s.config ?? {}) as Record<string, unknown>;
    if (s.type === 'input_collection' && Array.isArray(c.fields)) {
      c.fields = (c.fields as unknown[]).map((f) => (f === oldName ? newName : f));
    }
    if (s.type === 'conditional_routing' && Array.isArray(c.rules)) {
      for (const r of c.rules as Array<{ when?: unknown }>) {
        rewriteInputRefsInCondition(r?.when, oldName, newName);
      }
    }
    if (typeof c.over === 'string') c.over = fixInputRef(c.over, oldName, newName) as string;
    const pidf = c.project_id_from as { from?: string } | undefined;
    if (pidf && typeof pidf.from === 'string') pidf.from = fixInputRef(pidf.from, oldName, newName) as string;
    for (const holder of ['inputs_mapping', 'mapping', 'mappings']) {
      const m = c[holder] as Record<string, { from?: string }> | undefined;
      if (m && typeof m === 'object') {
        for (const k of Object.keys(m)) {
          if (m[k] && typeof m[k].from === 'string') m[k].from = fixInputRef(m[k].from, oldName, newName) as string;
        }
      }
    }
    const skill = c.skill as { from?: string } | undefined;
    if (skill && typeof skill.from === 'string') skill.from = fixInputRef(skill.from, oldName, newName) as string;
    if (s.type === 'iteration' && Array.isArray(c.body)) {
      rewriteInputRefsInSteps(c.body as WorkflowStep[], oldName, newName);
    }
    s.config = c;
  }
}

// Undeclared fields on the default start (stale after a pre-fix rename,
// or an empty intermediate). Custom valid subsets are NOT stale.
export function defaultStartHasUndeclared(def: WorkflowDefinition): boolean {
  if (!isDefaultStartDefinition(def)) return false;
  const names = new Set((def.inputs ?? []).map((i) => i.name));
  const fields = ((def.steps?.[0]?.config ?? {}) as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return false;
  return (fields as unknown[]).some((f) => typeof f === 'string' && !names.has(f));
}

export function defaultStartStaleFields(def: WorkflowDefinition): string[] {
  if (!isDefaultStartDefinition(def)) return [];
  const names = new Set((def.inputs ?? []).map((i) => i.name));
  const fields = ((def.steps?.[0]?.config ?? {}) as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return (fields as unknown[]).filter((f): f is string => typeof f === 'string' && !names.has(f));
}

function remirrorDefaultStart(out: WorkflowDefinition): void {
  const start = out.steps?.[0];
  if (!start || !isDefaultStartDefinition(out)) return;
  const names = (out.inputs ?? []).map((i) => i.name).filter((n) => n !== '');
  start.config = { ...(start.config ?? {}), fields: names };
}

// Bounded input-reference behavior (batch10):
// - Rename propagates exact root matches across fields, every {from}
//   holder, predicates, over/project/skill refs, outputs, iteration
//   bodies, and presentation keys (suffixes preserved). Empty or
//   unchanged names set the declared value but rewrite nothing, so
//   intermediate typing never scatters empty refs; validation reports
//   the invalid name actionably on Save/Validate.
// - Add/remove mirror the default start fields ONLY while the workflow
//   is still the factory default AND (fields mirror inputs in order OR
//   fields contain undeclared stale names). Custom valid subsets and
//   old multi-step workflows are untouched; dangling refs from removal
//   are left for validation/preflight to surface, never silently
//   deleted (except the mirrored/stale default field, which is not a
//   custom binding).
// - A stale default (pre-fix rename, empty intermediate) is repaired
//   explicitly: the next non-empty rename/add/remove re-mirrors, and
//   settings offers a Sync button. Nothing rewrites on load/open.
// - Free-text configs (prompts, goals, query_template,
//   calculation_nl) are never rewritten.
// - Presentation field metadata moves on rename (when the new key is
//   free); removal preserves orphan metadata rather than discarding
//   entered labels/units.
export function renameWorkflowInput(def: WorkflowDefinition, index: number, newName: string): WorkflowDefinition | null {
  const inputs = def.inputs ?? [];
  if (index < 0 || index >= inputs.length) return null;
  const staleBefore = defaultStartHasUndeclared(def);
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  const target = out.inputs?.[index];
  if (!target) return null;
  const oldName = target.name;
  target.name = newName;
  if (!oldName || !newName || oldName === newName) return out;
  rewriteInputRefsInSteps(out.steps ?? [], oldName, newName);
  for (const k of Object.keys(out.outputs ?? {})) {
    const o = (out.outputs as Record<string, { from?: string }>)[k];
    if (o && typeof o.from === 'string') o.from = fixInputRef(o.from, oldName, newName) as string;
  }
  const pres = (out.ui as Record<string, unknown> | undefined)?.input_presentation as
    | { fields?: Record<string, { visibleWhen?: { field?: string } }> }
    | undefined;
  if (pres?.fields && typeof pres.fields === 'object') {
    if (pres.fields[oldName] !== undefined && pres.fields[newName] === undefined) {
      pres.fields[newName] = pres.fields[oldName];
      delete pres.fields[oldName];
    } else if (pres.fields[oldName] !== undefined && pres.fields[newName] !== undefined) {
      delete pres.fields[oldName];
    }
    for (const meta of Object.values(pres.fields)) {
      if (meta?.visibleWhen?.field === oldName) meta.visibleWhen.field = newName;
    }
  }
  if (staleBefore && isDefaultStartDefinition(out)) remirrorDefaultStart(out);
  return out;
}

export function addWorkflowInput(def: WorkflowDefinition): WorkflowDefinition {
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  out.inputs = out.inputs ?? [];
  const mirrorBefore = defaultStartMirrorsInputs(def);
  const staleBefore = defaultStartHasUndeclared(def);
  out.inputs.push({ name: `input${out.inputs.length + 1}`, type: 'string', required: false });
  if (isDefaultStartDefinition(out) && (mirrorBefore || staleBefore)) remirrorDefaultStart(out);
  return out;
}

export function removeWorkflowInput(def: WorkflowDefinition, index: number): WorkflowDefinition | null {
  const inputs = def.inputs ?? [];
  if (index < 0 || index >= inputs.length) return null;
  const mirrorBefore = defaultStartMirrorsInputs(def);
  const staleBefore = defaultStartHasUndeclared(def);
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  out.inputs?.splice(index, 1);
  if (isDefaultStartDefinition(out) && (mirrorBefore || staleBefore)) remirrorDefaultStart(out);
  return out;
}

// Explicit user-approved repair for a stale default start (Sync button).
// Returns null unless the default start has undeclared fields.
export function syncDefaultStartFields(def: WorkflowDefinition): WorkflowDefinition | null {
  if (!defaultStartHasUndeclared(def)) return null;
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  remirrorDefaultStart(out);
  return out;
}

function autoPosition(index: number): { x: number; y: number } {
  return { x: 40 + (index % 4) * 250, y: 60 + Math.floor(index / 4) * 130 };
}

function targetNodeId(target: string | undefined, known: Set<string>): string {
  if (target === 'end' || !target || !known.has(target)) return END_NODE_ID;
  return target;
}

// Structural fingerprint: changes only when steps, names, types or routing
// change — never for position-only edits. The canvas rebuilds nodes/edges
// on this key so dragging never fights the graph engine.
export function structureKey(def: WorkflowDefinition): string {
  return JSON.stringify(
    (def.steps ?? []).map((s) => [
      s.step_id,
      s.type,
      s.name ?? '',
      s.on_success ?? '',
      s.on_failure ?? '',
      s.type === 'conditional_routing' && Array.isArray((s.config as Record<string, unknown> | undefined)?.rules)
        ? ((s.config as Record<string, unknown>).rules as Array<{ goto?: string }>).map((r) => r?.goto ?? '')
        : [],
    ]),
  );
}

export function definitionToFlow(def: WorkflowDefinition, selectedStepId: string | null): { nodes: Node[]; edges: Edge[] } {
  const steps = def.steps ?? [];
  const known = new Set(steps.map((s) => s.step_id));
  const positions = def.ui?.positions ?? {};
  const nodes: Node[] = steps.map((s, i) => ({
    id: s.step_id,
    type: 'step',
    position: positions[s.step_id] ?? autoPosition(i),
    data: {
      stepId: s.step_id,
      label: s.name || s.step_id,
      typeLabel: TYPE_LABELS[s.type] ?? s.type,
      stepType: s.type,
      ruleCount: s.type === 'conditional_routing' && Array.isArray((s.config as Record<string, unknown> | undefined)?.rules)
        ? ((s.config as Record<string, unknown>).rules as unknown[]).length
        : 0,
    } satisfies StepNodeData,
    selected: selectedStepId === s.step_id,
  }));
  const maxX = nodes.reduce((m, n) => Math.max(m, n.position.x), 0);
  nodes.push({
    id: END_NODE_ID,
    type: 'end',
    position: { x: maxX + 320, y: 60 },
    data: {},
    draggable: false,
    selectable: false,
    deletable: false,
  });

  const edges: Edge[] = [];
  for (const s of steps) {
    edges.push({
      id: `ok:${s.step_id}`,
      source: s.step_id,
      target: targetNodeId(s.on_success, known),
      className: EDGE_CLASS.success,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#4d5a6e' },
      deletable: false,
    });
    if (s.on_failure) {
      edges.push({
        id: `fail:${s.step_id}`,
        source: s.step_id,
        target: targetNodeId(s.on_failure, known),
        sourceHandle: 'fail',
        className: EDGE_CLASS.failure,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#b3261e' },
        label: 'on failure',
      });
    }
    const rules = (s.config as Record<string, unknown> | undefined)?.rules;
    if (s.type === 'conditional_routing' && Array.isArray(rules)) {
      (rules as Array<{ goto?: string; when?: unknown }>).forEach((r, i) => {
        if (typeof r?.goto !== 'string' || r.goto === '' || r.goto === s.on_success) return;
        edges.push({
          id: `cond:${s.step_id}:${i}`,
          source: s.step_id,
          target: targetNodeId(r.goto, known),
          sourceHandle: `cond-${i}`,
          className: EDGE_CLASS.conditional,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#8a5a00' },
          label: `rule ${i + 1}`,
        });
      });
    }
  }
  return { nodes, edges };
}

export function withPositions(def: WorkflowDefinition, positions: Record<string, { x: number; y: number }>): WorkflowDefinition {
  const merged = { ...(def.ui?.positions ?? {}) };
  for (const [k, v] of Object.entries(positions)) {
    if (k === END_NODE_ID) continue;
    merged[k] = { x: Math.max(0, Math.round(v.x)), y: Math.max(0, Math.round(v.y)) };
  }
  return { ...def, ui: { ...(def.ui ?? {}), positions: merged } };
}

// Persistable payload: definition plus the session viewport. Viewport edits
// never mark the draft dirty by themselves; they ride along on save.
export function savePayload(def: WorkflowDefinition, viewport: { x: number; y: number; zoom: number } | null): WorkflowDefinition {
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  out.ui = out.ui ?? {};
  if (viewport) {
    out.ui.view = { x: Math.round(viewport.x), y: Math.round(viewport.y), w: 0, h: 0 };
  }
  return out;
}

function fixRef(ref: unknown, oldId: string, newId: string): unknown {
  if (typeof ref !== 'string') return ref;
  if (ref === oldId) return newId;
  if (ref.startsWith(`${oldId}.`) || ref.startsWith(`${oldId}[`)) return newId + ref.slice(oldId.length);
  return ref;
}

// Rename a step and rewrite every reference to it (edges, predicates,
// mappings, outputs). Returns null when the new id is unusable.
export function renameStep(def: WorkflowDefinition, oldId: string, newId: string): WorkflowDefinition | null {
  const id = newId.trim();
  if (!id || id === oldId || id === 'end') return null;
  if ((def.steps ?? []).some((s) => s.step_id === id)) return null;
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  const renamed = out.steps?.find((s) => s.step_id === oldId);
  if (!renamed) return null;
  renamed.step_id = id;
  const fixList = (list: WorkflowStep[]): void => {
    for (const s of list) {
      if (s.on_success === oldId) s.on_success = id;
      if (s.on_failure === oldId) s.on_failure = id;
      const c = (s.config ?? {}) as Record<string, unknown>;
      if (s.type === 'conditional_routing' && Array.isArray(c.rules)) {
        for (const r of c.rules as Array<{ goto?: string; when?: unknown }>) {
          if (r.goto === oldId) r.goto = id;
          const w = r.when as { all?: unknown[]; any?: unknown[]; ref?: string } | null | undefined;
          if (w && typeof w === 'object') {
            const preds = (Array.isArray(w.all) ? w.all : Array.isArray(w.any) ? w.any : [w]) as Array<{ ref?: unknown }>;
            for (const p of preds) {
              if (p && typeof p.ref === 'string') p.ref = fixRef(p.ref, oldId, id) as string;
            }
          }
        }
      }
      if (typeof c.over === 'string') c.over = fixRef(c.over, oldId, id) as string;
      const pidf = c.project_id_from as { from?: string } | undefined;
      if (pidf && typeof pidf.from === 'string') pidf.from = fixRef(pidf.from, oldId, id) as string;
      for (const holder of ['inputs_mapping', 'mapping', 'mappings']) {
        const m = c[holder] as Record<string, { from?: string }> | undefined;
        if (m && typeof m === 'object') {
          for (const k of Object.keys(m)) {
            if (m[k] && typeof m[k].from === 'string') m[k].from = fixRef(m[k].from, oldId, id) as string;
          }
        }
      }
      const skill = c.skill as { from?: string } | undefined;
      if (skill && typeof skill.from === 'string') skill.from = fixRef(skill.from, oldId, id) as string;
      if (s.type === 'iteration' && Array.isArray(c.body)) fixList(c.body as WorkflowStep[]);
      s.config = c;
    }
  };
  fixList(out.steps ?? []);
  for (const k of Object.keys(out.outputs ?? {})) {
    const o = (out.outputs as Record<string, { from?: string }>)[k];
    if (o && typeof o.from === 'string') o.from = fixRef(o.from, oldId, id) as string;
  }
  if (out.ui?.positions?.[oldId]) {
    out.ui.positions[id] = out.ui.positions[oldId];
    delete out.ui.positions[oldId];
  }
  return out;
}

// Delete a top-level step; dangling edges collapse to end. Refuses to
// remove the last step.
export function deleteStep(def: WorkflowDefinition, stepId: string): WorkflowDefinition | null {
  const steps = def.steps ?? [];
  if (steps.length <= 1 || !steps.some((s) => s.step_id === stepId)) return null;
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  out.steps = (out.steps ?? []).filter((s) => s.step_id !== stepId);
  for (const s of out.steps ?? []) {
    if (s.on_success === stepId) s.on_success = 'end';
    if (s.on_failure === stepId) delete s.on_failure;
    const c = (s.config ?? {}) as Record<string, unknown>;
    if (s.type === 'conditional_routing' && Array.isArray(c.rules)) {
      for (const r of c.rules as Array<{ goto?: string }>) {
        if (r.goto === stepId) r.goto = 'end';
      }
    }
  }
  if (out.ui?.positions) delete out.ui.positions[stepId];
  return out;
}
