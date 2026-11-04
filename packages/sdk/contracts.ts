// Typed mirrors of the existing server contracts (UI/src/server/server.ts).
// The backend stays authoritative; these types must track it, never extend it.

export interface ApiErrorBody {
  error: string;
}

export interface WorkflowInput {
  name: string;
  type: string;
  required?: boolean;
  designer?: DesignerInputBinding;
  [key: string]: unknown;
}

// Workflow-input binding to designer records. mode "record" (default)
// submits a record_id; mode "value" submits one field's value.
export interface DesignerInputBinding {
  type: string;
  field?: string;
  mode?: 'record' | 'value';
  workspace?: string;
}

export interface SmqlQueryResult {
  outcome: 'ok' | 'unknown';
  reason?: string;
  rows: Array<Record<string, unknown>>;
  stats?: Record<string, unknown>;
  warnings?: string[];
  planHash?: string;
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

// Data Designer mirrors (UI/src/server/designerRoutes.ts). The backend
// stays authoritative; these types must track it, never extend it.

export type DesignerFtype = 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'timestamp' | 'enum';

export interface DesignerField {
  field_id: string;
  name: string;
  ftype: DesignerFtype;
  position: number;
  required: boolean;
  unique: boolean;
  repeated: boolean;
  default: unknown;
  validation: Record<string, unknown>;
  status: 'active' | 'retired';
}

export interface DesignerRelationship {
  rel_id: string;
  src_type: string;
  dst_type: string;
  name: string;
  reverse_name: string | null;
  cardinality: 'one' | 'many';
  delete_behavior: 'restrict' | 'cascade' | 'set_null';
  status: 'active' | 'retired';
}

export interface DesignerTypeRow {
  type_id: string;
  workspace_id: string;
  name: string;
  status: 'active' | 'archived';
  version: number;
  created_at?: string;
  updated_at?: string;
}

export interface DesignerTypeDetail extends DesignerTypeRow {
  fields: DesignerField[];
  relationships: DesignerRelationship[];
  draft_sha256: string;
  validated: { ok: boolean; draft_sha256: string; current: boolean } | null;
}

export interface DesignerValidationError {
  code: string;
  message: string;
  field?: string | null;
  field_id?: string;
  rel_id?: string;
  [key: string]: unknown;
}

export interface DesignerValidateResult {
  ok: boolean;
  errors: DesignerValidationError[];
  draft_sha256: string;
}

export interface DesignerMigrationOp {
  op: string;
  field_id?: string;
  rel_id?: string;
  name?: string;
  keys?: string[];
  [key: string]: unknown;
}

export interface DesignerPublishResult {
  ok: boolean;
  version: number;
  ops: DesignerMigrationOp[];
  destructive: Array<DesignerMigrationOp & { reason: string }>;
  records_checked: number;
  backfilled: number;
  backup_path: string | null;
  backup_note: string | null;
  spec_sha256: string;
}

export interface DesignerPublishRefusal {
  error: string;
  report: {
    errors?: DesignerValidationError[];
    violations?: Array<{ record_id: string; field: string; code: string; message: string }>;
    ops?: DesignerMigrationOp[];
    destructive?: Array<DesignerMigrationOp & { reason: string }>;
    draft_sha256?: string;
  } | null;
}

export interface DesignerVersionRow {
  version: number;
  status: 'published' | 'superseded';
  spec_sha256: string;
  created_by: string;
  created_at?: string;
  published_at?: string;
}

export interface DesignerSpec {
  type_id: string;
  workspace_id: string;
  name: string;
  version: number;
  status: string;
  spec_sha256: string;
  fields: DesignerField[];
  relationships: DesignerRelationship[];
}

export interface DesignerRecord {
  record_id: string;
  workspace_id: string;
  type_id: string;
  type_name: string;
  type_version: number;
  lifecycle: 'active' | 'deleted';
  values: Record<string, unknown>;
  field_ids: Record<string, string>;
  links?: Array<{ rel: string; rel_id: string; dst_record: string; link_id: string }>;
  [key: string]: unknown;
}

export interface DesignerLink {
  link_id: string;
  rel_id: string;
  src_record: string;
  dst_record: string;
  created_at?: string;
}

export interface DesignerWorkspace {
  workspace: string;
  types: DesignerTypeDetail[];
}

export interface DesignerImportReport {
  ok: boolean;
  errors: DesignerValidationError[];
  conflicts: Array<{ name: string; reason: string }>;
  warnings: Array<{ name: string; warning: string }>;
  creates: string[];
}
