import type { DesignerRecord, DesignerTypeDetail } from '../api/contracts';
import { useGetDesignerWorkspaceQuery, useListDesignerRecordsQuery } from '../api/steelApi';

export interface SlotBinding {
  type: string;
  record_id: string;
  field?: string;
}

function recordLabel(r: DesignerRecord): string {
  const first = Object.values(r.values)[0];
  const head = first === undefined || first === null ? r.record_id.slice(0, 8) : String(Array.isArray(first) ? first[0] : first).slice(0, 40);
  return `${head} · ${r.record_id.slice(0, 8)}`;
}

// Presentational: type -> record -> field cascade for one slot.
export function SlotBindingFields(props: {
  slot: string;
  types: DesignerTypeDetail[];
  records: DesignerRecord[];
  recordsLoading: boolean;
  value: SlotBinding | null;
  onChange: (next: SlotBinding | null) => void;
}) {
  const current = props.types.find((t) => t.name === props.value?.type || t.type_id === props.value?.type) ?? null;
  const fields = (current?.fields ?? []).filter((f) => f.status === 'active');
  return (
    <div className="map-row">
      <label className="status-line">
        Bound type{' '}
        <select
          aria-label={`Slot ${props.slot} bound type`}
          value={props.value?.type ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            props.onChange(v === '' ? null : { type: v, record_id: '' });
          }}
        >
          <option value="">— typed value above —</option>
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
            Record{' '}
            <select
              aria-label={`Slot ${props.slot} bound record`}
              value={props.value.record_id}
              disabled={props.recordsLoading}
              onChange={(e) => props.onChange({ ...props.value!, record_id: e.target.value })}
            >
              <option value="">— pick —</option>
              {props.records.map((r) => (
                <option key={r.record_id} value={r.record_id}>
                  {recordLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="status-line">
            Field (blank = whole record){' '}
            <select
              aria-label={`Slot ${props.slot} bound field`}
              value={props.value.field ?? ''}
              onChange={(e) => props.onChange({ ...props.value!, field: e.target.value || undefined })}
            >
              <option value="">— whole record —</option>
              {fields.map((f) => (
                <option key={f.field_id} value={f.name}>
                  {f.name} [{f.ftype}]
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

// Hook wrapper: loads the catalog, then the bound type's records.
export function SlotDesignerBinding(props: { slot: string; value: SlotBinding | null; onChange: (next: SlotBinding | null) => void }) {
  const ws = useGetDesignerWorkspaceQuery(undefined);
  const match = ws.data?.types.find((t) => t.name === props.value?.type || t.type_id === props.value?.type) ?? null;
  const recs = useListDesignerRecordsQuery(match ? { id: match.type_id, limit: 200 } : { id: '' }, { skip: !match });
  if (ws.isLoading) return null;
  if (ws.error || !ws.data) return null;
  return <SlotBindingFields slot={props.slot} types={ws.data.types} records={recs.data?.records ?? []} recordsLoading={recs.isLoading} value={props.value} onChange={props.onChange} />;
}
