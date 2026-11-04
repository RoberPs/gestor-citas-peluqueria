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

    async findById(id) {
      const { rows } = await getPool().query<PeriodRow>(
        'SELECT id, starts_at, ends_at, reason FROM unavailable_period WHERE id = $1',
        [id],
      );
      const row = rows[0];
      return row === undefined ? null : toDomain(row);
    },

    async insert(period) {
      const { rows } = await getPool().query<PeriodRow>(
        `INSERT INTO unavailable_period (id, starts_at, ends_at, reason)
         VALUES ($1, $2, $3, $4)
         RETURNING id, starts_at, ends_at, reason`,
        [period.id, dateOf(period.startsAt), dateOf(period.endsAt), period.reason],
      );
      const row = rows[0];
      if (row === undefined) throw new Error('the INSERT returned no row');
      return toDomain(row);
    },

    async shorten(id, startsAt, endsAt) {
      const { rows } = await getPool().query<PeriodRow>(
        `UPDATE unavailable_period SET starts_at = $2, ends_at = $3
          WHERE id = $1
          RETURNING id, starts_at, ends_at, reason`,
        [id, dateOf(startsAt), dateOf(endsAt)],
      );
      const row = rows[0];
      return row === undefined ? null : toDomain(row);
    },

    async delete(id) {
      const { rowCount } = await getPool().query('DELETE FROM unavailable_period WHERE id = $1', [id]);
      return (rowCount ?? 0) > 0;
    },
  };
}
