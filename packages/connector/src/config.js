// Connector home/config: explicit developer pairing, loopback-by-default.
//
// PUBLIC Apache-2.0 candidate. Zero dependencies. The Steel API key and the
// local model credential are DIFFERENT secrets carried by DIFFERENT refs;
// neither is ever logged, and neither crosses to the other side
// (see connector.js + the credential-separation fixture).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute, relative } from 'node:path';
import { LIMITS, ERROR_CODES } from './protocol.js';

export const DEFAULT_HOME = join(homedir(), '.steel-connector');
export const CONFIG_FILE = 'config.json';
export const STEEL_KEY_FILE = 'steel.key';
export const PROVIDER_KEY_FILE = 'provider.key';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function configHome() {
  return process.env.STEEL_CONNECTOR_HOME || DEFAULT_HOME;
}

export function isLoopbackUrl(raw) {
  try {
    const u = new URL(raw);
    return LOOPBACK_HOSTS.has(u.hostname.replace(/^\[|\]$/g, '').toLowerCase());
  } catch {
    return false;
  }
}

// Read one secret from an explicit ref. Supported refs:
//   { "env": "NAME" }          — value comes from the environment
//   { "file": "relative/path" } — value comes from a file under the
//                                  connector home (absolute paths refused)
export function resolveSecret(ref, home) {
  if (!ref || typeof ref !== 'object') throw configError('secret ref must be {env} or {file}');
  if (typeof ref.env === 'string') {
    const v = process.env[ref.env];
    if (!v) throw configError(`environment variable ${ref.env} is not set`);
    return v;
  }
  if (typeof ref.file === 'string') {
    if (ref.file === '' || ref.file.includes('..') || isAbsolute(ref.file)) throw configError('secret file ref must be a plain relative path');
    const p = resolve(home, ref.file);
    if (relative(resolve(home), p).startsWith('..') || isAbsolute(relative(resolve(home), p))) throw configError('secret file ref escapes the connector home');
    if (!existsSync(p)) throw configError(`secret file ${ref.file} is missing; see README pairing`);
    return readFileSync(p, 'utf8').trim();
  }
  throw configError('secret ref must be {env} or {file}');
}

function configError(message) {
  const err = new Error(message);
  err.code = ERROR_CODES.CONFIG_ERROR;
  return err;
}

function checkUrl(raw, what, { allowRemote, allowInsecureHttp }) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw configError(`${what} must be a URL`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw configError(`${what} must be http(s)`);
  const loopback = isLoopbackUrl(raw);
  if (!loopback && !allowRemote) {
    throw configError(`${what} is not loopback; set allow_remote_* explicitly to permit it`);
  }
  if (!loopback && u.protocol === 'http:' && !allowInsecureHttp) {
    throw configError(`${what} is remote http; use https or set allow_insecure_http explicitly`);
  }
  return u.toString().replace(/\/$/, '');
}

// Load + validate config.json. Throws config-error (never logs secrets).
export function loadConfig(home = configHome()) {
  const path = join(home, CONFIG_FILE);
  if (!existsSync(path)) {
    throw configError(`no config at ${path}; run \`steel-connector init\` first`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw configError(`config at ${path} is not valid JSON`);
  }
  if (!raw || typeof raw !== 'object') throw configError('config must be a JSON object');

  const serverBase = checkUrl(raw.server_base ?? '', 'server_base', {
    allowRemote: true, // the private Steel Server is normally remote; auth + TLS carry it
    allowInsecureHttp: raw.allow_insecure_http === true,
  });
  const providerBase = checkUrl(raw.provider_base ?? '', 'provider_base', {
    allowRemote: raw.allow_remote_provider === true, // local model: loopback unless explicitly overridden
    allowInsecureHttp: true, // loopback http is the default local case
  });
  if (typeof raw.provider_model !== 'string' || raw.provider_model === '') {
    throw configError('provider_model must be a non-empty string');
  }
  const timeoutMs = raw.provider_timeout_ms ?? LIMITS.PROVIDER_TIMEOUT_MS_DEFAULT;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > LIMITS.PROVIDER_TIMEOUT_MS_MAX) {
    throw configError(`provider_timeout_ms must be 1..${LIMITS.PROVIDER_TIMEOUT_MS_MAX}`);
  }
  const pollMs = raw.poll_interval_ms ?? LIMITS.POLL_INTERVAL_MS_DEFAULT;
  if (!Number.isInteger(pollMs) || pollMs < LIMITS.POLL_INTERVAL_MS_MIN) {
    throw configError(`poll_interval_ms must be >= ${LIMITS.POLL_INTERVAL_MS_MIN}`);
  }
  const capabilities = raw.capabilities ?? ['assistant.propose'];
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    throw configError('capabilities must be a non-empty array of job types');
  }
  return {
    home,
    server_base: serverBase,
    provider_base: providerBase,
    provider_model: raw.provider_model,
    steel_key_ref: raw.steel_key ?? { env: 'STEEL_API_KEY' },
    provider_key_ref: raw.provider_key ?? null, // null = no provider auth (local daemons often need none)
    allow_remote_provider: raw.allow_remote_provider === true,
    allow_insecure_http: raw.allow_insecure_http === true,
    provider_timeout_ms: timeoutMs,
    poll_interval_ms: pollMs,
    capabilities,
    connector_id: typeof raw.connector_id === 'string' && raw.connector_id !== '' ? raw.connector_id : 'dev-connector-1',
  };
}

// Write a skeleton config. NEVER writes secret VALUES; key refs only.
// mode 0600 best-effort (POSIX); on Windows the file inherits the profile ACL.
export function writeSkeletonConfig(home, { serverBase, providerBase, providerModel, capabilities }) {
  mkdirSync(home, { recursive: true });
  const skeleton = {
    server_base: serverBase,
    provider_base: providerBase,
    provider_model: providerModel,
    steel_key: { env: 'STEEL_API_KEY' },
    provider_key: null,
    capabilities: capabilities ?? ['assistant.propose'],
    provider_timeout_ms: LIMITS.PROVIDER_TIMEOUT_MS_DEFAULT,
    poll_interval_ms: LIMITS.POLL_INTERVAL_MS_DEFAULT,
  };
  const path = join(home, CONFIG_FILE);
  writeFileSync(path, JSON.stringify(skeleton, null, 2) + '\n', { mode: 0o600 });
  return path;
}

// Explicit key entry: stores ONE pasted key into a 0600 file. The caller
// supplies the value (typed/pasted by the developer); nothing here fetches
// or automates authentication.
export function storeKeyFile(home, file, value) {
  if (typeof value !== 'string' || value.trim() === '') throw configError('refusing to store an empty key');
  mkdirSync(home, { recursive: true });
  const path = join(home, file);
  writeFileSync(path, value.trim() + '\n', { mode: 0o600 });
  return path;
}
