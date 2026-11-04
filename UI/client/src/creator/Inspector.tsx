import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from 'react-redux';
import type { WorkflowDefinition, WorkflowStep } from '../api/contracts';
import { useListSkillsQuery } from '../api/steelApi';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import type { RootState } from '../store/store';
import { selectStep, setPanel, updateDraft } from '../store/workflowEditor';
import { TYPE_LABELS, addWorkflowInput, defaultStartStaleFields, deleteStep, removeWorkflowInput, renameStep, renameWorkflowInput, syncDefaultStartFields } from './adapter';
import { ApprovalConfig, BranchConfig, DatabaseConfig, InputCollectionConfig, LoopConfig, ReasoningConfig, RoutingSection, SkillRetrievalConfig, findStep } from './stepConfigs';
import type { EditFn } from './stepConfigs';
import { MappingEditor } from './stepConfigs';
import { SkillStepInspector } from './SkillStepInspector';
import { ArtifactStepInspector } from './ArtifactStepInspector';
import { DocStepInspector } from './DocStepInspector';
import { CheckField, DataRefPicker, NumberField, SelectField, TextField } from './fields';
import { DesignerBindingPicker } from '../designer/DesignerBindingPicker';
import { InputPresentationEditor } from './InputPresentationEditor';
import { availableRefs, bodyRefs } from './preflight';
import { useNotify } from './notices';
import { useFloatingPanel } from './useFloatingPanel';

// Right contextual inspector: selected node, loop-body step, or workflow
// settings. Resizable via CSS within bounds; closes without moving the graph.
export function Inspector({ bodySel, setBodySel, validationStatus = null, requiredSetup = false }: { bodySel: { loop: string; step: string } | null; setBodySel: (v: { loop: string; step: string } | null) => void; validationStatus?: 'valid' | 'invalid' | null; requiredSetup?: boolean }) {
  const dispatch = useAppDispatch();
  const draft = useAppSelector((s) => s.workflowEditor.draft);
  const selectedStepId = useAppSelector((s) => s.workflowEditor.selectedStepId);
  const skills = useListSkillsQuery();
  const floating = useFloatingPanel();
  const reduxStore = useStore<RootState>();
  useEffect(() => { if (floating.ref.current) floating.ref.current.scrollTop = 0; }, [selectedStepId, bodySel]);

  if (!draft) return null;

  const edit: EditFn = (fn) => {
    // Fresh base avoids losing a just-committed blur edit when a button
    // click handler from the same render follows (blur dispatches first,
    // then click must build on the committed draft, not the stale prop).
    const fresh = reduxStore.getState().workflowEditor.draft ?? draft;
    const next = JSON.parse(JSON.stringify(fresh)) as WorkflowDefinition;
    fn(next);
    dispatch(updateDraft(next));
  };

  const close = () => {
    setBodySel(null);
    dispatch(selectStep(null));
    dispatch(setPanel('none'));
  };

  let title = 'Workflow settings';
  let body: React.ReactNode = <WorkflowSettings def={draft} edit={edit} validationStatus={validationStatus} />;
  if (bodySel) {
    const loop = findStep(draft, bodySel.loop, null);
    const bstep = findStep(draft, bodySel.step, bodySel.loop);
    if (loop && bstep) {
      title = `Body step: ${bstep.name || bstep.step_id}`;
      body = (
        <>
          <button type="button" className="btn" onClick={() => setBodySel(null)}>
            ← Back to loop {bodySel.loop}
          </button>
          <StepEditor key={`${bodySel.loop}/${bstep.step_id}`} def={draft} step={bstep} bodyOf={bodySel.loop} edit={edit} skillsVersion={skills.data ? 1 : 0} />
        </>
      );
    }
  } else if (selectedStepId) {
    const step = findStep(draft, selectedStepId, null);
    if (step) {
      title = `Step: ${step.name || step.step_id}`;
      body = <StepEditor key={step.step_id} def={draft} step={step} bodyOf={null} edit={edit} onEditBody={(loop, s) => setBodySel({ loop, step: s })} skillsVersion={skills.data ? 1 : 0} />;
    }
  }

  return (
    <motion.aside
      ref={floating.ref}
      style={floating.style}
      className="overlay-panel overlay-right inspector"
      role="complementary"
      aria-label={title}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <div className="drawer-head panel-drag-handle" {...floating.handle}>
        <h2>{title}</h2>
        {!requiredSetup && <button type="button" className="btn" onClick={close} aria-label="Close inspector">
          ×
        </button>}
      </div>
      <div className="inspector-body">{body}</div>
    </motion.aside>
  );
}

function StepEditor({ def, step, bodyOf, edit, onEditBody, skillsVersion }: {
  def: WorkflowDefinition;
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
  onEditBody?: (loop: string, body: string) => void;
  skillsVersion: number;
}) {
  void skillsVersion;
  const dispatch = useAppDispatch();
  const notify = useNotify();
  const skills = useListSkillsQuery();
  const refs = bodyOf ? bodyRefs(def, bodyOf, step.step_id) : availableRefs(def, step.step_id);

  const remove = () => {
    if (bodyOf) {
      edit((d) => {
        const loop = findStep(d, bodyOf, null);
        const body = (loop?.config as Record<string, unknown> | undefined)?.body as WorkflowStep[] | undefined;
        if (loop && Array.isArray(body)) {
          (loop.config as Record<string, unknown>).body = body.filter((s) => s.step_id !== step.step_id);
        }
      });
      notify('ok', `Deleted ${step.step_id} from the loop body; run Validate to find dangling body refs.`);
      return;
    }
    const next = deleteStep(def, step.step_id);
    if (!next) {
      notify('error', 'A workflow needs at least one step.');
      return;
    }
    dispatch(updateDraft(next));
    dispatch(selectStep(null));
    notify('ok', `Deleted ${step.step_id}; dangling edges now point at end.`);
  };

  return (
    <div className="step-settings configuration-card">
      <div className="settings-intro"><div><strong>{step.name || step.step_id}</strong><p>Configure this step and connect its data</p></div><span className="count-badge">{TYPE_LABELS[step.type] ?? step.type}</span></div>
      <section aria-label="Step identity" className="step-identity">
        <TextField
          label="Step id"
          value={step.step_id}
          onCommit={(v) => {
            if (bodyOf) {
              notify('error', 'Body step ids cannot be renamed here yet.');
              return;
            }
            const next = renameStep(def, step.step_id, v);
            if (!next) {
              notify('error', `"${v.trim()}" is not usable: ids must be unique, non-empty, and not "end".`);
              return;
            }
            dispatch(updateDraft(next));
            dispatch(selectStep(v.trim()));
            notify('ok', `Renamed to ${v.trim()}; every reference was rewritten.`);
          }}
        />
      </section>
      <section aria-label="Step details" className="step-details">
      <h3>Step details</h3>
      <TextField
        label="What should this step do? (name)"
        value={step.name ?? ''}
        onCommit={(v) => edit((d) => {
          const t = findStep(d, step.step_id, bodyOf);
          if (t) t.name = v;
        })}
      />
      </section>

      {step.type === 'input_collection' && <InputCollectionConfig def={def} step={step} bodyOf={bodyOf} edit={edit} />}
      {step.type === 'model_reasoning' && <ReasoningConfig step={step} bodyOf={bodyOf} edit={edit} />}
      {step.type === 'database_retrieval' && <DatabaseConfig step={step} bodyOf={bodyOf} edit={edit} />}
      {step.type === 'skill_retrieval' && <SkillRetrievalConfig step={step} bodyOf={bodyOf} edit={edit} />}
      {step.type === 'skill_execution' && <SkillStepInspector def={def} step={step} bodyOf={bodyOf} edit={edit} refs={refs} skills={skills.data?.skills ?? []} />}
      {step.type === 'conditional_routing' && <BranchConfig def={def} step={step} bodyOf={bodyOf} edit={edit} refs={refs} />}
      {step.type === 'iteration' && !bodyOf && onEditBody && <LoopConfig def={def} step={step} edit={edit} onEditBody={onEditBody} />}
      {step.type === 'iteration' && bodyOf && <p className="status-line">Nested loops are validated but not editable here.</p>}
      {step.type === 'human_approval' && <ApprovalConfig step={step} bodyOf={bodyOf} edit={edit} />}
      {step.type === 'output_composition' && <MappingEditor step={step} holder="mapping" refs={refs} edit={edit} title="Result mapping" />}
      {step.type === 'document_generation' && <DocStepInspector def={def} step={step} bodyOf={bodyOf} edit={edit} refs={refs} />}
      {step.type === 'artifact_generation' && <ArtifactStepInspector def={def} step={step} bodyOf={bodyOf} edit={edit} refs={refs} />}

      <RoutingSection def={def} step={step} bodyOf={bodyOf} edit={edit} />



      <div className="step-footer"><button type="button" className="btn btn-danger" onClick={remove}>
        Delete step
      </button></div>
    </div>
  );
}

// Input name commits on blur/Enter (one undo entry per rename, caret
// never jumps, intermediate typing never scatters refs). Empty commits
// are preserved so validation reports them actionably on Save/Validate.
function InputNameField({ index, value, onCommit }: { index: number; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      aria-label={`Input ${index + 1} name`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text !== value) onCommit(text.trim()); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function WorkflowSettings({ def, edit, validationStatus }: { def: WorkflowDefinition; edit: EditFn; validationStatus: 'valid' | 'invalid' | null }) {
  const dispatch = useAppDispatch();
  const reduxStore = useStore<RootState>();
  const freshDef = (): WorkflowDefinition => reduxStore.getState().workflowEditor.draft ?? def;
  const refs = [...(def.inputs ?? []).map((i) => ({ ref: i.name, label: i.name, detail: `input · ${i.type ?? 'string'}` })),
    ...(def.steps ?? []).map((s) => ({ ref: s.step_id, label: s.step_id, detail: `output of ${s.name || s.step_id}` }))];
  const policy = (def.policy ?? {}) as { execution_approval?: string; skill_approval?: string; four_eyes?: boolean };
  const limits = (def.limits ?? {}) as { max_rounds?: number; max_iterations?: number };
  const outputs = (def.outputs ?? {}) as Record<string, { from?: string }>;
  const [newKey, setNewKey] = useState('');
  const [newFrom, setNewFrom] = useState('');
  const [addingBinding, setAddingBinding] = useState(false);

  return (
    <div className="workflow-settings configuration-card">
      <div className="settings-intro"><div><strong>{def.name || def.workflow_id || 'Workflow'}</strong><p>Configure inputs and output bindings</p></div><span className={`settings-validation ${validationStatus ?? 'unchecked'}`}>{validationStatus === 'valid' ? 'Valid' : validationStatus === 'invalid' ? 'Needs attention' : 'Not validated'}</span></div>
      <p className="status-line">Select a step on the canvas, or edit the workflow itself:</p>
      <TextField
        label="Workflow id"
        value={def.workflow_id}
        onCommit={(v) => edit((d) => {
          d.workflow_id = v.trim();
        })}
      />
      <section aria-label="Inputs" className="settings-inputs">
        <h3>Inputs <span className="count-badge">{def.inputs?.length ?? 0} fields</span></h3>
        <div className="input-column-head" aria-hidden="true"><span>Field</span><span>Type</span><span>Req.</span><span /></div>
        {(def.inputs ?? []).map((inp, i) => (
          <div key={i}>
          <div className="map-row settings-input-row">
            <InputNameField
              index={i}
              value={inp.name}
              onCommit={(v) => {
                const next = renameWorkflowInput(freshDef(), i, v);
                if (next) dispatch(updateDraft(next));
              }}
            />
            <select
              aria-label={`Input ${i + 1} type`}
              value={inp.type ?? 'string'}
              onChange={(e) => edit((d) => {
                const t = d.inputs?.[i];
                if (t) t.type = e.target.value;
              })}
            >
              {['string', 'number', 'boolean', 'object', 'array'].map((t) => (
                <option key={t} value={t}>{({ string: 'Text', number: 'Number', boolean: 'Yes / No', object: 'Object', array: 'Array' } as Record<string, string>)[t]}</option>
              ))}
            </select>
            <label className="check-inline">
              <input
                type="checkbox"
                aria-label={`Input ${i + 1} required`}
                checked={inp.required === true}
                onChange={(e) => edit((d) => {
                  const t = d.inputs?.[i];
                  if (t) t.required = e.target.checked;
                })}
              />
              <span className="sr-only">Required</span>
            </label>
            <button
              type="button"
              className="btn"
              aria-label={`Remove input ${inp.name}`}
              onClick={() => {
                const next = removeWorkflowInput(freshDef(), i);
                if (next) dispatch(updateDraft(next));
              }}
            >
              ×
            </button>
          </div>
          <DesignerBindingPicker
            value={inp.designer ?? null}
            onChange={(next) => edit((d) => {
              const t = d.inputs?.[i];
              if (!t) return;
              if (next === null) delete t.designer;
              else t.designer = next;
            })}
          />
          </div>
        ))}
        {(def.inputs ?? []).length === 0 && <p className="status-line">No inputs.</p>}
        <button
          type="button"
          className="btn"
          onClick={() => dispatch(updateDraft(addWorkflowInput(freshDef())))}
        >
          + Add input
        </button>
        {defaultStartStaleFields(def).length > 0 && (
          <p className="status-line" role="alert">
            <span className="status-bad">Start still collects {defaultStartStaleFields(def).join(', ')}, which is not a declared input. </span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const next = syncDefaultStartFields(freshDef());
                if (next) dispatch(updateDraft(next));
              }}
            >
              Sync start fields to inputs
            </button>
          </p>
        )}
      </section>
      <section aria-label="Policy">
        <h3>Policy</h3>
        <SelectField
          label="Execution approval"
          value={policy.execution_approval ?? 'first_run'}
          options={[{ value: 'none', label: 'none' }, { value: 'first_run', label: 'first run' }, { value: 'always', label: 'always' }]}
          onChange={(v) => edit((d) => {
            d.policy = { ...(d.policy ?? {}), execution_approval: v };
          })}
        />
        <SelectField
          label="Skill approval"
          value={policy.skill_approval ?? 'new_names'}
          options={[{ value: 'auto', label: 'auto' }, { value: 'new_names', label: 'new names' }]}
          onChange={(v) => edit((d) => {
            d.policy = { ...(d.policy ?? {}), skill_approval: v };
          })}
        />
        <CheckField
          label="Four-eyes publish"
          checked={policy.four_eyes === true}
          onChange={(v) => edit((d) => {
            d.policy = { ...(d.policy ?? {}), four_eyes: v };
          })}
        />
      </section>
      <section aria-label="Limits">
        <h3>Limits</h3>
        <NumberField label="Max rounds" min={1} value={limits.max_rounds} onCommit={(v) => edit((d) => {
          d.limits = { ...(d.limits ?? {}), max_rounds: v };
        })}
        />
        <NumberField label="Max iterations" min={1} value={limits.max_iterations} onCommit={(v) => edit((d) => {
          d.limits = { ...(d.limits ?? {}), max_iterations: v };
        })}
        />
      </section>
      <section aria-label="Outputs" className="settings-outputs">
        <h3>Output bindings <span className="count-badge">{Object.keys(outputs).length} mapped</span></h3>
        {Object.entries(outputs).map(([k, v]) => (
          <div key={k} className="map-row output-binding-row">
            <code className="num">{k}</code>
            <span className="binding-arrow" aria-hidden="true">←</span>
            <DataRefPicker label={`Source for ${k}`} value={v?.from ?? ''} options={refs} onCommit={(from) => edit((d) => {
              d.outputs = { ...(d.outputs ?? {}), [k]: { from } };
            })}
            />
            <button
              type="button"
              className="btn"
              aria-label={`Remove output ${k}`}
              onClick={() => edit((d) => {
                const o = { ...(d.outputs ?? {}) } as Record<string, unknown>;
                delete o[k];
                d.outputs = o;
              })}
            >
              ×
            </button>
          </div>
        ))}
        {addingBinding && <div className="map-row new-output-row">
          <input type="text" aria-label="New output key" placeholder="key" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <input type="text" aria-label="New output source" placeholder="step.field" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
          <button
            type="button"
            className="btn"
            disabled={newKey.trim() === '' || newFrom.trim() === ''}
            onClick={() => {
              const k = newKey.trim();
              const f = newFrom.trim();
              setNewKey('');
              setNewFrom('');
              setAddingBinding(false);
              edit((d) => {
                d.outputs = { ...(d.outputs ?? {}), [k]: { from: f } };
              });
            }}
          >
            Add
          </button>
        </div>}
        <button type="button" className="btn add-binding-button" onClick={() => setAddingBinding((v) => !v)}>{addingBinding ? 'Cancel new binding' : '+ Add binding'}</button>
      </section>
      <InputPresentationEditor def={def} edit={edit} />
    </div>
  );
}
