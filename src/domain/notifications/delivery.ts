import { Temporal } from '@js-temporal/polyfill';
import type { Appointment } from '../booking/appointment';
import { isConsentActive, type ChannelConsent, type PendingNotification, type SkipReason } from './consent';

/**
 * Whether a notification goes out, and when it is tried again (004, D-008).
 *
 * The one place that decides it. The dispatch asks here with the appointment
 * as it is at that moment (FR-008), so a cancellation or an unsubscribe a
 * second before the attempt is enough to stop it.
 */

/** FR-011: retries stop one hour after the booking. */
export const DELIVERY_WINDOW_MINUTES = 60;

/** D-003: the moments of the retries, in minutes from the booking. */
export const RETRY_SCHEDULE_MINUTES = [1, 3, 7, 15, 30, 45] as const;

export type DeliveryDecision =
  | { readonly kind: 'SEND' }
  | { readonly kind: 'SKIP'; readonly reason: SkipReason }
  /** The hour is over: the notification fails for good (FR-011). */
  | { readonly kind: 'EXPIRED' };

/**
 * In this order (data-model.md). The appointment's own state comes before the
 * hour, so a cancelled appointment is recorded as not sent, not as a failure.
 */
export function decideDelivery(input: {
  readonly appointment: Appointment;
  readonly consent: ChannelConsent | null;
  readonly notification: PendingNotification;
  readonly now: Temporal.Instant;
}): DeliveryDecision {
  const { appointment, consent, notification, now } = input;

  if (appointment.anonymizedAt !== null || appointment.customer === null) {
    return { kind: 'SKIP', reason: 'PERSONAL_DATA_DELETED' };
  }
  if (appointment.status === 'CANCELLED') return { kind: 'SKIP', reason: 'APPOINTMENT_CANCELLED' };

  // An address the owner removed takes the consent with it (FR-008), whether or
  // not the consent row has caught up.
  const reachable = notification.channel !== 'EMAIL' || appointment.customer.email !== null;
  if (!reachable || !isConsentActive(consent, notification.channel)) {
    return { kind: 'SKIP', reason: 'CONSENT_ENDED' };
  }

  const deadline = notification.createdAt.add({ minutes: DELIVERY_WINDOW_MINUTES });
  if (Temporal.Instant.compare(now, deadline) >= 0) return { kind: 'EXPIRED' };

  return { kind: 'SEND' };
}

/**
 * After a transient failure at `now`: the first moment of the schedule that is
 * still ahead, or `null` when none is left before the hour is out.
 */
export function nextAttemptAt(createdAt: Temporal.Instant, now: Temporal.Instant): Temporal.Instant | null {
  for (const minutes of RETRY_SCHEDULE_MINUTES) {
    const moment = createdAt.add({ minutes });
    if (Temporal.Instant.compare(moment, now) > 0) return moment;
  }
  return null;
}
