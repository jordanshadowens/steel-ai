import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import * as m from 'motion/react-m';
import { useStore } from 'react-redux';
import type { WorkflowDefinition, WorkflowStep } from '../api/contracts';
import {
  useGetDesignerVersionQuery,
  useGetDesignerWorkspaceQuery,
  useListSkillsQuery,
  useListWorkflowsQuery,
} from '../api/steelApi';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import type { RootState } from '../store/store';
import { selectStep, setPanel, updateDraft } from '../store/workflowEditor';
import {
  END_NODE_ID,
  EXECUTION_APPROVAL_OPTIONS,
  INPUT_TYPE_LABELS,
  SKILL_APPROVAL_OPTIONS,
  stepTypeLabel,
  canDuplicateStep,
  duplicateWorkflowStep,
  addWorkflowInput,
  defaultStartStaleFields,
  deleteStep,
  moveWorkflowInput,
  removeWorkflowInput,
  renameStep,
  renameWorkflowInput,
  syncDefaultStartFields,
} from './adapter';
import {
  ApprovalConfig,
  BranchConfig,
  DatabaseConfig,
  InputCollectionConfig,
  LoopConfig,
  ReasoningConfig,
  RoutingSection,
  SkillRetrievalConfig,
  findStep,
} from './stepConfigs';
import type { EditFn } from './stepConfigs';
import { MappingEditor } from './stepConfigs';
import { DataRefPicker, SelectField, TextField } from './fields';
import { DesignerBindingPicker } from '../designer/DesignerBindingPicker';
import { bindModelField, releaseModelInput, setOutputSource } from './finishBindings';
import { availableRefs, bodyRefs, outputSourceIssue, workflowInputNameErrors } from './preflight';
import { useNotify } from './notices';
import { useFloatingPanel } from './useFloatingPanel';

function UnavailableStepSettings() {
  return <p role="alert">Could not load these step settings. Save your draft before reloading.</p>;
}

const LanguageStepInspector = lazy(() => import('./LanguageStepInspector').then(
  (module) => ({ default: module.LanguageStepInspector }),
  () => ({ default: UnavailableStepSettings }),
));
const VerificationStepInspector = lazy(() => import('./VerificationStepInspector').then(
  (module) => ({ default: module.VerificationStepInspector }),
  () => ({ default: UnavailableStepSettings }),
));
const SkillStepInspector = lazy(() => import('./SkillStepInspector').then(
  (module) => ({ default: module.SkillStepInspector }),
  () => ({ default: UnavailableStepSettings }),
));

// Right contextual inspector: selected node, loop-body step, or workflow
// settings. Resizable via CSS within bounds; closes without moving the graph.
export function Inspector({
  bodySel,
  setBodySel,
  requiredSetup = false,
  onGoToStep,
}: {
  bodySel: { loop: string; step: string } | null;
  setBodySel: (v: { loop: string; step: string } | null) => void;
  requiredSetup?: boolean;
  onGoToStep?: (id: string, bodyStep?: string) => void;
}) {
  const dispatch = useAppDispatch();
  const draft = useAppSelector((s) => s.workflowEditor.draft);
  const openVersion = useAppSelector((s) => s.workflowEditor.openVersion);
  const selectedStepId = useAppSelector((s) => s.workflowEditor.selectedStepId);
  const skills = useListSkillsQuery();
  const floating = useFloatingPanel();
  const reduxStore = useStore<RootState>();
  useEffect(() => {
    if (floating.ref.current) {
      floating.ref.current.scrollTop = 0;
    }
  }, [selectedStepId, bodySel]);

  if (!draft) {
    return null;
  }

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
  let stepHeading: { name: string; type: string } | null = null;
  let body: React.ReactNode = (
    <WorkflowSettings def={draft} edit={edit} saved={openVersion !== null} requiredSetup={requiredSetup} />
  );
  if (bodySel) {
    const loop = findStep(draft, bodySel.loop, null);
    const bstep = findStep(draft, bodySel.step, bodySel.loop);
    if (loop && bstep) {
      stepHeading = { name: bstep.name || bstep.step_id, type: stepTypeLabel(bstep) };
      title = `Body step: ${stepHeading.name}`;
      body = (
        <>
          <button
            type="button"
            className="btn"
            onClick={() => setBodySel(null)}
          >
            ← Back to loop {bodySel.loop}
          </button>
          <StepEditor
            key={`${bodySel.loop}/${bstep.step_id}`}
            def={draft}
            step={bstep}
            bodyOf={bodySel.loop}
            edit={edit}
            onFollowRoute={(target) =>
              setBodySel(target === 'end' ? null : { loop: bodySel.loop, step: target })
            }
            skillsVersion={skills.data ? 1 : 0}
          />
        </>
      );
    }
  } else if (selectedStepId === END_NODE_ID) {
    title = 'Finish';
    body = <FinishSettings def={draft} edit={edit} />;
  } else if (selectedStepId) {
    const step = findStep(draft, selectedStepId, null);
    if (step) {
      stepHeading = { name: step.name || step.step_id, type: stepTypeLabel(step) };
      title = `Step: ${stepHeading.name}`;
      body = (
        <StepEditor
          key={step.step_id}
          def={draft}
          step={step}
          bodyOf={null}
          edit={edit}
          onFollowRoute={(target) => {
            const id = target === 'end' ? END_NODE_ID : target;
            if (onGoToStep) onGoToStep(id);
            else dispatch(selectStep(id));
          }}
          onEditBody={(loop, child) => {
            if (onGoToStep) onGoToStep(loop, child);
            else setBodySel({ loop, step: child });
          }}
          skillsVersion={skills.data ? 1 : 0}
        />
      );
    }
  }

  return (
    <m.aside
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
        <div className="inspector-title">
          <h2 tabIndex={-1}>{stepHeading?.name ?? title}</h2>
          {stepHeading && <span className="count-badge">{stepHeading.type}</span>}
        </div>
        {!requiredSetup && (
          <button
            type="button"
            className="btn"
            onClick={close}
            aria-label="Close inspector"
          >
            ×
          </button>
        )}
      </div>
      <div className="inspector-body">{body}</div>
    </m.aside>
  );
}

function StepEditor({
  def,
  step,
  bodyOf,
  edit,
  onEditBody,
  onFollowRoute,
  skillsVersion,
}: {
  def: WorkflowDefinition;
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
  onFollowRoute: (target: string) => void;
  onEditBody?: (loop: string, body: string) => void;
  skillsVersion: number;
}) {
  void skillsVersion;
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const notify = useNotify();
  const skills = useListSkillsQuery();
  const refs = bodyOf
    ? bodyRefs(def, bodyOf, step.step_id)
    : availableRefs(def, step.step_id);

  const canDelete = Boolean(bodyOf) || (def.steps?.length ?? 0) > 1;
  const remove = () => {
    const current = store.getState().workflowEditor.draft ?? def;
    const next = deleteStep(current, step.step_id, bodyOf ?? undefined);
    if (!next) {
      notify('error', 'A workflow needs at least one step.');
      return;
    }
    dispatch(updateDraft(next));
    if (bodyOf) onFollowRoute('end');
    else dispatch(selectStep(null));
    notify('ok', `Deleted ${step.name || step.step_id}.`);
  };

  function duplicate() {
    const current = store.getState().workflowEditor.draft;
    if (!current) return;
    const copy = duplicateWorkflowStep(current, step.step_id);
    if (!copy) return;
    dispatch(updateDraft(copy.definition));
    onFollowRoute(copy.stepId);
  }

  return (
    <div className="step-settings configuration-card">
      <section aria-label="Step details" className="step-identity">
        <TextField
          label="Step name"
          value={step.name ?? ''}
          onCommit={(value) =>
            edit((draft) => {
              const target = findStep(draft, step.step_id, bodyOf);
              if (target) target.name = value;
            })
          }
        />
        <TextField
          label="Step id"
          value={step.step_id}
          readOnly={bodyOf !== null}
          onCommit={(value) => {
            const next = renameStep(def, step.step_id, value);
            if (!next) {
              notify('error', 'Use a unique step ID with letters, numbers, hyphens, or underscores.');
              return;
            }
            dispatch(updateDraft(next));
            dispatch(selectStep(value.trim()));
          }}
        />
      </section>

      {step.type === 'input_collection' && (
        <InputCollectionConfig
          def={def}
          step={step}
          bodyOf={bodyOf}
          edit={edit}
        />
      )}
      {step.type === 'model_reasoning' && (
        <ReasoningConfig step={step} bodyOf={bodyOf} edit={edit} />
      )}
      {step.type === 'database_retrieval' && (
        <DatabaseConfig step={step} bodyOf={bodyOf} edit={edit} />
      )}
      {step.type === 'skill_retrieval' && (
        <SkillRetrievalConfig step={step} bodyOf={bodyOf} edit={edit} />
      )}
      <Suspense fallback={<p role="status">Loading step settings...</p>}>
        {(step.type === 'lang_execution' ||
          step.type === 'lang_recall' ||
          step.type === 'lang_verification') && (
          <LanguageStepInspector
            contextId={def.workflow_id}
            step={step}
            bodyOf={bodyOf}
            edit={edit}
            refs={refs}
          />
        )}
        {step.type === 'skill_verification' && (
          <VerificationStepInspector
            step={step}
            bodyOf={bodyOf}
            edit={edit}
            refs={refs}
          />
        )}
        {step.type === 'skill_execution' && (
          <SkillStepInspector
            def={def}
            step={step}
            bodyOf={bodyOf}
            edit={edit}
            refs={refs}
            skills={skills.data?.skills ?? []}
          />
        )}
      </Suspense>
      {step.type === 'conditional_routing' && (
        <BranchConfig
          def={def}
          step={step}
          bodyOf={bodyOf}
          edit={edit}
          refs={refs}
        />
      )}
      {step.type === 'iteration' && !bodyOf && onEditBody && (
        <LoopConfig def={def} step={step} edit={edit} onEditBody={onEditBody} />
      )}
      {step.type === 'iteration' && bodyOf && (
        <p className="status-line">
          Nested loops are validated but not editable here.
        </p>
      )}
      {step.type === 'human_approval' && (
        <ApprovalConfig step={step} bodyOf={bodyOf} edit={edit} />
      )}
      {step.type === 'output_composition' && (
        <MappingEditor
          step={step}
          bodyOf={bodyOf}
          holder="mapping"
          refs={refs}
          edit={edit}
          title="Result mapping"
        />
      )}
      {(step.type === 'document_generation' || step.type === 'artifact_generation') && (
        <p className="status-line">This generator is retired. The workflow keeps its saved settings.</p>
      )}

      <RoutingSection def={def} step={step} bodyOf={bodyOf} edit={edit} onFollow={onFollowRoute} />

      <div className="step-footer">
        {!canDelete && (
          <p className="status-line">A workflow needs at least one step.</p>
        )}
        {bodyOf === null && canDuplicateStep(step) && (
          <button type="button" className="btn" onClick={duplicate}>
            Duplicate after this step
          </button>
        )}
        <button
          type="button"
          className="btn btn-danger"
          disabled={!canDelete}
          onClick={remove}
        >
          Delete step
        </button>
      </div>
    </div>
  );
}

// Input name commits on blur/Enter (one undo entry per rename, caret
// never jumps, intermediate typing never scatters refs). Empty commits
// are preserved so validation reports them actionably on Save/Validate.
function InputNameField({
  index,
  value,
  onCommit,
  errorId,
}: {
  index: number;
  value: string;
  onCommit: (v: string) => void;
  errorId?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      aria-label={`Input ${index + 1} name`}
      autoCapitalize="none"
      spellCheck={false}
      aria-invalid={errorId ? true : undefined}
      aria-describedby={errorId}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const trimmed = text.trim();
        if (trimmed !== text) setText(trimmed);
        if (trimmed !== value) onCommit(trimmed);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function FinishSettings({ def, edit }: { def: WorkflowDefinition; edit: EditFn }) {
  const stepRefs = availableRefs(def, END_NODE_ID, {
    includeInputs: false,
    includeCollectedStepRoots: true,
  });
  const outputs = (def.outputs ?? {}) as Record<string, { from?: string }>;
  const sourceRoots = new Set([
    ...(def.inputs ?? []).map(({ name }) => name),
    ...(def.steps ?? []).map(({ step_id }) => step_id),
  ]);
  const outputRows = Object.entries(outputs).map(([name, binding]) => {
    const source = typeof binding?.from === 'string' ? binding.from : '';
    const problem = outputSourceIssue(source, sourceRoots);
    const error = problem === 'empty' ? 'Choose a source.' :
      problem === 'missing' ? 'This step or input no longer exists.' : undefined;
    return { name, source, error };
  });
  const [newKey, setNewKey] = useState('');
  const [editingOutput, setEditingOutput] = useState<string | null>(null);
  const duplicateOutput = editingOutput === null && Object.hasOwn(outputs, newKey.trim());
  const [newFrom, setNewFrom] = useState('');
  const [stepResult, setStepResult] = useState('');
  const [addingBinding, setAddingBinding] = useState(false);
  const outputName = useRef<HTMLInputElement>(null);
  const outputForm = useRef<HTMLFormElement>(null);
  const composingOutput = useRef(false);
  const addOutputButton = useRef<HTMLButtonElement>(null);
  const sourceTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreOutputFocus = useRef(false);
  const outputList = useRef<HTMLDivElement>(null);
  const removedOutputIndex = useRef<number | null>(null);
  useEffect(() => {
    const index = removedOutputIndex.current;
    if (index === null) return;
    removedOutputIndex.current = null;
    const buttons = outputList.current?.querySelectorAll<HTMLButtonElement>('[data-remove-output]');
    const next = buttons?.[index] ?? buttons?.[index - 1] ?? addOutputButton.current;
    next?.focus();
  }, [def.outputs]);
  useEffect(() => {
    if (addingBinding) {
      if (editingOutput === null) outputName.current?.focus();
      else outputForm.current?.querySelector('select')?.focus();
    } else if (restoreOutputFocus.current) {
      restoreOutputFocus.current = false;
      const trigger = sourceTrigger.current;
      sourceTrigger.current = null;
      (trigger?.isConnected ? trigger : addOutputButton.current)?.focus();
    }
  }, [addingBinding, editingOutput]);
  const [source, setSource] = useState<'step' | 'model'>('step');
  const [modelId, setModelId] = useState('');
  const [fieldName, setFieldName] = useState('');
  const hasModelInputs = def.inputs?.some((input) => Boolean(input.designer));
  const workspace = useGetDesignerWorkspaceQuery({ include_archived: true }, {
    skip: !hasModelInputs && (!addingBinding || source !== 'model'),
  });
  const workspaceModels = workspace.data?.types ?? [];
  const models = workspaceModels.filter(
    (model) => model.status === 'active' && model.version > 0,
  );
  const refs = [
    ...(def.inputs ?? []).map((input) => {
      const binding = input.designer;
      const boundModel = binding && !binding.workspace
        ? workspaceModels.find((model) => model.type_id === binding.type || model.name === binding.type)
        : undefined;
      const modelName = boundModel?.name ?? binding?.type;
      const modelStatus = boundModel?.status === 'archived' ? ' · Archived' : '';
      return {
        ref: input.name,
        label: input.name,
        detail: modelName
          ? `Data model · ${modelName}${binding?.field ? ` · ${binding.field}` : ''}${modelStatus}`
          : `Workflow input · ${input.type ?? 'string'}`,
      };
    }),
    ...stepRefs,
  ];
  const model = models.find((candidate) => candidate.type_id === modelId)
    ?? models.find((candidate) => candidate.name === modelId);
  const version = useGetDesignerVersionQuery(
    { id: model?.type_id ?? '', version: model?.version ?? 0 },
    { skip: !model },
  );
  const modelFields = (version.currentData?.spec.fields ?? []).filter(
    (field) => field.status === 'active',
  );
  const modelField = modelFields.find((field) => field.name === fieldName);
  const currentSource = editingOutput === null ? undefined : outputRows.find(({ name }) => name === editingOutput)?.source;
  const usesModel = def.inputs?.some(({ name, designer }) => name === currentSource && designer);
  const currentSourceLabel = usesModel ? refs.find(({ ref }) => ref === currentSource)?.detail : currentSource;

  function closeOutputForm() {
    composingOutput.current = false;
    setEditingOutput(null);
    setNewKey('');
    setNewFrom('');
    setStepResult('');
    setSource('step');
    setModelId('');
    setFieldName('');
    restoreOutputFocus.current = true;
    setAddingBinding(false);
  }

  function saveOutput() {
    const key = editingOutput ?? newKey.trim();
    if (!key || duplicateOutput || (source === 'model' ? !model || !modelField : !newFrom.trim())) {
      return;
    }
    edit((draft) => {
      const exists = Object.hasOwn(draft.outputs ?? {}, key);
      if (exists !== (editingOutput !== null)) return;
      const from = source === 'model' && model && modelField
        ? bindModelField(draft, key, model, modelField)
        : newFrom.trim();
      setOutputSource(draft, key, from);
    });
    closeOutputForm();
  }

  return (
    <div className="finish-settings configuration-card">
      <div ref={outputList} className="settings-outputs" role="group" aria-label="Workflow outputs">
        <h3>
          Workflow outputs{' '}
          {outputRows.length > 0 && (
            <span className="count-badge">{outputRows.filter(({ error }) => !error).length} mapped</span>
          )}
        </h3>
        {outputRows.length === 0 && !addingBinding && (
          <p className="status-line">Add an output to return a step result or a field from a data model.</p>
        )}
        {outputRows.map(({ name: k, source: previousSource, error }, index) => (
          <div key={k} className="map-row output-binding-row" data-output-name={k}>
            <code className="num">{k}</code>
            <span className="binding-arrow" aria-hidden="true">
              ←
            </span>
            <div className="finish-binding-source">
              <DataRefPicker
                label={`Source for ${k}`}
                trimOnCommit
                value={previousSource}
                error={error}
                options={refs}
                onCommit={(from) => edit((draft) => setOutputSource(draft, k, from))}
              />
                <button type="button" className="link-button" disabled={addingBinding} aria-label={`Change source for ${k}`} onClick={(event) => {
                  sourceTrigger.current = event.currentTarget;
                  setEditingOutput(k);
                  setNewKey(k);
                  setNewFrom(previousSource);
                  setStepResult(stepRefs.some(({ ref }) => ref === previousSource) ? previousSource : previousSource ? '$path' : '');
                  const binding = def.inputs?.find(({ name }) => name === previousSource)?.designer;
                  if (binding?.field && !binding.workspace && binding.mode === 'value') {
                    setSource('model');
                    setModelId(binding.type);
                    setFieldName(binding.field);
                  }
                  setAddingBinding(true);
                }}>Change source</button>
            </div>
            <button
              type="button"
              className="btn"
              data-remove-output=""
              disabled={addingBinding}
              aria-label={`Remove output ${k}`}
              onClick={() => {
                removedOutputIndex.current = index;
                edit((d) => {
                  const o = { ...(d.outputs ?? {}) } as Record<string, unknown>;
                  delete o[k];
                  d.outputs = o;
                  releaseModelInput(d, previousSource);
                });
              }}
            >
              ×
            </button>
          </div>
        ))}
        {addingBinding && (
          <form
            ref={outputForm}
            className="finish-output-form"
            onCompositionStart={() => { composingOutput.current = true; }}
            onCompositionEnd={() => { composingOutput.current = false; }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!composingOutput.current) saveOutput();
            }}
          >
            <label className="field">
              <span>Output name</span>
              <input
                ref={outputName}
                autoCapitalize="none"
                spellCheck={false}
                value={newKey}
                readOnly={editingOutput !== null}
                aria-required={editingOutput === null || undefined}
                aria-invalid={duplicateOutput || undefined}
                aria-describedby={duplicateOutput ? 'output-name-error' : undefined}
                onChange={(event) => setNewKey(event.target.value)}
              />
            </label>
            {editingOutput !== null && (
              <p className="status-line">Current source{' '}{currentSourceLabel || 'None'}</p>
            )}
            {duplicateOutput && (
              <p id="output-name-error" className="status-bad">That output name is already in use.</p>
            )}
            <SelectField
              label="Source type"
              value={source}
              options={[
                { value: 'step', label: 'Step' },
                { value: 'model', label: 'Data model' },
              ]}
              onChange={(value) => {
                setSource(value === 'model' ? 'model' : 'step');
                setStepResult('');
                setNewFrom('');
                setModelId('');
                setFieldName('');
              }}
            />
            {source === 'step' ? (
              <>
                <SelectField
                  label="Step result"
                  required
                  value={stepResult}
                  options={[
                    { value: '', label: 'Select a step result' },
                    ...stepRefs.map((stepRef) => ({ value: stepRef.ref, label: stepRef.label })),
                    { value: '$path', label: 'Enter a result path' },
                  ]}
                  onChange={(picked) => {
                    setStepResult(picked);
                    setNewFrom(picked === '$path' ? '' : picked);
                  }}
                />
                {stepResult === '$path' && (
                  <DataRefPicker
                    label="Step output"
                    trimOnCommit
                    autoFocus
                    description="Enter the step ID and field separated by a dot."
                    required
                    value={newFrom}
                    options={stepRefs}
                    onCommit={setNewFrom}
                    onEdit={setNewFrom}
                    placeholder="step.field"
                  />
                )}
              </>
            ) : (
              <>
                <SelectField
                  label="Data model"
                  required
                  value={model?.type_id ?? ''}
                  options={[
                    { value: '', label: 'Select a published model' },
                    ...models.map((item) => ({ value: item.type_id, label: `${item.name} (v${item.version})` })),
                  ]}
                  onChange={(value) => {
                    setModelId(value);
                    setFieldName('');
                  }}
                />
                {model && (
                  <SelectField
                    label="Model field"
                    required
                    value={fieldName}
                    options={[
                      { value: '', label: 'Select a field' },
                      ...modelFields.map((field) => ({ value: field.name, label: field.name })),
                    ]}
                    onChange={setFieldName}
                  />
                )}
                {workspace.isFetching || version.isFetching ? (
                  <p role="status">Loading model data…</p>
                ) : workspace.error || version.error ? (
                  <div>
                    <p role="alert">{workspace.error ? 'Could not load data models.' : 'Could not load fields for this model.'}</p>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (workspace.error) void workspace.refetch();
                        else if (model) void version.refetch();
                      }}
                    >
                      Retry
                    </button>
                  </div>
                ) : models.length === 0 ? (
                  <p>Publish a model in Data Designer to use its fields here.</p>
                ) : model && modelFields.length === 0 ? (
                  <p>This model has no active fields.</p>
                ) : model && fieldName && !modelField ? (
                  <p role="alert">{fieldName} is no longer active in {model.name} v{model.version}. Choose another field.</p>
                ) : modelId && !model ? (
                  <p role="alert">{modelId} is unavailable. Choose another data model.</p>
                ) : model ? (
                  <p>Choose a record when you run the workflow. Outputs that use the same model field share the selected record.</p>
                ) : null}
              </>
            )}
            <div className="finish-output-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!newKey.trim() || duplicateOutput || (source === 'step' ? !newFrom.trim() : !model || !modelField)}
              >
                {editingOutput === null ? 'Add' : 'Apply'}
              </button>
              <button type="button" className="btn" onClick={closeOutputForm}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {!addingBinding && (
          <button
            type="button"
            ref={addOutputButton}
            className="btn add-binding-button"
            onClick={() => setAddingBinding(true)}
          >
            + Add output
          </button>
        )}
      </div>
      <details className="finish-inputs">
        <summary>Workflow input bindings</summary>
        {(def.inputs ?? []).length === 0 && <p>No workflow inputs to bind.</p>}
        {(def.inputs ?? []).map((input) => (
          <fieldset key={input.name}>
            <legend>{input.name}</legend>
            <DesignerBindingPicker
              value={input.designer ?? null}
              onChange={(binding) =>
                edit((draft) => {
                  const target = draft.inputs?.find((field) => field.name === input.name);
                  if (!target) {
                    return;
                  }
                  if (binding) {
                    target.designer = binding;
                  } else {
                    delete target.designer;
                  }
                })
              }
            />
          </fieldset>
        ))}
      </details>
    </div>
  );
}

function WorkflowSettings({ def, edit, saved, requiredSetup }: {
  def: WorkflowDefinition;
  edit: EditFn;
  saved: boolean;
  requiredSetup: boolean;
}) {
  const dispatch = useAppDispatch();
  const errorPrefix = useId();
  const inputs = def.inputs ?? [];
  const library = useListWorkflowsQuery(undefined, { skip: saved });
  const duplicateId = !saved && library.data?.workflows.some(({ workflow_id }) => workflow_id === def.workflow_id);
  const nameErrors = workflowInputNameErrors(inputs);
  const reduxStore = useStore<RootState>();
  const freshDef = (): WorkflowDefinition =>
    reduxStore.getState().workflowEditor.draft ?? def;
  const inputsSection = useRef<HTMLElement>(null);
  const addInputButton = useRef<HTMLButtonElement>(null);
  const inputToFocus = useRef<number | null>(null);
  useEffect(() => {
    const index = inputToFocus.current;
    if (index === null) return;
    inputToFocus.current = null;
    const field = inputsSection.current?.querySelector<HTMLInputElement>(`input[aria-label="Input ${index + 1} name"]`);
    (field ?? addInputButton.current)?.focus();
  }, [inputs]);

  function moveInput(index: number, direction: -1 | 1) {
    const next = moveWorkflowInput(freshDef(), index, direction);
    if (!next) return;
    inputToFocus.current = index + direction;
    dispatch(updateDraft(next));
  }
  const policy = (def.policy ?? {}) as {
    execution_approval?: string;
    skill_approval?: string;
  };
  return (
    <div className="workflow-settings configuration-card">
      <div className="settings-intro">
        <div>
          <strong>{def.name || def.workflow_id || 'Workflow'}</strong>
        </div>
      </div>
      <TextField
        id="creator-workflow-id"
        label="Workflow id"
        autoFocus={requiredSetup}
        required={!saved}
        trimOnCommit
        autoCapitalize="none"
        spellCheck={false}
        error={duplicateId ? 'That workflow ID is already in use.' : undefined}
        description={saved
          ? 'This ID is fixed after the first save.'
          : 'Enter a unique ID. Your connected model provider uses it to look up and run this workflow.'}
        value={def.workflow_id}
        readOnly={saved}
        onCommit={(v) =>
          edit((d) => {
            d.workflow_id = v;
          })
        }
      />
      <section ref={inputsSection} aria-label="Inputs" className="settings-inputs">
        <h3>
          Inputs{' '}
          <span className="count-badge">{inputs.length} {inputs.length === 1 ? 'field' : 'fields'}</span>
        </h3>
        <div className="input-column-head" aria-hidden="true">
          <span>Field</span>
          <span>Type</span>
          <span>Req.</span>
          <span />
        </div>
        {inputs.map((inp, i) => (
          <div key={i}>
            <div className="map-row settings-input-row">
              <InputNameField
                index={i}
                value={inp.name}
                errorId={nameErrors[i] ? `${errorPrefix}-${i}` : undefined}
                onCommit={(v) => {
                  const next = renameWorkflowInput(freshDef(), i, v);
                  if (next) {
                    dispatch(updateDraft(next));
                  }
                }}
              />
              <select
                aria-label={`Input ${i + 1} type`}
                value={inp.type ?? 'string'}
                onChange={(e) =>
                  edit((d) => {
                    const t = d.inputs?.[i];
                    if (t) {
                      t.type = e.target.value;
                    }
                  })
                }
              >
                {Object.entries(INPUT_TYPE_LABELS).map(([type, label]) => (
                  <option key={type} value={type}>{label}</option>
                ))}
              </select>
              <label className="check-inline">
                <input
                  type="checkbox"
                  aria-label={`Input ${i + 1} required`}
                  checked={inp.required === true}
                  onChange={(e) =>
                    edit((d) => {
                      const t = d.inputs?.[i];
                      if (t) {
                        t.required = e.target.checked;
                      }
                    })
                  }
                />
                <span className="sr-only">Required</span>
              </label>
              <div className="input-row-actions">
                {inputs.length > 1 && (
                  <>
                    <button type="button" className="btn" disabled={i === 0}
                      aria-label={`Move input ${inp.name} up`} onClick={() => moveInput(i, -1)}>↑</button>
                    <button type="button" className="btn" disabled={i === inputs.length - 1}
                      aria-label={`Move input ${inp.name} down`} onClick={() => moveInput(i, 1)}>↓</button>
                  </>
                )}
                <button
                  type="button"
                  className="btn"
                  aria-label={`Remove input ${inp.name}`}
                  onClick={() => {
                    const next = removeWorkflowInput(freshDef(), i);
                    if (next) {
                      inputToFocus.current = Math.min(i, (next.inputs?.length ?? 0) - 1);
                      dispatch(updateDraft(next));
                    }
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            {nameErrors[i] && (
              <p id={`${errorPrefix}-${i}`} className="workflow-input-error status-bad">
                {nameErrors[i]}
              </p>
            )}
          </div>
        ))}
        {(def.inputs ?? []).length === 0 && (
          <p className="status-line">No inputs.</p>
        )}
        <button
          ref={addInputButton}
          type="button"
          className="btn"
          onClick={() => {
            const current = freshDef();
            inputToFocus.current = current.inputs?.length ?? 0;
            dispatch(updateDraft(addWorkflowInput(current)));
          }}
        >
          + Add input
        </button>
        {defaultStartStaleFields(def).length > 0 && (
          <p className="status-line" role="alert">
            <span className="status-bad">
              Start still collects {defaultStartStaleFields(def).join(', ')},
              which is not a declared input.{' '}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const next = syncDefaultStartFields(freshDef());
                if (next) {
                  dispatch(updateDraft(next));
                }
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
          description="Choose when someone must approve a workflow run before it starts."
          value={policy.execution_approval ?? 'first_run'}
          options={EXECUTION_APPROVAL_OPTIONS}
          onChange={(v) =>
            edit((d) => {
              d.policy = { ...(d.policy ?? {}), execution_approval: v };
            })
          }
        />
        <SelectField
          label="Skill approval"
          description="Choose whether to ask for approval before using a newly drafted skill. The step controls whether it can draft skills."
          value={policy.skill_approval ?? 'new_names'}
          options={SKILL_APPROVAL_OPTIONS}
          onChange={(v) =>
            edit((d) => {
              d.policy = { ...(d.policy ?? {}), skill_approval: v };
            })
          }
        />
      </section>
    </div>
  );
}
