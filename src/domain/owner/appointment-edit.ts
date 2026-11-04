import type { Temporal } from '@js-temporal/polyfill';
import type { Appointment, AppointmentId } from '../booking/appointment';
import type { BookingPolicy, OpeningInterval, UnavailablePeriod } from '../catalog/salon';
import { durationOfServices, type NonEmptyServiceList } from '../catalog/selection';
import type { ValidatedContact } from '../contact/contact';
import { err, ok, type Result } from '../shared/result';
import { addMinutes } from '../shared/time';
import { checkOwnerCanChange, type OwnerChangeBlock } from './cancellation';
import { conflictSpanOf, detectConflicts, type Conflict } from './conflict';
import { reachesContactLimit, warningsFor, type FutureCounts, type ManualBookingWarning } from './manual-booking';

/**
 * Editing an appointment (002, Historia 11, D-035): its services and its
 * client's data, never its start (FR-073). D-025 applied to a span that
 * begins where the appointment began: the past is measured by its CURRENT
 * end, so one under way is edited (FR-071); only what it grows into can be
 * in the way (FR-074); a new end after closing warns. The lead time, the
 * horizon and the deadline are not looked at (BR-007).
 */

export type AppointmentEditBlocker = OwnerChangeBlock | 'CONTACT_LIMIT_REACHED';

export type AppointmentEditPlan = {
  readonly appointmentId: AppointmentId;
  readonly startsAt: Temporal.Instant;
  readonly previousEndsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly services: NonEmptyServiceList;
  readonly contact: ValidatedContact;
  readonly conflicts: readonly Conflict[];
  readonly warnings: readonly ManualBookingWarning[];
};

export function planAppointmentEdit(input: {
  readonly appointment: Appointment;
  /** From `mergeServiceSelection` (D-035). */
  readonly services: NonEmptyServiceList;
  /** From `validateContact`, with the email optional (FR-075). */
  readonly contact: ValidatedContact;
  readonly openingIntervals: readonly OpeningInterval[];
  /** The ones that touch the new span. */
  readonly appointments: readonly Appointment[];
  readonly unavailablePeriods: readonly UnavailablePeriod[];
  /** Only when the phone or the email changed, not counting this appointment; `null` otherwise. */
  readonly futureCountsForNewContact: FutureCounts | null;
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
}): Result<AppointmentEditPlan, AppointmentEditBlocker> {
  const { appointment } = input;
  const changeable = checkOwnerCanChange(appointment, input.now);
  if (!changeable.ok) return changeable;
  if (input.futureCountsForNewContact !== null && reachesContactLimit(input.futureCountsForNewContact, input.policy)) {
    return err('CONTACT_LIMIT_REACHED');
  }

  const startsAt = appointment.startsAt;
  const endsAt = addMinutes(startsAt, durationOfServices(input.services));
  const intent = {
    kind: 'EDIT_APPOINTMENT' as const,
    appointmentId: appointment.id,
    startsAt,
    previousEndsAt: appointment.endsAt,
    endsAt,
    services: input.services,
    contact: input.contact,
  };
  const span = conflictSpanOf(intent);

  return ok({
    ...intent,
    conflicts:
      span === null
        ? []
        : detectConflicts({
            ...span,
            appointments: input.appointments,
            periods: input.unavailablePeriods,
            excludeAppointmentId: appointment.id,
          }),
    warnings: warningsFor({ startsAt, endsAt, openingIntervals: input.openingIntervals, timezone: input.timezone }),
  });
}
