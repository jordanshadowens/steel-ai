import { useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import type { RootState } from '../store/store';
import {
  steelApi,
  useDecideApprovalMutation,
  useListSkillsQuery,
  useListWorkflowsQuery,
  usePreviewWorkflowMutation,
  usePublishWorkflowMutation,
  useSaveWorkflowMutation,
  useSaveWorkflowVersionMutation,
  useValidateWorkflowMutation,
} from '../api/steelApi';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { acceptSavedDraft, isDirty, setOpenStatus, updateDraft } from '../store/workflowEditor';
import { ModalDialog } from '../app/FocusTrap';
import { savePayload } from './adapter';
import { runPreflight } from './preflight';
import type { PreflightIssue } from './preflight';
import { useNotify } from './notices';

export interface ValidationReport {
  serverErrors: string[];
  preflight: PreflightIssue[];
  valid: boolean;
}

export function apiMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { error?: string; errors?: unknown } }).data;
    if (Array.isArray(data?.errors)) {
      const msgs = (data.errors as unknown[]).filter((e): e is string => typeof e === 'string' && e.trim() !== '');
      if (msgs.length > 0) {
        const shown = msgs.slice(0, 2).join(' ');
        return msgs.length > 2 ? `${shown} (+${msgs.length - 2} more — click Validate for the full list)` : shown;
      }
    }
    if (data?.error) return data.error;
  }
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return 'Request failed.';
}

export function CommandBar({
  onOpenLibrary,
  onOpenSettings,
  onValidated,
  validationStatus,
}: {
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
  onValidated: (report: ValidationReport) => void;
  validationStatus: 'valid' | 'invalid' | null;
}) {
  const dispatch = useAppDispatch();
  const notify = useNotify();
  const editor = useAppSelector((s) => s.workflowEditor);
  const reduxStore = useStore<RootState>();
  const saveLock = useRef(false);
  const failedSnapshot = useRef<string | null>(null);
  const [autoSavePaused, setAutoSavePaused] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const draft = editor.draft;
  const dirty = isDirty(editor);
  const viewport = editor.viewport;
  const library = useListWorkflowsQuery();
  const skills = useListSkillsQuery();
  const [saveNew, saveNewState] = useSaveWorkflowMutation();
  const [saveVersion, saveVersionState] = useSaveWorkflowVersionMutation();
  const [validate, validateState] = useValidateWorkflowMutation();
  const [preview, previewState] = usePreviewWorkflowMutation();
  const [publish, publishState] = usePublishWorkflowMutation();
  const [decide, decideState] = useDecideApprovalMutation();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{ approval_id: number } | null>(null);
  const [comment, setComment] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState<{ entry?: string; order?: Array<{ step_id: string; type: string }>; gates?: Array<{ step_id: string; prompt?: string }>; skills?: Array<{ step_id: string; skill?: string; from?: string }> } | null>(null);
  const saving = saveNewState.isLoading || saveVersionState.isLoading;

  useEffect(() => {
    if (!draft || editor.openVersion === null || !dirty || saving || autoSavePaused || saveLock.current || !draft.workflow_id.trim()) return;
    if (failedSnapshot.current === JSON.stringify(draft)) return;
    const timer = window.setTimeout(() => { void doSave(true); }, 800);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, saving, autoSavePaused, editor.openVersion]);
  useEffect(() => { setAutoSavePaused(false); failedSnapshot.current = null; }, [editor.openWorkflowId]);

  if (!draft) return null;
  const idKnown = (library.data?.workflows ?? []).some((w) => w.workflow_id === draft.workflow_id);
  const canSave = draft.workflow_id.trim() !== '' && !saving;
  const canPublish = editor.openVersion !== null && !dirty && !publishState.isLoading;

  const setName = (name: string) => {
    dispatch(updateDraft({ ...draft, name }));
  };

  const doSave = async (automatic = false) => {
    if (saveLock.current) return;
    if (!canSave) {
      notify('error', 'Set a workflow id first.');
      return;
    }
    saveLock.current = true;
    const baseSavedJson = editor.savedJson;
    const baseOpenId = editor.openWorkflowId;
    try {
      // Stale-version check: saving never overwrites, but tell the user when
      // their base is behind the server's latest.
      let baseNote = '';
      if (idKnown) {
        const res = await dispatch(steelApi.endpoints.getWorkflowVersions.initiate(draft.workflow_id));
        const latest = res.data?.versions?.[0]?.version;
        if (latest != null && editor.openVersion != null && latest > editor.openVersion) {
          baseNote = ` Server already has v${latest}; your save is based on v${editor.openVersion}.`;
        }
      }
      const body = { definition: savePayload(draft, viewport), created_by: 'human' };
      const res = editor.openVersion === null && !idKnown
        ? await saveNew(body).unwrap()
        : await saveVersion({ id: draft.workflow_id, ...body }).unwrap();
      if (!res.ok || !res.row) throw new Error('Save failed.');
      const current = reduxStore.getState().workflowEditor;
      if (current.openWorkflowId !== baseOpenId || current.savedJson !== baseSavedJson) return;
      dispatch(acceptSavedDraft({ definition: draft, version: res.row.version, status: res.row.status }));
      failedSnapshot.current = null;
      setAutoSavePaused(false);
      if (!automatic) notify('ok', `Saved v${res.row.version} as draft.${baseNote}`);
    } catch (err) {
      failedSnapshot.current = JSON.stringify(draft);
      setAutoSavePaused(true);
      notify('error', `${automatic ? 'Auto save paused' : 'Save failed'}: ${apiMessage(err)} Your draft is kept locally. Click Save to retry.`);
    } finally { saveLock.current = false; }
  };

  const doValidate = async () => {
    try {
      const res = await validate({ definition: savePayload(draft, viewport) }).unwrap();
      const preflight = runPreflight(draft, skills.data?.skills ?? []);
      const report = { serverErrors: res.ok ? [] : res.errors, preflight, valid: res.ok && !preflight.some((p) => p.severity === 'error') };
      onValidated(report);
      if (report.valid) notify('ok', 'Definition is valid.');
    } catch (err) {
      notify('error', `Validate failed: ${apiMessage(err)}`);
    }
  };

  const doPreview = async () => {
    try {
      const res = await preview({ definition: savePayload(draft, viewport) }).unwrap();
      if (!res.ok) {
        onValidated({ serverErrors: res.errors, preflight: runPreflight(draft, skills.data?.skills ?? []), valid: false });
        return;
      }
      setPlan(res.plan ?? null);
      setPlanOpen(true);
    } catch (err) {
      notify('error', `Preview failed: ${apiMessage(err)}`);
    }
  };

  const doPublish = async () => {
    if (editor.openVersion === null || dirty) return;
    setReviewOpen(false);
    try {
      const res = await publish({ id: draft.workflow_id, version: editor.openVersion }).unwrap();
      setPendingApproval({ approval_id: res.approval_id });
      notify('ok', `Publish requested: approval #${res.approval_id} pending.`);
    } catch (err) {
      notify('error', `Publish failed: ${apiMessage(err)}`);
    }
  };

  const doDecide = async (decision: 'approved' | 'rejected') => {
    if (!pendingApproval) return;
    try {
      await decide({ id: pendingApproval.approval_id, decision, decided_by: 'human', comment: comment.trim() || undefined }).unwrap();
      setPendingApproval(null);
      setComment('');
      dispatch(setOpenStatus(decision === 'approved' ? 'published' : 'draft'));
      notify('ok', decision === 'approved' ? `Published v${editor.openVersion}. Open it in the Runner to execute.` : 'Publish rejected; still a draft.');
    } catch (err) {
      notify('error', `Decision failed: ${apiMessage(err)}`);
    }
  };

  return (
    <div className="command-bar" role="toolbar" aria-label="Workflow commands">
      <div className="workflow-menu-wrap">
        <button type="button" className="btn icon-button" aria-label="Workflow menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} title="Workflow menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16" /></svg>
        </button>
        {menuOpen && <div className="workflow-menu" onKeyDown={(e) => { if (e.key === 'Escape') setMenuOpen(false); }}>
          <button type="button" className="btn" onClick={() => { setMenuOpen(false); onOpenLibrary(); }}>Workflows</button>
          <button type="button" className="btn" onClick={() => { setMenuOpen(false); onOpenSettings(); }}>Workflow settings</button>
        </div>}
      </div>
      <input
        className="command-name"
        ref={nameInput}
        readOnly={!editingName}
        aria-label="Workflow name"
        placeholder="Workflow name"
        value={draft.name ?? ''}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setEditingName(false)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
      />
      <button type="button" className="btn icon-button" aria-label="Edit workflow name" onClick={() => { setEditingName(true); nameInput.current?.focus(); }} title="Edit workflow name"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m16 3 5 5-13 13H3v-5ZM14 5l5 5" /></svg></button>
      <span className="status-line num" role="status">
        {editor.openStatus ?? 'new'}
        {editor.openVersion !== null ? ` v${editor.openVersion}` : ''}
        {saving ? ' · saving…' : autoSavePaused ? ' · auto save paused — click Save to retry' : dirty ? ' · unsaved changes' : ' · saved'}
        {validationStatus === 'valid' ? ' · valid' : validationStatus === 'invalid' ? ' · has issues' : ''}
      </span>
      <span className="command-spacer" />
      <button type="button" className="btn btn-primary" disabled={!canSave} title={draft.workflow_id.trim() === '' ? 'Set a workflow id in Settings first' : saving ? 'Saving…' : 'Save as a new draft version'} onClick={() => void doSave()}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="btn" disabled={validateState.isLoading} title="Check this definition against the server rules" onClick={() => void doValidate()}>
        {validateState.isLoading ? 'Validating…' : 'Validate'}
      </button>
      <button type="button" className="btn" disabled={previewState.isLoading} title="Show the execution plan without running" onClick={() => void doPreview()}>
        Preview
      </button>
      <button
        type="button"
        className="btn"
        disabled={!canPublish}
        title={editor.openVersion === null || dirty ? 'Save the workflow first' : 'Request publication approval'}
        onClick={() => setReviewOpen(true)}
      >
        Publish
      </button>

      {reviewOpen && (
        <ModalDialog label="Review publication" onClose={() => setReviewOpen(false)}>
            <h2>Publish v{editor.openVersion}?</h2>
            <p>
              Publication requests human approval. Once published, this version becomes immutable and runnable; further edits create a new draft version.
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setReviewOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={publishState.isLoading} onClick={() => void doPublish()}>
                {publishState.isLoading ? 'Requesting…' : 'Request approval'}
              </button>
            </div>
        </ModalDialog>
      )}

      {pendingApproval && (
        <ModalDialog label="Publication approval" onClose={() => setPendingApproval(null)}>
            <h2>Approval #{pendingApproval.approval_id} pending</h2>
            <p>Decide publication of {draft.workflow_id} v{editor.openVersion}.</p>
            <div className="field">
              <span><label htmlFor="publish-comment">Comment (optional)</label></span>
              <input id="publish-comment" type="text" value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-danger" disabled={decideState.isLoading} onClick={() => void doDecide('rejected')}>
                Reject
              </button>
              <button type="button" className="btn btn-primary" disabled={decideState.isLoading} onClick={() => void doDecide('approved')}>
                Approve
              </button>
            </div>
        </ModalDialog>
      )}

      {planOpen && (
        <ModalDialog label="Execution plan" wide onClose={() => setPlanOpen(false)}>
            <h2>Execution plan</h2>
            <p className="status-line num">Entry {plan?.entry}: {(plan?.order ?? []).map((s) => s.step_id).join(' → ')}</p>
            {(plan?.gates ?? []).map((g) => (
              <p key={g.step_id}>Approval gate at {g.step_id} — {g.prompt}</p>
            ))}
            {(plan?.skills ?? []).map((s) => (
              <p key={s.step_id}>Skill at {s.step_id}: {s.skill ?? s.from ?? '(natural language)'}</p>
            ))}
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={() => setPlanOpen(false)}>
                Close
              </button>
            </div>
        </ModalDialog>
      )}
    </div>
  );
}
