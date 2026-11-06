// Synthetic Steel Server + synthetic provider fixtures for protocol tests.
//
// TEST-ONLY. These fixtures prove TRANSPORT, AUTH, and VALIDATION/REFUSAL
// behavior of the connector against the real protocol handlers. They NEVER
// claim model inference: the synthetic provider returns canned text, and
// the synthetic server mirrors the real server's validation SHAPES
// (request_id echo, capability allowlist, transport-envelope refusal)
// without importing any private Steel source.
//
// Two wirings: (1) in-process routed fetch (default; works under sandbox,
// exercises the identical handler code), (2) real loopback HTTP servers
// for unsandboxed supervisor/CI runs.

import http from 'node:http';

export const PROTOCOL_ID = 'steel-connector/1';
const MAX_OUTPUT = 262144;
const MAX_BODY = 1048576;

// Build one valid job envelope. `test_expect` is FIXTURE-ONLY metadata the
// synthetic server validates against (the real server derives the same
// expectations from its own workflow/assistant state).
export function makeJob(type, over = {}) {
  const now = Date.now();
  const base = {
    protocol: PROTOCOL_ID,
    job_id: over.job_id ?? `job-${Math.random().toString(36).slice(2, 10)}`,
    idempotency_key: over.idempotency_key ?? `idem-${Math.random().toString(36).slice(2, 10)}`,
    type,
    created_at: new Date(now - 1000).toISOString(),
    expires_at: new Date(now + 120000).toISOString(),
    attempt: 1,
    max_attempts: 3,
    scope: { workspace_id: 'ws-test', capabilities: [type] },
    request: { messages: [], max_tokens: 512, response_format: 'json', context_summary: `${type} fixture` },
    test_expect: {},
  };
  if (type === 'assistant.propose') {
    base.request.messages = [
      { role: 'system', content: 'You translate ONE document-edit instruction into a strict JSON command proposal. Return ONLY a JSON object.' },
      { role: 'user', content: 'Document title: Fixture\nInstruction (untrusted): make it bold\nReturn ONLY the JSON proposal.' },
    ];
    base.request.max_tokens = 2048;
    base.test_expect = { request_id: 'req-1', base_rev: 7, capabilities: ['fmt.bold'], max_ops: 4 };
  } else if (type === 'template.draft') {
    base.request.messages = [
      { role: 'system', content: 'You draft document layout definitions as strict JSON for schema "steel-doc/1". Return ONLY a JSON object.' },
      { role: 'user', content: 'Document request: one-page invoice\nSettings: {}\nReturn ONLY the JSON definition.' },
    ];
    base.request.max_tokens = 4096;
  } else if (type === 'template.revise') {
    base.request.messages = [
      { role: 'system', content: 'You revise ONE template from its current JSON plus a change request. Return ONLY a JSON object.' },
      { role: 'user', content: JSON.stringify({ spec: { schema: 'steel-doc/1', title: 'T' }, change: 'add a footer' }).slice(0, 4000) },
    ];
    base.test_expect = { schema: 'steel-doc/1' };
  } else if (type === 'skill.draft') {
    base.request.messages = [
      { role: 'system', content: 'You draft skill proposals as strict JSON. Never emit markdown fences or prose.' },
      { role: 'user', content: 'Calculation: twice the input\nParams (exact, in order): x\nSample inputs: {"x":2}\nReturn ONLY the JSON skill proposal.' },
    ];
    base.request.max_tokens = 1024;
  }
  return { ...base, ...over, request: { ...base.request, ...(over.request ?? {}) }, scope: { ...base.scope, ...(over.scope ?? {}) } };
}

// Mirror of the REAL server-side candidate validation shapes:
// assistantBridge.parseProposalText (request_id/base_rev echo, kind,
// 1..maxOps commands, capability allowlist, args objects),
// template draft transport-envelope refusal, revise kind/schema match,
// skill draft object shape. Simplified but behavior-compatible.
export function validateCandidate(job, text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text).trim());
  } catch {
    return { verdict: 'rejected', rejection: { code: 'malformed', message: 'candidate was not valid JSON' } };
  }
  if (job.type === 'language.draft') {
    const ok=parsed && Object.keys(parsed).length===1 && typeof parsed.program==='string' && parsed.program.length>0 && parsed.program.length<=4096;
    return ok ? {verdict:'accepted'} : {verdict:'rejected',rejection:{code:'malformed',message:'bounded program required'}};
  }
  if (job.type === 'assistant.propose') {
    const exp = job.test_expect ?? {};
    const p = parsed?.proposal;
    if (!p || typeof p !== 'object') return { verdict: 'rejected', rejection: { code: 'malformed', message: 'no proposal object' } };
    if (p.request_id !== exp.request_id) return { verdict: 'rejected', rejection: { code: 'stale-answer', message: 'request_id mismatch' } };
    if (p.base_rev !== exp.base_rev) return { verdict: 'rejected', rejection: { code: 'stale-proposal', message: 'base_rev mismatch' } };
    if (typeof p.kind !== 'string' || p.kind === '') return { verdict: 'rejected', rejection: { code: 'malformed', message: 'no kind' } };
    const maxOps = exp.max_ops ?? 4;
    if (!Array.isArray(p.commands) || p.commands.length === 0 || p.commands.length > maxOps) {
      return { verdict: 'rejected', rejection: { code: p.commands?.length > maxOps ? 'limit' : 'malformed', message: `commands must be 1..${maxOps}` } };
    }
    const allowed = new Set(exp.capabilities ?? []);
    for (const c of p.commands) {
      if (!c || typeof c.id !== 'string') return { verdict: 'rejected', rejection: { code: 'malformed', message: 'command without id' } };
      if (!allowed.has(c.id)) return { verdict: 'rejected', rejection: { code: 'unsupported-capability', message: `command '${c.id}' not allowed` } };
      if (c.args !== undefined && (c.args === null || typeof c.args !== 'object' || Array.isArray(c.args))) {
        return { verdict: 'rejected', rejection: { code: 'malformed', message: `args for '${c.id}' must be an object` } };
      }
    }
    return { verdict: 'accepted' };
  }
  if (job.type === 'template.draft') {
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.choices)) {
      return { verdict: 'rejected', rejection: { code: 'transport-envelope', message: 'backend returned a transport envelope, not a draft' } };
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.schema !== 'string') {
      return { verdict: 'rejected', rejection: { code: 'malformed', message: 'draft needs a schema string' } };
    }
    return { verdict: 'accepted' };
  }
  if (job.type === 'template.revise') {
    if (!parsed || typeof parsed !== 'object' || parsed.schema !== (job.test_expect?.schema ?? 'steel-doc/1')) {
      return { verdict: 'rejected', rejection: { code: 'kind-mismatch', message: 'revision must keep the input schema' } };
    }
    return { verdict: 'accepted' };
  }
  if (job.type === 'skill.draft') {
    const ok = parsed && typeof parsed === 'object'
      && typeof parsed.name === 'string' && typeof parsed.description === 'string'
      && typeof parsed.code === 'string' && Array.isArray(parsed.params) && Array.isArray(parsed.tests);
    if (!ok) return { verdict: 'rejected', rejection: { code: 'malformed', message: 'skill draft needs name/description/code/params/tests' } };
    return { verdict: 'accepted' };
  }
  return { verdict: 'rejected', rejection: { code: 'unknown-type', message: `unknown type ${job.type}` } };
}

function parseBody(bodyText) {
  if (bodyText.length > MAX_BODY) throw new Error('body too large');
  try {
    return JSON.parse(bodyText || '{}');
  } catch {
    throw new Error('invalid JSON');
  }
}

// --- Steel app: pure request handler shared by both wirings ---

export function createSteelApp({ steelKey, keyScope = null, jobs = [], providerKeyToDetect = null } = {}) {
  const state = {
    queue: jobs.slice(),
    submissions: [],
    seenKeys: new Set(),
    cancelled: new Set(),
    verdictsByIdem: new Map(),
    providerKeySeen: false,
    authFailures: 0,
  };

  async function handle({ method, path, headers, bodyText }) {
    const auth = headers.authorization ?? headers.Authorization ?? '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (key !== steelKey) {
      state.authFailures += 1;
      return { status: 401, body: { error: { code: 'bad-key', message: 'refused' } } };
    }
    state.seenKeys.add(key);
    if (method === 'GET' && path === '/api/connector/v1/health') {
      return {
        status: 200,
        body: {
          ok: true, protocol: PROTOCOL_ID, server_version: 'synthetic-0.1.0',
          server_time: new Date().toISOString(),
          job_types: ['assistant.propose', 'template.draft', 'template.revise', 'skill.draft'],
        },
      };
    }
    if (method === 'POST' && path === '/api/connector/v1/poll') {
      const reqBody = parseBody(bodyText);
      if (providerKeyToDetect && JSON.stringify(reqBody).includes(providerKeyToDetect)) state.providerKeySeen = true;
      const caps = Array.isArray(reqBody.capabilities) ? reqBody.capabilities : [];
      if (keyScope && caps.some((c) => !keyScope.includes(c))) {
        return { status: 403, body: { error: { code: 'forbidden-scope', message: 'key lacks scope' } } };
      }
      const n = Math.max(1, Math.min(4, reqBody.max_jobs ?? 1));
      const out = [];
      const rest = [];
      for (const j of state.queue) {
        const allowedByKey = !keyScope || keyScope.includes(j.type);
        if (out.length < n && caps.includes(j.type) && allowedByKey && !state.cancelled.has(j.job_id)) out.push(j);
        else rest.push(j);
      }
      state.queue = rest;
      return { status: 200, body: { protocol: PROTOCOL_ID, server_time: new Date().toISOString(), jobs: out, cancelled: [...state.cancelled] } };
    }
    const mResult = path.match(/^\/api\/connector\/v1\/jobs\/([^/]+)\/result$/);
    if (method === 'POST' && mResult) {
      const jobId = decodeURIComponent(mResult[1]);
      const reqBody = parseBody(bodyText);
      if (providerKeyToDetect && JSON.stringify(reqBody).includes(providerKeyToDetect)) state.providerKeySeen = true;
      const job = jobs.find((j) => j.job_id === jobId);
      if (!job || state.cancelled.has(jobId)) return { status: 404, body: { error: { code: 'job-unknown' } } };
      if (Date.parse(job.expires_at) <= Date.now()) return { status: 410, body: { error: { code: 'job-expired' } } };
      const idemKey = `${jobId}::${reqBody.idempotency_key ?? ''}`;
      if (state.verdictsByIdem.has(idemKey)) return { status: 200, body: state.verdictsByIdem.get(idemKey) };
      if (typeof reqBody.output_text === 'string' && reqBody.output_text.length > MAX_OUTPUT) {
        return { status: 400, body: { error: { code: 'payload-too-large', message: 'output exceeds 256KB' } } };
      }
      let answer;
      if (reqBody.status === 'completed' && typeof reqBody.output_text === 'string') {
        const v = validateCandidate(job, reqBody.output_text);
        answer = { accepted: true, ...v };
        state.submissions.push({ job_id: jobId, idempotency_key: reqBody.idempotency_key, status: 'completed', ...v });
      } else if (reqBody.status === 'failed') {
        answer = { accepted: true, verdict: 'accepted', note: 'failure recorded' };
        state.submissions.push({ job_id: jobId, idempotency_key: reqBody.idempotency_key, status: 'failed', error: reqBody.error ?? null });
      } else {
        return { status: 400, body: { error: { code: 'bad-request', message: 'status must be completed|failed' } } };
      }
      state.verdictsByIdem.set(idemKey, answer);
      return { status: 200, body: answer };
    }
    const mCancel = path.match(/^\/api\/connector\/v1\/jobs\/([^/]+)\/cancel$/);
    if (method === 'POST' && mCancel) {
      state.cancelled.add(decodeURIComponent(mCancel[1]));
      return { status: 200, body: { ok: true } };
    }
    return { status: 404, body: { error: { code: 'not-found' } } };
  }

  return { state, handle };
}

// --- Provider app: scripted OpenAI-compatible stub ---

export function createProviderApp({ script = [], expectedKey = null, steelKeyToDetect = null } = {}) {
  const state = { calls: [], steelKeySeen: false, authHeaders: [] };
  let i = 0;

  async function handle({ method, path, headers, bodyText, signal }) {
    if (method === 'GET' && path === '/models') {
      return { status: 200, body: { data: [{ id: 'synthetic-test-model' }] } };
    }
    if (method === 'POST' && path === '/chat/completions') {
      const reqBody = parseBody(bodyText);
      const auth = headers.authorization ?? headers.Authorization ?? null;
      state.calls.push({ auth, model: reqBody.model ?? null, max_tokens: reqBody.max_tokens ?? null, messages: reqBody.messages ?? null });
      state.authHeaders.push(auth);
      if (steelKeyToDetect && (auth ?? '').includes(steelKeyToDetect)) state.steelKeySeen = true;
      if (expectedKey && auth !== `Bearer ${expectedKey}`) return { status: 401, body: { error: 'bad provider key' } };
      const step = script[Math.min(i, script.length - 1)] ?? { kind: 'text', text: '{}' };
      i += 1;
      if (step.kind === 'delay') {
        await abortableDelay(step.ms, signal);
        return { status: 200, body: { choices: [{ message: { content: step.then ?? '{}' } }] } };
      }
      if (step.kind === 'http') return { status: step.status ?? 500, body: { error: 'synthetic failure' } };
      if (step.kind === 'invalid-json') return { status: 200, raw: 'this is not json{{{' };
      if (step.kind === 'tool-call') {
        return { status: 200, body: { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'do_thing', arguments: '{}' } }] } }] } };
      }
      if (step.kind === 'empty') return { status: 200, body: { choices: [{ message: { content: '   ' } }] } };
      if (step.kind === 'oversize') {
        return { status: 200, body: { choices: [{ message: { content: 'x'.repeat(step.chars ?? 300000) } }] } };
      }
      return { status: 200, body: { choices: [{ message: { content: step.text ?? '{}' } }] } };
    }
    return { status: 404, body: { error: 'not-found' } };
  }

  return { state, handle };
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      return reject(e);
    }
    const t = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      const e = new Error('aborted');
      e.name = 'AbortError';
      reject(e);
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

// --- Wiring 1: in-process routed fetch (sandbox-safe) ---

function fakeResponse({ status, body, raw }) {
  const text = raw ?? JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

function abortError() {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

// Routes fetchImpl calls to the two apps by URL prefix. Honors
// AbortSignal like a real transport (timeout tests depend on it).
export function createRoutedFetch({ steelBase, steelApp, providerBase, providerApp }) {
  return async function routedFetch(url, init = {}) {
    if (init.signal?.aborted) throw abortError();
    const raw = String(url);
    const headers = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
    const bodyText = typeof init.body === 'string' ? init.body : '';
    const onAbort = () => {};
    try {
      if (raw.startsWith(steelBase)) {
        const path = raw.slice(steelBase.length) || '/';
        const out = await steelApp.handle({ method: init.method ?? 'GET', path, headers, bodyText });
        if (init.signal?.aborted) throw abortError();
        return fakeResponse(out);
      }
      if (raw.startsWith(providerBase)) {
        const path = raw.slice(providerBase.length) || '/';
        const out = await providerApp.handle({ method: init.method ?? 'GET', path, headers, bodyText, signal: init.signal });
        if (init.signal?.aborted) throw abortError();
        return fakeResponse(out);
      }
      throw new Error(`routedFetch: unknown base for ${raw.slice(0, 120)}`);
    } finally {
      init.signal?.removeEventListener?.('abort', onAbort);
    }
  };
}

let pairCounter = 0;

// One isolated steel+provider pair over routed fetch. Returns bases that
// look like URLs but never touch the network.
export function startSyntheticPair({ steel: steelOpts = {}, provider: providerOpts = {} } = {}) {
  pairCounter += 1;
  const steelBase = `https://steel.synthetic/${pairCounter}`;
  const providerBase = `http://provider.synthetic/${pairCounter}`;
  const steelApp = createSteelApp(steelOpts);
  const providerApp = createProviderApp(providerOpts);
  const fetchImpl = createRoutedFetch({ steelBase, steelApp, providerBase, providerApp });
  return {
    steelUrl: steelBase,
    providerUrl: providerBase,
    steelState: steelApp.state,
    providerState: providerApp.state,
    fetchImpl,
    close: async () => {},
  };
}

// --- Wiring 2: real loopback HTTP (unsandboxed supervisor/CI only) ---

function readNodeBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveApp(app) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const bodyText = await readNodeBody(req);
      const out = await app.handle({ method: req.method, path: url.pathname, headers: req.headers, bodyText, signal: null });
      const text = out.raw ?? JSON.stringify(out.body);
      res.writeHead(out.status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
      res.end(text);
    } catch (err) {
      const text = JSON.stringify({ error: String(err.message).slice(0, 200) });
      res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
      res.end(text);
    }
  });
  return server;
}

export async function startSyntheticSteelServer(opts = {}) {
  const app = createSteelApp(opts);
  const server = serveApp(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, state: app.state, close: () => new Promise((resolve) => server.close(resolve)) };
}

export async function startSyntheticProvider(opts = {}) {
  const app = createProviderApp(opts);
  const server = serveApp(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, state: app.state, close: () => new Promise((resolve) => server.close(resolve)) };
}
