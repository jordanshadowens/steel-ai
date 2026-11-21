import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolveRuntimeTarget } from './runtime-target.mts';
import { localAccountSession } from './local-session.mts';

function readFileSyncIfPresent(path: URL) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export default defineConfig(() => {
  const envFile = new URL('../../.env', import.meta.url);
  const contents = readFileSyncIfPresent(envFile);
  const env = parseEnv(contents);
  const runtime = resolveRuntimeTarget(
    process.env.STEEL_RUNTIME_URL || process.env.STEEL_RUN_TIME_URL ||
    env.STEEL_RUNTIME_URL || env.STEEL_RUN_TIME_URL,
  );
  return {
    root: fileURLToPath(new URL('./client', import.meta.url)),
    envDir: false as const,
    define: {
      'import.meta.env.VITE_STEEL_ENVIRONMENT': JSON.stringify(
        process.env.VITE_STEEL_ENVIRONMENT ?? env.VITE_STEEL_ENVIRONMENT ?? '',
      ),
      'import.meta.env.VITE_STEEL_TRACE_ENABLED': JSON.stringify(
        process.env.VITE_STEEL_TRACE_ENABLED ?? env.VITE_STEEL_TRACE_ENABLED ?? '',
      ),
    },
    base: '/app/',
    plugins: [react(), localAccountSession(runtime)],
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
