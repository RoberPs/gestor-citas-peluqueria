import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchableName } from '@/domain/contact/contact';
import { migrate } from '../../../scripts/migrate';

/**
 * 002, T165 and T189: what `0006_appointment_owner_fields.sql` does to the
 * appointments that already exist. Every one of them was booked online, every
 * cancellation was the client's (D-032), and each name gets the searchable form
 * the domain would give it (D-036).
 *
 * Its own database, stopped at 0005, like the 0003 and 0005 tests.
 */

const serverUrl = process.env['DATABASE_URL_TEST'] ?? '';
const databaseName = `migration_0006_${randomBytes(6).toString('hex')}`;
const databaseUrl = withDatabase(serverUrl, databaseName);

const SERVICE = randomUUID();
const CONFIRMED = randomUUID();
const CANCELLED = randomUUID();
const ANONYMIZED = randomUUID();

/** Accents, diaereses, eñes, a cedilla, capitals and doubled spaces. */
const NAMES = ['José  NÚÑEZ', 'Begoña Güell', 'María Jesús Çelik'] as const;
const NAMED = NAMES.map(() => randomUUID());

let client: Client;

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

async function insertOld(
  id: string,
  status: 'CONFIRMED' | 'CANCELLED',
  startsAt: string,
  name: string | null,
): Promise<void> {
  const live = name !== null;
  await client.query(
    `WITH inserted AS (
       INSERT INTO appointment (
         id, status, starts_at, ends_at,
         customer_name, customer_phone, customer_email,
         customer_phone_normalized, customer_email_normalized,
         token_hash, cancelled_at, anonymized_at
       ) VALUES ($1, $2, $3::timestamptz, $3::timestamptz + interval '30 minutes',
                 $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id
     )
     INSERT INTO appointment_service
       (appointment_id, position, service_id, name, duration_minutes, price_cents)
     SELECT id, 1, $12, 'Corte', 30, 1800 FROM inserted`,
    [
      id,
      status,
      startsAt,
      name,
      live ? '600112233' : null,
      live ? 'ana@example.com' : null,
      live ? '+34600112233' : null,
      live ? 'ana@example.com' : null,
      live ? randomBytes(32) : null,
      status === 'CANCELLED' ? '2026-09-10T10:00:00+02:00' : null,
      live ? null : '2026-09-01T03:30:00+02:00',
      SERVICE,
    ],
  );
}

beforeAll(async () => {
  await onServer(`CREATE DATABASE ${databaseName}`);
  await migrate(databaseUrl, { until: '0005_unavailable_period.sql' });

  client = new Client({ connectionString: databaseUrl });
  await client.connect();

  await client.query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Corte', 30, 1800, true, 1)`,
    [SERVICE],
  );

  await insertOld(CONFIRMED, 'CONFIRMED', '2026-09-18T10:00:00+02:00', 'Ana');
  await insertOld(CANCELLED, 'CANCELLED', '2026-09-18T11:00:00+02:00', 'Luis');
  await insertOld(ANONYMIZED, 'CONFIRMED', '2025-01-10T10:00:00+01:00', null);
  for (const [index, name] of NAMES.entries()) {
    await insertOld(NAMED[index] ?? '', 'CONFIRMED', `2026-09-19T1${index}:00:00+02:00`, name);
  }

  await migrate(databaseUrl);
});

afterAll(async () => {
  await client?.end();
  await onServer(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
});

type Row = {
  id: string;
  origin: string;
  cancelled_by: string | null;
  customer_name_search: string | null;
};

async function row(id: string): Promise<Row | undefined> {
  const { rows } = await client.query<Row>(
    'SELECT id, origin, cancelled_by, customer_name_search FROM appointment WHERE id = $1',
    [id],
  );
  return rows[0];
}

describe('0006 carries the existing appointments over (D-026, D-032)', () => {
  it('marks every existing appointment as booked online', async () => {
    const { rows } = await client.query<{ origin: string }>('SELECT DISTINCT origin FROM appointment');

    expect(rows).toEqual([{ origin: 'ONLINE' }]);
  });

  it("records every existing cancellation as the client's, the only way to cancel before 002", async () => {
    expect((await row(CANCELLED))?.cancelled_by).toBe('CUSTOMER');
  });

  it('leaves a confirmed appointment with nobody as its canceller', async () => {
    expect((await row(CONFIRMED))?.cancelled_by).toBeNull();
  });
});

describe('0006 gives every name its searchable form (D-036)', () => {
  it.each(NAMES.map((name, index) => [name, index] as const))(
    'stores %j exactly as searchableName would',
    async (name, index) => {
      expect((await row(NAMED[index] ?? ''))?.customer_name_search).toBe(searchableName(name));
    },
  );

  it('has nothing to compare against in an anonymised appointment', async () => {
    expect((await row(ANONYMIZED))?.customer_name_search).toBeNull();
  });
});

describe('the indexes the bookings list needs (D-033)', () => {
  it.each([['appointment_starts_at_id_idx'], ['appointment_created_at_id_idx']])(
    'creates %s',
    async (name) => {
      const { rows } = await client.query('SELECT 1 FROM pg_indexes WHERE indexname = $1', [name]);

      expect(rows).toHaveLength(1);
    },
  );
});
