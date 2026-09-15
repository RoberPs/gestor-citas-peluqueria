import 'dotenv/config';
import { Client } from 'pg';

/**
 * Clears the appointments a previous run left behind.
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
    await client.query('TRUNCATE appointment RESTART IDENTITY');
  } finally {
    await client.end();
  }
}
