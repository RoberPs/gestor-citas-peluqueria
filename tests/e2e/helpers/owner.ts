import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { Pool } from 'pg';

/**
 * The owner's side in e2e (002). One account, provisioned by the global setup
 * the way `owner:provision` does it, and a few direct writes for setup: states
 * no screen creates yet, and blocked time a suite needs without going through
 * the form Historia 3 tests on its own.
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

/** A blocked stretch, written straight into the table, as setup for another story. */
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

/**
 * A booking with the name, phone, origin and state a list scenario needs,
 * written straight into the tables: an appointment written by hand, or one
 * the owner cancelled, has no screen yet in this step. One `Corte` each.
 */
export async function insertBooking(options: {
  readonly startsAt: Date;
  readonly name?: string | null;
  readonly phone?: string;
  readonly origin?: 'ONLINE' | 'OWNER';
  readonly cancelledBy?: 'CUSTOMER' | 'OWNER';
  readonly createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  const anonymized = options.name === null;
  const phone = options.phone ?? '600112233';
  const origin = options.origin ?? 'ONLINE';
  const cancelled = options.cancelledBy !== undefined;

  await db().query(
    `WITH inserted AS (
       INSERT INTO appointment (
         id, status, origin, starts_at, ends_at,
         customer_name, customer_phone, customer_email,
         customer_phone_normalized, customer_email_normalized,
         token_hash, created_at, cancelled_at, cancelled_by, anonymized_at
       ) VALUES ($1, $2, $3, $4, $4::timestamptz + interval '30 minutes',
                 $5, $6, NULL, $7, NULL, $8, $9, $10, $11, $12)
       RETURNING id
     )
     INSERT INTO appointment_service
       (appointment_id, position, service_id, name, duration_minutes, price_cents)
     SELECT id, 1, '00000000-0000-4000-8000-000000000011', 'Corte', 30, 1800 FROM inserted`,
    [
      id,
      cancelled ? 'CANCELLED' : 'CONFIRMED',
      origin,
      options.startsAt,
      anonymized ? null : (options.name ?? 'Ana López'),
      anonymized ? null : phone,
      anonymized ? null : `+34${phone}`,
      origin === 'ONLINE' && !anonymized ? randomBytes(32) : null,
      options.createdAt ?? new Date(),
      cancelled ? new Date() : null,
      options.cancelledBy ?? null,
      anonymized ? new Date() : null,
    ],
  );
  return id;
}
