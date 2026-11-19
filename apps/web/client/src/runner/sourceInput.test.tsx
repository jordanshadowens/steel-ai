import { test, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { InputForm } from './InputForm';
import { validateInputs } from './inputPresentation';
import type { WorkflowDefinition } from '../api/contracts';

test('multiline source input retains line breaks, indentation and trailing spaces through validation', () => {
  const def = {
    inputs: [{ name: 'source_code', type: 'string', required: true }],
    ui: {
      input_presentation: {
        version: 1,
        fields: { source_code: { control: 'multiline' } },
      },
    },
  } as unknown as WorkflowDefinition;
  let current: Record<string, unknown> = {};
  function Fixture() {
    const [values, setValues] = useState<Record<string, unknown>>({});
    current = values;
    return (
      <InputForm def={def} values={values} errors={{}} onChange={setValues} />
    );
  }
  try {
    render(<Fixture />);
    const field = screen.getByLabelText('source_code *');
    expect(field.tagName).toBe('TEXTAREA');
    const code = 'function first(values) {\n  return values[1];  \n}\n';
    fireEvent.change(field, { target: { value: code } });
    expect(current.source_code).toBe(code);
    expect(validateInputs(def, current).values.source_code).toBe(code);
    expect(
      validateInputs(def, { source_code: '' }).errors.source_code,
    ).toContain('required');
  } finally {
    cleanup();
  }
});
