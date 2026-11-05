import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../auth/session';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setSampleValue } from '../store/templateEditor';
import { smartValue } from './specEdit';
import type { Spec } from './specEdit';
import { SlotDesignerBinding, type SlotBinding } from './SlotDesignerBinding';

// Representative preview from explicitly supplied example data, labeled
// Sample. It renders through the real pipeline but writes no customer
// records; missing slots fail honestly instead of fabricating data.
export function SamplePreview({ spec, slots }: { spec: Spec; slots: string[] }) {
  const dispatch = useAppDispatch();
  const samples = useAppSelector((s) => s.templateEditor.sampleValues);
  const [url, setUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bindings, setBindings] = useState<Record<string, SlotBinding | null>>({});

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const empty = slots.filter((s) => (samples[s] ?? '').trim() === '' && !bindings[s]?.record_id);

  const render = async () => {
    setBusy(true);
    setError(null);
    if (url) {
      URL.revokeObjectURL(url);
      setUrl(null);
    }
    setMeta(null);
    try {
      const sample: Record<string, unknown> = {};
      const designer: Record<string, SlotBinding> = {};
      for (const s of slots) {
        const raw = (samples[s] ?? '').trim();
        if (raw !== '') sample[s] = smartValue(raw);
        else if (bindings[s]?.record_id) designer[s] = bindings[s] as SlotBinding;
      }
      const r = await authenticatedFetch('/api/templates/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec, sample, ...(Object.keys(designer).length > 0 ? { designer } : {}) }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; errors?: string[] };
        throw new Error([body.error, ...(body.errors ?? [])].filter(Boolean).join('; ') || `preview ${r.status}`);
      }
      const blob = await r.blob();
      setMeta(`${(blob.size / 1024).toFixed(0)} KB · rendered just now from the example values below`);
      setUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="status-line">
        Fill every slot with example values, then render. The preview is labeled Sample: it never runs an estimate,
        issues a customer document, or touches release records.
      </p>
      {slots.length === 0 && <p className="status-line">This template has no data slots. Render a preview to check its static content.</p>}
      {slots.map((s) => (
        <div className="field" key={s}>
          <span><label htmlFor={`sample-${s}`} className="num">{s}</label></span>
          <input
            id={`sample-${s}`}
            type="text"
            className="num"
            value={samples[s] ?? ''}
            placeholder="example value (JSON for lists/objects)"
            onChange={(e) => dispatch(setSampleValue({ slot: s, value: e.target.value }))}
          />
          <SlotDesignerBinding slot={s} value={bindings[s] ?? null} onChange={(next) => setBindings((prev) => ({ ...prev, [s]: next }))} />
        </div>
      ))}
      {empty.length > 0 && slots.length > 0 && (
        <p className="status-line status-warn">{empty.length} slot{empty.length === 1 ? '' : 's'} without example values — the renderer requires all slots.</p>
      )}
      <button type="button" className="btn btn-primary" disabled={busy || empty.length > 0} onClick={() => void render()}>
        {busy ? 'Rendering…' : 'Render sample preview'}
      </button>
      {error && <p className="status-bad" role="alert">{error}</p>}
      {url && (
        <figure className="sample-figure">
          <figcaption>
            <span className="badge">Sample</span> Example-data preview — not a customer document. {meta} · from the example values above
          </figcaption>
          <iframe title="Sample template preview" src={url} className="pdf-frame" />
        </figure>
      )}
    </div>
  );
}
