import { Temporal } from '@js-temporal/polyfill';
import type { BusyInterval, Slot } from '../booking/appointment';
import type { BookingPolicy, OpeningInterval } from '../catalog/salon';
import { addMinutes, formatLocalTime, instantFromWallTime, localDateOf } from '../shared/time';
import { overlaps } from './interval-math';
import { generateCandidateStarts } from './slot-grid';

/**
 * The four conditions of FR-003, and only these four.
 *
 * A pure function over data already in memory: no I/O, no clock of its own.
 * That is what lets the whole of Historia 1 be tested without a database, and
 * what guarantees that what is shown and what is later authorised come out of
 * the same code (SC-003).
 */

export type ComputeDaySlotsInput = {
  /** The salon's calendar date. */
  readonly date: Temporal.PlainDate;
  /** The opening stretches of **that** weekday. */
  readonly openingIntervals: readonly OpeningInterval[];
  /**
   * Unavailable periods touching the day (002, D-019). To the client they are
   * closed time: no start overlapping one is offered (FR-020, BR-002).
   */
  readonly unavailablePeriods: readonly BusyInterval[];
  readonly serviceDurationMinutes: number;
  readonly confirmedAppointments: readonly BusyInterval[];
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
  /** Only while rescheduling: this appointment's own slot (FR-027). */
  readonly currentAppointmentStart?: Temporal.Instant;
};

export function computeDaySlots(input: ComputeDaySlotsInput): readonly Slot[] {
  // A weekday with no stretches is closed (FR-007a). A day an unavailable
  // period covers whole falls out below, with no starts left.
  if (input.openingIntervals.length === 0) return [];

  const today = localDateOf(input.now, input.timezone);
  const horizonEnd = today.add({ days: input.policy.horizonDays });
  if (Temporal.PlainDate.compare(input.date, horizonEnd) > 0) return [];

  const earliestStart = addMinutes(input.now, input.policy.minimumLeadTimeMinutes);

  // The client's own slot does not count as busy while they reschedule (FR-027).
  const ownStart = input.currentAppointmentStart;
  const appointments =
    ownStart === undefined
      ? input.confirmedAppointments
      : input.confirmedAppointments.filter((busy) => !busy.startsAt.equals(ownStart));
  // Appointments and periods go into one list before the one overlap check:
  // one rule, one place (D-019).
  const busyIntervals = [...appointments, ...input.unavailablePeriods];

  const slots: Slot[] = [];

  for (const candidate of generateCandidateStarts(
    input.openingIntervals,
    input.policy.slotGridMinutes,
  )) {
    const startsAt = instantFromWallTime(input.date, candidate.start, input.timezone);
    // Real minutes, so a service keeps its length across a seasonal change.
    const endsAt = addMinutes(startsAt, input.serviceDurationMinutes);
    const stretchEnd = instantFromWallTime(input.date, candidate.intervalEnd, input.timezone);

    // (a) it fits entirely inside one stretch, crossing no midday close.
    if (Temporal.Instant.compare(endsAt, stretchEnd) > 0) continue;
    // (c) it respects the minimum lead time.
    if (Temporal.Instant.compare(startsAt, earliestStart) < 0) continue;
    // (b) it overlaps no confirmed appointment and no unavailable period.
    if (busyIntervals.some((busy) => overlaps({ startsAt, endsAt }, busy))) continue;

    slots.push({
      startsAt,
      endsAt,
      localTime: formatLocalTime(startsAt, input.timezone),
      endsLocalTime: formatLocalTime(endsAt, input.timezone),
      isCurrentAppointment: ownStart?.equals(startsAt) ?? false,
    });
  }

  return slots;
}
