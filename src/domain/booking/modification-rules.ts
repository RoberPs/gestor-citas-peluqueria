import { Temporal } from '@js-temporal/polyfill';
import type { BookingPolicy } from '../catalog/salon';
import { err, ok, type Result } from '../shared/result';
import type { Appointment } from './appointment';

/**
 * Whether an appointment can still be cancelled or moved.
 *
 * Both actions share the same three rules, so they share one implementation:
 * duplicating them would be two places for BR-004 to live, and eventually two
 * different answers to the same question (Principio I).
 *
 * The block is returned rather than thrown because the interface needs it: the
 * reason the client reads comes from here, not from an `if` in a component
 * (FR-028).
 */

export type ModificationBlock =
  | { readonly kind: 'TOO_LATE'; readonly deadline: Temporal.Instant }
  | { readonly kind: 'ALREADY_CANCELLED' }
  | { readonly kind: 'ALREADY_COMPLETED' };

function check(
  appointment: Appointment,
  now: Temporal.Instant,
  policy: BookingPolicy,
): Result<void, ModificationBlock> {
  // Cancelled is terminal: it outranks every other reason, including having
  // since passed (BR-007).
  if (appointment.status === 'CANCELLED') return err({ kind: 'ALREADY_CANCELLED' });

  if (Temporal.Instant.compare(now, appointment.endsAt) >= 0) {
    return err({ kind: 'ALREADY_COMPLETED' });
  }

  const deadline = appointment.startsAt.subtract({ hours: policy.cancellationDeadlineHours });
  if (Temporal.Instant.compare(now, deadline) >= 0) return err({ kind: 'TOO_LATE', deadline });

  return ok(undefined);
}

export function canCancel(
  appointment: Appointment,
  now: Temporal.Instant,
  policy: BookingPolicy,
): Result<void, ModificationBlock> {
  return check(appointment, now, policy);
}

export function canReschedule(
  appointment: Appointment,
  now: Temporal.Instant,
  policy: BookingPolicy,
): Result<void, ModificationBlock> {
  return check(appointment, now, policy);
}
