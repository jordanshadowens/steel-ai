import { useState } from 'react';
import { ModalDialog } from '../app/FocusTrap';
import { authenticatedFetch, getSession, sessionIsCurrent } from '../auth/session';
import {
  applyWorkspaceSetup,
  parseWorkspaceSetup,
  prepareWorkspaceSetup,
  type DesignerRequest,
} from './workspaceSetup';

const MAX_SETUP_BYTES = 1024 * 1024;

function workspaceRequest(): DesignerRequest {
  const epoch = getSession().epoch;
  return async (path, body) => {
    if (!sessionIsCurrent(epoch)) throw new Error('Your workspace session changed. Open the setup again.');
    const response = await authenticatedFetch(`/api/designer${path}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (!sessionIsCurrent(epoch)) throw new Error('Your workspace session changed. Open the setup again.');
    if (!response.ok) {
      throw new Error(typeof result?.error === 'string' ? result.error : `Data Designer returned HTTP ${response.status}.`);
    }
    return result;
  };
}

type Preview = {
  bundle: ReturnType<typeof parseWorkspaceSetup>;
  changes: Awaited<ReturnType<typeof prepareWorkspaceSetup>>;
  request: DesignerRequest;
};

export function WorkspaceSetupImport({ onRefresh }: { onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<'file' | 'preview' | 'apply' | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const hasChanges = Boolean(preview && (preview.changes.missingModels.length || preview.changes.missingBindings));

  function change(value: string) {
    setRaw(value);
    setPreview(null);
    setError('');
  }

  async function readFile(file: File) {
    change('');
    if (file.size > MAX_SETUP_BYTES) {
      setError('Choose a setup file no larger than 1 MB.');
      return;
    }
    setBusy('file');
    try {
      change(await file.text());
    } catch {
      setError('The setup file could not be read.');
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setPreview(null);
    setError('');
    setBusy('preview');
    try {
      if (new TextEncoder().encode(raw).length > MAX_SETUP_BYTES) throw new Error('Use a setup bundle no larger than 1 MB.');
      const bundle = parseWorkspaceSetup(raw);
      const request = workspaceRequest();
      const changes = await prepareWorkspaceSetup(request, bundle);
      setPreview({ bundle, changes, request });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not preview the workspace setup.');
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!preview) return;
    setError('');
    setBusy('apply');
    try {
      const applied = await applyWorkspaceSetup(preview.request, preview.bundle);
      const modelCount = applied.publishedModels.length;
      const bindingCount = applied.insertedBindings;
      setResult(`Workspace setup applied. Published ${modelCount} ${modelCount === 1 ? 'model' : 'models'} and added ${bindingCount} ${bindingCount === 1 ? 'binding' : 'bindings'}.`);
      setOpen(false);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'Could not apply the workspace setup.');
    } finally {
      onRefresh();
      setBusy(null);
    }
  }

  return (
    <>
      <button type="button" className="btn" onClick={() => { change(''); setResult(''); setOpen(true); }}>
        Import setup
      </button>
      {result && <p role="status">{result}</p>}
      {open && (
        <ModalDialog label="Import workspace setup" wide onClose={() => { if (!busy) setOpen(false); }}>
          <h2>Import workspace setup</h2>
          <p>Choose a setup JSON file or paste the bundle to preview the models and bindings for this workspace.</p>
          <label className="field">
            <span>Setup JSON file</span>
            <input type="file" accept=".json,application/json" disabled={!!busy} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void readFile(file);
            }} />
          </label>
          <label className="field">
            <span>Setup JSON</span>
            <textarea className="designer-setup-json" rows={8} value={raw} disabled={!!busy} onChange={(event) => change(event.target.value)} />
          </label>
          {error && <p role="alert" className="field-error">{error}</p>}
          {busy && <p role="status">{busy === 'apply' ? 'Applying setup…' : busy === 'preview' ? 'Previewing setup…' : 'Reading the file…'}</p>}
          {preview && (
            <section aria-label="Setup preview">
              <h3>Setup preview</h3>
              <p>{preview.changes.missingModels.length ? 'Models to publish' : 'All included models are published.'}</p>
              {preview.changes.missingModels.length > 0 && <ul>{preview.changes.missingModels.map((model) => <li key={model}>{model}</li>)}</ul>}
              <p>{preview.changes.missingBindings} {preview.changes.missingBindings === 1 ? 'binding' : 'bindings'} to add</p>
            </section>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={!!busy} onClick={() => setOpen(false)}>
              {preview && !hasChanges ? 'Done' : 'Cancel'}
            </button>
            {preview ? (
              hasChanges && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void apply()}>Apply setup</button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={!!busy || !raw.trim()} onClick={() => void check()}>Preview setup</button>
            )}
          </div>
        </ModalDialog>
      )}
    </>
  );
}
