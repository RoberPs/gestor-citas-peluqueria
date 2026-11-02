import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Past appointments, in bulk.
 *
 * SC-005 promises that looking up availability does not get slower as the
 * salon's history grows. A promise like that is worth exactly as much as the
 * data you can test it against, so this writes as much of it as you ask for.
 *
 *   npm run db:seed:history -- --appointments 10000
 *
 * The rows are spaced two hours apart going backwards from the start of the day
 * of `before`, so they never overlap and never collide with the exclusion
 * constraint. `before` defaults to now; a test with a frozen clock passes that
 * clock, or the "history" would land in its future. They are
 * `CONFIRMED`, which is the case that matters: a history of cancelled
 * appointments would not be in the partial index and would prove nothing.
 */

const DEFAULT_COUNT = 10_000;

export async function seedHistory(
  connectionString: string,
  count: number,
  before: Date = new Date(),
): Promise<number> {
  const pool = new Pool({ connectionString, max: 2 });

  try {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM service ORDER BY display_order LIMIT 1',
    );
    const serviceId = rows[0]?.id;
    if (serviceId === undefined) {
      throw new Error('No services configured. Run `npm run db:seed` first (FR-007).');
    }

    // One statement. Ten thousand round trips would make seeding slower than
    // the thing being measured.
    const inserted = await pool.query(
      `INSERT INTO appointment (
         id, status, starts_at, ends_at, service_id, service_name,
         service_duration_minutes, service_price_cents,
         customer_name, customer_phone, customer_email,
         customer_phone_normalized, customer_email_normalized, token_hash, created_at
       )
       SELECT gen_random_uuid(), 'CONFIRMED',
              date_trunc('day', $3::timestamptz) - (n * interval '2 hours'),
              date_trunc('day', $3::timestamptz) - (n * interval '2 hours') + interval '30 minutes',
              $1, 'Corte', 30, 1800,
              'Cliente ' || n, '600112233', 'cliente@example.com',
              '+34600112233', 'cliente@example.com',
              decode(md5(random()::text || n::text), 'hex')
                || decode(md5(random()::text || n::text), 'hex'),
              now()
         FROM generate_series(1, $2) AS n`,
      [serviceId, count, before],
    );

    return inserted.rowCount ?? 0;
  } finally {
    await pool.end();
  }
}

function parseCount(argv: readonly string[]): number {
  const flag = argv.indexOf('--appointments');
  if (flag === -1) return DEFAULT_COUNT;

  const value = Number(argv[flag + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('--appointments needs a positive whole number.');
  }

  return value;
}

if (process.argv[1]?.endsWith('history.ts') === true) {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const count = parseCount(process.argv.slice(2));
  const inserted = await seedHistory(connectionString, count);
  console.log(`Seeded ${inserted} past appointments.`);
}
