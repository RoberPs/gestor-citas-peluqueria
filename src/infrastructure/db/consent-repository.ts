import { Temporal } from '@js-temporal/polyfill';
import { and, eq, getTableColumns, isNotNull, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { ConsentRepository } from '@/application/ports';
import type { ChannelConsent } from '@/domain/notifications/consent';
import { dateOf } from './appointment-repository';
import { appointment, channelConsent, schema } from './schema';

/** The consents of 004 (D-007). Found by the primary key or by the hash of the unsubscribe token. */

type ConsentRow = typeof channelConsent.$inferSelect;

function instantOf(value: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

function toDomain(row: ConsentRow): ChannelConsent {
  return {
    appointmentId: row.appointmentId,
    channel: row.channel,
    grantedAt: instantOf(row.grantedAt),
    ended:
      row.endedAt === null || row.endReason === null
        ? null
        : { at: instantOf(row.endedAt), reason: row.endReason },
  };
}

export function createConsentRepository(getPool: () => Pool): ConsentRepository {
  const database = () => drizzle(getPool(), { schema });

  return {
    async findByUnsubscribeTokenHash(hash) {
      // Through the unique partial index on the hash. An anonymised appointment
      // has lost its hash in the same statement (FR-021); the join on
      // `anonymized_at` says the same thing a second time, in the query.
      const rows = await database()
        .select(getTableColumns(channelConsent))
        .from(channelConsent)
        .innerJoin(appointment, eq(appointment.id, channelConsent.appointmentId))
        .where(
          and(
            eq(channelConsent.unsubscribeTokenHash, Buffer.from(hash)),
            isNotNull(channelConsent.unsubscribeTokenHash),
            isNull(appointment.anonymizedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : toDomain(row);
    },

    async findForAppointment(appointmentId, channel) {
      const rows = await database()
        .select()
        .from(channelConsent)
        .where(and(eq(channelConsent.appointmentId, appointmentId), eq(channelConsent.channel, channel)))
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : toDomain(row);
    },

    async end(appointmentId, channel, reason, at) {
      // Guarded on `ended_at IS NULL`: a second end loses without a
      // read-then-write window and the first one stands (FR-016).
      await database()
        .update(channelConsent)
        .set({ endedAt: dateOf(at), endReason: reason })
        .where(
          and(
            eq(channelConsent.appointmentId, appointmentId),
            eq(channelConsent.channel, channel),
            isNull(channelConsent.endedAt),
          ),
        );
    },
  };
}
