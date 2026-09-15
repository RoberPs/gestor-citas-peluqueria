import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Integration suite: use cases and repositories against a real PostgreSQL
 * (`db-test`). The central guarantee of this feature is a database constraint;
 * simulating it would mean testing the simulation (D-013).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['tests/integration/helpers/load-env.ts'],
    // One database, shared truncation: parallel files would race on it.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
