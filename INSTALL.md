# Developer installation

Website: https://steelai.dev/

## Workflow client and SDK

Install Node.js 24 or newer. From a clone of this repository run `npm run setup`, `npm run check`, `npm test`, and `npm run build`. Use `npm --prefix UI run dev` for the local workflow client. Its `/api` proxy targets `http://127.0.0.1:3100`; the proprietary server is supplied separately. The SDK is in `packages/sdk` and can be installed from that local folder.

## Local model connector (Windows, macOS, Linux)

The connector has no third-party npm dependencies. Run `node packages/connector/src/cli.js version`, or install the local package with `npm install --global ./packages/connector` if you want the `steel-connector` command on PATH. No registry release is required. It runs locally on the developer machine, not in the browser or inside the hosted engine.

1. Obtain a connector-scoped key from the owner of your authorized Steel runtime. A website status-test key is different.
2. Set `STEEL_API_KEY` locally. PowerShell uses `$env:STEEL_API_KEY='your-key'`; POSIX shells use `export STEEL_API_KEY='your-key'`. Use your normal secret manager for persistent configuration; do not commit secrets.
3. Run `node packages/connector/src/cli.js init --server http://127.0.0.1:3100 --provider http://127.0.0.1:11434/v1 --model YOUR_MODEL` (adjust the provider base and model).
4. For a remote server, use HTTPS and explicitly set `allow_remote_server` in `~/.steel-connector/config.json`. Keep your model on loopback unless you explicitly opt into a remote provider. Model credentials remain local.
5. Run `health`, `compat`, then `run`. Stop with Ctrl+C. The connector polls outbound; never open a developer-machine inbound model port for Steel.
6. Request an explicit draft in Creator/Templates/Studio Assistant. Review the result. Drafted skills are checked by the server before saving; pin the verified version and bind inputs before workflow execution.

Connector v1 supports assistant proposals, template draft/revise and explicit skill drafts. Agentic tool-calling chat, streaming/tool-call responses and deferred runtime acquisition are unsupported. Errors do not silently switch models. A passing protocol fixture is not proof that a real LLM produces correct business logic. Qualify your chosen model with synthetic cases and held-out expected results.

## Server and Studio

Steel AI Server and Steel Studio have separate private distribution/build paths. They are not included in this public repository. Windows Studio NSIS/MSI development installers have been built; signing and clean-machine install acceptance remain open. A private Windows server folder is available to the owner but contains readable proprietary code and must not be redistributed as a protected binary. macOS/Linux server packages are not verified releases. Ask through https://steelai.dev/ for supported access rather than downloading third-party binaries.

The public client and connector can be developed on supported Node platforms. That does not establish that every native server/editor platform is ready. The hosted website currently offers a waitlist and connection-test keys; a production per-account workflow sandbox is not yet enabled.

## Muse Wonder as your provider

The connector runs locally and can call Muse Wonder through the Meta API. Follow [Muse provider setup](packages/connector/MUSE_PROVIDER.md) for the configuration and separate Meta/Steel credential references. This hosted-provider option sends draft prompts to Meta; it is not local model inference.

## Workspaces and privacy

See [account and workspace behavior](ACCOUNT_WORKSPACES.md) before connecting multiple developers. Ordinary local mode is one workspace; the website offers private draft storage, not hosted execution.
