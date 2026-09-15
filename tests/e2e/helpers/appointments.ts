import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Empties the appointments between tests.
 *
 * Without it every test in a run shares one agenda: the three-appointment limit
 * of BR-014 would start rejecting fixtures around the fourth test, and the
 * failure would look like a product bug instead of a suite that never cleaned
 * up after itself.
 *
 * Only `appointment` is touched. The configuration is preloaded before the
 * server starts and is cached in it (D-003); clearing it here would leave the
 * server serving a salon that no longer exists.
 */

let pool: Pool | undefined;

export async function resetAppointments(): Promise<void> {
  const connectionString = process.env['DATABASE_URL_TEST'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL_TEST is not set.');
  }

  pool ??= new Pool({ connectionString, max: 2 });
  await pool.query('TRUNCATE appointment RESTART IDENTITY');
}

export async function closeAppointmentsPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** The `Corte` of the seed: 30 minutes, 18,00 €. */
export const CORTE_ID = '00000000-0000-4000-8000-000000000011';

export type SeededAppointment = {
  readonly token: string;
  readonly startsAt: Date;
};

/**
 * Writes an appointment straight into the database.
 *
 * Some states cannot be reached through the screens against a real clock — a
 * completed appointment needs an hour that has already passed. Walking the
 * booking flow for the states that *can* be reached would also spend the per-IP
 * confirmation limit on setup rather than on what is being tested.
 */
export async function seedAppointment(options: {
  readonly startsAt: Date;
  readonly durationMinutes?: number;
  readonly status?: 'CONFIRMED' | 'CANCELLED';
}): Promise<SeededAppointment> {
  const { generate } = await import('../../../src/infrastructure/security/token');
  const { token, hash } = generate();

  const durationMinutes = options.durationMinutes ?? 30;
  const endsAt = new Date(options.startsAt.getTime() + durationMinutes * 60_000);
  const status = options.status ?? 'CONFIRMED';

  const connectionString = process.env['DATABASE_URL_TEST'] ?? '';
  pool ??= new Pool({ connectionString, max: 2 });

  await pool.query(
    `INSERT INTO appointment (
       id, status, starts_at, ends_at, service_id, service_name,
       service_duration_minutes, service_price_cents,
       customer_name, customer_phone, customer_email,
       customer_phone_normalized, customer_email_normalized,
       token_hash, created_at, cancelled_at
     ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'Corte', $5, 1800,
               'Ana López', '600112233', 'ana@example.com',
               '+34600112233', 'ana@example.com', $6, now(), $7)`,
    [
      status,
      options.startsAt,
      endsAt,
      CORTE_ID,
      durationMinutes,
      Buffer.from(hash),
      status === 'CANCELLED' ? new Date() : null,
    ],
  );

  return { token, startsAt: options.startsAt };
}

/** A salon-hours slot a fixed number of days from now, skipping Sundays. */
export function slotDaysFromNow(days: number, hour = 11, minute = 30): Date {
  const target = new Date();
  target.setDate(target.getDate() + days);
  if (target.getDay() === 0) target.setDate(target.getDate() + 1);
  target.setHours(hour, minute, 0, 0);
  return target;
}
