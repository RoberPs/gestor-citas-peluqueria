import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { Pool } from 'pg';

/**
 * The owner's side in e2e (002). One account, provisioned by the global setup
 * the way `owner:provision` does it, and a few direct writes for the states the
 * screens of this step cannot create yet (a blocked hour, a past day).
 */

export const E2E_OWNER = { username: 'duena', password: 'una contraseña muy larga' } as const;

let pool: Pool | undefined;

function db(): Pool {
  pool ??= new Pool({ connectionString: process.env['DATABASE_URL_TEST'] ?? '', max: 2 });
  return pool;
}

export async function closeOwnerPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Signs in through the API, which shares its cookies with the page's browser context. */
export async function signInAsOwner(page: Page): Promise<void> {
  const response = await page.request.post('/api/gestion/sesion', { data: E2E_OWNER });
  if (response.status() !== 204) throw new Error(`the e2e sign-in answered ${response.status()}`);
}

/** No failed attempts, no lock and no sessions: every test starts signed out. */
export async function resetOwnerAccess(): Promise<void> {
  await db().query(
    'UPDATE owner_account SET failed_attempts = 0, first_failed_attempt_at = NULL, locked_until = NULL',
  );
  await db().query('TRUNCATE owner_session');
}

/** A blocked stretch, written straight into the table (the screen for it is Historia 3). */
export async function insertPeriod(startsAt: Date, endsAt: Date, reason: string | null): Promise<void> {
  await db().query('INSERT INTO unavailable_period (id, starts_at, ends_at, reason) VALUES ($1, $2, $3, $4)', [
    randomUUID(),
    startsAt,
    endsAt,
    reason,
  ]);
}

/** Removes the periods a test added, keeping the seeded holiday. */
export async function resetPeriods(): Promise<void> {
  await db().query("DELETE FROM unavailable_period WHERE id <> '00000000-0000-4000-8000-000000000031'");
}
