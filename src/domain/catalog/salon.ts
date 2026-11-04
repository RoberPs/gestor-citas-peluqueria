import type { Temporal } from '@js-temporal/polyfill';
import type { Service } from './service';

/** ISO-8601 weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * One opening stretch of one weekday, expressed as **wall time** (FR-007a).
 *
 * A day may have one stretch, several — a midday close — or none, and none is
 * a closed day, indistinguishable from a holiday as far as availability goes.
 */
export type OpeningInterval = {
  readonly weekday: Weekday;
  readonly startsAt: Temporal.PlainTime;
  readonly endsAt: Temporal.PlainTime;
};

export type UnavailablePeriodId = string;

/**
 * A stretch of time in which the salon is not available, with arbitrary start
 * and end instants (002, FR-018). One concept for a lunch hour, a holiday and
 * three weeks away; it replaces the whole-day closure of 001 (D-019).
 *
 * To the client it is closed time and nothing more (BR-002).
 */
export type UnavailablePeriod = {
  readonly id: UnavailablePeriodId;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  /** Internal. It never crosses to the client (FR-021). */
  readonly reason: string | null;
};

/** Opening stretches grouped by weekday. A missing weekday is a closed day. */
export type WeeklySchedule = ReadonlyMap<Weekday, readonly OpeningInterval[]>;

/** The single establishment of this instance (asunción 11). */
export type Salon = {
  readonly name: string;
  readonly address: string;
  readonly phone: string;
  /** IANA timezone. Salon configuration, not a system constant (asunción 9). */
  readonly timezone: string;
};

/**
 * The temporal parameters of the domain, fixed in plan.md.
 *
 * They live in one place so that a rule is never re-stated: the UI shows what
 * these produce, it does not re-derive them.
 */
export type BookingPolicy = {
  /** BR-003: nothing may start sooner than this. */
  readonly minimumLeadTimeMinutes: number;
  /** BR-004: cancelling and rescheduling close this long before the start. */
  readonly cancellationDeadlineHours: number;
  /** BR-011: nothing may be booked beyond this many days from today. */
  readonly horizonDays: number;
  /** BR-011b: how many days a range shows. */
  readonly rangeLengthDays: number;
  /** BR-012: candidate starts every this many minutes, anchored to the hour. */
  readonly slotGridMinutes: number;
  /** BR-014: confirmed future appointments allowed per phone or per email. */
  readonly maxFutureAppointmentsPerContact: number;
  /** FR-035: how long personal data is kept, counted from the appointment. */
  readonly retentionMonths: number;
};

export const DEFAULT_BOOKING_POLICY: BookingPolicy = {
  minimumLeadTimeMinutes: 120,
  cancellationDeadlineHours: 24,
  horizonDays: 60,
  rangeLengthDays: 14,
  slotGridMinutes: 30,
  maxFutureAppointmentsPerContact: 3,
  retentionMonths: 12,
};

/** Everything the availability calculation needs about the salon, as it is at that moment. */
export type SalonConfiguration = {
  readonly salon: Salon;
  readonly schedule: WeeklySchedule;
  readonly services: readonly Service[];
  readonly policy: BookingPolicy;
};

export function isWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}
