import { describe, expect, it } from 'vitest';
import {
  BOOKING_LIST_PAGE_SIZE,
  parseBookingListQuery,
  type BookingListQuery,
} from '@/domain/owner/booking-list';
import { at, MADRID } from '../availability/_fixtures';

/**
 * 002, T171: the rules of the bookings list, in one place (FR-061, FR-062,
 * FR-064, FR-069, D-033, D-036). The screen repeats none of them.
 */

const NOW = at('2026-09-15', '10:00');

function parse(input: Parameters<typeof parseBookingListQuery>[0] extends infer I ? Partial<I> : never) {
  return parseBookingListQuery({ now: NOW, timezone: MADRID, ...input });
}

function query(input: Parameters<typeof parse>[0] = {}): BookingListQuery {
  const result = parse(input);
  if (!result.ok) throw new Error(`expected a query, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('the defaults (FR-061, FR-062)', () => {
  it('is upcoming, confirmed, of any origin, with no range and no search, twenty a page', () => {
    expect(query()).toMatchObject({
      order: 'UPCOMING',
      status: 'CONFIRMED',
      origin: 'ALL',
      from: null,
      to: null,
      search: null,
      after: null,
      pageSize: 20,
    });
    expect(BOOKING_LIST_PAGE_SIZE).toBe(20);
  });

  it('starts "upcoming" at the beginning of today in the salon zone, from the injected clock', () => {
    expect(query().startsFrom?.equals(at('2026-09-15', '00:00'))).toBe(true);
    expect(query().startsBefore).toBeNull();
  });

  it('takes the salon midnight, not 24 hours, on the day the clocks go back', () => {
    const result = query({ now: at('2026-10-25', '18:00') });

    expect(result.startsFrom?.equals(at('2026-10-25', '00:00'))).toBe(true);
  });

  it('has no lower bound with "most recent": past appointments are in (FR-061)', () => {
    expect(query({ order: 'RECENT' }).startsFrom).toBeNull();
  });
});

describe('the date range, over the day of the appointment in both orders', () => {
  it('runs from the first day at 00:00 to the end of the last, inclusive', () => {
    const result = query({ order: 'RECENT', from: '2026-09-18', to: '2026-09-19' });

    expect(result.startsFrom?.equals(at('2026-09-18', '00:00'))).toBe(true);
    expect(result.startsBefore?.equals(at('2026-09-20', '00:00'))).toBe(true);
  });

  it('keeps "upcoming" from today when the range starts before it', () => {
    const result = query({ from: '2026-09-01' });

    expect(result.startsFrom?.equals(at('2026-09-15', '00:00'))).toBe(true);
  });

  it('rejects a range that ends before it starts', () => {
    expect(parse({ from: '2026-09-19', to: '2026-09-18' })).toEqual({
      ok: false,
      error: { kind: 'RANGE_REVERSED' },
    });
  });
});

describe('values it does not know', () => {
  it.each([
    [{ order: 'SOON' }, 'order'],
    [{ status: 'DONE' }, 'status'],
    [{ origin: 'PHONE' }, 'origin'],
    [{ from: '2026-02-30' }, 'from'],
    [{ to: 'mañana' }, 'to'],
  ] as const)('rejects %j naming the field', (input, field) => {
    expect(parse(input)).toEqual({ ok: false, error: { kind: 'INVALID_VALUE', field } });
  });

  it('refuses a cursor of one order used with the other: changing order goes back to page one', () => {
    expect(parse({ order: 'RECENT', after: { order: 'UPCOMING', id: 'x' } })).toEqual({
      ok: false,
      error: { kind: 'CURSOR_ORDER_MISMATCH' },
    });
    expect(query({ after: { order: 'UPCOMING', id: 'x' } }).after).toEqual({ order: 'UPCOMING', id: 'x' });
  });
});

describe('the search (FR-069, D-036)', () => {
  it('is no search when empty or blank', () => {
    expect(query({ search: '   ' }).search).toBeNull();
  });

  it.each([['600 11 22 33'], ['+34600112233'], ['0034 600-112-233'], ['600.11.22.33']])(
    'reads %j as the whole phone, without spaces or prefix',
    (search) => {
      expect(query({ search }).search).toEqual({ kind: 'PHONE', phone: '+34600112233' });
    },
  );

  it('asks for the whole number when the digits are not a phone yet', () => {
    expect(parse({ search: '600 11' })).toEqual({
      ok: false,
      error: { kind: 'INVALID_VALUE', field: 'search' },
    });
  });

  it('reads anything else as part of a name, with no case and no accents', () => {
    expect(query({ search: ' José NÚÑEZ ' }).search).toEqual({ kind: 'NAME', fragment: 'jose nunez' });
    expect(query({ search: 'nuñ' }).search).toEqual({ kind: 'NAME', fragment: 'nun' });
  });
});
