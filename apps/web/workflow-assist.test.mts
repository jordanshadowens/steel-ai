import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { test } from 'node:test';
import { createServer } from 'vite';
import { workflowAssist } from './workflow-assist.mts';

test('AI Assist passes context to the configured provider and cancels disconnected requests', {
  timeout: 15000,
}, async (t) => {
  const workflow = {
    workflow_id: 'purchase-review',
    name: 'Purchase review',
    inputs: [],
    steps: [{ step_id: 'collect', type: 'input_collection', on_success: 'end' }],
    outputs: {},
  };
  const rule = {
    id: 'vm-memory-high', source_id: 'vm-memory', trigger: 'cloud_monitoring_incident_opened',
    threshold: { operator: 'greater_than', value: 90, unit: 'percent', duration: '10m' },
    notify: 'platform', dedup_key: ['rule_id', 'resource_id'],
  };
  const rulePrompt = `Can you add this to the workflow?
alert_rules:
  - id: vm-memory-high
    source_id: vm-memory
    trigger: cloud_monitoring_incident_opened
    threshold:
      operator: greater_than
      value: 90
      unit: percent
      duration: 10m
    notify: platform
    dedup_key: [rule_id, resource_id]`;
  const started = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const providerCalls: { authorization?: string; messages: { role: string; content: string }[] }[] = [];
  const runtime = createHttpServer(async (req, res) => {
    if (req.url === '/api/workspace') {
      res.statusCode = req.headers.authorization === 'Bearer synthetic-workspace' ? 200 : 401;
      res.end();
      return;
    }
    if (req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const { messages } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    providerCalls.push({ authorization: req.headers.authorization, messages });
    if (messages.at(-1).content === 'Wait for cancellation') {
      res.once('close', () => closed.resolve());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      started.resolve();
      return;
    }
    const content = messages.at(-1).content === 'Draft a purchase workflow'
      ? { message: 'Who should approve purchases?' }
      : messages.at(-1).content === 'Create a purchase data model'
        ? { dataModel: { name: 'Purchases', fields: [{ name: 'amount', ftype: 'decimal', required: true }] } }
        : messages.at(-1).content === rulePrompt
          ? { ...workflow, alert_rules: [rule] }
          : { ...workflow, workflow_id: 'model-returned-a-different-id', status: 'published' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  });
  await new Promise<void>((resolve) => runtime.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    runtime.closeAllConnections();
    return new Promise<void>((resolve) => runtime.close(() => resolve()));
  });
  const address = runtime.address();
  assert.ok(address && typeof address === 'object');
  const runtimeUrl = `http://127.0.0.1:${address.port}`;
  const vite = await createServer({
    configFile: false,
    plugins: [workflowAssist(runtimeUrl, {
      STEEL_CONNECTOR_HOME: 'unused-test-connector-home',
      STEEL_PROVIDER_URL: `${runtimeUrl}/v1`,
      STEEL_PROVIDER_MODEL: 'synthetic',
      STEEL_PROVIDER_KEY: 'synthetic-provider',
    })],
    server: { host: '127.0.0.1', port: 0, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => vite.close());
  await vite.listen();
  const origin = new URL(vite.resolvedUrls!.local[0]).origin;
  const send = (body: object, { authorization = 'Bearer synthetic-workspace', signal }: {
    authorization?: string;
    signal?: AbortSignal;
  } = {}) => fetch(`${origin}/api/workflows/assist`, {
    method: 'POST', headers: { origin, authorization, 'X-Steel-CSRF': '1' },
    signal, body: JSON.stringify(body),
  });

  const denied = await send({ prompt: 'Draft a purchase workflow' }, { authorization: '' });
  assert.equal(denied.status, 401);
  assert.equal(providerCalls.length, 0);
  const clarification = await send({ prompt: 'Draft a purchase workflow' });
  assert.deepEqual(await clarification.json(), { message: 'Who should approve purchases?' });

  const result = await send({
    prompt: 'The budget owner',
    previous: { workflow_id: 'LegacyWorkflow', steps: workflow.steps },
    clarifications: [{ prompt: 'Draft a purchase workflow', reply: 'Who should approve purchases?' }],
  });
  const { definition } = await result.json();
  assert.equal(definition.workflow_id, 'LegacyWorkflow');
  assert.equal(definition.status, 'draft');
  assert.equal(providerCalls[1].authorization, 'Bearer synthetic-provider');
  assert.deepEqual(providerCalls[1].messages.slice(-3), [
    { role: 'user', content: 'Draft a purchase workflow' },
    { role: 'assistant', content: '{"message":"Who should approve purchases?"}' },
    { role: 'user', content: 'The budget owner' },
  ]);

  const model = await send({ prompt: 'Create a purchase data model', previous: workflow });
  assert.equal(model.status, 200);
  assert.deepEqual(await model.json(), { modelSchema: {
    format: 'steel-schema/1',
    types: [{ name: 'Purchases', fields: [{
      name: 'amount', ftype: 'decimal', required: true, unique: false, repeated: false, default: null, validation: {},
    }], relationships: [] }],
  } });

  const alertDraft = await send({ prompt: rulePrompt, previous: workflow });
  assert.equal(alertDraft.status, 200);
  const { definition: withRule } = await alertDraft.json();
  assert.deepEqual(withRule.alert_rules, [rule]);
  assert.deepEqual(withRule.steps, workflow.steps);
  await send({ prompt: 'Does the workflow have an alert rule?', previous: withRule });
  const previousContext = providerCalls.at(-1)?.messages.find(({ role }) => role === 'assistant');
  assert.deepEqual(JSON.parse(previousContext!.content).alert_rules, [rule]);

  const cancel = new AbortController();
  const stopped = assert.rejects(send({ prompt: 'Wait for cancellation' }, { signal: cancel.signal }), {
    name: 'AbortError',
  });
  await started.promise;
  cancel.abort();
  await stopped;
  await closed.promise;
});
