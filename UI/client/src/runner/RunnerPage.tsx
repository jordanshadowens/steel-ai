import { useEffect, useState } from 'react';
import type { RunRow } from '../api/contracts';
import { useCreateRunMutation, useGetRunQuery, useGetWorkflowVersionsQuery, useListWorkflowsQuery } from '../api/steelApi';
import { InputForm } from './InputForm';
import { validateInputs } from './inputPresentation';
import { RunMonitor } from './RunMonitor';
import { ResultsView, fmtValue } from './ResultsView';
import { DocumentsPanel } from './DocumentsPanel';
import { ApprovalsInbox } from './ApprovalsInbox';
import { HistoryPanel } from './HistoryPanel';
import './runner.css';

const TERMINAL = new Set(['sealed', 'failed']);

// Guided sequence: select → inputs → review → execution → results →
// document, with history and approvals alongside. Viewing history never
// reruns a workflow or regenerates a document.
export function RunnerPage() {
  const preselect = new URLSearchParams(window.location.search).get('workflow') ?? '';
  const [workflowId, setWorkflowId] = useState(preselect);
  const [version, setVersion] = useState<number | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, unknown> | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const [viewStatus, setViewStatus] = useState<string | null>(null);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const published = useListWorkflowsQuery('published');
  const versions = useGetWorkflowVersionsQuery(workflowId, { skip: !workflowId });
  const pubVersions = (versions.data?.versions ?? []).filter((v) => v.status === 'published');
  const effectiveVersion = version ?? pubVersions[0]?.version ?? null;
  const def = pubVersions.find((v) => v.version === effectiveVersion)?.definition ?? null;
  const [createRun, createState] = useCreateRunMutation();
  const liveRun = useGetRunQuery(runId ?? '', { skip: !runId });
  const viewing = useGetRunQuery(viewingRunId ?? '', { skip: !viewingRunId });

  useEffect(() => {
    setVersion(null);
    setSubmitted(null);
    setInputErrors({});
  }, [workflowId]);

  const pickWorkflow = (id: string) => {
    setWorkflowId(id);
    setRunId(null);
    setViewingRunId(null);
    setViewStatus(null);
    setSubmitted(null);
    setInputValues({});
    setRunError(null);
  };

  const review = () => {
    if (!def) return;
    const { values, errors } = validateInputs(def, inputValues);
    setInputErrors(errors);
    setSubmitted(Object.keys(errors).length === 0 ? values : null);
  };

  const start = async () => {
    if (!def || !submitted) return;
    setRunError(null);
    try {
      const view = await createRun({ workflow_id: workflowId, version: effectiveVersion ?? undefined, inputs: submitted }).unwrap();
      setRunId(view.run_id);
      setVisited((view as { visited?: string[] }).visited ?? []);
      setViewStatus(view.status);
      setViewingRunId(null);
      // The live-run query starts itself once runId is set; never refetch
      // here — the subscription does not exist yet (RTK error #38).
    } catch (err) {
      const message = err && typeof err === 'object' && 'data' in err
        ? String((err as { data?: { error?: string } }).data?.error ?? 'Run failed to start.')
        : err instanceof Error ? err.message : 'Run failed to start.';
      setRunError(message);
    }
  };

  const liveStatus = liveRun.data?.run.status ?? viewStatus;
  const terminal = !!liveStatus && TERMINAL.has(liveStatus);
  const policy = (def?.policy ?? {}) as { execution_approval?: string };

  return (
    <div className="page-pad runner">
      <h1>Workflow Runner</h1>
      <p className="page-sub">Run a published workflow, review its results, and release its exact customer document.</p>

      <section aria-label="Select workflow" className="section-card">
        <h2>1. Select a published workflow</h2>
        <div className="field">
          <span><label htmlFor="runner-workflow">Workflow</label></span>
          <select id="runner-workflow" value={workflowId} onChange={(e) => pickWorkflow(e.target.value)}>
            <option value="">Select…</option>
            {[...new Map((published.data?.workflows ?? []).map((w) => [w.workflow_id, w])).values()].map((w) => (
              <option key={w.workflow_id} value={w.workflow_id}>{w.name || w.workflow_id}</option>
            ))}
          </select>
        </div>
        {def && (
          <>
            <div className="field">
              <span><label htmlFor="runner-version">Published version</label></span>
              <select id="runner-version" value={effectiveVersion ?? ''} onChange={(e) => setVersion(Number(e.target.value))}>
                {pubVersions.map((v) => (
                  <option key={v.version} value={v.version}>v{v.version}</option>
                ))}
              </select>
            </div>
            <p className="status-line">
              {def.name ?? workflowId} · {(def.inputs ?? []).length} inputs
              {policy.execution_approval && policy.execution_approval !== 'none' ? ' · runs need execution approval' : ' · runs start immediately'}
            </p>
          </>
        )}
      </section>

      {def && !viewingRunId && (
        <section aria-label="Project inputs" className="section-card">
          <h2>2. Enter project information</h2>
          <InputForm def={def} values={inputValues} onChange={(v) => { setInputValues(v); setSubmitted(null); }} errors={inputErrors} disabled={createState.isLoading} />
          <button type="button" className="btn btn-primary" onClick={review}>
            Review inputs
          </button>
        </section>
      )}

      {def && submitted && !viewingRunId && (
        <section aria-label="Review inputs" className="section-card">
          <h2>3. Review and start</h2>
          <table className="grid">
            <thead><tr><th>Input</th><th>Value</th></tr></thead>
            <tbody>
              {Object.entries(submitted).map(([k, v]) => (
                <tr key={k}><td>{k}</td><td className="num">{fmtValue(v)}</td></tr>
              ))}
            </tbody>
          </table>
          {runError && <p className="status-bad" role="alert">{runError}</p>}
          <button type="button" className="btn btn-primary" disabled={createState.isLoading} onClick={() => void start()}>
            {createState.isLoading ? 'Starting…' : 'Start run'}
          </button>
        </section>
      )}

      {runId && !viewingRunId && (
        <section aria-label="Execution" className="section-card">
          <h2>4. Execution</h2>
          {(viewStatus === 'pending_approval' || liveStatus === 'pending_approval') && !terminal && (
            <>
              <p className="status-line">Waiting for execution approval before the run starts:</p>
              <ApprovalsInbox runId={runId} onDecided={(view) => {
                if (view.run_id) {
                  setViewStatus(null);
                  liveRun.refetch();
                }
              }}
              />
            </>
          )}
          {!(viewStatus === 'pending_approval' && !liveRun.data) && (
            <RunMonitor key={runId} runId={runId} onTerminal={() => liveRun.refetch()} />
          )}
        </section>
      )}

      {runId && terminal && liveRun.data && !viewingRunId && (
        <>
          <section aria-label="Results" className="section-card">
            <h2>5. Results</h2>
            <ResultsView run={liveRun.data.run} visited={visited} />
          </section>
          <section aria-label="Document" className="section-card">
            <h2>6. Customer document</h2>
            <DocumentsPanel runId={runId} active={false} />
          </section>
        </>
      )}

      {viewingRunId && (
        <section aria-label="Historical run" className="section-card">
          <h2>Run from history (read-only)</h2>
          <button type="button" className="btn" onClick={() => setViewingRunId(null)}>
            ← Back to new run
          </button>
          {viewing.isLoading && <p className="status-line">Loading run…</p>}
          {viewing.data && <ViewingRun run={viewing.data.run} onActive={() => liveRun.refetch()} />}
        </section>
      )}

      <section aria-label="Run history" className="section-card">
        <h2>Run history</h2>
        <HistoryPanel workflowId={workflowId} selectedRunId={viewingRunId ?? runId} onSelect={(id) => { setViewingRunId(id); setRunId(null); }} />
      </section>

      <section aria-label="Approvals" className="section-card">
        <h2>Approvals</h2>
        <ApprovalsInbox />
      </section>
    </div>
  );
}

function ViewingRun({ run, onActive }: { run: RunRow; onActive: () => void }) {
  void onActive;
  if (!TERMINAL.has(run.status)) {
    return <RunMonitor runId={run.run_id} onTerminal={() => {}} />;
  }
  return (
    <>
      <ResultsView run={run} />
      <h3>Documents</h3>
      <DocumentsPanel runId={run.run_id} active={false} />
    </>
  );
}


