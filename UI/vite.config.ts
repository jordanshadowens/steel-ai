import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// React client root: UI/client. Production bundle is served by the existing
// node:http server from UI/public/app (see server.ts delivery routes).
export default defineConfig({
  root: 'client',
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3100',
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
});
