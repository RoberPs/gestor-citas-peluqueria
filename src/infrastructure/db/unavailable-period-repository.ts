import { Temporal } from '@js-temporal/polyfill';
import type { Pool } from 'pg';
import type { UnavailablePeriodRepository } from '@/application/ports';
import type { UnavailablePeriod } from '@/domain/catalog/salon';

/**
 * The owner's blocked time (002, D-019).
 *
 * The overlap test is on the range itself, which is what the GiST index of
 * `0005` covers: a three-week period that began a fortnight ago is found by
 * what it touches, not by its start (D-027). Same half-open `[)` as the
 * appointments' exclusion constraint.
 */

type PeriodRow = {
  readonly id: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly reason: string | null;
};

function instantOf(value: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

function dateOf(instant: Temporal.Instant): Date {
  return new Date(instant.epochMilliseconds);
}

function toDomain(row: PeriodRow): UnavailablePeriod {
  return {
    id: row.id,
    startsAt: instantOf(row.starts_at),
    endsAt: instantOf(row.ends_at),
    reason: row.reason,
  };
}

export function createUnavailablePeriodRepository(
  getPool: () => Pool,
): UnavailablePeriodRepository {
  return {
    async findOverlapping(from, to) {
      const { rows } = await getPool().query<PeriodRow>(
        `SELECT id, starts_at, ends_at, reason
           FROM unavailable_period
          WHERE tstzrange(starts_at, ends_at, '[)') && tstzrange($1, $2, '[)')
          ORDER BY starts_at, id`,
        [dateOf(from), dateOf(to)],
      );

      return rows.map(toDomain);
    },
  };
}
