import { useEffect, useState } from 'react';
import { ModalDialog } from '../app/FocusTrap';
import { authenticatedFetch } from './session';

// Protected API bytes cannot be opened by a raw link: navigation has no
// Authorization header. Fetch them under the current identity first.
export function ProtectedFile({ path, children, download = false, className = 'btn' }: { path: string; children: string; download?: boolean; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function open() {
    setBusy(true); setError('');
    try {
      const response = await authenticatedFetch(path);
      if (!response.ok) throw new Error('Document is unavailable or has not been released.');
      const blob = await response.blob();
      const next = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement('a'); link.href = next; link.download = 'steel-document.pdf'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(next);
      } else setUrl(next);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load document.'); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className={className} disabled={busy} onClick={() => void open()}>{busy ? 'Loading…' : children}</button>
    {error && <span className="status-bad" role="alert">{error}</span>}
    {url && <ModalDialog label="Document preview" onClose={() => setUrl(null)}><h2>Document preview</h2><iframe className="pdf-frame" title="Authenticated document preview" src={url} /><button className="btn" onClick={() => setUrl(null)}>Close preview</button></ModalDialog>}
  </>;
}
