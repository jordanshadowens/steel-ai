import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { authenticatedFetch, getSession, sessionIsCurrent } from '../auth/session';
import type {
  ApprovalRow,
  DependenciesResult,
  DocumentRow,
  ReviseResult,
  RunRow,
  SkillRow,
  DesignerField,
  DesignerImportReport,
  DesignerLink,
  DesignerMigrationOp,
  DesignerPublishResult,
  DesignerRecord,
  DesignerRelationship,
  DesignerSpec,
  DesignerTypeDetail,
  DesignerTypeRow,
  DesignerWorkspace,
  SmqlQueryResult,
  DesignerValidateResult,
  DesignerVersionRow,
  TemplateKind,
  TemplateRow,
  TemplateValidateResult,
  TemplateVersionRow,
  ValidateResult,
  WorkflowDefinition,
  WorkflowLibraryRow,
  WorkflowVersionRow,
} from './contracts';

// All server communication goes through this API slice. Same origin in
// production; the Vite dev server proxies /api to the node:http backend.
export const steelApi = createApi({
  reducerPath: 'steelApi',
  baseQuery: async (args, api, extraOptions) => {
    const epoch = getSession().epoch;
    const result = await fetchBaseQuery({ baseUrl: new URL('/api', window.location.origin).toString(), fetchFn: authenticatedFetch })(args, api, extraOptions);
    if (!sessionIsCurrent(epoch)) return { error: { status: 'CUSTOM_ERROR', error: 'The previous workspace response was discarded after a session change.' } };
    // Transport meta contains a Request with its Authorization header.
    // Never dispatch that credential-bearing object into Redux.
    return result.error ? { error: result.error } : { data: result.data };
  },
  tagTypes: ['Workflow', 'WorkflowVersion', 'Run', 'Approval', 'Skill', 'Template', 'TemplateVersion', 'Document', 'DesignerType', 'DesignerRecord'],
  endpoints: (build) => ({
    draftLanguage: build.mutation<{ program: string; status: string; validated: boolean }, { instruction: string; inputs: string[]; replacements: unknown[] }>({
      query: (body) => ({ url: '/language/draft', method: 'POST', body }),
    }),
    health: build.query<{ ok: boolean }, void>({
      query: () => '/health',
    }),
    listWorkflows: build.query<{ workflows: WorkflowLibraryRow[] }, string | void>({
      query: (status) => (status ? `/workflows?status=${encodeURIComponent(status)}` : '/workflows'),
      providesTags: ['Workflow'],
    }),
    listTrashedWorkflows: build.query<{ workflows: WorkflowLibraryRow[] }, void>({
      query: () => '/workflows?trash=1',
      providesTags: ['Workflow'],
    }),
    getWorkflowVersions: build.query<{ versions: WorkflowVersionRow[] }, string>({
      query: (id) => `/workflows/${encodeURIComponent(id)}`,
      providesTags: (_r, _e, id) => [{ type: 'WorkflowVersion', id }],
    }),
    getWorkflowDependencies: build.query<{ workflow_id: string; deleted: boolean } & DependenciesResult, string>({
      query: (id) => `/workflows/${encodeURIComponent(id)}/dependencies`,
    }),
    deleteWorkflow: build.mutation<{ ok: boolean; already_deleted?: boolean; workflow_id: string } & Partial<DependenciesResult>, { id: string; actor?: string }>({
      query: ({ id, ...body }) => ({ url: `/workflows/${encodeURIComponent(id)}`, method: 'DELETE', body }),
      invalidatesTags: (_r, _e, { id }) => ['Workflow', { type: 'WorkflowVersion', id }],
    }),
    restoreWorkflow: build.mutation<{ ok: boolean; workflow_id: string }, { id: string; actor?: string }>({
      query: ({ id, ...body }) => ({ url: `/workflows/${encodeURIComponent(id)}/restore`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Workflow', { type: 'WorkflowVersion', id }],
    }),
    validateWorkflow: build.mutation<ValidateResult, { definition: WorkflowDefinition }>({
      query: (body) => ({ url: '/workflows/validate', method: 'POST', body }),
    }),
    previewWorkflow: build.mutation<
      { ok: boolean; errors: string[]; plan?: { entry?: string; order?: Array<{ step_id: string; type: string }>; gates?: Array<{ step_id: string; prompt?: string }>; skills?: Array<{ step_id: string; skill?: string; from?: string }> } },
      { definition: WorkflowDefinition }
    >({
      query: (body) => ({ url: '/workflows/preview', method: 'POST', body }),
    }),
    saveWorkflow: build.mutation<{ ok: boolean; row: WorkflowVersionRow }, { definition: WorkflowDefinition; created_by?: string }>({
      query: (body) => ({ url: '/workflows', method: 'POST', body }),
      invalidatesTags: ['Workflow'],
    }),
    saveWorkflowVersion: build.mutation<{ ok: boolean; row: WorkflowVersionRow }, { id: string; definition: WorkflowDefinition; created_by?: string }>({
      query: ({ id, ...body }) => ({ url: `/workflows/${encodeURIComponent(id)}/versions`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Workflow', { type: 'WorkflowVersion', id }],
    }),
    publishWorkflow: build.mutation<{ approval_id: number; status: string }, { id: string; version: number }>({
      query: ({ id, ...body }) => ({ url: `/workflows/${encodeURIComponent(id)}/publish`, method: 'POST', body }),
      invalidatesTags: ['Approval', 'Workflow', 'WorkflowVersion'],
    }),
    listRuns: build.query<{ runs: RunRow[] }, { workflow_id?: string; status?: string } | void>({
      query: (args) => {
        const q = new URLSearchParams();
        if (args?.workflow_id) q.set('workflow_id', args.workflow_id);
        if (args?.status) q.set('status', args.status);
        const s = q.toString();
        return s ? `/runs?${s}` : '/runs';
      },
      providesTags: ['Run'],
    }),
    getRun: build.query<{ run: RunRow }, string>({
      query: (runId) => `/runs/${encodeURIComponent(runId)}`,
      providesTags: (_r, _e, runId) => [{ type: 'Run', id: runId }],
    }),
    createRun: build.mutation<
      { run_id: string; status: string; outputs?: Record<string, unknown>; error?: string; approval_id?: number },
      { workflow_id: string; version?: number; inputs?: Record<string, unknown> }
    >({
      query: (body) => ({ url: '/runs', method: 'POST', body }),
      invalidatesTags: ['Run', 'Approval'],
    }),
    listApprovals: build.query<{ approvals: ApprovalRow[] }, { pending?: boolean; scope?: string; run_id?: string } | void>({
      query: (args) => {
        const q = new URLSearchParams();
        if (args?.pending) q.set('pending', '1');
        if (args?.scope) q.set('scope', args.scope);
        if (args?.run_id) q.set('run_id', args.run_id);
        const s = q.toString();
        return s ? `/approvals?${s}` : '/approvals';
      },
      providesTags: ['Approval'],
    }),
    decideApproval: build.mutation<{ approval: ApprovalRow; [key: string]: unknown }, { id: number; decision: string; decided_by?: string; comment?: string }>({
      query: ({ id, ...body }) => ({ url: `/approvals/${id}/decide`, method: 'POST', body }),
      invalidatesTags: ['Approval', 'Run', 'Document', 'Workflow', 'WorkflowVersion', 'Template', 'TemplateVersion'],
    }),
    listSkills: build.query<{ skills: SkillRow[] }, string | void>({
      query: (origin) => (origin ? `/skills?origin=${encodeURIComponent(origin)}` : '/skills'),
      providesTags: ['Skill'],
    }),
    draftSkill: build.mutation<{ ok: boolean; skill?: { name: string; version: number; [key: string]: unknown }; tests?: unknown; note?: string; error?: string }, { nl: string; params: string[]; sample: unknown }>({
      query: (body) => ({ url: '/skills/draft', method: 'POST', body }),
      invalidatesTags: ['Skill'],
    }),
    listTemplates: build.query<{ templates: TemplateRow[] }, { kind?: TemplateKind; trash?: boolean } | void>({
      query: (args) => {
        const q = new URLSearchParams();
        if (args?.kind) q.set('kind', args.kind);
        if (args?.trash) q.set('trash', '1');
        const s = q.toString();
        return s ? `/templates?${s}` : '/templates';
      },
      providesTags: ['Template'],
    }),
    getTemplateVersions: build.query<{ versions: TemplateVersionRow[]; kind?: TemplateKind; deleted?: boolean }, string>({
      query: (id) => `/templates/${encodeURIComponent(id)}`,
      providesTags: (_r, _e, id) => [{ type: 'TemplateVersion', id }],
    }),
    getTemplateDependencies: build.query<{ template_id: string; deleted: boolean } & DependenciesResult, string>({
      query: (id) => `/templates/${encodeURIComponent(id)}/dependencies`,
    }),
    deleteTemplate: build.mutation<{ ok: boolean; already_deleted?: boolean; template_id: string } & Partial<DependenciesResult>, { id: string; actor?: string }>({
      query: ({ id, ...body }) => ({ url: `/templates/${encodeURIComponent(id)}`, method: 'DELETE', body }),
      invalidatesTags: (_r, _e, { id }) => ['Template', { type: 'TemplateVersion', id }],
    }),
    restoreTemplate: build.mutation<{ ok: boolean; template_id: string }, { id: string; actor?: string }>({
      query: ({ id, ...body }) => ({ url: `/templates/${encodeURIComponent(id)}/restore`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Template', { type: 'TemplateVersion', id }],
    }),
    validateTemplate: build.mutation<TemplateValidateResult & { kind?: TemplateKind }, { spec: unknown; kind?: TemplateKind }>({
      query: (body) => ({ url: '/templates/validate', method: 'POST', body }),
    }),
    draftTemplate: build.mutation<{ ok: boolean; draft?: unknown; errors: string[]; slots?: string[]; kind?: TemplateKind }, { description: string; settings?: object; kind?: TemplateKind }>({
      query: (body) => ({ url: '/templates/draft', method: 'POST', body }),
    }),
    reviseTemplate: build.mutation<ReviseResult, { kind: TemplateKind; spec: unknown; change: string; base_hash?: string; template_id?: string }>({
      query: (body) => ({ url: '/templates/revise', method: 'POST', body }),
    }),
    getTemplateVersion: build.query<{ template: TemplateVersionRow; slots: string[]; kind?: TemplateKind }, { id: string; version: number }>({
      query: ({ id, version }) => `/templates/${encodeURIComponent(id)}?version=${version}`,
      providesTags: (_r, _e, { id, version }) => [{ type: 'TemplateVersion', id: `${id}@${version}` }],
    }),
    createTemplate: build.mutation<{ ok: boolean; template: TemplateVersionRow }, { template_id: string; name?: string; spec: unknown; kind?: TemplateKind }>({
      query: (body) => ({ url: '/templates', method: 'POST', body }),
      invalidatesTags: ['Template'],
    }),
    createTemplateVersion: build.mutation<{ ok: boolean; template: TemplateVersionRow }, { id: string; spec: unknown; created_by?: string }>({
      query: ({ id, ...body }) => ({ url: `/templates/${encodeURIComponent(id)}/versions`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Template', { type: 'TemplateVersion', id }],
    }),
    publishTemplate: build.mutation<{ approval_id: number; status: string }, { id: string; version: number }>({
      query: ({ id, ...body }) => ({ url: `/templates/${encodeURIComponent(id)}/publish`, method: 'POST', body }),
      invalidatesTags: ['Approval', 'Template', 'TemplateVersion'],
    }),
    listDocuments: build.query<{ documents: DocumentRow[] }, { run_id?: string; status?: string } | void>({
      query: (args) => {
        const q = new URLSearchParams();
        if (args?.run_id) q.set('run_id', args.run_id);
        if (args?.status) q.set('status', args.status);
        const s = q.toString();
        return s ? `/documents?${s}` : '/documents';
      },
      providesTags: ['Document'],
    }),
    listDesignerTypes: build.query<{ types: DesignerTypeRow[] }, { include_archived?: boolean } | void>({
      query: (args) => (args?.include_archived ? '/designer/types?include_archived=1' : '/designer/types'),
      providesTags: ['DesignerType'],
    }),
    getDesignerType: build.query<{ type: DesignerTypeDetail }, string>({
      query: (id) => `/designer/types/${encodeURIComponent(id)}`,
      providesTags: (_r, _e, id) => [{ type: 'DesignerType', id }],
    }),
    getDesignerWorkspace: build.query<DesignerWorkspace, { include_archived?: boolean } | void>({
      query: (args) => (args?.include_archived ? '/designer/workspace?include_archived=1' : '/designer/workspace'),
      providesTags: ['DesignerType'],
    }),
    createDesignerType: build.mutation<{ ok: boolean; type: DesignerTypeRow }, { name: string }>({
      query: (body) => ({ url: '/designer/types', method: 'POST', body }),
      invalidatesTags: ['DesignerType'],
    }),
    renameDesignerType: build.mutation<{ ok: boolean; type: DesignerTypeRow }, { id: string; name: string }>({
      query: ({ id, ...body }) => ({ url: `/designer/types/${encodeURIComponent(id)}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['DesignerType', { type: 'DesignerType', id }],
    }),
    duplicateDesignerType: build.mutation<{ ok: boolean; type: DesignerTypeRow }, { id: string; name: string }>({
      query: ({ id, ...body }) => ({ url: `/designer/types/${encodeURIComponent(id)}/duplicate`, method: 'POST', body }),
      invalidatesTags: ['DesignerType'],
    }),
    archiveDesignerType: build.mutation<{ ok: boolean; type: DesignerTypeRow }, { id: string }>({
      query: ({ id }) => ({ url: `/designer/types/${encodeURIComponent(id)}/archive`, method: 'POST', body: {} }),
      invalidatesTags: (_r, _e, { id }) => ['DesignerType', { type: 'DesignerType', id }],
    }),
    unarchiveDesignerType: build.mutation<{ ok: boolean; type: DesignerTypeRow }, { id: string }>({
      query: ({ id }) => ({ url: `/designer/types/${encodeURIComponent(id)}/unarchive`, method: 'POST', body: {} }),
      invalidatesTags: (_r, _e, { id }) => ['DesignerType', { type: 'DesignerType', id }],
    }),
    addDesignerField: build.mutation<{ ok: boolean; field: DesignerField }, { id: string } & Record<string, unknown>>({
      query: ({ id, ...body }) => ({ url: `/designer/types/${encodeURIComponent(id)}/fields`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'DesignerType', id }],
    }),
    updateDesignerField: build.mutation<{ ok: boolean; field: DesignerField }, { field_id: string; type_id: string } & Record<string, unknown>>({
      query: ({ field_id, type_id: _typeId, ...body }) => ({ url: `/designer/fields/${encodeURIComponent(field_id)}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { type_id }) => [{ type: 'DesignerType', id: type_id }],
    }),
    retireDesignerField: build.mutation<{ ok: boolean; field: DesignerField }, { field_id: string; type_id: string; retire: boolean }>({
      query: ({ field_id, retire }) => ({ url: `/designer/fields/${encodeURIComponent(field_id)}/${retire ? 'retire' : 'unretire'}`, method: 'POST', body: {} }),
      invalidatesTags: (_r, _e, { type_id }) => [{ type: 'DesignerType', id: type_id }],
    }),
    reorderDesignerFields: build.mutation<{ ok: boolean; fields: DesignerField[] }, { id: string; field_ids: string[] }>({
      query: ({ id, ...body }) => ({ url: `/designer/types/${encodeURIComponent(id)}/reorder`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'DesignerType', id }],
    }),
    addDesignerRelationship: build.mutation<{ ok: boolean; relationship: DesignerRelationship }, Record<string, unknown>>({
      query: (body) => ({ url: '/designer/relationships', method: 'POST', body }),
      invalidatesTags: ['DesignerType'],
    }),
    updateDesignerRelationship: build.mutation<{ ok: boolean; relationship: DesignerRelationship }, { rel_id: string } & Record<string, unknown>>({
      query: ({ rel_id, ...body }) => ({ url: `/designer/relationships/${encodeURIComponent(rel_id)}`, method: 'PATCH', body }),
      invalidatesTags: ['DesignerType'],
    }),
    retireDesignerRelationship: build.mutation<{ ok: boolean; relationship: DesignerRelationship }, { rel_id: string }>({
      query: ({ rel_id }) => ({ url: `/designer/relationships/${encodeURIComponent(rel_id)}/retire`, method: 'POST', body: {} }),
      invalidatesTags: ['DesignerType'],
    }),
    validateDesignerDraft: build.mutation<DesignerValidateResult, { id: string }>({
      query: ({ id }) => ({ url: `/designer/types/${encodeURIComponent(id)}/validate`, method: 'POST', body: {} }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'DesignerType', id }],
    }),
    publishDesignerType: build.mutation<DesignerPublishResult, { id: string; backfill?: Record<string, unknown>; acknowledgeDestructive?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/designer/types/${encodeURIComponent(id)}/publish`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['DesignerType', { type: 'DesignerType', id }, 'DesignerRecord'],
    }),
    rollbackDesignerType: build.mutation<{ ok: boolean; version: number }, { id: string; to_version: number }>({
      query: ({ id, ...body }) => ({ url: `/designer/types/${encodeURIComponent(id)}/rollback`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['DesignerType', { type: 'DesignerType', id }, 'DesignerRecord'],
    }),
    listDesignerVersions: build.query<{ versions: DesignerVersionRow[] }, string>({
      query: (id) => `/designer/types/${encodeURIComponent(id)}/versions`,
      providesTags: (_r, _e, id) => [{ type: 'DesignerType', id }],
    }),
    getDesignerVersion: build.query<{ spec: DesignerSpec }, { id: string; version: number }>({
      query: ({ id, version }) => `/designer/types/${encodeURIComponent(id)}/versions/${version}`,
    }),
    diffDesignerVersions: build.query<{ ops: DesignerMigrationOp[] }, { id: string; from: number; to: number }>({
      query: ({ id, from, to }) => `/designer/types/${encodeURIComponent(id)}/diff?from=${from}&to=${to}`,
    }),
    listDesignerRecords: build.query<{ records: DesignerRecord[] }, { id: string; lifecycle?: string; limit?: number }>({
      query: ({ id, lifecycle, limit }) => {
        const q = new URLSearchParams();
        if (lifecycle) q.set('lifecycle', lifecycle);
        if (limit) q.set('limit', String(limit));
        const s = q.toString();
        return `/designer/types/${encodeURIComponent(id)}/records${s ? `?${s}` : ''}`;
      },
      providesTags: ['DesignerRecord'],
    }),
    queryDesignerRecords: build.mutation<{ records: DesignerRecord[] }, { id: string; filters?: Record<string, unknown>; lifecycle?: string; limit?: number }>({
      query: ({ id, ...body }) => ({ url: `/designer/types/${encodeURIComponent(id)}/records/query`, method: 'POST', body }),
    }),
    insertDesignerRecord: build.mutation<{ ok: boolean; record: DesignerRecord }, { id: string; values: Record<string, unknown> }>({
      query: ({ id, ...body }) => ({ url: `/designer/types/${encodeURIComponent(id)}/records`, method: 'POST', body }),
      invalidatesTags: ['DesignerRecord'],
    }),
    getDesignerRecord: build.query<{ record: DesignerRecord }, { record_id: string; links?: string }>({
      query: ({ record_id, links }) => `/designer/records/${encodeURIComponent(record_id)}${links ? `?links=${links}` : ''}`,
      providesTags: (_r, _e, { record_id }) => [{ type: 'DesignerRecord', id: record_id }],
    }),
    updateDesignerRecord: build.mutation<{ ok: boolean; record: DesignerRecord }, { record_id: string; values: Record<string, unknown> }>({
      query: ({ record_id, ...body }) => ({ url: `/designer/records/${encodeURIComponent(record_id)}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { record_id }) => ['DesignerRecord', { type: 'DesignerRecord', id: record_id }],
    }),
    deleteDesignerRecord: build.mutation<{ ok: boolean; deleted: string[] }, { record_id: string; purge?: boolean }>({
      query: ({ record_id, purge }) => ({ url: `/designer/records/${encodeURIComponent(record_id)}${purge ? '?purge=1' : ''}`, method: 'DELETE' }),
      invalidatesTags: ['DesignerRecord'],
    }),
    addDesignerLink: build.mutation<{ ok: boolean; link: DesignerLink }, { rel_id: string; src_record: string; dst_record: string }>({
      query: (body) => ({ url: '/designer/links', method: 'POST', body }),
      invalidatesTags: ['DesignerRecord'],
    }),
    removeDesignerLink: build.mutation<{ ok: boolean; link: DesignerLink }, { link_id: string }>({
      query: ({ link_id }) => ({ url: `/designer/links/${encodeURIComponent(link_id)}`, method: 'DELETE' }),
      invalidatesTags: ['DesignerRecord'],
    }),
    listDesignerLinks: build.query<{ links: DesignerLink[] }, { rel_id?: string; src_record?: string; dst_record?: string }>({
      query: (args) => {
        const q = new URLSearchParams();
        if (args.rel_id) q.set('rel_id', args.rel_id);
        if (args.src_record) q.set('src_record', args.src_record);
        if (args.dst_record) q.set('dst_record', args.dst_record);
        const s = q.toString();
        return `/designer/links${s ? `?${s}` : ''}`;
      },
      providesTags: ['DesignerRecord'],
    }),
    exportDesignerSchema: build.mutation<Record<string, unknown>, { types?: string[] } | void>({
      query: (args) => ({ url: `/designer/export${args?.types?.length ? `?types=${args.types.map(encodeURIComponent).join(',')}` : ''}`, method: 'GET' }),
    }),
    validateDesignerImport: build.mutation<DesignerImportReport, { doc: unknown; prefix?: string }>({
      query: (body) => ({ url: '/designer/import/validate', method: 'POST', body }),
    }),
    importDesignerSchema: build.mutation<{ ok: boolean; created: Array<{ name: string; type_id: string }>; relationships: number }, { doc: unknown; prefix?: string }>({
      query: (body) => ({ url: '/designer/import', method: 'POST', body }),
      invalidatesTags: ['DesignerType'],
    }),
    smqlQuery: build.mutation<SmqlQueryResult, { smql: string }>({
      query: (body) => ({ url: '/smql/query', method: 'POST', body }),
    }),
  }),
});

export const {
  useDraftLanguageMutation,
  useHealthQuery,
  useListWorkflowsQuery,
  useListTrashedWorkflowsQuery,
  useGetWorkflowVersionsQuery,
  useGetWorkflowDependenciesQuery,
  useDeleteWorkflowMutation,
  useRestoreWorkflowMutation,
  useValidateWorkflowMutation,
  usePreviewWorkflowMutation,
  useSaveWorkflowMutation,
  useSaveWorkflowVersionMutation,
  usePublishWorkflowMutation,
  useListRunsQuery,
  useGetRunQuery,
  useCreateRunMutation,
  useListApprovalsQuery,
  useDecideApprovalMutation,
  useListSkillsQuery,
  useDraftSkillMutation,
  useListTemplatesQuery,
  useGetTemplateVersionsQuery,
  useGetTemplateDependenciesQuery,
  useDeleteTemplateMutation,
  useRestoreTemplateMutation,
  useValidateTemplateMutation,
  useGetTemplateVersionQuery,
  useDraftTemplateMutation,
  useReviseTemplateMutation,
  useCreateTemplateMutation,
  useCreateTemplateVersionMutation,
  usePublishTemplateMutation,
  useListDocumentsQuery,
  useListDesignerTypesQuery,
  useGetDesignerTypeQuery,
  useGetDesignerWorkspaceQuery,
  useCreateDesignerTypeMutation,
  useRenameDesignerTypeMutation,
  useDuplicateDesignerTypeMutation,
  useArchiveDesignerTypeMutation,
  useUnarchiveDesignerTypeMutation,
  useAddDesignerFieldMutation,
  useUpdateDesignerFieldMutation,
  useRetireDesignerFieldMutation,
  useReorderDesignerFieldsMutation,
  useAddDesignerRelationshipMutation,
  useUpdateDesignerRelationshipMutation,
  useRetireDesignerRelationshipMutation,
  useValidateDesignerDraftMutation,
  usePublishDesignerTypeMutation,
  useRollbackDesignerTypeMutation,
  useListDesignerVersionsQuery,
  useGetDesignerVersionQuery,
  useDiffDesignerVersionsQuery,
  useListDesignerRecordsQuery,
  useQueryDesignerRecordsMutation,
  useInsertDesignerRecordMutation,
  useGetDesignerRecordQuery,
  useUpdateDesignerRecordMutation,
  useDeleteDesignerRecordMutation,
  useAddDesignerLinkMutation,
  useRemoveDesignerLinkMutation,
  useListDesignerLinksQuery,
  useExportDesignerSchemaMutation,
  useValidateDesignerImportMutation,
  useImportDesignerSchemaMutation,
  useSmqlQueryMutation,
} = steelApi;
