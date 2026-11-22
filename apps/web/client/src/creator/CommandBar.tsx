import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import type { WorkflowDefinition } from '../api/contracts';
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
import {
  acceptSavedDraft,
  isDirty,
  setOpenStatus,
  updateDraft,
} from '../store/workflowEditor';
import { ModalDialog } from '../app/FocusTrap';
import { savePayload, workflowCheckKey } from './adapter';
import { runPreflight } from './preflight';
import type { PreflightIssue } from './preflight';
import type { RunPlan, RunPlanSteps } from './RunPlanSteps';
import { useNotify } from './notices';
import { serverErrorList, workflowErrorMessage } from './workflowErrors';

export interface ValidationReport {
  serverErrors: string[];
  preflight: PreflightIssue[];
  valid: boolean;
}

const duplicateWorkflowIdMessage = 'That workflow ID is already in use. Enter a different ID in Settings.';

export function apiMessage(err: unknown): string {
  const messages = serverErrorList(err);
  if (messages.length > 0) {
    const shown = messages.slice(0, 2).join(' ');
    return messages.length > 2
      ? `${shown} (+${messages.length - 2} more — click Validate for the full list)`
      : shown;
  }
  return workflowErrorMessage(err) ?? 'Request failed.';
}

export function CommandBar({
  onOpenLibrary,
  onOpenSettings,
  onGoToInput,
  onValidated,
  onGoToStep,
  validationStatus,
}: {
  onOpenLibrary: (trigger: HTMLButtonElement) => void;
  onOpenSettings: (focusWorkflowId?: boolean) => void;
  onGoToInput?: (index: number) => void;
  onValidated: (report: ValidationReport, reveal?: boolean) => void;
  onGoToStep?: (id: string, bodyStep?: string, outputName?: string, routeField?: PreflightIssue['routeField']) => void;
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
  const draft = editor.draft;
  const dirty = isDirty(editor);
  const viewport = editor.viewport;
  const library = useListWorkflowsQuery();
  const skills = useListSkillsQuery();
  const [saveNew] = useSaveWorkflowMutation();
  const [saveVersion] = useSaveWorkflowVersionMutation();
  const [validate, validateState] = useValidateWorkflowMutation();
  const [preview] = usePreviewWorkflowMutation();
  const [planning, setPlanning] = useState(false);
  const [publish, publishState] = usePublishWorkflowMutation();
  const [decide, decideState] = useDecideApprovalMutation();
  const [publicationReview, setPublicationReview] = useState<{
    openSequence: number;
    workflowId: string;
    workflowName: string;
    version: number;
  } | null>(null);
  const review = publicationReview?.openSequence === editor.openSequence ? publicationReview : null;
  const [pendingApproval, setPendingApproval] = useState<{
    approvalId: number;
    workflowId: string;
    workflowName: string;
    version: number;
  } | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [previewed, setPreviewed] = useState<{
    plan: RunPlan;
    Steps: typeof RunPlanSteps;
    definition: WorkflowDefinition;
    version: number | null;
    unsaved: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (
      autoSavePaused &&
      (!dirty || (draft && failedSnapshot.current !== JSON.stringify(draft)))
    ) {
      setAutoSavePaused(false);
    }
  }, [draft, dirty, autoSavePaused]);

  useEffect(() => {
    if (
      !draft ||
      editor.openVersion === null ||
      !dirty ||
      saving ||
      saveLock.current ||
      !draft.workflow_id.trim()
    ) {
      return;
    }
    if (failedSnapshot.current === JSON.stringify(draft)) {
      return;
    }
    const timer = window.setTimeout(() => {
      void doSave(true);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, saving, autoSavePaused, editor.openVersion]);
  useEffect(() => {
    setAutoSavePaused(false);
    failedSnapshot.current = null;
  }, [editor.openWorkflowId]);

  const saveFromKeyboard = useEffectEvent(() => {
    if (draft) void doSave();
  });

  useEffect(() => {
    function onSaveShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey ||
          !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') {
        return;
      }
      event.preventDefault();
      if (event.repeat) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest('[role="dialog"]')) return;
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
        focused.blur();
      }
      saveFromKeyboard();
    }
    window.addEventListener('keydown', onSaveShortcut);
    return () => window.removeEventListener('keydown', onSaveShortcut);
  }, []);

  if (!draft) return null;
  const canPublish =
    editor.openVersion !== null &&
    editor.openStatus !== 'published' &&
    !dirty &&
    !saving &&
    !publishState.isLoading &&
    !pendingApproval;

  const setName = (name: string) => {
    dispatch(updateDraft({ ...draft, name }));
  };

  const doSave = async (automatic = false) => {
    if (saveLock.current) return;
    const editor = reduxStore.getState().workflowEditor;
    const draft = editor.draft;
    if (!draft || (automatic && !isDirty(editor))) return;
    if (!draft.workflow_id.trim()) {
      onOpenSettings(true);
      notify('error', 'Enter a workflow ID in Settings.', `save-${editor.openSequence}`);
      return;
    }
    const viewport = editor.viewport;
    const idKnown = (library.data?.workflows ?? []).some(
      (workflow) => workflow.workflow_id === draft.workflow_id,
    );
    if (editor.openVersion === null && idKnown) {
      onOpenSettings(true);
      notify('error', duplicateWorkflowIdMessage, `save-${editor.openSequence}`);
      return;
    }
    saveLock.current = true;
    setSaving(true);
    const baseSavedJson = editor.savedJson;
    const baseOpenSequence = editor.openSequence;
    try {
      // Manual saves explain when the draft started from an older version.
      let baseNote = '';
      if (idKnown && !automatic && editor.openVersion !== null) {
        const res = await dispatch(
          steelApi.endpoints.getWorkflowVersions.initiate(draft.workflow_id, {
            subscribe: false,
            forceRefetch: true,
          }),
        );
        const latest = res.data?.versions.reduce((highest, row) => Math.max(highest, row.version), editor.openVersion);
        if (latest !== undefined && latest > editor.openVersion) {
          baseNote = ` Based on v${editor.openVersion}. The latest saved version before this was v${latest}.`;
        }
      }
      const body = {
        definition: savePayload(draft, viewport),
        created_by: 'human',
      };
      const res =
        editor.openVersion === null
          ? await saveNew(body).unwrap()
          : await saveVersion({ id: draft.workflow_id, ...body }).unwrap();
      if (!res.ok || !res.row) {
        throw new Error('Save failed.');
      }
      const current = reduxStore.getState().workflowEditor;
      if (
        current.openSequence !== baseOpenSequence ||
        current.savedJson !== baseSavedJson
      ) {
        return;
      }
      dispatch(
        acceptSavedDraft({
          definition: draft,
          version: res.row.version,
          status: res.row.status,
        }),
      );
      failedSnapshot.current = null;
      setAutoSavePaused(false);
      if (!automatic) {
        notify('ok', `Saved v${res.row.version} as draft.${baseNote}`, `save-${baseOpenSequence}`);
      }
    } catch (err) {
      const current = reduxStore.getState().workflowEditor;
      if (current.openSequence !== baseOpenSequence) return;
      if (editor.openVersion === null && err && typeof err === 'object' && 'status' in err && err.status === 409) {
        void library.refetch();
        if (current.draft?.workflow_id === draft.workflow_id) {
          onOpenSettings(true);
          notify('error', duplicateWorkflowIdMessage, `save-${baseOpenSequence}`);
        }
        return;
      }
      const serverErrors = serverErrorList(err);
      const hasCurrentIssues = serverErrors.length > 0 && current.draft !== null &&
        workflowCheckKey(current.draft) === workflowCheckKey(draft);
      if (hasCurrentIssues) {
        onValidated({ serverErrors, preflight: runPreflight(draft, skills.data?.skills ?? []), valid: false }, !automatic);
      }
      failedSnapshot.current = JSON.stringify(draft);
      setAutoSavePaused(true);
      notify(
        'error',
        `${automatic ? 'Autosave paused' : 'Save failed'}: ${hasCurrentIssues ? 'See Issues for details.' : apiMessage(err)} Your edits are still in this draft. Click Save to try again.`,
        `save-${baseOpenSequence}`,
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const checkKey = workflowCheckKey(draft);
  const checkStillApplies = () => {
    const current = reduxStore.getState().workflowEditor;
    return current.openSequence === editor.openSequence &&
      current.draft !== null && workflowCheckKey(current.draft) === checkKey;
  };

  const reportCheckFailure = (err: unknown, message: string) => {
    if (!checkStillApplies()) return;
    const serverErrors = serverErrorList(err);
    if (serverErrors.length > 0) {
      onValidated({ serverErrors, preflight: runPreflight(draft, skills.data?.skills ?? []), valid: false });
    } else {
      notify('error', `${message}: ${apiMessage(err)}`);
    }
  };

  const doValidate = async () => {
    try {
      const res = await validate({
        definition: savePayload(draft, viewport),
      }).unwrap();
      if (!checkStillApplies()) {
        return;
      }
      const preflight = runPreflight(draft, skills.data?.skills ?? []);
      const report = {
        serverErrors: res.ok ? [] : (res.errors ?? []),
        preflight,
        valid: res.ok && !preflight.some((p) => p.severity === 'error'),
      };
      onValidated(report);
      if (report.valid) {
        const warnings = preflight.length;
        notify('ok', warnings
          ? `No errors. See Issues for ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}.`
          : 'No validation errors.');
      } else if (!res.ok && !report.serverErrors.length && !preflight.some(({ severity }) => severity === 'error')) {
        notify('error', 'Validation failed without an explanation. Try Validate again.');
      }
    } catch (err) {
      reportCheckFailure(err, 'Could not validate');
    }
  };

  const doPreview = async () => {
    setPlanning(true);
    try {
      const res = await preview({
        definition: savePayload(draft, viewport),
      }).unwrap();
      if (!checkStillApplies()) {
        return;
      }
      if (!res.ok) {
        const serverErrors = res.errors ?? [];
        const preflight = runPreflight(draft, skills.data?.skills ?? []);
        onValidated({
          serverErrors,
          preflight,
          valid: false,
        });
        if (!serverErrors.length && !preflight.some(({ severity }) => severity === 'error')) {
          notify('error', 'Preview failed without an explanation. Try Preview again.');
        }
        return;
      }
      if (!res.plan) {
        notify('error', 'No run plan was returned. Try Preview again.');
        return;
      }
      const runPlanModule = await import('./RunPlanSteps').catch(() => null);
      if (!checkStillApplies()) return;
      if (!runPlanModule) {
        notify('error', dirty ? 'Could not load Preview. Save your changes, then reload the page.' : 'Could not load Preview. Reload the page and try again.');
        return;
      }
      const { RunPlanSteps: Steps } = runPlanModule;
      setPreviewed({ plan: res.plan, Steps, definition: draft, version: editor.openVersion, unsaved: dirty });
    } catch (err) {
      reportCheckFailure(err, 'Could not load the run plan');
    } finally {
      setPlanning(false);
    }
  };

  const isOpenVersion = (target: { workflowId: string; version: number }) => {
    const current = reduxStore.getState().workflowEditor;
    return current.openSequence === editor.openSequence &&
      current.openWorkflowId === target.workflowId &&
      current.openVersion === target.version;
  };

  const doPublish = async () => {
    if (!review || !canPublish) return;
    const { workflowId, workflowName, version } = review;
    const target = { workflowId, workflowName, version };
    if (!isOpenVersion(target) || isDirty(reduxStore.getState().workflowEditor)) return;
    const noticeKey = `publish:${workflowId}:${version}`;

    setPublicationReview(null);
    try {
      const res = await publish({ id: target.workflowId, version: target.version }).unwrap();
      notify('ok', `Requested approval for ${target.workflowId} v${target.version}.`, noticeKey);
      if (reduxStore.getState().workflowEditor.openSequence !== editor.openSequence) {
        return;
      }
      setPendingApproval({ ...target, approvalId: res.approval_id });
      setApprovalOpen(true);
    } catch (err) {
      const retry = isOpenVersion(target) ? ' Open Publish to try again.' : '';
      notify('error', `Could not request approval for ${target.workflowId} v${target.version}: ${apiMessage(err)}${retry}`, noticeKey);
    }
  };

  const doDecide = async (decision: 'approved' | 'rejected') => {
    if (!pendingApproval) return;
    const target = pendingApproval;
    setDecisionError(null);
    try {
      await decide({
        id: target.approvalId,
        decision,
        decided_by: 'human',
        comment: comment.trim() || undefined,
      }).unwrap();
      setApprovalOpen(false);
      setPendingApproval(null);
      setComment('');
      if (isOpenVersion(target)) {
        dispatch(setOpenStatus(decision === 'approved' ? 'published' : 'draft'));
      }
      notify('ok', decision === 'approved'
        ? `Published ${target.workflowId} v${target.version}.`
        : `Publication rejected for ${target.workflowId} v${target.version}. It remains a draft.`,
        `publish:${target.workflowId}:${target.version}`);
    } catch (err) {
      setDecisionError(`Could not save the decision. ${apiMessage(err)} Try again.`);
    }
  };

  return (
    <div className="command-bar" role="toolbar" aria-label="Workflow commands">
      <div className="command-nav" role="group" aria-label="Workflow navigation">
        <button type="button" className="btn" onClick={(event) => onOpenLibrary(event.currentTarget)}>
          Workflows
        </button>
        <button type="button" className="btn" onClick={() => onOpenSettings()}>
          Settings
        </button>
      </div>
      <div className="command-identity">
        <div className="command-title">
          <input
            className="command-name"
            ref={nameInput}
            readOnly={!editingName}
            aria-label="Workflow name"
            placeholder="Workflow name"
            value={draft.name ?? ''}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.currentTarget.blur();
              }
            }}
          />
          <button
            type="button"
            className="btn icon-button"
            aria-label="Edit workflow name"
            onClick={() => {
              setEditingName(true);
              nameInput.current?.focus();
            }}
            title="Edit workflow name"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m16 3 5 5-13 13H3v-5ZM14 5l5 5" />
            </svg>
          </button>
        </div>
        <span className="status-line num" role="status">
          {editor.openStatus === 'published' && dirty ? 'draft from published' : editor.openStatus ?? 'new'}
          {editor.openVersion !== null ? ` v${editor.openVersion}` : ''}
          {saving
            ? ' · saving…'
            : autoSavePaused
              ? ' · autosave paused'
              : editor.openVersion === null
                ? ' · unsaved'
                : dirty
                  ? ' · unsaved changes'
                  : ' · saved'}
          {validationStatus === 'valid'
            ? ' · valid'
            : validationStatus === 'invalid'
              ? ' · has issues'
              : ''}
        </span>
      </div>
      <div className="command-actions" role="group" aria-label="Workflow actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          aria-keyshortcuts="Control+S Meta+S"
          title={
            draft.workflow_id.trim() === ''
              ? 'Set a workflow id in Settings first'
              : saving
                ? 'Saving…'
                : 'Save as a new draft version'
          }
          onClick={() => void doSave()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn"
          aria-disabled={validateState.isLoading}
          title="Check inputs, steps, and connections"
          onClick={(event) => {
            if (validateState.isLoading) return;
            event.currentTarget.focus({ preventScroll: true });
            void doValidate();
          }}
        >
          {validateState.isLoading ? 'Validating…' : 'Validate'}
        </button>
        <button
          type="button"
          className="btn"
          aria-disabled={planning}
          aria-busy={planning}
          title="See what would run"
          onClick={(event) => {
            if (planning) return;
            event.currentTarget.focus({ preventScroll: true });
            void doPreview();
          }}
        >
          {planning ? 'Planning…' : 'Preview'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!canPublish}
          aria-busy={publishState.isLoading}
          title={
            editor.openVersion === null || dirty
              ? 'Save the workflow first'
              : 'Review this version for publication'
          }
          onClick={(event) => {
            if (editor.openVersion === null) return;
            event.currentTarget.focus({ preventScroll: true });
            setPublicationReview({
              openSequence: editor.openSequence,
              workflowId: draft.workflow_id,
              workflowName: draft.name || draft.workflow_id,
              version: editor.openVersion,
            });
          }}
        >
          {publishState.isLoading ? 'Requesting approval…' : 'Publish'}
        </button>

        {pendingApproval && !approvalOpen && (
          <button type="button" className="btn command-approval" onClick={() => setApprovalOpen(true)}>
            Review approval for v{pendingApproval.version}
          </button>
        )}
      </div>
      {review && (
        <ModalDialog
          label="Review publication"
          onClose={() => setPublicationReview(null)}
        >
          <h2>Publish v{review.version}?</h2>
          <dl className="run-plan-routes" aria-label="Version to publish">
            <div><dt>Workflow</dt><dd>{review.workflowName}</dd></div>
            <div><dt>Workflow ID</dt><dd>{review.workflowId}</dd></div>
          </dl>
          <p>
            {editor.openVersion !== review.version
              ? 'A newer version was saved. Close this review to publish that version.'
              : dirty
                ? 'Save your changes first, then open Publish again.'
                : 'This version can run after approval. Future edits go into a new draft.'}
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setPublicationReview(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canPublish || editor.openVersion !== review.version}
              onClick={() => void doPublish()}
            >
              Request approval
            </button>
          </div>
        </ModalDialog>
      )}

      {pendingApproval && approvalOpen && (
        <ModalDialog
          label="Publication approval"
          onClose={() => { if (!decideState.isLoading) setApprovalOpen(false); }}
        >
          <h2>Review v{pendingApproval.version}</h2>
          <dl className="run-plan-routes" aria-label="Version under review">
            <div><dt>Workflow</dt><dd>{pendingApproval.workflowName}</dd></div>
            <div><dt>Workflow ID</dt><dd>{pendingApproval.workflowId}</dd></div>
            <div><dt>Approval</dt><dd>#{pendingApproval.approvalId}</dd></div>
          </dl>
          {editor.openVersion !== pendingApproval.version && (
            <p>This decision applies to v{pendingApproval.version}. The editor is open to v{editor.openVersion}.</p>
          )}
          <div className="field">
            <span>
              <label htmlFor="publish-comment">Comment (optional)</label>
            </span>
            <input
              id="publish-comment"
              type="text"
              value={comment}
              disabled={decideState.isLoading}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <div role="status">{decideState.isLoading && 'Saving decision…'}</div>
          {decisionError && <p className="status-bad" role="alert">{decisionError}</p>}
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-danger"
              disabled={decideState.isLoading}
              onClick={() => void doDecide('rejected')}
            >
              Reject
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={decideState.isLoading}
              onClick={() => void doDecide('approved')}
            >
              Approve
            </button>
          </div>
        </ModalDialog>
      )}

      {previewed && (
        <ModalDialog
          label="Run plan"
          wide
          onClose={() => setPreviewed(null)}
        >
          <h2>Run plan</h2>
          <p className="status-line">Preview shows what would run. No steps have run.</p>
          <dl className="run-plan-routes" aria-label="Previewed workflow">
            <div><dt>Workflow</dt><dd>{previewed.definition.name || previewed.definition.workflow_id || 'Untitled'}</dd></div>
            {previewed.definition.name && previewed.definition.workflow_id && previewed.definition.name !== previewed.definition.workflow_id && (
              <div><dt>Workflow ID</dt><dd>{previewed.definition.workflow_id}</dd></div>
            )}
            <div>
              <dt>Version</dt>
              <dd>{previewed.unsaved || previewed.version === null ? 'Unsaved draft' : `v${previewed.version}`}</dd>
            </div>
          </dl>
          <previewed.Steps
            plan={previewed.plan}
            definition={previewed.definition}
            onOpenSettings={() => {
              setPreviewed(null);
              onOpenSettings();
            }}
            onGoToInput={onGoToInput && ((index) => {
              setPreviewed(null);
              onGoToInput(index);
            })}
            onGoToStep={onGoToStep && ((id, bodyStep, outputName, routeField) => {
              setPreviewed(null);
              onGoToStep(id, bodyStep, outputName, routeField);
            })}
          />
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setPreviewed(null)}
            >
              Close
            </button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
