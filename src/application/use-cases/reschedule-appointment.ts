import { Temporal } from '@js-temporal/polyfill';
import { openingOf } from '@/domain/availability/compute-range';
import type { Appointment } from '@/domain/booking/appointment';
import type { BookingRejection } from '@/domain/booking/confirm';
import { deriveView } from '@/domain/booking/derive-view';
import {
  canCancel,
  canReschedule,
  type ModificationBlock,
} from '@/domain/booking/modification-rules';
import { applyReschedule } from '@/domain/booking/reschedule';
import type { Clock } from '@/domain/shared/clock';
import { err, ok, type Result } from '@/domain/shared/result';
import { localDateOf } from '@/domain/shared/time';
import type { AppointmentRepository, SalonConfigRepository, TokenGenerator } from '../ports';
import type { AppointmentDetail } from './view-appointment';

/**
 * Rescheduling from the management link (Historia 6).
 *
 * The move is a single `UPDATE` of the slot on the same row, never a cancel
 * followed by a create. That is what carries the token across (FR-026), and it
 * is what makes BR-006 hold: if the exclusion constraint rejects the new slot,
 * one statement failed and the appointment is still sitting in its original
 * hour — there is no window in which the client has neither.
 */

export type RescheduleFailure =
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'INVALID_START' }
  | { readonly kind: 'BLOCKED'; readonly block: ModificationBlock }
  | { readonly kind: 'REJECTED'; readonly rejection: BookingRejection };

export type RescheduleResult = {
  readonly detail: AppointmentDetail;
  /** `true` when the client picked the hour they already had (escenario 5). */
  readonly unchanged: boolean;
};

export function createRescheduleAppointment(deps: {
  readonly config: SalonConfigRepository;
  readonly appointments: AppointmentRepository;
  readonly tokens: TokenGenerator;
  readonly clock: Clock;
}) {
  return async function rescheduleAppointment(
    token: string,
    startsAt: string,
  ): Promise<Result<RescheduleResult, RescheduleFailure>> {
    const appointment = await deps.appointments.findByTokenHash(deps.tokens.hash(token));
    if (appointment === null) return err({ kind: 'NOT_FOUND' });

    const configuration = await deps.config.load();
    const { policy, salon } = configuration;
    const timezone = salon.timezone;
    const now = deps.clock.now();

    let newStart: Temporal.Instant;
    try {
      newStart = Temporal.Instant.from(startsAt);
    } catch {
      return err({ kind: 'INVALID_START' });
    }

    const date = localDateOf(newStart, timezone);
    const opening = openingOf(date, configuration.schedule, configuration.closures);

    const dayStart = startOfDay(date, timezone);
    const dayEnd = startOfDay(date.add({ days: 1 }), timezone);
    const busy = await deps.appointments.findConfirmedInWindow(dayStart, dayEnd);

    const outcome = applyReschedule({
      appointment,
      newStart,
      date,
      openingIntervals: opening.openingIntervals,
      isClosed: opening.isClosed,
      confirmedAppointments: busy,
      now,
      policy,
      timezone,
    });

    if (!outcome.ok) return err(classify(outcome.error));

    if (outcome.value.kind === 'UNCHANGED') {
      return ok({ detail: detailOf(appointment), unchanged: true });
    }

    const moved = outcome.value.appointment;
    const persisted = await deps.appointments.updateSchedule(
      appointment.id,
      moved.startsAt,
      moved.endsAt,
    );

    // Somebody took the new slot between the check and the write. Nothing moved.
    if (!persisted.ok) return err({ kind: 'REJECTED', rejection: { kind: 'SLOT_TAKEN' } });

    return ok({ detail: detailOf(persisted.value), unchanged: false });

    function detailOf(current: Appointment): AppointmentDetail {
      const cancellable = canCancel(current, now, policy);
      const reschedulable = canReschedule(current, now, policy);

      return {
        appointment: current,
        view: deriveView(current, now),
        salon,
        policy,
        canCancel: cancellable.ok,
        canReschedule: reschedulable.ok,
        block: cancellable.ok ? null : cancellable.error,
      };
    }
  };
}

/** The domain returns one union; the caller needs to know which half it got. */
function classify(error: BookingRejection | ModificationBlock): RescheduleFailure {
  switch (error.kind) {
    case 'TOO_LATE':
    case 'ALREADY_CANCELLED':
    case 'ALREADY_COMPLETED':
      return { kind: 'BLOCKED', block: error };
    default:
      return { kind: 'REJECTED', rejection: error };
  }
}

function startOfDay(date: Temporal.PlainDate, timezone: string): Temporal.Instant {
  return date
    .toPlainDateTime(new Temporal.PlainTime(0, 0))
    .toZonedDateTime(timezone, { disambiguation: 'compatible' })
    .toInstant();
}
