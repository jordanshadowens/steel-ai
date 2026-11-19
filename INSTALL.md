# Install Steel AI

Follow the [quick start](docs/quickstart.md) for the web app, [authentication](docs/authentication.md) for credentials, and [workflows](docs/workflows.md) for the developer CLI.

## Optional connector

Use a runtime that supports `steel-connector/1`. Set `STEEL_RUNTIME_URL`, `STEEL_API_KEY`, `STEEL_PROVIDER_URL`, and `STEEL_PROVIDER_MODEL` in the root `.env`. Set `STEEL_PROVIDER_KEY` if the provider requires authentication. For a hosted provider, set `STEEL_ALLOW_REMOTE_PROVIDER=1` and use HTTPS.

```sh
npm run connector -- health
npm run connector -- compat
npm run connector -- run
```

Stop the foreground connector with Ctrl+C. See the [connector guide](packages/connector/README.md) for standalone installs and [Muse Wonder notes](packages/connector/MUSE_PROVIDER.md) for compatible runtimes.
