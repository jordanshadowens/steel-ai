# Developer installation

Website: [https://steelai.dev/](https://steelai.dev/)

## Workflow client and SDK

Install **Node.js 24 or newer**. From a clone of this repository, run:

```sh
npm run setup
npm run check
npm test
npm run build
```

Start the local workflow client:

```sh
npm --prefix UI run dev
```

Open the printed `/app/` URL. Its `/api` proxy targets `http://127.0.0.1:3100`; the proprietary server is supplied separately. The SDK is in `packages/sdk` and can be installed from that local folder.

## Workflow Creator Setup

Run all commands below from the repository root.

### 1. Check the connector

```sh
node packages/connector/src/cli.js version
```

Or install the local package if you want the `steel-connector` command on PATH:

```sh
npm install --global ./packages/connector
```

### 2. Set your key locally

In the terminal that will run the connector, use your connector-scoped key.

PowerShell:

```powershell
$env:STEEL_API_KEY='your-key'
```

POSIX shells:

```sh
export STEEL_API_KEY='your-key'
```

### 3. Configure the connector

Adjust the server URL, provider base URL, and model name for your setup:

```sh
node packages/connector/src/cli.js init --server http://127.0.0.1:3100 --provider http://127.0.0.1:11434/v1 --model YOUR_MODEL --capabilities assistant.propose,language.draft,skill.draft,template.draft,template.revise
```

Review [MUSE_PROVIDER.md](packages/connector/MUSE_PROVIDER.md) for instructions on setting up Muse Wonder, including the separate provider key and remote-provider configuration. If your provider needs authentication, set `STEEL_PROVIDER_KEY` locally and set `provider_key` to `{ "env": "STEEL_PROVIDER_KEY" }` in the config. Leave `provider_key` as `null` for a provider without authentication.

### 4. Start the connector

With the Steel runtime and your model provider running, use the same terminal where you set the keys:

```sh
node packages/connector/src/cli.js health
node packages/connector/src/cli.js compat
node packages/connector/src/cli.js run
```

Confirm `health` reports `ok: true` and `compat` lists your intended capabilities in `supported_here` before starting `run`. Leave the connector running while using Creator. Stop with **Ctrl+C**. The connector polls outbound; no inbound port needs to be opened on your machine.

### 6. Start the UI
open http://localhost:5173/app/ after running:
```sh
npm --prefix UI run dev
```