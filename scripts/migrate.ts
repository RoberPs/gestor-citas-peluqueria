import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

/**
 * Applies the hand-written SQL migrations in order.
 *
 * They are hand-written on purpose (D-008): the load-bearing piece of this
 * schema is an `EXCLUDE USING gist` constraint, and no migration generator
 * models one well. Writing it out makes it explicit, reviewable and versioned.
 */

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'infrastructure',
  'db',
  'migrations',
);

const TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migration (
    name        text        PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`;

export async function listMigrations(): Promise<readonly string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

/**
 * Returns the migrations this run applied. Already applied ones are skipped.
 *
 * `until` stops after that migration, included. It lets a test load data in
 * the shape an older schema had and then watch the next migration carry it over.
 */
export async function migrate(
  connectionString: string,
  options: { readonly until?: string } = {},
): Promise<readonly string[]> {
  const client = new Client({ connectionString });
  await client.connect();

  const applied: string[] = [];
  try {
    await client.query(TRACKING_TABLE);

    const done = await client.query<{ name: string }>('SELECT name FROM schema_migration');
    const already = new Set(done.rows.map((row) => row.name));

    const all = await listMigrations();
    if (options.until !== undefined && !all.includes(options.until)) {
      throw new Error(`Migration ${options.until} does not exist`);
    }

    for (const name of all) {
      if (!already.has(name)) {
        await applyOne(client, name);
        applied.push(name);
      }

      if (name === options.until) break;
    }
  } finally {
    await client.end();
  }

  return applied;
}

async function applyOne(client: Client, name: string): Promise<void> {
  const sql = await readFile(path.join(MIGRATIONS_DIR, name), 'utf8');

  // One transaction per migration: a half-applied constraint is worse than
  // a failed deploy, because the next run would not notice.
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
  } catch (cause) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${name} failed`, { cause });
  }
}

const isCli = process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]));

if (isCli) {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const applied = await migrate(connectionString);
  console.log(
    applied.length === 0
      ? 'No pending migrations.'
      : `Applied ${applied.length} migration(s): ${applied.join(', ')}`,
  );
}
