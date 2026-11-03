import 'dotenv/config';
import { Temporal } from '@js-temporal/polyfill';
import { Pool } from 'pg';
import { holidayDate } from '../../../db/seed/seed';

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
  await pool.query('TRUNCATE appointment, appointment_service RESTART IDENTITY');
}

export async function closeAppointmentsPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** How many appointments and service rows the database holds (005, FR-012). */
export async function countStored(): Promise<{ appointments: number; services: number }> {
  pool ??= new Pool({ connectionString: process.env['DATABASE_URL_TEST'] ?? '', max: 2 });

  const { rows } = await pool.query<{ appointments: string; services: string }>(
    `SELECT (SELECT count(*) FROM appointment) AS appointments,
            (SELECT count(*) FROM appointment_service) AS services`,
  );

  return {
    appointments: Number(rows[0]?.appointments ?? 0),
    services: Number(rows[0]?.services ?? 0),
  };
}

/** The `Corte` of the seed: 30 minutes, 18,00 €. */
export const CORTE_ID = '00000000-0000-4000-8000-000000000011';

export type SeededAppointment = {
  readonly token: string;
  readonly startsAt: Date;
};

/** A service of a seeded appointment, frozen as its snapshot (005, FR-014). */
export type SeededService = {
  readonly id: string;
  readonly name: string;
  readonly minutes: number;
  readonly cents: number | null;
};

/**
 * Writes an appointment straight into the database.
 *
 * Some states cannot be reached through the screens against a real clock — a
 * completed appointment needs an hour that has already passed. Walking the
 * booking flow for the states that *can* be reached would also spend the per-IP
 * confirmation limit on setup rather than on what is being tested.
 *
 * With no `services` it is one `Corte`, the shape migration 0003 leaves every
 * appointment booked before 005 in (FR-021).
 */
export async function seedAppointment(options: {
  readonly startsAt: Date;
  readonly durationMinutes?: number;
  readonly status?: 'CONFIRMED' | 'CANCELLED';
  readonly services?: readonly SeededService[];
}): Promise<SeededAppointment> {
  const { generate } = await import('../../../src/infrastructure/security/token');
  const { token, hash } = generate();

  const services = options.services ?? [
    { id: CORTE_ID, name: 'Corte', minutes: options.durationMinutes ?? 30, cents: 1800 },
  ];
  const durationMinutes = services.reduce((total, service) => total + service.minutes, 0);
  const endsAt = new Date(options.startsAt.getTime() + durationMinutes * 60_000);
  const status = options.status ?? 'CONFIRMED';

  const connectionString = process.env['DATABASE_URL_TEST'] ?? '';
  pool ??= new Pool({ connectionString, max: 2 });

  // The appointment and its service rows, in one statement (005, D-001).
  await pool.query(
    `WITH inserted AS (
       INSERT INTO appointment (
         id, status, starts_at, ends_at,
         customer_name, customer_phone, customer_email,
         customer_phone_normalized, customer_email_normalized,
         token_hash, created_at, cancelled_at
       ) VALUES (gen_random_uuid(), $1, $2, $3,
                 'Ana López', '600112233', 'ana@example.com',
                 '+34600112233', 'ana@example.com', $4, now(), $5)
       RETURNING id
     )
     INSERT INTO appointment_service
       (appointment_id, position, service_id, name, duration_minutes, price_cents)
     SELECT inserted.id, row.position, row.service_id, row.name, row.minutes, row.cents
       FROM inserted,
            unnest($6::uuid[], $7::text[], $8::integer[], $9::integer[])
              WITH ORDINALITY AS row(service_id, name, minutes, cents, position)`,
    [
      status,
      options.startsAt,
      endsAt,
      Buffer.from(hash),
      status === 'CANCELLED' ? new Date() : null,
      services.map((service) => service.id),
      services.map((service) => service.name),
      services.map((service) => service.minutes),
      services.map((service) => service.cents),
    ],
  );

  return { token, startsAt: options.startsAt };
}

/**
 * A slot a fixed number of days from now, at that hour on the salon's clock,
 * skipping the days the seeded salon is closed: Sundays and the seeded holiday.
 *
 * Both the day and the hour are the salon's, never the machine's: on a UTC
 * runner, 11:30 machine time is 12:30 in Madrid, and the screen rightly says so.
 */
export function slotDaysFromNow(days: number, hour = 11, minute = 30): Date {
  const timeZone = salonTimezone();
  const holiday = holidayDate(timeZone);
  let date = Temporal.Now.plainDateISO(timeZone).add({ days });
  while (date.dayOfWeek === 7 || date.toString() === holiday) {
    date = date.add({ days: 1 });
  }
  const startsAt = date.toZonedDateTime({
    timeZone,
    plainTime: new Temporal.PlainTime(hour, minute),
  });
  return new Date(startsAt.epochMilliseconds);
}

/** The salon's wall-clock time, `HH:MM`, at an instant. */
export function salonTimeLabel(at: Date): string {
  const time = Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(
    salonTimezone(),
  );
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

function salonTimezone(): string {
  return process.env['SALON_TIMEZONE'] ?? 'Europe/Madrid';
}
