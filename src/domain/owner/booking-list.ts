import { Temporal } from '@js-temporal/polyfill';
import type { AppointmentId } from '../booking/appointment';
import {
  normalizePhone,
  searchableName,
  type NormalizedPhone,
  type SearchableName,
} from '../contact/contact';
import { err, ok, type Result } from '../shared/result';
import { instantFromWallTime, localDateOf } from '../shared/time';

/**
 * The bookings list (002, Historia 10): its defaults, its range, its search and
 * its cursor, decided here and nowhere else (D-033, D-036). The reader only
 * turns a query already decided into SQL; the screen paints what it is given.
 */

export const BOOKING_LIST_PAGE_SIZE = 20;

export type BookingListOrder = 'UPCOMING' | 'RECENT';
export type BookingListStatus = 'CONFIRMED' | 'CANCELLED' | 'ALL';
export type BookingListOrigin = 'ONLINE' | 'OWNER' | 'ALL';

/**
 * The last row seen. Its id is enough: the reader compares against that row's
 * own key, so no timestamp is rounded on its way through the URL and keyset
 * pagination never repeats nor skips a row (FR-064).
 */
export type BookingListCursor = { readonly order: BookingListOrder; readonly id: AppointmentId };

export type BookingListSearch =
  | { readonly kind: 'PHONE'; readonly phone: NormalizedPhone }
  | { readonly kind: 'NAME'; readonly fragment: SearchableName };

export type BookingListQuery = {
  readonly order: BookingListOrder;
  readonly status: BookingListStatus;
  readonly origin: BookingListOrigin;
  /** Salon days, inclusive, over the day of the appointment, as asked. */
  readonly from: Temporal.PlainDate | null;
  readonly to: Temporal.PlainDate | null;
  /** What the reader filters on: `starts_at >= startsFrom` and `< startsBefore`. */
  readonly startsFrom: Temporal.Instant | null;
  readonly startsBefore: Temporal.Instant | null;
  readonly search: BookingListSearch | null;
  readonly after: BookingListCursor | null;
  readonly pageSize: typeof BOOKING_LIST_PAGE_SIZE;
};

export type BookingListQueryError =
  | {
      readonly kind: 'INVALID_VALUE';
      readonly field: 'order' | 'status' | 'origin' | 'from' | 'to' | 'search';
    }
  | { readonly kind: 'RANGE_REVERSED' }
  | { readonly kind: 'CURSOR_ORDER_MISMATCH' };

const ORDERS: readonly BookingListOrder[] = ['UPCOMING', 'RECENT'];
const STATUSES: readonly BookingListStatus[] = ['CONFIRMED', 'CANCELLED', 'ALL'];
const ORIGINS: readonly BookingListOrigin[] = ['ONLINE', 'OWNER', 'ALL'];

/** Only digits, separators and at most a leading `+`: the owner typed a phone. */
const LOOKS_LIKE_PHONE = /^\+?\d+$/;
const PHONE_SEPARATORS = /[\s.-]/g;

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T | null {
  if (value === undefined) return fallback;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function dateOrNull(value: string | undefined): Temporal.PlainDate | null | 'INVALID' {
  if (value === undefined || value === '') return null;
  try {
    return Temporal.PlainDate.from(value, { overflow: 'reject' });
  } catch {
    return 'INVALID';
  }
}

function searchOf(raw: string | undefined): BookingListSearch | null | 'INVALID' {
  const term = raw?.trim() ?? '';
  if (term === '') return null;

  if (LOOKS_LIKE_PHONE.test(term.replace(PHONE_SEPARATORS, ''))) {
    // A phone is compared whole (D-036): «600 11» is asked to be finished
    // rather than answered with an empty list that would read "no bookings".
    const phone = normalizePhone(term);
    return phone.ok ? { kind: 'PHONE', phone: phone.value } : 'INVALID';
  }

  return { kind: 'NAME', fragment: searchableName(term) };
}

function later(a: Temporal.Instant | null, b: Temporal.Instant | null): Temporal.Instant | null {
  if (a === null) return b;
  if (b === null) return a;
  return Temporal.Instant.compare(a, b) >= 0 ? a : b;
}

export function parseBookingListQuery(input: {
  readonly order?: string | undefined;
  readonly status?: string | undefined;
  readonly origin?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly search?: string | undefined;
  readonly after?: BookingListCursor | undefined;
  readonly now: Temporal.Instant;
  readonly timezone: string;
}): Result<BookingListQuery, BookingListQueryError> {
  const order = oneOf(input.order, ORDERS, 'UPCOMING');
  if (order === null) return err({ kind: 'INVALID_VALUE', field: 'order' });
  const status = oneOf(input.status, STATUSES, 'CONFIRMED');
  if (status === null) return err({ kind: 'INVALID_VALUE', field: 'status' });
  const origin = oneOf(input.origin, ORIGINS, 'ALL');
  if (origin === null) return err({ kind: 'INVALID_VALUE', field: 'origin' });

  const from = dateOrNull(input.from);
  if (from === 'INVALID') return err({ kind: 'INVALID_VALUE', field: 'from' });
  const to = dateOrNull(input.to);
  if (to === 'INVALID') return err({ kind: 'INVALID_VALUE', field: 'to' });
  if (from !== null && to !== null && Temporal.PlainDate.compare(from, to) > 0) {
    return err({ kind: 'RANGE_REVERSED' });
  }

  const search = searchOf(input.search);
  if (search === 'INVALID') return err({ kind: 'INVALID_VALUE', field: 'search' });

  const after = input.after ?? null;
  if (after !== null && after.order !== order) return err({ kind: 'CURSOR_ORDER_MISMATCH' });

  const midnight = new Temporal.PlainTime(0, 0);
  const startOf = (date: Temporal.PlainDate) => instantFromWallTime(date, midnight, input.timezone);
  // "Upcoming" is from the start of today on the salon's clock, never the
  // device's; "most recent" has no lower bound, past appointments included.
  const today = order === 'UPCOMING' ? startOf(localDateOf(input.now, input.timezone)) : null;

  return ok({
    order,
    status,
    origin,
    from,
    to,
    startsFrom: later(today, from === null ? null : startOf(from)),
    startsBefore: to === null ? null : startOf(to.add({ days: 1 })),
    search,
    after,
    pageSize: BOOKING_LIST_PAGE_SIZE,
  });
}
