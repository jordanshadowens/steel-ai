import { defineConfig } from '@playwright/test';

const port = 5184;
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: './client/e2e',
  testMatch: 'creator-local.spec.ts',
  workers: 1,
  use: {
    baseURL: origin,
    channel: process.env.STEEL_BROWSER_CHANNEL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `${origin}/app/`,
  },
});
