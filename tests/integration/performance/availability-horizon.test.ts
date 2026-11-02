import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedHistory } from '../../../db/seed/history';
import { closeTestDb, testPool, truncateAppointments } from '../helpers/test-db';
import { CONTRACT_NOW, CORTE, seedContractDatabase } from '../../contract/helpers/seed-contract-db';

/**
 * SC-005, measured over the real endpoint.
 *
 * The use case already proves the query count and the invariance in isolation.
 * This adds what that cannot see: the HTTP handler, the Zod parse and the
 * serialisation of fourteen days and twenty slots into JSON. If the history
 * were going to show up anywhere, it would show up in the whole round trip.
 */

vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => CONTRACT_NOW },
}));

const { GET } = await import('@/app/api/availability/route');

const HISTORY_SIZE = 10_000;

/** History before the frozen clock, not before the machine's: it must be past for the endpoint too. */
const HISTORY_BEFORE = new Date(CONTRACT_NOW.epochMilliseconds);

function request(): Request {
  const url = new URL('http://localhost/api/availability');
  url.searchParams.set('serviceId', CORTE);
  return new Request(url);
}

/** The mean of several runs: one run measures the machine's mood. */
async function measure(runs = 8): Promise<number> {
  const started = performance.now();
  for (let i = 0; i < runs; i += 1) {
    const response = await GET(request());
    // Reading the body is part of the cost being measured.
    await response.json();
  }
  return (performance.now() - started) / runs;
}

beforeAll(async () => {
  await seedContractDatabase();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAppointments();
});

describe('the past history does not reach the availability endpoint (SC-005)', () => {
  it('answers in the same time with 10.000 past appointments as with none', async () => {
    // Warm up: the first call pays for the pool and the configuration cache.
    await measure(3);

    const emptyAgenda = await measure();

    const inserted = await seedHistory(
      process.env['DATABASE_URL_TEST'] ?? '',
      HISTORY_SIZE,
      HISTORY_BEFORE,
    );
    expect(inserted).toBe(HISTORY_SIZE);

    const withHistory = await measure();

    // Generous on purpose. What this catches is not a 20 % regression but the
    // partial index losing its `WHERE status = 'CONFIRMED'`, which is an order
    // of magnitude — and a tight bound here would fail on a busy CI box for
    // reasons that have nothing to do with the code.
    expect(withHistory).toBeLessThan(emptyAgenda * 3 + 100);
  });

  it('returns the same availability either way', async () => {
    const before = (await (await GET(request())).json()) as {
      days: { date: string; slotCount: number }[];
    };

    await seedHistory(process.env['DATABASE_URL_TEST'] ?? '', 2_000, HISTORY_BEFORE);

    const after = (await (await GET(request())).json()) as {
      days: { date: string; slotCount: number }[];
    };

    // Not one slot moved: the history is in the past and takes no part.
    expect(after.days).toEqual(before.days);
  });

  it('keeps the history in the table, where the salon can still count it', async () => {
    await seedHistory(process.env['DATABASE_URL_TEST'] ?? '', 2_000, HISTORY_BEFORE);

    const { rows } = await testPool().query<{ count: string }>(
      'SELECT count(*) AS count FROM appointment',
    );

    expect(Number(rows[0]?.count)).toBe(2_000);
  });
});
