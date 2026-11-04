// Client-side preflight: known-incompatibility errors before running.
// The server validator stays authoritative; these checks only flag what the
// UI can prove from the draft plus the verified skill bank (exact
// input_params), and clearly label the rest as unknown shapes.
import type { SkillRow, WorkflowDefinition } from '../api/contracts';

export interface PreflightIssue {
  stepId: string | null;
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

export function availableRefs(def: WorkflowDefinition, stepId: string): RefOption[] {
  const opts: RefOption[] = [];
  for (const inp of def.inputs ?? []) {
    opts.push({ ref: inp.name, label: inp.name, detail: `input · ${inp.type ?? 'string'}${inp.required ? ' · required' : ''}` });
  }
  const steps = def.steps ?? [];
  const idx = steps.findIndex((s) => s.step_id === stepId);
  for (let i = 0; i < (idx === -1 ? steps.length : idx); i++) {
    const s = steps[i];
    const cfg = (s.config ?? {}) as Record<string, unknown>;
    if (s.type === 'input_collection' && Array.isArray(cfg.fields)) {
      for (const f of cfg.fields as unknown[]) {
        if (typeof f === 'string' && f) {
          opts.push({ ref: `${s.step_id}.${f}`, label: `${s.step_id}.${f}`, detail: `from ${s.name || s.step_id}` });
        }
      }
    } else {
      opts.push({ ref: s.step_id, label: s.step_id, detail: `output of ${s.name || s.step_id} (${s.type})` });
    }
  }
  return opts;
}

// Body scope: the current element plus everything visible outside the loop
// (declared inputs and steps before the loop) plus earlier body siblings.
export function bodyRefs(def: WorkflowDefinition, loopId: string, bodyStepId: string): RefOption[] {
  const opts: RefOption[] = [{ ref: 'item', label: 'item', detail: 'current list element (this loop only)' }];
  for (const inp of def.inputs ?? []) {
    opts.push({ ref: inp.name, label: inp.name, detail: `input · ${inp.type ?? 'string'}` });
  }
  const steps = def.steps ?? [];
  const loopIdx = steps.findIndex((s) => s.step_id === loopId);
  for (let i = 0; i < (loopIdx === -1 ? 0 : loopIdx); i++) {
    const s = steps[i];
    opts.push({ ref: s.step_id, label: s.step_id, detail: `outer step · ${s.name || s.step_id}` });
  }
  const loop = steps.find((s) => s.step_id === loopId);
  const body = ((loop?.config as Record<string, unknown> | undefined)?.body ?? []) as Array<{ step_id: string; name?: string }>;
  const idx = body.findIndex((s) => s.step_id === bodyStepId);
  for (let i = 0; i < (idx === -1 ? body.length : idx); i++) {
    opts.push({ ref: body[i].step_id, label: body[i].step_id, detail: `earlier body step · ${body[i].name || body[i].step_id}` });
  }
  return opts;
}

export function runPreflight(def: WorkflowDefinition, skills: SkillRow[]): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const steps = def.steps ?? [];
  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.step_id)) {
      issues.push({ stepId: s.step_id, severity: 'error', message: `Duplicate step id "${s.step_id}". Step ids must be unique.` });
    }
    ids.add(s.step_id);
  }
  const declaredInputs = new Set((def.inputs ?? []).map((i) => i.name));
  const skillByNameVersion = new Map(skills.map((s) => [`${s.name}@${s.version}`, s]));

  steps.forEach((s, idx) => {
    const cfg = (s.config ?? {}) as Record<string, unknown>;
    const earlier = new Set(steps.slice(0, idx).map((x) => x.step_id));
    if (s.type === 'skill_execution') {
      const skill = cfg.skill as { name?: string; version?: number; from?: string } | undefined;
      const mapping = (cfg.inputs_mapping ?? {}) as Record<string, { from?: string }>;
      const keys = Object.keys(mapping);
      if (skill && typeof skill.name === 'string') {
        const banked = skillByNameVersion.get(`${skill.name}@${skill.version}`);
        if (banked?.input_params) {
          const missing = banked.input_params.filter((p) => !keys.includes(p));
          if (missing.length > 0) {
            issues.push({
              stepId: s.step_id,
              severity: 'error',
              message: `Step "${s.step_id}" pins ${skill.name} v${skill.version} (needs ${banked.input_params.join(', ')}) but mappings lack: ${missing.join(', ')}. Add bindings — parameters are never renamed to fit.`,
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
            message: `Step "${s.step_id}" pins ${skill.name} v${skill.version}, which is not in the verified bank. Compatibility is unknown until validated.`,
          });
        }
      } else if (!skill?.from && typeof cfg.calculation_nl === 'string' && cfg.calculation_nl.trim() !== '' && keys.length === 0) {
        issues.push({
          stepId: s.step_id,
          severity: 'error',
          message: `Step "${s.step_id}" describes a calculation but binds no parameters. Bind each parameter before drafting or running.`,
        });
      }
      for (const [k, v] of Object.entries(mapping)) {
        const from = v?.from ?? '';
        if (!from) {
          issues.push({ stepId: s.step_id, severity: 'error', message: `Step "${s.step_id}" parameter "${k}" has no data source.` });
          continue;
        }
        const head = refHead(from);
        if (!declaredInputs.has(head) && !earlier.has(head)) {
          issues.push({
            stepId: s.step_id,
            severity: 'warning',
            message: `Step "${s.step_id}" binds "${k}" from "${from}", which matches no declared input or earlier step. Shape unknown — validation will confirm.`,
          });
        }
      }
    }
    if (s.type === 'document_generation') {
      if (typeof cfg.template !== 'string' || cfg.template.trim() === '') {
        issues.push({ stepId: s.step_id, severity: 'error', message: `Step "${s.step_id}" has no document template selected.` });
      }
      const mappings = (cfg.mappings ?? {}) as Record<string, { from?: string }>;
      for (const [k, v] of Object.entries(mappings)) {
        if (!v?.from) {
          issues.push({ stepId: s.step_id, severity: 'error', message: `Step "${s.step_id}" slot "${k}" has no data source.` });
        }
      }
    }
    if (s.type === 'conditional_routing' && Array.isArray(cfg.rules)) {
      (cfg.rules as Array<{ goto?: string }>).forEach((r, i) => {
        if (r?.goto && r.goto !== 'end' && !ids.has(r.goto)) {
          issues.push({ stepId: s.step_id, severity: 'error', message: `Step "${s.step_id}" rule ${i + 1} points at missing step "${r.goto}".` });
        }
      });
    }
    for (const [label, target] of [['next step', s.on_success], ['failure route', s.on_failure]] as const) {
      if (target && target !== 'end' && !ids.has(target)) {
        issues.push({ stepId: s.step_id, severity: 'error', message: `Step "${s.step_id}" ${label} points at missing step "${target}".` });
      }
    }
  });

  // Reachability from the entry step.
  if (steps.length > 0) {
    const seen = new Set<string>([steps[0].step_id]);
    const queue = [steps[0].step_id];
    const byId = new Map(steps.map((s) => [s.step_id, s]));
    while (queue.length > 0) {
      const cur = byId.get(queue.pop() as string);
      if (!cur) continue;
      const outs = [cur.on_success, cur.on_failure];
      const cfg = (cur.config ?? {}) as Record<string, unknown>;
      if (cur.type === 'conditional_routing' && Array.isArray(cfg.rules)) {
        for (const r of cfg.rules as Array<{ goto?: string }>) outs.push(r?.goto);
      }
      for (const t of outs) {
        if (t && t !== 'end' && byId.has(t) && !seen.has(t)) {
          seen.add(t);
          queue.push(t);
        }
      }
    }
    for (const s of steps) {
      if (!seen.has(s.step_id)) {
        issues.push({ stepId: s.step_id, severity: 'warning', message: `Step "${s.step_id}" is unreachable from the entry step "${steps[0].step_id}".` });
      }
    }
  }
  return issues;
}
