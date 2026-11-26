import { useEffect, useState } from 'react';
import { duration, Timestamp, title } from './ExecutionTimeline';
import { runtime } from './cloud';
import { useListAgentRunsQuery } from './agentActivityApi';

type AgentAggregate = {
  agentId: string; name: string; unavailable?: boolean; partial?: boolean;
  terminal: number; succeeded: number; failed: number; cancelled: number;
  eligible: number; verifiedSuccess: number; verified: number; retried: number;
  tools: number; toolFailures: number; durationCount: number;
  average?: number; p50?: number; p95?: number; p99?: number;
};
type Report = {agents: AgentAggregate[]; start: string; end: string};
const ratio = (count: number, total: number) => total ? `${(100 * count / total).toFixed(1)}% (${count}/${total})` : 'Unavailable';

export function AgentMetrics() {
  const {currentData} = useListAgentRunsQuery(undefined, {pollingInterval:60000});
  const alerts = currentData?.agents.flatMap(agent => (agent.alerts ?? []).map(alert => ({...alert, agent:agent.name}))) ?? [];
  const [hours, setHours] = useState('6');
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [compare, setCompare] = useState(false);
  const [previous, setPrevious] = useState<Report>();
  useEffect(() => {
    const controller = new AbortController();
    setReport(undefined);
    setPrevious(undefined);
    setError(false);
    void runtime<Report>('/observability/agent-runs/metrics?hours=' + hours, controller.signal).then(result => {
      if (!controller.signal.aborted) setReport(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    if (compare) void runtime<Report>('/observability/agent-runs/metrics?period=previous&hours=' + hours, controller.signal)
      .then(result => {if (!controller.signal.aborted) setPrevious(result);}).catch(() => {});
    return () => controller.abort();
  }, [hours, refresh, compare]);
  return <section className="obs-execution" aria-label="Agent metrics">
    <div className="obs-toolbar"><h2>Metrics</h2>
      <label>Window<select value={hours} onChange={event => setHours(event.target.value)}>
        {[1,6,24].map(value => <option key={value} value={value}>{value} {value === 1 ? 'hour' : 'hours'}</option>)}
      </select></label>
      <label><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)} /> Compare prior window</label>
      <button type="button" className="run-link" onClick={() => setRefresh(value => value + 1)}>Refresh</button>
    </div>
    {alerts.length > 0 && <div className="run-table-viewport" role="region" aria-label="Operational alerts" tabIndex={0}>
      <table className="run-table" aria-label="Operational alerts">
        <thead><tr>{['Agent','Alert','Severity','Execution','Observed','Count'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{alerts.map(alert => <tr key={alert.agent + '/' + alert.code}>
          <th scope="row">{alert.agent}</th><td>{title(alert.code)}</td><td>{title(alert.severity)}</td>
          <td>{alert.executionId ?? 'Not recorded'}</td><td><Timestamp value={alert.at} /></td><td>{alert.count ?? 'Not recorded'}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <p className="obs-note">Terminal executions with structured telemetry. Rates show their numerator and denominator.</p>
    <div className="run-table-viewport" role="region" aria-label="Agent execution metrics" tabIndex={0}>
      <table className="run-table" aria-label="Agent execution metrics">
        {report && <caption><Timestamp value={report.start} /> to <Timestamp value={report.end} /></caption>}
        <thead><tr>{['Agent','Coverage','Executions','Completed','Failed','Cancelled','Technical success',
          'Verified success','Verification coverage','Retried','Tool failures','Average','P50','P95','P99'].map(label =>
          <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{report?.agents.map(item => <tr key={item.agentId}>
          <th scope="row">{item.name}</th>
          {item.unavailable ? <td colSpan={14}>Log source unavailable</td> : <>
            <td>{item.partial ? 'Partial sample' : 'Recorded telemetry'}</td>
            <td>{item.terminal}</td><td>{item.succeeded}</td><td>{item.failed}</td><td>{item.cancelled}</td>
            <td>{ratio(item.succeeded,item.terminal)}</td><td>{ratio(item.verifiedSuccess,item.eligible)}</td>
            <td>{ratio(item.verified,item.eligible)}</td><td>{ratio(item.retried,item.terminal)}</td>
            <td>{ratio(item.toolFailures,item.tools)}</td>
            <td>{duration(item.average)}{item.durationCount ? ` (${item.durationCount} measured)` : ''}</td>
            <td>{duration(item.p50)}</td><td>{duration(item.p95)}</td><td>{duration(item.p99)}</td>
          </>}
        </tr>)}
        {!report?.agents.length && <tr><td colSpan={15} role={error ? 'alert' : 'status'}>
          {error ? 'Could not read metrics.' : report ? 'No monitored agents.' : 'Loading metrics…'}</td></tr>}
        </tbody>
      </table>
    </div>
    {compare && <div className="run-table-viewport" role="region" aria-label="Prior window comparison" tabIndex={0}>
      <table className="run-table" aria-label="Prior window comparison">
        {previous && <caption><Timestamp value={previous.start} /> to <Timestamp value={previous.end} /></caption>}
        <thead><tr>{['Agent','Previous recorded runs','Current recorded runs','Previous verified success',
          'Current verified success','Previous P95','Current P95'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{report?.agents.map(current => {
          const prior = previous?.agents.find(item => item.agentId === current.agentId);
          const a = prior && !prior.unavailable ? prior : undefined;
          const b = current.unavailable ? undefined : current;
          return <tr key={current.agentId}><th scope="row">{current.name}</th>
            <td>{a ? a.terminal + (a.partial ? ' (partial)' : '') : 'Unavailable'}</td>
            <td>{b ? b.terminal + (b.partial ? ' (partial)' : '') : 'Unavailable'}</td>
            <td>{a ? ratio(a.verifiedSuccess,a.eligible) : 'Unavailable'}</td>
            <td>{b ? ratio(b.verifiedSuccess,b.eligible) : 'Unavailable'}</td>
            <td>{duration(a?.p95)}</td><td>{duration(b?.p95)}</td></tr>;
        })}</tbody>
      </table>
    </div>}
  </section>;
}
