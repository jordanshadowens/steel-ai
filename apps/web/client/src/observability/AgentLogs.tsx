import { useEffect, useState } from 'react';
import { checkpointEvent, ExecutionTimeline } from './ExecutionTimeline';
import { runtime } from './cloud';
import { useListAgentRunsQuery, type Checkpoint } from './agentActivityApi';

type Page = {steps: Checkpoint[]; nextPageToken?: string};
const fields = [
  ['execution', 'Execution ID'], ['resource', 'Resource'], ['version', 'Workflow or agent version'],
  ['status', 'Step status'], ['outcome', 'Verification outcome'],
] as const;

export function AgentLogs({openExecution}: {openExecution: (agent: string, execution: string) => void}) {
  const {currentData, isError} = useListAgentRunsQuery();
  const [filter, setFilter] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [page, setPage] = useState<Page>();
  const [prior, setPrior] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const agent = new URLSearchParams(filter).get('agent');

  useEffect(() => {
    if (!filter) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const query = new URLSearchParams(filter);
    if (cursor) query.set('pageToken', cursor);
    void runtime<Page>('/observability/agent-runs/logs?' + query, controller.signal).then(result => {
      if (!controller.signal.aborted) setPage(result);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load logs.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [filter, cursor, attempt]);

  const entries = [...prior, ...(page?.steps ?? [])];
  return <section className="obs-execution" aria-label="Agent logs">
    <h2>Logs</h2>
    <form className="obs-toolbar" onSubmit={event => {
      event.preventDefault();
      const query = new URLSearchParams();
      for (const [key, value] of new FormData(event.currentTarget)) {
        const text = String(value).trim();
        if (text) query.set(key, key === 'from' || key === 'to' ? new Date(text).toISOString() : text);
      }
      setCursor(undefined);
      setPage(undefined);
      setPrior([]);
      setFilter(query.toString());
      setAttempt(value => value + 1);
    }}>
      <label>Agent<select name="agent" required>
        <option value="">Select an agent</option>
        {currentData?.agents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {fields.map(([key, label]) => <label key={key}>{label}<input name={key} /></label>)}
      <label>Severity<select name="severity"><option value="">All severities</option>
        {['DEFAULT','DEBUG','INFO','NOTICE','WARNING','ERROR','CRITICAL','ALERT','EMERGENCY'].map(value =>
          <option key={value}>{value}</option>)}</select></label>
      <label>From<input type="datetime-local" name="from" /></label>
      <label>To<input type="datetime-local" name="to" /></label>
      <button className="run-link" type="submit" disabled={loading}>Search logs</button>
    </form>
    {isError && <p role="alert">Could not load monitored agents.</p>}
    {error && <p role="alert">{error} <button type="button" className="run-link" onClick={() => setAttempt(n => n + 1)}>Retry</button></p>}
    {filter && <ExecutionTimeline events={entries.map(checkpointEvent)} loading={loading} failed={Boolean(error)}
      openExecution={agent ? id => openExecution(agent, id) : undefined} />}
    {page?.nextPageToken && <button type="button" className="run-link" disabled={loading} onClick={() => {
      setPrior(items => [...items, ...page.steps]);
      setCursor(page.nextPageToken);
      setPage(undefined);
    }}>Load older events</button>}
  </section>;
}
