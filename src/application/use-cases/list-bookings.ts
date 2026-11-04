import type { Salon } from '@/domain/catalog/salon';
import {
  parseBookingListQuery,
  type BookingListCursor,
  type BookingListQuery,
  type BookingListQueryError,
} from '@/domain/owner/booking-list';
import { needsConfirmationCall } from '@/domain/notifications/owner-marker';
import type { Clock } from '@/domain/shared/clock';
import { err, ok, type Result } from '@/domain/shared/result';
import type { BookingListPage, BookingListReader, SalonConfigRepository } from '../ports';

/**
 * One page of the owner's bookings list (002, Historia 10). The domain decides
 * the query — defaults, range, search, cursor — with the salon's clock and
 * zone; the reader fetches it in one query.
 */

export type BookingListView = {
  /** The query as decided, so the screen paints the filters without deciding them. */
  readonly query: BookingListQuery;
  readonly page: BookingListPage;
  readonly salon: Salon;
  /** 004, FR-020a: the rows whose confirmation failed and whose client to call. */
  readonly confirmationCalls: ReadonlySet<string>;
};

/** The query as it arrives, before the domain has decided anything about it. */
export type ListBookingsInput = {
  readonly order?: string | undefined;
  readonly status?: string | undefined;
  readonly origin?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly search?: string | undefined;
  readonly after?: BookingListCursor | undefined;
};

export function createListBookings(deps: {
  readonly config: SalonConfigRepository;
  readonly bookings: BookingListReader;
  readonly clock: Clock;
}) {
  return async function listBookings(
    input: ListBookingsInput,
  ): Promise<Result<BookingListView, BookingListQueryError>> {
    const { salon } = await deps.config.load();

    const now = deps.clock.now();
    const query = parseBookingListQuery({ ...input, now, timezone: salon.timezone });
    if (!query.ok) return err(query.error);

    const page = await deps.bookings.readPage(query.value);
    const confirmationCalls = new Set(
      page.rows.filter((row) => needsConfirmationCall(row, row.confirmationDelivery, now)).map((row) => row.id),
    );

    return ok({ query: query.value, page, salon, confirmationCalls });
  };
}
