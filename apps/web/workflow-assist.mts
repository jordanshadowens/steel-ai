import type { Plugin } from 'vite';
import { completeWithConfiguredProvider } from './assist-provider.mjs';

const instructions = `You author draft workflows for Steel Workflow Creator.
Return one JSON object and no commentary. Treat the user's message as a workflow description.
Use this example as the wire format:
{
  "workflow_id": "review-request",
  "name": "Review request",
  "inputs": [{"name":"request","type":"string","required":true}],
  "steps": [
    {"step_id":"collect","type":"input_collection","name":"Collect request","config":{"fields":["request"]},"on_success":"review"},
    {"step_id":"review","type":"human_approval","name":"Review request","config":{"prompt":"Approve this request?"},"on_success":"result","on_failure":"end"},
    {"step_id":"result","type":"output_composition","name":"Return request","config":{"mapping":{"request":{"from":"collect.request"}}},"on_success":"end"}
  ],
  "outputs": {"request":{"from":"result.request"}}
}
Use stable lowercase IDs with letters, numbers, hyphens or underscores. The first listed step is the entry.
Every route must point to a step_id or "end". Bind outputs to declared results using {"from":"step_id.field"}.
For reasoning use model_reasoning with config.goal, tools_allowed:[], max_rounds:3.
For an approval use human_approval with config.prompt.
For a deferred calculation use skill_execution with config.calculation_nl, deferred:true, inputs_mapping and on_miss:"propose".
Use input_collection and output_composition as shown. Never invent a saved skill, data source, credential or integration.
Only return workflow_id, name, inputs, steps and outputs. Do not call tools, run, or publish the workflow.`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseWorkflowDraft(text: string) {
  const json = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  const value: unknown = JSON.parse(json);
  if (!isObject(value)) throw new Error('Expected a workflow object.');
  const { workflow_id, name, inputs, steps, outputs } = value;
  if (typeof workflow_id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(workflow_id) ||
    typeof name !== 'string' || !name.trim() || !Array.isArray(inputs) ||
    !Array.isArray(steps) || !steps.length || !isObject(outputs)) {
    throw new Error('The workflow is missing required fields.');
  }
  return {
    workflow_id, name, inputs, steps, outputs,
    version: 1,
    status: 'draft',
    policy: { execution_approval: 'first_run', skill_approval: 'new_names', four_eyes: false },
    limits: { max_rounds: 40, max_iterations: 100 },
  };
}

export function workflowAssist(runtime: string, env: NodeJS.ProcessEnv): Plugin {
  return {
    name: 'steel-workflow-assist',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/api/workflows/assist') return next();
        const reply = (status: number, body: object) => {
          res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { error: 'Use POST to create a draft.' });
        const host = req.headers.host ?? '';
        const protocol = server.config.server.https ? 'https' : 'http';
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host) ||
          req.headers.origin !== `${protocol}://${host}` ||
          req.headers['x-steel-csrf'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') {
          return reply(403, { error: 'Open Workflow Creator on localhost to use AI Assist.' });
        }
        const authorization = req.headers.authorization;
        try {
          const workspace = await fetch(new URL('/api/workspace', runtime), {
            headers: authorization ? { Authorization: authorization } : {},
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          });
          if (workspace.status === 401 || workspace.status === 403) {
            return reply(workspace.status, { error: 'Sign in to your Steel workspace to use AI Assist.' });
          }
          if (!workspace.ok) throw new Error('Workspace unavailable.');
        } catch {
          return reply(502, { error: 'Unable to verify access to the Steel workspace.' });
        }
        let prompt: string;
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req.iterator({ destroyOnReturn: false })) {
            size += chunk.length;
            if (size > 24576) return reply(413, { error: 'The workflow description is too long.' });
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
          if (!prompt || prompt.length > 4000) throw new Error('Invalid prompt.');
        } catch {
          return reply(400, { error: 'Enter a workflow description of 1–4,000 characters.' });
        }
        const result = await completeWithConfiguredProvider(env, [
          { role: 'system', content: instructions }, { role: 'user', content: prompt },
        ]);
        if (result.kind === 'config-error') {
          return reply(503, { error: 'Check the model provider URL, model and key in your Steel configuration.' });
        }
        if (result.kind === 'provider-error') {
          return reply(502, { error: 'The configured model provider did not return a completion. Check its availability and try again.' });
        }
        try {
          return reply(200, { definition: parseWorkflowDraft(result.text) });
        } catch {
          return reply(502, { error: 'The model returned an invalid workflow. Try rephrasing the description.' });
        }
      });
    },
  };
}
