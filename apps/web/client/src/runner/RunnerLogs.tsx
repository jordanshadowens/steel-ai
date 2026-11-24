import { useEffect, useState } from 'react';
import { matchesSeverity, runEntries, runtime, terminal, type Entry, type Run } from '../observability/cloud';
import { RunLogList, SeverityFilter, type MinimumSeverity } from '../observability/RunLogList';

export function RunnerLogs({ runId }: { runId: string }) {
  const [entries, setEntries] = useState<Entry[]>();
  const [severity, setSeverity] = useState<MinimumSeverity>('trace');
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

  return <section className="section-card runner-logs" aria-label="Run log viewer">
    <div className="runner-detail-actions">
      <h2>Run logs</h2>
      <SeverityFilter value={severity} onChange={setSeverity} />
      <label><input type="checkbox" checked={following} onChange={event => setFollowing(event.target.checked)} /> Follow logs</label>
    </div>
    {error && <p role="status">Could not refresh logs. <button type="button" className="btn" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    {!entries && !error && <p role="status">Loading logs…</p>}
    {entries && <RunLogList entries={entries.filter(entry => matchesSeverity(entry, severity))} following={following} />}
  </section>;
}
