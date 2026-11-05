import { useEffect, useState } from 'react';
import type { AnyTemplateSpec, SheetTemplateSpec, SlideTemplateSpec, TemplateKind } from '../api/contracts';
import {
  useCreateTemplateMutation,
  useCreateTemplateVersionMutation,
  useGetTemplateVersionsQuery,
  useListApprovalsQuery,
  usePublishTemplateMutation,
  useValidateTemplateMutation,
} from '../api/steelApi';
import { ModalDialog } from '../app/FocusTrap';
import { ApprovalCard } from '../runner/ApprovalsInbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { detectKind, isSpecDirty, markSpecSaved, openSpec, redoSpec, undoSpec, updateSpec } from '../store/templateEditor';
import { TemplateLibrary, kindName } from './TemplateLibrary';
import { NlDraftPanel } from './NlDraftPanel';
import { RevisePanel } from './RevisePanel';
import { SpecEditor } from './SpecEditor';
import type { SpecEditFn } from './SectionEditors';
import { SamplePreview } from './SamplePreview';
import { SheetEditor } from './SheetEditor';
import { SlideEditor } from './SlideEditor';
import { blankSpec as blankDocSpec } from './specEdit';
import type { Spec } from './specEdit';
import './templates.css';

function blankEnvelope(kind: TemplateKind, title: string): SheetTemplateSpec | SlideTemplateSpec {
  if (kind === 'spreadsheet') {
    return {
      schema: 'steel-template/1',
      kind: 'spreadsheet',
      title,
      definition: { schema: 'steel-art/1c', kind: 'sheet', title, sheets: [{ name: 'Sheet1', cols: 8, rows: 50 }] },
      data: { texts: [title, 'Total'], cells: [{ s: 0, r: 0, c: 0, t: 't', v: 0 }] },
      bindings: ['texts[1]'],
    };
  }
  return {
    schema: 'steel-template/1',
    kind: 'presentation',
    title,
    definition: { schema: 'steel-art/1c', kind: 'slide', title, layouts: ['title', 'bullets'] },
    data: { texts: [title, 'Key points'], slides: [{ layout: 0, title: 0, bullets: [] }] },
    bindings: ['texts[1]'],
  };
}

// Author → bind → preview → publish, for documents, spreadsheets, and
// presentations. Published versions are immutable; every edit starts a new
// draft version. Editing a template never touches generated instances:
// instantiation deep-copies (see templateKinds.js).
export function TemplatesPage() {
  const dispatch = useAppDispatch();
  const editor = useAppSelector((s) => s.templateEditor);
  const spec = editor.spec as AnyTemplateSpec | null;
  const kind: TemplateKind = editor.kind ?? detectKind(spec);
  const dirty = isSpecDirty(editor);
  const [slots, setSlots] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState<(() => void) | null>(null);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<TemplateKind>('document');
  const [validate, validateState] = useValidateTemplateMutation();
  const [createTemplate, createState] = useCreateTemplateMutation();
  const [createVersion, versionState] = useCreateTemplateVersionMutation();
  const [publish, publishState] = usePublishTemplateMutation();
  const [studioBusy, setStudioBusy] = useState(false);
  const saving = createState.isLoading || versionState.isLoading;

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (spec && editor.openVersion === null) {
      setNewId((v) => v || editor.openTemplateId || '');
      setNewName((v) => v || ((spec as { title?: string }).title ?? ''));
    }
  }, [spec, editor.openVersion, editor.openTemplateId]);

  const editDoc: SpecEditFn = (fn) => {
    if (!spec || kind !== 'document') return;
    const next = JSON.parse(JSON.stringify(spec)) as Spec;
    const replacement = fn(next) as unknown as Spec | void;
    dispatch(updateSpec(replacement && typeof replacement === 'object' ? replacement : next));
  };

  const editEnvelope = (fn: (s: SheetTemplateSpec & SlideTemplateSpec) => void) => {
    if (!spec || kind === 'document') return;
    const next = JSON.parse(JSON.stringify(spec)) as SheetTemplateSpec & SlideTemplateSpec;
    fn(next);
    dispatch(updateSpec(next));
  };

  const dirtySwitch = (fn: () => void) => {
    if (dirty) setConfirmSwitch(() => fn);
    else fn();
  };

  const startBlank = (k: TemplateKind) => {
    dirtySwitch(() => {
      setSlots([]);
      setErrors([]);
      setStatus(null);
      setNewId('');
      setNewName('');
      const starter = k === 'document' ? blankDocSpec() : blankEnvelope(k, 'Untitled template');
      dispatch(openSpec({ templateId: 'new-template', version: null, spec: starter as never, kind: k }));
    });
  };

  const doValidate = async () => {
    if (!spec) return;
    setStatus(null);
    try {
      const res = await validate({ spec, kind }).unwrap();
      if (!res.ok) {
        setErrors(res.errors);
        setStatus({ kind: 'error', text: `${res.errors.length} issue${res.errors.length === 1 ? '' : 's'} found.` });
        return;
      }
      setErrors([]);
      setSlots(res.slots ?? []);
      setStatus({ kind: 'ok', text: `Valid. ${res.slots?.length ?? 0} data slots.` });
    } catch (err) {
      setStatus({ kind: 'error', text: `Validate failed: ${apiMessage(err)}` });
    }
  };

  const doSave = async () => {
    if (!spec) return;
    setStatus(null);
    try {
      if (editor.openVersion === null) {
        const templateId = newId.trim();
        const name = newName.trim() || templateId;
        if (!/^[A-Za-z0-9_-]+$/.test(templateId)) {
          setStatus({ kind: 'error', text: 'Set a template id (letters, numbers, _ and -) before saving.' });
          return;
        }
        const res = await createTemplate({ template_id: templateId, name, spec: kind === 'document' ? { ...spec, template_id: templateId } : spec, kind }).unwrap();
        if (!res.ok || !res.template) throw new Error('Save failed.');
        dispatch(openSpec({ templateId, version: res.template.version, spec: (res.template.spec ?? spec) as never, kind }));
        setStatus({ kind: 'ok', text: `Saved ${templateId} v${res.template.version} as draft.` });
      } else if (editor.openTemplateId) {
        const res = await createVersion({ id: editor.openTemplateId, spec, created_by: 'human' }).unwrap();
        if (!res.ok || !res.template) throw new Error('Save failed.');
        const stamped = (res.template.spec ?? spec) as AnyTemplateSpec;
        dispatch(updateSpec(stamped));
        dispatch(markSpecSaved({ version: res.template.version }));
        setStatus({ kind: 'ok', text: `Saved v${res.template.version} as draft.` });
      }
    } catch (err) {
      const body = (err as { data?: { error?: string; errors?: string[] } }).data;
      const details = [...(body?.errors ?? [])];
      if (body?.error && details.length === 0) details.push(body.error);
      setErrors(details);
      setStatus({ kind: 'error', text: `Save failed: ${details.join('; ') || apiMessage(err)}` });
    }
  };

  const doPublish = async () => {
    if (!spec || !editor.openTemplateId || editor.openVersion === null || dirty) return;
    setStatus(null);
    try {
      const res = await publish({ id: editor.openTemplateId, version: editor.openVersion }).unwrap();
      setStatus({ kind: 'ok', text: `Publish approval #${res.approval_id} pending.` });
    } catch (err) {
      setStatus({ kind: 'error', text: `Publish failed: ${apiMessage(err)}` });
    }
  };

  const doStudioExport = async () => {
    if (!editor.openTemplateId || editor.openVersion === null) return;
    setStudioBusy(true);
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(editor.openTemplateId)}/steel?version=${editor.openVersion}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus({ kind: 'error', text: `Studio export failed: ${(body as { error?: string }).error ?? res.statusText}` });
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
      setStatus({
        kind: 'ok',
        text: `Exported ${out.filename} for the Studio gallery. Save it into your gallery folder, then open it in Steel Studio.${out.warnings.length > 0 ? ` Fidelity notes: ${out.warnings.join(' ')}` : ''}`,
      });
    } catch (err) {
      setStatus({ kind: 'error', text: `Studio export failed: ${apiMessage(err)}` });
    } finally {
      setStudioBusy(false);
    }
  };

  return (
    <div className="page-pad templates">
      <h1>Templates</h1>
      <p className="page-sub">One library for documents, spreadsheets, and presentations. Create a reusable layout, connect its data, and preview before publishing.</p>

      <div className="templates-grid">
        <div className="templates-sidebar">
          <section aria-label="Library" className="section-card">
            <h2>Library</h2>
            <TemplateLibrary onDirtySwitch={dirtySwitch} />
          </section>
        </div>

        <div className="templates-workspace">
          <section aria-label="Create a template" className="section-card template-create-card">
            <details open={!spec}>
              <summary>Create a template</summary>
              <div className="map-row" role="group" aria-label="Start from a blank template">
                <div className="field">
                  <span><label htmlFor="blank-kind">Artifact type</label></span>
                  <select id="blank-kind" value={newKind} onChange={(e) => setNewKind(e.target.value as TemplateKind)}>
                    <option value="document">Document</option>
                    <option value="spreadsheet">Spreadsheet</option>
                    <option value="presentation">Presentation</option>
                  </select>
                </div>
                <button type="button" className="btn" onClick={() => startBlank(newKind)}>
                  Start blank
                </button>
              </div>
              <p className="page-sub">Or describe the {newKind} you need. Review and save the generated layout before using it in a workflow.</p>
              <NlDraftPanel onDirtySwitch={dirtySwitch} onSlots={setSlots} />
            </details>
          </section>
          {spec && (
            <>
              <section aria-label="Template toolbar" className="section-card">
                <div className="toolbar">
                  <span className="kind-badge" title={kindName(kind)}>{kind === 'spreadsheet' ? 'XLS' : kind === 'presentation' ? 'PPT' : 'DOC'}</span>
                  <span className="status-line num" role="status">
                    {editor.openTemplateId ?? 'new template'}
                    {editor.openVersion !== null ? ` v${editor.openVersion}` : ' (unsaved)'}
                    {editor.openVersion === null ? ' · not saved yet' : dirty ? ' · unsaved changes' : ' · saved'}
                  </span>
                  <span className="command-spacer" />
                  <button type="button" className="btn" disabled={editor.past.length === 0} onClick={() => dispatch(undoSpec())} aria-label="Undo">↩</button>
                  <button type="button" className="btn" disabled={editor.future.length === 0} onClick={() => dispatch(redoSpec())} aria-label="Redo">↪</button>
                  <button type="button" className="btn" disabled={validateState.isLoading} onClick={() => void doValidate()}>
                    {validateState.isLoading ? 'Validating…' : 'Validate'}
                  </button>
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void doSave()}>
                    {saving ? 'Saving…' : editor.openVersion === null ? 'Save new template' : 'Save new version'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={editor.openVersion === null || dirty || publishState.isLoading}
                    title={editor.openVersion === null || dirty ? 'Save the spec first' : 'Request publication approval'}
                    onClick={() => void doPublish()}
                  >
                    Publish
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={editor.openVersion === null || dirty || studioBusy}
                    title="Download a .steel file for the Studio template gallery"
                    onClick={() => void doStudioExport()}
                  >
                    {studioBusy ? 'Exporting…' : 'Open in Studio'}
                  </button>
                </div>
                {editor.openVersion === null && (
                  <div className="map-row">
                    <div className="field">
                      <span><label htmlFor="save-id">Template id</label></span>
                      <input id="save-id" type="text" value={newId} onChange={(e) => setNewId(e.target.value)} />
                    </div>
                    <div className="field">
                      <span><label htmlFor="save-name">Name</label></span>
                      <input id="save-name" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    </div>
                  </div>
                )}
                {status && (
                  <p className={status.kind === 'ok' ? 'status-ok' : 'status-bad'} role={status.kind === 'ok' ? 'status' : 'alert'}>
                    {status.text}
                  </p>
                )}
                {errors.length > 0 && (
                  <ul>
                    {errors.map((e, i) => (
                      <li key={i} className="status-bad">{e}</li>
                    ))}
                  </ul>
                )}
                {slots.length > 0 && (
                  <p className="status-line num">Data slots: {slots.join(' · ')}</p>
                )}
              </section>

              <section aria-label="Template editor" className="section-card">
                <h2>{kind === 'document' ? 'Sections and styles' : kind === 'spreadsheet' ? 'Sheets and cells' : 'Slides and text'}</h2>
                {kind === 'document' && <SpecEditor spec={spec as Spec} edit={editDoc} />}
                {kind === 'spreadsheet' && <SheetEditor spec={spec as SheetTemplateSpec} edit={editEnvelope} />}
                {kind === 'presentation' && <SlideEditor spec={spec as SlideTemplateSpec} edit={editEnvelope} />}
              </section>

              <section aria-label="Edit with AI" className="section-card">
                <h2>Edit with AI</h2>
                <p className="page-sub">Send the current {kind} plus a change request to the AI. Review the proposal, then Apply or Discard — published versions are never mutated in place.</p>
                <RevisePanel kind={kind} spec={spec} templateId={editor.openTemplateId} onSlots={setSlots} />
              </section>

              {kind === 'document' && (
                <section aria-label="Sample preview" className="section-card">
                  <h2>Sample preview</h2>
                  <SamplePreview spec={spec as Spec} slots={slots} />
                </section>
              )}
              {kind !== 'document' && (
                <section aria-label="Bindings" className="section-card">
                  <h2>Bindings</h2>
                  <p className="status-line">Validate to list the fillable data paths workflows must map. Sample rendering for {kindName(kind).toLowerCase()}s happens in Steel Studio via Open in Studio.</p>
                </section>
              )}

              {editor.openTemplateId && editor.openVersion !== null && (
                <section aria-label="Publication" className="section-card">
                  <h2>Publication</h2>
                  <PublishSection templateId={editor.openTemplateId} version={editor.openVersion} />
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {confirmSwitch && (
        <ModalDialog label="Unsaved changes" onClose={() => setConfirmSwitch(null)}>
            <h2>Discard unsaved changes?</h2>
            <p>The open template has unsaved edits. Switching now loses them.</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setConfirmSwitch(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const fn = confirmSwitch;
                  setConfirmSwitch(null);
                  fn();
                }}
              >
                Discard and switch
              </button>
            </div>
        </ModalDialog>
      )}
    </div>
  );
}

function PublishSection({ templateId, version }: { templateId: string; version: number }) {
  const versions = useGetTemplateVersionsQuery(templateId);
  const approvals = useListApprovalsQuery({ pending: true });
  const row = (versions.data?.versions ?? []).find((v) => v.version === version);
  const pending = (approvals.data?.approvals ?? []).find(
    (a) => a.scope === 'template_publish' && (a.metadata as Record<string, unknown> | undefined)?.template_id === templateId && (a.metadata as Record<string, unknown> | undefined)?.version === version,
  );
  return (
    <div>
      <p className="status-line num">
        v{version} · {row?.status ?? '…'}
      </p>
      {pending ? (
        <>
          <p className="status-line">Publication approval pending for this version:</p>
          <ApprovalCard approval={pending} />
        </>
      ) : (
        <p className="status-line">No pending publication approval for this version.</p>
      )}
    </div>
  );
}

function apiMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return 'Request failed.';
}
