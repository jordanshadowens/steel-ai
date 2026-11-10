# Steel AI

[Website](https://steelai.dev/) · [Documentation](https://steelai.dev/docs) · [Sign in](https://steelai.dev/signin) · [Installation guide](INSTALL.md)

This repository is the local client, SDK, and connector. The site at [steelai.dev](https://steelai.dev/) issues the API keys. The client and agents connect to the cloud runtime at `https://api.steelai.dev` with those keys. This checkout does not install a runtime.

## Website credentials

Sign in at [https://steelai.dev/signin](https://steelai.dev/signin). Open the newest email link in the same browser. You land on [https://steelai.dev/dashboard](https://steelai.dev/dashboard). That website session is an HttpOnly cookie. It is not an API key.

On the dashboard, create a named account key. Copy the `steel_api_` value when it is shown. It is not shown again. The list then shows a masked identifier, the name, when it was created, when it was last used, when it expires, and revoke. Creating another key does not revoke the previous one.

Use an account key from a server to issue a developer key. In PowerShell, paste this as one command. PowerShell does not continue a line with `\`, and `curl` there is not the curl program:

```powershell
Invoke-RestMethod -Method Post -Uri https://steelai.dev/api/dev-keys -Headers @{ Authorization = 'Bearer YOUR_ACCOUNT_KEY' } -ContentType 'application/json' -Body '{"workflowIds":["workflow-id"]}'
```

macOS, Linux, or `curl.exe`:

```sh
curl.exe https://steelai.dev/api/dev-keys -H "Authorization: Bearer YOUR_ACCOUNT_KEY" -H "Content-Type: application/json" -d "{\"workflowIds\":[\"workflow-id\"]}"
```

A machine calls the identity route with the `steel_dev_` key. Do not send a browser cookie or `Origin` header.

```powershell
Invoke-RestMethod -Uri https://steelai.dev/api/v1/identity -Headers @{ Authorization = 'Bearer YOUR_DEVELOPER_KEY' }
```

`YOUR_ACCOUNT_KEY` and `YOUR_DEVELOPER_KEY` are placeholders. The website also serves `GET /api/health`, `GET /api/account/keys`, and `DELETE /api/account/keys/{id}`. Request and response details are in the [documentation](https://steelai.dev/docs).

## Start the client

You need Node.js 24 or newer.

```sh
npm run setup
```

Create `UI/.env` with this line. The client rejects any other value:

```
STEEL_RUNTIME_URL=https://api.steelai.dev
```

Start the client and leave that terminal open:

```sh
npm --prefix UI run dev
```

Open the `/app/` address the command prints. Vite proxies `/api` to `https://api.steelai.dev`. Saving a workflow stores it on that cloud runtime for your account.

Optional checks from the repository root:

```sh
npm run check
npm test
npm run build
```

## Connector and workflow client

`packages/connector` calls a runtime that speaks `steel-connector/1`, including `GET /api/connector/v1/health`. The public credential API does not implement that protocol. Set `STEEL_API_KEY` only for a runtime your operator provides, and keep it out of git and chat. Pairing is in [packages/connector/README.md](packages/connector/README.md).

[tools/steel-agent.py](tools/steel-agent.py) lists and invokes published workflows when `STEEL_AGENT_URL` is `https://api.steelai.dev` and `STEEL_AGENT_KEY` is the `steel_dev_` key. The deployment agent uses that same cloud origin and key. See [INSTALL.md](INSTALL.md).

## Repository boundary

The private AI system stays in steel-ai-core. See [repository layout](REPOSITORY_LAYOUT.md).

## Components

The public application is React and TypeScript with Redux Toolkit. `packages/sdk` is the JavaScript client. `packages/connector` is the outbound local-model bridge. Verification, approvals, execution, and persistence stay on the server. The embedded database, interpreter, and native editors stay private.

## License

Application: AGPL-3.0-only. Standalone SDK and connector: Apache-2.0. See [LICENSING.md](LICENSING.md). Third-party licenses remain intact. Public clients do not grant access to the proprietary runtime.
