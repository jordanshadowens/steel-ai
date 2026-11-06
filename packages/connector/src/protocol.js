// steel-connector/1 — transport constants and pure validators.
//
// PUBLIC Apache-2.0 candidate. Zero dependencies, no imports from private
// Steel engine/database/editor/acquisition modules. This file validates the
// TRANSPORT envelope only (shapes, sizes, expiry). Semantic validation of
// model output (proposal commands, template schemas, skill behavior) stays
// server-side on the private Steel Server, which treats every candidate
// from this connector as untrusted.

export const PROTOCOL_ID = 'steel-connector/1';

// Job types this connector slice supports. Each maps to one real private
// Steel Server generation contract (see PROTOCOL.md for the mapping).
// `chat.tools` (agentic tool-calling) is intentionally NOT listed:
// the connector has no tool authority and cannot fulfill tool calls.
export const JOB_TYPES = Object.freeze([
  'assistant.propose',
  'template.draft',
  'template.revise',
  'skill.draft',
  'language.draft',
]);

// Transport bounds. The server declares per-job bounds at or under these
// ceilings; the connector enforces both.
export const LIMITS = Object.freeze({
  MAX_MESSAGES: 12,
  MAX_MESSAGE_CHARS: 65536,
  MAX_PROMPT_CHARS_TOTAL: 262144,
  MAX_OUTPUT_CHARS: 262144,
  MAX_TOKENS_MIN: 1,
  MAX_TOKENS_MAX: 16384,
  JOB_ID_MAX: 200,
  POLL_MAX_JOBS: 4,
  POLL_WAIT_MS_MAX: 20000,
  PROVIDER_TIMEOUT_MS_DEFAULT: 60000,
  PROVIDER_TIMEOUT_MS_MAX: 300000,
  POLL_INTERVAL_MS_DEFAULT: 5000,
  POLL_INTERVAL_MS_MIN: 1000,
});

// Connector-side error codes. Server rejection verdicts arrive separately
// as `verdict: 'rejected'` with the server's own code; the connector
// surfaces those as `output-refused` plus the server code.
export const ERROR_CODES = Object.freeze({
  BAD_KEY: 'bad-key',
  FORBIDDEN_SCOPE: 'forbidden-scope',
  JOB_EXPIRED: 'job-expired',
  JOB_CANCELLED: 'job-cancelled',
  JOB_UNKNOWN: 'job-unknown',
  PAYLOAD_TOO_LARGE: 'payload-too-large',
  PAYLOAD_REFUSED: 'payload-refused',
  SCOPE_REFUSED: 'connector-scope-refused',
  PROVIDER_TIMEOUT: 'provider-timeout',
  PROVIDER_UNAVAILABLE: 'provider-unavailable',
  PROVIDER_BAD_RESPONSE: 'provider-bad-response',
  PROVIDER_TOOL_CALL_UNSUPPORTED: 'provider-tool-call-unsupported',
  OUTPUT_REFUSED: 'output-refused',
  TRANSPORT_ERROR: 'transport-error',
  CONFIG_ERROR: 'config-error',
});

export function isExpired(job, nowMs = Date.now()) {
  const exp = Date.parse(job?.expires_at ?? '');
  return Number.isNaN(exp) || exp <= nowMs;
}

// Transport-level job validation. Returns {ok, errors[]}. A job that
// fails here must NEVER reach the provider; the connector reports it as
// failed (payload-refused) or skips it (expired) without a model call.
export function validateJobShape(job) {
  const errors = [];
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    return { ok: false, errors: ['job must be an object'] };
  }
  if (job.protocol !== PROTOCOL_ID) errors.push(`protocol must be ${PROTOCOL_ID}`);
  if (typeof job.job_id !== 'string' || job.job_id === '' || job.job_id.length > LIMITS.JOB_ID_MAX) {
    errors.push('job_id must be a 1..200 character string');
  }
  if (typeof job.idempotency_key !== 'string' || job.idempotency_key === '') {
    errors.push('idempotency_key must be a non-empty string');
  }
  if (!JOB_TYPES.includes(job.type)) errors.push(`type must be one of ${JOB_TYPES.join(', ')}`);
  if (Number.isNaN(Date.parse(job?.expires_at ?? ''))) errors.push('expires_at must be ISO time');
  if (Number.isNaN(Date.parse(job?.created_at ?? ''))) errors.push('created_at must be ISO time');
  const req = job.request;
  if (!req || typeof req !== 'object') {
    errors.push('request must be an object');
  } else {
    if (!Array.isArray(req.messages) || req.messages.length === 0 || req.messages.length > LIMITS.MAX_MESSAGES) {
      errors.push(`request.messages must carry 1..${LIMITS.MAX_MESSAGES} messages`);
    } else {
      let total = 0;
      for (let i = 0; i < req.messages.length; i++) {
        const m = req.messages[i];
        if (!m || typeof m !== 'object' || (m.role !== 'system' && m.role !== 'user')) {
          errors.push(`request.messages[${i}].role must be system|user`);
          continue;
        }
        if (typeof m.content !== 'string' || m.content === '' || m.content.length > LIMITS.MAX_MESSAGE_CHARS) {
          errors.push(`request.messages[${i}].content must be 1..${LIMITS.MAX_MESSAGE_CHARS} chars`);
          continue;
        }
        total += m.content.length;
      }
      if (total > LIMITS.MAX_PROMPT_CHARS_TOTAL) {
        errors.push(`request.messages total exceeds ${LIMITS.MAX_PROMPT_CHARS_TOTAL} chars`);
      }
    }
    if (!Number.isInteger(req.max_tokens) || req.max_tokens < LIMITS.MAX_TOKENS_MIN || req.max_tokens > LIMITS.MAX_TOKENS_MAX) {
      errors.push(`request.max_tokens must be ${LIMITS.MAX_TOKENS_MIN}..${LIMITS.MAX_TOKENS_MAX}`);
    }
    if (req.response_format !== 'json' && req.response_format !== 'text') {
      errors.push('request.response_format must be json|text');
    }
  }
  return { ok: errors.length === 0, errors };
}

// Exact prompt the connector will send to the developer-owned LLM for
// one job. The CLI `show-prompt` prints this without calling any model.
export function providerPayloadFor(job) {
  return {
    messages: job.request.messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: job.request.max_tokens,
  };
}
