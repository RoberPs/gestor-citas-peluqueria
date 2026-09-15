import type { Temporal } from '@js-temporal/polyfill';

/**
 * SalonTime — the whole of the feature's calendar arithmetic.
 *
 * Two representations, kept deliberately apart:
 *
 * - An **instant** is an absolute moment. Appointments are stored as instants.
 * - A **wall time** is what the sign on the door says. Opening hours are wall
 *   times: "10:00" means ten in the morning on that date, whatever the offset
 *   of that date happens to be.
 *
 * Mixing them is how a schedule silently shifts by an hour in October.
 */

/**
 * How to resolve a wall time that the calendar makes ambiguous or impossible.
 *
 * `compatible` picks the earlier of the two occurrences of a repeated hour and
 * pushes a skipped hour forward. Salon hours (10:00–20:00) never land in either
 * window, but the policy is stated rather than defaulted: Temporal makes it a
 * decision, and leaving it implicit is how the October edge case gets lost.
 */
const DISAMBIGUATION = { disambiguation: 'compatible' } as const;

export function zonedFrom(instant: Temporal.Instant, timezone: string): Temporal.ZonedDateTime {
  return instant.toZonedDateTimeISO(timezone);
}

/** The absolute moment at which the salon's clock reads `time` on `date`. */
export function instantFromWallTime(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime,
  timezone: string,
): Temporal.Instant {
  return date.toPlainDateTime(time).toZonedDateTime(timezone, DISAMBIGUATION).toInstant();
}

/**
 * Adds real minutes, never wall-clock minutes.
 *
 * A ninety minute service lasts ninety minutes even when the hour changes
 * halfway through it.
 */
export function addMinutes(instant: Temporal.Instant, minutes: number): Temporal.Instant {
  return instant.add({ minutes });
}

/** The salon's calendar date at that moment. */
export function localDateOf(instant: Temporal.Instant, timezone: string): Temporal.PlainDate {
  return zonedFrom(instant, timezone).toPlainDate();
}

/** The salon's wall clock at that moment, as `HH:mm`. */
export function formatLocalTime(instant: Temporal.Instant, timezone: string): string {
  const zoned = zonedFrom(instant, timezone);
  return `${pad(zoned.hour)}:${pad(zoned.minute)}`;
}

export function formatIsoDate(date: Temporal.PlainDate): string {
  return date.toString();
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
