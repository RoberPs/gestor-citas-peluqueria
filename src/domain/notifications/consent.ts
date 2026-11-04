import type { Temporal } from '@js-temporal/polyfill';
import type { AppointmentId } from '../booking/appointment';
import { err, ok, type Result } from '../shared/result';

/**
 * The messages the app sends, and the client's say in them (004, Principio IV).
 *
 * A consent belongs to one appointment and one channel (D-007): there is no
 * list of addresses that unsubscribed, and an email consent says nothing about
 * SMS (FR-003).
 */

export type Channel = 'EMAIL' | 'SMS';

/** The one kind this feature sends. A reminder would be another. */
export type NotificationKind = 'BOOKING_CONFIRMATION';

/**
 * `UNSUBSCRIBED`: the client said so, from the email or from the appointment.
 * `EMAIL_CHANGED`: the owner changed or removed the address the client gave
 * consent for (FR-008).
 */
export type ConsentEndReason = 'UNSUBSCRIBED' | 'EMAIL_CHANGED';

/** Why a notification was never sent. Not a failure: nothing should have gone out. */
export type SkipReason = 'CONSENT_ENDED' | 'APPOINTMENT_CANCELLED' | 'PERSONAL_DATA_DELETED';

export type NotificationId = string;

export type ChannelConsent = {
  readonly appointmentId: AppointmentId;
  readonly channel: Channel;
  readonly grantedAt: Temporal.Instant;
  readonly ended: { readonly at: Temporal.Instant; readonly reason: ConsentEndReason } | null;
};

/** A notification still to be sent, as the dispatch reads it. */
export type PendingNotification = {
  readonly id: NotificationId;
  readonly appointmentId: AppointmentId;
  readonly channel: Channel;
  readonly kind: NotificationKind;
  readonly attempts: number;
  /** The hour of retries counts from here (FR-011). */
  readonly createdAt: Temporal.Instant;
};

/** No consent and an ended one mean the same thing: nothing is sent (D-007). */
export function isConsentActive(consent: ChannelConsent | null, channel: Channel): boolean {
  return consent !== null && consent.channel === channel && consent.ended === null;
}

/**
 * FR-016: a consent ends once. A second request is harmless, and the caller
 * keeps the first end, which is the one that stopped the sending.
 */
export function revokeConsent(
  consent: ChannelConsent,
  reason: ConsentEndReason,
  now: Temporal.Instant,
): Result<ChannelConsent, 'ALREADY_ENDED'> {
  if (consent.ended !== null) return err('ALREADY_ENDED');
  return ok({ ...consent, ended: { at: now, reason } });
}
