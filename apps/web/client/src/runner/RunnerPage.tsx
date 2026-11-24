import { navigate, routeHref, routeSearch } from '../app/router';
import { useState } from 'react';
import type { RunRow } from '../api/contracts';
import { isLocalRun, isTerminalRun, runStatusLabel } from '../api/runStatus';
import {
  useCreateRunMutation,
  useGetRunQuery,
  useGetWorkflowVersionsQuery,
  useListWorkflowsQuery,
} from '../api/steelApi';
import { InputForm } from './InputForm';
import { validateInputs } from './inputPresentation';
import { RunMonitor } from './RunMonitor';
import { RunnerLogs } from './RunnerLogs';
import { ResultsView, fmtValue } from './ResultsView';
import { DocumentsPanel } from './DocumentsPanel';
import { ApprovalsInbox } from './ApprovalsInbox';
import { HistoryPanel } from './HistoryPanel';
import './runner.css';

// Guided sequence: select → inputs → review → execution → results →
// document, with history and approvals alongside. Reusing inputs opens a
// new review and requires the user to start execution.
export function RunnerPage() {
  const [workflowId, setWorkflowId] = useState(() => routeSearch().get('workflow') ?? '');
  const [version, setVersion] = useState<number | null>(() => {
    const value = Number(routeSearch().get('version'));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  });
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, unknown> | null>(
    null,
  );
  const [runId, setRunId] = useState<string | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const [viewStatus, setViewStatus] = useState<string | null>(null);
  const [viewingRunId, setViewingRunId] = useState<string | null>(() => routeSearch().get('run'));
  const [runError, setRunError] = useState<string | null>(null);

  const published = useListWorkflowsQuery('published', { skip: !!viewingRunId });
  const publishedWorkflows = new Map(
    (published.data?.workflows ?? []).map((workflow) => [workflow.workflow_id, workflow]),
  );
  const versions = useGetWorkflowVersionsQuery(workflowId, {
    skip: !workflowId || !!viewingRunId,
  });
  const pubVersions = (versions.data?.versions ?? []).filter(
    (v) => v.status === 'published',
  );
  const effectiveVersion = version ?? pubVersions[0]?.version ?? null;
  const def =
    pubVersions.find((v) => v.version === effectiveVersion)?.definition ?? null;
  const [createRun, createState] = useCreateRunMutation();
  const liveRun = useGetRunQuery(runId ?? '', { skip: !runId });
  const viewing = useGetRunQuery(viewingRunId ?? '', { skip: !viewingRunId });

  const pickWorkflow = (id: string) => {
    setWorkflowId(id);
    setVersion(null);
    setInputErrors({});
    setRunId(null);
    setViewingRunId(null);
    setViewStatus(null);
    setSubmitted(null);
    setInputValues({});
    setRunError(null);
  };

  const prepareAgain = (run: RunRow, values: Record<string, unknown>) => {
    pickWorkflow(run.workflow_id);
    setVersion(run.version);
    setInputValues(values);
    setVisited([]);
  };

  const review = () => {
    if (!def) {
      return;
    }
    const { values, errors } = validateInputs(def, inputValues);
    setInputErrors(errors);
    setSubmitted(Object.keys(errors).length === 0 ? values : null);
  };

  const start = async () => {
    if (!def || !submitted) {
      return;
    }
    setRunError(null);
    try {
      const view = await createRun({
        workflow_id: workflowId,
        version: effectiveVersion ?? undefined,
        inputs: submitted,
      }).unwrap();
      setRunId(view.run_id);
      setVisited((view as { visited?: string[] }).visited ?? []);
      setViewStatus(view.status);
      setViewingRunId(null);
      // The live-run query starts itself once runId is set; never refetch
      // here — the subscription does not exist yet (RTK error #38).
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'data' in err
          ? String(
              (err as { data?: { error?: string } }).data?.error ??
                'Run failed to start.',
            )
          : err instanceof Error
            ? err.message
            : 'Run failed to start.';
      setRunError(message);
    }
  };

  const liveStatus = liveRun.data?.run.status ?? viewStatus;
  const terminal = !!liveStatus && isTerminalRun(liveStatus);
  const policy = (def?.policy ?? {}) as { execution_approval?: string };

  if (viewingRunId) {
    const run = viewing.currentData?.run;
    const local = run && isLocalRun(run.status);
    const startNew = () => {
      setViewingRunId(null);
      history.replaceState(history.state, '', routeHref('runner'));
    };
    return <div className="page-pad runner runner-detail">
      <div className="runner-detail-header">
        <div>
          <h1>{run?.workflow_id ?? 'Run details'}</h1>
          <p>{run ? `Version ${run.version} · ${local ? 'Local agent' : 'Cloud runtime'}` : viewingRunId}</p>
        </div>
        <div className="runner-detail-actions">
          <button type="button" className="btn" onClick={startNew}>New run</button>
          <ObserveRunLink runId={viewingRunId} primary />
        </div>
      </div>
      {viewing.isError && <p role="alert">Could not load this run. <button type="button" className="btn" onClick={viewing.refetch}>Retry</button></p>}
      {!run && !viewing.isError && <p role="status">Loading run…</p>}
      {run && <section aria-label="Run details" className="section-card runner-run-summary">
        <div className="runner-run-heading">
          <h2>Execution</h2>
          <span className="runner-status" data-status={run.status}>{runStatusLabel(run.status)}</span>
        </div>
        <dl>
          <dt>Run ID</dt><dd>{run.run_id}</dd>
          {run.updated_at && <><dt>Last update</dt><dd>{new Date(run.updated_at).toLocaleString()}</dd></>}
        </dl>
        {local && <p>Step events and provider logs are available in Observability.</p>}
        {!local && <ViewingRun run={run} onPrepare={(saved, values) => {startNew(); prepareAgain(saved, values);}} />}
        {local && !isTerminalRun(run.status) && <RunMonitor key={run.run_id} runId={run.run_id} onTerminal={() => viewing.refetch()} />}
      </section>}
      {run && <RunnerLogs key={run.run_id} runId={run.run_id} />}
    </div>;
  }

  return (
    <div className="page-pad runner">
      <h1>Workflow Runner</h1>
      <p className="page-sub">Start a published workflow or review a previous run.</p>

      <div className="runner-workspace">
      <div className="runner-workspace-main">
      <section aria-label="Select workflow" className="section-card">
        <h2>New run</h2>
        {published.isLoading && <p role="status">Loading published workflows…</p>}
        {published.isError && (
          <p role="alert">Could not load published workflows. <button type="button" className="btn" onClick={published.refetch}>Retry</button></p>
        )}
        {published.isSuccess && publishedWorkflows.size === 0 && (
          <div className="runner-workflow-empty">
            <p>Publish a workflow in Creator to start a run.</p>
            <a className="btn btn-primary" href={routeHref('creator')} onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigate('creator');
            }}>Open Creator</a>
          </div>
        )}
        {publishedWorkflows.size > 0 && (
          <div className="field">
            <span>
              <label htmlFor="runner-workflow">Workflow</label>
            </span>
            <select
              id="runner-workflow"
              value={workflowId}
              onChange={(e) => pickWorkflow(e.target.value)}
            >
              <option value="">Select…</option>
              {[...publishedWorkflows.values()].map((workflow) => (
                <option key={workflow.workflow_id} value={workflow.workflow_id}>
                  {workflow.name || workflow.workflow_id}
                </option>
              ))}
            </select>
          </div>
        )}
        {version !== null && versions.isSuccess && !def && (
          <div className="status-line" role="alert">
            Version {version} is not available to run.
            {pubVersions.length > 0 && <button type="button" className="btn" onClick={() => setVersion(null)}>Use latest published version</button>}
          </div>
        )}
        {def && (
          <>
            <div className="field">
              <span>
                <label htmlFor="runner-version">Published version</label>
              </span>
              <select
                id="runner-version"
                value={effectiveVersion ?? ''}
                onChange={(e) => setVersion(Number(e.target.value))}
              >
                {pubVersions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                  </option>
                ))}
              </select>
            </div>
            <p className="status-line">
              {def.name ?? workflowId} · {(def.inputs ?? []).length} inputs
              {policy.execution_approval && policy.execution_approval !== 'none'
                ? ' · runs need execution approval'
                : ' · runs start immediately'}
            </p>
          </>
        )}
      </section>

      {def && !viewingRunId && (
        <section aria-label="Project inputs" className="section-card">
          <h2>Inputs</h2>
          <InputForm
            def={def}
            values={inputValues}
            onChange={(v) => {
              setInputValues(v);
              setSubmitted(null);
            }}
            errors={inputErrors}
            disabled={createState.isLoading}
          />
          <button type="button" className="btn btn-primary" onClick={review}>
            Review inputs
          </button>
        </section>
      )}

      {def && submitted && !viewingRunId && (
        <section aria-label="Review inputs" className="section-card">
          <h2>Review and start</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>Input</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(submitted).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num">{fmtValue(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {runError && (
            <p className="status-bad" role="alert">
              {runError}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={createState.isLoading}
            onClick={() => void start()}
          >
            {createState.isLoading ? 'Starting…' : 'Start run'}
          </button>
        </section>
      )}

      {runId && !viewingRunId && (
        <section aria-label="Execution" className="section-card">
          <h2>Execution</h2>
          <ObserveRunLink runId={runId} />
          {(viewStatus === 'pending_approval' ||
            liveStatus === 'pending_approval') &&
            !terminal && (
              <>
                <p className="status-line">
                  Waiting for execution approval before the run starts:
                </p>
                <ApprovalsInbox
                  runId={runId}
                  onDecided={(view) => {
                    if (view.run_id) {
                      setViewStatus(null);
                      liveRun.refetch();
                    }
                  }}
                />
              </>
            )}
          {!(viewStatus === 'pending_approval' && !liveRun.data) && (
            <RunMonitor
              key={runId}
              runId={runId}
              onTerminal={() => liveRun.refetch()}
            />
          )}
        </section>
      )}

      {runId && terminal && liveRun.data && !viewingRunId && (
        <>
          <section aria-label="Results" className="section-card">
            <h2>Results</h2>
            <ResultsView run={liveRun.data.run} visited={visited} />
          </section>
          <section aria-label="Document" className="section-card">
            <h2>Customer document</h2>
            <DocumentsPanel runId={runId} active={false} />
          </section>
        </>
      )}
      {runId && <RunnerLogs key={runId} runId={runId} />}

      </div>
      <aside className="runner-workspace-sidebar">
      {workflowId && <section aria-label="Run history" className="section-card">
        <h2>Run history</h2>
        <HistoryPanel
          workflowId={workflowId}
          selectedRunId={viewingRunId ?? runId}
          onSelect={(id) => {
            setViewingRunId(id);
            setRunId(null);
            history.replaceState(history.state, '', routeHref('runner', new URLSearchParams({run:id})));
          }}
        />
      </section>}

      <ApprovalsInbox workspace />
      </aside>
      </div>
    </div>
  );
}

function savedInputs(run: RunRow): Record<string, unknown> | undefined {
  const inputs = run.snapshot?.inputs ?? run.inputs;
  return inputs && typeof inputs === 'object' && !Array.isArray(inputs)
    ? inputs as Record<string, unknown>
    : undefined;
}

function ViewingRun({ run, onPrepare }: {
  run: RunRow;
  onPrepare: (run: RunRow, values: Record<string, unknown>) => void;
}) {
  if (!isTerminalRun(run.status)) {
    return <RunMonitor runId={run.run_id} onTerminal={() => {}} />;
  }
  const inputs = savedInputs(run);
  return (
    <>
      <ResultsView run={run} />
      {inputs && (
        <button type="button" className="btn" onClick={() => onPrepare(run, inputs)}>Review saved inputs for a new run</button>
      )}
      <h3>Documents</h3>
      <DocumentsPanel runId={run.run_id} active={false} />
    </>
  );
}

function ObserveRunLink({ runId, primary = false }: { runId: string; primary?: boolean }) {
  const query = new URLSearchParams({ run: runId });
  return <a className={primary ? 'btn btn-primary' : 'btn'} href={routeHref('observability', query)} onClick={(event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    navigate('observability', query);
  }}>Inspect in Observability</a>;
}
