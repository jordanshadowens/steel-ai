import { useId, useState } from 'react';
import { ProtectedFile } from '../auth/ProtectedFile';
import type { ApprovalRow } from '../api/contracts';
import { useDecideApprovalMutation, useListApprovalsQuery } from '../api/steelApi';

// Pending approvals, each identifying what is being approved. Scopes stay
// separate server-validated actions; every rejection needs a comment that
// gives the author a path forward.
export function ApprovalsInbox({ runId, onDecided }: { runId?: string; onDecided?: (view: { run_id?: string }) => void }) {
  const inbox = useListApprovalsQuery(runId ? { run_id: runId, pending: true } : { pending: true }, {
    pollingInterval: 15000,
    skipPollingIfUnfocused: true,
  });
  const approvals = inbox.data?.approvals ?? [];
  return (
    <div>
      {inbox.isLoading && <p className="status-line">Loading approvals…</p>}
      {inbox.isError && (
        <p className="status-line">
          <span className="status-bad">Inbox failed to load. </span>
          <button type="button" className="btn" onClick={() => inbox.refetch()}>Retry</button>
        </p>
      )}
      {approvals.length === 0 && !inbox.isLoading && !inbox.isError && (
        <p className="status-line">No pending approvals.</p>
      )}
      {approvals.map((a) => (
        <ApprovalCard key={a.approval_id} approval={a} onDecided={onDecided} />
      ))}
    </div>
  );
}

export function ApprovalCard({ approval: a, onDecided }: { approval: ApprovalRow; onDecided?: (view: { run_id?: string }) => void }) {
  const [decide, decideState] = useDecideApprovalMutation();
  const [comment, setComment] = useState('');
  const commentId = useId();
  const askKind = (a.metadata as Record<string, unknown> | undefined)?.question === 'acquire_or_abort';
  const busy = decideState.isLoading;

  const run = async (decision: string) => {
    try {
      const view = await decide({ id: a.approval_id, decision, decided_by: 'human', comment: comment.trim() || undefined }).unwrap();
      setComment('');
      onDecided?.(view as { run_id?: string });
    } catch {
      // RTK surfaces the error; the card stays for retry.
    }
  };

  return (
    <div className="panel-card">
      <div>
        <span className="badge">{a.scope}</span> {a.prompt ?? ''}
      </div>
      <ApprovalContext approval={a} />
      <div className="field">
        <span><label htmlFor={commentId}>Comment{askKind ? '' : ' (required to reject — describe what must change)'}</label></span>
        <input
          id={commentId}
          type="text"
          value={comment}
          disabled={busy}
          onChange={(e) => setComment(e.target.value)}
          placeholder={askKind ? 'comment (optional)' : 'required for rejection'}
        />
      </div>
      {decideState.isError && <p className="status-bad" role="alert">Decision failed. Retry below.</p>}
      <div className="toolbar">
        {askKind ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run('propose')}>
              {busy ? '…' : 'Propose skill'}
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run('abort')}>
              {busy ? '…' : 'Abort'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run('approved')}>
              {busy ? '…' : 'Approve'}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || comment.trim() === ''}
              title={comment.trim() === '' ? 'Describe what must change before rejecting' : 'Reject with this comment'}
              onClick={() => void run('rejected')}
            >
              {busy ? '…' : 'Reject'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ApprovalContext({ approval: a }: { approval: ApprovalRow }) {
  const meta = (a.metadata ?? {}) as Record<string, unknown>;
  const runCtx = a.run_id ? `run ${String(a.run_id).slice(0, 8)}${a.step_id ? ` · ${a.step_id}` : ''}` : '';
  if (a.scope === 'document' && typeof meta.doc_id === 'string') {
    return (
      <div className="status-line">
        {runCtx} · exact customer bytes · sha {String(meta.pdf_sha256 ?? '').slice(0, 12)}
        <div>
          <ProtectedFile path={`/api/documents/${encodeURIComponent(meta.doc_id)}/preview`}>Preview exact bytes</ProtectedFile>
          {' '}— approving releases this artifact and only this artifact.
        </div>
      </div>
    );
  }
  if (a.scope === 'template_publish' && typeof meta.template_id === 'string') {
    return <div className="status-line num">{meta.template_id} v{String(meta.version ?? '')} · {runCtx}</div>;
  }
  if (a.scope === 'publish' && typeof meta.workflow_id === 'string') {
    return <div className="status-line num">{meta.workflow_id} v{String(meta.version ?? '')}</div>;
  }
  if (a.scope === 'execution') {
    return <div className="status-line">Start {runCtx || 'the run'} with the submitted inputs. {a.prompt ?? ''}</div>;
  }
  if (a.scope === 'skill') {
    return <div className="status-line">{runCtx} · {typeof meta.skill === 'string' ? meta.skill : 'new skill'} · {a.prompt ?? ''}</div>;
  }
  return <div className="status-line">{[runCtx, a.prompt].filter(Boolean).join(' · ')}</div>;
}
