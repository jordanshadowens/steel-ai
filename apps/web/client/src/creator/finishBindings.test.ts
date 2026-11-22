import { expect, it } from 'vitest';
import type { DesignerField } from '../api/contracts';
import { blankDefinition } from './adapter';
import { bindModelField, setOutputSource } from './finishBindings';

const field: DesignerField = {
  field_id: 'team', name: 'Team', ftype: 'text', position: 0,
  required: true, unique: false, repeated: false, default: null,
  validation: {}, status: 'active',
};

it('keeps a generated model input when a step still uses it after rebinding the output', () => {
  const definition = blankDefinition();
  const input = bindModelField(definition, 'team', { type_id: 'teams', name: 'Teams' }, field);
  setOutputSource(definition, 'team', input);
  definition.steps?.push({
    step_id: 'results', type: 'output_composition', config: { mapping: { team: { from: input } } },
  });

  setOutputSource(definition, 'team', 'results.team');

  expect(definition.inputs?.find(({ name }) => name === input)?.designer).toMatchObject({ type: 'teams', field: 'Team' });
  expect(definition.outputs?.team).toEqual({ from: 'results.team' });
});

it('keeps an input the author changed after Finish created it', () => {
  const definition = blankDefinition();
  const input = bindModelField(definition, 'team', { type_id: 'teams', name: 'Teams' }, field);
  setOutputSource(definition, 'team', input);
  const customized = definition.inputs?.find(({ name }) => name === input);
  expect(customized).toBeDefined();
  customized!.required = false;

  setOutputSource(definition, 'team', 'start.item');

  expect(definition.inputs).toContainEqual(customized);
  expect(definition.ui?.finishModelInputs).not.toHaveProperty(input);
});
