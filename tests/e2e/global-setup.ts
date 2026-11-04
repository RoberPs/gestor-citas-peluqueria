import 'dotenv/config';
import { Client } from 'pg';
import { provisionOwnerAccount } from '../../scripts/provision-owner';
import { startFakeEmailProvider } from '../support/fake-email-provider';
import { E2E_EMAIL_PORT } from './helpers/email';
import { E2E_OWNER } from './helpers/owner';

/**
 * Clears the appointments a previous run left behind, and provisions the
 * owner's account the way `owner:provision` does (002, FR-003).
 *
 * The schema and the preloaded configuration are **not** done here: the server
 * command does them before it starts, because Playwright's readiness probe is a
 * real request and the salon configuration is cached on first read (D-003).
 * Seeding from here would sometimes land after that first read.
 *
 * It also starts the fake email provider the server sends to (004, D-013). The
 * server is already up by then, which is fine: it sends nothing until a test
 * books. The returned function stops the provider when the run ends.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const connectionString = process.env['DATABASE_URL_TEST'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL_TEST is not set. Run `docker compose up -d db-test`.');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE appointment, appointment_service, channel_consent, notification RESTART IDENTITY',
    );
  } finally {
    await client.end();
  }

  const provisioned = await provisionOwnerAccount({ connectionString, ...E2E_OWNER });
  if (!provisioned.ok) throw new Error(`the e2e owner could not be provisioned: ${provisioned.error}`);

  const provider = await startFakeEmailProvider({ port: E2E_EMAIL_PORT });
  return provider.close;
}
