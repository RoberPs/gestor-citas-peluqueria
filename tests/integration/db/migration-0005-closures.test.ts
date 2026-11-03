import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../../scripts/migrate';

/**
 * 002, T006 and D-019: `0005_unavailable_period.sql` turns every whole-day
 * closure into an unavailable period from 00:00 to 00:00 of the next day **in
 * the salon's zone**, and drops `closure`. The two days the clocks change are
 * where getting this wrong shows: they last 23 and 25 real hours.
 *
 * Like the 0003 test, it runs on a database of its own, stopped at 0004 so the
 * closures can be loaded in the shape they had.
 */

const serverUrl = process.env['DATABASE_URL_TEST'] ?? '';
const databaseName = `migration_0005_${randomBytes(6).toString('hex')}`;
const databaseUrl = withDatabase(serverUrl, databaseName);

const ORDINARY = randomUUID();
const CLOCKS_BACK = randomUUID();
const CLOCKS_FORWARD = randomUUID();

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

type PeriodRow = { id: string; starts_at: string; ends_at: string; hours: string; reason: string | null };

async function period(id: string): Promise<PeriodRow | undefined> {
  const { rows } = await client.query<PeriodRow>(
    `SELECT id,
            to_char(starts_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS starts_at,
            to_char(ends_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS ends_at,
            EXTRACT(EPOCH FROM ends_at - starts_at) / 3600 AS hours,
            reason
       FROM unavailable_period WHERE id = $1`,
    [id],
  );
  return rows[0];
}

beforeAll(async () => {
  await onServer(`CREATE DATABASE ${databaseName}`);
  await migrate(databaseUrl, { until: '0004_owner_account_and_session.sql' });

  client = new Client({ connectionString: databaseUrl });
  await client.connect();

  await client.query(
    `INSERT INTO salon (id, name, address, phone, timezone)
     VALUES ($1, 'Peluquería Aurora', 'Calle Mayor 14', '911 23 45 67', 'Europe/Madrid')`,
    [randomUUID()],
  );
  await client.query(
    `INSERT INTO closure (id, date, reason) VALUES
       ($1, '2026-09-22', 'Festivo local'),
       ($2, '2026-10-25', 'Cambio de hora, atrás'),
       ($3, '2027-03-28', 'Cambio de hora, adelante')`,
    [ORDINARY, CLOCKS_BACK, CLOCKS_FORWARD],
  );

  await migrate(databaseUrl);
});

afterAll(async () => {
  await client?.end();
  await onServer(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
});

describe('0005 carries every closure over as a whole-day period (D-019)', () => {
  it('turns an ordinary closure into 00:00 to 00:00 of the next day, keeping its id and reason', async () => {
    expect(await period(ORDINARY)).toMatchObject({
      starts_at: '2026-09-22 00:00',
      ends_at: '2026-09-23 00:00',
      reason: 'Festivo local',
    });
    expect(Number((await period(ORDINARY))?.hours)).toBe(24);
  });

  it('gives the day the clocks go back its 25 real hours', async () => {
    const row = await period(CLOCKS_BACK);

    expect(row).toMatchObject({ starts_at: '2026-10-25 00:00', ends_at: '2026-10-26 00:00' });
    expect(Number(row?.hours)).toBe(25);
  });

  it('gives the day the clocks go forward its 23 real hours', async () => {
    const row = await period(CLOCKS_FORWARD);

    expect(row).toMatchObject({ starts_at: '2027-03-28 00:00', ends_at: '2027-03-29 00:00' });
    expect(Number(row?.hours)).toBe(23);
  });

  it('drops the closure table', async () => {
    const { rows } = await client.query<{ name: string | null }>(
      `SELECT to_regclass('public.closure')::text AS name`,
    );

    expect(rows[0]?.name).toBeNull();
  });
});

describe('the guarantees 0005 adds', () => {
  it('refuses a period that does not end after it starts (FR-023)', async () => {
    const code = await sqlStateOf(() =>
      client.query(
        `INSERT INTO unavailable_period (id, starts_at, ends_at, reason)
         VALUES ($1, '2026-09-18 14:00+02', '2026-09-18 14:00+02', NULL)`,
        [randomUUID()],
      ),
    );

    expect(code).toBe('23514');
  });

  it('accepts two periods that overlap: blocking time twice is harmless (D-019)', async () => {
    const code = await sqlStateOf(() =>
      client.query(
        `INSERT INTO unavailable_period (id, starts_at, ends_at, reason) VALUES
           ($1, '2026-09-18 13:00+02', '2026-09-18 14:00+02', 'Comida'),
           ($2, '2026-09-18 13:30+02', '2026-09-18 15:00+02', NULL)`,
        [randomUUID(), randomUUID()],
      ),
    );

    expect(code).toBeUndefined();
  });

  it('indexes the range itself, so a long period is found by what it touches (D-027)', async () => {
    const { rows } = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'unavailable_period_range_idx'`,
    );

    expect(rows[0]?.indexdef).toMatch(/USING gist \(tstzrange\(starts_at, ends_at, '\[\)'::text\)\)/);
  });
});
