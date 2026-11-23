import { navigate, routeHref, routeSearch } from '../app/router';
import { lazy, Suspense, useEffect, useState } from 'react';
import demoDefinition from '../creator/metaRadarExample.json';
import demoCapture from './metaRadarCapture.json';
import './cloud.css';
import {
  activeStep,
  runEntries,
  runtime,
  terminal,
  type Definition,
  type Entry,
  type Run,
} from './cloud';

const WorkflowMap = lazy(() => import('./WorkflowMap'));

type RunDetail = { run: Run; logs?: Entry[] };
type Version = { version: number; definition: Definition };
const demoId = 'meta-briefing-example';
const demoRun: RunDetail = {
  run: { run_id: demoId, workflow_id: demoDefinition.workflow_id, version: 1, status: 'sealed' },
  logs: demoCapture.logs as Entry[],
};
export function Observability() {
  const initialRun = routeSearch().get('run') || '';
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, select] = useState(initialRun);
  const [detail, setDetail] = useState<RunDetail>();
  const [definition, setDefinition] = useState<Definition>();
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [listLoaded, setListLoaded] = useState(false);
  const [mapError, setMapError] = useState('');
  const [filter, setFilter] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [runFilter, setRunFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [linkStatus, setLinkStatus] = useState('');
  const [oldestFirst, setOldestFirst] = useState(false);
  const visibleRuns = runs.filter(run => {
    const search = runFilter.trim().toLowerCase();
    return (statusFilter === 'all' || run.status === statusFilter) &&
      (run.workflow_id.toLowerCase().includes(search) || run.run_id.toLowerCase().includes(search));
  });

  function chooseRun(id: string) {
    setLinkStatus('');
    select(id);
    history.replaceState(history.state, '', routeHref('observability', new URLSearchParams({run: id})));
  }

  useEffect(() => {
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await runtime<{ runs: Run[] }>(
          '/runs',
          request.signal,
        );
        if (request.signal.aborted) return;
        setRuns(result.runs);
        setListLoaded(true);
        setListError('');
        select((id) => id || result.runs[0]?.run_id || demoId);
      } catch (cause) {
        if (!request.signal.aborted)
          setListError(
            cause instanceof Error ? cause.message : 'Could not load runs',
          );
      } finally {
        if (!request.signal.aborted) timer = setTimeout(refresh, 4000);
      }
    }
    void refresh();
    return () => {
      request.abort();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!selected || selected === demoId) return;
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let versionLoaded = false;
    setDefinition(undefined);
    setError('');
    setMapError('');
    async function refresh() {
      let finished = false;
      try {
        const result = await runtime<RunDetail>(
          '/runs/' + encodeURIComponent(selected) + '?logs=1',
          request.signal,
        );
        if (request.signal.aborted) return;
        setDetail(result);
        setError('');
        finished = terminal(result.run.status);
        if (!versionLoaded) {
          try {
            const workflowPath =
              '/workflows/' + encodeURIComponent(result.run.workflow_id);
            const query = new URLSearchParams({
              version: String(result.run.version),
              include_deleted: '1',
            });
            const versions = await runtime<{ versions: Version[] }>(
              workflowPath + '?' + query,
              request.signal,
            );
            if (request.signal.aborted) return;
            const version = versions.versions.find(
              (item) => item.version === result.run.version,
            );
            setDefinition(version?.definition);
            setMapError(version ? '' : 'This workflow version is unavailable.');
            versionLoaded = true;
          } catch {
            if (!request.signal.aborted)
              setMapError('Could not load the workflow definition. Retrying…');
          }
        }
      } catch (cause) {
        if (!request.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : 'Could not load run',
          );
      } finally {
        if (!request.signal.aborted && (!finished || !versionLoaded))
          timer = setTimeout(refresh, 1800);
      }
    }
    void refresh();
    return () => {
      request.abort();
      clearTimeout(timer);
    };
  }, [selected]);

  const demo = selected === demoId;
  const displayed = demo ? demoRun : detail?.run.run_id === selected ? detail : undefined;
  const [logSelection, setLogSelection] = useState<{ runId: string; step: string }>();
  const run = displayed?.run;
  const displayedDefinition = demo ? demoDefinition : definition;
  const logStep = logSelection?.runId === run?.run_id ? logSelection?.step : undefined;
  const active = run && activeStep(run);
  const logs = run
    ? runEntries(run, displayed?.logs).filter(
        (entry) =>
          (!logStep || entry.step_id === logStep) &&
          (!errorsOnly || entry.level === 'error') &&
          entry.message.toLowerCase().includes(filter.trim().toLowerCase()),
      )
    : [];

  return (
    <section id="observability" className="operations">
      <div className="operations-heading">
        <div>
          <h1 id="observability-title" tabIndex={-1}>
            Observability
          </h1>
        </div>
      </div>
        <div className="operations-grid">
          <aside aria-label="Recent runs">
            <h2>Recent runs</h2>
            <label>Find a run<input value={runFilter} placeholder="Workflow or run ID" onChange={event => setRunFilter(event.target.value)} /></label>
            <label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {[...new Set(runs.map(item => item.status))].sort().map(status => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
            </select></label>
            {runs.length > 0 && visibleRuns.length === 0 && <p>No matching runs.</p>}
            <div className="run-list">
            {visibleRuns.map((item) => (
              <button
                key={item.run_id}
                onClick={() => chooseRun(item.run_id)}
                aria-pressed={item.run_id === selected}
              >
                <strong>{item.workflow_id}</strong>
                <small>
                  {item.run_id.slice(0, 8)} · v{item.version} ·{' '}
                  {item.status.replaceAll('_', ' ')}
                </small>
              </button>
            ))}
            </div>
            {listError && <p role="status">{listError}</p>}
            {!listLoaded && !listError && <p role="status">Loading runs…</p>}
            {listLoaded && !runs.length && !listError && (
              <p>No recent runs. Start a published workflow in the Creator.</p>
            )}
            <button type="button" aria-pressed={demo} onClick={() => chooseRun(demoId)}>
              <strong>Meta briefing example</strong>
              <small>Recorded run</small>
            </button>
          </aside>
          <div className="operations-detail">
            {!demo && error && <p role="status">{error}</p>}
            {selected && !run && !error && <p role="status">Loading run…</p>}
            {run && (
              <>
                <div className="run-heading">
                  <h2>
                    {run.workflow_id} <small>v{run.version}</small>
                  </h2>
                  <span className="run-status" role="status" data-state={run.status}>
                    {run.status.replaceAll('_', ' ')}
                    {run.current_step ? ' · ' + run.current_step : ''}
                  </span>
                </div>
                <div className="run-meta">
                  <p className="run-id">{demo ? 'Recorded with Meta using a sample maintenance update' : run.run_id}</p>
                  <button type="button" className="run-link" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(new URL(routeHref('observability', new URLSearchParams({run: run.run_id})), location.href).href);
                      setLinkStatus('Run link copied.');
                    } catch { setLinkStatus('Could not copy the run link.'); }
                  }}>Copy run link</button>
                  {linkStatus && <span role="status">{linkStatus}</span>}
                </div>
                <div className="run-map-heading">
                  <h3>Workflow map</h3>
                  {!demo && <a href={routeHref('creator', new URLSearchParams({workflow: run.workflow_id, version: String(run.version)}))} onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    navigate('creator', new URLSearchParams({workflow: run.workflow_id, version: String(run.version)}));
                  }}>Inspect version in Creator</a>}
                  {!demo && <a href={routeHref('runner', new URLSearchParams({run: run.run_id}))} onClick={(event) => {
                    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    navigate('runner', new URLSearchParams({run: run.run_id}));
                  }}>Open run details</a>}
                </div>
                {!demo && mapError && <p role="status">{mapError}</p>}
                {displayedDefinition && (
                  <Suspense
                    fallback={<p role="status">Loading workflow map…</p>}
                  >
                    <WorkflowMap
                      key={run.run_id}
                      definition={displayedDefinition}
                      current={run.current_step}
                      active={active}
                      runId={run.run_id}
                      events={displayed.logs}
                      selected={logStep}
                      onSelect={step => setLogSelection(step ? { runId: run.run_id, step } : undefined)}
                    />
                  </Suspense>
                )}
                {displayed.logs === undefined && (
                  <p>
                    Tool logs are unavailable on this runtime. Showing run
                    status.
                  </p>
                )}
                <div className="log-heading">
                  <h3>Run logs <small>{logs.length} {logs.length === 1 ? 'entry' : 'entries'}</small></h3>
                  {logStep && <button type="button" className="run-link" onClick={() => setLogSelection(undefined)}>Show all steps</button>}
                  <label>Order <select value={oldestFirst ? 'oldest' : 'newest'} onChange={event => setOldestFirst(event.target.value === 'oldest')}>
                    <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
                  </select></label>
                  <label>
                    Filter logs{' '}
                    <input
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={errorsOnly}
                      onChange={(event) => setErrorsOnly(event.target.checked)}
                    />{' '}
                    Errors only
                  </label>
                </div>
                <ul className="run-logs" aria-label="Run logs">
                  {(oldestFirst ? logs : [...logs].reverse()).map((entry) => (
                    <li key={entry.id}>
                      <time dateTime={entry.at}>
                        {entry.at
                          ? new Date(entry.at).toLocaleTimeString()
                          : '—'}
                      </time>
                      <span data-level={entry.level}>{entry.level}</span>
                      <span>{entry.kind === 'provider' && <strong>Provider · </strong>}{entry.message}</span>
                    </li>
                  ))}
                  {!logs.length && <li>No matching log entries.</li>}
                </ul>
              </>
            )}
          </div>
        </div>
    </section>
  );
}
