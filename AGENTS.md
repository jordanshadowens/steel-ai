# Steel AI

Run commands from the repository root. Use Node.js 24.15 or newer.

- Install with `npm ci --ignore-scripts`.
- Build with `npm run build`.
- Verify with `npm run check` and `npm test`.
- Use the root `.env` for local configuration and document supported values in `.env.example`.
- Keep keys in server-side or CLI code. Expose only explicitly public settings to the web app.
- Keep the private runtime outside this repository. Use synthetic inputs in examples and tests.
