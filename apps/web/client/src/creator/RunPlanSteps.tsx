import type { WorkflowDefinition, WorkflowStep } from '../api/contracts';
import { END_NODE_ID, EXECUTION_APPROVAL_OPTIONS, SKILL_APPROVAL_OPTIONS, inputTypeLabel, stepTypeLabel } from './adapter';
import { outputSourceIssue, reachableWorkflowSteps } from './preflight';
import type { PreflightIssue } from './preflight';

export type RunPlan = {
  entry?: string;
  order?: Array<{ step_id: string; type: string }>;
  gates?: Array<{ step_id: string; prompt?: string }>;
  skills?: Array<{ step_id: string; skill?: string; from?: string }>;
};

type BranchCondition = {
  ref?: string;
  op?: string;
  value?: unknown;
  all?: BranchCondition[];
  any?: BranchCondition[];
};

const conditionOperators = new Map([
  ['eq', '='], ['ne', '≠'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'],
  ['contains', 'contains'],
]);

function describeCondition(condition?: BranchCondition): string {
  if (!condition) return '';
  const group = Array.isArray(condition.all) ? condition.all : condition.any;
  if (Array.isArray(group)) {
    const separator = group === condition.all ? ' and ' : ' or ';
    const terms = group.map(describeCondition).filter(Boolean);
    return terms.length > 1 ? `(${terms.join(separator)})` : terms[0] ?? '';
  }
  const { ref, op, value } = condition;
  if (!ref || !op) return '';
  return op === 'exists'
    ? `${ref} exists`
    : `${ref} ${conditionOperators.get(op) ?? op} ${JSON.stringify(value) ?? ''}`.trim();
}

function stepLabels(steps: WorkflowStep[]) {
  const counts = new Map<string, number>();
  for (const step of steps) {
    const name = step.name || step.step_id;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Map(steps.map(({ name, step_id }) => {
    const label = name || step_id;
    return [step_id, (counts.get(label) ?? 0) > 1 ? `${label} (${step_id})` : label];
  }));
}

export function RunPlanSteps({ plan, definition, onGoToStep, onOpenSettings, onGoToInput }: {
  plan: RunPlan | null;
  definition: WorkflowDefinition;
  onGoToStep?: (id: string, bodyStep?: string, outputName?: string, routeField?: PreflightIssue['routeField']) => void;
  onOpenSettings: () => void;
  onGoToInput?: (index: number) => void;
}) {
  const steps = definition.steps ?? [];
  const inputs = definition.inputs ?? [];
  const outputs = Object.entries(definition.outputs ?? {});
  const byId = new Map(steps.map((step) => [step.step_id, step]));
  const sourceRoots = new Set([...byId.keys(), ...inputs.map(({ name }) => name)]);
  const order = plan?.order ?? [];
  const entry = plan?.entry ?? order[0]?.step_id;
  const mainIds = new Set(order.map((item) => item.step_id));
  const reachable = reachableWorkflowSteps(steps, entry ?? '');
  const outsideMain = order.length ? steps.filter((step) => !mainIds.has(step.step_id)) : [];
  const alternate = outsideMain.filter((step) => reachable.has(step.step_id));
  const unreachable = outsideMain.filter((step) => !reachable.has(step.step_id));
  const labels = stepLabels(steps);
  const titleOf = (id: string) => id === 'end' ? 'Finish' : labels.get(id) ?? id;

  const executionApproval = definition.policy?.execution_approval ?? 'first_run';
  const skillApproval = definition.policy?.skill_approval ?? 'new_names';

  type Loop = { id: string; labels: Map<string, string> };
  function destination(id: string, source: string, routeField: PreflightIssue['routeField'], loop?: Loop) {
    const destinations = loop?.labels ?? labels;
    const label = id === 'end' ? (loop ? 'Finish loop' : 'Finish') : destinations.get(id) ?? id;
    if (id !== 'end' && !destinations.has(id)) return onGoToStep ? (
      <button type="button" className="link-button status-bad" onClick={() => onGoToStep(loop?.id ?? source, loop ? source : undefined, undefined, routeField)}>
        {label} (missing)
      </button>
    ) : <span className="status-bad">{label} (missing)</span>;
    if (!onGoToStep || (loop && id === 'end')) return label;
    return (
      <button type="button" className="link-button" onClick={() => onGoToStep(loop?.id ?? (id === 'end' ? END_NODE_ID : id), loop ? id : undefined)}>
        {label}
      </button>
    );
  }

  function routes(step: WorkflowStep, loop?: Loop) {
    const rules = step.type === 'conditional_routing' && Array.isArray(step.config?.rules)
      ? step.config.rules as Array<{ goto?: string; when?: BranchCondition }> : [];
    const success = step.on_success ?? (loop ? undefined : 'end');
    if (!success && !step.on_failure && !rules.some((rule) => rule?.goto)) return null;
    return (
      <dl className="run-plan-routes">
        {rules.map((rule, index) => rule?.goto && (
          <div key={index}>
            <dt>{describeCondition(rule.when) || `Rule ${index + 1}`}</dt>
            <dd>{destination(rule.goto, step.step_id, `rule-${index + 1}`, loop)}</dd>
          </div>
        ))}
        {success && <div>
          <dt>{step.type === 'conditional_routing' ? 'If no rule matches' : 'On success'}</dt>
          <dd>{destination(success, step.step_id, 'success', loop)}</dd>
        </div>}
        {step.on_failure && <div><dt>On failure</dt><dd>{destination(step.on_failure, step.step_id, 'failure', loop)}</dd></div>}
      </dl>
    );
  }

  function stepRow(item: { step_id: string; type: string }, step?: WorkflowStep) {
    const cfg = step?.config as {
      prompt?: string;
      over?: string;
      body?: WorkflowStep[];
      max_iterations?: number;
    } | undefined;
    const prompt = plan?.gates?.find((gate) => gate.step_id === item.step_id)?.prompt ?? cfg?.prompt;
    const loop = step?.type === 'iteration' && Array.isArray(cfg?.body)
      ? { id: step.step_id, labels: stepLabels(cfg.body) } : undefined;
    const skill = plan?.skills?.find((binding) => binding.step_id === item.step_id);
    return (
      <li key={item.step_id}>
        <strong>
          {step && onGoToStep ? (
            <button type="button" className="link-button" onClick={() => onGoToStep(step.step_id)}>
              {titleOf(item.step_id)}
            </button>
          ) : titleOf(item.step_id)}
        </strong>
        <span>{stepTypeLabel(step ?? item)}</span>
        {item.step_id === entry && <span>Starts here</span>}
        {item.type === 'human_approval' && <p>Wait for approval{prompt ? `: ${prompt}` : ''}</p>}
        {skill && <p>Calculation: {skill.skill ?? skill.from ?? 'Selected at run time'}</p>}
        {step?.type === 'iteration' && (
          <details className="run-plan-loop">
            <summary>Loop steps</summary>
            {cfg?.over && <p>Repeat for each item in <code>{cfg.over}</code>.</p>}
            {typeof cfg?.max_iterations === 'number' && <p>Maximum items {cfg.max_iterations}</p>}
            {Array.isArray(cfg?.body) && cfg.body.length > 0 ? (
              <ol>
                {cfg.body.map((child) => (
                  <li key={child.step_id}>
                    {onGoToStep ? (
                      <button type="button" className="link-button" onClick={() => onGoToStep(step.step_id, child.step_id)}>
                        {loop?.labels.get(child.step_id) ?? child.step_id}
                      </button>
                    ) : loop?.labels.get(child.step_id) ?? child.step_id}
                    {routes(child, loop)}
                  </li>
                ))}
              </ol>
            ) : <p>No steps in this loop.</p>}
          </details>
        )}
        {step && routes(step)}
      </li>
    );
  }

  return (
    <>
      <dl className="run-plan-routes" aria-label="Approval policy">
        <div>
          <dt>Execution approval</dt>
          <dd>{EXECUTION_APPROVAL_OPTIONS.find(({ value }) => value === executionApproval)?.label ?? String(executionApproval)}</dd>
        </div>
        <div>
          <dt>Skill approval</dt>
          <dd>{SKILL_APPROVAL_OPTIONS.find(({ value }) => value === skillApproval)?.label ?? String(skillApproval)}</dd>
        </div>
      </dl>
      {inputs.length > 0 && (
        <section aria-label="Workflow inputs">
          <h3>Workflow inputs</h3>
          <dl className="run-plan-routes">
            {inputs.map((input, index) => (
              <div key={index}>
                <dt>{onGoToInput ? (
                  <button type="button" className="link-button" aria-label={`Edit input ${input.name}`} onClick={() => onGoToInput(index)}>{input.name}</button>
                ) : input.name}</dt>
                <dd>{inputTypeLabel(input.type)} · {input.required ? 'Required' : 'Optional'}{input.designer ? ' · Data model' : ''}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="link-button" onClick={onOpenSettings}>Edit inputs in Settings</button>
        </section>
      )}
      {order.length ? (
        <>
          <h3>Default path</h3>
          <p className="status-line">Follows success routes and branch fallbacks.</p>
          <ol className="run-plan-steps" aria-label="Default path">
            {order.map((item) => stepRow(item, byId.get(item.step_id)))}
          </ol>
        </>
      ) : <p className="status-line" role="status">No steps in the plan.</p>}
      {alternate.length > 0 && (
        <>
          <h3>Other destinations</h3>
          <ul className="run-plan-steps" aria-label="Other destinations">
            {alternate.map((step) => stepRow(step, step))}
          </ul>
        </>
      )}
      {unreachable.length > 0 && (
        <>
          <h3>Unreachable steps</h3>
          <ul className="run-plan-steps" aria-label="Unreachable steps">
            {unreachable.map((step) => stepRow(step, step))}
          </ul>
        </>
      )}
      {outputs.length > 0 && (
        <section aria-label="Workflow outputs">
          <h3>Workflow outputs</h3>
          <dl className="run-plan-routes">
            {outputs.map(([name, binding]) => {
              const from = (binding as { from?: unknown } | null)?.from;
              const source = typeof from === 'string' ? from : '';
              const model = definition.inputs?.find((input) => input.name === source)?.designer;
              const problem = outputSourceIssue(source, sourceRoots);
              const fixLabel = problem === 'empty' ? 'Choose a source' : 'Source missing';
              return (
                <div key={name}>
                  <dt>{onGoToStep && !problem ? (
                    <button type="button" className="link-button" aria-label={`Edit output ${name}`} onClick={() => onGoToStep(END_NODE_ID, undefined, name)}>
                      {name}
                    </button>
                  ) : name}</dt>
                  <dd>
                    {model ? ['Data model', model.type, model.field].filter(Boolean).join(' · ') : source.trim()}
                    {problem && <> {onGoToStep ? (
                      <button type="button" className="link-button" aria-label={`${fixLabel} for ${name}`} onClick={() => onGoToStep(END_NODE_ID, undefined, name)}>
                        {fixLabel}
                      </button>
                    ) : <span className="status-bad">{fixLabel}</span>}</>}
                  </dd>
                </div>
              );
            })}
          </dl>
          {onGoToStep && (
            <button type="button" className="link-button" onClick={() => onGoToStep(END_NODE_ID)}>
              Edit outputs in Finish
            </button>
          )}
        </section>
      )}
    </>
  );
}
