# Steel AI

[Website](https://steelai.dev/) · [Developer access guide](https://steelai.dev/developer-guide.html) · [Installation guide](INSTALL.md)

Visual workflow authoring, a developer SDK, and a locally installed connector for your own LLM. The server checks proposed calculations and preserves accepted versions for reuse.

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

## Executable language drafting

The source connector supports `language.draft` when the private runtime owner explicitly grants that capability. It returns an untrusted `.lang` source draft; it does not execute code, read your repository, publish a workflow or authorize deployment. Existing credentials are not expanded by updating this checkout. See [connector setup](packages/connector/QUICKSTART.md) for configuration. The current public Creator UI is not claimed to include the latest private runtime authoring controls; use the operator-provided compatible Creator and runtime. Repository connection and autonomous project workflows are not a self-service feature of this public clone yet.

## Repository boundary

This public repository is the local setup installed on the developer machine. The private AI system and hosted website source belong in steel-ai-core. See [repository layout](REPOSITORY_LAYOUT.md) for the boundary and operator checkout locations.

## Components

The public application is React/TypeScript with Redux Toolkit. `packages/sdk` provides the JavaScript client and external contracts. `packages/connector` provides the outbound local-model bridge. The server owns verification, approvals, execution, and persistence. The embedded database/graph memory, interpreter, capability acquisition and repair, and native Document/Spreadsheet/Presentation editors stay private.

## License

Application: AGPL-3.0-only. Standalone SDK and connector: Apache-2.0. See [LICENSING.md](LICENSING.md). Third-party licenses remain intact. Public clients do not grant access to or redistribution rights for the proprietary runtime.
