import type { Temporal } from '@js-temporal/polyfill';
import type { BookingPolicy, OpeningInterval } from '../catalog/salon';
import { ok, type Result } from '../shared/result';
import { durationOf, type Appointment, type BusyInterval } from './appointment';
import { validateSlot, type BookingRejection } from './confirm';
import { canReschedule, type ModificationBlock } from './modification-rules';

/**
 * Moving an appointment to another slot (Historia 6).
 *
 * Three things this signature settles before any code runs:
 *
 * - **The services cannot change.** No new ones can be passed in, so FR-017 is
 *   not a rule to enforce but a state that cannot be expressed. The duration
 *   is the sum of the appointment's own snapshots, so a catalogue change since
 *   the booking cannot silently lengthen it (D-011, 005/D-008).
 * - **The appointment's own slot does not block it** (FR-027).
 * - **Picking the hour already held is `UNCHANGED`, not a failure** (escenario 5).
 *
 * Atomicity is *not* settled here: this function is pure and writes nothing.
 * The use case provides it with the exclusion constraint (D-002), which is what
 * makes BR-006 hold — if the write loses, the original appointment is still
 * sitting in its original hour because nothing ever left it.
 */

export type RescheduleOutcome =
  | { readonly kind: 'UNCHANGED' }
  | { readonly kind: 'MOVED'; readonly appointment: Appointment };

export type RescheduleRequest = {
  readonly appointment: Appointment;
  readonly newStart: Temporal.Instant;
  /** The salon's calendar date of the new start. */
  readonly date: Temporal.PlainDate;
  readonly openingIntervals: readonly OpeningInterval[];
  readonly unavailablePeriods: readonly BusyInterval[];
  readonly confirmedAppointments: readonly BusyInterval[];
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
};

export function applyReschedule(
  input: RescheduleRequest,
): Result<RescheduleOutcome, BookingRejection | ModificationBlock> {
  // Whether the appointment may be touched at all comes first. Telling someone
  // their new hour is taken, when the real answer is that the appointment was
  // cancelled last week, would be answering a question they did not ask.
  const allowed = canReschedule(input.appointment, input.now, input.policy);
  if (!allowed.ok) return allowed;

  if (input.newStart.equals(input.appointment.startsAt)) return ok({ kind: 'UNCHANGED' });

  const slot = validateSlot({
    requestedStart: input.newStart,
    date: input.date,
    durationMinutes: durationOf(input.appointment),
    openingIntervals: input.openingIntervals,
    unavailablePeriods: input.unavailablePeriods,
    confirmedAppointments: input.confirmedAppointments,
    now: input.now,
    policy: input.policy,
    timezone: input.timezone,
    currentAppointmentStart: input.appointment.startsAt,
  });

  if (!slot.ok) return slot;

  return ok({
    kind: 'MOVED',
    // A new value with the slot changed and everything else — id included, and
    // with it the token — carried over untouched (FR-026).
    appointment: { ...input.appointment, startsAt: slot.value.startsAt, endsAt: slot.value.endsAt },
  });
}
