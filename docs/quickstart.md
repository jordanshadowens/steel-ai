# Quick start

Use Node.js 24.15 or newer. Run these steps from the repository root.

## 1. Configure Steel

Copy `.env.example` to `.env`. On PowerShell, run `Copy-Item .env.example .env`. On macOS or Linux, run `cp .env.example .env`.

```dotenv
STEEL_RUNTIME_URL=https://api.steelai.dev

# Optional connector settings
STEEL_API_KEY=
STEEL_PROVIDER_URL=
STEEL_PROVIDER_KEY=
STEEL_PROVIDER_MODEL=
STEEL_ALLOW_REMOTE_PROVIDER=0
```

For the connector, set `STEEL_PROVIDER_URL` to your model endpoint and `STEEL_PROVIDER_MODEL` to the model name. Leave `STEEL_PROVIDER_KEY` blank if the provider needs no authentication. For a hosted provider, use HTTPS and set `STEEL_ALLOW_REMOTE_PROVIDER=1`.

## 2. Build

```sh
npm ci --ignore-scripts
npm run build
```

The root build produces the web bundle, SDK, and connector.

## 3. Open Steel

```sh
npm run dev
```

Open the `/app/` URL printed in your terminal and sign in.
