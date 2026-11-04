import { useState } from 'react';
import { useListRunsQuery } from '../api/steelApi';

// Searchable run history. Selecting a run shows the persisted record — it
// never reruns the workflow and never regenerates documents.
export function HistoryPanel({ workflowId, selectedRunId, onSelect }: {
  workflowId: string;
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const history = useListRunsQuery(workflowId ? { workflow_id: workflowId } : undefined, { skip: !workflowId });
  const q = search.trim().toLowerCase();
  const runs = (history.data?.runs ?? []).filter(
    (r) => (!status || r.status === status) && (!q || r.run_id.toLowerCase().includes(q)),
  );

  if (!workflowId) return <p className="status-line">Select a workflow to see its history.</p>;
  return (
    <div>
      <div className="map-row">
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['sealed', 'failed', 'running', 'waiting_approval', 'waiting_skill_approval', 'pending_approval'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input type="search" aria-label="Search runs" placeholder="Search run id…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {history.isLoading && <p className="status-line">Loading runs…</p>}
      {history.isError && (
        <p className="status-line">
          <span className="status-bad">History failed to load. </span>
          <button type="button" className="btn" onClick={() => history.refetch()}>Retry</button>
        </p>
      )}
      <div className="list-card">
        {runs.map((r) => (
          <button
            key={r.run_id}
            type="button"
            className={selectedRunId === r.run_id ? 'list-row list-row-selected' : 'list-row'}
            onClick={() => onSelect(r.run_id)}
          >
            <span className="list-title num">{r.run_id.slice(0, 8)}</span>
            <span className="list-meta num">v{r.version} · {r.status}{r.created_at ? ` · ${new Date(r.created_at).toLocaleString()}` : ''}</span>
          </button>
        ))}
        {runs.length === 0 && !history.isLoading && !history.isError && (
          <div className="list-row"><span className="status-line">No runs match.</span></div>
        )}
      </div>
    </div>
  );
}
