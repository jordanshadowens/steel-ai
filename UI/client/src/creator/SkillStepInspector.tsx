import { useState } from 'react';
import type { SkillRow, WorkflowDefinition, WorkflowStep } from '../api/contracts';
import { useDraftSkillMutation } from '../api/steelApi';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setSkillDraft, setSkillSample, setSkillMode } from '../store/workflowEditor';
import { CheckField, DataRefPicker, SelectField, TextField } from './fields';
import { MappingEditor } from './stepConfigs';
import type { EditFn } from './stepConfigs';
import type { RefOption } from './preflight';
import { useNotify } from './notices';

type Mode = 'saved' | 'new' | 'ref';

function smartSample(text: string): unknown {
  const t = text.trim();
  if (t === '') return '';
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

// Skill step in user task order: purpose → mode → saved/new/ref path →
// bindings → draft results → advanced. Sample values and draft outcomes
// live in session state so they survive node switches and retries.
export function SkillStepInspector({ def, step, bodyOf, edit, refs, skills }: {
  def: WorkflowDefinition;
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
  refs: RefOption[];
  skills: SkillRow[];
}) {
  const dispatch = useAppDispatch();
  const notify = useNotify();
  const cfg = (step.config ?? {}) as {
    skill?: { name?: string; version?: number; from?: string };
    calculation_nl?: string;
    deferred?: boolean;
    inputs_mapping?: Record<string, { from?: string }>;
    on_miss?: string;
  };
  const pinnedName = cfg.skill && typeof cfg.skill.name === 'string' ? cfg.skill.name : null;
  const pinned = pinnedName ? { name: pinnedName, version: cfg.skill?.version } : null;
  const fromRef = cfg.skill && typeof cfg.skill.from === 'string' ? cfg.skill.from : null;
  const modeOverride = useAppSelector((s) => s.workflowEditor.skillModes[step.step_id] ?? null);
  const setModeOverride = (mode: Mode | null) => dispatch(setSkillMode({ stepId: step.step_id, mode }));
  const mode: Mode | null = modeOverride ?? (pinned ? 'saved' : fromRef ? 'ref' : typeof cfg.calculation_nl === 'string' && cfg.calculation_nl.trim() !== '' ? 'new' : null);

  const mapping = cfg.inputs_mapping ?? {};
  const params = Object.keys(mapping);
  const samples = useAppSelector((s) => s.workflowEditor.skillSamples[step.step_id] ?? {});
  const draftOutcome = useAppSelector((s) => s.workflowEditor.skillDrafts[step.step_id]);
  const [draft, draftState] = useDraftSkillMutation();
  const [search, setSearch] = useState('');
  const [newParam, setNewParam] = useState('');
  const [showCode, setShowCode] = useState(false);

  const grouped = new Map<string, SkillRow[]>();
  for (const s of skills) {
    const list = grouped.get(s.name) ?? [];
    list.push(s);
    grouped.set(s.name, list);
  }
  for (const list of grouped.values()) list.sort((a, b) => b.version - a.version);
  const q = search.trim().toLowerCase();
  const names = [...grouped.keys()].filter((n) => !q || n.toLowerCase().includes(q)).sort();

  const banked = pinned ? grouped.get(pinned.name)?.find((s) => s.version === pinned.version) ?? grouped.get(pinned.name)?.[0] : undefined;

  const setCfg = (patch: Record<string, unknown>) => edit((d) => {
    const t = (d.steps ?? []).find((s) => s.step_id === step.step_id);
    if (bodyOf) {
      const loop = (d.steps ?? []).find((s) => s.step_id === bodyOf);
      const body = (loop?.config as Record<string, unknown> | undefined)?.body as WorkflowStep[] | undefined;
      const b = body?.find((s) => s.step_id === step.step_id);
      if (b) b.config = { ...(b.config ?? {}), ...patch };
      return;
    }
    if (t) t.config = { ...(t.config ?? {}), ...patch };
  });

  const pin = (name: string, version: number) => {
    setCfg({ skill: { name, version } });
    dispatch(setSkillDraft({ stepId: step.step_id, outcome: null }));
    notify('ok', `Pinned ${name} v${version}.`);
  };

  const unpin = () => {
    edit((d) => {
      const apply = (t: WorkflowStep | undefined) => {
        if (!t) return;
        const c = { ...(t.config ?? {}) } as Record<string, unknown>;
        delete c.skill;
        t.config = c;
      };
      if (bodyOf) {
        const loop = (d.steps ?? []).find((s) => s.step_id === bodyOf);
        apply((loop?.config as Record<string, unknown> | undefined)?.body as unknown as WorkflowStep[] | undefined ? ((loop?.config as Record<string, unknown>).body as WorkflowStep[]).find((s) => s.step_id === step.step_id) : undefined);
      } else {
        apply((d.steps ?? []).find((s) => s.step_id === step.step_id));
      }
    });
  };

  const doDraft = async () => {
    const nl = (cfg.calculation_nl ?? '').trim();
    if (!nl) {
      notify('error', 'Write the natural-language calculation first.');
      return;
    }
    if (params.length === 0) {
      notify('error', 'Add at least one parameter first (its name becomes the skill param).');
      return;
    }
    const sample: Record<string, unknown> = {};
    for (const p of params) sample[p] = smartSample(samples[p] ?? '');
    try {
      notify('ok', 'Drafting skill with AI…');
      const res = await draft({ nl, params, sample }).unwrap();
      if (!res.ok || !res.skill) throw new Error(res.error ?? 'Draft failed.');
      dispatch(setSkillDraft({ stepId: step.step_id, outcome: { ok: true, skill: { name: res.skill.name, version: res.skill.version }, tests: res.tests, note: res.note } }));
      setCfg({ skill: { name: res.skill.name, version: res.skill.version } });
      setModeOverride(null);
      notify('ok', `Drafted ${res.skill.name} v${res.skill.version} and pinned it. ${res.note ?? ''}`);
    } catch (err) {
      const message = err && typeof err === 'object' && 'data' in err
        ? String((err as { data?: { error?: string } }).data?.error ?? 'Draft failed.')
        : err instanceof Error ? err.message : 'Draft failed.';
      dispatch(setSkillDraft({ stepId: step.step_id, outcome: { ok: false, error: message } }));
      notify('error', `Draft failed: ${message}`);
    }
  };

  const advancedOpen = (cfg.on_miss ?? 'propose') !== 'propose' || cfg.deferred === false;

  return (
    <div>
      {pinned && banked?.description && <p className="status-line">Purpose: {banked.description}</p>}

      <section aria-label="Skill mode">
        <h3>How should this step calculate?</h3>
        <div role="radiogroup" aria-label="Skill mode" className="radio-group">
          {(['saved', 'new', 'ref'] as Mode[]).map((m) => (
            <label key={m} className="radio-row">
              <input type="radio" name={`mode-${step.step_id}`} checked={mode === m} onChange={() => setModeOverride(m)} />
              {m === 'saved' ? 'Use a saved skill' : m === 'new' ? 'Describe a new calculation' : 'Resolve at run time'}
            </label>
          ))}
        </div>
        {mode === null && <p className="status-line">Choose how this step calculates.</p>}
      </section>

      {mode === 'saved' && (
        <section aria-label="Saved skill">
          <h3>Saved skill</h3>
          {cfg.calculation_nl && cfg.calculation_nl.trim() !== '' && (
            <p className="status-line status-warn">
              Natural-language text is present but ignored while a skill is pinned.
              <button type="button" className="btn" onClick={() => setCfg({ calculation_nl: '' })}>Clear the text</button>
            </p>
          )}
          <div className="field">
            <span><label htmlFor={`skill-search-${step.step_id}`}>Search verified skills</label></span>
            <input id={`skill-search-${step.step_id}`} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name…" />
          </div>
          <ul className="plain skill-list">
            {names.slice(0, 30).map((n) => {
              const versions = grouped.get(n) ?? [];
              const current = pinned?.name === n ? pinned.version : versions[0]?.version;
              return (
                <li key={n} className="skill-row">
                  <div>
                    <span className="list-title num">{n}</span>
                    <span className="status-line"> · {versions[0]?.status ?? 'unknown'} · {versions[0]?.source ?? ''}</span>
                    <div className="status-line">{versions[0]?.description ?? 'No description.'}</div>
                    <div className="status-line num">Params: {(versions[0]?.input_params ?? []).join(', ') || '(none declared)'}</div>
                  </div>
                  <select
                    aria-label={`Version of ${n}`}
                    value={current ?? ''}
                    onChange={(e) => pin(n, Number(e.target.value))}
                  >
                    {versions.map((v) => (
                      <option key={v.version} value={v.version}>v{v.version}</option>
                    ))}
                  </select>
                  {pinned?.name === n ? (
                    <span className="status-line status-ok">Pinned v{pinned.version}</span>
                  ) : (
                    <button type="button" className="btn" onClick={() => pin(n, versions[0]?.version ?? 1)}>Use</button>
                  )}
                </li>
              );
            })}
          </ul>
          {names.length === 0 && <p className="status-line">No skills match.</p>}
          {pinned && (
            <button type="button" className="btn" onClick={unpin}>
              Clear pin
            </button>
          )}
        </section>
      )}

      {mode === 'ref' && (
        <section aria-label="Run-time skill reference">
          <h3>Resolve at run time</h3>
          {pinned && (
            <p className="status-line status-warn">
              A pinned skill overrides the run-time reference.
              <button type="button" className="btn" onClick={unpin}>Unpin</button>
            </p>
          )}
          <DataRefPicker label="Skill from" value={fromRef ?? ''} options={refs} onCommit={(v) => setCfg(v.trim() === '' ? {} : { skill: { from: v.trim() } })} placeholder="find.skills[0]" />
        </section>
      )}

      <section aria-label="Parameter bindings">
        <MappingEditor step={step} holder="inputs_mapping" refs={refs} edit={edit} title="Bindings" />
      </section>
      {mode === 'new' && (
        <section aria-label="New calculation">
          <h3>Describe the calculation</h3>
          {pinned && (
            <p className="status-line status-warn">
              A pinned skill overrides this description.
              <button type="button" className="btn" onClick={unpin}>Unpin</button>
            </p>
          )}
          <TextField label="Plain-language calculation" multiline value={cfg.calculation_nl ?? ''} onCommit={(v) => setCfg({ calculation_nl: v })} />
          <h3>Parameters</h3>
          <p className="status-line">Each parameter is a number the skill receives. Bind them to run data below.</p>
          <div className="map-row">
            <input type="text" aria-label="New parameter name" placeholder="weight_lb" value={newParam} onChange={(e) => setNewParam(e.target.value)} />
            <button
              type="button"
              className="btn"
              disabled={newParam.trim() === '' || params.includes(newParam.trim())}
              onClick={() => {
                const p = newParam.trim();
                setNewParam('');
                edit((d) => {
                  const t = (d.steps ?? []).find((s) => s.step_id === step.step_id);
                  const c = (t?.config ?? {}) as { inputs_mapping?: Record<string, { from?: string }> };
                  c.inputs_mapping = c.inputs_mapping ?? {};
                  c.inputs_mapping[p] = c.inputs_mapping[p] ?? { from: '' };
                  if (t) t.config = c;
                });
              }}
            >
              Add parameter
            </button>
          </div>
          {params.length === 0 && <p className="status-line">No parameters yet.</p>}
          {params.length > 0 && (
            <>
              <h3>Example values (test the draft only)</h3>
              {params.map((p) => (
                <TextField
                  key={p}
                  label={p}
                  value={samples[p] ?? ''}
                  onCommit={(v) => dispatch(setSkillSample({ stepId: step.step_id, param: p, value: v }))}
                />
              ))}
              <button type="button" className="btn btn-primary" disabled={draftState.isLoading} onClick={() => void doDraft()}>
                {draftState.isLoading ? 'Drafting…' : 'Draft with AI'}
              </button>
            </>
          )}
        </section>
      )}



      {draftOutcome?.ok && (
        <section aria-label="Draft result">
          <h3>Last draft</h3>
          {draftOutcome.ok ? (
            <>
              <p className="status-ok">Drafted {draftOutcome.skill?.name} v{draftOutcome.skill?.version} and pinned it. {draftOutcome.note}</p>
              <TestList tests={draftOutcome.tests} sampleKeys={params} />
              {banked?.code_lang && (
                <>
                  <button type="button" className="btn" aria-expanded={showCode} onClick={() => setShowCode(!showCode)}>
                    {showCode ? 'Hide code' : 'Show code'}
                  </button>
                  {showCode && <pre className="code-preview num">{banked.code_lang}</pre>}
                </>
              )}
            </>
          ) : (
            <p className="status-bad">Draft failed and was not saved: {draftOutcome.error} Fix the description or parameters and retry — nothing was pinned.</p>
          )}
        </section>
      )}

      <details open={advancedOpen}>
        <summary>Advanced execution</summary>
        <SelectField
          label="On miss"
          value={cfg.on_miss ?? 'propose'}
          options={[{ value: 'propose', label: 'propose (pause and acquire)' }, { value: 'fail', label: 'fail' }, { value: 'ask', label: 'ask (human pre-gate)' }]}
          onChange={(v) => setCfg({ on_miss: v })}
        />
        <CheckField label="Deferred (acquire at run time)" checked={cfg.deferred === true} onChange={(v) => setCfg({ deferred: v })} />
      </details>
    </div>
  );
}

function TestList({ tests, sampleKeys }: { tests: unknown; sampleKeys: string[] }) {
  const list = Array.isArray(tests) ? tests : [];
  if (list.length === 0) return <p className="status-line">No test records returned.</p>;
  return (
    <ul className="plain">
      {list.map((t, i) => {
        const keys = t && typeof t === 'object' ? Object.keys((t as { input?: unknown }).input && typeof (t as { input: unknown }).input === 'object' ? (t as { input: Record<string, unknown> }).input : t) : [];
        const fromSample = keys.length > 0 && keys.every((k) => sampleKeys.includes(k));
        return (
          <li key={i} className="test-row">
            <span className="status-line">{fromSample ? 'From your example values' : 'Model-authored check'}</span>
            <pre className="num">{JSON.stringify(t)}</pre>
          </li>
        );
      })}
    </ul>
  );
}
