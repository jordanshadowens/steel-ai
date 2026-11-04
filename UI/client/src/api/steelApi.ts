import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type {
  ApprovalRow,
  DependenciesResult,
  DocumentRow,
  ReviseResult,
  RunRow,
  SkillRow,
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
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['Workflow', 'WorkflowVersion', 'Run', 'Approval', 'Skill', 'Template', 'TemplateVersion', 'Document'],
  endpoints: (build) => ({
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
      invalidatesTags: ['Approval', 'Workflow'],
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
      invalidatesTags: ['Approval', 'Run', 'Document', 'Workflow', 'Template'],
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
      invalidatesTags: ['Approval', 'Template'],
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
  }),
});

export const {
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
} = steelApi;
