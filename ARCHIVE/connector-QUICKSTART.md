# Start Workflow Creator with your model

This guide takes you from a source checkout to your first model-generated program. Commands use **Windows PowerShell**, starting in the `steel-ai` repository root.

**Where does the key go?** Set your Steel connector key in `STEEL_API_KEY` in the PowerShell window running the connector (step 4). Step 3 automatically creates the settings folder and file at `$HOME\.steel-connector\config.json`; you do not need to create them yourself. There is no connector-key field in Creator.

Keep your authorized Steel runtime, model provider, and connector running. The source UI uses a separate terminal too.

## 1. Get runtime access and the right key

Obtain these from your Steel runtime owner:

- A running, compatible runtime and its URL. Local normally means `http://127.0.0.1:3100`; remote requires HTTPS.
- A **connector-scoped key**, authorized for `language.draft` to draft executable programs, plus any other drafting scopes you need.
- A compatible Creator URL and any required account sign-in instructions.

The public checkout does **not** include the private runtime. Starting its UI does not start a Steel server. Request runtime access through [steelai.dev](https://steelai.dev/) if you do not have it.

A website seven-day **connection-test key** only tests the hosted status API; it cannot pair this connector. `STEEL_AGENT_KEY`, used to invoke published workflows, is also a separate credential.

For the runtime owner: enable `STEEL_CONNECTOR_QUEUE=on` and configure `STEEL_CONNECTOR_KEY_SHA256` with the SHA-256 of a separate randomly generated 32-byte connector key, following your runtime's provisioning instructions. Supply the raw key through your approved secret-sharing channel and authorize the required scopes. These are **server settings**; the developer sets the raw key locally as `STEEL_API_KEY`.

## 2. Prepare the checkout and model

Install **Node.js 24+** for the full source UI setup (standalone connector: Node.js 20+).

If you have not cloned the repository:

```powershell
git clone https://github.com/jordanshadowens/steel-ai.git
cd steel-ai
```

Otherwise, open PowerShell in your existing checkout. Check the installation:

```powershell
node --version
node packages/connector/src/cli.js version
```

The connector should print `0.1.0`. It needs no third-party npm dependencies.

Start your model using its application's instructions. Find its exact model name and OpenAI-compatible base URL. For example, `http://127.0.0.1:11434/v1` works only if your provider actually serves that address. The connector appends `/models` and `/chat/completions`; do not include `/chat/completions` in the base. Responses must contain text; tool-call responses are unsupported.

Using hosted Muse Wonder? Follow [Muse provider setup](MUSE_PROVIDER.md) for its endpoint, model, separate Meta key, and `allow_remote_provider` setting, then continue with the capability checks and Creator steps below. Hosted inference sends draft prompts to that provider.

## 3. Create the connector configuration

Replace `YOUR_MODEL` with the actual model name and adjust the URLs for your services:

```powershell
node packages/connector/src/cli.js init --server http://127.0.0.1:3100 --provider http://127.0.0.1:11434/v1 --model YOUR_MODEL --capabilities assistant.propose,language.draft,skill.draft,template.draft,template.revise
```

Request only capabilities your runtime owner authorizes. **Draft executable program** needs `language.draft`. Omitting `--capabilities` enables only `assistant.propose` locally.

`init` prints the config path. Its default location is `C:\Users\YOUR_WINDOWS_USER\.steel-connector\config.json`. If `STEEL_CONNECTOR_HOME` is set, that directory is used instead. Open the correct file with:

```powershell
$connectorHome = if ($env:STEEL_CONNECTOR_HOME) { $env:STEEL_CONNECTOR_HOME } else { Join-Path $HOME '.steel-connector' }
notepad (Join-Path $connectorHome 'config.json')
```

`init` writes settings and key references, not secret values. It **overwrites an existing config**: back it up before repeating `init`, or edit the existing file instead.

Remote Steel runtimes require HTTPS. The current connector accepts remote HTTPS servers without an `allow_remote_server` flag. Remote **providers** require `"allow_remote_provider": true`; leave that disabled for local models.

## 4. Configure the keys

In the **same PowerShell window** you will use for `health`, `compat`, and `run`, paste your runtime owner's connector key at the masked prompt:

```powershell
$steelSecret = Read-Host 'Steel connector key' -AsSecureString
$env:STEEL_API_KEY = [System.Net.NetworkCredential]::new('', $steelSecret).Password
Remove-Variable steelSecret
```

The generated config already references it through `"steel_key": { "env": "STEEL_API_KEY" }`.

This value lasts for this terminal session. A new terminal needs the key again. Do not paste secrets into Creator, workflow inputs, source files, or chat.

### If your provider needs its own key

Set the separate provider credential in the same window:

```powershell
$providerSecret = Read-Host 'Model provider key' -AsSecureString
$env:STEEL_PROVIDER_KEY = [System.Net.NetworkCredential]::new('', $providerSecret).Password
Remove-Variable providerSecret
```

In `config.json`, replace `"provider_key": null` with:

```json
"provider_key": { "env": "STEEL_PROVIDER_KEY" }
```

**The environment variable alone is insufficient:** the config must reference it. For a local model without authentication, leave `provider_key` as `null` and skip the provider prompt. Steel and provider keys are separate credentials sent to their respective services.

### Optional: save a key for future sessions

After entering the Steel key above, you can store it under the connector home:

```powershell
$env:STEEL_API_KEY | node packages/connector/src/cli.js pair --steel
```

Then set `steel_key` in `config.json` to `{ "file": "steel.key" }`. For a provider, pipe `STEEL_PROVIDER_KEY` into `pair --provider` and set `provider_key` to `{ "file": "provider.key" }`.

`pair` **does not update the config reference**. The saved files contain plaintext secrets; Windows permissions inherit from your profile. Use your normal secret manager if preferred.

## 5. Check the connection and start the connector

With the runtime and model running:

```powershell
node packages/connector/src/cli.js health
node packages/connector/src/cli.js compat
```

Before continuing, confirm:

- `health` reports `"ok": true`, `"config": "ok"`, and successful Steel/provider checks.
- `compat` reports `"protocol_match": true` and includes `language.draft` in `supported_here`. Check other intended capabilities too.

`compat` can exit successfully with entries in `unsupported_here`; inspect the lists. The runtime must also authorize your key for those scopes.

Start polling:

```powershell
node packages/connector/src/cli.js run
```

Leave this window open. Its first line identifies the server, provider, and model. Waiting quietly before a draft request is normal. Stop with **Ctrl+C**. The connector polls outbound; no inbound port needs to be opened on your machine.

## 6. Open Workflow Creator

Open your runtime owner's compatible Creator URL and sign in as instructed.

For the source UI with a local runtime at `http://127.0.0.1:3100`, open a **second PowerShell window** in the repository root:

```powershell
npm run setup
npm --prefix UI run dev
```

Open the printed `/app/` URL (normally `http://localhost:5173/app/`) and select **Workflow Creator**.

The source UI's `/api` proxy targets `http://127.0.0.1:3100`. Changing the connector's `--server` does not change that proxy. For a remote runtime, use the owner's Creator URL or their client configuration instructions.

## 7. Create your first program draft

With the connector still running:

1. Open **Workflow menu → Workflows → New workflow**, or open an existing editable workflow.
2. Configure its name, ID, inputs, and settings. Click **Save** to start adding steps.
3. Click **+ Step**, choose **Execute language**, and select the step on the canvas.
4. In **Describe the program**, enter a small request with an explicit expected result, such as “Write a program that prints the sum of 2 and 3.”
5. Click **Draft executable program**. The runtime queues a `language.draft` job; your connector sends its prompt to your model and submits the answer to Steel.
6. Review **Executable .lang program**. Check the connector terminal for failures or server rejection codes.
7. Click **Save**, then **Validate**. **Preview** shows the execution plan without running it. Test through your authorized runtime before verification or reuse, with expected results defined independently of generated code.

**Publish** requests separate runtime approval. Receiving a draft or passing definition validation does not prove program correctness or publish the workflow.

If these controls are missing, ask the runtime owner for the compatible Creator/runtime version. The public UI is not guaranteed to expose every private runtime feature. You can also import an existing workflow definition through **Workflows → Import JSON**; it opens an editable draft that still needs saving and publication approval.

## 8. Starting again tomorrow

Keep the existing config. Start the runtime and model, open PowerShell in the checkout, supply any environment-based keys again (step 4), then run:

```powershell
node packages/connector/src/cli.js health
node packages/connector/src/cli.js compat
node packages/connector/src/cli.js run
```

Open the supplied Creator URL, or start the source UI in another terminal with `npm --prefix UI run dev`. An unchanged installation does not need another `init` or `npm run setup`.

## Troubleshooting

- **`STEEL_API_KEY is not set`:** enter it in the terminal running the connector, or configure the saved `steel.key` reference.
- **401 / `bad-key`:** use the dedicated key for this runtime, not a website status-test key.
- **403 / `forbidden-scope`:** ask the owner to authorize the scope. Adding it locally cannot grant access.
- **Steel connection failure:** check `server_base` and that the runtime is running. Starting the UI does not start the runtime.
- **Provider unverified/unreachable:** check the service, base URL, `/models` endpoint, and provider key reference. Use the exact available model name.
- **Draft unavailable or waiting:** check `language.draft` is configured and authorized, the connector is running, and Creator and connector use the same runtime. Inspect connector outcomes for a specific refusal.
- **Timeout:** check model responsiveness. The connector defaults to a 60-second provider timeout; the server has its own deadline. Increasing one does not extend the other.
- **Tool-call response refused:** configure your model to return text. The connector cannot execute tool calls or silently switch models.

## Optional developer checks

From the repository root:

```powershell
npm run test:connector
node packages/connector/src/cli.js show-prompt --job path/to/job.json
```

Tests use synthetic Steel/provider fixtures to check protocol handling, refusal paths, and credential separation. They do not start a persistent Creator backend or prove real-model quality. `show-prompt` needs a saved full job envelope and prints provider-bound messages without network calls.

For custom backends, see [examples/custom-adapter.mjs](examples/custom-adapter.mjs). Qualify real models using connection checks, server verdict review, and independent expected results. See [PROTOCOL.md](PROTOCOL.md) and [SECURITY.md](SECURITY.md) for integration details.
