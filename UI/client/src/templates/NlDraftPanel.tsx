import { useState } from 'react';
import type { TemplateKind } from '../api/contracts';
import { useDraftTemplateMutation } from '../api/steelApi';
import { useAppDispatch } from '../store/hooks';
import { openSpec } from '../store/templateEditor';
import { CURRENCIES } from './specEdit';

// Natural-language creation: purpose and name → description → essential
// choices → generated spec for review. The draft is validated before it
// opens; failures never masquerade as success.
export function NlDraftPanel({ onDirtySwitch, onSlots }: { onDirtySwitch: (fn: () => void) => void; onSlots: (slots: string[]) => void }) {
  const dispatch = useAppDispatch();
  const [draft, draftState] = useDraftTemplateMutation();
  const [kind, setKind] = useState<TemplateKind>('document');
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [pageSize, setPageSize] = useState('letter');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const run = async () => {
    if (description.trim() === '') {
      setStatus({ kind: 'error', text: `Describe the ${kind} first.` });
      return;
    }
    setStatus(null);
    try {
      const res = await draft({
        description: description.trim(),
        kind,
        settings: {
          ...(templateId.trim() ? { template_id: templateId.trim() } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
          page_size: pageSize,
          currency,
        },
      }).unwrap();
      if (!res.draft) {
        setStatus({ kind: 'error', text: (res.errors ?? ['Draft failed.']).join('; ') });
        return;
      }
      const apply = () => {
        onSlots(res.slots ?? []);
        dispatch(openSpec({ templateId: templateId.trim() || 'new-template', version: null, spec: res.draft as never, kind: res.kind ?? kind }));
      };
      if (!res.ok) {
        setStatus({ kind: 'error', text: `Draft needs fixes before saving: ${(res.errors ?? []).join('; ')}` });
        onDirtySwitch(apply);
      } else {
        setStatus({ kind: 'ok', text: 'Draft ready. Review, fix, then save as a new template.' });
        onDirtySwitch(apply);
      }
    } catch (err) {
      const message = err && typeof err === 'object' && 'data' in err
        ? String((err as { data?: { error?: string } }).data?.error ?? 'Draft failed.')
        : err instanceof Error ? err.message : 'Draft failed.';
      setStatus({ kind: 'error', text: message });
    }
  };

  return (
    <div>
      <div className="map-row">
        <div className="field">
          <span><label htmlFor="draft-kind">Artifact type</label></span>
          <select id="draft-kind" value={kind} onChange={(e) => setKind(e.target.value as TemplateKind)}>
            <option value="document">Document</option>
            <option value="spreadsheet">Spreadsheet</option>
            <option value="presentation">Presentation</option>
          </select>
        </div>
        <div className="field">
          <span><label htmlFor="draft-id">Template id</label></span>
          <input id="draft-id" type="text" value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="customer-quotation" />
        </div>
        <div className="field">
          <span><label htmlFor="draft-title">Title</label></span>
          <input id="draft-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quotation" />
        </div>
      </div>
      <div className="map-row">
        <div className="field">
          <span><label htmlFor="draft-page">Page size</label></span>
          <select id="draft-page" value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
            <option value="letter">letter</option>
            <option value="a4">a4</option>
          </select>
        </div>
        <div className="field">
          <span><label htmlFor="draft-currency">Currency</label></span>
          <select id="draft-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <span><label htmlFor="draft-desc">Description</label></span>
        <textarea id="draft-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === 'spreadsheet' ? 'A monthly cost workbook: one sheet, item rows, currency totals…' : kind === 'presentation' ? 'A project closeout deck: title, milestones, lessons learned…' : 'A one-page customer quotation: header, bill-to block, line-item table, total callout, terms…'} />
      </div>
      <button type="button" className="btn btn-primary" disabled={draftState.isLoading} onClick={() => void run()}>
        {draftState.isLoading ? 'Drafting…' : 'Draft from description'}
      </button>
      {status && (
        <p className={status.kind === 'ok' ? 'status-ok' : 'status-bad'} role={status.kind === 'ok' ? 'status' : 'alert'}>
          {status.text}
        </p>
      )}
    </div>
  );
}
