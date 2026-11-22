import type { DesignerField, WorkflowDefinition, WorkflowInput } from '../api/contracts';

function modelInputSignature(input: WorkflowInput): string {
  return JSON.stringify([
    input.name,
    input.type,
    input.required,
    input.designer?.type,
    input.designer?.mode,
    input.designer?.field,
    input.designer?.workspace,
  ]);
}

export function bindModelField(
  draft: WorkflowDefinition,
  output: string,
  model: { type_id: string; name: string },
  field: DesignerField,
): string {
  const type = field.repeated
    ? 'array'
    : field.ftype === 'integer'
      ? 'number'
      : field.ftype === 'boolean'
        ? 'boolean'
        : 'string';
  const existing = draft.inputs?.find((input) =>
    input.type === type &&
    input.required === true &&
    input.designer?.mode === 'value' &&
    input.designer.field === field.name &&
    !input.designer.workspace &&
    [model.type_id, model.name].includes(input.designer.type) &&
    !draft.steps?.some((step) => step.step_id === input.name),
  );
  if (existing) return existing.name;

  const taken = new Set([
    ...(draft.inputs ?? []).map((input) => input.name),
    ...(draft.steps ?? []).map((step) => step.step_id),
  ]);
  const base = `model_${output.replace(/[^A-Za-z0-9_]/g, '_')}`;
  let name = base;
  for (let suffix = 2; taken.has(name); suffix++) name = `${base}_${suffix}`;
  const input: WorkflowInput = {
    name, type, required: true,
    designer: { type: model.type_id, mode: 'value', field: field.name },
  };
  draft.inputs = [...(draft.inputs ?? []), input];
  draft.ui = {
    ...draft.ui,
    finishModelInputs: { ...draft.ui?.finishModelInputs, [name]: modelInputSignature(input) },
  };
  return name;
}

function usesInput(value: unknown, name: string): boolean {
  if (typeof value === 'string') {
    return value === name || value.startsWith(`${name}.`) || value.startsWith(`${name}[`);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) => usesInput(entry, name));
  }
  return false;
}

export function setOutputSource(draft: WorkflowDefinition, name: string, from: string) {
  const previous = draft.outputs?.[name];
  const binding = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? previous as Record<string, unknown> : {};
  draft.outputs = { ...(draft.outputs ?? {}), [name]: { ...binding, from } };
  if (typeof binding.from === 'string') releaseModelInput(draft, binding.from);
}

export function releaseModelInput(draft: WorkflowDefinition, source: string | undefined) {
  const name = source?.split(/[.\[]/, 1)[0];
  const managed = draft.ui?.finishModelInputs;
  if (!name || !managed || !Object.hasOwn(managed, name)) return;
  if (usesInput(draft.outputs, name) || usesInput(draft.steps, name)) return;

  // Keep an input the workflow author has changed since Finish created it.
  const signature = managed[name];
  draft.inputs = draft.inputs?.filter((input) =>
    input.name !== name || modelInputSignature(input) !== signature,
  );
  delete managed[name];
}
