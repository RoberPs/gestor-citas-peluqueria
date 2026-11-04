import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
/** Where `global-setup.ts` starts the fake email provider (004, D-013). */
const EMAIL_PORT = Number(process.env['E2E_EMAIL_PORT'] ?? 4011);

/**
 * E2E suite: one user story per file, plus @axe-core/playwright on every screen.
 *
 * Three projects, one per size of the responsive layout (003, D-009):
 * - `mobile-360`: the whole 001 suite at the width SC-011 is measured at.
 * - `desktop-1280`: the same suite again, minus the performance budget and the
 *   tests tagged `@mobile-only`, plus `responsive.spec.ts`, which sets its own
 *   viewport per scenario.
 * - `tablet-768`: the accessibility checks only, so axe sees the middle size.
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
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      name: 'desktop-1280',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        isMobile: false,
        hasTouch: false,
      },
      testIgnore: /performance\.spec\.ts/,
      grepInvert: /@mobile-only/,
    },
    {
      name: 'tablet-768',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
        isMobile: false,
        hasTouch: true,
      },
      testMatch: /accessibility\.spec\.ts/,
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
      // 004, D-013: the whole suite runs with the email channel on, as in
      // production, against the fake provider. The seal key is a fixed test value.
      NOTIFICATIONS_EMAIL: 'on',
      NOTIFICATIONS_SMS: 'off',
      EMAIL_API_BASE_URL: `http://127.0.0.1:${EMAIL_PORT}`,
      EMAIL_API_KEY: 'fake-email-api-key',
      EMAIL_FROM: 'citas@example.test',
      EMAIL_REPLY_TO: '',
      NOTIFICATION_SEAL_KEY: 'ZTJlLW5vdGlmaWNhdGlvbi1zZWFsLWtleS0zMmJ5dGU=',
    },
  },
});
