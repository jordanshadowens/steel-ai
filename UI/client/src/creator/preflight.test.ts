import { describe, expect, it } from 'vitest';
import { availableRefs, runPreflight } from './preflight';
import { blankDefinition } from './adapter';
import type { SkillRow, WorkflowDefinition } from '../api/contracts';

const materialCost: SkillRow = {
  name: 'material_cost',
  version: 2,
  status: 'verified',
  input_params: ['quantity', 'unit_price', 'tax_rate'],
};

function defWithCalc(mapping: Record<string, string>): WorkflowDefinition {
  const def = blankDefinition();
  def.inputs = [{ name: 'weight_lb', type: 'number', required: true }];
  def.steps = [
    { step_id: 'scope', type: 'input_collection', name: 'Scope', config: { fields: ['weight_lb'] }, on_success: 'calc' },
    {
      step_id: 'calc',
      type: 'skill_execution',
      name: 'Calc',
      config: { skill: { name: 'material_cost', version: 2 }, inputs_mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, { from: v }])) },
      on_success: 'end',
    },
  ];
  return def;
}

describe('runPreflight', () => {
  it('catches the material_cost param mismatch before execution', () => {
    const issues = runPreflight(defWithCalc({ weight_lb: 'scope.weight_lb', waste_pct: 'scope.waste_pct', price_per_ton: 'scope.price' }), [materialCost]);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.some((e) => e.message.includes('quantity') && e.message.includes('unit_price') && e.message.includes('tax_rate'))).toBe(true);
    expect(errors.some((e) => e.message.includes('never renamed'))).toBe(true);
  });

  it('passes a correctly bound skill', () => {
    const issues = runPreflight(
      defWithCalc({ quantity: 'scope.weight_lb', unit_price: 'scope.weight_lb', tax_rate: 'scope.weight_lb' }),
      [materialCost],
    );
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('flags empty data sources and unknown refs distinctly', () => {
    const issues = runPreflight(defWithCalc({ quantity: '', unit_price: 'nope.field', tax_rate: 'scope.weight_lb' }), [materialCost]);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('no data source'))).toBe(true);
    expect(issues.some((i) => i.severity === 'warning' && i.message.includes('Shape unknown'))).toBe(true);
  });

  it('flags unreachable steps without failing', () => {
    const def = blankDefinition();
    def.steps = [
      { step_id: 'a', type: 'input_collection', name: 'A', config: {}, on_success: 'end' },
      { step_id: 'b', type: 'input_collection', name: 'B', config: {}, on_success: 'end' },
    ];
    const issues = runPreflight(def, []);
    expect(issues).toEqual([{ stepId: 'b', severity: 'warning', message: 'Step "b" is unreachable from the entry step "a".' }]);
  });
});

describe('availableRefs', () => {
  it('offers declared inputs and earlier step fields only', () => {
    const def = defWithCalc({});
    const refs = availableRefs(def, 'calc').map((r) => r.ref);
    expect(refs).toContain('weight_lb');
    expect(refs).toContain('scope.weight_lb');
    expect(refs).not.toContain('calc');
  });
});
