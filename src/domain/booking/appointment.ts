import type { Temporal } from '@js-temporal/polyfill';
import type { Weekday } from '../catalog/salon';
import { durationOfServices, type NonEmptyServiceList } from '../catalog/selection';

export type AppointmentId = string;

/** The two persisted states, and only these two (FR-030). */
export type AppointmentStatus = 'CONFIRMED' | 'CANCELLED';

/**
 * What the client is shown. `COMPLETED` is **derived from the clock** and never
 * persisted (FR-031): no background process assigns it.
 */
export type AppointmentView = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

/** Booked online, or written by the owner by hand (002, FR-025). Never changes. */
export type AppointmentOrigin = 'ONLINE' | 'OWNER';

/** Who cancelled it: the client from their link, or the owner (002, FR-040a). */
export type CancellationActor = 'CUSTOMER' | 'OWNER';

/** The three personal fields, and no others (FR-008, Principio III). */
export type CustomerContact = {
  /** As the client typed it: it is what the owner reads out when calling. */
  readonly name: string;
  readonly phone: string;
  /** Missing only from an appointment the owner wrote by hand (002, FR-024). */
  readonly email: string | null;
};

export type Appointment = {
  readonly id: AppointmentId;
  readonly status: AppointmentStatus;
  readonly origin: AppointmentOrigin;
  readonly startsAt: Temporal.Instant;
  /** The start plus the total duration of its services, fixed when confirmed. */
  readonly endsAt: Temporal.Instant;
  /** One or more, in catalogue order, each frozen as it was when booked (FR-014). */
  readonly services: NonEmptyServiceList;
  /** `null` once anonymised (BR-018): the type forces every reader to cope. */
  readonly customer: CustomerContact | null;
  readonly createdAt: Temporal.Instant;
  readonly cancelledAt: Temporal.Instant | null;
  /** `null` exactly when `cancelledAt` is: a fact of the cancellation (BR-019). */
  readonly cancelledBy: CancellationActor | null;
  readonly anonymizedAt: Temporal.Instant | null;
};

/**
 * How long the appointment holds the chair: the sum of its services (FR-007),
 * from their snapshots and not from today's catalogue (D-008).
 */
export function durationOf(appointment: Appointment): number {
  return durationOfServices(appointment.services);
}

/** A stretch of the single chair already taken by a confirmed appointment. */
export type BusyInterval = {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
};

export function busyIntervalOf(appointment: Appointment): BusyInterval {
  return { startsAt: appointment.startsAt, endsAt: appointment.endsAt };
}

/**
 * A candidate start. Derived, never stored, never held while the form is filled
 * in: if it were a row, changing a service duration would invalidate the table.
 */
export type Slot = {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  /** `11:30`, salon wall time, already formatted (FR-033). */
  readonly localTime: string;
  readonly endsLocalTime: string;
  /** Only while rescheduling: the slot this appointment already holds (FR-027). */
  readonly isCurrentAppointment: boolean;
};

/**
 * `CLOSED` is never reported as `FULL`. It is a product distinction, not a
 * presentational one: it tells the client whether to look at another day or
 * whether that day simply does not exist for this salon.
 */
export type DayStatus = 'CLOSED' | 'FULL' | 'AVAILABLE';

/**
 * One day of the 14 day range.
 *
 * The Spanish labels the screen shows (`vie`, `18`) are built at the
 * presentation boundary from `date` and `weekday`, because all interface copy
 * lives in `src/messages/es-ES.ts` and none of it in the domain.
 */
export type RangeDay = {
  /** ISO date in the salon's calendar, e.g. `2026-09-18`. */
  readonly date: string;
  readonly weekday: Weekday;
  readonly status: DayStatus;
  /** Zero when `CLOSED` or `FULL`. Feeds the accessible name (D-014). */
  readonly slotCount: number;
};
