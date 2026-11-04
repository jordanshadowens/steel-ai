// Typed mirrors of the existing server contracts (UI/src/server/server.ts).
// The backend stays authoritative; these types must track it, never extend it.

export interface ApiErrorBody {
  error: string;
}

export interface WorkflowInput {
  name: string;
  type: string;
  required?: boolean;
  [key: string]: unknown;
}

export interface WorkflowStep {
  step_id: string;
  type: string;
  name?: string;
  config?: Record<string, unknown>;
  on_success?: string;
  on_failure?: string;
  [key: string]: unknown;
}

export interface WorkflowUiState {
  positions?: Record<string, { x: number; y: number }>;
  view?: { x: number; y: number; w: number; h: number };
  input_presentation?: unknown;
}

export interface WorkflowDefinition {
  workflow_id: string;
  version?: number;
  status?: string;
  name?: string;
  policy?: Record<string, unknown>;
  inputs?: WorkflowInput[];
  steps?: WorkflowStep[];
  limits?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  ui?: WorkflowUiState;
  [key: string]: unknown;
}

export interface WorkflowLibraryRow {
  workflow_id: string;
  version: number;
  status: string;
  name?: string;
  created_at?: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  [key: string]: unknown;
}

export type TemplateKind = 'document' | 'spreadsheet' | 'presentation';

export interface DependencyItem {
  kind: string;
  detail: string;
  action: string;
}

export interface DependenciesResult {
  blocking: DependencyItem[];
  informational: DependencyItem[];
}

export interface WorkflowVersionRow extends WorkflowLibraryRow {
  definition: WorkflowDefinition;
}

export interface RunRow {
  run_id: string;
  workflow_id: string;
  version: number;
  status: string;
  current_step?: string | null;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ApprovalRow {
  approval_id: number;
  scope: string;
  status: string;
  run_id?: string | null;
  workflow_id?: string | null;
  version?: number | null;
  step_id?: string | null;
  prompt?: string | null;
  metadata?: Record<string, unknown>;
  comment?: string | null;
  decided_by?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export interface SkillRow {
  skill_id?: number;
  name: string;
  version: number;
  description?: string;
  code_lang?: string;
  input_params?: string[];
  tests?: unknown;
  status?: string;
  source?: string;
  [key: string]: unknown;
}

export interface TemplateRow {
  template_id: string;
  name?: string;
  artifact_kind?: TemplateKind;
  latest_version?: number;
  latest_status?: string;
  published_version?: number | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  [key: string]: unknown;
}

export interface TemplateVersionRow {
  template_id: string;
  version: number;
  status: string;
  spec?: DocSpec;
  artifact_kind?: TemplateKind;
  created_at?: string;
  [key: string]: unknown;
}

export interface SheetTemplateSpec {
  schema: 'steel-template/1';
  kind: 'spreadsheet';
  title?: string;
  definition?: Record<string, unknown>;
  data?: { texts?: string[]; cells?: Array<Record<string, unknown>> };
  bindings?: string[];
  program?: string;
  [key: string]: unknown;
}

export interface SlideTemplateSpec {
  schema: 'steel-template/1';
  kind: 'presentation';
  title?: string;
  definition?: Record<string, unknown>;
  data?: { texts?: string[]; slides?: Array<Record<string, unknown>> };
  bindings?: string[];
  program?: string;
  [key: string]: unknown;
}

export type AnyTemplateSpec = DocSpec | SheetTemplateSpec | SlideTemplateSpec;

export interface ReviseResult {
  ok: boolean;
  proposal?: unknown;
  errors: string[];
  kind: TemplateKind;
  slots?: string[];
  summary?: string[];
  base_hash?: string | null;
  template_id?: string | null;
}

export interface DocSegment {
  text?: string;
  bind?: string;
  page?: string;
  format?: Record<string, unknown>;
  style?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DocSection {
  kind?: string;
  type?: string;
  title?: string;
  segments?: DocSegment[];
  rows?: unknown;
  columns?: Array<Record<string, unknown>>;
  items?: unknown;
  [key: string]: unknown;
}

export interface DocSpec {
  schema: string;
  title?: string;
  styles?: Record<string, unknown>;
  sections?: DocSection[];
  [key: string]: unknown;
}

export interface DocumentRow {
  doc_id: string;
  run_id?: string | null;
  template_id?: string | null;
  template_version?: number | null;
  status: string;
  pdf_sha256?: string | null;
  pdf_bytes?: number | null;
  error?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
}

export interface TemplateValidateResult extends ValidateResult {
  slots?: string[];
}

export type StepType =
  | 'input_collection'
  | 'model_reasoning'
  | 'database_retrieval'
  | 'skill_retrieval'
  | 'skill_execution'
  | 'conditional_routing'
  | 'iteration'
  | 'human_approval'
  | 'output_composition'
  | 'document_generation'
  | 'artifact_generation';
