import type { WorkflowDefinition, WorkflowStep } from '../api/contracts';
import { useGetTemplateVersionQuery, useGetTemplateVersionsQuery, useListTemplatesQuery } from '../api/steelApi';
import { SelectField } from './fields';
import { MappingEditor } from './stepConfigs';
import type { EditFn } from './stepConfigs';
import type { RefOption } from './preflight';

// Document step in user order: template → published version → required
// slots → preview/release information.
export function DocStepInspector({ def, step, bodyOf, edit, refs }: {
  def: WorkflowDefinition;
  step: WorkflowStep;
  bodyOf: string | null;
  edit: EditFn;
  refs: RefOption[];
}) {
  void def;
  const cfg = (step.config ?? {}) as { template?: string; version?: number; mappings?: Record<string, { from?: string }> };
  const library = useListTemplatesQuery({ kind: 'document' });
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

  return (
    <div>
      <section aria-label="Template">
        <h3>Template</h3>
        <SelectField
          label="Template"
          value={cfg.template ?? ''}
          options={(library.data?.templates ?? []).map((t) => ({
            value: t.template_id,
            label: `${t.name || t.template_id} (${t.published_version != null ? `published v${t.published_version}` : 'no published version'})`,
          }))}
          emptyLabel="(none)"
          onChange={(v) => {
            edit((d) => {
              const apply = (t: WorkflowStep | undefined) => {
                if (!t) return;
                const c = { ...(t.config ?? {}) } as Record<string, unknown>;
                if (v === '') delete c.template;
                else c.template = v;
                delete c.version;
                t.config = c;
              };
              if (bodyOf) {
                const loop = (d.steps ?? []).find((s) => s.step_id === bodyOf);
                apply(((loop?.config as Record<string, unknown> | undefined)?.body as WorkflowStep[] | undefined)?.find((s) => s.step_id === step.step_id));
              } else {
                apply((d.steps ?? []).find((s) => s.step_id === step.step_id));
              }
            });
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
        <section aria-label="Data slots">
          <h3>Required data slots</h3>
          {detail.isLoading && <p className="status-line">Loading slots…</p>}
          {detail.isError && (
            <p className="status-line">
              <span className="status-bad">Could not load slots. </span>
              <button type="button" className="btn" onClick={() => detail.refetch()}>Retry</button>
            </p>
          )}
          {slots.length > 0 && (
            <p className="status-line num">
              {slots.map((s) => `${s}${mapped.has(s) ? '' : ' (unmapped)'}`).join(' · ')}
            </p>
          )}
          {unmapped.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => edit((d) => {
                const t = (d.steps ?? []).find((s) => s.step_id === step.step_id);
                const c = (t?.config ?? {}) as { mappings?: Record<string, { from?: string }> };
                c.mappings = c.mappings ?? {};
                for (const s of unmapped) {
                  if (!c.mappings[s]) c.mappings[s] = { from: '' };
                }
                if (t) t.config = c;
              })}
            >
              Add {unmapped.length} unmapped slot{unmapped.length === 1 ? '' : 's'}
            </button>
          )}
          <MappingEditor step={step} holder="mappings" refs={refs} edit={edit} title="Slot bindings" />
        </section>
      )}

      <section aria-label="Release">
        <h3>Preview and release</h3>
        <p className="status-line">
          The step renders a draft and files a document approval on the exact bytes. Release is always manual in the Runner:
          preview the draft, approve the artifact, then download. Customer download stays blocked until release.
        </p>
      </section>
    </div>
  );
}
