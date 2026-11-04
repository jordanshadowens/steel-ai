import { describe, expect, it } from 'vitest';
import {
  END_NODE_ID,
  blankDefinition,
  defaultConfig,
  definitionToFlow,
  deleteStep,
  renameStep,
  structureKey,
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
      { step_id: 'a', type: 'conditional_routing', name: 'A', config: { rules: [{ when: { ref: 'x', op: 'eq', value: 1 }, goto: 'b' }] }, on_success: 'end', on_failure: 'b' },
      { step_id: 'b', type: 'input_collection', name: 'B', config: {}, on_success: 'end' },
    ];
    const { edges } = definitionToFlow(def, 'a');
    const kinds = Object.fromEntries(edges.map((e) => [e.id, e.className]));
    expect(kinds).toEqual({ 'ok:a': 'edge-success', 'fail:a': 'edge-failure', 'cond:a:0': 'edge-conditional', 'ok:b': 'edge-success' });
    expect(edges.find((e) => e.id === 'fail:a')?.label).toBe('on failure');
    expect(edges.find((e) => e.id === 'cond:a:0')?.label).toBe('rule 1');
  });

  it('dangling targets collapse to the end node', () => {
    const def = blankDefinition();
    def.steps = [{ step_id: 'a', type: 'input_collection', name: 'A', config: {}, on_success: 'ghost' }];
    const { edges } = definitionToFlow(def, null);
    expect(edges[0].target).toBe(END_NODE_ID);
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
    if (edited.steps[0]) edited.steps[0].on_failure = 'start';
    expect(structureKey(edited)).not.toBe(structureKey(def));
  });
});

describe('renameStep', () => {
  it('rewrites edges, predicates, mappings and positions', () => {
    const def = blankDefinition();
    def.steps = [
      { step_id: 'calc', type: 'skill_execution', name: 'C', config: { inputs_mapping: { w: { from: 'scope.qty' } } }, on_success: 'end' },
      { step_id: 'branch', type: 'conditional_routing', name: 'B', config: { rules: [{ when: { ref: 'calc.value', op: 'gt', value: 0 }, goto: 'calc' }] }, on_success: 'calc' },
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
    const rule = (branch?.config as { rules: Array<{ goto: string; when: { ref: string } }> }).rules[0];
    expect(rule.goto).toBe('estimate');
    expect(rule.when.ref).toBe('estimate.value');
    expect((out?.outputs as Record<string, { from: string }>).total.from).toBe('estimate.value');
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
      { step_id: 'a', type: 'input_collection', name: 'A', config: {}, on_success: 'b' },
      { step_id: 'b', type: 'input_collection', name: 'B', config: {}, on_success: 'end' },
    ];
    const out = deleteStep(def, 'b');
    expect(out?.steps?.map((s) => s.step_id)).toEqual(['a']);
    expect(out?.steps?.[0].on_success).toBe('end');
  });
});

describe('defaultConfig', () => {
  it('covers all ten step types', () => {
    for (const t of ['input_collection', 'model_reasoning', 'database_retrieval', 'skill_retrieval', 'skill_execution', 'conditional_routing', 'iteration', 'human_approval', 'output_composition', 'document_generation']) {
      expect(typeof defaultConfig(t)).toBe('object');
    }
  });
});
