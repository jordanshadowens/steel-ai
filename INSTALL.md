# Install Steel AI

The website is [https://steelai.dev/](https://steelai.dev/). Documentation is [https://steelai.dev/docs](https://steelai.dev/docs). This repository is the client you run on your computer. It connects to the cloud runtime with an API key. You do not install or start a runtime.

You need Node.js 24 or newer for the npm scripts in this repository. The connector file itself runs on Node.js 20 or newer.

## Sign in and create a key

1. Open [https://steelai.dev/signin](https://steelai.dev/signin) and enter the email address for your account.
2. Open the newest message in the same browser. The link works once. You land on [https://steelai.dev/dashboard](https://steelai.dev/dashboard).
3. Create an account key, copy the `steel_api_` value, and store it on the server that will call the API. The website shows it once.
4. Revoke a key from the dashboard when you no longer want it used. A new key does not replace an older one.

The website session is an HttpOnly cookie. Do not send it to `GET /api/v1/identity`. From PowerShell, paste the next command as a single line. A trailing `\` does not continue a line there, and `curl` is an alias for `Invoke-WebRequest`, so `-H` and `-d` are not accepted:

```powershell
Invoke-RestMethod -Method Post -Uri https://steelai.dev/api/dev-keys -Headers @{ Authorization = 'Bearer YOUR_ACCOUNT_KEY' } -ContentType 'application/json' -Body '{"workflowIds":["workflow-id"]}'
```

Call the identity route with the developer key that response returns:

```powershell
Invoke-RestMethod -Uri https://steelai.dev/api/v1/identity -Headers @{ Authorization = 'Bearer YOUR_DEVELOPER_KEY' }
```

On macOS or Linux, `curl.exe` with `-H` and `-d` on one line is the same request.

Those two names are placeholders. `https://steelai.dev` issues the keys. `https://api.steelai.dev` is the cloud runtime those keys call.

## Start the client

From a clone of this repository, install the client once:

```sh
npm run setup
```

Create `UI/.env` if it is not there. The client accepts only this value:

```
STEEL_RUNTIME_URL=https://api.steelai.dev
```

Start the client from the repository root and leave that terminal open:

```sh
npm --prefix UI run dev
```

Open the `/app/` address the command prints. Stop the client with Ctrl+C. Start it again later with `npm --prefix UI run dev`. Run `npm run setup` again only when the client dependencies change.

The dev server forwards `/api` to `https://api.steelai.dev`. That is the cloud runtime. A saved workflow is stored there for the signed-in account. This computer keeps only the unsaved draft in the browser tab.

Optional checks from the repository root:

```sh
npm run check
npm test
npm run build
```

## Connector

The connector calls the same cloud runtime. It uses `STEEL_API_KEY` for `GET /api/connector/v1/health`. That is separate from the website session. Set the key in the terminal that will run the connector:

PowerShell, in the terminal that will run the connector:

```powershell
$env:STEEL_API_KEY = 'your-runtime-key'
```

macOS and Linux:

```sh
export STEEL_API_KEY='your-runtime-key'
```

Type the equals sign with no spaces around it. A new terminal needs the key again. Do not commit the key or paste it into chat.

When the model is hosted, set `STEEL_PROVIDER_KEY` in that same terminal. That value belongs to the model provider.

From the repository root, write the connector config. The server is the cloud runtime:

```sh
node packages/connector/src/cli.js init --server https://api.steelai.dev --provider https://your-model.example/v1 --model your-model --capabilities assistant.propose,skill.draft,template.draft,template.revise --allow-remote-provider
```

`init` saves `server_base` at `.steel-connector/config.json` in your home folder. It stores the name of the environment variable, not the key. Running `init` again replaces that file.

Confirm the connection in the same terminal:

```sh
node packages/connector/src/cli.js health
node packages/connector/src/cli.js compat
```

`config` is `ok` when the file and required keys are present. `steel` is `ok (steel-connector/1)` when that runtime accepts the key. `provider` is `ok` when the model accepts its own key. `supported_here` lists job types that runtime is offering. `run` waits for jobs from that runtime. Stop it with Ctrl+C. The connector calls out. You do not open a port on your computer.

Muse Wonder notes, for a runtime that actually offers that provider, are in [packages/connector/MUSE_PROVIDER.md](packages/connector/MUSE_PROVIDER.md).

## Connect an agent to the cloud runtime

The developer key from `POST /api/dev-keys` is what an agent sends to the cloud runtime. The account key stays on your server and is only used to issue that developer key. Do not put either key in a URL, a prompt, or a file you commit.

In PowerShell, for one terminal:

```powershell
$env:STEEL_AGENT_URL = 'https://api.steelai.dev'
$env:STEEL_AGENT_KEY = 'YOUR_DEVELOPER_KEY'
python tools/steel-agent.py list
```

`list` shows the published workflows that key is allowed to call. Those workflows are the ones saved by Workflow Creator on the cloud runtime. To run one, save an `inputs.json` object that matches that workflow and keep the request id stable for retries:

```powershell
python tools/steel-agent.py run --workflow order_review --version 1 --inputs inputs.json --request-id order42-review-attempt01
python tools/steel-agent.py get --run-id RETURNED_RUN_ID
```

Replace `order_review` and the inputs with a workflow you published. A run can stop at `pending_approval`. This key cannot approve it. Approve it in Workflow Creator, then call `get`.

For the deployment agent, use the same cloud origin and the same developer key. `STEEL_AGENT_URL` is `https://api.steelai.dev`. `STEEL_AGENT_KEY` is the `steel_dev_` key whose workflow list includes the deployment workflow. The agent reads and runs that cloud workflow. It does not create a local runtime or a local workflow database.
