// steel-connector/1 protocol suite: real protocol round-trips between the
// connector and ISOLATED SYNTHETIC fixtures. Default wiring is in-process
// routed fetch (identical handler code, no sockets, sandbox-safe); one
// opt-in test exercises real loopback sockets when the sandbox permits.
// Green here proves transport/auth/scope/expiry/cancel/size/timeout and
// untrusted-output refusal — it NEVER proves model inference.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Connector } from '../src/connector.js';
import { loadConfig, writeSkeletonConfig, isLoopbackUrl } from '../src/config.js';
import { validateJobShape, isExpired } from '../src/protocol.js';
import { makeJob, startSyntheticPair, startSyntheticSteelServer } from './fixtures.mjs';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const CLI = join(root, 'src', 'cli.js');

// Workspace-local scratch (sandbox-safe; ignored by git). Never the
// system temp dir: the sandbox may deny it and other suites share it.
const scratchRoot = join(here, 'tmp');
mkdirSync(scratchRoot, { recursive: true });
function scratch(prefix) {
  return mkdtempSync(join(scratchRoot, prefix));
}

const STEEL_KEY = 'steel-test-key-12345678';
const PROVIDER_KEY = 'provider-local-key-87654321';

const VALID_PROPOSAL = JSON.stringify({
  proposal: { request_id: 'req-1', base_rev: 7, kind: 'edit', commands: [{ id: 'fmt.bold', args: {} }] },
});
const VALID_DRAFT = JSON.stringify({ schema: 'steel-doc/1', title: 'Invoice', sections: [] });
const VALID_REVISE = JSON.stringify({ schema: 'steel-doc/1', title: 'T2', sections: [] });
const VALID_SKILL = JSON.stringify({
  name: 'twice', description: 'doubles x', code: 'fn twice(x) = x * 2;', params: ['x'],
  tests: [{ inputs: { x: 2 }, expected: 4 }, { inputs: { x: 3 }, expected: 6 }],
});

function cfg(pair, over = {}) {
  return {
    home: over.home ?? scratch('steel-conn-'),
    server_base: pair.steelUrl,
    provider_base: pair.providerUrl,
    provider_model: 'synthetic-test-model',
    steel_key_ref: { env: 'STEEL_API_KEY' },
    provider_key_ref: null,
    allow_remote_provider: false,
    allow_insecure_http: true,
    provider_timeout_ms: 2000,
    poll_interval_ms: 1000,
    capabilities: ['assistant.propose', 'template.draft', 'template.revise', 'skill.draft'],
    connector_id: 'test-connector',
    ...over,
  };
}

function connector(pair, steelKey = STEEL_KEY, over = {}, providerKey = null) {
  return new Connector({ config: cfg(pair, over), steelKey, providerKey, fetchImpl: pair.fetchImpl });
}

// Rejections carry machine-readable .code; messages are human prose and
// must stay redacted, so assert the code, not the text.
async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err?.code, code);
    return true;
  });
}

describe('protocol envelope', () => {
  it('accepts a well-formed job and rejects malformed ones without network', () => {
    assert.equal(validateJobShape(makeJob('assistant.propose')).ok, true);
    assert.equal(validateJobShape(null).ok, false);
    assert.equal(validateJobShape({ ...makeJob('assistant.propose'), protocol: 'x/9' }).ok, false);
    assert.equal(validateJobShape({ ...makeJob('assistant.propose'), type: 'chat.tools' }).ok, false);
    const big = makeJob('assistant.propose', { request: { messages: [{ role: 'user', content: 'y'.repeat(300000) }], max_tokens: 8, response_format: 'json' } });
    assert.equal(validateJobShape(big).ok, false);
  });

  it('detects expiry locally', () => {
    assert.equal(isExpired(makeJob('assistant.propose')), false);
    const dead = makeJob('assistant.propose', { expires_at: new Date(Date.now() - 1000).toISOString() });
    assert.equal(isExpired(dead), true);
  });

  it('loopback guard defaults to local-only providers', () => {
    assert.equal(isLoopbackUrl('http://127.0.0.1:11434'), true);
    assert.equal(isLoopbackUrl('http://localhost:8080/x'), true);
    assert.equal(isLoopbackUrl('http://[::1]:8080/'), true);
    assert.equal(isLoopbackUrl('https://models.example.com'), false);
    const home = scratch('steel-conn-');
    writeSkeletonConfig(home, { serverBase: 'http://127.0.0.1:9', providerBase: 'https://models.example.com', providerModel: 'm', capabilities: ['assistant.propose'] });
    assert.throws(() => loadConfig(home), /not loopback/);
    const allowed = scratch('steel-conn-remote-');
    writeSkeletonConfig(allowed, { serverBase: 'http://127.0.0.1:9', providerBase: 'https://models.example.com', providerModel: 'm', capabilities: ['assistant.propose'], allowRemoteProvider: true });
    assert.equal(loadConfig(allowed).allow_remote_provider, true);
  });
});

describe('authentication and scope', () => {
  it('401 on wrong steel key, jobs on the right key', async () => {
    const pair = startSyntheticPair({ steel: { steelKey: STEEL_KEY, jobs: [makeJob('assistant.propose')] } });
    const bad = connector(pair, 'wrong-key-00000000');
    await rejectsWithCode(bad.pollOnce(), 'bad-key');
    assert.equal(pair.steelState.authFailures, 1);
    const { jobs } = await connector(pair).pollOnce();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].type, 'assistant.propose');
  });

  it('403 when the key lacks the requested capability', async () => {
    const pair = startSyntheticPair({ steel: { steelKey: STEEL_KEY, keyScope: ['assistant.propose'], jobs: [] } });
    const c = connector(pair, STEEL_KEY, { capabilities: ['assistant.propose', 'skill.draft'] });
    await rejectsWithCode(c.pollOnce(), 'forbidden-scope');
  });

  it('connector refuses out-of-scope jobs WITHOUT a model call', async () => {
    const job = makeJob('skill.draft');
    const pair = startSyntheticPair({
      steel: { steelKey: STEEL_KEY, jobs: [job] },
      provider: { script: [{ kind: 'text', text: VALID_SKILL }] },
    });
    const c = connector(pair, STEEL_KEY, { capabilities: ['assistant.propose'] });
    // The server filters by caps at poll; force-deliver the job to prove
    // the connector ALSO refuses it locally without calling the model.
    const outcome = await c.handleJob(job);
    assert.equal(outcome.outcome, 'scope-refused');
    assert.equal(pair.providerState.calls.length, 0);
    assert.equal(pair.steelState.submissions[0].error.code, 'connector-scope-refused');
  });
});

describe('happy paths (scripted text, not inference)', () => {
  it('language draft is opt-in and transports an untrusted program',async()=>{
    const job=makeJob('language.draft',{request:{messages:[{role:'user',content:'Return a bounded lang program'}]}});
    const pair=startSyntheticPair({steel:{steelKey:STEEL_KEY,keyScope:['language.draft'],jobs:[job]},provider:{script:[{kind:'text',text:JSON.stringify({program:'print 42;'})}]}});
    const denied=startSyntheticPair({steel:{steelKey:STEEL_KEY,jobs:[job]}});
    const refused=await connector(denied).handleJob(job);assert.equal(refused.outcome,'scope-refused');assert.equal(denied.providerState.calls.length,0);
    const outcomes=await connector(pair,STEEL_KEY,{capabilities:['language.draft']}).runOnce();
    assert.equal(outcomes[0].outcome,'accepted');
  });
  const cases = [
    ['assistant.propose', VALID_PROPOSAL],
    ['template.draft', VALID_DRAFT],
    ['template.revise', VALID_REVISE],
    ['skill.draft', VALID_SKILL],
  ];
  for (const [type, text] of cases) {
    it(`${type}: poll -> provider -> accepted`, async () => {
      const pair = startSyntheticPair({
        steel: { steelKey: STEEL_KEY, jobs: [makeJob(type)] },
        provider: { script: [{ kind: 'text', text }] },
      });
      const outcomes = await connector(pair).runOnce();
      assert.equal(outcomes.length, 1);
      assert.equal(outcomes[0].outcome, 'accepted');
      assert.equal(pair.providerState.calls.length, 1);
      assert.equal(pair.steelState.submissions.length, 1);
      assert.equal(pair.steelState.submissions[0].verdict, 'accepted');
    });
  }
});

describe('expiry and cancel', () => {
  it('skips expired jobs without a model call; server 410s late results', async () => {
    const dead = makeJob('assistant.propose', { expires_at: new Date(Date.now() - 1000).toISOString() });
    const pair = startSyntheticPair({
      steel: { steelKey: STEEL_KEY, jobs: [dead] },
      provider: { script: [{ kind: 'text', text: VALID_PROPOSAL }] },
    });
    const c = connector(pair);
    const outcomes = await c.runOnce();
    assert.equal(outcomes[0].outcome, 'expired');
    assert.equal(pair.providerState.calls.length, 0);
    await rejectsWithCode(c.submitResult(dead, { status: 'completed', outputText: VALID_PROPOSAL }), 'job-expired');
  });

  it('honors connector-initiated cancel (no model call after cancel)', async () => {
    const job = makeJob('assistant.propose');
    const pair = startSyntheticPair({
      steel: { steelKey: STEEL_KEY, jobs: [job] },
      provider: { script: [{ kind: 'text', text: VALID_PROPOSAL }] },
    });
    const c = connector(pair);
    await c.cancelJob(job.job_id, 'test-cancel');
    const outcomes = await c.runOnce();
    assert.ok(outcomes.length === 0 || outcomes[0].outcome === 'cancelled');
    assert.equal(pair.providerState.calls.length, 0);
  });

  it('deduplicates resubmission by idempotency key', async () => {
    const job = makeJob('assistant.propose');
    const pair = startSyntheticPair({ steel: { steelKey: STEEL_KEY, jobs: [job] } });
    const c = connector(pair);
    const first = await c.submitResult(job, { status: 'completed', outputText: VALID_PROPOSAL });
    const second = await c.submitResult(job, { status: 'completed', outputText: VALID_PROPOSAL });
    assert.deepEqual(second, first);
    assert.equal(pair.steelState.submissions.length, 1);
  });
});

describe('provider failures surface actionably', () => {
  async function runWithProvider(script, providerTimeoutMs = 2000) {
    const pair = startSyntheticPair({
      steel: { steelKey: STEEL_KEY, jobs: [makeJob('assistant.propose')] },
      provider: { script },
    });
    const outcomes = await connector(pair, STEEL_KEY, { provider_timeout_ms: providerTimeoutMs }).runOnce();
    return { outcomes, sub: pair.steelState.submissions[0], providerCalls: pair.providerState.calls.length };
  }

  it('timeout -> provider-timeout + failed result recorded', async () => {
    const { outcomes, sub } = await runWithProvider([{ kind: 'delay', ms: 1500, then: VALID_PROPOSAL }], 300);
    assert.equal(outcomes[0].outcome, 'provider-failed');
    assert.equal(outcomes[0].code, 'provider-timeout');
    assert.equal(sub.status, 'failed');
  });

  it('unknown provider base -> provider-unavailable', async () => {
    const pair = startSyntheticPair({ steel: { steelKey: STEEL_KEY, jobs: [makeJob('assistant.propose')] } });
    const routed = pair.fetchImpl;
    const brokenFetch = (url, init) => {
      if (String(url).startsWith(pair.providerUrl)) return Promise.reject(new Error('connect ECONNREFUSED'));
      return routed(url, init);
    };
    const c = new Connector({ config: cfg(pair), steelKey: STEEL_KEY, fetchImpl: brokenFetch });
    const outcomes = await c.runOnce();
    assert.equal(outcomes[0].outcome, 'provider-failed');
    assert.equal(outcomes[0].code, 'provider-unavailable');
  });

  it('invalid JSON / empty / HTTP 500 -> provider-bad-response', async () => {
    for (const script of [[{ kind: 'invalid-json' }], [{ kind: 'empty' }], [{ kind: 'http', status: 500 }]]) {
      const { outcomes } = await runWithProvider(script);
      assert.equal(outcomes[0].outcome, 'provider-failed');
      assert.equal(outcomes[0].code, 'provider-bad-response');
    }
  });

  it('oversize answer -> payload-too-large, never submitted as completed', async () => {
    const { outcomes, sub, providerCalls } = await runWithProvider([{ kind: 'oversize', chars: 300000 }]);
    assert.equal(providerCalls, 1);
    assert.equal(outcomes[0].outcome, 'provider-failed');
    assert.equal(outcomes[0].code, 'payload-too-large');
    assert.equal(sub.status, 'failed');
  });

  it('tool_calls answer -> provider-tool-call-unsupported (no silent fallback)', async () => {
    const { outcomes } = await runWithProvider([{ kind: 'tool-call' }]);
    assert.equal(outcomes[0].outcome, 'provider-failed');
    assert.equal(outcomes[0].code, 'provider-tool-call-unsupported');
  });
});

describe('untrusted-output refusal (server verdicts)', () => {
  async function runWithText(text, type = 'assistant.propose') {
    const pair = startSyntheticPair({
      steel: { steelKey: STEEL_KEY, jobs: [makeJob(type)] },
      provider: { script: [{ kind: 'text', text }] },
    });
    const outcomes = await connector(pair).runOnce();
    return outcomes[0];
  }

  it('invalid JSON -> output-refused/malformed', async () => {
    const o = await runWithText('not json at all {{{');
    assert.equal(o.outcome, 'output-refused');
    assert.equal(o.rejection.code, 'malformed');
  });

  it('stale request_id -> output-refused/stale-answer', async () => {
    const o = await runWithText(JSON.stringify({ proposal: { request_id: 'req-other', base_rev: 7, kind: 'edit', commands: [{ id: 'fmt.bold' }] } }));
    assert.equal(o.outcome, 'output-refused');
    assert.equal(o.rejection.code, 'stale-answer');
  });

  it('unsupported capability -> output-refused/unsupported-capability', async () => {
    const o = await runWithText(JSON.stringify({ proposal: { request_id: 'req-1', base_rev: 7, kind: 'edit', commands: [{ id: 'shell.exec' }] } }));
    assert.equal(o.outcome, 'output-refused');
    assert.equal(o.rejection.code, 'unsupported-capability');
  });

  it('transport envelope as draft -> output-refused/transport-envelope', async () => {
    const o = await runWithText(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), 'template.draft');
    assert.equal(o.outcome, 'output-refused');
    assert.equal(o.rejection.code, 'transport-envelope');
  });

  it('malformed skill draft -> output-refused/malformed', async () => {
    const o = await runWithText(JSON.stringify({ name: 'x' }), 'skill.draft');
    assert.equal(o.outcome, 'output-refused');
    assert.equal(o.rejection.code, 'malformed');
  });
});

describe('credential separation and redaction', () => {
  it('steel key never reaches the provider; provider key never reaches steel', async () => {
    const pair = startSyntheticPair({
      steel: { steelKey: STEEL_KEY, jobs: [makeJob('assistant.propose')], providerKeyToDetect: PROVIDER_KEY },
      provider: { script: [{ kind: 'text', text: VALID_PROPOSAL }], expectedKey: PROVIDER_KEY, steelKeyToDetect: STEEL_KEY },
    });
    const outcomes = await connector(pair, STEEL_KEY, {}, PROVIDER_KEY).runOnce();
    assert.equal(outcomes[0].outcome, 'accepted');
    assert.equal(pair.providerState.steelKeySeen, false);
    assert.equal(pair.steelState.providerKeySeen, false);
    assert.deepEqual(pair.providerState.authHeaders, [`Bearer ${PROVIDER_KEY}`]);
  });

  it('errors redact both secrets', () => {
    const pair = startSyntheticPair({});
    const c = connector(pair, STEEL_KEY, {}, PROVIDER_KEY);
    const redacted = c.redact(`leak ${STEEL_KEY} and ${PROVIDER_KEY} end`);
    assert.ok(!redacted.includes(STEEL_KEY) && !redacted.includes(PROVIDER_KEY));
    assert.ok(redacted.includes('[REDACTED]'));
  });
});

describe('public-boundary static audits', () => {
  it('src/ + examples/ import nothing private and use zero bare deps', () => {
    const files = [
      ...readdirSync(join(root, 'src')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'src', f)),
      join(root, 'examples', 'custom-adapter.mjs'),
    ];
    assert.ok(files.length >= 6);
    const specifiers = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) specifiers.push(`${f} :: ${m[1]}`);
    }
    const bad = specifiers.filter((s) =>
      !s.includes('./') && !s.includes('../src/') && !s.includes('../examples/') && !/node:[a-z]+/.test(s),
    );
    assert.deepEqual(bad, []);
    const privLeak = specifiers.filter((s) => /agent\/|UI\/|rust\/|interpreter\/|tauri-|database\/|sqlite|workflow|wonder/i.test(s));
    assert.deepEqual(privLeak, []);
  });

  it('src/ opens no ports and runs no shell', () => {
    const files = readdirSync(join(root, 'src')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'src', f));
    const hits = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const pat of ['createServer', '.listen(', 'child_process', 'execFile', 'spawn(', 'exec(', 'fork(']) {
        if (text.includes(pat)) hits.push(`${f} :: ${pat}`);
      }
    }
    assert.deepEqual(hits, []);
  });

  it('package ships zero dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.dependencies, {});
  });
});

describe('CLI reality checks (isolated home)', () => {
  it('init writes skeleton; show-prompt prints exact bytes offline', async () => {
    const home = scratch('steel-conn-cli-');
    const env = { ...process.env, STEEL_CONNECTOR_HOME: home };
    const init = await execFileAsync('node', [CLI, 'init', '--server', 'https://steel.synthetic', '--provider', 'http://127.0.0.1:11434', '--model', 'demo'], { env });
    assert.match(init.stdout, /wrote .*config\.json/);
    const jobFile = join(home, 'job.json');
    writeFileSync(jobFile, JSON.stringify(makeJob('assistant.propose')));
    const shown = await execFileAsync('node', [CLI, 'show-prompt', '--job', jobFile], { env });
    assert.match(shown.stdout, /no network used/);
    assert.match(shown.stdout, /Return ONLY the JSON proposal/);
  });

  it('health reports each leg honestly (here: nothing listens)', async () => {
    const home = scratch('steel-conn-cli-');
    const env = { ...process.env, STEEL_CONNECTOR_HOME: home, STEEL_API_KEY: 'test-key-00000000' };
    await execFileAsync('node', [CLI, 'init', '--server', 'http://127.0.0.1:9', '--provider', 'http://127.0.0.1:9', '--model', 'demo'], { env });
    const err = await execFileAsync('node', [CLI, 'health'], { env }).then(() => null, (e) => e);
    assert.ok(err, 'health must exit nonzero when legs are down');
    const report = JSON.parse(err.stdout);
    assert.equal(report.config, 'ok');
    assert.match(report.steel, /fail/);
  });
});

describe('real loopback sockets (unsandboxed runs only)', () => {
  it('synthetic steel server answers health over TCP, or records a sandbox skip', async (t) => {
    let steel;
    try {
      steel = await startSyntheticSteelServer({ steelKey: STEEL_KEY, jobs: [] });
    } catch (err) {
      if (String(err.message).includes('EACCES') || String(err.message).includes('permission')) {
        t.skip('sandbox denies listen(); in-process wiring covers the same handlers');
        return;
      }
      throw err;
    }
    try {
      const res = await fetch(`${steel.url}/api/connector/v1/health`, { headers: { Authorization: `Bearer ${STEEL_KEY}` } });
      const body = await res.json();
      assert.equal(body.protocol, 'steel-connector/1');
    } finally {
      await steel.close();
    }
  });
});
