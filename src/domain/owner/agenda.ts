import { Temporal } from '@js-temporal/polyfill';
import { openTimeOf } from '../availability/compute-range';
import { subtractIntervals } from '../availability/interval-math';
import type { Appointment } from '../booking/appointment';
import type { OpeningInterval, UnavailablePeriod } from '../catalog/salon';
import { instantFromWallTime } from '../shared/time';

/**
 * The owner's day as a timeline (002, Historia 2, FR-011).
 *
 * Pure, over data already loaded: the use case reads the day's appointments
 * and periods in a fixed number of queries and everything here is derived in
 * memory (D-027). Free time is what is left of the opening once the periods
 * and the confirmed appointments are taken away — the same subtraction that
 * tells a closed day from a full one for the client (D-020).
 */

export type TimelineEntry =
  | { readonly kind: 'APPOINTMENT'; readonly appointment: Appointment; readonly isPast: boolean }
  | { readonly kind: 'UNAVAILABLE'; readonly period: UnavailablePeriod }
  | { readonly kind: 'FREE'; readonly startsAt: Temporal.Instant; readonly endsAt: Temporal.Instant };

export type AgendaDay = {
  readonly date: Temporal.PlainDate;
  /** No stretches, or all of them covered by periods. With no entries it reads "cerrado". */
  readonly isClosed: boolean;
  /**
   * In chronological order. A FREE stretch never overlaps a confirmed
   * appointment or a period; a period and an appointment may overlap each
   * other, because a block cancels nobody (FR-022), and then both appear.
   */
  readonly entries: readonly TimelineEntry[];
  /** The whole day is over: nothing in it is created, moved or cancelled (BR-009). */
  readonly isReadOnly: boolean;
};

/**
 * The one cut of the past (FR-016, FR-030, BR-009): a slot is past once its END
 * has gone by. An appointment under way is not past and can still be moved,
 * edited or cancelled.
 */
export function isPastSlot(endsAt: Temporal.Instant, now: Temporal.Instant): boolean {
  return Temporal.Instant.compare(endsAt, now) <= 0;
}

const KIND_ORDER: Record<TimelineEntry['kind'], number> = { APPOINTMENT: 0, UNAVAILABLE: 1, FREE: 2 };

function startOf(entry: TimelineEntry): Temporal.Instant {
  switch (entry.kind) {
    case 'APPOINTMENT':
      return entry.appointment.startsAt;
    case 'UNAVAILABLE':
      return entry.period.startsAt;
    case 'FREE':
      return entry.startsAt;
  }
}

export function buildAgendaDay(input: {
  readonly date: Temporal.PlainDate;
  readonly openingIntervals: readonly OpeningInterval[];
  /** The day's, already loaded; cancelled ones only if the owner asked (FR-015). */
  readonly appointments: readonly Appointment[];
  readonly unavailablePeriods: readonly UnavailablePeriod[];
  readonly now: Temporal.Instant;
  readonly timezone: string;
}): AgendaDay {
  const openTime = openTimeOf(
    input.date,
    input.openingIntervals,
    input.unavailablePeriods,
    input.timezone,
  );
  const confirmed = input.appointments.filter((appointment) => appointment.status === 'CONFIRMED');
  const free = subtractIntervals(openTime, confirmed);

  const entries: TimelineEntry[] = [
    ...input.appointments.map((appointment) => ({
      kind: 'APPOINTMENT' as const,
      appointment,
      isPast: isPastSlot(appointment.endsAt, input.now),
    })),
    ...input.unavailablePeriods.map((period) => ({ kind: 'UNAVAILABLE' as const, period })),
    ...free.map((stretch) => ({ kind: 'FREE' as const, ...stretch })),
  ];

  entries.sort(
    (a, b) =>
      Temporal.Instant.compare(startOf(a), startOf(b)) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );

  const endOfDay = instantFromWallTime(
    input.date.add({ days: 1 }),
    new Temporal.PlainTime(0, 0),
    input.timezone,
  );

  return {
    date: input.date,
    isClosed: openTime.length === 0,
    entries,
    isReadOnly: isPastSlot(endOfDay, input.now),
  };
}
