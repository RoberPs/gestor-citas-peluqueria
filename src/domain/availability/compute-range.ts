import { Temporal } from '@js-temporal/polyfill';
import type { BusyInterval, RangeDay } from '../booking/appointment';
import {
  isWeekday,
  type BookingPolicy,
  type OpeningInterval,
  type Weekday,
  type WeeklySchedule,
} from '../catalog/salon';
import { localDateOf } from '../shared/time';
import { computeDaySlots } from './compute-day';

/**
 * The state of each day of the range for the chosen service (FR-005).
 *
 * It takes the confirmed appointments of the **whole horizon**, not of one day.
 * That signature is deliberate: it forces the caller to bring the data in one
 * query (D-003) and makes the N+1 the Principio VIII forbids impossible to
 * write. A signature taking one day's appointments would invite fourteen calls.
 */

export type RangeInput = {
  readonly rangeStart: Temporal.PlainDate;
  readonly rangeLengthDays: number;
  readonly salonSchedule: WeeklySchedule;
  /** ISO dates of the closed days. */
  readonly closures: ReadonlySet<string>;
  readonly serviceDurationMinutes: number;
  readonly confirmedAppointments: readonly BusyInterval[];
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
  readonly currentAppointmentStart?: Temporal.Instant;
};

export type DayOpening = {
  readonly weekday: Weekday;
  readonly openingIntervals: readonly OpeningInterval[];
  readonly isClosed: boolean;
};

/** What the configuration says about one date, before any appointment is read. */
export function openingOf(
  date: Temporal.PlainDate,
  schedule: WeeklySchedule,
  closures: ReadonlySet<string>,
): DayOpening {
  const weekday = isWeekday(date.dayOfWeek) ? date.dayOfWeek : 1;
  const openingIntervals = schedule.get(weekday) ?? [];

  return {
    weekday,
    openingIntervals,
    isClosed: closures.has(date.toString()) || openingIntervals.length === 0,
  };
}

export function horizonEndOf(
  now: Temporal.Instant,
  policy: BookingPolicy,
  timezone: string,
): Temporal.PlainDate {
  return localDateOf(now, timezone).add({ days: policy.horizonDays });
}

export function computeRangeDays(input: RangeInput): readonly RangeDay[] {
  const horizonEnd = horizonEndOf(input.now, input.policy, input.timezone);
  const days: RangeDay[] = [];

  for (let offset = 0; offset < input.rangeLengthDays; offset += 1) {
    const date = input.rangeStart.add({ days: offset });
    // The last range is trimmed to day 60 rather than running past it.
    if (Temporal.PlainDate.compare(date, horizonEnd) > 0) break;

    const opening = openingOf(date, input.salonSchedule, input.closures);

    if (opening.isClosed) {
      // CLOSED is never reported as FULL. It tells the client whether to look
      // again another day or whether that day does not exist for this salon.
      days.push({ date: date.toString(), weekday: opening.weekday, status: 'CLOSED', slotCount: 0 });
      continue;
    }

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

    days.push({
      date: date.toString(),
      weekday: opening.weekday,
      status: slots.length === 0 ? 'FULL' : 'AVAILABLE',
      slotCount: slots.length,
    });
  }

  return days;
}
