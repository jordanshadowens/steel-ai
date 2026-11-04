// Local provider client: OpenAI-compatible chat completions, loopback-first.
//
// PUBLIC Apache-2.0 candidate. Zero dependencies (global fetch). Sends ONLY
// the job's request-scoped messages to the developer-owned LLM. Never sends
// the Steel API key anywhere except the configured Steel Server (enforced by
// construction: this module never receives it).

import { LIMITS, ERROR_CODES } from './protocol.js';

function providerError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// One chat completion. `apiKey` is the LOCAL model credential (or null for
// daemons without auth). Rejects tool-call answers: the connector has no
// tool authority, so a provider that answers with tool_calls is an
// actionable failure, never a silent fallback.
export async function chatCompletions({
  base,
  model,
  apiKey = null,
  messages,
  maxTokens,
  timeoutMs = LIMITS.PROVIDER_TIMEOUT_MS_DEFAULT,
  maxResponseChars = LIMITS.MAX_OUTPUT_CHARS,
  fetchImpl = fetch,
}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
      signal: ctrl.signal,
      redirect: 'error',
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw providerError(ERROR_CODES.PROVIDER_TIMEOUT, `provider did not answer within ${timeoutMs}ms`);
    }
    throw providerError(ERROR_CODES.PROVIDER_UNAVAILABLE, `provider unreachable: ${shortCause(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw providerError(ERROR_CODES.PROVIDER_BAD_RESPONSE, `provider HTTP ${res.status}`);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw providerError(ERROR_CODES.PROVIDER_BAD_RESPONSE, 'provider answer was not JSON');
  }
  const msg = data?.choices?.[0]?.message;
  if (!msg || typeof msg !== 'object') {
    throw providerError(ERROR_CODES.PROVIDER_BAD_RESPONSE, 'provider answer has no choices[0].message');
  }
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    throw providerError(
      ERROR_CODES.PROVIDER_TOOL_CALL_UNSUPPORTED,
      'provider answered with tool_calls; this connector cannot run tools (unsupported path, no fallback attempted)',
    );
  }
  const text = msg.content;
  if (typeof text !== 'string' || text.trim() === '') {
    throw providerError(ERROR_CODES.PROVIDER_BAD_RESPONSE, 'provider gave an empty answer');
  }
  if (text.length > maxResponseChars) {
    throw providerError(ERROR_CODES.PAYLOAD_TOO_LARGE, `provider answer exceeds ${maxResponseChars} chars`);
  }
  return text;
}

// Compatibility probe: GET {base}/models with a short timeout. 200 with a
// JSON body means an OpenAI-compatible local daemon; anything else is
// reported, not fatal — `compat` decides.
export async function probeProvider({ base, apiKey = null, timeoutMs = 5000, fetchImpl = fetch }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: ctrl.signal,
      redirect: 'error',
    });
    const bodyText = await res.text().catch(() => '');
    return { http: res.status, openai_compatible: res.ok && looksJson(bodyText) };
  } catch (err) {
    return { http: null, openai_compatible: false, error: shortCause(err) };
  } finally {
    clearTimeout(timer);
  }
}

function looksJson(t) {
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function shortCause(err) {
  return String(err?.cause?.message ?? err?.message ?? err).slice(0, 160);
}
