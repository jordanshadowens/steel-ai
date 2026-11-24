import { useEffect, useState } from 'react';
import { matchesSeverity, runEntries, runtime, terminal, type Entry, type Run } from '../observability/cloud';
import { RunLogList, SeverityFilter, type MinimumSeverity } from '../observability/RunLogList';

export function RunnerLogs({ runId }: { runId: string }) {
  const [entries, setEntries] = useState<Entry[]>();
  const [live, setLive] = useState(false);
  const [severity, setSeverity] = useState<MinimumSeverity>('trace');
  const [search, setSearch] = useState('');
  const [following, setFollowing] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      let complete = false;
      try {
        const result = await runtime<{run: Run; logs?: Entry[]}>('/runs/' + encodeURIComponent(runId) + '?logs=1', request.signal);
        if (request.signal.aborted) return;
        complete = terminal(result.run.status);
        setLive(!complete);
        setEntries(runEntries(result.run, result.logs));
        setError(false);
      } catch {
        if (!request.signal.aborted) setError(true);
      } finally {
        if (!request.signal.aborted && !complete) timer = setTimeout(refresh, 1800);
      }
    }
    void refresh();
    return () => { request.abort(); clearTimeout(timer); };
  }, [runId, retry]);

  const query = search.trim().toLowerCase();
  const matches = entries?.filter(entry => matchesSeverity(entry, severity) && (
    !query || [entry.message, entry.completion, entry.result_excerpt, entry.step_id].some(value => value?.toLowerCase().includes(query))
  ));

  return <section className="section-card runner-logs" aria-label="Run log viewer">
    <div className="runner-detail-actions">
      <h2>Run logs {matches && <small>{matches.length} {matches.length === 1 ? 'entry' : 'entries'}</small>}</h2>
      <SeverityFilter value={severity} onChange={setSeverity} />
      {live && <label><input type="checkbox" checked={following} onChange={event => setFollowing(event.target.checked)} /> Follow logs</label>}
    </div>
    {error && <p role="status">Could not refresh logs. <button type="button" className="btn" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    {!entries && !error && <p role="status">Loading logs…</p>}
    {matches && <>
      <label className="runner-log-search">Search logs <input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <RunLogList entries={matches} following={live && following && !query} onLeaveTail={() => setFollowing(false)} />
    </>}
  </section>;
}
