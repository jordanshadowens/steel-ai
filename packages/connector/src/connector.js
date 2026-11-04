// Connector core: authenticated outbound poll -> local model -> submit.
//
// PUBLIC Apache-2.0 candidate. Zero dependencies. The connector initiates
// every exchange (Steel Server can never reach the developer's localhost).
// It opens NO inbound ports, runs NO shell, proxies NO arbitrary URLs, and
// holds NO authority to verify, persist, promote, or execute anything: the
// private Steel Server validates every submitted candidate as untrusted and
// accepts/rejects it through its own existing approval paths.

import { PROTOCOL_ID, LIMITS, ERROR_CODES, validateJobShape, isExpired, providerPayloadFor } from './protocol.js';
import { chatCompletions } from './provider.js';

function connectorError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export class Connector {
  // `secrets` carries at most {steelKey, providerKey}; the class redacts
  // both from every error it throws (see fail()).
  constructor({ config, steelKey, providerKey = null, fetchImpl = fetch }) {
    if (!config || typeof config !== 'object') throw connectorError(ERROR_CODES.CONFIG_ERROR, 'config required');
    if (!steelKey) throw connectorError(ERROR_CODES.CONFIG_ERROR, 'steel key required');
    this.config = config;
    this.steelKey = steelKey;
    this.providerKey = providerKey;
    this.fetchImpl = fetchImpl;
    this.cancelled = new Set();
  }

  fail(code, message) {
    throw connectorError(code, this.redact(String(message)));
  }

  redact(text) {
    let out = String(text ?? '');
    for (const s of [this.steelKey, this.providerKey]) {
      if (typeof s === 'string' && s.length >= 8) out = out.split(s).join('[REDACTED]');
    }
    return out;
  }

  async steel(path, { method = 'GET', body = null, timeoutMs = 15000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await this.fetchImpl(`${this.config.server_base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.steelKey}`,
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        signal: ctrl.signal,
      redirect: 'error',
      });
    } catch (err) {
      clearTimeout(timer);
      if (err?.name === 'AbortError') this.fail(ERROR_CODES.TRANSPORT_ERROR, `steel server timed out at ${path}`);
      this.fail(ERROR_CODES.TRANSPORT_ERROR, `steel server unreachable: ${this.redact(err?.message ?? err)}`);
    }
    clearTimeout(timer);
    if (res.status === 401) this.fail(ERROR_CODES.BAD_KEY, 'steel server refused the API key (401)');
    if (res.status === 403) this.fail(ERROR_CODES.FORBIDDEN_SCOPE, 'steel key lacks connector scope (403)');
    if (res.status === 410) this.fail(ERROR_CODES.JOB_EXPIRED, 'job is gone on the server (410)');
    if (res.status === 404) this.fail(ERROR_CODES.JOB_UNKNOWN, 'job unknown on the server (404)');
    if (!res.ok) this.fail(ERROR_CODES.TRANSPORT_ERROR, `steel server HTTP ${res.status} at ${path}`);
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch {
      this.fail(ERROR_CODES.TRANSPORT_ERROR, `steel server gave invalid JSON at ${path}`);
    }
  }

  health() {
    return this.steel('/api/connector/v1/health');
  }

  // One poll round. Returns {jobs, cancelled}. Applies the local
  // capability allowlist as defense-in-depth even though the server also
  // filters by key scope.
  async pollOnce({ maxJobs = 1, waitMs = 0 } = {}) {
    const data = await this.steel('/api/connector/v1/poll', {
      method: 'POST',
      body: {
        protocol: PROTOCOL_ID,
        connector_id: this.config.connector_id,
        capabilities: this.config.capabilities,
        max_jobs: Math.max(1, Math.min(LIMITS.POLL_MAX_JOBS, maxJobs)),
        wait_ms: Math.max(0, Math.min(LIMITS.POLL_WAIT_MS_MAX, waitMs)),
      },
      timeoutMs: 15000 + Math.min(LIMITS.POLL_WAIT_MS_MAX, waitMs),
    });
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    for (const id of data?.cancelled ?? []) this.cancelled.add(id);
    return { jobs, protocol: data?.protocol ?? null, server_time: data?.server_time ?? null };
  }

  async submitResult(job, { status, outputText = null, error = null }) {
    const data = await this.steel(`/api/connector/v1/jobs/${encodeURIComponent(job.job_id)}/result`, {
      method: 'POST',
      body: {
        protocol: PROTOCOL_ID,
        idempotency_key: job.idempotency_key,
        status,
        ...(outputText === null ? {} : { output_text: outputText }),
        ...(error === null ? {} : { error }),
      },
    });
    return data; // {accepted, verdict: accepted|rejected, rejection?}
  }

  async cancelJob(jobId, reason = 'connector-cancelled') {
    await this.steel(`/api/connector/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      body: { protocol: PROTOCOL_ID, reason },
    });
    this.cancelled.add(jobId);
  }

  // Handle ONE job: validate -> local model -> submit. Returns a small
  // outcome record; provider is called ONLY for valid, in-scope, live jobs.
  async handleJob(job, { providerCalls = null } = {}) {
    if (this.cancelled.has(job?.job_id)) return { job_id: job?.job_id, outcome: 'cancelled' };
    const shape = validateJobShape(job);
    if (!shape.ok) {
      // Malformed server payload: report failure WITHOUT a model call.
      // (If job_id itself is unusable, there is nothing to report to.)
      if (typeof job?.job_id === 'string' && job.job_id !== '' && typeof job?.idempotency_key === 'string') {
        try {
          await this.submitResult(job, { status: 'failed', error: { code: ERROR_CODES.PAYLOAD_REFUSED, message: shape.errors.join('; ').slice(0, 500) } });
        } catch {
          // reporting best-effort; the job was unusable either way
        }
      }
      return { job_id: job?.job_id ?? null, outcome: 'payload-refused', errors: shape.errors };
    }
    if (isExpired(job)) return { job_id: job.job_id, outcome: 'expired' };
    if (!this.config.capabilities.includes(job.type)) {
      await this.submitResult(job, {
        status: 'failed',
        error: { code: ERROR_CODES.SCOPE_REFUSED, message: `connector not configured for ${job.type}; no model call made` },
      });
      return { job_id: job.job_id, outcome: 'scope-refused' };
    }
    const payload = providerPayloadFor(job);
    let text;
    try {
      if (providerCalls) providerCalls.count += 1;
      text = await chatCompletions({
        base: this.config.provider_base,
        model: this.config.provider_model,
        apiKey: this.providerKey,
        messages: payload.messages,
        maxTokens: payload.max_tokens,
        timeoutMs: this.config.provider_timeout_ms,
        fetchImpl: this.fetchImpl,
      });
    } catch (err) {
      const code = Object.values(ERROR_CODES).includes(err?.code) ? err.code : ERROR_CODES.PROVIDER_BAD_RESPONSE;
      await this.submitResult(job, { status: 'failed', error: { code, message: this.redact(err.message).slice(0, 500) } });
      return { job_id: job.job_id, outcome: 'provider-failed', code };
    }
    const verdict = await this.submitResult(job, { status: 'completed', outputText: text });
    if (verdict?.verdict === 'rejected') {
      return { job_id: job.job_id, outcome: 'output-refused', rejection: verdict.rejection ?? null };
    }
    return { job_id: job.job_id, outcome: 'accepted' };
  }

  // One full round: poll, then handle each job in order.
  async runOnce({ maxJobs = 1 } = {}) {
    const { jobs } = await this.pollOnce({ maxJobs });
    const outcomes = [];
    for (const job of jobs) outcomes.push(await this.handleJob(job));
    return outcomes;
  }

  // Long-poll loop. Stops on AbortSignal or after maxIterations rounds
  // (Infinity for daemon use). Sleeps poll_interval_ms between EMPTY polls.
  async runLoop({ signal = null, maxIterations = Infinity, onOutcome = null } = {}) {
    const all = [];
    let i = 0;
    while (i < maxIterations) {
      if (signal?.aborted) break;
      i += 1;
      const outcomes = await this.runOnce({ maxJobs: 1 });
      all.push(...outcomes);
      if (onOutcome) for (const o of outcomes) onOutcome(o);
      if (signal?.aborted) break;
      if (outcomes.length === 0) {
        await sleep(this.config.poll_interval_ms, signal);
      }
    }
    return all;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}
