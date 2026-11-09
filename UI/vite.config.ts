import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolveRuntimeTarget } from './runtime-target.mjs';

// React client root: UI/client. Production bundle is served by the existing
// node:http server from UI/public/app (see server.ts delivery routes).
export default defineConfig(({ mode }) => {
  const uiRoot = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, uiRoot, '');
  const runtime = resolveRuntimeTarget(env.STEEL_RUNTIME_URL);
  return {
  root: 'client',
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': runtime,
    },
  },
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  };
});
