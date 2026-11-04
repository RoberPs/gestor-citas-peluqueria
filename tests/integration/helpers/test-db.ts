import { randomBytes, randomUUID } from 'node:crypto';
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
    'TRUNCATE appointment, service, unavailable_period, opening_interval, salon RESTART IDENTITY CASCADE',
  );
}

export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/**
 * Empties only the table this feature writes, keeping the preloaded
 * configuration. That is how production behaves: services, opening hours and
 * holidays are loaded once and read from then on (FR-007).
 */
export async function truncateAppointments(): Promise<void> {
  // 004: consents and notifications hang off the appointment and go with it.
  await testPool().query(
    'TRUNCATE appointment, appointment_service, channel_consent, notification RESTART IDENTITY',
  );
}

/** The service an appointment written by hand is booked with, as its snapshot. */
export type ServiceRow = {
  readonly serviceId: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly priceCents: number | null;
};

/**
 * Writes one appointment straight into the database, with the one service row
 * every appointment has (005, D-001), in a single statement.
 *
 * `appointment` maps the columns of `appointment` to their values. Tests that
 * check a constraint bypass the application on purpose: a guarantee that only
 * holds because the application is careful is not one.
 */
export async function insertAppointmentRow(
  appointment: Readonly<Record<string, unknown>>,
  service: ServiceRow,
): Promise<void> {
  const columns = Object.keys(appointment);
  const next = columns.length;

  await testPool().query(
    `WITH inserted AS (
       INSERT INTO appointment (${columns.join(', ')})
       VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})
       RETURNING id
     )
     INSERT INTO appointment_service
       (appointment_id, position, service_id, name, duration_minutes, price_cents)
     SELECT id, 1, $${next + 1}::uuid, $${next + 2}::text, $${next + 3}::integer, $${next + 4}::integer
       FROM inserted`,
    [
      ...Object.values(appointment),
      service.serviceId,
      service.name,
      service.durationMinutes,
      service.priceCents,
    ],
  );
}

/**
 * 004: gives an appointment a live email consent and a pending confirmation,
 * straight in the tables, as a booking with the checkbox leaves them. The
 * sealed tokens are opaque here; tests that need to open them book through the
 * use case instead.
 */
export async function insertEmailConfirmation(
  appointmentId: string,
  options: { readonly unsubscribeTokenHash: Uint8Array; readonly status?: 'PENDING' | 'SENT' | 'FAILED' },
): Promise<string> {
  const notificationId = randomUUID();
  const status = options.status ?? 'PENDING';
  const pending = status === 'PENDING';
  await testPool().query(
    `WITH consent AS (
       INSERT INTO channel_consent (appointment_id, channel, granted_at, unsubscribe_token_hash)
       VALUES ($1, 'EMAIL', now(), $2)
     )
     INSERT INTO notification (id, appointment_id, channel, kind, status, attempts, created_at,
                               next_attempt_at, updated_at, sealed_tokens)
     VALUES ($3, $1, 'EMAIL', 'BOOKING_CONFIRMATION', $4, $5, now(), $6, now(), $7)`,
    [
      appointmentId,
      Buffer.from(options.unsubscribeTokenHash),
      notificationId,
      status,
      pending ? 0 : 1,
      pending ? new Date() : null,
      pending ? randomBytes(60) : null,
    ],
  );
  return notificationId;
}
