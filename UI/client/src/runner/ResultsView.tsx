import { useState } from 'react';
import { authenticatedFetch } from '../auth/session';
import type { RunRow } from '../api/contracts';

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function isArtifactOutput(v: unknown): v is { kind: string; title?: string; count?: number; sha256?: string; snapshot?: string; template?: { template_id: string; version: number }; export?: { format: string; bytes: number; sha256: string } | null } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (o.kind === 'doc' || o.kind === 'sheet' || o.kind === 'slide') && typeof o.sha256 === 'string' && typeof o.count === 'number';
}

function artifactNoun(kind: string): string {
  return kind === 'sheet' ? 'Spreadsheet' : kind === 'slide' ? 'Presentation' : 'Document';
}

// Structured results bound to the run's own outputs — no field-name guesses,
// no universal steel summary. The execution trace stays one click away.
export function ResultsView({ run, visited }: { run: RunRow; visited?: string[] }) {
  const snapshot = (run.snapshot ?? {}) as Record<string, unknown>;
  const outputs = (snapshot.outputs ?? run.outputs ?? {}) as Record<string, unknown>;
  const error = (snapshot.error as string | undefined) ?? run.error ?? null;
  const stepOutputs = (snapshot.stepOutputs ?? {}) as Record<string, unknown>;
  const names = Object.keys(stepOutputs);
  return (
    <div>
      <p className="status-line num" role="status">
        Run {run.run_id.slice(0, 8)} — {run.status}
      </p>
      {error && <p className="status-bad" role="alert">{error}</p>}
      <h3>Outputs</h3>
      {Object.keys(outputs).length === 0 && <p className="status-line">No workflow outputs are mapped. In Workflow settings, add an output binding to the calculation result, then save and publish a new version.</p>}
      {Object.keys(outputs).length > 0 && (
        <table className="grid">
          <thead><tr><th>Key</th><th>Value</th></tr></thead>
          <tbody>
            {Object.entries(outputs).map(([k, v]) => (
              <tr key={k}><td>{k}</td><td className="num">{fmtValue(v)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <ArtifactOutputs stepOutputs={stepOutputs} />
      {names.length > 0 && (
        <details>
          <summary>Execution trace ({names.length} steps)</summary>
          {names.map((name) => (
            <details key={name}>
              <summary>{name}</summary>
              <pre className="dump num">{JSON.stringify(stepOutputs[name], null, 2)}</pre>
            </details>
          ))}
        </details>
      )}
      {visited && visited.length > 0 && (
        <p className="status-line">Path: {visited.join(' → ')}</p>
      )}
    </div>
  );
}

// Generated editable artifacts: template pin, byte hash, Studio handoff.
// The bytes re-render deterministically from the pinned template + frozen
// inputs, so "open in Studio" exports the exact pinned template source; the
// output hash verifies the generated instance.
function ArtifactOutputs({ stepOutputs }: { stepOutputs: Record<string, unknown> }) {
  const entries = Object.entries(stepOutputs).filter(([, v]) => isArtifactOutput(v)) as Array<[string, {
    kind: string; title?: string; count?: number; sha256?: string; template?: { template_id: string; version: number }; export?: { format: string; bytes: number; sha256: string } | null;
  }]>;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (entries.length === 0) return null;

  const openInStudio = async (stepId: string, template: { template_id: string; version: number } | undefined) => {
    if (!template) {
      setNote('This artifact used an inline definition (no library template). Recreate it as a template-backed step to open its source in Studio.');
      return;
    }
    setBusy(stepId);
    setNote(null);
    try {
      const res = await authenticatedFetch(`/api/templates/${encodeURIComponent(template.template_id)}/steel?version=${template.version}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNote(`Studio export failed: ${(body as { error?: string }).error ?? res.statusText}`);
        return;
      }
      const out = (await res.json()) as { filename: string; envelope: unknown; warnings: string[] };
      const blob = new Blob([JSON.stringify(out.envelope)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = out.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNote(`Exported ${out.filename}. Save it into your Studio gallery folder, then edit, save, and reopen it in Steel Studio.${out.warnings.length > 0 ? ` Notes: ${out.warnings.join(' ')}` : ''}`);
    } catch (err) {
      setNote(`Studio export failed: ${err instanceof Error ? err.message : 'Request failed.'}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Generated artifacts">
      <h3>Generated artifacts</h3>
      <table className="grid">
        <thead><tr><th>Step</th><th>Type</th><th>Template pin</th><th>Output</th><th>Studio</th></tr></thead>
        <tbody>
          {entries.map(([stepId, a]) => (
            <tr key={stepId}>
              <td>{stepId}</td>
              <td>{artifactNoun(a.kind)}{a.title ? ` — ${a.title}` : ''}</td>
              <td className="num">{a.template ? `${a.template.template_id} v${a.template.version}` : 'inline'}</td>
              <td className="num">{a.count} elements · {String(a.sha256).slice(0, 12)}…{a.export ? ` · ${a.export.format} ${a.export.bytes} bytes` : ''}</td>
              <td>
                <button type="button" className="btn" disabled={busy === stepId} onClick={() => void openInStudio(stepId, a.template)}>
                  {busy === stepId ? 'Exporting…' : 'Open in Studio'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="status-line" role="status">{note}</p>}
    </section>
  );
}
