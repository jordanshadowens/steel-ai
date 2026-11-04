import { useState } from 'react';
import type { DesignerField, DesignerFtype } from '../api/contracts';

export const FTYPES: DesignerFtype[] = ['text', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'enum'];

export interface FieldFormState {
  name: string;
  ftype: DesignerFtype;
  required: boolean;
  unique: boolean;
  repeated: boolean;
  defaultText: string;
  optionsText: string;
  minText: string;
  maxText: string;
  minLengthText: string;
  maxLengthText: string;
  pattern: string;
  precisionText: string;
  scaleText: string;
}

export const emptyFieldForm: FieldFormState = {
  name: '',
  ftype: 'text',
  required: false,
  unique: false,
  repeated: false,
  defaultText: '',
  optionsText: '',
  minText: '',
  maxText: '',
  minLengthText: '',
  maxLengthText: '',
  pattern: '',
  precisionText: '',
  scaleText: '',
};

export function fieldToFormState(f: DesignerField): FieldFormState {
  const v = f.validation ?? {};
  const str = (x: unknown): string => (x === null || x === undefined ? '' : String(x));
  return {
    name: f.name,
    ftype: f.ftype,
    required: f.required,
    unique: f.unique,
    repeated: f.repeated,
    defaultText: f.default === null || f.default === undefined
      ? ''
      : Array.isArray(f.default) ? f.default.map((d) => str(d)).join('\n') : str(f.default),
    optionsText: Array.isArray(v.options) ? v.options.map((o) => str(o)).join('\n') : '',
    minText: str(v.min),
    maxText: str(v.max),
    minLengthText: str(v.minLength),
    maxLengthText: str(v.maxLength),
    pattern: typeof v.pattern === 'string' ? v.pattern : '',
    precisionText: str(v.precision),
    scaleText: str(v.scale),
  };
}

export interface FieldPayload {
  name: string;
  ftype: DesignerFtype;
  required: boolean;
  unique: boolean;
  repeated: boolean;
  default: unknown;
  validation: Record<string, unknown>;
}

// Form strings -> repository payload. Client-side parse failures return
// early feedback; the server revalidates everything on submit.
export function fieldFormToPayload(s: FieldFormState): { ok: true; spec: FieldPayload } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s.name)) return fail('name must match [A-Za-z][A-Za-z0-9_]{0,63}');
  if (s.unique && s.repeated) return fail('unique + repeated is inexpressible');
  const validation: Record<string, unknown> = {};
  const num = (raw: string, what: string): number | null => {
    if (!raw.trim()) return null;
    const n = Number(raw);
    if (!Number.isInteger(n)) throw new Error(`${what} must be an integer`);
    return n;
  };
  try {
    if (s.ftype === 'text') {
      const minL = num(s.minLengthText, 'minLength');
      const maxL = num(s.maxLengthText, 'maxLength');
      if (minL !== null) validation.minLength = minL;
      if (maxL !== null) validation.maxLength = maxL;
      if (s.pattern.trim()) validation.pattern = s.pattern;
    }
    if (s.ftype === 'integer') {
      if (s.minText.trim()) {
        if (!/^-?\d+$/.test(s.minText.trim())) throw new Error('min must be an integer');
        validation.min = Number(s.minText);
      }
      if (s.maxText.trim()) {
        if (!/^-?\d+$/.test(s.maxText.trim())) throw new Error('max must be an integer');
        validation.max = Number(s.maxText);
      }
    }
    if (s.ftype === 'decimal') {
      if (!s.precisionText.trim() || !s.scaleText.trim()) throw new Error('decimal needs precision and scale');
      validation.precision = num(s.precisionText, 'precision') as number;
      validation.scale = num(s.scaleText, 'scale') as number;
      if (s.minText.trim()) validation.min = s.minText.trim();
      if (s.maxText.trim()) validation.max = s.maxText.trim();
    }
    if (s.ftype === 'enum') {
      const options = s.optionsText.split('\n').map((o) => o.trim()).filter(Boolean);
      if (options.length === 0) throw new Error('enum needs at least one option (one per line)');
      validation.options = options;
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  let def: unknown = null;
  if (s.defaultText.trim() !== '') {
    if (s.repeated) {
      const lines = s.defaultText.split('\n').map((l) => l.trim()).filter((l) => l !== '');
      def = s.ftype === 'integer' ? lines.map(Number) : s.ftype === 'boolean' ? lines.map((l) => l === 'true') : lines;
    } else if (s.ftype === 'integer') {
      if (!/^-?\d+$/.test(s.defaultText.trim())) return fail('default is not an integer');
      def = Number(s.defaultText);
    } else if (s.ftype === 'boolean') {
      if (s.defaultText.trim() !== 'true' && s.defaultText.trim() !== 'false') return fail('default wants true or false');
      def = s.defaultText.trim() === 'true';
    } else {
      def = s.defaultText;
    }
  }
  return { ok: true, spec: { name: s.name, ftype: s.ftype, required: s.required, unique: s.unique, repeated: s.repeated, default: def, validation } };
}

function flagsOf(f: DesignerField): string {
  const out: string[] = [];
  if (f.required) out.push('required');
  if (f.unique) out.push('unique');
  if (f.repeated) out.push('repeated');
  return out.join(' · ');
}

export function FieldForm(props: { initial: FieldFormState; submitLabel: string; busy: boolean; onSubmit: (spec: FieldPayload) => void; onCancel: () => void }) {
  const [s, setS] = useState<FieldFormState>(props.initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const set = (patch: Partial<FieldFormState>) => setS((prev) => ({ ...prev, ...patch }));

  return (
    <form
      className="panel-card"
      onSubmit={(e) => {
        e.preventDefault();
        const p = fieldFormToPayload(s);
        if (!p.ok) {
          setLocalError(p.error);
          return;
        }
        setLocalError(null);
        props.onSubmit(p.spec);
      }}
    >
      <div className="designer-formgrid">
        <label className="field">
          <span>Name</span>
          <input type="text" value={s.name} onChange={(e) => set({ name: e.target.value })} disabled={props.busy} />
        </label>
        <label className="field">
          <span>Type</span>
          <select aria-label="Field type" value={s.ftype} onChange={(e) => set({ ftype: e.target.value as DesignerFtype })} disabled={props.busy}>
            {FTYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="toolbar" role="group" aria-label="Field flags">
        <label className="status-line">
          <input type="checkbox" checked={s.required} onChange={(e) => set({ required: e.target.checked })} disabled={props.busy} /> required
        </label>
        <label className="status-line">
          <input type="checkbox" checked={s.unique} onChange={(e) => set({ unique: e.target.checked })} disabled={props.busy || s.repeated} /> unique
        </label>
        <label className="status-line">
          <input type="checkbox" checked={s.repeated} onChange={(e) => set({ repeated: e.target.checked })} disabled={props.busy} /> repeated (list)
        </label>
      </div>
      {s.ftype === 'text' && (
        <div className="designer-formgrid">
          <label className="field">
            <span>Min length</span>
            <input type="text" inputMode="numeric" value={s.minLengthText} onChange={(e) => set({ minLengthText: e.target.value })} disabled={props.busy} />
          </label>
          <label className="field">
            <span>Max length</span>
            <input type="text" inputMode="numeric" value={s.maxLengthText} onChange={(e) => set({ maxLengthText: e.target.value })} disabled={props.busy} />
          </label>
          <label className="field">
            <span>Pattern (regex, optional)</span>
            <input type="text" value={s.pattern} onChange={(e) => set({ pattern: e.target.value })} disabled={props.busy} />
          </label>
        </div>
      )}
      {(s.ftype === 'integer' || s.ftype === 'decimal') && (
        <div className="designer-formgrid">
          <label className="field">
            <span>Min</span>
            <input type="text" value={s.minText} onChange={(e) => set({ minText: e.target.value })} disabled={props.busy} />
          </label>
          <label className="field">
            <span>Max</span>
            <input type="text" value={s.maxText} onChange={(e) => set({ maxText: e.target.value })} disabled={props.busy} />
          </label>
        </div>
      )}
      {s.ftype === 'decimal' && (
        <div className="designer-formgrid">
          <label className="field">
            <span>Precision (required)</span>
            <input type="text" inputMode="numeric" value={s.precisionText} onChange={(e) => set({ precisionText: e.target.value })} disabled={props.busy} />
          </label>
          <label className="field">
            <span>Scale (required)</span>
            <input type="text" inputMode="numeric" value={s.scaleText} onChange={(e) => set({ scaleText: e.target.value })} disabled={props.busy} />
          </label>
        </div>
      )}
      {s.ftype === 'enum' && (
        <label className="field">
          <span>Options (one per line, required)</span>
          <textarea rows={3} value={s.optionsText} onChange={(e) => set({ optionsText: e.target.value })} disabled={props.busy} />
        </label>
      )}
      <label className="field">
        <span>Default (blank = none{s.repeated ? '; one per line' : ''})</span>
        {s.repeated || s.ftype === 'enum' ? (
          <textarea rows={2} value={s.defaultText} onChange={(e) => set({ defaultText: e.target.value })} disabled={props.busy} />
        ) : (
          <input type="text" value={s.defaultText} onChange={(e) => set({ defaultText: e.target.value })} disabled={props.busy} />
        )}
      </label>
      {localError && (
        <p className="field-error" role="alert">
          {localError}
        </p>
      )}
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" disabled={props.busy}>
          {props.submitLabel}
        </button>
        <button type="button" className="btn" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export interface FieldEditorProps {
  fields: DesignerField[];
  busy: boolean;
  error: string | null;
  onAdd: (spec: FieldPayload) => void;
  onUpdate: (field_id: string, patch: FieldPayload) => void;
  onRetire: (field_id: string, retire: boolean) => void;
  onReorder: (field_ids: string[]) => void;
}

export function FieldEditor(props: FieldEditorProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const move = (index: number, dir: -1 | 1) => {
    const ids = props.fields.map((f) => f.field_id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    props.onReorder(ids);
  };

  return (
    <div className="section-card">
      <h2>Fields</h2>
      {props.fields.length === 0 && <p className="status-line">No fields yet. Add the first one below.</p>}
      <table className="grid">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col">Flags</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {props.fields.map((f, i) => (
            <tr key={f.field_id}>
              <td>
                <code>{f.name}</code>
              </td>
              <td>{f.ftype}</td>
              <td>{flagsOf(f) || '—'}</td>
              <td>{f.status}</td>
              <td>
                <span className="toolbar" style={{ margin: 0 }}>
                  <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => setEditingId(editingId === f.field_id ? null : f.field_id)}>
                    Edit
                  </button>
                  {f.status === 'active' ? (
                    <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => props.onRetire(f.field_id, true)}>
                      Retire
                    </button>
                  ) : (
                    <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => props.onRetire(f.field_id, false)}>
                      Unretire
                    </button>
                  )}
                  <button type="button" className="btn btn-filter" aria-label={`Move ${f.name} up`} disabled={props.busy || i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-filter"
                    aria-label={`Move ${f.name} down`}
                    disabled={props.busy || i === props.fields.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editingId &&
        (() => {
          const f = props.fields.find((x) => x.field_id === editingId);
          if (!f) return null;
          return (
            <FieldForm
              initial={fieldToFormState(f)}
              submitLabel="Save field"
              busy={props.busy}
              onCancel={() => setEditingId(null)}
              onSubmit={(spec) => {
                props.onUpdate(f.field_id, spec);
                setEditingId(null);
              }}
            />
          );
        })()}
      {adding ? (
        <FieldForm
          initial={emptyFieldForm}
          submitLabel="Add field"
          busy={props.busy}
          onCancel={() => setAdding(false)}
          onSubmit={(spec) => {
            props.onAdd(spec);
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" className="btn" disabled={props.busy} onClick={() => setAdding(true)}>
          Add field
        </button>
      )}
      {props.error && (
        <p className="field-error" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}
