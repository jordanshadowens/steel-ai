import type { DesignerRecord, DesignerTypeDetail, DesignerTypeRow } from '../api/contracts';

type JsonObject = Record<string, unknown>;
type SetupField = JsonObject & { name: string; ftype: string };
type SetupType = JsonObject & { name: string; fields: SetupField[] };
type Binding = JsonObject & { id: string; project_id: string; resource_key: string };

const bindingTypes = ['MetricBinding', 'SloDefinition'] as const;
type BindingType = (typeof bindingTypes)[number];
const sharedFields: ReadonlyMap<string, readonly string[]> = new Map([
  ['Resource', ['id', 'kind', 'project_id']],
  ['Telemetry', ['id', 'resource_id', 'selector']],
  ['log_event', ['timestamp', 'resource_id', 'event_name']],
]);
const observabilityTypes = new Set([
  'LogObservation', 'MetricPoint', 'TraceSpan', 'ErrorGroupObservation',
  'ErrorEvent', 'ServiceState', 'DeploymentRevision', 'ResourceObservation',
  'AlertObservation', 'AlertPolicyObservation', 'SloObservation', 'IngestionCoverage',
  'InventorySnapshot', 'IncidentReport', ...bindingTypes, ...sharedFields.keys(),
]);
const recordReadLimit = 1000;

export interface WorkspaceSetup {
  format: 'steel-workspace-setup/1';
  schema: { format: 'steel-schema/1'; types: SetupType[] };
  bindings: Record<BindingType, Binding[]>;
}

export type DesignerRequest = (path: string, body?: unknown) => Promise<unknown>;

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  return object(left) && object(right) && Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(([name, value]) => Object.hasOwn(right, name) && equal(value, right[name]));
}

function fieldShape(field: JsonObject) {
  return [field.ftype, Boolean(field.required), Boolean(field.unique), Boolean(field.repeated),
    field.default ?? null, field.validation ?? {}];
}

function parseTypes(value: unknown): SetupType[] {
  if (!object(value) || value.format !== 'steel-schema/1' || !Array.isArray(value.types)) {
    throw new Error('Expected a steel-schema/1 document from Data Designer.');
  }
  const seen = new Set<string>();
  for (const model of value.types) {
    if (!object(model) || typeof model.name !== 'string' || seen.has(model.name) ||
        !Array.isArray(model.fields)) {
      throw new Error('The schema contains an invalid or duplicate model.');
    }
    seen.add(model.name);
    const fields = new Set<string>();
    for (const field of model.fields) {
      if (!object(field) || typeof field.name !== 'string' || typeof field.ftype !== 'string' ||
          fields.has(field.name)) {
        throw new Error(`The ${model.name} model contains an invalid or duplicate field.`);
      }
      fields.add(field.name);
    }
  }
  return value.types as SetupType[];
}

function parseBindings(value: unknown, name: BindingType, model: SetupType | undefined): Binding[] {
  if (!Array.isArray(value) || value.length > recordReadLimit || (!model && value.length > 0)) {
    throw new Error(`Include a model and up to ${recordReadLimit} ${name} records.`);
  }
  const fields = new Set(model?.fields.map((field) => field.name));
  const ids = new Set<string>();
  for (const row of value) {
    if (!object(row) || typeof row.project_id !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(row.project_id) ||
        typeof row.id !== 'string' || !row.id.startsWith(`${row.project_id}/`) || ids.has(row.id) ||
        typeof row.resource_key !== 'string' || !row.resource_key ||
        Object.keys(row).some((field) => !fields.has(field)) || model?.fields.some((field) =>
          field.required && field.default == null && row[field.name] == null)) {
      throw new Error(`The package contains an invalid or duplicate ${name} record.`);
    }
    if (name === 'MetricBinding' && (typeof row.metric_key !== 'string' ||
        row.id !== `${row.project_id}/${row.resource_key}/${row.metric_key}`)) {
      throw new Error('Metric binding IDs must match their project, resource, and metric.');
    }
    ids.add(row.id);
  }
  return value as Binding[];
}

export function parseWorkspaceSetup(raw: string): WorkspaceSetup {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.format !== 'steel-workspace-setup/1' || !object(value.bindings)) {
    throw new Error('Expected a steel-workspace-setup/1 package.');
  }
  const types = parseTypes(value.schema);
  for (const model of types) {
    if (!observabilityTypes.has(model.name)) {
      throw new Error(`The package contains an unsupported model, ${model.name}.`);
    }
    const fields = new Set(model.fields.map((field) => field.name));
    if (sharedFields.get(model.name)?.some((name) => !fields.has(name))) {
      throw new Error(`The package is missing required ${model.name} fields.`);
    }
  }
  const { MetricBinding, SloDefinition } = value.bindings;
  return {
    format: value.format,
    schema: { format: 'steel-schema/1', types },
    bindings: {
      MetricBinding: parseBindings(MetricBinding, 'MetricBinding', types.find((model) => model.name === 'MetricBinding')),
      SloDefinition: parseBindings(SloDefinition, 'SloDefinition', types.find((model) => model.name === 'SloDefinition')),
    },
  };
}

function responseObject(value: unknown): JsonObject {
  if (!object(value)) throw new Error('Data Designer returned an unexpected response.');
  return value;
}

async function typesByName(request: DesignerRequest) {
  const response = responseObject(await request('/types?include_archived=1'));
  if (!Array.isArray(response.types)) throw new Error('Data Designer did not return its types.');
  return new Map((response.types as DesignerTypeRow[]).map((type) => [type.name, type]));
}

function typePath(type: DesignerTypeRow) {
  return `/types/${encodeURIComponent(type.type_id)}`;
}

function verifyPublished(model: SetupType, published: SetupType) {
  const live = new Map(published.fields.map((field) => [field.name, field]));
  const shared = sharedFields.get(model.name);
  const incompatible = shared ? shared.some((name) => !live.has(name)) :
    model.fields.some((field) => {
      const current = live.get(field.name);
      return !current || !equal(fieldShape(current), fieldShape(field));
    }) || published.fields.some((field) => !model.fields.some(({ name }) => name === field.name) &&
      ((field.required && field.default == null) || (field.unique && field.default != null)));
  if (incompatible) throw new Error(`Review the published ${model.name} schema before applying setup.`);
}

function relationshipShape(relationship: JsonObject, destination: unknown) {
  return [destination, relationship.reverse_name ?? null, relationship.cardinality, relationship.delete_behavior];
}

async function verifyDraft(request: DesignerRequest, model: SetupType, type: DesignerTypeRow,
                           known: Map<string, DesignerTypeRow>) {
  const { type: raw } = responseObject(await request(typePath(type)));
  const draft = raw as DesignerTypeDetail | undefined;
  if (!draft || draft.status !== 'active' || draft.version !== 0 || type.version !== 0) {
    throw new Error(`Review the existing ${model.name} in Data Designer before applying setup.`);
  }
  const namesById = new Map([...known.values()].map(({ name, type_id }) => [type_id, name]));
  const active = Object.fromEntries(draft.fields.filter(({ status }) => status === 'active')
    .map((field) => [field.name, fieldShape({ ...field })]));
  const expected = Object.fromEntries(model.fields.map((field) => [field.name, fieldShape(field)]));
  const activeRelationships = Object.fromEntries(draft.relationships.filter(({ status }) => status === 'active')
    .map((relationship) => [relationship.name, relationshipShape({ ...relationship }, namesById.get(relationship.dst_type))]));
  const relationships = Array.isArray(model.relationships) ? model.relationships.filter(object) : [];
  const expectedRelationships = Object.fromEntries(relationships.map((relationship) => [
    relationship.name, relationshipShape(relationship, relationship.dst),
  ]));
  if (!equal(active, expected) || !equal(activeRelationships, expectedRelationships)) {
    throw new Error(`Review the existing ${model.name} draft before applying setup.`);
  }
  return draft.draft_sha256;
}

async function planSetup(request: DesignerRequest, bundle: WorkspaceSetup) {
  const published = new Map(parseTypes(await request('/export')).map((type) => [type.name, type]));
  const known = await typesByName(request);
  const missing: SetupType[] = [];
  for (const model of bundle.schema.types) {
    const live = published.get(model.name);
    const existing = known.get(model.name);
    if (live) {
      if (!existing || existing.status !== 'active' || existing.version < 1) {
        throw new Error(`The ${model.name} model changed. Check setup again.`);
      }
      verifyPublished(model, live);
      continue;
    }
    if (existing) await verifyDraft(request, model, existing, known);
    missing.push(model);
  }

  const pending: Array<{ name: BindingType; row: Binding }> = [];
  for (const name of bindingTypes) {
    if (!bundle.bindings[name].length) continue;
    const type = known.get(name);
    const response = type && published.has(name) ?
      responseObject(await request(`${typePath(type)}/records?limit=${recordReadLimit}`)) : { records: [] };
    if (!Array.isArray(response.records)) throw new Error(`Data Designer did not return ${name} records.`);
    const rows = response.records as DesignerRecord[];
    const existing = new Map(rows.map(({ values }) => [values.id, values]));
    for (const row of bundle.bindings[name]) {
      const current = existing.get(row.id);
      if (!current) {
        if (rows.length >= recordReadLimit) {
          throw new Error(`The ${name} list reached the Designer read limit. Review existing records first.`);
        }
        pending.push({ name, row });
      } else if (Object.entries(row).some(([field, value]) => !equal(current[field], value))) {
        throw new Error(`Review the existing ${name} record ${row.id} before applying setup.`);
      }
    }
  }

  const imports = missing.filter((model) => !known.has(model.name));
  const importBody = { doc: { format: bundle.schema.format, types: imports } };
  if (imports.length && responseObject(await request('/import/validate', importBody)).ok !== true) {
    throw new Error('Data Designer rejected the missing models in this setup package.');
  }
  return { known, missing, pending, imports, importBody };
}

export async function prepareWorkspaceSetup(request: DesignerRequest, bundle: WorkspaceSetup) {
  const { missing, pending } = await planSetup(request, bundle);
  return { missingModels: missing.map(({ name }) => name), missingBindings: pending.length };
}

export async function applyWorkspaceSetup(request: DesignerRequest, bundle: WorkspaceSetup) {
  const { known, missing, pending, imports, importBody } = await planSetup(request, bundle);
  if (imports.length) await request('/import', importBody);
  const types = imports.length ? await typesByName(request) : known;
  const publishedModels = [];
  for (const model of missing) {
    const type = types.get(model.name);
    if (!type) throw new Error(`Data Designer did not return the new ${model.name} model.`);
    const path = typePath(type);
    const sha = await verifyDraft(request, model, type, types);
    const validation = responseObject(await request(`${path}/validate`, {}));
    if (validation.ok !== true || validation.draft_sha256 !== sha) {
      throw new Error(`The ${model.name} draft could not be verified.`);
    }
    if (responseObject(await request(`${path}/publish`, { actor: 'steel-admin-models' })).ok !== true) {
      throw new Error(`The ${model.name} model could not be published.`);
    }
    publishedModels.push(model.name);
  }

  let insertedBindings = 0;
  for (const { name, row } of pending) {
    const type = types.get(name);
    if (!type) throw new Error(`Data Designer did not return the ${name} model.`);
    await request(`${typePath(type)}/records`, { values: row });
    insertedBindings++;
  }
  return { publishedModels, insertedBindings };
}
