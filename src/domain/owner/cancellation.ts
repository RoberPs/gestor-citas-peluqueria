import type { Temporal } from '@js-temporal/polyfill';
import type { Appointment } from '../booking/appointment';
import { err, ok, type Result } from '../shared/result';
import { isPastSlot } from './agenda';

/**
 * What the owner may still change, and her cancellation (002, Historia 5).
 *
 * She is exempt from the cancellation deadline (BR-007), not from the past
 * (BR-009) nor from cancelling being final (BR-008). Moving, editing and
 * cancelling share the one check, so the three cannot disagree.
 */

export type OwnerChangeBlock = 'ALREADY_CANCELLED' | 'IN_THE_PAST';

/** An appointment under way can still be changed: its end has not gone by (FR-016). */
export function checkOwnerCanChange(
  appointment: Appointment,
  now: Temporal.Instant,
): Result<Appointment, OwnerChangeBlock> {
  if (appointment.status === 'CANCELLED') return err('ALREADY_CANCELLED');
  if (isPastSlot(appointment.endsAt, now)) return err('IN_THE_PAST');
  return ok(appointment);
}

/** The deadline is never consulted (BR-007); who cancelled is recorded (FR-040a). */
export function applyOwnerCancellation(
  appointment: Appointment,
  now: Temporal.Instant,
): Result<Appointment, OwnerChangeBlock> {
  const allowed = checkOwnerCanChange(appointment, now);
  if (!allowed.ok) return allowed;
  return ok({ ...appointment, status: 'CANCELLED', cancelledAt: now, cancelledBy: 'OWNER' });
}
