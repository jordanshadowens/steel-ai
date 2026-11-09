# Install Steel AI

The website is [https://steelai.dev/](https://steelai.dev/). This repository is the client you run on your computer. The runtime is the service that client calls.

You need Node.js 24 or newer.

## Start the client

From a clone of this repository, install the client once:

```sh
npm run setup
```

Create `UI/.env` if it is not there. The client calls the Steel API:

```
STEEL_RUNTIME_URL=https://api.steelai.dev
```

Start the client from the repository root and leave that terminal open:

```sh
npm --prefix UI run dev
```

Open the `/app/` address the command prints. The page forwards `/api` to `https://api.steelai.dev`. Stop the client with Ctrl+C in that terminal. Start it again later with the same `npm --prefix UI run dev` command. You do not need to run `npm run setup` again unless the client dependencies change.

The SDK lives in `packages/sdk` and installs from that folder. Optional checks from the repository root:

```sh
npm run check
npm test
npm run build
```

The API currently answers a connector health check. The app’s first request is `/api/runtime-config`, and the API does not serve that yet, so the workspace page can stop on “Unable to verify this runtime.” The address setting is still the one the app will use when that route is available.

## Set the runtime API key

There are two keys.

The website key comes from your profile. Sign in at [https://steelai.dev/signin.html](https://steelai.dev/signin.html), open the email link in the same browser, open **API Key**, and choose **Generate Key**. That key calls `https://steelai.dev/api/v1/status`. Copy it when it is shown. A new key revokes the old one.

The connector needs the runtime key from your runtime owner. Put it in `STEEL_API_KEY` in the terminal that will run the connector. PowerShell:

```powershell
$env:STEEL_API_KEY = 'your-runtime-key'
```

macOS and Linux:

```sh
export STEEL_API_KEY='your-runtime-key'
```

Type the equals sign with no spaces around it. A new terminal needs the key again. Do not commit the key or paste it into chat.

When the model is hosted, set `STEEL_PROVIDER_KEY` in that same terminal. That value is the model provider’s key.

## Connect and confirm

From the repository root, write the connector config. This example uses Muse Wonder and the Steel API.

```sh
node packages/connector/src/cli.js init --server https://api.steelai.dev --provider https://api.meta.ai/v1 --model muse-wonder-1.0 --capabilities assistant.propose,skill.draft,template.draft,template.revise --allow-remote-provider
```

`init` saves `server_base` in your home folder at `.steel-connector/config.json`. It stores the name of the environment variable, not the key itself. Running `init` again replaces that file.

Muse Wonder details are in [packages/connector/MUSE_PROVIDER.md](packages/connector/MUSE_PROVIDER.md).

Confirm the connection in the same terminal where the keys are set:

```sh
node packages/connector/src/cli.js health
```

Read the three lines:

- `config` is `ok` when the file and both required keys are present.
- `steel` is `ok (steel-connector/1)` when the runtime accepts your runtime key.
- `provider` is `ok (openai-compatible /models)` when the model accepts its own key.

`config` fails when `STEEL_API_KEY` or `STEEL_PROVIDER_KEY` is missing from this terminal. `steel` fails with an invalid key when the runtime key is wrong. `steel` fails with a transport error when the address cannot be reached.

Then:

```sh
node packages/connector/src/cli.js compat
```

`supported_here` lists capabilities the API is offering. The API answers the health check and returns no job types yet, so `supported_here` is empty. `run` waits for jobs from the API. Stop it with Ctrl+C. The connector calls out. You do not open a port on your computer.
