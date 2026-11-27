import { useEffect, useState } from 'react';
import { useListRunsQuery, useListWorkflowsQuery } from '../api/steelApi';
import { runStatusLabel } from '../api/runStatus';
import { navigate, routeHref, routeSearch } from '../app/router';
import { AgentActivity, type AgentSelection } from './AgentActivity';
import { AgentLogs } from './AgentLogs';
import { AgentMetrics } from './AgentMetrics';
import { AgentEvaluations } from './AgentEvaluations';
import { ExecutionTimeline, Timestamp, title } from './ExecutionTimeline';
import { useRuntimeTimeline } from './runtimeTimeline';
import './cloud.css';

function WorkflowDetail({id, event}: {id: string; event?: string}) {
  const run = useRuntimeTimeline(id);
  const verification = run.events.filter(entry => entry.verification).sort((left, right) =>
    (right.time ?? '').localeCompare(left.time ?? '')).at(0)?.verification;
  return <div className="obs-execution">
    {run.run && <>
      <div className="obs-toolbar"><h3>{run.run.workflow_id}</h3>
        <a className="run-link" href={routeHref('runner', new URLSearchParams({run:id}))}>Open in Runner</a>
        <a className="run-link" href={routeHref('creator', new URLSearchParams({workflow:run.run.workflow_id,
          version:String(run.run.version)}))}>Inspect version in Creator</a></div>
      <div className="run-table-viewport">
        <table className="run-table" aria-label="Workflow run summary">
          <thead><tr>{['Run ID', 'Version', 'Started', 'Status', 'Outcome', 'Current step','Reported tokens in loaded events'].map(field => <th key={field} scope="col">{field}</th>)}</tr></thead>
          <tbody><tr><td><code>{id}</code></td><td>{run.run.version}</td><td><Timestamp value={run.run.created_at} /></td>
            <td>{runStatusLabel(run.run.status)}</td><td>{title(verification?.status ?? 'unverified')}</td>
            <td>{title(run.run.current_step ?? undefined)}</td><td>{run.reportedTokens?.toLocaleString() ?? 'Unavailable'}</td></tr></tbody>
        </table>
      </div>
    </>}
    <ExecutionTimeline events={run.events} loading={run.loading} failed={run.error} retry={run.retry}
      initialEvent={event ? 'runtime:' + event : undefined} />
    {run.canPage && <button type="button" className="run-link" disabled={run.paging} onClick={() => void run.loadMore()}>Load older Runtime events</button>}
  </div>;
}

function WorkflowRuns({selected, event, select}: {selected?: string; event?: string; select: (id: string) => void}) {
  const runQuery = useListRunsQuery(undefined, {pollingInterval:10000});
  const workflowQuery = useListWorkflowsQuery();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const names = new Map(workflowQuery.data?.workflows.map(workflow => [workflow.workflow_id, workflow.name || workflow.workflow_id]));
  const runs = [...(runQuery.data?.runs ?? [])].sort((left, right) =>
    (right.created_at ?? '').localeCompare(left.created_at ?? '') || left.run_id.localeCompare(right.run_id));
  const visible = runs.filter(run => (!status || run.status === status) &&
    [run.run_id, run.workflow_id, names.get(run.workflow_id)].some(value => value?.toLowerCase().includes(search.trim().toLowerCase())));
  return <section className="obs-execution" aria-label="Workflow runs">
    <div className="obs-toolbar"><h2>Workflow runs</h2>
      <label>Find a run<input value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>Status<select value={status} onChange={e => setStatus(e.target.value)}>
        <option value="">All statuses</option>{[...new Set(runs.map(run => run.status))].map(value =>
          <option key={value} value={value}>{runStatusLabel(value)}</option>)}</select></label>
    </div>
    <div className="run-table-viewport" role="region" aria-label="Workflow history" tabIndex={0}>
      <table className="run-table" aria-label="Workflow history">
        <thead><tr>{['Workflow', 'Run ID', 'Version', 'Started', 'Status'].map(field => <th key={field} scope="col">{field}</th>)}</tr></thead>
        <tbody>{visible.map(run => <tr key={run.run_id} data-selected={selected === run.run_id}>
          <th scope="row"><button type="button" className="run-row-button" aria-pressed={selected === run.run_id}
            onClick={() => select(run.run_id)}>{names.get(run.workflow_id) ?? run.workflow_id}</button></th>
          <td><code>{run.run_id}</code></td><td>{run.version}</td>
          <td><Timestamp value={run.created_at} /></td><td>{runStatusLabel(run.status)}</td></tr>)}
        {runQuery.isError ? <tr><td colSpan={5} role="alert">Could not load workflow runs. <button type="button" className="run-link"
          onClick={() => void runQuery.refetch()}>Retry</button></td></tr>
          : !visible.length && <tr><td colSpan={5}>{runQuery.isLoading ? 'Loading workflow runs…'
            : runs.length ? 'No matching workflow runs.' : 'No workspace runs yet.'}</td></tr>}</tbody>
      </table>
    </div>
    {selected && <WorkflowDetail key={selected} id={selected} event={event} />}
  </section>;
}

export function Observability() {
  const [search, setSearch] = useState(routeSearch);
  useEffect(() => {
    const update = () => setSearch(routeSearch());
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    return () => {window.removeEventListener('popstate', update); window.removeEventListener('hashchange', update);};
  }, []);
  const run = search.get('run') ?? undefined;
  const agent = search.get('agent');
  const selection: AgentSelection | undefined = agent ? {agentId:agent, runId:search.get('execution') ?? undefined} : undefined;
  const workflows = Boolean(run || search.get('view') === 'workflow-runs');
  const executions = Boolean(selection || search.get('view') === 'executions');
  const logs = search.get('view') === 'logs' && !workflows && !selection;
  const metrics = search.get('view') === 'metrics' && !workflows && !selection;
  const evaluations = search.get('view') === 'evaluations' && !workflows && !selection;
  function openWorkflow(id: string) {navigate('observability', new URLSearchParams({run:id}));}
  function openAgent(value: AgentSelection) {
    const query = new URLSearchParams({agent:value.agentId});
    if (value.runId) query.set('execution', value.runId);
    navigate('observability', query);
  }
  return <section id="observability" className="operations" aria-label="Observability">
    <nav className="obs-toolbar obs-nav" aria-label="Observability views">
      <button type="button" className="run-link" aria-pressed={!workflows && !executions && !logs && !metrics && !evaluations} onClick={() => navigate('observability')}>Agents</button>
      <button type="button" className="run-link" aria-pressed={!workflows && executions}
        onClick={() => {if (!executions || workflows) navigate('observability', new URLSearchParams({view:'executions'}));}}>Executions</button>
      <button type="button" className="run-link" aria-pressed={workflows}
        onClick={() => navigate('observability', new URLSearchParams({view:'workflow-runs'}))}>Workflow Runs</button>
      <button type="button" className="run-link" aria-pressed={logs}
        onClick={() => navigate('observability', new URLSearchParams({view:'logs'}))}>Logs</button>
      <button type="button" className="run-link" aria-pressed={metrics}
        onClick={() => navigate('observability', new URLSearchParams({view:'metrics'}))}>Metrics</button>
      <button type="button" className="run-link" aria-pressed={evaluations}
        onClick={() => navigate('observability', new URLSearchParams({view:'evaluations'}))}>Evaluations</button>
    </nav>
    {evaluations ? <AgentEvaluations openExecution={(agentId, runId) => openAgent({agentId, runId})} />
      : metrics ? <AgentMetrics /> : logs ? <AgentLogs openExecution={(agentId, runId) => openAgent({agentId, runId})} />
      : workflows ? <WorkflowRuns selected={run} event={search.get('event') ?? undefined} select={openWorkflow} />
      : <AgentActivity selected={selection} executions={executions} select={openAgent} openWorkflow={openWorkflow} />}
  </section>;
}
