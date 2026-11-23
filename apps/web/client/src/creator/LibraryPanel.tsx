import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import type { RootState } from '../store/store';
import { useIsPresent } from 'motion/react';
import * as m from 'motion/react-m';
import { ModalDialog } from '../app/FocusTrap';
import { DeleteDialog, ItemActions } from '../app/ItemActions';
import {
  steelApi,
  useDeleteWorkflowMutation,
  useGetWorkflowDependenciesQuery,
  useListTrashedWorkflowsQuery,
  useListWorkflowsQuery,
  useRestoreWorkflowMutation,
  useValidateWorkflowMutation,
} from '../api/steelApi';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { isDirty, openDefinition } from '../store/workflowEditor';
import type { WorkflowDefinition, WorkflowLibraryRow } from '../api/contracts';
import { blankDefinition } from './adapter';
import { useNotify } from './notices';
import { WorkflowVersionCompare } from './WorkflowVersionCompare';
import { useFloatingPanel } from './useFloatingPanel';
import { serverErrorList, workflowErrorMessage } from './workflowErrors';

const versionDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function VersionSavedAt({ value }: { value?: string }) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return <time className="status-line" dateTime={value}>{versionDate.format(date)}</time>;
}

const MAX_DEFINITION_BYTES = 256 * 1024;

// Collapsible library overlay: grouped workflows with search, create,
// per-workflow actions, and a Trash view with Restore. Closed unless
// requested.
export function LibraryPanel({ onClose, initialTarget }: {
  onClose: () => void;
  initialTarget?: {id: string; version: number};
}) {
  const dispatch = useAppDispatch();
  const isPresent = useIsPresent();
  const store = useStore<RootState>();
  const openRequest = useRef(0);
  const searchField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!isPresent || document.activeElement === searchField.current) return;
    searchField.current?.focus();
  }, [isPresent]);
  const [opening, setOpening] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  useEffect(() => {
    if (!isPresent) openRequest.current++;
    return () => { openRequest.current++; };
  }, [isPresent]);

  function closeLibrary() {
    openRequest.current++;
    setOpening(null);
    onClose();
  }
  const floating = useFloatingPanel();
  const notify = useNotify();
  const openId = useAppSelector((s) => s.workflowEditor.openWorkflowId);
  const openVersion = useAppSelector((s) => s.workflowEditor.openVersion);
  const [trash, setTrash] = useState(false);
  const [latestStatus, setLatestStatus] = useState('all');
  const [sortOrder, setSortOrder] = useState('name');
  const workflows = useListWorkflowsQuery();
  const trashed = useListTrashedWorkflowsQuery(undefined, { skip: !trash });
  const { data, isLoading, isError, refetch } = trash ? trashed : workflows;
  const [librarySearch, setLibrarySearch] = useState('');
  const [trashSearch, setTrashSearch] = useState('');
  const search = trash ? trashSearch : librarySearch;
  const setSearch = trash ? setTrashSearch : setLibrarySearch;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{ id: string; name: string; fromVersion?: number; toVersion?: number } | null>(null);
  const closeComparison = useCallback(() => setComparison(null), []);
  const [confirmSwitch, setConfirmSwitch] = useState<{ action: string; proceed: () => void } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [restore, restoreState] = useRestoreWorkflowMutation();
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [readingImportFile, setReadingImportFile] = useState(false);
  const importFileRead = useRef(0);
  const [validateImport, importState] = useValidateWorkflowMutation();
  function closeImport() {
    importFileRead.current++;
    setReadingImportFile(false);
    if (importState.isLoading) {
      openRequest.current++;
      importState.reset();
    }
    setImportOpen(false);
  }
  const importDefinition = async () => {
    importFileRead.current++;
    const request = ++openRequest.current;
    const sequence = store.getState().workflowEditor.openSequence;
    const isCurrent = () => request === openRequest.current && sequence === store.getState().workflowEditor.openSequence;
    setOpening(null);
    setImportError('');
    try {
      if (new TextEncoder().encode(importText).length > MAX_DEFINITION_BYTES) {
        throw new Error('Definition must be at most 256 KB.');
      }
      const parsed: unknown = JSON.parse(importText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Paste a workflow definition object.');
      }
      const definition = {
        ...parsed,
        version: 1,
        status: 'draft',
      } as WorkflowDefinition;
      const result = await validateImport({ definition }).unwrap();
      if (!isCurrent()) return;
      if (!result.ok) {
        throw new Error(result.errors.join(' '));
      }
      guarded(`import ${definition.name || definition.workflow_id}`, () => {
        if (!isCurrent()) return;
        setImportOpen(false);
        dispatch(
          openDefinition({
            workflowId: definition.workflow_id,
            version: null,
            status: 'new',
            definition,
          }),
        );
        closeLibrary();
      });
    } catch (err) {
      if (!isCurrent()) return;
      const errors = serverErrorList(err);
      setImportError(errors.length ? errors.join(' ') :
        workflowErrorMessage(err) ?? 'Could not check the workflow. Try importing it again.');
    }
  };

  const source = data?.workflows;
  const groups = new Map<
    string,
    WorkflowLibraryRow[]
  >();
  for (const row of source ?? []) {
    const list = groups.get(row.workflow_id) ?? [];
    list.push(row);
    groups.set(row.workflow_id, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => b.version - a.version);
  }
  const q = search.trim().toLowerCase();
  const ids = [...groups.keys()]
    .filter((id) => trash || latestStatus === 'all' || groups.get(id)?.[0]?.status === latestStatus)
    .filter(
      (id) =>
        !q ||
        id.toLowerCase().includes(q) ||
        groups.get(id)?.some((row) => row.name?.toLowerCase().includes(q)),
    )
    .sort((first, second) => {
      const left = groups.get(first)?.[0];
      const right = groups.get(second)?.[0];
      if (sortOrder === 'recent' && !trash) {
        const leftTime = Date.parse(left?.created_at ?? '') || 0;
        const rightTime = Date.parse(right?.created_at ?? '') || 0;
        if (leftTime !== rightTime) return rightTime - leftTime;
      }
      return (left?.name || first).localeCompare(right?.name || second) || first.localeCompare(second);
    });

  const guarded = (action: string, proceed: () => void) => {
    if (isDirty(store.getState().workflowEditor)) {
      setConfirmSwitch({ action, proceed });
    } else {
      proceed();
    }
  };

  const create = () => {
    guarded('start a new workflow', () => {
      dispatch(
        openDefinition({
          workflowId: '',
          version: null,
          status: 'new',
          definition: blankDefinition(),
        }),
      );
      closeLibrary();
    });
  };

  async function getVersions(workflowId: string, latest: boolean, version?: number) {
    const { versions } = await dispatch(
      steelApi.endpoints.getWorkflowVersions.initiate(version === undefined ? workflowId : {id: workflowId, version}, {
        subscribe: false,
        forceRefetch: latest,
      }),
    ).unwrap();
    return [...versions].sort((a, b) => b.version - a.version);
  }

  async function exportVersion(workflowId: string, version: number | null) {
    if (exporting) return;
    const name = groups.get(workflowId)?.[0]?.name || workflowId;
    const target = version === null ? name : `${name} v${version}`;
    const noticeKey = `export:${workflowId}:${version ?? 'latest'}`;
    setExporting(target);
    try {
      const versions = await getVersions(workflowId, version === null);
      const row = version === null ? versions[0] : versions.find((item) => item.version === version);
      if (!row) {
        notify('error', `${target} is no longer available.`, noticeKey);
        return;
      }
      const blob = new Blob([JSON.stringify(row.definition, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        const fileId = workflowId.replace(/[^A-Za-z0-9._-]/g, '-');
        link.download = `${fileId}-v${row.version}.json`;
        link.click();
        notify('ok', `Download started for ${row.name || name} v${row.version}.`, noticeKey);
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      notify('error', `Could not export ${target}. Try again.`, noticeKey);
    } finally {
      setExporting(null);
    }
  }

  function load(workflowId: string, version: number | null, precise = false) {
    if (version !== null && workflowId === openId && version === openVersion) {
      closeLibrary();
      return;
    }
    const request = ++openRequest.current;
    void openWorkflow(request, workflowId, version, precise);
  }

  useEffect(() => {
    if (!initialTarget || !isPresent) return;
    const frame = window.requestAnimationFrame(() => load(initialTarget.id, initialTarget.version, true));
    return () => window.cancelAnimationFrame(frame);
  }, [initialTarget, isPresent]);

  async function openWorkflow(request: number, workflowId: string, version: number | null, precise: boolean) {
    const sequence = store.getState().workflowEditor.openSequence;
    const name = groups.get(workflowId)?.[0]?.name || workflowId;
    const requestedVersion = version === null ? name : `${name} v${version}`;
    const openingFocus = document.activeElement;
    function showUnavailable() {
      notify('error', `${requestedVersion} is no longer available.`);
      if (document.activeElement === openingFocus || document.activeElement === document.body) {
        searchField.current?.focus({ preventScroll: true });
      }
      void workflows.refetch();
    }
    setOpening(requestedVersion);
    try {
      const versions = await getVersions(workflowId, version === null, precise ? version ?? undefined : undefined);
      if (openRequest.current !== request) return;
      const row =
        version === null
          ? versions[0]
          : versions.find((item) => item.version === version);
      if (!row) {
        showUnavailable();
        return;
      }
      const current = store.getState().workflowEditor;
      if (current.openSequence !== sequence) return;
      if (current.openWorkflowId === workflowId && current.openVersion === row.version && current.openStatus === row.status) {
        closeLibrary();
        return;
      }
      guarded(`open ${row.name || name} v${row.version}`, () => {
        if (openRequest.current !== request || store.getState().workflowEditor.openSequence !== sequence) return;
        dispatch(
          openDefinition({
            workflowId,
            version: row.version,
            status: row.status,
            definition: row.definition,
          }),
        );
        closeLibrary();
      });
    } catch (error) {
      if (openRequest.current === request) {
        if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404) {
          showUnavailable();
        } else {
          notify('error', `Could not open ${name}. Try again.`);
        }
      }
    } finally {
      if (openRequest.current === request) setOpening(null);
    }
  }

  const doRestore = async (workflowId: string) => {
    if (restoreState.isLoading) return;
    const name = groups.get(workflowId)?.[0]?.name || workflowId;
    const noticeKey = `restore:${workflowId}`;
    try {
      const result = await restore({ id: workflowId }).unwrap();
      if (!result.ok) throw new Error('Restore failed');
      notify('ok', `Restored ${name}.`, noticeKey);
    } catch {
      notify('error', `Could not restore ${name}. Try again.`, noticeKey);
    }
  };

  return (
    <m.aside
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
        <h2>
          {trash ? 'Trash' : 'Workflows'}{' '}
          <span className="count-badge">{ids.length}</span>
        </h2>
        <button
          type="button"
          className="btn"
          onClick={closeLibrary}
          aria-label="Close library"
        >
          ×
        </button>
      </div>
      <div className="map-row">
        <button
          type="button"
          className={
            trash ? 'btn btn-filter' : 'btn btn-filter btn-filter-active'
          }
          aria-pressed={!trash}
          onClick={() => setTrash(false)}
        >
          Library
        </button>
        <button
          type="button"
          className={
            trash ? 'btn btn-filter btn-filter-active' : 'btn btn-filter'
          }
          aria-pressed={trash}
          onClick={() => {
            if (trash) return;
            openRequest.current++;
            setOpening(null);
            setTrash(true);
          }}
        >
          Trash
        </button>
      </div>
      <div className="field">
        <span>
          <label htmlFor="lib-search">Search</label>
        </span>
        <input
          id="lib-search"
          ref={searchField}
          type="search"
          value={search}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeLibrary();
            } else if (event.key === 'Enter' && q && ids.length === 1 && !trash && !opening) {
              event.preventDefault();
              load(ids[0], null);
            }
          }}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or ID…"
        />
      </div>
      {!trash && groups.size > 0 && (
        <div className="workflow-library-filters">
          <label>
            <span>Latest version status</span>
            <select value={latestStatus} onChange={(event) => setLatestStatus(event.target.value)}>
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
              <option value="name">Name</option>
              <option value="recent">Recently saved</option>
            </select>
          </label>
        </div>
      )}
      {!trash && (
        <button
          type="button"
          className="btn btn-primary new-workflow-button"
          onClick={create}
        >
          New workflow
        </button>
      )}
      {!trash && (
        <button
          type="button"
          className="btn"
          onClick={() => setImportOpen(true)}
        >
          Import JSON
        </button>
      )}
      {importOpen && !confirmSwitch && (
        <ModalDialog
          label="Import workflow"
          wide
          onClose={closeImport}
        >
          <h2>Import workflow JSON</h2>
          <p>
            Choose a JSON file or paste a workflow definition. Use an unused workflow ID before saving.
          </p>
          <label className="workflow-import-file">
            <span>JSON file</span>
            <input
              type="file"
              accept=".json,application/json"
              disabled={importState.isLoading}
              onChange={async (event) => {
                const control = event.currentTarget;
                const file = control.files?.[0];
                if (!file) return;
                const read = ++importFileRead.current;
                control.value = '';
                if (file.size > MAX_DEFINITION_BYTES) {
                  setReadingImportFile(false);
                  setImportError('Definition must be at most 256 KB.');
                  return;
                }
                setReadingImportFile(true);
                setImportError('');
                try {
                  const json = await file.text();
                  if (read !== importFileRead.current) return;
                  setImportText(json);
                  setImportError('');
                } catch {
                  if (read === importFileRead.current) setImportError('Could not read the file.');
                } finally {
                  if (read === importFileRead.current) setReadingImportFile(false);
                }
              }}
            />
          </label>
          <label htmlFor="workflow-import">Workflow definition</label>
          <textarea
            id="workflow-import"
            rows={12}
            style={{ width: '100%' }}
            value={importText}
            disabled={importState.isLoading}
            onChange={(e) => {
              importFileRead.current++;
              setReadingImportFile(false);
              setImportText(e.target.value);
              setImportError('');
            }}
          />
          {readingImportFile && <p role="status">Reading JSON file…</p>}
          {importError && <p role="alert">{importError}</p>}
          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={closeImport}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={importState.isLoading || readingImportFile || !importText.trim()}
              onClick={() => void importDefinition()}
            >
              {importState.isLoading ? 'Validating...' : 'Validate and import'}
            </button>
          </div>
        </ModalDialog>
      )}
      {isLoading && (
        <p className="status-line" role="status">{trash ? 'Loading Trash…' : 'Loading workflows…'}</p>
      )}
      {opening && <p className="status-line" role="status">Opening {opening}…</p>}
      {exporting && <p className="status-line" role="status">Exporting {exporting}…</p>}
      {restoreState.isLoading && <p className="status-line" role="status">Restoring…</p>}
      {isError && (
        <div className="status-line">
          <p className="status-bad" role="alert">{trash ? 'Could not load Trash.' : 'Could not load workflows.'}</p>
          <button
            type="button"
            className="btn"
            onClick={() => void refetch()}
          >
            Retry
          </button>
        </div>
      )}
      <ul className="plain workflow-library-list">
        {ids.map((id) => {
          const rows = groups.get(id) ?? [];
          const latest = rows[0];
          const published = rows.find((row) => row.status === 'published');
          return (
            <li key={id}>
              <div
                className={
                  openId === id
                    ? 'workflow-library-row list-row-selected'
                    : 'workflow-library-row'
                }
              >
                {trash ? (
                  <span className="list-title">{latest.name || id}</span>
                ) : (
                  <button
                    type="button"
                    className="link-button list-title"
                    aria-current={openId === id && openVersion === latest.version ? true : undefined}
                    onClick={() => void load(id, null)}
                    title={`Open ${id} latest`}
                  >
                    {latest.name || id}
                  </button>
                )}
                <div className="workflow-row-meta">
                  <span
                    className={`workflow-status ${latest.status === 'published' ? 'published' : 'draft'}`}
                  >
                    {latest.status}
                  </span>
                  <span>v{latest.version}</span>
                  {!trash && openId === id && openVersion !== null && openVersion !== latest.version && (
                    <span>Open at v{openVersion}</span>
                  )}
                  {!trash && <VersionSavedAt value={latest.created_at} />}
                  {published && published.version !== latest.version && (
                    <span className="workflow-status published">Published v{published.version}</span>
                  )}
                  {latest.name && latest.name !== id && (
                    <span className="workflow-row-id" title={id}>
                      {id}
                    </span>
                  )}
                </div>
                {trash ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={restoreState.isLoading}
                    onClick={() => void doRestore(id)}
                    aria-label={`Restore ${latest.name || id}`}
                  >
                    Restore
                  </button>
                ) : (
                  <ItemActions
                    label={latest.name || id}
                    actions={[
                      {
                        id: 'open',
                        label: 'Open',
                        onSelect: () => void load(id, null),
                      },
                      {
                        id: 'export',
                        label: 'Export latest JSON',
                        disabled: exporting !== null,
                        onSelect: () => void exportVersion(id, null),
                      },
                      {
                        id: 'versions',
                        label: expanded === id ? 'Hide versions' : 'Versions',
                        onSelect: () =>
                          setExpanded(expanded === id ? null : id),
                      },
                      ...(rows.length > 1 ? [{
                        id: 'compare',
                        label: 'Compare versions',
                        onSelect: () => setComparison({ id, name: latest.name || id }),
                      }] : []),
                      ...(openId === id && openVersion !== null && openVersion !== latest.version ? [{
                        id: 'compare-open',
                        label: `Compare saved v${openVersion} with latest`,
                        onSelect: () => setComparison({ id, name: latest.name || id, fromVersion: openVersion }),
                      }] : []),
                      ...(published && published.version !== latest.version ? [{
                        id: 'compare-published',
                        label: 'Compare with published',
                        onSelect: () => setComparison({ id, name: latest.name || id, fromVersion: published.version, toVersion: latest.version }),
                      }] : []),
                      {
                        id: 'delete',
                        label: 'Delete',
                        danger: true,
                        onSelect: () => setDeleting(id),
                      },
                    ]}
                  />
                )}
              </div>
              {!trash && expanded === id && (
                <ul
                  className="plain version-list"
                  aria-label={`Versions of ${latest.name || id}`}
                >
                  {rows.map((v) => (
                    <li key={v.version}>
                      <div className="version-row-info">
                        <button
                          type="button"
                          className="link-button num"
                          aria-current={openId === id && openVersion === v.version ? true : undefined}
                          onClick={() => void load(id, v.version)}
                        >
                          v{v.version} ({v.status})
                        </button>
                        {v.name && v.name !== latest.name && <span>{v.name}</span>}
                        <VersionSavedAt value={v.created_at} />
                        {openId === id && openVersion === v.version && (
                          <span className="status-line">Open in editor</span>
                        )}
                      </div>
                      <div className="version-row-actions">
                        {v.version !== latest.version && (
                          <button
                            type="button"
                            className="btn"
                            aria-label={`Compare v${v.version} with latest`}
                            onClick={(event) => {
                              event.currentTarget.focus({ preventScroll: true });
                              setComparison({ id, name: latest.name || id, fromVersion: v.version });
                            }}
                          >
                            Compare with latest
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          aria-label={`Export v${v.version} JSON`}
                          disabled={exporting !== null}
                          onClick={() => void exportVersion(id, v.version)}
                        >
                          Export JSON
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {ids.length === 0 && !isLoading && !isError && (
        <div>
          <p className="status-line">
            {groups.size > 0
              ? trash ? 'No deleted workflows match your search.' : 'No workflows match your filters.'
              : trash ? 'Trash is empty.' : 'No workflows yet.'}
          </p>
          {groups.size > 0 && (
            <button type="button" className="btn" onClick={() => {
              setSearch('');
              if (!trash) setLatestStatus('all');
              searchField.current?.focus();
            }}>{trash ? 'Clear search' : 'Clear filters'}</button>
          )}
        </div>
      )}

      {comparison && (
        <WorkflowVersionCompare
          id={comparison.id}
          name={comparison.name}
          initialFrom={comparison.fromVersion}
          initialTo={comparison.toVersion}
          onClose={closeComparison}
        />
      )}
      {deleting && (
        <WorkflowDeleteDialog
          workflowId={deleting}
          versions={(groups.get(deleting) ?? []).length}
          onClose={() => setDeleting(null)}
          onDeleted={() =>
            notify(
              'ok',
              `Moved ${deleting} to Trash. Versions and history are preserved.`,
            )
          }
        />
      )}

      {confirmSwitch && (
        <ModalDialog
          label="Unsaved changes"
          onClose={() => setConfirmSwitch(null)}
        >
          <h2>Discard unsaved changes?</h2>
          <p>
            This will {confirmSwitch.action} and discard any unsaved changes to the current draft.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setConfirmSwitch(null);
                if (!importOpen) closeLibrary();
              }}
            >
              {importOpen ? 'Back to import' : 'Keep editing'}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setConfirmSwitch(null);
                confirmSwitch.proceed();
              }}
            >
              Discard and switch
            </button>
          </div>
        </ModalDialog>
      )}
    </m.aside>
  );
}

function WorkflowDeleteDialog({
  workflowId,
  versions,
  onClose,
  onDeleted,
}: {
  workflowId: string;
  versions: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const deps = useGetWorkflowDependenciesQuery(workflowId);
  const [remove, removeState] = useDeleteWorkflowMutation();
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    const fresh = await deps.refetch().catch(() => null);
    const blocking = fresh?.data?.blocking ?? deps.data?.blocking ?? [];
    if (blocking.length > 0) {
      setError(
        'New blockers appeared since the dialog opened. Resolve them first.',
      );
      return;
    }
    try {
      await remove({ id: workflowId }).unwrap();
      onDeleted();
      onClose();
    } catch (err) {
      const data = (
        err as {
          data?: {
            error?: string;
            blocking?: Array<{ detail: string; action: string }>;
          };
        }
      ).data;
      const details = (data?.blocking ?? [])
        .map((b) => `${b.detail} ${b.action}`)
        .join(' ');
      setError(
        details
          ? `${data?.error ?? 'Delete blocked.'} ${details}`
          : (data?.error ?? 'Delete failed.'),
      );
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
