# steel-connector/1 protocol

Versioned, least-privilege protocol between a locally installed developer
connector and a private Steel AI Server. The connector initiates every
exchange (outbound poll + result POST); the server can never reach the
developer's localhost. Provider responses are untrusted candidates: only
the private server verifies, persists, promotes, or executes them.

Status: server bridge implemented in the private runtime. Integration tests exercise this public connector against the real server routes and validators. The standalone public suite uses synthetic fixtures. Neither proves real-model inference quality.

The reference runtime leases each job once (`max_attempts: 1`), returns poll immediately, and requires the original HTTP caller to retry explicitly after timeout, cancellation, or restart. Completed results are deduplicated by their idempotency key. Queueing is disabled by default. Hosted connection-test keys do not authorize this bridge.

## Endpoints (server-side, private)

Base: the developer's Steel Server URL (https for remote hosts).

- `GET /api/connector/v1/health` — `{ok, protocol, server_version,
  server_time, job_types}`. Requires the Steel API key.
- `POST /api/connector/v1/poll` — body `{protocol, connector_id,
  capabilities, max_jobs (1..4), wait_ms (0..20000)}`. Returns
  `{protocol, server_time, jobs[], cancelled[]}`. The server returns only
  job types covered by the key's scope AND the connector's capabilities.
  `wait_ms` is a bounded long-poll hint; the server may answer sooner.
- `POST /api/connector/v1/jobs/{job_id}/result` — body `{protocol,
  idempotency_key, status: completed|failed, output_text?, error?}`.
  Returns `{accepted, verdict: accepted|rejected, rejection?}`.
  `accepted` means the candidate passed transport checks and entered
  server validation; `verdict` reports that validation. Neither means
  promoted, persisted, or executed — promotion follows the server's
  existing approval paths only.
- `POST /api/connector/v1/jobs/{job_id}/cancel` — body `{protocol,
  reason?}`. Connector-initiated cancel (shutdown, timeout aftermath).

## Authentication and scope

- One header on every call: `Authorization: Bearer <STEEL_API_KEY>`.
  This is the Steel access key, distinct from any local model credential.
- 401 = unknown/bad key. 403 = key valid but lacks connector scope or
  the requested capability. The connector surfaces both actionably and
  never retries with a different identity.
- The poll response carries only jobs the key is allowed to see. The
  connector ALSO enforces its local `capabilities` allowlist and refuses
  anything outside it without calling the model.

## Job envelope

```json
{
  "protocol": "steel-connector/1",
  "job_id": "job-abc123",
  "idempotency_key": "idem-abc123-attempt1",
  "type": "assistant.propose",
  "created_at": "2026-11-04T20:00:00.000Z",
  "expires_at": "2026-11-04T20:05:00.000Z",
  "attempt": 1,
  "max_attempts": 3,
  "scope": { "workspace_id": "ws-1", "capabilities": ["assistant.propose"] },
  "request": {
    "messages": [{ "role": "system", "content": "..." }, { "role": "user", "content": "..." }],
    "max_tokens": 2048,
    "response_format": "json",
    "context_summary": "assistant proposal for doc rev 7, 3 capabilities"
  }
}
```

Transport bounds (connector enforces; server declares at or under these):
at most 12 messages, 65536 chars per message, 262144 chars total prompt,
`max_tokens` 1..16384, output at most 262144 chars.

## Lifecycle: expiry, cancel, retry, idempotency

- Expiry: the connector must not call the model for, nor submit results
  for, a job past `expires_at`. Late submissions get HTTP 410.
- Cancel: either side may cancel. Server lists cancelled ids in poll
  answers; the connector drops them without a model call. The connector
  posts cancel when it abandons a leased job (shutdown/timeout).
- Retry: the server may requeue a failed job up to `max_attempts` with a
  new `idempotency_key` per attempt. Submissions are deduplicated by
  `(job_id, idempotency_key)`: repeats return the first verdict.
- No silent fallback: provider timeouts, tool-call answers, oversize
  output, and server rejections all surface as explicit failed outcomes
  with codes (see `src/protocol.js` ERROR_CODES). Nothing retries
  against a different model behind the developer's back.

## Job types and real server contracts

Each type carries the EXACT `messages` the private server would have sent
to its own backend, so a developer-owned LLM drafts a drop-in candidate.
The server validates with its existing validators; the citations are the
private sources of truth (public code duplicates only shapes, never
imports them).

| type | server route (private) | model input | server validation of the candidate |
|---|---|---|---|
| `assistant.propose` | `POST /api/assistant/propose` (`UI/src/server/server.ts`, via `agent/tools/assistantBridge.js` `handleProposalRequest`) | `{system, user}` from `buildProposalMessages`, max 2048 tokens | `parseProposalText`: JSON object, `proposal.request_id`/`base_rev` echo, `kind`, 1..maxOps commands, every id in the request capabilities, args objects. Codes: truncated, malformed, stale-answer, stale-proposal, limit, unsupported-capability |
| `template.draft` | `POST /api/templates/draft` | draft system prompt for the kind + `"<Noun> request: ..."` user prompt, max 4096 tokens | `extractJson`, transport-envelope refusal (`choices` array = backend failure, 502), `validateTemplateSpec(kind)` |
| `template.revise` | `POST /api/templates/revise` | `REVISE_SYSTEM` + current spec + change (change <= 2000 chars, spec <= 256KB) | kind match + schema validation; structural summary; staleness via `base_hash`; nothing persisted |
| `skill.draft` | `POST /api/skills/draft` via `acquireSkill` (`agent/tools/workflowGraph.js`) | `SKILL_DRAFT_SYSTEM` + Calculation/Params/Sample user prompt, max 1024 tokens | JSON object, `validateProposal`, behavioral tests, invariant checks before any persistence |

`language.draft` is an additional opt-in job type for `POST /api/language/draft`: a bounded instruction and resource data produce exactly `{program: string}`. Server validation checks the draft envelope only; execution and published-definition verification are separate. Tests/verdicts are not generation inputs. Existing default server capabilities are unchanged; the operator must explicitly authorize this capability before using an updated connector.

Explicitly unsupported in v1: `chat.tools` (agentic tool-calling rounds
in the workflow/agent graphs). The connector has no tool authority; a
provider answer containing `tool_calls` fails with
`provider-tool-call-unsupported`. A future protocol version may add
server-mediated tool rounds; v1 declines them loudly.

## Provider side (developer-owned LLM)

- Transport: OpenAI-compatible `POST {provider_base}/chat/completions`
  with `{model, messages, max_tokens}`. Compatibility beyond that shape
  is NOT claimed; `steel-connector compat` + the custom-adapter example
  show how to qualify another backend.
- Default target is loopback. Non-loopback provider targets require
  explicit `allow_remote_provider: true`.
- Only request-scoped messages cross to the provider. The Steel API key
  never leaves the Steel leg; the model credential never leaves the
  provider leg.

## What the connector must never do

No inbound listener. No arbitrary URL fetch (two configured bases only).
No shell, no filesystem beyond its own home dir, no database access. No
verification/persistence/promotion/execution authority. No key logging.

## Reference-runtime limitations

Local connector v1 serves explicit draft routes. Agentic tool-calling chat and deferred acquisition inside an executing workflow are unsupported and refuse without a fallback. Draft and verify a skill in Creator, pin that version, then run it with explicit bindings. The runtime is single-workspace, not a hosted tenant isolation layer.
