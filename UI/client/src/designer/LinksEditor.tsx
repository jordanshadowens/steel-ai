import { useState } from 'react';
import type { DesignerRelationship, DesignerTypeRow } from '../api/contracts';
import { useAddDesignerLinkMutation, useGetDesignerRecordQuery, useListDesignerRecordsQuery, useRemoveDesignerLinkMutation } from '../api/steelApi';
import { apiMessage } from './valueInputs';

export interface LinksEditorProps {
  recordId: string;
  relationships: DesignerRelationship[];
  types: DesignerTypeRow[];
}

// Links for one record: out-links with remove, plus an add form whose
// target picker loads the peer type's records once a relationship is set.
export function LinksEditor(props: LinksEditorProps) {
  const [relId, setRelId] = useState('');
  const [dst, setDst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const detail = useGetDesignerRecordQuery({ record_id: props.recordId, links: 'out' });
  const rel = props.relationships.find((r) => r.rel_id === relId) ?? null;
  const peers = useListDesignerRecordsQuery(rel ? { id: rel.dst_type } : { id: '' }, { skip: !rel });
  const [addLink, adding] = useAddDesignerLinkMutation();
  const [removeLink, removing] = useRemoveDesignerLinkMutation();
  const peerName = (id: string): string => props.types.find((t) => t.type_id === id)?.name ?? id;

  const submit = async () => {
    if (!relId || !dst) {
      setError('pick a relationship and a target record');
      return;
    }
    try {
      await addLink({ rel_id: relId, src_record: props.recordId, dst_record: dst }).unwrap();
      setDst('');
      setError(null);
    } catch (e) {
      setError(apiMessage(e));
    }
  };

  return (
    <div className="panel-card">
      <h3>Links</h3>
      {(detail.data?.record.links ?? []).length === 0 && <p className="status-line">No out-links.</p>}
      <ul>
        {(detail.data?.record.links ?? []).map((l) => (
          <li key={l.link_id}>
            <code>{l.rel}</code> → <code>{l.dst_record.slice(0, 12)}…</code>{' '}
            <button
              type="button"
              className="btn btn-filter"
              disabled={removing.isLoading}
              onClick={() => removeLink({ link_id: l.link_id }).unwrap().then(() => setError(null)).catch((e: unknown) => setError(apiMessage(e)))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {props.relationships.length > 0 && (
        <div className="toolbar">
          <label className="status-line">
            Relationship{' '}
            <select aria-label="Relationship" value={relId} onChange={(e) => { setRelId(e.target.value); setDst(''); }} disabled={adding.isLoading}>
              <option value="">— pick —</option>
              {props.relationships.map((r) => (
                <option key={r.rel_id} value={r.rel_id}>
                  {r.name} → {peerName(r.dst_type)} ({r.cardinality})
                </option>
              ))}
            </select>
          </label>
          <label className="status-line">
            Target{' '}
            <select aria-label="Target record" value={dst} onChange={(e) => setDst(e.target.value)} disabled={adding.isLoading || !rel || peers.isLoading}>
              <option value="">— pick —</option>
              {(peers.data?.records ?? []).map((r) => (
                <option key={r.record_id} value={r.record_id}>
                  {Object.values(r.values)[0] !== undefined ? String(Object.values(r.values)[0]).slice(0, 40) : r.record_id.slice(0, 12)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" disabled={adding.isLoading} onClick={submit}>
            Add link
          </button>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
