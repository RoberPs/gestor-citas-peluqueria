import { Temporal } from '@js-temporal/polyfill';
import type { Appointment, AppointmentId } from '../booking/appointment';
import type { BookingPolicy, OpeningInterval, UnavailablePeriod } from '../catalog/salon';
import { durationOfServices, type NonEmptyServiceList } from '../catalog/selection';
import { err, ok, type Result } from '../shared/result';
import { addMinutes, instantFromWallTime, localDateOf } from '../shared/time';
import { isPastSlot } from './agenda';
import { detectConflicts, type Conflict } from './conflict';
import { onGrid } from './unavailable-period';

/**
 * The owner's exemptions when she writes an appointment by hand or moves one
 * (002, Historia 4, D-025), and nothing more.
 *
 * What blocks goes in the error channel. What only warns travels inside the
 * success, because it prevents nothing: it asks to be acknowledged (FR-028).
 * What gets in the way is named, not refused: resolving it is the conflict
 * protocol's business (FR-032). The minimum lead time, the horizon and the
 * cancellation deadline are not looked at, as a block or as a warning (BR-007).
 */

export type ManualBookingBlocker =
  | 'IN_THE_PAST'
  | 'CONTACT_LIMIT_REACHED'
  | 'INVALID_START_GRANULARITY';

export type ManualBookingWarning = 'OUTSIDE_OPENING_HOURS';

export type ManualBookingPlan = {
  readonly startsAt: Temporal.Instant;
  /** The start plus the sum of the services: no input sets another duration (FR-027). */
  readonly endsAt: Temporal.Instant;
  /** Empty when nothing is in the way. */
  readonly conflicts: readonly Conflict[];
  readonly warnings: readonly ManualBookingWarning[];
};

export type FutureCounts = { readonly byPhone: number; readonly byEmail: number };

/** Whether `[startsAt, endsAt)` lies inside one opening stretch of its day (FR-028). */
export function warningsFor(input: {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  /** Those of the start's date in the salon. */
  readonly openingIntervals: readonly OpeningInterval[];
  readonly timezone: string;
}): readonly ManualBookingWarning[] {
  const date = localDateOf(input.startsAt, input.timezone);
  const inside = input.openingIntervals.some(
    (stretch) =>
      Temporal.Instant.compare(instantFromWallTime(date, stretch.startsAt, input.timezone), input.startsAt) <= 0 &&
      Temporal.Instant.compare(input.endsAt, instantFromWallTime(date, stretch.endsAt, input.timezone)) <= 0,
  );
  return inside ? [] : ['OUTSIDE_OPENING_HOURS'];
}

/** BR-014 for the owner as for the client: `byPhone` or `byEmail` at the limit (FR-029). */
export function reachesContactLimit(counts: FutureCounts, policy: BookingPolicy): boolean {
  const limit = policy.maxFutureAppointmentsPerContact;
  return counts.byPhone >= limit || counts.byEmail >= limit;
}

export function planManualBooking(input: {
  readonly startsAt: Temporal.Instant;
  /** From `selectServices` against the active catalogue (FR-024, D-030). */
  readonly services: NonEmptyServiceList;
  /** Those of the start's date in the salon. */
  readonly openingIntervals: readonly OpeningInterval[];
  /** The ones that touch the new span. */
  readonly appointments: readonly Appointment[];
  readonly unavailablePeriods: readonly UnavailablePeriod[];
  /** `null` when moving: the appointment already counted and keeps counting the same. */
  readonly futureCountsForContact: FutureCounts | null;
  /** When moving: the appointment does not get in its own way. */
  readonly excludeAppointmentId?: AppointmentId;
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
}): Result<ManualBookingPlan, ManualBookingBlocker> {
  const { startsAt } = input;
  const endsAt = addMinutes(startsAt, durationOfServices(input.services));

  if (!onGrid(startsAt, input.timezone)) return err('INVALID_START_GRANULARITY');
  if (isPastSlot(endsAt, input.now)) return err('IN_THE_PAST');
  if (input.futureCountsForContact !== null && reachesContactLimit(input.futureCountsForContact, input.policy)) {
    return err('CONTACT_LIMIT_REACHED');
  }

  return ok({
    startsAt,
    endsAt,
    conflicts: detectConflicts({
      startsAt,
      endsAt,
      appointments: input.appointments,
      periods: input.unavailablePeriods,
      ...(input.excludeAppointmentId === undefined ? {} : { excludeAppointmentId: input.excludeAppointmentId }),
    }),
    warnings: warningsFor({ startsAt, endsAt, openingIntervals: input.openingIntervals, timezone: input.timezone }),
  });
}
