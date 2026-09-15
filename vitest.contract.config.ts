import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Contract suite: Route Handlers checked against contracts/http-api.yaml. */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/contract/**/*.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['tests/integration/helpers/load-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
