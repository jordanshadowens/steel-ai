# Install Steel AI

The website is [https://steelai.dev/](https://steelai.dev/). This repository is the client you run on your computer. The runtime is the service that client calls.

You need Node.js 24 or newer. From a clone of this repository:

```sh
npm run setup
npm run check
npm test
npm run build
```

## Pick staging or production

Use one address.

| Name | Address |
| --- | --- |
| Staging | `https://steel-portal-staging-yl3vqnwyta-uc.a.run.app` |
| Production | `https://steel-runtime-fkknoziyhq-uc.a.run.app` |

Staging is for checking that your client can sign in to the runtime. Production is the live runtime. A runtime on this computer is `http://127.0.0.1:3100`, and the app calls that `local`.

## Set the app’s runtime

Create `UI/.env` if it is not there. One line chooses the runtime:

```
STEEL_RUNTIME_URL=staging
```

Use `production` or `local` when you want those. Start the app from the repository root:

```sh
npm --prefix UI run dev
```

Open the `/app/` address it prints, usually `http://127.0.0.1:5173/app/`. The page on your computer forwards `/api` to the runtime you named. The SDK lives in `packages/sdk` and installs from that folder.

The cloud runtimes currently answer a connector health check. The app’s first request is `/api/runtime-config`, and those runtimes do not serve that yet, so the workspace page can stop on “Unable to verify this runtime.” The address setting is still the one the app will use when that route is available.

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

When the model is hosted, set `STEEL_PROVIDER_KEY` in that same terminal. That value is the model provider’s key. A model running on this computer often needs no provider key.

## Connect and confirm

From the repository root, write the connector config. This example uses staging and Muse Wonder. Production is the same command with `--server https://steel-runtime-fkknoziyhq-uc.a.run.app`.

```sh
node packages/connector/src/cli.js init --server https://steel-portal-staging-yl3vqnwyta-uc.a.run.app --provider https://api.meta.ai/v1 --model muse-wonder-1.0 --capabilities assistant.propose,skill.draft,template.draft,template.revise --allow-remote-provider
```

`init` saves `server_base` in your home folder at `.steel-connector/config.json`. It stores the name of the environment variable, not the key itself. Running `init` again replaces that file.

For a model on this computer, pass its own address and leave off `--allow-remote-provider`:

```sh
node packages/connector/src/cli.js init --server https://steel-portal-staging-yl3vqnwyta-uc.a.run.app --provider http://127.0.0.1:11434/v1 --model YOUR_MODEL --capabilities assistant.propose,skill.draft,template.draft,template.revise
```

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

`supported_here` lists capabilities this runtime is offering. Today the staging and production runtimes answer the health check and return no job types, so `supported_here` is empty. `run` waits for jobs from the runtime. Stop it with Ctrl+C. The connector calls out. You do not open a port on your computer.
