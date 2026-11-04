import 'dotenv/config';

/**
 * Points every suite that loads this file at `db-test`, never at `db`.
 *
 * The harness truncates between tests, so aiming this at the development
 * database would wipe it. Overriding `DATABASE_URL` here means application code
 * needs no test-only branch to find the right database.
 */
const testUrl = process.env['DATABASE_URL_TEST'];

if (testUrl === undefined || testUrl === '') {
  throw new Error(
    'DATABASE_URL_TEST is not set. Copy .env.example to .env, fill it in and run ' +
      '`docker compose up -d db-test`.',
  );
}

process.env['DATABASE_URL'] = testUrl;
process.env['SALON_TIMEZONE'] ??= 'Europe/Madrid';
process.env['RATE_LIMIT_SECRET'] ??= 'test-rate-limit-secret';
process.env['TRUSTED_PROXY_IPS'] ??= '';
process.env['PUBLIC_BASE_URL'] ??= 'http://localhost:3000';
// 004, D-013: the channel is off unless a file starts the fake provider, so the
// suites written before 004 run exactly as they did.
process.env['NOTIFICATIONS_EMAIL'] = 'off';
process.env['NOTIFICATIONS_SMS'] = 'off';
