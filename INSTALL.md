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

## Local Data Designer with PostgreSQL

Install Python 3.10 or later and run `python -m pip install -r apps/web/requirements-designer.txt` from the repository root. Set `DATABASE_URL` in the root `.env` to a PostgreSQL connection URL for your local development database, then restart `npm run dev`. The database role must be able to create the `steel_designer` schema and its tables. Keep the URL server-side and out of source control.

With this setting, the Vite dev server handles Data Designer requests locally. Create a type, define its fields, and publish it before inserting records or querying them. Pydantic validates records against the published schema. The hosted workflow runner still uses its own data store. Local schema changes that require migrating existing records, relationships, and import or export are outside the local backend's current support.
