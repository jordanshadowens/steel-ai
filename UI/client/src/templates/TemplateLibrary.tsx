import { useState } from 'react';
import type { TemplateKind } from '../api/contracts';
import {
  steelApi,
  useDeleteTemplateMutation,
  useGetTemplateDependenciesQuery,
  useGetTemplateVersionsQuery,
  useListTemplatesQuery,
  useRestoreTemplateMutation,
} from '../api/steelApi';
import { DeleteDialog, ItemActions } from '../app/ItemActions';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { isSpecDirty, openSpec } from '../store/templateEditor';

const KIND_FILTERS: Array<{ value: TemplateKind | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'document', label: 'Documents' },
  { value: 'spreadsheet', label: 'Spreadsheets' },
  { value: 'presentation', label: 'Presentations' },
];

export function kindBadge(kind: TemplateKind | undefined): string {
  if (kind === 'spreadsheet') return 'XLS';
  if (kind === 'presentation') return 'PPT';
  return 'DOC';
}

export function kindName(kind: TemplateKind | undefined): string {
  if (kind === 'spreadsheet') return 'Spreadsheet';
  if (kind === 'presentation') return 'Presentation';
  return 'Document';
}

// Searchable unified library: one list for documents, spreadsheets, and
// presentations with kind filters, status badges, per-item actions, and a
// Trash view with Restore. Published versions are immutable; opening any
// version starts a new draft on edit.
export function TemplateLibrary({ onDirtySwitch }: { onDirtySwitch: (fn: () => void) => void }) {
  const dispatch = useAppDispatch();
  const openId = useAppSelector((s) => s.templateEditor.openTemplateId);
  const dirty = isSpecDirty(useAppSelector((s) => s.templateEditor));
  const [kindFilter, setKindFilter] = useState<TemplateKind | 'all'>('all');
  const [trash, setTrash] = useState(false);
  const library = useListTemplatesQuery(trash ? { trash: true } : kindFilter === 'all' ? undefined : { kind: kindFilter });
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [restore, restoreState] = useRestoreTemplateMutation();
  const [actionError, setActionError] = useState<string | null>(null);
  const q = search.trim().toLowerCase();
  const rows = (library.data?.templates ?? []).filter(
    (t) => !q || t.template_id.toLowerCase().includes(q) || (t.name ?? '').toLowerCase().includes(q),
  );

  const load = (templateId: string, version: number) => {
    const fn = () => {
      void (async () => {
        const row = (library.data?.templates ?? []).find((t) => t.template_id === templateId);
        const res = await dispatch(steelApi.endpoints.getTemplateVersion.initiate({ id: templateId, version }));
        const tpl = res.data?.template;
        if (!tpl?.spec) return;
        dispatch(openSpec({ templateId, version: tpl.version, spec: tpl.spec, kind: res.data?.kind ?? row?.artifact_kind ?? 'document' }));
      })();
    };
    if (dirty) onDirtySwitch(fn);
    else fn();
  };

  const doRestore = async (templateId: string) => {
    setActionError(null);
    try {
      await restore({ id: templateId }).unwrap();
    } catch (err) {
      setActionError(`Restore failed: ${messageOf(err)}`);
    }
  };

  return (
    <div>
      <div className="template-library-filters" role="group" aria-label="Filter by artifact type">
        {KIND_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={kindFilter === f.value && !trash ? 'btn btn-filter btn-filter-active' : 'btn btn-filter'}
            aria-pressed={kindFilter === f.value && !trash}
            onClick={() => {
              setKindFilter(f.value);
              setTrash(false);
            }}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          className={trash ? 'btn btn-filter btn-filter-active' : 'btn btn-filter'}
          aria-pressed={trash}
          onClick={() => setTrash(!trash)}
        >
          Trash
        </button>
      </div>
      <div className="field">
        <span><label htmlFor="tpl-search">Search templates</label></span>
        <input id="tpl-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by id or name…" />
      </div>
      {library.isLoading && <p className="status-line">Loading…</p>}
      {actionError && <p className="status-bad" role="alert">{actionError}</p>}
      {restoreState.isLoading && <p className="status-line">Restoring…</p>}
      {library.isError && (
        <p className="status-line">
          <span className="status-bad">Load failed. </span>
          <button type="button" className="btn" onClick={() => library.refetch()}>Retry</button>
        </p>
      )}
      <div className="list-card">
        {rows.map((t) => (
          <div key={t.template_id} className={openId === t.template_id ? 'list-row template-library-row list-row-selected' : 'list-row template-library-row'}>
            <span className="kind-badge" title={kindName(t.artifact_kind)} aria-label={`${kindName(t.artifact_kind)} template`}>
              {kindBadge(t.artifact_kind)}
            </span>
            <button type="button" className="link-button list-title" onClick={() => load(t.template_id, t.latest_version ?? 1)} title={`Open ${t.template_id} latest`}>
              {t.name || t.template_id}
            </button>
            <span className="list-meta num">
              {t.published_version != null ? `published v${t.published_version}` : 'unpublished'}
              {t.latest_version != null ? ` · latest v${t.latest_version}` : ''}
              {t.latest_status ? ` (${t.latest_status})` : ''}
            </span>
            {trash ? (
              <button type="button" className="btn" onClick={() => void doRestore(t.template_id)} aria-label={`Restore ${t.name || t.template_id}`}>
                Restore
              </button>
            ) : (
              <ItemActions
                label={t.name || t.template_id}
                actions={[
                  { id: 'open', label: 'Open', onSelect: () => load(t.template_id, t.latest_version ?? 1) },
                  { id: 'versions', label: expanded === t.template_id ? 'Hide versions' : 'Versions', onSelect: () => setExpanded(expanded === t.template_id ? null : t.template_id) },
                  { id: 'delete', label: 'Delete', danger: true, onSelect: () => setDeleting(t.template_id) },
                ]}
              />
            )}
          </div>
        ))}
        {rows.length === 0 && !library.isLoading && !library.isError && (
          <div className="list-row"><span className="status-line">{trash ? 'Trash is empty.' : 'No templates yet.'}</span></div>
        )}
      </div>
      {expanded && !trash && <section className="template-version-history" aria-label="Template version history"><h3>Version history</h3><p className="status-line">{rows.find((t) => t.template_id === expanded)?.name || expanded}</p><VersionList templateId={expanded} onLoad={load} /></section>}
      {deleting && (
        <TemplateDeleteDialog
          templateId={deleting}
          name={(library.data?.templates ?? []).find((t) => t.template_id === deleting)?.name}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function VersionList({ templateId, onLoad }: { templateId: string; onLoad: (id: string, version: number) => void }) {
  const versions = useGetTemplateVersionsQuery(templateId);
  if (versions.isLoading) return <p className="status-line">Loading versions…</p>;
  return (
    <ul className="plain version-list">
      {(versions.data?.versions ?? []).map((v) => (
        <li key={v.version}>
          <button type="button" className="link-button num" onClick={() => onLoad(templateId, v.version)}>
            v{v.version} ({v.status})
          </button>
        </li>
      ))}
    </ul>
  );
}

function TemplateDeleteDialog({ templateId, name, onClose }: { templateId: string; name?: string; onClose: () => void }) {
  const deps = useGetTemplateDependenciesQuery(templateId);
  const versions = useGetTemplateVersionsQuery(templateId);
  const [remove, removeState] = useDeleteTemplateMutation();
  const [error, setError] = useState<string | null>(null);
  const count = versions.data?.versions.length ?? 1;

  const confirm = async () => {
    setError(null);
    // Re-check dependencies at confirm time so a concurrent change (a new
    // reference, approval, or run) cannot slip past the preview.
    const fresh = await deps.refetch().catch(() => null);
    const blocking = (fresh?.data?.blocking ?? deps.data?.blocking ?? []);
    if (blocking.length > 0) {
      setError('New blockers appeared since the dialog opened. Resolve them first.');
      return;
    }
    try {
      await remove({ id: templateId }).unwrap();
      onClose();
    } catch (err) {
      const data = (err as { data?: { error?: string; blocking?: Array<{ detail: string; action: string }> } }).data;
      const details = (data?.blocking ?? []).map((b) => `${b.detail} ${b.action}`).join(' ');
      setError(details ? `${data?.error ?? 'Delete blocked.'} ${details}` : (data?.error ?? messageOf(err)));
    }
  };

  return (
    <DeleteDialog
      noun="Template"
      id={templateId}
      name={name}
      versions={count}
      deps={deps.data ?? null}
      depsLoading={deps.isLoading || deps.isFetching}
      depsError={deps.isError}
      deleting={removeState.isLoading}
      error={error}
      onCancel={onClose}
      onConfirm={() => void confirm()}
    />
  );
}

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  if (err instanceof Error) return err.message;
  return 'Request failed.';
}
