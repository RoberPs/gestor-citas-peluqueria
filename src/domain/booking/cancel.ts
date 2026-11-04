import type { Temporal } from '@js-temporal/polyfill';
import type { BookingPolicy } from '../catalog/salon';
import { ok, type Result } from '../shared/result';
import type { Appointment } from './appointment';
import { canCancel, type ModificationBlock } from './modification-rules';

/**
 * The transition to cancelled (Historia 5).
 *
 * The rules are `canCancel`'s, reused rather than restated, and the result is a
 * new value: nothing here mutates the appointment it was given.
 *
 * Freeing the slot is not done here and needs no step of its own — the
 * exclusion constraint only applies to confirmed appointments, so the slot is
 * free the moment this is persisted (BR-005, D-002).
 */
export function applyCancellation(
  appointment: Appointment,
  now: Temporal.Instant,
  policy: BookingPolicy,
): Result<Appointment, ModificationBlock> {
  const allowed = canCancel(appointment, now, policy);
  if (!allowed.ok) return allowed;

  // The client's own cancellation, from their link (002, FR-040a). The owner's
  // has a function of its own: she is exempt from the deadline (BR-007).
  return ok({ ...appointment, status: 'CANCELLED', cancelledAt: now, cancelledBy: 'CUSTOMER' });
}
