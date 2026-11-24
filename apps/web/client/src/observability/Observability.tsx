import { navigate, routeHref, routeSearch } from '../app/router';
import { lazy, Suspense, useEffect, useState } from 'react';
import demoDefinition from '../creator/metaRadarExample.json';
import demoCapture from './metaRadarCapture.json';
import './cloud.css';
import {
  activeStep,
  runEntries,
  runtime,
  stepTimings,
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
  const [kind, setKind] = useState('all');
  const [timeRange, setTimeRange] = useState('all');
  const [logViewPaused, setLogViewPaused] = useState<{runId: string; entries: Entry[]}>();
  const [inspectedLog, setInspectedLog] = useState<string | number>();
  const [refreshedAt, setRefreshedAt] = useState<number>();
  const visibleRuns = runs.filter(run => {
    const search = runFilter.trim().toLowerCase();
    return (statusFilter === 'all' || run.status === statusFilter) &&
      (run.workflow_id.toLowerCase().includes(search) || run.run_id.toLowerCase().includes(search));
  });

  function chooseRun(id: string) {
    setLinkStatus('');
    setLogViewPaused(undefined);
    setInspectedLog(undefined);
    setRefreshedAt(undefined);
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
        setRefreshedAt(Date.now());
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
  const entries = run ? runEntries(run, displayed?.logs) : [];
  const paused = logViewPaused?.runId === run?.run_id ? logViewPaused : undefined;
  const source = paused?.entries ?? entries;
  const end = Date.parse(run?.updated_at || entries.at(-1)?.at || '') || Date.now();
  const logEnd = paused ? (Date.parse(source.at(-1)?.at || '') || end) : end;
  const timeframe = timeRange === 'all' ? 0 : logEnd - Number(timeRange) * 60_000;
  const logs = source.filter(entry =>
    (!logStep || entry.step_id === logStep) &&
    (!errorsOnly || entry.level === 'error') &&
    (kind === 'all' || (entry.kind ?? 'run') === kind) &&
    (!timeframe || Date.parse(entry.at || '') >= timeframe) &&
    [entry.message, entry.step_id, entry.status].join(' ').toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const logDetail = logs.find(entry => entry.id === inspectedLog);
  const errors = entries.filter(entry => entry.level === 'error').length;
  const providerCalls = entries.filter(entry => entry.status === 'provider_requested').length;
  const stepNames = new Map(displayedDefinition?.steps?.map(step => [step.step_id,step.name || step.step_id]));
  const observedSteps = new Set(entries.filter(entry => entry.status === 'step_completed' && (!stepNames.size || stepNames.has(entry.step_id ?? ''))).map(entry => entry.step_id)).size;
  const timings = stepTimings(entries, active ? (refreshedAt ?? end) : end);
  const firstStart = Math.min(...timings.map(timing => timing.start));
  const lastEnd = Math.max(...timings.map(timing => timing.start + timing.duration));
  const span = Math.max(1, lastEnd - firstStart);

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
                <div className="run-summary" aria-label="Run summary">
                  <div><small>Completed steps</small><strong>{observedSteps}{displayedDefinition?.steps?.length ? ' / ' + displayedDefinition.steps.length : ''}</strong></div>
                  <div><small>Provider calls</small><strong>{providerCalls}</strong></div>
                  <div><small>Error events</small><strong>{errors}</strong></div>
                  <div><small>Updates</small><strong>{demo ? 'Recorded' : terminal(run.status) ? 'Finished' : error ? 'Reconnecting' : 'Live'}</strong>
                    {!demo && refreshedAt && <small>{new Date(refreshedAt).toLocaleTimeString()}</small>}</div>
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
                {timings.length > 0 && <details className="run-timings">
                  <summary>Step timing <small>{timings.length} {timings.length === 1 ? 'attempt' : 'attempts'}</small></summary>
                  <ol aria-label="Step timing">
                    {timings.map((timing, index) => <li key={timing.step + ':' + index}>
                      <button type="button" className="run-log-inspect" title={timing.step} aria-pressed={logStep === timing.step}
                        onClick={() => setLogSelection(logStep === timing.step ? undefined : {runId:run.run_id, step:timing.step})}>{stepNames.get(timing.step) || timing.step}</button>
                      <span className="run-timing-track" aria-hidden="true">
                        <span data-state={timing.status} style={{insetInlineStart:(timing.start-firstStart)/span*100+'%',width:timing.duration/span*100+'%'}} />
                      </span>
                      <small>{timing.duration >= 1000 ? (timing.duration/1000).toFixed(1) + ' s' : timing.duration + ' ms'} · {timing.status}</small>
                    </li>)}
                  </ol>
                </details>}
                {displayed.logs === undefined && (
                  <p>
                    Tool logs are unavailable on this runtime. Showing run
                    status.
                  </p>
                )}
                <div className="log-heading run-explorer-heading">
                  <h3>Run logs <small>{logs.length} {logs.length === 1 ? 'entry' : 'entries'}</small></h3>
                  {logStep && <button type="button" className="run-link" onClick={() => setLogSelection(undefined)}>Show all steps</button>}
                  {!demo && (!terminal(run.status) || paused) && <button type="button" className="run-link" onClick={() => setLogViewPaused(paused ? undefined : {runId:run.run_id, entries})}>
                    {paused ? 'Resume log updates' : 'Pause log updates'}
                  </button>}
                  {paused && <small role="status">Log updates paused</small>}
                </div>
                <div className="log-heading run-explorer-filters">
                  <label>Source <select value={kind} onChange={event => setKind(event.target.value)}>
                    <option value="all">All sources</option><option value="run">Run events</option><option value="provider">Provider</option><option value="tool">Tools</option>
                  </select></label>
                  <label>Time window <select value={timeRange} onChange={event => setTimeRange(event.target.value)}>
                    <option value="all">Entire run</option><option value="5">Last 5 minutes</option><option value="15">Last 15 minutes</option><option value="60">Last hour</option>
                  </select></label>
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
                  {(filter || errorsOnly || kind !== 'all' || timeRange !== 'all' || logStep) && <button type="button" className="run-link" onClick={() => {
                    setFilter(''); setErrorsOnly(false); setKind('all'); setTimeRange('all'); setLogSelection(undefined);
                  }}>Clear filters</button>}
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
                      <button type="button" className="run-log-inspect" aria-expanded={entry.id === inspectedLog} onClick={() => setInspectedLog(entry.id === inspectedLog ? undefined : entry.id)}>
                        {entry.kind === 'provider' && <strong>Provider · </strong>}{entry.message}
                      </button>
                    </li>
                  ))}
                  {!logs.length && <li>No matching log entries.</li>}
                </ul>
                {logDetail && <section className="run-log-detail" aria-label="Selected log event">
                  <div><h3>Log event</h3><button type="button" className="run-link" onClick={() => setInspectedLog(undefined)}>Close detail</button></div>
                  <p>{logDetail.message}</p>
                  <dl><dt>Source</dt><dd>{logDetail.kind ?? 'run'}</dd>
                  {logDetail.at && <><dt>Timestamp</dt><dd>{logDetail.at}</dd></>}
                  {logDetail.step_id && <><dt>Step</dt><dd>{logDetail.step_id}</dd></>}
                  {logDetail.status && <><dt>Event</dt><dd>{logDetail.status}</dd></>}</dl>
                </section>}
              </>
            )}
          </div>
        </div>
    </section>
  );
}
