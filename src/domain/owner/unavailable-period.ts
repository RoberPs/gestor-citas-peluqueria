import { Temporal } from '@js-temporal/polyfill';
import type { BusyInterval } from '../booking/appointment';
import type { UnavailablePeriod } from '../catalog/salon';
import { err, ok, type Result } from '../shared/result';
import { instantFromWallTime, zonedFrom } from '../shared/time';
import { isPastSlot } from './agenda';

/**
 * The owner's blocked time before it is saved (002, Historia 3).
 *
 * One concept for a lunch hour, a holiday and three weeks away (FR-018,
 * D-019). Both ends sit on the 15 minute grid of the salon's wall clock, the
 * start precedes the end (FR-023), and nothing is blocked or shortened once it
 * is over: the past is read-only (BR-009). Deleting one is always allowed,
 * because releasing time takes nothing from anyone.
 */

export const PERIOD_GRANULARITY_MINUTES = 15;

export type PeriodRejection =
  | 'END_NOT_AFTER_START'
  | 'INVALID_GRANULARITY'
  | 'ALREADY_OVER'
  /** Shortening only: the new span reaches outside the old one. */
  | 'NOT_CONTAINED';

type SpanInput = {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly now: Temporal.Instant;
  readonly timezone: string;
};

/** The owner's grid, for periods and for the starts she writes by hand (D-025). */
export function onGrid(instant: Temporal.Instant, timezone: string): boolean {
  const wall = zonedFrom(instant, timezone);
  return (
    wall.minute % PERIOD_GRANULARITY_MINUTES === 0 &&
    wall.second === 0 &&
    wall.millisecond === 0 &&
    wall.microsecond === 0 &&
    wall.nanosecond === 0
  );
}

export function validatePeriod(
  input: SpanInput,
): Result<BusyInterval, Exclude<PeriodRejection, 'NOT_CONTAINED'>> {
  if (Temporal.Instant.compare(input.startsAt, input.endsAt) >= 0) return err('END_NOT_AFTER_START');
  if (!onGrid(input.startsAt, input.timezone) || !onGrid(input.endsAt, input.timezone)) {
    return err('INVALID_GRANULARITY');
  }
  if (isPastSlot(input.endsAt, input.now)) return err('ALREADY_OVER');
  return ok({ startsAt: input.startsAt, endsAt: input.endsAt });
}

/** FR-019: a shorter span inside the old one, under the same rules as a new period. */
export function validateShortening(
  input: SpanInput & { readonly current: UnavailablePeriod },
): Result<BusyInterval, PeriodRejection> {
  if (isPastSlot(input.current.endsAt, input.now)) return err('ALREADY_OVER');

  const span = validatePeriod(input);
  if (!span.ok) return span;

  const inside =
    Temporal.Instant.compare(input.startsAt, input.current.startsAt) >= 0 &&
    Temporal.Instant.compare(input.endsAt, input.current.endsAt) <= 0;
  return inside ? span : err('NOT_CONTAINED');
}

/**
 * From 00:00 of `first` to 00:00 of the day after `last`, in the salon's zone:
 * "del 10 al 17" as one period. The day the clocks change keeps its 23 or 25
 * real hours. A `last` before `first` gives a span `validatePeriod` rejects.
 */
export function wholeDaysOf(
  first: Temporal.PlainDate,
  last: Temporal.PlainDate,
  timezone: string,
): BusyInterval {
  const midnight = new Temporal.PlainTime(0, 0);
  return {
    startsAt: instantFromWallTime(first, midnight, timezone),
    endsAt: instantFromWallTime(last.add({ days: 1 }), midnight, timezone),
  };
}

/** The internal reason is optional: blank is no reason at all (FR-018). */
export function normalizePeriodReason(reason: string | null): string | null {
  const trimmed = reason?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
