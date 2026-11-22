// Thin adapter between persisted workflow definitions and the graph
// engine. Only step identity, edge routing and node positions cross here;
// no graph-library data is ever serialized into the definition.
import { MarkerType } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import type {
  StepType,
  WorkflowDefinition,
  WorkflowStep,
} from '../api/contracts';

export const INPUT_TYPE_LABELS = {
  string: 'Text',
  number: 'Number',
  boolean: 'Boolean',
  object: 'JSON',
  array: 'Array',
} as const;

export function inputTypeLabel(type = 'string'): string {
  return Object.hasOwn(INPUT_TYPE_LABELS, type)
    ? INPUT_TYPE_LABELS[type as keyof typeof INPUT_TYPE_LABELS]
    : type;
}

export const EXECUTION_APPROVAL_OPTIONS = [
  { value: 'none', label: 'Never ask' },
  { value: 'first_run', label: 'First run' },
  { value: 'always', label: 'Every run' },
];

export const SKILL_APPROVAL_OPTIONS = [
  { value: 'auto', label: 'Skip skill approval' },
  { value: 'new_names', label: 'Ask for new skill names' },
];

export const STEP_TYPES: Array<{
  value: StepType;
  label: string;
  hint: string;
}> = [
  {
    value: 'input_collection',
    label: 'Collect inputs',
    hint: 'Ask for workflow inputs',
  },
  {
    value: 'model_reasoning',
    label: 'Run model',
    hint: 'Send instructions to a model and allow selected tools',
  },
  {
    value: 'database_retrieval',
    label: 'Look up data',
    hint: 'Read records from a table or data model',
  },
  {
    value: 'skill_retrieval',
    label: 'Find calculation',
    hint: 'Search saved calculations',
  },
  {
    value: 'lang_verification',
    label: 'Test program',
    hint: 'Run a program against published test cases',
  },
  {
    value: 'lang_execution',
    label: 'Run program',
    hint: 'Run a .lang program',
  },
  {
    value: 'lang_recall',
    label: 'Find past runs',
    hint: 'Look up previous program runs',
  },
  {
    value: 'skill_verification',
    label: 'Verify calculation',
    hint: 'Compare a calculation with expected results',
  },
  {
    value: 'skill_execution',
    label: 'Calculate',
    hint: 'Run a saved calculation',
  },
  {
    value: 'conditional_routing',
    label: 'Branch',
    hint: 'Choose the next step based on a condition',
  },
  { value: 'iteration', label: 'Loop', hint: 'Repeat over a list' },
  {
    value: 'human_approval',
    label: 'Approval',
    hint: 'Wait for someone to approve or reject',
  },
  { value: 'output_composition', label: 'Set results', hint: 'Map values to named results' },
];

const TYPE_LABELS: Record<string, string> = {
  document_generation: 'Document (retired)',
  artifact_generation: 'Spreadsheet (retired)',
};
for (const t of STEP_TYPES) {
  TYPE_LABELS[t.value] = t.label;
}

export function stepNameWithId(step: Pick<WorkflowStep, 'step_id' | 'name'>): string {
  return step.name && step.name !== step.step_id
    ? `${step.name} (${step.step_id})`
    : step.step_id;
}

export function stepTypeLabel(step: { type: string; config?: WorkflowStep['config'] }): string {
  if (step.type === 'artifact_generation' && step.config?.kind === 'slide') {
    return 'Presentation (retired)';
  }
  return TYPE_LABELS[step.type] ?? step.type;
}

export const PRED_OPS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'exists',
] as const;
export const PROJECT_TABLES = [
  'project_details',
  'project_connections',
  'connection_types',
  'fabrication_productivity',
  'material_inventory',
  'labor_rates',
];
export const REASON_TOOLS = [
  'case_search',
  'skill_search',
  'skill_execute',
  'decline_action',
  'skill_history',
  'project_data',
];

export const REASON_TOOL_LABELS: Record<string, string> = {
  case_search: 'Find past cases',
  skill_search: 'Find calculations',
  skill_execute: 'Run calculations',
  decline_action: 'Decline an action',
  skill_history: 'Find calculation runs',
  project_data: 'Read project data',
};

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
    steps: [
      {
        step_id: 'start',
        type: 'input_collection',
        name: 'Start',
        config: { fields: ['item'], prompt: '' },
        on_success: 'end',
      },
    ],
    limits: { max_rounds: 40, max_iterations: 100 },
    outputs: {},
    policy: {
      execution_approval: 'first_run',
      skill_approval: 'new_names',
      four_eyes: false,
    },
    ui: { positions: {} },
  };
}

export function insertWorkflowStep(
  steps: WorkflowStep[],
  step: WorkflowStep,
  afterId: string | null,
): WorkflowStep[] {
  const index = steps.findIndex((candidate) => candidate.step_id === afterId);
  if (index === -1) {
    return [...steps, step];
  }
  const predecessor = steps[index];
  return [
    ...steps.slice(0, index),
    { ...predecessor, on_success: step.step_id },
    { ...step, on_success: predecessor.on_success ?? 'end' },
    ...steps.slice(index + 1),
  ];
}

function containsRetiredGenerator(step: WorkflowStep | null | undefined): boolean {
  if (!step) return false;
  if (step.type === 'document_generation' || step.type === 'artifact_generation') return true;
  return step.type === 'iteration' && Array.isArray(step.config?.body) &&
    step.config.body.some(containsRetiredGenerator);
}

export function canDuplicateStep(step: WorkflowStep): boolean {
  return STEP_TYPES.some(({ value }) => value === step.type) && !containsRetiredGenerator(step);
}

export function duplicateWorkflowStep(
  def: WorkflowDefinition,
  stepId: string,
): { definition: WorkflowDefinition; stepId: string } | null {
  const steps = def.steps ?? [];
  const original = steps.find((step) => step.step_id === stepId);
  if (!original || !canDuplicateStep(original)) return null;
  const taken = new Set([
    ...steps.map((step) => step.step_id),
    ...(def.inputs ?? []).map((input) => input.name),
  ]);
  const base = `${stepId}_copy`;
  let id = base;
  for (let suffix = 2; taken.has(id); suffix++) id = `${base}_${suffix}`;

  const copy: WorkflowStep = {
    ...structuredClone(original),
    step_id: id,
    name: `${original.name || original.step_id} copy`,
  };
  const { nodes } = definitionToFlow(def, null);
  const anchor = nodes.find((node) => node.id === stepId)?.position;
  const x = (anchor?.x ?? 0) + 320;
  let y = anchor?.y ?? 0;
  while (nodes.some((node) => node.type === 'step' &&
    Math.abs(node.position.x - x) < 260 && Math.abs(node.position.y - y) < 140)) {
    y += 176;
  }
  const updated = { ...def, steps: insertWorkflowStep(steps, copy, stepId) };
  return { definition: withPositions(updated, { [id]: { x, y } }), stepId: id };
}

export function defaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    case 'input_collection':
      return { fields: [], prompt: '' };
    case 'model_reasoning':
      return { goal: '', tools_allowed: ['project_data'], max_rounds: 3 };
    case 'database_retrieval':
      return { table: PROJECT_TABLES[0], limit: 100 };
    case 'skill_retrieval':
      return { query_template: '', top_k: 3 };
    case 'lang_verification':
      return { candidate: { from: '' }, output_index: 0, tests: [] };
    case 'lang_execution':
      return {
        program: '',
        problem: '',
        resources: {
          inputs: [],
          replacements: [],
          expectations: [],
          tests: [],
        },
        bindings: {},
      };
    case 'lang_recall':
      return { query_template: '' };
    case 'skill_verification':
      return { skill: { from: '' }, cases: [] };
    case 'skill_execution':
      return {
        calculation_nl: '',
        deferred: true,
        inputs_mapping: {},
        on_miss: 'propose',
      };
    case 'conditional_routing':
      return { rules: [] };
    case 'iteration':
      return { over: '', max_iterations: 10, body: [] };
    case 'human_approval':
      return { prompt: '' };
    case 'output_composition':
      return { mapping: {} };
    default:
      return {};
  }
}

// New-workflow default start: exactly the factory shape (single
// input_collection `start` named `Start`, prompt '', fields array, end
// routing). Used to gate the bounded settings mirror below; any canvas
// customization (second step, renamed start, custom prompt/routing, extra
// config keys) opts out and preserves explicit fields.
export function isDefaultStartDefinition(def: WorkflowDefinition): boolean {
  const steps = def.steps ?? [];
  if (steps.length !== 1) {
    return false;
  }
  const s = steps[0];
  if (s.step_id !== 'start' || s.type !== 'input_collection') {
    return false;
  }
  if ((s.name ?? '') !== 'Start') {
    return false;
  }
  if ((s.on_success ?? '') !== 'end') {
    return false;
  }
  if (s.on_failure !== undefined) {
    return false;
  }
  const c = (s.config ?? {}) as Record<string, unknown>;
  if (typeof c.prompt !== 'string' || c.prompt !== '') {
    return false;
  }
  if (
    !Array.isArray(c.fields) ||
    !c.fields.every((f) => typeof f === 'string')
  ) {
    return false;
  }
  if (!Object.keys(c).every((k) => k === 'fields' || k === 'prompt')) {
    return false;
  }
  return true;
}

// True when the default start fields mirror the declared inputs in order.
// Add/remove mirror only while this holds, so explicit custom fields on
// old workflows are never silently rewritten.
export function defaultStartMirrorsInputs(def: WorkflowDefinition): boolean {
  if (!isDefaultStartDefinition(def)) {
    return false;
  }
  const fields = ((def.steps?.[0]?.config ?? {}) as { fields?: unknown })
    .fields as string[];
  const names = (def.inputs ?? []).map((i) => i.name);
  if (fields.length !== names.length) {
    return false;
  }
  return fields.every((f, i) => f === names[i]);
}

function fixReference(ref: string, oldName: string, newName: string): string {
  return ref === oldName || ref.startsWith(`${oldName}.`) || ref.startsWith(`${oldName}[`)
    ? newName + ref.slice(oldName.length)
    : ref;
}

type RewriteReference = (ref: string) => string;

function rewriteCondition(cond: unknown, rewrite: RewriteReference): void {
  if (!cond || typeof cond !== 'object') return;
  const condition = cond as { all?: unknown; any?: unknown; ref?: unknown };
  const predicates = Array.isArray(condition.all)
    ? condition.all
    : Array.isArray(condition.any) ? condition.any : [condition];
  for (const predicate of predicates) {
    if (predicate && typeof predicate.ref === 'string') {
      predicate.ref = rewrite(predicate.ref);
    }
  }
}

function rewriteBindingSources(config: Record<string, unknown>, rewrite: RewriteReference): void {
  const update = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const binding = value as { from?: unknown };
    if (typeof binding.from === 'string') binding.from = rewrite(binding.from);
  };
  for (const key of ['project_id_from', 'skill', 'candidate']) update(config[key]);
  for (const key of ['inputs_mapping', 'mapping', 'mappings', 'bindings']) {
    const entries = config[key];
    if (entries && typeof entries === 'object') {
      for (const value of Object.values(entries)) update(value);
    }
  }
}

function rewriteInputRefsInSteps(
  steps: WorkflowStep[],
  oldName: string,
  newName: string,
  visibleSteps = new Map<string, boolean>(),
  inLoop = false,
): RewriteReference {
  // Visible step IDs take precedence over workflow input names. In a loop,
  // "item" is the current element, even when a workflow input has that name.
  const rewrite = (ref: string) => {
    const root = ref.split(/[.\[]/, 1)[0];
    if (inLoop && root === 'item') return ref;
    if (!visibleSteps.has(root)) return fixReference(ref, oldName, newName);
    return visibleSteps.get(root)
      ? fixReference(ref, `${root}.${oldName}`, `${root}.${newName}`)
      : ref;
  };

  for (const step of steps) {
    const config = (step.config ?? {}) as Record<string, unknown>;
    const collectsInput = step.type === 'input_collection' &&
      Array.isArray(config.fields) && config.fields.includes(oldName);
    if (collectsInput) {
      config.fields = (config.fields as unknown[]).map((field) =>
        field === oldName ? newName : field,
      );
    }
    if (step.type === 'conditional_routing' && Array.isArray(config.rules)) {
      for (const rule of config.rules as Array<{ when?: unknown }>) {
        rewriteCondition(rule?.when, rewrite);
      }
    }
    if (typeof config.over === 'string') config.over = rewrite(config.over);
    rewriteBindingSources(config, rewrite);
    if (step.type === 'iteration' && Array.isArray(config.body)) {
      rewriteInputRefsInSteps(config.body as WorkflowStep[], oldName, newName, new Map(visibleSteps), true);
    }
    visibleSteps.set(step.step_id, collectsInput);
    step.config = config;
  }
  return rewrite;
}

// Undeclared fields on the default start (stale after a pre-fix rename,
// or an empty intermediate). Custom valid subsets are NOT stale.
export function defaultStartHasUndeclared(def: WorkflowDefinition): boolean {
  if (!isDefaultStartDefinition(def)) {
    return false;
  }
  const names = new Set((def.inputs ?? []).map((i) => i.name));
  const fields = ((def.steps?.[0]?.config ?? {}) as { fields?: unknown })
    .fields;
  if (!Array.isArray(fields)) {
    return false;
  }
  return (fields as unknown[]).some(
    (f) => typeof f === 'string' && !names.has(f),
  );
}

export function defaultStartStaleFields(def: WorkflowDefinition): string[] {
  if (!isDefaultStartDefinition(def)) {
    return [];
  }
  const names = new Set((def.inputs ?? []).map((i) => i.name));
  const fields = ((def.steps?.[0]?.config ?? {}) as { fields?: unknown })
    .fields;
  if (!Array.isArray(fields)) {
    return [];
  }
  return (fields as unknown[]).filter(
    (f): f is string => typeof f === 'string' && !names.has(f),
  );
}

function remirrorDefaultStart(out: WorkflowDefinition): void {
  const start = out.steps?.[0];
  if (!start || !isDefaultStartDefinition(out)) {
    return;
  }
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
export function renameWorkflowInput(
  def: WorkflowDefinition,
  index: number,
  newName: string,
): WorkflowDefinition | null {
  const inputs = def.inputs ?? [];
  if (index < 0 || index >= inputs.length) {
    return null;
  }
  const staleBefore = defaultStartHasUndeclared(def);
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  const target = out.inputs?.[index];
  if (!target) {
    return null;
  }
  const oldName = target.name;
  target.name = newName;
  const ambiguous = inputs.some((input, position) =>
    position !== index && (input.name === oldName || input.name === newName),
  );
  if (!oldName || !newName || oldName === newName || ambiguous) {
    return out;
  }
  const rewrite = rewriteInputRefsInSteps(out.steps ?? [], oldName, newName);
  for (const k of Object.keys(out.outputs ?? {})) {
    const o = (out.outputs as Record<string, { from?: string }>)[k];
    if (o && typeof o.from === 'string') {
      o.from = rewrite(o.from);
    }
  }
  const pres = (out.ui as Record<string, unknown> | undefined)
    ?.input_presentation as
    | { fields?: Record<string, { visibleWhen?: { field?: string } }> }
    | undefined;
  if (pres?.fields && typeof pres.fields === 'object') {
    if (
      pres.fields[oldName] !== undefined &&
      pres.fields[newName] === undefined
    ) {
      pres.fields[newName] = pres.fields[oldName];
      delete pres.fields[oldName];
    } else if (
      pres.fields[oldName] !== undefined &&
      pres.fields[newName] !== undefined
    ) {
      delete pres.fields[oldName];
    }
    for (const meta of Object.values(pres.fields)) {
      if (meta?.visibleWhen?.field === oldName) {
        meta.visibleWhen.field = newName;
      }
    }
  }
  if (staleBefore && isDefaultStartDefinition(out)) {
    remirrorDefaultStart(out);
  }
  return out;
}

export function addWorkflowInput(def: WorkflowDefinition): WorkflowDefinition {
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  out.inputs = out.inputs ?? [];
  const mirrorBefore = defaultStartMirrorsInputs(def);
  const staleBefore = defaultStartHasUndeclared(def);
  const taken = new Set([
    ...out.inputs.map((input) => input.name),
    ...(out.steps ?? []).map((step) => step.step_id),
  ]);
  let next = out.inputs.length + 1;
  while (taken.has(`input${next}`)) next++;
  out.inputs.push({
    name: `input${next}`,
    type: 'string',
    required: false,
  });
  if (isDefaultStartDefinition(out) && (mirrorBefore || staleBefore)) {
    remirrorDefaultStart(out);
  }
  return out;
}

export function moveWorkflowInput(
  def: WorkflowDefinition,
  index: number,
  direction: -1 | 1,
): WorkflowDefinition | null {
  const out = structuredClone(def);
  const inputs = out.inputs;
  const next = index + direction;
  if (!inputs?.[index] || !inputs[next]) return null;
  [inputs[index], inputs[next]] = [inputs[next], inputs[index]];
  if (defaultStartMirrorsInputs(def)) remirrorDefaultStart(out);
  return out;
}

export function removeWorkflowInput(
  def: WorkflowDefinition,
  index: number,
): WorkflowDefinition | null {
  const inputs = def.inputs ?? [];
  if (index < 0 || index >= inputs.length) {
    return null;
  }
  const mirrorBefore = defaultStartMirrorsInputs(def);
  const staleBefore = defaultStartHasUndeclared(def);
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  out.inputs?.splice(index, 1);
  if (isDefaultStartDefinition(out) && (mirrorBefore || staleBefore)) {
    remirrorDefaultStart(out);
  }
  return out;
}

// Explicit user-approved repair for a stale default start (Sync button).
// Returns null unless the default start has undeclared fields.
export function syncDefaultStartFields(
  def: WorkflowDefinition,
): WorkflowDefinition | null {
  if (!defaultStartHasUndeclared(def)) {
    return null;
  }
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  remirrorDefaultStart(out);
  return out;
}

function autoPosition(index: number): { x: number; y: number } {
  return { x: 40 + (index % 4) * 250, y: 60 + Math.floor(index / 4) * 130 };
}

function targetNodeId(target: string | undefined, known: Set<string>): string | undefined {
  if (target === 'end' || !target) {
    return END_NODE_ID;
  }
  return known.has(target) ? target : undefined;
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
      s.type === 'conditional_routing' &&
      Array.isArray((s.config as Record<string, unknown> | undefined)?.rules)
        ? (
            (s.config as Record<string, unknown>).rules as Array<{
              goto?: string;
            }>
          ).map((r) => r?.goto ?? '')
        : [],
    ]),
  );
}

export function definitionToFlow(
  def: WorkflowDefinition,
  selectedStepId: string | null,
): { nodes: Node[]; edges: Edge[] } {
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
      typeLabel: stepTypeLabel(s),
      stepType: s.type,
      ruleCount:
        s.type === 'conditional_routing' &&
        Array.isArray((s.config as Record<string, unknown> | undefined)?.rules)
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
    selected: selectedStepId === END_NODE_ID,
    deletable: false,
  });

  const edges: Edge[] = [];
  for (const s of steps) {
    const success = targetNodeId(s.on_success, known);
    const failure = s.on_failure ? targetNodeId(s.on_failure, known) : undefined;
    const configuredRules = s.config?.rules;
    const rules = s.type === 'conditional_routing' && Array.isArray(configuredRules)
      ? configuredRules as Array<{ goto?: string }> : [];
    const rulesSharingFallback = rules.flatMap((rule, index) =>
      success && typeof rule?.goto === 'string' && rule.goto !== '' && targetNodeId(rule.goto, known) === success
        ? [index + 1] : []);
    const fallbackLabel = rulesSharingFallback.length
      ? `${rulesSharingFallback.length === 1 ? 'Rule' : 'Rules'} ${rulesSharingFallback.join(', ')} or if no rule matches`
      : 'If no rule matches';
    if (success) edges.push({
      id: `ok:${s.step_id}`,
      source: s.step_id,
      target: success,
      className: EDGE_CLASS.success,
      label: s.type === 'conditional_routing' ? fallbackLabel : undefined,
      ariaLabel: s.type === 'conditional_routing'
        ? `${fallbackLabel}. Edge from ${s.step_id} to ${success === END_NODE_ID ? 'Finish' : success}`
        : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#4d5a6e' },
      deletable: false,
    });
    if (failure) {
      edges.push({
        id: `fail:${s.step_id}`,
        source: s.step_id,
        target: failure,
        sourceHandle: 'fail',
        className: EDGE_CLASS.failure,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#b3261e' },
        label: 'on failure',
        ariaLabel: `On failure. Edge from ${s.step_id} to ${failure === END_NODE_ID ? 'Finish' : failure}`,
      });
    }
    rules.forEach((r, i) => {
      if (typeof r?.goto !== 'string' || r.goto === '') return;
      const target = targetNodeId(r.goto, known);
      if (!target || target === success) return;
      edges.push({
        id: `cond:${s.step_id}:${i}`,
        source: s.step_id,
        target,
        sourceHandle: `cond-${i}`,
        className: EDGE_CLASS.conditional,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#8a5a00' },
        label: `rule ${i + 1}`,
        ariaLabel: `Rule ${i + 1}. Edge from ${s.step_id} to ${target === END_NODE_ID ? 'Finish' : target}`,
      });
    });
  }
  return { nodes, edges };
}

export function arrangeSteps(def: WorkflowDefinition): WorkflowDefinition {
  const steps = def.steps ?? [];
  const first = steps[0];
  if (!first) return def;

  const targets = new Map<string, string[]>(steps.map((step) => [step.step_id, []]));
  for (const edge of definitionToFlow(def, null).edges) {
    if (edge.target !== END_NODE_ID) targets.get(edge.source)?.push(edge.target);
  }

  const columns = new Map([[first.step_id, 0]]);
  const queue = [first.step_id];
  const rows = new Map<number, number>();
  const positions: Record<string, { x: number; y: number }> = {};
  function place(id: string, column: number) {
    const row = rows.get(column) ?? 0;
    positions[id] = { x: 60 + column * 320, y: 60 + row * 176 };
    rows.set(column, row + 1);
  }

  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    const column = columns.get(id) ?? 0;
    place(id, column);
    for (const target of targets.get(id) ?? []) {
      if (columns.has(target)) continue;
      columns.set(target, column + 1);
      queue.push(target);
    }
  }

  // Keep disconnected drafts editable and below the connected flow.
  const disconnectedRow = Math.max(...rows.values(), 0);
  const disconnectedColumns = Math.min(4, rows.size);
  let column = 0;
  for (const step of steps) {
    if (columns.has(step.step_id)) continue;
    if ((rows.get(column) ?? 0) < disconnectedRow) rows.set(column, disconnectedRow);
    place(step.step_id, column);
    column = (column + 1) % disconnectedColumns;
  }
  return withPositions(def, positions);
}

export function withPositions(
  def: WorkflowDefinition,
  positions: Record<string, { x: number; y: number }>,
): WorkflowDefinition {
  const merged = { ...(def.ui?.positions ?? {}) };
  for (const [k, v] of Object.entries(positions)) {
    if (k === END_NODE_ID) {
      continue;
    }
    merged[k] = {
      x: Math.max(0, Math.round(v.x)),
      y: Math.max(0, Math.round(v.y)),
    };
  }
  return { ...def, ui: { ...(def.ui ?? {}), positions: merged } };
}

// A save or canvas move does not change what validation checks.
export function workflowCheckKey(def: WorkflowDefinition): string {
  const { ui, version, status, ...definition } = def;
  return JSON.stringify(definition);
}

// Persistable payload: definition plus the session viewport. Viewport edits
// never mark the draft dirty by themselves; they ride along on save.
export function savePayload(
  def: WorkflowDefinition,
  viewport: { x: number; y: number; zoom: number } | null,
): WorkflowDefinition {
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  out.ui = out.ui ?? {};
  if (viewport) {
    out.ui.view = {
      x: Math.round(viewport.x),
      y: Math.round(viewport.y),
      w: 0,
      h: 0,
      zoom: viewport.zoom,
    };
  }
  return out;
}

// Rename a step and rewrite every reference to it (edges, predicates,
// mappings, outputs). Returns null when the new id is unusable.
export function renameStep(
  def: WorkflowDefinition,
  oldId: string,
  newId: string,
): WorkflowDefinition | null {
  const id = newId.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id) || id === oldId || ['end', 'item', 'inputs', END_NODE_ID].includes(id)) {
    return null;
  }
  if ((def.steps ?? []).some((s) => s.step_id === id)) {
    return null;
  }
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  const renamed = out.steps?.find((s) => s.step_id === oldId);
  if (!renamed) {
    return null;
  }
  renamed.step_id = id;
  const fixList = (list: WorkflowStep[]): void => {
    for (const s of list) {
      if (s.on_success === oldId) {
        s.on_success = id;
      }
      if (s.on_failure === oldId) {
        s.on_failure = id;
      }
      const c = (s.config ?? {}) as Record<string, unknown>;
      if (s.type === 'conditional_routing' && Array.isArray(c.rules)) {
        for (const r of c.rules as Array<{ goto?: string; when?: unknown }>) {
          if (r.goto === oldId) {
            r.goto = id;
          }
          const w = r.when as
            | { all?: unknown[]; any?: unknown[]; ref?: string }
            | null
            | undefined;
          if (w && typeof w === 'object') {
            const preds = (
              Array.isArray(w.all) ? w.all : Array.isArray(w.any) ? w.any : [w]
            ) as Array<{ ref?: unknown }>;
            for (const p of preds) {
              if (p && typeof p.ref === 'string') {
                p.ref = fixReference(p.ref, oldId, id);
              }
            }
          }
        }
      }
      if (typeof c.over === 'string') {
        c.over = fixReference(c.over, oldId, id);
      }
      rewriteBindingSources(c, (ref) => fixReference(ref, oldId, id));
      if (s.type === 'iteration' && Array.isArray(c.body)) {
        fixList(c.body as WorkflowStep[]);
      }
      s.config = c;
    }
  };
  fixList(out.steps ?? []);
  for (const k of Object.keys(out.outputs ?? {})) {
    const o = (out.outputs as Record<string, { from?: string }>)[k];
    if (o && typeof o.from === 'string') {
      o.from = fixReference(o.from, oldId, id);
    }
  }
  if (out.ui?.positions?.[oldId]) {
    out.ui.positions[id] = out.ui.positions[oldId];
    delete out.ui.positions[oldId];
  }
  return out;
}

// Remove routes to a deleted step within the same graph or loop.
export function deleteStep(
  def: WorkflowDefinition,
  stepId: string,
  loopId?: string,
): WorkflowDefinition | null {
  const out = structuredClone(def);
  const loop = loopId ? out.steps?.find((step) => step.step_id === loopId && step.type === 'iteration') : undefined;
  const body = loop?.config?.body as WorkflowStep[] | undefined;
  const steps = loopId ? body : out.steps;
  if (!Array.isArray(steps) || !steps.some((step) => step.step_id === stepId)) return null;
  if (!loopId && steps.length <= 1) return null;

  const remaining = steps.filter((step) => step.step_id !== stepId);
  for (const s of remaining) {
    if (s.on_success === stepId) {
      s.on_success = 'end';
    }
    if (s.on_failure === stepId) {
      delete s.on_failure;
    }
    const c = (s.config ?? {}) as Record<string, unknown>;
    if (s.type === 'conditional_routing' && Array.isArray(c.rules)) {
      for (const r of c.rules as Array<{ goto?: string }>) {
        if (r.goto === stepId) {
          r.goto = 'end';
        }
      }
    }
  }
  if (loop?.config) {
    loop.config.body = remaining;
  } else {
    out.steps = remaining;
    if (out.ui?.positions) delete out.ui.positions[stepId];
  }
  return out;
}
