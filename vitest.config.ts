import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Unit suite: pure domain, no infrastructure. Runs in milliseconds. */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
