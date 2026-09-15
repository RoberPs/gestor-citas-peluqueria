import { Temporal } from '@js-temporal/polyfill';
import type { BusyInterval } from '../booking/appointment';
import type { BookingPolicy, WeeklySchedule } from '../catalog/salon';
import { computeDaySlots } from './compute-day';
import { openingOf } from './compute-range';

/**
 * The first day with room after `fromDate`, **even if it falls in a later
 * range** (FR-006). `null` when the horizon runs out.
 *
 * It works over the appointments already loaded in memory, so it fires no
 * extra query. That is what makes it affordable to offer the jump even when the
 * client is staring at fourteen closed and full days.
 */

export type NextAvailableInput = {
  /** Exclusive: the answer is the next day *after* this one. */
  readonly fromDate: Temporal.PlainDate;
  readonly horizonEnd: Temporal.PlainDate;
  readonly salonSchedule: WeeklySchedule;
  readonly closures: ReadonlySet<string>;
  readonly serviceDurationMinutes: number;
  readonly confirmedAppointments: readonly BusyInterval[];
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
  readonly currentAppointmentStart?: Temporal.Instant;
};

export function findNextAvailableDate(input: NextAvailableInput): Temporal.PlainDate | null {
  let date = input.fromDate.add({ days: 1 });

  while (Temporal.PlainDate.compare(date, input.horizonEnd) <= 0) {
    const opening = openingOf(date, input.salonSchedule, input.closures);

    if (!opening.isClosed) {
      const slots = computeDaySlots({
        date,
        openingIntervals: opening.openingIntervals,
        isClosed: false,
        serviceDurationMinutes: input.serviceDurationMinutes,
        confirmedAppointments: input.confirmedAppointments,
        now: input.now,
        policy: input.policy,
        timezone: input.timezone,
        ...(input.currentAppointmentStart === undefined
          ? {}
          : { currentAppointmentStart: input.currentAppointmentStart }),
      });

      if (slots.length > 0) return date;
    }

    date = date.add({ days: 1 });
  }

  return null;
}
