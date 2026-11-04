import 'dotenv/config';
import { Client } from 'pg';
import { provisionOwnerAccount } from '../../scripts/provision-owner';
import { E2E_OWNER } from './helpers/owner';

/**
 * Clears the appointments a previous run left behind, and provisions the
 * owner's account the way `owner:provision` does (002, FR-003).
 *
 * The schema and the preloaded configuration are **not** done here: the server
 * command does them before it starts, because Playwright's readiness probe is a
 * real request and the salon configuration is cached on first read (D-003).
 * Seeding from here would sometimes land after that first read.
 */
export default async function globalSetup(): Promise<void> {
  const connectionString = process.env['DATABASE_URL_TEST'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL_TEST is not set. Run `docker compose up -d db-test`.');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('TRUNCATE appointment, appointment_service RESTART IDENTITY');
  } finally {
    await client.end();
  }

  const provisioned = await provisionOwnerAccount({ connectionString, ...E2E_OWNER });
  if (!provisioned.ok) throw new Error(`the e2e owner could not be provisioned: ${provisioned.error}`);
}
