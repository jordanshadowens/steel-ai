// Optional versioned input-presentation metadata, stored at
// definition.ui.input_presentation. The generic Runner form renders it;
// the validator ignores it and the runtime never reads it, so updating
// metadata cannot alter calculation semantics or invalidate definitions.
import type { WorkflowDefinition, WorkflowInput } from '../api/contracts';

export interface InputFieldMeta {
  label?: string;
  // Control override. 'auto' (default) derives from the declared input type.
  control?: 'auto' | 'text' | 'number' | 'boolean' | 'select' | 'rows' | 'json';
  unit?: string;
  example?: string;
  group?: string;
  order?: number;
  enum?: Array<{ value: string | number; label?: string }>;
  // Restricted visibility: show only when another field equals a value.
  // Display-only; hidden values are preserved and still submitted.
  visibleWhen?: { field: string; equals: string | number | boolean };
  // Repeated-row columns (control 'rows' over array-of-object values).
  row?: { columns: Array<{ key: string; label?: string; type?: 'text' | 'number' }> };
}

export interface InputPresentation {
  version: 1;
  groups?: Array<{ id: string; title: string; order?: number }>;
  fields?: Record<string, InputFieldMeta>;
}

export function getPresentation(def: WorkflowDefinition): InputPresentation | null {
  const p = (def.ui as Record<string, unknown> | undefined)?.input_presentation as InputPresentation | undefined;
  if (!p || typeof p !== 'object' || p.version !== 1) return null;
  return p;
}

export function fieldMeta(def: WorkflowDefinition, name: string): InputFieldMeta {
  return getPresentation(def)?.fields?.[name] ?? {};
}

export type ResolvedControl = 'text' | 'number' | 'boolean' | 'select' | 'rows' | 'json' | 'record';

export function resolveControl(inp: WorkflowInput, meta: InputFieldMeta): ResolvedControl {
  // A designer binding is semantic (the server verifies the record), so it
  // takes precedence over display-only control overrides.
  if (inp.designer) return 'record';
  if (meta.control && meta.control !== 'auto') return meta.control;
  switch (inp.type) {
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'object':
    case 'array': return 'json';
    default: return 'text';
  }
}

export function isVisible(def: WorkflowDefinition, name: string, values: Record<string, unknown>): boolean {
  const cond = fieldMeta(def, name).visibleWhen;
  if (!cond) return true;
  return (values[cond.field] as unknown) === cond.equals;
}

// Coerce one raw form value to its submitted shape. Throws Error on invalid.
export function coerceValue(inp: WorkflowInput, control: ResolvedControl, raw: unknown): unknown {
  const label = `input "${inp.name}"`;
  if (control === 'boolean') return raw === true;
  if (control === 'rows') {
    if (!Array.isArray(raw)) {
      if (raw == null || raw === '') {
        if (inp.required) throw new Error(`${label} is required`);
        return undefined;
      }
      throw new Error(`${label} must be a list of rows`);
    }
    return raw;
  }
  if (control === 'json') {
    const text = String(raw ?? '').trim();
    if (text === '') {
      if (inp.required) throw new Error(`${label} is required`);
      return undefined;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${label} must be valid JSON`);
    }
  }
  if (control === 'number') {
    const text = String(raw ?? '').trim();
    if (text === '') {
      if (inp.required) throw new Error(`${label} is required`);
      return undefined;
    }
    const n = Number(text);
    if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
    return n;
  }
  if (control === 'record') {
    // Record pickers submit record_ids (mode record) or field values (mode
    // value); the server verifies existence against the live spec.
    if (raw === undefined || raw === null || raw === '') {
      if (inp.required) throw new Error(`${label} is required`);
      return undefined;
    }
    return raw;
  }
  // text / select
  const text = String(raw ?? '');
  if (text === '' && inp.required) throw new Error(`${label} is required`);
  return text;
}

export function validateInputs(def: WorkflowDefinition, values: Record<string, unknown>): { values: Record<string, unknown>; errors: Record<string, string> } {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const inp of def.inputs ?? []) {
    const meta = fieldMeta(def, inp.name);
    try {
      const control = resolveControl(inp, meta);
      // Selects keep the enum's native type (numbers stay numbers).
      if (control === 'select' && meta.enum) {
        const hit = meta.enum.find((o) => String(o.value) === String(values[inp.name] ?? ''));
        if (hit) {
          out[inp.name] = hit.value;
          continue;
        }
      }
      const v = coerceValue(inp, control, values[inp.name]);
      if (v !== undefined) out[inp.name] = v;
    } catch (err) {
      errors[inp.name] = err instanceof Error ? err.message : String(err);
    }
  }
  return { values: out, errors };
}
