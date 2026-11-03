import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../../scripts/migrate';

/**
 * FR-021 and D-001/D-002: the appointments booked before 005 come out of
 * `0003_multiple_services.sql` as appointments of one service, with their hour,
 * duration, price and link untouched.
 *
 * It runs on a database of its own, created on the `db-test` server for this
 * file: the other suites migrate `db-test` all the way up, and this one needs
 * to stop at 0002, load data in that shape and only then migrate the rest.
 */

const serverUrl = process.env['DATABASE_URL_TEST'] ?? '';
const databaseName = `migration_0003_${randomBytes(6).toString('hex')}`;
const databaseUrl = withDatabase(serverUrl, databaseName);

const PRICED = randomUUID();
const UNPRICED = randomUUID();
const CONFIRMED = randomUUID();
const CANCELLED = randomUUID();
const ANONYMIZED = randomUUID();

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

async function sqlStateOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

beforeAll(async () => {
  await onServer(`CREATE DATABASE ${databaseName}`);
  await migrate(databaseUrl, { until: '0002_constraints_and_indexes.sql' });

  client = new Client({ connectionString: databaseUrl });
  await client.connect();

  await client.query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Color', 90, 1800, true, 1), ($2, 'Lavado', 30, 0, true, 2)`,
    [PRICED, UNPRICED],
  );

  // The three states an appointment can be in, written with the 0002 columns.
  await client.query(
    `INSERT INTO appointment (
       id, status, starts_at, ends_at,
       service_id, service_name, service_duration_minutes, service_price_cents,
       customer_name, customer_phone, customer_email,
       customer_phone_normalized, customer_email_normalized,
       token_hash, cancelled_at, anonymized_at
     ) VALUES
       ($1, 'CONFIRMED', '2026-09-18 10:00+02', '2026-09-18 11:30+02',
        $4, 'Color', 90, 1800, 'Ana', '600112233', 'ana@example.com',
        '+34600112233', 'ana@example.com', $6, NULL, NULL),
       ($2, 'CANCELLED', '2026-09-18 12:00+02', '2026-09-18 12:30+02',
        $5, 'Lavado', 30, 0, 'Luis', '600112234', 'luis@example.com',
        '+34600112234', 'luis@example.com', $7, '2026-09-17 10:00+02', NULL),
       ($3, 'CONFIRMED', '2025-01-10 10:00+01', '2025-01-10 11:30+01',
        $4, 'Color', 90, 1800, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-11 03:30+01')`,
    [CONFIRMED, CANCELLED, ANONYMIZED, PRICED, UNPRICED, randomBytes(32), randomBytes(32)],
  );

  await migrate(databaseUrl);
});

afterAll(async () => {
  await client?.end();
  await onServer(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
});

describe('0003 carries every appointment over as one service (FR-021)', () => {
  it('gives each appointment exactly one service row, in position 1, with its snapshot', async () => {
    const { rows } = await client.query<{
      appointment_id: string;
      position: number;
      service_id: string;
      name: string;
      duration_minutes: number;
      price_cents: number | null;
    }>('SELECT * FROM appointment_service ORDER BY appointment_id');

    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.appointment_id))).toEqual(
      new Set([CONFIRMED, CANCELLED, ANONYMIZED]),
    );
    expect(rows.every((row) => row.position === 1)).toBe(true);

    const confirmed = rows.find((row) => row.appointment_id === CONFIRMED);
    expect(confirmed).toMatchObject({
      service_id: PRICED,
      name: 'Color',
      duration_minutes: 90,
      price_cents: 1800,
    });
  });

  it('keeps every appointment as long as the sum of its services', async () => {
    const { rows } = await client.query<{ id: string; minutes: number; total: number }>(
      `SELECT a.id,
              EXTRACT(EPOCH FROM a.ends_at - a.starts_at) / 60 AS minutes,
              sum(s.duration_minutes) AS total
         FROM appointment a JOIN appointment_service s ON s.appointment_id = a.id
        GROUP BY a.id`,
    );

    expect(rows).toHaveLength(3);
    for (const row of rows) expect(Number(row.minutes)).toBe(Number(row.total));
  });

  it('turns every 0 into "no price", in the catalogue and in the snapshots (D-002)', async () => {
    const service = await client.query<{ price_cents: number | null }>(
      'SELECT price_cents FROM service WHERE id = $1',
      [UNPRICED],
    );
    const snapshot = await client.query<{ price_cents: number | null }>(
      'SELECT price_cents FROM appointment_service WHERE appointment_id = $1',
      [CANCELLED],
    );

    expect(service.rows[0]?.price_cents).toBeNull();
    expect(snapshot.rows[0]?.price_cents).toBeNull();
  });

  it('leaves no service column on appointment', async () => {
    const { rows } = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'appointment' AND column_name LIKE 'service%'`,
    );

    expect(rows).toEqual([]);
  });
});

describe('the guarantees 0003 adds', () => {
  it('refuses a price of 0: no price is NULL, never 0 (FR-018)', async () => {
    const code = await sqlStateOf(() =>
      client.query(
        `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
         VALUES ($1, 'Gratis', 30, 0, true, 9)`,
        [randomUUID()],
      ),
    );

    expect(code).toBe('23514');
  });

  it('refuses the same service twice in one appointment (FR-003)', async () => {
    const code = await sqlStateOf(() =>
      client.query(
        `INSERT INTO appointment_service
           (appointment_id, position, service_id, name, duration_minutes, price_cents)
         VALUES ($1, 2, $2, 'Color', 90, 1800)`,
        [CONFIRMED, PRICED],
      ),
    );

    expect(code).toBe('23505');
  });
});
