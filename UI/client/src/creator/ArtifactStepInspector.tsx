import type { TemplateKind, WorkflowDefinition, WorkflowStep } from '../api/contracts';
import { useGetTemplateVersionQuery, useGetTemplateVersionsQuery, useListTemplatesQuery } from '../api/steelApi';
import { SelectField } from './fields';
import { MappingEditor } from './stepConfigs';
import type { EditFn } from './stepConfigs';
import type { RefOption } from './preflight';

const ART_KIND: Record<string, TemplateKind | undefined> = { sheet: 'spreadsheet', slide: 'presentation' };

// Artifact step in user order: artifact type → compatible published
// template → version → bindings → program → export. Template-backed steps
// resolve definition+data from the library at run time; the interpreter
// program may come from the step or the template.
export function ArtifactStepInspector({ def, step, bodyOf, edit, refs }: {
  def: WorkflowDefinition;
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
  refs: RefOption[];
}) {
  void def;
  const cfg = (step.config ?? {}) as { kind?: string; template?: string; version?: number; mappings?: Record<string, { from?: string }>; program?: string; export?: string };
  const artKind = cfg.kind === 'slide' ? 'slide' : 'sheet';
  const wantKind = ART_KIND[artKind];
  const library = useListTemplatesQuery(wantKind ? { kind: wantKind } : undefined);
  const versions = useGetTemplateVersionsQuery(cfg.template ?? '', { skip: !cfg.template });
  const published = (versions.data?.versions ?? []).filter((v) => v.status === 'published').sort((a, b) => b.version - a.version);
  const effectiveVersion = cfg.version ?? published[0]?.version;
  const detail = useGetTemplateVersionQuery(
    { id: cfg.template ?? '', version: effectiveVersion ?? 0 },
    { skip: !cfg.template || effectiveVersion == null },
  );
  const slots = detail.data?.slots ?? [];
  const mapped = new Set(Object.keys(cfg.mappings ?? {}));
  const unmapped = slots.filter((s) => !mapped.has(s));
  const templateSpec = detail.data?.template?.spec as { program?: unknown } | undefined;
  const templateProgram = typeof templateSpec?.program === 'string' && (templateSpec.program as string) !== '';
  const stepProgram = (cfg.program ?? '').trim() !== '';

  const setCfg = (patch: Record<string, unknown>) => edit((d) => {
    const apply = (t: WorkflowStep | undefined) => {
      if (t) t.config = { ...(t.config ?? {}), ...patch };
    };
    if (bodyOf) {
      const loop = (d.steps ?? []).find((s) => s.step_id === bodyOf);
      apply(((loop?.config as Record<string, unknown> | undefined)?.body as WorkflowStep[] | undefined)?.find((s) => s.step_id === step.step_id));
    } else {
      apply((d.steps ?? []).find((s) => s.step_id === step.step_id));
    }
  });

  return (
    <div>
      <section aria-label="Artifact type">
        <h3>Artifact type</h3>
        <SelectField
          label="Type"
          value={artKind}
          options={[
            { value: 'sheet', label: 'Spreadsheet (editable workbook)' },
            { value: 'slide', label: 'Presentation (editable deck)' },
          ]}
          onChange={(v) => {
            const c = { ...(step.config ?? {}) } as Record<string, unknown>;
            c.kind = v;
            delete c.template;
            delete c.version;
            c.mappings = {};
            if (v === 'sheet' && c.export === 'pptx') delete c.export;
            if (v === 'slide' && c.export === 'xlsx') delete c.export;
            setCfg(c);
          }}
        />
      </section>

      <section aria-label="Template">
        <h3>Template</h3>
        <SelectField
          label={`${artKind === 'sheet' ? 'Spreadsheet' : 'Presentation'} template`}
          value={cfg.template ?? ''}
          options={(library.data?.templates ?? []).map((t) => ({
            value: t.template_id,
            label: `${t.name || t.template_id} (${t.published_version != null ? `published v${t.published_version}` : 'no published version'})`,
          }))}
          emptyLabel="(none)"
          onChange={(v) => {
            const c = { ...(step.config ?? {}) } as Record<string, unknown>;
            if (v === '') delete c.template;
            else c.template = v;
            delete c.version;
            c.mappings = {};
            setCfg(c);
          }}
        />
        {cfg.template && (
          <SelectField
            label="Published version"
            value={cfg.version != null ? String(cfg.version) : ''}
            options={published.map((v) => ({ value: String(v.version), label: `v${v.version}` }))}
            emptyLabel={published.length > 0 ? `(latest published — v${published[0].version})` : '(no published version)'}
            onChange={(v) => {
              const c = { ...(step.config ?? {}) } as Record<string, unknown>;
              if (v === '') delete c.version;
              else c.version = Number(v);
              setCfg(c);
            }}
          />
        )}
        {cfg.template && published.length === 0 && !versions.isLoading && (
          <p className="status-line status-warn">This template has no published version. Publish one in Templates before running.</p>
        )}
      </section>

      {cfg.template && effectiveVersion != null && (
        <section aria-label="Data bindings">
          <h3>Required bindings</h3>
          {detail.isLoading && <p className="status-line">Loading bindings…</p>}
          {detail.isError && (
            <p className="status-line">
              <span className="status-bad">Could not load bindings. </span>
              <button type="button" className="btn" onClick={() => detail.refetch()}>Retry</button>
            </p>
          )}
          {slots.length > 0 && (
            <p className="status-line num">
              {slots.map((s) => `${s}${mapped.has(s) ? '' : ' (unmapped)'}`).join(' · ')}
            </p>
          )}
          {slots.length === 0 && !detail.isLoading && !detail.isError && (
            <p className="status-line">This template declares no fillable bindings; it generates from its defaults.</p>
          )}
          {unmapped.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                const c = { ...(step.config ?? {}) } as { mappings?: Record<string, { from?: string }> };
                c.mappings = c.mappings ?? {};
                for (const s of unmapped) {
                  if (!c.mappings[s]) c.mappings[s] = { from: '' };
                }
                setCfg(c);
              }}
            >
              Add {unmapped.length} unmapped binding{unmapped.length === 1 ? '' : 's'}
            </button>
          )}
          <MappingEditor step={step} holder="mappings" refs={refs} edit={edit} title="Binding map" />
        </section>
      )}

      <section aria-label="Interpreter program">
        <h3>Interpreter program</h3>
        <p className="status-line">
          {templateProgram
            ? 'The template provides a builder program; the step program below is optional (it wins when set).'
            : 'The template provides no program, so the step program below is required.'}
          {' '}The program runs inside the interpreter and calls art_* primitives — business calculations stay in verified skills.
        </p>
        <div className="field">
          <span><label htmlFor={`artifact-program-${step.step_id}`}>program (.lang)</label></span>
          <textarea
            id={`artifact-program-${step.step_id}`}
            rows={4}
            value={cfg.program ?? ''}
            onChange={(e) => setCfg({ program: e.target.value })}
            placeholder="print art_create(); … print art_build();"
          />
        </div>
        {!stepProgram && !templateProgram && (
          <p className="status-line status-warn">Neither the step nor the template provides a program yet.</p>
        )}
      </section>

      <section aria-label="Export">
        <h3>Office export (optional)</h3>
        <SelectField
          label="Export interchange format"
          value={cfg.export ?? ''}
          options={artKind === 'sheet'
            ? [{ value: 'xlsx', label: 'XLSX workbook' }]
            : [{ value: 'pptx', label: 'PPTX deck' }]}
          emptyLabel="(none — editable artifact only)"
          onChange={(v) => {
            const c = { ...(step.config ?? {}) } as Record<string, unknown>;
            if (v === '') delete c.export;
            else c.export = v;
            setCfg(c);
          }}
        />
        <p className="status-line">
          The step always produces an editable artifact (opened in Steel Studio). The export is an interchange copy validated by the
          interpreter adapter — there is no Office import; unsupported interoperability is reported, not simulated.
        </p>
      </section>
    </div>
  );
}
