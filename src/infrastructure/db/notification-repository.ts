import { Temporal } from '@js-temporal/polyfill';
import { and, asc, eq, getTableColumns, lte, type SQL } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type {
  NotificationOutcome,
  NotificationRepository,
  NotificationWork,
  TokenSealer,
} from '@/application/ports';
import type { ChannelConsent } from '@/domain/notifications/consent';
import { dateOf, toDomain, withServices } from './appointment-repository';
import { appointment, channelConsent, notification, schema } from './schema';

/**
 * The outbox of 004 (D-001, D-003).
 *
 * Each notification is worked on inside its own transaction, which holds the
 * row with `FOR UPDATE SKIP LOCKED` for as long as the attempt lasts. The
 * first attempt after the booking and the dispatch command can therefore run
 * at the same time without ever both sending the same email: whoever comes
 * second finds the row locked and moves on (FR-012). With some ten emails a
 * day, a transaction open for the length of one call to the provider (at most
 * its 10 s timeout) costs nothing.
 */

type Database = NodePgDatabase<typeof schema>;

function instantOf(value: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

/** The notification, its appointment with all its services and its consent: one row, one query. */
const workColumns = {
  notification: getTableColumns(notification),
  appointment: withServices,
  consent: {
    channel: channelConsent.channel,
    grantedAt: channelConsent.grantedAt,
    endedAt: channelConsent.endedAt,
    endReason: channelConsent.endReason,
  },
};

function lockedPending(tx: Database, where: SQL | undefined, limit: number) {
  return tx
    .select(workColumns)
    .from(notification)
    .innerJoin(appointment, eq(appointment.id, notification.appointmentId))
    .leftJoin(
      channelConsent,
      and(
        eq(channelConsent.appointmentId, notification.appointmentId),
        eq(channelConsent.channel, notification.channel),
      ),
    )
    .where(and(eq(notification.status, 'PENDING'), where))
    .orderBy(asc(notification.nextAttemptAt), asc(notification.id))
    .limit(limit)
    .for('update', { of: notification, skipLocked: true });
}

type LockedRow = Awaited<ReturnType<typeof lockedPending>>[number];

function workOf(row: LockedRow, sealer: TokenSealer): NotificationWork {
  const consent: ChannelConsent | null =
    row.consent === null
      ? null
      : {
          appointmentId: row.notification.appointmentId,
          channel: row.consent.channel,
          grantedAt: instantOf(row.consent.grantedAt),
          ended:
            row.consent.endedAt === null || row.consent.endReason === null
              ? null
              : { at: instantOf(row.consent.endedAt), reason: row.consent.endReason },
        };

  const sealed = row.notification.sealedTokens;

  return {
    notification: {
      id: row.notification.id,
      appointmentId: row.notification.appointmentId,
      channel: row.notification.channel,
      kind: row.notification.kind,
      attempts: row.notification.attempts,
      createdAt: instantOf(row.notification.createdAt),
    },
    appointment: toDomain(row.appointment),
    consent,
    tokens: sealed === null ? null : sealer.open(sealed),
  };
}

/**
 * Writes what the attempt came to. Every final state drops the sealed tokens
 * and the next attempt in the same UPDATE (D-002); the CHECKs of the table
 * would refuse anything else.
 */
async function record(
  tx: Database,
  work: NotificationWork,
  outcome: NotificationOutcome,
  at: Temporal.Instant,
): Promise<void> {
  const attempts = work.notification.attempts + (outcome.attempted ? 1 : 0);
  const updatedAt = dateOf(at);

  const values =
    outcome.status === 'PENDING'
      ? { attempts, updatedAt, nextAttemptAt: dateOf(outcome.nextAttemptAt) }
      : {
          status: outcome.status,
          skipReason: outcome.status === 'NOT_SENT' ? outcome.reason : null,
          attempts,
          updatedAt,
          nextAttemptAt: null,
          sealedTokens: null,
        };

  await tx.update(notification).set(values).where(eq(notification.id, work.notification.id));
}

export function createNotificationRepository(getPool: () => Pool, sealer: TokenSealer): NotificationRepository {
  const database = () => drizzle(getPool(), { schema });

  /** One transaction: lock the row, decide and attempt, write the outcome. `null` when there was none to take. */
  async function takeOne(
    where: SQL | undefined,
    at: Temporal.Instant,
    fn: (work: NotificationWork) => Promise<NotificationOutcome>,
  ): Promise<NotificationOutcome | null> {
    return database().transaction(async (tx) => {
      const [row] = await lockedPending(tx, where, 1);
      if (row === undefined) return null;

      const work = workOf(row, sealer);
      const outcome = await fn(work);
      await record(tx, work, outcome, at);
      return outcome;
    });
  }

  return {
    withOne(id, at, fn) {
      return takeOne(eq(notification.id, id), at, fn);
    },

    async withDue(now, limit, fn) {
      const outcomes: NotificationOutcome[] = [];
      // One row per transaction, so a slow provider holds one row at a time
      // and a crash loses at most the attempt in flight.
      while (outcomes.length < limit) {
        const outcome = await takeOne(lte(notification.nextAttemptAt, dateOf(now)), now, fn);
        if (outcome === null) break;
        outcomes.push(outcome);
      }
      return outcomes;
    },
  };
}
