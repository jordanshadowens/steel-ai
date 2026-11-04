import { useState } from 'react';
import type { WorkflowDefinition, WorkflowStep } from '../api/contracts';
import { CheckField, DataRefPicker, NumberField, SelectField, TextField } from './fields';
import { PRED_OPS, PROJECT_TABLES, REASON_TOOLS } from './adapter';
import { availableRefs } from './preflight';
import type { RefOption } from './preflight';

// Deep-edit helper: clone the draft, mutate, commit once (one undo entry).
export type EditFn = (fn: (d: WorkflowDefinition) => void) => void;

export function findStep(def: WorkflowDefinition, stepId: string, bodyOf: string | null): WorkflowStep | null {
  if (!bodyOf) return (def.steps ?? []).find((s) => s.step_id === stepId) ?? null;
  const loop = (def.steps ?? []).find((s) => s.step_id === bodyOf);
  const body = (loop?.config as Record<string, unknown> | undefined)?.body as WorkflowStep[] | undefined;
  return (body ?? []).find((s) => s.step_id === stepId) ?? null;
}

function smartValue(text: string): unknown {
  const t = text.trim();
  if (t === '') return '';
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

function fmt(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v) ?? '';
}

export function RoutingSection({ def, step, bodyOf, edit }: { def: WorkflowDefinition; step: WorkflowStep; bodyOf: string | null; edit: EditFn }) {
  const list = bodyOf ? (((findStep(def, bodyOf, null)?.config as Record<string, unknown> | undefined)?.body as WorkflowStep[] | undefined) ?? []) : (def.steps ?? []);
  const options = [...list.filter((s) => s.step_id !== step.step_id).map((s) => ({ value: s.step_id, label: `${s.name || s.step_id} (${s.step_id})` })), { value: 'end', label: 'end (finish)' }];
  return (
    <section aria-label="Routing">
      <h3>Next step</h3>
      <SelectField
        label="On success"
        value={step.on_success ?? 'end'}
        options={options}
        onChange={(v) => edit((d) => {
          const t = findStep(d, step.step_id, bodyOf);
          if (t) t.on_success = v;
        })}
      />
      <SelectField
        label="On failure"
        value={step.on_failure ?? ''}
        options={options}
        emptyLabel="(none — fail the run)"
        onChange={(v) => edit((d) => {
          const t = findStep(d, step.step_id, bodyOf);
          if (!t) return;
          if (v === '') delete t.on_failure;
          else t.on_failure = v;
        })}
      />
    </section>
  );
}

export function MappingEditor({ step, holder, refs, edit, title }: {
  step: WorkflowStep;
  holder: string;
  refs: RefOption[];
  edit: EditFn;
  title: string;
}) {
  const mapping = ((step.config ?? {}) as Record<string, Record<string, { from?: string }>>)[holder] ?? {};
  const [newKey, setNewKey] = useState('');
  const [newFrom, setNewFrom] = useState('');
  const [adding, setAdding] = useState(false);
  return (
    <section aria-label={title} className="binding-section">
      <h3>{title} <span className="count-badge">{Object.keys(mapping).length} mapped</span></h3>
      {Object.entries(mapping).map(([k, v]) => (
        <div key={k} className="map-row binding-row">
          <code className="num">{k}</code>
          <span className="binding-arrow" aria-hidden="true">←</span>
          <DataRefPicker label={`Source for ${k}`} value={v?.from ?? ''} options={refs} onCommit={(from) => edit((d) => {
            const t = findStep(d, step.step_id, null);
            if (!t) return;
            const cfg = (t.config ?? {}) as Record<string, Record<string, { from?: string }>>;
            cfg[holder] = cfg[holder] ?? {};
            cfg[holder][k] = { from };
            t.config = cfg;
          })}
          />
          <button
            type="button"
            className="btn"
            aria-label={`Remove ${k}`}
            onClick={() => edit((d) => {
              const t = findStep(d, step.step_id, null);
              const cfg = (t?.config ?? {}) as Record<string, Record<string, { from?: string }>>;
              if (cfg[holder]) delete cfg[holder][k];
            })}
          >
            ×
          </button>
        </div>
      ))}
      {Object.keys(mapping).length === 0 && <p className="status-line">No bindings yet.</p>}
      {adding && <div className="map-row new-binding-row">
        <input type="text" aria-label="New binding key" placeholder="key" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
        <input type="text" aria-label="New binding source" placeholder="step.field" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
        <button
          type="button"
          className="btn"
          disabled={newKey.trim() === '' || newFrom.trim() === ''}
          onClick={() => {
            const k = newKey.trim();
            const f = newFrom.trim();
            setNewKey('');
            setNewFrom('');
            setAdding(false);
            edit((d) => {
              const t = findStep(d, step.step_id, null);
              if (!t) return;
              const cfg = (t.config ?? {}) as Record<string, Record<string, { from?: string }>>;
              cfg[holder] = cfg[holder] ?? {};
              cfg[holder][k] = { from: f };
              t.config = cfg;
            });
          }}
        >
          Add
        </button>
      </div>}
      <button type="button" className="btn section-add-button" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel new binding' : '+ Add binding'}</button>
    </section>
  );
}

function patchCfg(edit: EditFn, stepId: string, bodyOf: string | null, patch: Record<string, unknown>): void {
  edit((d) => {
    const t = findStep(d, stepId, bodyOf);
    if (!t) return;
    t.config = { ...(t.config ?? {}), ...patch };
  });
}

export function InputCollectionConfig({ def, step, bodyOf, edit }: { def: WorkflowDefinition; step: WorkflowStep; bodyOf: string | null; edit: EditFn }) {
  const cfg = (step.config ?? {}) as { fields?: string[]; prompt?: string };
  void def;
  return (
    <section aria-label="Collection">
      <h3>What to collect</h3>
      <TextField
        label="Fields (comma-separated)"
        value={(cfg.fields ?? []).join(', ')}
        onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { fields: v.split(',').map((s) => s.trim()).filter((s) => s !== '') })}
      />
      <TextField label="Prompt" value={cfg.prompt ?? ''} onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { prompt: v })} />
    </section>
  );
}

export function ReasoningConfig({ step, bodyOf, edit }: { step: WorkflowStep; bodyOf: string | null; edit: EditFn }) {
  const cfg = (step.config ?? {}) as { goal?: string; tools_allowed?: string[]; max_rounds?: number };
  const allowed = new Set(cfg.tools_allowed ?? []);
  return (
    <section aria-label="Reasoning">
      <h3>Goal and tools</h3>
      <TextField label="Goal" multiline value={cfg.goal ?? ''} onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { goal: v })} />
      <fieldset>
        <legend>Tools (skill_propose is forbidden here)</legend>
        {REASON_TOOLS.map((t) => (
          <CheckField
            key={t}
            label={t}
            checked={allowed.has(t)}
            onChange={(on) => {
              const next = new Set(allowed);
              if (on) next.add(t);
              else next.delete(t);
              patchCfg(edit, step.step_id, bodyOf, { tools_allowed: [...next] });
            }}
          />
        ))}
      </fieldset>
      <NumberField label="Max rounds" min={1} value={cfg.max_rounds} onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { max_rounds: v })} />
    </section>
  );
}

export function DatabaseConfig({ step, bodyOf, edit }: { step: WorkflowStep; bodyOf: string | null; edit: EditFn }) {
  const cfg = (step.config ?? {}) as { table?: string; project_id_from?: { from?: string }; limit?: number };
  return (
    <section aria-label="Lookup">
      <h3>What to look up</h3>
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
        onCommit={(v) => edit((d) => {
          const t = findStep(d, step.step_id, bodyOf);
          if (!t) return;
          const c = { ...(t.config ?? {}) } as Record<string, unknown>;
          if (v.trim() === '') delete c.project_id_from;
          else c.project_id_from = { from: v.trim() };
          t.config = c;
        })}
      />
      <NumberField label="Limit" min={1} value={cfg.limit} onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { limit: v })} />
    </section>
  );
}

export function SkillRetrievalConfig({ step, bodyOf, edit }: { step: WorkflowStep; bodyOf: string | null; edit: EditFn }) {
  const cfg = (step.config ?? {}) as { query_template?: string; top_k?: number; origin?: string };
  return (
    <section aria-label="Search">
      <h3>What to find</h3>
      <TextField label="Query template ({ref} tokens)" value={cfg.query_template ?? ''} onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { query_template: v })} />
      <NumberField label="Top k" min={1} value={cfg.top_k} onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { top_k: v })} />
      <SelectField
        label="Origin"
        value={cfg.origin ?? ''}
        options={[{ value: 'seed', label: 'seed' }, { value: 'learned', label: 'learned' }]}
        emptyLabel="(any)"
        onChange={(v) => edit((d) => {
          const t = findStep(d, step.step_id, bodyOf);
          if (!t) return;
          const c = { ...(t.config ?? {}) } as Record<string, unknown>;
          if (v === '') delete c.origin;
          else c.origin = v;
          t.config = c;
        })}
      />
    </section>
  );
}

export function BranchConfig({ def, step, bodyOf, edit, refs }: { def: WorkflowDefinition; step: WorkflowStep; bodyOf: string | null; edit: EditFn; refs: RefOption[] }) {
  const cfg = (step.config ?? {}) as { rules?: Array<{ when?: unknown; goto?: string }> };
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const list = bodyOf ? (((findStep(def, bodyOf, null)?.config as Record<string, unknown> | undefined)?.body as WorkflowStep[] | undefined) ?? []) : (def.steps ?? []);
  const targets = [...list.filter((s) => s.step_id !== step.step_id).map((s) => ({ value: s.step_id, label: s.step_id })), { value: 'end', label: 'end' }];
  return (
    <section aria-label="Branch rules">
      <h3>Rules (first match wins; otherwise the next step)</h3>
      {rules.map((r, i) => {
        const when = (r?.when ?? {}) as { ref?: string; op?: string; value?: unknown; all?: unknown; any?: unknown };
        const compound = Array.isArray(when.all) || Array.isArray(when.any);
        return (
          <div key={i} className="rule-block">
            <div className="status-line num">Rule {i + 1}</div>
            {compound ? (
              <TextField
                label="Condition (compound all/any — edit as JSON)"
                multiline
                value={JSON.stringify(r.when)}
                onCommit={(v) => {
                  try {
                    const parsed = JSON.parse(v) as unknown;
                    edit((d) => {
                      const t = findStep(d, step.step_id, bodyOf);
                      const rs = ((t?.config ?? {}) as { rules?: Array<{ when?: unknown }> }).rules;
                      if (rs?.[i]) rs[i].when = parsed;
                    });
                  } catch {
                    // Invalid JSON keeps the old condition; validation reports it.
                  }
                }}
              />
            ) : (
              <>
                <DataRefPicker label="Value" value={when.ref ?? ''} options={refs} onCommit={(v) => edit((d) => {
                  const t = findStep(d, step.step_id, bodyOf);
                  const rs = ((t?.config ?? {}) as { rules?: Array<{ when?: Record<string, unknown> }> }).rules;
                  if (rs?.[i]) rs[i].when = { ...(typeof rs[i].when === 'object' && rs[i].when !== null ? rs[i].when as Record<string, unknown> : {}), ref: v };
                })}
                />
                <SelectField
                  label="Comparison"
                  value={when.op ?? 'eq'}
                  options={PRED_OPS.map((o) => ({ value: o, label: o }))}
                  onChange={(v) => edit((d) => {
                    const t = findStep(d, step.step_id, bodyOf);
                    const rs = ((t?.config ?? {}) as { rules?: Array<{ when?: Record<string, unknown> }> }).rules;
                    if (rs?.[i]) rs[i].when = { ...(typeof rs[i].when === 'object' && rs[i].when !== null ? rs[i].when as Record<string, unknown> : {}), op: v };
                  })}
                />
                {when.op !== 'exists' && (
                  <TextField label="Against" value={fmt(when.value)} onCommit={(v) => edit((d) => {
                    const t = findStep(d, step.step_id, bodyOf);
                    const rs = ((t?.config ?? {}) as { rules?: Array<{ when?: Record<string, unknown> }> }).rules;
                    if (rs?.[i]) rs[i].when = { ...(typeof rs[i].when === 'object' && rs[i].when !== null ? rs[i].when as Record<string, unknown> : {}), value: smartValue(v) };
                  })}
                  />
                )}
              </>
            )}
            <SelectField
              label="Go to"
              value={r?.goto ?? 'end'}
              options={targets}
              onChange={(v) => edit((d) => {
                const t = findStep(d, step.step_id, bodyOf);
                const rs = ((t?.config ?? {}) as { rules?: Array<{ goto?: string }> }).rules;
                if (rs?.[i]) rs[i].goto = v;
              })}
            />
            <button
              type="button"
              className="btn"
              onClick={() => edit((d) => {
                const t = findStep(d, step.step_id, bodyOf);
                const rs = ((t?.config ?? {}) as { rules?: unknown[] }).rules;
                rs?.splice(i, 1);
              })}
            >
              Remove rule
            </button>
          </div>
        );
      })}
      {rules.length === 0 && <p className="status-line">No rules — every run follows the next step.</p>}
      <button
        type="button"
        className="btn"
        onClick={() => edit((d) => {
          const t = findStep(d, step.step_id, bodyOf);
          if (!t) return;
          const c = (t.config ?? {}) as { rules?: unknown[] };
          c.rules = Array.isArray(c.rules) ? c.rules : [];
          c.rules.push({ when: { ref: '', op: 'eq', value: '' }, goto: 'end' });
          t.config = c;
        })}
      >
        Add rule
      </button>
    </section>
  );
}

export function LoopConfig({ def, step, edit, onEditBody }: { def: WorkflowDefinition; step: WorkflowStep; edit: EditFn; onEditBody: (loopId: string, bodyId: string) => void }) {
  const cfg = (step.config ?? {}) as { over?: string; max_iterations?: number; body?: WorkflowStep[] };
  const body = Array.isArray(cfg.body) ? cfg.body : [];
  const [addType, setAddType] = useState('input_collection');
  const refs = availableRefs(def, step.step_id);
  return (
    <section aria-label="Loop">
      <h3>What to repeat over</h3>
      <DataRefPicker label="Over (list)" value={cfg.over ?? ''} options={refs} onCommit={(v) => patchCfg(edit, step.step_id, null, { over: v })} />
      <NumberField label="Max iterations" min={1} value={cfg.max_iterations} onCommit={(v) => patchCfg(edit, step.step_id, null, { max_iterations: v })} />
      <h3>Body steps ({body.length})</h3>
      <p className="status-line">Body steps run once per item. Loops and approvals are not allowed inside a body.</p>
      <ul className="plain">
        {body.map((b) => (
          <li key={b.step_id} className="list-row">
            <button type="button" className="link-button list-title" onClick={() => onEditBody(step.step_id, b.step_id)}>
              {b.name || b.step_id}
            </button>
            <span className="list-meta">{b.type}</span>
          </li>
        ))}
      </ul>
      {body.length === 0 && <p className="status-line">Empty body.</p>}
      <div className="map-row">
        <select aria-label="Body step type" value={addType} onChange={(e) => setAddType(e.target.value)}>
          {['input_collection', 'model_reasoning', 'database_retrieval', 'skill_retrieval', 'skill_execution', 'conditional_routing', 'output_composition', 'document_generation'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          onClick={() => edit((d) => {
            const t = findStep(d, step.step_id, null);
            if (!t) return;
            const c = (t.config ?? {}) as { body?: WorkflowStep[] };
            const list = Array.isArray(c.body) ? c.body : [];
            let n = list.length + 1;
            while (list.some((s) => s.step_id === `b${n}`)) n++;
            list.push({ step_id: `b${n}`, type: addType, name: addType, config: {}, on_success: 'end' });
            c.body = list;
            t.config = c;
          })}
        >
          Add to body
        </button>
      </div>
    </section>
  );
}

export function ApprovalConfig({ step, bodyOf, edit }: { step: WorkflowStep; bodyOf: string | null; edit: EditFn }) {
  const cfg = (step.config ?? {}) as { prompt?: string };
  return (
    <section aria-label="Approval">
      <h3>What the reviewer decides</h3>
      <p className="status-line">The run pauses here until a human approves or rejects. Rejection needs a useful path forward in the prompt.</p>
      <TextField label="Prompt" multiline value={cfg.prompt ?? ''} onCommit={(v) => patchCfg(edit, step.step_id, bodyOf, { prompt: v })} />
    </section>
  );
}
