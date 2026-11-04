import { Temporal } from '@js-temporal/polyfill';
import type { BusyInterval, RangeDay } from '../booking/appointment';
import {
  isWeekday,
  type BookingPolicy,
  type OpeningInterval,
  type Weekday,
  type WeeklySchedule,
} from '../catalog/salon';
import { instantFromWallTime, localDateOf } from '../shared/time';
import { computeDaySlots } from './compute-day';
import { subtractIntervals } from './interval-math';

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
  /** Unavailable periods touching the range, from one query (002, D-019). */
  readonly unavailablePeriods: readonly BusyInterval[];
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
};

/** What the weekly schedule says about one date, before any period or appointment. */
export function openingOf(date: Temporal.PlainDate, schedule: WeeklySchedule): DayOpening {
  const weekday = isWeekday(date.dayOfWeek) ? date.dayOfWeek : 1;
  return { weekday, openingIntervals: schedule.get(weekday) ?? [] };
}

/**
 * The opening of one date as instants, minus the unavailable periods: the time
 * the salon is open and not blocked. Empty is a closed day (D-020); the owner's
 * agenda builds its free time on the same subtraction.
 */
export function openTimeOf(
  date: Temporal.PlainDate,
  openingIntervals: readonly OpeningInterval[],
  unavailablePeriods: readonly BusyInterval[],
  timezone: string,
): readonly BusyInterval[] {
  const opening = openingIntervals.map((stretch) => ({
    startsAt: instantFromWallTime(date, stretch.startsAt, timezone),
    endsAt: instantFromWallTime(date, stretch.endsAt, timezone),
  }));

  return subtractIntervals(opening, unavailablePeriods);
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

    const opening = openingOf(date, input.salonSchedule);
    const openTime = openTimeOf(
      date,
      opening.openingIntervals,
      input.unavailablePeriods,
      input.timezone,
    );

    if (openTime.length === 0) {
      // CLOSED is never reported as FULL. It tells the client whether to look
      // again another day or whether that day does not exist for this salon.
      // A week of holidays is closed, not full (D-020).
      days.push({ date: date.toString(), weekday: opening.weekday, status: 'CLOSED', slotCount: 0 });
      continue;
    }

    const slots = computeDaySlots({
      date,
      openingIntervals: opening.openingIntervals,
      unavailablePeriods: input.unavailablePeriods,
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
