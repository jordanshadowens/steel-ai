# Quickstart: end-to-end developer integration (synthetic, ~10 minutes)

This tour runs the FULL loop — connector, Steel leg, and model leg —
against isolated synthetic fixtures on loopback. It proves your install,
config, protocol handling, and refusal paths. It does NOT prove real
model inference: the synthetic provider returns scripted text, so a
green tour means "the plumbing is correct", never "my model drafts
well". Real-model qualification is a separate gate (see the end).

## 0. Prereqs

Node.js >= 20. No dependencies, no network beyond loopback.

## 1. Stage and check the package

```powershell
cd packages/connector
node src\cli.js version          # expect 0.1.0
npm test                         # expect the full protocol suite green
```

`npm test` starts a synthetic Steel Server and a synthetic provider on
ephemeral loopback ports and exercises: auth (401/403), scope refusal,
expiry (410), cancel, oversize, timeout, invalid JSON, stale answers,
unsupported capabilities, transport-envelope refusal, idempotent
resubmission, and credential separation (Steel key never hits the
provider; model key never hits Steel).

## 2. Pair with the synthetic server (explicit entry, local only)

```powershell
$env:STEEL_CONNECTOR_HOME = "$PWD\.tmp-demo-home"
node src\cli.js init --server http://127.0.0.1:1 --provider http://127.0.0.1:2 --model demo
node src\cli.js health   # expect informative failures (nothing listens there yet)
```

`init` writes config only. `health` failing here with `config: ok` and
connection failures proves the CLI reads your config and reports
actionably. (The suite in step 1 covers the live round-trips with
ephemeral ports; wiring a persistent demo server is future work — see
the bridge port plan.)

## 3. Inspect exactly what the model would see

Save any job envelope (poll answers are JSON) and run:

```powershell
node src\cli.js show-prompt --job path\to\job.json
```

This prints the exact provider-bound messages with NO network calls.
Use it before pairing with any server you do not fully trust.

## 4. Go live against a real Steel Server + your own model

1. `init` with your real `--server` (https) and local `--provider`
   (loopback) + `--model`.
2. Pair: set `STEEL_API_KEY` in your shell or `pair --steel` with an
   explicit paste. Keep your model credential in `STEEL_PROVIDER_KEY`
   or `pair --provider` — it never leaves your machine.
3. `node src\cli.js health`, then `node src\cli.js compat` — both must
   be green before `run`.
4. `node src\cli.js run` (or the `scripts/` start helpers).

## 5. Qualify a non-OpenAI backend

Copy `examples/custom-adapter.mjs`, implement the documented
`complete(messages, maxTokens)` function for your daemon, and point a
tiny local shim at it — or wrap it so it serves OpenAI-compatible
`/chat/completions`. Only backends that pass `compat` plus a manual
`run` review (check server verdicts: `accepted` vs `rejected` with
codes) count as qualified. Unsupported answers (tool calls, streaming
deltas, non-JSON transports) must fail actionably — never silently
fall back to another model.

## Real-model gate (NOT covered by fixtures)

Fixtures cannot tell you whether your model drafts acceptable Steel
candidates. That needs a real Steel Server with the connector bridge
(see `docs/architecture/CONNECTOR_BRIDGE_PORT_PLAN.md`), your model,
and human review of verdicts over a qualification set. Until then,
report provider routes as "protocol-verified, inference-unverified".

## Private server pairing

Ask your server owner to enable `STEEL_CONNECTOR_QUEUE=on` and configure `STEEL_CONNECTOR_KEY_SHA256` with the SHA-256 of a separate randomly generated 32-byte connector key. Receive that raw connector key through your approved secret-sharing channel and place it in `STEEL_API_KEY` on your developer machine. Your provider credential, if required, stays in `STEEL_PROVIDER_KEY` locally.

A steelai.dev seven-day connection-test key only tests the hosted status API; it is not a connector credential. Hosted workflow execution is not enabled by this package. The server owner must provide a supported runtime endpoint.

For a local runtime, use `http://127.0.0.1:3100`; remote endpoints must use HTTPS and explicitly enable `allow_remote_server` in your local config. No port on the developer machine needs to be opened. Start the connector before requesting a draft in Workflow Creator, Templates, or Studio Assistant. The default server generation timeout is 120 seconds. Unsupported tool calls fail explicitly.
