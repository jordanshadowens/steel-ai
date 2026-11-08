# Steel AI

[Website](https://steelai.dev/) · [Developer access guide](https://steelai.dev/developer-guide.html) · [Learning Center](https://steelai.dev/learn/) · [Installation guide](INSTALL.md)

Visual workflow authoring, a developer SDK, and a locally installed connector for your own LLM. The server checks proposed calculations and preserves accepted versions for reuse.

## Get an API key

Sign-in is an email link. There is no password.

1. Open [https://steelai.dev/signin.html](https://steelai.dev/signin.html) and enter the email on your account.
2. Open the link Steel sends to that inbox, in the same browser. It expires soon and works once.
3. On your profile, open **API Key**. The key calls `https://steelai.dev/api/v1/status`.
4. Choose **Generate Key** and copy the key immediately. It is shown once. Generating another key revokes the previous one.
5. Keep it in your environment as `STEEL_API_KEY`. Do not commit it. The key tests a connection. It does not run a hosted workflow.

## Install the developer tools

Requires Node.js 24+ and npm. Clone this repository, then:

```sh
npm run setup
npm run check
npm test
npm run build
npm --prefix UI run dev
```

Open the printed `/app/` URL. The UI proxy expects an authorized Steel runtime at `http://127.0.0.1:3100`. Without one, backend features are unavailable. This checkout is the client and integration surface; it does not include the proprietary runtime or native editors.

## Connect your local LLM

The connector runs on YOUR developer machine. No inbound port is required:

```sh
node packages/connector/src/cli.js init --server http://127.0.0.1:3100 --provider http://127.0.0.1:11434/v1 --model YOUR_MODEL
node packages/connector/src/cli.js health
node packages/connector/src/cli.js compat
node packages/connector/src/cli.js run
```

Before health/run, set `STEEL_API_KEY` to a dedicated connector credential supplied by your server owner. Your local provider credential, if needed, goes in `STEEL_PROVIDER_KEY`. Configure the provider's actual OpenAI-compatible base URL; `/v1` is appropriate only if your provider serves it. See [connector setup](packages/connector/QUICKSTART.md) for pairing, scope, configuration and custom adapters. No npm registry publication is claimed; use the checked-out source or install the local package.

Join the developer waitlist or contact us at the website for runtime access.

## Learning Center

The [Learning Center](https://steelai.dev/learn/) is where the longer articles live. [Create an agent and connect it to a workflow](https://steelai.dev/learn/create-an-agent.html) covers the credential and one published version. [Run the deployment agent](https://steelai.dev/learn/deployment-agent.html) walks through verify, build, deploy, health, and recovery. The landing pages themselves stay in the private repository. This client does not include that runtime.

## Workflow Creator

The Creator in this repository can import a workflow JSON draft. Import opens an editable draft; saving and publication approval stay separate. The step list includes **Execute language**, **Recall executions**, **Verify observed source**, and **Verify calculation**.

Draft a `.lang` program with the connector capability `language.draft`. Call a published workflow with [tools/steel-agent.py](tools/steel-agent.py). Both need an authorized runtime and their own credentials. This checkout does not include the runtime.

## Executable language drafting

The source connector supports `language.draft` when the private runtime owner explicitly grants that capability. It returns an untrusted `.lang` source draft; it does not execute code, read your repository, publish a workflow or authorize deployment. Existing credentials are not expanded by updating this checkout. See [connector setup](packages/connector/QUICKSTART.md) for configuration. The current public Creator UI is not claimed to include the latest private runtime authoring controls; use the operator-provided compatible Creator and runtime. Repository connection and autonomous project workflows are not a self-service feature of this public clone yet.

## Repository boundary

This public repository is the local setup installed on the developer machine. The private AI system and hosted website source belong in steel-ai-core. See [repository layout](REPOSITORY_LAYOUT.md) for the boundary and operator checkout locations.

## Components

The public application is React/TypeScript with Redux Toolkit. `packages/sdk` provides the JavaScript client and external contracts. `packages/connector` provides the outbound local-model bridge. The server owns verification, approvals, execution, and persistence. The embedded database/graph memory, interpreter, capability acquisition and repair, and native Document/Spreadsheet/Presentation editors stay private.

## License

Application: AGPL-3.0-only. Standalone SDK and connector: Apache-2.0. See [LICENSING.md](LICENSING.md). Third-party licenses remain intact. Public clients do not grant access to or redistribution rights for the proprietary runtime.

## Invoke workflows and export a verified candidate

The dependency-free Python 3 client in [tools/steel-agent.py](tools/steel-agent.py) lists/invokes published workflows and retrieves exact verified candidates. It uses a dedicated workflow-scoped `STEEL_AGENT_KEY`, separate from the model connector's `STEEL_API_KEY`. Configure the existing authorized runtime origin as `STEEL_AGENT_URL`; HTTPS is required except on loopback. Do not paste keys into chat, commit them or include them in workflow inputs.

```sh
python tools/steel-agent.py list
python tools/steel-agent.py candidate --run-id YOUR_RUN_ID --step verify --source-sha256 EXPECTED_SOURCE_SHA256 --definition-sha256 EXPECTED_DEFINITION_SHA256 --export-root /absolute/private/staging
python -B -m unittest discover -s tools -p test_verified_candidate_client.py -v
```

Use the exact sealed run and successful published verification's hashes. Add `--repository-sha256` when repository-backed. On Windows use an existing absolute path such as `C:\SteelCandidateStaging`. The root must be private to you, outside a working checkout, with no untrusted writers. Permissions are not changed by this client.

The runtime must support the candidate endpoint (private release `a3b72ae` or a compatible successor) and authorize your account/workflow. The client verifies expected identities and bytes, then exports only fixed filenames `candidate.txt` and `manifest.json` under the artifact hash. Repeat exports verify and reuse identical files; modified, incomplete or linked paths fail without overwrite. The returned checksum is not a signature. Candidate code is never run or applied to a repository, and no PR/deployment authority is granted. Recheck hashes before any later use. Interrupted hidden staging directories are not automatically adopted.

This source client needs no private repository access, but runtime provisioning, model pairing and repository grants remain operator-assisted. No fresh-customer end-to-end onboarding, container test backend or autonomous seven-role completion is claimed. Tests use synthetic HTTP identity/evidence and real temporary filesystem writes, including Windows junction rejection.
