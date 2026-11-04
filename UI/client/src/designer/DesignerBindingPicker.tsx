import type { DesignerInputBinding, DesignerTypeDetail } from '../api/contracts';
import { useGetDesignerWorkspaceQuery } from '../api/steelApi';

// Presentational binding fields: type -> field cascade plus mode. Pure
// props in/out so creator inspectors and tests drive it directly.
export function DesignerBindingFields(props: {
  types: DesignerTypeDetail[];
  value: DesignerInputBinding | null;
  disabled?: boolean;
  onChange: (next: DesignerInputBinding | null) => void;
}) {
  const current = props.types.find((t) => t.name === props.value?.type || t.type_id === props.value?.type) ?? null;
  const fields = (current?.fields ?? []).filter((f) => f.status === 'active');
  return (
    <div className="map-row">
      <label className="status-line">
        Type{' '}
        <select
          aria-label="Bound designer type"
          value={props.value?.type ?? ''}
          disabled={props.disabled}
          onChange={(e) => {
            const v = e.target.value;
            props.onChange(v === '' ? null : { type: v });
          }}
        >
          <option value="">— none —</option>
          {props.types.map((t) => (
            <option key={t.type_id} value={t.name}>
              {t.name} (v{t.version})
            </option>
          ))}
        </select>
      </label>
      {props.value && (
        <>
          <label className="status-line">
            Mode{' '}
            <select
              aria-label="Binding mode"
              value={props.value.mode ?? 'record'}
              disabled={props.disabled}
              onChange={(e) => props.onChange({ ...props.value!, mode: e.target.value as 'record' | 'value' })}
            >
              <option value="record">record (submits record id)</option>
              <option value="value">value (submits one field)</option>
            </select>
          </label>
          {(props.value.mode ?? 'record') === 'value' && (
            <label className="status-line">
              Field{' '}
              <select
                aria-label="Bound field"
                value={props.value.field ?? ''}
                disabled={props.disabled}
                onChange={(e) => props.onChange({ ...props.value!, field: e.target.value || undefined })}
              >
                <option value="">— pick —</option>
                {fields.map((f) => (
                  <option key={f.field_id} value={f.name}>
                    {f.name} [{f.ftype}]
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </div>
  );
}

// Hook wrapper: loads the workspace catalog, then renders the fields.
export function DesignerBindingPicker(props: {
  value: DesignerInputBinding | null;
  disabled?: boolean;
  onChange: (next: DesignerInputBinding | null) => void;
}) {
  const ws = useGetDesignerWorkspaceQuery(undefined);
  if (ws.isLoading) return <p className="status-line">Loading types…</p>;
  if (ws.error || !ws.data) return <p className="status-line">Designer types unavailable (local store only).</p>;
  return <DesignerBindingFields types={ws.data.types} value={props.value} disabled={props.disabled} onChange={props.onChange} />;
}
