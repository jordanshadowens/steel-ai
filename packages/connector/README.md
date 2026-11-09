# Steel developer connector (developer connector — not published)

Locally installed SDK + CLI that lets a developer draft Steel candidates
with their OWN LLM. It polls a private Steel AI Server over authenticated
outbound HTTPS, sends the job prompt to the developer's local model, and
submits the model's text back as an untrusted candidate. The server
validates everything; the connector can promote nothing.

- License: Apache-2.0 for this package (see LICENSE/NOTICE).
- Protocol: [PROTOCOL.md](PROTOCOL.md) (`steel-connector/1`).
- Security: [SECURITY.md](SECURITY.md).
- Setup: [INSTALL.md](../../INSTALL.md).

Website: [steelai.dev](https://steelai.dev/). Source installation is available here; no npm registry release is claimed.

## Requirements

- Node.js >= 20 (zero dependencies — no `npm install` needed).
- A Steel API key with connector scope (issued by your Steel Server
  owner; entered explicitly at pairing — the connector never fetches it).
- A local OpenAI-compatible model daemon (default `http://127.0.0.1:11434`),
  or any backend behind a custom adapter (see `examples/`).

## Install (local, no admin)

```powershell
# 1. Copy this folder anywhere you like, e.g. $HOME\steel-connector
#    (no installer, no registry, no services).
# 2. Check it runs:
node src\cli.js version
# 3. Point it at your servers (writes config only — no secrets):
node src\cli.js init --server https://steel-portal-staging-yl3vqnwyta-uc.a.run.app --provider http://127.0.0.1:11434 --model dev-model
```

POSIX shells use `src/cli.js` with forward slashes. `STEEL_CONNECTOR_HOME`
overrides the config dir (default `~/.steel-connector`); all state stays
there — nothing is installed into the Node installation or PATH unless
you link it yourself (`npm link` is optional and unneeded).

## Pair (explicit key entry)

```powershell
# Steel key (typed/pasted by you; stored 0600; never logged):
$env:STEEL_API_KEY = 'paste-steel-key-here'   # option A: shell env (per session)
echo paste-steel-key-here | node src\cli.js pair --steel   # option B: key file
# Local model credential (only when your daemon needs one; stays local):
echo paste-model-key-here | node src\cli.js pair --provider
```

Then tell the config which refs to use (`steel_key` / `provider_key` are
`{env}` or `{file}` refs — values never live in config.json). The CLI
never automates authentication: no browser, no token fetch, no scraping.

## Start / stop

```powershell
node src\cli.js health        # config + steel + provider reachability
node src\cli.js compat        # protocol match + job-type intersection
node src\cli.js run           # foreground loop; Ctrl-C stops cleanly
```

Helper scripts (`scripts/`) daemonize with a pidfile:

- Windows: `scripts\start.ps1` / `scripts\stop.ps1`
- POSIX: `scripts/start.sh` / `scripts/stop.sh`

## Uninstall

Stop the connector, then delete the folder copy. Config, keys, and logs
under the connector home are PRESERVED by default; delete that directory
yourself (`STEEL_CONNECTOR_HOME`) for a full removal.

## Files

- `src/sdk.js` — reusable exports (protocol, config, provider, Connector).
- `src/cli.js` — `steel-connector` command.
- `src/protocol.js`, `src/config.js`, `src/provider.js`, `src/connector.js`.
- `examples/custom-adapter.mjs` — non-OpenAI backend example.
- `test/` — synthetic Steel server + provider fixtures and the protocol
  suite. Fixtures prove transport/auth/validation/refusal only; they
  never claim model inference (`npm test`).

## No-private-import audit

This package must import nothing outside itself and Node built-ins. Re-run:

```powershell
# from the repository root (empty output = clean; ../src/ and ../examples/
# are within-package and allowed):
Select-String -Path public-connector\src\*.js, public-connector\examples\*.mjs -Pattern "from '\.\./(?!(src|examples)/)|require\('\.\./(?!(src|examples)/)"
node --test public-connector\test\test_connector_protocol.mjs  # or npm test
```

An empty first result plus a green suite is the gate. (The suite itself
additionally scans `src/` for `createServer`/`listen(`/`exec`/`spawn` to
prove the connector opens no ports and runs no shell.)
