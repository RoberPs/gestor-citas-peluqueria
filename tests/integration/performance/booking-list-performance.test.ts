import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBookingListReader } from '@/infrastructure/db/booking-list-reader';
import { parseBookingListQuery, type BookingListQuery } from '@/domain/owner/booking-list';
import { seedHistory } from '../../../db/seed/history';
import { closeTestDb, testPool, truncateAppointments } from '../helpers/test-db';
import { CONTRACT_NOW, seedContractDatabase } from '../../contract/helpers/seed-contract-db';

/**
 * 002, T175, FR-066, SC-013 and SC-016: a page of the bookings list is ONE
 * query, services included, with an empty history and with ten thousand
 * appointments, searching by name, by phone or not at all.
 */

function spyingPool(pool: Pool): { pool: Pool; statements: string[] } {
  const statements: string[] = [];
  const proxy = new Proxy(pool, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => {
        statements.push(String(args[0]));
        return (target.query as (...rest: unknown[]) => unknown)(...args);
      };
    },
  });
  return { pool: proxy, statements };
}

function queryOf(input: { order?: string; status?: string; search?: string }): BookingListQuery {
  const result = parseBookingListQuery({ ...input, now: CONTRACT_NOW, timezone: 'Europe/Madrid' });
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

const QUERIES = [
  queryOf({}),
  queryOf({ order: 'RECENT', status: 'ALL' }),
  queryOf({ order: 'RECENT', search: 'cliente 12' }),
  queryOf({ search: '600 11 22 33' }),
];

async function statementsPerPage(): Promise<readonly number[]> {
  const counts: number[] = [];
  for (const query of QUERIES) {
    const spy = spyingPool(testPool());
    const page = await createBookingListReader(() => spy.pool).readPage(query);
    // Reading the next page costs the same: the cursor is part of the one query.
    if (page.next !== null) {
      await createBookingListReader(() => spy.pool).readPage({ ...query, after: page.next });
      counts.push(spy.statements.length / 2);
    } else {
      counts.push(spy.statements.length);
    }
  }
  return counts;
}

beforeAll(async () => {
  await seedContractDatabase();
});

beforeEach(async () => {
  await truncateAppointments();
});

afterAll(async () => {
  await closeTestDb();
});

describe('a page of the bookings list (FR-066, SC-013)', () => {
  it('is one query with no history at all', async () => {
    expect(await statementsPerPage()).toEqual([1, 1, 1, 1]);
  });

  it('is still one query with ten thousand appointments in the history', async () => {
    await seedHistory(process.env['DATABASE_URL_TEST'] ?? '', 10_000, new Date(CONTRACT_NOW.epochMilliseconds));

    expect(await statementsPerPage()).toEqual([1, 1, 1, 1]);
  });
});
