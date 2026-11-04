import { and, asc, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { BookingListReader } from '@/application/ports';
import type { BookingListQuery } from '@/domain/owner/booking-list';
import { confirmationOfAppointment, toDomainWithDelivery, withServicesAndDelivery } from './appointment-repository';
import { appointment, notification, schema } from './schema';

/**
 * A page of the owner's bookings list in ONE query (002, FR-066, D-033): the
 * appointments with their services, filtered, ordered by a key with the id as
 * tie-break, and one row more than the page to know whether another follows.
 *
 * Keyset, not OFFSET: a booking arriving while the owner turns the page does
 * not shift the rows after it (FR-064). The cursor compares against the last
 * row's own key, read in the same statement, so no timestamp is rounded on its
 * way through the URL.
 */

/** `%`, `_` and `\` are letters to the owner, not patterns. */
function likeEscaped(fragment: string): string {
  return fragment.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function conditionsOf(query: BookingListQuery): SQL[] {
  const conditions: SQL[] = [];

  if (query.status !== 'ALL') conditions.push(eq(appointment.status, query.status));
  if (query.origin !== 'ALL') conditions.push(eq(appointment.origin, query.origin));
  if (query.startsFrom !== null) {
    conditions.push(gte(appointment.startsAt, new Date(query.startsFrom.epochMilliseconds)));
  }
  if (query.startsBefore !== null) {
    conditions.push(lt(appointment.startsAt, new Date(query.startsBefore.epochMilliseconds)));
  }

  // An anonymised appointment has neither column, so it never matches (FR-070).
  if (query.search?.kind === 'PHONE') {
    conditions.push(eq(appointment.customerPhoneNormalized, query.search.phone));
  } else if (query.search?.kind === 'NAME') {
    conditions.push(
      sql`${appointment.customerNameSearch} LIKE ${`%${likeEscaped(query.search.fragment)}%`} ESCAPE '\\'`,
    );
  }

  if (query.after !== null) {
    const cursorId = query.after.id;
    conditions.push(
      query.order === 'UPCOMING'
        ? sql`(${appointment.startsAt}, ${appointment.id}) >
              (SELECT starts_at, id FROM appointment WHERE id = ${cursorId})`
        : sql`(${appointment.createdAt}, ${appointment.id}) <
              (SELECT created_at, id FROM appointment WHERE id = ${cursorId})`,
    );
  }

  return conditions;
}

export function createBookingListReader(getPool: () => Pool): BookingListReader {
  return {
    async readPage(query) {
      const ordering =
        query.order === 'UPCOMING'
          ? [asc(appointment.startsAt), asc(appointment.id)]
          : [desc(appointment.createdAt), desc(appointment.id)];

      const rows = await drizzle(getPool(), { schema })
        .select(withServicesAndDelivery)
        .from(appointment)
        // 004, D-011: the confirmation of each row, in this same query.
        .leftJoin(notification, confirmationOfAppointment)
        .where(and(...conditionsOf(query)))
        .orderBy(...ordering)
        .limit(query.pageSize + 1);

      const page = rows.slice(0, query.pageSize).map(toDomainWithDelivery);
      const last = page.at(-1);

      return {
        rows: page,
        next: rows.length > query.pageSize && last !== undefined ? { order: query.order, id: last.id } : null,
      };
    },
  };
}
