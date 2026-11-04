import { Temporal } from '@js-temporal/polyfill';
import type { Appointment } from '../booking/appointment';

/**
 * What the owner sees of a confirmation (004, FR-020a, D-011).
 *
 * Only one state is hers to see: the confirmation of an online appointment
 * failed for good, the client has no link and she can call to give it. Pending,
 * sent and not sent are none of her business, so the reading collapses them.
 */

/** `null` when the appointment has no confirmation by email. */
export type ConfirmationDelivery = 'FAILED' | 'OTHER' | null;

/** Online, still confirmed, not over, with somebody to call, and its confirmation FAILED. */
export function needsConfirmationCall(
  appointment: Appointment,
  delivery: ConfirmationDelivery,
  now: Temporal.Instant,
): boolean {
  return (
    delivery === 'FAILED' &&
    appointment.origin === 'ONLINE' &&
    appointment.status === 'CONFIRMED' &&
    appointment.customer !== null &&
    Temporal.Instant.compare(now, appointment.endsAt) < 0
  );
}
