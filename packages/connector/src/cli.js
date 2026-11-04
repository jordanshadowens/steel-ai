#!/usr/bin/env node
// steel-connector CLI: init / pair / health / compat / poll-once /
// show-prompt / run. No inbound ports, no auth automation: pairing is
// explicit developer key entry (typed/pasted), nothing is fetched.
//
// PUBLIC Apache-2.0 candidate. Zero dependencies.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROTOCOL_ID, JOB_TYPES, providerPayloadFor } from './protocol.js';
import {
  configHome, loadConfig, writeSkeletonConfig, storeKeyFile, resolveSecret,
  STEEL_KEY_FILE, PROVIDER_KEY_FILE,
} from './config.js';
import { probeProvider } from './provider.js';
import { Connector } from './connector.js';

const VERSION = '0.1.0';

function usage(exit = 0) {
  const u = `steel-connector ${VERSION} — local developer connector for Steel AI Server (${PROTOCOL_ID})

Usage: steel-connector <command> [options]

  init --server URL --provider URL --model NAME [--home DIR] [--capabilities a,b]
      Write a skeleton config. Writes NO secrets; pairing comes next.
  pair --steel|--provider [--home DIR]
      Store ONE explicitly pasted key (read once from stdin) into a 0600 file,
      or print instructions when stdin is a TTY. Never fetches anything.
  health [--home DIR]
      Config valid? Steel reachable? Provider reachable? (exit 1 on any no)
  compat [--home DIR]
      Protocol match + job-type intersection with the Steel Server.
  poll-once [--home DIR]
      One authenticated poll; print job ids/types/expiry (never secrets).
  show-prompt --job FILE
      Print EXACTLY what would be sent to the local LLM for a saved job.
      Makes no network calls.
  run [--home DIR] [--max-iterations N]
      Poll -> local model -> submit loop until Ctrl-C.

Env overrides: STEEL_CONNECTOR_HOME, STEEL_API_KEY, STEEL_PROVIDER_KEY.
Docs: README.md, QUICKSTART.md, PROTOCOL.md, SECURITY.md.
`;
  process.stdout.write(u);
  process.exit(exit);
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq === -1) {
        const k = a.slice(2);
        out[k] = argv[i + 1]?.startsWith('--') || i + 1 >= argv.length ? true : argv[++i];
      } else {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function fail(message) {
  process.stderr.write(`steel-connector: ${message}\n`);
  process.exit(1);
}

function loadSecrets(config) {
  const steelKey = resolveSecret(config.steel_key_ref, config.home);
  const providerKey = config.provider_key_ref ? resolveSecret(config.provider_key_ref, config.home) : null;
  return { steelKey, providerKey };
}

async function cmdInit(o) {
  const home = o.home || configHome();
  const server = o.server;
  const provider = o.provider;
  const model = o.model;
  if (!server || !provider || !model) fail('init needs --server URL --provider URL --model NAME');
  const capabilities = typeof o.capabilities === 'string'
    ? o.capabilities.split(',').map((s) => s.trim()).filter(Boolean)
    : ['assistant.propose'];
  for (const c of capabilities) {
    if (!JOB_TYPES.includes(c)) fail(`unknown capability ${c}; one of ${JOB_TYPES.join(', ')}`);
  }
  const path = writeSkeletonConfig(home, { serverBase: server, providerBase: provider, providerModel: model, capabilities });
  // Validate immediately so typos fail here, not at first run.
  loadConfig(home);
  process.stdout.write(`wrote ${path}\nnext: set STEEL_API_KEY in your shell, or run \`steel-connector pair --steel\` and paste your Steel API key.\n`);
}

async function cmdPair(o) {
  const home = o.home || configHome();
  const which = o.steel ? 'steel' : o.provider ? 'provider' : null;
  if (!which) fail('pair needs --steel or --provider');
  if (process.stdin.isTTY) {
    process.stdout.write(
      which === 'steel'
        ? 'Paste your Steel API key on stdin (one line), e.g.:\n  echo PASTE_KEY_HERE | steel-connector pair --steel\nNothing is fetched; the pasted value is stored 0600 and never logged.\n'
        : 'Paste your local model credential on stdin (one line), or leave provider_key null when your local daemon needs no auth:\n  echo PASTE_KEY_HERE | steel-connector pair --provider\nIt stays on this machine and is never sent to Steel.\n',
    );
    return;
  }
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  const value = data.trim().split(/\s+/)[0] ?? '';
  if (!value) fail('no key received on stdin');
  const file = which === 'steel' ? STEEL_KEY_FILE : PROVIDER_KEY_FILE;
  const path = storeKeyFile(home, file, value);
  process.stdout.write(`stored ${which} key at ${path} (mode 0600 where supported).\nUpdate config.json to use {"file":"${file}"} for ${which === 'steel' ? 'steel_key' : 'provider_key'}.\n`);
}

function withConfig(o) {
  const home = o.home || configHome();
  const config = loadConfig(home);
  return config;
}

async function cmdHealth(o) {
  const config = withConfig(o);
  const report = { ok: true, config: 'ok', steel: null, provider: null };
  try {
    const { steelKey, providerKey } = loadSecrets(config);
    const c = new Connector({ config, steelKey, providerKey });
    try {
      const h = await c.health();
      report.steel = h?.protocol === PROTOCOL_ID ? `ok (${h.protocol})` : `protocol-mismatch (${h?.protocol})`;
      if (h?.protocol !== PROTOCOL_ID) report.ok = false;
    } catch (err) {
      report.steel = `fail: ${err.code ?? 'error'}: ${err.message}`;
      report.ok = false;
    }
    const probe = await probeProvider({ base: config.provider_base, apiKey: providerKey });
    report.provider = probe.openai_compatible ? 'ok (openai-compatible /models)' : `unverified (http ${probe.http ?? 'unreachable'})`;
    if (!probe.openai_compatible) report.ok = false;
  } catch (err) {
    report.ok = false;
    report.config = `fail: ${err.message}`;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}

async function cmdCompat(o) {
  const config = withConfig(o);
  const { steelKey, providerKey } = loadSecrets(config);
  const c = new Connector({ config, steelKey, providerKey });
  const h = await c.health();
  const serverTypes = Array.isArray(h?.job_types) ? h.job_types : [];
  const supported = config.capabilities.filter((t) => serverTypes.includes(t));
  const unsupported = config.capabilities.filter((t) => !serverTypes.includes(t));
  const report = {
    protocol_match: h?.protocol === PROTOCOL_ID,
    connector_protocol: PROTOCOL_ID,
    server_protocol: h?.protocol ?? null,
    server_version: h?.server_version ?? null,
    server_job_types: serverTypes,
    connector_capabilities: config.capabilities,
    supported_here: supported,
    unsupported_here: unsupported,
    provider_model: config.provider_model,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.protocol_match) process.exit(1);
}

async function cmdPollOnce(o) {
  const config = withConfig(o);
  const { steelKey, providerKey } = loadSecrets(config);
  const c = new Connector({ config, steelKey, providerKey });
  const { jobs } = await c.pollOnce({ maxJobs: 4 });
  process.stdout.write(JSON.stringify(jobs.map((j) => ({
    job_id: j.job_id, type: j.type, expires_at: j.expires_at, attempt: j.attempt ?? null,
  })), null, 2) + '\n');
}

async function cmdShowPrompt(o) {
  const file = o.job;
  if (!file || !existsSync(file)) fail('show-prompt needs --job FILE (a saved job envelope)');
  const job = JSON.parse(readFileSync(file, 'utf8'));
  const payload = providerPayloadFor(job);
  process.stdout.write(`job ${job.job_id} (${job.type}) — exact provider-bound prompt follows; no network used.\n`);
  for (const m of payload.messages) process.stdout.write(`\n[${m.role}]\n${m.content}\n`);
  process.stdout.write(`\n[max_tokens: ${payload.max_tokens}]\n`);
}

async function cmdRun(o) {
  const config = withConfig(o);
  const { steelKey, providerKey } = loadSecrets(config);
  const c = new Connector({ config, steelKey, providerKey });
  const maxIterations = o['max-iterations'] ? Number(o['max-iterations']) : Infinity;
  process.stdout.write(`connector ${config.connector_id} polling ${config.server_base} -> ${config.provider_base} (${config.provider_model})\n`);
  const ctrl = new AbortController();
  process.on('SIGINT', () => ctrl.abort());
  if (process.platform === 'win32') {
    // Windows consoles deliver SIGINT to node; also honor Ctrl-Break best-effort.
    process.on('SIGBREAK', () => ctrl.abort());
  }
  const all = await c.runLoop({
    signal: ctrl.signal,
    maxIterations,
    onOutcome: (oc) => process.stdout.write(JSON.stringify(oc) + '\n'),
  });
  const counts = {};
  for (const oc of all) counts[oc.outcome] = (counts[oc.outcome] ?? 0) + 1;
  process.stdout.write(`done: ${JSON.stringify(counts)}\n`);
}

async function main() {
  const o = args(process.argv.slice(2));
  const cmd = o._[0];
  try {
    if (!cmd || cmd === 'help' || o.help === true) return usage(0);
    if (cmd === 'version') {
      process.stdout.write(`${VERSION}\n`);
      return;
    }
    if (cmd === 'init') return await cmdInit(o);
    if (cmd === 'pair') return await cmdPair(o);
    if (cmd === 'health') return await cmdHealth(o);
    if (cmd === 'compat') return await cmdCompat(o);
    if (cmd === 'poll-once') return await cmdPollOnce(o);
    if (cmd === 'show-prompt') return await cmdShowPrompt(o);
    if (cmd === 'run') return await cmdRun(o);
    return usage(1);
  } catch (err) {
    fail(`${err.code ? `${err.code}: ` : ''}${err.message}`);
  }
}

// Print the pidfile-friendly path for start/stop scripts.
export function pidHint() {
  return join(configHome(), 'connector.pid');
}

await main();
