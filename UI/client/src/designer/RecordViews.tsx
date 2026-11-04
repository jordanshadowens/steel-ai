import { useState } from 'react';
import type { DesignerField, DesignerRecord } from '../api/contracts';
import { formatScalarValue, parseRepeatedInput, parseScalarInput } from './valueInputs';

export interface RecordFormProps {
  fields: DesignerField[];
  initial?: Record<string, unknown>;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
}

function initialText(f: DesignerField, initial?: Record<string, unknown>): string {
  const v = initial?.[f.name];
  if (v === null || v === undefined) return '';
  if (f.repeated) return Array.isArray(v) ? v.map((x) => formatScalarValue(f.ftype, x)).join('\n') : formatScalarValue(f.ftype, v);
  return formatScalarValue(f.ftype, v);
}

export function RecordForm(props: RecordFormProps) {
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.fields.map((f) => [f.name, initialText(f, props.initial)])),
  );
  const [bools, setBools] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const f of props.fields) {
      if (f.ftype !== 'boolean' || f.repeated) continue;
      const v = props.initial?.[f.name];
      out[f.name] = typeof v === 'boolean' ? v : f.default === true;
    }
    return out;
  });
  const [touchedBool, setTouchedBool] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const editing = props.initial !== undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const values: Record<string, unknown> = {};
    for (const f of props.fields) {
      if (f.ftype === 'boolean' && !f.repeated) {
        if (!touchedBool[f.name] && !editing) continue; // omit: server default applies
        if (!touchedBool[f.name] && editing) continue; // untouched: keep
        values[f.name] = bools[f.name] ?? false;
        continue;
      }
      const raw = texts[f.name] ?? '';
      if (raw.trim() === '') {
        if (editing && !f.required) values[f.name] = null; // clear optional
        continue; // omit: insert-default applies, or edit keeps required
      }
      const parsed = f.repeated ? parseRepeatedInput(f.ftype, raw) : parseScalarInput(f.ftype, raw);
      if (!parsed.ok) {
        setLocalError(`${f.name}: ${parsed.error}`);
        return;
      }
      values[f.name] = parsed.value;
    }
    setLocalError(null);
    props.onSubmit(values);
  };

  return (
    <form className="panel-card" onSubmit={submit}>
      {props.fields.map((f) => (
        <div key={f.field_id}>
          {f.ftype === 'boolean' && !f.repeated ? (
            <label className="status-line">
              <input
                type="checkbox"
                checked={bools[f.name] ?? false}
                onChange={(e) => {
                  setBools((prev) => ({ ...prev, [f.name]: e.target.checked }));
                  setTouchedBool((prev) => ({ ...prev, [f.name]: true }));
                }}
                disabled={props.busy}
              />{' '}
              {f.name}
              {f.required ? ' (required)' : ''}
            </label>
          ) : f.ftype === 'enum' && !f.repeated ? (
            <label className="field">
              <span>
                {f.name}
                {f.required ? ' (required)' : ''}
              </span>
              <select aria-label={f.name} value={texts[f.name] ?? ''} onChange={(e) => setTexts((prev) => ({ ...prev, [f.name]: e.target.value }))} disabled={props.busy}>
                <option value="">—</option>
                {((f.validation.options as string[] | undefined) ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ) : f.repeated ? (
            <label className="field">
              <span>
                {f.name} (one per line{f.required ? ', required' : ''})
              </span>
              <textarea rows={3} value={texts[f.name] ?? ''} onChange={(e) => setTexts((prev) => ({ ...prev, [f.name]: e.target.value }))} disabled={props.busy} />
            </label>
          ) : f.ftype === 'date' ? (
            <label className="field">
              <span>
                {f.name}
                {f.required ? ' (required)' : ''}
              </span>
              <input type="date" value={texts[f.name] ?? ''} onChange={(e) => setTexts((prev) => ({ ...prev, [f.name]: e.target.value }))} disabled={props.busy} />
            </label>
          ) : (
            <label className="field">
              <span>
                {f.name} <em className="status-line">[{f.ftype}{f.required ? ', required' : ''}{f.unique ? ', unique' : ''}]</em>
              </span>
              <input
                type="text"
                inputMode={f.ftype === 'integer' || f.ftype === 'decimal' ? 'decimal' : 'text'}
                placeholder={f.ftype === 'timestamp' ? '2026-11-04T06:00:00Z' : f.ftype === 'decimal' ? 'exact decimal string' : ''}
                value={texts[f.name] ?? ''}
                onChange={(e) => setTexts((prev) => ({ ...prev, [f.name]: e.target.value }))}
                disabled={props.busy}
              />
            </label>
          )}
        </div>
      ))}
      {editing && <p className="status-line">Emptying an optional field clears it. Required fields cannot be cleared.</p>}
      {(localError ?? props.error) && (
        <p className="field-error" role="alert">
          {localError ?? props.error}
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

export interface RecordGridProps {
  records: DesignerRecord[];
  fields: DesignerField[];
  busy: boolean;
  error: string | null;
  onEdit: (record: DesignerRecord) => void;
  onDelete: (record_id: string, purge: boolean) => void;
  onSearch: (filters: Record<string, unknown>) => void;
  onClearSearch: () => void;
  searching: boolean;
}

export function RecordGrid(props: RecordGridProps) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [filterError, setFilterError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const out: Record<string, unknown> = {};
    for (const f of props.fields) {
      const raw = filters[f.name] ?? '';
      if (!raw.trim()) continue;
      const parsed = parseScalarInput(f.ftype, raw);
      if (!parsed.ok) {
        setFilterError(`${f.name}: ${parsed.error}`);
        return;
      }
      out[f.name] = parsed.value;
    }
    setFilterError(null);
    props.onSearch(out);
  };

  return (
    <div className="section-card">
      <h2>Records</h2>
      <form className="toolbar" onSubmit={search}>
        {props.fields.slice(0, 4).map((f) => (
          <label key={f.field_id} className="status-line">
            {f.name}{' '}
            <input
              type="search"
              aria-label={`Filter by ${f.name}`}
              value={filters[f.name] ?? ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, [f.name]: e.target.value }))}
              disabled={props.searching}
            />
          </label>
        ))}
        <button type="submit" className="btn" disabled={props.searching}>
          Search
        </button>
        <button
          type="button"
          className="btn"
          disabled={props.searching}
          onClick={() => {
            setFilters({});
            props.onClearSearch();
          }}
        >
          Clear
        </button>
      </form>
      {filterError && (
        <p className="field-error" role="alert">
          {filterError}
        </p>
      )}
      {props.records.length === 0 && <p className="status-line">No records match.</p>}
      <table className="grid">
        <thead>
          <tr>
            {props.fields.map((f) => (
              <th key={f.field_id} scope="col">
                {f.name}
              </th>
            ))}
            <th scope="col">v</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {props.records.map((r) => (
            <tr key={r.record_id}>
              {props.fields.map((f) => (
                <td key={f.field_id}>
                  {(() => {
                    const v = r.values[f.name];
                    if (v === null || v === undefined) return '—';
                    if (Array.isArray(v)) return v.map((x) => formatScalarValue(f.ftype, x)).join(', ');
                    return formatScalarValue(f.ftype, v);
                  })()}
                </td>
              ))}
              <td className="num">{r.type_version}</td>
              <td>
                <span className="toolbar" style={{ margin: 0 }}>
                  <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => props.onEdit(r)}>
                    Edit
                  </button>
                  {confirming === r.record_id ? (
                    <>
                      <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => { props.onDelete(r.record_id, false); setConfirming(null); }}>
                        Delete
                      </button>
                      <button type="button" className="btn btn-filter btn-danger" disabled={props.busy} onClick={() => { props.onDelete(r.record_id, true); setConfirming(null); }}>
                        Purge
                      </button>
                      <button type="button" className="btn btn-filter" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => setConfirming(r.record_id)}>
                      Delete…
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.error && (
        <p className="field-error" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}
