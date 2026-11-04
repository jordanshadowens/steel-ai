# Security model — developer connector

## Trust boundaries

- The developer's machine is trusted by the developer. The connector runs
  there with the developer's privileges and reads two secrets: the Steel
  API key and (optionally) the local model credential.
- The private Steel Server does NOT trust the connector's output. Every
  submitted candidate is untrusted input, validated by the server's
  existing validators before anything else happens. A connector can at
  most waste a validation cycle; it cannot promote, persist, execute, or
  approve anything.
- The local LLM is untrusted by the server for the same reason. Model
  output never executes on either side: the connector passes text through
  without interpreting it (no tool calls, no code execution, no URL fetch
  of model-provided URLs).

## Credential separation

- Steel API key: sent ONLY to the configured `server_base`, as a Bearer
  header. Never to the provider, never in logs, never in the config file
  as a value (the config carries a ref: `{env}` or `{file}`).
- Model credential: sent ONLY to the configured `provider_base`. Never
  to Steel, never in logs. May be absent (`provider_key: null`) when the
  local daemon needs no auth.
- Both values are redacted from connector errors (`Connector.redact`).
- Storage: `steel-connector pair` writes 0600 files under the connector
  home (POSIX mode; Windows inherits the profile ACL). Uninstall
  preserves credentials/config/data by default (see README).

## Network posture

- Outbound only. The connector opens NO listening socket and needs NO
  inbound ports, port forwarding, or internet exposure of the local
  model. Hosted Steel works because polling reverses the direction.
- Exactly two remote bases exist: `server_base` and `provider_base`.
  There is no generic fetch and no model-controlled URL loading.
- Provider defaults to loopback (`localhost`, `127.0.0.1`, `::1`).
  Anything else requires explicit `allow_remote_provider: true`.
- Remote Steel Servers require https unless the developer explicitly
  sets `allow_insecure_http: true` (self-hosted loopback http is the
  normal insecure case and stays convenient).

## Request scoping

- Only the job's `request.messages` reach the local model, bounded
  (<= 12 messages, <= 256KB total). `context_summary` tells the
  developer what the prompt covers; `show-prompt` prints the exact
  bytes before any model call.
- One workspace per job (`scope.workspace_id`); the connector keeps no
  cross-job state besides idempotency/cancel bookkeeping.

## Abuse limits

- Poll floor 1000ms; bounded long-poll (`wait_ms` <= 20000). Provider
  timeout 60s default, 300s max. Output cap 256KB. These bound runaway
  cost on the developer's own machine.
- Server-side rate limiting and key revocation stay server-side (bridge
  port plan); a revoked key yields 401 and the connector stops with an
  actionable error instead of retrying.

## What is NOT promised

- No sandboxing of the local model process itself (the developer owns
  that daemon and its flags).
- No end-to-end encryption beyond TLS to the Steel Server; the server
  necessarily sees prompts and candidates (it validates them).
- No protection against a malicious Steel Server sending hostile
  prompts to the local model: only pair with servers you trust, scope
  keys to connector use, and review `show-prompt` output when pairing
  with a new server.
