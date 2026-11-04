// Custom provider adapter example: wrap a NON-OpenAI local backend.
//
// PUBLIC Apache-2.0 candidate. Copy this file out of the package and adapt
// the ONE function marked below. Everything else (timeouts, size caps,
// tool-call refusal, credential handling) is already enforced.
//
// Capability requirements for ANY backend behind this connector:
//   1. Synchronous text completion: (messages, maxTokens) -> string.
//   2. No tool use: if your backend emits tool calls / function calls /
//      structured deltas, translate failures into thrown errors — the
//      connector cannot run tools and will not silently fall back.
//   3. Honest errors: timeouts and outages must reject, never return
//      placeholder text (placeholder text would submit as a candidate
//      and waste a server validation cycle at best).
//   4. Loopback by default: keep your daemon on localhost; remote models
//      need explicit `allow_remote_provider: true` (and are your risk).

import { chatCompletions } from '../src/provider.js';
import { LIMITS } from '../src/protocol.js';

// ---------------------------------------------------------------------------
// Adapt THIS function to your backend. Contract:
//   input:  messages [{role: 'system'|'user', content}], maxTokens int
//   output: Promise<string> — the model's raw text answer, trimmed non-empty
//   errors: throw with .code set (provider-timeout, provider-unavailable,
//           provider-bad-response) so the connector reports actionably.
// ---------------------------------------------------------------------------
export async function completeWithMyBackend({ messages, maxTokens, model, timeoutMs }) {
  // Example: a daemon that speaks OpenAI-compatible JSON at a custom path.
  // Replace the body with your HTTP/IPC call; keep the shape and errors.
  const MY_DAEMON = process.env.MY_DAEMON_BASE || 'http://127.0.0.1:11434';
  return chatCompletions({
    base: MY_DAEMON,
    model,
    apiKey: process.env.MY_DAEMON_KEY || null,
    messages,
    maxTokens,
    timeoutMs: timeoutMs ?? LIMITS.PROVIDER_TIMEOUT_MS_DEFAULT,
  });
}

// Drop-in `chatFn` for use with the SDK's Connector when you need custom
// provider plumbing but want to keep the Steel poll/submit loop as-is.
// (The stock Connector calls chatCompletions directly; subclass or wrap
// handleJob to inject this — see the commented sketch below.)
export async function customChatFn({ messages, maxTokens, model, timeoutMs }) {
  const text = await completeWithMyBackend({ messages, maxTokens, model, timeoutMs });
  if (typeof text !== 'string' || text.trim() === '') {
    const err = new Error('custom backend gave an empty answer');
    err.code = 'provider-bad-response';
    throw err;
  }
  if (text.length > LIMITS.MAX_OUTPUT_CHARS) {
    const err = new Error(`custom backend answer exceeds ${LIMITS.MAX_OUTPUT_CHARS} chars`);
    err.code = 'payload-too-large';
    throw err;
  }
  return text;
}

// Sketch: injecting customChatFn into the poll/submit loop
// ----------------------------------------------------------
// import { Connector } from '../src/sdk.js';
// const c = new Connector({ config, steelKey, providerKey: null });
// const orig = c.handleJob.bind(c);
// c.handleJob = (job, opts) => orig(job, { ...opts, chatFn: customChatFn });
// (handleJob currently wires chatCompletions directly; the chatFn hook is
//  scheduled for the next slice — see the bridge port plan. Until then,
//  serve OpenAI-compatible /chat/completions from a tiny local shim that
//  calls completeWithMyBackend.)
