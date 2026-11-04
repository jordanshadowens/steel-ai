import { useState } from 'react';
import type { DesignerMigrationOp, DesignerPublishRefusal, DesignerPublishResult, DesignerRecord, DesignerValidateResult } from '../api/contracts';
import {
  useAddDesignerFieldMutation,
  useAddDesignerRelationshipMutation,
  useArchiveDesignerTypeMutation,
  useCreateDesignerTypeMutation,
  useDeleteDesignerRecordMutation,
  useDiffDesignerVersionsQuery,
  useDuplicateDesignerTypeMutation,
  useExportDesignerSchemaMutation,
  useGetDesignerTypeQuery,
  useGetDesignerVersionQuery,
  useImportDesignerSchemaMutation,
  useInsertDesignerRecordMutation,
  useListDesignerRecordsQuery,
  useGetDesignerWorkspaceQuery,
  useListDesignerTypesQuery,
  useListDesignerVersionsQuery,
  usePublishDesignerTypeMutation,
  useQueryDesignerRecordsMutation,
  useRenameDesignerTypeMutation,
  useReorderDesignerFieldsMutation,
  useRetireDesignerFieldMutation,
  useRetireDesignerRelationshipMutation,
  useRollbackDesignerTypeMutation,
  useUnarchiveDesignerTypeMutation,
  useUpdateDesignerFieldMutation,
  useUpdateDesignerRecordMutation,
  useUpdateDesignerRelationshipMutation,
  useValidateDesignerDraftMutation,
  useValidateDesignerImportMutation,
} from '../api/steelApi';
import { SchemaCanvas } from './SchemaCanvas';
import { TypeList } from './TypeList';
import { FieldEditor, type FieldPayload } from './FieldEditor';
import { RelationshipEditor, type RelationshipDraft } from './RelationshipEditor';
import { PublishPanel } from './PublishPanel';
import { RecordForm, RecordGrid } from './RecordViews';
import { LinksEditor } from './LinksEditor';
import { ImportExport } from './ImportExport';
import { apiMessage, isUnavailable } from './valueInputs';
import './designer.css';

type Tab = 'schema' | 'canvas' | 'records' | 'publish' | 'transfer';

async function run<T>(fn: () => Promise<T>, setError: (m: string | null) => void, onOk?: (v: T) => void): Promise<void> {
  try {
    const v = await fn();
    setError(null);
    onOk?.(v);
  } catch (e) {
    setError(apiMessage(e));
  }
}

export function DesignerPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('schema');
  const [typeError, setTypeError] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [publishRefusal, setPublishRefusal] = useState<DesignerPublishRefusal | null>(null);
  const [publishResult, setPublishResult] = useState<DesignerPublishResult | null>(null);
  const [validateResult, setValidateResult] = useState<DesignerValidateResult | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [diffArgs, setDiffArgs] = useState<{ from: number; to: number } | null>(null);
  const [searched, setSearched] = useState<DesignerRecord[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addingRecord, setAddingRecord] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DesignerRecord | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<Parameters<typeof ImportExport>[0]['importReport']>(null);
  const [importDone, setImportDone] = useState<{ created: Array<{ name: string }>; relationships: number } | null>(null);

  const typesQ = useListDesignerTypesQuery(showArchived ? { include_archived: true } : undefined);
  const types = typesQ.data?.types ?? [];
  const selected = selectedId ?? types[0]?.type_id ?? null;
  const detailQ = useGetDesignerTypeQuery(selected ?? '', { skip: !selected });
  const detail = detailQ.data?.type ?? null;
  const versionsQ = useListDesignerVersionsQuery(selected ?? '', { skip: !selected });
  const liveSpecQ = useGetDesignerVersionQuery(selected && detail && detail.version > 0 ? { id: selected, version: detail.version } : { id: '', version: 0 }, {
    skip: !selected || !detail || detail.version === 0,
  });
  const liveSpec = liveSpecQ.data?.spec ?? null;
  const diffQ = useDiffDesignerVersionsQuery(selected && diffArgs ? { id: selected, ...diffArgs } : { id: '', from: 0, to: 0 }, {
    skip: !selected || !diffArgs,
  });
  const recordsQ = useListDesignerRecordsQuery(selected ? { id: selected } : { id: '' }, { skip: !selected || (detail?.version ?? 0) === 0 });
  const workspaceQ = useGetDesignerWorkspaceQuery(showArchived ? { include_archived: true } : undefined, { skip: tab !== 'canvas' });

  const [createType, creating] = useCreateDesignerTypeMutation();
  const [renameType] = useRenameDesignerTypeMutation();
  const [duplicateType] = useDuplicateDesignerTypeMutation();
  const [archiveType] = useArchiveDesignerTypeMutation();
  const [unarchiveType] = useUnarchiveDesignerTypeMutation();
  const [addField, adding] = useAddDesignerFieldMutation();
  const [updateField] = useUpdateDesignerFieldMutation();
  const [retireField] = useRetireDesignerFieldMutation();
  const [reorderFields] = useReorderDesignerFieldsMutation();
  const [addRel] = useAddDesignerRelationshipMutation();
  const [updateRel] = useUpdateDesignerRelationshipMutation();
  const [retireRel] = useRetireDesignerRelationshipMutation();
  const [validateDraft, validating] = useValidateDesignerDraftMutation();
  const [publishType, publishing] = usePublishDesignerTypeMutation();
  const [rollbackType, rollingBack] = useRollbackDesignerTypeMutation();
  const [insertRecord, inserting] = useInsertDesignerRecordMutation();
  const [updateRecord, updating] = useUpdateDesignerRecordMutation();
  const [deleteRecord] = useDeleteDesignerRecordMutation();
  const [queryRecords] = useQueryDesignerRecordsMutation();
  const [exportSchema, exporting] = useExportDesignerSchemaMutation();
  const [validateImport] = useValidateDesignerImportMutation();
  const [importSchema, importing] = useImportDesignerSchemaMutation();

  if (typesQ.error && isUnavailable(typesQ.error)) {
    return (
      <div className="section-card" role="alert">
        <h2>Data Designer unavailable</h2>
        <p>{apiMessage(typesQ.error)} Designer schemas live in the embedded store only.</p>
      </div>
    );
  }

  const busyTypes = creating.isLoading || typesQ.isFetching;
  const busySchema = adding.isLoading;
  const busyRecords = inserting.isLoading || updating.isLoading || recordsQ.isFetching;

  const activeLiveFields = (liveSpec?.fields ?? []).filter((f) => f.status === 'active');
  const activeLiveRels = (liveSpec?.relationships ?? []).filter((r) => r.status === 'active');

  return (
    <div className="designer-page">
      <TypeList
        types={types}
        selectedId={selected}
        showArchived={showArchived}
        busy={busyTypes}
        error={typeError ?? (typesQ.error ? apiMessage(typesQ.error) : null)}
        onToggleArchived={() => setShowArchived((v) => !v)}
        onSelect={(id) => {
          setSelectedId(id);
          setPublishRefusal(null);
          setPublishResult(null);
          setValidateResult(null);
          setSearched(null);
          setEditingRecord(null);
          setAddingRecord(false);
        }}
        onCreate={(name) => run(() => createType({ name }).unwrap().then((r) => setSelectedId(r.type.type_id)), setTypeError)}
        onRename={(id, name) => run(() => renameType({ id, name }).unwrap(), setTypeError)}
        onDuplicate={(id, name) => run(() => duplicateType({ id, name }).unwrap().then((r) => setSelectedId(r.type.type_id)), setTypeError)}
        onArchive={(id, archived) => run(() => (archived ? archiveType({ id }).unwrap() : unarchiveType({ id }).unwrap()), setTypeError)}
      />

      {!selected || !detail ? (
        <div className="section-card">
          <p className="status-line">{typesQ.isLoading ? 'Loading types…' : 'Select a type to edit its schema, records, and versions.'}</p>
        </div>
      ) : (
        <>
          <nav className="designer-tabs" aria-label="Designer sections">
            {(['schema', 'canvas', 'records', 'publish', 'transfer'] as Tab[]).map((t) => (
              <button key={t} type="button" className={tab === t ? 'btn btn-filter-active btn-filter' : 'btn btn-filter'} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
                {t === 'schema' ? 'Schema' : t === 'canvas' ? 'Canvas' : t === 'records' ? 'Records' : t === 'publish' ? 'Publish' : 'Import / Export'}
              </button>
            ))}
          </nav>

          {tab === 'schema' && (
            <>
              <FieldEditor
                fields={detail.fields}
                busy={busySchema}
                error={schemaError}
                onAdd={(spec: FieldPayload) => run(() => addField({ id: selected, ...spec }).unwrap(), setSchemaError)}
                onUpdate={(field_id, patch) => run(() => updateField({ field_id, type_id: selected, ...patch }).unwrap(), setSchemaError)}
                onRetire={(field_id, retire) => run(() => retireField({ field_id, type_id: selected, retire }).unwrap(), setSchemaError)}
                onReorder={(field_ids) => run(() => reorderFields({ id: selected, field_ids }).unwrap(), setSchemaError)}
              />
              <RelationshipEditor
                relationships={detail.relationships}
                types={types}
                ownTypeId={selected}
                busy={busySchema}
                error={schemaError}
                onAdd={(spec: RelationshipDraft) => run(() => addRel({ workspace: 'default', src_type: selected, ...spec, reverse_name: spec.reverse_name.trim() || null }).unwrap(), setSchemaError)}
                onUpdate={(rel_id, patch) => run(() => updateRel({ rel_id, ...patch }).unwrap(), setSchemaError)}
                onRetire={(rel_id) => run(() => retireRel({ rel_id }).unwrap(), setSchemaError)}
              />
            </>
          )}

          {tab === 'canvas' &&
            (workspaceQ.isLoading ? (
              <div className="section-card">
                <p className="status-line">Loading schema…</p>
              </div>
            ) : workspaceQ.error ? (
              <div className="section-card" role="alert">
                <p className="field-error">{apiMessage(workspaceQ.error)}</p>
              </div>
            ) : (
              <>
                {schemaError && (
                  <p className="field-error" role="alert">
                    {schemaError}
                  </p>
                )}
                <SchemaCanvas
                  workspace="default"
                  types={workspaceQ.data?.types ?? []}
                  selectedId={selected}
                  busy={adding.isLoading}
                  onSelect={(id) => setSelectedId(id)}
                  onAddRelationship={(spec) => run(() => addRel({ workspace: 'default', ...spec }).unwrap(), setSchemaError)}
                  onRetireRelationship={(rel_id) => run(() => retireRel({ rel_id }).unwrap(), setSchemaError)}
                />
              </>
            ))}

          {tab === 'records' &&
            (detail.version === 0 || !liveSpec ? (
              <div className="section-card">
                <p className="status-line">Publish this type before entering records — records validate against the live published version.</p>
              </div>
            ) : (
              <>
                <div className="toolbar">
                  <button type="button" className="btn btn-primary" disabled={busyRecords} onClick={() => { setAddingRecord(true); setEditingRecord(null); }}>
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
                    onSubmit={(values) => run(() => insertRecord({ id: selected, values }).unwrap().then(() => setAddingRecord(false)), setRecordError)}
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
                      onSubmit={(values) => run(() => updateRecord({ record_id: editingRecord.record_id, values }).unwrap().then(() => setEditingRecord(null)), setRecordError)}
                    />
                    <LinksEditor recordId={editingRecord.record_id} relationships={activeLiveRels} types={types} />
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
                  onDelete={(record_id, purge) => run(() => deleteRecord({ record_id, purge }).unwrap(), setRecordError)}
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

          {tab === 'publish' && (
            <PublishPanel
              detail={detail}
              versions={versionsQ.data?.versions ?? []}
              validateResult={validateResult}
              validating={validating.isLoading}
              validateError={validateError}
              publishing={publishing.isLoading}
              publishResult={publishResult}
              publishRefusal={publishRefusal}
              rollingBack={rollingBack.isLoading}
              diffOps={(diffQ.data?.ops as DesignerMigrationOp[] | undefined) ?? null}
              diffLoading={diffQ.isFetching}
              onValidate={() =>
                validateDraft({ id: selected })
                  .unwrap()
                  .then((r) => {
                    setValidateResult(r);
                    setValidateError(null);
                  })
                  .catch((e: unknown) => {
                    setValidateError(apiMessage(e));
                    setValidateResult(null);
                  })
              }
              onPublish={(opts) => {
                setPublishRefusal(null);
                setPublishResult(null);
                publishType({ id: selected, ...opts })
                  .unwrap()
                  .then((r) => setPublishResult(r))
                  .catch((e: unknown) => {
                    const data = (e as { data?: unknown }).data as { report?: unknown; error?: string } | undefined;
                    setPublishRefusal({ error: apiMessage(e), report: (data?.report as DesignerPublishRefusal['report']) ?? null });
                  });
              }}
              onRollback={(to_version) => run(() => rollbackType({ id: selected, to_version }).unwrap(), setValidateError)}
              onDiff={(from, to) => setDiffArgs({ from, to })}
            />
          )}

          {tab === 'transfer' && (
            <ImportExport
              busy={importing.isLoading}
              exporting={exporting.isLoading}
              exportText={exportText}
              importReport={importReport}
              importDone={importDone}
              error={transferError}
              onExport={(typesText) => {
                const names = typesText.split(',').map((s) => s.trim()).filter(Boolean);
                exportSchema(names.length > 0 ? { types: names } : undefined)
                  .unwrap()
                  .then((doc) => {
                    setExportText(JSON.stringify(doc, null, 2));
                    setTransferError(null);
                  })
                  .catch((e: unknown) => setTransferError(apiMessage(e)));
              }}
              onValidateImport={(docText, prefix) => {
                let doc: unknown;
                try {
                  doc = JSON.parse(docText);
                } catch {
                  setTransferError('Schema text is not valid JSON');
                  return;
                }
                validateImport({ doc, ...(prefix.trim() ? { prefix: prefix.trim() } : {}) })
                  .unwrap()
                  .then((r) => {
                    setImportReport(r);
                    setTransferError(null);
                  })
                  .catch((e: unknown) => setTransferError(apiMessage(e)));
              }}
              onImport={(docText, prefix) => {
                let doc: unknown;
                try {
                  doc = JSON.parse(docText);
                } catch {
                  setTransferError('Schema text is not valid JSON');
                  return;
                }
                setImportDone(null);
                importSchema({ doc, ...(prefix.trim() ? { prefix: prefix.trim() } : {}) })
                  .unwrap()
                  .then((r) => {
                    setImportDone(r);
                    setImportReport(null);
                    setTransferError(null);
                  })
                  .catch((e: unknown) => setTransferError(apiMessage(e)));
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
