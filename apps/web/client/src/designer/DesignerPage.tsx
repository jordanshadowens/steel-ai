import { useState } from 'react';
import { routeHref, routeSearch } from '../app/router';
import { useConnectionStatus } from '../cloud/connectionStatus';
import type {
  DesignerPublishResult,
  DesignerRecord,
} from '../api/contracts';
import {
  useAddDesignerFieldMutation,
  useArchiveDesignerTypeMutation,
  useCreateDesignerTypeMutation,
  useDeleteDesignerRecordMutation,
  useDuplicateDesignerTypeMutation,
  useGetDesignerTypeQuery,
  useGetDesignerVersionQuery,
  useInsertDesignerRecordMutation,
  useListDesignerRecordsQuery,
  useListDesignerTypesQuery,
  usePublishDesignerTypeMutation,
  useQueryDesignerRecordsMutation,
  useRenameDesignerTypeMutation,
  useReorderDesignerFieldsMutation,
  useRetireDesignerFieldMutation,
  useUnarchiveDesignerTypeMutation,
  useUpdateDesignerFieldMutation,
  useUpdateDesignerRecordMutation,
  useValidateDesignerDraftMutation,
} from '../api/steelApi';
import { TypeList } from './TypeList';
import { FieldEditor, type FieldPayload } from './FieldEditor';
import { RecordForm, RecordGrid } from './RecordViews';
import { apiMessage } from './valueInputs';
import './designer.css';

const SECTIONS = { schema: 'Fields', records: 'Records' } as const;
type Tab = keyof typeof SECTIONS;

async function run<T>(
  fn: () => Promise<T>,
  setError: (m: string | null) => void,
  onOk?: (v: T) => void,
): Promise<void> {
  try {
    const v = await fn();
    setError(null);
    onOk?.(v);
  } catch (e) {
    setError(apiMessage(e));
  }
}

export function DesignerPage() {
  const cloud = import.meta.env.VITE_STEEL_CLOUD === '1';
  const {status: connections, error: connectionError} = useConnectionStatus(cloud);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => routeSearch().get('model'));
  const [tab, setTab] = useState<Tab>('schema');
  const [typeError, setTypeError] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [publishResult, setPublishResult] =
    useState<DesignerPublishResult | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [searched, setSearched] = useState<DesignerRecord[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addingRecord, setAddingRecord] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DesignerRecord | null>(
    null,
  );
  const typesQ = useListDesignerTypesQuery(
    showArchived ? { include_archived: true } : undefined,
  );
  const types = typesQ.data?.types ?? [];
  const postgresModels = typesQ.data?.backend === 'pydantic-postgresql';
  const modelEditorAvailable = postgresModels || (cloud && typesQ.isSuccess);
  const selected = modelEditorAvailable ? (selectedId ?? types[0]?.type_id ?? null) : null;
  const detailQ = useGetDesignerTypeQuery(selected ?? '', { skip: !selected });
  const detail = detailQ.data?.type ?? null;
  const liveSpecQ = useGetDesignerVersionQuery(
    selected && detail && detail.version > 0
      ? { id: selected, version: detail.version }
      : { id: '', version: 0 },
    {
      skip: !selected || !detail || detail.version === 0,
    },
  );
  const liveSpec = liveSpecQ.data?.spec ?? null;
  const recordsQ = useListDesignerRecordsQuery(
    selected ? { id: selected } : { id: '' },
    { skip: !selected || (detail?.version ?? 0) === 0 },
  );
  const [createType, creating] = useCreateDesignerTypeMutation();
  const [renameType] = useRenameDesignerTypeMutation();
  const [duplicateType] = useDuplicateDesignerTypeMutation();
  const [archiveType] = useArchiveDesignerTypeMutation();
  const [unarchiveType] = useUnarchiveDesignerTypeMutation();
  const [addField, adding] = useAddDesignerFieldMutation();
  const [updateField] = useUpdateDesignerFieldMutation();
  const [retireField] = useRetireDesignerFieldMutation();
  const [reorderFields] = useReorderDesignerFieldsMutation();
  const [validateDraft, validating] = useValidateDesignerDraftMutation();
  const [publishType, publishing] = usePublishDesignerTypeMutation();
  const [insertRecord, inserting] = useInsertDesignerRecordMutation();
  const [updateRecord, updating] = useUpdateDesignerRecordMutation();
  const [deleteRecord] = useDeleteDesignerRecordMutation();
  const [queryRecords] = useQueryDesignerRecordsMutation();
  if (!modelEditorAvailable) {
    return (
      <section className="section-card">
        <h1>Data models</h1>
        {typesQ.isLoading ? (
          <p role="status">Connecting to Data Designer…</p>
        ) : typesQ.error ? (
          <p className="field-error" role="alert">{apiMessage(typesQ.error)}</p>
        ) : cloud ? (
          <p>The workspace database is unavailable. <a href={routeHref('settings', new URLSearchParams({section: 'database'}))}>Open database settings</a></p>
        ) : (
          <p>
            Set <code>DATABASE_URL</code> in the Workflow Creator <code>.env</code>{' '}
            file and restart the server to open the model editor.
          </p>
        )}
      </section>
    );
  }

  const busyTypes = creating.isLoading || typesQ.isFetching;
  const busySchema = adding.isLoading;
  const busyRecords =
    inserting.isLoading || updating.isLoading || recordsQ.isFetching;

  const activeLiveFields = (liveSpec?.fields ?? []).filter(
    (f) => f.status === 'active',
  );

  function openModel(id: string) {
    setSelectedId(id);
    setTab('schema');
    setPublishResult(null);
    setValidateError(null);
    setSearched(null);
    setEditingRecord(null);
    setAddingRecord(false);
  }

  return (
    <div className="designer-page model-workspace">
      <header className="model-workspace-heading">
        <h1>Data models</h1>
        <p>Define the fields and validation rules for records in {postgresModels ? 'PostgreSQL' : 'your workspace SQLite database'}.</p>
        {cloud && <p>
          {connectionError ? 'Unable to check the PostgreSQL connection. ' :
            connections && !connections.database ? 'No PostgreSQL connection configured. SQLite is ready to use. ' : ''}
          <a href={routeHref('settings', new URLSearchParams({section: 'database'}))}>Open database settings</a>
        </p>}
      </header>
      <TypeList
        types={types}
        selectedId={selected}
        showArchived={showArchived}
        busy={busyTypes}
        error={typeError ?? (typesQ.error ? apiMessage(typesQ.error) : null)}
        onToggleArchived={() => setShowArchived((v) => !v)}
        onSelect={openModel}
        onCreate={(name) =>
          run(
            () =>
              createType({ name })
                .unwrap()
                .then((r) => openModel(r.type.type_id)),
            setTypeError,
          )
        }
        onRename={(id, name) =>
          run(() => renameType({ id, name }).unwrap(), setTypeError)
        }
        onDuplicate={(id, name) =>
          run(
            () =>
              duplicateType({ id, name })
                .unwrap()
                .then((r) => openModel(r.type.type_id)),
            setTypeError,
          )
        }
        onArchive={(id, archived) =>
          run(
            () =>
              archived
                ? archiveType({ id }).unwrap()
                : unarchiveType({ id }).unwrap(),
            setTypeError,
          )
        }
      />

      <div className="designer-content">
        {!selected || !detail ? (
          <div className="section-card model-empty">
            <h2>{selected ? 'Opening model' : 'Create your first model'}</h2>
            <p className="status-line">
              {selected
                ? detailQ.error ? apiMessage(detailQ.error) : 'Loading model…'
                : 'Use the model library to add a model, then define the fields each record should contain.'}
            </p>
          </div>
        ) : (
          <>
            <section className="section-card model-editor-heading">
              <div className="model-editor-title">
                <div>
                  <h2>{detail.name}</h2>
                  <p className="status-line">
                    {detail.version ? `Published version ${detail.version}` : 'Unpublished model'}
                    {detail.validated?.current && detail.validated.ok ? ' · Draft validated' : ''}
                  </p>
                </div>
                <div className="model-editor-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={validating.isLoading || publishing.isLoading}
                    onClick={() => {
                      setPublishResult(null);
                      void run(() => validateDraft({ id: selected }).unwrap(), setValidateError);
                    }}
                  >
                    {validating.isLoading ? 'Validating…' : 'Validate draft'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={publishing.isLoading || validating.isLoading}
                    onClick={() => {
                      setPublishResult(null);
                      void run(
                        () => publishType({ id: selected }).unwrap().then(setPublishResult),
                        setValidateError,
                      );
                    }}
                  >
                    {publishing.isLoading ? 'Publishing…' : 'Publish model'}
                  </button>
                </div>
              </div>
              {validateError && <p className="field-error" role="alert">{validateError}</p>}
              {publishResult && <p role="status">Version {publishResult.version} is ready for records.</p>}
            </section>
            <nav className="designer-tabs" aria-label="Designer sections">
              {(Object.keys(SECTIONS) as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={
                    tab === t
                      ? 'btn btn-filter-active btn-filter'
                      : 'btn btn-filter'
                  }
                  aria-current={tab === t ? 'page' : undefined}
                  onClick={() => setTab(t)}
                >
                  {SECTIONS[t]}
                </button>
              ))}
            </nav>

            {tab === 'schema' && (
              <>
                <FieldEditor
                  fields={detail.fields}
                  busy={busySchema}
                  error={schemaError}
                  onAdd={(spec: FieldPayload) =>
                    run(
                      () => addField({ id: selected, ...spec }).unwrap(),
                      setSchemaError,
                    )
                  }
                  onUpdate={(field_id, patch) =>
                    run(
                      () =>
                        updateField({
                          field_id,
                          type_id: selected,
                          ...patch,
                        }).unwrap(),
                      setSchemaError,
                    )
                  }
                  onRetire={(field_id, retire) =>
                    run(
                      () =>
                        retireField({
                          field_id,
                          type_id: selected,
                          retire,
                        }).unwrap(),
                      setSchemaError,
                    )
                  }
                  onReorder={(field_ids) =>
                    run(
                      () => reorderFields({ id: selected, field_ids }).unwrap(),
                      setSchemaError,
                    )
                  }
                />
              </>
            )}

            {tab === 'schema' && detail.json_schema && (
              <details className="section-card">
                <summary>View Pydantic JSON Schema</summary>
                <h3>Draft schema</h3>
                <pre>{JSON.stringify(detail.json_schema, null, 2)}</pre>
                {liveSpec?.json_schema && (
                  <>
                    <h3>Published schema (v{liveSpec.version})</h3>
                    <pre>{JSON.stringify(liveSpec.json_schema, null, 2)}</pre>
                  </>
                )}
              </details>
            )}

            {tab === 'records' &&
              (detail.version === 0 || !liveSpec ? (
                <div className="section-card">
                  <p className="status-line">
                    Publish this type before entering records — records validate
                    against the live published version.
                  </p>
                </div>
              ) : (
                <>
                  <div className="toolbar">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busyRecords}
                      onClick={() => {
                        setAddingRecord(true);
                        setEditingRecord(null);
                      }}
                    >
                      Add record
                    </button>
                  </div>
                  {addingRecord && (
                    <RecordForm
                      fields={activeLiveFields}
                      submitLabel="Save record"
                      busy={inserting.isLoading}
                      error={recordError}
                      onCancel={() => setAddingRecord(false)}
                      onSubmit={(values) =>
                        run(
                          () =>
                            insertRecord({ id: selected, values })
                              .unwrap()
                              .then(() => setAddingRecord(false)),
                          setRecordError,
                        )
                      }
                    />
                  )}
                  {editingRecord && (
                    <>
                      <RecordForm
                        fields={activeLiveFields}
                        initial={editingRecord.values}
                        submitLabel="Save changes"
                        busy={updating.isLoading}
                        error={recordError}
                        onCancel={() => setEditingRecord(null)}
                        onSubmit={(values) =>
                          run(
                            () =>
                              updateRecord({
                                record_id: editingRecord.record_id,
                                values,
                              })
                                .unwrap()
                                .then(() => setEditingRecord(null)),
                            setRecordError,
                          )
                        }
                      />
                    </>
                  )}
                  <RecordGrid
                    records={searched ?? recordsQ.data?.records ?? []}
                    fields={activeLiveFields}
                    busy={busyRecords}
                    error={recordError}
                    searching={searching}
                    onEdit={(r) => {
                      setEditingRecord(r);
                      setAddingRecord(false);
                    }}
                    onDelete={(record_id, purge) =>
                      run(
                        () => deleteRecord({ record_id, purge }).unwrap(),
                        setRecordError,
                      )
                    }
                    onSearch={(filters) => {
                      setSearching(true);
                      queryRecords({ id: selected, filters })
                        .unwrap()
                        .then((r) => {
                          setSearched(r.records);
                          setRecordError(null);
                        })
                        .catch((e: unknown) => setRecordError(apiMessage(e)))
                        .finally(() => setSearching(false));
                    }}
                    onClearSearch={() => setSearched(null)}
                  />
                </>
              ))}

          </>
        )}
      </div>
    </div>
  );
}
