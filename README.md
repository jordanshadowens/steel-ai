# Steel AI

Build and run workflows with the Steel web app, developer CLI, and TypeScript SDK. The public client connects to a hosted Steel runtime.

## Quick start

Use Node.js 24.15 or newer. From the repository root, copy `.env.example` to `.env`, then run:

```sh
npm ci --ignore-scripts
npm run build
npm run dev
```

Open the `/app/` URL printed in your terminal and sign in. The default runtime URL is already in `.env.example`.

- [Quick start](docs/quickstart.md)
- [Authentication](docs/authentication.md)
- [Run a workflow](docs/workflows.md)
- [Examples](examples/hello-world/README.md) and [custom workflow](examples/custom-workflow/README.md)

See the [repository layout](REPOSITORY_LAYOUT.md) and [licenses](LICENSING.md).
