import { useState } from 'react';
import { motion } from 'motion/react';
import { ModalDialog } from '../app/FocusTrap';
import { DeleteDialog, ItemActions } from '../app/ItemActions';
import {
  steelApi,
  useDeleteWorkflowMutation,
  useGetWorkflowDependenciesQuery,
  useListTrashedWorkflowsQuery,
  useListWorkflowsQuery,
  useRestoreWorkflowMutation,
} from '../api/steelApi';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { isDirty, openDefinition } from '../store/workflowEditor';
import { blankDefinition } from './adapter';
import { useNotify } from './notices';
import { useFloatingPanel } from './useFloatingPanel';

// Collapsible library overlay: grouped workflows with search, create,
// per-workflow actions, and a Trash view with Restore. Closed unless
// requested.
export function LibraryPanel({ onClose }: { onClose: () => void }) {
  const dispatch = useAppDispatch();
  const floating = useFloatingPanel();
  const notify = useNotify();
  const openId = useAppSelector((s) => s.workflowEditor.openWorkflowId);
  const dirty = isDirty(useAppSelector((s) => s.workflowEditor));
  const [trash, setTrash] = useState(false);
  const { data, isLoading, isError, refetch } = useListWorkflowsQuery();
  const trashed = useListTrashedWorkflowsQuery(undefined, { skip: !trash });
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState<(() => void) | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [restore, restoreState] = useRestoreWorkflowMutation();

  const source = trash ? trashed.data?.workflows : data?.workflows;
  const groups = new Map<string, Array<{ version: number; status: string; name?: string }>>();
  for (const row of source ?? []) {
    const list = groups.get(row.workflow_id) ?? [];
    list.push({ version: row.version, status: row.status });
    groups.set(row.workflow_id, list);
  }
  for (const list of groups.values()) list.sort((a, b) => b.version - a.version);
  const q = search.trim().toLowerCase();
  const ids = [...groups.keys()].filter((id) => !q || id.toLowerCase().includes(q) || groups.get(id)?.[0]?.name?.toLowerCase().includes(q)).sort();

  const guarded = (fn: () => void) => {
    if (dirty) setConfirmSwitch(() => fn);
    else fn();
  };

  const create = () => {
    guarded(() => {
      dispatch(openDefinition({ workflowId: '', version: null, status: 'new', definition: blankDefinition() }));
      onClose();
    });
  };

  const load = async (workflowId: string, version: number | null) => {
    guarded(() => {
      void (async () => {
        try {
          const res = await dispatch(steelApi.endpoints.getWorkflowVersions.initiate(workflowId));
          const versions = res.data?.versions ?? [];
          const row = version === null ? versions[0] : versions.find((v) => v.version === version);
          if (!row) {
            notify('error', `Version not found for ${workflowId}.`);
            return;
          }
          dispatch(openDefinition({ workflowId, version: row.version, status: row.status, definition: row.definition }));
          onClose();
        } catch {
          notify('error', `Load failed for ${workflowId}.`);
        }
      })();
    });
  };

  const doRestore = async (workflowId: string) => {
    try {
      await restore({ id: workflowId }).unwrap();
      notify('ok', `Restored ${workflowId} with its version history.`);
    } catch {
      notify('error', `Restore failed for ${workflowId}.`);
    }
  };

  return (
    <motion.aside
      ref={floating.ref}
      style={floating.style}
      className="overlay-panel overlay-left workflow-library"
      role="complementary"
      aria-label="Workflow library"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <div className="drawer-head panel-drag-handle" {...floating.handle}>
        <h2>{trash ? 'Trash' : 'Workflows'} <span className="count-badge">{groups.size}</span></h2>
        <button type="button" className="btn" onClick={onClose} aria-label="Close library">
          ×
        </button>
      </div>
      <div className="map-row">
        <button type="button" className={trash ? 'btn btn-filter' : 'btn btn-filter btn-filter-active'} aria-pressed={!trash} onClick={() => setTrash(false)}>
          Library
        </button>
        <button type="button" className={trash ? 'btn btn-filter btn-filter-active' : 'btn btn-filter'} aria-pressed={trash} onClick={() => setTrash(true)}>
          Trash
        </button>
      </div>
      <div className="field">
        <span><label htmlFor="lib-search">Search</label></span>
        <input id="lib-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or ID…" />
      </div>
      {!trash && (
        <button type="button" className="btn btn-primary new-workflow-button" onClick={create}>
          New workflow
        </button>
      )}
      {(trash ? trashed.isLoading : isLoading) && <p className="status-line">Loading…</p>}
      {restoreState.isLoading && <p className="status-line">Restoring…</p>}
      {(trash ? trashed.isError : isError) && (
        <p className="status-line">
          <span className="status-bad">Load failed. </span>
          <button type="button" className="btn" onClick={() => (trash ? trashed.refetch() : refetch())}>Retry</button>
        </p>
      )}
      <ul className="plain workflow-library-list">
        {ids.map((id) => {
          const rows = groups.get(id) ?? [];
          const latest = rows[0];
          return (
            <li key={id}>
              <div className={openId === id ? 'workflow-library-row list-row-selected' : 'workflow-library-row'}>
                <button type="button" className="link-button list-title" onClick={() => void load(id, null)} title={`Open ${id} latest`}>
                  {latest.name || id}
                </button>
                <div className="workflow-row-meta"><span className={`workflow-status ${latest.status === 'published' ? 'published' : 'draft'}`}>{latest.status}</span><span>v{latest.version}</span>{latest.name && latest.name !== id && <span className="workflow-row-id" title={id}>{id}</span>}</div>
                {trash ? (
                  <button type="button" className="btn" onClick={() => void doRestore(id)} aria-label={`Restore ${latest.name || id}`}>
                    Restore
                  </button>
                ) : (
                  <ItemActions
                    label={latest.name || id}
                    actions={[
                      { id: 'open', label: 'Open', onSelect: () => void load(id, null) },
                      { id: 'versions', label: expanded === id ? 'Hide versions' : 'Versions', onSelect: () => setExpanded(expanded === id ? null : id) },
                      { id: 'delete', label: 'Delete', danger: true, onSelect: () => setDeleting(id) },
                    ]}
                  />
                )}
              </div>
              {expanded === id && (
                <ul className="plain version-list" aria-label={`Versions of ${latest.name || id}`}>
                  {rows.map((v) => (
                    <li key={v.version}>
                      <button type="button" className="link-button num" onClick={() => void load(id, v.version)}>
                        v{v.version} ({v.status})
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {ids.length === 0 && !isLoading && !isError && <p className="status-line">{trash ? 'Trash is empty.' : q ? 'No matching workflows. Try another search.' : 'Create your first workflow to get started.'}</p>}

      {deleting && (
        <WorkflowDeleteDialog
          workflowId={deleting}
          versions={(groups.get(deleting) ?? []).length}
          onClose={() => setDeleting(null)}
          onDeleted={() => notify('ok', `Moved ${deleting} to Trash. Versions and history are preserved.`)}
        />
      )}

      {confirmSwitch && (
        <ModalDialog label="Unsaved changes" onClose={() => setConfirmSwitch(null)}>
            <h2>Discard unsaved changes?</h2>
            <p>The open workflow has unsaved edits. Switching now loses them; saving first keeps them as a new draft version.</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setConfirmSwitch(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const fn = confirmSwitch;
                  setConfirmSwitch(null);
                  fn();
                }}
              >
                Discard and switch
              </button>
            </div>
        </ModalDialog>
      )}
    </motion.aside>
  );
}

function WorkflowDeleteDialog({ workflowId, versions, onClose, onDeleted }: { workflowId: string; versions: number; onClose: () => void; onDeleted: () => void }) {
  const deps = useGetWorkflowDependenciesQuery(workflowId);
  const [remove, removeState] = useDeleteWorkflowMutation();
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    const fresh = await deps.refetch().catch(() => null);
    const blocking = (fresh?.data?.blocking ?? deps.data?.blocking ?? []);
    if (blocking.length > 0) {
      setError('New blockers appeared since the dialog opened. Resolve them first.');
      return;
    }
    try {
      await remove({ id: workflowId }).unwrap();
      onDeleted();
      onClose();
    } catch (err) {
      const data = (err as { data?: { error?: string; blocking?: Array<{ detail: string; action: string }> } }).data;
      const details = (data?.blocking ?? []).map((b) => `${b.detail} ${b.action}`).join(' ');
      setError(details ? `${data?.error ?? 'Delete blocked.'} ${details}` : (data?.error ?? 'Delete failed.'));
    }
  };

  return (
    <DeleteDialog
      noun="Workflow"
      id={workflowId}
      versions={versions}
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
