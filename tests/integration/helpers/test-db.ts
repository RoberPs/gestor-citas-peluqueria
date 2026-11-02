import { Pool } from 'pg';
import { migrate } from '../../../scripts/migrate';

/**
 * Integration harness: a real PostgreSQL, never a simulation.
 *
 * The central guarantee of this feature is a database constraint (D-002).
 * Faking it would mean testing the fake.
 */

const connectionString = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? '';

let pool: Pool | undefined;
let migrated = false;

export function testPool(): Pool {
  if (connectionString === '') {
    throw new Error('DATABASE_URL_TEST is not set.');
  }

  pool ??= new Pool({ connectionString, max: 8 });
  return pool;
}

/** Applies the migrations once per process. Safe to call from every suite. */
export async function ensureSchema(): Promise<void> {
  if (migrated) return;
  await migrate(connectionString);
  migrated = true;
}

/**
 * Empties every table the feature writes or reads, so each test starts from a
 * state it fully controls. `schema_migration` is left alone: dropping it would
 * re-run the migrations on every test.
 */
export async function truncateAll(): Promise<void> {
  await testPool().query(
    'TRUNCATE appointment, service, closure, opening_interval, salon RESTART IDENTITY CASCADE',
  );
}

export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/**
 * Empties only the table this feature writes, keeping the preloaded
 * configuration. That is how production behaves: services, opening hours and
 * closures are loaded once and read from then on (FR-007).
 */
export async function truncateAppointments(): Promise<void> {
  await testPool().query('TRUNCATE appointment RESTART IDENTITY');
}
