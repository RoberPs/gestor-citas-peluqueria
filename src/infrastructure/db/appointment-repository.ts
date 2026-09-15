import { Temporal } from '@js-temporal/polyfill';
import { and, asc, eq, gte, isNotNull, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { AppointmentRepository, NewAppointment } from '@/application/ports';
import type { Appointment, BusyInterval } from '@/domain/booking/appointment';
import { err, ok, type Result } from '@/domain/shared/result';
import { appointment, schema } from './schema';

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

function instantOf(value: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

function dateOf(instant: Temporal.Instant): Date {
  return new Date(instant.epochMilliseconds);
}

function toDomain(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    status: row.status,
    startsAt: instantOf(row.startsAt),
    endsAt: instantOf(row.endsAt),
    service: {
      serviceId: row.serviceId,
      name: row.serviceName,
      durationMinutes: row.serviceDurationMinutes,
      priceCents: row.servicePriceCents,
    },
    // Anonymised rows keep the slot and lose the person (BR-018). The three
    // fields go together, so testing one is enough — the database enforces it.
    customer:
      row.customerName === null || row.customerPhone === null || row.customerEmail === null
        ? null
        : { name: row.customerName, phone: row.customerPhone, email: row.customerEmail },
    createdAt: instantOf(row.createdAt),
    cancelledAt: row.cancelledAt === null ? null : instantOf(row.cancelledAt),
    anonymizedAt: row.anonymizedAt === null ? null : instantOf(row.anonymizedAt),
  };
}

function isExclusionViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === EXCLUSION_VIOLATION;
}

export function createAppointmentRepository(getPool: () => Pool): AppointmentRepository {
  const database = () => drizzle(getPool(), { schema });

  return {
    async findByTokenHash(hash) {
      const rows = await database()
        .select()
        .from(appointment)
        .where(and(eq(appointment.tokenHash, Buffer.from(hash)), isNotNull(appointment.tokenHash)))
        .limit(1);

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
        const rows = await database()
          .insert(appointment)
          .values({
            id: input.id,
            status: 'CONFIRMED',
            startsAt: dateOf(input.startsAt),
            endsAt: dateOf(input.endsAt),
            serviceId: input.service.serviceId,
            serviceName: input.service.name,
            serviceDurationMinutes: input.service.durationMinutes,
            servicePriceCents: input.service.priceCents,
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

        const row = rows[0];
        if (row === undefined) throw new Error('INSERT ... RETURNING produced no row');
        return ok(toDomain(row));
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
          .returning();

        const row = rows[0];
        if (row === undefined) throw new Error(`Appointment ${id} is not confirmed`);
        return ok(toDomain(row));
      } catch (error) {
        if (isExclusionViolation(error)) return err('SLOT_TAKEN');
        throw error;
      }
    },

    async cancel(id, at): Promise<Result<Appointment, 'ALREADY_CANCELLED'>> {
      // Guarding on the current status inside the UPDATE makes the second
      // cancellation lose without a read-then-write window (BR-007).
      const rows = await database()
        .update(appointment)
        .set({ status: 'CANCELLED', cancelledAt: dateOf(at) })
        .where(and(eq(appointment.id, id), eq(appointment.status, 'CONFIRMED')))
        .returning();

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
