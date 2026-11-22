import { useEffect, useId, useRef, useState } from 'react';
import type { StepType, WorkflowDefinition, WorkflowStep } from '../api/contracts';
import { useGetDesignerWorkspaceQuery } from '../api/steelApi';
import {
  CheckField,
  DataRefPicker,
  NumberField,
  SelectField,
  TextField,
} from './fields';
import { PRED_OPS, PROJECT_TABLES, REASON_TOOLS, REASON_TOOL_LABELS, STEP_TYPES, defaultConfig, insertWorkflowStep, stepNameWithId, stepTypeLabel } from './adapter';
import { availableRefs } from './preflight';
import type { RefOption } from './preflight';

// Deep-edit helper: clone the draft, mutate, commit once (one undo entry).
export type EditFn = (fn: (d: WorkflowDefinition) => void) => void;

export function findStep(
  def: WorkflowDefinition,
  stepId: string,
  bodyOf: string | null,
): WorkflowStep | null {
  if (!bodyOf) {
    return (def.steps ?? []).find((s) => s.step_id === stepId) ?? null;
  }
  const loop = (def.steps ?? []).find((s) => s.step_id === bodyOf);
  const body = (loop?.config as Record<string, unknown> | undefined)?.body as
    | WorkflowStep[]
    | undefined;
  return (body ?? []).find((s) => s.step_id === stepId) ?? null;
}

function smartValue(text: string): unknown {
  const t = text.trim();
  if (t === '') {
    return '';
  }
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

function fmt(v: unknown): string {
  return typeof v === 'string' ? v : (JSON.stringify(v) ?? '');
}

export function RoutingSection({
  def,
  step,
  bodyOf,
  edit,
  onFollow,
}: {
  def: WorkflowDefinition;
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
  onFollow: (target: string) => void;
}) {
  const list = bodyOf
    ? (((
        findStep(def, bodyOf, null)?.config as
          | Record<string, unknown>
          | undefined
      )?.body as WorkflowStep[] | undefined) ?? [])
    : (def.steps ?? []);
  const options = [
    ...list
      .filter((s) => s.step_id !== step.step_id)
      .map((s) => ({
        value: s.step_id,
        label: stepNameWithId(s),
      })),
    { value: 'end', label: bodyOf ? 'Finish loop' : 'Finish' },
  ];
  const success = step.on_success ?? 'end';
  const failure = step.on_failure ?? '';
  const isBranch = step.type === 'conditional_routing';
  const isUnavailable = (target: string) => target !== '' && !options.some((option) => option.value === target);
  function optionsFor(target: string) {
    return isUnavailable(target)
      ? [...options, { value: target, label: `Unavailable: ${target}` }]
      : options;
  }
  return (
    <section aria-label="Routing">
      <h3>Next step</h3>
      <SelectField
        id="creator-route-success"
        label={isBranch ? 'If no rule matches' : 'On success'}
        error={isUnavailable(success) ? 'This destination is unavailable. Choose another step.' : undefined}
        value={success}
        options={optionsFor(success)}
        onChange={(v) =>
          edit((d) => {
            const t = findStep(d, step.step_id, bodyOf);
            if (t) {
              t.on_success = v;
            }
          })
        }
      />
      <SelectField
        id="creator-route-failure"
        label="On failure"
        error={isUnavailable(failure) ? 'This destination is unavailable. Choose another step or fail the run.' : undefined}
        value={failure}
        options={optionsFor(failure)}
        emptyLabel="Fail the run"
        onChange={(v) =>
          edit((d) => {
            const t = findStep(d, step.step_id, bodyOf);
            if (!t) {
              return;
            }
            if (v === '') {
              delete t.on_failure;
            } else {
              t.on_failure = v;
            }
          })
        }
      />
      <div className="route-actions">
        <button
          className="btn"
          type="button"
          disabled={!options.some((option) => option.value === success)}
          onClick={() => onFollow(success)}
        >
          {isBranch ? 'Follow fallback route' : 'Follow success route'}
        </button>
        {failure && (
          <button
            className="btn"
            type="button"
            disabled={!options.some((option) => option.value === failure)}
            onClick={() => onFollow(failure)}
          >
            Follow failure route
          </button>
        )}
      </div>
    </section>
  );
}

export function MappingEditor({
  step,
  holder,
  bodyOf,
  refs,
  edit,
  title,
}: {
  step: WorkflowStep;
  holder: string;
  bodyOf: string | null;
  refs: RefOption[];
  edit: EditFn;
  title: string;
}) {
  const mapping =
    ((step.config ?? {}) as Record<string, Record<string, { from?: string }>>)[
      holder
    ] ?? {};
  const [newKey, setNewKey] = useState('');
  const duplicateKey = Object.hasOwn(mapping, newKey.trim());
  const duplicateErrorId = useId();
  const [newFrom, setNewFrom] = useState('');
  const [adding, setAdding] = useState(false);
  const keyField = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (adding) keyField.current?.focus();
  }, [adding]);
  return (
    <section aria-label={title} className="binding-section">
      <h3>
        {title}{' '}
        <span className="count-badge">
          {Object.values(mapping).filter((v) => v?.from?.trim()).length} mapped
        </span>
      </h3>
      {Object.entries(mapping).map(([k, v]) => (
        <div key={k} className="map-row binding-row">
          <code className="num">{k}</code>
          <span className="binding-arrow" aria-hidden="true">
            ←
          </span>
          <DataRefPicker
            label={`Source for ${k}`}
            value={v?.from ?? ''}
            options={refs}
            onCommit={(from) =>
              edit((d) => {
                const t = findStep(d, step.step_id, bodyOf);
                if (!t) {
                  return;
                }
                const cfg = (t.config ?? {}) as Record<
                  string,
                  Record<string, { from?: string }>
                >;
                cfg[holder] = cfg[holder] ?? {};
                cfg[holder][k] = { from };
                t.config = cfg;
              })
            }
          />
          <button
            type="button"
            className="btn"
            aria-label={`Remove ${k}`}
            onClick={() =>
              edit((d) => {
                const t = findStep(d, step.step_id, bodyOf);
                const cfg = (t?.config ?? {}) as Record<
                  string,
                  Record<string, { from?: string }>
                >;
                if (cfg[holder]) {
                  delete cfg[holder][k];
                }
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      {Object.keys(mapping).length === 0 && (
        <p className="status-line">No bindings yet.</p>
      )}
      {adding && (
        <>
          <div className="map-row new-binding-row">
            <input
              type="text"
              ref={keyField}
              aria-label="New binding key"
              placeholder="key"
              value={newKey}
              aria-invalid={duplicateKey || undefined}
              aria-describedby={duplicateKey ? duplicateErrorId : undefined}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <DataRefPicker
              label="New binding source"
              value={newFrom}
              options={refs}
              onEdit={setNewFrom}
              onCommit={setNewFrom}
            />
            <button
              type="button"
              className="btn"
              disabled={duplicateKey || newKey.trim() === '' || newFrom.trim() === ''}
              onClick={() => {
                const k = newKey.trim();
                const f = newFrom.trim();
                setNewKey('');
                setNewFrom('');
                setAdding(false);
                toggle.current?.focus();
                edit((d) => {
                  const t = findStep(d, step.step_id, bodyOf);
                  if (!t) {
                    return;
                  }
                  const cfg = (t.config ?? {}) as Record<
                    string,
                    Record<string, { from?: string }>
                  >;
                  if (Object.hasOwn(cfg[holder] ?? {}, k)) return;
                  cfg[holder] = { ...cfg[holder], [k]: { from: f } };
                  t.config = cfg;
                });
              }}
            >
              Add
            </button>
          </div>
          {duplicateKey && <p id={duplicateErrorId} className="status-bad">That name is already mapped. Edit its source above.</p>}
        </>
      )}
      <button
        type="button"
        ref={toggle}
        className="btn section-add-button"
        onClick={() => setAdding((v) => !v)}
      >
        {adding ? 'Cancel new binding' : '+ Add binding'}
      </button>
    </section>
  );
}

function patchCfg(
  edit: EditFn,
  stepId: string,
  bodyOf: string | null,
  patch: Record<string, unknown>,
): void {
  edit((d) => {
    const t = findStep(d, stepId, bodyOf);
    if (!t) {
      return;
    }
    t.config = { ...(t.config ?? {}), ...patch };
  });
}

export function InputCollectionConfig({
  def,
  step,
  bodyOf,
  edit,
}: {
  def: WorkflowDefinition;
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
}) {
  const cfg = (step.config ?? {}) as { fields?: string[]; prompt?: string };
  void def;
  return (
    <section aria-label="Collection">
      <h3>What to collect</h3>
      <TextField
        label="Fields (comma-separated)"
        value={(cfg.fields ?? []).join(', ')}
        onCommit={(v) =>
          patchCfg(edit, step.step_id, bodyOf, {
            fields: v
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s !== ''),
          })
        }
      />
      <TextField
        label="Prompt"
        value={cfg.prompt ?? ''}
        onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { prompt: v })}
      />
    </section>
  );
}

export function ReasoningConfig({
  step,
  bodyOf,
  edit,
}: {
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
}) {
  const cfg = (step.config ?? {}) as {
    goal?: string;
    tools_allowed?: string[];
    max_rounds?: number;
  };
  const allowed = new Set(cfg.tools_allowed ?? []);
  return (
    <section aria-label="Reasoning">
      <h3>Model instructions</h3>
      <TextField
        label="Instructions"
        multiline
        value={cfg.goal ?? ''}
        onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { goal: v })}
      />
      <fieldset>
        <legend>Allowed tools</legend>
        {REASON_TOOLS.map((t) => (
          <CheckField
            key={t}
            label={REASON_TOOL_LABELS[t]}
            checked={allowed.has(t)}
            onChange={(on) => {
              const next = new Set(allowed);
              if (on) {
                next.add(t);
              } else {
                next.delete(t);
              }
              patchCfg(edit, step.step_id, bodyOf, {
                tools_allowed: [...next],
              });
            }}
          />
        ))}
      </fieldset>
      <NumberField
        label="Max rounds"
        integer
        min={1}
        value={cfg.max_rounds}
        onCommit={(v) =>
          patchCfg(edit, step.step_id, bodyOf, { max_rounds: v })
        }
      />
    </section>
  );
}

interface DesignerScope {
  type?: string;
  workspace?: string;
  limit?: number;
  filters?: Array<{
    field?: string;
    op?: string;
    value?: unknown;
    values?: unknown[];
  }>;
}

export function DatabaseConfig({
  step,
  bodyOf,
  edit,
}: {
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
}) {
  const cfg = (step.config ?? {}) as {
    table?: string;
    project_id_from?: { from?: string };
    limit?: number;
    designer?: DesignerScope;
  };
  const ws = useGetDesignerWorkspaceQuery(undefined);
  const designerTypes = ws.data?.types ?? [];
  const scoped = cfg.designer !== undefined;
  const scope: DesignerScope = cfg.designer ?? {};
  const scopeType =
    designerTypes.find(
      (t) => t.name === scope.type || t.type_id === scope.type,
    ) ?? null;
  const scopeFields = (scopeType?.fields ?? []).filter(
    (f) => f.status === 'active',
  );

  const setScope = (next: DesignerScope | null) =>
    edit((d) => {
      const t = findStep(d, step.step_id, bodyOf);
      if (!t) {
        return;
      }
      const c = { ...(t.config ?? {}) } as Record<string, unknown>;
      if (next === null) {
        delete c.designer;
        if (typeof c.table !== 'string') {
          c.table = PROJECT_TABLES[0];
        }
      } else {
        delete c.table;
        delete c.project_id_from;
        c.designer = next;
      }
      t.config = c;
    });
  const patchScope = (patch: Partial<DesignerScope>) =>
    setScope({ ...scope, ...patch });

  return (
    <section aria-label="Lookup">
      <h3>What to look up</h3>
      <div className="toolbar" role="radiogroup" aria-label="Lookup scope">
        <label className="status-line">
          <input
            type="radio"
            name={`scope-${step.step_id}`}
            checked={!scoped}
            onChange={() => setScope(null)}
          />{' '}
          Project table
        </label>
        <label className="status-line">
          <input
            type="radio"
            name={`scope-${step.step_id}`}
            checked={scoped}
            onChange={() => setScope({ type: designerTypes[0]?.name ?? '' })}
          />{' '}
          Designer records
        </label>
      </div>
      {!scoped ? (
        <>
          <SelectField
            label="Table"
            value={cfg.table ?? PROJECT_TABLES[0]}
            options={PROJECT_TABLES.map((t) => ({ value: t, label: t }))}
            onChange={(v) => patchCfg(edit, step.step_id, bodyOf, { table: v })}
          />
          <TextField
            label="Project id from (optional)"
            placeholder="scope.project"
            value={cfg.project_id_from?.from ?? ''}
            onCommit={(v) =>
              edit((d) => {
                const t = findStep(d, step.step_id, bodyOf);
                if (!t) {
                  return;
                }
                const c = { ...(t.config ?? {}) } as Record<string, unknown>;
                if (v.trim() === '') {
                  delete c.project_id_from;
                } else {
                  c.project_id_from = { from: v.trim() };
                }
                t.config = c;
              })
            }
          />
          <NumberField
            label="Limit"
            integer
            min={1}
            value={cfg.limit}
            onClear={() => patchCfg(edit, step.step_id, bodyOf, { limit: undefined })}
            onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { limit: v })}
          />
        </>
      ) : (
        <>
          <p className="status-line">
            Runs FIND Record over the live published spec at run time (local
            store only).
          </p>
          <SelectField
            label="Designer type"
            value={scope.type ?? ''}
            options={designerTypes.map((t) => ({
              value: t.name,
              label: `${t.name} (v${t.version})`,
            }))}
            emptyLabel={
              ws.isLoading
                ? 'Loading…'
                : designerTypes.length === 0
                  ? '(no published types)'
                  : '— pick —'
            }
            onChange={(v) => patchScope({ type: v, filters: [] })}
          />
          {(scope.filters ?? []).map((f, i) => (
            <div key={i} className="map-row">
              <select
                aria-label={`Filter ${i + 1} field`}
                value={f.field ?? ''}
                onChange={(e) => {
                  const filters = [...(scope.filters ?? [])];
                  filters[i] = { ...filters[i], field: e.target.value };
                  patchScope({ filters });
                }}
              >
                <option value="">— field —</option>
                {scopeFields.map((x) => (
                  <option key={x.field_id} value={x.name}>
                    {x.name} [{x.ftype}]
                  </option>
                ))}
              </select>
              <select
                aria-label={`Filter ${i + 1} operator`}
                value={f.op ?? '='}
                onChange={(e) => {
                  const filters = [...(scope.filters ?? [])];
                  const op = e.target.value;
                  filters[i] =
                    op === 'IN'
                      ? { field: filters[i].field, op, values: [] }
                      : { field: filters[i].field, op, value: '' };
                  patchScope({ filters });
                }}
              >
                <option value="=">=</option>
                <option value="IN">IN</option>
              </select>
              {f.op === 'IN' ? (
                <textarea
                  aria-label={`Filter ${i + 1} values, one per line`}
                  rows={2}
                  placeholder="one value per line"
                  value={((f.values ?? []) as unknown[])
                    .map((v) => String(v))
                    .join('\n')}
                  onChange={(e) => {
                    const filters = [...(scope.filters ?? [])];
                    filters[i] = {
                      ...filters[i],
                      values: e.target.value
                        .split('\n')
                        .map((l) => l.trim())
                        .filter((l) => l !== ''),
                    };
                    patchScope({ filters });
                  }}
                />
              ) : (
                <input
                  type="text"
                  aria-label={`Filter ${i + 1} value`}
                  value={f.value === undefined ? '' : String(f.value)}
                  onChange={(e) => {
                    const filters = [...(scope.filters ?? [])];
                    filters[i] = {
                      ...filters[i],
                      value: smartValue(e.target.value),
                    };
                    patchScope({ filters });
                  }}
                />
              )}
              <button
                type="button"
                className="btn"
                aria-label={`Remove filter ${i + 1}`}
                onClick={() =>
                  patchScope({
                    filters: (scope.filters ?? []).filter((_, n) => n !== i),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              onClick={() =>
                patchScope({
                  filters: [
                    ...(scope.filters ?? []),
                    { field: scopeFields[0]?.name ?? '', op: '=', value: '' },
                  ],
                })
              }
            >
              + Filter
            </button>
          </div>
          <NumberField
            label="Limit"
            integer
            min={1}
            value={scope.limit}
            onClear={() => patchScope({ limit: undefined })}
            onCommit={(v) => patchScope({ limit: v })}
          />
        </>
      )}
    </section>
  );
}

export function SkillRetrievalConfig({
  step,
  bodyOf,
  edit,
}: {
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
}) {
  const cfg = (step.config ?? {}) as {
    query_template?: string;
    top_k?: number;
    origin?: string;
  };
  return (
    <section aria-label="Search">
      <h3>What to find</h3>
      <TextField
        label="Search query"
        description="Use {step.field} to include a workflow value."
        value={cfg.query_template ?? ''}
        onCommit={(v) =>
          patchCfg(edit, step.step_id, bodyOf, { query_template: v })
        }
      />
      <NumberField
        label="Max results"
        integer
        min={1}
        value={cfg.top_k}
        onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { top_k: v })}
      />
      <SelectField
        label="Origin"
        value={cfg.origin ?? ''}
        options={[
          { value: 'seed', label: 'seed' },
          { value: 'learned', label: 'learned' },
        ]}
        emptyLabel="(any)"
        onChange={(v) =>
          edit((d) => {
            const t = findStep(d, step.step_id, bodyOf);
            if (!t) {
              return;
            }
            const c = { ...(t.config ?? {}) } as Record<string, unknown>;
            if (v === '') {
              delete c.origin;
            } else {
              c.origin = v;
            }
            t.config = c;
          })
        }
      />
    </section>
  );
}

const COMPARISON_LABELS: Record<(typeof PRED_OPS)[number], string> = {
  eq: 'Equals',
  ne: 'Does not equal',
  gt: 'Greater than',
  gte: 'Greater than or equal to',
  lt: 'Less than',
  lte: 'Less than or equal to',
  contains: 'Contains',
  exists: 'Exists',
};

export function BranchConfig({
  def,
  step,
  bodyOf,
  edit,
  refs,
}: {
  def: WorkflowDefinition;
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
  refs: RefOption[];
}) {
  const cfg = (step.config ?? {}) as {
    rules?: Array<{ when?: unknown; goto?: string }>;
  };
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const [ruleError, setRuleError] = useState<number | null>(null);
  const ruleSection = useRef<HTMLElement>(null);
  const focusNewRule = useRef(false);
  useEffect(() => {
    if (!focusNewRule.current) return;
    focusNewRule.current = false;
    ruleSection.current?.querySelector<HTMLInputElement>('.rule-block:last-of-type input')?.focus();
  }, [rules.length]);
  const list = bodyOf
    ? (((
        findStep(def, bodyOf, null)?.config as
          | Record<string, unknown>
          | undefined
      )?.body as WorkflowStep[] | undefined) ?? [])
    : (def.steps ?? []);
  const targets = [
    ...list
      .filter((s) => s.step_id !== step.step_id)
      .map((s) => ({ value: s.step_id, label: stepNameWithId(s) })),
    { value: 'end', label: bodyOf ? 'Finish loop' : 'Finish' },
  ];
  const fallback = step.on_success ?? 'end';
  const fallbackLabel = targets.find((target) => target.value === fallback)?.label ?? fallback;

  function moveRule(index: number, offset: number) {
    setRuleError(null);
    edit((draft) => {
      const target = findStep(draft, step.step_id, bodyOf);
      const current = (target?.config as { rules?: unknown[] } | undefined)?.rules;
      const next = index + offset;
      if (!current || next < 0 || next >= current.length) return;
      const [rule] = current.splice(index, 1);
      current.splice(next, 0, rule);
    });
  }

  return (
    <section ref={ruleSection} aria-label="Branch rules">
      <h3>Branch rules</h3>
      <p className="status-line">Checks rules in order. If none match, go to {fallbackLabel}.</p>
      {rules.map((r, i) => {
        const destination = r?.goto ?? 'end';
        const unavailable = destination !== '' && !targets.some((target) => target.value === destination);
        const when = (r?.when ?? {}) as {
          ref?: string;
          op?: string;
          value?: unknown;
          all?: unknown;
          any?: unknown;
        };
        const compound = Array.isArray(when.all) || Array.isArray(when.any);
        return (
          <div key={i} className="rule-block">
            <div className="branch-rule-heading">
              <strong>Rule {i + 1}</strong>
              <div className="branch-rule-order">
                <button type="button" className="btn" disabled={i === 0} onClick={() => moveRule(i, -1)} aria-label={`Move rule ${i + 1} up`}>↑</button>
                <button type="button" className="btn" disabled={i === rules.length - 1} onClick={() => moveRule(i, 1)} aria-label={`Move rule ${i + 1} down`}>↓</button>
              </div>
            </div>
            {compound ? (
              <TextField
                label="Condition JSON"
                multiline
                value={JSON.stringify(r.when)}
                onCommit={(v) => {
                  try {
                    const parsed = JSON.parse(v) as typeof when | null;
                    const isCondition = parsed && (
                      Array.isArray(parsed.all) || Array.isArray(parsed.any) ||
                      (typeof parsed.ref === 'string' && typeof parsed.op === 'string')
                    );
                    if (!isCondition) {
                      setRuleError(i);
                      return;
                    }
                    setRuleError(null);
                    edit((d) => {
                      const t = findStep(d, step.step_id, bodyOf);
                      const rs = (
                        (t?.config ?? {}) as {
                          rules?: Array<{ when?: unknown }>;
                        }
                      ).rules;
                      if (rs?.[i]) {
                        rs[i].when = parsed;
                      }
                    });
                  } catch {
                    setRuleError(i);
                  }
                }}
              />
            ) : (
              <>
                <DataRefPicker
                  label="Value source"
                  value={when.ref ?? ''}
                  options={refs}
                  onCommit={(v) =>
                    edit((d) => {
                      const t = findStep(d, step.step_id, bodyOf);
                      const rs = (
                        (t?.config ?? {}) as {
                          rules?: Array<{ when?: Record<string, unknown> }>;
                        }
                      ).rules;
                      if (rs?.[i]) {
                        rs[i].when = {
                          ...(typeof rs[i].when === 'object' &&
                          rs[i].when !== null
                            ? (rs[i].when as Record<string, unknown>)
                            : {}),
                          ref: v,
                        };
                      }
                    })
                  }
                />
                <SelectField
                  label="Comparison"
                  value={when.op ?? 'eq'}
                  options={PRED_OPS.map((op) => ({ value: op, label: COMPARISON_LABELS[op] }))}
                  onChange={(v) =>
                    edit((d) => {
                      const t = findStep(d, step.step_id, bodyOf);
                      const rs = (
                        (t?.config ?? {}) as {
                          rules?: Array<{ when?: Record<string, unknown> }>;
                        }
                      ).rules;
                      if (rs?.[i]) {
                        rs[i].when = {
                          ...(typeof rs[i].when === 'object' &&
                          rs[i].when !== null
                            ? (rs[i].when as Record<string, unknown>)
                            : {}),
                          op: v,
                        };
                      }
                    })
                  }
                />
                {when.op !== 'exists' && (
                  <TextField
                    label="Compare with"
                    value={fmt(when.value)}
                    onCommit={(v) =>
                      edit((d) => {
                        const t = findStep(d, step.step_id, bodyOf);
                        const rs = (
                          (t?.config ?? {}) as {
                            rules?: Array<{ when?: Record<string, unknown> }>;
                          }
                        ).rules;
                        if (rs?.[i]) {
                          rs[i].when = {
                            ...(typeof rs[i].when === 'object' &&
                            rs[i].when !== null
                              ? (rs[i].when as Record<string, unknown>)
                              : {}),
                            value: smartValue(v),
                          };
                        }
                      })
                    }
                  />
                )}
              </>
            )}
            {ruleError === i && <p className="status-bad" role="alert">Use an all or any list, or provide a ref and op.</p>}
            <SelectField
              id={`creator-route-rule-${i + 1}`}
              label="Go to"
              error={unavailable ? 'This destination is unavailable. Choose another step.' : undefined}
              value={destination}
              options={unavailable
                ? [...targets, { value: destination, label: `Unavailable: ${destination}` }]
                : targets}
              onChange={(v) =>
                edit((d) => {
                  const t = findStep(d, step.step_id, bodyOf);
                  const rs = (
                    (t?.config ?? {}) as { rules?: Array<{ goto?: string }> }
                  ).rules;
                  if (rs?.[i]) {
                    rs[i].goto = v;
                  }
                })
              }
            />
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRuleError(null);
                edit((d) => {
                  const t = findStep(d, step.step_id, bodyOf);
                  const rs = ((t?.config ?? {}) as { rules?: unknown[] }).rules;
                  rs?.splice(i, 1);
                });
              }}
            >
              Remove rule
            </button>
          </div>
        );
      })}
      {rules.length === 0 && (
        <p className="status-line">
          No rules yet.
        </p>
      )}
      <button
        type="button"
        className="btn"
        onClick={() =>
          edit((d) => {
            const t = findStep(d, step.step_id, bodyOf);
            if (!t) {
              return;
            }
            const c = (t.config ?? {}) as { rules?: unknown[] };
            c.rules = Array.isArray(c.rules) ? c.rules : [];
            focusNewRule.current = true;
            c.rules.push({
              when: { ref: '', op: 'eq', value: '' },
              goto: 'end',
            });
            t.config = c;
          })
        }
      >
        Add rule
      </button>
    </section>
  );
}

export function LoopConfig({
  def,
  step,
  edit,
  onEditBody,
}: {
  def: WorkflowDefinition;
  step: WorkflowStep;
  edit: EditFn;
  onEditBody: (loopId: string, bodyId: string) => void;
}) {
  const cfg = (step.config ?? {}) as {
    over?: string;
    max_iterations?: number;
    body?: WorkflowStep[];
  };
  const body = Array.isArray(cfg.body) ? cfg.body : [];
  const bodyById = new Map(body.map((child) => [child.step_id, child]));
  function destinationLabel(id: string) {
    if (id === 'end') return 'Finish loop';
    const target = bodyById.get(id);
    return target ? stepNameWithId(target) : `${id} (unavailable)`;
  }
  const [addType, setAddType] = useState<StepType>('input_collection');
  const [afterId, setAfterId] = useState<string>();
  const tails = body.filter((child) => !child.on_success || child.on_success === 'end');
  const connectAfter = afterId !== undefined && (afterId === '' || body.some((child) => child.step_id === afterId))
    ? afterId
    : tails.length === 1 ? tails[0].step_id : '';
  const refs = availableRefs(def, step.step_id);
  const bodyTypes = STEP_TYPES.filter(({ value }) => value !== 'iteration' && value !== 'human_approval');

  function addBodyStep() {
    let addedId: string | undefined;
    edit((draft) => {
      const loop = findStep(draft, step.step_id, null);
      if (!loop) return;
      const config = loop.config ?? {};
      const list = Array.isArray(config.body) ? config.body as WorkflowStep[] : [];
      let n = list.length + 1;
      while (list.some((child) => child.step_id === `b${n}`)) n++;
      addedId = `b${n}`;
      loop.config = {
        ...config,
        body: insertWorkflowStep(list, {
          step_id: addedId,
          type: addType,
          name: stepTypeLabel({ type: addType }),
          config: defaultConfig(addType),
          on_success: 'end',
        }, connectAfter || null),
      };
    });
    if (addedId) onEditBody(step.step_id, addedId);
  }

  return (
    <section aria-label="Loop">
      <h3>Repeat for each item</h3>
      <DataRefPicker
        label="List source"
        value={cfg.over ?? ''}
        options={refs}
        onCommit={(v) => patchCfg(edit, step.step_id, null, { over: v })}
      />
      <NumberField
        label="Max iterations"
        integer
        min={1}
        value={cfg.max_iterations}
        onCommit={(v) =>
          patchCfg(edit, step.step_id, null, { max_iterations: v })
        }
      />
      <h3>Body steps ({body.length})</h3>
      <p className="status-line">
        These steps run for each item. Add approvals or other loops outside this loop.
      </p>
      <ul className="plain">
        {body.map((b, index) => (
          <li key={b.step_id} className="list-row">
            <button
              type="button"
              className="link-button list-title"
              onClick={() => onEditBody(step.step_id, b.step_id)}
            >
              {stepNameWithId(b)}
            </button>
            <span className="list-meta">{stepTypeLabel(b)}{index === 0 ? ' · Starts loop' : ''}</span>
            <div className="loop-step-route">
              <span>{b.type === 'conditional_routing' ? 'If no rule matches' : 'On success'} → {destinationLabel(b.on_success ?? 'end')}</span>
              {b.on_failure && <span>On failure → {destinationLabel(b.on_failure)}</span>}
            </div>
          </li>
        ))}
      </ul>
      {body.length === 0 && <p className="status-line">No steps in this loop.</p>}
      {body.length > 0 && (
        <SelectField
          label="Connect after"
          value={connectAfter}
          options={[
            { value: '', label: 'Leave unconnected' },
            ...body.map((child) => ({ value: child.step_id, label: stepNameWithId(child) })),
          ]}
          onChange={setAfterId}
        />
      )}
      <div className="map-row">
        <select
          aria-label="Body step type"
          value={addType}
          onChange={(event) => setAddType(event.target.value as StepType)}
        >
          {bodyTypes.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <button type="button" className="btn" onClick={addBodyStep}>
          Add to body
        </button>
      </div>
    </section>
  );
}

export function ApprovalConfig({
  step,
  bodyOf,
  edit,
}: {
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
}) {
  const cfg = (step.config ?? {}) as { prompt?: string };
  return (
    <section aria-label="Approval">
      <h3>What the reviewer decides</h3>
      <p className="status-line">
        The run pauses here until a human approves or rejects. Rejection needs a
        useful path forward in the prompt.
      </p>
      <TextField
        label="Prompt"
        multiline
        value={cfg.prompt ?? ''}
        onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { prompt: v })}
      />
    </section>
  );
}
