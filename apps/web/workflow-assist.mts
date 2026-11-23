import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { completeWithConfiguredProvider } from './assist-provider.mjs';

const instructions = `You author draft workflows for Steel Workflow Creator.
Return one JSON object with no surrounding commentary.
When given a previous draft, apply the user's requested revisions. Preserve its workflow ID and unrelated steps.
If an essential detail is missing, ask one focused question with {"message":"Your question"}.
When the user asks about the draft without requesting changes, answer with {"message":"Your answer"}.
Use the context from previous clarification turns to interpret short answers.
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
Every input_collection field must be declared in inputs. Every output binding must name a value that its source step emits.
For reasoning use model_reasoning with config.goal, tools_allowed:[], max_rounds:3.
For an approval use human_approval with config.prompt, on_success for approval and on_failure for rejection.
For a branch use conditional_routing with config.rules, for example [{"when":{"ref":"collect.amount","op":"gte","value":1000},"goto":"review"}]. Use on_success as the fallback when no rule matches. Valid operators are eq, ne, gt, gte, lt, lte, contains, and exists.
For a loop use iteration with config.over set to a list reference, config.max_iterations, and config.body containing the steps run per item. Body steps route only within the body or to "end". Keep approvals and nested loops outside the body.
For a deferred calculation use skill_execution with config.calculation_nl, deferred:true, inputs_mapping and on_miss:"propose".
Use input_collection and output_composition as shown. Never invent a saved skill, data source, credential or integration. If unsupported external actions are essential, explain the limitation in a message instead of generating fake steps.
For a workflow, only return workflow_id, name, inputs, steps and outputs. Do not call tools, run, or publish the workflow.`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function parseModelObject(text: string) {
  const json = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  const value: unknown = JSON.parse(json);
  if (!isObject(value)) throw new Error('Expected a workflow object.');
  return value;
}

function parseWorkflowDraft(value: Record<string, unknown>) {
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

function parseClarifications(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4) throw new Error('Invalid clarification history.');
  return value.map((turn: unknown) => {
    if (!isObject(turn) || typeof turn.prompt !== 'string' || !turn.prompt.trim() ||
      turn.prompt.length > 4000 || typeof turn.reply !== 'string' || !turn.reply.trim() || turn.reply.length > 2000) {
      throw new Error('Invalid clarification turn.');
    }
    return [
      { role: 'user' as const, content: turn.prompt },
      { role: 'assistant' as const, content: JSON.stringify({ message: turn.reply }) },
    ];
  }).flat();
}

export async function handleWorkflowAssist(
  req: IncomingMessage,
  res: ServerResponse,
  {runtime, origin, env, requireBearer = false, authorization: forwardedAuthorization, complete = completeWithConfiguredProvider}: {
    runtime: string;
    origin: string | undefined;
    env: NodeJS.ProcessEnv;
    requireBearer?: boolean;
    authorization?: string;
    complete?: typeof completeWithConfiguredProvider;
  },
) {
  const request = new AbortController();
  res.once('close', () => request.abort());
  const reply = (status: number, body: object) => {
    if (res.destroyed) return;
    res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return reply(405, { error: 'Use POST to create a draft.' });
  if (!origin || req.headers.origin !== origin ||
    req.headers['x-steel-csrf'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') {
    return reply(403, { error: 'Open Workflow Creator on this Steel Cloud origin to use AI Assist.' });
  }
  const authorization = forwardedAuthorization ?? req.headers.authorization;
  if (requireBearer && ((!forwardedAuthorization && req.headersDistinct.authorization?.length !== 1) || !/^Bearer \S+$/.test(authorization || ''))) {
    return reply(401, { error: 'Sign in to your Steel workspace to use AI Assist.' });
  }
  try {
    const workspace = await fetch(new URL('/api/workspace', runtime), {
      headers: authorization ? { Authorization: authorization } : {},
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
    });
    if (workspace.status === 401 || workspace.status === 403) {
      return reply(workspace.status, { error: 'Sign in to your Steel workspace to use AI Assist.' });
    }
    if (!workspace.ok) throw new Error('Workspace unavailable.');
    await workspace.body?.cancel();
  } catch {
    if (request.signal.aborted) return;
    return reply(502, { error: 'Unable to verify access to the Steel workspace.' });
  }
  let prompt: string;
  let previous: ReturnType<typeof parseWorkflowDraft> | undefined;
  let clarifications: ReturnType<typeof parseClarifications>;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 131072) return reply(413, { error: 'This request is too large to revise in AI Assist.' });
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > 4000) throw new Error('Invalid prompt.');
    if (body.previous !== undefined && !isObject(body.previous)) throw new Error('Invalid previous draft.');
    if (body.previous) previous = parseWorkflowDraft(body.previous);
    clarifications = parseClarifications(body.clarifications);
  } catch {
    return reply(400, { error: 'The message or draft context is invalid. Messages must be 1–4,000 characters.' });
  }
  if (request.signal.aborted) return;
  const result = await complete(env, [
    { role: 'system', content: instructions },
    ...(previous ? [{
      role: 'user' as const, content: 'Revise this existing draft in my next message.',
    }, {
      role: 'assistant' as const, content: JSON.stringify(previous),
    }] : []),
    ...clarifications,
    { role: 'user', content: prompt },
  ], request.signal);
  if (request.signal.aborted) return;
  if (result.kind === 'config-error') {
    return reply(503, { error: 'Check the model provider URL, model and key in your Steel configuration.' });
  }
  if (result.kind === 'provider-error') {
    return reply(502, { error: 'The configured model provider did not return a completion. Check its availability and try again.' });
  }
  try {
    const resultObject = parseModelObject(result.text);
    if (Object.keys(resultObject).length === 1 && typeof resultObject.message === 'string' &&
      resultObject.message.trim() && resultObject.message.length <= 2000) {
      return reply(200, { message: resultObject.message.trim() });
    }
    const definition = parseWorkflowDraft(resultObject);
    if (previous) definition.workflow_id = previous.workflow_id;
    return reply(200, { definition });
  } catch {
    return reply(502, { error: 'The model returned an invalid workflow. Try rephrasing the description.' });
  }
}

export function workflowAssist(runtime: string, env: NodeJS.ProcessEnv): Plugin {
  return {
    name: 'steel-workflow-assist',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/api/workflows/assist') return next();
        const host = req.headers.host ?? '';
        const protocol = server.config.server.https ? 'https' : 'http';
        const origin = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)
          ? `${protocol}://${host}` : undefined;
        return handleWorkflowAssist(req, res, { runtime, origin, env });
      });
    },
  };
}
