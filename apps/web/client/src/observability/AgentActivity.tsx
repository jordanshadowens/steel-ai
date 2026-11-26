import { useEffect, useState } from 'react';
import { routeHref } from '../app/router';
import { checkpointEvent, duration, ExecutionTimeline, Timestamp, title } from './ExecutionTimeline';
import { type AgentRun, type HistorySearch, type MonitoredAgent, useGetAgentStepsQuery, useListAgentRunsQuery } from './agentActivityApi';
import { useRuntimeTimeline } from './runtimeTimeline';

export type AgentSelection = {agentId: string; runId?: string};

function statusLabel(status?: string) {
  if (status === 'started') return 'Running';
  if (status === 'succeeded') return 'Completed';
  return status ? title(status) : 'Unknown';
}

const historyStatuses = ['started','waiting','retrying','succeeded','failed','cancelled','observed'];
const historyOutcomes = ['verified_success','verified_failure','partially_successful','unverified','verification_unavailable','not_applicable'];

function versionLabel(run: AgentRun) {
  const workflow = run.workflowVersion && 'Workflow v' + run.workflowVersion;
  const parts = [...new Set([workflow, run.version].filter(Boolean))];
  return parts.length ? parts.join(' · ') : 'Not recorded';
}

function operationalState(agent: MonitoredAgent, run?: AgentRun) {
  if (agent.sourceAvailable === false) return 'Unknown';
  if (agent.reliability === 'heartbeat_expired') return 'Stalled';
  if (agent.reliability === 'execution_timed_out') return 'Failed';
  if (run?.status === 'started')
    return run.heartbeatAware && Date.now() - Date.parse(run.timestamp) <= (agent.heartbeatExpirySeconds ?? 60) * 1000 ? 'Running' : 'Unknown';
  if (run?.status === 'waiting' || run?.status === 'retrying') return statusLabel(run.status);
  if (agent.schedule?.state === 'PAUSED' || agent.schedule?.state === 'DISABLED') return 'Disabled';
  if (run?.status === 'failed') return 'Failed';
  if (run?.verification?.status === 'partially_successful') return 'Degraded';
  return run?.status === 'succeeded' ? 'Idle' : 'Unknown';
}

function rate(count: number, total: number) {
  return total ? Math.round(count * 100 / total) + '% (' + count + '/' + total + ')' : 'Unavailable';
}

function AgentOverview({agents, loading, failed, retry, select}: {
  agents: MonitoredAgent[]; loading: boolean; failed: boolean; retry: () => void; select: (value: AgentSelection) => void;
}) {
  return <div className="run-table-viewport" role="region" aria-label="Monitored agents" tabIndex={0}>
    <table className="run-table" aria-label="Agent overview">
      <thead><tr>{['Agent', 'Status', 'Current Activity', 'Last Execution', 'Next Execution', 'Duration',
        'Success Rate', 'Verified Outcome Rate', 'Health'].map(field => <th key={field} scope="col">{field}</th>)}</tr></thead>
      <tbody>{agents.map(agent => {
        const run = agent.runs[0];
        const recent = agent.runs.slice(0, 10);
        const terminal = recent.filter(item => ['succeeded', 'failed', 'cancelled'].includes(item.status));
        const eligible = terminal.filter(item => item.verification?.status !== 'not_applicable');
        const state = operationalState(agent, run);
        const health = agent.sourceAvailable === false ? 'Log source unavailable'
          : agent.reliability ? ({
            schedule_overdue:'Scheduler attempt overdue', execution_timed_out:'Execution timed out',
            heartbeat_expired:'Active execution heartbeat expired',
          })[agent.reliability]
          : !run ? 'No recent executions'
          : state === 'Failed' || state === 'Degraded' ? state
          : run.verification?.status === 'verified_success' ? 'Verified check passed' : 'Unknown';
        return <tr key={agent.id}>
          <th scope="row"><button type="button" className="run-row-button" onClick={() => select({agentId:agent.id, runId:run?.id})}>{agent.name}</button></th>
          <td>{state}</td><td>{run?.latestStep ? title(run.latestStep) : 'Not recorded'}</td>
          <td><Timestamp value={run?.started ?? run?.timestamp} /></td>
          <td>{agent.id === 'incident-triage' ? 'On alert' : state === 'Disabled' ? 'Disabled'
            : agent.schedule ? <Timestamp value={agent.schedule.next} /> : 'Schedule unavailable'}</td>
          <td>{duration(run?.duration)}</td>
          <td>{rate(terminal.filter(item => item.status === 'succeeded').length, terminal.length)}</td>
          <td>{eligible.some(item => item.verification)
            ? rate(eligible.filter(item => item.verification?.status === 'verified_success').length, eligible.length) : 'Unavailable'}</td><td>{health}</td>
        </tr>;
      })}
      {failed && <tr><td colSpan={9} role="alert">Could not refresh agent executions. <button type="button" className="run-link" onClick={retry}>Retry agents</button></td></tr>}
      {!agents.length && !failed && <tr><td colSpan={9}>{loading ? 'Loading monitored agents…' : 'No monitored agents for this workspace.'}</td></tr>}</tbody>
    </table>
  </div>;
}

function AgentTimeline({agentId, runId, workflowRunId, live, openWorkflow}: {
  agentId: string; runId: string; workflowRunId?: string; live: boolean; openWorkflow: (id: string) => void;
}) {
  const query = useGetAgentStepsQuery({agentId, runId, latest:true}, {pollingInterval: live ? 10000 : 0});
  const [pageToken, setPageToken] = useState<string>();
  const [prior, setPrior] = useState<NonNullable<typeof query.currentData>['steps']>([]);
  const [observed, setObserved] = useState<NonNullable<typeof query.currentData>['steps']>([]);
  const fresh = query.currentData?.steps;
  useEffect(() => {
    if (fresh) setObserved(previous => {
      const next = [...new Map([...previous, ...fresh].map(step => [step.id, step])).values()]
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.id.localeCompare(right.id)).slice(0, 200);
      return next.length === previous.length && next.every((step, index) => step.id === previous[index].id) ? previous : next;
    });
  }, [fresh]);
  const page = useGetAgentStepsQuery({agentId, runId, pageToken, latest:true}, {skip: !pageToken});
  const linked = workflowRunId ?? query.currentData?.workflowRunId;
  const workflow = useRuntimeTimeline(linked);
  const current = pageToken ? page : query;
  const steps = [...observed, ...prior, ...(pageToken ? page.currentData?.steps ?? [] : []), ...(fresh ?? [])];
  const next = current.currentData?.nextPageToken;
  return <>
    {linked && <a className="run-link" href={routeHref('observability', new URLSearchParams({run:linked}))} onClick={event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openWorkflow(linked);
    }}>Open Steel workflow run</a>}
    <ExecutionTimeline events={[...steps.map(checkpointEvent), ...workflow.events]}
      loading={(query.isFetching && !query.currentData) || workflow.loading}
      failed={current.isError || workflow.error} retry={() => {void current.refetch(); if (workflow.error) workflow.retry();}} />
    <div className="obs-toolbar">
      {next && <button type="button" className="run-link" onClick={() => {
        if (pageToken) setPrior(value => [...value, ...(page.currentData?.steps ?? [])]);
        setPageToken(next);
      }}>Load more steps</button>}
      {workflow.canPage && <button type="button" className="run-link" disabled={workflow.paging} onClick={() => void workflow.loadMore()}>Load older Runtime events</button>}
    </div>
  </>;
}

function AgentExecutions({agent, selected, select, openWorkflow}: {
  agent: MonitoredAgent; selected: AgentSelection; select: (value: AgentSelection) => void; openWorkflow: (id: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('');
  const [outcome, setOutcome] = useState('');
  const [version, setVersion] = useState('');
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');
  const [search, setSearch] = useState<HistorySearch>();
  const [compareId, setCompareId] = useState('');
  const [pageToken, setPageToken] = useState<string>();
  const [prior, setPrior] = useState<AgentRun[]>([]);
  const remote = Boolean(pageToken || search);
  const page = useListAgentRunsQuery(remote ? {agent: agent.id, ...search, pageToken} : undefined, {skip: !remote});
  const extra = remote ? page.currentData?.agents.find(item => item.id === agent.id) : undefined;
  const runs = [...new Map([...(extra?.runs ?? []), ...prior, ...(search ? [] : agent.runs)].map(run => [run.id, run])).values()]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.id.localeCompare(right.id));
  const runId = selected.runId ?? runs[0]?.id;
  const run = runs.find(item => item.id === runId) ?? agent.runs.find(item => item.id === runId);
  const compare = compareId === runId ? undefined : runs.find(item => item.id === compareId);
  const next = remote ? extra?.nextPageToken : agent.nextPageToken;
  const sourceUnavailable = remote ? extra?.sourceAvailable === false : agent.sourceAvailable === false;
  return <section aria-label={agent.name + ' executions'} className="obs-execution">
    <h2>{agent.name} executions</h2>
    <form className="obs-toolbar" onSubmit={event => {
      event.preventDefault();
      setPrior([]);
      setPageToken(undefined);
      setSearch(filter.trim() || status || outcome || version.trim() || from || through ? {
        execution:filter.trim() || undefined, status:status || undefined, outcome:outcome || undefined,
        version:version.trim() || undefined, from:from ? new Date(from + 'T00:00:00').toISOString() : undefined,
        to:through ? new Date(through + 'T23:59:59.999').toISOString() : undefined,
      } : undefined);
    }}>
      <label>Execution ID<input maxLength={256} value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <label>Status<select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">All statuses</option>{historyStatuses.map(value =>
          <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
      <label>Outcome<select value={outcome} onChange={event => setOutcome(event.target.value)}>
        <option value="">All outcomes</option>{historyOutcomes.map(value =>
          <option key={value} value={value}>{title(value)}</option>)}</select></label>
      <label>Version<input maxLength={120} value={version} onChange={event => setVersion(event.target.value)} /></label>
      <label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>Through<input type="date" value={through} min={from || undefined} onChange={event => setThrough(event.target.value)} /></label>
      <button type="submit" className="run-link">Search executions</button>
    </form>
    <div className="run-table-viewport" role="region" aria-label="Execution history" tabIndex={0}>
      <table className="run-table" aria-label="Execution history">
        <thead><tr>{['Execution ID', 'Trigger', 'Started', 'Finished', 'Duration', 'Status', 'Outcome', 'Summary', 'Version'].map(field =>
          <th key={field} scope="col">{field}</th>)}</tr></thead>
        <tbody>{runs.map(item =>
          <tr key={item.id} data-selected={item.id === runId}><th scope="row">
            <button className="run-row-button" type="button" aria-pressed={item.id === runId}
              onClick={() => select({agentId:agent.id, runId:item.id})}>{item.id}</button></th>
            <td>{item.trigger ?? 'Not recorded'}</td><td><Timestamp value={item.started} /></td><td><Timestamp value={item.finished} /></td>
            <td>{duration(item.duration)}</td><td>{statusLabel(item.status)}</td><td>{title(item.verification?.status)}</td>
            <td>{item.summary ?? 'Not recorded'}</td><td>{versionLabel(item)}</td></tr>)}
        {sourceUnavailable ? <tr><td colSpan={9}>Log source unavailable.</td></tr>
          : !runs.length && !page.isError && <tr><td colSpan={9}>
            {remote && page.isFetching ? 'Searching execution history…' : search ? 'No matching executions on this page.' : 'No recent executions.'}
          </td></tr>}
        {remote && page.isError && <tr><td colSpan={9}>Could not read execution history.
          <button className="run-link" type="button" onClick={() => void page.refetch()}>Retry history</button></td></tr>}</tbody>
      </table>
    </div>
    {next && <button type="button" className="run-link" disabled={page.isFetching} onClick={() => {
      setPrior(value => [...value, ...(extra?.runs ?? [])]);
      setPageToken(next);
    }}>Load more executions</button>}
    {run && runs.length > 1 && <div className="obs-toolbar"><label>Compare with<select value={compare?.id ?? ''}
      onChange={event => setCompareId(event.target.value)}>
      <option value="">Select an execution</option>{runs.filter(item => item.id !== run.id).map(item =>
        <option key={item.id} value={item.id}>{item.id}</option>)}</select></label></div>}
    {run && compare && <div className="run-table-viewport" role="region" aria-label="Execution comparison" tabIndex={0}>
      <table className="run-table" aria-label="Execution comparison">
        <thead><tr><th scope="col">Field</th><th scope="col">{run.id}</th><th scope="col">{compare.id}</th></tr></thead>
        <tbody>
          <tr><th scope="row">Started</th><td><Timestamp value={run.started} /></td><td><Timestamp value={compare.started} /></td></tr>
          <tr><th scope="row">Status</th><td>{statusLabel(run.status)}</td><td>{statusLabel(compare.status)}</td></tr>
          <tr><th scope="row">Outcome</th><td>{title(run.verification?.status)}</td><td>{title(compare.verification?.status)}</td></tr>
          <tr><th scope="row">Duration</th><td>{duration(run.duration)}</td><td>{duration(compare.duration)}</td></tr>
          <tr><th scope="row">Version</th><td>{versionLabel(run)}</td><td>{versionLabel(compare)}</td></tr>
          <tr><th scope="row">Summary</th><td>{run.summary ?? 'Not recorded'}</td><td>{compare.summary ?? 'Not recorded'}</td></tr>
        </tbody>
      </table>
    </div>}
    {runId && <AgentTimeline key={runId} agentId={agent.id} runId={runId} workflowRunId={run?.workflowRunId}
      live={!run || ['started','waiting','retrying'].includes(run.status)} openWorkflow={openWorkflow} />}
  </section>;
}

export function AgentActivity({selected, executions, select, openWorkflow}: {
  selected?: AgentSelection; executions?: boolean;
  select: (selection: AgentSelection) => void; openWorkflow: (id: string) => void;
}) {
  const {currentData, isFetching, isError, refetch} = useListAgentRunsQuery(undefined, {pollingInterval: 30000});
  const agents = currentData?.agents ?? [];
  const latest = executions && !selected ? [...agents].sort((left, right) =>
    (right.runs[0]?.timestamp ?? '').localeCompare(left.runs[0]?.timestamp ?? ''))[0] : undefined;
  const agent = selected ? agents.find(item => item.id === selected.agentId) : latest;
  const selection = selected ?? (agent ? {agentId:agent.id} : undefined);
  return <section className="obs-execution" aria-label="Agent executions">
    {agent && selection ? <>
      <div className="obs-toolbar"><label>Agent<select value={agent.id} onChange={event => {
        const next = agents.find(item => item.id === event.target.value);
        if (next) select({agentId:next.id, runId:next.runs[0]?.id});
      }}>{agents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      <AgentExecutions key={agent.id} agent={agent} selected={selection} select={select} openWorkflow={openWorkflow} />
    </>
      : <>
        <h2>Agents</h2>
        <p className="obs-note">Rates use up to 10 recent executions per agent within seven days.</p>
        <AgentOverview agents={agents} loading={isFetching} failed={isError} retry={refetch} select={select} />
      </>}
  </section>;
}
