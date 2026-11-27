import { expect, it } from 'vitest';
import { applyWorkspaceSetup, parseWorkspaceSetup, prepareWorkspaceSetup } from './workspaceSetup';

const project = 'steelai-staging-2026';
const resource = 'run:us-central1:steel-api-staging';
const binding = {
  id: `${project}/${resource}/request_count`, project_id: project, resource_key: resource,
  metric_key: 'request_count', selector: 'requests',
};
const spec = {
  name: 'MetricBinding', relationships: [],
  fields: Object.keys(binding).map((name) => ({ name, ftype: 'text', required: true, unique: name === 'id' })),
};
const metricPoint = { name: 'MetricPoint', fields: [{ name: 'id', ftype: 'text' }], relationships: [] };
const packageDocument = {
  format: 'steel-workspace-setup/1', schema: { format: 'steel-schema/1', types: [spec, metricPoint] },
  bindings: { MetricBinding: [binding], SloDefinition: [] },
};

function fixture() {
  const types = new Map<string, { type_id: string; name: string; status: 'active'; version: number }>();
  const specs = new Map<string, typeof spec>();
  const records: Array<{ values: typeof binding }> = [];
  const writes: string[] = [];

  function addType(model: typeof spec, version = 0, publishedName = model.name) {
    types.set(model.name, { type_id: `ut_${model.name}`, name: model.name, status: 'active', version });
    specs.set(model.name, { ...model, name: publishedName });
  }

  async function request(path: string, body?: unknown) {
    if (path === '/types?include_archived=1') return { types: [...types.values()] };
    if (path === '/import/validate') return { ok: true };
    if (body !== undefined) writes.push(path);
    if (path === '/import') {
      const { doc } = body as { doc: { types: (typeof spec)[] } };
      for (const model of doc.types) addType(model);
      return { ok: true };
    }
    const name = path.split('/')[2]?.slice(3);
    if (path.endsWith('/validate')) return { ok: true, draft_sha256: name };
    if (path.endsWith('/publish')) {
      types.get(name)!.version++;
      return { ok: true, version: types.get(name)!.version };
    }
    if (path.endsWith('/records?limit=1000')) return { records };
    if (path.endsWith('/records')) {
      records.push(body as { values: typeof binding });
      return { ok: true };
    }
    const model = specs.get(name);
    if (model) {
      if (path.includes('/versions/')) {
        return { spec: { ...types.get(name), name: model.name, status: 'published',
          fields: model.fields.map((field) => ({ ...field, status: 'active' })) } };
      }
      return { type: { ...types.get(name), draft_sha256: name, relationships: [],
        fields: model.fields.map((field) => ({ ...field, status: 'active' })) } };
    }
    throw new Error(`Unexpected request ${path}`);
  }
  return { request, writes, records, addType };
}

it('previews without writes, applies the missing models and binding, and reuses them on retry', async () => {
  const bundle = parseWorkspaceSetup(JSON.stringify(packageDocument));
  const { request, writes, records } = fixture();
  expect(await prepareWorkspaceSetup(request, bundle)).toEqual({
    missingModels: ['MetricBinding', 'MetricPoint'], missingBindings: 1,
  });
  expect(writes).toEqual([]);
  expect(await applyWorkspaceSetup(request, bundle)).toEqual({
    publishedModels: ['MetricBinding', 'MetricPoint'], insertedBindings: 1,
  });
  expect(records).toEqual([{ values: binding }]);
  writes.length = 0;
  expect(await applyWorkspaceSetup(request, bundle)).toEqual({ publishedModels: [], insertedBindings: 0 });
  expect(writes).toEqual([]);
});

it('blocks conflicting published fields, drafts, and stored bindings before any model writes', async () => {
  const bundle = parseWorkspaceSetup(JSON.stringify(packageDocument));
  const changed = { ...spec, fields: spec.fields.map((field) => ({ ...field, unique: false })) };
  const published = fixture();
  published.addType(changed, 1);
  await expect(applyWorkspaceSetup(published.request, bundle)).rejects.toThrow('published MetricBinding schema');
  expect(published.writes).toEqual([]);
  const draft = fixture();
  draft.addType(changed);
  await expect(applyWorkspaceSetup(draft.request, bundle)).rejects.toThrow('existing MetricBinding draft');
  expect(draft.writes).toEqual([]);
  const stored = fixture();
  stored.addType(spec, 1);
  stored.records.push({ values: { ...binding, selector: 'different selector' } });
  await expect(applyWorkspaceSetup(stored.request, bundle)).rejects.toThrow('existing MetricBinding record');
  expect(stored.writes).toEqual([]);
});

it('reuses the current named model when its published version retains a previous name', async () => {
  const bundle = parseWorkspaceSetup(JSON.stringify(packageDocument));
  const { request, writes, addType } = fixture();
  addType(spec, 1, 'PreviousMetricBinding');
  expect(await prepareWorkspaceSetup(request, bundle)).toEqual({
    missingModels: ['MetricPoint'], missingBindings: 1,
  });
  expect(writes).toEqual([]);
  expect(await applyWorkspaceSetup(request, bundle)).toEqual({
    publishedModels: ['MetricPoint'], insertedBindings: 1,
  });
  expect(writes).not.toContain('/types/ut_MetricBinding/publish');
});

it('rejects unrelated model names and unscoped or duplicate bindings', () => {
  const unrelated = { ...packageDocument, schema: { ...packageDocument.schema, types: [{ ...spec, name: 'Customer' }] } };
  expect(() => parseWorkspaceSetup(JSON.stringify(unrelated))).toThrow('unsupported model');
  for (const rows of [[{ ...binding, project_id: 'steel-ai-9e116' }], [binding, binding]]) {
    const doc = { ...packageDocument, bindings: { ...packageDocument.bindings, MetricBinding: rows } };
    expect(() => parseWorkspaceSetup(JSON.stringify(doc))).toThrow('invalid or duplicate MetricBinding');
  }
});
