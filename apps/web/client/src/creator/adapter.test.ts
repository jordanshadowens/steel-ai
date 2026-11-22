import { describe, expect, it } from 'vitest';
import {
  END_NODE_ID,
  addWorkflowInput,
  blankDefinition,
  defaultConfig,
  defaultStartHasUndeclared,
  defaultStartMirrorsInputs,
  defaultStartStaleFields,
  definitionToFlow,
  insertWorkflowStep,
  duplicateWorkflowStep,
  arrangeSteps,
  workflowCheckKey,
  STEP_TYPES,
  deleteStep,
  isDefaultStartDefinition,
  moveWorkflowInput,
  removeWorkflowInput,
  renameStep,
  renameWorkflowInput,
  structureKey,
  syncDefaultStartFields,
  withPositions,
} from './adapter';

describe('definitionToFlow', () => {
  it('starts new workflows with an Untitled name and a separate empty id', () => {
    expect(blankDefinition().name).toBe('Untitled');
    expect(blankDefinition().workflow_id).toBe('');
  });
  it('maps steps to nodes and success edges to end', () => {
    const { nodes, edges } = definitionToFlow(blankDefinition(), null);
    expect(nodes.map((n) => n.id)).toEqual(['start', END_NODE_ID]);
    expect(edges.map((e) => e.id)).toEqual(['ok:start']);
    expect(edges[0].target).toBe(END_NODE_ID);
  });

  it('emits failure and conditional edges with non-color identity', () => {
    const def = blankDefinition();
    def.steps = [
      {
        step_id: 'a',
        type: 'conditional_routing',
        name: 'A',
        config: {
          rules: [{ when: { ref: 'x', op: 'eq', value: 1 }, goto: 'b' }],
        },
        on_success: 'end',
        on_failure: 'b',
      },
      {
        step_id: 'b',
        type: 'input_collection',
        name: 'B',
        config: {},
        on_success: 'end',
      },
    ];
    const { edges } = definitionToFlow(def, 'a');
    const kinds = Object.fromEntries(edges.map((e) => [e.id, e.className]));
    expect(kinds).toEqual({
      'ok:a': 'edge-success',
      'fail:a': 'edge-failure',
      'cond:a:0': 'edge-conditional',
      'ok:b': 'edge-success',
    });
    expect(edges.find((e) => e.id === 'fail:a')?.label).toBe('on failure');
    expect(edges.find((e) => e.id === 'cond:a:0')?.label).toBe('rule 1');
  });

  it('omits the edge for a dangling destination', () => {
    const def = blankDefinition();
    def.steps = [
      {
        step_id: 'a',
        type: 'input_collection',
        name: 'A',
        config: {},
        on_success: 'ghost',
      },
    ];
    const { edges } = definitionToFlow(def, null);
    expect(edges).toHaveLength(0);
  });
});

describe('structureKey', () => {
  it('ignores position-only edits', () => {
    const def = blankDefinition();
    const moved = withPositions(def, { start: { x: 500, y: 500 } });
    expect(structureKey(moved)).toBe(structureKey(def));
    expect(moved.ui?.positions?.start).toEqual({ x: 500, y: 500 });
  });

  it('changes on routing edits', () => {
    const def = blankDefinition();
    const edited = JSON.parse(JSON.stringify(def)) as typeof def;
    edited.steps = edited.steps ?? [];
    if (edited.steps[0]) {
      edited.steps[0].on_failure = 'start';
    }
    expect(structureKey(edited)).not.toBe(structureKey(def));
  });
});

describe('renameStep', () => {
  it('rewrites edges, predicates, mappings and positions', () => {
    const def = blankDefinition();
    def.steps = [
      {
        step_id: 'calc',
        type: 'skill_execution',
        name: 'C',
        config: { inputs_mapping: { w: { from: 'scope.qty' } } },
        on_success: 'end',
      },
      {
        step_id: 'branch',
        type: 'conditional_routing',
        name: 'B',
        config: {
          rules: [
            { when: { ref: 'calc.value', op: 'gt', value: 0 }, goto: 'calc' },
          ],
        },
        on_success: 'calc',
      },
    ];
    def.outputs = { total: { from: 'calc.value' } };
    def.ui = { positions: { calc: { x: 1, y: 2 } } };
    const out = renameStep(def, 'calc', 'estimate');
    expect(out).not.toBeNull();
    expect(out?.steps?.map((s) => s.step_id)).toEqual(['estimate', 'branch']);
    expect(def.steps[0].step_id).toBe('calc');
    const flow = definitionToFlow(out!, 'estimate');
    expect(flow.nodes.find((n) => n.id === 'estimate')?.selected).toBe(true);
    const branch = out?.steps?.find((s) => s.step_id === 'branch');
    expect(branch?.on_success).toBe('estimate');
    const rule = (
      branch?.config as {
        rules: Array<{ goto: string; when: { ref: string } }>;
      }
    ).rules[0];
    expect(rule.goto).toBe('estimate');
    expect(rule.when.ref).toBe('estimate.value');
    expect((out?.outputs as Record<string, { from: string }>).total.from).toBe(
      'estimate.value',
    );
    expect(out?.ui?.positions?.estimate).toEqual({ x: 1, y: 2 });
  });

  it('rejects blanks, collisions and end', () => {
    const def = blankDefinition();
    expect(renameStep(def, 'start', '')).toBeNull();
    expect(renameStep(def, 'start', 'end')).toBeNull();
    expect(renameStep(def, 'start', 'start')).toBeNull();
  });
});

describe('deleteStep', () => {
  it('refuses the last step and collapses dangling edges', () => {
    expect(deleteStep(blankDefinition(), 'start')).toBeNull();
    const def = blankDefinition();
    def.steps = [
      {
        step_id: 'a',
        type: 'input_collection',
        name: 'A',
        config: {},
        on_success: 'b',
      },
      {
        step_id: 'b',
        type: 'input_collection',
        name: 'B',
        config: {},
        on_success: 'end',
      },
    ];
    const out = deleteStep(def, 'b');
    expect(out?.steps?.map((s) => s.step_id)).toEqual(['a']);
    expect(out?.steps?.[0].on_success).toBe('end');
  });

  it('updates success, failure, and branch routes within the edited loop', () => {
    const def = blankDefinition();
    def.steps = [{
      step_id: 'loop',
      type: 'iteration',
      config: { body: [
        { step_id: 'branch', type: 'conditional_routing', on_success: 'old', on_failure: 'old',
          config: { rules: [{ goto: 'old' }, { goto: 'end' }] } },
        { step_id: 'old', type: 'document_generation' },
      ] },
    }, {
      step_id: 'old',
      type: 'output_composition',
    }];
    const next = deleteStep(def, 'old', 'loop');
    expect(next?.steps?.map((step) => step.step_id)).toEqual(['loop', 'old']);
    expect(next?.steps?.[0].config?.body).toEqual([
      { step_id: 'branch', type: 'conditional_routing', on_success: 'end',
        config: { rules: [{ goto: 'end' }, { goto: 'end' }] } },
    ]);
    expect(def.steps[0].config?.body).toHaveLength(2);
  });
});

describe('defaultConfig', () => {
  it('covers all ten step types', () => {
    for (const t of [
      'input_collection',
      'model_reasoning',
      'database_retrieval',
      'skill_retrieval',
      'skill_execution',
      'conditional_routing',
      'iteration',
      'human_approval',
      'output_composition',
    ]) {
      expect(typeof defaultConfig(t)).toBe('object');
    }
  });
});

describe('workflow input references (batch10 bounded behavior)', () => {
  it('detects the factory default start and its mirror', () => {
    const fresh = blankDefinition();
    expect(isDefaultStartDefinition(fresh)).toBe(true);
    expect(defaultStartMirrorsInputs(fresh)).toBe(true);
    const customized = JSON.parse(JSON.stringify(fresh)) as typeof fresh;
    customized.steps![0].name = 'Custom';
    expect(isDefaultStartDefinition(customized)).toBe(false);
    expect(defaultStartMirrorsInputs(customized)).toBe(false);
    const twoStep = JSON.parse(JSON.stringify(fresh)) as typeof fresh;
    twoStep.steps!.push({
      step_id: 'extra',
      type: 'input_collection',
      name: 'Extra',
      config: { fields: [], prompt: '' },
      on_success: 'end',
    });
    expect(isDefaultStartDefinition(twoStep)).toBe(false);
  });

  it('renames the declared input and every reference root, preserving suffixes and values', () => {
    const def = blankDefinition();
    def.inputs = [{ name: 'item', type: 'string', required: true }];
    def.steps = [
      {
        step_id: 'start',
        type: 'input_collection',
        name: 'Start',
        config: { fields: ['item', 'other'], prompt: '' },
        on_success: 'calc',
      },
      {
        step_id: 'calc',
        type: 'skill_execution',
        name: 'Calc',
        config: {
          skill: { name: 's', version: 1 },
          inputs_mapping: { q: { from: 'item' }, r: { from: 'item.qty' } },
        },
        on_success: 'branch',
      },
      {
        step_id: 'branch',
        type: 'conditional_routing',
        name: 'Branch',
        config: {
          rules: [
            { when: { ref: 'item.total', op: 'gt', value: 0 }, goto: 'end' },
          ],
        },
        on_success: 'end',
      },
    ];
    def.outputs = { echo: { from: 'item' } };
    def.ui = {
      positions: {},
      input_presentation: { version: 1, fields: { item: { label: 'Item' } } },
    } as typeof def.ui;
    const out = renameWorkflowInput(def, 0, 'food_total');
    expect(out?.inputs?.[0]).toEqual({
      name: 'food_total',
      type: 'string',
      required: true,
    });
    expect((out?.steps?.[0]?.config as { fields: string[] }).fields).toEqual([
      'food_total',
      'other',
    ]);
    expect(
      (
        out?.steps?.[1]?.config as {
          inputs_mapping: Record<string, { from: string }>;
        }
      ).inputs_mapping,
    ).toEqual({
      q: { from: 'food_total' },
      r: { from: 'food_total.qty' },
    });
    expect(
      (out?.steps?.[2]?.config as { rules: Array<{ when: { ref: string } }> })
        .rules[0].when.ref,
    ).toBe('food_total.total');
    expect((out?.outputs as Record<string, { from: string }>).echo.from).toBe(
      'food_total',
    );
    expect(
      (
        out?.ui as unknown as {
          input_presentation: { fields: Record<string, unknown> };
        }
      ).input_presentation.fields.food_total,
    ).toEqual({ label: 'Item' });
    expect(
      (
        out?.ui as unknown as {
          input_presentation: { fields: Record<string, unknown> };
        }
      ).input_presentation.fields.item,
    ).toBeUndefined();
    expect(def.inputs?.[0].name).toBe('item');
  });

  it('does not rewrite refs on empty or unchanged renames, but still sets the declared value', () => {
    const def = blankDefinition();
    const emptied = renameWorkflowInput(def, 0, '');
    expect(emptied?.inputs?.[0].name).toBe('');
    expect(
      (emptied?.steps?.[0]?.config as { fields: string[] }).fields,
    ).toEqual(['item']);
    const same = renameWorkflowInput(def, 0, 'item');
    expect(same?.inputs?.[0].name).toBe('item');
    expect((same?.steps?.[0]?.config as { fields: string[] }).fields).toEqual([
      'item',
    ]);
    expect(renameWorkflowInput(def, 9, 'x')).toBeNull();
  });

  it('mirrors add/remove on the default start only while fields mirror inputs', () => {
    let def = blankDefinition();
    def = renameWorkflowInput(def, 0, 'food_total')!;
    def = addWorkflowInput(def);
    expect(def.inputs?.map((i) => i.name)).toEqual(['food_total', 'input2']);
    expect((def.steps?.[0]?.config as { fields: string[] }).fields).toEqual([
      'food_total',
      'input2',
    ]);
    def = renameWorkflowInput(def, 1, 'supplies_total')!;
    expect((def.steps?.[0]?.config as { fields: string[] }).fields).toEqual([
      'food_total',
      'supplies_total',
    ]);
    const removed = removeWorkflowInput(def, 0)!;
    expect(removed.inputs?.map((i) => i.name)).toEqual(['supplies_total']);
    expect((removed.steps?.[0]?.config as { fields: string[] }).fields).toEqual(
      ['supplies_total'],
    );
  });

  it('never touches custom fields or old multi-step workflows on add/remove', () => {
    const custom = blankDefinition();
    custom.inputs = [
      { name: 'a', type: 'string' },
      { name: 'b', type: 'string' },
    ];
    custom.steps = [
      {
        step_id: 'start',
        type: 'input_collection',
        name: 'Start',
        config: { fields: ['a'], prompt: '' },
        on_success: 'end',
      },
    ];
    expect(defaultStartMirrorsInputs(custom)).toBe(false);
    expect(defaultStartHasUndeclared(custom)).toBe(false);
    const added = addWorkflowInput(custom);
    expect((added.steps?.[0]?.config as { fields: string[] }).fields).toEqual([
      'a',
    ]);
    const removed = removeWorkflowInput(custom, 1)!;
    expect((removed.steps?.[0]?.config as { fields: string[] }).fields).toEqual(
      ['a'],
    );
    const old = blankDefinition();
    old.inputs = [{ name: 'a', type: 'string' }];
    old.steps = [
      {
        step_id: 'start',
        type: 'input_collection',
        name: 'Start',
        config: { fields: ['a'], prompt: '' },
        on_success: 'next',
      },
      {
        step_id: 'next',
        type: 'input_collection',
        name: 'Next',
        config: { fields: [], prompt: '' },
        on_success: 'end',
      },
    ];
    expect(isDefaultStartDefinition(old)).toBe(false);
    expect(
      (addWorkflowInput(old).steps?.[0]?.config as { fields: string[] }).fields,
    ).toEqual(['a']);
  });

  it('repairs a stale default on the next explicit edit, and via explicit sync', () => {
    const stale = blankDefinition();
    stale.inputs = [
      { name: 'food_total', type: 'number', required: true },
      { name: 'supplies_total', type: 'number', required: true },
    ];
    stale.steps = [
      {
        step_id: 'start',
        type: 'input_collection',
        name: 'Start',
        config: { fields: ['item'], prompt: '' },
        on_success: 'end',
      },
    ];
    expect(defaultStartHasUndeclared(stale)).toBe(true);
    expect(defaultStartStaleFields(stale)).toEqual(['item']);
    expect(syncDefaultStartFields(stale)).not.toBeNull();
    expect(
      (
        (syncDefaultStartFields(stale)!.steps?.[0]?.config ?? {}) as {
          fields: string[];
        }
      ).fields,
    ).toEqual(['food_total', 'supplies_total']);
    const custom = blankDefinition();
    custom.inputs = [
      { name: 'a', type: 'string' },
      { name: 'b', type: 'string' },
    ];
    custom.steps = [
      {
        step_id: 'start',
        type: 'input_collection',
        name: 'Start',
        config: { fields: ['a'], prompt: '' },
        on_success: 'end',
      },
    ];
    expect(syncDefaultStartFields(custom)).toBeNull();
    const fixed = renameWorkflowInput(stale, 0, 'food')!;
    expect((fixed.steps?.[0]?.config as { fields: string[] }).fields).toEqual([
      'food',
      'supplies_total',
    ]);
  });
});

it('inserts a step on the selected success path and preserves its failure route', () => {
  const start = { ...blankDefinition().steps![0], on_success: 'done', on_failure: 'recover' };
  const finish = { ...start, step_id: 'done', on_success: 'end' };
  const inserted = { ...finish, step_id: 'inserted' };
  const steps = insertWorkflowStep([start, finish], inserted, 'start');
  expect(steps.map((step) => [step.step_id, step.on_success])).toEqual([
    ['start', 'inserted'],
    ['inserted', 'done'],
    ['done', 'end'],
  ]);
  expect(steps[0].on_failure).toBe('recover');
  expect(start.on_success).toBe('done');
});

it('excludes retired generators from the step palette', () => {
  const types = STEP_TYPES.map((step) => step.value);
  expect(types).not.toContain('document_generation');
  expect(types).not.toContain('artifact_generation');
});

it('keeps checks across saves and layout edits and invalidates them when routing changes', () => {
  const draft = blankDefinition();
  const saved = { ...draft, version: 2, status: 'published', ui: { positions: { start: { x: 20, y: 40 } } } };
  expect(workflowCheckKey(saved)).toBe(workflowCheckKey(draft));
  const steps = draft.steps?.map((step) => ({ ...step, on_failure: 'recovery' }));
  expect(workflowCheckKey({ ...draft, steps })).not.toBe(workflowCheckKey(draft));
});

it('arranges branches and disconnected steps without changing routes', () => {
  const root = { ...blankDefinition().steps![0], on_success: 'success', on_failure: 'failure' };
  const success = { ...root, step_id: 'success', on_success: 'end', on_failure: undefined };
  const failure = { ...root, step_id: 'failure', on_success: root.step_id, on_failure: undefined };
  const separate = { ...success, step_id: 'separate' };
  const draft = { ...blankDefinition(), steps: [root, success, failure, separate] };
  const arranged = arrangeSteps(draft);
  const positions = arranged.ui!.positions!;
  expect(arranged.steps).toBe(draft.steps);
  expect(positions.success.x).toBeGreaterThan(positions.start.x);
  expect(positions.failure.x).toBe(positions.success.x);
  expect(positions.failure.y).toBeGreaterThan(positions.success.y);
  expect(positions.separate.y).toBeGreaterThan(positions.failure.y);
  expect(arrangeSteps(arranged)).toEqual(arranged);
});

it('updates program bindings and verification sources when a workflow input or source step changes', () => {
  const draft = blankDefinition();
  draft.steps = [
    { ...draft.steps![0], on_success: 'run' },
    {
      step_id: 'run', name: 'Run', type: 'lang_execution', on_success: 'verify',
      config: { program: 'item', bindings: { inputs: { from: 'item.value' } } },
    },
    {
      step_id: 'verify', name: 'Verify', type: 'lang_verification', on_success: 'end',
      config: { candidate: { from: 'run.run_id' } },
    },
  ];
  const renamedInput = renameWorkflowInput(draft, 0, 'source')!;
  expect(renamedInput.steps?.[1]?.config).toEqual({
    program: 'item',
    bindings: { inputs: { from: 'source.value' } },
  });
  const renamedStep = renameStep(renamedInput, 'run', 'execute')!;
  expect(renamedStep.steps?.[2]?.config).toEqual({ candidate: { from: 'execute.run_id' } });
  expect(renameStep(draft, 'run', 'invalid id')).toBeNull();
  expect(renameStep(draft, 'run', 'item')).toBeNull();
});

it('renames collected fields in step results without changing the current loop item', () => {
  const draft = blankDefinition();
  draft.steps = [
    { ...draft.steps![0], on_success: 'loop' },
    {
      step_id: 'loop', type: 'iteration', name: 'Loop', on_success: 'end',
      config: {
        over: 'start.item.values',
        body: [{
          step_id: 'result', type: 'output_composition', name: 'Set result',
          config: { mapping: { current: { from: 'item.name' }, source: { from: 'start.item.name' } } },
          on_success: 'end',
        }],
      },
    },
  ];
  draft.outputs = { all: { from: 'start.item' }, distinct: { from: 'start.items' } };

  const changed = renameWorkflowInput(draft, 0, 'source')!;
  expect(changed.outputs).toEqual({ all: { from: 'start.source' }, distinct: { from: 'start.items' } });
  expect(changed.steps?.[1]?.config).toMatchObject({
    over: 'start.source.values',
    body: [{ config: { mapping: { current: { from: 'item.name' }, source: { from: 'start.source.name' } } } }],
  });
});

it('does not duplicate a loop that contains a retired generator', () => {
  const draft = blankDefinition();
  draft.steps = [{
    step_id: 'loop',
    type: 'iteration',
    config: { body: [{ step_id: 'legacy', type: 'document_generation' }] },
  }];
  expect(duplicateWorkflowStep(draft, 'loop')).toBeNull();
});

it('duplicates a step as a single successor without sharing config', () => {
  const draft = blankDefinition();
  draft.inputs?.push({ name: 'start_copy', type: 'string' });
  const original = draft.steps![0];
  original.on_failure = 'end';
  const result = duplicateWorkflowStep(draft, 'start')!;
  expect(result.stepId).toBe('start_copy_2');
  const [start, copy] = result.definition.steps!;
  expect(start.on_success).toBe(result.stepId);
  expect(copy.on_success).toBe('end');
  expect(copy.on_failure).toBe('end');
  expect(copy.config).toEqual(original.config);
  expect(copy.config).not.toBe(original.config);
  expect(original.on_success).toBe('end');
});


it('reorders workflow inputs without changing a custom Start step', () => {
  const def = blankDefinition();
  def.inputs = [{ name: 'item', type: 'string' }, { name: 'quantity', type: 'number', required: true }];
  def.steps![0].config = { fields: ['item', 'quantity'], prompt: 'Enter the order details.' };

  const moved = moveWorkflowInput(def, 1, -1);

  expect(moved?.inputs?.map(({ name }) => name)).toEqual(['quantity', 'item']);
  expect(moved?.inputs?.[0]).toMatchObject({ type: 'number', required: true });
  expect(moved?.steps?.[0].config).toEqual(def.steps![0].config);
  expect(def.inputs.map(({ name }) => name)).toEqual(['item', 'quantity']);
  expect(moveWorkflowInput(def, 0, -1)).toBeNull();
});
