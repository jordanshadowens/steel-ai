import { useEffect, useRef, useState } from 'react';
import type { AnyTemplateSpec, ReviseResult, TemplateKind } from '../api/contracts';
import { useReviseTemplateMutation } from '../api/steelApi';
import { useAppDispatch } from '../store/hooks';
import { updateSpec } from '../store/templateEditor';

const REVISE_TIMEOUT_MS = 120000;

// FNV-1a hash for staleness detection: the request snapshots the spec it was
// based on; Apply refuses when the editor moved on.
export function specHash(spec: unknown): string {
  const text = JSON.stringify(spec);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a-${(h >>> 0).toString(16)}`;
}

// Edit-with-AI: the current template plus the change request go to the
// existing AI backend together. The proposal is schema-validated
// server-side; the user must Apply or Discard. Apply is one undo entry.
export function RevisePanel({ kind, spec, templateId, onSlots }: {
  kind: TemplateKind;
  spec: AnyTemplateSpec;
  templateId: string | null;
  onSlots: (slots: string[]) => void;
}) {
  const dispatch = useAppDispatch();
  const [revise, reviseState] = useReviseTemplateMutation();
  const [change, setChange] = useState('');
  const [result, setResult] = useState<ReviseResult | null>(null);
  const [baseHash, setBaseHash] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const pending = useRef<{ abort: () => void; timer: number } | null>(null);

  useEffect(() => () => {
    pending.current?.abort();
    if (pending.current) window.clearTimeout(pending.current.timer);
  }, []);

  const send = () => {
    if (change.trim() === '' || reviseState.isLoading) return;
    if (pending.current) return; // duplicate submissions collapse into the in-flight request
    setStatus(null);
    setResult(null);
    const hash = specHash(spec);
    setBaseHash(hash);
    const req = revise({ kind, spec, change: change.trim(), base_hash: hash, ...(templateId ? { template_id: templateId } : {}) });
    const timer = window.setTimeout(() => {
      req.abort();
      pending.current = null;
      setStatus({ kind: 'error', text: 'The AI request timed out after 2 minutes. Nothing was changed; try again.' });
    }, REVISE_TIMEOUT_MS);
    pending.current = { abort: () => req.abort(), timer };
    void req.unwrap().then(
      (res) => {
        if (pending.current) window.clearTimeout(pending.current.timer);
        pending.current = null;
        setResult(res);
        if (!res.ok) {
          setStatus({ kind: 'error', text: `The proposal failed checks: ${res.errors.join('; ')}` });
        } else {
          setStatus({ kind: 'ok', text: 'Proposal ready. Review the changes, then Apply or Discard.' });
        }
      },
      (err) => {
        if (pending.current) window.clearTimeout(pending.current.timer);
        pending.current = null;
        const aborted = err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError';
        if (aborted && status === null) return;
        setStatus({ kind: 'error', text: `Revision failed: ${messageOf(err)} Nothing was changed.` });
      },
    );
  };

  const cancel = () => {
    pending.current?.abort();
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
    setStatus({ kind: 'error', text: 'Cancelled. Nothing was changed.' });
  };

  const apply = () => {
    if (!result?.ok || !result.proposal) return;
    if (baseHash !== specHash(spec)) {
      setStatus({ kind: 'error', text: 'The template changed since this proposal was made. Discard it and send a fresh request.' });
      return;
    }
    if (result.template_id && templateId && result.template_id !== templateId) {
      setStatus({ kind: 'error', text: `This proposal targets ${result.template_id}, not the open template. Discarded for safety.` });
      setResult(null);
      return;
    }
    if (result.kind !== kind) {
      setStatus({ kind: 'error', text: `This proposal is a ${result.kind} template, not ${kind}. Discarded for safety.` });
      setResult(null);
      return;
    }
    dispatch(updateSpec(result.proposal as AnyTemplateSpec));
    onSlots(result.slots ?? []);
    setResult(null);
    setStatus({ kind: 'ok', text: 'Applied. Use undo (↩) to revert.' });
  };

  const discard = () => {
    setResult(null);
    setStatus({ kind: 'ok', text: 'Discarded. The template is unchanged.' });
  };

  return (
    <div>
      <div className="field">
        <span><label htmlFor="revise-change">Change request</label></span>
        <textarea
          id="revise-change"
          rows={3}
          value={change}
          onChange={(e) => setChange(e.target.value)}
          placeholder={kind === 'spreadsheet' ? 'Add a monthly total and format it as currency.' : kind === 'presentation' ? 'Add a closing slide using the existing theme.' : 'Add a signature block.'}
        />
      </div>
      <div className="map-row">
        <button type="button" className="btn btn-primary" disabled={change.trim() === '' || reviseState.isLoading} onClick={send}>
          {reviseState.isLoading ? 'Revising…' : 'Edit with AI'}
        </button>
        {reviseState.isLoading && (
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
        )}
      </div>
      {status && (
        <p className={status.kind === 'ok' ? 'status-ok' : 'status-bad'} role={status.kind === 'ok' ? 'status' : 'alert'}>
          {status.text}
        </p>
      )}
      {result?.ok === true && result.proposal != null && (
        <section aria-label="AI proposal">
          <h3>Proposed changes</h3>
          <ul>
            {(result.summary ?? []).map((s, i) => (
              <li key={i} className="status-line">{String(s)}</li>
            ))}
          </ul>
          {(result.slots ?? []).length > 0 && (
            <p className="status-line num">Data slots: {(result.slots ?? []).join(' · ')}</p>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={discard}>
              Discard
            </button>
            <button type="button" className="btn btn-primary" onClick={apply}>
              Apply
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'status' in err && (err as { status?: unknown }).status === 'FETCH_ERROR') {
    return 'the server is unreachable (offline?).';
  }
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  if (err instanceof Error) return err.message;
  return 'Request failed.';
}
