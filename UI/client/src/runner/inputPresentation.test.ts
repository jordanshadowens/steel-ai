import { describe, expect, it } from 'vitest';
import { coerceValue, getPresentation, isVisible, resolveControl, validateInputs } from './inputPresentation';
import type { WorkflowDefinition } from '../api/contracts';

const def: WorkflowDefinition = {
  workflow_id: 'w',
  inputs: [
    { name: 'qty', type: 'number', required: true },
    { name: 'method', type: 'string', required: true },
    { name: 'notes', type: 'string' },
    { name: 'lines', type: 'array', required: true },
    { name: 'crane', type: 'string' },
  ],
  steps: [],
  ui: {
    input_presentation: {
      version: 1,
      groups: [{ id: 'g1', title: 'Job' }],
      fields: {
        method: { label: 'Erection method', control: 'select', enum: [{ value: 'crane' }, { value: 'helicopter' }] },
        crane: { visibleWhen: { field: 'method', equals: 'crane' } },
        lines: { control: 'rows', row: { columns: [{ key: 'desc' }, { key: 'amount', type: 'number' }] } },
      },
    },
  },
};

describe('input presentation', () => {
  it('reads versioned metadata and resolves controls', () => {
    expect(getPresentation(def)?.version).toBe(1);
    expect(resolveControl(def.inputs![1], { control: 'select' })).toBe('select');
    expect(resolveControl(def.inputs![0], {})).toBe('number');
    expect(resolveControl({ name: 'x', type: 'object' }, {})).toBe('json');
  });

  it('evaluates restricted visibility without dropping values', () => {
    expect(isVisible(def, 'crane', { method: 'crane' })).toBe(true);
    expect(isVisible(def, 'crane', { method: 'helicopter' })).toBe(false);
    const { values } = validateInputs(def, { qty: '2', method: 'helicopter', crane: 'big', lines: [] });
    expect(values.crane).toBe('big');
  });

  it('coerces values and reports per-field errors', () => {
    const { values, errors } = validateInputs(def, { qty: '3', method: 'crane', lines: [{ desc: 'a', amount: 1 }] });
    expect(values.qty).toBe(3);
    expect(errors).toEqual({});
    const bad = validateInputs(def, { qty: 'nope', method: '', lines: [] });
    expect(bad.errors.qty).toContain('must be a number');
    expect(bad.errors.method).toContain('required');
    expect(coerceValue({ name: 'b', type: 'boolean' }, 'boolean', false)).toBe(false);
    expect(coerceValue({ name: 'n', type: 'number' }, 'number', '0')).toBe(0);
  });
});
