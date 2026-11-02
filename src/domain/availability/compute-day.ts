import { Temporal } from '@js-temporal/polyfill';
import type { BusyInterval, Slot } from '../booking/appointment';
import type { BookingPolicy, OpeningInterval } from '../catalog/salon';
import { addMinutes, formatLocalTime, instantFromWallTime, localDateOf } from '../shared/time';
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
  /** A holiday or an absence. */
  readonly isClosed: boolean;
  readonly serviceDurationMinutes: number;
  readonly confirmedAppointments: readonly BusyInterval[];
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
  /** Only while rescheduling: this appointment's own slot (FR-027). */
  readonly currentAppointmentStart?: Temporal.Instant;
};

/** Half-open comparison: touching at an endpoint is not overlapping (BR-013). */
function overlaps(
  startsAt: Temporal.Instant,
  endsAt: Temporal.Instant,
  busy: BusyInterval,
): boolean {
  return (
    Temporal.Instant.compare(busy.startsAt, endsAt) < 0 &&
    Temporal.Instant.compare(startsAt, busy.endsAt) < 0
  );
}

export function computeDaySlots(input: ComputeDaySlotsInput): readonly Slot[] {
  // A closed day and a weekday with no stretches are indistinguishable as far
  // as availability goes (FR-007a).
  if (input.isClosed || input.openingIntervals.length === 0) return [];

  const today = localDateOf(input.now, input.timezone);
  const horizonEnd = today.add({ days: input.policy.horizonDays });
  if (Temporal.PlainDate.compare(input.date, horizonEnd) > 0) return [];

  const earliestStart = addMinutes(input.now, input.policy.minimumLeadTimeMinutes);

  // The client's own slot does not count as busy while they reschedule (FR-027).
  const ownStart = input.currentAppointmentStart;
  const busyIntervals =
    ownStart === undefined
      ? input.confirmedAppointments
      : input.confirmedAppointments.filter((busy) => !busy.startsAt.equals(ownStart));

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
    // (b) it overlaps no confirmed appointment.
    if (busyIntervals.some((busy) => overlaps(startsAt, endsAt, busy))) continue;

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
