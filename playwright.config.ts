import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * E2E suite: one user story per file, plus @axe-core/playwright on every screen.
 * The viewport is 360 px wide because SC-011 is measured there, not scaled down
 * from a desktop layout.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  },
  projects: [
    {
      name: 'mobile-360',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 360, height: 740 },
        isMobile: false,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    // The database is migrated and seeded **before** the server starts.
    // Playwright's readiness probe is itself a request to `/`, and the salon
    // configuration is cached on first read (D-003): seeding afterwards would
    // leave the server serving whatever fixture happened to be in `db-test`.
    command:
      `npm run db:migrate && npm run db:seed && npm run build && ` +
      `npx next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
    env: {
      DATABASE_URL: process.env['DATABASE_URL_TEST'] ?? '',
      SALON_TIMEZONE: process.env['SALON_TIMEZONE'] ?? 'Europe/Madrid',
      RATE_LIMIT_SECRET: process.env['RATE_LIMIT_SECRET'] ?? 'e2e-rate-limit-secret',
      TRUSTED_PROXY_IPS: '127.0.0.1',
      PUBLIC_BASE_URL: BASE_URL,
    },
  },
});
