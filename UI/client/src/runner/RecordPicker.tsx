import type { DesignerInputBinding, DesignerRecord } from '../api/contracts';
import { useGetDesignerWorkspaceQuery, useListDesignerRecordsQuery } from '../api/steelApi';

// Presentational record select. Labels show the first field value so runs
// read naturally; submitted values stay exact (id or field value).
export function RecordSelect(props: {
  records: DesignerRecord[];
  binding: DesignerInputBinding;
  value: unknown;
  disabled?: boolean;
  id?: string;
  onChange: (v: unknown) => void;
}) {
  const labelOf = (r: DesignerRecord): string => {
    const first = Object.values(r.values)[0];
    const head = first === undefined || first === null ? r.record_id.slice(0, 8) : String(Array.isArray(first) ? first[0] : first).slice(0, 48);
    return `${head} · ${r.record_id.slice(0, 8)}`;
  };
  const submittedOf = (r: DesignerRecord): unknown =>
    (props.binding.mode ?? 'record') === 'value' && props.binding.field ? r.values[props.binding.field] : r.record_id;
  return (
    <select
      id={props.id}
      value={typeof props.value === 'string' || typeof props.value === 'number' ? String(props.value) : ''}
      disabled={props.disabled}
      onChange={(e) => {
        const hit = props.records.find((r) => String(submittedOf(r)) === e.target.value);
        props.onChange(hit ? submittedOf(hit) : e.target.value === '' ? '' : e.target.value);
      }}
    >
      <option value="">Select…</option>
      {props.records.map((r) => (
        <option key={r.record_id} value={String(submittedOf(r) ?? '')}>
          {labelOf(r)}
        </option>
      ))}
    </select>
  );
}

// Hook wrapper: resolves the bound type, then its live records.
export function RecordPicker(props: { binding: DesignerInputBinding; value: unknown; disabled?: boolean; id?: string; onChange: (v: unknown) => void }) {
  const ws = useGetDesignerWorkspaceQuery(undefined);
  const match = ws.data?.types.find((t) => t.name === props.binding.type || t.type_id === props.binding.type) ?? null;
  const recs = useListDesignerRecordsQuery(match ? { id: match.type_id, limit: 200 } : { id: '' }, { skip: !match });
  if (ws.isLoading || recs.isLoading) return <p className="status-line">Loading records…</p>;
  if (ws.error || !match) return <p className="status-line">Bound type {JSON.stringify(props.binding.type)} is not published here.</p>;
  if (recs.error) return <p className="status-line">Records unavailable.</p>;
  return <RecordSelect records={recs.data?.records ?? []} binding={props.binding} value={props.value} disabled={props.disabled} id={props.id} onChange={props.onChange} />;
}
