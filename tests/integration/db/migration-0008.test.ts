import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../../scripts/migrate';

/**
 * 004, T007: `0008_notifications.sql`. The two tables and what they refuse,
 * because what the database refuses holds whatever writes (data-model.md). And
 * the appointments that existed before it are left exactly as they were.
 *
 * Its own database, stopped at 0007, like the earlier migration tests.
 */

const serverUrl = process.env['DATABASE_URL_TEST'] ?? '';
const databaseName = `migration_0008_${randomBytes(6).toString('hex')}`;
const databaseUrl = withDatabase(serverUrl, databaseName);

const SERVICE = randomUUID();
const OLD = randomUUID();

let client: Client;
let before: unknown;
/** Each new appointment takes the next hour, so none overlaps another. */
let hour = 0;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function onServer(sql: string): Promise<void> {
  const admin = new Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end();
  }
}

async function snapshotOld(): Promise<unknown> {
  const { rows } = await client.query('SELECT * FROM appointment WHERE id = $1', [OLD]);
  return rows[0];
}

async function newAppointment(): Promise<string> {
  const id = randomUUID();
  hour += 1;
  await client.query(
    `WITH inserted AS (
       INSERT INTO appointment (id, status, starts_at, ends_at, customer_name, customer_phone,
                                customer_email, customer_phone_normalized, customer_email_normalized,
                                token_hash)
       VALUES ($1, 'CONFIRMED', timestamptz '2027-01-01T00:00:00Z' + make_interval(hours => $2),
               timestamptz '2027-01-01T00:30:00Z' + make_interval(hours => $2),
               'Ana', '600112233', 'ana@example.com', '+34600112233', 'ana@example.com', $3)
       RETURNING id
     )
     INSERT INTO appointment_service (appointment_id, position, service_id, name, duration_minutes, price_cents)
     SELECT id, 1, $4, 'Corte', 30, 1800 FROM inserted`,
    [id, hour, randomBytes(32), SERVICE],
  );
  return id;
}

async function rejects(sql: string, params: readonly unknown[]): Promise<string | undefined> {
  try {
    await client.query(sql, [...params]);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

const INSERT_NOTIFICATION = `
  INSERT INTO notification (id, appointment_id, channel, kind, status, skip_reason, attempts,
                            created_at, next_attempt_at, updated_at, sealed_tokens)
  VALUES ($1, $2, 'EMAIL', 'BOOKING_CONFIRMATION', $3, $4, 0, now(), $5, now(), $6)`;

beforeAll(async () => {
  await onServer(`CREATE DATABASE ${databaseName}`);
  await migrate(databaseUrl, { until: '0007_editable_configuration.sql' });

  client = new Client({ connectionString: databaseUrl });
  await client.connect();

  await client.query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Corte', 30, 1800, true, 1)`,
    [SERVICE],
  );
  await client.query(
    `WITH inserted AS (
       INSERT INTO appointment (id, status, starts_at, ends_at, customer_name, customer_phone,
                                customer_email, customer_phone_normalized, customer_email_normalized,
                                token_hash)
       VALUES ($1, 'CONFIRMED', '2026-09-18T10:00:00+02:00', '2026-09-18T10:30:00+02:00',
               'Ana', '600112233', 'ana@example.com', '+34600112233', 'ana@example.com', $2)
       RETURNING id
     )
     INSERT INTO appointment_service (appointment_id, position, service_id, name, duration_minutes, price_cents)
     SELECT id, 1, $3, 'Corte', 30, 1800 FROM inserted`,
    [OLD, randomBytes(32), SERVICE],
  );
  before = await snapshotOld();

  await migrate(databaseUrl);
});

afterAll(async () => {
  await client?.end();
  await onServer(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
});

describe('0008 creates the two tables and their types', () => {
  it.each([['channel_consent'], ['notification']])('creates %s', async (table) => {
    const { rows } = await client.query('SELECT 1 FROM pg_tables WHERE tablename = $1', [table]);
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['notification_channel', ['EMAIL', 'SMS']],
    ['notification_kind', ['BOOKING_CONFIRMATION']],
    ['notification_status', ['PENDING', 'SENT', 'FAILED', 'NOT_SENT']],
    ['notification_skip_reason', ['CONSENT_ENDED', 'APPOINTMENT_CANCELLED', 'PERSONAL_DATA_DELETED']],
    ['consent_end_reason', ['UNSUBSCRIBED', 'EMAIL_CHANGED']],
  ])('creates the type %s', async (type, labels) => {
    const { rows } = await client.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1 ORDER BY e.enumsortorder`,
      [type],
    );
    expect(rows.map((row) => row.label)).toEqual(labels);
  });

  it('leaves the appointments that already existed untouched, with no consent and no notification', async () => {
    expect(await snapshotOld()).toEqual(before);
    const consents = await client.query('SELECT 1 FROM channel_consent');
    const notifications = await client.query('SELECT 1 FROM notification');
    expect(consents.rows).toHaveLength(0);
    expect(notifications.rows).toHaveLength(0);
  });
});

describe('notification refuses what data-model.md forbids', () => {
  it('accepts a pending notification with its tokens and its next attempt', async () => {
    const appointment = await newAppointment();
    expect(
      await rejects(INSERT_NOTIFICATION, [randomUUID(), appointment, 'PENDING', null, new Date(), randomBytes(60)]),
    ).toBeUndefined();
  });

  it.each([['SENT'], ['FAILED']])('refuses sealed tokens on a %s notification (D-002)', async (status) => {
    const appointment = await newAppointment();
    expect(
      await rejects(INSERT_NOTIFICATION, [randomUUID(), appointment, status, null, null, randomBytes(60)]),
    ).toBe('23514');
  });

  it('refuses a next attempt outside PENDING', async () => {
    const appointment = await newAppointment();
    expect(
      await rejects(INSERT_NOTIFICATION, [randomUUID(), appointment, 'SENT', null, new Date(), null]),
    ).toBe('23514');
  });

  it('refuses a pending notification without its tokens', async () => {
    const appointment = await newAppointment();
    expect(
      await rejects(INSERT_NOTIFICATION, [randomUUID(), appointment, 'PENDING', null, new Date(), null]),
    ).toBe('23514');
  });

  it('refuses a NOT_SENT without its reason', async () => {
    const appointment = await newAppointment();
    expect(
      await rejects(INSERT_NOTIFICATION, [randomUUID(), appointment, 'NOT_SENT', null, null, null]),
    ).toBe('23514');
  });

  it('refuses a reason on anything but NOT_SENT', async () => {
    const appointment = await newAppointment();
    expect(
      await rejects(INSERT_NOTIFICATION, [randomUUID(), appointment, 'FAILED', 'CONSENT_ENDED', null, null]),
    ).toBe('23514');
  });

  it('refuses a second confirmation by email for the same appointment (FR-012)', async () => {
    const appointment = await newAppointment();
    await client.query(INSERT_NOTIFICATION, [randomUUID(), appointment, 'SENT', null, null, null]);
    expect(
      await rejects(INSERT_NOTIFICATION, [randomUUID(), appointment, 'SENT', null, null, null]),
    ).toBe('23505');
  });

  it('indexes the pending notifications by their next attempt, for the dispatch', async () => {
    const { rows } = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'notification' AND indexdef LIKE '%next_attempt_at%'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("'PENDING'");
  });
});

describe('channel_consent refuses what data-model.md forbids', () => {
  const INSERT_CONSENT = `
    INSERT INTO channel_consent (appointment_id, channel, granted_at, ended_at, end_reason, unsubscribe_token_hash)
    VALUES ($1, 'EMAIL', now(), $2, $3, $4)`;

  it('accepts a live consent with its 32 byte hash', async () => {
    const appointment = await newAppointment();
    expect(await rejects(INSERT_CONSENT, [appointment, null, null, randomBytes(32)])).toBeUndefined();
  });

  it('refuses an end without its reason', async () => {
    const appointment = await newAppointment();
    expect(await rejects(INSERT_CONSENT, [appointment, new Date(), null, randomBytes(32)])).toBe('23514');
  });

  it('refuses a reason without its end', async () => {
    const appointment = await newAppointment();
    expect(await rejects(INSERT_CONSENT, [appointment, null, 'UNSUBSCRIBED', randomBytes(32)])).toBe('23514');
  });

  it('refuses a hash that is not 32 bytes', async () => {
    const appointment = await newAppointment();
    expect(await rejects(INSERT_CONSENT, [appointment, null, null, randomBytes(31)])).toBe('23514');
  });

  it('refuses two consents with the same unsubscribe hash', async () => {
    const hash = randomBytes(32);
    await client.query(INSERT_CONSENT, [await newAppointment(), null, null, hash]);
    expect(await rejects(INSERT_CONSENT, [await newAppointment(), null, null, hash])).toBe('23505');
  });

  it('goes with its appointment when the appointment is deleted', async () => {
    const appointment = await newAppointment();
    await client.query(INSERT_CONSENT, [appointment, null, null, randomBytes(32)]);
    await client.query('DELETE FROM appointment WHERE id = $1', [appointment]);
    const { rows } = await client.query('SELECT 1 FROM channel_consent WHERE appointment_id = $1', [appointment]);
    expect(rows).toHaveLength(0);
  });
});
