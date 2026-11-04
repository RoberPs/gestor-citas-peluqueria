import { Temporal } from '@js-temporal/polyfill';
import { and, asc, eq, getTableColumns, gt, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { AppointmentRepository, NewAppointment } from '@/application/ports';
import type { Appointment, BusyInterval } from '@/domain/booking/appointment';
import type { NonEmptyServiceList } from '@/domain/catalog/selection';
import type { ServiceSnapshot } from '@/domain/catalog/service';
import { err, ok, type Result } from '@/domain/shared/result';
import { appointment, appointmentService, schema } from './schema';

/**
 * The only place that knows this feature stores anything in PostgreSQL.
 *
 * It also owns one translation that matters: the `23P01` exclusion violation
 * becomes `SLOT_TAKEN`. That keeps the database error code inside this layer —
 * the use case gets a domain failure mode and can answer the 409 of FR-012
 * without knowing an exclusion constraint exists.
 */

const EXCLUSION_VIOLATION = '23P01';

type AppointmentRow = typeof appointment.$inferSelect;

/**
 * The appointment's services as one JSON array, in position order, computed in
 * the same statement that reads the appointment (D-011). One appointment is one
 * query; the owner's agenda in 002 inherits a pattern with no N+1 in it.
 */
const servicesOfAppointment = sql<ServiceSnapshot[] | null>`(
  SELECT json_agg(
           json_build_object(
             'serviceId', ${appointmentService.serviceId},
             'name', ${appointmentService.name},
             'durationMinutes', ${appointmentService.durationMinutes},
             'priceCents', ${appointmentService.priceCents}
           ) ORDER BY ${appointmentService.position})
    FROM ${appointmentService}
   WHERE ${appointmentService.appointmentId} = ${appointment.id}
)`;

/** The appointment's columns and its services: one row, one appointment (shared with the bookings list). */
export const withServices = { ...getTableColumns(appointment), services: servicesOfAppointment };

export type AppointmentWithServices = AppointmentRow & { readonly services: ServiceSnapshot[] | null };

function instantOf(value: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

export function dateOf(instant: Temporal.Instant): Date {
  return new Date(instant.epochMilliseconds);
}

function nonEmpty(services: readonly ServiceSnapshot[] | null, id: string): NonEmptyServiceList {
  const [first, ...rest] = services ?? [];
  // Every write goes through `insert`, which stores both in one transaction.
  // Reaching this is a broken database, not a case for the client.
  if (first === undefined) throw new Error(`Appointment ${id} has no services`);
  return [first, ...rest];
}

export function toDomain(row: AppointmentWithServices): Appointment {
  return {
    id: row.id,
    status: row.status,
    origin: row.origin,
    startsAt: instantOf(row.startsAt),
    endsAt: instantOf(row.endsAt),
    services: nonEmpty(row.services, row.id),
    // Anonymised rows keep the slot and lose the person (BR-018). Name and
    // phone go together — the database enforces it — and the email may be
    // missing from a live appointment written by hand (002, FR-024).
    customer:
      row.customerName === null || row.customerPhone === null
        ? null
        : { name: row.customerName, phone: row.customerPhone, email: row.customerEmail },
    createdAt: instantOf(row.createdAt),
    cancelledAt: row.cancelledAt === null ? null : instantOf(row.cancelledAt),
    cancelledBy: row.cancelledBy,
    anonymizedAt: row.anonymizedAt === null ? null : instantOf(row.anonymizedAt),
  };
}

export function isExclusionViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === EXCLUSION_VIOLATION;
}

export function createAppointmentRepository(getPool: () => Pool): AppointmentRepository {
  const database = () => drizzle(getPool(), { schema });

  return {
    async findByTokenHash(hash) {
      const rows = await database()
        .select(withServices)
        .from(appointment)
        .where(and(eq(appointment.tokenHash, Buffer.from(hash)), isNotNull(appointment.tokenHash)))
        .limit(1);

      const row = rows[0];
      return row === undefined ? null : toDomain(row);
    },

    async findById(id) {
      const rows = await database().select(withServices).from(appointment).where(eq(appointment.id, id)).limit(1);
      const row = rows[0];
      return row === undefined ? null : toDomain(row);
    },

    async findConfirmedInWindow(from, to): Promise<readonly BusyInterval[]> {
      // D-003: ONE query for the whole horizon, over a partial index that holds
      // only confirmed appointments. The past history does not take part, which
      // is what makes SC-005 hold as the salon ages.
      const rows = await database()
        .select({ startsAt: appointment.startsAt, endsAt: appointment.endsAt })
        .from(appointment)
        .where(
          and(
            eq(appointment.status, 'CONFIRMED'),
            gte(appointment.startsAt, dateOf(from)),
            lt(appointment.startsAt, dateOf(to)),
          ),
        )
        .orderBy(asc(appointment.startsAt));

      return rows.map((row) => ({ startsAt: instantOf(row.startsAt), endsAt: instantOf(row.endsAt) }));
    },

    async findInWindow(from, to, { includeCancelled }) {
      // ONE query for the window, services included (D-011 of 005, D-027):
      // the agenda of a day never becomes a query per appointment. Touching
      // the window is enough, so one still under way at its start is in.
      const touches = and(lt(appointment.startsAt, dateOf(to)), gt(appointment.endsAt, dateOf(from)));
      const rows = await database()
        .select(withServices)
        .from(appointment)
        .where(includeCancelled ? touches : and(touches, eq(appointment.status, 'CONFIRMED')))
        .orderBy(asc(appointment.startsAt), asc(appointment.id));

      return rows.map(toDomain);
    },

    async countFutureByContact(phone, email, now) {
      // Two counts, one query, and deliberately not their union: the rule is
      // `byPhone >= 3 || byEmail >= 3`. A `WHERE phone = $1 OR email = $2` count
      // would reject someone who has reached neither limit (BR-014).
      const { rows } = await getPool().query<{ by_phone: string; by_email: string }>(
        `SELECT count(*) FILTER (WHERE customer_phone_normalized = $1) AS by_phone,
                count(*) FILTER (WHERE customer_email_normalized = $2) AS by_email
           FROM appointment
          WHERE status = 'CONFIRMED'
            AND starts_at >= $3
            AND (customer_phone_normalized = $1 OR customer_email_normalized = $2)`,
        [phone, email, dateOf(now)],
      );

      return {
        byPhone: Number(rows[0]?.by_phone ?? 0),
        byEmail: Number(rows[0]?.by_email ?? 0),
      };
    },

    async insert(input: NewAppointment): Promise<Result<Appointment, 'SLOT_TAKEN'>> {
      try {
        // One transaction: if the exclusion constraint refuses the appointment,
        // no service row is left behind without it (D-011).
        const row = await database().transaction(async (tx) => {
          const inserted = await tx
            .insert(appointment)
            .values({
              id: input.id,
              status: 'CONFIRMED',
              // The only writer of this method is the online booking; the
              // owner's appointments go through her own writer (002).
              origin: 'ONLINE',
              startsAt: dateOf(input.startsAt),
              endsAt: dateOf(input.endsAt),
              customerName: input.contact.name,
              // What the client typed is kept: it is what the owner reads out
              // when calling. The canonical form is what the count matches on.
              customerPhone: input.contact.phone,
              customerEmail: input.contact.email,
              customerPhoneNormalized: input.contact.normalizedPhone,
              customerEmailNormalized: input.contact.normalizedEmail,
              tokenHash: Buffer.from(input.tokenHash),
              createdAt: dateOf(input.createdAt),
            })
            .returning();

          await tx.insert(appointmentService).values(
            input.services.map((service, index) => ({
              appointmentId: input.id,
              position: index + 1,
              serviceId: service.serviceId,
              name: service.name,
              durationMinutes: service.durationMinutes,
              priceCents: service.priceCents,
            })),
          );

          return inserted[0];
        });

        if (row === undefined) throw new Error('INSERT ... RETURNING produced no row');
        return ok(toDomain({ ...row, services: [...input.services] }));
      } catch (error) {
        if (isExclusionViolation(error)) return err('SLOT_TAKEN');
        throw error;
      }
    },

    async updateSchedule(id, start, end): Promise<Result<Appointment, 'SLOT_TAKEN'>> {
      try {
        // A single UPDATE, not a cancel-and-recreate. That is why the token
        // survives (FR-026) and why a rejected move leaves the original
        // appointment exactly where it was (FR-025, BR-006).
        const rows = await database()
          .update(appointment)
          .set({ startsAt: dateOf(start), endsAt: dateOf(end) })
          .where(and(eq(appointment.id, id), eq(appointment.status, 'CONFIRMED')))
          .returning(withServices);

        const row = rows[0];
        if (row === undefined) throw new Error(`Appointment ${id} is not confirmed`);
        return ok(toDomain(row));
      } catch (error) {
        if (isExclusionViolation(error)) return err('SLOT_TAKEN');
        throw error;
      }
    },

    async cancel(id, at, by): Promise<Result<Appointment, 'ALREADY_CANCELLED'>> {
      // Guarding on the current status inside the UPDATE makes the second
      // cancellation lose without a read-then-write window (BR-007). Who
      // cancelled goes in the same statement, so the two never disagree (D-032).
      const rows = await database()
        .update(appointment)
        .set({ status: 'CANCELLED', cancelledAt: dateOf(at), cancelledBy: by })
        .where(and(eq(appointment.id, id), eq(appointment.status, 'CONFIRMED')))
        .returning(withServices);

      const row = rows[0];
      return row === undefined ? err('ALREADY_CANCELLED') : ok(toDomain(row));
    },
  };
}

/** Rows whose personal data is due for deletion, and the deletion itself (D-012). */
export type PersonalDataPurge = {
  /** FR-035: strips the three fields, their canonical forms and the token hash. */
  anonymizeDueBefore(cutoff: Temporal.Instant): Promise<number>;
  anonymizeOne(id: string): Promise<number>;
  countDueBefore(cutoff: Temporal.Instant): Promise<number>;
  /** Whether that one appointment still holds personal data. */
  countOne(id: string): Promise<number>;
};

const ANONYMIZE_SET = `
  customer_name = NULL, customer_phone = NULL, customer_email = NULL,
  customer_phone_normalized = NULL, customer_email_normalized = NULL,
  token_hash = NULL, anonymized_at = now()
`;

export function createPersonalDataPurge(getPool: () => Pool): PersonalDataPurge {
  return {
    async countDueBefore(cutoff) {
      const { rows } = await getPool().query<{ count: string }>(
        `SELECT count(*) AS count FROM appointment
          WHERE starts_at < $1 AND anonymized_at IS NULL`,
        [dateOf(cutoff)],
      );
      return Number(rows[0]?.count ?? 0);
    },

    async countOne(id) {
      const { rows } = await getPool().query<{ count: string }>(
        `SELECT count(*) AS count FROM appointment
          WHERE id = $1 AND anonymized_at IS NULL`,
        [id],
      );
      return Number(rows[0]?.count ?? 0);
    },

    async anonymizeDueBefore(cutoff) {
      // One statement, so there is no moment in which the appointment is
      // anonymised and the link still resolves (FR-035).
      const { rowCount } = await getPool().query(
        `UPDATE appointment SET ${ANONYMIZE_SET}
          WHERE starts_at < $1 AND anonymized_at IS NULL`,
        [dateOf(cutoff)],
      );
      return rowCount ?? 0;
    },

    async anonymizeOne(id) {
      const { rowCount } = await getPool().query(
        `UPDATE appointment SET ${ANONYMIZE_SET}
          WHERE id = $1 AND anonymized_at IS NULL`,
        [id],
      );
      return rowCount ?? 0;
    },
  };
}
