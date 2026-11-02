import { Temporal } from '@js-temporal/polyfill';
import type { BusyInterval } from '@/domain/booking/appointment';
import {
  DEFAULT_BOOKING_POLICY,
  type OpeningInterval,
  type Weekday,
  type WeeklySchedule,
} from '@/domain/catalog/salon';
import { instantFromWallTime } from '@/domain/shared/time';

/** Shared setup for the availability suites. No suite invents its own clock. */

export const MADRID = 'Europe/Madrid';
export const POLICY = DEFAULT_BOOKING_POLICY;

/** Tuesday 2026-09-15, 10:00 in the salon. Every suite reads the clock from here. */
export const NOW = instantFromWallTime(
  Temporal.PlainDate.from('2026-09-15'),
  Temporal.PlainTime.from('10:00'),
  MADRID,
);

export const FRIDAY = Temporal.PlainDate.from('2026-09-18');
export const SATURDAY = Temporal.PlainDate.from('2026-09-19');
export const SUNDAY = Temporal.PlainDate.from('2026-09-20');

export function interval(weekday: Weekday, from: string, to: string): OpeningInterval {
  return {
    weekday,
    startsAt: Temporal.PlainTime.from(from),
    endsAt: Temporal.PlainTime.from(to),
  };
}

/** An instant from a salon wall time, which is how the spec states its scenarios. */
export function at(date: string, time: string): Temporal.Instant {
  return instantFromWallTime(
    Temporal.PlainDate.from(date),
    Temporal.PlainTime.from(time),
    MADRID,
  );
}

export function busy(date: string, from: string, to: string): BusyInterval {
  return { startsAt: at(date, from), endsAt: at(date, to) };
}

/** Monday to Friday 10:00–20:00; Saturday with a midday close; Sunday shut. */
export function standardSchedule(): WeeklySchedule {
  return new Map<Weekday, readonly OpeningInterval[]>([
    [1, [interval(1, '10:00', '20:00')]],
    [2, [interval(2, '10:00', '20:00')]],
    [3, [interval(3, '10:00', '20:00')]],
    [4, [interval(4, '10:00', '20:00')]],
    [5, [interval(5, '10:00', '20:00')]],
    [6, [interval(6, '10:00', '14:00'), interval(6, '16:00', '20:00')]],
  ]);
}

/** The local times of a list of slots, which is what the scenarios talk about. */
export function times(slots: readonly { localTime: string }[]): readonly string[] {
  return slots.map((slot) => slot.localTime);
}
