import { useEffect, useState } from 'react';
import type { DocumentRow } from '../api/contracts';
import { useListApprovalsQuery, useListDocumentsQuery } from '../api/steelApi';
import { ApprovalCard } from './ApprovalsInbox';

// Run documents: draft preview, exact-byte release decision, and customer
// download. Preview bytes live in component state as an object URL (never in
// Redux) and are revoked when finished. Sealed and released stay distinct:
// a sealed run with a draft document is not a released document.
export function DocumentsPanel({ runId, active }: { runId: string; active: boolean }) {
  const docs = useListDocumentsQuery({ run_id: runId }, { pollingInterval: active ? 3000 : 0, skipPollingIfUnfocused: true });
  const rows = docs.data?.documents ?? [];
  if (docs.isLoading) return <p className="status-line">Loading documents…</p>;
  if (docs.isError) {
    return (
      <p className="status-line">
        <span className="status-bad">Documents failed to load. </span>
        <button type="button" className="btn" onClick={() => docs.refetch()}>Retry</button>
      </p>
    );
  }
  if (rows.length === 0) return <p className="status-line">No documents for this run.</p>;
  return (
    <div>
      {rows.map((d) => (
        <DocumentCard key={d.doc_id} doc={d} runId={runId} />
      ))}
    </div>
  );
}

function DocumentCard({ doc: d, runId }: { doc: DocumentRow; runId: string }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const approvals = useListApprovalsQuery({ run_id: runId, pending: true });
  const docApproval = (approvals.data?.approvals ?? []).find(
    (a) => a.scope === 'document' && (a.metadata as Record<string, unknown> | undefined)?.doc_id === d.doc_id,
  );
  const snap = (d as Record<string, unknown>).snapshot as
    | { template?: unknown; bindings?: Record<string, unknown>; renderer?: unknown; result?: { bytes?: number; pages?: number } }
    | undefined;
  const bytes = snap?.result?.bytes ?? d.pdf_bytes ?? null;
  const pages = snap?.result?.pages ?? null;

  return (
    <div className="panel-card">
      <div>
        <span className="list-title num">Document {d.doc_id.slice(0, 8)}</span>
        {' '}<span className="badge">{d.status}</span>
      </div>
      <div className="status-line num">
        {d.template_id ?? '—'}{d.template_version ? ` v${d.template_version}` : ''}
        {d.pdf_sha256 ? ` · sha ${d.pdf_sha256.slice(0, 12)}` : ''}
        {bytes !== null ? ` · ${bytes} B` : ''}{pages !== null ? ` · ${pages}p` : ''}
      </div>
      {d.error && <p className="status-bad" role="alert">{d.error}</p>}
      {(d.status === 'draft' || d.status === 'released') && d.pdf_sha256 && (
        <div className="toolbar">
          <button type="button" className="btn" aria-expanded={previewOpen} onClick={() => setPreviewOpen(!previewOpen)}>
            {previewOpen ? 'Hide preview' : 'Preview draft'}
          </button>
          <a className="btn" href={`/api/documents/${encodeURIComponent(d.doc_id)}/preview`} target="_blank" rel="noopener">
            Open preview tab
          </a>
          {d.status === 'released' ? (
            <a className="btn btn-primary" href={`/api/documents/${encodeURIComponent(d.doc_id)}/download`}>
              Download PDF
            </a>
          ) : (
            <span className="status-line" title="Customer download unlocks when this exact artifact is approved and released.">
              Customer download blocked until release.
            </span>
          )}
        </div>
      )}
      {previewOpen && <PdfPreview docId={d.doc_id} />}
      {d.status === 'draft' && docApproval && (
        <>
          <p className="status-line">Release decision for these exact bytes:</p>
          <ApprovalCard approval={docApproval} />
        </>
      )}
      {d.status === 'draft' && !docApproval && (
        <p className="status-line">No pending release decision. The approval appears here when the step files it.</p>
      )}
      {snap && (
        <details>
          <summary className="status-line">Source (template, slots, renderer — values never leave the server)</summary>
          <pre className="dump num">{JSON.stringify({ template: snap.template, bindings: Object.keys(snap.bindings ?? {}), renderer: snap.renderer, result: snap.result }, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

function PdfPreview({ docId }: { docId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    setFailed(false);
    setUrl(null);
    fetch(`/api/documents/${encodeURIComponent(docId)}/preview`)
      .then((r) => {
        if (!r.ok) throw new Error(`preview ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [docId]);

  if (failed) return <p className="status-bad">Preview failed to load. The bytes may still download after release.</p>;
  if (!url) return <p className="status-line">Loading preview…</p>;
  return <iframe title="Draft PDF preview" src={url} className="pdf-frame" />;
}
