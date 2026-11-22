import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useStore } from 'react-redux';
import { useDraftWorkflowMutation, useSaveWorkflowMutation, useValidateWorkflowMutation } from '../api/steelApi';
import { ModalDialog } from '../app/FocusTrap';
import { useAppDispatch } from '../store/hooks';
import type { RootState } from '../store/store';
import { isDirty, openDefinition } from '../store/workflowEditor';
import { useNotify } from './notices';
import { serverErrorList, workflowErrorMessage } from './workflowErrors';
import agentOrb from './agent-orb.svg';

export function WorkflowAssist() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const [generate] = useDraftWorkflowMutation();
  const [validate] = useValidateWorkflowMutation();
  const [save] = useSaveWorkflowMutation();
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const notify = useNotify();

  const close = () => {
    if (!pending.current) setOpen(false);
  };

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const description = prompt.trim();
    if (!description || pending.current) return;
    pending.current = true;
    setError('');
    setProgress('Generating workflow…');
    const before = store.getState().workflowEditor;
    try {
      const { definition } = await generate({ prompt: description }).unwrap();
      const validation = await validate({ definition }).unwrap();
      if (!validation.ok) {
        setError(validation.errors?.slice(0, 2).join(' ') || 'The generated workflow did not pass validation.');
        return;
      }
      setProgress('Saving draft…');
      const { row } = await save({ definition, created_by: 'ai_assist' }).unwrap();
      const current = store.getState().workflowEditor;
      if (current.openSequence === before.openSequence && current.draft === before.draft &&
        !isDirty(current) && (!current.draft || current.openVersion !== null)) {
        dispatch(openDefinition({
          workflowId: row.workflow_id,
          version: row.version,
          status: row.status,
          definition: row.definition,
        }));
        notify('ok', 'AI Assist created a workflow draft.');
      } else {
        notify('ok', `Draft “${row.definition.name || row.workflow_id}” is available in the workflow library.`);
      }
      setPrompt('');
      setOpen(false);
    } catch (cause) {
      const response = cause as { status?: number | string; originalStatus?: number } | null;
      if (response?.status === 409) {
        setError('That workflow ID already exists. Include a different workflow ID in your prompt.');
      } else if (response?.status === 404 || response?.originalStatus === 404) {
        setError('AI Assist is unavailable on this server. Open Creator from your local Steel setup.');
      } else {
        setError(serverErrorList(cause).slice(0, 2).join(' ') ||
          workflowErrorMessage(cause) || 'Could not create the draft. Try again.');
      }
    } finally {
      pending.current = false;
      setProgress('');
    }
  }

  return (
    <>
      <button className="workflow-assist-orb" type="button" aria-label="AI Assist"
        aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <img src={agentOrb} alt="" />
      </button>
      {open && (
        <ModalDialog label="AI Assist" onClose={close}>
          <form className="workflow-assist-form" onSubmit={create}>
            <h2>AI Assist</h2>
            <label htmlFor="workflow-assist-prompt">Describe the workflow you want to create</label>
            <textarea id="workflow-assist-prompt" rows={5} maxLength={4000} value={prompt}
              readOnly={!!progress} onChange={(event) => setPrompt(event.target.value)} required />
            {error && <p role="alert">{error}</p>}
            {progress && <p role="status">{progress}</p>}
            <div className="workflow-assist-actions">
              <button className="btn" type="button" disabled={!!progress} onClick={close}>Close</button>
              <button className="btn btn-primary" type="submit" disabled={!!progress || !prompt.trim()}>
                Create draft
              </button>
            </div>
          </form>
        </ModalDialog>
      )}
    </>
  );
}
