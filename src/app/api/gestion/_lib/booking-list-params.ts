import type { ListBookingsInput } from '@/application/use-cases/list-bookings';
import type {
  BookingListCursor,
  BookingListOrder,
  BookingListOrigin,
  BookingListQuery,
  BookingListQueryError,
  BookingListStatus,
} from '@/domain/owner/booking-list';
import { messages } from '@/messages/es-ES';
import type { ApiError } from '../../_lib/responses';

/**
 * The bookings list's address, in one place for the Route Handler and the
 * screen (002, D-033): the Spanish values of the URL to and from the domain's,
 * and the opaque cursor. What a missing value means is not decided here — the
 * domain fills in the defaults.
 */

const ORDER = { proximas: 'UPCOMING', recientes: 'RECENT' } as const satisfies Record<string, BookingListOrder>;
const STATUS = {
  confirmadas: 'CONFIRMED',
  canceladas: 'CANCELLED',
  todas: 'ALL',
} as const satisfies Record<string, BookingListStatus>;
const ORIGIN = { online: 'ONLINE', mano: 'OWNER', todos: 'ALL' } as const satisfies Record<string, BookingListOrigin>;

export type BookingListParams = {
  readonly orden?: string | undefined;
  readonly estado?: string | undefined;
  readonly origen?: string | undefined;
  readonly desde?: string | undefined;
  readonly hasta?: string | undefined;
  readonly buscar?: string | undefined;
  readonly despues?: string | undefined;
};

function keyOf<T extends Record<string, string>>(table: T, value: T[keyof T]): keyof T & string {
  return (Object.keys(table) as (keyof T & string)[]).find((key) => table[key] === value) ?? '';
}

function translate<T extends Record<string, string>>(table: T, value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  // An unknown Spanish value travels on as itself, for the domain to refuse.
  return (table as Record<string, string>)[value] ?? value;
}

export function encodeCursor(cursor: BookingListCursor): string {
  return Buffer.from(JSON.stringify({ o: cursor.order, i: cursor.id }), 'utf8').toString('base64url');
}

function decodeCursor(value: string): BookingListCursor | 'INVALID' {
  try {
    const raw = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { o?: unknown; i?: unknown };
    const order = raw.o === 'UPCOMING' || raw.o === 'RECENT' ? raw.o : null;
    const isUuid = typeof raw.i === 'string' && /^[0-9a-f-]{36}$/i.test(raw.i);
    return order !== null && isUuid ? { order, id: raw.i as string } : 'INVALID';
  } catch {
    return 'INVALID';
  }
}

/** The URL's values as the use case takes them, or `INVALID` for a cursor nobody issued. */
export function listInputOf(params: BookingListParams): ListBookingsInput | 'INVALID' {
  const after = params.despues === undefined || params.despues === '' ? undefined : decodeCursor(params.despues);
  if (after === 'INVALID') return 'INVALID';

  return {
    order: translate(ORDER, params.orden),
    status: translate(STATUS, params.estado),
    origin: translate(ORIGIN, params.origen),
    from: params.desde === '' ? undefined : params.desde,
    to: params.hasta === '' ? undefined : params.hasta,
    search: params.buscar,
    after,
  };
}

/** The decided query back in the URL's words, for the response and the filters. */
export function paramsOf(query: BookingListQuery, search: string | undefined) {
  const term = search?.trim() ?? '';
  return {
    orden: keyOf(ORDER, query.order),
    estado: keyOf(STATUS, query.status),
    origen: keyOf(ORIGIN, query.origin),
    desde: query.from?.toString() ?? null,
    hasta: query.to?.toString() ?? null,
    buscar: term === '' ? null : term,
  };
}

/** What to tell the owner for each refusal of the domain. */
export function listErrorOf(error: BookingListQueryError | 'INVALID_CURSOR'): ApiError {
  if (error !== 'INVALID_CURSOR' && error.kind === 'RANGE_REVERSED') {
    return { code: 'RANGE_REVERSED', ...messages.owner.errors.rangeReversed };
  }
  if (error !== 'INVALID_CURSOR' && error.kind === 'INVALID_VALUE' && error.field === 'search') {
    return { code: 'INCOMPLETE_PHONE', ...messages.owner.errors.incompletePhone };
  }
  return { code: 'INVALID_FILTER', ...messages.owner.errors.invalidFilter };
}
