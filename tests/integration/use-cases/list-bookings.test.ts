import { randomBytes, randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createListBookings } from '@/application/use-cases/list-bookings';
import type { Appointment } from '@/domain/booking/appointment';
import type { Clock } from '@/domain/shared/clock';
import { createBookingListReader } from '@/infrastructure/db/booking-list-reader';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { closeTestDb, testPool, truncateAppointments } from '../helpers/test-db';
import {
  COLOR,
  CONTRACT_NOW,
  CORTE,
  LAVADO,
  seedContractDatabase,
} from '../../contract/helpers/seed-contract-db';

/**
 * 002, T173, T193 and T174: the bookings list against a real PostgreSQL — both
 * orders, every filter, the search, and pages that neither repeat nor skip a
 * row (FR-060 to FR-070, D-033, D-036).
 */

const clock: Clock = { now: () => CONTRACT_NOW };
const listBookings = createListBookings({
  config: createSalonConfigRepository(testPool),
  bookings: createBookingListReader(testPool),
  clock,
});

type Row = {
  readonly startsAt: string;
  readonly createdAt?: string;
  readonly status?: 'CONFIRMED' | 'CANCELLED';
  readonly cancelledBy?: 'CUSTOMER' | 'OWNER';
  readonly origin?: 'ONLINE' | 'OWNER';
  readonly name?: string | null;
  readonly phone?: string;
  readonly services?: readonly { id: string; name: string; minutes: number; cents: number | null }[];
};

const CORTE_ROW = { id: CORTE, name: 'Corte', minutes: 30, cents: 1800 };

/** Straight into the tables: an appointment written by hand has no screen yet. */
async function insert(row: Row): Promise<string> {
  const id = randomUUID();
  const services = row.services ?? [CORTE_ROW];
  const minutes = services.reduce((total, service) => total + service.minutes, 0);
  const status = row.status ?? 'CONFIRMED';
  const origin = row.origin ?? 'ONLINE';
  const anonymized = row.name === null;
  const phone = row.phone ?? '600112233';

  await testPool().query(
    `INSERT INTO appointment (
       id, status, origin, starts_at, ends_at,
       customer_name, customer_phone, customer_email,
       customer_phone_normalized, customer_email_normalized,
       token_hash, created_at, cancelled_at, cancelled_by, anonymized_at
     ) VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz + make_interval(mins => $5),
               $6, $7, NULL, $8, NULL, $9, $10, $11, $12, $13)`,
    [
      id,
      status,
      origin,
      row.startsAt,
      minutes,
      anonymized ? null : (row.name ?? 'Ana López'),
      anonymized ? null : phone,
      anonymized ? null : `+34${phone.replace(/\D/g, '')}`,
      origin === 'ONLINE' && !anonymized ? randomBytes(32) : null,
      row.createdAt ?? '2026-09-01T10:00:00Z',
      status === 'CANCELLED' ? '2026-09-10T10:00:00Z' : null,
      status === 'CANCELLED' ? (row.cancelledBy ?? 'CUSTOMER') : null,
      anonymized ? '2026-09-02T03:30:00Z' : null,
    ],
  );
  for (const [index, service] of services.entries()) {
    await testPool().query(
      `INSERT INTO appointment_service
         (appointment_id, position, service_id, name, duration_minutes, price_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, index + 1, service.id, service.name, service.minutes, service.cents],
    );
  }
  return id;
}

async function list(input: Parameters<typeof listBookings>[0] = {}): Promise<readonly Appointment[]> {
  const result = await listBookings(input);
  if (!result.ok) throw new Error(`expected a page, got ${JSON.stringify(result.error)}`);
  return result.value.page.rows;
}

async function ids(input: Parameters<typeof listBookings>[0] = {}): Promise<readonly string[]> {
  return (await list(input)).map((row) => row.id);
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

describe('the two orders (FR-061)', () => {
  it('lists the confirmed ones from today on by default, by their start', async () => {
    const later = await insert({ startsAt: '2026-09-20T08:00:00Z' });
    const sooner = await insert({ startsAt: '2026-09-16T08:00:00Z' });
    // Earlier today counts: "upcoming" starts at the salon's midnight.
    const thisMorning = await insert({ startsAt: '2026-09-15T06:30:00Z' });
    await insert({ startsAt: '2026-09-14T08:00:00Z' });
    await insert({ startsAt: '2026-09-17T08:00:00Z', status: 'CANCELLED' });

    expect(await ids()).toEqual([thisMorning, sooner, later]);
  });

  it('lists the most recent bookings first, past ones included', async () => {
    const old = await insert({ startsAt: '2026-09-01T08:00:00Z', createdAt: '2026-08-20T10:00:00Z' });
    const newest = await insert({ startsAt: '2026-09-25T08:00:00Z', createdAt: '2026-09-14T10:00:00Z' });
    const middle = await insert({ startsAt: '2026-09-18T08:00:00Z', createdAt: '2026-09-05T10:00:00Z' });

    expect(await ids({ order: 'RECENT' })).toEqual([newest, middle, old]);
  });
});

describe('the filters (FR-062, FR-063)', () => {
  it('shows the cancelled ones only when asked, with when and by whom', async () => {
    const confirmed = await insert({ startsAt: '2026-09-18T08:00:00Z' });
    const cancelled = await insert({
      startsAt: '2026-09-18T10:00:00Z',
      status: 'CANCELLED',
      cancelledBy: 'OWNER',
    });

    expect(await ids({ status: 'CANCELLED' })).toEqual([cancelled]);
    expect(await ids({ status: 'ALL' })).toEqual([confirmed, cancelled]);
    const [row] = await list({ status: 'CANCELLED' });
    expect(row?.cancelledBy).toBe('OWNER');
    expect(row?.cancelledAt?.equals(Temporal.Instant.from('2026-09-10T10:00:00Z'))).toBe(true);
  });

  it('filters by origin', async () => {
    const online = await insert({ startsAt: '2026-09-18T08:00:00Z' });
    const byHand = await insert({ startsAt: '2026-09-18T10:00:00Z', origin: 'OWNER' });

    expect(await ids({ origin: 'OWNER' })).toEqual([byHand]);
    expect(await ids({ origin: 'ONLINE' })).toEqual([online]);
  });

  it('applies the range to the day of the appointment, in both orders', async () => {
    const friday = await insert({ startsAt: '2026-09-18T20:00:00Z', createdAt: '2026-09-02T10:00:00Z' });
    await insert({ startsAt: '2026-09-19T08:00:00Z', createdAt: '2026-09-18T10:00:00Z' });
    const pastFriday = await insert({ startsAt: '2026-09-11T08:00:00Z', createdAt: '2026-09-18T12:00:00Z' });

    expect(await ids({ from: '2026-09-18', to: '2026-09-18' })).toEqual([friday]);
    expect(await ids({ order: 'RECENT', from: '2026-09-11', to: '2026-09-18' })).toEqual([pastFriday, friday]);
  });

  it('brings every service of an appointment, in order, in the row', async () => {
    await insert({
      startsAt: '2026-09-18T08:00:00Z',
      services: [CORTE_ROW, { id: COLOR, name: 'Color', minutes: 90, cents: 5500 }, { id: LAVADO, name: 'Lavado', minutes: 30, cents: null }],
    });

    const [row] = await list();
    expect(row?.services.map((service) => service.name)).toEqual(['Corte', 'Color', 'Lavado']);
  });

  it('keeps an anonymised appointment, with no personal data (FR-067)', async () => {
    await insert({ startsAt: '2026-09-18T08:00:00Z', name: null });

    const [row] = await list();
    expect(row?.customer).toBeNull();
  });
});

describe('the search (FR-069, FR-070, SC-016)', () => {
  it('finds a client by any part of the name, whatever the case and the accents', async () => {
    const jose = await insert({ startsAt: '2026-09-18T08:00:00Z', name: 'José Núñez' });
    await insert({ startsAt: '2026-09-18T10:00:00Z', name: 'Ana López', phone: '611223344' });

    for (const search of ['jose', 'NUÑEZ', 'nunez', 'sé nú']) {
      expect(await ids({ search })).toEqual([jose]);
    }
  });

  it('finds a client by the phone written any of three ways', async () => {
    const jose = await insert({ startsAt: '2026-09-18T08:00:00Z', name: 'José', phone: '600112233' });
    await insert({ startsAt: '2026-09-18T10:00:00Z', name: 'Ana', phone: '611223344' });

    for (const search of ['600112233', '+34 600 11 22 33', '0034600112233']) {
      expect(await ids({ search })).toEqual([jose]);
    }
  });

  it('combines with the filters and both orders', async () => {
    await insert({ startsAt: '2026-09-18T08:00:00Z', name: 'José', createdAt: '2026-09-01T10:00:00Z' });
    const cancelled = await insert({
      startsAt: '2026-09-19T08:00:00Z',
      name: 'José',
      status: 'CANCELLED',
      createdAt: '2026-09-03T10:00:00Z',
    });
    await insert({ startsAt: '2026-09-20T08:00:00Z', name: 'Ana', status: 'CANCELLED' });

    expect(await ids({ search: 'jose', status: 'CANCELLED', order: 'RECENT' })).toEqual([cancelled]);
  });

  it('never finds an anonymised appointment (FR-070)', async () => {
    await insert({ startsAt: '2026-09-18T08:00:00Z', name: null });

    expect(await ids({ search: 'ana' })).toEqual([]);
    expect(await ids({ search: '600112233' })).toEqual([]);
  });

  it('treats % and _ in the term as letters, not as patterns', async () => {
    await insert({ startsAt: '2026-09-18T08:00:00Z', name: 'Ana' });

    expect(await ids({ search: '%' })).toEqual([]);
    expect(await ids({ search: '_' })).toEqual([]);
  });
});

describe('paging (FR-064, D-033)', () => {
  async function allPages(input: Parameters<typeof listBookings>[0], between?: () => Promise<void>) {
    const seen: string[] = [];
    let after: Parameters<typeof listBookings>[0]['after'];
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const result = await listBookings({ ...input, ...(after === undefined ? {} : { after }) });
      if (!result.ok) throw new Error('unreachable');
      seen.push(...result.value.page.rows.map((row) => row.id));
      if (result.value.page.next === null) return seen;
      after = result.value.page.next;
      await between?.();
    }
    throw new Error('more pages than expected');
  }

  it('walks 45 appointments in three pages of 20, 20 and 5, without repeating or skipping', async () => {
    const expected: string[] = [];
    for (let index = 0; index < 45; index += 1) {
      expected.push(await insert({ startsAt: `2026-09-${String(16 + (index % 10)).padStart(2, '0')}T${String(7 + Math.floor(index / 10)).padStart(2, '0')}:00:00Z` }));
    }

    const first = await listBookings({});
    if (!first.ok) throw new Error('unreachable');
    expect(first.value.page.rows).toHaveLength(20);

    const seen = await allPages({});
    expect(seen).toHaveLength(45);
    expect(new Set(seen)).toEqual(new Set(expected));
  });

  it('repeats and skips nothing when a booking arrives between two pages, also searching', async () => {
    for (let index = 0; index < 25; index += 1) {
      await insert({
        startsAt: `2026-10-${String(index + 1).padStart(2, '0')}T08:00:00Z`,
        // Microseconds the URL could not carry: the cursor must not need them.
        createdAt: `2026-09-01T10:${String(index).padStart(2, '0')}:00.123456Z`,
        name: 'José',
      });
    }

    let arrivals = 0;
    const seen = await allPages({ order: 'RECENT', search: 'jose' }, async () => {
      arrivals += 1;
      await insert({
        startsAt: `2026-11-${String(arrivals).padStart(2, '0')}T08:00:00Z`,
        createdAt: '2026-09-15T09:00:00Z',
        name: 'José',
      });
    });

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });
});
