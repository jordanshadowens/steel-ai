# Use Muse Wonder through the Meta API

Run the Steel connector on your developer machine. Muse Wonder is a hosted model: choosing it sends the draft's prompt and input examples to Meta. Use synthetic data for qualification. The Meta credential stays on your machine; Steel receives the proposed capability, not the provider key.

You need two separate credentials:

- A connector key from your authorized Steel server owner (`STEEL_API_KEY`). The website status-test key does not grant workflow or connector access.
- Your own Meta API key with Muse Wonder access (`STEEL_PROVIDER_KEY`). A Steel account does not include a Meta credential or model entitlement.

The configuration below was tested with `https://api.meta.ai/v1` and `muse-wonder-1.0`. Use the endpoint/model issued for your Meta account if different. API use may incur provider charges.

## Configure the local connector

From the cloned steel-ai repository:

```sh
node packages/connector/src/cli.js init --server https://steel-portal-staging-yl3vqnwyta-uc.a.run.app --provider https://api.meta.ai/v1 --model muse-wonder-1.0 --capabilities assistant.propose,skill.draft,template.draft,template.revise --allow-remote-provider
```

Production uses `--server https://steel-runtime-fkknoziyhq-uc.a.run.app`. `init` writes `~/.steel-connector/config.json`; it does not store key values. Back up an existing config before running init again. Edit that file to include these fields, preserving the other generated settings:

```json
{
  "provider_base": "https://api.meta.ai/v1",
  "provider_model": "muse-wonder-1.0",
  "allow_remote_provider": true,
  "provider_key": { "env": "STEEL_PROVIDER_KEY" },
  "steel_key": { "env": "STEEL_API_KEY" },
  "capabilities": ["assistant.propose", "skill.draft", "template.draft", "template.revise"]
}
```

This is a partial config, not a replacement for the generated file: keep `server_base` and timing settings. Enable only capabilities your server owner authorizes. Remote Steel servers require HTTPS. `allow_remote_provider` is required because the model endpoint is hosted rather than loopback.

Set credentials in the same shell that will run the connector. Use your secret manager where available; never commit keys or paste them into Creator, a workflow, screenshots, or support logs.

Windows PowerShell (masked entry, process-local environment):

```powershell
$steelSecret = Read-Host 'Steel connector key' -AsSecureString
$env:STEEL_API_KEY = [System.Net.NetworkCredential]::new('', $steelSecret).Password
$metaSecret = Read-Host 'Meta API key' -AsSecureString
$env:STEEL_PROVIDER_KEY = [System.Net.NetworkCredential]::new('', $metaSecret).Password
Remove-Variable steelSecret, metaSecret
```

macOS/Linux bash (masked entry, process-local environment):

```bash
read -rs -p 'Steel connector key: ' STEEL_API_KEY; printf '\n'
read -rs -p 'Meta API key: ' STEEL_PROVIDER_KEY; printf '\n'
export STEEL_API_KEY STEEL_PROVIDER_KEY
```

Then run:

```sh
node packages/connector/src/cli.js health
node packages/connector/src/cli.js compat
node packages/connector/src/cli.js run
```

Keep `run` open while choosing Draft with AI in Creator. `health` probes `/models`; `compat` checks Steel protocol/capabilities. Neither alone proves model inference or correct calculations. If a provider restricts `/models`, report that probe failure separately from a controlled real draft; do not treat an unverified health probe as success.

## Test a calculation

Follow the [developer workflow walkthrough](https://steelai.dev/developer-guide.html#workflow-test). Declare `units`, `grams_per_unit`, and `price_per_kg` as required Number inputs and as calculation parameters. Bind them explicitly, then draft: multiply units by grams_per_unit, divide by 1000, and multiply by price_per_kg.

Check 7 / 125 / 4.8 gives 4.2. Keep a case out of the drafting prompt: 8 / 250 / 3 must give 6. Map workflow output `packaging_total` to `packaging_cost.value`, save, review publication approval, and run. Reopen the workspace and confirm the same skill ID/version executes 10 / 100 / 2.6 as 2.6 without another generation request.

In the November 4, 2026 isolated qualification, one real Muse Wonder call produced a capability that passed server validation and the held-out case (6). The same saved skill survived reopening and returned 2.6 without a second generation call. This verifies that tested path; other prompts and models still require independent review. Connector v1 does not support streaming, tool-call responses, or deferred runtime acquisition.

## Troubleshooting

- Remote provider refused: set `allow_remote_provider: true` after confirming the Meta endpoint.
- Provider authentication fails: check the Meta key/entitlement and `provider_key` reference. Do not substitute the Steel key.
- Steel 401/403 or missing `skill.draft`: ask the runtime owner for the correct connector scope.
- No jobs: ensure connector `run` is active and the server bridge is enabled; then request a new explicit draft.
- Rejected draft: read Steel's validation result and correct the prompt or parameter contract. Never bypass verification or treat rejection as saved success.
