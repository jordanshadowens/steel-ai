// Client-side preflight: known-incompatibility errors before running.
// The server validator stays authoritative; these checks only flag what the
// UI can prove from the draft plus the verified skill bank (exact
// input_params), and clearly label the rest as unknown shapes.
import type { SkillRow, WorkflowDefinition, WorkflowInput, WorkflowStep } from '../api/contracts';
import { END_NODE_ID } from './adapter';

export interface PreflightIssue {
  stepId: string | null;
  bodyStepId?: string;
  outputName?: string;
  inputIndex?: number;
  destination?: 'settings';
  routeField?: 'success' | 'failure' | `rule-${number}`;
  severity: 'error' | 'warning';
  message: string;
}

export interface RefOption {
  ref: string;
  label: string;
  detail: string;
}

function refHead(ref: string): string {
  const dot = ref.indexOf('.');
  const br = ref.indexOf('[');
  const cut = dot === -1 ? br : br === -1 ? dot : Math.min(dot, br);
  return cut === -1 ? ref : ref.slice(0, cut);
}

export function outputSourceIssue(source: unknown, roots: ReadonlySet<string>) {
  if (typeof source !== 'string' || !source.trim()) return 'empty';
  return roots.has(refHead(source)) ? null : 'missing';
}

export function availableRefs(
  def: WorkflowDefinition,
  stepId: string,
  options: { includeInputs?: boolean; includeCollectedStepRoots?: boolean } = {},
): RefOption[] {
  const opts: RefOption[] = [];
  for (const inp of (options.includeInputs === false ? [] : def.inputs ?? [])) {
    opts.push({
      ref: inp.name,
      label: inp.name,
      detail: `input · ${inp.type ?? 'string'}${inp.required ? ' · required' : ''}`,
    });
  }
  const steps = def.steps ?? [];
  const idx = steps.findIndex((s) => s.step_id === stepId);
  for (let i = 0; i < (idx === -1 ? steps.length : idx); i++) {
    const s = steps[i];
    const cfg = (s.config ?? {}) as Record<string, unknown>;
    const fields = s.type === 'input_collection' && Array.isArray(cfg.fields) ? cfg.fields : null;
    if (!fields || options.includeCollectedStepRoots) {
      opts.push({
        ref: s.step_id,
        label: s.name || s.step_id,
        detail: `Result from ${s.name || s.step_id}`,
      });
    }
    for (const field of fields ?? []) {
      if (typeof field === 'string' && field) {
        opts.push({
          ref: `${s.step_id}.${field}`,
          label: `${s.name || s.step_id} · ${field}`,
          detail: `Field from ${s.name || s.step_id}`,
        });
      }
    }
  }
  return opts;
}

// Body scope: the current element plus everything visible outside the loop
// (declared inputs and steps before the loop) plus earlier body siblings.
export function bodyRefs(
  def: WorkflowDefinition,
  loopId: string,
  bodyStepId: string,
): RefOption[] {
  const opts: RefOption[] = [
    {
      ref: 'item',
      label: 'item',
      detail: 'current list element (this loop only)',
    },
  ];
  for (const inp of def.inputs ?? []) {
    opts.push({
      ref: inp.name,
      label: inp.name,
      detail: `input · ${inp.type ?? 'string'}`,
    });
  }
  const steps = def.steps ?? [];
  const loopIdx = steps.findIndex((s) => s.step_id === loopId);
  for (let i = 0; i < (loopIdx === -1 ? 0 : loopIdx); i++) {
    const s = steps[i];
    opts.push({
      ref: s.step_id,
      label: s.step_id,
      detail: `outer step · ${s.name || s.step_id}`,
    });
  }
  const loop = steps.find((s) => s.step_id === loopId);
  const body = ((loop?.config as Record<string, unknown> | undefined)?.body ??
    []) as Array<{ step_id: string; name?: string }>;
  const idx = body.findIndex((s) => s.step_id === bodyStepId);
  for (let i = 0; i < (idx === -1 ? body.length : idx); i++) {
    opts.push({
      ref: body[i].step_id,
      label: body[i].step_id,
      detail: `earlier body step · ${body[i].name || body[i].step_id}`,
    });
  }
  return opts;
}

export function workflowInputNameErrors(inputs: WorkflowInput[]): Array<string | undefined> {
  const counts = new Map<string, number>();
  for (const input of inputs) {
    counts.set(input.name, (counts.get(input.name) ?? 0) + 1);
  }
  return inputs.map(({ name }) => {
    if (!name?.trim()) return 'Enter an input name.';
    if (!/^[A-Za-z0-9_-]+$/.test(name)) return 'Use letters, numbers, hyphens, or underscores.';
    if ((counts.get(name) ?? 0) > 1) return `"${name}" is used more than once.`;
    return undefined;
  });
}

export function reachableWorkflowSteps(steps: WorkflowStep[], entry: string): Set<string> {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  const byId = new Map(steps.map((s) => [s.step_id, s]));
  while (queue.length > 0) {
    const cur = byId.get(queue.pop() as string);
    if (!cur) {
      continue;
    }
    const outs = [cur.on_success, cur.on_failure];
    const cfg = (cur.config ?? {}) as Record<string, unknown>;
    if (cur.type === 'conditional_routing' && Array.isArray(cfg.rules)) {
      for (const r of cfg.rules as Array<{ goto?: string }>) {
        outs.push(r?.goto);
      }
    }
    for (const t of outs) {
      if (t && t !== 'end' && byId.has(t) && !seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
    }
  }
  return seen;
}

function findMissingRoutes(step: WorkflowStep, validIds: Set<string>) {
  return [
    ['next step', step.on_success],
    ['failure route', step.on_failure],
  ].filter(([, target]) => target && target !== 'end' && !validIds.has(target));
}

function checkBranchRules(
  step: WorkflowStep,
  validIds: Set<string>,
  issues: PreflightIssue[],
  loopId?: string,
) {
  const rules = step.config?.rules;
  if (step.type !== 'conditional_routing' || !Array.isArray(rules)) return;
  const location = loopId ? { stepId: loopId, bodyStepId: step.step_id } : { stepId: step.step_id };
  (rules as Array<{ goto?: string; when?: { ref?: unknown; all?: unknown; any?: unknown } }>).forEach((rule, index) => {
    const condition = rule?.when;
    const ruleNumber = index + 1;
    if (!Array.isArray(condition?.all) && !Array.isArray(condition?.any) &&
        (typeof condition?.ref !== 'string' || !condition.ref.trim())) {
      issues.push({
        ...location,
        severity: 'error',
        message: `Choose a value source for rule ${ruleNumber} in step "${step.step_id}".`,
      });
    }
    if (rule?.goto && rule.goto !== 'end' && !validIds.has(rule.goto)) {
      issues.push({
        ...location,
        routeField: `rule-${ruleNumber}`,
        severity: 'error',
        message: `Step "${step.step_id}" rule ${ruleNumber} points at missing step "${rule.goto}".`,
      });
    }
  });
}

export function runPreflight(
  def: Pick<WorkflowDefinition, 'steps' | 'inputs' | 'outputs'>,
  skills: SkillRow[],
): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  workflowInputNameErrors(def.inputs ?? []).forEach((message, index) => {
    if (message) issues.push({
      stepId: null,
      destination: 'settings',
      inputIndex: index,
      severity: 'error',
      message: `Input ${index + 1}: ${message}`,
    });
  });
  const steps = def.steps ?? [];
  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.step_id)) {
      issues.push({
        stepId: s.step_id,
        severity: 'error',
        message: `Duplicate step id "${s.step_id}". Step ids must be unique.`,
      });
    }
    ids.add(s.step_id);
  }
  const declaredInputs = new Set((def.inputs ?? []).map((i) => i.name));
  const skillByNameVersion = new Map(
    skills.map((s) => [`${s.name}@${s.version}`, s]),
  );

  const earlier = new Set<string>();
  for (const s of steps) {
    const cfg = (s.config ?? {}) as Record<string, unknown>;
    if (s.type === 'skill_execution') {
      const skill = cfg.skill as
        | { name?: string; version?: number; from?: string }
        | undefined;
      const mapping = (cfg.inputs_mapping ?? {}) as Record<
        string,
        { from?: string }
      >;
      const keys = Object.keys(mapping);
      if (skill && typeof skill.name === 'string') {
        const banked = skillByNameVersion.get(`${skill.name}@${skill.version}`);
        if (banked?.input_params) {
          const missing = banked.input_params.filter((p) => !keys.includes(p));
          if (missing.length > 0) {
            issues.push({
              stepId: s.step_id,
              severity: 'error',
              message: `Add mappings for ${missing.join(', ')} in step "${s.step_id}". ${skill.name} v${skill.version} requires those exact parameter names.`,
            });
          }
          const extra = keys.filter((k) => !banked.input_params?.includes(k));
          if (extra.length > 0) {
            issues.push({
              stepId: s.step_id,
              severity: 'warning',
              message: `Step "${s.step_id}" maps ${extra.join(', ')}, which ${skill.name} does not declare. Extra values are ignored at run time.`,
            });
          }
        } else {
          issues.push({
            stepId: s.step_id,
            severity: 'warning',
            message: `Step "${s.step_id}" uses ${skill.name} v${skill.version}, which is missing. Choose an available calculation version.`,
          });
        }
      } else if (
        !skill?.from &&
        typeof cfg.calculation_nl === 'string' &&
        cfg.calculation_nl.trim() !== '' &&
        keys.length === 0
      ) {
        issues.push({
          stepId: s.step_id,
          severity: 'error',
          message: `Add at least one parameter mapping before drafting or running the calculation in step "${s.step_id}".`,
        });
      }
      for (const [k, v] of Object.entries(mapping)) {
        const from = v?.from ?? '';
        if (!from) {
          issues.push({
            stepId: s.step_id,
            severity: 'error',
            message: `Step "${s.step_id}" parameter "${k}" has no data source.`,
          });
          continue;
        }
        const head = refHead(from);
        if (!declaredInputs.has(head) && !earlier.has(head)) {
          issues.push({
            stepId: s.step_id,
            severity: 'warning',
            message: `Step "${s.step_id}" binds "${k}" from "${from}", which does not match a workflow input or an earlier step.`,
          });
        }
      }
    }
    if (s.type === 'document_generation') {
      if (typeof cfg.template !== 'string' || cfg.template.trim() === '') {
        issues.push({
          stepId: s.step_id,
          severity: 'error',
          message: `Retired document step "${s.step_id}" is missing its template. Remove or replace the step.`,
        });
      }
      const mappings = (cfg.mappings ?? {}) as Record<
        string,
        { from?: string }
      >;
      for (const [k, v] of Object.entries(mappings)) {
        if (!v?.from) {
          issues.push({
            stepId: s.step_id,
            severity: 'error',
            message: `Retired document step "${s.step_id}" has no source for "${k}". Remove or replace the step.`,
          });
        }
      }
    }
    if (s.type === 'iteration') {
      if (typeof cfg.over !== 'string' || !cfg.over.trim()) {
        issues.push({
          stepId: s.step_id,
          severity: 'error',
          message: `Choose a list source for loop "${s.step_id}".`,
        });
      }
      if (!Array.isArray(cfg.body) || cfg.body.length === 0) {
        issues.push({
          stepId: s.step_id,
          severity: 'error',
          message: `Add at least one step inside loop "${s.step_id}".`,
        });
      } else {
        const bodySteps = (cfg.body as WorkflowStep[]).filter((child) => typeof child?.step_id === 'string');
        if (bodySteps.length > 0) {
          const bodyIds = new Set(bodySteps.map((child) => child.step_id));
          const reachable = reachableWorkflowSteps(bodySteps, bodySteps[0].step_id);
          for (const child of bodySteps) {
            checkBranchRules(child, bodyIds, issues, s.step_id);
            for (const [label, target] of findMissingRoutes(child, bodyIds)) {
              issues.push({
                stepId: s.step_id,
                bodyStepId: child.step_id,
                routeField: label === 'next step' ? 'success' : 'failure',
                severity: 'error',
                message: `Loop step "${child.step_id}" has a ${label} set to missing step "${target}".`,
              });
            }
            if (reachable.has(child.step_id)) continue;
            issues.push({
              stepId: s.step_id,
              bodyStepId: child.step_id,
              severity: 'warning',
              message: `No route inside loop "${s.step_id}" reaches "${child.step_id}". Connect it to another loop step.`,
            });
          }
        }
      }
    }
    checkBranchRules(s, ids, issues);
    for (const [label, target] of findMissingRoutes(s, ids)) {
      issues.push({
        stepId: s.step_id,
        routeField: label === 'next step' ? 'success' : 'failure',
        severity: 'error',
        message: `Step "${s.step_id}" ${label} points at missing step "${target}".`,
      });
    }
    earlier.add(s.step_id);
  }

  // Reachability from the entry step.
  if (steps.length > 0) {
    const seen = reachableWorkflowSteps(steps, steps[0].step_id);
    for (const s of steps) {
      if (!seen.has(s.step_id)) {
        issues.push({
          stepId: s.step_id,
          severity: 'warning',
          message: `No route from "${steps[0].step_id}" reaches "${s.step_id}". Connect it to a reachable step.`,
        });
      }
    }
  }
  const outputRoots = new Set([...declaredInputs, ...ids]);
  for (const [name, binding] of Object.entries(def.outputs ?? {})) {
    const from = (binding as { from?: unknown } | null)?.from;
    const problem = outputSourceIssue(from, outputRoots);
    if (problem === 'empty') {
      issues.push({ stepId: END_NODE_ID, outputName: name, severity: 'error', message: `Output "${name}" needs a source.` });
      continue;
    }
    if (problem === 'missing') {
      issues.push({
        stepId: END_NODE_ID,
        outputName: name,
        severity: 'error',
        message: `Output "${name}" uses "${from}", which no longer points to a step or input.`,
      });
    }
  }
  return issues;
}
