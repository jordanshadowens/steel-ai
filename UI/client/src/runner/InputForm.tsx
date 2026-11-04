import type { WorkflowDefinition, WorkflowInput } from '../api/contracts';
import { fieldMeta, getPresentation, isVisible, resolveControl } from './inputPresentation';

// Metadata-driven project-inputs form. Unknown legacy object inputs keep an
// explicit advanced JSON control; hidden conditional fields keep their values
// and still submit.
export function InputForm({ def, values, onChange, errors, disabled }: {
  def: WorkflowDefinition;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  const pres = getPresentation(def);
  const groups = [...(pres?.groups ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const inputs = [...(def.inputs ?? [])].sort((a, b) => (fieldMeta(def, a.name).order ?? 0) - (fieldMeta(def, b.name).order ?? 0));
  const visible = (n: string) => isVisible(def, n, values);
  if (inputs.length === 0) return <p className="status-line">No inputs declared.</p>;
  const set = (name: string, v: unknown) => onChange({ ...values, [name]: v });
  const renderField = (inp: WorkflowInput) => (
    <FieldControl key={inp.name} def={def} inp={inp} value={values[inp.name]} error={errors[inp.name]} disabled={disabled} onChange={(v) => set(inp.name, v)} />
  );
  const ungrouped = inputs.filter((i) => !fieldMeta(def, i.name).group && visible(i.name));
  return (
    <div>
      {ungrouped.map(renderField)}
      {groups.map((g) => {
        const members = inputs.filter((i) => fieldMeta(def, i.name).group === g.id && visible(i.name));
        if (members.length === 0) return null;
        return (
          <fieldset key={g.id}>
            <legend>{g.title}</legend>
            {members.map(renderField)}
          </fieldset>
        );
      })}
    </div>
  );
}

function FieldControl({ def, inp, value, error, disabled, onChange }: {
  def: WorkflowDefinition;
  inp: WorkflowInput;
  value: unknown;
  error?: string;
  disabled?: boolean;
  onChange: (v: unknown) => void;
}) {
  const meta = fieldMeta(def, inp.name);
  const control = resolveControl(inp, meta);
  const label = `${meta.label ?? inp.name}${inp.required ? ' *' : ''}`;
  const hint = [meta.unit ? `Unit: ${meta.unit}` : '', meta.example ? `Example: ${meta.example}` : ''].filter(Boolean).join(' · ');
  const id = `in-${inp.name}`;
  return (
    <div className="field">
      <span><label htmlFor={id}>{label}</label></span>
      {control === 'boolean' && (
        <input id={id} type="checkbox" role="switch" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      )}
      {control === 'number' && (
        <input id={id} type="number" value={typeof value === 'number' ? value : (value as string) ?? ''} disabled={disabled} placeholder={meta.example} onChange={(e) => onChange(e.target.value)} />
      )}
      {control === 'text' && (
        <input id={id} type="text" value={String(value ?? '')} disabled={disabled} placeholder={meta.example} onChange={(e) => onChange(e.target.value)} />
      )}
      {control === 'select' && (
        <select
          id={id}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            const hit = (meta.enum ?? []).find((o) => String(o.value) === raw);
            onChange(hit ? hit.value : raw);
          }}
        >
          <option value="">Select…</option>
          {(meta.enum ?? []).map((o) => (
            <option key={String(o.value)} value={String(o.value)}>{o.label ?? String(o.value)}</option>
          ))}
        </select>
      )}
      {control === 'rows' && (
        <RowsEditor columns={meta.row?.columns ?? []} rows={Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []} disabled={disabled} onChange={onChange} />
      )}
      {control === 'json' && (
        <>
          <span className="status-line">Advanced JSON — preserved exactly.</span>
          <textarea id={id} rows={3} value={typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        </>
      )}
      {hint !== '' && <span className="status-line">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

function RowsEditor({ columns, rows, disabled, onChange }: {
  columns: Array<{ key: string; label?: string; type?: 'text' | 'number' }>;
  rows: Array<Record<string, unknown>>;
  disabled?: boolean;
  onChange: (v: Array<Record<string, unknown>>) => void;
}) {
  const setCell = (i: number, key: string, v: string) => {
    onChange(rows.map((r, n) => (n === i ? { ...r, [key]: v } : r)));
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div>
      {rows.length === 0 && <p className="status-line">No rows.</p>}
      {rows.map((r, i) => (
        <div key={i} className="map-row">
          <span className="status-line num">{i + 1}.</span>
          {columns.map((c) => (
            <input
              key={c.key}
              type={c.type === 'number' ? 'number' : 'text'}
              aria-label={`Row ${i + 1} ${c.label ?? c.key}`}
              placeholder={c.label ?? c.key}
              value={String(r[c.key] ?? '')}
              disabled={disabled}
              onChange={(e) => setCell(i, c.key, e.target.value)}
            />
          ))}
          <button type="button" className="btn" aria-label={`Move row ${i + 1} up`} disabled={disabled || i === 0} onClick={() => move(i, -1)}>↑</button>
          <button type="button" className="btn" aria-label={`Move row ${i + 1} down`} disabled={disabled || i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button
            type="button"
            className="btn"
            aria-label={`Remove row ${i + 1}`}
            disabled={disabled}
            onClick={() => onChange(rows.filter((_, n) => n !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => onChange([...rows, Object.fromEntries(columns.map((c) => [c.key, '']))])}
      >
        Add row
      </button>
    </div>
  );
}
