import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'react-redux';
import type { WorkflowVersionRow } from '../api/contracts';
import { getSession, sessionIsCurrent } from '../auth/session';
import {
  steelApi,
  useDraftWorkflowMutation,
  useSaveWorkflowMutation,
  useSaveWorkflowVersionMutation,
  useValidateWorkflowMutation,
} from '../api/steelApi';
import { ModalDialog } from '../app/FocusTrap';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import type { RootState } from '../store/store';
import {
  assistComposerChanged, assistConversationCleared, assistMessageAdded, assistReplyAdded,
} from '../store/workflowAssist';
import { isDirty, openDefinition } from '../store/workflowEditor';
import { findMatchingSave, saveOutcomeUnknown } from './assistSaveRecovery';
import { serverErrorList, workflowErrorMessage } from './workflowErrors';
import './workflow-assist.css';

type AssistRequest = { prompt: string; epoch: number; openWhenSaved: boolean; abort?: () => void };

const progressLabels = {
  generate: 'Designing workflow',
  revise: 'Revising draft',
  validate: 'Checking workflow',
  save: 'Saving draft',
  confirm: 'Checking whether the draft was saved',
};

const starters = [
  'Route purchase requests for approval',
  'Summarize a customer support request',
];

function Sparkle() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10 2.5c.8 4.8 2.7 6.7 7.5 7.5-4.8.8-6.7 2.7-7.5 7.5C9.2 12.7 7.3 10.8 2.5 10 7.3 9.2 9.2 7.3 10 2.5Z" />
      <path d="M18.5 13.5c.4 2.5 1.5 3.6 4 4-2.5.4-3.6 1.5-4 4-.4-2.5-1.5-3.6-4-4 2.5-.4 3.6-1.5 4-4Z" />
    </svg>
  );
}

function DraftMessage({ row, opened, onOpen, loading }: {
  row: WorkflowVersionRow;
  opened: boolean;
  onOpen?: () => void;
  loading: boolean;
}) {
  const steps = row.definition.steps ?? [];
  return (
    <div className="assist-draft">
      <strong>{row.definition.name || row.workflow_id}</strong>
      <span>Draft v{row.version} · {opened ? 'Opened in canvas' : 'Saved to workflow library'}</span>
      {steps.length > 0 && (
        <details className="assist-draft-outline">
          <summary>{steps.length} {steps.length === 1 ? 'step' : 'steps'}</summary>
          <ol>{steps.map((step) => <li key={step.step_id}>{step.name || step.step_id}</li>)}</ol>
        </details>
      )}
      {onOpen && (
        <button className="assist-text-button" type="button" onClick={onOpen} disabled={loading}>
          {loading ? 'Opening draft…' : 'Open draft'}
        </button>
      )}
    </div>
  );
}

export function WorkflowAssist({ dock }: { dock: HTMLDivElement | null }) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<keyof typeof progressLabels | null>(null);
  const [draftToOpen, setDraftToOpen] = useState<WorkflowVersionRow | null>(null);
  const [openingDraft, setOpeningDraft] = useState(false);
  const [openError, setOpenError] = useState('');
  const request = useRef<AssistRequest | null>(null);
  const openRequest = useRef<object | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const commandLauncher = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const [generate] = useDraftWorkflowMutation();
  const [validate] = useValidateWorkflowMutation();
  const [save] = useSaveWorkflowMutation();
  const [saveVersion] = useSaveWorkflowVersionMutation();
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const { messages, previous, clarifications, composer: prompt } = useAppSelector((state) => state.workflowAssist);
  const workflowId = useAppSelector((state) => state.workflowEditor.openWorkflowId);
  const workflowVersion = useAppSelector((state) => state.workflowEditor.openVersion);

  useEffect(() => {
    if (open) composer.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => () => {
    const active = request.current;
    request.current = null;
    if (active) {
      active.abort?.();
      if (sessionIsCurrent(active.epoch)) {
        dispatch(assistMessageAdded(active.abort ? {
          kind: 'error', prompt: active.prompt, text: 'Response stopped when you left Creator.',
        } : {
          kind: 'reply', text: 'The save was already submitted. Check the workflow library for the result.',
        }));
      }
    }
    openRequest.current = null;
  }, [dispatch]);

  useEffect(() => {
    const log = transcript.current;
    if (open && log) log.scrollTop = log.scrollHeight;
  }, [messages, progress, openError, open]);

  function close() {
    if (request.current) request.current.openWhenSaved = false;
    openRequest.current = null;
    setOpeningDraft(false);
    setOpen(false);
    const trigger = commandLauncher.current?.getClientRects().length ? commandLauncher.current : launcher.current;
    trigger?.focus({ preventScroll: true });
  }

  function setPrompt(value: string) {
    dispatch(assistComposerChanged(value));
  }

  function openDraft(row: WorkflowVersionRow) {
    dispatch(openDefinition({
      workflowId: row.workflow_id,
      version: row.version,
      status: row.status,
      definition: row.definition,
    }));
  }

  async function requestOpenDraft(row: WorkflowVersionRow) {
    if (openRequest.current) return;
    setOpenError('');
    setOpeningDraft(true);
    const sequence = store.getState().workflowEditor.openSequence;
    const pendingOpen = dispatch(steelApi.endpoints.getWorkflowVersions.initiate(row.workflow_id, {
      subscribe: false, forceRefetch: true,
    }));
    openRequest.current = pendingOpen;
    const isCurrent = () => openRequest.current === pendingOpen &&
      store.getState().workflowEditor.openSequence === sequence;
    try {
      const { versions } = await pendingOpen.unwrap();
      if (!isCurrent()) return;
      const saved = versions.find(({ version }) => version === row.version);
      if (!saved || saved.deleted_at) {
        setOpenError('This draft is no longer available. Check the workflow library.');
        return;
      }
      const editor = store.getState().workflowEditor;
      if (editor.draft && (editor.openVersion === null || isDirty(editor))) {
        setDraftToOpen(saved);
      } else {
        composer.current?.focus();
        openDraft(saved);
      }
    } catch (error) {
      if (isCurrent()) {
        setOpenError(workflowErrorMessage(error) || 'Could not open this draft. Try again.');
      }
    } finally {
      if (openRequest.current === pendingOpen) {
        openRequest.current = null;
        setOpeningDraft(false);
      }
    }
  }

  function newChat() {
    if (request.current || openRequest.current) return;
    dispatch(assistConversationCleared());
    setOpenError('');
    composer.current?.focus();
  }

  function stop() {
    const active = request.current;
    if (!active?.abort) return;
    request.current = null;
    active.abort();
    dispatch(assistMessageAdded({ kind: 'error', text: 'Response stopped.', prompt: active.prompt }));
    setProgress(null);
    composer.current?.focus();
  }

  async function send(description: string) {
    if (!description || request.current) return;
    const active: AssistRequest = { prompt: description, epoch: getSession().epoch, openWhenSaved: true };
    request.current = active;
    composer.current?.focus({ preventScroll: true });
    const isCurrent = () => request.current === active && sessionIsCurrent(active.epoch);
    dispatch(assistMessageAdded({ kind: 'prompt', text: description }));
    setPrompt('');
    setProgress(previous ? 'revise' : 'generate');
    const before = store.getState().workflowEditor;
    const base = previous;
    try {
      const currentBase = base && before.draft?.workflow_id === base.workflow_id &&
        before.openVersion !== null && before.openVersion >= base.version && !isDirty(before)
        ? before.draft
        : base?.definition;
      const generation = generate({
        prompt: description,
        previous: currentBase,
        clarifications: clarifications.length ? clarifications : undefined,
      });
      active.abort = generation.abort;
      const result = await generation.unwrap();
      if (!isCurrent()) return;
      if ('message' in result) {
        dispatch(assistReplyAdded({ prompt: description, reply: result.message }));
        return;
      }
      const definition = currentBase ? {
        ...result.definition,
        policy: currentBase.policy ?? result.definition.policy,
        limits: currentBase.limits ?? result.definition.limits,
      } : result.definition;
      setProgress('validate');
      const check = validate({ definition });
      active.abort = check.abort;
      const validation = await check.unwrap();
      if (!isCurrent()) return;
      if (!validation.ok) {
        dispatch(assistMessageAdded({
          kind: 'error',
          prompt: description,
          text: validation.errors?.slice(0, 2).join(' ') ||
            'The generated workflow did not pass validation. Try clarifying the steps.',
        }));
        return;
      }
      active.abort = undefined;
      setProgress('save');
      const payload = { definition, created_by: 'ai_assist' };
      let row: WorkflowVersionRow | undefined;
      try {
        const saved = base
          ? await saveVersion({ id: base.workflow_id, ...payload }).unwrap()
          : await save(payload).unwrap();
        if (!saved.ok || !saved.row) throw new Error('Missing save acknowledgement.');
        row = saved.row;
      } catch (error) {
        if (!isCurrent()) return;
        if (!saveOutcomeUnknown(error)) throw error;
        setProgress('confirm');
        const latest = await dispatch(steelApi.endpoints.getWorkflowVersions.initiate(definition.workflow_id, {
          subscribe: false, forceRefetch: true,
        }));
        if (!isCurrent()) return;
        const baseVersion = currentBase === before.draft ? before.openVersion ?? 0 : base?.version ?? 0;
        row = findMatchingSave(latest.data?.versions ?? [], definition, baseVersion);
        if (!row) {
          dispatch(assistMessageAdded({
            kind: 'reply',
            text: 'I couldn’t confirm the save. Check the workflow library before sending the same request again.',
          }));
          return;
        }
      }
      if (!isCurrent()) return;
      const current = store.getState().workflowEditor;
      const opened = active.openWhenSaved && current.openSequence === before.openSequence && current.draft === before.draft &&
        current.openVersion === before.openVersion &&
        !isDirty(current) && (!current.draft || current.openVersion !== null);
      if (opened) {
        openDraft(row);
      }
      dispatch(assistMessageAdded({ kind: 'draft', row, opened }));
    } catch (cause) {
      if (!isCurrent()) return;
      const response = cause as { status?: number | string; originalStatus?: number } | null;
      let text: string;
      if (response?.status === 409) {
        text = base ? 'This draft could not be updated. Check its status in the workflow library.'
          : 'That workflow ID already exists. Try specifying a different ID.';
      } else if (response?.status === 404 || response?.originalStatus === 404) {
        text = base ? 'This draft could not be found. Check the workflow library.'
          : 'AI Assist is unavailable on this server. Open Creator from your local Steel setup.';
      } else {
        text = serverErrorList(cause).slice(0, 2).join(' ') ||
          workflowErrorMessage(cause) || 'Could not save the draft. Try sending your message again.';
      }
      dispatch(assistMessageAdded({ kind: 'error', text, prompt: description }));
    } finally {
      if (request.current === active) {
        request.current = null;
        setProgress(null);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(prompt.trim());
  }

  return (
    <div className="workflow-assist" data-docked={dock ? 'true' : undefined}>
      {dock && createPortal(
        <button ref={commandLauncher} className="assist-launcher assist-command-launcher" type="button"
          aria-label="AI Assist" title="AI Assist" aria-expanded={open} aria-controls={open ? 'workflow-assist-chat' : undefined}
          onClick={() => open ? close() : setOpen(true)}>
          <span className="assist-launcher-icon"><Sparkle /></span>
        </button>,
        dock,
      )}
      <button ref={launcher} className="assist-launcher" type="button"
        aria-label="AI Assist" aria-expanded={open} aria-controls={open ? 'workflow-assist-chat' : undefined}
        onClick={() => open ? close() : setOpen(true)}>
        <span className="assist-launcher-icon"><Sparkle /></span>
        <span>AI Assist</span>
      </button>
      {open && (
        <section className="assist-chat" id="workflow-assist-chat" aria-labelledby="assist-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}>
          <header className="assist-header">
            <span className="assist-mark"><Sparkle /></span>
            <div className="assist-heading">
              <h2 id="assist-title">AI Assist</h2>
              {previous && (
                <p title={previous.definition.name || previous.workflow_id}>
                  {previous.definition.name || previous.workflow_id} · v{previous.version}
                </p>
              )}
            </div>
            <div className="assist-header-actions">
              {messages.length > 0 && (
                  <button className="assist-icon-button" type="button" aria-label="New chat"
                    title="New chat" disabled={!!progress || openingDraft} onClick={newChat}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5H5v14h14v-7M15 5h5m-2.5-2.5v5" />
                  </svg>
                </button>
              )}
              <button className="assist-icon-button" type="button" aria-label="Close AI Assist" onClick={close}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </header>
          <div className="assist-transcript" role="log" aria-label="Conversation" tabIndex={0} ref={transcript}>
            <div className="assist-message assist-message-assistant">
              <p>What workflow would you like to build?</p>
              <p>Describe the steps or the outcome you want. I’ll create a draft you can refine here.</p>
            </div>
            {messages.length === 0 && (
              <div className="assist-starters">
                {starters.map((starter) => (
                  <button type="button" key={starter} onClick={() => {
                    setPrompt(starter);
                    composer.current?.focus();
                  }}>{starter} <span aria-hidden="true">↗</span></button>
                ))}
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index}
                className={`assist-message assist-message-enter assist-message-${message.kind === 'prompt' ? 'user' : 'assistant'}`}>
                {message.kind === 'draft' ? (
                  <DraftMessage row={message.row} opened={message.opened} loading={openingDraft}
                    onOpen={workflowId === message.row.workflow_id && workflowVersion === message.row.version
                      ? undefined : () => requestOpenDraft(message.row)} />
                ) : (
                  <p><span className="assist-sr-only">{message.kind === 'prompt' ? 'You: ' : 'AI Assist: '}</span>{message.text}</p>
                )}
                {message.kind === 'error' && index === messages.length - 1 && (
                  <button className="assist-text-button" type="button" disabled={!!prompt.trim()}
                    onClick={() => {
                      setPrompt(message.prompt);
                      composer.current?.focus();
                    }}>Edit message</button>
                )}
              </div>
            ))}
            {progress && (
              <div className="assist-progress" role="status">
                <span className="assist-progress-dot" aria-hidden="true" />{progressLabels[progress]}…
              </div>
            )}
            {openError && <p className="assist-open-error" role="alert">{openError}</p>}
          </div>
          <form className="assist-composer" onSubmit={submit}>
            <label className="assist-sr-only" htmlFor="workflow-assist-prompt">Message AI Assist</label>
            <textarea id="workflow-assist-prompt" ref={composer} rows={2} maxLength={4000}
              placeholder={previous ? 'Ask for a change…' : clarifications.length ? 'Reply to AI Assist…' : 'Describe a workflow…'}
              value={prompt} onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send(prompt.trim());
                }
              }} />
            {progress && progress !== 'save' && progress !== 'confirm' ? (
              <button className="assist-send" type="button" aria-label="Stop response" onClick={stop}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button className="assist-send" type="submit" aria-label="Send message"
                disabled={!!progress || !prompt.trim()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 19V5m-6 6 6-6 6 6" />
                </svg>
              </button>
            )}
          </form>
        </section>
      )}
      {draftToOpen && createPortal(
        <ModalDialog label="Open saved draft" onClose={() => setDraftToOpen(null)}>
          <h2>Open saved draft?</h2>
          <p>Opening this draft will discard unsaved changes in the canvas.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setDraftToOpen(null)}>Keep editing</button>
            <button type="button" className="btn btn-primary" onClick={() => {
              openDraft(draftToOpen);
              setDraftToOpen(null);
              composer.current?.focus();
            }}>Open draft</button>
          </div>
        </ModalDialog>,
        document.body,
      )}
    </div>
  );
}
